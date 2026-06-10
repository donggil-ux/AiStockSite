// js/state.js
// 책임: 앱 전역 공유 상태 변수 (window 프로퍼티로 노출)
// 의존: 없음 (가장 먼저 로드됨)
// 주의: 이 파일의 변수들은 window.xxx 로 선언되어 모든 파일에서 접근 가능


    // ════════════════════════════════════════════════════════════
    //  자체 에러 추적 — window.onerror + unhandledrejection 자동 보고
    //  rate limit + sampling 으로 폭주 방지
    // ════════════════════════════════════════════════════════════
    (function _initErrorReporter() {
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (isLocal) return; // 로컬은 콘솔만
        let _lastErrTs = 0;
        const _seen = new Set();      // fingerprint dedupe (세션 내)
        const _SAMPLE = 0.3;          // 30% 만 보고 (트래픽 부담 ↓)
        function _fingerprint(msg, src) {
            const key = String(src || '') + ':' + String(msg || '').slice(0, 100);
            return key;
        }
        async function reportError(info) {
            try {
                // rate: 5초당 1회
                const now = Date.now();
                if (now - _lastErrTs < 5000) return;
                _lastErrTs = now;
                // dedupe: 같은 fingerprint 세션 내 1회만
                const fp = _fingerprint(info.message, info.source);
                if (_seen.has(fp)) return;
                _seen.add(fp);
                // sampling
                if (Math.random() > _SAMPLE) return;
                // 전송 (실패해도 무시 — 무한루프 방지)
                const subToken = (() => { try { return localStorage.getItem('stockai_push_token') || null; } catch { return null; } })();
                const base = window.API_WORKERS_BASE || '';
                await fetch(base + '/api/errors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source: 'client',
                        severity: info.severity || 'error',
                        message: info.message || 'unknown',
                        stack: info.stack || null,
                        context: {
                            url: location.pathname + location.search,
                            tz: -new Date().getTimezoneOffset(),
                            symbol: window.currentSymbol || null,
                        },
                        sub_token: subToken,
                    }),
                    // 직접 origFetch 호출 (state.js 의 라우팅 인터셉터를 거치지 않음 — 무한루프 방지)
                });
            } catch (_) {}
        }
        window.addEventListener('error', (e) => {
            // script load 에러도 잡힘 — message 비어있으면 스킵
            if (!e.message && !e.error) return;
            reportError({
                message: e.message || e.error?.message || 'window.error',
                stack: e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`,
                severity: 'error',
            });
        });
        window.addEventListener('unhandledrejection', (e) => {
            const r = e.reason;
            reportError({
                message: r?.message || String(r || 'unhandled rejection').slice(0, 200),
                stack: r?.stack || null,
                severity: 'error',
            });
        });
        // 디버깅용 수동 호출
        window._reportError = reportError;
    })();

    // ════════════════════════════════════════════════════════════
    //  Workers 백엔드 라우팅 (Vercel + Cloudflare Workers 하이브리드)
    //  지정 prefix 의 API 호출만 Workers 로, 나머지는 Vercel(같은 origin) 그대로.
    //  로컬 개발(localhost) 에서는 라우팅 비활성 → Express server.js 호출.
    // ════════════════════════════════════════════════════════════
    (function _initWorkersRouting() {
        const WORKERS_BASE = 'https://stockai-api.rkd687.workers.dev';
        const WORKERS_PREFIXES = [
            '/api/health',
            '/api/chart/',
            '/api/quote',
            '/api/price/',
            '/api/summary/',
            '/api/search',
            '/api/polygon/',
            '/api/push/',
            '/api/stats/',
            '/api/signals/',
            '/api/errors',
            '/api/admin/',
            '/api/translate',
            '/api/news-reason',
            '/api/earnings-summary',
            '/api/calibration/',
            '/api/scanner/daily-', // 데일리 트레이딩 스캐너·백테스트·라이브통계 (Workers 전용)
            // ── AI 라우트 (Workers, Gemini REST API) ──
            '/api/scanner/ai-',     // ai-analyze, ai-batch
            '/api/swing/ai-',
            '/api/social/ai-',
            '/api/catalyst/ai-',
            '/api/catalyst/livestats', // 카탈리스트 forward-test 통계 (Workers — hunter는 Express 유지)
        ];
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        // Workers 전용 엔드포인트 — Express(server.js)에 구현이 없어 로컬에서도 반드시 Workers 로 보내야 함.
        // (이게 없으면 로컬에서 /api/stats 등이 Express SPA HTML 을 받아 "Unexpected token '<'" 로 깨짐)
        const WORKERS_ONLY = [
            '/api/stats/', '/api/signals/', '/api/admin/', '/api/calibration/', '/api/errors',
            '/api/scanner/daily-', '/api/catalyst/livestats',
        ];
        window.API_WORKERS_BASE = WORKERS_BASE;
        // Clerk 세션 토큰 게터 (auth.js 가 채워줌). 비로그인이면 null 반환.
        window.getAuthToken = window.getAuthToken || (async () => null);
        // 로컬: Workers 전용 엔드포인트만 라우팅 / 프로덕션: 전체 WORKERS_PREFIXES 라우팅
        const ACTIVE_PREFIXES = isLocal ? WORKERS_ONLY : WORKERS_PREFIXES;
        const origFetch = window.fetch.bind(window);
        window.fetch = async function (input, init) {
            try {
                let url = (typeof input === 'string') ? input
                        : (input instanceof Request) ? input.url
                        : String(input);
                if (url.startsWith('/api/')) {
                    const match = ACTIVE_PREFIXES.some(p => url.startsWith(p));
                    if (match) {
                        const newUrl = WORKERS_BASE + url;
                        // Clerk 세션 토큰 자동 주입 (있을 때만)
                        let token = null;
                        try { token = await window.getAuthToken(); } catch (_) {}
                        if (typeof input === 'string') {
                            input = newUrl;
                            if (token) {
                                init = init || {};
                                const h = new Headers(init.headers || {});
                                if (!h.has('Authorization')) h.set('Authorization', `Bearer ${token}`);
                                init.headers = h;
                            }
                        } else if (input instanceof Request) {
                            const r = input;
                            const h = new Headers(r.headers);
                            if (token && !h.has('Authorization')) h.set('Authorization', `Bearer ${token}`);
                            input = new Request(newUrl, {
                                method: r.method, headers: h, body: r.body,
                                mode: r.mode, credentials: r.credentials, cache: r.cache,
                                redirect: r.redirect, referrer: r.referrer, integrity: r.integrity,
                            });
                        } else {
                            input = newUrl;
                            if (token) {
                                init = init || {};
                                const h = new Headers(init.headers || {});
                                if (!h.has('Authorization')) h.set('Authorization', `Bearer ${token}`);
                                init.headers = h;
                            }
                        }
                    }
                }
            } catch (_) {}
            return origFetch(input, init);
        };
    })();

    // ========================================
    // State
    // ========================================
    window.currentMarket = 'US';
    window.currentPeriod = localStorage.getItem('stockai_chart_period')   || '6mo';
    window.currentInterval = localStorage.getItem('stockai_chart_interval') || '1d';
    // ── Guard: Yahoo Finance는 interval=1m/2m/5m/15m/30m/60m/90m/1h가 long range와 호환 안 됨 → 422 반환
    // 저장된 interval/range 조합이 불법이면 안전값으로 리셋
    (function _sanitizeChartPrefs() {
        const SHORT_INTERVALS = new Set(['1m','2m','5m','15m','30m','60m','90m','1h']);
        const LONG_RANGES     = new Set(['1mo','3mo','6mo','1y','2y','5y','10y','ytd','max']);
        if (SHORT_INTERVALS.has(currentInterval) && LONG_RANGES.has(currentPeriod)) {
            // warn()은 utils.js에 정의되어 있어 state.js 실행 시점엔 아직 없음 → console.warn 직접 사용
            console.warn('[chart-prefs] 불법 조합 감지 — 리셋:', currentPeriod, currentInterval);
            currentPeriod = '6mo';
            currentInterval = '1d';
            try {
                localStorage.setItem('stockai_chart_period', currentPeriod);
                localStorage.setItem('stockai_chart_interval', currentInterval);
            } catch {}
        }
    })();
    window.currentSymbol = '';
    window._historySkip = false; // popstate 중 searchStock 재호출 시 중복 pushState 방지
    window.currentFullSymbol = '';  // Yahoo Finance용 풀 심볼 (예: NVDA, 005930.KS)
    window.liveUpdateTimer = null;  // 실시간 가격 업데이트 타이머 (30초)
    window.analysisRefreshTimer = null;  // 분석 자동 갱신 타이머 (5분)
    window.chartSigPollTimer = null;  // 차트 시그널 폴링 타이머 (60초)
    window._pollLastChartTs = 0;      // 마지막으로 렌더된 캔들 타임스탬프 (실시간 갱신용)
    window._xcCells = {};              // Phase X1-b: 셀별 차트 인스턴스 레지스트리
    window._xcActiveCellId = 'cell1';    // 현재 활성 셀 ID
    // Phase X3: 멀티차트 동기화 설정 (localStorage에서 복원)
    window._xcSyncTimeScale = false;     // X3a: 시간축 동기화
    window._xcSyncCrosshair = false;     // X3b: 십자선 동기화
    window._xcSyncSymbol = false;     // X3c: 종목 동기화
    window._xcCrosshairSyncLast = 0;    // X3b throttle
    (function _xcLoadSyncPrefs() {
        try {
            const s = JSON.parse(localStorage.getItem('stockai_xc_sync') || '{}');
            _xcSyncTimeScale = !!s.timeScale;
            _xcSyncCrosshair = !!s.crosshair;
            _xcSyncSymbol    = !!s.symbol;
        } catch(_) {}
    })();
    window._lastSigKey = null;  // 마지막 시그널 식별자 (symbol:time:pos:text)
    window._lastPosAlertKey = '';    // 중복 포지션 알림 억제 (headline 기준 5분 쿨다운)
    window._lastPosAlertTime = 0;
    window._SIG_HISTORY_MAX = 100;
    window._sigHistory = JSON.parse(localStorage.getItem('stockai_sig_history') || '[]');
    window.rsiChart = null;
    window.macdChart = null;
    window.adxChart = null;
    window.obvChart = null;
    window.stockData = null;

    // Lightweight Charts 인스턴스
    window.lwChart = null;
    window.lwCandleSeries = null;
    // 차트 타입(캔들/라인/영역) — 라인·영역 오버레이 series (캔들 투명화 방식)
    window.lwLineOverlay = null;
    window.lwAreaOverlay = null;
    // 종목비교 오버레이 상태 (최대 3개 동시 비교)
    window._cmpItems = [];       // [{sym, series, color, chgPct}]
    window.lwVolumeSeries = null;
    window.lwMaSeries = {};       // { ma5, ma20, ma70 }
    window.lwBbUpper = null;
    window.lwBbLower = null;
    window.lwBbMiddle = null;
    // VWAP 시리즈 (5분봉 전용 — Kullamägi 기준선)
    window.lwVwap = null;
    window.lwVwapUpper = null;
    window.lwVwapLower = null;
    window.lwStochK = null;    // Stochastic %K series
    window.lwStochD = null;    // Stochastic %D series
    window.lwOBVSeries = null; // OBV series
    window._chartVwapEnabled = localStorage.getItem('stockai_chart_vwap') === '1'; // 기본 OFF — 사용자가 켤 때만 '1' 저장
    // Phase A2 — 보조지표 패널 state
    window._indConfig = null;   // 보조지표 설정 (localStorage: stockai_ind_config)
    window._indSelectedKey = null;   // 현재 선택된 지표 키 ('ema'|'bb'|'vwap'|'volume')
    window._indDebounceTimer = null;   // 기간/색상 변경 debounce (200ms)
    window.lwAiPriceLines = [];        // AI 지지/저항선 (createPriceLine refs)
    window.lwAiTrendSeries = [];       // AI 추세선 legacy (사용 안함, 하위호환)
    window.lwAiCanvasTrendlines = [];  // AI 추세선 (canvas Ray 방식, 1000×1000 좌표)
    window.lwClientTrendlines = [];    // 클라이언트 계산 스윙 추세선 {time1,price1,time2,price2,type,label,color}
    window.lwAiLastData = null;        // 마지막 AI 분석 결과 (차트 재렌더 후 복원용)
    window.selectedAiTrendlineIdx = -1; // 현재 선택된 AI 추세선 인덱스

    // [Fix-B] localStorage AI 분석 헬퍼 — 5곳에 흩어진 중복 try/catch 패턴 통합
    window._AI_LS_PREFIX = 'stockai_ai_';
    function _aiLsSave(symbol, data) {
        if (!symbol) return;
        try { localStorage.setItem(_AI_LS_PREFIX + symbol, JSON.stringify(data)); } catch(e) {}
    }
    function _aiLsLoad(symbol) {
        try {
            const raw = JSON.parse(localStorage.getItem(_AI_LS_PREFIX + symbol));
            if (!raw) return null;
            // 마이그레이션: 옛 스키마(levels/trendlines)는 무효 처리 — 테스타 신호 카드와 호환 안 됨
            if (!raw.signal && (Array.isArray(raw.levels) || Array.isArray(raw.trendlines))) {
                _aiLsRemove(symbol);
                return null;
            }
            return raw;
        } catch(e) { return null; }
    }
    function _aiLsRemove(symbol) {
        try { localStorage.removeItem(_AI_LS_PREFIX + symbol); } catch(e) {}
    }


    window._searchFallbackToken = 0;

    window._ROUTE_VIEWS = {
        home: () => goHome(),
        smartmoney: () => goSmartMoney(),
        scanner: () => goScanner(),
        earnings: () => goEarnings(),
        leverage: () => goLeverage(),
        vision: () => goVisionScanner(),
        economic: () => goEconomic(),
    };

    window._VIEW_TITLES = {
        home:       'StockAI — 주식 종목 분석',
        smartmoney: '기관 포트폴리오 — StockAI',
        scanner:    '알파 스캐너 — StockAI',
        earnings:   '실적발표 일정 — StockAI',
        leverage:   '레버리지 ETF — StockAI',
        vision:     'AI 차트 판독기 — StockAI',
        economic:   '경제지표 — StockAI',
    };

    window.API_BASE = '';

    window.INTERVAL_AGG = {
        '1m':  { yahoo: '1m',  factor: 1 },
        '3m':  { yahoo: '1m',  factor: 3 },   // 1분 × 3봉 = 3분봉
        '5m':  { yahoo: '5m',  factor: 1 },
        '10m': { yahoo: '5m',  factor: 2 },   // 5분 × 2봉 = 10분봉
        '15m': { yahoo: '15m', factor: 1 },
        '30m': { yahoo: '30m', factor: 1 },
        '60m': { yahoo: '60m', factor: 1 },
        '120m':{ yahoo: '60m', factor: 2 },   // 60분 × 2봉 = 120분봉
        '240m':{ yahoo: '60m', factor: 4 },   // 60분 × 4봉 = 240분봉
        '1h':  { yahoo: '1h',  factor: 1 },   // 하위호환
        '1d':  { yahoo: '1d',  factor: 1 },
        '1wk': { yahoo: '1wk', factor: 1 },
        '1mo': { yahoo: '1mo', factor: 1 },
        '1y':  { yahoo: '1mo', factor: 12 },  // 월 × 12 = 년봉
    };

    // 인터벌별 표기 라벨 (드롭다운 + 활성 상태용)
    window.INTERVAL_LABELS = {
        '1m':'1분','3m':'3분','5m':'5분','10m':'10분','15m':'15분','30m':'30분','60m':'60분','1h':'60분',
        '120m':'120분','240m':'240분',
        '1d':'일','1wk':'주','1mo':'월','1y':'년',
    };

    // 봉 타입별 기본 기간 — 인터벌별로 한눈에 의미 있는 데이터 양을 자동 적용
    // (기간 UI를 숨겼기 때문에 기본값이 곧 사용자 경험 — 충분한 과거 데이터 확보)
    window.INTERVAL_RANGES = {
        '1m':  { allowed: ['1d','5d'],            defaultRange: '1d' },   // 1분 × 1d ≈ 390봉
        '3m':  { allowed: ['1d','5d'],            defaultRange: '5d' },   // 3분 → 1분 × 3 집계
        '5m':  { allowed: ['1d','5d'],            defaultRange: '5d' },   // 5d ≈ 390봉
        '10m': { allowed: ['1d','5d','1mo'],      defaultRange: '1mo' },  // 10분 → 5분 × 2 집계
        '15m': { allowed: ['5d','1mo'],           defaultRange: '1mo' },
        '30m': { allowed: ['5d','1mo','3mo'],     defaultRange: '1mo' },
        '60m': { allowed: ['1mo','3mo','6mo'],    defaultRange: '3mo' },
        '120m':{ allowed: ['3mo','6mo','1y'],     defaultRange: '6mo' },  // 60분 × 2 집계
        '240m':{ allowed: ['6mo','1y','5y'],      defaultRange: '1y' },   // 60분 × 4 집계
        '1h':  { allowed: ['1mo','3mo','6mo'],    defaultRange: '3mo' },  // 하위호환
        '1d':  { allowed: ['6mo','1y','5y'],      defaultRange: '1y' },   // 일봉 1년치 — 이전엔 6mo
        '1wk': { allowed: ['1y','5y','max'],      defaultRange: '5y' },   // 주봉 5년치 — 이전엔 1y
        '1mo': { allowed: ['5y','max'],           defaultRange: 'max' },  // 월봉 전체 — 이전엔 5y
        '1y':  { allowed: ['max'],                defaultRange: 'max' },  // 년봉 → 월 × 12 집계
    };

    // Alpha Scanner 상태
    // ========================================
    window.scannerFilters = { rr: null, optionSentiment: [], smartMoney: [] };
    window.scannerPreset = null;
    window.scannerResults = [];
    window.scannerLoading = false;
    window._scannerDebounceTimer = null;
    window._alphaHomeTab = 'bounce'; // ← 상단 선언 (loadAlphaHomePreview TDZ 방지)
    // 알파 홈 캐시 — loadAlphaHomePreview 호출 전에 반드시 선언 (TDZ 방지)
    window._alphaHomeCache = {};
    window._alphaHomeRetry = {};
    window._ALPHA_HOME_TTL = 5 * 60 * 1000;
    window._ALPHA_CACHE_VERSION = 'v3';
    try {
        if (sessionStorage.getItem('_alphaCacheVersion') !== _ALPHA_CACHE_VERSION) {
            sessionStorage.setItem('_alphaCacheVersion', _ALPHA_CACHE_VERSION);
            console.log('[alphaHome] 캐시 버전 변경 →', _ALPHA_CACHE_VERSION);
        }
    } catch(e) {}
    // 상장폐지 필터용 캐시: { ticker → { valid: bool, ts: number } }
    window._scannerTickerValid = {};
    window._TICKER_VALID_TTL = 60 * 60 * 1000; // 1시간


    // US Top 100 Stocks (optimized)
    // ========================================
    window.top100Cache = {};
    window.top100Filter = 'most_actives';
    window.TOP100_CACHE_MS = 180000; // 3분
    window.TOP100_LS_KEY = 'top100_cache';
    window.TOP100_FILTERS = ['most_actives','day_gainers','day_losers'];

    // localStorage에서 캐시 복원 (즉시 렌더용)
    try {
        const saved = JSON.parse(localStorage.getItem(TOP100_LS_KEY));
        if (saved && typeof saved === 'object') {
            for (const k of TOP100_FILTERS) {
                if (saved[k]?.items?.length && Date.now() - saved[k].ts < TOP100_CACHE_MS) {
                    top100Cache[k] = saved[k];
                }
            }
        }
    } catch(e) {}

    window._top100AllItems = [];
    window._TOP100_INITIAL_LIMIT = 30;

    // 거래량 포맷터 (renderTop100 / showMoreTop100 공유)

    // Smart Money Tracker
    // ========================================
    window.pendingSmartMoneyLine = null;
    window.smCurrentFilter = 'all';


    // 현재 딥다이브 모드 ('hot' | 'kingdom')
    window.smDeepMode = 'hot';


    window._alphaTab = 'bounce';

    // ── 과매도 탭 필터 — 거래대금·시총 (v689) ───────────────────
    // 거래대금: all / mid($5M+) / high($20M+) · 시총: all / mid($300M+) / high($2B+)
    window._BOUNCE_VOL_TH = { mid: 5e6,  high: 20e6 };
    window._BOUNCE_MCAP_TH = { mid: 3e8,  high: 2e9  };
    window._bounceVolFilter = (() => { try { return localStorage.getItem('bounceVolFilter')  || 'mid'; } catch(e) { return 'mid'; } })();
    window._bounceMcapFilter = (() => { try { return localStorage.getItem('bounceMcapFilter') || 'mid'; } catch(e) { return 'mid'; } })();
    window._bounceAllResults = [];


    window._ALPHA_AI_TABS = new Set(['bounce', 'swing', 'sepa', 'daytrade']);
    window._alphaVerdictFilter = (() => { try { return localStorage.getItem('alphaVerdictFilter') || 'all'; } catch(e) { return 'all'; } })();


    window.THEME_LS = 'stockai_theme';


    window._aiCooldownActive = false;
    window._aiCooldownIv = null;

    window._optionsSymbol = '';
    window._optionsAllCalls = [];
    window._optionsAllPuts = [];
    window._optionsCurrentPrice = 0;
    window._optionsFilter = 'all';
    window._optionsStrikeRange = 'all'; // 'all' | '5' | '10' | '20'
    window._optionsVolOnly = false;
    window._optionsSortCol = null;      // null | 'strike' | 'volume' | 'oi' | 'iv'
    window._optionsSortDir = 'asc';
    window._optionsExpDates = [];

    window._socialCache = {};
    window.SOCIAL_CACHE_MS = 5 * 60 * 1000;

    // KR 심볼 판정 — 6자리 숫자 + 옵션 .KS / .KQ
    function _isKrSymbol(sym) { return /^\d{6}(\.K[SQ])?$/i.test(String(sym || '')); }

    // 활성 소셜 소스 ('stocktwits' | 'naver' | 'paxnet') — 기본은 시장에 맞춤, 사용자가 chip 으로 토글
    window._socialActiveSrc = 'stocktwits';
    // 종목별 로드 완료된 소스 추적 (재진입 시 중복 fetch 방지)
    window._socialLoaded = { stocktwits: '', naver: '', paxnet: '' };

    window.VS_ACCEPTED = ['image/png','image/jpeg','image/webp','image/gif'];
    window.VS_MAX_MB = 20;
    window._vsFile = null;   // 현재 파일
    window._vsObjectURL = null;   // 현재 object URL
    window._vsNaturalW = 0;
    window._vsNaturalH = 0;
    window._vsHoveredIdx = null;
    window._vsZones = [];
    window._vsDragCounter = 0;      // drag flicker 방지
    window._vsScanTimer = null;
    window._vsStepTimer = null;
    window._vsRafId = null;
    window._vsApiResult = null;   // 실제 API 응답 저장

    // ── Mock 분석 결과 (Phase 1) ─────────────────────────────────
    // yRatio/hRatio: 이미지 높이에 대한 비율 (0~1)
    window.VS_MOCK_ZONES = [
        { type:'resistance', xRatio:0, yRatio:.12, wRatio:1, hRatio:.026, label:'저항 구간 A', strength:.9  },
        { type:'resistance', xRatio:0, yRatio:.27, wRatio:1, hRatio:.018, label:'저항 구간 B', strength:.6  },
        { type:'support',    xRatio:0, yRatio:.61, wRatio:1, hRatio:.024, label:'지지 구간 A', strength:.85 },
        { type:'support',    xRatio:0, yRatio:.76, wRatio:1, hRatio:.016, label:'지지 구간 B', strength:.5  },
        { type:'support',    xRatio:0, yRatio:.89, wRatio:1, hRatio:.033, label:'지지 구간 C', strength:1  },
    ];

    window.VS_MOCK_REPORT = `## 🔬 데모 분석 결과 안내
현재는 **AI API 연결 전 테스트 단계**입니다. 화면에 표시된 지지·저항 구간 위치와 가격은 **실제 차트 데이터와 무관한 샘플**입니다.

## ✅ 정식 서비스 시 제공 내용
- **실제 가격 기반** 지지·저항 구간 자동 탐지 (차트 이미지 분석)
- 업로드한 차트의 **통화(KRW / USD 등) 자동 인식**
- 캔들 패턴·거래량 프로파일 기반 **매물대 강도 계산**
- 진입가·손절가·목표가 포함 **AI 매매 전략 리포트**

## 🛠 현재 테스트 가능 항목
- 이미지 **드래그앤드롭 / 클릭 업로드 / Ctrl+V** 붙여넣기
- 레이저 **스캐닝 애니메이션** 및 로딩 흐름
- 캔버스 위 **구간 박스 렌더링** 및 마우스 호버 인터랙션
- **AI 분석 리포트** 레이아웃 및 마크다운 렌더링

> 💡 AI API 연결 후 이 리포트가 실제 차트 분석 결과로 교체됩니다.`;
