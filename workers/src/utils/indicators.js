// 기술 지표 계산 — 클라이언트 chart-core.js 와 동일 로직 (Workers 포팅)
// 5분봉 자동 시그널 분석 cron 에서 사용.

export function calcEMA(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    let ema = null;
    for (let i = 0; i < data.length; i++) {
        if (data[i] == null) { result.push(null); continue; }
        if (ema === null) ema = data[i];
        else ema = data[i] * k + ema * (1 - k);
        result.push(ema);
    }
    return result;
}

export function calcRSI(closes, period = 14) {
    const rsi = [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < closes.length; i++) {
        if (i === 0 || closes[i] == null || closes[i-1] == null) { rsi.push(null); continue; }
        const change = closes[i] - closes[i-1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        if (i <= period) {
            avgGain += gain; avgLoss += loss;
            if (i === period) {
                avgGain /= period; avgLoss /= period;
                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                rsi.push(100 - 100 / (1 + rs));
            } else rsi.push(null);
        } else {
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            rsi.push(100 - 100 / (1 + rs));
        }
    }
    return rsi;
}

export function calcMACD(closes) {
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const macdLine = ema12.map((v, i) => (v != null && ema26[i] != null) ? v - ema26[i] : null);
    const signalLine = calcEMA(macdLine, 9);
    const histogram = macdLine.map((v, i) => (v != null && signalLine[i] != null) ? v - signalLine[i] : null);
    return { macdLine, signalLine, histogram };
}

export function calcATR(highs, lows, closes, period = 14) {
    const tr = [], atr = [];
    let prevAtr = null;
    for (let i = 0; i < closes.length; i++) {
        if (i === 0 || highs[i] == null || lows[i] == null || closes[i-1] == null) {
            tr.push(null); atr.push(null); continue;
        }
        tr.push(Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i-1]),
            Math.abs(lows[i] - closes[i-1])
        ));
        if (i < period) {
            if (i < 5) { atr.push(null); continue; }
            let sum = 0, cnt = 0;
            for (let j = 0; j <= i; j++) { if (tr[j] != null) { sum += tr[j]; cnt++; } }
            atr.push(cnt > 0 ? sum / cnt : null);
            continue;
        }
        if (prevAtr == null) {
            let sum = 0; for (let j = i - period + 1; j <= i; j++) sum += (tr[j] || 0);
            prevAtr = sum / period;
            atr.push(prevAtr);
        } else {
            prevAtr = (prevAtr * (period - 1) + (tr[i] || 0)) / period;
            atr.push(prevAtr);
        }
    }
    return atr;
}

// 마지막 유효 값
export function lastVal(arr) {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
    return null;
}

/**
 * 5분봉 시그널 감지 (단순화된 _calcSignalGrade 백엔드 버전)
 *
 * @param {object} q - { open, high, low, close, volume }  배열 형식
 * @returns {object|null} { dir: 'buy'|'sell', grade: 'S'|'A'|'B'|'C', score, winRate, factors[], price }
 *
 * 클라이언트와 동일한 점수 체계 사용:
 *   - 추세 정/역배열       : 2점
 *   - EMA20 위/아래         : 1점
 *   - 거래량 (5분봉: 8봉 평균 대비 1.2x+) : 0.5~1.5점
 *   - RSI (5분봉: 25/75 임계값)            : -1~+1.5점
 *   - MACD 골든/데드 크로스                : 0.5~1.5점
 *   - ATR 적정범위 (0.5~3.0%)               : 0.5점
 *
 *   S: ≥7 (승률 80%) / A: ≥5.5 (70%) / B: ≥4 (60%) / C: <4 (50%)
 */
export function detectSignal(q, thresholds = null) {
    const { close = [], high = [], low = [], volume = [] } = q;
    const N = close.length;
    if (N < 30) return null;
    const i = N - 1;
    const c = close[i];
    if (c == null) return null;

    const ema20  = calcEMA(close, 20);
    const ema60  = calcEMA(close, 60);
    const ema120 = calcEMA(close, 120);
    const rsi    = calcRSI(close, 14);
    const { macdLine, signalLine } = calcMACD(close);
    const atrArr = calcATR(high, low, close, 14);

    const e20  = ema20[i];
    const e60  = ema60[i];
    const e120 = ema120[i];
    const rsiV = rsi[i];
    const macdV = macdLine[i], macdPrev = macdLine[i-1];
    const sigV  = signalLine[i], sigPrev = signalLine[i-1];
    const atr   = atrArr[i];

    if (e20 == null || rsiV == null || macdV == null || atr == null) return null;

    // 추세 방향 판단
    const trendUp = e20 != null && e60 != null && e120 != null && e20 > e60 && e60 > e120;
    const trendDn = e20 != null && e60 != null && e120 != null && e20 < e60 && e60 < e120;

    // 거래량 (5분봉: 8봉 평균)
    const volSlice = volume.slice(Math.max(0, i - 8), i).filter(v => v != null);
    const vAvg = volSlice.length ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length : 0;
    const vCur = volume[i] || 0;
    const vRatio = vAvg > 0 ? vCur / vAvg : 1;

    // MACD 크로스
    const macdGoldenCross = macdPrev != null && sigPrev != null
        ? (macdV > sigV && macdPrev <= sigPrev) : false;
    const macdDeadCross = macdPrev != null && sigPrev != null
        ? (macdV < sigV && macdPrev >= sigPrev) : false;

    // RSI (5분봉 임계값)
    const RSI_OS = 25, RSI_OB = 75;

    // ── BUY 점수 계산 ──
    let buyScore = 0;
    const buyFactors = [];
    if (trendUp) { buyScore += 2; buyFactors.push('추세 정배열'); }
    if (c > e20) { buyScore += 1; buyFactors.push('EMA20 위'); }
    if (vRatio >= 2.0)      { buyScore += 1.5; buyFactors.push(`거래량 ${vRatio.toFixed(1)}x`); }
    else if (vRatio >= 1.5) { buyScore += 1;   buyFactors.push(`거래량 ${vRatio.toFixed(1)}x`); }
    else if (vRatio >= 1.2) { buyScore += 0.5; buyFactors.push(`거래량 ${vRatio.toFixed(1)}x`); }
    if (rsiV < RSI_OS)               { buyScore += 1.5; buyFactors.push(`RSI ${rsiV.toFixed(0)} 과매도`); }
    else if (rsiV >= 40 && rsiV <= 60){ buyScore += 1;   buyFactors.push(`RSI ${rsiV.toFixed(0)} 중립`); }
    else if (rsiV > RSI_OB)           { buyScore -= 1;   buyFactors.push(`RSI ${rsiV.toFixed(0)} 과매수`); }
    if (macdGoldenCross) { buyScore += 1.5; buyFactors.push('MACD 골든크로스'); }
    else if (macdV > 0)  { buyScore += 0.5; buyFactors.push('MACD 양수'); }
    const atrPct = (atr / c) * 100;
    if (atrPct >= 0.5 && atrPct <= 3.0) { buyScore += 0.5; buyFactors.push(`ATR ${atrPct.toFixed(1)}%`); }

    // ── SELL 점수 계산 ──
    let sellScore = 0;
    const sellFactors = [];
    if (trendDn) { sellScore += 2; sellFactors.push('추세 역배열'); }
    if (c < e20) { sellScore += 1; sellFactors.push('EMA20 아래'); }
    if (vRatio >= 2.0)      { sellScore += 1.5; sellFactors.push(`거래량 ${vRatio.toFixed(1)}x`); }
    else if (vRatio >= 1.5) { sellScore += 1;   sellFactors.push(`거래량 ${vRatio.toFixed(1)}x`); }
    else if (vRatio >= 1.2) { sellScore += 0.5; sellFactors.push(`거래량 ${vRatio.toFixed(1)}x`); }
    if (rsiV > RSI_OB)                { sellScore += 1.5; sellFactors.push(`RSI ${rsiV.toFixed(0)} 과매수`); }
    else if (rsiV < RSI_OS)           { sellScore -= 1;   sellFactors.push(`RSI ${rsiV.toFixed(0)} 과매도`); }
    if (macdDeadCross)   { sellScore += 1.5; sellFactors.push('MACD 데드크로스'); }
    else if (macdV < 0)  { sellScore += 0.5; sellFactors.push('MACD 음수'); }
    if (atrPct >= 0.5 && atrPct <= 3.0) { sellScore += 0.5; sellFactors.push(`ATR ${atrPct.toFixed(1)}%`); }

    // 방향 결정 — 점수 차이 1점 이상일 때만 유효 시그널
    const useBuy = buyScore > sellScore && (buyScore - sellScore) >= 1;
    const useSell = sellScore > buyScore && (sellScore - buyScore) >= 1;
    if (!useBuy && !useSell) return null;

    const score = useBuy ? buyScore : sellScore;
    const factors = useBuy ? buyFactors : sellFactors;
    // 동적 임계값 (자동 보정 결과) — null 이면 하드코딩 기본값
    const T = thresholds || { S: 7.0, A: 5.5, B: 4.0 };
    let grade = 'C', winRate = 50;
    if (score >= T.S)      { grade = 'S'; winRate = 80; }
    else if (score >= T.A) { grade = 'A'; winRate = 70; }
    else if (score >= T.B) { grade = 'B'; winRate = 60; }

    return {
        dir: useBuy ? 'buy' : 'sell',
        grade,
        score,
        winRate,
        factors,
        price: c,
        rsi: rsiV,
        macd: macdV,
        ema20: e20,
    };
}
