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
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

// 距離計算
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 7-11 Token 獲取 (強化版)
async function getSevenToken() {
  const tokenFarmUrl = 'https://ilovefood-api.imstevelin.com/get_token';
  const farmResp = await fetch(tokenFarmUrl, { method: 'POST', headers: { 'User-Agent': UA } });
  const farmData = await farmResp.json();
  
  if (farmData.status !== 'success' || !farmData.mid_v) {
    throw new Error('無法從 Token Farm 獲取 mid_v');
  }

  const loginUrl = SEVEN_BASE + 'Auth/FrontendAuth/AccessToken?mid_v=' + farmData.mid_v;
  const loginResp = await fetch(loginUrl, { method: 'POST', headers: { 'User-Agent': UA } });
  const loginData = await loginResp.json();

  if (!loginData.isSuccess || !loginData.element) {
    throw new Error('7-11 登入失敗: ' + (loginData.message || '無回應'));
  }

  return loginData.element;
}

// 載入 JSON 資料庫
function loadJSON(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(data) ? data : (data.element || []);
  } catch (e) { return []; }
}

// 地理編碼
async function geocodeKeyword(keyword) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(keyword)}&format=json&countrycodes=tw&limit=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'iLoveFood-Adapter/2.0' } });
    const data = await resp.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
    }
  } catch (e) {}
  return null;
}

cli({
  site: 'ilovefood',
  name: 'stock',
  description: '查詢地區折扣商品 (支援自然語言地標，如: 台中火車站)',
  domain: 'ilovefood.imstevelin.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'keyword', type: 'string', positional: true, required: true, help: '搜尋目標 (例: 台中火車站 / 亞洲大學 / 大里)' },
    { name: 'limit', type: 'int', default: 9999, help: '商品回傳上限' },
    { name: 'radius', type: 'int', default: 1200, help: '商圈搜尋半徑(m)' },
  ],
  columns: ['brand', 'storeName', 'dist', 'category', 'name', 'price', 'stock'],
  func: async (_page, args) => {
    const keyword = args.keyword;
    const limit = parseInt(args.limit, 10) || 9999;
    const radius = parseInt(args.radius, 10) || 1200;

    const sevenStoresData = loadJSON('seven_eleven_stores.json');
    const fmStoresData = loadJSON('family_mart_stores.json');
    const fmProductsDB = loadJSON('family_mart_products.json');

    const allStores = [
      ...sevenStoresData.map(s => ({ ...s, brand: '7-11', id: s.serial, sName: s.name, sAddr: s.addr, sLat: parseFloat(s.lat), sLng: parseFloat(s.lng) })),
      ...fmStoresData.map(s => ({ ...s, brand: 'FamilyMart', id: s.pkeynew || s.oldPKey || s.PKey, sName: s.Name, sAddr: s.addr, sLat: parseFloat(s.py_wgs84), sLng: parseFloat(s.px_wgs84) }))
    ];

    // 1. 地理定位
    let center = await geocodeKeyword(keyword);
    if (!center) {
      // 找不到地標，嘗試在門市名稱中找
      const match = allStores.find(s => s.sName.includes(keyword) || s.sAddr.includes(keyword));
      if (match) center = { lat: match.sLat, lng: match.sLng };
    }

    if (!center) throw new CliError('NO_DATA', `無法定位 "${keyword}"，請輸入更具體的地點。`);

    // 2. 篩選門市
    const nearbyStores = allStores.map(s => ({
      ...s,
      distance: getDistance(center.lat, center.lng, s.sLat, s.sLng)
    })).filter(s => s.distance <= radius).sort((a, b) => a.distance - b.distance);

    if (nearbyStores.length === 0) throw new CliError('NO_DATA', `在 "${keyword}" 附近找不到超商。`);

    // 3. 獲取庫存
    const items = [];
    const queriedNames = new Set();
    
    // 預載全家區域庫存 (FM 一次查一區)
    const fmStockCache = new Map();
    const fmTarget = nearbyStores.find(s => s.brand === 'FamilyMart');
    if (fmTarget) {
      try {
        const resp = await fetch(FM_BASE + '/MapProductInfo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
          body: JSON.stringify({ "ProjectCode": "202106302", "OldPKeys": [], "PostInfo": "", "Latitude": center.lat, "Longitude": center.lng })
        });
        const data = await resp.json();
        for (const s of data.data || []) {
          fmStockCache.set(s.PKey || s.pkeynew || s.oldPKey, s);
        }
      } catch (e) {}
    }

    // 獲取 7-11 Token
    let sevenToken = null;
    if (nearbyStores.some(s => s.brand === '7-11')) {
      try { sevenToken = await getSevenToken(); } catch (e) {}
    }

    // 遍歷門市
    for (const store of nearbyStores) {
      if (items.length >= limit) break;
      queriedNames.add(store.sName);

      if (store.brand === '7-11' && sevenToken) {
        try {
          const resp = await fetch(`${SEVEN_BASE}Search/FrontendStoreItemStock/GetStoreDetail?token=${sevenToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
            body: JSON.stringify({ storeNo: store.id, CurrentLocation: { Latitude: store.sLat, Longitude: store.sLng } })
          });
          const data = await resp.json();
          if (data.isSuccess && data.element?.StoreStockItem) {
            for (const cat of data.element.StoreStockItem.CategoryStockItems || []) {
              for (const item of cat.StockItems || []) {
                items.push({
                  brand: '7-11',
                  storeName: store.sName,
                  dist: Math.round(store.distance) + 'm',
                  category: cat.Name,
                  name: item.ItemName,
                  price: item.Price,
                  stock: item.RemainingQty
                });
                if (items.length >= limit) break;
              }
              if (items.length >= limit) break;
            }
          }
        } catch (e) {}
      } else if (store.brand === 'FamilyMart') {
        const s = fmStockCache.get(store.id);
        if (s) {
          const rawItems = s.info ? s.info.flatMap(i => (i.categories || []).flatMap(c => (c.products || []).map(p => ({ ...p, cat: i.name })))) : (s.list || []);
          for (const p of rawItems) {
            // 解決價格為 0 的問題：改為顯示「未標示」以免誤導
            let price = p.price || 0;
            if (price === 0) {
               price = "未標示";
            }

            items.push({
              brand: 'FamilyMart',
              storeName: store.sName,
              dist: Math.round(store.distance) + 'm',
              category: p.cat || p.kindName || '一般',
              name: p.name,
              price: price,
              stock: p.qty
            });
            if (items.length >= limit) break;
          }
        }
      }
    }

    if (items.length === 0) {
      throw new CliError('NO_DATA', `已巡查 ${Array.from(queriedNames).slice(0, 5).join(', ')} 等門市，目前暫無折扣商品。`);
    }

    return items;
  }
});
