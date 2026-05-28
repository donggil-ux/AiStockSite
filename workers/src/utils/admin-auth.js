// 관리자 API 인증 — ADMIN_TOKEN 또는 Clerk admin user
//
// 사용:
//   const ok = await requireAdmin(req, env);
//   if (!ok) return err(401, 'admin auth required');
//
// 인증 방법 (둘 중 하나):
//   1. HTTP 헤더 X-Admin-Token: <ADMIN_TOKEN>
//   2. ?token=<ADMIN_TOKEN> 쿼리 파라미터
//   3. (향후) Clerk 로그인 + ADMIN_USER_IDS 환경변수에 user_id 포함
//
// ADMIN_TOKEN 미설정 시 → 항상 401 (안전 기본값)

import { verifyClerkJWT } from './clerk.js';

export async function requireAdmin(req, env) {
    const adminToken = env.ADMIN_TOKEN;
    if (!adminToken) return false; // 미설정 = 비활성 (안전)

    // 1) 헤더 또는 쿼리 토큰 검증
    const url = new URL(req.url);
    const headerToken = req.headers.get('X-Admin-Token') || '';
    const queryToken  = url.searchParams.get('token') || '';
    const provided    = headerToken || queryToken;
    if (provided) {
        // 타이밍 안전 비교
        if (timingSafeEqual(provided, adminToken)) return true;
    }

    // 2) Clerk 로그인 사용자 화이트리스트
    const adminIds = (env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (adminIds.length) {
        const auth = await verifyClerkJWT(req, env);
        if (auth?.userId && adminIds.includes(auth.userId)) return true;
    }

    return false;
}

/** 타이밍 안전 문자열 비교 */
function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
