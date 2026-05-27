// Yahoo Finance 프록시 라우트 — chart / quote / price / summary
import { yfRequest } from '../utils/crumb.js';
import { polygonChartFallback } from '../utils/polygon.js';
import { validSymbol, validRange, validInterval, json, err } from '../utils/validators.js';

// Yahoo 차트 + Polygon 자동 fallback
// 한국 종목(.KS/.KQ)은 Polygon이 지원 안 하므로 fallback 비활성
function _isKR(symbol) { return /\.(KS|KQ)$/i.test(symbol); }

export async function fetchChartWithFallback(env, symbol, range, interval, includePrePost) {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
        + `?range=${range}&interval=${interval}&includePrePost=${includePrePost}`;
    try {
        const data = await yfRequest(env.CACHE, yahooUrl);
        // Yahoo 응답이지만 candles 가 빈 경우도 fallback
        const candles = data?.chart?.result?.[0]?.timestamp?.length || 0;
        if (candles === 0 && !_isKR(symbol) && env.POLYGON_API) {
            console.log(`[chart] ${symbol} yahoo empty → polygon fallback`);
            return await polygonChartFallback(env, symbol, range, interval);
        }
        return data;
    } catch (e) {
        if (_isKR(symbol) || !env.POLYGON_API) throw e;
        console.warn(`[chart] ${symbol} yahoo fail (${e.message}) → polygon fallback`);
        return await polygonChartFallback(env, symbol, range, interval);
    }
}

// GET /api/chart/:symbol?range=6mo&interval=1d&includePrePost=false
export async function handleChart(req, env, params) {
    const { symbol } = params;
    if (!validSymbol(symbol)) return err(400, 'invalid symbol');
    const url = new URL(req.url);
    const range = url.searchParams.get('range') || '6mo';
    const interval = url.searchParams.get('interval') || '1d';
    const includePrePost = url.searchParams.get('includePrePost') || 'false';
    if (!validRange(range)) return err(400, 'invalid range');
    if (!validInterval(interval)) return err(400, 'invalid interval');
    try {
        const data = await fetchChartWithFallback(env, symbol, range, interval, includePrePost);
        return json(data);
    } catch (e) {
        console.error(`[chart] ${symbol}:`, e.message);
        return err(500, e.message);
    }
}

// GET /api/quote?symbols=NVDA,AAPL
export async function handleQuote(req, env) {
    const url = new URL(req.url);
    const symbols = url.searchParams.get('symbols') || '';
    if (!symbols) return err(400, 'symbols required');
    const list = symbols.split(',').map(s => s.trim()).filter(validSymbol);
    if (!list.length) return err(400, 'no valid symbols');
    try {
        const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list.join(','))}`;
        const data = await yfRequest(env.CACHE, yahooUrl);
        return json(data);
    } catch (e) {
        return err(500, e.message);
    }
}

// GET /api/price/:symbol — 단일 종목 실시간 시세
export async function handlePrice(req, env, params) {
    const { symbol } = params;
    if (!validSymbol(symbol)) return err(400, 'invalid symbol');
    try {
        const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
        const data = await yfRequest(env.CACHE, yahooUrl);
        const r = data?.quoteResponse?.result?.[0];
        if (!r) return err(404, 'symbol not found');
        return json({
            symbol: r.symbol,
            price: r.regularMarketPrice,
            change: r.regularMarketChange,
            changePct: r.regularMarketChangePercent,
            volume: r.regularMarketVolume,
            preMarket: r.preMarketPrice,
            postMarket: r.postMarketPrice,
            marketState: r.marketState,
            name: r.shortName || r.longName,
        });
    } catch (e) {
        return err(500, e.message);
    }
}

// GET /api/summary/:symbol — 회사 요약 정보
export async function handleSummary(req, env, params) {
    const { symbol } = params;
    if (!validSymbol(symbol)) return err(400, 'invalid symbol');
    try {
        const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
            + '?modules=summaryProfile,defaultKeyStatistics,financialData,price';
        const data = await yfRequest(env.CACHE, yahooUrl);
        return json(data);
    } catch (e) {
        return err(500, e.message);
    }
}

// GET /api/search?q=apple — 종목 검색
export async function handleSearch(req, env) {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') || '';
    if (!q || q.length > 50) return err(400, 'invalid query');
    try {
        const yahooUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
        const data = await yfRequest(env.CACHE, yahooUrl);
        return json(data);
    } catch (e) {
        return err(500, e.message);
    }
}
