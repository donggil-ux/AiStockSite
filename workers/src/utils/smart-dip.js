// Smart Dip v3 — 서버 포트 (클라이언트 chart-sync.js `_smartDipV3Filter` 와 동일 방법론)
// 데일리 트레이딩 스캐너의 분석 엔진. 컨플루언스(다중 필터) 품질 점수 기반.
//   buy  = 상승추세 눌림목 진입 (Smart Dip)
//   sell = 하락추세 반등 소진 진입 (Smart Rip — buy 로직의 대칭 반전)
//
// 클라이언트 Smart Dip 이 차트의 여러 봉에 마커를 찍는 것과 동일하게,
// 최근 LOOKBACK 봉을 스캔해 가장 최근의 통과 셋업을 반환한다(장 마감/주말에도 동작).
import { calcEMA, calcRSI, calcATR, calcADX } from './indicators.js';

/**
 * @param {{close,high,low,open,volume}} q   OHLCV 배열
 * @param {object} opts { interval:'5m'|'15m', ts:number[], spxTrendUp:boolean|null, lookback?:number }
 * @returns {object|null} 가장 최근의 통과 셋업. 없으면 null.
 */
export function smartDipScan(q, { interval = '5m', ts = [], spxTrendUp = null, lookback } = {}) {
    const { close = [], high = [], low = [], open = [], volume = [] } = q;
    const N = close.length;
    if (N < 60) return null;            // HTF 추세 비교용 최소 봉수

    // 지표 배열 (전체 1회 계산)
    const ema60  = calcEMA(close, 60);
    const ema120 = calcEMA(close, 120);
    const rsi    = calcRSI(close, 14);
    const atrArr = calcATR(high, low, close, 14);
    // ADX 는 마지막 값만 제공하는 단일 함수 — 최근 lookback 구간엔 동일 ADX 근사 사용
    const adxVal = calcADX(high, low, close, 14) || 0;

    const htfLag = interval === '15m' ? 4 : interval === '30m' ? 2 : 6; // 5m=6
    // 최근 N봉만 스캔 — 신선도 우선 (5m: 3봉=15분 / 15m: 2봉=30분)
    const LB = lookback || (interval === '15m' ? 2 : 3);

    function evalAt(i, dir) {
        const c = close[i];
        if (c == null || ema60[i] == null || ema120[i] == null || atrArr[i] == null) return { pass: false, qs: 0, reasons: [] };
        const reasons = [];
        let qs = 0;

        // 필터 1: ADX 추세강도 (5m EOD 고려 25→20 완화)
        const adx = adxVal;
        if (adx < 20) return { pass: false, qs, reasons };
        qs += adx >= 35 ? 2 : 1;
        reasons.push(`ADX ${adx.toFixed(0)}`);

        // 필터 2: HTF 추세 정렬 (buy=상승 / sell=하락)
        const e60prev  = ema60[Math.max(0, i - htfLag * 5)];
        const e120prev = ema120[Math.max(0, i - htfLag * 10)];
        const htfUp = e60prev != null && e120prev != null && ema60[i] > e60prev && ema120[i] > e120prev;
        const htfDn = e60prev != null && e120prev != null && ema60[i] < e60prev && ema120[i] < e120prev;
        if (dir === 'buy'  && !htfUp) return { pass: false, qs, reasons };
        if (dir === 'sell' && !htfDn) return { pass: false, qs, reasons };
        qs += 2;
        reasons.push(dir === 'buy' ? '상위추세 상승' : '상위추세 하락');

        // 필터 3: 거래량 확인 (Wyckoff)
        const volSlice = volume.slice(Math.max(0, i - 20), i).filter(v => v != null && v > 0);
        const volAvg20 = volSlice.length ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length : 0;
        const volRatio = volAvg20 > 0 ? (volume[i] || 0) / volAvg20 : 1;
        const volPrevR = volAvg20 > 0 ? (volume[i - 1] || 0) / volAvg20 : 1;
        const volRecovery = volPrevR < 1.0 && volRatio > 1.2;
        if (volRatio < 0.8) return { pass: false, qs, reasons };
        if (volRecovery)          { qs += 2; reasons.push(`거래량 회복 ${volRatio.toFixed(1)}x`); }
        else if (volRatio >= 1.2) { qs += 1; reasons.push(`거래량 ${volRatio.toFixed(1)}x`); }

        // 필터 4: 직전 봉 과열 방지 + 현재 봉 방향 확인 (Al Brooks)
        if (i > 0 && open[i - 1] != null && open[i - 1] > 0) {
            const prevMove = ((close[i - 1] - open[i - 1]) / open[i - 1]) * 100;
            if (dir === 'buy'  && prevMove < -3) return { pass: false, qs, reasons };
            if (dir === 'sell' && prevMove >  3) return { pass: false, qs, reasons };
        }
        if (open[i] != null) {
            const bull = close[i] > open[i];
            if (dir === 'buy') {
                if (bull) { qs += 1; reasons.push('양봉 반등'); }
                else return { pass: false, qs, reasons };
            } else {
                if (!bull) { qs += 1; reasons.push('음봉 하락'); }
                else return { pass: false, qs, reasons };
            }
        }

        // 필터 5: ATR 변동성 (과다 차단)
        const atrPct = c > 0 ? ((atrArr[i] || 0) / c) * 100 : 0;
        if (atrPct > 5.0) return { pass: false, qs, reasons };
        if (atrPct >= 1.0 && atrPct <= 3.0) { qs += 1; reasons.push(`ATR ${atrPct.toFixed(1)}%`); }

        // 필터 6: S&P 500 시장 환경
        if (spxTrendUp === true)  { if (dir === 'buy')  { qs += 1; reasons.push('SPX 상승'); } else qs -= 1; }
        if (spxTrendUp === false) { if (dir === 'sell') { qs += 1; reasons.push('SPX 하락'); } else qs -= 1; }

        // 필터 7: RSI 위치 (극단 차단)
        const rsiVal = rsi[i] != null ? rsi[i] : 50;
        if (dir === 'buy'  && rsiVal > 75) return { pass: false, qs, reasons };
        if (dir === 'sell' && rsiVal < 25) return { pass: false, qs, reasons };
        if (dir === 'buy'  && rsiVal >= 40 && rsiVal <= 65) { qs += 1; reasons.push(`RSI ${rsiVal.toFixed(0)}`); }
        if (dir === 'sell' && rsiVal >= 35 && rsiVal <= 60) { qs += 1; reasons.push(`RSI ${rsiVal.toFixed(0)}`); }

        // 필터 8: 장 시작 30분 노이즈 페널티 (미국 장 13:30~14:00 UTC)
        if (ts && ts[i]) {
            const d = new Date(ts[i] * 1000);
            const h = d.getUTCHours(), m = d.getUTCMinutes();
            if ((h === 13 && m >= 30) || (h === 14 && m === 0)) { qs -= 1; }
        }

        const pass = qs >= 5;
        return { pass, qs, reasons, adx, volRatio, atrPct, rsiVal, price: c, barsAgo: N - 1 - i };
    }

    // 최근 LB 봉을 최신순으로 스캔 — 첫 통과(가장 최근) 셋업 반환
    for (let i = N - 1; i >= Math.max(60, N - LB); i--) {
        const buy  = evalAt(i, 'buy');
        const sell = evalAt(i, 'sell');
        let best = null, dir = null;
        if (buy.pass && (!sell.pass || buy.qs >= sell.qs)) { best = buy; dir = 'buy'; }
        else if (sell.pass) { best = sell; dir = 'sell'; }
        if (!best) continue;

        const qs = best.qs;
        const grade = qs >= 8 ? 'S' : qs >= 6 ? 'A' : 'B'; // pass=qs>=5 이므로 최소 B
        const winRate = grade === 'S' ? 78 : grade === 'A' ? 70 : 62;
        return {
            dir,
            grade,
            qualityScore: +qs.toFixed(1),
            winRate,
            adx: +best.adx.toFixed(0),
            volRatio: +best.volRatio.toFixed(1),
            atrPct: +best.atrPct.toFixed(1),
            rsiVal: Math.round(best.rsiVal),
            reasons: best.reasons.slice(0, 4),
            price: best.price,
            barsAgo: best.barsAgo,   // 0=현재봉, n=n봉 전
        };
    }
    return null;
}
