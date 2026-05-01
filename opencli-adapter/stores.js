import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

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

async function geocodeKeyword(keyword) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(keyword)}&format=json&countrycodes=tw&limit=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'iLoveFood-Adapter/2.0' } });
    const data = await resp.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (e) {}
  return null;
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
  name: 'stores',
  description: '精準搜尋超商門市 (支援自然語言地標)',
  domain: 'ilovefood.imstevelin.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'keyword', type: 'string', positional: true, default: '', help: '搜尋目標 (例: 台中火車站 / 亞洲大學 / 台北101)' },
    { name: 'limit', type: 'int', default: 9999, help: '返回數量' },
    { name: 'radius', type: 'int', default: 1500, help: '搜尋半徑(m)' },
  ],
  columns: ['brand', 'storeNo', 'name', 'address', 'distance_m'],
  func: async (_page, args) => {
    const keyword = args.keyword;
    const limit = parseInt(args.limit, 10) || 9999;
    const radius = parseInt(args.radius, 10) || 1500;
    
    const allStores = [
      ...loadStores(path.join(DATA_DIR, 'seven_eleven_stores.json'), '7-11'),
      ...loadStores(path.join(DATA_DIR, 'family_mart_stores.json'), 'FamilyMart')
    ];

    let center = null;
    if (keyword) {
      center = await geocodeKeyword(keyword);
      if (!center) {
        const match = allStores.find(s => s.name.includes(keyword) || s.address.includes(keyword));
        if (match) center = { lat: match.lat, lng: match.lng };
      }
    }

    if (!center) {
      if (keyword) throw new CliError('NO_DATA', `無法定位 "${keyword}"。`);
      return allStores.slice(0, limit);
    }

    const results = allStores.map(s => ({
      ...s,
      distance_m: Math.round(getDistance(center.lat, center.lng, s.lat, s.lng))
    })).filter(s => s.distance_m <= radius).sort((a, b) => s.distance_m - b.distance_m);

    if (results.length === 0) throw new CliError('NO_DATA', `範圍內找不到超商。`);

    return results.slice(0, limit);
  },
});
