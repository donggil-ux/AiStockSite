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
import { getMarketRegime, getSectorRotation } from '../utils/market.js';
import { _fetchDiscoverySymbols, DEFAULT_UNIVERSE_US, DEFAULT_UNIVERSE_KR } from '../cron.js';
import { paperOpenTrade, _tgDirect, TRANCHE_WEIGHTS, TRANCHE_WEIGHT_SUM, _etTotalMin, isSymbolBlocked } from '../utils/paper-engine.js';
import { classifySymbol, SECTOR_MAP, LEVERAGED_ETFS, INVERSE_ETFS } from '../utils/paper-category.js';
import { getPaperTradeParams } from '../utils/paper-optimizer.js';
import { getNewsSentiment } from '../utils/news-sentiment.js';
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
                    const vwap = calcVWAP(q);
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
                    const trend = smartDipScan(q, { interval: tf, ts: tts || [], spxTrendUp, measuredWin });
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
                        'INSERT INTO dt_signals (symbol,tf,dir,mode,grade,score,entry,stop,be,stop_dist,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
                    ).bind(r.symbol, tf, r.dir, r.mode || 'trend', r.grade, r.score, r.price, r.stop, r.be ?? null, stopDist, entryTs).run();
                    logged++;

                    if (r.dir === 'buy' || r.dir === 'sell') {
                        await _tryOpenPaperTrade(env, r, tf, dtInsert.meta?.last_row_id || null, params, accounts, regime, sectorRot);
                    }
                } catch (e) {
                    // 한 종목 처리 실패가 나머지 후보 전체를 막지 않도록 개별 격리
                    console.warn('[dt-capture] symbol err', r?.symbol, e?.message);
                }
            }
        } catch (e) { try { await logError(env, 'captureDailySignals', e.message); } catch (_) {} }
    }

    return { logged };
}

// ── ET 시간 필터: 정규장 9:40~15:30 ET만 허용 ────────────────────────────
// 프리마켓 제외 — Yahoo Finance 프리마켓 가격 데이터 불안정 (가격 괴리 → 손절 슬리피지 과대)
function _isGoodEntryTime() {
    const et = _etTotalMin();
    return et >= 9 * 60 + 40 && et < 15 * 60 + 30;
}

// ── 시간대별 최소 RVOL 임계값 ─────────────────────────────────────────────
// 점심(11:30~14:00 ET): 거래량 자연 감소 → 0.8로 완화
// 프리마켓(04:00~09:30 ET): 조용하지만 기회 존재 → 1.0
// 그 외(오전·파워아워): params.min_rvol 사용
function _sessionMinRvol(params) {
    const t = _etTotalMin();
    if (t >= 11 * 60 + 30 && t < 14 * 60) return 0.8;  // 점심 횡보 — 달러거래량($3M) 필터가 유동성 보장하므로 완화
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

    // ③ RVOL 필터 (시간대별 동적 임계값 — 점심 0.8 / 프리마켓 1.0 / 그 외 min_rvol)
    // 레버리지 ETF는 유동성 특성상 1.2로 완화 (SOXL 등은 rvol=1.0도 충분한 유동성)
    const minRvol = LEVERAGED_ETFS.has(r.symbol) ? 1.2 : _sessionMinRvol(params);
    if ((r.rvol || 0) < minRvol) {
        console.log(`[paper] ${r.symbol} rvol=${(r.rvol||0).toFixed(1)} < ${minRvol} — 스킵`);
        return;
    }

    // ④ 거래량 제로 종목 절대 진입 금지 (volAvg20 = 20봉 절대 평균 거래량)
    if ((r.volAvg20 ?? 0) < 1000) {
        console.log(`[paper] ${r.symbol} 거래량 부족 (volAvg20=${r.volAvg20 ?? 0}) — 진입 스킵`);
        return;
    }

    // ④.1 거래대금 필터 (원칙 1·2: 기준봉 거래대금 확인 — 최소 $3M per 5m bar ≈ KRW 5B/1분봉)
    const dollarVol = (r.price || 0) * (r.rvol || 0) * (r.volAvg20 || 0);
    if (dollarVol < 3_000_000) {
        console.log(`[paper] ${r.symbol} 거래대금 부족 $${(dollarVol / 1e6).toFixed(1)}M — 스킵`);
        return;
    }

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

    for (const acct of accounts) {
        // ⑩ 최대 포지션 수 체크 + 스타일별 한도 + 중복 종목 체크 (1회 DB 조회)
        const openPos = (await env.DB.prepare(
            "SELECT symbol, style FROM paper_trades WHERE user_id=? AND status='open'"
        ).bind(acct.user_id).all()).results || [];
        if (openPos.length >= maxPos) continue;
        const styleCount = openPos.filter(p => p.style === style).length;
        if (style === 'day'   && styleCount >= maxDayPos)   continue; // 단타 3개 한도
        if (style === 'swing' && styleCount >= maxSwingPos)  continue; // 스윙 3개 한도
        if (openPos.some(p => p.symbol === r.symbol)) continue; // 이미 보유 중

        // ⑪ 잔고 체크 — 단타/스윙 각자 풀에서 확인
        const posSize     = (style === 'day' ? acct.day_position_size : acct.swing_position_size) || (style === 'day' ? 10000 : 23000);
        const poolBalance = (style === 'day' ? acct.day_balance : acct.swing_balance) || 0;
        const firstAmount = posSize * TRANCHE_WEIGHTS[0] / TRANCHE_WEIGHT_SUM;
        if (poolBalance < firstAmount) continue;

        const qty = Math.floor(firstAmount / r.price);
        if (qty < 1) continue; // 고가 종목: 1주 미만이면 진입 스킵
        const result = await paperOpenTrade(env, {
            userId: acct.user_id, symbol: r.symbol,
            category, style,
            dir: isShortSignal ? 'short' : 'long', price: r.price, qty,
            signalId: dtId, grade: r.grade, score: r.score,
            // 스윙(일봉)만 신호의 ATR 기준 손절 사용 — 단타는 기존 고정 -0.8% 유지
            stopPrice: style === 'swing' ? r.stop : null,
        });
        console.log(`[paper] open ${r.symbol} ${isShortSignal?'short':'long'} ${style} grade=${r.grade} rvol=${(r.rvol||0).toFixed(1)} user=${acct.user_id}`);
        // 알림은 paperOpenTrade 내부에서 직접 발송됨
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
