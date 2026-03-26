const https = require('https');

const data = JSON.stringify({
  model: 'gemini-2.5-flash',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 1500
});

const options = {
  hostname: 'generativelanguage.googleapis.com',
  path: '/v1beta/openai/chat/completions',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer AIzaSyB01eazvCD50URygZjKWzOi8PmMcx4UjdU',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  res.on('end', () => {
    console.log('Status code:', res.statusCode);
    console.log('Response:', responseData);
  });
});

req.on('error', (e) => {
  console.error('Error:', e);
});

req.write(data);
req.end();
