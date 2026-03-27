/**
 * StockAI Backend Server
 * Yahoo Finance API 프록시 (crumb 인증 자동 처리)
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const axios      = require('axios');
const path       = require('path');
const https      = require('https');
const http       = require('http');
const multer     = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');

// Yahoo Finance 응답 헤더가 커서 기본 8KB 한도를 초과할 수 있음
// 옵션체인 API는 헤더가 특히 커서 128KB로 확장
const MAX_HEADER = 131072; // 128KB
const httpAgent  = new http.Agent({ maxHeaderSize: MAX_HEADER });
const httpsAgent = new https.Agent({ maxHeaderSize: MAX_HEADER });

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// multer: 메모리 저장 (5MB 제한)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (['image/png','image/jpeg','image/webp','image/gif'].includes(file.mimetype)) cb(null, true);
        else cb(new Error('지원하지 않는 이미지 형식입니다.'));
    },
});

// [Fix-F] 시작 시 필수 env var 누락 경고
if (!process.env.GEMINI_API_KEY)  console.warn('⚠️  GEMINI_API_KEY 환경변수가 없습니다.');
if (!process.env.SUPABASE_URL)    console.warn('⚠️  SUPABASE_URL 환경변수가 없습니다.');
if (!process.env.SUPABASE_ANON_KEY) console.warn('⚠️  SUPABASE_ANON_KEY 환경변수가 없습니다.');

// [Fix-F] 싱글턴 캐싱 — 매 요청마다 인스턴스 재생성 방지
let _genAI = null;
function getGenAI() {
    if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    return _genAI;
}

// [Fix-F] _supabase = null(미설정) or createClient 인스턴스 — 최초 1회만 생성
let _supabase;
function getSupabase() {
    if (_supabase !== undefined) return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    _supabase = (url && key) ? createClient(url, key) : null;
    return _supabase;
}

// [Fix-F] 입력값 화이트리스트 검증 헬퍼
const SYMBOL_RE      = /^[A-Z0-9.\-\^]{1,20}$/i;
const VALID_RANGES   = new Set(['1d','5d','1mo','3mo','6mo','1y','2y','5y','10y','ytd','max']);
const VALID_INTERVALS= new Set(['1m','2m','5m','15m','30m','60m','90m','1h','1d','5d','1wk','1mo','3mo']);
const VALID_FILTERS  = new Set(['day_gainers','day_losers','most_actives']);
function validSymbol(s) { return s && SYMBOL_RE.test(s); }
function validRange(r)  { return !r || VALID_RANGES.has(r); }
function validInterval(i){ return !i || VALID_INTERVALS.has(i); }
function validFilter(f) { return f && VALID_FILTERS.has(f); }

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
    // [Fix-F] 입력 검증
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!validRange(range))   return res.status(400).json({ error: 'invalid range' });
    if (!validInterval(interval)) return res.status(400).json({ error: 'invalid interval' });
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
    // [Fix-F] 입력 검증
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
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
    // [Fix-F] 입력 검증 — date는 Unix 숫자 타임스탬프만 허용
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (date && !/^\d{1,13}$/.test(date)) return res.status(400).json({ error: 'invalid date' });
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
    // [Fix-F] 화이트리스트 필터 검증
    if (!validFilter(filter)) return res.status(400).json({ error: 'invalid filter' });
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
 * 텍스트 번역 (영→한)
 * GET /api/translate?text=...
 */
app.get('/api/translate', async (req, res) => {
    const text = req.query.text;
    if (!text || text.length > 500) return res.status(400).json({ error: 'invalid' });
    try {
        const translated = await translateToKo(text);
        res.json({ translated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 소셜 피드 — StockTwits 종목별 스트림
 * GET /api/stocktwits/:symbol
 */
app.get('/api/stocktwits/:symbol', async (req, res) => {
    const { symbol } = req.params;
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    try {
        const r = await fetch(
            `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json?limit=20`,
            { headers: { 'User-Agent': 'StockAI/1.0' } }
        );
        if (!r.ok) return res.status(r.status).json({ error: 'StockTwits 데이터 없음' });
        res.json(await r.json());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 소셜 피드 — StockTwits 트렌딩 (홈용)
 * GET /api/stocktwits-trending
 */
app.get('/api/stocktwits-trending', async (_req, res) => {
    try {
        const r = await fetch(
            'https://api.stocktwits.com/api/2/streams/trending.json?limit=10',
            { headers: { 'User-Agent': 'StockAI/1.0' } }
        );
        if (!r.ok) return res.status(r.status).json({ error: 'StockTwits 트렌딩 없음' });
        res.json(await r.json());
    } catch (err) {
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
 * AI 차트 판독기 — Vision Scanner
 * POST /api/vision-scan  (multipart/form-data, field: "image")
 * 응답: { zones: [...], summary: "마크다운 텍스트" }
 */
app.post('/api/vision-scan', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
    if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    }

    try {
        const b64      = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype;

        const genAI = getGenAI();
        if (!genAI) return res.status(503).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const prompt = `당신은 전문 주식 차트 기술 분석가입니다. 업로드된 차트 이미지를 분석하여 지지선과 저항선을 찾아주세요.

반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트는 절대 포함하지 마세요.

{
  "zones": [
    {
      "type": "support 또는 resistance",
      "yRatio": 0~1 사이 숫자 (이미지 높이 기준 위치 비율, 위=0, 아래=1),
      "hRatio": 0~1 사이 숫자 (구간 두께 비율, 보통 0.01~0.04),
      "label": "구간 설명 (예: 지지 $350, 저항 ₩84,200)",
      "strength": 0~1 사이 숫자 (구간 강도, 0.5~1.0 권장)
    }
  ],
  "summary": "마크다운 형식의 분석 리포트 (## 헤딩, **볼드**, - 리스트, | 테이블 사용 가능)"
}

분석 기준:
- 가격축은 이미지 오른쪽에 있으며, 위쪽이 높은 가격, 아래쪽이 낮은 가격입니다
- 여러 번 터치된 수평 가격대를 지지/저항으로 식별하세요
- 최대 6개 구간까지 반환하세요 (중요도 높은 순)
- yRatio는 해당 가격선이 이미지 전체 높이에서 몇% 지점인지 0~1 사이 소수점으로 표현
- summary는 한국어로 작성하고, 발견된 가격을 차트의 실제 가격축 숫자로 표기하세요`;

        const result = await model.generateContent([
            prompt,
            { inlineData: { data: b64, mimeType } },
        ]);

        // JSON 파싱
        const raw  = result.response.text().trim();
        // 혹시 ```json ... ``` 래핑된 경우 제거
        const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        const data = JSON.parse(json);

        // zones에 xRatio=0, wRatio=1 기본값 보정
        data.zones = (data.zones || []).map(z => ({
            xRatio:   0,
            yRatio:   Math.max(0, Math.min(1, z.yRatio ?? 0.5)),
            wRatio:   1,
            hRatio:   Math.max(0.005, Math.min(0.08, z.hRatio ?? 0.02)),
            type:     z.type === 'resistance' ? 'resistance' : 'support',
            label:    z.label || (z.type === 'resistance' ? '저항 구간' : '지지 구간'),
            strength: Math.max(0.3, Math.min(1, z.strength ?? 0.7)),
        }));

        console.log(`[vision-scan] 분석 완료: ${data.zones.length}개 구간 탐지`);
        res.json(data);

    } catch (err) {
        console.error('[vision-scan] 오류:', err.message);
        if (err instanceof SyntaxError) {
            return res.status(500).json({ error: 'AI 응답 파싱 실패. 다시 시도해주세요.' });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * AI 차트 직접 그리기 — 지지선/저항선/추세선
 * POST /api/chart-draw  (multipart/form-data, field: "image" + "priceData")
 * 응답: { levels: [...], trendlines: [...], summary: "..." }
 */
app.post('/api/chart-draw', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
    if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
    }

    let priceData = null;
    if (req.body.priceData) {
        try {
            priceData = JSON.parse(req.body.priceData);
        } catch (e) {
            return res.status(400).json({ error: 'priceData JSON 형식이 올바르지 않습니다.' });
        }
    }

    try {
        const b64 = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype;

        let priceContext = '';
        if (priceData) {
            const { closes, highs, lows, dates } = priceData;
            const valid = closes.filter(v => v != null);
            const cur = valid.at(-1)?.toFixed(2) ?? '?';
            priceContext = `\n\n실제 가격 데이터 (${closes.length}개 봉):
날짜(최근20): ${dates.slice(-20).join(', ')}
종가: [${closes.map(v => v != null ? v.toFixed(2) : 'null').join(',')}]
고가: [${highs.map(v => v != null ? v.toFixed(2) : 'null').join(',')}]
저가: [${lows.map(v => v != null ? v.toFixed(2) : 'null').join(',')}]
현재가: ${cur}`;
        }

        const prompt = `당신은 전문 주식 차트 기술 분석가입니다. 차트 이미지와 실제 가격 데이터를 분석하세요.${priceContext}

이미지를 1000×1000 좌표 그리드로 취급하세요. x=0은 차트 왼쪽 끝, x=1000은 오른쪽 끝, y=0은 위(고가), y=1000은 아래(저가)입니다. 모든 추세선 좌표는 이 그리드 기준으로 반환하세요.

반드시 아래 JSON 형식으로만 응답하세요.

{
  "levels": [
    {
      "type": "support 또는 resistance",
      "price": 실제가격숫자,
      "label": "설명 (예: 주요 지지선 $150)",
      "strength": 0.5~1.0
    }
  ],
  "trendlines": [
    {
      "label": "추세선 설명 (예: 상승 추세선)",
      "type": "uptrend 또는 downtrend",
      "point1": { "x": 0~1000, "y": 0~1000 },
      "point2": { "x": 0~1000, "y": 0~1000 }
    }
  ],
  "summary": "한줄 요약 (한국어, 1문장)",
  "report": "상세 분석 리포트 (한국어, 마크다운 형식)"
}

규칙:
- levels 최대 4개 (중요도 높은 순), 제공된 실제 가격 데이터 기준으로 정확한 가격 사용
- trendlines 최대 3개 (추세선의 핵심 Pivot 꼬리 2개를 정확히 짚을 것)
- point1은 항상 더 과거(왼쪽, x가 작은) 점, point2는 더 최근(오른쪽, x가 큰) 점
- report는 상세 기술 분석 리포트를 마크다운으로 작성:
  * ### 종목명 주식 기술 분석 리포트 (제목)
  * 현재가 언급, 전체 추세 설명
  * #### 주요 지지 및 저항 구간: 으로 각 레벨에 대해 **가격대**와 근거를 상세히 설명
  * #### 추세 분석: 추세선의 방향과 의미 설명
  * #### 종합 의견: 단기/중기 전망과 주의사항`;

        const genAI = getGenAI();
        if (!genAI) return res.status(503).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
            },
        });
        const result = await model.generateContent([
            prompt,
            { inlineData: { data: b64, mimeType } },
        ]);

        const raw = result.response.text().trim();
        const json = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        const data = JSON.parse(json);

        data.levels = (data.levels || []).map(l => ({
            type: l.type === 'resistance' ? 'resistance' : 'support',
            price: Number(l.price),
            label: l.label || (l.type === 'resistance' ? '저항선' : '지지선'),
            strength: Math.max(0.3, Math.min(1, l.strength ?? 0.7)),
        })).filter(l => l.price > 0);

        data.trendlines = (data.trendlines || []).map(t => ({
            label: t.label || '추세선',
            type: t.type === 'downtrend' ? 'downtrend' : 'uptrend',
            point1: { x: Math.max(0, Math.min(1000, Number(t.point1?.x ?? 0))), y: Math.max(0, Math.min(1000, Number(t.point1?.y ?? 0))) },
            point2: { x: Math.max(0, Math.min(1000, Number(t.point2?.x ?? 1000))), y: Math.max(0, Math.min(1000, Number(t.point2?.y ?? 0))) },
        })).filter(t => t.point1.x < t.point2.x);

        console.log(`[chart-draw] 완료: ${data.levels.length}개 레벨, ${data.trendlines.length}개 추세선`);
        res.json(data);
    } catch (err) {
        console.error('[chart-draw] 오류:', err.message);
        if (err instanceof SyntaxError) {
            return res.status(500).json({ error: 'AI 응답 파싱 실패. 다시 시도해주세요.' });
        }
        res.status(500).json({ error: err.message });
    }
});

/**
 * AI 분석 결과 저장/로드 (크로스 기기 동기화)
 * GET  /api/ai-analysis/:symbol  → 저장된 분석 결과 조회
 * POST /api/ai-analysis/:symbol  → 분석 결과 저장 (upsert)
 */
app.get('/api/ai-analysis/:symbol', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const symbol = req.params.symbol.toUpperCase();
    try {
        const { data, error } = await supabase
            .from('ai_analysis')
            .select('data')
            .eq('symbol', symbol)
            .single();
        if (error || !data) return res.status(404).json({ error: 'not found' });
        res.json(data.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai-analysis/:symbol', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const symbol = req.params.symbol.toUpperCase();
    try {
        const { error } = await supabase
            .from('ai_analysis')
            .upsert({ symbol, data: req.body, updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ai-analysis/:symbol', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const symbol = req.params.symbol.toUpperCase();
    try {
        const { error } = await supabase.from('ai_analysis').delete().eq('symbol', symbol);
        if (error) throw new Error(error.message);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
