// /api/kiwoom/candles.js
const { getToken } = require('./token');

const APP_KEY  = process.env.KIWOOM_APP_KEY;
const BASE_URL = 'https://openapi.kiwoom.com';

const _cache = {};
const CACHE_TTL = 10 * 1000; // 10초

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { ticker, type = 'D', timeUnit = '1' } = req.query;
    // type: T=틱, M=분, D=일, W=주, MM=월
    if (!ticker) return res.status(400).json({ error: 'ticker required' });

    const cacheKey = `${ticker}_${type}_${timeUnit}`;
    const cached = _cache[cacheKey];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.status(200).json(cached.data);
    }

    try {
        const token = await getToken();

        const endpointMap = {
            'M': `/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`,   // 분봉
            'D': `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`,  // 일봉
            'W': `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`,  // 주봉
        };
        const trIdMap = {
            'M': 'FHKST03010200',
            'D': 'FHKST03010100',
            'W': 'FHKST03010100',
        };

        const endpoint = endpointMap[type] || endpointMap['D'];
        const trId     = trIdMap[type]     || trIdMap['D'];

        const params = type === 'M'
            ? `?fid_etc_cls_code=&fid_cond_mrkt_div_code=J`
              + `&fid_input_iscd=${ticker}`
              + `&fid_input_hour_1=${timeUnit}`
              + `&fid_pw_data_incu_yn=Y`
            : `?fid_cond_mrkt_div_code=J`
              + `&fid_input_iscd=${ticker}`
              + `&fid_input_date_1=19000101`
              + `&fid_input_date_2=99991231`
              + `&fid_period_div_code=${type}`
              + `&fid_org_adj_prc=1`;

        const r = await fetch(`${BASE_URL}${endpoint}${params}`, {
            headers: {
                'Content-Type':  'application/json',
                'authorization': `Bearer ${token}`,
                'appkey':         APP_KEY,
                'tr_id':          trId,
            },
        });

        // IP 제한 에러 처리
        if (r.status === 401 || r.status === 403) {
            console.warn('[kiwoom/candles] IP not allowed or token expired');
            return res.status(200).json({
                error:   'ip_not_allowed',
                candles: [],
                source:  'kiwoom_blocked',
            });
        }

        if (!r.ok) throw new Error('kiwoom candles ' + r.status);
        const d = await r.json();

        const rawList = d.output2 || d.output || [];
        const candles = rawList
            .filter(c => c.stck_bsop_date || c.stck_cntg_hour)
            .map(c => {
                let dt;
                if (type === 'M') {
                    const ds = c.stck_bsop_date || '';
                    const ts = c.stck_cntg_hour || '000000';
                    dt = new Date(
                        `${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}`
                        + `T${ts.slice(0,2)}:${ts.slice(2,4)}:${ts.slice(4,6)}+09:00`
                    );
                } else {
                    const ds = c.stck_bsop_date || '';
                    dt = new Date(`${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}T00:00:00+09:00`);
                }
                return {
                    time:   Math.floor(dt.getTime() / 1000),
                    open:   parseFloat(c.stck_oprc || 0),
                    high:   parseFloat(c.stck_hgpr || 0),
                    low:    parseFloat(c.stck_lwpr || 0),
                    close:  parseFloat(c.stck_clpr || c.stck_prpr || 0),
                    volume: parseInt(c.cntg_vol || c.acml_vol || 0),
                };
            })
            .filter(c => c.time > 0 && c.close > 0)
            .sort((a, b) => a.time - b.time);

        const result = {
            source: 'kiwoom',
            ticker,
            type,
            timeUnit,
            count: candles.length,
            candles,
        };

        _cache[cacheKey] = { ts: Date.now(), data: result };
        return res.status(200).json(result);

    } catch(e) {
        console.error('[kiwoom/candles]', ticker, e.message);
        return res.status(500).json({ error: e.message });
    }
};
