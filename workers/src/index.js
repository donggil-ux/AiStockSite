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
import { paperAutoOptimize, paperHealthCheck, cronWatchdog } from './utils/paper-optimizer.js';
import { paperManageAll, _tgDirect } from './utils/paper-engine.js';
import { logError, pruneOldErrors } from './utils/errors.js';
import { snapshotHealth } from './cron.js';
import { handleAdminStatus, handleAnalyzeNow, handleDtForwardTest, handleCatForwardTest } from './routes/admin.js';
import { requireAdmin } from './utils/admin-auth.js';
import { handleDailyTradingScan, handleDailyBacktest, handleDailyLiveStats, captureDailySignals, resolveDailySignals, sendDailyHealthSummary, captureCloseBetSignals } from './routes/daily-scanner.js';
import { handlePaperTrading } from './routes/paper-trading.js';
import { handleTgWebhook } from './routes/tg-commands.js';
import { handleCatalystLiveStats, captureCatalystSignals, resolveCatalystSignals } from './routes/catalyst-track.js';
import { checkPriceAlerts, earningsReminder, analyzeSignals, resolveSignals } from './cron.js';
import { runDailyGrowthScan } from './utils/growth-scorer.js';
import { handleGrowthSectorHeat, handleGrowthRecommendations, handleGrowthCompany, handleGrowthScanNow } from './routes/growth.js';
import { handleHeatmap, handleHeatmapScanNow } from './routes/heatmap.js';
import { getStockHeatmap } from './utils/stock-heatmap.js';
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
    ['POST',   '/api/admin/run-five-min-job', handleRunFiveMinJob],
    ['GET',    '/api/scanner/daily-trading', handleDailyTradingScan],
    ['GET',    '/api/scanner/daily-backtest', handleDailyBacktest],
    ['GET',    '/api/scanner/daily-livestats', handleDailyLiveStats],
    ['GET',    '/api/catalyst/livestats', handleCatalystLiveStats],
    ['POST',   '/api/scanner/ai-analyze', handleScannerAiAnalyze],
    ['POST',   '/api/scanner/ai-batch',   handleScannerAiBatch],
    ['POST',   '/api/swing/ai-analyze',   handleSwingAiAnalyze],
    ['POST',   '/api/social/ai-analyze',  handleSocialAiAnalyze],
    ['POST',   '/api/catalyst/ai-analyze', handleCatalystAiAnalyze],
    // 성장주 발굴 (D1 읽기 전용)
    ['GET',    '/api/growth/sector-heat',     handleGrowthSectorHeat],
    ['GET',    '/api/growth/recommendations', handleGrowthRecommendations],
    ['GET',    '/api/growth/company/:symbol', handleGrowthCompany],
    ['POST',   '/api/admin/growth-scan-now',  handleGrowthScanNow],
    // 섹터 히트맵 (D1 읽기 전용)
    ['GET',    '/api/heatmap',                 handleHeatmap],
    ['POST',   '/api/admin/heatmap-scan-now',  handleHeatmapScanNow],
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
            // 5분 크론(*/5 8-21) 워치독 — 별개 트리거에서 그 크론의 생사를 감시
            jobs.push(cronWatchdog(env).then(r => console.log('[cron] watchdog', r)).catch(e => console.error('[cron] watchdog err', e.message)));
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
                // 성장주 발굴 레이어 — 섹터 히트(매일) + 종목 스크리닝(회전 배치, 독립 실패 격리)
                runDailyGrowthScan(env).then(r => console.log('[cron] growth-scan', r)).catch(e => console.error('[cron] growth-scan err', e.message)),
                env.DB.prepare('DELETE FROM growth_recommendations WHERE created_at < ?')
                    .bind(Date.now() - 180 * 24 * 3600 * 1000).run()
                    .then(r => console.log('[cron] growth-prune', r?.meta?.changes ?? 0)).catch(() => {}),
                // 섹터 히트맵 — 종목 레벨 시총/등락률 갱신 (배치 시세 조회, ~3회 요청)
                getStockHeatmap(env).then(r => console.log('[cron] stock-heatmap', r.length)).catch(e => console.error('[cron] stock-heatmap err', e.message)),
                env.DB.prepare('DELETE FROM stock_heatmap WHERE created_at < ?')
                    .bind(Date.now() - 30 * 24 * 3600 * 1000).run()
                    .then(r => console.log('[cron] heatmap-prune', r?.meta?.changes ?? 0)).catch(() => {}),
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
            ctx.waitUntil(runFiveMinJob(env, market, event.scheduledTime || Date.now()));
        }
    },
};

// NYSE/NASDAQ 휴장일 — 연도 넣으면 그 해의 관측일을 직접 계산 (매년 하드코딩 안 해도 됨).
// 토요일 낙일 → 전 금요일, 일요일 낙일 → 다음 월요일로 대체 관측 (미국 연방 공휴일 규칙).
// 부활절(Good Friday)만 계산이 필요해 Meeus/Jones/Butcher 알고리즘 사용.
function _usMarketHolidays(year) {
    const nthWeekday = (month, weekday, n) => {
        let d = new Date(Date.UTC(year, month, 1));
        let count = 0;
        while (true) {
            if (d.getUTCDay() === weekday) { count++; if (count === n) return d; }
            d.setUTCDate(d.getUTCDate() + 1);
        }
    };
    const lastWeekday = (month, weekday) => {
        let d = new Date(Date.UTC(year, month + 1, 0)); // 해당 월 마지막 날
        while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
        return d;
    };
    const easter = () => {
        const a = year % 19, b = Math.floor(year / 100), c = year % 100;
        const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(Date.UTC(year, month, day));
    };
    const observed = (d) => { // 연방 공휴일 대체관측 규칙
        const day = d.getUTCDay();
        if (day === 6) { const nd = new Date(d); nd.setUTCDate(nd.getUTCDate() - 1); return nd; }
        if (day === 0) { const nd = new Date(d); nd.setUTCDate(nd.getUTCDate() + 1); return nd; }
        return d;
    };
    const fmt = (d) => d.toISOString().slice(0, 10);
    const goodFriday = easter(); goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
    return new Set([
        fmt(observed(new Date(Date.UTC(year, 0, 1)))),  // 신정
        fmt(nthWeekday(0, 1, 3)),                        // MLK Day (1월 3번째 월)
        fmt(nthWeekday(1, 1, 3)),                        // 대통령의 날 (2월 3번째 월)
        fmt(goodFriday),                                 // 성금요일
        fmt(lastWeekday(4, 1)),                          // 메모리얼 데이 (5월 마지막 월)
        fmt(observed(new Date(Date.UTC(year, 5, 19)))),  // 준틴스
        fmt(observed(new Date(Date.UTC(year, 6, 4)))),   // 독립기념일
        fmt(nthWeekday(8, 1, 1)),                        // 노동절 (9월 1번째 월)
        fmt(nthWeekday(10, 4, 4)),                       // 추수감사절 (11월 4번째 목)
        fmt(observed(new Date(Date.UTC(year, 11, 25)))), // 크리스마스
    ]);
}

// 원래 Cloudflare 크론 문자열("*/5 8-21 * * 1-5" 등) 자체에 요일(1-5=월~금) 제한이 박혀있어서
// 코드가 요일을 따로 검사할 필요가 없었음. 그런데 외부 크론(cron-job.org)은 요일 제한 없이
// 매일 5분마다 호출하도록 설정돼 있어서, 주말/휴장일에도 이 함수가 그대로 실행되어 장 닫힌 날에
// 가상매매가 도는 문제가 있었음 — 코드 레벨에서 직접 요일·휴장일·시간대를 검사해 방어한다.
// (한국 증시 휴장일은 별도 캘린더가 필요해 아직 미반영 — 요일만 체크)
function _isMarketWindowOpen(market) {
    const now = new Date();
    const day = now.getUTCDay(); // 0=일, 6=토
    if (day === 0 || day === 6) return false; // 주말 전면 차단
    if (market === 'US') {
        const dateStr = now.toISOString().slice(0, 10);
        if (_usMarketHolidays(now.getUTCFullYear()).has(dateStr)) return false; // 미국 휴장일 차단
    }
    const h = now.getUTCHours();
    if (market === 'US') return h >= 8 && h <= 21;  // 미국 프리마켓+정규장 (UTC 08:00~21:55)
    if (market === 'KR') return h >= 0 && h <= 6;   // 한국 정규장 (UTC 00:00~06:55)
    return true;
}

// 5분 크론(*/5 8-21, */5 0-6)이 실제로 하는 일 — scheduled()와 /api/admin/run-five-min-job(외부 크론 우회용)이 공유
// Cloudflare Cron Triggers가 원인불명으로 발화를 멈추는 문제가 있어, 외부 크론 서비스(cron-job.org 등)가
// 이 함수를 도는 관리자 API를 5분마다 호출하는 방식으로도 동일하게 동작하도록 로직을 분리했다.
export async function runFiveMinJob(env, market, scheduledTime = Date.now()) {
    if (!_isMarketWindowOpen(market)) {
        console.log(`[cron] ${market} 장 시간 아님(주말/장외) — 스킵`);
        return { skipped: 'market_closed' };
    }
    // Cloudflare Cron Trigger와 외부 크론(cron-job.org)이 같은 5분 틱에 둘 다 호출하면
    // 가상매매/알림이 중복 실행돼 텔레그램 매매 메시지가 2번씩 나감 —
    // 직전 실행이 90초 이내면 같은 틱으로 보고 스킵 (paperHealthCheck 와 동일한 KV 게이트 패턴)
    if (env.CACHE) {
        const lockKey = `5min-lock:${market}`;
        const last = await env.CACHE.get(lockKey);
        if (last && scheduledTime - Number(last) < 90 * 1000) {
            console.log(`[cron] ${market} 5분틱 중복 호출 스킵 (직전 실행 ${scheduledTime - Number(last)}ms 전)`);
            return { skipped: 'duplicate_tick' };
        }
        await env.CACHE.put(lockKey, String(scheduledTime), { expirationTtl: 240 });
    }
    if (market === 'US') {
        try { console.log('[cron] dt-capture', await captureDailySignals(env)); }
        catch (e) {
            console.error('[cron] dt-capture err', e.message);
            try { await logError(env, { source: 'captureDailySignals', message: e.message, stack: e.stack }); } catch (_) {}
        }
        try { await paperManageAll(env); console.log('[cron] paper-manage done'); }
        catch (e) {
            console.error('[cron] paper-manage err', e.message);
            try { await logError(env, { source: 'paper-manage', message: e.message, stack: e.stack }); } catch (_) {}
        }
        // 가상매매 정지 자동 진단 (1시간에 한 번만 실제 실행 — 함수 내부 KV 게이트)
        try { const h = await paperHealthCheck(env); if (!h.skipped) console.log('[cron] paper-health', h); }
        catch (e) { console.error('[cron] paper-health err', e.message); }
        // 종가베팅 — 장마감 직전(ET 15:55~16:00) 한 틱에서만 실제 실행 (함수 내부 시간 게이트)
        try { const cb = await captureCloseBetSignals(env); if (!cb.skipped) console.log('[cron] closebet', cb); }
        catch (e) {
            console.error('[cron] closebet err', e.message);
            // 콘솔 로그만으로는 하루 한 번뿐인 이 틱이 실패해도 나중에 확인할 방법이 없어서 D1 + 텔레그램에도 남김
            try { await logError(env, { source: 'closebet', message: e.message, stack: e.stack }); } catch (_) {}
            try { await _tgDirect(env, `⚠️ 종가베팅 스캔 실패: ${e.message}`); } catch (_) {}
        }
    }
    try { console.log(`[cron] ${market} price`, await checkPriceAlerts(env)); }
    catch (e) { console.error('[cron] price err', e.message); }
    try { console.log(`[cron] ${market} signal`, await analyzeSignals(env, market)); }
    catch (e) { console.error('[cron] signal err', e.message); }

    // 미국 정규장 마감 직후(이 cron의 마지막 틱, UTC 21:55) — 일일 리포트 발송
    // 신규 cron 트리거 추가 없이(플랜당 5개 한도) 기존 5분 주기의 특정 틱에서 실행
    if (market === 'US') {
        const d = new Date(scheduledTime);
        if (d.getUTCHours() === 21 && d.getUTCMinutes() >= 55) {
            try { await sendDailyHealthSummary(env); console.log('[cron] daily-health done'); }
            catch (e) { console.error('[cron] daily-health err', e.message); }
        }
    }
}

// POST /api/admin/run-five-min-job?market=US — Cloudflare Cron Triggers가 발화를 멈추는 문제의
// 외부 크론 우회용 (cron-job.org 등에서 5분마다 호출). ADMIN_TOKEN 헤더 필수.
async function handleRunFiveMinJob(req, env) {
    if (!(await requireAdmin(req, env))) return err(401, 'admin auth required');
    const market = new URL(req.url).searchParams.get('market') || 'US';
    try {
        await runFiveMinJob(env, market);
        return json({ ok: true, market });
    } catch (e) {
        return err(500, e.message);
    }
}
