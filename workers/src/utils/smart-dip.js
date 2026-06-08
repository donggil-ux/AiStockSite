// Smart Dip v3 — 서버 포트 (클라이언트 chart-sync.js `_smartDipV3Filter` 와 동일 방법론)
// 데일리 트레이딩 스캐너의 분석 엔진. 컨플루언스(다중 필터) 품질 점수 기반.
//   buy  = 상승추세 눌림목 진입 (Smart Dip)
//   sell = 하락추세 반등 소진 진입 (Smart Rip — buy 로직의 대칭 반전)
//
// 각 타점에 ATR 기반 손절선 + 2R/3R 목표가(R멀티플) 동봉.
// smartDipBacktest()로 과거 데이터에서 실측 승률·평균 R 산출 가능.
import { calcEMA, calcRSI, calcATR, calcADXSeries } from './indicators.js';

const STOP_ATR_MULT = 1.2;   // 손절 = 진입 ± 1.2 ATR
const TARGET1_R = 2;         // 1차 목표 2R
const TARGET2_R = 3;         // 2차 목표 3R

// 진입가·ATR 기준 손절/목표가 (R멀티플)
function tradeLevels(dir, entry, atr) {
    const dist = STOP_ATR_MULT * atr;
    if (!(dist > 0) || !(entry > 0)) return null;
    const sgn = dir === 'buy' ? 1 : -1;
    return {
        stop:    +(entry - sgn * dist).toFixed(4),
        be:      +(entry + sgn * dist).toFixed(4),        // +1R — 도달 시 손절을 본전으로 이동(트레일 시작)
        target1: +(entry + sgn * dist * TARGET1_R).toFixed(4),
        target2: +(entry + sgn * dist * TARGET2_R).toFixed(4),
        riskPct: +((dist / entry) * 100).toFixed(2),
        stopDist: dist,
    };
}

// 지표 1회 계산 (인덱스 정렬 배열)
function indicators(q) {
    const { close = [], high = [], low = [] } = q;
    return {
        ema60:  calcEMA(close, 60),
        ema120: calcEMA(close, 120),
        rsi:    calcRSI(close, 14),
        atrArr: calcATR(high, low, close, 14),
        adxArr: calcADXSeries(high, low, close, 14),
    };
}

// 단일 봉 i 에서 dir 방향 필터 평가 (vwapArr 제공 시 VWAP 게이트 추가)
function evalBar(q, ind, i, dir, htfLag, spxTrendUp, ts, vwapArr) {
    const { close, high, low, open, volume } = q;
    const c = close[i];
    if (c == null || ind.ema60[i] == null || ind.ema120[i] == null || ind.atrArr[i] == null) {
        return { pass: false, qs: 0 };
    }
    let qs = 0;
    const reasons = [];

    // 필터 1: ADX 추세강도 (봉별 실제 ADX)
    const adx = ind.adxArr[i];
    if (adx == null || adx < 20) return { pass: false, qs };
    qs += adx >= 35 ? 2 : 1;
    reasons.push(`ADX ${adx.toFixed(0)}`);

    // 필터 2: HTF 추세 정렬
    const e60prev  = ind.ema60[Math.max(0, i - htfLag * 5)];
    const e120prev = ind.ema120[Math.max(0, i - htfLag * 10)];
    const htfUp = e60prev != null && e120prev != null && ind.ema60[i] > e60prev && ind.ema120[i] > e120prev;
    const htfDn = e60prev != null && e120prev != null && ind.ema60[i] < e60prev && ind.ema120[i] < e120prev;
    if (dir === 'buy'  && !htfUp) return { pass: false, qs };
    if (dir === 'sell' && !htfDn) return { pass: false, qs };
    qs += 2;
    reasons.push(dir === 'buy' ? '상위추세 상승' : '상위추세 하락');

    // 필터 3: 거래량 확인 (Wyckoff)
    const volSlice = volume.slice(Math.max(0, i - 20), i).filter(v => v != null && v > 0);
    const volAvg20 = volSlice.length ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length : 0;
    const volRatio = volAvg20 > 0 ? (volume[i] || 0) / volAvg20 : 1;
    const volPrevR = volAvg20 > 0 ? (volume[i - 1] || 0) / volAvg20 : 1;
    const volRecovery = volPrevR < 1.0 && volRatio > 1.2;
    if (volRatio < 0.8) return { pass: false, qs };
    if (volRecovery)          { qs += 2; reasons.push(`거래량 회복 ${volRatio.toFixed(1)}x`); }
    else if (volRatio >= 1.2) { qs += 1; reasons.push(`거래량 ${volRatio.toFixed(1)}x`); }

    // 필터 4: 직전 봉 과열 방지 + 현재 봉 방향
    if (i > 0 && open[i - 1] != null && open[i - 1] > 0) {
        const prevMove = ((close[i - 1] - open[i - 1]) / open[i - 1]) * 100;
        if (dir === 'buy'  && prevMove < -3) return { pass: false, qs };
        if (dir === 'sell' && prevMove >  3) return { pass: false, qs };
    }
    if (open[i] != null) {
        const bull = close[i] > open[i];
        if (dir === 'buy')  { if (bull) { qs += 1; reasons.push('양봉 반등'); } else return { pass: false, qs }; }
        else                { if (!bull){ qs += 1; reasons.push('음봉 하락'); } else return { pass: false, qs }; }
    }

    // 필터 5: ATR 변동성
    const atrPct = c > 0 ? ((ind.atrArr[i] || 0) / c) * 100 : 0;
    if (atrPct > 5.0) return { pass: false, qs };
    if (atrPct >= 1.0 && atrPct <= 3.0) { qs += 1; reasons.push(`ATR ${atrPct.toFixed(1)}%`); }

    // 필터 6: S&P 500 환경
    if (spxTrendUp === true)  { if (dir === 'buy')  { qs += 1; reasons.push('SPX 상승'); } else qs -= 1; }
    if (spxTrendUp === false) { if (dir === 'sell') { qs += 1; reasons.push('SPX 하락'); } else qs -= 1; }

    // 필터 7: RSI 위치
    const rsiVal = ind.rsi[i] != null ? ind.rsi[i] : 50;
    if (dir === 'buy'  && rsiVal > 75) return { pass: false, qs };
    if (dir === 'sell' && rsiVal < 25) return { pass: false, qs };
    if (dir === 'buy'  && rsiVal >= 40 && rsiVal <= 65) { qs += 1; reasons.push(`RSI ${rsiVal.toFixed(0)}`); }
    if (dir === 'sell' && rsiVal >= 35 && rsiVal <= 60) { qs += 1; reasons.push(`RSI ${rsiVal.toFixed(0)}`); }

    // 필터 8: 장 시작 30분 노이즈 (미국 13:30~14:00 UTC)
    if (ts && ts[i]) {
        const d = new Date(ts[i] * 1000);
        const h = d.getUTCHours(), m = d.getUTCMinutes();
        if ((h === 13 && m >= 30) || (h === 14 && m === 0)) qs -= 1;
    }

    // 필터 9: VWAP 가격구조 게이트 (제공 시) — 기관 기준선 정렬
    //   매수는 VWAP 위, 매도는 VWAP 아래에서만 진입 (역방향 컷).
    if (vwapArr && vwapArr[i] != null) {
        const v = vwapArr[i];
        if (dir === 'buy'  && c < v) return { pass: false, qs };
        if (dir === 'sell' && c > v) return { pass: false, qs };
        qs += 1; reasons.push('VWAP 정렬');
    }

    return {
        pass: qs >= 5, qs, reasons,
        adx: +adx.toFixed(0), volRatio: +volRatio.toFixed(1), atrPct: +atrPct.toFixed(1),
        rsiVal: Math.round(rsiVal), price: c,
    };
}

function gradeOf(qs) { return qs >= 8 ? 'S' : qs >= 6 ? 'A' : 'B'; } // pass=qs≥5 → 최소 B
const _htfLag = (interval) => interval === '15m' ? 4 : interval === '30m' ? 2 : 6;

// 최근 봉을 스캔해 가장 최근 통과 셋업 반환 (실시간 스캐너용)
export function smartDipScan(q, { interval = '5m', ts = [], spxTrendUp = null, lookback, measuredWin = null } = {}) {
    const { close = [] } = q;
    const N = close.length;
    if (N < 60) return null;
    const ind = indicators(q);
    const htfLag = _htfLag(interval);
    const LB = lookback || (interval === '15m' ? 2 : 3);

    for (let i = N - 1; i >= Math.max(60, N - LB); i--) {
        const buy  = evalBar(q, ind, i, 'buy',  htfLag, spxTrendUp, ts);
        const sell = evalBar(q, ind, i, 'sell', htfLag, spxTrendUp, ts);
        let best = null, dir = null;
        if (buy.pass && (!sell.pass || buy.qs >= sell.qs)) { best = buy; dir = 'buy'; }
        else if (sell.pass) { best = sell; dir = 'sell'; }
        if (!best) continue;

        const grade = gradeOf(best.qs);
        const lv = tradeLevels(dir, best.price, ind.atrArr[i]);
        // 폴백 승률 = 1개월 트레일링 백테스트 실측치 (S 55% / A 49% / B 48%, 기대값 +0.16~+0.24R)
        const fallback = grade === 'S' ? 55 : grade === 'A' ? 49 : 48;
        const winRate = (measuredWin && measuredWin[grade] != null) ? measuredWin[grade] : fallback;
        return {
            dir, grade,
            qualityScore: +best.qs.toFixed(1),
            winRate,
            winMeasured: !!(measuredWin && measuredWin[grade] != null),
            adx: best.adx, volRatio: best.volRatio, atrPct: best.atrPct, rsiVal: best.rsiVal,
            reasons: best.reasons.slice(0, 4),
            price: best.price,
            stop: lv?.stop ?? null, be: lv?.be ?? null, target1: lv?.target1 ?? null, target2: lv?.target2 ?? null, riskPct: lv?.riskPct ?? null,
            barsAgo: N - 1 - i,
        };
    }
    return null;
}

// ── 역추세 반등 매수 (낙폭과대) ────────────────────────────────
// 추세추종이 아닌 평균회귀: 하락 중 과매도 + 반등 양봉(눌림 바닥)을 매수.
// 추세 매수가 안 나오는 하락장에서 단기 반등 타점을 잡기 위함.
function evalBounce(q, ind, i, ts) {
    const { close, high, low, open, volume } = q;
    const c = close[i];
    if (c == null || ind.rsi[i] == null || ind.atrArr[i] == null || ind.ema60[i] == null) return { pass: false, qs: 0 };
    let qs = 0;
    const reasons = [];

    // 1) 낙폭과대 맥락 — 가격이 EMA60 아래 (추세 대비 눌림)
    if (c >= ind.ema60[i]) return { pass: false, qs };

    // 2) RSI 과매도 (핵심 트리거) — 5분봉은 반등 시 RSI 빠르게 회복하므로 42 이하 허용
    const rsiVal = ind.rsi[i];
    if (rsiVal >= 42) return { pass: false, qs };
    qs += rsiVal < 30 ? 2 : rsiVal < 38 ? 1 : 0.5;
    reasons.push(`RSI ${rsiVal.toFixed(0)} 과매도`);

    // 3) 최근 10봉 누적 낙폭 (충분히 빠졌나)
    const past = close[Math.max(0, i - 10)];
    const dropPct = past > 0 ? ((c - past) / past) * 100 : 0;
    if (dropPct > -1.5) return { pass: false, qs };
    qs += dropPct < -4 ? 2 : 1;
    reasons.push(`낙폭 ${dropPct.toFixed(1)}%`);

    // 4) 반등 양봉 + 종가가 봉 상단(저점 매수세 유입 = 낙폭 되돌림)
    if (!(open[i] != null && close[i] > open[i])) return { pass: false, qs };
    const rng = high[i] - low[i];
    const posInRange = rng > 0 ? (close[i] - low[i]) / rng : 0;
    if (posInRange < 0.5) return { pass: false, qs }; // 종가 하단 = 약한 반등, 칼받기 위험
    qs += posInRange >= 0.7 ? 1.5 : 1;
    reasons.push('반등 양봉');

    // 5) 직전 봉 하락 (반전 확인 — 연속 상승의 막판 아님)
    if (i > 0 && open[i - 1] != null && close[i - 1] < open[i - 1]) { qs += 0.5; }

    // 6) 거래량 (반등에 거래량 실리면 신뢰↑)
    const volSlice = volume.slice(Math.max(0, i - 20), i).filter(v => v != null && v > 0);
    const volAvg20 = volSlice.length ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length : 0;
    const volRatio = volAvg20 > 0 ? (volume[i] || 0) / volAvg20 : 1;
    if (volRatio < 0.8) return { pass: false, qs };
    if (volRatio >= 1.5) { qs += 1; reasons.push(`거래량 ${volRatio.toFixed(1)}x`); }
    else if (volRatio >= 1.0) { qs += 0.5; }

    // 7) ATR 변동성 (반등은 변동성 다소 허용, 8% 초과는 차단)
    const atrPct = c > 0 ? ((ind.atrArr[i] || 0) / c) * 100 : 0;
    if (atrPct > 8.0) return { pass: false, qs };

    return {
        pass: qs >= 3.5, qs, reasons,
        adx: +(ind.adxArr[i] || 0).toFixed(0), volRatio: +volRatio.toFixed(1),
        atrPct: +atrPct.toFixed(1), rsiVal: Math.round(rsiVal), price: c,
    };
}

function bounceGrade(qs) { return qs >= 5.5 ? 'A' : 'B'; } // 역추세는 최고 A (S 없음)

// 역추세 반등 매수 스캔 (실시간) — 최근 봉에서 첫 통과 셋업 반환
export function smartDipScanBounce(q, { ts = [], lookback, measuredWin = null } = {}) {
    const { close = [] } = q;
    const N = close.length;
    if (N < 60) return null;
    const ind = indicators(q);
    const LB = lookback || 3;
    for (let i = N - 1; i >= Math.max(60, N - LB); i--) {
        const b = evalBounce(q, ind, i, ts);
        if (!b.pass) continue;
        const grade = bounceGrade(b.qs);
        const lv = tradeLevels('buy', b.price, ind.atrArr[i]);
        const fallback = grade === 'A' ? 33 : 29; // 반등 백테스트 실측치(2R 목표 기준)
        const winRate = (measuredWin && measuredWin['bounce_' + grade] != null) ? measuredWin['bounce_' + grade] : fallback;
        return {
            dir: 'buy', mode: 'bounce', grade,
            qualityScore: +b.qs.toFixed(1),
            winRate, winMeasured: !!(measuredWin && measuredWin['bounce_' + grade] != null),
            adx: b.adx, volRatio: b.volRatio, atrPct: b.atrPct, rsiVal: b.rsiVal,
            reasons: b.reasons.slice(0, 4),
            price: b.price,
            stop: lv?.stop ?? null, be: lv?.be ?? null, target1: lv?.target1 ?? null, target2: lv?.target2 ?? null, riskPct: lv?.riskPct ?? null,
            barsAgo: N - 1 - i,
        };
    }
    return null;
}

// 과거 데이터 백테스트 — 각 봉에서 신호 발생 시 진입, 이후 HORIZON 봉 내
// 목표(2R) 도달 vs 손절(-1R) 도달을 시뮬레이션. 봉별 독립 평가(중복 쿨다운).
// @returns { trades:[{grade,dir,outcome,R}], byGrade:{S,A,B:{n,win,avgR}} }
export function smartDipBacktest(q, { interval = '5m', spxTrendUp = null, horizon, targetR = TARGET1_R, mode = 'trend', exit = 'fixed', vwapArr = null } = {}) {
    const { close = [], high = [], low = [] } = q;
    const N = close.length;
    const trades = [];
    if (N < 80) return { trades };
    const ind = indicators(q);
    const htfLag = _htfLag(interval);
    const H = horizon || (interval === '15m' ? 16 : 24); // 목표/손절 관찰 봉수
    let cooldownUntil = -1;

    for (let i = 60; i < N - 2; i++) {
        if (i < cooldownUntil) continue;
        let best = null, dir = null, gradeFn = gradeOf;
        if (mode === 'bounce') {
            const b = evalBounce(q, ind, i);
            if (b.pass) { best = b; dir = 'buy'; gradeFn = bounceGrade; }
        } else {
            const buy  = evalBar(q, ind, i, 'buy',  htfLag, spxTrendUp, null, vwapArr);
            const sell = evalBar(q, ind, i, 'sell', htfLag, spxTrendUp, null, vwapArr);
            if (buy.pass && (!sell.pass || buy.qs >= sell.qs)) { best = buy; dir = 'buy'; }
            else if (sell.pass) { best = sell; dir = 'sell'; }
        }
        if (!best) continue;

        const entry = close[i];
        const lv = tradeLevels(dir, entry, ind.atrArr[i]);
        if (!lv) continue;
        const last = Math.min(N - 1, i + H);
        let outcome = 'timeout', exitR = 0;

        if (exit === 'trail') {
            // 트레일링 스톱: +1R 도달 시 본전 이동, 이후 최고점 대비 1.2ATR 추적.
            let stop = lv.stop, beMoved = false;
            let peak = entry; // buy=최고가, sell=최저가
            const trailDist = lv.stopDist;
            for (let j = i + 1; j <= last; j++) {
                const hi = high[j], lo = low[j];
                if (hi == null || lo == null) continue;
                // 1) 먼저 현재 스톱 히트 검사 (보수적)
                if (dir === 'buy' ? (lo <= stop) : (hi >= stop)) {
                    exitR = ((dir === 'buy' ? (stop - entry) : (entry - stop)) / lv.stopDist);
                    outcome = exitR >= 0 ? 'win' : 'loss'; break;
                }
                // 2) 본전 이동 (+1R 도달)
                if (!beMoved && (dir === 'buy' ? (hi >= entry + lv.stopDist) : (lo <= entry - lv.stopDist))) {
                    stop = entry; beMoved = true;
                }
                // 3) 트레일 (본전 이동 후 최고점 추적)
                if (beMoved) {
                    if (dir === 'buy') { peak = Math.max(peak, hi); stop = Math.max(stop, peak - trailDist); }
                    else               { peak = Math.min(peak, lo); stop = Math.min(stop, peak + trailDist); }
                }
            }
            if (outcome === 'timeout') {
                const ex = close[last];
                exitR = +(((dir === 'buy' ? (ex - entry) : (entry - ex)) / lv.stopDist)).toFixed(2);
            } else exitR = +exitR.toFixed(2);
        } else {
            // 고정 목표(targetR) vs 손절(-1R)
            const tgt = dir === 'buy' ? entry + lv.stopDist * targetR : entry - lv.stopDist * targetR;
            for (let j = i + 1; j <= last; j++) {
                const hi = high[j], lo = low[j];
                if (hi == null || lo == null) continue;
                if (dir === 'buy') {
                    if (lo <= lv.stop) { outcome = 'loss'; exitR = -1; break; }
                    if (hi >= tgt)     { outcome = 'win';  exitR =  targetR; break; }
                } else {
                    if (hi >= lv.stop) { outcome = 'loss'; exitR = -1; break; }
                    if (lo <= tgt)     { outcome = 'win';  exitR =  targetR; break; }
                }
            }
            if (outcome === 'timeout') {
                const ex = close[last];
                exitR = +(((dir === 'buy' ? (ex - entry) : (entry - ex)) / lv.stopDist)).toFixed(2);
            }
        }
        trades.push({ grade: gradeFn(best.qs), dir, outcome, R: exitR });
        cooldownUntil = i + Math.ceil(H / 3); // 신호 중복 방지
    }
    return { trades };
}
