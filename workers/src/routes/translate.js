// 번역 API — Google Translate 공개 엔드포인트 + KV 캐시
// 비용: $0 (Google Translate gtx 클라이언트는 무료)
// 캐시:
//   - 메모리 (isolate) 단기 캐시 → 1차
//   - KV 30일 → 2차 (종목명 번역은 거의 안 바뀜 → 긴 TTL 로 PUT 빈도 감소)

import { json, err } from '../utils/validators.js';

// isolate 단위 메모리 캐시 — 같은 worker 내 반복 요청 즉시 응답 (KV 호출 0)
const _trMemCache = new Map(); // cacheKey → translated
const _TR_MEM_MAX = 500;
const TR_TTL_SEC = 30 * 24 * 3600; // 30일

/**
 * GET /api/translate?text=Hello&sl=en&tl=ko
 *   sl: source language (기본 'en')
 *   tl: target language (기본 'ko')
 *
 * 최대 500자. 더 길면 400 반환.
 */
export async function handleTranslate(req, env) {
    try {
        const url = new URL(req.url);
        const text = url.searchParams.get('text');
        const sl = (url.searchParams.get('sl') || 'en').slice(0, 5);
        const tl = (url.searchParams.get('tl') || 'ko').slice(0, 5);
        if (!text) return err(400, 'text required');
        if (text.length > 500) return err(400, 'text too long (max 500)');

        // KV 캐시 키 — sl+tl+text 해시
        const cacheKey = `tr:${sl}-${tl}:${await sha1Short(text)}`;
        // 1차: 메모리 캐시 (KV 호출 X)
        if (_trMemCache.has(cacheKey)) {
            return json({ translated: _trMemCache.get(cacheKey), cached: true, src: 'mem' });
        }
        // 2차: KV 캐시
        try {
            const cached = await env.CACHE.get(cacheKey);
            if (cached) {
                _trMemCache.set(cacheKey, cached);
                if (_trMemCache.size > _TR_MEM_MAX) {
                    // FIFO 정리 — 첫 100개 삭제
                    const keys = _trMemCache.keys();
                    for (let i = 0; i < 100; i++) _trMemCache.delete(keys.next().value);
                }
                return json({ translated: cached, cached: true });
            }
        } catch (_) {}

        const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(gUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 StockAI/1.0' },
            cf: { cacheTtl: 3600 }, // Cloudflare 엣지 캐시도 1시간
        });
        if (!res.ok) {
            return json({ translated: text, error: `translate ${res.status}` });
        }
        const data = await res.json();
        const parts = data?.[0];
        if (!Array.isArray(parts)) {
            return json({ translated: text });
        }
        const translated = parts.map(p => p?.[0] || '').join('');

        // KV 저장 (30일 — 종목명 번역은 거의 안 바뀜 → PUT 빈도 1/720 감소)
        try {
            if (translated && translated !== text) {
                _trMemCache.set(cacheKey, translated);
                await env.CACHE.put(cacheKey, translated, { expirationTtl: TR_TTL_SEC });
            }
        } catch (_) {}

        return json({ translated, cached: false });
    } catch (e) {
        return err(500, e.message);
    }
}

async function sha1Short(s) {
    try {
        const buf = new TextEncoder().encode(s);
        const hash = await crypto.subtle.digest('SHA-1', buf);
        const arr = new Uint8Array(hash);
        return [...arr.slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
        return 'h' + s.length.toString(36);
    }
}
