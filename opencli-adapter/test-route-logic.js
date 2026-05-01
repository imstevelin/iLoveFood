const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = '/Users/imstevelin/本地儲存/coding/iLoveFood/opencli-adapter';
const API_KEY = "AIzaSyC6yb0M_aoYSz-wAX0oft1bxcU5R2aGNTA";

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
  } catch (e) {
    return [];
  }
}

async function test() {
  const origin = { lat: 24.044543, lng: 120.6878096 };
  const dest = { lat: 24.1405776, lng: 120.689814 };
  
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  
  const polyline = data.routes[0].overview_polyline.points;
  const pathPoints = decodePolyline(polyline);
  
  // Sample points every ~2km
  const sampled = [];
  let lastP = null;
  for (const p of pathPoints) {
    if (!lastP) {
      sampled.push(p);
      lastP = p;
    } else {
      const d = getDistance(lastP.lat, lastP.lng, p.lat, p.lng);
      if (d >= 1500) {
        sampled.push(p);
        lastP = p;
      }
    }
  }
  if (lastP && getDistance(lastP.lat, lastP.lng, pathPoints[pathPoints.length-1].lat, pathPoints[pathPoints.length-1].lng) > 500) {
      sampled.push(pathPoints[pathPoints.length-1]);
  }
  
  console.log(`Sampled ${sampled.length} points along the route.`);
  
  const allStores = [
      ...loadStores(path.join(PROJECT_ROOT, 'data', 'seven_eleven_stores.json'), '7-11'),
      ...loadStores(path.join(PROJECT_ROOT, 'data', 'family_mart_stores.json'), 'FamilyMart')
  ];
  
  const routeStores = new Map();
  for (const p of sampled) {
      for (const s of allStores) {
          const d = getDistance(p.lat, p.lng, s.lat, s.lng);
          if (d <= 500) { // Within 500m of the route
              if (!routeStores.has(s.storeNo)) {
                  routeStores.set(s.storeNo, s);
              }
          }
      }
  }
  
  console.log(`Found ${routeStores.size} stores along the route.`);
}

test();