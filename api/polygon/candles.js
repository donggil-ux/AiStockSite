const POLYGON_KEY = process.env.POLYGON_API;

const _cache = {};
const CACHE_TTL = 60 * 1000;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { ticker, timespan = 'minute',
            multiplier = 5, from, to } = req.query;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    if (!POLYGON_KEY) return res.status(500).json({ error: 'POLYGON_API not set' });

    const cacheKey = `${ticker}_${timespan}_${multiplier}`;
    const cached = _cache[cacheKey];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.status(200).json(cached.data);
    }

    try {
        const toDate   = to   || new Date().toISOString().split('T')[0];
        const fromDate = from || new Date(Date.now() - 7 * 86400000)
                                    .toISOString().split('T')[0];

        const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}`
            + `/range/${multiplier}/${timespan}/${fromDate}/${toDate}`
            + `?adjusted=true&sort=asc&limit=5000`
            + `&apiKey=${POLYGON_KEY}`;

        const r = await fetch(url);
        if (!r.ok) throw new Error('polygon http ' + r.status);
        const data = await r.json();

        if (data.status === 'ERROR') throw new Error(data.error || 'polygon error');

        const candles = (data.results || []).map(c => ({
            time:   Math.floor(c.t / 1000),
            open:   c.o, high: c.h,
            low:    c.l, close: c.c,
            volume: c.v,
        }));

        const result = {
            source: 'polygon', ticker,
            timespan, multiplier: +multiplier,
            count: candles.length, candles,
        };

        _cache[cacheKey] = { ts: Date.now(), data: result };
        return res.status(200).json(result);

    } catch(e) {
        console.error('[polygon/candles]', ticker, e.message);
        return res.status(500).json({ error: e.message });
    }
};
