// 알고리즘 보정 API — 현재 상태 조회 (공개) + 수동 트리거 (관리자)
import { json, err } from '../utils/validators.js';
import { requireAdmin } from '../utils/admin-auth.js';
import { calibrateAlgorithm, loadAlgorithmConfig } from '../utils/calibration.js';

/**
 * GET /api/calibration/status
 * 공개 API — 현재 알고리즘 설정 + 마지막 보정 결과 + 다음 보정 예정
 */
export async function handleCalibrationStatus(req, env) {
    try {
        const cfg = await loadAlgorithmConfig(env);

        // 마지막 보정 결과
        let lastRun = null;
        try {
            const r = await env.DB.prepare("SELECT value FROM algorithm_config WHERE key='last_calibration'").first();
            if (r?.value) lastRun = JSON.parse(r.value);
        } catch (_) {}

        // 최근 보정 히스토리 5건
        const history = await env.DB.prepare(
            `SELECT run_at, samples_analyzed, symbols_updated, symbols_blacklisted, notes
             FROM calibration_log ORDER BY run_at DESC LIMIT 5`
        ).all();

        // 다음 보정 예정 시각 (매주 일요일 UTC 03:00)
        const now = new Date();
        const next = new Date(now);
        const daysUntilSunday = (7 - now.getUTCDay()) % 7;
        next.setUTCDate(now.getUTCDate() + (daysUntilSunday || 7));
        next.setUTCHours(3, 0, 0, 0);

        // 블랙리스트 종목 + 가중치 강화 종목
        const symbols = await env.DB.prepare(
            `SELECT symbol, weight, samples, avg_return, winrate, blacklisted, reason
             FROM symbol_weights ORDER BY updated_at DESC LIMIT 20`
        ).all();

        return json({
            thresholds: cfg,
            last_calibration: lastRun,
            next_calibration_at: next.toISOString(),
            history: history.results || [],
            symbols: symbols.results || [],
        });
    } catch (e) {
        return err(500, e.message);
    }
}

/**
 * POST /api/admin/calibrate?dryRun=1
 * 관리자 — 수동 보정 트리거 (ADMIN_TOKEN 필요)
 * dryRun=1: 결과만 계산하고 저장 안 함 (미리보기)
 */
export async function handleCalibrateNow(req, env) {
    if (!(await requireAdmin(req, env))) return err(401, 'admin auth required');
    try {
        const url = new URL(req.url);
        const dryRun = url.searchParams.get('dryRun') === '1';
        const result = await calibrateAlgorithm(env, { dryRun });
        return json(result);
    } catch (e) {
        return err(500, e.message);
    }
}
