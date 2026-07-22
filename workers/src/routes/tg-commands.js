// Telegram 봇 명령어 처리 — 매수/매도/포지션 조회
// 보안: chatId 검증 (env.TELEGRAM_CHAT_ID 만 허용)
import { paperOpenTrade, paperClosePosition, _tgDirect, isSymbolBlocked, MAX_TRANCHE, TRANCHE_TRIGGERS, TRANCHE_WEIGHTS, TRANCHE_WEIGHT_SUM, _etTotalMin } from '../utils/paper-engine.js';
import { classifySymbol } from '../utils/paper-category.js';
import { smartDipScan, smartDipScanBounce, smartDipDiagnose } from '../utils/smart-dip.js';
import { yfRequest } from '../utils/crumb.js';
import { calcEMA, calcRSI, calcADXSeries, calcATR, lastVal } from '../utils/indicators.js';
import { getNewsSentiment } from '../utils/news-sentiment.js';
import { sendDailyHealthSummary } from './daily-scanner.js';
import { getCachedSectorHeat } from '../utils/sector-heat.js';
import { getMarketRegime } from '../utils/market.js';
import { callGemini, extractJsonFromResponse } from '../utils/gemini.js';

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
    return { trend, rsi: rsiVal != null ? Math.round(rsiVal) : null, adx: adxVal != null ? Math.round(adxVal) : null, ema20: e20, ema60: e60 };
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

        // 콜/풋 미결제약정(OI)이 어느 행사가에 몰려있는지 상위 2개 — 지지/저항 참고용
        const topByOI = (arr) => [...arr]
            .filter(x => (x.openInterest || 0) > 0)
            .sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0))
            .slice(0, 2)
            .map(x => ({ strike: x.strike, oi: x.openInterest }));

        return {
            expiry: opt.expirationDate ? new Date(opt.expirationDate * 1000).toISOString().slice(0, 10) : null,
            maxPain, callOI, putOI, callVol, putVol,
            pcRatioOI: callOI > 0 ? +(putOI / callOI).toFixed(2) : null,
            topCallStrikes: topByOI(calls),
            topPutStrikes: topByOI(puts),
        };
    } catch (_) { return null; }
}

// 애널리스트 목표주가/추천등급 평균 (Yahoo Finance financialData 모듈)
const _RECO_KO = {
    strong_buy: '적극매수', buy: '매수', hold: '보유', sell: '매도', strong_sell: '적극매도', none: '없음',
};
async function _fetchAnalystData(env, symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData`;
        const data = await yfRequest(env.CACHE, url);
        const fd = data?.quoteSummary?.result?.[0]?.financialData;
        if (!fd || fd.targetMeanPrice?.raw == null) return null;
        return {
            targetMean: fd.targetMeanPrice?.raw ?? null,
            targetHigh: fd.targetHighPrice?.raw ?? null,
            targetLow: fd.targetLowPrice?.raw ?? null,
            numAnalysts: fd.numberOfAnalystOpinions?.raw ?? null,
            recoKey: fd.recommendationKey || null,
        };
    } catch (_) { return null; }
}

// 공매도 잔고 현황 (Yahoo Finance defaultKeyStatistics 모듈 — 통상 반월 지연 데이터)
async function _fetchShortInterest(env, symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics`;
        const data = await yfRequest(env.CACHE, url);
        const ks = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
        if (!ks || ks.sharesShort?.raw == null) return null;
        const shares = ks.sharesShort.raw;
        const priorShares = ks.sharesShortPriorMonth?.raw ?? null;
        return {
            shares,
            priorShares,
            chgPct: priorShares > 0 ? ((shares - priorShares) / priorShares * 100) : null,
            daysToCover: ks.shortRatio?.raw ?? null,
            pctOfFloat: ks.shortPercentOfFloat?.raw != null ? ks.shortPercentOfFloat.raw * 100 : null,
            asOf: ks.dateShortInterest?.raw ? new Date(ks.dateShortInterest.raw * 1000).toISOString().slice(0, 10) : null,
        };
    } catch (_) { return null; }
}

// ArrayBuffer → base64 (Workers엔 Buffer 없음, 큰 이미지 콜스택 방지 위해 청크 처리)
function _arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// 텔레그램이 보관 중인 사진 파일을 다운로드 — getFile로 경로 조회 후 실제 바이트 fetch
async function _tgDownloadPhoto(env, fileId) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;
    try {
        const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
        const info = await infoRes.json();
        const filePath = info?.result?.file_path;
        if (!filePath) return null;
        const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
        if (!fileRes.ok) return null;
        const buf = await fileRes.arrayBuffer();
        // 텔레그램 파일 서버는 Content-Type을 application/octet-stream으로 내려줄 때가 많음 —
        // 사진(photo)은 텔레그램이 항상 JPEG로 변환해 저장하므로 고정값 사용.
        return { dataBase64: _arrayBufferToBase64(buf), mimeType: 'image/jpeg' };
    } catch (_) { return null; }
}

// 분할매수 관점 안내 블록 — 사진 분석/직접 입력(보유 명령) 공용.
// avgPrice/quantity가 있으면 참고 추가금액(기존 투자금의 2:1 비중 중 2차분)까지 같이 계산.
async function _buildTrancheAdviceBlock(env, symbol, cur, avgPrice, quantity) {
    const advice = await _trancheAdvice(env, { dir: 'long', style: 'swing', symbol }, cur);
    const lines = [];
    if (advice) {
        lines.push(`💡 <b>분할매수 관점</b> (일봉 기준)`);
        lines.push(`  추가매수 관심가 $${advice.recPrice.toFixed(2)} (${advice.recPct > 0 ? '+' : ''}${advice.recPct.toFixed(1)}%, ${advice.basis})`);
        if (avgPrice && quantity) {
            const invested = avgPrice * quantity;
            const addAmount = invested * (TRANCHE_WEIGHTS[1] / TRANCHE_WEIGHTS[0]); // 기존 2:1 분할 비중 재사용 → 2차는 1차의 절반
            const addQty = Math.floor(addAmount / advice.recPrice);
            lines.push(`  참고 추가금액 약 $${addAmount.toFixed(0)} (~${addQty}주, 기존 투자금의 약 ${(TRANCHE_WEIGHTS[1] / TRANCHE_WEIGHTS[0] * 100).toFixed(0)}%)`);
        }
    } else {
        lines.push('💡 뚜렷한 추가매수 관심가 산출 실패 — 데이터 부족 또는 추세 불명확');
    }
    return lines.join('\n');
}

// 사용자가 텔레그램에 직접 타이핑한 보유정보(종목/평단가/금액) 분석 — 사진 없이 텍스트로 입력.
async function _manualHoldingAdvice(env, symbol, avgPrice, amount) {
    const quotes = await _quotePrice(env, [symbol]);
    const cur = quotes[symbol]?.price;
    if (!cur) {
        await _tgDirect(env, `⚠ "${symbol}" 시세 조회 실패 — 티커를 확인해주세요.`);
        return;
    }

    const quantity = amount / avgPrice;
    const chgPct = ((cur - avgPrice) / avgPrice * 100).toFixed(2);
    const adviceBlock = await _buildTrancheAdviceBlock(env, symbol, cur, avgPrice, quantity);

    const lines = [
        `📋 <b>${symbol}</b> 보유 분석`,
        `현재가 $${cur.toFixed(2)}`,
        `평단 $${avgPrice.toFixed(2)} / 약 ${quantity.toFixed(2)}주 (투자금 $${amount.toFixed(0)}) (${chgPct > 0 ? '+' : ''}${chgPct}%)`,
        '',
        adviceBlock,
        '',
        '⚠ 참고용 분석 — 실제 매매 전 직접 확인 권장',
    ];
    await _tgDirect(env, lines.join('\n'));
}

// 사용자가 직접 보유 중인 종목(미국주) 스크린샷 분석 — 페이퍼 트레이딩 DB와 무관한 1회성 요청.
// 1) Gemini Vision으로 티커/평단가/보유수량 추출 → 2) 실제 야후 차트로 EMA20/ATR 분할매수 관점 산출.
async function _analyzePhotoPosition(env, msg) {
    const photos = msg.photo || [];
    if (!photos.length) return;
    const best = photos[photos.length - 1]; // 가장 높은 해상도
    const image = await _tgDownloadPhoto(env, best.file_id);
    if (!image) { await _tgDirect(env, '⚠ 사진 다운로드 실패 — 다시 시도해주세요'); return; }

    const prompt = [
        '다음은 사용자가 텔레그램으로 보낸 스크린샷입니다. 미국 주식 보유 화면 또는 차트 화면으로 추정됩니다.',
        '이미지에서 아래 정보를 최대한 정확히 추출해서 JSON으로만 답하세요 (설명 문장 없이 JSON만):',
        '{',
        '  "isStockImage": 이 이미지가 주식/차트/보유내역 관련 화면이 맞는지 boolean,',
        '  "symbol": "미국 주식 티커(예: AAPL). 회사명만 보이면 실제 티커로 유추. 확신 없으면 null",',
        '  "avgPrice": 평균매입가 숫자(통화기호·콤마 제외, 못 찾으면 null),',
        '  "quantity": 보유수량 숫자(못 찾으면 null)',
        '}',
    ].join('\n');

    const result = await callGemini(env, prompt, { image, maxOutputTokens: 512 });
    if (!result.ok) { await _tgDirect(env, `⚠ 이미지 분석 실패: ${result.error || '알 수 없는 오류'}`); return; }
    const parsed = extractJsonFromResponse(result.text);
    const symbol = parsed?.symbol ? String(parsed.symbol).toUpperCase().trim() : null;
    if (!parsed?.isStockImage || !symbol) {
        await _tgDirect(env, '⚠ 이미지에서 종목을 인식하지 못했습니다. 티커·평단가가 잘 보이는 스크린샷으로 다시 시도해주세요.');
        return;
    }

    const quotes = await _quotePrice(env, [symbol]);
    const cur = quotes[symbol]?.price;
    if (!cur) {
        await _tgDirect(env, `⚠ "${symbol}" 시세 조회 실패 — 티커 인식이 틀렸을 수 있습니다.`);
        return;
    }

    const avgPrice = typeof parsed.avgPrice === 'number' && parsed.avgPrice > 0 ? parsed.avgPrice : null;
    const quantity = typeof parsed.quantity === 'number' && parsed.quantity > 0 ? parsed.quantity : null;
    const chgPct = avgPrice ? ((cur - avgPrice) / avgPrice * 100).toFixed(2) : null;

    const adviceBlock = await _buildTrancheAdviceBlock(env, symbol, cur, avgPrice, quantity);

    const lines = [
        `📸 <b>${symbol}</b> 이미지 분석 결과`,
        `현재가 $${cur.toFixed(2)}`,
        avgPrice
            ? `인식된 보유정보: 평단 $${avgPrice.toFixed(2)}${quantity ? ` / ${quantity}주` : ''} (${chgPct > 0 ? '+' : ''}${chgPct}%)`
            : '평단가·수량은 이미지에서 인식되지 않음',
        '',
        adviceBlock,
        '',
        '⚠ 이미지 인식 + 자동 분석 기반이라 오차 가능 — 실제 매매 전 직접 확인 권장',
    ];

    await _tgDirect(env, lines.join('\n'));
}

export async function handleTgWebhook(req, env) {
    let body;
    try { body = await req.json(); } catch { return new Response('ok'); }

    const msg = body?.message;
    if (!msg) return new Response('ok');

    const chatId = String(msg.chat?.id || '');
    if (chatId !== String(env.TELEGRAM_CHAT_ID)) return new Response('ok'); // 타인 차단

    if (msg.photo?.length) {
        try { await _analyzePhotoPosition(env, msg); } catch (e) { console.error('[tg photo]', e?.message); }
        return new Response('ok');
    }

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
        } else if (cmd === '보유' || cmd === '/보유') {
            const parts = text.split(/\s+/).slice(1);
            const holdSymbol = parts[0]?.toUpperCase();
            const avgPrice = parseFloat(parts[1]);
            const amount = parseFloat(parts[2]);
            if (!holdSymbol || !(avgPrice > 0) || !(amount > 0)) {
                await _tgDirect(env, '사용법: 보유 종목 평단가 금액\n예: 보유 RAM 22.57 2000  (평단 $22.57, 총 투자금 $2,000)');
            } else {
                await _manualHoldingAdvice(env, holdSymbol, avgPrice, amount);
            }
        } else if (cmd === '관망' || cmd === '/관망') {
            await _sendWatchStatus(env);
        } else if (cmd === '오늘' || cmd === '/오늘') {
            await _sendTodayResults(env);
        } else if (cmd === '실적' || cmd === '/실적') {
            await _sendTodayEarnings(env);
        } else {
            await _tgDirect(env,
                '사용법:\n• 현황 — 전체 수익률\n• 스캔 — 오늘 시그널 목록\n• 포지션 — 보유 포지션\n• 매수 TQQQ\n• 매도 TQQQ\n• 분석 NVDA — 종목 분석\n• 스캐너 — 실시간 매수 스캔 (스캐너 NVDA TSLA 로 직접 지정 가능)\n• 금지 TQQQ — 매매 금지 등록\n• 금지해제 TQQQ\n• 금지목록 — 금지 종목 조회\n• 리포트 — 오늘 시그널/매매/오류 요약 (매일 US 장마감 후 자동 발송)\n• 업종대세 — 요즘 뜨는 섹터 랭킹\n• 성장주 [섹터ETF] — 성장주 발굴 추천 (예: 성장주 XLK)\n• 기업리포트 NVDA — 웹검색 기반 종목 리포트 (기업개요/실적/밸류에이션/리스크 등)\n• 승률 AAL — 해당 종목 체결 이력 승률/손익 조회\n• 보유 RAM 22.57 2000 — 직접 입력한 보유종목 분할매수 관점 (종목/평단가/투자금)\n• 관망 — 지금 매매가 왜 없는지(시장 레짐/진입 게이트 상태) 확인\n• 오늘 — 오늘 진입/청산된 가상매매 결과를 종목별로 정리\n• 실적 — 오늘 실적 발표 예정 기업 목록(시총 상위)'
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
    const rows = await env.DB.prepare('SELECT symbol, expires_at FROM paper_blocklist ORDER BY added_at DESC').all();
    const list = rows.results || [];
    if (!list.length) { await _tgDirect(env, '📭 금지 종목 없음'); return; }
    const lines = list.map(r => r.expires_at
        ? `${r.symbol} (~${new Date(r.expires_at).toISOString().slice(0, 10)}까지)`
        : r.symbol);
    await _tgDirect(env, `🚫 금지 종목 (${list.length}건)\n${lines.join(', ')}`);
}

// 업종대세 — 섹터/테마 히트 랭킹 (D1 읽기 전용, 즉시 응답)
// 오늘(ET 기준) 실적 발표 예정 기업 — NASDAQ 공개 캘린더 API (단일 요청, 개별 종목 스캔 불필요)
async function _fetchTodayEarnings(env) {
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const url = `https://api.nasdaq.com/api/calendar/earnings?date=${dateStr}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`nasdaq ${res.status}`);
    const data = await res.json();
    const rows = data?.data?.rows || [];
    return { dateStr, rows };
}

async function _sendTodayEarnings(env) {
    let dateStr, rows;
    try {
        ({ dateStr, rows } = await _fetchTodayEarnings(env));
    } catch (e) {
        await _tgDirect(env, `⚠ 실적 캘린더 조회 실패: ${e?.message?.slice(0, 100) || '알 수 없는 오류'}`);
        return;
    }
    if (!rows.length) {
        await _tgDirect(env, `📭 오늘(${dateStr}) 실적 발표 예정 기업 없음`);
        return;
    }

    const timeKo = (t) => t === 'time-pre-market' ? '장전(BMO)' : t === 'time-after-hours' ? '장마감후(AMC)' : '시간미정';
    const parsed = rows.map(r => ({
        symbol: r.symbol,
        name: r.name?.trim() || r.symbol,
        rawTime: r.time,
        timeLabel: timeKo(r.time),
        eps: r.epsForecast && r.epsForecast !== 'N/A' ? r.epsForecast : null,
        marketCap: parseFloat(String(r.marketCap || '').replace(/[$,]/g, '')) || 0,
    }));

    // 이미 발표됐을 시간대는 제외 — 장전(BMO)은 정규장 개장(9:30 ET) 이후, 장마감후(AMC)는
    // 정규장 마감(16:00 ET) 이후면 이미 발표됐다고 보고 리스트에서 뺌.
    const etMin = _etTotalMin();
    const isPastOpen  = etMin >= 9 * 60 + 30;
    const isPastClose = etMin >= 16 * 60;
    const pending = parsed.filter(r => {
        if (r.rawTime === 'time-pre-market' && isPastOpen) return false;
        if (r.rawTime === 'time-after-hours' && isPastClose) return false;
        return true;
    });
    const alreadyReported = parsed.length - pending.length;
    pending.sort((a, b) => b.marketCap - a.marketCap);

    if (!pending.length) {
        await _tgDirect(env, `📭 오늘(${dateStr}) 남은 실적 발표 예정 기업 없음 (총 ${parsed.length}개 중 ${alreadyReported}개는 이미 발표됨)`);
        return;
    }

    const TOP_N = 15;
    const top = pending.slice(0, TOP_N);
    const fmtCap = (v) => v >= 1e12 ? `$${(v / 1e12).toFixed(1)}조` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v > 0 ? `$${(v / 1e6).toFixed(0)}M` : '-';
    const lines = top.map(r =>
        `  <b>${r.symbol}</b> ${r.name}  ·  ${r.timeLabel}${r.eps ? `  ·  예상 EPS ${r.eps}` : ''}  ·  시총 ${fmtCap(r.marketCap)}`
    );

    const rest = pending.length - top.length;
    await _tgDirect(env, [
        `📅 <b>오늘(${dateStr}) 실적 발표 예정</b> (아직 안 한 것만, 시총 상위 ${top.length}/${pending.length}개${alreadyReported ? ` · 이미 발표된 ${alreadyReported}개 제외` : ''})`,
        '',
        ...lines,
        rest > 0 ? `\n외 ${rest}개 더 (소형주 위주)` : '',
    ].filter(Boolean).join('\n'));
}

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
    const qty = Math.floor((acct.day_position_size || 10000) * (TRANCHE_WEIGHTS[0] / TRANCHE_WEIGHT_SUM) / price); // 1차 트랜쉐 (단타 풀)

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
        const [data, quoteMap, acct, daily, tf15, tf60, news, options, analyst, shortInt] = await Promise.all([
            yfRequest(env.CACHE, chartUrl),
            _quotePrice(env, [symbol]),
            env.DB.prepare("SELECT day_balance, day_position_size FROM paper_account WHERE user_id=?")
                .bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first(),
            _fetchTfData(env, symbol, '6mo', '1d'),
            _fetchTfData(env, symbol, '1mo', '15m'),
            _fetchTfData(env, symbol, '3mo', '60m'),
            getNewsSentiment(env, symbol).catch(() => null),
            _fetchOptionsSummary(env, symbol).catch(() => null),
            _fetchAnalystData(env, symbol).catch(() => null),
            _fetchShortInterest(env, symbol).catch(() => null),
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
        // EMA20 관심가는 "그 타임프레임 자체가 상승/하락 추세일 때 + 현재가와 너무 안 멀 때"만 의미 있음
        // (하락추세인 타임프레임에서 훨씬 위에 있는 EMA20을 "매수 관심가"라고 보여주는 건 오해 소지 큼)
        const EMA_MAX_DIST_PCT = 8; // 현재가 대비 8% 이상 벌어지면 근시일 내 관심가로 부적절 판단
        const tfLines = tfDefs.map(([label, tf, interval]) => {
            if (!tf) return `  ${label}   데이터 부족`;
            const p = _tfPerspective(tf.q);
            if (!p) return `  ${label}   데이터 부족`;
            const arrow = p.trend === '상승' ? '↑' : p.trend === '하락' ? '↓' : '→';
            const base = `  ${label}   ${p.trend}${arrow}  RSI ${p.rsi ?? '-'}  ADX ${p.adx ?? '-'}`;
            const tfSig = interval === '5m' ? sig : _tfBuySignal(tf.q, tf.ts, interval);
            if (!tfSig) {
                const emaDistPct = p.ema20 && price > 0 ? Math.abs(p.ema20 - price) / price * 100 : null;
                const emaUsable = p.ema20 && emaDistPct != null && emaDistPct <= EMA_MAX_DIST_PCT;
                if (emaUsable && p.trend === '상승' && p.ema20 < price) return `${base}  | 1차매수관심 $${p.ema20.toFixed(2)}`;
                if (emaUsable && p.trend === '하락' && p.ema20 > price) return `${base}  | 1차매도관심 $${p.ema20.toFixed(2)}`;
                return `${base}  | 신호없음`;
            }
            return `${base}  | 🟢진입$${tfSig.price.toFixed(2)} 손절$${tfSig.stop.toFixed(2)} 목표$${tfSig.target1.toFixed(2)} [${tfSig.grade}]`;
        });
        const mtfBlock = ['<b>🕐 멀티 타임프레임 관점</b>', ...tfLines].join('\n');

        // 뉴스 감성 — 매매 관점 참고용
        const newsEmoji = news?.sentiment === 'positive' ? '🟢' : news?.sentiment === 'negative' ? '🔴' : '⚪';
        const newsBlock = news?.headline
            ? `<b>📰 뉴스</b>\n  ${newsEmoji} ${news.sentiment} — ${news.headlineKo || news.headline}`
            : null;

        // 옵션 현황 — 맥스페인 + 콜/풋 미결제약정 비교 + 행사가별 집중 구간(지지/저항 참고)
        const fmtStrikes = (list) => list.length
            ? list.map(s => `$${s.strike.toFixed(2)}(${s.oi.toLocaleString()})`).join(', ')
            : '-';
        const optionsBlock = options ? [
            `<b>🎯 옵션 현황</b> (만기 ${options.expiry || '-'})`,
            `  맥스페인 $${options.maxPain?.toFixed(2) ?? '-'}  (현재가 ${price > (options.maxPain || 0) ? '위 ↑' : '아래 ↓'})`,
            `  콜 OI ${options.callOI.toLocaleString()}  |  풋 OI ${options.putOI.toLocaleString()}  → ${options.callOI >= options.putOI ? '콜' : '풋'} 우세 (P/C ${options.pcRatioOI ?? '-'})`,
            `  콜 집중가(저항 참고) ${fmtStrikes(options.topCallStrikes)}`,
            `  풋 집중가(지지 참고) ${fmtStrikes(options.topPutStrikes)}`,
        ].join('\n') : null;

        // 애널리스트 평균 — 목표주가(평균/최고/최저) + 추천등급
        const analystBlock = analyst ? (() => {
            const upside = analyst.targetMean != null && price > 0
                ? (((analyst.targetMean - price) / price) * 100).toFixed(1) : null;
            const reco = _RECO_KO[analyst.recoKey] || analyst.recoKey || '-';
            return [
                `<b>🏦 애널리스트 평균</b> (${analyst.numAnalysts ?? '-'}개 기관)`,
                `  목표주가 평균 $${analyst.targetMean?.toFixed(2) ?? '-'}` + (upside != null ? `  (현재가 대비 ${upside >= 0 ? '+' : ''}${upside}%)` : ''),
                `  범위 $${analyst.targetLow?.toFixed(2) ?? '-'} ~ $${analyst.targetHigh?.toFixed(2) ?? '-'}  |  추천등급: ${reco}`,
            ].join('\n');
        })() : null;

        // 공매도 잔고 — 유통주식 대비 비중 + 전월 대비 증감 (반월 지연 데이터, 통상 거래소 정산 주기)
        const shortInterestBlock = shortInt ? [
            `<b>📉 공매도 잔고</b> (${shortInt.asOf || '-'} 기준)`,
            `  잔고 ${(shortInt.shares / 1e6).toFixed(2)}M주` + (shortInt.pctOfFloat != null ? `  (유통주식의 ${shortInt.pctOfFloat.toFixed(1)}%)` : ''),
            [
                shortInt.chgPct != null ? `전월 대비 ${shortInt.chgPct >= 0 ? '+' : ''}${shortInt.chgPct.toFixed(1)}%` : null,
                shortInt.daysToCover != null ? `숏레이쇼 ${shortInt.daysToCover.toFixed(1)}일` : null,
            ].filter(Boolean).map(s => `  ${s}`).join('\n'),
        ].filter(Boolean).join('\n') : null;

        // 신호 없음
        if (!sig) {
            const ema60 = calcEMA(q.close || [], 60);
            const lastEma = [...ema60].reverse().find(v => v != null);
            const emaStr = lastEma ? `EMA60 $${lastEma.toFixed(2)} (가격 ${price > lastEma ? '위 ↑' : '아래 ↓'})` : '';

            // 종합 롱/숏 관점 — 멀티타임프레임 추세 + RSI 극단 + 뉴스 + 옵션 포지셔닝을 점수화.
            // 신호가 아직 안 떴을 때도 "지금 이 시점에서 어느 쪽이 우세한지 + 왜"를 미리 안내.
            const pDaily = daily ? _tfPerspective(daily.q) : null;
            const p60    = tf60  ? _tfPerspective(tf60.q)  : null;
            const p15    = tf15  ? _tfPerspective(tf15.q)  : null;
            const p5     = _tfPerspective(q);

            let biasScore = 0;
            const biasReasons = [];
            const addTrend = (label, p, weight) => {
                if (!p) return;
                if (p.trend === '상승') { biasScore += weight; biasReasons.push(`${label} 상승추세 (+${weight})`); }
                else if (p.trend === '하락') { biasScore -= weight; biasReasons.push(`${label} 하락추세 (-${weight})`); }
            };
            addTrend('일봉', pDaily, 2);
            addTrend('60분봉', p60, 1.5);
            addTrend('15분봉', p15, 1);
            addTrend('5분봉', p5, 0.5);

            if (pDaily?.rsi != null) {
                if (pDaily.rsi >= 75) { biasScore -= 1; biasReasons.push(`일봉 RSI ${pDaily.rsi} 과매수 경계 (-1)`); }
                else if (pDaily.rsi <= 25) { biasScore += 1; biasReasons.push(`일봉 RSI ${pDaily.rsi} 과매도 반등기대 (+1)`); }
            }
            if (news?.sentiment === 'positive') { biasScore += 1; biasReasons.push('뉴스 긍정 (+1)'); }
            else if (news?.sentiment === 'negative') { biasScore -= 1; biasReasons.push('뉴스 부정 (-1)'); }

            if (options?.pcRatioOI != null) {
                if (options.pcRatioOI <= 0.7) { biasScore += 0.5; biasReasons.push(`옵션 콜 우세 P/C ${options.pcRatioOI} (+0.5)`); }
                else if (options.pcRatioOI >= 1.3) { biasScore -= 0.5; biasReasons.push(`옵션 풋 우세 P/C ${options.pcRatioOI} (-0.5)`); }
            }

            const biasLabel = biasScore >= 2 ? '🟢 롱(매수) 관점 우세' : biasScore <= -2 ? '🔴 숏(매도) 관점 우세' : '⚪ 중립 — 방향성 불분명';
            const biasBlock = [
                `<b>🧭 종합 관점: ${biasLabel}</b> (스코어 ${biasScore.toFixed(1)})`,
                ...(biasReasons.length ? biasReasons.map(r => `  · ${r}`) : ['  · 뚜렷한 근거 부족 — 관망 권장']),
            ].join('\n');

            // 눌림목(롱) 매수 관심가 + 반등(숏) 매도 관심가 — EMA20 기준.
            // 그 타임프레임 자체가 상승추세일 때만 매수 관심가로, 하락추세일 때만 매도 관심가로 채택.
            // (하락추세 타임프레임의 EMA20은 위에서 눌려 내려오는 중이라 "매수 관심가"로 보여주면 오해 소지)
            // 현재가와 8% 넘게 벌어진 값도 근시일 내 관심가로 부적절하다고 보고 제외.
            // EMA20은 해당 봉이 마감된 시점 기준 값이라, 그 사이 실시간가가 더 움직인 경우
            // (특히 SOXL 같은 변동성 큰 레버리지 ETF) 이미 뚫고 지나간 값이 나올 수 있음 —
            // 매수 관심가는 반드시 현재가보다 낮아야, 매도 관심가는 반드시 현재가보다 높아야 의미가 있음.
            const tfPoints = [['5분봉', p5], ['15분봉', p15], ['60분봉', p60]];
            const usable = ([, p]) => p?.ema20 && price > 0 && Math.abs(p.ema20 - price) / price * 100 <= EMA_MAX_DIST_PCT;
            const buyPoints  = tfPoints.filter(t => usable(t) && t[1].trend === '상승' && t[1].ema20 < price);
            const sellPoints = tfPoints.filter(t => usable(t) && t[1].trend === '하락' && t[1].ema20 > price);

            let watchBlock = null;
            if (buyPoints.length || sellPoints.length) {
                const parts = [];
                if (buyPoints.length) {
                    parts.push(['<b>💡 눌림목 1차 매수 관심가</b>', ...buyPoints.map(([label, p]) => `  ${label} EMA20  $${p.ema20.toFixed(2)}`)].join('\n'));
                }
                if (sellPoints.length) {
                    parts.push(['<b>💡 반등 시 1차 매도 관심가</b>', ...sellPoints.map(([label, p]) => `  ${label} EMA20  $${p.ema20.toFixed(2)}`)].join('\n'));
                }
                parts.push('※ 참고용 관심가 — 실제 진입은 거래량·RSI 등 확인 후 신호 발생 시 권장');
                watchBlock = parts.join('\n\n');
            }

            // 심층 진단 — 5분봉 신호가 왜 안 뜨는지, 어떤 조건이 얼마나 부족한지 그대로 노출.
            // "꼭 사고 싶은데 신호가 없다" 케이스에서 관망 권장 한 줄 대신 구체적 근거를 보여주기 위함.
            const diag = smartDipDiagnose(q, { interval: '5m', ts });
            let diagBlock = null;
            if (diag) {
                const fmt = (label, d, threshold) => {
                    const status = d.pass ? '✅ 조건 충족' : (d.failReason || `조건 미달 (${d.need}점 부족)`);
                    const passedStr = d.reasons.length ? `충족 요소: ${d.reasons.join(', ')}` : '충족된 요소 없음';
                    return `  <b>${label}</b> ${d.qs}/${threshold}점 — ${status}\n    ${passedStr}`;
                };
                diagBlock = [
                    '<b>🔬 심층 진단</b> (5분봉 최근 봉 기준 — 신호 미충족 원인)',
                    fmt('매수(추세)', diag.buy, 5),
                    fmt('매도(추세)', diag.sell, 5),
                    fmt('매수(반등)', diag.bounce, 3.5),
                ].join('\n');
            }

            await _tgDirect(env, [
                `📊 <b>${symbol}</b> @ $${price.toFixed(2)} (${chgStr})`,
                emaStr,
                '',
                biasBlock,
                '',
                mtfBlock,
                watchBlock ? '' : null, watchBlock,
                newsBlock ? '' : null, newsBlock,
                optionsBlock ? '' : null, optionsBlock,
                analystBlock ? '' : null, analystBlock,
                shortInterestBlock ? '' : null, shortInterestBlock,
                diagBlock ? '' : null, diagBlock,
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
            analystBlock ? '' : null, analystBlock,
            shortInterestBlock ? '' : null, shortInterestBlock,
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
    const acct = await env.DB.prepare(
        "SELECT balance, total_pnl, seed_amount FROM paper_account WHERE user_id=?"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first();
    // seed_amount 미설정(과거 계정 등) 폴백 — balance-total_pnl로 역산 (오픈 포지션 없을 때만 정확)
    const SEED = acct?.seed_amount ?? ((acct?.balance ?? 100000) - (acct?.total_pnl ?? 0));

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
        LIMIT 40
    `).bind(since).all();

    // 같은 종목·방향의 반복 신호(가격이 조금씩 바뀌며 5분마다 재포착됨)는 종목당 최신 것 하나만 유지
    const seen = new Set();
    const signals = (rows.results || []).filter(s => {
        const key = `${s.symbol}|${s.dir}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (!signals.length) { await _tgDirect(env, '📭 최근 8시간 S/A 시그널 없음'); return; }

    const fmtLine = (s) => {
        const tf    = s.tf === '5m' ? '단타' : '스윙';
        const entry = s.entry ? ` $${Number(s.entry).toFixed(2)}` : '';
        const stop  = s.stop  ? ` 손절$${Number(s.stop).toFixed(2)}` : '';
        const score = s.score != null ? s.score.toFixed(1) : '';
        return `  ${s.symbol}${entry}${stop} [${score}/${tf}]`;
    };

    // 등급(S→A) × 방향(매수→매도) 순서로 그룹핑
    const groups = [
        ['S', 'buy',  '🌟 S등급 매수'],
        ['S', 'sell', '🌟 S등급 매도'],
        ['A', 'buy',  '🅰️ A등급 매수'],
        ['A', 'sell', '🅰️ A등급 매도'],
    ];
    const sections = groups
        .map(([grade, dir, title]) => {
            const items = signals.filter(s => s.grade === grade && s.dir === dir);
            if (!items.length) return null;
            return `<b>${title}</b> (${items.length}건)\n${items.map(fmtLine).join('\n')}`;
        })
        .filter(Boolean);

    await _tgDirect(env, `📡 오늘 스캔 결과 (${signals.length}건, 최근 8시간)\n\n${sections.join('\n\n')}`);
}

// 추가 매수 참고가 산출 — 자동매매 엔진 규칙(고정 -0.2%)과 무관한 참고용 분석.
// 롱 기준: 상승추세가 살아있으면 EMA20 눌림목을, 아니면 ATR(14) 변동성 눌림 폭을 지지 기준으로 사용.
// 숏은 방향만 반대로 적용(EMA20 반등 저항 / ATR 반등 폭).
async function _trancheAdvice(env, pos, cur) {
    if (!cur || cur <= 0) return null;
    try {
        const isShort  = pos.dir === 'short';
        let interval = pos.style === 'swing' ? '1d' : '15m';
        let range    = pos.style === 'swing' ? '6mo' : '1mo';
        let tf = await _fetchTfData(env, pos.symbol, range, interval);
        let { close = [], high = [], low = [] } = tf?.q || {};
        // 신규 상장 등으로 일봉 데이터가 30개 미만이면 60분봉으로 대체 시도 (같은 기간이라도 바 개수 확보)
        if (close.filter(v => v != null).length < 30 && interval === '1d') {
            interval = '60m'; range = '1mo';
            tf = await _fetchTfData(env, pos.symbol, range, interval);
            ({ close = [], high = [], low = [] } = tf?.q || {});
        }
        if (!tf || close.filter(v => v != null).length < 30) return null;

        const e20 = lastVal(calcEMA(close, 20));
        const e60 = lastVal(calcEMA(close, 60));
        const atr = lastVal(calcATR(high, low, close, 14));

        let recPrice = null, basis = null;
        if (!isShort) {
            if (e20 != null && e60 != null && e20 < cur && e20 > e60) {
                recPrice = e20; basis = 'EMA20 눌림목 지지';
            } else if (atr > 0) {
                recPrice = cur - atr; basis = 'ATR(14) 변동성 눌림';
            }
            if (recPrice == null || recPrice <= 0 || recPrice >= cur) return null;
        } else {
            if (e20 != null && e60 != null && e20 > cur && e20 < e60) {
                recPrice = e20; basis = 'EMA20 반등 저항';
            } else if (atr > 0) {
                recPrice = cur + atr; basis = 'ATR(14) 변동성 반등';
            }
            if (recPrice == null || recPrice <= cur) return null;
        }

        const recPct = (recPrice - cur) / cur * 100;
        if (interval === '60m' && pos.style === 'swing') basis += ' · 일봉 데이터 부족으로 60분봉 대체';
        return { recPrice, recPct, basis };
    } catch (_) { return null; }
}

// 지금 왜 매매가 없는지 — 시장 레짐 게이트(daily-scanner.js _tryOpenPaperTrade와 동일 조건) 그대로 재현해서 설명.
// "신호는 뜨는데 진입이 안 된다"는 문의에 대해 관망(정상 필터링)인지 확인해주기 위함.
async function _sendWatchStatus(env) {
    const regime = await getMarketRegime(env);
    const openRes = await env.DB.prepare(
        "SELECT style, COUNT(*) n FROM paper_trades WHERE user_id=? AND status='open' GROUP BY style"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').all();
    const openByStyle = {};
    for (const row of (openRes.results || [])) openByStyle[row.style] = row.n;

    // _tryOpenPaperTrade(daily-scanner.js)의 ① 레짐 게이트와 정확히 동일한 조건
    const longBlocked = regime.regime === 'risk_off' && regime.spyChgPct < -0.3;
    const longSOnly   = !longBlocked && regime.spyChgPct < -0.5;
    const shortBlocked = regime.regime !== 'risk_off';

    const regimeEmoji = regime.regime === 'risk_off' ? '🔴' : regime.regime === 'favorable' ? '🟢' : '⚪';
    const lines = [
        `${regimeEmoji} <b>현재 시장 레짐: ${regime.label}</b>`,
        `  SPY ${regime.spyChgPct > 0 ? '+' : ''}${regime.spyChgPct}%  ·  VIX ${regime.vix ?? '-'}  ·  추세 ${regime.spyTrend === 'up' ? '상승' : regime.spyTrend === 'down' ? '하락' : '횡보'}`,
        `  ${regime.note}`,
        '',
        `📊 포지션 슬롯: 단타 ${openByStyle.day || 0}/3  ·  스윙 ${openByStyle.swing || 0}/3`,
        '',
        `매수(롱) 진입: ${longBlocked ? '🔴 전면 차단 (위험레짐 + SPY 약세)' : longSOnly ? '🟡 S등급만 허용' : '🟢 정상 (S/A등급 통과 시 진입)'}`,
        `매도(숏) 진입: ${shortBlocked ? '🔴 차단 (하락장 아님 — risk_off 때만 허용)' : '🟢 정상 (S/A등급 통과 시 진입)'}`,
        '',
        (longBlocked || shortBlocked)
            ? '📭 신호는 뜨는데 매매가 안 되는 건 대부분 이 레짐 필터 때문입니다 — 관망은 정상 동작입니다.'
            : '✅ 지금은 정상 진입 가능 상태입니다 — 등급 조건 통과하는 신호가 없으면 관망일 수 있습니다.',
    ];
    await _tgDirect(env, lines.join('\n'));
}

// 당일(ET 기준) 가상매매 결과 정리 — 오늘 진입/청산된 건을 종목별로 나열 + 오늘자 승률/손익 집계.
// 기존 "리포트"(sendDailyHealthSummary)는 운영 상태 점검용 요약이라 종목별 상세가 없음 — 이건 그 상세 버전.
async function _sendTodayResults(env) {
    const userId = 'user_3EhxWla1QzZmEG19xfFdmnUTUrp';
    const dayStartMs = Date.now() - _etTotalMin() * 60 * 1000; // 오늘 ET 자정 근사치

    const [openedRes, closedRes] = await Promise.all([
        env.DB.prepare(
            "SELECT symbol,dir,style,grade,avg_price,total_qty,status,created_at FROM paper_trades WHERE user_id=? AND created_at>=? ORDER BY created_at ASC"
        ).bind(userId, dayStartMs).all(),
        env.DB.prepare(
            "SELECT symbol,dir,style,grade,avg_price,realized_pnl,close_reason,created_at,exit_at FROM paper_trades WHERE user_id=? AND status='closed' AND exit_at>=? ORDER BY exit_at ASC"
        ).bind(userId, dayStartMs).all(),
    ]);

    const opened = openedRes.results || [];
    const closed = closedRes.results || [];
    if (!opened.length && !closed.length) {
        await _tgDirect(env, '📋 오늘 가상매매 결과 없음 — 진입/청산 내역이 없습니다.');
        return;
    }

    const closedReasonKo = {
        stop: '손절', tp1_trail: '트레일링', tp2_trail: '트레일링', tp3_trail: '트레일링', tp4_trail: '트레일링',
        be_protect: '본전보호', timeout: '보유기간만료', overnight_exit: '익일시가청산', manual: '수동청산',
    };

    // 오늘 청산된 건 — 심볼/방향/손익/사유
    const closedLines = closed.map(t => {
        const win = (t.realized_pnl || 0) >= 0;
        const dirLabel = t.dir === 'short' ? '숏' : '롱';
        const reason = closedReasonKo[t.close_reason] || t.close_reason || '-';
        const holdMin = ((t.exit_at - t.created_at) / 60000).toFixed(0);
        return `  ${win ? '✅' : '❌'} <b>${t.symbol}</b> ${dirLabel}[${t.style}]  ${win ? '+' : '-'}$${Math.abs(t.realized_pnl || 0).toFixed(0)}  (${reason}, ${holdMin}분 보유)`;
    });

    // 오늘 진입했지만 아직 열려있는 건 (오늘 청산분과 별도)
    const stillOpen = opened.filter(t => t.status === 'open');
    const openLines = stillOpen.map(t => {
        const dirLabel = t.dir === 'short' ? '숏' : '롱';
        return `  🔵 <b>${t.symbol}</b> ${dirLabel}[${t.style}] [${t.grade}]  평단 $${t.avg_price?.toFixed(2) ?? '-'}  (보유중)`;
    });

    const wins = closed.filter(t => (t.realized_pnl || 0) >= 0).length;
    const winRate = closed.length ? Math.round((wins / closed.length) * 100) : null;
    const totalPnl = closed.reduce((s, t) => s + (t.realized_pnl || 0), 0);

    const lines = [
        `📋 <b>오늘 가상매매 결과</b> (${new Date().toISOString().slice(0, 10)})`,
        `진입 ${opened.length}건  |  청산 ${closed.length}건 (${winRate != null ? `승률 ${winRate}%` : '청산 없음'})  |  실현손익 ${totalPnl >= 0 ? '+' : '-'}$${Math.abs(totalPnl).toFixed(0)}`,
        '',
    ];
    if (closedLines.length) {
        lines.push('<b>✅/❌ 오늘 청산</b>', ...closedLines, '');
    }
    if (openLines.length) {
        lines.push('<b>🔵 오늘 진입 후 보유중</b>', ...openLines);
    }

    await _tgDirect(env, lines.join('\n'));
}

async function _sendPositions(env) {
    const rows = await env.DB.prepare(
        "SELECT symbol,dir,avg_price,total_qty,total_invested,realized_pnl,style,tranche_count,stop_price,tp1_done,first_price FROM paper_trades WHERE user_id=? AND status='open' ORDER BY created_at DESC"
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').all();

    const positions = rows.results || [];
    if (!positions.length) { await _tgDirect(env, '📭 오픈 포지션 없음'); return; }

    // 현재가 배치 조회
    const quotes = await _quotePrice(env, positions.map(p => p.symbol));
    const acct = await env.DB.prepare(
        'SELECT day_position_size,swing_position_size FROM paper_account WHERE user_id=?'
    ).bind('user_3EhxWla1QzZmEG19xfFdmnUTUrp').first();

    const lines = await Promise.all(positions.map(async (p) => {
        const cur    = quotes[p.symbol]?.price;
        const isShort = p.dir === 'short';
        const dir    = isShort ? '숏' : '롱';
        const mult   = isShort ? -1 : 1;
        const qty    = p.total_qty ? p.total_qty.toFixed(0) : '?';
        const pnl    = cur ? ((cur - p.avg_price) * p.total_qty * mult).toFixed(0) : null;
        const chgPct = cur ? ((cur - p.avg_price) / p.avg_price * mult * 100).toFixed(2) : null;
        const sign   = pnl > 0 ? '+' : '';
        const curStr = cur ? `$${cur.toFixed(2)} (${sign}${chgPct}%)` : '조회실패';
        const pnlStr = pnl != null ? `미실현 ${sign}$${pnl}` : '';
        const stopStr = p.stop_price ? `손절 $${p.stop_price.toFixed(2)}` : '';

        const trancheCount = p.tranche_count || 1;
        let trancheStr = `${trancheCount}/${MAX_TRANCHE}분할`;
        if (trancheCount < MAX_TRANCHE && !p.tp1_done) {
            const nextTrigger = TRANCHE_TRIGGERS[trancheCount];
            if (nextTrigger > 0) {
                const nextPrice = isShort
                    ? p.first_price * (2 - nextTrigger)
                    : p.first_price * nextTrigger;
                trancheStr += ` (다음 $${nextPrice.toFixed(2)})`;
            }
        } else if (trancheCount < MAX_TRANCHE && p.tp1_done) {
            trancheStr += ' (1차익절 완료, 추가분할 종료)';
        }

        let adviceStr = null;
        if (trancheCount < MAX_TRANCHE && !p.tp1_done && cur) {
            const advice = await _trancheAdvice(env, p, cur);
            if (advice) {
                const posSizeField = (p.style === 'day' || p.style === 'closebet') ? 'day_position_size' : 'swing_position_size';
                const posSize = acct?.[posSizeField] || (p.style === 'day' ? 10000 : 23000);
                const amount = posSize * TRANCHE_WEIGHTS[trancheCount] / TRANCHE_WEIGHT_SUM;
                const addQty = Math.floor(amount / advice.recPrice);
                adviceStr = `  💡 전문가 참고: 추가매수 관심가 $${advice.recPrice.toFixed(2)} (${advice.recPct > 0 ? '+' : ''}${advice.recPct.toFixed(1)}%, ${advice.basis}) | 참고금액 $${amount.toFixed(0)} (~${addQty}주)`;
            }
        }

        return [
            `• <b>${p.symbol}</b> ${dir} [${p.style}]  ${trancheStr}  |  <b>${qty}주</b>`,
            `  평단 $${p.avg_price.toFixed(2)}  →  현재 ${curStr}`,
            [pnlStr, stopStr].filter(Boolean).join('  |  '),
            adviceStr,
        ].filter(Boolean).join('\n');
    }));
    await _tgDirect(env, `📊 오픈 포지션 (${positions.length}건)\n\n${lines.join('\n\n')}`);
}
