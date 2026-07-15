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
        return { pass: false, qs: 0, failReason: '데이터 부족(가격/EMA/ATR 계산 불가)' };
    }
    let qs = 0;
    const reasons = [];

    // 필터 1: ADX 추세강도 (봉별 실제 ADX)
    const adx = ind.adxArr[i];
    if (adx == null || adx < 20) return { pass: false, qs, failReason: `ADX ${adx != null ? adx.toFixed(0) : '?'} (기준 20 미만 — 추세 강도 부족)` };
    qs += adx >= 35 ? 2 : 1;
    reasons.push(`ADX ${adx.toFixed(0)}`);

    // 필터 2: HTF 추세 정렬
    const e60prev  = ind.ema60[Math.max(0, i - htfLag * 5)];
    const e120prev = ind.ema120[Math.max(0, i - htfLag * 10)];
    const htfUp = e60prev != null && e120prev != null && ind.ema60[i] > e60prev && ind.ema120[i] > e120prev;
    const htfDn = e60prev != null && e120prev != null && ind.ema60[i] < e60prev && ind.ema120[i] < e120prev;
    if (dir === 'buy'  && !htfUp) return { pass: false, qs, failReason: '상위추세(EMA60/120) 상승 정렬 안 됨' };
    if (dir === 'sell' && !htfDn) return { pass: false, qs, failReason: '상위추세(EMA60/120) 하락 정렬 안 됨' };
    qs += 2;
    reasons.push(dir === 'buy' ? '상위추세 상승' : '상위추세 하락');

    // 필터 3: 거래량 확인 (Wyckoff)
    const volSlice = volume.slice(Math.max(0, i - 20), i).filter(v => v != null && v > 0);
    const volAvg20 = volSlice.length ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length : 0;
    const volRatio = volAvg20 > 0 ? (volume[i] || 0) / volAvg20 : 1;
    const volPrevR = volAvg20 > 0 ? (volume[i - 1] || 0) / volAvg20 : 1;
    const volRecovery = volPrevR < 1.0 && volRatio > 1.2;
    if (volRatio < 0.8) return { pass: false, qs, failReason: `거래량 ${volRatio.toFixed(1)}x (기준 0.8x 미만 — 거래량 부족)` };
    if (volRecovery)          { qs += 2; reasons.push(`거래량 회복 ${volRatio.toFixed(1)}x`); }
    else if (volRatio >= 1.2) { qs += 1; reasons.push(`거래량 ${volRatio.toFixed(1)}x`); }

    // 필터 4: 직전 봉 과열 방지 + 현재 봉 방향 (소프트 보너스 — 하드 차단 없음)
    if (i > 0 && open[i - 1] != null && open[i - 1] > 0) {
        const prevMove = ((close[i - 1] - open[i - 1]) / open[i - 1]) * 100;
        if (dir === 'buy'  && prevMove < -3) return { pass: false, qs, failReason: `직전봉 급락 ${prevMove.toFixed(1)}% (과열 방지 컷)` };
        if (dir === 'sell' && prevMove >  3) return { pass: false, qs, failReason: `직전봉 급등 ${prevMove.toFixed(1)}% (과열 방지 컷)` };
    }
    if (open[i] != null) {
        const bull = close[i] > open[i];
        if (dir === 'buy'  && bull)  { qs += 1; reasons.push('양봉 반등'); }
        if (dir === 'sell' && !bull) { qs += 1; reasons.push('음봉 하락'); }
    }

    // 필터 5: ATR 변동성
    const atrPct = c > 0 ? ((ind.atrArr[i] || 0) / c) * 100 : 0;
    if (atrPct > 5.0) return { pass: false, qs, failReason: `ATR ${atrPct.toFixed(1)}% (변동성 과다, 기준 5% 초과)` };
    if (atrPct >= 1.0 && atrPct <= 3.0) { qs += 1; reasons.push(`ATR ${atrPct.toFixed(1)}%`); }

    // 필터 6: S&P 500 환경
    if (spxTrendUp === true)  { if (dir === 'buy')  { qs += 1; reasons.push('SPX 상승'); } else qs -= 1; }
    if (spxTrendUp === false) { if (dir === 'sell') { qs += 1; reasons.push('SPX 하락'); } else qs -= 1; }

    // 필터 7: RSI 위치
    const rsiVal = ind.rsi[i] != null ? ind.rsi[i] : 50;
    if (dir === 'buy'  && rsiVal > 75) return { pass: false, qs, failReason: `RSI ${rsiVal.toFixed(0)} 과매수(75 초과)` };
    if (dir === 'sell' && rsiVal < 25) return { pass: false, qs, failReason: `RSI ${rsiVal.toFixed(0)} 과매도(25 미만)` };
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
        if (dir === 'buy'  && c < v) return { pass: false, qs, failReason: 'VWAP 아래 (기관 기준선 하회)' };
        if (dir === 'sell' && c > v) return { pass: false, qs, failReason: 'VWAP 위 (기관 기준선 상회)' };
        qs += 1; reasons.push('VWAP 정렬');
    }

    // 필터 10: EQH/EQL 유동성 스윕 (Smart Money Concepts) — 소프트 보너스, 하드 차단 없음
    //   직전 20봉 고점/저점을 "살짝 뚫었다가 종가는 다시 안으로 마감"하는 손절사냥 후 반전 패턴.
    //   파동확장(waveExt) 필터는 "얼마나 움직였나"를 보는 거고, 이건 "특정 레벨을 뚫고 되돌렸나"를 보는 거라 중복 아님.
    const SWEEP_LB = 20;
    if (i >= SWEEP_LB) {
        const priorHighs = high.slice(i - SWEEP_LB, i).filter(v => v != null);
        const priorLows  = low.slice(i - SWEEP_LB, i).filter(v => v != null);
        if (dir === 'sell' && priorHighs.length && high[i] != null) {
            const priorHigh = Math.max(...priorHighs);
            if (high[i] > priorHigh && c < priorHigh) { qs += 1.5; reasons.push('EQH 유동성 스윕'); }
        }
        if (dir === 'buy' && priorLows.length && low[i] != null) {
            const priorLow = Math.min(...priorLows);
            if (low[i] < priorLow && c > priorLow) { qs += 1.5; reasons.push('EQL 유동성 스윕'); }
        }
    }

    return {
        pass: qs >= 5, qs, reasons,
        failReason: qs < 5 ? `종합 점수 ${qs.toFixed(1)} (기준 5.0 미달)` : null,
        adx: +adx.toFixed(0), volRatio: +volRatio.toFixed(1), atrPct: +atrPct.toFixed(1),
        rsiVal: Math.round(rsiVal), price: c,
        volAvg20: Math.round(volAvg20), // 20봉 평균 거래량 (절대값 필터용)
    };
}

function gradeOf(qs) { return qs >= 8 ? 'S' : qs >= 6 ? 'A' : 'B'; } // pass=qs≥5 → 최소 B
const _htfLag = (interval) => interval === '15m' ? 4 : interval === '30m' ? 2 : 3; // 5m: 75분(15봉) 추세 확인 — 기존 150분(30봉)은 반등 구간에서 과차단

// 최근 봉을 스캔해 가장 최근 통과 셋업 반환 (실시간 스캐너용)
export function smartDipScan(q, { interval = '5m', ts = [], spxTrendUp = null, lookback, measuredWin = null, vwapArr = null } = {}) {
    const { close = [] } = q;
    const N = close.length;
    if (N < 60) return null;
    const ind = indicators(q);
    const htfLag = _htfLag(interval);
    const LB = lookback || (interval === '15m' ? 2 : 3);

    for (let i = N - 1; i >= Math.max(60, N - LB); i--) {
        const buy  = evalBar(q, ind, i, 'buy',  htfLag, spxTrendUp, ts, vwapArr);
        const sell = evalBar(q, ind, i, 'sell', htfLag, spxTrendUp, ts, vwapArr);
        let best = null, dir = null;
        if (buy.pass && (!sell.pass || buy.qs >= sell.qs)) { best = buy; dir = 'buy'; }
        else if (sell.pass) { best = sell; dir = 'sell'; }
        if (!best) continue;

        const grade = gradeOf(best.qs);
        const lv = tradeLevels(dir, best.price, ind.atrArr[i]);
        // 폴백 승률 = 트레일링+점심필터 백테스트 실측치 (S 52% / A 46% / B 46%, 기대값 +0.27~+0.34R)
        const fallback = grade === 'S' ? 52 : grade === 'A' ? 46 : 46;
        const winRate = (measuredWin && measuredWin[grade] != null) ? measuredWin[grade] : fallback;
        return {
            dir, grade,
            qualityScore: +best.qs.toFixed(1),
            winRate,
            winMeasured: !!(measuredWin && measuredWin[grade] != null),
            adx: best.adx, volRatio: best.volRatio, atrPct: best.atrPct, rsiVal: best.rsiVal,
            volAvg20: best.volAvg20 ?? 0,
            reasons: best.reasons.slice(0, 5),
            price: best.price,
            stop: lv?.stop ?? null, be: lv?.be ?? null, target1: lv?.target1 ?? null, target2: lv?.target2 ?? null, riskPct: lv?.riskPct ?? null,
            barsAgo: N - 1 - i,
        };
    }
    return null;
}

// 최근 봉 하나를 평가해 통과 여부와 무관하게 점수·통과사유·미달사유를 그대로 반환 — "왜 신호가 안 뜨는지" 진단용.
// smartDipScan/smartDipScanBounce는 통과(pass) 못 하면 아예 null을 반환해 원인이 사라지므로,
// 매수 확신은 있는데 신호가 안 잡히는 종목을 딥다이브할 때 이 함수로 근거를 보여준다.
export function smartDipDiagnose(q, { interval = '5m', ts = [], spxTrendUp = null, vwapArr = null } = {}) {
    const { close = [] } = q;
    const N = close.length;
    if (N < 60) return null;
    // 최근 봉이 아직 형성 중이라 close가 null일 수 있음 — 마지막으로 유효한 봉까지 거슬러 올라감
    let i = N - 1;
    while (i > 0 && close[i] == null) i--;
    if (i < 60) return null;
    const ind = indicators(q);
    const htfLag = _htfLag(interval);
    const buy    = evalBar(q, ind, i, 'buy',  htfLag, spxTrendUp, ts, vwapArr);
    const sell   = evalBar(q, ind, i, 'sell', htfLag, spxTrendUp, ts, vwapArr);
    const bounce = evalBounce(q, ind, i, ts);
    const pack = (r, threshold) => ({
        pass: !!r.pass,
        qs: +((r.qs || 0).toFixed(1)),
        need: Math.max(0, +((threshold - (r.qs || 0)).toFixed(1))),
        reasons: r.reasons || [],
        failReason: r.failReason || null,
    });
    return {
        buy: pack(buy, 5),
        sell: pack(sell, 5),
        bounce: pack(bounce, 3.5),
    };
}

// ── 역추세 반등 매수 (낙폭과대) ────────────────────────────────
// 추세추종이 아닌 평균회귀: 하락 중 과매도 + 반등 양봉(눌림 바닥)을 매수.
// 추세 매수가 안 나오는 하락장에서 단기 반등 타점을 잡기 위함.
function evalBounce(q, ind, i, ts) {
    const { close, high, low, open, volume } = q;
    const c = close[i];
    if (c == null || ind.rsi[i] == null || ind.atrArr[i] == null || ind.ema60[i] == null) return { pass: false, qs: 0, failReason: '데이터 부족(가격/RSI/ATR 계산 불가)' };
    let qs = 0;
    const reasons = [];

    // 1) 낙폭과대 맥락 — 가격이 EMA60 아래 (추세 대비 눌림)
    if (c >= ind.ema60[i]) return { pass: false, qs, failReason: 'EMA60 위 — 눌림목 맥락 아님(낙폭과대 아님)' };

    // 2) RSI 과매도 (핵심 트리거) — 5분봉은 반등 시 RSI 빠르게 회복하므로 42 이하 허용
    const rsiVal = ind.rsi[i];
    if (rsiVal >= 42) return { pass: false, qs, failReason: `RSI ${rsiVal.toFixed(0)} (기준 42 이상 — 아직 과매도 아님)` };
    qs += rsiVal < 30 ? 2 : rsiVal < 38 ? 1 : 0.5;
    reasons.push(`RSI ${rsiVal.toFixed(0)} 과매도`);

    // 3) 최근 10봉 누적 낙폭 (충분히 빠졌나)
    const past = close[Math.max(0, i - 10)];
    const dropPct = past > 0 ? ((c - past) / past) * 100 : 0;
    if (dropPct > -1.5) return { pass: false, qs, failReason: `낙폭 ${dropPct.toFixed(1)}% (기준 -1.5% 미만 — 아직 덜 빠짐)` };
    qs += dropPct < -4 ? 2 : 1;
    reasons.push(`낙폭 ${dropPct.toFixed(1)}%`);

    // 4) 반등 양봉 + 종가가 봉 상단(저점 매수세 유입 = 낙폭 되돌림)
    if (!(open[i] != null && close[i] > open[i])) return { pass: false, qs, failReason: '아직 반등 양봉 없음 (음봉 지속)' };
    const rng = high[i] - low[i];
    const posInRange = rng > 0 ? (close[i] - low[i]) / rng : 0;
    if (posInRange < 0.5) return { pass: false, qs, failReason: `종가 위치 봉 하단(${(posInRange*100).toFixed(0)}%) — 반등 약함` }; // 종가 하단 = 약한 반등, 칼받기 위험
    qs += posInRange >= 0.7 ? 1.5 : 1;
    reasons.push('반등 양봉');

    // 5) 직전 봉 하락 (반전 확인 — 연속 상승의 막판 아님)
    if (i > 0 && open[i - 1] != null && close[i - 1] < open[i - 1]) { qs += 0.5; }

    // 6) 거래량 (반등에 거래량 실리면 신뢰↑)
    const volSlice = volume.slice(Math.max(0, i - 20), i).filter(v => v != null && v > 0);
    const volAvg20 = volSlice.length ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length : 0;
    const volRatio = volAvg20 > 0 ? (volume[i] || 0) / volAvg20 : 1;
    if (volRatio < 0.8) return { pass: false, qs, failReason: `거래량 ${volRatio.toFixed(1)}x (기준 0.8x 미만)` };
    if (volRatio >= 1.5) { qs += 1; reasons.push(`거래량 ${volRatio.toFixed(1)}x`); }
    else if (volRatio >= 1.0) { qs += 0.5; }

    // 7) ATR 변동성 (반등은 변동성 다소 허용, 8% 초과는 차단)
    const atrPct = c > 0 ? ((ind.atrArr[i] || 0) / c) * 100 : 0;
    if (atrPct > 8.0) return { pass: false, qs, failReason: `ATR ${atrPct.toFixed(1)}% (변동성 과다, 기준 8% 초과)` };

    // 8) EQL 유동성 스윕 (Smart Money Concepts) — 직전 저점을 살짝 뚫었다가 종가는 다시 위로 마감
    //    (단순 "낙폭 %"이 아니라 특정 지지 레벨을 정확히 스탑헌팅했는지 확인 — 소프트 보너스)
    const SWEEP_LB = 20;
    if (i >= SWEEP_LB) {
        const priorLows = low.slice(i - SWEEP_LB, i).filter(v => v != null);
        if (priorLows.length && low[i] != null) {
            const priorLow = Math.min(...priorLows);
            if (low[i] < priorLow && c > priorLow) { qs += 1; reasons.push('EQL 유동성 스윕'); }
        }
    }

    return {
        pass: qs >= 3.5, qs, reasons,
        failReason: qs < 3.5 ? `종합 점수 ${qs.toFixed(1)} (기준 3.5 미달)` : null,
        adx: +(ind.adxArr[i] || 0).toFixed(0), volRatio: +volRatio.toFixed(1),
        atrPct: +atrPct.toFixed(1), rsiVal: Math.round(rsiVal), price: c,
        volAvg20: Math.round(volAvg20),
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
            volAvg20: b.volAvg20 ?? 0,
            reasons: b.reasons.slice(0, 5),
            price: b.price,
            stop: lv?.stop ?? null, be: lv?.be ?? null, target1: lv?.target1 ?? null, target2: lv?.target2 ?? null, riskPct: lv?.riskPct ?? null,
            barsAgo: N - 1 - i,
        };
    }
    return null;
}

// ── 종가베팅 (장 마감 강세 마감 종목 매수 → 익일 시가 청산) ──────────────
// 장중 추세추종/반등과 다른 별개 전략: 오늘 하루 강하게 올라 당일 고점 근처에서
// 마감하는 종목 = 오버나이트 모멘텀 이어질 가능성. 손절/트레일 없이 익일 시가에 그대로 청산.
function evalCloseBet(q, ind, i, ts) {
    const { close, high, low, open, volume } = q;
    const c = close[i];
    if (c == null || ind.ema60[i] == null) return { pass: false, qs: 0 };

    // 당일 시작 봉 인덱스 탐색 (ts의 UTC 날짜 기준)
    const today = ts && ts[i] ? Math.floor(ts[i] / 86400) : null;
    let startIdx = i;
    if (today != null && ts) {
        while (startIdx > 0 && ts[startIdx - 1] != null && Math.floor(ts[startIdx - 1] / 86400) === today) startIdx--;
    } else {
        startIdx = Math.max(0, i - 77); // ts 없으면 최근 78봉(하루치)으로 폴백
    }
    if (startIdx >= i) return { pass: false, qs: 0 };

    const dayOpen = open[startIdx];
    const highs = high.slice(startIdx, i + 1).filter(v => v != null);
    const lows  = low.slice(startIdx, i + 1).filter(v => v != null);
    if (!dayOpen || dayOpen <= 0 || !highs.length || !lows.length) return { pass: false, qs: 0 };
    const dayHigh = Math.max(...highs);
    const dayLow  = Math.min(...lows);

    let qs = 0;
    const reasons = [];

    // 1) 당일 등락률 — 충분히 강세로 올라야 함 (최소 +2%)
    const chgPct = ((c - dayOpen) / dayOpen) * 100;
    if (chgPct < 2.0) return { pass: false, qs };
    qs += chgPct >= 5 ? 2 : 1;
    reasons.push(`당일 +${chgPct.toFixed(1)}%`);

    // 2) 당일 고점 근처 마감 (상단 15% 이내) — 종가가 약하면 다음날 갭다운 위험
    const rng = dayHigh - dayLow;
    const posInRange = rng > 0 ? (c - dayLow) / rng : 1;
    if (posInRange < 0.85) return { pass: false, qs };
    qs += posInRange >= 0.95 ? 2 : 1;
    reasons.push(`당일고점 대비 ${(posInRange * 100).toFixed(0)}%`);

    // 3) 거래량 확인 — 진짜 강세인지(거래량 실림) 확인
    const volSlice = volume.slice(Math.max(0, startIdx - 20), startIdx).filter(v => v != null && v > 0);
    const volAvg20 = volSlice.length ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length : 0;
    const volRatio = volAvg20 > 0 ? (volume[i] || 0) / volAvg20 : 1;
    if (volRatio < 1.2) return { pass: false, qs };
    qs += volRatio >= 2 ? 2 : 1;
    reasons.push(`거래량 ${volRatio.toFixed(1)}x`);

    // 4) 상승추세 컨텍스트 (EMA60 위)
    if (c > ind.ema60[i]) { qs += 1; reasons.push('EMA60 위'); }

    return {
        pass: qs >= 4, qs, reasons,
        volRatio: +volRatio.toFixed(1), price: c,
        volAvg20: Math.round(volAvg20), chgPct: +chgPct.toFixed(1),
    };
}

function closeBetGrade(qs) { return qs >= 6 ? 'S' : qs >= 5 ? 'A' : 'B'; }

// 종가베팅 스캔 — 장 마감 직전 틱에서 호출. 손절은 고정 -3%(오버나이트 갭 리스크 보호), 목표 없음(익일 시가 청산).
export function smartDipScanCloseBet(q, { ts = [] } = {}) {
    const { close = [] } = q;
    const N = close.length;
    if (N < 20) return null;
    const ind = indicators(q);
    const i = N - 1; // 마지막(현재) 봉만 평가 — 장마감 직전 스냅샷
    const b = evalCloseBet(q, ind, i, ts);
    if (!b.pass) return null;
    const grade = closeBetGrade(b.qs);
    const stopDist = b.price * 0.03;
    return {
        dir: 'buy', mode: 'closebet', grade,
        qualityScore: +b.qs.toFixed(1),
        volRatio: b.volRatio, volAvg20: b.volAvg20 ?? 0,
        reasons: b.reasons.slice(0, 5),
        price: b.price,
        stop: +(b.price - stopDist).toFixed(4),
        barsAgo: 0,
    };
}

// 과거 데이터 백테스트 — 각 봉에서 신호 발생 시 진입, 이후 HORIZON 봉 내
// 목표(2R) 도달 vs 손절(-1R) 도달을 시뮬레이션. 봉별 독립 평가(중복 쿨다운).
// @returns { trades:[{grade,dir,outcome,R}], byGrade:{S,A,B:{n,win,avgR}} }
export function smartDipBacktest(q, { interval = '5m', spxTrendUp = null, horizon, targetR = TARGET1_R, mode = 'trend', exit = 'fixed', vwapArr = null, ts = null, skipMidday = false } = {}) {
    const { close = [], high = [], low = [] } = q;
    const N = close.length;
    const trades = [];
    if (N < 80) return { trades };
    const ind = indicators(q);
    const htfLag = _htfLag(interval);
    const H = horizon || (interval === '15m' ? 16 : interval === '1d' ? 20 : 24); // 목표/손절 관찰 봉수
    let cooldownUntil = -1;

    for (let i = 60; i < N - 2; i++) {
        if (i < cooldownUntil) continue;
        // 시간대 필터 — 점심 횡보(15:30~18:30 UTC) 진입 제외
        if (skipMidday && ts && ts[i]) {
            const d = new Date(ts[i] * 1000);
            const m = d.getUTCHours() * 60 + d.getUTCMinutes();
            if (m >= 930 && m < 1110) continue;
        }
        let best = null, dir = null, gradeFn = gradeOf;
        if (mode === 'bounce') {
            const b = evalBounce(q, ind, i);
            if (b.pass) { best = b; dir = 'buy'; gradeFn = bounceGrade; }
        } else {
            // ts 전달 — 라이브 스캐너와 동일하게 장초반 노이즈 필터(8) 적용 (정확도 일관성)
            const buy  = evalBar(q, ind, i, 'buy',  htfLag, spxTrendUp, ts, vwapArr);
            const sell = evalBar(q, ind, i, 'sell', htfLag, spxTrendUp, ts, vwapArr);
            if (buy.pass && (!sell.pass || buy.qs >= sell.qs)) { best = buy; dir = 'buy'; }
            else if (sell.pass) { best = sell; dir = 'sell'; }
        }
        if (!best) continue;

        const entry = close[i];
        const lv = tradeLevels(dir, entry, ind.atrArr[i]);
        if (!lv) continue;
        const last = Math.min(N - 1, i + H);

        let exitR, outcome;
        if (exit === 'hybrid') {
            // 50% 고정 2R 익절 + 50% 트레일링 — 두 포지션 평균 R
            const r1 = _simFixed(dir, entry, lv, i, last, high, low, close, 2);
            const r2 = _simTrail(dir, entry, lv, i, last, high, low, close);
            exitR = +(0.5 * r1.R + 0.5 * r2.R).toFixed(2);
            outcome = exitR > 0.05 ? 'win' : exitR < -0.05 ? 'loss' : 'timeout';
        } else if (exit === 'trail') {
            const r = _simTrail(dir, entry, lv, i, last, high, low, close);
            exitR = +r.R.toFixed(2); outcome = r.outcome;
        } else {
            const r = _simFixed(dir, entry, lv, i, last, high, low, close, targetR);
            exitR = +r.R.toFixed(2); outcome = r.outcome;
        }
        // 기간 버킷 (교차검증) — 진입 봉 위치로 초/중/후반 3등분
        const bucket = Math.min(2, Math.max(0, Math.floor((i - 60) / Math.max(1, (N - 62) / 3))));
        trades.push({ grade: gradeFn(best.qs), dir, outcome, R: exitR, bucket });
        cooldownUntil = i + Math.ceil(H / 3); // 신호 중복 방지
    }
    return { trades };
}

// 고정 목표 청산 시뮬레이션 — 목표(targetR) vs 손절(-1R), 동일봉이면 손절 우선
function _simFixed(dir, entry, lv, i, last, high, low, close, targetR) {
    const tgt = dir === 'buy' ? entry + lv.stopDist * targetR : entry - lv.stopDist * targetR;
    for (let j = i + 1; j <= last; j++) {
        const hi = high[j], lo = low[j];
        if (hi == null || lo == null) continue;
        if (dir === 'buy') {
            if (lo <= lv.stop) return { R: -1, outcome: 'loss' };
            if (hi >= tgt)     return { R: targetR, outcome: 'win' };
        } else {
            if (hi >= lv.stop) return { R: -1, outcome: 'loss' };
            if (lo <= tgt)     return { R: targetR, outcome: 'win' };
        }
    }
    const ex = close[last];
    return { R: (dir === 'buy' ? (ex - entry) : (entry - ex)) / lv.stopDist, outcome: 'timeout' };
}

// 실전 forward-test 청산 시뮬레이터 — 진입 이후 봉 배열로 트레일링 청산 결과 산출.
// dt_signals resolve cron 에서 사용. bars = [{high,low,close}, ...] (진입 다음 봉부터).
// @returns { resolved, outcome, exitPrice, exitR }  resolved=false 면 아직 진행중.
export function resolveTrailExit({ dir, entry, stop: initStop, stopDist }, bars, horizon) {
    if (!bars || !bars.length || !(stopDist > 0)) return { resolved: false };
    let stop = initStop, beMoved = false, peak = entry;
    const H = horizon || bars.length;
    const last = Math.min(bars.length, H);
    for (let j = 0; j < last; j++) {
        const hi = bars[j].high, lo = bars[j].low;
        if (hi == null || lo == null) continue;
        if (dir === 'buy' ? (lo <= stop) : (hi >= stop)) {
            const exitR = (dir === 'buy' ? (stop - entry) : (entry - stop)) / stopDist;
            return { resolved: true, outcome: exitR >= 0 ? 'win' : 'loss', exitPrice: stop, exitR: +exitR.toFixed(2) };
        }
        if (!beMoved && (dir === 'buy' ? (hi >= entry + stopDist) : (lo <= entry - stopDist))) { stop = entry; beMoved = true; }
        if (beMoved) {
            if (dir === 'buy') { peak = Math.max(peak, hi); stop = Math.max(stop, peak - stopDist); }
            else               { peak = Math.min(peak, lo); stop = Math.min(stop, peak + stopDist); }
        }
    }
    // 관찰 기간(horizon) 다 지났으면 마지막 종가로 청산, 아니면 아직 진행중
    if (bars.length >= H) {
        const ex = bars[last - 1].close;
        const exitR = +(((dir === 'buy' ? (ex - entry) : (entry - ex)) / stopDist)).toFixed(2);
        return { resolved: true, outcome: 'timeout', exitPrice: ex, exitR };
    }
    return { resolved: false };
}

// 트레일링 청산 시뮬레이션 — +1R 본전 이동 후 최고점 대비 1.2ATR 추적
function _simTrail(dir, entry, lv, i, last, high, low, close) {
    let stop = lv.stop, beMoved = false, peak = entry;
    const trailDist = lv.stopDist;
    for (let j = i + 1; j <= last; j++) {
        const hi = high[j], lo = low[j];
        if (hi == null || lo == null) continue;
        if (dir === 'buy' ? (lo <= stop) : (hi >= stop)) {
            const R = (dir === 'buy' ? (stop - entry) : (entry - stop)) / lv.stopDist;
            return { R, outcome: R >= 0 ? 'win' : 'loss' };
        }
        if (!beMoved && (dir === 'buy' ? (hi >= entry + lv.stopDist) : (lo <= entry - lv.stopDist))) {
            stop = entry; beMoved = true;
        }
        if (beMoved) {
            if (dir === 'buy') { peak = Math.max(peak, hi); stop = Math.max(stop, peak - trailDist); }
            else               { peak = Math.min(peak, lo); stop = Math.min(stop, peak + trailDist); }
        }
    }
    const ex = close[last];
    return { R: (dir === 'buy' ? (ex - entry) : (entry - ex)) / lv.stopDist, outcome: 'timeout' };
}
