// 데일리 트레이딩 스캐너 — 실시간 5분/15분봉 매수·매도 후보
// GET /api/scanner/daily-trading?market=US&tf=5m
//
// 분석 엔진: Smart Dip v3 (컨플루언스 품질 필터) — 개별 차트 Smart Dip 과 동일 방법론.
//   buy  = 상승추세 눌림목 진입 / sell = 하락추세 반등 소진 진입
//   8개 필터(ADX·HTF추세·거래량회복·양봉/음봉·ATR·SPX환경·RSI·장초반) 통과 종목만.
import { json, err } from '../utils/validators.js';
import { calcVWAPSeries } from '../utils/indicators.js';
import { smartDipScan, smartDipScanBounce, smartDipBacktest, resolveTrailExit, smartDipScanCloseBet } from '../utils/smart-dip.js';
import { fetchChartWithFallback } from './yahoo.js';
import { getMarketRegime, getSectorRotation } from '../utils/market.js';
import { _fetchDiscoverySymbols, DEFAULT_UNIVERSE_US, DEFAULT_UNIVERSE_KR } from '../cron.js';
import { paperOpenTrade, _tgDirect, TRANCHE_WEIGHTS, TRANCHE_WEIGHT_SUM, _etTotalMin, isSymbolBlocked } from '../utils/paper-engine.js';
import { classifySymbol, SECTOR_MAP, LEVERAGED_ETFS, INVERSE_ETFS, STOCK_ETF_MAP } from '../utils/paper-category.js';
import { getPaperTradeParams } from '../utils/paper-optimizer.js';
import { getNewsSentiment } from '../utils/news-sentiment.js';
import { logError } from '../utils/errors.js';
import { yfRequest } from '../utils/crumb.js';

const BACKTEST_CACHE_KEY = (tf) => `dailybt:US:${tf}`;
const BACKTEST_TTL = 6 * 60 * 60; // 6시간 (비용 큰 작업)

// 백테스트 KV에서 등급별 실측 승률 로드 (스캐너 winRate 표시용 — 트레일링 청산 기준)
async function _loadMeasuredWin(env, tf) {
    try {
        const bt = await env.CACHE.get(BACKTEST_CACHE_KEY(tf) + ':trail:skipmid', 'json');
        if (bt?.byGrade) {
            const out = {};
            for (const g of ['S', 'A', 'B']) {
                if (bt.byGrade[g]?.n >= 10) out[g] = bt.byGrade[g].winRate;
            }
            return Object.keys(out).length ? out : null;
        }
    } catch (_) {}
    return null;
}

const CACHE_TTL = 90; // intraday — 90초

// 주말·장마감 후 야후가 추가하는 0거래량 빈 봉 제거 (마지막 봉 정확도 보정)
function _trimTrailing(q, ts) {
    const vol = q.volume || [];
    let last = vol.length - 1;
    while (last > 0 && !vol[last]) last--;
    if (last >= vol.length - 1) return { q, ts }; // 자를 필요 없음
    const cut = arr => (arr || []).slice(0, last + 1);
    return {
        q: { close: cut(q.close), open: cut(q.open), high: cut(q.high), low: cut(q.low), volume: cut(q.volume) },
        ts: ts ? ts.slice(0, last + 1) : ts,
    };
}

// 미국 세션 단계 — 마지막 봉 ts(초) 의 UTC 시각 기준
function _session(tsSec) {
    if (!tsSec) return 'regular';
    const d = new Date(tsSec * 1000);
    const m = d.getUTCHours() * 60 + d.getUTCMinutes(); // UTC 분
    if (m >= 480 && m < 810) return 'premarket';    // 08:00–13:30 UTC (ET 04:00–09:30 프리마켓)
    if (m >= 810 && m < 870) return 'open_drive';   // 13:30–14:30 UTC (장 초반 30~60분)
    if (m >= 930 && m < 1110) return 'midday';       // 15:30–18:30 UTC (점심 횡보)
    if (m >= 1170 && m <= 1260) return 'power_hour'; // 19:30–21:00 UTC (파워아워)
    return 'regular';
}

export async function handleDailyTradingScan(req, env) {
    try {
        const url = new URL(req.url);
        const market = url.searchParams.get('market') === 'KR' ? 'KR' : 'US';
        const tfParam = url.searchParams.get('tf');
        const tf = (tfParam === '15m' || tfParam === '1d') ? tfParam : '5m';
        const cacheKey = `dailyscan:${market}:${tf}`;

        // KV 캐시 (90초)
        try {
            const cached = await env.CACHE.get(cacheKey, 'json');
            if (cached) return json({ ...cached, _cached: true });
        } catch (_) {}

        // 시장 레짐 — US 한정 (KR 은 중립 취급)
        const regime = market === 'KR'
            ? { regime: 'neutral', label: '중립', spyTrend: 'flat', spyChgPct: 0, vix: null, note: 'KR' }
            : await getMarketRegime(env);
        // Smart Dip 필터 6번(SPX 환경) 입력
        // risk_off(일봉 하향)이어도 오늘 SPY가 실제로 오르고 있으면 neutral 처리
        // → 스캐너 레벨에서 신호 완전 차단 방지 (진입 게이트는 별도 regime 체크)
        const spxTrendUp = regime.spyTrend === 'up' ? true
            : (regime.spyTrend === 'down' && (regime.spyChgPct || 0) <= 0) ? false
            : null;
        // 백테스트 실측 승률 (있으면 등급 기본값 대신 사용)
        const measuredWin = await _loadMeasuredWin(env, tf);

        // 유니버스 — 기본 풀 + 당일 활발 종목(US 스크리너)
        // Cloudflare Workers 무료 플랜: 요청당 서브리퀘스트 50개 한도 — 가상매매(우선순위 최상위)가
        // 이 스캔에서 예산을 다 못 쓰게 20개로 축소 (기존 40개는 폴백 포함 최대 80회 fetch로 한도 초과 원인).
        const base = market === 'KR' ? DEFAULT_UNIVERSE_KR : DEFAULT_UNIVERSE_US;
        const dynamic = await _fetchDiscoverySymbols(env, market);
        // dynamic(당일 활발 종목)을 우선 배치 — base가 47개라 뒤에 두면 20개 컷에서 항상 밀려남
        // 1d는 하루 1틱만 도는 저빈도 스캔이라 예산 여유가 있어 유니버스를 넓힘(스윙 후보가 너무 적었음)
        const universeCap = tf === '1d' ? 50 : 20;
        const universe = [...new Set([...dynamic, ...base])].slice(0, universeCap);

        // 5m: 5d(300봉+ 확보) / 1d: 2y(EMA120·ADX14 계산에 최소 120봉 필요 — 6개월 미만이면 부족)
        const range = tf === '1d' ? '2y' : '5d';

        const results = [];
        let analyzed = 0;
        // 필터 단계별 탈락 카운터 (디버깅용)
        let _dbg = { noData: 0, noPass: 0, rawBuy: 0, rawSell: 0, bounceAny: 0, bounceA: 0, middaySkip: 0 };
        // 10개씩 청크 병렬
        const CHUNK = 10;
        for (let k = 0; k < universe.length; k += CHUNK) {
            const chunk = universe.slice(k, k + CHUNK);
            await Promise.all(chunk.map(async (symbol) => {
                try {
                    const raw = await fetchChartWithFallback(env, symbol, range, tf, 'true');
                    const result0 = raw?.chart?.result?.[0];
                    const qRaw = result0?.indicators?.quote?.[0];
                    if (!qRaw?.close?.length || qRaw.close.length < 60) { _dbg.noData++; return; }

                    // 주말·장마감 후 0거래량 빈 봉 제거 → 진짜 마지막 봉 기준 분석
                    const { q, ts: tts } = _trimTrailing(qRaw, result0?.timestamp);
                    if (!q?.close?.length || q.close.length < 60) { _dbg.noData++; return; }

                    analyzed++;
                    // 세션(당일) 기준 VWAP 배열 — evalBar의 VWAP 정렬 게이트에 실제로 연결
                    // (기존엔 calcVWAP(q)로 vwapPos 표시만 하고 진입 필터엔 연결이 안 되어 있었음)
                    const vwapArr = calcVWAPSeries(q, tts || []);
                    const vwap = vwapArr[vwapArr.length - 1];
                    const session = _session((tts || [])[(tts || []).length - 1]);
                    // 점심 시간대 필터 제거 — 신호 자체는 내보내고 세션 태그("점심")로 UI에서 표시
                    // 원칙 5: 파동 확장(추격 금지) 판단용 — 20봉 저점/고점 대비 현재가 이격
                    const last20c = (q.close || []).filter(v => v != null).slice(-20);
                    const _low20  = last20c.length ? Math.min(...last20c) : 0;
                    const _high20 = last20c.length ? Math.max(...last20c) : 0;
                    const mkResult = (sig) => ({
                        symbol,
                        dir: sig.dir,
                        mode: sig.mode || 'trend',
                        grade: sig.grade,
                        score: sig.qualityScore,
                        winRate: sig.winRate,
                        factors: sig.reasons,
                        price: sig.price,
                        rsi: sig.rsiVal,
                        rvol: sig.volRatio,
                        volAvg20: sig.volAvg20 ?? 0,
                        vwapPos: (vwap != null) ? (sig.price >= vwap ? 'above' : 'below') : null,
                        adx: sig.adx,
                        atrPct: sig.atrPct,
                        barsAgo: sig.barsAgo,
                        stop: sig.stop, be: sig.be, target1: sig.target1, target2: sig.target2, riskPct: sig.riskPct,
                        winMeasured: sig.winMeasured,
                        session,
                        riskWarn: (regime.regime === 'risk_off' && sig.dir === 'buy' && sig.grade !== 'S' && (sig.mode || 'trend') === 'trend'),
                        // 20봉 저점 대비 상승률(%) / 20봉 고점 대비 낙폭(%) — 파동 확장 판단
                        waveExt:     _low20  > 0 ? +((sig.price - _low20)  / _low20  * 100).toFixed(2) : 0,
                        waveExtDown: _high20 > 0 ? +(((_high20 - sig.price) / _high20) * 100).toFixed(2) : 0,
                    });

                    // ── 추세 신호 (Smart Dip 추세추종) ──
                    const trend = smartDipScan(q, { interval: tf, ts: tts || [], spxTrendUp, measuredWin, vwapArr });
                    if (trend) { results.push(mkResult(trend)); if (trend.dir === 'buy') _dbg.rawBuy++; else _dbg.rawSell++; }

                    // ── 역추세 반등 매수 (독립 실행 — 매도 신호와 무관하게 A/S급 반등은 추가) ──
                    // 단, 추세가 이미 '매수'면 중복 방지로 생략.
                    if (!trend || trend.dir !== 'buy') {
                        const bounce = smartDipScanBounce(q, { ts: tts || [], measuredWin });
                        if (bounce) { _dbg.bounceAny++; if (bounce.grade === 'A' || bounce.grade === 'S') _dbg.bounceA++; }
                        if (bounce && (bounce.grade === 'S' || bounce.grade === 'A')) { results.push(mkResult(bounce)); _dbg.rawBuy++; }
                    }

                    if (!trend) _dbg.noPass++;
                } catch (_) {}
            }));
        }

        // 점수(컨플루언스) 내림차순 — S > A > B 순으로 정렬됨
        results.sort((a, b) => b.score - a.score);

        // B급 이상 노출 (S/A/B). B는 백테스트상 약하므로 UI에서 낮은 등급으로 표시.
        // 매수 후보가 드문 장세에서도 셋업을 최대한 보여주기 위함.
        let curated = results.filter(r => r.grade === 'S' || r.grade === 'A' || r.grade === 'B');
        curated = curated.slice(0, 25);

        // 점심 필터 제거 — middayFiltered는 항상 false (이전 클라 호환용으로 필드는 유지)
        const middayFiltered = false;

        const payload = {
            results: curated,
            regime,
            totalScanned: analyzed,
            totalCandidates: results.length,
            universe: universe.length,
            middayFiltered,
            tf,
            market,
            scannedAt: Date.now(),
        };
        if (url.searchParams.get('diag') === '1') payload._debug = _dbg;
        try { await env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL }); } catch (_) {}
        return json(payload);
    } catch (e) {
        return err(500, e.message);
    }
}

// GET /api/scanner/daily-backtest?market=US&tf=5m[&force=1]
// 유니버스 종목의 과거 데이터에 Smart Dip 엔진을 돌려 실측 승률·평균 R 산출.
// 비용이 크므로 6시간 KV 캐시. 결과는 스캐너 winRate 표시에도 재사용됨.
export async function handleDailyBacktest(req, env) {
    try {
        const url = new URL(req.url);
        const tfParam = url.searchParams.get('tf');
        const tf = (tfParam === '15m' || tfParam === '1d') ? tfParam : '5m';
        const force = url.searchParams.get('force') === '1';
        const targetR = Math.max(0.5, Math.min(5, parseFloat(url.searchParams.get('target') || '2'))) || 2;
        const mode = url.searchParams.get('mode') === 'bounce' ? 'bounce' : 'trend';
        const exitMode = url.searchParams.get('exit') === 'trail' ? 'trail' : 'fixed';
        const useVwap = url.searchParams.get('vwap') === '1';
        const skipMidday = url.searchParams.get('skipmid') === '1';
        const exitTag = exitMode === 'trail' ? ':trail' : url.searchParams.get('exit') === 'hybrid' ? ':hybrid' : '';
        const exitArg = url.searchParams.get('exit') === 'hybrid' ? 'hybrid' : exitMode;
        const cacheKey = BACKTEST_CACHE_KEY(tf) + (mode === 'bounce' ? ':bounce' : '')
            + exitTag + (useVwap ? ':vwap' : '') + (skipMidday ? ':skipmid' : '') + (targetR !== 2 ? `:t${targetR}` : '');

        if (!force) {
            try {
                const cached = await env.CACHE.get(cacheKey, 'json');
                if (cached) return json({ ...cached, _cached: true });
            } catch (_) {}
        }

        const regime = await getMarketRegime(env);
        const spxTrendUp = regime.spyTrend === 'up' ? true : regime.spyTrend === 'down' ? false : null;

        // 백테스트 유니버스 — 기본 풀만 (안정적 종목), 비용 위해 25개 제한
        const dynamic = await _fetchDiscoverySymbols(env, 'US');
        const universe = [...new Set([...DEFAULT_UNIVERSE_US, ...dynamic])].slice(0, 25);
        // 5m: 1개월(≈30일×78봉) / 15m: 3개월 / 1d: 5년(표본 확보)
        const range = tf === '15m' ? '3mo' : tf === '1d' ? '5y' : '1mo';

        const all = [];
        let symbolsOk = 0;
        const CHUNK = 8;
        for (let k = 0; k < universe.length; k += CHUNK) {
            const chunk = universe.slice(k, k + CHUNK);
            await Promise.all(chunk.map(async (symbol) => {
                try {
                    const raw = await fetchChartWithFallback(env, symbol, range, tf, 'false');
                    const r0 = raw?.chart?.result?.[0];
                    const q = r0?.indicators?.quote?.[0];
                    if (!q?.close?.length || q.close.length < 120) return;
                    symbolsOk++;
                    const tsArr = r0?.timestamp || [];
                    const vwapArr = useVwap ? calcVWAPSeries(q, tsArr) : null;
                    const { trades } = smartDipBacktest(q, { interval: tf, spxTrendUp, targetR, mode, exit: exitArg, vwapArr, ts: tsArr, skipMidday });
                    for (const t of trades) all.push(t);
                } catch (_) {}
            }));
        }

        // 집계
        const agg = (arr) => {
            const n = arr.length;
            if (!n) return { n: 0, winRate: 0, avgR: 0, expectancy: 0, wins: 0, losses: 0, timeouts: 0 };
            const wins = arr.filter(t => t.outcome === 'win').length;
            const losses = arr.filter(t => t.outcome === 'loss').length;
            const timeouts = arr.filter(t => t.outcome === 'timeout').length;
            const sumR = arr.reduce((s, t) => s + (t.R || 0), 0);
            // 승률은 목표(2R) 도달 비율 (타임아웃 제외 분모)
            const decided = wins + losses;
            return {
                n,
                winRate: decided ? Math.round((wins / decided) * 100) : 0,
                avgR: +(sumR / n).toFixed(2),       // 거래당 평균 손익(R)
                expectancy: +(sumR / n).toFixed(2),
                wins, losses, timeouts,
            };
        };

        const byGrade = { S: agg(all.filter(t => t.grade === 'S')), A: agg(all.filter(t => t.grade === 'A')), B: agg(all.filter(t => t.grade === 'B')) };
        const byDir   = { buy: agg(all.filter(t => t.dir === 'buy')), sell: agg(all.filter(t => t.dir === 'sell')) };
        // 교차검증 — 기간 초/중/후반 3등분 (각 구간 기대값이 안정적이면 과최적화 아님)
        const byPeriod = { early: agg(all.filter(t => t.bucket === 0)), mid: agg(all.filter(t => t.bucket === 1)), late: agg(all.filter(t => t.bucket === 2)) };

        const payload = {
            tf,
            overall: agg(all),
            byGrade,
            byDir,
            byPeriod,
            exit: exitArg,
            skipMidday,
            symbols: symbolsOk,
            universe: universe.length,
            range,
            spxTrendUp,
            ranAt: Date.now(),
        };
        try { await env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: BACKTEST_TTL }); } catch (_) {}
        return json(payload);
    } catch (e) {
        return err(500, e.message);
    }
}

// ════════════════════════════════════════════════════════════════
// 실전 forward-test — 스캐너가 내보낸 실제 신호의 사후 성과 추적
//   captureDailySignals: 5분 cron 에서 현재 신호를 dt_signals 에 기록 (중복 방지)
//   resolveDailySignals: 진행중 신호의 트레일링 청산을 시뮬레이션해 실측 R 기록
//   handleDailyLiveStats: 누적 실측 승률·평균 R 반환
// ════════════════════════════════════════════════════════════════
export async function captureDailySignals(env) {
    // 동적 진입 파라미터 + 계좌 목록 + 시장 레짐 1회 로드
    const params     = await getPaperTradeParams(env);
    const accounts   = (await env.DB.prepare('SELECT user_id, day_balance, day_position_size, swing_balance, swing_position_size FROM paper_account').all()).results || [];
    const regime     = await getMarketRegime(env);
    const sectorRot  = await getSectorRotation(env);

    // 일봉 캔들은 하루 1번만 마감됨 — 5분마다 재스캔은 낭비이자 서브리퀘스트 한도 초과 원인.
    // ET 10:00(개장 30분 후) 틱에서만 1d 스캔 실행 — 단기 스윙(수일 보유) 신호용.
    // 고정 UTC 시각 대신 _etTotalMin() 사용 — DST(서머타임) 전환 시에도 항상 정확히 ET 10:00에 맞춤.
    const etMin = _etTotalMin();
    const isDailyScanTime = etMin >= 600 && etMin < 605;
    // 1d 유니버스를 50개로 넓힌 만큼, 같은 틱에 5m까지 같이 돌리면 예산 초과 위험 —
    // 이 틱만 5m을 건너뛴다(하루 288틱 중 1틱 스킵은 단타 시그널 손실 영향 미미).
    const timeframes = isDailyScanTime ? ['1d'] : ['5m'];

    let logged = 0;
    for (const tf of timeframes) {
        try {
            const resp = await handleDailyTradingScan(new Request(`https://x/api/scanner/daily-trading?market=US&tf=${tf}`), env);
            const data = await resp.json();
            const results = data.results || [];
            const tfMin = tf === '1d' ? 1440 : 5;
            for (const r of results) {
                try {
                    if (r.stop == null || r.price == null) continue;
                    const stopDist = Math.abs(r.price - r.stop);
                    if (!(stopDist > 0)) continue;
                    const entryTs = (data.scannedAt || Date.now()) - (r.barsAgo || 0) * tfMin * 60000;
                    const since = Date.now() - 30 * 60 * 1000;
                    const dup = await env.DB.prepare(
                        'SELECT 1 FROM dt_signals WHERE symbol=? AND dir=? AND tf=? AND created_at>? LIMIT 1'
                    ).bind(r.symbol, r.dir, tf, since).first();
                    if (dup) continue;
                    const dtInsert = await env.DB.prepare(
                        'INSERT INTO dt_signals (symbol,tf,dir,mode,grade,score,entry,stop,be,stop_dist,created_at,adx,rsi,vol_ratio,atr_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
                    ).bind(r.symbol, tf, r.dir, r.mode || 'trend', r.grade, r.score, r.price, r.stop, r.be ?? null, stopDist, entryTs,
                        r.adx ?? null, r.rsi ?? null, r.rvol ?? null, r.atrPct ?? null).run();
                    logged++;

                    if (r.dir === 'buy' || r.dir === 'sell') {
                        await _tryOpenPaperTrade(env, r, tf, dtInsert.meta?.last_row_id || null, params, accounts, regime, sectorRot);
                    }
                } catch (e) {
                    // 한 종목 처리 실패가 나머지 후보 전체를 막지 않도록 개별 격리
                    console.warn('[dt-capture] symbol err', r?.symbol, e?.message);
                }
            }
        } catch (e) { try { await logError(env, { source: 'captureDailySignals', message: e.message, stack: e.stack }); } catch (_) {} }
    }

    return { logged };
}

// ── 종가베팅 — 장마감 직전(ET 15:55~16:00) 한 틱에서만 실행 ──────────────────
// 당일 강세로 고점 근처 마감하는 종목을 매수 → 익일 시가에 그대로 청산(오버나이트 모멘텀 베팅).
// 장중 추세추종(captureDailySignals)과는 별개 전략 — 서브리퀘스트 예산 보호를 위해
// 개별 종목 위주 소규모 유니버스(레버리지·인버스 ETF 제외 20개)만 스캔.
const CLOSEBET_MAX_POS = 2; // 동시 보유 최대 2개
export async function captureCloseBetSignals(env) {
    const etMin = _etTotalMin();
    if (etMin < 955 || etMin >= 960) return { skipped: 'not_close_window' }; // ET 15:55~16:00 한 틱만

    const openCount = (await env.DB.prepare(
        "SELECT COUNT(*) c FROM paper_trades WHERE status='open' AND style='closebet'"
    ).first())?.c || 0;
    if (openCount >= CLOSEBET_MAX_POS) return { skipped: 'max_positions' };

    const acct = await env.DB.prepare(
        "SELECT user_id, day_balance, day_position_size FROM paper_account"
    ).first();
    if (!acct) return { skipped: 'no_account' };

    const universe = DEFAULT_UNIVERSE_US.filter(s => !LEVERAGED_ETFS.has(s) && !INVERSE_ETFS.has(s)).slice(0, 20);
    const candidates = [];
    const CHUNK = 10;
    for (let k = 0; k < universe.length; k += CHUNK) {
        const chunk = universe.slice(k, k + CHUNK);
        await Promise.all(chunk.map(async (symbol) => {
            try {
                if (await isSymbolBlocked(env, symbol)) return;
                const raw = await fetchChartWithFallback(env, symbol, '2d', '5m', 'true');
                const result0 = raw?.chart?.result?.[0];
                const qRaw = result0?.indicators?.quote?.[0];
                if (!qRaw?.close?.length) return;
                const { q, ts: tts } = _trimTrailing(qRaw, result0?.timestamp);
                if (!q?.close?.length) return;
                const sig = smartDipScanCloseBet(q, { ts: tts || [] });
                if (sig) candidates.push({ symbol, sig });
            } catch (_) {}
        }));
    }
    if (!candidates.length) return { logged: 0 };

    // 등급 높은 순 정렬 — 남은 슬롯만큼만 진입
    candidates.sort((a, b) => b.sig.qualityScore - a.sig.qualityScore);
    const slots = CLOSEBET_MAX_POS - openCount;
    let opened = 0;
    for (const { symbol, sig } of candidates.slice(0, slots)) {
        const dup = await env.DB.prepare(
            "SELECT 1 FROM paper_trades WHERE user_id=? AND symbol=? AND status='open'"
        ).bind(acct.user_id, symbol).first();
        if (dup) continue;

        const posSize = acct.day_position_size || 10000;
        const amount  = posSize * TRANCHE_WEIGHTS[0] / TRANCHE_WEIGHT_SUM;
        const qty     = Math.floor(amount / sig.price);
        if (qty < 1) continue;

        const category = classifySymbol(symbol, sig.price, sig.volRatio) || 'mid_small';
        await paperOpenTrade(env, {
            userId: acct.user_id, symbol, category, style: 'closebet',
            dir: 'long', price: sig.price, qty,
            grade: sig.grade, score: sig.qualityScore, stopPrice: sig.stop,
            reason: (sig.reasons || []).join(' / '),
            mode: 'closebet', outlookDir: 'long',
        });
        opened++;
    }
    return { logged: candidates.length, opened };
}

// ETF 현재가 + 평균거래량 조회 — 개별 종목 신호를 레버리지/인버스 ETF로 우선 체결할 때 유동성 판단용
async function _fetchEtfQuote(env, symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
        const data = await yfRequest(env.CACHE, url);
        const q = data?.quoteResponse?.result?.[0];
        if (!q?.regularMarketPrice) return null;
        return { price: q.regularMarketPrice, volume: q.averageDailyVolume3Month || q.regularMarketVolume || 0 };
    } catch (_) { return null; }
}

// STOCK_ETF_MAP(정적 목록)에 없는 종목의 레버리지/인버스 ETF를 Yahoo Finance 검색으로 동적 탐색.
// 종목명 + 레버리지("2X"/"1.5X"/"1.25X") + 방향(Bull·Long / Bear·Inverse·Short) 키워드가
// 모두 일치하는 ETF만 채택 — 엉뚱한 종목 오매칭 방지. 결과는 KV에 7일 캐싱(서브리퀘스트 절약).
async function _searchLeveragedEtf(env, symbol, isShort) {
    const cacheKey = `etfmap:${symbol}:${isShort ? 'short' : 'long'}`;
    try {
        const cached = await env.CACHE.get(cacheKey);
        if (cached != null) return cached === 'none' ? null : cached;
    } catch (_) {}

    let found = null;
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=20&newsCount=0&enableFuzzyQuery=false`;
        const data = await yfRequest(env.CACHE, url);
        const quotes = data?.quotes || [];
        const symbolWord = new RegExp(`\\b${symbol}\\b`, 'i');
        const leverageKw = /\b(2X|1\.5X|1\.25X)\b/i;
        const dirKw = isShort ? /\b(bear|inverse|short)\b/i : /\b(bull|long)\b/i;
        for (const q of quotes) {
            if (q.quoteType !== 'ETF') continue;
            const name = `${q.shortname || ''} ${q.longname || ''}`;
            if (!symbolWord.test(name) || !leverageKw.test(name) || !dirKw.test(name)) continue;
            found = q.symbol;
            break;
        }
    } catch (e) {
        console.warn(`[paper] ${symbol} ETF 검색 실패`, e?.message);
    }

    try { await env.CACHE.put(cacheKey, found || 'none', { expirationTtl: 7 * 86400 }); } catch (_) {}
    return found;
}

// ── ET 시간 필터: 프리마켓 7:00 ~ 정규장 마감 15:30 ET 허용 ────────────────
// 프리마켓 4:00~7:00은 거래량이 거의 없어 여전히 제외 (Yahoo 프리마켓 가격 불안정 →
// 손절 슬리피지 과대 우려). 7:00 이후는 실리는 편이라 사용자 요청으로 허용,
// 대신 아래 프리마켓 전용 등급 필터(S만 허용)로 리스크를 보완한다.
function _isGoodEntryTime() {
    const et = _etTotalMin();
    return et >= 7 * 60 && et < 15 * 60 + 30;
}

// 프리마켓 시간대(장 정식 개장 9:30 이전)인지 — 데이터 신뢰도가 정규장보다 낮아 등급 필터 강화용
function _isPreMarket() {
    const et = _etTotalMin();
    return et < 9 * 60 + 30;
}

// ── 시간대별 최소 RVOL 임계값 ─────────────────────────────────────────────
// 점심(11:30~14:00 ET): 거래량 자연 감소 → 0.8로 완화
// 프리마켓(07:00~09:30 ET): 정규장보다 데이터 신뢰도 낮아 1.5로 강화 (S등급 전용 필터와 이중 보완)
// 그 외(오전·파워아워): params.min_rvol 사용
function _sessionMinRvol(params) {
    const t = _etTotalMin();
    if (t >= 11 * 60 + 30 && t < 14 * 60) return 0.8;  // 점심 횡보 — 달러거래량($3M) 필터가 유동성 보장하므로 완화
    if (t < 9 * 60 + 30) return 1.5;                    // 프리마켓 — 얇은 거래량 노이즈 방지
    return params.min_rvol || 1.5;
}

// ── 전문 트레이더 진입 게이트 — 필터 통과 시에만 paperOpenTrade 호출 ────────
async function _tryOpenPaperTrade(env, r, tf, dtId, params, accounts, regime, sectorRot) {
    // ① ET 시간 필터
    if (!_isGoodEntryTime()) return;

    // ① 매매 금지 종목 차단
    if (await isSymbolBlocked(env, r.symbol)) return;

    // ① SPX 레짐 게이트
    const isShortSignal = r.dir === 'sell';
    const spyChg = regime?.spyChgPct ?? 0;

    // ① 레짐 게이트 (롱/숏 방향별)
    if (!isShortSignal) {
        // 롱: risk_off + SPY -0.3% 이상 하락 시만 차단 (보합은 허용)
        if (regime?.regime === 'risk_off' && spyChg < -0.3) {
            console.log(`[paper] ${r.symbol} risk_off+SPY${spyChg.toFixed(2)}% — 롱 차단`);
            return;
        }
        // favorable/neutral + SPY -0.5% 이상: S급만
        if (spyChg < -0.5 && r.grade !== 'S') {
            console.log(`[paper] ${r.symbol} SPY ${spyChg.toFixed(2)}% — A급 롱 스킵`);
            return;
        }
    } else {
        // 숏: risk_off(하락장)일 때만 허용 — neutral/favorable에서는 전면 차단
        if (regime?.regime !== 'risk_off') {
            console.log(`[paper] ${r.symbol} 숏 — 레짐 ${regime?.regime || 'unknown'} (하락장 아님) — 차단`);
            return;
        }
    }

    // ② 인버스 ETF — 매수 자체가 시장 하락 베팅 → risk_off 아닐 때 차단
    if (!isShortSignal && INVERSE_ETFS.has(r.symbol) && regime?.regime !== 'risk_off') {
        console.log(`[paper] ${r.symbol} 인버스ETF — 하락장 아님(${regime?.regime}) 차단`);
        return;
    }

    // ③ 등급 필터 (S/A only, 동적으로 조정 가능)
    const allowedGrades = params.grade_filter || ['S', 'A'];
    if (!allowedGrades.includes(r.grade)) return;

    // ③.5 숏(매도) 전용 등급 필터 — 기본은 매수와 동일 S/A 허용,
    // 실제 체결 데이터로 A등급 숏 성과가 부진하다고 확인되면 paper-optimizer가 자동으로 S만 허용하게 강화
    const allowedSellGrades = params.sell_grade_filter || ['S', 'A'];
    if (isShortSignal && !allowedSellGrades.includes(r.grade)) {
        console.log(`[paper] ${r.symbol} 숏 ${r.grade}등급 — 매도 등급 필터 미충족(허용: ${allowedSellGrades.join('/')})`);
        return;
    }

    // ③.6 프리마켓 전용 등급 필터 — 데이터 신뢰도가 낮은 시간대라 S등급만 허용 (안전판)
    if (_isPreMarket() && r.grade !== 'S') {
        console.log(`[paper] ${r.symbol} 프리마켓 ${r.grade}등급 — S등급만 허용, 스킵`);
        return;
    }

    // ③.7 일일 거래횟수 과다 방지 — 오늘 15건 이상 체결됐으면 그 다음부턴 S등급(진짜 확실한 자리)만 허용
    // 사용자 지시: "정말 먹을자리 아니면 안 하도록" — 과잉매매 방지
    const DAILY_TRADE_CAP = 15;
    const etDayStartMs = Date.now() - _etTotalMin() * 60 * 1000; // 오늘 ET 자정 근사치
    const todayTradeCount = (await env.DB.prepare(
        "SELECT COUNT(*) c FROM paper_trades WHERE created_at >= ?"
    ).bind(etDayStartMs).first())?.c || 0;
    if (todayTradeCount >= DAILY_TRADE_CAP && r.grade !== 'S') {
        console.log(`[paper] ${r.symbol} 오늘 ${todayTradeCount}건째 — S등급만 허용, ${r.grade}등급 스킵`);
        return;
    }

    // ③ RVOL 필터 (시간대별 동적 임계값 — 점심 0.8 / 프리마켓 1.0 / 그 외 min_rvol)
    // 레버리지 ETF는 유동성 특성상 1.2로 완화 (SOXL 등은 rvol=1.0도 충분한 유동성)
    const minRvol = LEVERAGED_ETFS.has(r.symbol) ? 1.2 : _sessionMinRvol(params);
    if ((r.rvol || 0) < minRvol) {
        console.log(`[paper] ${r.symbol} rvol=${(r.rvol||0).toFixed(1)} < ${minRvol} — 스킵`);
        return;
    }

    // ④ 절대 거래량 필터 — 가격과 무관하게 하루 100만주 이상 거래되는 종목만 (5분봉 78개/일 환산)
    // volAvg20 = 20봉 평균 거래량(절대 주수)
    const MIN_DAILY_VOLUME = 1_000_000;
    const BARS_PER_DAY = 78; // 정규장 6.5시간 / 5분
    const minBarVolume = MIN_DAILY_VOLUME / BARS_PER_DAY;
    if ((r.volAvg20 ?? 0) < minBarVolume) {
        console.log(`[paper] ${r.symbol} 거래량 부족 (volAvg20=${r.volAvg20 ?? 0} < ${minBarVolume.toFixed(0)}) — 진입 스킵`);
        return;
    }

    // (구 ④.1 달러 거래대금 $3M 필터는 제거됨 — 사용자 지시: "가격과 무관하게 순수 거래량만" 기준으로
    //  통일. 위 ④ 절대 거래량(하루 100만주) 필터가 저가주도 걸러내지 않으면서 유동성을 보장함.
    //  이 필터가 남아있으면 MNSO처럼 거래량은 충분해도 저가라서 부당하게 걸러지는 문제가 있었음.)

    // ④.5 신호 신선도 체크 — 모드별 최대 허용 봉수
    // bounce(눌림목·반등): 3봉(5m:15분) — 타이밍 민감, 늦으면 반등 완료
    // trend(추세추격): 5봉(5m:25분) — 추세는 지속성 있음
    // 1d: 1봉(=1거래일) — 하루 지난 일봉 신호는 이미 가격이 움직여 진입 의미 퇴색
    const isBounce = (r.mode || 'trend') === 'bounce';
    const maxBarsAgo = tf === '1d' ? 1 : (isBounce ? 3 : 5);
    if ((r.barsAgo ?? 0) > maxBarsAgo) {
        console.log(`[paper] ${r.symbol} ${r.mode||'trend'} 신호 ${r.barsAgo}봉 전 — 신선도 부족 스킵`);
        return;
    }

    // ⑤ 종목 카테고리 분류 (없으면 진입 불가)
    const category = classifySymbol(r.symbol, r.price, r.rvol);
    if (!category) return;

    // ⑦ 카테고리 스킵 목록 체크
    const categoryKey = `${category}_${tf === '1d' ? 'swing' : 'day'}`;
    if ((params.skip_categories || []).includes(categoryKey)) return;

    // ⑧ 뉴스 감성 체크 — 명확한 부정 이슈면 진입 금지
    // (KV 30분 캐시 → 동일 종목 반복 스캔 시 API 재호출 없음)
    try {
        const ns = await getNewsSentiment(env, r.symbol);
        if (ns.sentiment === 'negative') {
            console.log(`[paper] ${r.symbol} 부정 뉴스(${ns.score}) "${ns.headline.slice(0,60)}" — 진입 스킵`);
            return;
        }
        if (ns.sentiment === 'positive') {
            console.log(`[paper] ${r.symbol} 긍정 뉴스(${ns.score}) "${ns.headline.slice(0,60)}" — 진입 부스트`);
        }
    } catch (e) {
        // 감성 체크 실패 → 중단하지 않고 진입 허용 (차단 오류보다 진입 실패가 나쁨)
        console.warn(`[paper] ${r.symbol} news-sentiment 오류: ${e.message}`);
    }

    // ⑧.5 모드별 RSI 진입 기준
    // bounce(눌림목·반등): RSI > 68이면 이미 반등 완료 → 추격이 됨 → 스킵
    // trend(추세추격): RSI >= 78 A급 스킵, RSI >= 83 전면 스킵
    const rsiVal = r.rsi ?? 50;
    if (isBounce) {
        if (rsiVal > 68) {
            console.log(`[paper] ${r.symbol} bounce RSI ${rsiVal.toFixed(0)} — 반등 완료 후 추격 스킵`);
            return;
        }
        console.log(`[paper] ${r.symbol} bounce 신호 RSI ${rsiVal.toFixed(0)} — 눌림목 진입 허용`);
    } else {
        if (rsiVal >= 83) {
            console.log(`[paper] ${r.symbol} trend RSI ${rsiVal.toFixed(0)} 극단 과열 — 전면 스킵`);
            return;
        }
        if (rsiVal >= 78 && r.grade !== 'S') {
            console.log(`[paper] ${r.symbol} trend A급 RSI ${rsiVal.toFixed(0)} — 추격 스킵 (S급만 허용)`);
            return;
        }
    }

    // ⑧.6 파동 확장 체크 — 추격 금지 (원칙 5: 10% 이상 무쉬 상승/하락 후 trend 진입 금지)
    // bounce 모드는 이미 눌림목 확인 후 진입 → 제외
    if (!isBounce) {
        if (!isShortSignal && (r.waveExt || 0) > 10) {
            console.log(`[paper] ${r.symbol} 롱 파동 확장 ${(r.waveExt || 0).toFixed(1)}% — 추격 금지`);
            return;
        }
        if (isShortSignal && (r.waveExtDown || 0) > 10) {
            console.log(`[paper] ${r.symbol} 숏 파동 확장 ${(r.waveExtDown || 0).toFixed(1)}% — 추격 금지`);
            return;
        }
    }

    // ⑧.7 섹터 로테이션 필터 (원칙 11)
    // 상대 순위가 아닌 당일 절대 등락률 기준 — 섹터가 실제로 빠질 때만 A급 롱 차단
    // ("XLK이 상대적으로 약한 날"에도 NVDA/SOXL은 오를 수 있음)
    const stockSector = SECTOR_MAP[r.symbol] ?? null;
    if (stockSector && sectorRot?.perf) {
        const sectorChg = sectorRot.perf.find(p => p.sym === stockSector)?.chg ?? 0;
        if (!isShortSignal && sectorChg < 0 && r.grade !== 'S') {
            console.log(`[paper] ${r.symbol} 섹터 ${stockSector} ${sectorChg.toFixed(2)}% 하락 — A급 롱 스킵`);
            return;
        }
        if (isShortSignal && sectorChg > 0.5 && r.grade !== 'S') {
            console.log(`[paper] ${r.symbol} 섹터 ${stockSector} ${sectorChg.toFixed(2)}% 강세 — A급 숏 스킵`);
            return;
        }
    }

    const style       = tf === '1d' ? 'swing' : 'day';
    // 단타(day) 자본 3천만원 / 스윙(swing) 자본 나머지로 분리 운용 — 단타도 다시 실진입.
    const maxPos      = params.max_positions      || 6;
    const maxDayPos   = params.max_day_positions  || 3; // 단타 3포지션
    const maxSwingPos = params.max_swing_positions|| 3; // 스윙 3포지션

    // 매매 우선순위: ① 대응 레버리지/인버스 ETF가 실제 존재하고 유동성(거래대금 $3M 이상)이 충분하면 ETF 매매
    //              ② ETF가 없거나 유동성이 부족하면 개별 종목 매매 — 항상 1개 포지션만 연다
    const isAlreadyEtf = LEVERAGED_ETFS.has(r.symbol) || INVERSE_ETFS.has(r.symbol);
    // 손절가: 신호의 ATR 기반 손절(r.stop, ATR×1.2)을 day/swing 모두 사용.
    // 예전엔 day만 고정 -0.8%로 대체했는데, 종목 변동성(ATR)을 무시해서
    // ATR이 큰 종목은 정상 노이즈에도 바로 손절당하는 문제가 있었음 —
    // paperOpenTrade의 stopValid 검증이 방향 이상 시 자동으로 -0.8% 폴백하니 안전망은 유지됨.
    let leg = { symbol: r.symbol, dir: isShortSignal ? 'short' : 'long', price: r.price, category, stopPrice: r.stop };

    if (!isAlreadyEtf) {
        const etfPair = STOCK_ETF_MAP[r.symbol];
        const etfSymbol = etfPair
            ? (isShortSignal ? etfPair.short : etfPair.long)
            : await _searchLeveragedEtf(env, r.symbol, isShortSignal); // 정적 목록에 없으면 동적 검색
        if (etfSymbol) {
            const etfQuote = await _fetchEtfQuote(env, etfSymbol);
            const etfDollarVol = etfQuote ? etfQuote.price * etfQuote.volume : 0;
            if (etfQuote && etfDollarVol >= 3_000_000) {
                leg = { symbol: etfSymbol, dir: 'long', price: etfQuote.price, category: classifySymbol(etfSymbol, etfQuote.price, r.rvol) || 'leveraged', stopPrice: null };
                console.log(`[paper] ${r.symbol} → ETF ${etfSymbol} 1순위 매매 (거래대금 $${(etfDollarVol/1e6).toFixed(1)}M)`);
            } else {
                console.log(`[paper] ${etfSymbol} 유동성 부족(${etfQuote ? '$'+(etfDollarVol/1e6).toFixed(1)+'M' : '조회실패'}) — 개별종목(${r.symbol}) 2순위 매매`);
            }
        }
    }

    // 사용자 지시: 숏은 반드시 인버스 ETF 매수로만 진입 — 개별 종목 공매도 금지.
    // 위에서 인버스 ETF 매칭/유동성 확보에 실패해 leg가 여전히 원래 종목의 'short'로 남아있으면
    // (롱과 달리) 개별종목 폴백 없이 이 신호는 그냥 스킵.
    if (isShortSignal && !isAlreadyEtf && leg.dir === 'short') {
        console.log(`[paper] ${r.symbol} 숏 — 인버스 ETF 없음/유동성 부족, 개별종목 공매도 금지 정책으로 스킵`);
        return;
    }

    const legs = [leg];

    for (const acct of accounts) {
        for (const leg of legs) {
            // ⑦ 카테고리 스킵 목록 체크 (리그별)
            const legCategoryKey = `${leg.category}_${tf === '1d' ? 'swing' : 'day'}`;
            if ((params.skip_categories || []).includes(legCategoryKey)) continue;

            // ⑩ 최대 포지션 수 체크 + 스타일별 한도 + 중복 종목 체크 (리그마다 최신 상태 재조회 — 직전 리그가 슬롯을 채웠을 수 있음)
            const openPos = (await env.DB.prepare(
                "SELECT symbol, style FROM paper_trades WHERE user_id=? AND status='open'"
            ).bind(acct.user_id).all()).results || [];
            if (openPos.length >= maxPos) continue;
            const styleCount = openPos.filter(p => p.style === style).length;
            if (style === 'day'   && styleCount >= maxDayPos)   continue; // 단타 3개 한도
            if (style === 'swing' && styleCount >= maxSwingPos)  continue; // 스윙 3개 한도
            if (openPos.some(p => p.symbol === leg.symbol)) continue; // 이미 보유 중

            // ⑩.5 손절 쿨다운 — 같은 종목이 최근 2시간 내 손절당했으면 재진입 금지
            // (동일 저항/지지 레벨에서 손절→30분 뒤 재진입→또 손절 반복되는 휩소 패턴 방지)
            const STOP_COOLDOWN_MS = 2 * 3600 * 1000;
            const recentStop = await env.DB.prepare(
                "SELECT 1 FROM paper_trades WHERE symbol=? AND status='closed' AND close_reason='stop' AND exit_at > ? LIMIT 1"
            ).bind(leg.symbol, Date.now() - STOP_COOLDOWN_MS).first();
            if (recentStop) {
                console.log(`[paper] ${leg.symbol} 최근 2시간 내 손절 이력 — 재진입 쿨다운, 스킵`);
                continue;
            }

            // ⑪ 잔고 체크 — 단타/스윙 각자 풀에서 확인
            const posSize     = (style === 'day' ? acct.day_position_size : acct.swing_position_size) || (style === 'day' ? 10000 : 23000);
            const poolBalance = (style === 'day' ? acct.day_balance : acct.swing_balance) || 0;
            const firstAmount = posSize * TRANCHE_WEIGHTS[0] / TRANCHE_WEIGHT_SUM;
            if (poolBalance < firstAmount) continue;

            const qty = Math.floor(firstAmount / leg.price);
            if (qty < 1) continue; // 고가 종목: 1주 미만이면 진입 스킵
            await paperOpenTrade(env, {
                userId: acct.user_id, symbol: leg.symbol,
                category: leg.category, style,
                dir: leg.dir, price: leg.price, qty,
                signalId: dtId, grade: r.grade, score: r.score,
                stopPrice: leg.stopPrice,
                reason: (r.factors || []).join(' / ') || null,
                mode: r.mode || 'trend',
                outlookDir: isShortSignal ? 'short' : 'long',
            });
            const tag = leg.symbol !== r.symbol ? ` (연동:${r.symbol})` : '';
            console.log(`[paper] open ${leg.symbol}${tag} ${leg.dir} ${style} grade=${r.grade} rvol=${(r.rvol||0).toFixed(1)} user=${acct.user_id}`);
            // 알림은 paperOpenTrade 내부에서 직접 발송됨
        }
    }
}

export async function resolveDailySignals(env) {
    let resolved = 0, checked = 0;
    try {
        const open = await env.DB.prepare('SELECT * FROM dt_signals WHERE resolved=0 ORDER BY created_at ASC LIMIT 120').all();
        const rows = open.results || [];
        checked = rows.length;
        // 종목+tf 별로 묶어 차트를 1회만 fetch (중복 fetch·서브리퀘스트 한도 방지)
        const groups = new Map();
        for (const row of rows) {
            const key = `${row.symbol}|${row.tf}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        }
        for (const [key, grp] of groups) {
            try {
                const [symbol, tf] = key.split('|');
                const range = tf === '15m' ? '1mo' : tf === '1d' ? '2y' : '5d';
                const raw = await fetchChartWithFallback(env, symbol, range, tf, 'false');
                const r0 = raw?.chart?.result?.[0];
                const ts = r0?.timestamp || [];
                const q = r0?.indicators?.quote?.[0];
                if (!q?.close?.length) continue;
                // 1d: 20거래일(≈1개월) 관찰 — 단기 스윙 목표 도달까지 여유 필요
                const horizon = tf === '15m' ? 16 : tf === '1d' ? 20 : 24;
                for (const row of grp) {
                    // 진입 시각 이후 봉만 (forward)
                    const bars = [];
                    for (let k = 0; k < ts.length; k++) {
                        if (ts[k] * 1000 <= row.created_at) continue;
                        if (q.high[k] == null || q.low[k] == null || q.close[k] == null) continue;
                        bars.push({ high: q.high[k], low: q.low[k], close: q.close[k] });
                    }
                    const res = resolveTrailExit({ dir: row.dir, entry: row.entry, stop: row.stop, stopDist: row.stop_dist }, bars, horizon);
                    const ageH = (Date.now() - row.created_at) / 3600000;
                    if (res.resolved) {
                        await env.DB.prepare('UPDATE dt_signals SET resolved=1, outcome=?, exit_price=?, exit_r=?, resolved_at=? WHERE id=?')
                            .bind(res.outcome, res.exitPrice, res.exitR, Date.now(), row.id).run();
                        resolved++;
                    } else if (ageH > (tf === '1d' ? 30 * 24 : 48)) {
                        // 일봉은 20거래일 관찰에 최소 한 달 필요 — 48시간 기준을 그대로 쓰면 항상 조기 timeout됨
                        // 2일(또는 1d: 30일)+ 미해소(데이터 부족 등) → 마지막가로 강제 timeout
                        const ex = bars.length ? bars[bars.length - 1].close : row.entry;
                        const exitR = +(((row.dir === 'buy' ? (ex - row.entry) : (row.entry - ex)) / row.stop_dist)).toFixed(2);
                        await env.DB.prepare("UPDATE dt_signals SET resolved=1, outcome='timeout', exit_price=?, exit_r=?, resolved_at=? WHERE id=?")
                            .bind(ex, exitR, Date.now(), row.id).run();
                        resolved++;
                    }
                }
            } catch (_) {}
        }
    } catch (e) { try { await logError(env, { source: 'resolveDailySignals', message: e.message, stack: e.stack }); } catch (_) {} }
    return { checked, resolved };
}

// GET /api/scanner/daily-livestats — 실전 forward-test 누적 통계
export async function handleDailyLiveStats(req, env) {
    try {
        // 최근 90일 청산분만 — 누적 무한증가 방지 + 최근 성과 반영
        const since90 = Date.now() - 90 * 24 * 3600 * 1000;
        const rows = (await env.DB.prepare('SELECT grade,dir,outcome,exit_r FROM dt_signals WHERE resolved=1 AND resolved_at>=?').bind(since90).all()).results || [];
        const openRow = await env.DB.prepare('SELECT COUNT(*) n FROM dt_signals WHERE resolved=0').first();
        const agg = (arr) => {
            const n = arr.length;
            if (!n) return { n: 0, winRate: 0, avgR: 0, wins: 0, losses: 0 };
            const wins = arr.filter(t => t.outcome === 'win').length;
            const losses = arr.filter(t => t.outcome === 'loss').length;
            const sumR = arr.reduce((s, t) => s + (t.exit_r || 0), 0);
            const decided = wins + losses;
            return { n, winRate: decided ? Math.round((wins / decided) * 100) : 0, avgR: +(sumR / n).toFixed(2), wins, losses };
        };
        return json({
            open: openRow?.n || 0,
            overall: agg(rows),
            byGrade: { S: agg(rows.filter(r => r.grade === 'S')), A: agg(rows.filter(r => r.grade === 'A')), B: agg(rows.filter(r => r.grade === 'B')) },
            byDir: { buy: agg(rows.filter(r => r.dir === 'buy')), sell: agg(rows.filter(r => r.dir === 'sell')) },
        });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── 일일 헬스 리포트 — 미국 장마감 직후 텔레그램 자동 발송 ─────────────────
// 목적: "시그널은 있었는데 매매가 0건" 같은 이상 상황을 사용자가 묻기 전에 먼저 알림.
export async function sendDailyHealthSummary(env) {
    try {
        const dayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();

        const [sigRow, openedRow, closedRow, openNowRow, acct, errRow] = await Promise.all([
            env.DB.prepare("SELECT COUNT(*) n FROM dt_signals WHERE created_at>=? AND grade IN ('S','A') AND dir IN ('buy','sell')").bind(dayStart).first(),
            env.DB.prepare('SELECT COUNT(*) n FROM paper_trades WHERE created_at>=?').bind(dayStart).first(),
            env.DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(realized_pnl),0) pnl FROM paper_trades WHERE status='closed' AND exit_at>=?").bind(dayStart).first(),
            env.DB.prepare("SELECT COUNT(*) n FROM paper_trades WHERE status='open'").first(),
            env.DB.prepare('SELECT balance, total_pnl FROM paper_account WHERE user_id=?').bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first(),
            env.DB.prepare("SELECT COUNT(*) n FROM errors WHERE created_at>=? AND severity IN ('error','fatal')").bind(dayStart).first(),
        ]);

        const signals = sigRow?.n || 0;
        const opened  = openedRow?.n || 0;
        const closed  = closedRow?.n || 0;
        const pnl     = (closedRow?.pnl || 0).toFixed(0);
        const errors  = errRow?.n || 0;

        const lines = [
            `📋 <b>일일 리포트</b> (${new Date().toISOString().slice(0, 10)})`,
            `시그널(S/A) ${signals}건  |  매매 진입 ${opened}건  |  청산 ${closed}건 (${pnl >= 0 ? '+' : ''}$${pnl})`,
            `현재 보유 ${openNowRow?.n || 0}종목  |  계좌 $${(acct?.balance || 0).toFixed(0)} (누적 ${acct?.total_pnl >= 0 ? '+' : ''}$${(acct?.total_pnl || 0).toFixed(0)})`,
            `오류 로그 ${errors}건`,
        ];
        // 이상 징후 — 시그널은 있었는데 매매 진입이 0건인 경우 (오늘 겪은 subrequest 초과 같은 문제 조기 발견용)
        if (signals > 0 && opened === 0) {
            lines.push('', '⚠️ S/A급 시그널이 있었는데 매매 진입 0건 — 점검 필요');
        }
        if (errors > 0) {
            lines.push('', `⚠️ 오류 로그 ${errors}건 발생 — /admin 에서 확인 권장`);
        }

        await _tgDirect(env, lines.join('\n'));
    } catch (e) {
        console.error('[daily-health]', e?.message);
    }
}
