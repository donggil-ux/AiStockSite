// Web Push (VAPID) — Cloudflare Workers 네이티브 구현
// web-push 라이브러리는 Node 기반이라 Workers 에서 직접 호출 안 됨.
// 대신 Workers 의 SubtleCrypto + fetch 만으로 VAPID 인증 + 푸시 발송 구현.
//
// 시크릿:
//   wrangler secret put VAPID_PUBLIC_KEY
//   wrangler secret put VAPID_PRIVATE_KEY
//   wrangler secret put VAPID_SUBJECT       (예: "mailto:you@example.com")

// ── Base64URL 인코딩 ─────────────────────────────────────
function b64uEncode(buf) {
    const bytes = new Uint8Array(buf);
    let str = '';
    for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// ── VAPID JWT 생성 ──────────────────────────────────────
async function importVapidKey(privateKeyB64u) {
    const raw = b64uDecode(privateKeyB64u);
    // ECDSA P-256 PKCS8 형식으로 변환 (raw d → JWK)
    // VAPID 표준은 ECDSA P-256 (P-256 + SHA-256)
    return await crypto.subtle.importKey(
        'jwk',
        {
            kty: 'EC',
            crv: 'P-256',
            d: privateKeyB64u,
            // x, y 는 공개키 좌표 — 일반적으로 별도 필드, 아래에서 생성 시 보강
        },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
}

// 더 신뢰성 있는 방식: 공개키 + 비공개키 둘 다 JWK 로 import
async function importVapidKeyPair(publicKeyB64u, privateKeyB64u) {
    const pubRaw = b64uDecode(publicKeyB64u);
    // 공개키 65바이트 (0x04 + 32바이트 X + 32바이트 Y)
    if (pubRaw.length !== 65 || pubRaw[0] !== 0x04) throw new Error('invalid VAPID public key');
    const x = b64uEncode(pubRaw.slice(1, 33));
    const y = b64uEncode(pubRaw.slice(33, 65));
    return await crypto.subtle.importKey(
        'jwk',
        { kty: 'EC', crv: 'P-256', x, y, d: privateKeyB64u },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
}

async function makeVapidJwt(audience, subject, publicKey, privateKey) {
    const header = { typ: 'JWT', alg: 'ES256' };
    const expSec = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12시간
    const payload = { aud: audience, exp: expSec, sub: subject };
    const headerB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = b64uEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const data = `${headerB64}.${payloadB64}`;
    const key = await importVapidKeyPair(publicKey, privateKey);
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new TextEncoder().encode(data)
    );
    return `${data}.${b64uEncode(sig)}`;
}

// ── 페이로드 암호화 (RFC 8291: aes128gcm) ─────────────────
// VAPID 푸시 페이로드는 RFC 8291 (Web Push Encryption) 으로 암호화 필요.
// Workers 의 SubtleCrypto 만으로 구현 — Node 의 web-push 라이브러리 대체.
async function encryptPayload(payload, p256dhB64u, authB64u) {
    const recipientPub = b64uDecode(p256dhB64u);
    const authSecret = b64uDecode(authB64u);
    // 1) ephemeral key pair 생성
    const ephKeys = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
    );
    const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephKeys.publicKey));
    // 2) recipient public key import
    const recipPubKey = await crypto.subtle.importKey(
        'raw', recipientPub,
        { name: 'ECDH', namedCurve: 'P-256' },
        false, []
    );
    // 3) ECDH shared secret
    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: recipPubKey },
        ephKeys.privateKey,
        256
    );
    // 4) HKDF: PRK_key = HMAC(auth_secret, ECDH_secret)
    //    key_info = "WebPush: info\0" + recipPub + ephPub
    const keyInfoParts = [
        new TextEncoder().encode('WebPush: info\0'),
        recipientPub,
        ephPubRaw,
    ];
    const keyInfo = concatBytes(keyInfoParts);
    const ikm = await hkdfExtract(authSecret, new Uint8Array(sharedBits));
    const ikmExtracted = await hkdfExpand(ikm, keyInfo, 32);
    // 5) salt = 16 random bytes
    const salt = crypto.getRandomValues(new Uint8Array(16));
    // 6) Content-Encryption Key (CEK)
    const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
    const prkAes = await hkdfExtract(salt, ikmExtracted);
    const cek = await hkdfExpand(prkAes, cekInfo, 16);
    // 7) Nonce
    const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
    const nonce = await hkdfExpand(prkAes, nonceInfo, 12);
    // 8) AES-GCM 암호화
    const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
    // 페이로드 = data + 0x02 (padding delimiter, 1바이트 패딩)
    const plaintext = concatBytes([new TextEncoder().encode(payload), new Uint8Array([0x02])]);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        cekKey,
        plaintext
    ));
    // 9) Header: salt(16) + rs(4) + idlen(1) + keyid(idlen)
    const header = concatBytes([
        salt,
        new Uint8Array([0, 0, 0x10, 0]), // record size = 4096
        new Uint8Array([ephPubRaw.length]),
        ephPubRaw,
    ]);
    return concatBytes([header, ciphertext]);
}

async function hkdfExtract(salt, ikm) {
    const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
}
async function hkdfExpand(prk, info, length) {
    const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const input = concatBytes([info, new Uint8Array([0x01])]);
    const out = new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
    return out.slice(0, length);
}
function concatBytes(parts) {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

/**
 * 단일 구독자에게 푸시 발송
 * @param {object} subscription - { endpoint, keys: { p256dh, auth } }
 * @param {string} payload - JSON 문자열 (클라이언트 sw.js 가 받음)
 * @param {object} env - { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT }
 * @returns {Promise<Response>}
 */
export async function sendPush(subscription, payload, env) {
    const { endpoint, keys } = subscription;
    if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error('invalid subscription');
    const audience = new URL(endpoint).origin;
    const jwt = await makeVapidJwt(
        audience,
        env.VAPID_SUBJECT || 'mailto:admin@stockai.local',
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY
    );
    const body = await encryptPayload(payload || '', keys.p256dh, keys.auth);
    return await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'TTL': '86400',
        },
        body,
    });
}
