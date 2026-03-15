const https = require('https');
const fs = require('fs');

async function test(originLat, originLng, limit) {
  const stores = JSON.parse(fs.readFileSync('src/assets/family_mart_stores.json', 'utf8'));
  
  // Sort by distance to dummy origin
  function getDist(lat1, lng1, lat2, lng2) {
      const R = 6371e3; // metres
      const p1 = lat1 * Math.PI/180;
      const p2 = lat2 * Math.PI/180;
      const dp = (lat2-lat1) * Math.PI/180;
      const dl = (lng2-lng1) * Math.PI/180;
      const a = Math.sin(dp/2) * Math.sin(dp/2) +
                Math.cos(p1) * Math.cos(p2) *
                Math.sin(dl/2) * Math.sin(dl/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
  }
  
  stores.forEach(s => s.dist = getDist(originLat, originLng, s.py_wgs84, s.px_wgs84));
  stores.sort((a,b) => a.dist - b.dist);
  
  const targetStores = stores.slice(0, limit);
  const pkeys = targetStores.map(s => s.pkeynew);
  const maxDist = targetStores[targetStores.length - 1].dist;
  
  const url = 'https://stamp.family.com.tw/api/maps/MapProductInfo';
  const body = {
    "ProjectCode": "202106302",
    "OldPKeys": pkeys,
    "PostInfo": "",
    "Latitude": originLat,
    "Longitude": originLng
  };
  
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  
  return new Promise((resolve) => {
    const req = https.request(url, options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(rawData);
          console.log(`[Limit ${limit}, MaxDist: ${maxDist.toFixed(0)}m] Requested: ${pkeys.length}, Returned: ${parsedData.data ? parsedData.data.length : 0}`);
        } catch (e) {
          console.error(`Parse error:`, e.message);
        }
        resolve();
      });
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const originLat = 25.041;
  const originLng = 121.543;
  await test(originLat, originLng, 1);
  await test(originLat, originLng, 5);
  await test(originLat, originLng, 15);
  await test(originLat, originLng, 30);
  await test(originLat, originLng, 50);
}

run();
