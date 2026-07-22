// 섹터 히트맵 레이어 — API 엔드포인트 (D1 읽기 전용, Yahoo 호출 없음 → 서브리퀘스트 예산 거의 0)
import { json, err } from '../utils/validators.js';
import { requireAdmin } from '../utils/admin-auth.js';
import { getCachedStockHeatmap, getStockHeatmap } from '../utils/stock-heatmap.js';
import { getCachedSectorHeat } from '../utils/sector-heat.js';

// GET /api/heatmap — 섹터별로 그룹핑된 종목 리스트 (트리맵 렌더링용)
export async function handleHeatmap(req, env) {
    try {
        const [stocks, sectors] = await Promise.all([
            getCachedStockHeatmap(env),
            getCachedSectorHeat(env),
        ]);
        const sectorMeta = Object.fromEntries(sectors.map(s => [s.sector_etf, s]));
        const bySector = {};
        for (const s of stocks) (bySector[s.sector_etf] ||= []).push(s);

        const grouped = Object.entries(bySector).map(([sectorEtf, list]) => ({
            sectorEtf,
            sectorLabel: sectorMeta[sectorEtf]?.sector_label || sectorEtf,
            heatScore: sectorMeta[sectorEtf]?.heat_score ?? null,
            stocks: list,
        }));

        return json({ snapshotDate: stocks[0]?.snapshot_date || null, sectors: grouped });
    } catch (e) {
        return err(500, e.message);
    }
}

// POST /api/admin/heatmap-scan-now — 크론 기다리지 않고 수동 갱신 (관리자 전용)
export async function handleHeatmapScanNow(req, env) {
    if (!(await requireAdmin(req, env))) return err(401, 'admin auth required');
    try {
        const rows = await getStockHeatmap(env);
        return json({ ok: true, count: rows.length });
    } catch (e) {
        return err(500, e.message);
    }
}
