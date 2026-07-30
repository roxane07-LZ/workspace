/* 极简业务工作台 · Service Worker
   作用：缓存应用外壳，使 PWA 可离线打开、可"添加到主屏幕"安装。
   注意：音乐/B站等需要代理的功能仍依赖网络，离线时不可用。 */
const CACHE = 'wb-v1';
const SHELL = ['./', './极简业务工作台.html', './manifest.webmanifest', './icon.svg', './sync-config.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 不缓存跨域 API / 代理 / Supabase，走网络优先
  if (url.origin !== location.origin) { e.respondWith(fetch(req).catch(() => caches.match('./'))); return; }
  // 同源应用资源：缓存优先，同时后台更新
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
