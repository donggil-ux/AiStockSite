// 성장주 발굴 레이어 — 종목 재무지표(PER·성장률) + 기관보유비중 스크리닝
// quoteSummary 모듈은 workers/src/routes/yahoo.js의 handleSummary()와 동일 조합 재사용 —
// 이미 이 코드베이스에서 서버 크럼 인증으로 검증된 조합(summaryProfile,defaultKeyStatistics,financialData,price).
// 종목당 fetch 1회로 재무 + 기관보유비중(institutional flow 스냅샷용)까지 한번에 확보.
import { yfRequest } from './crumb.js';

const MODULES = 'summaryProfile,defaultKeyStatistics,financialData,price';

function _raw(v) { return v && typeof v === 'object' ? (v.raw ?? null) : (v ?? null); }

// 재무지표 기준 성장 단계 휴리스틱 분류
function _classifyStage({ revenueGrowth, earningsGrowth, profitMargin }) {
    const rg = revenueGrowth ?? 0;
    if (rg >= 0.30 && (profitMargin == null || profitMargin < 0.05)) return 'pre_growth'; // 고성장·저마진(아직 이익화 전)
    if (rg >= 0.15) return 'growing';
    return 'mature';
}

function _fundamentalsScore({ revenueGrowth, earningsGrowth, peRatio, profitMargin }) {
    let s = 50;
    if (revenueGrowth != null) s += Math.max(-20, Math.min(30, revenueGrowth * 60));
    if (earningsGrowth != null) s += Math.max(-15, Math.min(20, earningsGrowth * 10));
    if (profitMargin != null && profitMargin > 0) s += Math.min(10, profitMargin * 20);
    if (peRatio != null && peRatio > 0 && peRatio < 40) s += 5; // 과도하게 비싸지 않은 밸류에이션 소폭 가산
    return Math.max(0, Math.min(100, Math.round(s)));
}

// symbols 배열을 스크리닝 — sectorEtf는 태깅용(어느 섹터 후보로 스캔했는지 기록)
export async function screenFundamentals(env, symbols, sectorEtf = null) {
    const now = Date.now();
    const snapshotDate = new Date().toISOString().slice(0, 10);
    const results = [];

    for (const symbol of symbols) {
        try {
            const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}`;
            const data = await yfRequest(env.CACHE, url);
            const r = data?.quoteSummary?.result?.[0];
            if (!r) continue;

            const fd = r.financialData || {};
            const dks = r.defaultKeyStatistics || {};
            const sp = r.summaryProfile || {};
            const pr = r.price || {};

            const revenueGrowth  = _raw(fd.revenueGrowth);
            const earningsGrowth = _raw(fd.earningsGrowth);
            const profitMargin   = _raw(dks.profitMargins);
            const peRatio         = _raw(dks.trailingPE) ?? (_raw(pr.regularMarketPrice) && _raw(dks.trailingEps)
                ? _raw(pr.regularMarketPrice) / _raw(dks.trailingEps) : null);
            const forwardPe      = _raw(dks.forwardPE);
            const marketCap      = _raw(pr.marketCap);
            const instPct        = _raw(dks.heldPercentInstitutions);
            const insidersPct    = _raw(dks.heldPercentInsiders);
            const targetMean     = _raw(fd.targetMeanPrice);
            const recKey         = fd.recommendationKey || null;

            const stage = _classifyStage({ revenueGrowth, earningsGrowth, profitMargin });
            const fundamentalsScore = _fundamentalsScore({ revenueGrowth, earningsGrowth, peRatio, profitMargin });

            await env.DB.prepare(`
                INSERT INTO growth_fundamentals
                  (symbol,sector_etf,industry,pe_ratio,forward_pe,revenue_growth,earnings_growth,profit_margin,market_cap,analyst_rating,target_mean_price,stage,fundamentals_score,updated_at,stale)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
                ON CONFLICT(symbol) DO UPDATE SET
                  sector_etf=excluded.sector_etf, industry=excluded.industry, pe_ratio=excluded.pe_ratio,
                  forward_pe=excluded.forward_pe, revenue_growth=excluded.revenue_growth, earnings_growth=excluded.earnings_growth,
                  profit_margin=excluded.profit_margin, market_cap=excluded.market_cap, analyst_rating=excluded.analyst_rating,
                  target_mean_price=excluded.target_mean_price, stage=excluded.stage, fundamentals_score=excluded.fundamentals_score,
                  updated_at=excluded.updated_at, stale=0
            `).bind(symbol, sectorEtf, sp.industry || null, peRatio, forwardPe, revenueGrowth, earningsGrowth,
                    profitMargin, marketCap, recKey, targetMean, stage, fundamentalsScore, now).run();

            // 기관보유비중 스냅샷 (institutional-flow.js의 추세 diff용) — 같은 fetch 결과 재사용, 추가 fetch 없음
            if (instPct != null) {
                await env.DB.prepare(`
                    INSERT INTO institutional_snapshots (symbol,snapshot_date,institutions_pct,insiders_pct,created_at)
                    VALUES (?,?,?,?,?)
                    ON CONFLICT(symbol,snapshot_date) DO UPDATE SET institutions_pct=excluded.institutions_pct, insiders_pct=excluded.insiders_pct
                `).bind(symbol, snapshotDate, instPct, insidersPct, now).run();
            }

            results.push({ symbol, revenueGrowth, earningsGrowth, peRatio, marketCap, stage, fundamentalsScore, instPct, price: _raw(pr.regularMarketPrice) });
        } catch (e) {
            console.warn('[growth-fundamentals] fail', symbol, e?.message);
        }
    }
    return results;
}
