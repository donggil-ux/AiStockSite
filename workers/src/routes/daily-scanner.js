// 데일리 트레이딩 스캐너 — 실시간 5분/15분봉 매수·매도 후보 (A급 이상, 거래량 확인)
// GET /api/scanner/daily-trading?market=US&tf=5m
//
// 기존 cron analyzeSignals 의 스캔 로직(universe→fetch→detectSignal)을 재사용하되,
// 푸시 없이 후보 리스트만 반환. 거래량(RVOL≥1.2) 받쳐주는 A/S급만.
import { json, err } from '../utils/validators.js';
import { detectSignal } from '../utils/indicators.js';
import { fetchChartWithFallback } from './yahoo.js';
import { loadAlgorithmConfig } from '../utils/calibration.js';
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
                    const q = raw?.chart?.result?.[0]?.indicators?.quote?.[0];
                    if (!q?.close?.length || q.close.length < 30) return;
                    analyzed++;
                    const sig = detectSignal(q, thresholds);
                    if (!sig) return;
                    if (sig.grade !== 'S' && sig.grade !== 'A') return; // A급 이상만
                    const rvol = _rvol(q.volume || []);
                    if (rvol < 1.2) return; // 거래량 받쳐주는 종목만
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
                    });
                } catch (_) {}
            }));
        }

        // 점수 내림차순
        results.sort((a, b) => b.score - a.score);

        const payload = {
            results,
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
