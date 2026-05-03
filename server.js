/**
 * StockAI Backend Server
 * Yahoo Finance API 프록시 (crumb 인증 자동 처리)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express    = require('express');
const cors       = require('cors');
const axios      = require('axios');
const path       = require('path');
const https      = require('https');
const http       = require('http');
const multer     = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_ROLE, OUTPUT_CONTRACT, buildUserPrompt } = require('./chartReaderPrompt');
const webpush = require('web-push');

// ── Web Push (VAPID) 초기화 ──────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        'mailto:rkd687@gmail.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Yahoo Finance 응답 헤더가 커서 기본 8KB 한도를 초과할 수 있음
// 옵션체인 API는 헤더가 특히 커서 128KB로 확장
const MAX_HEADER = 131072; // 128KB
const httpAgent  = new http.Agent({ maxHeaderSize: MAX_HEADER });
const httpsAgent = new https.Agent({ maxHeaderSize: MAX_HEADER });

const app  = express();
const PORT = process.env.PORT || 3000;

// Vercel/프록시 뒤에서 req.ip 가 클라이언트 IP 를 정확히 반영하도록 설정
// (1 = 첫 번째 hop 만 신뢰. Vercel은 자체적으로 x-forwarded-for 를 안전하게 세팅)
app.set('trust proxy', 1);

const allowedOrigins = [
    'http://localhost:3000',
    'https://stockss.vercel.app',
    /\.vercel\.app$/,
];
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true); // same-origin / curl
        if (allowedOrigins.some(o => o instanceof RegExp ? o.test(origin) : o === origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
app.use(express.json({ limit: '64kb' })); // ai-analysis 저장 남용 방지

// multer: 메모리 저장 (20MB 제한)
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
if (!process.env.FRED_API_KEY)    console.warn('⚠️  FRED_API_KEY 환경변수가 없습니다. 경제지표 기능이 비활성화됩니다.');

// [Fix-F] 싱글턴 캐싱 — 매 요청마다 인스턴스 재생성 방지
let _genAI = null;
function getGenAI() {
    if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    return _genAI;
}

let _anthropic = null;
function getAnthropic() {
    if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return _anthropic;
}

// AI 추천 종목 인메모리 캐시 (24시간 TTL — 무료 쿼터 절약)
let _aiRecCache = { data: null, ts: 0 };
const AI_REC_TTL = 24 * 60 * 60 * 1000;

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
const SYMBOL_RE      = /^[A-Z0-9.\-\^=]{1,20}$/i;
const VALID_RANGES   = new Set(['1d','5d','1mo','3mo','6mo','1y','2y','5y','10y','ytd','max']);
const VALID_INTERVALS= new Set(['1m','2m','5m','15m','30m','60m','90m','1h','1d','5d','1wk','1mo','3mo']);
const VALID_FILTERS  = new Set(['day_gainers','day_losers','most_actives']);
function validSymbol(s) { return s && SYMBOL_RE.test(s); }
function validRange(r)  { return !r || VALID_RANGES.has(r); }
function validInterval(i){ return !i || VALID_INTERVALS.has(i); }
function validFilter(f) { return f && VALID_FILTERS.has(f); }

// ─────────────────────────────────────────────
// 정적 파일 서빙 — 화이트리스트 방식 (__dirname 전체 노출 방지)
// .env·server.js·chartReaderPrompt.js·sql/· 같은 소스/시크릿 보호
// ─────────────────────────────────────────────
const STATIC_WHITELIST = new Set([
    '/', '/index.html',
    '/styles.css',
    '/sw.js',
    '/manifest.json',
    '/icon.svg',
    '/favicon.ico',
    '/robots.txt',
]);
const STATIC_EXT_OK = /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i;
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = req.path;
    if (p.startsWith('/api/') || p === '/health') return next();
    // 화이트리스트 또는 안전한 정적 확장자만 서빙 허용
    const allow = STATIC_WHITELIST.has(p) || STATIC_EXT_OK.test(p);
    if (!allow) return next(); // SPA fallback 으로 위임 (index.html 반환)
    // ..(path traversal) 방어 — express.static 도 내부적으로 처리하지만 이중 방어
    if (p.includes('..')) return res.status(400).end();
    const filePath = path.join(__dirname, p === '/' ? 'index.html' : p);
    if (!filePath.startsWith(__dirname)) return res.status(400).end();
    res.sendFile(filePath, (err) => { if (err) next(); });
});

// ─────────────────────────────────────────────
// Yahoo Finance Crumb 인증 (서버-서버 요청)
// ─────────────────────────────────────────────
let _crumb     = null;
let _cookies   = null;
let _crumbTime = 0;
const CRUMB_TTL = 60 * 60 * 1000; // 1시간마다 갱신
let _crumbPromise = null; // single-flight: 동시 갱신 요청 중복 방지

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getCrumb() {
    if (_crumb && Date.now() - _crumbTime < CRUMB_TTL) {
        return { crumb: _crumb, cookies: _cookies };
    }
    // 이미 갱신 중이면 같은 Promise를 재사용 → Yahoo Finance 중복 요청 방지
    if (_crumbPromise) return _crumbPromise;
    _crumbPromise = _fetchCrumb().finally(() => { _crumbPromise = null; });
    return _crumbPromise;
}

async function _fetchCrumb() {
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

// ─────────────────────────────────────────────
// 공통 IP Rate Limiter factory (Hybrid: 인메모리 L1 + Supabase L2)
//   ⚠️  IMPORTANT: 새 라우트에서 _rlXxx 를 사용하려면 이 섹션 이전에 선언되어야 함 (TDZ 방지)
//   ⚠️  새 rate limiter 추가 시 반드시 이 블록 안에서 const 로 선언할 것
//
//   Supabase 테이블 (한번만 생성):
//     create table rate_limits (
//       ip text not null, key text not null,
//       last_call_ts timestamptz not null default now(),
//       primary key (ip, key)
//     );
//     create index rate_limits_last_call_idx on rate_limits(last_call_ts);
//
//   동작:
//     1) L1 (in-memory) — 같은 인스턴스 내 최근 호출 있으면 즉시 429 (0ms)
//     2) L2 (Supabase)  — 다른 인스턴스에서 호출했는지 확인 (~50ms, 1회만)
//     3) 통과 시 L1+L2 모두 갱신 (L2 갱신은 비동기 — 응답 블로킹 X)
//   Supabase 미설정 시 graceful degrade → L1 only 동작.
// ─────────────────────────────────────────────

function makeIpRateLimiter(windowMs, message, key) {
    const localMap = new Map();
    const limiterKey = key || `rl_${windowMs}`;
    // 만료 항목 정기 정리 (메모리 누수 방지)
    setInterval(() => {
        const cutoff = Date.now() - windowMs;
        for (const [ip, ts] of localMap) { if (ts < cutoff) localMap.delete(ip); }
    }, Math.max(windowMs, 5 * 60 * 1000)).unref();

    return async function ipRateLimit(req, res, next) {
        // Vercel + trust proxy=1 환경에서 req.ip 는 클라이언트 IP 를 정확히 반영
        const ip = req.ip || 'unknown';
        const now = Date.now();

        // L1: 인메모리 (같은 인스턴스 내 즉시 차단)
        const localLast = localMap.get(ip) || 0;
        if (now - localLast < windowMs) {
            return res.status(429).json({ error: message || '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' });
        }

        // L2: Supabase (인스턴스 간 일관성) — 미설정/에러 시 무시하고 통과
        const supa = getSupabase();
        if (supa) {
            try {
                const cutoffIso = new Date(now - windowMs).toISOString();
                const { data } = await Promise.race([
                    supa.from('rate_limits')
                        .select('last_call_ts')
                        .eq('ip', ip).eq('key', limiterKey)
                        .gte('last_call_ts', cutoffIso)
                        .maybeSingle(),
                    new Promise(r => setTimeout(() => r({ data: null }), 800)) // Supabase 800ms 타임아웃 → 느려도 응답 막지 않음
                ]);
                if (data) {
                    // 다른 인스턴스에서 최근 호출 — 로컬에도 기록 후 차단
                    localMap.set(ip, new Date(data.last_call_ts).getTime());
                    return res.status(429).json({ error: message || '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' });
                }
            } catch (_) { /* Supabase 에러 → L1 only 로 graceful degrade */ }
        }

        // 통과: L1 갱신 + L2 비동기 갱신 (응답 블로킹 X)
        localMap.set(ip, now);
        if (supa) {
            supa.from('rate_limits').upsert(
                { ip, key: limiterKey, last_call_ts: new Date(now).toISOString() },
                { onConflict: 'ip,key' }
            ).then(() => {}, () => {});
        }
        next();
    };
}

// 엔드포인트별 rate limiter (IP당 N초 1회) — 라우트 등록 전 모두 초기화
// 3번째 인자는 Supabase rate_limits.key 컬럼 — 엔드포인트별 식별
const _rlVisionScan  = makeIpRateLimiter(30 * 1000, '차트 분석은 30초에 1회만 가능합니다.',   'vision-scan');
const _rlChartDraw   = makeIpRateLimiter(30 * 1000, '차트 그리기는 30초에 1회만 가능합니다.', 'chart-draw');
const _rlAiRecommend = makeIpRateLimiter(60 * 1000, 'AI 추천은 1분에 1회만 가능합니다.',      'ai-recommend');
const _rlHotStocks   = makeIpRateLimiter(60 * 1000, '핫스탁 분석은 1분에 1회만 가능합니다.', 'hot-stocks');

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
    // 개별 심볼 검증 + 최대 20개 제한
    const symList = symbols.split(',').map(s => s.trim()).filter(Boolean);
    if (symList.length === 0 || symList.length > 50) return res.status(400).json({ error: 'symbols: 1~50개 사이' });
    if (!symList.every(validSymbol)) return res.status(400).json({ error: 'invalid symbol in list' });
    const validatedSymbols = symList.join(',');
    try {
        const url  = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(validatedSymbols)}`;
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
 */
app.get('/api/options/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { date } = req.query;
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (date && !/^\d{1,13}$/.test(date)) return res.status(400).json({ error: 'invalid date' });
    
    try {
        let url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
        if (date) url += `?date=${date}`;
        
        const data = await yfRequest(url);
        
        // [Bug Fix] openInterest 파싱 보정
        // Yahoo Finance API는 openInterest를 숫자 또는 {raw, fmt} 객체로 줄 수 있음
        // 프론트엔드에서 일관되게 처리할 수 있도록 서버에서 숫자로 표준화하여 전달
        if (data?.optionChain?.result?.[0]?.options) {
            data.optionChain.result[0].options.forEach(opt => {
                const normalize = (arr) => {
                    if (!arr) return;
                    arr.forEach(o => {
                        // openInterest가 객체인 경우 raw 값을 사용, 아니면 숫자형 변환
                        if (o.openInterest && typeof o.openInterest === 'object' && 'raw' in o.openInterest) {
                            o.openInterest = o.openInterest.raw;
                        } else {
                            o.openInterest = Number(o.openInterest) || 0;
                        }
                        // volume도 같은 방식으로 보정
                        if (o.volume && typeof o.volume === 'object' && 'raw' in o.volume) {
                            o.volume = o.volume.raw;
                        } else {
                            o.volume = Number(o.volume) || 0;
                        }
                    });
                };
                normalize(opt.calls);
                normalize(opt.puts);
            });
        }
        
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
    const count = Math.min(parseInt(req.query.count, 10) || 100, 250);
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

// ── 종목 검색 (Yahoo Finance search API 프록시) ─────────────────────────
app.get('/api/search', async (req, res) => {
    // 길이 제한 + 위험 문자 제거 (Yahoo API 남용 방지)
    const q = String(req.query.q || '').trim().slice(0, 50).replace(/[^\w\s.\-가-힣]/g, '');
    if (!q) return res.json([]);
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=true&enableCb=false`;
        const data = await yfRequest(url);
        const quotes = (data?.quotes || [])
            .filter(qt => qt.quoteType === 'EQUITY' || qt.quoteType === 'ETF')
            .slice(0, 8)
            .map(qt => ({
                ticker:    qt.symbol,
                name:      qt.longname || qt.shortname || qt.symbol,
                exchange:  qt.exchDisp || qt.exchange || '',
                quoteType: qt.quoteType,
            }));
        res.json(quotes);
    } catch (err) {
        console.error('[search]', err.message);
        res.json([]);
    }
});

// ── 저가주 TOP (Yahoo Finance Custom Screener, price $0.01~$5) ─────────
const PENNY_CACHE_TTL = 60_000; // 60초
let _pennyCache = { ts: 0, data: null };

async function _postYfScreener(body) {
    // crumb 만료 시 1회 재시도 (yfRequest 패턴 미러링)
    const tryOnce = async () => {
        const { crumb, cookies } = await getCrumb();
        const url = `https://query1.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US&crumb=${encodeURIComponent(crumb)}`;
        return axios.post(url, body, {
            headers: {
                'User-Agent': UA,
                'Cookie': cookies,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            timeout: 12000,
            httpAgent,
            httpsAgent,
        });
    };
    try {
        return await tryOnce();
    } catch (err) {
        if (err.response?.status === 401 || err.response?.status === 403) {
            _crumb = null; // 강제 재발급
            return await tryOnce();
        }
        throw err;
    }
}

app.get('/api/penny-stocks', async (req, res) => {
    // 60초 메모리 캐시
    if (_pennyCache.data && Date.now() - _pennyCache.ts < PENNY_CACHE_TTL) {
        return res.json(_pennyCache.data);
    }
    try {
        const body = {
            offset: 0, size: 100,
            sortField: 'percentchange',
            sortType: 'desc',
            quoteType: 'EQUITY',
            query: {
                operator: 'and',
                operands: [
                    { operator: 'lt',  operands: ['intradayprice', 5] },
                    { operator: 'gte', operands: ['intradayprice', 0.01] },
                    { operator: 'gte', operands: ['dayvolume', 500000] },
                ],
            },
            userId: '', userIdType: 'guid',
        };
        const r = await _postYfScreener(body);
        const quotes = r.data?.finance?.result?.[0]?.quotes || [];
        const payload = { quotes };
        _pennyCache = { ts: Date.now(), data: payload };
        res.json(payload);
    } catch (err) {
        console.error('[penny-stocks]', err.message);
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
 * 배치 상승/하락 이유 (뉴스 1건 제목 요약, 한글 번역)
 * GET /api/news-reason?symbols=AAPL,NVDA,TSLA
 * 응답: { AAPL: "실적 서프라이즈", NVDA: "AI 수요 강세", ... }
 * - 서버 5분 캐시
 * - 최대 40개 심볼 / 요청
 */
// ─────────────────────────────────────────────
// LRU Map — 장수명 프로세스에서 메모리 누수 방지 (상한 초과 시 오래된 항목 순 evict)
// Map 은 삽입 순서를 유지하므로 .keys().next() = 가장 오래된 키
// ─────────────────────────────────────────────
class LRUMap extends Map {
    constructor(max = 5000) { super(); this.max = max; }
    set(k, v) {
        if (this.has(k)) this.delete(k); // 재삽입 → 최신 순위
        super.set(k, v);
        while (this.size > this.max) { this.delete(this.keys().next().value); }
        return this;
    }
    get(k) {
        if (!this.has(k)) return undefined;
        const v = super.get(k);
        // 접근 시 MRU 승격
        this.delete(k); super.set(k, v);
        return v;
    }
}

const _reasonCache = new LRUMap(5000); // symbol -> { text, ts } (메모리)
const REASON_TTL = 5 * 60 * 1000;           // 메모리 TTL (5분)
const REASON_SUPABASE_TTL = 6 * 60 * 60 * 1000; // DB TTL (6시간) — 유저 간 공유

// Supabase 에서 캐시 일괄 조회 (없으면 빈 Map)
async function _reasonLoadFromSupabase(symbols) {
    const sb = getSupabase();
    if (!sb || !symbols.length) return new Map();
    try {
        const { data, error } = await sb
            .from('news_reason')
            .select('symbol,text,updated_at')
            .in('symbol', symbols);
        if (error) return new Map();
        const now = Date.now();
        const m = new Map();
        (data || []).forEach(r => {
            const age = now - new Date(r.updated_at).getTime();
            // 25자 이하 = 구버전 22자 잘림 캐시 → TTL 무시하고 재fetch 유도
            const len = (r.text || '').length;
            const isTruncated = len > 0 && len <= 25;       // 구버전 22자 잘림
            const isLegacyRaw = len > 65;                   // 구버전 raw 뉴스 헤드라인(요약 전)
            if (age < REASON_SUPABASE_TTL && !isTruncated && !isLegacyRaw) m.set(r.symbol, r.text || '');
        });
        return m;
    } catch { return new Map(); }
}

// Supabase 업서트 (비동기 fire-and-forget)
function _reasonSaveToSupabase(rows) {
    const sb = getSupabase();
    if (!sb || !rows.length) return;
    // 비동기 — 응답 차단하지 않음
    sb.from('news_reason')
      .upsert(rows, { onConflict: 'symbol' })
      .then(r => { if (r.error) console.warn('[news-reason] upsert', r.error.message); })
      .catch(() => {});
}

// 휴리스틱 정리 — Gemini 실패 시 fallback. 트레일링 잡음/클라우드 절 제거 후 ~55자 내외로 압축
function _shortenReason(text) {
    if (!text) return '';
    let t = String(text).replace(/\s+/g,' ').trim();
    t = t.replace(/^[\[(]?[A-Z0-9.,\s]+[\])]?\s*[:–—-]\s*/,''); // "AAPL: " 같은 접두어
    // 대시 뒤 선정적 서브타이틀 제거 ("- '강제' 퇴사?" 등)
    t = t.replace(/\s*[-–—]\s*['"']?[^-–—]{1,60}['"']?\?*\s*$/, '').trim();
    // 트레일링 필러 제거
    t = t.replace(/\s*(다음과 같습니다|여부.+?|방법\.?|이유.+?)\.?\s*$/, '').trim();
    // 첫 문장만
    const sm = t.match(/^(.{8,}?[.!?])\s/);
    if (sm) t = sm[1].trim();
    if (t.length > 60) t = t.slice(0, 58).trim() + '…';
    return t;
}

// 개별 심볼의 원본 뉴스 제목(영→한 번역) + 퍼블리셔 반환 (캐시 없음 — 요약 후 캐시)
async function _fetchNewsTitle(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=1&enableFuzzyQuery=false`;
        const data = await yfRequest(url);
        const first = (data?.news || [])[0];
        if (!first?.title) return { symbol, title:'', publisher:'' };
        const ko = await translateToKo(first.title);
        return { symbol, title: ko || first.title, publisher: first.publisher || '' };
    } catch { return { symbol, title:'', publisher:'' }; }
}

// 배치 quote snapshot — 최대 40 심볼 한 번에
async function _fetchQuoteSnapshots(symbols) {
    const out = new Map();
    if (!symbols.length) return out;
    try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
        const data = await yfRequest(url);
        (data?.quoteResponse?.result || []).forEach(q => {
            out.set(q.symbol, {
                changePct: q.regularMarketChangePercent,
                price: q.regularMarketPrice,
                volumeRatio: q.averageDailyVolume3Month ? (q.regularMarketVolume || 0) / q.averageDailyVolume3Month : null,
            });
        });
    } catch {}
    return out;
}

// Gemini 배치 요약: [{symbol, title, changePct, volumeRatio}] → Map<symbol, summary>
// 프롬프트: 각 종목당 한 문장(20-40자) 한국어, 뉴스 원인 + 등락률 맥락. JSON 반환.
async function _summarizeReasonsBatch(items) {
    const fallback = new Map(items.map(x => [x.symbol, _shortenReason(x.title)]));
    if (!process.env.GEMINI_API_KEY || !items.length) return fallback;
    const valid = items.filter(x => x.title && x.title.length > 5);
    if (!valid.length) return fallback;
    const lines = valid.map(x => {
        const chg = Number.isFinite(x.changePct) ? `${x.changePct >= 0 ? '+' : ''}${x.changePct.toFixed(1)}%` : '-';
        const vol = x.volumeRatio && x.volumeRatio > 2 ? ` 거래량${x.volumeRatio.toFixed(1)}x` : '';
        return `- ${x.symbol} [${chg}${vol}]: ${x.title}`;
    }).join('\n');
    const prompt = `다음은 주식 종목별 최신 뉴스 제목과 등락률입니다. 각 종목에 대해 "한국어 한 문장(20~40자)"으로 상승/하락 사유를 요약하세요.
규칙:
- 뉴스 핵심 원인만. 선정적 서브타이틀·인용구·부제목은 제거.
- 등락률이 크면 "급등"/"급락"/"하락"/"상승" 같은 단어로 자연스럽게 포함.
- 티커/회사명 생략(이미 표시됨).
- 과장 금지. 사실 기반 요약.
- JSON 배열만 출력: [{"s":"SYMBOL","r":"요약"}]

입력:
${lines}

JSON:`;
    try {
        const genAI = getGenAI();
        if (!genAI) return fallback;
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', generationConfig: { temperature: 0.3 } });
        const resp = await model.generateContent(prompt);
        let txt = resp.response?.text?.() || '';
        txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        const arr = JSON.parse(txt);
        if (!Array.isArray(arr)) return fallback;
        const m = new Map(fallback); // fallback 우선 셋업
        arr.forEach(x => {
            if (!x || typeof x.s !== 'string' || typeof x.r !== 'string') return;
            let r = x.r.trim();
            if (r.length > 60) r = r.slice(0, 58).trim() + '…';
            if (r.length >= 8) m.set(x.s.toUpperCase(), r);
        });
        return m;
    } catch (e) {
        console.warn('[news-reason] Gemini summarize fail:', e?.message?.slice(0,100));
        return fallback;
    }
}

app.get('/api/news-reason', async (req, res) => {
    const raw = (req.query.symbols || '').toString();
    const syms = raw.split(',').map(s => s.trim().toUpperCase())
        .filter(s => /^[A-Z0-9.\-^=]{1,15}$/.test(s))
        .slice(0, 40);
    if (!syms.length) return res.json({});
    try {
        // 1차: 메모리 캐시에서 필터
        const now = Date.now();
        const out = {};
        const missMem = [];
        syms.forEach(s => {
            const c = _reasonCache.get(s);
            if (c && now - c.ts < REASON_TTL) { if (c.text) out[s] = c.text; }
            else missMem.push(s);
        });

        // 2차: Supabase 공유 캐시 — 메모리 미스 심볼만 조회 (첫 방문 유저에게 즉시 응답)
        if (missMem.length) {
            const sbHit = await _reasonLoadFromSupabase(missMem);
            sbHit.forEach((text, sym) => {
                _reasonCache.set(sym, { text, ts: now });
                if (text) out[sym] = text;
            });
        }

        // 3차: 남은 심볼 — 뉴스 제목 + 시세 스냅샷 병렬 fetch → Gemini 배치 요약
        const missAll = syms.filter(s => !(s in out) && !_reasonCache.has(s));
        if (missAll.length) {
            const [titleResults, quoteMap] = await Promise.all([
                Promise.all(missAll.map(_fetchNewsTitle)),
                _fetchQuoteSnapshots(missAll),
            ]);
            const items = titleResults.map(r => {
                const q = quoteMap.get(r.symbol) || {};
                return { symbol: r.symbol, title: r.title, changePct: q.changePct, volumeRatio: q.volumeRatio };
            });
            const summaryMap = await _summarizeReasonsBatch(items);
            const upsertRows = [];
            missAll.forEach(s => {
                const t = summaryMap.get(s) || '';
                _reasonCache.set(s, { text: t, ts: Date.now() });
                if (t) out[s] = t;
                upsertRows.push({ symbol: s, text: t, updated_at: new Date().toISOString() });
            });
            _reasonSaveToSupabase(upsertRows);
        }

        res.json(out);
    } catch (err) {
        console.error('[news-reason]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// /api/discover — 조건별 종목 발굴 (연속상승/연속하락/52H근접/거래량급증)
//   · universe: most_actives ∪ day_gainers ∪ day_losers (≈300)
//   · 배치 spark 차트로 5일 종가/거래량 확보
//   · 배치 quote 로 52주 고가·시총·회사명·평균거래량
//   · 4개 preset 한 번에 계산 후 LRU 10분 캐시
// ─────────────────────────────────────────────
const _discoverCache = new LRUMap(1);   // 'all' → { streak_up, streak_down, near_52h, vol_surge, ts }
const DISCOVER_TTL = 10 * 60 * 1000;

// Yahoo 섹터 영문 → 한글 매핑
const _SECTOR_KO = {
    'Consumer Cyclical': '소비재순환',
    'Technology': '기술',
    'Healthcare': '헬스케어',
    'Financial Services': '금융',
    'Industrials': '산업재',
    'Energy': '에너지',
    'Basic Materials': '원자재',
    'Communication Services': '통신',
    'Consumer Defensive': '필수소비재',
    'Real Estate': '리츠',
    'Utilities': '유틸리티',
};
const _toSectorKo = (s) => (s && _SECTOR_KO[s]) || (s || '');

// Yahoo Screener → { symbols:[], sectors:Map<symbol, koSector> }
async function _fetchScreenerSymbols(filter, count = 100) {
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=${filter}&count=${count}`;
        const data = await yfRequest(url);
        const quotes = (data?.finance?.result?.[0]?.quotes || []).filter(q => validSymbol(q.symbol));
        const sectors = new Map();
        quotes.forEach(q => {
            const ko = _toSectorKo(q.sector);
            if (ko) sectors.set(q.symbol.toUpperCase(), ko);
        });
        return { symbols: quotes.map(q => q.symbol), sectors };
    } catch (e) {
        console.warn(`[discover] screener ${filter} fail:`, e.message);
        return { symbols: [], sectors: new Map() };
    }
}

// universe 구성 (3개 스크리너 union, 중복제거) — symbols + sector map
async function _buildDiscoverUniverse() {
    const [a, b, c, d, e] = await Promise.all([
        _fetchScreenerSymbols('most_actives', 100),
        _fetchScreenerSymbols('day_gainers', 100),
        _fetchScreenerSymbols('day_losers', 100),
        _fetchScreenerSymbols('undervalued_growth_stocks', 100).catch(() => ({ symbols: [], sectors: new Map() })),
        _fetchScreenerSymbols('growth_technology_stocks',  100).catch(() => ({ symbols: [], sectors: new Map() })),
    ]);
    const set = new Set();
    [...a.symbols, ...b.symbols, ...c.symbols, ...d.symbols, ...e.symbols].forEach(s => set.add(s.toUpperCase()));
    const sectors = new Map();
    [a.sectors, b.sectors, c.sectors, d.sectors, e.sectors].forEach(m => m.forEach((v,k) => { if (!sectors.has(k)) sectors.set(k, v); }));
    return { symbols: [...set], sectors };
}

// Spark 배치 차트 (range=3mo interval=1d) — 청크 50개 단위
async function _fetchSparkBatch(symbols) {
    const out = new Map();  // symbol → { close:[], volume:[] }
    const CHUNK = 40;
    for (let i = 0; i < symbols.length; i += CHUNK) {
        const chunk = symbols.slice(i, i + CHUNK);
        try {
            // v8/finance/spark: crumb 불필요, 불필요한 파라미터 제거
            const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=3mo&interval=1d`;
            const res = await axios.get(url, {
                headers: { 'User-Agent': UA, 'Accept': 'application/json' },
                timeout: 15000,
                httpAgent,
                httpsAgent,
            });
            const data = res.data;
            // v8/spark 응답: { spark: { result: [ { symbol, response: [ { timestamp, indicators:{ quote:[{close, volume}] } } ] } ] } }
            (data?.spark?.result || []).forEach(r => {
                const sym = r.symbol;
                const resp = (r.response || [])[0];
                const ts = resp?.timestamp || [];
                const q = resp?.indicators?.quote?.[0] || {};
                out.set(sym, {
                    close: q.close || [],
                    volume: q.volume || [],
                });
            });
        } catch (e) {
            // v8 실패 시 v7 crumb 방식 재시도
            try {
                const url2 = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=3mo&interval=1d`;
                const data2 = await yfRequest(url2);
                (data2?.spark?.result || []).forEach(r => {
                    const sym = r.symbol;
                    const resp = (r.response || [])[0];
                    const q = resp?.indicators?.quote?.[0] || {};
                    out.set(sym, { close: q.close || [], volume: q.volume || [] });
                });
            } catch (e2) {
                console.warn('[discover] spark chunk fail:', e2?.response?.status || e2?.code || e2?.message?.slice(0,80));
            }
        }
    }
    return out;
}

// 확장 quote (52주 고가·시총·회사명·평균거래량 포함)
async function _fetchQuoteSnapshotsFull(symbols) {
    const out = new Map();
    const CHUNK = 40;
    for (let i = 0; i < symbols.length; i += CHUNK) {
        const chunk = symbols.slice(i, i + CHUNK);
        try {
            // ⚠️ fields= 파라미터 사용 안 함 — Yahoo 가 일부 필드 (averageAnalystRating, targetMeanPrice 등)를
            //     명시적 화이트리스트에서는 인식 못 하고 silent drop 함. 기본 응답에는 포함되므로 그대로 받는다.
            const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`;
            const data = await yfRequest(url);
            (data?.quoteResponse?.result || []).forEach(q => {
                out.set(q.symbol, {
                    name: q.shortName || q.longName || q.symbol,
                    price: q.regularMarketPrice,
                    changePct: q.regularMarketChangePercent,
                    volume: q.regularMarketVolume,
                    avgVol: q.averageDailyVolume3Month || q.averageDailyVolume10Day || null,
                    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
                    fiftyTwoWeekLow: q.fiftyTwoWeekLow,
                    fiftyDayAverage: q.fiftyDayAverage,
                    twoHundredDayAverage: q.twoHundredDayAverage,
                    marketCap: q.marketCap,
                    currency: q.currency || 'USD',
                    sector: q.sector || '',
                    industry: q.industry || '',
                    trailingPE: q.trailingPE ?? null,
                    forwardPE:  q.forwardPE  ?? null,
                    priceToBook: q.priceToBook ?? null,
                    epsTrailing: q.epsTrailingTwelveMonths ?? null,
                    epsForward:  q.epsForward  ?? null,
                    dayHigh:   q.regularMarketDayHigh      ?? null,
                    dayLow:    q.regularMarketDayLow       ?? null,
                    prevClose: q.regularMarketPreviousClose ?? null,
                    targetPrice: q.targetMeanPrice         ?? null,
                    // averageAnalystRating: "1.7 - Buy" 형식 → 앞 숫자(1.0~5.0)만 추출
                    analystRating: (() => {
                        const s = q.averageAnalystRating;
                        if (!s || typeof s !== 'string') return null;
                        const v = parseFloat(s.split(' ')[0]);
                        return (Number.isFinite(v) && v > 0) ? v : null;
                    })(),
                });
            });
        } catch (e) { /* 청크 실패 무시 */ }
    }
    return out;
}

// ─────────────────────────────────────────────
// 기관 매집 카운트 — Supabase guru_position 에서 최근 2분기 NEW/ADD 액션 ticker 별 집계
// ─────────────────────────────────────────────
const _instAccumCache = { data: null, ts: 0 };
const INST_ACCUM_TTL = 24 * 60 * 60 * 1000; // 24시간 (13F 분기 단위)
async function _fetchInstitutionalAccumulation(symbols) {
    const now = Date.now();
    if (_instAccumCache.data && now - _instAccumCache.ts < INST_ACCUM_TTL) {
        return _instAccumCache.data;
    }
    const out = new Map();
    const sb = getSupabase();
    if (!sb || !symbols.length) { _instAccumCache.data = out; _instAccumCache.ts = now; return out; }
    try {
        // 최근 2분기 quarter 식별
        const { data: qrs } = await sb
            .from('guru_quarter')
            .select('quarter')
            .order('quarter', { ascending: false })
            .limit(50);
        const uniqQ = Array.from(new Set((qrs || []).map(r => r.quarter))).slice(0, 2);
        if (!uniqQ.length) { _instAccumCache.data = out; _instAccumCache.ts = now; return out; }

        // ticker 청크 단위로 NEW/ADD 액션 조회 → ticker 별 row count 집계
        const upper = symbols.map(s => String(s || '').toUpperCase()).filter(Boolean);
        const CHUNK = 200;
        for (let i = 0; i < upper.length; i += CHUNK) {
            const chunk = upper.slice(i, i + CHUNK);
            const { data, error } = await sb
                .from('guru_position')
                .select('ticker')
                .in('ticker', chunk)
                .in('quarter', uniqQ)
                .in('action', ['NEW', 'ADD']);
            if (error) continue;
            (data || []).forEach(r => {
                if (!r.ticker) return;
                const t = r.ticker.toUpperCase();
                out.set(t, (out.get(t) || 0) + 1);
            });
        }
    } catch (e) {
        console.warn('[discover] inst accum fail:', e.message);
    }
    _instAccumCache.data = out; _instAccumCache.ts = now;
    return out;
}

// ─────────────────────────────────────────────
// 화제성 플래그 — Stocktwits trending + news_reason 최근 3일 union
// ─────────────────────────────────────────────
const _buzzCache = { data: null, ts: 0 };
const BUZZ_TTL = 30 * 60 * 1000; // 30분
async function _fetchBuzzFlags(symbols) {
    const now = Date.now();
    if (_buzzCache.data && now - _buzzCache.ts < BUZZ_TTL) {
        return _buzzCache.data;
    }
    const out = new Set();
    // 1) Stocktwits trending
    try {
        const r = await fetch(
            'https://api.stocktwits.com/api/2/streams/trending.json?limit=30',
            { headers: { 'User-Agent': 'StockAI/1.0' } }
        );
        if (r.ok) {
            const d = await r.json();
            (d?.symbols || []).forEach(s => { if (s.symbol) out.add(String(s.symbol).toUpperCase()); });
        }
    } catch (e) { /* 무시 */ }

    // 2) news_reason 최근 3일 업데이트된 symbol
    const sb = getSupabase();
    if (sb && symbols.length) {
        try {
            const cutoff = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
            const upper = symbols.map(s => String(s || '').toUpperCase()).filter(Boolean);
            const CHUNK = 200;
            for (let i = 0; i < upper.length; i += CHUNK) {
                const chunk = upper.slice(i, i + CHUNK);
                const { data, error } = await sb
                    .from('news_reason')
                    .select('symbol,updated_at')
                    .in('symbol', chunk)
                    .gte('updated_at', cutoff);
                if (error) continue;
                (data || []).forEach(r => { if (r.symbol) out.add(String(r.symbol).toUpperCase()); });
            }
        } catch (e) { /* 무시 */ }
    }
    _buzzCache.data = out; _buzzCache.ts = now;
    return out;
}

// 7개 preset 평가
function _evaluateDiscoverPresets(sparkMap, quoteMap, sectorMap = new Map(), instMap = new Map(), buzzSet = new Set()) {
    const all = { streak_up: [], streak_down: [], near_52h: [], vol_surge: [], undervalued: [], growth: [], smart_money_growth: [] };
    const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    for (const [sym, q] of quoteMap.entries()) {
        if (!q || q.price == null) continue;
        const sp = sparkMap.get(sym);
        const closes = (sp?.close || []).filter(v => v != null);
        const volumes = (sp?.volume || []).filter(v => v != null);
        const category = sectorMap.get(sym) || _toSectorKo(q.sector) || '';

        // 거래량 배수 (인사이트 접미 용)
        const vol20avg = volumes.length >= 20 ? volumes.slice(-20).reduce((a,b)=>a+b,0) / 20 : q.avgVol;
        const volMult = (vol20avg && q.volume) ? q.volume / vol20avg : null;

        const base = {
            symbol: sym,
            name: q.name,
            price: q.price,
            changePct: q.changePct,
            marketCap: q.marketCap,
            volume: q.volume,
            currency: q.currency,
            category,
            dayHigh:    q.dayHigh,
            dayLow:     q.dayLow,
            prevClose:  q.prevClose,
            targetPrice: q.targetPrice,
            analystRating: q.analystRating,
        };

        // 1) streak_up / streak_down
        //    ① Spark 성공: 최근 종가 연속 방향 → 3일 이상
        //    ② Spark 실패(rate limit 등): quote 기반 근사 — 50MA + 당일 변동률
        if (closes.length >= 4) {
            // Spark 데이터 있음: 정확한 연속 판정
            let upDays = 0, downDays = 0;
            for (let i = closes.length - 1; i >= 1; i--) {
                if (closes[i] > closes[i - 1]) { if (downDays === 0) upDays++; else break; }
                else if (closes[i] < closes[i - 1]) { if (upDays === 0) downDays++; else break; }
                else break;
            }
            if (upDays >= 3) {
                const startIdx = closes.length - 1 - upDays;
                const cum = ((closes[closes.length - 1] - closes[startIdx]) / closes[startIdx]) * 100;
                if (Number.isFinite(cum)) {
                    const volTail = (volMult && volMult >= 1.5) ? ' · 거래량 ↑' : '';
                    all.streak_up.push({ ...base,
                        insight: `${upDays}일 연속 상승 · ${upDays}D ${fmtPct(cum)}${volTail}`,
                        keyMetric: { label: `${upDays}일 누적`, value: fmtPct(cum), dir: 'up', num: upDays * 100 + cum }});
                }
            }
            if (downDays >= 3) {
                const startIdx = closes.length - 1 - downDays;
                const cum = ((closes[closes.length - 1] - closes[startIdx]) / closes[startIdx]) * 100;
                if (Number.isFinite(cum)) {
                    all.streak_down.push({ ...base,
                        insight: `${downDays}일 연속 하락 · ${downDays}D ${fmtPct(cum)}`,
                        keyMetric: { label: `${downDays}일 누적`, value: `${cum.toFixed(2)}%`, dir: 'down', num: downDays * 100 + Math.abs(cum) }});
                }
            }
        } else {
            // Spark 없음 fallback: quote의 50MA + 당일 변동률로 상승/하락 모멘텀 판단
            const ma50 = q.fiftyDayAverage;
            const chg = q.changePct || 0;
            const price = q.price;
            // 상승 모멘텀: 오늘 1% 이상 상승 AND 50MA 위 (단기 상승 추세)
            if (price != null && ma50 && chg >= 1 && price > ma50) {
                all.streak_up.push({ ...base,
                    insight: `당일 ${fmtPct(chg)} · 50MA 상단 단기 상승 추세`,
                    keyMetric: { label: '당일 상승', value: fmtPct(chg), dir: 'up', num: chg }});
            }
            // 하락 모멘텀: 오늘 1% 이상 하락 AND 50MA 아래
            if (price != null && ma50 && chg <= -1 && price < ma50) {
                all.streak_down.push({ ...base,
                    insight: `당일 ${chg.toFixed(2)}% · 50MA 하단 매도 압력`,
                    keyMetric: { label: '당일 하락', value: `${chg.toFixed(2)}%`, dir: 'down', num: Math.abs(chg) }});
            }
        }

        // 2) near_52h — 현재가 ≥ 52wHigh × 0.95
        if (q.fiftyTwoWeekHigh && q.price >= q.fiftyTwoWeekHigh * 0.95) {
            const gap = ((q.price - q.fiftyTwoWeekHigh) / q.fiftyTwoWeekHigh) * 100;
            all.near_52h.push({ ...base,
                insight: `52주 고점 ${gap.toFixed(2)}% · 돌파 시도 구간`,
                keyMetric: { label: '52H 대비', value: fmtPct(gap), dir: gap >= 0 ? 'up' : 'down', num: gap }});
        }

        // 3) vol_surge — 당일 거래량 ≥ 20일 평균 × 2
        if (vol20avg && q.volume && q.volume >= vol20avg * 2) {
            const mult = q.volume / vol20avg;
            const chg = q.changePct || 0;
            all.vol_surge.push({ ...base,
                insight: `평균 대비 ×${mult.toFixed(1)} 거래 급증 · ${fmtPct(chg)}`,
                keyMetric: { label: '평균대비', value: `×${mult.toFixed(1)}`, dir: 'up', num: mult }});
        }

        // 4) undervalued — PER 0 < x ≤ 20, PBR 0 < x ≤ 4, 가격 $5 이상
        const pe  = q.trailingPE  ?? q.forwardPE;
        const pb  = q.priceToBook;
        if (pe != null && pe > 0 && pe <= 20 && pb != null && pb > 0 && pb <= 4 && q.price >= 5) {
            const peLabel = q.trailingPE ? 'PER(TTM)' : 'PER(Fwd)';
            all.undervalued.push({ ...base,
                insight: `${peLabel} ${pe.toFixed(1)} · PBR ${pb.toFixed(1)} · 저평가 구간`,
                keyMetric: { label: 'PER', value: pe.toFixed(1), dir: 'up', num: pe }});
        }

        // 5) growth — EPS 성장 기대 (forward > trailing, 성장률 ≥ 10%)
        const epsT = q.epsTrailing;
        const epsF = q.epsForward;
        let epsGrowth = null;
        if (epsT != null && epsF != null && epsT > 0 && epsF > epsT) {
            epsGrowth = ((epsF - epsT) / epsT) * 100;
            if (epsGrowth >= 10 && q.price >= 5) {
                all.growth.push({ ...base,
                    insight: `EPS 성장 ${fmtPct(epsGrowth)} · 실적 개선 기대`,
                    keyMetric: { label: 'EPS 성장', value: fmtPct(epsGrowth), dir: 'up', num: epsGrowth }});
            }
        }

        // 6) smart_money_growth — 저평가 ∩ 성장 (필수) + 기관 매집/화제성 (가산점)
        //    score = (20-PE)*2 + 성장률*2 + 기관 NEW/ADD 카운트*8 + buzz*15
        const baseMet = (pe != null && pe > 0 && pe <= 20)
                     && (pb != null && pb > 0 && pb <= 4)
                     && (epsGrowth != null && epsGrowth >= 10)
                     && (q.price >= 5);
        if (baseMet) {
            const instCount = instMap.get(sym) || 0;
            const isBuzz   = buzzSet.has(sym);
            // 성장률 outlier(수천% 등)가 점수를 독식하지 않도록 100% 로 cap
            const score = (20 - pe) * 2
                        + Math.min(epsGrowth, 100) * 2
                        + instCount * 8
                        + (isBuzz ? 15 : 0);
            // 상세 breakdown 은 insight 영역(이름 아래 한 줄) 에 표시
            const insightParts = [`PER ${pe.toFixed(1)}`, `성장 ${fmtPct(epsGrowth)}`];
            if (instCount > 0) insightParts.push(`기관 ${instCount}`);
            if (isBuzz)        insightParts.push('🔥 화제');
            // keyMetric 셀은 콤팩트하게 — 점수만 표시
            const valStr = score.toFixed(0) + (isBuzz ? ' 🔥' : '');
            all.smart_money_growth.push({ ...base,
                insight: insightParts.join(' · '),
                keyMetric: { label: '스코어', value: valStr, dir: 'up', num: score }});
        }
    }
    // 정렬
    all.streak_up.sort((a,b) => b.keyMetric.num - a.keyMetric.num);
    all.streak_down.sort((a,b) => a.keyMetric.num - b.keyMetric.num);
    all.near_52h.sort((a,b) => b.keyMetric.num - a.keyMetric.num);
    all.vol_surge.sort((a,b) => b.keyMetric.num - a.keyMetric.num);
    all.undervalued.sort((a,b) => a.keyMetric.num - b.keyMetric.num); // PER 낮을수록 상위
    all.growth.sort((a,b) => b.keyMetric.num - a.keyMetric.num);      // EPS 성장률 높을수록 상위
    all.smart_money_growth.sort((a,b) => b.keyMetric.num - a.keyMetric.num); // 스코어 높을수록 상위
    // 상위 컷 (smart_money_growth 는 30개)
    ['streak_up','streak_down','near_52h','vol_surge','undervalued','growth'].forEach(k => { all[k] = all[k].slice(0, 50); });
    all.smart_money_growth = all.smart_money_growth.slice(0, 30);
    return all;
}

const VALID_DISCOVER_PRESETS = new Set(['streak_up','streak_down','near_52h','vol_surge','undervalued','growth','smart_money_growth']);

app.get('/api/discover', async (req, res) => {
    const preset = String(req.query.preset || 'streak_up');
    if (!VALID_DISCOVER_PRESETS.has(preset)) {
        return res.status(400).json({ error: 'invalid preset' });
    }
    try {
        const now = Date.now();
        const cached = _discoverCache.get('all');
        let all = (cached && now - cached.ts < DISCOVER_TTL) ? cached.data : null;
        if (!all) {
            const { symbols, sectors } = await _buildDiscoverUniverse();
            if (!symbols.length) return res.json({ preset, items: [], ts: now });
            const [sparkMap, quoteMap, instMap, buzzSet] = await Promise.all([
                _fetchSparkBatch(symbols),
                _fetchQuoteSnapshotsFull(symbols),
                _fetchInstitutionalAccumulation(symbols),
                _fetchBuzzFlags(symbols),
            ]);
            all = _evaluateDiscoverPresets(sparkMap, quoteMap, sectors, instMap, buzzSet);
            _discoverCache.set('all', { data: all, ts: now });
        }
        res.json({ preset, items: all[preset] || [], ts: now });
    } catch (err) {
        console.error('[discover]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 종목 뉴스 (제목 한글 번역 포함)
 * GET /api/news/:symbol?limit=12
 */
app.get('/api/news/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 12, 100);
    try {
        const fetchCount = Math.min(limit * 2, 25); // 필터링 여유분 확보
        const url  = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${fetchCount}&enableFuzzyQuery=false`;
        const data = await yfRequest(url);
        const raw  = data?.news || [];
        // relatedTickers 기준으로 해당 종목 관련 기사만 필터링
        const symBase = symbol.replace(/\.(KS|KQ|T|L|PA|AS|DE|SW|HK)$/i, '').toUpperCase();
        const relevant = raw.filter(n =>
            !n.relatedTickers?.length ||
            n.relatedTickers.some(t => {
                const tu = t.toUpperCase();
                return tu === symBase || tu === symbol.toUpperCase();
            })
        );
        const mapped = relevant.slice(0, limit).map(n => {
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
 * YouTube 관련 영상 검색
 * GET /api/youtube/:symbol?company=NVIDIA+Corp&limit=8
 */
const _ytServerCache = new LRUMap(2000); // key -> { ts, data }
const YT_SERVER_TTL  = 6 * 60 * 60 * 1000; // 6h

app.get('/api/youtube/:symbol', async (req, res) => {
    const { symbol } = req.params;
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });

    const company = (req.query.company || '').slice(0, 100);
    const limit   = Math.min(parseInt(req.query.limit, 10) || 8, 20);

    const ckey = `${symbol}_${limit}`;
    const _ytHit = _ytServerCache.get(ckey);
    if (_ytHit && Date.now() - _ytHit.ts < YT_SERVER_TTL) {
        return res.json(_ytHit.data);
    }

    if (!process.env.YOUTUBE_API_KEY) {
        console.error('[youtube] ❌ YOUTUBE_API_KEY 환경변수가 없습니다. Vercel 환경변수를 확인하세요.');
        return res.status(503).json({ error: 'YouTube API key not configured', hint: 'Set YOUTUBE_API_KEY in Vercel environment variables and redeploy' });
    }

    // KR 종목은 한국어 키워드, US는 영어 키워드로 검색
    const isKR = symbol.includes('.KS') || symbol.includes('.KQ');
    const baseSym = symbol.replace(/\.(KS|KQ)$/i, '');
    const q = isKR
        ? `${company || baseSym} 주가 전망 주식 분석`
        : `${company || baseSym} ${baseSym} stock analysis earnings`;

    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=${limit}&order=relevance&key=${process.env.YOUTUBE_API_KEY}`;
        const { data } = await axios.get(url, { timeout: 10000 });

        const videos = (data.items || []).map(item => ({
            videoId:     item.id.videoId,
            title:       item.snippet.title,
            channel:     item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            thumbnail:   item.snippet.thumbnails?.medium?.url
                      || item.snippet.thumbnails?.default?.url
                      || null,
        }));

        const result = { symbol, count: videos.length, videos };
        _ytServerCache.set(ckey, { ts: Date.now(), data: result });
        res.json(result);
    } catch (err) {
        const ytStatus  = err.response?.status;
        const ytData    = err.response?.data;
        console.error(`[youtube] ❌ ${symbol} — HTTP ${ytStatus || 'N/A'}:`, ytData || err.message);
        if (ytStatus === 403) {
            console.error('[youtube] 403 원인: API 키 제한(도메인/IP) 또는 할당량 초과. Google Cloud Console 확인 필요.');
        }
        res.status(500).json({
            error:  err.message,
            ytStatus,
            ytError: ytData?.error?.message || null,
        });
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
 * 소셜 피드 — Reddit r/wallstreetbets + r/stocks 종목별 검색
 * GET /api/stocktwits/:symbol  (라우트 이름 호환 유지)
 *
 * 배경: StockTwits 공식 API는 Cloudflare 봇 차단으로 서버에서 직접 호출 불가.
 *       동일 슬롯에 Reddit 미국 주식 커뮤니티 검색 결과를 노출.
 *       응답 shape 은 기존 StockTwits messages 형식과 호환 (클라이언트 그대로 작동).
 */
const _redditCache = new LRUMap(50);
const REDDIT_TTL = 5 * 60 * 1000; // 5분

async function _fetchRedditStockPosts(symbol) {
    // wallstreetbets + stocks 두 sub 동시 검색
    const subs = ['wallstreetbets', 'stocks'];
    const reqs = subs.map(sub =>
        fetch(`https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(symbol)}&restrict_sr=1&sort=new&t=month&limit=15`, {
            headers: { 'User-Agent': 'StockAI/1.0 (by /u/stockai-bot)' },
        }).then(r => r.ok ? r.json() : null).catch(() => null)
    );
    const results = await Promise.all(reqs);
    const all = [];
    results.forEach(d => {
        const children = d?.data?.children || [];
        children.forEach(c => all.push(c.data));
    });
    // 최신순 정렬, 중복 제거
    const seen = new Set();
    const unique = [];
    all.sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0)).forEach(p => {
        if (!seen.has(p.id)) { seen.add(p.id); unique.push(p); }
    });
    // StockTwits messages 형식으로 매핑
    return unique.slice(0, 20).map(p => {
        const title    = String(p.title || '').trim();
        const selftext = String(p.selftext || '').trim();
        const body     = selftext ? `${title}\n\n${selftext}` : title;
        return {
            id:         p.id,
            body,
            created_at: new Date((p.created_utc || 0) * 1000).toISOString(),
            user: {
                username:   p.author || 'reddit',
                avatar_url: '', // Reddit search API에는 사용자 아바타 없음
            },
            likes:     { total: p.score | 0 },
            sentiment: null, // Reddit엔 명시적 sentiment 없음
            // 추가 메타 (클라이언트에서 link 처리 시 사용 가능)
            permalink: p.permalink ? `https://www.reddit.com${p.permalink}` : '',
            subreddit: p.subreddit || '',
            num_comments: p.num_comments | 0,
        };
    });
}

app.get('/api/stocktwits/:symbol', async (req, res) => {
    const { symbol } = req.params;
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    const sym = String(symbol).toUpperCase();
    // KR 종목은 Reddit에 거의 없으므로 빈 결과
    if (/^\d{6}/.test(sym)) return res.json({ messages: [], cached: false });

    const now = Date.now();
    const cached = _redditCache.get(sym);
    if (cached && now - cached.ts < REDDIT_TTL) {
        return res.json({ messages: cached.messages, cached: true, ts: cached.ts });
    }
    try {
        const messages = await _fetchRedditStockPosts(sym);
        _redditCache.set(sym, { messages, ts: now });
        res.json({ messages, cached: false, ts: now });
    } catch (err) {
        console.error('[reddit-stock]', sym, err.message);
        res.status(502).json({ error: 'Reddit 데이터를 가져올 수 없어요' });
    }
});

/**
 * 소셜 피드 — 팍스넷 종목토론 (KR 종목 전용, 네이버 외 두 번째 KR 소스)
 * GET /api/paxnet-board/:symbol  (6자리 코드 + 옵션 .KS/.KQ)
 */
const _paxnetBoardCache = new LRUMap(50);
const PAXNET_BOARD_TTL = 10 * 60 * 1000;

async function _fetchPaxnetBoardHtml(code) {
    const url = `https://www.paxnet.co.kr/tbbs/list?tbbsType=L&id=${code}`;
    const r = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StockAI/1.0',
            'Accept-Language': 'ko-KR,ko;q=0.9',
        },
        redirect: 'follow',
    });
    if (!r.ok) throw new Error(`paxnet ${r.status}`);
    return await r.text();
}

function _parsePaxnetDate(s) {
    // "Tue Apr 28 17:22:52 KST 2026" → "2026.04.28 17:22"
    if (!s) return '';
    const t = Date.parse(String(s).replace(' KST ', ' GMT+0900 '));
    if (!Number.isFinite(t)) return s;
    const d = new Date(t);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function _parsePaxnetHtml(html, code) {
    // 게시글 ID 모두 수집 (중복 제거 + 등장 순서 유지)
    const ids = [];
    const seen = new Set();
    const idRegex = /bbsWrtView\((\d+)\)/g;
    let m;
    while ((m = idRegex.exec(html)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
    }

    const posts = [];
    for (let i = 0; i < ids.length && posts.length < 20; i++) {
        const pid = ids[i];
        const next = ids[i + 1];
        // 해당 게시글 블록 추출 (data-seq 또는 tit_ID 부터 다음 게시글까지)
        const startIdx = html.indexOf(`data-seq="${pid}"`);
        const endIdx   = next ? html.indexOf(`data-seq="${next}"`, startIdx + 1) : startIdx + 4000;
        if (startIdx < 0) continue;
        const block = html.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 4000);

        // 제목 — bbsWrtView(POSTID)가 들어있는 <a> 텍스트
        const titleMatch = block.match(new RegExp(`bbsWrtView\\(${pid}\\)[^>]*>([^<]+)`));
        if (!titleMatch) continue;
        const title = _decodeNaverHtmlEntities(titleMatch[1]).trim();

        // 작성자 — viewProfile('USERID')에서 ID, 그 뒤 <img alt>다음 텍스트가 닉네임
        const userIdMatch = block.match(/viewProfile\('([^']+)'\)/);
        const userId      = userIdMatch ? userIdMatch[1] : '';
        // 닉네임: <img ... alt>NICK</a> 패턴
        const nickMatch   = block.match(/<img[^>]*alt[^>]*>([^<]{1,30})<\/a>/);
        const author      = nickMatch ? _decodeNaverHtmlEntities(nickMatch[1]).trim() : (userId || '익명');

        // 조회 / 추천
        const hitsMatch = block.match(new RegExp(`hitsNum_${pid}"[^>]*>(?:<span>[^<]+<\\/span>)?\\s*(\\d+)`));
        const recMatch  = block.match(new RegExp(`recmNum_${pid}"[^>]*>(?:<span>[^<]+<\\/span>)?\\s*(-?\\d+)`));
        const views      = hitsMatch ? Number(hitsMatch[1]) : 0;
        const recommends = recMatch  ? Number(recMatch[1])  : 0;

        // 댓글 수
        const cmtMatch = block.match(new RegExp(`comment-num_${pid}"[^>]*>([^<]+)<`));
        const comments = cmtMatch ? Number(cmtMatch[1].trim()) || 0 : 0;

        // 날짜
        const dateMatch = block.match(/data-date-format="([^"]+)"/);
        const date = _parsePaxnetDate(dateMatch ? dateMatch[1] : '');

        posts.push({
            title,
            author,
            date,
            views,
            recommends,
            comments,
            link: `https://www.paxnet.co.kr/tbbs/view?tbbsType=L&id=${code}&seq=${pid}`,
        });
    }
    return posts;
}

app.get('/api/paxnet-board/:symbol', async (req, res) => {
    const sym = String(req.params.symbol || '').toUpperCase();
    const m = sym.match(/^(\d{6})(\.K[SQ])?$/);
    if (!m) return res.status(400).json({ error: 'KR 심볼만 지원 (예: 005930 또는 005930.KS)' });
    const code = m[1];
    const now = Date.now();

    const cached = _paxnetBoardCache.get(code);
    if (cached && now - cached.ts < PAXNET_BOARD_TTL) {
        return res.json({ posts: cached.posts, cached: true, ts: cached.ts });
    }
    try {
        const html = await _fetchPaxnetBoardHtml(code);
        const posts = _parsePaxnetHtml(html, code);
        _paxnetBoardCache.set(code, { posts, ts: now });
        res.json({ posts, cached: false, ts: now });
    } catch (err) {
        console.error('[paxnet-board]', code, err.message);
        res.status(502).json({ error: '팍스넷 데이터를 가져올 수 없어요' });
    }
});

/**
 * 소셜 피드 — Apewisdom 종목별 멘션 통계
 *   Reddit / 4chan / StockTwits 멘션을 집계하는 무료 API
 *   GET /api/apewisdom/:symbol  →  { ticker, mentions, rank, mentions_24h_ago, rank_24h_ago, upvotes, name } | null
 *   Apewisdom 의 page 1 (top ~100 ticker) 만 캐시. 미포함 ticker 는 null 반환.
 */
const _apewisdomCache = { data: null, ts: 0 };
const APEWISDOM_TTL = 15 * 60 * 1000; // 15분

async function _fetchApewisdomTop() {
    const now = Date.now();
    if (_apewisdomCache.data && now - _apewisdomCache.ts < APEWISDOM_TTL) {
        return _apewisdomCache.data;
    }
    const map = new Map();
    try {
        // page 1 + 2 (top ~200) — 그 이하 ticker 는 멘션이 미미해 굳이 보여줄 가치 적음
        for (const page of [1, 2]) {
            const r = await fetch(`https://apewisdom.io/api/v1.0/filter/all-stocks/page/${page}`, {
                headers: { 'User-Agent': 'StockAI/1.0' },
            });
            if (!r.ok) continue;
            const d = await r.json();
            (d?.results || []).forEach(item => {
                if (item?.ticker) map.set(String(item.ticker).toUpperCase(), item);
            });
        }
    } catch (e) {
        console.warn('[apewisdom] fetch fail:', e.message);
    }
    // 데이터가 실제로 있을 때만 캐시 갱신 — fetch 실패 시 기존 캐시 유지
    if (map.size > 0) {
        _apewisdomCache.data = map;
        _apewisdomCache.ts = now;
        return map;
    }
    // 실패 케이스: 기존 캐시 반환 (없으면 빈 Map)
    return _apewisdomCache.data || map;
}

app.get('/api/apewisdom/:symbol', async (req, res) => {
    const sym = String(req.params.symbol || '').toUpperCase();
    if (!validSymbol(sym)) return res.status(400).json({ error: 'invalid symbol' });
    try {
        const map = await _fetchApewisdomTop();
        const item = map.get(sym) || null;
        res.json({ symbol: sym, item, ts: _apewisdomCache.ts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 소셜 피드 — 네이버 금융 토론실 (KR 종목 전용)
 * GET /api/naver-board/:symbol
 *   symbol: 6자리 코드 (005930) 또는 .KS/.KQ 접미사 포함
 *   응답: { posts: [{ title, author, link, date, views, likes, dislikes, comments }], cached }
 */
const _naverBoardCache = new LRUMap(50);
const NAVER_BOARD_TTL = 10 * 60 * 1000; // 10분

function _decodeNaverHtmlEntities(s) {
    return String(s || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

async function _fetchNaverBoardHtml(code) {
    const url = `https://finance.naver.com/item/board.naver?code=${code}`;
    const r = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StockAI/1.0',
            'Accept-Language': 'ko-KR,ko;q=0.9',
        },
    });
    if (!r.ok) throw new Error(`naver board ${r.status}`);
    return await r.text();
}

function _stripHtmlTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function _parseNaverBoardHtml(html, code) {
    // <tr onMouseOver="mouseOver(this)" ... > ... </tr> 블록 추출
    const rowRegex = /<tr\s+onMouseOver="mouseOver\(this\)"[^>]*>([\s\S]*?)<\/tr>/g;
    const posts = [];
    let m;
    while ((m = rowRegex.exec(html)) !== null && posts.length < 20) {
        const row = m[1];

        // 행을 <td> ... </td> 블록 단위로 분리 (보통 6개: date / title / author / views / likes / dislikes)
        const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]);
        if (tds.length < 6) continue;

        // td0: 날짜
        const date = _stripHtmlTags(tds[0]);

        // td1: 제목 + 링크 + nid (& 또는 &amp; 모두 허용)
        const titleMatch = tds[1].match(/<a href="\/item\/board_read\.naver\?code=\d+(?:&|&amp;)nid=(\d+)[^"]*"[^>]*title="([^"]+)"/);
        if (!titleMatch) continue;
        const nid   = titleMatch[1];
        const title = _decodeNaverHtmlEntities(titleMatch[2]).trim();

        // 댓글 수 — title 셀 안 [<b>N</b>] 패턴
        const cmtMatch = tds[1].match(/<span class="tah p9"[^>]*>\[<b>(\d+)<\/b>\]<\/span>/);
        const comments = cmtMatch ? Number(cmtMatch[1]) : 0;

        // td2: 작성자 — img/span 등 모두 제거하고 남은 텍스트
        const author = _decodeNaverHtmlEntities(_stripHtmlTags(tds[2])) || '익명';

        // td3: 조회 / td4: 추천 / td5: 비추천 — 각 셀 텍스트에서 첫 숫자 추출
        const pickNum = (s) => {
            const t = _stripHtmlTags(s).replace(/[^\d-]/g, '');
            return t ? Number(t) : 0;
        };
        const views    = pickNum(tds[3]);
        const likes    = pickNum(tds[4]);
        const dislikes = pickNum(tds[5]);

        posts.push({
            title,
            author,
            date,
            views,
            likes,
            dislikes,
            comments,
            link: `https://finance.naver.com/item/board_read.naver?code=${code}&nid=${nid}`,
        });
    }
    return posts;
}

// ── 네이버 미국 종목 토론 (foreignStock) ─────────────────────
// stock.naver.com/api/community/discussion/posts/by-item
// itemCode: TSLA.O (NASDAQ), JPM.N (NYSE) 형식 필요
function _formatNaverDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return iso;
    return `${m[2]}.${m[3]} ${m[4]}:${m[5]}`;
}

async function _fetchNaverForeignDiscussion(symbol, suffix) {
    const itemCode = symbol + suffix;
    const url = 'https://stock.naver.com/api/community/discussion/posts/by-item'
        + `?itemCode=${encodeURIComponent(itemCode)}`
        + '&pageSize=20&page=1&discussionType=foreignStock'
        + '&isHolderOnly=false&excludesItemNews=false'
        + '&isItemNewsOnly=false&isCleanbotPassedOnly=false';
    const r = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StockAI/1.0',
            'Referer': 'https://stock.naver.com/',
            'Accept': 'application/json',
            'Accept-Language': 'ko-KR,ko;q=0.9',
        },
    });
    if (!r.ok) throw new Error(`naver foreign discussion ${r.status}`);
    const data = await r.json();
    const list = Array.isArray(data && data.posts) ? data.posts : [];
    return list.map(p => ({
        title:    String(p.title || '').trim(),
        author:   String((p.writer && p.writer.nickname) || '익명'),
        date:     _formatNaverDate(p.writtenAt),
        views:    0, // foreignStock 응답에는 조회수 없음
        likes:    p.recommendCount | 0,
        dislikes: p.notRecommendCount | 0,
        comments: p.commentCount | 0,
        link:     `https://m.stock.naver.com/worldstock/stock/${itemCode}/discuss/${p.id}`,
    }));
}

app.get('/api/naver-board/:symbol', async (req, res) => {
    const sym = String(req.params.symbol || '').toUpperCase();
    // KR 6자리(.KS/.KQ) 또는 US 1~5자 알파벳(+ 옵션 .B 등)
    const krMatch = sym.match(/^(\d{6})(\.K[SQ])?$/);
    const usMatch = sym.match(/^([A-Z]{1,5}(?:\.[A-Z])?)$/);
    if (!krMatch && !usMatch) {
        return res.status(400).json({ error: 'KR(005930) 또는 US(TSLA) 심볼만 지원' });
    }
    const isKr = !!krMatch;
    const cacheKey = isKr ? krMatch[1] : sym;
    const now = Date.now();

    const cached = _naverBoardCache.get(cacheKey);
    if (cached && now - cached.ts < NAVER_BOARD_TTL) {
        return res.json({ posts: cached.posts, cached: true, ts: cached.ts });
    }
    try {
        let posts;
        if (isKr) {
            const html = await _fetchNaverBoardHtml(krMatch[1]);
            posts = _parseNaverBoardHtml(html, krMatch[1]);
        } else {
            // US: NASDAQ(.O) 우선 → 빈 결과면 NYSE(.N) 폴백
            posts = await _fetchNaverForeignDiscussion(sym, '.O');
            if (!posts.length) {
                try { posts = await _fetchNaverForeignDiscussion(sym, '.N'); }
                catch { /* .O 결과(빈 배열) 유지 */ }
            }
        }
        _naverBoardCache.set(cacheKey, { posts, ts: now });
        res.json({ posts, cached: false, ts: now });
    } catch (err) {
        console.error('[naver-board]', cacheKey, err.message);
        res.status(502).json({ error: '네이버 토론실 데이터를 가져올 수 없어요' });
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
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
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
app.post('/api/vision-scan', _rlVisionScan, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
    if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    }

    try {
        const b64      = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype;

        const genAI = getGenAI();
        if (!genAI) return res.status(503).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

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
 * Gemini 503 시 Anthropic Claude 자동 폴백
 */
const parseJsonLoose = raw => {
    const cleaned = String(raw).trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    return JSON.parse(cleaned);
};

function isGeminiRetryable(err) {
    const msg = (err?.message || '').toLowerCase();
    return err?.status === 503 || err?.status === 429
        || msg.includes('[503 ') || msg.includes('[429 ')
        || msg.includes('high demand') || msg.includes('overloaded')
        || msg.includes('resource exhausted') || msg.includes('too many requests');
}

/** Anthropic Claude(haiku)로 이미지+프롬프트 분석, 결과 텍스트 반환 */
async function callAnthropicChartDraw(imageBase64, mimeType, fullPrompt) {
    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{
            role: 'user',
            content: [
                { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
                { type: 'text', text: fullPrompt },
            ],
        }],
    });
    return msg.content.find(b => b.type === 'text')?.text || '';
}

app.post('/api/chart-draw', _rlChartDraw, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });

    // priceData 파싱 — 신규 ctx 스키마(ohlcv + indicators + series) 또는 구 포맷(closes/highs/lows/dates)
    let ctx = null;
    if (req.body.priceData) {
        try { ctx = JSON.parse(req.body.priceData); }
        catch (e) { return res.status(400).json({ error: 'priceData JSON 형식이 올바르지 않습니다.' }); }
    }
    // 하위호환: 구 포맷으로 들어오면 최소한의 ctx 로 변환
    if (ctx && !ctx.ohlcv && Array.isArray(ctx.closes)) {
        const N = ctx.closes.length;
        const cur = [...ctx.closes].reverse().find(v => v != null);
        ctx = {
            symbol: ctx.symbol || '?',
            name: ctx.name || '',
            interval: ctx.interval || '1d',
            currency: ctx.currency || 'USD',
            currentPrice: cur,
            ohlcv: Array.from({ length: N }, (_, i) => ({
                d: ctx.dates?.[i], o: null, h: ctx.highs?.[i], l: ctx.lows?.[i], c: ctx.closes[i], v: null,
            })),
            indicators: {},
            series: { rsi: [], macdHist: [] },
        };
    }
    if (!ctx || !ctx.currentPrice) {
        return res.status(400).json({ error: 'priceData.currentPrice 필수' });
    }

    const stream = req.query.stream === '1';
    const fullPrompt = `${SYSTEM_ROLE}\n\n${OUTPUT_CONTRACT}\n\n${buildUserPrompt(ctx)}`;
    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // SSE 헤더 설정 (stream 모드)
    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
    }

    const sseSend = obj => { if (stream) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    const sseDone = (data) => { sseSend({ done: true, data }); res.end(); };
    const sseError = (msg) => { sseSend({ error: msg }); res.end(); };

    // ── Gemini 시도 (429/503 시 2초 대기 후 1회 재시도) ──────────
    let geminiSucceeded = false;
    if (process.env.GEMINI_API_KEY) {
        const tryGemini = async () => {
            const genAI = getGenAI();
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: { temperature: 0.2 },
            });
            const parts = [fullPrompt, { inlineData: { data: imageBase64, mimeType } }];

            if (stream) {
                const result = await model.generateContentStream(parts);
                let buf = '';
                for await (const chunk of result.stream) {
                    const t = chunk.text();
                    if (!t) continue;
                    buf += t;
                    sseSend({ chunk: t });
                }
                const data = normalizeChartAnalysis(parseJsonLoose(buf));
                console.log(`[chart-draw:gemini:stream] 완료: signal=${data.signal} lines=${data.lines.length}`);
                sseDone(data);
            } else {
                const result = await model.generateContent(parts);
                const data = normalizeChartAnalysis(parseJsonLoose(result.response.text()));
                console.log(`[chart-draw:gemini] 완료: signal=${data.signal} lines=${data.lines.length}`);
                res.json(data);
            }
        };

        try {
            await tryGemini();
            geminiSucceeded = true;
        } catch (err) {
            if (isGeminiRetryable(err)) {
                if (!stream) {
                    // non-stream: 2초 대기 후 1회 재시도 (응답 미전송 상태라 안전)
                    console.warn(`[chart-draw] Gemini ${err?.status || 'error'} → 2초 후 재시도`);
                    await new Promise(r => setTimeout(r, 2000));
                    try {
                        await tryGemini();
                        geminiSucceeded = true;
                    } catch (err2) {
                        console.warn('[chart-draw] Gemini 재시도 실패 → Anthropic Claude 폴백');
                    }
                } else {
                    // stream: 이미 응답 헤더 전송됨 → 재시도 없이 바로 Claude 폴백
                    console.warn(`[chart-draw:stream] Gemini ${err?.status || 'error'} → Anthropic Claude 폴백`);
                    sseSend({ fallback: 'claude', chunk: '' });
                }
            } else {
                console.error('[chart-draw:gemini] 오류:', err.message);
                if (stream) { sseError(err.message); return; }
                return res.status(500).json({ error: err.message });
            }
        }
    }

    if (geminiSucceeded) return;

    // ── Anthropic Claude 폴백 ────────────────────────────────────
    if (!process.env.ANTHROPIC_API_KEY) {
        const msg = 'AI 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.';
        if (stream) { sseError(msg); return; }
        return res.status(503).json({ error: msg });
    }

    try {
        console.log('[chart-draw:claude] 분석 시작');
        const text = await callAnthropicChartDraw(imageBase64, mimeType, fullPrompt);
        const data = normalizeChartAnalysis(parseJsonLoose(text));
        console.log(`[chart-draw:claude] 완료: signal=${data.signal} lines=${data.lines.length}`);
        if (stream) {
            sseSend({ chunk: text });
            sseDone(data);
        } else {
            res.json(data);
        }
    } catch (err) {
        console.error('[chart-draw:claude] 오류:', err.message);
        const msg = 'AI 분석에 실패했습니다. 잠시 후 다시 시도해주세요.';
        if (stream) { sseError(msg); return; }
        res.status(500).json({ error: msg });
    }
});

/** Gemini/Claude 응답 정규화 — 테스타 전략 신호 스키마 검증 (lines / signal / entry / exit / hold) */
function normalizeChartAnalysis(raw) {
    const d = raw || {};
    const VALID_SIGNALS = ['BUY', 'SELL_STOP', 'SELL_TAKE', 'HOLD'];
    const signal = VALID_SIGNALS.includes(String(d.signal || '').toUpperCase())
        ? String(d.signal).toUpperCase() : 'HOLD';
    const num = v => (v == null || isNaN(Number(v))) ? null : Number(v);

    // lines 정규화 (3~4개 — MA5/MA20/MA70 + 선택적 entry)
    const VALID_TYPES = ['ma5', 'ma20', 'ma70', 'entry'];
    const lines = (Array.isArray(d.lines) ? d.lines : [])
        .map(ln => ({
            type:  VALID_TYPES.includes(ln?.type) ? ln.type : 'ma20',
            price: num(ln?.price),
            label: String(ln?.label || ln?.type || '').slice(0, 30),
            color: typeof ln?.color === 'string' ? ln.color : '#94a3b8',
        }))
        .filter(ln => ln.price != null && ln.price > 0);

    // signal 별 필수 필드 검증 (없거나 잘못되면 HOLD 폴백)
    let entry = null, exit = null, hold = null;
    if (signal === 'BUY' && d.entry) {
        entry = {
            price:           num(d.entry.price),
            stopLossPrice:   num(d.entry.stopLossPrice),
            stopLossPct:     num(d.entry.stopLossPct),
            positionSizePct: num(d.entry.positionSizePct),
            expectedRR:      String(d.entry.expectedRR || ''),
            criteria: (Array.isArray(d.entry.criteria) ? d.entry.criteria : []).map(c => ({
                label:  String(c?.label  || '').slice(0, 80),
                passed: c?.passed === true,
                detail: String(c?.detail || '').slice(0, 200),
            })).slice(0, 5),
        };
    } else if ((signal === 'SELL_STOP' || signal === 'SELL_TAKE') && d.exit) {
        exit = {
            price:     num(d.exit.price),
            ma20:      num(d.exit.ma20),
            pnlPct:    num(d.exit.pnlPct),
            rationale: String(d.exit.rationale || '').slice(0, 200),
        };
    } else if (signal === 'HOLD') {
        hold = {
            unmet:    (Array.isArray(d.hold?.unmet) ? d.hold.unmet : [])
                        .map(s => String(s).slice(0, 200)).slice(0, 6),
            guidance: String(d.hold?.guidance || '조건 충족 시까지 대기').slice(0, 200),
        };
    }

    return {
        signal,
        symbol:       String(d.symbol || '').slice(0, 20),
        currentPrice: num(d.currentPrice),
        ma: {
            ma5:  num(d.ma?.ma5),
            ma20: num(d.ma?.ma20),
            ma70: num(d.ma?.ma70),
        },
        entry,
        exit,
        hold,
        lines,
        summary: String(d.summary || '').slice(0, 200),
    };
}

/**
 * AI 추천 종목 (Gemini 퀀트 스크리닝, 24h 캐시)
 * GET /api/ai-recommend → [{ticker, name, reason, signal}] 60~80개
 */
app.get('/api/ai-recommend', _rlAiRecommend, async (req, res) => {
    try {
        if (_aiRecCache.data && Date.now() - _aiRecCache.ts < AI_REC_TTL) {
            return res.json(_aiRecCache.data);
        }

        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const prompt = `You are a quant-based stock screener AI analyst.
Return a JSON array of 60-80 US stocks (NYSE/NASDAQ) meeting these criteria:
- Market cap >= $500M
- High average daily trading volume (top tier)
- RSI <= 30 OR 5-day MA crossed above 20-day MA recently
- Diverse sectors: Tech, Healthcare, Finance, Energy, Consumer, Industrials
- No duplicate tickers

Output ONLY a valid JSON array. No explanation, no markdown fences, no extra text.
Each item must have exactly these fields:
- ticker (string): stock ticker symbol
- name (string): company name in English
- reason (string): 1-2 line recommendation reason in Korean
- signal (string): one of "buy", "watch", "avoid"

Start your response with [ and end with ]`;

        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const jsonStr = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
        const picks = JSON.parse(jsonStr);

        _aiRecCache = { data: picks, ts: Date.now() };
        res.json(picks);
    } catch (e) {
        console.error('[ai-recommend]', e.message);
        if (_aiRecCache.data) return res.json(_aiRecCache.data);
        res.status(500).json({ error: e.message });
    }
});

/**
 * 오늘의 핫 종목 (Gemini, 24h 캐시)
 * GET /api/hot-stocks → {institution:[...], value:[...], momentum:[...]}
 */
let _hotStocksCache = { data: null, ts: 0 };
const HOT_TTL = 24 * 60 * 60 * 1000; // 24시간 — 무료 쿼터 절약
const HOT_FALLBACK_TTL = 30 * 60 * 1000; // Yahoo 폴백은 30분 주기 갱신

// Yahoo Finance 스크리너 기반 폴백: Gemini 실패/쿼터 소진 시 실제 시장 데이터로 채움
async function _hotStocksFromYahoo() {
    const fetchScr = async (id) => {
        const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=${id}&count=25`;
        const d = await yfRequest(url);
        return d?.finance?.result?.[0]?.quotes || [];
    };
    const pick = (arr, n) => arr.slice(0, n).map(q => ({
        ticker: q.symbol,
        name: q.shortName || q.longName || q.symbol,
        price: q.regularMarketPrice,
        change: q.regularMarketChangePercent,
    }));

    const [actives, gainers, losers] = await Promise.all([
        fetchScr('most_actives').catch(() => []),
        fetchScr('day_gainers').catch(() => []),
        fetchScr('day_losers').catch(() => []),
    ]);

    // 중복 티커 제거: actives → gainers → losers 우선순위
    const used = new Set();
    const dedupe = (arr) => arr.filter(s => {
        if (used.has(s.ticker)) return false;
        used.add(s.ticker);
        return true;
    });

    // institution: 거래량 상위 대형주 (기관 자금 유입 proxy)
    const institution = dedupe(pick(actives, 8)).slice(0, 5).map(s => ({
        ticker: s.ticker,
        name: s.name,
        reason: `거래량 상위 · ${s.change >= 0 ? '+' : ''}${(s.change ?? 0).toFixed(1)}% 기관 관심`,
        signal: s.change > 0 ? 'buy' : 'watch',
    }));

    // value: 단기 조정 받은 종목 (저평가 매수 기회 proxy)
    const value = dedupe(pick(losers, 8)).slice(0, 5).map(s => ({
        ticker: s.ticker,
        name: s.name,
        reason: `단기 조정 ${(s.change ?? 0).toFixed(1)}% · 가치 매수 관점`,
        signal: 'watch',
    }));

    // momentum: 당일 상승률 상위
    const momentum = dedupe(pick(gainers, 8)).slice(0, 5).map(s => ({
        ticker: s.ticker,
        name: s.name,
        reason: `당일 +${(s.change ?? 0).toFixed(1)}% 모멘텀 강세`,
        signal: 'buy',
    }));

    if (!institution.length && !value.length && !momentum.length) {
        throw new Error('Yahoo screener returned no data');
    }
    return { institution, value, momentum, _source: 'yahoo-fallback' };
}

app.get('/api/hot-stocks', _rlHotStocks, async (req, res) => {
    // 1) 캐시 히트 (24h)
    if (_hotStocksCache.data && Date.now() - _hotStocksCache.ts < HOT_TTL) {
        return res.json(_hotStocksCache.data);
    }

    // 2) Gemini 시도
    try {
        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const prompt = `You are a quantitative stock analyst for US equities.
Return a JSON object with exactly 3 keys: institution, value, momentum.
Each key maps to an array of exactly 5 stock objects.

Criteria:
- institution: stocks with new significant 13F institutional buying (hedge funds, mutual funds, pension)
- value: stocks with low P/E (<15), low P/B (<1.5), dividend yield >2%, market cap >$10B
- momentum: stocks with 5-day MA above 20-day MA, RSI between 50-70, high volume vs 20-day avg

Each stock object must have:
- ticker (string): NYSE/NASDAQ ticker
- name (string): company name in English
- reason (string): 1-line reason in Korean (why this stock fits the category)
- signal (string): "buy" or "watch"

No duplicate tickers across categories.
Output ONLY valid JSON starting with { and ending with }.`;

        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const jsonStr = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
        const data = JSON.parse(jsonStr);
        _hotStocksCache = { data, ts: Date.now() };
        return res.json(data);
    } catch (e) {
        console.warn('[hot-stocks] Gemini 실패 → Yahoo 스크리너 폴백:', e.message);
    }

    // 3) Yahoo 폴백
    try {
        const data = await _hotStocksFromYahoo();
        // 폴백 결과는 짧은 TTL로만 저장 (다음 요청 때 Gemini 재시도 가능하도록)
        _hotStocksCache = { data, ts: Date.now() - (HOT_TTL - HOT_FALLBACK_TTL) };
        return res.json(data);
    } catch (e2) {
        console.error('[hot-stocks] Yahoo 폴백도 실패:', e2.message);
        // 4) 최후: 이전 캐시 있으면 stale이라도 서빙
        if (_hotStocksCache.data) return res.json(_hotStocksCache.data);
        res.status(500).json({ error: e2.message });
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

// 인증: X-Admin-Token 헤더 = process.env.ADMIN_TOKEN (timing-safe)
function _checkAdminToken(req, res) {
    const token = String(req.get('x-admin-token') || '');
    const expected = String(process.env.ADMIN_TOKEN || '');
    if (!expected) { res.status(503).json({ error: 'ADMIN_TOKEN not configured' }); return false; }
    // timing-safe 비교 (길이 다르면 바로 false 처리, crypto.timingSafeEqual 은 동일 길이 필요)
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    let ok = a.length === b.length;
    try { ok = ok && require('crypto').timingSafeEqual(a, b); } catch { ok = false; }
    if (!ok) { res.status(401).json({ error: 'unauthorized' }); return false; }
    return true;
}
// AI 분석 저장 body 화이트리스트 — prototype-pollution 키 차단 + 크기 안전
function _sanitizeAiBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const ALLOWED = ['summary', 'detail', 'score', 'signals', 'indicators', 'zones',
                     'levels', 'updatedAt', 'model', 'style', 'recommendation'];
    const out = {};
    for (const k of ALLOWED) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
    }
    // 재직렬화로 prototype-pollution / 순환참조 제거
    try {
        const serialized = JSON.stringify(out);
        if (serialized.length > 60000) return null; // 60KB 초과 거부
        return JSON.parse(serialized);
    } catch { return null; }
}

app.post('/api/ai-analysis/:symbol', async (req, res) => {
    if (!_checkAdminToken(req, res)) return;
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const symbol = String(req.params.symbol || '').toUpperCase();
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    const clean = _sanitizeAiBody(req.body);
    if (!clean) return res.status(400).json({ error: 'invalid body' });
    try {
        const { error } = await supabase
            .from('ai_analysis')
            .upsert({ symbol, data: clean, updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ai-analysis/:symbol', async (req, res) => {
    if (!_checkAdminToken(req, res)) return;
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    const symbol = String(req.params.symbol || '').toUpperCase();
    if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
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

// ─────────────────────────────────────────────
// FRED API 프록시 (CPI / PPI 경제지표)
// ─────────────────────────────────────────────
const FRED_CACHE = {};
const FRED_TTL   = 6 * 60 * 60 * 1000; // 6시간 캐시

const VALID_FRED_SERIES = new Set(['CPIAUCSL', 'PPIACO']);

app.get('/api/fred/:seriesId', async (req, res) => {
    const { seriesId } = req.params;
    if (!VALID_FRED_SERIES.has(seriesId)) {
        return res.status(400).json({ error: '지원하지 않는 시리즈 ID입니다.' });
    }
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'FRED_API_KEY가 설정되지 않았습니다.' });

    const cached = FRED_CACHE[seriesId];
    if (cached && Date.now() - cached.ts < FRED_TTL) {
        return res.json(cached.data);
    }

    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&limit=36&sort_order=desc`;
        const resp = await axios.get(url, { timeout: 10000 });
        const observations = resp.data.observations || [];
        FRED_CACHE[seriesId] = { data: { observations }, ts: Date.now() };
        console.log(`[fred] ${seriesId} ${observations.length}개 조회 완료`);
        res.json({ observations });
    } catch (err) {
        console.error('[fred] 오류:', err.message);
        res.status(502).json({ error: 'FRED 데이터 조회 실패: ' + err.message });
    }
});

// ─────────────────────────────────────────────
// AI 경제지표 분석 (Gemini, IP당 1분 1회 제한)
// ─────────────────────────────────────────────
const _ecoAiRateMap = new Map(); // ip → last call timestamp
const ECO_AI_RATE_MS = 60 * 1000; // 1분

// 5분마다 만료된 rate-limit 항목 정리 (메모리 누수 방지)
setInterval(() => {
    const cutoff = Date.now() - ECO_AI_RATE_MS;
    for (const [ip, ts] of _ecoAiRateMap) {
        if (ts < cutoff) _ecoAiRateMap.delete(ip);
    }
}, 5 * 60 * 1000).unref();

app.post('/api/economic-ai', async (req, res) => {
    // IP rate limit — req.ip 사용 (app.set('trust proxy', 1) 결합으로 헤더 스푸핑 방어)
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const last = _ecoAiRateMap.get(ip) || 0;
    if (now - last < ECO_AI_RATE_MS) {
        return res.status(429).json({ error: '요청이 너무 잦습니다. 1분 후 다시 시도해주세요.' });
    }
    _ecoAiRateMap.set(ip, now);

    const { cpiObs, ppiObs } = req.body;
    if (!Array.isArray(cpiObs) || !Array.isArray(ppiObs)) {
        return res.status(400).json({ error: 'cpiObs, ppiObs는 배열이어야 합니다.' });
    }

    const latestCPI = cpiObs[0], prevCPI = cpiObs[1];
    const latestPPI = ppiObs[0];
    if (!latestCPI || !prevCPI || !latestPPI) return res.status(400).json({ error: '데이터 부족' });

    const cpiMoM = (((parseFloat(latestCPI.value) - parseFloat(prevCPI.value)) / parseFloat(prevCPI.value)) * 100).toFixed(2);
    const prevYearCPI = cpiObs[12];
    const cpiYoY = prevYearCPI
        ? (((parseFloat(latestCPI.value) - parseFloat(prevYearCPI.value)) / parseFloat(prevYearCPI.value)) * 100).toFixed(2)
        : 'N/A';

    const prompt = `당신은 매크로 경제 전문 애널리스트입니다.
다음 최신 경제지표를 바탕으로 주식 시장 영향을 분석해주세요.

[최신 CPI] ${latestCPI.value} (${latestCPI.date}) / 전월 대비: ${cpiMoM}% / 전년 대비: ${cpiYoY}%
[최신 PPI] ${latestPPI.value} (${latestPPI.date})

분석 형식:
1. 인플레이션 방향성 판단 (1문장)
2. 연준 금리 정책 영향 전망 (1문장)
3. 수혜 섹터 / 피해 섹터 (간결하게)

한국어로 3~4문장 이내로 작성하고, 수치를 직접 인용하세요.`;

    const runGemini = async () => {
        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', generationConfig: { temperature: 0.4 } });
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    };

    try {
        const comment = await runGemini();
        res.json({ comment });
    } catch (err) {
        if (isGeminiRetryable(err)) {
            console.warn('[economic-ai] Gemini 429/503 → 2초 후 재시도');
            await new Promise(r => setTimeout(r, 2000));
            try {
                const comment = await runGemini();
                res.json({ comment });
            } catch (err2) {
                console.error('[economic-ai] 재시도 실패:', err2.message);
                res.status(503).json({ error: 'AI 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.' });
            }
        } else {
            console.error('[economic-ai] 오류:', err.message);
            res.status(500).json({ error: err.message });
        }
    }
});

// ═══════════════════════════════════════════════════════════════
// Guru Portfolio — SEC EDGAR 13F-HR 기반 부자들의 포트폴리오
// ═══════════════════════════════════════════════════════════════
const { XMLParser } = require('fast-xml-parser');

const SEC_UA = process.env.SEC_USER_AGENT || 'StockAI research rkd687@gmail.com';
const CIK_RE = /^\d{10}$/;
const QUARTER_RE = /^\d{4}Q[1-4]$/;
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

function validCIK(s)     { return s && CIK_RE.test(s); }
function validQuarter(s) { return s && QUARTER_RE.test(s); }
function validTicker(s)  { return s && TICKER_RE.test(s); }

// 간격 sleep
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

// filingDate(YYYY-MM-DD) → 'YYYYQn' (보고기준 분기; 45일 지연 감안해 filing 3개월 전으로 잡음)
function quarterFromReportPeriod(periodOfReport) {
    // periodOfReport 형식: 'YYYY-MM-DD' (예: '2025-12-31')
    if (!periodOfReport) return null;
    const [y, m] = periodOfReport.split('-').map(Number);
    if (!y || !m) return null;
    const q = Math.ceil(m / 3);
    return `${y}Q${q}`;
}

// SEC submissions API: 최근 13F 파일링 메타 조회
async function edgarFetchFilings(cik) {
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const { data } = await axios.get(url, {
        headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
        timeout: 15000,
    });
    const recent = data.filings && data.filings.recent;
    if (!recent) return [];
    const out = [];
    const forms = recent.form || [];
    const accs  = recent.accessionNumber || [];
    const dates = recent.filingDate || [];
    const primaries = recent.primaryDocument || [];
    const reportPeriods = recent.reportDate || [];
    for (let i = 0; i < forms.length; i++) {
        if (forms[i] === '13F-HR' || forms[i] === '13F-HR/A') {
            out.push({
                accession: accs[i],
                filingDate: dates[i],
                primaryDoc: primaries[i],
                reportPeriod: reportPeriods[i],
                form: forms[i],
            });
        }
    }
    return out;
}

// 파일링의 infotable XML을 찾아 다운로드
async function edgarFetchInfoTable(cik, accession) {
    const accNoDash = accession.replace(/-/g, '');
    // 인덱스 JSON 조회로 information table 파일명 탐색
    const idxUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/`;
    const idxJsonUrl = idxUrl + 'index.json';
    const { data: idx } = await axios.get(idxJsonUrl, {
        headers: { 'User-Agent': SEC_UA },
        timeout: 15000,
    });
    const items = (idx.directory && idx.directory.item) || [];
    // information table은 보통 'infotable.xml' 또는 두 번째 XML(primary는 form XML)
    let infoTable = items.find(it => /infotable\.xml$/i.test(it.name) || /informationtable\.xml$/i.test(it.name));
    if (!infoTable) {
        // 후보: .xml 중 'primary_doc' 아닌 것
        const xmls = items.filter(it => /\.xml$/i.test(it.name) && !/primary_doc/i.test(it.name));
        infoTable = xmls[0];
    }
    if (!infoTable) throw new Error(`infotable not found in ${accession}`);
    const xmlUrl = idxUrl + infoTable.name;
    const { data: xml } = await axios.get(xmlUrl, {
        headers: { 'User-Agent': SEC_UA },
        responseType: 'text',
        timeout: 20000,
    });
    return xml;
}

function parse13FHR(xml) {
    const parser = new XMLParser({
        ignoreAttributes: true,
        removeNSPrefix: true,
        parseTagValue: false,
        trimValues: true,
    });
    const obj = parser.parse(xml);
    // 구조: informationTable > infoTable[]
    const root = obj.informationTable || obj.InformationTable || obj;
    let rows = root.infoTable || root.InfoTable || [];
    if (!Array.isArray(rows)) rows = [rows];
    return rows.map(r => {
        const sh = r.shrsOrPrnAmt || {};
        return {
            nameOfIssuer: String(r.nameOfIssuer || '').trim(),
            titleOfClass: String(r.titleOfClass || '').trim(),
            cusip: String(r.cusip || '').trim().toUpperCase(),
            value: Number(r.value || 0), // USD; 2022Q3+ 단위는 정확한 달러 (이전은 천달러)
            sshPrnamt: Number(sh.sshPrnamt || 0),
            sshPrnamtType: String(sh.sshPrnamtType || '').trim(),
        };
    }).filter(r => r.cusip);
}

// CUSIP → Ticker 매핑 (OpenFIGI + Supabase 캐시)
async function cusipToTicker(cusips) {
    const supabase = getSupabase();
    const result = {}; // cusip → {ticker, name, exchange}

    if (supabase && cusips.length) {
        const { data: cached } = await supabase
            .from('cusip_ticker')
            .select('cusip,ticker,name,exchange')
            .in('cusip', cusips);
        (cached || []).forEach(c => { result[c.cusip] = c; });
    }

    const missing = cusips.filter(c => !(c in result));
    if (!missing.length) return result;

    // OpenFIGI batch — 무키: 최대 10개/req, 25req/6s
    //                키있음: 최대 100개/req, 25req/6s
    const figiKey = process.env.OPENFIGI_API_KEY;
    const BATCH = figiKey ? 100 : 10;
    for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        try {
            const { data } = await axios.post(
                'https://api.openfigi.com/v3/mapping',
                batch.map(c => ({ idType: 'ID_CUSIP', idValue: c })),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...(figiKey ? { 'X-OPENFIGI-APIKEY': figiKey } : {}),
                    },
                    timeout: 15000,
                }
            );
            const rows = [];
            data.forEach((item, idx) => {
                const cusip = batch[idx];
                if (item && item.data && item.data.length) {
                    // 미국 주식(Common Stock) 우선
                    const us = item.data.find(d => d.exchCode && /US|UN|UQ|UR|UA|UF|UV|UW/.test(d.exchCode)) || item.data[0];
                    const rec = {
                        cusip,
                        ticker: us.ticker || null,
                        name: us.name || null,
                        exchange: us.exchCode || null,
                    };
                    result[cusip] = rec;
                    rows.push(rec);
                } else {
                    // 매핑 실패도 캐시 (null ticker)
                    const rec = { cusip, ticker: null, name: null, exchange: null };
                    result[cusip] = rec;
                    rows.push(rec);
                }
            });
            if (supabase && rows.length) {
                await supabase.from('cusip_ticker').upsert(rows, { onConflict: 'cusip' });
            }
        } catch (e) {
            console.warn('[OpenFIGI] batch failed:', e.message);
        }
        // rate limit: 25req/6s → 안전하게 260ms 간격 (≈23req/6s)
        if (i + BATCH < missing.length) await _sleep(figiKey ? 250 : 260);
    }
    return result;
}

// Guru 1명 — 최근 N개 분기 크롤링 + Supabase upsert
async function refreshGuru(cik, { quarters = 2 } = {}) {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not configured');

    const filings = await edgarFetchFilings(cik);
    if (!filings.length) return { ok: false, reason: 'no 13F filings' };

    // 최신 순 → quarters개만
    const targets = filings.slice(0, quarters);
    let totalPositions = 0;
    let latestFilingDate = null;
    let latestTotalValue = 0;

    for (const f of targets) {
        await _sleep(150); // SEC rate limit
        const xml = await edgarFetchInfoTable(cik, f.accession);
        const rows = parse13FHR(xml);
        const quarter = quarterFromReportPeriod(f.reportPeriod) || quarterFromReportPeriod(f.filingDate);
        if (!quarter) continue;

        // CUSIP 매핑
        const uniqueCusips = [...new Set(rows.map(r => r.cusip))];
        const mapping = await cusipToTicker(uniqueCusips);

        // CUSIP별 집계 (같은 발행사 여러 시리즈 합산)
        const agg = {};
        rows.forEach(r => {
            if (!agg[r.cusip]) agg[r.cusip] = { cusip: r.cusip, name: r.nameOfIssuer, shares: 0, value: 0 };
            agg[r.cusip].shares += r.sshPrnamt;
            agg[r.cusip].value  += r.value;
        });
        const aggRows = Object.values(agg);
        const totalValue = aggRows.reduce((s, r) => s + r.value, 0);

        // 직전 분기 조회 (action 계산용)
        const { data: prev } = await supabase
            .from('guru_position')
            .select('cusip,shares')
            .eq('cik', cik)
            .lt('quarter', quarter)
            .order('quarter', { ascending: false })
            .limit(500);
        const prevMap = {};
        (prev || []).forEach(p => {
            // 가장 최근 분기의 shares만 유지
            if (!(p.cusip in prevMap)) prevMap[p.cusip] = p.shares;
        });

        // guru_quarter upsert
        await supabase.from('guru_quarter').upsert({
            cik, quarter,
            filing_date: f.filingDate,
            accession: f.accession,
            total_value: totalValue,
        }, { onConflict: 'cik,quarter' });

        // guru_position upsert
        const positions = aggRows.map(r => {
            const m = mapping[r.cusip] || {};
            const prevShares = prevMap[r.cusip] || 0;
            let action = 'HOLD';
            if (prevShares === 0 && r.shares > 0) action = 'NEW';
            else if (r.shares === 0 && prevShares > 0) action = 'SOLD';
            else if (prevShares > 0) {
                const chg = (r.shares - prevShares) / prevShares;
                if (chg >= 0.10) action = 'ADD';
                else if (chg <= -0.10) action = 'REDUCE';
            }
            const weight = totalValue > 0 ? (r.value / totalValue) * 100 : 0;
            return {
                cik, quarter,
                cusip: r.cusip,
                ticker: m.ticker || null,
                name: r.name || m.name || null,
                shares: r.shares,
                value_usd: r.value,
                weight: Number(weight.toFixed(3)),
                action,
                prev_shares: prevShares,
            };
        });

        // 청크 단위 upsert (큰 portfolio 대비)
        for (let i = 0; i < positions.length; i += 200) {
            const chunk = positions.slice(i, i + 200);
            const { error } = await supabase
                .from('guru_position')
                .upsert(chunk, { onConflict: 'cik,quarter,cusip' });
            if (error) throw new Error(error.message);
        }
        totalPositions += positions.length;
        if (!latestFilingDate || f.filingDate > latestFilingDate) {
            latestFilingDate = f.filingDate;
            latestTotalValue = totalValue;
        }
    }

    // guru 메타 갱신
    await supabase.from('guru').update({
        last_filed_at: latestFilingDate,
        aum_usd: latestTotalValue,
    }).eq('cik', cik);

    return { ok: true, positions: totalPositions, latestFilingDate };
}

// ──────── Admin: Guru refresh ────────
app.post('/api/guru-refresh/:cik', async (req, res) => {
    const cik = req.params.cik;
    if (!validCIK(cik)) return res.status(400).json({ error: 'invalid CIK (10 digits required)' });
    const token = req.get('X-Admin-Token');
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    try {
        const quarters = Math.min(parseInt(req.query.quarters || '2', 10) || 2, 8);
        const result = await refreshGuru(cik, { quarters });
        res.json(result);
    } catch (e) {
        console.error('[guru-refresh]', cik, e.message);
        res.status(500).json({ error: e.message });
    }
});

// ──────── GET: Guru list ────────
app.get('/api/guru', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
        const { data: gurus, error } = await supabase
            .from('guru')
            .select('*')
            .order('aum_usd', { ascending: false, nullsFirst: false });
        if (error) throw new Error(error.message);

        // 각 Guru의 최신 분기 Top3 티커 조회
        const out = [];
        for (const g of (gurus || [])) {
            const { data: top } = await supabase
                .from('guru_position')
                .select('ticker,weight,quarter')
                .eq('cik', g.cik)
                .order('quarter', { ascending: false })
                .order('weight', { ascending: false })
                .limit(20);
            const latestQ = top && top.length ? top[0].quarter : null;
            const top3 = (top || [])
                .filter(t => t.quarter === latestQ && t.ticker)
                .slice(0, 3)
                .map(t => ({ ticker: t.ticker, weight: t.weight }));
            const hasData = !!(g.aum_usd || (top3 && top3.length));
            out.push({
                ...g,
                top3,
                latest_quarter: latestQ,
                data_status: hasData ? 'ok' : 'empty',
            });
        }
        res.json(out);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ──────── GET: Guru 단건 메타 + 분기 목록 ────────
app.get('/api/guru/:cik', async (req, res) => {
    const cik = req.params.cik;
    if (!validCIK(cik)) return res.status(400).json({ error: 'invalid CIK' });
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
        const { data: guru, error: e1 } = await supabase
            .from('guru').select('*').eq('cik', cik).single();
        if (e1 || !guru) return res.status(404).json({ error: 'guru not found' });

        const { data: quarters } = await supabase
            .from('guru_quarter')
            .select('quarter,filing_date,total_value')
            .eq('cik', cik)
            .order('quarter', { ascending: false });
        res.json({ ...guru, quarters: quarters || [] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ──────── GET: Guru 분기별 holdings ────────
app.get('/api/guru/:cik/positions', async (req, res) => {
    const cik = req.params.cik;
    if (!validCIK(cik)) return res.status(400).json({ error: 'invalid CIK' });
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
        let quarter = req.query.quarter;
        if (quarter && !validQuarter(quarter)) return res.status(400).json({ error: 'invalid quarter' });
        if (!quarter) {
            const { data: latest } = await supabase
                .from('guru_quarter').select('quarter')
                .eq('cik', cik).order('quarter', { ascending: false }).limit(1);
            if (!latest || !latest.length) return res.json({ quarter: null, positions: [] });
            quarter = latest[0].quarter;
        }
        const { data, error } = await supabase
            .from('guru_position')
            .select('cusip,ticker,name,shares,value_usd,weight,action,prev_shares')
            .eq('cik', cik).eq('quarter', quarter)
            .order('weight', { ascending: false });
        if (error) throw new Error(error.message);
        res.json({ quarter, positions: data || [] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ──────── POST: null-ticker CUSIP 일괄 재조회 (관리자) ────────
app.post('/api/guru-fix-tickers', async (req, res) => {
    const token = req.get('X-Admin-Token') || req.headers['x-admin-token'];
    // fail-closed: ADMIN_TOKEN 미설정이면 즉시 거부 (프로덕션 env 누락 방지)
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
        // 1) null-ticker cusip_ticker 캐시 항목 삭제 (재조회 허용)
        await supabase.from('cusip_ticker').delete().is('ticker', null);

        // 2) guru_position에서 ticker IS NULL인 CUSIP 목록 수집
        const { data: rows } = await supabase
            .from('guru_position')
            .select('cusip')
            .is('ticker', null)
            .not('cusip', 'is', null);

        const cusips = [...new Set((rows || []).map(r => r.cusip).filter(Boolean))];
        if (!cusips.length) return res.json({ ok: true, resolved: 0, total: 0 });

        console.log(`[fix-tickers] ${cusips.length}개 CUSIP 재조회 시작`);

        // 3) OpenFIGI 재조회 (cusipToTicker가 배치 처리)
        const mapping = await cusipToTicker(cusips);

        // 4) guru_position 업데이트
        let resolved = 0;
        for (const [cusip, rec] of Object.entries(mapping)) {
            if (!rec || !rec.ticker) continue;
            const { error } = await supabase
                .from('guru_position')
                .update({ ticker: rec.ticker, name: rec.name || undefined })
                .eq('cusip', cusip)
                .is('ticker', null);
            if (!error) resolved++;
        }
        console.log(`[fix-tickers] 완료: ${resolved}/${cusips.length} 해결`);
        res.json({ ok: true, resolved, total: cusips.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ──────── GET: 티커로 보유 Guru 역조회 ────────
app.get('/api/guru/by-ticker/:ticker', async (req, res) => {
    const ticker = (req.params.ticker || '').toUpperCase();
    if (!validTicker(ticker)) return res.status(400).json({ error: 'invalid ticker' });
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
        // 각 Guru의 최신 분기에서 해당 티커 보유한 것만
        const { data, error } = await supabase
            .from('guru_position')
            .select('cik,quarter,weight,value_usd,shares,action,guru(name,manager,emoji)')
            .eq('ticker', ticker)
            .order('quarter', { ascending: false });
        if (error) throw new Error(error.message);

        // Guru별로 최신 분기만 유지
        const seen = new Set();
        const out = [];
        (data || []).forEach(r => {
            if (seen.has(r.cik)) return;
            seen.add(r.cik);
            out.push({
                cik: r.cik,
                quarter: r.quarter,
                name: r.guru && r.guru.name,
                manager: r.guru && r.guru.manager,
                emoji: (r.guru && r.guru.emoji) || '💎',
                weight: r.weight,
                value_usd: r.value_usd,
                shares: r.shares,
                action: r.action,
            });
        });
        // 비중 내림차순
        out.sort((a, b) => (b.weight || 0) - (a.weight || 0));
        res.json(out);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────
// 실적발표 일정 (Earnings Calendar)
// S&P500 + 즐겨찾기 합집합을 50개씩 배치로 quoteSummary 호출
// modules=calendarEvents,earnings,earningsHistory
// ─────────────────────────────────────────────
const _SP500 = (
    // S&P500 주요 구성종목 (2026 기준, 중복 제거 · 공백 구분)
    'A AAL AAPL ABBV ABNB ABT ACGL ACN ADBE ADI ADM ADP ADSK AEE AEP AES AFL AIG AIZ AJG AKAM ALB ALGN ALL ALLE AMAT AMCR AMD AME AMGN AMP AMT AMZN ANET ANSS AON AOS APA APD APH APTV ARE ATO AVB AVGO AVY AWK AXON AXP AZO BA BAC BALL BAX BBWI BBY BDX BEN BG BIIB BIO BK BKNG BKR BLDR BLK BMY BR BRO BSX BWA BX BXP C CAG CAH CARR CAT CB CBOE CBRE CCI CCL CDNS CDW CE CEG CF CFG CHD CHRW CHTR CI CINF CL CLX CMCSA CME CMG CMI CMS CNC CNP COF COO COP COR COST CPB CPRT CPT CRL CRM CRWD CSCO CSGP CSX CTAS CTLT CTRA CTSH CTVA CVS CVX CZR D DAL DAY DD DE DECK DFS DG DGX DHI DHR DIS DLR DLTR DOC DOV DOW DPZ DRI DTE DUK DVA DVN DXCM EA EBAY ECL ED EFX EG EIX EL ELV EMN EMR ENPH EOG EPAM EQIX EQR EQT ES ESS ETN ETR EVRG EW EXC EXPD EXPE EXR F FANG FAST FCX FDS FDX FE FFIV FI FICO FIS FITB FMC FOX FOXA FRT FSLR FTNT FTV GD GDDY GE GEHC GEN GILD GIS GL GLW GM GNRC GOOG GOOGL GPC GPN GRMN GS GWW HAL HAS HBAN HCA HD HES HIG HII HLT HOLX HON HPE HPQ HRL HSIC HST HSY HUBB HUM HWM IBM ICE IDXX IEX IFF ILMN INCY INTC INTU INVH IP IPG IQV IR IRM ISRG IT ITW IVZ J JBHT JBL JCI JKHY JNJ JNPR JPM K KDP KEY KEYS KHC KIM KKR KLAC KMB KMI KMX KO KR KVUE L LDOS LEN LH LHX LIN LKQ LLY LMT LNT LOW LRCX LULU LUV LVS LW LYB LYV MA MAA MAR MAS MCD MCHP MCK MCO MDLZ MDT MET META MGM MHK MKC MKTX MLM MMC MMM MNST MO MOH MOS MPC MPWR MRK MRNA MRO MS MSCI MSFT MSI MTB MTCH MTD MU NCLH NDAQ NDSN NEE NEM NFLX NI NKE NOC NOW NRG NSC NTAP NTRS NUE NVDA NVR NWS NWSA NXPI O ODFL OKE OMC ON ORCL ORLY OTIS OXY PANW PARA PAYC PAYX PCAR PCG PEG PEP PFE PFG PG PGR PH PHM PKG PLD PLTR PM PNC PNR PNW PODD POOL PPG PPL PRU PSA PSX PTC PWR PYPL QCOM QRVO RCL REG REGN RF RJF RL RMD ROK ROL ROP ROST RSG RTX RVTY SBAC SBUX SCHW SHW SJM SLB SMCI SNA SNPS SO SOLV SPG SPGI SRE STE STLD STT STX STZ SW SWK SWKS SYF SYK SYY T TAP TDG TDY TECH TEL TER TFC TFX TGT TJX TMO TMUS TPL TPR TRGP TRMB TROW TRV TSCO TSLA TSN TT TTWO TXN TXT TYL UAL UBER UDR UHS ULTA UNH UNP UPS URI USB V VICI VLO VLTO VMC VRSK VRSN VRTX VST VTR VTRS VZ WAB WAT WBA WBD WDAY WDC WEC WELL WFC WHR WM WMB WMT WRB WST WTW WY WYNN XEL XOM XRAY XYL YUM ZBH ZBRA ZTS'
).split(/\s+/).filter(Boolean);

// NASDAQ + NYSE 주요 비-S&P500 종목 (~250개) — 실적발표 일정 커버리지 확장용
// Chinese ADRs · 최근 IPO · SaaS · 반도체 · 바이오 · EV · 크립토 · 국제 ADR 등
// _SP500 과 합치면 ~700 unique. Yahoo 응답에 earnings 가 없으면 자동으로 빈 결과 반환.
const _NASDAQ_NYSE_EXTRAS = (
    // Chinese ADRs (NYSE/NASDAQ)
    'BABA BIDU JD NIO LI XPEV PDD ZTO BILI EDU TAL TME WB IQ NTES BGNE TCOM BZUN HUYA YMM FUTU TIGR HSAI ZH ' +
    // Hot IPOs / Growth (NYSE/NASDAQ)
    'COIN HOOD AFRM RBLX U SOFI UPST PATH OPEN PINS RIVN LCID DASH SQ SHOP SNAP SPOT DKNG ETSY CHWY W ' +
    'HIMS BIRK ARM CART RDDT ASTS RKLB JOBY ACHR DUOL TOST RNG ZG ' +
    // Semiconductors
    'ASML TSM UMC AEHR AMBA SIMO MXL WOLF ALAB ' +
    // SaaS / Cloud / Cybersecurity
    'NET ZS DDOG MDB SNOW OKTA TEAM CFLT TWLO ESTC GTLB MNDY FROG S BIGC PD APPS ASAN AI APP BILL ' +
    // Crypto / Blockchain
    'MSTR MARA RIOT CLSK BITF HUT CIFR WULF CAN IREN APLD ' +
    // International blue-chip ADRs
    'SAP NVO TM SONY HMC LVMUY ' +
    // Biotech (non-S&P500)
    'SGEN ALNY GMAB EXAS NVAX SAVA REPL ARWR EDIT NTLA BEAM BNTX PRMS RYTM TGTX VKTX SRPT IONS GH ARGX ' +
    'GSK NVS RXRX HALO RNA ASND ' +
    // EV / Auto (non-SP500 추가)
    'FSR NKLA BLNK CHPT EVGO QS PSNY VFS ' +
    // Energy / Oil (non-SP500)
    'PBR ARLP SU CNQ CVE IMO ' +
    // Financials mid-cap (non-SP500)
    'NYCB PACW WAL OZK EWBC FHN PNFP IBKR ' +
    // 기타 mid-cap growth
    'WIX FVRR SQSP HUBS CWAN GLBE'
).split(/\s+/).filter(Boolean);

function _classifyEarningsTime(raw) {
    // Yahoo earnings date timestamp -> BMO(장전) / AMC(장후) / TBD
    if (!raw || typeof raw !== 'number') return 'TBD';
    const d = new Date(raw * 1000);
    // ET(UTC-4 or -5) 근사 — UTC hour 기준
    const h = d.getUTCHours();
    // ET 9:30 장개장 = UTC 13:30(DST) ~14:30(EST) 보수적으로
    if (h < 13) return 'BMO';   // 새벽~오전 (미국 장전)
    if (h >= 20) return 'AMC';  // 저녁~야간 (미국 장후)
    return 'TBD';
}

async function _fetchEarningsBatch(symbols) {
    // quoteSummary 는 심볼당 1회 이지만 ?symbols= 다중지원 안함 → Promise.all 로 병렬
    const modules = 'calendarEvents,earnings,earningsHistory,price';
    const results = new Map();
    const CONCURRENCY = 25; // 20 → 25 (universe 가 SP500 + NASDAQ/NYSE extras 로 ~1.4x 커진 보완)
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        const chunk = symbols.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(chunk.map(async sym => {
            const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}`;
            const d = await yfRequest(url);
            return { sym, d };
        }));
        settled.forEach(s => {
            if (s.status === 'fulfilled' && s.value?.d) {
                results.set(s.value.sym, s.value.d);
            }
        });
    }
    return results;
}

function _extractEarningsItems(symbol, qs, fromTs, toTs) {
    // qs = quoteSummary response
    // 발표 날짜 후보 소스 2가지를 모두 활용:
    //   (A) calendarEvents.earnings.earningsDate — 다음 예정 발표일 (또는 임박한 1-2개)
    //   (B) earnings.earningsChart.quarterly[].reportedDate — 모든 과거 분기 실제 발표일
    //
    // 핵심 이슈: 회사가 분기 실적 발표를 마치면 (A) 의 earningsDate 는 다음 분기로 이동함.
    // 예: MSFT 가 4/29 에 보고 → calendarEvents.earningsDate = 7/29(다음 분기) →
    //     30일 윈도우 안에 안 들어와서 누락됨. (B) reportedDate=4/29 를 활용해 보완.
    try {
        const r = qs?.quoteSummary?.result?.[0];
        if (!r) return [];
        const cal = r.calendarEvents?.earnings || {};
        const hist = r.earningsHistory?.history || [];
        const quarterly = r.earnings?.earningsChart?.quarterly || [];
        const price = r.price || {};
        const name = price.longName || price.shortName || symbol;
        const nowSec = Math.floor(Date.now() / 1000);

        // ─ 후보 timestamp 수집 ──────────────────────────────
        const candidates = []; // [{ ts, source: 'cal'|'callDate'|'history', qData? }]
        // (A) calendarEvents.earningsDate — 향후 발표 예정 (또는 가장 임박한 1-2개)
        const calDates = Array.isArray(cal.earningsDate) ? cal.earningsDate
                       : (cal.earningsDate ? [cal.earningsDate] : []);
        calDates.forEach(x => {
            if (typeof x?.raw === 'number') candidates.push({ ts: x.raw, source: 'cal' });
        });
        // (A2) calendarEvents.earningsCallDate — 가장 최근 발표한 분기의 컨퍼런스 콜 날짜.
        //      회사가 막 발표한 경우 quarterly 데이터가 아직 업데이트 안 되어 있어도
        //      여기는 정확한 발표일을 갖고 있음. (예: MSFT 4/29 — earningsDate 는 7/29 로 점프했지만 callDate=4/29)
        const callDates = Array.isArray(cal.earningsCallDate) ? cal.earningsCallDate
                        : (cal.earningsCallDate ? [cal.earningsCallDate] : []);
        callDates.forEach(x => {
            if (typeof x?.raw === 'number') candidates.push({ ts: x.raw, source: 'callDate' });
        });
        // (B) earnings.earningsChart.quarterly — 모든 과거 분기 reportedDate
        quarterly.forEach(q => {
            const ts = q?.reportedDate?.raw;
            if (typeof ts === 'number') {
                candidates.push({ ts, source: 'history', qData: q });
            }
        });

        // 윈도우 [fromTs, toTs] 안에 들어오는 후보들
        const inWindow = candidates.filter(c => c.ts >= fromTs && c.ts <= toTs);
        if (!inWindow.length) return [];

        // 같은 ts 중복 제거 후, 오늘에 가장 가까운 1개 선택
        // 우선순위: history (정확한 reportedDate) > callDate > cal
        const sortedUnique = [];
        const seenTs = new Set();
        const sourcePriority = { history: 0, callDate: 1, cal: 2 };
        inWindow.sort((a, b) => {
            const pa = sourcePriority[a.source] ?? 9, pb = sourcePriority[b.source] ?? 9;
            if (pa !== pb) return pa - pb;
            return Math.abs(a.ts - nowSec) - Math.abs(b.ts - nowSec);
        });
        for (const c of inWindow) {
            if (seenTs.has(c.ts)) continue;
            seenTs.add(c.ts);
            sortedUnique.push(c);
        }
        // 그 중 today 가장 가까운 1개
        sortedUnique.sort((a, b) => Math.abs(a.ts - nowSec) - Math.abs(b.ts - nowSec));
        const picked = sortedUnique[0];
        const inRangeTs = picked.ts;
        const isPast = inRangeTs < nowSec;
        const timing = _classifyEarningsTime(inRangeTs);

        let epsEst = null, revEst = null, epsAct = null, beat = null, yoy = null;

        if (picked.source === 'history' && picked.qData) {
            // 과거 분기 발표: quarterly 데이터에서 직접 actual / estimate 추출
            epsAct = picked.qData.actual?.raw ?? null;
            epsEst = picked.qData.estimate?.raw ?? null;
            if (typeof epsAct === 'number' && typeof epsEst === 'number') {
                beat = epsAct > epsEst ? 'beat' : (epsAct < epsEst ? 'miss' : 'meet');
            }
            // YoY: 같은 fiscal quarter 직전 년도 actual 과 비교
            const fq = picked.qData.fiscalQuarter || '';
            const m = fq.match(/^(\d+Q)(\d{4})$/);
            if (m && typeof epsAct === 'number') {
                const prevYearFq = `${m[1]}${parseInt(m[2]) - 1}`;
                const prevQ = quarterly.find(qq => qq.fiscalQuarter === prevYearFq);
                const prevAct = prevQ?.actual?.raw;
                if (typeof prevAct === 'number' && prevAct !== 0) {
                    yoy = ((epsAct - prevAct) / Math.abs(prevAct)) * 100;
                }
            }
        } else {
            // 미래 발표 예정 (또는 calendarEvents 만으로 잡힌 경우):
            //   earningsAverage / revenueAverage 는 다음 분기 추정치
            epsEst = cal.earningsAverage?.raw ?? null;
            revEst = cal.revenueAverage?.raw ?? null;
            if (isPast && hist.length) {
                // calendarEvents 가 가리키는 과거 1번의 경우 — history 마지막 엔트리로 보강
                const last = hist[hist.length - 1];
                const act = last?.epsActual?.raw;
                const est = last?.epsEstimate?.raw;
                if (typeof act === 'number' && typeof est === 'number') {
                    epsAct = act;
                    beat = act > est ? 'beat' : (act < est ? 'miss' : 'meet');
                }
            }
            // YoY (예정 케이스): 4분기 전 actual 대비 epsEst 성장률
            if (typeof epsEst === 'number' && hist.length >= 4) {
                const prev = hist[hist.length - 4]?.epsActual?.raw;
                if (typeof prev === 'number' && prev !== 0) {
                    yoy = ((epsEst - prev) / Math.abs(prev)) * 100;
                }
            }
        }

        // 매출 실제값 — earnings.financialsChart.quarterly 에서 같은 fiscalQuarter 매칭
        let revAct = null;
        const finQuarterly = r.earnings?.financialsChart?.quarterly || [];
        if (picked.source === 'history' && picked.qData) {
            const targetQ = picked.qData.fiscalQuarter || picked.qData.date;
            const match = finQuarterly.find(fq => fq?.date === picked.qData.date);
            revAct = match?.revenue?.raw ?? null;
        } else if (isPast && finQuarterly.length) {
            // calendarEvents 가 가리키는 가장 최근 발표
            const last = finQuarterly[finQuarterly.length - 1];
            revAct = last?.revenue?.raw ?? null;
        }

        // 시가총액 (price.marketCap)
        const marketCap = r.price?.marketCap?.raw ?? null;

        // EPS 서프라이즈 % — 실제 vs 예상
        let surprisePct = null;
        if (typeof epsAct === 'number' && typeof epsEst === 'number' && epsEst !== 0) {
            surprisePct = ((epsAct - epsEst) / Math.abs(epsEst)) * 100;
        }

        const inSP500 = _SP500.includes(symbol);
        return [{
            symbol, name, timing,
            ts: inRangeTs,
            date: new Date(inRangeTs * 1000).toISOString().slice(0, 10),
            epsEst, epsAct, revEst, revAct, yoy, beat, marketCap, surprisePct, inSP500,
        }];
    } catch (e) {
        return [];
    }
}

const _earningsCache = new LRUMap(8);
const EARNINGS_TTL       = 6 * 60 * 60 * 1000;   // 6시간 (실적 데이터는 분 단위로 변하지 않음)
const EARNINGS_STALE_TTL = 24 * 60 * 60 * 1000;  // stale-while-revalidate: 24h 동안 stale 캐시 즉시 반환 + 백그라운드 갱신

// stale 캐시 갱신용 in-flight Promise (동일 key 동시 갱신 방지)
const _earningsRevalidating = new Map();

async function _refreshEarningsCache(key, fromTs, toTs, favs) {
    if (_earningsRevalidating.has(key)) return _earningsRevalidating.get(key);
    const promise = (async () => {
        try {
            const universe = Array.from(new Set([..._SP500, ..._NASDAQ_NYSE_EXTRAS, ...favs]));
            const qsMap = await _fetchEarningsBatch(universe);
            const data = _buildEarningsResponse(qsMap, fromTs, toTs);
            _earningsCache.set(key, { data, ts: Date.now() });
            return data;
        } finally {
            _earningsRevalidating.delete(key);
        }
    })();
    _earningsRevalidating.set(key, promise);
    return promise;
}

function _buildEarningsResponse(qsMap, fromTs, toTs) {
    const items = [];
    qsMap.forEach((qs, sym) => {
        items.push(..._extractEarningsItems(sym, qs, fromTs, toTs));
    });
    const byDate = new Map();
    items.forEach(it => {
        if (!byDate.has(it.date)) byDate.set(it.date, []);
        byDate.get(it.date).push(it);
    });
    const timingOrder = { BMO: 0, AMC: 1, TBD: 2 };
    const groups = Array.from(byDate.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, arr]) => {
            arr.sort((a, b) => {
                const d = timingOrder[a.timing] - timingOrder[b.timing];
                if (d) return d;
                return a.symbol.localeCompare(b.symbol);
            });
            const dow = ['일','월','화','수','목','금','토'][new Date(date + 'T00:00:00Z').getUTCDay()];
            return { date, dayOfWeek: dow, count: arr.length, items: arr };
        });
    return {
        window: {
            from: new Date(fromTs * 1000).toISOString().slice(0, 10),
            to:   new Date(toTs   * 1000).toISOString().slice(0, 10),
        },
        groups,
        ts: Date.now(),
    };
}

app.get('/api/earnings-calendar', async (req, res) => {
    try {
        const from = String(req.query.from || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.from : null;
        const to   = String(req.query.to   || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.to   : null;
        const favsRaw = String(req.query.favs || '').toUpperCase();
        const favs = favsRaw.split(',').map(s => s.trim()).filter(s => validSymbol(s)).slice(0, 100);

        // 기본 윈도우: 오늘 -7일 ~ +23일 (총 30일)
        const now = Date.now();
        const dayMs = 86400000;
        const fromTs = Math.floor((from ? new Date(from + 'T00:00:00Z').getTime() : (now - 7 * dayMs)) / 1000);
        const toTs   = Math.floor((to   ? new Date(to   + 'T23:59:59Z').getTime() : (now + 23 * dayMs)) / 1000);

        const key = `${fromTs}_${toTs}_${favs.sort().join(',')}`;
        const cached = _earningsCache.get(key);
        const cacheAge = cached ? Date.now() - cached.ts : Infinity;

        // Vercel Edge CDN 캐시 — 동일 URL 은 1시간 동안 CDN 에 저장됨 (인스턴스 간 공유)
        // stale-while-revalidate=86400: TTL 초과 후 24h 동안 stale 응답 즉시 반환 + 배경 갱신
        // Vary: 사용자별 favs 다르니 query 단위 캐시 분리 (URL 자체가 다르므로 자동)
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.set('CDN-Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

        // 1) Fresh 캐시 (TTL 내) → 즉시 반환
        if (cached && cacheAge < EARNINGS_TTL) {
            return res.json({ ...cached.data, cached: true });
        }
        // 2) Stale 캐시 (TTL 초과 but stale 한도 내) → 즉시 반환 + 백그라운드 갱신
        if (cached && cacheAge < EARNINGS_STALE_TTL) {
            _refreshEarningsCache(key, fromTs, toTs, favs).catch(() => {}); // fire-and-forget
            return res.json({ ...cached.data, cached: true, stale: true });
        }
        // 3) 캐시 미스 또는 너무 오래된 stale → 동기 fetch
        const universe = Array.from(new Set([..._SP500, ..._NASDAQ_NYSE_EXTRAS, ...favs]));
        const qsMap = await _fetchEarningsBatch(universe);
        const data = _buildEarningsResponse(qsMap, fromTs, toTs);
        _earningsCache.set(key, { data, ts: Date.now() });
        res.json(data);
    } catch (err) {
        console.error('[earnings-calendar]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// 푸시 알림 — 구독 / 가격 알림 CRUD / Vercel Cron 핸들러
// ═══════════════════════════════════════════════════════════════

// Supabase 클라이언트 (push 테이블용)
const _pushSupa = (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

// ── 내부 헬퍼 ──────────────────────────────────────────────────
// 심볼 검증 + 50개 단위 청크로 Yahoo quote 배치 조회
async function _fetchQuotesBatch(symbols) {
    const clean = [...new Set(symbols.map(s => String(s || '').toUpperCase()).filter(validSymbol))];
    const priceMap = {};
    for (let i = 0; i < clean.length; i += 50) {
        const chunk = clean.slice(i, i + 50);
        try {
            const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`;
            const qData = await yfRequest(url);
            (qData?.quoteResponse?.result || []).forEach(q => {
                const p = q.regularMarketPrice ?? q.currentPrice;
                if (typeof p === 'number') priceMap[q.symbol] = p;
            });
        } catch (e) {
            console.error('[_fetchQuotesBatch chunk fail]', e.message);
        }
    }
    return priceMap;
}

// 랜덤 토큰 생성 (32바이트 hex)
function _genSubToken() {
    return require('crypto').randomBytes(24).toString('hex');
}

// 구독 소유권 검증 미들웨어: body/query 의 endpoint + sub_token 이 DB row 와 일치해야 함
async function _verifyOwnership(endpoint, subToken) {
    if (!endpoint || !subToken || !_pushSupa) return false;
    const { data } = await _pushSupa.from('push_subscriptions')
        .select('sub_token').eq('endpoint', endpoint).single();
    if (!data?.sub_token) return false;
    // timing-safe compare
    try {
        const crypto = require('crypto');
        const a = Buffer.from(String(data.sub_token));
        const b = Buffer.from(String(subToken));
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
}

// ── 구독 저장/갱신 ──────────────────────────────────────────────
// 최초 구독 시 sub_token 을 생성하여 응답, 이후 모든 CRUD 는 이 토큰을 제시해야 함.
// 기존 endpoint 로 재구독하는 경우 기존 sub_token 을 재사용(로그인 세션 유사).
app.post('/api/push/subscribe', async (req, res) => {
    try {
        if (!_pushSupa) return res.status(503).json({ error: 'Supabase not configured' });
        const { subscription, favs = [] } = req.body;
        if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription.endpoint required' });

        // 기존 row 확인 → 기존 토큰 재사용, 없으면 새 토큰 발급
        const { data: existing } = await _pushSupa.from('push_subscriptions')
            .select('sub_token').eq('endpoint', subscription.endpoint).single();
        const subToken = existing?.sub_token || _genSubToken();

        const { error } = await _pushSupa.from('push_subscriptions').upsert({
            endpoint: subscription.endpoint,
            subscription,
            favs: Array.isArray(favs) ? favs.slice(0, 200) : [],
            sub_token: subToken,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'endpoint' });
        if (error) throw error;
        res.json({ ok: true, subToken });
    } catch (err) {
        console.error('[push/subscribe]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── 즐겨찾기 목록 업데이트 (별도 호출용) ───────────────────────
app.patch('/api/push/subscribe', async (req, res) => {
    try {
        if (!_pushSupa) return res.status(503).json({ error: 'Supabase not configured' });
        const { endpoint, subToken, favs = [] } = req.body;
        if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
        if (!(await _verifyOwnership(endpoint, subToken)))
            return res.status(401).json({ error: 'Unauthorized' });
        const { error } = await _pushSupa.from('push_subscriptions')
            .update({ favs: Array.isArray(favs) ? favs.slice(0, 200) : [], updated_at: new Date().toISOString() })
            .eq('endpoint', endpoint);
        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 가격 알림 등록 ──────────────────────────────────────────────
app.post('/api/push/price-alert', async (req, res) => {
    try {
        if (!_pushSupa) return res.status(503).json({ error: 'Supabase not configured' });
        const { endpoint, subToken, symbol, targetPrice, direction } = req.body;
        if (!endpoint || !symbol || targetPrice == null || !['above','below'].includes(direction))
            return res.status(400).json({ error: 'endpoint, symbol, targetPrice, direction(above|below) required' });
        if (!validSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
        const tp = Number(targetPrice);
        if (!isFinite(tp) || tp <= 0 || tp > 1_000_000)
            return res.status(400).json({ error: 'invalid targetPrice' });
        if (!(await _verifyOwnership(endpoint, subToken)))
            return res.status(401).json({ error: 'Unauthorized' });
        const { data, error } = await _pushSupa.from('price_alerts').insert({
            endpoint, symbol: symbol.toUpperCase(),
            target_price: tp, direction, active: true,
        }).select('id').single();
        if (error) throw error;
        res.json({ ok: true, id: data.id });
    } catch (err) {
        console.error('[push/price-alert POST]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── 가격 알림 목록 조회 ─────────────────────────────────────────
app.get('/api/push/price-alerts', async (req, res) => {
    try {
        if (!_pushSupa) return res.status(503).json({ error: 'Supabase not configured' });
        const endpoint = String(req.query.endpoint || '');
        const subToken = String(req.query.subToken || '');
        if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
        if (!(await _verifyOwnership(endpoint, subToken)))
            return res.status(401).json({ error: 'Unauthorized' });
        const { data, error } = await _pushSupa.from('price_alerts')
            .select('id, symbol, target_price, direction, active, triggered_at, created_at')
            .eq('endpoint', endpoint).eq('active', true).order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ alerts: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 가격 알림 삭제 ──────────────────────────────────────────────
app.delete('/api/push/price-alert/:id', async (req, res) => {
    try {
        if (!_pushSupa) return res.status(503).json({ error: 'Supabase not configured' });
        const { id } = req.params;
        const endpoint = String(req.query.endpoint || req.body?.endpoint || '');
        const subToken = String(req.query.subToken || req.body?.subToken || '');
        if (!(await _verifyOwnership(endpoint, subToken)))
            return res.status(401).json({ error: 'Unauthorized' });
        // 삭제는 본인 소유 alert 에 한정
        const { error } = await _pushSupa.from('price_alerts')
            .update({ active: false }).eq('id', id).eq('endpoint', endpoint);
        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Cron 인증 미들웨어 ──────────────────────────────────────────
// Vercel Cron 은 프로젝트에 CRON_SECRET env 가 설정돼 있으면 자동으로
// `Authorization: Bearer ${CRON_SECRET}` 헤더를 붙여 요청을 보냄.
// → Bearer 토큰 검증만 수행. 임의 헤더(x-vercel-signature) 존재 여부로
//    통과시키면 누구나 우회 가능하므로 절대 금지.
function cronAuth(req, res, next) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        // 시크릿 미설정 시 보안 사고 방지를 위해 503 (개발 중엔 env 설정 필요)
        return res.status(503).json({ error: 'CRON_SECRET not configured' });
    }
    const auth = req.headers.authorization || '';
    const expected = `Bearer ${secret}`;
    // timing-safe compare
    try {
        const crypto = require('crypto');
        const a = Buffer.from(auth);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    } catch {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ── Cron: 가격 알림 체크 (매 5분, 미장 시간) ────────────────────
app.get('/api/cron/check-alerts', cronAuth, async (req, res) => {
    if (!_pushSupa) return res.json({ ok: false, reason: 'no supabase' });
    try {
        // 1) active 알림 전체 조회
        const { data: alerts, error: aErr } = await _pushSupa.from('price_alerts')
            .select('id, endpoint, symbol, target_price, direction, triggered_at')
            .eq('active', true);
        if (aErr) throw aErr;
        if (!alerts?.length) return res.json({ ok: true, checked: 0 });

        // 2) 가격 배치 조회 (50개 단위 청크, 내부 헬퍼 재사용)
        const symbols = [...new Set(alerts.map(a => a.symbol))];
        const priceMap = await _fetchQuotesBatch(symbols);

        // 3) 조건 평가 (DB 호출 없이 메모리 내)
        const now = Date.now();
        const COOLDOWN = 24 * 60 * 60 * 1000; // 24h
        const candidates = alerts.filter(alert => {
            const price = priceMap[alert.symbol];
            if (price == null) return false;
            if (alert.triggered_at && now - new Date(alert.triggered_at).getTime() < COOLDOWN) return false;
            return alert.direction === 'above'
                ? price >= alert.target_price
                : price <= alert.target_price;
        });
        if (!candidates.length) return res.json({ ok: true, checked: alerts.length, triggered: 0 });

        // 4) 구독 정보 일괄 조회 (단일 쿼리, .in(...))
        const uniqueEndpoints = [...new Set(candidates.map(a => a.endpoint))];
        const { data: subRows } = await _pushSupa.from('push_subscriptions')
            .select('endpoint, subscription')
            .in('endpoint', uniqueEndpoints);
        const subMap = Object.fromEntries((subRows || []).map(r => [r.endpoint, r.subscription]));

        // 5) 병렬 발송 + 결과 집계
        const expiredEndpoints = new Set();
        const triggeredIds = [];
        await Promise.all(candidates.map(async alert => {
            const subscription = subMap[alert.endpoint];
            if (!subscription) return;
            const price = priceMap[alert.symbol];
            const dir = alert.direction === 'above' ? '↑ 목표가 도달' : '↓ 목표가 도달';
            const payload = JSON.stringify({
                title: `📈 ${alert.symbol} ${dir}`,
                body: `현재가 $${price.toFixed(2)} · 목표가 $${Number(alert.target_price).toFixed(2)}`,
                url: `/?s=${alert.symbol}`,
                tag: `price-${alert.symbol}`,
            });
            try {
                await webpush.sendNotification(subscription, payload);
                triggeredIds.push(alert.id);
            } catch (e) {
                console.error('[cron/check-alerts] send fail', e.statusCode, e.message);
                if (e.statusCode === 410 || e.statusCode === 404) {
                    expiredEndpoints.add(alert.endpoint);
                }
            }
        }));

        // 6) DB 업데이트 (배치)
        if (triggeredIds.length) {
            await _pushSupa.from('price_alerts')
                .update({ triggered_at: new Date().toISOString() })
                .in('id', triggeredIds);
        }
        if (expiredEndpoints.size) {
            const arr = [...expiredEndpoints];
            await Promise.all([
                _pushSupa.from('push_subscriptions').delete().in('endpoint', arr),
                _pushSupa.from('price_alerts').update({ active: false }).in('endpoint', arr),
            ]);
        }

        res.json({
            ok: true,
            checked: alerts.length,
            triggered: triggeredIds.length,
            expired: expiredEndpoints.size,
        });
    } catch(err) {
        console.error('[cron/check-alerts]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── "내일 실적 발표 종목" 일자별 캐시 (모듈 스코프) ─────────────
// 같은 날짜(UTC)에 대해 한 번만 S&P500 배치 fetch → 동일 일자 내 재실행은 캐시 사용.
// Vercel 서버리스는 인스턴스가 warm 일 동안만 유지되지만, 동일 인스턴스에서 재호출
// 또는 디버그용 재호출 시 Yahoo 부하를 줄임.
let _tomorrowEarningsCache = { date: null, symbols: null };

async function _getTomorrowEarningsSymbols(tDate) {
    if (_tomorrowEarningsCache.date === tDate && _tomorrowEarningsCache.symbols) {
        return _tomorrowEarningsCache.symbols;
    }
    const fromTs = Math.floor(new Date(tDate + 'T00:00:00Z').getTime() / 1000);
    const toTs   = Math.floor(new Date(tDate + 'T23:59:59Z').getTime() / 1000);
    let qsMap;
    try {
        qsMap = await _fetchEarningsBatch([..._SP500, ..._NASDAQ_NYSE_EXTRAS]);
    } catch (e) {
        console.error('[earnings-reminder] fetch batch fail', e.message);
        return new Set();
    }
    const syms = new Set();
    qsMap.forEach((qs, sym) => {
        if (_extractEarningsItems(sym, qs, fromTs, toTs).length) syms.add(sym);
    });
    _tomorrowEarningsCache = { date: tDate, symbols: syms };
    return syms;
}

// ── Cron: 실적 발표 전날 리마인더 (매일 00:00 UTC) ──────────────
app.get('/api/cron/earnings-reminder', cronAuth, async (req, res) => {
    if (!_pushSupa) return res.json({ ok: false, reason: 'no supabase' });
    try {
        // 내일 날짜 계산 (UTC)
        const tomorrow = new Date(Date.now() + 86400000);
        const tDate = tomorrow.toISOString().slice(0, 10);

        // 1) 구독 목록 전체
        const { data: subs, error: sErr } = await _pushSupa.from('push_subscriptions')
            .select('endpoint, subscription, favs');
        if (sErr) throw sErr;
        if (!subs?.length) return res.json({ ok: true, sent: 0 });

        // 2) 내일 실적 발표 종목 (캐시 사용)
        const tomorrowSyms = await _getTomorrowEarningsSymbols(tDate);
        if (!tomorrowSyms.size) return res.json({ ok: true, sent: 0, reason: 'no earnings tomorrow' });

        // 3) 구독자별 favs 교집합 확인 후 병렬 전송
        const expiredEndpoints = new Set();
        const results = await Promise.all(subs.map(async sub => {
            const hits = (sub.favs || []).filter(s => tomorrowSyms.has(s));
            if (!hits.length) return 0;
            const payload = JSON.stringify({
                title: '📊 내일 실적 발표 예정',
                body: `즐겨찾기 종목 실적: ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ` 외 ${hits.length-8}개` : ''}`,
                url: '/earnings',
                tag: 'earnings-reminder',
            });
            try {
                await webpush.sendNotification(sub.subscription, payload);
                return 1;
            } catch (e) {
                if (e.statusCode === 410 || e.statusCode === 404) {
                    expiredEndpoints.add(sub.endpoint);
                }
                return 0;
            }
        }));
        const sent = results.reduce((a, b) => a + b, 0);

        // 만료 구독 정리 (배치)
        if (expiredEndpoints.size) {
            const arr = [...expiredEndpoints];
            await Promise.all([
                _pushSupa.from('push_subscriptions').delete().in('endpoint', arr),
                _pushSupa.from('price_alerts').update({ active: false }).in('endpoint', arr),
            ]);
        }

        res.json({
            ok: true,
            sent,
            expired: expiredEndpoints.size,
            tomorrowEarnings: [...tomorrowSyms].slice(0, 20),
            cached: _tomorrowEarningsCache.date === tDate,
        });
    } catch(err) {
        console.error('[cron/earnings-reminder]', err.message);
        res.status(500).json({ error: err.message });
    }
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
function logEnvStatus() {
    const keys = [
        ['YOUTUBE_API_KEY',   process.env.YOUTUBE_API_KEY],
        ['GEMINI_API_KEY',    process.env.GEMINI_API_KEY],
        ['SUPABASE_URL',      process.env.SUPABASE_URL],
        ['ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY],
    ];
    console.log('\n🔑 환경변수 상태:');
    keys.forEach(([name, val]) => {
        console.log(`  ${val ? '✅' : '❌'} ${name}${val ? ' (set)' : ' (missing!)'}`);
    });
    console.log('');
}

if (require.main === module) {
    // 로컬 실행
    app.listen(PORT, () => {
        console.log(`\n🚀 StockAI Server  →  http://localhost:${PORT}`);
        console.log(`📡 Health check    →  http://localhost:${PORT}/health`);
        logEnvStatus();
        getCrumb().catch(err => console.error('⚠️  Initial crumb fetch 실패:', err.message));
    });
} else {
    // Vercel 서버리스: cold start 시 crumb 미리 발급
    logEnvStatus();
    getCrumb().catch(() => {});
}

module.exports = app;
