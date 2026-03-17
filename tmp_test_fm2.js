const axios = require('axios');

async function test() {
  const url = 'https://stamp.family.com.tw/api/maps/MapProductInfo';
  const body = {
    "ProjectCode": "202106302",
    "OldPKeys": [],
    "PostInfo": "",
    "Latitude": 24.0824108,
    "Longitude": 120.6995849
  };
  
  const res = await axios.post(url, body);
  const data = res.data.data;
  
  const target = data.find(s => s.name.includes("大里金瑞"));
  if (target) {
     console.log("Found store via spatial search!");
     console.log("Its REAL ID (oldPKey) is:", target.oldPKey || target.pkey);
     console.log("Products:", JSON.stringify(target.info, null, 2));
  } else {
     console.log("Store still not found by space search. Found stores:", data.map(s => s.name));
  }
}

test();
