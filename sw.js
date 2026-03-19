// StockAI Service Worker
const CACHE_NAME = 'stockai-v28';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.json'
];

// 설치 시 정적 자산 캐시
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 이전 캐시 정리
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// fetch 전략:
//   - /api/* → 네트워크 우선 (항상 최신 데이터)
//   - 그 외   → 캐시 우선 → 없으면 네트워크
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API & 외부 CDN은 네트워크만
  if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // 정적 자산: 캐시 우선
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      });
    })
  );
});
