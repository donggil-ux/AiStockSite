// 자체 에러 추적 시스템 — D1 errors 테이블에 기록
// Sentry 대체 — 무료 + Workers 자체 호스팅

/**
 * 에러를 D1 에 기록 (실패해도 throw 안 함 — 무한 루프 방지)
 * @param {Object} env - Workers env
 * @param {Object} info - { source, severity, message, stack, context, sub_token, user_id }
 */
export async function logError(env, info) {
    try {
        if (!env?.DB) return;
        const source = info.source || 'worker';
        const severity = info.severity || 'error';
        const message = String(info.message || 'unknown').slice(0, 1000);
        const stack = info.stack ? String(info.stack).slice(0, 4000) : null;
        const context = info.context ? JSON.stringify(info.context).slice(0, 2000) : null;
        // fingerprint = source + 메시지 앞부분 해시 (그룹핑)
        const fpRaw = source + ':' + message.slice(0, 200);
        const fp = await sha1(fpRaw);

        // Rate limit: 같은 fingerprint 1분 내 5회 초과 시 스킵
        const recentCount = await env.DB.prepare(
            'SELECT COUNT(*) AS c FROM errors WHERE fingerprint=? AND created_at >= ?'
        ).bind(fp, Date.now() - 60_000).first();
        if ((recentCount?.c || 0) >= 5) return;

        await env.DB.prepare(
            `INSERT INTO errors (source, severity, message, stack, context, fingerprint, sub_token, user_id, created_at)
             VALUES (?,?,?,?,?,?,?,?,?)`
        ).bind(source, severity, message, stack, context, fp, info.sub_token || null, info.user_id || null, Date.now()).run();
    } catch (e) {
        // 에러 로깅 자체 실패 — console 에만 남김
        console.error('[logError]', e.message);
    }
}

/** SHA-1 짧은 해시 (8자) — Worker 환경 */
async function sha1(s) {
    try {
        const buf = new TextEncoder().encode(s);
        const hash = await crypto.subtle.digest('SHA-1', buf);
        const arr = new Uint8Array(hash);
        return [...arr.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
        return 'nohash';
    }
}

/** retention: 30일 이상 된 에러 삭제 */
export async function pruneOldErrors(env) {
    try {
        const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
        const r = await env.DB.prepare('DELETE FROM errors WHERE created_at < ?').bind(cutoff).run();
        return { deleted: r.meta?.changes || 0 };
    } catch (e) {
        return { error: e.message };
    }
}
