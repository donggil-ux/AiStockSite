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
import { handleSubscribe, handleCreateAlert, handleListAlerts, handleDeleteAlert, handlePushTest, handleSyncFavs } from './routes/push.js';
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
    ['POST',   '/api/push/price-alert',  handleCreateAlert],
    ['GET',    '/api/push/price-alert',  handleListAlerts],
    ['DELETE', '/api/push/price-alert/:id', handleDeleteAlert],
    ['POST',   '/api/push/test',         handlePushTest],
    ['POST',   '/api/push/favs',         handleSyncFavs],
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
        //   "*/5 * * * *" → checkPriceAlerts + analyzeSignals (병렬)
        //   "0 0 * * 1-5" → earningsReminder (KST 09시 = UTC 00시 평일)
        const cron = event.cron;
        if (cron === '*/5 * * * *') {
            // 5분마다 두 작업 병렬 실행
            ctx.waitUntil(Promise.all([
                checkPriceAlerts(env).then(r => console.log('[cron] price', r)),
                analyzeSignals(env).then(r => console.log('[cron] signal', r)),
            ]));
        } else if (cron === '0 0 * * 1-5') {
            ctx.waitUntil(earningsReminder(env).then(r => console.log('[cron] earnings', r)));
        }
    },
};
