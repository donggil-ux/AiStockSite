/**
 * StockAI Backend Server
 * Yahoo Finance API 프록시 (crumb 인증 자동 처리)
 */

const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const path    = require('path');
const https   = require('https');
const http    = require('http');

// Yahoo Finance 응답 헤더가 커서 기본 8KB 한도를 초과할 수 있음
// 옵션체인 API는 헤더가 특히 커서 128KB로 확장
const MAX_HEADER = 131072; // 128KB
const httpAgent  = new http.Agent({ maxHeaderSize: MAX_HEADER });
const httpsAgent = new https.Agent({ maxHeaderSize: MAX_HEADER });

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// 정적 파일 서빙 (프론트엔드 index.html)
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ─────────────────────────────────────────────
// Yahoo Finance Crumb 인증 (서버-서버 요청)
// ─────────────────────────────────────────────
let _crumb     = null;
let _cookies   = null;
let _crumbTime = 0;
const CRUMB_TTL = 60 * 60 * 1000; // 1시간마다 갱신

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getCrumb() {
    if (_crumb && Date.now() - _crumbTime < CRUMB_TTL) {
        return { crumb: _crumb, cookies: _cookies };
    }

    // Step 1: Yahoo Finance 홈 접속 → 세션 쿠키 획득
    const r1 = await axios.get('https://finance.yahoo.com/', {
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 15000,
        maxRedirects: 5,
        httpAgent,
        httpsAgent,
    });

    const rawCookies = r1.headers['set-cookie'] || [];
    _cookies = rawCookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: crumb 토큰 획득
    const r2 = await axios.get('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: {
            'User-Agent': UA,
            'Cookie': _cookies,
            'Accept': '*/*',
        },
        timeout: 10000,
        httpAgent,
        httpsAgent,
    });

    _crumb     = r2.data;
    _crumbTime = Date.now();
    console.log(`✅ Yahoo Finance crumb 갱신 완료`);
    return { crumb: _crumb, cookies: _cookies };
}

// crumb이 만료되면 자동 재시도
async function yfRequest(url) {
    const { crumb, cookies } = await getCrumb();
    const sep      = url.includes('?') ? '&' : '?';
    const finalUrl = `${url}${sep}crumb=${encodeURIComponent(crumb)}`;

    try {
        const res = await axios.get(finalUrl, {
            headers: { 'User-Agent': UA, 'Cookie': cookies, 'Accept': 'application/json' },
            timeout: 15000,
            httpAgent,
            httpsAgent,
        });
        return res.data;
    } catch (err) {
        // 401/403이면 crumb 만료 → 재발급 후 1회 재시도
        if (err.response?.status === 401 || err.response?.status === 403) {
            _crumb = null;
            const { crumb: c2, cookies: k2 } = await getCrumb();
            const url2 = `${url}${sep}crumb=${encodeURIComponent(c2)}`;
            const res2 = await axios.get(url2, {
                headers: { 'User-Agent': UA, 'Cookie': k2, 'Accept': 'application/json' },
                timeout: 15000,
                httpAgent,
                httpsAgent,
            });
            return res2.data;
        }
        throw err;
    }
}

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────

/**
 * 차트 데이터
 * GET /api/chart/:symbol?range=6mo&interval=1d&includePrePost=false
 */
app.get('/api/chart/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { range = '6mo', interval = '1d', includePrePost = 'false' } = req.query;
    try {
        const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=${includePrePost}`;
        const data = await yfRequest(url);
        res.json(data);
    } catch (err) {
        console.error(`[chart] ${symbol}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 실시간 시세 (여러 종목 동시)
 * GET /api/quote?symbols=AAPL,MSFT,NVDA
 */
app.get('/api/quote', async (req, res) => {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols 파라미터가 필요합니다.' });
    try {
        const url  = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
        const data = await yfRequest(url);
        res.json(data);
    } catch (err) {
        console.error(`[quote] ${symbols}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 기업 요약 정보 (PER, PBR, EPS, 재무 등)
 * GET /api/summary/:symbol?modules=defaultKeyStatistics,financialData,summaryDetail,price
 */
app.get('/api/summary/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { modules = 'defaultKeyStatistics,financialData,summaryDetail,price' } = req.query;
    try {
        const url  = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${encodeURIComponent(modules)}`;
        const data = await yfRequest(url);
        res.json(data);
    } catch (err) {
        console.error(`[summary] ${symbol}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 옵션 체인 데이터
 * GET /api/options/:symbol?date={timestamp}
 * date: Unix timestamp (생략 시 가장 가까운 만기일)
 */
app.get('/api/options/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { date } = req.query;
    try {
        let url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
        if (date) url += `?date=${date}`;
        const data = await yfRequest(url);
        res.json(data);
    } catch (err) {
        console.error(`[options] ${symbol}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 스크리너 (상승률/하락률/거래량 상위 종목)
 * GET /api/screener/:filter?count=100
 * filter: day_gainers | day_losers | most_actives
 */
app.get('/api/screener/:filter', async (req, res) => {
    const { filter } = req.params;
    const { count = 100 } = req.query;
    try {
        const url  = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=${filter}&count=${count}`;
        const data = await yfRequest(url);
        res.json(data);
    } catch (err) {
        console.error(`[screener] ${filter}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Google Translate 비공식 API를 통한 영→한 번역
 */
async function translateToKo(text) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text)}`;
        const r = await axios.get(url, {
            headers: { 'User-Agent': UA },
            timeout: 5000,
        });
        // 응답 형식: [[["번역문","원문",...]], ...]
        const parts = r.data?.[0];
        if (!parts) return text;
        return parts.map(p => p?.[0] || '').join('');
    } catch {
        return text; // 번역 실패 시 원문 반환
    }
}

/**
 * 종목 뉴스 (제목 한글 번역 포함)
 * GET /api/news/:symbol?limit=12
 */
app.get('/api/news/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit) || 12;
    try {
        const url  = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${limit}&enableFuzzyQuery=false`;
        const data = await yfRequest(url);
        const raw  = data?.news || [];
        const mapped = raw.slice(0, limit).map(n => {
            const resolutions = n.thumbnail?.resolutions || [];
            const thumb = (resolutions.find(r => r.tag === '140x140') || resolutions[0])?.url || null;
            return {
                uuid:          n.uuid,
                title:         n.title,
                link:          n.link,
                source:        n.publisher,
                publishedTime: n.providerPublishTime,
                thumbnail:     thumb,
            };
        });
        // 모든 제목 병렬 번역
        const titles = await Promise.all(mapped.map(n => translateToKo(n.title)));
        const news = mapped.map((n, i) => ({ ...n, titleKo: titles[i] }));
        res.json({ symbol, count: news.length, news });
    } catch (err) {
        console.error(`[news] ${symbol}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Yahoo Finance HTML 페이지 스크래핑 (재무 데이터 보조)
 * GET /api/page/:symbol
 */
app.get('/api/page/:symbol', async (req, res) => {
    const { symbol } = req.params;
    try {
        const { cookies } = await getCrumb();
        const r = await axios.get(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, {
            headers: {
                'User-Agent': UA,
                'Cookie': cookies,
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            timeout: 12000,
            httpAgent,
            httpsAgent,
        });
        res.send(r.data);
    } catch (err) {
        console.error(`[page] ${symbol}:`, err.message);
        res.status(500).send('');
    }
});

/**
 * 헬스 체크
 * GET /health
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        crumb: _crumb ? 'active' : 'pending',
        uptime: Math.floor(process.uptime()) + 's',
        timestamp: new Date().toISOString(),
    });
});

// index.html fallback (SPA 라우팅)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────────
// 서버 시작
// Vercel은 module.exports = app 만 사용 (listen 불필요)
// 로컬 실행 시에만 app.listen() 호출
// ─────────────────────────────────────────────
if (require.main === module) {
    // 로컬 실행
    app.listen(PORT, () => {
        console.log(`\n🚀 StockAI Server  →  http://localhost:${PORT}`);
        console.log(`📡 Health check    →  http://localhost:${PORT}/health\n`);
        getCrumb().catch(err => console.error('⚠️  Initial crumb fetch 실패:', err.message));
    });
} else {
    // Vercel 서버리스: cold start 시 crumb 미리 발급
    getCrumb().catch(() => {});
}

module.exports = app;
