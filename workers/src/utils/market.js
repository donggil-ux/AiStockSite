// 시장 레짐(장세) 판정 — SPY 추세 + VIX 변동성
// 데일리 단타 승률의 최대 레버: 위험 장세에선 약한 매수 신호를 억제.
import { yfRequest } from './crumb.js';
import { calcEMA } from './indicators.js';

const CACHE_KEY = 'regime:US';
const CACHE_TTL = 300; // 5분

const NEUTRAL = { regime: 'neutral', label: '중립', spyTrend: 'flat', spyChgPct: 0, vix: null, note: '판정 보류' };

/**
 * @returns {{regime:'favorable'|'neutral'|'risk_off', label, spyTrend, spyChgPct, vix, note}}
 */
export async function getMarketRegime(env) {
    try {
        const cached = await env.CACHE.get(CACHE_KEY, 'json');
        if (cached) return cached;
    } catch (_) {}

    try {
        const base = 'https://query1.finance.yahoo.com/v8/finance/chart/';
        const [spyR, vixR] = await Promise.allSettled([
            yfRequest(env.CACHE, base + 'SPY?range=3mo&interval=1d'),
            yfRequest(env.CACHE, base + '%5EVIX?range=5d&interval=1d'),
        ]);

        // SPY 추세
        let spyTrend = 'flat', spyChgPct = 0, spyAboveEma = null;
        if (spyR.status === 'fulfilled') {
            const q = spyR.value?.chart?.result?.[0]?.indicators?.quote?.[0];
            const closes = (q?.close || []).filter(v => v != null);
            if (closes.length >= 21) {
                const cur = closes[closes.length - 1];
                const prev = closes[closes.length - 2];
                const ema20 = calcEMA(closes, 20);
                const e = ema20[ema20.length - 1];
                spyAboveEma = e != null ? cur > e : null;
                spyChgPct = prev ? +(((cur / prev) - 1) * 100).toFixed(2) : 0;
                spyTrend = spyAboveEma === true ? 'up' : spyAboveEma === false ? 'down' : 'flat';
            }
        }

        // VIX 현재값
        let vix = null;
        if (vixR.status === 'fulfilled') {
            const vc = (vixR.value?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
            if (vc.length) vix = +vc[vc.length - 1].toFixed(1);
        }

        // 판정
        let regime = 'neutral';
        if (spyAboveEma === false || (vix != null && vix >= 25)) regime = 'risk_off';
        else if (spyAboveEma === true && (vix == null || vix < 18)) regime = 'favorable';

        const label = regime === 'favorable' ? '우호' : regime === 'risk_off' ? '위험' : '중립';
        const note = regime === 'risk_off'
            ? '하락추세/고변동 — 매수 신중'
            : regime === 'favorable' ? '상승추세/저변동 — 매수 우호' : '혼조';

        const out = { regime, label, spyTrend, spyChgPct, vix, note };
        try { await env.CACHE.put(CACHE_KEY, JSON.stringify(out), { expirationTtl: CACHE_TTL }); } catch (_) {}
        return out;
    } catch (e) {
        return { ...NEUTRAL, note: 'fetch fail: ' + (e.message || '') };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// 원칙 11: 섹터 로테이션 — SPDR 11개 섹터 ETF 당일 등락률 순위 (5분 캐시)
// leading: 상위 40% 섹터, lagging: 하위 40% 섹터
// ─────────────────────────────────────────────────────────────────────────
const SECTOR_ROT_KEY = 'sector_rot:v1';
const SECTOR_ETFS = ['XLK','XLC','XLY','XLF','XLE','XLV','XLI','XLB','XLRE','XLU','XLP'];

export async function getSectorRotation(env) {
    try {
        const cached = await env.CACHE.get(SECTOR_ROT_KEY, 'json');
        if (cached) return cached;
    } catch (_) {}
    try {
        const base = 'https://query1.finance.yahoo.com/v8/finance/chart/';
        const perf = (await Promise.all(
            SECTOR_ETFS.map(sym =>
                yfRequest(env.CACHE, `${base}${sym}?range=1d&interval=5m`)
                    .then(raw => {
                        const c = (raw?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
                        return { sym, chg: c.length > 1 ? +((c[c.length-1] - c[0]) / c[0] * 100).toFixed(2) : 0 };
                    })
                    .catch(() => ({ sym, chg: 0 }))
            )
        )).sort((a, b) => b.chg - a.chg);
        const cut = Math.ceil(perf.length * 0.4); // top/bottom 40%
        const out = { leading: perf.slice(0, cut).map(r => r.sym), lagging: perf.slice(-cut).map(r => r.sym), perf };
        try { await env.CACHE.put(SECTOR_ROT_KEY, JSON.stringify(out), { expirationTtl: CACHE_TTL }); } catch (_) {}
        return out;
    } catch (_) { return { leading: [], lagging: [], perf: [] }; }
}
