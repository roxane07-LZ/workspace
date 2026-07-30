// Vercel 构建钩子：把根目录的 server.js 复制到 api/ 下，
// 这样 api/index.js 可以通过 require('./server.js') 稳定引用。
const fs = require('fs');
fs.copyFileSync('server.js', 'api/server.js');
console.log('Copied server.js -> api/server.js for Vercel deployment.');
