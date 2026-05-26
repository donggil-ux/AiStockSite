// js/app.js
// 책임: 앱 엔트리 포인트 및 초기화
// 의존: 모든 다른 js 파일 (가장 마지막에 로드)

    // ── _debMobSearch + _debouncedSuggest (debounce 호출 결과) ──

    window._debMobSearch = debounce(async q => {
        if (!q.trim()) { _renderMobDropdown('empty', null); return; }
        const local = searchSuggest(q, 10);
        if (local.length > 0) { _renderMobDropdown('results', local); return; }
        // 정적 목록에 없으면 Yahoo Finance 검색 API 폴백 (stale 응답 방지 토큰)
        const myToken = ++_searchFallbackToken;
        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            if (myToken !== _searchFallbackToken) return; // 더 최신 쿼리가 있으면 폐기
            const items = await resp.json();
            const mapped = items.map(it => ({
                ticker: it.ticker, name: it.name, koreanName: it.name,
                market: 'US', type: it.quoteType === 'ETF' ? 'etf' : 'stock',
                sector: it.exchange || 'US', score: 50,
            }));
            _renderMobDropdown('results', mapped);
        } catch {
            if (myToken === _searchFallbackToken) _renderMobDropdown('results', []);
        }
    }, 300);

    window._debouncedSuggest = debounce(async query => {
        if (!query.trim()) { renderDropdown('empty', null); return; }
        const local = searchSuggest(query, 8);
        if (local.length > 0) { renderDropdown('results', local); return; }
        // 정적 목록에 없으면 Yahoo Finance 검색 API 폴백 (stale 응답 방지 토큰)
        const myToken = ++_searchFallbackToken;
        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            if (myToken !== _searchFallbackToken) return;
            const items = await resp.json();
            const mapped = items.map(it => ({
                ticker: it.ticker, name: it.name, koreanName: it.name,
                market: 'US', type: it.quoteType === 'ETF' ? 'etf' : 'stock',
                sector: it.exchange || 'US', score: 50,
            }));
            renderDropdown('results', mapped);
        } catch {
            if (myToken === _searchFallbackToken) renderDropdown('results', []);
        }
    }, 300);

    // ── 사이드 내비 초기화 ──

    try { localStorage.removeItem('navCollapsed'); } catch(e){}
    document.body.classList.remove('nav-collapsed');
    // [Fix-B] window 노출 — HTML onclick="closeSideNav()" 처리용 (addEventListener 이중 바인딩 제거)
    window.closeSideNav = closeSideNav;
    window.toggleSideNav = toggleSideNav;
    window.openSideNav = openSideNav;
    window.collapseNavDesktop = collapseNavDesktop;
    // 사이드바는 항상 닫힌 상태로 시작 (수동으로 햄버거 버튼 클릭 시 열림)



    // ── SPA 라우팅 함수 ──


    function _setDocTitle(view) {
        try {
            const t = _VIEW_TITLES[view];
            if (t) document.title = t;
        } catch (_) {}
    }

    function _pushRoute(view, extra = {}) {
        if (_historySkip) return;
        const cur = history.state || {};
        // 동일 view + 동일 symbol 이면 push 하지 않음 (중복 방지)
        if (cur.view === view && cur.symbol === extra.symbol) return;
        let url;
        if (view === 'home') url = '/';
        else if (view === 'stock' && extra.symbol) url = `?s=${encodeURIComponent(extra.symbol)}`;
        else url = `?view=${encodeURIComponent(view)}`;
        try { history.pushState({ view, ...extra }, '', url); } catch (_) {}
        if (view !== 'stock') _setDocTitle(view);
    }

    function _restoreFromUrl() {
        const params = new URLSearchParams(location.search);
        const sym = params.get('s');
        const view = params.get('view');
        if (sym && /^[A-Za-z0-9.\-^=]{1,15}$/.test(sym)) {
            _historySkip = true;
            try {
                const isKr = /^\d{6}(?:\.KS|\.KQ)?$/.test(sym);
                if (typeof setMarket === 'function') setMarket(isKr ? 'KR' : 'US');
                const inp = document.getElementById('searchInput');
                if (inp) inp.value = sym;
                // searchStock 은 async — 동기 finally 사용
                if (typeof searchStock === 'function') {
                    searchStock().finally(() => { _historySkip = false; });
                } else {
                    _historySkip = false;
                }
            } catch (_) { _historySkip = false; }
        } else if (view && _ROUTE_VIEWS[view]) {
            _historySkip = true;
            try { _ROUTE_VIEWS[view](); } catch (_) {}
            setTimeout(() => { _historySkip = false; }, 100);
        }
    }

    // 이벤트 바인딩 (DOM 준비 후 실행)
    window.addEventListener('DOMContentLoaded', () => {
        // alpha-home.js 에서 호출 못한 함수들 (app.js 정의, 이 시점엔 모든 파일 로드 완료)
        try { loadSocialHot(); } catch(e) {}
        try { loadOptionsPopular(); } catch(e) {}

        // 그룹 아코디언 localStorage 키 정리 (아코디언 제거됨)
        try { ['groupTradePlan','groupSystem','groupDayTrade'].forEach(id => localStorage.removeItem('stockai_group_'+id+'_collapsed')); localStorage.removeItem('stockai_group_mobile_init'); } catch(e) {}

        // 초기 홈 상태를 history에 기록 (뒤로가기 기준점)
        history.replaceState({ view: 'home' }, '', location.href);
        // URL 의 ?s= 또는 ?view= 가 있으면 해당 화면으로 복원
        setTimeout(() => { try { _restoreFromUrl(); } catch(_) {} }, 0);

        const inp = document.getElementById('searchInput');
        if (!inp) return;
        inp.addEventListener('focus', () => {
            if (inp.value.trim()==='') openSearchDropdown();
            else renderDropdown('results', searchSuggest(inp.value, 8));
        });
        inp.addEventListener('input', () => _debouncedSuggest(inp.value));
        inp.addEventListener('blur', () => setTimeout(closeSearchDropdown, 150));
        document.addEventListener('click', e => {
            const wrap = document.getElementById('searchWrap');
            if (wrap && !wrap.contains(e.target)) closeSearchDropdown();
        });

        // 바텀 내비는 항상 고정 표시 (스크롤 숨김 없음)

        // 가로 드래그 스크롤 (차트 툴바 + 탭 내비)
        // 모바일 검색 모달 입력 이벤트
        function _initDragScroll(el) {
            if (!el) return;
            let dragging = false, startX = 0, scrollLeft = 0, moved = false;
            el.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                dragging = true; moved = false;
                startX = e.pageX;
                scrollLeft = el.scrollLeft;
                el.classList.add('is-dragging');
                e.preventDefault();
            });
            document.addEventListener('mouseup', () => { dragging = false; el.classList.remove('is-dragging'); });
            document.addEventListener('mousemove', e => {
                if (!dragging) return;
                const dx = e.pageX - startX;
                if (Math.abs(dx) > 4) moved = true;
                el.scrollLeft = scrollLeft - dx;
            });
            el.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
        }
        _initDragScroll(document.getElementById('chartToolbar'));
        _initDragScroll(document.getElementById('tabNav'));

        const mobInp = document.getElementById('mobSearchInput');
        if (mobInp) {
            mobInp.addEventListener('input', () => {
                _debMobSearch(mobInp.value);
            });
            mobInp.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const q = mobInp.value.trim();
                    if (q) { closeSearch(); setMarket('US'); document.getElementById('searchInput').value = q; searchStock(); }
                }
                if (e.key === 'Escape') closeSearch();
            });
        }
        _setupMinerviniSchedule();
    });

    // 백엔드 API 베이스 URL — state.js / alpha-home.js에 이미 선언됨, 중복 제거

    // ========================================



    // ── 이벤트 핸들러 및 초기화 ──

    // 브라우저 뒤로가기·앞으로가기 — 모든 view 복원
    window.addEventListener('popstate', e => {
        const state = e.state || {};
        _historySkip = true;
        try {
            if (state.view === 'stock' && state.symbol) {
                if (state.market) setMarket(state.market);
                const inp = document.getElementById('searchInput');
                if (inp) inp.value = state.symbol;
                searchStock().finally(() => { _historySkip = false; });
                return;
            }
            const fn = _ROUTE_VIEWS[state.view] || _ROUTE_VIEWS.home;
            fn();
        } finally {
            setTimeout(() => { _historySkip = false; }, 100);
        }
    });

    // 통합 키보드 단축키 핸들러 (ESC / Ctrl+Z / /)
    document.addEventListener('keydown', (e) => {
        // ESC: 전체화면 해제
        if (e.key === 'Escape') {
            const card = document.getElementById('tvChartCard');
            if (card?.classList.contains('fullscreen')) toggleChartFullscreen();
        }
        // Ctrl+Z: 차트 드로잉 실행취소
        if (e.ctrlKey && e.key === 'z') {
            undoDraw();
            e.preventDefault();
        }
        // /: 검색창 포커스
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }
    });

    // 페이지 로드 시 기본 봉 타입(일봉)에 맞게 기간 버튼 초기화
    (function initRangeButtons() {
        const config = INTERVAL_RANGES[currentInterval];
        document.querySelectorAll('.range-btn').forEach(b => {
            const r = b.dataset.range;
            b.style.display = config.allowed.includes(r) ? '' : 'none';
        });
    })();




    // Theme Toggle (다크/라이트 모드)
    // ========================================
    const THEME_LS = 'stockai_theme';

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const icon = document.getElementById('themeIcon');
        const label = document.getElementById('themeLabel');
        const sw = document.getElementById('themeSwitch');
        const headerBtn = document.getElementById('themeHeaderBtn');
        if (theme === 'light') {
            icon.innerHTML = '&#9728;';
            label.textContent = '라이트 모드';
            sw.className = 'theme-switch light';
            if (headerBtn) headerBtn.innerHTML = '&#9728;';
        } else {
            icon.innerHTML = '&#9790;';
            label.textContent = '다크 모드';
            sw.className = 'theme-switch dark';
            if (headerBtn) headerBtn.innerHTML = '&#9790;';
        }
        // Lightweight Charts 배경 업데이트
        if (lwChart) {
            const bgColor = theme === 'light' ? '#ffffff' : '#111620';
            const textColor = theme === 'light' ? '#6C6C70' : '#8E8E93';
            const gridColor = theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(45,58,77,0.2)';
            lwChart.applyOptions({
                layout: { background: { type: 'solid', color: bgColor }, textColor },
                grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
            });
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_LS, next);
        applyTheme(next);
    }

    // ========================================
    // 기능 업데이트 (Changelog) 모달
    // ========================================
    const CHANGELOG_LS_KEY = 'stockai_changelog_seen';
    const CHANGELOG = [
        {
            v: 'v638', date: '2026-05-14', tag: '🔄 개편',
            title: '급등 후보 — Tim Sykes 7단계 프레임워크 전환',
            items: [
                '단계별 자동 감지 (1 횡보·2 첫 급등·3 수퍼노바·4 급락·5 데드캣·6 2차 하락·7 소멸)',
                '롱(2~3단계) / 숏(4~6단계) 신호 + ATR 기반 진입·손절·익절1·익절2',
                '필터 버튼 — 전체 / 롱 / 숏 / 🚨 정점 경고(4일 연속 상승)',
                'Low Float(≤5M) 배지 + 연속 상승일 표시 + Finnhub 24h 뉴스',
                '유니버스 확대 — 주가 $0.3~$10, 시총 ≤$200M, 평균거래량 ≥10K',
            ],
        },
        {
            v: 'v628', date: '2026-05-14', tag: '✨ 신기능',
            title: '김직선 분석 — 시가+MA20+BB 일봉 매매 전략',
            items: [
                '일봉 차트에서 당일 시가·20일MA·BB 조합으로 매수/매도/혼조 관점 판단',
                'BB 상단 돌파 시 추세 추종 + 5분봉 더블바텀 단기 진입 타점 자동 감지',
                '차트에 시가선·진입(1~3차)·손절(일반/이평/BB)·익절(1~3차) 라인 표시',
                'R:R 요약 + AI 분석 텍스트 + 차트 상단 김직선 토글 버튼 추가',
            ],
        },
        {
            v: 'v625', date: '2026-05-14', tag: '✨ 신기능',
            title: '홈에 알파 스캐너 프리뷰 추가',
            items: [
                '홈 화면에서 과매도·급등 후보·스윙·Rayner·SEPA 탭별 TOP 10 표시',
                '"전체 보기" 클릭 시 알파 스캐너의 동일 탭으로 바로 이동',
                '결과는 5분간 캐시 — 홈 ↔ 스캐너 왕복 시 재호출 최소화',
            ],
        },
        {
            v: 'v624', date: '2026-05-14', tag: '🐛 버그픽스',
            title: '분봉 드롭다운 — 스크롤·리사이즈 시 자동 닫기',
            items: [
                '드롭다운이 열린 상태에서 스크롤하면 따라 움직이던 현상 해결',
                '스크롤/리사이즈 이벤트 발생 시 메뉴 자동 닫기 처리',
            ],
        },
        {
            v: 'v581', date: '2026-05-13', tag: '🔐 인프라',
            title: 'Supabase Auth 백엔드 (Phase 1)',
            items: [
                '사용자 인증 미들웨어 + 즐겨찾기·설정 동기화 API 추가',
                'user_favorites · user_prefs 테이블 신설 (RLS 보호)',
                '비로그인 사용자는 그대로 사용 가능 — 로그인 UI는 다음 단계',
            ],
        },
        {
            v: 'v580', date: '2026-05-13', tag: '🎨 UI',
            title: 'Minervini SEPA 스캐너 카드 통합',
            items: [
                'SEPA 스캐너 카드를 과매도·스윙과 동일한 통합 UI로 변경',
                '트렌드 템플릿 8조건, VCP, RS, 거래량을 시그널 pill 로 매핑',
                '진입가/손절(-10%)/목표(+20%) Minervini 원칙 적용',
            ],
        },
        {
            v: 'v579', date: '2026-05-13', tag: '🎨 UI',
            title: 'Rayner 스캐너 카드 통합',
            items: [
                'Rayner 스캐너 카드를 과매도·스윙과 동일한 UI로 통일',
                'Stage·진입 시그널·캔들 패턴·EMA 정배열을 시그널 pill 로 표시',
            ],
        },
        {
            v: 'v578', date: '2026-05-13', tag: '🐛 버그',
            title: 'SEPA 스캐너 — 시장 약세 폴백',
            items: [
                'SEPA 70+ 종목 없을 때 50+ 또는 상위 20개 표시',
                '시장 약세 안내 배너 추가',
            ],
        },
        {
            v: 'v577', date: '2026-05-13', tag: '🐛 버그',
            title: '단타 진입 스캐너 — 데이터 로드 실패 수정',
            items: [
                '_fetchYahooQuoteBatch 잘못된 사용 제거',
                '차트 endpoint 한 번으로 OHLCV + 시세 통합',
            ],
        },
        {
            v: 'v576', date: '2026-05-13', tag: '✨ 신규',
            title: '단타 진입 스캐너 — 5분봉 돌파 분석 기반',
            items: [
                '/api/breakout-scan: 80종목 5단계 점수 (돌파·양봉시가·거래량·정배열·위험패턴)',
                '60+ 점수 종목 필터, 30분 캐시',
            ],
        },
        {
            v: 'v575', date: '2026-05-13', tag: '🎨 UI',
            title: '5분봉 돌파 단타 분석 카드 개편',
            items: [
                '큰 점수 배너 + 매매 라인 4열 그리드 (R:R 표시)',
                '5단계 체크 카드에 가중치 배지 + 진행바',
                '점수 등급 기준표 + 원칙 안내 추가',
            ],
        },
        {
            v: 'v574', date: '2026-05-13', tag: '✨ 신규',
            title: 'Minervini SEPA 스캐너 + 단테 제거',
            items: [
                '/api/sepa-scan 엔드포인트 신설',
                '차트·스캐너에서 단테 단타 분석기 제거',
            ],
        },
        {
            v: 'v573', date: '2026-05-13', tag: '🎨 UI',
            title: 'Minervini SEPA 분석 카드 UX 개편',
            items: [
                '큰 SEPA 점수 배너 + 섹션 색띠',
                '⚖️ 가중치 표 + 📚 등급 기준 + 💡 Minervini 원칙',
            ],
        },
        {
            v: 'v572', date: '2026-05-13', tag: '🎨 UI',
            title: 'Rayner Teo 분석 — Stage 배너 강조',
            items: [
                '상단에 큰 Stage 숫자 배너',
                '하단에 Stage 1~4 기준 안내 (Weinstein 4단계)',
            ],
        },
        {
            v: 'v571', date: '2026-05-13', tag: '🐛 버그',
            title: 'SEPA — 일봉 데이터 별도 조회',
            items: [
                '인트라데이 차트와 무관하게 항상 1년 일봉 사용',
                '종목별 30분 캐시',
            ],
        },
        {
            v: 'v568', date: '2026-05-13', tag: '🗑️ 정리',
            title: '퀀트 분석 카드 제거',
            items: [ 'Minervini SEPA 카드로 대체' ],
        },
        {
            v: 'v567', date: '2026-05-13', tag: '✨ 신규',
            title: 'Minervini SEPA 분석 카드',
            items: [
                '트렌드 템플릿 8조건 체크리스트',
                'VCP 패턴 자동 감지',
                '상대강도 RS vs S&P 500',
                '피벗 진입가/손절/익절 자동 계산',
            ],
        },
        {
            v: 'v557', date: '2026-05-13', tag: '✨ 신규',
            title: 'Rayner Teo 분석',
            items: [
                'EMA 20/50/200 차트 오버레이',
                'Stage 1~4 자동 감지 (Weinstein 4단계)',
                '캔들 패턴 5종 (해머·슈팅스타·인게이징·도지) 자동 마커',
                '진입 전략 3종 (풀백·브레이크아웃·반전) 차트 마커',
            ],
        },
        {
            v: 'v550', date: '2026-05-13', tag: '⚡ 실시간',
            title: '차트 시그널 60초 자동 폴링',
            items: [
                'RSI 반전·MACD 교차 시 토스트 알림',
                '백그라운드 탭에서는 자동 정지',
            ],
        },
    ];

    function _renderChangelog() {
        const body = document.getElementById('changelogBody');
        if (!body) return;
        const html = CHANGELOG.map(entry => `
            <div class="changelog-entry">
                <div class="changelog-entry-head">
                    <span class="changelog-entry-ver">${entry.v}</span>
                    <span class="changelog-entry-tag">${entry.tag}</span>
                    <span class="changelog-entry-date">${entry.date}</span>
                </div>
                <div class="changelog-entry-title">${entry.title}</div>
                <ul class="changelog-entry-list">
                    ${entry.items.map(it => `<li>${it}</li>`).join('')}
                </ul>
            </div>
        `).join('');
        body.innerHTML = html;
    }

    function _updateChangelogBadge() {
        const badge = document.getElementById('changelogBadge');
        if (!badge) return;
        const lastSeen = localStorage.getItem(CHANGELOG_LS_KEY) || '';
        const latest = CHANGELOG[0]?.v || '';
        badge.style.display = (latest && latest !== lastSeen) ? '' : 'none';
    }

    function openChangelog() {
        _renderChangelog();
        const m = document.getElementById('changelogModal');
        const b = document.getElementById('changelogBackdrop');
        if (m) { m.classList.add('show'); m.setAttribute('aria-hidden', 'false'); }
        if (b) b.classList.add('show');
        // 본 것으로 기록
        const latest = CHANGELOG[0]?.v;
        if (latest) localStorage.setItem(CHANGELOG_LS_KEY, latest);
        _updateChangelogBadge();
        document.body.style.overflow = 'hidden';
    }

    function closeChangelog() {
        const m = document.getElementById('changelogModal');
        const b = document.getElementById('changelogBackdrop');
        if (m) { m.classList.remove('show'); m.setAttribute('aria-hidden', 'true'); }
        if (b) b.classList.remove('show');
        document.body.style.overflow = '';
    }

    // ESC 키로 닫기




    function _normalizeOpt(o) {
        const n = v => { if (v == null) return null; if (typeof v === 'object' && 'raw' in v) return Number(v.raw); return +v || 0; };
        return { ...o, strike: n(o.strike), lastPrice: n(o.lastPrice), bid: n(o.bid), ask: n(o.ask),
            change: n(o.change), percentChange: n(o.percentChange), volume: n(o.volume),
            openInterest: n(o.openInterest), impliedVolatility: n(o.impliedVolatility) };
    }

    async function renderOptionsTab(symbol) {
        const emptyEl   = document.getElementById('optionsEmpty');
        const contentEl = document.getElementById('optionsContent');
        const expBar    = document.getElementById('optionsExpBar');
        const summaryEl = document.getElementById('optionsSummary');
        const gridEl    = document.getElementById('optionsChainGrid');
        if (!emptyEl) return;

        // 이미 같은 종목이면 재조회 생략
        if (_optionsSymbol === symbol && _optionsAllCalls.length) return;

        // 새 종목: 필터·정렬 상태 초기화
        _optionsFilter      = 'all';
        _optionsStrikeRange = 'all';
        _optionsVolOnly     = false;
        _optionsSortCol     = null;
        _optionsSortDir     = 'asc';
        document.querySelectorAll('.options-filter-btn').forEach(b => b.classList.remove('active'));
        const allBtn = document.getElementById('optITMBtn_all'); if (allBtn) allBtn.classList.add('active');
        const rangeBtn = document.querySelector('.opt-range-btn[data-r="all"]'); if (rangeBtn) rangeBtn.classList.add('active');

        emptyEl.style.display = 'none';
        contentEl.style.display = 'block';
        expBar.innerHTML  = '';
        summaryEl.innerHTML = '';
        gridEl.innerHTML  = tabLoading([100, 30, 100, 30, 100, 30]);

        try {
            const res  = await fetch(`${API_BASE}/api/options/${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const chain = data?.optionChain?.result?.[0];
            if (!chain) throw new Error('옵션 데이터 없음');

            _optionsSymbol       = symbol;
            _optionsExpDates     = chain.expirationDates || [];
            _optionsCurrentPrice = chain.quote?.regularMarketPrice || stockData?.meta?.regularMarketPrice || 0;

            // 만기일 버튼 렌더
            expBar.innerHTML = _optionsExpDates.slice(0, 12).map((ts, i) => {
                const d = new Date(ts * 1000);
                const label = d.toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit', year:'2-digit' });
                return `<button class="options-exp-btn${i===0?' active':''}" onclick="loadOptionsDate(${ts})">${label}</button>`;
            }).join('');

            // 첫 번째 만기일 데이터 렌더
            const opt = chain.options?.[0];
            if (!opt) throw new Error('옵션 체인 없음');
            _optionsAllCalls = (opt.calls || []).map(_normalizeOpt);
            _optionsAllPuts  = (opt.puts  || []).map(_normalizeOpt);

            const firstTs = _optionsExpDates[0];
            if (firstTs) {
                const d = new Date(firstTs * 1000);
                document.getElementById('optionsCurrentExp').textContent =
                    `만기: ${d.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' })}`;
            }
            renderOptionsChain();
            renderOptionsSummary();

        } catch(e) {
            gridEl.innerHTML = tabError('옵션 데이터를 불러올 수 없습니다.', `renderOptionsTab('${symbol}')`);
        }
    }

    async function loadOptionsDate(ts) {
        // 만기일 버튼 active 교체
        document.querySelectorAll('.options-exp-btn').forEach(b => {
            b.classList.toggle('active', b.onclick?.toString().includes(ts));
        });
        const d = new Date(ts * 1000);
        document.getElementById('optionsCurrentExp').textContent =
            `만기: ${d.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' })}`;

        const gridEl = document.getElementById('optionsChainGrid');
        gridEl.innerHTML = tabLoading([100, 30, 100, 30, 100, 30]);

        try {
            const res  = await fetch(`${API_BASE}/api/options/${encodeURIComponent(_optionsSymbol)}?date=${ts}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const opt  = data?.optionChain?.result?.[0]?.options?.[0];
            if (!opt) throw new Error('데이터 없음');
            _optionsAllCalls = (opt.calls || []).map(_normalizeOpt);
            _optionsAllPuts  = (opt.puts  || []).map(_normalizeOpt);
            renderOptionsChain();
            renderOptionsSummary();
        } catch(e) {
            gridEl.innerHTML = tabError('옵션 데이터를 불러올 수 없습니다.', `loadOptionsDate(${ts})`);
        }
    }

    function setOptionsFilter(f) {
        _optionsFilter = f;
        ['all','itm','otm'].forEach(v => {
            const el = document.getElementById(`optITMBtn_${v}`);
            if (el) el.classList.toggle('active', v === f);
        });
        renderOptionsChain();
    }

    function setOptionsStrikeRange(r) {
        _optionsStrikeRange = r;
        document.querySelectorAll('.opt-range-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.r === r);
        });
        renderOptionsChain();
    }

    function toggleOptionsVolFilter() {
        _optionsVolOnly = !_optionsVolOnly;
        const btn = document.getElementById('optionsVolBtn');
        if (btn) btn.classList.toggle('active', _optionsVolOnly);
        renderOptionsChain();
    }

    function sortOptionsBy(col) {
        if (_optionsSortCol === col) {
            _optionsSortDir = _optionsSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            _optionsSortCol = col;
            _optionsSortDir = col === 'strike' ? 'asc' : 'desc';
        }
        renderOptionsChain();
    }

    function renderOptionsSummary() {
        const summaryEl = document.getElementById('optionsSummary');
        const totalCallOI = _optionsAllCalls.reduce((s, o) => s + (o.openInterest || 0), 0);
        const totalPutOI  = _optionsAllPuts.reduce((s, o)  => s + (o.openInterest || 0), 0);
        const totalCallVol = _optionsAllCalls.reduce((s, o) => s + (o.volume || 0), 0);
        const totalPutVol  = _optionsAllPuts.reduce((s, o)  => s + (o.volume || 0), 0);
        const pcr = totalCallOI > 0 ? (totalPutOI / totalCallOI).toFixed(2) : '-';
        const pcrNum = parseFloat(pcr);
        const pcrColor = pcrNum >= 1 ? 'var(--red)' : 'var(--green)';
        const callPct = totalCallOI + totalPutOI > 0 ? (totalCallOI / (totalCallOI + totalPutOI) * 100).toFixed(0) : 50;
        const putPct  = 100 - callPct;
        const fmtK = v => !v ? '-' : v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v;

        summaryEl.innerHTML = `
            <div class="options-stat">
                <div class="options-stat-label">PUT/CALL RATIO</div>
                <div class="options-stat-val" style="color:${pcrColor}">${pcr}</div>
                <div class="options-pcr-bar">
                    <div class="options-pcr-fill-c" style="width:${callPct}%"></div>
                    <div class="options-pcr-fill-p" style="width:${putPct}%"></div>
                </div>
            </div>
            <div class="options-stat">
                <div class="options-stat-label">콜 미결제약정</div>
                <div class="options-stat-val" style="color:var(--green)">${fmtK(totalCallOI)}</div>
            </div>
            <div class="options-stat">
                <div class="options-stat-label">풋 미결제약정</div>
                <div class="options-stat-val" style="color:var(--red)">${fmtK(totalPutOI)}</div>
            </div>
            <div class="options-stat">
                <div class="options-stat-label">콜/풋 거래량</div>
                <div class="options-stat-val" style="font-size:14px;">
                    <span style="color:var(--green)">${fmtK(totalCallVol)}</span>
                    <span style="color:var(--text3);font-size:12px;"> / </span>
                    <span style="color:var(--red)">${fmtK(totalPutVol)}</span>
                </div>
            </div>`;
        renderOptionsTodayActive();
        renderOptionsAnalysis();
    }

    // 당일 거래 활성 옵션 TOP — 현재 로드된 만기 기준
    //   · volume > 0 인 콜/풋 contracts 를 거래량 desc 로 정렬, 각 TOP 5 노출
    //   · Yahoo 의 volume 필드는 당일 누적 거래량 (장 마감 시 reset)
    function renderOptionsTodayActive() {
        const el = document.getElementById('optionsTodayActive');
        if (!el) return;
        const calls = (_optionsAllCalls || []).filter(o => (o.volume || 0) > 0);
        const puts  = (_optionsAllPuts  || []).filter(o => (o.volume || 0) > 0);
        if (!calls.length && !puts.length) { el.innerHTML = ''; return; }

        const topCalls = [...calls].sort((a,b) => (b.volume||0) - (a.volume||0)).slice(0, 5);
        const topPuts  = [...puts ].sort((a,b) => (b.volume||0) - (a.volume||0)).slice(0, 5);

        const fmtK = v => v == null ? '-' : v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : String(v);
        const fmtP = v => v == null ? '-' : '$' + Number(v).toFixed(2);
        const fmtIV = v => v == null ? '-' : (v*100).toFixed(0)+'%';
        const fmtChg = v => {
            if (v == null) return '-';
            const cls = v >= 0 ? 'opt-up' : 'opt-down';
            return `<span class="${cls}">${(v>=0?'+':'')}${v.toFixed(2)}</span>`;
        };

        const buildRows = (list, type) => {
            if (!list.length) return `<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--text3);font-size:12px;">당일 거래 없음</td></tr>`;
            return list.map(o => {
                const itm = o.inTheMoney ? `<span class="opt-itm-badge ${type}" style="margin-left:6px;">ITM</span>` : '';
                return `<tr>
                    <td><span class="opt-strike">${fmtP(o.strike)}</span>${itm}</td>
                    <td>${fmtP(o.lastPrice)}</td>
                    <td>${fmtChg(o.change)}</td>
                    <td class="opt-vol" style="font-weight:700">${fmtK(o.volume)}</td>
                    <td class="opt-iv">${fmtIV(o.impliedVolatility)}</td>
                </tr>`;
            }).join('');
        };

        const totalCallVol = calls.reduce((s,o)=>s+(o.volume||0),0);
        const totalPutVol  = puts.reduce((s,o)=>s+(o.volume||0),0);

        el.innerHTML = `
            <div class="options-card" style="margin-top:12px;">
                <div class="options-card-hd" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                    <span>🔥 당일 거래 활성 옵션 TOP <span style="font-size:11px;color:var(--text3);font-weight:500;">(현재 만기 기준)</span></span>
                    <span style="font-size:11px;color:var(--text3);font-weight:500;">
                        콜 거래량 <span style="color:var(--green);font-weight:700">${fmtK(totalCallVol)}</span>
                        · 풋 거래량 <span style="color:var(--red);font-weight:700">${fmtK(totalPutVol)}</span>
                    </span>
                </div>
                <div class="options-active-grid">
                    <div class="options-active-col">
                        <div class="options-active-title call">▲ 콜 옵션 TOP 5</div>
                        <div style="overflow-x:auto;"><table class="opt-tbl opt-tbl-compact">
                            <thead><tr>
                                <th>행사가</th><th>최종가</th><th>변동</th><th>거래량</th><th>IV</th>
                            </tr></thead>
                            <tbody>${buildRows(topCalls, 'call')}</tbody>
                        </table></div>
                    </div>
                    <div class="options-active-col">
                        <div class="options-active-title put">▼ 풋 옵션 TOP 5</div>
                        <div style="overflow-x:auto;"><table class="opt-tbl opt-tbl-compact">
                            <thead><tr>
                                <th>행사가</th><th>최종가</th><th>변동</th><th>거래량</th><th>IV</th>
                            </tr></thead>
                            <tbody>${buildRows(topPuts, 'put')}</tbody>
                        </table></div>
                    </div>
                </div>
            </div>`;
    }

    function renderOptionsAnalysis() {
        const el = document.getElementById('optionsAnalysis');
        if (!el) return;
        const calls = _optionsAllCalls;
        const puts  = _optionsAllPuts;
        const price = _optionsCurrentPrice;
        if (!calls.length && !puts.length) { el.innerHTML = ''; return; }

        // ─── 기본 지표 계산 ───
        const totalCallOI  = calls.reduce((s, o) => s + (o.openInterest || 0), 0);
        const totalPutOI   = puts.reduce((s, o)  => s + (o.openInterest || 0), 0);
        const totalCallVol = calls.reduce((s, o) => s + (o.volume || 0), 0);
        const totalPutVol  = puts.reduce((s, o)  => s + (o.volume || 0), 0);
        const pcrOI  = totalCallOI  > 0 ? totalPutOI  / totalCallOI  : null;
        const pcrVol = totalCallVol > 0 ? totalPutVol / totalCallVol : null;

        // ─── Max Pain 계산 ───
        const allStrikes = [...new Set([...calls.map(o => o.strike), ...puts.map(o => o.strike)])].sort((a,b) => a - b);
        let maxPain = null;
        if (allStrikes.length) {
            let minPain = Infinity;
            for (const p of allStrikes) {
                let pain = 0;
                for (const c of calls) pain += Math.max(0, p - c.strike) * (c.openInterest || 0);
                for (const u of puts)  pain += Math.max(0, u.strike - p) * (u.openInterest || 0);
                if (pain < minPain) { minPain = pain; maxPain = p; }
            }
        }

        // ─── 콜 월 / 풋 월 ───
        const callWall = calls.reduce((b, o) => (!b || (o.openInterest||0) > (b.openInterest||0)) ? o : b, null);
        const putWall  = puts.reduce((b, o)  => (!b || (o.openInterest||0) > (b.openInterest||0)) ? o : b, null);

        // ─── IV 스큐 (OTM 풋 IV / OTM 콜 IV) ───
        const otmCalls = calls.filter(o => !o.inTheMoney && (o.impliedVolatility||0) > 0);
        const otmPuts  = puts.filter(o  => !o.inTheMoney && (o.impliedVolatility||0) > 0);
        const avgCallIV = otmCalls.length ? otmCalls.reduce((s,o) => s + o.impliedVolatility, 0) / otmCalls.length : null;
        const avgPutIV  = otmPuts.length  ? otmPuts.reduce((s,o)  => s + o.impliedVolatility, 0) / otmPuts.length  : null;
        const ivSkew = (avgCallIV && avgPutIV) ? avgPutIV / avgCallIV : null;

        // ─── 시그널 & 스코어링 ───
        let bullScore = 0, bearScore = 0;
        const signals = [];

        // PCR(OI) 시그널
        if (pcrOI !== null) {
            if      (pcrOI < 0.5)  { bullScore += 3; signals.push({t:'bull', m:`PCR(OI) <strong>${pcrOI.toFixed(2)}</strong> — 강한 콜 우세, 시장 낙관론`}); }
            else if (pcrOI < 0.7)  { bullScore += 2; signals.push({t:'bull', m:`PCR(OI) <strong>${pcrOI.toFixed(2)}</strong> — 콜 우세, 상승 기대 높음`}); }
            else if (pcrOI < 1.0)  { bullScore += 1; signals.push({t:'neutral', m:`PCR(OI) <strong>${pcrOI.toFixed(2)}</strong> — 콜 소폭 우세, 중립에 가까운 상승`}); }
            else if (pcrOI < 1.3)  { bearScore += 1; signals.push({t:'neutral', m:`PCR(OI) <strong>${pcrOI.toFixed(2)}</strong> — 풋 소폭 우세, 중립에 가까운 하락`}); }
            else if (pcrOI < 1.7)  { bearScore += 2; signals.push({t:'bear',    m:`PCR(OI) <strong>${pcrOI.toFixed(2)}</strong> — 풋 우세, 하락 헤지 증가`}); }
            else                   { bearScore += 3; signals.push({t:'bear',    m:`PCR(OI) <strong>${pcrOI.toFixed(2)}</strong> — 강한 풋 우세, 하락 방어 심화`}); }
        }

        // 거래량 시그널
        if (pcrVol !== null) {
            if      (pcrVol < 0.7) { bullScore += 2; signals.push({t:'bull',    m:`콜 거래량 우세 (<strong>${totalCallVol.toLocaleString()} vs ${totalPutVol.toLocaleString()}</strong>) — 매수 모멘텀`}); }
            else if (pcrVol > 1.4) { bearScore += 2; signals.push({t:'bear',    m:`풋 거래량 우세 (<strong>${totalPutVol.toLocaleString()} vs ${totalCallVol.toLocaleString()}</strong>) — 하락 베팅 증가`}); }
            else                   {                  signals.push({t:'neutral', m:`콜/풋 거래량 균형 (<strong>${totalCallVol.toLocaleString()} / ${totalPutVol.toLocaleString()}</strong>) — 방향성 중립`}); }
        }

        // Max Pain 시그널
        if (maxPain !== null && price) {
            const diffPct = (price - maxPain) / maxPain * 100;
            if      (diffPct >  3) { bearScore += 1; signals.push({t:'bear',    m:`맥스 페인 <strong>$${maxPain}</strong> — 현재가 ${diffPct.toFixed(1)}% 위, 만기 시 하방 압력 가능`}); }
            else if (diffPct < -3) { bullScore += 1; signals.push({t:'bull',    m:`맥스 페인 <strong>$${maxPain}</strong> — 현재가 ${Math.abs(diffPct).toFixed(1)}% 아래, 만기 시 상방 압력 가능`}); }
            else                   {                  signals.push({t:'neutral', m:`맥스 페인 <strong>$${maxPain}</strong> — 현재가 근접, 균형 상태`}); }
        }

        // IV 스큐 시그널
        if (ivSkew !== null) {
            if      (ivSkew > 1.2) { bearScore += 1; signals.push({t:'bear', m:`풋 IV 스큐 <strong>${ivSkew.toFixed(2)}x</strong> — OTM 풋 변동성 높음, 하락 리스크 경계`}); }
            else if (ivSkew < 0.8) { bullScore += 1; signals.push({t:'bull', m:`콜 IV 스큐 <strong>${(1/ivSkew).toFixed(2)}x</strong> — OTM 콜 변동성 높음, 상승 기대 반영`}); }
        }

        // ─── 종합 판단 ───
        const gap = bullScore - bearScore;
        let verdictText, verdictClass;
        if      (gap >= 4)  { verdictText = '🚀 강한 매수'; verdictClass = 'strong-bull'; }
        else if (gap >= 2)  { verdictText = '📈 매수 우세'; verdictClass = 'bull'; }
        else if (gap <= -4) { verdictText = '🔻 강한 매도'; verdictClass = 'strong-bear'; }
        else if (gap <= -2) { verdictText = '📉 매도 우세'; verdictClass = 'bear'; }
        else                { verdictText = '⚖️ 중립';     verdictClass = 'neutral'; }

        const icon = t => t === 'bull' ? '🟢' : t === 'bear' ? '🔴' : '🟡';
        const fmtOI = v => v ? v.toLocaleString() : '-';

        el.innerHTML = `
        <div class="options-analysis">
            <div class="options-anal-header">
                <div class="options-anal-title">옵션 시장 분석</div>
                <div class="options-anal-verdict ${verdictClass}">${verdictText}</div>
            </div>
            <div class="options-anal-section-title">주요 가격 레벨</div>
            <div class="options-anal-grid">
                <div class="options-anal-item">
                    <div class="options-anal-item-label">맥스 페인</div>
                    <div class="options-anal-item-val">${maxPain != null ? '$' + maxPain.toFixed(0) : '-'}</div>
                    <div class="options-anal-item-sub">만기 시 옵션 매도자 최대 이익 구간</div>
                </div>
                <div class="options-anal-item">
                    <div class="options-anal-item-label">IV 스큐 (풋/콜)</div>
                    <div class="options-anal-item-val" style="color:${ivSkew > 1.15 ? 'var(--red)' : ivSkew < 0.85 ? 'var(--green)' : 'var(--text)'}">${ivSkew != null ? ivSkew.toFixed(2) + 'x' : '-'}</div>
                    <div class="options-anal-item-sub">${ivSkew > 1.15 ? '풋 IV 높음 → 하락 경계' : ivSkew != null && ivSkew < 0.85 ? '콜 IV 높음 → 상승 기대' : '균형'}</div>
                </div>
                <div class="options-anal-item">
                    <div class="options-anal-item-label">콜 월 (저항선)</div>
                    <div class="options-anal-item-val" style="color:var(--green)">${callWall ? '$' + callWall.strike : '-'}</div>
                    <div class="options-anal-item-sub">OI ${fmtOI(callWall?.openInterest)} — 강한 저항 예상</div>
                </div>
                <div class="options-anal-item">
                    <div class="options-anal-item-label">풋 월 (지지선)</div>
                    <div class="options-anal-item-val" style="color:var(--red)">${putWall ? '$' + putWall.strike : '-'}</div>
                    <div class="options-anal-item-sub">OI ${fmtOI(putWall?.openInterest)} — 강한 지지 예상</div>
                </div>
            </div>
            <div class="options-anal-divider"></div>
            <div class="options-anal-section-title">시그널 분석</div>
            <div class="options-signals">
                ${signals.map(s => `
                <div class="options-signal-row">
                    <span class="options-signal-icon">${icon(s.t)}</span>
                    <span class="options-signal-text">${s.m}</span>
                </div>`).join('')}
            </div>
        </div>`;
    }

    function renderOptionsChain() {
        const gridEl = document.getElementById('optionsChainGrid');
        const price  = _optionsCurrentPrice;
        const fmtK = v => v == null ? '-' : v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v;
        const fmtP = v => v == null ? '-' : '$' + Number(v).toFixed(2);
        const fmtIV = v => v == null ? '-' : (v * 100).toFixed(1) + '%';
        const fmtChg = v => {
            if (v == null) return '-';
            const s = (v >= 0 ? '+' : '') + v.toFixed(2);
            return `<span class="${v >= 0 ? 'opt-up' : 'opt-down'}">${s}</span>`;
        };

        const filterFn = (list) => {
            let result = list;
            // ITM / OTM 필터
            if (_optionsFilter === 'itm') result = result.filter(o => o.inTheMoney);
            else if (_optionsFilter === 'otm') result = result.filter(o => !o.inTheMoney);
            // 행사가 범위 필터 (ATM 기준 ±%)
            if (_optionsStrikeRange !== 'all' && price) {
                const pct = Number(_optionsStrikeRange) / 100;
                result = result.filter(o => o.strike >= price * (1 - pct) && o.strike <= price * (1 + pct));
            }
            // 거래량 > 0 필터
            if (_optionsVolOnly) result = result.filter(o => (o.volume || 0) > 0);
            // 정렬
            if (_optionsSortCol) {
                const keyMap = { strike: 'strike', volume: 'volume', oi: 'openInterest', iv: 'impliedVolatility' };
                const key = keyMap[_optionsSortCol];
                result = [...result].sort((a, b) => {
                    const va = a[key] ?? 0, vb = b[key] ?? 0;
                    return _optionsSortDir === 'asc' ? va - vb : vb - va;
                });
            }
            return result;
        };

        const calls = filterFn(_optionsAllCalls);
        const puts  = filterFn(_optionsAllPuts);

        const sortIcon = col => {
            if (_optionsSortCol !== col) return `<span class="opt-sort-icon">⇅</span>`;
            return _optionsSortDir === 'asc'
                ? `<span class="opt-sort-icon active">↑</span>`
                : `<span class="opt-sort-icon active">↓</span>`;
        };

        const makeTable = (list, type) => {
            if (!list.length) return '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">데이터 없음</div>';
            const itmClass = type === 'call' ? 'itm-call' : 'itm-put';
            const rows = list.map(o => {
                const itmBadge = o.inTheMoney ? `<span class="opt-itm-badge ${type}">ITM</span>` : '';
                return `<tr class="${o.inTheMoney ? itmClass : ''}">
                    <td><span class="opt-strike">${fmtP(o.strike)}</span>${itmBadge}</td>
                    <td>${fmtP(o.lastPrice)}</td>
                    <td>${fmtChg(o.change)}</td>
                    <td>${fmtP(o.bid)} / ${fmtP(o.ask)}</td>
                    <td class="opt-vol">${fmtK(o.volume)}</td>
                    <td>${fmtK(o.openInterest)}</td>
                    <td class="opt-iv">${fmtIV(o.impliedVolatility)}</td>
                </tr>`;
            }).join('');

            return `<div style="overflow-x:auto;"><table class="opt-tbl">
                <thead><tr>
                    <th class="opt-th-sort" onclick="sortOptionsBy('strike')">행사가 ${sortIcon('strike')}</th>
                    <th>최종가</th><th>변동</th><th>매수/매도</th>
                    <th class="opt-th-sort" onclick="sortOptionsBy('volume')">거래량 ${sortIcon('volume')}</th>
                    <th class="opt-th-sort" onclick="sortOptionsBy('oi')">미결제 ${sortIcon('oi')}</th>
                    <th class="opt-th-sort" onclick="sortOptionsBy('iv')">IV ${sortIcon('iv')}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table></div>`;
        };

        const callCount = calls.filter(o => o.inTheMoney).length;
        const putCount  = puts.filter(o => o.inTheMoney).length;

        gridEl.innerHTML = `
            <div class="options-card">
                <div class="options-card-hd">
                    <span class="options-card-title call">▲ 콜 옵션 (CALL)</span>
                    <span class="options-card-sub">ITM ${callCount}개 / 총 ${calls.length}개</span>
                </div>
                ${makeTable(calls, 'call')}
            </div>
            <div class="options-card">
                <div class="options-card-hd">
                    <span class="options-card-title put">▼ 풋 옵션 (PUT)</span>
                    <span class="options-card-sub">ITM ${putCount}개 / 총 ${puts.length}개</span>
                </div>
                ${makeTable(puts, 'put')}
            </div>`;
    }

    // ========================================
    // PWA 설치
    // ========================================
    let _pwaPrompt = null;

    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        _pwaPrompt = e;
        const btn = document.getElementById('pwaInstallBtn');
        if (btn) btn.classList.add('visible');
    });

    window.addEventListener('appinstalled', () => {
        _pwaPrompt = null;
        const btn = document.getElementById('pwaInstallBtn');
        if (btn) btn.classList.remove('visible');
        showToast('✅ StockAI가 앱으로 설치되었습니다!');
    });

    async function pwaInstall() {
        if (!_pwaPrompt) {
            showToast('이미 설치되어 있거나 이 브라우저는 설치를 지원하지 않습니다.');
            return;
        }
        _pwaPrompt.prompt();
        const { outcome } = await _pwaPrompt.userChoice;
        if (outcome === 'accepted') {
            _pwaPrompt = null;
            const btn = document.getElementById('pwaInstallBtn');
            if (btn) btn.classList.remove('visible');
        }
    }

    // 오프라인 배너 제거됨 — Comet 등 일부 브라우저에서 navigator.onLine 오탐 이슈로 비활성화

    // 서비스 워커 등록 + 새 버전 자동 감지 · 토스트 알림
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then(reg => {
                if (!reg) return;

                // 새 버전 감지 → 상단 토스트로 사용자에게 새로고침 제안
                let _userAccepted = false;
                const _promptUpdate = (worker) => {
                    if (!worker) return;
                    _showSwUpdateToast(() => {
                        _userAccepted = true;
                        worker.postMessage({ type: 'SKIP_WAITING' });
                        // controllerchange 가 안 오는 경우 대비 — 강제 리로드 안전장치
                        setTimeout(() => { if (_userAccepted) window.location.reload(); }, 2000);
                    });
                };
                // 클릭으로 수락했을 때만 리로드 (최초 설치 시 controllerchange 자동 리로드 루프 방지)
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (_userAccepted) window.location.reload();
                });

                // 1) 이미 대기 중인 워커가 있으면 즉시 토스트
                if (reg.waiting && navigator.serviceWorker.controller) {
                    _promptUpdate(reg.waiting);
                }

                // 2) 업데이트 발견 시 설치 완료를 기다렸다가 토스트
                reg.addEventListener('updatefound', () => {
                    const nw = reg.installing;
                    if (!nw) return;
                    nw.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                            _promptUpdate(nw);
                        }
                    });
                });

                // 3) 주기적으로 업데이트 체크 (60분마다 + 탭 복귀 시)
                const _poll = () => { try { reg.update(); } catch(_){} };
                const _swPollTimer = setInterval(_poll, 60 * 60 * 1000);
                // 페이지 언로드 시 타이머 정리
                // beforeunload 는 iOS Safari 에서 비신뢰적 → pagehide 도 함께 등록
                const _cleanupSwPoll = () => clearInterval(_swPollTimer);
                window.addEventListener('beforeunload', _cleanupSwPoll, { once: true });
                window.addEventListener('pagehide',     _cleanupSwPoll, { once: true });
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') _poll();
                });
            }).catch(() => {});
        }, { once: true });
    }

    // 새 버전 안내 토스트 (우하단, 10초 후 자동 사라짐, 버튼 클릭 시 즉시 적용)
    function _showSwUpdateToast(onAccept) {
        if (document.getElementById('swUpdateToast')) return;
        const el = document.createElement('div');
        el.id = 'swUpdateToast';
        el.setAttribute('role', 'status');
        el.innerHTML =
            '<span class="sw-toast-text">🎉 새 버전이 준비됐어요</span>' +
            '<button class="sw-toast-btn" id="swToastBtn">새로고침</button>' +
            '<button class="sw-toast-close" id="swToastClose" aria-label="닫기">×</button>';
        document.body.appendChild(el);
        document.getElementById('swToastBtn').addEventListener('click', () => {
            try { onAccept && onAccept(); } catch(_){}
            el.remove();
        });
        document.getElementById('swToastClose').addEventListener('click', () => el.remove());
        // 30초 자동 사라짐 (사용자가 놓쳐도 다음 방문에 다시 표시됨)
        setTimeout(() => { if (el.isConnected) el.remove(); }, 30000);
    }

    // ═══════════════════════════════════════════════════════════
    // 푸시 알림 — 구독 · 가격 알림 CRUD
    // ═══════════════════════════════════════════════════════════
    const VAPID_PUBLIC_KEY = 'BC1xd7ln0Ib3Kr430J3W0dI2dBZPh9dL-YhwcZVhCdlAcRVpOeleeU66gULQ01BTmqWGGwy7HFCA_gAfRvdyb8U';

    function _urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
        return output;
    }

    // 현재 push 구독 endpoint (캐시)
    let _pushEndpoint = null;
    async function _getPushEndpoint() {
        if (_pushEndpoint) return _pushEndpoint;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) _pushEndpoint = sub.endpoint;
        return _pushEndpoint;
    }

    // 알림 구독 (권한 요청 + 서버에 저장)
    async function subscribePush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            showToast('이 브라우저는 푸시 알림을 지원하지 않습니다.');
            return false;
        }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { showToast('알림 권한이 허용되지 않았습니다.'); return false; }
        try {
            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
                });
            }
            _pushEndpoint = sub.endpoint;
            const favs = (typeof getFavorites === 'function' ? getFavorites() : [])
                .filter(f => f.market === 'US').map(f => f.symbol);
            const r = await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub.toJSON(), favs }),
            });
            if (r.ok) {
                const d = await r.json().catch(() => ({}));
                if (d.subToken) localStorage.setItem('pushSubToken', d.subToken);
            }
            return true;
        } catch(e) {
            console.error('[subscribePush]', e);
            showToast('알림 등록에 실패했습니다.');
            return false;
        }
    }

    // 구독 해제
    async function unsubscribePush() {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) await sub.unsubscribe();
            _pushEndpoint = null;
            localStorage.removeItem('pushSubToken');
            return true;
        } catch(e) { return false; }
    }

    // 로컬에 저장된 구독 토큰 조회
    function _getSubToken() {
        try { return localStorage.getItem('pushSubToken') || ''; } catch { return ''; }
    }

    // 현재 알림 구독 상태 반환 ('granted'|'denied'|'default' + subscribed boolean)
    async function getPushState() {
        const perm = Notification.permission;
        const reg  = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready.catch(()=>null) : null;
        const sub  = reg ? await reg.pushManager.getSubscription().catch(()=>null) : null;
        return { perm, subscribed: !!sub };
    }

    // ── 가격 알림 모달 ────────────────────────────────────────
    async function openPriceAlertModal(symbol, currentPrice) {
        // 구독 먼저 확인
        const state = await getPushState();
        if (!state.subscribed) {
            const ok = await subscribePush();
            if (!ok) return;
            showToast('알림이 활성화되었습니다 🔔');
        }
        const endpoint = await _getPushEndpoint();
        if (!endpoint) { showToast('알림 등록에 실패했습니다.'); return; }

        // 기존 알림 목록 조회
        let existingAlerts = [];
        const subToken = _getSubToken();
        try {
            const r = await fetch(`/api/push/price-alerts?endpoint=${encodeURIComponent(endpoint)}&subToken=${encodeURIComponent(subToken)}`);
            const d = await r.json();
            existingAlerts = d.alerts || [];
        } catch(e) {}

        // 모달 HTML
        const existing = existingAlerts.filter(a => a.symbol === symbol.toUpperCase());
        const existingHtml = existing.length ? `
            <div class="pa-existing">
                <div class="pa-existing-title">설정된 알림</div>
                ${existing.map(a => `
                    <div class="pa-existing-row">
                        <span>${a.direction === 'above' ? '↑' : '↓'} $${Number(a.target_price).toFixed(2)}</span>
                        <button class="pa-del-btn" onclick="_deletePriceAlert('${a.id}',this)">삭제</button>
                    </div>`).join('')}
            </div>` : '';

        const modal = document.createElement('div');
        modal.id = 'priceAlertModal';
        modal.className = 'pa-modal-backdrop';
        modal.innerHTML = `
            <div class="pa-modal">
                <div class="pa-modal-header">
                    <span class="pa-modal-title">🔔 ${symbol} 가격 알림</span>
                    <button class="pa-close-btn" onclick="document.getElementById('priceAlertModal')?.remove()">×</button>
                </div>
                <div class="pa-modal-body">
                    <div class="pa-current-price">현재가 <strong>$${currentPrice != null ? Number(currentPrice).toFixed(2) : '-'}</strong></div>
                    ${existingHtml}
                    <div class="pa-form">
                        <div class="pa-form-title">새 알림 추가</div>
                        <div class="pa-dir-row">
                            <button class="pa-dir-btn active" id="paDirAbove" onclick="_setPaDir('above')">↑ 이상 도달 시</button>
                            <button class="pa-dir-btn" id="paDirBelow" onclick="_setPaDir('below')">↓ 이하 도달 시</button>
                        </div>
                        <div class="pa-input-row">
                            <span class="pa-input-prefix">$</span>
                            <input type="number" id="paTargetPrice" class="pa-input" placeholder="${currentPrice != null ? Number(currentPrice).toFixed(2) : '0.00'}" step="0.01" min="0">
                        </div>
                        <button class="pa-save-btn" onclick="_savePriceAlert('${symbol}','${endpoint}')">알림 저장</button>
                    </div>
                </div>
            </div>`;
        document.getElementById('priceAlertModal')?.remove();
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.getElementById('paTargetPrice')?.focus();
        window._paDir = 'above';
    }

    function _setPaDir(dir) {
        window._paDir = dir;
        document.getElementById('paDirAbove')?.classList.toggle('active', dir === 'above');
        document.getElementById('paDirBelow')?.classList.toggle('active', dir === 'below');
    }

    async function _savePriceAlert(symbol, endpoint) {
        const val = parseFloat(document.getElementById('paTargetPrice')?.value);
        if (!val || val <= 0) { showToast('올바른 목표가를 입력해주세요.'); return; }
        const subToken = _getSubToken();
        if (!subToken) { showToast('알림 구독 토큰이 없습니다. 알림을 다시 활성화해주세요.'); return; }
        try {
            const r = await fetch('/api/push/price-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint, subToken, symbol, targetPrice: val, direction: window._paDir || 'above' }),
            });
            if (!r.ok) throw new Error();
            document.getElementById('priceAlertModal')?.remove();
            showToast(`${symbol} $${val.toFixed(2)} 알림이 설정되었습니다 🔔`);
        } catch(e) { showToast('알림 저장에 실패했습니다.'); }
    }

    async function _deletePriceAlert(id, btn) {
        const endpoint = await _getPushEndpoint();
        const subToken = _getSubToken();
        if (!endpoint || !subToken) { showToast('알림 인증 정보가 없습니다.'); return; }
        try {
            const qs = `?endpoint=${encodeURIComponent(endpoint)}&subToken=${encodeURIComponent(subToken)}`;
            await fetch(`/api/push/price-alert/${id}${qs}`, { method: 'DELETE' });
            btn.closest('.pa-existing-row')?.remove();
            showToast('알림이 삭제되었습니다.');
        } catch(e) { showToast('삭제에 실패했습니다.'); }
    }

    // 헤더 🔔 버튼 — 구독 토글
    async function _togglePushBell() {
        const state = await getPushState();
        if (state.subscribed) {
            // 이미 구독 중 → 설정 모달 표시 (구독 해제는 모달 내 버튼으로)
            _showNotifSettingsModal();
        } else {
            const ok = await subscribePush();
            if (ok) {
                showToast('알림이 활성화되었습니다 🔔');
                const btn = document.getElementById('pushBellBtn');
                if (btn) btn.style.opacity = '1';
                _showNotifSettingsModal();
            }
        }
    }

    // 알림 설정 모달 — 알림 종류별 ON/OFF + 구독 해제
    function _showNotifSettingsModal() {
        let modal = document.getElementById('notifSettingsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'notifSettingsModal';
            modal.innerHTML = `
            <div class="notif-modal-backdrop" onclick="document.getElementById('notifSettingsModal').style.display='none'"></div>
            <div class="notif-modal-box">
                <div class="notif-modal-header">
                    <span>🔔 알림 설정</span>
                    <button class="notif-modal-close" onclick="document.getElementById('notifSettingsModal').style.display='none'">✕</button>
                </div>
                <div class="notif-modal-body">
                    ${[
                        ['notifBuy',  'buy',  '📈 매수 진입 신호'],
                        ['notifTp',   'tp',   '💰 익절 도달'],
                        ['notifStop', 'stop', '🔴 손절선 이탈'],
                        ['notifPos',  'pos',  '📋 포지션 변화'],
                    ].map(([id, key, label]) => `
                    <label class="notif-row" for="${id}">
                        <span>${label}</span>
                        <input type="checkbox" id="${id}" class="notif-check"
                            onchange="_saveNotifPref('${key}', this.checked)">
                    </label>`).join('')}
                </div>
                <div class="notif-modal-footer">
                    <button class="notif-unsub-btn" onclick="_confirmUnsubPush()">알림 해제</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
        }
        // 체크 상태 동기화
        [['notifBuy','buy'],['notifTp','tp'],['notifStop','stop'],['notifPos','pos']].forEach(([id, k]) => {
            const el = document.getElementById(id);
            if (el) el.checked = localStorage.getItem('stockai_notif_' + k) !== '0';
        });
        const isHidden = !modal.style.display || modal.style.display === 'none';
        modal.style.display = isHidden ? 'flex' : 'none';
    }

    function _saveNotifPref(key, val) {
        localStorage.setItem('stockai_notif_' + key, val ? '1' : '0');
        showToast(val ? `${key === 'buy' ? '매수' : key === 'tp' ? '익절' : key === 'stop' ? '손절' : '포지션'} 알림 켜짐` : `알림 꺼짐`);
    }

    async function _confirmUnsubPush() {
        document.getElementById('notifSettingsModal').style.display = 'none';
        await unsubscribePush();
        showToast('알림이 해제되었습니다.');
        const btn = document.getElementById('pushBellBtn');
        if (btn) btn.style.opacity = '0.4';
    }

    // 종목 상세 페이지 알림 버튼 클릭
    function _openCurrentPriceAlert() {
        const symbol = currentSymbol;
        if (!symbol || currentMarket !== 'US') {
            showToast('미국 주식만 가격 알림을 지원합니다.');
            return;
        }
        const priceEl = document.getElementById('stockPrice');
        const price = priceEl ? parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) : null;
        openPriceAlertModal(symbol, price);
    }

    // 종목 로드 시 알림 버튼 표시 (미국 주식만)
    function _updatePriceAlertBtn() {
        const btn = document.getElementById('priceAlertBtn');
        if (!btn) return;
        btn.style.display = (currentMarket === 'US' && currentSymbol) ? '' : 'none';
    }

    // onclick 핸들러 함수를 window에 명시적 노출 (스코프 안전장치)
    // ===========================
    // 분할 매수 FAB
    // ===========================
    function openCalcFab() {
        document.getElementById('calcFabOverlay').classList.add('open');
        document.getElementById('calcFab').style.display = 'none'; // 모달 열림 중 FAB 숨김
        document.body.style.overflow = 'hidden'; // 뒤 스크롤 차단
        // 현재 종목 라벨
        const lbl = document.getElementById('fabStockLabel');
        if (lbl) {
            const sym = document.querySelector('.hero-ticker')?.textContent?.trim() || '';
            lbl.textContent = sym ? '— ' + sym : '';
        }
        renderCalcFabContent();
        // 스크롤 위치 초기화 — 이전 열기 상태 복원 방지 (renderCalcFabContent 이후 실행)
        const fabBody = document.getElementById('calcFabBody');
        if (fabBody) fabBody.scrollTop = 0;
    }

    function closeCalcFab() {
        document.getElementById('calcFabOverlay').classList.remove('open');
        document.getElementById('calcFab').style.display = ''; // FAB 복원
        document.body.style.overflow = '';
        hideLoading(); // 혹시 잔류하는 로딩 오버레이 강제 해제
    }

    // 숫자 입력 콤마 포매팅 헬퍼
    function _fabCommaFmt(el) {
        const cursorPos = el.selectionStart;
        const prevLen   = el.value.length;
        const raw = el.value.replace(/,/g, '').replace(/[^\d.]/g, '');
        if (!raw) { el.value = ''; _calcSplitFab(); return; }
        const parts = raw.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        el.value = parts.length > 1 ? parts[0] + '.' + parts[1] : parts[0];
        const diff = el.value.length - prevLen;
        el.setSelectionRange(cursorPos + diff, cursorPos + diff);
        // 1차 가격 또는 ATR 변경 시 → 2~5차 자동 계산
        if (el.id === 'fabP0' || el.id === 'fabAtr') _fabAutoFillPrices();
        _calcSplitFab();
    }

    function _fabAutoFillPrices() {
        const sc   = window._sc;
        const isKR = sc ? sc.isKR : (typeof currentMarket !== 'undefined' && currentMarket === 'KR');
        const strip = v => parseFloat((v||'').replace(/,/g,'')) || 0;
        const p0  = strip(document.getElementById('fabP0')?.value);
        const atr = strip(document.getElementById('fabAtr')?.value);
        if (!p0 || !atr) return;
        const toComma = v => {
            if (isKR) return Math.round(v).toLocaleString('en-US');
            return parseFloat(v.toFixed(v >= 10 ? 2 : v >= 1 ? 3 : 4)).toString();
        };
        // 매수 2~3차 — 하락할수록 더 큰 ATR 배수 (분할 매수 3단계)
        const buyMults = [0.5, 1.0];
        buyMults.forEach((m, i) => {
            const el = document.getElementById('fabP' + (i + 1));
            if (el && !el.dataset.userEdited) {
                el.value = toComma(Math.max(0, p0 - atr * m));
            }
        });
        // 매도 1~3차 — 상승할수록 더 큰 ATR 배수 (분할 매도 3단계)
        const sellMults = [1.5, 3.0, 5.0];
        sellMults.forEach((m, i) => {
            const el = document.getElementById('fabS' + i);
            if (el && !el.dataset.userEdited) {
                el.value = toComma(p0 + atr * m);
            }
        });
    }

    function renderCalcFabContent() {
        try {
        const sc   = window._sc;
        const isKR = sc ? sc.isKR : (typeof currentMarket !== 'undefined' && currentMarket === 'KR');
        const unit = isKR ? '원' : 'USD';
        const ph   = isKR ? '예: 1000000' : 'e.g. 10000';
        const step = isKR ? '1' : '0.01';
        const fmtV = v => {
            if (v == null || isNaN(v)) return 0;
            return isKR ? Math.round(v) : parseFloat(Number(v).toFixed(2));
        };

        const badgeStyles = [
            'background:rgba(12,245,176,.22);color:var(--green)',
            'background:rgba(234,179,8,.18);color:var(--yellow)',
            'background:rgba(255,69,58,.18);color:var(--red)'
        ];
        const priceLabels = ['즉시 진입', 'ATR × 0.5', 'ATR × 1.0'];

        const toComma = v => v === '' || v == null ? '' : Number(v).toLocaleString('en-US', {maximumFractionDigits: isKR ? 0 : 2});
        const priceRows = priceLabels.map((lbl, i) => {
            const p = sc?.prices?.[i];
            const val = (p != null && !isNaN(p)) ? toComma(fmtV(p)) : '';
            return `<div class="fab-price-row">
                <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;${badgeStyles[i]};flex-shrink:0;">${i+1}차</span>
                <span class="fab-price-lbl">${lbl}</span>
                <input type="text" inputmode="decimal" class="fab-price-input" id="fabP${i}" value="${val}" placeholder="${ph}" oninput="_fabCommaFmt(this)" ${i > 0 ? 'onfocus="delete this.dataset.userEdited" onblur="if(this.value)this.dataset.userEdited=\'1\'"' : ''}>
            </div>`;
        }).join('');

        // ── 분할매도 (5단계) ──
        const sellBadgeStyles = [
            'background:rgba(0,128,251,.18);color:var(--blue)',
            'background:rgba(34,211,238,.18);color:var(--cyan)',
            'background:rgba(191,90,242,.18);color:var(--purple)',
        ];
        const sellLabels = ['ATR × 1.5', 'ATR × 3.0', 'ATR × 5.0'];

        // ATR 값
        const atrVal  = (sc && typeof sc.atr === 'number' && !isNaN(sc.atr)) ? sc.atr : 0;
        const atrFmt  = atrVal ? (isKR ? Math.round(atrVal).toLocaleString() : parseFloat(atrVal.toFixed(4)).toString()) : '';

        // 진입가 + ATR×N 으로 기본값 자동 계산
        const baseEntry = (sc?.prices?.[0] != null && !isNaN(sc.prices[0])) ? sc.prices[0] : 0;
        const sellDefaults = [1.5, 3.0, 5.0].map(m => baseEntry > 0 && atrVal > 0 ? baseEntry + atrVal * m : 0);
        const sellRows = sellLabels.map((lbl, i) => {
            const val = sellDefaults[i] > 0 ? toComma(fmtV(sellDefaults[i])) : '';
            return `<div class="fab-price-row">
                <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;${sellBadgeStyles[i]};flex-shrink:0;">${i+1}차</span>
                <span class="fab-price-lbl">${lbl}</span>
                <input type="text" inputmode="decimal" class="fab-price-input" id="fabS${i}" value="${val}" placeholder="${ph}" oninput="_fabCommaFmt(this)" onfocus="delete this.dataset.userEdited" onblur="if(this.value)this.dataset.userEdited='1'">
            </div>`;
        }).join('');
        const autoTag = sc
            ? `<span style="font-size:10px;color:var(--cyan);font-weight:500;">ATR 자동 입력됨</span>`
            : `<span style="font-size:10px;color:var(--text3);">직접 입력하세요</span>`;

        document.getElementById('calcFabBody').innerHTML = `
            <div class="fab-sec-title">진입가 설정 ${autoTag}</div>
            <div style="background:var(--bg3);border-radius:var(--r2);padding:4px 12px;margin-bottom:12px;" data-atr="${atrVal}">${priceRows}</div>
            <div class="sc-input-group" style="margin-bottom:12px;">
                <label style="font-size:11px;color:var(--text3);">ATR <span style="font-weight:400;">(자동 계산 기준 — 1차 입력 시 2~5차 자동 채움)</span></label>
                <input type="text" inputmode="decimal" id="fabAtr" placeholder="${isKR ? '예: 2500' : 'e.g. 1.25'}" value="${atrFmt}" oninput="_fabCommaFmt(this)" style="font-size:13px;">
            </div>

            <div class="sc-input-grid">
                <div class="sc-input-group">
                    <label>총 투자 예산 (${unit})</label>
                    <input type="text" inputmode="decimal" id="fabBudget" placeholder="${ph}" oninput="_fabCommaFmt(this)">
                </div>
                <div class="sc-input-group">
                    <label>1차 투자금액 (${unit})</label>
                    <input type="text" inputmode="decimal" id="fabFirst" placeholder="${ph}" oninput="_fabCommaFmt(this)">
                </div>
            </div>
            <div class="sc-input-group" style="margin-bottom:14px;">
                <label>비중 방식</label>
                <select id="fabMode" onchange="_calcSplitFab()">
                    <option value="equal">균등 배분 (33% × 3)</option>
                    <option value="pyramid">역피라미드 — 하락할수록 더 많이 (20·30·50%)</option>
                    <option value="front">전방 집중 — 지금 더 많이 (50·30·20%)</option>
                </select>
            </div>

            <div style="overflow-x:auto;">
                <table class="sc-tbl">
                    <thead><tr>
                        <th>차수</th><th>진입가</th><th>투자액</th><th>수량</th><th>누계</th><th>평단가</th>
                    </tr></thead>
                    <tbody id="fabTableBody">
                        <tr><td colspan="6" style="text-align:center;color:var(--text3);padding:20px;font-size:13px;">💡 예산을 입력하면 자동 계산됩니다</td></tr>
                    </tbody>
                </table>
            </div>
            <div id="fabSummary"></div>

            <!-- ===== 분할 매도 (5단계) ===== -->
            <div style="margin-top:22px;padding-top:16px;border-top:1px solid var(--border);">
                <div class="fab-sec-title" style="display:flex;align-items:center;gap:8px;">
                    <span>📤 분할 매도 (5단계)</span>
                    <span style="font-size:10px;color:var(--text3);font-weight:400;">진입가 + ATR×N 자동 입력</span>
                </div>
                <div style="background:var(--bg3);border-radius:var(--r2);padding:4px 12px;margin-bottom:12px;">${sellRows}</div>
                <div class="sc-input-group" style="margin-bottom:14px;">
                    <label>매도 비중 방식</label>
                    <select id="fabSellMode" onchange="_calcSplitFab()">
                        <option value="equal">균등 분할 (33% × 3)</option>
                        <option value="pyramid">피라미드 — 상승할수록 더 많이 (20·30·50%)</option>
                        <option value="front" selected>전방 집중 — 초반 익절 (50·30·20%)</option>
                    </select>
                </div>
                <div style="overflow-x:auto;">
                    <table class="sc-tbl">
                        <thead><tr>
                            <th>차수</th><th>매도가</th><th>수량</th><th>매도액</th><th>실현 수익</th><th>누적 수익</th>
                        </tr></thead>
                        <tbody id="fabSellTableBody">
                            <tr><td colspan="6" style="text-align:center;color:var(--text3);padding:20px;font-size:13px;">💡 매수 입력 후 매도 계산이 표시됩니다</td></tr>
                        </tbody>
                    </table>
                </div>
                <div id="fabSellSummary"></div>
            </div>

            ${sc && (sc.tp1 || sc.sl) ? `<div style="font-size:11px;color:var(--text3);text-align:center;margin-top:14px;padding:8px;background:var(--bg3);border-radius:var(--r2);">
                손절가: <b>${sc.sl ? (isKR ? Math.round(sc.sl).toLocaleString()+'원' : '$'+sc.sl.toFixed(2)) : 'N/A'}</b>
                &nbsp;·&nbsp;
                TP1: <b>${sc.tp1 ? (isKR ? Math.round(sc.tp1).toLocaleString()+'원' : '$'+sc.tp1.toFixed(2)) : 'N/A'}</b>
            </div>` : ''}
        `;
        } catch (err) {
            console.error('[renderCalcFabContent]', err);
            const body = document.getElementById('calcFabBody');
            if (body) {
                body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text2);font-size:13px;line-height:1.7;">
                    ⚠️ 계산기 렌더 오류<br>
                    <small style="color:var(--text3);">${(err.message || err).toString().slice(0,200)}</small><br><br>
                    종목 검색 후 분석이 완료되면 정상 작동합니다.
                </div>`;
            }
        }
    }

    function _calcSplitFab() {
        const sc       = window._sc;
        const isKR     = sc ? sc.isKR : (typeof currentMarket !== 'undefined' && currentMarket === 'KR');
        const stripC   = v => (v||'').replace(/,/g,'');
        const budget   = parseFloat(stripC(document.getElementById('fabBudget')?.value)) || 0;
        const firstAmt = parseFloat(stripC(document.getElementById('fabFirst')?.value))  || 0;
        const mode     = document.getElementById('fabMode')?.value || 'equal';
        const prices   = [0,1,2].map(i => parseFloat(stripC(document.getElementById('fabP'+i)?.value)) || 0);
        const tp1      = sc?.tp1  || null;
        const slPrice  = sc?.sl   || null;

        if (!budget) {
            document.getElementById('fabTableBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:20px;font-size:13px;">💡 예산을 입력하면 자동 계산됩니다</td></tr>';
            document.getElementById('fabSummary').innerHTML = '';
            return;
        }

        const fmtP  = v => isKR ? Math.round(v).toLocaleString()+'원' : '$'+v.toFixed(2);
        const fmtA  = v => isKR ? Math.round(v).toLocaleString()+'원' : '$'+(v<1000?v.toFixed(2):Math.round(v).toLocaleString());
        const fmtSh = v => isKR ? Math.round(v).toLocaleString()+'주' : (v>=1?v.toFixed(2):v.toFixed(4))+'주';

        const allW = { equal:[33,33,34], pyramid:[20,30,50], front:[50,30,20] };
        const remW = { equal:[50,50],    pyramid:[30,70],     front:[70,30]   };

        let amounts;
        if (firstAmt > 0) {
            const rem = Math.max(0, budget - firstAmt);
            const rw  = remW[mode]; const rwS = rw.reduce((a,b)=>a+b,0);
            amounts = [firstAmt, ...rw.map(w => rem * w / rwS)];
        } else {
            amounts = allW[mode].map(w => budget * w / 100);
        }

        let cumShares = 0, cumInvested = 0;
        const rows = prices.map((price, i) => {
            const amt    = amounts[i] || 0;
            const shares = price > 0 ? amt / price : 0;
            cumShares   += shares;
            cumInvested += amt;
            return { price, amt, shares, cumInvested, avgP: cumShares > 0 ? cumInvested / cumShares : 0 };
        });

        const badges = [
            'background:rgba(12,245,176,.22);color:var(--green)',
            'background:rgba(234,179,8,.18);color:var(--yellow)',
            'background:rgba(255,69,58,.18);color:var(--red)'
        ];

        document.getElementById('fabTableBody').innerHTML = rows.map((r, i) =>
            r.price > 0 ? `<tr>
                <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;${badges[i]}">${i+1}차</span></td>
                <td>${fmtP(r.price)}</td>
                <td style="font-weight:600">${fmtA(r.amt)}</td>
                <td style="color:var(--text2)">${fmtSh(r.shares)}</td>
                <td style="color:var(--text3);font-size:12px">${fmtA(r.cumInvested)}</td>
                <td style="font-weight:800;color:var(--cyan)">${fmtP(r.avgP)}</td>
            </tr>` : ''
        ).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px;font-size:13px;">진입가를 입력해 주세요</td></tr>';

        const validRows = rows.filter(r => r.price > 0);
        if (!validRows.length) return;
        const finalAvg = validRows[validRows.length-1].avgP;
        const totalSh  = cumShares;

        let html = `<div class="sc-summary">
            <div class="sc-sum-item"><div class="sc-sum-label">총 투자금액</div><div class="sc-sum-val">${fmtA(budget)}</div></div>
            <div class="sc-sum-item"><div class="sc-sum-label">전량 매수시 평균가</div><div class="sc-sum-val" style="color:var(--cyan)">${fmtP(finalAvg)}</div></div>`;

        if (tp1 && tp1 > finalAvg) {
            const profit = (tp1-finalAvg)*totalSh, pct = (tp1-finalAvg)/finalAvg*100;
            html += `<div class="sc-sum-item" style="border:1px solid rgba(0,128,251,.25);background:rgba(0,128,251,.05);">
                <div class="sc-sum-label">TP1 (${fmtP(tp1)}) 도달시 수익</div>
                <div class="sc-sum-val" style="color:var(--green)">+${fmtA(profit)} <small style="font-size:11px">(+${pct.toFixed(1)}%)</small></div>
            </div>`;
        }
        if (slPrice && slPrice < finalAvg) {
            const loss = (slPrice-finalAvg)*totalSh, pct = (slPrice-finalAvg)/finalAvg*100;
            html += `<div class="sc-sum-item" style="border:1px solid rgba(255,69,58,.25);background:rgba(255,69,58,.05);">
                <div class="sc-sum-label">손절 (${fmtP(slPrice)}) 도달시 손실</div>
                <div class="sc-sum-val" style="color:var(--red)">${fmtA(loss)} <small style="font-size:11px">(${pct.toFixed(1)}%)</small></div>
            </div>`;
        }
        html += '</div>';

        if (tp1 && slPrice && tp1 > finalAvg && slPrice < finalAvg) {
            const rr = (tp1-finalAvg)/(finalAvg-slPrice);
            const col = rr>=2 ? 'var(--green)' : rr>=1.5 ? 'var(--yellow)' : 'var(--red)';
            html += `<div style="text-align:center;margin-top:10px;padding:9px;background:var(--bg3);border-radius:var(--r2);font-size:13px;color:var(--text2);">
                평균매수가 기준 손익비 <span style="font-weight:800;font-size:16px;color:${col};margin-left:4px;">1 : ${rr.toFixed(2)}</span>
            </div>`;
        }
        document.getElementById('fabSummary').innerHTML = html;

        // ── 분할 매도 계산 ──
        _calcSplitSellFab(finalAvg, totalSh);
    }

    function _calcSplitSellFab(avgEntry, totalShares) {
        const sellTbody = document.getElementById('fabSellTableBody');
        const sellSummary = document.getElementById('fabSellSummary');
        if (!sellTbody) return;
        if (!totalShares || totalShares <= 0 || !avgEntry || avgEntry <= 0) {
            sellTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px;font-size:13px;">💡 매수 입력 후 매도 계산이 표시됩니다</td></tr>';
            if (sellSummary) sellSummary.innerHTML = '';
            return;
        }
        const sc = window._sc;
        const isKR = sc ? sc.isKR : (typeof currentMarket !== 'undefined' && currentMarket === 'KR');
        const stripC = v => (v||'').replace(/,/g,'');
        const sellMode = document.getElementById('fabSellMode')?.value || 'front';
        const sellPrices = [0,1,2].map(i => parseFloat(stripC(document.getElementById('fabS'+i)?.value)) || 0);

        const fmtP  = v => isKR ? Math.round(v).toLocaleString()+'원' : '$'+v.toFixed(2);
        const fmtA  = v => isKR ? Math.round(v).toLocaleString()+'원' : '$'+(v<1000?v.toFixed(2):Math.round(v).toLocaleString());
        const fmtSh = v => isKR ? Math.round(v).toLocaleString()+'주' : (v>=1?v.toFixed(2):v.toFixed(4))+'주';

        // 매도 비중 분배 (각 차수에 매도할 주식 비율 — 3단계)
        const weights = sellMode === 'equal' ? [33,33,34]
                      : sellMode === 'pyramid' ? [20,30,50]
                      : [50,30,20]; // front (default)

        const sellBadges = [
            'background:rgba(0,128,251,.18);color:var(--blue)',
            'background:rgba(34,211,238,.18);color:var(--cyan)',
            'background:rgba(191,90,242,.18);color:var(--purple)',
        ];

        let cumProfit = 0, cumSold = 0;
        const rows = sellPrices.map((sellP, i) => {
            const shares = totalShares * weights[i] / 100;
            const sellAmt = sellP * shares;
            const cost = avgEntry * shares;
            const profit = sellAmt - cost;
            cumSold += shares;
            cumProfit += profit;
            const pct = avgEntry ? (sellP - avgEntry) / avgEntry * 100 : 0;
            return { sellP, shares, sellAmt, profit, cumProfit, pct };
        });

        sellTbody.innerHTML = rows.map((r, i) =>
            r.sellP > 0 ? `<tr>
                <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;${sellBadges[i]}">${i+1}차</span></td>
                <td>${fmtP(r.sellP)} <small style="color:var(--text3);font-size:11px;">(${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(1)}%)</small></td>
                <td style="color:var(--text2)">${fmtSh(r.shares)}</td>
                <td style="font-weight:600">${fmtA(r.sellAmt)}</td>
                <td style="color:${r.profit >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:700;">${r.profit >= 0 ? '+' : ''}${fmtA(r.profit)}</td>
                <td style="font-weight:800;color:${r.cumProfit >= 0 ? 'var(--green)' : 'var(--red)'};">${r.cumProfit >= 0 ? '+' : ''}${fmtA(r.cumProfit)}</td>
            </tr>` : ''
        ).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px;font-size:13px;">매도가를 입력해 주세요</td></tr>';

        // 매도 요약: 5단계 모두 도달 시 총 수익
        const validSells = rows.filter(r => r.sellP > 0);
        if (validSells.length && sellSummary) {
            const totalProfit = validSells[validSells.length-1].cumProfit;
            const totalCost = avgEntry * cumSold;
            const totalPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
            const avgSell = cumSold > 0 ? validSells.reduce((s, r) => s + r.sellP * r.shares, 0) / cumSold : 0;
            sellSummary.innerHTML = `<div class="sc-summary" style="margin-top:10px;">
                <div class="sc-sum-item" style="border:1px solid rgba(12,245,176,.25);background:rgba(12,245,176,.05);">
                    <div class="sc-sum-label">전량 매도 시 평균매도가</div>
                    <div class="sc-sum-val" style="color:var(--cyan)">${fmtP(avgSell)}</div>
                </div>
                <div class="sc-sum-item" style="border:1px solid rgba(12,245,176,.25);background:rgba(12,245,176,.05);">
                    <div class="sc-sum-label">5단계 전량 도달 시 수익</div>
                    <div class="sc-sum-val" style="color:var(--green)">+${fmtA(totalProfit)} <small style="font-size:11px">(+${totalPct.toFixed(1)}%)</small></div>
                </div>
            </div>`;
        } else if (sellSummary) {
            sellSummary.innerHTML = '';
        }
    }
    let _optPopData = null;
    let _optPopTab = 'call';

    async function loadOptionsPopular() {
        const sec = document.getElementById('optionsPopularSection');
        const el = document.getElementById('optionsPopularList');
        if (!sec || !el) return;
        sec.style.display = '';

        // localStorage 캐시 (10분 TTL) — v3 갱신 (TOP 15 확장)
        const CK = 'stockai_optpop_v3';
        try {
            const cached = JSON.parse(localStorage.getItem(CK) || 'null');
            if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
                _optPopData = cached;
                _renderOptionsPopular();
                return;
            }
        } catch(e){}

        // 새 서버 엔드포인트 우선 시도, 실패 시 클라이언트 집계
        try {
            const r = await fetch('/api/options-popular', { signal: AbortSignal.timeout(10000) });
            if (r.ok) {
                const data = await r.json();
                if (data.topCalls?.length || data.topPuts?.length) {
                    _optPopData = data;
                    try { localStorage.setItem(CK, JSON.stringify({...data, ts: Date.now()})); } catch(e){}
                    _renderOptionsPopular();
                    return;
                }
            }
        } catch(e){}

        // ── 클라이언트 사이드 폴백: 기존 엔드포인트로 집계 ──
        try {
            const sr = await fetch('/api/screener/most_actives?count=40', { signal: AbortSignal.timeout(10000) });
            if (!sr.ok) throw new Error('screener ' + sr.status);
            const sj = await sr.json();
            const symbols = (sj?.finance?.result?.[0]?.quotes || [])
                .map(q => q.symbol)
                .filter(s => s && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s))
                .slice(0, 30);

            // 4개씩 청크 단위 옵션 fetch (서버/네트워크 부담 완화)
            const fetchOne = async (sym) => {
                try {
                    const or = await fetch(`/api/options/${encodeURIComponent(sym)}`, { signal: AbortSignal.timeout(10000) });
                    if (!or.ok) return null;
                    const od = await or.json();
                    const result = od?.optionChain?.result?.[0];
                    if (!result?.options?.[0]) return null;
                    const meta = result.quote || {};
                    const opts = result.options[0];
                    const callVol = (opts.calls || []).reduce((s, o) => s + (Number(o.volume) || 0), 0);
                    const putVol = (opts.puts || []).reduce((s, o) => s + (Number(o.volume) || 0), 0);
                    const topCall = (opts.calls || []).slice().sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
                    const topPut = (opts.puts || []).slice().sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
                    return {
                        symbol: sym,
                        name: meta.longName || meta.shortName || sym,
                        price: meta.regularMarketPrice || 0,
                        change: meta.regularMarketChangePercent || 0,
                        callVol, putVol,
                        topCallStrike: topCall?.strike || null,
                        topPutStrike: topPut?.strike || null,
                    };
                } catch(e) { return null; }
            };
            const CHUNK = 4;
            const results = [];
            for (let i = 0; i < symbols.length; i += CHUNK) {
                const chunk = symbols.slice(i, i + CHUNK);
                const settled = await Promise.allSettled(chunk.map(fetchOne));
                settled.forEach(s => { if (s.status === 'fulfilled' && s.value) results.push(s.value); });
            }
            // 콜/풋 각각의 절대 거래량 기준 TOP 15 (우세 비교 없이)
            const topCalls = results
                .filter(r => r.callVol > 500)
                .sort((a, b) => b.callVol - a.callVol).slice(0, 15);
            const topPuts = results
                .filter(r => r.putVol > 500)
                .sort((a, b) => b.putVol - a.putVol).slice(0, 15);

            if (!topCalls.length && !topPuts.length) {
                el.innerHTML = '<div class="top100-loading" style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">옵션 거래 데이터를 가져오지 못했습니다.</div>';
                return;
            }

            const data = { topCalls, topPuts, ts: Date.now() };
            _optPopData = data;
            try { localStorage.setItem(CK, JSON.stringify(data)); } catch(e){}
            _renderOptionsPopular();
        } catch (e) {
            warn('[opt-popular fallback]', e.message);
            el.innerHTML = `<div class="top100-loading" style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">옵션 데이터를 불러올 수 없습니다.<br><span style="font-size:11px;opacity:0.7;">잠시 후 다시 시도해주세요</span></div>`;
        }
    }

    function _optPopSwitch(tab) {
        _optPopTab = tab;
        document.querySelectorAll('.opt-pop-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        _renderOptionsPopular();
    }

    function _renderOptionsPopular() {
        const el = document.getElementById('optionsPopularList');
        if (!el || !_optPopData) return;
        const list = _optPopTab === 'call' ? _optPopData.topCalls : _optPopData.topPuts;
        if (!list?.length) {
            el.innerHTML = `<div class="top100-loading" style="padding:20px;text-align:center;color:var(--text3);">${_optPopTab === 'call' ? '콜' : '풋'} 우세 종목이 없습니다.</div>`;
            return;
        }
        const isCall = _optPopTab === 'call';
        el.innerHTML = list.map((r, i) => {
            const sym = String(r.symbol || '').replace(/[<>"']/g, '');
            const name = String(r.name || sym).replace(/[<>"']/g, '');
            const price = r.price ? `$${Number(r.price).toFixed(2)}` : '-';
            const chg = r.change != null ? Number(r.change).toFixed(2) : '0';
            const chgClass = (r.change || 0) >= 0 ? 'up' : 'down';
            const chgSign = (r.change || 0) >= 0 ? '+' : '';
            const vol = isCall ? r.callVol : r.putVol;
            const oppVol = isCall ? r.putVol : r.callVol;
            const dominance = vol > 0 ? Math.round((vol / (vol + oppVol)) * 100) : 0;
            const strike = isCall ? r.topCallStrike : r.topPutStrike;
            const fmtVol = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n);
            return `<div class="opt-pop-row" onclick="quickSearch('${sym}','US')">
                <span class="opt-pop-rank">${i + 1}</span>
                <div class="tlogo-wrap">
                    <img class="tlogo" src="https://assets.parqet.com/logos/symbol/${sym}?format=png" alt="" loading="lazy" onerror="this.outerHTML='<span class=\\'tlogo tlogo-fb\\'>${sym[0] || '?'}</span>'">
                    <span class="tlogo-flag">🇺🇸</span>
                </div>
                <div class="opt-pop-info">
                    <div class="opt-pop-sym">${sym}</div>
                    <div class="opt-pop-name">${name}</div>
                </div>
                <div class="opt-pop-meta">
                    <div class="opt-pop-vol ${isCall ? 'call' : 'put'}">${fmtVol(vol)} ${isCall ? '콜' : '풋'}</div>
                    <div class="opt-pop-dom">${dominance}% 우세${strike ? ` · $${strike}` : ''}</div>
                </div>
                <div class="opt-pop-price">
                    <div class="opt-pop-px">${price}</div>
                    <div class="opt-pop-chg ${chgClass}">${chgSign}${chg}%</div>
                </div>
            </div>`;
        }).join('');
    }

    // 뉴스 탭
    // ========================================
    let _newsCache = {};
    const NEWS_CACHE_MS = 5 * 60 * 1000; // 5분

    async function loadNewsTab(symbol) {
        document.getElementById('stockHero')?.classList.add('show');
        const list  = document.getElementById('newsList');
        const label = document.getElementById('newsSymbolLabel');
        if (!list) return;
        if (label) label.textContent = currentSymbol;

        // 캐시 유효하면 즉시 렌더
        if (_newsCache[symbol] && Date.now() - _newsCache[symbol].ts < NEWS_CACHE_MS) {
            renderNewsList(_newsCache[symbol].items);
            return;
        }

        // 스켈레톤
        list.innerHTML = Array(6).fill(0).map(() => `
            <div class="news-card news-skel" style="pointer-events:none">
                <div class="news-thumb-wrap skel-block" style="border-radius:10px"></div>
                <div class="news-body" style="display:flex;flex-direction:column;gap:6px">
                    <div class="skel-block" style="height:13px;width:90%;border-radius:4px"></div>
                    <div class="skel-block" style="height:13px;width:70%;border-radius:4px"></div>
                    <div class="skel-block" style="height:11px;width:40%;border-radius:4px;margin-top:4px"></div>
                </div>
            </div>`).join('');

        try {
            const res   = await fetch(`/api/news/${encodeURIComponent(symbol)}?limit=12`);
            const data  = await res.json();
            const items = data.news || [];
            _newsCache[symbol] = { ts: Date.now(), items };
            renderNewsList(items);
        } catch(e) {
            list.innerHTML = tabError('뉴스를 불러올 수 없습니다.', 'reloadNewsTab()');
        }
    }

    function reloadNewsTab() {
        if (!currentFullSymbol) return;
        delete _newsCache[currentFullSymbol];
        loadNewsTab(currentFullSymbol);
    }

    // IntersectionObserver: 뷰포트 300px 전에 미리 이미지 로드 시작 (스크롤 시 placeholder flash 제거)
    let _imgPreloadObserver = null;
    function _getImgPreloadObserver() {
        if (_imgPreloadObserver) return _imgPreloadObserver;
        if (!('IntersectionObserver' in window)) return null;
        _imgPreloadObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const img = entry.target;
                const src = img.getAttribute('data-src');
                if (src && !img.src) img.src = src;
                _imgPreloadObserver.unobserve(img);
            });
        }, { rootMargin: '300px 0px', threshold: 0.01 });
        return _imgPreloadObserver;
    }
    function _observeLazyImages(root) {
        const obs = _getImgPreloadObserver();
        const imgs = (root || document).querySelectorAll('img[data-src]:not([data-lazy-bound])');
        imgs.forEach(img => {
            img.setAttribute('data-lazy-bound', '1');
            if (obs) {
                obs.observe(img);
            } else {
                // IO 미지원 브라우저 — 즉시 로드
                const src = img.getAttribute('data-src');
                if (src) img.src = src;
            }
        });
    }

    // 뉴스 키워드 필터 (제목/출처 기반). 선택 시 렌더 재실행.
    const _NEWS_FILTER_DEFS = [
        { key: 'all',       label: '전체',     match: null },
        { key: 'earnings',  label: '실적',     match: /실적|earnings|revenue|guidance|EPS/i },
        { key: 'rating',    label: '평가',     match: /다운그레이드|업그레이드|목표가|가이던스|downgrade|upgrade|price target|analyst/i },
        { key: 'merger',    label: 'M&A',      match: /인수|합병|merger|acquisition|takeover|M&A|buyout/i },
        { key: 'ai',        label: 'AI',       match: /AI|인공지능|LLM|GPT|머신러닝|machine learning|generative/i },
        { key: 'crypto',    label: '암호화폐', match: /비트코인|이더리움|crypto|bitcoin|ethereum|BTC|ETH/i },
        { key: 'macro',     label: '매크로',   match: /연준|금리|Fed|FOMC|rate|inflation|CPI|PCE|yield|treasury/i },
    ];
    let _newsAllItems = [];
    let _newsActiveFilter = 'all';

    function _filterNewsItems(items, key) {
        const def = _NEWS_FILTER_DEFS.find(d => d.key === key);
        if (!def || !def.match) return items;
        return items.filter(n => {
            const hay = `${n.titleKo || ''} ${n.title || ''} ${n.source || ''}`;
            return def.match.test(hay);
        });
    }

    function _renderNewsFilterBar(items) {
        const bar = document.getElementById('newsFilterBar');
        if (!bar) return;
        bar.innerHTML = _NEWS_FILTER_DEFS.map(d => {
            const count = d.match ? items.filter(n => d.match.test(`${n.titleKo || ''} ${n.title || ''} ${n.source || ''}`)).length : items.length;
            const active = (d.key === _newsActiveFilter) ? ' active' : '';
            // count 0 이면 렌더 스킵 (all 제외)
            if (d.key !== 'all' && count === 0) return '';
            return `<button class="news-filter-chip${active}" data-nf-key="${d.key}" role="tab" aria-selected="${d.key === _newsActiveFilter}">${d.label}<span class="nf-count">${count}</span></button>`;
        }).join('');
        bar.querySelectorAll('.news-filter-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                _newsActiveFilter = btn.getAttribute('data-nf-key');
                _renderNewsFilterBar(_newsAllItems);
                _renderNewsCards(_filterNewsItems(_newsAllItems, _newsActiveFilter));
            });
        });
    }

    function _renderNewsCards(items) {
        const list = document.getElementById('newsList');
        if (!list) return;
        if (!items || !items.length) {
            list.innerHTML = '<div class="news-empty">필터에 해당하는 뉴스가 없습니다.</div>';
            return;
        }
        list.innerHTML = items.map(n => {
            const ago  = _newsTimeAgo(n.publishedTime);
            const safe = (n.link || '#').replace(/"/g, '&quot;');
            const safeThumb = n.thumbnail ? n.thumbnail.replace(/"/g, '&quot;') : '';
            const thumb = n.thumbnail
                ? `<img class="news-thumb" data-src="${safeThumb}" alt="" decoding="async" loading="lazy" onerror="this.parentNode.innerHTML='<div class=news-thumb-placeholder><svg width=22 height=22 viewBox=&quot;0 0 24 24&quot; fill=none stroke=currentColor stroke-width=1.8><rect x=3 y=3 width=18 height=18 rx=2/><path d=&quot;M3 9h18M9 21V9&quot;/></svg></div>'">`
                : `<div class="news-thumb-placeholder"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></div>`;
            return `<a class="news-card" href="${safe}" target="_blank" rel="noopener noreferrer">
                <div class="news-thumb-wrap">${thumb}</div>
                <div class="news-body">
                    <div class="news-title">${escHtml(n.titleKo || n.title || '')}</div>
                    <div class="news-meta"><span class="news-source">${escHtml(n.source || '')}</span>${n.source ? ' · ' : ''}${ago}</div>
                </div>
            </a>`;
        }).join('');
        _observeLazyImages(list);
    }

    function renderNewsList(items) {
        const list = document.getElementById('newsList');
        const bar = document.getElementById('newsFilterBar');
        if (!list) return;
        _newsAllItems = items || [];
        if (!_newsAllItems.length) {
            if (bar) bar.innerHTML = '';
            list.innerHTML = '<div class="news-empty">해당 종목 관련 최신 뉴스가 없습니다.</div>';
            return;
        }
        _newsActiveFilter = 'all';
        _renderNewsFilterBar(_newsAllItems);
        _renderNewsCards(_filterNewsItems(_newsAllItems, _newsActiveFilter));
    }

    function _newsTimeAgo(unixTs) {
        if (!unixTs) return '';
        const diff = Math.floor((Date.now() / 1000) - unixTs);
        if (diff < 60)    return '방금 전';
        if (diff < 3600)  return Math.floor(diff / 60) + '분 전';
        if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
        return Math.floor(diff / 86400) + '일 전';
    }

    // ========================================
    // 탭 순서 설정
    // ========================================
    const TAB_ORDER_KEY = 'stockai_tab_order';
    const TAB_DEFS = [
        { tab: 'chart',    label: '차트' },
        { tab: 'info',     label: '종목정보' },
        { tab: 'company',  label: '기업개요' },
        { tab: 'options',  label: '옵션' },
        { tab: 'news',     label: '뉴스' },
        { tab: 'social',   label: '토론' },
        { tab: 'short',    label: '공매도' },
        { tab: 'youtube',  label: '유튜브' },
    ];

    function loadTabOrder() {
        try {
            const saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY));
            if (!Array.isArray(saved) || saved.length < 2) return;
            const nav = document.getElementById('tabNav');
            if (!nav) return;
            const btns = [...nav.querySelectorAll('.tab-item')];
            const orderBtn = nav.querySelector('.tab-order-btn');
            // 저장된 순서대로 먼저 이동
            saved.forEach(tabName => {
                const btn = btns.find(b => b.dataset.tab === tabName);
                if (btn) nav.insertBefore(btn, orderBtn);
            });
            // 저장된 순서에 없는 새 탭(youtube 등)은 맨 뒤에 붙임
            btns.filter(b => !saved.includes(b.dataset.tab))
                .forEach(btn => nav.insertBefore(btn, orderBtn));
        } catch(e) {}
    }

    function openTabOrderModal() {
        const list = document.getElementById('tabOrderList');
        if (!list) return;
        // 현재 탭 순서 기준으로 목록 렌더
        const nav = document.getElementById('tabNav');
        const currentOrder = [...nav.querySelectorAll('.tab-item')].map(b => b.dataset.tab);
        list.innerHTML = currentOrder.map(tabName => {
            const def = TAB_DEFS.find(d => d.tab === tabName);
            const label = def?.label || tabName;
            return `<div class="tab-order-item" draggable="true" data-tab="${tabName}">
                <span class="tab-order-handle">⠿</span>
                <span class="tab-order-label">${label}</span>
            </div>`;
        }).join('');
        initTabOrderDrag(list);
        document.getElementById('tabOrderOverlay').classList.add('show');
        document.getElementById('tabOrderModal').classList.add('show');
    }

    function closeTabOrderModal() {
        document.getElementById('tabOrderOverlay').classList.remove('show');
        document.getElementById('tabOrderModal').classList.remove('show');
    }

    function saveTabOrder() {
        const list = document.getElementById('tabOrderList');
        if (!list) return;
        const newOrder = [...list.querySelectorAll('.tab-order-item')].map(el => el.dataset.tab);
        try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(newOrder)); } catch(e) {}
        // DOM 탭 버튼 순서 적용
        const nav = document.getElementById('tabNav');
        const orderBtn = nav.querySelector('.tab-order-btn');
        newOrder.forEach(tabName => {
            const btn = nav.querySelector(`.tab-item[data-tab="${tabName}"]`);
            if (btn) nav.insertBefore(btn, orderBtn);
        });
        closeTabOrderModal();
    }

    function resetTabOrder() {
        try { localStorage.removeItem(TAB_ORDER_KEY); } catch(e) {}
        // 기본 순서 복원
        const nav = document.getElementById('tabNav');
        const orderBtn = nav.querySelector('.tab-order-btn');
        TAB_DEFS.forEach(({ tab }) => {
            const btn = nav.querySelector(`.tab-item[data-tab="${tab}"]`);
            if (btn) nav.insertBefore(btn, orderBtn);
        });
        closeTabOrderModal();
    }

    function initTabOrderDrag(list) {
        let dragged = null;

        // ── Desktop drag ──
        list.addEventListener('dragstart', e => {
            dragged = e.target.closest('.tab-order-item');
            if (dragged) dragged.classList.add('dragging');
        });
        list.addEventListener('dragover', e => {
            e.preventDefault();
            const target = e.target.closest('.tab-order-item');
            if (target && target !== dragged) {
                const rect = target.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) list.insertBefore(dragged, target);
                else list.insertBefore(dragged, target.nextSibling);
            }
        });
        list.addEventListener('dragend', () => {
            if (dragged) dragged.classList.remove('dragging');
            dragged = null;
        });

        // ── Mobile touch ──
        list.addEventListener('touchstart', e => {
            const item = e.target.closest('.tab-order-item');
            if (!item) return;
            dragged = item;
            dragged.classList.add('dragging');
        }, { passive: true });

        list.addEventListener('touchmove', e => {
            if (!dragged) return;
            e.preventDefault();
            const touch = e.touches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.tab-order-item');
            if (target && target !== dragged) {
                const rect = target.getBoundingClientRect();
                if (touch.clientY < rect.top + rect.height / 2) list.insertBefore(dragged, target);
                else list.insertBefore(dragged, target.nextSibling);
            }
        }, { passive: false });

        list.addEventListener('touchend', () => {
            if (dragged) dragged.classList.remove('dragging');
            dragged = null;
        });
    }

    // 페이지 로드 시 저장된 탭 순서 적용
    loadTabOrder();

    // ========================================
    // 소셜 피드 탭 (StockTwits)
    // ========================================



    // 페이지 로드 시 저장된 탭 순서 적용
    loadTabOrder();


    const _socialCache = {};
    const SOCIAL_CACHE_MS = 5 * 60 * 1000;

    // KR 심볼 판정 — 6자리 숫자 + 옵션 .KS / .KQ
    function _isKrSymbol(sym) { return /^\d{6}(\.K[SQ])?$/i.test(String(sym || '')); }

    // 활성 소셜 소스 ('stocktwits' | 'naver' | 'paxnet') — 기본은 시장에 맞춤, 사용자가 chip 으로 토글
    let _socialActiveSrc = 'stocktwits';
    // 종목별 로드 완료된 소스 추적 (재진입 시 중복 fetch 방지)
    const _socialLoaded = { stocktwits: '', naver: '', paxnet: '' };

    function loadSocialTab(symbol) {
        // 시장 기본값
        const defaultSrc = _isKrSymbol(symbol) ? 'naver' : 'stocktwits';
        // 종목 변경 시 모든 피드 reset
        _socialLoaded.stocktwits = '';
        _socialLoaded.naver = '';
        _socialLoaded.paxnet = '';
        const stEl = document.getElementById('stockTwitsFeed');
        const nvEl = document.getElementById('naverBoardFeed');
        const pxEl = document.getElementById('paxnetBoardFeed');
        if (stEl) stEl.innerHTML = '';
        if (nvEl) nvEl.innerHTML = '';
        if (pxEl) pxEl.innerHTML = '';
        // StockTwits 외부 링크 칩 — US 종목만 표시 (사이트 내 임베드 불가, 새 탭 이동)
        const extChip = document.getElementById('stocktwitsExternalChip');
        if (extChip) {
            if (_isKrSymbol(symbol)) {
                extChip.style.display = 'none';
            } else {
                extChip.href = `https://stocktwits.com/symbol/${encodeURIComponent(symbol)}`;
                extChip.style.display = '';
            }
        }
        // Apewisdom 멘션 통계 카드 (US 종목만 의미 있음 — KR 은 Reddit 에서 거의 안 다룸)
        loadApewisdomCard(symbol);
        setSocialSource(defaultSrc);
    }

    // ── Apewisdom 멘션 통계 (Reddit / 4chan / StockTwits 집계) ─────────
    async function loadApewisdomCard(symbol) {
        const card = document.getElementById('apewisdomCard');
        if (!card) return;
        // KR 종목은 Reddit 에 거의 안 올라오니 카드 숨김
        if (_isKrSymbol(symbol)) { card.style.display = 'none'; card.innerHTML = ''; return; }
        try {
            const res = await fetch(`/api/apewisdom/${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            const item = data && data.item;
            if (!item) {
                card.style.display = 'none'; card.innerHTML = ''; return;
            }
            const m   = item.mentions || 0;
            const m24 = item.mentions_24h_ago || 0;
            const r   = item.rank || 0;
            const r24 = item.rank_24h_ago || 0;
            const up  = item.upvotes || 0;
            // 24h 변화율
            const dPct = m24 > 0 ? ((m - m24) / m24) * 100 : null;
            const dCls = dPct == null ? '' : (dPct >= 0 ? 'up' : 'down');
            const dStr = dPct == null ? '—' : `${dPct >= 0 ? '+' : ''}${dPct.toFixed(0)}%`;
            // 랭크 변화 (낮을수록 인기 ↑)
            const rankDelta = (r24 && r) ? (r24 - r) : 0; // 양수 = 순위 상승
            const rankIcon = rankDelta > 0 ? '▲' : rankDelta < 0 ? '▼' : '·';
            const rankCls  = rankDelta > 0 ? 'up' : rankDelta < 0 ? 'down' : '';

            card.style.display = 'block';
            card.innerHTML = `
                <div class="apw-card">
                    <div class="apw-hdr">
                        <span class="apw-emoji">🐒</span>
                        <span class="apw-title">Apewisdom 커뮤니티 멘션</span>
                        <span class="apw-sub">Reddit · 4chan · StockTwits 집계</span>
                    </div>
                    <div class="apw-grid">
                        <div class="apw-stat">
                            <div class="apw-lbl">멘션 (24h)</div>
                            <div class="apw-val">${m.toLocaleString()}</div>
                            <div class="apw-delta ${dCls}">${dStr}</div>
                        </div>
                        <div class="apw-stat">
                            <div class="apw-lbl">순위</div>
                            <div class="apw-val">#${r}</div>
                            <div class="apw-delta ${rankCls}">${rankIcon} ${rankDelta !== 0 ? Math.abs(rankDelta) : ''}</div>
                        </div>
                        <div class="apw-stat">
                            <div class="apw-lbl">총 추천</div>
                            <div class="apw-val">${up.toLocaleString()}</div>
                            <div class="apw-delta">↑</div>
                        </div>
                    </div>
                </div>`;
        } catch {
            card.style.display = 'none'; card.innerHTML = '';
        }
    }

    function setSocialSource(src) {
        if (src !== 'stocktwits' && src !== 'naver' && src !== 'paxnet') return;
        _socialActiveSrc = src;
        // chip active 상태
        document.querySelectorAll('.social-src-chip').forEach(b => {
            b.classList.toggle('active', b.dataset.src === src);
        });
        // feed 토글
        const stEl = document.getElementById('stockTwitsFeed');
        const nvEl = document.getElementById('naverBoardFeed');
        const pxEl = document.getElementById('paxnetBoardFeed');
        if (stEl) stEl.style.display = src === 'stocktwits' ? '' : 'none';
        if (nvEl) nvEl.style.display = src === 'naver' ? '' : 'none';
        if (pxEl) pxEl.style.display = src === 'paxnet' ? '' : 'none';
        // lazy load (현재 종목에 대해 아직 안 가져왔으면 fetch)
        const sym = currentFullSymbol || '';
        if (!sym) return;
        if (src === 'stocktwits' && _socialLoaded.stocktwits !== sym) {
            _socialLoaded.stocktwits = sym;
            loadStockTwits(sym);
        } else if (src === 'naver' && _socialLoaded.naver !== sym) {
            _socialLoaded.naver = sym;
            // KR(005930) / US(TSLA) 모두 서버에서 처리
            loadNaverBoard(sym);
        } else if (src === 'paxnet' && _socialLoaded.paxnet !== sym) {
            _socialLoaded.paxnet = sym;
            if (_isKrSymbol(sym)) {
                loadPaxnetBoard(sym);
            } else if (pxEl) {
                pxEl.innerHTML = '<div class="social-empty"><div class="social-empty-icon">🇰🇷</div><div class="social-empty-text">팍스넷 종목토론은 KR 종목만 지원해요.</div></div>';
            }
        }
    }

    async function loadStockTwits(symbol) {
        const feed = document.getElementById('stockTwitsFeed');
        if (!feed) return;
        const cKey = 'st_' + symbol;
        if (_socialCache[cKey] && Date.now() - _socialCache[cKey].ts < SOCIAL_CACHE_MS) {
            renderStockTwits(feed, _socialCache[cKey].data); return;
        }
        feed.innerHTML = tabLoading([90, 70, 90, 60, 80, 50]);
        try {
            const res = await fetch(`/api/stocktwits/${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            _socialCache[cKey] = { ts: Date.now(), data };
            renderStockTwits(feed, data);
        } catch {
            feed.innerHTML = tabError('Reddit 데이터를 가져올 수 없어요.', '');
        }
    }

    // ── 네이버 금융 토론실 (KR 종목 전용) ─────────────────
    async function loadNaverBoard(symbol) {
        const feed = document.getElementById('naverBoardFeed');
        if (!feed) return;
        const cKey = 'nv_' + symbol;
        if (_socialCache[cKey] && Date.now() - _socialCache[cKey].ts < SOCIAL_CACHE_MS) {
            renderNaverBoard(feed, _socialCache[cKey].data); return;
        }
        feed.innerHTML = tabLoading([90, 70, 90, 60, 80]);
        try {
            const res = await fetch(`/api/naver-board/${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            _socialCache[cKey] = { ts: Date.now(), data };
            renderNaverBoard(feed, data);
        } catch {
            feed.innerHTML = tabError('네이버 토론실 데이터를 가져올 수 없어요.', '');
        }
    }

    function renderNaverBoard(feed, data) {
        const posts = (data && data.posts) || [];
        if (!posts.length) {
            const isKr = _isKrSymbol(currentFullSymbol || '');
            const msg = isKr ? '토론실 글이 없어요.' : '아직 네이버 미국 종목 토론에 글이 없어요.';
            feed.innerHTML = `<div class="social-empty"><div class="social-empty-icon">📭</div><div class="social-empty-text">${msg}</div></div>`;
            return;
        }
        // escHtml 는 전역 정의(8853 줄) 사용 — 중복 정의 제거
        const cards = posts.map(p => {
            const date  = escHtml(p.date || '');
            const auth  = escHtml(p.author || '익명');
            const title = escHtml(p.title || '');
            const link  = escHtml(p.link || '#');
            const cmt   = (p.comments|0) > 0 ? `<span class="nv-cmt">💬 ${p.comments}</span>` : '';
            const likes = (p.likes|0) > 0 ? `<span class="nv-like">👍 ${p.likes}</span>` : '';
            const dis   = (p.dislikes|0) > 0 ? `<span class="nv-dis">👎 ${p.dislikes}</span>` : '';
            const views = (p.views|0) > 0 ? `<span class="nv-views">조회 ${p.views}</span>` : '';
            return `<a class="nv-card" href="${link}" target="_blank" rel="noopener noreferrer">
                <div class="nv-title">${title}</div>
                <div class="nv-meta">
                    <span class="nv-author">${auth}</span>
                    <span class="nv-date">${date}</span>
                    ${views}${likes}${dis}${cmt}
                </div>
            </a>`;
        });
        feed.innerHTML = cards.join('');
    }

    // ── 팍스넷 종목토론 (KR 종목 전용, 네이버와 별개의 두 번째 소스) ─────────
    async function loadPaxnetBoard(symbol) {
        const feed = document.getElementById('paxnetBoardFeed');
        if (!feed) return;
        const cKey = 'px_' + symbol;
        if (_socialCache[cKey] && Date.now() - _socialCache[cKey].ts < SOCIAL_CACHE_MS) {
            renderPaxnetBoard(feed, _socialCache[cKey].data); return;
        }
        feed.innerHTML = tabLoading([90, 70, 90, 60, 80]);
        try {
            const res = await fetch(`/api/paxnet-board/${encodeURIComponent(symbol)}`);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            _socialCache[cKey] = { ts: Date.now(), data };
            renderPaxnetBoard(feed, data);
        } catch {
            feed.innerHTML = tabError('팍스넷 데이터를 가져올 수 없어요.', '');
        }
    }

    function renderPaxnetBoard(feed, data) {
        const posts = (data && data.posts) || [];
        if (!posts.length) {
            feed.innerHTML = '<div class="social-empty"><div class="social-empty-icon">📭</div><div class="social-empty-text">팍스넷 토론 글이 없어요.</div></div>';
            return;
        }
        // escHtml 는 전역 정의(8853 줄) 사용 — 중복 정의 제거
        const cards = posts.map(p => {
            const date  = escHtml(p.date || '');
            const auth  = escHtml(p.author || '익명');
            const title = escHtml(p.title || '');
            const link  = escHtml(p.link || '#');
            const cmt   = (p.comments|0) > 0 ? `<span class="nv-cmt">💬 ${p.comments}</span>` : '';
            const rec   = (p.recommends|0) > 0 ? `<span class="nv-like">👍 ${p.recommends}</span>` : '';
            return `<a class="nv-card" href="${link}" target="_blank" rel="noopener noreferrer">
                <div class="nv-title">${title}</div>
                <div class="nv-meta">
                    <span class="nv-author">${auth}</span>
                    <span class="nv-date">${date}</span>
                    <span class="nv-views">조회 ${p.views|0}</span>
                    ${rec}${cmt}
                </div>
            </a>`;
        });
        feed.innerHTML = cards.join('');
    }

    const _stTranslCache = new Map(); // msgId → 번역문

    function renderStockTwits(feed, data) {
        const msgs = data?.messages || [];
        if (!msgs.length) {
            const isKr = _isKrSymbol(currentFullSymbol || '');
            const msg = isKr ? 'Reddit은 한국 종목을 지원하지 않습니다.' : '아직 Reddit에 글이 없어요.';
            feed.innerHTML = `<div class="social-empty"><div class="social-empty-icon">📭</div><div class="social-empty-text">${msg}</div></div>`;
            return;
        }
        const _esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        // URL 검증: javascript:/data:/vbscript: 등 위험 프로토콜 차단 (XSS 방어)
        const _safeUrl = s => {
            const v = String(s||'').trim();
            if (!v) return '';
            // 상대 경로 또는 명시적 http/https 만 허용
            if (/^\/[^/]/.test(v)) return v;
            try {
                const u = new URL(v);
                return (u.protocol === 'http:' || u.protocol === 'https:') ? v : '';
            } catch { return ''; }
        };
        const MAX_BODY = 2000; // data-original 의 m.body 최대 길이 (메모리 폭증 방지)
        const cards = msgs.map((m, idx) => {
            const sent = m.sentiment?.basic;
            const badge = sent === 'Bullish' ? '<span class="st-badge bull">🐂 강세</span>'
                        : sent === 'Bearish' ? '<span class="st-badge bear">🐻 약세</span>' : '';
            const ago  = _newsTimeAgo(new Date(m.created_at).getTime() / 1000);
            const likes = m.likes?.total ? `♥ ${m.likes.total}` : '';
            // body: 길이 제한 + 4개 엔티티 이스케이프 후 ticker 하이라이트 + 줄바꿈 처리
            const rawBody = String(m.body||'').slice(0, MAX_BODY);
            const body = _esc(rawBody).replace(/\$([A-Z]{1,5})/g,'<span class="st-ticker">$$$1</span>').replace(/\n/g,'<br>');
            // avatar_url: javascript: 등 차단을 위해 _safeUrl 통과시킨 후 이스케이프
            const avatarSrc = _esc(_safeUrl(m.user?.avatar_url));
            const username  = _esc(m.user?.username||'?');
            const msgId = m.id || idx;
            return `<div class="st-card" data-st-id="${msgId}">
                <div class="st-header">
                    <img class="st-avatar" src="${avatarSrc}" onerror="this.style.display='none'" alt="">
                    <span class="st-user">@${username}</span>
                    ${badge}
                    <span class="st-time">${ago}</span>
                    <span class="st-likes">${likes}</span>
                </div>
                <div class="st-body" data-original="${_esc(rawBody)}">${body}</div>
                <button class="st-translate-btn" onclick="toggleStTranslate(this)">번역 보기</button>
            </div>`;
        });
        feed.innerHTML = cards.join('<hr class="social-divider">');
    }

    function reloadSocialTab() {
        if (!currentFullSymbol) return;
        // 모든 소스 캐시 무효화
        delete _socialCache['st_' + currentFullSymbol];
        delete _socialCache['nv_' + currentFullSymbol];
        delete _socialCache['px_' + currentFullSymbol];
        _socialLoaded.stocktwits = '';
        _socialLoaded.naver = '';
        _socialLoaded.paxnet = '';
        // 현재 active 소스만 즉시 재로드
        setSocialSource(_socialActiveSrc);
    }

    async function toggleStTranslate(btn) {
        const card = btn.closest('.st-card');
        const bodyEl = card.querySelector('.st-body');
        const originalText = bodyEl.dataset.original;
        let translEl = card.querySelector('.st-translated');

        // 번역 표시 중이면 원문으로 토글
        if (translEl) {
            const showing = translEl.style.display !== 'none';
            translEl.style.display = showing ? 'none' : '';
            btn.textContent = showing ? '번역 보기' : '원문 보기';
            return;
        }

        // 캐시 확인
        const cacheKey = originalText.slice(0, 80);
        if (_stTranslCache.has(cacheKey)) {
            translEl = document.createElement('div');
            translEl.className = 'st-translated';
            translEl.textContent = _stTranslCache.get(cacheKey);
            card.insertBefore(translEl, btn);
            btn.textContent = '원문 보기';
            return;
        }

        btn.textContent = '⏳';
        btn.disabled = true;
        try {
            const res = await fetch(`/api/translate?text=${encodeURIComponent(originalText)}`);
            if (!res.ok) throw new Error();
            const { translated } = await res.json();
            _stTranslCache.set(cacheKey, translated);
            translEl = document.createElement('div');
            translEl.className = 'st-translated';
            translEl.textContent = translated;
            card.insertBefore(translEl, btn);
            btn.textContent = '원문 보기';
        } catch {
            btn.textContent = '번역 실패';
        } finally {
            btn.disabled = false;
        }
    }

    // ── 홈 소셜 HOT ──
    const _socialHotCache = { ts: 0, items: [] };

    async function loadSocialHot() {
        const list = document.getElementById('socialHotList');
        if (!list) return;
        if (Date.now() - _socialHotCache.ts < SOCIAL_CACHE_MS && _socialHotCache.items.length) {
            renderSocialHot(_socialHotCache.items); return;
        }
        list.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;">로딩 중...</div>';
        const stData = await fetch('/api/stocktwits-trending').then(r => r.ok ? r.json() : null).catch(() => null);
        const items = [];
        (stData?.messages || []).slice(0, 8).forEach(m => {
            items.push({ type: 'st', text: m.body, user: m.user?.username,
                sentiment: m.sentiment?.basic, symbol: m.symbols?.[0]?.symbol, likes: m.likes?.total });
        });
        _socialHotCache.ts = Date.now();
        _socialHotCache.items = items;
        renderSocialHot(items);
    }

    function renderSocialHot(items) {
        const list = document.getElementById('socialHotList');
        if (!list) return;
        if (!items.length) {
            list.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;">데이터 없음</div>';
            return;
        }
        list.innerHTML = items.map(item => {
            const badge = item.sentiment === 'Bullish' ? '<span class="st-badge bull">🐂</span>'
                        : item.sentiment === 'Bearish' ? '<span class="st-badge bear">🐻</span>' : '';
            return `<div class="social-hot-card">
                <div class="social-hot-source">StockTwits ${badge}${item.symbol ? ` <b>$${item.symbol}</b>` : ''}</div>
                <div class="social-hot-title">${(item.text||'').replace(/</g,'&lt;')}</div>
                <div class="social-hot-meta">@${item.user||'?'}${item.likes ? ` · ♥ ${item.likes}` : ''}</div>
            </div>`;
        }).join('');
    }

    // ===== 공매도 탭 =====
    let _shortCache = {};
    const SHORT_CACHE_MS = 10 * 60 * 1000;

    async function loadShortTab(symbol) {
        const el = document.getElementById('shortContent');
        const label = document.getElementById('shortSymbolLabel');
        if (!el) return;
        if (label) label.textContent = currentSymbol;
        if (_shortCache[symbol] && Date.now() - _shortCache[symbol].ts < SHORT_CACHE_MS) {
            renderShortTab(_shortCache[symbol].data); return;
        }
        el.innerHTML = '<div class="ts-short-skel"><div class="ts-short-gauge"></div>' + tabLoading([70, 50, 60, 45]) + '</div>';
        try {
            const res = await fetch(`/api/summary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics`, { signal: AbortSignal.timeout(10000) });
            const json = await res.json();
            const d = json?.quoteSummary?.result?.[0]?.defaultKeyStatistics || null;
            _shortCache[symbol] = { ts: Date.now(), data: d };
            if (!d) { el.innerHTML = tabEmpty('📊', '공매도 데이터가 없습니다.'); return; }
            renderShortTab(d);
        } catch(e) {
            el.innerHTML = tabError('공매도 데이터를 불러올 수 없습니다.', 'reloadShortTab()');
        }
    }

    function reloadShortTab() {
        if (!currentFullSymbol) return;
        delete _shortCache[currentFullSymbol];
        loadShortTab(currentFullSymbol);
    }

    // ========================================

    // YouTube Tab
    // ========================================
    const _ytCache = {};
    const YT_CACHE_MS = 30 * 60 * 1000; // 30분 캐시

    async function loadYouTubeTab(symbol) {
        const grid  = document.getElementById('ytVideoGrid');
        const label = document.getElementById('ytSymbolLabel');
        if (!grid) return;
        if (label) label.textContent = currentSymbol;

        // 캐시 히트
        if (_ytCache[symbol] && Date.now() - _ytCache[symbol].ts < YT_CACHE_MS) {
            renderYouTubeCards(_ytCache[symbol].items); return;
        }

        // 스켈레톤 (9개 — 3×3 grid fill)
        grid.innerHTML = Array(9).fill(0).map(() => `
            <article class="yt-card yt-skel">
                <div class="yt-thumb-wrap skel-block yt-skel-thumb"></div>
                <div class="yt-info" style="gap:8px">
                    <div class="skel-block" style="height:13px;width:95%;border-radius:4px"></div>
                    <div class="skel-block" style="height:13px;width:72%;border-radius:4px"></div>
                    <div class="skel-block" style="height:11px;width:45%;border-radius:4px;margin-top:4px"></div>
                </div>
            </article>`).join('');

        try {
            const company = stockData?.meta?.longName || stockData?.meta?.shortName || '';
            const res = await fetch(`/api/youtube/${encodeURIComponent(symbol)}?company=${encodeURIComponent(company)}&limit=9`);
            if (!res.ok) {
                const body = await res.text().catch(() => '(no body)');
                console.error(`[YouTube] ❌ HTTP ${res.status} for ${symbol}:`, body);
                throw new Error(`HTTP ${res.status}: ${body}`);
            }
            const data  = await res.json();
            const items = data.videos || [];
            log(`[YouTube] ✅ ${symbol}: ${items.length}개 영상 수신`);
            if (!items.length) throw new Error('empty response');
            _ytCache[symbol] = { ts: Date.now(), items };
            renderYouTubeCards(items);
        } catch(err) {
            console.error('[YouTube] fetch 실패:', err.message);
            renderYouTubeEmpty(currentSymbol || symbol);
        }
    }

    function reloadYouTubeTab() {
        if (!currentFullSymbol) return;
        delete _ytCache[currentFullSymbol];
        loadYouTubeTab(currentFullSymbol);
    }

    function renderYouTubeEmpty(sym) {
        const grid = document.getElementById('ytVideoGrid');
        if (!grid) return;
        const q = encodeURIComponent((sym || '') + ' stock analysis');
        grid.innerHTML = `<div class="yt-empty" style="grid-column:1/-1">
            <div class="yt-empty-icon">▶</div>
            <div style="margin-bottom:14px;color:var(--text2)">YouTube API가 연결되지 않았습니다.</div>
            <a href="https://www.youtube.com/results?search_query=${q}"
               target="_blank" rel="noopener noreferrer"
               style="display:inline-block;padding:10px 20px;background:var(--blue);color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;">
                YouTube에서 ${escHtml(sym || '')} 검색하기
            </a>
        </div>`;
    }

    function renderYouTubeCards(videos) {
        const grid = document.getElementById('ytVideoGrid');
        if (!grid) return;
        if (!videos?.length) {
            grid.innerHTML = `<div class="yt-empty">
                <div class="yt-empty-icon">▶</div>
                현재 관련된 영상을 불러올 수 없습니다.<br>
                <span style="font-size:11px;color:var(--text3)">잠시 후 다시 시도해주세요</span>
            </div>`;
            return;
        }
        grid.innerHTML = videos.map(v => {
            const url  = `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`;
            const ago  = _newsTimeAgo(Math.floor(new Date(v.publishedAt).getTime() / 1000));
            const thumb = v.thumbnail
                ? `<img class="yt-thumb" src="${escHtml(v.thumbnail)}" alt="" loading="lazy" onerror="this.style.opacity='.15'">`
                : '';
            return `<article class="yt-card">
                <a class="yt-link" href="${escHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escHtml(v.title)}" onclick="_ytLogClick('${escHtml(v.videoId)}')">
                    <div class="yt-thumb-wrap">${thumb}<span class="yt-ext-icon">↗</span></div>
                    <div class="yt-info">
                        <div class="yt-title">${escHtml(v.title)}</div>
                        <div class="yt-meta">
                            <span class="yt-channel">${escHtml(v.channel)}</span>
                            <span style="color:var(--text3);flex-shrink:0">·</span>
                            <span class="yt-date">${ago}</span>
                        </div>
                    </div>
                </a>
            </article>`;
        }).join('');
    }

    function _ytLogClick(videoId) {
        // logEvent('youtube_click', { videoId, symbol: currentSymbol });
    }

    function _analyzeShort(pct, ratio, deltaPct, hasPrev) {
        const scoreColors = ['var(--green)', '#f59e0b', 'var(--yellow)', 'var(--red)'];
        const items = [];
        const scores = [];
        const pctVal = pct * 100;

        // ① 공매도 비율
        let s0, lv0, icon0, msg0;
        if (pctVal < 3)       { s0=0; lv0='낮음';   icon0='✅'; msg0=`Float의 ${pctVal.toFixed(1)}%만 공매도 중입니다. 3% 미만은 매우 낮은 수준으로 대부분 투자자가 긍정적으로 보고 있습니다.`; }
        else if (pctVal < 5)  { s0=1; lv0='보통';   icon0='🟡'; msg0=`${pctVal.toFixed(1)}%는 보통 수준입니다. 크게 우려할 수준은 아니지만 지켜볼 필요가 있습니다.`; }
        else if (pctVal < 10) { s0=2; lv0='높음';   icon0='⚠️'; msg0=`${pctVal.toFixed(1)}%로 높습니다. 많은 투자자가 주가 하락을 예상해 공매도를 치고 있습니다.`; }
        else                  { s0=3; lv0='위험';   icon0='🔴'; msg0=`${pctVal.toFixed(1)}%는 매우 위험한 수준입니다! 주식 10주 중 1주 이상이 공매도 상태입니다.`; }
        scores.push(s0);
        items.push({ title:`공매도 비율: ${lv0} (${pctVal.toFixed(1)}%)`, msg:msg0, icon:icon0, score:s0 });

        // ② Days to Cover
        let s1, lv1, icon1, msg1;
        if (ratio < 2)       { s1=0; lv1='낮음'; icon1='✅'; msg1=`약 ${ratio.toFixed(1)}일 내 청산 가능해 급등(쇼트 스퀴즈) 위험이 낮습니다.`; }
        else if (ratio < 5)  { s1=1; lv1='보통'; icon1='🟡'; msg1=`청산에 ${ratio.toFixed(1)}일 소요됩니다. 공매도 압력이 다소 있습니다.`; }
        else if (ratio < 10) { s1=2; lv1='높음'; icon1='⚠️'; msg1=`청산에 ${ratio.toFixed(1)}일 필요합니다. 호재 뉴스 시 쇼트 스퀴즈로 급등 가능성이 있습니다.`; }
        else                 { s1=3; lv1='위험'; icon1='🔴'; msg1=`${ratio.toFixed(1)}일이나 소요됩니다! 쇼트 스퀴즈 발생 시 폭발적 급등이 나타날 수 있습니다.`; }
        scores.push(s1);
        items.push({ title:`청산 소요 기간: ${lv1} (${ratio.toFixed(1)}일)`, msg:msg1, icon:icon1, score:s1 });

        // ③ 전월 대비 증감
        if (hasPrev) {
            let s2, lv2, icon2, msg2;
            if (deltaPct < -10)     { s2=0; lv2='감소'; icon2='✅'; msg2=`지난달 대비 ${Math.abs(deltaPct).toFixed(1)}% 감소했습니다. 하락 베팅 세력이 약해지는 긍정적 신호입니다.`; }
            else if (deltaPct < 10) { s2=1; lv2='유지'; icon2='🟡'; msg2=`지난달과 비슷한 수준을 유지하고 있습니다. 큰 변화는 없습니다.`; }
            else if (deltaPct < 30) { s2=2; lv2='증가'; icon2='⚠️'; msg2=`지난달 대비 ${deltaPct.toFixed(1)}% 증가했습니다. 하락을 예상하는 세력이 늘고 있습니다.`; }
            else                    { s2=3; lv2='급증'; icon2='🔴'; msg2=`지난달 대비 ${deltaPct.toFixed(1)}% 급증했습니다! 강한 하락 압력이 예상되니 주의하세요.`; }
            scores.push(s2);
            items.push({ title:`전월 대비: ${lv2} (${deltaPct>=0?'+':''}${deltaPct.toFixed(1)}%)`, msg:msg2, icon:icon2, score:s2 });
        }

        // 종합 판정
        const avg = scores.reduce((a,b)=>a+b,0) / scores.length;
        let verdict, verdictColor, verdictEmoji, verdictMsg;
        if (avg < 0.7)      { verdict='안전'; verdictColor='var(--green)'; verdictEmoji='✅'; verdictMsg='공매도 지표가 전반적으로 안전한 수준입니다. 초보 투자자도 크게 걱정하지 않아도 됩니다.'; }
        else if (avg < 1.5) { verdict='주의'; verdictColor='#f59e0b';     verdictEmoji='🟡'; verdictMsg='일부 지표에서 주의가 필요합니다. 매수 전 추가적인 확인을 권장합니다.'; }
        else if (avg < 2.3) { verdict='경고'; verdictColor='var(--yellow)';     verdictEmoji='⚠️'; verdictMsg='공매도 압력이 상당합니다. 단기 하락 가능성을 충분히 고려한 후 투자하세요.'; }
        else                { verdict='위험'; verdictColor='var(--red)';   verdictEmoji='🔴'; verdictMsg='공매도 지표가 위험 수준입니다! 초보 투자자라면 신중하게 접근하세요.'; }

        // 쇼트 스퀴즈
        const sqLv = (pct>0.10 && ratio>5) ? '높음' : (pct>0.05 || ratio>5) ? '보통' : '낮음';
        const sqColor = sqLv==='높음' ? '#f59e0b' : sqLv==='보통' ? 'var(--text3)' : 'var(--green)';
        const sqMsg = sqLv==='높음'
            ? '공매도가 많고 청산에 시간이 걸려 호재 발생 시 주가가 폭발적으로 상승(쇼트 스퀴즈)할 수 있습니다. 투기적 매수 기회가 될 수 있지만 위험도 큽니다.'
            : sqLv==='보통' ? '쇼트 스퀴즈 가능성이 일부 있습니다. 강한 호재 뉴스 시 빠른 상승이 나타날 수 있습니다.'
            : '현재 쇼트 스퀴즈 발생 가능성은 낮습니다.';

        return { verdict, verdictColor, verdictEmoji, verdictMsg, items, sqLv, sqColor, sqMsg, scoreColors };
    }

    function _buildGaugeSVG(pct) {
        const r = 54, cx = 70, cy = 70, strokeW = 12;
        const arc = Math.PI * r;
        const filled = Math.min(pct / 0.3, 1) * arc;
        const color = pct > 0.10 ? 'var(--red)' : pct > 0.05 ? '#f59e0b' : 'var(--green)';
        return `<svg width="140" height="80" viewBox="0 0 140 80">
            <path d="M${cx-r},${cy} A${r},${r} 0 0,1 ${cx+r},${cy}"
                fill="none" stroke="var(--bg3)" stroke-width="${strokeW}" stroke-linecap="round"/>
            <path d="M${cx-r},${cy} A${r},${r} 0 0,1 ${cx+r},${cy}"
                fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round"
                stroke-dasharray="${arc}" stroke-dashoffset="${arc - filled}"/>
        </svg>`;
    }

    function renderShortTab(d) {
        const el = document.getElementById('shortContent');
        if (!el) return;
        if (!d || !d.sharesShort?.raw) {
            el.innerHTML = '<div class="short-nodata">공매도 데이터가 없습니다.<br>미국 주식에서만 지원됩니다.</div>';
            return;
        }
        const cur   = d.sharesShort?.raw || 0;
        const prev  = d.sharesShortPriorMonth?.raw || 0;
        const pct   = d.shortPercentOfFloat?.raw || 0;
        const ratio = d.shortRatio?.raw || 0;
        const dateStr = d.dateShortInterest?.raw
            ? new Date(d.dateShortInterest.raw * 1000).toLocaleDateString('ko-KR') : '-';
        const delta    = prev ? cur - prev : 0;
        const deltaPct = prev ? (delta / prev * 100) : 0;
        const isUp = delta > 0;
        const changeClass = isUp ? 'short-change-up' : 'short-change-dn';
        const changeSign  = isUp ? '▲' : '▼';
        const fmt = n => n >= 1e8 ? (n/1e8).toFixed(2)+'억'
                       : n >= 1e4 ? (n/1e4).toFixed(1)+'만'
                       : n.toLocaleString();
        const maxVal = Math.max(cur, prev) || 1;
        const curW  = (cur  / maxVal * 100).toFixed(1);
        const prevW = (prev / maxVal * 100).toFixed(1);
        const barColor = isUp ? 'var(--red)' : 'var(--green)';

        el.innerHTML = `
          <div class="short-charts-row">
            <div class="short-chart-card">
              <div class="short-chart-title">Float 대비 공매도 비율</div>
              <div class="short-gauge-wrap">
                ${_buildGaugeSVG(pct)}
                <div class="short-gauge-val">${(pct*100).toFixed(2)}%</div>
                <div class="short-gauge-label">${pct>0.10?'⚠️ 높음':pct>0.05?'보통':'낮음'} · 30% 기준</div>
              </div>
            </div>
            <div class="short-chart-card">
              <div class="short-chart-title">공매도 잔고 비교 (전월 vs 현재)</div>
              <div class="short-bar-chart">
                <div class="short-bar-row">
                  <div class="short-bar-label">전월</div>
                  <div class="short-bar-bg">
                    <div class="short-bar-fill" style="width:${prevW}%;background:var(--text3);">
                      <span class="short-bar-num">${fmt(prev)}</span>
                    </div>
                  </div>
                </div>
                <div class="short-bar-row">
                  <div class="short-bar-label">현재</div>
                  <div class="short-bar-bg">
                    <div class="short-bar-fill" style="width:${curW}%;background:${barColor};">
                      <span class="short-bar-num">${fmt(cur)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="short-stats-grid">
            <div class="short-stat">
              <div class="short-stat-label">공매도 잔고</div>
              <div class="short-stat-value">${fmt(cur)}주</div>
              ${prev ? `<div class="short-stat-sub ${changeClass}">${changeSign} ${fmt(Math.abs(delta))}주 (${Math.abs(deltaPct).toFixed(1)}%)</div>` : ''}
            </div>
            <div class="short-stat">
              <div class="short-stat-label">Days to Cover</div>
              <div class="short-stat-value">${ratio.toFixed(1)}일</div>
              <div class="short-stat-sub" style="color:var(--text3)">공매도 청산 예상 기간</div>
            </div>
          </div>
          <div class="short-date-note">
            기준일: ${dateStr} (FINRA 보고 기준) &nbsp;·&nbsp; <span style="color:var(--text3)">최신 데이터</span>
            ${(() => {
              if (!d.dateShortInterest?.raw) return '';
              const lastTs = d.dateShortInterest.raw * 1000;
              const lastDate = new Date(lastTs);
              const day = lastDate.getUTCDate();
              // FINRA settlement: ~15일, ~말일 → 다음 결산일 추정
              let nextSettlement;
              if (day < 20) {
                // 이번달 말일 결산
                nextSettlement = new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth() + 1, 0));
              } else {
                // 다음달 15일 결산
                nextSettlement = new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth() + 1, 15));
              }
              // FINRA 공표: 결산 후 8영업일 후 (≈ +11일 달력 기준)
              const nextPub = new Date(nextSettlement.getTime() + 11 * 24 * 60 * 60 * 1000);
              const nextPubStr = nextPub.toLocaleDateString('ko-KR');
              return `<br><span style="font-size:11px;color:var(--text3)">다음 FINRA 발표 예정: 약 ${nextPubStr}</span>`;
            })()}
          </div>
          ${(() => {
            const a = _analyzeShort(pct, ratio, deltaPct, !!prev);
            return `<div class="short-ai-section">
              <div class="short-ai-header">
                <div class="short-ai-title"><i class="ri-robot-2-line"></i> AI 공매도 분석</div>
                <div class="short-ai-badge" style="color:${a.verdictColor};background:${a.verdictColor}22;">${a.verdictEmoji} ${a.verdict}</div>
              </div>
              <div class="short-ai-verdict">${a.verdictMsg}</div>
              <div class="short-ai-items">
                ${a.items.map(it=>`<div class="short-ai-item">
                  <div class="short-ai-item-header">
                    <span>${it.icon}</span>
                    <span class="short-ai-item-title" style="color:${a.scoreColors[it.score]};">${it.title}</span>
                  </div>
                  <div class="short-ai-item-msg">${it.msg}</div>
                </div>`).join('')}
              </div>
              <div class="short-ai-squeeze">
                <span class="short-ai-squeeze-label">📌 쇼트 스퀴즈 가능성</span>
                <span class="short-ai-squeeze-val" style="color:${a.sqColor};">${a.sqLv}</span>
              </div>
              <div class="short-ai-squeeze-msg">${a.sqMsg}</div>
            </div>`;
          })()}`;
    }

    // ============================================================

    // VISION SCANNER — AI 차트 판독기
    // ============================================================

    // ── 상태 ─────────────────────────────────────────────────────
    const VS_ACCEPTED = ['image/png','image/jpeg','image/webp','image/gif'];
    const VS_MAX_MB   = 20;
    let _vsFile        = null;   // 현재 파일
    let _vsObjectURL   = null;   // 현재 object URL
    let _vsNaturalW    = 0;
    let _vsNaturalH    = 0;
    let _vsHoveredIdx  = null;
    let _vsZones       = [];
    let _vsDragCounter = 0;      // drag flicker 방지
    let _vsScanTimer   = null;
    let _vsStepTimer   = null;
    let _vsRafId       = null;
    let _vsApiResult   = null;   // 실제 API 응답 저장

    // ── Mock 분석 결과 (Phase 1) ─────────────────────────────────
    // yRatio/hRatio: 이미지 높이에 대한 비율 (0~1)
    const VS_MOCK_ZONES = [
        { type:'resistance', xRatio:0, yRatio:.12, wRatio:1, hRatio:.026, label:'저항 구간 A', strength:.9  },
        { type:'resistance', xRatio:0, yRatio:.27, wRatio:1, hRatio:.018, label:'저항 구간 B', strength:.6  },
        { type:'support',    xRatio:0, yRatio:.61, wRatio:1, hRatio:.024, label:'지지 구간 A', strength:.85 },
        { type:'support',    xRatio:0, yRatio:.76, wRatio:1, hRatio:.016, label:'지지 구간 B', strength:.5  },
        { type:'support',    xRatio:0, yRatio:.89, wRatio:1, hRatio:.033, label:'지지 구간 C', strength:1  },
    ];

    const VS_MOCK_REPORT = `## 🔬 데모 분석 결과 안내
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

    // ── 화면 전환 ────────────────────────────────────────────────
    function goVisionScanner() {
        _pushRoute('vision');
        window._lastScreen = 'visionScanner';
        _restoreHeaderChrome();
        document.getElementById('welcomeScreen').style.display       = 'none';
        document.getElementById('smartMoneyScreen').style.display    = 'none';
        document.getElementById('alphaScannerScreen').style.display  = 'none';
        document.getElementById('favScreen').style.display           = 'none';
        document.getElementById('economicSection').style.display      = 'none';
        const _ern4 = document.getElementById('earningsScreen'); if (_ern4) _ern4.style.display = 'none';
        const _lev4 = document.getElementById('leverageScreen'); if (_lev4) _lev4.style.display = 'none';
        const _t100V = document.getElementById('top100Screen'); if (_t100V) _t100V.style.display = 'none';
        const _catV  = document.getElementById('catalystScreen'); if (_catV) _catV.style.display = 'none';
        const _posV  = document.getElementById('positionScreen'); if (_posV) _posV.style.display = 'none';
        document.getElementById('visionScannerScreen').style.display = '';
        document.getElementById('mainHeader')?.classList.remove('stock-loaded'); const _fab=document.getElementById('calcFab'); if(_fab)_fab.style.display='none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('sideNavVsBtn')?.classList.add('active');
        document.querySelectorAll('.hqnav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('hqVs')?.classList.add('active');
        updateBnActive('vision');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // 전역 paste 리스너 활성화
        window._vsActive = true;
    }

    // ═══════════════════════════════════════════════════════════════
    // 📊 경제지표 (CPI / PPI) — FRED API 연동
    // ═══════════════════════════════════════════════════════════════
    let _ecoChartInst = null;    // Chart.js 인스턴스
    let _ecoTab = 'cpi';         // 현재 탭
    let _ecoData = null;         // { cpi: [...], ppi: [...] }

    const CPI_RELEASE_DATES = [
        '2026-01-15','2026-02-12','2026-03-12','2026-04-10',
        '2026-05-13','2026-06-11','2026-07-14','2026-08-12',
        '2026-09-11','2026-10-14','2026-11-12','2026-12-11',
    ];
    const PPI_RELEASE_DATES = [
        '2026-01-16','2026-02-13','2026-03-13','2026-04-11',
        '2026-05-14','2026-06-12','2026-07-15','2026-08-13',
        '2026-09-12','2026-10-15','2026-11-13','2026-12-12',
    ];

    function goEconomic() {
        _pushRoute('economic');
        window._lastScreen = 'economic';
        _restoreHeaderChrome();
        document.getElementById('welcomeScreen').style.display       = 'none';
        document.getElementById('smartMoneyScreen').style.display    = 'none';
        document.getElementById('alphaScannerScreen').style.display  = 'none';
        document.getElementById('favScreen').style.display           = 'none';
        document.getElementById('visionScannerScreen').style.display = 'none';
        const _ern5 = document.getElementById('earningsScreen'); if (_ern5) _ern5.style.display = 'none';
        const _lev5 = document.getElementById('leverageScreen'); if (_lev5) _lev5.style.display = 'none';
        const _t100Eco = document.getElementById('top100Screen'); if (_t100Eco) _t100Eco.style.display = 'none';
        const _catEco  = document.getElementById('catalystScreen'); if (_catEco) _catEco.style.display = 'none';
        const _posEco  = document.getElementById('positionScreen'); if (_posEco) _posEco.style.display = 'none';
        document.getElementById('mainContent').style.display         = 'none';
        document.getElementById('economicSection').style.display      = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded'); const _fab=document.getElementById('calcFab'); if(_fab)_fab.style.display='none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('sideNavEcoBtn')?.classList.add('active');
        document.querySelectorAll('.hqnav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('hqEco')?.classList.add('active');
        // 하단 네비게이션 — 전체 메뉴 진입이므로 "전체" 활성화 (v668 버그픽스)
        updateBnActive('all');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        _ecoRenderCountdown();
        _ecoLoad();
    }

    function _ecoNextDate(dates) {
        const today = new Date();
        const future = dates.map(d => new Date(d)).filter(d => d > today);
        return future.length ? future[0] : null;
    }

    function _ecoRenderCountdown() {
        const cpiNext = _ecoNextDate(CPI_RELEASE_DATES);
        const ppiNext = _ecoNextDate(PPI_RELEASE_DATES);
        const diffDays = d => d ? Math.ceil((d - new Date()) / 86400000) : null;
        const fmt = d => d ? `D-${diffDays(d)}  (${d.toISOString().split('T')[0]})` : '—';
        const cpiEl = document.getElementById('cpiCountdown');
        const ppiEl = document.getElementById('ppiCountdown');
        if (cpiEl) cpiEl.textContent = fmt(cpiNext);
        if (ppiEl) ppiEl.textContent = fmt(ppiNext);
    }

    async function _ecoLoad() {
        if (_ecoData) { _ecoRender(_ecoData); return; }
        try {
            const [cpiResp, ppiResp] = await Promise.all([
                fetch('/api/fred/CPIAUCSL'),
                fetch('/api/fred/PPIACO'),
            ]);
            if (!cpiResp.ok || !ppiResp.ok) throw new Error('FRED 데이터 로드 실패');
            const [cpiJson, ppiJson] = await Promise.all([cpiResp.json(), ppiResp.json()]);
            _ecoData = { cpi: cpiJson.observations, ppi: ppiJson.observations };
            _ecoRender(_ecoData);
        } catch (e) {
            console.error('[economic]', e.message);
            showToast('경제지표 데이터를 불러올 수 없습니다. FRED API 키를 확인해주세요.');
        }
    }

    function _ecoCalcYoY(obs) {
        return obs.slice(0, 13).map((item, i) => {
            const prev = obs[i + 12];
            if (!prev || item.value === '.' || prev.value === '.') return null;
            return { date: item.date, val: (((parseFloat(item.value) - parseFloat(prev.value)) / parseFloat(prev.value)) * 100) };
        }).filter(Boolean);
    }

    function _ecoCalcMoM(obs) {
        return obs.slice(0, 24).map((item, i) => {
            const prev = obs[i + 1];
            if (!prev || item.value === '.' || prev.value === '.') return null;
            return { date: item.date, val: (((parseFloat(item.value) - parseFloat(prev.value)) / parseFloat(prev.value)) * 100) };
        }).filter(Boolean);
    }

    function _ecoRender(data) {
        const cpiObs = data.cpi, ppiObs = data.ppi;

        // KPI 카드
        const _kpi = (obs, valId, momId, dateId, yoyId) => {
            if (!obs || obs.length < 2) return;
            const latest = obs[0], prev = obs[1];
            if (latest.value === '.' || prev.value === '.') return;
            const latestVal = parseFloat(latest.value);
            const prevVal   = parseFloat(prev.value);
            const mom = ((latestVal - prevVal) / prevVal * 100);
            const isUp = mom > 0;
            const yoyArr = _ecoCalcYoY(obs);
            const yoy = yoyArr.length ? yoyArr[0].val : null;
            document.getElementById(valId).textContent = latestVal.toFixed(1);
            const momEl = document.getElementById(momId);
            momEl.textContent = `${isUp ? '▲' : '▼'} ${Math.abs(mom).toFixed(2)}% MoM`;
            momEl.style.color = isUp ? '#ef4444' : '#3b82f6';
            document.getElementById(dateId).textContent = latest.date;
            if (yoyId) document.getElementById(yoyId).textContent = yoy !== null ? `${yoy > 0 ? '▲' : '▼'} ${Math.abs(yoy).toFixed(2)}%` : '—';
        };
        _kpi(cpiObs, 'cpiLatestValue', 'cpiMoM', 'cpiDate', 'cpiYoY');
        _kpi(ppiObs, 'ppiLatestValue', 'ppiMoM', 'ppiDate', 'ppiYoY');

        // 섹터 영향도
        const cpiMoM = cpiObs.length >= 2 && cpiObs[0].value !== '.'
            ? ((parseFloat(cpiObs[0].value) - parseFloat(cpiObs[1].value)) / parseFloat(cpiObs[1].value) * 100) : 0;
        _ecoRenderSectors(cpiMoM);

        // 히스토리 테이블 + 차트
        _ecoRenderTable(_ecoTab);
        _ecoRenderChart(_ecoTab);
    }

    function _ecoRenderTable(tab) {
        const obs = _ecoData?.[tab];
        const tbody = document.getElementById('ecoHistoryTable');
        if (!obs || !tbody) return;
        const momArr = _ecoCalcMoM(obs);
        const yoyArr = _ecoCalcYoY(obs);
        const yoyMap = {};
        yoyArr.forEach(item => { yoyMap[item.date] = item.val; });
        tbody.innerHTML = momArr.slice(0, 8).map(item => {
            const momColor = item.val > 0 ? '#ef4444' : '#3b82f6';
            const yoyVal = yoyMap[item.date];
            const yoyColor = yoyVal != null ? (yoyVal > 0 ? '#ef4444' : '#3b82f6') : '';
            const yoyStr = yoyVal != null
                ? `<span style="color:${yoyColor};font-weight:700">${yoyVal > 0 ? '▲' : '▼'} ${Math.abs(yoyVal).toFixed(2)}%</span>`
                : '—';
            return `<tr>
                <td>${item.date}</td>
                <td>${parseFloat(obs.find(o => o.date === item.date)?.value || 0).toFixed(1)}</td>
                <td style="color:${momColor};font-weight:700">${item.val > 0 ? '▲' : '▼'} ${Math.abs(item.val).toFixed(2)}%</td>
                <td>${yoyStr}</td>
            </tr>`;
        }).join('');
    }

    let _ecoChartMode = 'yoy'; // 'yoy' | 'mom'

    function _ecoRenderChart(tab, mode) {
        const obs = _ecoData?.[tab];
        const canvas = document.getElementById('economicChartCanvas');
        if (!obs || !canvas) return;
        if (mode) _ecoChartMode = mode;

        let dataArr, labelSuffix;
        if (_ecoChartMode === 'mom') {
            dataArr = _ecoCalcMoM(obs).reverse();
            labelSuffix = 'MoM (%)';
        } else {
            dataArr = _ecoCalcYoY(obs).reverse();
            labelSuffix = 'YoY (%)';
        }
        const labels = dataArr.map(d => d.date.slice(0, 7));
        const values = dataArr.map(d => parseFloat(d.val.toFixed(2)));

        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
        const textColor = isLight ? '#555' : '#aaa';

        if (_ecoChartInst) { _ecoChartInst.destroy(); _ecoChartInst = null; }

        _ecoChartInst = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: (tab === 'cpi' ? 'CPI' : 'PPI') + ' ' + labelSuffix,
                    data: values,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99,102,241,0.12)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => `${ctx.parsed.y.toFixed(2)}%` } },
                },
                scales: {
                    y: {
                        ticks: { callback: v => `${parseFloat(v).toFixed(1)}%`, color: textColor, font: { size: 10 } },
                        grid: { color: gridColor },
                    },
                    x: {
                        ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 8 },
                        grid: { display: false },
                    },
                },
            },
        });

        const titleEl = document.getElementById('ecoChartTitle');
        const tabLabel = tab === 'cpi' ? 'CPI' : 'PPI';
        if (titleEl) titleEl.textContent = `${tabLabel} ${_ecoChartMode === 'mom' ? 'MoM' : 'YoY'} 변화율 (%)`;
    }

    function switchEcoChartMode(mode) {
        _ecoChartMode = mode;
        document.getElementById('ecoChartYoY')?.classList.toggle('active', mode === 'yoy');
        document.getElementById('ecoChartMoMBtn')?.classList.toggle('active', mode === 'mom');
        _ecoRenderChart(_ecoTab, mode);
    }

    function _ecoRenderSectors(cpiMoM) {
        const isHigh = cpiMoM > 0.3;
        const sectors = [
            { name: '에너지', impact: isHigh ? 'positive' : 'neutral' },
            { name: '성장주/IT', impact: isHigh ? 'negative' : 'positive' },
            { name: '금융', impact: isHigh ? 'positive' : 'neutral' },
            { name: '소비재', impact: 'negative' },
            { name: '채권', impact: isHigh ? 'negative' : 'positive' },
            { name: '원자재', impact: isHigh ? 'positive' : 'neutral' },
        ];
        const icons = { positive: '🟢', negative: '🔴', neutral: '🟡' };
        const area = document.getElementById('sectorImpactArea');
        if (area) area.innerHTML = sectors.map(s =>
            `<span class="sector-badge sector-${s.impact}">${icons[s.impact]} ${s.name}</span>`
        ).join('');
    }

    function switchEcoTab(tab) {
        _ecoTab = tab;
        document.getElementById('ecoTabCpi').classList.toggle('active', tab === 'cpi');
        document.getElementById('ecoTabPpi').classList.toggle('active', tab === 'ppi');
        if (_ecoData) {
            _ecoRenderChart(tab);
            _ecoRenderTable(tab);
        }
    }

    async function generateEconomicAI() {
        if (!_ecoData) return;
        const btn = document.getElementById('ecoAiBtn');
        const body = document.getElementById('ecoAiBody');
        if (!btn || !body) return;
        btn.disabled = true;
        btn.textContent = '분석 중...';
        body.innerHTML = '<span class="eco-loading">AI가 분석 중입니다...</span>';
        try {
            const resp = await fetch('/api/economic-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cpiObs: _ecoData.cpi, ppiObs: _ecoData.ppi }),
            });
            const json = await resp.json();
            if (!resp.ok) throw new Error(json.error || '분석 실패');
            body.innerHTML = `<p style="white-space:pre-line">${escHtml(json.comment)}</p>`;
        } catch (e) {
            body.innerHTML = `<span class="eco-loading" style="color:var(--text3)">분석 실패: ${escHtml(e.message)}</span>`;
        } finally {
            btn.disabled = false;
            btn.textContent = '재분석';
        }
    }

    // ── 초기화 ──────────────────────────────────────────────────
    function vsReset() {
        if (_vsObjectURL) { URL.revokeObjectURL(_vsObjectURL); _vsObjectURL = null; }
        _vsFile = null; _vsNaturalW = 0; _vsNaturalH = 0;
        _vsHoveredIdx = null; _vsZones = [];
        clearTimeout(_vsScanTimer); clearInterval(_vsStepTimer); cancelAnimationFrame(_vsRafId);
        document.getElementById('vsEmpty').style.display   = '';
        document.getElementById('vsLoading').style.display = 'none';
        document.getElementById('vsResult').style.display  = 'none';
        document.getElementById('vsErrorBox').style.display = 'none';
        document.getElementById('vsDropzone').classList.remove('drag-over');
        document.getElementById('vsDropIcon').innerHTML = '<i class="ri-image-add-line" style="color:var(--text3);"></i>';
        const prog = document.getElementById('vsScanProgress');
        if (prog) prog.style.width = '0%';
    }

    // ── 파일 진입점 ─────────────────────────────────────────────
    function vsClickUpload() { document.getElementById('vsFileInput').click(); }

    function vsHandleFileInput(e) {
        const file = e.target.files?.[0];
        if (file) { _vsProcessFile(file); e.target.value = ''; }
    }

    // ── 드래그 앤 드롭 ─────────────────────────────────────────
    function vsDragEnter(e) {
        e.preventDefault();
        _vsDragCounter++;
        if (e.dataTransfer.items?.[0]?.kind === 'file') {
            document.getElementById('vsDropzone').classList.add('drag-over');
            document.getElementById('vsDropIcon').innerHTML = '<i class="ri-drop-line" style="color:var(--purple);"></i>';
        }
    }
    function vsDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    function vsDragLeave(e) {
        e.preventDefault();
        _vsDragCounter--;
        if (_vsDragCounter <= 0) {
            _vsDragCounter = 0;
            document.getElementById('vsDropzone').classList.remove('drag-over');
            document.getElementById('vsDropIcon').innerHTML = '<i class="ri-image-add-line" style="color:var(--text3);"></i>';
        }
    }
    function vsDrop(e) {
        e.preventDefault(); _vsDragCounter = 0;
        document.getElementById('vsDropzone').classList.remove('drag-over');
        document.getElementById('vsDropIcon').innerHTML = '<i class="ri-image-add-line" style="color:var(--text3);"></i>';
        const file = e.dataTransfer.files?.[0];
        if (file) _vsProcessFile(file);
    }

    // ── 전역 드래그 오버레이 (어디서든 드롭 가능) ───────────────
    let _vsGlobalDragCount = 0;
    document.addEventListener('dragenter', e => {
        if (!window._vsActive) return;
        _vsGlobalDragCount++;
        if (e.dataTransfer?.types?.includes('Files')) {
            document.getElementById('vsDragOverlay').classList.add('show');
        }
    });
    document.addEventListener('dragleave', e => {
        if (!window._vsActive) return;
        _vsGlobalDragCount--;
        if (_vsGlobalDragCount <= 0) {
            _vsGlobalDragCount = 0;
            document.getElementById('vsDragOverlay').classList.remove('show');
        }
    });
    document.addEventListener('dragover', e => { if (window._vsActive) e.preventDefault(); });
    document.addEventListener('drop', e => {
        if (!window._vsActive) return;
        e.preventDefault();
        _vsGlobalDragCount = 0;
        document.getElementById('vsDragOverlay').classList.remove('show');
        const file = e.dataTransfer?.files?.[0];
        if (file) { goVisionScanner(); _vsProcessFile(file); }
    });

    // ── 전역 Ctrl+V (클립보드 붙여넣기) ─────────────────────────
    window.addEventListener('paste', e => {
        if (!window._vsActive) return;
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        const items = Array.from(e.clipboardData?.items ?? []);
        const imgItem = items.find(it => it.kind === 'file' && VS_ACCEPTED.includes(it.type));
        if (imgItem) { e.preventDefault(); const f = imgItem.getAsFile(); if (f) _vsProcessFile(f); }
    });

    // ── 핵심: 파일 처리 ─────────────────────────────────────────
    function _vsProcessFile(file) {
        // 유효성 검사
        if (!VS_ACCEPTED.includes(file.type)) {
            return _vsShowError('PNG, JPG, WEBP, GIF 형식만 지원합니다.');
        }
        if (file.size > VS_MAX_MB * 1024 * 1024) {
            return _vsShowError(`파일 크기는 ${VS_MAX_MB}MB 이하여야 합니다.`);
        }
        // 이전 URL 해제
        if (_vsObjectURL) URL.revokeObjectURL(_vsObjectURL);
        _vsFile = file;
        _vsObjectURL = URL.createObjectURL(file);

        // 자연 크기 측정 후 로딩 화면 진입
        const probe = new Image();
        probe.onload = () => {
            _vsNaturalW = probe.naturalWidth;
            _vsNaturalH = probe.naturalHeight;
            _vsShowLoading();
        };
        probe.onerror = () => _vsShowError('이미지를 불러오는 데 실패했습니다.');
        probe.src = _vsObjectURL;
    }

    function _vsShowError(msg) {
        const box = document.getElementById('vsErrorBox');
        document.getElementById('vsErrorMsg').textContent = msg;
        box.style.display = 'flex';
        setTimeout(() => { box.style.display = 'none'; }, 8000);
    }

    // ── 로딩 화면 ────────────────────────────────────────────────
    function _vsShowLoading() {
        document.getElementById('vsEmpty').style.display   = 'none';
        document.getElementById('vsResult').style.display  = 'none';
        document.getElementById('vsLoading').style.display = '';
        document.getElementById('vsScanImg').src = _vsObjectURL;

        // 스텝 텍스트 순환
        const steps = ['캔들 패턴 인식 중…','거래량 프로파일 분석 중…','지지·저항 구간 탐색 중…','매물대 밀집 구간 계산 중…','AI 리포트 생성 중…'];
        let si = 0;
        const stepEl = document.getElementById('vsScanStepText');
        if (stepEl) stepEl.textContent = steps[0];
        clearInterval(_vsStepTimer);
        _vsStepTimer = setInterval(() => {
            si = (si + 1) % steps.length;
            if (stepEl) {
                stepEl.style.opacity = '0'; stepEl.style.transform = 'translateY(4px)';
                setTimeout(() => {
                    stepEl.textContent = steps[si];
                    stepEl.style.opacity = '1'; stepEl.style.transform = 'translateY(0)';
                }, 220);
            }
        }, 1200);

        // 진행률 바 (0→95% easing)
        const bar = document.getElementById('vsScanProgress');
        if (bar) { bar.style.width = '0%'; }
        let pct = 0;
        cancelAnimationFrame(_vsRafId);
        const tickProg = () => {
            pct += (95 - pct) * 0.03 + 0.25;
            if (pct >= 95) pct = 95;
            if (bar) bar.style.width = pct + '%';
            if (pct < 95) _vsRafId = requestAnimationFrame(tickProg);
        };
        _vsRafId = requestAnimationFrame(tickProg);

        // Claude Vision API 호출
        const formData = new FormData();
        formData.append('image', _vsFile);

        fetch('/api/vision-scan', { method: 'POST', body: formData })
            .then(r => r.json())
            .then(data => {
                clearInterval(_vsStepTimer);
                cancelAnimationFrame(_vsRafId);
                if (bar) bar.style.width = '100%';
                if (data.error) {
                    _vsApiResult = null;
                    setTimeout(() => { vsReset(); _vsShowError('AI 분석 실패: ' + data.error); }, 200);
                } else {
                    _vsApiResult = data;
                    setTimeout(_vsShowResult, 300);
                }
            })
            .catch(err => {
                clearInterval(_vsStepTimer);
                cancelAnimationFrame(_vsRafId);
                setTimeout(() => { vsReset(); _vsShowError('서버 연결 실패: ' + err.message); }, 200);
            });
    }

    // ── 결과 화면 ────────────────────────────────────────────────
    function _vsShowResult() {
        // API 결과 우선, 없으면 Mock
        const isReal = !!_vsApiResult;
        _vsZones = isReal ? _vsApiResult.zones : VS_MOCK_ZONES;
        const report = isReal ? _vsApiResult.summary : VS_MOCK_REPORT;

        document.getElementById('vsLoading').style.display = 'none';
        document.getElementById('vsResult').style.display  = '';

        // 데모 배너: 실제 분석이면 숨김, Mock이면 표시
        const demoBanner = document.getElementById('vsDemoBanner');
        if (demoBanner) demoBanner.style.display = isReal ? 'none' : '';

        // 메타 바
        const sizeMB = (_vsFile.size / 1024 / 1024).toFixed(2);
        document.getElementById('vsMetaName').textContent = _vsFile.name;
        document.getElementById('vsMetaSize').textContent = `${_vsNaturalW}×${_vsNaturalH}px · ${sizeMB}MB`;

        // 구간 카운트
        const support    = _vsZones.filter(z => z.type === 'support').length;
        const resistance = _vsZones.filter(z => z.type === 'resistance').length;
        document.getElementById('vsZoneCount').textContent = `${_vsZones.length}개 구간 탐지됨`;
        document.getElementById('vsLegSupport').textContent  = `(${support})`;
        document.getElementById('vsLegResist').textContent   = `(${resistance})`;

        // 원본 이미지 설정 → onload에서 캔버스 드로잉
        const img = document.getElementById('vsResultImg');
        img.onload = () => vsRedrawCanvas();
        img.src = _vsObjectURL;

        // 마크다운 리포트 렌더링
        document.getElementById('vsReportBody').innerHTML = _vsRenderMd(report);

        // ResizeObserver — 창 크기 변경 시 재드로잉
        if (window._vsResizeObs) window._vsResizeObs.disconnect();
        window._vsResizeObs = new ResizeObserver(() => vsRedrawCanvas());
        const wrap = document.getElementById('vsCanvasWrap');
        if (wrap) window._vsResizeObs.observe(wrap);

        // 다음 분석을 위해 API 결과 초기화
        _vsApiResult = null;
    }

    // ── 캔버스 드로잉 (DPR 완전 대응) ──────────────────────────
    function vsRedrawCanvas() {
        const canvas = document.getElementById('vsCanvas');
        const wrap   = document.getElementById('vsCanvasWrap');
        if (!canvas || !wrap) return;

        const dpr  = window.devicePixelRatio || 1;
        const cssW = wrap.offsetWidth;
        const cssH = wrap.offsetHeight;

        if (canvas.width  !== Math.round(cssW * dpr) ||
            canvas.height !== Math.round(cssH * dpr)) {
            canvas.width  = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
        }

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        _vsZones.forEach((zone, idx) => {
            const isHov   = _vsHoveredIdx === idx;
            const str     = zone.strength ?? 0.7;
            const isSupp  = zone.type === 'support';
            const fillC   = isSupp ? 'rgba(0,128,251,' : 'rgba(255,69,58,';
            const strokeC = isSupp ? '#3b82f6' : '#ef4444';
            const glowC   = isSupp ? 'rgba(0,128,251,' : 'rgba(255,69,58,';

            const rx = zone.xRatio * cssW;
            const ry = zone.yRatio * cssH;
            const rw = zone.wRatio * cssW;
            const rh = Math.max(zone.hRatio * cssH, 3);

            ctx.save();
            ctx.shadowColor = glowC + (isHov ? '.5)' : '.3)');
            ctx.shadowBlur  = isHov ? 18 : 8;

            // Fill
            ctx.globalAlpha = isHov ? .5 : .2 + str * .2;
            ctx.fillStyle   = fillC + '1)';
            ctx.fillRect(rx, ry, rw, rh);

            // 상단 가격선
            ctx.globalAlpha = isHov ? 1 : .65 + str * .3;
            ctx.strokeStyle = strokeC;
            ctx.lineWidth   = isHov ? 2.5 : 1.5;
            ctx.shadowBlur  = isHov ? 10 : 4;
            ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + rw, ry); ctx.stroke();

            // 하단 경계선
            ctx.lineWidth   = .8;
            ctx.globalAlpha *= .45;
            ctx.shadowBlur  = 0;
            ctx.beginPath(); ctx.moveTo(rx, ry + rh); ctx.lineTo(rx + rw, ry + rh); ctx.stroke();

            // 좌측 강도 바 (3px)
            ctx.globalAlpha = .85;
            ctx.shadowBlur  = 0;
            ctx.fillStyle   = strokeC;
            ctx.fillRect(rx, ry, 3, rh);

            ctx.restore();

            // 레이블 뱃지
            if (zone.label) _vsDrawLabel(ctx, zone.label, rx, ry, strokeC, isHov, cssH);
        });

        // ── DEMO 워터마크 (캔버스 중앙) ─────────────────────────
        ctx.save();
        ctx.font = `800 ${Math.max(cssW * 0.07, 18)}px/1 'Pretendard', system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = '#ef4444';
        ctx.translate(cssW / 2, cssH / 2);
        ctx.rotate(-Math.PI / 8);
        ctx.fillText('DEMO DATA', 0, 0);
        ctx.restore();
    }

    function _vsDrawLabel(ctx, text, x, y, color, isHov, cssH) {
        ctx.save();
        ctx.font = `${isHov ? 700 : 600} 11px/1 'Pretendard', system-ui`;
        const tw  = ctx.measureText(text).width;
        const bw  = tw + 16, bh = 22;
        const lx  = x + 6;
        const ly  = (y - bh - 3 < 0) ? y + 4 : y - bh - 3;

        // 배경
        ctx.globalAlpha = isHov ? .97 : .88;
        ctx.fillStyle   = 'rgba(10,14,20,.92)';
        _vsRoundRect(ctx, lx, ly, bw, bh, 4);
        ctx.fill();

        // 테두리
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1;
        ctx.globalAlpha = isHov ? 1 : .7;
        ctx.stroke();

        // 텍스트
        ctx.fillStyle   = color;
        ctx.globalAlpha = 1;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, lx + 8, ly + bh / 2);
        ctx.restore();
    }

    function _vsRoundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ── 마우스 호버 ─────────────────────────────────────────────
    function vsMouseMove(e) {
        const canvas = document.getElementById('vsCanvas');
        if (!canvas || !_vsZones.length) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cw = rect.width, ch = rect.height;
        const idx = _vsZones.findIndex(z => {
            const rx = z.xRatio * cw, ry = z.yRatio * ch;
            const rw = z.wRatio * cw, rh = Math.max(z.hRatio * ch, 12);
            return mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh;
        });
        const next = idx === -1 ? null : idx;
        if (next !== _vsHoveredIdx) { _vsHoveredIdx = next; vsRedrawCanvas(); }
    }
    function vsMouseLeave() { _vsHoveredIdx = null; vsRedrawCanvas(); }

    // ── 경량 마크다운 → HTML 렌더러 ─────────────────────────────
    function _vsRenderMd(md) {
        const lines = md.split('\n');
        let html = '';
        let inTable = false, tableRows = [];

        const flushTable = () => {
            if (!tableRows.length) return;
            html += '<table class="vs-report-table">';
            tableRows.forEach((row, ri) => {
                const cells = row.split('|').filter(c => c.trim() !== '').map(c => c.trim());
                const tag = ri === 0 ? 'th' : 'td';
                html += '<tr>' + cells.map(c => `<${tag}>${_vsMdInline(c)}</${tag}>`).join('') + '</tr>';
            });
            html += '</table>';
            tableRows = []; inTable = false;
        };

        lines.forEach(line => {
            if (line.startsWith('## '))       { flushTable(); html += `<h2>${_vsMdInline(line.slice(3))}</h2>`; }
            else if (line.startsWith('### ')) { flushTable(); html += `<h3>${_vsMdInline(line.slice(4))}</h3>`; }
            else if (line.startsWith('> '))   { flushTable(); html += `<blockquote>${_vsMdInline(line.slice(2))}</blockquote>`; }
            else if (line.startsWith('- '))   { flushTable(); html += `<ul><li>${_vsMdInline(line.slice(2))}</li></ul>`; }
            else if (line.startsWith('|') && line.endsWith('|')) {
                if (!line.replace(/[\|\s\-]/g,'')) return; // separator row
                inTable = true; tableRows.push(line);
            }
            else if (inTable) { flushTable(); }
            else if (line.trim() === '') { /* skip */ }
            else { html += `<p>${_vsMdInline(line)}</p>`; }
        });
        flushTable();
        // 연속 <ul> 병합
        return html.replace(/<\/ul><ul>/g, '');
    }
    function _vsMdInline(t) {
        return t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    // ── AI 차트 라인 지우기 ──
    function clearAiChartLines() {
        lwAiPriceLines.forEach(pl => { try { lwCandleSeries?.removePriceLine(pl); } catch(e) {} });
        lwAiPriceLines = [];
        lwAiTrendSeries.forEach(s => { try { lwChart?.removeSeries(s); } catch(e) {} });
        lwAiTrendSeries = [];
        lwAiCanvasTrendlines = [];
        lwClientTrendlines = [];
        lwAiLastData = null;
        setTimeout(redrawCanvas, 50);
        if (currentSymbol) {
            _aiLsRemove(currentSymbol);
            fetch('/api/ai-analysis/' + encodeURIComponent(currentSymbol), { method: 'DELETE' }).catch(() => {});
        }
        const btn = document.getElementById('chartAiClearBtn');
        if (btn) btn.style.display = 'none';
        const card = document.getElementById('aiSummaryCard');
        if (card) card.style.display = 'none';
    }

    // ── AI 차트 라인 그리기 ──
    function drawAiChartLines(data, timestamps) {
        if (!lwChart || !lwCandleSeries) return;
        const ts = timestamps || stockData?.timestamp || [];
        lwAiLastData = { data, timestamps: ts, symbol: currentSymbol }; // 복원용 저장
        if (currentSymbol) {
            _aiLsSave(currentSymbol, data);
            // 서버(Supabase)에도 저장 → 크로스 기기/PWA 동기화
            fetch('/api/ai-analysis/' + encodeURIComponent(currentSymbol), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            }).catch(() => {});
        }

        // 테스타 전략: lines[] 배열 그대로 그리기 (MA5/MA20/MA70 + 진입가 옵션)
        const _fmtP = p => currentMarket === 'KR' ? Math.round(p).toLocaleString() : Number(p).toFixed(2);
        const lines = Array.isArray(data.lines) ? data.lines : [];
        lines.forEach(ln => {
            if (!ln || ln.price == null || ln.price <= 0) return;
            try {
                const isMA20 = ln.type === 'ma20';
                const isEntry = ln.type === 'entry';
                const pl = lwCandleSeries.createPriceLine({
                    price: ln.price,
                    color: ln.color || '#94a3b8',
                    lineWidth: (isMA20 || isEntry) ? 2 : 1,
                    lineStyle: isEntry ? 0 : 2, // entry는 실선, MA는 점선
                    axisLabelVisible: true,
                    title: `${ln.label || ln.type} ${_fmtP(ln.price)}`,
                });
                lwAiPriceLines.push(pl);
            } catch(e) {}
        });

        // 추세선·시나리오 라인 모두 폐기 (테스타는 추세선·지지저항 사용 안 함)
        lwAiCanvasTrendlines = [];
        lwClientTrendlines = [];

        const clearBtn = document.getElementById('chartAiClearBtn');
        if (clearBtn && lwAiPriceLines.length) clearBtn.style.display = '';

        // AI 핵심 분석 카드 렌더링 (테스타 신호 카드)
        try { _renderTestaSignalCard(data); } catch(e) {}
    }

    // ── 테스타 신호 카드 렌더링 (4가지 신호 + 3가지 모드) ──
    function _renderTestaSignalCard(data) {
        const card = document.getElementById('aiSummaryCard');
        if (!card) return;
        const signal = (data.signal || 'HOLD').toUpperCase();
        const sym = data.symbol || currentSymbol || '';
        const cur = data.currentPrice;
        const ma = data.ma || {};
        const _fmtP = p => p == null ? '-' : (currentMarket === 'KR' ? Math.round(p).toLocaleString() + '원' : '$' + Number(p).toFixed(2));
        const _pct = v => v == null ? '-' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';

        const SIGNAL_META = {
            BUY:       { label: '매수 신호',  klass: 'signal-buy',  icon: '▲' },
            SELL_STOP: { label: '손절 신호',  klass: 'signal-stop', icon: '✕' },
            SELL_TAKE: { label: '익절 신호',  klass: 'signal-take', icon: '✓' },
            HOLD:      { label: '관망',       klass: 'signal-hold', icon: '⊘' },
        };
        const meta = SIGNAL_META[signal] || SIGNAL_META.HOLD;

        let body = '';

        const isBreakout5m = data.mode === 'breakout-5m';
        const isDayMode = data.mode === 'day' || isBreakout5m;
        // 모드 라벨
        const modeLabel = isBreakout5m ? '5분봉 돌파' : (data.mode === 'day' ? '단타' : '스윙');
        if (signal === 'BUY' && data.entry) {
            const e = data.entry;
            // ── 5분봉 돌파 단타 BUY 카드 (별도 디자인) ──
            if (isBreakout5m) {
                const SL_TYPE_LABEL = {
                    'price-break': '돌파선 -0.3% 이탈',
                    'ma20-break':  'SMA20 이탈',
                    'loss-pct':    '진입가 -1.5%',
                };
                const SOURCE_LABEL = {
                    'today-box-high':  '당일 박스 상단',
                    'yesterday-high':  '전일 고점',
                    'resistance':      '저항선',
                };
                const tp1Price = e.price && e.takeProfit1Pct ? e.price * (1 + e.takeProfit1Pct/100) : null;
                const tp2Price = e.price && e.takeProfit2Pct ? e.price * (1 + e.takeProfit2Pct/100) : null;
                body = `
                    <div class="testa-day-mode-info testa-breakout-banner">
                        <span>⚡</span>
                        <span class="testa-urgency-high">5분봉 돌파 단타 — 당일 청산 원칙</span>
                        ${e.expectedHoldMinutes ? `<span class="testa-day-deadline">· 보유 ${e.expectedHoldMinutes}분 (${Math.round(e.expectedHoldMinutes/60*10)/10}시간)</span>` : ''}
                    </div>
                    <div class="testa-position-info">
                        <div class="tpi-row"><span class="tpi-lbl">돌파선 (${SOURCE_LABEL[e.breakoutSource] || '저항선'})</span><span class="tpi-val testa-line-breakout">${_fmtP(e.breakoutPrice)}</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">진입가</span><span class="tpi-val">${_fmtP(e.price)}</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">손절가</span><span class="tpi-val tpi-stop">${_fmtP(e.stopLossPrice)} (${_pct(e.stopLossPct)})</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">손절 유형</span><span class="tpi-val">${SL_TYPE_LABEL[e.stopLossType] || e.stopLossType || '-'}</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">1차 익절 (50% 청산)</span><span class="tpi-val tpi-take">${_fmtP(tp1Price)} (+${e.takeProfit1Pct ?? 1.5}%)</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">2차 익절 (30% 청산)</span><span class="tpi-val tpi-take">${_fmtP(tp2Price)} (+${e.takeProfit2Pct ?? 3.0}%)</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">잔여 20% 트레일링</span><span class="tpi-val">${(e.trailingMA || 'sma5').toUpperCase()}</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">권장 비중</span><span class="tpi-val">${e.positionSizePct != null ? e.positionSizePct.toFixed(1) + '%' : '5.0%'}</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">시간 손절</span><span class="tpi-val testa-time-countdown">${e.timeStopMinutes || 30}분 (${e.timeStopBars || 6}봉) 내 +0.5% 미달성 시 정리</span></div>
                    </div>
                    ${e.deadline ? `<div class="testa-day-deadline">⏰ ${escHtml(e.deadline)}</div>` : ''}
                    <div class="testa-criteria-title">진입 근거 (5분봉 돌파 4단계 — 모두 충족)</div>
                    <ul class="testa-criteria">
                        ${(e.criteria || []).map(c => `
                            <li class="${c.passed ? 'pass' : 'fail'}">
                                <span class="tc-icon">${c.passed ? '✓' : '✗'}</span>
                                <div class="tc-body">
                                    <div class="tc-label">${escHtml(c.label || '')}</div>
                                    ${c.detail ? `<div class="tc-detail">${escHtml(c.detail)}</div>` : ''}
                                </div>
                            </li>`).join('')}
                    </ul>`;
            } else {
                // 일봉 단타/스윙 BUY 카드 (기존)
                const URGENCY_LABEL = {
                    intraday: { ko: '당일 청산 권장', cls: 'testa-urgency-high' },
                    short:    { ko: '2~3거래일 청산 권장', cls: 'testa-urgency-medium' },
                    standard: { ko: '4~5거래일 청산 권장', cls: 'testa-urgency-low' },
                };
                const urg = URGENCY_LABEL[e.urgency] || URGENCY_LABEL.standard;
                const dayInfo = isDayMode ? `
                    <div class="testa-day-mode-info">
                        <span>⚡</span>
                        <span class="${urg.cls}">${urg.ko}</span>
                        ${e.expectedHoldDays ? `<span class="testa-day-deadline">· 보유 ${e.expectedHoldDays}일</span>` : ''}
                    </div>
                    ${e.holdDaysRationale ? `<div class="testa-day-deadline">📌 ${escHtml(e.holdDaysRationale)}</div>` : ''}
                    <div class="testa-day-deadline">⏰ 강제 청산 데드라인: ${e.exitDeadlineDays || 5}거래일 (1주 초과 보유 금지)</div>
                ` : '';

                body = `
                    <div class="testa-position-info">
                        <div class="tpi-row"><span class="tpi-lbl">진입가</span><span class="tpi-val">${_fmtP(e.price)}</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">손절가 (MA20)</span><span class="tpi-val tpi-stop">${_fmtP(e.stopLossPrice)} (${_pct(e.stopLossPct)})</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">권장 비중</span><span class="tpi-val">${e.positionSizePct != null ? e.positionSizePct.toFixed(2) + '%' : '-'}</span></div>
                        <div class="tpi-row"><span class="tpi-lbl">예상 R/R</span><span class="tpi-val">${e.expectedRR || '-'}</span></div>
                    </div>
                    ${dayInfo}
                    <div class="testa-criteria-title">진입 근거 (${isDayMode ? '9개 조건 — 5원칙 + 4 단타 강화' : '5개 조건 모두 충족'})</div>
                    <ul class="testa-criteria">
                        ${(e.criteria || []).map(c => `
                            <li class="${c.passed ? 'pass' : 'fail'}">
                                <span class="tc-icon">${c.passed ? '✓' : '✗'}</span>
                                <div class="tc-body">
                                    <div class="tc-label">${escHtml(c.label || '')}</div>
                                    ${c.detail ? `<div class="tc-detail">${escHtml(c.detail)}</div>` : ''}
                                </div>
                            </li>`).join('')}
                    </ul>`;
            }
        } else if ((signal === 'SELL_STOP' || signal === 'SELL_TAKE') && data.exit) {
            const x = data.exit;
            const isStop = signal === 'SELL_STOP';
            body = `
                <div class="testa-position-info">
                    <div class="tpi-row"><span class="tpi-lbl">청산가</span><span class="tpi-val">${_fmtP(x.price)}</span></div>
                    <div class="tpi-row"><span class="tpi-lbl">MA20</span><span class="tpi-val">${_fmtP(x.ma20)}</span></div>
                    <div class="tpi-row"><span class="tpi-lbl">손익률</span><span class="tpi-val ${isStop ? 'tpi-stop' : 'tpi-take'}">${_pct(x.pnlPct)}</span></div>
                </div>
                <div class="testa-rationale">${escHtml(x.rationale || '')}</div>
                <div class="testa-warning">⚠ 종가가 20일선 아래 마감 — ${isStop ? '즉시 손절' : '전량 익절'} (예외 없음)</div>`;
        } else {
            // HOLD
            const h = data.hold || { unmet: [], guidance: '' };
            const dayReject = isDayMode && h.dayModeRejection
                ? `<div class="testa-day-mode-info"><span>⚡</span><span>${escHtml(h.dayModeRejection)}</span></div>`
                : '';
            body = `
                ${dayReject}
                <div class="testa-criteria-title">${isDayMode ? '단타 진입 거부 — ' : ''}미충족 조건</div>
                <ul class="testa-unmet">
                    ${(h.unmet || []).map(u => `<li>${escHtml(u)}</li>`).join('') || '<li>모든 조건 정상이지만 명확한 진입 시그널 없음</li>'}
                </ul>
                <div class="testa-guidance">${escHtml(h.guidance || '조건 충족 시까지 대기')}</div>`;
        }

        // 카드 모드 클래스 — breakout-5m / day / swing 3가지
        const modeClass = isBreakout5m ? 'mode-breakout-5m' : (isDayMode ? 'mode-day' : 'mode-swing');
        card.style.display = '';
        card.innerHTML = `
            <div class="testa-card ${meta.klass} ${modeClass}">
                <div class="testa-card-head">
                    <span class="testa-badge ${meta.klass}">
                        <span class="tb-icon">${meta.icon}</span>
                        <span class="tb-label">${meta.label}</span>
                        <span class="tb-mode">${modeLabel}</span>
                    </span>
                    <div class="testa-card-meta">
                        <span class="tcm-sym">${escHtml(sym)}</span>
                        <span class="tcm-price">${_fmtP(cur)}</span>
                    </div>
                </div>
                <div class="testa-ma-bar">
                    <span class="tma tma-5">MA5 ${_fmtP(ma.ma5)}</span>
                    <span class="tma tma-20">MA20 ${_fmtP(ma.ma20)}</span>
                    <span class="tma tma-70">MA70 ${_fmtP(ma.ma70)}</span>
                </div>
                ${body}
                ${data.summary ? `<div class="testa-summary">${escHtml(data.summary)}</div>` : ''}
            </div>`;

        // 기존 패턴/시간지평 섹션은 숨김 (테스타 전략은 사용 안 함)
        const patSec = document.getElementById('aiPatternSection');
        const horSec = document.getElementById('aiHorizonSection');
        const repPanel = document.getElementById('aiSummaryReport');
        const repToggle = document.getElementById('aiSummaryToggle');
        if (patSec) patSec.style.display = 'none';
        if (horSec) horSec.style.display = 'none';
        if (repPanel) repPanel.style.display = 'none';
        if (repToggle) repToggle.style.display = 'none';
    }

    // ── AI 리포트 아코디온 토글 ──
    function toggleAiReport() {
        const btn = document.getElementById('aiSummaryToggle');
        const panel = document.getElementById('aiSummaryReport');
        if (!btn || !panel) return;
        const isOpen = panel.classList.toggle('open');
        btn.classList.toggle('open', isOpen);
        btn.querySelector('svg').nextSibling.textContent = isOpen ? ' 상세 리포트 접기' : ' 상세 분석 리포트 보기';
    }

    // ── 마크다운→HTML 간이 변환 (레거시 data.report 폴백용) ──
    function _aiMdToHtml(md) {
        return md
            .replace(/#### (.+)/g, '<h4>$1</h4>')
            .replace(/### (.+)/g, '<h3>$1</h3>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n{2,}/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>').replace(/$/, '</p>')
            .replace(/<p><h([34])>/g, '<h$1>').replace(/<\/h([34])><\/p>/g, '</h$1>')
            .replace(/<p><\/p>/g, '');
    }

    // ── 차트 패턴 + 시간 지평 렌더러 (요약 카드 상단) ──
    function renderPatternHorizon(a) {
        const patSec = document.getElementById('aiPatternSection');
        const patList = document.getElementById('aiPatternList');
        const horSec = document.getElementById('aiHorizonSection');
        const horGrid = document.getElementById('aiHorizonGrid');
        const fmtN = v => (v == null || isNaN(Number(v))) ? null : Number(v).toFixed(2);

        // 패턴
        const patterns = (a && Array.isArray(a.patterns)) ? a.patterns.slice(0, 3) : [];
        if (patSec && patList) {
            if (patterns.length) {
                patList.innerHTML = patterns.map(p => {
                    const status = String(p.status || 'forming').toLowerCase();
                    const statusCls = ['forming','completed','breakout'].includes(status) ? status : 'forming';
                    const statusLabel = status === 'completed' ? '완성' : (status === 'breakout' ? '돌파' : '형성중');
                    const target = fmtN(p.target);
                    const neckline = fmtN(p.neckline);
                    return `
                        <div class="ai-pattern-chip">
                            <div class="ai-pattern-chip-head">
                                <span class="ai-pattern-name">${escHtml(p.name || '패턴')}</span>
                                <span class="ai-pattern-status ai-pattern-status-${statusCls}">${statusLabel}</span>
                            </div>
                            <div class="ai-pattern-chip-meta">
                                ${neckline ? `<span>넥라인 <b>${neckline}</b></span>` : ''}
                                ${target ? `<span>목표 <b>${target}</b></span>` : ''}
                            </div>
                            ${p.rationale ? `<div class="ai-pattern-rat">${escHtml(p.rationale)}</div>` : ''}
                        </div>`;
                }).join('');
                patSec.style.display = '';
            } else {
                patList.innerHTML = '';
                patSec.style.display = 'none';
            }
        }

        // 시간 지평
        const th = a && a.timeHorizon;
        if (horSec && horGrid) {
            if (th && (th.shortTerm || th.midTerm || th.longTerm)) {
                const primary = String(th.primaryHorizon || '').toLowerCase();
                const cell = (key, label, text) => `
                    <div class="ai-horizon-cell ${primary === key ? 'is-primary' : ''}">
                        <div class="ai-horizon-cell-label">${label}</div>
                        <div class="ai-horizon-cell-text">${escHtml(text || '-')}</div>
                    </div>`;
                horGrid.innerHTML =
                    cell('short', '단기 (1~2주)', th.shortTerm) +
                    cell('mid',   '중기 (1~3개월)', th.midTerm) +
                    cell('long',  '장기 (6개월+)', th.longTerm);
                horSec.style.display = '';
            } else {
                horGrid.innerHTML = '';
                horSec.style.display = 'none';
            }
        }
    }

    // ── 구조화 분석 리포트 렌더러 (data.analysis → 4섹션 카드 HTML) ──
    function renderAnalysisReport(a) {
        const host = document.getElementById('aiSummaryReportInner');
        if (!host || !a) return;
        const fmt = v => (v == null || isNaN(Number(v))) ? '-' : Number(v).toFixed(2);
        const price = (v, dir = 'neutral') => `<span class="ar-price ${dir}">${fmt(v)}</span>`;

        const t = a.trend || {};
        const trendHtml = `
            <div class="ar-section">
                <h4>추세 &amp; 구조</h4>
                <dl class="ar-kv">
                    <dt>주요 추세</dt><dd>${escHtml(t.primary || '-')}</dd>
                    <dt>타임프레임</dt><dd>${escHtml(t.timeframe || '-')}</dd>
                    <dt>구조</dt><dd>${escHtml(t.structure || '-')}</dd>
                </dl>
                ${t.commentary ? `<p>${escHtml(t.commentary)}</p>` : ''}
            </div>`;

        const kl = a.keyLevels || {};
        const levelsHtml = `
            <div class="ar-section">
                <h4>핵심 가격대</h4>
                <dl class="ar-kv">
                    <dt>즉시 저항</dt><dd>${price(kl.immediateResistance, 'down')}</dd>
                    <dt>즉시 지지</dt><dd>${price(kl.immediateSupport, 'up')}</dd>
                    <dt>주요 저항</dt><dd>${price(kl.majorResistance, 'down')}</dd>
                    <dt>주요 지지</dt><dd>${price(kl.majorSupport, 'up')}</dd>
                </dl>
                ${kl.rationale ? `<p>${escHtml(kl.rationale)}</p>` : ''}
            </div>`;

        const ind = a.indicators || {};
        const indHtml = `
            <div class="ar-section">
                <h4><i class="ri-bar-chart-2-line"></i> 지표 해석</h4>
                <p><strong>RSI:</strong> ${escHtml(ind.rsi || '-')}</p>
                <p><strong>MACD:</strong> ${escHtml(ind.macd || '-')}</p>
                <p><strong>이동평균:</strong> ${escHtml(ind.ma || '-')}</p>
                <p><strong>ATR:</strong> ${escHtml(ind.atr || '-')}</p>
                <p><strong>거래량:</strong> ${escHtml(ind.volume || '-')}</p>
            </div>`;

        const sc = a.scenarios || {};
        const scenarioCard = (key, d) => {
            if (!d) return '';
            const cls = key === 'bull' ? 'bull' : 'bear';
            const icon = key === 'bull' ? '🟢 반등 관점' : '🟠 하락 관점';
            const conv = String(d.conviction || 'medium').toLowerCase();
            const convCls = ['high','medium','low'].includes(conv) ? conv : 'medium';
            return `
                <div class="ar-scenario ${cls}">
                    <div class="ar-scenario-head">
                        <span>${icon} 시나리오 <span class="ar-conv ${convCls}">${convCls.toUpperCase()}</span></span>
                        <span class="ar-scenario-rr">R/R ${escHtml(d.rr || '-')}</span>
                    </div>
                    <dl class="ar-kv">
                        <dt>트리거</dt><dd>${escHtml(d.trigger || '-')}</dd>
                        <dt>1차 매수</dt><dd>${price(d.buy1 ?? d.entry)}</dd>
                        <dt>2차 매수</dt><dd>${price(d.buy2)}</dd>
                        <dt>3차 매수</dt><dd>${price(d.buy3)}</dd>
                        <dt>손절</dt><dd>${price(d.stopLoss, 'down')}</dd>
                        <dt>TP1</dt><dd>${price(d.tp1, 'up')}</dd>
                        <dt>TP2</dt><dd>${price(d.tp2, 'up')}</dd>
                    </dl>
                    ${d.rationale ? `<p>${escHtml(d.rationale)}</p>` : ''}
                </div>`;
        };
        const biasKey = String(sc.bias || 'neutral').toLowerCase();
        const biasCls = biasKey === 'bull' ? 'high' : (biasKey === 'bear' ? 'low' : 'medium');
        const biasLabel = biasKey === 'bull' ? '상방' : (biasKey === 'bear' ? '하방' : '중립');
        const planHtml = `
            <div class="ar-section">
                <h4>실전 트레이드 플랜 <span class="ar-conv ${biasCls}">편향: ${biasLabel}</span></h4>
                ${scenarioCard('bull', sc.bull)}
                ${scenarioCard('bear', sc.bear)}
            </div>`;

        host.innerHTML = trendHtml + levelsHtml + indHtml + planHtml;
    }

    // ── 차트 컨텍스트 JSON 조립 (OHLCV + 지표 최신값 + 시계열) ──
    // ── 테스타 매매 모드 (스윙 / 단타) ──
    let currentTestaMode = (typeof localStorage !== 'undefined' && localStorage.getItem('testaMode') === 'day') ? 'day' : 'swing';
    function setTradeMode(mode) {
        // 5분봉 차트에서는 swing 불가 → 자동 day 전환
        if (mode === 'swing' && currentInterval === '5m') {
            currentTestaMode = 'day';
            try { localStorage.setItem('testaMode', 'day'); } catch(_){}
            document.querySelectorAll('.trade-mode-toggle .tm-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.mode === 'day')
            );
            if (typeof showToast === 'function') {
                showToast('⚡ 5분봉은 단타 전용입니다. 자동 단타 전환');
            }
            return;
        }
        currentTestaMode = (mode === 'day') ? 'day' : 'swing';
        try { localStorage.setItem('testaMode', currentTestaMode); } catch(_){}
        document.querySelectorAll('.trade-mode-toggle .tm-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === currentTestaMode)
        );
        if (typeof showToast === 'function') {
            const isBreakout = currentTestaMode === 'day' && currentInterval === '5m';
            const msg = isBreakout ? '⚡ 5분봉 돌파 단타 모드 (당일 청산)'
                : currentTestaMode === 'day' ? '⚡ 단타 모드 — 1~5거래일 청산'
                : '📈 스윙 모드 — 추세 종료까지';
            showToast(msg);
        }
    }
    // 페이지 로드 시 저장된 모드 복원
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.trade-mode-toggle .tm-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.mode === currentTestaMode)
        );
        // 등급 필터 버튼 초기 상태 동기화
        if (typeof _minGradeFilter !== 'undefined') {
            document.querySelectorAll('.grade-btn, .grade-seg-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.grade === _minGradeFilter));
        }

        // Smart Dip v3: S&P 500 시장 환경 로드
        if (typeof _loadSpxData === 'function') {
            _loadSpxData();
            setInterval(_loadSpxData, 60 * 60 * 1000);
        }

        // 새로고침 후 전체화면 상태 복원
        if (typeof _restoreFullscreenState === 'function') _restoreFullscreenState();
        // Phase X1: 멀티차트 레이아웃 복원 + 모바일 visibility
        if (typeof _xcRestoreLayout === 'function') _xcRestoreLayout();
        if (typeof _xcApplyMobileVisibility === 'function') _xcApplyMobileVisibility();
        window.addEventListener('resize', () => {
            if (typeof _xcApplyMobileVisibility === 'function') _xcApplyMobileVisibility();
        }, { passive: true });
    });

    // ── 5분봉 돌파 단타 컨텍스트 추출 (전일 고점, 당일 박스 상단, 장 시작 후 경과 분 등) ──
    function _extractBreakoutContext(ohlcv, dates, highs, lows, closes, currentInterval) {
        // 5분봉 전용 — 그 외 인터벌이면 null 반환
        if (currentInterval !== '5m') return null;
        if (!ohlcv || ohlcv.length === 0 || !dates || dates.length === 0) return null;

        // 마지막 봉의 timestamp 기준 → 오늘 날짜 추출
        const lastTs = (typeof stockData !== 'undefined' && stockData?.timestamp)
            ? stockData.timestamp[stockData.timestamp.length - 1] : null;
        if (!lastTs) return null;
        const lastDate = new Date(lastTs * 1000);
        const today = lastDate.toISOString().slice(0,10);

        // 어제 날짜 (마지막 봉 기준 1일 전, 주말 건너뛰기)
        const yesterday = new Date(lastDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0,10);

        // ohlcv를 날짜별로 그룹화 (각 OHLCV 항목의 d 필드는 'YYYY-MM-DD' 형식)
        const todayBars = ohlcv.filter(o => o.d === today);
        const yesterdayBars = ohlcv.filter(o => o.d === yesterdayStr);

        // 어제 최고가 (없으면 그제, 그그제 등 가장 최근 다른 날)
        let yesterdayHigh = null;
        if (yesterdayBars.length > 0) {
            yesterdayHigh = Math.max(...yesterdayBars.map(o => o.h ?? -Infinity).filter(v => v > -Infinity));
        } else {
            // 폴백: today 가 아닌 가장 최근 날의 최고가
            const otherDayBars = ohlcv.filter(o => o.d && o.d !== today);
            if (otherDayBars.length > 0) {
                const lastOtherDay = otherDayBars[otherDayBars.length - 1].d;
                const lastOtherDayBars = ohlcv.filter(o => o.d === lastOtherDay);
                yesterdayHigh = Math.max(...lastOtherDayBars.map(o => o.h ?? -Infinity).filter(v => v > -Infinity));
            }
        }

        // 오늘 시가, 현재까지 최고가, 박스 상하단 (첫 6봉 = 30분)
        let todayOpen = null, todayHighSoFar = null, todayBoxHigh = null, todayBoxLow = null;
        if (todayBars.length > 0) {
            todayOpen = todayBars[0].o ?? null;
            const todayHighs = todayBars.map(o => o.h).filter(v => v != null);
            todayHighSoFar = todayHighs.length > 0 ? Math.max(...todayHighs) : null;
            const boxBars = todayBars.slice(0, 6); // 첫 6봉(30분)
            if (boxBars.length >= 3) { // 최소 3봉(15분)은 있어야 박스 형성으로 인정
                const boxHighs = boxBars.map(o => o.h).filter(v => v != null);
                const boxLows  = boxBars.map(o => o.l).filter(v => v != null);
                todayBoxHigh = boxHighs.length > 0 ? Math.max(...boxHighs) : null;
                todayBoxLow  = boxLows.length > 0  ? Math.min(...boxLows)  : null;
            }
        }

        // 최근 5일 최고가 (today 제외)
        const recent5dBars = ohlcv.filter(o => o.d && o.d !== today).slice(-5*78); // 약 5거래일치 (78봉/거래일)
        const recent5dHighs = recent5dBars.map(o => o.h).filter(v => v != null);
        const recent5dHigh = recent5dHighs.length > 0 ? Math.max(...recent5dHighs) : null;

        // 장 시작 후 경과 분 (오늘 첫 봉 시각부터 마지막 봉 시각까지)
        let minutesSinceOpen = null, isMarketHours = false;
        if (todayBars.length > 0 && stockData?.timestamp) {
            // todayBars 첫 항목의 timestamp 찾기
            const firstTodayIdx = ohlcv.findIndex(o => o.d === today);
            if (firstTodayIdx >= 0) {
                const tsArr = stockData.timestamp;
                const offset = stockData.timestamp.length - ohlcv.length;
                const firstTodayTs = tsArr[firstTodayIdx + offset];
                if (firstTodayTs) {
                    minutesSinceOpen = Math.round((lastTs - firstTodayTs) / 60);
                    isMarketHours = minutesSinceOpen >= 0 && minutesSinceOpen <= 6.5 * 60; // ~6.5h US session
                }
            }
        }

        const r2 = v => v == null ? null : +Number(v).toFixed(2);
        return {
            yesterdayHigh:    r2(yesterdayHigh),
            todayOpen:        r2(todayOpen),
            todayHighSoFar:   r2(todayHighSoFar),
            todayBoxHigh:     r2(todayBoxHigh),
            todayBoxLow:      r2(todayBoxLow),
            recent5dHigh:     r2(recent5dHigh),
            minutesSinceOpen: minutesSinceOpen,
            isMarketHours:    isMarketHours,
        };
    }

    // 단기 스윙 고점/저점 추출 — 좌우 k봉 모두보다 높은(/낮은) 캔들을 swing point로 인정
    function _extractSwingPoints(highs, lows, k = 3, maxPoints = 5) {
        const swingHighs = [];
        const swingLows  = [];
        const N = Math.min(60, highs.length);
        const startIdx = highs.length - N;
        for (let i = Math.max(startIdx + k, k); i < highs.length - k; i++) {
            const h = highs[i];
            if (h == null) continue;
            let isHigh = true;
            for (let j = 1; j <= k; j++) {
                if (highs[i - j] != null && highs[i - j] >= h) { isHigh = false; break; }
                if (highs[i + j] != null && highs[i + j] >= h) { isHigh = false; break; }
            }
            if (isHigh) swingHighs.push({ idx: i, price: +Number(h).toFixed(2) });
        }
        for (let i = Math.max(startIdx + k, k); i < lows.length - k; i++) {
            const l = lows[i];
            if (l == null) continue;
            let isLow = true;
            for (let j = 1; j <= k; j++) {
                if (lows[i - j] != null && lows[i - j] <= l) { isLow = false; break; }
                if (lows[i + j] != null && lows[i + j] <= l) { isLow = false; break; }
            }
            if (isLow) swingLows.push({ idx: i, price: +Number(l).toFixed(2) });
        }
        // 가장 최근 maxPoints개만 유지
        return {
            swingHighs: swingHighs.slice(-maxPoints),
            swingLows:  swingLows.slice(-maxPoints),
        };
    }

    function buildChartContextJson() {
        if (!stockData || !stockData.indicators || !stockData.indicators.quote) return null;
        const q = stockData.indicators.quote[0];
        const closes = q.close || [];
        const highs  = q.high  || [];
        const lows   = q.low   || [];
        const opens  = q.open  || [];
        const vols   = q.volume|| [];
        const dates  = (stockData.timestamp || []).map(t => {
            const d = new Date(t * 1000);
            return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        });

        const lastVal = arr => {
            if (!arr) return null;
            for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
            return null;
        };
        const r2 = v => (v == null || isNaN(v)) ? null : +Number(v).toFixed(2);
        const r2arr = arr => (arr || []).map(r2);

        // 테스타 전략: SMA 5 / 20 / 70 + ATR(14) (단타 손절폭 산출용)
        const sma5  = calcSMA(closes, 5);
        const sma20 = calcSMA(closes, 20);
        const sma70 = calcSMA(closes, 70);
        const atr   = calcATR(highs, lows, closes, 14);

        const cur = lastVal(closes);

        // ── 단타 모드 추가 컨텍스트 (volRatio / ma5Slope / lastCandle) ──
        // 거래량 비율: 최근 봉 / 최근 20봉 평균
        let volRatio = null;
        const validVols = vols.filter(v => v != null && v > 0);
        if (validVols.length >= 20) {
            const last = validVols[validVols.length - 1];
            const last20Avg = validVols.slice(-20).reduce((a, b) => a + b, 0) / 20;
            volRatio = last20Avg > 0 ? +(last / last20Avg).toFixed(2) : null;
        }
        // 5일선 기울기: 최근 3봉 변화율 %
        let ma5Slope = null;
        const validSma5 = sma5.filter(v => v != null);
        if (validSma5.length >= 4) {
            const m0 = validSma5[validSma5.length - 1];
            const m3 = validSma5[validSma5.length - 4];
            ma5Slope = m3 > 0 ? +((m0 - m3) / m3 * 100).toFixed(2) : null;
        }
        // 마지막 캔들 강도
        let lastCandle = null;
        const lastIdx = closes.length - 1;
        if (lastIdx >= 0 && opens[lastIdx] != null && closes[lastIdx] != null && highs[lastIdx] != null && lows[lastIdx] != null) {
            const o = opens[lastIdx], c = closes[lastIdx], h = highs[lastIdx], l = lows[lastIdx];
            const top = Math.max(o, c);
            const range = h - l;
            const closeFromHigh = range > 0 ? (c - l) / range : 0; // 0~1, 1에 가까우면 강한 양봉 마감
            lastCandle = {
                bodyPct:       o > 0 ? +((c - o) / o * 100).toFixed(2) : null,
                upperWickPct:  o > 0 ? +((h - top) / o * 100).toFixed(2) : null,
                isBullish:     c > o,
                isStrongBullClose: c > o && closeFromHigh >= 0.7,
            };
        }

        // 최근 80개 봉 (토큰 절약 + 소수점 2자리 압축)
        const N = Math.min(80, closes.length);
        const start = closes.length - N;
        const ohlcv = [];
        for (let i = start; i < closes.length; i++) {
            ohlcv.push({
                d: dates[i],
                o: r2(opens[i]),
                h: r2(highs[i]),
                l: r2(lows[i]),
                c: r2(closes[i]),
                v: vols[i] != null ? Math.round(vols[i]) : null,
            });
        }

        const swing = _extractSwingPoints(highs, lows, 3, 5);
        const intervalActual = (typeof currentInterval !== 'undefined' ? currentInterval : '1d') || '1d';
        const breakoutContext = _extractBreakoutContext(ohlcv, dates, highs, lows, closes, intervalActual);

        return {
            symbol: currentSymbol,
            name: stockData.meta?.longName || stockData.meta?.shortName || '',
            interval: intervalActual,
            currency: stockData.meta?.currency || 'USD',
            currentPrice: r2(cur),
            mode: currentTestaMode, // 'swing' | 'day'
            ohlcv,
            indicators: {
                sma5:  r2(lastVal(sma5)),
                sma20: r2(lastVal(sma20)),
                sma70: r2(lastVal(sma70)),
            },
            series: {
                sma5:  r2arr(sma5.slice(-30)),
                sma20: r2arr(sma20.slice(-30)),
                sma70: r2arr(sma70.slice(-30)),
                close: r2arr(closes.slice(-30)),
            },
            swingHighs: swing.swingHighs,
            swingLows:  swing.swingLows,
            // 단타 전용 컨텍스트
            volRatio,
            ma5Slope,
            lastCandle,
            atr14: r2(lastVal(atr)),
            // 5분봉 돌파 단타 전용 컨텍스트 (인터벌 5m 일 때만 채워짐)
            breakoutContext,
        };
    }

    // ── AI 프로그레스바 제어 ──
    function _aiProgressShow(step, pct) {
        const el = document.getElementById('aiProgress');
        const stepEl = document.getElementById('aiProgressStep');
        const pctEl = document.getElementById('aiProgressPct');
        const fill = document.getElementById('aiProgressFill');
        const bar = document.getElementById('aiProgressBar');
        if (!el) return;
        el.classList.add('show');
        if (stepEl) stepEl.textContent = step;
        if (pct < 0) {
            bar.classList.add('indeterminate');
            if (pctEl) pctEl.textContent = '';
        } else {
            bar.classList.remove('indeterminate');
            if (fill) fill.style.width = pct + '%';
            if (pctEl) pctEl.textContent = pct + '%';
        }
    }
    function _aiProgressHide() {
        const el = document.getElementById('aiProgress');
        if (el) el.classList.remove('show');
    }

    // ── 클라이언트 스윙 추세선 계산 (OHLCV 기반 선형회귀) ──
    function calcSwingTrendlines(period = 90, swingWin = 3) {
        if (!stockData) return [];
        const q = stockData.indicators.quote[0];
        const ts = stockData.timestamp;
        const N = ts.length;
        const start = Math.max(0, N - period);
        const highs = [], lows = [];

        for (let i = start + swingWin; i < N - swingWin; i++) {
            const h = q.high[i], l = q.low[i];
            if (h == null || l == null) continue;
            let isHigh = true, isLow = true;
            for (let k = 1; k <= swingWin; k++) {
                if ((q.high[i-k] ?? -Infinity) >= h || (q.high[i+k] ?? -Infinity) >= h) isHigh = false;
                if ((q.low[i-k]  ?? Infinity)  <= l || (q.low[i+k]  ?? Infinity)  <= l) isLow  = false;
            }
            if (isHigh) highs.push({ t: ts[i], p: h, i });
            if (isLow)  lows.push({ t: ts[i], p: l, i });
        }

        const result = [];
        const fitLine = (pts, type) => {
            if (pts.length < 2) return;
            const use = pts.slice(-4);
            const n = use.length;
            const sx  = use.reduce((a, p) => a + p.i, 0);
            const sy  = use.reduce((a, p) => a + p.p, 0);
            const sxy = use.reduce((a, p) => a + p.i * p.p, 0);
            const sx2 = use.reduce((a, p) => a + p.i * p.i, 0);
            const d = n * sx2 - sx * sx;
            if (Math.abs(d) < 1e-9) return;
            const m = (n * sxy - sx * sy) / d;
            const b = (sy - m * sx) / n;
            const i1 = use[0].i, i2 = N - 1;
            result.push({
                time1: ts[i1], price1: m * i1 + b,
                time2: ts[i2], price2: m * i2 + b,
                type,
                label: type === 'downtrend' ? '하락추세' : '상승추세',
                color: type === 'downtrend' ? '#f87171' : '#60a5fa',
            });
        };
        fitLine(highs, 'downtrend');
        fitLine(lows,  'uptrend');
        return result;
    }

    // ── 차트 AI분석 — 캔버스 캡처 → Gemini 분석 → 차트에 직접 그리기 ──
    function captureChartAndAnalyze() {
        if (!lwChart || !stockData) { showToast('먼저 종목을 검색하여 차트를 로드해주세요.'); return; }
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap) return;
        const canvases = Array.from(wrap.querySelectorAll('canvas')).filter(c => c.id !== 'drawCanvas');
        if (!canvases.length) { showToast('차트 캔버스를 찾을 수 없습니다.'); return; }
        // 캔버스 렌더링 검증 — 0px 폭이면 차트 미완료 상태 (인터벌 변경 직후 흔히 발생)
        const isCanvasReady = canvases.some(c => c.offsetWidth > 50 && c.offsetHeight > 50);
        if (!isCanvasReady) {
            showToast('차트가 아직 로딩 중입니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        // 시작 시점 심볼·타임스탬프 고정 — async 중 종목 전환되어도 오염되지 않음
        const capturedSymbol = currentSymbol;
        const capturedTs = stockData.timestamp.slice();

        const first = canvases[0];
        // 항상 고정 해상도(800×450)로 캡처 → PWA/데스크탑 동일한 이미지 전달
        const TARGET_W = 800, TARGET_H = 450;

        _aiProgressShow('📸 차트 캡처 중...', 10);

        const offscreen = document.createElement('canvas');
        offscreen.width = TARGET_W; offscreen.height = TARGET_H;
        const ctx = offscreen.getContext('2d');
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        ctx.fillStyle = isLight ? '#ffffff' : '#111620';
        ctx.fillRect(0, 0, TARGET_W, TARGET_H);
        canvases.forEach(c => { try { ctx.drawImage(c, 0, 0, TARGET_W, TARGET_H); } catch(e) {} });

        // 'image/png' 명시 — 일부 브라우저에서 type 누락되는 케이스 방지
        offscreen.toBlob(async rawBlob => {
            if (!rawBlob) { showToast('캡처에 실패했습니다.'); _aiProgressHide(); return; }
            // iOS/모바일 일부 브라우저에서 blob.type 이 비거나 octet-stream 으로 잡혀
            // 서버 multer 가 거부하는 케이스 → image/png 로 강제 래핑
            const blob = rawBlob.type === 'image/png'
                ? rawBlob
                : new Blob([rawBlob], { type: 'image/png' });

            const btn = document.getElementById('chartAiReaderBtn');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ 분석 중...'; }

            // 현재 심볼 라인만 지우기 (localStorage는 분석 완료 후 덮어씀)
            lwAiPriceLines.forEach(pl => { try { lwCandleSeries?.removePriceLine(pl); } catch(e) {} });
            lwAiPriceLines = [];
            lwAiTrendSeries.forEach(s => { try { lwChart?.removeSeries(s); } catch(e) {} });
            lwAiTrendSeries = [];
            const _clearBtn = document.getElementById('chartAiClearBtn');
            if (_clearBtn) _clearBtn.style.display = 'none';

            _aiProgressShow('📤 데이터 전송 중...', 25);

            try {
                // 신규: 지표 + OHLCV 조립 (구 포맷 closes/highs/lows/dates 는 서버에서 하위호환 처리)
                const priceData = buildChartContextJson() || {};

                const fd = new FormData();
                fd.append('image', blob, 'chart.png');
                fd.append('priceData', JSON.stringify(priceData));
                fd.append('mode', currentTestaMode); // 스윙/단타 모드 전달

                _aiProgressShow('🤖 AI 분석 중... (약 10~30초)', -1);

                // SSE 스트리밍 엔드포인트 호출
                const resp = await fetch('/api/chart-draw?stream=1', { method: 'POST', body: fd });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.error || `서버 오류 (${resp.status})`);
                }

                const reader = resp.body.getReader();
                const dec = new TextDecoder();
                let buf = '', finalData = null, streamedAny = false;

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    const parts = buf.split('\n\n');
                    buf = parts.pop();
                    for (const part of parts) {
                        const line = part.trim();
                        if (!line.startsWith('data:')) continue;
                        let msg;
                        try { msg = JSON.parse(line.slice(5).trim()); }
                        catch { continue; }
                        if (msg.error) throw new Error(msg.error);
                        if (msg.done) {
                            finalData = msg.data;
                        } else if (msg.fallback) {
                            // Gemini 503 → Claude 폴백 알림
                            _aiProgressShow('🔄 Claude로 재시도 중...', -1);
                        } else if (msg.chunk) {
                            // 사용자에게는 "생성 중" 피드백만 — JSON raw 는 숨김
                            if (!streamedAny) {
                                _aiProgressShow('🤖 AI 생성 중... (스트리밍)', -1);
                                streamedAny = true;
                            }
                        }
                    }
                }
                if (!finalData) throw new Error('AI 응답이 비어있습니다.');

                _aiProgressShow('📊 결과 처리 중...', 85);

                // 분석 중 종목이 바뀌었으면 현재 종목에 적용하지 않음
                if (capturedSymbol !== currentSymbol) {
                    showToast(`${capturedSymbol} 분석 완료 (현재 종목과 다르므로 표시 생략)`);
                    _aiProgressHide();
                    return;
                }

                _aiProgressShow('🎨 차트에 그리는 중...', 95);
                drawAiChartLines(finalData, capturedTs);

                _aiProgressShow('✅ 분석 완료!', 100);
                setTimeout(_aiProgressHide, 1200);

                // 테스타 신호별 토스트
                const SIGNAL_LABEL = {
                    BUY: '🟢 매수 신호',
                    SELL_STOP: '🔴 손절 신호',
                    SELL_TAKE: '🔵 익절 신호',
                    HOLD: '⚪ 관망',
                };
                const sig = (finalData.signal || 'HOLD').toUpperCase();
                showToast(`AI 분석 완료 · ${SIGNAL_LABEL[sig] || sig}`);

            } catch(e) {
                _aiProgressHide();
                const raw = e.message || '';
                const is503 = raw.includes('503') || raw.includes('high demand') || raw.includes('Service Unavailable') || raw.includes('UNAVAILABLE');
                if (is503) {
                    showSnackbar('AI 서버가 일시적으로 혼잡합니다.\n잠시 후 다시 시도해주세요. (503)', 'warning', 5000);
                    startAiCooldown(8);
                } else {
                    showSnackbar('AI 분석 중 오류가 발생했습니다. 다시 시도해주세요.', 'error', 4000);
                }
            } finally {
                // 쿨다운 중이면 startAiCooldown 이 버튼을 관리하므로 건드리지 않음
                if (!_aiCooldownActive && btn) {
                    btn.disabled = false;
                    btn.textContent = '🔍 AI분석';
                    btn.style.cursor = '';
                    btn.style.opacity = '';
                }
                // 진행바는 성공 시 setTimeout(1200ms) 로 처리, 실패 시 catch 에서 처리
            }
        }, 'image/png');
    }

    // ── 사이드 메뉴 검색 ─────────────────────────────────────────
    function _sideNavSearchKey(e) {
        if (e.key === 'Enter') {
            const val = e.target.value.trim();
            if (!val) return;
            closeSideNav();
            document.getElementById('searchInput').value = val;
            searchStock();
        }
    }
    function _sideNavSearchInput(val) {
        // 두 검색창 동기화
        document.querySelectorAll('.side-nav-search-input').forEach(el => { if (el.value !== val) el.value = val; });
    }



    function _scrollToGroup(groupId) {
        const el = document.getElementById(groupId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ── Phase M: 모바일 차트 UI ─────────────────────────────────────

    /** M6: 모바일 헤더 가격/변동률 업데이트 */
    function _mchUpdatePrice(price, chgPct) {
        const priceEl = document.getElementById('mchPrice');
        const chgEl   = document.getElementById('mchChg');
        if (!priceEl || !chgEl) return;
        if (price == null) { priceEl.textContent = '—'; chgEl.textContent = ''; return; }
        priceEl.textContent = typeof price === 'number'
            ? (price >= 10000 ? price.toLocaleString() : price >= 1 ? price.toFixed(2) : price.toFixed(4))
            : price;
        if (chgPct != null) {
            const sign = chgPct >= 0 ? '+' : '';
            chgEl.textContent = `${sign}${chgPct.toFixed(2)}%`;
            chgEl.className = 'mch-chg ' + (chgPct > 0 ? 'up' : chgPct < 0 ? 'down' : 'flat');
        } else {
            chgEl.textContent = '';
        }
    }

    /** M6: 모바일 헤더 TF 라벨 업데이트 */
    function _mchUpdateTf(symbol, tf) {
        const el = document.getElementById('mchTfLabel');
        if (el) el.textContent = symbol ? `${symbol} · ${tf||'—'}` : (tf||'—');
    }

    /** M6: ⚙ 버튼 → 종합 설정 bottom sheet (chart-mobile.js openM6Sheet) */
    function _mchOpenGear(event) {
        event.stopPropagation();
        if (typeof openM6Sheet === 'function') { openM6Sheet(); return; }
        // 폴백: 분석 드롭다운
        _toggleAnalysisDd(event);
    }

    /** M6: 모바일 기간 프리셋 선택 */
    function _mpbSetPeriod(period) {
        // Update active button
        document.querySelectorAll('.mpb-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.period === period);
        });
        // Map to LW Charts range
        const rangeMap = {
            '1d':  { range: '1d',  interval: '5m'  },
            '1mo': { range: '1mo', interval: '1d'  },
            '3mo': { range: '3mo', interval: '1d'  },
            '1y':  { range: '1y',  interval: '1wk' },
            'max': { range: 'max', interval: '1mo' },
        };
        const cfg = rangeMap[period];
        if (!cfg) return;
        try { setChartInterval(cfg.interval); } catch(e) {}
    }

    /** M5: 더블탭 줌 in/out */
    (function() {
        let _dtLastTap = 0;
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap) return;
        wrap.addEventListener('touchend', e => {
            if (window.innerWidth > 600) return;
            const now = Date.now();
            const delta = now - _dtLastTap;
            if (delta < 300 && delta > 0) {
                // Double tap — zoom in
                e.preventDefault();
                try {
                    if (lwChart) {
                        const ts = lwChart.getVisibleLogicalRange();
                        if (ts) {
                            const mid = (ts.from + ts.to) / 2;
                            const half = (ts.to - ts.from) / 4; // zoom to 50%
                            lwChart.setVisibleLogicalRange({ from: mid - half, to: mid + half });
                        }
                    }
                } catch(er) {}
            }
            _dtLastTap = now;
        }, { passive: false });
    })();

    /** M5: 길게 누르기 → OHLC 툴팁 표시 */
    (function() {
        let _lpTimer = null;
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap) return;
        wrap.addEventListener('touchstart', e => {
            if (window.innerWidth > 600) return;
            const touch = e.touches[0];
            _lpTimer = setTimeout(() => {
                // Show OHLC tooltip at touch position
                try {
                    const tooltip = document.querySelector('.chart-ohlc-tooltip');
                    if (tooltip) {
                        tooltip.classList.add('mobile-show');
                        setTimeout(() => tooltip.classList.remove('mobile-show'), 3000);
                    }
                } catch(er) {}
                if (navigator.vibrate) navigator.vibrate(40);
            }, 600);
        }, { passive: true });
        wrap.addEventListener('touchend',   () => { clearTimeout(_lpTimer); _lpTimer = null; }, { passive: true });
        wrap.addEventListener('touchmove',  () => { clearTimeout(_lpTimer); _lpTimer = null; }, { passive: true });
        wrap.addEventListener('touchcancel',() => { clearTimeout(_lpTimer); _lpTimer = null; }, { passive: true });
    })();

    /** M2: 시그널 바텀시트 열기/닫기 */
    function _mSigOpen(time, markers) {
        const sheet = document.getElementById('mSigSheet');
        const list  = document.getElementById('mSigList');
        const title = document.getElementById('mSigTitle');
        if (!sheet || !list) return;
        // Filter markers near the tapped time (within 2 candles)
        const near = (markers || []).filter(m => Math.abs((m.time||0) - time) < 200000);
        if (!near.length) return; // No signals near tap — don't open
        if (title) title.textContent = `시그널 (${near.length}개)`;
        list.innerHTML = near.length ? near.map(m => {
            const isBuy = m.position === 'belowBar';
            const color = m.color || (isBuy ? '#22c55e' : '#ef4444');
            const label = m._label || (isBuy ? '매수 시그널' : '매도 시그널');
            const timeStr = m.time ? new Date(m.time * 1000).toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
            return `<div class="msig-item">
                <div class="msig-dot" style="background:${color};"></div>
                <div class="msig-info">
                    <div class="msig-label">${label}</div>
                    <div class="msig-time">${timeStr}</div>
                </div>
            </div>`;
        }).join('') : '<div class="msig-empty">근처에 시그널이 없습니다</div>';
        sheet.classList.add('show');
    }
    function _mSigClose() {
        const sheet = document.getElementById('mSigSheet');
        if (sheet) sheet.classList.remove('show');
    }

    // ═══════════════════════════════════════════════════════════
    // 종목 페이저 (하단 고정 바) — 키움증권 스타일
    // ═══════════════════════════════════════════════════════════

    let _stockPagerList  = [];   // [{ symbol, name, market }]
    let _stockPagerIndex = -1;

    /** 페이저 초기화 — 워치리스트 또는 외부 리스트 */
    function initStockPager(sym, externalList) {
        let list = externalList;
        if (!list || !list.length) {
            try {
                list = getFavorites()
                    .map(f => ({ symbol: f.symbol || '', name: f.name || '', market: f.market || '' }))
                    .filter(x => x.symbol);
            } catch(e) { list = []; }
        }
        if (!list || list.length < 2) { hideStockPager(); return; }
        _stockPagerList  = list;
        _stockPagerIndex = list.findIndex(x => (x.symbol||'').toUpperCase() === (sym||'').toUpperCase());
        if (_stockPagerIndex === -1) {
            _stockPagerList  = [{ symbol: sym, name: '', market: currentMarket || '' }, ...list];
            _stockPagerIndex = 0;
        }
        _showStockPager();
    }

    function _showStockPager() {
        const bar = document.getElementById('stockPagerBar');
        if (!bar) return;
        // ✅ flex로 명시 (display:none 인라인 덮어쓰기 방지)
        bar.style.display = 'flex';
        bar.style.visibility = 'visible';
        bar.style.zIndex = '950';
        bar.classList.remove('hidden');
        document.body.classList.add('stock-pager-active');
        // `:has()` 미지원 브라우저 폴백 — 바텀 네비 직접 숨김
        const bn = document.getElementById('bottomNav');
        if (bn) bn.style.display = 'none';
        const cur = _stockPagerList[_stockPagerIndex] || {};
        bar.querySelector('.spb-symbol').textContent    = cur.symbol || '';
        const nameEl = bar.querySelector('.spb-name');
        if (nameEl) { nameEl.textContent = cur.name || ''; nameEl.style.display = cur.name ? '' : 'none'; }
        bar.querySelector('.spb-page-info').textContent = `${_stockPagerIndex + 1} / ${_stockPagerList.length}`;
        const prev = bar.querySelector('.spb-prev');
        const next = bar.querySelector('.spb-next');
        if (prev) prev.disabled = _stockPagerIndex <= 0;
        if (next) next.disabled = _stockPagerIndex >= _stockPagerList.length - 1;
        // 인라인 바 동기화 (모바일 전용)
        _syncChartPagerInline(cur);
    }

    /** 인라인 종목 전환 바(모바일) 업데이트 */
    function _syncChartPagerInline(cur) {
        const el = document.getElementById('chartPagerInline');
        if (!el) return;
        if (!_stockPagerList.length) { el.style.display = 'none'; return; }
        el.style.display = 'flex';
        const c = cur || _stockPagerList[_stockPagerIndex] || {};
        const tickerEl = el.querySelector('.cpi-ticker');
        const pageEl   = el.querySelector('.cpi-page');
        const nameEl   = el.querySelector('.cpi-name');
        if (tickerEl) tickerEl.textContent = c.symbol || '';
        if (pageEl)   pageEl.textContent   = `${_stockPagerIndex + 1} / ${_stockPagerList.length}`;
        if (nameEl)   { nameEl.textContent = c.name || ''; nameEl.style.display = c.name ? '' : 'none'; }
        const prevBtn = el.querySelector('.cpi-prev');
        const nextBtn = el.querySelector('.cpi-next');
        if (prevBtn) prevBtn.disabled = _stockPagerIndex <= 0;
        if (nextBtn) nextBtn.disabled = _stockPagerIndex >= _stockPagerList.length - 1;
    }

    function hideStockPager() {
        const bar = document.getElementById('stockPagerBar');
        if (bar) { bar.classList.add('hidden'); setTimeout(() => { bar.style.display = 'none'; }, 260); }
        document.body.classList.remove('stock-pager-active');
        // 바텀 네비 복원 (홈 진입 시 다시 보이도록)
        const bn = document.getElementById('bottomNav');
        if (bn) bn.style.display = '';
        // 인라인 바 숨김
        const inl = document.getElementById('chartPagerInline');
        if (inl) inl.style.display = 'none';
        _stockPagerList  = [];
        _stockPagerIndex = -1;
    }

    /** 이전/다음 종목 이동 (delta: -1 | +1 | any) */
    function navigateStock(delta) {
        if (!_stockPagerList.length) return;
        const newIdx = _stockPagerIndex + delta;
        if (newIdx < 0 || newIdx >= _stockPagerList.length) {
            if (navigator.vibrate) navigator.vibrate(20);
            return;
        }
        const item = _stockPagerList[newIdx];
        _stockPagerIndex = newIdx;
        _showStockPager();
        // 종목 로드
        try { closeSideNav(); } catch(e) {}
        const _fav = document.getElementById('favScreen'); if (_fav) _fav.style.display = 'none';
        if (item.market) setMarket(item.market);
        const inp = document.getElementById('searchInput'); if (inp) inp.value = item.symbol;
        window._stockPagerNavigating = true;
        searchStock().finally(() => { window._stockPagerNavigating = false; });
        if (navigator.vibrate) navigator.vibrate(10);
    }

    /** 종목 리스트 바텀시트 */
    function openStockPagerList() {
        const sheet = document.getElementById('stockPagerSheet');
        const list  = document.getElementById('stockPagerSheetList');
        if (!sheet || !list) return;
        list.innerHTML = _stockPagerList.map((item, idx) => `
            <div class="sps-item${idx === _stockPagerIndex ? ' active' : ''}" onclick="jumpToStock(${idx})">
                <span class="sps-item-idx">${idx + 1}</span>
                <span class="sps-item-symbol">${item.symbol || ''}</span>
                <span class="sps-item-name">${(item.name || '').replace(/</g,'&lt;')}</span>
            </div>`).join('');
        sheet.style.display = '';
        requestAnimationFrame(() => sheet.classList.add('show'));
        setTimeout(() => {
            const active = list.querySelector('.sps-item.active');
            if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 100);
    }

    function closeStockPagerList() {
        const sheet = document.getElementById('stockPagerSheet');
        if (!sheet) return;
        sheet.classList.remove('show');
        setTimeout(() => { sheet.style.display = 'none'; }, 260);
    }

    function jumpToStock(idx) {
        if (idx < 0 || idx >= _stockPagerList.length) return;
        closeStockPagerList();
        const delta = idx - _stockPagerIndex;
        if (delta !== 0) navigateStock(delta);
    }

    // ── 키보드 이벤트 (← →, ESC) ──
    document.addEventListener('keydown', e => {
        const sheet = document.getElementById('stockPagerSheet');
        if (sheet?.classList.contains('show')) {
            if (e.key === 'Escape') { e.preventDefault(); closeStockPagerList(); return; }
        }
        const heroVisible = document.getElementById('stockHero')?.classList.contains('show');
        if (!heroVisible || !_stockPagerList.length) return;
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
        if (e.key === 'ArrowLeft'  || e.key === 'PageUp')   { e.preventDefault(); navigateStock(-1); }
        else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); navigateStock(1); }
    });

    // ── 바텀 네비 밖 클릭으로 닫기 (센터 모달 전용) ──
    // 스와이프 다운 닫기 제거 — 센터 팝업은 백드롭 탭으로만 닫힘

    // ── 본문 좌우 스와이프 (페이저 이동) ──
    (function() {
        let sx = 0, sy = 0, ex = 0, ey = 0, ing = false;
        const THRESH = 60, VLIM = 60;
        document.body.addEventListener('touchstart', e => {
            const heroVisible = document.getElementById('stockHero')?.classList.contains('show');
            if (!heroVisible || !_stockPagerList.length) return;
            if (e.target.closest('.tv-lightweight-charts,.lwchart-wrap,.scroll-x,table,.alpha-card-list,.top100-row,input,textarea,button,.stock-pager-sheet,.chart-dd,.side-nav')) return;
            sx = e.touches[0].clientX; sy = e.touches[0].clientY; ing = true;
        }, { passive: true });
        document.body.addEventListener('touchmove', e => {
            if (!ing) return;
            ex = e.touches[0].clientX; ey = e.touches[0].clientY;
        }, { passive: true });
        document.body.addEventListener('touchend', () => {
            if (!ing) return; ing = false;
            const dx = ex - sx, dy = ey - sy;
            if (Math.abs(dy) > VLIM || Math.abs(dx) < THRESH) return;
            navigateStock(dx > 0 ? -1 : 1);
        }, { passive: true });
    })();




    Object.assign(window, {
        _loadStockEarningsBadge, _calcDaysUntil,
        goLeverage, loadLeverageETFs, renderLeverageGrid, _levSetFilter, _levSetSearch, _levClearSearch, _renderLevCard, _levFormatVol,
        loadEarnHome, _renderEarnHome, _renderEarnHomeCard, _renderEarnHomeSkeleton,
        loadLeverageHome, renderLeverageHome, _renderLevStripCard, _fetchLevQuotesBatched, _levTracksLabel,
        goEarnings, loadEarnings, setEarningsWindow, _earnToggleGroup, _enrichEarningsWithAI,
        _earnSetFilter, _earnApplyFilters, _earnSortBy, _earnBuildDateChips, _earnSelectDateChip,
        _earnWeekNav, _earnToggleDay,
        goMyPosition, renderMyPosition, _posOpenSheet, _posCloseSheet, _posSheetSet, _posSave,
        _posOnEntryPriceInput, _posAddWatching,
        _posSetStatus, _posChangeSplitCount, _posCalcSplitPlan, _posUpdateSplitRowShares,
        _fmtAmountInput, _getAmountVal,
        _posSetEntryToCurrent, _posSetEntryOffset, _posSetStopPct, _posSetStopToEma, _posTpPct,
        _posStopTab, _posOnStopPrice, _posOnStopPct, _posStopQuickPct, _posStopSetPct,
        _posDelete, _posQuickClose, _posSetFilter, _posExport, _posImportPick, _posImportFile,
        closeSideNav, toggleSideNav, openSideNav, goHome, goBack, goSmartMoney,
        switchSmTab, smDeepDive, smDeepBack, filterSmHoldings, smChartLink,
        renderGuruReal, guruDeepDiveReal, guruDeepBack, renderGuruHolders, goSmartMoneyAndOpen,
        _ghAvatarFallback, _ghInitialAvatar, _ghShowInfo, _ghOpenSheet,
        loadGuruHome, goSmartMoneyAndOpenReal, guruRefresh, _guruImgErr, _searchGuruByTicker,
        _applyGuruFilter, _guruFilterPos, _guruRefreshLatest,
        setMarket, searchStock, setChartInterval, setPeriod, _toggleIntervalDropdown,
        quickSearch, selectStock, toggleFavorite, switchTab, toggleChartFullscreen, _restoreFullscreenState,
        _ctrOpenAnalysis, _ctrOpenLine, _ctrCapturePng, _ctrSettings,
        _cnbZoom, _cnbPan, _cnbReset, _cnbSetPreset, _cnbUpdatePresetUi, _cnbDeactivatePreset,
        _chartJumpToLatest, _updateJumpBtnVisibility, _initJumpBtnObserver,
        _initOhlcTooltip, _onCrosshairMoveOhlc,
        _initShiftDragZoom, _initChartKeyboardShortcuts,
        _cxtOpenIndicators, _cxtDraw, _cxtDrawClose, _cxtRuler, _cxtCompare, _cxtSplit,
        _indGetConfig, _indSaveConfig, _indSelect, _indToggleEnabled,
        _indSetWidth, _indSetSource, _indSetPeriod, _indSetPeriodBb,
        _indAddPeriod, _indRemovePeriod, _indOpenColorPicker, _indPickColor,
        _indRebuildSeries, _indRefreshPanel,
        _renderChartHeaderAt, _onCrosshairMoveHeader,
        _xcOpenLayoutPopover, _xcSetLayout, _xcCloseCell, _xcRestoreLayout, _xcUpdateLayoutUi,
        _xcToggleLegend,
        _xcActivate, _xcPromptSymbol, _xcCreateCell, _xcDestroyCell, _xcUpdateCellHeaders,
        _xcCloseSymbolModal, _xcSymbolSearch, _xcSymbolKeydown,
        _xcToggleSync, _xcOpenSyncPopover, _xcUpdateSyncUi,
        favSearch, removeFavorite, setTop100Filter, goTop100, goCatalyst, loadCatalyst, _catalystSetFilter, switchCatalystTab, loadVolumeSurge, loadMinervini,
        _runCatalystAi, _renderCatalystAiExpanded,
        _runScannerAi, _renderScannerAiResult, _alphaAutoBatchAi, _renderAlphaAiMini,
        _alphaRenderSocialScanner, _runSocialAi, _renderSocialAiResult,
setDrawTool, setDrawColor, setDrawWidth, undoDraw, clearAllDrawings, toggleDrawToolbar, toggleDrawMagnet, addAutoTrendAngle, toggleChartLabels, toggleChartSound,
        toggleTheme, showLoading, hideLoading, showToast, showSnackbar,
        openChangelog, closeChangelog,
        loadOptionsDate, renderOptionsTab, setOptionsFilter,
        setOptionsStrikeRange, toggleOptionsVolFilter, sortOptionsBy,
        manualAnalysisRefresh, pwaInstall,
        toggleChartSigLines, toggleKullamagiLayer, toggleSplitBuyLayer, toggleSplitGroup, _toggleSplitGroup, getSplitBuyCoeff, togglePullbackLayer, toggleTpLevel, toggleSrLayer, toggleSrMode, toggleSigHistoryPanel, _renderSigHistoryPanel, _updateSigHistoryBadge,
        toggleSmartDipLayer, toggleSmartDipGroup, toggleSepaLayer, getSmartDipMode, _scrollToGroup,
        _smartDipV3Filter, _trackSmartDipResult, _loadSpxData,
        _calcSignalGrade, _setMinGrade, _passesGradeFilter,
        _runBacktest, _openBacktest,
        startAlpacaWS, stopAlpacaWS,
        _toggleAnalysisDd, _toggleLineDd, _closeAllDds, _updateDdStates, _setDdCheck,
        _openChartBottomSheet, _closeChartBottomSheet, _confirmChartBottomSheet,
        _cancelChartBottomSheet, _bsRenderBody,
        handleSearchKeydown, openSearchDropdown, closeSearchDropdown, searchSuggest, levenshtein,
        renderDayUnified, renderDanteAnalysis, runDanteBacktest,
        renderRRAnalysis, renderMinerviniSEPA, _renderSEPACard, renderSwingAnalysis, _runSwingAi, renderRSIMomentum, analyzeRSIDynamic,
        renderMACDSignal, analyzeMACDRayner, _applyRRGate, _isFallingKnife,
        toggleChecklist,
        detectBullishDivergence, _detectOBVPanic,
        renderSplitCalc,
        openCalcFab, closeCalcFab, _calcSplitFab, _fabCommaFmt,
        loadMarketWeather, renderMarketWeather, drawSparkline,
        loadPremarketScanner, renderPremarketScanner,
        loadSwingRadar, renderSwingRadar, _renderSwingInRadar, _renderSniperSwingItem,
        _renderStreakInRadar, _renderSniperStreakItem,
        _renderBouncePage, _renderBounceCard, _calcBounceScore, _isBigTech, _onBounceToggle,
        _renderMultiFactorCard,
        loadMarketThermometer,
        showMoreTop100,
        saveRecentStock, loadRecentStocks,
        loadVolAlert,
        loadNewsTab, reloadNewsTab, renderNewsList, _newsTimeAgo,
        openTabOrderModal, closeTabOrderModal, saveTabOrder, resetTabOrder,
        loadSocialTab, loadStockTwits, loadApewisdomCard, loadPaxnetBoard, setSocialSource, reloadSocialTab, loadSocialHot, toggleStTranslate,
        loadShortTab, reloadShortTab, renderShortTab, _buildGaugeSVG,
        loadYouTubeTab, reloadYouTubeTab, renderYouTubeCards, _ytLogClick,
        renderAnalystTargets,
        initStockPager, hideStockPager, navigateStock, openStockPagerList, closeStockPagerList, jumpToStock,
        _mchUpdatePrice, _mchUpdateTf, _mpbSetPeriod, _mSigOpen, _mSigClose, _mchOpenGear,
        _cmpOpenSheet, _cmpCloseSheet, _cmpModalBgClick, _cmpSubmit, _cmpLoad, _cmpRemove,
        _cmpUpdateLegend, _cmpRefreshIfActive, _cmpRenderRecent, _cmpRemoveRecent, _cmpSelectPeer, _cmpModalSearch,
        goScanner, goFav, goSearch, closeSearch, bnGo, updateBnActive,
        goVisionScanner, vsReset, vsClickUpload, vsHandleFileInput,
        vsDragEnter, vsDragOver, vsDragLeave, vsDrop,
        vsMouseMove, vsMouseLeave, vsRedrawCanvas,
        toggleScannerChip, setScannerPreset, syncScannerChipUI,
        debounceScannerFetch, runScannerFetch, filterScannerResults, renderScannerResults,
        _alphaSwitchTab, _alphaRender, _alphaRenderCard, _alphaToggleCard, _alphaTheme, _alphaRisk, _alphaTimingGuide,
        _alphaHomeSwitch, loadAlphaHomePreview, goAlphaFromHome, _setSurgeFilter, _bounceSetFilter, _alphaSetVerdictFilter,
        captureChartAndAnalyze, clearAiChartLines, drawAiChartLines, toggleAiReport, setTradeMode,
        renderAnalysisReport, buildChartContextJson,
        deleteSelectedAiTrendline,
        goEconomic, switchEcoTab, switchEcoChartMode, generateEconomicAI,
        subscribePush, unsubscribePush, getPushState,
        openPriceAlertModal, _setPaDir, _savePriceAlert, _deletePriceAlert,
        _togglePushBell, _openCurrentPriceAlert, _showNotifSettingsModal, _saveNotifPref, _confirmUnsubPush,
        _sideNavSearchKey, _sideNavSearchInput,
        _renderRecentSearchStrip, _clickRecentChip, _deleteRecentSearch, _clearAllRecentSearches,
        loadOptionsPopular, _optPopSwitch, _renderOptionsPopular,
        _buildSniperReason,
    });

    // ── 사이드 내비 아이콘: 모든 아이콘 -fill 고정 (active 여부 무관) ──

    // ── 바텀 내비게이션 초기화 ──
    (function initBottomNav() {
        const MAX_BN_TABS = 5;
        // 비활성·활성 모두 fill 아이콘으로 통일 (active 강조는 색상으로만)
        const BN_TABS = [
            { key: 'home',       id: 'bnHome',       label: '홈',       iconLine: 'ri-home-5-fill',      iconFill: 'ri-home-5-fill' },
            { key: 'leverage',   id: 'bnLeverage',   label: '레버리지', iconLine: 'ri-flashlight-fill',   iconFill: 'ri-flashlight-fill' },
            { key: 'scanner',    id: 'bnScanner',    label: '스캐너',   iconLine: 'ri-radar-fill',       iconFill: 'ri-radar-fill' },
            { key: 'top100',     id: 'bnTop100',     label: 'TOP 100',  iconLine: 'ri-bar-chart-box-fill', iconFill: 'ri-bar-chart-box-fill' },
            { key: 'all',        id: 'bnAll',        label: '전체',   iconLine: 'ri-menu-line',        iconFill: 'ri-menu-line' },
        ];

        // 필 래퍼 생성 (플로팅 필 디자인)
        const nav = document.getElementById('bottomNav');
        const pill = document.createElement('div');
        pill.className = 'bn-pill';
        BN_TABS.slice(0, MAX_BN_TABS).forEach((tab, idx) => {
            const btn = document.createElement('button');
            btn.className = 'bn-item' + (idx === 0 ? ' active' : '');
            btn.id = tab.id;
            btn.setAttribute('onclick', `bnGo('${tab.key}')`);
            btn.innerHTML = `<div class="bn-inner"><i class="bn-icon ${idx === 0 ? tab.iconFill : tab.iconLine}" data-line="${tab.iconLine}" data-fill="${tab.iconFill}"></i><span class="bn-label">${tab.label}</span></div>`;
            pill.appendChild(btn);
        });
        nav.appendChild(pill);
    })();
