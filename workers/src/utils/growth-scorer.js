// 성장주 발굴 레이어 — 4개 신호(재무·섹터모멘텀·수급흐름·뉴스)를 종합해 매수/관망/매도 추천
import { getSectorHeat, getSectorHoldings, SECTOR_LABELS } from './sector-heat.js';
import { screenFundamentals } from './growth-fundamentals.js';
import { getFlowTrend, computeVolumeFlow } from './institutional-flow.js';
import { getCompanyNewsMomentum } from './news-momentum.js';
import { SECTOR_ETFS } from './market.js';

const UNIVERSE_KEY = 'growth:universe';
const UNIVERSE_TTL = 7 * 24 * 3600; // 7일 — topHoldings는 자주 안 바뀜
const CURSOR_KEY = 'growth:cursor';
const DAILY_BATCH = 4; // 서브리퀘스트 50개/요청 한도 — 같은 틱에 다른 크론 작업도 같이 돌아 여유를 더 둠

function _gradeOf(score) {
    return score >= 80 ? 'S' : score >= 65 ? 'A' : score >= 50 ? 'B' : 'C';
}

// 순수함수 — 4개 서브점수를 종합해 추천/등급/근거 생성
export function scoreCompany({ symbol, sectorEtf, fundamentals, sectorHeatRow, flow, flowTrend, news }) {
    const fundamentalsScore = fundamentals?.fundamentalsScore ?? 50;
    const sectorScore = sectorHeatRow?.heatScore ?? 50;
    const flowScore = flow?.flowScore ?? 50;
    const newsComponent = Math.max(0, Math.min(100, ((news?.newsScore ?? 0) + 5) * 10));
    const newsScore = news?.catalystScore != null ? (newsComponent + news.catalystScore) / 2 : newsComponent;

    const composite = Math.round(
        fundamentalsScore * 0.35 + sectorScore * 0.25 + flowScore * 0.25 + newsScore * 0.15
    );

    const stage = fundamentals?.stage || 'mature';
    let recommendation = 'hold';
    if (composite >= 70 && stage !== 'mature') recommendation = 'buy';
    else if (composite < 40) recommendation = 'sell';

    const confidence = _gradeOf(composite);

    const reasons = [];
    if (fundamentals?.revenueGrowth != null) reasons.push(`매출성장 ${(fundamentals.revenueGrowth * 100).toFixed(0)}%YoY`);
    if (fundamentals?.earningsGrowth != null) reasons.push(`이익성장 ${(fundamentals.earningsGrowth * 100).toFixed(0)}%YoY`);
    if (sectorHeatRow) reasons.push(`섹터 ${sectorHeatRow.heatRank}위(${sectorHeatRow.sectorLabel || sectorEtf})`);
    if (flowTrend?.trend === 'accumulating') reasons.push(`기관보유 ${flowTrend.deltaPct}%p↑`);
    else if (flowTrend?.trend === 'distributing') reasons.push(`기관보유 ${flowTrend.deltaPct}%p↓`);
    if (flow?.volRatio20d != null) reasons.push(`거래량비율 ${flow.volRatio20d}x`);
    if (news?.newsScore > 1) reasons.push('뉴스 긍정');
    else if (news?.newsScore < -1) reasons.push('뉴스 부정');
    if (stage === 'pre_growth') reasons.push('고성장·이익화 전 단계');
    else if (stage === 'growing') reasons.push('안정적 성장 단계');

    return {
        symbol, sectorEtf, recommendation, confidence, compositeScore: composite,
        fundamentalsScore, sectorScore, flowScore, newsScore: Math.round(newsScore),
        reasons, stage,
    };
}

async function _upsertRecommendation(env, scored, priceAtScan) {
    const snapshotDate = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`
        INSERT INTO growth_recommendations
          (symbol,snapshot_date,sector_etf,recommendation,confidence,composite_score,fundamentals_score,sector_score,flow_score,news_score,price_at_scan,reasons_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(symbol,snapshot_date) DO UPDATE SET
          sector_etf=excluded.sector_etf, recommendation=excluded.recommendation, confidence=excluded.confidence,
          composite_score=excluded.composite_score, fundamentals_score=excluded.fundamentals_score, sector_score=excluded.sector_score,
          flow_score=excluded.flow_score, news_score=excluded.news_score, price_at_scan=excluded.price_at_scan, reasons_json=excluded.reasons_json
    `).bind(scored.symbol, snapshotDate, scored.sectorEtf, scored.recommendation, scored.confidence, scored.compositeScore,
            scored.fundamentalsScore, scored.sectorScore, scored.flowScore, scored.newsScore, priceAtScan,
            JSON.stringify(scored.reasons), Date.now()).run();
}

// 회전 유니버스 구성 — 섹터별 topHoldings를 7일 캐시해 매일 재조회 안 함.
// freshlyBuilt=true인 날은 이미 섹터당 1회씩(11개) fetch를 써버려서, 같은 틱에서 종목 배치까지
// 돌리면 예산 초과 위험 — 그날은 배치를 건너뛰고 다음 틱부터 시작.
async function _getUniverse(env) {
    const cached = await env.CACHE.get(UNIVERSE_KEY, 'json');
    if (cached) return { universe: cached, freshlyBuilt: false };

    const universe = [];
    for (const etf of SECTOR_ETFS) {
        const holdings = await getSectorHoldings(env, etf, 8);
        holdings.forEach(symbol => universe.push({ symbol, sectorEtf: etf }));
    }
    const seen = new Set();
    const deduped = universe.filter(u => !seen.has(u.symbol) && seen.add(u.symbol));
    try { await env.CACHE.put(UNIVERSE_KEY, JSON.stringify(deduped), { expirationTtl: UNIVERSE_TTL }); } catch (_) {}
    return { universe: deduped, freshlyBuilt: true };
}

// 크론이 매일 호출하는 단일 진입점 — 섹터 히트는 매일, 개별 종목은 회전 커서로 하루 DAILY_BATCH개씩만
export async function runDailyGrowthScan(env) {
    const heatRows = await getSectorHeat(env);
    const heatBySector = new Map(heatRows.map(r => [r.sectorEtf, r]));

    const { universe, freshlyBuilt } = await _getUniverse(env);
    if (!universe.length) return { sectorsRanked: heatRows.length, symbolsScanned: 0, note: 'empty universe' };
    if (freshlyBuilt) {
        // 유니버스 구축 자체가 섹터당 1회(11개) fetch를 이미 소모 — 같은 틱에 종목 배치까지
        // 돌리면 예산 초과 위험이 커서 이번 실행은 건너뛰고 다음 크론 틱부터 배치 시작.
        return { sectorsRanked: heatRows.length, symbolsScanned: 0, universeSize: universe.length, note: 'universe freshly built, batch deferred to next run' };
    }

    let cursor = parseInt((await env.CACHE.get(CURSOR_KEY)) || '0', 10) || 0;
    const slice = [];
    for (let i = 0; i < DAILY_BATCH; i++) {
        slice.push(universe[cursor % universe.length]);
        cursor = (cursor + 1) % universe.length;
    }
    try { await env.CACHE.put(CURSOR_KEY, String(cursor), { expirationTtl: 30 * 24 * 3600 }); } catch (_) {}

    let scanned = 0;
    for (const { symbol, sectorEtf } of slice) {
        try {
            const fundArr = await screenFundamentals(env, [symbol], sectorEtf);
            const fundamentals = fundArr[0];
            const flow = await computeVolumeFlow(env, symbol);
            const flowTrend = await getFlowTrend(env, symbol);
            const news = await getCompanyNewsMomentum(env, symbol);
            const sectorHeatRow = heatBySector.get(sectorEtf);

            const scored = scoreCompany({ symbol, sectorEtf, fundamentals, sectorHeatRow, flow, flowTrend, news });
            await _upsertRecommendation(env, scored, fundamentals?.price ?? null);
            scanned++;
        } catch (e) {
            console.warn('[growth-scan] symbol err', symbol, e?.message);
        }
    }

    return { sectorsRanked: heatRows.length, symbolsScanned: scanned, universeSize: universe.length, cursor };
}
