// /api/kiwoom/token.js
const APP_KEY    = process.env.KIWOOM_APP_KEY;
const APP_SECRET = process.env.KIWOOM_APP_SECRET;
const BASE_URL   = 'https://openapi.kiwoom.com';

// 토큰 캐시 (23시간)
let _cache = { token: null, expires: 0 };

async function getToken() {
    if (_cache.token && Date.now() < _cache.expires) {
        return _cache.token;
    }

    const r = await fetch(`${BASE_URL}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            appkey:     APP_KEY,
            secretkey:  APP_SECRET,
        }),
    });

    if (!r.ok) throw new Error('kiwoom token ' + r.status);
    const d = await r.json();

    _cache = {
        token:   d.token,
        expires: Date.now() + (23 * 60 * 60 * 1000), // 23시간
    };

    return _cache.token;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!APP_KEY || !APP_SECRET) {
        return res.status(500).json({ error: 'KIWOOM keys not set' });
    }
    try {
        const token = await getToken();
        return res.status(200).json({ ok: true, token });
    } catch(e) {
        return res.status(500).json({ error: e.message });
    }
};

module.exports.getToken = getToken;
