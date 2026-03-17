const axios = require('axios');
const fs = require('fs');

async function test() {
  const stores = JSON.parse(fs.readFileSync('src/assets/family_mart_stores.json', 'utf8'));
  const store = stores.find(s => s.Name === '全家大里金瑞店');
  
  console.log("Store Info:", store);
  
  const lat = parseFloat(store.py_wgs84);
  const lng = parseFloat(store.px_wgs84);
  
  const url = 'https://stamp.family.com.tw/api/maps/MapProductInfo';
  const body = {
    "ProjectCode": "202106302",
    "OldPKeys": [store.pkeynew],
    "PostInfo": "",
    "Latitude": lat,
    "Longitude": lng
  };
  
  console.log("Request:", body);
  const res = await axios.post(url, body);
  console.log("Response:", JSON.stringify(res.data, null, 2));
}

test();
