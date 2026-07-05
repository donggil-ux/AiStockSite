// 성장주 발굴 레이어 — 기관 수급 추세(스냅샷 diff 프록시) + 거래량 누적매수 신호
// 주의: 진짜 13F 기반 실시간 기관 플로우가 아니라 Yahoo 보유비중 스냅샷을 날짜별로 쌓아
// 시점간 차이로 추세를 추정하는 저비용 근사치임 (분기 지연 데이터 기반).
import { yfRequest } from './crumb.js';

// 최근 기관보유비중 스냅샷 2개를 비교해 추세 판정 (growth-fundamentals.js가 매일 스냅샷을 쌓음)
export async function getFlowTrend(env, symbol) {
    const rows = await env.DB.prepare(
        'SELECT snapshot_date, institutions_pct FROM institutional_snapshots WHERE symbol=? ORDER BY snapshot_date DESC LIMIT 2'
    ).bind(symbol).all();
    const r = rows.results || [];
    if (r.length < 2 || r[0].institutions_pct == null || r[1].institutions_pct == null) {
        return { trend: 'unknown', deltaPct: null };
    }
    const delta = +((r[0].institutions_pct - r[1].institutions_pct) * 100).toFixed(2);
    const trend = delta > 0.3 ? 'accumulating' : delta < -0.3 ? 'distributing' : 'flat';
    return { trend, deltaPct: delta };
}

// 일봉 데이터로 거래량 흐름 계산 — 종목당 fetch 1회(range=2mo, interval=1d)
export async function computeVolumeFlow(env, symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2mo&interval=1d`;
        const data = await yfRequest(env.CACHE, url);
        const q = data?.chart?.result?.[0]?.indicators?.quote?.[0];
        const closes = q?.close || [];
        const volumes = q?.volume || [];
        const n = closes.length;
        if (n < 21) return null;

        const vol5 = volumes.slice(-5).filter(v => v != null);
        const vol20 = volumes.slice(-20).filter(v => v != null);
        const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const avgVol5 = avg(vol5), avgVol20 = avg(vol20);
        const volRatio20d = avgVol20 > 0 ? +(avgVol5 / avgVol20).toFixed(2) : 1;

        // 최근 20봉 중 "상승 + 평균 이상 거래량" 일수 = 누적 매수세 근사
        let accDays = 0, obvSum = 0;
        for (let i = n - 20; i < n; i++) {
            if (i <= 0 || closes[i] == null || closes[i - 1] == null || volumes[i] == null) continue;
            const up = closes[i] > closes[i - 1];
            if (up && volumes[i] >= avgVol20) accDays++;
            obvSum += up ? volumes[i] : -volumes[i];
        }
        const obvTrend = obvSum > avgVol20 * 2 ? 'up' : obvSum < -avgVol20 * 2 ? 'down' : 'flat';

        let flowScore = 50 + (volRatio20d - 1) * 20 + (accDays - 10) * 2;
        flowScore = Math.max(0, Math.min(100, Math.round(flowScore)));

        await env.DB.prepare(`
            INSERT INTO volume_flow (symbol,vol_ratio_20d,accumulation_days,obv_trend,flow_score,updated_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(symbol) DO UPDATE SET vol_ratio_20d=excluded.vol_ratio_20d, accumulation_days=excluded.accumulation_days,
              obv_trend=excluded.obv_trend, flow_score=excluded.flow_score, updated_at=excluded.updated_at
        `).bind(symbol, volRatio20d, accDays, obvTrend, flowScore, Date.now()).run();

        return { volRatio20d, accDays, obvTrend, flowScore };
    } catch (e) {
        console.warn('[volume-flow] fail', symbol, e?.message);
        return null;
    }
}
