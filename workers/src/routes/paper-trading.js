// 가상 매매 API
// GET  /api/paper/account           — 계좌 현황 + 오픈 포지션 (최초 호출 시 자동 생성)
// GET  /api/paper/trades?limit=50   — 종료된 거래 내역
// GET  /api/paper/fills/:id         — 특정 포지션 체결 내역
// POST /api/paper/close/:id         — 수동 전량 청산 { price }
// POST /api/paper/reset             — 계좌 초기화 ($100,000)
// 모두 Clerk JWT 필수 (Authorization: Bearer <token>)

import { verifyClerkJWT } from '../utils/clerk.js';
import { json, err } from '../utils/validators.js';
import { paperClosePosition } from '../utils/paper-engine.js';

const INITIAL_BALANCE  = 100000.0;
const INITIAL_POS_SIZE = 30000.0; // 종목당 $30,000 (3분할: $5,000 / $10,000 / $15,000)

async function getOrCreateAccount(env, userId) {
    let acct = await env.DB.prepare('SELECT * FROM paper_account WHERE user_id=?').bind(userId).first();
    if (!acct) {
        const now = Date.now();
        await env.DB.prepare(
            'INSERT INTO paper_account (user_id,balance,position_size,total_pnl,updated_at) VALUES (?,?,?,0,?)'
        ).bind(userId, INITIAL_BALANCE, INITIAL_POS_SIZE, now).run();
        acct = { user_id: userId, balance: INITIAL_BALANCE, position_size: INITIAL_POS_SIZE, total_pnl: 0, updated_at: now };
    }
    return acct;
}

// ── GET /api/paper/account ──────────────────────────────────────
export async function handleGetAccount(req, env) {
    const auth = await verifyClerkJWT(req, env);
    if (!auth?.userId) return err(401, 'auth required');

    const acct = await getOrCreateAccount(env, auth.userId);

    const openRes = await env.DB.prepare(
        'SELECT * FROM paper_trades WHERE user_id=? AND status=\'open\' ORDER BY created_at DESC LIMIT 30'
    ).bind(auth.userId).all();
    const open = openRes.results || [];

    const statsRes = await env.DB.prepare(
        'SELECT COUNT(*) n, SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) wins FROM paper_trades WHERE user_id=? AND status=\'closed\''
    ).bind(auth.userId).first();
    const closedCount = statsRes?.n || 0;
    const wins        = statsRes?.wins || 0;

    return json({
        balance:       acct.balance,
        position_size: acct.position_size,
        total_pnl:     acct.total_pnl,
        open_positions: open,
        summary: {
            open_count:   open.length,
            closed_count: closedCount,
            win_rate:     closedCount > 0 ? Math.round((wins / closedCount) * 100) / 100 : null,
        },
    });
}

// ── GET /api/paper/trades ───────────────────────────────────────
export async function handleGetTrades(req, env) {
    const auth = await verifyClerkJWT(req, env);
    if (!auth?.userId) return err(401, 'auth required');

    const url    = new URL(req.url);
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

    const res = await env.DB.prepare(
        'SELECT * FROM paper_trades WHERE user_id=? AND status=\'closed\' ORDER BY exit_at DESC LIMIT ?'
    ).bind(auth.userId, limit).all();

    return json({ trades: res.results || [] });
}

// ── GET /api/paper/fills/:id ────────────────────────────────────
export async function handleGetFills(req, env, params) {
    const auth = await verifyClerkJWT(req, env);
    if (!auth?.userId) return err(401, 'auth required');

    const tradeId = parseInt(params.id, 10);
    if (!tradeId) return err(400, 'invalid id');

    // 소유 확인
    const trade = await env.DB.prepare('SELECT id FROM paper_trades WHERE id=? AND user_id=?')
        .bind(tradeId, auth.userId).first();
    if (!trade) return err(404, 'not found');

    const res = await env.DB.prepare(
        'SELECT * FROM paper_fills WHERE trade_id=? ORDER BY filled_at ASC'
    ).bind(tradeId).all();

    return json({ fills: res.results || [] });
}

// ── POST /api/paper/close/:id ───────────────────────────────────
export async function handleClosePosition(req, env, params) {
    const auth = await verifyClerkJWT(req, env);
    if (!auth?.userId) return err(401, 'auth required');

    const tradeId = parseInt(params.id, 10);
    if (!tradeId) return err(400, 'invalid id');

    const trade = await env.DB.prepare(
        'SELECT * FROM paper_trades WHERE id=? AND user_id=? AND status=\'open\''
    ).bind(tradeId, auth.userId).first();
    if (!trade) return err(404, 'position not found or already closed');

    let price;
    try { price = (await req.json())?.price; } catch (_) {}
    if (!price || price <= 0) {
        // 현재가 자동 조회
        try {
            const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${trade.symbol}?range=1d&interval=1m`);
            const d = await r.json();
            price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
        } catch (_) {}
    }
    if (!price) return err(400, 'price required');

    await paperClosePosition(env, trade, price, 'manual');
    return json({ ok: true, symbol: trade.symbol, exit_price: price });
}

// ── POST /api/paper/reset ───────────────────────────────────────
export async function handleResetAccount(req, env) {
    const auth = await verifyClerkJWT(req, env);
    if (!auth?.userId) return err(401, 'auth required');

    const now = Date.now();
    // 오픈 포지션 모두 삭제 (가상 취소)
    await env.DB.prepare('DELETE FROM paper_fills WHERE user_id=?').bind(auth.userId).run();
    await env.DB.prepare('DELETE FROM paper_trades WHERE user_id=?').bind(auth.userId).run();
    await env.DB.prepare(
        'INSERT OR REPLACE INTO paper_account (user_id,balance,position_size,total_pnl,updated_at) VALUES (?,?,?,0,?)'
    ).bind(auth.userId, INITIAL_BALANCE, INITIAL_POS_SIZE, now).run();

    return json({ ok: true, balance: INITIAL_BALANCE });
}

// ── GET /api/paper/fills (전체 체결 내역, 최근 50건) ───────────
export async function handleGetAllFills(req, env) {
    const auth = await verifyClerkJWT(req, env);
    if (!auth?.userId) return err(401, 'auth required');

    const url   = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);

    const res = await env.DB.prepare(
        `SELECT f.*, t.symbol FROM paper_fills f
         JOIN paper_trades t ON f.trade_id = t.id
         WHERE f.user_id = ? ORDER BY f.filled_at DESC LIMIT ?`
    ).bind(auth.userId, limit).all();

    return json({ fills: res.results || [] });
}

// ── 디스패처 (index.js 에서 단일 import) ───────────────────────
export async function handlePaperTrading(req, env, params) {
    const url    = new URL(req.url);
    const method = req.method;
    const path   = url.pathname;

    if (method === 'GET'  && path === '/api/paper/account')        return handleGetAccount(req, env);
    if (method === 'GET'  && path === '/api/paper/trades')         return handleGetTrades(req, env);
    if (method === 'GET'  && path === '/api/paper/fills')          return handleGetAllFills(req, env);
    if (method === 'GET'  && path.startsWith('/api/paper/fills/')) return handleGetFills(req, env, params);
    if (method === 'POST' && path.startsWith('/api/paper/close/')) return handleClosePosition(req, env, params);
    if (method === 'POST' && path === '/api/paper/reset')          return handleResetAccount(req, env);
    return err(404, 'not found');
}
