// 데일리 트레이딩 스캐너 — 실시간 5분/15분봉 매수·매도 후보 (A급 이상, 거래량 확인)
// GET /api/scanner/daily-trading?market=US&tf=5m
//
// 기존 cron analyzeSignals 의 스캔 로직(universe→fetch→detectSignal)을 재사용하되,
// 푸시 없이 후보 리스트만 반환. 거래량(RVOL≥1.2) 받쳐주는 A/S급만.
import { json, err } from '../utils/validators.js';
import { detectSignal, calcVWAP, calcADX } from '../utils/indicators.js';
import { fetchChartWithFallback } from './yahoo.js';
import { loadAlgorithmConfig } from '../utils/calibration.js';
import { getMarketRegime } from '../utils/market.js';
import { _fetchDiscoverySymbols, DEFAULT_UNIVERSE_US, DEFAULT_UNIVERSE_KR } from '../cron.js';

const CACHE_TTL = 90; // intraday — 90초

// 최근봉 거래량 / 직전 8봉 평균 (detectSignal 내부와 동일 방식)
function _rvol(volume) {
    const i = volume.length - 1;
    if (i < 1) return 0;
    const slice = volume.slice(Math.max(0, i - 8), i).filter(v => v != null);
    const avg = slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
    const cur = volume[i] || 0;
    return avg > 0 ? cur / avg : 0;
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

        const thresholds = await loadAlgorithmConfig(env);
        // 시장 레짐 — US 한정 (KR 은 중립 취급)
        const regime = market === 'KR'
            ? { regime: 'neutral', label: '중립', spyTrend: 'flat', spyChgPct: 0, vix: null, note: 'KR' }
            : await getMarketRegime(env);

        // 유니버스 — 기본 풀 + 당일 활발 종목(US 스크리너)
        const base = market === 'KR' ? DEFAULT_UNIVERSE_KR : DEFAULT_UNIVERSE_US;
        const dynamic = await _fetchDiscoverySymbols(env, market);
        const universe = [...new Set([...base, ...dynamic])].slice(0, 40);

        // 15분봉은 1d 범위면 봉 부족(<30) → 5d 사용
        const range = tf === '15m' ? '5d' : '1d';

        const results = [];
        let analyzed = 0;
        // 10개씩 청크 병렬
        const CHUNK = 10;
        for (let k = 0; k < universe.length; k += CHUNK) {
            const chunk = universe.slice(k, k + CHUNK);
            await Promise.all(chunk.map(async (symbol) => {
                try {
                    const raw = await fetchChartWithFallback(env, symbol, range, tf, 'false');
                    const result0 = raw?.chart?.result?.[0];
                    const q = result0?.indicators?.quote?.[0];
                    if (!q?.close?.length || q.close.length < 30) return;
                    analyzed++;
                    const sig = detectSignal(q, thresholds);
                    if (!sig) return;
                    if (sig.grade !== 'S' && sig.grade !== 'A') return; // A급 이상만
                    const rvol = _rvol(q.volume || []);
                    if (rvol < 1.2) return; // 거래량 받쳐주는 종목만

                    // ── 진입 품질: VWAP 위치 + ADX 추세강도 ──
                    const vwap = calcVWAP(q);
                    const adxV = calcADX(q.high || [], q.low || [], q.close || []);
                    const price = sig.price;
                    const vwapPos = (vwap != null) ? (price >= vwap ? 'above' : 'below') : null;
                    // 매수는 VWAP 위 + ADX≥20, 매도는 VWAP 아래 + ADX≥20 (횡보·반대편 컷)
                    if (adxV != null && adxV < 20) return;
                    if (vwapPos === 'below' && sig.dir === 'buy') return;
                    if (vwapPos === 'above' && sig.dir === 'sell') return;

                    // ── 레짐 게이트: 위험 장세엔 약한 매수(A급) 제외, S급·매도는 유지 ──
                    if (regime.regime === 'risk_off' && sig.dir === 'buy' && sig.grade !== 'S') return;

                    const ts = result0?.timestamp || [];
                    const session = _session(ts[ts.length - 1]);

                    results.push({
                        symbol,
                        dir: sig.dir,
                        grade: sig.grade,
                        score: Math.round(sig.score * 10) / 10,
                        winRate: sig.winRate,
                        factors: sig.factors.slice(0, 4),
                        price: sig.price,
                        rsi: Math.round(sig.rsi),
                        rvol: Math.round(rvol * 10) / 10,
                        vwapPos,
                        adx: adxV != null ? Math.round(adxV) : null,
                        session,
                    });
                } catch (_) {}
            }));
        }

        // 점수 내림차순
        results.sort((a, b) => b.score - a.score);

        const payload = {
            results,
            regime,
            totalScanned: analyzed,
            universe: universe.length,
            tf,
            market,
            scannedAt: Date.now(),
        };
        try { await env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL }); } catch (_) {}
        return json(payload);
    } catch (e) {
        return err(500, e.message);
    }
}
