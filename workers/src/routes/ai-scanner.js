// AI 라우트 — 알파 스캐너 + 스윙 분석 (Gemini)
// 원본: server.js _geminiScannerAnalyze, _geminiSwingAnalyze
// KV 캐시 1시간, 모델 gemini-3.1-flash-lite

import { json, err } from '../utils/validators.js';
import { callGemini, extractJsonFromResponse } from '../utils/gemini.js';

const MODEL = 'gemini-3.1-flash-lite';
const TTL = 3600; // 1시간

// ───────── 스캐너 컨텍스트 빌더 ─────────
function buildScannerContext(scannerType, c) {
    const lines = [];
    if (c.price) lines.push(`현재가: $${c.price}`);
    if (c.marketCap) lines.push(`시총: $${(c.marketCap / 1e6).toFixed(1)}M`);
    if (c.changePct != null) lines.push(`당일 변동: ${c.changePct >= 0 ? '+' : ''}${c.changePct}%`);

    if (scannerType === 'bounce') {
        if (c.rsi != null) lines.push(`RSI(14): ${c.rsi}`);
        if (c.ma200 && c.price) {
            const gap = ((c.price - c.ma200) / c.ma200) * 100;
            lines.push(`MA200 대비: ${gap.toFixed(1)}%`);
        }
        if (c.volMult) lines.push(`거래량 평균 대비: ×${c.volMult}`);
        if (c.high52 && c.price) {
            const dd = ((c.price - c.high52) / c.high52) * 100;
            lines.push(`52주 고점 대비: ${dd.toFixed(0)}%`);
        }
    } else if (scannerType === 'surge') {
        if (c.stage) lines.push(`Tim Sykes 단계: ${c.stage}단계 (${c.stageLabel || '?'})`);
        if (c.consecUp != null) lines.push(`연속 상승: ${c.consecUp}일`);
        if (c.volRatio) lines.push(`거래량 평균 대비: ×${c.volRatio}`);
        if (c.drawdownPct != null) lines.push(`최근 10일 고점 대비: ${c.drawdownPct}%`);
        if (c.totalGainPct != null) lines.push(`20일 저점 대비 상승: ${c.totalGainPct}%`);
    } else if (scannerType === 'swing') {
        if (c.rr) lines.push(`R/R 비율: ${c.rr}`);
        if (c.fiftyTwoWeekHigh && c.price) {
            const upside = ((c.fiftyTwoWeekHigh - c.price) / c.price) * 100;
            lines.push(`52주 고점까지: +${upside.toFixed(1)}%`);
        }
    } else if (scannerType === 'rayner') {
        if (c.stage) lines.push(`Stage: ${c.stage} (${c.stageLabel || '?'})`);
        if (c.entrySignal) lines.push(`진입 시그널: ${c.entrySignal}`);
        if (c.pctAbove200 != null) lines.push(`EMA200 대비: +${c.pctAbove200}%`);
        if (c.score) lines.push(`Rayner 점수: ${c.score}`);
    } else if (scannerType === 'sepa') {
        if (c.score) lines.push(`SEPA 점수: ${c.score}/100`);
        if (c.trendPassed != null) lines.push(`트렌드 템플릿 통과: ${c.trendPassed}/8`);
        if (c.vcpFound) lines.push('VCP: 발견');
        if (c.rs) lines.push(`상대강도(RS): ${c.rs}`);
        if (c.todayVolMult) lines.push(`당일 거래량 ×${c.todayVolMult}`);
    }
    return lines.join('\n');
}

function purposeByType(scannerType) {
    return ({
        bounce: '과매도 후 반등 신뢰도',
        surge: '급등 진입 적절성 (Tim Sykes 단계별)',
        swing: '스윙 R/R 진입 신뢰도',
        rayner: 'Rayner Teo Stage 2 진입 신뢰도',
        sepa: 'Minervini SEPA 매수 적절성',
    })[scannerType] || '진입 신뢰도';
}

// ═════════════════════════════════════════════════════════════
// POST /api/scanner/ai-analyze
// Body: { ticker, scannerType, candidateData }
// ═════════════════════════════════════════════════════════════
export async function handleScannerAiAnalyze(req, env) {
    try {
        const b = await req.json();
        const { ticker, scannerType, candidateData } = b || {};
        if (!ticker || !scannerType) return err(400, 'ticker, scannerType required');
        const validTypes = new Set(['bounce', 'surge', 'swing', 'rayner', 'sepa']);
        if (!validTypes.has(scannerType)) return err(400, 'invalid scannerType');

        const cacheKey = `scan:${ticker}:${scannerType}`;
        // KV 캐시 — 1시간
        try {
            const cached = await env.CACHE.get(cacheKey, 'json');
            if (cached) return json({ ...cached, _meta: { ...(cached._meta || {}), cached: true } });
        } catch (_) {}

        const context = buildScannerContext(scannerType, candidateData || {});
        const purpose = purposeByType(scannerType);
        const prompt = `당신은 단기 트레이딩 분석가입니다.

종목: ${ticker}
스캐너 유형: ${purpose}

시그널 데이터:
${context}

위 시그널을 종합해 진입 가능성을 평가해주세요.
다음 JSON 으로만 답변:
{
  "verdict": "강한매수/매수/관망/회피",
  "confidence": 0~10,
  "expectedMovePct": "예상 변동 폭 (%, 정수)",
  "riskLevel": "낮음/중간/높음/매우높음",
  "topRisks": ["위험 요인 1", "위험 요인 2"],
  "entryTiming": "즉시/조정대기/관망",
  "reasoning": "근거 2~3줄 (한국어, 사실 기반)",
  "watchPoint": "추가 확인 포인트 1줄"
}`;

        const r = await callGemini(env, prompt, { model: MODEL, temperature: 0.3, maxOutputTokens: 1024 });
        if (!r.ok) return err(503, r.error || 'gemini failed');
        const parsed = extractJsonFromResponse(r.text);
        if (!parsed) return err(503, 'AI 응답 파싱 실패');

        const result = {
            ticker,
            scannerType,
            analyzedAt: new Date().toISOString(),
            analysis: parsed,
            _meta: {
                tokensInput: r.tokensIn,
                tokensOutput: r.tokensOut,
                model: r.model,
                cached: false,
            },
        };
        env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL }).catch(() => {});
        return json(result);
    } catch (e) {
        return err(500, e.message);
    }
}

// ═════════════════════════════════════════════════════════════
// POST /api/swing/ai-analyze
// Body: { ticker, categories: [{ name, score, reason }], overallScore }
// ═════════════════════════════════════════════════════════════
export async function handleSwingAiAnalyze(req, env) {
    try {
        const b = await req.json();
        const { ticker, categories, overallScore } = b || {};
        if (!ticker || !Array.isArray(categories) || !categories.length) {
            return err(400, 'ticker, categories required');
        }

        const cacheKey = `swing:${ticker}`;
        try {
            const cached = await env.CACHE.get(cacheKey, 'json');
            if (cached) return json({ ...cached, _cached: true });
        } catch (_) {}

        const catLines = categories
            .map(c => `- ${c.name}: ${c.score}점 — ${(c.reason || '').slice(0, 100)}`)
            .join('\n');
        const prompt = `당신은 스윙 트레이딩 전문 분석가입니다.

종목: ${ticker}
알고리즘 종합 점수: ${overallScore || 0}/100

7개 카테고리 점수 (룰베이스 알고리즘 산출):
${catLines}

위 점수를 종합해 스윙 트레이딩(수일~수주 보유) 관점에서 평가해주세요.
다음 JSON 으로만 답변 (모두 한국어, 사실 기반, 과장 금지):
{
  "verdict": "한 줄 종합 판정 (예: 스윙 진입 매력적 / 조건부 관찰 / 진입 비권장)",
  "summary": "2~3줄 종합 코멘트 — 점수가 말하는 핵심",
  "strength": "가장 강한 축 1개와 그 이유 (1줄)",
  "weakness": "가장 약한 축 1개와 주의점 (1줄)",
  "swingFit": "스윙 트레이딩 적합도 한 줄 평 (진입 타이밍·손절 관점)"
}`;

        const r = await callGemini(env, prompt, { model: MODEL, temperature: 0.35, maxOutputTokens: 1024 });
        if (!r.ok) return err(503, r.error || 'gemini failed');
        const parsed = extractJsonFromResponse(r.text);
        if (!parsed) return err(503, 'AI 응답 파싱 실패');

        env.CACHE.put(cacheKey, JSON.stringify(parsed), { expirationTtl: TTL }).catch(() => {});
        return json(parsed);
    } catch (e) {
        return err(500, e.message);
    }
}
