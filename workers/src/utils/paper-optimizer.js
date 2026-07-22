// 가상 매매 성과 분석 → 트레이딩 파라미터 자동 최적화
// 매주 일요일 cron 호출 → algorithm_config 저장
// captureDailySignals에서 로드해 진입 기준으로 사용

import { _tgDirect } from './paper-engine.js';

const PARAM_KEY   = 'paper_trade_params';
const MIN_SAMPLES = 10; // 통계 유효 최소 건수
const HEALTH_CHECK_KEY      = 'paper_health_last_check'; // KV — 마지막 진단 실행 시각
const HEALTH_CHECK_INTERVAL = 60 * 60 * 1000;            // 1시간에 한 번만 진단 (5분 크론에 얹혀서 호출되므로 자체 게이트 필요)
const WATCHDOG_ALERT_KEY      = 'cron_watchdog_last_alert'; // KV — 워치독 알림 중복 방지
const WATCHDOG_ALERT_COOLDOWN = 2 * 60 * 60 * 1000;         // 같은 문제로 2시간 내 재알림 안 함
// index.js runFiveMinJob()이 매 틱 시작 시 쓰는 KV 락 키(형식 반드시 동일하게 유지) —
// dt_signals가 조용해도 이게 최근이면 "크론은 살아있는데 신규 시그널이 없었을 뿐"으로 판단
const FIVE_MIN_HEARTBEAT_KEY      = '5min-lock:US';
const FIVE_MIN_HEARTBEAT_FRESH_MS = 10 * 60 * 1000; // 10분 이내면 살아있다고 봄

export const DEFAULT_PARAMS = {
    min_rvol:            1.0,      // 최소 RVOL (사용자 요청으로 완화 — 거래량 다소 부족해도 진입 허용)
    max_positions:       6,        // 단타 3 + 스윙 3 = 총 6
    max_day_positions:   3,        // 단타 시드 50% ($25K×3 → 최대 $50K)
    max_swing_positions: 3,        // 스윙 시드 50% ($25K×3 → 최대 $50K)
    daily_loss_limit:    10000,    // 일일 최대 손실 한도 ($)
    grade_filter:        ['S','A'],// 허용 등급 (B 이하 제외)
    sell_grade_filter:   ['S','A'],// 숏(매도) 전용 등급 필터 — 기본은 롱과 동일 S/A, 성과 부진 시 자동으로 S만으로 강화
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

    // ── 방향(dir) × 등급별 성과 — 숏(매도) 품질 필터 조정용 ─────────────
    const dirRes = await env.DB.prepare(`
        SELECT dir, grade, COUNT(*) AS total,
            SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) AS wins,
            ROUND(AVG(realized_pnl),2) AS avg_pnl
        FROM paper_trades WHERE status='closed' AND created_at>?
        GROUP BY dir, grade ORDER BY total DESC
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
        dirRows:   dirRes.results   || [],
    });

    await env.DB.prepare(
        "INSERT OR REPLACE INTO algorithm_config (key,value,updated_at) VALUES (?,?,?)"
    ).bind(PARAM_KEY, JSON.stringify(params), Date.now()).run();

    console.log('[paper-optimize] params:', JSON.stringify(params));

    return {
        summary, recent,
        catStats:   catRes.results,
        gradeStats: gradeRes.results,
        dirStats:   dirRes.results,
        exitStats:  exitRes.results,
        params,
    };
}

function _deriveParams({ summary, recent, catRows, gradeRows, exitRows, dirRows }) {
    const p = { ...DEFAULT_PARAMS, skip_categories: [] };

    const total = summary?.total || 0;
    if (total < MIN_SAMPLES) {
        console.log('[paper-optimize] 데이터 부족, 기본값 유지:', total, '건');
        return p;
    }

    const winRate = summary.wins / total;
    console.log('[paper-optimize] 30일 승률:', (winRate*100).toFixed(1)+'%', '총손익:', summary.total_pnl);

    // ── RVOL 기준 동적 조정 (기본값 1.0으로 완화됨에 맞춰 전체 밴드 하향 재조정) ──
    if      (winRate < 0.35) p.min_rvol = 2.5;  // 35% 미만: 매우 강한 신호만
    else if (winRate < 0.45) p.min_rvol = 2.0;  // 45% 미만: 기준 상향
    else if (winRate < 0.55) p.min_rvol = 1.5;  // 정상 범위
    else if (winRate > 0.65) p.min_rvol = 1.0;  // 잘 되고 있으면 기본값까지 완화
    else                     p.min_rvol = 1.5;

    // 최근 7일이 특히 나쁘면 즉시 기준 강화
    if (recent?.total >= 5) {
        const recentWr = recent.wins / recent.total;
        if (recentWr < 0.35) {
            p.min_rvol         = Math.max(p.min_rvol, 2.5);
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
            p.min_rvol         = Math.max(p.min_rvol, 2.0);
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

    // ── 숏(매도) 전용 등급 필터 — 기본은 롱과 동일하게 S/A 허용,
    //    실제 체결 데이터가 쌓였는데 A등급 숏 성과가 뚜렷이 나쁘면 자동으로 S만으로 강화
    const shortRows  = (dirRows || []).filter(r => r.dir === 'short');
    const shortTotal = shortRows.reduce((s, r) => s + r.total, 0);
    p.sell_grade_filter = ['S', 'A'];
    if (shortTotal >= MIN_SAMPLES) {
        const shortWins = shortRows.reduce((s, r) => s + r.wins, 0);
        const shortWr    = shortWins / shortTotal;
        const shortAGrade = shortRows.find(r => r.grade === 'A');
        if (shortAGrade && shortAGrade.total >= MIN_SAMPLES && (shortAGrade.avg_pnl < 0 || shortWr < 0.35)) {
            p.sell_grade_filter = ['S'];
            console.log('[paper-optimize] 숏 A등급 성과 부진(승률', (shortWr*100).toFixed(0)+'%) — S등급만 허용으로 강화');
        } else {
            console.log('[paper-optimize] 숏 승률', (shortWr*100).toFixed(0)+'% — S/A 허용 유지');
        }
    }

    p.updated_at = Date.now();
    return p;
}

/**
 * 가상매매가 멈춘 이유를 자동 진단 (5분 크론에 얹혀 호출되지만 1시간에 한 번만 실제 실행 — KV 게이트)
 *
 * 최근 2시간 기준:
 *  - 매매가 있었다면 정상 → 아무것도 안 함
 *  - 매매 0건 + 최근 오류(captureDailySignals 등) 있음 → 코드/API 문제로 보고 알림만 (자동 수정 안 함 — 안전하지 않음)
 *  - 매매 0건 + S/A 등급 신호도 0~2건 → 그냥 조용한 장, 알림 없음
 *  - 매매 0건 + S/A 등급 신호는 3건 이상인데 매매가 안 됨 → 필터가 신호를 막고 있다고 보고
 *    RVOL/등급 필터를 기본값 쪽으로 완화 + 텔레그램 알림
 */
export async function paperHealthCheck(env) {
    try {
        const now = Date.now();
        if (env.CACHE) {
            const last = await env.CACHE.get(HEALTH_CHECK_KEY);
            if (last && now - Number(last) < HEALTH_CHECK_INTERVAL) return { skipped: true };
            await env.CACHE.put(HEALTH_CHECK_KEY, String(now));
        }

        const since = now - 2 * 60 * 60 * 1000; // 최근 2시간

        const [tradeCount, sigRows, errRows] = await Promise.all([
            env.DB.prepare("SELECT COUNT(*) c FROM paper_trades WHERE created_at>?").bind(since).first(),
            env.DB.prepare("SELECT grade, COUNT(*) c FROM dt_signals WHERE created_at>? AND grade IN ('S','A') GROUP BY grade").bind(since).all(),
            env.DB.prepare(
                "SELECT source, message, COUNT(*) c FROM errors WHERE created_at>? AND source IN ('captureDailySignals','resolveDailySignals','paper-manage') GROUP BY source, message ORDER BY c DESC LIMIT 5"
            ).bind(since).all(),
        ]);

        if ((tradeCount?.c || 0) > 0) return { ok: true, reason: 'trading_normally' };

        const errors = errRows.results || [];
        if (errors.length) {
            const summary = errors.map(e => `${e.source}: ${e.message.slice(0, 100)} (${e.c}회)`).join('\n');
            await _tgDirect(env,
                `⚠️ <b>가상매매 진단: 오류 감지</b>\n최근 2시간 매매 0건 + 아래 오류 발생\n${summary}\n→ 코드 문제로 보여 자동 조정하지 않았습니다. 확인이 필요합니다.`
            );
            return { problem: 'error', errors };
        }

        const sigTotal = (sigRows.results || []).reduce((s, r) => s + r.c, 0);
        if (sigTotal < 3) return { ok: true, reason: 'quiet_market' }; // 조용한 장 — 알림 없음

        // 신호는 있는데 매매가 안 됨 — 필터를 기본값 쪽으로 완화
        const params  = await getPaperTradeParams(env);
        const relaxed = { ...params };
        const changed = [];

        if (relaxed.min_rvol > DEFAULT_PARAMS.min_rvol) {
            const next = Math.max(DEFAULT_PARAMS.min_rvol, +(relaxed.min_rvol - 0.3).toFixed(2));
            changed.push(`RVOL 기준 ${relaxed.min_rvol} → ${next}`);
            relaxed.min_rvol = next;
        }
        if (relaxed.grade_filter.length < DEFAULT_PARAMS.grade_filter.length) {
            changed.push(`등급 필터 [${relaxed.grade_filter.join('/')}] → [${DEFAULT_PARAMS.grade_filter.join('/')}]`);
            relaxed.grade_filter = [...DEFAULT_PARAMS.grade_filter];
        }
        if ((relaxed.sell_grade_filter || []).length < DEFAULT_PARAMS.sell_grade_filter.length) {
            changed.push(`숏 등급 필터 [${(relaxed.sell_grade_filter||[]).join('/')}] → [${DEFAULT_PARAMS.sell_grade_filter.join('/')}]`);
            relaxed.sell_grade_filter = [...DEFAULT_PARAMS.sell_grade_filter];
        }

        if (!changed.length) {
            await _tgDirect(env,
                `ℹ️ <b>가상매매 진단</b>\n최근 2시간 S/A등급 신호 ${sigTotal}건 있었지만 매매 0건 — 기준이 이미 기본값이라 자동 조정할 게 없습니다. 레짐 게이트·유동성 등 다른 조건 때문일 수 있습니다.`
            );
            return { problem: 'blocked', autoFixed: false, sigTotal };
        }

        relaxed.updated_at = now;
        await env.DB.prepare(
            "INSERT OR REPLACE INTO algorithm_config (key,value,updated_at) VALUES (?,?,?)"
        ).bind(PARAM_KEY, JSON.stringify(relaxed), now).run();

        await _tgDirect(env,
            `🔧 <b>가상매매 진단: 필터 자동 완화</b>\n최근 2시간 S/A등급 신호 ${sigTotal}건인데 매매 0건 → 기준을 기본값 쪽으로 완화했습니다\n${changed.join('\n')}`
        );
        return { problem: 'blocked', autoFixed: true, changed, sigTotal };
    } catch (e) {
        console.error('[paper-health]', e.message);
        return { error: e.message };
    }
}

/**
 * 5분 크론(8-21시, 5분마다) 워치독 — 별도로 살아있는 매시 :30 크론에서 호출.
 * Cloudflare 쪽에서 그 크론 자체가 통째로 발화를 멈추면 paperHealthCheck도 같이 죽으므로,
 * 완전히 다른 트리거에서 감시한다. 1차로 "최근 신호 캡처(dt_signals)가 있었는지"를 보되,
 * 조용해도 크론 자체가 진짜 살아있으면(하트비트 최근) 오탐으로 보고 알림을 보내지 않는다 —
 * 신규 S/A급 시그널이 없는 조용한 장(예: 오후 횡보)에서도 dt_signals는 며칠씩 조용할 수 있어서
 * dt_signals 하나만 보면 "크론 죽음"과 "그냥 조용함"을 구분 못 함.
 */
export async function cronWatchdog(env) {
    try {
        const now = new Date();
        const h = now.getUTCHours();
        const day = now.getUTCDay();
        if (day === 0 || day === 6) return { skipped: 'weekend' };
        if (h < 8 || h > 21) return { skipped: 'off_hours' }; // 5분 크론이 도는 시간대(UTC 8~21)만 검사

        const since = Date.now() - 65 * 60 * 1000; // 최근 65분 (워치독 실행 간격 60분 + 여유 5분)
        const row = await env.DB.prepare("SELECT COUNT(*) c FROM dt_signals WHERE created_at>?").bind(since).first();
        if ((row?.c || 0) > 0) return { ok: true };

        if (env.CACHE) {
            const heartbeat = await env.CACHE.get(FIVE_MIN_HEARTBEAT_KEY);
            if (heartbeat && Date.now() - Number(heartbeat) < FIVE_MIN_HEARTBEAT_FRESH_MS) {
                return { ok: true, quiet_signals: true }; // 크론은 최근에도 돌았음 — 그냥 조용한 구간
            }
        }

        if (env.CACHE) {
            const last = await env.CACHE.get(WATCHDOG_ALERT_KEY);
            if (last && Date.now() - Number(last) < WATCHDOG_ALERT_COOLDOWN) return { alerted_recently: true };
            await env.CACHE.put(WATCHDOG_ALERT_KEY, String(Date.now()));
        }

        await _tgDirect(env,
            `🚨 <b>5분 크론 정지 감지</b>\n최근 65분간 신호 캡처(dt_signals) 0건 — */5 8-21 크론이 죽었을 가능성이 큽니다.\nCloudflare 대시보드 확인 또는 wrangler.toml 크론 재등록(제거 후 재배포 → 재추가 후 재배포)이 필요합니다.`
        );
        return { alerted: true };
    } catch (e) {
        console.error('[cron-watchdog]', e.message);
        return { error: e.message };
    }
}
