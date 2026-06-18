// 종목 뉴스 감성 분석 — 매수 전 이슈 기반 필터
// 1) KV 캐시 30분 (news-sent:<symbol>)
// 2) 헤드라인 수집: Finnhub → Yahoo → Google News RSS
// 3) 키워드 스코어링 (-5 ~ +5)
// 4) 경계선(-1~+1)은 Gemini Flash로 재판단
// 반환: { sentiment: 'positive'|'neutral'|'negative', score, headline }

import { callGemini } from './gemini.js';

const CACHE_KEY = (sym) => `news-sent:${sym}`;
const CACHE_TTL = 30 * 60; // 30분 (초)

// ── 부정 키워드 (가중치별) ────────────────────────────────────────────
// 주의: substring 매칭이므로 단어 경계를 고려한 구체적 표현만 사용
const NEG_STRONG = [
    'bankrupt','fraud','scandal',
    'sec investigation','sec charges','sec fraud','sec probe','sec lawsuit',
    'doj investigation','doj charges','indicted','ponzi',
    'accounting fraud','securities fraud',
    'recall','crash','collapse','default','criminal charges','money laundering',
    '파산','사기','횡령','분식회계','폭락','기소','증권 사기',
];
const NEG_MILD = [
    'downgrade','misses expectations','misses estimates','earnings miss',
    'disappoints','disappointing','cuts guidance','guidance cut',
    'reduces forecast','lowers outlook','layoff','layoffs','downturn',
    'issues warning','raises concern','serious concern',
    'delay','revenue declined','revenue fell','profit fell','quarterly loss',
    'operating loss','net loss','sells off','sell-off',
    'short sellers','short position','bearish',
    '하락','약세','목표주가 하향','실적 미달','매출 감소','순손실','영업손실',
    '경고','소송','벌금','구조조정','감원','적자','부진','우려',
];

// ── 긍정 키워드 (가중치별) ────────────────────────────────────────────
const POS_STRONG = [
    'record revenue','record earnings','record profit','blockbuster','blowout',
    'FDA approval','breakthrough','major contract','buyback','acquisition',
    'partnership with','beats expectations','record high','all-time high',
    '어닝 서프라이즈','신고가','FDA 승인','대형 계약','자사주 매입',
];
const POS_MILD = [
    'beats estimates','beats expectations','earnings beat','revenue beat',
    'upgrade','outperform','buy rating','raises guidance','guidance raised',
    'strong growth','revenue growth','profit growth','bullish outlook',
    'new contract','product launch','market expansion','raises price target',
    '상승','강세','목표주가 상향','실적 호조','매출 증가','순이익 증가','기대 초과',
    '성장','호재','신규 계약','흑자','실적 개선',
];

function _keywordScore(text) {
    if (!text) return 0;
    const t = text.toLowerCase();
    let score = 0;
    for (const kw of NEG_STRONG) if (t.includes(kw.toLowerCase())) score -= 3;
    for (const kw of NEG_MILD)   if (t.includes(kw.toLowerCase())) score -= 1;
    for (const kw of POS_STRONG) if (t.includes(kw.toLowerCase())) score += 3;
    for (const kw of POS_MILD)   if (t.includes(kw.toLowerCase())) score += 1;
    return Math.max(-5, Math.min(5, score));
}

async function _fetchHeadline(env, symbol) {
    // 1차: Finnhub
    if (env.FINNHUB_API_KEY) {
        try {
            const to   = new Date();
            const from = new Date(to.getTime() - 7 * 86400000);
            const fmt  = d => d.toISOString().slice(0, 10);
            const r = await fetch(
                `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fmt(from)}&to=${fmt(to)}&token=${env.FINNHUB_API_KEY}`,
                { cf: { cacheTtl: 600 }, signal: AbortSignal.timeout(4000) }
            );
            if (r.ok) {
                const arr = await r.json();
                if (Array.isArray(arr) && arr.length) {
                    arr.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
                    const h = String(arr[0].headline || '').trim();
                    if (h) return h;
                }
            }
        } catch {}
    }
    // 2차: Yahoo Finance search
    try {
        const r = await fetch(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&quotesCount=0&newsCount=1&enableFuzzyQuery=false`,
            { headers: { 'User-Agent': 'Mozilla/5.0 StockAI/1.0' }, cf: { cacheTtl: 600 }, signal: AbortSignal.timeout(4000) }
        );
        if (r.ok) {
            const d = await r.json();
            const h = d?.news?.[0]?.title;
            if (h) return String(h).trim();
        }
    } catch {}
    // 3차: Google News RSS
    try {
        const r = await fetch(
            `https://news.google.com/rss/search?q=${encodeURIComponent(symbol + ' stock')}&hl=en-US&gl=US&ceid=US:en`,
            { headers: { 'User-Agent': 'Mozilla/5.0 StockAI/1.0' }, cf: { cacheTtl: 600 }, signal: AbortSignal.timeout(4000) }
        );
        if (r.ok) {
            const xml = await r.text();
            const m = xml.match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/);
            if (m) {
                const h = m[1].replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').replace(/\s+-\s+[^-]+$/, '').trim();
                if (h) return h;
            }
        }
    } catch {}
    return '';
}

/** 종목 뉴스 감성 분석 (KV 캐시 30분)
 * @returns { sentiment: 'positive'|'neutral'|'negative', score: number, headline: string }
 */
export async function getNewsSentiment(env, symbol) {
    // KV 캐시 확인
    try {
        const cached = await env.CACHE.get(CACHE_KEY(symbol), 'json');
        if (cached) return cached;
    } catch {}

    const headline = await _fetchHeadline(env, symbol);
    if (!headline) {
        // 헤드라인 없으면 neutral (거래 막지 않음)
        return { sentiment: 'neutral', score: 0, headline: '' };
    }

    let score = _keywordScore(headline);
    let sentiment = score > 1 ? 'positive' : score < -1 ? 'negative' : 'neutral';

    // 경계선(-1~+1): Gemini Flash로 재판단 (2~3초, 저비용)
    if (score >= -1 && score <= 1 && headline.length > 15) {
        try {
            const res = await callGemini(env,
                `Financial news headline for ${symbol}: "${headline}"\n` +
                `Classify the SHORT-TERM trading sentiment as exactly one word: positive, neutral, or negative.`,
                { model: 'gemini-3.1-flash-lite', maxOutputTokens: 5, temperature: 0 }
            );
            if (res.ok) {
                const word = res.text.trim().toLowerCase().replace(/[^a-z]/g, '');
                if (word === 'positive') { sentiment = 'positive'; score = 2; }
                else if (word === 'negative') { sentiment = 'negative'; score = -2; }
                else { sentiment = 'neutral'; score = 0; }
            }
        } catch {}
    }

    const result = { sentiment, score, headline: headline.slice(0, 120) };

    // KV 저장 (fire-and-forget)
    try {
        env.CACHE.put(CACHE_KEY(symbol), JSON.stringify(result), { expirationTtl: CACHE_TTL }).catch(() => {});
    } catch {}

    return result;
}
