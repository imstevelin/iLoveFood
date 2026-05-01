import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const SEVEN_BASE = 'https://lovefood.openpoint.com.tw/LoveFood/api/';
const FM_BASE = 'https://stamp.family.com.tw/api/maps';
const API_KEY = "AIzaSyC6yb0M_aoYSz-wAX0oft1bxcU5R2aGNTA";
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function decodePolyline(encoded) {
  const poly = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;
  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    poly.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return poly;
}

async function getSevenToken() {
  const tokenFarmUrl = 'https://ilovefood-api.imstevelin.com/get_token';
  const farmResp = await fetch(tokenFarmUrl, { method: 'POST', headers: { 'User-Agent': UA } });
  const farmData = await farmResp.json();
  if (farmData.status !== 'success' || !farmData.mid_v) throw new Error('無法從 Token Farm 獲取 mid_v');
  const loginUrl = SEVEN_BASE + 'Auth/FrontendAuth/AccessToken?mid_v=' + farmData.mid_v;
  const loginResp = await fetch(loginUrl, { method: 'POST', headers: { 'User-Agent': UA } });
  const loginData = await loginResp.json();
  if (!loginData.isSuccess || !loginData.element) throw new Error('7-11 登入失敗');
  return loginData.element;
}

function loadStores(filePath, brandName) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const stores = Array.isArray(data) ? data : (data.element || []);
    return stores.map(s => {
      const lat = parseFloat(s.lat || s.Latitude || s.Y || s.py_wgs84 || 0);
      const lng = parseFloat(s.lng || s.Longitude || s.X || s.px_wgs84 || 0);
      return {
        brand: brandName,
        storeNo: s.serial || s.StoreNo || s.PKey || s.pkeynew || '',
        name: s.name || s.Name || s.StoreName || s.NAME || '',
        address: s.addr || s.Address || s.ADDRESS || '',
        lat, lng
      };
    });
  } catch (e) { return []; }
}

cli({
  site: 'ilovefood',
  name: 'route',
  description: 'Google Maps 路線解析並搜尋沿途超商的折扣商品',
  domain: 'ilovefood.imstevelin.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'url', type: 'string', positional: true, required: true, help: 'Google Maps 路線網址' },
    { name: 'limit', type: 'int', default: 9999, help: '最大回傳商品數量' },
  ],
  columns: ['brand', 'storeName', 'category', 'name', 'price', 'stock'],
  func: async (_page, args) => {
    const { url, limit } = args;
    let finalUrl = url;
    let proxyHtml = '';

    try {
        if (url.includes('goo.gl')) {
            const workerUrl = `https://maps-proxy.imstevelin.workers.dev/?url=${encodeURIComponent(url)}`;
            const resp = await fetch(workerUrl);
            const data = await resp.json();
            if (data.error) throw new CliError('API_ERROR', '代理伺服器解析錯誤: ' + data.error);
            finalUrl = data.resolvedUrl || url;
            proxyHtml = data.html || '';
        }
        
        const coords = [];

        // 1. 嘗試從 URL Path 中尋找起點 /dir/lat,lng/
        const dirMatch = finalUrl.match(/\/dir\/(-?\d+\.\d+),(-?\d+\.\d+)\//);
        if (dirMatch) {
            coords.push({ type: 'origin', lat: parseFloat(dirMatch[1]), lng: parseFloat(dirMatch[2]) });
        }

        // 2. 嘗試從 saddr 參數找座標 (這在某些 URL 變體中會出現)
        const saddrMatch = finalUrl.match(/saddr=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (saddrMatch) {
            coords.push({ type: 'origin', lat: parseFloat(saddrMatch[1]), lng: parseFloat(saddrMatch[2]) });
        }
        
        // 3. 嘗試從 daddr 參數找座標
        const daddrMatch = finalUrl.match(/daddr=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (daddrMatch) {
            coords.push({ type: 'destination', lat: parseFloat(daddrMatch[1]), lng: parseFloat(daddrMatch[2]) });
        }

        // 4. 嘗試從 !1d(lng)!2d(lat) 格式找終點
        const d12Match = finalUrl.match(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/);
        if (d12Match) {
            coords.push({ type: 'destination', lat: parseFloat(d12Match[2]), lng: parseFloat(d12Match[1]) });
        }

        // 5. 嘗試通用經緯度匹配 (!3d lat !4d lng)
        const regex3d4d = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g;
        let match;
        while ((match = regex3d4d.exec(finalUrl)) !== null) {
            coords.push({ lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
        }

        // 6. 如果從 URL 找不到，嘗試從 Proxy 返回的 HTML 中找所有經緯度特徵
        if (coords.length < 2 && proxyHtml) {
            const htmlRegex = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g;
            let m;
            while ((m = htmlRegex.exec(proxyHtml)) !== null) {
                coords.push({ lat: parseFloat(m[1]), lng: parseFloat(m[2]) });
            }
        }

        // 7. 最後的退路：如果還是少於 2 個點，手動 fetch 頁面內容解析
        if (coords.length < 2) {
            const pageResp = await fetch(finalUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const pageText = await pageResp.text();
            const textRegex = /(-?\d+\.\d+),(-?\d+\.\d+)/g; // 尋找任何 lat,lng 格式
            let m;
            while ((m = textRegex.exec(pageText)) !== null) {
                const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
                if (lat > 21 && lat < 26 && lng > 118 && lng < 123) { // 限制在台灣範圍內避免誤判
                    coords.push({ lat, lng });
                }
            }
        }

        // 去重並標記起終點
        const uniqueCoords = Array.from(new Set(coords.map(c => `${c.lat},${c.lng}`)))
            .map(s => {
                const [lat, lng] = s.split(',').map(Number);
                return { lat, lng };
            });

        if (uniqueCoords.length < 2) {
             throw new CliError('NO_DATA', `無法從網址解析出起終點座標。`);
        }

        const origin = uniqueCoords[0];
        const dest = uniqueCoords[uniqueCoords.length - 1];

        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}&key=${API_KEY}`;
        const dirResp = await fetch(directionsUrl);
        const dirData = await dirResp.json();
        
        if (!dirData.routes || dirData.routes.length === 0) {
            throw new CliError('API_ERROR', 'Google Maps 路線規劃失敗。');
        }

        const polyline = dirData.routes[0].overview_polyline.points;
        const pathPoints = decodePolyline(polyline);
        
        const sampled = [];
        let lastP = null;
        for (const p of pathPoints) {
            if (!lastP) { sampled.push(p); lastP = p; }
            else {
                const d = getDistance(lastP.lat, lastP.lng, p.lat, p.lng);
                if (d >= 2000) { sampled.push(p); lastP = p; }
            }
        }
        sampled.push(pathPoints[pathPoints.length-1]);

        const allStores = [
            ...loadStores(path.join(DATA_DIR, 'seven_eleven_stores.json'), '7-11'),
            ...loadStores(path.join(DATA_DIR, 'family_mart_stores.json'), 'FamilyMart')
        ];

        const routeStoresMap = new Map();
        for (const p of sampled) {
            for (const s of allStores) {
                if (!routeStoresMap.has(s.storeNo)) {
                    const d = getDistance(p.lat, p.lng, s.lat, s.lng);
                    if (d <= 2000) routeStoresMap.set(s.storeNo, s);
                }
            }
        }

        const routeStores = Array.from(routeStoresMap.values());
        if (routeStores.length === 0) throw new CliError('NO_DATA', '沿途找不到超商門市。');

        const items = [];
        const queriedNames = new Set();
        const fmStockCache = new Map();
        if (routeStores.some(s => s.brand === 'FamilyMart')) {
          for (const p of sampled) {
            try {
              const resp = await fetch(FM_BASE + '/MapProductInfo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
                body: JSON.stringify({ "ProjectCode": "202106302", "OldPKeys": [], "PostInfo": "", "Latitude": p.lat, "Longitude": p.lng })
              });
              const data = await resp.json();
              for (const s of data.data || []) {
                fmStockCache.set(s.PKey || s.pkeynew || s.oldPKey, s);
              }
            } catch (e) {}
          }
        }

        let sevenToken = null;
        if (routeStores.some(s => s.brand === '7-11')) {
          try { sevenToken = await getSevenToken(); } catch (e) {}
        }

        for (const store of routeStores) {
            if (items.length >= limit) break;
            queriedNames.add(store.name);

            if (store.brand === '7-11' && sevenToken) {
                try {
                    const resp = await fetch(`${SEVEN_BASE}Search/FrontendStoreItemStock/GetStoreDetail?token=${sevenToken}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
                        body: JSON.stringify({ storeNo: store.storeNo, CurrentLocation: { Latitude: store.lat, Longitude: store.lng } })
                    });
                    const data = await resp.json();
                    if (data.isSuccess && data.element?.StoreStockItem) {
                        for (const cat of data.element.StoreStockItem.CategoryStockItems || []) {
                            for (const item of cat.StockItems || []) {
                                items.push({ brand: '7-11', storeName: store.name, category: cat.Name, name: item.ItemName, price: item.Price, stock: item.RemainingQty });
                                if (items.length >= limit) break;
                            }
                            if (items.length >= limit) break;
                        }
                    }
                } catch (e) {}
            } else if (store.brand === 'FamilyMart') {
                const s = fmStockCache.get(store.storeNo);
                if (s) {
                    const rawItems = s.info ? s.info.flatMap(i => (i.categories || []).flatMap(c => (c.products || []).map(p => ({ ...p, cat: i.name })))) : (s.list || []);
                    for (const p of rawItems) {
                        let price = p.price || 0;
                        if (price === 0) price = "未標示";
                        items.push({ brand: 'FamilyMart', storeName: store.name, category: p.cat || p.kindName || '一般', name: p.name, price: price, stock: p.qty });
                        if (items.length >= limit) break;
                    }
                }
            }
        }

        if (items.length === 0) throw new CliError('NO_DATA', `已巡查 ${Array.from(queriedNames).slice(0, 3).join(', ')} 等門市，暫無折扣品。`);
        return items;
    } catch (e) {
        if (e instanceof CliError) throw e;
        throw new CliError('API_ERROR', '路線解析錯誤：' + e.message);
    }
  }
});