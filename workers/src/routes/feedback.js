// 시그널 평가 API — 사용자 피드백 (👍/👎)
import { json, err } from '../utils/validators.js';
import { verifyClerkJWT } from '../utils/clerk.js';

/**
 * POST /api/signals/:id/feedback
 * Body: { rating: 1 | -1, subToken?, note? }
 * Auth: Bearer (선택) — 로그인 시 user_id, 비로그인 시 sub_token 으로 식별
 *
 * UNIQUE(signal_id, sub_token), UNIQUE(signal_id, user_id) 로 1인 1회 보장.
 * 같은 사용자가 다시 호출 시 rating 만 업데이트.
 */
export async function handleSignalFeedback(req, env, params) {
    try {
        const signalId = parseInt(params.id, 10);
        if (!Number.isFinite(signalId) || signalId <= 0) return err(400, 'invalid signal id');
        const b = await req.json();
        const rating = b?.rating === 1 ? 1 : b?.rating === -1 ? -1 : null;
        if (rating == null) return err(400, 'rating must be 1 or -1');
        const subToken = b?.subToken || null;
        const note = (b?.note && typeof b.note === 'string') ? b.note.slice(0, 500) : null;

        const auth = await verifyClerkJWT(req, env);
        const userId = auth?.userId || null;

        if (!userId && !subToken) return err(400, 'auth or subToken required');

        // signal 존재 확인
        const sig = await env.DB.prepare(
            'SELECT id, symbol FROM signal_history WHERE id=?'
        ).bind(signalId).first();
        if (!sig) return err(404, 'signal not found');

        // upsert — UNIQUE 제약 위반 시 UPDATE
        const now = Date.now();
        try {
            await env.DB.prepare(
                `INSERT INTO signal_feedback (signal_id, sub_token, user_id, rating, note, created_at)
                 VALUES (?,?,?,?,?,?)`
            ).bind(signalId, subToken, userId, rating, note, now).run();
        } catch (e) {
            // UNIQUE 위반 → 업데이트
            if (userId) {
                await env.DB.prepare(
                    'UPDATE signal_feedback SET rating=?, note=?, created_at=? WHERE signal_id=? AND user_id=?'
                ).bind(rating, note, now, signalId, userId).run();
            } else if (subToken) {
                await env.DB.prepare(
                    'UPDATE signal_feedback SET rating=?, note=?, created_at=? WHERE signal_id=? AND sub_token=?'
                ).bind(rating, note, now, signalId, subToken).run();
            }
        }

        // 누적 통계 즉시 반환 (UI 즉시 갱신용)
        const agg = await env.DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN rating=1  THEN 1 ELSE 0 END) AS up,
                SUM(CASE WHEN rating=-1 THEN 1 ELSE 0 END) AS down
             FROM signal_feedback WHERE signal_id=?`
        ).bind(signalId).first();

        return json({ ok: true, symbol: sig.symbol, feedback: agg || { total: 0, up: 0, down: 0 } });
    } catch (e) {
        return err(500, e.message);
    }
}

/**
 * GET /api/signals/:id/feedback
 * 시그널 누적 평가 + 현재 사용자의 rating 반환 (UI 초기화용)
 */
export async function handleGetSignalFeedback(req, env, params) {
    try {
        const signalId = parseInt(params.id, 10);
        if (!Number.isFinite(signalId) || signalId <= 0) return err(400, 'invalid signal id');
        const url = new URL(req.url);
        const subToken = url.searchParams.get('subToken');
        const auth = await verifyClerkJWT(req, env);
        const userId = auth?.userId || null;

        const agg = await env.DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN rating=1  THEN 1 ELSE 0 END) AS up,
                SUM(CASE WHEN rating=-1 THEN 1 ELSE 0 END) AS down
             FROM signal_feedback WHERE signal_id=?`
        ).bind(signalId).first();

        // 사용자의 현재 평가
        let myRating = null;
        if (userId) {
            const r = await env.DB.prepare(
                'SELECT rating FROM signal_feedback WHERE signal_id=? AND user_id=?'
            ).bind(signalId, userId).first();
            myRating = r?.rating ?? null;
        } else if (subToken) {
            const r = await env.DB.prepare(
                'SELECT rating FROM signal_feedback WHERE signal_id=? AND sub_token=?'
            ).bind(signalId, subToken).first();
            myRating = r?.rating ?? null;
        }

        return json({
            feedback: agg || { total: 0, up: 0, down: 0 },
            myRating,
        });
    } catch (e) {
        return err(500, e.message);
    }
}
