// StockAI Service Worker
const CACHE_NAME = 'stockai-v68';

// 클라이언트가 '새로고침' 버튼을 누르면 SKIP_WAITING 메시지 수신 → 즉시 활성화
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/icon.svg',
  '/manifest.json'
];

// 설치 시 정적 자산 캐시 (skipWaiting 은 클라이언트 메시지 수신 후 호출 — 사용자 확인 없이 탭이 리로드되는 것을 방지)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
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
