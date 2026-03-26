const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/admin/clear-lobbies',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Server response:', JSON.parse(data).message);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
  console.log('Make sure the Monopoly server is running on port 3000.');
});

req.end();
