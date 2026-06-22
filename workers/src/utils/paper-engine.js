// 가상 매매 포지션 관리 엔진
// 전문 단타 트레이더 전략 — 2분할 확인 진입 / 타이트 손절 -0.8% / R:R 3:1 목표

import { yfRequest } from './crumb.js';
import { sendPush } from './vapid.js';

// 전문 단타 진입: 1차(67%) 즉시, 2차(33%) -0.2% 눌림 확인
// 물타기 금지 — 손절은 빠르고, 이기는 매매는 길게
const TRANCHE_TRIGGERS = [0, 0.998]; // 1차 즉시, 2차 -0.2%
export const MAX_TRANCHE        = 2;
export const TRANCHE_WEIGHTS    = [2, 1]; // 1차 2유닛(67%), 2차 1유닛(33%)
export const TRANCHE_WEIGHT_SUM = 3;
// 손절: first_price -0.8% (타이트) — 2차 분할(-0.2%)보다 0.6% 더 낮아야 2차가 먼저 실행됨
const STOP_FROM_FIRST = 0.992;

// ─── 전문 단타 익절 전략 ─────────────────────────────────────────────
// 단타 (day/5m): +1% / +2.5% / +5% + 고점 -0.5% 타이트 트레일
// 리스크 0.8% : 리워드 평균 2.4% → R:R 3:1
const TP_PCTS_DAY   = [1.010, 1.025, 1.050]; // TP1 +1% / TP2 +2.5% / TP3 +5%
const TRAIL_DAY     = 0.995;                  // 고점 대비 -0.5%

// 단기 스윙 (swing/15m): 더 큰 목표 + 여유 트레일
const TP_PCTS_SWING = [1.015, 1.035, 1.070]; // TP1 +1.5% / TP2 +3.5% / TP3 +7%
const TRAIL_SWING   = 0.990;                  // 고점 대비 -1%

// 분할 매도 비율 — 원본 수량 기준 균등 4분할
// 25% → 33%(남은량의) → 50%(남은량의) → 나머지 trail
const TP_RATIOS = [0.25, 0.333, 0.50];

const BE_PEAK = 1.003; // 고점 +0.3% → 수익권 진입 확인 (빠른 보호)
const BE_EXIT = 1.000; // avg 이하 복귀 → 즉시 본전 청산 (0% = 비용 이하)

// ET 시각 (시×60+분) — Intl DST 자동 처리 (EDT/EST 모두 정확)
function _etTotalMin() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
    return h * 60 + m;
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────

// 가상 매매 푸시 알림 — fire-and-forget, 실패해도 거래 블록 안 함
async function notifyPaper(env, userId, title, body) {
    try {
        const subs = await env.DB.prepare(
            'SELECT endpoint, p256dh, auth FROM push_subscribers WHERE user_id=?'
        ).bind(userId).all();
        if (!subs.results?.length) return;
        const payload = JSON.stringify({ title, body, url: '/#profile', tag: 'paper-trade' });
        await Promise.allSettled(
            subs.results.map(s =>
                sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, env)
            )
        );
    } catch (e) { console.warn('[paper-notify]', e?.message); }
}

function calcPnl(avgPrice, exitPrice, qty, dir) {
    const sign = dir === 'long' ? 1 : -1;
    return sign * (exitPrice - avgPrice) * qty;
}

// ── 공개 API ─────────────────────────────────────────────────────

/**
 * 1차 분할 진입 — 새 paper_trade 생성
 */
export async function paperOpenTrade(env, { userId, symbol, category, style, dir, price, qty, signalId = null, grade = null, score = null }) {
    const now = Date.now();
    const amount = price * qty;
    const stop = price * STOP_FROM_FIRST;

    const res = await env.DB.prepare(`
        INSERT INTO paper_trades
          (user_id,symbol,category,style,dir,tranche_count,first_price,avg_price,total_qty,total_invested,stop_price,signal_id,grade,score,created_at,updated_at)
        VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)
    `).bind(userId, symbol, category, style, dir, price, price, qty, amount, stop, signalId, grade, score, now, now).run();

    const tradeId = res.meta?.last_row_id;
    if (tradeId) {
        // batch — fill 삽입 + 잔고 차감 원자적 실행 (trade INSERT와 last_row_id 필요로 분리 불가)
        await env.DB.batch([
            env.DB.prepare(
                'INSERT INTO paper_fills (trade_id,user_id,fill_type,price,qty,amount,pnl,filled_at) VALUES (?,?,?,?,?,?,0,?)'
            ).bind(tradeId, userId, 'buy_t1', price, qty, amount, now),
            env.DB.prepare(
                'UPDATE paper_account SET balance=balance-?,updated_at=? WHERE user_id=?'
            ).bind(amount, now, userId),
        ]);
        notifyPaper(env, userId,
            `📈 가상매매 매수`,
            `${symbol} 1차 진입 $${price.toFixed(2)} | $${amount.toFixed(0)} (${category})`
        );
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
    const newStop          = trade.first_price * STOP_FROM_FIRST;
    const now = Date.now();

    // batch — trade 갱신 + fill 삽입 + 잔고 차감을 원자적으로 실행
    await env.DB.batch([
        env.DB.prepare(
            'UPDATE paper_trades SET tranche_count=?,avg_price=?,total_qty=?,total_invested=?,stop_price=?,updated_at=? WHERE id=?'
        ).bind(trancheNum, newAvgPrice, newTotalQty, newTotalInvested, newStop, now, trade.id),
        env.DB.prepare(
            'INSERT INTO paper_fills (trade_id,user_id,fill_type,price,qty,amount,pnl,filled_at) VALUES (?,?,?,?,?,?,0,?)'
        ).bind(trade.id, trade.user_id, fillType, price, qty, amount, now),
        env.DB.prepare(
            'UPDATE paper_account SET balance=balance-?,updated_at=? WHERE user_id=?'
        ).bind(amount, now, trade.user_id),
    ]);
    notifyPaper(env, trade.user_id,
        `📈 가상매매 추가매수`,
        `${trade.symbol} ${trancheNum}차 분할 $${price.toFixed(2)} | 평단 $${newAvgPrice.toFixed(2)}`
    );
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

    // batch — trade 갱신 + fill 삽입 + 잔고·총손익 업데이트를 원자적으로 실행
    await env.DB.batch([
        env.DB.prepare(
            `UPDATE paper_trades SET total_qty=total_qty-?,realized_pnl=realized_pnl+?,${tpField}=1,updated_at=? WHERE id=?`
        ).bind(qty, pnl, now, trade.id),
        env.DB.prepare(
            'INSERT INTO paper_fills (trade_id,user_id,fill_type,price,qty,amount,pnl,filled_at) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(trade.id, trade.user_id, fillType, price, qty, amount, pnl, now),
        env.DB.prepare(
            'UPDATE paper_account SET balance=balance+?,total_pnl=total_pnl+?,updated_at=? WHERE user_id=?'
        ).bind(amount, pnl, now, trade.user_id),
    ]);
    const tpLabel = fillType === 'sell_tp1' ? 'TP1' : fillType === 'sell_tp2' ? 'TP2' : 'TP3';
    const pnlStr  = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(0);
    notifyPaper(env, trade.user_id,
        `💰 가상매매 익절`,
        `${trade.symbol} ${tpLabel} $${price.toFixed(2)} | ${pnlStr}`
    );
}

/**
 * 전량 청산 — 손절·트레일·수동
 */
export async function paperClosePosition(env, trade, price, reason) {
    const qty     = trade.total_qty;
    const amount  = price * qty;
    const thisPnl = calcPnl(trade.avg_price, price, qty, trade.dir); // 이번 청산분만
    const totalPnl = thisPnl + trade.realized_pnl;                   // 분할익절 누적 포함
    const now     = Date.now();

    const fillType =
        reason === 'stop'       ? 'sell_stop' :
        reason === 'tp4_trail'  ? 'sell_trail' :
        reason === 'be_protect' ? 'sell_be_protect' :
        reason === 'eod_close'  ? 'sell_eod' :
        reason === 'timeout'    ? 'sell_timeout' :
        'sell_manual';

    // batch — 4개 문을 원자적으로 실행 (부분 실패로 fill 누락·잔고 불일치 방지)
    await env.DB.batch([
        env.DB.prepare(
            `UPDATE paper_trades SET status='closed',total_qty=0,realized_pnl=?,exit_price=?,exit_at=?,close_reason=?,updated_at=? WHERE id=?`
        ).bind(totalPnl, price, now, reason, now, trade.id),
        env.DB.prepare(
            'INSERT INTO paper_fills (trade_id,user_id,fill_type,price,qty,amount,pnl,filled_at) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(trade.id, trade.user_id, fillType, price, qty, amount, thisPnl, now),
        env.DB.prepare(
            'UPDATE paper_account SET balance=balance+?,total_pnl=total_pnl+?,updated_at=? WHERE user_id=?'
        ).bind(amount, thisPnl, now, trade.user_id),
    ]);

    const pnlStr = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(0);
    const titleMap = {
        stop:       `🔴 가상매매 손절`,
        tp4_trail:  `✅ 가상매매 트레일 청산`,
        be_protect: `🛡 가상매매 본전 청산`,
        eod_close:  `🔔 가상매매 장마감 청산`,
        timeout:    `⏰ 가상매매 타임아웃 청산`,
    };
    const title = titleMap[reason] || `📋 가상매매 청산`;
    notifyPaper(env, trade.user_id, title,
        `${trade.symbol} $${price.toFixed(2)} | ${pnlStr}`
    );
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

        // 2차 폴백: 차트 fetch 실패 심볼 → v7 quote API (장마감 후 regularMarketPrice 더 안정적)
        const failedSyms = symbols.filter(s => !prices[s]);
        if (failedSyms.length) {
            try {
                const qUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${failedSyms.join(',')}&fields=regularMarketPrice`;
                const qd = await yfRequest(env.CACHE, qUrl);
                for (const q of (qd?.quoteResponse?.result || [])) {
                    if (q.symbol && q.regularMarketPrice > 0) prices[q.symbol] = q.regularMarketPrice;
                }
            } catch (e) { console.warn('[paper-price] quote fallback', e?.message); }
        }

        console.log('[paper-manage] positions:', positions.length, 'prices:', JSON.stringify(prices));

        const isEOD = _etTotalMin() >= 16 * 60; // ET 16:00 이후 = 정규장 마감 (DST 자동)
        for (const pos of positions) {
            let price = prices[pos.symbol];

            // day 트레이드 + 장마감(ET 16:00 이후): 가격 없어도 avg_price 폴백으로 EOD 강제 청산
            // → crumb 만료·데이터 지연으로 가격 못 받아도 자정까지 끌리지 않도록
            if (pos.style === 'day' && isEOD) {
                const closePrice = (price && price > 0) ? price : pos.avg_price;
                if (closePrice && closePrice > 0) {
                    try { await _manageOne(env, pos, closePrice); }
                    catch (e) { console.warn('[paper-manage] eod err', pos.symbol, e?.message); }
                } else {
                    console.warn('[paper-manage] EOD 가격 없음(avg도 없음)', pos.symbol, pos.id);
                }
                continue; // 장마감 후 day 포지션은 반드시 여기서 처리 종료
            }

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

    // ── 장 마감 자동 청산 (day 트레이드만) — Intl DST 자동 처리 ──────
    // UTC 20 고정값은 EST(겨울)에서 3 PM ET로 1시간 조기 청산됨 → Intl로 수정
    if (pos.style === 'day' && _etTotalMin() >= 16 * 60) {
        await paperClosePosition(env, pos, price, 'eod_close');
        return;
    }

    // ── 단기 스윙 최대 보유 3일 자동 청산 ──────────────────────────
    if (pos.style === 'swing') {
        const ageMs = now - pos.created_at;
        if (ageMs > 3 * 24 * 3600 * 1000) {
            await paperClosePosition(env, pos, price, 'timeout');
            return;
        }
    }

    // 고점 갱신
    if (!pos.peak_price || price > pos.peak_price) {
        await env.DB.prepare('UPDATE paper_trades SET peak_price=?,updated_at=? WHERE id=?')
            .bind(price, now, pos.id).run();
        pos = { ...pos, peak_price: price };
    }

    // ── 손절 체크 ─────────────────────────────────────────────────
    // DB stop_price 사용 (항상 first_price -2.5% / TP1 후 본전·이상으로 상향됨)
    const stopPx = pos.stop_price ?? pos.avg_price * STOP_FROM_FIRST;
    if (pos.avg_price && price <= stopPx) {
        await paperClosePosition(env, pos, price, 'stop');
        return;
    }

    // ── 본전 근처 즉시 청산 (TP1 미발동 포지션 보호) ─────────────────
    if (!pos.tp1_done && pos.avg_price) {
        const retPct = (price - pos.avg_price) / pos.avg_price;

        // ① 고점 기반: peak +0.5% 이상 찍고 현재 +0.1% 미만 복귀 → 즉시 청산
        if (
            pos.peak_price &&
            pos.peak_price >= pos.avg_price * BE_PEAK &&
            price < pos.avg_price * BE_EXIT
        ) {
            await paperClosePosition(env, pos, price, 'be_protect');
            return;
        }

        // ② 시간 기반: 크론 고점 누락 보완 — 일정 시간 경과 후 본전 ±0.3% 내면 청산
        // 단타 30분 / 스윙 4시간. 단타는 정규장 오픈(9:40 ET) 이후에만 동작
        // → 프리마켓 진입(예: 오전 4시)이 오픈 전 30분 만에 청산되는 문제 방지
        const ageMin        = (now - pos.created_at) / 60000;
        const timeLimit     = pos.style === 'swing' ? 240 : 30;
        const regularOpened = pos.style === 'day' ? _etTotalMin() >= 9 * 60 + 40 : true;
        if (ageMin >= timeLimit && Math.abs(retPct) <= 0.003 && regularOpened) {
            await paperClosePosition(env, pos, price, 'be_protect');
            return;
        }
    }

    // ── 추가 분할 매수 (2~4차, first_price 기준, 균등 비중) ──
    if (pos.tranche_count < MAX_TRANCHE && !pos.tp1_done) {
        const nextTrigger = TRANCHE_TRIGGERS[pos.tranche_count];
        if (nextTrigger > 0 && price <= pos.first_price * nextTrigger) {
            const acct = await env.DB.prepare('SELECT balance,position_size FROM paper_account WHERE user_id=?')
                .bind(pos.user_id).first();
            const posSize = acct?.position_size || 10000;
            const trancheAmount = posSize * TRANCHE_WEIGHTS[pos.tranche_count] / TRANCHE_WEIGHT_SUM;
            if (acct && acct.balance >= trancheAmount) {
                await paperAddTranche(env, pos, price, trancheAmount);
                const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
                if (updated) pos = updated;
            }
        }
    }

    if (!pos.avg_price) return;

    // ── 분할 익절 — 스타일별 목표가 / 25:25:25:25 균등 4분할 ──────
    const tpPcts   = pos.style === 'swing' ? TP_PCTS_SWING : TP_PCTS_DAY;
    const trailPct = pos.style === 'swing' ? TRAIL_SWING   : TRAIL_DAY;

    // TP1: 보유량 25% 익절 → 손절가를 본전(avg)으로 이동 (남은 75% 무위험)
    if (!pos.tp1_done && price >= pos.avg_price * tpPcts[0]) {
        await paperPartialExit(env, pos, price, 'sell_tp1', TP_RATIOS[0]);
        await env.DB.prepare('UPDATE paper_trades SET stop_price=?,updated_at=? WHERE id=?')
            .bind(pos.avg_price, Date.now(), pos.id).run();
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }
    // TP2: 남은량의 33% (원본 ~25%) 익절 → 손절가를 +1%(avg)로 상향
    if (pos.tp1_done && !pos.tp2_done && price >= pos.avg_price * tpPcts[1]) {
        await paperPartialExit(env, pos, price, 'sell_tp2', TP_RATIOS[1]);
        await env.DB.prepare('UPDATE paper_trades SET stop_price=?,updated_at=? WHERE id=?')
            .bind(pos.avg_price * 1.01, Date.now(), pos.id).run();
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }
    // TP3: 남은량의 50% (원본 ~25%) 익절 → 나머지 ~25% 트레일에 맡김
    if (pos.tp2_done && !pos.tp3_done && price >= pos.avg_price * tpPcts[2]) {
        await paperPartialExit(env, pos, price, 'sell_tp3', TP_RATIOS[2]);
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }

    // ── 트레일링 스탑 (TP1 이후 활성화, 스타일별 비율) ────────────
    if (pos.tp1_done && pos.peak_price && price <= pos.peak_price * trailPct) {
        await paperClosePosition(env, pos, price, 'tp4_trail');
    }
}
