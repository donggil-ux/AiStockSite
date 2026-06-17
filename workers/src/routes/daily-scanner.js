// 데일리 트레이딩 스캐너 — 실시간 5분/15분봉 매수·매도 후보
// GET /api/scanner/daily-trading?market=US&tf=5m
//
// 분석 엔진: Smart Dip v3 (컨플루언스 품질 필터) — 개별 차트 Smart Dip 과 동일 방법론.
//   buy  = 상승추세 눌림목 진입 / sell = 하락추세 반등 소진 진입
//   8개 필터(ADX·HTF추세·거래량회복·양봉/음봉·ATR·SPX환경·RSI·장초반) 통과 종목만.
import { json, err } from '../utils/validators.js';
import { calcVWAP, calcVWAPSeries } from '../utils/indicators.js';
import { smartDipScan, smartDipScanBounce, smartDipBacktest, resolveTrailExit } from '../utils/smart-dip.js';
import { fetchChartWithFallback } from './yahoo.js';
import { getMarketRegime } from '../utils/market.js';
import { _fetchDiscoverySymbols, DEFAULT_UNIVERSE_US, DEFAULT_UNIVERSE_KR } from '../cron.js';
import { paperOpenTrade, TRANCHE_WEIGHTS, TRANCHE_WEIGHT_SUM } from '../utils/paper-engine.js';
import { classifySymbol } from '../utils/paper-category.js';
import { logError } from '../utils/errors.js';

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
    if (m >= 810 && m < 870) return 'open_drive';   // 13:30–14:30 UTC (장 초반 30~60분)
    if (m >= 930 && m < 1110) return 'midday';       // 15:30–18:30 UTC (점심 횡보)
    if (m >= 1170 && m <= 1260) return 'power_hour'; // 19:30–21:00 UTC (파워아워)
    return 'regular';
}

export async function handleDailyTradingScan(req, env) {
    try {
        const url = new URL(req.url);
        const market = url.searchParams.get('market') === 'KR' ? 'KR' : 'US';
        const tf = url.searchParams.get('tf') === '15m' ? '15m' : '5m';
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
        // Smart Dip 필터 6번(SPX 환경) 입력 — 레짐의 SPY 추세 재사용
        const spxTrendUp = regime.spyTrend === 'up' ? true : regime.spyTrend === 'down' ? false : null;
        // 백테스트 실측 승률 (있으면 등급 기본값 대신 사용)
        const measuredWin = await _loadMeasuredWin(env, tf);

        // 유니버스 — 기본 풀 + 당일 활발 종목(US 스크리너)
        const base = market === 'KR' ? DEFAULT_UNIVERSE_KR : DEFAULT_UNIVERSE_US;
        const dynamic = await _fetchDiscoverySymbols(env, market);
        const universe = [...new Set([...base, ...dynamic])].slice(0, 40);

        // 5m·15m 모두 5d — 장 마감·주말에도 300봉 이상 확보 (1d는 주말 3봉뿐)
        const range = '5d';

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
                    const raw = await fetchChartWithFallback(env, symbol, range, tf, 'false');
                    const result0 = raw?.chart?.result?.[0];
                    const qRaw = result0?.indicators?.quote?.[0];
                    if (!qRaw?.close?.length || qRaw.close.length < 60) { _dbg.noData++; return; }

                    // 주말·장마감 후 0거래량 빈 봉 제거 → 진짜 마지막 봉 기준 분석
                    const { q, ts: tts } = _trimTrailing(qRaw, result0?.timestamp);
                    if (!q?.close?.length || q.close.length < 60) { _dbg.noData++; return; }

                    analyzed++;
                    const vwap = calcVWAP(q);
                    const session = _session((tts || [])[(tts || []).length - 1]);
                    // 점심 시간대 필터 제거 — 신호 자체는 내보내고 세션 태그("점심")로 UI에서 표시
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
                        vwapPos: (vwap != null) ? (sig.price >= vwap ? 'above' : 'below') : null,
                        adx: sig.adx,
                        atrPct: sig.atrPct,
                        barsAgo: sig.barsAgo,
                        stop: sig.stop, be: sig.be, target1: sig.target1, target2: sig.target2, riskPct: sig.riskPct,
                        winMeasured: sig.winMeasured,
                        session,
                        riskWarn: (regime.regime === 'risk_off' && sig.dir === 'buy' && sig.grade !== 'S' && (sig.mode || 'trend') === 'trend'),
                    });

                    // ── 추세 신호 (Smart Dip 추세추종) ──
                    const trend = smartDipScan(q, { interval: tf, ts: tts || [], spxTrendUp, measuredWin });
                    if (trend) { results.push(mkResult(trend)); if (trend.dir === 'buy') _dbg.rawBuy++; else _dbg.rawSell++; }

                    // ── 역추세 반등 매수 (독립 실행 — 매도 신호와 무관하게 A급 반등은 추가) ──
                    // 단, 추세가 이미 '매수'면 중복 방지로 생략.
                    if (!trend || trend.dir !== 'buy') {
                        const bounce = smartDipScanBounce(q, { ts: tts || [], measuredWin });
                        if (bounce) { _dbg.bounceAny++; if (bounce.grade === 'A') _dbg.bounceA++; }
                        if (bounce && bounce.grade === 'A') { results.push(mkResult(bounce)); _dbg.rawBuy++; }
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
        const tf = url.searchParams.get('tf') === '15m' ? '15m' : '5m';
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
        // 5m: 1개월(≈30일×78봉) / 15m: 3개월
        const range = tf === '15m' ? '3mo' : '1mo';

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
    let logged = 0;
    for (const tf of ['5m', '15m']) {
        try {
            const resp = await handleDailyTradingScan(new Request(`https://x/api/scanner/daily-trading?market=US&tf=${tf}`), env);
            const data = await resp.json();
            const results = data.results || [];
            const tfMin = tf === '15m' ? 15 : 5;
            for (const r of results) {
                if (r.stop == null || r.price == null) continue;
                const stopDist = Math.abs(r.price - r.stop);
                if (!(stopDist > 0)) continue;
                // 진입 시각 ≈ 스캔시각 − barsAgo×봉길이 (forward 시뮬 시작점)
                const entryTs = (data.scannedAt || Date.now()) - (r.barsAgo || 0) * tfMin * 60000;
                // 중복 방지: 같은 종목·방향·tf 신호가 최근 2시간 내 있으면 skip
                const since = Date.now() - 2 * 3600 * 1000;
                const dup = await env.DB.prepare(
                    'SELECT 1 FROM dt_signals WHERE symbol=? AND dir=? AND tf=? AND created_at>? LIMIT 1'
                ).bind(r.symbol, r.dir, tf, since).first();
                if (dup) continue;
                const dtInsert = await env.DB.prepare(
                    'INSERT INTO dt_signals (symbol,tf,dir,mode,grade,score,entry,stop,be,stop_dist,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
                ).bind(r.symbol, tf, r.dir, r.mode || 'trend', r.grade, r.score, r.price, r.stop, r.be ?? null, stopDist, entryTs).run();
                logged++;

                // 가상 자동매매 중단 — 추천 모드 전환 (시그널 기록은 계속)
            }
        } catch (e) { try { await logError(env, 'captureDailySignals', e.message); } catch (_) {} }
    }
    return { logged };
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
                const range = tf === '15m' ? '1mo' : '5d';
                const raw = await fetchChartWithFallback(env, symbol, range, tf, 'false');
                const r0 = raw?.chart?.result?.[0];
                const ts = r0?.timestamp || [];
                const q = r0?.indicators?.quote?.[0];
                if (!q?.close?.length) continue;
                const horizon = tf === '15m' ? 16 : 24;
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
                    } else if (ageH > 48) {
                        // 2일+ 미해소(데이터 부족 등) → 마지막가로 강제 timeout
                        const ex = bars.length ? bars[bars.length - 1].close : row.entry;
                        const exitR = +(((row.dir === 'buy' ? (ex - row.entry) : (row.entry - ex)) / row.stop_dist)).toFixed(2);
                        await env.DB.prepare("UPDATE dt_signals SET resolved=1, outcome='timeout', exit_price=?, exit_r=?, resolved_at=? WHERE id=?")
                            .bind(ex, exitR, Date.now(), row.id).run();
                        resolved++;
                    }
                }
            } catch (_) {}
        }
    } catch (e) { try { await logError(env, 'resolveDailySignals', e.message); } catch (_) {} }
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
