// Polygon.io 캔들 프록시 — 미국 종목 전용 (분봉/일봉)
// 시크릿: wrangler secret put POLYGON_API
import { validSymbol, validDate, VALID_TIMESPANS, json, err } from '../utils/validators.js';

const TTL_INTRADAY = 60;  // 1분 (KV TTL)
const TTL_DAILY    = 300; // 5분

export async function handlePolygonCandles(req, env) {
    if (!env.POLYGON_API) return err(503, 'Polygon API key not configured');
    const url = new URL(req.url);
    const ticker    = url.searchParams.get('ticker') || '';
    const timespan  = url.searchParams.get('timespan') || 'minute';
    const multiplier= url.searchParams.get('multiplier') || '5';
    const from      = url.searchParams.get('from') || '';
    const to        = url.searchParams.get('to') || '';

    if (!validSymbol(ticker)) return err(400, 'invalid ticker');
    if (!VALID_TIMESPANS.has(timespan)) return err(400, 'invalid timespan');
    const mult = parseInt(multiplier, 10);
    if (!mult || mult < 1 || mult > 1440) return err(400, 'invalid multiplier');
    if (!validDate(from) || !validDate(to)) return err(400, 'from/to must be YYYY-MM-DD');

    const cacheKey = `polygon:${ticker}:${timespan}:${mult}:${from}:${to}`;
    const ttl = ['day','week','month'].includes(timespan) ? TTL_DAILY : TTL_INTRADAY;

    try {
        const cached = await env.CACHE.get(cacheKey, 'json');
        if (cached) return json(cached);
    } catch (_) {}

    try {
        const polygonUrl = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker.toUpperCase())}`
            + `/range/${mult}/${timespan}/${from}/${to}`
            + `?adjusted=true&sort=asc&limit=50000&apiKey=${env.POLYGON_API}`;

        const res = await fetch(polygonUrl);
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            return err(res.status, `Polygon ${res.status}: ${txt.slice(0, 200)}`);
        }
        const raw = await res.json();
        if (!raw?.results?.length) return json({ candles: [] });
        // server.js 와 동일한 응답 포맷
        const candles = raw.results.map(r => ({
            time:   Math.floor(r.t / 1000), // ms → s
            open:   r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
        }));
        const data = { ticker, timespan, multiplier: mult, candles };
        try { await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: ttl }); } catch (_) {}
        return json(data);
    } catch (e) {
        return err(500, e.message);
    }
}
