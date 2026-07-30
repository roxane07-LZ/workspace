/* Vercel 构建脚本：把根目录的 server.js 复制到 api/server.js，
   让 Serverless Function 能直接 require('./server.js')，避免 includeFiles 打包失败 */
const fs = require('fs');
fs.copyFileSync('server.js', 'api/server.js');
console.log('Vercel build: copied server.js -> api/server.js');
