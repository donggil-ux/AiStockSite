// js/alpha-home.js
// 책임: 알파홈 bounce 추천, 홈 화면, 검색, 스캐너
// 의존: state.js, utils.js, api.js

    // ========================================
    // Side Navigation
    // ========================================
    function toggleSideNav() {
        const nav = document.getElementById('sideNav');
        nav.classList.toggle('open');
        // 열릴 때 body 스크롤 잠금
        document.body.style.overflow = nav.classList.contains('open') ? 'hidden' : '';
    }
    function openSideNav() {
        document.getElementById('sideNav').classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeSideNav() {
        document.getElementById('sideNav').classList.remove('open');
        document.body.style.overflow = '';
    }
    // 모바일에서는 기본으로 nav 닫혀있음 (사용자가 햄버거 클릭 시에만 열림)
    function collapseNavDesktop() {
        const collapsed = document.body.classList.toggle('nav-collapsed');
        try { localStorage.setItem('navCollapsed', collapsed ? '1' : '0'); } catch(e){}
        // 접기 버튼 아이콘 업데이트
        const btn = document.querySelector('.side-nav-collapse-btn i');
        if (btn) btn.className = collapsed ? 'ri-sidebar-unfold-line' : 'ri-sidebar-fold-line';
    }
    // 페이지 로드 시 항상 열린 상태로 시작 (이전 접힘 상태 무시)
    try { localStorage.removeItem('navCollapsed'); } catch(e){}
    document.body.classList.remove('nav-collapsed');
    // [Fix-B] window 노출 — HTML onclick="closeSideNav()" 처리용 (addEventListener 이중 바인딩 제거)
    window.closeSideNav = closeSideNav;
    window.toggleSideNav = toggleSideNav;
    window.openSideNav = openSideNav;
    window.collapseNavDesktop = collapseNavDesktop;
    // 사이드바는 항상 닫힌 상태로 시작 (수동으로 햄버거 버튼 클릭 시 열림)

    // ========================================
    // Favorites (즐겨찾기) - localStorage
    // ========================================
    const FAV_KEY = 'stockai_favorites';

    function getFavorites() {
        try {
            return JSON.parse(localStorage.getItem(FAV_KEY)) || [];
        } catch(e) { return []; }
    }

    function saveFavorites(favs) {
        localStorage.setItem(FAV_KEY, JSON.stringify(favs));
        // 백엔드 시그널 분석용 — 즐겨찾기 변경 시 Workers 로 동기화 (디바운스)
        try {
            if (window._syncFavsTimer) clearTimeout(window._syncFavsTimer);
            window._syncFavsTimer = setTimeout(() => _syncFavsToBackend(favs), 1500);
        } catch(_) {}
    }

    // 백엔드(Cloudflare Workers) 로 즐겨찾기 동기화 — 5분봉 자동 시그널 분석 대상
    async function _syncFavsToBackend(favs) {
        try {
            const subToken = localStorage.getItem('pushSubToken');
            const endpoint = window._pushEndpoint || await (async () => {
                if (!('serviceWorker' in navigator)) return null;
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                return sub?.endpoint || null;
            })();
            if (!subToken || !endpoint) return; // 푸시 미구독 → 동기화 불필요
            const symbols = (favs || []).map(f => f.symbol).filter(Boolean);
            await fetch('/api/push/favs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subToken, endpoint, favs: symbols }),
            });
        } catch(_) {}
    }

    function isFavorited(symbol, market) {
        return getFavorites().some(f => f.symbol === symbol && f.market === market);
    }

    function toggleFavorite() {
        if (!currentSymbol || !stockData) return;
        const market = currentMarket;
        const symbol = currentSymbol;
        const meta = stockData.meta;

        let name = meta.symbol;
        if (market === 'KR') {
            name = KR_STOCK_NAMES[symbol] || meta.symbol.replace('.KS','').replace('.KQ','');
        } else {
            // Try to find Korean name for US stock
            const usEntry = Object.entries(US_STOCK_NAMES).find(([k,v]) => v === symbol);
            name = usEntry ? usEntry[0] + ' (' + symbol + ')' : symbol;
        }

        let favs = getFavorites();
        const idx = favs.findIndex(f => f.symbol === symbol && f.market === market);
        if (idx >= 0) {
            favs.splice(idx, 1);
        } else {
            favs.unshift({ symbol, market, name, addedAt: Date.now() });
        }
        saveFavorites(favs);
        updateFavButton();
        renderFavList();
    }

    function removeFavorite(symbol, market) {
        let favs = getFavorites();
        favs = favs.filter(f => !(f.symbol === symbol && f.market === market));
        saveFavorites(favs);
        updateFavButton();
        renderFavList();
    }

    function updateFavButton() {
        const btn = document.getElementById('favStarBtn');
        const txt = document.getElementById('favStarText');
        if (!btn || !currentSymbol) return;
        const faved = isFavorited(currentSymbol, currentMarket);
        btn.classList.toggle('favorited', faved);
        btn.querySelector('.star').innerHTML = faved ? '&#9733;' : '&#9734;';
        if (txt) txt.textContent = faved ? '즐겨찾기 해제' : '즐겨찾기';
        // 가격 알림 버튼 표시 여부 업데이트
        if (typeof _updatePriceAlertBtn === 'function') _updatePriceAlertBtn();
    }

    function renderFavList() {
        const container = document.getElementById('favList');
        const screenContainer = document.getElementById('favScreenList');
        if (!container && !screenContainer) return;
        const favs = getFavorites();
        const emptyHTML = '<div class="fav-empty">즐겨찾기한 종목이 없습니다.<br>종목 분석 후 &#9734; 버튼으로 추가하세요.</div>';
        const itemsHTML = favs.length === 0 ? emptyHTML : favs.map(f => {
            const sym = (f.symbol||'').replace(/'/g,'&#39;');
            const mkt = (f.market||'').replace(/'/g,'&#39;');
            const name = (f.name||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return `<div class="fav-item" data-sym="${sym}" data-mkt="${mkt}">
                <span class="fav-item-market ${(f.market||'').toLowerCase()}">${f.market==='KR'?'🇰🇷':'🇺🇸'}</span>
                <div class="fav-item-info">
                    <div class="fav-item-name">${name}</div>
                    <div class="fav-item-code">${sym}</div>
                </div>
                <button class="fav-item-remove" title="삭제">&times;</button>
            </div>`;
        }).join('');

        [container, screenContainer].filter(Boolean).forEach(c => {
            c.innerHTML = itemsHTML;
            c.querySelectorAll('.fav-item').forEach(el => {
                const sym = el.dataset.sym, mkt = el.dataset.mkt;
                el.addEventListener('click', () => favSearch(sym, mkt));
                el.querySelector('.fav-item-remove')?.addEventListener('click', e => {
                    e.stopPropagation();
                    removeFavorite(sym, mkt);
                });
            });
        });
    }

    function favSearch(symbol, market) {
        // 전체 즐겨찾기 목록을 페이저에 전달
        try {
            window._pendingPagerList = getFavorites()
                .map(f => ({ symbol: f.symbol || '', name: f.name || '', market: f.market || '' }))
                .filter(x => x.symbol);
        } catch(e) { window._pendingPagerList = null; }
        closeSideNav();
        document.getElementById('favScreen').style.display = 'none';
        setMarket(market);
        document.getElementById('searchInput').value = symbol;
        searchStock();
    }

    // 초기 즐겨찾기 렌더
    renderFavList();

    // ========================================

    // Search Autocomplete Dropdown
    // ========================================
    let _searchTrending = null, _searchTrendingLoading = false, _dropdownHighlightIdx = -1;

    function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); }; }

    function _sdropItems() { return document.querySelectorAll('#searchDropdown .sdrop-item'); }

    function _sdropFmtPrice(p, market) {
        if (p == null) return '';
        return market === 'KR' ? Math.round(p).toLocaleString()+'원' : '$'+p.toFixed(2);
    }
    function _sdropFmtChg(pct) {
        if (pct == null) return {text:'', cls:'flat'};
        return { text:(pct>=0?'+':'')+pct.toFixed(2)+'%', cls:pct>0?'up':pct<0?'down':'flat' };
    }

    function _sdropItemHTML(item, idx) {
        const flag = item.market === 'KR' ? '🇰🇷' : '🇺🇸';
        const badgeCls = item.type === 'etf' ? 'etf' : 'stock';
        const badgeTxt = item.type === 'etf' ? 'ETF' : '주식';
        const mktCls = item.market === 'KR' ? 'kr' : 'us';
        const nameDisplay = (item.koreanName && item.koreanName !== item.ticker) ? item.koreanName : (item.name||item.ticker);
        const chg = _sdropFmtChg(item._changePct);
        const priceHTML = item._price != null
            ? `<span class="sdrop-price">${_sdropFmtPrice(item._price, item.market)}</span>
               <span class="sdrop-change ${chg.cls}">${chg.text}</span>` : '';
        return `<div class="sdrop-item" role="option" data-ticker="${escHtml(item.ticker||'')}" data-market="${escHtml(item.market||'')}" data-idx="${idx}">
            <span class="sdrop-flag">${flag}</span>
            <div class="sdrop-info">
                <div class="sdrop-name">${escHtml(nameDisplay||'')}</div>
                <div class="sdrop-ticker">${escHtml(item.ticker||'')}${item.sector?' · '+escHtml(item.sector):''}</div>
            </div>
            <span class="sdrop-badge ${mktCls}">${item.market==='KR'?'🇰🇷':escHtml(item.market||'')}</span>
            <span class="sdrop-badge ${badgeCls}">${badgeTxt}</span>
            ${priceHTML}
        </div>`;
    }

    function _sdropSkeletonHTML(n=5) {
        let h='';
        for(let i=0;i<n;i++) h+=`<div class="sdrop-skel">
            <div class="sdrop-skel-circle"></div>
            <div class="sdrop-info">
                <div class="sdrop-skel-line" style="width:${80+i*8}px;margin-bottom:5px;"></div>
                <div class="sdrop-skel-line" style="width:50px;height:10px;"></div>
            </div></div>`;
        return h;
    }

    function _attachDropdownClicks(el) {
        el.querySelectorAll('.sdrop-item').forEach(row => {
            row.addEventListener('mousedown', e => e.preventDefault());
            row.addEventListener('click', () => {
                const ticker = row.dataset.ticker, market = row.dataset.market;
                closeSearchDropdown();
                setMarket(market);
                document.getElementById('searchInput').value = ticker;
                searchStock();
            });
        });
    }

    function renderDropdown(mode, data) {
        const el = document.getElementById('searchDropdown');
        if (!el) return;
        _dropdownHighlightIdx = -1;
        if (mode === 'hidden') { el.classList.remove('open'); return; }
        let html = '';
        if (mode === 'empty') {
            const favs = getFavorites();
            if (favs.length) {
                html += `<div class="sdrop-section-title">즐겨찾기</div>`;
                html += favs.slice(0,5).map((f,i) => {
                    const meta = ASSET_META[f.symbol]||{};
                    return _sdropItemHTML({ticker:f.symbol,name:f.name,koreanName:f.name,
                        market:f.market,type:meta.type||'stock',sector:meta.sector||'',score:0}, i);
                }).join('');
            }
            html += `<div class="sdrop-section-title">인기 종목</div>`;
            if (_searchTrending === null) {
                html += _sdropSkeletonHTML(5);
                el.innerHTML = html; el.classList.add('open');
                if (!_searchTrendingLoading) {
                    _searchTrendingLoading = true;
                    _fetchSearchTrending().then(() => {
                        const inp = document.getElementById('searchInput');
                        if (inp?.value.trim()==='' && el.classList.contains('open')) renderDropdown('empty',null);
                    });
                }
                return;
            } else if (!_searchTrending.length) {
                html += `<div style="padding:10px 14px;color:var(--text3);font-size:12px;">데이터를 불러올 수 없습니다.</div>`;
            } else {
                const offset = getFavorites().slice(0,5).length;
                html += _searchTrending.slice(0,5).map((item,i) => _sdropItemHTML(item, offset+i)).join('');
            }
        } else if (mode === 'results') {
            if (!data?.length) {
                html = `<div style="padding:24px 16px;text-align:center;">
                    <div style="font-size:22px;margin-bottom:8px;">🔍</div>
                    <div style="font-size:13px;font-weight:700;color:var(--text1);margin-bottom:5px;">검색 결과가 없습니다.</div>
                    <div style="font-size:12px;color:var(--text3);line-height:1.6;">티커 심볼로 검색해 주세요<br><span style="color:var(--blue);font-weight:600;">예: AAPL, TSLA, 005930</span></div>
                </div>`;
            } else {
                html += `<div class="sdrop-section-title">검색 결과</div>`;
                html += data.map((item,i) => _sdropItemHTML(item,i)).join('');
            }
        }
        el.innerHTML = html; el.classList.add('open');
        _attachDropdownClicks(el);
    }

    async function _fetchSearchTrending() {
        try {
            if (top100Cache?.['day_gainers']?.items?.length &&
                Date.now() - top100Cache['day_gainers'].ts < TOP100_CACHE_MS) {
                _buildTrendingItems(top100Cache['day_gainers'].items); return;
            }
            const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=day_gainers&count=10`;
            const data = await fetchWithProxy(url);
            const quotes = data?.finance?.result?.[0]?.quotes;
            if (quotes?.length) { _buildTrendingItems(quotes); return; }
        } catch(e) {}
        _searchTrending = []; _searchTrendingLoading = false;
    }

    function _buildTrendingItems(items) {
        _searchTrending = items.slice(0,5).map(q => {
            const meta = ASSET_META[q.symbol]||{};
            const kor = Object.entries(US_STOCK_NAMES).find(([,v])=>v===q.symbol);
            return { ticker:q.symbol, name:q.shortName||q.symbol,
                koreanName:kor?kor[0]:(q.shortName||q.symbol),
                market:'US', type:meta.type||(q.quoteType==='ETF'?'etf':'stock'),
                sector:meta.sector||q.sector||'',
                _price:q.regularMarketPrice, _changePct:q.regularMarketChangePercent };
        });
        _searchTrendingLoading = false;
    }

    function openSearchDropdown() {
        const inp = document.getElementById('searchInput');
        if (inp?.value.trim()==='') renderDropdown('empty', null);
    }
    function closeSearchDropdown() { renderDropdown('hidden', null); }

    // ── 모바일 검색 모달 ──
    let _searchFallbackToken = 0;
    const _debMobSearch = debounce(async q => {
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

    function _renderMobDropdown(mode, data) {
        const el = document.getElementById('mobSearchResults');
        if (!el) return;
        let html = '';
        if (mode === 'empty') {
            // 최근 검색 칩
            let recent = [];
            try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch(e) {}
            if (recent.length) {
                html += '<div class="mob-toss-section"><div class="mob-toss-section-hdr"><span class="mob-toss-section-title">최근 검색</span><button class="mob-toss-section-clear" onclick="_clearAllRecentSearches()">전체 삭제</button></div><div class="mob-toss-chips">';
                html += recent.map(r => {
                    const sym = String(r.symbol || '').replace(/[<>"']/g, '');
                    const mkt = r.market || 'US';
                    return `<div class="mob-toss-chip" onclick="_clickRecentChip(event,'${sym}','${mkt}')">${sym}<button class="mrc-del" onclick="event.stopPropagation();_deleteRecentSearch('${sym}','${mkt}')" aria-label="삭제">×</button></div>`;
                }).join('');
                html += '</div></div>';
            }
            // 인기 검색 (순위 리스트)
            html += '<div class="mob-toss-section"><div class="mob-toss-section-hdr"><span class="mob-toss-section-title">인기 검색</span></div>';
            if (_searchTrending === null) {
                html += '<div class="mob-toss-trending-list">' + _sdropSkeletonHTML(5) + '</div></div>';
                el.innerHTML = html;
                if (!_searchTrendingLoading) {
                    _searchTrendingLoading = true;
                    _fetchSearchTrending().then(() => {
                        const inp = document.getElementById('mobSearchInput');
                        if (document.getElementById('mobSearchModal')?.style.display !== 'none' && inp?.value.trim() === '')
                            _renderMobDropdown('empty', null);
                    });
                }
                return;
            } else {
                html += '<div class="mob-toss-trending-list">';
                html += _searchTrending.slice(0, 8).map((item, i) => {
                    const rankCls = i < 3 ? ' rank-top' : '';
                    const nameDisplay = (item.koreanName && item.koreanName !== item.ticker) ? item.koreanName : (item.name || item.ticker);
                    const chg = _sdropFmtChg(item._changePct);
                    const chgBadge = item._changePct != null ? `<span class="mob-toss-chg-badge ${chg.cls}">${chg.text}</span>` : '';
                    return `<div class="mob-toss-trending-item sdrop-item" role="option" data-ticker="${escHtml(item.ticker||'')}" data-market="${escHtml(item.market||'')}"><span class="mob-toss-rank${rankCls}">${i+1}</span><div class="mob-toss-trending-info"><span class="mob-toss-trending-name">${escHtml(nameDisplay||'')}</span><span class="mob-toss-trending-ticker">${escHtml(item.ticker||'')}</span></div>${chgBadge}</div>`;
                }).join('');
                html += '</div></div>';
            }
        } else if (mode === 'results') {
            if (!data?.length) {
                html = '<div style="padding:24px 16px;text-align:center;"><div style="font-size:22px;margin-bottom:8px;">🔍</div><div style="font-size:13px;font-weight:700;color:var(--text1);margin-bottom:5px;">검색 결과가 없습니다.</div><div style="font-size:12px;color:var(--text3);line-height:1.6;">티커 심볼로 검색해 주세요<br><span style="color:var(--blue);font-weight:600;">예: AAPL, TSLA, 005930</span></div></div>';
            } else {
                html += '<div class="mob-toss-section"><div class="mob-toss-section-hdr"><span class="mob-toss-section-title">검색 결과</span></div><div class="mob-toss-trending-list">';
                html += data.map((item, i) => _sdropItemHTML(item, i)).join('');
                html += '</div></div>';
            }
        }
        el.innerHTML = html;
        el.querySelectorAll('.sdrop-item').forEach(row => {
            row.addEventListener('click', () => {
                closeSearch();
                quickSearch(row.dataset.ticker, row.dataset.market);
            });
        });
    }

    function goSearch() {
        document.getElementById('mobSearchModal').style.display = '';
        updateBnActive('search');
        setTimeout(() => {
            const inp = document.getElementById('mobSearchInput');
            if (inp) { inp.focus(); _renderMobDropdown('empty', null); }
        }, 100);
    }

    // ── 최근 검색 strip (재렌더 시 _renderMobDropdown으로 위임) ──
    function _renderRecentSearchStrip() {
        if (document.getElementById('mobSearchModal')?.style.display !== 'none') {
            const inp = document.getElementById('mobSearchInput');
            if (inp?.value.trim() === '') _renderMobDropdown('empty', null);
        }
    }
    function _clickRecentChip(e, symbol, market) {
        if (e.target.closest('.mrc-del')) return;
        closeSearch();
        setMarket(market);
        document.getElementById('searchInput').value = symbol;
        searchStock();
    }
    function _deleteRecentSearch(symbol, market) {
        try {
            let r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
            r = r.filter(x => !(x.symbol === symbol && x.market === market));
            localStorage.setItem(RECENT_KEY, JSON.stringify(r));
        } catch(e) {}
        _renderRecentSearchStrip();
    }
    function _clearAllRecentSearches() {
        try { localStorage.removeItem(RECENT_KEY); } catch(e) {}
        _renderRecentSearchStrip();
    }

    function closeSearch() {
        document.getElementById('mobSearchModal').style.display = 'none';
        const inp = document.getElementById('mobSearchInput');
        if (inp) inp.value = '';
        const res = document.getElementById('mobSearchResults');
        if (res) res.innerHTML = '';
    }

    function _highlightDropdownItem(idx) {
        const items = _sdropItems();
        items.forEach(el => el.classList.remove('highlighted'));
        if (idx < 0 || idx >= items.length) { _dropdownHighlightIdx = -1; return; }
        _dropdownHighlightIdx = idx;
        items[idx].classList.add('highlighted');
        items[idx].scrollIntoView({block:'nearest'});
    }

    const _debouncedSuggest = debounce(async query => {
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

    function handleSearchKeydown(e) {
        const drop = document.getElementById('searchDropdown');
        const isOpen = drop?.classList.contains('open');
        // [Fix-B] _sdropItems() DOM 쿼리를 한 번만 실행해 캐싱
        const items = isOpen ? _sdropItems() : null;
        switch(e.key) {
            case 'Enter':
                e.preventDefault();
                if (isOpen && _dropdownHighlightIdx >= 0) {
                    items[_dropdownHighlightIdx]?.click();
                } else { closeSearchDropdown(); searchStock(); }
                break;
            case 'Escape': closeSearchDropdown(); document.getElementById('searchInput').blur(); break;
            case 'ArrowDown':
                e.preventDefault();
                if (!isOpen) openSearchDropdown();
                else _highlightDropdownItem(Math.min(_dropdownHighlightIdx+1, items.length-1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (isOpen) _highlightDropdownItem(Math.max(_dropdownHighlightIdx-1, 0));
                break;
        }
    }

    // ========================================

    // SPA 라우팅 — URL 동기화 (새로고침 시 현재 페이지 복원)
    // ========================================
    const _ROUTE_VIEWS = {
        home: () => goHome(),
        smartmoney: () => goSmartMoney(),
        scanner: () => goScanner(),
        earnings: () => goEarnings(),
        leverage: () => goLeverage(),
        vision: () => goVisionScanner(),
        economic: () => goEconomic(),
    };

    const _VIEW_TITLES = {
        home:       'StockAI — 주식 종목 분석',
        smartmoney: '기관 포트폴리오 — StockAI',
        scanner:    '알파 스캐너 — StockAI',
        earnings:   '실적발표 일정 — StockAI',
        leverage:   '레버리지 ETF — StockAI',
        vision:     'AI 차트 판독기 — StockAI',
        economic:   '경제지표 — StockAI',
    };

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

    // 백엔드 API 베이스 URL (같은 도메인 서빙 시 빈 문자열)
    const API_BASE = '';

    // ========================================

    // Market / Period / Chart Type
    // ========================================
    function setMarket(market) {
        currentMarket = market;
        document.querySelectorAll('.market-btn').forEach(b => b.classList.toggle('active', b.dataset.market === market));
        const input = document.getElementById('searchInput');
        input.placeholder = market === 'KR' ? '종목명 또는 코드 (예: 삼성전자, 005930)' : '종목명 또는 티커 (예: 테슬라, AAPL)';
        input.value = '';
    }

    // 분봉/시간봉인지 판별 (1m~60m, 1h)
    function isIntraday(interval) {
        return /m$/.test(interval) || interval === '1h';
    }

    // 인터벌 → Yahoo API 인터벌 + 집계 factor 매핑
    // Yahoo Finance가 직접 제공하지 않는 인터벌(3m, 10m)은 작은 단위로 받아서 client에서 합침
    const INTERVAL_AGG = {
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
    const INTERVAL_LABELS = {
        '1m':'1분','3m':'3분','5m':'5분','10m':'10분','15m':'15분','30m':'30분','60m':'60분','1h':'60분',
        '120m':'120분','240m':'240분',
        '1d':'일','1wk':'주','1mo':'월','1y':'년',
    };

    // 봉 타입별 기본 기간 — 인터벌별로 한눈에 의미 있는 데이터 양을 자동 적용
    // (기간 UI를 숨겼기 때문에 기본값이 곧 사용자 경험 — 충분한 과거 데이터 확보)
    const INTERVAL_RANGES = {
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

    function setPeriod(period) {
        currentPeriod = period;
        try { localStorage.setItem('stockai_chart_period', period); } catch(e) {}
        document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === period));
        if (currentSymbol) searchStock();
    }

    // 드롭다운 토글 — 모바일: 바텀시트 / 데스크탑: 버튼 아래 드롭다운
    // 메뉴를 body 로 옮겨서 부모 stacking context·overflow·transform 영향 차단
    function _ensureIntervalMenuInBody() {
        const menu = document.getElementById('intervalDdMenu');
        const backdrop = document.getElementById('intervalDdBackdrop');
        if (menu && menu.parentElement !== document.body) document.body.appendChild(menu);
        if (backdrop && backdrop.parentElement !== document.body) document.body.appendChild(backdrop);
    }

    function _toggleIntervalDropdown(ev) {
        if (ev) ev.stopPropagation();
        _ensureIntervalMenuInBody();
        const btn = document.getElementById('intervalDdBtn');
        const menu = document.getElementById('intervalDdMenu');
        const backdrop = document.getElementById('intervalDdBackdrop');
        if (!menu || !btn) return;
        const isOpen = menu.style.display !== 'none' && menu.style.display !== '';
        const isMobile = window.innerWidth <= 640;
        if (isOpen) {
            // 닫기
            menu.classList.remove('show');
            if (backdrop) backdrop.classList.remove('show');
            setTimeout(() => {
                menu.style.display = 'none';
                if (backdrop) backdrop.style.display = 'none';
            }, 250);
            document.body.style.overflow = '';
            return;
        }
        // 열기 — display:flex 로 설정해야 CSS flex-direction:column 이 적용됨
        if (isMobile) {
            // 바텀시트 — 인라인 위치 스타일 초기화 (CSS 가 처리)
            menu.style.top = '';
            menu.style.left = '';
            menu.style.right = '';
            menu.style.bottom = '';
            menu.style.display = 'flex';
            if (backdrop) backdrop.style.display = 'block';
            requestAnimationFrame(() => {
                menu.classList.add('show');
                if (backdrop) backdrop.classList.add('show');
            });
            document.body.style.overflow = 'hidden';
        } else {
            // 데스크탑 — 버튼 아래 드롭다운 (position:fixed 좌표 계산)
            const r = btn.getBoundingClientRect();
            menu.style.display = 'flex';
            menu.style.bottom = '';
            menu.style.right = '';
            menu.style.top = (r.bottom + 4) + 'px';
            const menuW = menu.offsetWidth || 100;
            let left = r.left;
            if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
            menu.style.left = Math.max(8, left) + 'px';
            // 스크롤 차단 (데스크탑·모바일 공통)
            document.body.style.overflow = 'hidden';
        }
    }
    // 외부 클릭 시 드롭다운 닫기 (메뉴가 body로 이동된 상태도 대응)
    function _closeIntervalDropdown() {
        const menu = document.getElementById('intervalDdMenu');
        if (!menu || menu.style.display === 'none' || menu.style.display === '') return;
        const backdrop = document.getElementById('intervalDdBackdrop');
        menu.classList.remove('show');
        if (backdrop) backdrop.classList.remove('show');
        setTimeout(() => {
            menu.style.display = 'none';
            if (backdrop) backdrop.style.display = 'none';
        }, 250);
        document.body.style.overflow = '';
    }
    document.addEventListener('click', (e) => {
        const btn = document.getElementById('intervalDdBtn');
        const menu = document.getElementById('intervalDdMenu');
        if (!menu || menu.style.display === 'none' || menu.style.display === '') return;
        if (menu.contains(e.target)) return;
        if (btn && btn.contains(e.target)) return;
        _closeIntervalDropdown();
    });
    // 스크롤·리사이즈 시 자동 닫기 — position:fixed 라서 따라 움직이지 않지만,
    // 버튼 위치는 변하므로 시각적 어긋남 방지
    window.addEventListener('scroll', () => _closeIntervalDropdown(), { passive: true, capture: true });
    window.addEventListener('resize', () => _closeIntervalDropdown(), { passive: true });

    // OHLCV 봉 집계 함수 — N개 봉을 1개로 합침 (timestamp는 첫 봉 것 사용)
    function _aggregateBars(quote, timestamps, factor) {
        if (factor <= 1 || !quote) return { quote, timestamps };
        const N = (quote.close || []).length;
        if (N === 0) return { quote, timestamps };
        const o2 = [], h2 = [], l2 = [], c2 = [], v2 = [], t2 = [];
        for (let i = 0; i < N; i += factor) {
            const end = Math.min(i + factor, N);
            // 청크 내 유효값만 집계
            let firstOpen = null, lastClose = null, hi = -Infinity, lo = Infinity, vol = 0;
            for (let j = i; j < end; j++) {
                if (quote.open[j]  != null && firstOpen === null) firstOpen = quote.open[j];
                if (quote.close[j] != null) lastClose = quote.close[j];
                if (quote.high[j]  != null && quote.high[j] > hi) hi = quote.high[j];
                if (quote.low[j]   != null && quote.low[j]  < lo) lo = quote.low[j];
                if (quote.volume[j]!= null) vol += quote.volume[j];
            }
            t2.push(timestamps[i] || 0);
            o2.push(firstOpen);
            c2.push(lastClose);
            h2.push(hi  === -Infinity ? null : hi);
            l2.push(lo  ===  Infinity ? null : lo);
            v2.push(vol);
        }
        return {
            quote: { open: o2, high: h2, low: l2, close: c2, volume: v2 },
            timestamps: t2,
        };
    }

    function setChartInterval(interval) {
        // Phase B-3: 프리셋 적용 중이 아니라면 사용자 수동 변경 → 프리셋 해제
        if (typeof _cnbPresetApplying !== 'undefined' && !_cnbPresetApplying) {
            if (typeof _userTfChangeAt !== 'undefined') _userTfChangeAt = Date.now();
            if (typeof _cnbDeactivatePreset === 'function') _cnbDeactivatePreset();
        }
        const prevInterval = currentInterval;
        currentInterval = interval;
        try { localStorage.setItem('stockai_chart_interval', interval); } catch(e) {}
        // 일·주봉 배너 자동 갱신 (캐시된 quote 재사용)
        try { _updateChartPreBanner(); } catch(_) {}
        // 드롭다운/바텀시트 자동 닫기
        try {
            const _menu = document.getElementById('intervalDdMenu');
            const _backdrop = document.getElementById('intervalDdBackdrop');
            if (_menu && _menu.style.display !== 'none') {
                _menu.classList.remove('show');
                if (_backdrop) _backdrop.classList.remove('show');
                setTimeout(() => { _menu.style.display = 'none'; if (_backdrop) _backdrop.style.display = 'none'; }, 250);
                document.body.style.overflow = '';
            }
        } catch(_) {}
        // 사각 버튼(일/주/월/년)과 드롭다운 항목 활성 상태 동기화
        document.querySelectorAll('.interval-btn').forEach(b => b.classList.toggle('active', b.dataset.interval === interval));
        document.querySelectorAll('.interval-dd-item').forEach(b => b.classList.toggle('active', b.dataset.interval === interval));
        // 드롭다운 라벨 업데이트 (분봉이면 X분 표시, 아니면 "분봉")
        const ddBtn = document.getElementById('intervalDdBtn');
        const ddLabel = document.getElementById('intervalDdLabel');
        if (ddLabel && ddBtn) {
            const isMin = /m$/.test(interval) || interval === '1h';
            if (isMin) {
                ddLabel.textContent = INTERVAL_LABELS[interval] || interval;
                ddBtn.classList.add('active');
            } else {
                ddLabel.textContent = '분봉';
                ddBtn.classList.remove('active');
            }
        }
        // 드롭다운 닫기
        const menu = document.getElementById('intervalDdMenu');
        if (menu) menu.style.display = 'none';

        // 5분봉으로 전환 시 자동으로 단타 모드 활성화 + 토스트
        if (interval === '5m' && prevInterval !== '5m' && typeof currentTestaMode !== 'undefined') {
            if (currentTestaMode === 'swing') {
                currentTestaMode = 'day';
                try { localStorage.setItem('testaMode', 'day'); } catch(_){}
                document.querySelectorAll('.trade-mode-toggle .tm-btn').forEach(b =>
                    b.classList.toggle('active', b.dataset.mode === 'day')
                );
                if (typeof showToast === 'function') showToast('⚡ 5분봉 돌파 단타 모드로 자동 전환');
            } else {
                if (typeof showToast === 'function') showToast('⚡ 5분봉 돌파 단타 모드 활성');
            }
        }

        // 봉 타입에 맞게 기간 버튼 표시/숨김 및 기본 기간 설정
        const config = INTERVAL_RANGES[interval];
        const rangeButtons = document.querySelectorAll('.range-btn');
        let currentRangeValid = false;

        rangeButtons.forEach(b => {
            const r = b.dataset.range;
            if (config.allowed.includes(r)) {
                b.style.display = '';
                if (r === currentPeriod) currentRangeValid = true;
            } else {
                b.style.display = 'none';
                b.classList.remove('active');
            }
        });

        // 인터벌 변경 시 항상 defaultRange 적용 — 기간 UI 숨겼으므로 인터벌이 곧 기간 결정
        if (interval !== prevInterval) {
            currentPeriod = config.defaultRange;
            try { localStorage.setItem('stockai_chart_period', currentPeriod); } catch(e) {}
            rangeButtons.forEach(b => b.classList.toggle('active', b.dataset.range === currentPeriod));
        }

        if (currentSymbol) searchStock();
    }


    function getTimeUnit() {
        switch (currentInterval) {
            case '1m':  return 'minute';
            case '5m':  return 'minute';
            case '15m': return 'minute';
            case '1h':  return 'hour';
            case '1wk':
                return (currentPeriod === '5y') ? 'quarter' : 'month';
            default: // 1d
                if (currentPeriod === '5y' || currentPeriod === '1y') return 'month';
                if (currentPeriod === '6mo' || currentPeriod === '3mo') return 'week';
                return 'day';
        }
    }

    function getIntervalLabel() {
        const map = { '1m': '1분봉', '5m': '5분봉', '15m': '15분봉', '1h': '1시간봉', '1d': '일봉', '1wk': '주봉' };
        return map[currentInterval] || '일봉';
    }

    function quickSearch(symbol, market) {
        setMarket(market);
        document.getElementById('searchInput').value = symbol;
        searchStock();
    }

    // selectStock — RS 강세주 chip / catalyst 카드 등에서 호출 (대부분 US 종목)
    // 미정의 시 onclick 에러 발생 → quickSearch 위임 함수로 안전 처리
    function selectStock(symbol, market) {
        quickSearch(symbol, market || 'US');
    }

    // ========================================

    async function _filterValidTickers(tickers) {
        const now = Date.now();
        const toFetch = tickers.filter(t => {
            const c = _scannerTickerValid[t];
            return !c || (now - c.ts) > _TICKER_VALID_TTL;
        });
        if (toFetch.length > 0) {
            const chunks = [];
            for (let i = 0; i < toFetch.length; i += 50) chunks.push(toFetch.slice(i, i + 50));
            await Promise.all(chunks.map(async chunk => {
                try {
                    const res = await fetch(`/api/quote?symbols=${chunk.join(',')}`);
                    const data = await res.json();
                    const quotes = data?.quoteResponse?.result || [];
                    const found = new Set(quotes
                        .filter(q => (q.regularMarketPrice ?? 0) > 0 &&
                                     (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
                        .map(q => q.symbol));
                    chunk.forEach(t => { _scannerTickerValid[t] = { valid: found.has(t), ts: now }; });
                } catch(e) {
                    chunk.forEach(t => { _scannerTickerValid[t] = { valid: true, ts: now }; });
                }
            }));
        }
        return new Set(tickers.filter(t => _scannerTickerValid[t]?.valid !== false));
    }

    // ========================================
    // US Top 100 Stocks (optimized)
    // ========================================
    let top100Cache = {};
    let top100Filter = 'most_actives';
    const TOP100_CACHE_MS = 180000; // 3분
    const TOP100_LS_KEY = 'top100_cache';
    const TOP100_FILTERS = ['most_actives','day_gainers','day_losers'];

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

    function showTop100Skeleton() {
        const grid = document.getElementById('top100Grid');
        if (!grid) return;
        let html = '';
        for (let i = 0; i < 20; i++) {
            html += `<div class="skel-row">
                <div class="skel-block skel-fav"></div>
                <div class="skel-block skel-rank"></div>
                <div class="skel-block skel-logo"></div>
                <div class="skel-info"><div class="skel-block skel-name"></div></div>
                <div class="skel-block skel-price"></div>
                <div class="skel-block skel-chg"></div>
            </div>`;
        }
        grid.innerHTML = html;
    }

    // Top100 컬럼 헤더의 활성 정렬 라벨 갱신 (현재 필터에 따라 라벨 변화 + 강조)
    function _syncTop100ColHead(filter) {
        const ch = document.querySelector('.top100-colhead .t100-ch-change');
        if (!ch) return;
        const labelMap = {
            most_actives: '등락률',
            day_gainers:  '상승률 순',
            day_losers:   '하락률 순',
            penny_stocks: '상승률 순',
            oversold:     'RSI 낮은 순'
        };
        ch.textContent = labelMap[filter] || '등락률';
        ch.setAttribute('data-sort', filter);
    }

    function setTop100Filter(filter) {
        top100Filter = filter;
        document.querySelectorAll('.top100-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
        _syncTop100ColHead(filter);
        // 캐시 있으면 즉시 렌더, 없으면 스켈레톤 + fetch
        if (top100Cache[filter] && Date.now() - top100Cache[filter].ts < TOP100_CACHE_MS) {
            renderTop100(top100Cache[filter].items);
        } else {
            showTop100Skeleton();
            fetchTop100Single(filter);
        }
    }

    async function fetchTop100Single(filter) {
        // 과매도 전용 경로 — /api/oversold-radar 결과를 Yahoo quote 포맷으로 변환 (v652)
        if (filter === 'oversold') {
            try {
                const r = await fetch('/api/oversold-radar?tab=oversold');
                if (!r.ok) throw new Error('http ' + r.status);
                const d = await r.json();
                const raw = Array.isArray(d.items) ? d.items : [];
                if (raw.length) {
                    // renderTop100 은 Yahoo quote 필드를 기대 → 매핑
                    const items = raw
                        .filter(it => it.symbol && it.price != null)
                        .map(it => ({
                            symbol: it.symbol,
                            shortName: it.name || it.symbol,
                            longName: it.name || it.symbol,
                            regularMarketPrice: it.price,
                            regularMarketChange: it.changePct != null ? it.price * (it.changePct / 100) : 0,
                            regularMarketChangePercent: it.changePct ?? 0,
                            regularMarketVolume: it.volume || 0,
                            averageDailyVolume3Month: it.avgVolume || 0,
                            fiftyDayAverage: it.ma50 || null,
                            twoHundredDayAverage: it.ma200 || null,
                            _rsi: it.rsi,
                            _volMult: it.volMult,
                            _per: it.per,
                            _pbr: it.pbr,
                        }))
                        // RSI 낮은 순 정렬 (RSI 없는 종목은 뒤로)
                        .sort((a, b) => (a._rsi ?? 999) - (b._rsi ?? 999))
                        .slice(0, 100);
                    top100Cache[filter] = { items, ts: Date.now() };
                    saveTop100LS();
                    if (top100Filter === filter) renderTop100(items);
                    return;
                }
            } catch(e) { warn('[top100 oversold]', e); }
            const grid = document.getElementById('top100Grid');
            if (grid && top100Filter === filter) grid.innerHTML = '<div class="top100-loading">데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.</div>';
            return;
        }
        // 저가주 전용 경로
        if (filter === 'penny_stocks') {
            // 유효한 US 티커만 허용: 알파벳 시작, 밑줄 없음, 해외 거래소 suffix 제외
            // 유효한 US 상장 티커만 허용 (알파벳 1~5자, US 클래스 접미사만 허용)
            const _US_SUFFIXES = new Set(['A','B','C','D','U','W','WS','WT','R']);
            const _isValidTicker = sym => {
                if (!sym || /^\d/.test(sym)) return false;   // 숫자 시작 제외
                if (sym.includes('_') || sym.includes(' ')) return false; // 파생/인덱스 제외
                const parts = sym.split('.');
                if (parts.length > 2) return false;
                if (parts.length === 2 && !_US_SUFFIXES.has(parts[1].toUpperCase())) return false; // .HK .MI .V .TO 등 제외
                return /^[A-Za-z]/.test(parts[0]) && parts[0].length >= 1 && parts[0].length <= 5;
            };
            try {
                const data = await fetch('/api/penny-stocks').then(r => r.json());
                const quotes = data?.quotes;
                if (quotes?.length) {
                    const items = quotes.filter(q =>
                        _isValidTicker(q.symbol) &&
                        (q.regularMarketVolume || 0) > 0 &&   // 당일 거래량 있는 종목만
                        q.regularMarketPrice != null           // 가격 데이터 있는 종목만
                    ).slice(0, 100);
                    top100Cache[filter] = { items, ts: Date.now() };
                    saveTop100LS();
                    if (top100Filter === filter) renderTop100(items);
                    return;
                }
            } catch(e) {}
            // fallback: 대표 저가주 심볼
            try {
                // 대표 저가주 (보통 $5 미만 거래되는 활성 종목들)
                const fb = 'SNDL,NOK,PLUG,NIO,MULN,FFIE,BLNK,CHPT,EVGO,ABEV,BB,WKHS,NKLA,CENN,GOEV,OPEN,IDEX,RIG,CLOV,LCID,XPEV,AMC,FUBO,GME,KGC,GOLD,SIRI,ITUB,T,VALE';
                const qData = await fetchWithProxy(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${fb}`);
                const quotes = qData?.quoteResponse?.result || [];
                if (quotes.length) {
                    // $5 미만만 필터링 후 상승률 정렬
                    const items = quotes
                        .filter(q => q.regularMarketPrice != null && q.regularMarketPrice < 5)
                        .sort((a,b) => (b.regularMarketChangePercent||0) - (a.regularMarketChangePercent||0));
                    top100Cache[filter] = { items, ts: Date.now() };
                    saveTop100LS();
                    if (top100Filter === filter) renderTop100(items);
                    return;
                }
            } catch(e) {}
            const grid = document.getElementById('top100Grid');
            if (grid && top100Filter === filter) grid.innerHTML = '<div class="top100-loading">데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.</div>';
            return;
        }

        try {
            const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=${filter}&count=100`;
            const data = await fetchRace(url, 6000);
            const quotes = data?.finance?.result?.[0]?.quotes;
            if (quotes?.length) {
                const items = quotes.slice(0, 100);
                top100Cache[filter] = { items, ts: Date.now() };
                saveTop100LS();
                if (top100Filter === filter) renderTop100(items);
                if (filter === 'day_gainers') { renderSwingRadar(items); if (_radarTab === 'swing') _renderSwingInRadar(); }
                return;
            }
        } catch(e) {}
        // fallback
        try {
            const fb = 'AAPL,MSFT,GOOGL,AMZN,NVDA,META,TSLA,BRK-B,JPM,V,UNH,XOM,JNJ,WMT,MA,PG,HD,CVX,ABBV,MRK,KO,PEP,BAC,COST,AVGO,LLY,TMO,MCD,CSCO,ACN,ABT,DHR,ADBE,CRM,NFLX,AMD,INTC,QCOM,TXN,ORCL,IBM,GS,MS,BA,CAT,DIS,NKE,PYPL,UBER,SQ,SNAP,SHOP,PLTR,COIN,ABNB,CRWD,SNOW,NET,DDOG,MDB,PANW,FTNT,TTD,RBLX,ARM,SMCI,SOFI,HOOD,MARA,RIOT,MSTR,TSM,ASML,MU,AMAT,LRCX,KLAC,NOW,INTU,ISRG,REGN,GILD,MRNA,PFE,UNP,HON,LOW,TJX,SBUX,CMG,YUM,CL,MMM,GE,RTX,LMT,DE,FDX,UPS,T,VZ,TMUS';
            const qData = await fetchWithProxy(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${fb}`);
            const quotes = qData?.quoteResponse?.result || [];
            if (quotes.length) {
                let sorted = [...quotes];
                if (filter === 'day_gainers') sorted.sort((a,b) => (b.regularMarketChangePercent||0) - (a.regularMarketChangePercent||0));
                else if (filter === 'day_losers') sorted.sort((a,b) => (a.regularMarketChangePercent||0) - (b.regularMarketChangePercent||0));
                else sorted.sort((a,b) => (b.regularMarketVolume||0) - (a.regularMarketVolume||0));
                const items = sorted.slice(0, 100);
                top100Cache[filter] = { items, ts: Date.now() };
                saveTop100LS();
                if (top100Filter === filter) renderTop100(items);
                if (filter === 'day_gainers') { renderSwingRadar(items); if (_radarTab === 'swing') _renderSwingInRadar(); }
                return;
            }
        } catch(e) {}
        const grid = document.getElementById('top100Grid');
        if (grid && top100Filter === filter) grid.innerHTML = '<div class="top100-loading">데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.</div>';
    }

    function saveTop100LS() {
        try { localStorage.setItem(TOP100_LS_KEY, JSON.stringify(top100Cache)); } catch(e) {}
    }

    // 모든 필터 병렬 프리로드
    function preloadAllTop100() {
        TOP100_FILTERS.forEach(f => {
            if (!top100Cache[f] || Date.now() - top100Cache[f].ts >= TOP100_CACHE_MS) {
                fetchTop100Single(f);
            }
        });
    }

    function loadTop100() {
        const filter = top100Filter;
        if (top100Cache[filter] && Date.now() - top100Cache[filter].ts < TOP100_CACHE_MS) {
            renderTop100(top100Cache[filter].items);
            // 백그라운드에서 나머지 필터도 갱신
            preloadAllTop100();
        } else {
            showTop100Skeleton();
            preloadAllTop100();
        }
    }

    // TOP 100 모듈 스코프 상태 — TDZ 회피를 위해 함수 정의보다 먼저 선언

    function _top100FmtVol(v) {
        if (v == null) return '-';
        if (v >= 1e9) return (v/1e9).toFixed(1) + 'B';
        if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
        if (v >= 1e3) return (v/1e3).toFixed(0) + 'K';
        return v.toLocaleString();
    }

    // 티커 sanitize: onclick 속성에 안전하게 삽입 가능한 문자만 허용
    // (Yahoo Finance ticker는 [A-Z0-9.\-^=] 범위. 그 외 문자 포함 시 렌더 제외)
    function _top100SafeTicker(s) {
        return /^[A-Z0-9.\-^=]{1,15}$/i.test(s) ? s : null;
    }

    // 티커 → 색상 (이니셜 아바타 폴백용, 결정적)
    function _tickerColor(sym) {
        const palette = ['#6366f1','#0ea5e9','#14b8a6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#3b82f6','#3b82f6','var(--yellow)'];
        let h = 0;
        for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
        return palette[h % palette.length];
    }

    // 티커 → 사업국가 국기 매핑 (미국 상장 ADR/외국법인 도미사일 기준)
    // 키는 모두 대문자, 미수록 티커는 market 기본값 사용
    const _TICKER_COUNTRY = {
        // China
        'BABA':'🇨🇳','JD':'🇨🇳','PDD':'🇨🇳','BIDU':'🇨🇳','NIO':'🇨🇳','XPEV':'🇨🇳','LI':'🇨🇳',
        'TME':'🇨🇳','BILI':'🇨🇳','TCOM':'🇨🇳','EDU':'🇨🇳','TAL':'🇨🇳','IQ':'🇨🇳','HUYA':'🇨🇳',
        'DOYU':'🇨🇳','YMM':'🇨🇳','DIDI':'🇨🇳','ZH':'🇨🇳','WB':'🇨🇳','VIPS':'🇨🇳','ZTO':'🇨🇳',
        'BEKE':'🇨🇳','DADA':'🇨🇳','FINV':'🇨🇳','LU':'🇨🇳','MNSO':'🇨🇳','GOTU':'🇨🇳','NTES':'🇨🇳',
        'BZ':'🇨🇳','YY':'🇨🇳','ZLAB':'🇨🇳','JKS':'🇨🇳','DQ':'🇨🇳','LX':'🇨🇳','HTHT':'🇨🇳','EH':'🇨🇳',
        // Hong Kong / Taiwan / Singapore / Korea / Japan / India
        'TSM':'🇹🇼','UMC':'🇹🇼','HIMX':'🇹🇼','ASX':'🇹🇼','GSIT':'🇹🇼',
        'SE':'🇸🇬','GRAB':'🇸🇬',
        'KB':'🇰🇷','SHG':'🇰🇷','WF':'🇰🇷','LPL':'🇰🇷','CPNG':'🇰🇷',
        'TM':'🇯🇵','HMC':'🇯🇵','NMR':'🇯🇵','SONY':'🇯🇵','MUFG':'🇯🇵','SMFG':'🇯🇵','MFG':'🇯🇵',
        'NTT':'🇯🇵','TAK':'🇯🇵','KYOCY':'🇯🇵','ORAN':'🇯🇵',
        'INFY':'🇮🇳','WIT':'🇮🇳','HDB':'🇮🇳','IBN':'🇮🇳','MMYT':'🇮🇳','RDY':'🇮🇳','AZRE':'🇮🇳','SIFY':'🇮🇳',
        'FUTU':'🇭🇰','TIGR':'🇭🇰',
        // Europe — Switzerland
        'NVS':'🇨🇭','UBS':'🇨🇭','LOGI':'🇨🇭','ABBN':'🇨🇭','GRFS':'🇨🇭',
        // Netherlands
        'ASML':'🇳🇱','STLA':'🇳🇱','PHG':'🇳🇱','RELX':'🇳🇱','NXPI':'🇳🇱','YNDX':'🇳🇱',
        // UK
        'BP':'🇬🇧','AZN':'🇬🇧','SHEL':'🇬🇧','UL':'🇬🇧','GSK':'🇬🇧','VOD':'🇬🇧','HSBC':'🇬🇧',
        'BCS':'🇬🇧','LYG':'🇬🇧','NGG':'🇬🇧','BTI':'🇬🇧','DEO':'🇬🇧','ARM':'🇬🇧','PSO':'🇬🇧',
        // Germany
        'SAP':'🇩🇪','SIEGY':'🇩🇪','BASFY':'🇩🇪','DB':'🇩🇪',
        // France
        'SNY':'🇫🇷','TTE':'🇫🇷','LVMUY':'🇫🇷','DASSY':'🇫🇷','AXAHY':'🇫🇷',
        // Ireland
        'ACN':'🇮🇪','MDT':'🇮🇪','STX':'🇮🇪','ICLR':'🇮🇪','ETN':'🇮🇪','JCI':'🇮🇪','JHX':'🇮🇪',
        'AER':'🇮🇪','LIN':'🇮🇪','JAZZ':'🇮🇪','HZNP':'🇮🇪',
        // Denmark / Sweden / Finland / Norway
        'NVO':'🇩🇰','ERIC':'🇸🇪','NOK':'🇫🇮','EQNR':'🇳🇴',
        // Canada
        'SHOP':'🇨🇦','RY':'🇨🇦','TD':'🇨🇦','ENB':'🇨🇦','BNS':'🇨🇦','BMO':'🇨🇦','CM':'🇨🇦',
        'MFC':'🇨🇦','SU':'🇨🇦','CNQ':'🇨🇦','CNR':'🇨🇦','BCE':'🇨🇦','TRP':'🇨🇦','CP':'🇨🇦',
        'RBA':'🇨🇦','TRI':'🇨🇦','WPM':'🇨🇦','NTR':'🇨🇦','AEM':'🇨🇦','GIB':'🇨🇦','GOLD':'🇨🇦',
        'ABX':'🇨🇦','OTEX':'🇨🇦','CSU':'🇨🇦','FNV':'🇨🇦','KGC':'🇨🇦','TECK':'🇨🇦','MGA':'🇨🇦',
        'DOO':'🇨🇦','STN':'🇨🇦',
        // Latin America
        'MELI':'🇦🇷','GGAL':'🇦🇷','PAM':'🇦🇷','YPF':'🇦🇷','BBAR':'🇦🇷','BMA':'🇦🇷',
        'VALE':'🇧🇷','PBR':'🇧🇷','ITUB':'🇧🇷','BBD':'🇧🇷','ABEV':'🇧🇷','ERJ':'🇧🇷','SID':'🇧🇷',
        'GGB':'🇧🇷','STNE':'🇧🇷','PAGS':'🇧🇷','NU':'🇧🇷','XP':'🇧🇷','CSAN':'🇧🇷','UGP':'🇧🇷',
        'AMX':'🇲🇽','FMX':'🇲🇽','KOF':'🇲🇽','CX':'🇲🇽','BSMX':'🇲🇽',
        // Israel
        'CHKP':'🇮🇱','NICE':'🇮🇱','TEVA':'🇮🇱','CYBR':'🇮🇱','WIX':'🇮🇱','MNDY':'🇮🇱','GLBE':'🇮🇱',
        'FROG':'🇮🇱','SMWB':'🇮🇱','TSEM':'🇮🇱','ICL':'🇮🇱','ELBM':'🇮🇱',
        // Australia
        'BHP':'🇦🇺','RIO':'🇦🇺','TEAM':'🇦🇺','AMCR':'🇦🇺',
        // South Africa
        'AU':'🇿🇦','GFI':'🇿🇦','SBSW':'🇿🇦','HMY':'🇿🇦',
        // Greece / Cyprus / Bermuda
        'CRTO':'🇬🇷','GLNG':'🇧🇲','SBLK':'🇬🇷','GSL':'🇬🇷','DAC':'🇬🇷','GNK':'🇬🇷',
    };

    // ── 국내 종목 로고 도메인 매핑 (Clearbit 1순위) ──────────────
    const KR_LOGO_DOMAINS = {
        '005930':'samsung.com',        // 삼성전자
        '000660':'skhynix.com',        // SK하이닉스
        '035420':'naver.com',          // NAVER
        '035720':'kakao.com',          // 카카오
        '051910':'lgchem.com',         // LG화학
        '006400':'samsungsdi.com',     // 삼성SDI
        '028260':'samsung.com',        // 삼성물산
        '105560':'kbfg.com',           // KB금융
        '055550':'shinhan.com',        // 신한지주
        '012330':'hyundai.com',        // 현대모비스
        '207940':'samsungbioepis.com', // 삼성바이오로직스
        '068270':'celltrion.com',      // 셀트리온
        '003550':'lgcorp.com',         // LG
        '096770':'skoil.co.kr',        // SK이노베이션
        '017670':'sktelecom.com',      // SK텔레콤
        '030200':'kt.com',             // KT
        '032830':'samsunglife.com',    // 삼성생명
        '086790':'hanabank.com',       // 하나금융지주
        '066570':'lg.com',             // LG전자
        '009830':'hanwha.com',         // 한화솔루션
        '000270':'kia.com',            // 기아
        '005380':'hyundai.com',        // 현대차
        '018260':'samsung.com',        // 삼성에스디에스
        '011170':'lottechem.com',      // 롯데케미칼
        '034730':'sk.com',             // SK(주)
    };

    // 국내 종목 로고 URL 우선순위:
    //   1) Alpha Square CDN (가장 안정적) → 2) Clearbit(도메인 매핑) → 3) 이니셜 아바타
    function _getKrLogoUrl(code) {
        return `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${code}.png`;
    }

    // 원형 로고 + 국기 오버레이 HTML
    //  - KR(6자리 숫자): Alpha Square CDN → Clearbit(도메인 매핑) → 이니셜
    //  - US: Parqet CDN → 이니셜
    function _tickerLogoHTML(sym, market, companyName) {
        const safe = _top100SafeTicker(sym);
        if (!safe) return '<div class="tlogo-wrap"></div>';
        // 6자리 숫자 또는 market=KR 이면 국내 종목으로 판단
        const isKr = /^\d{6}$/.test(safe) || market === 'KR';
        const color = _tickerColor(safe);
        // 국기 이모지 직접 결정 (텍스트 절대 금지)
        let flag = isKr ? '🇰🇷' : '🇺🇸';
        const mapped = _TICKER_COUNTRY?.[safe.toUpperCase()];
        // 매핑값이 이모지(길이>1, 알파벳 아님)일 때만 적용
        if (mapped && mapped.length > 1 && !/^[a-zA-Z]+$/.test(mapped)) flag = mapped;
        // 절대 안전장치
        if (flag === 'us' || flag === 'US') flag = '🇺🇸';
        if (flag === 'kr' || flag === 'KR') flag = '🇰🇷';
        if (flag === 'cn' || flag === 'CN') flag = '🇨🇳';
        if (flag === 'jp' || flag === 'JP') flag = '🇯🇵';

        // 이니셜: KR은 KR_STOCK_NAMES 한글명 첫 글자, US는 심볼 첫 알파벳
        const krStockName = isKr ? (typeof KR_STOCK_NAMES !== 'undefined' && KR_STOCK_NAMES[safe]) : null;
        const nameForInitial = krStockName || companyName || safe;
        const initial = isKr
            ? (krStockName ? krStockName.charAt(0) : (companyName || '').replace(/[a-zA-Z0-9\s.,()[\]-]/g,'').charAt(0) || safe.charAt(0))
            : (safe.replace(/[^A-Z0-9]/gi,'').charAt(0).toUpperCase() || '?');
        const fallback = `<span class=&quot;tlogo tlogo-fb&quot; style=&quot;background:${color}&quot;>${initial}</span>`;

        if (isKr) {
            // KR: Alpha Square 1차 → Clearbit 2차 → 이니셜
            const primary   = `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${safe}.png`;
            const secondary = KR_LOGO_DOMAINS[safe] ? `https://logo.clearbit.com/${KR_LOGO_DOMAINS[safe]}` : '';
            const onErr = secondary
                ? `if(this.dataset.fb==='1'){this.outerHTML='${fallback}';}else{this.dataset.fb='1';this.src='${secondary}';}`
                : `this.outerHTML='${fallback}';`;
            return `<div class="tlogo-wrap">
                <img class="tlogo" src="${primary}" alt="" loading="lazy" onerror="${onErr}">
                <span class="tlogo-flag">${flag}</span>
            </div>`;
        }

        // US: Parqet CDN → 이니셜
        const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(safe)}?format=png`;
        return `<div class="tlogo-wrap">
            <img class="tlogo" src="${logoUrl}" alt="" loading="lazy" onerror="this.outerHTML='${fallback}'">
            <span class="tlogo-flag">${flag}</span>
        </div>`;
    }

    // 행 즐겨찾기 토글 (row 클릭 이벤트 버블링 차단)
    function _top100ToggleFav(ev, sym, market, name) {
        if (ev) { ev.stopPropagation(); ev.preventDefault(); }
        const safe = _top100SafeTicker(sym);
        if (!safe) return;
        let favs = getFavorites();
        const idx = favs.findIndex(f => f.symbol === safe && f.market === market);
        if (idx >= 0) {
            favs.splice(idx, 1);
        } else {
            favs.unshift({ symbol: safe, market, name: name || safe, addedAt: Date.now() });
        }
        saveFavorites(favs);
        // 아이콘 상태 토글
        const btn = ev && ev.currentTarget;
        if (btn) {
            const on = idx < 0;
            btn.classList.toggle('on', on);
            const icon = btn.querySelector('i');
            if (icon) icon.className = on ? 'ri-star-fill' : 'ri-star-line';
        }
    }

    function _top100BuildRow(q, i, opts) {
        const rawSymbol = q.symbol || '';
        const symbol = _top100SafeTicker(rawSymbol);
        if (!symbol) return ''; // 비정상 티커는 렌더 스킵
        const name = q.shortName || q.longName || symbol;
        const price = q.regularMarketPrice;
        const chg = q.regularMarketChangePercent;
        const vol = q.regularMarketVolume;
        const market = 'US'; // Top100 = US only
        const chgCls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
        const chgText = chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '-';
        const priceText = price != null ? `$${price.toFixed(2)}` : '-';
        // 거래대금 = 거래량 × 가격 (한국식 단위: 조/억/만)
        const tradeValue = (vol && price) ? vol * price : 0;
        const fmtTradeValue = (v) => {
            if (!v) return '-';
            if (v >= 1e12) return `$${(v/1e12).toFixed(2)}조`;
            if (v >= 1e8)  return `$${(v/1e8).toFixed(1)}억`;
            if (v >= 1e4)  return `$${(v/1e4).toFixed(0)}만`;
            return `$${Math.round(v).toLocaleString('en-US')}`;
        };
        const tvText = fmtTradeValue(tradeValue);
        const rankCls = (opts && opts.showTop3 && i < 3) ? 'top3' : '';
        const faved = isFavorited(symbol, market);
        const heartCls = faved ? 'ri-star-fill' : 'ri-star-line';
        const safeName = escHtml(name).replace(/'/g,'&#39;');
        return `<div class="top100-row" onclick="quickSearch('${symbol}','US')">
            <button class="top100-fav ${faved?'on':''}" aria-label="즐겨찾기" onclick="_top100ToggleFav(event,'${symbol}','${market}','${safeName}')"><i class="${heartCls}"></i></button>
            <div class="top100-rank ${rankCls}">${i + 1}</div>
            ${_tickerLogoHTML(symbol, market, name)}
            <div class="top100-info">
                <div class="top100-ticker-sym">${symbol}</div>
                <div class="top100-reason" data-reason-for="${symbol}" data-fallback="${escHtml(name)}">${escHtml(name)}</div>
            </div>
            <div class="top100-price-wrap">
                <div class="top100-price">${priceText}</div>
                <div class="top100-change ${chgCls}">${chgText}</div>
            </div>
            <div class="top100-tv-wrap">
                <div class="top100-tv-label">거래대금</div>
                <div class="top100-tv">${tvText}</div>
            </div>
        </div>`;
    }

    // 종목 상세 Hero 의 AI 요약
    function _hideStockHeroReason() {
        const box = document.getElementById('stockReason');
        if (box) box.hidden = true;
    }
    async function _populateStockHeroReason(symbol) {
        const box = document.getElementById('stockReason');
        const txtEl = document.getElementById('stockReasonText');
        if (!box || !txtEl || !symbol) return;
        try {
            const res = await fetch(`/api/news-reason?symbols=${encodeURIComponent(symbol)}`);
            if (!res.ok) { warn('[reason] HTTP', res.status); return; }
            const map = await res.json();
            const text = map[symbol] || '';
            if (text) { txtEl.textContent = text; box.hidden = false; }
            else info('[reason] empty for', symbol);
        } catch (e) { warn('[reason] fetch fail', e?.message); }
    }

    function renderTop100(items) {
        const grid = document.getElementById('top100Grid');
        const updatedEl = document.getElementById('top100Updated');
        if (!grid) return;

        if (!items || items.length === 0) {
            grid.innerHTML = '<div class="top100-loading">데이터가 없습니다.</div>';
            return;
        }

        const now = new Date();
        const hhmm = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
        if (updatedEl) updatedEl.textContent = `${hhmm} 업데이트`;
        // 컬럼 헤더의 타임스탬프/활성 정렬 동기화
        const tsEl = document.getElementById('top100ColTs');
        if (tsEl) tsEl.textContent = '';
        _syncTop100ColHead(top100Filter);

        _top100AllItems = items; // 더 보기용 전체 데이터 저장

        let html = '';

        const visible = items.slice(0, _TOP100_INITIAL_LIMIT);
        const rest = items.slice(_TOP100_INITIAL_LIMIT);

        visible.forEach((q, i) => { html += _top100BuildRow(q, i, { showTop3: true }); });

        if (rest.length > 0) {
            html += `<button class="top100-more-btn" id="top100MoreBtn" onclick="showMoreTop100()">
                나머지 ${rest.length}개 더 보기 ↓
            </button>`;
        }

        grid.innerHTML = html;
    }

    function showMoreTop100() {
        const grid = document.getElementById('top100Grid');
        const btn  = document.getElementById('top100MoreBtn');
        if (!grid || !btn || !_top100AllItems.length) return;

        let extra = '';
        const extraItems = _top100AllItems.slice(_TOP100_INITIAL_LIMIT);
        extraItems.forEach((q, i) => {
            extra += _top100BuildRow(q, _TOP100_INITIAL_LIMIT + i, { showTop3: false });
        });

        btn.outerHTML = extra;
    }

    // ========================================
    // 섹션 1: 글로벌 마켓 날씨 위젯
    // ========================================
    const MW_INDICES = [
        { symbol:'^GSPC', name:'S&P 500' },
        { symbol:'^IXIC', name:'NASDAQ'  },
        { symbol:'^KS11', name:'KOSPI'   }
    ];
    let _mwTimer = null;

    async function loadMarketWeather() {
        try {
            const syms = MW_INDICES.map(i=>i.symbol).join(',');
            const [quoteRes, ...sparkRes] = await Promise.allSettled([
                fetchRace(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}`, 8000),
                ...MW_INDICES.map(idx =>
                    fetchRace(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(idx.symbol)}?range=5d&interval=1d`, 8000)
                )
            ]);
            const quotes = quoteRes.value?.quoteResponse?.result || [];
            const sparks = sparkRes.map(r => (r.value?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v=>v!=null));
            renderMarketWeather(quotes, sparks);
        } catch(e) {}
        if (_mwTimer) clearInterval(_mwTimer);
        _mwTimer = setInterval(loadMarketWeather, 60000);
    }

    function renderMarketWeather(quotes, sparks) {
        const bar = document.getElementById('marketWeatherBar');
        if (!bar) return;
        const map = {}; quotes.forEach(q => map[q.symbol] = q);
        bar.innerHTML = MW_INDICES.map((idx, i) => {
            const q = map[idx.symbol];
            const price = q?.regularMarketPrice;
            const pct   = q?.regularMarketChangePercent;
            const cls   = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
            const priceStr = price != null ? price.toLocaleString('en-US',{maximumFractionDigits:2}) : '—';
            const pctStr   = pct   != null ? `${pct>=0?'+':''}${pct.toFixed(2)}%` : '—';
            const mkt = idx.symbol==='^KS11' ? 'KR' : 'US';
            const safe = idx.symbol.replace(/'/g,"\\'");
            return `<div class="mw-card" onclick="quickSearch('${safe}','${mkt}')">
                <div class="mw-card-name">${idx.name}</div>
                <div class="mw-card-price">${priceStr}</div>
                <div class="mw-card-chg ${cls}">${pctStr}</div>
                ${drawSparkline(sparks[i], pct>=0, i)}
            </div>`;
        }).join('');
    }

    function drawSparkline(prices, isPos, idx) {
        if (!prices || prices.length < 2) return `<svg class="mw-sparkline" viewBox="0 0 100 32"></svg>`;
        const W=100, H=32, pad=2;
        const mn=Math.min(...prices), mx=Math.max(...prices), rng=mx-mn||1;
        const pts = prices.map((p,i)=>{
            const x = pad + i/(prices.length-1)*(W-pad*2);
            const y = H-pad - (p-mn)/rng*(H-pad*2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const color = isPos ? 'var(--green)' : 'var(--red)';
        const fp = pts[0].split(','), lp = pts[pts.length-1].split(',');
        const fill = `M${fp[0]},${H-pad} L${pts.join(' L')} L${lp[0]},${H-pad}Z`;
        const gid = `sg${idx}`;
        return `<svg class="mw-sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${color}" stop-opacity=".25"/>
                <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
            </linearGradient></defs>
            <path d="${fill}" fill="url(#${gid})"/>
            <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>`;
    }

    // ========================================
    // 섹션 2: 프리마켓 스캐너
    // ========================================
    const PM_MIN=3, PM_MAX=15;

    async function loadPremarketScanner() {
        const grid = document.getElementById('premarketGrid');
        if (!grid) return;
        const fallback = ['NVDA','TSLA','AMD','AAPL','META','AMZN','SPY','QQQ','MSFT','GOOGL',
            'NFLX','BAC','F','PLTR','SOFI','MARA','COIN','RIVN','NIO','ARM','MU','INTC','SMCI','UBER','SNAP'];
        const syms = (top100Cache['most_actives']?.items?.slice(0,50).map(q=>q.symbol) || fallback).join(',');
        try {
            const data = await fetchRace(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}`,8000);
            const quotes = data?.quoteResponse?.result || [];
            const mktState = quotes[0]?.marketState || 'UNKNOWN';
            const filtered = quotes
                .filter(q => { const p=q.preMarketChangePercent; return p!=null && p>=PM_MIN && p<=PM_MAX; })
                .sort((a,b)=>b.preMarketChangePercent-a.preMarketChangePercent).slice(0,5);
            renderPremarketScanner(filtered, mktState);
        } catch(e) { renderPremarketScanner([], 'UNKNOWN'); }
    }

    function renderPremarketScanner(stocks, mktState) {
        const grid = document.getElementById('premarketGrid');
        const timeEl = document.getElementById('premarketTime');
        if (!grid) return;
        const isPre = mktState==='PRE'||mktState==='PREPRE';
        if (!isPre && stocks.length===0) {
            const label = mktState==='REGULAR'?'정규장 진행 중':mktState==='POST'||mktState==='POSTPOST'?'애프터마켓 진행 중':'프리마켓 대기';
            grid.innerHTML=`<div class="scanner-placeholder"><div class="sp-icon">${mktState==='REGULAR'?'🟢':'🌙'}</div>
                <div class="sp-title">${label}</div>
                <div class="sp-sub">프리마켓(장 시작 전)에 갭상승 주도주가 표시됩니다</div></div>`;
            return;
        }
        if (stocks.length===0) {
            grid.innerHTML=`<div class="scanner-placeholder"><div class="sp-icon">🔍</div>
                <div class="sp-title">조건 충족 종목 없음</div>
                <div class="sp-sub">갭상승 +${PM_MIN}% 이상 종목 없음</div></div>`; return;
        }
        if (timeEl) { const n=new Date(); timeEl.textContent=`${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')} 기준`; }

        grid.innerHTML = stocks.map(q => {
            const sym=q.symbol, name=q.shortName||q.longName||sym;
            const price=q.preMarketPrice??q.regularMarketPrice;
            const pct=q.preMarketChangePercent, regPrice=q.regularMarketPrice;
            const lo=q.fiftyTwoWeekLow, hi=q.fiftyTwoWeekHigh;
            const rr = (hi&&price&&hi>price) ? ((hi-price)/(price*0.05)).toFixed(1) : null;
            const pos = (lo&&hi&&hi!==lo) ? Math.min(100,Math.max(0,(price-lo)/(hi-lo)*100)) : null;
            const safe=sym.replace(/'/g,"\\'");
            return `<div class="scanner-card" onclick="quickSearch('${safe}','US')">
                <div class="scanner-badge gap-up">🔥 갭상승 ${pct>=0?'+':''}${pct.toFixed(2)}%</div>
                <div class="scanner-symbol">${sym}</div>
                <div class="scanner-name">${name}</div>
                <div class="scanner-price">${price!=null?'$'+price.toFixed(2):'—'}</div>
                <div class="scanner-meta-row"><span>정규장가</span><span class="scanner-meta-val">${regPrice!=null?'$'+regPrice.toFixed(2):'—'}</span></div>
                <div class="scanner-rr"><span>AI 기대 손익비</span><span class="scanner-rr-val">${rr?'1:'+rr:'—'}</span></div>
                ${pos!=null?`<div class="pb-wrap"><div class="pb-label"><span>52W 저 $${lo?.toFixed(0)}</span><span>고 $${hi?.toFixed(0)}</span></div>
                    <div class="pb-track"><div class="pb-fill" style="width:100%"></div>
                    <div class="pb-marker" style="left:${pos.toFixed(1)}%"></div></div></div>`:''}
                <button class="scanner-btn" onclick="event.stopPropagation();quickSearch('${safe}','US')">AI 분석 →</button>
            </div>`;
        }).join('');
    }

    // ========================================
    // 섹션 3: 스윙 R/R 타점 레이더
    // ========================================
    function loadSwingRadar() {
        const items = top100Cache['day_gainers']?.items;
        if (!items?.length) {
            const listEl = document.getElementById('swingRadarList');
            if (listEl && !listEl.querySelector('.swing-row')) {
                listEl.innerHTML = '<div class="swing-empty" style="font-size:12px;color:var(--text3);padding:12px 0">로딩 중...</div>';
            }
            return;
        }
        renderSwingRadar(items);
    }

    function renderSwingRadar(items) {
        const listEl=document.getElementById('swingRadarList');
        const subEl=document.getElementById('swingRadarSub');
        if (!listEl) return;
        const qualified = items.map(q=>{
            const p=q.regularMarketPrice, h=q.fiftyTwoWeekHigh;
            if (!p||!h||h<=p) return null;
            const rr=(h-p)/(p*0.05);
            return rr>=1.5 ? {...q,_rr:rr} : null;
        }).filter(Boolean).sort((a,b)=>b._rr-a._rr).slice(0,8);

        if (subEl) subEl.textContent=`상승률 TOP 기준 · ${qualified.length}개 종목`;
        if (!qualified.length) { listEl.innerHTML='<div class="swing-empty">현재 R/R ≥ 1.5 조건 종목 없음</div>'; return; }

        listEl.innerHTML = qualified.map(q=>{
            const cls=q.regularMarketChangePercent>0?'up':q.regularMarketChangePercent<0?'down':'flat';
            const chg=`${q.regularMarketChangePercent>=0?'+':''}${q.regularMarketChangePercent?.toFixed(2)}%`;
            const rrCls=q._rr>=3?'excellent':q._rr>=2?'good':'ok';
            const safe=(q.symbol||'').replace(/'/g,"\\'");
            return `<div class="swing-row" onclick="quickSearch('${safe}','US')">
                ${_tickerLogoHTML(q.symbol,'US')}
                <div class="swing-info"><div class="swing-symbol">${escHtml(q.symbol||'')}</div>
                    <div class="swing-name">${escHtml(q.shortName||q.symbol||'')}</div></div>
                <div class="swing-price">$${q.regularMarketPrice?.toFixed(2)}</div>
                <div class="swing-chg ${cls}">${chg}</div>
                <div class="rr-badge ${rrCls}">1:${q._rr.toFixed(1)}</div>
                <button class="swing-ai-btn" onclick="event.stopPropagation();quickSearch('${safe}','US')">AI 분석 보기</button>
            </div>`;
        }).join('');
    }

    // ========================================
    // 섹션 4: 최근 본 종목 + 변동성 경보
    // ========================================
    const RECENT_KEY='stockai_recent', RECENT_MAX=10;

    function saveRecentStock(sym,name,price,chg,market){
        try{
            let r=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');
            r=r.filter(x=>!(x.symbol===sym&&x.market===market));
            r.unshift({symbol:sym,name,price,change:chg,market,ts:Date.now()});
            localStorage.setItem(RECENT_KEY,JSON.stringify(r.slice(0,RECENT_MAX)));
        }catch(e){}
    }

    // ========================================
    // 섹션2: 시장 온도계 (S&P500 + 나스닥 + VIX)
    // ========================================
    // ── 시장 티커 (토스증권 스타일) ────────────────────────────────
    const THERMO_SYMS = [
        {key:'^GSPC', label:'S&P 500',        kind:'idx'},
        {key:'^IXIC', label:'나스닥',         kind:'idx'},
        {key:'NQ=F',  label:'나스닥 100 선물', kind:'idx'},
        {key:'^DJI',  label:'다우존스',       kind:'idx'},
        {key:'KRW=X', label:'달러환율',       kind:'fx'},
        {key:'^VIX',  label:'VIX',            kind:'vix'},
    ];

    function _fmtThermoPrice(v, kind){
        if (v == null || !isFinite(v)) return '-';
        if (kind === 'vix') return v.toFixed(1);
        if (kind === 'fx')  return v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
        return v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    }
    function _fmtThermoChg(abs, pct, kind){
        if (abs == null || !isFinite(abs)) return '-';
        const sA = abs >= 0 ? '+' : '';
        const sP = pct >= 0 ? '+' : '';
        const absStr = kind === 'vix' ? abs.toFixed(2) : Math.abs(abs) >= 100 ? abs.toFixed(1) : abs.toFixed(2);
        if (pct == null || !isFinite(pct)) return `${sA}${absStr}`;
        return `${sA}${absStr} (${sP}${pct.toFixed(2)}%)`;
    }
    function _thermoSpark(canvas, closes, isUp){
        if (!canvas || !closes || closes.length < 2) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth || parseInt(canvas.getAttribute('width'))||52;
        const cssH = canvas.clientHeight || parseInt(canvas.getAttribute('height'))||28;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0,0,cssW,cssH);
        const min = Math.min(...closes), max = Math.max(...closes);
        const range = max - min || 1;
        const padY = 3;
        const plotH = cssH - padY*2;
        ctx.beginPath();
        closes.forEach((v,i)=>{
            const x = (i/(closes.length-1)) * cssW;
            const y = padY + (1 - (v - min)/range) * plotH;
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        // fill 영역
        ctx.lineTo(cssW, cssH);
        ctx.lineTo(0, cssH);
        ctx.closePath();
        const color = isUp ? 'rgba(0,128,251,' : 'rgba(255,69,58,';
        const grad = ctx.createLinearGradient(0,0,0,cssH);
        grad.addColorStop(0, color+'.22)');
        grad.addColorStop(1, color+'0)');
        ctx.fillStyle = grad;
        ctx.fill();
        // 선
        ctx.beginPath();
        closes.forEach((v,i)=>{
            const x = (i/(closes.length-1)) * cssW;
            const y = padY + (1 - (v - min)/range) * plotH;
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        ctx.strokeStyle = isUp ? 'rgb(34,197,94)' : 'rgb(239,68,68)';
        ctx.lineWidth = 1.4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    async function loadMarketThermometer() {
        const el = document.getElementById('marketThermometer');
        if (!el) return;

        const symsQS = encodeURIComponent(THERMO_SYMS.map(s=>s.key).join(','));
        const quoteP = fetchRace(`/api/quote?symbols=${symsQS}`, 5000);
        const chartPs = THERMO_SYMS.map(s =>
            fetchRace(`/api/chart/${encodeURIComponent(s.key)}?interval=5m&range=1d`, 5000)
                .catch(()=>null)
        );
        const [quoteRes, ...chartRes] = await Promise.all([
            quoteP.catch(()=>null),
            ...chartPs.map(p => p.catch(()=>null))
        ]);

        const quoteArr = quoteRes?.quoteResponse?.result || [];
        const bySym = {};
        quoteArr.forEach(q => { if (q?.symbol) bySym[q.symbol] = q; });

        if (!Object.keys(bySym).length) return;

        // HTML 카드 생성
        const cards = THERMO_SYMS.map((s, i) => {
            const q = bySym[s.key];
            const price = q?.regularMarketPrice;
            const chgAbs = q?.regularMarketChange;
            const chgPct = q?.regularMarketChangePercent;
            const isUp = (chgAbs ?? 0) >= 0;
            const chgCls = chgAbs == null ? 'flat' : chgAbs > 0 ? 'up' : chgAbs < 0 ? 'down' : 'flat';
            const priceStr = _fmtThermoPrice(price, s.kind);
            const chgStr = _fmtThermoChg(chgAbs, chgPct, s.kind);
            const safeLabel = s.label.replace(/&/g,'&amp;');
            const aria = `${s.label} ${priceStr} ${chgStr}`.replace(/"/g,'&quot;');
            const safeKey = s.key.replace(/'/g,"\\'");
            return `<button class="thermo-card" type="button" onclick="quickSearch('${safeKey}','US')" aria-label="${aria}" data-idx="${i}">
                <canvas class="thermo-spark" width="52" height="28" aria-hidden="true"></canvas>
                <div class="thermo-card-body">
                    <div class="thermo-card-name">${safeLabel}</div>
                    <div class="thermo-card-price">${priceStr}</div>
                    <div class="thermo-card-chg ${chgCls}">${chgStr}</div>
                </div>
            </button>`;
        }).join('');

        el.innerHTML = `<div class="thermo-ticker" role="list">${cards}</div>`;
        el.style.display = '';

        // 스파크라인 그리기 (각 chartRes 와 카드 매칭)
        const canvases = el.querySelectorAll('.thermo-spark');
        const _sparkDataMap = {};
        THERMO_SYMS.forEach((s, i) => {
            const cv = canvases[i];
            if (!cv) return;
            const chart = chartRes[i];
            const closes = (chart?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
            _sparkDataMap[s.key] = closes;
            if (closes.length < 2) return;
            const q = bySym[s.key];
            const isUp = (q?.regularMarketChange ?? 0) >= 0;
            _thermoSpark(cv, closes, isUp);
        });

        // 레이더 대시보드용 전역 노출
        window._thermoBySymbol = bySym;
        window._thermoSparkMap = _sparkDataMap;
        // 레이더 시장 컨텍스트 업데이트 트리거
        if (typeof updateMktCtx === 'function') updateMktCtx();
    }

    // renderAIRecommend / loadAIRecommend / renderAIRecommendCards / openAIRecModal /
    // closeAIRecModal / _aiRecBuyList — v530 에서 제거됨.
    // 사유: 홈 AI 추천 섹션이 [DISABLED] 주석 처리되어 영구 비활성,
    //       서버 /api/ai-recommend, /api/hot-stocks 도 함께 제거.
    //       (loadHotStocks 류는 이전 커밋 v529 에서 정리)

    function loadRecentStocks(){
        const wrap=document.getElementById('recentWrap');
        const sec=document.getElementById('recentSection');
        if(!wrap||!sec) return;
        sec.style.display='none'; // 홈에서 최근 본 종목 숨김
        let r=[]; try{r=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');}catch(e){}
        if(!r.length) return;
        wrap.innerHTML=r.map(x=>{
            const chgNum=Number(x.change||0);
            const cls=chgNum>0?'up':chgNum<0?'down':'flat';
            const safe=(x.symbol||'').replace(/'/g,"\\'");
            const mkt=(x.market||'').replace(/'/g,"\\'");
            return `<div class="recent-chip" onclick="quickSearch('${safe}','${mkt}')">
                <div class="recent-chip-sym">${x.symbol}</div>
                <div class="recent-chip-chg ${cls}">${chgNum>=0?'+':''}${chgNum.toFixed(2)}%</div>
            </div>`;
        }).join('');
    }

    const VOL_WL=['NVDA','TSLA','AMD','AAPL','META','AMZN','SPY','QQQ'];
    async function loadVolAlert(){
        const listEl=document.getElementById('volAlertList');
        if(!listEl) return;
        try{
            const data=await fetchRace(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(VOL_WL.join(','))}`,8000);
            const quotes=data?.quoteResponse?.result||[];
            const alerts=quotes.filter(q=>{
                const v=q.regularMarketVolume, a=q.averageDailyVolume10Day, p=Math.abs(q.regularMarketChangePercent||0);
                return v&&a&&a>0 && v/a>=2 && p>=3;
            }).map(q=>({symbol:q.symbol,mult:(q.regularMarketVolume/q.averageDailyVolume10Day),vol:q.regularMarketVolume,chg:q.regularMarketChangePercent}))
                .sort((a,b)=>b.mult-a.mult).slice(0,4);
            const fmtV=v=>v>=1e9?(v/1e9).toFixed(1)+'B':v>=1e6?(v/1e6).toFixed(1)+'M':(v/1e3).toFixed(0)+'K';
            const subEl=document.getElementById('volAlertSub');
            if(subEl){const n=new Date();subEl.textContent=`${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')} 기준`;}
            if(!alerts.length){listEl.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px 0">현재 변동성 경보 없음</div>';return;}
            listEl.innerHTML=alerts.map(a=>{
                const safe=a.symbol.replace(/'/g,"\\'");
                return `<div class="vol-alert-row" onclick="quickSearch('${safe}','US')">
                    <div class="vol-alert-sym">${a.symbol}</div>
                    <div class="vol-alert-desc">오늘 거래량 ${a.mult.toFixed(1)}배 급증 <span style="color:var(--text3)">(${fmtV(a.vol)})</span></div>
                    <div class="vol-alert-badge">변동성 경보</div>
                </div>`;
            }).join('');
        }catch(e){if(listEl)listEl.innerHTML='';}
    }

    // 저장된 차트 설정으로 버튼 active 상태 초기화
    document.querySelectorAll('.range-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.range === currentPeriod));
    document.querySelectorAll('.interval-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.interval === currentInterval));
    // 분봉 드롭다운 초기 라벨 동기화
    {
        const ddBtn   = document.getElementById('intervalDdBtn');
        const ddLabel = document.getElementById('intervalDdLabel');
        if (ddLabel && ddBtn) {
            const isMin = /m$/.test(currentInterval) || currentInterval === '1h';
            if (isMin) {
                ddLabel.textContent = INTERVAL_LABELS[currentInterval] || currentInterval;
                ddBtn.classList.add('active');
            } else {
                ddLabel.textContent = '분봉';
                ddBtn.classList.remove('active');
            }
        }
        document.querySelectorAll('.interval-dd-item').forEach(b =>
            b.classList.toggle('active', b.dataset.interval === currentInterval));
    }

    let _earnHomeCache = null; // 호출 전에 선언 필요 (TDZ 방지)

    // ── 알파홈 상태 변수 — loadAlphaHomePreview() 호출 전에 선언 필요 (TDZ 방지) ──
    let _alphaHomeTab   = 'bounce';
    let _alphaHomeCache = {};                 // { [tab]: { items, ts } }
    let _alphaHomeRetry = {};                 // { [tab]: retryCount }
    const _ALPHA_HOME_TTL = 5 * 60 * 1000;   // 5분 캐시

    // 페이지 로드 시 즉시 실행 (TOP100은 메뉴에서만 로드)
    loadPremarketScanner();
    loadSwingRadar();
    loadRecentStocks();
    // loadSocialHot / loadOptionsPopular → app.js 정의, DOMContentLoaded 후 app.js에서 호출
    if (typeof loadSocialHot === 'function') loadSocialHot();
    loadVolAlert();
    loadMarketThermometer();
    // loadAIRecommend / loadHotStocks — v530에서 완전 제거됨
    loadGuruHome();
    loadEarnHome();
    if (typeof loadOptionsPopular === 'function') loadOptionsPopular();
    loadAlphaHomePreview();

    // ────────────────────────────────────────────────────────────
    // 화면 이력 — 종목 상세 → 뒤로가기 시 직전 화면(실적·골라보기·기관 등) 복귀용
    // 기본값 'home'. 각 goXxx() 진입 시 자기 식별자로 갱신.
    // 종목 상세(searchStock) 는 _lastScreen 을 건드리지 않음 → 뒤로가기 시 직전 목록 화면으로.
    // ────────────────────────────────────────────────────────────
    window._lastScreen = window._lastScreen || 'home';
    // ── 종목 페이지 스크롤 시 상단바에 종목명·금액·퍼센트 노출 (v703) ──
    //   스크롤 전: 상단바 종목 표시 숨김 / Hero 가격을 지나치면 컴팩트 표시
    function _syncHeaderStock() {
        const pEl = document.getElementById('hdrStkPrice');
        const cEl = document.getElementById('hdrStkChg');
        if (!pEl || !cEl) return;
        const hp = document.getElementById('stockPrice');
        const hc = document.getElementById('stockChange');
        if (hp) pEl.textContent = hp.textContent.trim();
        if (hc) {
            const m = hc.textContent.match(/[+-]?[\d.]+%/);
            const dir = hc.classList.contains('up') ? 'up'
                      : hc.classList.contains('down') ? 'down' : 'flat';
            const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
            cEl.textContent = m ? `${arrow}${m[0].replace(/^[+-]/, '')}` : '';
            cEl.className = 'hdr-stk-chg ' + dir;
        }
    }
    function _updateHeaderStockOnScroll() {
        const hdr = document.getElementById('mainHeader');
        if (!hdr) return;
        // 탭바(.tab-nav)가 상단 고정 바 바로 아래에 붙도록 바 높이를 CSS 변수로 노출
        //   모바일: .header 전체가 sticky → #mainHeader 높이
        //   데스크탑: 내부 .header-top 만 fixed 바 → .header-top 높이 (사이 벌어짐 방지)
        const _ht = hdr.querySelector('.header-top');
        let _barH = hdr.offsetHeight;
        if (_ht && getComputedStyle(_ht).position === 'fixed') _barH = _ht.offsetHeight;
        if (_barH) document.documentElement.style.setProperty('--hdr-h', _barH + 'px');
        if (!hdr.classList.contains('stock-loaded')) { hdr.classList.remove('header--show-stock'); return; }
        const hero = document.getElementById('stockPrice');
        // Hero 가격이 헤더 아래로 가려지면(=스크롤 내림) 컴팩트 표시
        const hdrH = hdr.offsetHeight || 60;
        const scrolledPast = hero
            ? hero.getBoundingClientRect().bottom < hdrH
            : (window.scrollY || 0) > 130;
        hdr.classList.toggle('header--show-stock', scrolledPast);
        if (scrolledPast) _syncHeaderStock();
    }
    document.addEventListener('scroll', _updateHeaderStockOnScroll, { passive: true, capture: true });
    window.addEventListener('scroll', _updateHeaderStockOnScroll, { passive: true });
    window.addEventListener('resize', _updateHeaderStockOnScroll, { passive: true });

    function goBack() {
        const dest = window._lastScreen || 'home';
        const map = {
            earnings:      goEarnings,
            position:      goMyPosition,
            smartMoney:    goSmartMoney,
            visionScanner: goVisionScanner,
            economic:      goEconomic,
            scanner:       goScanner,
            fav:           goFav,
            top100:        goTop100,
            catalyst:      goCatalyst,
            dailyTrading:  goDailyTrading,
            leverage:      goLeverage,
        };
        const fn = map[dest];
        if (typeof fn === 'function') fn();
        else goHome();
    }

    function goFav() {
        window._lastScreen = 'fav';
        const _t = document.getElementById('marketThermometer');
        if (_t) _t.style.display = 'none';
        const _q = document.getElementById('headerQNav');
        if (_q) _q.style.display = '';
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('smartMoneyScreen').style.display = 'none';
        document.getElementById('alphaScannerScreen').style.display = 'none';
        document.getElementById('visionScannerScreen').style.display = 'none';
        const _ern3 = document.getElementById('earningsScreen'); if (_ern3) _ern3.style.display = 'none';
        const _lev3 = document.getElementById('leverageScreen'); if (_lev3) _lev3.style.display = 'none';
        const _t100F = document.getElementById('top100Screen'); if (_t100F) _t100F.style.display = 'none';
        const _catF  = document.getElementById('catalystScreen'); if (_catF) _catF.style.display = 'none';
        document.getElementById('favScreen').style.display = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded'); const _fab=document.getElementById('calcFab'); if(_fab)_fab.style.display='none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        updateBnActive('fav');
        renderFavList();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function goHome() {
        window._lastScreen = 'home';
        // URL 정리하되 Clerk 인증 핸드셰이크 파라미터(__clerk_db_jwt 등)는 보존
        // → 안 그러면 dev 인스턴스 배포 도메인에서 세션이 새로고침 시 풀림
        try {
            const u = new URL(location.href);
            const keep = [...u.searchParams].filter(([k]) =>
                k.startsWith('__clerk') || k.startsWith('__dev') || k === '__session');
            const qs = keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
            history.replaceState({ view: 'home' }, '', qs ? ('/?' + qs) : '/');
        } catch (_) {
            history.replaceState({ view: 'home' }, '', '/');
        }
        const _t = document.getElementById('marketThermometer');
        if (_t && _t.innerHTML.trim()) _t.style.display = '';
        const _q = document.getElementById('headerQNav');
        if (_q) _q.style.display = '';
        document.getElementById('welcomeScreen').style.display = '';
        document.getElementById('smartMoneyScreen').style.display = 'none';
        document.getElementById('alphaScannerScreen').style.display = 'none';
        document.getElementById('favScreen').style.display = 'none';
        document.getElementById('visionScannerScreen').style.display = 'none';
        document.getElementById('economicSection').style.display = 'none';
        document.getElementById('mainContent').style.display = 'none';
        const _t100 = document.getElementById('top100Screen'); if (_t100) _t100.style.display = 'none';
        const _catH = document.getElementById('catalystScreen'); if (_catH) _catH.style.display = 'none';
        const _dtsH = document.getElementById('dailyTradingScreen'); if (_dtsH) _dtsH.style.display = 'none';
        const _ernH = document.getElementById('earningsScreen'); if (_ernH) _ernH.style.display = 'none';
        const _levH = document.getElementById('leverageScreen'); if (_levH) _levH.style.display = 'none';
        const _posH = document.getElementById('positionScreen'); if (_posH) _posH.style.display = 'none';
        const _profH = document.getElementById('profileScreen'); if (_profH) _profH.style.display = 'none';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded'); const _fab=document.getElementById('calcFab'); if(_fab)_fab.style.display='none';
        document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelector('.side-nav-item[onclick^="goHome"]')?.classList.add('active');
        document.querySelectorAll('.hqnav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('hqHome')?.classList.add('active');
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.getElementById('marketSessionInfo').classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        destroyChart();
        clearAllDrawings();
        document.getElementById('searchInput').value = '';
        currentSymbol = '';
        currentFullSymbol = '';
        stockData = null;
        stopLiveUpdate();
        stopAnalysisRefresh();
        stopChartSigPoll();
        stopAlpacaWS();
        // top100은 메뉴에서만 로드 (홈에서 제거)
        if (typeof hideStockPager === 'function') hideStockPager();
        loadRecentStocks();
        loadSwingRadar();
        loadSocialHot();
        loadMarketThermometer();
        // (loadAIRecommend / loadHotStocks — v530 완전 제거)
        loadGuruHome();
        loadEarnHome();
        // 홈 화면 진입 시 알파 스캐너 로드
        if (typeof loadAlphaHomePreview === 'function') {
            loadAlphaHomePreview();
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ========================================

    // Smart Money Tracker
    // ========================================
    let pendingSmartMoneyLine = null;
    let smCurrentFilter = 'all';

    // ===== 🔥 폼 미친 기관들 — 수익률 HIGH 퍼포머 (Q1 2026) =====
    const SM_HOT = [
        {
            id:'coatue', name:'Coatue Management', manager:'Philippe Laffont',
            ret1q:-6.2, ret1y:13.9, newBuySector:'AI 인프라·반도체 장비',
            hotBadge:'🔬', emoji:'🔬',
            tags:['기술성장','AI인프라','반도체장비'],
            volatilePicks:['ASML','AMAT','GEV'],
            top3Add:[
                {ticker:'ASML',name:'ASML Holding',wtChg:+4.8,avgPrice:682.40,theme:'AI 반도체 장비 독점 — DeepSeek 이후 수혜'},
                {ticker:'NFLX',name:'Netflix Inc',wtChg:+4.2,avgPrice:952.60,theme:'AI 콘텐츠 추천·광고 플랫폼 성장'},
                {ticker:'AMAT',name:'Applied Materials',wtChg:+4.5,avgPrice:168.40,theme:'AI 칩 제조 장비 수요 구조적 증가'},
            ],
            holdings:[
                {ticker:'TSM',name:'Taiwan Semiconductor',wt:7.0,wtChg:+2.8,avgPrice:186.40,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:6.5,wtChg:+2.4,avgPrice:412.60,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:6.0,wtChg:+1.8,avgPrice:198.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:6.5,wtChg:-1.2,avgPrice:558.20,action:'reduce'},
                {ticker:'GEV',name:'GE Vernova',wt:5.7,wtChg:+2.6,avgPrice:342.60,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:5.5,wtChg:+1.8,avgPrice:168.40,action:'add'},
                {ticker:'CEG',name:'Constellation Energy',wt:5.2,wtChg:+0.8,avgPrice:282.40,action:'hold'},
                {ticker:'ASML',name:'ASML Holding',wt:4.8,wtChg:+4.8,avgPrice:682.40,action:'new'},
                {ticker:'AMAT',name:'Applied Materials',wt:4.5,wtChg:+4.5,avgPrice:168.40,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:4.2,wtChg:+4.2,avgPrice:952.60,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.0,wtChg:-1.8,avgPrice:188.40,action:'reduce'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.8,wtChg:-2.6,avgPrice:112.40,action:'reduce'},
                {ticker:'DASH',name:'DoorDash Inc',wt:3.5,wtChg:+3.5,avgPrice:182.40,action:'add'},
                {ticker:'SPOT',name:'Spotify Technology',wt:3.2,wtChg:+3.2,avgPrice:642.40,action:'add'},
                {ticker:'NU',name:'Nu Holdings',wt:2.8,wtChg:+2.0,avgPrice:14.60,action:'add'},
            ],
            insight:'라폰트는 Q1 2026 DeepSeek 충격 이후 AI 하드웨어(NVDA·AVGO) 비중을 축소하고 반도체 장비(ASML·AMAT)와 AI 인프라 전력(GEV·CEG)으로 로테이션. NFLX·SPOT·DASH 소비자 AI 플랫폼 대규모 매수. 전략 핵심: "AI 칩 수요는 효율화되지만 장비·전력·네트워크 수요는 구조적".'
        },
        {
            id:'sachem', name:'Sachem Head Capital', manager:'Scott Ferguson',
            ret1q:3.8, ret1y:20.4, newBuySector:'이벤트드리븐·위성·에너지',
            hotBadge:'⚡', emoji:'🎯',
            tags:['행동주의','이벤트드리븐','특수상황'],
            volatilePicks:['SATS','CVNA','LYV'],
            top3Add:[
                {ticker:'SATS',name:'EchoStar Corp',wtChg:+13.7,avgPrice:28.40,theme:'위성통신 구조적 전환 — 행동주의 집중 포지션'},
                {ticker:'CVNA',name:'Carvana Co',wtChg:+6.4,avgPrice:248.60,theme:'중고차 대출·AI 플랫폼 회복 베팅'},
                {ticker:'LYV',name:'Live Nation Entertainment',wtChg:+4.2,avgPrice:126.40,theme:'라이브 이벤트 구조적 성장 + M&A 후보'},
            ],
            holdings:[
                {ticker:'SATS',name:'EchoStar Corp',wt:13.7,wtChg:+13.7,avgPrice:28.40,action:'new'},
                {ticker:'TLN',name:'Talen Energy',wt:9.0,wtChg:+3.2,avgPrice:168.40,action:'add'},
                {ticker:'TWLO',name:'Twilio Inc',wt:7.9,wtChg:-1.8,avgPrice:72.40,action:'reduce'},
                {ticker:'GDS',name:'GDS Holdings',wt:7.8,wtChg:+7.8,avgPrice:22.40,action:'add'},
                {ticker:'PFGC',name:'Performance Food Group',wt:7.3,wtChg:0,avgPrice:68.40,action:'hold'},
                {ticker:'COHR',name:'Coherent Corp',wt:7.2,wtChg:-1.4,avgPrice:68.40,action:'reduce'},
                {ticker:'CVNA',name:'Carvana Co',wt:6.4,wtChg:+6.4,avgPrice:248.60,action:'new'},
                {ticker:'WBD',name:'Warner Bros Discovery',wt:5.6,wtChg:+2.4,avgPrice:12.40,action:'add'},
                {ticker:'DKS',name:"Dick's Sporting Goods",wt:5.8,wtChg:+2.8,avgPrice:188.40,action:'add'},
                {ticker:'ADMA',name:'ADMA Biologics',wt:5.0,wtChg:+2.2,avgPrice:22.40,action:'add'},
                {ticker:'SHC',name:'Sotera Health',wt:5.0,wtChg:+2.6,avgPrice:18.40,action:'add'},
                {ticker:'LYV',name:'Live Nation Entertainment',wt:4.2,wtChg:+4.2,avgPrice:126.40,action:'new'},
                {ticker:'CVS',name:'CVS Health Corp',wt:4.9,wtChg:-1.2,avgPrice:52.40,action:'reduce'},
                {ticker:'HUT',name:'Hut 8 Corp',wt:3.1,wtChg:+3.1,avgPrice:18.40,action:'new'},
                {ticker:'NSC',name:'Norfolk Southern',wt:3.6,wtChg:+3.6,avgPrice:228.40,action:'new'},
            ],
            insight:'Q1 2026 사켐헤드는 행동주의 이벤트드리븐 전략으로 기술 폭락을 방어했습니다. SATS(EchoStar) 신규 대량 포지션은 위성통신 구조조정 베팅. CVNA는 중고차 플랫폼 회복, LYV는 라이브 이벤트 구조적 성장 테제. 에너지 인프라(TLN) 추가로 AI 데이터센터 전력 테마에도 노출.'
        },
        {
            id:'darsana', name:'Darsana Capital Partners', manager:'Anand Desai',
            ret1q:-4.2, ret1y:9.6, newBuySector:'SaaS·헬스케어·AI 인프라',
            hotBadge:'💎', emoji:'🧿',
            tags:['이벤트드리븐','SaaS','헬스케어'],
            volatilePicks:['GWRE','VRT','SHC'],
            top3Add:[
                {ticker:'GWRE',name:'Guidewire Software',wtChg:+5.2,avgPrice:188.40,theme:'보험 SaaS AI화 — 구독 전환 가속'},
                {ticker:'VRT',name:'Vertiv Holdings',wtChg:+4.8,avgPrice:112.40,theme:'AI 데이터센터 냉각·전력 인프라'},
                {ticker:'WMG',name:'Warner Music Group',wtChg:+3.6,avgPrice:32.40,theme:'AI 저작권 수익화 프리미엄'},
            ],
            holdings:[
                {ticker:'SATS',name:'EchoStar Corp',wt:15.1,wtChg:-1.8,avgPrice:28.40,action:'reduce'},
                {ticker:'NYT',name:'New York Times',wt:10.6,wtChg:-2.4,avgPrice:52.40,action:'reduce'},
                {ticker:'GWRE',name:'Guidewire Software',wt:10.0,wtChg:+5.2,avgPrice:188.40,action:'add'},
                {ticker:'HCA',name:'HCA Healthcare',wt:9.3,wtChg:0,avgPrice:338.40,action:'hold'},
                {ticker:'SHC',name:'Sotera Health',wt:9.1,wtChg:+3.8,avgPrice:18.40,action:'add'},
                {ticker:'FWONK',name:'Liberty Formula One',wt:7.0,wtChg:+2.6,avgPrice:82.40,action:'add'},
                {ticker:'TDG',name:'TransDigm Group',wt:5.3,wtChg:0,avgPrice:1342.40,action:'hold'},
                {ticker:'WMG',name:'Warner Music Group',wt:4.9,wtChg:+3.6,avgPrice:32.40,action:'add'},
                {ticker:'VRT',name:'Vertiv Holdings',wt:4.8,wtChg:+4.8,avgPrice:112.40,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:4.2,wtChg:+0.8,avgPrice:198.40,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.8,wtChg:+0.6,avgPrice:412.40,action:'hold'},
                {ticker:'NFLX',name:'Netflix Inc',wt:3.4,wtChg:+0.4,avgPrice:952.40,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:3.2,wtChg:-0.8,avgPrice:558.40,action:'reduce'},
                {ticker:'UBER',name:'Uber Technologies',wt:2.8,wtChg:+0.4,avgPrice:74.40,action:'hold'},
                {ticker:'GEV',name:'GE Vernova',wt:2.4,wtChg:+2.4,avgPrice:342.40,action:'new'},
            ],
            insight:'다르사나는 Q1 2026 기술 폭락장에서 헬스케어(HCA·SHC)와 이벤트드리븐(SATS·NYT) 포지션 덕분에 상대적 방어. GWRE는 보험사 AI·클라우드 전환 수요로 구조적 성장, VRT는 AI 데이터센터 전력 인프라 수혜. 조용한 집중투자 스타일 유지.'
        },
        {
            id:'altimeter', name:'Altimeter Capital', manager:'Brad Gerstner',
            ret1q:-8.4, ret1y:16.8, newBuySector:'클라우드 AI',
            hotBadge:'🌟', emoji:'🛸',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Brad_Gerstner_at_the_White_House_2025_%2854581192563%29.jpg/100px-Brad_Gerstner_at_the_White_House_2025_%2854581192563%29.jpg',
            tags:['클라우드','AI','성장주'],
            volatilePicks:['IONQ','PLTR','APP'],
            top3Add:[
                {ticker:'IONQ',name:'IonQ Inc',wtChg:+7.8,avgPrice:31.20,theme:'양자 클라우드 B2B'},
                {ticker:'PLTR',name:'Palantir Technologies',wtChg:+6.4,avgPrice:88.40,theme:'AI 정부·엔터프라이즈'},
                {ticker:'APP',name:'Applovin Corp',wtChg:+4.8,avgPrice:318.60,theme:'모바일 AI 광고 독보적 성장'},
            ],
            holdings:[
                {ticker:'SNOW',name:'Snowflake Inc',wt:16.4,wtChg:-1.2,avgPrice:162.80,action:'hold'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:12.8,wtChg:+6.4,avgPrice:88.40,action:'add'},
                {ticker:'IONQ',name:'IonQ Inc',wt:7.8,wtChg:+7.8,avgPrice:31.20,action:'new'},
                {ticker:'APP',name:'Applovin Corp',wt:8.4,wtChg:+4.8,avgPrice:318.60,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:11.2,wtChg:+0.6,avgPrice:196.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:9.6,wtChg:+1.4,avgPrice:542.80,action:'add'},
                {ticker:'UBER',name:'Uber Technologies',wt:5.8,wtChg:-2.1,avgPrice:72.40,action:'reduce'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:10.4,wtChg:+2.4,avgPrice:124.20,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:7.8,wtChg:+0.6,avgPrice:421.20,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:6.4,wtChg:+0.8,avgPrice:172.20,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.8,wtChg:+1.4,avgPrice:226.60,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:4.2,wtChg:+2.0,avgPrice:366.40,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:3.6,wtChg:+0.4,avgPrice:962.80,action:'hold'},
                {ticker:'RDDT',name:'Reddit Inc',wt:3.0,wtChg:+3.0,avgPrice:146.80,action:'new'},
                {ticker:'NET',name:'Cloudflare Inc',wt:2.6,wtChg:+1.8,avgPrice:98.40,action:'add'},
            ],
            insight:'알티미터는 IONQ 신규 편입으로 양자컴퓨팅 베타를 포트폴리오에 추가. PLTR을 대폭 확대하며 AI 소프트웨어 실적 가속에 베팅. 대표적인 AI 강세론자(Brad Gerstner)답게 클라우드+AI 전체 체인에 투자 집중.'
        },
        {
            id:'iconiq', name:'ICONIQ Growth', manager:'Will Griffith',
            ret1q:-9.2, ret1y:14.6, newBuySector:'핀테크·AI 인프라',
            hotBadge:'💰', emoji:'🦅',
            tags:['성장주','핀테크','B2B SaaS'],
            volatilePicks:['HIMS','RDDT','NVTS'],
            top3Add:[
                {ticker:'HIMS',name:'Hims & Hers Health',wtChg:+8.6,avgPrice:21.40,theme:'구독형 헬스케어 혁신'},
                {ticker:'RDDT',name:'Reddit Inc',wtChg:+5.2,avgPrice:144.60,theme:'소셜·AI 데이터 하이브리드'},
                {ticker:'NVTS',name:'Navitas Semiconductor',wtChg:+4.6,avgPrice:4.80,theme:'GaN 전력반도체 성장'},
            ],
            holdings:[
                {ticker:'HIMS',name:'Hims & Hers Health',wt:8.6,wtChg:+8.6,avgPrice:21.40,action:'new'},
                {ticker:'RDDT',name:'Reddit Inc',wt:5.2,wtChg:+5.2,avgPrice:144.60,action:'new'},
                {ticker:'NVTS',name:'Navitas Semiconductor',wt:4.6,wtChg:+4.6,avgPrice:4.80,action:'new'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:16.8,wtChg:+3.6,avgPrice:128.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:12.4,wtChg:+1.8,avgPrice:544.20,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:10.6,wtChg:-0.8,avgPrice:422.80,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:8.4,wtChg:+0.4,avgPrice:194.60,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:7.2,wtChg:+0.8,avgPrice:171.40,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:5.4,wtChg:+1.6,avgPrice:225.80,action:'add'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:4.8,wtChg:+2.4,avgPrice:85.60,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:4.0,wtChg:+1.4,avgPrice:363.60,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:3.6,wtChg:+3.6,avgPrice:310.40,action:'new'},
                {ticker:'NET',name:'Cloudflare Inc',wt:3.0,wtChg:+1.2,avgPrice:97.60,action:'add'},
                {ticker:'SHOP',name:'Shopify Inc',wt:2.6,wtChg:-1.2,avgPrice:110.80,action:'reduce'},
                {ticker:'COIN',name:'Coinbase Global',wt:2.2,wtChg:+2.2,avgPrice:248.60,action:'new'},
            ],
            insight:'아이코닉그로스는 Q1 2026에 HIMS·RDDT·NVTS 트리플 신규 편입. 공통 테마는 "AI가 변화시키는 전통 산업". HIMS는 AI 기반 처방, RDDT는 AI 데이터, NVTS는 AI 파워 효율화. 섹터 윤전 없는 AI 일괄 베팅.'
        },
        {
            id:'greenlight', name:'Greenlight Capital', manager:'David Einhorn',
            ret1q:+5.8, ret1y:12.4, newBuySector:'특수상황·밸류',
            hotBadge:'🌿', emoji:'🎲',
            tags:['가치투자','숏셀링','역발상'],
            volatilePicks:['QBTS','HIMS'],
            top3Add:[
                {ticker:'QBTS',name:'D-Wave Quantum',wtChg:+6.8,avgPrice:9.20,theme:'양자컴퓨팅 역발상 롱'},
                {ticker:'HIMS',name:'Hims & Hers Health',wtChg:+4.4,avgPrice:25.80,theme:'GLP-1 밸류 미스프라이싱'},
                {ticker:'OXY',name:'Occidental Petroleum',wtChg:+3.8,avgPrice:48.60,theme:'에너지 구조적 공급 부족'},
            ],
            holdings:[
                {ticker:'QBTS',name:'D-Wave Quantum',wt:6.8,wtChg:+6.8,avgPrice:9.20,action:'new'},
                {ticker:'HIMS',name:'Hims & Hers Health',wt:4.4,wtChg:+4.4,avgPrice:25.80,action:'new'},
                {ticker:'OXY',name:'Occidental Petroleum',wt:8.4,wtChg:+3.8,avgPrice:48.60,action:'add'},
                {ticker:'CNX',name:'CNX Resources',wt:7.2,wtChg:+1.4,avgPrice:26.80,action:'add'},
                {ticker:'GOLD',name:'Barrick Gold',wt:6.8,wtChg:+2.1,avgPrice:18.40,action:'add'},
                {ticker:'NCLH',name:'Norwegian Cruise Line',wt:5.6,wtChg:-1.8,avgPrice:18.20,action:'reduce'},
                {ticker:'HUN',name:'Huntsman Corp',wt:4.2,wtChg:+0.6,avgPrice:14.60,action:'hold'},
                {ticker:'VLO',name:'Valero Energy',wt:5.8,wtChg:+1.8,avgPrice:148.20,action:'add'},
                {ticker:'SLB',name:'SLB (Schlumberger)',wt:4.6,wtChg:+0.8,avgPrice:42.60,action:'hold'},
                {ticker:'FCX',name:'Freeport-McMoRan',wt:4.0,wtChg:+2.2,avgPrice:44.80,action:'add'},
                {ticker:'CVX',name:'Chevron Corp',wt:5.2,wtChg:-0.6,avgPrice:144.20,action:'hold'},
                {ticker:'BTI',name:'British American Tobacco',wt:3.8,wtChg:+0.8,avgPrice:36.40,action:'hold'},
                {ticker:'VALE',name:'Vale SA',wt:3.2,wtChg:+1.4,avgPrice:12.80,action:'add'},
                {ticker:'DVN',name:'Devon Energy',wt:2.8,wtChg:-0.4,avgPrice:38.60,action:'reduce'},
                {ticker:'TECK',name:'Teck Resources',wt:2.4,wtChg:+0.6,avgPrice:48.20,action:'hold'},
            ],
            insight:'아인혼은 역발상 스타일 그대로 QBTS를 "과매도 후 반등 베팅"으로 매수. HIMS는 시장이 GLP-1 경쟁 심화를 과대 반영해 저평가됐다는 판단. 에너지·귀금속 헷지 포지션도 꾸준히 확대 중.'
        },
        {
            id:'pelham', name:'Pelham Capital', manager:'Ross Turner',
            ret1q:-3.4, ret1y:10.8, newBuySector:'바이오·혁신의료',
            hotBadge:'🧬', emoji:'🔭',
            tags:['바이오','헬스케어','성장'],
            volatilePicks:['HIMS','NVTS'],
            top3Add:[
                {ticker:'HIMS',name:'Hims & Hers Health',wtChg:+9.4,avgPrice:20.80,theme:'GLP-1 처방 플랫폼 독보적'},
                {ticker:'NVTS',name:'Navitas Semiconductor',wtChg:+5.6,avgPrice:4.60,theme:'AI 데이터센터 전력효율'},
                {ticker:'RDDT',name:'Reddit Inc',wtChg:+4.2,avgPrice:146.80,theme:'밀레니얼 미디어 성장'},
            ],
            holdings:[
                {ticker:'HIMS',name:'Hims & Hers Health',wt:9.4,wtChg:+9.4,avgPrice:20.80,action:'new'},
                {ticker:'NVTS',name:'Navitas Semiconductor',wt:5.6,wtChg:+5.6,avgPrice:4.60,action:'new'},
                {ticker:'RDDT',name:'Reddit Inc',wt:4.2,wtChg:+4.2,avgPrice:146.80,action:'new'},
                {ticker:'LLY',name:'Eli Lilly',wt:14.8,wtChg:+2.4,avgPrice:812.60,action:'add'},
                {ticker:'ABBV',name:'AbbVie Inc',wt:8.6,wtChg:+1.2,avgPrice:184.20,action:'add'},
                {ticker:'ISRG',name:'Intuitive Surgical',wt:7.4,wtChg:+0.6,avgPrice:502.40,action:'hold'},
                {ticker:'DXCM',name:'DexCom Inc',wt:5.2,wtChg:-2.4,avgPrice:78.60,action:'reduce'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:8.2,wtChg:+0.8,avgPrice:524.40,action:'hold'},
                {ticker:'REGN',name:'Regeneron Pharma',wt:6.4,wtChg:+1.4,avgPrice:1032.40,action:'add'},
                {ticker:'VRTX',name:'Vertex Pharma',wt:5.8,wtChg:+0.6,avgPrice:468.20,action:'hold'},
                {ticker:'MRNA',name:'Moderna Inc',wt:3.4,wtChg:+3.4,avgPrice:68.40,action:'new'},
                {ticker:'TMO',name:'Thermo Fisher Scientific',wt:4.6,wtChg:+0.4,avgPrice:612.80,action:'hold'},
                {ticker:'BSX',name:'Boston Scientific',wt:3.8,wtChg:+1.2,avgPrice:92.60,action:'add'},
                {ticker:'MDT',name:'Medtronic',wt:2.8,wtChg:-0.6,avgPrice:82.40,action:'reduce'},
                {ticker:'PFE',name:'Pfizer Inc',wt:2.4,wtChg:+0.4,avgPrice:26.80,action:'hold'},
            ],
            insight:'펠햄은 헬스케어 포트폴리오에 AI 요소를 추가했습니다. HIMS는 GLP-1 처방 D2C 플랫폼으로 LLY와 시너지 기대. NVTS는 의료기기·데이터센터 전력 효율화 수혜. RDDT 신규는 헬스케어 데이터 커뮤니티 프리미엄 베팅.'
        },
        {
            id:'viking', name:'Viking Global Investors', manager:'Andreas Halvorsen',
            ret1q:-5.8, ret1y:11.6, newBuySector:'AI·반도체',
            hotBadge:'⚔️', emoji:'🛡️',
            logo_url:'https://logo.clearbit.com/vikingglobal.com',
            tags:['롱숏','글로벌','리서치기반'],
            volatilePicks:['IONQ','APP','RDDT'],
            top3Add:[
                {ticker:'IONQ',name:'IonQ Inc',wtChg:+6.2,avgPrice:29.80,theme:'양자컴퓨팅 선점 투자'},
                {ticker:'APP',name:'Applovin Corp',wtChg:+5.4,avgPrice:306.40,theme:'모바일 AI 광고 독점'},
                {ticker:'RDDT',name:'Reddit Inc',wtChg:+4.8,avgPrice:150.20,theme:'AI 데이터 허브 프리미엄'},
            ],
            holdings:[
                {ticker:'IONQ',name:'IonQ Inc',wt:6.2,wtChg:+6.2,avgPrice:29.80,action:'new'},
                {ticker:'APP',name:'Applovin Corp',wt:9.8,wtChg:+5.4,avgPrice:306.40,action:'add'},
                {ticker:'RDDT',name:'Reddit Inc',wt:4.8,wtChg:+4.8,avgPrice:150.20,action:'new'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:15.4,wtChg:+2.2,avgPrice:122.80,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:8.6,wtChg:+1.8,avgPrice:224.60,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:7.4,wtChg:-0.6,avgPrice:418.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:6.8,wtChg:+0.4,avgPrice:192.60,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:8.4,wtChg:+1.8,avgPrice:544.40,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:6.2,wtChg:+0.8,avgPrice:171.80,action:'add'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:5.4,wtChg:+2.8,avgPrice:85.20,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:4.6,wtChg:+1.6,avgPrice:364.60,action:'add'},
                {ticker:'NET',name:'Cloudflare Inc',wt:3.8,wtChg:+1.2,avgPrice:97.40,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:3.2,wtChg:+0.4,avgPrice:966.80,action:'hold'},
                {ticker:'AAPL',name:'Apple Inc',wt:5.0,wtChg:-0.6,avgPrice:183.40,action:'hold'},
                {ticker:'UBER',name:'Uber Technologies',wt:2.8,wtChg:-1.2,avgPrice:72.80,action:'reduce'},
            ],
            insight:'바이킹은 퀄리티 롱숏 스타일을 유지하면서 양자컴퓨팅(IONQ)과 AI 광고(APP) 두 테마를 신규 편입. NVDA·AVGO·AMZN 기존 AI 포지션을 유지하면서 "2세대 AI 수혜주"로 포트폴리오 다각화.'
        },
        {
            id:'longpine', name:'Long Pine Capital', manager:'Steve Mandel Jr.',
            ret1q:-10.2, ret1y:8.8, newBuySector:'AI 소비재·미디어',
            hotBadge:'🌲', emoji:'🦌',
            tags:['성장주','집중투자','롱온리'],
            volatilePicks:['APP','RDDT','HIMS'],
            top3Add:[
                {ticker:'APP',name:'Applovin Corp',wtChg:+7.6,avgPrice:302.80,theme:'AI 광고 ROI 압도적'},
                {ticker:'RDDT',name:'Reddit Inc',wtChg:+5.8,avgPrice:148.40,theme:'Gen Z 미디어 플랫폼'},
                {ticker:'HIMS',name:'Hims & Hers Health',wtChg:+4.8,avgPrice:21.80,theme:'처방의약 D2C 성장'},
            ],
            holdings:[
                {ticker:'APP',name:'Applovin Corp',wt:13.4,wtChg:+7.6,avgPrice:302.80,action:'add'},
                {ticker:'RDDT',name:'Reddit Inc',wt:5.8,wtChg:+5.8,avgPrice:148.40,action:'new'},
                {ticker:'HIMS',name:'Hims & Hers Health',wt:4.8,wtChg:+4.8,avgPrice:21.80,action:'new'},
                {ticker:'NFLX',name:'Netflix Inc',wt:11.2,wtChg:+1.4,avgPrice:968.40,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:9.8,wtChg:+0.8,avgPrice:196.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:14.6,wtChg:+3.2,avgPrice:126.40,action:'add'},
                {ticker:'SHOP',name:'Shopify Inc',wt:5.4,wtChg:-1.6,avgPrice:92.40,action:'reduce'},
                {ticker:'META',name:'Meta Platforms',wt:9.2,wtChg:+1.4,avgPrice:543.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:6.8,wtChg:+0.6,avgPrice:170.80,action:'hold'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:5.6,wtChg:+2.6,avgPrice:84.80,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.8,wtChg:+1.2,avgPrice:223.60,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:4.0,wtChg:+1.4,avgPrice:365.40,action:'add'},
                {ticker:'ANET',name:'Arista Networks',wt:3.4,wtChg:+0.6,avgPrice:385.60,action:'hold'},
                {ticker:'ABNB',name:'Airbnb Inc',wt:2.8,wtChg:+0.8,avgPrice:144.20,action:'add'},
                {ticker:'DDOG',name:'Datadog Inc',wt:2.4,wtChg:+1.2,avgPrice:140.40,action:'add'},
            ],
            insight:'롱파인은 AI 광고 플랫폼 APP에 적극 베팅하면서 동시에 RDDT·HIMS 등 2025년 새롭게 부각된 성장 스토리를 신규 편입. 스티브 만델의 롱온리 고집식 집중 포트폴리오 스타일이 AI 테마와 정확히 맞아떨어졌습니다.'
        },
        {
            id:'whalerock', name:'Whale Rock Capital', manager:'Alex Sacerdote',
            ret1q:-11.8, ret1y:6.4, newBuySector:'클라우드·AI SaaS',
            hotBadge:'🐳', emoji:'☁️',
            tags:['클라우드','SaaS','AI인프라'],
            volatilePicks:['SNOW','DDOG','NET'],
            top3Add:[
                {ticker:'DDOG',name:'Datadog Inc',wtChg:+7.2,avgPrice:138.60,theme:'AI 옵저버빌리티 1등주'},
                {ticker:'NET',name:'Cloudflare Inc',wtChg:+5.8,avgPrice:96.40,theme:'AI 엣지 네트워크 확장'},
                {ticker:'SNOW',name:'Snowflake Inc',wtChg:+4.6,avgPrice:172.80,theme:'AI 데이터 클라우드 회복'},
            ],
            holdings:[
                {ticker:'DDOG',name:'Datadog Inc',wt:14.2,wtChg:+7.2,avgPrice:138.60,action:'add'},
                {ticker:'NET',name:'Cloudflare Inc',wt:11.8,wtChg:+5.8,avgPrice:96.40,action:'add'},
                {ticker:'SNOW',name:'Snowflake Inc',wt:9.6,wtChg:+4.6,avgPrice:172.80,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:8.4,wtChg:+2.2,avgPrice:368.20,action:'add'},
                {ticker:'HUBS',name:'HubSpot Inc',wt:6.2,wtChg:-1.4,avgPrice:648.40,action:'reduce'},
                {ticker:'MDB',name:'MongoDB Inc',wt:5.8,wtChg:+1.8,avgPrice:342.60,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:7.4,wtChg:+1.6,avgPrice:122.60,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:5.6,wtChg:+0.4,avgPrice:419.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:4.8,wtChg:+0.6,avgPrice:193.60,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:4.2,wtChg:+0.4,avgPrice:170.20,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:5.4,wtChg:+1.2,avgPrice:542.40,action:'add'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:3.6,wtChg:+2.4,avgPrice:83.80,action:'add'},
                {ticker:'ZS',name:'Zscaler Inc',wt:4.0,wtChg:+3.2,avgPrice:190.20,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:3.2,wtChg:+3.2,avgPrice:308.20,action:'new'},
                {ticker:'TSLA',name:'Tesla Inc',wt:2.6,wtChg:+0.6,avgPrice:233.60,action:'add'},
            ],
            insight:'웨일록은 AI가 가속화하는 클라우드 인프라 수요에 집중 베팅. DDOG·NET·CRWD 트리오로 AI 시대 보안+모니터링+엣지 삼각편대 구축. SNOW는 AI 데이터 파이프라인 회복 신호에 추가 매수.'
        },
        {
            id:'lightstreet', name:'Light Street Capital', manager:'Glen Kacher',
            ret1q:-9.6, ret1y:7.2, newBuySector:'AI·양자·차세대반도체',
            hotBadge:'💡', emoji:'🔦',
            tags:['AI성장','집중투자','테크모멘텀'],
            volatilePicks:['IONQ','PLTR','CRWD'],
            top3Add:[
                {ticker:'IONQ',name:'IonQ Inc',wtChg:+6.4,avgPrice:27.60,theme:'양자컴퓨팅 상업화 가속'},
                {ticker:'PLTR',name:'Palantir Technologies',wtChg:+5.2,avgPrice:83.40,theme:'AI 플랫폼 정부+민간 수주'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wtChg:+4.8,avgPrice:364.80,theme:'AI 사이버보안 마켓리더'},
            ],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:16.8,wtChg:+3.4,avgPrice:124.60,action:'add'},
                {ticker:'IONQ',name:'IonQ Inc',wt:6.4,wtChg:+6.4,avgPrice:27.60,action:'new'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:9.2,wtChg:+5.2,avgPrice:83.40,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:7.8,wtChg:+4.8,avgPrice:364.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:11.4,wtChg:+2.6,avgPrice:546.20,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:5.6,wtChg:-3.2,avgPrice:286.40,action:'reduce'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:8.6,wtChg:+0.8,avgPrice:418.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:6.4,wtChg:+0.6,avgPrice:192.40,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:5.8,wtChg:+0.8,avgPrice:171.20,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.6,wtChg:+1.4,avgPrice:224.20,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:4.0,wtChg:+4.0,avgPrice:306.40,action:'new'},
                {ticker:'ANET',name:'Arista Networks',wt:3.6,wtChg:+0.8,avgPrice:384.40,action:'add'},
                {ticker:'SNOW',name:'Snowflake Inc',wt:3.0,wtChg:+1.6,avgPrice:168.60,action:'add'},
                {ticker:'DDOG',name:'Datadog Inc',wt:2.8,wtChg:+1.2,avgPrice:138.20,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:2.4,wtChg:+0.4,avgPrice:964.60,action:'hold'},
            ],
            insight:'라이트스트리트는 AI 혁명의 최전선에서 NVDA+PLTR+META 삼각편대를 유지하면서 IONQ로 양자컴퓨팅 선점에 나섰습니다. CRWD 추가는 AI 시대 사이버보안 필수 인프라 논리.'
        },
        {
            id:'d1capital', name:'D1 Capital Partners', manager:'Daniel Sundheim',
            ret1q:-6.4, ret1y:8.8, newBuySector:'소비자테크·핀테크',
            hotBadge:'💼', emoji:'🎪',
            tags:['소비자테크','핀테크','글로벌성장'],
            volatilePicks:['UBER','ABNB','DASH'],
            top3Add:[
                {ticker:'UBER',name:'Uber Technologies',wtChg:+6.8,avgPrice:72.40,theme:'AI 모빌리티 플랫폼 확장'},
                {ticker:'DASH',name:'DoorDash Inc',wtChg:+5.4,avgPrice:178.60,theme:'배달·퀵커머스 글로벌화'},
                {ticker:'ABNB',name:'Airbnb Inc',wtChg:+4.2,avgPrice:142.80,theme:'경험 소비 회복 트렌드'},
            ],
            holdings:[
                {ticker:'UBER',name:'Uber Technologies',wt:12.6,wtChg:+6.8,avgPrice:72.40,action:'add'},
                {ticker:'DASH',name:'DoorDash Inc',wt:8.4,wtChg:+5.4,avgPrice:178.60,action:'add'},
                {ticker:'ABNB',name:'Airbnb Inc',wt:7.2,wtChg:+4.2,avgPrice:142.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:14.8,wtChg:+2.8,avgPrice:122.40,action:'add'},
                {ticker:'SHOP',name:'Shopify Inc',wt:6.4,wtChg:+1.6,avgPrice:112.60,action:'add'},
                {ticker:'PYPL',name:'PayPal Holdings',wt:4.8,wtChg:-2.4,avgPrice:68.20,action:'reduce'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:7.8,wtChg:+0.6,avgPrice:420.40,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:6.2,wtChg:+0.8,avgPrice:186.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:5.4,wtChg:+1.2,avgPrice:195.20,action:'add'},
                {ticker:'SQ',name:'Block Inc',wt:3.8,wtChg:+2.4,avgPrice:68.60,action:'add'},
                {ticker:'LYFT',name:'Lyft Inc',wt:3.2,wtChg:+1.8,avgPrice:14.80,action:'add'},
                {ticker:'COIN',name:'Coinbase Global',wt:3.0,wtChg:+3.0,avgPrice:218.40,action:'new'},
                {ticker:'APP',name:'Applovin Corp',wt:2.8,wtChg:+2.8,avgPrice:308.60,action:'new'},
                {ticker:'AFRM',name:'Affirm Holdings',wt:2.4,wtChg:+1.6,avgPrice:52.40,action:'add'},
                {ticker:'RBLX',name:'Roblox Corp',wt:2.0,wtChg:+0.8,avgPrice:46.20,action:'hold'},
            ],
            insight:'D1캐피탈은 소비자 플랫폼의 AI화에 집중 투자. UBER는 자율주행 로보택시 전환 스토리, DASH는 퀵커머스 AI 물류 혁신. 다니엘 선하임의 롱/숏 혼합 전략이 변동성 장세에서 빛을 발했습니다.'
        },
        {
            id:'dragoneer', name:'Dragoneer Investment Group', manager:'Marc Stad',
            ret1q:-12.4, ret1y:5.6, newBuySector:'하이퍼성장 SaaS',
            hotBadge:'🐉', emoji:'🚁',
            tags:['하이퍼성장','SaaS','장기투자'],
            volatilePicks:['SNOW','MDB','ZS'],
            top3Add:[
                {ticker:'ZS',name:'Zscaler Inc',wtChg:+7.6,avgPrice:188.40,theme:'AI 제로트러스트 보안 리더'},
                {ticker:'MDB',name:'MongoDB Inc',wtChg:+5.8,avgPrice:338.60,theme:'AI 앱 개발 DB 플랫폼'},
                {ticker:'SNOW',name:'Snowflake Inc',wtChg:+4.4,avgPrice:168.20,theme:'멀티클라우드 AI 데이터레이크'},
            ],
            holdings:[
                {ticker:'SNOW',name:'Snowflake Inc',wt:13.4,wtChg:+4.4,avgPrice:168.20,action:'add'},
                {ticker:'MDB',name:'MongoDB Inc',wt:9.8,wtChg:+5.8,avgPrice:338.60,action:'add'},
                {ticker:'ZS',name:'Zscaler Inc',wt:8.6,wtChg:+7.6,avgPrice:188.40,action:'add'},
                {ticker:'DDOG',name:'Datadog Inc',wt:7.2,wtChg:+2.4,avgPrice:136.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:12.4,wtChg:+3.6,avgPrice:120.80,action:'add'},
                {ticker:'TWLO',name:'Twilio Inc',wt:4.2,wtChg:-3.8,avgPrice:68.40,action:'reduce'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:7.4,wtChg:+0.6,avgPrice:421.20,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:5.8,wtChg:+0.8,avgPrice:541.80,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:5.2,wtChg:+1.0,avgPrice:194.60,action:'add'},
                {ticker:'CRM',name:'Salesforce Inc',wt:4.4,wtChg:+1.8,avgPrice:298.60,action:'add'},
                {ticker:'NOW',name:'ServiceNow Inc',wt:4.0,wtChg:+2.4,avgPrice:976.40,action:'add'},
                {ticker:'TTD',name:'The Trade Desk',wt:3.4,wtChg:+1.6,avgPrice:86.40,action:'add'},
                {ticker:'HUBS',name:'HubSpot Inc',wt:3.0,wtChg:+1.2,avgPrice:678.40,action:'add'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:2.6,wtChg:+2.6,avgPrice:84.20,action:'new'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.2,wtChg:+0.4,avgPrice:169.40,action:'add'},
            ],
            insight:'드래고니어는 SaaS 플랫폼들의 AI 수익화 전환을 조기에 포착한 펀드. ZS·SNOW·MDB 모두 AI 워크로드 수요 증가로 직접 수혜. 장기 집중 홀딩 전략이 SaaS 반등장에서 알파 창출.'
        },
        {
            id:'lonepine2', name:'Lone Pine Capital', manager:'Mala Gaonkar',
            ret1q:-7.8, ret1y:9.4, newBuySector:'글로벌 AI·반도체',
            hotBadge:'🌲', emoji:'🦅',
            tags:['글로벌성장','반도체','AI플랫폼'],
            volatilePicks:['TSM','ASML','NVDA'],
            top3Add:[
                {ticker:'TSM',name:'TSMC ADR',wtChg:+8.2,avgPrice:168.40,theme:'AI 반도체 파운드리 독점'},
                {ticker:'ASML',name:'ASML Holding',wtChg:+5.6,avgPrice:728.60,theme:'EUV 리소그래피 독점 공급'},
                {ticker:'NVDA',name:'NVIDIA Corp',wtChg:+4.8,avgPrice:124.20,theme:'AI 가속칩 생태계 지배'},
            ],
            holdings:[
                {ticker:'TSM',name:'TSMC ADR',wt:11.6,wtChg:+8.2,avgPrice:168.40,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:15.8,wtChg:+4.8,avgPrice:124.20,action:'add'},
                {ticker:'ASML',name:'ASML Holding',wt:8.4,wtChg:+5.6,avgPrice:728.60,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:10.2,wtChg:+2.4,avgPrice:544.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:9.6,wtChg:+1.8,avgPrice:188.60,action:'add'},
                {ticker:'BABA',name:'Alibaba Group',wt:4.2,wtChg:-4.2,avgPrice:82.40,action:'sell'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:7.8,wtChg:+0.6,avgPrice:422.40,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:6.4,wtChg:+1.8,avgPrice:226.40,action:'add'},
                {ticker:'AMAT',name:'Applied Materials',wt:5.2,wtChg:+1.4,avgPrice:186.40,action:'add'},
                {ticker:'LRCX',name:'Lam Research',wt:4.8,wtChg:+1.2,avgPrice:784.60,action:'add'},
                {ticker:'MU',name:'Micron Technology',wt:4.2,wtChg:+2.0,avgPrice:106.80,action:'add'},
                {ticker:'AMD',name:'Advanced Micro Devices',wt:3.8,wtChg:+1.6,avgPrice:118.60,action:'add'},
                {ticker:'QCOM',name:'Qualcomm Inc',wt:3.2,wtChg:+0.8,avgPrice:162.40,action:'hold'},
                {ticker:'ARM',name:'Arm Holdings',wt:2.8,wtChg:+2.8,avgPrice:148.60,action:'new'},
                {ticker:'INTC',name:'Intel Corp',wt:2.0,wtChg:-2.0,avgPrice:24.60,action:'reduce'},
            ],
            holdings_insight:'롱파인(말라 가온카 체제)은 반도체 공급망 전체를 커버하는 포트폴리오 구축. TSM+ASML+NVDA로 AI칩 생산→설비→설계 삼각편대. 중국 노출(BABA) 완전 축소.'
        },
        {
            id:'maverick', name:'Maverick Capital', manager:'Lee Ainslie',
            ret1q:-5.2, ret1y:10.2, newBuySector:'빅테크 AI 전환',
            hotBadge:'🤠', emoji:'🏇',
            tags:['빅테크','가치성장','글로벌롱숏'],
            volatilePicks:['META','GOOGL','AMZN'],
            top3Add:[
                {ticker:'META',name:'Meta Platforms',wtChg:+6.4,avgPrice:542.80,theme:'AI 광고·메타버스 이중 성장'},
                {ticker:'GOOGL',name:'Alphabet Inc',wtChg:+4.8,avgPrice:186.40,theme:'AI 검색+클라우드 복합 성장'},
                {ticker:'AMZN',name:'Amazon.com Inc',wtChg:+3.6,avgPrice:196.80,theme:'AWS AI 클라우드 점유율 확대'},
            ],
            holdings:[
                {ticker:'META',name:'Meta Platforms',wt:14.6,wtChg:+6.4,avgPrice:542.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:12.2,wtChg:+4.8,avgPrice:186.40,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:11.8,wtChg:+3.6,avgPrice:196.80,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:10.4,wtChg:+2.2,avgPrice:420.60,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:9.8,wtChg:+4.2,avgPrice:122.80,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:6.4,wtChg:+1.8,avgPrice:968.40,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:7.2,wtChg:+0.4,avgPrice:224.60,action:'hold'},
                {ticker:'TSLA',name:'Tesla Inc',wt:5.4,wtChg:+1.2,avgPrice:290.40,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.8,wtChg:+1.6,avgPrice:225.40,action:'add'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:4.2,wtChg:+0.8,avgPrice:238.60,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:3.8,wtChg:+0.6,avgPrice:326.40,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:3.4,wtChg:+0.4,avgPrice:548.60,action:'hold'},
                {ticker:'HD',name:'Home Depot Inc',wt:2.8,wtChg:-0.6,avgPrice:396.40,action:'reduce'},
                {ticker:'DIS',name:'Walt Disney Co',wt:2.4,wtChg:+1.0,avgPrice:116.40,action:'add'},
                {ticker:'COST',name:'Costco Wholesale',wt:2.0,wtChg:+0.4,avgPrice:946.40,action:'hold'},
            ],
            insight:'매버릭은 빅테크 AI 전환 스토리의 순수 수혜를 포착했습니다. META·GOOGL·AMZN·MSFT 모두 AI 수익화 가속 단계. 리 에인슬리의 롱숏 전략이 빅테크 모멘텀에서 시스테마틱 알파 창출.'
        },
        {
            id:'twosigma', name:'Two Sigma Investments', manager:'John Overdeck',
            ret1q:-6.8, ret1y:8.4, newBuySector:'퀀트 AI·데이터 인프라',
            hotBadge:'📊', emoji:'🤖',
            tags:['퀀트','AI시스템','데이터드리븐'],
            volatilePicks:['NVDA','MSFT','AMZN'],
            top3Add:[
                {ticker:'NVDA',name:'NVIDIA Corp',wtChg:+4.6,avgPrice:118.80,theme:'AI 가속 컴퓨팅 인프라'},
                {ticker:'MSFT',name:'Microsoft Corp',wtChg:+3.8,avgPrice:416.40,theme:'AI 클라우드 플랫폼 독주'},
                {ticker:'AMZN',name:'Amazon.com Inc',wtChg:+3.2,avgPrice:194.80,theme:'AWS AI 서비스 고성장'},
            ],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:9.8,wtChg:+4.6,avgPrice:118.80,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:8.6,wtChg:+3.8,avgPrice:416.40,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:7.4,wtChg:+3.2,avgPrice:194.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:6.8,wtChg:+2.6,avgPrice:184.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:6.2,wtChg:+2.2,avgPrice:540.60,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:5.4,wtChg:-1.8,avgPrice:184.40,action:'reduce'},
                {ticker:'TSLA',name:'Tesla Inc',wt:4.8,wtChg:+0.8,avgPrice:288.40,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.2,wtChg:+1.2,avgPrice:223.40,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:3.8,wtChg:+0.8,avgPrice:966.40,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:3.4,wtChg:+0.6,avgPrice:236.40,action:'hold'},
                {ticker:'SPY',name:'SPDR S&P 500 ETF',wt:3.0,wtChg:+0.0,avgPrice:546.40,action:'hold'},
                {ticker:'QQQ',name:'Invesco QQQ Trust',wt:2.8,wtChg:+0.0,avgPrice:468.40,action:'hold'},
                {ticker:'VZ',name:'Verizon Communications',wt:2.4,wtChg:-0.4,avgPrice:41.20,action:'reduce'},
                {ticker:'T',name:'AT&T Inc',wt:2.0,wtChg:-0.2,avgPrice:21.80,action:'hold'},
                {ticker:'GLD',name:'SPDR Gold Shares ETF',wt:1.8,wtChg:+0.2,avgPrice:227.60,action:'add'},
            ],
            insight:'투시그마의 퀀트 모델은 AI 인프라 모멘텀을 조기 포착했습니다. 팩터 신호와 대안 데이터 결합으로 빅테크 AI 전환 수혜주에 집중. 시스테마틱 전략 특성상 분산도가 높으나 AI 테마 오버웨이트 뚜렷.'
        },
        {
            id:'point72', name:'Point72 Asset Management', manager:'Steve Cohen',
            ret1q:-2.8, ret1y:11.2, newBuySector:'AI헬스케어·바이오테크',
            hotBadge:'🎯', emoji:'🏙️',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Steve_baseball_4_%281%29_%28cropped%29.jpg/100px-Steve_baseball_4_%281%29_%28cropped%29.jpg',
            tags:['멀티스트래티지','바이오','AI헬스'],
            volatilePicks:['RDDT','IONQ','HIMS'],
            top3Add:[
                {ticker:'HIMS',name:'Hims & Hers Health',wtChg:+5.4,avgPrice:23.80,theme:'AI 개인화 헬스케어 플랫폼'},
                {ticker:'RDDT',name:'Reddit Inc',wtChg:+4.6,avgPrice:146.40,theme:'AI 데이터 라이선싱 수익'},
                {ticker:'IONQ',name:'IonQ Inc',wtChg:+4.2,avgPrice:26.60,theme:'양자컴퓨팅 헬스케어 응용'},
            ],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:11.4,wtChg:+3.2,avgPrice:118.40,action:'add'},
                {ticker:'HIMS',name:'Hims & Hers Health',wt:5.4,wtChg:+5.4,avgPrice:23.80,action:'new'},
                {ticker:'RDDT',name:'Reddit Inc',wt:4.6,wtChg:+4.6,avgPrice:146.40,action:'new'},
                {ticker:'IONQ',name:'IonQ Inc',wt:4.2,wtChg:+4.2,avgPrice:26.60,action:'new'},
                {ticker:'META',name:'Meta Platforms',wt:9.8,wtChg:+2.4,avgPrice:538.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:6.8,wtChg:+1.6,avgPrice:852.40,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:7.4,wtChg:+0.6,avgPrice:417.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:6.2,wtChg:+1.0,avgPrice:193.40,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:5.6,wtChg:+0.8,avgPrice:187.40,action:'add'},
                {ticker:'ABBV',name:'AbbVie Inc',wt:4.8,wtChg:+0.8,avgPrice:196.40,action:'hold'},
                {ticker:'NVO',name:'Novo Nordisk ADR',wt:4.2,wtChg:+0.6,avgPrice:72.40,action:'hold'},
                {ticker:'MRNA',name:'Moderna Inc',wt:3.4,wtChg:+1.8,avgPrice:38.60,action:'add'},
                {ticker:'DXCM',name:'DexCom Inc',wt:2.8,wtChg:+2.0,avgPrice:76.40,action:'add'},
                {ticker:'ISRG',name:'Intuitive Surgical',wt:2.4,wtChg:+0.6,avgPrice:518.40,action:'hold'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:2.0,wtChg:+1.2,avgPrice:366.40,action:'add'},
            ],
            insight:'포인트72는 멀티스트래티지 강점을 살려 AI헬스케어 신흥주(HIMS, IONQ)와 소셜 AI(RDDT)를 조기 편입. 스티브 코헨의 정보우위 네트워크가 소형 AI성장주 발굴에 기여.'
        },
        {
            id:'thirdpoint', name:'Third Point LLC', manager:'Dan Loeb',
            ret1q:+2.4, ret1y:9.6, newBuySector:'행동주의 AI전환',
            hotBadge:'⚖️', emoji:'🦁',
            tags:['행동주의','AI전환','가치창조'],
            volatilePicks:['META','GOOGL','AMZN'],
            top3Add:[
                {ticker:'GOOGL',name:'Alphabet Inc',wtChg:+6.2,avgPrice:182.80,theme:'AI 검색 방어+클라우드 성장'},
                {ticker:'META',name:'Meta Platforms',wtChg:+5.4,avgPrice:536.60,theme:'AI 인프라 투자 성과 가시화'},
                {ticker:'AMZN',name:'Amazon.com Inc',wtChg:+4.8,avgPrice:192.60,theme:'AWS AI 마진 확장 가속'},
            ],
            holdings:[
                {ticker:'GOOGL',name:'Alphabet Inc',wt:16.4,wtChg:+6.2,avgPrice:182.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:13.8,wtChg:+5.4,avgPrice:536.60,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:12.2,wtChg:+4.8,avgPrice:192.60,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:10.6,wtChg:+2.8,avgPrice:414.20,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:7.4,wtChg:+1.6,avgPrice:964.80,action:'add'},
                {ticker:'IAC',name:'IAC Inc',wt:3.2,wtChg:-4.8,avgPrice:48.60,action:'reduce'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:8.6,wtChg:+3.2,avgPrice:121.60,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:7.2,wtChg:+0.6,avgPrice:225.60,action:'hold'},
                {ticker:'TSLA',name:'Tesla Inc',wt:4.8,wtChg:+1.4,avgPrice:292.40,action:'add'},
                {ticker:'SPOT',name:'Spotify Technology',wt:3.8,wtChg:+0.6,avgPrice:432.40,action:'hold'},
                {ticker:'DIS',name:'Walt Disney Co',wt:3.4,wtChg:+2.4,avgPrice:117.40,action:'add'},
                {ticker:'PARA',name:'Paramount Global',wt:2.8,wtChg:+2.8,avgPrice:12.40,action:'new'},
                {ticker:'WBD',name:'Warner Bros Discovery',wt:2.4,wtChg:+1.6,avgPrice:9.60,action:'add'},
                {ticker:'FOX',name:'Fox Corp',wt:2.0,wtChg:+0.8,avgPrice:46.40,action:'add'},
                {ticker:'CMCSA',name:'Comcast Corp',wt:1.8,wtChg:-0.6,avgPrice:36.80,action:'reduce'},
            ],
            insight:'댄 로엡의 써드포인트는 행동주의 접근으로 GOOGL·META·AMZN의 AI 전환 속도를 가속화 압박. 구글에 AI 검색 수익화, 메타에 AI 광고 효율화 요구. AI 전환 압박 전략이 포트폴리오 알파로 직결.'
        },
        {
            id:'appaloosa', name:'Appaloosa Management', manager:'David Tepper',
            ret1q:-3.8, ret1y:8.2, newBuySector:'AI빅테크·방어주 혼합',
            hotBadge:'🦏', emoji:'🎰',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/David_Tepper_2013.jpg/100px-David_Tepper_2013.jpg',
            tags:['가치·성장','매크로','집중베팅'],
            volatilePicks:['NVDA','META','AMZN'],
            top3Add:[
                {ticker:'NVDA',name:'NVIDIA Corp',wtChg:+5.8,avgPrice:116.80,theme:'AI칩 독점 지속·마진 확대'},
                {ticker:'AMZN',name:'Amazon.com Inc',wtChg:+4.2,avgPrice:190.40,theme:'AWS AI·물류 자동화 이중 성장'},
                {ticker:'META',name:'Meta Platforms',wtChg:+3.6,avgPrice:534.20,theme:'AI 광고 ROI 격차 확대'},
            ],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:10.8,wtChg:+5.8,avgPrice:116.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:9.4,wtChg:+4.2,avgPrice:190.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:8.6,wtChg:+3.6,avgPrice:534.20,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:7.8,wtChg:+2.4,avgPrice:180.60,action:'add'},
                {ticker:'GS',name:'Goldman Sachs',wt:5.4,wtChg:+1.8,avgPrice:498.80,action:'add'},
                {ticker:'BAC',name:'Bank of America',wt:4.2,wtChg:-2.6,avgPrice:42.80,action:'reduce'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:7.6,wtChg:+1.2,avgPrice:419.40,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:5.8,wtChg:+2.4,avgPrice:291.40,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:5.2,wtChg:+0.4,avgPrice:223.40,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:4.8,wtChg:+1.4,avgPrice:237.60,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.2,wtChg:+1.6,avgPrice:224.60,action:'add'},
                {ticker:'SPY',name:'SPDR S&P 500 ETF',wt:3.6,wtChg:+0.2,avgPrice:547.40,action:'hold'},
                {ticker:'QQQ',name:'Invesco QQQ Trust',wt:3.0,wtChg:+0.4,avgPrice:469.40,action:'hold'},
                {ticker:'LQD',name:'iShares Corp Bond ETF',wt:2.4,wtChg:-0.2,avgPrice:108.60,action:'hold'},
                {ticker:'TLT',name:'iShares 20Y+ Treasury',wt:2.0,wtChg:-0.8,avgPrice:88.60,action:'reduce'},
            ],
            insight:'데이비드 테퍼는 "AI는 최대 투자 기회"라는 공개 발언대로 NVDA·AMZN·META를 집중 매수. 금융주 일부 축소로 AI 성장주 비중 확대. 매크로 전망과 AI 강세 시나리오의 결합.'
        },
        {
            id:'pershing', name:'Pershing Square Capital', manager:'Bill Ackman',
            ret1q:-16.2, ret1y:2.7, newBuySector:'클라우드 AI — MSFT 신규',
            hotBadge:'🎯', emoji:'🎯',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Bill_Ackman_2019.jpg/100px-Bill_Ackman_2019.jpg',
            tags:['집중투자','행동주의','대형주'],
            volatilePicks:['BN','UBER','QSR'],
            top3Add:[
                {ticker:'MSFT',name:'Microsoft Corp',wtChg:+15.3,avgPrice:408.40,theme:'Azure AI 수익화 — GOOGL 대체 대형 포지션'},
                {ticker:'AMZN',name:'Amazon.com',wtChg:+3.2,avgPrice:196.40,theme:'AWS AI 인프라 강세 확신 추가'},
                {ticker:'HHH',name:'Howard Hughes Holdings',wtChg:0,avgPrice:82.40,theme:'부동산 개발 장기 보유'},
            ],
            holdings:[
                {ticker:'BN',name:'Brookfield Corp',wt:17.6,wtChg:-2.8,avgPrice:62.40,action:'reduce'},
                {ticker:'AMZN',name:'Amazon.com',wt:17.4,wtChg:+3.2,avgPrice:196.40,action:'add'},
                {ticker:'UBER',name:'Uber Technologies',wt:15.7,wtChg:-0.8,avgPrice:74.40,action:'reduce'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:15.3,wtChg:+15.3,avgPrice:408.40,action:'new'},
                {ticker:'QSR',name:'Restaurant Brands Intl',wt:12.2,wtChg:-1.0,avgPrice:62.40,action:'reduce'},
                {ticker:'META',name:'Meta Platforms',wt:11.1,wtChg:-0.5,avgPrice:558.40,action:'reduce'},
                {ticker:'HHH',name:'Howard Hughes Holdings',wt:8.7,wtChg:0,avgPrice:82.40,action:'hold'},
                {ticker:'SEG',name:'Seaport Entertainment',wt:0.8,wtChg:0,avgPrice:12.40,action:'hold'},
                {ticker:'GOOG',name:'Alphabet C',wt:0.6,wtChg:-8.2,avgPrice:158.40,action:'cut'},
                {ticker:'HTZ',name:'Hertz Global Holdings',wt:0.5,wtChg:0,avgPrice:6.40,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet A',wt:0.1,wtChg:-6.8,avgPrice:158.40,action:'cut'},
            ],
            insight:'Q1 2026 퍼싱스퀘어 -16.2%로 최악의 분기. 핵심 변화는 MSFT 신규 $2.1B 매수와 GOOGL/GOOG 95% 이상 청산. 애크만 "Azure AI 수익화가 GOOGL보다 직접적·측정가능"으로 클라우드 AI 대형 포지션 전환. BN·QSR·UBER 부진이 손실 주도. 포트폴리오 집중도 극도로 높아 변동성 지속 예상.'
        },
        {
            id:'elliott', name:'Elliott Management', manager:'Paul Singer',
            ret1q:+1.8, ret1y:7.4, newBuySector:'행동주의·특수상황',
            hotBadge:'⚡', emoji:'🦅',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/The_Global_Financial_Context_Paul_Singer_%28cropped%29.jpg/100px-The_Global_Financial_Context_Paul_Singer_%28cropped%29.jpg',
            tags:['행동주의','특수상황','경영개입'],
            volatilePicks:['PINS','HPE','TXNM'],
            top3Add:[
                {ticker:'PINS',name:'Pinterest Inc',wtChg:+7.2,avgPrice:32.40,theme:'AI 비주얼 검색+광고 전환'},
                {ticker:'HPE',name:'HP Enterprise',wtChg:+5.6,avgPrice:18.80,theme:'AI 서버 수요 급증 수혜'},
                {ticker:'STLA',name:'Stellantis NV',wtChg:+4.8,avgPrice:14.60,theme:'경영진 교체 후 구조조정 수혜'},
            ],
            holdings:[
                {ticker:'PINS',name:'Pinterest Inc',wt:8.4,wtChg:+7.2,avgPrice:32.40,action:'add'},
                {ticker:'HPE',name:'HP Enterprise',wt:6.8,wtChg:+5.6,avgPrice:18.80,action:'add'},
                {ticker:'STLA',name:'Stellantis NV',wt:5.6,wtChg:+4.8,avgPrice:14.60,action:'add'},
                {ticker:'SWK',name:'Stanley Black & Decker',wt:7.2,wtChg:+2.4,avgPrice:78.80,action:'add'},
                {ticker:'AZO',name:'AutoZone Inc',wt:6.4,wtChg:+1.2,avgPrice:3128.40,action:'add'},
                {ticker:'NRG',name:'NRG Energy',wt:5.8,wtChg:-1.6,avgPrice:96.40,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:8.4,wtChg:+0.6,avgPrice:415.40,action:'hold'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:6.8,wtChg:+2.4,avgPrice:118.60,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:5.6,wtChg:+1.2,avgPrice:175.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:4.8,wtChg:+0.8,avgPrice:534.40,action:'hold'},
                {ticker:'T',name:'AT&T Inc',wt:4.2,wtChg:+2.8,avgPrice:22.40,action:'add'},
                {ticker:'CCI',name:'Crown Castle Inc',wt:3.6,wtChg:+1.6,avgPrice:102.40,action:'add'},
                {ticker:'AMT',name:'American Tower Corp',wt:3.0,wtChg:+0.8,avgPrice:208.40,action:'add'},
                {ticker:'TWTR',name:'X Corp / Twitter',wt:2.4,wtChg:-2.4,avgPrice:54.40,action:'sell'},
                {ticker:'IAG',name:'IAMGOLD Corp',wt:1.8,wtChg:+0.6,avgPrice:4.80,action:'add'},
            ],
            insight:'엘리엇 매니지먼트는 PINS 지분 확보 후 AI 광고 전략 전환 촉구로 주주가치 창출. HPE는 AI 서버 수요 증가의 직접 수혜주로 편입. 폴 싱어의 행동주의 압박이 경영 변화로 이어진 케이스 다수.'
        },
        {
            id:'baupost', name:'Baupost Group', manager:'Seth Klarman',
            ret1q:+3.2, ret1y:8.8, newBuySector:'딥밸류·특수상황',
            hotBadge:'💰', emoji:'📚',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Seth_Klarman_at_147th_Preakness_Stakes.jpg/100px-Seth_Klarman_at_147th_Preakness_Stakes.jpg',
            tags:['딥밸류','안전마진','인내심투자'],
            volatilePicks:['VIASP','PARA','DISCK'],
            top3Add:[
                {ticker:'GOOGL',name:'Alphabet Inc',wtChg:+5.4,avgPrice:176.80,theme:'AI 저평가 가치주 기회'},
                {ticker:'WBD',name:'Warner Bros Discovery',wtChg:+4.2,avgPrice:9.80,theme:'미디어 구조조정 특수상황'},
                {ticker:'MSGS',name:'Madison Sq Garden Sports',wtChg:+3.6,avgPrice:188.60,theme:'스포츠 자산 내재가치 재평가'},
            ],
            holdings:[
                {ticker:'GOOGL',name:'Alphabet Inc',wt:12.4,wtChg:+5.4,avgPrice:176.80,action:'add'},
                {ticker:'WBD',name:'Warner Bros Discovery',wt:8.6,wtChg:+4.2,avgPrice:9.80,action:'add'},
                {ticker:'MSGS',name:'Madison Sq Garden Sports',wt:6.8,wtChg:+3.6,avgPrice:188.60,action:'add'},
                {ticker:'VNO',name:'Vornado Realty Trust',wt:5.4,wtChg:+1.8,avgPrice:28.40,action:'add'},
                {ticker:'MKL',name:'Markel Group',wt:7.2,wtChg:+0.4,avgPrice:1748.60,action:'hold'},
                {ticker:'ATVI',name:'Activision Blizzard',wt:3.2,wtChg:-3.2,avgPrice:94.60,action:'sell'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:6.8,wtChg:+0.4,avgPrice:416.40,action:'hold'},
                {ticker:'BRK.B',name:'Berkshire Hathaway B',wt:5.6,wtChg:+0.2,avgPrice:484.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:4.8,wtChg:+0.6,avgPrice:191.40,action:'hold'},
                {ticker:'LBTYA',name:'Liberty Global Series A',wt:4.2,wtChg:+1.6,avgPrice:18.60,action:'add'},
                {ticker:'DISCK',name:'Discovery Inc',wt:3.6,wtChg:-1.2,avgPrice:14.40,action:'reduce'},
                {ticker:'TPVG',name:'TriplePoint Venture',wt:2.8,wtChg:+0.4,avgPrice:8.40,action:'add'},
                {ticker:'LADR',name:'Ladder Capital Corp',wt:2.4,wtChg:+0.2,avgPrice:11.40,action:'hold'},
                {ticker:'KW',name:'Kennedy-Wilson Holdings',wt:2.0,wtChg:-0.6,avgPrice:9.60,action:'reduce'},
                {ticker:'CNFINANCE',name:'CNFinance Holdings',wt:1.6,wtChg:+0.4,avgPrice:2.80,action:'add'},
            ],
            insight:'세스 클라만의 바우포스트는 안전마진 원칙 하에 AI 저평가 기회를 포착. GOOGL은 AI 우려로 할인된 구간에서 매수. WBD·MSGS는 자산 재평가 잠재력에 베팅한 특수상황 투자.'
        },
        {
            id:'sorosfund', name:'Soros Fund Management', manager:'Dawn Fitzpatrick',
            ret1q:-1.4, ret1y:6.8, newBuySector:'AI·매크로 혼합',
            hotBadge:'🌐', emoji:'🔮',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/George_Soros_-_Festival_Economia_2012_1.jpg/100px-George_Soros_-_Festival_Economia_2012_1.jpg',
            tags:['글로벌매크로','AI전환','지정학'],
            volatilePicks:['NVDA','TSM','QCOM'],
            top3Add:[
                {ticker:'NVDA',name:'NVIDIA Corp',wtChg:+4.8,avgPrice:114.80,theme:'AI칩 공급 병목 수혜 지속'},
                {ticker:'TSM',name:'TSMC ADR',wtChg:+4.2,avgPrice:164.40,theme:'AI 반도체 파운드리 독점'},
                {ticker:'NFLX',name:'Netflix Inc',wtChg:+3.4,avgPrice:952.80,theme:'AI 광고 수익 모델 성숙'},
            ],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:8.6,wtChg:+4.8,avgPrice:114.80,action:'add'},
                {ticker:'TSM',name:'TSMC ADR',wt:7.4,wtChg:+4.2,avgPrice:164.40,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:6.8,wtChg:+3.4,avgPrice:952.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:6.2,wtChg:+2.6,avgPrice:174.60,action:'add'},
                {ticker:'BIDU',name:'Baidu Inc',wt:3.8,wtChg:-3.8,avgPrice:88.40,action:'sell'},
                {ticker:'GLD',name:'SPDR Gold ETF',wt:9.4,wtChg:+2.8,avgPrice:198.40,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:7.2,wtChg:+0.6,avgPrice:414.40,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:6.4,wtChg:+1.0,avgPrice:538.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:5.6,wtChg:+0.8,avgPrice:193.40,action:'hold'},
                {ticker:'TLT',name:'iShares 20Y+ Treasury',wt:5.0,wtChg:-1.2,avgPrice:89.40,action:'reduce'},
                {ticker:'IAU',name:'iShares Gold ETF',wt:4.4,wtChg:+1.4,avgPrice:46.40,action:'add'},
                {ticker:'EEM',name:'iShares MSCI EM ETF',wt:3.8,wtChg:+0.8,avgPrice:42.60,action:'add'},
                {ticker:'FXI',name:'iShares China Large-Cap',wt:3.2,wtChg:-1.6,avgPrice:28.40,action:'reduce'},
                {ticker:'AAPL',name:'Apple Inc',wt:2.6,wtChg:+0.2,avgPrice:224.40,action:'hold'},
                {ticker:'AGG',name:'iShares Core US Agg Bond',wt:2.0,wtChg:-0.4,avgPrice:96.40,action:'hold'},
            ],
            insight:'소로스펀드는 지정학적 긴장 속 금(GLD) 비중 확대와 AI 핵심주 동시 운용. 중국(BIDU) 완전 철수하고 TSMC를 통해 AI 반도체 수혜는 취하는 영리한 지정학 헤지 전략.'
        },
        {
            id:'tci', name:'TCI Fund Management', manager:'Chris Hohn',
            ret1q:+0.8, ret1y:6.2, newBuySector:'인프라·AI클라우드',
            hotBadge:'🏗️', emoji:'🔧',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Chris_Hohn_GFSS_2023.jpg/100px-Chris_Hohn_GFSS_2023.jpg',
            tags:['인프라','행동주의','ESG성장'],
            volatilePicks:['MSFT','GOOGL','META'],
            top3Add:[
                {ticker:'MSFT',name:'Microsoft Corp',wtChg:+5.2,avgPrice:412.40,theme:'AI 코파일럿 엔터프라이즈 확산'},
                {ticker:'GOOGL',name:'Alphabet Inc',wtChg:+4.6,avgPrice:172.40,theme:'AI 클라우드 가속 성장'},
                {ticker:'META',name:'Meta Platforms',wtChg:+3.8,avgPrice:530.60,theme:'AI 광고 효율 혁신'},
            ],
            holdings:[
                {ticker:'MSFT',name:'Microsoft Corp',wt:16.8,wtChg:+5.2,avgPrice:412.40,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:14.2,wtChg:+4.6,avgPrice:172.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:12.6,wtChg:+3.8,avgPrice:530.60,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:10.4,wtChg:+1.4,avgPrice:182.40,action:'add'},
                {ticker:'VISA',name:'Visa Inc',wt:8.2,wtChg:+0.8,avgPrice:282.60,action:'hold'},
                {ticker:'UNP',name:'Union Pacific Corp',wt:6.4,wtChg:-2.2,avgPrice:238.80,action:'reduce'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:8.6,wtChg:+2.8,avgPrice:120.40,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:7.4,wtChg:+1.2,avgPrice:194.40,action:'add'},
                {ticker:'MA',name:'Mastercard Inc',wt:6.8,wtChg:+0.8,avgPrice:498.40,action:'hold'},
                {ticker:'CSCO',name:'Cisco Systems',wt:5.2,wtChg:-0.6,avgPrice:58.40,action:'reduce'},
                {ticker:'ORCL',name:'Oracle Corp',wt:4.8,wtChg:+2.0,avgPrice:168.40,action:'add'},
                {ticker:'SAP',name:'SAP SE ADR',wt:4.2,wtChg:+0.6,avgPrice:264.40,action:'hold'},
                {ticker:'ADBE',name:'Adobe Inc',wt:3.6,wtChg:+0.8,avgPrice:448.40,action:'add'},
                {ticker:'SQ',name:'Block Inc',wt:3.0,wtChg:+1.2,avgPrice:69.40,action:'add'},
                {ticker:'PYPL',name:'PayPal Holdings',wt:2.4,wtChg:-1.0,avgPrice:68.40,action:'reduce'},
            ],
            insight:'TCI는 크리스 혼의 행동주의 방식으로 빅테크 AI 전환 요구. MSFT·GOOGL·META에 집중하면서 탄소중립 경영 압박도 병행. 인프라+AI 복합 테마의 장기 수혜 포트폴리오.'
        },
        {
            id:'balyasny', name:'Balyasny Asset Management', manager:'Dmitry Balyasny',
            ret1q:-2.2, ret1y:5.8, newBuySector:'멀티스트래티지 AI',
            hotBadge:'🎲', emoji:'🏛️',
            tags:['멀티스트래티지','퀀트·재량','AI균형'],
            volatilePicks:['MSFT','NVDA','GOOGL'],
            top3Add:[
                {ticker:'MSFT',name:'Microsoft Corp',wtChg:+3.8,avgPrice:410.40,theme:'AI 플랫폼 수익화 가속'},
                {ticker:'NVDA',name:'NVIDIA Corp',wtChg:+3.2,avgPrice:112.80,theme:'AI 가속 컴퓨팅 독점'},
                {ticker:'AMZN',name:'Amazon.com Inc',wtChg:+2.8,avgPrice:188.40,theme:'AWS AI 마진 개선'},
            ],
            holdings:[
                {ticker:'MSFT',name:'Microsoft Corp',wt:9.4,wtChg:+3.8,avgPrice:410.40,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:8.8,wtChg:+3.2,avgPrice:112.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:8.2,wtChg:+2.8,avgPrice:188.40,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:7.6,wtChg:+2.4,avgPrice:170.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:7.0,wtChg:+2.0,avgPrice:528.60,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:5.8,wtChg:-1.4,avgPrice:180.40,action:'reduce'},
                {ticker:'TSLA',name:'Tesla Inc',wt:5.2,wtChg:+1.0,avgPrice:287.40,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:4.8,wtChg:+0.6,avgPrice:965.40,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.2,wtChg:+1.4,avgPrice:222.40,action:'add'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:3.8,wtChg:+0.4,avgPrice:235.40,action:'hold'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:3.4,wtChg:+0.8,avgPrice:854.40,action:'hold'},
                {ticker:'V',name:'Visa Inc',wt:3.0,wtChg:+0.2,avgPrice:327.40,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:2.6,wtChg:-0.4,avgPrice:547.40,action:'reduce'},
                {ticker:'COST',name:'Costco Wholesale',wt:2.2,wtChg:+0.2,avgPrice:948.40,action:'hold'},
                {ticker:'HD',name:'Home Depot Inc',wt:1.8,wtChg:-0.2,avgPrice:394.40,action:'hold'},
            ],
            insight:'발야스니는 퀀트+재량 팀 혼합 구조로 AI 테마 내 리스크 분산. 빅테크 5종목에 균등 비중 유지하면서 개별 AI 모멘텀에 따라 미세 조정. 분산된 멀티PM 구조가 안정적 수익 창출에 기여.'
        },
        {
            id:'graham', name:'Graham Capital Management', manager:'Ken Tropin',
            ret1q:+1.4, ret1y:5.4, newBuySector:'매크로·퀀트 AI',
            hotBadge:'📈', emoji:'📉',
            tags:['글로벌매크로','체계적CTA','AI팩터'],
            volatilePicks:['MSFT','NVDA','GOOGL'],
            top3Add:[
                {ticker:'NVDA',name:'NVIDIA Corp',wtChg:+3.4,avgPrice:110.80,theme:'AI 트렌드 팩터 신호 강세'},
                {ticker:'MSFT',name:'Microsoft Corp',wtChg:+2.8,avgPrice:408.40,theme:'AI SaaS 모멘텀 지속'},
                {ticker:'GLD',name:'SPDR Gold ETF',wtChg:+4.6,avgPrice:196.40,theme:'매크로 인플레 헤지'},
            ],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:7.2,wtChg:+3.4,avgPrice:110.80,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:6.8,wtChg:+2.8,avgPrice:408.40,action:'add'},
                {ticker:'GLD',name:'SPDR Gold ETF',wt:12.4,wtChg:+4.6,avgPrice:196.40,action:'add'},
                {ticker:'TLT',name:'iShares 20Y+ Treasury ETF',wt:8.6,wtChg:-4.2,avgPrice:88.40,action:'reduce'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:5.4,wtChg:+1.8,avgPrice:168.40,action:'add'},
                {ticker:'UUP',name:'USD Bull ETF',wt:6.2,wtChg:-2.6,avgPrice:28.40,action:'reduce'},
                {ticker:'META',name:'Meta Platforms',wt:4.8,wtChg:+0.8,avgPrice:529.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:4.2,wtChg:+0.6,avgPrice:189.40,action:'hold'},
                {ticker:'IAU',name:'iShares Gold ETF',wt:3.8,wtChg:+1.0,avgPrice:45.40,action:'add'},
                {ticker:'SLV',name:'iShares Silver ETF',wt:3.4,wtChg:+0.8,avgPrice:28.40,action:'add'},
                {ticker:'DBC',name:'Invesco DB Commodity',wt:3.0,wtChg:+0.4,avgPrice:22.40,action:'hold'},
                {ticker:'EEM',name:'iShares MSCI EM ETF',wt:2.6,wtChg:-0.6,avgPrice:41.40,action:'reduce'},
                {ticker:'EFA',name:'iShares MSCI EAFE ETF',wt:2.2,wtChg:+0.2,avgPrice:78.40,action:'hold'},
                {ticker:'HYG',name:'iShares HY Corp Bond',wt:1.8,wtChg:-0.4,avgPrice:78.40,action:'reduce'},
                {ticker:'AGG',name:'iShares US Agg Bond',wt:1.4,wtChg:-0.2,avgPrice:96.40,action:'hold'},
            ],
            insight:'그레이엄캐피탈의 CTA 전략은 AI 모멘텀 팩터를 조기 포착해 NVDA·MSFT에 롱 진입. 동시에 금 비중 확대로 매크로 불확실성 헤지. 체계적 트렌드 추종이 AI 강세장에서 안정적 수익 창출.'
        },
        {
            id:'farallon', name:'Farallon Capital Management', manager:'Andrew Spokes',
            ret1q:-0.8, ret1y:4.6, newBuySector:'딥밸류·이머징 AI',
            hotBadge:'🦈', emoji:'🌊',
            tags:['딥밸류','이머징','이벤트드리븐'],
            volatilePicks:['GLD','BABA','NVDA'],
            top3Add:[
                {ticker:'NVDA',name:'NVIDIA Corp',wtChg:+3.6,avgPrice:108.80,theme:'AI칩 수요 구조적 성장'},
                {ticker:'BABA',name:'Alibaba Group',wtChg:+3.2,avgPrice:84.60,theme:'중국 AI 전환 재평가 기회'},
                {ticker:'GLD',name:'SPDR Gold ETF',wtChg:+3.8,avgPrice:194.40,theme:'달러 약세·지정학 헤지'},
            ],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:8.4,wtChg:+3.6,avgPrice:108.80,action:'add'},
                {ticker:'BABA',name:'Alibaba Group',wt:6.8,wtChg:+3.2,avgPrice:84.60,action:'add'},
                {ticker:'GLD',name:'SPDR Gold ETF',wt:10.2,wtChg:+3.8,avgPrice:194.40,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:7.4,wtChg:+1.6,avgPrice:166.40,action:'add'},
                {ticker:'EM_ETF',name:'iShares MSCI EM ETF',wt:8.6,wtChg:+2.4,avgPrice:42.40,action:'add'},
                {ticker:'VRE',name:'Veris Residential',wt:3.2,wtChg:-1.8,avgPrice:14.80,action:'reduce'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:6.4,wtChg:+0.4,avgPrice:413.40,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:5.6,wtChg:+0.8,avgPrice:530.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:4.8,wtChg:+0.6,avgPrice:190.40,action:'hold'},
                {ticker:'TSM',name:'TSMC ADR',wt:4.2,wtChg:+1.2,avgPrice:165.40,action:'add'},
                {ticker:'FXI',name:'iShares China Large-Cap',wt:3.6,wtChg:+1.0,avgPrice:27.40,action:'add'},
                {ticker:'MELI',name:'MercadoLibre Inc',wt:3.0,wtChg:+0.8,avgPrice:2118.40,action:'hold'},
                {ticker:'SE',name:'Sea Limited ADR',wt:2.4,wtChg:-0.8,avgPrice:86.40,action:'reduce'},
                {ticker:'JD',name:'JD.com ADR',wt:1.8,wtChg:+0.4,avgPrice:38.40,action:'add'},
                {ticker:'PBR',name:'Petrobras ADR',wt:1.2,wtChg:-0.2,avgPrice:14.40,action:'hold'},
            ],
            insight:'파라론은 이머징마켓 전문성을 살려 중국 AI 재평가(BABA)와 미국 AI 성장(NVDA)을 동시 포착. 금 비중 확대로 지정학적 리스크 헤지. 글로벌 분산 이벤트드리븐 전략의 균형 잡힌 수익.'
        },
        {
            id:'glenview', name:'Glenview Capital Management', manager:'Larry Robbins',
            ret1q:-1.2, ret1y:4.2, newBuySector:'헬스케어·AI바이오',
            hotBadge:'🏥', emoji:'💊',
            tags:['헬스케어','행동주의','AI바이오'],
            volatilePicks:['LLY','NVO','HIMS'],
            top3Add:[
                {ticker:'LLY',name:'Eli Lilly & Co',wtChg:+5.2,avgPrice:846.40,theme:'GLP-1 비만치료제 독점 성장'},
                {ticker:'HIMS',name:'Hims & Hers Health',wtChg:+4.4,avgPrice:22.60,theme:'AI 개인화 처방 플랫폼'},
                {ticker:'NVO',name:'Novo Nordisk ADR',wtChg:+3.6,avgPrice:92.40,theme:'위고비·오젬픽 글로벌 확장'},
            ],
            holdings:[
                {ticker:'LLY',name:'Eli Lilly & Co',wt:14.8,wtChg:+5.2,avgPrice:846.40,action:'add'},
                {ticker:'NVO',name:'Novo Nordisk ADR',wt:10.6,wtChg:+3.6,avgPrice:92.40,action:'add'},
                {ticker:'HIMS',name:'Hims & Hers Health',wt:5.4,wtChg:+4.4,avgPrice:22.60,action:'add'},
                {ticker:'HCA',name:'HCA Healthcare',wt:9.2,wtChg:+1.8,avgPrice:332.80,action:'add'},
                {ticker:'CNC',name:'Centene Corp',wt:6.4,wtChg:-2.4,avgPrice:62.40,action:'reduce'},
                {ticker:'CI',name:'Cigna Group',wt:5.8,wtChg:+1.2,avgPrice:332.40,action:'add'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:7.6,wtChg:+1.4,avgPrice:549.40,action:'add'},
                {ticker:'ABBV',name:'AbbVie Inc',wt:6.4,wtChg:+0.8,avgPrice:197.40,action:'hold'},
                {ticker:'AMGN',name:'Amgen Inc',wt:5.2,wtChg:-0.6,avgPrice:298.40,action:'reduce'},
                {ticker:'BIIB',name:'Biogen Inc',wt:4.4,wtChg:+1.6,avgPrice:178.40,action:'add'},
                {ticker:'GILD',name:'Gilead Sciences',wt:3.8,wtChg:+0.8,avgPrice:88.40,action:'hold'},
                {ticker:'REGN',name:'Regeneron Pharma',wt:3.2,wtChg:+1.0,avgPrice:622.40,action:'add'},
                {ticker:'VRTX',name:'Vertex Pharma',wt:2.6,wtChg:+0.6,avgPrice:478.40,action:'hold'},
                {ticker:'MRNA',name:'Moderna Inc',wt:2.0,wtChg:+0.8,avgPrice:39.40,action:'add'},
                {ticker:'ISRG',name:'Intuitive Surgical',wt:1.6,wtChg:+0.6,avgPrice:438.40,action:'add'},
            ],
            insight:'글렌뷰는 헬스케어 행동주의 전문 펀드. GLP-1 비만치료제 붐(LLY·NVO)과 AI 헬스케어 플랫폼(HIMS) 동시 포착. 래리 로빈스의 헬스케어 심층 분석 능력이 섹터 알파 창출의 핵심 동인.'
        },
    ];

    // ===== 🏛️ 월가 킹덤 — 메이저 기관 TOP 10 (AUM 기준, Q1 2026) =====
    const SM_KINGDOM = [
        {
            id:'blackrock', name:'BlackRock Inc', manager:'Larry Fink',
            aum:11200, top3:[{ticker:'NVDA',wt:5.87},{ticker:'AAPL',wt:5.08},{ticker:'MSFT',wt:3.84}],
            emoji:'⬛',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Larry_Fink_with_Valdis_Dombrovskis_%28cropped%29.jpg/100px-Larry_Fink_with_Valdis_Dombrovskis_%28cropped%29.jpg',
            tags:['패시브','ETF','글로벌최대'],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:5.87,wtChg:-0.23,avgPrice:112.40,action:'reduce'},
                {ticker:'AAPL',name:'Apple Inc',wt:5.08,wtChg:-0.12,avgPrice:218.40,action:'reduce'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.84,wtChg:-0.16,avgPrice:412.40,action:'reduce'},
                {ticker:'AMZN',name:'Amazon.com',wt:2.68,wtChg:+0.08,avgPrice:198.40,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.25,wtChg:+0.15,avgPrice:168.40,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:2.09,wtChg:+0.29,avgPrice:188.40,action:'add'},
                {ticker:'GOOG',name:'Alphabet Inc C',wt:1.83,wtChg:+0.13,avgPrice:168.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.69,wtChg:-0.11,avgPrice:558.40,action:'reduce'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.35,wtChg:-0.05,avgPrice:282.40,action:'reduce'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.07,wtChg:-0.03,avgPrice:238.40,action:'reduce'},
                {ticker:'LLY',name:'Eli Lilly',wt:1.07,wtChg:-0.13,avgPrice:818.40,action:'reduce'},
                {ticker:'BRK.B',name:'Berkshire Hathaway B',wt:1.02,wtChg:0,avgPrice:492.40,action:'hold'},
                {ticker:'XOM',name:'Exxon Mobil',wt:0.96,wtChg:+0.26,avgPrice:112.40,action:'add'},
                {ticker:'JNJ',name:'Johnson & Johnson',wt:0.91,wtChg:+0.21,avgPrice:162.40,action:'add'},
                {ticker:'AMAT',name:'Applied Materials',wt:0.88,wtChg:+0.18,avgPrice:168.40,action:'add'},
            ],
            insight:'블랙록은 Q1 2026 패시브 리밸런싱에서 AI 하드웨어(NVDA·AVBO·AAPL) 비중 조정과 에너지(XOM·CVX) 대규모 추가가 특징. 이란 지정학 이벤트로 에너지 인프라 익스포저 확대. JNJ·방어주 추가는 관세 불확실성 헷지. 11.2조 달러 AUM 기준 세계 최대.'
        },
        {
            id:'vanguard', name:'Vanguard Group', manager:'Salim Ramji',
            aum:9600, top3:[{ticker:'AAPL',wt:5.45},{ticker:'NVDA',wt:5.90},{ticker:'MSFT',wt:4.90}],
            emoji:'🔵',
            logo_url:'https://logo.clearbit.com/vanguard.com',
            tags:['패시브','저비용','장기투자'],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:5.90,wtChg:-0.10,avgPrice:112.40,action:'reduce'},
                {ticker:'AAPL',name:'Apple Inc',wt:5.45,wtChg:-0.05,avgPrice:218.40,action:'reduce'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:4.90,wtChg:-0.10,avgPrice:412.40,action:'reduce'},
                {ticker:'AMZN',name:'Amazon.com',wt:2.76,wtChg:+0.06,avgPrice:198.40,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:2.31,wtChg:+0.21,avgPrice:188.40,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.36,wtChg:+0.16,avgPrice:168.40,action:'add'},
                {ticker:'GOOG',name:'Alphabet Inc C',wt:1.87,wtChg:+0.07,avgPrice:168.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.82,wtChg:-0.08,avgPrice:558.40,action:'reduce'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.57,wtChg:-0.13,avgPrice:282.40,action:'reduce'},
                {ticker:'LLY',name:'Eli Lilly',wt:1.24,wtChg:-0.16,avgPrice:818.40,action:'reduce'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.21,wtChg:0,avgPrice:238.40,action:'hold'},
                {ticker:'BRK.B',name:'Berkshire Hathaway B',wt:1.12,wtChg:0,avgPrice:492.40,action:'hold'},
                {ticker:'V',name:'Visa Inc',wt:0.79,wtChg:0,avgPrice:328.40,action:'hold'},
                {ticker:'XOM',name:'Exxon Mobil',wt:0.73,wtChg:+0.13,avgPrice:112.40,action:'add'},
                {ticker:'JNJ',name:'Johnson & Johnson',wt:0.70,wtChg:0,avgPrice:162.40,action:'hold'},
            ],
            insight:'뱅가드는 Q1 2026에도 순수 패시브 전략 유지. 살림 람지 신임 CEO 체제에서 액티브 ETF 확대 중이나 13F는 인덱스 그대로 반영. AAPL·MSFT·NVDA 비중 감소는 주가 하락에 따른 자동 리밸런싱. XOM·에너지 섹터 소폭 상향. 9.6조 달러 AUM.'
        },
        {
            id:'berkshire25', name:'Berkshire Hathaway', manager:'Warren Buffett',
            aum:580, top3:[{ticker:'AAPL',wt:26.8},{ticker:'AXP',wt:12.4},{ticker:'BAC',wt:10.2}],
            emoji:'🎩',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_%28cropped%29.jpg/100px-Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_%28cropped%29.jpg',
            tags:['가치투자','장기보유','배당'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:26.8,wtChg:-1.4,avgPrice:150.22,action:'reduce'},
                {ticker:'AXP',name:'American Express',wt:12.4,wtChg:+0.8,avgPrice:228.40,action:'add'},
                {ticker:'BAC',name:'Bank of America',wt:10.2,wtChg:-2.1,avgPrice:36.80,action:'reduce'},
                {ticker:'KO',name:'Coca-Cola Company',wt:8.4,wtChg:0,avgPrice:44.20,action:'hold'},
                {ticker:'OXY',name:'Occidental Petroleum',wt:6.8,wtChg:+1.2,avgPrice:50.80,action:'add'},
                {ticker:'CVX',name:'Chevron Corp',wt:5.6,wtChg:-0.4,avgPrice:146.40,action:'hold'},
                {ticker:'MCO',name:"Moody's Corp",wt:5.4,wtChg:+0.4,avgPrice:446.80,action:'add'},
                {ticker:'VZ',name:'Verizon Communications',wt:3.8,wtChg:+3.8,avgPrice:42.60,action:'new'},
                {ticker:'USB',name:'US Bancorp',wt:3.2,wtChg:-0.8,avgPrice:46.60,action:'reduce'},
                {ticker:'CB',name:'Chubb Ltd',wt:2.8,wtChg:+0.6,avgPrice:282.60,action:'add'},
                {ticker:'SPGI',name:'S&P Global Inc',wt:2.4,wtChg:+0.4,avgPrice:468.60,action:'hold'},
                {ticker:'DEO',name:'Diageo PLC ADR',wt:2.0,wtChg:-0.4,avgPrice:128.60,action:'reduce'},
                {ticker:'CHTR',name:'Charter Communications',wt:1.8,wtChg:-0.4,avgPrice:372.60,action:'reduce'},
                {ticker:'DVA',name:'DaVita Inc',wt:1.6,wtChg:+0.2,avgPrice:128.60,action:'hold'},
                {ticker:'LSXMA',name:'Liberty SiriusXM',wt:1.2,wtChg:-0.2,avgPrice:24.60,action:'reduce'},
            ],
            insight:'버핏은 2025 Q1에도 AAPL 계속 매도 중(세금 최적화 + 밸류에이션). 대신 AXP·OXY를 꾸준히 추가. 신규 편입 VZ(버라이즌)은 통신 인프라의 장기 해자를 인정한 포지션. 현금 비중도 사상 최고 수준 유지.'
        },
        {
            id:'statestreet', name:'State Street Global Advisors', manager:'Cyrus Taraporevala',
            aum:4400, top3:[{ticker:'AAPL',wt:4.8},{ticker:'MSFT',wt:4.2},{ticker:'NVDA',wt:3.6}],
            emoji:'🏦',
            logo_url:'https://logo.clearbit.com/statestreet.com',
            tags:['패시브','ETF','SPDR'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:4.8,wtChg:-0.2,avgPrice:184.20,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:4.2,wtChg:+0.1,avgPrice:420.80,action:'hold'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.6,wtChg:+0.7,avgPrice:126.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:3.0,wtChg:+0.2,avgPrice:196.40,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:2.2,wtChg:+0.3,avgPrice:546.20,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.6,wtChg:0,avgPrice:171.80,action:'hold'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.4,wtChg:-0.4,avgPrice:242.40,action:'reduce'},
                {ticker:'LLY',name:'Eli Lilly',wt:1.6,wtChg:+0.2,avgPrice:816.40,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.5,wtChg:+0.3,avgPrice:220.40,action:'add'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.3,wtChg:+0.1,avgPrice:230.40,action:'hold'},
                {ticker:'V',name:'Visa Inc',wt:1.2,wtChg:0,avgPrice:318.40,action:'hold'},
                {ticker:'BRK.B',name:'Berkshire Hathaway B',wt:1.1,wtChg:-0.1,avgPrice:478.40,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:1.0,wtChg:-0.1,avgPrice:494.40,action:'hold'},
                {ticker:'JNJ',name:'Johnson & Johnson',wt:0.9,wtChg:0,avgPrice:148.40,action:'hold'},
                {ticker:'HD',name:'Home Depot Inc',wt:0.8,wtChg:0,avgPrice:390.40,action:'hold'},
            ],
            insight:'스테이트스트리트는 SPDR ETF 시리즈(SPY, GLD 등)의 운용사. 인덱스 추종 비중이 절대적이며 NVDA·META 비중 증가는 시장 자체의 섹터 비중 변화를 반영. "Equal Voice" 주주 캠페인으로 ESG 영향력 행사.'
        },
        {
            id:'fidelity', name:'Fidelity Investments', manager:'Abigail Johnson',
            aum:4800, top3:[{ticker:'NVDA',wt:9.13},{ticker:'AAPL',wt:4.11},{ticker:'AMZN',wt:3.93}],
            emoji:'🟢',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Abigail_Johnson_at_Village_Global_%28cropped%29.jpg/100px-Abigail_Johnson_at_Village_Global_%28cropped%29.jpg',
            tags:['액티브','성장','리서치'],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:9.13,wtChg:+1.42,avgPrice:112.40,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:4.11,wtChg:0,avgPrice:218.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:3.93,wtChg:+0.43,avgPrice:198.40,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.71,wtChg:-0.29,avgPrice:412.40,action:'reduce'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:3.58,wtChg:+0.38,avgPrice:168.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:3.51,wtChg:-0.19,avgPrice:558.40,action:'reduce'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:2.02,wtChg:+0.32,avgPrice:188.40,action:'add'},
                {ticker:'GOOG',name:'Alphabet Inc C',wt:1.64,wtChg:-0.06,avgPrice:168.40,action:'reduce'},
                {ticker:'LLY',name:'Eli Lilly',wt:1.27,wtChg:+0.17,avgPrice:818.40,action:'add'},
                {ticker:'XOM',name:'Exxon Mobil',wt:1.24,wtChg:+0.44,avgPrice:112.40,action:'add'},
                {ticker:'TSM',name:'Taiwan Semiconductor',wt:1.07,wtChg:-0.13,avgPrice:186.40,action:'reduce'},
                {ticker:'NFLX',name:'Netflix Inc',wt:1.04,wtChg:+0.64,avgPrice:952.40,action:'add'},
                {ticker:'BRK.B',name:'Berkshire Hathaway B',wt:1.02,wtChg:0,avgPrice:492.40,action:'hold'},
                {ticker:'TSLA',name:'Tesla Inc',wt:0.88,wtChg:+0.18,avgPrice:282.40,action:'add'},
                {ticker:'ORCL',name:'Oracle Corp',wt:0.82,wtChg:+0.32,avgPrice:168.40,action:'add'},
            ],
            insight:'피델리티는 Q1 2026에 NVDA를 TOP1 비중으로 올렸습니다 — AI 칩 수요의 장기 구조적 강세 확신. NFLX 대규모 추가 매수(+$8.8B)는 액티브 펀드들의 AI 광고 콘텐츠 성장 베팅. XOM·에너지 섹터 추가는 지정학 인플레이션 헷지. MSFT·META 소폭 축소는 밸류에이션 부담 조정.'
        },
        {
            id:'jpmorgan', name:'J.P. Morgan Asset Management', manager:'Mary Callahan Erdoes',
            aum:3400, top3:[{ticker:'AAPL',wt:3.8},{ticker:'MSFT',wt:3.4},{ticker:'NVDA',wt:3.0}],
            emoji:'🏰',
            logo_url:'https://logo.clearbit.com/jpmorgan.com',
            tags:['종합운용','채권','배당'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:3.8,wtChg:-0.2,avgPrice:183.40,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.4,wtChg:+0.1,avgPrice:421.20,action:'hold'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.0,wtChg:+0.6,avgPrice:124.60,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:2.6,wtChg:+0.2,avgPrice:195.80,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.2,wtChg:0,avgPrice:170.80,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.8,wtChg:+0.4,avgPrice:248.60,action:'add'},
                {ticker:'JNJ',name:'Johnson & Johnson',wt:1.6,wtChg:-0.2,avgPrice:152.40,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:1.4,wtChg:-0.4,avgPrice:502.40,action:'reduce'},
                {ticker:'META',name:'Meta Platforms',wt:2.0,wtChg:+0.4,avgPrice:542.40,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.8,wtChg:+0.4,avgPrice:216.40,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.6,wtChg:0,avgPrice:316.40,action:'hold'},
                {ticker:'MA',name:'Mastercard Inc',wt:1.4,wtChg:+0.2,avgPrice:494.40,action:'hold'},
                {ticker:'BRK.B',name:'Berkshire Hathaway B',wt:1.2,wtChg:0,avgPrice:476.40,action:'hold'},
                {ticker:'LLY',name:'Eli Lilly',wt:1.0,wtChg:+0.2,avgPrice:812.40,action:'add'},
                {ticker:'COST',name:'Costco Wholesale',wt:0.8,wtChg:+0.1,avgPrice:936.40,action:'hold'},
            ],
            insight:'JP모건 AM은 빅테크 중심 분산 포트폴리오를 유지. NVDA 비중 확대와 JPM 자사주 추가가 눈에 띔. UNH 축소는 메디케어 규제 리스크 대비 포지션 조정. 채권 펀드 비중도 높아 금리 민감도 낮은 구조.'
        },
        {
            id:'citadel', name:'Citadel Advisors', manager:'Ken Griffin',
            aum:640, top3:[{ticker:'NVDA',wt:4.1},{ticker:'TSLA',wt:3.5},{ticker:'META',wt:2.4}],
            emoji:'🏯',
            photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Kenneth_C._Griffin_photo.jpg/100px-Kenneth_C._Griffin_photo.jpg',
            tags:['퀀트','멀티스트랫','헤지펀드'],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:4.1,wtChg:+0.6,avgPrice:112.40,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:3.5,wtChg:+0.8,avgPrice:282.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:2.4,wtChg:+0.3,avgPrice:558.40,action:'add'},
                {ticker:'NFLX',name:'Netflix Inc',wt:1.4,wtChg:+1.4,avgPrice:952.40,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:1.9,wtChg:0,avgPrice:218.40,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:1.6,wtChg:-0.2,avgPrice:412.40,action:'reduce'},
                {ticker:'AMZN',name:'Amazon.com',wt:1.4,wtChg:+0.4,avgPrice:198.40,action:'add'},
                {ticker:'MSTR',name:'MicroStrategy Inc',wt:1.4,wtChg:-0.8,avgPrice:282.40,action:'reduce'},
                {ticker:'GLD',name:'SPDR Gold ETF',wt:1.1,wtChg:+1.1,avgPrice:282.40,action:'new'},
                {ticker:'AMD',name:'Advanced Micro Devices',wt:1.0,wtChg:0,avgPrice:112.40,action:'hold'},
                {ticker:'AZN',name:'AstraZeneca PLC ADR',wt:0.8,wtChg:+0.8,avgPrice:72.40,action:'new'},
                {ticker:'SLV',name:'iShares Silver Trust',wt:0.6,wtChg:+0.6,avgPrice:32.40,action:'new'},
                {ticker:'MU',name:'Micron Technology',wt:0.8,wtChg:+0.4,avgPrice:98.40,action:'add'},
                {ticker:'WBD',name:'Warner Bros Discovery',wt:0.5,wtChg:+0.5,avgPrice:12.40,action:'new'},
                {ticker:'DIA',name:'SPDR Dow Jones ETF',wt:0.6,wtChg:+0.4,avgPrice:422.40,action:'add'},
            ],
            insight:'시타델 웰링턴은 Q1 2026 +1%로 S&P 500 대비 5%p 초과 성과. 멀티스트랫 퀀트 특성상 변동성 장세에서 강점 발휘. NFLX 대규모 신규 포지션, GLD/SLV 귀금속 헷지(이란 지정학), AZN 바이오 신규 편입. MSTR·MSFT 차익 실현. 총 12,857개 포지션 보유.'
        },
        {
            id:'renaissance25', name:'Renaissance Technologies', manager:'Peter Brown',
            aum:106, top3:[{ticker:'NVDA',wt:8.4},{ticker:'META',wt:6.8},{ticker:'APP',wt:5.6}],
            emoji:'🤖',
            logo_url:'https://logo.clearbit.com/rentec.com',
            tags:['퀀트','알고리즘','시장중립'],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:8.4,wtChg:+3.8,avgPrice:124.60,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:6.8,wtChg:+1.4,avgPrice:542.80,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:5.6,wtChg:+5.6,avgPrice:304.80,action:'new'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:5.2,wtChg:-0.6,avgPrice:418.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:4.8,wtChg:+0.4,avgPrice:194.40,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:4.4,wtChg:+1.8,avgPrice:170.40,action:'add'},
                {ticker:'IONQ',name:'IonQ Inc',wt:3.2,wtChg:+3.2,avgPrice:28.80,action:'new'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:2.8,wtChg:+0.8,avgPrice:222.40,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:2.4,wtChg:-0.2,avgPrice:183.40,action:'hold'},
                {ticker:'TSLA',name:'Tesla Inc',wt:2.2,wtChg:+0.4,avgPrice:236.40,action:'add'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:2.0,wtChg:+2.0,avgPrice:86.40,action:'new'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:1.8,wtChg:+0.8,avgPrice:360.40,action:'add'},
                {ticker:'SNOW',name:'Snowflake Inc',wt:1.6,wtChg:-0.6,avgPrice:158.40,action:'reduce'},
                {ticker:'DDOG',name:'Datadog Inc',wt:1.4,wtChg:+0.6,avgPrice:134.40,action:'add'},
                {ticker:'CRM',name:'Salesforce Inc',wt:1.2,wtChg:+0.4,avgPrice:294.40,action:'add'},
            ],
            insight:'르네상스는 통계 알고리즘이 APP·IONQ의 이상 수익률 패턴을 감지해 신규 편입. NVDA·META·GOOGL 비중 확대는 AI 서비스 레이어의 수익 모멘텀이 가속화된다는 시그널로 해석. 매달리온 펀드는 비공개이며 이는 외부 공개 펀드 기준.'
        },
        {
            id:'tiger', name:'Tiger Global Management', manager:'Chase Coleman',
            aum:22.85,
            top3:[{ticker:'GOOGL',wt:13.4},{ticker:'NVDA',wt:9.2},{ticker:'AMZN',wt:9.1}],
            emoji:'🐯',
            logo_url:'https://logo.clearbit.com/tigerglobal.com',
            tags:['성장주','글로벌테크','AI반도체'],
            holdings:[
                {ticker:'GOOGL',name:'Alphabet Inc',wt:13.4,wtChg:0,avgPrice:168.40,action:'hold'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:9.2,wtChg:+1.8,avgPrice:112.40,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:9.1,wtChg:0,avgPrice:198.40,action:'hold'},
                {ticker:'TSM',name:'Taiwan Semiconductor',wt:8.2,wtChg:+2.4,avgPrice:186.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:7.7,wtChg:+1.2,avgPrice:558.40,action:'add'},
                {ticker:'SE',name:'Sea Limited',wt:5.6,wtChg:0,avgPrice:112.40,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:4.9,wtChg:+2.2,avgPrice:188.40,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:4.1,wtChg:-1.8,avgPrice:412.40,action:'reduce'},
                {ticker:'GEV',name:'GE Vernova',wt:3.7,wtChg:0,avgPrice:342.40,action:'hold'},
                {ticker:'LRCX',name:'Lam Research',wt:3.6,wtChg:0,avgPrice:72.40,action:'hold'},
                {ticker:'SPOT',name:'Spotify Technology',wt:3.4,wtChg:+1.2,avgPrice:642.40,action:'add'},
                {ticker:'CPNG',name:'Coupang Inc',wt:2.9,wtChg:+3.8,avgPrice:24.40,action:'add'},
                {ticker:'AMAT',name:'Applied Materials',wt:2.5,wtChg:+1.8,avgPrice:168.40,action:'add'},
                {ticker:'INTC',name:'Intel Corp',wt:2.2,wtChg:+2.2,avgPrice:22.40,action:'new'},
                {ticker:'APP',name:'AppLovin Corp',wt:1.7,wtChg:-1.2,avgPrice:248.40,action:'reduce'},
            ],
            insight:'타이거글로벌은 Q1 2026 기술 하락장에서 GOOGL·NVDA 대형 포지션 유지로 손실. MSFT를 소폭 축소하고 반도체 장비(AMAT·LRCX)와 아시아 소비자 테크(CPNG·SE) 비중 확대. INTC 신규 매수는 파운드리 전환 카드 역발상 베팅. 22.85B달러 AUM으로 전분기 대비 감소.'
        },
        {
            id:'millennium', name:'Millennium Management', manager:'Izzy Englander',
            aum:228, top3:[{ticker:'IVV',wt:4.2},{ticker:'IWM',wt:3.8},{ticker:'NVDA',wt:3.1}],
            emoji:'🔮',
            logo_url:'https://logo.clearbit.com/mlp.com',
            tags:['멀티스트랫','퀀트','롱숏'],
            holdings:[
                {ticker:'IVV',name:'iShares S&P 500 ETF',wt:4.2,wtChg:+0.8,avgPrice:522.40,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.1,wtChg:+0.8,avgPrice:112.40,action:'add'},
                {ticker:'IWM',name:'iShares Russell 2000 ETF',wt:3.8,wtChg:+2.8,avgPrice:196.40,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:2.5,wtChg:0,avgPrice:412.40,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com',wt:2.0,wtChg:0,avgPrice:198.40,action:'hold'},
                {ticker:'TSLA',name:'Tesla Inc',wt:0.8,wtChg:+0.2,avgPrice:282.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.5,wtChg:0,avgPrice:558.40,action:'hold'},
                {ticker:'AAPL',name:'Apple Inc',wt:1.2,wtChg:+0.6,avgPrice:218.40,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:0.8,wtChg:0,avgPrice:168.40,action:'hold'},
                {ticker:'NFLX',name:'Netflix Inc',wt:0.7,wtChg:0,avgPrice:952.40,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:0.7,wtChg:0,avgPrice:188.40,action:'hold'},
                {ticker:'AMD',name:'Advanced Micro Devices',wt:0.7,wtChg:0,avgPrice:112.40,action:'hold'},
                {ticker:'WMT',name:'Walmart Inc',wt:1.1,wtChg:0,avgPrice:98.40,action:'hold'},
                {ticker:'NSC',name:'Norfolk Southern Corp',wt:0.6,wtChg:+0.6,avgPrice:228.40,action:'add'},
                {ticker:'XLE',name:'Energy Select SPDR ETF',wt:0.5,wtChg:+0.5,avgPrice:88.40,action:'new'},
            ],
            insight:'밀레니엄은 Q1 2026 +1.5% — 팟 기반 분산이 시장 하락 방어. IWM 소형주 ETF 대규모 추가는 관세 재건 수혜 베팅. NVDA·AAPL 추가매수는 딥시크 충격 저점 포착. NSC 철도 신규는 리쇼어링 인프라 테마. 이란 분쟁 주간 손실이 있었으나 전분기 수익으로 만회. 228B달러 AUM.'
        },
        {
            id:'capitalgroup', name:'Capital Group', manager:'Mike Gitlin',
            aum:2700, top3:[{ticker:'MSFT',wt:3.6},{ticker:'AAPL',wt:3.2},{ticker:'AMZN',wt:2.8}],
            emoji:'🏔️',
            tags:['액티브','장기투자','글로벌분산'],
            holdings:[
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.6,wtChg:+0.4,avgPrice:420.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:3.2,wtChg:-0.2,avgPrice:184.60,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.8,wtChg:+0.6,avgPrice:196.40,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:2.4,wtChg:+1.2,avgPrice:124.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.2,wtChg:+0.4,avgPrice:188.20,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.8,wtChg:+0.8,avgPrice:546.40,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.6,wtChg:+0.4,avgPrice:230.80,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.4,wtChg:+0.6,avgPrice:218.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.2,wtChg:+0.4,avgPrice:844.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.0,wtChg:+0.2,avgPrice:282.80,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:0.9,wtChg:-0.2,avgPrice:540.80,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:0.8,wtChg:+0.2,avgPrice:222.80,action:'hold'},
                {ticker:'HD',name:'Home Depot',wt:0.7,wtChg:+0.1,avgPrice:384.80,action:'hold'},
                {ticker:'COST',name:'Costco Wholesale',wt:0.6,wtChg:+0.1,avgPrice:932.80,action:'hold'},
                {ticker:'APP',name:'Applovin Corp',wt:0.5,wtChg:+0.5,avgPrice:296.80,action:'new'},
            ],
            insight:'캐피탈그룹은 액티브 장기 투자의 대명사. 개별 포트폴리오 매니저(멀티PM) 구조로 AI 빅테크 전반에 분산 편입. NVDA 비중 꾸준히 확대 중 — AI 인프라 수요의 구조적 성장에 대한 확신.'
        },
        {
            id:'goldmansacham', name:'Goldman Sachs Asset Mgmt', manager:'Marc Nachmann',
            aum:2600, top3:[{ticker:'AAPL',wt:3.8},{ticker:'MSFT',wt:3.4},{ticker:'NVDA',wt:3.0}],
            emoji:'🏛️',
            tags:['글로벌IB','퀀트·재량','AI전환'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:3.8,wtChg:-0.4,avgPrice:182.40,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.4,wtChg:+0.6,avgPrice:418.60,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.0,wtChg:+1.4,avgPrice:122.60,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.6,wtChg:+0.8,avgPrice:194.60,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:2.2,wtChg:+1.0,avgPrice:544.20,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.0,wtChg:+0.4,avgPrice:186.40,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.8,wtChg:+0.6,avgPrice:228.60,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.6,wtChg:+0.8,avgPrice:216.60,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.4,wtChg:+0.4,avgPrice:842.60,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.2,wtChg:+0.2,avgPrice:280.60,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.0,wtChg:+0.4,avgPrice:220.60,action:'add'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:0.9,wtChg:-0.4,avgPrice:538.60,action:'reduce'},
                {ticker:'MA',name:'Mastercard Inc',wt:0.8,wtChg:+0.2,avgPrice:476.60,action:'hold'},
                {ticker:'COST',name:'Costco Wholesale',wt:0.7,wtChg:+0.1,avgPrice:930.60,action:'hold'},
                {ticker:'NFLX',name:'Netflix Inc',wt:0.6,wtChg:+0.4,avgPrice:944.60,action:'add'},
            ],
            insight:'골드만삭스 AM은 IB 네트워크의 정보우위와 퀀트 전략을 결합. AI 빅테크 전방위 비중 확대가 핵심 기조. NVDA·META 추가매수는 "AI 인프라+광고" 이중 수혜 확신을 반영.'
        },
        {
            id:'pimco', name:'PIMCO', manager:'Dan Ivascyn',
            aum:1900, top3:[{ticker:'TLT',wt:8.4},{ticker:'AGG',wt:6.2},{ticker:'NVDA',wt:2.6}],
            emoji:'📊',
            tags:['채권전문','매크로','인플레헤지'],
            holdings:[
                {ticker:'TLT',name:'iShares 20Y+ Treasury',wt:8.4,wtChg:+2.4,avgPrice:88.60,action:'add'},
                {ticker:'AGG',name:'iShares Core US Bond',wt:6.2,wtChg:+1.2,avgPrice:98.40,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:2.6,wtChg:+1.6,avgPrice:120.80,action:'add'},
                {ticker:'GLD',name:'SPDR Gold ETF',wt:4.8,wtChg:+2.8,avgPrice:196.80,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:1.8,wtChg:+0.6,avgPrice:416.40,action:'add'},
                {ticker:'TIPS',name:'iShares TIPS Bond ETF',wt:5.6,wtChg:-1.2,avgPrice:108.40,action:'reduce'},
                {ticker:'HYG',name:'iShares High Yield Bond',wt:3.4,wtChg:+0.8,avgPrice:78.40,action:'add'},
                {ticker:'LQD',name:'iShares IG Corp Bond',wt:2.8,wtChg:+0.6,avgPrice:108.60,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:1.4,wtChg:+0.2,avgPrice:180.80,action:'hold'},
                {ticker:'MBB',name:'iShares MBS ETF',wt:4.2,wtChg:+1.4,avgPrice:94.40,action:'add'},
                {ticker:'BIL',name:'SPDR 1-3 Month T-Bill',wt:3.6,wtChg:-1.0,avgPrice:91.60,action:'reduce'},
                {ticker:'EMB',name:'iShares EM Bond ETF',wt:2.6,wtChg:+0.8,avgPrice:88.40,action:'add'},
                {ticker:'SHY',name:'iShares 1-3Y Treasury',wt:2.2,wtChg:+0.4,avgPrice:83.40,action:'add'},
                {ticker:'IAU',name:'iShares Gold ETF',wt:2.0,wtChg:+0.6,avgPrice:40.40,action:'add'},
                {ticker:'IEMB',name:'iShares EM USD Bond',wt:1.6,wtChg:+0.4,avgPrice:87.40,action:'add'},
            ],
            insight:'핌코는 채권 전문 운용사지만 Q1 2026 AI 혁명에 주식 익스포저 확대. 금리 하락 국면에서 TLT·AGG 비중 늘리면서 NVDA로 AI 인프라 성장 수혜도 동시 취득. 매크로·AI 복합 포트폴리오 전략.'
        },
        {
            id:'bnymellon', name:'BNY Mellon Investment Mgmt', manager:'Hanneke Smits',
            aum:1900, top3:[{ticker:'AAPL',wt:4.0},{ticker:'MSFT',wt:3.6},{ticker:'AMZN',wt:2.8}],
            emoji:'🏦',
            tags:['수탁은행','패시브·액티브','AI인프라'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:4.0,wtChg:-0.2,avgPrice:182.80,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.6,wtChg:+0.4,avgPrice:416.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.8,wtChg:+0.6,avgPrice:192.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:2.4,wtChg:+1.0,avgPrice:120.60,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.2,wtChg:+0.2,avgPrice:184.80,action:'hold'},
                {ticker:'BRK_B',name:'Berkshire Hathaway B',wt:1.8,wtChg:+0.4,avgPrice:468.40,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.6,wtChg:+0.6,avgPrice:540.40,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.4,wtChg:+0.4,avgPrice:840.40,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.2,wtChg:+0.4,avgPrice:226.40,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.0,wtChg:+0.2,avgPrice:278.40,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:0.9,wtChg:+0.2,avgPrice:218.40,action:'hold'},
                {ticker:'HD',name:'Home Depot',wt:0.8,wtChg:+0.1,avgPrice:380.40,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:0.7,wtChg:-0.2,avgPrice:534.40,action:'hold'},
                {ticker:'COST',name:'Costco Wholesale',wt:0.6,wtChg:+0.1,avgPrice:926.40,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:0.5,wtChg:+0.2,avgPrice:192.40,action:'add'},
            ],
            insight:'BNY멜론은 수탁·커스터디 서비스와 운용을 병행. 패시브 인덱스 비중이 크나 Q1 2026에 NVDA 비중 확대가 돋보임. AI 기반 수탁 인프라 혁신 사업과 AI 주식 투자가 동시 진행 중.'
        },
        {
            id:'amundi', name:'Amundi Asset Management', manager:'Valérie Baudson',
            aum:1800, top3:[{ticker:'AAPL',wt:3.4},{ticker:'MSFT',wt:3.0},{ticker:'NVDA',wt:2.6}],
            emoji:'🇫🇷',
            tags:['유럽최대','ESG선도','글로벌분산'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:3.4,wtChg:-0.4,avgPrice:181.60,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.0,wtChg:+0.6,avgPrice:414.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:2.6,wtChg:+1.2,avgPrice:118.60,action:'add'},
                {ticker:'ASML',name:'ASML Holding',wt:2.4,wtChg:+0.8,avgPrice:726.40,action:'add'},
                {ticker:'SAP',name:'SAP SE',wt:2.0,wtChg:+0.6,avgPrice:248.80,action:'add'},
                {ticker:'LVMH',name:'LVMH Moet Hennessy',wt:1.6,wtChg:-0.8,avgPrice:682.40,action:'reduce'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:1.4,wtChg:+0.4,avgPrice:178.40,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:1.2,wtChg:+0.4,avgPrice:188.40,action:'add'},
                {ticker:'NOVO',name:'Novo Nordisk ADR',wt:2.2,wtChg:+0.6,avgPrice:78.40,action:'add'},
                {ticker:'LIN',name:'Linde PLC',wt:1.8,wtChg:+0.2,avgPrice:458.40,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:1.0,wtChg:-0.2,avgPrice:532.40,action:'hold'},
                {ticker:'TSM',name:'Taiwan Semiconductor',wt:1.6,wtChg:+0.8,avgPrice:178.40,action:'add'},
                {ticker:'RHHBY',name:'Roche Holding ADR',wt:1.4,wtChg:-0.4,avgPrice:34.40,action:'reduce'},
                {ticker:'TTE',name:'TotalEnergies SE ADR',wt:1.2,wtChg:-0.2,avgPrice:62.40,action:'hold'},
                {ticker:'SIEGY',name:'Siemens AG ADR',wt:1.0,wtChg:+0.2,avgPrice:96.40,action:'hold'},
            ],
            insight:'유럽 최대 운용사 아문디는 AI 혁명 수혜 기술주(NVDA·ASML·SAP)와 유럽 소비재 혼합 포트폴리오. ESG 통합 운용 방침에 따라 AI 지속가능성 기업 선별적 편입. ASML 추가는 반도체 파운드리 시설 투자 성장 확신.'
        },
        {
            id:'invesco', name:'Invesco Ltd', manager:'Andrew Schlossberg',
            aum:1500, top3:[{ticker:'QQQ',wt:12.4},{ticker:'NVDA',wt:3.2},{ticker:'AAPL',wt:3.0}],
            emoji:'📈',
            tags:['ETF강자','스마트베타','AI테마'],
            holdings:[
                {ticker:'QQQ',name:'Invesco QQQ Trust',wt:12.4,wtChg:+2.4,avgPrice:484.60,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.2,wtChg:+1.6,avgPrice:118.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:3.0,wtChg:-0.4,avgPrice:180.80,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:2.8,wtChg:+0.6,avgPrice:412.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.4,wtChg:+0.8,avgPrice:190.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:2.0,wtChg:+1.0,avgPrice:540.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:1.8,wtChg:+0.6,avgPrice:176.80,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.6,wtChg:+0.4,avgPrice:224.80,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.4,wtChg:+0.8,avgPrice:214.80,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:1.2,wtChg:+1.2,avgPrice:302.80,action:'new'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:1.0,wtChg:+0.4,avgPrice:356.80,action:'add'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:0.9,wtChg:+0.9,avgPrice:82.80,action:'new'},
                {ticker:'SMH',name:'VanEck Semiconductor ETF',wt:0.8,wtChg:+0.4,avgPrice:248.80,action:'add'},
                {ticker:'AIQ',name:'Global X AI & Big Data ETF',wt:0.7,wtChg:+0.3,avgPrice:32.80,action:'add'},
                {ticker:'MSTR',name:'MicroStrategy Inc',wt:0.6,wtChg:+0.4,avgPrice:296.80,action:'add'},
            ],
            insight:'인베스코는 QQQ ETF 운용사로 나스닥 AI 빅테크에 자동 노출. 액티브 측에서도 NVDA·META 추가매수로 AI 모멘텀 포착. QQQ 자금 유입 증가가 직접 AUM 성장으로 연결되는 선순환 구조.'
        },
        {
            id:'troweprice', name:'T. Rowe Price', manager:'Rob Sharps',
            aum:1500, top3:[{ticker:'NVDA',wt:4.2},{ticker:'MSFT',wt:3.8},{ticker:'AMZN',wt:3.2}],
            emoji:'🦅',
            tags:['액티브성장','장기홀딩','AI전환'],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:4.2,wtChg:+2.0,avgPrice:116.80,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.8,wtChg:+0.8,avgPrice:410.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:3.2,wtChg:+1.0,avgPrice:188.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:2.8,wtChg:+1.4,avgPrice:538.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.6,wtChg:+0.6,avgPrice:182.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:2.4,wtChg:-0.6,avgPrice:178.80,action:'reduce'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:2.2,wtChg:+0.8,avgPrice:212.80,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:2.0,wtChg:+0.6,avgPrice:222.80,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:1.8,wtChg:+1.8,avgPrice:300.80,action:'new'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.6,wtChg:+0.6,avgPrice:836.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.4,wtChg:+0.2,avgPrice:276.80,action:'hold'},
                {ticker:'NFLX',name:'Netflix Inc',wt:1.2,wtChg:+0.4,avgPrice:948.80,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:1.0,wtChg:+1.0,avgPrice:354.80,action:'new'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:0.8,wtChg:+0.8,avgPrice:80.80,action:'new'},
                {ticker:'SHOP',name:'Shopify Inc',wt:0.6,wtChg:+0.4,avgPrice:108.80,action:'add'},
            ],
            insight:'T.로우프라이스는 성장주 장기 액티브의 대명사. Q1 2026에 NVDA를 TOP1 비중으로 올리며 AI 인프라 우선 전략 명확화. META·AMZN 동시 추가매수로 AI 광고+클라우드 이중 수혜 포지션 강화.'
        },
        {
            id:'morganstanleyim', name:'Morgan Stanley Invest. Mgmt', manager:'Dan Simkowitz',
            aum:1500, top3:[{ticker:'AAPL',wt:3.6},{ticker:'MSFT',wt:3.2},{ticker:'NVDA',wt:2.8}],
            emoji:'🗽',
            tags:['글로벌IB','성장·가치','AI플랫폼'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:3.6,wtChg:-0.4,avgPrice:178.80,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.2,wtChg:+0.8,avgPrice:408.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:2.8,wtChg:+1.4,avgPrice:114.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.4,wtChg:+0.6,avgPrice:186.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:2.0,wtChg:+0.8,avgPrice:848.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:1.8,wtChg:+0.4,avgPrice:180.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.6,wtChg:+0.8,avgPrice:536.80,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.4,wtChg:+0.4,avgPrice:220.80,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.2,wtChg:+0.6,avgPrice:210.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.0,wtChg:+0.2,avgPrice:274.80,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:0.9,wtChg:+0.2,avgPrice:214.80,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:0.8,wtChg:-0.4,avgPrice:528.80,action:'reduce'},
                {ticker:'NFLX',name:'Netflix Inc',wt:0.7,wtChg:+0.4,avgPrice:946.80,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:0.6,wtChg:+0.6,avgPrice:298.80,action:'new'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:0.5,wtChg:+0.5,avgPrice:344.80,action:'new'},
            ],
            insight:'모건스탠리 IM은 AI+헬스케어 이중 성장 테마 포지션. NVDA·MSFT 추가매수와 함께 LLY 비중 확대 — GLP-1 비만치료제가 AI만큼 구조적 성장 스토리라는 판단. 글로벌 IB 네트워크 기반 딥리서치 강점.'
        },
        {
            id:'wellington', name:'Wellington Management', manager:'Jean Hynes',
            aum:1300, top3:[{ticker:'MSFT',wt:3.4},{ticker:'NVDA',wt:3.0},{ticker:'AAPL',wt:2.8}],
            emoji:'🌐',
            tags:['기관전용','글로벌성장','장기액티브'],
            holdings:[
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.4,wtChg:+0.8,avgPrice:406.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.0,wtChg:+1.6,avgPrice:112.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:2.8,wtChg:-0.4,avgPrice:176.80,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.4,wtChg:+0.8,avgPrice:184.80,action:'add'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:2.0,wtChg:+0.4,avgPrice:542.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.8,wtChg:+0.2,avgPrice:284.80,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:1.6,wtChg:+0.8,avgPrice:534.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.4,wtChg:+0.4,avgPrice:832.80,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.2,wtChg:+0.2,avgPrice:218.80,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.0,wtChg:+0.2,avgPrice:212.80,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:0.9,wtChg:+0.4,avgPrice:208.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:0.8,wtChg:+0.2,avgPrice:174.80,action:'hold'},
                {ticker:'HD',name:'Home Depot',wt:0.7,wtChg:+0.1,avgPrice:376.80,action:'hold'},
                {ticker:'COST',name:'Costco Wholesale',wt:0.6,wtChg:+0.1,avgPrice:920.80,action:'hold'},
                {ticker:'PG',name:'Procter & Gamble',wt:0.5,wtChg:0,avgPrice:162.80,action:'hold'},
            ],
            insight:'웰링턴은 연기금·보험사 전용 운용의 강자. AI 인프라(NVDA·MSFT) 외에도 헬스케어(UNH), 금융(V) 등 균형 잡힌 장기 포트폴리오 유지. 기관 고객 요구에 맞는 안정성과 성장의 균형.'
        },
        {
            id:'nuveen', name:'Nuveen (TIAA)', manager:'José Minaya',
            aum:1100, top3:[{ticker:'AAPL',wt:3.8},{ticker:'MSFT',wt:3.4},{ticker:'NVDA',wt:2.6}],
            emoji:'🏫',
            tags:['연금전문','ESG','장기안정'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:3.8,wtChg:-0.2,avgPrice:174.80,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.4,wtChg:+0.6,avgPrice:404.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:2.6,wtChg:+1.2,avgPrice:110.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.2,wtChg:+0.4,avgPrice:182.80,action:'add'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:2.0,wtChg:+0.4,avgPrice:224.80,action:'add'},
                {ticker:'BRK_B',name:'Berkshire Hathaway B',wt:1.8,wtChg:+0.2,avgPrice:466.80,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:1.6,wtChg:+0.6,avgPrice:532.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:1.4,wtChg:+0.4,avgPrice:172.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.2,wtChg:+0.4,avgPrice:830.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.0,wtChg:+0.2,avgPrice:272.80,action:'hold'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:0.9,wtChg:-0.2,avgPrice:524.80,action:'hold'},
                {ticker:'HD',name:'Home Depot',wt:0.8,wtChg:+0.1,avgPrice:374.80,action:'hold'},
                {ticker:'COST',name:'Costco Wholesale',wt:0.7,wtChg:+0.1,avgPrice:918.80,action:'hold'},
                {ticker:'PG',name:'Procter & Gamble',wt:0.6,wtChg:0,avgPrice:168.80,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:0.5,wtChg:+0.2,avgPrice:192.80,action:'add'},
            ],
            insight:'누빈(TIAA)은 교직원 퇴직연금 전문 운용사. 장기 안정성 우선이지만 AI 혁명에 NVDA 비중 꾸준히 확대. ESG 통합 기준으로 AI 지속가능성 심사 후 편입 — "AI는 생산성 혁명이자 ESG 기회"라는 기조.'
        },
        {
            id:'apollo', name:'Apollo Global Management', manager:'Marc Rowan',
            aum:650, top3:[{ticker:'AAA',wt:8.4},{ticker:'NVDA',wt:3.4},{ticker:'AAPL',wt:2.8}],
            emoji:'🔱',
            tags:['대체투자','크레딧','AI인프라'],
            holdings:[
                {ticker:'AAA',name:'ApolloSenior Floating',wt:8.4,wtChg:+2.4,avgPrice:26.40,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.4,wtChg:+2.0,avgPrice:108.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:2.8,wtChg:-0.4,avgPrice:172.80,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:2.4,wtChg:+0.6,avgPrice:402.80,action:'add'},
                {ticker:'COIN',name:'Coinbase Global',wt:2.0,wtChg:+2.0,avgPrice:298.40,action:'new'},
                {ticker:'AI',name:'C3.ai Inc',wt:1.6,wtChg:+1.6,avgPrice:38.80,action:'new'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:1.4,wtChg:+0.6,avgPrice:168.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:1.2,wtChg:+0.4,avgPrice:172.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.0,wtChg:+0.6,avgPrice:526.80,action:'add'},
                {ticker:'ARCC',name:'Ares Capital Corp',wt:3.2,wtChg:+0.8,avgPrice:21.80,action:'add'},
                {ticker:'PFLT',name:'PennantPark Float Rate',wt:2.4,wtChg:+0.4,avgPrice:13.80,action:'hold'},
                {ticker:'BXSL',name:'Blackstone Secured Lending',wt:2.0,wtChg:+0.6,avgPrice:28.80,action:'add'},
                {ticker:'CSWC',name:'Capital Southwest Corp',wt:1.8,wtChg:-0.2,avgPrice:24.80,action:'hold'},
                {ticker:'MFIC',name:'MidCap Financial Investment',wt:1.6,wtChg:+0.4,avgPrice:16.80,action:'add'},
                {ticker:'ARES',name:'Ares Management Corp',wt:1.4,wtChg:+0.4,avgPrice:168.80,action:'add'},
            ],
            insight:'아폴로는 대체투자·PE 강자로 AI 데이터센터 인프라에 직접 투자. 크레딧 포트폴리오에서 AI 인프라 기업 대출 확대와 주식 포트폴리오에서 NVDA 대량 편입을 병행. COIN 신규 편입은 디지털 자산 AI 결합 테마.'
        },
        {
            id:'alliancebernstein', name:'AllianceBernstein', manager:'Seth Bernstein',
            aum:740, top3:[{ticker:'MSFT',wt:4.2},{ticker:'NVDA',wt:3.8},{ticker:'GOOGL',wt:3.2}],
            emoji:'⚖️',
            tags:['성장·가치혼합','AI전환','글로벌'],
            holdings:[
                {ticker:'MSFT',name:'Microsoft Corp',wt:4.2,wtChg:+1.2,avgPrice:400.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.8,wtChg:+2.4,avgPrice:106.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:3.2,wtChg:+1.0,avgPrice:176.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.8,wtChg:+0.8,avgPrice:180.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:2.4,wtChg:+1.4,avgPrice:532.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:2.0,wtChg:-0.8,avgPrice:170.80,action:'reduce'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.8,wtChg:+0.6,avgPrice:216.80,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.6,wtChg:+0.8,avgPrice:206.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.4,wtChg:+0.6,avgPrice:826.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.2,wtChg:+0.2,avgPrice:270.80,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.0,wtChg:+0.2,avgPrice:210.80,action:'hold'},
                {ticker:'NFLX',name:'Netflix Inc',wt:0.9,wtChg:+0.4,avgPrice:942.80,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:0.8,wtChg:+0.8,avgPrice:296.80,action:'new'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:0.7,wtChg:+0.7,avgPrice:78.80,action:'new'},
                {ticker:'SHOP',name:'Shopify Inc',wt:0.6,wtChg:+0.4,avgPrice:106.80,action:'add'},
            ],
            insight:'얼라이언스번스타인은 성장과 가치의 결합 운용으로 유명. Q1 2026에 NVDA를 TOP2 비중으로 올리며 AI 칩 독점 강세에 강한 확신. GOOGL·META·AMZN 동시 추가는 AI 플랫폼 전방위 베팅 전략.'
        },
        {
            id:'kkr', name:'KKR & Co', manager:'Joe Bae & Scott Nuttall',
            aum:520, top3:[{ticker:'NVDA',wt:4.8},{ticker:'MSFT',wt:3.6},{ticker:'META',wt:3.0}],
            emoji:'⚔️',
            tags:['PE대체투자','AI인프라','성장주'],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:4.8,wtChg:+3.2,avgPrice:104.80,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.6,wtChg:+1.2,avgPrice:398.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:3.0,wtChg:+1.8,avgPrice:528.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.6,wtChg:+1.0,avgPrice:174.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.2,wtChg:+0.8,avgPrice:178.80,action:'add'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:2.0,wtChg:+2.0,avgPrice:76.80,action:'new'},
                {ticker:'AAPL',name:'Apple Inc',wt:1.8,wtChg:-0.4,avgPrice:166.80,action:'hold'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.6,wtChg:+0.6,avgPrice:214.80,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:1.4,wtChg:+1.4,avgPrice:294.80,action:'new'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.2,wtChg:+0.6,avgPrice:204.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.0,wtChg:+0.4,avgPrice:824.80,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:0.9,wtChg:+0.9,avgPrice:350.80,action:'new'},
                {ticker:'NFLX',name:'Netflix Inc',wt:0.8,wtChg:+0.4,avgPrice:940.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:0.7,wtChg:+0.2,avgPrice:268.80,action:'hold'},
                {ticker:'UBER',name:'Uber Technologies',wt:0.6,wtChg:+0.4,avgPrice:76.80,action:'add'},
            ],
            insight:'KKR은 PE 하우스로 AI 인프라 직접 투자(데이터센터)와 상장주식 포트폴리오를 병행. NVDA를 TOP1 비중으로 올리며 AI 칩 공급망 전체 베팅. PLTR 신규 편입은 AI 소프트웨어 스택 노출 확대.'
        },
        {
            id:'dfa', name:'Dimensional Fund Advisors', manager:'Dave Butler',
            aum:720, top3:[{ticker:'AAPL',wt:3.2},{ticker:'MSFT',wt:2.8},{ticker:'NVDA',wt:2.4}],
            emoji:'📐',
            tags:['팩터투자','학문기반','체계적'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:3.2,wtChg:-0.2,avgPrice:168.80,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:2.8,wtChg:+0.4,avgPrice:396.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:2.4,wtChg:+0.8,avgPrice:102.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.0,wtChg:+0.4,avgPrice:176.80,action:'add'},
                {ticker:'AVUV',name:'Avantis US Small Cap Value',wt:4.8,wtChg:+0.8,avgPrice:98.40,action:'add'},
                {ticker:'DFIV',name:'DFA Intl Value ETF',wt:3.6,wtChg:-0.4,avgPrice:32.80,action:'hold'},
                {ticker:'DFLV',name:'DFA US Large Value ETF',wt:2.8,wtChg:+0.4,avgPrice:42.80,action:'add'},
                {ticker:'DFAC',name:'DFA US Core Equity 2',wt:2.4,wtChg:+0.2,avgPrice:33.80,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:1.8,wtChg:+0.4,avgPrice:162.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.6,wtChg:+0.6,avgPrice:518.80,action:'add'},
                {ticker:'AVUV2',name:'DFA US Small Cap Value',wt:3.2,wtChg:+0.4,avgPrice:46.80,action:'add'},
                {ticker:'DFEM',name:'DFA EM Core ETF',wt:2.0,wtChg:-0.2,avgPrice:28.80,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.4,wtChg:+0.2,avgPrice:208.80,action:'hold'},
                {ticker:'V',name:'Visa Inc',wt:1.2,wtChg:+0.1,avgPrice:266.80,action:'hold'},
                {ticker:'VEA',name:'Vanguard Dev Mkts ETF',wt:1.0,wtChg:+0.2,avgPrice:51.80,action:'hold'},
            ],
            insight:'디멘셔널은 유진 파마의 팩터 이론(가치·소형·수익성)을 실천하는 운용사. AI 빅테크를 시가총액 비중으로 자동 편입하면서, 소형가치(AVUV) 팩터로 알파 추구. 체계적·학문적 접근이 장기 초과수익의 원천.'
        },
        {
            id:'mfs', name:'MFS Investment Management', manager:'Carol Geremia',
            aum:620, top3:[{ticker:'MSFT',wt:4.6},{ticker:'NVDA',wt:4.0},{ticker:'AAPL',wt:3.4}],
            emoji:'🎓',
            tags:['최초뮤추얼펀드','장기액티브','가치성장'],
            holdings:[
                {ticker:'MSFT',name:'Microsoft Corp',wt:4.6,wtChg:+1.2,avgPrice:394.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:4.0,wtChg:+2.4,avgPrice:100.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:3.4,wtChg:-0.4,avgPrice:166.80,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.8,wtChg:+0.8,avgPrice:174.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:2.4,wtChg:+0.8,avgPrice:840.80,action:'add'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:2.0,wtChg:+0.4,avgPrice:538.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:1.8,wtChg:+0.4,avgPrice:160.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.6,wtChg:+0.8,avgPrice:516.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.4,wtChg:+0.2,avgPrice:264.80,action:'hold'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.2,wtChg:+0.4,avgPrice:212.80,action:'add'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.0,wtChg:+0.2,avgPrice:206.80,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:0.9,wtChg:+0.4,avgPrice:200.80,action:'add'},
                {ticker:'HD',name:'Home Depot',wt:0.8,wtChg:0,avgPrice:370.80,action:'hold'},
                {ticker:'COST',name:'Costco Wholesale',wt:0.7,wtChg:0,avgPrice:912.80,action:'hold'},
                {ticker:'NFLX',name:'Netflix Inc',wt:0.6,wtChg:+0.4,avgPrice:936.80,action:'add'},
            ],
            insight:'MFS(매사추세츠파이낸셜)는 미국 최초 뮤추얼펀드 회사. 100년 역사의 장기 액티브 투자 철학. NVDA를 TOP2 비중으로 올리며 AI 혁명에 적극 동참. LLY·UNH는 AI 헬스케어 융합 성장의 구조적 수혜 포지션.'
        },
        {
            id:'carlyle', name:'Carlyle Group', manager:'Harvey Schwartz',
            aum:435, top3:[{ticker:'NVDA',wt:5.2},{ticker:'MSFT',wt:3.8},{ticker:'GOOGL',wt:3.2}],
            emoji:'🏰',
            tags:['PE대체투자','방산·AI','크레딧'],
            holdings:[
                {ticker:'NVDA',name:'NVIDIA Corp',wt:5.2,wtChg:+3.6,avgPrice:98.80,action:'add'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.8,wtChg:+1.4,avgPrice:392.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:3.2,wtChg:+1.2,avgPrice:170.80,action:'add'},
                {ticker:'LMT',name:'Lockheed Martin',wt:2.8,wtChg:+0.8,avgPrice:562.80,action:'add'},
                {ticker:'RTX',name:'RTX Corp (Raytheon)',wt:2.4,wtChg:+0.6,avgPrice:138.80,action:'add'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:2.0,wtChg:+2.0,avgPrice:74.80,action:'new'},
                {ticker:'AAPL',name:'Apple Inc',wt:1.8,wtChg:-0.4,avgPrice:164.80,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:1.6,wtChg:+0.8,avgPrice:514.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:1.4,wtChg:+0.6,avgPrice:172.80,action:'add'},
                {ticker:'NOC',name:'Northrop Grumman',wt:1.2,wtChg:+0.4,avgPrice:476.80,action:'add'},
                {ticker:'GD',name:'General Dynamics',wt:1.0,wtChg:+0.2,avgPrice:278.80,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:0.9,wtChg:+0.4,avgPrice:198.80,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:0.8,wtChg:+0.4,avgPrice:210.80,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:0.7,wtChg:+0.7,avgPrice:292.80,action:'new'},
                {ticker:'HII',name:'Huntington Ingalls Industries',wt:0.6,wtChg:+0.2,avgPrice:282.80,action:'hold'},
            ],
            insight:'칼라일은 PE 배경의 방산+AI 이중 포지션이 특징. NVDA를 TOP1 비중으로 적극 편입하면서 방산주(LMT·RTX)도 동시 보유 — "AI+방위"라는 미래 안보 테마 투자. PLTR 신규 편입은 AI 국방 플랫폼 베팅.'
        },
        {
            id:'bridgewaterking', name:'Bridgewater Associates', manager:'Nir Bar Dea',
            aum:124, top3:[{ticker:'SPY',wt:8.6},{ticker:'GLD',wt:7.4},{ticker:'EEM',wt:5.8}],
            emoji:'🌊',
            tags:['레이달리오유산','올웨더','글로벌매크로'],
            holdings:[
                {ticker:'SPY',name:'SPDR S&P500 ETF',wt:8.6,wtChg:+2.4,avgPrice:578.80,action:'add'},
                {ticker:'GLD',name:'SPDR Gold ETF',wt:7.4,wtChg:+3.2,avgPrice:192.80,action:'add'},
                {ticker:'EEM',name:'iShares MSCI EM ETF',wt:5.8,wtChg:+1.6,avgPrice:44.80,action:'add'},
                {ticker:'TLT',name:'iShares 20Y+ Treasury',wt:6.4,wtChg:-2.4,avgPrice:86.80,action:'reduce'},
                {ticker:'IEF',name:'iShares 7-10Y Treasury',wt:5.2,wtChg:-1.2,avgPrice:96.80,action:'reduce'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:2.6,wtChg:+2.6,avgPrice:96.80,action:'new'},
                {ticker:'VWO',name:'Vanguard FTSE EM ETF',wt:4.2,wtChg:+0.8,avgPrice:44.80,action:'add'},
                {ticker:'DBC',name:'Invesco DB Commodity ETF',wt:3.8,wtChg:+1.2,avgPrice:24.80,action:'add'},
                {ticker:'IAU',name:'iShares Gold ETF',wt:3.4,wtChg:+1.6,avgPrice:40.80,action:'add'},
                {ticker:'SLV',name:'iShares Silver ETF',wt:2.8,wtChg:+0.8,avgPrice:28.80,action:'add'},
                {ticker:'PDBC',name:'Invesco Optimum Yield Comm',wt:2.4,wtChg:+0.6,avgPrice:14.80,action:'add'},
                {ticker:'FXI',name:'iShares China Large-Cap',wt:2.0,wtChg:-0.6,avgPrice:28.80,action:'reduce'},
                {ticker:'EWZ',name:'iShares Brazil ETF',wt:1.6,wtChg:+0.4,avgPrice:32.80,action:'add'},
                {ticker:'GSG',name:'iShares Commodity Idx',wt:1.4,wtChg:+0.4,avgPrice:22.80,action:'add'},
                {ticker:'CPER',name:'US Copper Index ETF',wt:1.2,wtChg:+0.4,avgPrice:24.40,action:'add'},
            ],
            insight:'브리지워터는 레이 달리오의 올웨더 유산 계승. 금(GLD) 비중 대폭 확대로 달러 약세·인플레 헤지 강화. 동시에 NVDA 신규 편입 — 전통 매크로 하우스의 AI 혁명 수용. 채권 비중은 금리 불확실성으로 축소.'
        },
        {
            id:'mangroup', name:'Man Group', manager:'Robyn Grew',
            aum:175, top3:[{ticker:'MSFT',wt:4.4},{ticker:'NVDA',wt:4.0},{ticker:'AAPL',wt:3.2}],
            emoji:'🎩',
            tags:['퀀트CTA','AI시스템','글로벌'],
            holdings:[
                {ticker:'MSFT',name:'Microsoft Corp',wt:4.4,wtChg:+1.6,avgPrice:390.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:4.0,wtChg:+2.8,avgPrice:94.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:3.2,wtChg:-0.6,avgPrice:162.80,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.8,wtChg:+0.8,avgPrice:170.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:2.4,wtChg:+1.2,avgPrice:524.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.0,wtChg:+0.6,avgPrice:166.80,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.8,wtChg:+0.4,avgPrice:208.80,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.6,wtChg:+0.6,avgPrice:196.80,action:'add'},
                {ticker:'APP',name:'Applovin Corp',wt:1.4,wtChg:+1.4,avgPrice:290.80,action:'new'},
                {ticker:'PLTR',name:'Palantir Technologies',wt:1.2,wtChg:+1.2,avgPrice:76.80,action:'new'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.0,wtChg:+0.4,avgPrice:820.80,action:'add'},
                {ticker:'CRWD',name:'CrowdStrike Holdings',wt:0.9,wtChg:+0.9,avgPrice:348.80,action:'new'},
                {ticker:'QQQ',name:'Invesco QQQ Trust',wt:0.8,wtChg:-0.4,avgPrice:460.80,action:'reduce'},
                {ticker:'SPY',name:'SPDR S&P 500 ETF',wt:0.7,wtChg:-0.2,avgPrice:574.80,action:'hold'},
                {ticker:'IWM',name:'iShares Russell 2000 ETF',wt:0.6,wtChg:+0.2,avgPrice:204.80,action:'hold'},
            ],
            insight:'맨그룹은 세계 최대 상장 헤지펀드. AHL 퀀트 CTA와 GLG 재량 팀의 결합 구조. AI가 팩터 신호를 강화하면서 NVDA를 TOP2 비중으로 올림. 자체 AI 시스템 개발에도 NVDA 인프라를 직접 사용하는 선순환.'
        },
        {
            id:'aqr', name:'AQR Capital Management', manager:'Cliff Asness',
            aum:120, top3:[{ticker:'MSFT',wt:3.8},{ticker:'NVDA',wt:3.4},{ticker:'AAPL',wt:3.0}],
            emoji:'🔬',
            tags:['퀀트팩터','학문기반','멀티팩터'],
            holdings:[
                {ticker:'MSFT',name:'Microsoft Corp',wt:3.8,wtChg:+1.2,avgPrice:386.80,action:'add'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.4,wtChg:+2.0,avgPrice:90.80,action:'add'},
                {ticker:'AAPL',name:'Apple Inc',wt:3.0,wtChg:-0.6,avgPrice:158.80,action:'hold'},
                {ticker:'AMZN',name:'Amazon.com Inc',wt:2.6,wtChg:+0.6,avgPrice:166.80,action:'add'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.2,wtChg:+0.4,avgPrice:162.80,action:'add'},
                {ticker:'META',name:'Meta Platforms',wt:1.8,wtChg:+0.8,avgPrice:520.80,action:'add'},
                {ticker:'TSLA',name:'Tesla Inc',wt:1.6,wtChg:+0.4,avgPrice:206.80,action:'add'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:1.4,wtChg:+0.4,avgPrice:194.80,action:'add'},
                {ticker:'LLY',name:'Eli Lilly & Co',wt:1.2,wtChg:+0.4,avgPrice:818.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.0,wtChg:+0.2,avgPrice:262.80,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:0.9,wtChg:+0.2,avgPrice:204.80,action:'hold'},
                {ticker:'HML',name:'Vanguard Value ETF',wt:2.4,wtChg:+0.6,avgPrice:162.80,action:'add'},
                {ticker:'UMD',name:'iShares Momentum ETF',wt:1.8,wtChg:+0.8,avgPrice:282.80,action:'add'},
                {ticker:'QUAL',name:'iShares MSCI Quality ETF',wt:1.4,wtChg:+0.4,avgPrice:182.80,action:'add'},
                {ticker:'VTV',name:'Vanguard Value ETF',wt:1.2,wtChg:+0.4,avgPrice:154.80,action:'add'},
            ],
            insight:'클리프 에스네스의 AQR은 가치·모멘텀·캐리 팩터 복합 운용의 선구자. AI 모멘텀 팩터가 NVDA·MSFT에 강한 매수 신호를 생성. "AI 거품론"을 주장하던 에스네스도 AI 모멘텀 팩터 앞에서 포지션 확대.'
        },
        {
            id:'northerntrust', name:'Northern Trust Asset Mgmt', manager:'Jason Tyler',
            aum:1200, top3:[{ticker:'AAPL',wt:4.8},{ticker:'MSFT',wt:4.4},{ticker:'NVDA',wt:3.8}],
            emoji:'🏔️',
            tags:['패시브','기관자산','글로벌분산'],
            holdings:[
                {ticker:'AAPL',name:'Apple Inc',wt:4.8,wtChg:-0.2,avgPrice:185.60,action:'hold'},
                {ticker:'MSFT',name:'Microsoft Corp',wt:4.4,wtChg:+0.2,avgPrice:421.40,action:'hold'},
                {ticker:'NVDA',name:'NVIDIA Corp',wt:3.8,wtChg:+0.7,avgPrice:127.80,action:'add'},
                {ticker:'AMZN',name:'Amazon.com',wt:3.0,wtChg:+0.2,avgPrice:197.40,action:'hold'},
                {ticker:'GOOGL',name:'Alphabet Inc',wt:2.6,wtChg:0,avgPrice:171.60,action:'hold'},
                {ticker:'META',name:'Meta Platforms',wt:2.2,wtChg:+0.3,avgPrice:549.60,action:'add'},
                {ticker:'BRK.B',name:'Berkshire Hathaway B',wt:1.9,wtChg:-0.1,avgPrice:483.40,action:'hold'},
                {ticker:'LLY',name:'Eli Lilly',wt:1.5,wtChg:+0.2,avgPrice:820.80,action:'add'},
                {ticker:'V',name:'Visa Inc',wt:1.3,wtChg:+0.1,avgPrice:260.80,action:'hold'},
                {ticker:'JPM',name:'JPMorgan Chase',wt:1.1,wtChg:+0.1,avgPrice:202.80,action:'hold'},
                {ticker:'AVGO',name:'Broadcom Inc',wt:0.9,wtChg:+0.2,avgPrice:192.80,action:'add'},
                {ticker:'UNH',name:'UnitedHealth Group',wt:0.8,wtChg:-0.1,avgPrice:518.80,action:'hold'},
                {ticker:'HD',name:'Home Depot',wt:0.7,wtChg:0,avgPrice:366.80,action:'hold'},
                {ticker:'COST',name:'Costco Wholesale',wt:0.6,wtChg:0,avgPrice:908.80,action:'hold'},
                {ticker:'PG',name:'Procter & Gamble',wt:0.5,wtChg:0,avgPrice:160.80,action:'hold'},
            ],
            insight:'노던트러스트는 초고액 자산가·연기금 특화 커스터디 & 자산운용사. 인덱스 패시브 전략이 주력으로 NVDA 비중 확대는 지수 내 시총 증가를 반영. 안정적인 기관 수요와 낮은 회전율이 특징.'
        },
    ];

    // 현재 딥다이브 모드 ('hot' | 'kingdom')
    let smDeepMode = 'hot';

    // 헤더 시장 테마/qnav 복원 (Discover 페이지에서 숨겨졌을 수 있음)
    // 시장 온도계는 홈에서만 노출 → 비홈 페이지에서는 항상 숨김
    function _restoreHeaderChrome() {
        const t = document.getElementById('marketThermometer');
        if (t) t.style.display = 'none';
        const q = document.getElementById('headerQNav');
        if (q) q.style.display = '';
        // 데일리 트레이딩 스캐너 화면 숨김 (다른 화면으로 이동 시 겹침 방지)
        const _dts = document.getElementById('dailyTradingScreen');
        if (_dts) _dts.style.display = 'none';
        // 바텀 네비 복원 — 종목 상세 showStockPager 가 박은 인라인 display:none 해제.
        // (종목 상세 → 사이드 메뉴로 다른 화면 이동 시 바텀네비가 사라지던 문제)
        const _bn = document.getElementById('bottomNav');
        if (_bn) _bn.style.display = '';
        document.body.classList.remove('stock-pager-active');
    }

    function goSmartMoney() {
        _pushRoute('smartmoney');
        window._lastScreen = 'smartMoney';
        _restoreHeaderChrome();
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('alphaScannerScreen').style.display = 'none';
        document.getElementById('favScreen').style.display = 'none';
        document.getElementById('visionScannerScreen').style.display = 'none';
        document.getElementById('economicSection').style.display = 'none';
        const _ern1 = document.getElementById('earningsScreen'); if (_ern1) _ern1.style.display = 'none';
        const _lev1 = document.getElementById('leverageScreen'); if (_lev1) _lev1.style.display = 'none';
        const _t100SM = document.getElementById('top100Screen'); if (_t100SM) _t100SM.style.display = 'none';
        document.getElementById('catalystScreen')?.style && (document.getElementById('catalystScreen').style.display = 'none');
        const _posSM = document.getElementById('positionScreen'); if (_posSM) _posSM.style.display = 'none';
        document.getElementById('smartMoneyScreen').style.display = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded'); const _fab=document.getElementById('calcFab'); if(_fab)_fab.style.display='none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('sideNavSmBtn')?.classList.add('active');
        document.querySelectorAll('.hqnav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('hqSm')?.classList.add('active');
        try { updateBnActive('all'); } catch(e) {}
        renderSmTop10();
        renderSmGuru();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }


    // ========================================
    // Alpha Scanner
    // ========================================
    function goScanner() {
        _pushRoute('scanner');
        window._lastScreen = 'scanner';
        _restoreHeaderChrome();
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('smartMoneyScreen').style.display = 'none';
        document.getElementById('favScreen').style.display = 'none';
        document.getElementById('visionScannerScreen').style.display = 'none';
        const _ern2 = document.getElementById('earningsScreen'); if (_ern2) _ern2.style.display = 'none';
        const _lev2 = document.getElementById('leverageScreen'); if (_lev2) _lev2.style.display = 'none';
        const _t100S = document.getElementById('top100Screen'); if (_t100S) _t100S.style.display = 'none';
        const _catS  = document.getElementById('catalystScreen'); if (_catS) _catS.style.display = 'none';
        document.getElementById('alphaScannerScreen').style.display = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded'); const _fab=document.getElementById('calcFab'); if(_fab)_fab.style.display='none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));
        updateBnActive('scanner');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // 진입 시 항상 맨 왼쪽 탭(과매도)으로 초기화 + 탭 바 왼쪽으로 스크롤
        _alphaSwitchTab('bounce');
        const _at = document.getElementById('alphaTabs');
        if (_at) { _at.scrollLeft = 0; requestAnimationFrame(() => { _at.scrollLeft = 0; }); }
    }

    // ═══════════════════════════════════════════════════════════
    // 알파 스캐너 v2 — 4가지 분석 카테고리
    //   - surge   : 급등 예상 (거래량 급증 + 모멘텀)
    //   - bounce  : 과매도 (RSI 극저 + 200일선 이격)
    //   - daytrade: 단타 진입 (ATR·거래량·당일 변동성 강한 종목)
    //   - swing   : 스윙 진입 (R/R ≥ 1.5, 52주 고점까지 여유)
    // ═══════════════════════════════════════════════════════════
    let _alphaTab = 'bounce';

    // ── 과매도 탭 필터 — 거래대금·시총 (v689) ───────────────────
    // 거래대금: all / mid($5M+) / high($20M+) · 시총: all / mid($300M+) / high($2B+)
    const _BOUNCE_VOL_TH  = { mid: 5e6,  high: 20e6 };
    const _BOUNCE_MCAP_TH = { mid: 3e8,  high: 2e9  };
    let _bounceVolFilter  = (() => { try { return localStorage.getItem('bounceVolFilter')  || 'mid'; } catch(e) { return 'mid'; } })();
    let _bounceMcapFilter = (() => { try { return localStorage.getItem('bounceMcapFilter') || 'mid'; } catch(e) { return 'mid'; } })();
    let _bounceAllResults = [];

    function _bounceSetFilter(kind, val) {
        if (kind === 'vol')  { _bounceVolFilter  = val; try { localStorage.setItem('bounceVolFilter',  val); } catch(e){} }
        else                 { _bounceMcapFilter = val; try { localStorage.setItem('bounceMcapFilter', val); } catch(e){} }
        _bounceApplyAndRender();
    }

    function _bouncePassesFilter(q) {
        const dollarVol = (q.price || 0) * (q.volume || 0);
        const mcap = q.marketCap || 0;
        if (_bounceVolFilter !== 'all' && dollarVol < _BOUNCE_VOL_TH[_bounceVolFilter]) return false;
        // 시총 0(데이터 없음)은 필터 통과시킴 — 데이터 누락으로 인한 누락 방지
        if (_bounceMcapFilter !== 'all' && mcap > 0 && mcap < _BOUNCE_MCAP_TH[_bounceMcapFilter]) return false;
        return true;
    }

    function _bounceFilterBarHtml(shownCount) {
        const volChip  = (v, label) => `<button class="surge-filter ${_bounceVolFilter===v?'active':''}" onclick="_bounceSetFilter('vol','${v}')">${label}</button>`;
        const mcapChip = (v, label) => `<button class="surge-filter ${_bounceMcapFilter===v?'active':''}" onclick="_bounceSetFilter('mcap','${v}')">${label}</button>`;
        return `<div class="bounce-filter-box">
            <div class="bounce-filter-row">
                <span class="bounce-filter-label">💵 거래대금</span>
                <div class="surge-filter-bar">${volChip('all','전체')}${volChip('mid','$5M+')}${volChip('high','$20M+')}</div>
            </div>
            <div class="bounce-filter-row">
                <span class="bounce-filter-label">🏢 시가총액</span>
                <div class="surge-filter-bar">${mcapChip('all','전체')}${mcapChip('mid','$300M+')}${mcapChip('high','$2B+')}</div>
            </div>
            <div class="bounce-filter-count">필터 결과 <b>${shownCount}</b>개 · 저거래·초소형 페니주 제외</div>
        </div>`;
    }

    function _bounceApplyAndRender() {
        const filtered = (_bounceAllResults || []).filter(_bouncePassesFilter);
        _alphaRender(filtered, 'bounce', _bounceFilterBarHtml(filtered.length));
    }

    // ── AI 판정 필터 — 매수/관망/회피 (v690) ────────────────────
    // AI 일괄 분석(상위 15개)의 verdict 로 카드 show/hide. 칩 = 전체/매수/관망/회피
    const _ALPHA_AI_TABS = new Set(['bounce', 'swing', 'sepa', 'daytrade']);
    let _alphaVerdictFilter = (() => { try { return localStorage.getItem('alphaVerdictFilter') || 'all'; } catch(e) { return 'all'; } })();

    function _alphaVerdictBarHtml() {
        const chip = (v, label) => `<button class="surge-filter ${_alphaVerdictFilter===v?'active':''}" data-vchip="${v}" onclick="_alphaSetVerdictFilter('${v}')">${label}</button>`;
        return `<div class="bounce-filter-box">
            <div class="bounce-filter-row">
                <span class="bounce-filter-label">🤖 AI 판정</span>
                <div class="surge-filter-bar">${chip('all','전체')}${chip('buy','🟢 매수')}${chip('관망','🟡 관망')}${chip('회피','🔴 회피')}</div>
            </div>
            <div class="bounce-filter-count" id="alphaVerdictNote">🤖 AI가 상위 15개 종목을 분석합니다 — 분석 완료 후 필터가 적용됩니다</div>
        </div>`;
    }

    function _alphaVerdictApply() {
        const f = _alphaVerdictFilter;
        document.querySelectorAll('[data-vchip]').forEach(b => b.classList.toggle('active', b.dataset.vchip === f));
        const cards = document.querySelectorAll('#alphaResults .alpha-card');
        let shown = 0, analyzed = 0;
        cards.forEach(card => {
            const v = card.dataset.verdict || '';
            if (v) analyzed++;
            let match;
            if (f === 'all') match = true;
            else if (!v) match = false;                       // 미분석 카드는 필터 시 숨김
            else if (f === 'buy') match = (v === '매수' || v === '강한매수');
            else match = (v === f);
            card.style.display = match ? '' : 'none';
            if (match) shown++;
        });
        const note = document.getElementById('alphaVerdictNote');
        if (note) {
            note.textContent = f === 'all'
                ? `🤖 AI 상위 15개 분석 — ${analyzed}개 판정 완료`
                : `🤖 '${f==='buy'?'매수':f}' ${shown}개 표시 · AI 분석은 상위 15개 종목 한정`;
        }
    }

    function _alphaSetVerdictFilter(v) {
        _alphaVerdictFilter = v;
        try { localStorage.setItem('alphaVerdictFilter', v); } catch(e) {}
        _alphaVerdictApply();
    }

    const _ALPHA_DESC = {
        bounce:   '교과서적 과매도 종목 — RSI ≤ 30, MA200 -15%↓ 이격, 52주 고점 -30%↓ 폭락 중 하나 이상 충족.',
        daytrade: '단타 진입 (당일~5일) — Volume Profile (POC/VAH/VAL) + 모멘텀 기반. 레버리지 ETF·소형주 위주. VAL 반등 / VAH 돌파 신호 포착.',
        swing:    '52주 고점까지 충분한 상승 여력(R/R ≥ 1.5)이 있고 추세가 살아있는 종목 — 며칠~몇 주 단위 스윙에 적합합니다.',
        sepa:     'Mark Minervini SEPA — 트렌드 템플릿 8조건 + VCP + RS + 거래량 4박자 종합점수 70+ 종목 발굴.',
        volSurge: '비정상 거래량 급증 — 평균 대비 5배+ 거래량 폭증 종목. "누가 알고 사고 있다" 신호. Micro/Small Cap 위주로 급등 전 조기 포착.',
        social:   '소셜 트렌드 — Reddit(ApeWisdom) 멘션 급증 + StockTwits 트렌딩 + 거래량 폭증 통합 점수. AI 심층 분석으로 펌프앤덤프 의심도 검증 필수.',
    };

    // ─── 알파 카드 헬퍼 ──────────────────────────────────────
    // 테마 추정 (티커/이름 휴리스틱)
    function _alphaTheme(q) {
        const sym = (q.symbol || q.ticker || '').toUpperCase();
        const name = (q.name || q.shortName || q.longName || '').toUpperCase();
        const blob = sym + ' ' + name;
        if (/NVDA|AMD|TSMC|MU|MRVL|AVGO|ASML|LRCX|AMAT|SMCI|INTEL|INTC|QCOM|반도체|SEMI/.test(blob)) return 'AI반도체';
        if (/PLTR|SNOW|DDOG|NET|ALAB|ANET|VRT|AI/.test(blob)) return 'AI인프라';
        if (/MSTR|COIN|MARA|RIOT|CLSK|BTC|BITCOIN/.test(blob)) return 'BTC채굴';
        if (/TSLA|RIVN|LCID|NIO|XPEV|LI|FORD|GM/.test(blob)) return 'EV';
        if (/LMT|RTX|NOC|GD|BA|방산/.test(blob)) return '우주/국방';
        if (/PFE|JNJ|MRK|LLY|BIIB|MRNA|NVO|바이오|BIO/.test(blob)) return '바이오';
        if (/DIS|NFLX|RBLX|SPOT|미디어/.test(blob)) return '미디어';
        if (/V|MA|PYPL|SQ|SOFI|HOOD|핀테크/.test(blob)) return '핀테크';
        if (/AMZN|WMT|COST|HD|TGT/.test(blob)) return '리테일';
        if (/XOM|CVX|OXY|에너지/.test(blob)) return '에너지';
        if (/IONQ|RGTI|QBTS|QUANTUM/.test(blob)) return '양자컴';
        if (/OKLO|NUE|SMR|NUSCALE|핵발전/.test(blob)) return '원자력';
        return '기타';
    }

    // 리스크 등급 (변동성 기반)
    function _alphaRisk(q) {
        const chg = Math.abs(q.changePct ?? q.regularMarketChangePercent ?? 0);
        const price = q.price || q.regularMarketPrice || 0;
        if (chg >= 15 || price < 5) return 'extreme';
        if (chg >= 8 || price < 10) return 'high';
        if (chg >= 4) return 'medium';
        return 'low';
    }

    // 타이밍 정보 (탭별 한국시간 가이드)
    function _alphaTimingGuide(tab) {
        if (tab === 'bounce') {
            return `<div class="alpha-timing-card">
                <div class="alpha-timing-title alpha-timing-title--blue">⏰ 과매도 스캐너 최적 시간 (한국 기준)</div>
                <div class="alpha-timing-row alpha-time-best"><span class="alpha-time-bullet">●</span><span class="alpha-time-when">06:00~08:00</span><span class="alpha-time-desc">미국장 마감 직후 → 오늘 하락 종목 확정, 반등 후보 가장 신선</span></div>
                <div class="alpha-timing-row alpha-time-good"><span class="alpha-time-bullet">●</span><span class="alpha-time-when">02:00~05:00</span><span class="alpha-time-desc">장 중 → 실시간 급락 종목 포착, 당일 반등 노릴 때</span></div>
                <div class="alpha-timing-row alpha-time-skip"><span class="alpha-time-bullet">○</span><span class="alpha-time-when">23:30 이전</span><span class="alpha-time-desc">장 시작 전 → 전날 데이터 기준, 참고용으로만</span></div>
            </div>`;
        } else if (tab === 'daytrade') {
            return `<div class="alpha-timing-card">
                <div class="alpha-timing-title alpha-timing-title--cyan">⏰ 단타 진입 최적 시간 (한국 기준)</div>
                <div class="alpha-timing-row alpha-time-best"><span class="alpha-time-bullet">●</span><span class="alpha-time-when">23:30~01:00</span><span class="alpha-time-desc">미국 개장 직후 → 변동성 극대, 거래량 가장 활발</span></div>
                <div class="alpha-timing-row alpha-time-good"><span class="alpha-time-bullet">●</span><span class="alpha-time-when">04:00~05:00</span><span class="alpha-time-desc">마감 1시간 전 → 종가 베팅 + 단기 모멘텀</span></div>
            </div>`;
        } else if (tab === 'swing') {
            return `<div class="alpha-timing-card">
                <div class="alpha-timing-title alpha-timing-title--purple">⏰ 스윙 진입 최적 시간 (한국 기준)</div>
                <div class="alpha-timing-row alpha-time-best"><span class="alpha-time-bullet">●</span><span class="alpha-time-when">06:00~09:00</span><span class="alpha-time-desc">미국장 마감 직후 → R/R 비율 신선, 며칠 보유 계획 수립</span></div>
                <div class="alpha-timing-row alpha-time-good"><span class="alpha-time-bullet">●</span><span class="alpha-time-when">화/수 저녁</span><span class="alpha-time-desc">주간 진입 → 금요일까지 보유 흐름 잡기 좋음</span></div>
            </div>`;
        } else if (tab === 'dante') {
            return `<div class="alpha-timing-card">
                <div class="alpha-timing-title alpha-timing-title--amber">⏰ 단테 스캐너 — 단타 기법 발굴 최적 시간</div>
                <div class="alpha-timing-row alpha-time-best"><span class="alpha-time-bullet">●</span><span class="alpha-time-when">22:00~23:00</span><span class="alpha-time-desc">프리마켓 직전 → 시그널 종목 가장 신선, 즉시 진입 가능</span></div>
                <div class="alpha-timing-row alpha-time-good"><span class="alpha-time-bullet">●</span><span class="alpha-time-when">23:30~01:00</span><span class="alpha-time-desc">개장 직후 변동성 활용 → 단테 패턴 실전 검증</span></div>
                <div class="alpha-timing-row alpha-time-skip"><span class="alpha-time-bullet">○</span><span class="alpha-time-when">11:00~18:00</span><span class="alpha-time-desc">시그널 신선도 낮음 — 참고용으로만</span></div>
            </div>`;
        }
        return '';
    }

    // 알파 스캐너 탭별 렌더 결과 캐시 (3분) — 탭 재클릭 시 API 재호출 방지
    const _alphaTabCache = {};
    const ALPHA_TAB_TTL = 3 * 60 * 1000;

    async function _alphaSwitchTab(tab) {
        _alphaTab = tab;
        document.querySelectorAll('.alpha-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
        });
        const descEl = document.getElementById('alphaDesc');
        if (descEl) descEl.textContent = _ALPHA_DESC[tab] || '';
        // 단타 진입 탭일 때만 필터 행 노출
        const filterRow = document.getElementById('alphaDaytradeFilters');
        if (filterRow) filterRow.style.display = (tab === 'daytrade') ? '' : 'none';
        const el = document.getElementById('alphaResults');
        if (!el) return;
        // ── 캐시 확인: 3분 이내 로드된 탭이면 재렌더링 없이 즉시 복원 ──
        const _cachedTab = _alphaTabCache[tab];
        if (_cachedTab && Date.now() - _cachedTab.ts < ALPHA_TAB_TTL) {
            el.innerHTML = _cachedTab.html;
            return;
        }
        el.innerHTML = _alphaTimingGuide(tab) + '<div class="sniper-loading">' + Array(6).fill('<div class="sniper-skel"></div>').join('') + '</div>';
        try {
            if (tab === 'bounce') {
                const r = await fetch('/api/oversold-radar?tab=oversold');
                if (!r.ok) throw new Error('http ' + r.status);
                const d = await r.json();
                const items = (d.items || []);
                const scored = items
                    .filter(item => _isClearlyOversold(item))
                    .map(item => ({ item, signals: _calcBounceScore(item) }))
                    .sort((a, b) => b.signals.length - a.signals.length)
                    .slice(0, 100)
                    .map(({ item, signals }) => ({ ...item, _alphaKind: 'bounce', _bounceSignals: signals }));
                if (_alphaTab !== 'bounce') return;
                _bounceAllResults = scored;
                _bounceApplyAndRender();
            } else if (tab === 'daytrade') {
                await _alphaRenderBreakoutScanner(el);
            } else if (tab === 'swing') {
                let items = (top100Cache?.['day_gainers']?.items) || [];
                if (!items.length) {
                    try {
                        const r = await fetch('/api/screener/day_gainers?count=100');
                        if (r.ok) {
                            const d = await r.json();
                            items = d?.finance?.result?.[0]?.quotes || [];
                            if (items.length) top100Cache['day_gainers'] = { items, ts: Date.now() };
                        }
                    } catch(e) { warn('[alpha day_gainers fetch]', e); }
                }
                if (_alphaTab !== tab) return;
                if (!items.length) {
                    el.innerHTML = _alphaTimingGuide(tab) + '<div class="sniper-empty">데이터를 불러올 수 없습니다 — 잠시 후 다시 시도하세요</div>';
                    return;
                }
                {
                    const qualified = items.map(q => {
                        const p = q.regularMarketPrice, h = q.fiftyTwoWeekHigh;
                        if (!p || !h || h <= p) return null;
                        const rr = (h - p) / (p * 0.05);
                        return rr >= 1.5 ? { ...q, _rr: rr, _alphaKind: 'swing' } : null;
                    }).filter(Boolean).sort((a, b) => b._rr - a._rr).slice(0, 30);
                    _alphaRender(qualified, tab);
                }
            } else if (tab === 'sepa') {
                await _alphaRenderSEPAScanner(el);
            } else if (tab === 'volSurge') {
                await _alphaRenderVolSurge(el);
            } else if (tab === 'social') {
                await _alphaRenderSocialScanner(el);
            }
            // ── 렌더 성공 시 결과 HTML 스냅샷 캐시 (3분) ──
            // 로딩 스켈레톤·에러 메시지 상태는 캐시하지 않음 (API 복구 후에도 에러 고착 방지)
            const _h = el.innerHTML || '';
            if (_alphaTab === tab && _h
                && !_h.includes('sniper-loading')
                && !_h.includes('데이터 로드 실패')
                && !_h.includes('불러올 수 없습니다')) {
                _alphaTabCache[tab] = { ts: Date.now(), html: _h };
            }
        } catch (e) {
            console.error('[alphaSwitchTab]', e);
            if (_alphaTab === tab) {
                el.innerHTML = _alphaTimingGuide(tab)
                    + '<div class="sniper-empty">⚠️ 데이터를 불러올 수 없습니다 — 잠시 후 다시 시도해주세요'
                    + '<button onclick="_alphaSwitchTab(\'' + tab + '\')" '
                    + 'style="margin-top:10px;display:block;margin-inline:auto;padding:6px 18px;'
                    + 'border-radius:8px;border:1px solid var(--border);background:var(--bg2);'
                    + 'color:var(--text1);cursor:pointer;font-size:13px;">🔄 다시 시도</button></div>';
            }
        }
    }

    // ── 거래량 급증 스캐너 — Pre-Pump 감지 ──────────────────────────
    async function _alphaRenderVolSurge(el) {
        el.innerHTML = '<div class="sniper-loading">' + Array(6).fill('<div class="sniper-skel"></div>').join('') + '</div>';
        try {
            const r = await fetch('/api/scanner/volume-surge');
            if (!r.ok) throw new Error('http ' + r.status);
            const d = await r.json();

            if (!d.stocks || d.stocks.length === 0) {
                el.innerHTML = '<div class="sniper-empty">현재 거래량 급증 종목 없음</div>';
                return;
            }

            const scannedLabel = `<div style="font-size:11px;color:var(--text3);padding:2px 0 6px;">
                ${d.total}종목 스캔 · ${new Date(d.scannedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 기준 · 5분 캐시
            </div>`;

            // API 데이터를 _alphaRenderCard 포맷으로 변환
            const items = d.stocks.map(s => ({
                symbol:                     s.symbol,
                name:                       s.name || s.symbol,
                price:                      s.price,
                regularMarketPrice:         s.price,
                changePct:                  s.changePct || 0,
                regularMarketChangePercent: s.changePct || 0,
                marketCap:                  s.marketCap,
                _alphaKind:                 'volSurge',
                _volRatio:                  s.volRatio,
                _surgeScore:                s.surgeScore,
                _marketCapTier:             s.marketCapTier,
            }));

            _alphaRender(items, 'volSurge', scannedLabel);
        } catch(e) {
            el.innerHTML = `<div class="sniper-empty">⚠️ 데이터를 불러올 수 없어요
                <button onclick="_alphaSwitchTab('volSurge')"
                    style="margin-top:10px;display:block;margin-inline:auto;padding:6px 18px;
                    border-radius:8px;border:1px solid var(--border);background:var(--bg2);
                    color:var(--text1);cursor:pointer;font-size:13px;">🔄 다시 시도</button></div>`;
        }
    }

    // ── 소셜 트렌드 스캐너 (v678) — ApeWisdom + StockTwits 통합 ──────
    let _socialAiCache = {}; // 클라이언트 메모리 (ticker → AI 결과)
    async function _alphaRenderSocialScanner(el) {
        el.innerHTML = '<div class="sniper-loading">' + Array(6).fill('<div class="sniper-skel"></div>').join('') + '</div>';
        try {
            const r = await fetch('/api/scanner/social');
            if (!r.ok) throw new Error('http ' + r.status);
            const d = await r.json();
            if (_alphaTab !== 'social') return;
            const results = Array.isArray(d.results) ? d.results : [];
            window._lastSocialResults = results; // AI 버튼 핸들러용
            if (!results.length) {
                el.innerHTML = '<div class="sniper-empty">현재 화제 종목 없음 — 10분 후 재시도</div>';
                return;
            }
            const html = `
                <div class="social-warn">
                    ⚠️ 소셜 트렌드는 커뮤니티 화제도 기반입니다. 펌프 앤 덤프 작전의 미끼일 수 있으므로
                    반드시 카탈리스트(공시·뉴스)와 함께 검증 후 활용하세요.
                    화제만으로 진입은 늦은 진입 = 고점 물량 받는 역할이 될 수 있습니다.
                </div>
                <div class="social-list">${results.map((r, i) => _renderSocialCard(r, i)).join('')}</div>
            `;
            el.innerHTML = html;
        } catch (e) {
            warn('[social-scan]', e);
            if (_alphaTab === 'social') el.innerHTML = '<div class="sniper-empty">데이터 로드 실패 — 잠시 후 다시 시도하세요</div>';
        }
    }

    function _renderSocialCard(r, idx) {
        const cardId = `soc-${r.ticker}-${idx}`;
        const _fmtMc = v => v >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v}`;
        const chgCls = r.changePct > 0 ? 'up' : r.changePct < 0 ? 'down' : 'flat';
        const sign = r.changePct >= 0 ? '+' : '';
        const surgeBadge = r.mentionRatio >= 5 ? '🔥' : '';
        const stRank = r.stocktwitsRank ? `#${r.stocktwitsRank}` : '—';
        const bullCls = r.bullishPct >= 60 ? 'bull' : r.bullishPct <= 40 ? 'bear' : 'neutral';
        const cached = _socialAiCache[r.ticker];
        return `
        <div id="${cardId}" class="social-card" data-ticker="${r.ticker}" onclick="quickSearch('${r.ticker}','US')">
            <div class="social-card-head">
                <div class="social-rank">${idx + 1}</div>
                <div class="social-id">
                    <div class="social-sym">${escHtml(r.ticker)}</div>
                    <div class="social-name">${escHtml((r.name || '').slice(0, 30))}</div>
                </div>
                <div class="social-grade" style="background:${r.gradeColor};color:#fff">${escHtml(r.grade)} · ${r.score}</div>
            </div>
            <div class="social-meta-row">
                <span class="social-meta-cell">💰 $${r.price >= 10 ? r.price.toFixed(2) : r.price.toFixed(3)}</span>
                <span class="social-meta-cell">🏢 ${_fmtMc(r.marketCap)}</span>
                <span class="social-meta-cell ${chgCls}">${sign}${r.changePct.toFixed(2)}%</span>
                <span class="social-meta-cell">💬 Reddit ${r.mentions}회 ${r.mentionRatio >= 2 ? `<b class="up">(24h ×${r.mentionRatio.toFixed(1)})${surgeBadge}</b>` : `(어제 ${r.mentions24hAgo})`}</span>
                <span class="social-meta-cell">📈 ST ${stRank}</span>
                <span class="social-meta-cell ${bullCls}">${r.bullishPct >= 60 ? '🟢' : r.bullishPct <= 40 ? '🔴' : '⚪'} Bullish ${r.bullishPct}%</span>
                <span class="social-meta-cell">📊 거래량 ×${r.volRatio.toFixed(1)}</span>
            </div>
            <button class="social-ai-btn" onclick="event.stopPropagation();_runSocialAi('${cardId}', '${r.ticker}')">🤖 AI 심층 분석</button>
            <div class="social-ai-result" id="${cardId}-ai">${cached ? _renderSocialAiResult(cached) : ''}</div>
        </div>`;
    }

    async function _runSocialAi(cardId, ticker) {
        const card = document.getElementById(cardId);
        const resultEl = document.getElementById(`${cardId}-ai`);
        const btn = card?.querySelector('.social-ai-btn');
        if (!resultEl) return;
        if (btn) { btn.disabled = true; btn.textContent = '🤖 AI 분석 중... (수초)'; }
        resultEl.innerHTML = '<div class="cat-ai-loading">Gemini 분석 호출 중...</div>';
        try {
            // 카드의 현재 데이터에서 marketContext 구성
            const item = (window._lastSocialResults || []).find(x => x.ticker === ticker) || {};
            const body = {
                ticker,
                posts: [], // ApeWisdom 본문 미수집 — 멘션 통계로 분석
                marketContext: {
                    marketCap: item.marketCap, price: item.price,
                    changePct: item.changePct, volRatio: item.volRatio,
                    shortFloat: 0,
                    mentions: item.mentions, mentions24hAgo: item.mentions24hAgo,
                    bullishPct: item.bullishPct, stocktwitsRank: item.stocktwitsRank,
                },
            };
            const res = await fetch('/api/social/ai-analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            _socialAiCache[ticker] = data;

            // 펌프앤덤프 50점 이상 → 카드 상단 경고 배너 추가 + 매매 라인 숨김 (소셜 탭엔 매매 라인 없음)
            const pumpScore = data.pump?.totalScore ?? 0;
            if (pumpScore >= 50 && card) {
                card.classList.add('social-card--high-risk');
            }
            resultEl.innerHTML = _renderSocialAiResult(data);
            if (btn) btn.remove();
        } catch (e) {
            resultEl.innerHTML = `<div class="cat-ai-loading" style="color:#ef4444">AI 분석 실패: ${escHtml(e.message || '오류')}</div>`;
            if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 심층 분석 (재시도)'; }
        }
    }

    function _renderSocialAiResult(d) {
        if (!d) return '';
        const m = d.meaning || {};
        const p = d.pump || {};
        const sentColor = m.sentiment === 'Bullish' ? '#22c55e' : m.sentiment === 'Bearish' ? '#ef4444' : '#94a3b8';
        const credColor = m.credibility === 'high' ? '#22c55e' : m.credibility === 'medium' ? '#eab308' : '#ef4444';
        const pumpScore = p.totalScore ?? 0;
        const pumpGrade = pumpScore >= 50 ? '🚨 매우 위험' : pumpScore >= 35 ? '🔴 주의' : pumpScore >= 20 ? '🟡 관찰' : '🟢 비교적 안전';
        const pumpColor = pumpScore >= 50 ? '#ef4444' : pumpScore >= 35 ? '#f97316' : pumpScore >= 20 ? '#eab308' : '#22c55e';
        const flags = Array.isArray(m.redFlags) ? m.redFlags : [];
        const flagsHtml = flags.length ? `<ul class="cat-ai-points">${flags.slice(0,3).map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>` : '';
        const sigOrder = ['mentionExplosion','emptyHype','repeatPattern','smallCapLowVolume','noCatalyst','pressureLanguage','suspiciousAccounts'];
        const sigLabels = {
            mentionExplosion: '멘션 폭증', emptyHype: 'DD 없는 흥분',
            repeatPattern: '반복 패턴', smallCapLowVolume: '소형주+저거래량',
            noCatalyst: '촉매 없음', pressureLanguage: '압박 멘트',
            suspiciousAccounts: '의심 계정',
        };
        const sigs = p.signals || {};
        const sigsHtml = sigOrder.map(k => {
            const v = sigs[k] ?? 0;
            const pct = Math.min(100, v * 10);
            const cls = v >= 7 ? 'sig-high' : v >= 4 ? 'sig-mid' : 'sig-low';
            return `<div class="cat-ai-sig">
                <span class="cat-ai-sig-label">${escHtml(sigLabels[k])}</span>
                <div class="cat-ai-sig-bar"><div class="cat-ai-sig-fill ${cls}" style="width:${pct}%"></div></div>
                <span class="cat-ai-sig-val">${v}/10</span>
            </div>`;
        }).join('');
        const analyzedAgo = d.analyzedAt ? `AI 분석 ${Math.max(1, Math.round((Date.now() - new Date(d.analyzedAt).getTime()) / 60000))}분 전` : '';
        const pumpBanner = pumpScore >= 50 ? `<div class="catalyst-risk-banner">🚨 AI 가 펌프앤덤프 작전 의심 — 진입 비권장 (${pumpScore}/70)</div>` : '';
        return `
        ${pumpBanner}
        <div class="cat-ai-card">
            <div class="cat-ai-section">
                <div class="cat-ai-title">💬 AI 핵심 화제</div>
                <div class="cat-ai-row"><span class="cat-ai-key">요약</span><span class="cat-ai-val">${escHtml(m.summary || '-')}</span></div>
                <div class="cat-ai-row">
                    <span class="cat-ai-key">촉매</span>
                    <span class="cat-ai-pill" style="background:${m.hasCatalyst ? '#22c55e' : '#94a3b8'};color:#fff">${m.hasCatalyst ? '있음' : '없음'}</span>
                    ${m.catalystDetail ? `<span class="cat-ai-val">${escHtml(m.catalystDetail)}</span>` : ''}
                </div>
                <div class="cat-ai-row">
                    <span class="cat-ai-key">분위기</span>
                    <span class="cat-ai-pill" style="background:${sentColor};color:#fff">${escHtml(m.sentiment || '?')}</span>
                    <span class="cat-ai-key" style="margin-left:8px">신뢰도</span>
                    <span class="cat-ai-pill" style="background:${credColor};color:#fff">${escHtml((m.credibility || '?').toUpperCase())}</span>
                </div>
                ${flagsHtml}
            </div>
            <div class="cat-ai-section">
                <div class="cat-ai-title">⚠️ 펌프앤덤프 의심도 · ${pumpScore}/70 · <span style="color:${pumpColor}">${pumpGrade}</span></div>
                <div class="cat-ai-sigs">${sigsHtml}</div>
                <div class="cat-ai-row"><span class="cat-ai-key">결론</span><span class="cat-ai-pill" style="background:${pumpColor};color:#fff">${escHtml(p.verdict || '?')}</span></div>
                <div class="cat-ai-reasoning">${escHtml(p.reasoning || '')}</div>
            </div>
            <div class="cat-ai-foot">${analyzedAgo}${d._meta?.cached ? ' · 캐시 적중' : ''}</div>
        </div>`;
    }

    async function _alphaRenderSEPAScanner(el) {
        el.innerHTML = _alphaTimingGuide('sepa') + '<div class="sniper-loading">' + Array(6).fill('<div class="sniper-skel"></div>').join('') + '</div>';

        // ── Polygon VCP 셋업 배너 (비동기 병렬 — 실패해도 메인 스캔에 영향 없음) ──
        fetch('/api/scanner/minervini').then(async pr => {
            if (!pr.ok || _alphaTab !== 'sepa') return;
            const pd = await pr.json().catch(() => null);
            if (!pd || !pd.stocks || !pd.stocks.length) return;
            if (_alphaTab !== 'sepa') return;
            const alphaEl = document.getElementById('alphaResults');
            if (!alphaEl) return;
            const top = pd.stocks.slice(0, 5);
            const chips = top.map(s =>
                `<span onclick="selectStock('${s.ticker}')" style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.35);font-size:11px;font-weight:700;color:#FFD700;cursor:pointer;">${s.ticker} <span style="font-size:10px;font-weight:400;color:var(--text3)">RS${s.rsScore}</span></span>`
            ).join(' ');
            const banner = `<div id="_mvBanner" style="margin:0 0 10px;padding:10px 12px;border-radius:10px;background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.25);">
                <div style="font-size:11px;font-weight:700;color:#FFD700;margin-bottom:6px">Polygon VCP 셋업 — ${pd.total}개 (스캔: ${new Date(pd.scannedAt).toLocaleTimeString('ko-KR')})</div>
                <div style="display:flex;flex-wrap:wrap;gap:5px">${chips}</div>
            </div>`;
            // timing guide 뒤, 기존 컨텐츠 앞에 삽입
            const existing = alphaEl.innerHTML;
            const guide = _alphaTimingGuide('sepa');
            alphaEl.innerHTML = existing.replace(guide, guide + banner);
        }).catch(() => {});

        try {
            const r = await fetch('/api/sepa-scan');
            if (!r.ok) throw new Error('http ' + r.status);
            const d = await r.json();
            if (_alphaTab !== 'sepa') return;
            const results = Array.isArray(d.results) ? d.results : [];
            if (!results.length) {
                el.innerHTML = _alphaTimingGuide('sepa') + '<div class="sniper-empty">스캔 결과 없음 — 잠시 후 다시 시도</div>';
                return;
            }
            // 시장 약세 폴백 배너 (strict / relaxed / fallback)
            const tierBanner = (() => {
                if (d.tierUsed === 'strict') return '';
                const counts = d.counts || {};
                if (d.tierUsed === 'relaxed') {
                    return `<div style="margin:6px 0 8px;padding:8px 12px;border-radius:8px;background:rgba(234,179,8,.10);border:1px solid rgba(234,179,8,.4);font-size:12px;color:#eab308;font-weight:600;">⚠️ SEPA 70+ 종목이 ${counts.tier1 || 0}개로 적어 50+ 상위 ${results.length}개를 보여줍니다 (시장 약세).</div>`;
                }
                return `<div style="margin:6px 0 8px;padding:8px 12px;border-radius:8px;background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.4);font-size:12px;color:#ef4444;font-weight:600;">⚠️ SEPA 50+ 종목이 부족해 상위 ${results.length}개를 참고용으로 보여줍니다 (전반적 약세 시장).</div>`;
            })();
            // _alphaRender(통합 카드 UI)에 맞게 데이터 변환
            const items = results.map(r => ({
                symbol: r.symbol,
                name: r.name,
                regularMarketPrice: r.price,
                price: r.price,
                regularMarketChangePercent: r.changePct ?? null,
                _alphaKind: 'sepa',
                _sepaScore: r.score,
                _sepaTrend: r.trendPassed,
                _sepaVcpFound: r.vcpFound,
                _sepaVcpIdeal: r.vcpIdeal,
                _sepaRs: r.rs,
                _sepaBreakoutVol: r.breakoutVol,
                _sepaBaseLowVol: r.baseLowVol,
                _sepaTodayVolMult: r.todayVolMult,
                _sepaPivot: r.pivot,
                _sepaHigh52: r.high52,
                _sepaLow52: r.low52,
                fiftyTwoWeekHigh: r.high52,
                fiftyTwoWeekLow: r.low52,
            }));
            // _alphaRender 호출 후 폴백 배너를 결과 위에 삽입
            _alphaRender(items, 'sepa');
            if (tierBanner) {
                const cur = document.getElementById('alphaResults');
                if (cur) {
                    // timing 가이드 뒤에 배너 삽입
                    const timingHtml = _alphaTimingGuide('sepa');
                    cur.innerHTML = cur.innerHTML.replace(timingHtml, timingHtml + tierBanner);
                }
            }
        } catch (e) {
            if (_alphaTab === 'sepa') el.innerHTML = _alphaTimingGuide('sepa') + '<div class="sniper-empty">데이터 로드 실패 — 잠시 후 다시 시도하세요</div>';
        }
    }

    // ── 단테 스캐너 (Phase 3) ────────────────────────────────────────
    // day_gainers + most_actives 의 시세 메타 필드로 단테 시그널 근사 → 점수화
    // (60일 OHLCV 미가공 → 가벼운 휴리스틱: 매집·눌림·거래량·52주 위치)
    // ── 단테 모멘텀 7조건 스캐너 ──────────────────────────────────────
    // /api/breakout-scan: 단테 7조건(거래량/거래대금/등락률/MA5/MA20/BB/ORB) 충족 종목
    // (거래량 급증 탭과 중복 종목 제외 — 백엔드에서 dedup)
    let _daytradeItemsCache = [];                  // 마지막 fetch 결과 (필터 재적용용)
    let _daytradeFilterTof  = 'all';               // 'all' | '5m' | '20m'
    let _daytradeFilterMcap = 'all';               // 'all' | '300m' | '2b'

    function _applyDaytradeFilter(items) {
        const tof = _daytradeFilterTof, mcap = _daytradeFilterMcap;
        return items.filter(it => {
            const t = it._avgTurnover5d || 0;
            if (tof === '5m'  && t <  5_000_000)  return false;
            if (tof === '20m' && t < 20_000_000)  return false;
            const m = it._marketCap || 0;
            if (mcap === '300m' && m <   300_000_000) return false;
            if (mcap === '2b'   && m < 2_000_000_000) return false;
            return true;
        });
    }

    function _alphaSetDaytradeFilter(kind, value) {
        if (kind === 'tof')  _daytradeFilterTof  = value;
        if (kind === 'mcap') _daytradeFilterMcap = value;
        // 필터 칩 active 토글
        document.querySelectorAll('#alphaDaytradeFilters [data-tof]')
            .forEach(b => b.classList.toggle('active', b.dataset.tof === _daytradeFilterTof));
        document.querySelectorAll('#alphaDaytradeFilters [data-mcap]')
            .forEach(b => b.classList.toggle('active', b.dataset.mcap === _daytradeFilterMcap));
        // 캐시된 items 에 재필터 적용 후 렌더 (API 호출 0)
        const el = document.getElementById('alphaResults');
        if (!el || _alphaTab !== 'daytrade') return;
        const filtered = _applyDaytradeFilter(_daytradeItemsCache);
        if (!filtered.length) {
            el.innerHTML = _alphaTimingGuide('daytrade') + '<div class="sniper-empty">선택한 필터에 해당하는 종목이 없습니다</div>';
            return;
        }
        _alphaRender(filtered, 'daytrade');
    }

    async function _alphaRenderBreakoutScanner(el) {
        el.innerHTML = _alphaTimingGuide('daytrade') + '<div class="sniper-loading">' + Array(6).fill('<div class="sniper-skel"></div>').join('') + '</div>';
        try {
            const r = await fetch('/api/breakout-scan');
            if (!r.ok) throw new Error('http ' + r.status);
            const d = await r.json();
            if (_alphaTab !== 'daytrade') return;
            const results = Array.isArray(d.results) ? d.results : [];
            if (!results.length) {
                el.innerHTML = _alphaTimingGuide('daytrade') + '<div class="sniper-empty">현재 단테 조건 충족 종목이 없습니다 — 장중 다시 시도</div>';
                return;
            }
            // 단테 단일 뷰 — 응답 필드만 매핑
            const items = results.map(r => ({
                symbol: r.symbol, name: r.name,
                regularMarketPrice: r.price, price: r.price,
                regularMarketChangePercent: r.changePct ?? null,
                marketCap: r.marketCap ?? null,
                _alphaKind: 'daytrade',
                _danteFlags: r.danteFlags,
                _danteCount: r.danteCount,
                _dantePass:  r.dantePass,
                _tier:       r.tier,
                _rvol:       r.rvol,
                _avgTurnover5d: r.avgTurnover5d,
                _bbDistPct:  r.bbDistPct,
                _ma5: r.ma5, _ma20: r.ma20,
                _marketCap: r.marketCap,
                _prevHigh: r.prevHigh, _todayOpen: r.todayOpen,
            }));
            _daytradeItemsCache = items;  // 필터 재적용용 보관
            const filtered = _applyDaytradeFilter(items);
            if (!filtered.length) {
                el.innerHTML = _alphaTimingGuide('daytrade') + '<div class="sniper-empty">선택한 필터에 해당하는 종목이 없습니다</div>';
                return;
            }
            _alphaRender(filtered, 'daytrade');
        } catch (e) {
            if (_alphaTab === 'daytrade') el.innerHTML = _alphaTimingGuide('daytrade') + '<div class="sniper-empty">데이터 로드 실패 — 잠시 후 다시 시도하세요</div>';
        }
    }

    async function _alphaRenderDanteScanner(el) {
        el.innerHTML = '<div class="sniper-loading">' + Array(6).fill('<div class="sniper-skel"></div>').join('') + '</div>';
        let pool = [];
        try {
            const cached = top100Cache?.['day_gainers']?.items;
            if (cached && cached.length) pool = cached.slice();
            else {
                const r = await fetch('/api/screener/day_gainers?count=100');
                if (r.ok) {
                    const d = await r.json();
                    pool = d?.finance?.result?.[0]?.quotes || [];
                    if (pool.length) top100Cache['day_gainers'] = { items: pool, ts: Date.now() };
                }
            }
            const r2 = await fetch('/api/screener/most_actives?count=100').catch(()=>null);
            if (r2 && r2.ok) {
                const d2 = await r2.json();
                const extra = d2?.finance?.result?.[0]?.quotes || [];
                const seen = new Set(pool.map(q => q.symbol));
                extra.forEach(q => { if (!seen.has(q.symbol)) { pool.push(q); seen.add(q.symbol); } });
            }
        } catch (e) { warn('[dante-scan]', e); }
        if (_alphaTab !== 'dante') return;
        if (!pool.length) {
            el.innerHTML = '<div class="sniper-empty">데이터를 불러올 수 없습니다 — 잠시 후 다시 시도하세요</div>';
            return;
        }
        // 시그널 휴리스틱 (메타 필드 기반)
        const scored = pool.map(q => {
            const price = q.regularMarketPrice || 0;
            const ma50 = q.fiftyDayAverage || 0;
            const ma200 = q.twoHundredDayAverage || 0;
            const high52 = q.fiftyTwoWeekHigh || 0;
            const low52 = q.fiftyTwoWeekLow || 0;
            const vol = q.regularMarketVolume || 0;
            const avgVol = q.averageDailyVolume3Month || 0;
            const change = q.regularMarketChangePercent || 0;
            const cap = q.marketCap || 0;
            const sigs = [];
            if (cap < 300e6 || cap > 50e9 || price < 1 || !avgVol || avgVol < 1e6) return null; // 단타 유동성 필터
            // 매집봉 근사: 거래량 1.5배 이상 + 양봉
            if (avgVol && vol > avgVol * 1.5 && change > 0) sigs.push({ k: 'maejip', label: '매집봉', desc: `거래량 ${(vol/avgVol).toFixed(1)}배 양봉` });
            // 정배열 + 5일선 근접 (눌림목 후보)
            if (ma50 && ma200 && price > ma50 && ma50 > ma200 && Math.abs(price - ma50) / ma50 < 0.04) sigs.push({ k: 'nullim', label: '눌림목', desc: '정배열 + MA50 지지' });
            // 공구리: 52주 중간 이상 + ma200 위
            if (high52 && low52 && ma200 && price > ma200 && (price - low52) / (high52 - low52) > 0.5) sigs.push({ k: 'gonguri', label: '공구리', desc: 'MA200 위 지지선 안착' });
            // 밥그릇 근사: 52주 고점 -15~30% + 최근 양전환
            if (high52 && price < high52 * 0.85 && price > high52 * 0.7 && change > 1) sigs.push({ k: 'bapgeureut', label: '밥그릇', desc: `52주 -${((high52-price)/high52*100).toFixed(0)}% + 반등 시도` });
            // 하이힐: 52주 저점 +30% 이내 + 당일 +3% 이상
            if (low52 && price < low52 * 1.3 && change > 3) sigs.push({ k: 'highheel', label: '하이힐', desc: 'V자 반등 후보' });
            if (sigs.length === 0) return null;
            const score = Math.min(10, sigs.length * 2 + Math.floor(change / 2));
            return { ...q, _alphaKind: 'dante', _danteSigs: sigs, _danteScore: score };
        }).filter(Boolean).sort((a, b) => b._danteScore - a._danteScore).slice(0, 30);

        if (!scored.length) {
            el.innerHTML = _alphaTimingGuide('dante') + '<div class="sniper-empty">오늘 단테 시그널 종목이 없습니다</div>';
            return;
        }
        // 다른 스캐너 탭과 동일한 _alphaRender 사용 → UI 일관성 확보
        _alphaRender(scored, 'dante');
    }

    // ═══════════════════════════════════════════════════════════
    // 알파 스캐너 홈 프리뷰 — 탭별 상위 10개 + 더보기 (v624)
    // ═══════════════════════════════════════════════════════════

    // 10초 타임아웃 fetch — 응답 없으면 자동 abort
    function _alphaFetch(url) {
        return fetch(url, { signal: AbortSignal.timeout(10000) });
    }

    async function _alphaHomeFetchItems(tab) {
        log('[alphaHome] 시작:', tab);

        const cached = _alphaHomeCache[tab];
        if (cached && (Date.now() - cached.ts) < _ALPHA_HOME_TTL) {
            log('[alphaHome] 캐시 사용:', tab, cached.items.length + '개');
            return cached.items;
        }

        let items = [];
        try {
            if (tab === 'bounce') {
                log('[alphaHome] API 호출: /api/oversold-radar?tab=oversold');
                const r = await _alphaFetch('/api/oversold-radar?tab=oversold');
                log('[alphaHome] API 응답:', r.status, r.ok ? 'OK' : 'FAIL');
                if (!r.ok) throw new Error('http ' + r.status);

                const d = await r.json();
                const raw = (d.items || []);
                log('[alphaHome] raw 데이터:', raw.length + '개', '| d.error:', d.error || '없음');

                // 필터 단계
                let filtered = [];
                try {
                    filtered = raw.filter(item => {
                        try { return _isClearlyOversold(item); }
                        catch(e) { warn('[isClearlyOversold 에러]', item?.symbol, e.message); return false; }
                    });
                    log('[alphaHome] 필터 후:', filtered.length + '개');
                } catch(e) {
                    console.error('[alphaHome] 필터 단계 실패:', e);
                    throw e;
                }

                // 점수 계산 단계
                let scored = [];
                try {
                    scored = filtered.map(item => {
                        try { return { item, signals: _calcBounceScore(item) }; }
                        catch(e) { warn('[calcBounceScore 에러]', item?.symbol, e.message); return { item, signals: [] }; }
                    });
                    log('[alphaHome] 점수 계산 후:', scored.length + '개');
                } catch(e) {
                    console.error('[alphaHome] 점수 단계 실패:', e);
                    throw e;
                }

                items = scored
                    .sort((a, b) => b.signals.length - a.signals.length)
                    .map(({ item, signals }) => ({ ...item, _alphaKind: 'bounce', _bounceSignals: signals }));
                log('[alphaHome] bounce 최종:', items.length + '개');

            } else if (tab === 'swing') {
                log('[alphaHome] swing 탭 처리');
                let raw = (top100Cache?.['day_gainers']?.items) || [];
                if (!raw.length) {
                    log('[alphaHome] swing API 호출');
                    const r = await _alphaFetch('/api/screener/day_gainers?count=100');
                    log('[alphaHome] swing 응답:', r.status);
                    if (r.ok) {
                        const d = await r.json();
                        raw = d?.finance?.result?.[0]?.quotes || [];
                        if (raw.length) top100Cache['day_gainers'] = { items: raw, ts: Date.now() };
                    }
                }
                items = raw.map(q => {
                    const p = q.regularMarketPrice, h = q.fiftyTwoWeekHigh;
                    if (!p || !h || h <= p) return null;
                    const rr = (h - p) / (p * 0.05);
                    return rr >= 1.5 ? { ...q, _rr: rr, _alphaKind: 'swing' } : null;
                }).filter(Boolean).sort((a, b) => b._rr - a._rr);
                log('[alphaHome] swing 최종:', items.length + '개');
            } else {
                log('[alphaHome] 알 수 없는 탭:', tab);
            }

            _alphaHomeCache[tab] = { items, ts: Date.now() };
            return items;
        } catch(e) {
            console.error('[alphaHomeFetch ❌]', tab, { message: e.message, name: e.name, stack: e.stack });
            return []; // 실패 시 빈 배열 반환 (로딩 무한 방지)
        }
    }

    async function _alphaHomeSwitch(tab) {
        _alphaHomeTab = tab;
        document.querySelectorAll('#alphaHomeTabs .alpha-home-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
        });
        const el = document.getElementById('alphaHomeList');
        if (!el) return;
        el.innerHTML = '<div class="sniper-loading">' + Array(4).fill('<div class="sniper-skel"></div>').join('') + '</div>';
        try {
            const items = await _alphaHomeFetchItems(tab);
            if (_alphaHomeTab !== tab) return; // 도중 다른 탭 선택 시 무시
            if (!items.length) {
                el.innerHTML = '<div class="sniper-empty">현재 조건에 맞는 종목이 없습니다</div>';
                return;
            }
            const top10 = items.slice(0, 10);
            const cards = top10.map((q, idx) => _alphaHomeRow(q, idx)).join('');
            el.innerHTML = cards;
            _alphaHomeRetry[tab] = 0; // 성공 시 재시도 카운터 리셋
        } catch (e) {
            warn('[alphaHome] 로드 실패:', e.message);
            // 에러 시 로딩 상태 즉시 해제 (다시 시도 버튼 표시)
            if (el && _alphaHomeTab === tab) {
                el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">데이터를 불러올 수 없습니다.<button onclick="_alphaHomeSwitch('${tab}')" style="margin-left:8px;padding:4px 10px;font-size:12px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text);">🔄 다시 시도</button></div>`;
            }
        }
    }

    function loadAlphaHomePreview() {
        _alphaHomeSwitch(_alphaHomeTab || 'bounce');
    }


    // ── 거래량 급증 스캐너 필터 ──────────────────────────────────────
    function _setSurgeFilter(filter) {
        _surgeFilter = filter;
        try { localStorage.setItem('surgeFilter', filter); } catch(e) {}
        document.querySelectorAll('.surge-filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === filter);
        });
        if (typeof loadVolumeSurge === 'function') {
            loadVolumeSurge(false);
        }
    }
    // ── 홈 알파스캐너 compact row 렌더러 ─────────────────────────────
    function _alphaHomeRow(q, idx) {
        const sym   = q.symbol || q.ticker || '';
        const name  = (q.name || q.shortName || sym).slice(0, 22);
        const price = q.regularMarketPrice || q.price || 0;
        const chg   = q.regularMarketChangePercent ?? q.changePct ?? 0;
        const chgCls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
        const chgTxt = (chg > 0 ? '+' : '') + chg.toFixed(2) + '%';
        const priceTxt = price >= 100 ? '$' + price.toFixed(0) : price >= 10 ? '$' + price.toFixed(2) : '$' + price.toFixed(3);
        const kind = q._alphaKind;

        // TIER 배지
        const signals = q._bounceSignals || [];
        const sigCount = signals.length;
        const tierCls = sigCount >= 4 ? 'alpha-tier1' : sigCount >= 2 ? 'alpha-tier2' : 'alpha-tier3';
        const tierLbl = sigCount >= 4 ? 'T1' : sigCount >= 2 ? 'T2' : 'T3';

        // 핵심 정보 (탭별)
        let badge1 = '', badge2 = '';
        if (kind === 'bounce') {
            if (q.rsi != null) badge1 = `<span class="ahr-pill ahr-blue">RSI ${q.rsi}</span>`;
            const expMove = sigCount >= 4 ? '+13%' : sigCount >= 2 ? '+9%' : '+5%';
            badge2 = `<span class="ahr-pill ahr-green">예상 ${expMove}</span>`;
        } else if (kind === 'swing') {
            if (q._rr) badge1 = `<span class="ahr-pill ahr-blue">R/R ${q._rr.toFixed(1)}</span>`;
        } else if (kind === 'sepa') {
            if (q._sepaScore) badge1 = `<span class="ahr-pill ahr-blue">SEPA ${q._sepaScore}</span>`;
        }

        const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(sym)}?format=png`;
        const fb = sym.slice(0, 2);
        return `<div class="ahr-row" onclick="quickSearch('${sym}','US')">
            <span class="ahr-rank">${idx + 1}</span>
            <div class="tlogo-wrap ahr-logo">
                <img class="tlogo" src="${logoUrl}" alt="${sym}" loading="lazy" onerror="this.outerHTML='<span class=\\'tlogo tlogo-fb\\'>${fb}</span>'">
                <span class="tlogo-flag">🇺🇸</span>
            </div>
            <div class="ahr-info">
                <div class="ahr-sym-row">
                    <span class="ahr-sym">${sym}</span>
                    <span class="ahr-tier ${tierCls}">${tierLbl}</span>
                </div>
                <div class="ahr-name">${name}</div>
            </div>
            <div class="ahr-badges">${badge1}${badge2}</div>
            <div class="ahr-price">
                <div class="ahr-px">${priceTxt}</div>
                <div class="ahr-chg ${chgCls}">${chgTxt}</div>
            </div>
        </div>`;
    }

    // 홈에서 "전체 보기" → 현재 홈 탭을 알파 스캐너에 반영하고 이동
    function goAlphaFromHome() {
        _alphaTab = _alphaHomeTab || 'bounce';
        if (typeof goScanner === 'function') goScanner();
    }

    function _alphaRender(items, tab, topHtml) {
        const el = document.getElementById('alphaResults');
        if (!el) return;
        const useTab = tab || _alphaTab;
        const timing = _alphaTimingGuide(useTab);
        const extraTop = (topHtml || '') + (_ALPHA_AI_TABS.has(useTab) ? _alphaVerdictBarHtml() : '');
        if (!items.length) {
            el.innerHTML = timing + extraTop + '<div class="sniper-empty">현재 조건에 맞는 종목이 없습니다 — 필터를 완화해 보세요</div>';
            return;
        }
        const tierLegend = `<div class="alpha-tier-legend">
            <span class="alpha-legend-item"><span class="alpha-dot alpha-dot--t1"></span>TIER 1 (4+ 시그널)</span>
            <span class="alpha-legend-item"><span class="alpha-dot alpha-dot--t2"></span>TIER 2 (2~3개)</span>
            <span class="alpha-legend-item"><span class="alpha-dot alpha-dot--t3"></span>TIER 3 (1~2개)</span>
        </div>`;
        const cards = items.map((q, idx) => _alphaRenderCard(q, idx)).join('');
        el.innerHTML = timing + extraTop + tierLegend + '<div class="alpha-card-list">' + cards + '</div>';
        // 자동 AI 일괄 검증 (v677) — 상위 15개 종목에 대해 백그라운드 호출
        try { _alphaAutoBatchAi(items, useTab); } catch(_) {}
    }

    // 알파 스캐너 자동 AI 일괄 검증 (v677)
    //   탭별로 한 번 호출하면 1시간 캐시 → 같은 종목 재방문 시 추가 비용 없음
    let _alphaBatchInflight = null;
    async function _alphaAutoBatchAi(items, scannerType) {
        // 카탈리스트·홈 프리뷰는 제외 — 알파 스캐너 메인 탭만
        if (!items?.length || !scannerType) return;
        // 이전 호출 무시
        const callId = Symbol(scannerType);
        _alphaBatchInflight = callId;

        // 상위 15개만 — 카드별 candidateData 추출
        const top = items.slice(0, 15);
        const batchItems = top.map(q => {
            const cd = {
                price: q.regularMarketPrice || q.price,
                marketCap: q.marketCap,
                changePct: q.regularMarketChangePercent ?? q.changePct,
            };
            if (scannerType === 'bounce') {
                cd.rsi = q.rsi; cd.ma200 = q.ma200; cd.volMult = q.volMult; cd.high52 = q.fiftyTwoWeekHigh;
            } else if (scannerType === 'swing') {
                cd.rr = q._rr; cd.fiftyTwoWeekHigh = q.fiftyTwoWeekHigh;
            } else if (scannerType === 'sepa') {
                cd.score = q._sepaScore; cd.trendPassed = q._sepaTrend;
                cd.vcpFound = q._sepaVcpFound; cd.rs = q._sepaRs;
                cd.todayVolMult = q._sepaTodayVolMult;
            }
            return { ticker: q.symbol || q.ticker, candidateData: cd };
        }).filter(it => it.ticker);

        if (!batchItems.length) return;

        try {
            const res = await fetch('/api/scanner/ai-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scannerType, items: batchItems }),
            });
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            if (_alphaBatchInflight !== callId) return; // 탭 전환된 경우 무시
            const aiByTicker = new Map();
            (data.results || []).forEach(r => { if (r.ticker) aiByTicker.set(r.ticker, r.analysis); });

            // pending 상태 표시 일괄 정리 — 결과 없는 카드는 mini 배지 숨김
            document.querySelectorAll('.alpha-ai-mini[data-pending="1"]').forEach(el => {
                const cardId = el.id.replace('-ai-mini', '');
                const ticker = cardId.replace(/^alphacard-/, '').split('-')[0];
                const analysis = aiByTicker.get(ticker);
                if (!analysis) { el.style.display = 'none'; return; }
                el.removeAttribute('data-pending');
                el.innerHTML = _renderAlphaAiMini(analysis);
                // AI 판정 필터용 — 카드에 verdict 태깅
                const cardEl = document.getElementById(cardId);
                if (cardEl && analysis.verdict) cardEl.dataset.verdict = analysis.verdict;
                // 확장 영역의 상세 결과도 채움
                const expEl = document.getElementById(`${cardId}-ai`);
                if (expEl) expEl.innerHTML = _renderScannerAiResult({ analysis, _meta: { cached: true } });
            });
            try { _alphaVerdictApply(); } catch(_) {}
        } catch (e) {
            // 실패 시 pending 표시 숨김
            document.querySelectorAll('.alpha-ai-mini[data-pending="1"]').forEach(el => { el.style.display = 'none'; });
            warn('[scanner-ai-batch]', e.message);
        }
    }

    function _renderAlphaAiMini(a) {
        if (!a) return '';
        const verdict = a.verdict || '?';
        const conf = Number(a.confidence) || 0;
        const verdictColor = verdict === '강한매수' ? '#22c55e'
            : verdict === '매수' ? '#84cc16'
            : verdict === '관망' ? '#eab308'
            : '#ef4444';
        const riskColor = a.riskLevel === '낮음' ? '#22c55e'
            : a.riskLevel === '중간' ? '#eab308'
            : a.riskLevel === '높음' ? '#f97316'
            : '#ef4444';
        return `
            <span class="alpha-ai-pill" style="background:${verdictColor}">🤖 ${escHtml(verdict)}</span>
            <span class="alpha-ai-conf">신뢰도 ${conf}/10</span>
            ${a.riskLevel ? `<span class="alpha-ai-pill alpha-ai-pill--risk" style="background:${riskColor}">${escHtml(a.riskLevel)}</span>` : ''}
        `;
    }

    function _alphaToggleCard(cardId) {
        const card = document.getElementById(cardId);
        if (card) card.classList.toggle('alpha-card--expanded');
    }

    function _alphaRenderCard(q, idx) {
        const sym = q.symbol || q.ticker || '';
        const name = q.name || q.shortName || q.longName || sym;
        const price = q.price || q.regularMarketPrice || 0;
        const priceFmt = price >= 10 ? price.toFixed(2) : price.toFixed(3);
        const chg = q.changePct ?? q.regularMarketChangePercent ?? 0;
        const isUp = chg > 0;
        const chgSign = isUp ? '+' : '';
        const cardId = `alphacard-${sym}-${idx}`;
        const logoUrl = `https://assets.parqet.com/logos/symbol/${sym}?format=svg`;
        const fb2 = sym.slice(0, 2);
        const theme = _alphaTheme(q);
        const risk = _alphaRisk(q);
        const riskLabel = { low:'낮음', medium:'중간', high:'높음', extreme:'극고위험' }[risk] || '중간';

        // 시그널 + 점수 + reason 계산 (탭별)
        let signals = [], score = 0, reason = '', timingBadge = '', expectedMove = '', bounceTarget = 0, vpSectionHtml = '';
        let entry = price, stopLoss = price * 0.95, target = price * 1.10;
        const kind = q._alphaKind;

        if (kind === 'bounce') {
            const bs = q._bounceSignals || [];
            const sigCls = s => s.label.startsWith('🔨') ? 'emerald'
                : (s.label.includes('볼린저') ? 'purple' : 'blue');
            bs.forEach(s => signals.push({label:`${s.label}${s.detail ? ' ' + s.detail : ''}`, cls:sigCls(s)}));
            // v691 #3 — 점수제: 시그널별 pts 합산 (최대 13점)
            const totalPts = bs.reduce((sum, s) => sum + (s.pts || 0), 0);
            score = totalPts;
            reason = `과매도 점수 ${totalPts}점 · ${bs.length}개 시그널 충족 — 바닥 매집 흔적 점검.`;
            timingBadge = totalPts >= 7 ? {label:'⚡ 내일 반등', cls:'emerald'} : {label:'📅 내일모레', cls:'amber'};
            // v691 #4 — ATR(14) 기반 1차 목표가 (고정 % 추정 폐기)
            const atr = q.atr || (q.price ? q.price * 0.04 : 0);
            if (q.price && atr > 0) bounceTarget = q.price + atr * 1.5;
            expectedMove = 0; // 퍼센트 배지 미사용 — 목표가 배지로 대체
        } else if (kind === 'daytrade') {
            // 단테 모멘텀 7조건 — 통과 뱃지 + TIER 칩 + N/7 진행률
            const flags = q._danteFlags || {};
            const danteCount = q._danteCount ?? Object.values(flags).filter(Boolean).length;
            const tier = q._tier ?? (danteCount >= 6 ? 1 : danteCount >= 4 ? 2 : danteCount >= 2 ? 3 : 4);
            const rvol = q._rvol ?? 0;
            const turnover = q._avgTurnover5d ?? 0;
            const bbDist = q._bbDistPct;

            // TIER 칩 (맨 앞)
            const tierCls = tier === 1 ? 'emerald' : tier === 2 ? 'cyan' : 'amber';
            const tierTxt = tier === 1 ? 'TIER 1 (전체 충족)' : tier === 2 ? 'TIER 2 (핵심 충족)' : 'TIER 3 (참고)';
            signals.push({ label: tierTxt, cls: tierCls });
            // 통과한 단테 7조건만 뱃지로 표시 (미달은 숨김 — 카드 정보 밀도 유지)
            if (flags.A) signals.push({ label: `🔥 거래량 ${rvol.toFixed(1)}x 폭발`, cls: 'orange' });
            if (flags.B) signals.push({ label: `💰 거래대금 $${(turnover/1_000_000).toFixed(1)}M+`, cls: 'cyan' });
            if (flags.C) signals.push({ label: `+${(chg||0).toFixed(1)}% 급등`, cls: 'emerald' });
            if (flags.D) signals.push({ label: '5일선 위', cls: 'blue' });
            if (flags.E) signals.push({ label: '20일선 위', cls: 'blue' });
            if (flags.F) signals.push({ label: `볼린저 상단 ${bbDist != null ? bbDist.toFixed(1) + '%' : '근접'}`, cls: 'amber' });
            if (flags.G) signals.push({ label: 'ORB 돌파', cls: 'emerald' });

            // 0~6 스케일 (다른 탭과 동일) — danteCount(0~7)를 매핑
            score = Math.min(6, danteCount);

            // 사유 — 통과 조건 요약
            const passLabels = [];
            if (flags.A) passLabels.push(`거래량 ${rvol.toFixed(1)}x`);
            if (flags.C) passLabels.push(`+${(chg||0).toFixed(1)}%`);
            if (flags.D && flags.E) passLabels.push('이평 정배열');
            else if (flags.D) passLabels.push('5일선 위');
            if (flags.F) passLabels.push('볼린저 상단 근접');
            if (flags.G) passLabels.push('ORB 돌파');
            const recoText = q._dantePass ? '단테 전조건 충족 → 즉시 단타 진입'
                            : tier === 2 ? '핵심 조건 충족 → 진입 검토'
                            : '참고용 — 추가 확인 필요';
            reason = `단테 ${danteCount}/7 충족${passLabels.length ? `: ${passLabels.join(' · ')}` : ''}. ${recoText}.`;

            timingBadge = q._dantePass ? { label: '⚡ 즉시 단타', cls: 'emerald' }
                        : tier === 2   ? { label: '⚡ 분할 진입', cls: 'amber'   }
                                       : { label: '📅 관망',     cls: 'cyan'    };
            expectedMove = Math.round(2 + rvol * 1.5);
        } else if (kind === 'swing') {
            const rr = q._rr || 0;
            const upside = ((q.fiftyTwoWeekHigh - price) / price * 100);
            if (rr >= 3) signals.push({label:`R/R ${rr.toFixed(1)}:1 우수`, cls:'emerald'});
            else if (rr >= 2) signals.push({label:`R/R ${rr.toFixed(1)}:1 양호`, cls:'cyan'});
            else signals.push({label:`R/R ${rr.toFixed(1)}:1`, cls:'amber'});
            if (upside >= 20) signals.push({label:`고점까지 +${upside.toFixed(0)}%`, cls:'emerald'});
            if (chg > 0) signals.push({label:'추세 살아있음', cls:'blue'});
            if (q.marketCap && q.marketCap >= 5e9) signals.push({label:'대형주 안정성', cls:'purple'});
            score = Math.min(6, signals.length + (rr >= 3 ? 1 : 0));
            reason = `52주 고점까지 +${upside.toFixed(1)}% 여유, 손익비 ${rr.toFixed(1)}:1로 스윙 진입 매력적.`;
            timingBadge = rr >= 3 ? {label:'⚡ 며칠~몇주', cls:'emerald'} : {label:'📅 스윙 보유', cls:'amber'};
            expectedMove = Math.round(Math.min(25, upside * 0.4));
        } else if (kind === 'dante') {
            const sigs = q._danteSigs || [];
            const sigClassMap = { maejip:'orange', nullim:'blue', gonguri:'cyan', bapgeureut:'emerald', highheel:'amber' };
            sigs.forEach(s => signals.push({ label: `${s.label} · ${s.desc}`, cls: sigClassMap[s.k] || 'purple' }));
            if (chg >= 3) signals.push({ label: `당일 +${chg.toFixed(1)}%`, cls: 'emerald' });
            score = Math.min(6, sigs.length + (q._danteScore >= 7 ? 2 : q._danteScore >= 5 ? 1 : 0));
            reason = `단테 기법 ${sigs.length}개 시그널 발동 — ${sigs.map(s=>s.label).join(' · ')}.`;
            timingBadge = q._danteScore >= 7 ? {label:'⚡ 즉시 단타', cls:'emerald'} : {label:'📅 분할 진입', cls:'amber'};
            expectedMove = Math.round(3 + sigs.length * 1.5);
        } else if (kind === 'volSurge') {
            const volRatio   = q._volRatio   || 0;
            const surgeScore = q._surgeScore || 0;
            const capTier    = q._marketCapTier || 'unknown';
            // 거래량 신호
            if (volRatio >= 5)      signals.push({ label: `거래량 ${volRatio}x 폭증`, cls: 'orange' });
            else if (volRatio >= 3) signals.push({ label: `거래량 ${volRatio}x 급증`, cls: 'amber'  });
            else                    signals.push({ label: `거래량 ${volRatio}x 증가`, cls: 'blue'   });
            // 가격 변동
            if (Math.abs(chg) >= 5) signals.push({ label: `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% 급변동`, cls: chg >= 0 ? 'emerald' : 'red' });
            else if (Math.abs(chg) >= 2) signals.push({ label: `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% 변동`, cls: 'cyan' });
            // 시총 티어
            const tierLabelMap = { micro: 'MICRO CAP', small: 'SMALL CAP', mid: 'MID CAP', large: 'LARGE CAP' };
            const tierClsMap   = { micro: 'purple', small: 'blue', mid: 'cyan', large: 'gray' };
            signals.push({ label: tierLabelMap[capTier] || capTier.toUpperCase(), cls: tierClsMap[capTier] || 'purple' });
            // 점수 (0~6)
            score = surgeScore >= 70 ? 6 : surgeScore >= 55 ? 5 : surgeScore >= 40 ? 4 : surgeScore >= 25 ? 3 : 2;
            reason = `평균 대비 ${volRatio}배 거래량 급증${Math.abs(chg) >= 1 ? ` · 가격 ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%` : ''}. Pre-Pump 신호 — 뉴스·공시 확인 필수.`;
            timingBadge = surgeScore >= 70 ? { label: '⚡ 즉시 주목', cls: 'orange' }
                        : surgeScore >= 50 ? { label: '👀 관찰 중',  cls: 'amber'  }
                        :                    { label: '📋 모니터링', cls: 'cyan'   };
            stopLoss = price * 0.95;
            target   = price * 1.10;
        } else if (kind === 'sepa') {
            // Minervini SEPA — 트렌드템플릿 + VCP + RS + 거래량
            const sepaScore = q._sepaScore ?? q.score ?? 0;
            const trendPassed = q._sepaTrend ?? q.trendPassed ?? 0;
            const vcpFound = q._sepaVcpFound ?? q.vcpFound;
            const vcpIdeal = q._sepaVcpIdeal ?? q.vcpIdeal;
            const rsVal = q._sepaRs ?? q.rs;
            const breakoutVol = q._sepaBreakoutVol ?? q.breakoutVol;
            const baseLowVol = q._sepaBaseLowVol ?? q.baseLowVol;
            const todayVolMult = q._sepaTodayVolMult ?? q.todayVolMult;
            const pivot = q._sepaPivot ?? q.pivot;
            const high52 = q._sepaHigh52 ?? q.high52;
            const low52 = q._sepaLow52 ?? q.low52;

            // ① 트렌드 템플릿
            if (trendPassed === 8)      signals.push({ label: `T ${trendPassed}/8 · 완벽 Stage 2`, cls: 'emerald' });
            else if (trendPassed >= 6)  signals.push({ label: `T ${trendPassed}/8 · 진입 중`,     cls: 'amber'   });
            else                         signals.push({ label: `T ${trendPassed}/8 · 미충족`,     cls: 'red'     });
            // ② VCP
            if (vcpFound && vcpIdeal) signals.push({ label: 'VCP 이상적 (50% 이내)', cls: 'emerald' });
            else if (vcpFound)        signals.push({ label: 'VCP 형성 중',           cls: 'cyan'    });
            // ③ RS
            if (rsVal != null) {
                if (rsVal >= 90)      signals.push({ label: `RS ${rsVal} · 최상위`, cls: 'emerald' });
                else if (rsVal >= 70) signals.push({ label: `RS ${rsVal} · 양호`,   cls: 'cyan'    });
                else                  signals.push({ label: `RS ${rsVal} · 부족`,   cls: 'red'     });
            }
            // ④ 거래량
            if (breakoutVol)       signals.push({ label: `🔥 돌파거래량 ×${(todayVolMult||0).toFixed(1)}`, cls: 'orange' });
            else if (baseLowVol)   signals.push({ label: '베이스 감소 (정상)',                              cls: 'blue'   });
            // ⑤ 피벗 근접도
            if (vcpFound && pivot > 0 && price > 0) {
                const distPct = (pivot - price) / price * 100;
                if (distPct <= 0)      signals.push({ label: `🟢 피벗 돌파 (+${(-distPct).toFixed(1)}%)`, cls: 'emerald' });
                else if (distPct <= 1) signals.push({ label: '🟢 피벗 근접',                              cls: 'emerald' });
                else if (distPct <= 5) signals.push({ label: `피벗 +${distPct.toFixed(1)}%`,              cls: 'amber'   });
            }
            // 점수: 0-100 → 0-6
            score = sepaScore >= 85 ? 6 : sepaScore >= 70 ? 5 : sepaScore >= 55 ? 4 : sepaScore >= 40 ? 3 : sepaScore >= 25 ? 2 : 1;
            // 사유
            const parts = [];
            parts.push(`트렌드 ${trendPassed}/8`);
            if (vcpFound) parts.push(vcpIdeal ? 'VCP 이상적' : 'VCP 형성');
            if (rsVal != null) parts.push(`RS ${rsVal}`);
            if (breakoutVol) parts.push('돌파거래량');
            reason = `Minervini SEPA: ${parts.join(' · ')}. ${sepaScore >= 85 ? '4박자 충족 — 진입 검토.' : sepaScore >= 70 ? '피벗 돌파 대기.' : '추가 조건 형성 대기.'}`;
            // 타이밍
            const pivotNear = vcpFound && pivot > 0 && (pivot - price) / price * 100 <= 1;
            timingBadge = sepaScore >= 85 && pivotNear ? { label:'⚡ 진입 검토', cls:'emerald' }
                       : sepaScore >= 70                 ? { label:'⚡ 피벗 대기', cls:'amber'   }
                       : vcpFound                        ? { label:'📅 베이스 관찰', cls:'cyan' }
                                                         : { label:'📅 추세 형성 대기', cls:'amber' };
            // 예상 수익 — Minervini 1차 목표 +20%
            expectedMove = sepaScore >= 85 ? 20 : sepaScore >= 70 ? 15 : 10;
        }
        // 티어 등급 (시그널 수 기반)
        let tierClass, tierLabel;
        if (kind === 'bounce') {
            const sigCount = (q._bounceSignals || []).length;
            if (sigCount >= 4)      { tierClass = 'alpha-tier1'; tierLabel = 'TIER 1'; }
            else if (sigCount >= 2) { tierClass = 'alpha-tier2'; tierLabel = 'TIER 2'; }
            else                    { tierClass = 'alpha-tier3'; tierLabel = 'TIER 3'; }
        } else {
            if (score >= 5)      { tierClass = 'alpha-tier1'; tierLabel = 'TIER 1'; }
            else if (score >= 3) { tierClass = 'alpha-tier2'; tierLabel = 'TIER 2'; }
            else                 { tierClass = 'alpha-tier3'; tierLabel = 'TIER 3'; }
        }
        // 진입가·손절·목표가 (탭별) — 별도 if 체인으로 분리
        if (kind === 'bounce') {
            stopLoss = price * 0.96;
            target = price * (1 + (expectedMove || 8) / 100);
        } else if (kind === 'daytrade') {
            // 단테 단타: 진입 = 전일고점 +0.3% 또는 현재가 +0.5%
            const prevHi = q._prevHigh ?? q.prevHigh;
            if (prevHi && prevHi > price * 1.003) entry = prevHi * 1.003;
            else entry = price * 1.005;
            stopLoss = entry * 0.97;            // -3%
            target = entry * 1.025;             // +2.5%
            // Volume Profile 섹션 제거 (단테 응답에 vp 미포함)
        } else if (kind === 'dante') {
            stopLoss = price * 0.97;
            target = price * (1 + (expectedMove || 5) / 100);
        } else if (kind === 'sepa') {
            // Minervini SEPA: 피벗 진입, 손절 -10%, 목표 +20% (1차)
            const piv = q._sepaPivot ?? q.pivot;
            entry = (piv && piv > 0) ? piv : price;
            stopLoss = entry * 0.90;     // -10% Minervini 원칙
            target = entry * 1.20;        // +20% 1차 목표
        }
        const rrRatio = ((target - entry) / Math.max(entry - stopLoss, 0.01)).toFixed(1);

        const signalPills = signals.slice(0, 6).map(s =>
            `<span class="alpha-sig-pill alpha-sig--${s.cls}">${escHtml(s.label)}</span>`
        ).join('');

        const scorePct = (score / 6) * 100;
        const scoreColor = score >= 5 ? '#10b981' : score >= 3 ? '#f59e0b' : '#64748b';

        const reasonBox = kind === 'bounce' ?
            `<div class="alpha-reason alpha-reason--red"><i class="ri-arrow-down-circle-line"></i><span>${escHtml(reason)}</span></div>`
            : `<div class="alpha-reason alpha-reason--zap"><i class="ri-flashlight-line"></i><span>${escHtml(reason)}</span></div>`;

        return `<div id="${cardId}" class="alpha-card ${tierClass}">
            <div class="alpha-card-main" onclick="_alphaToggleCard('${cardId}')">
                <div class="alpha-card-head">
                    <div class="alpha-rank">${idx + 1}</div>
                    <div class="tlogo-wrap alpha-card-logo">
                        <img class="tlogo" src="${logoUrl}" alt="${sym}" loading="lazy"
                            onerror="this.outerHTML='<span class=\\'tlogo tlogo-fb\\'>${fb2}</span>'">
                        <span class="tlogo-flag">🇺🇸</span>
                    </div>
                    <div class="alpha-card-id">
                        <div class="alpha-card-top-row">
                            <span class="alpha-sym">${escHtml(sym)}</span>
                            <span class="alpha-tier-badge ${tierClass}">${tierLabel}</span>
                            <span class="alpha-theme-tag">${escHtml(theme)}</span>
                        </div>
                        <div class="alpha-name">${escHtml(name)}</div>
                    </div>
                    <div class="alpha-card-price">
                        <div class="alpha-price">$${priceFmt}</div>
                        <div class="alpha-chg ${isUp ? 'up' : 'down'}">${chgSign}${chg.toFixed(2)}%</div>
                    </div>
                </div>

                ${signalPills ? `<div class="alpha-signals">${signalPills}</div>` : ''}
                <div class="alpha-ai-mini" id="${cardId}-ai-mini" data-pending="1"><span class="alpha-ai-mini-pending">🤖 AI 분석 중…</span></div>

                <div class="alpha-score-row">
                    <div class="alpha-score-bar"><div class="alpha-score-fill" style="width:${scorePct}%;background:${scoreColor}"></div></div>
                    <span class="alpha-score-text" style="color:${scoreColor}">${score}/6</span>
                </div>

                ${reasonBox}

                <div class="alpha-meta-row">
                    <span class="alpha-timing-badge alpha-timing--${timingBadge.cls}">${timingBadge.label}</span>
                    ${kind === 'bounce'
                        ? (bounceTarget > 0 ? `<span class="alpha-expect-badge">🎯 1차 목표가 $${bounceTarget.toFixed(2)}</span>` : '')
                        : (expectedMove > 0 ? `<span class="alpha-expect-badge">예상 수익 +${expectedMove}%</span>` : '')}
                    <span class="alpha-tap-hint">탭하여 진입가 보기 →</span>
                </div>
            </div>

            <div class="alpha-card-expand">
                <div class="alpha-levels">
                    <div class="alpha-level alpha-level--entry">
                        <div class="alpha-level-label">진입가</div>
                        <div class="alpha-level-val">$${entry.toFixed(2)}</div>
                    </div>
                    <div class="alpha-level alpha-level--stop">
                        <div class="alpha-level-label">손절</div>
                        <div class="alpha-level-val">$${stopLoss.toFixed(2)}</div>
                    </div>
                    <div class="alpha-level alpha-level--target">
                        <div class="alpha-level-label">목표가</div>
                        <div class="alpha-level-val">$${target.toFixed(2)}</div>
                    </div>
                </div>
                ${vpSectionHtml}
                <div class="alpha-expand-meta">
                    <span class="alpha-rr">R/R <b>1:${rrRatio}</b></span>
                    <span class="alpha-risk alpha-risk--${risk}">리스크 <b>${riskLabel}</b></span>
                    <button class="alpha-deep-btn" onclick="event.stopPropagation();quickSearch('${sym}','US')">
                        상세 분석 보기 →
                    </button>
                </div>
                <!-- AI 검증은 자동 호출 (v677) — 확장 영역 안에서 결과 표시 -->
                <div class="alpha-ai-result" id="${cardId}-ai" data-item='${JSON.stringify(q).replace(/'/g, '&#39;').replace(/"/g, '&quot;')}'></div>
            </div>
        </div>`;
    }

    // 알파 스캐너 카드 AI 검증 (v674) — Gemini 3.1 Flash-Lite
    async function _runScannerAi(cardId, scannerType, btn) {
        const resultEl = document.getElementById(`${cardId}-ai`);
        if (!resultEl) return;
        if (btn) { btn.disabled = true; btn.textContent = '🤖 AI 분석 중...'; }
        resultEl.innerHTML = '<div class="cat-ai-loading">Gemini 분석 호출 중... (수초)</div>';
        try {
            // 카드의 data-item 에서 종목 원본 데이터 복원
            const raw = resultEl.getAttribute('data-item') || '{}';
            const decoded = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            const q = JSON.parse(decoded);
            const ticker = q.symbol || q.ticker;
            if (!ticker) throw new Error('티커 정보 없음');

            // 탭별 시그널을 candidateData 로 추출
            const cd = { price: q.regularMarketPrice || q.price, marketCap: q.marketCap, changePct: q.regularMarketChangePercent ?? q.changePct };
            if (scannerType === 'bounce') {
                cd.rsi = q.rsi; cd.ma200 = q.ma200; cd.volMult = q.volMult; cd.high52 = q.fiftyTwoWeekHigh;
            } else if (scannerType === 'swing') {
                cd.rr = q._rr; cd.fiftyTwoWeekHigh = q.fiftyTwoWeekHigh;
            } else if (scannerType === 'sepa') {
                cd.score = q._sepaScore; cd.trendPassed = q._sepaTrend;
                cd.vcpFound = q._sepaVcpFound; cd.rs = q._sepaRs;
                cd.todayVolMult = q._sepaTodayVolMult;
            }

            const res = await fetch('/api/scanner/ai-analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker, scannerType, candidateData: cd }),
            });
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            resultEl.innerHTML = _renderScannerAiResult(data);
            if (btn) btn.remove();
        } catch (e) {
            resultEl.innerHTML = `<div class="cat-ai-loading" style="color:#ef4444">AI 분석 실패: ${escHtml(e.message || '오류')}</div>`;
            if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 검증 (재시도)'; }
        }
    }

    function _renderScannerAiResult(d) {
        if (!d || !d.analysis) return '<div class="cat-ai-loading">분석 결과 없음</div>';
        const a = d.analysis;
        const verdictColor = a.verdict === '강한매수' ? '#22c55e'
            : a.verdict === '매수' ? '#84cc16'
            : a.verdict === '관망' ? '#eab308'
            : '#ef4444';
        const riskColor = a.riskLevel === '낮음' ? '#22c55e'
            : a.riskLevel === '중간' ? '#eab308'
            : a.riskLevel === '높음' ? '#f97316'
            : '#ef4444';
        const conf = Number(a.confidence) || 0;
        const confPct = Math.min(100, conf * 10);
        const risks = Array.isArray(a.topRisks) ? a.topRisks.slice(0, 2) : [];
        const risksHtml = risks.length ? `<ul class="cat-ai-points">${risks.map(r => `<li>${escHtml(r)}</li>`).join('')}</ul>` : '';
        return `
        <div class="cat-ai-card">
            <div class="cat-ai-section">
                <div class="cat-ai-title">🤖 AI 검증 (Gemini 3.1 Flash-Lite)</div>
                <div class="cat-ai-row">
                    <span class="cat-ai-key">판단</span>
                    <span class="cat-ai-pill" style="background:${verdictColor};color:#fff">${escHtml(a.verdict || '?')}</span>
                    <span class="cat-ai-key" style="margin-left:8px">신뢰도</span>
                    <span class="cat-ai-val">${conf}/10</span>
                </div>
                <div class="cat-ai-sig">
                    <span class="cat-ai-sig-label">신뢰도</span>
                    <div class="cat-ai-sig-bar"><div class="cat-ai-sig-fill ${conf >= 7 ? 'sig-low' : conf >= 4 ? 'sig-mid' : 'sig-high'}" style="width:${confPct}%"></div></div>
                    <span class="cat-ai-sig-val">${conf}/10</span>
                </div>
                <div class="cat-ai-row">
                    <span class="cat-ai-key">리스크</span>
                    <span class="cat-ai-pill" style="background:${riskColor};color:#fff">${escHtml(a.riskLevel || '?')}</span>
                    <span class="cat-ai-key" style="margin-left:8px">예상</span>
                    <span class="cat-ai-val">${escHtml(String(a.expectedMovePct || '?'))}%</span>
                </div>
                <div class="cat-ai-row">
                    <span class="cat-ai-key">타이밍</span>
                    <span class="cat-ai-val">${escHtml(a.entryTiming || '?')}</span>
                </div>
                ${risksHtml}
                <div class="cat-ai-reasoning">${escHtml(a.reasoning || '')}</div>
                ${a.watchPoint ? `<div class="cat-ai-reasoning" style="border-left:3px solid #6366f1;margin-top:6px">💡 ${escHtml(a.watchPoint)}</div>` : ''}
            </div>
            <div class="cat-ai-foot">${d._meta?.cached ? '캐시 적중' : `${d._meta?.tokensInput || 0}+${d._meta?.tokensOutput || 0} 토큰`}</div>
        </div>`;
    }

    // ═══════════════════════════════════════════════════════════
    // 실적발표 일정 (Earnings Calendar)
    // ═══════════════════════════════════════════════════════════
    const EARNINGS_LS_KEY = 'earnings_cache_v2'; // v2: marketCap, revAct, surprisePct 추가됨 (스키마 변경)
    const EARNINGS_CLIENT_TTL = 2 * 60 * 60 * 1000; // 2시간 (서버 stale-while-revalidate 와 보조)
    window._earnWindow = 'this';
    // 필터 상태
    window._earnFilters = { timing: 'all', result: 'all', search: '', market: 'all' };
    // 날짜 칩 선택 상태 (특정 날짜만 보기; null = 전체 기간)
    window._earnDayFilter = null;
    // 정렬 상태 — null 이면 기본(시가총액 내림차순)
    // 기본은 서버 정렬(장전 BMO → 장후 AMC) 유지 — null
    window._earnSort = { field: null, dir: 'desc' };
    // 주간 캘린더 상태 (v712)
    window._earnWeekOffset = 0;     // 0=이번 주, -1=지난 주, +1=다음 주
    window._earnByDate = {};        // 'YYYY-MM-DD' → items[]
    window._earnExpandedDays = {};  // 'YYYY-MM-DD' → true (펼침)
    const _EARN_WK_MIN = -1, _EARN_WK_MAX = 3;  // 데이터 윈도우(-7~+23일) 내 이동 범위

    function _earnComputeRange(key) {
        // 반환: {from:'YYYY-MM-DD', to:'YYYY-MM-DD', label:'...'}
        const now = new Date();
        const fmt = d => d.toISOString().slice(0, 10);
        const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
        // 주 시작: 월요일 기준 (ET 기준 근사; UTC day로 계산)
        const day = now.getUTCDay(); // 0=Sun
        const mondayOffset = (day === 0 ? -6 : 1 - day);
        const mondayThisWeek = addDays(now, mondayOffset);
        if (key === 'past7') {
            return { from: fmt(addDays(now, -7)), to: fmt(now), label: '지난 7일 실적' };
        } else if (key === 'next') {
            const mondayNext = addDays(mondayThisWeek, 7);
            const sundayNext = addDays(mondayNext, 6);
            return { from: fmt(mondayNext), to: fmt(sundayNext), label: '다음 주 실적' };
        } else if (key === 'month') {
            return { from: fmt(addDays(now, -7)), to: fmt(addDays(now, 23)), label: '최근 30일 실적' };
        }
        // 'this'
        const sundayThis = addDays(mondayThisWeek, 6);
        return { from: fmt(mondayThisWeek), to: fmt(sundayThis), label: '이번 주 실적' };
    }

    function _earnLoadLS(key) {
        try {
            const raw = localStorage.getItem(EARNINGS_LS_KEY);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            const entry = obj?.[key];
            if (!entry) return null;
            if (Date.now() - entry.ts > EARNINGS_CLIENT_TTL) return null;
            return entry.data;
        } catch { return null; }
    }
    function _earnSaveLS(key, data) {
        try {
            const raw = localStorage.getItem(EARNINGS_LS_KEY);
            const obj = raw ? JSON.parse(raw) : {};
            obj[key] = { data, ts: Date.now() };
            localStorage.setItem(EARNINGS_LS_KEY, JSON.stringify(obj));
        } catch {}
    }

    function _earnFmtTiming(t) {
        if (t === 'BMO') return '<span class="earn-timing earn-bmo">🌅 장전</span>';
        if (t === 'AMC') return '<span class="earn-timing earn-amc">🌙 장후</span>';
        return '<span class="earn-timing earn-tbd">⏱ 미정</span>';
    }

    function _earnFmtEps(v) {
        if (typeof v !== 'number' || isNaN(v)) return '-';
        return (v >= 0 ? '$' : '-$') + Math.abs(v).toFixed(2);
    }
    function _earnFmtRev(v) {
        if (typeof v !== 'number' || isNaN(v)) return '-';
        if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
        return '$' + v.toFixed(0);
    }
    function _earnFmtYoy(v) {
        if (typeof v !== 'number' || isNaN(v)) return '';
        const cls = v >= 0 ? 'up' : 'down';
        return `<span class="earn-yoy ${cls}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
    }
    function _earnFmtBeat(b) {
        if (b === 'beat') return '<span class="earn-badge earn-badge-beat">Beat</span>';
        if (b === 'miss') return '<span class="earn-badge earn-badge-miss">Miss</span>';
        if (b === 'meet') return '<span class="earn-badge earn-badge-meet">Meet</span>';
        return '';
    }

    // 시가총액 포맷: $3.21T / $456B / $123M
    function _earnFmtMcap(v) {
        if (typeof v !== 'number' || isNaN(v) || v <= 0) return '-';
        if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
        if (v >= 1e9)  return '$' + (v / 1e9).toFixed(1)  + 'B';
        if (v >= 1e6)  return '$' + (v / 1e6).toFixed(0)  + 'M';
        return '$' + v.toFixed(0);
    }
    // 상회/하회 라벨 + 클래스
    function _earnSurpriseLabel(s) {
        if (typeof s !== 'number' || isNaN(s)) return { label: '-', cls: 'pending' };
        if (s >=  1) return { label: '상회 +' + s.toFixed(1) + '%', cls: 'beat' };
        if (s <= -1) return { label: '하회 ' + s.toFixed(1) + '%',  cls: 'miss' };
        return { label: '부합 ' + (s>=0?'+':'') + s.toFixed(1) + '%', cls: 'meet' };
    }
    // YoY 텍스트 (화살표 없이 +/- 부호만)
    function _earnYoyHtml(v) {
        if (typeof v !== 'number' || isNaN(v)) return '<span class="earn-yoy-na">-</span>';
        const cls = v >= 0 ? 'up' : 'down';
        return `<span class="earn-yoy ${cls}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
    }
    // 시기 아이콘 (해/달)
    function _earnTimingIcon(t) {
        if (t === 'BMO') return '<span class="earn-time-icon bmo" title="장전">☀️</span>';
        if (t === 'AMC') return '<span class="earn-time-icon amc" title="장후">🌙</span>';
        return '<span class="earn-time-icon tbd" title="미정">⏱</span>';
    }

    // ── 주간 캘린더 (v712) ────────────────────────────────────────
    function _earnFmtDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function _earnTodayStr() { return _earnFmtDate(new Date()); }
    // 이번 주 + offset 주의 월요일 Date 반환
    function _earnMonday(offsetWeeks) {
        const d = new Date();
        d.setHours(0,0,0,0);
        const dow = d.getDay();                       // 0=일..6=토
        const toMon = (dow === 0 ? -6 : 1 - dow);
        d.setDate(d.getDate() + toMon + (offsetWeeks||0) * 7);
        return d;
    }
    // 시그널 칩 1개
    // 종목 행 — 로고·티커·예상/실적 지표 (v714)
    function _earnCalRow(item) {
        const sym = item.symbol;
        const name = item.name || sym;
        const surprise = _earnSurpriseLabel(item.surprisePct);
        const reported = item.epsAct != null;
        const stateCls = reported
            ? (surprise.cls === 'beat' ? 'row-beat' : surprise.cls === 'miss' ? 'row-miss' : 'row-meet')
            : 'row-up';
        const timing = item.timing === 'BMO' ? '<span class="ecr-time bmo">☀ 장전</span>'
                     : item.timing === 'AMC' ? '<span class="ecr-time amc">🌙 장후</span>'
                     : '<span class="ecr-time tbd">⏱ 미정</span>';
        // EPS·매출 — 발표 완료 시 예상→실적, 예정 시 예상만
        const epsLine = reported
            ? `EPS <b>${_earnFmtEps(item.epsEst)}</b> → <b class="${item.epsEst!=null && item.epsAct>=item.epsEst?'pos':'neg'}">${_earnFmtEps(item.epsAct)}</b>`
            : `EPS 예상 <b>${_earnFmtEps(item.epsEst)}</b>`;
        const revLine = reported
            ? `매출 <b>${_earnFmtRev(item.revEst)}</b> → <b class="${item.revEst!=null && item.revAct>=item.revEst?'pos':'neg'}">${_earnFmtRev(item.revAct)}</b>`
            : `매출 예상 <b>${_earnFmtRev(item.revEst)}</b>`;
        const yoyHtml = (typeof item.yoy === 'number' && !isNaN(item.yoy))
            ? `<span class="ecr-yoy ${item.yoy>=0?'up':'down'}">YoY ${item.yoy>=0?'+':''}${item.yoy.toFixed(1)}%</span>` : '';
        const surBadge = reported ? `<span class="ecr-sur sur-${surprise.cls}">${surprise.label}</span>` : '';
        const tags = (surBadge || yoyHtml) ? `<div class="ecr-tags">${surBadge}${yoyHtml}</div>` : '';
        return `<button class="earn-cal-row ${stateCls}" onclick="quickSearch('${sym}','US')">
            <div class="ecr-top">
                ${_tickerLogoHTML(sym, 'US')}
                <div class="ecr-id"><span class="ecr-tk">${escHtml(sym)}</span><span class="ecr-nm">${escHtml(name)}</span></div>
                ${timing}
            </div>
            <div class="ecr-metrics"><span class="ecr-m">${epsLine}</span><span class="ecr-m">${revLine}</span></div>
            ${tags}
        </button>`;
    }
    // 하루 칸 1개 (월~금) — 스와이프 캐러셀의 한 페이지
    function _earnBuildDayCell(dateStr, items, isToday, isPast) {
        const [, m, d] = dateStr.split('-');
        const dowK = ['일','월','화','수','목','금','토'][new Date(dateStr+'T00:00:00').getDay()];
        const LIMIT = 8;
        const expanded = !!window._earnExpandedDays[dateStr];
        const shown = expanded ? items : items.slice(0, LIMIT);
        const moreN = items.length - shown.length;
        const rows = shown.map(_earnCalRow).join('');
        const moreBtn = moreN > 0
            ? `<button class="earn-cal-more" onclick="_earnToggleDay('${dateStr}')">+${moreN}개 더 보기</button>`
            : (expanded && items.length > LIMIT
                ? `<button class="earn-cal-more" onclick="_earnToggleDay('${dateStr}')">접기</button>` : '');
        return `<div class="earn-cal-day${isToday?' is-today':''}${isPast?' is-past':''}" data-date="${dateStr}">
            <div class="earn-cal-dayhd">
                <span class="ecd-dow">${dowK}</span>
                <span class="ecd-date">${+m}/${+d}</span>
                ${items.length ? `<span class="ecd-cnt">${items.length}개</span>` : ''}
            </div>
            <div class="earn-cal-rows">${rows || '<div class="earn-cal-none">실적 발표 없음</div>'}${moreBtn}</div>
        </div>`;
    }
    function _earnToggleDay(dateStr) {
        window._earnExpandedDays[dateStr] = !window._earnExpandedDays[dateStr];
        // 그리드는 가로 스크롤 캐러셀 → 재렌더 시 scrollLeft 초기화되며 화면이 튐.
        // 보던 위치 그대로 아래로 펼쳐지도록 가로 스크롤 위치를 보존한다.
        const grid = document.getElementById('earningsGrid');
        const sx = grid ? grid.scrollLeft : 0;
        _earnRenderWeek();
        if (grid) {
            grid.scrollLeft = sx;                       // 동기 복원
            requestAnimationFrame(() => { grid.scrollLeft = sx; }); // 레이아웃 확정 후 재복원
        }
    }
    function _earnWeekNav(delta) {
        const next = (window._earnWeekOffset || 0) + delta;
        if (next < _EARN_WK_MIN || next > _EARN_WK_MAX) return;
        window._earnWeekOffset = next;
        window._earnExpandedDays = {};  // 주 이동 시 펼침 초기화
        _earnRenderWeek();
    }
    // 주간 캘린더 렌더 — _earnByDate + 필터 상태로 그림
    function _earnRenderWeek() {
        const grid = document.getElementById('earningsGrid');
        if (!grid) return;
        const offset = window._earnWeekOffset || 0;
        const mon = _earnMonday(offset);
        const f = window._earnFilters || {};
        const search = (document.getElementById('earnSearch')?.value || '').toLowerCase().trim();
        const today = _earnTodayStr();
        let totalShown = 0, cells = '';
        for (let i = 0; i < 5; i++) {  // 월~금
            const dt = new Date(mon); dt.setDate(dt.getDate() + i);
            const ds = _earnFmtDate(dt);
            const items = (window._earnByDate[ds] || []).filter(it => {
                const sc = _earnSurpriseLabel(it.surprisePct).cls;
                if (f.timing && f.timing !== 'all' && (it.timing||'TBD') !== f.timing) return false;
                if (f.result && f.result !== 'all' && sc !== f.result) return false;
                if (search && !((it.symbol+' '+(it.name||'')).toLowerCase().includes(search))) return false;
                return true;
            });
            totalShown += items.length;
            cells += _earnBuildDayCell(ds, items, ds === today, ds < today);
        }
        grid.innerHTML = cells;
        // 주 라벨
        const fri = new Date(mon); fri.setDate(fri.getDate() + 4);
        const word = offset === 0 ? '이번 주' : offset === -1 ? '지난 주' : offset === 1 ? '다음 주' : `${offset}주 후`;
        const lbl = document.getElementById('earnWeekLabel');
        if (lbl) lbl.textContent = `${word} · ${mon.getMonth()+1}/${mon.getDate()} – ${fri.getMonth()+1}/${fri.getDate()}`;
        // 네비 버튼 비활성
        const pv = document.getElementById('earnWkPrev'), nx = document.getElementById('earnWkNext');
        if (pv) pv.disabled = offset <= _EARN_WK_MIN;
        if (nx) nx.disabled = offset >= _EARN_WK_MAX;
        const emptyEl = document.getElementById('earningsEmpty');
        if (emptyEl) emptyEl.hidden = totalShown > 0;
        // 오늘(또는 이번 주면 첫 평일) 칸으로 가로 스크롤 이동
        try {
            const target = grid.querySelector('.earn-cal-day.is-today')
                || (offset === 0 ? grid.querySelector('.earn-cal-day') : null);
            if (target) {
                grid.scrollLeft = target.getBoundingClientRect().left
                    - grid.getBoundingClientRect().left + grid.scrollLeft;
            } else {
                grid.scrollLeft = 0;
            }
        } catch (e) {}
    }

    function _earnBuildRow(item) {
        const symbol = item.symbol;
        const market = 'US';
        const name   = item.name || symbol;
        const safeName = escHtml(name).replace(/'/g, '&#39;');
        const faved  = (typeof isFavorited === 'function') ? isFavorited(symbol, market) : false;
        const heartCls = faved ? 'ri-star-fill' : 'ri-star-line';
        const surprise = _earnSurpriseLabel(item.surprisePct);
        // 검색 매칭용 lower-cased
        const searchKey = (symbol + ' ' + name).toLowerCase().replace(/"/g, '');
        const mktTag = item.inSP500 ? 'sp500' : 'other';
        return `<div class="earn-row" data-symbol="${symbol}" data-timing="${item.timing||'TBD'}" data-result="${surprise.cls}" data-search="${escHtml(searchKey)}" data-market="${mktTag}"
                     data-mcap="${item.marketCap ?? 0}" data-eps-est="${item.epsEst ?? ''}" data-rev-est="${item.revEst ?? ''}" data-yoy="${item.yoy ?? ''}" data-surp="${item.surprisePct ?? ''}"
                     onclick="quickSearch('${symbol}','US')">
            <button class="earn-fav-btn ${faved?'on':''}" aria-label="즐겨찾기" onclick="_top100ToggleFav(event,'${symbol}','${market}','${safeName}')"><i class="${heartCls}"></i></button>
            <div class="earn-cell-stock">
                ${_tickerLogoHTML(symbol, market, name)}
                <div class="earn-stock-id">
                    <span class="earn-ticker">${escHtml(symbol)}</span>
                    <span class="earn-stock-name" title="${escHtml(name)}">${escHtml(name)}</span>
                </div>
            </div>
            <div class="earn-cell-time">${_earnTimingIcon(item.timing)}</div>
            <div class="earn-cell-mcap">${_earnFmtMcap(item.marketCap)}</div>
            <div class="earn-cell-eps">
                <span class="ec-est">${_earnFmtEps(item.epsEst)}</span>
                <span class="ec-sep">/</span>
                <span class="ec-act ${item.epsAct != null && item.epsEst != null ? (item.epsAct >= item.epsEst ? 'pos':'neg') : ''}">${_earnFmtEps(item.epsAct)}</span>
            </div>
            <div class="earn-cell-rev">
                <span class="ec-est">${_earnFmtRev(item.revEst)}</span>
                <span class="ec-sep">/</span>
                <span class="ec-act ${item.revAct != null && item.revEst != null ? (item.revAct >= item.revEst ? 'pos':'neg') : ''}">${_earnFmtRev(item.revAct)}</span>
            </div>
            <div class="earn-cell-yoy">${_earnYoyHtml(item.yoy)}</div>
            <div class="earn-cell-status earn-status-${surprise.cls}">${surprise.label}</div>
            <div class="earn-cell-ai${item.epsAct == null ? ' earn-cell-ai--empty' : ''}" data-earnings-ai="${symbol}">${item.epsAct != null ? '<span class="earn-ai-loading">분석 중…</span>' : ''}</div>
        </div>`;
    }

    function _earnBuildGroup(g) {
        // 정렬 적용
        const items = _earnSortItems(g.items);
        const rows = items.map(_earnBuildRow).join('');
        const [y, m, d] = g.date.split('-');
        // 지난 날짜 (오늘 이전)는 아코디언으로 접어 표시 — 사용자 로컬 시간대 기준
        const _now = new Date();
        const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
        const isPast = g.date < today;
        const collapsedCls = isPast ? ' earn-group-collapsed earn-group-past' : '';
        const chevron = isPast ? '<span class="earn-date-chevron" aria-hidden="true">▾</span>' : '';
        const sortF = window._earnSort?.field || 'marketCap';
        const sortDir = window._earnSort?.dir || 'desc';
        const thSort = (field, label) => {
            const cls = sortF === field ? (sortDir === 'asc' ? ' sort-asc' : ' sort-desc') : '';
            return `<div class="earn-th sortable${cls}" data-sort="${field}" onclick="_earnSortBy('${field}')">${label}</div>`;
        };
        return `<div class="earn-date-group${collapsedCls}" data-past="${isPast}" data-date="${g.date}">
            <div class="earn-date-header" role="${isPast ? 'button' : 'heading'}" tabindex="${isPast ? '0' : '-1'}">
                <span class="earn-date-main">${m}/${d}</span>
                <span class="earn-date-dow">(${g.dayOfWeek})</span>
                <span class="earn-date-count">${g.count}개 종목</span>
                ${chevron}
            </div>
            <div class="earn-date-rows">${rows}</div>
        </div>`;
    }

    // 정렬 적용 (현재 _earnSort.field / .dir)
    function _earnSortItems(items) {
        const f = window._earnSort?.field;
        const dir = window._earnSort?.dir === 'asc' ? 1 : -1;
        if (!f) return items;
        const arr = items.slice();
        arr.sort((a, b) => {
            const va = a[f], vb = b[f];
            const aNull = va == null || isNaN(va);
            const bNull = vb == null || isNaN(vb);
            if (aNull && bNull) return 0;
            if (aNull) return 1;   // null 은 항상 뒤로
            if (bNull) return -1;
            return (va - vb) * dir;
        });
        return arr;
    }

    // 정렬 트리거 — 같은 컬럼 클릭 시 방향 토글
    function _earnSortBy(field) {
        if (window._earnSort.field === field) {
            window._earnSort.dir = window._earnSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            window._earnSort = { field, dir: 'desc' };
        }
        // 정렬 표시는 _earnBuildGroup() 재렌더 시 자동 반영됨 (각 그룹 헤더 내 생성)
        // 캐시된 데이터 다시 렌더
        const key = window._earnWindow || 'this';
        const cached = _earnLoadLS(key);
        if (cached?.groups?.length) {
            const grid = document.getElementById('earningsGrid');
            if (grid) grid.innerHTML = cached.groups.map(_earnBuildGroup).join('');
            _earnApplyFilters();
        }
    }

    // 필터 칩 토글
    function _earnSetFilter(group, value, btn) {
        window._earnFilters[group] = value;
        // 같은 그룹의 다른 칩 active 해제
        const wrap = btn.closest('.earn-chip-group');
        if (wrap) wrap.querySelectorAll('.earn-chip').forEach(c => c.classList.toggle('active', c === btn));
        _earnApplyFilters();
    }

    // 검색 + 필터 적용 (DOM 에 직접 hidden 클래스 토글)
    // 필터/검색 변경 → 주간 캘린더 재렌더 (v712)
    function _earnApplyFilters() {
        window._earnFilters.search = (document.getElementById('earnSearch')?.value || '').toLowerCase().trim();
        _earnRenderWeek();
    }

    // 아코디언 토글: 지난 날짜 그룹 펼침/접기 (인자로 element 직접 전달도 호환)
    function _earnToggleGroup(elOrEvent) {
        let group = null;
        if (elOrEvent instanceof Event) {
            const hdr = elOrEvent.target?.closest?.('.earn-date-header');
            group = hdr?.closest?.('.earn-date-group');
        } else if (elOrEvent && elOrEvent.classList) {
            group = elOrEvent.classList.contains('earn-date-group')
                ? elOrEvent
                : elOrEvent.closest?.('.earn-date-group');
        }
        if (!group || !group.classList.contains('earn-group-past')) return;
        group.classList.toggle('earn-group-collapsed');
    }

    // earningsGrid 에 delegated click listener — 인라인 onclick 대신
    // idempotent: 여러 번 호출되어도 안전 (이전 listener 제거 후 재등록)
    function _earnAttachClickHandler() {
        const grid = document.getElementById('earningsGrid');
        if (!grid) return;
        // 이전 listener 가 있으면 제거 (중복 등록 방지)
        if (grid._earnClickListener) grid.removeEventListener('click', grid._earnClickListener);
        if (grid._earnKeydownListener) grid.removeEventListener('keydown', grid._earnKeydownListener);

        grid._earnClickListener = (e) => {
            const hdr = e.target.closest('.earn-date-header');
            if (!hdr) return;
            const group = hdr.closest('.earn-date-group');
            if (!group?.classList.contains('earn-group-past')) return;
            e.stopPropagation();
            group.classList.toggle('earn-group-collapsed');
        };
        // 키보드 접근성: Enter/Space 로 토글
        grid._earnKeydownListener = (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const hdr = e.target?.closest?.('.earn-date-header');
            const group = hdr?.closest?.('.earn-date-group');
            if (!group?.classList.contains('earn-group-past')) return;
            e.preventDefault();
            group.classList.toggle('earn-group-collapsed');
        };
        grid.addEventListener('click', grid._earnClickListener);
        grid.addEventListener('keydown', grid._earnKeydownListener);
    }

    function _earnSkeleton(n) {
        let html = '<div class="earn-date-group"><div class="earn-date-header"><span class="skel skel-rank" style="width:60px"></span></div><div class="earn-date-rows">';
        for (let i = 0; i < n; i++) {
            html += `<div class="earn-row skel-row">
                <div class="skel skel-fav"></div>
                <div class="skel skel-logo"></div>
                <div class="skel-info"><div class="skel skel-name"></div></div>
                <div class="skel skel-price"></div>
                <div class="skel skel-price"></div>
            </div>`;
        }
        html += '</div></div>';
        return html;
    }

    // groups[] → window._earnByDate 맵으로 변환
    // 중국 기업(미국 상장 ADR 포함) 판별 — 캘린더에서 제외
    const _CN_EARN_TICKERS = new Set(
        ('BABA JD PDD BIDU NIO LI XPEV NTES TCOM BILI IQ TME HUYA DOYU VIPS YMM BEKE ' +
         'TAL EDU ZTO GDS KC DADA MOMO WB ATHM QFIN FINV TIGR FUTU LU ATAT GOTU EH ' +
         'RLX DQ JKS CSIQ NOAH HTHT YUMC ZLAB LX TUYA ZK MNSO QD NWTN BZ DAO ZH ' +
         'API CANG SOS BTBT RERE JFIN SOHU SINA UXIN YRD NCTY JG').split(/\s+/)
    );
    function _isChineseEarnStock(item) {
        if (!item) return false;
        const sym = (item.symbol || '').toUpperCase();
        if (_CN_EARN_TICKERS.has(sym)) return true;
        const name = item.name || '';
        return /\bchina\b|\bchinese\b|중국/i.test(name);
    }
    function _earnIndexGroups(groups) {
        const map = {};
        (groups || []).forEach(g => {
            if (g && g.date) map[g.date] = (g.items || []).filter(it => !_isChineseEarnStock(it));
        });
        window._earnByDate = map;
    }

    async function loadEarnings() {
        // 주간 캘린더: 항상 month 윈도우(-7~+23일)로 받아 여러 주 이동 지원 (v712)
        const key = 'month';
        const range = _earnComputeRange(key);
        const grid = document.getElementById('earningsGrid');
        if (!grid) return;

        // 1) LS 캐시 우선 — 즉시 렌더
        const cached = _earnLoadLS(key);
        if (cached?.groups?.length) {
            _earnIndexGroups(cached.groups);
            _earnRenderWeek();
        } else {
            grid.innerHTML = '<div class="earn-cal-loading">실적 일정 불러오는 중…</div>';
        }

        // 2) 네트워크
        try {
            const favs = (typeof getFavorites === 'function' ? getFavorites() : [])
                .filter(f => f.market === 'US')
                .map(f => f.symbol)
                .filter(s => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s))
                .slice(0, 50)
                .join(',');
            const url = `/api/earnings-calendar?from=${range.from}&to=${range.to}${favs ? '&favs=' + encodeURIComponent(favs) : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            _earnSaveLS(key, data);
            _earnIndexGroups(Array.isArray(data.groups) ? data.groups : []);
            _earnRenderWeek();
        } catch (err) {
            if (!cached || !cached.groups?.length) {
                grid.innerHTML = `<div class="disc-empty-inline">불러오기에 실패했어요. 잠시 후 다시 시도해 주세요.</div>`;
            }
        }
    }

    // ── AI 어닝콜 요약 + 감성 분석 enrich ─────────────────────────
    const _EARN_AI_LS_KEY = 'earnings_ai_v3';
    const _EARN_AI_TTL = 2 * 60 * 60 * 1000; // 2h

    function _earnAiLoadLS() {
        try {
            const raw = localStorage.getItem(_EARN_AI_LS_KEY);
            if (!raw) return {};
            const obj = JSON.parse(raw);
            const now = Date.now();
            const fresh = {};
            Object.keys(obj || {}).forEach(k => {
                const v = obj[k];
                if (v && typeof v._t === 'number' && now - v._t < _EARN_AI_TTL) fresh[k] = v;
            });
            return fresh;
        } catch { return {}; }
    }
    function _earnAiSaveLS(map) {
        try {
            // 200개 상한 — 오래된 것부터 삭제
            const entries = Object.entries(map).sort((a,b) => (b[1]._t||0) - (a[1]._t||0)).slice(0, 200);
            const trimmed = Object.fromEntries(entries);
            localStorage.setItem(_EARN_AI_LS_KEY, JSON.stringify(trimmed));
        } catch {}
    }

    function _earnAiRender(symbol, data) {
        const cells = document.querySelectorAll(`.earn-cell-ai[data-earnings-ai="${symbol}"]`);
        if (!cells.length) return;
        // 동그라미 이모지 제거 — 라벨 텍스트만 표시 (v543)
        const sentMap = { positive: { label:'긍정' }, negative: { label:'부정' }, neutral: { label:'보통' } };
        const s = sentMap[data?.sentiment] || sentMap.neutral;
        const summary = (data?.summary || '').trim();
        const pros = (data?.highlights?.[0] || '').trim();
        const cons = (data?.highlights?.[1] || '').trim();
        cells.forEach(el => {
            if (!summary && !pros) { el.innerHTML = ''; el.classList.add('earn-cell-ai--empty'); return; }
            el.classList.remove('earn-cell-ai--empty');
            const isHomeCard = el.classList.contains('earn-hc-ai');
            if (isHomeCard && (pros || cons)) {
                const prosHtml = pros ? `<div class="earn-hc-point positive"><span class="earn-sent-badge earn-sent-positive">긍정</span><span class="earn-ai-summary">${escHtml(pros)}</span></div>` : '';
                const consHtml = cons ? `<div class="earn-hc-point negative"><span class="earn-sent-badge earn-sent-negative">부정</span><span class="earn-ai-summary">${escHtml(cons)}</span></div>` : '';
                el.innerHTML = prosHtml + consHtml;
            } else {
                el.innerHTML = `<span class="earn-sent-badge earn-sent-${data.sentiment}" title="${s.label}">${s.label}</span><span class="earn-ai-summary" title="${escHtml(summary)}">${escHtml(summary)}</span>`;
            }
        });
    }

    async function _enrichEarningsWithAI(items) {
        if (!Array.isArray(items) || !items.length) return;
        const cache = _earnAiLoadLS();
        // 클라이언트 캐시 hit 먼저 렌더
        const need = [];
        items.forEach(it => {
            const sym = it.symbol;
            if (!sym) return;
            const c = cache[sym];
            if (c && c.summary) {
                _earnAiRender(sym, c);
            } else {
                need.push(sym);
            }
        });
        // 캐시 미스 — 한 번에 최대 20개씩 끊어서 요청
        if (!need.length) return;
        const CHUNK = 20;
        for (let i = 0; i < need.length; i += CHUNK) {
            const batch = need.slice(i, i + CHUNK);
            try {
                const res = await fetch(`/api/earnings-summary?symbols=${batch.join(',')}`);
                if (!res.ok) continue;
                const map = await res.json();
                Object.keys(map || {}).forEach(sym => {
                    const data = map[sym];
                    if (!data || !data.summary) return;
                    cache[sym] = { ...data, _t: Date.now() };
                    _earnAiRender(sym, data);
                });
                // 응답에 없는 종목은 빈 셀로 정리
                batch.filter(s => !map[s]).forEach(sym => {
                    const cells = document.querySelectorAll(`.earn-cell-ai[data-earnings-ai="${sym}"]`);
                    cells.forEach(el => { el.innerHTML = ''; });
                });
            } catch(e) { /* 무시 */ }
        }
        _earnAiSaveLS(cache);
    }

    function setEarningsWindow(key) {
        window._earnWindow = key;
        window._earnDayFilter = null; // 기간 전환 시 날짜 필터 초기화
        _earnBuildDateChips(); // 날짜 칩 재생성 + active 갱신
        loadEarnings();
    }

    // ── 날짜 칩 동적 생성 ─────────────────────────────────────────
    function _earnBuildDateChips() {
        const el = document.getElementById('earnDateChips');
        if (!el) return;
        const activeKey = window._earnDayFilter ? `day:${window._earnDayFilter}` : window._earnWindow || 'this';
        const dow = ['일', '월', '화', '수', '목', '금', '토'];
        const now = new Date();
        const chips = [];

        // 이번 주 / 다음 주만
        chips.push({ label: '이번 주', key: 'this' });
        chips.push({ label: '다음 주', key: 'next' });

        el.innerHTML = chips.map(c => {
            const isActive = c.key === activeKey;
            const cls = ['earn-date-chip', isActive ? 'active' : '', c.indent ? 'day-sub' : ''].filter(Boolean).join(' ');
            return `<button class="${cls}" data-key="${c.key}" onclick="_earnSelectDateChip('${c.key}', this)">${c.label}</button>`;
        }).join('');
    }

    // 날짜 칩 클릭 처리
    function _earnSelectDateChip(key, btn) {
        if (key.startsWith('day:')) {
            const dateStr = key.slice(4);
            // 이번 주 날짜이므로 'this' 윈도우 로드 후 해당 날짜만 필터
            const prevWindow = window._earnWindow;
            window._earnDayFilter = dateStr;
            // active 칩 갱신
            document.querySelectorAll('.earn-date-chip').forEach(c => c.classList.toggle('active', c.dataset.key === key));
            if (prevWindow !== 'this') {
                window._earnWindow = 'this';
                loadEarnings(); // 재로드 후 _earnApplyFilters 가 dayFilter 적용
            } else {
                _earnApplyFilters(); // 이미 'this' 윈도우 → 즉시 필터 적용
            }
        } else {
            window._earnDayFilter = null;
            setEarningsWindow(key); // 기간 전환
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 💼 내 포지션 (My Position) — localStorage + IndexedDB 백업 (v716)
    // ═══════════════════════════════════════════════════════════
    const _POS_KEY = 'stock_positions';
    window._posStatusFilter = 'holding';
    let _posChartLines = [];
    let _posSheetState = null;
    let _posPriceMap = {};

    function _posLoad() {
        try { const a = JSON.parse(localStorage.getItem(_POS_KEY)); return Array.isArray(a) ? a : []; }
        catch(e) { return []; }
    }
    function _posSaveAll(arr) {
        try { localStorage.setItem(_POS_KEY, JSON.stringify(arr)); } catch(e) {}
        _posBackupIDB(arr);
    }
    // IndexedDB 보조 백업 — localStorage 손실 대비
    function _posBackupIDB(arr) {
        try {
            const req = indexedDB.open('stockai_positions', 1);
            req.onupgradeneeded = () => { try { req.result.createObjectStore('kv'); } catch(e){} };
            req.onsuccess = () => {
                try {
                    const tx = req.result.transaction('kv', 'readwrite');
                    tx.objectStore('kv').put({ data: arr, ts: Date.now() }, 'positions');
                } catch(e){}
            };
        } catch(e) {}
    }
    function _posUuid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
    function _posToday() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    function _posForTicker(t) { return _posLoad().filter(p => p.ticker === t); }
    function _posLatestForTicker(t) { const l=_posForTicker(t); return l.length ? l[l.length-1] : null; }
    function _posActiveForTicker(t) {
        const open = _posForTicker(t).filter(p => p.status !== 'closed');
        return open.length ? open[open.length-1] : null;
    }
    function _posCurrentPrice() {
        try {
            const m = stockData?.meta;
            // 프리/애프터 포함 세션 가격 — fetchMarketSession 이 v7 quote 기준으로 갱신
            if (m && m._sessionPrice != null) return m._sessionPrice;
            // 정규장 가격 (startLiveUpdate 가 라이브 갱신)
            if (m && m.regularMarketPrice != null) return m.regularMarketPrice;
            // fallback: 마지막 캔들 종가
            const cl = (stockData?.indicators?.quote?.[0]?.close || [])
                .filter(v => v != null);
            return cl.length ? cl[cl.length - 1] : null;
        } catch(e) {}
        return null;
    }
    function _posFmtP(v, market) {
        if (v == null || isNaN(v)) return '-';
        return (market === 'KR') ? Math.round(v).toLocaleString()+'원' : '$'+Number(v).toFixed(2);
    }
    function _posPnlPct(entry, cur) {
        if (!entry || cur == null || isNaN(cur)) return null;
        return (cur - entry) / entry * 100;
    }

    // ── 타임프레임 문자열 → 분 변환 (5m→5, 1h→60, 1d→1440 ...) ──
    function _intervalToMin(iv) {
        if (!iv) return 0;
        const m = String(iv).match(/^(\d+)\s*(m|h|d|wk|mo)$/i);
        if (!m) return 0;
        const v = parseInt(m[1], 10), u = m[2].toLowerCase();
        return u === 'm' ? v : u === 'h' ? v * 60 : u === 'd' ? v * 1440
             : u === 'wk' ? v * 10080 : v * 43200;
    }

    // ── 타임프레임 + 스윙 구조 + ATR 기반 동적 익절가 자동 계산 ──
    //   순수 계산 함수 (부작용 없음). 포지션 익절가 미설정 시 폴백으로 사용.
    //   우선순위: ① 진입가 위 피봇 고점  ② ATR×R 배수 (폴백)
    //   타임프레임별 lookback·배율 — 5m:20봉×0.8 / 15m:30×1.0 / 1h:40×1.2 / 4h:50×1.5 / 1d:60×2.0
    function _calcAutoTpLevels(candleData, ts, entryPrice) {
        if (!candleData || candleData.length < 20 || !entryPrice || entryPrice <= 0) return null;
        const highs  = candleData.map(c => c.high).filter(v => v != null);
        const lows   = candleData.map(c => c.low).filter(v => v != null);
        const closes = candleData.map(c => c.close).filter(v => v != null);
        const n = closes.length;
        if (n < 20 || highs.length < 20 || lows.length < 20) return null;

        // 타임프레임(분) — currentInterval 우선, 없으면 ts 간격으로 추정
        let tfMin = _intervalToMin(typeof currentInterval !== 'undefined' ? currentInterval : '');
        if (!tfMin && ts && ts.length >= 2) {
            const d = Number(ts[1]) - Number(ts[0]);
            if (isFinite(d) && d > 0) tfMin = Math.round(d / 60);
        }
        if (!tfMin || !isFinite(tfMin)) tfMin = 5;

        // 타임프레임별 스윙 lookback + R 거리 배율
        const swingLookback = tfMin <= 5 ? 20 : tfMin <= 15 ? 30 : tfMin <= 60 ? 40 : tfMin <= 240 ? 50 : 60;
        const tfMultiplier  = tfMin <= 5 ? 0.8 : tfMin <= 15 ? 1.0 : tfMin <= 60 ? 1.2 : tfMin <= 240 ? 1.5 : 2.0;

        // ATR(14) — True Range 평균
        const atrLen = 14;
        let atrSum = 0, atrCnt = 0;
        for (let i = Math.max(1, n - atrLen); i < n; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i]  - closes[i - 1])
            );
            if (isFinite(tr) && tr >= 0) { atrSum += tr; atrCnt++; }
        }
        const atr = atrCnt ? atrSum / atrCnt : 0;
        if (!atr || atr <= 0 || !isFinite(atr)) return null;

        // 진입가 위 피봇 고점 (3봉 기준 — 좌우보다 높은 봉)
        const lbHigh = highs.slice(-swingLookback);
        const pivotHighs = [];
        for (let i = 1; i < lbHigh.length - 1; i++) {
            if (lbHigh[i] > lbHigh[i - 1] && lbHigh[i] > lbHigh[i + 1] && lbHigh[i] > entryPrice) {
                pivotHighs.push(lbHigh[i]);
            }
        }
        pivotHighs.sort((a, b) => a - b); // 오름차순
        const recentHigh = Math.max(...lbHigh);

        // R 거리 = ATR×1.5 × 타임프레임 배율 (단기=보수적, 장기=공격적)
        const risk = atr * 1.5 * tfMultiplier;
        const tp1Base = entryPrice + risk * 1.0;
        const tp2Base = entryPrice + risk * 2.0;
        const tp3Base = entryPrice + risk * 3.0;

        // 피봇 고점이 있으면 각 base 이상인 가장 가까운 피봇 사용, 없으면 ATR base
        let t1 = pivotHighs.find(h => h >= tp1Base * 0.99) || tp1Base;
        let t2 = pivotHighs.find(h => h >= tp2Base * 0.99) || tp2Base;
        let t3 = Math.max(recentHigh, tp3Base);

        // 순서 보장: tp1 < tp2 < tp3 (최소 0.5R 간격)
        if (t2 <= t1) t2 = t1 + risk * 0.5;
        if (t3 <= t2) t3 = t2 + risk * 0.5;

        return {
            tp1: +t1.toFixed(2),
            tp2: +t2.toFixed(2),
            tp3: +t3.toFixed(2),
            atr: +atr.toFixed(4),
            risk: +risk.toFixed(4),
            tfMin,
            swingHigh: +recentHigh.toFixed(2),
            pivotHighs: pivotHighs.slice(0, 3).map(h => +h.toFixed(2)),
            method: pivotHighs.length > 0 ? 'pivot' : 'atr',
        };
    }

    // ── 차트 내 진입가 라인 ──────────────────────────────────────
    function _posClearChartLine() {
        _posChartLines.forEach(pl => { try { lwCandleSeries?.removePriceLine(pl); } catch(e){} });
        _posChartLines = [];
    }
    function _posDrawChartLine() {
        if (!lwCandleSeries) return;
        _posClearChartLine();
        if (!currentSymbol) return;
        const pos = _posLatestForTicker(currentSymbol);
        if (!pos || !pos.entryPrice) return;
        const cur = _posCurrentPrice();
        const _addPosLine = (price, color, width, style, title) => {
            if (!price || !isFinite(price) || price <= 0) return;
            try {
                _posChartLines.push(lwCandleSeries.createPriceLine({
                    price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title,
                }));
            } catch(e) {}
        };
        try {
            if (pos.status === 'closed') {
                _addPosLine(pos.entryPrice, '#9D4EDD', 2, 2, `내 진입 ${_posFmtP(pos.entryPrice,currentMarket)}`);
                if (pos.closedPrice) {
                    const rl = _posPnlPct(pos.entryPrice, pos.closedPrice);
                    _addPosLine(pos.closedPrice, '#94a3b8', 2, 2,
                        `내 매도 ${_posFmtP(pos.closedPrice,currentMarket)}${rl!=null?` (실현 ${rl>=0?'+':''}${rl.toFixed(1)}%)`:''}`)
                }
            } else {
                const pnl = _posPnlPct(pos.entryPrice, cur);
                const pnlTxt = pnl != null ? ` (${pnl>=0?'+':''}${pnl.toFixed(1)}%)` : '';
                _addPosLine(pos.entryPrice, '#9D4EDD', 2, 0,
                    `내 ${pos.status==='watching'?'목표':'진입'} ${_posFmtP(pos.entryPrice,currentMarket)}${pnlTxt}`);

                // 분할매수 차수별 라인 (splits 있으면 개별 표시, 없으면 진입가 하나만)
                const _splitColors = ['#06B6D4','#3B82F6','#8B5CF6','#F97316','#10B981','#F59E0B'];
                if (pos.splits && pos.splits.length > 1) {
                    pos.splits.forEach((sp, i) => {
                        if (sp.nth === 1) return; // 1차는 이미 위에서 그림
                        const color = _splitColors[i] || '#94a3b8';
                        _addPosLine(sp.price, color, 1, 2,
                            `${sp.nth}차 진입 ${_posFmtP(sp.price,currentMarket)}`);
                    });
                }

                // 손절가 (holding 전용) — M3: 1px dashed, rgba 0.6, 가격축 chip만
                if (pos.status === 'holding' && pos.stopLoss) {
                    _addPosLine(pos.stopLoss, 'rgba(239,68,68,0.6)', 1, 2, '');
                }
                // ── 익절가: 포지션 설정값 우선, 미설정 시 타임프레임 기반 자동 계산 ──
                //   기존 pos.tp1/2/3 값이 있으면 절대 덮어쓰지 않음 (설정값 우선)
                let _tp1 = pos.tp1, _tp2 = pos.tp2, _tp3 = pos.tp3;
                let _autoTp = null;
                if ((!_tp1 || !_tp2 || !_tp3) && _lastSigArgs && _lastSigArgs.candleData) {
                    _autoTp = _calcAutoTpLevels(_lastSigArgs.candleData, _lastSigArgs.ts, pos.entryPrice);
                    if (_autoTp) {
                        _tp1 = _tp1 || _autoTp.tp1;
                        _tp2 = _tp2 || _autoTp.tp2;
                        _tp3 = _tp3 || _autoTp.tp3;
                    }
                }
                // 자동 계산된 차수는 🤖 표시 (설정값이면 마크 없음)
                const _autoMk = saved => saved ? '' : '🤖 ';
                // 1차 익절가
                if (_tp1) {
                    const tp1Pct = _posPnlPct(pos.entryPrice, _tp1);
                    _addPosLine(_tp1, '#22C55E', 1, 2,
                        `${_autoMk(pos.tp1)}익절1 ${_posFmtP(_tp1,currentMarket)}${tp1Pct!=null?` (+${tp1Pct.toFixed(1)}%)`:''}`)
                }
                // 2차 익절가 (_chartTpLevel >= 2 일 때만)
                if (_tp2 && _chartTpLevel >= 2) {
                    const tp2Pct = _posPnlPct(pos.entryPrice, _tp2);
                    _addPosLine(_tp2, '#86EFAC', 1, 2,
                        `${_autoMk(pos.tp2)}익절2 ${_posFmtP(_tp2,currentMarket)}${tp2Pct!=null?` (+${tp2Pct.toFixed(1)}%)`:''}`)
                }
                // 3차 익절가 (_chartTpLevel >= 3 일 때만)
                if (_tp3 && _chartTpLevel >= 3) {
                    const tp3Pct = _posPnlPct(pos.entryPrice, _tp3);
                    _addPosLine(_tp3, '#9D4EDD', 2, 2,
                        `${_autoMk(pos.tp3)}익절3 ${_posFmtP(_tp3,currentMarket)}${tp3Pct!=null?` (+${tp3Pct.toFixed(1)}%)`:''}`)
                }
                // 차트 시그널 바에 자동 계산 근거 배지 (이전 배지는 항상 제거 후 갱신)
                try {
                    const _bar = document.getElementById('chartSigBar');
                    if (_bar) {
                        const _old = document.getElementById('tpAutoPill');
                        if (_old) _old.remove();
                        if (_autoTp && (!pos.tp1 || !pos.tp2 || !pos.tp3)) {
                            const _ml  = _autoTp.method === 'pivot'
                                ? '피봇 고점 기반' : `ATR ${_autoTp.risk.toFixed(2)} 기반`;
                            const _tfL = _autoTp.tfMin >= 1440 ? '일봉'
                                : _autoTp.tfMin >= 60 ? `${_autoTp.tfMin / 60}시간봉`
                                : `${_autoTp.tfMin}분봉`;
                            _bar.insertAdjacentHTML('beforeend',
                                `<span id="tpAutoPill" class="chart-sig-pill" style="background:rgba(34,197,94,0.1);color:#22C55E;border-color:rgba(34,197,94,0.3);">🤖 익절 자동계산 (${_ml}) · ${_tfL} 기준</span>`);
                        }
                    }
                } catch(e){}
            }
        } catch(e){}
    }

    // ── 차트 페이지 포지션 요약/등록 카드 ────────────────────────
    function renderMyPosition() {
        const el = document.getElementById('myPositionSlot');
        if (!el) return;
        if (!currentSymbol) { el.innerHTML = ''; return; }
        const pos = _posLatestForTicker(currentSymbol);
        const cur = _posCurrentPrice();
        let html;
        if (!pos || pos.status === 'closed') {
            const isClosed = pos && pos.status === 'closed';
            const _allPos = _posLoad();
            const _isWatching = _allPos.some(p => p.ticker === currentSymbol && p.status === 'watching');
            html = `<div class="mypos-card mypos-empty">
                <div class="mypos-empty-left">
                    <span class="mypos-label-chip">내 포지션</span>
                    <div class="mypos-empty-txt">${isClosed ? '매도 완료 · 재진입 검토' : _isWatching ? '관망 중 — 진입 시 등록하세요' : '이 종목 포지션을 등록하세요'}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
                    <button class="mypos-watch-btn${_isWatching ? ' active' : ''}" id="posWatchBtn" onclick="_posAddWatching()">${_isWatching ? '👁 관망 중' : '👁 관망'}</button>
                    <button class="mypos-add-btn" onclick="_posOpenSheet('${currentSymbol}')">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        ${isClosed ? '재등록' : '등록'}
                    </button>
                </div>
            </div>`;
        } else {
            const pnl = _posPnlPct(pos.entryPrice, cur);
            const pnlCls = pnl == null ? '' : pnl >= 0 ? 'pos' : 'neg';
            const pnlTxt = pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : '--';
            const statusTxt = pos.status === 'holding' ? '보유 중' : '진입 대기';
            const statusCls = pos.status === 'holding' ? 'mypos-holding' : 'mypos-watching';
            const qtyTxt = pos.quantity ? `${pos.quantity}주` : '';
            const entryTxt = _posFmtP(pos.entryPrice, currentMarket);
            const _holdDays = pos.createdAt
                ? Math.floor((Date.now() - new Date(pos.createdAt).getTime()) / 86400000)
                : null;
            // 프리마켓 / 애프터마켓 배지 (_sessionState — fetchMarketSession 이 갱신)
            const _mktState   = stockData?.meta?._sessionState || '';
            const _isPreMkt   = _mktState === 'PRE' || _mktState === 'PREPRE';
            const _isPostMkt  = _mktState === 'POST' || _mktState === 'POSTPOST';
            const _mktBadge   = _isPreMkt
                ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(245,158,11,0.15);color:#F59E0B;margin-left:4px;font-weight:600">프리</span>`
                : _isPostMkt
                    ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(139,92,246,0.15);color:#8B5CF6;margin-left:4px;font-weight:600">애프터</span>`
                    : '';
            const curTxt = cur != null
                ? `${_posFmtP(cur, pos.market || currentMarket)}${_mktBadge}`
                : '—';
            // 손절/익절 행 (holding 상태만)
            const slTxt = (pos.status === 'holding' && pos.stopLoss)
                ? (() => { const p = _posPnlPct(pos.entryPrice, pos.stopLoss); return `${_posFmtP(pos.stopLoss,currentMarket)}${p!=null?` (${p.toFixed(1)}%)`:''}` })()
                : null;
            const tp1Txt = pos.tp1
                ? (() => { const p = _posPnlPct(pos.entryPrice, pos.tp1); return `${_posFmtP(pos.tp1,currentMarket)}${p!=null?` (+${p.toFixed(1)}%)`:''}` })()
                : null;
            const tp2Txt = pos.tp2
                ? (() => { const p = _posPnlPct(pos.entryPrice, pos.tp2); return `${_posFmtP(pos.tp2,currentMarket)}${p!=null?` (+${p.toFixed(1)}%)`:''}` })()
                : null;
            const hasSLTP = slTxt || tp1Txt || tp2Txt;
            html = `<div class="mypos-card ${statusCls}">
                <div class="mypos-card-top">
                    <div class="mypos-card-left">
                        <span class="mypos-status-badge">${statusTxt}</span>
                        ${qtyTxt ? `<span class="mypos-qty">${qtyTxt}</span>` : ''}
                        ${_holdDays !== null ? `<span id="posHoldDays" style="font-size:10px;color:var(--text3);font-weight:500;padding:1px 5px;border-radius:4px;background:var(--bg3);">D+${_holdDays}</span>` : ''}
                    </div>
                    <button class="mypos-edit-btn" onclick="_posOpenSheet('${currentSymbol}')">편집</button>
                </div>
                <div class="mypos-card-body">
                    <div class="mypos-entry-block">
                        <div class="mypos-entry-label">진입가</div>
                        <div class="mypos-entry-val">${entryTxt}</div>
                    </div>
                    <div class="mypos-arrow">→</div>
                    <div class="mypos-cur-block">
                        <div class="mypos-entry-label">현재가</div>
                        <div class="mypos-entry-val">${curTxt}</div>
                    </div>
                    <div class="mypos-pnl-block ${pnlCls}">
                        <div class="mypos-pnl-num">${pnlTxt}</div>
                        <div class="mypos-pnl-label">${pos.status === 'holding' ? '수익률' : '괴리율'}</div>
                    </div>
                </div>
                ${hasSLTP ? `<div class="mypos-sltp-row">
                    ${slTxt  ? `<span class="mypos-sl-chip">🔴 손절 ${slTxt}</span>` : ''}
                    ${tp1Txt ? `<span class="mypos-tp-chip">🟢 익절1 ${tp1Txt}</span>` : ''}
                    ${tp2Txt ? `<span class="mypos-tp2-chip">🟩 익절2 ${tp2Txt}</span>` : ''}
                </div>` : ''}
                ${pos.memo ? `<div class="mypos-memo">📝 ${escHtml(pos.memo)}</div>` : ''}
                ${pos.status === 'watching' ? `
                <div class="mypos-unwatch-row">
                    <button class="mypos-unwatch-btn" onclick="_posAddWatching()">관망 해제</button>
                </div>` : ''}
            </div>`;
        }
        el.innerHTML = html;
        _posDrawChartLine();
    }

    // ── 등록/편집 시트 (바텀시트/모달) ───────────────────────────
    function _posOpenSheet(ticker) {
        ticker = ticker || currentSymbol;
        if (!ticker) return;
        let ov = document.getElementById('posSheetOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'posSheetOverlay';
            ov.className = 'pos-sheet-overlay';
            ov.onclick = (e) => { if (e.target === ov) _posCloseSheet(); };
            ov.innerHTML = `<div class="pos-sheet" role="dialog" aria-modal="true">
                <div class="pos-sheet-handle"></div>
                <div class="pos-sheet-body" id="posSheetBody"></div>
            </div>`;
            document.body.appendChild(ov);
        }
        const editable = _posActiveForTicker(ticker);
        _posSheetState = editable ? {
            ticker, id: editable.id, status: editable.status,
            entryPrice: editable.entryPrice ?? '', quantity: editable.quantity ?? '',
            closedPrice: editable.closedPrice ?? '', memo: editable.memo || '', entryDate: editable.entryDate || _posToday(),
            stopLoss: editable.stopLoss ?? '', tp1: editable.tp1 ?? '', tp2: editable.tp2 ?? '', tp3: editable.tp3 ?? '',
            maxBudget: editable.maxBudget ?? '', splitCount: editable.splitCount ?? 3,
            splits: editable.splits ?? [], splitMode: editable.splitMode ?? 'equal',
        } : {
            ticker, id: null, status: 'holding',
            entryPrice: '', quantity: '', closedPrice: '', memo: '', entryDate: _posToday(),
            stopLoss: '', tp1: '', tp2: '', tp3: '',
            maxBudget: '', splitCount: 3, splits: [], splitMode: 'equal',
        };
        _posSplitCount = (_posSheetState.splitCount) || 3;
        _posRenderSheet();
        ov.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function _posCloseSheet() {
        const ov = document.getElementById('posSheetOverlay');
        if (ov) ov.classList.remove('open');
        document.body.style.overflow = '';
    }
    function _posRenderSheet() {
        const body = document.getElementById('posSheetBody');
        if (!body || !_posSheetState) return;
        const s = _posSheetState;
        const isKR = currentMarket === 'KR';
        const cur  = s.currency || (isKR ? '원' : '$');
        const showClosed = s.status === 'closed';

        body.innerHTML = `
            <div class="pos-sheet-hd">${escHtml(s.ticker)} 포지션 ${s.id?'편집':'등록'}</div>
            <div class="pos-modal-body">

              <!-- 상태 탭 -->
              <div class="pos-status-tabs">
                <button class="pos-tab ${s.status==='holding'?'active':''}"
                  onclick="_posSetStatus('holding')">보유 중</button>
                <button class="pos-tab ${s.status==='closed'?'active':''}"
                  onclick="_posSetStatus('closed')">매도 완료</button>
              </div>

              ${showClosed ? `
              <!-- 매도 완료 입력 -->
              <div class="pos-section">
                <div class="pos-section-title">📍 포지션 정보</div>
                <div class="pos-field">
                  <label>진입가 (${cur})</label>
                  <input type="number" id="posEntry1" placeholder="진입 가격" style="width:100%">
                </div>
                <div class="pos-field">
                  <label>매도가 (${cur})</label>
                  <input type="number" id="posInClosed" placeholder="매도 가격" style="width:100%">
                </div>
              </div>` : `

              <!-- ─── 투자 예산 ─── -->
              <div class="pos-section">
                <div class="pos-section-title">💰 투자 예산</div>
                <div class="pos-field">
                  <label>최대 투자금액 (${cur})
                    <span class="pos-hint">이 종목에 투자할 최대 금액</span>
                  </label>
                  <input type="text" id="posMaxBudget" inputmode="numeric"
                    placeholder="예: 400,000"
                    oninput="
                        const raw=this.value.replace(/[^0-9]/g,'');
                        const num=parseInt(raw,10);
                        if(!isNaN(num)){
                            const pos=this.selectionStart;
                            const prevLen=this.value.length;
                            this.value=num.toLocaleString('en-US');
                            const newLen=this.value.length;
                            this.setSelectionRange(pos+(newLen-prevLen),pos+(newLen-prevLen));
                        }else{this.value='';}
                        _posCalcSplitPlan();
                    "
                    style="width:100%">
                </div>
                <div class="pos-field">
                  <label>분할 차수<span class="pos-hint">몇 번에 나눠서 매수할지</span></label>
                  <div class="pos-split-count-row">
                    <button onclick="_posChangeSplitCount(-1)">−</button>
                    <span id="posSplitCount">${_posSplitCount}</span>
                    <button onclick="_posChangeSplitCount(+1)">+</button>
                    <span class="pos-hint">차 분할</span>
                  </div>
                </div>
                <div class="pos-field">
                  <label>분배 방식</label>
                  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:var(--text2);">
                      <input type="radio" name="splitMode" value="equal" checked
                        onchange="_posCalcSplitPlan()"
                        style="width:16px;height:16px;cursor:pointer;">
                      균등 분배
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:var(--text2);">
                      <input type="radio" name="splitMode" value="pyramid"
                        onchange="_posCalcSplitPlan()"
                        style="width:16px;height:16px;cursor:pointer;">
                      피라미딩 (하락할수록 많이)
                    </label>
                  </div>
                </div>
              </div>

              <!-- ─── 1차 진입 ─── -->
              <div class="pos-section">
                <div class="pos-section-title">📍 1차 진입</div>
                <div class="pos-field">
                  <label>1차 진입가 (${cur})</label>
                  <input type="number" id="posEntry1" placeholder="진입 가격"
                    oninput="_posCalcSplitPlan()" style="width:100%">
                  <div class="pos-quick-btns">
                    <button onclick="_posSetEntryToCurrent(1)">현재가</button>
                    <button onclick="_posSetEntryOffset(1,-0.02)">-2%</button>
                    <button onclick="_posSetEntryOffset(1,-0.05)">-5%</button>
                  </div>
                </div>
                <div class="pos-field">
                  <label>1차 매수 수량 (주)<span class="pos-hint" id="posEntry1Amount"></span></label>
                  <input type="number" id="posAmount1" step="0.0001" placeholder="실제 보유 수량 입력"
                    oninput="this.dataset.edited='1';_posCalcSplitPlan()" style="width:100%">
                </div>
              </div>

              <!-- ─── 분할매수 계획 ─── -->
              <div class="pos-section" id="posSplitPlanSection">
                <div class="pos-section-title">📊 분할매수 계획</div>
                <div id="posSplitPlanRows"></div>
              </div>

              <!-- ─── 손절 설정 ─── -->
              <div class="pos-section">
                <div class="pos-section-title">🔴 손절 설정</div>
                <div class="pos-field">
                  <label>손절가 (${cur})</label>
                  <!-- 탭 전환 -->
                  <div style="display:flex;gap:4px;margin-bottom:8px">
                    <button id="posStopTabPriceBtn" onclick="_posStopTab('price')"
                      style="flex:1;padding:6px;font-size:12px;border-radius:6px;cursor:pointer;
                             border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.15);
                             color:#EF4444;font-weight:600;">가격 입력</button>
                    <button id="posStopTabPctBtn" onclick="_posStopTab('pct')"
                      style="flex:1;padding:6px;font-size:12px;border-radius:6px;cursor:pointer;
                             border:1px solid var(--border);background:var(--bg3);
                             color:var(--text3);">% 입력</button>
                  </div>
                  <!-- 가격 입력 모드 (공유 hidden input + 표시 input) -->
                  <input type="number" id="posStop" style="display:none">
                  <div id="posStopPriceDiv">
                    <input type="number" id="posStopPriceDisplay" placeholder="손절 가격"
                      oninput="document.getElementById('posStop').value=this.value;_posOnStopPrice();"
                      style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);
                             background:var(--bg3);color:var(--text1);box-sizing:border-box;">
                    <div style="display:flex;gap:6px;margin-top:6px">
                      <button onclick="_posStopSetPct(-2)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-2%</button>
                      <button onclick="_posStopSetPct(-3)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-3%</button>
                      <button onclick="_posStopSetPct(-5)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-5%</button>
                      <button onclick="_posStopSetPct(-8)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-8%</button>
                      <button onclick="_posStopSetPct(-10)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-10%</button>
                      <button onclick="_posSetStopToEma()"
                        style="flex:1;padding:5px;font-size:10px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">EMA240</button>
                    </div>
                  </div>
                  <!-- % 입력 모드 -->
                  <div id="posStopPctDiv" style="display:none">
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="color:#EF4444;font-size:16px;font-weight:700;">-</span>
                      <input type="number" id="posStopPctVal" placeholder="예: 3"
                        min="0.1" max="50" step="0.1" inputmode="decimal"
                        oninput="_posOnStopPct()"
                        style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);
                               background:var(--bg3);color:var(--text1);">
                      <span style="color:var(--text3);font-size:14px">%</span>
                    </div>
                    <div style="display:flex;gap:6px;margin-top:6px">
                      <button onclick="_posStopQuickPct(1)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-1%</button>
                      <button onclick="_posStopQuickPct(2)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-2%</button>
                      <button onclick="_posStopQuickPct(3)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-3%</button>
                      <button onclick="_posStopQuickPct(5)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-5%</button>
                      <button onclick="_posStopQuickPct(10)"
                        style="flex:1;padding:5px;font-size:11px;border-radius:6px;
                               border:1px solid var(--border);background:var(--bg3);
                               color:var(--text2);cursor:pointer;">-10%</button>
                    </div>
                    <div id="posStopCalcShow"
                      style="margin-top:8px;font-size:12px;color:#EF4444;min-height:18px;font-weight:600;"></div>
                  </div>
                </div>
                <div class="pos-field" id="posRiskSummary"></div>
              </div>

              <!-- ─── 익절 설정 ─── -->
              <div class="pos-section">
                <div class="pos-section-title">✅ 익절 설정</div>
                <div class="pos-field">
                  <label>1차 익절가 (${cur}) — 30% 매도</label>
                  <input type="number" id="posTp1" placeholder="1차 목표가"
                    oninput="_posCalcSplitPlan()" style="width:100%">
                  <div class="pos-quick-btns">
                    <button onclick="_posTpPct(1,0.05)">+5%</button>
                    <button onclick="_posTpPct(1,0.10)">+10%</button>
                  </div>
                </div>
                <div class="pos-field">
                  <label>2차 익절가 (${cur}) — 40% 매도</label>
                  <input type="number" id="posTp2" placeholder="2차 목표가"
                    oninput="_posCalcSplitPlan()" style="width:100%">
                  <div class="pos-quick-btns">
                    <button onclick="_posTpPct(2,0.15)">+15%</button>
                    <button onclick="_posTpPct(2,0.20)">+20%</button>
                  </div>
                </div>
                <div class="pos-field">
                  <label>3차 익절가 (${cur}) — 30% 매도</label>
                  <input type="number" id="posTp3" placeholder="3차 목표가"
                    oninput="_posCalcSplitPlan()" style="width:100%">
                  <div class="pos-quick-btns">
                    <button onclick="_posTpPct(3,0.20)">+20%</button>
                    <button onclick="_posTpPct(3,0.30)">+30%</button>
                  </div>
                </div>
              </div>`}

              <!-- ─── 투자 요약 ─── -->
              <div class="pos-section pos-summary-box" id="posSummaryBox"></div>

              <!-- ─── 메모 ─── -->
              <div class="pos-section" style="border-bottom:none;margin-bottom:0;">
                <div class="pos-field">
                  <label>메모 (선택)</label>
                  <input type="text" id="posMemo" placeholder="진입 근거 등" style="width:100%">
                </div>
              </div>

            </div><!-- /.pos-modal-body -->

            <div class="pos-sheet-actions">
              ${s.id ? `<button class="pos-del-btn" onclick="_posDelete('${s.id}')">삭제</button>` : ''}
              <button class="pos-cancel-btn" onclick="_posCloseSheet()">취소</button>
              <button class="pos-save-btn" onclick="_posSave()">저장</button>
            </div>`;

        // ── 기존 값 복원 ──────────────────────────────────────────
        const _setV = (id, v) => { const el=document.getElementById(id); if (el && v!=null && v!=='') el.value=v; };
        _setV('posEntry1',  s.entryPrice);
        // posMaxBudget: 텍스트 필드이므로 콤마 포맷으로 복원
        if (s.maxBudget != null && s.maxBudget !== '') {
            const el = document.getElementById('posMaxBudget');
            if (el) el.value = Number(s.maxBudget).toLocaleString('en-US');
        }
        _setV('posStop',    s.stopLoss);
        _setV('posStopPriceDisplay', s.stopLoss); // 표시용 input도 동기화
        _setV('posTp1',     s.tp1);
        _setV('posTp2',     s.tp2);
        _setV('posTp3',     s.tp3);
        _setV('posMemo',    s.memo);
        _setV('posInClosed', s.closedPrice);
        if (s.splitMode) {
            const r = document.querySelector(`input[name="splitMode"][value="${s.splitMode}"]`);
            if (r) r.checked = true;
        }
        // posAmount1 = 1차 매수 수량 — 편집 모드면 저장된 1차 수량 복원
        const _amt1Init = document.getElementById('posAmount1');
        if (_amt1Init) {
            const _s0 = s.splits?.[0];
            // 하위 호환: shares 없으면 amount/price 로 수량 역산
            let _sh0 = _s0?.shares;
            if (_sh0 == null && _s0?.amount > 0 && _s0?.price > 0) _sh0 = _s0.amount / _s0.price;
            if (_sh0 > 0) {
                _amt1Init.value = +Number(_sh0).toFixed(4);
                _amt1Init.dataset.edited = '1';
            } else {
                _amt1Init.value = '';
                _amt1Init.dataset.edited = '';
            }
        }
        _posCalcSplitPlan();
    }
    function _posSheetSet(k, v) {
        if (!_posSheetState) return;
        _posSheetState[k] = v;
        if (k === 'status') _posRenderSheet();
    }
    // 상태 탭 토글 (새 모달용)
    function _posSetStatus(val) {
        if (!_posSheetState) return;
        _posSheetState.status = val;
        _posRenderSheet();
    }
    function _posOnEntryPriceInput(val) {
        const p = parseFloat(val);
        if (!p || p <= 0) return;
        const isKR = currentMarket === 'KR';
        const sl  = +(p * 0.95).toFixed(isKR ? 0 : 2);
        const tp1 = +(p * 1.10).toFixed(isKR ? 0 : 2);
        const tp2 = +(p * 1.20).toFixed(isKR ? 0 : 2);
        const tp3 = +(p * 1.30).toFixed(isKR ? 0 : 2);
        const slEl  = document.getElementById('posInStop');
        const tp1El = document.getElementById('posInTp1');
        const tp2El = document.getElementById('posInTp2');
        const tp3El = document.getElementById('posInTp3');
        const st = _posSheetState || {};
        // DOM 값과 상태 값 모두 비어있을 때만 자동 채움 (quick 버튼 값 보호)
        if (slEl  && !slEl.value  && !st.stopLoss) { slEl.value  = sl;  _posSheetSet('stopLoss', sl); }
        if (tp1El && !tp1El.value && !st.tp1)      { tp1El.value = tp1; _posSheetSet('tp1', tp1); }
        if (tp2El && !tp2El.value && !st.tp2)      { tp2El.value = tp2; _posSheetSet('tp2', tp2); }
        if (tp3El && !tp3El.value && !st.tp3)      { tp3El.value = tp3; _posSheetSet('tp3', tp3); }
    }
    function _posAddWatching() {
        const ticker = currentSymbol;
        if (!ticker) return;
        const arr = _posLoad();
        const existing = arr.find(p => p.ticker === ticker && p.status === 'watching');
        if (existing) {
            _posSaveAll(arr.filter(p => p.id !== existing.id));
            try { showToast('관망 해제'); } catch(e){}
        } else {
            const name = stockData?.meta?.longName || stockData?.meta?.shortName || ticker;
            arr.push({
                id: _posUuid(), ticker, name, status: 'watching',
                entryPrice: null, quantity: null, closedPrice: null, closedAt: null,
                memo: '', entryDate: _posToday(), stopLoss: null, tp1: null, tp2: null,
                createdAt: new Date().toISOString(),
            });
            _posSaveAll(arr);
            try { showToast('👁 관망 등록됨'); } catch(e){}
        }
        try { renderMyPosition(); } catch(e){}
        try { if (document.getElementById('positionScreen')?.style.display === '') _posLoadAndRender(); } catch(e){}
    }
    // ── 분할매수 모달 헬퍼 ─────────────────────────────────────────
    let _posSplitCount = 3;

    function _posChangeSplitCount(delta) {
        _posSplitCount = Math.max(1, Math.min(12, _posSplitCount + delta));
        const el = document.getElementById('posSplitCount');
        if (el) el.textContent = _posSplitCount;
        _posCalcSplitPlan();
    }

    function _posCalcSplitPlan() {
        const maxBudget = parseFloat(
            (document.getElementById('posMaxBudget')?.value || '0').replace(/,/g, '')) || 0;
        const entry1    = parseFloat(document.getElementById('posEntry1')?.value)    || 0;
        const stop      = parseFloat(document.getElementById('posStop')?.value)      || 0;
        const mode      = document.querySelector('input[name="splitMode"]:checked')?.value || 'equal';
        const isKR      = currentMarket === 'KR';
        const fmtAmt    = v => isKR ? Math.round(v).toLocaleString() + '원' : '$' + v.toFixed(0);
        const fmtPrc    = v => isKR ? Math.round(v).toLocaleString()       : v.toFixed(2);

        // posAmount1 = 1차 매수 수량(주) 입력
        const amt1El     = document.getElementById('posAmount1');
        const amt1Edited = amt1El?.dataset?.edited === '1';
        const shares1Val = parseFloat(amt1El?.value || '0') || 0;
        const hasManualShares = amt1Edited && shares1Val > 0;

        // entry1 필수 · (maxBudget 또는 1차 수량 직접입력) 중 하나는 있어야 계산
        if (!entry1 || (!maxBudget && !hasManualShares)) {
            const rows = document.getElementById('posSplitPlanRows');
            if (rows) rows.innerHTML = '';
            _posUpdateSummary(0, [], entry1, stop);
            return;
        }

        // 차수별 비율 계산
        let ratios = [];
        if (mode === 'equal') {
            ratios = Array(_posSplitCount).fill(1 / _posSplitCount);
        } else {
            const weights = Array.from({length: _posSplitCount}, (_, i) => 1 + i * 0.5);
            const total   = weights.reduce((a, b) => a + b, 0);
            ratios = weights.map(w => w / total);
        }

        // 차수별 진입가 (1차 기준 -3%씩)
        const dropPct = 0.03;

        // 1차 수량 기준값 — 직접 입력했으면 그 수량, 아니면 maxBudget/entry1/ratio[0] 자동계산
        const shares1Base = hasManualShares
            ? shares1Val
            : (maxBudget && entry1 && ratios[0] > 0
                ? Math.round(maxBudget * ratios[0] / entry1)
                : 0);

        // 전체 차수 합산 총 수량 역산
        const totalShares1 = (hasManualShares && ratios[0] > 0)
            ? shares1Val / ratios[0]
            : (maxBudget && entry1 ? maxBudget / entry1 : 0);

        const planRows = ratios.map((ratio, i) => {
            const nth    = i + 1;
            const price  = nth === 1
                ? entry1
                : +(entry1 * (1 - dropPct * i)).toFixed(isKR ? 0 : 2);
            // 수량: 1차 수량 기준으로 비율 적용 (정수 — 소수점 제거)
            const shares = nth === 1
                ? Math.round(shares1Base)
                : Math.round(totalShares1 * ratio);
            // 투자금 = 수량 × 진입가 (자동 계산)
            const amount = (shares > 0 && price > 0) ? Math.round(shares * price) : 0;
            const riskPct = (stop && price) ? ((price - stop) / price * 100).toFixed(1) : '—';
            return { nth, price, shares, amount, riskPct };
        });

        // ── 총 투자금 검증 — maxBudget 초과 시 수량 자동 스케일 다운 ──
        const totalAmount  = planRows.reduce((sum, r) => sum + (r.amount || 0), 0);
        const isOverBudget = maxBudget > 0 && totalAmount > maxBudget * 1.01;
        let finalRows = planRows;
        if (isOverBudget && totalAmount > 0) {
            const _scaleRow = (r, scale) => {
                const shares = Math.round(r.shares * scale);   // 정수 — 소수점 제거
                const amount = (shares > 0 && r.price > 0) ? Math.round(shares * r.price) : 0;
                return { ...r, shares, amount };
            };
            if (hasManualShares) {
                // 1차 수량은 사용자가 직접 입력한 값 — 절대 변경하지 않음
                // 2차~ 만 남은 예산(maxBudget − 1차 투자금)에 맞춰 축소
                const amount1    = planRows[0]?.amount || 0;
                const restBudget = maxBudget - amount1;
                const restTotal  = totalAmount - amount1;
                if (restBudget > 0 && restTotal > 0) {
                    const scale = restBudget / restTotal;
                    finalRows = planRows.map((r, i) => i === 0 ? r : _scaleRow(r, scale));
                } else {
                    // 1차만으로 예산 소진/초과 → 2차~ 0 (1차는 그대로 유지)
                    finalRows = planRows.map((r, i) => i === 0 ? r : { ...r, shares: 0, amount: 0 });
                }
            } else {
                // 자동 계산 모드 — 전체 비례 축소
                const scale = maxBudget / totalAmount;
                finalRows = planRows.map(r => _scaleRow(r, scale));
            }
        }

        // 총액 요약
        const _cur       = isKR ? '₩' : '$';
        const totalFinal = finalRows.reduce((s, r) => s + (r.amount || 0), 0);
        const budgetDiff = maxBudget > 0 ? totalFinal - maxBudget : 0;

        const rows = document.getElementById('posSplitPlanRows');
        if (rows) {
            rows.innerHTML = `
            <div class="pos-split-header">
                <span>차수</span><span>진입가</span><span>수량(주)</span>
                <span style="text-align:center">투자금</span><span style="text-align:right">리스크</span>
            </div>
            ${finalRows.map(r => `
            <div class="pos-split-row ${r.nth===1?'pos-split-row-1st':''}">
                <div class="pos-split-nth">${r.nth}차</div>
                <div class="pos-split-price">
                    <input type="number" id="posSplitPrice${r.nth}" value="${r.price}"
                        oninput="_posUpdateSplitRowShares(${r.nth})" placeholder="진입가">
                </div>
                <!-- 수량: 직접 입력 가능 -->
                <div class="pos-split-amount">
                    <input type="number" id="posSplitShares${r.nth}" value="${r.shares}"
                        step="1" min="0" placeholder="수량"
                        oninput="_posUpdateSplitRowShares(${r.nth})">
                </div>
                <!-- 투자금: 수량×진입가 자동 계산 (표시 전용) -->
                <div class="pos-split-shares">
                    <span id="posSplitAmount${r.nth}" style="font-size:11px;color:var(--text3)">${r.amount > 0 ? _cur+r.amount.toLocaleString() : '—'}</span>
                </div>
                <div class="pos-split-risk">손절 ${r.riskPct}%</div>
            </div>`).join('')}
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-top:2px solid var(--border);margin-top:4px;font-size:12px;font-weight:700;">
                <span style="color:var(--text2)">총 투자금</span>
                <span style="color:${budgetDiff > 0 ? '#EF4444' : '#22C55E'}">${_cur}${totalFinal.toLocaleString()}${maxBudget > 0 ? ` / ${_cur}${maxBudget.toLocaleString()}` : ''}${budgetDiff > 0 ? ` <span style="font-size:10px">⚠️ ${_cur}${budgetDiff.toLocaleString()} 초과</span>` : budgetDiff < 0 ? ` <span style="font-size:10px;color:var(--text3)">(${_cur}${Math.abs(budgetDiff).toLocaleString()} 여유)</span>` : ''}</span>
            </div>`;
        }

        // 1차 수량 자동 표시 (사용자가 직접 입력/지운 경우 덮어쓰지 않음)
        // amt1El은 위에서 이미 선언됨
        if (amt1El && !amt1El.value && !amt1El.dataset.edited) {
            amt1El.value = (shares1Base > 0) ? +(shares1Base).toFixed(4) : '';
        }

        // 1차 수량 → 투자금 힌트 (예산 대비 % / 초과 경고)
        const hintEl = document.getElementById('posEntry1Amount');
        if (hintEl) {
            if (shares1Base > 0 && entry1 > 0) {
                const investAmt = Math.round(shares1Base * entry1);
                const budgetPct = maxBudget > 0 ? Math.round((investAmt / maxBudget) * 100) : null;
                if (maxBudget > 0 && investAmt > maxBudget) {
                    // 1차만으로도 예산 초과
                    hintEl.innerHTML = ` <span style="color:#EF4444;font-weight:600">≈ ${_cur}${investAmt.toLocaleString()} (예산 초과 ⚠️)</span>`;
                } else if (budgetPct != null) {
                    hintEl.innerHTML = ` <span style="color:var(--text3)">≈ ${_cur}${investAmt.toLocaleString()} (예산의 ${budgetPct}%)</span>`;
                } else {
                    hintEl.textContent = ` ≈ ${_cur}${investAmt.toLocaleString()}`;
                }
            } else {
                hintEl.textContent = '';
            }
        }

        // 투자 요약 — 총 투자금 = 스케일 적용된 차수별 투자금 합산
        _posUpdateSummary(totalFinal, ratios, entry1, stop);
    }

    // 금액 입력 필드 콤마 포맷 (posAmount1 / posSplitAmount*)
    function _fmtAmountInput(el) {
        const raw = el.value.replace(/[^0-9]/g, '');
        const num = parseInt(raw, 10);
        if (!isNaN(num) && num > 0) {
            const pos     = el.selectionStart;
            const prevLen = el.value.length;
            el.value = num.toLocaleString('en-US');
            const diff = el.value.length - prevLen;
            try { el.setSelectionRange(pos + diff, pos + diff); } catch(e) {}
        } else if (raw === '') {
            el.value = '';
        }
        _posCalcSplitPlan();
    }

    // 콤마 포함 금액 input에서 숫자값 반환
    function _getAmountVal(id) {
        const el = document.getElementById(id);
        if (!el) return 0;
        return parseFloat(el.value.replace(/,/g, '')) || 0;
    }

    // 수량/진입가 변경 시 투자금(수량×진입가) 자동 재계산
    function _posUpdateSplitRowShares(nth) {
        const sharesEl = document.getElementById(`posSplitShares${nth}`);
        const priceEl  = document.getElementById(`posSplitPrice${nth}`);
        const amountEl = document.getElementById(`posSplitAmount${nth}`);
        const shares = parseFloat(sharesEl?.value || '0') || 0;
        const price  = parseFloat(priceEl?.value  || '0') || 0;
        if (!amountEl) return;
        if (shares > 0 && price > 0) {
            const isKR = currentMarket === 'KR';
            const amount = Math.round(shares * price);
            amountEl.textContent = (isKR ? '₩' : '$') + amount.toLocaleString('en-US');
        } else {
            amountEl.textContent = '—';
        }
    }

    function _posUpdateSummary(maxBudget, ratios, entry1, stop) {
        const tp1 = parseFloat(document.getElementById('posTp1')?.value) || 0;
        const tp2 = parseFloat(document.getElementById('posTp2')?.value) || 0;
        if (!maxBudget) { const b=document.getElementById('posSummaryBox'); if(b) b.innerHTML=''; return; }

        const riskAmt   = (stop && entry1) ? +(maxBudget * (entry1 - stop) / entry1).toFixed(0) : 0;
        const rewardAmt = (tp2   && entry1) ? +(maxBudget * (tp2 - entry1) / entry1).toFixed(0) : 0;
        const rrRatio   = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : '—';
        const isKR      = currentMarket === 'KR';
        const fmt       = v => isKR ? Math.round(v).toLocaleString()+'원' : '$'+Math.abs(v).toLocaleString();

        const box = document.getElementById('posSummaryBox');
        if (box) box.innerHTML = `
            <div class="pos-summary-title">📋 투자 요약</div>
            <div class="pos-summary-row"><span>총 투자금</span><span>${fmt(maxBudget)}</span></div>
            <div class="pos-summary-row"><span>분할 차수</span><span>${_posSplitCount}차</span></div>
            ${riskAmt   ? `<div class="pos-summary-row" style="color:#EF4444"><span>최대 손실금</span><span>${fmt(riskAmt)}</span></div>` : ''}
            ${rewardAmt ? `<div class="pos-summary-row" style="color:#22C55E"><span>목표 수익금 (2차)</span><span>${fmt(rewardAmt)}</span></div>` : ''}
            <div class="pos-summary-row"><span>R:R 비율</span><span>${rrRatio}:1</span></div>`;
    }

    // 빠른 버튼 함수들
    function _posSetEntryToCurrent(nth) {
        const el  = document.getElementById(`posEntry${nth}`);
        const cur = _posCurrentPrice();
        const isKR = currentMarket === 'KR';
        if (el && cur) { el.value = isKR ? Math.round(cur) : cur.toFixed(2); _posCalcSplitPlan(); }
    }
    function _posSetEntryOffset(nth, pct) {
        const base = parseFloat(document.getElementById(`posEntry${nth}`)?.value) || _posCurrentPrice() || 0;
        const el   = document.getElementById(`posEntry${nth}`);
        const isKR = currentMarket === 'KR';
        if (el && base) { el.value = isKR ? Math.round(base*(1+pct)) : (base*(1+pct)).toFixed(2); _posCalcSplitPlan(); }
    }
    function _posSetStopPct(pct) {
        const entry = parseFloat(document.getElementById('posEntry1')?.value) || _posCurrentPrice() || 0;
        const el    = document.getElementById('posStop');
        const isKR  = currentMarket === 'KR';
        if (el && entry) { el.value = isKR ? Math.round(entry*(1+pct)) : (entry*(1+pct)).toFixed(2); _posCalcSplitPlan(); }
    }
    function _posSetStopToEma() {
        const ema  = window._lastEma240;
        const el   = document.getElementById('posStop');
        const disp = document.getElementById('posStopPriceDisplay');
        const isKR = currentMarket === 'KR';
        if (el && ema) {
            const v = isKR ? Math.round(ema) : +ema.toFixed(2);
            el.value = v;
            if (disp) disp.value = v;
            _posCalcSplitPlan();
        } else { try { showToast('EMA 240 값이 없습니다 — 차트에서 분할매수를 먼저 활성화하세요'); } catch(e){} }
    }

    // ── 손절 탭 전환 ──────────────────────────────────────────────
    function _posStopTab(mode) {
        const priceDiv = document.getElementById('posStopPriceDiv');
        const pctDiv   = document.getElementById('posStopPctDiv');
        const priceBtn = document.getElementById('posStopTabPriceBtn');
        const pctBtn   = document.getElementById('posStopTabPctBtn');
        if (!priceDiv || !pctDiv) return;
        const activeStyle  = { bg:'rgba(239,68,68,0.15)', color:'#EF4444', border:'rgba(239,68,68,0.4)', fw:'600' };
        const inactiveStyle= { bg:'var(--bg3)', color:'var(--text3)', border:'var(--border)', fw:'normal' };
        const applyStyle = (btn, s) => {
            if (!btn) return;
            btn.style.background  = s.bg;
            btn.style.color       = s.color;
            btn.style.borderColor = s.border;
            btn.style.fontWeight  = s.fw;
        };
        if (mode === 'price') {
            priceDiv.style.display = '';
            pctDiv.style.display   = 'none';
            applyStyle(priceBtn, activeStyle);
            applyStyle(pctBtn,   inactiveStyle);
        } else {
            priceDiv.style.display = 'none';
            pctDiv.style.display   = '';
            applyStyle(pctBtn,   activeStyle);
            applyStyle(priceBtn, inactiveStyle);
        }
    }
    // 가격 직접 입력 → % 역산
    function _posOnStopPrice() {
        const entry  = parseFloat(document.getElementById('posEntry1')?.value) || 0;
        const stop   = parseFloat(document.getElementById('posStopPriceDisplay')?.value) || 0;
        const hidden = document.getElementById('posStop');
        if (hidden) hidden.value = stop;
        const pctEl  = document.getElementById('posStopPctVal');
        if (entry > 0 && stop > 0 && pctEl)
            pctEl.value = ((entry - stop) / entry * 100).toFixed(1);
        _posCalcSplitPlan();
    }
    // % 입력 → 손절가 자동 계산
    function _posOnStopPct() {
        const pct    = parseFloat(document.getElementById('posStopPctVal')?.value) || 0;
        const entry  = parseFloat(document.getElementById('posEntry1')?.value) || 0;
        const show   = document.getElementById('posStopCalcShow');
        const hidden = document.getElementById('posStop');
        const disp   = document.getElementById('posStopPriceDisplay');
        const isKR   = currentMarket === 'KR';
        if (entry > 0 && pct > 0) {
            const stopPrice = isKR ? Math.round(entry * (1 - pct / 100)) : +(entry * (1 - pct / 100)).toFixed(2);
            if (hidden) hidden.value = stopPrice;
            if (disp)   disp.value   = stopPrice;
            if (show) show.textContent = `손절가: ${isKR ? stopPrice.toLocaleString()+'원' : '$'+Number(stopPrice).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        } else {
            if (show) show.textContent = entry > 0 ? '비율을 입력해주세요' : '진입가를 먼저 입력해주세요';
        }
        _posCalcSplitPlan();
    }
    // % 빠른 선택
    function _posStopQuickPct(pct) {
        const el = document.getElementById('posStopPctVal');
        if (el) { el.value = pct; _posOnStopPct(); }
    }
    // 가격 탭 % 빠른 버튼 (-2, -3, -5, -8, -10)
    function _posStopSetPct(pct) {
        const entry = parseFloat(document.getElementById('posEntry1')?.value) || _posCurrentPrice() || 0;
        const disp  = document.getElementById('posStopPriceDisplay');
        const isKR  = currentMarket === 'KR';
        if (disp && entry) {
            const v = isKR ? Math.round(entry * (1 + pct/100)) : +(entry * (1 + pct/100)).toFixed(2);
            disp.value = v;
            _posOnStopPrice();
        }
    }

    function _posTpPct(nth, pct) {
        const entry = parseFloat(document.getElementById('posEntry1')?.value) || _posCurrentPrice() || 0;
        const el    = document.getElementById(`posTp${nth}`);
        const isKR  = currentMarket === 'KR';
        if (el && entry) { el.value = isKR ? Math.round(entry*(1+pct)) : (entry*(1+pct)).toFixed(2); _posCalcSplitPlan(); }
    }

    // ── _posSave (분할매수 버전) ───────────────────────────────────
    function _posSave() {
        const s = _posSheetState;
        if (!s) return;
        const status   = s.status || 'holding';
        const isClosed = status === 'closed';
        const entry1   = parseFloat(document.getElementById('posEntry1')?.value)   || 0;
        const closedV  = parseFloat(document.getElementById('posInClosed')?.value) || 0;

        if (!entry1 && !closedV) {
            try { showToast('진입가를 입력하세요'); } catch(e) {}
            return;
        }

        // 분할매수 행 수집 — 수량(주) 기준, 투자금은 수량×진입가 자동 계산
        const splits = [];
        for (let i = 1; i <= _posSplitCount; i++) {
            const price     = parseFloat(document.getElementById(`posSplitPrice${i}`)?.value) || 0;
            const sharesVal = parseFloat(document.getElementById(`posSplitShares${i}`)?.value) || 0;
            if (price && sharesVal) {
                splits.push({
                    nth:    i,
                    price,
                    shares: +sharesVal.toFixed(4),
                    amount: Math.round(sharesVal * price),
                });
            }
        }

        const arr  = _posLoad();
        const name = (currentSymbol === s.ticker)
            ? (stockData?.meta?.longName || stockData?.meta?.shortName || s.ticker)
            : ((_posLatestForTicker(s.ticker)||{}).name || s.ticker);

        let rec = s.id ? arr.find(p => p.id === s.id) : null;
        if (!rec) { rec = { id: _posUuid(), createdAt: new Date().toISOString() }; arr.push(rec); }

        rec.ticker     = s.ticker;
        rec.name       = name;
        rec.entryPrice = entry1 || null;
        rec.quantity   = splits.length ? +(splits.reduce((sum, sp) => sum + sp.shares, 0)).toFixed(4) : null;
        rec.entryDate  = s.entryDate || _posToday();
        rec.status     = status;
        rec.memo       = (document.getElementById('posMemo')?.value || '').trim();
        rec.stopLoss   = parseFloat(document.getElementById('posStop')?.value)  || null;
        rec.tp1        = parseFloat(document.getElementById('posTp1')?.value)   || null;
        rec.tp2        = parseFloat(document.getElementById('posTp2')?.value)   || null;
        rec.tp3        = parseFloat(document.getElementById('posTp3')?.value)   || null;
        rec.maxBudget  = parseFloat((document.getElementById('posMaxBudget')?.value || '').replace(/,/g,'')) || null;
        rec.splitCount = _posSplitCount;
        rec.splits     = splits;
        rec.splitMode  = document.querySelector('input[name="splitMode"]:checked')?.value || 'equal';

        if (isClosed) {
            rec.closedPrice = closedV || null;
            rec.closedAt    = rec.closedAt || new Date().toISOString();
        } else {
            rec.closedPrice = null;
            rec.closedAt    = null;
        }

        _posSaveAll(arr);
        _posCloseSheet();
        try { _posDrawChartLine(); } catch(e) {}
        try { showToast(`✅ ${s.ticker} 포지션 저장 완료`); } catch(e) {}
        try { renderMyPosition(); } catch(e) {}
        if (document.getElementById('positionScreen')?.style.display === '') _posLoadAndRender();
    }
    function _posDelete(id) {
        _posSaveAll(_posLoad().filter(p => p.id !== id));
        _posCloseSheet();
        try { showToast('포지션 삭제됨'); } catch(e){}
        try { renderMyPosition(); } catch(e){}
        if (document.getElementById('positionScreen')?.style.display === '') _posLoadAndRender();
    }
    function _posQuickClose(id) {
        const rec = _posLoad().find(p=>p.id===id);
        if (!rec) return;
        _posOpenSheet(rec.ticker);
        _posSheetSet('status','closed');
    }

    // ── 내 포지션 탭 ─────────────────────────────────────────────
    function goMyPosition() {
        window._lastScreen = 'position';
        ['welcomeScreen','smartMoneyScreen','alphaScannerScreen','favScreen','visionScannerScreen','leverageScreen','top100Screen','catalystScreen','earningsScreen'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
        const mc=document.getElementById('mainContent'); if(mc) mc.style.display='none';
        const eco=document.getElementById('economicSection'); if(eco) eco.style.display='none';
        const thermo=document.getElementById('marketThermometer'); if(thermo) thermo.style.display='none';
        const qnav=document.getElementById('headerQNav'); if(qnav) qnav.style.display='none';
        document.getElementById('positionScreen').style.display='';
        document.getElementById('mainHeader')?.classList.remove('stock-loaded');
        const fab=document.getElementById('calcFab'); if(fab) fab.style.display='none';
        document.getElementById('stockHero')?.classList.remove('show');
        document.getElementById('tabNav')?.classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
        document.querySelectorAll('.side-nav-item').forEach(b=>b.classList.remove('active'));
        document.getElementById('sideNavPosBtn')?.classList.add('active');
        try { updateBnActive('all'); } catch(e){}
        try { _pushRoute('position'); } catch(e){}
        window.scrollTo({top:0,behavior:'smooth'});
        _posLoadAndRender();
    }
    async function _posLoadAndRender() {
        _posRenderDashboard();
        _posRenderList();
        const tickers = [...new Set(_posLoad().map(p=>p.ticker))];
        if (!tickers.length) return;
        try {
            const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(','))}`;
            const data = await fetchWithProxy(url);
            (data?.quoteResponse?.result || []).forEach(q => {
                if (q.symbol && q.regularMarketPrice != null) _posPriceMap[q.symbol] = q.regularMarketPrice;
            });
            _posRenderDashboard();
            _posRenderList();
        } catch(e){}
    }
    function _posRenderDashboard() {
        const el = document.getElementById('posDashboard');
        if (!el) return;
        const holding = _posLoad().filter(p=>p.status==='holding');
        let total=0, cnt=0, best=null, worst=null;
        holding.forEach(p=>{
            const pnl=_posPnlPct(p.entryPrice,_posPriceMap[p.ticker]);
            if(pnl!=null){ total+=pnl; cnt++;
                if(!best||pnl>best.pnl) best={t:p.ticker,pnl};
                if(!worst||pnl<worst.pnl) worst={t:p.ticker,pnl}; }
        });
        const avg = cnt? total/cnt : null;
        const fmtP = o => o ? `${o.t} ${o.pnl>=0?'+':''}${o.pnl.toFixed(1)}%` : '-';
        el.innerHTML = `<div class="pos-dash">
            <div class="pos-dash-item"><div class="pd-lbl">보유 종목</div><div class="pd-val">${holding.length}</div></div>
            <div class="pos-dash-item"><div class="pd-lbl">평균 손익</div><div class="pd-val ${avg==null?'':avg>=0?'pos':'neg'}">${avg==null?'-':(avg>=0?'+':'')+avg.toFixed(2)+'%'}</div></div>
            <div class="pos-dash-item"><div class="pd-lbl">최고 수익</div><div class="pd-val pos">${fmtP(best)}</div></div>
            <div class="pos-dash-item"><div class="pd-lbl">최대 손실</div><div class="pd-val neg">${fmtP(worst)}</div></div>
        </div>`;
    }
    function _posRenderList() {
        const el = document.getElementById('posList');
        if (!el) return;
        const filter = window._posStatusFilter || 'holding';
        const list = _posLoad().filter(p => p.status === filter);
        if (!list.length) {
            el.innerHTML = `<div class="pos-empty">${filter==='holding'?'보유 중인':filter==='watching'?'관망 중인':'매도 완료된'} 포지션이 없습니다.</div>`;
            return;
        }
        el.innerHTML = '<div class="pos-card-list">' + list.map(_posCardHtml).join('') + '</div>';
    }
    function _posCardHtml(p) {
        const cur = _posPriceMap[p.ticker];
        const fmt = v => (v==null||isNaN(v)) ? '-' : '$'+Number(v).toFixed(2);
        const pnl = (p.status==='closed') ? _posPnlPct(p.entryPrice,p.closedPrice) : _posPnlPct(p.entryPrice,cur);
        const pnlCls = pnl==null?'':pnl>=0?'pos':'neg';
        const pnlTxt = pnl==null?'—':`${pnl>=0?'+':''}${pnl.toFixed(2)}%`;
        const stTxt = p.status==='holding'?'보유 중':p.status==='watching'?'관망 중':'매도 완료';
        const curTxt = (p.status==='closed') ? `매도 ${fmt(p.closedPrice)}` : `현재 ${fmt(cur)}`;
        return `<div class="pos-card pos-card-${p.status}" onclick="quickSearch('${p.ticker}','US')">
            <div class="pos-card-top">
                <div class="pos-card-id"><span class="pos-card-tk">${escHtml(p.ticker)}</span>
                    <span class="pos-card-nm">${escHtml(p.name||p.ticker)}</span></div>
                <span class="pos-card-pnl ${pnlCls}">${pnlTxt}</span>
            </div>
            <div class="pos-card-mid">
                <span>진입 ${fmt(p.entryPrice)}</span><span>${curTxt}</span>
                ${p.quantity?`<span>${p.quantity}주</span>`:''}
                <span class="pos-badge pos-badge-${p.status}">${stTxt}</span>
            </div>
            ${p.memo?`<div class="pos-card-memo">📝 ${escHtml(p.memo)}</div>`:''}
            <div class="pos-card-actions" onclick="event.stopPropagation()">
                <button onclick="_posOpenSheet('${p.ticker}')">편집</button>
                ${p.status==='holding'?`<button onclick="_posQuickClose('${p.id}')">완료(매도)</button>`:''}
                <button class="pos-card-del" onclick="_posDelete('${p.id}')">삭제</button>
            </div>
        </div>`;
    }
    function _posSetFilter(v, btn) {
        window._posStatusFilter = v;
        document.querySelectorAll('[data-filter-group="posStatus"] .earn-chip').forEach(c=>c.classList.toggle('active', c===btn));
        _posRenderList();
    }
    function _posExport() {
        try {
            const blob = new Blob([JSON.stringify(_posLoad(),null,2)], {type:'application/json'});
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `stockai_positions_${_posToday()}.json`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
        } catch(e){ try{showToast('내보내기 실패');}catch(_){} }
    }
    function _posImportPick() { document.getElementById('posImportFile')?.click(); }
    function _posImportFile(e) {
        const file = e.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const arr = JSON.parse(reader.result);
                if (!Array.isArray(arr)) throw 0;
                const map = {};
                _posLoad().forEach(p=>{ if(p&&p.id) map[p.id]=p; });
                arr.forEach(p=>{ if(p&&p.id&&p.ticker) map[p.id]=p; });
                _posSaveAll(Object.values(map));
                try{showToast('📥 포지션 가져오기 완료');}catch(_){}
                _posLoadAndRender();
            } catch(err) { try{showToast('가져오기 실패 — 올바른 파일이 아닙니다');}catch(_){} }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    function goEarnings() {
        _pushRoute('earnings');
        window._lastScreen = 'earnings';
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('smartMoneyScreen').style.display = 'none';
        document.getElementById('alphaScannerScreen').style.display = 'none';
        document.getElementById('favScreen').style.display = 'none';
        document.getElementById('visionScannerScreen').style.display = 'none';
        const _levE = document.getElementById('leverageScreen'); if (_levE) _levE.style.display = 'none';
        const _t100E = document.getElementById('top100Screen'); if (_t100E) _t100E.style.display = 'none';
        const _catE  = document.getElementById('catalystScreen'); if (_catE) _catE.style.display = 'none';
        const _dtsE = document.getElementById('dailyTradingScreen'); if (_dtsE) _dtsE.style.display = 'none';
        const ecoEl = document.getElementById('economicSection');
        if (ecoEl) ecoEl.style.display = 'none';
        const _posE = document.getElementById('positionScreen'); if (_posE) _posE.style.display = 'none';
        // 실적발표 페이지: 시장 테마/탭 네비 숨김
        const thermoEl = document.getElementById('marketThermometer');
        if (thermoEl) thermoEl.style.display = 'none';
        const qnavEl = document.getElementById('headerQNav');
        if (qnavEl) qnavEl.style.display = 'none';
        document.getElementById('earningsScreen').style.display = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded'); const _fab=document.getElementById('calcFab'); if(_fab)_fab.style.display='none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('sideNavErnBtn')?.classList.add('active');
        document.querySelectorAll('.hqnav-item').forEach(b => b.classList.remove('active'));
        // 하단 네비게이션 — 전체 메뉴 진입이므로 "전체" 활성화 (v668 버그픽스)
        updateBnActive('all');
        // 주간 캘린더 — 이번 주부터 (v712)
        window._earnWindow = 'month';
        window._earnDayFilter = null;
        window._earnWeekOffset = 0;
        window._earnExpandedDays = {};
        window.scrollTo({ top: 0, behavior: 'smooth' });
        loadEarnings();
    }

    // ========================================
    // 레버리지 ETF 화면 — 2x · 3x 정/역방향 ETF 모아보기
    // ========================================
    const LEVERAGE_ETF_LIST = [
        // ── 지수 (index) ───────────────────────────────────────
        // 나스닥 100
        { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ',          leverage: 3, direction: 'bull', kind: 'index',  underlying: 'Nasdaq-100' },
        { symbol: 'QLD',  name: 'ProShares Ultra QQQ',             leverage: 2, direction: 'bull', kind: 'index',  underlying: 'Nasdaq-100' },
        { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ',    leverage: 3, direction: 'bear', kind: 'index',  underlying: 'Nasdaq-100' },
        { symbol: 'QID',  name: 'ProShares UltraShort QQQ',        leverage: 2, direction: 'bear', kind: 'index',  underlying: 'Nasdaq-100' },
        // S&P 500
        { symbol: 'SPXL', name: 'Direxion Daily S&P 500 Bull 3x',  leverage: 3, direction: 'bull', kind: 'index',  underlying: 'S&P 500' },
        { symbol: 'UPRO', name: 'ProShares UltraPro S&P 500',      leverage: 3, direction: 'bull', kind: 'index',  underlying: 'S&P 500' },
        { symbol: 'SSO',  name: 'ProShares Ultra S&P 500',         leverage: 2, direction: 'bull', kind: 'index',  underlying: 'S&P 500' },
        { symbol: 'SPXS', name: 'Direxion Daily S&P 500 Bear 3x',  leverage: 3, direction: 'bear', kind: 'index',  underlying: 'S&P 500' },
        { symbol: 'SDS',  name: 'ProShares UltraShort S&P 500',    leverage: 2, direction: 'bear', kind: 'index',  underlying: 'S&P 500' },
        // 러셀 2000
        { symbol: 'TNA',  name: 'Direxion Daily Small Cap Bull 3x',leverage: 3, direction: 'bull', kind: 'index',  underlying: 'Russell 2000' },
        { symbol: 'TZA',  name: 'Direxion Daily Small Cap Bear 3x',leverage: 3, direction: 'bear', kind: 'index',  underlying: 'Russell 2000' },
        // 다우 30
        { symbol: 'DDM',  name: 'ProShares Ultra Dow30',           leverage: 2, direction: 'bull', kind: 'index',  underlying: 'Dow Jones 30' },
        { symbol: 'DXD',  name: 'ProShares UltraShort Dow30',      leverage: 2, direction: 'bear', kind: 'index',  underlying: 'Dow Jones 30' },
        // ── 섹터 (sector) ──────────────────────────────────────
        // 반도체
        { symbol: 'SOXL', name: 'Direxion Semiconductor Bull 3x',  leverage: 3, direction: 'bull', kind: 'sector', underlying: '반도체' },
        { symbol: 'USD',  name: 'ProShares Ultra Semiconductors',  leverage: 2, direction: 'bull', kind: 'sector', underlying: '반도체' },
        { symbol: 'SOXS', name: 'Direxion Semiconductor Bear 3x',  leverage: 3, direction: 'bear', kind: 'sector', underlying: '반도체' },
        // 기술주
        { symbol: 'TECL', name: 'Direxion Technology Bull 3x',     leverage: 3, direction: 'bull', kind: 'sector', underlying: '기술주' },
        { symbol: 'ROM',  name: 'ProShares Ultra Technology',      leverage: 2, direction: 'bull', kind: 'sector', underlying: '기술주' },
        { symbol: 'TECS', name: 'Direxion Technology Bear 3x',     leverage: 3, direction: 'bear', kind: 'sector', underlying: '기술주' },
        // 금융
        { symbol: 'FAS',  name: 'Direxion Financial Bull 3x',      leverage: 3, direction: 'bull', kind: 'sector', underlying: '금융' },
        { symbol: 'DPST', name: 'Direxion Regional Banks Bull 3x', leverage: 3, direction: 'bull', kind: 'sector', underlying: '지역은행' },
        { symbol: 'FAZ',  name: 'Direxion Financial Bear 3x',      leverage: 3, direction: 'bear', kind: 'sector', underlying: '금융' },
        // 바이오
        { symbol: 'LABU', name: 'Direxion Biotech Bull 3x',        leverage: 3, direction: 'bull', kind: 'sector', underlying: '바이오' },
        { symbol: 'LABD', name: 'Direxion Biotech Bear 3x',        leverage: 3, direction: 'bear', kind: 'sector', underlying: '바이오' },
        // 헬스케어
        { symbol: 'CURE', name: 'Direxion Healthcare Bull 3x',     leverage: 3, direction: 'bull', kind: 'sector', underlying: '헬스케어' },
        // 에너지
        { symbol: 'GUSH', name: 'Direxion Oil & Gas E&P Bull 2x',  leverage: 2, direction: 'bull', kind: 'sector', underlying: '에너지' },
        { symbol: 'DRIP', name: 'Direxion Oil & Gas E&P Bear 2x',  leverage: 2, direction: 'bear', kind: 'sector', underlying: '에너지' },
        { symbol: 'ERX',  name: 'Direxion Energy Bull 2x',         leverage: 2, direction: 'bull', kind: 'sector', underlying: '에너지' },
        // 부동산
        { symbol: 'DRN',  name: 'Direxion Real Estate Bull 3x',    leverage: 3, direction: 'bull', kind: 'sector', underlying: '부동산' },
        { symbol: 'DRV',  name: 'Direxion Real Estate Bear 3x',    leverage: 3, direction: 'bear', kind: 'sector', underlying: '부동산' },
        // 인터넷
        { symbol: 'WEBL', name: 'Direxion Internet Bull 3x',       leverage: 3, direction: 'bull', kind: 'sector', underlying: '인터넷' },
        { symbol: 'WEBS', name: 'Direxion Internet Bear 3x',       leverage: 3, direction: 'bear', kind: 'sector', underlying: '인터넷' },
        // 귀금속
        { symbol: 'NUGT', name: 'Direxion Gold Miners Bull 2x',    leverage: 2, direction: 'bull', kind: 'sector', underlying: '금광' },
        { symbol: 'DUST', name: 'Direxion Gold Miners Bear 2x',    leverage: 2, direction: 'bear', kind: 'sector', underlying: '금광' },
        // 채권
        { symbol: 'TMF',  name: 'Direxion 20+ Year Treasury Bull 3x',leverage:3,direction:'bull', kind: 'sector', underlying: '20년+ 국채' },
        { symbol: 'TMV',  name: 'Direxion 20+ Year Treasury Bear 3x',leverage:3,direction:'bear', kind: 'sector', underlying: '20년+ 국채' },
        // ── 개별 종목 2배 (single 2X) ──────────────────────────
        // Apple
        { symbol: 'AAPU', name: 'Direxion AAPL Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Apple' },
        { symbol: 'AAPB', name: 'GraniteShares AAPL Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Apple' },
        { symbol: 'AAPX', name: 'T-Rex 2x Long AAPL',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Apple' },
        { symbol: 'AAPD', name: 'Direxion AAPL Bear 2x',           leverage: 2, direction: 'bear', kind: 'single', underlying: 'Apple' },
        // Nvidia
        { symbol: 'NVDL', name: 'GraniteShares NVDA Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Nvidia' },
        { symbol: 'NVDU', name: 'Direxion NVDA Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Nvidia' },
        { symbol: 'NVDX', name: 'T-Rex 2x Long NVDA',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Nvidia' },
        { symbol: 'NVDQ', name: 'T-Rex 2x Inverse NVDA',           leverage: 2, direction: 'bear', kind: 'single', underlying: 'Nvidia' },
        { symbol: 'NVDS', name: 'GraniteShares NVDA Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Nvidia' },
        // Microsoft
        { symbol: 'MSFU', name: 'Direxion MSFT Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Microsoft' },
        { symbol: 'MSFL', name: 'GraniteShares MSFT Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Microsoft' },
        { symbol: 'MSFX', name: 'T-Rex 2x Long MSFT',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Microsoft' },
        { symbol: 'MSFD', name: 'GraniteShares MSFT Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Microsoft' },
        // Amazon
        { symbol: 'AMZU', name: 'Direxion AMZN Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Amazon' },
        { symbol: 'AMZZ', name: 'GraniteShares AMZN Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Amazon' },
        { symbol: 'AMZD', name: 'GraniteShares AMZN Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Amazon' },
        // Meta
        { symbol: 'METU', name: 'Direxion META Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Meta' },
        { symbol: 'FBL',  name: 'GraniteShares META Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Meta' },
        { symbol: 'METD', name: 'GraniteShares META Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Meta' },
        // Google
        { symbol: 'GGLL', name: 'Direxion GOOGL Bull 2x',          leverage: 2, direction: 'bull', kind: 'single', underlying: 'Google' },
        { symbol: 'GOOX', name: 'T-Rex 2x Long GOOGL',             leverage: 2, direction: 'bull', kind: 'single', underlying: 'Google' },
        { symbol: 'GGLS', name: 'Direxion GOOGL Bear 2x',          leverage: 2, direction: 'bear', kind: 'single', underlying: 'Google' },
        { symbol: 'GOGZ', name: 'T-Rex 2x Inverse GOOGL',          leverage: 2, direction: 'bear', kind: 'single', underlying: 'Google' },
        // Tesla
        { symbol: 'TSLL', name: 'Direxion TSLA Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Tesla' },
        { symbol: 'TSLT', name: 'T-Rex 2x Long TSLA',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Tesla' },
        { symbol: 'TSLQ', name: 'Tradr 2x Short TSLA',             leverage: 2, direction: 'bear', kind: 'single', underlying: 'Tesla' },
        { symbol: 'TSLZ', name: 'T-Rex 2x Inverse TSLA',           leverage: 2, direction: 'bear', kind: 'single', underlying: 'Tesla' },
        { symbol: 'TSDD', name: 'GraniteShares TSLA Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Tesla' },
        // MicroStrategy
        { symbol: 'MSTU', name: 'T-Rex 2x Long MSTR',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'MicroStrategy' },
        { symbol: 'MSTX', name: 'Defiance MSTR Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'MicroStrategy' },
        { symbol: 'MSTZ', name: 'T-Rex 2x Inverse MSTR',           leverage: 2, direction: 'bear', kind: 'single', underlying: 'MicroStrategy' },
        // Coinbase
        { symbol: 'CONL', name: 'GraniteShares COIN Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Coinbase' },
        { symbol: 'CONI', name: 'GraniteShares COIN Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Coinbase' },
        // SMCI (Super Micro)
        { symbol: 'SMCL', name: 'GraniteShares SMCI Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Super Micro' },
        { symbol: 'SMCX', name: 'Defiance SMCI Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Super Micro' },
        { symbol: 'SMCZ', name: 'Defiance SMCI Short 2x',          leverage: 2, direction: 'bear', kind: 'single', underlying: 'Super Micro' },
        // AMD
        { symbol: 'AMDL', name: 'GraniteShares AMD Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'AMD' },
        { symbol: 'AMDS', name: 'GraniteShares AMD Short 2x',      leverage: 2, direction: 'bear', kind: 'single', underlying: 'AMD' },
        // Palantir
        { symbol: 'PLTU', name: 'Direxion PLTR Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Palantir' },
        { symbol: 'PLTD', name: 'Direxion PLTR Bear 2x',           leverage: 2, direction: 'bear', kind: 'single', underlying: 'Palantir' },
        // Netflix
        { symbol: 'NFLU', name: 'T-Rex 2x Long NFLX',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Netflix' },
        { symbol: 'NFXL', name: 'Direxion NFLX Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Netflix' },
        { symbol: 'NFXS', name: 'GraniteShares NFLX Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Netflix' },
        // TSMC
        { symbol: 'TSMU', name: 'GraniteShares TSM Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'TSMC' },
        { symbol: 'TSMD', name: 'GraniteShares TSM Short 2x',      leverage: 2, direction: 'bear', kind: 'single', underlying: 'TSMC' },
        // Broadcom
        { symbol: 'AVL',  name: 'Direxion AVGO Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Broadcom' },
        { symbol: 'AVGU', name: 'GraniteShares AVGO Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Broadcom' },
        { symbol: 'AVGS', name: 'GraniteShares AVGO Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Broadcom' },
        // Alibaba
        { symbol: 'BABX', name: 'GraniteShares BABA Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Alibaba' },
        { symbol: 'BABU', name: 'Direxion BABA Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Alibaba' },
        { symbol: 'BABS', name: 'GraniteShares BABA Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Alibaba' },
        // Eli Lilly
        { symbol: 'LLYL', name: 'GraniteShares LLY Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Eli Lilly' },
        { symbol: 'LLYZ', name: 'Defiance LLY Short 2x',           leverage: 2, direction: 'bear', kind: 'single', underlying: 'Eli Lilly' },
        // PayPal
        { symbol: 'PYPU', name: 'Direxion PYPL Bull 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'PayPal' },
        // UnitedHealth
        { symbol: 'UNHU', name: 'Direxion UNH Bull 2x',            leverage: 2, direction: 'bull', kind: 'single', underlying: 'UnitedHealth' },
        // Nike
        { symbol: 'NKEL', name: 'AXS NKE Bull 2x',                 leverage: 2, direction: 'bull', kind: 'single', underlying: 'Nike' },
        // Magnificent 7 바스켓
        { symbol: 'QQQU', name: 'Direxion Magnificent 7 Bull 2x',  leverage: 2, direction: 'bull', kind: 'single', underlying: 'Magnificent 7' },
        // ── Arm Holdings ──────────────────────────────────────
        { symbol: 'ARML', name: 'GraniteShares ARM Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Arm Holdings' },
        { symbol: 'ARMS', name: 'GraniteShares ARM Short 2x',      leverage: 2, direction: 'bear', kind: 'single', underlying: 'Arm Holdings' },
        // ── Shopify ───────────────────────────────────────────
        { symbol: 'SHPX', name: 'T-Rex 2x Long SHOP',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Shopify' },
        { symbol: 'SHPU', name: 'Defiance SHOP Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Shopify' },
        // ── CrowdStrike ───────────────────────────────────────
        { symbol: 'CWDL', name: 'GraniteShares CRWD Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'CrowdStrike' },
        { symbol: 'CWDS', name: 'GraniteShares CRWD Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'CrowdStrike' },
        // ── Palo Alto Networks ────────────────────────────────
        { symbol: 'PANL', name: 'GraniteShares PANW Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Palo Alto' },
        // ── JPMorgan ──────────────────────────────────────────
        { symbol: 'JPML', name: 'GraniteShares JPM Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'JPMorgan' },
        { symbol: 'JPMS', name: 'GraniteShares JPM Short 2x',      leverage: 2, direction: 'bear', kind: 'single', underlying: 'JPMorgan' },
        // ── Boeing ────────────────────────────────────────────
        { symbol: 'BOEL', name: 'GraniteShares BA Long 2x',        leverage: 2, direction: 'bull', kind: 'single', underlying: 'Boeing' },
        { symbol: 'BOES', name: 'GraniteShares BA Short 2x',       leverage: 2, direction: 'bear', kind: 'single', underlying: 'Boeing' },
        // ── Trump Media (DJT) ─────────────────────────────────
        { symbol: 'DJTL', name: 'GraniteShares DJT Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Trump Media' },
        { symbol: 'DJTS', name: 'GraniteShares DJT Short 2x',      leverage: 2, direction: 'bear', kind: 'single', underlying: 'Trump Media' },
        // ── Rivian ────────────────────────────────────────────
        { symbol: 'RIVL', name: 'GraniteShares RIVN Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Rivian' },
        // ── Marathon Digital ──────────────────────────────────
        { symbol: 'MRAL', name: 'GraniteShares MARA Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Marathon Digital' },
        { symbol: 'MRAS', name: 'GraniteShares MARA Short 2x',     leverage: 2, direction: 'bear', kind: 'single', underlying: 'Marathon Digital' },
        // ── 양자컴퓨팅 (Quantum Computing) ─────────────────────
        { symbol: 'IONX', name: 'Defiance IONQ Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'IonQ' },
        { symbol: 'IONZ', name: 'Defiance IONQ Short 2x',          leverage: 2, direction: 'bear', kind: 'single', underlying: 'IonQ' },
        { symbol: 'QBTX', name: 'Tradr QBTS Long 2x',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'D-Wave' },
        { symbol: 'RGTX', name: 'Defiance RGTI Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Rigetti' },
        // ── 핵발전 / 차세대 에너지 ────────────────────────────
        { symbol: 'OKLL', name: 'Defiance OKLO Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Oklo' },
        { symbol: 'NUEL', name: 'GraniteShares NUE Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Nucor (원자력)' },
        // ── Vistra Energy (VST) ───────────────────────────────
        { symbol: 'VSTL', name: 'GraniteShares VST Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Vistra Energy' },
        { symbol: 'VSTS', name: 'GraniteShares VST Short 2x',      leverage: 2, direction: 'bear', kind: 'single', underlying: 'Vistra Energy' },
        // ── 핀테크 ─────────────────────────────────────────
        { symbol: 'HOOX', name: 'Defiance HOOD Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Robinhood' },
        { symbol: 'SOFX', name: 'Defiance SOFI Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'SoFi' },
        { symbol: 'UPSX', name: 'Tradr UPST Long 2x',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Upstart' },
        // ── 게이밍 / 밈주 ─────────────────────────────────────
        { symbol: 'DKNX', name: 'Defiance DKNG Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'DraftKings' },
        { symbol: 'GMEU', name: 'T-Rex GME Long 2x',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'GameStop' },
        // ── 광고테크 / AI SW ──────────────────────────────────
        { symbol: 'APPX', name: 'Tradr APP Long 2x',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'AppLovin' },
        { symbol: 'PLAL', name: 'GraniteShares PLTR Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Palantir' },
        // ── 방산 ─────────────────────────────────────────────
        { symbol: 'LMTL', name: 'Direxion LMT Bull 2x',            leverage: 2, direction: 'bull', kind: 'single', underlying: 'Lockheed Martin' },
        { symbol: 'RTXL', name: 'GraniteShares RTX Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'RTX (Raytheon)' },
        // ── 차량공유 / 이동 ───────────────────────────────────
        { symbol: 'UBRL', name: 'GraniteShares UBER Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Uber' },
        { symbol: 'LYFL', name: 'GraniteShares LYFT Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Lyft' },
        // ── 비트코인 채굴주 ───────────────────────────────────
        { symbol: 'RIOX', name: 'Defiance RIOT Long 2x',           leverage: 2, direction: 'bull', kind: 'single', underlying: 'Riot Platforms' },
        { symbol: 'CLSX', name: 'Tradr CLSK Long 2x',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'CleanSpark' },
        // ── 중국 빅테크 ───────────────────────────────────────
        { symbol: 'BDUL', name: 'GraniteShares BIDU Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Baidu' },
        { symbol: 'PDDL', name: 'GraniteShares PDD Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'PDD (Temu)' },
        // ── 전기차 / 자율주행 ─────────────────────────────────
        { symbol: 'NIOL', name: 'GraniteShares NIO Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'NIO' },
        { symbol: 'LIDR', name: 'GraniteShares LAZR Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Luminar' },
        // ── 암호화폐 (선물 추종) ─────────────────────────────
        { symbol: 'BITX', name: 'Volatility Shares 2x Bitcoin',    leverage: 2, direction: 'bull', kind: 'sector', underlying: 'Bitcoin' },
        { symbol: 'ETHU', name: 'ProShares 2x Ether',              leverage: 2, direction: 'bull', kind: 'sector', underlying: 'Ethereum' },
        // ── 국가별 ETF (Korean retail interest) ──────────────
        { symbol: 'KORU', name: 'Direxion South Korea Bull 2x',    leverage: 2, direction: 'bull', kind: 'index',  underlying: '한국 (KOSPI)' },
        { symbol: 'YINN', name: 'Direxion FTSE China Bull 3x',     leverage: 3, direction: 'bull', kind: 'index',  underlying: '중국' },
        { symbol: 'YANG', name: 'Direxion FTSE China Bear 3x',     leverage: 3, direction: 'bear', kind: 'index',  underlying: '중국' },
        { symbol: 'INDL', name: 'Direxion MSCI India Bull 2x',     leverage: 2, direction: 'bull', kind: 'index',  underlying: '인도' },
        { symbol: 'BRZU', name: 'Direxion Brazil Bull 2x',         leverage: 2, direction: 'bull', kind: 'index',  underlying: '브라질' },
        { symbol: 'EURL', name: 'Direxion FTSE Europe Bull 3x',    leverage: 3, direction: 'bull', kind: 'index',  underlying: '유럽' },
        { symbol: 'EZJ',  name: 'ProShares Ultra MSCI Japan',      leverage: 2, direction: 'bull', kind: 'index',  underlying: '일본' },
        { symbol: 'EDC',  name: 'Direxion Emerging Mkts Bull 3x',  leverage: 3, direction: 'bull', kind: 'index',  underlying: '신흥국' },
        { symbol: 'EDZ',  name: 'Direxion Emerging Mkts Bear 3x',  leverage: 3, direction: 'bear', kind: 'index',  underlying: '신흥국' },
        // ── 추가 지수 변형 ────────────────────────────────────
        { symbol: 'UDOW', name: 'ProShares UltraPro Dow30',        leverage: 3, direction: 'bull', kind: 'index',  underlying: 'Dow Jones 30' },
        { symbol: 'SDOW', name: 'ProShares UltraPro Short Dow30',  leverage: 3, direction: 'bear', kind: 'index',  underlying: 'Dow Jones 30' },
        { symbol: 'MIDU', name: 'Direxion Mid Cap Bull 3x',        leverage: 3, direction: 'bull', kind: 'index',  underlying: '중형주 (S&P 400)' },
        { symbol: 'MIDZ', name: 'Direxion Mid Cap Bear 3x',        leverage: 3, direction: 'bear', kind: 'index',  underlying: '중형주 (S&P 400)' },
        // ── 원자재 (commodities) ─────────────────────────────
        { symbol: 'UCO',  name: 'ProShares Ultra Crude Oil',       leverage: 2, direction: 'bull', kind: 'sector', underlying: 'WTI 원유' },
        { symbol: 'SCO',  name: 'ProShares UltraShort Crude Oil',  leverage: 2, direction: 'bear', kind: 'sector', underlying: 'WTI 원유' },
        { symbol: 'DGP',  name: 'DB Gold Double Long',             leverage: 2, direction: 'bull', kind: 'sector', underlying: '금 (Gold)' },
        { symbol: 'DZZ',  name: 'DB Gold Double Short',            leverage: 2, direction: 'bear', kind: 'sector', underlying: '금 (Gold)' },
        // ── 변동성 (VIX) — 1.5x이지만 인기로 포함 ────────────
        { symbol: 'UVXY', name: 'ProShares Ultra VIX Short-Term',  leverage: 2, direction: 'bull', kind: 'sector', underlying: 'VIX 변동성' },
        // ── 추가 섹터 ────────────────────────────────────────
        { symbol: 'UTSL', name: 'Direxion Utilities Bull 3x',      leverage: 3, direction: 'bull', kind: 'sector', underlying: '유틸리티' },
        { symbol: 'JNUG', name: 'Direxion Junior Gold Miners 2x',  leverage: 2, direction: 'bull', kind: 'sector', underlying: '주니어 금광주' },
        { symbol: 'JDST', name: 'Direxion Junior Gold Miners -2x', leverage: 2, direction: 'bear', kind: 'sector', underlying: '주니어 금광주' },
        // ── AI 인프라 / 네트워킹 ───────────────────────────────
        { symbol: 'NETX', name: 'T-Rex 2x Long NET',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'Cloudflare' },
        { symbol: 'ALAX', name: 'Tradr 2x Long ALAB',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Astera Labs' },
        { symbol: 'ANEL', name: 'Tradr 2x Long ANET',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Arista Networks' },
        { symbol: 'VRTX', name: 'Tradr 2x Long VRT',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'Vertiv' },
        { symbol: 'MRVX', name: 'GraniteShares MRVL Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Marvell' },
        { symbol: 'MULL', name: 'GraniteShares MU Long 2x',        leverage: 2, direction: 'bull', kind: 'single', underlying: 'Micron' },
        { symbol: 'MUSH', name: 'GraniteShares MU Short 2x',       leverage: 2, direction: 'bear', kind: 'single', underlying: 'Micron' },
        // ── 클라우드 / SaaS ────────────────────────────────────
        { symbol: 'ORCX', name: 'Tradr 2x Long ORCL',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Oracle' },
        { symbol: 'CRML', name: 'GraniteShares CRM Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Salesforce' },
        { symbol: 'ADBL', name: 'GraniteShares ADBE Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Adobe' },
        { symbol: 'NOWX', name: 'Tradr 2x Long NOW',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'ServiceNow' },
        { symbol: 'SNOX', name: 'Tradr 2x Long SNOW',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Snowflake' },
        { symbol: 'DDGX', name: 'Tradr 2x Long DDOG',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Datadog' },
        // ── 반도체 추가 ────────────────────────────────────────
        { symbol: 'INTX', name: 'Tradr 2x Long INTC',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Intel' },
        { symbol: 'INTS', name: 'Tradr 2x Short INTC',             leverage: 2, direction: 'bear', kind: 'single', underlying: 'Intel' },
        { symbol: 'QCML', name: 'GraniteShares QCOM Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Qualcomm' },
        { symbol: 'TXNL', name: 'Tradr 2x Long TXN',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'Texas Instruments' },
        // ── 미디어 / 컨슈머 ────────────────────────────────────
        { symbol: 'DISL', name: 'Direxion DIS Bull 2x',            leverage: 2, direction: 'bull', kind: 'single', underlying: 'Disney' },
        { symbol: 'COSL', name: 'GraniteShares COST Long 2x',      leverage: 2, direction: 'bull', kind: 'single', underlying: 'Costco' },
        { symbol: 'WMTL', name: 'Tradr 2x Long WMT',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'Walmart' },
        { symbol: 'HDL',  name: 'GraniteShares HD Long 2x',        leverage: 2, direction: 'bull', kind: 'single', underlying: 'Home Depot' },
        // ── 결제 / 금융 ────────────────────────────────────────
        { symbol: 'VISL', name: 'GraniteShares V Long 2x',         leverage: 2, direction: 'bull', kind: 'single', underlying: 'Visa' },
        { symbol: 'MAXL', name: 'GraniteShares MA Long 2x',        leverage: 2, direction: 'bull', kind: 'single', underlying: 'Mastercard' },
        { symbol: 'GSL',  name: 'GraniteShares GS Long 2x',        leverage: 2, direction: 'bull', kind: 'single', underlying: 'Goldman Sachs' },
        { symbol: 'BACX', name: 'Tradr 2x Long BAC',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'Bank of America' },
        { symbol: 'WFCL', name: 'GraniteShares WFC Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Wells Fargo' },
        // ── 헬스케어 / 제약 ───────────────────────────────────
        { symbol: 'JNJL', name: 'GraniteShares JNJ Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Johnson & Johnson' },
        { symbol: 'PFEL', name: 'GraniteShares PFE Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Pfizer' },
        { symbol: 'NVOX', name: 'Tradr 2x Long NVO',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'Novo Nordisk' },
        // ── EV / 차량 ─────────────────────────────────────────
        { symbol: 'FORD', name: 'Tradr 2x Long F',                 leverage: 2, direction: 'bull', kind: 'single', underlying: 'Ford' },
        { symbol: 'GMGX', name: 'Tradr 2x Long GM',                leverage: 2, direction: 'bull', kind: 'single', underlying: 'General Motors' },
        { symbol: 'XPEX', name: 'Tradr 2x Long XPEV',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'XPeng' },
        { symbol: 'LIDX', name: 'Tradr 2x Long LI',                leverage: 2, direction: 'bull', kind: 'single', underlying: 'Li Auto' },
        // ── 항공 / 여행 ────────────────────────────────────────
        { symbol: 'ABNL', name: 'Tradr 2x Long ABNB',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Airbnb' },
        { symbol: 'DASX', name: 'Tradr 2x Long DASH',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'DoorDash' },
        // ── 에너지 / 정유 ─────────────────────────────────────
        { symbol: 'XOML', name: 'GraniteShares XOM Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'ExxonMobil' },
        { symbol: 'CVXL', name: 'GraniteShares CVX Long 2x',       leverage: 2, direction: 'bull', kind: 'single', underlying: 'Chevron' },
        // ── 신규 IPO / 모멘텀 ─────────────────────────────────
        { symbol: 'RDDX', name: 'Tradr 2x Long RDDT',              leverage: 2, direction: 'bull', kind: 'single', underlying: 'Reddit' },
        { symbol: 'SMRX', name: 'Tradr 2x Long SMR',               leverage: 2, direction: 'bull', kind: 'single', underlying: 'NuScale Power' },
        // ── 선물·원자재 (Commodities/Futures) ───────────────────
        // 금 (Gold futures)
        { symbol: 'UGL',  name: 'ProShares Ultra Gold',              leverage: 2, direction: 'bull', kind: 'commodity', underlying: '금' },
        { symbol: 'DGP',  name: 'DB Gold Double Long ETN',           leverage: 2, direction: 'bull', kind: 'commodity', underlying: '금' },
        { symbol: 'GLL',  name: 'ProShares UltraShort Gold',         leverage: 2, direction: 'bear', kind: 'commodity', underlying: '금' },
        // 은 (Silver futures)
        { symbol: 'AGQ',  name: 'ProShares Ultra Silver',            leverage: 2, direction: 'bull', kind: 'commodity', underlying: '은' },
        { symbol: 'ZSL',  name: 'ProShares UltraShort Silver',       leverage: 2, direction: 'bear', kind: 'commodity', underlying: '은' },
        // 원유 (Crude Oil futures)
        { symbol: 'UCO',  name: 'ProShares Ultra Bloomberg Crude Oil', leverage: 2, direction: 'bull', kind: 'commodity', underlying: '원유' },
        { symbol: 'SCO',  name: 'ProShares UltraShort Crude Oil',    leverage: 2, direction: 'bear', kind: 'commodity', underlying: '원유' },
        { symbol: 'OILU', name: 'MicroSectors Oil & Gas 3x Leveraged', leverage: 3, direction: 'bull', kind: 'commodity', underlying: '원유·가스' },
        { symbol: 'OILD', name: 'MicroSectors Oil & Gas 3x Inverse', leverage: 3, direction: 'bear', kind: 'commodity', underlying: '원유·가스' },
        // 천연가스 (Natural Gas futures)
        { symbol: 'BOIL', name: 'ProShares Ultra Bloomberg Natural Gas', leverage: 2, direction: 'bull', kind: 'commodity', underlying: '천연가스' },
        { symbol: 'KOLD', name: 'ProShares UltraShort Natural Gas',  leverage: 2, direction: 'bear', kind: 'commodity', underlying: '천연가스' },
        // VIX 변동성 선물 (Volatility futures)
        { symbol: 'UVXY', name: 'ProShares Ultra VIX Short-Term Futures', leverage: 1.5, direction: 'bull', kind: 'commodity', underlying: 'VIX 변동성' },
        { symbol: 'SVXY', name: 'ProShares Short VIX Short-Term Futures', leverage: 0.5, direction: 'bear', kind: 'commodity', underlying: 'VIX 변동성' },
        { symbol: 'VIXY', name: 'ProShares VIX Short-Term Futures',  leverage: 1, direction: 'bull', kind: 'commodity', underlying: 'VIX 변동성' },
        // 미국채 선물 (Treasury futures)
        { symbol: 'TBT',  name: 'ProShares UltraShort 20+ Year Treasury', leverage: 2, direction: 'bear', kind: 'commodity', underlying: '20년+ 국채' },
        { symbol: 'UBT',  name: 'ProShares Ultra 20+ Year Treasury', leverage: 2, direction: 'bull', kind: 'commodity', underlying: '20년+ 국채' },
        { symbol: 'TBF',  name: 'ProShares Short 20+ Year Treasury', leverage: 1, direction: 'bear', kind: 'commodity', underlying: '20년+ 국채' },
        { symbol: 'TYO',  name: 'Direxion Daily 7-10Y Treasury Bear 3x', leverage: 3, direction: 'bear', kind: 'commodity', underlying: '7-10년 국채' },
        { symbol: 'TYD',  name: 'Direxion Daily 7-10Y Treasury Bull 3x', leverage: 3, direction: 'bull', kind: 'commodity', underlying: '7-10년 국채' },
        // 비트코인·이더리움 선물 (Crypto futures)
        { symbol: 'BITX', name: 'Volatility Shares 2x Bitcoin Strategy', leverage: 2, direction: 'bull', kind: 'commodity', underlying: '비트코인' },
        { symbol: 'BITU', name: 'ProShares Ultra Bitcoin Strategy',  leverage: 2, direction: 'bull', kind: 'commodity', underlying: '비트코인' },
        { symbol: 'BITI', name: 'ProShares Short Bitcoin Strategy',  leverage: 1, direction: 'bear', kind: 'commodity', underlying: '비트코인' },
        { symbol: 'ETHU', name: '2x Ether ETF',                      leverage: 2, direction: 'bull', kind: 'commodity', underlying: '이더리움' },
        { symbol: 'ETHT', name: 'T-Rex 2x Long Ether Daily',         leverage: 2, direction: 'bull', kind: 'commodity', underlying: '이더리움' },
        { symbol: 'ETHD', name: 'T-Rex 2x Inverse Ether Daily',      leverage: 2, direction: 'bear', kind: 'commodity', underlying: '이더리움' },
        // 통화 (FX futures)
        { symbol: 'EUO',  name: 'ProShares UltraShort Euro',         leverage: 2, direction: 'bear', kind: 'commodity', underlying: '유로' },
        { symbol: 'ULE',  name: 'ProShares Ultra Euro',              leverage: 2, direction: 'bull', kind: 'commodity', underlying: '유로' },
        { symbol: 'YCS',  name: 'ProShares UltraShort Yen',          leverage: 2, direction: 'bear', kind: 'commodity', underlying: '엔화' },
        // 농산물 (Agricultural futures)
        { symbol: 'CORN', name: 'Teucrium Corn Fund',                leverage: 1, direction: 'bull', kind: 'commodity', underlying: '옥수수' },
        { symbol: 'WEAT', name: 'Teucrium Wheat Fund',               leverage: 1, direction: 'bull', kind: 'commodity', underlying: '밀' },
        { symbol: 'SOYB', name: 'Teucrium Soybean Fund',             leverage: 1, direction: 'bull', kind: 'commodity', underlying: '대두' },
        // 광물 (Industrial metals)
        { symbol: 'CPER', name: 'United States Copper Index Fund',   leverage: 1, direction: 'bull', kind: 'commodity', underlying: '구리' },
        { symbol: 'JJC',  name: 'iPath Bloomberg Copper Subindex',   leverage: 1, direction: 'bull', kind: 'commodity', underlying: '구리' },
    ];
    let _levFilters = { leverage: 'all', direction: 'all', kind: 'all' };
    let _levSearchQuery = '';
    let _levQuotes = {};        // { SYMBOL: { price, change, changePct, volume } }
    let _underlyingQuotes = {}; // { TICKER: changePct } — 기초자산 등락률 (괴리율 계산용)
    let _levQuoteTs = 0;        // 마지막 페치 시각 (30초 캐시)

    function goLeverage() {
        _pushRoute('leverage');
        window._lastScreen = 'leverage';
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('smartMoneyScreen').style.display = 'none';
        document.getElementById('alphaScannerScreen').style.display = 'none';
        document.getElementById('favScreen').style.display = 'none';
        document.getElementById('visionScannerScreen').style.display = 'none';
        const _ern = document.getElementById('earningsScreen'); if (_ern) _ern.style.display = 'none';
        const ecoEl = document.getElementById('economicSection');
        if (ecoEl) ecoEl.style.display = 'none';
        const _posL = document.getElementById('positionScreen'); if (_posL) _posL.style.display = 'none';
        // 시장 테마/탭 네비 숨김
        const thermoEl = document.getElementById('marketThermometer');
        if (thermoEl) thermoEl.style.display = 'none';
        const qnavEl = document.getElementById('headerQNav');
        if (qnavEl) qnavEl.style.display = 'none';
        document.getElementById('leverageScreen').style.display = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded'); const _fab=document.getElementById('calcFab'); if(_fab)_fab.style.display='none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('sideNavLevBtn')?.classList.add('active');
        updateBnActive('leverage');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        loadLeverageETFs();
    }

    // ──────────────────────────────────────────────────────
    // 데일리 픽 — 매수 10 + 매도 10 추천 (24h 캐시)
    // ──────────────────────────────────────────────────────
    function goTop100() {
        window._lastScreen = 'top100';
        _restoreHeaderChrome();
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('smartMoneyScreen').style.display = 'none';
        document.getElementById('alphaScannerScreen').style.display = 'none';
        document.getElementById('favScreen').style.display = 'none';
        document.getElementById('visionScannerScreen').style.display = 'none';
        const _ern = document.getElementById('earningsScreen'); if (_ern) _ern.style.display = 'none';
        const _lev = document.getElementById('leverageScreen'); if (_lev) _lev.style.display = 'none';
        const _cat = document.getElementById('catalystScreen'); if (_cat) _cat.style.display = 'none';
        const ecoEl = document.getElementById('economicSection');
        if (ecoEl) ecoEl.style.display = 'none';
        const _posT = document.getElementById('positionScreen'); if (_posT) _posT.style.display = 'none';
        const thermoEl = document.getElementById('marketThermometer');
        if (thermoEl) thermoEl.style.display = 'none';
        const qnavEl = document.getElementById('headerQNav');
        if (qnavEl) qnavEl.style.display = 'none';
        document.getElementById('top100Screen').style.display = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded');
        const _fab = document.getElementById('calcFab'); if (_fab) _fab.style.display = 'none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        // 하단 네비게이션 — TOP100 버튼이 바텀 네비에 있으므로 top100 활성화
        updateBnActive('top100');
        // 데이터 로드
        loadTop100();
        try { window.scrollTo(0, 0); } catch(e){}
    }

    // ═══════════════════════════════════════════════════════════
    // 카탈리스트 스캐너 — SEC EDGAR 공시 기반 (v655, v669 rename)
    // ═══════════════════════════════════════════════════════════
    let _catalystData = null;
    let _catalystFilter = 'all';

    function goCatalyst() {
        window._lastScreen = 'catalyst';
        _restoreHeaderChrome();
        ['welcomeScreen','smartMoneyScreen','alphaScannerScreen','favScreen','visionScannerScreen','top100Screen','earningsScreen','leverageScreen','catalystScreen','positionScreen']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        const ecoEl = document.getElementById('economicSection'); if (ecoEl) ecoEl.style.display = 'none';
        const thermoEl = document.getElementById('marketThermometer'); if (thermoEl) thermoEl.style.display = 'none';
        const qnavEl = document.getElementById('headerQNav'); if (qnavEl) qnavEl.style.display = 'none';
        document.getElementById('catalystScreen').style.display = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded');
        const _fab = document.getElementById('calcFab'); if (_fab) _fab.style.display = 'none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        updateBnActive('all');
        loadCatalyst(false);
        try { window.scrollTo(0, 0); } catch(e){}
    }

    // ════════════════════════════════════════════════════════════════
    // 데일리 트레이딩 스캐너 — 실시간 5/15분봉 매수·매도 후보 (A급 이상)
    // ════════════════════════════════════════════════════════════════
    window._dailyTf = window._dailyTf || '5m';
    window._dailySide = window._dailySide || 'all';
    window._dailyData = null;

    function goDailyTrading() {
        window._lastScreen = 'dailyTrading';
        _restoreHeaderChrome();
        ['welcomeScreen','smartMoneyScreen','alphaScannerScreen','favScreen','visionScannerScreen','top100Screen','earningsScreen','leverageScreen','catalystScreen','positionScreen']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        const ecoEl = document.getElementById('economicSection'); if (ecoEl) ecoEl.style.display = 'none';
        const thermoEl = document.getElementById('marketThermometer'); if (thermoEl) thermoEl.style.display = 'none';
        const qnavEl = document.getElementById('headerQNav'); if (qnavEl) qnavEl.style.display = 'none';
        document.getElementById('mainContent').style.display = 'none';
        document.getElementById('dailyTradingScreen').style.display = '';  // _restoreHeaderChrome 가 숨긴 뒤 다시 표시
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded');
        const _fab = document.getElementById('calcFab'); if (_fab) _fab.style.display = 'none';
        document.getElementById('stockHero').classList.remove('show');
        document.getElementById('tabNav').classList.remove('show');
        document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('sideNavDailyBtn')?.classList.add('active');
        updateBnActive('all');
        // 진입 시 항상 '전체' 필터로 — 매수 필터에 갇혀 빈 화면 보는 것 방지
        window._dailySide = 'all';
        document.querySelectorAll('#dailyTradingScreen .catalyst-filter').forEach(b =>
            b.classList.toggle('active', b.dataset.dside === 'all'));
        try { _pushRoute('dailyTrading'); } catch(e){}
        loadDailyTrading(false);
        try { window.scrollTo(0, 0); } catch(e){}
    }

    function _dailySetTf(tf) {
        window._dailyTf = tf;
        document.querySelectorAll('#dailyTradingScreen .catalyst-tab').forEach(b =>
            b.classList.toggle('active', b.dataset.dtf === tf));
        loadDailyTrading(false); // tf 변경 → 재조회
    }
    function _dailySetSide(side) {
        window._dailySide = side;
        document.querySelectorAll('#dailyTradingScreen .catalyst-filter').forEach(b =>
            b.classList.toggle('active', b.dataset.dside === side));
        _renderDailyTrading(); // 필터만 → 재렌더
    }

    async function loadDailyTrading(force) {
        const list = document.getElementById('dailyList');
        if (!list) return;
        const tf = window._dailyTf || '5m';
        const cKey = `stockai_daily_${tf}`;
        if (!force) {
            try {
                const hit = JSON.parse(sessionStorage.getItem(cKey));
                if (hit && Date.now() - hit.ts < 90_000) { window._dailyData = hit.data; _renderDailyTrading(); return; }
            } catch(_) {}
        }
        list.innerHTML = '<div class="catalyst-loading">' + tf.replace('m','분봉') + ' 실시간 스캔 중...</div>';
        const btn = document.getElementById('dailyRefreshBtn');
        if (btn) btn.disabled = true;
        try {
            const r = await fetch(`/api/scanner/daily-trading?market=US&tf=${tf}`);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            window._dailyData = d;
            try { sessionStorage.setItem(cKey, JSON.stringify({ ts: Date.now(), data: d })); } catch(_) {}
            _renderDailyTrading();
        } catch(e) {
            list.innerHTML = `<div class="catalyst-loading">스캔 실패: ${escHtml(e.message || '')}</div>`;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function _renderDailyTrading() {
        const list = document.getElementById('dailyList');
        const d = window._dailyData;
        if (!list || !d) return;
        const upd = document.getElementById('dailyUpdated');
        if (upd) upd.textContent = `${d.totalScanned||0}종목 · ${new Date(d.scannedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`;

        // 오늘의 장세 배너 (시장 레짐)
        let regimeBanner = '';
        const rg = d.regime;
        if (rg && rg.label) {
            const cls = rg.regime === 'favorable' ? 'dt-regime--good' : rg.regime === 'risk_off' ? 'dt-regime--bad' : 'dt-regime--mid';
            const ico = rg.regime === 'favorable' ? '🟢' : rg.regime === 'risk_off' ? '🔴' : '🟡';
            const spy = rg.spyChgPct != null ? `SPY ${rg.spyChgPct >= 0 ? '+' : ''}${rg.spyChgPct}%` : '';
            const vix = rg.vix != null ? `VIX ${rg.vix}` : '';
            const warn = rg.regime === 'risk_off' ? '<div class="dt-regime-warn">⚠️ 위험 장세 — A급 매수 신호는 참고용, S급만 신뢰</div>' : '';
            regimeBanner = `<div class="dt-regime ${cls}">
                <div class="dt-regime-top"><span>${ico} 오늘의 장세 · <b>${escHtml(rg.label)}</b></span><span class="dt-regime-meta">${spy}${spy&&vix?' · ':''}${vix}</span></div>
                ${warn}</div>`;
        }

        const side = window._dailySide || 'all';
        const all = d.results || [];
        const nBuy = all.filter(r => r.dir === 'buy').length;
        const nSell = all.filter(r => r.dir === 'sell').length;
        // 필터 카운트 배지 갱신
        const _setCnt = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
        _setCnt('dsCntAll', all.length); _setCnt('dsCntBuy', nBuy); _setCnt('dsCntSell', nSell);

        const rows = all.filter(r => side === 'all' || r.dir === side);
        if (!rows.length) {
            // 필터 인식형 빈 상태 — 왜 비었는지 + 다른 쪽 신호로 유도
            let msg, sub = '';
            if (side === 'buy' && nSell > 0) {
                msg = '지금은 매수 신호가 없습니다';
                sub = `현재 하락 추세장이라 Smart Dip 매수(눌림목) 조건을 만족하는 종목이 없어요.<br><b style="color:var(--green)">📉 매도 신호 ${nSell}개</b>가 있습니다 — 위 매도 탭을 눌러보세요.`;
            } else if (side === 'sell' && nBuy > 0) {
                msg = '지금은 매도 신호가 없습니다';
                sub = `상승 추세장이라 매도(반등 소진) 조건 종목이 없어요.<br><b style="color:#FFD400">📈 매수 신호 ${nBuy}개</b>가 있습니다 — 위 매수 탭을 눌러보세요.`;
            } else {
                msg = 'Smart Dip 조건을 충족하는 종목이 없습니다';
                sub = '추세·거래량·진입봉 8개 필터를 통과한 A급 후보는 장중에 실시간 갱신됩니다.';
            }
            list.innerHTML = regimeBanner + `<div class="catalyst-loading" style="padding:28px 16px;line-height:1.7;">${msg}<br><span style="font-size:12px;color:var(--text3)">${sub}</span></div>`;
            return;
        }
        const sigPill = (f) => `<span class="alpha-sig-pill alpha-sig--blue">${escHtml(f)}</span>`;
        const _sessLabel = { open_drive: '장초반', midday: '점심', power_hour: '파워아워' };
        list.innerHTML = regimeBanner + rows.map((r, idx) => {
            const isBuy = r.dir === 'buy';
            const dirBg = isBuy ? '#FFD400' : '#22C55E';
            const dirTx = isBuy ? '#000' : '#fff';
            const dirLabel = isBuy ? '📈 매수' : '📉 매도';
            const gradeColor = r.grade === 'S' ? '#FFD60A' : r.grade === 'A' ? '#22C55E' : r.riskWarn ? '#FF8C00' : '#64748B';
            // 신선도 — barsAgo × 봉길이(분)
            const _tfMin = (window._dailyTf === '15m') ? 15 : 5;
            const _ago = (r.barsAgo == null) ? null : r.barsAgo * _tfMin;
            const freshLabel = _ago == null ? '' : _ago === 0 ? '방금' : `${_ago}분 전`;
            const freshCls = (_ago != null && _ago <= 5) ? 'alpha-sig--emerald' : 'alpha-sig--amber';
            // 진입 품질 pill
            const qPills = [];
            if (freshLabel) qPills.push(`<span class="alpha-sig-pill ${freshCls}">🕒 ${freshLabel}</span>`);
            if (r.vwapPos) qPills.push(`<span class="alpha-sig-pill ${r.vwapPos==='above'?'alpha-sig--emerald':'alpha-sig--red'}">VWAP ${r.vwapPos==='above'?'위':'아래'}</span>`);
            if (r.adx != null) qPills.push(`<span class="alpha-sig-pill alpha-sig--cyan">ADX ${r.adx}</span>`);
            if (_sessLabel[r.session]) qPills.push(`<span class="alpha-sig-pill alpha-sig--amber">${_sessLabel[r.session]}</span>`);
            const warnBadge = r.riskWarn ? `<span style="display:inline-block;padding:1px 5px;border-radius:5px;background:#FF8C00;color:#fff;font-size:9px;font-weight:700;margin-left:4px;">⚠️위험</span>` : '';
            const bounceBadge = r.mode === 'bounce' ? `<span style="display:inline-block;padding:1px 5px;border-radius:5px;background:#7C3AED;color:#fff;font-size:9px;font-weight:700;margin-left:4px;">↩️역추세</span>` : '';
            return `<div class="catalyst-card" onclick="quickSearch('${escHtml(r.symbol)}','US')">
                <div class="catalyst-card-head">
                    <div class="catalyst-rank">${idx + 1}</div>
                    <div class="catalyst-id">
                        <div class="catalyst-sym">${escHtml(r.symbol)}
                            <span style="display:inline-block;padding:2px 7px;border-radius:6px;background:${dirBg};color:${dirTx};font-size:10px;font-weight:800;margin-left:4px;">${dirLabel}</span>${bounceBadge}${warnBadge}
                        </div>
                        <div class="catalyst-name">승률 ${r.winRate}%${r.winMeasured ? ' <span style="color:var(--green)">실측</span>' : ''} · 손익비 1:2 · RSI ${r.rsi}</div>
                    </div>
                    <div class="catalyst-grade" style="background:${gradeColor};color:#000">${escHtml(r.grade)} · ${r.score}</div>
                </div>
                ${qPills.length ? `<div class="alpha-signals" style="margin-bottom:8px">${qPills.join('')}</div>` : ''}
                ${(r.stop != null && r.target1 != null) ? `
                <div class="dt-plan">
                    <div class="dt-plan-cell"><span class="dt-plan-lbl">진입</span><b>$${(r.price||0).toFixed(2)}</b></div>
                    <div class="dt-plan-cell dt-plan-stop"><span class="dt-plan-lbl">손절</span><b>$${r.stop.toFixed(2)}</b><span class="dt-plan-r">-${r.riskPct}%</span></div>
                    <div class="dt-plan-cell dt-plan-tgt"><span class="dt-plan-lbl">목표 2R</span><b>$${r.target1.toFixed(2)}</b></div>
                    <div class="dt-plan-cell dt-plan-tgt"><span class="dt-plan-lbl">3R</span><b>$${r.target2.toFixed(2)}</b></div>
                </div>` : ''}
                <div class="alpha-signals">${(r.factors||[]).map(sigPill).join('')}</div>
            </div>`;
        }).join('');
    }

    // ════════════════════════════════════════════════════════════════
    // 계정/프로필 페이지
    // ════════════════════════════════════════════════════════════════
    function goProfile() {
        // 비로그인 사용자 → 로그인 페이지로 라우팅 (오늘의집 스타일)
        if (!window.Clerk?.user && typeof window.goLogin === 'function') {
            window.goLogin();
            return;
        }
        window._lastScreen = 'profile';
        _restoreHeaderChrome();
        ['welcomeScreen','smartMoneyScreen','alphaScannerScreen','favScreen','visionScannerScreen',
         'top100Screen','earningsScreen','leverageScreen','catalystScreen','positionScreen']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        const ecoEl = document.getElementById('economicSection'); if (ecoEl) ecoEl.style.display = 'none';
        const thermoEl = document.getElementById('marketThermometer'); if (thermoEl) thermoEl.style.display = 'none';
        const qnavEl = document.getElementById('headerQNav'); if (qnavEl) qnavEl.style.display = 'none';
        document.getElementById('mainContent').style.display = 'none';
        const profileEl = document.getElementById('profileScreen');
        if (profileEl) profileEl.style.display = '';
        window._vsActive = false;
        document.getElementById('mainHeader')?.classList.remove('stock-loaded');
        const _fab = document.getElementById('calcFab'); if (_fab) _fab.style.display = 'none';
        document.getElementById('stockHero')?.classList.remove('show');
        document.getElementById('tabNav')?.classList.remove('show');
        updateBnActive('all');
        try { window.scrollTo(0, 0); } catch(e){}
        _renderProfileScreen();
    }

    function _profileStatCell(icon, label, value) {
        return `<div style="background:var(--bg2);border-radius:8px;padding:10px 12px;">
            <div style="font-size:18px;margin-bottom:4px;">${icon}</div>
            <div style="font-size:11px;color:var(--text3);">${label}</div>
            <div style="font-size:14px;font-weight:700;color:var(--text);margin-top:2px;">${escHtml(String(value))}</div>
        </div>`;
    }

    function _renderProfileScreen() {
        const container = document.getElementById('profileContent');
        if (!container) return;
        const user = window.Clerk?.user;
        const isLoggedIn = !!user;

        // 앱 사용 통계 (localStorage 기반)
        const favorites   = JSON.parse(localStorage.getItem('stockai_favorites') || '[]');
        const themeRaw    = localStorage.getItem('stockai_theme') || '';
        const themeLabel  = themeRaw === 'dark' ? '🌙 다크' : themeRaw === 'light' ? '☀️ 라이트' : '🌀 OS 자동';
        const notifOn     = !!localStorage.getItem('stockai_push_token');
        const recentSyms  = JSON.parse(localStorage.getItem('stockai_recent') || '[]');

        // 유저 정보
        const displayName = user?.firstName || user?.username ||
            user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || '비로그인';
        const email  = user?.emailAddresses?.[0]?.emailAddress || '';
        // 마스터(관리자) 계정 식별 — 이메일 또는 Clerk user_id 매칭
        const MASTER_EMAILS = ['rkd687@gmail.com'];
        const MASTER_IDS = ['user_3EhxWla1QzZmEG19xfFdmnUTUrp'];
        const isMaster = isLoggedIn && (MASTER_EMAILS.includes(email) || MASTER_IDS.includes(user?.id));
        const avatar = user?.imageUrl
            ? `<img src="${escHtml(user.imageUrl)}" alt="" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid var(--border);">`
            : `<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--blue));display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;color:#fff;">${(displayName[0]||'?').toUpperCase()}</div>`;
        const lastSignIn = user?.lastSignInAt
            ? new Date(user.lastSignInAt).toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})
            : null;

        // 계정 배지 업데이트
        const btnLabel = document.getElementById('profileBtnLabel');
        if (btnLabel) btnLabel.textContent = isLoggedIn ? (user?.firstName || '계정') : '계정';

        container.innerHTML = `
            <!-- 프로필 카드 -->
            <div class="card" style="margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:16px;padding:4px 0 14px;">
                    ${avatar}
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:17px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(displayName)}${isMaster ? ' <span style="display:inline-block;vertical-align:2px;margin-left:6px;padding:2px 9px;border-radius:9999px;background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#1a1a1a;font-size:11px;font-weight:800;">👑 마스터</span>' : ''}</div>
                        ${email ? `<div style="font-size:12px;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(email)}</div>` : ''}
                        <div style="font-size:11px;color:${isMaster ? '#f59e0b' : isLoggedIn ? 'var(--green)' : 'var(--text3)'};margin-top:5px;">${isMaster ? '👑 마스터(관리자) 계정 · 전체 권한' : isLoggedIn ? '✓ 로그인됨 · 다기기 동기화 활성' : '비로그인 · 기기 단독 모드'}</div>
                    </div>
                </div>
                ${isLoggedIn ? `
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button style="flex:1;min-width:100px;padding:8px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;cursor:pointer;" onclick="window.Clerk?.openUserProfile?.()">⚙️ 계정 관리</button>
                    <button style="flex:1;min-width:100px;padding:8px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;color:var(--red);font-size:13px;cursor:pointer;" onclick="window.signOut?.()">로그아웃</button>
                </div>` : `
                <button style="width:100%;padding:10px;background:var(--blue);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;" onclick="window.signIn?.()">Google · Apple 로 로그인</button>
                `}
            </div>

            <!-- 사용 현황 -->
            <div class="card" style="margin-bottom:12px;">
                <div class="card-title"><span class="dot" style="background:var(--green)"></span>사용 현황</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:4px 0 4px;">
                    ${_profileStatCell('⭐', '즐겨찾기', favorites.length + '개')}
                    ${_profileStatCell('📈', '최근 검색', recentSyms.length + '개')}
                    ${_profileStatCell('🎨', '테마', themeLabel)}
                    ${_profileStatCell('🔔', '알림 구독', notifOn ? '활성 ✓' : '비활성')}
                </div>
                ${lastSignIn ? `<div style="font-size:11px;color:var(--text3);text-align:right;padding-top:6px;">마지막 로그인: ${lastSignIn}</div>` : ''}
            </div>

            <!-- 빠른 이동 -->
            <div class="card" style="margin-bottom:12px;">
                <div class="card-title"><span class="dot" style="background:var(--yellow)"></span>빠른 이동</div>
                <div style="display:flex;flex-direction:column;gap:0;">
                    ${[
                        ['🔔', '알림 설정', "openSettings('notif');goHome();"],
                        ['⚙️', '전체 설정', "openSettings();goHome();"],
                        ['📊', '시그널 통계', "openSignalStats?.();goHome?.();"],
                        ['📢', '기능 업데이트', "openChangelog();goHome();"],
                    ].map(([icon, label, fn]) =>
                        `<button onclick="${fn}" style="display:flex;align-items:center;gap:10px;padding:11px 4px;background:none;border:none;border-bottom:1px solid var(--border);cursor:pointer;color:var(--text);font-size:13px;text-align:left;">
                            <span style="width:22px;text-align:center;">${icon}</span>
                            <span style="flex:1;">${label}</span>
                            <span style="color:var(--text3);">›</span>
                        </button>`
                    ).join('')}
                </div>
            </div>

            <div style="text-align:center;padding:16px 0 8px;font-size:11px;color:var(--text3);">
                StockAI · rkd687@gmail.com
            </div>
        `;
    }

    function _catalystSetFilter(f) {
        _catalystFilter = f;
        document.querySelectorAll('.catalyst-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
        _renderCatalyst(_catalystData);
    }

    // 거래량 급증 필터 (전체/상승/하락 등)
    let _surgeFilter = 'all';
    function _setSurgeFilter(filter) {
        _surgeFilter = filter || 'all';
        document.querySelectorAll('.surge-filter-btn, [data-surge-filter]').forEach(b => {
            const bf = b.dataset.filter || b.dataset.surgeFilter;
            b.classList.toggle('active', bf === _surgeFilter);
        });
        _volSurgeCatLoaded = false;
        loadVolumeSurge(true);
    }

    let _volSurgeCatLoaded = false;
    let _minerviniLoaded = false;

    function switchCatalystTab(tab) {
        document.querySelectorAll('.catalyst-tab').forEach(b => b.classList.toggle('active', b.dataset.ctab === tab));
        const edgarTab     = document.getElementById('catalystEdgarTab');
        const volumeTab    = document.getElementById('catalystVolumeTab');
        const minerviniTab = document.getElementById('catalystMinerviniTab');
        const refreshBtn   = document.getElementById('catalystRefreshBtn');
        if (edgarTab)     edgarTab.style.display     = 'none';
        if (volumeTab)    volumeTab.style.display    = 'none';
        if (minerviniTab) minerviniTab.style.display = 'none';
        if (tab === 'edgar') {
            if (edgarTab) edgarTab.style.display = '';
            if (refreshBtn) { refreshBtn.onclick = () => loadCatalyst(true); refreshBtn.style.display = ''; }
        } else if (tab === 'volume') {
            if (volumeTab) volumeTab.style.display = '';
            if (refreshBtn) { refreshBtn.onclick = () => loadVolumeSurge(true); refreshBtn.style.display = ''; }
            if (!_volSurgeCatLoaded) loadVolumeSurge(false);
        } else if (tab === 'minervini') {
            if (minerviniTab) minerviniTab.style.display = '';
            if (refreshBtn) { refreshBtn.onclick = () => loadMinervini(); refreshBtn.style.display = ''; }
            if (!_minerviniLoaded) loadMinervini();
        }
    }

    async function loadVolumeSurge(forceRefresh) {
        const listEl = document.getElementById('catalystVolList');
        if (!listEl) return;
        if (!_volSurgeCatLoaded || forceRefresh) {
            listEl.innerHTML = '<div class="catalyst-loading">거래량 급증 스캔 중... (최대 10초)</div>';
        }
        try {
            const url = '/api/scanner/volume-surge' + (forceRefresh ? '?t=' + Date.now() : '');
            const r = await fetch(url);
            if (!r.ok) throw new Error('http ' + r.status);
            const d = await r.json();
            _volSurgeCatLoaded = true;
            if (!d.stocks || d.stocks.length === 0) {
                listEl.innerHTML = '<div class="catalyst-loading">급증 종목 없음 (장 마감 후에는 데이터가 제한될 수 있습니다)</div>';
                return;
            }
            const scannedLabel = d.scannedAt ? (() => {
                const dt = new Date(d.scannedAt);
                return dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0');
            })() : '';
            listEl.innerHTML = d.stocks.map(s => {
                const chg = s.changePct || 0;
                const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
                const chgCls = chg >= 0 ? 'pos' : 'neg';
                const volRatio = s.volRatio || 0;
                const surgeScore = s.surgeScore || 0;
                const capTier = s.marketCapTier || 'unknown';
                const tierLabelMap = { micro:'MICRO CAP', small:'SMALL CAP', mid:'MID CAP', large:'LARGE CAP' };
                const tierClsMap   = { micro:'purple',    small:'blue',      mid:'cyan',    large:'gray' };
                const capLabel = tierLabelMap[capTier] || capTier.toUpperCase();
                const capCls   = tierClsMap[capTier]  || 'purple';
                const surgeBadge = volRatio >= 5
                    ? `<span class="alpha-signal orange">거래량 ${volRatio}x 폭증</span>`
                    : volRatio >= 3
                    ? `<span class="alpha-signal amber">거래량 ${volRatio}x 급증</span>`
                    : `<span class="alpha-signal blue">거래량 ${volRatio}x 증가</span>`;
                const chgBadge = Math.abs(chg) >= 5
                    ? `<span class="alpha-signal ${chg >= 0 ? 'emerald' : 'red'}">${chgStr}</span>`
                    : Math.abs(chg) >= 2
                    ? `<span class="alpha-signal cyan">${chgStr}</span>`
                    : '';
                const timingBadge = surgeScore >= 70
                    ? `<span class="alpha-signal orange">즉시 주목</span>`
                    : surgeScore >= 50
                    ? `<span class="alpha-signal amber">관찰 중</span>`
                    : `<span class="alpha-signal cyan">모니터링</span>`;
                const score = surgeScore >= 70 ? 6 : surgeScore >= 55 ? 5 : surgeScore >= 40 ? 4 : surgeScore >= 25 ? 3 : 2;
                const stars = '★'.repeat(score) + '☆'.repeat(Math.max(0, 6 - score));
                return `<div class="catalyst-card" onclick="quickSearch('${s.symbol}','US')">
                    <div class="catalyst-card-top">
                        <div class="catalyst-card-left">
                            <span class="catalyst-ticker">${s.symbol}</span>
                            <span class="catalyst-name">${s.name || ''}</span>
                        </div>
                        <div class="catalyst-card-right">
                            <span class="catalyst-price">$${(s.price || 0).toFixed(2)}</span>
                            <span class="catalyst-chg ${chgCls}">${chgStr}</span>
                        </div>
                    </div>
                    <div class="catalyst-card-signals">
                        ${surgeBadge}${chgBadge}
                        <span class="alpha-signal ${capCls}">${capLabel}</span>
                        ${timingBadge}
                    </div>
                    <div class="catalyst-card-footer">
                        <span class="catalyst-score">${stars}</span>
                        <span class="catalyst-reason">평균 대비 ${volRatio}배 거래량 급증 — 뉴스·공시 확인 필수</span>
                    </div>
                </div>`;
            }).join('');
        } catch (e) {
            console.error('[loadVolumeSurge]', e);
            listEl.innerHTML = `<div class="catalyst-loading">오류: ${e.message}</div>`;
        }
    }

    async function loadMinervini() {
        _minerviniLoaded = true;
        const listEl = document.getElementById('minerviniList');
        if (!listEl) return;
        listEl.innerHTML = '<div class="catalyst-loading">🌙 종가 매매 종목 스캔 중... (최대 2분)</div>';
        try {
            const r = await fetch('/api/scanner/minervini');
            const d = await r.json();
            if (d.error) throw new Error(d.error);
            if (!d.stocks || d.stocks.length === 0) {
                listEl.innerHTML = '<div class="catalyst-empty">오늘은 종가 매매 셋업 없음<br><span style="font-size:11px;color:var(--text3)">시장 상황상 진입 기회가 없을 수 있어요</span></div>';
                return;
            }
            const guideHtml = `<div class="mv-guide">
                <strong>🌙 종가 매매 — 시장 대비 강한 리더</strong>
                <span>장 마감 직전 매수 · 손절 -8% · 목표 2R·3R·5R</span></div>`;
            const _gc = g => g === 'S' ? '#FFD60A' : g === 'A' ? '#22C55E' : g === 'B' ? '#3B82F6' : '#9CA3AF';
            const _gl = g => g === 'S' ? '최우선' : g === 'A' ? '진입' : g === 'B' ? '소량' : '관망';
            const pct = v => `${v > 0 ? '+' : ''}${v}%`;
            const cards = d.stocks.map((s, idx) => {
                const gc = _gc(s.grade || 'C');
                const pills = [];
                if (s.marketBeat) pills.push(`<span class="alpha-sig-pill alpha-sig--purple">시장대비 +${s.rsVsSpx}%</span>`);
                if (s.vcp)        pills.push(`<span class="alpha-sig-pill alpha-sig--blue">VCP 수축</span>`);
                if (s.volDryUp)   pills.push(`<span class="alpha-sig-pill alpha-sig--cyan">거래량 마름</span>`);
                if (s.pivotBroken)pills.push(`<span class="alpha-sig-pill alpha-sig--emerald">피벗 돌파</span>`);
                if (s.volConfirm || s.volRatio >= 1.3) pills.push(`<span class="alpha-sig-pill alpha-sig--amber">돌파 거래량 ${s.volRatio}x</span>`);
                const cell = (label, v) => `<span class="catalyst-meta-cell ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${label} ${pct(v)}</span>`;
                return `<div class="catalyst-card" onclick="selectStock('${escHtml(s.ticker)}')">
                    <div class="catalyst-card-head">
                        <div class="catalyst-rank">${idx + 1}</div>
                        <div class="catalyst-id" style="flex:1;min-width:0">
                            <div class="catalyst-sym">${escHtml(s.ticker)}
                                <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;background:${gc}22;color:${gc};border:1px solid ${gc}55;margin-left:4px;">RS ${s.rsRating ?? '—'}</span>
                            </div>
                            <div class="catalyst-name">트렌드 ${s.trendTemplateScore}/8 · 점수 ${s.totalScore} · 거래량 ${s.volRatio}x</div>
                        </div>
                        <div class="catalyst-grade" style="background:${gc};color:#000">${s.grade || 'C'} · ${_gl(s.grade || 'C')}</div>
                    </div>
                    ${pills.length ? `<div class="alpha-signals">${pills.join('')}</div>` : ''}
                    <div class="catalyst-meta-row">
                        <span class="catalyst-meta-cell">💰 $${(s.currentPrice || s.entryPrice).toFixed(2)}</span>
                        ${cell('1M', s.rs1m)}${cell('3M', s.rs3m)}${cell('6M', s.rs6m)}
                    </div>
                    <div class="catalyst-strategy">
                        <span class="cs-cell entry">진입 $${s.entryPrice.toFixed(2)}</span>
                        <span class="cs-cell stop">손절 $${s.stopLoss}${s.riskPct ? ` (-${s.riskPct}%)` : ''}</span>
                        <span class="cs-cell tp">목표 $${s.tp1Price} / $${s.tp2Price} / $${s.tp3Price}</span>
                    </div>
                </div>`;
            }).join('');
            listEl.innerHTML = `${guideHtml}<div class="mv-scan-meta">스캔 ${new Date(d.scannedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${d.total}개 셋업</div><div class="catalyst-list">${cards}</div>`;
        } catch(e) {
            listEl.innerHTML = `<div class="catalyst-empty">스캔 실패: ${e.message}<br><button onclick="loadMinervini()" style="margin-top:8px;padding:4px 12px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer">다시 시도</button></div>`;
        }
    }

    async function _runMinerviniAlert() {
        try {
            const r = await fetch('/api/scanner/minervini');
            const d = await r.json();
            if (d.stocks && d.stocks.length > 0) {
                const top3 = d.stocks.slice(0, 3);
                const tickers = top3.map(s => s.ticker).join(', ');
                if (typeof _showSignalAlert === 'function') {
                    _showSignalAlert(`🌙 종가 매매 셋업 발견 — ${tickers}`, true, `${d.stocks.length}개 종목 · 장 마감 30분 전 확인`);
                }
                if (typeof _sigHistory !== 'undefined') {
                    _sigHistory.unshift({ ts: Date.now(), symbol: tickers, dir: 'buy',
                        headline: `🌙 종가 매매 — ${d.stocks.length}개 셋업`,
                        subText: `Top: ${top3.map(s=>`${s.ticker} $${s.entryPrice.toFixed(2)}`).join(' · ')}`, type: 'minervini_sepa' });
                    try { localStorage.setItem('stockai_sig_history', JSON.stringify(_sigHistory.slice(0,100))); } catch(e){}
                }
            }
        } catch(e) { warn('[minervini schedule]', e.message); }
    }

    function _setupMinerviniSchedule() {
        setInterval(() => {
            const now = new Date();
            const krH = new Date(now.getTime() + 9*60*60*1000).getUTCHours();
            const krM = new Date(now.getTime() + 9*60*60*1000).getUTCMinutes();
            if (krH === 4 && krM === 30) _runMinerviniAlert();
        }, 60000);
    }

    async function loadCatalyst(forceRefresh) {
        const listEl = document.getElementById('catalystList');
        if (!listEl) return;
        if (!_catalystData || forceRefresh) {
            listEl.innerHTML = '<div class="catalyst-loading">EDGAR 공시 스캔 중... (최대 10초)</div>';
        }
        try {
            const r = await fetch('/api/catalyst/hunter' + (forceRefresh ? '?t=' + Date.now() : ''));
            if (!r.ok) throw new Error('http ' + r.status);
            const d = await r.json();
            _catalystData = d;
            _renderCatalyst(d);
            const upd = document.getElementById('catalystUpdated');
            if (upd && d.scannedAt) {
                const dt = new Date(d.scannedAt);
                const hh = dt.getHours().toString().padStart(2,'0');
                const mm = dt.getMinutes().toString().padStart(2,'0');
                // 데이터 소스 배지 (v658)
                let srcBadge = '';
                if (d.dataSource === 'alpaca_realtime') srcBadge = `<span class="catalyst-src-badge realtime">🟢 실시간 (Alpaca)</span>`;
                else if (d.dataSource === 'mixed')       srcBadge = `<span class="catalyst-src-badge mixed">🟢 일부 실시간 (${d.realtimeCount}/${d.results.length})</span>`;
                else                                     srcBadge = `<span class="catalyst-src-badge delayed">🟡 15분 지연 (yfinance)</span>`;
                upd.innerHTML = `마지막 스캔 ${hh}:${mm} ${srcBadge} · 공시 ${d.totalFilings || 0}건 · 후보 ${d.results.length}건`;
            }
        } catch (e) {
            warn('[catalyst]', e);
            listEl.innerHTML = '<div class="catalyst-empty">EDGAR 공시 조회 실패 — 잠시 후 다시 시도하세요</div>';
        }
    }

    // Gemini AI 분석 카드 확장 영역 렌더 (v671)
    function _renderCatalystAiExpanded(ai) {
        if (!ai) return '';
        const fa = ai.filingAnalysis || {};
        const ra = ai.riskAnalysis || {};
        const verdictColor = fa.verdict === '호재' ? '#22c55e' : fa.verdict === '악재' ? '#ef4444' : '#94a3b8';
        const riskVerdictColor = ra.verdict === '안전' ? '#22c55e' : ra.verdict === '주의' ? '#eab308' : ra.verdict === '위험' ? '#f97316' : '#ef4444';
        const recColor = ra.recommendation === '진입가능' ? '#22c55e' : ra.recommendation === '관망' ? '#eab308' : '#ef4444';
        const sigOrder = ['shellCompanyRisk','vagueLanguage','priceAlreadyMoved','sizeMismatch','repeatedFilings','lateEntry','reversalRisk'];
        const sigLabels = {
            shellCompanyRisk: '회사 진위성',
            vagueLanguage: '공시 모호성',
            priceAlreadyMoved: '주가 선반영',
            sizeMismatch: '시총 대비 규모',
            repeatedFilings: '반복 공시',
            lateEntry: '늦은 진입',
            reversalRisk: '데드캣 반등 위험',
        };
        const sigsHtml = (ra.signals || {}) && sigOrder.map(k => {
            const v = (ra.signals || {})[k] ?? 0;
            const pct = Math.min(100, v * 10);
            const cls = v >= 7 ? 'sig-high' : v >= 4 ? 'sig-mid' : 'sig-low';
            return `<div class="cat-ai-sig">
                <span class="cat-ai-sig-label">${escHtml(sigLabels[k] || k)}</span>
                <div class="cat-ai-sig-bar"><div class="cat-ai-sig-fill ${cls}" style="width:${pct}%"></div></div>
                <span class="cat-ai-sig-val">${v}/10</span>
            </div>`;
        }).join('');
        const points = (fa.keyPoints || []).slice(0, 3).map(p => `<li>${escHtml(p)}</li>`).join('');
        const analyzedAgo = ai.analyzedAt ? `AI 분석 ${Math.max(1, Math.round((Date.now() - new Date(ai.analyzedAt).getTime()) / 60000))}분 전` : '';

        return `
        <div class="cat-ai-card">
            <div class="cat-ai-section">
                <div class="cat-ai-title">📄 AI 공시 분석</div>
                <div class="cat-ai-row"><span class="cat-ai-key">요약</span><span class="cat-ai-val">${escHtml(fa.summary || '-')}</span></div>
                <div class="cat-ai-row"><span class="cat-ai-key">판단</span><span class="cat-ai-pill" style="background:${verdictColor};color:#fff">${escHtml(fa.verdict || '?')}</span></div>
                <div class="cat-ai-row"><span class="cat-ai-key">영향</span><span class="cat-ai-val">${escHtml(fa.impactLevel || '?')} · ${escHtml(fa.timeHorizon || '?')}</span></div>
                <div class="cat-ai-row"><span class="cat-ai-key">섹터</span><span class="cat-ai-val">${escHtml(fa.sectorImplication || '-')}</span></div>
                ${points ? `<ul class="cat-ai-points">${points}</ul>` : ''}
            </div>
            <div class="cat-ai-section">
                <div class="cat-ai-title">⚠️ AI 리스크 평가 · 총 ${ra.totalRisk ?? '?'}/70</div>
                <div class="cat-ai-sigs">${sigsHtml || ''}</div>
                <div class="cat-ai-row"><span class="cat-ai-key">결론</span><span class="cat-ai-pill" style="background:${riskVerdictColor};color:#fff">${escHtml(ra.verdict || '?')}</span></div>
                <div class="cat-ai-row"><span class="cat-ai-key">권장</span><span class="cat-ai-pill" style="background:${recColor};color:#fff">${escHtml(ra.recommendation || '?')}</span> · ${escHtml(ra.entryTiming || '?')}</div>
                <div class="cat-ai-reasoning">${escHtml(ra.reasoning || '')}</div>
            </div>
            <div class="cat-ai-foot">${analyzedAgo}${ai._meta?.cached ? ' · 캐시 적중' : ''}</div>
        </div>`;
    }

    // AI 수동 분석 (사용자 [🤖 AI 심층 분석] 클릭) — v671
    async function _runCatalystAi(cardId, rawItem) {
        const expEl = document.getElementById(`${cardId}-ai`);
        const card = document.getElementById(cardId);
        if (!expEl) return;
        const btn = card?.querySelector('.catalyst-ai-btn');
        if (btn) { btn.disabled = true; btn.textContent = '🤖 AI 분석 중...'; }
        expEl.innerHTML = '<div class="cat-ai-loading">Gemini 분석 호출 중... (수초)</div>';
        try {
            const r = typeof rawItem === 'string' ? JSON.parse(rawItem) : rawItem;
            const body = {
                ticker: r.ticker,
                formType: r.filing?.formType,
                title: r.filing?.title,
                filingText: r.filing?.title,
                filedAt: r.filing?.updated,
                marketData: {
                    marketCap: r.marketCap,
                    price: r.price,
                    priceChange24h: r.changePct,
                    volumeRatio: r.volRatio,
                    shortFloat: r.shortFloatPct,
                    recentFilingsCount30d: 0,
                },
            };
            const res = await fetch('/api/catalyst/ai-analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error('http ' + res.status);
            const ai = await res.json();
            if (!ai || ai.error) throw new Error(ai.error || 'AI 분석 실패');
            // 결과를 카드에 주입
            expEl.innerHTML = _renderCatalystAiExpanded(ai);
            if (btn) btn.remove();
            // 메모리 데이터 갱신 → 다음 렌더 시 유지
            if (_catalystData && Array.isArray(_catalystData.results)) {
                const found = _catalystData.results.find(x => x.ticker === r.ticker);
                if (found) found.ai = ai;
            }
        } catch (e) {
            expEl.innerHTML = `<div class="cat-ai-loading" style="color:#ef4444">AI 분석 실패: ${escHtml(e.message || '오류')}</div>`;
            if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 심층 분석 (재시도)'; }
        }
    }

    function _renderCatalyst(d) {
        const el = document.getElementById('catalystList');
        const warnEl = document.getElementById('catalystAccWarn');
        if (!el) return;

        // 필터별 카운트 (v670)
        const allRes = (d && Array.isArray(d.results)) ? d.results : [];
        const accRes = (d && Array.isArray(d.accumulation)) ? d.accumulation : [];
        const _setCnt = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = n; };
        _setCnt('cfCntAll',    allRes.length);
        _setCnt('cfCntUrgent', allRes.filter(r => r.score >= 75).length);
        _setCnt('cfCntStrong', allRes.filter(r => r.score >= 55 && r.score < 75).length);
        _setCnt('cfCntWatch',  allRes.filter(r => r.score >= 35 && r.score < 55).length);
        _setCnt('cfCntAcc',    accRes.length);

        const isAcc = _catalystFilter === 'accumulation';
        if (warnEl) warnEl.style.display = isAcc ? '' : 'none';

        // 매집 의심 탭: d.accumulation 배열을 별도 렌더
        if (isAcc) {
            const accItems = (d && Array.isArray(d.accumulation)) ? d.accumulation : [];
            if (!accItems.length) {
                el.innerHTML = '<div class="catalyst-empty">현재 감지된 매집 의심 종목 없음 — 5분 후 재시도</div>';
                return;
            }
            const _fmtP = p => '$' + (p >= 10 ? p.toFixed(2) : p.toFixed(3));
            const _fmtMc = v => v >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v}`;
            el.innerHTML = accItems.map((r, idx) => {
                const s = r.strategy || {};
                return `
                <div class="catalyst-card catalyst-card--acc" onclick="quickSearch('${r.ticker}','US')">
                    <div class="catalyst-card-head">
                        <div class="catalyst-rank">${idx + 1}</div>
                        <div class="catalyst-id">
                            <div class="catalyst-sym">${escHtml(r.ticker)} <span class="catalyst-tag catalyst-tag--acc">🕵️ 매집 의심</span></div>
                            <div class="catalyst-name">${escHtml((r.name || '').slice(0, 30))}</div>
                        </div>
                        <div class="catalyst-grade" style="background:${r.gradeColor};color:#fff">${escHtml(r.grade)} · ${r.score}</div>
                    </div>
                    <div class="catalyst-title">${escHtml(r.reason || '')}</div>
                    <div class="catalyst-meta-row">
                        <span class="catalyst-meta-cell">💰 ${_fmtP(r.price)}</span>
                        <span class="catalyst-meta-cell">🏢 ${_fmtMc(r.marketCap)}</span>
                        <span class="catalyst-meta-cell">📊 5d/15d ×${r.volRatio5to15.toFixed(2)}</span>
                        <span class="catalyst-meta-cell">📉 5일 변동 ${r.range5dPct.toFixed(1)}%</span>
                        ${r.shortFloatPct ? `<span class="catalyst-meta-cell">🩳 숏Float ${r.shortFloatPct.toFixed(1)}%</span>` : ''}
                    </div>
                    <div class="catalyst-strategy">
                        <span class="cs-cell entry">진입 ${_fmtP(s.entry)}</span>
                        <span class="cs-cell stop">손절 ${_fmtP(s.stop)}</span>
                        <span class="cs-cell tp">익절1 ${_fmtP(s.tp1)}</span>
                        <span class="cs-cell tp">익절2 ${_fmtP(s.tp2)}</span>
                    </div>
                </div>`;
            }).join('');
            return;
        }

        // 기본 카탈리스트 탭
        if (!d || !Array.isArray(d.results) || !d.results.length) {
            el.innerHTML = '<div class="catalyst-empty">현재 감지된 카탈리스트 종목 없음 — 다음 EDGAR 스캔 대기 (5분)</div>';
            return;
        }
        let items = d.results;
        if (_catalystFilter === 'urgent') items = items.filter(r => r.score >= 75);
        else if (_catalystFilter === 'strong') items = items.filter(r => r.score >= 55 && r.score < 75);
        else if (_catalystFilter === 'watch') items = items.filter(r => r.score >= 35 && r.score < 55);

        if (!items.length) {
            el.innerHTML = '<div class="catalyst-empty">선택한 필터에 해당하는 종목이 없습니다</div>';
            return;
        }

        const _ago = iso => {
            if (!iso) return '-';
            const diff = (Date.now() - new Date(iso).getTime()) / 60000;
            if (diff < 60) return `${Math.round(diff)}분 전`;
            if (diff < 1440) return `${Math.round(diff / 60)}시간 전`;
            return `${Math.round(diff / 1440)}일 전`;
        };
        const _fmtP = p => '$' + (p >= 10 ? p.toFixed(2) : p.toFixed(3));
        const _fmtMc = v => v >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v}`;

        // AI 분석 결과 있는 S급 + 저위험 종목 상단 고정 (v671)
        items = items.slice().sort((a, b) => {
            const aPri = (a.ai?.filingAnalysis?.catalystGrade === 'S' && (a.ai?.riskAnalysis?.totalRisk ?? 99) < 30) ? 1 : 0;
            const bPri = (b.ai?.filingAnalysis?.catalystGrade === 'S' && (b.ai?.riskAnalysis?.totalRisk ?? 99) < 30) ? 1 : 0;
            if (aPri !== bPri) return bPri - aPri;
            return (b.score || 0) - (a.score || 0);
        });

        const cardsHtml = items.map((r, idx) => {
            const f = r.filing || {};
            const s = r.strategy || {};
            const ai = r.ai || null;
            const fa = ai?.filingAnalysis || null;
            const ra = ai?.riskAnalysis || null;
            const fresh = f.updated && (Date.now() - new Date(f.updated).getTime()) < 3600 * 1000;
            const tagsHtml = (f.keywordTags || []).slice(0,3).map(t => `<span class="catalyst-tag">${escHtml(t)}</span>`).join('');
            // v693 — 바닥 턴어라운드 호재 태그 + D-3 실적발표 경고 배지
            const turnTag = r.turnaroundCatalyst ? `<span class="catalyst-tag catalyst-tag--turn">📉➡️📈 바닥 턴어라운드 호재</span>` : '';
            const earnWarnHtml = r.earningsWarning ? `<div class="catalyst-earn-warn">⚠️ D-${r.earningsDaysAway ?? 3} 실적발표 임박 — 정규 실적이 변수로 작용할 수 있음</div>` : '';

            // AI 자동 분석 결과 (v671)
            const highRisk = (ra?.totalRisk ?? 0) >= 50;
            const isTopPri = fa?.catalystGrade === 'S' && (ra?.totalRisk ?? 99) < 30;
            const verdictColor = fa?.verdict === '호재' ? '#22c55e' : fa?.verdict === '악재' ? '#ef4444' : '#94a3b8';
            const gradeColors = { S: '#ef4444', A: '#f97316', B: '#eab308', C: '#94a3b8' };
            const aiBadgeHtml = fa ? `
                <div class="catalyst-ai-badge" style="border-color:${gradeColors[fa.catalystGrade] || '#94a3b8'}">
                    🤖 AI:
                    <span style="color:${verdictColor};font-weight:700">${escHtml(fa.verdict || '?')}</span>
                    · <span style="color:${gradeColors[fa.catalystGrade] || '#94a3b8'};font-weight:700">${escHtml(fa.catalystGrade || '?')}급</span>
                    · ${escHtml(fa.impactLevel || '?')}
                </div>` : '';
            const topPriBadge = isTopPri ? '<span class="catalyst-priority">🔥 최고 우선순위</span>' : '';
            const highRiskBanner = highRisk ? `
                <div class="catalyst-risk-banner">🚨 ${ra?.dilutionRisk ? 'AI가 <b>주주가치 희석(독성 자금조달)</b> 위험 감지' : 'AI가 위험 신호 감지'} — 진입 비권장 (위험도 ${ra.totalRisk}/70)</div>` : '';

            // AI 확장 영역 (자동 분석 있으면 상시 펼침, 없으면 수동 버튼)
            const cardId = `ccard-${r.ticker}-${idx}`;
            const expandedAi = ai ? _renderCatalystAiExpanded(ai) : '';
            // 하단 단일 액션 — AI 심층 분석 버튼 (자동 분석 결과 없을 때만; EDGAR 원문 링크 대체)
            const aiBtn = !ai ? `
                <button class="catalyst-ai-btn" onclick="event.stopPropagation(); _runCatalystAi('${cardId}', ${JSON.stringify(r).replace(/"/g, '&quot;')})">🤖 AI 심층 분석</button>` : '';

            // 위험도 50+ 종목은 매매 라인 숨김
            const stratHtml = highRisk ? '' : `
                <div class="catalyst-strategy">
                    <span class="cs-cell entry">진입 ${_fmtP(s.entry)}</span>
                    <span class="cs-cell stop">손절 ${_fmtP(s.stop)}</span>
                    <span class="cs-cell tp">익절1 ${_fmtP(s.tp1)}</span>
                    <span class="cs-cell tp">익절2 ${_fmtP(s.tp2)}</span>
                </div>`;

            const cardCls = [
                'catalyst-card',
                fresh ? 'catalyst-card--fresh' : '',
                isTopPri ? 'catalyst-card--top' : '',
                fa?.verdict === '악재' ? 'catalyst-card--bear' : '',
            ].filter(Boolean).join(' ');

            return `
            <div id="${cardId}" class="${cardCls}" onclick="quickSearch('${r.ticker}','US')">
                ${highRiskBanner}
                <div class="catalyst-card-head">
                    <div class="catalyst-rank">${idx + 1}</div>
                    <div class="catalyst-id">
                        <div class="catalyst-sym">${escHtml(r.ticker)} <span class="catalyst-form">${escHtml(f.formType || '')}</span> ${r.dataSource === 'alpaca_realtime' ? '<span class="catalyst-rt-dot" title="Alpaca 실시간">🟢</span>' : '<span class="catalyst-rt-dot delayed" title="yfinance 15분 지연">🟡</span>'} ${topPriBadge}</div>
                        <div class="catalyst-name">${escHtml((r.name || '').slice(0, 30))}</div>
                    </div>
                    <div class="catalyst-grade" style="background:${r.gradeColor};color:#fff">${escHtml(r.grade)} · ${r.score}</div>
                </div>
                <div class="catalyst-title">${escHtml((f.title || '').slice(0, 100))}</div>
                ${earnWarnHtml}
                ${aiBadgeHtml}
                <div class="catalyst-tags">${turnTag}${tagsHtml}</div>
                <div class="catalyst-meta-row">
                    <span class="catalyst-meta-cell">⏰ ${_ago(f.updated)}</span>
                    <span class="catalyst-meta-cell">💰 ${_fmtP(r.price)}</span>
                    <span class="catalyst-meta-cell">🏢 ${_fmtMc(r.marketCap)}</span>
                    ${r.turnoverRatio != null
                        ? `<span class="catalyst-meta-cell">🔄 회전율 ${(r.turnoverRatio * 100).toFixed(0)}%</span>`
                        : `<span class="catalyst-meta-cell">📊 거래량 ×${r.volRatio.toFixed(1)}</span>`}
                    ${r.rsi != null ? `<span class="catalyst-meta-cell">📐 RSI ${r.rsi}</span>` : ''}
                    ${r.shortFloatPct ? `<span class="catalyst-meta-cell">🩳 숏Float ${r.shortFloatPct.toFixed(1)}%</span>` : ''}
                    ${r.preGapPct != null ? `<span class="catalyst-meta-cell ${r.preGapPct >= 0 ? 'up':'down'}">🌅 프리 ${r.preGapPct >= 0 ? '+':''}${r.preGapPct.toFixed(1)}%</span>` : ''}
                </div>
                ${stratHtml}
                <div class="catalyst-ai-expanded" id="${cardId}-ai">${expandedAi}</div>
                ${aiBtn}
            </div>`;
        }).join('');

        // 푸터: 제외된 종목 통계 (v666)
        const ex = d._exclusion;
        const exFooter = ex ? `<div class="catalyst-footer">✅ OTC ${ex.otc||0} · SPAC ${ex.spac||0} · 상장폐지·정지 ${(ex.delisted||0)+(ex.halted||0)+(ex.badExchange||0)} · 추격(+10%↑) ${ex.alreadyMoved||0} 자동 제외됨</div>` : '';
        el.innerHTML = cardsHtml + exFooter;
    }


    // ═══════════════════════════════════════════════════════════
    // OVERSOLD & DEEP VALUE RADAR — JS
    // ═══════════════════════════════════════════════════════════
    let _radarTab    = 'oversold';
    let _radarItems  = [];
    let _radarPage   = 0;
    const RADAR_PAGE_SIZE = 10;

    // ── 시장 컨텍스트 바 업데이트 (loadMarketThermometer 데이터 재활용) ──
    function updateMktCtx() {
        const map = window._thermoBySymbol || {};
        if (!Object.keys(map).length) return;

        function fillCard(cardId, sym) {
            const t = map[sym];
            if (!t) return;
            const card = document.getElementById(cardId);
            if (!card) return;
            const price = t.regularMarketPrice;
            const chgPct = t.regularMarketChangePercent;
            const isUp = (t.regularMarketChange || 0) >= 0;
            card.querySelector('.mkt-ctx-price').textContent = typeof price === 'number'
                ? (price > 1000 ? price.toLocaleString('en-US',{maximumFractionDigits:0})
                : price.toFixed(2)) : '—';
            const chgEl = card.querySelector('.mkt-ctx-chg');
            const sign = isUp ? '+' : '';
            chgEl.textContent = `${sign}${(chgPct||0).toFixed(2)}%`;
            chgEl.className = `mkt-ctx-chg mono ${isUp ? 'up' : 'down'}`;
        }

        fillCard('mktCtxSP500', '^GSPC');
        fillCard('mktCtxNasd',  '^IXIC');
        fillCard('mktCtxVix',   '^VIX');

        // 시장 온도 (VIX 기반: VIX<15=탐욕, >30=공포)
        const vix = map['^VIX'];
        if (vix) {
            const v = vix.regularMarketPrice || 20;
            // VIX 10~40 → fill 100~0% (역방향: 높을수록 공포=왼쪽)
            const pct = Math.max(5, Math.min(95, 100 - ((v - 10) / 30) * 100));
            const fill = document.getElementById('mktSignalFill');
            if (fill) fill.style.width = pct + '%';
            // 시그널 텍스트
            const label = document.getElementById('mktSignalLabel');
            if (label) label.textContent = v < 16 ? '탐욕' : v < 24 ? '중립' : v < 32 ? '불안' : '공포';
        }
    }

    // ── 스파크라인 SVG 생성 ──
    function drawRadarSpark(closes, ma200, w=52, h=26) {
        if (!closes || closes.length < 3) return `<svg width="${w}" height="${h}"></svg>`;
        const valid = closes.filter(v => v != null && isFinite(v));
        if (valid.length < 3) return `<svg width="${w}" height="${h}"></svg>`;
        const min = Math.min(...valid);
        const max = Math.max(...valid);
        const range = max - min || 1;
        const pad = 1;
        const toX = (i) => pad + (i / (valid.length - 1)) * (w - 2 * pad);
        const toY = (v) => h - pad - ((v - min) / range) * (h - 2 * pad);

        const pts = valid.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
        const last = valid[valid.length - 1];
        const first = valid[0];
        const isDown = last < first;
        const stroke = isDown ? '#64D2FF' : '#0CF5B0'; // oversold=cyan, up=green

        let maLine = '';
        if (ma200 != null && isFinite(ma200)) {
            const maY = toY(ma200).toFixed(1);
            if (maY >= 0 && maY <= h) {
                maLine = `<line x1="${pad}" y1="${maY}" x2="${w-pad}" y2="${maY}" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="2,2"/>`;
            }
        }

        // Gradient fill under line
        const fillPts = `${pad},${h} ${pts} ${toX(valid.length-1).toFixed(1)},${h}`;
        const gradId = 'sg' + Math.random().toString(36).slice(2,6);

        return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
            <defs>
                <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${stroke}" stop-opacity="0.18"/>
                    <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
                </linearGradient>
            </defs>
            ${maLine}
            <polygon points="${fillPts}" fill="url(#${gradId})"/>
            <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }

    // ── 마켓 컨텍스트 스파크 그리기 (loadMarketThermometer spark data 활용) ──
    function drawMktSpark(svgId, sym) {
        const sp = (window._thermoSparkMap || {})[sym];
        if (!sp || sp.length < 3) return;
        const svg = document.getElementById(svgId);
        if (!svg) return;
        const w = 80, h = 28;
        const valid = sp.filter(v => v != null && isFinite(v));
        if (valid.length < 3) return;
        const min = Math.min(...valid), max = Math.max(...valid), range = max - min || 1;
        const pts = valid.map((v, i) => {
            const x = (i / (valid.length - 1)) * w;
            const y = h - ((v - min) / range) * h;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        const isDown = valid[valid.length-1] < valid[0];
        const stroke = isDown ? '#64D2FF' : '#0CF5B0';
        svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    // ── 로고 HTML ──
    function _sniperLogo(sym) {
        const url = `https://assets.parqet.com/logos/symbol/${sym}?format=svg`;
        return `<div class="sniper-logo">
            <img src="${url}" alt="${sym}" onerror="this.parentElement.textContent='${sym.slice(0,2)}'">
        </div>`;
    }

    // ── 스나이퍼 아이템 HTML (top100-row 레이아웃) ──
    // 레이더 종목 추천 이유 1줄 요약 — 룰 기반 동적 생성 (null-safe)
    function _buildSniperReason(item, tab) {
        const r = [];
        const rsi = (typeof item.rsi === 'number') ? item.rsi : null;
        const vol = (typeof item.volMult === 'number') ? item.volMult : null;
        const chg = (typeof item.changePct === 'number') ? item.changePct : 0;
        const per = (typeof item.per === 'number') ? item.per : null;
        const pbr = (typeof item.pbr === 'number') ? item.pbr : null;
        const rr  = (typeof item.rr === 'number') ? item.rr : null;
        const score = (typeof item.score === 'number') ? item.score : null;

        if (tab === 'oversold') {
            if (rsi != null && rsi <= 30) r.push(`RSI ${rsi} 극심한 과매도`);
            else if (rsi != null && rsi <= 35) r.push(`RSI ${rsi} 과매도 진입`);
            if (item.ma200 && item.price && item.price < item.ma200 * 0.85) r.push('200일선 -15% 이격');
            else if (item.ma200 && item.price && item.price < item.ma200) r.push('200일선 하회');
            if (vol != null && vol >= 2) r.push(`거래량 ×${vol.toFixed(1)} 급증`);
            if (chg <= -5) r.push(`당일 ${chg.toFixed(1)}% 급락`);
        } else if (tab === 'value') {
            if (per != null && per > 0 && per < 10) r.push(`PER ${per.toFixed(1)} 저평가`);
            if (pbr != null && pbr < 1) r.push(`PBR ${pbr.toFixed(2)} 자산가치 이하`);
            if (rsi != null && rsi <= 40) r.push(`RSI ${rsi} 매수권`);
        } else if (tab === 'swing') {
            if (rr != null) r.push(`R/R ${rr.toFixed(1)}:1 우수한 손익비`);
            if (rsi != null && rsi <= 40) r.push(`RSI ${rsi} 매수권`);
            if (vol != null && vol >= 1.5) r.push(`거래량 ×${vol.toFixed(1)} 증가`);
        } else if (tab === 'bounce') {
            if (score != null) r.push(`반등 시그널 ${score}/6 충족`);
            if (rsi != null && rsi <= 32) r.push(`RSI ${rsi} 과매도`);
            if (chg <= -5) r.push(`당일 ${chg.toFixed(1)}% 급락 후 반등 가능성`);
        }

        if (!r.length) {
            if (rsi != null) r.push(`RSI ${rsi}`);
            if (vol != null && vol >= 1.5) r.push(`거래량 ×${vol.toFixed(1)}`);
        }
        return r.length ? r.join(', ') : '주요 시그널 포착';
    }

    function _renderSniperItem(item, tab) {
        const chg = item.changePct || 0;
        const isUp = chg > 0, isDown = chg < 0;
        const chgClass = isUp ? 'up' : isDown ? 'down' : 'flat';
        const sign = isUp ? '+' : '';

        // 가격 포맷
        const price = item.price || 0;
        const priceFmt = price >= 10 ? price.toFixed(2) : price.toFixed(3);
        const curr = item.currency === 'KRW' ? '₩' : '$';

        // 로고 — tlogo-wrap + 국기 플래그 (top100 동일 구조)
        const logoUrl = `https://assets.parqet.com/logos/symbol/${item.symbol}?format=svg`;
        const fb2 = item.symbol.slice(0,2);
        const logoHtml = `<div class="tlogo-wrap">
            <img class="tlogo" src="${logoUrl}" alt="${item.symbol}" loading="lazy"
                onerror="this.outerHTML='<span class=\\'tlogo tlogo-fb\\'>${fb2}</span>'">
            <span class="tlogo-flag">🇺🇸</span>
        </div>`;

        // 배지
        let badges = '';
        if (tab !== 'leverage') {
            if (item.rsi != null && item.rsi < 35)
                badges += `<span class="sniper-badge sniper-badge--rsi">RSI ${item.rsi}</span>`;
            if (item.volMult != null && item.volMult >= 2)
                badges += `<span class="sniper-badge sniper-badge--vol">Vol ×${item.volMult.toFixed(1)}</span>`;
            if (tab === 'value') {
                if (item.per != null)
                    badges += `<span class="sniper-badge sniper-badge--per">PER ${item.per.toFixed(1)}</span>`;
                if (item.pbr != null && item.pbr < 1)
                    badges += `<span class="sniper-badge sniper-badge--pbr">PBR ${item.pbr.toFixed(2)}</span>`;
            }
        } else {
            if (item.per != null)
                badges += `<span class="sniper-badge sniper-badge--per">PER ${item.per.toFixed(1)}</span>`;
        }
        if (!badges) badges = `<span style="opacity:.3;font-size:10px;color:var(--text3)">—</span>`;

        // 추천 이유 — 1줄 요약 (탭별 + 시그널별 동적 생성)
        const reasonText = _buildSniperReason(item, tab);

        // 펀더멘털 (가격 아래 보조)
        let fundHtml = '';
        if (tab !== 'leverage' && (item.per != null || item.pbr != null)) {
            const perStr = item.per != null ? `PER ${item.per.toFixed(1)}` : '';
            const pbrNum = item.pbr != null ? item.pbr.toFixed(2) : '';
            const pbrStr = pbrNum
                ? (parseFloat(pbrNum) < 1
                    ? `PBR <span class="pbr-hi">${pbrNum}</span>`
                    : `PBR ${pbrNum}`)
                : '';
            const parts = [perStr, pbrStr].filter(Boolean).join(' · ');
            if (parts) fundHtml = `<div class="sniper-fund">${parts}</div>`;
        }

        return `<div class="sniper-item" onclick="quickSearch('${item.symbol}','US')">
            ${logoHtml}
            <div class="sniper-info">
                <div class="sniper-ticker">${item.symbol}</div>
                <div class="sniper-name">${item.name || ''}</div>
            </div>
            <div class="sniper-badges">${badges}</div>
            <div class="sniper-reason-text" title="${reasonText.replace(/"/g,'&quot;')}">${reasonText}</div>
            <div class="sniper-price-wrap">
                <div class="sniper-price">${curr}${priceFmt}</div>
                <div class="sniper-chg ${chgClass}">${sign}${chg.toFixed(2)}%</div>
                ${fundHtml}
            </div>
        </div>`;
    }

    // ── 탭 전환 ──
    function switchRadarTab(tab) {
        _radarTab = tab;
        _radarPage = 0;
        const sel = document.getElementById('radarTabSelect');
        if (sel && sel.value !== tab) sel.value = tab;
        document.querySelectorAll('.radar-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
        });

        const list = document.getElementById('sniperList');
        if (list) list.innerHTML = '<div class="sniper-loading">' + Array(5).fill('<div class="sniper-skel"></div>').join('') + '</div>';

        if (tab === 'swing') {
            _renderSwingInRadar();
        } else if (tab === 'bounce') {
            _renderBouncePage();
        } else {
            _fetchRadar(tab);
        }
    }

    // ── 연속 상승세 탭: /api/discover?preset=streak_up 렌더 ──
    async function _renderStreakInRadar() {
        const list = document.getElementById('sniperList');
        const moreBtn = document.getElementById('radarMoreBtn');
        if (!list) return;
        if (moreBtn) moreBtn.style.display = 'none';

        // 1) LS 캐시 우선 렌더
        const cached = (typeof _discLoadLS === 'function') ? _discLoadLS('streak_up') : null;
        if (cached?.length) {
            list.innerHTML = cached.slice(0, 20).map(q => _renderSniperStreakItem(q)).join('');
        }

        // 2) 최신 데이터 fetch
        try {
            const res = await fetch('/api/discover?preset=streak_up');
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            if (typeof _discSaveLS === 'function') _discSaveLS('streak_up', items);
            if (!items.length) {
                list.innerHTML = '<div class="sniper-empty">상승 모멘텀 종목이 오늘은 없어요</div>';
                return;
            }
            if (_radarTab === 'streak') {
                list.innerHTML = items.slice(0, 20).map(q => _renderSniperStreakItem(q)).join('');
            }
        } catch (e) {
            if (!cached?.length) {
                list.innerHTML = '<div class="sniper-empty">데이터 로드 실패 — 잠시 후 다시 시도하세요</div>';
            }
        }
    }

    function _renderSniperStreakItem(q) {
        const sym = q.symbol || '';
        const chg = q.changePct || 0;
        const isUp = chg > 0, isDown = chg < 0;
        const chgClass = isUp ? 'up' : isDown ? 'down' : 'flat';
        const sign = isUp ? '+' : '';
        const price = q.price || 0;
        const priceFmt = price >= 10 ? price.toFixed(2) : price.toFixed(3);

        const fb2 = sym.slice(0, 2);
        const logoUrl = `https://assets.parqet.com/logos/symbol/${sym}?format=svg`;
        const logoHtml = `<div class="tlogo-wrap">
            <img class="tlogo" src="${logoUrl}" alt="${sym}" loading="lazy"
                onerror="this.outerHTML='<span class=\\'tlogo tlogo-fb\\'>${fb2}</span>'">
            <span class="tlogo-flag">🇺🇸</span>
        </div>`;

        const km = q.keyMetric || {};
        const kmVal = km.value || (chg >= 0 ? `+${chg.toFixed(2)}%` : `${chg.toFixed(2)}%`);
        const badges = `<span class="sniper-badge sniper-badge--streak">${kmVal}</span>`;
        const safe = sym.replace(/'/g, "\\'");

        return `<div class="sniper-item" onclick="quickSearch('${safe}','US')">
            ${logoHtml}
            <div class="sniper-info">
                <div class="sniper-ticker">${escHtml(sym)}</div>
                <div class="sniper-name">${escHtml(q.name || sym)}</div>
            </div>
            <div class="sniper-badges">${badges}</div>
            <div class="sniper-spark"><svg width="52" height="26"></svg></div>
            <div class="sniper-price-wrap">
                <div class="sniper-price">$${priceFmt}</div>
                <div class="sniper-chg ${chgClass}">${sign}${chg.toFixed(2)}%</div>
            </div>
        </div>`;
    }

    // ── 급등 스캐너 탭: /api/discover?preset=vol_surge 렌더 ──────────
    async function _renderSurgeInRadar() {
        const list = document.getElementById('sniperList');
        const moreBtn = document.getElementById('radarMoreBtn');
        if (!list) return;
        if (moreBtn) moreBtn.style.display = 'none';
        list.innerHTML = '<div class="sniper-skel"></div>'.repeat(6);
        try {
            const res = await fetch('/api/discover?preset=vol_surge');
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            if (!items.length) {
                list.innerHTML = '<div class="sniper-empty">거래량 급증 종목이 오늘은 없어요</div>';
                return;
            }
            if (_radarTab === 'surge') {
                list.innerHTML = items.slice(0, 20).map(q => _renderSniperSurgeItem(q)).join('');
            }
        } catch(e) {
            list.innerHTML = '<div class="sniper-empty">데이터 로드 실패 — 잠시 후 다시 시도하세요</div>';
        }
    }

    function _renderSniperSurgeItem(q) {
        const sym = q.symbol || '';
        const chg = q.changePct || 0;
        const isUp = chg > 0, isDown = chg < 0;
        const chgClass = isUp ? 'up' : isDown ? 'down' : 'flat';
        const sign = isUp ? '+' : '';
        const price = q.price || 0;
        const priceFmt = price >= 10 ? price.toFixed(2) : price.toFixed(3);
        const logoUrl = `https://assets.parqet.com/logos/symbol/${sym}?format=svg`;
        const fb2 = sym.slice(0, 2);
        const logoHtml = `<div class="tlogo-wrap">
            <img class="tlogo" src="${logoUrl}" alt="${sym}" loading="lazy"
                onerror="this.outerHTML='<span class=\\'tlogo tlogo-fb\\'>${fb2}</span>'">
            <span class="tlogo-flag">🇺🇸</span>
        </div>`;
        const km = q.keyMetric || {};
        const multBadge = km.value ? `<span class="sniper-badge sniper-badge--surge">${km.value}</span>` : '';
        const chgBadge = `<span class="sniper-badge sniper-badge--${isUp ? 'up' : 'dn'}">${sign}${chg.toFixed(2)}%</span>`;
        const safe = sym.replace(/'/g, "\\'");
        return `<div class="sniper-item" onclick="quickSearch('${safe}','US')">
            ${logoHtml}
            <div class="sniper-info">
                <div class="sniper-ticker">${escHtml(sym)}</div>
                <div class="sniper-name">${escHtml(q.name || sym)}</div>
            </div>
            <div class="sniper-badges">${multBadge}${chgBadge}</div>
            <div class="sniper-spark"><svg width="52" height="26"></svg></div>
            <div class="sniper-price-wrap">
                <div class="sniper-price">$${priceFmt}</div>
                <div class="sniper-chg ${chgClass}">${sign}${chg.toFixed(2)}%</div>
            </div>
        </div>`;
    }

    // ── 스윙 R/R 탭: top100Cache 데이터를 스나이퍼 형식으로 렌더 ──
    function _renderSwingInRadar() {
        const items = top100Cache['day_gainers']?.items;
        const list = document.getElementById('sniperList');
        const moreBtn = document.getElementById('radarMoreBtn');
        const ts = document.getElementById('radarTs');
        if (!list) return;

        if (!items?.length) {
            list.innerHTML = '<div class="sniper-empty">데이터 로딩 중… 잠시 후 다시 시도하세요</div>';
            if (moreBtn) moreBtn.style.display = 'none';
            if (ts) ts.textContent = '';
            return;
        }

        const qualified = items.map(q => {
            const p = q.regularMarketPrice, h = q.fiftyTwoWeekHigh;
            if (!p || !h || h <= p) return null;
            const rr = (h - p) / (p * 0.05);
            return rr >= 1.5 ? {...q, _rr: rr} : null;
        }).filter(Boolean).sort((a, b) => b._rr - a._rr);

        if (!qualified.length) {
            list.innerHTML = '<div class="sniper-empty">현재 R/R ≥ 1.5 조건 종목 없음</div>';
            if (moreBtn) moreBtn.style.display = 'none';
            if (ts) ts.textContent = '';
            return;
        }

        list.innerHTML = qualified.map(q => _renderSniperSwingItem(q)).join('');
        if (moreBtn) moreBtn.style.display = 'none';
        if (ts) ts.textContent = `${qualified.length}개 종목 · R/R ≥ 1.5`;
    }

    function _renderSniperSwingItem(q) {
        const chg = q.regularMarketChangePercent || 0;
        const isUp = chg > 0, isDown = chg < 0;
        const chgClass = isUp ? 'up' : isDown ? 'down' : 'flat';
        const sign = isUp ? '+' : '';
        const price = q.regularMarketPrice || 0;
        const priceFmt = price >= 10 ? price.toFixed(2) : price.toFixed(3);

        const sym = q.symbol || '';
        const fb2 = sym.slice(0, 2);
        const logoUrl = `https://assets.parqet.com/logos/symbol/${sym}?format=svg`;
        const logoHtml = `<div class="tlogo-wrap">
            <img class="tlogo" src="${logoUrl}" alt="${sym}" loading="lazy"
                onerror="this.outerHTML='<span class=\\'tlogo tlogo-fb\\'>${fb2}</span>'">
            <span class="tlogo-flag">🇺🇸</span>
        </div>`;

        const rrCls = q._rr >= 3 ? 'excellent' : q._rr >= 2 ? 'good' : 'ok';
        const badges = `<span class="sniper-badge sniper-badge--rr ${rrCls}">1:${q._rr.toFixed(1)}</span>`;
        const safe = sym.replace(/'/g, "\\'");

        return `<div class="sniper-item" onclick="quickSearch('${safe}','US')">
            ${logoHtml}
            <div class="sniper-info">
                <div class="sniper-ticker">${escHtml(sym)}</div>
                <div class="sniper-name">${escHtml(q.shortName || sym)}</div>
            </div>
            <div class="sniper-badges">${badges}</div>
            <div class="sniper-spark"><svg width="52" height="26"></svg></div>
            <div class="sniper-price-wrap">
                <div class="sniper-price">$${priceFmt}</div>
                <div class="sniper-chg ${chgClass}">${sign}${chg.toFixed(2)}%</div>
            </div>
        </div>`;
    }

    // ── 반등 스캐너 ─────────────────────────────────────────────────────

    // 6개 신호 중 몇 개인지 계산
    // 누가 봐도 과매도 — 교과서적 과매도 신호 (v653)
    //   기존 "2개 이상 시그널 충족"의 다중 검증 모델 → "주요 과매도 조건 1개만 만족하면 노출"로 단순화
    // 과매도 점수 시그널 — 각 시그널에 pts(가중치) 부여 (v691 #3, 최대 13점)
    function _calcBounceScore(item) {
        const signals = [];
        const { rsi, price, ma200, ma50, volMult, changePct, pbr, high52, low52, spark, dayHigh, dayLow, dayClose } = item;
        // 1. RSI 과매도 (≤35) — 단기 패닉
        if (rsi != null && rsi <= 35) {
            signals.push({ label: 'RSI 과매도', detail: `RSI ${rsi.toFixed(0)}`, pts: 2 });
            // 극심한 과매도 (≤30) — 추가 가산점
            if (rsi <= 30) signals.push({ label: '극심한 과매도', detail: `RSI ${rsi.toFixed(0)}`, pts: 1 });
        }
        // 2. 200일 이동평균 대비 -15% 이상 이격 (장기 추세선 대비 깊은 하락)
        if (price && ma200 && ma200 > 0 && price < ma200 * 0.85) {
            signals.push({ label: 'MA200 이격', detail: `-${(((ma200 - price) / ma200) * 100).toFixed(0)}%`, pts: 2 });
        }
        // 3. 52주 고점 대비 -35% 이상 폭락
        if (price && high52 && high52 > 0 && price < high52 * 0.65) {
            signals.push({ label: '52주 -35%↓', detail: `-${(((high52 - price) / high52) * 100).toFixed(0)}%`, pts: 2 });
        }
        // 보조 시그널
        if (changePct != null && changePct <= -5) signals.push({ label: '당일 급락', detail: `${changePct.toFixed(1)}%`, pts: 1 });
        if (volMult != null && volMult >= 1.5) signals.push({ label: '거래량 급증', detail: `×${volMult.toFixed(1)}`, pts: 1 });
        if (pbr != null && pbr > 0 && pbr < 2.0) signals.push({ label: 'PBR 저평가', detail: `PBR ${pbr.toFixed(2)}`, pts: 1 });
        // ── 스마트머니 캔들 시그널 (v691 #3) — 바닥 매집 흔적 ──
        // Signal 1 — 해머/아랫꼬리: 최근 일봉의 아랫꼬리가 캔들 전체 길이의 40% 초과 → +2
        if (dayHigh != null && dayLow != null && dayClose != null && dayHigh > dayLow) {
            const wickRatio = (dayClose - dayLow) / (dayHigh - dayLow);
            if (wickRatio > 0.4) {
                signals.push({ label: '🔨 해머/아랫꼬리', detail: `꼬리 ${(wickRatio * 100).toFixed(0)}%`, pts: 2 });
            }
        }
        // Signal 2 — 볼린저 하단 이탈: 당일 저가가 하단 밴드(20,2) 아래 → +1
        if (dayLow != null && Array.isArray(spark) && spark.length >= 20) {
            try {
                const bb = calcBollingerBands(spark, 20, 2);
                const lowerBB = (bb.lower || []).filter(v => v != null).pop();
                if (lowerBB != null && dayLow < lowerBB) {
                    signals.push({ label: '볼린저 하단 이탈', detail: 'BB(20,2)', pts: 1 });
                }
            } catch (e) {}
        }
        return signals;
    }

    // 노출 자격 판정 (v691 #2) — 단기 패닉(RSI) 필수 AND 중·장기 낙폭
    //   기존 OR 조건은 천천히 흘러내리는 종목을 포함시켜 승률을 낮춤 → AND 로 강화
    function _isClearlyOversold(item) {
        const { rsi, price, ma200, high52 } = item;
        const isRSIOversold = rsi != null && rsi <= 35;        // 단기 패닉 — 필수
        if (!isRSIOversold) return false;
        const isMA200DeepGap = !!(price && ma200 && ma200 > 0 && price < ma200 * 0.85);  // 200일선 -15%
        const is52WDeepDrop  = !!(price && high52 && high52 > 0 && price < high52 * 0.65); // 52주 고점 -35%
        return isMA200DeepGap || is52WDeepDrop;
    }

    function _renderBounceCard(item, showBigTech) {
        if (!showBigTech && _isBigTech(item.symbol, item.marketCap)) return '';
        if (!_isClearlyOversold(item)) return '';
        const signals = _calcBounceScore(item);
        const count = signals.length;

        let tier, tierClass;
        if (count >= 4)      { tier = 'TIER 1'; tierClass = 'bounce-tier1'; }
        else if (count === 3) { tier = 'TIER 2'; tierClass = 'bounce-tier2'; }
        else                  { tier = 'TIER 3'; tierClass = 'bounce-tier3'; }

        const sym = item.symbol || '';
        const price = item.price || 0;
        const priceFmt = price >= 10 ? price.toFixed(2) : price.toFixed(3);
        const chg = item.changePct || 0;
        const chgClass = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
        const sign = chg > 0 ? '+' : '';
        const fb2 = sym.slice(0, 2);
        const logoUrl = `https://assets.parqet.com/logos/symbol/${sym}?format=svg`;

        const logoHtml = `<div class="tlogo-wrap">
            <img class="tlogo" src="${logoUrl}" alt="${sym}" loading="lazy"
                onerror="this.outerHTML='<span class=\\'tlogo tlogo-fb\\'>${fb2}</span>'">
            <span class="tlogo-flag">🇺🇸</span>
        </div>`;

        const signalTags = signals.map(s =>
            `<span class="bounce-signal-tag">${s.label} <em>${s.detail}</em></span>`
        ).join('');

        return `<div class="sniper-item bounce-card" onclick="quickSearch('${sym}','US')">
            ${logoHtml}
            <div class="sniper-info">
                <div class="sniper-ticker">${sym}</div>
                <div class="sniper-name">${item.name || ''}</div>
                <div class="bounce-signals">${signalTags}</div>
            </div>
            <div class="bounce-meta">
                <span class="bounce-tier-badge ${tierClass}">${tier}</span>
                <span class="bounce-score">${count}/6</span>
            </div>
            <div class="sniper-price-wrap">
                <div class="sniper-price">$${priceFmt}</div>
                <div class="sniper-chg ${chgClass}">${sign}${chg.toFixed(2)}%</div>
            </div>
        </div>`;
    }

    let _bounceExcludeBigTech = (() => {
        try { return localStorage.getItem('bounceExcludeBigTech') !== 'false'; } catch(e) { return true; }
    })();

    async function _renderBouncePage() {
        const list = document.getElementById('sniperList');
        const moreBtn = document.getElementById('radarMoreBtn');
        if (!list) return;
        if (moreBtn) moreBtn.style.display = 'none';

        // 필터 토글 버튼 헤더
        const toggleChecked = _bounceExcludeBigTech ? 'checked' : '';
        list.innerHTML = `<div class="bounce-filter-bar">
            <label class="bounce-toggle-label">
                <input type="checkbox" id="bounceExcludeToggle" ${toggleChecked} onchange="_onBounceToggle(this.checked)">
                빅테크 제외
            </label>
        </div>` + '<div class="sniper-loading">' + Array(5).fill('<div class="sniper-skel"></div>').join('') + '</div>';

        try {
            const res = await fetch('/api/oversold-radar?tab=oversold');
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            const items = data.items || [];
            if (_radarTab !== 'bounce') return;

            // TIER 1 먼저, 그 다음 TIER 2, TIER 3
            const scored = items
                .map(item => ({ item, signals: _calcBounceScore(item) }))
                .filter(({ signals }) => signals.length >= 2)
                .sort((a, b) => b.signals.length - a.signals.length);

            const cards = scored.map(({ item }) => _renderBounceCard(item, !_bounceExcludeBigTech)).join('');

            const toggleHtml = `<div class="bounce-filter-bar">
                <label class="bounce-toggle-label">
                    <input type="checkbox" id="bounceExcludeToggle" ${_bounceExcludeBigTech ? 'checked' : ''} onchange="_onBounceToggle(this.checked)">
                    빅테크 제외
                </label>
            </div>`;

            list.innerHTML = toggleHtml + (cards || '<div class="sniper-empty">반등 후보 종목이 없습니다</div>');
        } catch(e) {
            if (_radarTab === 'bounce') {
                list.innerHTML = '<div class="bounce-filter-bar"><label class="bounce-toggle-label"><input type="checkbox" id="bounceExcludeToggle" ' + (_bounceExcludeBigTech ? 'checked' : '') + ' onchange="_onBounceToggle(this.checked)"> 빅테크 제외</label></div><div class="sniper-empty">데이터 로드 실패 — 잠시 후 다시 시도하세요</div>';
            }
        }
    }

    function _onBounceToggle(checked) {
        _bounceExcludeBigTech = checked;
        try { localStorage.setItem('bounceExcludeBigTech', String(checked)); } catch(e) {}
        if (_radarTab === 'bounce') _renderBouncePage();
    }
    window._onBounceToggle = _onBounceToggle;

    // ── 더 보기 ──
    function radarLoadMore() {
        _radarPage++;
        _renderRadarPage();
    }
    window.radarLoadMore = radarLoadMore;

    function _renderRadarPage() {
        const list = document.getElementById('sniperList');
        if (!list) return;
        const start = _radarPage * RADAR_PAGE_SIZE;
        const slice = _radarItems.slice(0, start + RADAR_PAGE_SIZE);
        list.innerHTML = slice.map(item => _renderSniperItem(item, _radarTab)).join('');

        const moreBtn = document.getElementById('radarMoreBtn');
        if (moreBtn) {
            const remaining = _radarItems.length - (start + RADAR_PAGE_SIZE);
            if (remaining > 0) {
                moreBtn.textContent = `나머지 ${remaining}개 더 보기 ↓`;
                moreBtn.style.display = 'block';
            } else {
                moreBtn.style.display = 'none';
            }
        }
    }

    // ── API 호출 ──
    async function _fetchRadar(tab) {
        try {
            const res = await fetch(`/api/oversold-radar?tab=${tab}`);
            if (!res.ok) throw new Error('API error');
            const data = await res.json();
            _radarItems = data.items || [];
            _radarPage  = 0;

            if (_radarItems.length === 0) {
                document.getElementById('sniperList').innerHTML =
                    '<div class="sniper-empty">데이터 없음 — 잠시 후 다시 시도하세요</div>';
                return;
            }

            _renderRadarPage();

            const ts = document.getElementById('radarTs');
            if (ts && data.ts) {
                const d = new Date(data.ts);
                ts.textContent = `업데이트 ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
            }
        } catch (e) {
            console.error('[radar]', e);
            document.getElementById('sniperList').innerHTML =
                '<div class="sniper-empty">데이터 로드 실패</div>';
        }
    }

    // ── 초기 로드 ──
    async function loadRadarDashboard() {
        // 시장 컨텍스트 (헤더 데이터 준비될 때까지 대기)
        const tryMkt = () => {
            if (window._thermoBySymbol && Object.keys(window._thermoBySymbol).length) {
                updateMktCtx();
                drawMktSpark('mktSparkSP',  '^GSPC');
                drawMktSpark('mktSparkNQ',  '^IXIC');
                drawMktSpark('mktSparkVIX', '^VIX');
            }
        };
        tryMkt();
        setTimeout(tryMkt, 2000);
        setTimeout(tryMkt, 5000);

        // 과매도 레이더 데이터 로드
        await _fetchRadar('oversold');
    }

    window.switchRadarTab = switchRadarTab;

    // ── 홈 — 오늘의 실적발표 + AI 어닝콜 요약 ──────────────────────
    // (_earnHomeCache 는 호출 전에 미리 선언됨 — TDZ 방지)
    async function loadEarnHome() {
        const sec = document.getElementById('earnHomeSection');
        const el  = document.getElementById('earnHomeScroll');
        if (!sec || !el) return;
        // 섹션은 항상 표시 (스켈레톤 → 데이터 로드 후 카드)
        sec.style.display = '';
        // 5분 캐시 — 캐시 hit 시에도 섹션 보이게 유지
        if (_earnHomeCache && _earnHomeCache.items?.length && Date.now() - _earnHomeCache.ts < 5 * 60 * 1000) {
            _renderEarnHome(_earnHomeCache.items);
            try { _enrichEarningsWithAI(_earnHomeCache.items.filter(it => it?.epsAct != null)); } catch(e) {}
            return;
        }
        // 스켈레톤 — 실제 카드 구조와 동일
        el.innerHTML = _renderEarnHomeSkeleton(12);
        try {
            // 최근 30일 소급 → 실제 발표 완료 종목 우선 표시 (날짜 최신순)
            const fmt = (d) => {
                const y = d.getFullYear();
                const m = String(d.getMonth()+1).padStart(2,'0');
                const dd2 = String(d.getDate()).padStart(2,'0');
                return `${y}-${m}-${dd2}`;
            };
            const today = new Date();
            const past = new Date(today);
            past.setDate(past.getDate() - 30);
            const url = `/api/earnings-calendar?from=${fmt(past)}&to=${fmt(today)}`;
            const r = await fetch(url);
            if (!r.ok) throw new Error('http '+r.status);
            const data = await r.json();
            const groups = Array.isArray(data.groups) ? data.groups : [];
            // 날짜 내림차순으로 정렬 후 flatten (최신 발표 먼저)
            const sortedGroups = [...groups].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const all = sortedGroups.flatMap(g => (g.items || []).map(it => ({...it, _date: g.date})));
            // 발표 완료(epsAct 있음)만 추출 → 날짜 최신순, 동일날짜면 시가총액순
            const reported = all
                .filter(it => it.epsAct != null)
                .sort((a, b) => {
                    const dateDiff = (b._date || '').localeCompare(a._date || '');
                    if (dateDiff !== 0) return dateDiff;
                    return (b.marketCap || 0) - (a.marketCap || 0);
                });
            const items = reported.slice(0, 12);
            if (!items.length) {
                el.innerHTML = '<div style="padding:14px;color:var(--text3);font-size:13px;">최근 30일간 발표된 종목이 없어요.</div>';
                return;
            }
            _earnHomeCache = { items, ts: Date.now() };
            _renderEarnHome(items);
            // AI 요약 enrich (epsAct 있는 종목만)
            try { _enrichEarningsWithAI(items.filter(it => it?.epsAct != null)); } catch(e) {}
        } catch (e) {
            console.error('[loadEarnHome]', e);
            el.innerHTML = '<div style="padding:14px;color:var(--text3);font-size:13px;">실적발표 불러오기 실패 — 잠시 후 다시 시도해 주세요.</div>';
        }
    }

    function _renderEarnHome(items) {
        const el = document.getElementById('earnHomeScroll');
        if (!el) return;
        el.innerHTML = items.map(_renderEarnHomeCard).join('');
    }
    function _renderEarnHomePairs(pairs) {
        const el = document.getElementById('earnHomeScroll');
        if (!el) return;
        el.innerHTML = pairs.map(([beat, miss]) => _renderEarnHomePairCard(beat, miss)).join('');
    }
    function _renderEarnHomePairCard(beat, miss) {
        const rowHtml = (item) => {
            if (!item) return '';
            const symbol = String(item.symbol || '').replace(/[^A-Z0-9.\-]/gi,'');
            const name   = item.name || symbol;
            const isReported = item.epsAct != null;
            const surprise = _earnSurpriseLabel(item.surprisePct);
            const yoy = (typeof item.yoy === 'number' && !isNaN(item.yoy))
                ? `<span class="earn-hc-meta-item"><span class="earn-hc-meta-label">YoY</span><span class="earn-yoy ${item.yoy>=0?'up':'down'}">${item.yoy>=0?'+':''}${item.yoy.toFixed(1)}%</span></span>` : '';
            const statusBadge = isReported
                ? `<span class="earn-hc-status ${surprise.cls}">${escHtml(surprise.label)}</span>`
                : `<span class="earn-hc-status meet">${escHtml(item._date || '예정')}</span>`;
            const aiCell = isReported
                ? `<div class="earn-hc-ai earn-cell-ai" data-earnings-ai="${symbol}"><span class="earn-hc-ai-loading">AI 분석 중…</span></div>`
                : `<div class="earn-hc-ai" style="opacity:.7"><span class="earn-hc-ai-loading">발표 예정</span></div>`;
            return `<div class="earn-pair-row" onclick="quickSearch('${symbol}','US')">
                <div class="earn-hc-top">
                    ${_tickerLogoHTML(symbol, 'US')}
                    <div class="earn-hc-id">
                        <span class="earn-hc-ticker">${escHtml(symbol)}</span>
                        <span class="earn-hc-name" title="${escHtml(name)}">${escHtml(name)}</span>
                    </div>
                    ${statusBadge}
                </div>
                <div class="earn-hc-meta">
                    <span class="earn-hc-meta-item"><span class="earn-hc-meta-label">EPS</span>${_earnFmtEps(item.epsEst)} → <strong>${_earnFmtEps(item.epsAct)}</strong></span>
                    ${yoy}
                </div>
                ${aiCell}
            </div>`;
        };
        return `<div class="earn-home-card earn-home-pair-card">
            ${rowHtml(beat)}
            ${beat && miss ? '<div class="earn-pair-divider"></div>' : ''}
            ${rowHtml(miss)}
        </div>`;
    }

    function _renderEarnHomeSkeleton(count = 6) {
        const card = (i) => {
            const d = (i * 0.08).toFixed(2);
            return `<div class="earn-home-skel" aria-hidden="true">
                <div class="earn-home-skel-row">
                    <div class="earn-home-skel-circle" style="--d:${d}s"></div>
                    <div class="earn-home-skel-bar" style="width:48px; height:14px; --d:${d}s"></div>
                    <div class="earn-home-skel-bar" style="flex:1; height:11px; --d:${d}s"></div>
                    <div class="earn-home-skel-bar" style="width:54px; height:18px; border-radius:6px; --d:${d}s"></div>
                </div>
                <div class="earn-home-skel-row">
                    <div class="earn-home-skel-bar" style="width:120px; height:11px; --d:${d}s"></div>
                    <div class="earn-home-skel-bar" style="width:60px; height:11px; --d:${d}s"></div>
                </div>
                <div class="earn-home-skel-row" style="background:var(--bg3); border-radius:8px; padding:8px 10px; min-height:44px; gap:6px; align-items:flex-start;">
                    <div class="earn-home-skel-bar" style="width:48px; height:18px; border-radius:8px; --d:${d}s; flex-shrink:0;"></div>
                    <div style="flex:1; display:flex; flex-direction:column; gap:6px; min-width:0;">
                        <div class="earn-home-skel-bar" style="width:100%; height:10px; --d:${d}s"></div>
                        <div class="earn-home-skel-bar" style="width:75%; height:10px; --d:${d}s"></div>
                    </div>
                </div>
            </div>`;
        };
        return Array.from({length: count}, (_, i) => card(i)).join('');
    }

    function _renderEarnHomeCard(item) {
        const symbol = String(item.symbol || '').replace(/[^A-Z0-9.\-]/gi,'');
        const name   = item.name || symbol;
        const isReported = item.epsAct != null;
        const surprise = _earnSurpriseLabel(item.surprisePct);
        const yoy = (typeof item.yoy === 'number' && !isNaN(item.yoy))
            ? `<span class="earn-hc-meta-item"><span class="earn-hc-meta-label">YoY</span><span class="earn-yoy ${item.yoy>=0?'up':'down'}">${item.yoy>=0?'+':''}${item.yoy.toFixed(1)}%</span></span>` : '';
        // 상태 칩: beat/miss + 발표일
        const dateStr = item._date ? item._date.slice(5) : ''; // MM-DD
        const statusBadge = isReported
            ? `<span class="earn-hc-status ${surprise.cls}">${escHtml(surprise.label)}<span class="earn-hc-date">${dateStr}</span></span>`
            : `<span class="earn-hc-status meet">${escHtml(item._date || '예정')}</span>`;
        // AI 셀: 발표 완료만 표시
        const aiCell = isReported
            ? `<div class="earn-hc-ai earn-cell-ai" data-earnings-ai="${symbol}"><span class="earn-hc-ai-loading">AI 분석 중…</span></div>`
            : `<div class="earn-hc-ai" style="opacity:.7"><span class="earn-hc-ai-loading">발표 예정</span></div>`;
        return `<div class="earn-home-card" onclick="quickSearch('${symbol}','US')">
            <div class="earn-hc-top">
                ${_tickerLogoHTML(symbol, 'US')}
                <div class="earn-hc-id">
                    <span class="earn-hc-ticker">${escHtml(symbol)}</span>
                    <span class="earn-hc-name" title="${escHtml(name)}">${escHtml(name)}</span>
                </div>
                ${statusBadge}
            </div>
            <div class="earn-hc-meta">
                <span class="earn-hc-meta-item"><span class="earn-hc-meta-label">EPS</span>${_earnFmtEps(item.epsEst)} → <strong>${_earnFmtEps(item.epsAct)}</strong></span>
                ${yoy}
            </div>
            ${aiCell}
        </div>`;
    }


    // 50개 한도 우회: 배치 분할 fetch (Promise.all 병렬)
    async function _fetchLevQuotesBatched(symbols) {
        const BATCH = 45; // 안전 마진
        const chunks = [];
        for (let i = 0; i < symbols.length; i += BATCH) {
            chunks.push(symbols.slice(i, i + BATCH));
        }
        const responses = await Promise.all(chunks.map(async chunk => {
            const r = await fetch(`/api/quote?symbols=${encodeURIComponent(chunk.join(','))}`);
            if (!r.ok) return [];
            const data = await r.json();
            return data?.quoteResponse?.result || [];
        }));
        return responses.flat();
    }

    async function loadLeverageETFs(forceRefresh) {
        const grid = document.getElementById('leverageGrid');
        if (!grid) return;
        // 30초 메모리 캐시
        const now = Date.now();
        const cacheValid = !forceRefresh && _levQuoteTs && (now - _levQuoteTs < 30000) && Object.keys(_levQuotes).length > 0;
        if (!cacheValid) {
            try {
                const etfSymbols = LEVERAGE_ETF_LIST.map(e => e.symbol);
                // 기초자산 티커 수집 (괴리율 계산용) — ETF·가상 티커 제외
                const skipTickers = new Set(['M7','BTC','ETH']);
                const underlyingTickers = [...new Set(
                    Object.values(LEV_TRACKS_MAP)
                        .map(v => v.ticker)
                        .filter(t => t && !skipTickers.has(t))
                )];
                const allSymbols = [...etfSymbols, ...underlyingTickers];
                const quotes = await _fetchLevQuotesBatched(allSymbols);
                _levQuotes = {};
                _underlyingQuotes = {};
                const etfSet = new Set(etfSymbols);
                const underlyingSet = new Set(underlyingTickers);
                quotes.forEach(q => {
                    if (!q || !q.symbol) return;
                    const sym = q.symbol;
                    const pct = q.regularMarketChangePercent ?? null;
                    if (etfSet.has(sym)) {
                        _levQuotes[sym] = {
                            price:     q.regularMarketPrice ?? null,
                            change:    q.regularMarketChange ?? null,
                            changePct: pct,
                            volume:    q.regularMarketVolume ?? null,
                        };
                    }
                    if (underlyingSet.has(sym)) {
                        _underlyingQuotes[sym] = pct;
                    }
                });
                _levQuoteTs = now;
            } catch (e) {
                console.error('[leverage] quote fetch 실패:', e.message);
                grid.innerHTML = `<div class="disc-empty">시세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>`;
                return;
            }
        }
        renderLeverageGrid();
    }

    function renderLeverageGrid() {
        const grid = document.getElementById('leverageGrid');
        const empty = document.getElementById('leverageEmpty');
        const countEl = document.getElementById('leverageCount');
        if (!grid) return;
        // 필터 적용
        const q = (_levSearchQuery || '').trim().toLowerCase();
        const filtered = LEVERAGE_ETF_LIST.filter(e => {
            if (_levFilters.leverage !== 'all' && String(e.leverage) !== _levFilters.leverage) return false;
            if (_levFilters.direction !== 'all' && e.direction !== _levFilters.direction) return false;
            if (_levFilters.kind !== 'all' && e.kind !== _levFilters.kind) return false;
            if (q) {
                const sym = (e.symbol || '').toLowerCase();
                const name = (e.name || '').toLowerCase();
                const under = (e.underlying || '').toLowerCase();
                const tracksKo = (LEV_TRACKS_MAP?.[e.underlying]?.ko || '').toLowerCase();
                if (!sym.includes(q) && !name.includes(q) && !under.includes(q) && !tracksKo.includes(q)) return false;
            }
            return true;
        });
        if (countEl) countEl.textContent = `${filtered.length} 종목`;
        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.hidden = false;
            return;
        }
        if (empty) empty.hidden = true;
        // 카테고리(underlying) 별 그룹화
        const groups = new Map();
        filtered.forEach(e => {
            if (!groups.has(e.underlying)) groups.set(e.underlying, []);
            groups.get(e.underlying).push(e);
        });
        // 정렬: bull → bear, leverage 높은 순
        groups.forEach(arr => arr.sort((a, b) => {
            if (a.direction !== b.direction) return a.direction === 'bull' ? -1 : 1;
            return b.leverage - a.leverage;
        }));
        // 렌더
        const groupHtml = [];
        groups.forEach((items, underlying) => {
            const cards = items.map(e => _renderLevCard(e)).join('');
            const tracks = LEV_TRACKS_MAP[underlying];
            const ticker = tracks?.ticker;
            // 로고: 일반 종목/ETF만 (M7 같은 가상 티커는 이모지 fallback)
            const logoHtml = (ticker && ticker !== 'M7')
                ? _tickerLogoHTML(ticker, 'US')
                : `<div class="tlogo-wrap"><span class="tlogo tlogo-fb" style="background:var(--purple)">${ticker === 'M7' ? '7' : '?'}</span></div>`;
            const koName = tracks?.ko || underlying;
            const tickerSpan = ticker && ticker !== 'M7'
                ? ` <span class="lev-group-ticker">${escHtml(ticker)}</span>` : '';
            groupHtml.push(`
                <div class="lev-group">
                    <div class="lev-group-title">
                        <div class="lev-group-logo">${logoHtml}</div>
                        <div class="lev-group-name">${escHtml(koName)}${tickerSpan}</div>
                    </div>
                    <div class="lev-group-cards">${cards}</div>
                </div>`);
        });
        grid.innerHTML = groupHtml.join('');
    }

    function _renderLevCard(e) {
        const q = _levQuotes[e.symbol] || {};
        const price = (q.price != null) ? `$${Number(q.price).toFixed(2)}` : '—';
        const chgPct = q.changePct;
        const chgCls = chgPct == null ? 'flat' : chgPct > 0 ? 'up' : chgPct < 0 ? 'down' : 'flat';
        const chgTxt = chgPct == null ? '—'
                     : `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;
        const vol = q.volume != null ? _levFormatVol(q.volume) : '—';
        const dirLabel = e.direction === 'bull' ? '상승' : '하락';
        const levLabel = `x${e.leverage}`;
        const tracksLabel = _levTracksLabel(e.underlying);
        const tracksTicker = LEV_TRACKS_MAP[e.underlying]?.ticker || '';
        const tracksClickable = tracksTicker && tracksTicker !== 'M7'
            ? `onclick="event.stopPropagation();quickSearch('${escHtml(tracksTicker)}','US')"` : '';

        // ── 괴리율: ETF 실제 등락 - (기초자산 등락 × 레버리지 방향)
        let gapHtml = '';
        const underlyingPct = (tracksTicker && _underlyingQuotes[tracksTicker] != null)
            ? _underlyingQuotes[tracksTicker] : null;
        if (chgPct != null && underlyingPct != null) {
            const expectedPct = e.direction === 'bull'
                ? underlyingPct * e.leverage
                : -underlyingPct * e.leverage;
            const gap = chgPct - expectedPct;
            const gapCls = gap > 0.3 ? 'up' : gap < -0.3 ? 'down' : 'flat';
            const gapSign = gap > 0 ? '+' : '';
            gapHtml = `<div class="lev-stat">
                <div class="lev-stat-val lev-gap ${gapCls}">${gapSign}${gap.toFixed(2)}%</div>
                <div class="lev-stat-lbl">괴리율</div>
            </div>`;
        }

        return `
            <div class="lev-card" onclick="quickSearch('${escHtml(e.symbol)}','US')">
                <div class="lev-card-head">
                    <div class="lev-card-symbol">${escHtml(e.symbol)}</div>
                    <div class="lev-card-badges">
                        <span class="lev-badge lev-${e.leverage}x">${levLabel}</span>
                        <span class="lev-badge ${e.direction}">${dirLabel}</span>
                    </div>
                </div>
                <div class="lev-card-name">${escHtml(e.name)}</div>
                <div class="lev-card-stats">
                    <div class="lev-stat">
                        <div class="lev-stat-val">${price}</div>
                        <div class="lev-stat-lbl">현재가</div>
                    </div>
                    <div class="lev-stat">
                        <div class="lev-stat-val ${chgCls}">${chgTxt}</div>
                        <div class="lev-stat-lbl">변동률</div>
                    </div>
                    <div class="lev-stat">
                        <div class="lev-stat-val">${vol}</div>
                        <div class="lev-stat-lbl">거래량</div>
                    </div>
                    ${gapHtml}
                </div>
            </div>`;
    }

    // 추종 대상 매핑 — underlying → "한국어명 (실제 티커)"
    const LEV_TRACKS_MAP = {
        // 지수
        'Nasdaq-100':       { ko: '나스닥 100',       ticker: 'QQQ'  },
        'S&P 500':          { ko: 'S&P 500',           ticker: 'SPY'  },
        'Russell 2000':     { ko: '러셀 2000',         ticker: 'IWM'  },
        'Dow Jones 30':     { ko: '다우 30',           ticker: 'DIA'  },
        // 섹터
        '반도체':           { ko: '반도체',            ticker: 'SOXX' },
        '기술주':           { ko: '기술주',            ticker: 'XLK'  },
        '금융':             { ko: '금융',              ticker: 'XLF'  },
        '지역은행':         { ko: '지역은행',          ticker: 'KRE'  },
        '바이오':           { ko: '바이오',            ticker: 'IBB'  },
        '헬스케어':         { ko: '헬스케어',          ticker: 'XLV'  },
        '에너지':           { ko: '에너지',            ticker: 'XLE'  },
        '부동산':           { ko: '부동산',            ticker: 'XLRE' },
        '인터넷':           { ko: '인터넷',            ticker: 'IYW'  },
        '금광':             { ko: '금광주',            ticker: 'GDX'  },
        '20년+ 국채':       { ko: '20년+ 국채',        ticker: 'TLT'  },
        // 개별 종목
        'Tesla':            { ko: '테슬라',            ticker: 'TSLA' },
        'Nvidia':           { ko: '엔비디아',          ticker: 'NVDA' },
        'Apple':            { ko: '애플',              ticker: 'AAPL' },
        'Microsoft':        { ko: '마이크로소프트',    ticker: 'MSFT' },
        'Amazon':           { ko: '아마존',            ticker: 'AMZN' },
        'Meta':             { ko: '메타',              ticker: 'META' },
        'Google':           { ko: '구글',              ticker: 'GOOGL'},
        'MicroStrategy':    { ko: '마이크로스트래티지',ticker: 'MSTR' },
        'Coinbase':         { ko: '코인베이스',        ticker: 'COIN' },
        'Super Micro':      { ko: '슈퍼마이크로',      ticker: 'SMCI' },
        'AMD':              { ko: 'AMD',               ticker: 'AMD'  },
        'Palantir':         { ko: '팔란티어',          ticker: 'PLTR' },
        'Netflix':          { ko: '넷플릭스',          ticker: 'NFLX' },
        'TSMC':             { ko: 'TSMC',              ticker: 'TSM'  },
        'Broadcom':         { ko: '브로드컴',          ticker: 'AVGO' },
        'Alibaba':          { ko: '알리바바',          ticker: 'BABA' },
        'Eli Lilly':        { ko: '일라이릴리',        ticker: 'LLY'  },
        'PayPal':           { ko: '페이팔',            ticker: 'PYPL' },
        'UnitedHealth':     { ko: '유나이티드헬스',    ticker: 'UNH'  },
        'Nike':             { ko: '나이키',            ticker: 'NKE'  },
        'Magnificent 7':    { ko: '매그니피센트 7',    ticker: 'M7'   },
        // 양자컴퓨팅
        'IonQ':             { ko: '아이온큐',          ticker: 'IONQ' },
        'D-Wave':           { ko: '디웨이브',          ticker: 'QBTS' },
        'Rigetti':          { ko: '리게티',            ticker: 'RGTI' },
        // 차세대 에너지
        'Oklo':             { ko: '오클로',            ticker: 'OKLO' },
        // 핀테크
        'Robinhood':        { ko: '로빈후드',          ticker: 'HOOD' },
        'SoFi':             { ko: '소파이',            ticker: 'SOFI' },
        'Upstart':          { ko: '업스타트',          ticker: 'UPST' },
        // 게이밍 / 밈주
        'DraftKings':       { ko: '드래프트킹스',      ticker: 'DKNG' },
        'GameStop':         { ko: '게임스탑',          ticker: 'GME'  },
        // 광고테크
        'AppLovin':         { ko: '앱러빈',            ticker: 'APP'  },
        // 방산
        'Lockheed Martin':  { ko: '록히드마틴',        ticker: 'LMT'  },
        // 차량공유
        'Uber':             { ko: '우버',              ticker: 'UBER' },
        // 비트코인 채굴주
        'Riot Platforms':   { ko: '라이엇 플랫폼',     ticker: 'RIOT' },
        'CleanSpark':       { ko: '클린스파크',        ticker: 'CLSK' },
        // 암호화폐
        'Bitcoin':          { ko: '비트코인',          ticker: 'BTC'  },
        'Ethereum':         { ko: '이더리움',          ticker: 'ETH'  },
        // 국가별
        '한국 (KOSPI)':     { ko: '한국 코스피',       ticker: 'EWY'  },
        '중국':             { ko: '중국',              ticker: 'FXI'  },
        '인도':             { ko: '인도',              ticker: 'INDA' },
        '브라질':           { ko: '브라질',            ticker: 'EWZ'  },
        '유럽':             { ko: '유럽',              ticker: 'VGK'  },
        '일본':             { ko: '일본',              ticker: 'EWJ'  },
        '신흥국':           { ko: '신흥국',            ticker: 'EEM'  },
        '중형주 (S&P 400)': { ko: '중형주',            ticker: 'IJH'  },
        // 원자재
        'WTI 원유':         { ko: 'WTI 원유',          ticker: 'USO'  },
        '금 (Gold)':        { ko: '금',                ticker: 'GLD'  },
        // 변동성
        'VIX 변동성':       { ko: 'VIX 변동성',        ticker: 'VIXY' },
        // 추가 섹터
        '유틸리티':         { ko: '유틸리티',          ticker: 'XLU'  },
        '주니어 금광주':    { ko: '주니어 금광주',     ticker: 'GDXJ' },
        // 신규 개별 종목
        'Arm Holdings':     { ko: 'Arm Holdings',      ticker: 'ARM'  },
        'Shopify':          { ko: '쇼피파이',          ticker: 'SHOP' },
        'CrowdStrike':      { ko: '크라우드스트라이크',ticker: 'CRWD' },
        'Palo Alto':        { ko: '팔로알토',          ticker: 'PANW' },
        'JPMorgan':         { ko: 'JP모건',            ticker: 'JPM'  },
        'Boeing':           { ko: '보잉',              ticker: 'BA'   },
        'Trump Media':      { ko: '트럼프 미디어',     ticker: 'DJT'  },
        'Rivian':           { ko: '리비안',            ticker: 'RIVN' },
        'Marathon Digital': { ko: '마라톤 디지털',     ticker: 'MARA' },
        'Nucor (원자력)':   { ko: '뉴코어',            ticker: 'NUE'  },
        'RTX (Raytheon)':   { ko: 'RTX 레이시온',      ticker: 'RTX'  },
        'Lyft':             { ko: '리프트',            ticker: 'LYFT' },
        'Baidu':            { ko: '바이두',            ticker: 'BIDU' },
        'PDD (Temu)':       { ko: 'PDD (테무)',         ticker: 'PDD'  },
        'NIO':              { ko: '니오',              ticker: 'NIO'  },
        'Luminar':          { ko: '루미나',            ticker: 'LAZR' },
    };
    function _levTracksLabel(underlying) {
        const t = LEV_TRACKS_MAP[underlying];
        if (!t) return underlying;
        return `${t.ko} (${t.ticker})`;
    }

    function _levFormatVol(v) {
        if (v == null) return '—';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
        return String(v);
    }

    function _levSetFilter(group, value, btn) {
        _levFilters[group] = value;
        // 같은 그룹 내 active 토글
        if (btn?.parentNode) {
            btn.parentNode.querySelectorAll('.lev-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
        renderLeverageGrid();
    }

    // 검색 입력 핸들러 (디바운스 150ms)
    let _levSearchTimer = null;
    function _levSetSearch(val) {
        _levSearchQuery = val || '';
        const clearBtn = document.getElementById('leverageSearchClear');
        if (clearBtn) clearBtn.hidden = !_levSearchQuery;
        clearTimeout(_levSearchTimer);
        _levSearchTimer = setTimeout(() => renderLeverageGrid(), 150);
    }
    function _levClearSearch() {
        _levSearchQuery = '';
        const inp = document.getElementById('leverageSearch');
        if (inp) inp.value = '';
        const clearBtn = document.getElementById('leverageSearchClear');
        if (clearBtn) clearBtn.hidden = true;
        renderLeverageGrid();
    }

    // ── 홈 가로 스와이프 스트립 ──
    // 대표 ETF (지수 + 섹터 + 인기 개별 종목 + 신흥 테마 + 국가별)
    const LEVERAGE_HOME_PICKS = [
        'TQQQ','SQQQ',          // 나스닥 100
        'SPXL','SPXS',          // S&P 500
        'SOXL','SOXS',          // 반도체
        'KORU','YINN',          // 한국 / 중국 (한국 사용자 관심)
        'TSLL','NVDL',          // Tesla / Nvidia
        'AAPU','MSFU',          // Apple / Microsoft
        'AMZU','METU','GGLL',   // Amazon / Meta / Google
        'MSTU','CONL','SMCL',   // MSTR / Coinbase / SMCI
        'IONX','OKLL',          // 양자 / 핵발전 (신흥 테마)
        'HOOX','UBRL',          // 핀테크 / 차량공유
        'BITX','ETHU',          // 비트코인 / 이더리움
        'UCO','DGP',            // 원유 / 금
    ];
    function _renderLevStripSkeleton(n) {
        // 가로 스와이프 스트립 카드와 동일한 사이즈/구조의 스켈레톤
        let html = '';
        for (let i = 0; i < n; i++) {
            html += `
                <div class="lev-strip-card lev-skel-card">
                    <div class="lev-strip-head">
                        <span class="skel-block lev-skel-sym"></span>
                        <span class="skel-block lev-skel-badge"></span>
                    </div>
                    <span class="skel-block lev-skel-under"></span>
                    <div class="lev-strip-foot">
                        <span class="skel-block lev-skel-price"></span>
                        <span class="skel-block lev-skel-chg"></span>
                    </div>
                </div>`;
        }
        return html;
    }

    async function loadLeverageHome() {
        const strip = document.getElementById('leverageHomeStrip');
        if (!strip) return;
        // 30초 메모리 캐시 (메인 화면과 공유)
        const now = Date.now();
        const cacheValid = _levQuoteTs && (now - _levQuoteTs < 30000) && Object.keys(_levQuotes).length > 0;
        if (!cacheValid) {
            // 스켈레톤 카드 노출 (8개 — 화면 폭에 맞춰 시각적으로 가득 참)
            strip.innerHTML = _renderLevStripSkeleton(8);
            try {
                const symbols = LEVERAGE_HOME_PICKS.join(',');
                const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const data = await r.json();
                const quotes = data?.quoteResponse?.result || [];
                quotes.forEach(q => {
                    if (!q || !q.symbol) return;
                    _levQuotes[q.symbol] = {
                        price:     q.regularMarketPrice ?? null,
                        change:    q.regularMarketChange ?? null,
                        changePct: q.regularMarketChangePercent ?? null,
                        volume:    q.regularMarketVolume ?? null,
                    };
                });
                _levQuoteTs = now;
            } catch (e) {
                console.error('[leverage-home] fetch 실패:', e.message);
                strip.innerHTML = `<div class="lev-strip-empty">시세를 불러오지 못했습니다.</div>`;
                return;
            }
        }
        renderLeverageHome();
    }
    function renderLeverageHome() {
        const strip = document.getElementById('leverageHomeStrip');
        if (!strip) return;
        // LEVERAGE_ETF_LIST 에서 LEVERAGE_HOME_PICKS 순서대로 메타 합성
        const items = LEVERAGE_HOME_PICKS
            .map(sym => LEVERAGE_ETF_LIST.find(e => e.symbol === sym))
            .filter(Boolean);
        if (items.length === 0) {
            strip.innerHTML = `<div class="lev-strip-empty">표시할 종목이 없습니다.</div>`;
            return;
        }
        strip.innerHTML = items.map(e => _renderLevStripCard(e)).join('');
    }
    function _renderLevStripCard(e) {
        const q = _levQuotes[e.symbol] || {};
        const price = (q.price != null) ? `$${Number(q.price).toFixed(2)}` : '—';
        const chgPct = q.changePct;
        const chgCls = chgPct == null ? 'flat' : chgPct > 0 ? 'up' : chgPct < 0 ? 'down' : 'flat';
        const chgTxt = chgPct == null ? '—' : `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;
        const dirLabel = e.direction === 'bull' ? '상승' : '하락';
        const levLabel = `x${e.leverage}`;
        const tracksInfo = LEV_TRACKS_MAP[e.underlying];
        const tracksKo = tracksInfo ? tracksInfo.ko : e.underlying;
        return `
            <div class="lev-strip-card" onclick="quickSearch('${escHtml(e.symbol)}','US')">
                <div class="lev-strip-head">
                    <span class="lev-strip-sym">${escHtml(e.symbol)}</span>
                    <span class="lev-badge lev-${e.leverage}x">${levLabel}</span>
                </div>
                <div class="lev-strip-under">🎯 ${escHtml(tracksKo)}</div>
                <div class="lev-strip-foot">
                    <span class="lev-strip-price">${price}</span>
                    <span class="lev-strip-chg ${chgCls}">${chgTxt}</span>
                </div>
                <span class="lev-badge ${e.direction} lev-strip-dir">${dirLabel}</span>
            </div>`;
    }

    function updateBnActive(tab) {
        const map = { home: 'bnHome', leverage: 'bnLeverage', scanner: 'bnScanner', top100: 'bnTop100', smartmoney: 'bnSmartmoney', fav: 'bnFav', vision: 'bnVision', all: 'bnAll' };
        // 'all' = 전체 메뉴 버튼 (TOP 100 등 사이드 메뉴 진입 페이지에서 활성)
        // 모든 탭 비활성화 + 아이콘 line으로
        document.querySelectorAll('.bn-item').forEach(btn => {
            btn.classList.remove('active');
            const icon = btn.querySelector('.bn-icon');
            if (icon) {
                icon.classList.remove(icon.dataset.fill);
                icon.classList.add(icon.dataset.line);
            }
        });
        // 선택된 탭 활성화 + 아이콘 fill로
        const id = map[tab];
        if (id) {
            const btn = document.getElementById(id);
            if (btn) {
                btn.classList.add('active');
                const icon = btn.querySelector('.bn-icon');
                if (icon) {
                    icon.classList.remove(icon.dataset.line);
                    icon.classList.add(icon.dataset.fill);
                }
            }
        }
    }

    function bnGo(tab) {
        if (tab === 'all') { toggleSideNav(); return; } // active 상태 변경 없이 메뉴만 토글
        updateBnActive(tab);
        if (tab === 'home') {
            // 종목이 로드된 상태면 차트를 유지하고 다른 화면만 숨김 (Keep-alive)
            if (currentSymbol) {
                document.getElementById('smartMoneyScreen').style.display = 'none';
                document.getElementById('alphaScannerScreen').style.display = 'none';
                document.getElementById('favScreen').style.display = 'none';
                document.getElementById('visionScannerScreen').style.display = 'none';
                document.getElementById('welcomeScreen').style.display = 'none';
                window._vsActive = false;
            } else {
                goHome();
            }
        } else if (tab === 'leverage') {
            goLeverage();
        } else if (tab === 'scanner') {
            goScanner();
        } else if (tab === 'top100') {
            goTop100();
        } else if (tab === 'smartmoney') {
            goSmartMoney();
        } else if (tab === 'vision') {
            goVisionScanner();
        } else if (tab === 'all') {
            toggleSideNav();
        }
    }

    function toggleScannerChip(btn) {
        if (btn.disabled) return;
        const filter = btn.dataset.filter;
        const val = btn.dataset.val;
        if (filter === 'rr') {
            const wasActive = btn.classList.contains('active');
            document.querySelectorAll('[data-filter="rr"]').forEach(b => b.classList.remove('active'));
            scannerFilters.rr = wasActive ? null : parseFloat(val);
            if (!wasActive) btn.classList.add('active');
        } else {
            btn.classList.toggle('active');
            const arr = scannerFilters[filter];
            const idx = arr.indexOf(val);
            idx >= 0 ? arr.splice(idx, 1) : arr.push(val);
        }
        scannerPreset = null;
        document.querySelectorAll('.scanner-preset-btn').forEach(b => b.classList.remove('active'));
        debounceScannerFetch();
    }

    function setScannerPreset(preset) {
        const presets = {
            breakout:  { rr: 1.5, optionSentiment: [], smartMoney: ['new'] },
            dip:       { rr: 1.5, optionSentiment: [], smartMoney: ['add'] },
            momentum:  { rr: 2.0, optionSentiment: [], smartMoney: [] },
        };
        const cfg = presets[preset];
        if (!cfg) return;
        scannerFilters = { rr: cfg.rr, optionSentiment: [...cfg.optionSentiment], smartMoney: [...cfg.smartMoney] };
        scannerPreset = preset;
        syncScannerChipUI();
        document.querySelectorAll('.scanner-preset-btn').forEach(b => b.classList.remove('active'));
        const presetIdMap = { breakout: 'scanPresetBreakout', dip: 'scanPresetDip', momentum: 'scanPresetMomentum' };
        document.getElementById(presetIdMap[preset])?.classList.add('active');
        debounceScannerFetch();
    }

    function syncScannerChipUI() {
        document.querySelectorAll('.scanner-chip').forEach(b => {
            if (b.disabled) return;
            const filter = b.dataset.filter;
            const val = b.dataset.val;
            if (filter === 'rr') {
                b.classList.toggle('active', scannerFilters.rr === parseFloat(val));
            } else {
                b.classList.toggle('active', scannerFilters[filter]?.includes(val));
            }
        });
    }

    function debounceScannerFetch() {
        clearTimeout(_scannerDebounceTimer);
        _scannerDebounceTimer = setTimeout(runScannerFetch, 500);
    }

    async function runScannerFetch() {
        scannerLoading = true;
        renderScannerResults();
        const candidates = filterScannerResults();
        const validSet = await _filterValidTickers(candidates.map(r => r.ticker));
        scannerResults = candidates.filter(r => validSet.has(r.ticker));
        scannerLoading = false;
        renderScannerResults();
    }

    function filterScannerResults() {
        const results = [];
        const allDatasets = [...(typeof SM_HOT !== 'undefined' ? SM_HOT : []), ...(typeof SM_KINGDOM !== 'undefined' ? SM_KINGDOM : [])];
        allDatasets.forEach(inst => {
            (inst.holdings || []).forEach(h => {
                const action = (h.action || '').toLowerCase();
                let match = true;
                if (scannerFilters.smartMoney.length > 0) {
                    match = match && scannerFilters.smartMoney.some(f => f.toLowerCase() === action);
                }
                if (match) {
                    results.push({
                        ticker: h.ticker,
                        name: h.name || h.ticker,
                        wt: h.wt,
                        qty: h.qty,
                        action: h.action,
                        avgPrice: h.avgPrice,
                        instName: inst.name
                    });
                }
            });
        });
        // 동일 ticker 가 여러 기관에 걸리면 시그널 수로 집계 → TIER 등급
        const byTicker = new Map();
        results.forEach(r => {
            if (!r.ticker) return;
            const key = r.ticker;
            const cur = byTicker.get(key) || {
                ticker: r.ticker, name: r.name || r.ticker,
                institutions: [], actions: [], maxWt: 0, signals: 0,
            };
            cur.institutions.push(r.instName);
            cur.actions.push((r.action || '').toLowerCase());
            cur.maxWt = Math.max(cur.maxWt, r.wt || 0);
            cur.signals = cur.institutions.length;
            byTicker.set(key, cur);
        });
        // 대표 액션: new > add > hold > reduce 우선순위
        const actionRank = { new: 4, add: 3, hold: 2, reduce: 1 };
        const aggregated = Array.from(byTicker.values()).map(r => {
            const topAction = r.actions.slice().sort((a,b) => (actionRank[b]||0) - (actionRank[a]||0))[0] || '';
            // TIER: 1 = 4+ 시그널 / 2 = 2~3 / 3 = 1
            const tier = r.signals >= 4 ? 1 : r.signals >= 2 ? 2 : 3;
            // 점수: 시그널 수 + new/add 가중치 → 동일 tier 내 정렬용
            const actionBoost = r.actions.reduce((s, a) => s + (a === 'new' ? 1.5 : a === 'add' ? 1.0 : a === 'hold' ? 0.2 : -0.5), 0);
            const sortScore = r.signals * 10 + actionBoost + (r.maxWt || 0) * 0.01;
            return { ...r, topAction, tier, sortScore };
        });
        // TIER 1 → 2 → 3 순, 같은 tier 내에서는 sortScore 내림차순
        aggregated.sort((a, b) => a.tier - b.tier || b.sortScore - a.sortScore);
        return aggregated;
    }

    function renderScannerResults() {
        const el = document.getElementById('scannerResults');
        const countEl = document.getElementById('scannerResultsCount');
        if (!el) return;
        if (scannerLoading) {
            if (countEl) countEl.style.display = 'none';
            el.innerHTML = Array(5).fill('<div class="scanner-skeleton"></div>').join('');
            return;
        }
        if (!scannerResults.length) {
            if (countEl) countEl.style.display = 'none';
            el.innerHTML = '<div class="scanner-empty">조건에 맞는 종목이 없습니다.<br>필터를 조정해 보세요.</div>';
            return;
        }
        // TIER 별 카운트
        const tierCount = { 1: 0, 2: 0, 3: 0 };
        scannerResults.forEach(r => { tierCount[r.tier] = (tierCount[r.tier] || 0) + 1; });
        if (countEl) {
            countEl.innerHTML = `${scannerResults.length}개 종목 — ` +
                `<span class="sc-tier-pill sc-tier1">T1 ${tierCount[1]}</span> ` +
                `<span class="sc-tier-pill sc-tier2">T2 ${tierCount[2]}</span> ` +
                `<span class="sc-tier-pill sc-tier3">T3 ${tierCount[3]}</span>`;
            countEl.style.display = '';
        }
        // TIER 별 그룹화 렌더
        let lastTier = null;
        el.innerHTML = scannerResults.map(r => {
            const a = r.topAction || '';
            const actionClass = a === 'new' ? 's-action-new' : a === 'add' ? 's-action-add' : a === 'hold' ? 's-action-hold' : a === 'reduce' ? 's-action-reduce' : '';
            const actionLabel = a === 'new' ? '🟢 신규 편입' : a === 'add' ? '🔵 비중 확대' : a === 'hold' ? '⚪ 유지' : a === 'reduce' ? '🟡 비중 축소' : '';
            const instStr = r.institutions.length > 1
                ? `${r.signals}개 기관 · ${r.institutions.slice(0,2).join(', ')}${r.institutions.length > 2 ? ` 외 ${r.institutions.length - 2}` : ''}`
                : r.institutions[0] || '';
            const wtStr = r.maxWt ? `최대 비중 ${r.maxWt}%` : '';
            const tierBadge = `<span class="sc-tier-badge sc-tier${r.tier}">TIER ${r.tier}</span>`;
            // 그룹 헤더
            let header = '';
            if (r.tier !== lastTier) {
                const tierTitle = r.tier === 1 ? '🥇 TIER 1 — 강력 매수 (4+ 시그널)'
                                : r.tier === 2 ? '🥈 TIER 2 — 매수 검토 (2~3 시그널)'
                                                : '🥉 TIER 3 — 관망 (1 시그널)';
                header = `<div class="sc-tier-header sc-tier${r.tier}">${tierTitle}</div>`;
                lastTier = r.tier;
            }
            return header + `<div class="scanner-result-item sc-tier${r.tier}" onclick="quickSearch('${r.ticker}','US')">
              <div style="flex:1;min-width:0;">
                <div class="scanner-ticker">${r.ticker} ${tierBadge}</div>
                <div class="scanner-inst">${r.name ? r.name + ' · ' : ''}${instStr}</div>
              </div>
              <div style="text-align:right;margin-left:8px;">
                <div class="${actionClass}">${actionLabel}</div>
                ${wtStr ? `<div class="scanner-wt">${wtStr}</div>` : ''}
              </div>
            </div>`;
        }).join('');
    }

    function switchSmTab(tab) {
        document.getElementById('smTabTop10').classList.toggle('active', tab === 'top10');
        document.getElementById('smTabGuru').classList.toggle('active', tab === 'guru');
        document.getElementById('smTabReal')?.classList.toggle('active', tab === 'real');
        document.getElementById('smPanelTop10').classList.toggle('active', tab === 'top10');
        document.getElementById('smPanelGuru').classList.toggle('active', tab === 'guru');
        document.getElementById('smPanelReal')?.classList.toggle('active', tab === 'real');
        document.getElementById('smDeep').style.display = 'none';
        if (tab === 'real') renderGuruReal();
    }

    // 운용사 id → 도메인 매핑 (Brandfetch/Clearbit/Google favicon용)
    const SM_FIRM_DOMAIN = {
        coatue:'coatue.com', sachem:'sachemhead.com', darsana:'darsanacapital.com',
        altimeter:'altimeter.com', iconiq:'iconiqcapital.com', greenlight:'greenlightcapital.com',
        pelham:'pelhamcapital.com', viking:'vikingglobal.com', bridgewater:'bridgewater.com',
        longpine:'longpinecapital.com', whalerock:'whalerock.com', lightstreet:'lightstreetcapital.com',
        dragoneer:'dragoneer.com', maverick:'maverickcapital.com', tigerglobal:'tigerglobal.com',
        twosigma:'twosigma.com', thirdpoint:'thirdpoint.com', appaloosa:'appaloosafund.com',
        pershing:'pershingsquareholdings.com', elliott:'elliottmgmt.com', baupost:'baupost.com',
        sorosfund:'soros.com', tci:'tcifund.com', balyasny:'bam.com',
        graham:'grahamcapital.com', farallon:'faralloncapital.com', glenview:'glenviewcapital.com',
        blackrock:'blackrock.com', vanguard:'vanguard.com', statestreet:'ssga.com',
        fidelity:'fidelity.com', jpmorgan:'jpmorgan.com', citadel:'citadel.com',
        millennium:'mlp.com', capitalgroup:'capitalgroup.com', goldmansacham:'gsam.com',
        pimco:'pimco.com', bnymellon:'bnymellon.com', amundi:'amundi.com',
        invesco:'invesco.com', berkshire:'berkshirehathaway.com', renaissance:'rentec.com',
        deshaw:'deshaw.com', aqr:'aqr.com', dimensional:'dimensional.com', wellington:'wellington.com',
        ariel:'arielinvestments.com',
    };
    // 보조 도메인 (1차 도메인이 로고 검색 안 될 때 시도) — 일부 운용사는 모회사/계열사 도메인이 더 잘 잡힘
    const SM_FIRM_DOMAIN_ALT = {
        // 월가 킹덤
        statestreet:'statestreet.com',
        goldmansacham:'goldmansachs.com',
        balyasny:'balyasny.com',
        millennium:'millenniummgmt.com',
        bnymellon:'bnymellonim.com',
        jpmorgan:'jpmorganchase.com',
        invesco:'us.invesco.com',
        renaissance:'rentec.com',
        ariel:'arielinvestments.com',
        wellington:'wellington.com',
        capitalgroup:'thecapitalgroup.com',
        dimensional:'dimensional.com',
        // 폼 미친 기관들 (사모펀드 — 보조 도메인 후보)
        pershing:'pershingsquare.com',
        appaloosa:'appaloosamanagement.com',
        sachem:'sachem-head.com',
        darsana:'darsana.com',
        pelham:'pelham.com',
        longpine:'longpine.com',
        whalerock:'whalerockcapital.com',
        lightstreet:'lightstreet.com',
        maverick:'maverickcap.com',
        graham:'grahamcapitalmanagement.com',
        glenview:'glenviewcap.com',
        dragoneer:'dragoneerinvestmentgroup.com',
        iconiq:'iconiqcapital.com',
        tci:'tcifundmanagement.com',
        farallon:'faralloncap.com',
        thirdpoint:'thirdpointllc.com',
    };
    // 로고 다중 폴백 체인: 도메인별 여러 CDN 시도 → 보조 도메인까지 시도
    function _smLogoSources(domain, altDomain) {
        const urls = [
            `https://cdn.brandfetch.io/${domain}/w/128/h/128`,
            `https://logo.clearbit.com/${domain}`,
            `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
            `https://icons.duckduckgo.com/ip3/${domain}.ico`,
        ];
        if (altDomain && altDomain !== domain) {
            urls.push(
                `https://cdn.brandfetch.io/${altDomain}/w/128/h/128`,
                `https://logo.clearbit.com/${altDomain}`,
                `https://www.google.com/s2/favicons?domain=${altDomain}&sz=128`,
            );
        }
        return urls;
    }
    // 전역 폴백 핸들러: data-fb(JSON 배열)에서 다음 URL을 꺼내 src 교체, 끝나면 이니셜 아바타로 치환
    window._smLogoErr = function(img) {
        try {
            const list = JSON.parse(img.dataset.fb || '[]');
            if (list.length) {
                img.dataset.fb = JSON.stringify(list.slice(1));
                img.src = list[0];
                return;
            }
        } catch(e) {}
        const cls = img.dataset.fbClass || 'sm-firm-emoji';
        const initial = (img.dataset.initial || '?').toUpperCase();
        const color = img.dataset.color || '#3a3a3c';
        const div = document.createElement('div');
        div.className = cls + ' sm-initial-avatar';
        div.style.cssText = `background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;`;
        div.textContent = initial;
        img.replaceWith(div);
    };
    // 회사명에서 결정적 색상 생성 (Gmail/Slack 스타일 이니셜 아바타용)
    function _smNameColor(name) {
        const palette = ['#1f6feb','#0CF5B0','#a371f7','#f78166','#f0883e','#f85149','#3fb950','#bc8cff','#39c5cf'];
        let h = 0;
        for (let i = 0; i < (name||'').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        return palette[h % palette.length];
    }
    function _smFirmLogo(inst, fallbackEmoji) {
        const domain = SM_FIRM_DOMAIN[inst.id];
        const name = inst.name || '';
        const initial = (name.replace(/^[^A-Za-z]+/, '').charAt(0) || name.charAt(0) || '?');
        const color = _smNameColor(name);
        if (!domain) {
            return `<div class="sm-firm-emoji sm-initial-avatar" style="background:${color};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700">${initial.toUpperCase()}</div>`;
        }
        const alt = SM_FIRM_DOMAIN_ALT[inst.id];
        const [first, ...rest] = _smLogoSources(domain, alt);
        const fbJson = escHtml(JSON.stringify(rest));
        return `<img src="${first}" class="sm-firm-logo" alt="" loading="lazy"
            data-fb="${fbJson}" data-initial="${escHtml(initial)}" data-color="${color}" data-fb-class="sm-firm-logo"
            onerror="_smLogoErr(this)"/>`;
    }
    // 큰 사이즈 운용사 로고 (rank 칼럼용, 36px)
    function _smFirmLogoLg(inst) {
        const domain = SM_FIRM_DOMAIN[inst.id];
        const name = inst.name || '';
        const initial = (name.replace(/^[^A-Za-z]+/, '').charAt(0) || name.charAt(0) || '?');
        const color = _smNameColor(name);
        if (!domain) {
            return `<div class="sm-firm-logo-lg sm-initial-avatar" style="background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px">${initial.toUpperCase()}</div>`;
        }
        const alt = SM_FIRM_DOMAIN_ALT[inst.id];
        const [first, ...rest] = _smLogoSources(domain, alt);
        const fbJson = escHtml(JSON.stringify(rest));
        return `<img src="${first}" class="sm-firm-logo-lg" alt="" loading="lazy"
            data-fb="${fbJson}" data-initial="${escHtml(initial)}" data-color="${color}" data-fb-class="sm-firm-logo-lg"
            onerror="_smLogoErr(this)"/>`;
    }

    function renderSmTop10() {
        const sorted = [...SM_HOT].sort((a, b) => b.ret1y - a.ret1y);
        // 탭 배지 업데이트
        const _t10c = document.getElementById('smTabTop10Count');
        if (_t10c) _t10c.textContent = sorted.length;
        const panel = document.getElementById('smPanelTop10');
        panel.innerHTML = sorted.map((inst, i) => {
            const rank = i + 1;
            const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `<span style="font-size:12px;color:var(--text-secondary)">${rank}</span>`;
            const tags = inst.tags.map(t => `<span class="sm-sector-tag">${t}</span>`).join('');
            const volatiles = inst.volatilePicks.map(t => `<span class="sm-volatile-badge">${t}</span>`).join('');
            const medalBadge = rank <= 3 ? `<span class="sm-medal-badge">${rankLabel}</span>` : `<span class="sm-rank-num">${rank}</span>`;
            return `<div class="sm-inst-card" onclick="smDeepDive('hot_${inst.id}')">
                <div class="sm-inst-header">
                    <div class="sm-inst-rank sm-inst-rank-logo">${_smFirmLogoLg(inst)}${medalBadge}</div>
                    <div class="sm-inst-info">
                        <div class="sm-inst-name">${inst.name}</div>
                        <div class="sm-inst-manager">${inst.manager}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-size:18px;font-weight:700;color:var(--blue)">+${inst.ret1y}%</div>
                        <div style="font-size:10px;color:var(--text-secondary)">1Y 수익률</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin:6px 0">
                    <span class="sm-inst-return pos">1Q +${inst.ret1q}%</span>
                    <span style="font-size:11px;color:var(--text-secondary)">신규매수: ${inst.newBuySector}</span>
                </div>
                <div style="margin-bottom:4px">${tags}</div>
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <div style="font-size:11px;color:var(--text-secondary)">🔥 집중픽: ${volatiles}</div>
                    <span class="sm-inst-arrow">›</span>
                </div>
            </div>`;
        }).join('');
    }

    function renderSmGuru() {
        const sorted = [...SM_KINGDOM].sort((a, b) => b.aum - a.aum);
        // 탭 배지 업데이트
        const _kgc = document.getElementById('smTabGuruCount');
        if (_kgc) _kgc.textContent = sorted.length;
        const panel = document.getElementById('smPanelGuru');
        const fmtAum = v => v >= 1000 ? `$${(v/1000).toFixed(1)}T` : `$${v}B`;
        panel.innerHTML = sorted.map((inst, i) => {
            const rank = i + 1;
            const tags = inst.tags.map(t => `<span class="guru-tag">${t}</span>`).join('');
            const top3html = (inst.top3 || []).map(h =>
                `<span class="sm-top3-hold"><img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(h.ticker)}?format=png" class="sm-chip-logo" alt="" loading="lazy" onerror="this.style.display='none'"/>${h.ticker} <span style="color:var(--blue)">${h.wt}%</span></span>`
            ).join('');
            const kRankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
            const kBadge = rank <= 3 ? `<span class="sm-medal-badge">${kRankLabel}</span>` : `<span class="sm-rank-num">${rank}</span>`;
            return `<div class="sm-inst-card" onclick="smDeepDive('kingdom_${inst.id}')">
                <div class="sm-inst-header">
                    <div class="sm-inst-rank sm-inst-rank-logo">${_smFirmLogoLg(inst)}${kBadge}</div>
                    <div class="sm-inst-info">
                        <div class="sm-inst-name">${inst.name}</div>
                        <div class="sm-inst-manager">${inst.manager}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-size:16px;font-weight:700;color:var(--blue)">${fmtAum(inst.aum)}</div>
                        <div style="font-size:10px;color:var(--text-secondary)">AUM</div>
                    </div>
                </div>
                <div style="margin:6px 0;font-size:11px;color:var(--text-secondary)">TOP 3 보유: ${top3html}</div>
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <div>${tags}</div>
                    <span class="sm-inst-arrow">›</span>
                </div>
            </div>`;
        }).join('');
    }

    // SM_KINGDOM id → SEC EDGAR CIK 매핑
    // /api/guru에 등록된 기관만 실데이터 사용; 나머지는 하드코딩 폴백
    const SM_KINGDOM_CIK = {
        'blackrock':     '0001364742',  // BlackRock Inc (Larry Fink)
        'vanguard':      '0000102909',  // Vanguard Group (Salim Ramji)
        'berkshire25':   '0001067983',  // Berkshire Hathaway (Warren Buffett)
        'statestreet':   '0000093751',  // State Street Global Advisors (Yie-Hsin Hung)
        'fidelity':      '0000315066',  // Fidelity Investments (Abigail Johnson)
        'jpmorgan':      '0000019617',  // JPMorgan Asset Management (Mary Callahan Erdoes)
        'citadel':       '0001423053',  // Citadel Advisors (Ken Griffin)
        'renaissance25': '0001037389',  // Renaissance Technologies (Jim Simons)
        'tiger':         '0001167483',  // Tiger Global Management (Chase Coleman)
        'millennium':    '0001273087',  // Millennium Management (Israel Englander)
    };

    async function smDeepDive(id) {
        // id format: 'hot_xxx' or 'kingdom_xxx'
        const sep = id.indexOf('_');
        const mode   = id.slice(0, sep);
        const instId = id.slice(sep + 1);
        smDeepMode = mode;
        const dataset = mode === 'hot' ? SM_HOT : SM_KINGDOM;
        const inst = dataset.find(i => i.id === instId);
        if (!inst) return;
        smCurrentFilter = 'all';
        document.querySelectorAll('.sm-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('smDeep').style.display = '';
        document.getElementById('smDeep').innerHTML =
            `<div style="padding:40px;text-align:center;color:var(--text-secondary)">불러오는 중...</div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // ── kingdom 모드 → CIK 있으면 실제 13F API 호출 ─────────────
        if (mode === 'kingdom') {
            const cik = SM_KINGDOM_CIK[instId];
            if (cik) {
                try {
                    const r = await fetch(`/api/guru/${cik}/positions`);
                    if (r.ok) {
                        const posData = await r.json();
                        const positions = posData.positions || [];

                        // API 포지션 → holdings 형식 변환
                        // ticker 없는 포지션(CUSIP 미매핑)은 제외 — UI에 "null" 노출 방지
                        const apiHoldings = positions
                            .filter(p => p.ticker)
                            .map(p => ({
                                ticker:    p.ticker,
                                name:      p.name || '',
                                wt:        Number(p.weight || 0),
                                // wtChg: 직전 비중(%p) 없으므로 0 표기 (sec 13F에 prev_weight 없음)
                                wtChg:     0,
                                avgPrice:  0,
                                action:    (p.action || 'hold').toLowerCase()
                                    .replace(/^new$/,    'new')
                                    .replace(/^add$/,    'add')
                                    .replace(/^reduce$/, 'reduce')
                                    .replace(/^sold?$/,  'cut')
                                    .replace(/^hold$/,   'hold'),
                                shares:    p.shares    != null ? Number(p.shares)    : null,
                                value_usd: p.value_usd != null ? Number(p.value_usd) : null,
                            }));

                        // top3Add: action 이 new/add 인 상위 3개
                        const top3Add = apiHoldings
                            .filter(h => h.action === 'new' || h.action === 'add')
                            .slice(0, 3)
                            .map(h => ({
                                ticker:   h.ticker,
                                name:     h.name,
                                wtChg:    0,
                                avgPrice: 0,
                                theme:    h.action === 'new' ? '신규 편입' : '추가 매수',
                            }));

                        const instWithApi = {
                            ...inst,
                            holdings: apiHoldings,
                            top3Add:  top3Add.length > 0 ? top3Add : (inst.top3Add || []),
                            _fromApi: true,
                            _quarter: posData.quarter || '',
                        };
                        // SEC 13F는 현재 상장 종목만 포함 → _filterValidTickers 불필요
                        // (5000+ 티커로 Yahoo API 100+ 병렬 호출 방지)
                        const filtered = instWithApi;

                        document.getElementById('smDeep').innerHTML = _renderDeepKingdom(filtered);
                        return;
                    }
                } catch (e) {
                    warn('[SmDeepDive] API 실패, 하드코딩 폴백:', instId, e);
                }
            }
        }

        // ── 폴백: 기존 하드코딩 데이터 사용 ─────────────────────────
        const tickers = (inst.holdings || []).map(h => h.ticker).filter(Boolean);
        const validSet = await _filterValidTickers(tickers);
        const filteredInst = {
            ...inst,
            holdings: (inst.holdings || []).filter(h => validSet.has(h.ticker)),
        };
        document.getElementById('smDeep').innerHTML =
            mode === 'hot'
                ? _renderDeepHot(filteredInst)
                : _renderDeepKingdom(filteredInst);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function _renderDeepHot(inst) {
        // 액션별 카운트
        const actCnt = {};
        inst.holdings.forEach(h => { actCnt[h.action] = (actCnt[h.action]||0)+1; });
        const filters = [
            {key:'all',    label:'전체',    cnt: inst.holdings.length},
            {key:'new',    label:'🆕 신규', cnt: actCnt['new']||0},
            {key:'add',    label:'🔼 추가', cnt: actCnt['add']||0},
            {key:'reduce', label:'🔽 축소', cnt: actCnt['reduce']||0},
            {key:'cut',    label:'🔴 청산', cnt: actCnt['cut']||0},
            {key:'hold',   label:'유지',    cnt: actCnt['hold']||0},
        ].filter(f => f.key === 'all' || f.cnt > 0);
        const filterBtns = filters.map(f =>
            `<button class="sm-hf-btn${f.key === smCurrentFilter ? ' active' : ''}" onclick="filterSmHoldings('hot_${inst.id}','${f.key}')">
                ${f.label}<span class="sm-hf-cnt">${f.cnt}</span>
             </button>`
        ).join('');
        const top3Cards = inst.top3Add.map(h =>
            `<div class="sm-top3-add-card" onclick="smChartLink('${h.ticker}',${h.avgPrice},'${inst.name}')">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:15px;font-weight:700">${h.ticker}</span>
                    <span class="sm-add-chg">▲ +${h.wtChg.toFixed(1)}%p</span>
                </div>
                <div style="font-size:11px;color:var(--text-secondary);margin:3px 0">${h.name}</div>
                <div style="font-size:11px;color:var(--yellow);font-weight:600">${h.theme}</div>
                <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">평균단가 $${h.avgPrice.toFixed(2)}</div>
            </div>`
        ).join('');
        const visibleCount = smCurrentFilter === 'all' ? inst.holdings.length
            : inst.holdings.filter(h => h.action === smCurrentFilter).length;
        const rows = inst.holdings.map(h => {
            const wtChgStr = h.wtChg > 0 ? `+${h.wtChg.toFixed(1)}%p` : h.wtChg < 0 ? `${h.wtChg.toFixed(1)}%p` : '±0';
            const wtChgCls = h.wtChg > 0 ? 'pos' : h.wtChg < 0 ? 'neg' : 'zero';
            const hidden = smCurrentFilter !== 'all' && h.action !== smCurrentFilter ? ' hidden' : '';
            const shares = inst.aum ? _smFmtShares(inst.aum, h.wt, h.avgPrice) : '—';
            const shortName = (h.name||'').replace(/ (CORP|INC|LTD|PLC|CO|GROUP|HOLDINGS|TECHNOLOGIES|TECHNOLOGY|INTERNATIONAL)\.?$/i,'').slice(0,18);
            return `<div class="sm-holding-row${hidden}" onclick="smChartLink('${h.ticker}',${h.avgPrice},'${inst.name}')">
                <div class="sm-hr-ticker">
                    <img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(h.ticker)}?format=png" class="sm-row-logo" alt="" loading="lazy" onerror="this.style.display='none'" style="flex-shrink:0"/>
                    <div style="min-width:0">
                        <div class="sm-tick">${h.ticker}</div>
                        ${shortName ? `<div class="sm-sub">${escHtml(shortName)}</div>` : ''}
                    </div>
                </div>
                <div>
                    <div class="sm-wt">${h.wt.toFixed(1)}%</div>
                    <div class="sm-wt-chg ${wtChgCls}">${wtChgStr}</div>
                </div>
                <div class="sm-avg">$${h.avgPrice.toFixed(2)}</div>
                <div class="sm-shares">${shares}</div>
                <div style="text-align:center"><span class="sm-action ${h.action}">${_smActionLabel(h.action)}</span></div>
            </div>`;
        }).join('');
        const emptyState = visibleCount === 0
            ? `<div class="sm-holdings-empty">이번 분기에 해당 변동 종목이 없습니다.</div>` : '';
        return `<div class="sm-deep-wrap">
            <div class="sm-deep-header">
                <button class="sm-back-btn" onclick="smDeepBack()">← 뒤로</button>
                <span class="sm-deep-emoji">${inst.emoji}</span>
                <div>
                    <div class="sm-deep-title">${inst.name}</div>
                    <div class="sm-deep-subtitle">${inst.manager} · <span class="sm-quarter-badge">Q1 2026</span> · 1Y +${inst.ret1y}%</div>
                </div>
            </div>
            <div style="margin:12px 0 6px;font-size:12px;font-weight:600;color:var(--text-secondary)">🔥 최다 비중 증가 TOP 3</div>
            <div class="sm-top3-add-grid">${top3Cards}</div>
            <div style="margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--text-secondary)">전체 포트폴리오</div>
            <div class="sm-holdings-filter">${filterBtns}</div>
            <div class="sm-holdings-table">
                <div class="sm-th-row">
                    <div>티커</div><div style="text-align:right">비중</div><div style="text-align:right">평균단가</div><div style="text-align:right">보유수량</div><div style="text-align:center">액션</div>
                </div>
                ${rows}${emptyState}
            </div>
            <div class="sm-deep-insight">
                <div class="sm-insight-title">📌 운용사 관점</div>
                <div class="sm-insight-body">${inst.insight}</div>
            </div>
        </div>`;
    }

    function _renderDeepKingdom(inst) {
        const fmtAum = v => v >= 1000 ? `$${(v/1000).toFixed(1)}T` : `$${v}B`;

        // ── 분기 배지: 실데이터 vs 추정 ──────────────────────────────
        const _safeQ = escHtml(inst._quarter || '');
        const quarterBadge = inst._fromApi && _safeQ
            ? `<span style="font-size:10px;padding:2px 7px;border-radius:8px;
                           background:rgba(34,197,94,0.12);color:#22C55E;
                           margin-left:6px;font-weight:600;vertical-align:middle">
                   📊 ${_safeQ} 실데이터
               </span>`
            : `<span style="font-size:10px;padding:2px 7px;border-radius:8px;
                           background:rgba(245,158,11,0.12);color:#F59E0B;
                           margin-left:6px;vertical-align:middle">
                   추정 데이터
               </span>`;

        // 액션별 카운트
        const actCnt = {};
        inst.holdings.forEach(h => { actCnt[h.action] = (actCnt[h.action]||0)+1; });
        const filters = [
            {key:'all',    label:'전체',    cnt: inst.holdings.length},
            {key:'new',    label:'🆕 신규', cnt: actCnt['new']||0},
            {key:'add',    label:'🔼 추가', cnt: actCnt['add']||0},
            {key:'reduce', label:'🔽 축소', cnt: actCnt['reduce']||0},
            {key:'cut',    label:'🔴 청산', cnt: actCnt['cut']||0},
            {key:'hold',   label:'유지',    cnt: actCnt['hold']||0},
        ].filter(f => f.key === 'all' || f.cnt > 0);
        const filterBtns = filters.map(f =>
            `<button class="sm-hf-btn${f.key === smCurrentFilter ? ' active' : ''}" onclick="filterSmHoldings('kingdom_${inst.id}','${f.key}')">
                ${f.label}<span class="sm-hf-cnt">${f.cnt}</span>
             </button>`
        ).join('');
        // 트리맵: 상위 30개만 렌더링 (5000+ SVG element 생성 방지)
        const treemapHtml = _renderTreemap(inst.holdings.slice(0, 30));
        // 메인 테이블: 최대 100행 (large institution 브라우저 freeze 방지)
        const ROW_LIMIT = 100;
        const rowHoldings = inst.holdings.slice(0, ROW_LIMIT);
        const visibleCount = smCurrentFilter === 'all' ? rowHoldings.length
            : rowHoldings.filter(h => h.action === smCurrentFilter).length;
        const rows = rowHoldings.map(h => {
            const wtChgStr = h.wtChg > 0 ? `+${h.wtChg.toFixed(1)}%p` : h.wtChg < 0 ? `${h.wtChg.toFixed(1)}%p` : '±0';
            const wtChgCls = h.wtChg > 0 ? 'pos' : h.wtChg < 0 ? 'neg' : 'zero';
            const hidden = smCurrentFilter !== 'all' && h.action !== smCurrentFilter ? ' hidden' : '';
            // 보유수량: API 데이터면 shares 직접 사용, 아니면 추정
            const sharesDisplay = h.shares != null
                ? _guruFmtShares(h.shares)
                : (inst.aum && h.avgPrice ? _smFmtShares(inst.aum, h.wt, h.avgPrice) : '—');
            // 평균단가: API 데이터면 '—', 하드코딩이면 표시
            const avgPriceDisplay = h.avgPrice > 0 ? `$${h.avgPrice.toFixed(2)}` : '—';
            const shortName = (h.name||'').replace(/ (CORP|INC|LTD|PLC|CO|GROUP|HOLDINGS|TECHNOLOGIES|TECHNOLOGY|INTERNATIONAL)\.?$/i,'').slice(0,18);
            // 시가총액 배지 (wt 기준)
            const capBadge = h.wt >= 5
                ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;
                               background:rgba(59,130,246,0.15);color:#3B82F6;margin-left:3px">대형</span>`
                : h.wt >= 1
                    ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;
                                   background:rgba(245,158,11,0.15);color:#F59E0B;margin-left:3px">중형</span>`
                    : `<span style="font-size:9px;padding:1px 4px;border-radius:3px;
                                   background:rgba(139,92,246,0.15);color:#8B5CF6;margin-left:3px">소형</span>`;
            return `<div class="sm-holding-row${hidden}" onclick="smChartLink('${h.ticker}',${h.avgPrice},'${inst.name}')">
                <div class="sm-hr-ticker">
                    <img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(h.ticker)}?format=png" class="sm-row-logo" alt="" loading="lazy" onerror="this.style.display='none'" style="flex-shrink:0"/>
                    <div style="min-width:0">
                        <div class="sm-tick">${h.ticker}${capBadge}</div>
                        ${shortName ? `<div class="sm-sub">${escHtml(shortName)}</div>` : ''}
                    </div>
                </div>
                <div>
                    <div class="sm-wt">${h.wt.toFixed(1)}%</div>
                    <div class="sm-wt-chg ${wtChgCls}">${wtChgStr}</div>
                </div>
                <div class="sm-avg">${avgPriceDisplay}</div>
                <div class="sm-shares">${sharesDisplay}</div>
                <div style="text-align:center"><span class="sm-action ${h.action}">${_smActionLabel(h.action)}</span></div>
            </div>`;
        }).join('');
        const emptyState = visibleCount === 0
            ? `<div class="sm-holdings-empty">이번 분기에 해당 변동 종목이 없습니다.<br><span style="font-size:11px;opacity:.7">대형 패시브 기관은 신규 편입이 드뭅니다.</span></div>` : '';
        const moreNote = inst.holdings.length > ROW_LIMIT
            ? `<div style="text-align:center;padding:10px;font-size:11px;color:var(--text-secondary)">
                   상위 ${ROW_LIMIT}개 표시 중 (전체 ${inst.holdings.length.toLocaleString()}개 포지션)
               </div>` : '';

        // ── 신규/추가 섹션 ─────────────────────────────────────────
        const newAdd = inst.holdings.filter(h => h.action === 'new' || h.action === 'add');
        const newAddSection = newAdd.length > 0 ? `
        <div style="margin:14px 0 10px">
            <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:8px">
                📈 이번 분기 신규·추가매수 <span style="color:var(--blue);font-size:11px">${newAdd.length}개</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${newAdd.map(h => {
                    const chgStr = h.wtChg > 0 ? `+${h.wtChg.toFixed(1)}%p` : h.wtChg === 0 ? '신규' : `${h.wtChg.toFixed(1)}%p`;
                    const isNew = h.action === 'new';
                    const bg = isNew ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.10)';
                    const border = isNew ? '#22c55e' : '#3b82f6';
                    const badge = isNew ? `<span style="font-size:9px;background:#22c55e;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">NEW</span>`
                                        : `<span style="font-size:9px;background:#3b82f6;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">추가</span>`;
                    return `<div onclick="smChartLink('${h.ticker}',${h.avgPrice},'${inst.name}')"
                        style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:10px;
                               background:${bg};border:1px solid ${border};cursor:pointer;min-width:110px;flex:0 1 auto">
                        <img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(h.ticker)}?format=png"
                             style="width:20px;height:20px;border-radius:50%;object-fit:contain" alt="" loading="lazy" onerror="this.style.display='none'"/>
                        <div>
                            <div style="font-size:13px;font-weight:700;line-height:1.2">${h.ticker}${badge}</div>
                            <div style="font-size:10px;color:var(--text-secondary);margin-top:1px">${h.wt.toFixed(1)}% · <span style="color:${border}">${chgStr}</span></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>` : '';

        // ── 소형주·중소형 섹션 (접기/펼치기) ──────────────────────
        const SMALL_LIMIT = 30;
        const smallHoldings  = inst.holdings.filter(h => h.wt < 1.0);
        const midHoldings    = inst.holdings.filter(h => h.wt >= 1.0 && h.wt < 2.0);
        const smallTop = smallHoldings.slice(0, SMALL_LIMIT);
        const midTop   = midHoldings.slice(0, SMALL_LIMIT);
        const smallKingdomId = `sk-${inst.id}`;
        const midKingdomId   = `mk-${inst.id}`;

        const _smCapRow = (h, capLabel, capColor) => {
            const wtChgStr = h.wtChg > 0 ? `+${h.wtChg.toFixed(1)}%p` : h.wtChg < 0 ? `${h.wtChg.toFixed(1)}%p` : '±0';
            const actMap = {new:'🆕 신규', add:'➕ 추가', reduce:'➖ 축소', cut:'🔴 청산', hold:'— 유지'};
            const actColor = {new:'#22c55e', add:'#3b82f6', reduce:'#f59e0b', cut:'#ef4444', hold:'var(--text-secondary)'};
            return `<div style="display:grid;grid-template-columns:1fr 52px 44px 70px;align-items:center;
                                padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer"
                         onclick="smChartLink('${h.ticker}',${h.avgPrice},'${inst.name}')">
                <div style="display:flex;align-items:center;gap:7px;min-width:0">
                    <img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(h.ticker)}?format=png"
                         style="width:18px;height:18px;border-radius:50%;object-fit:contain;flex-shrink:0" alt="" loading="lazy" onerror="this.style.display='none'"/>
                    <div style="min-width:0">
                        <div style="font-size:12px;font-weight:700;color:var(--accent)">${h.ticker}</div>
                        <div style="font-size:10px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml((h.name||'').slice(0,18))}</div>
                    </div>
                </div>
                <div style="text-align:right">
                    <div style="font-size:11px;font-weight:600">${h.wt.toFixed(1)}%</div>
                    <div style="font-size:9px;color:${h.wtChg>0?'var(--blue)':h.wtChg<0?'var(--red)':'var(--text-secondary)'}">${wtChgStr}</div>
                </div>
                <div style="text-align:center"><span style="font-size:9px;padding:1px 5px;border-radius:4px;background:${capColor}20;color:${capColor}">${capLabel}</span></div>
                <div style="text-align:center;font-size:10px;color:${actColor[h.action]||'var(--text-secondary)'}">
                    ${actMap[h.action]||'— 유지'}
                </div>
            </div>`;
        };

        const _smCapSection = (id, label, color, items) => items.length === 0 ? '' : `
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
            <div onclick="var el=document.getElementById('${id}');var btn=document.getElementById('${id}-btn');
                          if(el.style.display==='none'){el.style.display='block';btn.textContent='▲ 접기';}
                          else{el.style.display='none';btn.textContent='▼ 펼치기 ('+${items.length}+'개)';}"
                 style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none">
                <div style="font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px">
                    <span style="background:${color}20;color:${color};font-size:10px;padding:1px 7px;border-radius:4px">${label}</span>
                    <span style="color:var(--text-secondary)">${items.length}개 종목</span>
                </div>
                <button id="${id}-btn" style="font-size:10px;color:var(--text-secondary);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer;white-space:nowrap">
                    ▼ 펼치기 (${items.length}개)
                </button>
            </div>
            <div id="${id}" style="display:none;margin-top:8px;max-height:400px;overflow-y:auto;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
                <div style="display:grid;grid-template-columns:1fr 52px 44px 70px;font-size:10px;color:var(--text-secondary);
                            padding:5px 8px;background:var(--bg2);border-bottom:1px solid var(--border)">
                    <span>종목</span><span style="text-align:right">비중</span><span style="text-align:center">규모</span><span style="text-align:center">동향</span>
                </div>
                ${items.map(h => _smCapRow(h, label, color)).join('')}
            </div>
        </div>`;

        const midSection   = _smCapSection(midKingdomId,   '중형주', '#f59e0b', midTop);
        const smallSection = _smCapSection(smallKingdomId, '소형주', '#8B5CF6', smallTop);

        return `<div class="sm-deep-wrap">
            <div class="sm-deep-header">
                <button class="sm-back-btn" onclick="smDeepBack()">← 뒤로</button>
                <span class="sm-deep-emoji">${inst.emoji}</span>
                <div>
                    <div class="sm-deep-title">${escHtml(inst.name)}${quarterBadge}</div>
                    <div class="sm-deep-subtitle">${escHtml(inst.manager)} · <span class="sm-quarter-badge">${_safeQ || 'Q1 2026'}</span>${inst.aum ? ` · AUM ${fmtAum(inst.aum)}` : ''}</div>
                </div>
            </div>
            <div style="margin:12px 0 6px;font-size:12px;font-weight:600;color:var(--text-secondary)">📊 포트폴리오 트리맵</div>
            ${treemapHtml}
            ${newAddSection}
            <div style="margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--text-secondary)">전체 포트폴리오</div>
            <div class="sm-holdings-filter">${filterBtns}</div>
            <div class="sm-holdings-table">
                <div class="sm-th-row">
                    <div>티커</div><div style="text-align:right">비중</div><div style="text-align:right">평균단가</div><div style="text-align:right">보유수량</div><div style="text-align:center">액션</div>
                </div>
                ${rows}${emptyState}
            </div>
            ${moreNote}
            ${midSection}
            ${smallSection}
            <div class="sm-deep-insight" style="margin-top:16px">
                <div class="sm-insight-title">📌 운용사 관점</div>
                <div class="sm-insight-body">${inst.insight}</div>
            </div>
        </div>`;
    }

    function _renderTreemap(holdings) {
        const W = 320, H = 160;
        const total = holdings.reduce((s, h) => s + h.wt, 0);
        const colors = ['#3b82f6','#6366f1','#8b5cf6','#ec4899','#f59e0b','#3b82f6','#ef4444','#06b6d4'];
        // Single-row layout: proportional widths, fixed height
        let x = 0;
        const rects = holdings.map((item, i) => {
            const w = Math.max(Math.round((item.wt / total) * W), 1);
            const r = { x, y: 0, w, h: H, item, color: colors[i % colors.length] };
            x += w;
            return r;
        });
        const CY = H / 2;
        const svgItems = rects.map(r => {
            const wtChgStr = r.item.wtChg > 0 ? `+${r.item.wtChg.toFixed(1)}` : r.item.wtChg.toFixed(1);
            const chgColor = r.item.wtChg > 0 ? '#93c5fd' : r.item.wtChg < 0 ? '#fca5a5' : '#94a3b8';
            const cx = r.x + r.w / 2;
            const showText = r.w >= 28;
            return `<g onclick="smChartLink('${r.item.ticker}',${r.item.avgPrice},'treemap')" style="cursor:pointer">
                <rect x="${r.x}" y="0" width="${r.w}" height="${H}" fill="${r.color}" rx="3" opacity="0.85"/>
                <rect x="${r.x}" y="0" width="${r.w}" height="${H}" fill="none" stroke="#1e293b" stroke-width="1" rx="3"/>
                ${showText ? `<text x="${cx}" y="${CY - 12}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700" font-family="sans-serif">${r.item.ticker}</text>
                <text x="${cx}" y="${CY + 2}" text-anchor="middle" fill="#e2e8f0" font-size="8" font-family="sans-serif">${r.item.wt.toFixed(1)}%</text>
                <text x="${cx}" y="${CY + 15}" text-anchor="middle" fill="${chgColor}" font-size="8" font-family="sans-serif">${wtChgStr}%p</text>` : ''}
            </g>`;
        }).join('');
        return `<div class="sm-treemap-wrap">
            <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;border-radius:8px;overflow:hidden">${svgItems}</svg>
            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;text-align:center">박스 너비 = 비중, 숫자 = 비중변화(%p). 클릭시 차트 이동</div>
        </div>`;
    }

    // ════════════════════════════════════════════════════
    // Guru (SEC EDGAR 13F 실데이터)
    // ════════════════════════════════════════════════════
    let _guruCache = { list: null, ts: 0 };
    const _GURU_TTL = 5 * 60 * 1000;

    function _guruFmtUSD(v) {
        if (v == null) return '-';
        const n = Number(v);
        if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
        if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
        if (n >= 1e6)  return `$${(n/1e6).toFixed(1)}M`;
        if (n >= 1e3)  return `$${(n/1e3).toFixed(0)}K`;
        return `$${n}`;
    }
    function _guruFmtShares(n) {
        if (n == null) return '-';
        n = Number(n);
        if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
        if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
        if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
        return `${n}`;
    }
    function _guruBadge(action) {
        const map = {
            NEW:    { cls: 'new',    label: '🆕 신규' },
            ADD:    { cls: 'add',    label: '🔵 증가' },
            REDUCE: { cls: 'reduce', label: '🟡 감소' },
            SOLD:   { cls: 'sold',   label: '🔴 청산' },
            HOLD:   { cls: 'hold',   label: '⚪ 유지' },
        };
        const b = map[action] || map.HOLD;
        return `<span class="guru-badge ${b.cls}">${b.label}</span>`;
    }

    // 인물 아바타: photo_url 있으면 <img>, 실패/없음 → 이모지 폴백
    // 이미지 로드 실패 시 이모지로 교체 (onerror 속성 이스케이프 없이 전역 함수로 분리)
    function _guruImgErr(el) {
        const emoji = el.dataset.emoji || '💎';
        const lg = el.classList.contains('guru-photo-lg');
        const div = document.createElement('div');
        div.className = 'guru-home-emoji';
        if (lg) div.style.cssText = 'font-size:24px;width:36px;height:36px';
        div.textContent = emoji;
        if (el.parentNode) el.parentNode.replaceChild(div, el);
    }

    // CIK → 이미지 URL 매핑 (부자 포트폴리오 API 데이터에 photo/logo 주입용)
    const _GURU_IMG_MAP = {
        '0001067983': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_%28cropped%29.jpg/100px-Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_%28cropped%29.jpg' }, // Berkshire/Buffett
        '0001364742': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Larry_Fink_with_Valdis_Dombrovskis_%28cropped%29.jpg/100px-Larry_Fink_with_Valdis_Dombrovskis_%28cropped%29.jpg' }, // BlackRock/Fink
        '0000102909': { logo_url:'https://logo.clearbit.com/vanguard.com' },            // Vanguard
        '0000093751': { logo_url:'https://logo.clearbit.com/statestreet.com' },         // State Street
        '0000315066': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Abigail_Johnson_at_Village_Global_%28cropped%29.jpg/100px-Abigail_Johnson_at_Village_Global_%28cropped%29.jpg' }, // Fidelity/Abigail Johnson
        '0000019617': { logo_url:'https://logo.clearbit.com/jpmorgan.com' },            // JPMorgan
        '0001423053': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Kenneth_C._Griffin_photo.jpg/100px-Kenneth_C._Griffin_photo.jpg' }, // Citadel/Griffin
        '0001037389': { logo_url:'https://logo.clearbit.com/rentec.com' },              // Renaissance
        '0001167483': { logo_url:'https://logo.clearbit.com/tigerglobal.com' },         // Tiger Global
        '0001273087': { logo_url:'https://logo.clearbit.com/mlp.com' },                 // Millennium
        '0001029160': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/George_Soros_-_Festival_Economia_2012_1.jpg/100px-George_Soros_-_Festival_Economia_2012_1.jpg' }, // Soros
        '0001350694': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Ray_Dalio_2019.jpg/100px-Ray_Dalio_2019.jpg' }, // Dalio/Bridgewater
        '0001419913': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/David_Tepper_2013.jpg/100px-David_Tepper_2013.jpg' }, // Tepper/Appaloosa
        '0001579982': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Cathie_Wood_2021.jpg/100px-Cathie_Wood_2021.jpg' },  // Cathie Wood/ARK
        '0001336528': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Bill_Ackman_2019.jpg/100px-Bill_Ackman_2019.jpg' },  // Ackman/Pershing
        '0001045810': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Stan_Druckenmiller.jpg/100px-Stan_Druckenmiller.jpg' }, // Druckenmiller/Duquesne
        '0001649339': { photo_url:'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Michael_Burry_2.jpg/100px-Michael_Burry_2.jpg' },      // Burry/Scion
    };

    function _guruAvatar(g, lg) {
        const cls  = 'guru-photo' + (lg ? ' guru-photo-lg' : '');
        const emoji = g.emoji || '💎';
        const imgUrl = g.photo_url || g.logo_url;
        if (!imgUrl) {
            const sty = lg ? ' style="font-size:24px;width:36px;height:36px"' : '';
            return `<div class="guru-home-emoji"${sty}>${emoji}</div>`;
        }
        const safeUrl   = escHtml(imgUrl);
        const alt       = escHtml(g.manager || g.name || '');
        const safeEmoji = escHtml(emoji);
        const isLogo    = !!g.logo_url && !g.photo_url;
        const extraStyle = isLogo ? 'object-fit:contain;background:#fff;padding:4px;border-radius:8px;' : 'object-fit:cover;';
        return `<img src="${safeUrl}" class="${cls}" alt="${alt}" data-emoji="${safeEmoji}" loading="lazy" onerror="_guruImgErr(this)" style="${extraStyle}"/>`;
    }

    // 개별 Guru 크롤링 재시도 (관리자 토큰 없이 — 실패 시 안내)
    async function guruRefresh(cik) {
        if (!cik) return;
        if (!confirm('이 Guru의 13F 데이터를 다시 수집할까요?\n(수 초 ~ 수 분 소요)')) return;
        try {
            const r = await fetch('/api/guru-refresh/' + cik, { method: 'POST' });
            if (r.status === 401 || r.status === 403) {
                alert('관리자 토큰이 필요합니다. 서버 관리자에게 문의해 주세요.');
                return;
            }
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
            alert(`수집 완료: ${j.positions || 0}개 포지션`);
            _guruCache.list = null;
            _guruCache.ts = 0;
            if (document.getElementById('smPanelReal')?.classList.contains('active')) renderGuruReal();
            loadGuruHome();
        } catch (e) {
            alert('수집 실패: ' + e.message);
        }
    }

    async function renderGuruReal() {
        const panel = document.getElementById('smPanelReal');
        if (!panel) return;
        // 캐시 히트 시에도 배지 즉시 업데이트
        if (_guruCache.list) {
            const _rc = document.getElementById('smTabRealCount');
            if (_rc) _rc.textContent = _guruCache.list.length;
        }
        const now = Date.now();
        if (!_guruCache.list || now - _guruCache.ts > _GURU_TTL) {
            // 스켈레톤 카드 — 실제 카드 레이아웃과 동일 (아바타 36px / 이름·매니저 / AUM / 홀딩 칩)
            const skelCard = `
                <div class="sm-inst-card sm-skel-card">
                    <div class="sm-inst-header">
                        <div class="sm-inst-rank sm-inst-rank-logo"><div class="sk sk-avatar"></div></div>
                        <div class="sm-inst-info" style="display:flex;flex-direction:column;gap:6px">
                            <div class="sk sk-name"></div>
                            <div class="sk sk-manager"></div>
                        </div>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
                            <div class="sk sk-aum"></div>
                            <div class="sk sk-aum-sub"></div>
                        </div>
                    </div>
                    <div class="sm-sector-tags" style="margin-top:8px;display:flex;gap:6px">
                        <div class="sk sk-chip"></div><div class="sk sk-chip"></div><div class="sk sk-chip"></div>
                    </div>
                </div>`;
            panel.innerHTML = skelCard.repeat(6);
            try {
                const r = await fetch('/api/guru');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                _guruCache.list = await r.json();
                _guruCache.ts = now;
                // 탭 배지 업데이트
                const _rc = document.getElementById('smTabRealCount');
                if (_rc && _guruCache.list) _rc.textContent = _guruCache.list.length;
            } catch (e) {
                panel.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary)">
                    ⚠️ 부자 포트폴리오 데이터를 불러올 수 없습니다.<br><small>${escHtml(e.message)}</small>
                </div>`;
                return;
            }
        }
        const list = _guruCache.list || [];
        if (!list.length) {
            panel.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary)">
                💎 아직 크롤링된 부자 포트폴리오가 없습니다.<br>
                <small style="opacity:.7">관리자가 <code>/api/guru-refresh/:cik</code>로 데이터를 동기화해야 합니다.</small>
            </div>`;
            return;
        }
        panel.innerHTML = list.map(g => {
            const _imgMeta = _GURU_IMG_MAP[g.cik] || {};
            if (!g.photo_url && !g.logo_url) { g = { ..._imgMeta, ...g }; }
            const isEmpty = g.data_status === 'empty' || (!g.aum_usd && !(g.top3 && g.top3.length));
            const top3 = (g.top3 || []).map(t =>
                `<span class="sm-sector-tag"><img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(t.ticker)}?format=png" class="sm-chip-logo" alt="" loading="lazy" onerror="this.style.display='none'"/>${escHtml(t.ticker)} ${(t.weight||0).toFixed(1)}%</span>`
            ).join('');
            const aum = isEmpty ? '' : _guruFmtUSD(g.aum_usd);
            const filed = g.last_filed_at ? g.last_filed_at : '—';
            const clickHandler = isEmpty
                ? `onclick="alert('13F 데이터가 아직 수집되지 않았습니다.\\n잠시 후 다시 시도해 주세요.')"`
                : `onclick="guruDeepDiveReal('${g.cik}')"`;
            const rightCol = isEmpty
                ? `<div style="text-align:right;flex-shrink:0"><span class="guru-empty-tag">데이터 없음</span></div>`
                : `<div style="text-align:right;flex-shrink:0">
                        <div style="font-size:14px;font-weight:700">${aum}</div>
                        <div style="font-size:10px;color:var(--text-secondary)">AUM · ${filed}</div>
                    </div>`;
            const bottom = isEmpty
                ? `<div style="margin-top:8px;font-size:11px;color:var(--red)">⚠️ 최근 13F 공시 데이터를 불러오지 못했습니다.</div>`
                : `<div class="sm-sector-tags" style="margin-top:8px">${top3 || '<span style="color:var(--text-secondary);font-size:11px">보유 종목 없음</span>'}</div>`;
            return `<div class="sm-inst-card ${isEmpty ? 'guru-card-disabled' : ''}" ${clickHandler}>
                <div class="sm-inst-header">
                    <div class="sm-inst-rank" style="display:flex;align-items:center;justify-content:center">${_guruAvatar(g, true)}</div>
                    <div class="sm-inst-info">
                        <div class="sm-inst-name">${escHtml(g.name)}</div>
                        <div class="sm-inst-manager">${escHtml(g.manager || '')}</div>
                    </div>
                    ${rightCol}
                </div>
                ${bottom}
            </div>`;
        }).join('');
    }

    async function guruDeepDiveReal(cik, quarter) {
        const deep = document.getElementById('smDeep');
        deep.style.display = '';
        document.getElementById('smPanelTop10').classList.remove('active');
        document.getElementById('smPanelGuru').classList.remove('active');
        document.getElementById('smPanelReal').classList.remove('active');
        deep.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary)">불러오는 중...</div>`;
        try {
            const [metaR, posR] = await Promise.all([
                fetch(`/api/guru/${cik}`),
                fetch(`/api/guru/${cik}/positions${quarter ? '?quarter=' + encodeURIComponent(quarter) : ''}`),
            ]);
            if (!metaR.ok) throw new Error('guru meta HTTP ' + metaR.status);
            if (!posR.ok)  throw new Error('positions HTTP ' + posR.status);
            const meta = await metaR.json();
            const pos = await posR.json();
            // 상장폐지 종목 필터
            const posTickers = (pos.positions || []).filter(p => p.ticker).map(p => p.ticker);
            await _filterValidTickers(posTickers);
            const filteredPos = { ...pos, positions: (pos.positions || []).filter(p => !p.ticker || _scannerTickerValid[p.ticker]?.valid !== false) };
            _renderGuruDeep(meta, filteredPos);
        } catch (e) {
            deep.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary)">
                ⚠️ ${escHtml(e.message)}
                <div><button class="sm-back-btn" onclick="guruDeepBack()" style="margin-top:12px">← 돌아가기</button></div>
            </div>`;
        }
    }

    // ── Guru 포트폴리오 필터 상태 ──────────────────────────────────
    let _guruDeepPositions = [];
    let _guruDeepMeta = null;
    let _guruActionFilter = 'all';

    // 현재 날짜 기준 기대 최신 분기 (13F 제출 기준, 45일 지연 반영)
    function _guruExpectedQuarter() {
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
        // Q4 prev year → filing due Feb 15
        if (m < 2 || (m === 2 && d < 15)) return `${y-1}Q4`;
        // Q1 current year → filing due May 15
        if (m < 5 || (m === 5 && d < 15)) return `${y-1}Q4`;
        if (m === 5 || (m <= 7)) return `${y}Q1`;
        // Q2 current year → filing due Aug 15
        if (m < 8 || (m === 8 && d < 15)) return `${y}Q1`;
        if (m <= 10) return `${y}Q2`;
        // Q3 current year → filing due Nov 15
        if (m < 11 || (m === 11 && d < 15)) return `${y}Q2`;
        return `${y}Q3`;
    }

    // ── 시가총액 배지 (비중 기준 간접 추정) ─────────────────────────
    function _guruCapBadge(weight) {
        const w = Number(weight || 0);
        if (w >= 5)   return `<span class="guru-cap-badge guru-cap-large">대형</span>`;
        if (w >= 1)   return `<span class="guru-cap-badge guru-cap-mid">중형</span>`;
        if (w >= 0.1) return `<span class="guru-cap-badge guru-cap-small">소형</span>`;
        return `<span class="guru-cap-badge guru-cap-nano">초소형</span>`;
    }

    // 포지션 행 단건 렌더 (필터 재적용 시 재사용)
    function _renderGuruRow(p, i, meta) {
        const shortName = (p.name || '').replace(/ (CORP|INC|LTD|PLC|CO|GROUP|HOLDINGS|TECHNOLOGIES|TECHNOLOGY|INTERNATIONAL|BANCSHARES|FINANCIAL)\.?$/i, '').slice(0, 22);
        const tickerLogo = p.ticker
            ? `<img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(p.ticker)}?format=png" class="sm-row-logo" alt="" loading="lazy" onerror="this.style.display='none'" style="vertical-align:middle;margin-right:6px;flex-shrink:0"/>`
            : '';
        const capBadge = _guruCapBadge(p.weight);
        const ticker = p.ticker
            ? `${tickerLogo}<a href="#" onclick="event.preventDefault();smChartLink('${p.ticker}',0,'${escHtml((meta||{}).name||'Guru')}')" style="color:var(--accent);font-weight:700;font-size:13px;vertical-align:middle">${escHtml(p.ticker)}</a>${capBadge}`
            : `<span style="color:var(--text);font-weight:700;font-size:12px" title="${escHtml(p.name||'')}">${escHtml(shortName)}</span>${capBadge}`;
        const subName = p.ticker ? `<div style="font-size:10px;color:var(--text-secondary)">${escHtml((p.name||'').slice(0,30))}</div>` : '';
        const deltaShares = (p.prev_shares != null && p.shares != null) ? (p.shares - p.prev_shares) : 0;
        const deltaStr = deltaShares === 0 ? '—' :
            deltaShares > 0 ? `<span style="color:var(--blue)">+${_guruFmtShares(deltaShares)}</span>` :
            `<span style="color:var(--red)">${_guruFmtShares(deltaShares)}</span>`;
        return `<tr>
            <td style="font-size:10px;color:var(--text-secondary)">${i+1}</td>
            <td><div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px">${ticker}</div>${subName}</td>
            <td style="text-align:right;font-weight:600">${Number(p.weight||0).toFixed(2)}%</td>
            <td style="text-align:right">${_guruFmtUSD(p.value_usd)}</td>
            <td style="text-align:right">${_guruFmtShares(p.shares)}</td>
            <td style="text-align:center">${_guruBadge(p.action)}</td>
            <td style="text-align:right;font-size:11px">${deltaStr}</td>
        </tr>`;
    }

    // ── 통합 필터 함수 (action + 규모) ───────────────────────────────
    function _guruFilterPos(filter, btn) {
        // 버튼 활성화 토글
        document.querySelectorAll('.guru-filter-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');

        // 포지션 필터링
        let filtered;
        switch (filter) {
            case 'new':    filtered = _guruDeepPositions.filter(p => p.action === 'NEW');   break;
            case 'add':    filtered = _guruDeepPositions.filter(p => p.action === 'ADD');   break;
            case 'reduce': filtered = _guruDeepPositions.filter(p => p.action === 'REDUCE'); break;
            case 'sold':   filtered = _guruDeepPositions.filter(p => p.action === 'SOLD');  break;
            case 'hold':   filtered = _guruDeepPositions.filter(p => p.action === 'HOLD');  break;
            case 'large':  filtered = _guruDeepPositions.filter(p => Number(p.weight||0) >= 5); break;
            case 'mid':    filtered = _guruDeepPositions.filter(p => { const w=Number(p.weight||0); return w>=1&&w<5; }); break;
            case 'small':  filtered = _guruDeepPositions.filter(p => Number(p.weight||0) < 1);  break;
            default:       filtered = _guruDeepPositions;
        }

        const tbody = document.getElementById('guruPosTbody');
        const cntEl = document.getElementById('guruFilterCnt');
        if (!tbody) return;

        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-secondary)">해당 조건의 포지션이 없습니다.</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map((p, i) => _renderGuruRow(p, i, _guruDeepMeta)).join('');
        }
        if (cntEl) cntEl.textContent = filtered.length + '개';
    }

    // 하위 호환: 기존 _applyGuruFilter 유지
    function _applyGuruFilter(action) { _guruFilterPos(action === 'all' ? 'all' : action.toLowerCase(), null); }

    // 최신 분기 자동 수집 (confirm 없이 조용히 실행)
    async function _guruRefreshLatest(cik) {
        const btn = document.getElementById('guruRefreshBtn');
        if (btn) { btn.disabled = true; btn.textContent = '수집 중...'; }
        try {
            const r = await fetch('/api/guru-refresh/' + cik, { method: 'POST' });
            if (r.status === 401 || r.status === 403) {
                if (btn) { btn.disabled = false; btn.textContent = '🔄 최신 수집'; }
                try { showToast('관리자 권한이 필요합니다'); } catch(e) {}
                return;
            }
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
            _guruCache.list = null; _guruCache.ts = 0;
            try { showToast(`✅ ${j.positions || 0}개 포지션 수집 완료`); } catch(e) {}
            // 갱신된 데이터로 다시 로드
            guruDeepDiveReal(cik);
        } catch (e) {
            if (btn) { btn.disabled = false; btn.textContent = '🔄 최신 수집'; }
            try { showToast('수집 실패: ' + e.message); } catch(ex) {}
        }
    }

    function _renderGuruDeep(meta, pos) {
        const deep = document.getElementById('smDeep');
        _guruDeepMeta = meta;
        _guruActionFilter = 'all';
        const positions = (pos.positions || []).filter(p => p.ticker || p.name);
        _guruDeepPositions = positions;
        const currentQ = pos.quarter;
        const quarters = meta.quarters || [];

        // Treemap용 데이터 — 상위 8개
        const top8 = positions.slice(0, 8).filter(p => p.ticker);
        const treemapData = top8.map(p => ({
            ticker: p.ticker,
            wt: Number(p.weight) || 0,
        }));
        const tmTotal = treemapData.reduce((s, h) => s + h.wt, 0);
        const treemapHtml = tmTotal > 0 ? _renderGuruTreemap(treemapData) : '';

        // 분기 드롭다운 옵션
        const qOptions = quarters.map(q =>
            `<option value="${q.quarter}" ${q.quarter === currentQ ? 'selected' : ''}>${q.quarter} (${q.filing_date})</option>`
        ).join('');

        // 최신 분기 여부 체크 → 수집 버튼 표시
        const expectedQ = _guruExpectedQuarter();
        const latestInDB = quarters.length ? quarters[0].quarter : (currentQ || '');
        const needsRefresh = !latestInDB || latestInDB < expectedQ;
        const refreshBtn = needsRefresh
            ? `<button id="guruRefreshBtn" onclick="_guruRefreshLatest('${meta.cik}')"
                style="padding:5px 11px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:12px;cursor:pointer;white-space:nowrap">
                🔄 ${expectedQ} 수집
               </button>`
            : `<button id="guruRefreshBtn" onclick="_guruRefreshLatest('${meta.cik}')"
                style="padding:5px 11px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;cursor:pointer;opacity:.6;white-space:nowrap">
                🔄 최신 수집
               </button>`;

        // ── 필터 카운트 계산 ────────────────────────────────────────
        const cntMap = {};
        positions.forEach(p => { const a = p.action || 'HOLD'; cntMap[a] = (cntMap[a]||0)+1; });
        const cntLarge = positions.filter(p => Number(p.weight||0) >= 5).length;
        const cntMid   = positions.filter(p => { const w=Number(p.weight||0); return w>=1&&w<5; }).length;
        const cntSmall = positions.filter(p => Number(p.weight||0) < 1).length;

        // 소형주 섹션 (접기/펼치기 토글용)
        const small = positions.filter(p => Number(p.weight||0) < 1);
        const SMALL_LIMIT = 30;
        const smallTop = small.slice(0, SMALL_LIMIT);
        const smallId = `small-${meta.cik}`;

        // 행동 필터 — 0개인 항목 자동 제외
        const actionFilters = [
            { key:'all',    label:'전체',      cnt: positions.length },
            { key:'new',    label:'🆕 신규',   cnt: cntMap['NEW']||0 },
            { key:'add',    label:'➕ 추가매수', cnt: cntMap['ADD']||0 },
            { key:'reduce', label:'➖ 축소',    cnt: cntMap['REDUCE']||0 },
            { key:'sold',   label:'🔴 청산',   cnt: cntMap['SOLD']||0 },
            { key:'hold',   label:'유지',       cnt: cntMap['HOLD']||0 },
        ].filter(f => f.key === 'all' || f.cnt > 0);

        // 규모 필터
        const sizeFilters = [
            { key:'large', label:'대형주', cnt: cntLarge },
            { key:'mid',   label:'중형주', cnt: cntMid   },
            { key:'small', label:'소형주', cnt: cntSmall },
        ].filter(f => f.cnt > 0);

        const mkBtn = (f, isFirst) =>
            `<button class="guru-filter-btn${isFirst ? ' active' : ''}" data-filter="${f.key}"
                     onclick="_guruFilterPos('${f.key}', this)">
                ${f.label} <span class="guru-filter-cnt">${f.cnt}</span>
             </button>`;

        const actionBtns = actionFilters.map((f, i) => mkBtn(f, i === 0)).join('');
        const sizeBtns   = sizeFilters.map(f => mkBtn(f, false)).join('');

        const rows = positions.map((p, i) => _renderGuruRow(p, i, meta)).join('');

        // 소형주 접기/펼치기 섹션 HTML
        const smallSection = smallTop.length > 0 ? `
<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
    <div onclick="
            var el = document.getElementById('${smallId}');
            var btn = document.getElementById('${smallId}-btn');
            if (el.style.display === 'none') {
                el.style.display = 'block';
                btn.textContent = '▲ 접기';
            } else {
                el.style.display = 'none';
                btn.textContent = '▼ 펼치기 (${smallTop.length}개)';
            }"
         style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none">
        <div style="font-size:11px;color:#8B5CF6;font-weight:700;display:flex;align-items:center;gap:6px">
            <span style="background:rgba(139,92,246,0.15);color:#8B5CF6;font-size:10px;padding:1px 6px;border-radius:4px">소형</span>
            소형주 ${smallTop.length}개${small.length > SMALL_LIMIT ? ' (상위 '+SMALL_LIMIT+'개)' : ''}
        </div>
        <button id="${smallId}-btn"
            style="font-size:11px;color:var(--text-secondary);background:none;border:1px solid var(--border);
                   border-radius:6px;cursor:pointer;padding:3px 8px;white-space:nowrap">
            ▼ 펼치기 (${smallTop.length}개)
        </button>
    </div>
    <div id="${smallId}" style="display:none;margin-top:8px;max-height:400px;overflow-y:auto">
        <div style="display:grid;grid-template-columns:1fr 52px 44px 70px;gap:0;font-size:10px;color:var(--text-secondary);padding:4px 6px;border-bottom:1px solid var(--border)">
            <span>종목</span><span style="text-align:right">비중</span><span style="text-align:center">규모</span><span style="text-align:center">동향</span>
        </div>
        ${smallTop.map(p => {
            const t = p.ticker || (p.name||'').slice(0,10) || '—';
            const wt = Number(p.weight||0).toFixed(2);
            const act = p.action || 'HOLD';
            const actLabel = act === 'NEW' ? '🆕 신규' : act === 'ADD' ? '➕ 추가' : act === 'REDUCE' ? '➖ 축소' : act === 'SOLD' ? '🔴 청산' : '— 유지';
            const actCls = act === 'NEW' ? 'color:#22c55e' : act === 'ADD' ? 'color:#3b82f6' : act === 'REDUCE' ? 'color:#f59e0b' : act === 'SOLD' ? 'color:#ef4444' : 'color:var(--text-secondary)';
            return `<div style="display:grid;grid-template-columns:1fr 52px 44px 70px;gap:0;padding:5px 6px;border-bottom:1px solid var(--border);align-items:center;cursor:pointer"
                         onclick="smChartLink('${p.ticker||''}',0,'${escHtml(meta.name||'')}')">
                <span style="font-weight:600;font-size:12px;color:var(--accent)">${escHtml(t)}</span>
                <span style="text-align:right;font-size:11px;color:var(--text)">${wt}%</span>
                <span style="text-align:center"><span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(139,92,246,0.15);color:#8B5CF6">소형</span></span>
                <span style="text-align:center;font-size:10px;${actCls}">${actLabel}</span>
            </div>`;
        }).join('')}
    </div>
</div>` : '';

        deep.innerHTML = `<div class="sm-deep-wrap">
            <button class="sm-back-btn" onclick="guruDeepBack()">← 돌아가기</button>
            <div class="sm-deep-header" style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
                ${_guruAvatar(meta, true)}
                <div style="flex:1">
                    <div style="font-size:20px;font-weight:700">${escHtml(meta.name)}</div>
                    <div style="font-size:12px;color:var(--text-secondary)">${escHtml(meta.manager || '')} · CIK ${meta.cik}</div>
                </div>
                <div style="text-align:right">
                    <div style="font-size:16px;font-weight:700">${_guruFmtUSD(meta.aum_usd)}</div>
                    <div style="font-size:10px;color:var(--text-secondary)">최신: ${meta.last_filed_at || '—'}</div>
                </div>
            </div>
            <div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <label style="font-size:12px;color:var(--text-secondary);white-space:nowrap">분기 선택:</label>
                <select onchange="guruDeepDiveReal('${meta.cik}', this.value)" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px">${qOptions || `<option value="${currentQ||''}">${currentQ||'—'}</option>`}</select>
                ${refreshBtn}
                <span style="font-size:10px;color:var(--text-secondary);opacity:.7">13F 최대 45일 지연</span>
            </div>
            ${treemapHtml ? `<div style="margin-bottom:16px">
                <div style="font-size:13px;font-weight:600;margin-bottom:6px">Top 8 포트폴리오 비중</div>
                ${treemapHtml}
            </div>` : ''}
            ${positions.length ? `
            <div style="margin-bottom:6px">
                <div class="guru-filter-row">
                    <span class="guru-filter-label">행동</span>
                    ${actionBtns}
                </div>
                ${sizeBtns ? `<div class="guru-filter-row" style="margin-top:6px">
                    <span class="guru-filter-label">규모</span>
                    ${sizeBtns}
                    <span id="guruFilterCnt" style="margin-left:auto;font-size:11px;color:var(--text-secondary);align-self:center">${positions.length}개</span>
                </div>` : `<span id="guruFilterCnt" style="display:none">${positions.length}</span>`}
            </div>
            <div class="sm-table-wrap" style="overflow-x:auto">
                <table class="sm-table" style="width:100%">
                    <thead><tr>
                        <th>#</th><th>종목</th><th style="text-align:right">비중</th>
                        <th style="text-align:right">평가액</th><th style="text-align:right">주식수</th>
                        <th style="text-align:center">상태</th><th style="text-align:right">지난분기 변화</th>
                    </tr></thead>
                    <tbody id="guruPosTbody">${rows}</tbody>
                </table>
            </div>
            ${smallSection}` : `<div class="guru-empty-block">
                📭 최근 13F 공시 데이터를 불러오지 못했습니다.<br>
                <span style="font-size:11px;opacity:.7">SEC EDGAR에서 13F-HR 폼을 찾지 못했거나, 아직 크롤링되지 않았습니다.</span><br>
                <button onclick="guruRefresh('${meta.cik}')">다시 수집</button>
            </div>`}
        </div>`;
    }

    function _renderGuruTreemap(holdings) {
        const W = 320, H = 140;
        const total = holdings.reduce((s, h) => s + h.wt, 0);
        if (total <= 0) return '';
        const colors = ['#3b82f6','#6366f1','#8b5cf6','#ec4899','#f59e0b','#3b82f6','#ef4444','#06b6d4'];
        let x = 0;
        const rects = holdings.map((item, i) => {
            const w = Math.max(Math.round((item.wt / total) * W), 1);
            const r = { x, w, item, color: colors[i % colors.length] };
            x += w;
            return r;
        });
        const CY = H / 2;
        const svgItems = rects.map(r => {
            const cx = r.x + r.w / 2;
            const showText = r.w >= 30;
            return `<g onclick="smChartLink('${r.item.ticker}',0,'Guru')" style="cursor:pointer">
                <rect x="${r.x}" y="0" width="${r.w}" height="${H}" fill="${r.color}" rx="3" opacity="0.85"/>
                <rect x="${r.x}" y="0" width="${r.w}" height="${H}" fill="none" stroke="#1e293b" stroke-width="1" rx="3"/>
                ${showText ? `<text x="${cx}" y="${CY - 6}" text-anchor="middle" fill="#fff" font-size="10" font-weight="700" font-family="sans-serif">${r.item.ticker}</text>
                <text x="${cx}" y="${CY + 10}" text-anchor="middle" fill="#e2e8f0" font-size="9" font-family="sans-serif">${r.item.wt.toFixed(1)}%</text>` : ''}
            </g>`;
        }).join('');
        return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;border-radius:8px;overflow:hidden">${svgItems}</svg>`;
    }

    function guruDeepBack() {
        document.getElementById('smDeep').style.display = 'none';
        document.getElementById('smPanelReal').classList.add('active');
        document.getElementById('smTabReal').classList.add('active');
        document.getElementById('smTabTop10').classList.remove('active');
        document.getElementById('smTabGuru').classList.remove('active');
        document.getElementById('smPanelTop10').classList.remove('active');
        document.getElementById('smPanelGuru').classList.remove('active');
    }

    // 종목 상세: 보유 Guru 칩
    // ── 투자 대가 포지션 시그널 매핑 ────────────────────────────────
    function _ghSignal(action, wtChg) {
        if (action === 'NEW')    return { cls: 'gh-sig-new',    label: '신규 매수' };
        if (action === 'ADD')    return { cls: 'gh-sig-add',    label: wtChg != null ? `▲ +${Number(wtChg).toFixed(1)}%p` : '▲ 증가' };
        if (action === 'REDUCE') return { cls: 'gh-sig-reduce', label: wtChg != null ? `▼ ${Number(wtChg).toFixed(1)}%p` : '▼ 감소' };
        return { cls: 'gh-sig-hold', label: '─ 유지' };
    }

    // 펀드명 첫 글자 + 결정적 배경색 아바타 (이미지 없을 때)
    function _ghInitialAvatar(name) {
        const ch = (name || '?').replace(/[^A-Za-z0-9가-힣]/g, '').charAt(0).toUpperCase() || '?';
        const PALETTE = ['#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#06B6D4','#F97316','#6366F1'];
        let hash = 0;
        for (let i = 0; i < (name||'').length; i++) hash = (hash * 31 + (name||'').charCodeAt(i)) & 0xffff;
        const bg = PALETTE[hash % PALETTE.length];
        return `<div class="gh-avatar gh-avatar-init" style="background:${bg}">${escHtml(ch)}</div>`;
    }

    function _ghAvatarEl(g) {
        const imgMeta = _GURU_IMG_MAP[g.cik] || {};
        const imgUrl  = imgMeta.photo_url || imgMeta.logo_url || g.photo_url || g.logo_url;
        if (!imgUrl) return _ghInitialAvatar(g.name || g.manager);
        const isLogo = !!(imgMeta.logo_url && !imgMeta.photo_url);
        // padding은 CSS로 처리 (img에 padding 적용 시 box-model 이슈 회피)
        const cls    = 'gh-avatar gh-avatar-img' + (isLogo ? ' gh-avatar-logo' : '');
        const alt    = escHtml(g.manager || g.name || '');
        const nameAttr = escHtml(g.name || g.manager || '?');
        // onerror: data-name 기반 폴백 (인라인 JSON 파싱 따옴표 충돌 회피)
        return `<img src="${escHtml(imgUrl)}" class="${cls}" alt="${alt}" data-name="${nameAttr}" onerror="_ghAvatarFallback(this)" loading="lazy"/>`;
    }

    // img onerror → 이니셜 아바타 교체 (인라인 JSON 우회용)
    function _ghAvatarFallback(img) {
        try {
            const name = img.dataset.name || '?';
            const tmp = document.createElement('div');
            tmp.innerHTML = _ghInitialAvatar(name);
            const newEl = tmp.firstElementChild;
            if (newEl && img.parentNode) img.parentNode.replaceChild(newEl, img);
        } catch(_) {}
    }

    function _ghFmtAUM(v) {
        if (!v) return null;
        const n = Number(v);
        if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
        if (n >= 1e9)  return `$${(n/1e9).toFixed(0)}B`;
        if (n >= 1e6)  return `$${(n/1e6).toFixed(0)}M`;
        return null;
    }

    // 전역 캐시 — 종목별 최신 list 보관 (click 핸들러에서 참조)
    window._ghDataCache = window._ghDataCache || {};

    async function renderGuruHolders(ticker) {
        const box = document.getElementById('guruHolders');
        if (!box || !ticker) return;
        // 종목 전환 시 stale 콘텐츠/이벤트 제거
        box.innerHTML = '';
        box.style.display = 'none';
        const tkU = ticker.toUpperCase();
        try {
            const r = await fetch(`/api/guru/by-ticker/${encodeURIComponent(tkU)}`);
            if (!r.ok) return;
            const list = await r.json();
            if (!Array.isArray(list) || !list.length) return;

            // 빈 데이터 = 섹션 hide (placeholder 노출 X)
            // 캐시에 저장 (click 핸들러에서 idx로 조회)
            window._ghDataCache[tkU] = list;

            const rows = list.map((g, idx) => {
                const sig     = _ghSignal(g.action, g.wtChg);
                const avatar  = _ghAvatarEl(g);
                const fundName = escHtml(g.name || g.manager || g.cik || '');
                const aum     = _ghFmtAUM(g.aum_usd);
                const weightStr = g.action === 'NEW'
                    ? '신규 매수'
                    : (g.weight != null ? Number(g.weight).toFixed(2) + '%' : '—');
                const meta = aum ? `AUM ${aum} · ${weightStr}` : weightStr;
                return `<div class="gh-row" data-gh-idx="${idx}" data-gh-ticker="${escHtml(tkU)}">
                    <div class="gh-row-left">
                        ${avatar}
                        <div class="gh-row-info">
                            <div class="gh-row-name">${fundName}</div>
                            <div class="gh-row-meta">${escHtml(meta)}</div>
                        </div>
                    </div>
                    <div class="gh-row-right">
                        <span class="gh-sig ${sig.cls}">${escHtml(sig.label)}</span>
                        <span class="gh-chevron">›</span>
                    </div>
                </div>`;
            }).join('');

            box.innerHTML = `<div class="card gh-card">
                <div class="gh-header">
                    <span class="gh-title">투자 대가 포지션 <span class="gh-count">(${list.length})</span></span>
                    <button class="gh-info-btn" onclick="event.stopPropagation();_ghShowInfo(this)" aria-label="데이터 안내">ⓘ</button>
                </div>
                <div class="gh-list">${rows}</div>
            </div>`;
            box.style.display = '';

            // 클릭 핸들러 — 인라인 onclick에 JSON 임베드 시 따옴표 충돌 → addEventListener로 분리
            box.querySelectorAll('.gh-row[data-gh-idx]').forEach(el => {
                el.addEventListener('click', () => {
                    const i = parseInt(el.dataset.ghIdx, 10);
                    const tk = el.dataset.ghTicker;
                    const arr = (window._ghDataCache || {})[tk];
                    const g = arr && arr[i];
                    if (g) _ghOpenSheet(g);
                });
            });
        } catch (e) {
            warn('[guruHolders] render fail', e);
        }
    }

    function _ghShowInfo(btn) {
        const tip = document.getElementById('ghInfoTip');
        if (tip) { tip.remove(); return; }
        const t = document.createElement('div');
        t.id = 'ghInfoTip';
        t.className = 'gh-info-tip';
        t.textContent = '13F 공시 기준 · 분기 단위 · 최대 45일 지연';
        btn.parentNode.appendChild(t);
        setTimeout(() => { document.addEventListener('click', () => t.remove(), { once: true }); }, 0);
    }

    // Bottom Sheet — row 탭 시
    function _ghOpenSheet(g) {
        const sig     = _ghSignal(g.action, g.wtChg);
        const aum     = _ghFmtAUM(g.aum_usd) || '—';
        const valStr  = g.value_usd ? _guruFmtUSD(g.value_usd) : '—';
        const wtStr   = g.action === 'NEW' ? '신규 매수' : (g.weight != null ? Number(g.weight).toFixed(2) + '%' : '—');
        const fundName = escHtml(g.name || g.manager || g.cik || '—');
        const cikSafe = escHtml(g.cik || '');
        let existing = document.getElementById('ghSheet');
        if (existing) existing.remove();

        const sheet = document.createElement('div');
        sheet.id = 'ghSheet';
        sheet.className = 'gh-sheet';
        sheet.innerHTML = `
            <div class="gh-sheet-backdrop" onclick="document.getElementById('ghSheet')?.remove()"></div>
            <div class="gh-sheet-content">
                <div class="gh-sheet-handle"></div>
                <div class="gh-sheet-header">
                    <span class="gh-sheet-title">${fundName}</span>
                    <button class="gh-sheet-close" onclick="document.getElementById('ghSheet')?.remove()">✕</button>
                </div>
                <div class="gh-sheet-body">
                    <div class="gh-sheet-row"><span>AUM</span><span>${escHtml(aum)}</span></div>
                    <div class="gh-sheet-row"><span>비중</span><span>${escHtml(wtStr)}</span></div>
                    <div class="gh-sheet-row"><span>보유 가치</span><span>${escHtml(valStr)}</span></div>
                    <div class="gh-sheet-row"><span>기준 분기</span><span>${escHtml(g.quarter || '—')}</span></div>
                    <div class="gh-sheet-row"><span>시그널</span><span class="gh-sig ${sig.cls}" style="font-size:12px">${escHtml(sig.label)}</span></div>
                </div>
                <button class="gh-sheet-deepbtn" onclick="document.getElementById('ghSheet')?.remove();goSmartMoneyAndOpen('${cikSafe}')">
                    포트폴리오 전체 보기 →
                </button>
            </div>`;
        document.body.appendChild(sheet);
        requestAnimationFrame(() => sheet.classList.add('show'));
    }

    // ── 종목 역검색: 어떤 기관이 보유 중인지 ─────────────────────
    async function _searchGuruByTicker() {
        const input    = document.getElementById('guruTickerInput');
        const resultEl = document.getElementById('guruTickerResult');
        if (!input || !resultEl) return;
        const ticker = input.value.toUpperCase().trim();
        if (!ticker) { input.focus(); return; }

        resultEl.innerHTML = `<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:12px">
            🔍 <strong style="color:var(--text)">${ticker}</strong> 보유 기관 검색 중...</div>`;
        try {
            const r = await fetch(`/api/guru-ticker?ticker=${encodeURIComponent(ticker)}`);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();

            if (!data.holders || !data.holders.length) {
                resultEl.innerHTML = `<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:12px">
                    등록된 기관 중 <strong style="color:var(--text)">${ticker}</strong>를 보유한 곳이 없어요.
                    <div style="font-size:10px;margin-top:4px">13F 공시 기준 · 현재 등록된 ${data.total !== undefined ? data.total : 24}개 기관만 검색됩니다</div>
                </div>`;
                return;
            }

            const rows = data.holders.map(h => {
                const actColor = h.action === 'NEW' ? '#22c55e' : h.action === 'ADD' ? '#3b82f6' :
                                 h.action === 'REDUCE' ? '#f59e0b' : h.action === 'SOLD' ? '#ef4444' : 'var(--text-secondary)';
                const actText  = h.action === 'NEW' ? '🆕 신규' : h.action === 'ADD' ? '➕ 추가' :
                                 h.action === 'REDUCE' ? '➖ 축소' : h.action === 'SOLD' ? '🔴 청산' : '— 유지';
                const valStr   = h.value_usd ? _guruFmtUSD(h.value_usd) : '—';
                return `<div onclick="goSmartMoneyAndOpen('${h.cik}')"
                    style="display:flex;justify-content:space-between;align-items:center;
                           padding:9px 8px;border-bottom:1px solid var(--border);cursor:pointer;
                           border-radius:6px;transition:background 0.1s"
                    onmouseover="this.style.background='var(--bg3,var(--bg2))'"
                    onmouseout="this.style.background=''">
                    <div style="display:flex;align-items:center;gap:8px">
                        <span style="font-size:20px;line-height:1">${h.emoji || '💎'}</span>
                        <div>
                            <div style="font-size:12px;font-weight:700;color:var(--text)">${escHtml(h.manager || h.name || '—')}</div>
                            <div style="font-size:10px;color:var(--text-secondary)">${escHtml(h.name || '')} · ${h.quarter || '—'}</div>
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-size:13px;font-weight:700;color:var(--text)">${Number(h.weight||0).toFixed(2)}%</div>
                        <div style="font-size:10px;color:var(--text-secondary)">${valStr}</div>
                        <div style="font-size:11px;font-weight:600;color:${actColor};margin-top:1px">${actText}</div>
                    </div>
                </div>`;
            }).join('');

            resultEl.innerHTML = `
                <div style="display:flex;align-items:center;gap:6px;padding:6px 2px;
                            font-size:11px;color:var(--text-secondary);
                            border-bottom:1px solid var(--border);margin-bottom:4px">
                    <img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(ticker)}?format=png"
                         style="width:16px;height:16px;border-radius:3px;object-fit:contain" alt="" onerror="this.style.display='none'"/>
                    <strong style="color:var(--text)">${ticker}</strong> 보유 기관
                    <span style="background:rgba(59,130,246,0.15);color:#3b82f6;
                                 padding:1px 8px;border-radius:8px;font-weight:700">${data.total}개</span>
                    <span style="margin-left:auto;font-size:10px;opacity:.6">13F 기준 · 45일 지연</span>
                </div>
                ${rows}`;
        } catch(e) {
            resultEl.innerHTML = `<div style="padding:12px;text-align:center;color:#ef4444;font-size:12px">
                ⚠️ 검색 실패: ${escHtml(e.message)}</div>`;
        }
    }

    function goSmartMoneyAndOpen(cik) {
        goSmartMoney();
        setTimeout(() => { switchSmTab('real'); guruDeepDiveReal(cik); }, 50);
    }

    function goSmartMoneyAndOpenReal() {
        goSmartMoney();
        setTimeout(() => switchSmTab('real'), 50);
    }

    // 홈 화면 부자 포트폴리오 프리뷰
    async function loadGuruHome() {
        const sec  = document.getElementById('guruHomeSection');
        const list = document.getElementById('guruHomeList');
        if (!sec || !list) return;
        sec.style.display = '';
        // 스켈레톤 UI — guru-swipe-card 레이아웃과 동일한 세로 구조
        const guruSkel = `<div class="guru-swipe-card guru-swipe-skel">
            <div class="guru-skel-avatar skel-block"></div>
            <div class="guru-skel-name skel-block"></div>
            <div class="guru-skel-manager skel-block"></div>
            <div class="guru-skel-chips">
                <div class="guru-skel-chip skel-block"></div>
                <div class="guru-skel-chip skel-block"></div>
                <div class="guru-skel-chip skel-block"></div>
            </div>
            <div class="guru-skel-aum skel-block"></div>
        </div>`;
        list.className = 'guru-swipe';
        list.innerHTML = guruSkel.repeat(5);
        try {
            const r = await fetch('/api/guru');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const gurus = await r.json();
            if (!gurus.length) {
                list.className = '';
                list.innerHTML = '<div class="swing-empty">데이터 준비 중</div>';
                return;
            }
            // 데이터 있는 것 우선, 부족하면 빈 카드로 채워 총 8개 (스와이프 가독성)
            const withData = gurus.filter(g => g.aum_usd || (g.top3 && g.top3.length));
            const empty = gurus.filter(g => !(g.aum_usd || (g.top3 && g.top3.length)));
            const picked = withData.slice(0, 8);
            while (picked.length < 8 && empty.length) picked.push(empty.shift());
            list.innerHTML = picked.map(g => {
                const isEmpty = !(g.aum_usd || (g.top3 && g.top3.length));
                const aumBlock = isEmpty
                    ? `<div class="guru-swipe-aum muted">데이터 없음</div>`
                    : `<div class="guru-swipe-aum">${_guruFmtUSD(g.aum_usd)}</div>`;
                const chips = (g.top3 || [])
                    .slice(0, 3)
                    .map(t => `<span class="guru-home-chip">${escHtml(t.ticker)} ${Number(t.weight).toFixed(1)}%</span>`)
                    .join('');
                const body = isEmpty
                    ? `<div class="guru-swipe-empty">⚠️ 13F 데이터 미수집</div>`
                    : (chips ? `<div class="guru-home-holdings">${chips}</div>` : '<div class="guru-home-holdings"></div>');
                const handler = isEmpty
                    ? `onclick="alert('13F 데이터가 아직 수집되지 않았습니다.\\n잠시 후 다시 시도해 주세요.')"`
                    : `onclick="goSmartMoneyAndOpen('${g.cik}')"`;
                return `<div class="guru-swipe-card ${isEmpty ? 'guru-card-disabled' : ''}" ${handler}>
                    ${_guruAvatar(g)}
                    <div class="guru-swipe-name">${escHtml(g.name)}</div>
                    <div class="guru-swipe-manager">${escHtml(g.manager || '')}</div>
                    ${body}
                    ${aumBlock}
                </div>`;
            }).join('');
        } catch (e) {
            list.className = '';
            list.innerHTML = '<div class="swing-empty">데이터를 불러올 수 없습니다</div>';
        }
    }

    function _smActionLabel(a) {
        return {new:'신규',add:'추가',reduce:'축소',cut:'청산',hold:'유지'}[a] || a;
    }
    function _smFmtShares(aum, wt, avgPrice) {
        // aum: 단위 10억달러(B), wt: %, avgPrice: $
        const n = (aum * 1e9 * wt / 100) / avgPrice;
        if (n >= 1e9) return `${(n/1e9).toFixed(2)}B주`;
        if (n >= 1e6) return `${(n/1e6).toFixed(2)}M주`;
        if (n >= 1e3) return `${Math.round(n/1e3)}K주`;
        return `${Math.round(n)}주`;
    }

    function smDeepBack() {
        document.getElementById('smDeep').style.display = 'none';
        document.getElementById('smPanelTop10').classList.add('active');
        document.getElementById('smTabTop10').classList.add('active');
        document.getElementById('smTabGuru').classList.remove('active');
        document.getElementById('smPanelGuru').classList.remove('active');
    }

    async function filterSmHoldings(id, filter) {
        smCurrentFilter = filter;
        // id format: 'hot_xxx' or 'kingdom_xxx'
        const [mode, instId] = id.split('_');
        const dataset = mode === 'hot' ? SM_HOT : SM_KINGDOM;
        const inst = dataset.find(i => i.id === instId);
        if (!inst) return;
        // 캐시에서 상장폐지 재필터 (첫 딥다이브에서 이미 채워짐)
        const tickers = (inst.holdings || []).map(h => h.ticker).filter(Boolean);
        const validSet = await _filterValidTickers(tickers);
        const filteredInst = { ...inst, holdings: (inst.holdings || []).filter(h => validSet.has(h.ticker)) };
        document.getElementById('smDeep').innerHTML = mode === 'hot' ? _renderDeepHot(filteredInst) : _renderDeepKingdom(filteredInst);
    }

    function smChartLink(ticker, avgPrice, fundName) {
        pendingSmartMoneyLine = { price: avgPrice, label: '💼 ' + fundName.substring(0, 14) };
        document.getElementById('smartMoneyScreen').style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('searchInput').value = ticker;
        searchStock();
    }

    // ========================================

    // Korean Stock Name Mapping (주요 종목)
    // ========================================
    const KR_STOCK_NAMES = {
        '005930':'삼성전자','000660':'SK하이닉스','035420':'NAVER','035720':'카카오',
        '005380':'현대차','000270':'기아','006400':'삼성SDI','051910':'LG화학',
        '003670':'포스코홀딩스','105560':'KB금융','055550':'신한지주','096770':'SK이노베이션',
        '034730':'SK','015760':'한국전력','003550':'LG','032830':'삼성생명',
        '086790':'하나금융지주','066570':'LG전자','028260':'삼성물산','012330':'현대모비스',
        '030200':'KT','017670':'SK텔레콤','316140':'우리금융지주','009150':'삼성전기',
        '034020':'두산에너빌리티','010130':'고려아연','033780':'KT&G','011200':'HMM',
        '010950':'S-Oil','000810':'삼성화재','018260':'삼성에스디에스','036570':'NCsoft',
        '259960':'크래프톤','251270':'넷마블','263750':'펄어비스','352820':'하이브',
        '293490':'카카오게임즈','041510':'에스엠','122870':'YG엔터','047810':'한국항공우주',
        '012450':'한화에어로스페이스','042700':'한미반도체','403870':'HPSP','460860':'피엠티',
        '247540':'에코프로비엠','086520':'에코프로','373220':'LG에너지솔루션',
        '207940':'삼성바이오로직스','068270':'셀트리온','326030':'SK바이오팜',
        '196170':'알테오젠','000100':'유한양행','128940':'한미약품','006800':'미래에셋증권',
        '005490':'포스코','009540':'한국조선해양','010140':'삼성중공업',
        '329180':'현대중공업','042660':'한화오션','090430':'아모레퍼시픽',
        '051900':'LG생활건강','021240':'코웨이','004020':'현대제철','005830':'DB손해보험',
        '139480':'이마트','004170':'신세계','069500':'KODEX 200','005940':'NH투자증권',
        '024110':'기업은행','000720':'현대건설','010620':'현대미포조선','002790':'아모레G',
        '011070':'LG이노텍','009830':'한화솔루션','267250':'현대일렉트릭','298050':'효성첨단소재',
        '180640':'한진칼','003490':'대한항공','020560':'아시아나항공','078930':'GS',
        '138040':'메리츠금융지주','001450':'현대해상','036460':'한국가스공사','161390':'한국타이어앤테크놀로지',
        '114800':'KODEX 인버스','252670':'KODEX 레버리지',
        '233740':'KODEX 코스닥150레버리지','091160':'KODEX 반도체',
        '102110':'TIGER 200','229200':'KODEX 코스닥150',
        '251340':'KODEX 코스닥150인버스','360750':'TIGER 미국S&P500',
    };

    // 미국 주식 한글명 → 티커 매핑
    const US_STOCK_NAMES = {
        '애플':'AAPL','아마존':'AMZN','구글':'GOOGL','알파벳':'GOOGL',
        '마이크로소프트':'MSFT','메타':'META','페이스북':'META',
        '테슬라':'TSLA','엔비디아':'NVDA','넷플릭스':'NFLX',
        '아이폰':'AAPL','MS':'MSFT','구글A':'GOOGL','구글C':'GOOG',
        '알파벳A':'GOOGL','알파벳C':'GOOG',
        'AMD':'AMD','어드밴스트마이크로디바이시스':'AMD',
        '인텔':'INTC','퀄컴':'QCOM','브로드컴':'AVGO',
        '애플':'AAPL','코스트코':'COST','월마트':'WMT',
        '스타벅스':'SBUX','맥도날드':'MCD','나이키':'NKE','코카콜라':'KO',
        '펩시코':'PEP','펩시':'PEP','디즈니':'DIS','월트디즈니':'DIS',
        '비자':'V','마스터카드':'MA','페이팔':'PYPL',
        'JP모건':'JPM','제이피모건':'JPM','골드만삭스':'GS',
        '버크셔해서웨이':'BRK-B','버크셔':'BRK-B','워렌버핏':'BRK-B',
        '존슨앤존슨':'JNJ','존슨앤드존슨':'JNJ','화이자':'PFE',
        '모더나':'MRNA','일라이릴리':'LLY','릴리':'LLY',
        '유나이티드헬스':'UNH','애브비':'ABBV',
        '프록터앤갬블':'PG','P&G':'PG',
        '엑슨모빌':'XOM','셰브론':'CVX','쉐브론':'CVX',
        '보잉':'BA','록히드마틴':'LMT','레이시온':'RTX',
        '캐터필러':'CAT','쓰리엠':'MMM','3M':'MMM',
        '홈디포':'HD','세일즈포스':'CRM','어도비':'ADBE',
        '오라클':'ORCL','IBM':'IBM','시스코':'CSCO',
        '우버':'UBER','에어비앤비':'ABNB',
        '팔란티어':'PLTR','스노우플레이크':'SNOW',
        '크라우드스트라이크':'CRWD','데이터독':'DDOG',
        '쇼피파이':'SHOP','스퀘어':'SQ','블록':'SQ',
        '줌':'ZM','줌비디오':'ZM','로블록스':'RBLX',
        '로켓랩':'RKLB','리비안':'RIVN','루시드':'LCID','니오':'NIO',
        '샤오펑':'XPEV','리오토':'LI',
        'ARM':'ARM','아르키메데스':'ARM','아름':'ARM',
        '마이크론':'MU','어플라이드머티리얼즈':'AMAT',
        'ASML':'ASML','램리서치':'LRCX','KLA':'KLAC',
        '팔란티어':'PLTR','슈퍼마이크로':'SMCI',
        'TSM':'TSM','TSMC':'TSM','대만반도체':'TSM',
        '소파이':'SOFI','코인베이스':'COIN',
        '로빈후드':'HOOD','인튜이트':'INTU',
        '서비스나우':'NOW','몽고DB':'MDB',
        '트레이드데스크':'TTD','유니티':'U',
        '클라우드플레어':'NET','클플':'NET','NET':'NET','넷':'NET',
        '지스케일러':'ZS','옥타':'OKTA','팔로알토':'PANW','팔로알토네트웍스':'PANW',
        '포티넷':'FTNT','워크데이':'WDAY','도큐사인':'DOCU',
        '핀터레스트':'PINS','스냅':'SNAP','레딧':'RDDT','듀오링고':'DUOL',
        '애플로빈':'APP','애플로빈Corp':'APP',
        '하임스':'HIMS','이온큐':'IONQ','디웨이브':'QBTS','리게티':'RGTI',
        '아리스타':'ANET','자일링스':'XLNX','마벨':'MRVL','어플라이드디지털':'APLD',
        'AT&T':'T','버라이즌':'VZ','티모바일':'TMUS',
        // ETF
        'S&P500':'SPY','SPY':'SPY','나스닥':'QQQ','QQQ':'QQQ',
        '다우존스':'DIA','러셀2000':'IWM',
        '반도체ETF':'SOXX','기술주ETF':'XLK',
        '금ETF':'GLD','은ETF':'SLV','원유ETF':'USO',
        '비트코인ETF':'IBIT','채권ETF':'TLT',
        '레버리지나스닥':'TQQQ','인버스나스닥':'SQQQ',
        '레버리지S&P':'SPXL','인버스S&P':'SPXS',
        'SOXL':'SOXL','레버리지반도체':'SOXL',
    };

    // ── 빅테크 제외 필터 ──────────────────────────────────────────────
    const BIG_TECH_SYMBOLS = new Set([
        'AAPL','MSFT','GOOGL','GOOG','AMZN','META','NVDA','TSLA',
        'NFLX','ORCL','ADBE','CRM','INTC','AMD','QCOM','AVGO','COST',
        'JPM','V','MA','BRK-B','UNH','JNJ','LLY','PG','HD','MRK'
    ]);
    function _isBigTech(symbol, marketCap) {
        return BIG_TECH_SYMBOLS.has(symbol) || (marketCap && marketCap > 200e9);
    }

    const US_ETF_NAMES = {
        'SPY':{ name:'SPDR S&P 500 ETF',              korean:['에스피와이','S&P500','스파이'],           sector:'Index',        themes:['sp500'] },
        'QQQ':{ name:'Invesco QQQ Trust',              korean:['큐큐큐','나스닥100'],                    sector:'Index',        themes:['nasdaq100'] },
        'IWM':{ name:'iShares Russell 2000 ETF',       korean:['러셀2000','소형주'],                     sector:'Index',        themes:['smallcap'] },
        'DIA':{ name:'SPDR Dow Jones ETF',             korean:['다우존스','DIA'],                        sector:'Index',        themes:['dow'] },
        'VTI':{ name:'Vanguard Total Market ETF',      korean:['VTI','전체시장'],                        sector:'Index',        themes:['totalmarket'] },
        'VOO':{ name:'Vanguard S&P 500 ETF',           korean:['VOO','뱅가드'],                          sector:'Index',        themes:['sp500'] },
        'TQQQ':{ name:'ProShares UltraPro QQQ',        korean:['티큐큐큐','3배레버리지나스닥'],          sector:'Leveraged',    themes:['3x','nasdaq'] },
        'SQQQ':{ name:'ProShares UltraPro Short QQQ',  korean:['인버스나스닥','3배인버스'],               sector:'Inverse',      themes:['inverse','nasdaq'] },
        'SOXL':{ name:'Direxion Semi Bull 3X',         korean:['SOXL','레버리지반도체','반도체3배'],     sector:'Leveraged',    themes:['3x','semiconductor'] },
        'SOXS':{ name:'Direxion Semi Bear 3X',         korean:['SOXS','인버스반도체'],                   sector:'Inverse',      themes:['inverse','semiconductor'] },
        'SOXX':{ name:'iShares Semiconductor ETF',     korean:['반도체ETF','SOXX'],                      sector:'Sector',       themes:['semiconductor'] },
        'SMH':{ name:'VanEck Semiconductor ETF',       korean:['SMH','반도체'],                          sector:'Sector',       themes:['semiconductor'] },
        'SPXL':{ name:'Direxion S&P 500 Bull 3X',      korean:['레버리지S&P','SPXL'],                   sector:'Leveraged',    themes:['3x','sp500'] },
        'SPXS':{ name:'Direxion S&P 500 Bear 3X',      korean:['인버스S&P','SPXS'],                     sector:'Inverse',      themes:['inverse','sp500'] },
        'XLK':{ name:'Technology Select SPDR',         korean:['기술주ETF','XLK'],                       sector:'Sector',       themes:['tech'] },
        'XLF':{ name:'Financial Select SPDR',          korean:['금융ETF','XLF'],                         sector:'Sector',       themes:['finance'] },
        'XLE':{ name:'Energy Select SPDR',             korean:['에너지ETF','XLE'],                       sector:'Sector',       themes:['energy'] },
        'XLV':{ name:'Health Care Select SPDR',        korean:['헬스케어ETF','XLV'],                     sector:'Sector',       themes:['healthcare'] },
        'ARKK':{ name:'ARK Innovation ETF',            korean:['아크이노베이션','ARKK','캐시우드'],       sector:'Thematic',     themes:['innovation'] },
        'ARKG':{ name:'ARK Genomic Revolution ETF',    korean:['아크유전체','ARKG'],                      sector:'Thematic',     themes:['genomics'] },
        'GLD':{ name:'SPDR Gold Shares',               korean:['금ETF','골드ETF','GLD'],                  sector:'Commodity',    themes:['gold'] },
        'SLV':{ name:'iShares Silver Trust',           korean:['은ETF','SLV'],                           sector:'Commodity',    themes:['silver'] },
        'USO':{ name:'United States Oil Fund',         korean:['원유ETF','USO'],                          sector:'Commodity',    themes:['oil'] },
        'TLT':{ name:'iShares 20+ Year Treasury',      korean:['장기채권ETF','TLT','채권ETF'],            sector:'Bond',         themes:['bond'] },
        'HYG':{ name:'iShares High Yield Corp Bond',   korean:['하이일드채권','HYG'],                    sector:'Bond',         themes:['highyield'] },
        'VNQ':{ name:'Vanguard Real Estate ETF',       korean:['리츠ETF','VNQ'],                         sector:'Real Estate',  themes:['reit'] },
        'IBIT':{ name:'iShares Bitcoin Trust',         korean:['비트코인ETF','IBIT'],                    sector:'Crypto',       themes:['bitcoin'] },
        'EEM':{ name:'iShares MSCI Emerging Markets',  korean:['신흥국ETF','EEM'],                        sector:'International',themes:['emerging'] },
        'EWJ':{ name:'iShares MSCI Japan ETF',         korean:['일본ETF','EWJ'],                         sector:'International',themes:['japan'] },
        'MCHI':{ name:'iShares MSCI China ETF',        korean:['중국ETF','MCHI'],                        sector:'International',themes:['china'] },
        'VXX':{ name:'iPath S&P 500 VIX ETF',          korean:['VIX','변동성ETF','공포지수'],            sector:'Volatility',   themes:['vix'] },
        'UVXY':{ name:'ProShares Ultra VIX ETF',       korean:['VIX레버리지','UVXY'],                    sector:'Volatility',   themes:['vix'] },
        'FNGU':{ name:'MicroSectors FANG+ 3X ETN',     korean:['FNGU','팡플러스레버리지'],               sector:'Leveraged',    themes:['fang','3x'] },
        'FNGD':{ name:'MicroSectors FANG+ -3X ETN',    korean:['FNGD','팡인버스'],                       sector:'Inverse',      themes:['fang','inverse'] },
        'BITO':{ name:'ProShares Bitcoin Strategy',    korean:['비트코인선물ETF','BITO'],                 sector:'Crypto',       themes:['bitcoin'] },
        'LQD':{ name:'iShares IG Corporate Bond',      korean:['투자등급채권','LQD'],                    sector:'Bond',         themes:['bond'] },
    };

    // 한글 별칭 통합 맵 — US_STOCK_NAMES + US_ETF_NAMES.korean 병합, 공백 제거 정규화
    // function 선언식으로 호이스팅 → TDZ 없음 (파일 초기화 중 호출돼도 안전)
    function _normKor(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
    const KOR_TO_US_TICKER = (() => {
        const m = {};
        for (const [kor, t] of Object.entries(US_STOCK_NAMES)) {
            m[_normKor(kor)] = t;
        }
        for (const [ticker, etf] of Object.entries(US_ETF_NAMES)) {
            m[_normKor(ticker)] = ticker;
            (etf.korean || []).forEach(k => { m[_normKor(k)] = ticker; });
        }
        return m;
    })();

    const ASSET_META = (() => {
        const m = {};
        const usStockSectors = {
            'AAPL':'Technology','MSFT':'Technology','GOOGL':'Technology','GOOG':'Technology',
            'AMZN':'Consumer','META':'Technology','TSLA':'EV','NVDA':'Semiconductor',
            'AMD':'Semiconductor','INTC':'Semiconductor','QCOM':'Semiconductor','AVGO':'Semiconductor',
            'MU':'Semiconductor','AMAT':'Semiconductor','ASML':'Semiconductor','TSM':'Semiconductor',
            'ARM':'Semiconductor','SMCI':'Technology',
            'NFLX':'Entertainment','DIS':'Entertainment','RBLX':'Gaming',
            'PLTR':'Software','SNOW':'Software','CRM':'Software','ADBE':'Software','ORCL':'Software',
            'NOW':'Software','MDB':'Software','DDOG':'Software','CRWD':'Software','NET':'Software',
            'PANW':'Software','FTNT':'Software','TTD':'AdTech',
            'JPM':'Finance','GS':'Finance','MS':'Finance','BAC':'Finance','V':'Finance','MA':'Finance',
            'PYPL':'Fintech','COIN':'Crypto','SOFI':'Fintech','HOOD':'Fintech','SQ':'Fintech',
            'XOM':'Energy','CVX':'Energy','BA':'Aerospace','LMT':'Defense','RTX':'Defense',
            'UBER':'Transport','ABNB':'Travel','SHOP':'Ecommerce',
            'JNJ':'Healthcare','PFE':'Healthcare','MRNA':'Biotech','LLY':'Pharma','ABBV':'Pharma',
            'UNH':'Healthcare','ISRG':'Healthcare','REGN':'Biotech','GILD':'Biotech',
            'WMT':'Retail','COST':'Retail','HD':'Retail','SBUX':'Consumer','MCD':'Consumer',
            'KO':'Consumer','PEP':'Consumer','NKE':'Consumer','T':'Telecom','VZ':'Telecom','TMUS':'Telecom',
            'MSTR':'Crypto','MARA':'Crypto','RIOT':'Crypto','BRK-B':'Conglomerate',
            'UNP':'Transport','FDX':'Transport','UPS':'Transport','IBM':'Technology','CSCO':'Technology',
            'INTU':'Software','TXN':'Semiconductor',
        };
        for (const [ticker, sector] of Object.entries(usStockSectors)) {
            m[ticker] = { type:'stock', sector, market:'US' };
        }
        for (const [ticker, etf] of Object.entries(US_ETF_NAMES)) {
            m[ticker] = { type:'etf', sector:etf.sector, market:'US' };
        }
        for (const code of Object.keys(KR_STOCK_NAMES)) {
            const name = KR_STOCK_NAMES[code];
            const isEtf = /^(KODEX|TIGER|KOSEF|KBSTAR|ARIRANG|HANARO)/.test(name);
            m[code] = { type: isEtf ? 'etf' : 'stock', sector: isEtf ? 'ETF' : '한국주식', market:'KR' };
        }
        return m;
    })();

    // Search by name (reverse lookup)
    // 입력어로 마켓 자동 감지 (KR / US)
    function autoDetectMarket(query) {
        const q = query.trim();
        const qn = _normKor(q);
        // 6자리 숫자 → 한국 종목코드
        if (/^\d{6}$/.test(q)) return 'KR';
        // 한국 종목명 정확 매칭
        for (const [, name] of Object.entries(KR_STOCK_NAMES)) {
            if (name === q || name.toLowerCase() === q.toLowerCase()) return 'KR';
        }
        // 영문 티커 (알파벳/숫자/점/하이픈) → 미국
        if (/^[A-Za-z0-9.\-]+$/.test(q)) return 'US';
        // 미국 종목 한글명 정확/정규화 매칭 (ETF 한글 별칭 포함)
        if (KOR_TO_US_TICKER[qn]) return 'US';
        if (US_STOCK_NAMES[q]) return 'US';
        for (const [name] of Object.entries(US_STOCK_NAMES)) {
            if (name.toLowerCase() === q.toLowerCase()) return 'US';
        }
        // 한국 종목명 부분 매칭
        for (const [, name] of Object.entries(KR_STOCK_NAMES)) {
            if (name.includes(q)) return 'KR';
        }
        // 미국 종목 한글명 부분 매칭
        for (const [name] of Object.entries(US_STOCK_NAMES)) {
            if (name.includes(q)) return 'US';
        }
        return 'US'; // 기본값
    }

    function findKRCode(query) {
        const q = query.trim();
        if (/^\d{6}$/.test(q)) return q;
        // 정확 매칭
        for (const [code, name] of Object.entries(KR_STOCK_NAMES)) {
            if (name === q || name.toLowerCase() === q.toLowerCase()) return code;
        }
        // 부분 매칭 (입력어를 포함하는 종목)
        for (const [code, name] of Object.entries(KR_STOCK_NAMES)) {
            if (name.includes(q) || name.toLowerCase().includes(q.toLowerCase())) return code;
        }
        return q;
    }

    // 미국 주식 한글명 → 티커 변환
    function findUSTicker(query) {
        const q = query.trim();
        // 이미 영문 티커면 그대로
        if (/^[A-Za-z.\-]+$/.test(q)) return q.toUpperCase();
        // 정규화(공백 제거·소문자) 후 통합 맵 조회 — ETF 한글 별칭까지 커버
        const qn = _normKor(q);
        if (KOR_TO_US_TICKER[qn]) return KOR_TO_US_TICKER[qn];
        // 정확 매칭
        if (US_STOCK_NAMES[q]) return US_STOCK_NAMES[q];
        // 대소문자 무시 매칭
        for (const [name, ticker] of Object.entries(US_STOCK_NAMES)) {
            if (name.toLowerCase() === q.toLowerCase()) return ticker;
        }
        // 부분 매칭 (정규화 기준)
        for (const [kname, ticker] of Object.entries(KOR_TO_US_TICKER)) {
            if (kname.includes(qn) || qn.includes(kname)) return ticker;
        }
        return q.toUpperCase();
    }

    // ========================================

    // Search Stock
    // ========================================
    async function searchStock() {
        let query = document.getElementById('searchInput').value.trim();
        if (!query) { showToast('종목코드 또는 종목명을 입력해주세요.'); return; }

        // ── HK 파생상품(워런트·CBBC) 차단 ──
        // 5자리 이상 숫자 + .HK = 워런트/CBBC (일반 주식은 4자리 이하)
        // 예: 64257.HK, 12345.HK 등 — 일반 투자자에게 권장되지 않는 고위험 파생상품
        if (/^\d{5,}\.hk$/i.test(query)) {
            showToast('홍콩 워런트·CBBC(파생상품)는 지원하지 않습니다.');
            return;
        }

        // 마켓 자동 감지
        currentMarket = autoDetectMarket(query);
        document.querySelectorAll('.market-btn').forEach(b => b.classList.toggle('active', b.dataset.market === currentMarket));

        let symbol;
        if (currentMarket === 'KR') {
            const code = findKRCode(query);
            // Try KOSPI first, then KOSDAQ
            symbol = code + '.KS';
            currentSymbol = code;
        } else {
            symbol = findUSTicker(query);
            currentSymbol = symbol;
        }

        showLoading('주가 데이터를 불러오는 중...');

        try {
            // Fetch chart data
            const range = currentPeriod;
            const interval = currentInterval;
            // Yahoo Finance가 직접 제공하지 않는 인터벌(3분/10분/년봉)은 작은 단위로 받아서 클라이언트에서 집계
            const aggCfg = INTERVAL_AGG[interval] || { yahoo: interval, factor: 1 };
            const yahooInterval = aggCfg.yahoo;
            // includePrePost=true → 프리/애프터마켓 데이터 포함
            const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${yahooInterval}&includePrePost=true`;
            let data = await fetchWithProxy(chartUrl);

            // If KR stock fails with .KS, try .KQ (KOSDAQ)
            if (currentMarket === 'KR' && (!data.chart?.result || data.chart?.error)) {
                symbol = currentSymbol + '.KQ';
                const chartUrl2 = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${currentPeriod}&interval=${yahooInterval}&includePrePost=true`;
                data = await fetchWithProxy(chartUrl2);
            }

            if (!data.chart?.result?.[0]) {
                throw new Error('종목을 찾을 수 없습니다.');
            }

            stockData = data.chart.result[0];

            // 집계 필요한 인터벌(3분/10분/년봉)은 클라이언트에서 N봉 합치기
            if (aggCfg.factor > 1 && stockData?.indicators?.quote?.[0] && stockData?.timestamp) {
                const agg = _aggregateBars(stockData.indicators.quote[0], stockData.timestamp, aggCfg.factor);
                stockData.indicators.quote[0] = agg.quote;
                stockData.timestamp = agg.timestamps;
            }
            currentFullSymbol = symbol;  // 실시간 업데이트용 풀 심볼 저장

            // 브라우저 뒤로가기 지원 — popstate 재호출 시에는 skip
            if (!_historySkip) {
                history.pushState(
                    { view: 'stock', symbol: currentSymbol, market: currentMarket },
                    '',
                    `?s=${encodeURIComponent(currentSymbol)}`
                );
            }

            // 최근 본 종목 저장
            try {
                const _m = stockData.meta;
                const _cls = (stockData.indicators?.quote?.[0]?.close || []).filter(v=>v!=null);
                const _p  = _m.regularMarketPrice ?? _cls[_cls.length-1];
                const _pc = _m.chartPreviousClose ?? (_cls.length>1?_cls[_cls.length-2]:_p);
                const _chgPct = _pc ? (_p-_pc)/_pc*100 : 0;
                saveRecentStock(currentSymbol, _m.longName||_m.shortName||currentSymbol, _p, _chgPct, currentMarket);
                // 브라우저 탭 제목에 티커 표시
                try {
                    document.title = `${currentSymbol} — StockAI`;
                } catch(_) {}
            } catch(e) {}

            // Show stock UI, hide all screens
            _restoreHeaderChrome();
            document.getElementById('welcomeScreen').style.display = 'none';
            document.getElementById('visionScannerScreen').style.display = 'none';
            const _alpha = document.getElementById('alphaScannerScreen'); if (_alpha) _alpha.style.display = 'none';
            const _sm = document.getElementById('smartMoneyScreen'); if (_sm) _sm.style.display = 'none';
            const _fav = document.getElementById('favScreen'); if (_fav) _fav.style.display = 'none';
            const _eco = document.getElementById('economicSection'); if (_eco) _eco.style.display = 'none';
            const _t100 = document.getElementById('top100Screen'); if (_t100) _t100.style.display = 'none';
            const _cat = document.getElementById('catalystScreen'); if (_cat) _cat.style.display = 'none';
            const _ern = document.getElementById('earningsScreen'); if (_ern) _ern.style.display = 'none';
            const _lev = document.getElementById('leverageScreen'); if (_lev) _lev.style.display = 'none';
            const _pos = document.getElementById('positionScreen'); if (_pos) _pos.style.display = 'none';
                window._vsActive = false;
            document.getElementById('stockHero').classList.add('show');
            document.getElementById('tabNav').classList.add('show');
            document.getElementById('mainContent').style.display = '';
            window.scrollTo(0, 0);
            switchTab('chart');

            // 즉시 렌더링 → 로딩 해제
            renderStockHeader(symbol);
            updateFavButton();
            renderPriceChart();
            hideLoading();
            // 종목비교 오버레이 자동 갱신
            try { _cmpRefreshIfActive?.(); } catch(_) {}

            // 로컬 계산 지표 (빠름)
            renderTechnicalIndicators();
            renderRSIChart();
            renderMACDChart();
            renderADXChart();
            renderOBVChart();
            renderEntryTiming();
            renderAIAnalysis();
            renderRRAnalysis();
            try { _renderMultiFactorCard(); } catch (e) { warn('[mf] render fail', e); }
            try { _renderSEPACard(); } catch (e) { warn('[sepa-card] render fail', e); }
            try { renderMinerviniSEPA(); } catch (e) { warn('[sepa-chart] render fail', e); }
            try { // SEPA 토글 상태 적용
                const _sepaEl = document.getElementById('sepaAnalysis');
                if (_sepaEl) { if (typeof _chartSepaEnabled !== 'undefined' && !_chartSepaEnabled) _sepaEl.classList.add('sepa-hidden'); else _sepaEl.classList.remove('sepa-hidden'); }
            } catch(_) {}
            try { renderSwingAnalysis(); } catch (e) { warn('[swing] render fail', e); }

            try { renderMyPosition(); } catch (e) { warn("[mypos] render fail", e); }
            try { if (typeof renderGuruHolders === 'function' && typeof currentSymbol !== 'undefined') renderGuruHolders(currentSymbol); } catch {}
            // RSI 모멘텀 / MACD / Volume 카드 — 종목 기본 정보 그룹 제거(v730)되어 target div 없음, 호출 생략

            // 추가 API 호출이 필요한 것들은 병렬로 실행 (await 안 함 → UI 블로킹 없음)
            // safeRenderTab: 한 탭 에러가 다른 탭/화면에 전파되지 않도록 격리
            fetchMarketSession(symbol);
            render52WRange(symbol);
            renderLongTermStats(symbol);
            safeRenderTab('info', () => {
                renderFinancialInfo(symbol);
                renderStatisticsInfo(symbol);
                renderStockEarnings(symbol);
                renderAnalystTargets(symbol);
            });
            safeRenderTab('company', () => renderCompanyProfile(symbol));

            // 실시간 가격 업데이트 시작 (30초 간격)
            startLiveUpdate();
            // 분석 자동 갱신 시작 (5분 간격)
            startAnalysisRefresh();
            // 차트 시그널 폴링 시작 (60초 간격, RSI/MACD 신규 시그널 토스트)
            startChartSigPoll();
            // Alpaca WebSocket 실시간 캔들 (로컬 + US 종목만)
            startAlpacaWS(symbol);

            // 종목 페이저 초기화 (페이저 이동 중에는 건너뜀)
            if (!window._stockPagerNavigating && typeof initStockPager === 'function') {
                initStockPager(currentSymbol, window._pendingPagerList || null);
                window._pendingPagerList = null;
            }

        } catch(err) {
            const isNotFound = err.message === '종목을 찾을 수 없습니다.'
                || (err.message && (err.message.includes('404') || err.message.includes('not found') || err.message.includes('No data')));
            if (isNotFound) {
                // 헤더 검색창에 "검색 없음" 표시
                const inp = document.getElementById('searchInput');
                const box = inp?.closest('.search-box');
                if (inp && box) {
                    inp.value = '검색 없음';
                    box.classList.add('search-error');
                    const clearError = () => {
                        inp.value = '';
                        box.classList.remove('search-error');
                        inp.removeEventListener('input', clearError);
                    };
                    inp.addEventListener('input', clearError, { once: true });
                    setTimeout(clearError, 2500);
                }
                // 모바일 검색 모달이 열려있으면 모바일 입력창에도 표시
                const mobInp = document.getElementById('mobSearchInput');
                const mobBox = mobInp?.closest('.mob-search-box');
                if (mobInp && mobBox && document.getElementById('mobSearchModal')?.style.display !== 'none') {
                    mobInp.value = '검색 없음';
                    mobBox.classList.add('search-error');
                    const clearMob = () => {
                        mobInp.value = '';
                        mobBox.classList.remove('search-error');
                        mobInp.removeEventListener('input', clearMob);
                    };
                    mobInp.addEventListener('input', clearMob, { once: true });
                    setTimeout(clearMob, 2500);
                }
            } else {
                showToast(err.message || '데이터를 불러오는데 실패했습니다.');
            }
        } finally {
            hideLoading();
        }
    }

    // ========================================