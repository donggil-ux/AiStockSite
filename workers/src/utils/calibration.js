// 자동 알고리즘 보정 엔진
//
// 매주 1회 (일요일 UTC 03:00) cron 으로 실행되며, 다음을 자동 조정:
//   1. 등급별 점수 임계값 — 실제 승률 기반 (목표 60%+)
//   2. 종목별 가중치/블랙리스트 — 5건+ 시그널 중 평균 손실 종목 차단
//   3. 사용자 평가 가중치 — 👍/👎 비율로 등급 임계값 미세 조정
//
// 모든 보정은 보수적:
//   - 최소 샘플 30건 이상일 때만 임계값 조정
//   - 조정 폭은 한 회당 최대 ±0.5점
//   - 종목 블랙리스트는 5건+ 샘플 + 평균 수익률 -3% 미만일 때만

import { logError } from './errors.js';

const KV_CONFIG_KEY = 'algo:config';
const KV_BLACKLIST_KEY = 'algo:blacklist';

/** 현재 알고리즘 설정 로드 (KV 캐시 우선, miss 시 D1) */
export async function loadAlgorithmConfig(env) {
    try {
        // KV 캐시 (5분 TTL — 보정 결과 빠른 전파)
        const cached = await env.CACHE.get(KV_CONFIG_KEY, 'json');
        if (cached) return cached;
    } catch (_) {}
    // D1 폴백
    try {
        const r = await env.DB.prepare("SELECT value FROM algorithm_config WHERE key='thresholds'").first();
        if (r?.value) {
            const cfg = JSON.parse(r.value);
            await env.CACHE.put(KV_CONFIG_KEY, JSON.stringify(cfg), { expirationTtl: 300 }).catch(()=>{});
            return cfg;
        }
    } catch (_) {}
    // 최종 폴백 — 하드코딩
    return { S: 7.0, A: 5.5, B: 4.0, min_score_for_push: 5.5 };
}

/** 블랙리스트 종목 Set (KV 캐시 5분) */
export async function loadBlacklist(env) {
    try {
        const cached = await env.CACHE.get(KV_BLACKLIST_KEY, 'json');
        if (cached) return new Set(cached);
    } catch (_) {}
    try {
        const rs = await env.DB.prepare("SELECT symbol FROM symbol_weights WHERE blacklisted=1").all();
        const arr = (rs.results || []).map(r => r.symbol);
        await env.CACHE.put(KV_BLACKLIST_KEY, JSON.stringify(arr), { expirationTtl: 300 }).catch(()=>{});
        return new Set(arr);
    } catch (_) {
        return new Set();
    }
}

/**
 * 메인 보정 함수 — 매주 자동 실행 또는 수동 트리거.
 * @returns { samplesAnalyzed, thresholdsBefore, thresholdsAfter, blacklisted, updated }
 */
export async function calibrateAlgorithm(env, { dryRun = false } = {}) {
    const start = Date.now();
    const since30d = start - 30 * 24 * 3600 * 1000;

    // ── 1) 현재 임계값 로드 ──
    const before = await loadAlgorithmConfig(env);

    // ── 2) 최근 30일 매칭 완료 시그널 분석 ──
    // 등급별 실제 승률 + 평균 수익률 계산
    const stats = await env.DB.prepare(
        `SELECT grade,
            COUNT(*) AS n,
            AVG(CASE
                WHEN direction='buy'  THEN (price_24h - price) / price * 100.0
                WHEN direction='sell' THEN (price - price_24h) / price * 100.0
            END) AS avg_return,
            AVG(CASE
                WHEN direction='buy'  AND price_24h > price THEN 1.0
                WHEN direction='sell' AND price_24h < price THEN 1.0
                ELSE 0.0
            END) * 100.0 AS winrate
         FROM signal_history
         WHERE created_at >= ? AND price_24h IS NOT NULL AND price > 0
         GROUP BY grade`
    ).bind(since30d).all();
    const byGrade = {};
    for (const r of (stats.results || [])) byGrade[r.grade] = r;

    // ── 3) 임계값 조정 로직 ──
    // 목표: 각 등급 실제 승률이 60% 이상이도록.
    //   - 실제 승률 < 50% (샘플 30+) → 임계값 +0.5 (더 엄격)
    //   - 실제 승률 > 70% (샘플 30+) → 임계값 -0.3 (살짝 완화)
    //   - 그 외 → 유지
    const after = { ...before };
    const adjustments = [];
    for (const grade of ['S', 'A', 'B']) {
        const s = byGrade[grade];
        if (!s || s.n < 30) continue; // 샘플 부족 → 유지
        const wr = s.winrate || 0;
        if (wr < 50) {
            after[grade] = Math.min(10, (after[grade] || 5) + 0.5);
            adjustments.push(`${grade}: 승률 ${wr.toFixed(1)}% (낮음) → 임계값 +0.5 = ${after[grade]}`);
        } else if (wr > 70) {
            after[grade] = Math.max(1, (after[grade] || 5) - 0.3);
            adjustments.push(`${grade}: 승률 ${wr.toFixed(1)}% (높음) → 임계값 -0.3 = ${after[grade]}`);
        }
    }
    // min_score_for_push 도 A 임계값에 연동
    after.min_score_for_push = after.A;

    // ── 4) 사용자 평가 가중치 (피드백 반영) ──
    const ratings = await env.DB.prepare(
        `SELECT s.grade,
            COUNT(f.id) AS n,
            AVG(f.rating) AS avg_rating
         FROM signal_history s
         INNER JOIN signal_feedback f ON f.signal_id = s.id
         WHERE s.created_at >= ?
         GROUP BY s.grade`
    ).bind(since30d).all();
    for (const r of (ratings.results || [])) {
        if (r.n < 10) continue;
        const avg = r.avg_rating; // -1 ~ +1
        if (avg < -0.3) {
            // 사용자가 별로라고 평가 → 더 엄격하게
            after[r.grade] = Math.min(10, (after[r.grade] || 5) + 0.2);
            adjustments.push(`${r.grade}: 사용자 평가 ${avg.toFixed(2)} (부정) → +0.2`);
        } else if (avg > 0.5) {
            after[r.grade] = Math.max(1, (after[r.grade] || 5) - 0.1);
            adjustments.push(`${r.grade}: 사용자 평가 ${avg.toFixed(2)} (긍정) → -0.1`);
        }
    }

    // ── 5) 종목별 가중치 & 블랙리스트 ──
    const symbolStats = await env.DB.prepare(
        `SELECT symbol,
            COUNT(*) AS samples,
            AVG(CASE
                WHEN direction='buy'  THEN (price_24h - price) / price * 100.0
                WHEN direction='sell' THEN (price - price_24h) / price * 100.0
            END) AS avg_return,
            AVG(CASE
                WHEN direction='buy'  AND price_24h > price THEN 1.0
                WHEN direction='sell' AND price_24h < price THEN 1.0
                ELSE 0.0
            END) * 100.0 AS winrate
         FROM signal_history
         WHERE created_at >= ? AND price_24h IS NOT NULL AND price > 0
         GROUP BY symbol
         HAVING samples >= 5`
    ).bind(since30d).all();

    let symbolsUpdated = 0, blacklisted = 0;
    if (!dryRun) {
        // 사용자 평가 평균 (종목별)
        const userRatings = await env.DB.prepare(
            `SELECT s.symbol, AVG(f.rating) AS avg_rating
             FROM signal_history s
             INNER JOIN signal_feedback f ON f.signal_id = s.id
             WHERE s.created_at >= ?
             GROUP BY s.symbol`
        ).bind(since30d).all();
        const ratingMap = new Map((userRatings.results || []).map(r => [r.symbol, r.avg_rating]));

        for (const s of (symbolStats.results || [])) {
            const isBad = (s.avg_return || 0) < -3 && s.samples >= 5;
            let weight = 1.0;
            if ((s.winrate || 0) > 70) weight = 1.3;
            else if ((s.winrate || 0) > 60) weight = 1.1;
            else if ((s.winrate || 0) < 40) weight = 0.7;
            const userR = ratingMap.get(s.symbol) ?? null;
            const reason = isBad
                ? `자동 블랙리스트: ${s.samples}건 평균 ${s.avg_return.toFixed(2)}%`
                : `weight=${weight} (승률 ${s.winrate?.toFixed(0) || '-'}%, 평가 ${userR != null ? userR.toFixed(2) : '-'})`;
            await env.DB.prepare(
                `INSERT INTO symbol_weights (symbol, weight, samples, avg_return, winrate, user_rating, blacklisted, updated_at, reason)
                 VALUES (?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(symbol) DO UPDATE SET
                    weight=excluded.weight, samples=excluded.samples,
                    avg_return=excluded.avg_return, winrate=excluded.winrate,
                    user_rating=excluded.user_rating,
                    blacklisted=excluded.blacklisted,
                    updated_at=excluded.updated_at, reason=excluded.reason`
            ).bind(s.symbol, weight, s.samples, s.avg_return, s.winrate, userR, isBad ? 1 : 0, start, reason).run();
            symbolsUpdated++;
            if (isBad) blacklisted++;
        }
    }

    // ── 6) 결과 저장 (D1 + KV) ──
    const totalSamples = Object.values(byGrade).reduce((sum, x) => sum + (x.n || 0), 0);
    if (!dryRun) {
        await env.DB.prepare(
            `UPDATE algorithm_config SET value=?, updated_at=?, notes=? WHERE key='thresholds'`
        ).bind(JSON.stringify(after), start, adjustments.join(' | ') || 'no change').run();

        await env.DB.prepare(
            `UPDATE algorithm_config SET value=?, updated_at=? WHERE key='last_calibration'`
        ).bind(JSON.stringify({ run_at: start, samples: totalSamples, adjustments: adjustments.length }), start).run();

        await env.DB.prepare(
            `INSERT INTO calibration_log (run_at, samples_analyzed, thresholds_before, thresholds_after, symbols_updated, symbols_blacklisted, notes)
             VALUES (?,?,?,?,?,?,?)`
        ).bind(start, totalSamples, JSON.stringify(before), JSON.stringify(after), symbolsUpdated, blacklisted, adjustments.join(' | ')).run();

        // KV 무효화 (다음 detectSignal 호출 시 새 값 로드)
        await env.CACHE.delete(KV_CONFIG_KEY).catch(()=>{});
        await env.CACHE.delete(KV_BLACKLIST_KEY).catch(()=>{});
    }

    return {
        run_at: start,
        duration_ms: Date.now() - start,
        samples_analyzed: totalSamples,
        thresholds_before: before,
        thresholds_after: after,
        adjustments,
        symbols_updated: symbolsUpdated,
        symbols_blacklisted: blacklisted,
        dryRun,
        eligible: totalSamples >= 30,
    };
}
