// Telegram 봇 명령어 처리 — 매수/매도/포지션 조회
// 보안: chatId 검증 (env.TELEGRAM_CHAT_ID 만 허용)
import { paperOpenTrade, paperClosePosition, _tgDirect, isSymbolBlocked } from '../utils/paper-engine.js';
import { classifySymbol } from '../utils/paper-category.js';
import { smartDipScan, smartDipScanBounce } from '../utils/smart-dip.js';
import { yfRequest } from '../utils/crumb.js';
import { calcEMA, calcRSI, calcADXSeries, lastVal } from '../utils/indicators.js';
import { getNewsSentiment } from '../utils/news-sentiment.js';
import { sendDailyHealthSummary } from './daily-scanner.js';
import { getCachedSectorHeat } from '../utils/sector-heat.js';
import { callGemini } from '../utils/gemini.js';

// 단일 타임프레임 추세 관점 — EMA20/60 정렬 + RSI + ADX (간단 요약용, 매매 시그널 아님)
function _tfPerspective(q) {
    const { close = [], high = [], low = [] } = q;
    if (close.length < 30) return null;
    const c = lastVal(close);
    if (c == null) return null;
    const e20 = lastVal(calcEMA(close, 20));
    const e60 = lastVal(calcEMA(close, 60));
    const rsiVal = lastVal(calcRSI(close, 14));
    const adxVal = lastVal(calcADXSeries(high, low, close, 14));
    let trend = '횡보';
    if (e20 != null && e60 != null) {
        if (c > e20 && e20 > e60) trend = '상승';
        else if (c < e20 && e20 < e60) trend = '하락';
    }
    return { trend, rsi: rsiVal != null ? Math.round(rsiVal) : null, adx: adxVal != null ? Math.round(adxVal) : null };
}

// 타임프레임별 차트 조회 (실패 시 null) — { q, ts } 반환
async function _fetchTfData(env, symbol, range, interval) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
        const data = await yfRequest(env.CACHE, url);
        const result = data?.chart?.result?.[0];
        if (!result) return null;
        return { q: result.indicators?.quote?.[0] || {}, ts: result.timestamp || [] };
    } catch (_) { return null; }
}

// 매수(롱) 시그널만 반환 — smartDipScan(추세) + smartDipScanBounce(반등) 중 우수한 쪽
function _tfBuySignal(q, ts, interval) {
    const trend  = smartDipScan(q, { interval, ts, lookback: 3 });
    const bounce = smartDipScanBounce(q, { ts, lookback: 3 });
    const trendBuy = trend?.dir === 'buy' ? trend : null;
    return (trendBuy && bounce)
        ? (trendBuy.qualityScore >= bounce.qualityScore ? trendBuy : bounce)
        : (trendBuy || bounce);
}

// 옵션 체인 요약 — 최근월물 콜/풋 미결제약정(OI)·거래량 + 맥스페인(옵션 매도자에게 가장 유리한 가격)
// 맥스페인: 상장된 각 행사가 K에 만기가 도래한다고 가정했을 때 옵션 보유자 총 정산액이
// 최소가 되는 K를 찾음 (콜은 K 아래 strike, 풋은 K 위 strike 가 각각 내가격으로 계산됨)
async function _fetchOptionsSummary(env, symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
        const data = await yfRequest(env.CACHE, url);
        const opt = data?.optionChain?.result?.[0]?.options?.[0];
        if (!opt) return null;
        const calls = opt.calls || [];
        const puts  = opt.puts || [];
        if (!calls.length && !puts.length) return null;

        const callOI  = calls.reduce((s, c) => s + (c.openInterest || 0), 0);
        const putOI   = puts.reduce((s, p) => s + (p.openInterest || 0), 0);
        const callVol = calls.reduce((s, c) => s + (c.volume || 0), 0);
        const putVol  = puts.reduce((s, p) => s + (p.volume || 0), 0);

        const strikes = [...new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)])].filter(k => k > 0);
        let maxPain = null, minPayout = Infinity;
        for (const k of strikes) {
            let payout = 0;
            for (const c of calls) if (c.strike < k) payout += (k - c.strike) * (c.openInterest || 0);
            for (const p of puts)  if (p.strike > k) payout += (p.strike - k) * (p.openInterest || 0);
            if (payout < minPayout) { minPayout = payout; maxPain = k; }
        }

        return {
            expiry: opt.expirationDate ? new Date(opt.expirationDate * 1000).toISOString().slice(0, 10) : null,
            maxPain, callOI, putOI, callVol, putVol,
            pcRatioOI: callOI > 0 ? +(putOI / callOI).toFixed(2) : null,
        };
    } catch (_) { return null; }
}

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
        } else if ((cmd === '금지' || cmd === '/금지') && symbol) {
            await _blockSymbol(env, symbol);
        } else if ((cmd === '금지해제' || cmd === '/금지해제') && symbol) {
            await _unblockSymbol(env, symbol);
        } else if (cmd === '금지목록' || cmd === '/금지목록') {
            await _sendBlocklist(env);
        } else if (cmd === '리포트' || cmd === '/리포트') {
            await sendDailyHealthSummary(env);
        } else if (cmd === '업종대세' || cmd === '/업종대세') {
            await _sendSectorHeat(env);
        } else if (cmd === '성장주' || cmd === '/성장주') {
            await _sendGrowthPicks(env, sym?.toUpperCase());
        } else if ((cmd === '기업리포트' || cmd === '/기업리포트') && symbol) {
            await _stockReport(env, symbol);
        } else if ((cmd === '승률' || cmd === '/승률') && symbol) {
            await _symbolWinRate(env, symbol);
        } else {
            await _tgDirect(env,
                '사용법:\n• 현황 — 전체 수익률\n• 스캔 — 오늘 시그널 목록\n• 포지션 — 보유 포지션\n• 매수 TQQQ\n• 매도 TQQQ\n• 분석 NVDA — 종목 분석\n• 스캐너 — 실시간 매수 스캔 (스캐너 NVDA TSLA 로 직접 지정 가능)\n• 금지 TQQQ — 매매 금지 등록\n• 금지해제 TQQQ\n• 금지목록 — 금지 종목 조회\n• 리포트 — 오늘 시그널/매매/오류 요약 (매일 US 장마감 후 자동 발송)\n• 업종대세 — 요즘 뜨는 섹터 랭킹\n• 성장주 [섹터ETF] — 성장주 발굴 추천 (예: 성장주 XLK)\n• 기업리포트 NVDA — 웹검색 기반 종목 리포트 (기업개요/실적/밸류에이션/리스크 등)\n• 승률 AAL — 해당 종목 체결 이력 승률/손익 조회'
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

async function _blockSymbol(env, symbol) {
    await env.DB.prepare('INSERT OR IGNORE INTO paper_blocklist (symbol, added_at) VALUES (?, ?)')
        .bind(symbol, Date.now()).run();
    await _tgDirect(env, `🚫 ${symbol} 매매 금지 등록됨`);
}

async function _unblockSymbol(env, symbol) {
    await env.DB.prepare('DELETE FROM paper_blocklist WHERE symbol=?').bind(symbol).run();
    await _tgDirect(env, `✅ ${symbol} 매매 금지 해제됨`);
}

async function _sendBlocklist(env) {
    const rows = await env.DB.prepare('SELECT symbol FROM paper_blocklist ORDER BY added_at DESC').all();
    const symbols = (rows.results || []).map(r => r.symbol);
    if (!symbols.length) { await _tgDirect(env, '📭 금지 종목 없음'); return; }
    await _tgDirect(env, `🚫 금지 종목 (${symbols.length}건)\n${symbols.join(', ')}`);
}

// 업종대세 — 섹터/테마 히트 랭킹 (D1 읽기 전용, 즉시 응답)
async function _sendSectorHeat(env) {
    const rows = await getCachedSectorHeat(env);
    if (!rows.length) { await _tgDirect(env, '📭 섹터 히트 데이터 없음 (다음 크론 이후 다시 시도)'); return; }

    const arrow = (v) => v > 0 ? '↑' : v < 0 ? '↓' : '→';
    const lines = rows.map(r =>
        `${r.heat_rank <= 3 ? '🔥' : r.heat_rank >= 9 ? '🧊' : '·'} ${r.heat_rank}위 ${r.sector_label}(${r.sector_etf})  ` +
        `점수 ${r.heat_score}  |  1개월 ${r.perf_1mo >= 0 ? '+' : ''}${r.perf_1mo}%${arrow(r.perf_1mo)}  |  상대강도 ${r.rel_strength >= 0 ? '+' : ''}${r.rel_strength}%p`
    );
    await _tgDirect(env, [`<b>🌡️ 업종 대세 랭킹</b> (${rows[0]?.snapshot_date || ''})`, '', ...lines].join('\n'));
}

// 성장주 [섹터ETF] — 성장주 발굴 추천 (D1 읽기 전용)
async function _sendGrowthPicks(env, sectorFilter) {
    const latest = await env.DB.prepare('SELECT MAX(snapshot_date) d FROM growth_recommendations').first();
    if (!latest?.d) { await _tgDirect(env, '📭 성장주 추천 데이터 없음 (다음 크론 이후 다시 시도)'); return; }

    const rows = sectorFilter
        ? await env.DB.prepare('SELECT * FROM growth_recommendations WHERE snapshot_date=? AND sector_etf=? ORDER BY composite_score DESC LIMIT 10').bind(latest.d, sectorFilter).all()
        : await env.DB.prepare('SELECT * FROM growth_recommendations WHERE snapshot_date=? ORDER BY composite_score DESC LIMIT 10').bind(latest.d).all();
    const picks = rows.results || [];
    if (!picks.length) { await _tgDirect(env, `📭 ${sectorFilter ? sectorFilter + ' 섹터에 ' : ''}추천 결과 없음`); return; }

    const emoji = (rec) => rec === 'buy' ? '🟢' : rec === 'sell' ? '🔴' : '🟡';
    const label = (rec) => rec === 'buy' ? '매수' : rec === 'sell' ? '매도' : '관망';
    const lines = picks.map(p => {
        const reasons = (() => { try { return JSON.parse(p.reasons_json || '[]'); } catch (_) { return []; } })();
        return `${emoji(p.recommendation)} <b>${p.symbol}</b> [${p.confidence}] ${label(p.recommendation)} · 종합 ${p.composite_score}점\n  ${reasons.slice(0, 4).join(' · ')}`;
    });
    await _tgDirect(env, [
        `<b>🌱 성장주 발굴</b> (${latest.d}${sectorFilter ? `, ${sectorFilter}` : ''})`,
        '',
        ...lines,
    ].join('\n'));
}

async function _manualBuy(env, symbol) {
    if (await isSymbolBlocked(env, symbol)) { await _tgDirect(env, `🚫 ${symbol} 매매 금지 종목`); return; }

    const price = await _fetchPrice(env, symbol);
    if (!price) { await _tgDirect(env, `❌ ${symbol} 현재가 조회 실패`); return; }

    const acct = await env.DB.prepare(
        "SELECT * FROM paper_account WHERE user_id=?"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first();
    if (!acct) { await _tgDirect(env, '❌ 계좌 없음'); return; }

    const category = classifySymbol(symbol, price, 0) || 'mid_small';
    const qty = Math.floor((acct.day_position_size || 10000) * (2 / 3) / price); // 1차 2/3 트랜쉐 (단타 풀)

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
        const [data, quoteMap, acct, daily, tf15, tf60, news, options] = await Promise.all([
            yfRequest(env.CACHE, chartUrl),
            _quotePrice(env, [symbol]),
            env.DB.prepare("SELECT day_balance, day_position_size FROM paper_account WHERE user_id=?")
                .bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first(),
            _fetchTfData(env, symbol, '6mo', '1d'),
            _fetchTfData(env, symbol, '1mo', '15m'),
            _fetchTfData(env, symbol, '3mo', '60m'),
            getNewsSentiment(env, symbol).catch(() => null),
            _fetchOptionsSummary(env, symbol).catch(() => null),
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

        const sig = _tfBuySignal(q, ts, '5m');

        // 멀티 타임프레임 관점 — 일봉/60분/15분/5분 추세 + (신호 발생 시) 진입/손절/목표 요약
        // 5분봉은 위 sig 재사용, 나머지는 각자 데이터로 동일 엔진(smartDipScan) 재적용
        const tfDefs = [
            ['일봉', daily, '1d'],
            ['60분', tf60,  '60m'],
            ['15분', tf15,  '15m'],
            ['5분',  { q, ts }, '5m'],
        ];
        const tfLines = tfDefs.map(([label, tf, interval]) => {
            if (!tf) return `  ${label}   데이터 부족`;
            const p = _tfPerspective(tf.q);
            if (!p) return `  ${label}   데이터 부족`;
            const arrow = p.trend === '상승' ? '↑' : p.trend === '하락' ? '↓' : '→';
            const base = `  ${label}   ${p.trend}${arrow}  RSI ${p.rsi ?? '-'}  ADX ${p.adx ?? '-'}`;
            const tfSig = interval === '5m' ? sig : _tfBuySignal(tf.q, tf.ts, interval);
            if (!tfSig) return `${base}  | 신호없음`;
            return `${base}  | 🟢진입$${tfSig.price.toFixed(2)} 손절$${tfSig.stop.toFixed(2)} 목표$${tfSig.target1.toFixed(2)} [${tfSig.grade}]`;
        });
        const mtfBlock = ['<b>🕐 멀티 타임프레임 관점</b>', ...tfLines].join('\n');

        // 뉴스 감성 — 매매 관점 참고용
        const newsEmoji = news?.sentiment === 'positive' ? '🟢' : news?.sentiment === 'negative' ? '🔴' : '⚪';
        const newsBlock = news?.headline
            ? `<b>📰 뉴스</b>\n  ${newsEmoji} ${news.sentiment} — ${news.headline}`
            : null;

        // 옵션 현황 — 맥스페인 + 콜/풋 미결제약정 비교
        const optionsBlock = options ? [
            `<b>🎯 옵션 현황</b> (만기 ${options.expiry || '-'})`,
            `  맥스페인 $${options.maxPain?.toFixed(2) ?? '-'}  (현재가 ${price > (options.maxPain || 0) ? '위 ↑' : '아래 ↓'})`,
            `  콜 OI ${options.callOI.toLocaleString()}  |  풋 OI ${options.putOI.toLocaleString()}  → ${options.callOI >= options.putOI ? '콜' : '풋'} 우세 (P/C ${options.pcRatioOI ?? '-'})`,
        ].join('\n') : null;

        // 신호 없음
        if (!sig) {
            const ema60 = calcEMA(q.close || [], 60);
            const lastEma = [...ema60].reverse().find(v => v != null);
            const emaStr = lastEma ? `EMA60 $${lastEma.toFixed(2)} (가격 ${price > lastEma ? '위 ↑' : '아래 ↓'})` : '';
            await _tgDirect(env, [
                `📊 <b>${symbol}</b> @ $${price.toFixed(2)} (${chgStr})`,
                emaStr,
                '',
                mtfBlock,
                newsBlock ? '' : null, newsBlock,
                optionsBlock ? '' : null, optionsBlock,
                '',
                '⚪ 신호 없음 — 조건 미충족, 관망 권장',
            ].filter(l => l !== null).join('\n'));
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

        // 비중 계획: 단타(day) 자본 풀 기준 (1차 = 1/4) — 이 분석은 5분봉(단타) 신호
        const posSize   = acct?.day_position_size || 10000;
        const balance   = acct?.day_balance || 30000;
        const tranche1  = posSize / 4;
        const qty1      = sig.price > 0 ? Math.floor(tranche1 / sig.price) : 0;
        const invest1   = qty1 * sig.price;
        const riskTotal = riskPerSh && qty1 ? (riskPerSh * qty1).toFixed(0) : null;
        const riskOfBal = riskTotal ? ((+riskTotal / balance) * 100).toFixed(2) : null;

        await _tgDirect(env, [
            `📊 <b>${symbol}</b> @ $${price.toFixed(2)} (${chgStr})`,
            `${dirEmoji} ${dirLabel} ${modeLabel} [${sig.grade}등급] qs=${sig.qualityScore}  ${timing}`,
            '',
            mtfBlock,
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
            newsBlock ? '' : null, newsBlock,
            optionsBlock ? '' : null, optionsBlock,
        ].filter(l => l !== null).join('\n'));
    } catch (e) {
        console.error('[tg-analyze]', symbol, e?.message);
        await _tgDirect(env, `❌ ${symbol} 분석 오류: ${e?.message?.slice(0,80) || '알 수 없는 오류'}`);
    }
}

// 웹검색 그라운딩 기반 종목 리포트 프롬프트 (기업개요~출처 10개 섹션)
function _buildStockReportPrompt(symbol) {
    return `너는 미국 주식 투자자를 위한 "종목 리포트 작성 어시스턴트"다.
입력 종목(또는 티커): ${symbol}
반드시 웹 검색을 수행한 뒤 최신 데이터를 기반으로 리포트를 작성한다.

[검색 원칙]
- 반드시 웹 검색을 수행한 뒤 작성한다. 최신 데이터가 확인되지 않으면 추정하지 않는다.
- 오래된 학습 데이터를 최신 정보처럼 작성하지 않는다. 최근 30일 이내 정보를 우선 사용한다.
- 정보가 서로 다르면 기업 공시 > 거래소 > 기업 IR > 신뢰도 높은 금융매체 순으로 우선한다.
- 루머는 반드시 "미확인 정보"라고 표시한다.

[기준일]
- 리포트 최상단에 "기준일 : YYYY-MM-DD (한국시간)" 형식으로 작성한다.
- 모든 수치에는 가능한 경우 (YYYY-MM-DD 기준)을 함께 표기한다.
- 최신 데이터가 확인되지 않는 항목은 "최신 데이터 확인 불가 (마지막 확인 : YYYY-MM-DD)"라고 작성한다.

[리포트 구성 — 아래 순서와 제목을 그대로 사용]
# 1. 기업 개요 — 종목명/티커/상장시장/산업·섹터/사업 한 줄 요약/주요 제품·서비스/시가총액 (표)
# 2. 최근 주가 동향 — 현재가/전일 대비/시가총액/거래대금/1개월·3개월·1년 수익률 (표) + 거래량 급증·기술적 움직임 설명
# 3. 최근 주요 뉴스 (최대 5개) — 각 뉴스마다 날짜/제목 요약(원문 복사 금지)/내용 요약/주가 영향(긍정·부정·중립)/영향 이유
# 4. 밸류에이션 — PER/PBR/PSR/EV·EBITDA/배당수익률/ROE/ROA (표), 산업 평균 대비 높음·평균·낮음 설명
# 5. 실적 — 최근 분기 매출/영업이익/순이익/EPS/전년 대비 성장률/컨센서스 대비 (표), 최근 4개 분기 흐름, 실적 발표 예정일
# 6. 투자 포인트 — 현재 시장이 주목하는 핵심 포인트 3~5가지
# 7. 리스크 — 산업/기업 고유/경쟁사/규제/실적 리스크 등 최소 3가지, 근거와 함께
# 8. 매크로 영향 — 금리/환율/유가/원자재/정책/섹터 순환이 해당 기업에 주는 영향
# 9. 핵심 체크리스트 — 강점 3가지/약점 3가지/기회/위협 (표), 마지막에 반드시 "본 리포트는 투자 판단을 위한 정보 정리이며, 특정 종목의 매수·매도를 권유하지 않습니다." 포함
# 10. 출처 — 매체명/기사 제목/날짜, 기업공시>거래소>기업IR>Reuters>Bloomberg>CNBC>Investing>Yahoo Finance 순 우선

[작성 스타일]
- 존댓말 사용, 과장 금지, "무조건"/"확실하다" 같은 표현 금지, 객관적 표현, 초보 투자자도 이해할 수 있게 쉽게 설명
- 표를 적극 활용하고 마크다운 표 문법(|---|) 사용, 굵게 표시는 **텍스트** 사용
- 절대 목표주가를 제시하지 않는다. 절대 매수·매도를 추천하지 않는다.
- 확인되지 않은 정보는 사실처럼 작성하지 않는다. 검색 결과가 부족하면 부족하다고 명시한다.`;
}

// Gemini 마크다운(** 굵게) → 텔레그램 HTML, HTML 특수문자 이스케이프
function _mdToTgHtml(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// 텔레그램 sendMessage 4096자 제한 대응 — 줄 단위로 잘라 여러 메시지로 순차 발송
async function _sendLongTg(env, text, maxLen = 3500) {
    const lines = text.split('\n');
    let chunk = '';
    for (const line of lines) {
        const next = chunk ? `${chunk}\n${line}` : line;
        if (next.length > maxLen && chunk) {
            await _tgDirect(env, chunk);
            chunk = line;
        } else {
            chunk = next;
        }
    }
    if (chunk) await _tgDirect(env, chunk);
}

async function _stockReport(env, symbol) {
    await _tgDirect(env, `⏳ ${symbol} 종목 리포트 생성 중... (웹 검색 포함, 다소 시간 소요될 수 있음)`);
    try {
        const result = await callGemini(env, _buildStockReportPrompt(symbol), {
            model: 'gemini-3.1-flash-lite',
            temperature: 0.3,
            maxOutputTokens: 8192,
            responseMimeType: 'text/plain',
            tools: [{ google_search: {} }],
            timeoutMs: 45_000,
        });
        if (!result.ok || !result.text) {
            await _tgDirect(env, `❌ ${symbol} 리포트 생성 실패: ${result.error || '응답 없음'}`);
            return;
        }
        await _sendLongTg(env, _mdToTgHtml(result.text));
    } catch (e) {
        console.error('[tg-report]', symbol, e?.message);
        await _tgDirect(env, `❌ ${symbol} 리포트 오류: ${e?.message?.slice(0,80) || '알 수 없는 오류'}`);
    }
}

// 승률 AAL — 해당 종목(정확히 이 티커로 체결된 것만) 승률/손익 조회
async function _symbolWinRate(env, symbol) {
    const rows = await env.DB.prepare(
        "SELECT realized_pnl, dir, created_at FROM paper_trades WHERE symbol=? AND status='closed' ORDER BY created_at DESC"
    ).bind(symbol).all();
    const trades = rows.results || [];
    if (!trades.length) {
        await _tgDirect(env, `📭 ${symbol} 체결 이력 없음 (해당 티커로 청산 완료된 거래 없음)`);
        return;
    }

    const wins   = trades.filter(t => t.realized_pnl > 0);
    const losses = trades.filter(t => t.realized_pnl <= 0);
    const totalWin  = wins.reduce((s, t) => s + t.realized_pnl, 0);
    const totalLoss = losses.reduce((s, t) => s + t.realized_pnl, 0); // 음수 합
    const netPnl  = totalWin + totalLoss;
    const winRate = (wins.length / trades.length * 100).toFixed(1);

    await _tgDirect(env, [
        `<b>📊 ${symbol} 매매 성과</b> (${trades.length}건 청산)`,
        `승률: ${winRate}% (${wins.length}승 ${losses.length}패)`,
        `총 수익: +$${totalWin.toFixed(0)}`,
        `총 손실: $${totalLoss.toFixed(0)}`,
        `순손익: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(0)}`,
    ].join('\n'));
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
