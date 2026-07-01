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

// ─── 롱 익절 전략 ────────────────────────────────────────────────────
// 단타: +1% / +2.5% / +5% + 트레일 -0.5%  (리스크 0.8% → R:R 3:1)
const TP_PCTS_DAY   = [1.010, 1.025, 1.050];
const TRAIL_DAY     = 0.995;
// 스윙: +1.5% / +3.5% / +7% + 트레일 -1%
const TP_PCTS_SWING = [1.015, 1.035, 1.070];
const TRAIL_SWING   = 0.990;

// ─── 숏 익절 전략 (짧게 먹기) ────────────────────────────────────────
// 단타: +0.7% / +1.3% / +2% + 트레일 -0.3%  (손절 0.8% → R:R 1.6:1, 빠른 청산)
const TP_PCTS_SHORT_DAY   = [1.007, 1.013, 1.020];
const TRAIL_SHORT_DAY     = 0.997;
// 스윙: +1% / +2% / +3% + 트레일 -0.5%
const TP_PCTS_SHORT_SWING = [1.010, 1.020, 1.030];
const TRAIL_SHORT_SWING   = 0.995;

// 분할 매도 비율 — 원본 수량 기준 균등 4분할
// 25% → 33%(남은량의) → 50%(남은량의) → 나머지 trail
const TP_RATIOS = [0.25, 0.333, 0.50];

// 롱: 충분히 올라야 발동 (노이즈 필터), 숏: 조금만 반등해도 즉시 잠금
const BE_PEAK_LONG  = 1.015;  // 롱 고점 +1.5% 이상 찍어야 활성화 (TP1 중간)
const BE_EXIT_LONG  = 0.995;  // 롱 → 평단 -0.5% 복귀 시 청산 (노이즈 허용)
const BE_PEAK_SHORT = 1.006;  // 숏 저점 -0.6% (현행 유지)
const BE_EXIT_SHORT = 1.0005; // 숏 → 평단 +0.05% 복귀 시 즉시 청산

// ET 시각 (시×60+분) — Intl DST 자동 처리 (EDT/EST 모두 정확)
export function _etTotalMin() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
    return h * 60 + m;
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────

// Telegram 단방향 메시지 — fire-and-forget
// 환경변수: TELEGRAM_BOT_TOKEN (wrangler secret), TELEGRAM_CHAT_ID (wrangler.toml [vars])
export async function _tgDirect(env, text) { return _tg(env, text); }

async function _tg(env, text) {
    const token  = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) { console.warn('[tg] 토큰 또는 chatId 없음'); return; }
    const send = async () => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(5000),
    });
    try {
        let resp = await send();
        // 429 Too Many Requests (rate limit) → 1.2초 대기 후 1회 재시도
        if (resp.status === 429) {
            await new Promise(r => setTimeout(r, 1200));
            resp = await send();
        }
        if (!resp.ok) {
            const body = await resp.text();
            console.error('[tg] 전송 실패', resp.status, body.slice(0, 200));
        }
    } catch (e) { console.error('[tg] fetch 오류', e?.message); }
}

// 가상 매매 알림 — 웹 푸시 + Telegram 동시 발송, fire-and-forget
async function notifyPaper(env, userId, title, body) {
    await _tg(env, `<b>${title}</b>\n${body}`);
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

// 매매 금지 종목 여부 확인 — 자동/수동 매수 진입 전 게이트
export async function isSymbolBlocked(env, symbol) {
    const row = await env.DB.prepare('SELECT 1 FROM paper_blocklist WHERE symbol=?').bind(symbol).first();
    return !!row;
}

/**
 * 1차 분할 진입 — 새 paper_trade 생성
 */
export async function paperOpenTrade(env, { userId, symbol, category, style, dir, price, qty, signalId = null, grade = null, score = null, stopPrice = null }) {
    const now = Date.now();
    const amount = price * qty;
    // 기본: 롱 진입가 -0.8% / 숏 진입가 +0.8% (단타용 타이트 손절)
    // stopPrice 제공 시(스윙/일봉 신호의 ATR 기준 손절) 방향이 올바르면 그대로 사용 —
    // 일봉 변동폭엔 고정 -0.8%가 너무 타이트해 정상 노이즈에도 바로 청산되기 때문.
    const fixedStop = dir === 'short' ? price * (2 - STOP_FROM_FIRST) : price * STOP_FROM_FIRST;
    const stopValid = stopPrice > 0 && (dir === 'short' ? stopPrice > price : stopPrice < price);
    const stop = stopValid ? stopPrice : fixedStop;

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
    }
    const dirLabel = dir === 'short' ? '숏' : '롱';
    if (tradeId) {
        await notifyPaper(env, userId,
            `📈 가상매매 ${dirLabel} 진입 [${grade || '?'}]`,
            `${symbol} $${price.toFixed(2)} × ${qty}주\n투자금: $${amount.toFixed(0)} | 손절: $${stop.toFixed(2)} | ${style}`
        );
    }
    return { tradeId, userId };
}

/**
 * 추가 분할 매수 (2차~4차)
 * @param {number} trancheAmount - 이번 분할 매수 금액 (호출자가 계산해서 전달)
 */
export async function paperAddTranche(env, trade, price, trancheAmount) {
    const trancheNum = trade.tranche_count + 1;
    const fillType = `buy_t${trancheNum}`;
    const qty = Math.floor(trancheAmount / price);
    if (qty < 1) return; // 1주 미만 — 추가 분할 스킵
    const amount = price * qty;

    const newTotalQty      = trade.total_qty + qty;
    const newTotalInvested = trade.total_invested + amount;
    const newAvgPrice      = newTotalInvested / newTotalQty;
    const newStop = trade.dir === 'short'
        ? trade.first_price * (2 - STOP_FROM_FIRST)
        : trade.first_price * STOP_FROM_FIRST;
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
    await notifyPaper(env, trade.user_id,
        `📈 가상매매 추가매수`,
        `${trade.symbol} ${trancheNum}차 분할 $${price.toFixed(2)} | 평단 $${newAvgPrice.toFixed(2)}`
    );
}

/**
 * 분할 익절 — TP1·TP2·TP3 각 1/4 청산
 * ratio: 남은 수량의 비율 (0.25 = 25%)
 */
export async function paperPartialExit(env, trade, price, fillType, ratio) {
    const qty = Math.floor(trade.total_qty * ratio);
    if (qty < 1) return; // 잔량 없으면 스킵
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
    await notifyPaper(env, trade.user_id,
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
    await notifyPaper(env, trade.user_id, title,
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

        // 2차 폴백: 차트 fetch 실패 심볼 → v7 quote API (marketState 기반 프리/포스트 가격 선택)
        const failedSyms = symbols.filter(s => !prices[s]);
        if (failedSyms.length) {
            try {
                const qUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${failedSyms.join(',')}`;
                const qd = await yfRequest(env.CACHE, qUrl);
                for (const q of (qd?.quoteResponse?.result || [])) {
                    if (!q.symbol) continue;
                    const state = q.marketState || 'REGULAR';
                    const p = state === 'PRE'
                        ? (q.preMarketPrice || q.regularMarketPrice || 0)
                        : (state === 'POST' || state === 'POSTPOST')
                        ? (q.postMarketPrice || q.regularMarketPrice || 0)
                        : (q.regularMarketPrice || 0);
                    if (p > 0) prices[q.symbol] = p;
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

    // ── 중단기 스윙(일봉 기반) 최대 보유 45일 자동 청산 ──────────────────
    // "최대한 길게 가져간다" 방침 — 손절/트레일링 스탑에 걸리지 않는 한 억지로 빨리 안 끊음.
    // 그래도 무기한 방치는 계좌 회전 막으니 45거래일(~2개월) 상한은 유지.
    if (pos.style === 'swing') {
        const ageMs = now - pos.created_at;
        if (ageMs > 45 * 24 * 3600 * 1000) {
            await paperClosePosition(env, pos, price, 'timeout');
            return;
        }
    }

    const isShort = pos.dir === 'short';

    // 극값 갱신 — 롱: 고점(최고가) / 숏: 저점(최저가)
    const newPeak = !pos.peak_price || (isShort ? price < pos.peak_price : price > pos.peak_price);
    if (newPeak) {
        await env.DB.prepare('UPDATE paper_trades SET peak_price=?,updated_at=? WHERE id=?')
            .bind(price, now, pos.id).run();
        pos = { ...pos, peak_price: price };
    }

    // ── 손절 체크 ─────────────────────────────────────────────────
    const stopPx = pos.stop_price ?? (isShort ? pos.avg_price * (2 - STOP_FROM_FIRST) : pos.avg_price * STOP_FROM_FIRST);
    const hitStop = isShort ? price >= stopPx : price <= stopPx;
    if (pos.avg_price && hitStop) {
        await paperClosePosition(env, pos, price, 'stop');
        return;
    }

    // ── 본전 근처 즉시 청산 (TP1 미발동 포지션 보호) ─────────────────
    if (!pos.tp1_done && pos.avg_price) {
        const retPct = (price - pos.avg_price) / pos.avg_price * (isShort ? -1 : 1);

        // ① 극값 기반: 충분히 수익 찍고 평단 복귀 → 청산
        // 롱: +1.5% 이상 찍어야 발동 (노이즈 허용) / 숏: -0.6% 저점 찍으면 즉시 잠금
        const peakOk = pos.peak_price && (isShort
            ? pos.peak_price <= pos.avg_price * (2 - BE_PEAK_SHORT)
            : pos.peak_price >= pos.avg_price * BE_PEAK_LONG);
        const exitOk = isShort
            ? price >= pos.avg_price * BE_EXIT_SHORT  // 숏: 평단 +0.05% 복귀 시 즉시
            : price < pos.avg_price * BE_EXIT_LONG;   // 롱: 평단 -0.5% 복귀 시
        if (peakOk && exitOk) {
            await paperClosePosition(env, pos, price, 'be_protect');
            return;
        }

        // ② 시간 기반 — 스윙(일봉)은 7일(10080분)간 무변동이어야 방치 판단, 단타는 기존 60분 유지
        // "최대한 길게" 방침 — 며칠 횡보는 정상 범주로 보고 조기 청산하지 않음
        const ageMin        = (now - pos.created_at) / 60000;
        const timeLimit     = pos.style === 'swing' ? 10080 : 60;
        const regularOpened = pos.style === 'day' ? _etTotalMin() >= 9 * 60 + 40 : true;
        if (ageMin >= timeLimit && Math.abs(retPct) <= 0.003 && regularOpened) {
            await paperClosePosition(env, pos, price, 'be_protect');
            return;
        }
    }

    // ── 추가 분할 (2차) — 롱: 하락 시 / 숏: 상승 시 ──────────────
    if (pos.tranche_count < MAX_TRANCHE && !pos.tp1_done) {
        const nextTrigger = TRANCHE_TRIGGERS[pos.tranche_count];
        const triggerHit  = isShort
            ? price >= pos.first_price * (2 - nextTrigger)  // 숏: 진입 후 +0.2% 반등
            : price <= pos.first_price * nextTrigger;        // 롱: 진입 후 -0.2% 하락
        if (nextTrigger > 0 && triggerHit) {
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

    // ── 분할 익절 — 롱: 크게 / 숏: 짧게 ────────────────────────────
    const tpPcts   = isShort
        ? (pos.style === 'swing' ? TP_PCTS_SHORT_SWING : TP_PCTS_SHORT_DAY)
        : (pos.style === 'swing' ? TP_PCTS_SWING       : TP_PCTS_DAY);
    const trailPct = isShort
        ? (pos.style === 'swing' ? TRAIL_SHORT_SWING : TRAIL_SHORT_DAY)
        : (pos.style === 'swing' ? TRAIL_SWING       : TRAIL_DAY);

    // TP 히트 판정: 롱=가격상승 / 숏=가격하락
    const hitTP = (n) => isShort
        ? price <= pos.avg_price * (2 - tpPcts[n])   // 숏: 하락이 목표
        : price >= pos.avg_price * tpPcts[n];         // 롱: 상승이 목표

    // TP1: 25% 익절 → 손절가를 본전으로 이동
    if (!pos.tp1_done && hitTP(0)) {
        await paperPartialExit(env, pos, price, 'sell_tp1', TP_RATIOS[0]);
        const newStop = isShort ? pos.avg_price * (2 - 1.000) : pos.avg_price; // 숏 본전=avg*(2-1)=avg
        await env.DB.prepare('UPDATE paper_trades SET stop_price=?,updated_at=? WHERE id=?')
            .bind(newStop, Date.now(), pos.id).run();
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }
    // TP2: 33% 익절 → 손절가 +1% 상향
    if (pos.tp1_done && !pos.tp2_done && hitTP(1)) {
        await paperPartialExit(env, pos, price, 'sell_tp2', TP_RATIOS[1]);
        const newStop = isShort ? pos.avg_price * (2 - 1.010) : pos.avg_price * 1.01;
        await env.DB.prepare('UPDATE paper_trades SET stop_price=?,updated_at=? WHERE id=?')
            .bind(newStop, Date.now(), pos.id).run();
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }
    // TP3: 50% 익절 → 나머지 트레일
    if (pos.tp2_done && !pos.tp3_done && hitTP(2)) {
        await paperPartialExit(env, pos, price, 'sell_tp3', TP_RATIOS[2]);
        const updated = await env.DB.prepare('SELECT * FROM paper_trades WHERE id=?').bind(pos.id).first();
        if (updated) pos = updated;
    }

    // ── 트레일링 스탑 (TP1 이후) — 롱: 고점 -0.5% / 숏: 저점 +0.5% ──
    if (pos.tp1_done && pos.peak_price) {
        const hitTrail = isShort
            ? price >= pos.peak_price / trailPct   // 숏: 저점에서 +0.5% 반등
            : price <= pos.peak_price * trailPct;  // 롱: 고점에서 -0.5% 하락
        if (hitTrail) await paperClosePosition(env, pos, price, 'tp4_trail');
    }
}
