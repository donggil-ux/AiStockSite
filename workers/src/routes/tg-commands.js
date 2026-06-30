// Telegram 봇 명령어 처리 — 매수/매도/포지션 조회
// 보안: chatId 검증 (env.TELEGRAM_CHAT_ID 만 허용)
import { paperOpenTrade, paperClosePosition, _tgDirect } from '../utils/paper-engine.js';
import { classifySymbol } from '../utils/paper-category.js';
import { smartDipScan, smartDipScanBounce } from '../utils/smart-dip.js';
import { yfRequest } from '../utils/crumb.js';
import { calcEMA } from '../utils/indicators.js';

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

    try {
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
        } else if ((cmd === '분석' || cmd === '/분석') && symbol) {
            await _analyzeSymbol(env, symbol);
        } else if (cmd === '스캐너' || cmd === '/스캐너') {
            const customSymbols = text.split(/\s+/).slice(1).map(s => s.toUpperCase()).filter(Boolean);
            await _liveScan(env, customSymbols);
        } else {
            await _tgDirect(env,
                '사용법:\n• 현황 — 전체 수익률\n• 스캔 — 오늘 시그널 목록\n• 포지션 — 보유 포지션\n• 매수 TQQQ\n• 매도 TQQQ\n• 분석 NVDA — 종목 분석\n• 스캐너 — 실시간 매수 스캔 (스캐너 NVDA TSLA 로 직접 지정 가능)'
            );
        }
    } catch (e) {
        console.error('[tg-webhook] cmd error', cmd, e?.message);
        try { await _tgDirect(env, `⚠️ 오류 발생: ${e?.message?.slice(0,100) || '알 수 없는 오류'}`); } catch (_) {}
    }

    return new Response('ok');
}


// /v7/finance/quote — handlePrice 와 동일한 URL 패턴 (fields 파라미터 없이 모든 필드 반환)
// fields= 를 추가하면 preMarketPrice 등이 누락될 수 있고 캐시 키도 달라짐
async function _quotePrice(env, symbols) {
    try {
        const syms = Array.isArray(symbols) ? symbols : [symbols];
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${syms.map(encodeURIComponent).join(',')}`;
        const data = await yfRequest(env.CACHE, url);
        const out = {};
        for (const q of data?.quoteResponse?.result || []) {
            const state = q.marketState || 'REGULAR';
            // 시장 상태에 맞는 현재가 선택 (프리/포스트마켓 가격이 정규장 중에도 필드에 남아있음)
            const price = state === 'PRE'
                ? (q.preMarketPrice || q.regularMarketPrice || 0)
                : (state === 'POST' || state === 'POSTPOST')
                ? (q.postMarketPrice || q.regularMarketPrice || 0)
                : (q.regularMarketPrice || 0);
            out[q.symbol] = {
                price,
                prevClose: q.regularMarketPreviousClose || 0,
                state,
            };
        }
        return out;
    } catch (_) { return {}; }
}

async function _fetchPrice(env, symbol) {
    try {
        const quotes = await _quotePrice(env, [symbol]);
        return quotes[symbol]?.price || null;
    } catch (_) { return null; }
}

async function _manualBuy(env, symbol) {
    const price = await _fetchPrice(env, symbol);
    if (!price) { await _tgDirect(env, `❌ ${symbol} 현재가 조회 실패`); return; }

    const acct = await env.DB.prepare(
        "SELECT * FROM paper_account WHERE user_id=?"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first();
    if (!acct) { await _tgDirect(env, '❌ 계좌 없음'); return; }

    const category = classifySymbol(symbol, price, 0) || 'mid_small';
    const qty = Math.floor((acct.position_size || 25000) * (2 / 3) / price); // 1차 2/3 트랜쉐

    const result = await paperOpenTrade(env, {
        userId: acct.user_id, symbol, category, style: 'day',
        dir: 'long', price, qty, signalId: null, grade: 'M', score: null,
    });

    if (!result?.tradeId) {
        await _tgDirect(env, `❌ ${symbol} 수동 매수 실패`);
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

const DEFAULT_WATCHLIST = [
    // 레버리지 ETF
    'TQQQ','SOXL','UPRO','QLD','FNGU','TECL','LABU',
    // 대형주
    'NVDA','AAPL','MSFT','META','GOOGL','AMZN','TSLA','AMD','AVGO',
    // 개별 성장주
    'PLTR','COIN','RKLB','SHOP','SMCI',
];

async function _liveScan(env, customSymbols) {
    const symbols = customSymbols.length ? customSymbols : DEFAULT_WATCHLIST;
    await _tgDirect(env, `🔍 ${symbols.length}개 종목 스캔 중...`);

    // 차트 분석 (기술적 신호) + 현재가 조회 (v7 quote) 병렬 실행
    const [chartResults, quotes] = await Promise.all([
        Promise.allSettled(symbols.map(async sym => {
            try {
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2d&interval=5m&includePrePost=true`;
                const data = await yfRequest(env.CACHE, url);
                const res = data?.chart?.result?.[0];
                if (!res) return null;
                const q  = res.indicators?.quote?.[0] || {};
                const ts = res.timestamp || [];
                const trend  = smartDipScan(q, { interval: '5m', ts, lookback: 3 });
                const bounce = smartDipScanBounce(q, { ts, lookback: 3 });
                const sig = (trend && bounce)
                    ? (trend.qualityScore >= bounce.qualityScore ? trend : bounce)
                    : (trend || bounce);
                if (!sig) return null;
                return { sym, sig };
            } catch (_) { return null; }
        })),
        _quotePrice(env, symbols),
    ]);

    const hits = chartResults
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value)
        .sort((a, b) => b.sig.qualityScore - a.sig.qualityScore);

    if (!hits.length) {
        await _tgDirect(env, `📭 현재 매수 적합 종목 없음 (${symbols.length}개 스캔)`);
        return;
    }

    const lines = [`📡 라이브 스캔 (${hits.length}/${symbols.length}건)\n`];
    for (const { sym, sig } of hits.slice(0, 8)) {
        const price     = quotes[sym]?.price || sig.price;
        const emoji     = sig.dir === 'buy' ? '🟢' : '🔴';
        const modeLabel = sig.mode === 'bounce' ? '[반등]' : '[추세]';
        lines.push(`${emoji} <b>${sym}</b> [${sig.grade}] qs=${sig.qualityScore} ${modeLabel} $${price.toFixed(2)}`);
        lines.push(`   ${sig.reasons.slice(0, 3).join(' / ')}`);
        if (sig.stop) lines.push(`   신호가 $${sig.price.toFixed(2)} | 손절 $${sig.stop.toFixed(2)} | 목표 $${(sig.target1 || 0).toFixed(2)}`);
    }

    await _tgDirect(env, lines.join('\n'));
}

async function _analyzeSymbol(env, symbol) {
    try {
        const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2d&interval=5m&includePrePost=true`;
        const [data, quoteMap, acct] = await Promise.all([
            yfRequest(env.CACHE, chartUrl),
            _quotePrice(env, [symbol]),
            env.DB.prepare("SELECT balance, position_size FROM paper_account WHERE user_id=?")
                .bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first(),
        ]);
        const result = data?.chart?.result?.[0];
        if (!result) { await _tgDirect(env, `❌ ${symbol} 차트 데이터 없음`); return; }

        const q   = result.indicators?.quote?.[0] || {};
        const ts  = result.timestamp || [];
        const qt  = quoteMap[symbol];
        const price     = qt?.price || result.meta?.regularMarketPrice || 0;
        const prevClose = qt?.prevClose || result.meta?.chartPreviousClose || 0;
        const chgPct = prevClose > 0 ? ((price - prevClose) / prevClose * 100) : 0;
        const chgStr = (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%';

        const trend  = smartDipScan(q, { interval: '5m', ts, lookback: 3 });
        const bounce = smartDipScanBounce(q, { ts, lookback: 3 });
        // 분석 명령은 매수(롱) 기회만 표시 — 숏 시그널 제외
        const trendBuy = trend?.dir === 'buy' ? trend : null;
        const sig = (trendBuy && bounce)
            ? (trendBuy.qualityScore >= bounce.qualityScore ? trendBuy : bounce)
            : (trendBuy || bounce);

        // 신호 없음
        if (!sig) {
            const ema60 = calcEMA(q.close || [], 60);
            const lastEma = [...ema60].reverse().find(v => v != null);
            const emaStr = lastEma ? `EMA60 $${lastEma.toFixed(2)} (가격 ${price > lastEma ? '위 ↑' : '아래 ↓'})` : '';
            await _tgDirect(env, `📊 <b>${symbol}</b> @ $${price.toFixed(2)} (${chgStr})\n${emaStr}\n\n⚪ 신호 없음 — 조건 미충족, 관망 권장`);
            return;
        }

        const isShort   = sig.dir === 'sell';
        const dirEmoji  = isShort ? '🔴' : '🟢';
        const dirLabel  = isShort ? '매도' : '매수';
        const modeLabel = sig.mode === 'bounce' ? '[반등]' : '[추세]';
        const riskPerSh = sig.stop ? Math.abs(sig.price - sig.stop) : null;
        const riskAmt   = riskPerSh ? riskPerSh.toFixed(2) : null;
        const riskPct   = sig.riskPct ? sig.riskPct.toFixed(1) : null;
        const gain1Pct  = sig.target1 ? ((Math.abs(sig.target1 - sig.price) / sig.price) * 100).toFixed(1) : null;
        const gain2Pct  = sig.target2 ? ((Math.abs(sig.target2 - sig.price) / sig.price) * 100).toFixed(1) : null;
        const rr        = (riskPerSh && sig.target1) ? (Math.abs(sig.target1 - sig.price) / riskPerSh).toFixed(1) : null;
        const timing    = sig.barsAgo === 0 ? '⚡ 현재봉 신호' : `⏱ ${sig.barsAgo}봉 전 (${sig.barsAgo * 5}분 경과)`;

        // 비중 계획: 계좌 position_size 기준 (1차 = 1/4)
        const posSize   = acct?.position_size || 4000;
        const balance   = acct?.balance || 100000;
        const tranche1  = posSize / 4;
        const qty1      = sig.price > 0 ? Math.floor(tranche1 / sig.price) : 0;
        const invest1   = qty1 * sig.price;
        const riskTotal = riskPerSh && qty1 ? (riskPerSh * qty1).toFixed(0) : null;
        const riskOfBal = riskTotal ? ((+riskTotal / balance) * 100).toFixed(2) : null;

        await _tgDirect(env, [
            `📊 <b>${symbol}</b> @ $${price.toFixed(2)} (${chgStr})`,
            `${dirEmoji} ${dirLabel} ${modeLabel} [${sig.grade}등급] qs=${sig.qualityScore}  ${timing}`,
            '',
            '<b>📍 매매 계획</b>',
            `  1차 진입   $${sig.price.toFixed(2)}`,
            riskAmt ? `  손절      $${sig.stop.toFixed(2)}  (${isShort ? '+' : '-'}${riskPct}%, $${riskAmt}/주)` : null,
            gain1Pct ? `  1차 목표  $${sig.target1.toFixed(2)}  (${isShort ? '-' : '+'}${gain1Pct}%)` : null,
            gain2Pct ? `  2차 목표  $${sig.target2.toFixed(2)}  (${isShort ? '-' : '+'}${gain2Pct}%)` : null,
            rr ? `  손익비    1 : ${rr}R  |  예상승률 ~${sig.winRate}%` : null,
            '',
            '<b>📐 비중 계획</b>',
            qty1 ? `  1차 수량   ${qty1}주  (투자금 $${invest1.toFixed(0)})` : null,
            riskTotal ? `  1차 리스크  $${riskTotal}  (자본의 ${riskOfBal}%)` : null,
            `  2~4차     각 ${qty1}주 추가 (추가 하락 시)`,
            `  총 한도   ${qty1 * 4}주  ($${(qty1 * 4 * sig.price).toFixed(0)})`,
            '',
            `📈 ADX ${sig.adx} | RSI ${sig.rsiVal} | 거래량 ${sig.volRatio}x`,
            `   ${sig.reasons.join(' / ')}`,
        ].filter(l => l !== null).join('\n'));
    } catch (e) {
        console.error('[tg-analyze]', symbol, e?.message);
        await _tgDirect(env, `❌ ${symbol} 분석 오류: ${e?.message?.slice(0,80) || '알 수 없는 오류'}`);
    }
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

    // 오픈 포지션 현재가로 미실현 손익 계산 (배치 조회)
    const opens = openRows.results || [];
    let unrealized = 0;
    if (opens.length) {
        const quotes = await _quotePrice(env, opens.map(p => p.symbol));
        opens.forEach(p => {
            const cur = quotes[p.symbol]?.price;
            if (cur) unrealized += (cur - p.avg_price) * p.total_qty * (p.dir === 'short' ? -1 : 1);
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
        const score = s.score != null ? s.score.toFixed(1) : '';
        return `${dir} ${s.symbol} [${s.grade}${score}/${tf}]${entry}${stop}`;
    });
    await _tgDirect(env, `📡 오늘 스캔 결과 (${signals.length}건)\n\n${lines.join('\n')}`);
}

async function _sendPositions(env) {
    const rows = await env.DB.prepare(
        "SELECT symbol,dir,avg_price,total_qty,total_invested,realized_pnl,style,tranche_count,stop_price FROM paper_trades WHERE user_id=? AND status='open' ORDER BY created_at DESC"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').all();

    const positions = rows.results || [];
    if (!positions.length) { await _tgDirect(env, '📭 오픈 포지션 없음'); return; }

    // 현재가 배치 조회
    const quotes = await _quotePrice(env, positions.map(p => p.symbol));

    const lines = positions.map((p) => {
        const cur    = quotes[p.symbol]?.price;
        const dir    = p.dir === 'short' ? '숏' : '롱';
        const mult   = p.dir === 'short' ? -1 : 1;
        const qty    = p.total_qty ? p.total_qty.toFixed(0) : '?';
        const pnl    = cur ? ((cur - p.avg_price) * p.total_qty * mult).toFixed(0) : null;
        const chgPct = cur ? ((cur - p.avg_price) / p.avg_price * mult * 100).toFixed(2) : null;
        const sign   = pnl > 0 ? '+' : '';
        const curStr = cur ? `$${cur.toFixed(2)} (${sign}${chgPct}%)` : '조회실패';
        const pnlStr = pnl != null ? `미실현 ${sign}$${pnl}` : '';
        const stopStr = p.stop_price ? `손절 $${p.stop_price.toFixed(2)}` : '';
        return [
            `• <b>${p.symbol}</b> ${dir} [${p.style}]  ${p.tranche_count ?? 1}/4분할  |  <b>${qty}주</b>`,
            `  평단 $${p.avg_price.toFixed(2)}  →  현재 ${curStr}`,
            [pnlStr, stopStr].filter(Boolean).join('  |  '),
        ].filter(Boolean).join('\n');
    });
    await _tgDirect(env, `📊 오픈 포지션 (${positions.length}건)\n\n${lines.join('\n\n')}`);
}
