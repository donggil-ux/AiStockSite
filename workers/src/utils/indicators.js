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

// VWAP — 거래량 가중 평균가 (당일 세션 봉 누적). 마지막 값 반환.
// q: { high, low, close, volume } 배열. range=1d&interval=5m 면 당일 세션.
export function calcVWAP(q) {
    const { high = [], low = [], close = [], volume = [] } = q;
    let pv = 0, vol = 0;
    for (let i = 0; i < close.length; i++) {
        const h = high[i], l = low[i], c = close[i], v = volume[i];
        if (h == null || l == null || c == null || v == null || v <= 0) continue;
        const tp = (h + l + c) / 3; // typical price
        pv += tp * v;
        vol += v;
    }
    return vol > 0 ? pv / vol : null;
}

// ADX — Wilder 추세강도(0~100). DI+/DI− 기반. 마지막 ADX 값 반환.
export function calcADX(highs, lows, closes, period = 14) {
    const n = closes.length;
    if (n < period * 2 + 1) return null;
    const tr = [], plusDM = [], minusDM = [];
    for (let i = 1; i < n; i++) {
        if (highs[i] == null || lows[i] == null || closes[i-1] == null || highs[i-1] == null || lows[i-1] == null) {
            tr.push(0); plusDM.push(0); minusDM.push(0); continue;
        }
        const up = highs[i] - highs[i-1];
        const down = lows[i-1] - lows[i];
        plusDM.push(up > down && up > 0 ? up : 0);
        minusDM.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
    }
    // Wilder 평활
    let atr = 0, pdm = 0, mdm = 0;
    for (let i = 0; i < period; i++) { atr += tr[i]; pdm += plusDM[i]; mdm += minusDM[i]; }
    const dx = [];
    const pushDX = () => {
        const pDI = atr === 0 ? 0 : 100 * pdm / atr;
        const mDI = atr === 0 ? 0 : 100 * mdm / atr;
        const sum = pDI + mDI;
        dx.push(sum === 0 ? 0 : 100 * Math.abs(pDI - mDI) / sum);
    };
    pushDX();
    for (let i = period; i < tr.length; i++) {
        atr = atr - atr / period + tr[i];
        pdm = pdm - pdm / period + plusDM[i];
        mdm = mdm - mdm / period + minusDM[i];
        pushDX();
    }
    if (dx.length < period) return null;
    // ADX = DX 의 Wilder 평활
    let adx = 0;
    for (let i = 0; i < period; i++) adx += dx[i];
    adx /= period;
    for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
    return adx;
}

// VWAP 봉별 시계열 — 거래일(UTC 날짜)별로 누적 리셋. ts(초) 로 일자 경계 감지.
// 일중 VWAP 은 매 세션 0시 리셋이 정석이므로 단순 누적(calcVWAP)과 다름.
export function calcVWAPSeries(q, ts) {
    const { high = [], low = [], close = [], volume = [] } = q;
    const n = close.length;
    const out = new Array(n).fill(null);
    let pv = 0, vol = 0, curDay = null;
    for (let i = 0; i < n; i++) {
        const t = ts && ts[i] ? ts[i] : null;
        // UTC 날짜(일수) 로 세션 경계 — 날짜 바뀌면 누적 리셋
        const day = t != null ? Math.floor(t / 86400) : curDay;
        if (curDay === null) curDay = day;
        else if (day !== curDay) { pv = 0; vol = 0; curDay = day; }
        const h = high[i], l = low[i], c = close[i], v = volume[i];
        if (h == null || l == null || c == null || v == null || v <= 0) { out[i] = vol > 0 ? pv / vol : null; continue; }
        pv += ((h + l + c) / 3) * v;
        vol += v;
        out[i] = vol > 0 ? pv / vol : null;
    }
    return out;
}

// ADX 봉별 시계열 — close 배열과 인덱스 정렬(워밍업 구간 null). 백테스트·봉별 평가용.
export function calcADXSeries(highs, lows, closes, period = 14) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    if (n < period * 2 + 1) return out;
    const tr = [], plusDM = [], minusDM = [], barOf = []; // tr[k] ↔ 봉 (k+1)
    for (let i = 1; i < n; i++) {
        barOf.push(i);
        if (highs[i] == null || lows[i] == null || closes[i-1] == null || highs[i-1] == null || lows[i-1] == null) {
            tr.push(0); plusDM.push(0); minusDM.push(0); continue;
        }
        const up = highs[i] - highs[i-1];
        const down = lows[i-1] - lows[i];
        plusDM.push(up > down && up > 0 ? up : 0);
        minusDM.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
    }
    let atr = 0, pdm = 0, mdm = 0;
    for (let i = 0; i < period; i++) { atr += tr[i]; pdm += plusDM[i]; mdm += minusDM[i]; }
    const dx = [], dxBar = [];
    const pushDX = (k) => {
        const pDI = atr === 0 ? 0 : 100 * pdm / atr;
        const mDI = atr === 0 ? 0 : 100 * mdm / atr;
        const sum = pDI + mDI;
        dx.push(sum === 0 ? 0 : 100 * Math.abs(pDI - mDI) / sum);
        dxBar.push(barOf[k]);
    };
    pushDX(period - 1); // tr[0..period-1] → 봉 period
    for (let k = period; k < tr.length; k++) {
        atr = atr - atr / period + tr[k];
        pdm = pdm - pdm / period + plusDM[k];
        mdm = mdm - mdm / period + minusDM[k];
        pushDX(k);
    }
    if (dx.length < period) return out;
    let adx = 0;
    for (let i = 0; i < period; i++) adx += dx[i];
    adx /= period;
    out[dxBar[period - 1]] = adx;
    for (let j = period; j < dx.length; j++) {
        adx = (adx * (period - 1) + dx[j]) / period;
        out[dxBar[j]] = adx;
    }
    return out;
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
