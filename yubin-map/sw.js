const CACHE_NAME = 'yubin-map-v6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './data/municipalities.json',
  './data/zipindex.json',
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
  // 町データ（data/towns/上3桁.json）と町丁目の境界（data/shapes/市区町村コード.json）は
  // 使った分だけ保存して、次回からはオフラインでも使えるようにする
  if (e.request.url.includes('/data/towns/') || e.request.url.includes('/data/shapes/')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(c =>
        c.match(e.request).then(r => r || fetch(e.request).then(res => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }))
      )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
