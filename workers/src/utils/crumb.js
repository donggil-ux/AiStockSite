// Yahoo Finance crumb 토큰 인증 — Cloudflare Workers 포팅
// 원본: server.js getCrumb / yfRequest
// KV 캐시: 1시간 TTL (Vercel 함수마다 새로 받던 비효율 해소)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CRUMB_TTL_SEC = 60 * 60; // 1시간
const KV_KEY_CRUMB = 'yf:crumb';

/**
 * KV 에 캐시된 crumb 가져오기. 만료 시 새로 발급.
 * @param {KVNamespace} kv - env.CACHE
 * @param {boolean} forceRefresh - true 면 강제 갱신
 * @returns {Promise<{crumb: string, cookies: string}>}
 */
export async function getCrumb(kv, forceRefresh = false) {
    if (!forceRefresh) {
        try {
            const cached = await kv.get(KV_KEY_CRUMB, 'json');
            if (cached && cached.crumb && cached.cookies) return cached;
        } catch (_) {}
    }
    return await _fetchCrumb(kv);
}

async function _fetchCrumb(kv) {
    // Step 1: 세션 쿠키 획득
    const COOKIE_URLS = [
        'https://fc.yahoo.com/',
        'https://query1.finance.yahoo.com/',
        'https://finance.yahoo.com/news/',
    ];
    let cookies = '';
    for (const url of COOKIE_URLS) {
        try {
            const r1 = await fetch(url, {
                headers: {
                    'User-Agent': UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                },
                redirect: 'follow',
            });
            const setCookie = r1.headers.get('set-cookie');
            if (setCookie) {
                cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');
                if (cookies) break;
            }
        } catch (e) {
            console.warn(`[crumb] cookie URL ${url} fail:`, e.message);
        }
    }
    // Step 2: crumb 토큰 발급
    const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: {
            'User-Agent': UA,
            'Cookie': cookies,
            'Accept': 'text/plain',
        },
    });
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length < 5) throw new Error('crumb fetch failed');
    const data = { crumb, cookies, ts: Date.now() };
    // KV 에 저장 (TTL 자동 만료)
    try { await kv.put(KV_KEY_CRUMB, JSON.stringify(data), { expirationTtl: CRUMB_TTL_SEC }); } catch (_) {}
    return data;
}

/**
 * Yahoo Finance API 호출 + crumb 자동 첨부 + 401/403/604 재시도
 * @param {KVNamespace} kv - env.CACHE
 * @param {string} url - Yahoo API URL (crumb 빼고)
 * @returns {Promise<object>}
 */
export async function yfRequest(kv, url) {
    // 응답 캐시 (30초)
    const cacheKey = `yf:res:${url}`;
    try {
        const cached = await kv.get(cacheKey, 'json');
        if (cached) return cached;
    } catch (_) {}

    const { crumb, cookies } = await getCrumb(kv);
    const sep = url.includes('?') ? '&' : '?';
    const finalUrl = `${url}${sep}crumb=${encodeURIComponent(crumb)}`;

    try {
        const res = await fetch(finalUrl, {
            headers: { 'User-Agent': UA, 'Cookie': cookies, 'Accept': 'application/json' },
        });
        if (res.ok) {
            const data = await res.json();
            try { await kv.put(cacheKey, JSON.stringify(data), { expirationTtl: 30 }); } catch (_) {}
            return data;
        }
        const st = res.status;
        // 401/403/604 → crumb 만료 → 강제 갱신 후 1회 재시도
        if (st === 401 || st === 403 || st === 604) {
            const { crumb: c2, cookies: k2 } = await getCrumb(kv, true);
            const url2 = `${url}${sep}crumb=${encodeURIComponent(c2)}`;
            const res2 = await fetch(url2, {
                headers: { 'User-Agent': UA, 'Cookie': k2, 'Accept': 'application/json' },
            });
            if (res2.ok) return await res2.json();
        }
        // 429 → 1.5초 대기 + query2 폴백
        if (st === 429) {
            await new Promise(r => setTimeout(r, 1500));
            const { crumb: c3, cookies: k3 } = await getCrumb(kv, true);
            const fallbackUrl = url.includes('query1.finance.yahoo.com')
                ? url.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com')
                : url.replace('query2.finance.yahoo.com', 'query1.finance.yahoo.com');
            const url3 = `${fallbackUrl}${fallbackUrl.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(c3)}`;
            const res3 = await fetch(url3, {
                headers: { 'User-Agent': UA, 'Cookie': k3, 'Accept': 'application/json' },
            });
            if (res3.ok) {
                const data = await res3.json();
                try { await kv.put(cacheKey, JSON.stringify(data), { expirationTtl: 30 }); } catch (_) {}
                return data;
            }
        }
        throw new Error(`Yahoo ${st}: ${await res.text().catch(() => '')}`);
    } catch (err) {
        throw err;
    }
}
