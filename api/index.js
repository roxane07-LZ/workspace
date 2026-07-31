/* ============================================================







 * Vercel Serverless Function · 完全自包含版







 * 内嵌网易云音乐 + 哔哩哔哩代理逻辑，不依赖任何外部文件，







 * 首页 / 自动 302 到仓库里的静态 HTML，避免读云上不存在的本地文件。







 * 用法：直接把本文件放到仓库 api/ 目录即可，Vercel 自动部署。







 * ============================================================ */







'use strict';















const http = require('http');







const https = require('https');















const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';







const NE_HEAD = { 'User-Agent': UA, Referer: 'https://music.163.com/', Origin: 'https://music.163.com', Cookie: 'appver=8.7.01; os=pc' };







let biliCookie = '';















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















/* ---------- Supabase 代理：客户端只连同源 vercel.app，由 Vercel 服务端连 supabase.co ---------- */







const SB_ORIGIN = 'https://toyiugcylrxtvspgblcf.supabase.co';



const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRveWl1cWN5bHJ4dHZzcGdibGNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NzEyMzEsImV4cCI6MjEwMTA0NzIzMX0.Qenww2lEZFJLMxhlOCdFyv179ujAjWhtMQ6h8iqBY60';







async function sbProxy(req, res, target) {







  try {







    const method = req.method || 'GET';







    let body;







    if (method !== 'GET' && method !== 'HEAD') {







      const chunks = [];







      for await (const ch of req) chunks.push(ch);







      body = Buffer.concat(chunks);







    }







    const pass = {};



    for (const k of ['authorization','apikey','content-type','accept','prefer','x-client-info']) {



      const v = req.headers[k];



      if (v) pass[k] = Array.isArray(v) ? v[0] : v;



    }



    pass['user-agent'] = UA;



    const ctrl = new AbortController();



    const timer = setTimeout(() => ctrl.abort(), 12000);



    const upstream = await fetch(target, { method, headers: pass, body, redirect: 'follow', signal: ctrl.signal });



    clearTimeout(timer);







    const buf = Buffer.from(await upstream.arrayBuffer());







    const out = { 'Access-Control-Allow-Origin': '*' };







    const ct = upstream.headers.get('content-type'); if (ct) out['content-type'] = ct;







    const cl = upstream.headers.get('content-length'); if (cl) out['content-length'] = cl;







    res.writeHead(upstream.status, out);







    res.end(buf);







  } catch (e) {







    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });







    res.end('sb proxy error: ' + (e && e.message ? e.message : e));







  }







}















const BI_HEAD = () => ({ 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', Cookie: biliCookie });















/* ============================================================







 *  路由处理







 * ============================================================ */







async function route(req, res, u) {







  const p = u.pathname, q = u.searchParams;















  /* ========== 网易云音乐 ========== */







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















  if (p === '/api/ne/lyric') {







    const r = await fetchText(`https://music.163.com/api/song/lyric?id=${q.get('id')}&lv=-1&kv=-1&tv=-1`, { headers: NE_HEAD });







    const j = JSON.parse(r.body);







    return json(res, { ok: true, lyric: (j.lrc && j.lrc.lyric) || '', trans: (j.tlyric && j.tlyric.lyric) || '' });







  }















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







  if (p === '/api/bili/qr') {







    const r = await fetchText('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });







    const j = JSON.parse(r.body);







    if (j.code !== 0) return json(res, { ok: false, msg: j.message });







    return json(res, { ok: true, key: j.data.qrcode_key, url: j.data.url });







  }















  if (p === '/api/bili/poll') {







    const r = await fetchText('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(q.get('key') || ''),







      { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });







    const j = JSON.parse(r.body);







    const st = j.data ? j.data.code : -1;







    if (st === 0) {







      const sc = r.headers['set-cookie'] || [];







      const ck = sc.map(s => s.split(';')[0]).join('; ');







      if (ck) biliCookie = ck;







      return json(res, { ok: true, state: 'done', msg: '登录成功' });







    }







    const map = { 86101: '等待扫码', 86090: '已扫码，请在手机上确认', 86038: '二维码已失效，请刷新' };







    return json(res, { ok: true, state: st === 86038 ? 'expired' : 'wait', msg: map[st] || '等待中' });







  }















  if (p === '/api/bili/cookie') {







    const ck = q.get('v') || '';







    biliCookie = ck.includes('SESSDATA') ? ck : 'SESSDATA=' + ck;







    return json(res, { ok: true });







  }















  if (p === '/api/bili/logout') { biliCookie = ''; return json(res, { ok: true }); }















  if (p === '/api/bili/nav') {







    if (!biliCookie) return json(res, { ok: true, login: false });







    const r = await fetchText('https://api.bilibili.com/x/web-interface/nav', { headers: BI_HEAD() });







    const j = JSON.parse(r.body);







    if (j.code !== 0) return json(res, { ok: true, login: false });







    return json(res, { ok: true, login: true, mid: j.data.mid, name: j.data.uname, face: j.data.face, level: j.data.level_info && j.data.level_info.current_level });







  }















  if (p === '/api/bili/folders') {







    const mid = q.get('mid');







    if (!mid) return json(res, { ok: false, msg: '缺少 mid，请先登录' });







    const r = await fetchText(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`, { headers: BI_HEAD() });







    const j = JSON.parse(r.body);







    if (j.code !== 0) return json(res, { ok: false, msg: j.message });







    return json(res, { ok: true, list: (j.data && j.data.list || []).map(f => ({ id: f.id, title: f.title, count: f.media_count })) });







  }















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















  if (p === '/api/bili/video') {







    const r = await fetchText('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(q.get('bvid') || ''), { headers: BI_HEAD() });







    const j = JSON.parse(r.body);







    if (j.code !== 0) return json(res, { ok: false, msg: j.message });







    return json(res, { ok: true, bvid: j.data.bvid, title: j.data.title, cover: j.data.pic, up: j.data.owner && j.data.owner.name, dur: j.data.duration });







  }















  /* ========== 通用代理 ========== */







  if (p === '/api/img') {







    let t = q.get('url') || '';







    if (t.startsWith('//')) t = 'https:' + t;







    if (!/^https?:\/\//.test(t)) {







      res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'max-age=86400' });







      return res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));







    }







    const ref = t.includes('hdslb.com') ? 'https://www.bilibili.com/' : 'https://music.163.com/';







    return pipeProxy(t, req, res, { Referer: ref });







  }















  if (p === '/api/stream') {







    const t = q.get('url'); if (!t) { res.writeHead(400); return res.end(); }







    return pipeProxy(t, req, res, {});







  }















  /* ========== Supabase 代理（绕过大陆直连 supabase.co 被墙） ========== */







  if (p === '/api/sb-diagnose') {







    const results = { ts: Date.now(), steps: [] };







    const add = (name, ok, info) => results.steps.push({ name, ok, info });







    try {







      const ctrl1 = new AbortController();







      const t1 = setTimeout(() => ctrl1.abort(), 12000);







      await fetch('https://workspace-eight-roan.vercel.app/api/ping', { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl1.signal });







      clearTimeout(t1);







      add('self_ping', true, 'vercel function can reach itself');







    } catch (e) { add('self_ping', false, (e && e.message) || String(e)); }







    try {







      const ctrl2 = new AbortController();







      const t2 = setTimeout(() => ctrl2.abort(), 12000);







      const r = await fetch('https://httpbin.org/get', { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl2.signal });







      clearTimeout(t2);







      add('public_internet', r.ok, 'status ' + r.status);







    } catch (e) { add('public_internet', false, (e && e.message) || String(e)); }







    try {







      const ctrl3 = new AbortController();







      const t3 = setTimeout(() => ctrl3.abort(), 15000);







      const r = await fetch(SB_ORIGIN + '/auth/v1/settings', { headers: { 'user-agent': UA, apikey: SB_ANON, accept: 'application/json' }, signal: ctrl3.signal });







      clearTimeout(t3);







      const txt = await r.text();







      add('supabase_settings', r.ok, 'status ' + r.status + ' ' + txt.slice(0, 200));







    } catch (e) {







      let detail = (e && e.message) || String(e);







      if (e && e.cause && e.cause.message) detail += ' | cause: ' + e.cause.message;







      if (e && e.cause && e.cause.code) detail += ' (' + e.cause.code + ')';







      add('supabase_settings', false, detail);







    }







    return json(res, results);







  }













  if (p === '/api/sb' || p.startsWith('/api/sb/')) {







    const rest = (p.slice('/api/sb'.length) || '/');







    const target = SB_ORIGIN + rest + (u.search || '');







    return sbProxy(req, res, target);







  }















  if (p === '/api/ping') return json(res, { ok: true, ver: 1, bili: !!biliCookie });















  return json(res, { ok: false, msg: 'not found: ' + p }, 404);







}















/* ============================================================







 *  入口







 * ============================================================ */







module.exports = async (req, res) => {







  const u = new URL(req.url, 'http://localhost');







  // 非 /api/ 的请求（即浏览器打开首页）：自动跳转到仓库里的静态 HTML







  if (!u.pathname.startsWith('/api/')) {







    res.writeHead(302, { Location: '/%E6%9E%81%E7%AE%80%E4%B8%9A%E5%8A%A1%E5%B7%A5%E4%BD%9C%E5%8F%B0.html' });







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






