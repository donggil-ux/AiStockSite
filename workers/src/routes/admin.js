// 운영 모니터링 API — D1/KV 상태, cron 통계, 사용량 요약
import { json, err } from '../utils/validators.js';

/**
 * GET /api/admin/status
 * Workers 백엔드의 운영 상태 종합 (대시보드용)
 * 시크릿 인증 없음 — 민감 데이터 미노출
 */
export async function handleAdminStatus(req, env) {
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
            },
            subscribers: subStats || { total: 0, active_24h: 0, active_7d: 0 },
            priceAlerts: alertStats || { total: 0, pending: 0, triggered_24h: 0 },
            signals: sigStats || { total: 0, last_24h: 0, last_7d: 0, s_total: 0, a_total: 0 },
            yahooCrumb: crumbStatus,
            recentSignals: recent.results || [],
            cron: {
                schedule: [
                    '*/5 13-21 * * 1-5 (미국 정규장)',
                    '*/5 0-6 * * 1-5 (한국 정규장)',
                    '0 0 * * 1-5 (실적 리마인더)',
                ],
                estimatedDaily: '~90회',
            },
        });
    } catch (e) {
        return err(500, e.message);
    }
}
