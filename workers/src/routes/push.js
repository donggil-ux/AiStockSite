// 푸시 구독자 + 가격 알림 CRUD (D1)
// Clerk 인증 통합:
//   - Bearer 토큰이 있고 검증되면 auth.userId 로 user_id 연결 (다기기 동기화)
//   - 비로그인은 기존 sub_token 기반 동작 유지 (하위 호환)
import { validSymbol, json, err } from '../utils/validators.js';
import { sendPush } from '../utils/vapid.js';
import { verifyClerkJWT } from '../utils/clerk.js';

// 간단한 토큰 생성기 (서버에서 클라이언트 인증용)
function randomToken(len = 24) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return [...bytes].map(b => b.toString(36)).join('').slice(0, len);
}

// ── POST /api/push/subscribe ────────────────────────────────
// Body: { subscription: { endpoint, keys: { p256dh, auth } }, favs?: ['NVDA',...] }
// Auth: Bearer (선택) — userId 연결 시 다기기 동기화 가능
// Response: { subToken, userId? }
export async function handleSubscribe(req, env) {
    try {
        const body = await req.json();
        const sub = body?.subscription;
        const favs = Array.isArray(body?.favs) ? body.favs : [];
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return err(400, 'invalid subscription');
        }
        const auth = await verifyClerkJWT(req, env);
        const userId = auth?.userId || null;
        const now = Date.now();
        // 기존 endpoint 가 있으면 업데이트, 없으면 INSERT
        const existing = await env.DB.prepare(
            'SELECT id, sub_token, user_id, favs FROM push_subscribers WHERE endpoint = ?'
        ).bind(sub.endpoint).first();
        let subToken;
        if (existing) {
            subToken = existing.sub_token;
            // 사용자가 로그인했다면 user_id 연결 (병합)
            const newUserId = userId || existing.user_id;
            // 로그인 시 — 다른 디바이스의 favs 와 합치기
            let mergedFavs = favs;
            if (userId) {
                const otherRows = await env.DB.prepare(
                    'SELECT favs FROM push_subscribers WHERE user_id=? AND id<>?'
                ).bind(userId, existing.id).all();
                const otherFavs = (otherRows.results || [])
                    .flatMap(r => { try { return JSON.parse(r.favs || '[]'); } catch (_) { return []; } });
                mergedFavs = [...new Set([...favs, ...otherFavs])].slice(0, 30);
            }
            await env.DB.prepare(
                'UPDATE push_subscribers SET p256dh=?, auth=?, favs=?, user_id=?, last_seen=? WHERE id=?'
            ).bind(sub.keys.p256dh, sub.keys.auth, JSON.stringify(mergedFavs), newUserId, now, existing.id).run();
        } else {
            subToken = randomToken(24);
            // 신규지만 같은 user_id 의 기존 디바이스 favs 가 있으면 인계
            let mergedFavs = favs;
            if (userId) {
                const otherRows = await env.DB.prepare(
                    'SELECT favs FROM push_subscribers WHERE user_id=?'
                ).bind(userId).all();
                const otherFavs = (otherRows.results || [])
                    .flatMap(r => { try { return JSON.parse(r.favs || '[]'); } catch (_) { return []; } });
                mergedFavs = [...new Set([...favs, ...otherFavs])].slice(0, 30);
            }
            await env.DB.prepare(
                'INSERT INTO push_subscribers (sub_token, endpoint, p256dh, auth, favs, user_id, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?)'
            ).bind(subToken, sub.endpoint, sub.keys.p256dh, sub.keys.auth, JSON.stringify(mergedFavs), userId, now, now).run();
        }
        // users 테이블 upsert (로그인 사용자)
        if (userId) {
            await env.DB.prepare(
                `INSERT INTO users (user_id, email, created_at, last_seen) VALUES (?,?,?,?)
                 ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen, email=COALESCE(excluded.email, email)`
            ).bind(userId, auth.email || null, now, now).run();
        }
        return json({ subToken, userId, ok: true });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── POST /api/push/link ─────────────────────────────────────
// 로그인 직후 — 기존 sub_token 의 익명 데이터를 user_id 에 연결
// Body: { subToken, endpoint }   Auth: Bearer 필수
export async function handleLinkAccount(req, env) {
    try {
        const auth = await verifyClerkJWT(req, env);
        if (!auth?.userId) return err(401, 'auth required');
        const b = await req.json();
        if (!b.subToken || !b.endpoint) return err(400, 'subToken+endpoint required');
        const now = Date.now();
        const r = await env.DB.prepare(
            'UPDATE push_subscribers SET user_id=?, last_seen=? WHERE sub_token=? AND endpoint=? AND (user_id IS NULL OR user_id=?)'
        ).bind(auth.userId, now, b.subToken, b.endpoint, auth.userId).run();
        // users 테이블 upsert
        await env.DB.prepare(
            `INSERT INTO users (user_id, email, created_at, last_seen) VALUES (?,?,?,?)
             ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen, email=COALESCE(excluded.email, email)`
        ).bind(auth.userId, auth.email || null, now, now).run();
        // 다른 디바이스의 favs 병합 후 반환 (클라이언트가 즉시 화면 동기화)
        const allRows = await env.DB.prepare(
            'SELECT favs, notif_prefs, market_filter FROM push_subscribers WHERE user_id=?'
        ).bind(auth.userId).all();
        const mergedFavs = [...new Set(
            (allRows.results || []).flatMap(row => {
                try { return JSON.parse(row.favs || '[]'); } catch (_) { return []; }
            })
        )].slice(0, 30);
        let prefs = null, marketFilter = 'ALL';
        const latest = allRows.results?.[0];
        if (latest) {
            try { prefs = JSON.parse(latest.notif_prefs || 'null'); } catch (_) {}
            marketFilter = latest.market_filter || 'ALL';
        }
        return json({ ok: true, linked: r.meta?.changes || 0, favs: mergedFavs, prefs, marketFilter });
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
        const auth = await verifyClerkJWT(req, env);
        const userId = auth?.userId || null;
        await env.DB.prepare(
            'INSERT INTO price_alerts (sub_token, endpoint, symbol, target_price, direction, user_id, created_at) VALUES (?,?,?,?,?,?,?)'
        ).bind(b.subToken, b.endpoint, b.symbol.toUpperCase(), parseFloat(b.targetPrice), dir, userId, Date.now()).run();
        return json({ ok: true });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── GET /api/push/price-alert?endpoint=... ──────────────────
// 로그인 시 user_id 기준으로 다기기 통합 조회
export async function handleListAlerts(req, env) {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get('endpoint');
    try {
        const auth = await verifyClerkJWT(req, env);
        let rs;
        if (auth?.userId) {
            rs = await env.DB.prepare(
                'SELECT id, symbol, target_price, direction, triggered, created_at FROM price_alerts WHERE user_id=? AND triggered=0 ORDER BY created_at DESC'
            ).bind(auth.userId).all();
        } else {
            if (!endpoint) return err(400, 'endpoint required');
            rs = await env.DB.prepare(
                'SELECT id, symbol, target_price, direction, triggered, created_at FROM price_alerts WHERE endpoint=? AND triggered=0 ORDER BY created_at DESC'
            ).bind(endpoint).all();
        }
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
    const auth = await verifyClerkJWT(req, env);
    try {
        // 로그인 시 user_id 검증 우선
        if (auth?.userId) {
            await env.DB.prepare(
                'DELETE FROM price_alerts WHERE id=? AND user_id=?'
            ).bind(id, auth.userId).run();
        } else {
            if (!subToken || !endpoint) return err(400, 'subToken and endpoint required');
            await env.DB.prepare(
                'DELETE FROM price_alerts WHERE id=? AND sub_token=? AND endpoint=?'
            ).bind(id, subToken, endpoint).run();
        }
        return json({ ok: true });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── POST /api/push/prefs — 알림 종류 4종 + 시장 필터 + 조용 시간대 동기화 ────
// Body: {
//   subToken, endpoint,
//   prefs?: {buy,tp,stop,pos},
//   marketFilter?: 'US'|'KR'|'ALL',
//   quiet?: { enabled, start (0-23), end (0-23), tz_offset_min }
// }
// Auth: 있을 시 user_id 의 모든 디바이스에 동시 적용
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
        // 조용 시간대 검증 + 정규화
        let quiet = null;
        if (b.quiet && typeof b.quiet === 'object') {
            const start = Math.max(0, Math.min(23, parseInt(b.quiet.start, 10) || 22));
            const end   = Math.max(0, Math.min(23, parseInt(b.quiet.end,   10) || 7));
            const tz    = Number.isFinite(b.quiet.tz_offset_min) ? Math.max(-720, Math.min(840, b.quiet.tz_offset_min)) : 540;
            quiet = { enabled: b.quiet.enabled ? 1 : 0, start, end, tz_offset_min: tz };
        }
        const sets = [];
        const args = [];
        if (prefs)  { sets.push('notif_prefs=?'); args.push(JSON.stringify(prefs)); }
        if (mkt)    { sets.push('market_filter=?'); args.push(mkt); }
        if (quiet)  { sets.push('quiet=?'); args.push(JSON.stringify(quiet)); }
        if (!sets.length) return err(400, 'nothing to update');
        sets.push('last_seen=?'); args.push(Date.now());

        const auth = await verifyClerkJWT(req, env);
        let sql, finalArgs;
        if (auth?.userId) {
            // 다기기 동시 적용
            finalArgs = [...args, auth.userId];
            sql = `UPDATE push_subscribers SET ${sets.join(',')} WHERE user_id=?`;
        } else {
            finalArgs = [...args, b.subToken, b.endpoint];
            sql = `UPDATE push_subscribers SET ${sets.join(',')} WHERE sub_token=? AND endpoint=?`;
        }
        const r = await env.DB.prepare(sql).bind(...finalArgs).run();
        return json({ ok: true, updated: r.meta?.changes || 0 });
    } catch (e) {
        return err(500, e.message);
    }
}

// ── POST /api/push/favs — 즐겨찾기 동기화 (백엔드 시그널 분석 대상) ────
// Body: { subToken, endpoint, favs: ['NVDA','AAPL', ...] }
// Auth: 있을 시 user_id 의 모든 디바이스에 동시 적용
export async function handleSyncFavs(req, env) {
    try {
        const b = await req.json();
        if (!b.subToken || !b.endpoint || !Array.isArray(b.favs)) {
            return err(400, 'invalid favs');
        }
        const cleaned = [...new Set(b.favs.map(s => String(s || '').trim().toUpperCase()).filter(Boolean))].slice(0, 30);
        const auth = await verifyClerkJWT(req, env);
        const now = Date.now();
        let r;
        if (auth?.userId) {
            r = await env.DB.prepare(
                'UPDATE push_subscribers SET favs=?, last_seen=? WHERE user_id=?'
            ).bind(JSON.stringify(cleaned), now, auth.userId).run();
        } else {
            r = await env.DB.prepare(
                'UPDATE push_subscribers SET favs=?, last_seen=? WHERE sub_token=? AND endpoint=?'
            ).bind(JSON.stringify(cleaned), now, b.subToken, b.endpoint).run();
        }
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
