// js/tabs.js
// 책임: 탭 시스템 (차트/종목정보/기업개요/옵션/뉴스/토론)
// 의존: state.js, utils.js, api.js

    // Tab Navigation
    // ========================================
    function switchTab(tabName) {
        document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        // 옵션 탭 클릭 시 데이터 로드 (lazy load)
        if (tabName === 'options' && currentFullSymbol) {
            renderOptionsTab(currentFullSymbol);
        }
        // 뉴스 탭 클릭 시 데이터 로드 (lazy load)
        if (tabName === 'news' && currentFullSymbol) {
            loadNewsTab(currentFullSymbol);
        }
        // 소셜 탭 클릭 시 데이터 로드 (lazy load)
        if (tabName === 'social' && currentFullSymbol) {
            loadSocialTab(currentFullSymbol);
        }
        // 공매도 탭 클릭 시 데이터 로드 (lazy load)
        if (tabName === 'short' && currentFullSymbol) {
            loadShortTab(currentFullSymbol);
        }
        // 유튜브 탭 클릭 시 데이터 로드 (lazy load)
        if (tabName === 'youtube' && currentFullSymbol) {
            loadYouTubeTab(currentFullSymbol);
        }
        // 선택된 탭이 항상 뷰포트 안에 보이도록 스크롤
        const activeTabBtn = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
        if (activeTabBtn) activeTabBtn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }

    // ========================================
    // Tab Isolation Helpers
    // ========================================
    /**
     * 탭 렌더 함수를 안전하게 실행 — 에러가 다른 탭으로 전파되지 않도록 격리
     * renderFn 은 동기 또는 async 모두 지원
     */
    function safeRenderTab(tabName, renderFn) {
        try {
            const result = renderFn();
            // async 함수면 rejected promise도 잡아서 로그만 남김
            if (result && typeof result.catch === 'function') {
                result.catch(err => warn(`[탭:${tabName}] 비동기 렌더 실패:`, err));
            }
        } catch (err) {
            warn(`[탭:${tabName}] 렌더 실패:`, err);
            _renderTabError(tabName);
        }
    }

    /** 탭 내 빈 컨테이너에 에러 상태 UI 삽입 */
    function _renderTabError(tabName) {
        const errorHtml = `<div style="text-align:center;padding:30px 0;color:var(--text3);font-size:13px;">
            불러오기 실패
            <br><button style="margin-top:8px;font-size:12px;color:#0080FB;background:none;border:none;cursor:pointer;text-decoration:underline;"
                onclick="if(currentFullSymbol)switchTab('${tabName}')">재시도</button>
        </div>`;
        const idMap = {
            'info':    ['financeGrid', 'statisticsGrid', 'stockEarnings', 'analystTargets'],
            'company': ['companyOverview', 'companyExecutives', 'companyHolders', 'companyInsider'],
            'options': ['optionsContent'],
            'short':   ['shortContent'],
        };
        (idMap[tabName] || []).forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.textContent.trim()) el.innerHTML = errorHtml;
        });
    }

    // ========================================
    // Alpha Scanner 상태

    // Render Stock Header
    // ========================================
    function renderStockHeader(symbol) {
        if (!stockData?.indicators?.quote?.[0]) return;
        const meta = stockData.meta;
        const quotes = stockData.indicators.quote[0];
        const closes = (quotes.close ?? []).filter(v => v != null);
        // meta에서 실시간 가격 우선 사용 (차트 데이터보다 정확)
        const price = meta.regularMarketPrice ?? closes[closes.length - 1];
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? (closes.length > 1 ? closes[closes.length - 2] : price);
        const change = price - prevClose;
        const changePercent = prevClose ? (change / prevClose * 100) : 0;

        // 상단(stock-name): KR=회사명(한글), US=티커·거래소
        // 하단(stock-code): KR=코드·거래소, US=회사 풀네임
        let name = meta.symbol;
        if (currentMarket === 'KR') {
            const code = currentSymbol;
            const krName = KR_STOCK_NAMES[code] || meta.shortName || meta.longName || code;
            name = krName; // 상단: 한글 회사명
            const exch = meta.exchangeName || 'KRX';
            document.getElementById('stockCode').textContent = `${code} · ${exch}`;
        } else {
            name = `${meta.symbol} · ${meta.exchangeName || 'US'}`;
            const fullName = meta.longName || meta.shortName || meta.symbol;
            document.getElementById('stockCode').textContent = fullName;
        }

        document.getElementById('stockName').textContent = name;
        // AI 요약 (news-reason) 주입 — Top100 과 공유 캐시 재사용
        if (currentMarket === 'US') _populateStockHeroReason(meta.symbol);
        else _hideStockHeroReason();
        // Hero 로고 주입 (Parqet CDN + fallback)
        try {
            const _heroLogo = document.getElementById('stockHeroLogo');
            if (_heroLogo && typeof _tickerLogoHTML === 'function') {
                const _logoSym = currentMarket === 'KR' ? (currentSymbol || meta.symbol) : meta.symbol;
                const _krName = currentMarket === 'KR' ? (KR_STOCK_NAMES[currentSymbol] || meta.shortName || meta.longName) : null;
                _heroLogo.innerHTML = _tickerLogoHTML(_logoSym, currentMarket, _krName || meta.shortName || meta.name || meta.longName);
            }
        } catch {}
        // 모바일 상단 바 종목명 — 스크롤 시 노출될 컴팩트 표시 (종목명+금액+퍼센트)
        const _mobName = document.getElementById('mobStockName');
        if (_mobName) {
            const _hdrName = currentMarket === 'KR' ? name : (meta.symbol || name || '');
            _mobName.innerHTML = `<span class="hdr-stk-name">${escHtml(_hdrName)}</span>`
                + `<span class="hdr-stk-price" id="hdrStkPrice"></span>`
                + `<span class="hdr-stk-chg" id="hdrStkChg"></span>`;
        }
        document.getElementById('mainHeader')?.classList.add('stock-loaded');
        document.getElementById('mainHeader')?.classList.remove('header--show-stock'); // 진입 직후엔 숨김
        document.getElementById('calcFab').style.display = 'flex'; // 종목 진입 시 FAB 표시

        const isKR = currentMarket === 'KR';
        const formatted = isKR
            ? Math.round(price).toLocaleString() + '원'
            : '$' + price.toFixed(2);
        document.getElementById('stockPrice').textContent = formatted;

        const changeEl = document.getElementById('stockChange');
        const sign = change >= 0 ? '+' : '';
        const changeText = isKR
            ? `${sign}${Math.round(change).toLocaleString()}원 (${sign}${changePercent.toFixed(2)}%)`
            : `${sign}$${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)`;
        if (changeEl) {
            changeEl.textContent = changeText;
            changeEl.className = 'stock-change ' + (change > 0 ? 'up' : change < 0 ? 'down' : 'flat');
        }
        document.getElementById('stockPrice').style.color = change > 0 ? 'var(--red)' : change < 0 ? 'var(--blue)' : 'var(--text)';
        // 상단바 컴팩트 종목 표시 동기화 + 스크롤 상태 갱신
        try { _syncHeaderStock(); _updateHeaderStockOnScroll(); } catch(e) {}

        // ── 실적 발표 D-3 배지 (3일 이내일 때만 표시) ──
        if (currentMarket === 'US') _loadStockEarningsBadge(meta.symbol);
        else { const _eb = document.getElementById('stockEarningsBadge'); if (_eb) _eb.style.display = 'none'; }
    }

    // ========================================
    // 실적 발표 D-day 배지 — 3일 이내일 때만 표시
    // ========================================
    function _calcDaysUntil(dateStr) {
        const t = new Date(dateStr + 'T00:00:00');
        const n = new Date(); n.setHours(0,0,0,0);
        return Math.floor((t - n) / 86400000);
    }
    async function _loadStockEarningsBadge(symbol) {
        const el = document.getElementById('stockEarningsBadge');
        if (!el) return;
        el.style.display = 'none'; // 초기화 — 다른 종목 전환 시 잔존 방지
        if (!symbol) return;
        try {
            const today = new Date();
            const to = new Date(today); to.setDate(to.getDate() + 7);
            const fmt = d => d.toISOString().slice(0,10);
            const r = await fetch(`/api/earnings-calendar?from=${fmt(today)}&to=${fmt(to)}&favs=${encodeURIComponent(symbol)}`);
            if (!r.ok) return;
            const data = await r.json();
            const groups = Array.isArray(data.groups) ? data.groups : [];
            // 종목 일치 항목 찾기 (각 그룹의 items 배열)
            let hit = null;
            for (const g of groups) {
                const items = Array.isArray(g.items) ? g.items : [];
                const m = items.find(x => (x.symbol || '').toUpperCase() === symbol.toUpperCase());
                if (m) { hit = m; break; }
            }
            if (!hit || !hit.date) return;
            const days = _calcDaysUntil(hit.date);
            if (days < 0 || days > 3) return; // 3일 이내만
            // 다른 종목으로 전환됐다면 무시 (race condition 방지)
            if (typeof currentFullSymbol === 'string' && currentFullSymbol &&
                currentFullSymbol.toUpperCase() !== symbol.toUpperCase()) return;
            const labelEl = el.querySelector('.stock-earn-badge-dday');
            const timeEl  = document.getElementById('stockEarnBadgeTime');
            if (labelEl) labelEl.textContent = days === 0 ? 'D-DAY' : `D-${days}`;
            if (timeEl) {
                const t = hit.timing;
                timeEl.textContent = t === 'BMO' ? '· 장전' : t === 'AMC' ? '· 장후' : '';
            }
            el.classList.toggle('imminent', days <= 1); // D-1/D-0 강조
            el.style.display = '';
        } catch(_) { /* silent fail */ }
    }

    // ========================================
    // 52-Week Range (고점/저점 대비 현재 위치)
    // ========================================
    async function render52WRange(symbol) {
        const host = document.getElementById('stock52w');
        if (!host) return;
        host.classList.remove('show');
        host.innerHTML = '';

        try {
            // 1년치 일봉 차트로 52W high/low + 기록 날짜 계산
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
            const data = await fetchWithProxy(url);
            const result = data?.chart?.result?.[0];
            if (!result) return;

            const timestamps = result.timestamp || [];
            const closes = (result.indicators?.quote?.[0]?.close || []);
            const highs  = (result.indicators?.quote?.[0]?.high  || []);
            const lows   = (result.indicators?.quote?.[0]?.low   || []);
            const meta = result.meta || {};
            const current = meta.regularMarketPrice ?? closes.filter(v=>v!=null).slice(-1)[0];
            if (current == null || !timestamps.length) return;

            // 최고가/최저가 및 인덱스 찾기 (high/low 배열 우선, 없으면 close로 fallback)
            let hiVal = -Infinity, hiIdx = -1, loVal = Infinity, loIdx = -1;
            for (let i = 0; i < timestamps.length; i++) {
                const h = highs[i] ?? closes[i];
                const l = lows[i]  ?? closes[i];
                if (h != null && h > hiVal) { hiVal = h; hiIdx = i; }
                if (l != null && l < loVal) { loVal = l; loIdx = i; }
            }
            if (!isFinite(hiVal) || !isFinite(loVal) || hiVal <= loVal) return;

            // 퍼센트 계산
            const drawdownPct = ((current - hiVal) / hiVal) * 100;    // 고점 대비 (보통 음수)
            const gainFromLowPct = ((current - loVal) / loVal) * 100; // 저점 대비 (보통 양수)
            const recoverPct = ((hiVal - current) / current) * 100;   // 전고 회복 필요
            const posPct = Math.max(0, Math.min(100, ((current - loVal) / (hiVal - loVal)) * 100));

            // 날짜 포맷 (YYYY.MM.DD)
            const fmtDate = ts => {
                const d = new Date(ts * 1000);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}.${m}.${day}`;
            };
            const fmtPrice = v => {
                if (currentMarket === 'KR') return Math.round(v).toLocaleString() + '원';
                return '$' + v.toFixed(2);
            };

            // 매수 관점 아이콘 결정
            let insight = null;
            const daysSinceHigh = hiIdx >= 0 ? (timestamps.length - 1 - hiIdx) : 999;
            const daysSinceLow  = loIdx >= 0 ? (timestamps.length - 1 - loIdx) : 999;

            if (drawdownPct > -3 && daysSinceHigh <= 5) {
                insight = { cls: 'new-high', icon: '🚀', text: '신고가 부근' };
            } else if (drawdownPct > -5) {
                insight = { cls: 'near-high', icon: '🔺', text: '전고 근접' };
            } else if (gainFromLowPct >= 15 && daysSinceLow <= 30) {
                insight = { cls: 'bounce', icon: '🔥', text: '저점 반등 진행' };
            } else if (drawdownPct <= -30) {
                insight = { cls: 'deep-dip', icon: '💎', text: '저점 매수 관점' };
            } else {
                insight = { cls: 'mid', icon: '·', text: '중간 구간' };
            }

            const ddSign  = drawdownPct >= 0 ? '+' : '';
            const gfSign  = gainFromLowPct >= 0 ? '+' : '';
            const ddCls   = drawdownPct >= 0 ? 'up' : 'down';
            const gfCls   = gainFromLowPct >= 0 ? 'up' : 'down';

            host.innerHTML = `
                <div class="s52w-head">
                    <span class="s52w-label">52주 가격 위치</span>
                    <span class="s52w-insight ${insight.cls}">${insight.icon} ${insight.text}</span>
                </div>
                <div class="s52w-track" title="저점과 고점 사이 현재 위치">
                    <div class="s52w-marker" style="left:${posPct.toFixed(2)}%"></div>
                </div>
                <div class="s52w-range">
                    <div>
                        <span class="s52w-range-val">${fmtPrice(loVal)}</span>
                        <span class="s52w-range-date">${fmtDate(timestamps[loIdx])}</span>
                    </div>
                    <div style="text-align:right">
                        <span class="s52w-range-val">${fmtPrice(hiVal)}</span>
                        <span class="s52w-range-date">${fmtDate(timestamps[hiIdx])}</span>
                    </div>
                </div>
                <div class="s52w-stats">
                    <div class="s52w-stat">
                        <div class="s52w-stat-lab">고점 대비</div>
                        <div class="s52w-stat-val ${ddCls}">${ddSign}${drawdownPct.toFixed(1)}%</div>
                        ${drawdownPct < 0 ? `<div class="s52w-recover">회복 필요 +${recoverPct.toFixed(1)}%</div>` : ''}
                    </div>
                    <div class="s52w-stat">
                        <div class="s52w-stat-lab">저점 대비</div>
                        <div class="s52w-stat-val ${gfCls}">${gfSign}${gainFromLowPct.toFixed(1)}%</div>
                        <div class="s52w-recover">${daysSinceLow}일 경과</div>
                    </div>
                </div>
            `;
            host.classList.add('show');
        } catch (e) {
            // 조용히 실패 — UI 블로킹 방지
            warn('[52W] render failed:', e?.message || e);
        }
    }

    // ========================================
    // Long-term Performance Stats
    //   총 수익률 · S&P 500 상회 · 연간 수익률 (CAGR) · 샤프지수 · 리스크
    // ========================================
    async function renderLongTermStats(symbol) {
        const host = document.getElementById('stockLongStats');
        if (!host) return;
        host.classList.remove('show');
        host.innerHTML = '';

        try {
            // Yahoo가 max를 거부하는 종목(최근 IPO, ADR 등)을 위한 폴백 체인
            const tryRanges = ['max', '10y', '5y', '2y'];
            const fetchChart = async (sym) => {
                for (const r of tryRanges) {
                    try {
                        const u = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${r}&interval=1mo`;
                        const d = await fetchWithProxy(u);
                        if (d?.chart?.result?.[0]) return d;
                    } catch { /* 다음 range 시도 */ }
                }
                return null;
            };

            const bench = currentMarket === 'KR' ? '%5EKS11' : '%5EGSPC'; // KOSPI / S&P 500
            const [sData, bData] = await Promise.all([
                fetchChart(symbol),
                fetchChart(bench),
            ]);

            const sRes = sData?.chart?.result?.[0];
            if (!sRes) return;
            const sTs = sRes.timestamp || [];
            const sClose = (sRes.indicators?.adjclose?.[0]?.adjclose || sRes.indicators?.quote?.[0]?.close || []);
            // 시작·끝 유효한 값만
            const pairs = [];
            for (let i = 0; i < sTs.length; i++) {
                if (sClose[i] != null && isFinite(sClose[i]) && sClose[i] > 0) {
                    pairs.push({ t: sTs[i], c: sClose[i] });
                }
            }
            if (pairs.length < 12) return; // 최소 1년

            const first = pairs[0], last = pairs[pairs.length - 1];
            const totalRetPct = ((last.c - first.c) / first.c) * 100;
            const yearsSpan = Math.max(0.5, (last.t - first.t) / (365.25 * 86400));
            // 연간 복리 수익률 (CAGR)
            const cagrPct = (Math.pow(last.c / first.c, 1 / yearsSpan) - 1) * 100;

            // 월별 로그 수익률 → 샤프지수 (rf=0 기준, 연환산)
            const monthlyRet = [];
            for (let i = 1; i < pairs.length; i++) {
                const r = pairs[i].c / pairs[i - 1].c - 1;
                if (isFinite(r)) monthlyRet.push(r);
            }
            const mean = monthlyRet.reduce((a, b) => a + b, 0) / monthlyRet.length;
            const variance = monthlyRet.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, monthlyRet.length - 1);
            const stdMonthly = Math.sqrt(variance);
            const annReturn = Math.pow(1 + mean, 12) - 1;
            const annVol = stdMonthly * Math.sqrt(12);
            const sharpe = annVol > 0 ? annReturn / annVol : 0;

            // 벤치마크 총 수익률 (같은 시작 시점 맞춤)
            let benchRetPct = null;
            const bRes = bData?.chart?.result?.[0];
            if (bRes) {
                const bTs = bRes.timestamp || [];
                const bClose = (bRes.indicators?.adjclose?.[0]?.adjclose || bRes.indicators?.quote?.[0]?.close || []);
                // 종목 시작일 이상에서 가장 가까운 벤치마크 포인트 찾기
                let bStart = null, bEnd = null;
                for (let i = 0; i < bTs.length; i++) {
                    if (bClose[i] == null || !isFinite(bClose[i])) continue;
                    if (bStart == null && bTs[i] >= first.t) bStart = bClose[i];
                    if (bTs[i] <= last.t) bEnd = bClose[i];
                }
                if (bStart && bEnd) {
                    benchRetPct = ((bEnd - bStart) / bStart) * 100;
                }
            }
            const excessRetPct = benchRetPct != null ? (totalRetPct - benchRetPct) : null;

            // 리스크 분류 (연환산 변동성 기준)
            const volPct = annVol * 100;
            let riskCls, riskText;
            if (volPct < 22) { riskCls = 'low'; riskText = '낮음'; }
            else if (volPct < 40) { riskCls = 'mid'; riskText = '중간'; }
            else { riskCls = 'high'; riskText = '높음'; }

            const yearsLabel = yearsSpan >= 1
                ? `${Math.round(yearsSpan)}년`
                : `${Math.round(yearsSpan * 12)}개월`;
            const benchName = currentMarket === 'KR' ? 'KOSPI' : 'S&P 500';

            const sign = v => v >= 0 ? '+' : '';
            const cls = v => v >= 0 ? 'up' : 'down';
            const fmtPct = (v, digits = 1) => `${sign(v)}${v.toFixed(digits)}%`;

            const excessHtml = excessRetPct != null
                ? `<div class="lts-card-val ${cls(excessRetPct)}">${fmtPct(excessRetPct)}</div>
                   <div class="lts-card-sub">${benchName} 동기간 ${fmtPct(benchRetPct)}</div>`
                : `<div class="lts-card-val neutral">—</div>
                   <div class="lts-card-sub">${benchName} 데이터 없음</div>`;

            // 샤프지수 해석
            let sharpeHint;
            if (sharpe >= 1) sharpeHint = '우수';
            else if (sharpe >= 0.5) sharpeHint = '양호';
            else if (sharpe >= 0) sharpeHint = '보통';
            else sharpeHint = '부진';

            host.innerHTML = `
                <div class="lts-head">
                    <span class="lts-label">장기 성과 요약</span>
                    <span class="lts-period">최대 ${yearsLabel}</span>
                </div>
                <div class="lts-grid">
                    <div class="lts-card">
                        <div class="lts-card-lab">총 수익률</div>
                        <div class="lts-card-val ${cls(totalRetPct)}">${fmtPct(totalRetPct)}</div>
                        <div class="lts-card-sub">${yearsLabel} 누적</div>
                    </div>
                    <div class="lts-card">
                        <div class="lts-card-lab">${benchName} 상회</div>
                        ${excessHtml}
                    </div>
                    <div class="lts-card">
                        <div class="lts-card-lab">연간 수익률</div>
                        <div class="lts-card-val ${cls(cagrPct)}">${fmtPct(cagrPct)}</div>
                        <div class="lts-card-sub">CAGR · 복리 연환산</div>
                    </div>
                    <div class="lts-card">
                        <div class="lts-card-lab">샤프지수</div>
                        <div class="lts-card-val neutral">${sharpe.toFixed(2)}</div>
                        <div class="lts-card-sub">위험 대비 수익 · ${sharpeHint}</div>
                    </div>
                    <div class="lts-card">
                        <div class="lts-card-lab">리스크</div>
                        <div><span class="lts-risk-pill ${riskCls}">${riskText}</span></div>
                        <div class="lts-card-sub">연 변동성 ${volPct.toFixed(1)}%</div>
                    </div>
                </div>
            `;
            host.classList.add('show');
        } catch (e) {
            warn('[LongStats] render failed:', e?.message || e);
        }
    }

    // ========================================
    // Market Session (프리장 / 정규장 / 애프터장)
    // ========================================
    // 일·주봉 차트 위 배너 — 분석 기준가가 정규장 종가임을 안내 + 프리/애프터 갭 표시 (v649)
    let _lastQuoteForBanner = null;
    function _updateChartPreBanner(q) {
        if (q) _lastQuoteForBanner = q;
        else q = _lastQuoteForBanner;
        const banner = document.getElementById('chartPreBanner');
        if (!banner) return;
        // 일봉·주봉에서만 표시 (분봉은 라이브 가격 그대로 차트에 반영)
        if (currentInterval !== '1d' && currentInterval !== '1wk') {
            banner.style.display = 'none';
            return;
        }
        if (!q) { banner.style.display = 'none'; return; }
        const regPrice = q.regularMarketPrice;
        const prePrice = q.preMarketPrice;
        const postPrice = q.postMarketPrice;
        const prePct = q.preMarketChangePercent;
        const postPct = q.postMarketChangePercent;
        const state = q.marketState;
        const isKR = currentMarket === 'KR';
        const fmtP = v => v == null ? '-' : (isKR ? Math.round(v).toLocaleString() + '원' : '$' + v.toFixed(2));

        // 프리/애프터 가격이 정규장 대비 ±0.5% 이상 차이 날 때만 노출 (의미 있는 갭)
        let livePrice = null, livePct = null, label = '', when = '';
        if (prePrice != null && prePct != null && Math.abs(prePct) >= 0.5) {
            livePrice = prePrice; livePct = prePct; label = '프리마켓'; when = '🌅';
        } else if (postPrice != null && postPct != null && Math.abs(postPct) >= 0.5) {
            livePrice = postPrice; livePct = postPct; label = '애프터마켓'; when = '🌙';
        }

        if (livePrice == null || regPrice == null) {
            banner.style.display = 'none';
            return;
        }

        const dirCls = livePct > 0 ? 'up' : livePct < 0 ? 'down' : 'flat';
        const sign = livePct >= 0 ? '+' : '';
        const intLbl = currentInterval === '1wk' ? '주봉' : '일봉';
        banner.innerHTML = `
            <div class="cpb-left">
                <span class="cpb-icon">📊</span>
                <span class="cpb-text">${intLbl} 분석 기준가 <strong>${fmtP(regPrice)}</strong> (정규장 종가)</span>
            </div>
            <div class="cpb-divider">·</div>
            <div class="cpb-right ${dirCls}">
                <span class="cpb-live-label">${when} ${label}</span>
                <strong>${fmtP(livePrice)}</strong>
                <span class="cpb-pct">${sign}${livePct.toFixed(2)}%</span>
            </div>
        `;
        banner.style.display = '';
    }

    async function fetchMarketSession(symbol) {
        const container = document.getElementById('marketSessionInfo');
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('show');

        try {
            // Yahoo Finance quote endpoint - 프리/정규/애프터 가격 포함 (fetchRace로 빠르게)
            const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
            const data = await fetchRace(quoteUrl, 8000);
            const q = data?.quoteResponse?.result?.[0];
            if (!q) return;

            const isKR = currentMarket === 'KR';
            const fmtP = v => {
                if (v == null) return '-';
                return isKR ? Math.round(v).toLocaleString() + '원' : '$' + v.toFixed(2);
            };
            const fmtChg = (chg, pct) => {
                if (chg == null) return { text: '-', cls: 'flat' };
                const s = chg >= 0 ? '+' : '';
                const p = pct != null ? ` (${s}${pct.toFixed(2)}%)` : '';
                const t = isKR
                    ? `${s}${Math.round(chg).toLocaleString()}원${p}`
                    : `${s}$${chg.toFixed(2)}${p}`;
                return { text: t, cls: chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat' };
            };
            const fmtTime = ts => {
                if (!ts) return '';
                const d = new Date(ts * 1000);
                const h = d.getHours().toString().padStart(2,'0');
                const m = d.getMinutes().toString().padStart(2,'0');
                return `${h}:${m}`;
            };

            const state = q.marketState; // PRE, REGULAR, POST, PREPRE, POSTPOST, CLOSED
            const badges = [];

            // 정규장 가격 (항상 표시)
            const regPrice = q.regularMarketPrice;
            const regChg = q.regularMarketChange;
            const regPct = q.regularMarketChangePercent;
            const regTime = q.regularMarketTime;
            const regC = fmtChg(regChg, regPct);

            const isOpen = state === 'REGULAR';
            badges.push(`
                <div class="session-badge">
                    <div>
                        <div class="session-label">${isOpen ? '정규장 거래중' : '정규장 마감'}</div>
                        <div class="session-price">${fmtP(regPrice)}</div>
                        <div class="session-time">${fmtTime(regTime)}</div>
                    </div>
                    <div class="session-change ${regC.cls}">${regC.text}</div>
                </div>
            `);

            // 프리마켓 (장 시작 전)
            const prePrice = q.preMarketPrice;
            if (prePrice != null) {
                const preChg = q.preMarketChange;
                const prePct = q.preMarketChangePercent;
                const preTime = q.preMarketTime;
                const preC = fmtChg(preChg, prePct);
                const isPreLive = (state === 'PRE' || state === 'PREPRE');
                badges.push(`
                    <div class="session-badge">
                        <div>
                            <div class="session-label">${isPreLive ? '프리마켓 거래중' : '프리마켓'}</div>
                            <div class="session-price">${fmtP(prePrice)}</div>
                            <div class="session-time">${fmtTime(preTime)}</div>
                        </div>
                        <div class="session-change ${preC.cls}">${preC.text}</div>
                    </div>
                `);
            }

            // 애프터마켓 (장 마감 후)
            const postPrice = q.postMarketPrice;
            if (postPrice != null) {
                const postChg = q.postMarketChange;
                const postPct = q.postMarketChangePercent;
                const postTime = q.postMarketTime;
                const postC = fmtChg(postChg, postPct);
                const isPostLive = (state === 'POST' || state === 'POSTPOST');
                badges.push(`
                    <div class="session-badge">
                        <div>
                            <div class="session-label">${isPostLive ? '애프터마켓 거래중' : '애프터마켓'}</div>
                            <div class="session-price">${fmtP(postPrice)}</div>
                            <div class="session-time">${fmtTime(postTime)}</div>
                        </div>
                        <div class="session-change ${postC.cls}">${postC.text}</div>
                    </div>
                `);
            }

            if (badges.length > 0) {
                container.innerHTML = badges.join('');
                container.classList.add('show');
            }

            // 헤더 가격을 quote API 기준으로 동기화
            // 현재 활성 세션 가격 우선 표시: PRE → preMarketPrice, POST → postMarketPrice, 그 외 → regularMarketPrice
            // 참고: marketState가 CLOSED/PREPRE여도 preMarketPrice가 있으면 프리마켓 진행 중
            let livePrice = regPrice;
            let liveChg = regChg;
            let livePct = regPct;
            let livePrev = q.regularMarketPreviousClose ?? (regPrice - regChg);

            // 프리마켓 가격이 존재하고, 정규장이 아닌 경우 → 프리마켓 가격 표시
            if (state !== 'REGULAR' && prePrice != null && q.preMarketChange != null) {
                livePrice = prePrice;
                liveChg = q.preMarketChange;
                livePct = q.preMarketChangePercent;
                livePrev = regPrice;
            }
            // 애프터마켓 가격이 존재하고, 정규장이 아닌 경우 → 애프터마켓 가격 표시
            // (프리마켓보다 애프터마켓이 우선되진 않으므로, 둘 다 있으면 프리 우선)
            else if (state !== 'REGULAR' && postPrice != null && q.postMarketChange != null) {
                livePrice = postPrice;
                liveChg = q.postMarketChange;
                livePct = q.postMarketChangePercent;
                livePrev = regPrice;
            }

            // 포지션 P&L용 — 프리/애프터 포함 세션 가격을 meta에 저장
            if (stockData?.meta && livePrice != null) {
                stockData.meta._sessionPrice = livePrice;
                stockData.meta._sessionState = state || '';
            }

            if (livePrice != null) {
                const priceEl = document.getElementById('stockPrice');
                const changeEl = document.getElementById('stockChange');
                if (priceEl) priceEl.textContent = fmtP(livePrice);
                const sign = liveChg >= 0 ? '+' : '';
                if (changeEl) {
                    changeEl.textContent = isKR
                        ? `${sign}${Math.round(liveChg).toLocaleString()}원 (${sign}${livePct.toFixed(2)}%)`
                        : `${sign}$${liveChg.toFixed(2)} (${sign}${livePct.toFixed(2)}%)`;
                    changeEl.className = 'stock-change ' + (liveChg > 0 ? 'up' : liveChg < 0 ? 'down' : 'flat');
                }
                if (priceEl) priceEl.style.color = liveChg > 0 ? 'var(--red)' : liveChg < 0 ? 'var(--blue)' : 'var(--text)';
            }

            // 일·주봉 차트 위 배너 — 분석 기준가(정규장 종가) vs 라이브(프리/애프터) 갭 안내 (v649)
            try { _updateChartPreBanner(q); } catch(_) {}

            // 세션 가격 반영 후 포지션 카드 갱신 (프리/애프터 P&L 즉시 표시)
            try { renderMyPosition(); } catch(_) {}
        } catch(e) {
            // 실패해도 무시 - 메인 기능에 영향 없음
        }
    }

    // ========================================
    // Analysis Auto-Refresh (5분 자동 분석 갱신)
    // ========================================
    function updateAnalysisTimestamp() {
        const el = document.getElementById('analysisRefreshTime');
        if (!el) return;
        const now = new Date();
        const hh  = now.getHours().toString().padStart(2, '0');
        const mm  = now.getMinutes().toString().padStart(2, '0');
        el.textContent = `마지막 갱신 ${hh}:${mm}`;
    }

    function stopAnalysisRefresh() {
        if (analysisRefreshTimer) { clearInterval(analysisRefreshTimer); analysisRefreshTimer = null; }
        const bar = document.getElementById('analysisRefreshBar');
        if (bar) bar.style.display = 'none';
    }

    async function runAnalysisRefresh() {
        if (!currentFullSymbol) return;
        try {
            const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${currentFullSymbol}` +
                `?range=${currentPeriod}&interval=${currentInterval}&includePrePost=true`;
            const data = await fetchWithProxy(chartUrl);
            if (!data.chart?.result?.[0]) return;
            stockData = data.chart.result[0];

            // 분석 관련 함수만 재실행 (차트 전체 재렌더 제외 → 줌/팬 유지)
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
            updateAnalysisTimestamp();
        } catch(e) { /* 네트워크 오류 시 조용히 무시 */ }
    }

    async function manualAnalysisRefresh() {
        const btn = document.getElementById('analysisRefreshBtn');
        if (btn) { btn.classList.add('spinning'); btn.textContent = '갱신 중...'; }
        await runAnalysisRefresh();
        if (btn) { btn.classList.remove('spinning'); btn.textContent = '↻ 지금 갱신'; }
    }

    function startAnalysisRefresh() {
        stopAnalysisRefresh();
        const bar = document.getElementById('analysisRefreshBar');
        if (bar) bar.style.display = 'flex';
        updateAnalysisTimestamp(); // 분석 직후 초기 타임스탬프 설정
        analysisRefreshTimer = window.setInterval(runAnalysisRefresh, 5 * 60 * 1000); // 5분
    }

    // ========================================
    // Live Price Update (실시간 가격 업데이트)
    // ========================================
    function stopLiveUpdate() {
        if (liveUpdateTimer) { clearInterval(liveUpdateTimer); liveUpdateTimer = null; }
    }

    // ========================================
    // Alpaca WebSocket 실시간 캔들 (로컬 전용)
    // ========================================
    function stopAlpacaWS() {
        if (_alpacaWs) {
            try { _alpacaWs.close(); } catch(e) {}
            _alpacaWs = null;
        }
        _wsLiveCandle = null;
        // 연결 상태 뱃지 제거
        const badge = document.getElementById('alpacaWsBadge');
        if (badge) badge.remove();
    }

    function _wsShowBadge(connected) {
        let badge = document.getElementById('alpacaWsBadge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'alpacaWsBadge';
            badge.style.cssText = `position:fixed;bottom:72px;right:14px;z-index:8000;
                font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;
                pointer-events:none;transition:opacity .3s;`;
            document.body.appendChild(badge);
        }
        if (connected) {
            badge.textContent = '⚡ Alpaca 실시간';
            badge.style.background = 'rgba(34,197,94,0.18)';
            badge.style.color = '#22C55E';
            badge.style.border = '1px solid rgba(34,197,94,0.4)';
            badge.style.opacity = '1';
        } else {
            badge.textContent = '🔴 WS 끊김';
            badge.style.background = 'rgba(239,68,68,0.15)';
            badge.style.color = '#EF4444';
            badge.style.border = '1px solid rgba(239,68,68,0.3)';
            // 3초 후 숨김
            setTimeout(() => { if (badge) badge.style.opacity = '0'; }, 3000);
        }
    }

    function _handleAlpacaTrade(trade) {
        if (!lwCandleSeries) return;
        const price  = trade.p;
        const size   = trade.s || 0;
        const now    = Math.floor(Date.now() / 1000);

        // 타임프레임에 맞춰 봉 시작 시간 정렬
        const tfSec  = (_lastSigArgs?.ts?.length >= 2)
            ? (_lastSigArgs.ts[1] - _lastSigArgs.ts[0])
            : 60;
        const barTime = now - (now % tfSec);

        if (!_wsLiveCandle || _wsLiveCandle.time !== barTime) {
            // 새 봉 시작
            _wsLiveCandle = {
                time: barTime, open: price,
                high: price, low: price,
                close: price, volume: size,
            };
        } else {
            if (price > _wsLiveCandle.high) _wsLiveCandle.high = price;
            if (price < _wsLiveCandle.low)  _wsLiveCandle.low  = price;
            _wsLiveCandle.close   = price;
            _wsLiveCandle.volume += size;
        }

        // 스로틀: 200ms 이내 중복 업데이트 방지
        const now2 = Date.now();
        if (now2 - _wsTradeThrottle < 200) return;
        _wsTradeThrottle = now2;

        try { lwCandleSeries.update({ ..._wsLiveCandle }); } catch(e) {}

        // _lastSigArgs 마지막 봉 close 실시간 반영 (신호 lastClose 갱신용)
        try {
            if (_lastSigArgs?.q?.close?.length) {
                _lastSigArgs.q.close[_lastSigArgs.q.close.length - 1] = price;
                if (_lastSigArgs.q.high?.length)
                    _lastSigArgs.q.high[_lastSigArgs.q.high.length - 1] =
                        Math.max(_lastSigArgs.q.high[_lastSigArgs.q.high.length - 1], price);
                if (_lastSigArgs.q.low?.length)
                    _lastSigArgs.q.low[_lastSigArgs.q.low.length - 1] =
                        Math.min(_lastSigArgs.q.low[_lastSigArgs.q.low.length - 1], price);
            }
        } catch(e) {}

        // 헤더 가격도 실시간 업데이트
        try {
            const fmtP = v => currentMarket === 'KR'
                ? Math.round(v).toLocaleString() + '원'
                : '$' + v.toFixed(2);
            const priceEl = document.getElementById('stockPrice');
            if (priceEl) priceEl.textContent = fmtP(price);
        } catch(e) {}
    }

    function startAlpacaWS(symbol) {
        stopAlpacaWS();
        // Vercel(서버리스) 환경에서는 WebSocket 프록시(/ws/alpaca)가 없으므로 비활성화
        const isVercel = window.location.hostname !== 'localhost'
            && window.location.hostname !== '127.0.0.1';
        if (isVercel) return;
        // KR 종목 제외
        if (currentMarket === 'KR') return;
        const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl   = `${wsProto}://${location.host}/ws/alpaca`;

        try {
            _alpacaWs = new WebSocket(wsUrl);

            _alpacaWs.onopen = () => {
                _alpacaWs.send(JSON.stringify({
                    action: 'subscribe',
                    symbols: [symbol.replace(/\.(KS|KQ)$/i, '').toUpperCase()],
                }));
                _wsShowBadge(true);
                log('[alpaca-ws] connected:', symbol);
            };

            _alpacaWs.onmessage = (event) => {
                try {
                    const m = JSON.parse(event.data);
                    if (m.T === 'b') {
                        // 1분봉 확정 bar — 차트 캔들 + 신호 동시 갱신
                        const barTime = Math.floor(new Date(m.t).getTime() / 1000);
                        const bar = {
                            time: barTime,
                            open: m.o, high: m.h,
                            low:  m.l, close: m.c,
                        };
                        try { lwCandleSeries.update(bar); } catch(e) {}
                        _wsLiveCandle = null; // 확정 봉 이후 새 봉 시작

                        // ── _lastSigArgs 배열에 확정봉 반영 → 매수/매도/손절 신호 재계산 ──
                        if (_lastSigArgs) {
                            try {
                                const cd = _lastSigArgs.candleData;
                                const ts = _lastSigArgs.ts;
                                const q  = _lastSigArgs.q;
                                // 마지막 봉 교체 또는 새 봉 추가
                                if (ts.length && ts[ts.length - 1] === barTime) {
                                    const i = ts.length - 1;
                                    cd[i] = { ...cd[i], ...bar };
                                    q.open[i]  = m.o; q.high[i] = m.h;
                                    q.low[i]   = m.l; q.close[i] = m.c;
                                    if (q.volume) q.volume[i] = m.v || q.volume[i];
                                } else {
                                    cd.push(bar);
                                    ts.push(barTime);
                                    q.open.push(m.o);  q.high.push(m.h);
                                    q.low.push(m.l);   q.close.push(m.c);
                                    if (q.volume) q.volume.push(m.v || 0);
                                }
                                // Bollinger 재계산 후 신호 즉시 갱신
                                const bb = calcBollingerBands(q.close, 4, 2);
                                renderChartLiveSignals(cd, ts, q, bb);
                            } catch(e) {}
                        }
                    } else if (m.T === 't') {
                        // 틱 단위 트레이드 → 현재 봉 실시간 업데이트
                        _handleAlpacaTrade(m);
                    }
                } catch(e) {}
            };

            _alpacaWs.onerror = () => {
                _wsShowBadge(false);
                warn('[alpaca-ws] error');
            };

            _alpacaWs.onclose = () => {
                _wsShowBadge(false);
                _alpacaWs = null;
                // 5초 후 자동 재연결 (페이지가 살아있고 같은 심볼이면)
                setTimeout(() => {
                    if (currentSymbol === symbol && currentMarket !== 'KR') {
                        startAlpacaWS(symbol);
                    }
                }, 5000);
            };
        } catch(e) {
            warn('[alpaca-ws] init failed:', e.message);
        }
    }

    // ========================================
    // Chart Signal Poll (60초 차트 시그널 폴링)
    // ========================================
    function stopChartSigPoll() {
        if (chartSigPollTimer) { clearInterval(chartSigPollTimer); chartSigPollTimer = null; }
        _lastSigKey = null;
    }

    async function pollChartSignals() {
        if (!currentFullSymbol || !lwCandleSeries) return;
        // 탭이 백그라운드면 스킵 (네트워크/배터리 절약)
        if (document.hidden) return;
        try {
            // ── Polygon.io 우선 시도 (미국 종목만) ──────────────────
            const isKR = /\.(KS|KQ)$/i.test(currentFullSymbol);
            if (!isKR) {
                const tfToTimespan = {
                    '1m':'minute','2m':'minute','5m':'minute','15m':'minute',
                    '30m':'minute','60m':'hour','90m':'hour',
                    '1d':'day','1wk':'week','1mo':'month'
                };
                const tfToMult = {
                    '1m':1,'2m':2,'5m':5,'15m':15,
                    '30m':30,'60m':60,'90m':90,
                    '1d':1,'1wk':1,'1mo':1
                };
                const pTimespan = tfToTimespan[currentInterval] || 'minute';
                const pMult     = tfToMult[currentInterval]     || 5;
                const pFrom     = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
                const pTo       = new Date().toISOString().split('T')[0];
                const polygonTicker = currentFullSymbol.replace(/\.(KS|KQ)$/i, '');
                try {
                    const pr = await fetch(
                        `/api/polygon/candles?ticker=${polygonTicker}`
                        + `&timespan=${pTimespan}&multiplier=${pMult}`
                        + `&from=${pFrom}&to=${pTo}`
                    );
                    if (pr.ok) {
                        const pd = await pr.json();
                        if (pd.candles && pd.candles.length > 10) {
                            const candleData = pd.candles;
                            const ts = pd.candles.map(c => c.time);
                            try { lwCandleSeries.update(candleData[candleData.length - 1]); } catch(e) {}
                            const fakeQ = {
                                open:   candleData.map(c => c.open),
                                high:   candleData.map(c => c.high),
                                low:    candleData.map(c => c.low),
                                close:  candleData.map(c => c.close),
                                volume: candleData.map(c => c.volume),
                            };
                            const bb = calcBollingerBands(fakeQ.close, 4, 2);
                            renderChartLiveSignals(candleData, ts, fakeQ, bb);
                            return;
                        }
                    }
                } catch(pe) {
                    warn('[polygon] fallback to yahoo:', pe.message);
                }
            }
            // ── Kiwoom 우선 시도 (국내 종목만) ─────────────────────────
            if (isKR) {
                const krTicker = currentFullSymbol.replace(/\.(KS|KQ)$/i, '');
                const krType = currentInterval === '1d' ? 'D'
                             : currentInterval === '1wk' ? 'W' : 'M';
                const krUnit = {'1m':'1','2m':'2','3m':'3','5m':'5','10m':'10',
                                '15m':'15','30m':'30','60m':'60','90m':'90'}[currentInterval] || '5';
                try {
                    const kr = await fetch(
                        `/api/kiwoom/candles?ticker=${krTicker}&type=${krType}&timeUnit=${krUnit}`
                    );
                    if (kr.ok) {
                        const kd = await kr.json();
                        if (kd.candles && kd.candles.length > 10) {
                            const candleData = kd.candles;
                            const ts = kd.candles.map(c => c.time);
                            try { lwCandleSeries.update(candleData[candleData.length - 1]); } catch(e) {}
                            const fakeQ = {
                                open:   candleData.map(c => c.open),
                                high:   candleData.map(c => c.high),
                                low:    candleData.map(c => c.low),
                                close:  candleData.map(c => c.close),
                                volume: candleData.map(c => c.volume),
                            };
                            const bb = calcBollingerBands(fakeQ.close, 4, 2);
                            renderChartLiveSignals(candleData, ts, fakeQ, bb);
                            // 헤더 현재가도 키움으로 업데이트
                            _updateKrPrice(currentFullSymbol);
                            return;
                        }
                    }
                } catch(ke) {
                    warn('[kiwoom] fallback to yahoo:', ke.message);
                }
            }
            // ── Yahoo Finance 폴백 ───────────────────────────────────
            const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${currentFullSymbol}` +
                `?range=${currentPeriod}&interval=${currentInterval}&includePrePost=true`;
            const data = await fetchWithProxy(chartUrl);
            if (!data?.chart?.result?.[0]) return;
            stockData = data.chart.result[0];
            const ts = stockData.timestamp || [];
            const q  = stockData.indicators?.quote?.[0];
            if (!q || !ts.length) return;

            const candleData = [];
            for (let i = 0; i < ts.length; i++) {
                const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
                if (o == null || h == null || l == null || c == null) continue;
                candleData.push({ time: ts[i], open: o, high: h, low: l, close: c });
            }
            if (!candleData.length) return;

            // 마지막 캔들만 업데이트 → 줌·팬 유지
            try { lwCandleSeries.update(candleData[candleData.length - 1]); } catch(e) {}

            const bb = calcBollingerBands(q.close, 4, 2);
            renderChartLiveSignals(candleData, ts, q, bb);
        } catch(e) { /* 폴링 실패는 조용히 무시 */ }
        // [디버그] 등급 캐시 안정성 모니터링 (확인 후 제거)
        try {
            log('[poll]', {
                symbol: currentSymbol,
                candleCount: _lastSigArgs?.candleData?.length || 0,
                gradesCached: Object.keys(_signalGrades).length,
                minGrade: _minGradeFilter,
            });
        } catch(_) {}
    }

    async function _updateKrPrice(ticker) {
        try {
            const krTicker = ticker.replace(/\.(KS|KQ)$/i, '');
            const r = await fetch(`/api/kiwoom/quote?ticker=${krTicker}`);
            if (!r.ok) return;
            const d = await r.json();
            if (!d.price || d.price <= 0 || d.error) return;
            const priceEl = document.getElementById('stockPrice');
            if (priceEl) priceEl.textContent = d.price.toLocaleString('ko-KR') + '원';
            const changeEl = document.getElementById('headerChange');
            if (changeEl) {
                const sign = d.changePct >= 0 ? '+' : '';
                changeEl.textContent = `${sign}${d.changePct.toFixed(2)}%`;
                changeEl.style.color = d.changePct >= 0 ? '#22C55E' : '#EF4444';
            }
        } catch(e) {
            warn('[kiwoom price]', e.message);
        }
    }

    // 폴링 주기 — 단봉(1m/2m/5m) 에서는 더 짧게, 그 외엔 기본
    function _sigPollIntervalMs() {
        return /^(1m|2m|5m)$/.test(currentInterval || '') ? 10000 : 15000; // 10초 vs 15초
    }
    function _liveUpdateIntervalMs() {
        return /^(1m|2m|5m)$/.test(currentInterval || '') ? 15000 : 30000; // 15초 vs 30초
    }

    function startChartSigPoll() {
        stopChartSigPoll();
        chartSigPollTimer = window.setInterval(pollChartSignals, _sigPollIntervalMs());
    }

    function startLiveUpdate() {
        stopLiveUpdate();
        // 단봉: 15초, 그 외: 30초 헤더 가격 + 차트 캔들 + 세션 뱃지 업데이트
        liveUpdateTimer = window.setInterval(async () => {
            if (!currentFullSymbol) return;
            try {
                // ── Alpaca 실시간 가격 시도 ─────────────────────
                const sym = currentFullSymbol.replace(/\.(KS|KQ)$/i,'');
                const isKR = currentMarket === 'KR';
                const fmtP = v => isKR ? Math.round(v).toLocaleString() + '원' : '$' + v.toFixed(2);
                let livePrice = null, liveChg = null, livePct = null, dataSource = '';
                let regPrice = null;

                if (!isKR) {
                    try {
                        const r = await fetch(`/api/price/${encodeURIComponent(sym)}`);
                        if (r.ok) {
                            const d = await r.json();
                            if (d.price && d.price > 0) {
                                livePrice = d.price;
                                liveChg   = d.change;
                                livePct   = d.changePct;
                                regPrice  = d.price;
                                dataSource = d.source; // 'alpaca_realtime' | 'yfinance_delayed'

                                // stockData.meta 에 최신 가격 반영 (포지션 P&L 실시간)
                                if (stockData?.meta) stockData.meta.regularMarketPrice = livePrice;

                                // 데이터 소스 배지
                                const badge = document.getElementById('priceSourceBadge');
                                if (badge) {
                                    if (dataSource === 'alpaca_realtime') {
                                        badge.style.display = '';
                                        badge.textContent = '🟢 실시간 (Alpaca)';
                                        badge.style.color = '#22C55E';
                                    } else {
                                        // yfinance 폴백 / 장외 — 뱃지 숨김 (노이즈 제거)
                                        badge.style.display = 'none';
                                    }
                                }

                                // 장 외 시간이면 프리/포스트 가격 우선
                                if (d.marketState && d.marketState !== 'REGULAR') {
                                    if (d.preMarketPrice != null) { livePrice = d.preMarketPrice; livePct = d.preMarketChangePct; liveChg = null; }
                                    else if (d.postMarketPrice != null) { livePrice = d.postMarketPrice; livePct = d.postMarketChangePct; liveChg = null; }
                                }
                            }
                        }
                    } catch(e) { /* Alpaca 실패 시 아래 yfinance fallback */ }
                }

                // 아직 가격 못 얻었으면 yfinance fallback
                if (livePrice == null) {
                    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${currentFullSymbol}`;
                    const data = await fetchRace(quoteUrl, 6000);
                    const q = data?.quoteResponse?.result?.[0];
                    if (!q) return;

                    const state = q.marketState;
                    regPrice = q.regularMarketPrice;
                    const prePrice = q.preMarketPrice;
                    const postPrice = q.postMarketPrice;

                    livePrice = regPrice;
                    liveChg = q.regularMarketChange;
                    livePct = q.regularMarketChangePercent;

                    if (state !== 'REGULAR' && prePrice != null && q.preMarketChange != null) {
                        livePrice = prePrice; liveChg = q.preMarketChange; livePct = q.preMarketChangePercent;
                    } else if (state !== 'REGULAR' && postPrice != null && q.postMarketChange != null) {
                        livePrice = postPrice; liveChg = q.postMarketChange; livePct = q.postMarketChangePercent;
                    }

                    if (stockData?.meta) stockData.meta.regularMarketPrice = regPrice;
                }

                // 헤더 가격 업데이트
                const priceEl = document.getElementById('stockPrice');
                const changeEl = document.getElementById('stockChange');
                if (priceEl && livePrice != null) {
                    priceEl.textContent = fmtP(livePrice);
                    if (liveChg != null && livePct != null) {
                        const sign = liveChg >= 0 ? '+' : '';
                        changeEl.textContent = isKR
                            ? `${sign}${Math.round(liveChg).toLocaleString()}원 (${sign}${livePct.toFixed(2)}%)`
                            : `${sign}$${liveChg.toFixed(2)} (${sign}${livePct.toFixed(2)}%)`;
                        changeEl.className = 'stock-change ' + (liveChg > 0 ? 'up' : liveChg < 0 ? 'down' : 'flat');
                        priceEl.style.color = liveChg > 0 ? 'var(--red)' : liveChg < 0 ? 'var(--blue)' : 'var(--text)';
                    } else if (livePct != null) {
                        const sign = livePct >= 0 ? '+' : '';
                        changeEl.textContent = `${sign}${livePct.toFixed(2)}%`;
                        changeEl.className = 'stock-change ' + (livePct > 0 ? 'up' : livePct < 0 ? 'down' : 'flat');
                        priceEl.style.color = livePct > 0 ? 'var(--red)' : livePct < 0 ? 'var(--blue)' : 'var(--text)';
                    }
                }

                // 차트 마지막 캔들 업데이트
                if (lwCandleSeries && regPrice != null && stockData?.timestamp?.length) {
                    const lastTs = stockData.timestamp[stockData.timestamp.length - 1];
                    const lastQ = stockData.indicators.quote[0];
                    const lastIdx = lastQ.close.length - 1;
                    const open = lastQ.open[lastIdx] ?? regPrice;
                    const high = Math.max(lastQ.high[lastIdx] ?? regPrice, regPrice);
                    const low = Math.min(lastQ.low[lastIdx] ?? regPrice, regPrice);
                    lwCandleSeries.update({ time: lastTs, open, high, low, close: regPrice });
                    if (lwVolumeSeries) {
                        lwVolumeSeries.update({
                            time: lastTs,
                            value: stockData.indicators.quote[0].volume[lastIdx] || 0,
                            color: regPrice >= open ? 'rgba(255,69,58,0.25)' : 'rgba(0,128,251,0.25)',
                        });
                    }
                }

                // 세션 뱃지 갱신
                fetchMarketSession(currentFullSymbol);
            } catch(e) {}
        }, 10000);
    }

    // ========================================

    // RSI Chart
    // ========================================
    function renderRSIChart() {
        if (rsiChart) rsiChart.destroy();

        const timestamps = stockData.timestamp;
        const closes = stockData.indicators.quote[0].close;
        const labels = timestamps.map(t => new Date(t * 1000));
        const rsi = calcRSI(closes);

        const ctx = document.getElementById('rsiChart').getContext('2d');
        rsiChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'RSI(14)',
                    data: rsi,
                    borderColor: '#8b5cf6',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    annotation: {}
                },
                scales: {
                    x: { type: 'time', display: false },
                    y: {
                        min: 0, max: 100,
                        position: 'right',
                        grid: { color: 'rgba(45,58,77,0.3)' },
                        ticks: { color: '#64748b', stepSize: 25 }
                    }
                }
            },
            plugins: [{
                id: 'rsiLines',
                beforeDraw(chart) {
                    const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
                    // Overbought (70)
                    const y70 = y.getPixelForValue(70);
                    const y30 = y.getPixelForValue(30);
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255,69,58,0.4)';
                    ctx.setLineDash([4,4]);
                    ctx.beginPath(); ctx.moveTo(left, y70); ctx.lineTo(right, y70); ctx.stroke();
                    ctx.strokeStyle = 'rgba(0,128,251,0.4)';
                    ctx.beginPath(); ctx.moveTo(left, y30); ctx.lineTo(right, y30); ctx.stroke();
                    // Fill zones
                    ctx.fillStyle = 'rgba(255,69,58,0.05)';
                    ctx.fillRect(left, top, right - left, y70 - top);
                    ctx.fillStyle = 'rgba(0,128,251,0.05)';
                    ctx.fillRect(left, y30, right - left, bottom - y30);
                    ctx.restore();
                }
            }]
        });
    }

    // ========================================
    // MACD Chart
    // ========================================
    function renderMACDChart() {
        if (macdChart) macdChart.destroy();

        const timestamps = stockData.timestamp;
        const closes = stockData.indicators.quote[0].close;
        const labels = timestamps.map(t => new Date(t * 1000));
        const { macdLine, signalLine, histogram } = calcMACD(closes);

        const histColors = histogram.map(v => v >= 0 ? 'rgba(255,69,58,0.5)' : 'rgba(0,128,251,0.5)');

        const ctx = document.getElementById('macdChart').getContext('2d');
        macdChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Histogram',
                        data: histogram,
                        backgroundColor: histColors,
                        borderWidth: 0,
                        order: 2
                    },
                    {
                        label: 'MACD',
                        data: macdLine,
                        borderColor: '#06b6d4',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        type: 'line',
                        fill: false,
                        tension: 0.1,
                        order: 1
                    },
                    {
                        label: 'Signal',
                        data: signalLine,
                        borderColor: '#f59e0b',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        type: 'line',
                        fill: false,
                        tension: 0.1,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#94a3b8', boxWidth: 12, padding: 8, font: { size: 11 } }
                    }
                },
                scales: {
                    x: { type: 'time', display: false },
                    y: {
                        position: 'right',
                        grid: { color: 'rgba(45,58,77,0.3)' },
                        ticks: { color: '#64748b' }
                    }
                }
            }
        });
    }

    // ========================================
    // ========================================
    // ADX Chart
    // ========================================
    function renderADXChart() {
        if (adxChart) adxChart.destroy();
        const timestamps = stockData.timestamp;
        const q = stockData.indicators.quote[0];
        const labels = timestamps.map(t => new Date(t * 1000));
        const { pDI, mDI, adx } = calcADX(q.high, q.low, q.close);

        const ctx = document.getElementById('adxChart').getContext('2d');
        adxChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'ADX', data: adx, borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, fill: false, tension: 0.1 },
                    { label: '+DI', data: pDI, borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.1 },
                    { label: '-DI', data: mDI, borderColor: '#ef4444', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.1 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top', labels: { color: '#94a3b8', boxWidth: 12, padding: 8, font: { size: 11 } } } },
                scales: {
                    x: { type: 'time', display: false },
                    y: { position: 'right', grid: { color: 'rgba(45,58,77,0.3)' }, ticks: { color: '#64748b' } }
                }
            },
            plugins: [{
                id: 'adxLine25',
                beforeDraw(chart) {
                    const { ctx, chartArea: { left, right }, scales: { y } } = chart;
                    const y25 = y.getPixelForValue(25);
                    ctx.save(); ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(245,158,11,0.4)';
                    ctx.beginPath(); ctx.moveTo(left,y25); ctx.lineTo(right,y25); ctx.stroke(); ctx.restore();
                }
            }]
        });
    }

    // ========================================
    // OBV Chart
    // ========================================
    function renderOBVChart() {
        if (obvChart) obvChart.destroy();
        const timestamps = stockData.timestamp;
        const q = stockData.indicators.quote[0];
        const labels = timestamps.map(t => new Date(t * 1000));
        const obv = calcOBV(q.close, q.volume);
        const obvMA = calcSMA(obv, 20);

        const ctx = document.getElementById('obvChart').getContext('2d');
        obvChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'OBV', data: obv, borderColor: '#e879f9', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.1 },
                    { label: 'OBV MA20', data: obvMA, borderColor: '#f59e0b', borderWidth: 1, pointRadius: 0, fill: false, tension: 0.1, borderDash: [3,3] }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top', labels: { color: '#94a3b8', boxWidth: 12, padding: 8, font: { size: 11 } } } },
                scales: {
                    x: { type: 'time', display: false },
                    y: {
                        position: 'right', grid: { color: 'rgba(45,58,77,0.3)' },
                        ticks: { color: '#64748b', callback: v => { if(Math.abs(v)>=1e9) return (v/1e9).toFixed(1)+'B'; if(Math.abs(v)>=1e6) return (v/1e6).toFixed(0)+'M'; if(Math.abs(v)>=1e4) return (v/1e4).toFixed(0)+'만'; return v.toLocaleString(); } }
                    }
                }
            }
        });
    }

    // ========================================
    // Technical Indicators Panel
    // ========================================
    function renderTechnicalIndicators() {
        const q = stockData.indicators.quote[0];
        // CLAUDE.md 규칙: ATR/ADX/VWAP/MFI 는 raw nullable 배열을 전달해야 인덱스 정합 유지
        const closes = q.close.filter(v => v != null);
        const price = closes[closes.length - 1];

        const ma5 = calcSMA(closes, 5);
        const ma20 = calcSMA(closes, 20);
        const ma60 = calcSMA(closes, 60);
        const ma120 = calcSMA(closes, 120);
        const rsi = calcRSI(closes);
        const { macdLine, signalLine } = calcMACD(closes);
        const bb = calcBollingerBands(closes);
        // OHLCV 계열: raw nullable 배열 사용 (필터링하면 high/low/close 인덱스 어긋남)
        const { adx } = calcADX(q.high, q.low, q.close);
        const atr = calcATR(q.high, q.low, q.close);
        const vwap = calcVWAP(q.high, q.low, q.close, q.volume);
        const wr = calcWilliamsR(q.high, q.low, q.close);
        const mfi = calcMFI(q.high, q.low, q.close, q.volume);

        // 단일 헬퍼: 마지막 non-null 값 반환 (O(N) → O(1)+truthy skip)
        const lastVal = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return undefined; };
        const lastRSI = lastVal(rsi);
        const lastMACD = lastVal(macdLine);
        const lastSignal = lastVal(signalLine);
        const lastBBUpper = lastVal(bb.upper);
        const lastBBLower = lastVal(bb.lower);
        const lastMA5 = lastVal(ma5);
        const lastMA20 = lastVal(ma20);
        const lastMA60 = lastVal(ma60);
        const lastMA120 = lastVal(ma120);
        const lastADX = lastVal(adx);
        const lastATR = lastVal(atr);
        const lastVWAP = lastVal(vwap);
        const lastWR = lastVal(wr);
        const lastMFI = lastVal(mfi);

        const isKR = currentMarket === 'KR';
        const fmt = v => v == null ? '-' : isKR ? Math.round(v).toLocaleString() : v.toFixed(2);

        function maSignal(maVal) {
            if (maVal == null) return ['N/A', 'neutral'];
            return price > maVal ? ['상향 돌파', 'buy'] : ['하향 돌파', 'sell'];
        }

        const rsiSignal = rsiZoneLabel(lastRSI);
        const macdSignalText = lastMACD > lastSignal ? ['매수 신호', 'buy'] : ['매도 신호', 'sell'];

        // ADX signal
        const adxSig = lastADX == null ? ['N/A', 'neutral'] : lastADX >= 25 ? ['강한 추세', 'buy'] : ['추세 약함', 'neutral'];

        // VWAP signal
        const vwapSig = lastVWAP == null ? ['N/A', 'neutral'] : price > lastVWAP ? ['VWAP 위', 'buy'] : ['VWAP 아래', 'sell'];

        // Williams %R signal
        const wrSig = lastWR == null ? ['N/A', 'neutral'] : lastWR > -20 ? ['과매수', 'sell'] : lastWR < -80 ? ['과매도', 'buy'] : ['중립', 'neutral'];

        // MFI signal
        const mfiSig = lastMFI == null ? ['N/A', 'neutral'] : lastMFI > 80 ? ['과매수', 'sell'] : lastMFI < 20 ? ['과매도', 'buy'] : ['중립', 'neutral'];

        const indicators = [
            { label: 'RSI (14)', value: lastRSI ? lastRSI.toFixed(1) : '-', signal: rsiSignal },
            { label: 'MACD', value: lastMACD ? lastMACD.toFixed(2) : '-', signal: macdSignalText },
            { label: 'ADX (14)', value: lastADX ? lastADX.toFixed(1) : '-', signal: adxSig },
            { label: 'W %R (14)', value: lastWR ? lastWR.toFixed(1) : '-', signal: wrSig },
            { label: 'MFI (14)', value: lastMFI ? lastMFI.toFixed(1) : '-', signal: mfiSig },
            { label: 'VWAP', value: fmt(lastVWAP), signal: vwapSig },
            { label: 'ATR (14)', value: lastATR ? (isKR ? Math.round(lastATR).toLocaleString() : lastATR.toFixed(2)) : '-', signal: ['변동성', 'neutral'] },
            { label: 'MA5', value: fmt(lastMA5), signal: maSignal(lastMA5) },
            { label: 'MA20', value: fmt(lastMA20), signal: maSignal(lastMA20) },
            { label: 'MA60', value: fmt(lastMA60), signal: maSignal(lastMA60) },
            { label: 'MA120', value: fmt(lastMA120), signal: maSignal(lastMA120) },
            { label: 'BB 상단', value: fmt(lastBBUpper), signal: price > lastBBUpper ? ['상단 돌파', 'sell'] : ['밴드 내', 'neutral'] },
            { label: 'BB 하단', value: fmt(lastBBLower), signal: price < lastBBLower ? ['하단 돌파', 'buy'] : ['밴드 내', 'neutral'] },
        ];

        const html = indicators.map(ind => `
            <div class="indicator-item">
                <div class="indicator-label">${ind.label}</div>
                <div class="indicator-value">${ind.value}</div>
                <div class="indicator-signal signal-${ind.signal[1]}">${ind.signal[0]}</div>
            </div>
        `).join('');
        const igEl = document.getElementById('indicatorGrid');
        if (igEl) igEl.innerHTML = html;
    }

    // ========================================
    // Financial Info
    // ========================================
    async function renderFinancialInfo(symbol) {
        const grid = document.getElementById('financeGrid');
        if (!grid) return;
        // 로딩 표시 (financeGrid는 초기 HTML이 비어있어 빈 화면 방지)
        grid.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text3);font-size:14px;">로딩 중...</div>';

        // stockData null 안전 (종목 빠른 전환 시 레이스 조건 대비)
        const meta = stockData?.meta;
        const quotes = stockData?.indicators?.quote?.[0] || {};
        const closes = (quotes.close || []).filter(v => v != null);
        const highs  = (quotes.high  || []).filter(v => v != null);
        const lows   = (quotes.low   || []).filter(v => v != null);
        const vols   = (quotes.volume|| []).filter(v => v != null);

        if (!closes.length && !meta) {
            grid.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text3);font-size:14px;">데이터를 불러올 수 없습니다.</div>';
            return;
        }
        const avgVolume = vols.length ? vols.reduce((a,b) => a+b, 0) / vols.length : 0;

        const isKR = currentMarket === 'KR';
        const fmtP = v => {
            if (v == null || isNaN(v)) return '-';
            return isKR ? Math.round(v).toLocaleString() + '원' : '$' + Number(v).toFixed(2);
        };
        const fmtVol = v => {
            if (v >= 1e8) return (v/1e8).toFixed(1) + '억';
            if (v >= 1e4) return (v/1e4).toFixed(0) + '만';
            return Math.round(v).toLocaleString();
        };
        const fmtCap = mc => {
            if (mc == null) return '-';
            if (isKR) {
                if (mc >= 1e12) return (mc/1e12).toFixed(1) + '조원';
                if (mc >= 1e8) return (mc/1e8).toFixed(0) + '억원';
                return Math.round(mc).toLocaleString() + '원';
            }
            if (mc >= 1e12) return '$' + (mc/1e12).toFixed(2) + 'T';
            if (mc >= 1e9) return '$' + (mc/1e9).toFixed(1) + 'B';
            if (mc >= 1e6) return '$' + (mc/1e6).toFixed(0) + 'M';
            return '$' + Number(mc).toLocaleString();
        };

        // 차트 데이터에서 바로 가져올 수 있는 기본값
        const chartOpen = quotes.open?.filter(v=>v!=null).pop();
        const chartDayHigh = quotes.high?.filter(v=>v!=null).pop();
        const chartDayLow = quotes.low?.filter(v=>v!=null).pop();
        const chartHigh52 = Math.max(...highs);
        const chartLow52 = Math.min(...lows);

        // 결과를 담을 객체
        const fin = {
            marketCap: null, per: null, forwardPE: null, pbr: null,
            eps: null, dividend: null, high52: null, low52: null,
            open: null, dayHigh: null, dayLow: null, avgVol: null,
            revenue: null, profitMargin: null, targetPrice: null, beta: null
        };

        // ★ 1단계: 차트 데이터로 즉시 렌더링 (API 응답 기다리지 않음)
        const renderGrid = () => {
            const items = [
                { label: '시가총액', value: fin.marketCap != null ? fmtCap(fin.marketCap) : '-' },
                { label: '시가', value: fmtP(fin.open ?? chartOpen) },
                { label: '고가', value: fmtP(fin.dayHigh ?? chartDayHigh) },
                { label: '저가', value: fmtP(fin.dayLow ?? chartDayLow) },
                { label: 'PER (TTM)', value: fin.per != null ? Number(fin.per).toFixed(2) : '-' },
                { label: 'Forward PER', value: fin.forwardPE != null ? Number(fin.forwardPE).toFixed(2) : '-' },
                { label: 'PBR', value: fin.pbr != null ? Number(fin.pbr).toFixed(2) : '-' },
                { label: 'EPS (TTM)', value: fin.eps != null ? fmtP(fin.eps) : '-' },
                { label: '배당수익률', value: fin.dividend != null && fin.dividend > 0 ? (fin.dividend * 100).toFixed(2) + '%' : '-' },
                { label: '52주 최고', value: fmtP(fin.high52 ?? chartHigh52) },
                { label: '52주 최저', value: fmtP(fin.low52 ?? chartLow52) },
                { label: '평균 거래량', value: fmtVol(fin.avgVol ?? avgVolume) },
            ];
            if (fin.revenue != null) items.push({ label: '매출 (연간)', value: fmtCap(fin.revenue) });
            if (fin.profitMargin != null) items.push({ label: '이익률', value: (fin.profitMargin * 100).toFixed(1) + '%' });
            if (fin.targetPrice != null) items.push({ label: '목표주가 (평균)', value: fmtP(fin.targetPrice) });
            if (fin.beta != null) items.push({ label: '베타', value: Number(fin.beta).toFixed(2) });

            grid.innerHTML = items.map(item => `
                <div class="finance-item">
                    <span class="finance-label">${item.label}</span>
                    <span class="finance-value">${item.value}</span>
                </div>
            `).join('');
        };

        // 즉시 차트 기본 데이터로 렌더
        renderGrid();

        // fin 객체에 값 병합하는 헬퍼
        const mergeIfNull = (key, val) => { if (fin[key] == null && val != null) fin[key] = val; };

        // ★ 2단계: 3개 API를 동시에 병렬 호출
        const api1 = async () => {
            // 방법 1: Yahoo Finance 페이지 HTML 스크래핑 (백엔드 프록시)
            const res = await fetch(`${API_BASE}/api/page/${symbol}`, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) return;
            const html = await res.text();
            const jsonMatches = html.match(/"QuoteSummaryStore":\s*(\{[\s\S]*?\})\s*,\s*"/);
            if (jsonMatches) {
                try {
                    const store = JSON.parse(jsonMatches[1]);
                    const sd = store.summaryDetail || {};
                    const fd = store.financialData || {};
                    const pr = store.price || {};
                    const ks = store.defaultKeyStatistics || {};
                    mergeIfNull('marketCap', pr.marketCap?.raw || sd.marketCap?.raw);
                    mergeIfNull('per', sd.trailingPE?.raw);
                    mergeIfNull('forwardPE', sd.forwardPE?.raw || ks.forwardPE?.raw);
                    mergeIfNull('pbr', sd.priceToBook?.raw || ks.priceToBook?.raw);
                    mergeIfNull('eps', ks.trailingEps?.raw);
                    mergeIfNull('dividend', sd.dividendYield?.raw || sd.trailingAnnualDividendYield?.raw);
                    mergeIfNull('high52', sd.fiftyTwoWeekHigh?.raw);
                    mergeIfNull('low52', sd.fiftyTwoWeekLow?.raw);
                    mergeIfNull('open', sd.open?.raw || pr.regularMarketOpen?.raw);
                    mergeIfNull('dayHigh', sd.dayHigh?.raw || pr.regularMarketDayHigh?.raw);
                    mergeIfNull('dayLow', sd.dayLow?.raw || pr.regularMarketDayLow?.raw);
                    mergeIfNull('avgVol', sd.averageVolume?.raw);
                    mergeIfNull('revenue', fd.totalRevenue?.raw);
                    mergeIfNull('profitMargin', fd.profitMargins?.raw);
                    mergeIfNull('targetPrice', fd.targetMeanPrice?.raw);
                    mergeIfNull('beta', ks.beta?.raw);
                } catch(pe) {}
            }
            if (fin.marketCap == null) {
                const parseTableVal = (label) => {
                    const patterns = [
                        new RegExp(label + '[^>]*>[^>]*>([^<]+)<', 'i'),
                        new RegExp('data-test="' + label + '"[^>]*>([^<]+)<', 'i'),
                    ];
                    for (const p of patterns) { const m = html.match(p); if (m) return m[1].trim(); }
                    return null;
                };
                const parseNum = s => {
                    if (!s || s === 'N/A' || s === '--') return null;
                    s = s.replace(/,/g, '');
                    const m = s.match(/([\d.]+)\s*(T|B|M|K)?/i);
                    if (!m) return parseFloat(s) || null;
                    let n = parseFloat(m[1]);
                    const suffix = (m[2] || '').toUpperCase();
                    if (suffix === 'T') n *= 1e12; else if (suffix === 'B') n *= 1e9;
                    else if (suffix === 'M') n *= 1e6; else if (suffix === 'K') n *= 1e3;
                    return n;
                };
                const mcStr = parseTableVal('MARKET_CAP') || parseTableVal('Market Cap');
                if (mcStr) fin.marketCap = parseNum(mcStr);
                const peStr = parseTableVal('PE_RATIO') || parseTableVal('PE Ratio');
                if (peStr) fin.per = parseFloat(peStr);
                const epsStr = parseTableVal('EPS_RATIO') || parseTableVal('EPS');
                if (epsStr) fin.eps = parseFloat(epsStr);
            }
        };

        const api2 = async () => {
            // 방법 2: v7/finance/quote API
            const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
            const data = await fetchWithProxy(quoteUrl);
            const q = data?.quoteResponse?.result?.[0];
            if (!q) return;
            mergeIfNull('marketCap', q.marketCap);
            mergeIfNull('per', q.trailingPE);
            mergeIfNull('forwardPE', q.forwardPE);
            mergeIfNull('pbr', q.priceToBook);
            mergeIfNull('eps', q.epsTrailingTwelveMonths);
            if (fin.dividend == null && q.trailingAnnualDividendYield > 0) fin.dividend = q.trailingAnnualDividendYield;
            mergeIfNull('high52', q.fiftyTwoWeekHigh);
            mergeIfNull('low52', q.fiftyTwoWeekLow);
            mergeIfNull('open', q.regularMarketOpen);
            mergeIfNull('dayHigh', q.regularMarketDayHigh);
            mergeIfNull('dayLow', q.regularMarketDayLow);
            mergeIfNull('avgVol', q.averageDailyVolume3Month);
        };

        const api3 = async () => {
            // 방법 3: v10 quoteSummary
            const summaryUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail,price`;
            const summaryData = await fetchWithProxy(summaryUrl);
            const r = summaryData?.quoteSummary?.result?.[0];
            if (!r) return;
            const sd = r.summaryDetail || {};
            const fd = r.financialData || {};
            const pr = r.price || {};
            const ks = r.defaultKeyStatistics || {};
            mergeIfNull('marketCap', pr.marketCap?.raw || sd.marketCap?.raw);
            mergeIfNull('per', sd.trailingPE?.raw);
            mergeIfNull('forwardPE', sd.forwardPE?.raw);
            mergeIfNull('pbr', sd.priceToBook?.raw);
            mergeIfNull('eps', ks.trailingEps?.raw);
            mergeIfNull('dividend', sd.dividendYield?.raw || sd.trailingAnnualDividendYield?.raw);
            mergeIfNull('revenue', fd.totalRevenue?.raw);
            mergeIfNull('profitMargin', fd.profitMargins?.raw);
            mergeIfNull('targetPrice', fd.targetMeanPrice?.raw);
            mergeIfNull('beta', ks.beta?.raw);
            mergeIfNull('high52', sd.fiftyTwoWeekHigh?.raw);
            mergeIfNull('low52', sd.fiftyTwoWeekLow?.raw);
        };

        // ★ 병렬 실행 후 최종 렌더링
        await Promise.allSettled([
            api1().catch(()=>{}),
            api2().catch(()=>{}),
            api3().catch(()=>{})
        ]);

        // API 결과로 그리드 업데이트
        renderGrid();
    }

    // ========================================
    // Statistics Info (Yahoo Finance Statistics 탭 전체 항목)
    // ========================================
    async function renderStatisticsInfo(symbol) {
        const grid = document.getElementById('statisticsGrid');
        if (!grid) return;

        const isKR = currentMarket === 'KR';

        const fmtPct = v => (v == null || isNaN(v)) ? null : (v * 100).toFixed(2) + '%';
        const fmtNum = (v, decimals = 2) => (v == null || isNaN(v)) ? null : Number(v).toFixed(decimals);
        const fmtCap = v => {
            if (v == null || isNaN(v)) return null;
            if (isKR) {
                if (v >= 1e12) return (v / 1e12).toFixed(1) + '조원';
                if (v >= 1e8)  return (v / 1e8).toFixed(0) + '억원';
                return Math.round(v).toLocaleString() + '원';
            }
            if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
            if (v >= 1e9)  return '$' + (v / 1e9).toFixed(1) + 'B';
            if (v >= 1e6)  return '$' + (v / 1e6).toFixed(0) + 'M';
            return '$' + Number(v).toLocaleString();
        };
        const fmtP = v => {
            if (v == null || isNaN(v)) return null;
            return isKR ? Math.round(v).toLocaleString() + '원' : '$' + Number(v).toFixed(2);
        };
        const fmtShares = v => {
            if (v == null || isNaN(v)) return null;
            if (v >= 1e8) return (v / 1e8).toFixed(2) + '억주';
            if (v >= 1e4) return (v / 1e4).toFixed(0) + '만주';
            return Math.round(v).toLocaleString() + '주';
        };
        const fmtDate = v => (v == null || v === 0) ? null : new Date(v * 1000).toLocaleDateString('ko-KR');

        const sectionHtml = title => `<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;padding:14px 0 6px;border-bottom:1px solid var(--border);margin-bottom:4px;">${title}</div>`;
        const rowHtml = (label, value) => value == null ? '' : `<div class="finance-item"><span class="finance-label">${label}</span><span class="finance-value">${value}</span></div>`;

        // 로딩 표시
        grid.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text3);font-size:14px;">로딩 중...</div>';

        try {
            const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,summaryDetail,financialData,price,calendarEvents`;
            const data = await fetchRace(url, 10000);
            const r = data?.quoteSummary?.result?.[0];

            if (!r) {
                grid.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text3);font-size:14px;">데이터를 불러올 수 없습니다.</div>';
                return;
            }

            const ks = r.defaultKeyStatistics || {};
            const sd = r.summaryDetail || {};
            const fd = r.financialData || {};

            // ── 섹션 1: 밸류에이션 ──
            const valuation = [
                sectionHtml('밸류에이션'),
                rowHtml('기업가치 (EV)',     fmtCap(ks.enterpriseValue?.raw)),
                rowHtml('PEG Ratio',         fmtNum(ks.pegRatio?.raw)),
                rowHtml('PSR (주가매출비율)', fmtNum(ks.priceToSalesTrailing12Months?.raw)),
                rowHtml('EV / Revenue',       fmtNum(ks.enterpriseToRevenue?.raw)),
                rowHtml('EV / EBITDA',        fmtNum(ks.enterpriseToEbitda?.raw)),
            ].join('');

            // ── 섹션 2: 재무 하이라이트 ──
            const financial = [
                sectionHtml('재무 하이라이트'),
                rowHtml('영업이익률',       fmtPct(fd.operatingMargins?.raw)),
                rowHtml('순이익률',         fmtPct(fd.profitMargins?.raw)),
                rowHtml('ROA',              fmtPct(fd.returnOnAssets?.raw)),
                rowHtml('ROE',              fmtPct(fd.returnOnEquity?.raw)),
                rowHtml('매출 (연간)',       fmtCap(fd.totalRevenue?.raw)),
                rowHtml('EBITDA',           fmtCap(fd.ebitda?.raw)),
                rowHtml('총현금',           fmtCap(fd.totalCash?.raw)),
                rowHtml('총부채',           fmtCap(fd.totalDebt?.raw)),
                rowHtml('부채/자본 (D/E)',  fd.debtToEquity?.raw != null ? fmtNum(fd.debtToEquity.raw) + '%' : null),
                rowHtml('유동비율',         fmtNum(fd.currentRatio?.raw)),
                rowHtml('영업현금흐름',     fmtCap(fd.operatingCashflow?.raw)),
                rowHtml('잉여현금흐름 (FCF)', fmtCap(fd.freeCashflow?.raw)),
                rowHtml('분기 매출성장률',  fmtPct(fd.revenueGrowth?.raw)),
            ].join('');

            // ── 섹션 3: 거래 정보 ──
            const weekChange52 = ks['52WeekChange']?.raw;
            const trading = [
                sectionHtml('거래 정보'),
                rowHtml('52주 등락률',      weekChange52 != null ? (weekChange52 >= 0 ? '+' : '') + fmtPct(weekChange52) : null),
                rowHtml('50일 이동평균',    fmtP(sd.fiftyDayAverage?.raw)),
                rowHtml('200일 이동평균',   fmtP(sd.twoHundredDayAverage?.raw)),
                rowHtml('발행주식수',       fmtShares(ks.sharesOutstanding?.raw)),
                rowHtml('유통주식수 (Float)', fmtShares(ks.floatShares?.raw)),
                rowHtml('내부자 보유 비율', fmtPct(ks.heldPercentInsiders?.raw)),
                rowHtml('기관 보유 비율',   fmtPct(ks.heldPercentInstitutions?.raw)),
                rowHtml('공매도 비율 (Float)', fmtPct(ks.shortPercentOfFloat?.raw)),
                rowHtml('공매도 커버일수',  ks.shortRatio?.raw != null ? fmtNum(ks.shortRatio.raw) + '일' : null),
                rowHtml('배당금 (연간)',    sd.dividendRate?.raw != null ? fmtP(sd.dividendRate.raw) : null),
                rowHtml('배당 수익률',      fmtPct(sd.dividendYield?.raw)),
                rowHtml('배당성향',         fmtPct(sd.payoutRatio?.raw)),
                rowHtml('배당락일',         fmtDate(sd.exDividendDate?.raw)),
                rowHtml('최근 주식분할',    ks.lastSplitFactor || null),
            ].join('');

            grid.innerHTML = valuation + financial + trading;
        } catch (e) {
            grid.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text3);font-size:14px;">데이터를 불러올 수 없습니다.</div>';
        }
    }

    // ========================================
    // Stock Earnings Schedule (종목별 실적 발표)
    // ========================================
    async function renderStockEarnings(symbol) {
        const container = document.getElementById('stockEarnings');
        if (!container) return;
        container.innerHTML = '<div class="se-empty">실적 발표 일정을 불러오는 중...</div>';

        try {
            // Yahoo Finance calendarEvents + earningsHistory
            const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=calendarEvents,earningsHistory,earnings`;
            const data = await fetchWithProxy(url);
            const result = data?.quoteSummary?.result?.[0];
            if (!result) throw new Error('no data');

            const calEvents = result.calendarEvents || {};
            const earningsHist = result.earningsHistory?.history || [];
            const earningsData = result.earnings?.earningsChart || {};

            let html = '';

            // 다음 실적 발표일
            const nextDate = calEvents.earnings?.earningsDate;
            if (nextDate && nextDate.length > 0) {
                const rawEpoch = nextDate[0]?.raw;
                if (rawEpoch) {
                    const nd = new Date(rawEpoch * 1000);
                    // KST 변환 (UTC + 9시간)
                    const kstDate = new Date(nd.getTime() + 9 * 3600 * 1000);
                    const now = new Date();
                    const diffDays = Math.ceil((nd.getTime() - now.getTime()) / 86400000);
                    const isPast = diffDays < 0;

                    const dayNames = ['일','월','화','수','목','금','토'];
                    const dateLabel = `${kstDate.getUTCFullYear()}년 ${kstDate.getUTCMonth()+1}월 ${kstDate.getUTCDate()}일 (${dayNames[kstDate.getUTCDay()]})`;

                    let rangeLabel = '';
                    if (nextDate.length > 1) {
                        const nd2 = new Date(nextDate[1].raw * 1000);
                        const kst2 = new Date(nd2.getTime() + 9 * 3600 * 1000);
                        rangeLabel = ` ~ ${kst2.getUTCMonth()+1}/${kst2.getUTCDate()}`;
                    }

                    let ddayText, ddayClass;
                    if (isPast) {
                        ddayText = '발표 완료';
                        ddayClass = 'done';
                    } else if (diffDays === 0) {
                        ddayText = 'D-DAY';
                        ddayClass = 'soon';
                    } else if (diffDays <= 7) {
                        ddayText = `D-${diffDays}`;
                        ddayClass = 'soon';
                    } else {
                        ddayText = `D-${diffDays}`;
                        ddayClass = 'normal';
                    }

                    // EPS 예상치
                    const epsEst = calEvents.earnings?.earningsAverage?.raw;
                    const epsHigh = calEvents.earnings?.earningsHigh?.raw;
                    const epsLow = calEvents.earnings?.earningsLow?.raw;
                    const revEst = calEvents.earnings?.revenueAverage?.raw;

                    const isKR = currentMarket === 'KR';
                    const fmtEps = v => v != null ? (isKR ? Math.round(v).toLocaleString() + '원' : '$' + v.toFixed(2)) : '-';
                    const fmtRev = v => {
                        if (v == null) return '-';
                        if (isKR) {
                            if (v >= 1e12) return (v/1e12).toFixed(1) + '조원';
                            if (v >= 1e8) return (v/1e8).toFixed(0) + '억원';
                            return Math.round(v).toLocaleString() + '원';
                        }
                        if (v >= 1e9) return '$' + (v/1e9).toFixed(2) + 'B';
                        if (v >= 1e6) return '$' + (v/1e6).toFixed(0) + 'M';
                        return '$' + v.toLocaleString();
                    };

                    html += `<div class="se-next">
                        <div class="se-next-icon ${isPast ? 'past' : 'upcoming'}">${isPast ? '&#9989;' : '&#128197;'}</div>
                        <div class="se-next-info">
                            <div class="se-next-label">${isPast ? '최근 실적 발표' : '다음 실적 발표 (KST)'}</div>
                            <div class="se-next-date">${dateLabel}${rangeLabel}</div>
                            <div class="se-next-detail">`;
                    if (epsEst != null) html += `EPS 예상: ${fmtEps(epsEst)}`;
                    if (epsLow != null && epsHigh != null) html += ` (${fmtEps(epsLow)} ~ ${fmtEps(epsHigh)})`;
                    if (revEst != null) html += ` · 매출 예상: ${fmtRev(revEst)}`;
                    html += `</div>
                        </div>
                        <span class="se-next-dday ${ddayClass}">${ddayText}</span>
                    </div>`;
                }
            }

            // 분기별 실적 히스토리
            if (earningsHist.length > 0) {
                html += `<div class="se-history">
                    <div class="se-history-title">지난 실적 발표 이력</div>`;

                const isKR = currentMarket === 'KR';
                const fmtEps = v => v != null ? (isKR ? Math.round(v).toLocaleString() + '원' : '$' + v.toFixed(2)) : '-';

                earningsHist.slice().reverse().forEach(h => {
                    const qDate = h.quarter?.fmt || '-';
                    const epsActual = h.epsActual?.raw;
                    const epsEst = h.epsEstimate?.raw;
                    const surprise = h.surprisePercent?.raw;

                    let surpriseHtml = '';
                    if (surprise != null) {
                        const pct = (surprise * 100).toFixed(1);
                        if (surprise > 0.01) {
                            surpriseHtml = `<span class="se-surprise beat">+${pct}%</span>`;
                        } else if (surprise < -0.01) {
                            surpriseHtml = `<span class="se-surprise miss">${pct}%</span>`;
                        } else {
                            surpriseHtml = `<span class="se-surprise meet">부합</span>`;
                        }
                    }

                    html += `<div class="se-history-item">
                        <div class="se-history-date">${qDate}</div>
                        <div class="se-history-eps">
                            <div class="se-eps-box"><div class="se-eps-label">실제</div><div class="se-eps-val">${fmtEps(epsActual)}</div></div>
                            <div class="se-eps-box"><div class="se-eps-label">예상</div><div class="se-eps-val">${fmtEps(epsEst)}</div></div>
                        </div>
                        ${surpriseHtml}
                    </div>`;
                });

                html += `</div>`;
            }

            // 분기별 매출/수익 차트 데이터 (텍스트 요약)
            const quarterly = earningsData.quarterly || [];
            if (quarterly.length > 0 && !earningsHist.length) {
                html += `<div class="se-history"><div class="se-history-title">분기별 EPS</div>`;
                const isKR = currentMarket === 'KR';
                const fmtEps = v => v != null ? (isKR ? Math.round(v).toLocaleString() + '원' : '$' + v.toFixed(2)) : '-';
                quarterly.forEach(q => {
                    html += `<div class="se-history-item">
                        <div class="se-history-date">${q.date || '-'}</div>
                        <div class="se-history-eps">
                            <div class="se-eps-box"><div class="se-eps-label">실제</div><div class="se-eps-val">${fmtEps(q.actual?.raw)}</div></div>
                            <div class="se-eps-box"><div class="se-eps-label">예상</div><div class="se-eps-val">${fmtEps(q.estimate?.raw)}</div></div>
                        </div>
                    </div>`;
                });
                html += `</div>`;
            }

            if (!html) {
                html = '<div class="se-empty">이 종목의 실적 발표 일정 정보가 없습니다.</div>';
            }

            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = '<div class="se-empty">실적 발표 일정을 불러올 수 없습니다.</div>';
        }
    }

    // ========================================
    // Company Profile (기업 정보)
    // ========================================
    // 백엔드 API를 통해 데이터 조회 (실패 시 null 반환)
    async function fetchRace(url, timeout = 5000) {
        try { return await fetchWithProxy(url, timeout); }
        catch(e) { return null; }
    }

    // ========================================
    // Analyst Price Targets
    // ========================================
    async function renderAnalystTargets(symbol) {
        const el = document.getElementById('analystTargets');
        if (!el) return;
        if (currentMarket === 'KR') {
            el.innerHTML = '<div class="analyst-nodata">국내 주식은 애널리스트<br>목표주가 데이터가 제공되지 않습니다.</div>';
            return;
        }
        try {
            const res = await fetch(`/api/summary/${encodeURIComponent(symbol)}?modules=financialData,recommendationTrend`, { signal: AbortSignal.timeout(10000) });
            const json = await res.json();
            const r = json?.quoteSummary?.result?.[0];
            const fd = r?.financialData || {};
            const rt = r?.recommendationTrend?.trend?.[0] || {};

            const mean   = fd.targetMeanPrice?.raw;
            const low    = fd.targetLowPrice?.raw;
            const high   = fd.targetHighPrice?.raw;
            const median = fd.targetMedianPrice?.raw;
            const nAnalysts = fd.numberOfAnalystOpinions?.raw;
            const recMean = fd.recommendationMean?.raw;
            const recKey  = fd.recommendationKey;
            const curPrice = stockData?.meta?.regularMarketPrice;

            if (!mean && !low && !high) {
                el.innerHTML = '<div class="analyst-nodata">목표주가 데이터가 없습니다.<br>미국 주식에서만 지원됩니다.</div>';
                return;
            }

            const fmtP = v => v != null ? '$' + Number(v).toFixed(2) : '-';
            const upside = curPrice && mean ? ((mean - curPrice) / curPrice * 100) : null;
            const upsideStr = upside != null ? (upside >= 0 ? `+${upside.toFixed(1)}%` : `${upside.toFixed(1)}%`) : '-';
            const upsideColor = upside != null ? (upside >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text1)';

            // 가격 범위 바 마커 위치 계산
            const rangeSz = (high || mean) - (low || mean);
            const meanPct = rangeSz > 0 ? Math.max(2, Math.min(98, ((mean - low) / rangeSz * 100))) : 50;
            const curPct  = rangeSz > 0 && curPrice != null
                ? Math.max(0, Math.min(100, ((curPrice - low) / rangeSz * 100))) : null;

            // 투자의견 분포
            const sb = rt.strongBuy || 0, b = rt.buy || 0, h = rt.hold || 0;
            const s  = rt.sell || 0, ss = rt.strongSell || 0;
            const total = sb + b + h + s + ss;
            const recLevels = [
                { label: '강력매수', val: sb, color: '#3b82f6' },
                { label: '매수',    val: b,  color: '#93c5fd' },
                { label: '보유',    val: h,  color: '#f59e0b' },
                { label: '매도',    val: s,  color: '#f87171' },
                { label: '강력매도', val: ss, color: '#ef4444' },
            ];
            const recKeyMap = {
                strongBuy: '강력 매수', strong_buy: '강력 매수',
                buy: '매수',
                hold: '보유',
                underperform: '매도 의견', sell: '강력 매도', strong_sell: '강력 매도'
            };
            const recLabelKo = recKeyMap[recKey] || recKey || '-';
            const isBullish = recKey === 'strongBuy' || recKey === 'strong_buy' || recKey === 'buy';
            const recColor = isBullish ? 'var(--green)' : recKey === 'hold' ? '#f59e0b' : 'var(--red)';

            el.innerHTML = `
              <div class="analyst-target-wrap">
                <div class="analyst-price-row">
                  <div>
                    <div style="font-size:11px;color:var(--text3);">현재가</div>
                    <div style="font-size:15px;font-weight:800;color:var(--text1);">${fmtP(curPrice)}</div>
                  </div>
                  <div style="text-align:center;">
                    <div style="font-size:11px;color:var(--text3);">평균 목표가</div>
                    <div style="font-size:15px;font-weight:800;color:var(--text1);">${fmtP(mean)}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:11px;color:var(--text3);">상승여력</div>
                    <div style="font-size:15px;font-weight:800;color:${upsideColor};">${upsideStr}</div>
                  </div>
                </div>
                <div class="analyst-range-bar-wrap">
                  <div class="analyst-range-track">
                    <div class="analyst-range-fill"></div>
                    ${curPct != null ? `<div class="analyst-marker" style="left:${curPct}%;">
                      <div class="analyst-marker-dot" style="background:var(--text1);"></div>
                      <div class="analyst-marker-label" style="color:var(--text3);">현재</div>
                    </div>` : ''}
                    <div class="analyst-marker" style="left:${meanPct}%;">
                      <div class="analyst-marker-dot" style="background:var(--blue);"></div>
                      <div class="analyst-marker-label" style="color:var(--blue);">목표</div>
                    </div>
                  </div>
                  <div class="analyst-range-labels">
                    <span>최저 ${fmtP(low)}</span>
                    <span>중앙 ${fmtP(median)}</span>
                    <span>최고 ${fmtP(high)}</span>
                  </div>
                </div>
                ${total > 0 ? `
                  <div class="analyst-divider"></div>
                  <div class="analyst-rec-title">투자의견 분포 (${total}명)</div>
                  ${recLevels.filter(rv => rv.val > 0).map(rv => {
                    const pct = (rv.val / total * 100).toFixed(0);
                    return `<div class="analyst-rec-row">
                      <div class="analyst-rec-label">${rv.label}</div>
                      <div class="analyst-rec-bar-bg">
                        <div class="analyst-rec-bar-fill" style="width:${pct}%;background:${rv.color};"></div>
                      </div>
                      <div class="analyst-rec-count">${rv.val}명 (${pct}%)</div>
                    </div>`;
                  }).join('')}
                ` : nAnalysts ? `<div class="analyst-divider"></div><div class="analyst-rec-title">분석가 수: ${nAnalysts}명</div>` : ''}
                <div class="analyst-consensus">
                  <span class="analyst-consensus-label">종합 의견</span>
                  <span class="analyst-consensus-val" style="color:${recColor};">${recLabelKo}${recMean != null ? ` (${recMean.toFixed(1)}/5)` : ''}</span>
                </div>
              </div>`;
        } catch(e) {
            el.innerHTML = '<div class="analyst-nodata">데이터를 불러올 수 없습니다.</div>';
        }
    }

    // 기업 프로필 캐시 (같은 종목 재검색 시 즉시 표시)
    const cpCache = {};

    async function renderCompanyProfile(symbol) {
        const ovEl = document.getElementById('companyOverview');
        const exEl = document.getElementById('companyExecutives');
        const hdEl = document.getElementById('companyHolders');
        const inEl = document.getElementById('companyInsider');
        const ihEl = document.getElementById('companyInsiderHolders');
        if (!ovEl) return;

        const fmtMoney = v => { if(v==null||isNaN(v)) return '-'; if(v>=1e9) return '$'+(v/1e9).toFixed(1)+'B'; if(v>=1e6) return '$'+(v/1e6).toFixed(1)+'M'; if(v>=1e3) return '$'+(v/1e3).toFixed(0)+'K'; return '$'+Number(v).toLocaleString(); };
        const fmtShares = v => { if(v==null) return '-'; if(v>=1e9) return (v/1e9).toFixed(2)+'B'; if(v>=1e6) return (v/1e6).toFixed(1)+'M'; if(v>=1e3) return (v/1e3).toFixed(0)+'K'; return Number(v).toLocaleString(); };
        const fmtCap = mc => { if(mc==null) return '-'; if(mc>=1e12) return '$'+(mc/1e12).toFixed(2)+'T'; if(mc>=1e9) return '$'+(mc/1e9).toFixed(1)+'B'; if(mc>=1e6) return '$'+(mc/1e6).toFixed(0)+'M'; return '$'+Number(mc).toLocaleString(); };

        // 캐시 히트 → 즉시 렌더
        if (cpCache[symbol]) {
            renderCPData(cpCache[symbol].r, cpCache[symbol].qtrCloses, ovEl, exEl, hdEl, inEl, ihEl, fmtMoney, fmtShares, fmtCap);
            return;
        }

        const loading = (typeof tabLoading === 'function') ? tabLoading([100, 80, 60, 90, 70]) : '<div class="cp-empty">불러오는 중...</div>';
        ovEl.innerHTML = exEl.innerHTML = hdEl.innerHTML = inEl.innerHTML = loading;
        if (ihEl) ihEl.innerHTML = loading;

        // 기업 정보 + 5년 분기 주가 병렬 요청
        const modules = 'assetProfile,majorHoldersBreakdown,institutionOwnership,insiderTransactions,insiderHolders,price';
        const [data, chartData] = await Promise.all([
            fetchRace(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}`, 5000),
            fetch(`/api/chart/${encodeURIComponent(symbol)}?range=5y&interval=3mo`).then(r=>r.ok?r.json():null).catch(()=>null)
        ]);
        const r = data?.quoteSummary?.result?.[0];

        // 분기별 종가 배열 (시간 순)
        const chartRes = chartData?.chart?.result?.[0];
        const qtrCloses = (chartRes?.indicators?.quote?.[0]?.close || []).filter(v=>v!=null);

        if (r) cpCache[symbol] = { r, qtrCloses };
        renderCPData(r, qtrCloses, ovEl, exEl, hdEl, inEl, ihEl, fmtMoney, fmtShares, fmtCap);
    }

    function renderCPData(r, qtrCloses, ovEl, exEl, hdEl, inEl, ihEl, fmtMoney, fmtShares, fmtCap) {
        // === 개요 (기본정보 + 지분구성 + 거버넌스) ===
        try {
            const ap = r?.assetProfile || {};
            const mh = r?.majorHoldersBreakdown || {};
            const pr = r?.price || {};
            if (!ap.sector && !ap.industry) throw new Error('no data');

            const cleanSymbol = (pr.symbol || '').replace(/\.(KS|KQ)$/, '');
            const companyName = pr.shortName || pr.longName || cleanSymbol;
            let html = '';

            // 헤더
            html += `<div class="cp-overview"><div class="cp-logo">${escHtml(cleanSymbol.charAt(0))}</div><div class="cp-info"><div class="cp-name">${escHtml(companyName||'')}</div><div class="cp-meta">`;
            if (ap.sector) html += `<span>🏢 ${escHtml(ap.sector)}</span>`;
            if (ap.industry) html += `<span>🔧 ${escHtml(ap.industry)}</span>`;
            if (ap.country) html += `<span>🌍 ${escHtml(ap.country)}</span>`;
            html += `</div></div></div>`;

            // 기업 기본정보 2컬럼 그리드
            const rows = [];
            if (pr.exchangeName) rows.push({ l:'거래소', v:escHtml(pr.exchangeName) });
            if (ap.industry) rows.push({ l:'산업', v:escHtml(ap.industry) });
            if (ap.sector) rows.push({ l:'섹터', v:escHtml(ap.sector) });
            if (pr.marketCap?.raw) rows.push({ l:'시가총액', v:fmtCap(pr.marketCap.raw) });
            if (ap.fullTimeEmployees) rows.push({ l:'직원 수', v:Number(ap.fullTimeEmployees).toLocaleString()+'명' });
            if (ap.website) rows.push({ l:'홈페이지', v:`<a href="${escHtml(ap.website)}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none;font-size:12px;">${escHtml(ap.website.replace(/^https?:\/\/(www\.)?/,''))}</a>` });
            if (ap.address1) rows.push({ l:'주소', v:escHtml([ap.city,ap.state,ap.country].filter(Boolean).join(', ')) });
            if (ap.phone) rows.push({ l:'전화', v:escHtml(ap.phone) });
            if (rows.length % 2 !== 0) rows.push({ l:'', v:'' });
            if (rows.length) {
                html += `<div class="cp-section-title">기업 기본정보</div><div class="cp-info-grid">`;
                html += rows.map(i => i.l ? `<div class="cp-info-row"><span class="cp-info-label">${i.l}</span><span class="cp-info-value">${i.v}</span></div>` : `<div class="cp-info-row" style="visibility:hidden"></div>`).join('');
                html += `</div>`;
            }

            // 지분 구성
            if (mh.insidersPercentHeld?.raw != null || mh.institutionsPercentHeld?.raw != null) {
                html += `<div class="cp-section-title">지분 구성</div><div class="cp-shares-grid">`;
                if (mh.insidersPercentHeld?.raw != null) html += `<div class="cp-shares-card"><div class="cp-shares-label">내부자 보유</div><div class="cp-shares-value" style="color:var(--yellow)">${(mh.insidersPercentHeld.raw*100).toFixed(2)}%</div></div>`;
                if (mh.institutionsPercentHeld?.raw != null) html += `<div class="cp-shares-card"><div class="cp-shares-label">기관 보유</div><div class="cp-shares-value" style="color:var(--cyan)">${(mh.institutionsPercentHeld.raw*100).toFixed(2)}%</div></div>`;
                if (mh.institutionsFloatPercentHeld?.raw != null) html += `<div class="cp-shares-card"><div class="cp-shares-label">유동주식 대비 기관</div><div class="cp-shares-value" style="color:var(--blue)">${(mh.institutionsFloatPercentHeld.raw*100).toFixed(2)}%</div></div>`;
                if (mh.institutionsCount?.raw != null) html += `<div class="cp-shares-card"><div class="cp-shares-label">기관 투자자 수</div><div class="cp-shares-value" style="color:var(--text)">${Number(mh.institutionsCount.raw).toLocaleString()}개</div></div>`;
                html += `</div>`;
            }

            // 거버넌스 위험
            if (ap.overallRisk != null) {
                const risks = [{l:'종합 위험',v:ap.overallRisk},{l:'감사 위험',v:ap.auditRisk},{l:'이사회 위험',v:ap.boardRisk},{l:'보상 위험',v:ap.compensationRisk},{l:'주주권리 위험',v:ap.shareHolderRightsRisk}].filter(x=>x.v!=null);
                if (risks.length % 2 !== 0) risks.push({l:'',v:null});
                html += `<div class="cp-section-title">거버넌스 위험</div><div class="cp-info-grid">`;
                html += risks.map(i => i.l ? `<div class="cp-info-row"><span class="cp-info-label">${i.l}</span><span class="cp-info-value" style="color:${i.v<=3?'var(--green)':i.v<=6?'var(--yellow)':'var(--red)'}">${i.v}/10</span></div>` : `<div class="cp-info-row" style="visibility:hidden"></div>`).join('');
                html += `</div>`;
            }
            ovEl.innerHTML = html;
        } catch(e) { ovEl.innerHTML = tabError('기업 개요를 불러올 수 없습니다.'); }

        // === 주요 임원 ===
        try {
            const officers = r?.assetProfile?.companyOfficers || [];
            if (!officers.length) throw 0;
            let html = '<table class="cp-exec-table"><thead><tr><th>이름</th><th>직함</th><th>연봉</th></tr></thead><tbody>';
            officers.slice(0,10).forEach(o => { html += `<tr><td><div class="cp-exec-name">${escHtml(o.name||'-')}</div></td><td style="color:var(--text2);font-size:12px;">${escHtml(o.title||'-')}</td><td><span class="cp-exec-pay">${o.totalPay?.raw ? fmtMoney(o.totalPay.raw) : '-'}</span></td></tr>`; });
            html += '</tbody></table>';
            exEl.innerHTML = html;
        } catch(e) { exEl.innerHTML = tabError('임원 정보를 불러올 수 없습니다.'); }

        // === 주요 투자 기관 ===
        try {
            const inst = r?.institutionOwnership?.ownershipList || [];
            if (!inst.length) throw 0;
            // 보유 비율 → 추정 누적 기간(분기 수) 매핑
            // 대형 지수펀드(≥5%)는 수년간 지속 매수, 소형 기관은 최근 진입 경향
            const estAvgPrice = (pctHeld, pctChange) => {
                if (!qtrCloses || qtrCloses.length === 0) return null;
                let nQ = pctHeld >= 0.05 ? 20          // 5Y: Vanguard·BlackRock 급
                       : pctHeld >= 0.02 ? 12           // 3Y
                       : pctHeld >= 0.01 ? 8            // 2Y
                       : pctHeld >= 0.005 ? 4           // 1Y
                       : 2;                             // 6M: 소형 기관
                // 최근 대량 신규 진입(+20%↑)이면 최근 4분기로 좁힘
                if (pctChange != null && pctChange > 0.2) nQ = Math.min(nQ, 4);
                const slice = qtrCloses.slice(-nQ).filter(v=>v!=null);
                if (!slice.length) return null;
                return slice.reduce((a,b)=>a+b,0) / slice.length;
            };
            const fmtPx = v => v==null?'-': v>=100?`$${v.toFixed(0)}`:`$${v.toFixed(2)}`;

            let html = '<div class="cp-holder-list">';
            inst.slice(0,15).forEach((h,i) => {
                const shares = h.position?.raw;
                const value  = h.value?.raw;
                const pctHeld   = h.pctHeld?.raw ?? 0;
                const pctChange = h.pctChange?.raw ?? null;
                const avgEst = estAvgPrice(pctHeld, pctChange);
                const reportFmt = h.reportDate?.fmt || '';
                html += `<div class="cp-holder-item">
                    <div class="cp-holder-rank">${i+1}</div>
                    <div class="cp-holder-name">${escHtml(h.organization||'-')}${reportFmt?`<div class="cp-holder-sub">기준일 ${escHtml(reportFmt)}</div>`:''}</div>
                    <div class="cp-holder-pct">${pctHeld!=null?(pctHeld*100).toFixed(2)+'%':'-'}${avgEst!=null?`<div class="cp-holder-sub cp-holder-price">추정 평단 ${fmtPx(avgEst)}</div>`:''}</div>
                    <div class="cp-holder-shares">${fmtShares(shares)}</div>
                </div>`;
            });
            html += '</div>';
            hdEl.innerHTML = html;
        } catch(e) { hdEl.innerHTML = tabError('투자 기관 정보를 불러올 수 없습니다.'); }

        // === 최근 내부자 거래 ===
        try {
            const txns = r?.insiderTransactions?.transactions || [];
            if (!txns.length) throw 0;
            let html = '<div class="cp-insider-scroll"><table class="cp-insider-table"><thead><tr><th>거래일</th><th>거래자</th><th>취득/처분</th><th>거래타입</th><th>수량</th><th>가치</th></tr></thead><tbody>';
            txns.slice(0,20).forEach(t => {
                const text = t.transactionText||'';
                const isBuy = /purchase|acquisition|exercise|award|grant/i.test(text);
                const isSell = /sale|sell|dispos/i.test(text);
                html += `<tr><td style="white-space:nowrap">${escHtml(t.startDate?.fmt||'-')}</td><td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.filerName||'')}">${escHtml(t.filerName||'-')}</td><td class="${isBuy?'cp-insider-buy':isSell?'cp-insider-sell':''}">${isBuy?'취득':isSell?'처분':'-'}</td><td style="font-size:11px;color:var(--text3);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(text.split(' - ')[0]||'')}">${escHtml(text.split(' - ')[0]||'-')}</td><td>${t.shares?.raw?fmtShares(t.shares.raw):'-'}</td><td>${t.value?.raw?fmtMoney(t.value.raw):'-'}</td></tr>`;
            });
            html += '</tbody></table></div>';
            inEl.innerHTML = html;
        } catch(e) { inEl.innerHTML = tabError('내부자 거래 정보를 불러올 수 없습니다.'); }

        // === 내부자 지분 현황 ===
        if (ihEl) {
            try {
                const holders = r?.insiderHolders?.holders || [];
                if (!holders.length) throw 0;
                let html = '<div class="cp-holder-list">';
                holders.forEach((h, i) => {
                    const direct = h.positionDirect?.raw ?? 0;
                    const indirect = h.positionIndirect?.raw ?? 0;
                    const total = direct + indirect;
                    const dateStr = h.positionSummaryDate?.fmt || '-';
                    html += `<div class="cp-holder-item"><div class="cp-holder-rank">${i+1}</div><div class="cp-holder-name"><div style="font-weight:600">${escHtml(h.name||'-')}</div><div style="font-size:11px;color:var(--text3)">${escHtml(h.relation||'-')}</div></div><div style="text-align:right"><div class="cp-holder-shares" style="color:var(--yellow)">${fmtShares(total)}</div>${indirect>0?`<div style="font-size:11px;color:var(--text3)">간접 ${fmtShares(indirect)}</div>`:''}<div style="font-size:10px;color:var(--text3)">${escHtml(dateStr)}</div></div></div>`;
                });
                html += '</div>';
                ihEl.innerHTML = html;
            } catch(e) { ihEl.innerHTML = tabError('내부자 지분 정보를 불러올 수 없습니다.'); }
        }
    }

    // ========================================
    // AI Analysis Engine (단타)
    // ========================================
    function renderAIAnalysis() {
        renderDayIndicators();
    }

    function getAnalysisData() {
        const quotes = stockData.indicators.quote[0];
        const closes = quotes.close.filter(v => v != null);
        const volumes = quotes.volume.filter(v => v != null);
        const highs = quotes.high.filter(v => v != null);
        const lows = quotes.low.filter(v => v != null);
        const price = closes[closes.length - 1];
        const ma5 = calcSMA(closes, 5); const ma10 = calcSMA(closes, 10); const ma20 = calcSMA(closes, 20);
        const ma60 = calcSMA(closes, 60); const ma120 = calcSMA(closes, 120);
        const rsi = calcRSI(closes);
        const { macdLine, signalLine, histogram } = calcMACD(closes);
        const bb = calcBollingerBands(closes);
        return { quotes, closes, volumes, highs, lows, price, ma5, ma10, ma20, ma60, ma120, rsi, macdLine, signalLine, histogram, bb };
    }

    function renderScoreCard(prefix, totalScore, details, type) {
        const isDay = type === 'day';
        let recommendation, recColor, summary;
        if (isDay) {
            if (totalScore >= 75) { recommendation = '강력 진입'; recColor = 'var(--green)'; summary = '단기 모멘텀이 매우 강합니다. 거래량 동반 상승으로 빠른 수익 기회가 있습니다.'; }
            else if (totalScore >= 60) { recommendation = '진입 가능'; recColor = 'var(--green)'; summary = '단기 지표가 긍정적입니다. 분봉 흐름을 확인하고 타이트한 손절로 진입하세요.'; }
            else if (totalScore >= 45) { recommendation = '관망'; recColor = 'var(--yellow)'; summary = '단기 방향성이 불확실합니다. 명확한 돌파 또는 지지 확인 후 진입하세요.'; }
            else if (totalScore >= 30) { recommendation = '위험'; recColor = 'var(--red)'; summary = '단기 하락 모멘텀이 우세합니다. 반등 확인 전까지 매수를 자제하세요.'; }
            else { recommendation = '매수 금지'; recColor = 'var(--red)'; summary = '단기 급락 위험이 높습니다. 거래량 감소와 함께 하락 추세가 강화되고 있습니다.'; }
        } else {
            if (totalScore >= 75) { recommendation = '적극 매수'; recColor = 'var(--green)'; summary = '중기 추세가 강한 상승세이며, 눌림목 매수 또는 분할 진입에 적합합니다.'; }
            else if (totalScore >= 60) { recommendation = '매수 고려'; recColor = 'var(--green)'; summary = '추세 전환 초기 또는 상승 추세 지속 중입니다. 분할 매수로 진입하세요.'; }
            else if (totalScore >= 45) { recommendation = '관망'; recColor = 'var(--yellow)'; summary = '추세가 혼조세입니다. 이동평균선 정배열이나 돌파 확인 후 진입하세요.'; }
            else if (totalScore >= 30) { recommendation = '매도 고려'; recColor = 'var(--red)'; summary = '중기 하락 추세가 형성 중입니다. 보유 중이라면 비중 축소를 고려하세요.'; }
            else { recommendation = '강력 매도'; recColor = 'var(--red)'; summary = '이동평균선 역배열과 함께 하락 추세가 뚜렷합니다. 손절이 필요합니다.'; }
        }
        const el = (id) => document.getElementById(id);
        const circle = el(prefix + 'ScoreCircle');
        if (circle) { circle.style.setProperty('--score', totalScore); circle.style.setProperty('--score-color', recColor); }
        const numEl = el(prefix + 'ScoreNumber'); if (numEl) { numEl.textContent = totalScore; numEl.style.color = recColor; }
        const recEl = el(prefix + 'Recommendation'); if (recEl) { recEl.textContent = recommendation; recEl.style.color = recColor; }
        const sumEl = el(prefix + 'Summary'); if (sumEl) { sumEl.textContent = summary; }
        const detEl = el(prefix + 'Details');
        if (detEl) {
            detEl.innerHTML = details.map(d => `
                <div class="ai-detail-item">
                    <div class="ai-detail-title">
                        <span style="color:${d.color}">${d.title}</span>
                        <span style="font-size:12px;color:var(--text3);font-weight:400;">${d.score}점</span>
                    </div>
                    <div class="ai-detail-text">${d.text}</div>
                    <div class="ai-bar"><div class="ai-bar-fill" style="width:${d.score}%;background:${d.color}"></div></div>
                </div>
            `).join('');
        }
    }

    // =====================
    // 단타 통합 분석 (종합 분석 + 진입 시점 합산)
    // =====================
    function renderDayUnified() {
        if (!stockData) return;
        const d = getAnalysisData();
        const { closes, volumes, highs, lows, price, ma5, ma20 } = d;
        const isKR = currentMarket === 'KR';
        const fmtP  = v => isKR ? Math.round(v).toLocaleString() + '원' : '$' + v.toFixed(2);
        const fmtPct = (v, base) => v && base ? ((v-base)/base*100 > 0?'+':'') + ((v-base)/base*100).toFixed(1)+'%' : '';

        // ATR (raw arrays — do NOT filter nulls before passing)
        const _q = stockData.indicators.quote[0];
        const atr = calcATR(_q.high, _q.low, _q.close).filter(v=>v!=null).pop() || 0;

        // opens 배열 (캔들 분석용)
        const opens = _q.open || [];

        // 5분봉 돌파 컨텍스트 추출
        const _ts = stockData.timestamp || [];
        const ohlcvForCtx = _ts.map((ts, i) => ({
            d: new Date(ts * 1000).toISOString().slice(0,10),
            o: _q.open?.[i], h: _q.high?.[i],
            l: _q.low?.[i],  c: _q.close?.[i],
        })).filter(o => o.c != null);
        const datesForCtx = _ts.map(ts => new Date(ts * 1000).toISOString().slice(0,10));
        const bCtx = _extractBreakoutContext(ohlcvForCtx, datesForCtx, highs, lows, closes, currentInterval);

        // 공통 계산
        const lma5  = (ma5  || []).filter(v=>v!=null).pop() || 0;
        const lma20 = (ma20 || []).filter(v=>v!=null).pop() || 0;
        const rvol  = volumes.length >= 20
            ? (volumes[volumes.length-1]||0) / (volumes.slice(-20).reduce((a,b)=>a+b,0)/20) : 1;
        const isUp  = closes[closes.length-1] >= (closes[closes.length-2] || closes[closes.length-1]);

        const colorOf = s => s >= 60 ? 'var(--green)' : s <= 40 ? 'var(--red)' : 'var(--yellow)';
        const iconOf  = s => s === 'pass' ? '✓' : s === 'warn' ? '!' : '✗';

        const metrics = [];

        // ── Metric 1: 돌파 패턴 감지 (35%) ──
        let s1 = 20, status1 = 'fail', desc1 = '', breakoutLabel = '';
        if (bCtx) {
            const aboveYH  = bCtx.yesterdayHigh  != null && price > bCtx.yesterdayHigh;
            const aboveSO  = bCtx.todayOpen       != null && price > bCtx.todayOpen;
            const aboveBH  = bCtx.todayBoxHigh    != null && price > bCtx.todayBoxHigh;
            const ma5Above = lma5 > 0 && price > lma5 && lma5 > lma20;
            if (aboveYH) {
                s1 = 90; status1 = 'pass';
                breakoutLabel = `전일 고점(${fmtP(bCtx.yesterdayHigh)}) 돌파`;
                desc1 = `${breakoutLabel}. 최강 돌파 신호 — 당일 세력 매수 가능성 높음.`;
            } else if (aboveBH && ma5Above) {
                s1 = 80; status1 = 'pass';
                breakoutLabel = `박스 상단(${fmtP(bCtx.todayBoxHigh)}) + MA5 돌파`;
                desc1 = `${breakoutLabel}. 오전 박스 상단 + 이평선 정배열 돌파. 모멘텀 진입 조건.`;
            } else if (aboveSO && ma5Above) {
                s1 = 70; status1 = 'warn';
                breakoutLabel = `시가(${fmtP(bCtx.todayOpen)}) + MA5 위`;
                desc1 = `${breakoutLabel}. 시가 돌파 + 정배열. 전일 고점 돌파 확인 후 진입 권장.`;
            } else if (aboveSO) {
                s1 = 50; status1 = 'warn';
                desc1 = `시가(${fmtP(bCtx.todayOpen)}) 위이나 이평선 미배열. 돌파 신뢰도 낮음.`;
            } else {
                s1 = 20; status1 = 'fail';
                desc1 = `시가(${fmtP(bCtx.todayOpen)}) 아래. 돌파 조건 미충족. 매수 대기.`;
            }
        } else {
            // 5분봉 아닌 경우 이평선 기반 대체 평가
            if (price > lma5 && lma5 > lma20) {
                s1 = 65; status1 = 'warn';
                desc1 = `MA5(${fmtP(lma5)}) 위 + 정배열. 5분봉 차트에서 돌파 기준 확인 권장.`;
            } else if (price > lma20) {
                s1 = 40; status1 = 'warn';
                desc1 = `MA20(${fmtP(lma20)}) 위. 정배열 미형성. 5분봉 전환 후 재분석 권장.`;
            } else {
                s1 = 20; status1 = 'fail';
                desc1 = `이평선 하단. 돌파 미형성. 5분봉 차트에서 확인하세요.`;
            }
        }
        metrics.push({ status: status1, title: '돌파 패턴', score: s1, color: colorOf(s1), desc: desc1, w: .35 });

        // ── Metric 2: 양봉 시가 지지 / 손절 기준 (25%) ──
        // 최근 10봉 중 가장 최근 유효한 양봉을 찾아 시가를 손절 기준으로 사용
        let s2 = 30, status2 = 'fail', desc2 = '', slPrice = null;
        const N = Math.min(closes.length, opens.length, highs.length, lows.length);
        let lastBullIdx = -1;
        for (let i = N - 2; i >= Math.max(0, N - 11); i--) {
            const o = opens[i], c = closes[i], h = highs[i], l = lows[i];
            if (o == null || c == null || h == null || l == null) continue;
            if (c > o) { lastBullIdx = i; break; }
        }
        if (lastBullIdx >= 0) {
            const bo = opens[lastBullIdx], bc = closes[lastBullIdx];
            const bh = highs[lastBullIdx], bl = lows[lastBullIdx];
            const body   = bc - bo;
            const range  = bh - bl;
            const bodyRatio = range > 0 ? body / range : 0;
            slPrice = bo; // 양봉 시가 = 손절 기준
            if (bodyRatio < 0.3) {
                // 꼬리가 몸통보다 훨씬 길다 → 진입 위험
                s2 = 30; status2 = 'warn';
                desc2 = `최근 양봉 몸통 비율 ${(bodyRatio*100).toFixed(0)}% — 꼬리 과다. 지지 불안정. 손절 ${fmtP(bo)}.`;
            } else if (price >= bo) {
                s2 = 85; status2 = 'pass';
                desc2 = `양봉 시가(${fmtP(bo)}) 위 지지 확인. 몸통 ${(bodyRatio*100).toFixed(0)}%. 손절: ${fmtP(bo)} (${fmtPct(bo, price)}).`;
            } else {
                s2 = 20; status2 = 'fail';
                desc2 = `현재가(${fmtP(price)}) < 양봉 시가(${fmtP(bo)}). 지지 붕괴 — 즉시 청산 고려.`;
            }
        } else {
            s2 = 30; status2 = 'fail';
            desc2 = '최근 양봉 부재. 돌파 캔들 미형성 — 진입 기준 불명확.';
            slPrice = price - atr * DAYTRADING_SL_MULTIPLIER; // ATR 폴백
        }
        metrics.push({ status: status2, title: '양봉 시가 지지', score: s2, color: colorOf(s2), desc: desc2, w: .25 });

        // ── Metric 3: 거래량 폭발 (20%) ──
        let s3 = 20, status3 = 'fail', desc3 = '';
        if (rvol >= 2.0 && isUp)  { s3 = 95; status3 = 'pass'; desc3 = `RVOL ${rvol.toFixed(1)}x 폭발 + 상승. 세력 진입 신호.`; }
        else if (rvol >= 1.5)     { s3 = 78; status3 = 'pass'; desc3 = `RVOL ${rvol.toFixed(1)}x 평균 이상. 돌파 거래량 동반.`; }
        else if (rvol >= 1.0)     { s3 = 50; status3 = 'warn'; desc3 = `RVOL ${rvol.toFixed(1)}x 보통. 거래량 증가 확인 후 진입.`; }
        else                      { s3 = 20; status3 = 'fail'; desc3 = `RVOL ${rvol.toFixed(1)}x 감소. 거래량 미동반 돌파 — 신뢰도 낮음.`; }
        metrics.push({ status: status3, title: '거래량 동반', score: s3, color: colorOf(s3), desc: desc3, w: .20 });

        // ── Metric 4: 이평선 정배열 (10%) ──
        let s4 = 20, status4 = 'fail', desc4 = '';
        if (lma5 > lma20 && price > lma5) {
            s4 = 90; status4 = 'pass'; desc4 = `정배열 (MA5 ${fmtP(lma5)} > MA20 ${fmtP(lma20)}) + 가격 MA5 위. 돌파 지속 조건.`;
        } else if (price > lma5) {
            s4 = 55; status4 = 'warn'; desc4 = `가격 MA5 위이나 MA5 < MA20(역배열). 단기 반등 가능하나 추세 미확인.`;
        } else {
            s4 = 20; status4 = 'fail'; desc4 = `가격 MA5(${fmtP(lma5)}) 하단. 이평선 역배열. 돌파 지속 불리.`;
        }
        metrics.push({ status: status4, title: '이평선 정배열', score: s4, color: colorOf(s4), desc: desc4, w: .10 });

        // ── Metric 5: 위험 패턴 감지 (10%) ──
        let s5 = 100, status5 = 'pass', desc5 = '위험 패턴 없음. 정상 진입 구간.';
        // 장대양봉 시가 복귀 감지: 최근 5봉 중 장대양봉(몸통 ≥ 3% of open) 이후 현재가가 그 시가 근처 하락
        for (let i = N - 5; i < N - 1; i++) {
            if (i < 0) continue;
            const o = opens[i], c = closes[i];
            if (o == null || c == null || o === 0) continue;
            const bodyPct = (c - o) / o * 100;
            if (bodyPct >= 3.0) { // 장대양봉
                const returnPct = (price - o) / o * 100;
                if (returnPct <= 0.3 && returnPct >= -1.5) { // 시가 근처로 복귀
                    s5 = 0; status5 = 'fail';
                    desc5 = `장대양봉(+${bodyPct.toFixed(1)}%) 시가(${fmtP(o)}) 복귀 감지 — 90% 급락 위험. 보유 중이면 즉시 청산.`;
                    break;
                }
            }
        }
        // 십자캔들 2개 연속
        if (s5 === 100 && N >= 2) {
            const isCross = (i) => {
                const o = opens[i], c = closes[i], h = highs[i], l = lows[i];
                if (!o || !c || !h || !l || h === l) return false;
                return Math.abs(c - o) / (h - l) < 0.15;
            };
            if (isCross(N-2) && isCross(N-3)) {
                s5 = 40; status5 = 'warn';
                desc5 = '십자캔들 2개 연속 감지. 돌파 주저 — SL을 종가 기준으로 조정 권장.';
            }
        }
        metrics.push({ status: status5, title: '위험 패턴', score: s5, color: colorOf(s5), desc: desc5, w: .10 });

        // ── 종합 점수 ──
        const totalScore = Math.round(metrics.reduce((sum, m) => sum + m.w * m.score, 0));

        const recColor = totalScore >= 75 ? 'var(--green)' : totalScore >= 50 ? 'var(--yellow)' : 'var(--red)';
        const recText  = totalScore >= 75 ? '강력 진입' : totalScore >= 60 ? '진입 가능' : totalScore >= 45 ? '관망' : totalScore >= 30 ? '위험' : '매수 금지';
        const recDesc  = totalScore >= 75 ? '5분봉 돌파 조건 충족. 양봉 시가 위에서 거래량 동반 — 즉시 진입.'
                       : totalScore >= 60 ? '돌파 신호 출현. 양봉 시가 지지 확인 후 분할 진입.'
                       : totalScore >= 45 ? '돌파 조건 미충족. 명확한 저항선 돌파 및 거래량 확인 후 대기.'
                       : totalScore >= 30 ? '돌파 실패 또는 위험 패턴 감지. 진입 금지.'
                       : '위험 패턴 활성. 보유 중이면 즉시 청산 검토.';

        // ── 진입가 — 돌파 단타는 저항 위에서 매수 (역지정가) ──
        let entryPrice = price, entryLabel = '현재가';
        if (bCtx?.yesterdayHigh != null && bCtx.yesterdayHigh > price * 1.003) {
            entryPrice = bCtx.yesterdayHigh * 1.003;
            entryLabel = '전일 고점 +0.3%';
        } else if (bCtx?.todayBoxHigh != null && bCtx.todayBoxHigh > price * 1.003) {
            entryPrice = bCtx.todayBoxHigh * 1.003;
            entryLabel = '박스 상단 +0.3%';
        } else if (bCtx?.todayOpen != null && bCtx.todayOpen > price * 1.003) {
            entryPrice = bCtx.todayOpen * 1.003;
            entryLabel = '시가 +0.3%';
        } else {
            // 이미 모든 저항을 돌파했거나 5분봉 컨텍스트 없음 — 0.5% 추격
            entryPrice = price * 1.005;
            entryLabel = '돌파 추격 +0.5%';
        }
        // ── 손절·목표 계산 (entryPrice 기준) ──
        const sl  = slPrice != null ? slPrice : entryPrice - atr * DAYTRADING_SL_MULTIPLIER;
        const tp1 = entryPrice * 1.025;
        const tp2 = entryPrice * 1.08;
        const slLabel = lastBullIdx >= 0 ? `양봉 시가` : `ATR × ${DAYTRADING_SL_MULTIPLIER}`;
        const risk = entryPrice - sl;
        const rrRatio = risk > 0 ? ((tp1 - entryPrice) / risk).toFixed(2) : '-';
        const rrRatio2 = risk > 0 ? ((tp2 - entryPrice) / risk).toFixed(2) : '-';

        // ── 본문 출력 (v575 새 UX) ──
        const body = document.getElementById('dayMainBody');
        if (!body) return;
        // 색상·헬퍼
        const isMobile = window.innerWidth <= 640;
        const scoreColor = recColor;
        const cellSt    = 'text-align:center;';
        const cellLblSt = 'font-size:10.5px;color:var(--text2);font-weight:700;letter-spacing:.3px;';
        const cellValSt = 'font-size:14px;font-weight:800;color:var(--text);margin-top:3px;font-variant-numeric:tabular-nums;';
        const blockSt = (c) => `border-left:3px solid ${c};padding:10px 0 10px 12px;margin-top:14px;`;
        const blockLblSt = `font-size:10.5px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;`;

        // 5분봉 아닌 인터벌 안내
        const nonFiveBanner = (currentInterval !== '5m')
            ? `<div style="margin-top:10px;padding:8px 12px;border-radius:8px;background:rgba(251,191,36,.10);border:1px solid var(--yellow);font-size:12px;color:var(--yellow);font-weight:600;">⚡ 5분봉 차트에서 가장 정확합니다 — 현재: <strong>${currentInterval || '?'}</strong> 인터벌</div>`
            : '';

        // 5단계 체크 카드 (가중치 시각화 포함)
        const metricsHtml = metrics.map((m, i) => {
            const statusBg = m.status === 'pass' ? 'rgba(34,197,94,.14)'
                           : m.status === 'warn' ? 'rgba(234,179,8,.14)'
                           : 'rgba(239,68,68,.14)';
            const statusFg = m.status === 'pass' ? '#22c55e'
                           : m.status === 'warn' ? '#eab308'
                           : '#ef4444';
            const icon = m.status === 'pass' ? '✓' : m.status === 'warn' ? '!' : '✗';
            const weightPct = Math.round(m.w * 100);
            return `<div style="background:var(--bg3);border-radius:10px;padding:12px 14px;margin-top:8px;">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${statusBg};color:${statusFg};font-size:13px;font-weight:900;flex-shrink:0;">${icon}</span>
                    <span style="font-size:13.5px;font-weight:800;color:var(--text);flex:1;min-width:0;">${m.title}</span>
                    <span style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:6px;background:rgba(148,163,184,.18);color:var(--text2);">가중치 ${weightPct}%</span>
                    <span style="font-size:13px;font-weight:900;color:${m.color};font-variant-numeric:tabular-nums;min-width:42px;text-align:right;">${m.score}점</span>
                </div>
                <div style="margin-top:6px;height:5px;background:var(--bg2);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${m.score}%;background:${m.color};border-radius:3px;"></div></div>
                <div style="font-size:11.5px;color:var(--text2);margin-top:6px;line-height:1.5;">${m.desc}</div>
            </div>`;
        }).join('');

        // 기준 안내 (점수 등급)
        const gradeRows = [
            { range: '75~100점', label: '강력 진입', color: '#22c55e', strat: '돌파 조건 충족 — 거래량 동반 시 즉시 진입' },
            { range: '60~74점',  label: '진입 가능', color: '#22c55e', strat: '돌파 신호 출현 — 양봉 시가 지지 확인 후 분할 진입' },
            { range: '45~59점',  label: '관망',     color: '#eab308', strat: '돌파 조건 미충족 — 저항 돌파 + 거래량 대기' },
            { range: '30~44점',  label: '위험',     color: '#f97316', strat: '돌파 실패 / 위험 패턴 — 진입 금지' },
            { range: '0~29점',   label: '매수 금지', color: '#ef4444', strat: '위험 패턴 활성 — 보유 시 즉시 청산 검토' },
        ];
        const gradeHtml = gradeRows.map(r => {
            const isCurrent = (r.range.startsWith('75') && totalScore >= 75)
                            || (r.range.startsWith('60') && totalScore >= 60 && totalScore < 75)
                            || (r.range.startsWith('45') && totalScore >= 45 && totalScore < 60)
                            || (r.range.startsWith('30') && totalScore >= 30 && totalScore < 45)
                            || (r.range.startsWith('0') && totalScore < 30);
            const bg = isCurrent ? `${r.color}14` : 'transparent';
            const border = isCurrent ? `${r.color}55` : 'var(--border)';
            return `<div style="display:grid;grid-template-columns:auto auto 1fr;gap:10px;padding:7px 10px;background:${bg};border:1px solid ${border};border-radius:8px;align-items:center;">
                <span style="font-size:10.5px;font-weight:800;color:var(--text);min-width:62px;">${r.range}</span>
                <span style="font-size:11.5px;font-weight:800;color:${r.color};min-width:64px;">${r.label}</span>
                <span style="font-size:10.5px;color:var(--text2);">${r.strat}</span>
            </div>`;
        }).join('');

        body.innerHTML = `
            <!-- 큰 점수 배너 -->
            <div style="display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;background:linear-gradient(135deg, ${scoreColor}1f 0%, ${scoreColor}0a 100%);border:1px solid ${scoreColor}55;border-radius:10px;padding:16px 18px;margin-top:10px;">
                <div style="text-align:center;min-width:84px;">
                    <div style="font-size:9.5px;font-weight:800;color:${scoreColor};text-transform:uppercase;letter-spacing:.6px;opacity:.85;">돌파 점수</div>
                    <div style="font-size:38px;font-weight:900;line-height:1;color:${scoreColor};letter-spacing:-1.2px;font-variant-numeric:tabular-nums;">${totalScore}</div>
                    <div style="font-size:9.5px;color:${scoreColor};font-weight:700;margin-top:2px;opacity:.85;">/ 100</div>
                </div>
                <div>
                    <div style="font-size:16px;font-weight:900;color:${scoreColor};letter-spacing:-.3px;">${recText}</div>
                    <div style="font-size:12px;color:var(--text2);margin-top:3px;line-height:1.45;">${recDesc}</div>
                </div>
            </div>

            ${nonFiveBanner}

            <!-- 매매 라인 (진입/손절/목표/R:R) — 위로 끌어올림 (즉시 의사결정 정보) -->
            <div style="margin-top:14px;">
                <div style="${blockLblSt}">💰 매매 라인 (당일 청산 원칙)</div>
                <div style="display:grid;grid-template-columns:${isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)'};gap:8px;background:var(--bg3);padding:12px;border-radius:10px;">
                    <div style="${cellSt}">
                        <div style="${cellLblSt}">진입가</div>
                        <div style="${cellValSt}">${fmtP(entryPrice)}</div>
                        <div style="font-size:10px;color:var(--text2);font-weight:600;margin-top:2px;">${entryLabel}</div>
                    </div>
                    <div style="${cellSt}">
                        <div style="${cellLblSt}">손절 (${slLabel})</div>
                        <div style="${cellValSt};color:#ef4444;">${fmtP(sl)}</div>
                        <div style="font-size:10px;color:var(--text2);font-weight:600;">${fmtPct(sl,entryPrice)}</div>
                    </div>
                    <div style="${cellSt}">
                        <div style="${cellLblSt}">1차 목표 (1:${rrRatio})</div>
                        <div style="${cellValSt};color:#22c55e;">${fmtP(tp1)}</div>
                        <div style="font-size:10px;color:var(--text2);font-weight:600;">+2.5%</div>
                    </div>
                    <div style="${cellSt}">
                        <div style="${cellLblSt}">2차 목표 (1:${rrRatio2})</div>
                        <div style="${cellValSt};color:#22c55e;">${fmtP(tp2)}</div>
                        <div style="font-size:10px;color:var(--text2);font-weight:600;">+8.0%</div>
                    </div>
                </div>
                <div style="font-size:11px;color:var(--text2);margin-top:6px;text-align:right;">R:R 1차 <strong style="color:var(--text)">1:${rrRatio}</strong> · 2차 <strong style="color:var(--text)">1:${rrRatio2}</strong></div>
            </div>

            <!-- 5단계 체크 -->
            <div style="margin-top:16px;">
                <div style="${blockLblSt}">🔍 5단계 돌파 체크 (가중치 합산 = 종합점수)</div>
                ${metricsHtml}
            </div>

            <!-- 점수 등급 기준 -->
            <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);">
                <div style="${blockLblSt}">📚 점수 등급 기준</div>
                <div style="display:flex;flex-direction:column;gap:5px;">${gradeHtml}</div>
            </div>

            <!-- 원칙 -->
            <div style="margin-top:14px;padding:10px 12px;background:var(--bg3);border-radius:8px;font-size:11.5px;color:var(--text2);line-height:1.55;">
                💡 <strong style="color:var(--text);">5분봉 돌파 단타 원칙</strong><br>
                · 진입은 양봉 돌파 후 거래량(RVOL 1.5x+) 동반 시에만<br>
                · 손절은 양봉 시가 또는 ATR×${DAYTRADING_SL_MULTIPLIER} 아래에서 즉시 청산<br>
                · 당일 청산 원칙 — 다음날까지 보유 금지
            </div>
        `;

        // R/R 게이트 적용
        _applyRRGate();

        // Falling Knife 경고 (카드 border 색상 변경)
        if (_isFallingKnife()) {
            const card = document.getElementById('dayUnifiedChecklist')?.closest('.card');
            if (card) card.style.borderColor = 'var(--red)';
        }

        // 분할 매수 계산기 데이터 전달 (3단계)
        const e1 = price, e2 = price - atr*0.5, e3 = price - atr*1.0;
        window._sc = { prices: [e1, e2, e3], tp1, tp2, sl, isKR, atr };
        renderSplitCalc();
    }

    function renderDayIndicators() {
        const d = getAnalysisData();
        const { closes, price, volumes, ma5, ma10, rsi, bb } = d;
        const lastRSI = rsi.filter(v=>v!=null).pop() || 50;
        const lma5 = ma5.filter(v=>v!=null).pop(); const lma10 = ma10.filter(v=>v!=null).pop();
        const volNow = volumes[volumes.length-1] || 0;
        const avgVol20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a,b)=>a+b,0)/20 : volNow;
        const volRatio = (volNow/avgVol20*100).toFixed(0);
        const chg1 = closes.length >= 2 ? ((closes[closes.length-1]-closes[closes.length-2])/closes[closes.length-2]*100).toFixed(2) : '0.00';
        const grid = document.getElementById('dayIndicatorGrid');
        if (!grid) return;
        grid.innerHTML = [
            { label: 'RSI(14)', value: lastRSI.toFixed(1), signal: rsiZoneLabel(lastRSI)[0], color: rsiZoneLabel(lastRSI)[2] },
            { label: 'MA5/MA10', value: lma5>lma10?'정배열':'역배열', signal: lma5>lma10?'상승':'하락', color: lma5>lma10?'var(--green)':'var(--red)' },
            { label: '거래량비', value: volRatio+'%', signal: volRatio>=150?'급증':volRatio<=50?'감소':'보통', color: volRatio>=150?'var(--cyan)':volRatio<=50?'var(--text3)':'var(--yellow)' },
            { label: '전일 대비', value: chg1+'%', signal: parseFloat(chg1)>=0?'상승':'하락', color: parseFloat(chg1)>=0?'var(--green)':'var(--red)' },
        ].map(i=>`<div class="indicator-item"><div class="indicator-label">${i.label}</div><div class="indicator-value" style="color:${i.color}">${i.value}</div><div class="indicator-signal" style="color:${i.color}">${i.signal}</div></div>`).join('');
    }

    // ========================================
    // 단테 단타 분석기 — 한국 단타 기법 8종을 미국장 가격/거래량에 적용
    //   1) 밥그릇   2) 공구리   3) 하이힐   4) 매집봉
    //   5) 눌림목   6) 대칭이론  7) 손절 3원칙  8) 종합 점수
    // ⚠️ 백테스트 미검증 — 학습/참고용 (근사치)
    // ========================================
    function _danteSafeNum(v) { return Number.isFinite(v) ? v : null; }
    function _danteATR(highs, lows, closes, period = 14) {
        const tr = [];
        for (let i = 1; i < closes.length; i++) {
            if (highs[i] == null || lows[i] == null || closes[i-1] == null) { tr.push(null); continue; }
            tr.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
        }
        const valid = tr.filter(v => v != null);
        if (valid.length < period) return null;
        return valid.slice(-period).reduce((a,b)=>a+b,0) / period;
    }

    // 1) 밥그릇 — U자형 바닥 + 손잡이(눌림) + 돌파 시그널 (완화된 임계)
    function _danteBapgeureut(highs, lows, closes, volumes) {
        const N = closes.length;
        if (N < 40) return { hit: false };
        const last = closes[N-1];
        const lookback = closes.slice(-Math.min(60, N));
        const cleanLb = lookback.filter(v=>v!=null);
        if (cleanLb.length < 20) return { hit: false };
        const peakPrice = Math.max(...cleanLb);
        const trough = Math.min(...cleanLb);
        const drop = (peakPrice - trough) / peakPrice * 100;
        // 컵 깊이: 10~45% (기존 15~40%)
        if (drop < 10 || drop > 45) return { hit: false };
        // 손잡이: 최근 7봉 작은 눌림 OR 임박 돌파
        const recent = closes.slice(-7).filter(v=>v!=null);
        if (!recent.length) return { hit: false };
        const recentHigh = Math.max(...recent);
        const handleDip = Math.max(0, (recentHigh - last) / recentHigh * 100);
        const avgVol60 = volumes.slice(-Math.min(60, N)).filter(v=>v!=null).reduce((a,b)=>a+(b||0),0) / Math.min(60, N);
        const avgVol7 = volumes.slice(-7).filter(v=>v!=null).reduce((a,b)=>a+(b||0),0) / 7;
        const volShrink = avgVol7 < avgVol60 * 1.0;  // 1.0배 이하면 통과 (감소 아니어도 OK)
        // 손잡이 조건 완화: handleDip 0~12% + 돌파 임박(95% 이상)
        const breakout = last >= recentHigh * 0.95;
        if (handleDip < 12 && breakout && (volShrink || handleDip < 4)) {
            const stop = Math.min(...recent) * 0.97;
            return { hit: true, target: last + (peakPrice - trough) * 0.6, stop, note: `컵 깊이 ${drop.toFixed(0)}% · 손잡이 ${handleDip.toFixed(1)}% 눌림` };
        }
        return { hit: false };
    }

    // 2) 공구리 — 거래량 매물대 돌파 → 지지선 전환 (완화)
    function _danteGonguri(closes, volumes) {
        const N = closes.length;
        if (N < 20) return { hit: false };
        const last = closes[N-1];
        const winLen = Math.min(30, N);
        const vols = volumes.slice(-winLen).map((v,i)=>({v: v||0, p: closes[N-winLen+i]})).filter(o=>o.v && o.p);
        if (vols.length < 8) return { hit: false };
        vols.sort((a,b) => b.v - a.v);
        const topZone = vols.slice(0, Math.max(2, Math.floor(vols.length * 0.2)));
        const zonePrice = topZone.reduce((s,o)=>s+o.p,0) / topZone.length;
        const distance = (last - zonePrice) / zonePrice * 100;
        // 매물대 위 최근 5일 중 3일 이상 유지 (기존 4일)
        const above = closes.slice(-5).filter(c => c != null && c > zonePrice).length;
        // distance 범위 확장: 0~12% (기존 0~8%)
        if (distance > 0 && distance < 12 && above >= 3) {
            return { hit: true, support: zonePrice, note: `매물대 $${zonePrice.toFixed(2)} 위 ${distance.toFixed(1)}% 지지` };
        }
        return { hit: false };
    }

    // 3) 하이힐 — V자 반등 후 직전 고점 근접 (완화)
    function _danteHighheel(closes) {
        const N = closes.length;
        if (N < 10) return { hit: false };
        const last = closes[N-1];
        const window = closes.slice(-Math.min(15, N));
        const clean = window.filter(v=>v!=null);
        if (clean.length < 8) return { hit: false };
        const peak = Math.max(...clean);
        const peakIdx = window.indexOf(peak);
        // peak 위치 완화: 1~12일 전
        if (peakIdx < 1 || peakIdx >= window.length - 1) return { hit: false };
        const postPeak = window.slice(peakIdx + 1).filter(v=>v!=null);
        if (!postPeak.length) return { hit: false };
        const trough = Math.min(...postPeak);
        const retrace = (peak - trough) / peak * 100;
        if (retrace < 3) return { hit: false };  // 3% 이상 되돌림 (기존 5%)
        const rebound = (last - trough) / trough * 100;
        // 직전 고점의 92% 이상 회복 (기존 98%)
        if (rebound > 2 && last >= peak * 0.92) {
            return { hit: true, target: last + (peak - trough) * 0.7, stop: trough * 0.97, note: `V자 반등 ${rebound.toFixed(1)}% · 고점 ${((last/peak)*100).toFixed(0)}% 회복` };
        }
        return { hit: false };
    }

    // 4) 매집봉/세력봉 — 평균 거래량 2배 이상 + 양봉 (기존 3배 → 2배)
    function _danteMaejip(opens, closes, volumes) {
        const N = closes.length;
        if (N < 30) return { hit: false };
        const winLen = Math.min(60, N - 1);
        const volSlice = volumes.slice(-(winLen+1), -1).filter(v=>v!=null);
        if (!volSlice.length) return { hit: false };
        const avgVol = volSlice.reduce((a,b)=>a+(b||0),0) / volSlice.length;
        // 최근 15일 내 가장 강한 매집봉 1개 찾기 (기존 10일)
        let best = null;
        for (let i = Math.max(1, N - 15); i < N; i++) {
            if (!volumes[i] || !opens[i] || !closes[i]) continue;
            const ratio = volumes[i] / avgVol;
            if (ratio < 2 || closes[i] <= opens[i]) continue;
            if (!best || ratio > best.ratio) best = { i, ratio };
        }
        if (!best) return { hit: false };
        const ago = N - 1 - best.i;
        const support = opens[best.i];
        return { hit: true, support, note: `${ago}일 전 거래량 ${best.ratio.toFixed(1)}배 양봉 (지지선 $${support.toFixed(2)})` };
    }

    // 5) 눌림목 — 정배열 + 단기 이평선 지지 (완화)
    function _danteNullim(opens, closes) {
        const N = closes.length;
        if (N < 30) return { hit: false };
        const sma = (n) => {
            if (N < n) return null;
            const slice = closes.slice(-n).filter(v=>v!=null);
            if (slice.length < n * 0.8) return null;
            return slice.reduce((a,b)=>a+b,0) / slice.length;
        };
        const ma5 = sma(5), ma20 = sma(20), ma60 = sma(60) || sma(Math.min(N-1, 50));
        if (!ma5 || !ma20) return { hit: false };
        // 완전 정배열 OR 부분 정배열 (ma5>ma20)
        const aligned = ma5 > ma20 && (!ma60 || ma20 > ma60 * 0.98);
        if (!aligned) return { hit: false };
        const last = closes[N-1];
        if (!last) return { hit: false };
        // 5일선 ±4% 근접 (기존 2%)
        const nearMa5 = Math.abs(last - ma5) / ma5 < 0.04;
        const lastOpen = opens[N-1];
        const bullish = !lastOpen || last >= lastOpen * 0.998; // 양봉 or 거의 양봉
        if (nearMa5 && bullish) {
            return { hit: true, support: ma5, stop: ma20 * 0.97, note: `정배열 + MA5 ${((last-ma5)/ma5*100).toFixed(1)}% 근접` };
        }
        return { hit: false };
    }

    // 6) 대칭 이론 — 직전 파동 폭만큼 반등 목표가 산출
    function _danteSymmetry(closes) {
        const N = closes.length;
        if (N < 40) return null;
        const window = closes.slice(-40);
        const peakIdx = window.indexOf(Math.max(...window.filter(v=>v!=null)));
        const troughIdx = window.indexOf(Math.min(...window.filter(v=>v!=null)));
        if (peakIdx >= troughIdx) return null; // 상승 후 하락 후 반등 시나리오만
        const peak = window[peakIdx], trough = window[troughIdx];
        const wave = peak - trough;
        return { target: closes[N-1] + wave, peak, trough };
    }

    // 7) 손절 3원칙 — 진입가 가정 시 손절가 산출
    function _danteSonjeolRules(closes, ma20, entry) {
        const rule1 = entry * 0.97;
        const rule2 = ma20 ? ma20 * 0.99 : null;
        return { rule1, rule2, finalStop: rule2 ? Math.max(rule1, rule2) : rule1 };
    }

    // 8) 종합 점수 + 매수/매도/손절 권장가
    function _danteCalc() {
        if (!stockData) return null;
        const q = stockData.indicators.quote[0];
        const opens = (q.open || []).slice();
        const closes = (q.close || []).slice();
        const highs = (q.high || []).slice();
        const lows = (q.low || []).slice();
        const volumes = (q.volume || []).slice();
        if (closes.length < 30) return null;
        const last = [...closes].reverse().find(v => v != null);
        if (!last) return null;
        const atr = _danteATR(highs, lows, closes, 14) || last * 0.02;
        const sma20Arr = [];
        for (let i = 0; i < closes.length; i++) {
            if (i < 19) { sma20Arr.push(null); continue; }
            const slice = closes.slice(i-19, i+1).filter(v=>v!=null);
            sma20Arr.push(slice.length === 20 ? slice.reduce((a,b)=>a+b,0) / 20 : null);
        }
        const ma20 = [...sma20Arr].reverse().find(v => v != null);

        const signals = [
            { key: 'bapgeureut', label: '밥그릇', desc: '컵 손잡이 돌파', result: _danteBapgeureut(highs, lows, closes, volumes), weight: 2 },
            { key: 'gonguri',    label: '공구리', desc: '매물대 지지 전환', result: _danteGonguri(closes, volumes), weight: 2 },
            { key: 'highheel',   label: '하이힐', desc: 'V자 반등', result: _danteHighheel(closes), weight: 1.5 },
            { key: 'maejip',     label: '매집봉', desc: '세력 진입 흔적', result: _danteMaejip(opens, closes, volumes), weight: 1.5 },
            { key: 'nullim',     label: '눌림목', desc: '정배열 + 5일선 지지', result: _danteNullim(opens, closes), weight: 2 },
        ];
        const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
        const hitWeight = signals.reduce((s, x) => s + (x.result.hit ? x.weight : 0), 0);
        const score10 = Math.round(hitWeight / totalWeight * 10);

        const sym = _danteSymmetry(closes);
        // 시그널에서 추출한 지지선 후보 (매집봉/공구리/눌림목)
        const supports = signals.map(s => s.result.support).filter(s => s && s < last && s > 0);
        const strongestSupport = supports.length ? Math.max(...supports) : null;
        // 데이터 기반 분할매수 진입가 (volatility-aware)
        //   1차: 현재가 (즉시)
        //   2차: 현재가 - 0.7 ATR (단기 눌림)
        //   3차: 더 깊은 눌림 — 강한 지지선 OR 현재가 - 1.5 ATR
        const entry1 = last;
        const entry2 = last - atr * 0.7;
        const entry3 = strongestSupport && strongestSupport > last - atr * 2.5
            ? strongestSupport
            : last - atr * 1.5;
        const entry3Source = strongestSupport && strongestSupport > last - atr * 2.5
            ? '지지선' : '하방 변동성';

        // 점수에 따라 분할 비중 동적 결정
        let splitRatios;
        if (score10 >= 7)      splitRatios = [50, 30, 20]; // 강한 시그널 → 즉시 진입 비중 ↑
        else if (score10 >= 5) splitRatios = [30, 40, 30]; // 보통 → 균형
        else if (score10 >= 3) splitRatios = [20, 35, 45]; // 약함 → 눌림 대기 비중 ↑
        else                   splitRatios = [10, 30, 60]; // 매우 약함 → 즉시 진입 최소

        // 예상 평단가 (모두 체결 시)
        const totalW = splitRatios.reduce((a,b)=>a+b,0);
        const avgEntry = (entry1 * splitRatios[0] + entry2 * splitRatios[1] + entry3 * splitRatios[2]) / totalW;

        // 목표가: 시그널 target + 대칭이론 + ATR 기반
        const candidateTargets = signals.map(s => s.result.target).filter(t => t && t > last);
        const symTarget = sym ? sym.target : null;
        const target1 = last + atr * 1.5;
        const target2 = Math.max(...[...candidateTargets, symTarget, last + atr * 3].filter(Boolean));

        // 손절: 평단가 기준 -3% OR MA20 -1% (둘 중 보수적)
        const sjr = _danteSonjeolRules(closes, ma20, avgEntry);
        const sigStops = signals.map(s => s.result.stop).filter(t => t && t < last);
        const finalStop = Math.max(...[sjr.finalStop, ...sigStops]);

        let verdict, verdictSub;
        if (score10 >= 7)      { verdict = '강한 매수 시그널'; verdictSub = '다중 패턴 발동 — 적극 분할 진입 (5:3:2)'; }
        else if (score10 >= 5) { verdict = '관심 종목';        verdictSub = '균형 분할 (3:4:3) — 눌림목 대기'; }
        else if (score10 >= 3) { verdict = '관망 우위';         verdictSub = '눌림 비중 ↑ (2:3.5:4.5) — 강한 지지선 대기'; }
        else                   { verdict = '진입 비추천';      verdictSub = '시그널 약함 — 다른 종목 탐색 권장'; }

        return {
            score: score10, verdict, verdictSub,
            entry1, entry2, entry3, entry3Source, avgEntry, splitRatios,
            target1, target2, finalStop,
            atr, ma20, last,
        };
    }

    function renderDanteAnalysis() {
        const data = _danteCalc();
        const circleEl = document.getElementById('danteScoreCircle');
        const numEl = document.getElementById('danteScoreNum');
        const vEl = document.getElementById('danteVerdict');
        const vSubEl = document.getElementById('danteVerdictSub');
        const sigEl = document.getElementById('danteSignals');
        const stEl = document.getElementById('danteStrategy');
        if (!circleEl || !numEl) return;
        if (!data) {
            numEl.textContent = '-';
            if (vEl) vEl.textContent = '데이터 부족';
            if (vSubEl) vSubEl.textContent = '최소 30봉 이상 필요';
            if (sigEl) sigEl.innerHTML = '';
            if (stEl) stEl.innerHTML = '';
            return;
        }
        numEl.textContent = data.score;
        circleEl.style.setProperty('--dante-color',
            data.score >= 7 ? 'var(--green)' :
            data.score >= 5 ? 'var(--blue)' :
            data.score >= 3 ? 'var(--yellow)' : 'var(--red)');
        if (vEl) vEl.textContent = data.verdict;
        if (vSubEl) vSubEl.textContent = data.verdictSub;
        // 시그널 체크리스트 — 제거됨 (v536)
        if (sigEl) sigEl.innerHTML = '';
        if (stEl) {
            const fmt = v => v == null ? '-' : '$' + Number(v).toFixed(2);
            const pct = (a, b) => ((a - b) / b * 100).toFixed(1);
            const [w1, w2, w3] = data.splitRatios;
            const atrPct = (data.atr / data.last * 100).toFixed(1);
            stEl.innerHTML = `
                <div class="dante-buy-plan">
                    <div class="dante-plan-title">📥 분할 매수 계획 <span class="dante-plan-meta">변동성 ATR ${atrPct}% 반영</span></div>
                    <div class="dante-step-list">
                        <div class="dante-step">
                            <div class="dante-step-num">1차</div>
                            <div class="dante-step-body">
                                <div class="dante-step-price">${fmt(data.entry1)} <span class="dante-step-pct">현재가</span></div>
                                <div class="dante-step-note">즉시 진입 — 시그널 확정 비중</div>
                            </div>
                            <div class="dante-step-weight">${w1}%</div>
                        </div>
                        <div class="dante-step">
                            <div class="dante-step-num">2차</div>
                            <div class="dante-step-body">
                                <div class="dante-step-price">${fmt(data.entry2)} <span class="dante-step-pct">${pct(data.entry2, data.entry1)}%</span></div>
                                <div class="dante-step-note">단기 눌림 (−0.7 ATR) — 1차 평단 보정</div>
                            </div>
                            <div class="dante-step-weight">${w2}%</div>
                        </div>
                        <div class="dante-step">
                            <div class="dante-step-num">3차</div>
                            <div class="dante-step-body">
                                <div class="dante-step-price">${fmt(data.entry3)} <span class="dante-step-pct">${pct(data.entry3, data.entry1)}%</span></div>
                                <div class="dante-step-note">${data.entry3Source === '지지선' ? '강한 지지선 도달' : '깊은 눌림 (−1.5 ATR)'} — 만족 시에만 체결</div>
                            </div>
                            <div class="dante-step-weight">${w3}%</div>
                        </div>
                    </div>
                    <div class="dante-avg-row">
                        <span class="dante-avg-label">예상 평단가 (전부 체결 시)</span>
                        <span class="dante-avg-value">${fmt(data.avgEntry)} <span class="dante-step-pct">${pct(data.avgEntry, data.entry1)}%</span></span>
                    </div>
                </div>
                <div class="dante-strat-grid">
                    <div class="dante-strat-col">
                        <div class="dante-strat-title">목표가</div>
                        <div class="dante-strat-row"><span class="dante-strat-label">1차 (보수)</span><span class="dante-strat-value" style="color:var(--green)">${fmt(data.target1)} <span class="dante-strat-pct">(+${pct(data.target1, data.avgEntry)}%)</span></span></div>
                        <div class="dante-strat-row"><span class="dante-strat-label">2차 (적극)</span><span class="dante-strat-value" style="color:var(--green)">${fmt(data.target2)} <span class="dante-strat-pct">(+${pct(data.target2, data.avgEntry)}%)</span></span></div>
                    </div>
                    <div class="dante-strat-col">
                        <div class="dante-strat-title">손절가</div>
                        <div class="dante-strat-row"><span class="dante-strat-label">평단 기준</span><span class="dante-strat-value" style="color:var(--red)">${fmt(data.finalStop)} <span class="dante-strat-pct">(${pct(data.finalStop, data.avgEntry)}%)</span></span></div>
                        <div class="dante-strat-row"><span class="dante-strat-label">손익비</span><span class="dante-strat-value">${((data.target1 - data.avgEntry) / Math.max(0.01, data.avgEntry - data.finalStop)).toFixed(2)} : 1</span></div>
                    </div>
                </div>
            `;
        }
    }

    // ── 단테 백테스트 (Phase 4) ─────────────────────────────────────
    // 과거 N봉에서 각 시점의 OHLCV 슬라이스로 단테 분석 → 시그널 hit 시 진입 가정 →
    // K일 이내 목표가 도달(승) vs 손절가 도달(패) 집계
    async function runDanteBacktest() {
        const btn = document.getElementById('danteBtBtn');
        const resEl = document.getElementById('danteBtResult');
        if (!btn || !resEl) return;
        if (!stockData) { showToast('먼저 종목을 검색해주세요.'); return; }
        const q = stockData.indicators.quote[0];
        const opens = q.open || [], closes = q.close || [], highs = q.high || [], lows = q.low || [], volumes = q.volume || [];
        const N = closes.length;
        if (N < 90) { showToast('백테스트에 최소 90봉(약 4개월) 이상 필요합니다.'); return; }

        btn.disabled = true; btn.textContent = '🔄 백테스트 진행 중...';
        resEl.style.display = 'none';
        // UI block 방지 — setTimeout 으로 다음 tick
        await new Promise(r => setTimeout(r, 30));

        const HOLD_DAYS = 5;           // 진입 후 최대 보유 일수
        const lookback = Math.min(126, N - 30);  // 최근 6개월 (영업일 기준 ~126)
        const startIdx = Math.max(60, N - lookback);

        let entries = 0, wins = 0, losses = 0;
        let totalReturnPct = 0;
        const trades = [];
        let lastEntry = -10; // 동일 시그널 중복 진입 방지 (5일 쿨다운)

        for (let i = startIdx; i < N - HOLD_DAYS; i++) {
            if (i - lastEntry < HOLD_DAYS) continue;
            const slice = {
                open: opens.slice(0, i + 1),
                close: closes.slice(0, i + 1),
                high: highs.slice(0, i + 1),
                low: lows.slice(0, i + 1),
                volume: volumes.slice(0, i + 1),
            };
            // 임시 stockData 로 시뮬레이션 (mutating 안 함)
            const origStockData = stockData;
            stockData = { indicators: { quote: [slice] } };
            const analysis = _danteCalc();
            stockData = origStockData;
            if (!analysis || analysis.score < 5) continue;

            const entryPrice = closes[i];
            const target1 = analysis.target1;
            const stop = analysis.finalStop;
            if (!entryPrice || !target1 || !stop) continue;

            // K일 이내 결과
            let result = null, exitPrice = entryPrice, exitDay = HOLD_DAYS;
            for (let k = 1; k <= HOLD_DAYS; k++) {
                const hi = highs[i + k], lo = lows[i + k];
                if (hi == null || lo == null) continue;
                if (lo <= stop) { result = 'loss'; exitPrice = stop; exitDay = k; break; }
                if (hi >= target1) { result = 'win'; exitPrice = target1; exitDay = k; break; }
            }
            if (!result) {
                exitPrice = closes[i + HOLD_DAYS] || entryPrice;
                result = exitPrice >= entryPrice ? 'win' : 'loss';
            }
            const retPct = (exitPrice - entryPrice) / entryPrice * 100;
            entries++;
            if (result === 'win') wins++; else losses++;
            totalReturnPct += retPct;
            trades.push({ idx: i, score: analysis.score, ret: retPct, days: exitDay, result });
            lastEntry = i;
        }

        btn.disabled = false; btn.textContent = '📈 과거 6개월 백테스트 재실행';
        if (entries === 0) {
            resEl.style.display = 'block';
            resEl.innerHTML = '<div class="dante-bt-empty">최근 6개월 동안 단테 시그널(점수 5+) 발동 없음 — 다른 종목 시도</div>';
            return;
        }
        const winRate = (wins / entries * 100).toFixed(0);
        const avgRet = (totalReturnPct / entries).toFixed(2);
        const wAvg = trades.filter(t=>t.result==='win').reduce((s,t)=>s+t.ret,0) / Math.max(1, wins);
        const lAvg = trades.filter(t=>t.result==='loss').reduce((s,t)=>s+t.ret,0) / Math.max(1, losses);
        const rrR = losses > 0 ? Math.abs(wAvg / lAvg).toFixed(2) : '∞';
        const avgDays = (trades.reduce((s,t)=>s+t.days,0) / entries).toFixed(1);
        const cls = winRate >= 60 ? 'good' : winRate >= 40 ? 'mid' : 'bad';
        resEl.style.display = 'block';
        resEl.innerHTML = `
            <div class="dante-bt-grid">
                <div class="dante-bt-cell"><div class="dante-bt-label">진입</div><div class="dante-bt-value">${entries}회</div></div>
                <div class="dante-bt-cell"><div class="dante-bt-label">승률</div><div class="dante-bt-value ${cls}">${winRate}%</div></div>
                <div class="dante-bt-cell"><div class="dante-bt-label">평균 수익</div><div class="dante-bt-value ${avgRet>0?'good':'bad'}">${avgRet>0?'+':''}${avgRet}%</div></div>
                <div class="dante-bt-cell"><div class="dante-bt-label">손익비</div><div class="dante-bt-value">${rrR}</div></div>
            </div>
            <div class="dante-bt-detail">
                ✅ ${wins}승 (평균 +${wAvg.toFixed(2)}%) · ❌ ${losses}패 (평균 ${lAvg.toFixed(2)}%) · 평균 보유 ${avgDays}일
            </div>
        `;
    }

    // ========================================
    // Entry/Exit Timing (단타)
    // ========================================
    function renderEntryTiming() {
        renderDayUnified();
    }

    // ========================================
    // Mark Minervini SEPA 분석 (Specific Entry Point Analysis)
    // 1) Trend Template (8 conditions)
    // 2) VCP (Volatility Contraction Pattern)
    // 3) RS Score (vs S&P 500)
    // 4) Volume Confirmation
    // 5) Pivot Point & Entry Strategy
    // 6) Composite SEPA Score (0~100)
    // ========================================
    let _spxClosesCache = null;
    let _spxClosesCacheTs = 0;
    async function _getSPXCloses() {
        const now = Date.now();
        if (_spxClosesCache && now - _spxClosesCacheTs < 60 * 60_000) return _spxClosesCache;
        try {
            const r = await fetch('/api/chart/%5EGSPC?range=1y&interval=1d');
            if (!r.ok) return null;
            const d = await r.json();
            const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
            if (closes && closes.length) {
                _spxClosesCache = closes.filter(v => v != null);
                _spxClosesCacheTs = now;
                return _spxClosesCache;
            }
        } catch (e) {}
        return null;
    }

    function _minerviniTrendTemplate(closes) {
        if (!closes || closes.length < 200) return null;
        const last = closes[closes.length - 1];
        if (last == null) return null;
        const ma50  = calcSMA(closes, 50);
        const ma150 = calcSMA(closes, 150);
        const ma200 = calcSMA(closes, 200);
        const last50  = ma50[ma50.length - 1];
        const last150 = ma150[ma150.length - 1];
        const last200 = ma200[ma200.length - 1];
        const ma200_22ago = ma200[Math.max(0, ma200.length - 23)];
        const recent252 = closes.slice(-252).filter(v => v != null);
        const high52 = recent252.length ? Math.max(...recent252) : last;
        const low52  = recent252.length ? Math.min(...recent252) : last;
        const conditions = [
            { id: 1, label: '현재가 > 150일 MA',            pass: last50 != null && last150 != null && last > last150 },
            { id: 2, label: '현재가 > 200일 MA',            pass: last200 != null && last > last200 },
            { id: 3, label: '150 MA > 200 MA',              pass: last150 != null && last200 != null && last150 > last200 },
            { id: 4, label: '200 MA 1개월 우상향',          pass: last200 != null && ma200_22ago != null && last200 > ma200_22ago },
            { id: 5, label: '50 > 150 > 200 MA 정배열',     pass: last50 != null && last150 != null && last200 != null && last50 > last150 && last150 > last200 },
            { id: 6, label: '현재가 > 50일 MA',             pass: last50 != null && last > last50 },
            { id: 7, label: '52주 저점 대비 +25% 이상',     pass: low52 > 0 && (last - low52) / low52 >= 0.25 },
            { id: 8, label: '52주 고점 대비 -25% 이내',     pass: high52 > 0 && (high52 - last) / high52 <= 0.25 },
        ];
        const passed = conditions.filter(c => c.pass).length;
        return { conditions, passed, total: 8, high52, low52 };
    }

    function _detectVCP(highs, lows, volumes, closes) {
        if (!highs || highs.length < 60) return { found: false, contractions: [] };
        const N = highs.length;
        const segLen = 12; // ~12일 = 2.5주, 60일 안에 5개 세그먼트
        const contractions = [];
        for (let start = N - 60; start <= N - segLen; start += segLen) {
            const sH = highs.slice(start, start + segLen).filter(v => v != null);
            const sL = lows.slice(start, start + segLen).filter(v => v != null);
            const sV = (volumes || []).slice(start, start + segLen).filter(v => v != null);
            if (sH.length < 5 || sL.length < 5) continue;
            const high = Math.max(...sH);
            const low  = Math.min(...sL);
            const range = low > 0 ? (high - low) / low * 100 : 0;
            const avgVol = sV.length ? sV.reduce((s, v) => s + v, 0) / sV.length : 0;
            contractions.push({ start, high, low, range, avgVol });
        }
        if (contractions.length < 2) return { found: false, contractions };
        // 변동폭 점진 축소 여부 — 각 단계가 직전 90% 이하
        let isContracting = true;
        let volContracting = true;
        for (let i = 1; i < contractions.length; i++) {
            if (contractions[i].range >= contractions[i-1].range * 0.9) isContracting = false;
            if (contractions[i].avgVol >= contractions[i-1].avgVol * 1.05) volContracting = false;
        }
        const first = contractions[0];
        const last  = contractions[contractions.length - 1];
        const finalToFirstRatio = first.range > 0 ? last.range / first.range : 1;
        const idealPivot = finalToFirstRatio < 0.5;
        const pivot = last.high * 1.003;
        const baseLow = Math.min(...contractions.map(c => c.low));
        return {
            found: isContracting,
            contractionCount: contractions.length,
            contractions,
            pivot,
            baseLow,
            volConfirmed: volContracting,
            idealPivot,
            finalRangePct: last.range,
        };
    }

    function _calcRSScore(stockCloses, spxCloses) {
        if (!stockCloses || !spxCloses) return null;
        const s = stockCloses.filter(v => v != null);
        const x = spxCloses.filter(v => v != null);
        if (s.length < 130 || x.length < 130) return null;
        const sLast = s[s.length - 1], xLast = x[x.length - 1];
        const s63   = s[s.length - 64], x63   = x[x.length - 64];
        const s126  = s[s.length - 127], x126 = x[x.length - 127];
        if (!s63 || !x63 || !s126 || !x126) return null;
        const ret63s   = (sLast / s63 - 1) * 100;
        const ret63x   = (xLast / x63 - 1) * 100;
        const ret126s  = (sLast / s126 - 1) * 100;
        const ret126x  = (xLast / x126 - 1) * 100;
        const excess63  = ret63s - ret63x;
        const excess126 = ret126s - ret126x;
        const composite = excess63 * 0.4 + excess126 * 0.6;
        // 매핑: -50%→0, 0%→50, +50%→100 (clamp)
        const rs = Math.max(0, Math.min(100, Math.round(50 + composite * 1.0)));
        return { rs, excess63, excess126, ret63s, ret126s, ret63x, ret126x };
    }

    function _analyzeMinerviniVolume(volumes, closes) {
        if (!volumes || volumes.length < 50) return null;
        const N = volumes.length;
        const recentVols = volumes.slice(-5).filter(v => v != null);
        const baseVols   = volumes.slice(-50, -5).filter(v => v != null);
        if (!recentVols.length || !baseVols.length) return null;
        const recent5Avg = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
        const avg50      = baseVols.reduce((s, v) => s + v, 0) / baseVols.length;
        const volRatio = avg50 > 0 ? recent5Avg / avg50 : 0;
        const todayVol = volumes[N - 1] || 0;
        const todayChange = (closes[N-1] != null && closes[N-2] != null) ? (closes[N-1] / closes[N-2] - 1) : 0;
        const breakoutVolume = avg50 > 0 && todayVol > avg50 * 1.4 && todayChange > 0;
        return {
            recent5Avg, avg50, volRatio, todayVolMult: avg50 > 0 ? todayVol / avg50 : 0,
            breakoutVolume,
            baseFormingLowVol: volRatio < 1.0,
        };
    }

    function _minerviniSEPAScore(trend, vcp, rsObj, vol, lastClose) {
        let score = 0;
        if (trend) score += (trend.passed / 8) * 30;
        if (vcp.found) score += vcp.idealPivot ? 25 : 15;
        if (rsObj) {
            if (rsObj.rs >= 90) score += 20;
            else if (rsObj.rs >= 70) score += 15;
            else if (rsObj.rs >= 50) score += 8;
        }
        if (vol) {
            if (vol.breakoutVolume) score += 15;
            else if (vol.baseFormingLowVol) score += 8;
        }
        if (vcp.found && vcp.pivot > 0 && lastClose > 0) {
            const distPct = (vcp.pivot - lastClose) / lastClose * 100;
            if (distPct <= 0) score += 10;
            else if (distPct <= 3) score += 8;
            else if (distPct <= 7) score += 5;
        }
        return Math.round(score);
    }

    // SEPA 전용 일봉 캐시 (인트라데이 차트와 무관하게 항상 일봉 분석)
    let _sepaDailyCache = {};   // { symbol: { ts, closes, highs, lows, volume } }
    const _SEPA_DAILY_TTL = 30 * 60_000; // 30분
    async function _fetchSEPADaily(symbol) {
        if (!symbol) return null;
        const cached = _sepaDailyCache[symbol];
        if (cached && Date.now() - cached.ts < _SEPA_DAILY_TTL) return cached;
        try {
            const r = await fetch(`/api/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`);
            if (!r.ok) return null;
            const d = await r.json();
            const result = d?.chart?.result?.[0];
            if (!result) return null;
            const q = result.indicators?.quote?.[0];
            if (!q?.close) return null;
            _sepaDailyCache[symbol] = {
                ts: Date.now(),
                closes: q.close, highs: q.high, lows: q.low, volume: q.volume,
            };
            return _sepaDailyCache[symbol];
        } catch (e) { return null; }
    }

    // ── Minervini SEPA 분석 카드 렌더링 (분석 탭 #sepaAnalysis 전용) ──────
    async function _renderSEPACard() {
        const el = document.getElementById('sepaAnalysis');
        if (!el) return;
        if (!currentFullSymbol) { el.innerHTML = ''; return; }

        // 로딩 표시
        el.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:14px 16px;margin:0;font-size:13px;color:var(--text2);">🎯 Minervini SEPA — 일봉 데이터 로드 중...</div>`;

        const symbol = currentFullSymbol;
        const data = await _fetchSEPADaily(symbol);
        // 종목이 바뀐 경우 무효화
        if (currentFullSymbol !== symbol) return;
        if (!data) {
            el.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:14px 16px;margin:0;font-size:13px;color:var(--text2);">🎯 Minervini SEPA — 일봉 데이터를 불러올 수 없습니다</div>`;
            return;
        }
        const validCloses = (data.closes || []).filter(v => v != null);
        if (validCloses.length < 200) {
            el.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:14px 16px;margin:0;font-size:13px;color:var(--text2);">🎯 Minervini SEPA — 200일 이상 일봉 데이터 필요 (현재 ${validCloses.length}일) · 상장 1년 미만 종목</div>`;
            return;
        }

        const baseArgs = {
            trend: _minerviniTrendTemplate(validCloses),
            vcp: _detectVCP(data.highs, data.lows, data.volume, validCloses),
            vol: _analyzeMinerviniVolume(data.volume, data.closes),
            lastClose: validCloses[validCloses.length - 1],
        };

        // 1차 렌더 (RS 제외) + 비동기 RS 후속 갱신
        el.innerHTML = _buildSEPAHtml({ ...baseArgs, rs: null });
        _getSPXCloses().then(spx => {
            if (!spx || currentFullSymbol !== symbol) return;
            const rs = _calcRSScore(validCloses, spx);
            const elNow = document.getElementById('sepaAnalysis');
            if (elNow) elNow.innerHTML = _buildSEPAHtml({ ...baseArgs, rs });
        });
    }

    // ── Minervini SEPA 차트 오버레이 (드롭다운 토글 전용) ─────────────────
    // _detectMinerviniSetup 결과를 SigBar 배지 + 차트 가격 라인으로 표시
    // 일봉 200개 이상 필요 — 5분봉 등 단봉에서는 데이터 부족으로 자동 스킵
    function renderMinerviniSEPA() {
        if (!_chartSepaEnabled) return;
        const cd = _lastSigArgs?.candleData;
        if (!cd || cd.length < 200) return;

        _clearMinerviniChartLines();

        let setup = null;
        try { setup = _detectMinerviniSetup(cd); } catch(e) { warn('[mv setup]', e.message); }
        if (!setup) return;

        // ── SigBar 배지 ─────────────────────────────────────────────
        const bar = document.getElementById('chartSigBar');
        if (bar) {
            bar.querySelectorAll('.minervini-badge').forEach(el => el.remove());
            const stageColor = setup.stage2 ? '#FFD700' : '#6B7280';
            bar.insertAdjacentHTML('beforeend',
                `<span class="chart-sig-pill minervini-badge" style="background:rgba(255,215,0,0.12);color:${stageColor};border-color:rgba(255,215,0,0.4);font-weight:700">` +
                `🏆 Stage 2: ${setup.stage2 ? '✅' : '❌'} · VCP: ${setup.vcp ? '✅' : '❌'} · RS: ${setup.rsScore}점 · Trend: ${setup.trendTemplateScore}/8</span>`);
            if (setup.signal) {
                const sl  = typeof setup.stopLoss === 'number' ? setup.stopLoss.toFixed(2)  : setup.stopLoss;
                const tp1 = typeof setup.tp1Price === 'number' ? setup.tp1Price.toFixed(2)  : setup.tp1Price;
                bar.insertAdjacentHTML('beforeend',
                    `<span class="chart-sig-pill minervini-badge" style="background:rgba(34,197,94,0.12);color:#22C55E;border-color:rgba(34,197,94,0.4);font-weight:700">` +
                    `✅ SEPA 진입 신호 · 거래량 ${setup.volRatio}배 · 손절 $${sl} · 익절1 $${tp1}</span>`);
            }
        }

        // ── 차트 가격 라인 ───────────────────────────────────────────
        if (setup.pivot) {
            const pvLabel = typeof setup.pivot === 'number' ? setup.pivot.toFixed(2) : setup.pivot;
            _mvAddLine(setup.pivot, '#FFD700', 1, 2, `🏆 Pivot $${pvLabel}`);
        }
        if (setup.signal) {
            _mvAddLine(setup.stopLoss, '#EF4444', 1, 2, '🔴 손절 -7.5%');
            _mvAddLine(setup.tp1Price, '#22C55E', 1, 2, '✅ 익절1 +10%');
            _mvAddLine(setup.tp2Price, '#86EFAC', 1, 2, '💰 익절2 +25%');
        }
    }

    function _buildSEPAHtml({ trend, vcp, vol, rs, lastClose }) {
        const isKR = currentMarket === 'KR';
        const fmtP = p => p == null ? '-' : (isKR ? Math.round(p).toLocaleString() + '원' : '$' + p.toFixed(2));
        const score = _minerviniSEPAScore(trend, vcp, rs, vol, lastClose);

        // ─── 종합 점수 등급 ───
        let scoreBadge = '🔴 SEPA 미충족 — 관망';
        let scoreBadgeColor = '#ef4444';
        let scoreShort = '미충족';
        if (score >= 85)      { scoreBadge = '🟢 SEPA 최적 — 진입 검토'; scoreBadgeColor = '#22c55e'; scoreShort = '최적'; }
        else if (score >= 70) { scoreBadge = '🟡 SEPA 양호 — 피벗 대기'; scoreBadgeColor = '#eab308'; scoreShort = '양호'; }

        // ─── ① 트렌드 템플릿 ───
        let trendBadge = '⬜ 데이터 부족';
        let trendBadgeColor = '#94a3b8';
        if (trend) {
            if (trend.passed === 8)      { trendBadge = '완벽한 Stage 2 — 진입 검토';    trendBadgeColor = '#22c55e'; }
            else if (trend.passed >= 6)  { trendBadge = 'Stage 2 진입 중 — 주의 관찰';   trendBadgeColor = '#eab308'; }
            else                          { trendBadge = 'Stage 2 미충족 — 관망';        trendBadgeColor = '#ef4444'; }
        }
        const conditionPillHtml = trend ? trend.conditions.map(c => {
            const bg = c.pass ? 'rgba(34,197,94,.12)' : 'rgba(148,163,184,.08)';
            const border = c.pass ? 'rgba(34,197,94,.4)' : 'var(--border)';
            const color = c.pass ? '#22c55e' : 'var(--text2)';
            const icon = c.pass ? '✓' : '✗';
            return `<div style="display:flex;align-items:center;gap:7px;padding:7px 9px;background:${bg};border:1px solid ${border};border-radius:8px;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:${color}26;color:${color};font-size:11px;font-weight:900;flex-shrink:0;">${icon}</span>
                <span style="font-size:11.5px;font-weight:${c.pass?'700':'500'};color:${c.pass?'var(--text)':'var(--text2)'};line-height:1.3;">${c.label}</span>
            </div>`;
        }).join('') : '<div style="font-size:12px;color:var(--text2);grid-column:1/-1;">데이터 부족</div>';

        // ─── ② VCP 패턴 ───
        let vcpBadge = 'VCP 미형성';
        let vcpBadgeColor = '#94a3b8';
        let vcpDetail = '수축 패턴 없음 — 베이스 형성 대기';
        if (vcp.found) {
            const distPct = lastClose > 0 ? (vcp.pivot - lastClose) / lastClose * 100 : 100;
            if (distPct <= 1) { vcpBadge = '피벗 근접 — 진입 준비'; vcpBadgeColor = '#22c55e'; }
            else              { vcpBadge = `VCP ${vcp.contractionCount}차 수축 — 피벗 대기`; vcpBadgeColor = '#eab308'; }
            vcpDetail = `최종 변동폭 ${vcp.finalRangePct.toFixed(1)}% · 베이스 저점 ${fmtP(vcp.baseLow)} · 피벗 ${fmtP(vcp.pivot)}`;
        }

        // ─── ③ RS ───
        let rsBadge = 'RS 계산 중...';
        let rsBadgeColor = '#94a3b8';
        let rsValue = '⏳';
        let rsDetail = 'S&P 500 대비 상대강도 측정 중';
        if (rs) {
            rsValue = String(rs.rs);
            if (rs.rs >= 90)      { rsBadge = '최상위 (Minervini 선호)'; rsBadgeColor = '#22c55e'; }
            else if (rs.rs >= 70) { rsBadge = '양호';                     rsBadgeColor = '#eab308'; }
            else                  { rsBadge = '부족 (70+ 권장)';          rsBadgeColor = '#ef4444'; }
            rsDetail = `3개월 초과수익 ${rs.excess63 >= 0 ? '+' : ''}${rs.excess63.toFixed(1)}% · 6개월 ${rs.excess126 >= 0 ? '+' : ''}${rs.excess126.toFixed(1)}%`;
        }

        // ─── ④ 거래량 ───
        let volBadge = '데이터 부족';
        let volBadgeColor = '#94a3b8';
        let volDetail = '';
        if (vol) {
            if (vol.breakoutVolume) { volBadge = '돌파 거래량 확인 (+40% 이상)'; volBadgeColor = '#22c55e'; }
            else if (vol.baseFormingLowVol) { volBadge = '베이스 거래량 감소 (정상)'; volBadgeColor = '#eab308'; }
            else { volBadge = '거래량 미흡 — 돌파 시 주의'; volBadgeColor = '#ef4444'; }
            volDetail = `최근 5일/50일 평균 = ${vol.volRatio.toFixed(2)}x · 오늘 ${vol.todayVolMult.toFixed(2)}x`;
        }

        // ─── 피벗·매매 라인 ───
        let entryLinesHtml = '';
        if (vcp.found && vcp.pivot > 0) {
            const pivot = vcp.pivot;
            const stopP = Math.min(pivot * 0.90, vcp.baseLow * 0.99);
            const tp1 = pivot * 1.20;
            const tp2 = pivot * 1.50;
            const chaseLimit = pivot * 1.05;
            const beyondChase = lastClose > chaseLimit;
            const isMobile = window.innerWidth <= 640;
            const cols = isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)';
            entryLinesHtml = `
                <div style="display:grid;grid-template-columns:${cols};gap:8px;background:var(--bg3);padding:12px;border-radius:10px;margin-top:6px;">
                    <div style="text-align:center;"><div style="font-size:10.5px;color:var(--text2);font-weight:700;">피벗 진입</div><div style="font-size:14px;font-weight:800;color:#f97316;margin-top:3px;font-variant-numeric:tabular-nums;">${fmtP(pivot)}</div></div>
                    <div style="text-align:center;"><div style="font-size:10.5px;color:var(--text2);font-weight:700;">손절 (-10%)</div><div style="font-size:14px;font-weight:800;color:#ef4444;margin-top:3px;font-variant-numeric:tabular-nums;">${fmtP(stopP)}</div></div>
                    <div style="text-align:center;"><div style="font-size:10.5px;color:var(--text2);font-weight:700;">익절1 (+20%)</div><div style="font-size:14px;font-weight:800;color:#eab308;margin-top:3px;font-variant-numeric:tabular-nums;">${fmtP(tp1)}</div></div>
                    <div style="text-align:center;"><div style="font-size:10.5px;color:var(--text2);font-weight:700;">익절2 (+50%)</div><div style="font-size:14px;font-weight:800;color:#22c55e;margin-top:3px;font-variant-numeric:tabular-nums;">${fmtP(tp2)}</div></div>
                </div>
                <div style="margin-top:8px;font-size:11.5px;color:${beyondChase ? '#ef4444' : 'var(--text2)'};text-align:center;">
                    추격 한계선 +5% = <strong style="color:${beyondChase ? '#ef4444' : 'var(--text)'}">${fmtP(chaseLimit)}</strong> ${beyondChase ? '— ❌ 추격 금지 구간' : ''}
                </div>`;
        }

        // ─── 섹션 블록 헬퍼 ───
        const blockSt = (color) => `border-left:3px solid ${color};padding:10px 0 10px 12px;margin-top:14px;`;
        const blockLabelSt = `font-size:10.5px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;display:flex;align-items:center;gap:8px;`;
        const blockVerdictSt = (c) => `font-size:13px;font-weight:800;color:${c};letter-spacing:-.2px;`;
        const blockDetailSt = `font-size:11.5px;color:var(--text2);margin-top:3px;line-height:1.4;`;

        // ─── SEPA 점수 등급 기준표 ───
        const scoreRefRows = [
            { range: '85~100점', label: 'SEPA 최적',   color: '#22c55e', strat: '진입 검토 — 4박자 충족' },
            { range: '70~84점',  label: 'SEPA 양호',   color: '#eab308', strat: '피벗 돌파·거래량 확인 시 진입' },
            { range: '0~69점',   label: 'SEPA 미충족', color: '#ef4444', strat: '관망 — 베이스 형성 대기' },
        ];
        const scoreRefHtml = scoreRefRows.map(r => {
            const isCurrent = (r.range.startsWith('85') && score >= 85)
                            || (r.range.startsWith('70') && score >= 70 && score < 85)
                            || (r.range.startsWith('0') && score < 70);
            const bg = isCurrent ? `${r.color}14` : 'transparent';
            const border = isCurrent ? `${r.color}55` : 'var(--border)';
            return `<div style="display:grid;grid-template-columns:auto auto 1fr;gap:10px;padding:8px 10px;background:${bg};border:1px solid ${border};border-radius:8px;align-items:center;">
                <span style="font-size:11px;font-weight:800;color:var(--text);min-width:62px;">${r.range}</span>
                <span style="font-size:11.5px;font-weight:800;color:${r.color};min-width:80px;">${r.label}</span>
                <span style="font-size:11px;color:var(--text2);">${r.strat}</span>
            </div>`;
        }).join('');

        // ─── 가중치 표 ───
        const weightRows = [
            { name: '트렌드 템플릿 (8조건)', weight: '30%', color: '#22c55e' },
            { name: 'VCP 패턴',              weight: '25%', color: '#a78bfa' },
            { name: '상대강도 RS',           weight: '20%', color: '#eab308' },
            { name: '거래량',                weight: '15%', color: '#3b82f6' },
            { name: '피벗 근접도',           weight: '10%', color: '#f97316' },
        ];
        const weightHtml = weightRows.map(w => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                <span style="width:8px;height:8px;border-radius:50%;background:${w.color};flex-shrink:0;"></span>
                <span style="font-size:11.5px;font-weight:600;color:var(--text);flex:1;">${w.name}</span>
                <span style="font-size:11.5px;font-weight:800;color:var(--text);">${w.weight}</span>
            </div>
        `).join('');

        return `
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:16px 18px;margin:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <div style="font-size:16px;font-weight:800;letter-spacing:-.3px;">🎯 Minervini SEPA 분석</div>
                </div>

                <!-- 큰 점수 배너 -->
                <div style="display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;background:linear-gradient(135deg, ${scoreBadgeColor}1f 0%, ${scoreBadgeColor}0a 100%);border:1px solid ${scoreBadgeColor}55;border-radius:10px;padding:16px 18px;">
                    <div style="text-align:center;min-width:84px;">
                        <div style="font-size:9.5px;font-weight:800;color:${scoreBadgeColor};text-transform:uppercase;letter-spacing:.6px;opacity:.85;">SEPA SCORE</div>
                        <div style="font-size:38px;font-weight:900;line-height:1;color:${scoreBadgeColor};letter-spacing:-1.2px;font-variant-numeric:tabular-nums;">${score}</div>
                        <div style="font-size:9.5px;color:${scoreBadgeColor};font-weight:700;margin-top:2px;opacity:.85;">/ 100</div>
                    </div>
                    <div>
                        <div style="font-size:15px;font-weight:800;color:${scoreBadgeColor};letter-spacing:-.2px;">${scoreShort}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:3px;line-height:1.45;">${scoreBadge.replace(/^🟢 |^🟡 |^🔴 /, '')}</div>
                    </div>
                </div>

                <!-- ① 트렌드 템플릿 -->
                <div style="${blockSt(trendBadgeColor)}">
                    <div style="${blockLabelSt}">
                        <span>① 트렌드 템플릿</span>
                        <span style="font-size:11px;font-weight:900;padding:2px 8px;border-radius:6px;background:${trendBadgeColor}26;color:${trendBadgeColor};">${trend ? trend.passed : 0}/8</span>
                    </div>
                    <div style="${blockVerdictSt(trendBadgeColor)}">${trendBadge}</div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:8px;">${conditionPillHtml}</div>
                </div>

                <!-- ② VCP 패턴 -->
                <div style="${blockSt(vcpBadgeColor)}">
                    <div style="${blockLabelSt}"><span>② VCP 패턴</span></div>
                    <div style="${blockVerdictSt(vcpBadgeColor)}">${vcpBadge}</div>
                    <div style="${blockDetailSt}">${vcpDetail}</div>
                </div>

                <!-- ③ RS — 큰 숫자 강조 -->
                <div style="${blockSt(rsBadgeColor)}">
                    <div style="${blockLabelSt}"><span>③ 상대강도 (RS) vs S&amp;P 500</span></div>
                    <div style="display:flex;align-items:baseline;gap:10px;margin-top:2px;flex-wrap:wrap;">
                        <span style="font-size:26px;font-weight:900;color:${rsBadgeColor};line-height:1;font-variant-numeric:tabular-nums;">${rsValue}</span>
                        <span style="${blockVerdictSt(rsBadgeColor)}">${rsBadge}</span>
                    </div>
                    <div style="${blockDetailSt}">${rsDetail}</div>
                </div>

                <!-- ④ 거래량 -->
                <div style="${blockSt(volBadgeColor)}">
                    <div style="${blockLabelSt}"><span>④ 거래량</span></div>
                    <div style="${blockVerdictSt(volBadgeColor)}">${volBadge}</div>
                    <div style="${blockDetailSt}">${volDetail}</div>
                </div>

                <!-- ⑤ 피벗 진입 라인 -->
                ${vcp.found ? `<div style="margin-top:16px;">
                    <div style="${blockLabelSt}"><span>⑤ 피벗 진입 라인</span></div>
                    ${entryLinesHtml}
                </div>` : ''}

                <!-- 점수 가중치 안내 -->
                <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);">
                    <div style="font-size:10.5px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">⚖️ SEPA 점수 가중치</div>
                    <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;">${weightHtml}</div>
                </div>

                <!-- SEPA 등급 기준 안내 -->
                <div style="margin-top:14px;">
                    <div style="font-size:10.5px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">📚 SEPA 등급 기준</div>
                    <div style="display:flex;flex-direction:column;gap:6px;">${scoreRefHtml}</div>
                </div>

                <!-- Minervini 원칙 -->
                <div style="margin-top:14px;padding:10px 12px;background:var(--bg3);border-radius:8px;font-size:11.5px;color:var(--text2);line-height:1.55;">
                    💡 <strong style="color:var(--text);">Minervini SEPA 원칙</strong><br>
                    · Stage 2 + VCP + RS 70+ + 거래량 4박자 동시 충족 시에만 매매<br>
                    · 진입은 피벗 돌파 + 거래량 +40% 이상 확인 후<br>
                    · 추격 한계선 +5% 초과 시 진입 금지
                </div>
            </div>
        `;
    }

    // ========================================
    // 스윙 분석 카드 — 7개 카테고리 알고리즘 점수 + AI 종합평 (v686)
    // ========================================
    const _swingFundCache = {};   // symbol → {ts, fin}
    const _SWING_FUND_TTL = 30 * 60 * 1000;

    async function _fetchSwingFundamentals(symbol) {
        if (!symbol) return null;
        const c = _swingFundCache[symbol];
        if (c && Date.now() - c.ts < _SWING_FUND_TTL) return c.fin;
        try {
            const res = await fetch(`${API_BASE}/api/page/${symbol}`, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) return null;
            const html = await res.text();
            const m = html.match(/"QuoteSummaryStore":\s*(\{[\s\S]*?\})\s*,\s*"/);
            if (!m) return null;
            const store = JSON.parse(m[1]);
            const sd = store.summaryDetail || {}, fd = store.financialData || {}, ks = store.defaultKeyStatistics || {};
            const fin = {
                per: sd.trailingPE?.raw ?? null,
                forwardPE: sd.forwardPE?.raw ?? ks.forwardPE?.raw ?? null,
                pbr: sd.priceToBook?.raw ?? ks.priceToBook?.raw ?? null,
                eps: ks.trailingEps?.raw ?? null,
                revenueGrowth: fd.revenueGrowth?.raw ?? null,
                earningsGrowth: fd.earningsGrowth?.raw ?? null,
                profitMargin: fd.profitMargins?.raw ?? null,
            };
            _swingFundCache[symbol] = { ts: Date.now(), fin };
            return fin;
        } catch (e) { return null; }
    }

    // ── 7개 카테고리 알고리즘 점수 ──
    function _swingScoreTechnical(d) {
        const { closes, ma5, ma20, ma60, rsi, histogram } = d;
        if (!closes || closes.length < 30) return { score: 50, reason: '데이터 부족 — 중립' };
        let score = 50;
        const reasons = [];
        const ema200 = calcEMA(closes, 200), ema50 = calcEMA(closes, 50);
        const stage = _detectMarketStage(closes, ema200, ema50);
        if (stage) {
            if (stage.stage === 2) { score += 22; reasons.push('상승추세(Stage 2)'); }
            else if (stage.stage === 3) { score -= 8; reasons.push('분배 구간'); }
            else if (stage.stage === 4) { score -= 24; reasons.push('하락추세(Stage 4)'); }
            else reasons.push('횡보');
        }
        const m5 = ma5?.filter(v=>v!=null).pop(), m20 = ma20?.filter(v=>v!=null).pop(), m60 = ma60?.filter(v=>v!=null).pop();
        if (m5 && m20 && m60) {
            if (m5 > m20 && m20 > m60) { score += 14; reasons.push('정배열'); }
            else if (m5 < m20 && m20 < m60) { score -= 14; reasons.push('역배열'); }
        }
        const hLast = histogram?.filter(v=>v!=null).pop();
        if (hLast != null) {
            if (hLast > 0) { score += 8; reasons.push('MACD 양전환'); }
            else { score -= 8; reasons.push('MACD 음'); }
        }
        const rLast = rsi?.filter(v=>v!=null).pop();
        if (rLast != null) {
            if (rLast >= 40 && rLast <= 65) { score += 8; reasons.push(`RSI ${rLast.toFixed(0)} 적정`); }
            else if (rLast > 75) { score -= 10; reasons.push(`RSI ${rLast.toFixed(0)} 과열`); }
            else if (rLast < 30) { score -= 6; reasons.push(`RSI ${rLast.toFixed(0)} 과매도`); }
        }
        score = Math.max(0, Math.min(100, score));
        return { score: Math.round(score), reason: reasons.slice(0,3).join(' · ') || '중립' };
    }

    function _swingScoreVolatility(d) {
        const { highs, lows, closes, price, bb } = d;
        if (!closes || closes.length < 20) return { score: 50, reason: '데이터 부족 — 중립' };
        const atrArr = calcATR(d.quotes.high, d.quotes.low, d.quotes.close);
        const atr = atrArr.filter(v=>v!=null).pop();
        if (!atr || !price) return { score: 50, reason: '변동성 측정 불가' };
        const atrPct = atr / price * 100;
        let score, reason;
        // 스윙 적정 ATR 2~5%
        if (atrPct >= 2 && atrPct <= 5) { score = 85; reason = `ATR ${atrPct.toFixed(1)}% — 스윙 적정 변동성`; }
        else if (atrPct < 2) { score = 45 + atrPct * 15; reason = `ATR ${atrPct.toFixed(1)}% — 변동성 부족(움직임 둔함)`; }
        else { score = Math.max(20, 85 - (atrPct - 5) * 9); reason = `ATR ${atrPct.toFixed(1)}% — 변동성 과대(리스크↑)`; }
        // 볼린저 폭 보정
        if (bb && bb.upper && bb.lower && bb.middle) {
            const u = bb.upper.filter(v=>v!=null).pop(), l = bb.lower.filter(v=>v!=null).pop(), mid = bb.middle.filter(v=>v!=null).pop();
            if (u && l && mid) {
                const bw = (u - l) / mid * 100;
                if (bw < 8) { score -= 6; reason += ' · 밴드 수축(스퀴즈)'; }
            }
        }
        score = Math.max(0, Math.min(100, score));
        return { score: Math.round(score), reason };
    }

    function _swingScoreRisk(d) {
        const { closes, volumes, price } = d;
        if (!closes || closes.length < 30 || !price) return { score: 50, reason: '데이터 부족 — 중립' };
        if (_isFallingKnife()) return { score: 18, reason: '낙폭과대(falling knife) — 진입 금지 구간' };
        const atrArr = calcATR(d.quotes.high, d.quotes.low, d.quotes.close);
        const atr = atrArr.filter(v=>v!=null).pop();
        if (!atr) return { score: 50, reason: 'ATR 측정 불가' };
        const stop = price - 1.5 * atr;
        let target = price * 1.10;
        try {
            const prof = calcVolumeProfile(closes, volumes, Math.min(120, closes.length));
            const res = findResistanceLevels(prof, price);
            if (res && res.length) target = res[0];
        } catch (e) {}
        const risk = price - stop, reward = target - price;
        if (risk <= 0) return { score: 50, reason: '손절폭 산출 불가' };
        const rr = reward / risk;
        let score, reason;
        if (rr >= 2.5) { score = 90; reason = `R/R ${rr.toFixed(1)} — 손익비 우수`; }
        else if (rr >= 2) { score = 78; reason = `R/R ${rr.toFixed(1)} — 손익비 양호`; }
        else if (rr >= 1.5) { score = 62; reason = `R/R ${rr.toFixed(1)} — 손익비 보통`; }
        else if (rr >= 1) { score = 42; reason = `R/R ${rr.toFixed(1)} — 손익비 부족`; }
        else { score = 25; reason = `R/R ${rr.toFixed(1)} — 손익비 열위(저항 근접)`; }
        return { score, reason };
    }

    // ── 1차/2차 분할 진입 플랜 (v687) ──
    function _swingEntryPlan(d) {
        const { closes, highs, lows, volumes, price, ma20, ma60 } = d;
        if (!closes || closes.length < 30 || !price) {
            return { recommend: false, note: '데이터 부족 — 진입가 산출 불가' };
        }
        // 추세 판정 — 진입 금지 케이스
        if (_isFallingKnife()) {
            return { recommend: false, note: '낙폭과대(falling knife) — 추세 반전 확인 후 재검토' };
        }
        try {
            const ema200 = calcEMA(closes, 200), ema50 = calcEMA(closes, 50);
            const stage = _detectMarketStage(closes, ema200, ema50);
            if (stage && stage.stage === 4) {
                return { recommend: false, note: '하락추세(Stage 4) — 진입 비권장, 추세 전환 대기' };
            }
        } catch (e) {}

        const atrArr = calcATR(d.quotes.high, d.quotes.low, d.quotes.close);
        const atr = atrArr.filter(v => v != null).pop() || price * 0.02;
        const m20 = (ma20 || []).filter(v => v != null).pop() || null;
        const m60 = (ma60 || []).filter(v => v != null).pop() || null;
        const validLows = (lows || []).slice(-20).filter(v => v != null && v > 0);
        const swingLow20 = validLows.length ? Math.min(...validLows) : null;

        // ── 1차 진입가 — 눌림목(지지) 기반 ──
        const supportCands = [];
        if (m20 != null && m20 <= price * 1.005) supportCands.push({ p: m20, label: 'MA20 눌림목' });
        if (swingLow20 != null && swingLow20 <= price * 1.005) supportCands.push({ p: swingLow20, label: '최근 저점 지지' });
        let entry1, basis1;
        if (supportCands.length) {
            // 현재가에 가장 가까운(=가장 높은) 지지 후보
            supportCands.sort((a, b) => b.p - a.p);
            const top = supportCands[0];
            if (price <= top.p * 1.01) { entry1 = price; basis1 = '현재가 — 지지선 근접'; }
            else { entry1 = top.p; basis1 = top.label; }
        } else {
            entry1 = price * 0.985; basis1 = '단기 풀백(-1.5%)';
        }

        // ── 2차 진입가 — 더 깊은 추가매수 자리 ──
        const atrBased = entry1 - atr;
        let entry2, basis2;
        if (m60 != null && m60 < entry1 * 0.985 && m60 < atrBased * 1.02) {
            entry2 = m60; basis2 = 'MA60 추가매수';
        } else {
            entry2 = atrBased; basis2 = 'ATR 1배 하단';
        }
        // 1차보다 충분히 낮게 클램프
        if (entry2 > entry1 * 0.97) { entry2 = entry1 * 0.97; basis2 = '1차 -3% 추가매수'; }

        // ── 손절 · 목표 · R/R ──
        let stop = entry2 - atr;
        const stopFloor = entry1 * 0.88; // 1차 대비 -12% 클램프
        if (stop < stopFloor) stop = stopFloor;
        let target = price * 1.12;
        try {
            const prof = calcVolumeProfile(closes, volumes, Math.min(120, closes.length));
            const res = findResistanceLevels(prof, price);
            if (res && res.length && res[0] > entry1) target = res[0];
        } catch (e) {}
        const risk = entry1 - stop;
        const rr = risk > 0 ? (target - entry1) / risk : 0;

        return { recommend: true, entry1, entry2, stop, target, rr, basis1, basis2 };
    }

    function _buildSwingEntryHtml(plan) {
        const isKR = currentMarket === 'KR';
        const fmtP = p => p == null ? '-' : (isKR ? Math.round(p).toLocaleString() + '원' : '$' + p.toFixed(2));
        if (!plan || !plan.recommend) {
            return `<div style="margin:12px 0;padding:11px 13px;background:var(--bg3);border:1px solid var(--border);border-radius:9px;">
                <div style="font-size:12px;font-weight:800;color:var(--text);margin-bottom:3px;">분할 진입 플랜</div>
                <div style="font-size:11.5px;color:var(--text2);line-height:1.5;">${escHtml(plan?.note || '진입가 산출 불가')}</div>
            </div>`;
        }
        const rrCol = plan.rr >= 2 ? '#22c55e' : plan.rr >= 1.5 ? '#eab308' : '#ef4444';
        const cell = (label, val, col, cap) => `<div style="text-align:center;">
            <div style="font-size:10px;color:var(--text2);font-weight:700;">${label}</div>
            <div style="font-size:14px;font-weight:800;color:${col};margin-top:3px;font-variant-numeric:tabular-nums;">${val}</div>
            ${cap ? `<div style="font-size:9.5px;color:var(--text3);margin-top:2px;line-height:1.3;">${escHtml(cap)}</div>` : ''}
        </div>`;
        return `<div style="margin:12px 0;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;">
            <div style="font-size:12px;font-weight:800;color:var(--text);margin-bottom:9px;">분할 진입 플랜</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:9px;">
                ${cell('1차 진입가', fmtP(plan.entry1), '#3b82f6', plan.basis1)}
                ${cell('2차 진입가 (추가매수)', fmtP(plan.entry2), '#6366f1', plan.basis2)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding-top:9px;border-top:1px solid var(--border);">
                ${cell('손절가', fmtP(plan.stop), '#ef4444', '')}
                ${cell('1차 목표가', fmtP(plan.target), '#22c55e', '')}
                ${cell('R/R', plan.rr.toFixed(1), rrCol, plan.rr >= 2 ? '우수' : plan.rr >= 1.5 ? '양호' : '주의')}
            </div>
            <div style="font-size:10px;color:var(--text3);margin-top:8px;line-height:1.45;">💡 1차에서 비중 일부 진입 후 2차에서 분할 추가매수. 손절가 이탈 시 전량 정리. R/R 1.5 미만은 진입 신중.</div>
        </div>`;
    }

    function _swingScoreLiquidity(d) {
        const { volumes, price } = d;
        if (!volumes || volumes.length < 10 || !price) return { score: 50, reason: '데이터 부족 — 중립' };
        const recent = volumes.slice(-20).filter(v=>v!=null);
        const avgVol = recent.reduce((a,b)=>a+b,0) / (recent.length||1);
        const isKR = currentMarket === 'KR';
        const dollarVol = avgVol * price;
        const mcap = stockData?.meta?.marketCap || stockData?.price?.marketCap || 0;
        let score, reason;
        // 거래대금 기준 (USD 환산 대략)
        const dvUsd = isKR ? dollarVol / 1350 : dollarVol;
        if (dvUsd >= 5e7) { score = 88; reason = '거래대금 풍부 — 진입·청산 원활'; }
        else if (dvUsd >= 1e7) { score = 70; reason = '거래대금 양호'; }
        else if (dvUsd >= 2e6) { score = 50; reason = '거래대금 보통 — 분할 주문 권장'; }
        else { score = 28; reason = '저거래 — 슬리피지·체결 위험'; }
        if (mcap) {
            if (mcap >= 1e10) score += 6;
            else if (mcap < 3e8) score -= 10;
        }
        score = Math.max(0, Math.min(100, score));
        return { score: Math.round(score), reason };
    }

    function _swingScoreInterest(d) {
        const { volumes } = d;
        if (!volumes || volumes.length < 25) return { score: 50, reason: '데이터 부족 — 중립' };
        const valid = volumes.filter(v=>v!=null);
        const today = valid[valid.length-1];
        const base = valid.slice(-21, -1);
        const avg = base.reduce((a,b)=>a+b,0) / (base.length||1);
        if (!avg || !today) return { score: 50, reason: '거래량 측정 불가' };
        const mult = today / avg;
        let score, reason;
        if (mult >= 3) { score = 92; reason = `거래량 ${mult.toFixed(1)}배 폭증 — 시장 관심 집중`; }
        else if (mult >= 1.8) { score = 78; reason = `거래량 ${mult.toFixed(1)}배 증가 — 관심 유입`; }
        else if (mult >= 1.1) { score = 60; reason = `거래량 ${mult.toFixed(1)}배 — 평이한 관심`; }
        else if (mult >= 0.7) { score = 45; reason = `거래량 ${mult.toFixed(1)}배 — 관심 저조`; }
        else { score = 30; reason = `거래량 ${mult.toFixed(1)}배 — 소외 구간`; }
        return { score, reason };
    }

    function _swingScoreFundamental(fin) {
        if (!fin) return { score: 50, reason: '펀더멘탈 데이터 없음 — 중립 처리' };
        let score = 55;
        const reasons = [];
        const per = fin.per ?? fin.forwardPE;
        if (per != null) {
            if (per < 0) { score -= 15; reasons.push('적자(PER 음수)'); }
            else if (per >= 8 && per <= 25) { score += 14; reasons.push(`PER ${per.toFixed(1)} 적정`); }
            else if (per > 50) { score -= 10; reasons.push(`PER ${per.toFixed(0)} 고평가`); }
            else if (per > 25) { score -= 3; reasons.push(`PER ${per.toFixed(0)} 다소 높음`); }
            else { score += 4; reasons.push(`PER ${per.toFixed(1)} 저평가`); }
        }
        if (fin.eps != null) {
            if (fin.eps < 0) { score -= 12; reasons.push('EPS 적자'); }
            else { score += 6; reasons.push('EPS 흑자'); }
        }
        if (fin.revenueGrowth != null) {
            const g = fin.revenueGrowth * 100;
            if (g >= 15) { score += 12; reasons.push(`매출성장 +${g.toFixed(0)}%`); }
            else if (g >= 0) { score += 4; reasons.push(`매출성장 +${g.toFixed(0)}%`); }
            else { score -= 10; reasons.push(`매출감소 ${g.toFixed(0)}%`); }
        }
        if (fin.profitMargin != null && fin.profitMargin > 0.15) { score += 5; reasons.push('이익률 우수'); }
        score = Math.max(0, Math.min(100, score));
        return { score: Math.round(score), reason: reasons.slice(0,3).join(' · ') || '중립' };
    }

    const _SWING_CATS = [
        { key:'technical',   name:'기술적 분석', icon:'', weight:0.25 },
        { key:'risk',        name:'리스크 관리', icon:'', weight:0.20 },
        { key:'fundamental', name:'펀더멘탈',   icon:'', weight:0.15 },
        { key:'volatility',  name:'변동성',     icon:'', weight:0.15 },
        { key:'liquidity',   name:'유동성',     icon:'', weight:0.10 },
        { key:'news',        name:'시장 뉴스',  icon:'', weight:0.08 },
        { key:'interest',    name:'시장 관심',  icon:'', weight:0.07 },
    ];

    function _swingColor(s) {
        if (s >= 75) return '#22c55e';
        if (s >= 55) return '#eab308';
        if (s >= 35) return '#f97316';
        return '#ef4444';
    }
    function _swingGrade(s) {
        if (s >= 75) return { label:'우수 — 스윙 진입 매력적', color:'#22c55e' };
        if (s >= 55) return { label:'양호 — 조건부 진입 검토', color:'#eab308' };
        if (s >= 35) return { label:'보통 — 신중한 관망', color:'#f97316' };
        return { label:'주의 — 진입 비권장', color:'#ef4444' };
    }

    function _buildSwingCardHtml(scores, ticker, d) {
        let overall = 0;
        _SWING_CATS.forEach(c => { overall += (scores[c.key]?.score ?? 50) * c.weight; });
        overall = Math.round(overall);
        const grade = _swingGrade(overall);
        const barsHtml = _SWING_CATS.map(c => {
            const r = scores[c.key] || { score:50, reason:'계산 중...', pending:true };
            const col = _swingColor(r.score);
            const pct = Math.max(3, Math.min(100, r.score));
            return `<div style="margin-bottom:10px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <span style="font-size:12px;font-weight:700;color:var(--text);">${c.name}</span>
                    <span style="font-size:12px;font-weight:800;color:${col};font-variant-numeric:tabular-nums;">${r.pending?'…':r.score}</span>
                </div>
                <div style="height:7px;background:var(--bg2);border-radius:100px;overflow:hidden;">
                    <div style="height:100%;width:${r.pending?0:pct}%;background:${col};border-radius:100px;transition:width .4s;"></div>
                </div>
                <div style="font-size:11px;color:var(--text2);margin-top:3px;line-height:1.4;">${escHtml(r.reason||'')}</div>
            </div>`;
        }).join('');
        return `
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:16px;margin:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                <div style="font-size:14px;font-weight:900;color:var(--text);">스윙 분석</div>
                <div style="font-size:11px;color:var(--text3);">7개 카테고리 종합</div>
            </div>
            <div style="display:flex;align-items:center;gap:14px;margin:10px 0 14px;padding:12px;background:var(--bg3);border-radius:10px;">
                <div style="font-size:32px;font-weight:900;color:${grade.color};font-variant-numeric:tabular-nums;line-height:1;">${overall}</div>
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:800;color:${grade.color};">${grade.label}</div>
                    <div style="font-size:11px;color:var(--text2);margin-top:2px;">가중 종합 점수 (기술 25% · 리스크 20% · 펀더 15% · 변동성 15% · 유동성 10% · 뉴스 8% · 관심 7%)</div>
                </div>
            </div>
            ${barsHtml}
            ${d ? _buildSwingEntryHtml(_swingEntryPlan(d)) : ''}
            <button id="swingAiBtn" onclick="_runSwingAi('${escHtml(ticker)}')" style="width:100%;margin-top:6px;padding:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:999px;font-size:13px;font-weight:800;cursor:pointer;letter-spacing:.02em;">AI 종합 분석</button>
            <div id="swingAnalysis-ai" style="margin-top:10px;"></div>
            <div style="margin-top:12px;padding:9px 11px;background:var(--bg3);border-radius:8px;font-size:10.5px;color:var(--text3);line-height:1.5;">
                점수는 룰베이스 알고리즘 자동 산출입니다. 펀더멘탈·뉴스는 외부 데이터 로드 후 갱신됩니다. AI 종합 분석은 버튼 클릭 시에만 호출됩니다.
            </div>
        </div>`;
    }

    async function renderSwingAnalysis() {
        const el = document.getElementById('swingAnalysis');
        if (!el) return;
        if (!stockData || !stockData.indicators) { el.innerHTML = ''; return; }
        const symbol = currentFullSymbol;

        let d;
        try { d = getAnalysisData(); } catch (e) { el.innerHTML = ''; return; }

        // 즉시 계산 5종
        const scores = {
            technical:  _swingScoreTechnical(d),
            risk:       _swingScoreRisk(d),
            volatility: _swingScoreVolatility(d),
            liquidity:  _swingScoreLiquidity(d),
            interest:   _swingScoreInterest(d),
            fundamental:{ score:50, reason:'펀더멘탈 로드 중...', pending:true },
            news:       { score:50, reason:'뉴스 촉매 확인 중...', pending:true },
        };
        el.innerHTML = _buildSwingCardHtml(scores, currentSymbol || symbol || '', d);

        // 펀더멘탈 (async)
        _fetchSwingFundamentals(symbol).then(fin => {
            if (currentFullSymbol !== symbol) return;
            scores.fundamental = _swingScoreFundamental(fin);
            const elNow = document.getElementById('swingAnalysis');
            if (elNow) elNow.innerHTML = _buildSwingCardHtml(scores, currentSymbol || symbol || '', d);
        }).catch(()=>{});

        // 뉴스 촉매 (async)
        (async () => {
            try {
                const res = await fetch(`/api/news-reason?symbols=${encodeURIComponent(symbol)}`);
                if (!res.ok) throw 0;
                const map = await res.json();
                const text = map[symbol] || map[currentSymbol] || '';
                if (text && text.length > 12) {
                    scores.news = { score: 76, reason: '최근 뉴스 촉매 존재 — ' + text.slice(0, 48) };
                } else {
                    scores.news = { score: 48, reason: '특별한 뉴스 촉매 없음 — 중립' };
                }
            } catch (e) {
                scores.news = { score: 50, reason: '뉴스 데이터 없음 — 중립 처리' };
            }
            if (currentFullSymbol !== symbol) return;
            const elNow = document.getElementById('swingAnalysis');
            if (elNow) elNow.innerHTML = _buildSwingCardHtml(scores, currentSymbol || symbol || '', d);
        })();
    }

    async function _runSwingAi(ticker) {
        const out = document.getElementById('swingAnalysis-ai');
        const btn = document.getElementById('swingAiBtn');
        if (!out) return;
        // 현재 카드에서 점수 수집
        const el = document.getElementById('swingAnalysis');
        const cats = [];
        if (el) {
            // scores 재계산
            try {
                const d = getAnalysisData();
                const fin = _swingFundCache[currentFullSymbol]?.fin || null;
                const live = {
                    technical:_swingScoreTechnical(d), risk:_swingScoreRisk(d),
                    volatility:_swingScoreVolatility(d), liquidity:_swingScoreLiquidity(d),
                    interest:_swingScoreInterest(d), fundamental:_swingScoreFundamental(fin),
                };
                _SWING_CATS.forEach(c => {
                    if (live[c.key]) cats.push({ name:c.name, score:live[c.key].score, reason:live[c.key].reason });
                });
            } catch (e) {}
        }
        if (!cats.length) { out.innerHTML = '<div style="font-size:12px;color:var(--text2);">점수 데이터를 읽을 수 없습니다.</div>'; return; }
        let overall = 0, wsum = 0;
        _SWING_CATS.forEach((c,i) => { if(cats[i]){ overall += cats[i].score*c.weight; wsum += c.weight; } });
        overall = Math.round(overall / (wsum||1));
        if (btn) { btn.disabled = true; btn.textContent = 'AI 분석 중...'; btn.style.opacity = '0.6'; }
        out.innerHTML = '<div style="font-size:12px;color:var(--text2);padding:8px;">Gemini 종합 분석 중...</div>';
        try {
            const res = await fetch('/api/swing/ai-analyze', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ ticker, categories: cats, overallScore: overall }),
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const ai = await res.json();
            out.innerHTML = _buildSwingAiHtml(ai);
        } catch (e) {
            out.innerHTML = `<div style="font-size:12px;color:var(--red);padding:8px;">AI 분석 실패: ${escHtml(e.message||'')}</div>`;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'AI 종합 분석 다시'; btn.style.opacity = '1'; }
        }
    }

    function _buildSwingAiHtml(ai) {
        if (!ai || typeof ai !== 'object') return '<div style="font-size:12px;color:var(--text2);">분석 결과 없음</div>';
        const row = (label, val, col) => val ? `<div style="margin-top:7px;"><span style="font-size:11px;font-weight:800;color:${col||'var(--text2)'};">${label}</span><div style="font-size:12px;color:var(--text);line-height:1.55;margin-top:2px;">${escHtml(val)}</div></div>` : '';
        return `<div class="cat-ai-card">
            ${ai.verdict ? `<div style="font-size:13px;font-weight:900;color:var(--text);margin-bottom:4px;">${escHtml(ai.verdict)}</div>` : ''}
            ${ai.summary ? `<div style="font-size:12px;color:var(--text);line-height:1.6;">${escHtml(ai.summary)}</div>` : ''}
            ${row('강점', ai.strength, '#22c55e')}
            ${row('약점', ai.weakness, '#ef4444')}
            ${row('스윙 적합도', ai.swingFit, '#6366f1')}
        </div>`;
    }

    // ========================================
    // 손익비(R/R) 분석 카드
    // ========================================
    function _isFallingKnife() {
        if (!stockData) return false;
        const closes = stockData.indicators.quote[0].close.filter(v => v != null);
        if (closes.length < 121) return false;
        const price = closes[closes.length - 1];
        const ma120 = calcSMA(closes, 120).filter(v => v != null).pop();
        const ma200 = calcSMA(closes, 200).filter(v => v != null).pop();
        const close5ago = closes.length >= 6 ? closes[closes.length - 6] : closes[0];
        return (ma120 && price < ma120 && (!ma200 || price < ma200) && price < close5ago);
    }

    function renderRRAnalysis() {
        const el = document.getElementById('rrAnalysis');
        if (!el || !stockData) return;
        const quotes  = stockData.indicators.quote[0];
        const closes  = quotes.close.filter(v => v != null);
        const highs   = quotes.high.filter(v => v != null);
        const lows    = quotes.low.filter(v => v != null);
        const volumes = quotes.volume.filter(v => v != null);
        if (closes.length < 21) { el.innerHTML = ''; return; }

        const isKR   = currentMarket === 'KR';
        const fmtP   = v => isKR ? Math.round(v).toLocaleString()+'원' : '$'+v.toFixed(2);
        const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
        const price  = closes[closes.length - 1];
        const period = 20;
        const label  = '단타 20일';

        // ATR-based Stop Loss (raw nullable arrays 사용)
        const atrArr = calcATR(quotes.high, quotes.low, quotes.close, 14);
        const atr    = atrArr.filter(v => v != null).pop() || price * 0.01;
        const sl     = price - atr * DAYTRADING_SL_MULTIPLIER;

        // Volume Profile → TP1, TP2
        const profile = calcVolumeProfile(closes, volumes, period, 20);
        let res = findResistanceLevels(profile, price);
        if (!res.length) {
            res = [...highs.slice(-period)].filter(h => h > price*1.005).sort((a,b)=>a-b).slice(0,2);
        }
        const tp1 = res[0] || price * 1.025;
        const tp2 = res[1] || (price + atr * TP2_ATR_MULTIPLIER);

        // R/R
        const risk = price - sl, reward = tp1 - price;
        const rr   = risk > 0 ? reward / risk : 0;

        // Signal conditions
        const fallingKnife = _isFallingKnife();
        const ma20 = calcSMA(closes, 20).filter(v => v != null).pop();
        const ma60 = calcSMA(closes, 60).filter(v => v != null).pop();
        const inUptrend  = ma20 && ma60 && price > ma20 && ma20 > ma60;
        const nearSupport = (price - Math.min(...lows.slice(-20))) / price < 0.05;

        let action, actionClass, actionDesc;
        if (fallingKnife) {
            action='⛔ 매수 금지'; actionClass='rr-action-block';
            actionDesc='낙하하는 칼을 잡지 마세요. MA120·MA200 하회 + 하락 추세 감지.';
        } else if (rr < 1.5) {
            action='관망'; actionClass='rr-action-wait';
            actionDesc=`손익비 ${rr.toFixed(2)} — 진입 기준(1.5) 미달. 조건 개선 후 재검토.`;
        } else if (rr >= 2.0 && inUptrend) {
            action='적극 매수'; actionClass='rr-action-buy';
            actionDesc=`손익비 ${rr.toFixed(2)} + 상승 추세 확인. 우호적 진입 조건.`;
        } else {
            action='분할 매수'; actionClass='rr-action-partial';
            actionDesc=`손익비 ${rr.toFixed(2)}${nearSupport?' + 지지선 근접':''} — 분할 진입 고려.`;
        }
        const rrColor = rr >= 2.0 ? 'var(--green)' : rr >= 1.5 ? 'var(--yellow)' : 'var(--red)';
        const fkHtml = fallingKnife ? `<div class="rr-knife-warning">
            <span class="rr-knife-icon">⛔</span>
            <div><div class="rr-knife-title">낙하하는 칼 (Falling Knife) 경고</div>
            <div class="rr-knife-desc">MA120·MA200 동시 하회 + 5일 하락. 단기 RSI 과매도에도 매수 금지.</div></div>
        </div>` : '';

        el.innerHTML = `<div class="card rr-card">
            <div class="card-title">
                손익비 (R/R) 분석
                <span class="rr-basis-badge" data-tip="최근 20일 단타 매매 기준으로 산출된 손익비 분석입니다." title="최근 20일 단타 매매 기준으로 산출된 손익비 분석입니다.">${label}</span>
            </div>
            ${fkHtml}
            <div class="rr-action-row">
                <div class="rr-action-badge ${actionClass}">${action}</div>
                <div class="rr-action-desc">${actionDesc}</div>
            </div>
            <div class="rr-table">
                <div class="rr-row"><span class="rr-label">진입가 범위</span>
                    <span class="rr-value">${fmtP(price*0.995)} ~ ${fmtP(price*1.005)}</span></div>
                <div class="rr-row"><span class="rr-label">1차 목표가 (TP1)</span>
                    <span class="rr-value" style="color:var(--green)">${fmtP(tp1)}
                    <span class="rr-pct">${fmtPct((tp1-price)/price*100)}</span></span></div>
                <div class="rr-row"><span class="rr-label">2차 목표가 (TP2 · ATR×2.5)</span>
                    <span class="rr-value" style="color:var(--green)">${fmtP(tp2)}
                    <span class="rr-pct">${fmtPct((tp2-price)/price*100)}</span></span></div>
                <div class="rr-row"><span class="rr-label">손절가 (SL · ATR×0.7)</span>
                    <span class="rr-value" style="color:var(--red)">${fmtP(sl)}
                    <span class="rr-pct">${fmtPct((sl-price)/price*100)}</span></span></div>
                <div class="rr-row"><span class="rr-label">ATR(14) 일평균 변동폭</span>
                    <span class="rr-value">${fmtP(atr)}</span></div>
                <div class="rr-row rr-row-rr"><span class="rr-label">손익비 (R/R)</span>
                    <span class="rr-value rr-ratio-value" style="color:${rrColor}">1 : ${rr.toFixed(2)}</span></div>
            </div>
            <div class="rr-legend">
                <span class="rr-legend-dot" style="background:var(--green)"></span><span>≥ 2.0 적극매수</span>
                <span class="rr-legend-dot" style="background:var(--yellow)"></span><span>1.5~2.0 분할매수</span>
                <span class="rr-legend-dot" style="background:var(--red)"></span><span>&lt; 1.5 관망</span>
            </div>
        </div>`;
    }

    function renderMACDSignal() {
        const el = document.getElementById('macdSignal');
        if (!el || !stockData) return;
        const quotes  = stockData.indicators.quote[0];
        const closes  = quotes.close.filter(v => v != null);
        const volumes = quotes.volume.filter(v => v != null);

        if (closes.length < 60) {
            el.innerHTML = `<div class="card" style="padding:20px 24px;">
                <div class="card-title">
                    <span class="dot" style="background:var(--purple)"></span>MACD 모멘텀 시그널
                    <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:4px;">Rayner Teo</span>
                </div>
                <p style="font-size:13px;color:var(--text2);margin:0;">분석 데이터가 부족합니다 (최소 60일 데이터 필요)</p>
            </div>`;
            return;
        }

        const result = analyzeMACDRayner(closes, volumes);
        if (!result) { el.innerHTML = ''; return; }

        const { isBuySignal, isSellSignal, currentMomentum, reason, chartData } = result;

        // 시그널 배지
        let sigClass, sigLabel;
        if (isBuySignal && !isSellSignal)       { sigClass = 'macd-signal-buy';  sigLabel = '🟢 매수 시그널'; }
        else if (isSellSignal && !isBuySignal)   { sigClass = 'macd-signal-sell'; sigLabel = '🔴 매도 시그널'; }
        else                                     { sigClass = 'macd-signal-hold'; sigLabel = '⚪ 관망'; }

        // 모멘텀 배지
        let momClass, momLabel;
        if (currentMomentum === '강화')      { momClass = 'macd-momentum-up';  momLabel = '↑ 강화'; }
        else if (currentMomentum === '약화') { momClass = 'macd-momentum-dn';  momLabel = '↓ 약화'; }
        else                                 { momClass = 'macd-momentum-neu'; momLabel = '→ 중립'; }

        const histColor = chartData.macdHistogram >= 0 ? 'var(--green)' : 'var(--red)';

        el.innerHTML = `<div class="card">
            <div class="card-title">
                <span class="dot" style="background:var(--purple)"></span>MACD 모멘텀 시그널
                <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:4px;">Rayner Teo · Fast=1 / Slow=60 / Signal=9</span>
            </div>
            <div class="macd-signal-header">
                <span class="macd-signal-badge ${sigClass}">${sigLabel}</span>
                <span class="macd-momentum-badge ${momClass}">모멘텀 ${momLabel}</span>
            </div>
            <div class="macd-reason-box">
                <div class="macd-reason-label">AI 판단 근거</div>
                <div class="macd-reason-text">${reason}</div>
            </div>
            <div class="rr-table">
                <div class="rr-row">
                    <span class="rr-label">MACD 히스토그램</span>
                    <span class="rr-value" style="color:${histColor}">${chartData.macdHistogram.toFixed(4)}</span>
                </div>
                <div class="rr-row">
                    <span class="rr-label">60 EMA</span>
                    <span class="rr-value">${chartData.ema60.toFixed(2)}</span>
                </div>
            </div>
            <div class="macd-disclaimer">본 시그널은 투자 참고용입니다. 투자 결정은 본인 판단 하에 진행하세요.</div>
        </div>`;
    }

    function renderRSIMomentum() {
        const el = document.getElementById('rsiMomentum');
        if (!el || !stockData) return;
        const quotes  = stockData.indicators.quote[0];
        const closes  = quotes.close.filter(v => v != null);
        const highs   = quotes.high.filter(v => v != null);
        const lows    = quotes.low.filter(v => v != null);

        const minLen = RSI_PERIOD + DYNAMIC_BAND_LOOKBACK;
        if (closes.length < minLen) {
            el.innerHTML = `<div class="card" style="padding:20px 24px;">
                <div class="card-title">
                    <span class="dot" style="background:var(--yellow)"></span>RSI 모멘텀 진단
                    <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:4px;">동적 밴드 · 다이버전스</span>
                </div>
                <p style="font-size:13px;color:var(--text2);margin:0;">분석 데이터가 부족합니다 (최소 ${minLen}일 데이터 필요)</p>
            </div>`;
            return;
        }

        const result = analyzeRSIDynamic(closes, highs, lows);
        if (!result) { el.innerHTML = ''; return; }

        const { isBuySignal, isSellSignal, currentRSI,
                dynamicUpperBand, dynamicLowerBand,
                centerLinePosition, divergenceType, rsiZone, reason } = result;

        // 시그널 배지
        let sigClass, sigLabel;
        if (isBuySignal && !isSellSignal)      { sigClass = 'rsi-signal-buy';  sigLabel = '🟢 매수 시그널'; }
        else if (isSellSignal && !isBuySignal) { sigClass = 'rsi-signal-sell'; sigLabel = '🔴 매도 · 익절 시그널'; }
        else                                   { sigClass = 'rsi-signal-hold'; sigLabel = '⚪ 관망'; }

        // 다이버전스 배지
        let divClass, divLabel;
        if (divergenceType === '상승')      { divClass = 'rsi-diverg-bull'; divLabel = '🟢 상승 다이버전스 감지'; }
        else if (divergenceType === '하락') { divClass = 'rsi-diverg-bear'; divLabel = '🔴 하락 다이버전스 감지'; }
        else                                { divClass = 'rsi-diverg-none'; divLabel = '다이버전스 없음'; }

        // RSI 수치 색상
        const rsiColor = currentRSI >= dynamicUpperBand ? 'var(--red)'
                       : currentRSI <= dynamicLowerBand ? 'var(--green)'
                       : 'var(--text1)';

        el.innerHTML = `<div class="card">
            <div class="card-title">
                <span class="dot" style="background:var(--yellow)"></span>RSI 모멘텀 진단
                <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:4px;">동적 밴드(${DYNAMIC_BAND_LOOKBACK}일) · 다이버전스</span>
            </div>
            <div class="rsi-signal-header">
                <span class="rsi-signal-badge ${sigClass}">${sigLabel}</span>
                <span class="rsi-diverg-badge ${divClass}">${divLabel}</span>
            </div>
            <div class="rsi-reason-box">
                <div class="rsi-reason-label">AI 판단 근거</div>
                <div class="rsi-reason-text">${reason}</div>
            </div>
            <div class="rr-table">
                <div class="rr-row">
                    <span class="rr-label">현재 RSI</span>
                    <span class="rr-value" style="color:${rsiColor}">${currentRSI.toFixed(1)}</span>
                </div>
                <div class="rr-row">
                    <span class="rr-label">동적 상단 밴드 <span style="font-size:11px;font-weight:400;color:var(--text3)">(이 종목 과매수 기준)</span></span>
                    <span class="rr-value" style="color:var(--red)">${dynamicUpperBand.toFixed(1)}</span>
                </div>
                <div class="rr-row">
                    <span class="rr-label">동적 하단 밴드 <span style="font-size:11px;font-weight:400;color:var(--text3)">(이 종목 과매도 기준)</span></span>
                    <span class="rr-value" style="color:var(--green)">${dynamicLowerBand.toFixed(1)}</span>
                </div>
                <div class="rr-row">
                    <span class="rr-label">RSI 구간</span>
                    <span class="rr-value">${rsiZone}</span>
                </div>
                <div class="rr-row">
                    <span class="rr-label">중심선(${RSI_CENTER_LINE}) 위치</span>
                    <span class="rr-value">${centerLinePosition}</span>
                </div>
            </div>
            <div class="rsi-disclaimer">동적 밴드는 최근 ${DYNAMIC_BAND_LOOKBACK}일 RSI 분포 기준으로 자동 계산됩니다. 투자 결정은 본인 판단 하에 진행하세요.</div>
        </div>`;
    }

    // ════════════════════════════════════════════════════════════
    // 🔬 퀀트 분석 — 4개 정량 축 + 종합 점수
    //   1. 모멘텀: 1·3·6·12개월 누적수익률 + RSI + 52주 위치
    //   2. 위험·변동성: 30/90일 일변동성, MDD(YTD), ATR%
    //   3. 시장 대비: 60일 베타, 3개월 알파 (US:SPY / KR:KOSPI)
    //   4. 평균 회귀: Z-score(60일), Bollinger %B
    //   - 각 축 0~100 점수 산출 → 가중 합산으로 종합 0~100
    // ════════════════════════════════════════════════════════════
    let _quantBenchCache = { sym: '', ts: 0, closes: [] };
    let _quantRendering = false; // 동시 실행 방지 플래그

    async function _fetchBenchCloses(market) {
        const sym  = market === 'KR' ? '%5EKS11' : 'SPY';
        const now  = Date.now();
        if (_quantBenchCache.sym === sym && now - _quantBenchCache.ts < 30 * 60 * 1000 && _quantBenchCache.closes.length) {
            return _quantBenchCache.closes;
        }
        try {
            const r = await fetch(`/api/chart/${sym}?range=1y&interval=1d`);
            if (!r.ok) throw new Error('http ' + r.status);
            const j = await r.json();
            const closes = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
            _quantBenchCache = { sym, ts: now, closes };
            return closes;
        } catch { return []; }
    }

    // ── 통계 helpers ──────────────────────────────────────────────
    function _qDailyReturns(closes) {
        const r = [];
        for (let i = 1; i < closes.length; i++) {
            if (closes[i-1] > 0) r.push((closes[i] - closes[i-1]) / closes[i-1]);
        }
        return r;
    }
    function _qStdDev(arr) {
        if (!arr.length) return 0;
        const m = arr.reduce((a,b)=>a+b,0) / arr.length;
        const v = arr.reduce((a,b)=>a + (b-m)*(b-m), 0) / Math.max(1, arr.length - 1);
        return Math.sqrt(v);
    }
    function _qVariance(arr) {
        if (!arr.length) return 0;
        const m = arr.reduce((a,b)=>a+b,0) / arr.length;
        return arr.reduce((a,b)=>a + (b-m)*(b-m), 0) / Math.max(1, arr.length - 1);
    }
    function _qCovariance(x, y) {
        const n = Math.min(x.length, y.length);
        if (n < 2) return 0;
        const xs = x.slice(-n), ys = y.slice(-n);
        const mx = xs.reduce((a,b)=>a+b,0) / n;
        const my = ys.reduce((a,b)=>a+b,0) / n;
        let s = 0;
        for (let i = 0; i < n; i++) s += (xs[i] - mx) * (ys[i] - my);
        return s / (n - 1);
    }
    function _qPctReturn(closes, daysAgo) {
        if (closes.length <= daysAgo) return null;
        const a = closes[closes.length - 1 - daysAgo];
        const b = closes[closes.length - 1];
        if (!a || !b) return null;
        return ((b - a) / a) * 100;
    }
    function _qMaxDrawdown(closes) {
        if (closes.length < 2) return 0;
        let peak = closes[0], maxDD = 0;
        for (const c of closes) {
            if (c > peak) peak = c;
            const dd = (c - peak) / peak;
            if (dd < maxDD) maxDD = dd;
        }
        return maxDD * 100; // 음수
    }
    function _qClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    async function renderQuantAnalysis() {
        if (_quantRendering) return; // 이전 실행이 완료되지 않으면 스킵
        _quantRendering = true;
        try {
        const el = document.getElementById('quantAnalysis');
        if (!el || !stockData) return;
        const quotes = stockData.indicators.quote[0];
        const closes = (quotes.close || []).filter(v => v != null);
        if (closes.length < 60) { el.innerHTML = ''; return; }

        const isKR    = currentMarket === 'KR';
        const fmtPct  = v => v == null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
        const fmtNum  = (v, d=2) => v == null ? '-' : Number(v).toFixed(d);

        const price   = closes[closes.length - 1];

        // ───── 1) 모멘텀 ─────
        const ret1m   = _qPctReturn(closes, 21);
        const ret3m   = _qPctReturn(closes, 63);
        const ret6m   = _qPctReturn(closes, 126);
        const ret12m  = _qPctReturn(closes, 252);
        const rsi     = (calcRSI(closes, 14) || []).filter(v => v != null).pop();
        const recent252 = closes.slice(-252);
        const high52w = Math.max(...recent252);
        const low52w  = Math.min(...recent252);
        const pos52w  = high52w > low52w ? ((price - low52w) / (high52w - low52w)) * 100 : 50;
        // 점수: 누적 수익률 가중 + RSI 보너스
        let momScore = 50;
        if (ret1m  != null) momScore += _qClamp(ret1m  * 1.2, -15, 15);
        if (ret3m  != null) momScore += _qClamp(ret3m  * 0.5, -10, 10);
        if (ret6m  != null) momScore += _qClamp(ret6m  * 0.25, -8, 8);
        if (ret12m != null) momScore += _qClamp(ret12m * 0.10, -5, 5);
        if (pos52w >= 80) momScore += 5;
        if (pos52w <= 20) momScore -= 5;
        momScore = _qClamp(momScore, 0, 100);

        // ───── 2) 위험·변동성 ─────
        const returns = _qDailyReturns(closes);
        const vol30   = returns.length >= 30 ? _qStdDev(returns.slice(-30))  * 100 : null;
        const vol90   = returns.length >= 90 ? _qStdDev(returns.slice(-90))  * 100 : null;
        const mdd     = _qMaxDrawdown(recent252);
        const atrArr  = calcATR(quotes.high, quotes.low, quotes.close, 14);
        const atrLast = (atrArr || []).filter(v => v != null).pop();
        const atrPct  = atrLast ? (atrLast / price) * 100 : null;
        // 점수: 일변동성 낮을수록 ↑ (3% 이하 = 좋음, 6%+ = 위험)
        let riskScore = 50;
        if (vol30 != null) riskScore = _qClamp(100 - vol30 * 14, 0, 100);
        if (mdd < -40) riskScore -= 10;
        riskScore = _qClamp(riskScore, 0, 100);

        // ───── 3) 시장 대비 (비동기) ─────
        let beta = null, alpha3m = null, marketScore = 50, benchOk = false;
        const benchCloses = await _fetchBenchCloses(currentMarket);
        if (benchCloses.length >= 60) {
            const bRet = _qDailyReturns(benchCloses);
            const minLen = Math.min(returns.length, bRet.length, 60);
            const sR = returns.slice(-minLen);
            const bR = bRet.slice(-minLen);
            const cov = _qCovariance(sR, bR);
            const varB = _qVariance(bR);
            beta = varB > 0 ? cov / varB : null;
            const stk3m = _qPctReturn(closes, 63);
            const bm3m  = _qPctReturn(benchCloses, 63);
            if (beta != null && stk3m != null && bm3m != null) {
                alpha3m = stk3m - bm3m * beta;
                marketScore = _qClamp(50 + alpha3m * 2.5, 0, 100);
                benchOk = true;
            }
        }

        // ───── 4) 평균 회귀 ─────
        const recent60  = closes.slice(-60);
        const mean60    = recent60.reduce((a,b)=>a+b, 0) / recent60.length;
        const std60     = _qStdDev(recent60);
        const z         = std60 > 0 ? (price - mean60) / std60 : 0;
        const bb        = calcBollingerBands(closes, 4, 2);
        const upper     = (bb.upper || []).filter(v => v != null).pop();
        const lower     = (bb.lower || []).filter(v => v != null).pop();
        const pctB      = (upper && lower && upper > lower) ? (price - lower) / (upper - lower) : 0.5;
        // 점수: |z|>2 면 신호 강함 (음수 z = 매수 기회)
        const meanRevScore = _qClamp(50 - z * 12, 0, 100);

        // ───── 종합 점수 ─────
        const W = { mom: 0.30, risk: 0.25, market: 0.25, meanRev: 0.20 };
        const composite = momScore * W.mom + riskScore * W.risk + marketScore * W.market + meanRevScore * W.meanRev;
        let verdict, vCls;
        if      (composite >= 70) { verdict = '스트롱 매수'; vCls = 'q-strong-buy'; }
        else if (composite >= 58) { verdict = '약한 매수';   vCls = 'q-buy'; }
        else if (composite >= 42) { verdict = '중립';        vCls = 'q-neutral'; }
        else if (composite >= 30) { verdict = '약한 매도';   vCls = 'q-sell'; }
        else                       { verdict = '강한 매도';   vCls = 'q-strong-sell'; }

        // 신호 해석
        const meanSig = z >  2 ? '과매수' : z < -2 ? '과매도'
                     : z >  1 ? '단기 과열' : z < -1 ? '단기 침체' : '중립';
        const meanSigCls = z >  1 ? 'down' : z < -1 ? 'up' : '';
        const rsiCls = rsi == null ? '' : rsi >= 70 ? 'down' : rsi <= 30 ? 'up' : '';

        // ───── HTML 렌더 ─────
        const axisCard = (title, score, rows) => {
            const cls = score >= 70 ? 'q-axis-high' : score >= 50 ? 'q-axis-mid' : score >= 30 ? 'q-axis-low' : 'q-axis-crit';
            return `<div class="quant-axis">
                <div class="quant-axis-hd">
                    <span class="quant-axis-title">${title}</span>
                    <span class="quant-axis-score ${cls}">${Math.round(score)}</span>
                </div>
                <div class="quant-axis-rows">
                    ${rows.map(r => `<div class="quant-row">
                        <span class="quant-row-lbl">${r.label}</span>
                        <span class="quant-row-val ${r.cls || ''}">${r.value}</span>
                    </div>`).join('')}
                </div>
            </div>`;
        };

        // ───── 퀀트 기반 매매 가격 계산 ─────
        const fmt$  = v => isKR ? Math.round(v).toLocaleString()+'원' : '$'+v.toFixed(2);
        const atr   = atrLast || price * 0.015;
        // 매수 진입: 과매도(z<-1 or RSI<35)면 현재가, 아니면 BB하단 or 현재가-0.5ATR
        const entryQ = (z < -1 || (rsi != null && rsi < 35))
            ? price
            : (lower && lower < price ? lower : price - atr * 0.5);
        const slQ    = entryQ - atr * 1.5;                     // 손절: 진입가 - 1.5×ATR
        const tp1Q   = mean60;                                  // 1차 목표: 60일 평균
        const tp2Q   = upper || price + atr * 3;               // 2차 목표: BB 상단
        const rrQ    = entryQ - slQ > 0 ? (tp1Q - entryQ) / (entryQ - slQ) : 0;
        const entryLbl = (z < -1 || (rsi != null && rsi < 35)) ? '현재가 (과매도)' : (lower && lower < price ? 'BB 하단' : '현재가-½ATR');
        const signalRowHtml = `
        <div class="quant-signal-row">
            <div class="quant-signal-item">
                <div class="quant-signal-lbl">매수 진입</div>
                <div class="quant-signal-price up">${fmt$(entryQ)}</div>
                <div class="quant-signal-sub">${entryLbl}</div>
            </div>
            <div class="quant-signal-arrow">→</div>
            <div class="quant-signal-item">
                <div class="quant-signal-lbl">손절</div>
                <div class="quant-signal-price down">${fmt$(slQ)}</div>
                <div class="quant-signal-sub">−1.5×ATR</div>
            </div>
            <div class="quant-signal-arrow">→</div>
            <div class="quant-signal-item">
                <div class="quant-signal-lbl">1차 목표</div>
                <div class="quant-signal-price">${fmt$(tp1Q)}</div>
                <div class="quant-signal-sub">60일 평균</div>
            </div>
            <div class="quant-signal-arrow">→</div>
            <div class="quant-signal-item">
                <div class="quant-signal-lbl">2차 목표</div>
                <div class="quant-signal-price">${fmt$(tp2Q)}</div>
                <div class="quant-signal-sub">BB 상단</div>
            </div>
            <div class="quant-signal-rr">R/R ${rrQ.toFixed(2)}</div>
        </div>`;

        el.innerHTML = `<div class="card quant-card">
            <div class="card-title">
                퀀트 분석 <span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:4px;">정량 지표 4축 + 종합 점수</span>
            </div>
            <div class="quant-composite">
                <div class="quant-composite-left">
                    <div class="quant-composite-score ${vCls}">${Math.round(composite)}</div>
                    <div class="quant-composite-meta">
                        <div class="quant-composite-label">종합 퀀트 점수</div>
                        <div class="quant-verdict ${vCls}">${verdict}</div>
                    </div>
                </div>
                <div class="quant-composite-bar">
                    <div class="quant-composite-fill ${vCls}" style="width:${Math.round(composite)}%"></div>
                </div>
            </div>
            ${signalRowHtml}
            <div class="quant-grid">
                ${axisCard('🚀 모멘텀', momScore, [
                    { label: '1개월',    value: fmtPct(ret1m),  cls: ret1m>=0?'up':'down' },
                    { label: '3개월',    value: fmtPct(ret3m),  cls: ret3m>=0?'up':'down' },
                    { label: '6개월',    value: fmtPct(ret6m),  cls: ret6m>=0?'up':'down' },
                    { label: '12개월',   value: fmtPct(ret12m), cls: ret12m>=0?'up':'down' },
                    { label: 'RSI(14)',  value: rsi != null ? rsi.toFixed(0) : '-', cls: rsiCls },
                    { label: '52주 위치', value: pos52w.toFixed(0)+'%' },
                ])}
                ${axisCard('⚠️ 위험·변동성', riskScore, [
                    { label: '30일 일변동성', value: vol30 != null ? vol30.toFixed(2)+'%' : '-' },
                    { label: '90일 일변동성', value: vol90 != null ? vol90.toFixed(2)+'%' : '-' },
                    { label: '최대 손실폭(YTD)', value: mdd.toFixed(1)+'%', cls: 'down' },
                    { label: 'ATR 비율',    value: atrPct != null ? atrPct.toFixed(2)+'%' : '-' },
                ])}
                ${axisCard('📊 시장 대비', marketScore, benchOk ? [
                    { label: '벤치마크',     value: isKR ? 'KOSPI' : 'S&P 500' },
                    { label: '베타 (60일)',  value: fmtNum(beta) },
                    { label: '3개월 알파',   value: fmtPct(alpha3m), cls: alpha3m>=0?'up':'down' },
                    { label: '시장 동조도',  value: beta != null ? (Math.abs(beta-1) < 0.2 ? '시장 추종' : beta > 1.2 ? '고변동' : beta < 0.8 ? '저변동' : '중간') : '-' },
                ] : [
                    { label: '벤치마크',  value: isKR ? 'KOSPI' : 'S&P 500' },
                    { label: '상태',     value: '데이터 부족' },
                ])}
                ${axisCard('🔄 평균 회귀', meanRevScore, [
                    { label: 'Z-score (60일)', value: z.toFixed(2), cls: z>2?'down':z<-2?'up':'' },
                    { label: 'BB %B',          value: pctB.toFixed(2), cls: pctB>1?'down':pctB<0?'up':'' },
                    { label: '평균',            value: isKR ? Math.round(mean60).toLocaleString()+'원' : '$'+mean60.toFixed(2) },
                    { label: '신호',            value: meanSig, cls: meanSigCls },
                ])}
            </div>
            <div class="quant-footer">
                ※ 정량 시그널은 참고 자료이며 단독 매매 신호가 아닙니다. R/R 분석과 종합 판단을 권장.
            </div>
        </div>`;
        } finally {
            _quantRendering = false;
        }
    }

    // ── 멀티팩터 스코어 카드 ────────────────────────────────────────────
    function _renderMultiFactorCard() {
        const el = document.getElementById('mfScoreCard');
        if (!el || !stockData) return;

        const quotes = stockData.indicators.quote[0];
        const closes  = (quotes.close  || []).filter(v => v != null);
        const volumes = (quotes.volume || []).filter(v => v != null);
        if (closes.length < 30) { el.innerHTML = ''; return; }

        const price = closes[closes.length - 1];
        const isKR  = currentMarket === 'KR';
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        // ─── 공통 지표 ───
        const rsiArr = calcRSI(closes, 14);
        const rsi    = (rsiArr || []).filter(v => v != null).pop();
        const { macdLine, signalLine, histogram } = calcMACD(closes);
        const macdLast = (macdLine   || []).filter(v => v != null).pop();
        const sigLast  = (signalLine || []).filter(v => v != null).pop();
        const histArr  = (histogram  || []).filter(v => v != null);
        const histLast = histArr.length ? histArr[histArr.length - 1] : null;
        const histPrev = histArr.length >= 3 ? histArr[histArr.length - 3] : null;
        const macdBull = macdLast != null && sigLast != null && macdLast > sigLast;

        const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a,b)=>a+b,0)/20 : null;
        const ma60 = closes.length >= 60 ? closes.slice(-60).reduce((a,b)=>a+b,0)/60 : null;
        const maAligned = ma20 && ma60 && price > ma20 && ma20 > ma60;

        const recent = closes.slice(-252);
        const hi52   = Math.max(...recent);
        const lo52   = Math.min(...recent);
        const pos52  = hi52 > lo52 ? (price - lo52) / (hi52 - lo52) : 0.5;

        // ─── 1. 모멘텀 (25%) ───
        const ret5d = closes.length >= 6
            ? (closes[closes.length-1] - closes[closes.length-6]) / closes[closes.length-6] * 100
            : null;
        let momScore = 50;
        if (rsi != null)   momScore += clamp((rsi - 50) * 0.6, -18, 18);
        if (macdBull)      momScore += 12; else momScore -= 8;
        if (ret5d != null) momScore += clamp(ret5d * 2, -15, 15);
        if (maAligned)     momScore += 10; else momScore -= 5;
        momScore = clamp(Math.round(momScore), 0, 100);

        // ─── 2. 밸류에이션 (25%) ───
        let valScore = 50;
        // 52주 저점에 가까울수록 높음 (저점=100점 기여, 고점=0점 기여)
        valScore += Math.round((1 - pos52) * 25);
        // RSI 과매도는 밸류 기회
        if (rsi != null && rsi < 30) valScore += 15;
        else if (rsi != null && rsi > 70) valScore -= 15;
        valScore = clamp(valScore, 0, 100);

        // ─── 3. 퀄리티 (25%) ───
        let qualScore = 50;
        // 거래량 추세: 최근 10일 vs 이전 10일
        if (volumes.length >= 20) {
            const rec10  = volumes.slice(-10).reduce((a,b)=>a+b,0)/10;
            const prev10 = volumes.slice(-20,-10).reduce((a,b)=>a+b,0)/10;
            const vTrend = prev10 > 0 ? (rec10 - prev10) / prev10 : 0;
            qualScore += clamp(Math.round(vTrend * 30), -15, 20);
        }
        // MACD histogram 증가 추세
        if (histLast != null && histPrev != null) {
            if (histLast > histPrev) qualScore += 12;
            else qualScore -= 8;
        }
        // 52주 고점 근처 (강한 모멘텀 = 퀄리티)
        if (pos52 > 0.8) qualScore += 10;
        qualScore = clamp(Math.round(qualScore), 0, 100);

        // ─── 4. 수급 (25%) ───
        let supplyScore = 50;
        if (volumes.length >= 25) {
            const avg20 = volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
            const avg5  = volumes.slice(-5).reduce((a,b)=>a+b,0)/5;
            const rvol  = avg20 > 0 ? avg5 / avg20 : 1;
            if (rvol >= 2.0)      supplyScore += 25;
            else if (rvol >= 1.5) supplyScore += 15;
            else if (rvol >= 1.2) supplyScore += 5;
            else if (rvol < 0.8)  supplyScore -= 15;
        }
        if (maAligned)                               supplyScore += 10;
        if (rsi != null && rsi > 50 && rsi < 70)    supplyScore += 8;
        supplyScore = clamp(Math.round(supplyScore), 0, 100);

        // ─── 최종 종합 ───
        const total = Math.round(momScore * 0.25 + valScore * 0.25 + qualScore * 0.25 + supplyScore * 0.25);
        let tier, tierCls, tierDesc;
        if      (total >= 75) { tier = 'TIER A'; tierCls = 'mf-tier-a'; tierDesc = '강력 매수 후보 — 4개 팩터 양호'; }
        else if (total >= 60) { tier = 'TIER B'; tierCls = 'mf-tier-b'; tierDesc = '매수 고려 — 주요 팩터 우세'; }
        else if (total >= 45) { tier = 'TIER C'; tierCls = 'mf-tier-c'; tierDesc = '관망 — 팩터 혼재, 추가 확인 필요'; }
        else                  { tier = 'TIER D'; tierCls = 'mf-tier-d'; tierDesc = '회피 — 대부분 팩터 부정적'; }

        const gauge = (score, label, sub) => {
            const cls = score >= 70 ? 'mf-g-high' : score >= 50 ? 'mf-g-mid' : score >= 30 ? 'mf-g-low' : 'mf-g-crit';
            return `<div class="mf-factor">
                <div class="mf-factor-hd">
                    <span class="mf-factor-label">${label}</span>
                    <span class="mf-factor-score ${cls}">${score}</span>
                </div>
                <div class="mf-gauge-track">
                    <div class="mf-gauge-fill ${cls}" style="width:${score}%"></div>
                </div>
                <div class="mf-factor-sub">${sub}</div>
            </div>`;
        };

        el.innerHTML = `<div class="card mf-card">
            <div class="card-title">
                멀티팩터 스코어
                <span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:4px;">4팩터 종합 평가</span>
            </div>
            <div class="mf-header">
                <div class="mf-total-score ${tierCls}">${total}</div>
                <div class="mf-header-right">
                    <span class="mf-tier-badge ${tierCls}">${tier}</span>
                    <div class="mf-tier-desc">${tierDesc}</div>
                </div>
            </div>
            <div class="mf-gauges">
                ${gauge(momScore,    '🚀 모멘텀',    `RSI ${rsi != null ? rsi.toFixed(0) : '-'} · MACD ${macdBull ? '강세' : '약세'} · MA ${maAligned ? '정배열' : '역배열'}`)}
                ${gauge(valScore,    '💎 밸류에이션', `52주 위치 ${(pos52*100).toFixed(0)}% · ${pos52 < 0.3 ? '저점 근접' : pos52 > 0.7 ? '고점 근접' : '중간 구간'}`)}
                ${gauge(qualScore,   '⭐ 퀄리티',    `거래량 추세 · MACD 방향성`)}
                ${gauge(supplyScore, '📊 수급',      `RVOL 분석 · MA 정배열 · RSI 구간`)}
            </div>
            <div class="mf-footer">※ 4팩터 등가중(각 25%) 자동 계산 — 참고용 지표입니다.</div>
        </div>`;
    }

    // R/R Gate: 기술적 매수 추천이지만 R/R < 1.5이면 '관망'으로 강제 변환
    function _applyRRGate() {
        if (!stockData) return;
        const quotes  = stockData.indicators.quote[0];
        const closes  = quotes.close.filter(v => v != null);
        if (closes.length < 21) return;
        const price   = closes[closes.length - 1];
        const atrArr  = calcATR(quotes.high, quotes.low, quotes.close, 14);
        const atr     = atrArr.filter(v => v != null).pop() || price * 0.01;
        const sl      = price - atr * DAYTRADING_SL_MULTIPLIER;
        const volumes = quotes.volume.filter(v => v != null);
        const period  = 20;
        const profile = calcVolumeProfile(closes, volumes, period, 20);
        const res     = findResistanceLevels(profile, price);
        const tp1     = res[0] || price * 1.025;
        const risk = price - sl, reward = tp1 - price;
        const rr   = risk > 0 ? reward / risk : 0;
        if (rr >= 1.5) return;

        const prefix = 'day';
        const recEl  = document.getElementById(prefix + 'Recommendation');
        const sumEl  = document.getElementById(prefix + 'Summary');
        if (recEl && !recEl.textContent.includes('매도')) {
            recEl.textContent = '관망 (R/R 미달)';
            recEl.style.color = 'var(--yellow)';
        }
        if (sumEl) {
            sumEl.textContent = `손익비 ${rr.toFixed(2)} — 기술적 지표와 무관하게 진입 기준(1.5) 미달로 관망 권장.`;
        }
    }

    // --- 공통 렌더 함수 ---
    function renderTimingCard(prefix, type, checks, passCount, totalChecks, strategyHtml) {
        const score = Math.round((passCount / totalChecks) * 100);
        const isEntry = type === 'entry';
        let verdict, verdictColor, verdictIcon, verdictClass, verdictDesc;
        if (isEntry) {
            if (passCount >= Math.ceil(totalChecks * 0.7)) {
                verdict = prefix === 'day' ? '단타 진입 적합' : '스윙 진입 적합';
                verdictColor = 'var(--green)';
                verdictIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>';
                verdictClass = 'entry-go';
                verdictDesc = prefix === 'day' ? '단타 진입 조건이 충족되었습니다. 타이트한 손절로 빠르게 진입하세요.' : '스윙 진입 조건이 충족되었습니다. 분할 매수로 진입하세요.';
            } else if (passCount >= Math.ceil(totalChecks * 0.4)) {
                verdict = '조건부 진입';
                verdictColor = 'var(--yellow)';
                verdictIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';
                verdictClass = 'entry-wait';
                verdictDesc = '일부 조건만 충족. 소량 진입하거나 추가 확인 후 진입하세요.';
            } else {
                verdict = '진입 대기 (관망)';
                verdictColor = 'var(--red)';
                verdictIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
                verdictClass = 'entry-danger';
                verdictDesc = '진입 조건 미충족. 추세 전환 확인까지 대기하세요.';
            }
        } else {
            if (passCount >= Math.ceil(totalChecks * 0.7)) {
                verdict = prefix === 'day' ? '즉시 청산' : '즉시 매도';
                verdictColor = 'var(--red)';
                verdictIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 8l8 8M16 8l-8 8"/></svg>';
                verdictClass = 'exit-sell';
                verdictDesc = prefix === 'day' ? '다수 청산 신호. 즉시 포지션을 정리하세요.' : '다수 매도 신호. 전량 또는 대부분 매도를 권장합니다.';
            } else if (passCount >= Math.ceil(totalChecks * 0.4)) {
                verdict = '부분 정리';
                verdictColor = 'var(--yellow)';
                verdictIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';
                verdictClass = 'exit-partial';
                verdictDesc = '일부 청산 신호. 물량 일부를 정리하고 추이를 지켜보세요.';
            } else {
                verdict = '보유 유지';
                verdictColor = 'var(--green)';
                verdictIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>';
                verdictClass = 'exit-hold';
                verdictDesc = '매도 신호가 약합니다. 추세가 유지되고 있으니 보유하세요.';
            }
        }
        const elId = prefix + (isEntry ? 'Entry' : 'Exit');
        const card = document.getElementById(elId + 'Card');
        if (!card) return;
        card.className = `card ${isEntry?'entry':'exit'}-card ${verdictClass}`;
        const vEl = document.getElementById(elId + 'Verdict');
        if (vEl) vEl.innerHTML = `
            <div class="entry-icon">${verdictIcon}</div>
            <div class="entry-title" style="color:${verdictColor}">${verdict}</div>
            <div class="entry-subtitle">${verdictDesc}</div>
            <div class="entry-conditions-summary">
                <div class="entry-cond-count" style="color:${isEntry?'var(--green)':'var(--red)'}"><span class="num">${passCount}</span> ${isEntry?'충족':'신호'}</div>
                <div class="entry-cond-count" style="color:var(--text3)"><span class="num">${totalChecks-passCount}</span> ${isEntry?'미충족':'미해당'}</div>
                <div class="entry-cond-count" style="color:var(--cyan)"><span class="num">${totalChecks}</span> 전체</div>
            </div>`;
        const mColor = isEntry ? (score>=70?'#3b82f6':score>=40?'#f59e0b':'#ef4444') : (score>=70?'#ef4444':score>=40?'#f59e0b':'#3b82f6');
        const mEl = document.getElementById(elId + 'Meter');
        if (mEl) {
            mEl.innerHTML = `
                <div class="entry-meter-bar"><div class="entry-meter-fill" style="width:0%;background:linear-gradient(90deg,${mColor},${mColor}aa)"></div><div class="entry-meter-pointer" style="left:0%"></div></div>
                <div class="entry-meter-labels"><span>${isEntry?'매수 부적합':'보유 유지'}</span><span>조건부</span><span>${isEntry?'적극 매수':'즉시 매도'}</span></div>`;
            setTimeout(() => {
                const fill = mEl.querySelector('.entry-meter-fill');
                const pointer = mEl.querySelector('.entry-meter-pointer');
                if (fill) fill.style.width = score + '%';
                if (pointer) pointer.style.left = score + '%';
            }, 50);
        }
        const iconMap = { pass: '&#10003;', fail: '&#10007;', warn: '!' };
        const cEl = document.getElementById(elId + 'Checklist');
        if (cEl) cEl.innerHTML = `
            <button class="checklist-toggle-btn" onclick="toggleChecklist(this)"><span class="toggle-label">상세 조건 보기</span><span class="checklist-toggle-arrow">▾</span></button>
            <div class="checklist-body" style="max-height:0;">${checks.map(ck => `
            <div class="entry-check-item"><div class="entry-check-icon ${ck.status}">${iconMap[ck.status]}</div><div class="entry-check-text"><div class="entry-check-label">${ck.label}</div><div class="entry-check-desc">${ck.desc}</div></div></div>`).join('')}
            </div>`;
        const sEl = document.getElementById(elId + 'Strategy');
        if (sEl) sEl.innerHTML = strategyHtml;
    }

    function toggleChecklist(btn) {
        const body = btn.nextElementSibling;
        const lbl  = btn.querySelector('.toggle-label');
        const isOpen = btn.classList.contains('open');
        if (isOpen) {
            body.style.maxHeight = body.scrollHeight + 'px';
            requestAnimationFrame(() => { body.style.maxHeight = '0'; });
            btn.classList.remove('open');
            if (lbl) lbl.textContent = '상세 조건 보기';
        } else {
            body.style.maxHeight = body.scrollHeight + 'px';
            btn.classList.add('open');
            if (lbl) lbl.textContent = '접기';
        }
    }

    // =====================
    // 분할 매수 계산기
    // =====================
    function renderSplitCalc() {
        // 인라인 카드 대신 FAB 패널 사용 — wrap은 비워둠
        const wrap = document.getElementById('splitCalcWrap');
        if (wrap) wrap.innerHTML = '';
    }

    // [Bug-fix] _calcSplit() 제거 — FAB 계산기(_calcSplitFab)로 완전 대체됨
    // 존재하지 않는 DOM ID(calcBudget/calcFirst/calcMode/calcTableBody/calcSummary) 참조하여 crash


    // ========================================