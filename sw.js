// StockAI Service Worker
// 전략:
//   - HTML / CSS / JS: 네트워크 우선 (새 배포 즉시 반영)
//   - 이미지/아이콘/폰트: 캐시 우선
//   - /api/*: 네트워크만 (항상 최신)
//   - skipWaiting + clients.claim: 새 SW 즉시 활성화 → 사용자 확인 불필요
const CACHE_NAME = 'stockai-v89';

const STATIC_ASSETS = [
  '/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', e => {
  self.skipWaiting(); // 새 버전 즉시 활성화
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(()=>{}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 이전 캐시 모두 삭제
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    // 모든 클라이언트에 새 버전 알림 → 필요 시 자동 리로드 가능
    const clients = await self.clients.matchAll({type:'window'});
    clients.forEach(c => c.postMessage({type:'SW_UPDATED', version: CACHE_NAME}));
  })());
});

// SKIP_WAITING 메시지 (이전 버전 호환)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// 네트워크 우선(실패 시 캐시), HTML/CSS/JS 용
async function networkFirst(request) {
  try {
    const net = await fetch(request);
    if (net && net.ok && request.method === 'GET') {
      const clone = net.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(()=>{});
    }
    return net;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

// 캐시 우선(실패/미스 시 네트워크), 이미지/폰트 용
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const net = await fetch(request);
  if (net && net.ok && request.method === 'GET') {
    const clone = net.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(()=>{});
  }
  return net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 외부 도메인: 기본 fetch (SW 개입 안 함)
  if (url.hostname !== self.location.hostname) return;

  // API: 항상 네트워크 (실패 시만 캐시 fallback)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // HTML / CSS / JS / JSON: 네트워크 우선 (새 배포 즉시 반영)
  const dest = req.destination;
  const isDocLike = dest === 'document' || dest === 'style' || dest === 'script' || dest === '' ||
                    url.pathname.endsWith('.html') || url.pathname.endsWith('.css') ||
                    url.pathname.endsWith('.js')   || url.pathname.endsWith('.json') ||
                    url.pathname === '/';
  if (isDocLike) {
    e.respondWith(networkFirst(req));
    return;
  }

  // 나머지(이미지/폰트/아이콘 등): 캐시 우선
  e.respondWith(cacheFirst(req));
});
