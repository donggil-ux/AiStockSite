// 성장주 발굴 레이어 — 섹터/테마 모멘텀("어느 업종이 뜨고 있는지") 랭킹
// 기존 getSectorRotation()(당일 등락률)을 확장해 5일/1개월/3개월 추세 + SPY 대비 상대강도 +
// 섹터 자체 뉴스 감성까지 합쳐 heat_score(0~100)로 랭킹. 일 1회(00:05 UTC 크론)만 계산 — 저빈도 데이터.
import { yfRequest } from './crumb.js';
import { getNewsSentiment } from './news-sentiment.js';
import { SECTOR_ETFS } from './market.js';

export const SECTOR_LABELS = {
    XLK: '기술', XLC: '커뮤니케이션', XLY: '임의소비재', XLF: '금융', XLE: '에너지',
    XLV: '헬스케어', XLI: '산업재', XLB: '소재', XLRE: '리츠', XLU: '유틸리티', XLP: '필수소비재',
};

// 섹터 ETF 하나의 3개월 일봉에서 1d/5d/1mo/3mo % 변화 추출
function _perfFromCloses(closes) {
    const c = (closes || []).filter(v => v != null);
    const n = c.length;
    if (n < 2) return { perf1d: 0, perf5d: 0, perf1mo: 0, perf3mo: 0 };
    const at = (back) => c[Math.max(0, n - 1 - back)];
    const pct = (from, to) => from > 0 ? +(((to - from) / from) * 100).toFixed(2) : 0;
    const last = c[n - 1];
    return {
        perf1d: pct(at(1), last),
        perf5d: pct(at(5), last),
        perf1mo: pct(at(21), last),
        perf3mo: pct(at(63), last),
    };
}

// 섹터 11개 + SPY 3개월 일봉 fetch → heat_score 계산 → D1 upsert (일 1회 호출 전제)
export async function getSectorHeat(env) {
    const base = 'https://query1.finance.yahoo.com/v8/finance/chart/';
    const [spyRaw, ...sectorRaws] = await Promise.all([
        yfRequest(env.CACHE, `${base}SPY?range=3mo&interval=1d`).catch(() => null),
        ...SECTOR_ETFS.map(sym => yfRequest(env.CACHE, `${base}${sym}?range=3mo&interval=1d`).catch(() => null)),
    ]);
    const spyPerf = _perfFromCloses(spyRaw?.chart?.result?.[0]?.indicators?.quote?.[0]?.close);

    // 1차: 가격 기반 점수만으로 전체 11개 순위 산정 (fetch 12개, 저비용)
    let rows = SECTOR_ETFS.map((sym, i) => {
        const perf = _perfFromCloses(sectorRaws[i]?.chart?.result?.[0]?.indicators?.quote?.[0]?.close);
        const relStrength = +(perf.perf1mo - spyPerf.perf1mo).toFixed(2);
        const composite = perf.perf5d * 0.3 + perf.perf1mo * 0.4 + relStrength * 0.2;
        const heatScore = Math.max(0, Math.min(100, Math.round(50 + composite * 2)));
        return { sectorEtf: sym, sectorLabel: SECTOR_LABELS[sym] || sym, ...perf, relStrength, newsScore: 0, heatScore };
    });
    rows.sort((a, b) => b.heatScore - a.heatScore);

    // 2차: 상위 3개 섹터에 한해서만 뉴스 감성 보너스 반영 (서브리퀘스트 절감 — 11개 전부 조회하면 예산 초과)
    for (let i = 0; i < Math.min(3, rows.length); i++) {
        const r = rows[i];
        const news = await getNewsSentiment(env, r.sectorEtf).catch(() => ({ score: 0 }));
        r.newsScore = news.score || 0;
        r.heatScore = Math.max(0, Math.min(100, Math.round(r.heatScore + r.newsScore * 2)));
    }

    rows.sort((a, b) => b.heatScore - a.heatScore);
    rows.forEach((r, i) => { r.heatRank = i + 1; });

    const snapshotDate = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    await env.DB.batch(rows.map(r => env.DB.prepare(`
        INSERT INTO sector_heat (snapshot_date,sector_etf,sector_label,perf_1d,perf_5d,perf_1mo,perf_3mo,rel_strength,news_score,heat_score,heat_rank,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(snapshot_date,sector_etf) DO UPDATE SET
          perf_1d=excluded.perf_1d, perf_5d=excluded.perf_5d, perf_1mo=excluded.perf_1mo, perf_3mo=excluded.perf_3mo,
          rel_strength=excluded.rel_strength, news_score=excluded.news_score, heat_score=excluded.heat_score, heat_rank=excluded.heat_rank
    `).bind(snapshotDate, r.sectorEtf, r.sectorLabel, r.perf1d, r.perf5d, r.perf1mo, r.perf3mo, r.relStrength, r.newsScore, r.heatScore, r.heatRank, now)));

    return rows;
}

// API/텔레그램용 읽기 전용 — D1에서 최신 스냅샷만 조회, Yahoo 호출 없음
export async function getCachedSectorHeat(env) {
    const latest = await env.DB.prepare('SELECT MAX(snapshot_date) d FROM sector_heat').first();
    if (!latest?.d) return [];
    const rows = await env.DB.prepare(
        'SELECT * FROM sector_heat WHERE snapshot_date=? ORDER BY heat_rank ASC'
    ).bind(latest.d).all();
    return rows.results || [];
}

// 섹터 ETF의 실제 구성종목(top holdings)을 성장주 스크리닝 후보 유니버스로 사용 — 상위 N개
export async function getSectorHoldings(env, sectorEtf, limit = 12) {
    try {
        const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sectorEtf}?modules=topHoldings`;
        const data = await yfRequest(env.CACHE, url);
        const holdings = data?.quoteSummary?.result?.[0]?.topHoldings?.holdings || [];
        return holdings.slice(0, limit).map(h => h.symbol).filter(Boolean);
    } catch (_) { return []; }
}
