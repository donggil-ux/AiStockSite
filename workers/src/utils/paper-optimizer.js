// 가상 매매 성과 분석 → 트레이딩 파라미터 자동 최적화
// 매주 일요일 cron 호출 → algorithm_config 저장
// captureDailySignals에서 로드해 진입 기준으로 사용

const PARAM_KEY   = 'paper_trade_params';
const MIN_SAMPLES = 10; // 통계 유효 최소 건수

export const DEFAULT_PARAMS = {
    min_rvol:            1.5,      // 최소 RVOL (점심 거래량 감소 고려)
    max_positions:       6,        // 단타 3 + 스윙 3 = 총 6
    max_day_positions:   3,        // 단타 시드 50% ($25K×3 → 최대 $50K)
    max_swing_positions: 3,        // 스윙 시드 50% ($25K×3 → 최대 $50K)
    daily_loss_limit:    10000,    // 일일 최대 손실 한도 ($)
    grade_filter:        ['S','A'],// 허용 등급 (B 이하 제외)
    skip_categories:     [],       // 성과 부진 카테고리 진입 금지
    updated_at:          0,
};

/** algorithm_config에서 파라미터 로드 — 없으면 DEFAULT_PARAMS 반환 */
export async function getPaperTradeParams(env) {
    try {
        const row = await env.DB.prepare(
            "SELECT value FROM algorithm_config WHERE key=?"
        ).bind(PARAM_KEY).first();
        if (!row) return DEFAULT_PARAMS;
        return { ...DEFAULT_PARAMS, ...JSON.parse(row.value) };
    } catch (_) { return DEFAULT_PARAMS; }
}

/** 30일 paper_trades 분석 → 파라미터 자동 조정 → algorithm_config 저장 */
export async function paperAutoOptimize(env) {
    const since30d = Date.now() - 30 * 24 * 3600 * 1000;
    const since7d  = Date.now() -  7 * 24 * 3600 * 1000;

    // ── 전체 30일 요약 ────────────────────────────────────────────────
    const summary = await env.DB.prepare(`
        SELECT
            COUNT(*)                                             AS total,
            SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END)    AS wins,
            ROUND(AVG(realized_pnl),2)                          AS avg_pnl,
            ROUND(SUM(realized_pnl),2)                          AS total_pnl,
            ROUND(AVG(CASE WHEN realized_pnl>0 THEN realized_pnl END),2) AS avg_win,
            ROUND(AVG(CASE WHEN realized_pnl<0 THEN realized_pnl END),2) AS avg_loss
        FROM paper_trades WHERE status='closed' AND created_at>?
    `).bind(since30d).first();

    // ── 최근 7일 요약 ────────────────────────────────────────────────
    const recent = await env.DB.prepare(`
        SELECT COUNT(*) AS total,
            SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) AS wins,
            ROUND(SUM(realized_pnl),2) AS total_pnl
        FROM paper_trades WHERE status='closed' AND created_at>?
    `).bind(since7d).first();

    // ── 카테고리 × 스타일별 성과 ─────────────────────────────────────
    const catRes = await env.DB.prepare(`
        SELECT category, style,
            COUNT(*)                                          AS total,
            SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) AS wins,
            ROUND(AVG(realized_pnl),2)                       AS avg_pnl,
            ROUND(SUM(realized_pnl),2)                       AS total_pnl
        FROM paper_trades WHERE status='closed' AND created_at>?
        GROUP BY category, style ORDER BY total_pnl DESC
    `).bind(since30d).all();

    // ── 등급별 성과 ──────────────────────────────────────────────────
    const gradeRes = await env.DB.prepare(`
        SELECT grade, COUNT(*) AS total,
            SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) AS wins,
            ROUND(AVG(realized_pnl),2) AS avg_pnl
        FROM paper_trades WHERE status='closed' AND created_at>?
        GROUP BY grade ORDER BY avg_pnl DESC
    `).bind(since30d).all();

    // ── 청산 유형별 (손절/익절/trail/timeout 비율) ────────────────────
    const exitRes = await env.DB.prepare(`
        SELECT close_reason,
            COUNT(*) AS total,
            ROUND(AVG(realized_pnl),2) AS avg_pnl,
            ROUND(SUM(realized_pnl),2) AS total_pnl
        FROM paper_trades WHERE status='closed' AND created_at>?
        GROUP BY close_reason ORDER BY total DESC
    `).bind(since30d).all();

    // ── 파라미터 도출 ─────────────────────────────────────────────────
    const params = _deriveParams({
        summary, recent,
        catRows:   catRes.results   || [],
        gradeRows: gradeRes.results || [],
        exitRows:  exitRes.results  || [],
    });

    await env.DB.prepare(
        "INSERT OR REPLACE INTO algorithm_config (key,value,updated_at) VALUES (?,?,?)"
    ).bind(PARAM_KEY, JSON.stringify(params), Date.now()).run();

    console.log('[paper-optimize] params:', JSON.stringify(params));

    return {
        summary, recent,
        catStats:   catRes.results,
        gradeStats: gradeRes.results,
        exitStats:  exitRes.results,
        params,
    };
}

function _deriveParams({ summary, recent, catRows, gradeRows, exitRows }) {
    const p = { ...DEFAULT_PARAMS, skip_categories: [] };

    const total = summary?.total || 0;
    if (total < MIN_SAMPLES) {
        console.log('[paper-optimize] 데이터 부족, 기본값 유지:', total, '건');
        return p;
    }

    const winRate = summary.wins / total;
    console.log('[paper-optimize] 30일 승률:', (winRate*100).toFixed(1)+'%', '총손익:', summary.total_pnl);

    // ── RVOL 기준 동적 조정 ────────────────────────────────────────
    if      (winRate < 0.35) p.min_rvol = 3.0;  // 35% 미만: 매우 강한 신호만
    else if (winRate < 0.45) p.min_rvol = 2.5;  // 45% 미만: 기준 상향
    else if (winRate < 0.55) p.min_rvol = 2.0;  // 정상 범위
    else if (winRate > 0.65) p.min_rvol = 1.8;  // 잘 되고 있으면 약간 완화
    else                     p.min_rvol = 2.0;

    // 최근 7일이 특히 나쁘면 즉시 기준 강화
    if (recent?.total >= 5) {
        const recentWr = recent.wins / recent.total;
        if (recentWr < 0.35) {
            p.min_rvol         = Math.max(p.min_rvol, 3.0);
            p.daily_loss_limit = 1500;
            console.log('[paper-optimize] 최근 7일 부진 — 기준 강화:', p.min_rvol);
        }
    }

    // ── 손절 과다 → 진입 질 강화 ──────────────────────────────────
    const stopRow   = exitRows.find(r => r.close_reason === 'stop');
    const totalExit = exitRows.reduce((s, r) => s + r.total, 0);
    if (stopRow && totalExit >= MIN_SAMPLES) {
        const stopRatio = stopRow.total / totalExit;
        if (stopRatio > 0.55) {
            p.min_rvol         = Math.max(p.min_rvol, 2.5);
            p.daily_loss_limit = Math.min(p.daily_loss_limit, 1500);
            p.grade_filter     = ['S'];  // A 등급도 잠시 제외
            console.log('[paper-optimize] 손절 비율', (stopRatio*100).toFixed(0)+'% — S 등급만 허용');
        }
    }

    // ── 카테고리 스킵 / 부스트 ─────────────────────────────────────
    for (const row of catRows) {
        if (row.total < MIN_SAMPLES) continue;
        const wr  = row.wins / row.total;
        const key = `${row.category}_${row.style}`;
        if (wr < 0.35 && row.avg_pnl < -30) {
            p.skip_categories.push(key);
            console.log('[paper-optimize] 스킵:', key, `WR=${(wr*100).toFixed(0)}% avgP&L=${row.avg_pnl}`);
        }
    }

    // ── 등급 B가 계속 손실이면 grade_filter 확인 ─────────────────
    const gradeB = gradeRows.find(r => r.grade === 'B');
    if (gradeB && gradeB.total >= MIN_SAMPLES && gradeB.avg_pnl < -20) {
        p.grade_filter = ['S', 'A']; // 이미 기본값이지만 명시
    }

    p.updated_at = Date.now();
    return p;
}
