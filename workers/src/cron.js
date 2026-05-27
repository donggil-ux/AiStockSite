// Cloudflare Cron Triggers — wrangler.toml [triggers] crons 항목에서 호출
import { yfRequest } from './utils/crumb.js';
import { sendPush } from './utils/vapid.js';

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
