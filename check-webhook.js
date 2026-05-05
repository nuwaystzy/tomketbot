const fs = require('fs');
const https = require('https');

const envFile = fs.readFileSync('.env.local', 'utf8');
const token = envFile.match(/TELEGRAM_BOT_TOKEN=(.+)/)[1].trim();

https.get(`https://api.telegram.org/bot${token}/getWebhookInfo`, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data));
});
