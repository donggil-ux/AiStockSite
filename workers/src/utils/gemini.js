// Gemini REST API 클라이언트 — @google/generative-ai SDK 대체 (Workers 환경 호환)
//
// 환경변수:
//   GEMINI_API_KEY: Google AI Studio 발급 키
//
// 사용:
//   const result = await callGemini(env, prompt, { model, temperature, maxOutputTokens });
//   if (!result.ok) return null;
//   const json = extractJsonFromResponse(result.text);

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini API 호출
 * @param {Object} env - Workers env (GEMINI_API_KEY 필수)
 * @param {string} prompt - 프롬프트 전체
 * @param {Object} opts - { model, temperature, maxOutputTokens, responseMimeType, timeoutMs }
 * @returns { ok, text, tokensIn, tokensOut, model, error? }
 */
export async function callGemini(env, prompt, opts = {}) {
    const key = env.GEMINI_API_KEY;
    if (!key) return { ok: false, error: 'GEMINI_API_KEY not set' };

    const model = opts.model || 'gemini-3.1-flash-lite';
    const temperature = opts.temperature ?? 0.4;
    const maxOutputTokens = opts.maxOutputTokens ?? 2048;
    const timeoutMs = opts.timeoutMs ?? 25_000;
    const responseMimeType = opts.responseMimeType || 'application/json';

    const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const generationConfig = { temperature, maxOutputTokens };
    // Google Search grounding(tools) 사용 시 responseMimeType(JSON 강제)과 병행 불가 — 그라운딩 요청이면 생략
    if (!opts.tools) generationConfig.responseMimeType = responseMimeType;
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
    };
    if (opts.tools) body.tools = opts.tools;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return { ok: false, error: `gemini ${res.status}: ${errText.slice(0, 300)}`, model };
        }
        const data = await res.json();
        // 응답 텍스트 추출
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const text = parts.map(p => p?.text || '').join('').trim();
        const usage = data?.usageMetadata || {};
        return {
            ok: true,
            text,
            tokensIn: usage.promptTokenCount || 0,
            tokensOut: usage.candidatesTokenCount || 0,
            model,
        };
    } catch (e) {
        clearTimeout(timer);
        return { ok: false, error: e.name === 'AbortError' ? 'gemini timeout' : e.message, model };
    }
}

/**
 * Gemini 응답에서 JSON 추출 (```json 블록 또는 raw JSON 모두 지원)
 */
export function extractJsonFromResponse(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const first = candidate.indexOf('{');
    const last  = candidate.lastIndexOf('}');
    if (first < 0 || last < 0 || last <= first) return null;
    try { return JSON.parse(candidate.slice(first, last + 1)); }
    catch { return null; }
}

/**
 * KV 캐시 헬퍼 — Gemini 응답을 캐시 (TTL 초)
 */
export async function cachedGemini(env, cacheKey, prompt, opts = {}, ttlSec = 3600) {
    try {
        const cached = await env.CACHE.get(`gem:${cacheKey}`, 'json');
        if (cached) return { ...cached, cached: true };
    } catch (_) {}
    const result = await callGemini(env, prompt, opts);
    if (result.ok && result.text) {
        try {
            await env.CACHE.put(`gem:${cacheKey}`, JSON.stringify({
                text: result.text,
                tokensIn: result.tokensIn,
                tokensOut: result.tokensOut,
                model: result.model,
                ok: true,
            }), { expirationTtl: ttlSec });
        } catch (_) {}
    }
    return { ...result, cached: false };
}
