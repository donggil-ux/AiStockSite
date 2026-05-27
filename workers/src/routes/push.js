// 푸시 구독자 + 가격 알림 CRUD (D1)
import { validSymbol, json, err } from '../utils/validators.js';
import { sendPush } from '../utils/vapid.js';

// 간단한 토큰 생성기 (서버에서 클라이언트 인증용)
function randomToken(len = 24) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return [...bytes].map(b => b.toString(36)).join('').slice(0, len);
}

// ── POST /api/push/subscribe ────────────────────────────────
// Body: { subscription: { endpoint, keys: { p256dh, auth } }, favs?: ['NVDA',...] }
// Response: { subToken }
export async function handleSubscribe(req, env) {
    try {
        const body = await req.json();
        const sub = body?.subscription;
        const favs = Array.isArray(body?.favs) ? body.favs : [];
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return err(400, 'invalid subscription');
        }
        const now = Date.now();
        // 기존 endpoint 가 있으면 업데이트, 없으면 INSERT
        const existing = await env.DB.prepare(
            'SELECT id, sub_token FROM push_subscribers WHERE endpoint = ?'
        ).bind(sub.endpoint).first();
        let subToken;
        if (existing) {
            subToken = existing.sub_token;
            await env.DB.prepare(
                'UPDATE push_subscribers SET p256dh=?, auth=?, favs=?, last_seen=? WHERE id=?'
            ).bind(sub.keys.p256dh, sub.keys.auth, JSON.stringify(favs), now, existing.id).run();
        } else {
            subToken = randomToken(24);
            await env.DB.prepare(
                'INSERT INTO push_subscribers (sub_token, endpoint, p256dh, auth, favs, created_at, last_seen) VALUES (?,?,?,?,?,?,?)'
            ).bind(subToken, sub.endpoint, sub.keys.p256dh, sub.keys.auth, JSON.stringify(favs), now, now).run();
        }
        return json({ subToken, ok: true });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── POST /api/push/price-alert ──────────────────────────────
// Body: { subToken, endpoint, symbol, targetPrice, direction }
export async function handleCreateAlert(req, env) {
    try {
        const b = await req.json();
        if (!b.subToken || !b.endpoint || !validSymbol(b.symbol) || !b.targetPrice) {
            return err(400, 'invalid alert');
        }
        const dir = b.direction === 'below' ? 'below' : 'above';
        await env.DB.prepare(
            'INSERT INTO price_alerts (sub_token, endpoint, symbol, target_price, direction, created_at) VALUES (?,?,?,?,?,?)'
        ).bind(b.subToken, b.endpoint, b.symbol.toUpperCase(), parseFloat(b.targetPrice), dir, Date.now()).run();
        return json({ ok: true });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── GET /api/push/price-alert?endpoint=... ──────────────────
export async function handleListAlerts(req, env) {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get('endpoint');
    if (!endpoint) return err(400, 'endpoint required');
    try {
        const rs = await env.DB.prepare(
            'SELECT id, symbol, target_price, direction, triggered, created_at FROM price_alerts WHERE endpoint=? AND triggered=0 ORDER BY created_at DESC'
        ).bind(endpoint).all();
        return json({ alerts: rs.results || [] });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── DELETE /api/push/price-alert/:id ────────────────────────
export async function handleDeleteAlert(req, env, params) {
    const id = parseInt(params.id, 10);
    if (!id) return err(400, 'invalid id');
    const url = new URL(req.url);
    const subToken = url.searchParams.get('subToken');
    const endpoint = url.searchParams.get('endpoint');
    if (!subToken || !endpoint) return err(400, 'subToken and endpoint required');
    try {
        await env.DB.prepare(
            'DELETE FROM price_alerts WHERE id=? AND sub_token=? AND endpoint=?'
        ).bind(id, subToken, endpoint).run();
        return json({ ok: true });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── POST /api/push/prefs — 알림 종류 4종 + 시장 필터 동기화 ────
// Body: { subToken, endpoint, prefs?: {buy,tp,stop,pos}, marketFilter?: 'US'|'KR'|'ALL' }
export async function handleSyncPrefs(req, env) {
    try {
        const b = await req.json();
        if (!b.subToken || !b.endpoint) return err(400, 'subToken+endpoint required');
        const prefs = (b.prefs && typeof b.prefs === 'object') ? {
            buy:  b.prefs.buy  ? 1 : 0,
            tp:   b.prefs.tp   ? 1 : 0,
            stop: b.prefs.stop ? 1 : 0,
            pos:  b.prefs.pos  ? 1 : 0,
        } : null;
        const mkt = ['US','KR','ALL'].includes(b.marketFilter) ? b.marketFilter : null;
        // 둘 중 제공된 것만 업데이트
        const sets = [];
        const args = [];
        if (prefs) { sets.push('notif_prefs=?'); args.push(JSON.stringify(prefs)); }
        if (mkt)   { sets.push('market_filter=?'); args.push(mkt); }
        if (!sets.length) return err(400, 'nothing to update');
        sets.push('last_seen=?'); args.push(Date.now());
        args.push(b.subToken, b.endpoint);
        const sql = `UPDATE push_subscribers SET ${sets.join(',')} WHERE sub_token=? AND endpoint=?`;
        const r = await env.DB.prepare(sql).bind(...args).run();
        return json({ ok: true, updated: r.meta?.changes || 0 });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── POST /api/push/favs — 즐겨찾기 동기화 (백엔드 시그널 분석 대상) ────
// Body: { subToken, endpoint, favs: ['NVDA','AAPL', ...] }
export async function handleSyncFavs(req, env) {
    try {
        const b = await req.json();
        if (!b.subToken || !b.endpoint || !Array.isArray(b.favs)) {
            return err(400, 'invalid favs');
        }
        // favs 정리 (대문자 + 중복 제거 + 최대 30개)
        const cleaned = [...new Set(b.favs.map(s => String(s || '').trim().toUpperCase()).filter(Boolean))].slice(0, 30);
        const r = await env.DB.prepare(
            'UPDATE push_subscribers SET favs=?, last_seen=? WHERE sub_token=? AND endpoint=?'
        ).bind(JSON.stringify(cleaned), Date.now(), b.subToken, b.endpoint).run();
        return json({ ok: true, count: cleaned.length, updated: r.meta?.changes || 0 });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── POST /api/push/test — 단일 구독자 테스트 발송 (디버그) ────
export async function handlePushTest(req, env) {
    try {
        const b = await req.json();
        if (!b.endpoint) return err(400, 'endpoint required');
        const row = await env.DB.prepare(
            'SELECT endpoint, p256dh, auth FROM push_subscribers WHERE endpoint=?'
        ).bind(b.endpoint).first();
        if (!row) return err(404, 'subscriber not found');
        const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
        const payload = JSON.stringify({
            title: 'StockAI 테스트',
            body: '백엔드 푸시 발송이 정상 작동합니다 🔔',
            url: '/',
            tag: 'stockai-test',
        });
        const res = await sendPush(sub, payload, env);
        return json({ ok: res.ok, status: res.status });
    } catch (e) {
        return err(500, e.message);
    }
}
