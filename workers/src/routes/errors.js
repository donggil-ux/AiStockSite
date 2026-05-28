// 클라이언트 에러 보고 + 관리자용 에러 조회 API
import { json, err } from '../utils/validators.js';
import { logError } from '../utils/errors.js';
import { verifyClerkJWT } from '../utils/clerk.js';
import { requireAdmin } from '../utils/admin-auth.js';

// IP 레이트 제한 — module-level Map (isolate 단위 메모리 캐시)
// KV PUT 절약 (이전: 매 에러마다 PUT 1회)
const _ipRateMap = new Map(); // ip → { count, resetAt }
const _IP_LIMIT = 10;
const _IP_WIN_MS = 60_000;
function _ipRateLimitHit(ip) {
    const now = Date.now();
    const e = _ipRateMap.get(ip);
    if (!e || e.resetAt < now) {
        _ipRateMap.set(ip, { count: 1, resetAt: now + _IP_WIN_MS });
        // 가끔 정리 (메모리 누수 방지)
        if (_ipRateMap.size > 2000) {
            for (const [k, v] of _ipRateMap) if (v.resetAt < now) _ipRateMap.delete(k);
        }
        return false;
    }
    e.count++;
    return e.count > _IP_LIMIT;
}

/**
 * POST /api/errors
 * Body: { source?, severity?, message, stack?, context?, sub_token? }
 *
 * 익명 허용 — 단, 같은 fingerprint 1분 내 5회 초과 시 자동 무시 (utils/errors.js)
 * 추가 보호: IP 당 1분 10회 (메모리 카운터, KV 없이 — Workers KV PUT 절약)
 */
export async function handleReportError(req, env) {
    try {
        const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
        if (_ipRateLimitHit(ip)) return err(429, 'rate limited');

        const b = await req.json();
        if (!b?.message) return err(400, 'message required');

        const auth = await verifyClerkJWT(req, env);
        await logError(env, {
            source: ['client', 'worker', 'cron', 'fetch'].includes(b.source) ? b.source : 'client',
            severity: ['error', 'warn', 'fatal'].includes(b.severity) ? b.severity : 'error',
            message: b.message,
            stack: b.stack,
            context: { ...(b.context || {}), ip, ua: req.headers.get('User-Agent')?.slice(0, 200) },
            sub_token: b.sub_token || null,
            user_id: auth?.userId || null,
        });
        return json({ ok: true });
    } catch (e) {
        return err(500, e.message);
    }
}

/**
 * GET /api/admin/errors?limit=50&since=24h
 * 관리자용 — 최근 에러 그룹별 + 개별 목록.
 * ADMIN_TOKEN 인증 필수.
 */
export async function handleListErrors(req, env) {
    if (!(await requireAdmin(req, env))) return err(401, 'admin auth required');
    try {
        const url = new URL(req.url);
        const sinceArg = url.searchParams.get('since') || '24h';
        const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get('limit') || '50', 10)));
        const sinceMs = parseSince(sinceArg);
        const since = Date.now() - sinceMs;

        // 1) 그룹핑된 에러 (fingerprint 기준 누적 카운트 + 가장 최근 발생)
        const grouped = await env.DB.prepare(
            `SELECT fingerprint, source, severity,
                COUNT(*) AS count,
                MAX(created_at) AS last_seen,
                MIN(created_at) AS first_seen,
                MAX(message) AS sample_message
             FROM errors
             WHERE created_at >= ?
             GROUP BY fingerprint
             ORDER BY last_seen DESC
             LIMIT ?`
        ).bind(since, limit).all();

        // 2) 소스별 합계
        const bySource = await env.DB.prepare(
            `SELECT source, COUNT(*) AS count
             FROM errors WHERE created_at >= ?
             GROUP BY source ORDER BY count DESC`
        ).bind(since).all();

        // 3) 시간대별 분포 (일별)
        const daily = await env.DB.prepare(
            `SELECT DATE(created_at/1000, 'unixepoch') AS day, COUNT(*) AS count
             FROM errors WHERE created_at >= ?
             GROUP BY day ORDER BY day ASC`
        ).bind(since).all();

        return json({
            since: sinceArg,
            sinceMs,
            grouped: grouped.results || [],
            bySource: bySource.results || [],
            daily: daily.results || [],
        });
    } catch (e) {
        return err(500, e.message);
    }
}

function parseSince(s) {
    const m = String(s).match(/^(\d+)\s*([hdm])$/i);
    if (!m) return 24 * 3600_000;
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    return n * (u === 'h' ? 3600_000 : u === 'd' ? 86400_000 : 60_000);
}
