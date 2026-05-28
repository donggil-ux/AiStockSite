// StockAI Service Worker
// 전략:
//   - HTML / CSS / JS: 네트워크 우선 (새 배포 즉시 반영)
//   - 이미지/아이콘/폰트: 캐시 우선
//   - /api/chart|quote|price|summary: stale-while-revalidate (오프라인 시 최후의 캐시)
//   - /api/* 기타: 네트워크만 (항상 최신)
//   - 새 SW 는 waiting 대기 → 사용자가 '새로고침' 토스트 클릭 시에만 활성화

const CACHE_NAME = 'stockai-v972';
const API_CACHE = 'stockai-api-v972';
// API 캐시 최대 항목 수 (Quota 보호) — LRU 방식
const API_CACHE_MAX = 80;

// Workers 백엔드 도메인 (origin 다르므로 별도 매칭)
const WORKERS_HOST = 'stockai-api.rkd687.workers.dev';

const STATIC_ASSETS = [
  '/icon.svg',
  '/manifest.json',
  '/css/components.css',
  '/js/state.js',
  '/js/auth.js',
  '/js/utils.js',
  '/js/components/tab-state.js',
  '/js/api.js',
  '/js/chart-core.js',
  '/js/chart-toolbar.js',
  '/js/chart-nav.js',
  '/js/chart-interaction.js',
  '/js/chart-multi.js',
  '/js/chart-sync.js',
  '/js/chart-mobile.js',
  '/js/tabs.js',
  '/js/alpha-home.js',
  '/js/app.js',
];

self.addEventListener('install', e => {
  // skipWaiting은 여기서 호출하지 않음 — 사용자가 토스트 클릭 시 SKIP_WAITING 메시지로만 활성화
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(()=>{}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 이전 캐시 모두 삭제 (정적 + API 캐시 둘 다 — 현재 버전만 유지)
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME && k !== API_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// SKIP_WAITING 메시지 (이전 버전 호환)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── 푸시 알림 수신 ─────────────────────────────────────────────
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data?.json() || {}; } catch(err) { d = { title: 'StockAI', body: e.data?.text() || '' }; }
  e.waitUntil((async () => {
    // 알림 표시
    await self.registration.showNotification(d.title || 'StockAI', {
      body: d.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: d.url || '/', signalId: d.signalId || null },
      tag: d.tag || 'stockai',
      renotify: true,
      requireInteraction: false,
    });
    // 열려있는 모든 클라이언트에 푸시 정보 전달 (signalId 포함 → 피드백 가능)
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const msg = {
        type: 'LAST_PUSH_TS',
        ts: Date.now(),
        signalId: d.signalId || null,
        title: d.title || '',
        body: d.body || '',
        tag: d.tag || '',
        url: d.url || '/',
      };
      clients.forEach(c => c.postMessage(msg));
    } catch(_) {}
  })());
});

// ── 알림 클릭 → 해당 페이지로 이동 ───────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const existing = wins.find(w => w.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(target); }
      else clients.openWindow(target);
    })
  );
});

// ── API 캐시 LRU 트림 (백그라운드 비동기) ───────────────────
async function trimApiCache() {
  try {
    const cache = await caches.open(API_CACHE);
    const keys = await cache.keys();
    if (keys.length <= API_CACHE_MAX) return;
    // 오래된 항목부터 삭제 (Cache API 는 삽입 순 — 첫 항목이 가장 오래됨)
    const toDelete = keys.length - API_CACHE_MAX;
    for (let i = 0; i < toDelete; i++) await cache.delete(keys[i]);
  } catch (_) {}
}

// stale-while-revalidate: 캐시 즉시 반환, 백그라운드에서 갱신.
//   - 캐시 있고 fresh(<5분): 캐시만 반환, 갱신 안 함
//   - 캐시 있고 stale: 캐시 반환 + 백그라운드 갱신
//   - 캐시 없음: 네트워크 대기 (실패 시 throw)
//   - 응답에 X-Cached-At 헤더로 캐시 시각 주입 → 클라이언트가 "오래된 데이터" 표시 가능
const SWR_FRESH_TTL = 5 * 60 * 1000; // 5분
async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);
  const cachedAtStr = cached?.headers.get('X-Cached-At');
  const cachedAt = cachedAtStr ? parseInt(cachedAtStr, 10) : 0;
  const isFresh = cached && (Date.now() - cachedAt) < SWR_FRESH_TTL;

  const fetchAndCache = async () => {
    try {
      const net = await fetch(request);
      if (net && net.ok && request.method === 'GET') {
        // 응답에 캐시 시각 헤더 추가 (재구성 필요)
        const blob = await net.clone().blob();
        const h = new Headers(net.headers);
        h.set('X-Cached-At', String(Date.now()));
        h.set('X-From-Cache', 'no');
        const stamped = new Response(blob, { status: net.status, statusText: net.statusText, headers: h });
        await cache.put(request, stamped.clone());
        trimApiCache(); // fire-and-forget
        return stamped;
      }
      return net;
    } catch (err) {
      // 네트워크 실패 — 캐시가 있으면 그것이라도, 없으면 throw
      if (cached) {
        const h = new Headers(cached.headers);
        h.set('X-From-Cache', 'offline');
        const body = await cached.clone().blob();
        return new Response(body, { status: cached.status, statusText: cached.statusText, headers: h });
      }
      throw err;
    }
  };

  if (cached && isFresh) {
    // 5분 이내 — 캐시만 반환 (네트워크 호출 0회)
    const h = new Headers(cached.headers);
    h.set('X-From-Cache', 'fresh');
    const body = await cached.clone().blob();
    return new Response(body, { status: cached.status, statusText: cached.statusText, headers: h });
  }
  if (cached) {
    // stale 캐시 — 즉시 반환 + 백그라운드 갱신
    fetchAndCache().catch(()=>{});
    const h = new Headers(cached.headers);
    h.set('X-From-Cache', 'stale');
    const body = await cached.clone().blob();
    return new Response(body, { status: cached.status, statusText: cached.statusText, headers: h });
  }
  // 캐시 없음 — 네트워크 대기
  return fetchAndCache();
}

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

// 차트 데이터 API 패턴 — stale-while-revalidate 대상
const SWR_PATTERNS = [
  /\/api\/chart\//,
  /\/api\/quote(\?|$)/,
  /\/api\/price\//,
  /\/api\/summary\//,
  /\/api\/polygon\/candles/,
];
function isSwrApi(pathname) {
  return SWR_PATTERNS.some(rx => rx.test(pathname));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Workers 백엔드 — 차트 데이터는 SWR, 나머지는 네트워크 전용
  if (url.hostname === WORKERS_HOST) {
    if (isSwrApi(url.pathname)) {
      e.respondWith(staleWhileRevalidate(req));
      return;
    }
    // 그 외 Workers API — SW 개입 안 함 (push/admin/stats 등)
    return;
  }

  // 외부 도메인: 기본 fetch (SW 개입 안 함)
  if (url.hostname !== self.location.hostname) return;

  // 같은 origin 의 /api/ — SWR 패턴이면 SWR (Vercel 환경에서 사용 가능)
  if (url.pathname.startsWith('/api/')) {
    if (isSwrApi(url.pathname)) {
      e.respondWith(staleWhileRevalidate(req));
      return;
    }
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
