const fs = require('fs');
fs.copyFileSync('server.js', 'api/server.js');
console.log('Vercel build: copied server.js -> api/server.js');
