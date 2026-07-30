// Vercel Serverless Function 入口
// 复用 server.js 的路由逻辑。Vercel 构建时会通过 npm run build 把 server.js 复制到 api/server.js
const route = require('./server.js');

module.exports = async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    await route(req, res, u);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, msg: e.message }));
    } else res.end();
  }
};
