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
import { handleSignalStats, handleBacktest } from './routes/stats.js';
import { handleSignalFeedback, handleGetSignalFeedback } from './routes/feedback.js';
import { handleReportError, handleListErrors } from './routes/errors.js';
import { handleTranslate } from './routes/translate.js';
import { handleNewsReason } from './routes/news-reason.js';
import { handleEarningsSummary } from './routes/earnings.js';
import { handleCalibrationStatus, handleCalibrateNow } from './routes/calibration.js';
import { calibrateAlgorithm } from './utils/calibration.js';
import { logError, pruneOldErrors } from './utils/errors.js';
import { snapshotHealth } from './cron.js';
import { handleAdminStatus } from './routes/admin.js';
import { checkPriceAlerts, earningsReminder, analyzeSignals, resolveSignals } from './cron.js';
import { json, err } from './utils/validators.js';

// CORS — 환경변수 ALLOWED_ORIGINS (콤마 구분) 에 등록된 origin 만 허용.
// 미설정 시 와일드카드 (개발 편의) — 운영에서는 반드시 설정 권장.
const CORS_BASE = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Admin-Token',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
};

function resolveAllowedOrigin(req, env) {
    const reqOrigin = req.headers.get('Origin') || '';
    const allowList = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowList.length) return '*'; // 미설정 시 와일드카드 (운영에선 설정 권장)
    // 정확 일치 또는 와일드카드 *.example.com
    for (const pat of allowList) {
        if (pat === reqOrigin) return reqOrigin;
        if (pat.startsWith('*.')) {
            const suf = pat.slice(1); // ".example.com"
            if (reqOrigin.endsWith(suf)) return reqOrigin;
        }
    }
    // 매칭 실패 — 첫번째 등록 origin 으로 반환 (preflight 통과용)
    return allowList[0];
}

function withCors(res, req, env) {
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_BASE)) h.set(k, v);
    h.set('Access-Control-Allow-Origin', resolveAllowedOrigin(req, env));
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
    ['GET',    '/api/stats/backtest',    handleBacktest],
    ['POST',   '/api/signals/:id/feedback', handleSignalFeedback],
    ['GET',    '/api/signals/:id/feedback', handleGetSignalFeedback],
    ['GET',    '/api/admin/status',      handleAdminStatus],
    ['POST',   '/api/errors',            handleReportError],
    ['GET',    '/api/admin/errors',      handleListErrors],
    ['GET',    '/api/translate',         handleTranslate],
    ['GET',    '/api/news-reason',       handleNewsReason],
    ['GET',    '/api/earnings-summary',  handleEarningsSummary],
    ['GET',    '/api/calibration/status', handleCalibrationStatus],
    ['POST',   '/api/admin/calibrate',    handleCalibrateNow],
];

export default {
    async fetch(req, env, ctx) {
        // CORS Preflight
        if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), req, env);

        const url = new URL(req.url);
        try {
            for (const [method, pattern, handler] of ROUTES) {
                const params = matchRoute(req.method, url.pathname, pattern, [method]);
                if (params) {
                    const res = await handler(req, env, params);
                    return withCors(res, req, env);
                }
            }
            return withCors(err(404, 'route not found'), req, env);
        } catch (e) {
            console.error('[fetch]', e.stack || e.message);
            // 자체 에러 추적 — fail-safe 로 wrapper 적용
            ctx.waitUntil(logError(env, {
                source: 'worker',
                severity: 'error',
                message: e.message || 'fetch error',
                stack: e.stack,
                context: { route: url.pathname, method: req.method },
            }));
            return withCors(err(500, e.message), req, env);
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
        // 매시 :30 — 시그널 결과 매칭 (정확도 추적용)
        if (cron === '30 * * * *') {
            ctx.waitUntil(resolveSignals(env).then(r => console.log('[cron] resolve', r)));
        }
        // 매일 00:05 — 일별 헬스 스냅샷 + 30일+ 에러 정리 + (일요일이면) 알고리즘 자동 보정
        if (cron === '5 0 * * *') {
            const tasks = [
                snapshotHealth(env).then(r => console.log('[cron] health', r)),
                pruneOldErrors(env).then(r => console.log('[cron] prune', r)),
            ];
            // 일요일 (getUTCDay === 0) 이면 알고리즘 보정도 함께 실행
            if (new Date(event.scheduledTime || Date.now()).getUTCDay() === 0) {
                tasks.push(calibrateAlgorithm(env).then(r => console.log('[cron] calibrate', r)));
            }
            ctx.waitUntil(Promise.all(tasks));
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
