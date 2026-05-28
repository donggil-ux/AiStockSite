// js/chart-interaction.js
// 책임: 차트 상호작용 (십자선, 드래그 줌, 단축키)
// 의존: state.js, utils.js, chart-core.js

    // Phase C-3: Shift + Drag 영역 줌
    // ══════════════════════════════════════════════════════════

    let _shiftDragHooked = false;
    let _zoomDragState   = null;

    function _initShiftDragZoom() {
        if (_shiftDragHooked) return;
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap) return;
        _shiftDragHooked = true;

        // mousedown: shift 키 누른 상태 → 영역 선택 시작 (capture phase로 차트 pan 차단)
        wrap.addEventListener('mousedown', (e) => {
            if (!e.shiftKey || e.button !== 0) return;
            const rect = wrap.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < 0 || x > rect.width) return;
            e.preventDefault();
            e.stopPropagation();
            // 차트 native pan 차단을 위해 handleScroll 임시 비활성
            try { window.lwChart?.applyOptions?.({ handleScroll: false, handleScale: false }); } catch(_) {}
            const sel = document.getElementById('chartZoomSelection');
            if (!sel) return;
            _zoomDragState = { startX: x, currentX: x, wrapRect: rect };
            sel.style.display = 'block';
            sel.style.left  = x + 'px';
            sel.style.width = '0px';
            const info = sel.querySelector('.chart-zoom-info');
            if (info) info.textContent = '';
        }, true);

        document.addEventListener('mousemove', (e) => {
            if (!_zoomDragState) return;
            const r = _zoomDragState.wrapRect;
            const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
            _zoomDragState.currentX = x;
            const sel = document.getElementById('chartZoomSelection');
            if (!sel) return;
            const left = Math.min(_zoomDragState.startX, x);
            const w = Math.abs(x - _zoomDragState.startX);
            sel.style.left  = left + 'px';
            sel.style.width = w + 'px';
            // 봉 수 표시
            try {
                const ts = window.lwChart?.timeScale?.();
                const info = sel.querySelector('.chart-zoom-info');
                if (ts && info) {
                    const fromL = ts.coordinateToLogical(left);
                    const toL   = ts.coordinateToLogical(left + w);
                    if (fromL != null && toL != null) {
                        const bars = Math.max(0, Math.round(toL - fromL));
                        info.textContent = `${bars}봉`;
                    }
                }
            } catch(_) {}
        });

        document.addEventListener('mouseup', () => {
            if (!_zoomDragState) return;
            const { startX, currentX } = _zoomDragState;
            const sel = document.getElementById('chartZoomSelection');
            const width = Math.abs(currentX - startX);
            try { window.lwChart?.applyOptions?.({ handleScroll: true, handleScale: true }); } catch(_) {}
            if (width < 5) {
                if (sel) sel.style.display = 'none';
                _zoomDragState = null;
                return;
            }
            const left  = Math.min(startX, currentX);
            const right = Math.max(startX, currentX);
            try {
                const ts = window.lwChart.timeScale();
                const fromL = ts.coordinateToLogical(left);
                const toL   = ts.coordinateToLogical(right);
                if (fromL != null && toL != null && toL - fromL >= 1) {
                    if (typeof _cnbDeactivatePreset === 'function') _cnbDeactivatePreset();
                    _cnbProgrammaticRangeChange = true;
                    ts.setVisibleLogicalRange({ from: fromL, to: toL });
                    setTimeout(() => { _cnbProgrammaticRangeChange = false; }, 200);
                }
            } catch(e) { warn('[shiftZoom]', e); }
            if (sel) sel.style.display = 'none';
            _zoomDragState = null;
        });

        // Shift 떼면 즉시 취소
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift' && _zoomDragState) {
                try { window.lwChart?.applyOptions?.({ handleScroll: true, handleScale: true }); } catch(_) {}
                const sel = document.getElementById('chartZoomSelection');
                if (sel) sel.style.display = 'none';
                _zoomDragState = null;
            }
        });
    }

    // ══════════════════════════════════════════════════════════
    // Phase C-4: 키보드 단축키
    // ══════════════════════════════════════════════════════════

    let _chartKbdHooked = false;
    const _PRESET_BY_KEY = { '1':'1D', '2':'5D', '3':'1M', '4':'3M', '5':'6M', '6':'1Y', '7':'ALL' };

    function _initChartKeyboardShortcuts() {
        if (_chartKbdHooked) return;
        _chartKbdHooked = true;
        window.addEventListener('keydown', (e) => {
            // M5: 모바일(터치 환경)에서는 키보드 단축키 비활성
            if ('ontouchstart' in window && window.innerWidth <= 600) return;
            // 입력 컴포넌트 포커스 시 비활성
            const ae = document.activeElement;
            const tag = (ae?.tagName || '').toLowerCase();
            if (['input','textarea','select'].includes(tag) || ae?.isContentEditable) return;
            // 차트 카드가 보이지 않으면 무시 (다른 화면 우선)
            const card = document.getElementById('tvChartCard');
            if (!card || card.offsetParent === null) return;
            // 모달/사이드시트 열려있으면 무시
            if (document.querySelector('.gh-sheet.show, #ghSheet')) return;
            // 메타키 조합은 무시 (브라우저 기본 동작 보호)
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            switch (e.key) {
                case 'ArrowLeft':  _cnbPan?.(-10);            e.preventDefault(); break;
                case 'ArrowRight': _cnbPan?.(10);             e.preventDefault(); break;
                case '+': case '=': _cnbZoom?.(0.8);          e.preventDefault(); break;
                case '-': case '_': _cnbZoom?.(1.25);         e.preventDefault(); break;
                case 'End':       _chartJumpToLatest?.();     e.preventDefault(); break;
                case 'Home':      _cnbReset?.();              e.preventDefault(); break;
                case 'Escape':    {
                    // 십자선 강제 숨김 + 진행중 드래그 취소
                    const t = document.getElementById('chartOhlcTooltip');
                    if (t) t.style.display = 'none';
                    if (_zoomDragState) {
                        try { window.lwChart?.applyOptions?.({ handleScroll: true, handleScale: true }); } catch(_) {}
                        const sel = document.getElementById('chartZoomSelection');
                        if (sel) sel.style.display = 'none';
                        _zoomDragState = null;
                    }
                    break;
                }
                default:
                    if (_PRESET_BY_KEY[e.key] != null) {
                        _cnbSetPreset?.(_PRESET_BY_KEY[e.key]);
                        e.preventDefault();
                    }
            }
        });
    }

    // ── 새로고침 후 전체화면 상태 복원 ─────────────────────────────
    function _restoreFullscreenState() {
        if (localStorage.getItem('stockai_chart_fullscreen') !== '1') return;
        const card = document.getElementById('tvChartCard');
        if (!card) return;
        const tryRestore = (attempt) => {
            if (!lwChart) {
                if (attempt < 20) setTimeout(() => tryRestore(attempt + 1), 200);
                return;
            }
            const iconExpand = document.getElementById('tvFsIconExpand');
            const iconShrink = document.getElementById('tvFsIconShrink');
            card.classList.add('fullscreen');
            if (iconExpand) iconExpand.style.display = 'none';
            if (iconShrink) iconShrink.style.display = '';
            // 라벨과 버튼 title 도 동기화 (이전 버전에서 누락)
            const lbl = document.getElementById('tvFsLabel');
            if (lbl) lbl.textContent = '작게보기';
            const btn = document.getElementById('cxtFullscreen');
            if (btn) btn.title = '작게보기';
            document.body.style.overflow = 'hidden';
            setTimeout(() => {
                const wrap = document.getElementById('tvChartWrap');
                if (!wrap || !lwChart) return;
                let h = wrap.clientHeight;
                if (h < 200) {
                    const toolbar = document.getElementById('chartToolbar');
                    h = Math.max(200, card.clientHeight - (toolbar ? toolbar.offsetHeight : 0));
                }
                lwChart.applyOptions({ width: wrap.clientWidth, height: h });
            }, 400);
        };
        setTimeout(() => tryRestore(0), 500);
    }

    // ESC 키 처리 → 통합 keydown 핸들러로 이동 (하단 참고)

    // 차트 리사이즈 옵저버
    let lwResizeObserver = null;

    function destroyChart() {
        if (lwResizeObserver) { lwResizeObserver.disconnect(); lwResizeObserver = null; }
        lwAiPriceLines = [];        // refs만 초기화 (데이터는 lwAiLastData에 보존)
        lwAiTrendSeries = [];
        lwAiCanvasTrendlines = [];
        if (lwChart) { lwChart.remove(); lwChart = null; }
        const _aiBtn = document.getElementById('chartAiReaderBtn');
        if (_aiBtn) _aiBtn.style.display = 'none';
        lwCandleSeries = null;
        lwVolumeSeries = null;
        lwMaSeries = {};
        lwBbUpper = null;
        lwBbLower = null;
        lwBbMiddle = null;
        lwVwap = null;
        lwVwapUpper = null;
        lwVwapLower = null;
        lwStochK = lwStochD = null;
        lwOBVSeries = null;
        // 자동 추세각도 시리즈 정리
        try { _autoTrendLineSeries = []; } catch(_) {}
        // Phase X1-b: cell1 레지스트리 정리
        if (_xcCells['cell1']) {
            _xcCells['cell1'].chart        = null;
            _xcCells['cell1'].candleSeries = null;
            _xcCells['cell1'].volSeries    = null;
            delete _xcCells['cell1'];
        }
    }

    function renderPriceChart() {
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap || !stockData) return;

        // 기존 차트 정리 (비교 오버레이 stale ref 초기화 포함)
        _cmpSeries = null;
        destroyChart();
        wrap.innerHTML = '';

        // [Bug-fix] stockData 구조 방어 체크 (API 응답 누락 시 crash 방지)
        if (!stockData || !stockData.indicators || !stockData.indicators.quote) return;
        const ts = stockData.timestamp;
        const q = stockData.indicators.quote[0];
        if (!ts || !q) return;

        // 현재 테마 감지
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const chartBg = isLight ? '#ffffff' : '#111620';
        const chartText = isLight ? '#6C6C70' : '#8E8E93';
        const chartGrid = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(45,58,77,0.2)';

        // 차트 생성
        lwChart = LightweightCharts.createChart(wrap, {
            width: wrap.clientWidth,
            height: wrap.clientHeight,
            layout: {
                background: { type: 'solid', color: chartBg },
                textColor: chartText,
                fontSize: 12,
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
                timeVisible: isIntraday(currentInterval),
                secondsVisible: false,
                rightOffset: 5,
                barSpacing: 8,
            },
            localization: {
                locale: 'ko-KR',
                priceFormatter: price => {
                    if (currentMarket === 'KR') return Math.round(price).toLocaleString();
                    return price.toFixed(2);
                },
            },
        });

        // Phase B: 최신가 점프 버튼 + 프리셋 자동 해제 옵저버
        try { _jumpBtnHooked = false; _initJumpBtnObserver(); } catch(_) {}
        // Phase C: OHLC tooltip + shift+drag zoom + 키보드 단축키
        try { _ohlcTooltipHooked = false; _initOhlcTooltip(); } catch(_) {}
        try { _initShiftDragZoom(); _initChartKeyboardShortcuts(); } catch(_) {}
        // M6: 모바일에서 십자선 숨김 (터치 환경, 마우스 hover 없음)
        if (window.innerWidth <= 600) {
            try {
                lwChart.applyOptions({
                    crosshair: {
                        vertLine: { visible: false, labelVisible: false },
                        horzLine: { visible: false, labelVisible: false },
                    }
                });
            } catch(_) {}
        }

        // 캔들스틱 시리즈
        lwCandleSeries = lwChart.addCandlestickSeries({
            upColor: '#ef4444',
            downColor: '#3b82f6',
            borderUpColor: '#ef4444',
            borderDownColor: '#3b82f6',
            wickUpColor: '#ef4444',
            wickDownColor: '#3b82f6',
        });

        // 거래량 시리즈
        lwVolumeSeries = lwChart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        lwChart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });

        // 데이터 변환
        const candleData = [];
        const volumeData = [];

        for (let i = 0; i < ts.length; i++) {
            const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
            if (o == null || h == null || l == null || c == null) continue;

            const time = isIntraday(currentInterval) ? ts[i] : ts[i]; // UTC timestamp

            candleData.push({ time, open: o, high: h, low: l, close: c });
            volumeData.push({
                time,
                value: v || 0,
                color: c >= o ? 'rgba(255,69,58,0.25)' : 'rgba(0,128,251,0.25)',
            });
        }

        lwCandleSeries.setData(candleData);
        lwVolumeSeries.setData(volumeData);

        // 이동평균선 추가 — Phase A2: _indGetConfig() 에서 기간/색상/두께 로드
        const closes = q.close;
        const _emaCfg = _indGetConfig().ema;
        const _emaOn  = _emaCfg.enabled !== false;
        _emaCfg.periods.forEach(({ period, color, width }) => {
            const key   = `ema${period}`;
            const label = `EMA${period}`;
            const ema   = calcEMA(closes, period);
            const maData = [];
            for (let i = 0; i < ts.length; i++) {
                if (ema[i] == null) continue;
                maData.push({ time: ts[i], value: ema[i] });
            }
            if (maData.length > 0) {
                const series = lwChart.addLineSeries({
                    color:               color || '#7dd3fc',
                    lineWidth:           width || 2,
                    priceLineVisible:    false,
                    lastValueVisible:    true,
                    title:               label,
                    crosshairMarkerVisible: false,
                    visible:             _emaOn,
                });
                series.setData(maData);
                lwMaSeries[key]          = series;
                lwMaSeries[key + '_data'] = ema;
            }
        });

        // 볼린저 밴드 — Phase A2: _indGetConfig() 에서 색상/두께/기간 로드
        const _bbCfg    = _indGetConfig().bb;
        const _bbPeriod = _bbCfg.period  || 4;
        const _bbColor  = _bbCfg.color   || '#f59e0b';
        const _bbWidth  = _bbCfg.width   || 2;
        const _bbOn     = _bbCfg.enabled !== false;
        const bb = calcBollingerBands(closes, _bbPeriod, 2);
        if (bb.upper.some(v => v != null)) {
            const upperData = [], lowerData = [];
            for (let i = 0; i < ts.length; i++) {
                if (bb.upper[i] != null) upperData.push({ time: ts[i], value: bb.upper[i] });
                if (bb.lower[i] != null) lowerData.push({ time: ts[i], value: bb.lower[i] });
            }
            lwBbUpper = lwChart.addLineSeries({
                color: _bbColor, lineWidth: _bbWidth, lineStyle: 0,
                priceLineVisible: false, lastValueVisible: true, title: 'BB+',
                crosshairMarkerVisible: false, visible: _bbOn,
            });
            lwBbLower = lwChart.addLineSeries({
                color: _bbColor, lineWidth: _bbWidth, lineStyle: 0,
                priceLineVisible: false, lastValueVisible: true, title: 'BB-',
                crosshairMarkerVisible: false, visible: _bbOn,
            });
            lwBbUpper.setData(upperData);
            lwBbLower.setData(lowerData);
        }

        // VWAP 레이어 — 5분봉 전용 (Kullamägi 단기 셋업 기준선)
        if (currentInterval === '5m') {
            try {
                const vwapRes = calcVWAPSession(q.high, q.low, q.close, q.volume || [], ts);
                const vwapData = [], upData = [], dnData = [];
                for (let i = 0; i < ts.length; i++) {
                    if (vwapRes.vwap[i]  != null) vwapData.push({ time: ts[i], value: vwapRes.vwap[i] });
                    if (vwapRes.upper[i] != null) upData.push({ time: ts[i], value: vwapRes.upper[i] });
                    if (vwapRes.lower[i] != null) dnData.push({ time: ts[i], value: vwapRes.lower[i] });
                }
                if (vwapData.length) {
                    lwVwap = lwChart.addLineSeries({
                        color: '#9D4EDD', lineWidth: 2, lineStyle: 0,
                        priceLineVisible: false, lastValueVisible: true, title: 'VWAP',
                        crosshairMarkerVisible: false,
                        visible: _chartVwapEnabled,
                    });
                    lwVwapUpper = lwChart.addLineSeries({
                        color: 'rgba(157,78,221,0.45)', lineWidth: 1, lineStyle: 1,
                        priceLineVisible: false, lastValueVisible: true, title: 'VWAP+1σ',
                        crosshairMarkerVisible: false,
                        visible: _chartVwapEnabled,
                    });
                    lwVwapLower = lwChart.addLineSeries({
                        color: 'rgba(157,78,221,0.45)', lineWidth: 1, lineStyle: 1,
                        priceLineVisible: false, lastValueVisible: true, title: 'VWAP-1σ',
                        crosshairMarkerVisible: false,
                        visible: _chartVwapEnabled,
                    });
                    lwVwap.setData(vwapData);
                    lwVwapUpper.setData(upData);
                    lwVwapLower.setData(dnData);
                }
            } catch (e) { warn('[vwap] fail', e); }
        }

        // ── 스토캐스틱 + OBV 하단 패널 ──────────────────────────────────────
        try { _renderStochSeries(ts, q); } catch(e) { warn('[stoch] fail', e); }
        try { _renderOBVSeries(ts, q);   } catch(e) { warn('[obv] fail', e);   }
        _applySubPaneLayout();

        // 실시간 지표 시그널 — 배지·마커·지지/저항선 자동 추가 (종목 변경 시 항상 완전 재빌드)
        _layerDirty = true;
        try { renderChartLiveSignals(candleData, ts, q, bb); } catch (e) { warn('[chart-sig] fail', e); }

        // 차트 전체 보이게
        lwChart.timeScale().fitContent();

        // M2: 마커 클릭 → bottom sheet 상세 (chart-mobile.js)
        lwChart.subscribeClick((param) => {
            if (!param.point || !param.time) return;
            const data = window._markerDataMap?.[param.time];
            if (!data) return;
            if (typeof openMarkerSheet === 'function') openMarkerSheet(param.time, data);
        });

        // 저장된 라벨 표시 설정 적용
        try { _applyChartLabelsVisibility(); } catch(_) {}

        // 스마트 머니 지지선 (홀딩 클릭 시 설정)
        if (pendingSmartMoneyLine && lwCandleSeries) {
            lwCandleSeries.createPriceLine({
                price: pendingSmartMoneyLine.price,
                color: '#f59e0b',
                lineWidth: 2,
                lineStyle: 2,
                axisLabelVisible: true,
                title: pendingSmartMoneyLine.label,
            });
            pendingSmartMoneyLine = null;
        }

        // AI 판독기 버튼 표시
        const _aiReaderBtn = document.getElementById('chartAiReaderBtn');
        if (_aiReaderBtn) _aiReaderBtn.style.display = '';

        // AI 라인 복원 (세션 내 재렌더 or PWA 재시작 후)
        if (lwAiLastData && lwAiLastData.symbol === currentSymbol) {
            // 1순위: 메모리 (같은 세션 내 재렌더)
            lwAiPriceLines = [];
            lwAiTrendSeries = [];
            drawAiChartLines(lwAiLastData.data, stockData.timestamp);
        } else if (currentSymbol) {
            // 2순위: 서버(Supabase) → 크로스 기기 동기화
            // 3순위: localStorage 폴백
            const _restoreSymbol = currentSymbol;
            const _restoreTs = stockData.timestamp;
            const _localFallback = () => {
                const saved = _aiLsLoad(_restoreSymbol);
                if (saved && currentSymbol === _restoreSymbol) drawAiChartLines(saved, _restoreTs);
            };
            fetch('/api/ai-analysis/' + encodeURIComponent(_restoreSymbol))
                .then(r => r.ok ? r.json() : null)
                .then(serverData => {
                    // 200+null 응답({ symbol, data:null }) = 저장된 분석 없음 → 로컬 폴백
                    if (!serverData || serverData.data === null) { _localFallback(); return; }
                    if (currentSymbol !== _restoreSymbol) return;
                    // 서버가 분석 객체를 직접 반환하는 경우와 { data: obj } 래핑 모두 지원
                    const analysisData = (serverData.data !== undefined) ? serverData.data : serverData;
                    drawAiChartLines(analysisData, _restoreTs);
                    _aiLsSave(_restoreSymbol, analysisData); // 서버 데이터를 로컬에도 동기화
                })
                .catch(_localFallback);
        }

        // 드로잉 도구 이벤트 연결 + 기존 그림 다시 렌더
        hookDrawRedraw();
        setTimeout(redrawCanvas, 100);

        // 리사이즈 옵저버
        lwResizeObserver = new ResizeObserver(entries => {
            if (lwChart && entries[0]) {
                const { width, height } = entries[0].contentRect;
                lwChart.applyOptions({ width, height });
                redrawCanvas();
            }
        });
        lwResizeObserver.observe(wrap);

        // Phase X1-b: cell1 레지스트리 등록 (프록시 전역과 동기 상태)
        _xcCells['cell1'] = {
            chart:         lwChart,
            candleSeries:  lwCandleSeries,
            volSeries:     lwVolumeSeries,
            symbol:        currentSymbol,
            fullSymbol:    currentFullSymbol,
            market:        currentMarket,
            tf:            currentInterval,
            el:            document.getElementById('chartCell1'),
            resizeObserver: lwResizeObserver,
            pollTimer:     null,
            stockData:     stockData,
            _lastCandleData: [],
            _lastTs:        [],
            _lastQ:         null,
        };
        _xcActiveCellId = 'cell1';
        _xcUpdateCellHeaders();

        // Phase X1-b: 저장된 레이아웃이 2+분할이면 이제 심볼이 있으므로 보조 셀 생성
        const _curLayout = _xcCurrentLayout();
        if (_curLayout !== '1') {
            if (!_xcCells['cell2']) _xcCreateCell('cell2');
            if (_curLayout.startsWith('3') && !_xcCells['cell3']) _xcCreateCell('cell3');
        }

        // X3a: cell1 시간축 동기화 구독
        try {
            lwChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
                if (_xcActiveCellId !== 'cell1' || !range) return;
                _xcBroadcastTimeScale('cell1', range);
            });
        } catch(_) {}
        // X3b: cell1 십자선 동기화 구독
        try {
            lwChart.subscribeCrosshairMove(param => {
                if (_xcActiveCellId !== 'cell1') return;
                _xcBroadcastCrosshair('cell1', param?.time ?? null);
            });
        } catch(_) {}

        // 저장된 활성 셀 복원 (보조 셀이 async 로드된 후)
        try {
            const _xcState = JSON.parse(localStorage.getItem('stockai_multichart_state') || 'null');
            if (_xcState?.activeCellId && _xcState.activeCellId !== 'cell1') {
                const _targetCell = _xcState.activeCellId;
                setTimeout(() => {
                    if (_xcCells[_targetCell]) _xcActivate(_targetCell);
                }, 2500); // 보조 셀 데이터 로드 대기
            }
        } catch(_) {}

        // X3: 동기화 UI 초기화
        setTimeout(_xcUpdateSyncUi, 100);
    }

    // ── Sub-pane 레이아웃 계산 ────────────────────────────────────────────────
    function _applySubPaneLayout() {
        if (!lwChart) return;
        try {
            const cfg = _indGetConfig();
            const stochOn = cfg.stoch?.enabled === true;
            const volOn   = cfg.volume?.enabled !== false;
            const obvOn   = cfg.obv?.enabled === true;
            const hasBottomOverlay = volOn || obvOn;

            if (stochOn && hasBottomOverlay) {
                // 두 서브패널: 중간(볼륨/OBV) + 하단(스토캐스틱)
                lwChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.44 } });
                try { lwChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.58, bottom: 0.22 } }); } catch(_) {}
                try { lwChart.priceScale('obv').applyOptions({ scaleMargins: { top: 0.58, bottom: 0.22 } }); } catch(_) {}
                try { lwChart.priceScale('stoch').applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } }); } catch(_) {}
            } else if (stochOn) {
                // 스토캐스틱만 — 볼륨 없음 → 하단 20%에 스토캐스틱
                lwChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } });
                try { lwChart.priceScale('stoch').applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } }); } catch(_) {}
            } else {
                // 기본: 볼륨/OBV만 하단 20%
                lwChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } });
                try { lwChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } }); } catch(_) {}
                try { lwChart.priceScale('obv').applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } }); } catch(_) {}
            }
        } catch(_) {}
    }

    // ── 스토캐스틱 렌더 ───────────────────────────────────────────────────────
    function _renderStochSeries(ts, q) {
        if (!lwChart || !ts || !q) return;
        const cfg = _indGetConfig();
        if (!cfg.stoch?.enabled) return;
        const kPeriod = cfg.stoch.kPeriod || 14;
        const dPeriod = cfg.stoch.dPeriod || 3;
        const kColor  = cfg.stoch.kColor  || '#7dd3fc';
        const dColor  = cfg.stoch.dColor  || '#f97316';
        const { kLine, dLine } = calcStochastic(q.high, q.low, q.close, kPeriod, dPeriod);
        const kData = [], dData = [];
        for (let i = 0; i < ts.length; i++) {
            if (kLine[i] != null) kData.push({ time: ts[i], value: kLine[i] });
            if (dLine[i] != null) dData.push({ time: ts[i], value: dLine[i] });
        }
        if (!kData.length) return;
        lwStochK = lwChart.addLineSeries({
            priceScaleId: 'stoch',
            color: kColor, lineWidth: 1,
            priceLineVisible: false, lastValueVisible: false,
            title: '%K', crosshairMarkerVisible: false,
        });
        lwStochD = lwChart.addLineSeries({
            priceScaleId: 'stoch',
            color: dColor, lineWidth: 1,
            priceLineVisible: false, lastValueVisible: false,
            title: '%D', crosshairMarkerVisible: false,
        });
        lwStochK.setData(kData);
        if (dData.length) lwStochD.setData(dData);
        // 기준선 (80/50/20)
        try {
            lwStochK.createPriceLine({ price: 80, color: 'rgba(239,68,68,0.45)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'OB' });
            lwStochK.createPriceLine({ price: 50, color: 'rgba(148,163,184,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
            lwStochK.createPriceLine({ price: 20, color: 'rgba(59,130,246,0.45)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'OS' });
        } catch(_) {}
        // 스토캐스틱 가격 축 숨김 (0-100 스케일 불필요)
        try { lwChart.priceScale('stoch').applyOptions({ visible: false }); } catch(_) {}
    }

    // ── OBV 렌더 ─────────────────────────────────────────────────────────────
    function _renderOBVSeries(ts, q) {
        if (!lwChart || !ts || !q) return;
        const cfg = _indGetConfig();
        if (!cfg.obv?.enabled) return;
        const color = cfg.obv.color || '#a855f7';
        const obvArr = calcOBV(q.close, q.volume || []);
        const obvData = [];
        for (let i = 0; i < ts.length; i++) {
            if (obvArr[i] != null) obvData.push({ time: ts[i], value: obvArr[i] });
        }
        if (!obvData.length) return;
        lwOBVSeries = lwChart.addLineSeries({
            priceScaleId: 'obv',
            color, lineWidth: 1,
            priceLineVisible: false, lastValueVisible: false,
            title: 'OBV', crosshairMarkerVisible: false,
        });
        lwOBVSeries.setData(obvData);
        // OBV 가격 축 숨김 (절대값 불필요)
        try { lwChart.priceScale('obv').applyOptions({ visible: false }); } catch(_) {}
    }

    function renderVolumeChart() {}

    // ========================================
    // Chart Drawing Tools (차트 드로잉 도구)