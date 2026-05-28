// AI 라우트 — 배치 스캐너 + 소셜 분석 (Gemini)
import { json, err } from '../utils/validators.js';
import { callGemini, extractJsonFromResponse } from '../utils/gemini.js';
import { handleScannerAiAnalyze } from './ai-scanner.js';

const SOCIAL_MODEL = 'gemini-3.1-flash-lite';
const TTL = 3600;

// ═════════════════════════════════════════════════════════════
// POST /api/scanner/ai-batch
// Body: { scannerType, items: [{ ticker, candidateData }] }
//   - 최대 15개, 동시성 6, 캐시 1시간 (handleScannerAiAnalyze 의 KV 캐시 활용)
// ═════════════════════════════════════════════════════════════
export async function handleScannerAiBatch(req, env) {
    try {
        const b = await req.json();
        const { scannerType, items } = b || {};
        if (!scannerType || !Array.isArray(items)) {
            return err(400, 'scannerType, items[] required');
        }
        const validTypes = new Set(['bounce', 'surge', 'swing', 'rayner', 'sepa']);
        if (!validTypes.has(scannerType)) return err(400, 'invalid scannerType');
        if (!env.GEMINI_API_KEY) return err(503, 'GEMINI_API_KEY missing');

        const limited = items.slice(0, 15);
        const out = [];
        // 동시성 6 배치
        for (let i = 0; i < limited.length; i += 6) {
            const chunk = limited.slice(i, i + 6);
            const partial = await Promise.all(chunk.map(async (it) => {
                if (!it?.ticker) return null;
                try {
                    // 내부 호출 — handleScannerAiAnalyze 재사용 (KV 캐시 자동)
                    const fakeReq = new Request('https://x/api/scanner/ai-analyze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ticker: it.ticker,
                            scannerType,
                            candidateData: it.candidateData || {},
                        }),
                    });
                    const res = await handleScannerAiAnalyze(fakeReq, env);
                    if (!res.ok) return null;
                    const data = await res.json();
                    return { ticker: it.ticker, analysis: data.analysis, _meta: data._meta };
                } catch { return null; }
            }));
            out.push(...partial.filter(Boolean));
        }
        return json({ scannerType, results: out, count: out.length, total: limited.length });
    } catch (e) {
        return err(500, e.message);
    }
}

// ═════════════════════════════════════════════════════════════
// POST /api/social/ai-analyze
// Body: { ticker, posts: [{title, body}], marketContext: { marketCap, price, changePct, volRatio, shortFloat, mentions, mentions24hAgo, bullishPct, stocktwitsRank } }
// 2 단계 Gemini 호출: 1) Reddit 의미 분석  2) 펌프앤덤프 점수
// ═════════════════════════════════════════════════════════════
export async function handleSocialAiAnalyze(req, env) {
    try {
        const b = await req.json();
        const { ticker, posts, marketContext } = b || {};
        if (!ticker) return err(400, 'ticker required');
        if (!env.GEMINI_API_KEY) return err(503, 'GEMINI_API_KEY missing');

        const cacheKey = `social:${ticker}`;
        try {
            const cached = await env.CACHE.get(cacheKey, 'json');
            if (cached) return json({ ...cached, _meta: { ...(cached._meta || {}), cached: true } });
        } catch (_) {}

        const postsText = (Array.isArray(posts) && posts.length)
            ? posts.slice(0, 5).map((p, i) => `[포스트 ${i+1}] ${p.title || ''}\n${(p.body || '').slice(0, 300)}`).join('\n\n')
            : '(Reddit 포스트 수집 불가 — 멘션 통계만 사용)';
        const mc = marketContext || {};

        // ── 1) 의미 분석 ──
        const prompt1 = `아래는 미국 주식 [${ticker}] 에 대한 Reddit 핫 포스트야.

${postsText}

아래 4가지를 분석해줘:
1. 화제의 핵심 이유 (1줄)
2. 실제 촉매(뉴스/공시) 있는가 / 단순 모멘텀인가
3. 커뮤니티 분위기 (Bullish/Bearish/혼조)
4. 신뢰도 (DD가 탄탄한가, 단순 흥분 멘트인가)

JSON 형식으로만 답변:
{
  "summary": "한 줄 요약",
  "hasCatalyst": true|false,
  "catalystDetail": "있다면 무엇인지, 없으면 빈 문자열",
  "sentiment": "Bullish/Bearish/Mixed",
  "credibility": "high/medium/low",
  "redFlags": ["위험요인1", "위험요인2"]
}`;

        let tIn = 0, tOut = 0;
        const r1 = await callGemini(env, prompt1, { model: SOCIAL_MODEL, temperature: 0.3, maxOutputTokens: 1024 });
        if (!r1.ok) return err(503, r1.error || 'gemini meaning failed');
        const meaning = extractJsonFromResponse(r1.text);
        if (!meaning) return err(503, 'meaning parse failed');
        tIn  += r1.tokensIn || 0;
        tOut += r1.tokensOut || 0;

        // ── 2) 펌프앤덤프 점수 ──
        const prompt2 = `아래는 미국 주식 [${ticker}] 의 최근 데이터야.

종목 정보:
- 시총: $${mc.marketCap || 0}
- 주가: $${mc.price || 0} (24h 변동률 ${mc.changePct ?? 0}%)
- 거래량: 평소의 ${mc.volRatio ?? 1}배
- Short Float: ${mc.shortFloat ?? 0}%

Reddit 데이터:
- 멘션 수: ${mc.mentions || 0}회 (24h 전 ${mc.mentions24hAgo || 0}회)
- 핵심 화제 요약: ${meaning.summary || ''}
- 촉매 여부: ${meaning.hasCatalyst ? '있음' : '없음'}
- 신뢰도: ${meaning.credibility || '?'}

StockTwits:
- Bullish 비율: ${mc.bullishPct ?? '?'}%
- 트렌딩 순위: ${mc.stocktwitsRank || '미포함'}위

아래 펌프앤덤프 신호 7가지를 평가해줘:
1. 갑작스러운 멘션 폭증 (1~2일 새 5배 이상)
2. DD 없는 단순 흥분 멘트만 다수
3. 같은 멘트/짤 반복 패턴
4. 시총 매우 작음 + 평소 거래량 적음
5. 공시/뉴스 없는데 주가 급등
6. "100% 간다" "지금 들어가야" 식 압박
7. 의심스러운 신규 계정의 글이 많음

각 신호를 0~10점으로 평가하고 합산해서 0~70점 산출.

JSON:
{
  "totalScore": 0~70,
  "signals": {
    "mentionExplosion": 0~10,
    "emptyHype": 0~10,
    "repeatPattern": 0~10,
    "smallCapLowVolume": 0~10,
    "noCatalyst": 0~10,
    "pressureLanguage": 0~10,
    "suspiciousAccounts": 0~10
  },
  "verdict": "안전/주의/위험/매우 위험",
  "reasoning": "근거 2~3줄"
}`;
        const r2 = await callGemini(env, prompt2, { model: SOCIAL_MODEL, temperature: 0.3, maxOutputTokens: 1024 });
        const pump = r2.ok ? extractJsonFromResponse(r2.text) : null;
        if (r2.ok) { tIn += r2.tokensIn || 0; tOut += r2.tokensOut || 0; }

        const result = {
            ticker,
            analyzedAt: new Date().toISOString(),
            meaning,
            pump,
            _meta: { tokensInput: tIn, tokensOutput: tOut, model: SOCIAL_MODEL, cached: false },
        };
        env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL }).catch(()=>{});
        return json(result);
    } catch (e) {
        return err(500, e.message);
    }
}
