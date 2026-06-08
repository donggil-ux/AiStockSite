// 카탈리스트 스캐너 실전 forward-test — 점수 예측력 검증
//   captureCatalystSignals: 카탈리스트 상위 후보를 dt 와 동일하게 D1 기록 (종목당 1일 1회)
//   resolveCatalystSignals: 1일/3일 후 실제 수익률 기록 (점수↑ → 수익↑ 인가)
//   handleCatalystLiveStats: 등급(점수 버킷)별 평균 수익률·상승확률
// 카탈리스트 본체는 server.js(Vercel) 에 있어 HTTP 로 결과를 받아온다.
import { json, err } from '../utils/validators.js';
import { yfRequest } from '../utils/crumb.js';
import { logError } from '../utils/errors.js';

// 카탈리스트 엔드포인트 (Vercel 프로덕션). env.SITE_URL 로 오버라이드 가능.
function catalystUrl(env) {
    const base = (env && env.SITE_URL) || 'https://stock-site-rkd687-6555s-projects.vercel.app';
    return `${base.replace(/\/$/, '')}/api/catalyst/hunter`;
}

// 점수 → 버킷 (server.js grade 기준과 동일)
function scoreBucket(score) {
    if (score >= 75) return 'urgent';   // 🚨 긴급
    if (score >= 55) return 'strong';   // 🔴 강한
    if (score >= 35) return 'watch';    // 🟠 관심
    return 'weak';                      // ⚪ 약한
}

export async function captureCatalystSignals(env) {
    let logged = 0;
    try {
        const resp = await fetch(catalystUrl(env), { cf: { cacheTtl: 0 } });
        if (!resp.ok) throw new Error('catalyst fetch HTTP ' + resp.status);
        const data = await resp.json();
        const results = (data.results || []).slice(0, 15); // 상위 15개만 추적
        const dayStart = Math.floor(Date.now() / 86400000) * 86400000; // 오늘 0시(UTC) ms
        for (const r of results) {
            const ticker = r.ticker, entry = r.price, score = r.score;
            if (!ticker || !(entry > 0)) continue;
            // 종목당 하루 1회만 (같은 종목 당일 중복 방지)
            const dup = await env.DB.prepare(
                'SELECT 1 FROM catalyst_signals WHERE ticker=? AND created_at>=? LIMIT 1'
            ).bind(ticker, dayStart).first();
            if (dup) continue;
            await env.DB.prepare(
                'INSERT INTO catalyst_signals (ticker,score,tier,entry,created_at) VALUES (?,?,?,?,?)'
            ).bind(ticker, score, r.grade || scoreBucket(score), entry, Date.now()).run();
            logged++;
        }
    } catch (e) { try { await logError(env, 'captureCatalystSignals', e.message); } catch (_) {} }
    return { logged };
}

export async function resolveCatalystSignals(env) {
    let resolved = 0, updated = 0, checked = 0;
    try {
        const open = await env.DB.prepare('SELECT * FROM catalyst_signals WHERE resolved=0 ORDER BY created_at ASC LIMIT 120').all();
        const rows = open.results || [];
        checked = rows.length;
        // 종목 중복 제거 후 현재가 일괄 조회 (yfinance quote, 최대 50개씩)
        const tickers = [...new Set(rows.map(r => r.ticker))];
        const priceMap = {};
        for (let i = 0; i < tickers.length; i += 50) {
            const batch = tickers.slice(i, i + 50);
            try {
                const d = await yfRequest(env.CACHE, `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(batch.join(','))}`);
                for (const q of (d?.quoteResponse?.result || [])) {
                    if (q.symbol) priceMap[q.symbol] = q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice;
                }
            } catch (_) {}
        }
        for (const row of rows) {
            const cur = priceMap[row.ticker];
            if (!(cur > 0) || !(row.entry > 0)) continue;
            const ret = +(((cur / row.entry) - 1) * 100).toFixed(2);
            const ageD = (Date.now() - row.created_at) / 86400000;
            let setRet1d = (row.ret_1d == null && ageD >= 0.7);
            let done = (ageD >= 2.7);
            if (setRet1d && !done) {
                await env.DB.prepare('UPDATE catalyst_signals SET ret_1d=? WHERE id=?').bind(ret, row.id).run();
                updated++;
            } else if (done) {
                await env.DB.prepare('UPDATE catalyst_signals SET ret_1d=COALESCE(ret_1d,?), ret_3d=?, resolved=1, resolved_at=? WHERE id=?')
                    .bind(ret, ret, Date.now(), row.id).run();
                resolved++;
            } else if (ageD > 10) {
                // 10일+ 미해소 → 마무리
                await env.DB.prepare('UPDATE catalyst_signals SET ret_3d=COALESCE(ret_3d,?), resolved=1, resolved_at=? WHERE id=?')
                    .bind(ret, Date.now(), row.id).run();
                resolved++;
            }
        }
    } catch (e) { try { await logError(env, 'resolveCatalystSignals', e.message); } catch (_) {} }
    return { checked, updated, resolved };
}

// GET /api/catalyst/livestats — 등급별 실측 수익률 (점수 예측력 검증)
export async function handleCatalystLiveStats(req, env) {
    try {
        const since90 = Date.now() - 90 * 24 * 3600 * 1000;
        // ret_1d 라도 기록된 신호 (1일 경과+) 집계
        const rows = (await env.DB.prepare(
            'SELECT score,tier,ret_1d,ret_3d FROM catalyst_signals WHERE ret_1d IS NOT NULL AND created_at>=?'
        ).bind(since90).all()).results || [];
        const openRow = await env.DB.prepare('SELECT COUNT(*) n FROM catalyst_signals WHERE ret_1d IS NULL').first();
        const agg = (arr) => {
            const n = arr.length;
            if (!n) return { n: 0, avgRet1d: 0, avgRet3d: 0, winRate1d: 0 };
            const r1 = arr.map(t => t.ret_1d).filter(v => v != null);
            const r3 = arr.map(t => t.ret_3d).filter(v => v != null);
            const up1 = r1.filter(v => v > 0).length;
            return {
                n,
                avgRet1d: r1.length ? +(r1.reduce((s, v) => s + v, 0) / r1.length).toFixed(2) : 0,
                avgRet3d: r3.length ? +(r3.reduce((s, v) => s + v, 0) / r3.length).toFixed(2) : 0,
                ret3dN: r3.length,
                winRate1d: r1.length ? Math.round((up1 / r1.length) * 100) : 0,
            };
        };
        const byBucket = {
            urgent: agg(rows.filter(r => r.score >= 75)),
            strong: agg(rows.filter(r => r.score >= 55 && r.score < 75)),
            watch:  agg(rows.filter(r => r.score >= 35 && r.score < 55)),
            weak:   agg(rows.filter(r => r.score < 35)),
        };
        return json({ open: openRow?.n || 0, overall: agg(rows), byBucket });
    } catch (e) {
        return err(500, e.message);
    }
}
