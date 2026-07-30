/* ============================================================
 * 极简业务工作台 · 本地服务端（零依赖，仅用 Node 内置模块）
 * 作用：解决浏览器跨域限制，代理网易云音乐 + 哔哩哔哩接口
 * 启动：双击「启动工作台.bat」，或命令行 node server.js
 * ============================================================ */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const HTML = '极简业务工作台.html';
const SESSION = path.join(ROOT, '.bili_session.json');
let PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8848;

/* ---------- 通用请求头 ---------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const NE_HEAD = { 'User-Agent': UA, Referer: 'https://music.163.com/', Origin: 'https://music.163.com', Cookie: 'appver=8.7.01; os=pc' };
const BI_HEAD = () => ({ 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', Cookie: biliCookie });

/* ---------- B站会话持久化 ---------- */
let biliCookie = '';
try { biliCookie = JSON.parse(fs.readFileSync(SESSION, 'utf8')).cookie || ''; } catch (e) { }
function saveCookie(c) { biliCookie = c; try { fs.writeFileSync(SESSION, JSON.stringify({ cookie: c, at: Date.now() })); } catch (e) { } }

/* ---------- 底层：抓取为字符串 ---------- */
function fetchText(target, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const mod = u.protocol === 'http:' ? http : https;
    const r = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, method: opts.method || 'GET',
      headers: Object.assign({ 'User-Agent': UA }, opts.headers || {})
    }, resp => {
      const chunks = [];
      resp.on('data', d => chunks.push(d));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.setTimeout(15000, () => { r.destroy(); reject(new Error('请求超时')); });
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

/* ---------- 底层：流式代理（支持 302 跳转 + Range 分段） ---------- */
function pipeProxy(target, cliReq, cliRes, extraHead = {}, depth = 0) {
  if (depth > 5) { cliRes.writeHead(508); return cliRes.end('重定向过多'); }
  let u;
  try { u = new URL(target); } catch (e) { cliRes.writeHead(400); return cliRes.end('URL 无效'); }
  const mod = u.protocol === 'http:' ? http : https;
  const head = Object.assign({ 'User-Agent': UA, Accept: '*/*' }, extraHead);
  if (cliReq.headers.range) head.Range = cliReq.headers.range;
  const r = mod.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
    path: u.pathname + u.search, method: 'GET', headers: head
  }, resp => {
    if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
      resp.resume();
      return pipeProxy(new URL(resp.headers.location, target).href, cliReq, cliRes, extraHead, depth + 1);
    }
    const h = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
    ['content-type', 'content-length', 'content-range', 'cache-control'].forEach(k => { if (resp.headers[k]) h[k] = resp.headers[k]; });
    cliRes.writeHead(resp.statusCode, h);
    resp.pipe(cliRes);
  });
  r.on('error', e => { if (!cliRes.headersSent) cliRes.writeHead(502); cliRes.end('上游错误: ' + e.message); });
  r.setTimeout(20000, () => r.destroy(new Error('超时')));
  r.end();
}

const json = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
};

/* ============================================================
 *  路由处理
 * ============================================================ */
async function route(req, res, u) {
  const p = u.pathname, q = u.searchParams;

  /* ========== 网易云音乐 ========== */

  // 搜索：/api/ne/search?kw=关键词&limit=30
  if (p === '/api/ne/search') {
    const kw = q.get('kw') || '', limit = q.get('limit') || 30;
    const r = await fetchText(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(kw)}&type=1&offset=0&total=true&limit=${limit}`, { headers: NE_HEAD });
    const j = JSON.parse(r.body);
    const songs = (j.result && j.result.songs || []).map(s => ({
      neid: s.id, title: s.name,
      artist: (s.artists || s.ar || []).map(a => a.name).join(' / '),
      album: (s.album || s.al || {}).name || '',
      cover: (s.album || s.al || {}).picUrl || '',
      dt: s.duration || s.dt || 0
    }));
    // 搜索接口常不返回封面，批量补一次详情
    if (songs.length && !songs[0].cover) {
      try {
        const d = await fetchText(`https://music.163.com/api/song/detail?ids=[${songs.map(s => s.neid).join(',')}]`, { headers: NE_HEAD });
        const dj = JSON.parse(d.body);
        const map = {};
        (dj.songs || []).forEach(x => { map[x.id] = (x.album || {}).picUrl || ''; });
        songs.forEach(s => { if (map[s.neid]) s.cover = map[s.neid]; });
      } catch (e) { }
    }
    return json(res, { ok: true, songs });
  }

  // 歌单导入：/api/ne/playlist?id=歌单ID（支持粘贴完整分享链接）
  if (p === '/api/ne/playlist') {
    const raw = (q.get('id') || '').trim();
    const id = (raw.match(/[?&]id=(\d+)/) || [])[1]
      || (raw.match(/playlist\/(\d+)/) || [])[1]
      || (raw.match(/^\d+$/) || [])[0]
      || (raw.match(/(\d{6,})/) || [])[1];
    if (!id) return json(res, { ok: false, msg: '未识别到歌单 ID，请粘贴歌单链接或纯数字 ID' });
    const r = await fetchText(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000&s=0`,
      { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, NE_HEAD) });
    const j = JSON.parse(r.body);
    if (j.code !== 200 || !j.playlist) return json(res, { ok: false, msg: '歌单不存在或未公开' });
    const tracks = (j.playlist.tracks || []).map(s => ({
      neid: s.id, title: s.name,
      artist: (s.ar || s.artists || []).map(a => a.name).join(' / '),
      album: (s.al || s.album || {}).name || '',
      cover: (s.al || s.album || {}).picUrl || '', dt: s.dt || 0
    }));
    return json(res, { ok: true, name: j.playlist.name, cover: j.playlist.coverImgUrl, total: j.playlist.trackCount, tracks });
  }

  // 歌词：/api/ne/lyric?id=
  if (p === '/api/ne/lyric') {
    const r = await fetchText(`https://music.163.com/api/song/lyric?id=${q.get('id')}&lv=-1&kv=-1&tv=-1`, { headers: NE_HEAD });
    const j = JSON.parse(r.body);
    return json(res, { ok: true, lyric: (j.lrc && j.lrc.lyric) || '', trans: (j.tlyric && j.tlyric.lyric) || '' });
  }

  // 音频流：/api/ne/stream?id=  （先取直链再流式转发，支持拖动进度条）
  if (p === '/api/ne/stream') {
    const id = q.get('id');
    let src = '';
    try {
      const e = await fetchText(`https://music.163.com/api/song/enhance/player/url?ids=[${id}]&br=320000`, { headers: NE_HEAD });
      const d = (JSON.parse(e.body).data || [])[0];
      if (d && d.url) src = d.url;
    } catch (err) { }
    if (!src) src = `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
    return pipeProxy(src, req, res, { Referer: 'https://music.163.com/' });
  }

  /* ========== 哔哩哔哩 ========== */

  // 生成登录二维码
  if (p === '/api/bili/qr') {
    const r = await fetchText('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });
    const j = JSON.parse(r.body);
    if (j.code !== 0) return json(res, { ok: false, msg: j.message });
    return json(res, { ok: true, key: j.data.qrcode_key, url: j.data.url });
  }

  // 轮询扫码状态；成功后落地 Cookie
  if (p === '/api/bili/poll') {
    const r = await fetchText('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(q.get('key') || ''),
      { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });
    const j = JSON.parse(r.body);
    const st = j.data ? j.data.code : -1;
    if (st === 0) {
      const sc = r.headers['set-cookie'] || [];
      const ck = sc.map(s => s.split(';')[0]).join('; ');
      if (ck) saveCookie(ck);
      return json(res, { ok: true, state: 'done', msg: '登录成功' });
    }
    const map = { 86101: '等待扫码', 86090: '已扫码，请在手机上确认', 86038: '二维码已失效，请刷新' };
    return json(res, { ok: true, state: st === 86038 ? 'expired' : 'wait', msg: map[st] || '等待中' });
  }

  // 手动写入 Cookie（不便扫码时用）
  if (p === '/api/bili/cookie') {
    const ck = q.get('v') || '';
    saveCookie(ck.includes('SESSDATA') ? ck : 'SESSDATA=' + ck);
    return json(res, { ok: true });
  }

  // 退出登录
  if (p === '/api/bili/logout') { saveCookie(''); return json(res, { ok: true }); }

  // 当前登录用户
  if (p === '/api/bili/nav') {
    if (!biliCookie) return json(res, { ok: true, login: false });
    const r = await fetchText('https://api.bilibili.com/x/web-interface/nav', { headers: BI_HEAD() });
    const j = JSON.parse(r.body);
    if (j.code !== 0) return json(res, { ok: true, login: false });
    return json(res, { ok: true, login: true, mid: j.data.mid, name: j.data.uname, face: j.data.face, level: j.data.level_info && j.data.level_info.current_level });
  }

  // 我创建的收藏夹列表
  if (p === '/api/bili/folders') {
    const mid = q.get('mid');
    if (!mid) return json(res, { ok: false, msg: '缺少 mid，请先登录' });
    const r = await fetchText(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`, { headers: BI_HEAD() });
    const j = JSON.parse(r.body);
    if (j.code !== 0) return json(res, { ok: false, msg: j.message });
    return json(res, { ok: true, list: (j.data && j.data.list || []).map(f => ({ id: f.id, title: f.title, count: f.media_count })) });
  }

  // 收藏夹内视频
  if (p === '/api/bili/fav') {
    const r = await fetchText(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${q.get('id')}&ps=${q.get('ps') || 40}&pn=${q.get('pn') || 1}&order=mtime&platform=web`, { headers: BI_HEAD() });
    const j = JSON.parse(r.body);
    if (j.code !== 0) return json(res, { ok: false, msg: j.message + '（收藏夹可能为私密，请先扫码登录）' });
    if (!j.data) return json(res, { ok: true, hasMore: false, list: [] });
    const medias = j.data.medias || [];
    return json(res, {
      ok: true, hasMore: !!j.data.has_more,
      list: medias.map(m => ({ bvid: m.bvid, title: m.title, cover: m.cover, up: m.upper && m.upper.name, dur: m.duration, play: m.cnt_info && m.cnt_info.play }))
    });
  }

  // 单个视频信息（手动加 BV 时补标题封面）
  if (p === '/api/bili/video') {
    const r = await fetchText('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(q.get('bvid') || ''), { headers: BI_HEAD() });
    const j = JSON.parse(r.body);
    if (j.code !== 0) return json(res, { ok: false, msg: j.message });
    return json(res, { ok: true, bvid: j.data.bvid, title: j.data.title, cover: j.data.pic, up: j.data.owner && j.data.owner.name, dur: j.data.duration });
  }

  /* ========== 通用代理 ========== */
  // 图片代理（B站/网易云封面均有防盗链）
  if (p === '/api/img') {
    let t = q.get('url') || '';
    if (t.startsWith('//')) t = 'https:' + t;
    // 无效或空封面 → 返回 1x1 透明占位图，避免前端出现裂图
    if (!/^https?:\/\//.test(t)) {
      res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'max-age=86400' });
      return res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    }
    const ref = t.includes('hdslb.com') ? 'https://www.bilibili.com/' : 'https://music.163.com/';
    return pipeProxy(t, req, res, { Referer: ref });
  }
  // 任意音频直链代理
  if (p === '/api/stream') {
    const t = q.get('url'); if (!t) { res.writeHead(400); return res.end(); }
    return pipeProxy(t, req, res, {});
  }
  // 服务端在线探测
  if (p === '/api/ping') return json(res, { ok: true, ver: 1, bili: !!biliCookie });

  /* ========== 静态文件 ========== */
  let f = decodeURIComponent(p === '/' ? '/' + HTML : p);
  const fp = path.join(ROOT, f);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('404'); }
  const ext = path.extname(fp).toLowerCase();
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(fp).pipe(res);
}

/* ============================================================
 *  创建服务实例（供 Render / 本地 / Electron 直接运行）
 *  - 同时导出 route / createServer，供 Vercel Serverless 复用
 * ============================================================ */
function createServer() {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    try { await route(req, res, u); }
    catch (e) { if (!res.headersSent) json(res, { ok: false, msg: e.message }, 500); else res.end(); }
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') { PORT++; console.log('端口被占用，改用 ' + PORT); server.listen(PORT); }
    else console.error(e);
  });
  return server;
}

/* 仅在「直接运行 node server.js」时监听端口（Render / 本地 / Electron）。
   Vercel 通过 require 引入本文件时【不会】监听端口，避免冲突。 */
if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    const addr = 'http://localhost:' + PORT;
    console.log('WB_ADDR=' + addr);   /* 供 Electron / 脚本解析最终地址 */
    console.log('\n  ╔════════════════════════════════════════╗');
    console.log('  ║   极简业务工作台 · 服务已启动          ║');
    console.log('  ╚════════════════════════════════════════╝\n');
    console.log('  请在浏览器打开： ' + addr + '\n');
    console.log('  网易云音乐、哔哩哔哩功能需通过此地址访问才生效');
    console.log('  关闭此窗口即停止服务（数据不会丢失）\n');
    if (!process.env.NO_OPEN) {
      const open = process.platform === 'win32' ? `start "" "${addr}"` : process.platform === 'darwin' ? `open "${addr}"` : `xdg-open "${addr}"`;
      require('child_process').exec(open, () => { });
    }
  });
}

/* 导出给 Vercel Serverless 复用：api/index.js 会 require 本文件 */
module.exports = { route, createServer };
