// 시그널 누적 통계 API — D1 signal_history 기반
import { json, err } from '../utils/validators.js';

/**
 * GET /api/stats/signals?days=7
 * 최근 N일 시그널 통계 + 등급별 + 종목별 분포
 */
export async function handleSignalStats(req, env) {
    const url = new URL(req.url);
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10), 1), 90);
    const since = Date.now() - days * 24 * 3600 * 1000;
    try {
        // 1) 총 카운트 + 방향별
        const totals = await env.DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN direction='buy'  THEN 1 ELSE 0 END) AS buy_count,
                SUM(CASE WHEN direction='sell' THEN 1 ELSE 0 END) AS sell_count
             FROM signal_history WHERE created_at >= ?`
        ).bind(since).first();

        // 2) 등급별 분포
        const grades = await env.DB.prepare(
            `SELECT grade, COUNT(*) AS count, AVG(win_rate) AS avg_winrate
             FROM signal_history WHERE created_at >= ?
             GROUP BY grade ORDER BY
                CASE grade WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END`
        ).bind(since).all();

        // 3) TOP 10 종목 (가장 시그널 많이 나온)
        const topSymbols = await env.DB.prepare(
            `SELECT symbol, COUNT(*) AS count,
                SUM(CASE WHEN direction='buy'  THEN 1 ELSE 0 END) AS buy_count,
                SUM(CASE WHEN direction='sell' THEN 1 ELSE 0 END) AS sell_count,
                MAX(created_at) AS last_at
             FROM signal_history WHERE created_at >= ?
             GROUP BY symbol ORDER BY count DESC LIMIT 10`
        ).bind(since).all();

        // 4) 시계열 — 일별 카운트
        const daily = await env.DB.prepare(
            `SELECT
                DATE(created_at/1000, 'unixepoch') AS day,
                COUNT(*) AS count,
                SUM(CASE WHEN direction='buy'  THEN 1 ELSE 0 END) AS buy_count,
                SUM(CASE WHEN direction='sell' THEN 1 ELSE 0 END) AS sell_count,
                SUM(CASE WHEN grade='S' THEN 1 ELSE 0 END) AS s_count,
                SUM(CASE WHEN grade='A' THEN 1 ELSE 0 END) AS a_count
             FROM signal_history WHERE created_at >= ?
             GROUP BY day ORDER BY day ASC`
        ).bind(since).all();

        // 5) 최근 시그널 20개 (테이블 표시용)
        const recent = await env.DB.prepare(
            `SELECT symbol, direction, grade, score, win_rate, price, headline, created_at
             FROM signal_history WHERE created_at >= ?
             ORDER BY created_at DESC LIMIT 20`
        ).bind(since).all();

        return json({
            days,
            totals: totals || { total: 0, buy_count: 0, sell_count: 0 },
            grades: grades.results || [],
            topSymbols: topSymbols.results || [],
            daily: daily.results || [],
            recent: recent.results || [],
        });
    } catch (e) {
        return err(500, e.message);
    }
}
