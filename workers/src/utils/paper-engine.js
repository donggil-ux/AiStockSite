// 가상 매매 포지션 관리 엔진
// 전문 데일리 트레이더 전략 — 3분할 피라미드 / 타이트 손절 / 빠른 익절 / 승률 60%+ 목표

import { yfRequest } from './crumb.js';

// 분할 트리거: first_price 기준 (1차 즉시, 2차 -0.5%, 3차 -1.0%)
const TRANCHE_TRIGGERS = [0, 0.995, 0.990];
export const MAX_TRANCHE        = 3;
// 피라미드 비중 1:2:3 — 하락 시 더 많이 매수 (position_size $10,000 기준: $1,667 / $3,333 / $5,000)
export const TRANCHE_WEIGHTS    = [1, 2, 3];
export const TRANCHE_WEIGHT_SUM = 6;
const STOP_PCT   = 0.985;  // 평균단가 -1.5% 손절 (타이트)
const TP_PCTS    = [1.01, 1.03, 1.06]; // TP1 +1% / TP2 +3% / TP3 +6% (데일리 최적화)
const TP_RATIO   = 0.40;   // 분할 익절 시 40%씩 — TP3까지 120% → 실질 100% 청산
const TRAIL_PCT  = 0.990;  // 고점 대비 -1% 트레일링 스탑 (TP1 이후 활성화)
const BE_PEAK    = 1.015;  // 고점이 avg 대비 +1.5% 이상 → "수익권 진입" 확정
const BE_EXIT    = 1.010;  // avg 대비 +1% 미만으로 복귀 시 최소 1% 확보 청산

// ── 내부 헬퍼 ────────────────────────────────────────────────────

function calcPnl(avgPrice, exitPrice, qty, dir) {
    const sign = dir === 'long' ? 1 : -1;
    return sign * (exitPrice - avgPrice) * qty;
}

async function insertFill(env, { tradeId, userId, fillType, price, qty, pnl = 0 }) {
    const amount = price * qty;
    await env.DB.prepare(
        'INSERT INTO paper_fills (trade_id,user_id,fill_type,price,qty,amount,pnl,filled_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(tradeId, userId, fillType, price, qty, amount, pnl, Date.now()).run();
}

async function deductBalance(env, userId, amount) {
    await env.DB.prepare(
        'UPDATE paper_account SET balance=balance-?, updated_at=? WHERE user_id=?'
    ).bind(amount, Date.now(), userId).run();
}

async function addBalance(env, userId, amount) {
    await env.DB.prepare(
        'UPDATE paper_account SET balance=balance+?, updated_at=? WHERE user_id=?'
    ).bind(amount, Date.now(), userId).run();
}

// ── 공개 API ─────────────────────────────────────────────────────

/**
 * 1차 분할 진입 — 새 paper_trade 생성
 */
export async function paperOpenTrade(env, { userId, symbol, category, style, dir, price, qty, signalId = null, grade = null, score = null }) {
    const now = Date.now();
    const amount = price * qty;
    const stop = price * STOP_PCT;

    const res = await env.DB.prepare(`
        INSERT INTO paper_trades
          (user_id,symbol,category,style,dir,tranche_count,first_price,avg_price,total_qty,total_invested,stop_price,signal_id,grade,score,created_at,updated_at)
        VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)
    `).bind(userId, symbol, category, style, dir, price, price, qty, amount, stop, signalId, grade, score, now, now).run();

    const tradeId = res.meta?.last_row_id;
    if (tradeId) {
        await insertFill(env, { tradeId, userId, fillType: 'buy_t1', price, qty });
        await deductBalance(env, userId, amount);
    }
    return tradeId;
}

/**
 * 추가 분할 매수 (2차~4차)
 * @param {number} trancheAmount - 이번 분할 매수 금액 (호출자가 계산해서 전달)
 */
export async function paperAddTranche(env, trade, price, trancheAmount) {
    const trancheNum = trade.tranche_count + 1;
    const fillType = `buy_t${trancheNum}`;
    const qty = trancheAmount / price;
    const amount = price * qty;

    const newTotalQty      = trade.total_qty + qty;
    const newTotalInvested = trade.total_invested + amount;
    const newAvgPrice      = newTotalInvested / newTotalQty;
    const newStop          = newAvgPrice * STOP_PCT;
    const now = Date.now();

    await env.DB.prepare(`
        UPDATE paper_trades SET
          tranche_count=?,avg_price=?,total_qty=?,total_invested=?,stop_price=?,updated_at=?
        WHERE id=?
    `).bind(trancheNum, newAvgPrice, newTotalQty, newTotalInvested, newStop, now, trade.id).run();

    await insertFill(env, { tradeId: trade.id, userId: trade.user_id, fillType, price, qty });
    await deductBalance(env, trade.user_id, amount);
}

/**
 * 분할 익절 — TP1·TP2·TP3 각 1/4 청산
 * ratio: 남은 수량의 비율 (0.25 = 25%)
 */
export async function paperPartialExit(env, trade, price, fillType, ratio) {
    const qty = trade.total_qty * ratio;
    const amount = price * qty;
    const pnl = calcPnl(trade.avg_price, price, qty, trade.dir);
    const now = Date.now();

    const tpField = fillType === 'sell_tp1' ? 'tp1_done' : fillType === 'sell_tp2' ? 'tp2_done' : 'tp3_done';

    await env.DB.prepare(`
        UPDATE paper_trades SET
          total_qty=total_qty-?,realized_pnl=realized_pnl+?,
          ${tpField}=1,updated_at=?
        WHERE id=?
    `).bind(qty, pnl, now, trade.id).run();

    await insertFill(env, { tradeId: trade.id, userId: trade.user_id, fillType, price, qty, pnl });
    await addBalance(env, trade.user_id, amount);
    await env.DB.prepare(
        'UPDATE paper_account SET total_pnl=total_pnl+?, updated_at=? WHERE user_id=?'
    ).bind(pnl, now, trade.user_id).run();
}

/**
 * 전량 청산 — 손절·트레일·수동
 */
export async function paperClosePosition(env, trade, price, reason) {
    const qty  = trade.total_qty;
    const amount = price * qty;
    const pnl  = calcPnl(trade.avg_price, price, qty, trade.dir) + trade.realized_pnl;
    const now  = Date.now();

    const fillType =
        reason === 'stop'       ? 'sell_stop' :
        reason === 'tp4_trail'  ? 'sell_trail' :
        reason === 'be_protect' ? 'sell_be_protect' :
        reason === 'eod_close'  ? 'sell_eod' :
        'sell_manual';

    await env.DB.prepare(`
        UPDATE paper_trades SET
          status='closed',total_qty=0,realized_pnl=?,exit_price=?,exit_at=?,close_reason=?,updated_at=?
        WHERE id=?
    `).bind(pnl, price, now, reason, now, trade.id).run();

    await insertFill(env, { tradeId: trade.id, userId: trade.user_id, fillType, price, qty, pnl: pnl - trade.realized_pnl });
    await addBalance(env, trade.user_id, amount);
    await env.DB.prepare(
        'UPDATE paper_account SET total_pnl=total_pnl+?, updated_at=? WHERE user_id=?'
    ).bind(pnl - trade.realized_pnl, now, trade.user_id).run();
}

/**
 * 5분 cron — 모든 오픈 포지션의 현재가 체크 → 분할 추가 / TP / 손절 / 트레일
 */
export async function paperManageAll(env) {
    try {
        const openRes = await env.DB.prepare(
            "SELECT * FROM paper_trades WHERE status='open' ORDER BY created_at ASC LIMIT 50"
        ).all();
        const positions = openRes.results || [];
        if (!positions.length) return;

        // 유니크 심볼 목록으로 현재가 일괄 조회 (crumb 인증 + 프리마켓 포함)
        const symbols = [...new Set(positions.map(p => p.symbol))];
        const prices  = {};
        const now8h   = Date.now() - 8 * 3600 * 1000; // 8시간 이내 봉만 유효
        await Promise.allSettled(symbols.map(async sym => {
            try {
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1d&interval=1m&includePrePost=true`;
                const d = await yfRequest(env.CACHE, url);
                const result = d?.chart?.result?.[0];
                const closes     = result?.indicators?.quote?.[0]?.close || [];
                const timestamps = result?.timestamp || [];
                // 최근 봉부터 역순 탐색 — 8시간 이내 봉만 신뢰 (프리마켓 전 어제 봉 제외)
                for (let i = closes.length - 1; i >= 0; i--) {
                    if (closes[i] != null && closes[i] > 0) {
                        const ts = timestamps[i] ? timestamps[i] * 1000 : 0;
                        if (!ts || ts >= now8h) { prices[sym] = closes[i]; }
                        break;
                    }
                }
                // 봉 없거나 너무 오래됨 → meta 필드 폴백 (프리마켓가 우선)
                if (!prices[sym]) {
                    const meta = result?.meta;
                    const p = meta?.preMarketPrice || meta?.regularMarketPrice;
                    if (p && p > 0) prices[sym] = p;
                }
            } catch (e) { console.warn('[paper-price]', sym, e?.message); }
        }));

        console.log('[paper-manage] positions:', positions.length, 'prices:', JSON.stringify(prices));

        for (const pos of positions) {
            const price = prices[pos.symbol];
            if (!price || price <= 0) {
                console.warn('[paper-manage] no price for', pos.symbol, pos.id);
                continue;
            }
            try {
                await _manageOne(env, pos, price);
            } catch (e) { console.warn('[paper-manage] _manageOne err', pos.symbol, e?.message); }
        }
    } catch (e) { console.error('[paperManageAll]', e?.message); }
}


async function _manageOne(env, pos, price) {
    const now = Date.now();

    // ── 장 마감 자동 청산 (day 트레이드만) ─────────────────────────
    // ET 16:00 = UTC 20:00(EDT) / UTC 21:00(EST) → UTC 20:00 이후 청산
    if (pos.style === 'day') {
        const utcH = new Date(now).getUTCHours();
        if (utcH >= 20) {
            await paperClosePosition(env, pos, price, 'eod_close');
            return;
        }
    }

    // 고점 갱신
    if (!pos.peak_price || price > pos.peak_price) {
        await env.DB.prepare('UPDATE paper_trades SET peak_price=?,updated_at=? WHERE id=?')
            .bind(price, now, pos.id).run();
        pos = { ...pos, peak_price: price };
    }

    // ── 손절 체크 (avg_price × 0.975 이하) ─────────────────────
    if (pos.avg_price && price <= pos.avg_price * STOP_PCT) {
        await paperClosePosition(env, pos, price, 'stop');
        return;
    }

    // ── 수익권 본절 보호 ─────────────────────────────────────────
    // 고점이 avg 대비 +2% 이상을 찍은 뒤 현재가가 avg+0.5% 미만으로 복귀하면 전량 청산
    if (
        pos.avg_price && pos.peak_price &&
        pos.peak_price >= pos.avg_price * BE_PEAK &&
        price < pos.avg_price * BE_EXIT
    ) {
        await paperClosePosition(env, pos, price, 'be_protect');
        return;
    }

    // ── 추가 분할 매수 (2~8차, first_price 기준, 피라미드 비중) ──
    if (pos.tranche_count < MAX_TRANCHE) {
        const nextTrigger = TRANCHE_TRIGGERS[pos.tranche_count];
        if (nextTrigger > 0 && price <= pos.first_price * nextTrigger) {
            const acct = await env.DB.prepare('SELECT balance,position_size FROM paper_account WHERE user_id=?')
                .bind(pos.user_id).first();
            const posSize = acct?.position_size || 10000;
            // tranche_count = 현재 차수 → 다음 차수 인덱스(0-based)로 비중 조회
            const trancheAmount = posSize * TRANCHE_WEIGHTS[pos.tranche_count] / TRANCHE_WEIGHT_SUM;
            if (acct && acct.balance >= trancheAmount) {
                await paperAddTranche(env, pos, price, trancheAmount);
                // pos 갱신 (이후 TP 체크를 위해)
                const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
                if (updated) pos = updated;
            }
        }
    }

    if (!pos.avg_price) return;

    // ── 분할 익절 체크 ──────────────────────────────────────────
    if (!pos.tp1_done && price >= pos.avg_price * TP_PCTS[0]) {
        await paperPartialExit(env, pos, price, 'sell_tp1', TP_RATIO);
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }
    if (pos.tp1_done && !pos.tp2_done && price >= pos.avg_price * TP_PCTS[1]) {
        await paperPartialExit(env, pos, price, 'sell_tp2', TP_RATIO);
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }
    if (pos.tp2_done && !pos.tp3_done && price >= pos.avg_price * TP_PCTS[2]) {
        await paperPartialExit(env, pos, price, 'sell_tp3', TP_RATIO);
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }

    // ── 트레일링 스탑 (TP1 이후, 고점 대비 -1.5%) ──────────────
    if (pos.tp1_done && pos.peak_price && price <= pos.peak_price * TRAIL_PCT) {
        await paperClosePosition(env, pos, price, 'tp4_trail');
    }
}
