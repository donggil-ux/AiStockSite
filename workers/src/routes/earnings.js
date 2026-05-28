// 어닝콜 요약 — Finnhub 헤드라인 + 영한 번역 (Gemini 미사용)
// KV 캐시 6시간 (분기마다만 갱신되므로 충분)
// 응답: { AAPL: { summary, sentiment, highlights, quarter, source, publisher }, ... }

import { json, err } from '../utils/validators.js';

const TTL = 6 * 3600;        // 6시간
const EMPTY_TTL = 30 * 60;   // 빈 응답 30분

export async function handleEarningsSummary(req, env) {
    try {
        const url = new URL(req.url);
        const raw = url.searchParams.get('symbols') || '';
        const syms = raw.split(',').map(s => s.trim().toUpperCase())
            .filter(s => /^[A-Z0-9.\-]{1,15}$/.test(s))
            .slice(0, 20);
        if (!syms.length) return json({});

        const out = {};
        const missCache = [];

        // 1) KV 캐시 일괄 조회
        const cacheReads = await Promise.all(syms.map(async s => {
            try {
                const v = await env.CACHE.get(`earn:${s}`, 'json');
                return { s, v };
            } catch { return { s, v: null }; }
        }));
        for (const { s, v } of cacheReads) {
            if (v) { if (v.summary) out[s] = v; }
            else missCache.push(s);
        }

        if (missCache.length) {
            // 2) 동시성 8 제한 — Workers CPU 시간 보호
            const limit = missCache.slice(0, 8);
            const results = await Promise.all(limit.map(s => _fetchEarningsHeadlineFromFinnhub(env, s)));
            const writes = [];
            for (const r of results) {
                if (r?.data) {
                    out[r.symbol] = r.data;
                    writes.push(env.CACHE.put(`earn:${r.symbol}`, JSON.stringify(r.data), { expirationTtl: TTL }));
                } else {
                    writes.push(env.CACHE.put(`earn:${r.symbol}`, JSON.stringify({ summary: '' }), { expirationTtl: EMPTY_TTL }));
                }
            }
            Promise.all(writes).catch(() => {});
        }

        // 클라이언트 캐싱 힌트
        const res = json(out);
        res.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        return res;
    } catch (e) {
        return err(500, e.message);
    }
}

async function _fetchEarningsHeadlineFromFinnhub(env, symbol) {
    if (!env.FINNHUB_API_KEY) return { symbol, data: null };
    try {
        const to = new Date();
        const from = new Date(to.getTime() - 30 * 86400000);
        const fmt = d => d.toISOString().slice(0, 10);
        const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${env.FINNHUB_API_KEY}`;
        const r = await fetch(url, { cf: { cacheTtl: 600 } });
        if (!r.ok) return { symbol, data: null };
        const arr = await r.json();
        if (!Array.isArray(arr) || !arr.length) return { symbol, data: null };
        // 실적 관련 키워드 필터
        const re = /\b(earnings|quarterly|quarter|Q[1-4]\b|EPS|revenue|results|beat|miss|guidance|forecast|outlook|profit|sales)\b/i;
        const hits = arr.filter(n => re.test(n.headline || '') || re.test(n.summary || ''));
        const pool = hits.length ? hits : arr;
        pool.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
        const first = pool[0];
        const headlineEn = String(first.headline || '').trim();
        if (!headlineEn) return { symbol, data: null };

        // Sentiment 휴리스틱
        const low = headlineEn.toLowerCase();
        let sentiment = 'neutral';
        if (/\b(beat|beats|exceed|exceeds|surge|jumps?|soars?|strong|rally|tops?|crush)\b/.test(low)) sentiment = 'positive';
        else if (/\b(miss|misses|disappoint|drop|drops|fall|falls|plunge|tumbles?|weak|warn|cut|slash)\b/.test(low)) sentiment = 'negative';

        // 한국어 번역
        let ko = headlineEn;
        try {
            const tUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(headlineEn)}`;
            const tr = await fetch(tUrl, { headers: { 'User-Agent': 'Mozilla/5.0 StockAI/1.0' }, cf: { cacheTtl: 3600 } });
            if (tr.ok) {
                const data = await tr.json();
                const parts = data?.[0];
                if (Array.isArray(parts)) {
                    const out = parts.map(p => p?.[0] || '').join('');
                    if (out) ko = out;
                }
            }
        } catch {}

        return {
            symbol,
            data: {
                summary: ko.slice(0, 200),
                sentiment,
                highlights: [],
                quarter: 'recent',
                source: 'finnhub-headline',
                publisher: String(first.source || 'Finnhub').slice(0, 30),
            },
        };
    } catch {
        return { symbol, data: null };
    }
}
