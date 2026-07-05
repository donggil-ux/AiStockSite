// 성장주 발굴 레이어 — API 엔드포인트 (D1 읽기 전용, Yahoo 호출 없음 → 서브리퀘스트 예산 소모 거의 0)
import { json, err } from '../utils/validators.js';
import { requireAdmin } from '../utils/admin-auth.js';
import { getCachedSectorHeat } from '../utils/sector-heat.js';
import { runDailyGrowthScan } from '../utils/growth-scorer.js';

// GET /api/growth/sector-heat
export async function handleGrowthSectorHeat(req, env) {
    try {
        const rows = await getCachedSectorHeat(env);
        return json({ sectors: rows });
    } catch (e) {
        return err(500, e.message);
    }
}

// GET /api/growth/recommendations?sector=XLK&limit=30
export async function handleGrowthRecommendations(req, env) {
    try {
        const url = new URL(req.url);
        const sector = url.searchParams.get('sector');
        const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '30', 10)));

        const latest = await env.DB.prepare('SELECT MAX(snapshot_date) d FROM growth_recommendations').first();
        if (!latest?.d) return json({ snapshotDate: null, recommendations: [] });

        const rows = sector
            ? await env.DB.prepare(
                'SELECT * FROM growth_recommendations WHERE snapshot_date=? AND sector_etf=? ORDER BY composite_score DESC LIMIT ?'
              ).bind(latest.d, sector, limit).all()
            : await env.DB.prepare(
                'SELECT * FROM growth_recommendations WHERE snapshot_date=? ORDER BY composite_score DESC LIMIT ?'
              ).bind(latest.d, limit).all();

        const recommendations = (rows.results || []).map(r => ({ ...r, reasons: JSON.parse(r.reasons_json || '[]') }));
        return json({ snapshotDate: latest.d, recommendations });
    } catch (e) {
        return err(500, e.message);
    }
}

// GET /api/growth/company/:symbol
export async function handleGrowthCompany(req, env, params) {
    try {
        const symbol = (params?.symbol || '').toUpperCase();
        if (!symbol) return err(400, 'symbol required');

        const [fundamentals, flow, instSnaps, recRow] = await Promise.all([
            env.DB.prepare('SELECT * FROM growth_fundamentals WHERE symbol=?').bind(symbol).first(),
            env.DB.prepare('SELECT * FROM volume_flow WHERE symbol=?').bind(symbol).first(),
            env.DB.prepare('SELECT snapshot_date, institutions_pct, insiders_pct FROM institutional_snapshots WHERE symbol=? ORDER BY snapshot_date DESC LIMIT 4').bind(symbol).all(),
            env.DB.prepare('SELECT * FROM growth_recommendations WHERE symbol=? ORDER BY snapshot_date DESC LIMIT 1').bind(symbol).first(),
        ]);

        return json({
            symbol,
            fundamentals: fundamentals || null,
            flow: flow || null,
            institutionalHistory: instSnaps.results || [],
            recommendation: recRow ? { ...recRow, reasons: JSON.parse(recRow.reasons_json || '[]') } : null,
        });
    } catch (e) {
        return err(500, e.message);
    }
}

// POST /api/admin/growth-scan-now — 관리자 수동 재실행 (크론 안 기다리고 테스트용)
export async function handleGrowthScanNow(req, env) {
    if (!(await requireAdmin(req, env))) return err(401, 'admin auth required');
    try {
        const result = await runDailyGrowthScan(env);
        return json({ ok: true, result });
    } catch (e) {
        return err(500, e.message);
    }
}
