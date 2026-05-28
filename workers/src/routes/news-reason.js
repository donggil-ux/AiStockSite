// 뉴스 한 줄 요약 — Finnhub → Yahoo → Google News RSS 폴백
// KV 캐시 15분 (메모리 캐시 대체)
// Gemini 미사용 (v672 서버 측에서도 비활성 — _shortenReason 폴백만 사용)
// 응답: { AAPL: "실적 서프라이즈", NVDA: "AI 수요 강세", ... }

import { json, err } from '../utils/validators.js';
import { yfRequest } from '../utils/crumb.js';

const REASON_TTL = 15 * 60; // 15분 (초)
// 빈 응답은 KV 가 아니라 isolate 메모리에 보관 → KV PUT 절약
// (빈 결과는 종목 많을수록 KV PUT 폭주의 주범)
const _emptyMem = new Map(); // symbol → expireAt(ms)
const EMPTY_MEM_MS = 30 * 60 * 1000;

export async function handleNewsReason(req, env) {
    try {
        const url = new URL(req.url);
        const raw = url.searchParams.get('symbols') || '';
        const syms = raw.split(',').map(s => s.trim().toUpperCase())
            .filter(s => /^[A-Z0-9.\-^=]{1,15}$/.test(s))
            .slice(0, 40);
        if (!syms.length) return json({});

        const out = {};
        const missCache = [];

        const now = Date.now();
        // 1a) 메모리 빈응답 캐시 — 만료 안 된 항목 즉시 skip (KV 호출도 X)
        const toCheckKv = [];
        for (const s of syms) {
            const exp = _emptyMem.get(s);
            if (exp && exp > now) continue; // 빈 응답으로 처리 (out 미설정)
            toCheckKv.push(s);
        }
        // 1b) KV 캐시 일괄 조회 (빈응답 메모리에 없는 것만)
        const cacheReads = await Promise.all(toCheckKv.map(async s => {
            try {
                const v = await env.CACHE.get(`news:${s}`);
                return { s, v };
            } catch { return { s, v: null }; }
        }));
        for (const { s, v } of cacheReads) {
            if (v != null) { if (v) out[s] = v; }
            else missCache.push(s);
        }

        if (missCache.length) {
            // 2) 누락된 종목 — 병렬 fetch (Finnhub + Yahoo + Google fallback)
            const results = await Promise.all(missCache.map(s => _fetchNewsTitle(env, s)));
            const upserts = [];
            for (const r of results) {
                const summary = _shortenReason(r.title || '');
                if (summary) {
                    out[r.symbol] = summary;
                    // KV PUT 은 유의미한 결과만 (빈 응답은 메모리로만)
                    upserts.push(env.CACHE.put(`news:${r.symbol}`, summary, { expirationTtl: REASON_TTL }));
                } else {
                    // 빈 응답 — 메모리에만 30분 캐시 (KV PUT 절약)
                    _emptyMem.set(r.symbol, now + EMPTY_MEM_MS);
                }
            }
            // 가끔 메모리 정리 (1000개 넘으면 만료된 것 청소)
            if (_emptyMem.size > 1000) {
                for (const [k, exp] of _emptyMem) if (exp < now) _emptyMem.delete(k);
            }
            // KV 쓰기는 비동기 — 응답 대기 없이 fire-and-forget
            Promise.all(upserts).catch(() => {});
        }

        return json(out);
    } catch (e) {
        return err(500, e.message);
    }
}

// ───────── 헬퍼: 1차 Finnhub → 2차 Yahoo → 3차 Google News RSS ─────────

async function _fetchNewsTitle(env, symbol) {
    let title = '';
    let publisher = '';
    // 1차 Finnhub (FINNHUB_API_KEY 있을 때만)
    if (env.FINNHUB_API_KEY) {
        try {
            const to = new Date();
            const from = new Date(to.getTime() - 14 * 86400000);
            const fmt = d => d.toISOString().slice(0, 10);
            const fnUrl = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${env.FINNHUB_API_KEY}`;
            const r = await fetch(fnUrl, { cf: { cacheTtl: 600 } });
            if (r.ok) {
                const arr = await r.json();
                if (Array.isArray(arr) && arr.length) {
                    arr.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
                    title = String(arr[0].headline || '').trim();
                    publisher = String(arr[0].source || 'Finnhub').slice(0, 30);
                }
            }
        } catch {}
    }
    // 2차 Yahoo Finance search
    if (!title) {
        try {
            const yUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=1&enableFuzzyQuery=false`;
            const data = await yfRequest(env.CACHE, yUrl);
            const first = data?.news?.[0];
            if (first?.title) { title = first.title; publisher = first.publisher || ''; }
        } catch {}
    }
    // 3차 Google News RSS
    if (!title) {
        try {
            const gUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(symbol + ' stock')}&hl=en-US&gl=US&ceid=US:en`;
            const r = await fetch(gUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 StockAI/1.0', 'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8' },
                cf: { cacheTtl: 600 },
            });
            if (r.ok) {
                const xml = await r.text();
                const m = xml.match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/);
                if (m) {
                    let t = m[1].replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim();
                    t = t.replace(/\s+-\s+[^-]+$/, '').trim();
                    title = t;
                    publisher = 'Google News';
                }
            }
        } catch {}
    }
    if (!title) return { symbol, title: '', publisher: '' };

    // 4) 한국어 번역 — Google Translate gtx (이미 Workers /api/translate 와 동일)
    try {
        const tUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(title)}`;
        const tr = await fetch(tUrl, { headers: { 'User-Agent': 'Mozilla/5.0 StockAI/1.0' }, cf: { cacheTtl: 3600 } });
        if (tr.ok) {
            const data = await tr.json();
            const parts = data?.[0];
            if (Array.isArray(parts)) {
                const ko = parts.map(p => p?.[0] || '').join('');
                if (ko) title = ko;
            }
        }
    } catch {}

    return { symbol, title, publisher };
}

function _shortenReason(text) {
    if (!text) return '';
    let t = String(text).replace(/\s+/g, ' ').trim();
    t = t.replace(/^[\[(]?[A-Z0-9.,\s]+[\])]?\s*[:–—-]\s*/, '');
    t = t.replace(/\s*[-–—]\s*['"']?[^-–—]{1,60}['"']?\?*\s*$/, '').trim();
    t = t.replace(/\s*(다음과 같습니다|여부.+?|방법\.?|이유.+?)\.?\s*$/, '').trim();
    const sm = t.match(/^(.{8,}?[.!?])\s/);
    if (sm) t = sm[1].trim();
    if (t.length > 120) t = t.slice(0, 118).trim() + '…';
    return t;
}
