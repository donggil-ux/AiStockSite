// js/chart-nav.js
// 책임: 차트 기간 프리셋, 줌, 패닝
// 의존: state.js, utils.js, chart-core.js

    // Phase B-1: 기간 프리셋 + B-3 시간프레임 연동
    // ══════════════════════════════════════════════════════════

    const _CHART_PRESETS = {
        '1D':  { tf: '5m',   period: '1d'  },
        '5D':  { tf: '30m',  period: '5d'  },
        '1M':  { tf: '60m',  period: '1mo' },
        '3M':  { tf: '60m',  period: '3mo' },   // 1d 는 3mo 허용범위 밖 → 60m
        '6M':  { tf: '1d',   period: '6mo' },
        '1Y':  { tf: '1d',   period: '1y'  },
        'ALL': { tf: '1wk',  period: 'max' },
    };

    let _activePreset      = localStorage.getItem('stockai_chart_preset') || '3M';
    let _userTfChangeAt    = 0;     // 사용자 수동 TF 변경 시점 (5초 동안 자동 매핑 차단)
    let _cnbPresetApplying = false; // 프리셋 적용 중 (setChartInterval 호출이 자동인지 수동인지 판별)
    let _cnbProgrammaticRangeChange = false;

    function _cnbUpdatePresetUi() {
        document.querySelectorAll('.cpb-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.preset === _activePreset);
        });
    }

    function _cnbDeactivatePreset() {
        if (_activePreset == null) return;
        _activePreset = null;
        document.querySelectorAll('.cpb-btn').forEach(b => b.classList.remove('active'));
    }

    /** 프리셋 클릭 → TF/Period 적용 후 데이터 재로드 */
    function _cnbSetPreset(preset) {
        const cfg = _CHART_PRESETS[preset];
        if (!cfg) return;
        _activePreset = preset;
        try { localStorage.setItem('stockai_chart_preset', preset); } catch(_) {}
        _cnbUpdatePresetUi();

        // 사용자가 5초 이내에 TF를 수동 변경했으면 TF는 그대로 유지
        const skipTf = (Date.now() - _userTfChangeAt) < 5000;
        const newTf  = skipTf ? currentInterval : cfg.tf;

        _cnbPresetApplying = true;
        try {
            currentInterval = newTf;
            currentPeriod   = cfg.period;
            try {
                localStorage.setItem('stockai_chart_interval', newTf);
                localStorage.setItem('stockai_chart_period',  cfg.period);
            } catch(_) {}

            // UI 동기화 — interval/range 버튼·드롭다운
            document.querySelectorAll('.interval-btn').forEach(b => b.classList.toggle('active', b.dataset.interval === newTf));
            document.querySelectorAll('.interval-dd-item').forEach(b => b.classList.toggle('active', b.dataset.interval === newTf));
            document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === cfg.period));
            // 드롭다운 라벨
            const ddLabel = document.getElementById('intervalDdLabel');
            if (ddLabel) {
                const isMin = /m$/.test(newTf) || newTf === '1h';
                ddLabel.textContent = isMin ? (window.INTERVAL_LABELS?.[newTf] || newTf) : '분봉';
            }

            if (currentSymbol) searchStock();
        } finally {
            setTimeout(() => { _cnbPresetApplying = false; }, 400);
        }
    }

    // ══════════════════════════════════════════════════════════
    // Phase B-2: 최신가 점프 버튼
    // ══════════════════════════════════════════════════════════

    let _jumpBtnHooked = false;

    function _initJumpBtnObserver() {
        try {
            if (!window.lwChart) return;
            const ts = window.lwChart.timeScale();
            if (!ts || !ts.subscribeVisibleLogicalRangeChange) return;
            // 매번 새 차트마다 hook
            ts.subscribeVisibleLogicalRangeChange(_onChartVisRangeChange);
            _jumpBtnHooked = true;
            _updateJumpBtnVisibility();
        } catch(_) {}
    }

    function _onChartVisRangeChange() {
        // 사용자 드래그/휠 → 프리셋 해제 (프로그램 변경 제외)
        if (!_cnbProgrammaticRangeChange && _activePreset) {
            _cnbDeactivatePreset();
        }
        _updateJumpBtnVisibility();
        // 줌/스크롤로 마커가 사라지는 현상 방지 — 캐시된 마커 재설정 보장
        try {
            if (window.lwCandleSeries && window._lastMarkers && window._lastMarkers.length > 0) {
                window.lwCandleSeries.setMarkers(window._lastMarkers);
            }
        } catch(_) {}
    }

    function _updateJumpBtnVisibility() {
        const btn = document.getElementById('chartJumpLatest');
        if (!btn || !window.lwChart) return;
        try {
            const r = window.lwChart.timeScale().getVisibleLogicalRange();
            const tsLen = (window._lastSigArgs?.ts?.length) || 0;
            if (!r || !tsLen) { btn.style.display = 'none'; return; }
            const lastIdx = tsLen - 1;
            const outOfView = r.to < lastIdx - 1;
            if (outOfView) {
                const closes = window._lastSigArgs?.q?.close || [];
                const lastClose = closes[closes.length - 1];
                if (lastClose != null) {
                    const sym = (currentMarket === 'KR') ? '₩' : '$';
                    const pricEl = btn.querySelector('.cjl-price');
                    if (pricEl) pricEl.textContent = sym + (currentMarket === 'KR'
                        ? Math.round(lastClose).toLocaleString()
                        : Number(lastClose).toFixed(2));
                }
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        } catch(_) {}
    }

    /** 최신 캔들이 우측에서 20% 안쪽에 오도록 smooth scroll (줌 폭 유지) */
    function _chartJumpToLatest() {
        if (!window.lwChart) return;
        try {
            const ts = window.lwChart.timeScale();
            const r  = ts.getVisibleLogicalRange();
            const tsLen = (window._lastSigArgs?.ts?.length) || 0;
            if (!tsLen) { ts.scrollToRealTime?.(); return; }
            const lastIdx = tsLen - 1;
            if (!r) { ts.scrollToPosition?.(0, true); return; }
            const width = r.to - r.from;
            const rightMargin = Math.max(3, width * 0.2);
            _cnbProgrammaticRangeChange = true;
            ts.setVisibleLogicalRange({
                from: lastIdx - width + rightMargin,
                to:   lastIdx + rightMargin,
            });
            setTimeout(() => { _cnbProgrammaticRangeChange = false; }, 300);
        } catch(e) { warn('[jumpLatest]', e); }
    }

    // ══════════════════════════════════════════════════════════
    // Phase C-2: OHLC Hover Tooltip