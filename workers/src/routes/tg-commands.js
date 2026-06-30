// Telegram 봇 명령어 처리 — 매수/매도/포지션 조회
// 보안: chatId 검증 (env.TELEGRAM_CHAT_ID 만 허용)
import { paperOpenTrade, paperClosePosition, _tgDirect } from '../utils/paper-engine.js';
import { classifySymbol } from '../utils/paper-category.js';

export async function handleTgWebhook(req, env) {
    let body;
    try { body = await req.json(); } catch { return new Response('ok'); }

    const msg = body?.message;
    if (!msg) return new Response('ok');

    const chatId = String(msg.chat?.id || '');
    if (chatId !== String(env.TELEGRAM_CHAT_ID)) return new Response('ok'); // 타인 차단

    const text = (msg.text || '').trim();
    const [cmd, sym] = text.split(/\s+/);
    const symbol = sym?.toUpperCase();

    if (cmd === '현황' || cmd === '/현황') {
        await _sendOverview(env);
    } else if (cmd === '포지션' || cmd === '/포지션') {
        await _sendPositions(env);
    } else if (cmd === '스캔' || cmd === '/스캔') {
        await _sendScanResults(env);
    } else if ((cmd === '매수' || cmd === '/매수') && symbol) {
        await _manualBuy(env, symbol);
    } else if ((cmd === '매도' || cmd === '/매도') && symbol) {
        await _manualSell(env, symbol);
    } else {
        await _tgDirect(env,
            '사용법:\n• 현황 — 전체 수익률\n• 스캔 — 오늘 시그널 목록\n• 포지션 — 보유 포지션\n• 매수 TQQQ\n• 매도 TQQQ'
        );
    }

    return new Response('ok');
}

async function _fetchPrice(env, symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
}

async function _manualBuy(env, symbol) {
    const price = await _fetchPrice(env, symbol);
    if (!price) { await _tgDirect(env, `❌ ${symbol} 현재가 조회 실패`); return; }

    const acct = await env.DB.prepare(
        "SELECT * FROM paper_account WHERE user_id=?"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first();
    if (!acct) { await _tgDirect(env, '❌ 계좌 없음'); return; }

    const category = classifySymbol(symbol, price, 0) || 'mid_small';
    const qty = (acct.position_size || 25000) * (2 / 3) / price; // 1차 2/3 트랜쉐

    const result = await paperOpenTrade(env, {
        userId: acct.user_id, symbol, category, style: 'day',
        dir: 'long', price, qty, signalId: null, grade: 'M', score: null,
    });

    if (result?.notifyTitle) {
        await _tgDirect(env, `<b>${result.notifyTitle}</b>\n${result.notifyBody}`);
    } else {
        await _tgDirect(env, `✅ ${symbol} 수동 매수 완료 @ $${price.toFixed(2)}`);
    }
}

async function _manualSell(env, symbol) {
    const trade = await env.DB.prepare(
        "SELECT * FROM paper_trades WHERE user_id=? AND symbol=? AND status='open' ORDER BY created_at DESC LIMIT 1"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp', symbol).first();

    if (!trade) { await _tgDirect(env, `❌ ${symbol} 오픈 포지션 없음`); return; }

    const price = await _fetchPrice(env, symbol);
    if (!price) { await _tgDirect(env, `❌ ${symbol} 현재가 조회 실패`); return; }

    await paperClosePosition(env, trade, price, 'manual');
    const pnl = ((price - trade.avg_price) * trade.total_qty * (trade.dir === 'short' ? -1 : 1)).toFixed(0);
    await _tgDirect(env, `✅ ${symbol} 수동 매도 @ $${price.toFixed(2)}\n손익: ${pnl > 0 ? '+' : ''}$${pnl}`);
}

async function _sendOverview(env) {
    const SEED = 100000;

    const acct = await env.DB.prepare(
        "SELECT balance, total_pnl FROM paper_account WHERE user_id=?"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first();

    const [stats, openRows] = await Promise.all([
        env.DB.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) as wins,
                ROUND(SUM(realized_pnl), 2) as total_pnl,
                ROUND(MAX(realized_pnl), 2) as best,
                ROUND(MIN(realized_pnl), 2) as worst
            FROM paper_trades WHERE status='closed'
        `).first(),
        env.DB.prepare(
            "SELECT symbol, dir, avg_price, total_qty FROM paper_trades WHERE user_id=? AND status='open'"
        ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').all(),
    ]);

    // 오픈 포지션 현재가로 미실현 손익 계산
    const opens = openRows.results || [];
    let unrealized = 0;
    if (opens.length) {
        const prices = await Promise.all(opens.map(p => _fetchPrice(env, p.symbol)));
        opens.forEach((p, i) => {
            if (prices[i]) {
                const mult = p.dir === 'short' ? -1 : 1;
                unrealized += (prices[i] - p.avg_price) * p.total_qty * mult;
            }
        });
    }

    const cash       = acct?.balance ?? SEED;
    const invested   = opens.reduce((s, p) => s + p.avg_price * p.total_qty, 0);
    const totalAsset = cash + invested + unrealized;
    const totalRet   = ((totalAsset - SEED) / SEED * 100).toFixed(2);
    const realizedRet = ((stats?.total_pnl ?? 0) / SEED * 100).toFixed(2);
    const winRate    = stats?.total ? ((stats.wins / stats.total) * 100).toFixed(0) : 0;
    const sign       = totalRet >= 0 ? '+' : '';

    const lines = [
        `💹 <b>가상매매 현황</b>`,
        ``,
        `시드     $${SEED.toLocaleString()}`,
        `총자산   $${Math.round(totalAsset).toLocaleString()} (${sign}${totalRet}%)`,
        `현금     $${Math.round(cash).toLocaleString()}`,
        unrealized ? `미실현   ${unrealized >= 0 ? '+' : ''}$${Math.round(unrealized)}` : null,
        ``,
        `실현손익 ${stats?.total_pnl >= 0 ? '+' : ''}$${stats?.total_pnl ?? 0} (${realizedRet}%)`,
        `승률     ${winRate}% (${stats?.wins ?? 0}/${stats?.total ?? 0}건)`,
        `최대익절 +$${stats?.best ?? 0}`,
        `최대손절 $${stats?.worst ?? 0}`,
    ].filter(l => l !== null).join('\n');

    await _tgDirect(env, lines);
}

async function _sendScanResults(env) {
    const since = Date.now() - 8 * 60 * 60 * 1000; // 최근 8시간
    const rows = await env.DB.prepare(`
        SELECT symbol, tf, dir, grade, score, entry, stop
        FROM dt_signals
        WHERE created_at > ? AND grade IN ('S','A')
        ORDER BY created_at DESC
        LIMIT 20
    `).bind(since).all();

    const signals = rows.results || [];
    if (!signals.length) { await _tgDirect(env, '📭 최근 8시간 S/A 시그널 없음'); return; }

    const lines = signals.map(s => {
        const dir  = s.dir === 'buy' ? '🟢매수' : '🔴매도';
        const tf   = s.tf === '5m' ? '단타' : '스윙';
        const entry = s.entry ? ` $${Number(s.entry).toFixed(2)}` : '';
        const stop  = s.stop  ? ` 손절$${Number(s.stop).toFixed(2)}` : '';
        return `${dir} ${s.symbol} [${s.grade}${s.score}/${tf}]${entry}${stop}`;
    });
    await _tgDirect(env, `📡 오늘 스캔 결과 (${signals.length}건)\n\n${lines.join('\n')}`);
}

async function _sendPositions(env) {
    const rows = await env.DB.prepare(
        "SELECT symbol,dir,avg_price,total_qty,total_invested,realized_pnl,style FROM paper_trades WHERE user_id=? AND status='open' ORDER BY created_at DESC"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').all();

    const positions = rows.results || [];
    if (!positions.length) { await _tgDirect(env, '📭 오픈 포지션 없음'); return; }

    // 현재가 병렬 조회
    const prices = await Promise.all(positions.map(p => _fetchPrice(env, p.symbol)));

    const lines = positions.map((p, i) => {
        const cur   = prices[i];
        const dir   = p.dir === 'short' ? '숏' : '롱';
        const mult  = p.dir === 'short' ? -1 : 1;
        const pnl   = cur ? ((cur - p.avg_price) * p.total_qty * mult).toFixed(0) : null;
        const chgPct = cur ? ((cur - p.avg_price) / p.avg_price * mult * 100).toFixed(2) : null;
        const sign  = pnl > 0 ? '+' : '';
        const curStr = cur ? `현재$${cur.toFixed(2)} (${sign}${chgPct}%)` : '현재가 조회실패';
        const pnlStr = pnl != null ? ` | 미실현 ${sign}$${pnl}` : '';
        return `• ${p.symbol} ${dir} [${p.style}]\n  평단 $${p.avg_price.toFixed(2)} → ${curStr}${pnlStr}`;
    });
    await _tgDirect(env, `📊 오픈 포지션 (${positions.length}건)\n\n${lines.join('\n\n')}`);
}
