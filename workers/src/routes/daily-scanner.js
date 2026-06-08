// 데일리 트레이딩 스캐너 — 실시간 5분/15분봉 매수·매도 후보
// GET /api/scanner/daily-trading?market=US&tf=5m
//
// 분석 엔진: Smart Dip v3 (컨플루언스 품질 필터) — 개별 차트 Smart Dip 과 동일 방법론.
//   buy  = 상승추세 눌림목 진입 / sell = 하락추세 반등 소진 진입
//   8개 필터(ADX·HTF추세·거래량회복·양봉/음봉·ATR·SPX환경·RSI·장초반) 통과 종목만.
import { json, err } from '../utils/validators.js';
import { calcVWAP } from '../utils/indicators.js';
import { smartDipScan } from '../utils/smart-dip.js';
import { fetchChartWithFallback } from './yahoo.js';
import { getMarketRegime } from '../utils/market.js';
import { _fetchDiscoverySymbols, DEFAULT_UNIVERSE_US, DEFAULT_UNIVERSE_KR } from '../cron.js';

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

        // 유니버스 — 기본 풀 + 당일 활발 종목(US 스크리너)
        const base = market === 'KR' ? DEFAULT_UNIVERSE_KR : DEFAULT_UNIVERSE_US;
        const dynamic = await _fetchDiscoverySymbols(env, market);
        const universe = [...new Set([...base, ...dynamic])].slice(0, 40);

        // 5m·15m 모두 5d — 장 마감·주말에도 300봉 이상 확보 (1d는 주말 3봉뿐)
        const range = '5d';

        const results = [];
        let analyzed = 0;
        // 필터 단계별 탈락 카운터 (디버깅용)
        let _dbg = { noData: 0, noPass: 0, rawBuy: 0, rawSell: 0 };
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
                    // ── Smart Dip v3 컨플루언스 필터 (개별 차트 Smart Dip 과 동일 엔진) ──
                    const sig = smartDipScan(q, { interval: tf, ts: tts || [], spxTrendUp });
                    if (!sig) { _dbg.noPass++; return; }
                    if (sig.dir === 'buy') _dbg.rawBuy++; else _dbg.rawSell++;

                    // VWAP 위치 — 참고용 pill (게이트 아님)
                    const vwap = calcVWAP(q);
                    const vwapPos = (vwap != null) ? (sig.price >= vwap ? 'above' : 'below') : null;

                    // ── 레짐 경고: 위험 장세 + 매수 + 비S급 → 경고 태그 (차단 아님) ──
                    const riskWarn = (regime.regime === 'risk_off' && sig.dir === 'buy' && sig.grade !== 'S');

                    const session = _session((tts || [])[(tts || []).length - 1]);

                    results.push({
                        symbol,
                        dir: sig.dir,
                        grade: sig.grade,
                        score: sig.qualityScore,
                        winRate: sig.winRate,
                        factors: sig.reasons,
                        price: sig.price,
                        rsi: sig.rsiVal,
                        rvol: sig.volRatio,
                        vwapPos,
                        adx: sig.adx,
                        atrPct: sig.atrPct,
                        barsAgo: sig.barsAgo,
                        session,
                        riskWarn,
                    });
                } catch (_) {}
            }));
        }

        // 점수(컨플루언스) 내림차순
        results.sort((a, b) => b.score - a.score);

        // A급 이상 엄선 (S/A). A+ 가 하나도 없으면 B급이라도 노출 (빈 화면 방지).
        let curated = results.filter(r => r.grade === 'S' || r.grade === 'A');
        if (!curated.length) curated = results;
        curated = curated.slice(0, 20);

        const payload = {
            results: curated,
            regime,
            totalScanned: analyzed,
            totalCandidates: results.length,
            universe: universe.length,
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
