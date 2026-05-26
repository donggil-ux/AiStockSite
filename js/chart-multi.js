// js/chart-multi.js
// 책임: 멀티차트 그리드 (X1/X1-b 사양)
// 의존: state.js, utils.js, chart-core.js

    // Phase X1: 멀티 차트 그리드 (UI 스캐폴딩)
    // 단일 차트 인스턴스 보존 → cell-1만 실제 차트, cell-2는 placeholder
    // 다음 단계 X1-b에서 두 번째 인스턴스 + 셀별 라우팅 활성화 예정
    // ══════════════════════════════════════════════════════════

    function _xcCurrentLayout() {
        return localStorage.getItem('stockai_chart_layout') || '1';
    }

    function _xcOpenLayoutPopover(ev) {
        if (ev) ev.stopPropagation();
        const pop = document.getElementById('chartLayoutPopover');
        if (!pop) return;
        // 모바일은 분할 UI 차단
        if (window.innerWidth <= 768) {
            showToast?.('모바일은 1분할 고정');
            return;
        }
        // 토글
        if (pop.style.display === 'block') { pop.style.display = 'none'; return; }
        // 위치 계산 — 트리거 버튼 아래
        const btn = document.getElementById('cxtSplit');
        if (btn) {
            const r = btn.getBoundingClientRect();
            pop.style.position = 'fixed';
            pop.style.top  = (r.bottom + 6) + 'px';
            pop.style.left = Math.max(8, r.left - 40) + 'px';
        }
        pop.style.display = 'block';
        _xcUpdateLayoutUi();
        // 외부 클릭 시 닫기
        setTimeout(() => {
            document.addEventListener('click', _xcDocClickClose, { once: true, capture: true });
        }, 0);
    }

    function _xcDocClickClose(e) {
        const pop = document.getElementById('chartLayoutPopover');
        const btn = document.getElementById('cxtSplit');
        if (!pop) return;
        if (pop.contains(e.target) || btn?.contains(e.target)) {
            // 내부 클릭 → 다시 리스너 부착
            document.addEventListener('click', _xcDocClickClose, { once: true, capture: true });
            return;
        }
        pop.style.display = 'none';
    }

    function _xcUpdateLayoutUi() {
        const cur       = _xcCurrentLayout();
        const is3Ok     = window.innerWidth > 1280;
        // Active state
        document.querySelectorAll('.clp-opt').forEach(b => {
            b.classList.toggle('active', b.dataset.layout === cur);
            // 3분할 disabled guard
            if (b.dataset.layout?.startsWith('3')) {
                b.disabled = !is3Ok;
                if (!b.dataset.titleSaved) b.dataset.titleSaved = b.title;
                b.title = is3Ok ? b.dataset.titleSaved : '1440px 이상에서 사용 가능';
            }
        });
        // hint text below 3분할 row
        const hint = document.getElementById('clp3Hint');
        if (hint) hint.classList.toggle('visible', !is3Ok);
    }

    /** 레이아웃 적용 — '1' | '2h' | '2v' | '3h' | '3v' | '3lc' | '3tc' */
    function _xcSetLayout(layout) {
        if (window.innerWidth <= 768 && layout !== '1') {
            showToast?.('모바일은 1분할만 지원');
            return;
        }
        if (layout.startsWith('3') && window.innerWidth <= 1280) {
            showToast?.('3분할은 1440px 이상 화면에서 사용 가능합니다');
            return;
        }
        const grid  = document.getElementById('chartGridWrap');
        const cell2 = document.getElementById('chartCell2');
        const cell3 = document.getElementById('chartCell3');
        if (!grid) return;

        const is3 = layout.startsWith('3');
        const is1 = layout === '1';

        grid.setAttribute('data-layout', layout);
        if (cell2) cell2.style.display = is1 ? 'none' : '';
        if (cell3) cell3.style.display = is3 ? '' : 'none';

        try { localStorage.setItem('stockai_chart_layout', layout); } catch(_) {}
        _xcUpdateLayoutUi();

        // Phase X1-b: 셀 차트 인스턴스 생성/삭제
        // currentSymbol이 비어있을 때(페이지 첫 로드)는 인스턴스 생성 보류 → overlay 표시
        if (is1) {
            if (_xcCells['cell2']) _xcDestroyCell('cell2');
            if (_xcCells['cell3']) _xcDestroyCell('cell3');
        } else if (!is3) {
            // 2분할: cell3 삭제, cell2 생성(없으면 + 심볼 있을 때)
            if (_xcCells['cell3']) _xcDestroyCell('cell3');
            if (!_xcCells['cell2'] && currentSymbol) _xcCreateCell('cell2');
        } else {
            // 3분할: cell2·cell3 모두 생성(없으면 + 심볼 있을 때)
            if (!_xcCells['cell2'] && currentSymbol) _xcCreateCell('cell2');
            if (!_xcCells['cell3'] && currentSymbol) _xcCreateCell('cell3');
        }

        // popover 닫기
        const pop = document.getElementById('chartLayoutPopover');
        if (pop) pop.style.display = 'none';

        // 차트 리사이즈 — 셀-1 크기 변경 반영 (lazy)
        setTimeout(() => {
            try {
                const wrap = document.getElementById('tvChartWrap');
                if (wrap && window.lwChart) {
                    window.lwChart.applyOptions({ width: wrap.clientWidth, height: wrap.clientHeight });
                }
            } catch(_) {}
        }, 60);

        // cxtSplit 버튼 active 상태
        const splitBtn = document.getElementById('cxtSplit');
        if (splitBtn) splitBtn.classList.toggle('active', !is1);
    }

    /**
     * 셀 닫기 — 스마트 3→2 재배치
     * cellNum: 닫히는 셀 번호 (2 or 3)
     */
    function _xcCloseCell(cellNum) {
        // Phase X1-b: 닫히는 셀 인스턴스 먼저 정리
        if (cellNum === 2 || cellNum === 3) {
            _xcDestroyCell('cell' + cellNum);
        }

        const cur = _xcCurrentLayout();
        const is3 = cur.startsWith('3');

        if (!is3) {
            // 2분할 → 1분할
            _xcSetLayout('1');
            return;
        }

        // 3분할 → 2분할 (자동 재배치)
        let next;
        switch (cur) {
            case '3h':
                // 좌우 3등분 → 좌우 2분할 (어느 셀 닫아도)
                next = '2h';
                break;
            case '3v':
                // 상하 3등분 → 상하 2분할
                next = '2v';
                break;
            case '3lc':
                // 좌1+우상하: 좌(1) 닫음 → 우상+우하가 상하 2분할로
                //             우(2 or 3) 닫음 → 좌+나머지 우가 좌우 2분할로
                next = (cellNum === 1) ? '2v' : '2h';
                break;
            case '3tc':
                // 상1+하좌우: 상(1) 닫음 → 하좌+하우가 좌우 2분할로
                //             하(2 or 3) 닫음 → 상+나머지 하가 상하 2분할로
                next = (cellNum === 1) ? '2h' : '2v';
                break;
            default:
                next = '2h';
        }
        _xcSetLayout(next);
    }

    /** 새로고침 시 저장된 레이아웃 복원 (모바일 강제 1분할 / 1280px↓ 3분할 fallback) */
    function _xcRestoreLayout() {
        if (window.innerWidth <= 768) { _xcSetLayout('1'); return; }
        const saved = _xcCurrentLayout();
        if (saved === '1') return;
        // 3분할이 저장돼 있지만 뷰포트가 좁은 경우 fallback
        if (saved.startsWith('3') && window.innerWidth <= 1280) {
            _xcSetLayout('2h');
            return;
        }
        _xcSetLayout(saved);
    }

    // ── Phase X1-b: 셀별 차트 인스턴스 함수 ──────────────────────────

    /** 프록시 전역 변수를 지정 셀로 동기화 */
    function _xcSyncGlobals(cellId) {
        const cell = _xcCells[cellId];
        if (!cell) return;
        lwChart           = cell.chart;
        lwCandleSeries    = cell.candleSeries;
        lwVolumeSeries    = cell.volSeries;
        currentSymbol     = cell.symbol;
        currentFullSymbol = cell.fullSymbol;
        currentMarket     = cell.market;
        currentInterval   = cell.tf;
        // stockData 동기화 — 분석 함수들이 !stockData 가드를 통과하도록
        stockData = cell.stockData?.chart?.result?.[0] || cell.stockData || stockData;
    }

    /** 셀 활성화 — 클릭 or 심볼 로드 완료 후 호출 */
    function _xcActivate(cellId) {
        if (!_xcCells[cellId]) {
            // 아직 생성 안 됨 → 생성 후 활성화
            _xcCreateCell(cellId).then(() => _xcActivate(cellId));
            return;
        }
        const prevId = _xcActiveCellId;
        _xcActiveCellId = cellId;
        try { localStorage.setItem('stockai_xc_active', cellId); } catch(_) {}

        // 전역 변수 동기화
        _xcSyncGlobals(cellId);

        // 이전 활성 셀에 비활성 폴 시작
        if (prevId !== cellId && _xcCells[prevId]) {
            _xcStartCellPoll(prevId);
        }
        // 새 활성 셀은 전역 15s 폴로 커버 → 개별 폴 중지
        _xcStopCellPoll(cellId);

        // 활성 셀에 시그널 재빌드 (가격라인 + 배지)
        const cell = _xcCells[cellId];
        if (cell._lastCandleData && cell._lastCandleData.length) {
            _layerDirty = true;
            try {
                const bb = calcBollingerBands(cell._lastQ?.close || [], 4, 2);
                renderChartLiveSignals(cell._lastCandleData, cell._lastTs, cell._lastQ, bb);
            } catch(e) {}
        }

        _xcUpdateCellHeaders();
        _xcUpdateSyncUi();
        _xcSaveState();
    }

    /** 셀에 새 LWChart 인스턴스 생성 + 데이터 로드 */
    async function _xcCreateCell(cellId, opts) {
        opts = opts || {};
        const wrapId = cellId === 'cell2' ? 'tvChartWrap2' : 'tvChartWrap3';
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;

        // 기존 인스턴스 있으면 먼저 삭제
        if (_xcCells[cellId]) _xcDestroyCell(cellId);

        // 설정 결정 — opts > localStorage > 활성 셀
        let symbol     = opts.symbol     || '';
        let fullSymbol = opts.fullSymbol || '';
        let market     = opts.market     || '';
        let tf         = opts.tf         || '';

        if (!symbol) {
            try {
                const saved = JSON.parse(localStorage.getItem('stockai_xc_' + cellId) || 'null');
                if (saved) {
                    symbol     = saved.symbol     || '';
                    fullSymbol = saved.fullSymbol || '';
                    market     = saved.market     || '';
                    tf         = saved.tf         || '';
                }
            } catch(_) {}
        }
        // 그래도 없으면 활성 셀 값 사용
        if (!symbol) symbol     = currentSymbol     || 'SPY';
        if (!fullSymbol) fullSymbol = currentFullSymbol || 'SPY';
        if (!market) market     = currentMarket     || 'US';
        if (!tf)     tf         = currentInterval   || '1d';

        // 차트 DOM 초기화
        wrap.innerHTML = '';

        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const chartBg   = isLight ? '#ffffff' : '#111620';
        const chartText = isLight ? '#6C6C70' : '#8E8E93';
        const chartGrid = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(45,58,77,0.2)';

        const chart = LightweightCharts.createChart(wrap, {
            width:  wrap.clientWidth  || 300,
            height: wrap.clientHeight || 300,
            layout: {
                background: { type: 'solid', color: chartBg },
                textColor: chartText,
                fontSize: 11,
            },
            grid: {
                vertLines: { color: chartGrid },
                horzLines: { color: chartGrid },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: 'rgba(0,128,251,0.3)', width: 1, style: 2 },
                horzLine: { color: 'rgba(0,128,251,0.3)', width: 1, style: 2 },
            },
            rightPriceScale: {
                borderColor: 'rgba(45,58,77,0.3)',
                scaleMargins: { top: 0.05, bottom: 0.25 },
            },
            timeScale: {
                borderColor: 'rgba(45,58,77,0.3)',
                timeVisible: isIntraday(tf),
                secondsVisible: false,
                rightOffset: 5,
                barSpacing: 8,
            },
            localization: {
                locale: 'ko-KR',
                priceFormatter: price =>
                    (market === 'KR') ? Math.round(price).toLocaleString() : price.toFixed(2),
            },
        });

        const candleSeries = chart.addCandlestickSeries({
            upColor: '#ef4444', downColor: '#3b82f6',
            borderUpColor: '#ef4444', borderDownColor: '#3b82f6',
            wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
        });
        const volSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        // 클릭으로 활성화 (차트 캔버스 클릭 시)
        chart.subscribeClick(() => {
            if (_xcActiveCellId !== cellId) _xcActivate(cellId);
        });

        // 십자선 이동 시 OHLC tooltip + 차트 헤더 갱신
        // X3b: 활성 셀 → 다른 셀 브로드캐스트 / 비활성 셀 → 자체 OHLC 바 갱신
        try {
            chart.subscribeCrosshairMove(param => {
                if (_xcActiveCellId !== cellId) {
                    // 비활성 셀: OHLC 바 실시간 갱신
                    if (cellId !== 'cell1') {
                        try {
                            const num = cellId.slice(4);
                            if (param?.time) {
                                const bar2 = param.seriesData?.get(candleSeries);
                                if (bar2?.open != null) {
                                    const cell2r = _xcCells[cellId];
                                    const mkt2 = cell2r?.market || 'US';
                                    const fmt2 = p => p == null ? '—' : (mkt2 === 'KR' ? Math.round(p).toLocaleString() : '$' + p.toFixed(2));
                                    const set2 = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
                                    set2('cell' + num + 'O', fmt2(bar2.open));
                                    set2('cell' + num + 'H', fmt2(bar2.high));
                                    set2('cell' + num + 'L', fmt2(bar2.low));
                                    set2('cell' + num + 'C', fmt2(bar2.close));
                                    const chgEl2 = document.getElementById('cell' + num + 'Chg');
                                    if (chgEl2) chgEl2.textContent = '';
                                }
                            } else {
                                _xcUpdateCellOhlc(cellId); // 마우스 떠날 때 마지막 봉 복원
                            }
                        } catch(_) {}
                    }
                    return;
                }
                try { _onCrosshairMoveOhlc(param); } catch(_) {}
                try { _onCrosshairMoveHeader(param); } catch(_) {}
                _xcBroadcastCrosshair(cellId, param?.time ?? null);
            });
        } catch(_) {}
        // 가시 범위 변경 → 점프 버튼 갱신 + X3a: 시간축 브로드캐스트
        try {
            chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
                if (_xcActiveCellId !== cellId) return;
                try { _onChartVisRangeChange(range); } catch(_) {}
                if (range) _xcBroadcastTimeScale(cellId, range);
            });
        } catch(_) {}

        // 리사이즈 옵저버
        const ro = new ResizeObserver(entries => {
            const c = _xcCells[cellId];
            if (c?.chart && entries[0]) {
                const { width, height } = entries[0].contentRect;
                c.chart.applyOptions({ width, height });
            }
        });
        ro.observe(wrap);

        // 레지스트리 등록
        _xcCells[cellId] = {
            chart, candleSeries, volSeries,
            symbol, fullSymbol, market, tf,
            resizeObserver: ro,
            pollTimer: null,
            stockData: null,
            _lastCandleData: [],
            _lastTs: [],
            _lastQ: null,
        };

        // 데이터 로드
        await _xcLoadCellData(cellId);

        // 비활성 셀은 30s 폴
        if (cellId !== _xcActiveCellId) {
            _xcStartCellPoll(cellId);
        }

        _xcUpdateCellHeaders();
        _xcSaveState();
    }

    /** 셀 인스턴스 삭제 + DOM 정리 */
    function _xcDestroyCell(cellId) {
        const cell = _xcCells[cellId];
        if (!cell) return;

        _xcStopCellPoll(cellId);
        if (cell.resizeObserver) { cell.resizeObserver.disconnect(); cell.resizeObserver = null; }
        if (cell.chart) { try { cell.chart.remove(); } catch(e) {} cell.chart = null; }

        const wrapId = cellId === 'cell2' ? 'tvChartWrap2' : 'tvChartWrap3';
        const wrap = document.getElementById(wrapId);
        if (wrap) {
            wrap.innerHTML = '<div class="xc-activate-overlay" onclick="_xcActivate(\'' + cellId + '\')">'
                + '<div class="xc-act-icon">' + (cellId === 'cell2' ? '⊞' : '⊟') + '</div>'
                + '<div>클릭하여 차트 활성화</div>'
                + '<div class="xc-act-sub">심볼을 헤더에서 변경할 수 있습니다</div>'
                + '</div>';
        }
        // OHLC 바 + 범례 초기화
        const _dNum = cellId.slice(4);
        const _dOhlc = document.getElementById('cell' + _dNum + 'OhlcBar');
        const _dLeg  = document.getElementById('cell' + _dNum + 'Legend');
        if (_dOhlc) _dOhlc.style.display = 'none';
        if (_dLeg)  { _dLeg.innerHTML = ''; _dLeg.classList.remove('cl-collapsed'); }
        const _dBtn = document.getElementById('cell' + _dNum + 'LegendBtn');
        if (_dBtn) _dBtn.textContent = '∧';

        // 이 셀이 활성이었으면 cell1 으로 복귀
        if (_xcActiveCellId === cellId) {
            _xcActiveCellId = 'cell1';
            const c1 = _xcCells['cell1'];
            if (c1) {
                lwChart           = c1.chart;
                lwCandleSeries    = c1.candleSeries;
                lwVolumeSeries    = c1.volSeries;
                currentSymbol     = c1.symbol;
                currentFullSymbol = c1.fullSymbol;
                currentMarket     = c1.market;
                currentInterval   = c1.tf;
            }
        }

        delete _xcCells[cellId];
        _xcUpdateCellHeaders();
        _xcUpdateSyncUi();
        _xcSaveState();
    }

    /** 특정 셀의 Yahoo Finance 데이터 로드 + 차트 렌더 */
    async function _xcLoadCellData(cellId) {
        const cell = _xcCells[cellId];
        if (!cell || !cell.fullSymbol) return;

        // 로딩 상태 표시
        const _cellEl = document.getElementById('chartCell' + cellId.slice(4)); // 'cell2' → 'chartCell2'
        if (_cellEl) _cellEl.classList.add('xc-loading');

        const { candleSeries, volSeries, fullSymbol, tf } = cell;
        // Yahoo Finance range limits: 5m/15m/30m → max 1mo, 1h → max 2y, 1d+ → 6mo
        const period = (tf === '5m' || tf === '15m' || tf === '30m') ? '1mo'
                     : (tf === '1h') ? '1y'
                     : '6mo';

        try {
            const url = '/api/chart/' + encodeURIComponent(fullSymbol)
                + '?range=' + period + '&interval=' + tf + '&includePrePost=true';
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();

            const result = data?.chart?.result?.[0];
            const ts = result?.timestamp;
            const q  = result?.indicators?.quote?.[0];
            if (!ts || !q) {
                if (_cellEl) _cellEl.classList.remove('xc-loading');
                return;
            }

            const candleData = [], volumeData = [];
            for (let i = 0; i < ts.length; i++) {
                const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
                if (o == null || h == null || l == null || c == null) continue;
                candleData.push({ time: ts[i], open: o, high: h, low: l, close: c });
                volumeData.push({
                    time: ts[i], value: v || 0,
                    color: c >= o ? 'rgba(255,69,58,0.25)' : 'rgba(0,128,251,0.25)',
                });
            }

            candleSeries.setData(candleData);
            volSeries.setData(volumeData);
            cell.chart.timeScale().fitContent();

            cell.stockData       = data;
            cell._lastCandleData = candleData;
            cell._lastTs         = ts;
            cell._lastQ          = q;
            if (_cellEl) _cellEl.classList.remove('xc-loading');
        } catch(e) {
            if (_cellEl) _cellEl.classList.remove('xc-loading');
            warn('[xc] loadCellData ' + cellId + ' fail:', e.message);
        }
    }

    /** 비활성 셀 30s 폴링 — 최신 캔들만 업데이트 */
    function _xcStartCellPoll(cellId) {
        const cell = _xcCells[cellId];
        if (!cell) return;
        _xcStopCellPoll(cellId);
        cell.pollTimer = setInterval(async () => {
            if (cellId === _xcActiveCellId) return;
            if (document.hidden) return;
            const c = _xcCells[cellId];
            if (!c || !c.candleSeries || !c.fullSymbol) return;
            try {
                const url = '/api/chart/' + encodeURIComponent(c.fullSymbol)
                    + '?range=1d&interval=' + c.tf + '&includePrePost=true';
                const resp = await fetch(url);
                if (!resp.ok) return;
                const data = await resp.json();
                const _r2  = data?.chart?.result?.[0];
                const ts2  = _r2?.timestamp;
                const q2   = _r2?.indicators?.quote?.[0];
                if (!ts2?.length || !q2) return;
                const i = ts2.length - 1;
                const bar = {
                    time: ts2[i],
                    open: q2.open[i], high: q2.high[i],
                    low:  q2.low[i],  close: q2.close[i],
                };
                if (bar.close != null) c.candleSeries.update(bar);
            } catch(_) {}
        }, 30000);
    }

    /** 비활성 셀 폴 중지 */
    function _xcStopCellPoll(cellId) {
        const cell = _xcCells[cellId];
        if (!cell || !cell.pollTimer) return;
        clearInterval(cell.pollTimer);
        cell.pollTimer = null;
    }

    /** 각 셀 헤더(심볼·TF)와 active 클래스 갱신 */
    function _xcUpdateCellHeaders() {
        // active 클래스
        document.querySelectorAll('.chart-cell').forEach(el => el.classList.remove('active'));
        const activeNum = _xcActiveCellId.replace('cell', '');
        const activeEl  = document.querySelector('.chart-cell-' + activeNum);
        if (activeEl) activeEl.classList.add('active');

        // cell1 헤더 (분할 모드에서만 표시)
        const c1   = _xcCells['cell1'];
        const sym1El = document.getElementById('cell1Symbol');
        const tf1El  = document.getElementById('cell1Tf');
        const hdr1El = document.getElementById('cell1Header');
        const isMultiCell = Object.keys(_xcCells).length > 1;
        if (sym1El) sym1El.textContent = c1?.symbol || '—';
        if (tf1El)  tf1El.textContent  = c1?.tf     || '—';
        if (hdr1El) hdr1El.style.display = isMultiCell ? 'flex' : 'none';
        _xcUpdateCellOhlc('cell1');

        // cell2 헤더
        const c2 = _xcCells['cell2'];
        const sym2El = document.getElementById('cell2Symbol');
        const tf2El  = document.getElementById('cell2Tf');
        if (sym2El) sym2El.textContent = c2?.symbol || '—';
        if (tf2El)  tf2El.textContent  = c2?.tf     || '—';
        _xcUpdateCellOhlc('cell2');

        // cell3 헤더
        const c3 = _xcCells['cell3'];
        const sym3El = document.getElementById('cell3Symbol');
        const tf3El  = document.getElementById('cell3Tf');
        if (sym3El) sym3El.textContent = c3?.symbol || '—';
        if (tf3El)  tf3El.textContent  = c3?.tf     || '—';
        _xcUpdateCellOhlc('cell3');
    }

    /** OHLC 바를 cell._lastQ 의 마지막 봉으로 채우기 */
    function _xcUpdateCellOhlc(cellId) {
        const num = cellId.slice(4); // 'cell2' → '2'
        const cell = _xcCells[cellId];
        const bar  = document.getElementById('cell' + num + 'OhlcBar');
        const leg  = document.getElementById('cell' + num + 'Legend');
        if (!bar) return;
        if (!cell || !cell._lastQ) { bar.style.display = 'none'; return; }

        const q = cell._lastQ;
        const mkt = cell.market;
        const fmt = p => p == null ? '—' : (mkt === 'KR' ? Math.round(p).toLocaleString() : '$' + p.toFixed(2));
        // 마지막 유효 인덱스
        let idx = (q.close || []).length - 1;
        while (idx > 0 && q.close[idx] == null) idx--;

        const O = q.open?.[idx], H = q.high?.[idx], L = q.low?.[idx], C = q.close?.[idx];
        const prevC = idx > 0 ? q.close?.[idx - 1] : null;

        bar.style.display = 'flex';
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('cell' + num + 'O', fmt(O));
        set('cell' + num + 'H', fmt(H));
        set('cell' + num + 'L', fmt(L));
        set('cell' + num + 'C', fmt(C));

        const chgEl = document.getElementById('cell' + num + 'Chg');
        if (chgEl && C != null && prevC != null && prevC !== 0) {
            const chg = (C - prevC) / prevC * 100;
            chgEl.textContent = ' (' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%)';
            chgEl.style.color = chg >= 0 ? '#ef4444' : '#3b82f6';
        } else if (chgEl) {
            chgEl.textContent = '';
        }

        // 지표 범례 채우기 (EMA + BB)
        if (leg) _xcFillCellLegend(leg, q, mkt, idx);
    }

    /** 지표 범례 HTML 생성 */
    function _xcFillCellLegend(legEl, q, mkt, idx) {
        try {
            const fmt = p => p == null ? '—' : (mkt === 'KR' ? Math.round(p).toLocaleString() : '$' + p.toFixed(2));
            const rows = [];
            // EMA
            try {
                const e20 = calcEMA(q.close, 20);
                const e50 = calcEMA(q.close, 50);
                const v20 = e20[idx], v50 = e50[idx];
                if (v20 != null || v50 != null) {
                    rows.push(
                        '<div class="cl-row">' +
                        '<span class="cl-swatch" style="background:#22C55E;"></span>' +
                        '<span class="cl-name">이동평균선</span>' +
                        '<span class="cl-vals">' +
                        (v20 != null ? '<span class="cl-kv"><span class="cl-k">20</span><span class="cl-v" style="color:#22C55E">' + fmt(v20) + '</span></span>' : '') +
                        (v50 != null ? '<span class="cl-kv"><span class="cl-k">50</span><span class="cl-v" style="color:#f59e0b">' + fmt(v50) + '</span></span>' : '') +
                        '</span></div>'
                    );
                }
            } catch(_) {}
            // BB
            try {
                const bb = calcBollingerBands(q.close, 20, 2);
                const mid = bb.middle?.[idx], up = bb.upper?.[idx], lo = bb.lower?.[idx];
                if (mid != null) {
                    rows.push(
                        '<div class="cl-row">' +
                        '<span class="cl-swatch" style="background:#818CF8;"></span>' +
                        '<span class="cl-name">볼린저 밴드</span>' +
                        '<span class="cl-vals">' +
                        '<span class="cl-kv"><span class="cl-k">중심</span><span class="cl-v">' + fmt(mid) + '</span></span>' +
                        '<span class="cl-kv"><span class="cl-k">상단</span><span class="cl-v" style="color:#ef4444">' + fmt(up) + '</span></span>' +
                        '<span class="cl-kv"><span class="cl-k">하단</span><span class="cl-v" style="color:#3b82f6">' + fmt(lo) + '</span></span>' +
                        '</span></div>'
                    );
                }
            } catch(_) {}
            legEl.innerHTML = rows.join('');
        } catch(_) { legEl.innerHTML = ''; }
    }

    /** 범례 접기/펼치기 토글 */
    function _xcToggleLegend(cellId) {
        const num = cellId.slice(4);
        const leg = document.getElementById('cell' + num + 'Legend');
        const btn = document.getElementById('cell' + num + 'LegendBtn');
        if (!leg) return;
        const collapsed = leg.classList.toggle('cl-collapsed');
        if (btn) btn.textContent = collapsed ? '∨' : '∧';
    }

    /** 멀티차트 전체 상태 localStorage 저장 */
    function _xcSaveState() {
        try {
            const cells = [];
            ['cell1', 'cell2', 'cell3'].forEach(id => {
                const c = _xcCells[id];
                if (c) cells.push({ id, symbol: c.symbol, fullSymbol: c.fullSymbol, market: c.market, tf: c.tf });
            });
            localStorage.setItem('stockai_multichart_state', JSON.stringify({
                layout:       _xcCurrentLayout(),
                activeCellId: _xcActiveCellId,
                cells,
            }));
        } catch(_) {}
    }

    // ── Phase X3: 멀티차트 동기화 ─────────────────────────────────────

    /** 동기화 설정 localStorage 저장 */
    function _xcSaveSyncState() {
        try {
            localStorage.setItem('stockai_xc_sync', JSON.stringify({
                timeScale: _xcSyncTimeScale,
                crosshair: _xcSyncCrosshair,
                symbol:    _xcSyncSymbol,
            }));
        } catch(_) {}
    }

    /** 동기화 popover 열기/닫기 */
    function _xcOpenSyncPopover(ev) {
        ev?.stopPropagation();
        const pop = document.getElementById('xcSyncPopover');
        if (!pop) return;
        const isOpen = pop.style.display !== 'none';
        document.querySelectorAll('.xc-sync-popover, .chart-layout-popover').forEach(p => p.style.display = 'none');
        if (!isOpen) {
            _xcUpdateSyncUi();
            pop.style.display = '';
            // 외부 클릭 시 닫기
            setTimeout(() => {
                document.addEventListener('click', _xcSyncDocClose, { once: true, capture: true });
            }, 0);
        }
    }

    function _xcSyncDocClose(e) {
        const pop = document.getElementById('xcSyncPopover');
        const btn = document.getElementById('cxtSync');
        if (!pop) return;
        if (pop.contains(e.target) || btn?.contains(e.target)) {
            document.addEventListener('click', _xcSyncDocClose, { once: true, capture: true });
            return;
        }
        pop.style.display = 'none';
    }

    /** 동기화 토글 + 즉시 적용 */
    function _xcToggleSync(type) {
        if (type === 'timeScale') {
            _xcSyncTimeScale = !_xcSyncTimeScale;
            if (_xcSyncTimeScale) {
                // ON → 활성 셀의 현재 범위를 모든 셀에 적용
                try {
                    const r = window.lwChart?.timeScale()?.getVisibleLogicalRange();
                    if (r) _xcBroadcastTimeScale(_xcActiveCellId, r);
                } catch(_) {}
            }
        } else if (type === 'crosshair') {
            _xcSyncCrosshair = !_xcSyncCrosshair;
            if (!_xcSyncCrosshair) {
                // OFF → 모든 비활성 셀 십자선 클리어
                Object.entries(_xcCells).forEach(([id, cell]) => {
                    if (id !== _xcActiveCellId) try { cell.chart?.clearCrosshairPosition?.(); } catch(_) {}
                });
            }
        } else if (type === 'symbol') {
            _xcSyncSymbol = !_xcSyncSymbol;
            if (_xcSyncSymbol) {
                // ON → 활성 셀 종목으로 모든 셀 통일
                _xcBroadcastSymbol(_xcActiveCellId);
            }
        }
        _xcSaveSyncState();
        _xcUpdateSyncUi();
    }

    /** 동기화 UI (dot + 힌트 섹션) 갱신 */
    function _xcUpdateSyncUi() {
        const cellCount = Object.keys(_xcCells).length;
        const hasMulti  = cellCount > 1;
        const sec  = document.getElementById('xcSyncSection');
        const hint = document.getElementById('xcSyncHint');
        if (sec)  sec.style.display  = hasMulti ? '' : 'none';
        if (hint) hint.style.display = hasMulti ? 'none' : '';

        const vals = { timeScale: _xcSyncTimeScale, crosshair: _xcSyncCrosshair, symbol: _xcSyncSymbol };
        Object.entries(vals).forEach(([k, v]) => {
            const el = document.getElementById('xcSync_' + k);
            if (!el) return;
            el.textContent = v ? '⬤' : '◯';
            el.style.color = v ? '#0080FB' : '';
        });
        // toolbar 버튼 active 표시
        const btn = document.getElementById('cxtSync');
        if (btn) btn.classList.toggle('active', _xcSyncTimeScale || _xcSyncCrosshair || _xcSyncSymbol);
    }

    /** X3a: 활성 셀 → 모든 셀에 visibleLogicalRange 동기화 */
    function _xcBroadcastTimeScale(sourceId, range) {
        if (!_xcSyncTimeScale || !range) return;
        requestAnimationFrame(() => {
            Object.entries(_xcCells).forEach(([id, cell]) => {
                if (id === sourceId || !cell.chart) return;
                try { cell.chart.timeScale().setVisibleLogicalRange(range); } catch(_) {}
            });
        });
    }

    /** X3b: 활성 셀 crosshair 시간 → 다른 셀에 같은 시간 위치 setCrosshairPosition */
    function _xcBroadcastCrosshair(sourceId, time) {
        if (!_xcSyncCrosshair) return;
        const now = Date.now();
        if (now - _xcCrosshairSyncLast < 16) return; // 60fps throttle
        _xcCrosshairSyncLast = now;

        Object.entries(_xcCells).forEach(([id, cell]) => {
            if (id === sourceId || !cell.chart || !cell.candleSeries) return;
            try {
                if (time == null) {
                    cell.chart.clearCrosshairPosition?.();
                    return;
                }
                const ts = cell._lastTs;
                const q  = cell._lastQ;
                if (!ts?.length || !q) return;
                const idx = _xcFindClosestIdx(ts, time);
                if (idx < 0) return;
                const price = q.close?.[idx];
                if (price == null) return;
                cell.chart.setCrosshairPosition?.(price, ts[idx], cell.candleSeries);
            } catch(_) {}
        });
    }

    /** 가장 가까운 timestamp의 인덱스를 이진탐색으로 반환 */
    function _xcFindClosestIdx(ts, targetTime) {
        if (!ts?.length) return -1;
        let lo = 0, hi = ts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (ts[mid] < targetTime) lo = mid + 1;
            else hi = mid;
        }
        if (lo > 0 && Math.abs(ts[lo - 1] - targetTime) < Math.abs(ts[lo] - targetTime)) lo--;
        return lo;
    }

    /** X3c: 활성 셀 종목 → 모든 셀에 동일 종목으로 데이터 재로드 */
    async function _xcBroadcastSymbol(sourceId) {
        const src = _xcCells[sourceId];
        if (!src) return;
        const { symbol, fullSymbol, market } = src;

        const targets = Object.entries(_xcCells).filter(([id]) => id !== sourceId);
        await Promise.all(targets.map(async ([id, cell]) => {
            cell.symbol     = symbol;
            cell.fullSymbol = fullSymbol;
            cell.market     = market;
            try {
                cell.chart?.applyOptions({
                    localization: {
                        locale: 'ko-KR',
                        priceFormatter: p => (market === 'KR') ? Math.round(p).toLocaleString() : p.toFixed(2),
                    },
                });
            } catch(_) {}
            await _xcLoadCellData(id);
            try {
                localStorage.setItem('stockai_xc_' + id,
                    JSON.stringify({ symbol, fullSymbol, market, tf: cell.tf }));
            } catch(_) {}
        }));
        _xcUpdateCellHeaders();
        _xcSaveState();
    }

    /** 셀 심볼 변경 (prompt 다이얼로그) */
    // ── 분할차트 종목 선택 커스텀 모달 ──────────────────────────
    let _xcPendingCellId = null;
    let _xcSymDebounce   = null;

    function _xcPromptSymbol(cellId) {
        _xcPendingCellId = cellId;
        const modal = document.getElementById('xcSymbolModal');
        if (!modal) { _xcPromptSymbolFallback(cellId); return; }
        modal.style.display = '';
        setTimeout(() => {
            const inp = document.getElementById('xcSymbolInput');
            if (inp) { inp.value = ''; inp.focus(); }
            _xcRenderSymbolResults(null);
        }, 80);
    }

    function _xcCloseSymbolModal() {
        const modal = document.getElementById('xcSymbolModal');
        if (modal) modal.style.display = 'none';
        const inp = document.getElementById('xcSymbolInput');
        if (inp) inp.value = '';
        _xcPendingCellId = null;
    }

    function _xcSymbolSearch(q) {
        clearTimeout(_xcSymDebounce);
        _xcSymDebounce = setTimeout(() => {
            if (!q.trim()) { _xcRenderSymbolResults(null); return; }
            let results = [];
            try { results = (typeof searchSuggest === 'function') ? searchSuggest(q.trim(), 10) : []; } catch(_) {}
            _xcRenderSymbolResults(results, q.trim());
            // 로컬 결과 없으면 서버 검색
            if (!results.length) {
                fetch('/api/search?q=' + encodeURIComponent(q.trim()))
                    .then(r => r.json())
                    .then(list => {
                        if (!Array.isArray(list)) return;
                        const mapped = list.map(item => ({
                            ticker: item.symbol || item.ticker || '',
                            name:   item.shortname || item.longname || item.name || '',
                            koreanName: item.koreanName || '',
                            market: /\.(KS|KQ)$/i.test(item.symbol||'') ? 'KR' : 'US',
                            type:   item.quoteType || '',
                        }));
                        const cur = document.getElementById('xcSymbolInput')?.value.trim();
                        if (cur === q.trim()) _xcRenderSymbolResults(mapped, q.trim());
                    }).catch(()=>{});
            }
        }, 220);
    }

    function _xcSymbolKeydown(e) {
        const items = document.querySelectorAll('#xcSymbolResults .sdrop-item');
        let idx = [...items].findIndex(el => el.classList.contains('highlighted'));
        if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            const active = document.querySelector('#xcSymbolResults .sdrop-item.highlighted') || items[0];
            if (active) active.click();
            return;
        } else if (e.key === 'Escape') { _xcCloseSymbolModal(); return; }
        items.forEach(el => el.classList.remove('highlighted'));
        if (items[idx]) { items[idx].classList.add('highlighted'); items[idx].scrollIntoView({ block: 'nearest' }); }
    }

    function _xcRenderSymbolResults(results, q) {
        const el = document.getElementById('xcSymbolResults');
        if (!el) return;
        if (!results) {
            // 빈 상태 — 최근 검색 표시
            let html = '';
            try {
                const recent = JSON.parse(localStorage.getItem('stockai_recent_search') || '[]');
                if (recent.length) {
                    html += '<div class="mob-toss-section"><div class="mob-toss-section-hdr"><span class="mob-toss-section-title">최근 검색</span></div><div class="mob-toss-chips">';
                    html += recent.slice(0, 10).map(r => {
                        const sym = String(r.symbol||'').replace(/[<>"']/g,'');
                        const mkt = r.market || 'US';
                        return `<div class="mob-toss-chip sdrop-item" data-ticker="${sym}" data-market="${mkt}">${sym}</div>`;
                    }).join('');
                    html += '</div></div>';
                }
            } catch(_) {}
            if (!html) html = '<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px;">종목 심볼 또는 이름을 입력하세요</div>';
            el.innerHTML = html;
        } else if (!results.length) {
            el.innerHTML = `<div style="padding:32px 16px;text-align:center;"><div style="font-size:13px;font-weight:700;color:var(--text1);margin-bottom:6px;">검색 결과가 없습니다.</div><div style="font-size:12px;color:var(--text3);">티커 심볼로 검색해 주세요<br><span style="color:var(--blue);font-weight:600;">예: AAPL, TSLA, 005930</span></div></div>`;
        } else {
            const esc = s => String(s||'').replace(/[<>"']/g,'');
            el.innerHTML = '<div class="mob-toss-section"><div class="mob-toss-section-hdr"><span class="mob-toss-section-title">검색 결과</span></div><div class="mob-toss-trending-list">' +
                results.map(item => {
                    const name = item.koreanName && item.koreanName !== item.ticker ? item.koreanName : (item.name || item.ticker);
                    const mkt  = item.market || 'US';
                    const badge = `<span style="font-size:10px;padding:1px 5px;border-radius:4px;background:${mkt==='KR'?'rgba(239,68,68,.15)':'rgba(59,130,246,.15)'};color:${mkt==='KR'?'#ef4444':'#3b82f6'};font-weight:700;">${mkt}</span>`;
                    return `<div class="mob-toss-trending-item sdrop-item" data-ticker="${esc(item.ticker)}" data-market="${esc(mkt)}"><div class="mob-toss-trending-info"><span class="mob-toss-trending-name">${esc(name)}</span><span class="mob-toss-trending-ticker">${esc(item.ticker)}</span></div>${badge}</div>`;
                }).join('') +
            '</div></div>';
        }
        el.querySelectorAll('.sdrop-item').forEach(row => {
            row.addEventListener('click', () => {
                const ticker = row.dataset.ticker;
                const market = row.dataset.market || 'US';
                if (ticker) _xcApplySymbolToCell(ticker, market);
            });
        });
    }

    async function _xcApplySymbolToCell(ticker, market) {
        const cellId = _xcPendingCellId;
        _xcCloseSymbolModal();
        if (!cellId || !ticker) return;

        const isKR    = market === 'KR';
        const fullSym = isKR ? ticker.toUpperCase() : ticker.toUpperCase();
        const shortSym = fullSym.replace(/\.(KS|KQ)$/i, '');
        const tf      = _xcCells[cellId]?.tf || currentInterval || '1d';
        const cell    = _xcCells[cellId];

        if (cell) {
            cell.symbol     = shortSym;
            cell.fullSymbol = fullSym;
            cell.market     = market;
            try {
                cell.chart.applyOptions({
                    localization: {
                        locale: 'ko-KR',
                        priceFormatter: price => isKR ? Math.round(price).toLocaleString() : price.toFixed(2),
                    },
                });
            } catch(_) {}
            await _xcLoadCellData(cellId);
        } else {
            await _xcCreateCell(cellId, { symbol: shortSym, fullSymbol: fullSym, market, tf });
        }

        try {
            localStorage.setItem('stockai_xc_' + cellId,
                JSON.stringify({ symbol: shortSym, fullSymbol: fullSym, market, tf }));
        } catch(_) {}

        if (_xcSyncSymbol && cellId === _xcActiveCellId) {
            await _xcBroadcastSymbol(cellId);
        }
        _xcUpdateCellHeaders();
        _xcSaveState();
    }

    async function _xcPromptSymbolFallback(cellId) {
        const cell = _xcCells[cellId];
        const input = window.prompt('종목 심볼 입력\n예: AAPL · NVDA · 005930.KS', cell?.symbol || '');
        if (!input?.trim()) return;
        const raw  = input.trim();
        const isKR = /\.(KS|KQ)$/i.test(raw);
        await _xcApplySymbolToCell(raw.toUpperCase().replace(/\.(KS|KQ)$/i,''), isKR ? 'KR' : 'US');
    }

    // 모바일에서 그리드 트리거 버튼 hide
    function _xcApplyMobileVisibility() {
        const splitBtn = document.getElementById('cxtSplit');
        if (splitBtn) splitBtn.style.display = (window.innerWidth <= 768) ? 'none' : '';
    }

    function _ohlcFmtPrice(p) {
        if (p == null || !isFinite(p)) return '—';
        return (window.currentMarket === 'KR')
            ? Math.round(p).toLocaleString()
            : Number(p).toFixed(2);
    }
    function _ohlcFmtVol(n) {
        if (n == null || !isFinite(n)) return '—';
        if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
        if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
        return String(Math.round(n));
    }

    function _onCrosshairMoveOhlc(param) {
        const t = document.getElementById('chartOhlcTooltip');
        if (!t) return;
        if (!param || !param.point || param.time == null) {
            t.style.display = 'none';
            return;
        }
        const tsArr = window._lastSigArgs?.ts || [];
        const q = window._lastSigArgs?.q || {};
        const idx = tsArr.indexOf(param.time);
        if (idx < 0) { t.style.display = 'none'; return; }

        const o = q.open?.[idx], h = q.high?.[idx], l = q.low?.[idx], c = q.close?.[idx];
        const v = q.volume?.[idx];
        if (c == null) { t.style.display = 'none'; return; }
        const prevC = q.close?.[idx-1];
        const prevV = q.volume?.[idx-1];
        const chg = (prevC != null) ? (c - prevC) : 0;
        const chgPct = (prevC != null && prevC) ? (chg / prevC * 100) : 0;
        const isUp = chg >= 0;
        const upColor = '#EF4444';   // 한국 관례: 상승 빨강
        const dnColor = '#3B82F6';   // 하락 파랑
        const sigColor = isUp ? upColor : dnColor;

        const date = new Date(param.time * 1000);
        const weekdays = ['일','월','화','수','목','금','토'];
        const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} (${weekdays[date.getDay()]})`;

        t.querySelector('.cot-date').textContent = dateStr;
        t.querySelector('.cot-o').textContent = _ohlcFmtPrice(o);
        t.querySelector('.cot-h').textContent = _ohlcFmtPrice(h);
        t.querySelector('.cot-l').textContent = _ohlcFmtPrice(l);
        const cEl = t.querySelector('.cot-c');
        cEl.textContent = _ohlcFmtPrice(c);
        cEl.style.color = sigColor;

        const chgEl = t.querySelector('.cot-chg');
        if (prevC != null) {
            const sign = isUp ? '+' : '';
            chgEl.textContent = `${isUp?'▲':'▼'} ${sign}${chg.toFixed(2)} (${sign}${chgPct.toFixed(2)}%)`;
            chgEl.style.color = sigColor;
            chgEl.style.display = '';
        } else {
            chgEl.style.display = 'none';
        }

        const volRow = t.querySelector('.cot-vol-row');
        if (v != null) {
            t.querySelector('.cot-vol').textContent = _ohlcFmtVol(v);
            const volChgEl = t.querySelector('.cot-vol-chg');
            if (prevV != null && prevV) {
                const vChgPct = (v - prevV) / prevV * 100;
                const vUp = vChgPct >= 0;
                volChgEl.textContent = `(전일 대비 ${vUp?'+':''}${vChgPct.toFixed(0)}%)`;
                volChgEl.style.color = vUp ? '#22C55E' : '#94A3B8';
            } else {
                volChgEl.textContent = '';
            }
            volRow.style.display = '';
        } else {
            volRow.style.display = 'none';
        }

        t.style.display = 'block';
    }

    // ══════════════════════════════════════════════════════════
    // Phase C-3: Shift + Drag 영역 줌