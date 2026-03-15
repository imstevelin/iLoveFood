const https = require('https');
const fs = require('fs');

async function test(limit) {
  const stores = JSON.parse(fs.readFileSync('src/assets/family_mart_stores.json', 'utf8'));
  const pkeys = stores.slice(0, limit).map(s => s.pkeynew);
  
  const url = 'https://stamp.family.com.tw/api/maps/MapProductInfo';
  const body = {
    "ProjectCode": "202106302",
    "OldPKeys": pkeys,
    "PostInfo": "",
    "Latitude": 25.033, // Dummy
    "Longitude": 121.564
  };
  
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  
  return new Promise((resolve) => {
    const req = https.request(url, options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(rawData);
            console.log(`[Limit ${limit}] Requested: ${pkeys.length}, Returned elements: ${parsedData.data ? parsedData.data.length : 0}`);
          } catch (e) {
            console.error(`[Limit ${limit}] Parse error: ${e.message}`);
          }
          resolve();
        });
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  await test(20);
  await test(30);
  await test(50);
  await test(100);
}

run();
