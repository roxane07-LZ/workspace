let serverCore;
try { serverCore = require('./server.js'); }          // Vercel 构建后：server.js 被复制到 api/ 目录
catch (err) { serverCore = require('../server.js'); }  // 本地开发：server.js 在父目录
const { route } = serverCore;

module.exports = async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  // Vercel 默认会把「/」交给本函数。这里把首页 302 到仓库里的静态 HTML，
  // 避免函数去读云上不存在的本地文件而崩溃。静态 HTML（含音乐/B站的相对 /api/ 调用）由 Vercel 直接托管。
  if (!u.pathname.startsWith('/api/')) {
    res.writeHead(302, { Location: '/极简业务工作台.html' });
    return res.end();
  }
  try {
    await route(req, res, u);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, msg: e.message }));
    } else res.end();
  }
};
