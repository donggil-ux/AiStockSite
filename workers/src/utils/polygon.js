// Polygon.io 백업 fetch — Yahoo crumb 실패 / 429 시 자동 fallback
// 출력 포맷을 Yahoo Finance chart API 응답 형태로 변환 → 클라이언트/cron 코드 변경 없이 호환

// 5분봉 1봉 = 5분, 1일봉 1봉 = 1일.
// Polygon API: /v2/aggs/ticker/{TICKER}/range/{MULT}/{TIMESPAN}/{FROM}/{TO}

const IV_TO_POLY = {
    '1m':  { timespan: 'minute', mult: 1 },
    '2m':  { timespan: 'minute', mult: 2 },
    '5m':  { timespan: 'minute', mult: 5 },
    '15m': { timespan: 'minute', mult: 15 },
    '30m': { timespan: 'minute', mult: 30 },
    '60m': { timespan: 'hour',   mult: 1 },
    '1h':  { timespan: 'hour',   mult: 1 },
    '90m': { timespan: 'hour',   mult: 1 }, // Polygon에 90분 없음 → 1시간으로 근사
    '1d':  { timespan: 'day',    mult: 1 },
    '1wk': { timespan: 'week',   mult: 1 },
    '1mo': { timespan: 'month',  mult: 1 },
};

// range → from/to YYYY-MM-DD 계산
function rangeToDates(range) {
    const now = new Date();
    const to = now.toISOString().split('T')[0];
    const days = {
        '1d': 3, '5d': 8, '1mo': 35, '3mo': 95, '6mo': 190,
        '1y': 370, '2y': 740, '5y': 1830, '10y': 3660, 'ytd': 365, 'max': 3660,
    }[range] || 35;
    const from = new Date(now.getTime() - days * 86400000).toISOString().split('T')[0];
    return { from, to };
}

/**
 * Yahoo Finance v8/finance/chart 응답 형태로 Polygon 데이터 변환
 * @returns 동일한 { chart: { result: [{ meta, timestamp, indicators: {quote: [{...}]} }] } }
 */
export async function polygonChartFallback(env, symbol, range, interval) {
    if (!env.POLYGON_API) throw new Error('POLYGON_API not configured');
    const cfg = IV_TO_POLY[interval];
    if (!cfg) throw new Error(`unsupported interval: ${interval}`);
    const { from, to } = rangeToDates(range);
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}`
        + `/range/${cfg.mult}/${cfg.timespan}/${from}/${to}`
        + `?adjusted=true&sort=asc&limit=50000&apiKey=${env.POLYGON_API}`;
    const res = await fetch(url);
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Polygon ${res.status}: ${txt.slice(0, 150)}`);
    }
    const raw = await res.json();
    const results = raw?.results || [];
    if (!results.length) {
        return { chart: { result: [{
            meta: { symbol, currency: 'USD', regularMarketTime: Math.floor(Date.now()/1000) },
            timestamp: [],
            indicators: { quote: [{ open:[], high:[], low:[], close:[], volume:[] }] },
        }]}};
    }
    // Polygon results → Yahoo 형태로 변환
    const timestamp = results.map(r => Math.floor(r.t / 1000));
    const open  = results.map(r => r.o ?? null);
    const high  = results.map(r => r.h ?? null);
    const low   = results.map(r => r.l ?? null);
    const close = results.map(r => r.c ?? null);
    const volume= results.map(r => r.v ?? null);
    const lastClose = close[close.length - 1] || 0;
    return {
        chart: { result: [{
            meta: {
                symbol: symbol.toUpperCase(),
                currency: 'USD',
                exchangeName: 'NYQ',
                regularMarketPrice: lastClose,
                regularMarketTime: timestamp[timestamp.length - 1] || Math.floor(Date.now()/1000),
                chartPreviousClose: results[0]?.c || lastClose,
                dataGranularity: interval,
                _source: 'polygon-fallback',
            },
            timestamp,
            indicators: { quote: [{ open, high, low, close, volume }] },
        }]},
    };
}
