// Cloudflare Cron Triggers — wrangler.toml [triggers] crons 항목에서 호출
import { yfRequest } from './utils/crumb.js';
import { sendPush } from './utils/vapid.js';
import { detectSignal } from './utils/indicators.js';
import { fetchChartWithFallback } from './routes/yahoo.js';

/**
 * 매 5분마다: 등록된 가격 알림을 체크해 조건 충족 시 푸시 발송
 */
export async function checkPriceAlerts(env) {
    try {
        // 1) 대기 중인 알림을 종목별로 그룹화
        const rs = await env.DB.prepare(
            'SELECT id, sub_token, endpoint, symbol, target_price, direction FROM price_alerts WHERE triggered=0 LIMIT 200'
        ).all();
        const alerts = rs.results || [];
        if (!alerts.length) return { checked: 0, fired: 0 };

        // 2) 종목별 시세를 한 번에 조회 (Yahoo quote multi)
        const symbols = [...new Set(alerts.map(a => a.symbol))];
        const chunks = [];
        for (let i = 0; i < symbols.length; i += 50) chunks.push(symbols.slice(i, i + 50));
        const priceMap = new Map();
        for (const chunk of chunks) {
            try {
                const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`;
                const data = await yfRequest(env.CACHE, url);
                for (const r of (data?.quoteResponse?.result || [])) {
                    if (r.regularMarketPrice != null) priceMap.set(r.symbol, r.regularMarketPrice);
                }
            } catch (e) { console.warn('[cron] quote fail', e.message); }
        }

        // 3) 조건 매칭 알림 발송
        let fired = 0;
        for (const a of alerts) {
            const cur = priceMap.get(a.symbol);
            if (cur == null) continue;
            const hit = a.direction === 'above'
                ? cur >= a.target_price
                : cur <= a.target_price;
            if (!hit) continue;
            // 구독자 정보
            const sub = await env.DB.prepare(
                'SELECT endpoint, p256dh, auth FROM push_subscribers WHERE endpoint=?'
            ).bind(a.endpoint).first();
            if (!sub) continue;
            const arrow = a.direction === 'above' ? '⬆️' : '⬇️';
            const payload = JSON.stringify({
                title: `${arrow} ${a.symbol} ${cur.toFixed(2)} 도달`,
                body: `목표가 ${a.target_price.toFixed(2)} ${a.direction === 'above' ? '돌파' : '이탈'} — 현재가 ${cur.toFixed(2)}`,
                url: '/',
                tag: `price-${a.symbol}`,
            });
            try {
                const r = await sendPush(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload, env
                );
                if (r.ok || r.status === 201) {
                    await env.DB.prepare(
                        'UPDATE price_alerts SET triggered=1, triggered_at=? WHERE id=?'
                    ).bind(Date.now(), a.id).run();
                    fired++;
                } else if (r.status === 404 || r.status === 410) {
                    // 구독 만료 → subscriber 삭제 (gone)
                    await env.DB.prepare('DELETE FROM push_subscribers WHERE endpoint=?').bind(sub.endpoint).run();
                }
            } catch (e) { console.warn('[cron] push fail', a.symbol, e.message); }
        }
        return { checked: alerts.length, fired };
    } catch (e) {
        console.error('[cron] checkPriceAlerts', e.message);
        return { error: e.message };
    }
}

/**
 * 매일 KST 09시 (=UTC 00시): 사용자별 즐겨찾기 종목의 당일 실적 리마인더
 */
export async function earningsReminder(env) {
    try {
        // 모든 활성 구독자
        const rs = await env.DB.prepare(
            'SELECT endpoint, p256dh, auth, favs FROM push_subscribers WHERE last_seen > ?'
        ).bind(Date.now() - 30 * 24 * 3600 * 1000).all(); // 30일 이내 활동
        let sent = 0;
        for (const sub of (rs.results || [])) {
            let favs = [];
            try { favs = JSON.parse(sub.favs || '[]'); } catch (_) {}
            if (!favs.length) continue;
            // 당일 실적 발표 종목 조회
            const todayEarnings = await _todayEarnings(env, favs);
            if (!todayEarnings.length) continue;
            const payload = JSON.stringify({
                title: `📅 오늘 실적 발표 ${todayEarnings.length}종목`,
                body: todayEarnings.slice(0, 5).join(', ') + (todayEarnings.length > 5 ? '...' : ''),
                url: '/',
                tag: 'earnings-today',
            });
            try {
                await sendPush(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload, env
                );
                sent++;
            } catch (e) { console.warn('[cron] earnings push', e.message); }
        }
        return { sent };
    } catch (e) {
        return { error: e.message };
    }
}

async function _todayEarnings(env, favs) {
    // Yahoo Finance 의 실적 캘린더 API 호출
    const todayStr = new Date().toISOString().split('T')[0];
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(favs.join(','))}`;
    try {
        const data = await yfRequest(env.CACHE, url);
        const list = (data?.quoteResponse?.result || [])
            .filter(r => {
                if (!r.earningsTimestamp) return false;
                const d = new Date(r.earningsTimestamp * 1000).toISOString().split('T')[0];
                return d === todayStr;
            })
            .map(r => r.symbol);
        return list;
    } catch (_) { return []; }
}

/**
 * 매 5분마다 (또는 *5분봉* cron trigger): 활성 구독자의 즐겨찾기 종목을
 * 5분봉으로 분석 → A/S 등급 시그널 발생 시 푸시 발송.
 *
 * 중복 방지: signal_history 테이블에 (symbol, dir, candle_ts) 키로 저장.
 * 같은 5분봉 + 같은 방향 시그널은 한 번만 발송.
 *
 * 최대 처리량 보호: 구독자 50명 / 종목 30개 / 5분 = Workers 30초 한계 내.
 */
export async function analyzeSignals(env, marketHint = 'ALL') {
    try {
        // 1) 30일 이내 활동한 구독자 + 즐겨찾기 + 알림 선호 + 시장 필터 모음
        const rs = await env.DB.prepare(
            'SELECT endpoint, p256dh, auth, favs, notif_prefs, market_filter FROM push_subscribers WHERE last_seen > ? LIMIT 100'
        ).bind(Date.now() - 30 * 24 * 3600 * 1000).all();
        const subs = rs.results || [];
        if (!subs.length) return { subscribers: 0, fired: 0 };

        // 2) 즐겨찾기 종목 dedupe + 매수 알림 켠 구독자만 + 시장 필터 일치만
        // symbolToSubs: symbol → [{endpoint, p256dh, auth, prefs, marketFilter}]
        const symbolToSubs = new Map();
        for (const sub of subs) {
            let favs = [], prefs = { buy:1, tp:1, stop:1, pos:1 };
            try { favs = JSON.parse(sub.favs || '[]'); } catch (_) {}
            try { prefs = JSON.parse(sub.notif_prefs || '{"buy":1,"tp":1,"stop":1,"pos":1}'); } catch (_) {}
            const subMarket = sub.market_filter || 'ALL';
            // 시장 필터: cron 호출 시 marketHint 와 사용자의 market_filter 둘 다 매치되어야 함
            if (marketHint !== 'ALL' && subMarket !== 'ALL' && subMarket !== marketHint) continue;
            for (const sym of favs) {
                if (!sym) continue;
                const arr = symbolToSubs.get(sym) || [];
                arr.push({
                    endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth,
                    prefs, marketFilter: subMarket,
                });
                symbolToSubs.set(sym, arr);
            }
        }
        const allSymbols = [...symbolToSubs.keys()].slice(0, 30); // Workers 30초 보호
        if (!allSymbols.length) return { subscribers: subs.length, marketHint, fired: 0 };

        // 3) 각 종목 5분봉 분석 + 시그널 발견 시 푸시 큐잉
        let fired = 0, analyzed = 0;
        for (const symbol of allSymbols) {
            try {
                // Yahoo crumb 실패 시 자동으로 Polygon fallback
                const raw = await fetchChartWithFallback(env, symbol, '1d', '5m', 'false');
                const result = raw?.chart?.result?.[0];
                if (!result) continue;
                const q = result.indicators?.quote?.[0];
                if (!q?.close?.length) continue;
                const ts = result.timestamp || [];
                analyzed++;

                const sig = detectSignal(q);
                // S/A 등급만 발송 (B/C 는 노이즈 가능성)
                if (!sig || (sig.grade !== 'S' && sig.grade !== 'A')) continue;

                const candleTs = ts[ts.length - 1] || Math.floor(Date.now() / 1000);

                // 중복 체크
                const existing = await env.DB.prepare(
                    'SELECT id FROM signal_history WHERE symbol=? AND direction=? AND created_at >= ?'
                ).bind(symbol, sig.dir, (candleTs - 60) * 1000).first();
                if (existing) continue; // 1분 이내 같은 시그널 → 스킵

                // signal_history 기록
                await env.DB.prepare(
                    'INSERT INTO signal_history (symbol, market, direction, grade, score, win_rate, price, headline, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
                ).bind(
                    symbol, 'US', sig.dir, sig.grade, sig.score, sig.winRate,
                    sig.price, sig.factors.slice(0, 3).join(' · '),
                    Date.now()
                ).run();

                // 푸시 발송 — 사용자별 알림 종류 설정(prefs.buy/stop) 존중
                const subList = symbolToSubs.get(symbol) || [];
                const arrow = sig.dir === 'buy' ? '📈' : '📉';
                const dirKo = sig.dir === 'buy' ? '매수' : '매도';
                const payload = JSON.stringify({
                    title: `${arrow} ${symbol} ${dirKo} 시그널 [${sig.grade}급]`,
                    body: `$${sig.price.toFixed(2)} · 예상 승률 ${sig.winRate}% · ${sig.factors.slice(0, 2).join(' · ')}`,
                    url: `/?s=${symbol}`,
                    tag: `signal-${symbol}-${sig.dir}`,
                });
                for (const sub of subList) {
                    // 매수 시그널인데 사용자가 buy=0 → 스킵
                    // 매도 시그널인데 사용자가 stop=0 → 스킵 (매도 = 손절선 이탈 의미)
                    if (sig.dir === 'buy'  && !sub.prefs?.buy)  continue;
                    if (sig.dir === 'sell' && !sub.prefs?.stop) continue;
                    try {
                        const r = await sendPush(
                            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                            payload, env
                        );
                        if (r.ok || r.status === 201) fired++;
                        else if (r.status === 404 || r.status === 410) {
                            await env.DB.prepare('DELETE FROM push_subscribers WHERE endpoint=?').bind(sub.endpoint).run();
                        }
                    } catch (e) { console.warn('[signal-push] fail', symbol, e.message); }
                }
            } catch (e) { console.warn('[analyze] fail', symbol, e.message); }
        }
        return { subscribers: subs.length, symbols: allSymbols.length, analyzed, fired };
    } catch (e) {
        console.error('[cron] analyzeSignals', e.message);
        return { error: e.message };
    }
}
