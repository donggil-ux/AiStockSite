// 섹터 히트맵 — 종목 레벨(시총/등락률/가격) 데이터 수집. 일 1회(00:05 UTC 크론)만 계산 — 저빈도 데이터.
// 분류(어느 종목이 어느 섹터인지)는 정적 큐레이션(heatmap-universe.js)이라 매번 조회 안 함 —
// 시세만 배치 조회(v7/finance/quote, 50개씩)로 갱신 — 119개 종목 기준 3회 요청.
import { yfRequest } from './crumb.js';
import { HEATMAP_UNIVERSE } from './heatmap-universe.js';

const CHUNK_SIZE = 50;

export async function getStockHeatmap(env) {
    const symbols = Object.keys(HEATMAP_UNIVERSE);
    const chunks = [];
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) chunks.push(symbols.slice(i, i + CHUNK_SIZE));

    const results = await Promise.all(chunks.map(chunk =>
        yfRequest(env.CACHE, `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${chunk.map(encodeURIComponent).join(',')}`)
            .catch(e => { console.warn('[heatmap] quote chunk fail', e?.message); return null; })
    ));

    const rows = [];
    for (const data of results) {
        for (const q of data?.quoteResponse?.result || []) {
            const meta = HEATMAP_UNIVERSE[q.symbol];
            if (!meta) continue; // 큐레이션 목록 밖 심볼(중복매칭 등)은 무시
            rows.push({
                symbol: q.symbol,
                sectorEtf: meta.sectorEtf,
                companyName: meta.name || q.shortName || q.symbol,
                marketCap: q.marketCap ?? null,
                dayChangePct: q.regularMarketChangePercent ?? null,
                price: q.regularMarketPrice ?? null,
            });
        }
    }
    if (!rows.length) return rows;

    const snapshotDate = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    await env.DB.batch(rows.map(r => env.DB.prepare(`
        INSERT INTO stock_heatmap (snapshot_date,symbol,sector_etf,company_name,market_cap,day_change_pct,price,created_at)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(snapshot_date,symbol) DO UPDATE SET
          sector_etf=excluded.sector_etf, company_name=excluded.company_name,
          market_cap=excluded.market_cap, day_change_pct=excluded.day_change_pct, price=excluded.price
    `).bind(snapshotDate, r.symbol, r.sectorEtf, r.companyName, r.marketCap, r.dayChangePct, r.price, now)));

    return rows;
}

// API용 읽기 전용 — D1에서 최신 스냅샷만 조회, Yahoo 호출 없음
export async function getCachedStockHeatmap(env) {
    const latest = await env.DB.prepare('SELECT MAX(snapshot_date) d FROM stock_heatmap').first();
    if (!latest?.d) return [];
    const rows = await env.DB.prepare(
        'SELECT * FROM stock_heatmap WHERE snapshot_date=? ORDER BY sector_etf, market_cap DESC'
    ).bind(latest.d).all();
    return rows.results || [];
}
