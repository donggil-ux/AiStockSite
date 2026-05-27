// Clerk JWT 검증 — JWKS 기반 RS256 검증
// 환경 변수:
//   CLERK_SECRET_KEY      — sk_test_xxx 또는 sk_live_xxx (현재 미사용, 향후 API 호출용)
//   CLERK_PUBLISHABLE_KEY — pk_test_xxx 또는 pk_live_xxx (JWKS URL 도출)
//
// 사용법:
//   const auth = await verifyClerkJWT(req, env);
//   if (auth) console.log('user', auth.userId);  // 로그인됨
//   else      console.log('anonymous');          // 비로그인 (Bearer 헤더 없음 또는 검증 실패)

// JWKS 캐시 (Worker 전역 — KV 1시간 TTL 폴백)
let _jwksCache = null;
let _jwksCachedAt = 0;
const JWKS_TTL = 3600 * 1000; // 1시간

/** Clerk Publishable Key 로부터 Frontend API URL 추출 */
function clerkFrontendApi(env) {
    const pk = env.CLERK_PUBLISHABLE_KEY || '';
    // pk_test_<base64-encoded-domain>$  형식
    // ex) pk_test_Y2xlcmsuZXhhbXBsZS5jb20k  -> clerk.example.com
    const parts = pk.split('_');
    if (parts.length < 3) return null;
    const b64 = parts.slice(2).join('_').replace(/\$$/, '').replace(/-/g, '+').replace(/_/g, '/');
    try {
        const decoded = atob(b64).replace(/\$$/, '').trim();
        if (!decoded || !decoded.includes('.')) return null;
        return `https://${decoded}`;
    } catch (_) { return null; }
}

/** JWKS 다운로드 (KV 캐시 우선) */
async function fetchJWKS(env) {
    const now = Date.now();
    if (_jwksCache && (now - _jwksCachedAt) < JWKS_TTL) return _jwksCache;

    // KV 캐시
    try {
        const kvCached = await env.CACHE.get('clerk:jwks', 'json');
        if (kvCached?.keys && (now - (kvCached.ts || 0)) < JWKS_TTL) {
            _jwksCache = kvCached.keys;
            _jwksCachedAt = kvCached.ts;
            return _jwksCache;
        }
    } catch (_) {}

    const api = clerkFrontendApi(env);
    if (!api) return null;
    const res = await fetch(`${api}/.well-known/jwks.json`);
    if (!res.ok) return null;
    const data = await res.json();
    _jwksCache = data.keys;
    _jwksCachedAt = now;
    try {
        await env.CACHE.put('clerk:jwks', JSON.stringify({ keys: _jwksCache, ts: now }), { expirationTtl: 3600 });
    } catch (_) {}
    return _jwksCache;
}

/** Base64URL → Uint8Array */
function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** JWK → CryptoKey (RS256) */
async function importJWK(jwk) {
    return crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
    );
}

/**
 * Clerk JWT 검증.
 * @returns { userId, email?, sessionId, raw } 또는 null
 */
export async function verifyClerkJWT(req, env) {
    if (!env.CLERK_PUBLISHABLE_KEY) return null; // Clerk 미설정 시 항상 비로그인

    const authHdr = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHdr || !authHdr.startsWith('Bearer ')) return null;
    const token = authHdr.slice(7).trim();
    if (!token || token.split('.').length !== 3) return null;

    const [hB64, pB64, sB64] = token.split('.');
    let header, payload;
    try {
        header  = JSON.parse(new TextDecoder().decode(b64urlToBytes(hB64)));
        payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(pB64)));
    } catch (_) { return null; }

    if (header.alg !== 'RS256' || !header.kid) return null;

    // 만료 검증
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now - 10) return null; // 10초 leeway
    if (payload.nbf && payload.nbf > now + 10) return null;

    // JWKS 로드 → 해당 kid 찾기
    const keys = await fetchJWKS(env);
    if (!keys) return null;
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;

    // 서명 검증
    try {
        const key = await importJWK(jwk);
        const data = new TextEncoder().encode(`${hB64}.${pB64}`);
        const sig = b64urlToBytes(sB64);
        const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
        if (!valid) return null;
    } catch (_) { return null; }

    // Clerk JWT 필드 (sub = user_id)
    return {
        userId: payload.sub,
        sessionId: payload.sid,
        email: payload.email,
        raw: payload,
    };
}

/** 옵션 미들웨어: 인증 정보를 params 에 주입. 비로그인이어도 통과 */
export async function attachAuth(req, env, params) {
    params.auth = await verifyClerkJWT(req, env);
    return params;
}
