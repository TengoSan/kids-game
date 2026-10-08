const CACHE_NAME = 'yubin-map-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './data/municipalities.json',
  'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
  'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // 郵便番号の検索結果は毎回ネットから取る（キャッシュしない）
  if (e.request.url.includes('zipcloud.ibsnet.co.jp')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
