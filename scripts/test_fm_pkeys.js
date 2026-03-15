const fetch = require('node-fetch');

async function test() {
  const url = 'https://foodmap.family.com.tw/api/APP/Store/MapProductInfo';
  const body = {
    "ProjectCode": "202106302",
    "OldPKeys": ["015112", "014078"],
    "PostInfo": "",
    "Latitude": 25.041,
    "Longitude": 121.543
  };
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  console.log(text.substring(0, 500));
}

test();
