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
import { handleScannerAiAnalyze, handleSwingAiAnalyze } from './routes/ai-scanner.js';
import { handleScannerAiBatch, handleSocialAiAnalyze } from './routes/ai-batch-social.js';
import { handleCatalystAiAnalyze } from './routes/ai-catalyst.js';
import { calibrateAlgorithm } from './utils/calibration.js';
import { paperAutoOptimize } from './utils/paper-optimizer.js';
import { paperManageAll } from './utils/paper-engine.js';
import { logError, pruneOldErrors } from './utils/errors.js';
import { snapshotHealth } from './cron.js';
import { handleAdminStatus, handleAnalyzeNow, handleDtForwardTest, handleCatForwardTest } from './routes/admin.js';
import { handleDailyTradingScan, handleDailyBacktest, handleDailyLiveStats, captureDailySignals, resolveDailySignals, sendDailyHealthSummary } from './routes/daily-scanner.js';
import { handlePaperTrading } from './routes/paper-trading.js';
import { handleTgWebhook } from './routes/tg-commands.js';
import { handleCatalystLiveStats, captureCatalystSignals, resolveCatalystSignals } from './routes/catalyst-track.js';
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
    ['POST',   '/api/admin/analyze-now',  handleAnalyzeNow],
    ['POST',   '/api/admin/dt-forwardtest', handleDtForwardTest],
    ['POST',   '/api/admin/cat-forwardtest', handleCatForwardTest],
    ['GET',    '/api/scanner/daily-trading', handleDailyTradingScan],
    ['GET',    '/api/scanner/daily-backtest', handleDailyBacktest],
    ['GET',    '/api/scanner/daily-livestats', handleDailyLiveStats],
    ['GET',    '/api/catalyst/livestats', handleCatalystLiveStats],
    ['POST',   '/api/scanner/ai-analyze', handleScannerAiAnalyze],
    ['POST',   '/api/scanner/ai-batch',   handleScannerAiBatch],
    ['POST',   '/api/swing/ai-analyze',   handleSwingAiAnalyze],
    ['POST',   '/api/social/ai-analyze',  handleSocialAiAnalyze],
    ['POST',   '/api/catalyst/ai-analyze', handleCatalystAiAnalyze],
    // 가상 매매
    ['GET',    '/api/paper/account',        handlePaperTrading],
    ['GET',    '/api/paper/trades',         handlePaperTrading],
    ['GET',    '/api/paper/fills',          handlePaperTrading],
    ['GET',    '/api/paper/fills/:id',      handlePaperTrading],
    ['POST',   '/api/paper/close/:id',      handlePaperTrading],
    ['POST',   '/api/paper/reset',          handlePaperTrading],
    // Telegram 봇 웹훅 (수동 매수/매도 명령)
    ['POST',   '/api/tg-webhook',           handleTgWebhook],
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
        // 매시 :30 — 시그널 결과 매칭 + 데일리 forward-test 해소 + 카탈리스트 캡처(미국 시간대)
        if (cron === '30 * * * *') {
            const jobs = [
                resolveSignals(env).then(r => console.log('[cron] resolve', r)),
                resolveDailySignals(env).then(r => console.log('[cron] dt-resolve', r)),
            ];
            // 미국 프리장~본장(UTC 11~21시)에만 카탈리스트 신호 캡처 (종목당 1일 1회)
            const h = new Date(event.scheduledTime || Date.now()).getUTCHours();
            if (h >= 11 && h <= 21) jobs.push(captureCatalystSignals(env).then(r => console.log('[cron] cat-capture', r)));
            ctx.waitUntil(Promise.all(jobs));
        }
        // 매일 00:05 — 일별 헬스 스냅샷 + 30일+ 에러 정리 + (일요일이면) 알고리즘 자동 보정
        if (cron === '5 0 * * *') {
            const tasks = [
                snapshotHealth(env).then(r => console.log('[cron] health', r)),
                pruneOldErrors(env).then(r => console.log('[cron] prune', r)),
                // 데일리 트레이딩 트레일링 백테스트 갱신 — 스캐너 실측 승률 최신 유지
                (async () => {
                    for (const tf of ['5m', '1d']) {
                        try { await handleDailyBacktest(new Request(`https://x/api/scanner/daily-backtest?tf=${tf}&exit=trail&skipmid=1&force=1`), env); } catch (_) {}
                    }
                })().then(() => console.log('[cron] backtest refreshed')),
                // dt_signals 정리 — 180일+ 청산 신호 삭제 (테이블 무한증가 방지)
                env.DB.prepare('DELETE FROM dt_signals WHERE resolved=1 AND resolved_at < ?')
                    .bind(Date.now() - 180 * 24 * 3600 * 1000).run()
                    .then(r => console.log('[cron] dt-prune', r?.meta?.changes ?? 0)).catch(() => {}),
                // 카탈리스트 forward-test 해소 (1일/3일 수익률) + 180일+ 정리
                resolveCatalystSignals(env).then(r => console.log('[cron] cat-resolve', r)).catch(() => {}),
                env.DB.prepare('DELETE FROM catalyst_signals WHERE resolved=1 AND resolved_at < ?')
                    .bind(Date.now() - 180 * 24 * 3600 * 1000).run()
                    .then(r => console.log('[cron] cat-prune', r?.meta?.changes ?? 0)).catch(() => {}),
            ];
            // 일요일 (getUTCDay === 0) 이면 알고리즘 보정도 함께 실행
            if (new Date(event.scheduledTime || Date.now()).getUTCDay() === 0) {
                tasks.push(calibrateAlgorithm(env).then(r => console.log('[cron] calibrate', r)));
                tasks.push(paperAutoOptimize(env).then(r => console.log('[cron] paper-optimize', r?.params)).catch(e => console.error('[cron] paper-optimize err', e.message)));
            }
            ctx.waitUntil(Promise.all(tasks));
        }
        // 5분마다 (시장 시간) 시그널 분석 + 가격 알림
        // 가상매매(캡처+포지션관리)를 먼저 순차 실행 — Workers subrequest 한도를 실거래 관련
        // 작업이 먼저 확보하도록 함. 그 뒤 일반 스캔(알림용, 우선순위 낮음)을 실행.
        // 병렬로 다 같이 돌리면 50종목 스캔이 한도를 다 써버려 가상매매 진입이 조용히 막힘.
        if (cron === '*/5 8-21 * * 1-5' || cron === '*/5 0-6 * * 1-5') {
            const market = cron.startsWith('*/5 8') ? 'US' : 'KR';
            ctx.waitUntil((async () => {
                if (market === 'US') {
                    try { console.log('[cron] dt-capture', await captureDailySignals(env)); }
                    catch (e) { console.error('[cron] dt-capture err', e.message); }
                    try { await paperManageAll(env); console.log('[cron] paper-manage done'); }
                    catch (e) { console.error('[cron] paper-manage err', e.message); }
                }
                try { console.log(`[cron] ${market} price`, await checkPriceAlerts(env)); }
                catch (e) { console.error('[cron] price err', e.message); }
                try { console.log(`[cron] ${market} signal`, await analyzeSignals(env, market)); }
                catch (e) { console.error('[cron] signal err', e.message); }

                // 미국 정규장 마감 직후(이 cron의 마지막 틱, UTC 21:55) — 일일 리포트 발송
                // 신규 cron 트리거 추가 없이(플랜당 5개 한도) 기존 5분 주기의 특정 틱에서 실행
                if (market === 'US') {
                    const d = new Date(event.scheduledTime || Date.now());
                    if (d.getUTCHours() === 21 && d.getUTCMinutes() >= 55) {
                        try { await sendDailyHealthSummary(env); console.log('[cron] daily-health done'); }
                        catch (e) { console.error('[cron] daily-health err', e.message); }
                    }
                }
            })());
        }
    },
};
