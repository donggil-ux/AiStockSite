const POLYGON_KEY = process.env.POLYGON_API;

const _cache = {};
const CACHE_TTL = 10 * 1000;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { ticker } = req.query;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    if (!POLYGON_KEY) return res.status(500).json({ error: 'POLYGON_API not set' });

    const cached = _cache[ticker];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.status(200).json(cached.data);
    }

    try {
        const url = `https://api.polygon.io/v2/last/trade/${ticker}`
            + `?apiKey=${POLYGON_KEY}`;

        const r = await fetch(url);
        if (!r.ok) throw new Error('polygon http ' + r.status);
        const data = await r.json();

        const result = {
            ticker,
            price:  data.results?.p,
            size:   data.results?.s,
            time:   data.results?.t,
            source: 'polygon',
        };

        _cache[ticker] = { ts: Date.now(), data: result };
        return res.status(200).json(result);

    } catch(e) {
        console.error('[polygon/quote]', ticker, e.message);
        return res.status(500).json({ error: e.message });
    }
};
