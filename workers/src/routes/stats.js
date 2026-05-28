// 시그널 누적 통계 + 백테스트 API — D1 signal_history 기반
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
            `SELECT symbol, direction, grade, score, win_rate, price, headline, created_at,
                    price_1h, price_4h, price_24h, max_gain_24h, max_loss_24h, resolved
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

/**
 * GET /api/stats/backtest?days=30
 * 실제 시그널 정확도 — 결과가 매칭된(price_24h IS NOT NULL) 시그널만 분석.
 *
 * 등급별 실제 승률(매수: 24h 후 가격 > 진입가, 매도: 24h 후 가격 < 진입가),
 * 평균 수익률(buy: (price_24h-price)/price, sell: (price-price_24h)/price),
 * 시그널 발생 1h/4h/24h 시간대별 누적 수익률,
 * 종목별 정확도 TOP/BOTTOM,
 * 일별 평균 수익률 시계열.
 *
 * Note: max_gain_24h 는 24h 내 최고가, max_loss_24h 는 24h 내 최저가 (둘 다 %).
 *   - buy 시그널: max_gain_24h 가 익절 도달 가능성, max_loss_24h 가 손절 도달 가능성
 *   - sell 시그널: 부호 반전 후 같은 의미
 */
export async function handleBacktest(req, env) {
    const url = new URL(req.url);
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10), 1), 365);
    const since = Date.now() - days * 24 * 3600 * 1000;
    try {
        // 매칭 진척도 — 결과 매칭 완료된 시그널 비율
        const progress = await env.DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN price_1h  IS NOT NULL THEN 1 ELSE 0 END) AS has_1h,
                SUM(CASE WHEN price_4h  IS NOT NULL THEN 1 ELSE 0 END) AS has_4h,
                SUM(CASE WHEN price_24h IS NOT NULL THEN 1 ELSE 0 END) AS has_24h,
                SUM(CASE WHEN price_7d  IS NOT NULL THEN 1 ELSE 0 END) AS has_7d,
                SUM(CASE WHEN resolved=1 THEN 1 ELSE 0 END) AS resolved
             FROM signal_history WHERE created_at >= ?`
        ).bind(since).first();

        // 등급별 실제 정확도 (24h 기준)
        // 수익률 = direction이 buy면 (price_24h-price)/price*100, sell이면 (price-price_24h)/price*100
        const accuracy = await env.DB.prepare(
            `SELECT
                grade,
                COUNT(*) AS samples,
                AVG(CASE
                    WHEN direction='buy'  THEN (price_24h - price) / price * 100.0
                    WHEN direction='sell' THEN (price - price_24h) / price * 100.0
                END) AS avg_return_24h,
                AVG(CASE
                    WHEN direction='buy'  AND price_24h > price THEN 1.0
                    WHEN direction='sell' AND price_24h < price THEN 1.0
                    ELSE 0.0
                END) * 100 AS actual_winrate,
                AVG(max_gain_24h) AS avg_max_gain,
                AVG(max_loss_24h) AS avg_max_loss
             FROM signal_history
             WHERE created_at >= ? AND price_24h IS NOT NULL AND price > 0
             GROUP BY grade
             ORDER BY CASE grade WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END`
        ).bind(since).all();

        // 시간대별 평균 수익률 (1h/4h/24h)
        const horizons = await env.DB.prepare(
            `SELECT
                AVG(CASE WHEN price_1h IS NOT NULL AND price > 0 THEN
                    CASE WHEN direction='buy' THEN (price_1h-price)/price*100 ELSE (price-price_1h)/price*100 END
                END) AS avg_1h,
                AVG(CASE WHEN price_4h IS NOT NULL AND price > 0 THEN
                    CASE WHEN direction='buy' THEN (price_4h-price)/price*100 ELSE (price-price_4h)/price*100 END
                END) AS avg_4h,
                AVG(CASE WHEN price_24h IS NOT NULL AND price > 0 THEN
                    CASE WHEN direction='buy' THEN (price_24h-price)/price*100 ELSE (price-price_24h)/price*100 END
                END) AS avg_24h,
                AVG(CASE WHEN price_7d IS NOT NULL AND price > 0 THEN
                    CASE WHEN direction='buy' THEN (price_7d-price)/price*100 ELSE (price-price_7d)/price*100 END
                END) AS avg_7d,
                COUNT(CASE WHEN price_1h  IS NOT NULL THEN 1 END) AS n_1h,
                COUNT(CASE WHEN price_4h  IS NOT NULL THEN 1 END) AS n_4h,
                COUNT(CASE WHEN price_24h IS NOT NULL THEN 1 END) AS n_24h,
                COUNT(CASE WHEN price_7d  IS NOT NULL THEN 1 END) AS n_7d
             FROM signal_history WHERE created_at >= ?`
        ).bind(since).first();

        // 종목별 정확도 TOP — 5건 이상 시그널 발생한 종목 중 24h 수익률 평균 상위 10
        const topAccurate = await env.DB.prepare(
            `SELECT symbol,
                COUNT(*) AS samples,
                AVG(CASE
                    WHEN direction='buy'  THEN (price_24h-price)/price*100
                    WHEN direction='sell' THEN (price-price_24h)/price*100
                END) AS avg_return,
                AVG(CASE
                    WHEN direction='buy'  AND price_24h > price THEN 1.0
                    WHEN direction='sell' AND price_24h < price THEN 1.0
                    ELSE 0.0
                END) * 100 AS winrate
             FROM signal_history
             WHERE created_at >= ? AND price_24h IS NOT NULL AND price > 0
             GROUP BY symbol
             HAVING samples >= 3
             ORDER BY avg_return DESC
             LIMIT 10`
        ).bind(since).all();

        // 종목별 BOTTOM — 5건 이상 시그널 중 평균 수익률 하위 5
        const bottomAccurate = await env.DB.prepare(
            `SELECT symbol,
                COUNT(*) AS samples,
                AVG(CASE
                    WHEN direction='buy'  THEN (price_24h-price)/price*100
                    WHEN direction='sell' THEN (price-price_24h)/price*100
                END) AS avg_return,
                AVG(CASE
                    WHEN direction='buy'  AND price_24h > price THEN 1.0
                    WHEN direction='sell' AND price_24h < price THEN 1.0
                    ELSE 0.0
                END) * 100 AS winrate
             FROM signal_history
             WHERE created_at >= ? AND price_24h IS NOT NULL AND price > 0
             GROUP BY symbol
             HAVING samples >= 3
             ORDER BY avg_return ASC
             LIMIT 5`
        ).bind(since).all();

        // 일별 평균 수익률 (24h 기준)
        const dailyReturns = await env.DB.prepare(
            `SELECT
                DATE(created_at/1000, 'unixepoch') AS day,
                COUNT(*) AS samples,
                AVG(CASE
                    WHEN direction='buy'  THEN (price_24h-price)/price*100
                    WHEN direction='sell' THEN (price-price_24h)/price*100
                END) AS avg_return,
                AVG(CASE
                    WHEN direction='buy'  AND price_24h > price THEN 1.0
                    WHEN direction='sell' AND price_24h < price THEN 1.0
                    ELSE 0.0
                END) * 100 AS winrate
             FROM signal_history
             WHERE created_at >= ? AND price_24h IS NOT NULL AND price > 0
             GROUP BY day ORDER BY day ASC`
        ).bind(since).all();

        return json({
            days,
            progress: progress || {},
            accuracy: accuracy.results || [],
            horizons: horizons || {},
            topAccurate: topAccurate.results || [],
            bottomAccurate: bottomAccurate.results || [],
            dailyReturns: dailyReturns.results || [],
        });
    } catch (e) {
        return err(500, e.message);
    }
}
