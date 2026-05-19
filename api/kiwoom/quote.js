// /api/kiwoom/quote.js
const { getToken } = require('./token');

const APP_KEY  = process.env.KIWOOM_APP_KEY;
const BASE_URL = 'https://openapi.kiwoom.com';

const _cache = {};
const CACHE_TTL = 3 * 1000; // 3초

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { ticker } = req.query;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });

    const cached = _cache[ticker];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.status(200).json(cached.data);
    }

    try {
        const token = await getToken();

        const r = await fetch(
            `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`
            + `?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}`,
            {
                headers: {
                    'Content-Type':  'application/json',
                    'authorization': `Bearer ${token}`,
                    'appkey':         APP_KEY,
                    'tr_id':          'FHKST01010100',
                },
            }
        );

        // IP 제한 에러 처리
        if (r.status === 401 || r.status === 403) {
            console.warn('[kiwoom/quote] IP not allowed or token expired');
            return res.status(200).json({
                error:  'ip_not_allowed',
                price:  0,
                source: 'kiwoom_blocked',
            });
        }

        if (!r.ok) throw new Error('kiwoom quote ' + r.status);
        const d = await r.json();
        const o = d.output || {};

        const result = {
            ticker,
            price:     parseFloat(o.stck_prpr || 0),   // 현재가
            change:    parseFloat(o.prdy_vrss || 0),    // 전일 대비
            changePct: parseFloat(o.prdy_ctrt || 0),    // 등락률
            volume:    parseInt(o.acml_vol   || 0),     // 누적 거래량
            high:      parseFloat(o.stck_hgpr || 0),    // 고가
            low:       parseFloat(o.stck_lwpr || 0),    // 저가
            open:      parseFloat(o.stck_oprc || 0),    // 시가
            source:    'kiwoom',
        };

        _cache[ticker] = { ts: Date.now(), data: result };
        return res.status(200).json(result);

    } catch(e) {
        console.error('[kiwoom/quote]', ticker, e.message);
        return res.status(500).json({ error: e.message });
    }
};
