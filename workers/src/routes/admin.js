// 운영 모니터링 API — D1/KV 상태, cron 통계, 사용량 요약
import { json, err } from '../utils/validators.js';
import { requireAdmin } from '../utils/admin-auth.js';
import { analyzeSignals } from '../cron.js';

/**
 * POST /api/admin/analyze-now?market=US
 * analyzeSignals 수동 트리거 (QA·점검용). 장 마감 시간에도 발굴·분석 동작 확인.
 * 반환: { subscribers, symbols, favSymbols, dynamic, analyzed, fired, skippedBlacklist }
 */
export async function handleAnalyzeNow(req, env) {
    if (!(await requireAdmin(req, env))) return err(401, 'admin auth required');
    try {
        const market = new URL(req.url).searchParams.get('market') || 'US';
        const result = await analyzeSignals(env, market);
        return json({ ok: true, market, result });
    } catch (e) {
        return err(500, e.message);
    }
}

/**
 * GET /api/admin/status
 * Workers 백엔드의 운영 상태 종합 (대시보드용)
 * ADMIN_TOKEN 헤더 또는 ?token= 인증 필수
 */
export async function handleAdminStatus(req, env) {
    if (!(await requireAdmin(req, env))) return err(401, 'admin auth required (set ADMIN_TOKEN secret or X-Admin-Token header)');
    try {
        const since24h = Date.now() - 86400 * 1000;
        const since7d  = Date.now() - 7 * 86400 * 1000;
        const sinceNow = Date.now();

        // 1) 구독자 / 즐겨찾기 / 알림 통계
        const subStats = await env.DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS active_24h,
                SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS active_7d
             FROM push_subscribers`
        ).bind(since24h, since7d).first();

        // 2) 가격 알림 통계
        const alertStats = await env.DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN triggered = 0 THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN triggered = 1 AND triggered_at >= ? THEN 1 ELSE 0 END) AS triggered_24h
             FROM price_alerts`
        ).bind(since24h).first();

        // 3) 시그널 히스토리 통계
        const sigStats = await env.DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_24h,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_7d,
                SUM(CASE WHEN grade='S' THEN 1 ELSE 0 END) AS s_total,
                SUM(CASE WHEN grade='A' THEN 1 ELSE 0 END) AS a_total
             FROM signal_history`
        ).bind(since24h, since7d).first();

        // 4) KV crumb 캐시 상태
        let crumbStatus = 'unknown';
        try {
            const cached = await env.CACHE.get('yf:crumb', 'json');
            if (cached?.ts) {
                const age = Math.floor((sinceNow - cached.ts) / 1000);
                crumbStatus = age < 3600 ? `valid (${age}s old)` : `expired (${age}s)`;
            } else {
                crumbStatus = 'empty';
            }
        } catch (_) {}

        // 5) 가장 최근 시그널 5개
        const recent = await env.DB.prepare(
            `SELECT symbol, direction, grade, price, created_at
             FROM signal_history ORDER BY created_at DESC LIMIT 5`
        ).all();

        // 6) 최근 24시간 에러 통계 + 최근 10개
        const errStats = await env.DB.prepare(
            `SELECT
                COUNT(*) AS total_24h,
                SUM(CASE WHEN source='client' THEN 1 ELSE 0 END) AS client,
                SUM(CASE WHEN source='worker' THEN 1 ELSE 0 END) AS worker,
                SUM(CASE WHEN source='cron'   THEN 1 ELSE 0 END) AS cron
             FROM errors WHERE created_at >= ?`
        ).bind(since24h).first();

        const errRecent = await env.DB.prepare(
            `SELECT source, severity, message, created_at
             FROM errors ORDER BY created_at DESC LIMIT 10`
        ).all();

        // 7) 최근 7일 헬스 스냅샷
        const health = await env.DB.prepare(
            `SELECT snapshot_date, subscribers, active_24h, signals_24h, pushes_24h, errors_24h, feedbacks_24h
             FROM health_snapshots ORDER BY snapshot_date DESC LIMIT 7`
        ).all();

        return json({
            timestamp: sinceNow,
            uptime: 'always (Cloudflare Workers)',
            bindings: {
                kv: !!env.CACHE,
                d1: !!env.DB,
                vapidPublic: !!env.VAPID_PUBLIC_KEY,
                vapidPrivate: !!env.VAPID_PRIVATE_KEY,
                vapidSubject: !!env.VAPID_SUBJECT,
                polygon: !!env.POLYGON_API,
                clerk: !!env.CLERK_PUBLISHABLE_KEY,
            },
            subscribers: subStats || { total: 0, active_24h: 0, active_7d: 0 },
            priceAlerts: alertStats || { total: 0, pending: 0, triggered_24h: 0 },
            signals: sigStats || { total: 0, last_24h: 0, last_7d: 0, s_total: 0, a_total: 0 },
            errors: errStats || { total_24h: 0, client: 0, worker: 0, cron: 0 },
            recentErrors: errRecent.results || [],
            healthSnapshots: health.results || [],
            yahooCrumb: crumbStatus,
            recentSignals: recent.results || [],
            cron: {
                schedule: [
                    '*/5 13-21 * * 1-5 (미국 정규장)',
                    '*/5 0-6 * * 1-5 (한국 정규장)',
                    '0 0 * * 1-5 (실적 리마인더)',
                    '30 * * * * (시그널 결과 매칭)',
                    '5 0 * * * (일별 헬스 스냅샷 + 에러 정리)',
                ],
                estimatedDaily: '~115회',
            },
        });
    } catch (e) {
        return err(500, e.message);
    }
}
