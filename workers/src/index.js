// StockAI Workers — 메인 fetch + scheduled 핸들러
//
// Routes:
//   GET    /api/chart/:symbol
//   GET    /api/quote
//   GET    /api/price/:symbol
//   GET    /api/summary/:symbol
//   GET    /api/search
//   GET    /api/polygon/candles
//   POST   /api/push/subscribe
//   POST   /api/push/price-alert
//   GET    /api/push/price-alert
//   DELETE /api/push/price-alert/:id
//   POST   /api/push/test
//   GET    /api/health

import { handleChart, handleQuote, handlePrice, handleSummary, handleSearch } from './routes/yahoo.js';
import { handlePolygonCandles } from './routes/polygon.js';
import { handleSubscribe, handleCreateAlert, handleListAlerts, handleDeleteAlert, handlePushTest, handleSyncFavs, handleSyncPrefs, handleLinkAccount } from './routes/push.js';
import { handleSignalStats } from './routes/stats.js';
import { handleAdminStatus } from './routes/admin.js';
import { checkPriceAlerts, earningsReminder, analyzeSignals } from './cron.js';
import { json, err } from './utils/validators.js';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age':       '86400',
};

function withCors(res) {
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// 간단한 라우팅 매처 — /api/chart/:symbol 같은 path param 지원
function matchRoute(method, pathname, pattern, methods) {
    if (!methods.includes(method)) return null;
    const patParts = pattern.split('/').filter(Boolean);
    const pthParts = pathname.split('/').filter(Boolean);
    if (patParts.length !== pthParts.length) return null;
    const params = {};
    for (let i = 0; i < patParts.length; i++) {
        if (patParts[i].startsWith(':')) {
            params[patParts[i].slice(1)] = decodeURIComponent(pthParts[i]);
        } else if (patParts[i] !== pthParts[i]) {
            return null;
        }
    }
    return params;
}

const ROUTES = [
    ['GET',    '/api/health',            (req, env) => json({ ok: true, ts: Date.now() })],
    ['GET',    '/api/chart/:symbol',     handleChart],
    ['GET',    '/api/quote',             handleQuote],
    ['GET',    '/api/price/:symbol',     handlePrice],
    ['GET',    '/api/summary/:symbol',   handleSummary],
    ['GET',    '/api/search',            handleSearch],
    ['GET',    '/api/polygon/candles',   handlePolygonCandles],
    ['POST',   '/api/push/subscribe',    handleSubscribe],
    ['POST',   '/api/push/link',         handleLinkAccount],
    ['POST',   '/api/push/price-alert',  handleCreateAlert],
    ['GET',    '/api/push/price-alert',  handleListAlerts],
    ['DELETE', '/api/push/price-alert/:id', handleDeleteAlert],
    ['POST',   '/api/push/test',         handlePushTest],
    ['POST',   '/api/push/favs',         handleSyncFavs],
    ['POST',   '/api/push/prefs',        handleSyncPrefs],
    ['GET',    '/api/stats/signals',     handleSignalStats],
    ['GET',    '/api/admin/status',      handleAdminStatus],
];

export default {
    async fetch(req, env, ctx) {
        // CORS Preflight
        if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

        const url = new URL(req.url);
        try {
            for (const [method, pattern, handler] of ROUTES) {
                const params = matchRoute(req.method, url.pathname, pattern, [method]);
                if (params) {
                    const res = await handler(req, env, params);
                    return withCors(res);
                }
            }
            return withCors(err(404, 'route not found'));
        } catch (e) {
            console.error('[fetch]', e.stack || e.message);
            return withCors(err(500, e.message));
        }
    },

    async scheduled(event, env, ctx) {
        // wrangler.toml [triggers] crons:
        //   "*/5 13-21 * * 1-5" → 미국 정규장 시그널 + 가격 알림
        //   "*/5 0-6  * * 1-5"  → 한국 정규장 시그널 + 가격 알림
        //   "0 0 * * 1-5"       → 실적 리마인더 (평일 KST 09시 = UTC 00시)
        const cron = event.cron;
        if (cron === '0 0 * * 1-5') {
            // 09시 실적 리마인더만 (00시 한국 시그널 cron 과 충돌 방지 — 동시에 fire)
            ctx.waitUntil(earningsReminder(env).then(r => console.log('[cron] earnings', r)));
        }
        // 5분마다 (시장 시간) 시그널 분석 + 가격 알림 병렬 실행
        if (cron === '*/5 13-21 * * 1-5' || cron === '*/5 0-6 * * 1-5') {
            const market = cron.startsWith('*/5 13') ? 'US' : 'KR';
            ctx.waitUntil(Promise.all([
                checkPriceAlerts(env).then(r => console.log(`[cron] ${market} price`, r)),
                analyzeSignals(env, market).then(r => console.log(`[cron] ${market} signal`, r)),
            ]));
        }
    },
};
