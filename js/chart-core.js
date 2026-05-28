// js/chart-core.js
// 책임: LightweightCharts 초기화, 보조지표 계산 및 렌더링
// 의존: state.js, utils.js

    // Technical Calculations
    // ========================================
    function calcSMA(data, period) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) { result.push(null); continue; }
            let sum = 0, count = 0;
            for (let j = i - period + 1; j <= i; j++) {
                if (data[j] != null) { sum += data[j]; count++; }
            }
            result.push(count > 0 ? sum / count : null);
        }
        return result;
    }

    function calcEMA(data, period) {
        const result = [];
        const k = 2 / (period + 1);
        let ema = null;
        for (let i = 0; i < data.length; i++) {
            if (data[i] == null) { result.push(null); continue; }
            if (ema === null) { ema = data[i]; }
            else { ema = data[i] * k + ema * (1 - k); }
            result.push(ema);
        }
        return result;
    }

    function calcRSI(closes, period = 14) {
        const rsi = [];
        let avgGain = 0, avgLoss = 0;
        for (let i = 0; i < closes.length; i++) {
            if (i === 0 || closes[i] == null || closes[i-1] == null) { rsi.push(null); continue; }
            const change = closes[i] - closes[i-1];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;

            if (i <= period) {
                avgGain += gain;
                avgLoss += loss;
                if (i === period) {
                    avgGain /= period;
                    avgLoss /= period;
                    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                    rsi.push(100 - 100 / (1 + rs));
                } else {
                    rsi.push(null);
                }
            } else {
                avgGain = (avgGain * (period - 1) + gain) / period;
                avgLoss = (avgLoss * (period - 1) + loss) / period;
                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                rsi.push(100 - 100 / (1 + rs));
            }
        }
        return rsi;
    }

    // calcMACD — 표준 MACD(12,26,9) 기본값 유지 + 분봉 최적화용 파라미터 오버라이드
    //   짧은 TF 에서는 더 빠른 응답을 위해 작은 기간 사용 권장
    //     5m  → (5, 13, 4)   15m → (8, 17, 6)   30m → (10, 21, 7)   1h+ → (12, 26, 9)
    function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
        const emaFast = calcEMA(closes, fast);
        const emaSlow = calcEMA(closes, slow);
        const macdLine = emaFast.map((v, i) => (v != null && emaSlow[i] != null) ? v - emaSlow[i] : null);
        // 수정: warm-up 구간 null을 0으로 치환하지 않고 그대로 전달.
        // calcEMA 가 null 을 받으면 seed 시점이 뒤로 밀려 실제 유효 MACD 값부터 EMA 시작.
        const signalLine = calcEMA(macdLine, signal);
        const histogram = macdLine.map((v, i) => (v != null && signalLine[i] != null) ? v - signalLine[i] : null);
        return { macdLine, signalLine, histogram };
    }

    // ── RSI 모멘텀 진단 상수 ──────────────────────────────────────────
    const RSI_PERIOD           = 14;  // RSI 계산 기간
    const DYNAMIC_BAND_LOOKBACK = 50; // 동적 밴드 계산 기준 캔들 수
    const DIVERGENCE_LOOKBACK  = 10;  // 다이버전스 탐지 범위
    const RSI_CENTER_LINE      = 50;  // RSI 중심선
    // RSI 5구간 경계값 (전체 레이블 판정에 통일 적용)
    const RSI_OVERSOLD    = 30;  // 이하: 과매도
    const RSI_WEAK_LOW    = 31;  // ~44: 약세
    const RSI_NEUTRAL_LOW = 45;  // ~55: 중립
    const RSI_STRONG_LOW  = 56;  // ~69: 강세
    const RSI_OVERBOUGHT  = 70;  // 이상: 과매수

    // RSI 5구간 레이블 헬퍼 — [label, signalKey, cssColor] 반환
    function rsiZoneLabel(rsi) {
        if (rsi >= RSI_OVERBOUGHT)  return ['과매수', 'sell',    'var(--red)'];
        if (rsi >= RSI_STRONG_LOW)  return ['강세',   'buy',     'var(--green)'];
        if (rsi >= RSI_NEUTRAL_LOW) return ['중립',   'neutral', 'var(--yellow)'];
        if (rsi >  RSI_OVERSOLD)    return ['약세',   'sell',    'var(--red)'];
        return                             ['과매도', 'buy',     'var(--green)'];
    }

    // ── 단타 손익비 상수 ──────────────────────────────────────────────
    const DAYTRADING_SL_MULTIPLIER = 0.7;   // 손절 ATR 배수 (단타 기준)
    const TP2_ATR_MULTIPLIER       = 2.5;   // TP2 ATR 배수
    const FORCED_SELL_THRESHOLD    = -0.02; // 당일 -2% 이하 시 강제 즉시 청산

    // ── MACD 모멘텀 시그널 분석 (레이너 테오 최적화 전략) ──────────────
    const PULLBACK_THRESHOLD = 0.05;  // 눌림목 허용 범위 ±5%
    const LOOKBACK_CANDLES   = 30;    // 골든크로스 탐색 캔들 수

    function analyzeMACDRayner(closes, volumes) {
        const n = closes.length;
        if (n < 60) return null;

        // 1. 60 EMA
        const ema60 = calcEMA(closes, 60);

        // 2. MACD (Fast=1, Slow=60, Signal=9)
        //    EMA(1) = close 자체이므로: macdLine = close - ema60
        const macdLine   = closes.map((c, i) => ema60[i] != null ? c - ema60[i] : null);
        const signalLine = calcEMA(macdLine.map(v => v ?? 0), 9);
        const histogram  = macdLine.map((v, i) =>
            (v != null && signalLine[i] != null) ? v - signalLine[i] : null);

        // 3. 20일 평균 거래량
        const recentVols = volumes.slice(-20).filter(v => v != null);
        const volAvg20   = recentVols.length
            ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : 0;

        const last     = n - 1;
        const histNow  = histogram[last];
        const histPrev = histogram[last - 1];
        const ema60Now = ema60[last];
        if (histNow == null || histPrev == null || ema60Now == null) return null;

        // 4. 골든크로스 탐색 (최근 LOOKBACK_CANDLES 캔들)
        const searchStart = Math.max(1, n - LOOKBACK_CANDLES);
        let crossIdx = -1;
        for (let i = n - 1; i >= searchStart; i--) {
            if (ema60[i] != null && ema60[i - 1] != null
                    && closes[i - 1] < ema60[i - 1] && closes[i] >= ema60[i]) {
                crossIdx = i;
                break;
            }
        }

        // 5. 매수 조건 판단
        let isBuySignal = false;
        const buyParts  = [];

        if (crossIdx !== -1 && crossIdx < last) {
            // ① 거래량 필터 (골든크로스 캔들)
            const volFilter = volumes[crossIdx] != null && volumes[crossIdx] > volAvg20;

            // ② 눌림목 감지: crossIdx+1 ~ last-1 구간에서 close가 ema60 ±5% 이내
            let pullbackIdx = -1;
            for (let j = crossIdx + 1; j < last; j++) {
                if (ema60[j] == null) continue;
                if (Math.abs(closes[j] - ema60[j]) / ema60[j] <= PULLBACK_THRESHOLD) {
                    pullbackIdx = j;
                    break;
                }
            }

            if (pullbackIdx !== -1) {
                // ③ 재상승 확인: 현재 close > pullback 구간의 local high
                let localHigh = -Infinity;
                for (let j = pullbackIdx; j < last; j++) {
                    if (closes[j] != null) localHigh = Math.max(localHigh, closes[j]);
                }
                const rebound = closes[last] > localHigh;

                // ④ 모멘텀 강화: |hist 현재| > |hist 골든크로스 시점|
                const histCross    = histogram[crossIdx];
                const momentumBoost = histCross != null
                    && Math.abs(histNow) > Math.abs(histCross);

                isBuySignal = volFilter && rebound && momentumBoost;
                if (isBuySignal) {
                    buyParts.push('60 EMA 돌파 후 눌림목 지지 확인');
                    buyParts.push('거래량 동반 상승');
                    buyParts.push('재상승 완료 및 MACD 모멘텀 강화로 매수 시그널 발생.');
                }
            }
        }

        // 6. 매도 조건 (매수 시그널 없을 때만)
        const isSellSignal = !isBuySignal
            && Math.abs(histNow) < Math.abs(histPrev);

        // 7. 모멘텀 상태
        let currentMomentum;
        const absNow  = Math.abs(histNow);
        const absPrev = Math.abs(histPrev);
        if (absNow > absPrev)      currentMomentum = '강화';
        else if (absNow < absPrev) currentMomentum = '약화';
        else                        currentMomentum = '중립';

        // 8. reason
        let reason;
        if (isBuySignal) {
            reason = buyParts.join(', ');
            if (!reason.endsWith('.')) reason += '.';
        } else if (isSellSignal) {
            reason = 'MACD 히스토그램 모멘텀 약화. 보유 포지션 청산 또는 관망 권장.';
        } else if (crossIdx !== -1) {
            reason = `최근 ${LOOKBACK_CANDLES}캔들 내 60 EMA 골든크로스 감지. 눌림목 또는 재상승 조건 미충족 — 추세 진행 중 대기.`;
        } else {
            reason = `최근 ${LOOKBACK_CANDLES}캔들 내 60 EMA 돌파 없음. 현재 관망 구간.`;
        }

        return {
            isBuySignal,
            isSellSignal,
            currentMomentum,
            reason,
            chartData: { macdHistogram: histNow, ema60: ema60Now },
        };
    }

    // ── RSI 모멘텀 진단 (동적 밴드 + 다이버전스) ──────────────────────
    function analyzeRSIDynamic(closes, highs, lows) {
        const n = closes.length;
        const minLen = RSI_PERIOD + DYNAMIC_BAND_LOOKBACK;
        if (n < minLen) return null;

        // 1. RSI(14) — 기존 calcRSI() 재사용
        const rsiArr = calcRSI(closes, RSI_PERIOD);
        const validRSI = rsiArr.filter(v => v != null);
        if (validRSI.length < DYNAMIC_BAND_LOOKBACK) return null;

        const currentRSI = rsiArr[n - 1];
        if (currentRSI == null) return null;

        // 2. 동적 밴드 — 최근 DYNAMIC_BAND_LOOKBACK개 RSI 값, 오름차순 정렬
        const recentRSI = rsiArr.slice(-DYNAMIC_BAND_LOOKBACK).filter(v => v != null);
        const sorted = [...recentRSI].sort((a, b) => a - b);
        const upperIdx = Math.floor(sorted.length * 0.8);
        const lowerIdx = Math.floor(sorted.length * 0.2);
        const dynamicUpperBand = sorted[upperIdx] ?? 70;
        const dynamicLowerBand = sorted[lowerIdx] ?? 30;

        // 3. 다이버전스 감지 (최근 DIVERGENCE_LOOKBACK 캔들)
        const dStart = n - DIVERGENCE_LOOKBACK;
        const prevLow  = Math.min(...lows.slice(dStart, n - 1).filter(v => v != null));
        const prevHigh = Math.max(...highs.slice(dStart, n - 1).filter(v => v != null));
        const prevRSILow  = Math.min(...rsiArr.slice(dStart, n - 1).filter(v => v != null));
        const prevRSIHigh = Math.max(...rsiArr.slice(dStart, n - 1).filter(v => v != null));
        const curLow  = lows[n - 1];
        const curHigh = highs[n - 1];

        let divergenceType = '없음';
        if (curLow < prevLow && currentRSI > prevRSILow) {
            divergenceType = '상승'; // 가격 저점↓, RSI 저점↑
        } else if (curHigh > prevHigh && currentRSI < prevRSIHigh) {
            divergenceType = '하락'; // 가격 고점↑, RSI 고점↓
        }

        // 4. 중심선 위치 (기준: >55 상단 / <45 하단 / 나머지 중립)
        let centerLinePosition;
        if (currentRSI > 55)      centerLinePosition = '상단';
        else if (currentRSI < 45) centerLinePosition = '하단';
        else                       centerLinePosition = '중립';

        // 5. RSI 구간
        let rsiZone;
        if (currentRSI >= dynamicUpperBand)     rsiZone = '과매수';
        else if (currentRSI <= dynamicLowerBand) rsiZone = '과매도';
        else                                      rsiZone = '중립구간';

        // 6. 시그널 판단
        const prevRSI = rsiArr[n - 2] ?? currentRSI;
        // 동적 하단 밴드 상향 돌파: 이전 캔들 ≤ lowerBand AND 현재 캔들 > lowerBand
        const lowerBandBreakout = prevRSI <= dynamicLowerBand && currentRSI > dynamicLowerBand;
        // 동적 상단 밴드 하향 이탈: 이전 캔들 ≥ upperBand AND 현재 캔들 < upperBand
        const upperBandBreakdown = prevRSI >= dynamicUpperBand && currentRSI < dynamicUpperBand;

        const isBuySignal =
            (divergenceType === '상승' && centerLinePosition === '상단') ||
            lowerBandBreakout;

        const isSellSignal = !isBuySignal && (
            (divergenceType === '하락' && centerLinePosition === '하단') ||
            upperBandBreakdown
        );

        // 7. reason
        let reason;
        if (isBuySignal) {
            reason = `RSI ${currentRSI.toFixed(1)}, ${divergenceType !== '없음' ? divergenceType + ' 다이버전스 감지. ' : ''}동적 하단 밴드(${dynamicLowerBand.toFixed(1)}) 반등으로 매수 시그널.`;
        } else if (isSellSignal) {
            reason = `RSI ${currentRSI.toFixed(1)}, 동적 상단 밴드(${dynamicUpperBand.toFixed(1)}) 근접 및 하락 다이버전스 감지. 익절 또는 관망 권장.`;
        } else {
            reason = `RSI ${currentRSI.toFixed(1)}, 뚜렷한 시그널 없음. 중심선(${RSI_CENTER_LINE}) 돌파 여부를 추가 관찰하세요.`;
        }

        return {
            isBuySignal,
            isSellSignal,
            currentRSI,
            dynamicUpperBand,
            dynamicLowerBand,
            centerLinePosition,
            divergenceType,
            rsiZone,
            reason,
        };
    }

    function calcBollingerBands(closes, period = 4, mult = 2) {
        const sma = calcSMA(closes, period);
        const upper = [], lower = [];
        for (let i = 0; i < closes.length; i++) {
            if (sma[i] == null) { upper.push(null); lower.push(null); continue; }
            let sumSq = 0, count = 0;
            for (let j = i - period + 1; j <= i; j++) {
                if (closes[j] != null) { sumSq += Math.pow(closes[j] - sma[i], 2); count++; }
            }
            const std = Math.sqrt(sumSq / count);
            upper.push(sma[i] + mult * std);
            lower.push(sma[i] - mult * std);
        }
        return { upper, middle: sma, lower };
    }

    // Stochastic Oscillator (%K, %D)
    function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
        const kLine = [], dLine = [];
        for (let i = 0; i < closes.length; i++) {
            if (i < kPeriod - 1) { kLine.push(null); continue; }
            let hh = -Infinity, ll = Infinity;
            for (let j = i - kPeriod + 1; j <= i; j++) {
                if (highs[j] != null) hh = Math.max(hh, highs[j]);
                if (lows[j] != null) ll = Math.min(ll, lows[j]);
            }
            const k = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
            kLine.push(k);
        }
        for (let i = 0; i < kLine.length; i++) {
            if (i < kPeriod - 1 + dPeriod - 1 || kLine[i] == null) { dLine.push(null); continue; }
            let sum = 0, cnt = 0;
            for (let j = i - dPeriod + 1; j <= i; j++) {
                if (kLine[j] != null) { sum += kLine[j]; cnt++; }
            }
            dLine.push(cnt > 0 ? sum / cnt : null);
        }
        return { kLine, dLine };
    }

    // OBV (On Balance Volume)
    function calcOBV(closes, volumes) {
        const obv = [0];
        for (let i = 1; i < closes.length; i++) {
            if (closes[i] == null || closes[i-1] == null || volumes[i] == null) {
                obv.push(obv[obv.length-1]); continue;
            }
            if (closes[i] > closes[i-1]) obv.push(obv[obv.length-1] + volumes[i]);
            else if (closes[i] < closes[i-1]) obv.push(obv[obv.length-1] - volumes[i]);
            else obv.push(obv[obv.length-1]);
        }
        return obv;
    }

    // ── 불리시 다이버전스 탐지 ─────────────────────────────────────────────────
    function detectBullishDivergence(closes, rsiArr, lookback = 40) {
        const result = { detected: false, rsiDiff: 0 };
        if (!closes || !rsiArr || closes.length < lookback + 4) return result;
        const len = closes.length;
        const start = Math.max(2, len - lookback);
        const minima = [];
        for (let i = start; i < len - 2; i++) {
            if (closes[i] == null || rsiArr[i] == null) continue;
            if (closes[i] < closes[i-1] && closes[i] < closes[i-2] &&
                closes[i] < closes[i+1] && closes[i] < closes[i+2]) {
                minima.push({ price: closes[i], rsi: rsiArr[i] });
            }
        }
        if (minima.length < 2) return result;
        const m1 = minima[minima.length - 2]; // 이전 저점
        const m2 = minima[minima.length - 1]; // 최근 저점
        if (m2.price < m1.price && m2.rsi > m1.rsi) {
            result.detected = true;
            result.rsiDiff = m2.rsi - m1.rsi;
        }
        return result;
    }

    // ── OBV 패닉 투매 감지 ──────────────────────────────────────────────────────
    function _detectOBVPanic(obvArr, volumes, closes, period = 10) {
        const result = { panicSell: false, obvDeclining: false, volSpike: false };
        if (!obvArr || obvArr.length < period + 2) return result;
        const len = obvArr.length;
        const half = Math.floor(period / 2);
        const obvRecent  = obvArr.slice(len - half).reduce((a,b) => a+b, 0) / half;
        const obvEarlier = obvArr.slice(len - period, len - half).reduce((a,b) => a+b, 0) / half;
        result.obvDeclining = obvRecent < obvEarlier;
        const volSlice = volumes.slice(-period - 1, -1).filter(v => v != null);
        if (volSlice.length > 0) {
            const avgVol = volSlice.reduce((a,b) => a+b, 0) / volSlice.length;
            const lastVol = volumes[volumes.length - 1];
            result.volSpike = lastVol != null && lastVol > avgVol * 1.8;
        }
        result.panicSell = result.obvDeclining && result.volSpike;
        return result;
    }

    // ADX (Average Directional Index) — null-safe directional movement + tracked prev ADX
    function calcADX(highs, lows, closes, period = 14) {
        const pDI = [], mDI = [], adx = [];
        const trList = [], pDMList = [], mDMList = [];
        let prevAdx = null;
        for (let i = 0; i < closes.length; i++) {
            if (i === 0 || highs[i]==null || lows[i]==null || closes[i-1]==null
                || highs[i-1]==null || lows[i-1]==null) {
                trList.push(null); pDMList.push(null); mDMList.push(null);
                pDI.push(null); mDI.push(null); adx.push(null);
                continue;
            }
            const tr = Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
            const upMove = highs[i] - highs[i-1];
            const downMove = lows[i-1] - lows[i];
            trList.push(tr);
            pDMList.push(upMove > downMove && upMove > 0 ? upMove : 0);
            mDMList.push(downMove > upMove && downMove > 0 ? downMove : 0);
            if (i < period) { pDI.push(null); mDI.push(null); adx.push(null); continue; }
            const smoothTR = (trList.slice(i-period+1,i+1).reduce((a,b)=>a+(b||0),0));
            const p = smoothTR===0?0:(pDMList.slice(i-period+1,i+1).reduce((a,b)=>a+(b||0),0)/smoothTR)*100;
            const m = smoothTR===0?0:(mDMList.slice(i-period+1,i+1).reduce((a,b)=>a+(b||0),0)/smoothTR)*100;
            pDI.push(p); mDI.push(m);
            const dx = (p+m)===0?0:Math.abs(p-m)/(p+m)*100;
            if (prevAdx == null) { prevAdx = dx; adx.push(dx); }
            else { prevAdx = (prevAdx*(period-1)+dx)/period; adx.push(prevAdx); }
        }
        return { pDI, mDI, adx };
    }

    // VWAP (Volume Weighted Average Price)
    function calcVWAP(highs, lows, closes, volumes) {
        const vwap = [];
        let cumVol = 0, cumTP = 0;
        for (let i = 0; i < closes.length; i++) {
            if (closes[i]==null||highs[i]==null||lows[i]==null||volumes[i]==null) { vwap.push(null); continue; }
            const tp = (highs[i]+lows[i]+closes[i])/3;
            cumTP += tp * volumes[i];
            cumVol += volumes[i];
            vwap.push(cumVol > 0 ? cumTP/cumVol : null);
        }
        return vwap;
    }

    // VWAP — 세션(ET 날짜) 기준 리셋 + ±1σ 밴드
    // 반환: { vwap, upper, lower, sessionIdx }
    // sessionIdx[i] = i 번째 봉이 속한 세션의 시작 인덱스 (같은 세션이면 동일 값)
    function calcVWAPSession(highs, lows, closes, volumes, timestamps) {
        const N = closes.length;
        const vwap = new Array(N).fill(null);
        const upper = new Array(N).fill(null);
        const lower = new Array(N).fill(null);
        const sessionIdx = new Array(N).fill(0);
        if (!timestamps || timestamps.length !== N) return { vwap, upper, lower, sessionIdx };

        const etDateOf = ts => {
            try { return new Date(ts * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' }); }
            catch (e) { return new Date(ts * 1000).toISOString().slice(0, 10); }
        };

        let cumVol = 0, cumTPV = 0, cumTP2V = 0;
        let sessionStart = 0;
        let prevDate = null;
        for (let i = 0; i < N; i++) {
            const h = highs[i], l = lows[i], c = closes[i], v = volumes[i], ts = timestamps[i];
            if (h == null || l == null || c == null || v == null || ts == null) {
                sessionIdx[i] = sessionStart;
                continue;
            }
            const curDate = etDateOf(ts);
            if (prevDate !== null && curDate !== prevDate) {
                // 새 세션 시작 → 누적값 리셋
                cumVol = 0; cumTPV = 0; cumTP2V = 0;
                sessionStart = i;
            }
            const tp = (h + l + c) / 3;
            cumTPV += tp * v;
            cumTP2V += tp * tp * v;
            cumVol += v;
            if (cumVol > 0) {
                const vw = cumTPV / cumVol;
                vwap[i] = vw;
                const variance = Math.max(0, (cumTP2V / cumVol) - (vw * vw));
                const std = Math.sqrt(variance);
                upper[i] = vw + std;
                lower[i] = vw - std;
            }
            sessionIdx[i] = sessionStart;
            prevDate = curDate;
        }
        return { vwap, upper, lower, sessionIdx };
    }

    // ET 시간대 헬퍼 (HH:MM 반환)
    function _etTimeHHMM(ts) {
        try {
            const s = new Date(ts * 1000).toLocaleTimeString('en-US', {
                timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
            });
            return s.replace(/^24/, '00');
        } catch (e) { return ''; }
    }
    function _etMinutesOfDay(ts) {
        const t = _etTimeHHMM(ts);
        const m = t.match(/^(\d{2}):(\d{2})/);
        if (!m) return -1;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }

    // ATR (Average True Range) — Wilder smoothing with tracked prev (O(N), not O(N²))
    // 초기 [5 ~ period) 구간은 단순 TR 평균으로 조기 ATR 제공 (5분봉 장 초반 손절선 빠른 표시 목적).
    // i >= period 부터는 기존 Wilder EMA 평활 유지.
    function calcATR(highs, lows, closes, period = 14) {
        const tr = [], atr = [];
        let prevAtr = null;
        for (let i = 0; i < closes.length; i++) {
            if (i===0||highs[i]==null||lows[i]==null||closes[i-1]==null) { tr.push(null); atr.push(null); continue; }
            tr.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
            if (i < period) {
                if (i < 5) { atr.push(null); continue; }
                // 초기 단순 평균 — 가용한 TR(non-null) 들의 평균
                let sum = 0, cnt = 0;
                for (let j = 0; j <= i; j++) { if (tr[j] != null) { sum += tr[j]; cnt++; } }
                atr.push(cnt > 0 ? sum / cnt : null);
                continue;
            }
            if (prevAtr == null) {
                let sum=0; for(let j=i-period+1;j<=i;j++) sum+=(tr[j]||0);
                prevAtr = sum/period;
                atr.push(prevAtr);
            } else {
                prevAtr = (prevAtr*(period-1)+(tr[i]||0))/period;
                atr.push(prevAtr);
            }
        }
        return atr;
    }

    // ========================================
    // Rayner Teo — Stage Analysis / 캔들 패턴 / 진입 전략
    // ========================================
    function _detectMarketStage(closes, ema200, ema50) {
        const N = closes.length;
        if (N < 20) return null;
        const lastIdx = (() => { for (let i = N-1; i >= 0; i--) if (closes[i]!=null && ema200[i]!=null && ema50[i]!=null) return i; return -1; })();
        if (lastIdx < 0) return null;
        const lastClose = closes[lastIdx], last200 = ema200[lastIdx], last50 = ema50[lastIdx];
        const back200 = Math.max(0, lastIdx - 20), back50 = Math.max(0, lastIdx - 10);
        const prev200 = ema200[back200] ?? last200;
        const prev50  = ema50[back50] ?? last50;
        const slope200 = (last200 - prev200) / Math.abs(prev200) * 100;
        const slope50  = (last50 - prev50) / Math.abs(prev50) * 100;
        const pctAbove200 = (lastClose - last200) / last200 * 100;
        const recentSlice = closes.slice(Math.max(0, lastIdx - 60), lastIdx + 1).filter(v => v != null);
        const recentHigh = recentSlice.length ? Math.max(...recentSlice) : lastClose;
        const drawdownPct = (recentHigh - lastClose) / recentHigh * 100;
        if (pctAbove200 > 2 && slope50 > 0.3)
            return { stage: 2, label: '상승 추세', desc: '가격이 200 EMA 위 + 50 EMA 우상향. 풀백 매수 구간.', color: '#22c55e', slope200, slope50, pctAbove200 };
        if (pctAbove200 < -2 && slope50 < -0.3)
            return { stage: 4, label: '하락 추세', desc: '가격이 200 EMA 아래 + 50 EMA 우하향. 매수 금지.', color: '#ef4444', slope200, slope50, pctAbove200 };
        if (pctAbove200 > 0 && Math.abs(slope200) < 0.5 && drawdownPct > 5)
            return { stage: 3, label: '분배 (주의)', desc: '고점 대비 하락 + 200 EMA 횡보. 분배 가능성.', color: '#f97316', slope200, slope50, pctAbove200, drawdownPct };
        return { stage: 1, label: '횡보 (관망)', desc: '200 EMA 횡보 + 가격 근접. 추세 형성 대기.', color: '#94a3b8', slope200, slope50, pctAbove200 };
    }

    // 캔들 패턴 — 최근 N봉 스캔 (해머·슈팅스타·인게이징·도지)
    function _detectCandlePatterns(o, h, l, c, lookback = 5) {
        const N = c.length;
        if (N < 2) return [];
        const out = [];
        for (let i = Math.max(1, N - lookback); i < N; i++) {
            if (o[i]==null || h[i]==null || l[i]==null || c[i]==null) continue;
            const open = o[i], close = c[i], high = h[i], low = l[i];
            const range = high - low; if (range <= 0) continue;
            const body = Math.abs(close - open);
            const upperShadow = high - Math.max(open, close);
            const lowerShadow = Math.min(open, close) - low;
            const bodyRatio = body / range;
            if (bodyRatio < 0.1) { out.push({ idx: i, type: 'doji', label: '도지', dir: 'neutral', desc: '추세 전환 경고' }); continue; }
            if (lowerShadow >= 2 * body && upperShadow <= body * 0.6 && bodyRatio > 0.12) {
                out.push({ idx: i, type: 'hammer', label: '해머', dir: 'bull', desc: '지지 근처 반전 신호' }); continue;
            }
            if (upperShadow >= 2 * body && lowerShadow <= body * 0.6 && bodyRatio > 0.12) {
                out.push({ idx: i, type: 'shooting_star', label: '슈팅스타', dir: 'bear', desc: '저항 근처 하락 신호' }); continue;
            }
            if (i >= 1 && o[i-1]!=null && c[i-1]!=null) {
                const po = o[i-1], pc = c[i-1];
                const prevBull = pc > po, curBull = close > open;
                if (!prevBull && curBull && open <= pc && close >= po) {
                    out.push({ idx: i, type: 'bull_engulf', label: '강세 인게이징', dir: 'bull', desc: '매수 신호' }); continue;
                }
                if (prevBull && !curBull && open >= pc && close <= po) {
                    out.push({ idx: i, type: 'bear_engulf', label: '약세 인게이징', dir: 'bear', desc: '매도 신호' }); continue;
                }
            }
        }
        return out;
    }

    // 진입 전략 — 풀백 / 브레이크아웃 / 반전
    function _detectRaynerEntries(stageInfo, closes, volumes, ema20, ema50, ema200, ts) {
        if (!stageInfo) return [];
        const out = [];
        const N = closes.length;
        if (N < 25) return out;
        const startI = Math.max(20, N - 30);
        for (let i = startI; i < N; i++) {
            const c = closes[i];
            if (c == null || ema20[i]==null || ema50[i]==null || ema200[i]==null) continue;
            // 1) 풀백 — Stage 2 + 20·50 EMA 근접
            if (stageInfo.stage === 2) {
                const d20 = Math.abs(c - ema20[i]) / c * 100;
                const d50 = Math.abs(c - ema50[i]) / c * 100;
                if (d20 < 1.0 || d50 < 1.5) out.push({ time: ts[i], idx: i, type: 'pullback', label: '풀백 진입', color: '#22c55e' });
            }
            // 2) 브레이크아웃 — 20봉 고점 돌파 + 거래량 1.5배
            if (i >= 20) {
                const lookback = closes.slice(i - 20, i).filter(v => v != null);
                if (lookback.length === 20) {
                    const prevHigh = Math.max(...lookback);
                    const vol = volumes[i] || 0;
                    const avgVol = volumes.slice(i - 20, i).reduce((s, v) => s + (v||0), 0) / 20;
                    if (c > prevHigh * 1.005 && avgVol > 0 && vol > avgVol * 1.5) {
                        out.push({ time: ts[i], idx: i, type: 'breakout', label: '브레이크아웃', color: '#eab308' });
                    }
                }
            }
            // 3) 반전 — Stage 4 + 200 EMA 상향 돌파
            if (stageInfo.stage === 4 && i >= 1 && closes[i-1]!=null && ema200[i-1]!=null) {
                if (closes[i-1] < ema200[i-1] && c > ema200[i]) {
                    out.push({ time: ts[i], idx: i, type: 'reversal', label: '반전 가능', color: '#3b82f6' });
                }
            }
        }
        // 동일 봉에 여러 시그널 있으면 우선순위 (pullback > breakout > reversal)
        const seen = new Set();
        const priority = { pullback: 1, breakout: 2, reversal: 3 };
        return out.sort((a, b) => priority[a.type] - priority[b.type])
                  .filter(e => { const k = e.time + ':' + e.type; if (seen.has(k)) return false; seen.add(k); return true; });
    }

    // ========================================
    // Volume Profile & Resistance Detection
    // ========================================
    function calcVolumeProfile(closes, volumes, period, buckets = 20) {
        const n = Math.min(period, closes.length, volumes.length);
        const s = closes.slice(-n), v = volumes.slice(-n);
        const lo = Math.min(...s), hi = Math.max(...s);
        if (hi === lo) return [{ priceCenter: hi, volume: v.reduce((a,b)=>a+b, 0) }];
        const bsz = (hi - lo) / buckets;
        const profile = Array.from({length: buckets}, (_, i) => ({
            priceCenter: lo + (i + 0.5) * bsz, volume: 0
        }));
        for (let i = 0; i < s.length; i++) {
            const idx = Math.min(Math.floor((s[i] - lo) / bsz), buckets - 1);
            profile[idx].volume += (v[i] || 0);
        }
        return profile;
    }

    function findResistanceLevels(profile, currentPrice) {
        const above = profile.filter(b => b.priceCenter > currentPrice);
        if (!above.length) return [];
        const peaks = above.filter((b, i, arr) => {
            const prev = arr[i-1] ? arr[i-1].volume : 0;
            const next = arr[i+1] ? arr[i+1].volume : 0;
            return b.volume >= prev && b.volume >= next && b.volume > 0;
        });
        const pool = peaks.length ? peaks : [...above].sort((a,b)=>b.volume-a.volume).slice(0,2);
        return pool.sort((a,b)=>a.priceCenter-b.priceCenter).slice(0,2).map(b=>b.priceCenter);
    }

    // CCI (Commodity Channel Index)
    function calcCCI(highs, lows, closes, period = 20) {
        const cci = [];
        for (let i = 0; i < closes.length; i++) {
            if (i < period-1||closes[i]==null) { cci.push(null); continue; }
            const tps = [];
            for (let j=i-period+1;j<=i;j++) {
                if(highs[j]!=null&&lows[j]!=null&&closes[j]!=null) tps.push((highs[j]+lows[j]+closes[j])/3);
            }
            if (tps.length < period) { cci.push(null); continue; }
            const mean = tps.reduce((a,b)=>a+b,0)/tps.length;
            const md = tps.reduce((a,b)=>a+Math.abs(b-mean),0)/tps.length;
            const tp = (highs[i]+lows[i]+closes[i])/3;
            cci.push(md===0 ? 0 : (tp-mean)/(0.015*md));
        }
        return cci;
    }

    // Williams %R
    function calcWilliamsR(highs, lows, closes, period = 14) {
        const wr = [];
        for (let i = 0; i < closes.length; i++) {
            if (i < period-1) { wr.push(null); continue; }
            let hh = -Infinity, ll = Infinity;
            for (let j=i-period+1;j<=i;j++) {
                if(highs[j]!=null) hh=Math.max(hh,highs[j]);
                if(lows[j]!=null) ll=Math.min(ll,lows[j]);
            }
            wr.push(hh===ll ? -50 : ((hh-closes[i])/(hh-ll))*-100);
        }
        return wr;
    }

    // MFI (Money Flow Index)
    function calcMFI(highs, lows, closes, volumes, period = 14) {
        const mfi = [];
        const tps = closes.map((c,i) => (highs[i]!=null&&lows[i]!=null&&c!=null) ? (highs[i]+lows[i]+c)/3 : null);
        for (let i = 0; i < closes.length; i++) {
            if (i < period) { mfi.push(null); continue; }
            let posFlow=0, negFlow=0;
            for (let j=i-period+1;j<=i;j++) {
                if(tps[j]==null||tps[j-1]==null||volumes[j]==null) continue;
                const mf = tps[j]*volumes[j];
                if(tps[j]>tps[j-1]) posFlow+=mf; else negFlow+=mf;
            }
            const ratio = negFlow===0 ? 100 : posFlow/negFlow;
            mfi.push(100 - 100/(1+ratio));
        }
        return mfi;
    }

    // ========================================
    // Render Price Chart (Lightweight Charts)
    function toggleChartFullscreen() {
        const card = document.getElementById('tvChartCard');
        const iconExpand = document.getElementById('tvFsIconExpand');
        const iconShrink = document.getElementById('tvFsIconShrink');
        card.classList.toggle('fullscreen');
        const isFull = card.classList.contains('fullscreen');
        iconExpand.style.display = isFull ? 'none' : '';
        iconShrink.style.display = isFull ? '' : 'none';
        const lbl = document.getElementById('tvFsLabel');
        if (lbl) lbl.textContent = isFull ? '작게보기' : '크게보기';
        const btn = document.getElementById('cxtFullscreen');
        if (btn) btn.title = isFull ? '작게보기' : '크게보기';
        document.body.style.overflow = isFull ? 'hidden' : '';
        // 전체화면 상태 저장
        localStorage.setItem('stockai_chart_fullscreen', isFull ? '1' : '0');

        // 전체화면 진입/해제 시 플로팅 UI 요소 숨김/복원
        // (alertFab z-index=9200, alpacaWsBadge z-index=8000 이 차트 위로 뚫고 나오는 버그 방지)
        document.body.classList.toggle('chart-fs-active', isFull);

        // 전체화면 전환 시 차트 리사이즈 (CSS transition 완료 대기 후 재계산)
        if (lwChart) {
            setTimeout(() => {
                const wrap = document.getElementById('tvChartWrap');
                if (!wrap || !lwChart) return;
                let h, w;
                if (isFull) {
                    // 전체화면: 툴바 높이를 제외한 window 전체 높이 사용
                    const toolbarEl = document.getElementById('chartToolbar') ||
                                      card.querySelector('.chart-toolbar, #tvChartToolbar');
                    const toolbarH = toolbarEl ? toolbarEl.offsetHeight : 0;
                    h = Math.max(300, window.innerHeight - toolbarH);
                    w = window.innerWidth;
                } else {
                    // 일반: wrap 실제 크기 (flex 레이아웃 기준)
                    h = wrap.clientHeight || 500;
                    w = wrap.clientWidth;
                }
                lwChart.applyOptions({ width: w, height: h });
            }, 360);
        }
    }

    // ══════════════════════════════════════════════════════════
    // 차트 우상단 floating toolbar (영역 1) 핸들러
    // ══════════════════════════════════════════════════════════

    /** 인디케이터 dropdown 열기 — 기존 analysis dd 활용 */
    function _ctrOpenAnalysis(ev) {
        if (ev) ev.stopPropagation();
        if (typeof _toggleAnalysisDd === 'function') {
            const btn = document.getElementById('analysisDdBtn');
            if (btn) { btn.click(); return; }
            _toggleAnalysisDd(ev);
        }
    }

    /** 가격 라인 dropdown 열기 — 기존 line dd 활용 */
    function _ctrOpenLine(ev) {
        if (ev) ev.stopPropagation();
        if (typeof _toggleLineDd === 'function') {
            const btn = document.getElementById('lineDdBtn');
            if (btn) { btn.click(); return; }
            _toggleLineDd(ev);
        }
    }

    /** PNG 캡쳐 (다운로드 전용 — AI 분석으로 보내지 않음) */
    function _ctrCapturePng() {
        try {
            const wrap = document.getElementById('tvChartWrap');
            if (!wrap) { showToast?.('차트를 찾을 수 없어요'); return; }
            const canvases = Array.from(wrap.querySelectorAll('canvas')).filter(c => c.id !== 'drawCanvas');
            if (!canvases.length) { showToast?.('차트가 준비되지 않았어요'); return; }
            const W = canvases[0].width, H = canvases.reduce((s, c) => Math.max(s, c.height), 0);
            const off = document.createElement('canvas');
            off.width = W; off.height = H;
            const ctx = off.getContext('2d');
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            ctx.fillStyle = isLight ? '#ffffff' : '#111620';
            ctx.fillRect(0, 0, W, H);
            canvases.forEach(c => { try { ctx.drawImage(c, 0, 0); } catch(e) {} });
            off.toBlob(blob => {
                if (!blob) { showToast?.('캡쳐 실패'); return; }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const sym = (typeof currentSymbol === 'string' ? currentSymbol : 'chart').toUpperCase();
                const ts = new Date().toISOString().slice(0,19).replace(/[:T-]/g,'').slice(0,15);
                a.href = url; a.download = `${sym}_${ts}.png`;
                document.body.appendChild(a); a.click();
                setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
                showToast?.('차트 PNG 저장됨');
            }, 'image/png');
        } catch (e) {
            warn('[capturePng]', e);
            showToast?.('캡쳐 중 오류');
        }
    }

    /** 설정 — 향후 패널 진입점, 현재는 상태 안내 */
    function _ctrSettings() {
        if (typeof showToast === 'function') showToast('⚙ 설정 패널 준비중');
    }

    // ══════════════════════════════════════════════════════════
    // 차트 하단 nav bar (영역 3) — zoom / pan / reset
    // ══════════════════════════════════════════════════════════

    function _cnbGetTimeScale() {
        try { return (window.lwChart || null)?.timeScale?.() || null; } catch(_) { return null; }
    }

    /** factor < 1 = 확대, factor > 1 = 축소 (logical range 폭 조절) */
    function _cnbZoom(factor) {
        const ts = _cnbGetTimeScale();
        if (!ts) return;
        try {
            const r = ts.getVisibleLogicalRange();
            if (!r) return;
            const mid = (r.from + r.to) / 2;
            const halfWidth = (r.to - r.from) / 2 * factor;
            const newWidth = Math.max(5, halfWidth); // 최소 10봉
            if (typeof _cnbDeactivatePreset === 'function') _cnbDeactivatePreset();
            _cnbProgrammaticRangeChange = true;
            ts.setVisibleLogicalRange({ from: mid - newWidth, to: mid + newWidth });
            setTimeout(() => { _cnbProgrammaticRangeChange = false; }, 200);
        } catch(e) { warn('[cnbZoom]', e); }
    }

    /** delta 봉수만큼 좌/우 이동 (음수=과거, 양수=최신) */
    function _cnbPan(delta) {
        const ts = _cnbGetTimeScale();
        if (!ts) return;
        try {
            const r = ts.getVisibleLogicalRange();
            if (!r) return;
            if (typeof _cnbDeactivatePreset === 'function') _cnbDeactivatePreset();
            _cnbProgrammaticRangeChange = true;
            ts.setVisibleLogicalRange({ from: r.from + delta, to: r.to + delta });
            setTimeout(() => { _cnbProgrammaticRangeChange = false; }, 200);
        } catch(e) { warn('[cnbPan]', e); }
    }

    /** 줌·스크롤 리셋 — 활성 프리셋 있으면 그 범위로, 없으면 fitContent */
    function _cnbReset() {
        if (_activePreset && _CHART_PRESETS[_activePreset]) {
            _cnbSetPreset(_activePreset);
            return;
        }
        const ts = _cnbGetTimeScale();
        if (!ts) return;
        try { ts.fitContent(); } catch(e) { warn('[cnbReset]', e); }
    }

    // ══════════════════════════════════════════════════════════