// AI 라우트 — SEC 공시 카탈리스트 심층 분석 (Gemini)
// 2단계 호출: 1) 공시 본문 의미 분석  2) 진위 검증 + 리스크 평가 (독성 자금조달 감지)
// KV 캐시 1시간, 모델 gemini-3.1-flash-lite

import { json, err } from '../utils/validators.js';
import { callGemini, extractJsonFromResponse } from '../utils/gemini.js';

const MODEL = 'gemini-3.1-flash-lite';
const TTL = 3600;

export async function handleCatalystAiAnalyze(req, env) {
    try {
        const b = await req.json();
        const { ticker, formType, title, filingText, filedAt, marketData } = b || {};
        if (!ticker || !formType) return err(400, 'ticker, formType required');
        if (!env.GEMINI_API_KEY) return err(503, 'GEMINI_API_KEY missing');

        const filingTs = (filedAt || '').slice(0, 16);
        const cacheKey = `catalyst:${ticker}:${formType}:${filingTs}`;
        try {
            const cached = await env.CACHE.get(cacheKey, 'json');
            if (cached) return json({ ...cached, _meta: { ...(cached._meta || {}), cached: true } });
        } catch (_) {}

        const filing = { formType, title, filingText, filedAt };
        const filingTextCut = (filingText || title || '').slice(0, 1500);
        const filedAtStr = filedAt || new Date().toISOString();

        // ── 기능 1: 공시 본문 의미 분석 ──
        const prompt1 = `아래는 미국 주식 [${ticker}] 의 SEC 공시 본문이야.

공시 유형: ${formType || '?'}
공시 제목: ${title || ''}
공시 시각: ${filedAtStr}

공시 본문 (첫 1500자):
${filingTextCut}

아래 5가지를 분석해줘:

1. 공시의 핵심 내용 (한국어 1줄)
2. 호재/악재 판단 (호재/중립/악재)
3. 단기 주가 영향 (강한상승/약한상승/중립/하락)
4. 촉매 등급:
   - S급: FDA 승인, 대형 인수($1B+), 정부 계약
   - A급: 파트너십, 신제품 발표, 어닝 서프라이즈, 중형 인수
   - B급: 일반 인수, 라이센스 계약, 사업 확장
   - C급: 단순 발표, 정기 공시
5. 영향 시간대 (수시간/1~2일/1주일 이내)

JSON으로만 답변:
{
  "summary": "한 줄 요약",
  "verdict": "호재/중립/악재",
  "impactLevel": "강한상승/약한상승/중립/하락",
  "catalystGrade": "S/A/B/C",
  "keyPoints": ["포인트1","포인트2","포인트3"],
  "timeHorizon": "수시간/1~2일/1주일",
  "sectorImplication": "섹터/테마 파급 효과 한 줄"
}`;

        let totalIn = 0, totalOut = 0;
        const r1 = await callGemini(env, prompt1, { model: MODEL, temperature: 0.3, maxOutputTokens: 1024 });
        if (!r1.ok) return err(503, r1.error || 'gemini filing failed');
        const filingAnalysis = extractJsonFromResponse(r1.text);
        if (!filingAnalysis) return err(503, 'filing parse failed');
        totalIn  += r1.tokensIn || 0;
        totalOut += r1.tokensOut || 0;

        // ── 기능 2: 진위 검증 + 리스크 평가 ──
        const md = marketData || {};
        const prompt2 = `아래는 미국 주식 [${ticker}] 공시 + 시장 데이터야.

공시:
- 유형: ${formType || '?'}
- 제목: ${title || ''}
- 본문 요약: ${filingAnalysis.summary || ''}
- 등급: ${filingAnalysis.catalystGrade || '?'}

공시 본문 (첫 1500자):
${filingTextCut}

현재 시장:
- 시총: $${md.marketCap || 0}
- 주가: $${md.price || 0} (24h 변동률 ${md.priceChange24h ?? 0}%)
- 거래량: 평소의 ${md.volumeRatio ?? 1}배
- Short Float: ${md.shortFloat ?? 0}%
- 최근 30일 공시 빈도: ${md.recentFilingsCount30d ?? 0}건

아래 7가지 리스크를 0~10점으로 평가 (10이 가장 위험):

1. 회사 진위성 — 페이퍼 컴퍼니 의심도
2. 공시 모호성 — 구체적 수치 없는 모호한 표현 사용
3. 이미 주가 반응 — 24h 변동이 너무 큼
4. 시총 대비 규모 부적정 — 작은 회사가 거대 계약 발표
5. 반복적 공시 — 펌프 의심 패턴
6. 늦은 진입 — 거래량이 너무 폭발했음
7. 단기 반등 후 급락 — 데드캣 바운스 위험

CRITICAL RISK CHECK (필수 — 독성 자금조달 탐지):
8-K 본문과 회사의 최근 공시에서 'Toxic Financing'(독성 자금조달)·주주가치 희석 징후를 면밀히 스캔하라.
특히 다음 키워드를 집중적으로 찾아라: 'Direct Offering', 'Warrants', 'Convertible Notes',
'Shelf Registration', 'ATM (At-the-Market) offering', 'Reverse Split'.
이러한 희석 위험이 하나라도 감지되면, totalRisk 를 반드시 최대치(70)로 설정하고,
recommendation 을 반드시 '회피' 로 지정하며, reasoning(과 keyPoints)에 어떤 희석 위험이
감지됐는지 명시적으로 기술하라. 이는 '호재 발표 직후 유상증자'로 개미를 털어가는
펌프앤덤프를 회피하기 위한 최우선 점검 항목이다.

JSON:
{
  "totalRisk": 0~70,
  "signals": {
    "shellCompanyRisk": 0~10,
    "vagueLanguage": 0~10,
    "priceAlreadyMoved": 0~10,
    "sizeMismatch": 0~10,
    "repeatedFilings": 0~10,
    "lateEntry": 0~10,
    "reversalRisk": 0~10
  },
  "dilutionRisk": true/false,
  "verdict": "안전/주의/위험/매우위험",
  "recommendation": "진입가능/관망/회피",
  "entryTiming": "즉시/조정대기/관망",
  "reasoning": "근거 2~3줄 (한국어 — 희석 위험 감지 시 반드시 명시)"
}`;

        const r2 = await callGemini(env, prompt2, { model: MODEL, temperature: 0.3, maxOutputTokens: 1536 });
        const riskAnalysis = r2.ok ? extractJsonFromResponse(r2.text) : null;
        if (r2.ok) { totalIn += r2.tokensIn || 0; totalOut += r2.tokensOut || 0; }

        const result = {
            ticker,
            analyzedAt: new Date().toISOString(),
            filingAnalysis,
            riskAnalysis,
            tokensUsed: totalIn + totalOut,
            _meta: {
                tokensInput: totalIn,
                tokensOutput: totalOut,
                model: MODEL,
                cached: false,
            },
        };
        env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL }).catch(()=>{});
        return json(result);
    } catch (e) {
        return err(500, e.message);
    }
}
