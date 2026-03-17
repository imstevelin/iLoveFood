import https from 'https';

const MINIMAX_API_KEY = "sk-cp-JYzj0Mc_qZFXvJwKpi0vK9oH0Gv1LTrYI7dvXS_iE8V2S59Ks53Hz2A_ENzkUvC2l5_4l3qCxSaXlUtRx0MTsaS67viraZlMeTnsrxgaVXTrBqA1dehE7XA";

const payload = {
  model: "MiniMax-M2.5",
  messages: [
    {
      role: "system",
      content: "你是對話小助手。根據工具結果回答問題。"
    },
    { role: "user", content: "信義區有哪些吃的話？" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_12345",
          type: "function",
          function: {
            name: "search_by_area",
            arguments: "{\"area\":\"信義區\"}"
          }
        }
      ]
    },
    {
      role: "tool",
      tool_call_id: "call_12345",
      name: "search_by_area",
      content: JSON.stringify([
        {
          storeName: "全家信義二店",
          distance: 100,
          foodInfo: [
            { category: "甜點", items: ["布丁"] }
          ]
        }
      ])
    }
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "search_by_area",
        description: "搜尋這地區的商店",
        parameters: {
          type: "object",
          properties: {
            area: { type: "string" }
          },
          required: ["area"]
        }
      }
    }
  ],
  max_tokens: 1500
};

const options = {
  hostname: 'api.minimax.io',
  path: '/v1/text/chatcompletion_v2',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(JSON.stringify(JSON.parse(data), null, 2));
  });
});

req.on('error', (e) => {
  console.error(`Problem: ${e.message}`);
});

req.write(JSON.stringify(payload));
req.end();
