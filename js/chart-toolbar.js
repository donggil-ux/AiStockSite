// js/chart-toolbar.js
// 책임: 차트 보조지표 드롭다운 및 툴바 UI
// 의존: state.js, utils.js, chart-core.js

    // Phase C-2: OHLC Hover Tooltip
    // ══════════════════════════════════════════════════════════

    let _ohlcTooltipHooked = false;

    function _initOhlcTooltip() {
        if (!window.lwChart) return;
        try {
            lwChart.subscribeCrosshairMove(_onCrosshairMoveOhlc);
            // Phase A2: chart-header 도 동일 콜백으로 갱신
            lwChart.subscribeCrosshairMove(_onCrosshairMoveHeader);
            _ohlcTooltipHooked = true;
        } catch(_) {}
    }

    // ══════════════════════════════════════════════════════════
    // Phase A2: Chart Header (좌상단 항상 노출 OHLC + MA)
    // ══════════════════════════════════════════════════════════

    function _renderChartHeaderAt(idx) {
        // M6: always update mobile header TF + price (runs even if #chartHeader absent)
        try {
            const _sym = currentSymbol || '—';
            const _tf  = (INTERVAL_LABELS && INTERVAL_LABELS[currentInterval]) || currentInterval || '—';
            _mchUpdateTf(_sym, _tf);
            // price update from _lastSigArgs
            const _tsArr = window._lastSigArgs?.ts || [];
            if (_tsArr.length) {
                const _q = window._lastSigArgs?.q || {};
                const _i = (idx == null || idx < 0 || idx >= _tsArr.length) ? _tsArr.length - 1 : idx;
                const _c = _q.close?.[_i];
                const _prev = _i > 0 ? _q.close?.[_i - 1] : null;
                const _chgPct = (_c != null && _prev != null && _prev !== 0) ? (_c - _prev) / _prev * 100 : null;
                _mchUpdatePrice(_c, _chgPct);
            }
        } catch(_) {}

        const el = document.getElementById('chartHeader');
        if (!el) return;
        const tsArr = window._lastSigArgs?.ts || [];
        const q     = window._lastSigArgs?.q || {};
        if (!tsArr.length) { el.style.display = 'none'; return; }
        if (idx == null || idx < 0 || idx >= tsArr.length) idx = tsArr.length - 1;

        // Row 1: 종목 · TF
        const sym = currentSymbol || '—';
        const tfLabel = (INTERVAL_LABELS && INTERVAL_LABELS[currentInterval])
            || currentInterval || '—';
        el.querySelector('.ch-symbol').textContent = sym;
        el.querySelector('.ch-tf').textContent     = tfLabel;

        const fmtP = p => (p == null || !isFinite(p)) ? '—' :
            (currentMarket === 'KR' ? Math.round(p).toLocaleString() : Number(p).toFixed(2));

        // Row 2: OHLC + change
        const o = q.open?.[idx], h = q.high?.[idx], l = q.low?.[idx], c = q.close?.[idx];
        const prevC = idx > 0 ? q.close?.[idx-1] : null;
        el.querySelector('.ch-o').textContent = fmtP(o);
        el.querySelector('.ch-h').textContent = fmtP(h);
        el.querySelector('.ch-l').textContent = fmtP(l);
        el.querySelector('.ch-c').textContent = fmtP(c);

        const chgEl = el.querySelector('.ch-chg');
        if (prevC != null && c != null) {
            const chg = c - prevC;
            const chgPct = prevC ? (chg/prevC*100) : 0;
            const isUp = chg >= 0;
            const sign = isUp ? '+' : '';
            const col  = isUp ? '#EF4444' : '#3B82F6';
            chgEl.textContent = `${isUp?'▲':'▼'} ${sign}${chg.toFixed(2)} (${sign}${chgPct.toFixed(2)}%)`;
            chgEl.style.color = col;
            el.querySelector('.ch-c').style.color = col;
            // M6: update mobile header price + change
            try { _mchUpdatePrice(c, chgPct); } catch(e) {}
        } else {
            chgEl.textContent = '';
            // M6: update mobile header price (no change info)
            try { _mchUpdatePrice(c, null); } catch(e) {}
        }

        // Row 3: MA values (EMA20 / EMA50 / EMA200)
        const ma20 = window.lwMaSeries?.ema20_data || [];
        const ma50 = window.lwMaSeries?.ema50_data || [];
        const ma200 = window.lwMaSeries?.ema200_data || [];
        el.querySelector('.ch-ma20').textContent  = fmtP(ma20[idx]);
        el.querySelector('.ch-ma50').textContent  = fmtP(ma50[idx]);
        el.querySelector('.ch-ma200').textContent = fmtP(ma200[idx]);

        el.style.display = 'block';
    }

    /** crosshair 이동 시 헤더 갱신 (없으면 최신 캔들) */
    function _onCrosshairMoveHeader(param) {
        if (!param || param.time == null) { _renderChartHeaderAt(); return; }
        const tsArr = window._lastSigArgs?.ts || [];
        const idx = tsArr.indexOf(param.time);
        _renderChartHeaderAt(idx >= 0 ? idx : null);
    }

    // ══════════════════════════════════════════════════════════
    // Phase A2: 가로 toolbar 핸들러
    // ══════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════
    // Phase A2 — 보조지표 Split Dropdown
    // ══════════════════════════════════════════════════════════

    // ── 가격 라인 메타데이터 (localStorage 키 + 토글 함수명) ──
    const _IND_PL_MAP = {
        pl_sig:  { lsKey: 'stockai_chart_sig_lines',        neg: true,  fn: 'toggleChartSigLines',   name: '시그널 라인',
                   desc: '차트 매수·매도 진입 라인 및 손절 기준선을 표시합니다.' },
        pl_sr:   { lsKey: 'stockai_chart_sr_enabled',       neg: true,  fn: 'toggleSrLayer',         name: '돌파 / 저항',
                   desc: '주요 수요공급 클러스터에서 형성된 지지·저항 레벨을 표시합니다.' },
        pl_pb:   { lsKey: 'stockai_chart_pullback_enabled', neg: true,  fn: 'togglePullbackLayer',   name: '지지반등',
                   desc: '추세 이동평균 근방의 눌림목 지지 반등 구간을 표시합니다.' },
        pl_sd:   { lsKey: 'stockai_chart_smartdip_enabled', neg: false, fn: 'toggleSmartDipLayer',   name: '눌림 (피보)',
                   desc: 'Smart Dip 피보나치 분할매수 진입 레벨을 1~6차로 표시합니다.' },
        pl_sb:   { lsKey: 'stockai_chart_split_enabled',    neg: true,  fn: 'toggleSplitBuyLayer',   name: '분할매수',
                   desc: '분할매수 기준가 라인을 ATR 기반으로 표시합니다.' },
        pl_kl:   { lsKey: 'stockai_chart_kull',             neg: true,  fn: 'toggleKullamagiLayer',  name: 'Kullamägi',
                   desc: 'Kristjan Kullamägi 모멘텀 셋업 — EMA 기반 박스 돌파 영역입니다.' },
        pl_sepa: { lsKey: 'stockai_chart_sepa',             neg: true,  fn: 'toggleSepaLayer',       name: 'SEPA',
                   desc: 'Mark Minervini SEPA 슈퍼퍼포먼스 — 추세 템플릿 기반 단계 분석입니다.' },
    };

    /** 가격라인 항목의 현재 ON/OFF 상태 읽기 */
    function _indPlOn(key) {
        const m = _IND_PL_MAP[key];
        if (!m) return false;
        const v = localStorage.getItem(m.lsKey);
        return m.neg ? (v !== '0') : (v === '1');
    }

    // 16개 프리셋 색상 팔레트
    const _IND_PRESET_COLORS = [
        '#ef4444','#f97316','#f59e0b','#eab308',
        '#84cc16','#22c55e','#10b981','#06b6d4',
        '#3b82f6','#6366f1','#8b5cf6','#a855f7',
        '#ec4899','#f43f5e','#94a3b8','#f1f5f9'
    ];

    /** localStorage에서 설정 로드 (기본값 포함) */
    function _indGetConfig() {
        if (!_indConfig) {
            try { _indConfig = JSON.parse(localStorage.getItem('stockai_ind_config') || '{}'); }
            catch(e) { _indConfig = {}; }
        }
        const c = _indConfig;
        if (!c.ema) c.ema = { enabled: true, periods: [
            { period: 5,   color: '#10b981', width: 1 },
            { period: 20,  color: '#7dd3fc', width: 2 },
            { period: 50,  color: '#eab308', width: 2 },
            { period: 200, color: '#f1f5f9', width: 2 },
        ]};
        if (!c.bb)     c.bb     = { enabled: true,  color: '#f59e0b', width: 2, period: 4 };
        if (!c.vwap)   c.vwap   = { enabled: true  };
        if (!c.volume) c.volume = { enabled: true  };
        return c;
    }

    function _indSaveConfig() {
        if (!_indConfig) return;
        try { localStorage.setItem('stockai_ind_config', JSON.stringify(_indConfig)); } catch(e) {}
    }

    /** 보조지표 버튼 클릭: 패널 토글 */
    function _cxtOpenIndicators(ev) {
        if (ev) ev.stopPropagation();
        const panel = document.getElementById('indDropdown');
        const btn   = document.getElementById('cxtIndicators');
        if (!panel) return;
        if (panel.style.display !== 'none') {
            panel.style.display = 'none';
            btn?.classList.remove('active');
            return;
        }
        panel.style.display = 'flex';
        btn?.classList.add('active');
        _indRefreshPanel();
        // 외부 클릭 닫기
        setTimeout(() => {
            document.addEventListener('click', _indDocClose, { once: true, capture: true });
        }, 0);
    }

    function _indDocClose(e) {
        const panel = document.getElementById('indDropdown');
        const btn   = document.getElementById('cxtIndicators');
        if (!panel) return;
        // 패널 내부 또는 컬러피커 클릭 시 → 리스너 재등록
        const picker = document.getElementById('cidColorPicker');
        if (panel.contains(e.target) || btn?.contains(e.target) || picker?.contains(e.target)) {
            document.addEventListener('click', _indDocClose, { once: true, capture: true });
            return;
        }
        panel.style.display = 'none';
        btn?.classList.remove('active');
        _indCloseColorPicker();
    }

    /** 왼쪽 패널 체크 상태 + 선택 상태 갱신 */
    function _indRefreshPanel() {
        const cfg = _indGetConfig();
        // 상단 지표
        _indSetCheck('Ema',         cfg.ema.enabled);
        _indSetCheck('Bb',          cfg.bb.enabled);
        _indSetCheck('Vwap',        cfg.vwap.enabled);
        _indSetCheck('Ichimoku',    false);   // placeholder — always OFF
        _indSetCheck('Supertrend',  false);
        _indSetCheck('Envelope',    false);
        // 하단 지표
        _indSetCheck('Volume',      cfg.volume.enabled);
        _indSetCheck('Rsi',         false);   // placeholder
        _indSetCheck('Macd',        false);   // placeholder
        // 가격 라인 — key: 'pl_sig' → capKey: 'PlSig' → id: 'cidCheckPlSig'
        Object.keys(_IND_PL_MAP).forEach(key => {
            const ck = 'Pl' + key.slice(3).charAt(0).toUpperCase() + key.slice(4);
            _indSetCheck(ck, _indPlOn(key));
        });
        if (!_indSelectedKey) _indSelectedKey = 'ema';
        _indHighlightItem(_indSelectedKey);
        _indRenderRight(_indSelectedKey);
    }

    function _indSetCheck(capKey, on) {
        const el = document.getElementById('cidCheck' + capKey);
        if (!el) return;
        // iOS 체크 스타일: checked 클래스 토글 (SVG 내부 CSS로 색상 전환)
        if (on) {
            el.classList.add('checked');
        } else {
            el.classList.remove('checked');
        }
    }

    function _indHighlightItem(key) {
        document.querySelectorAll('.cid-item').forEach(b => b.classList.remove('active'));
        let capKey;
        if (key.startsWith('pl_')) {
            // pl_sig → PlSig, pl_sr → PlSr, pl_pb → PlPb …
            capKey = 'Pl' + key.slice(3).charAt(0).toUpperCase() + key.slice(4);
        } else {
            capKey = key.charAt(0).toUpperCase() + key.slice(1);
        }
        document.getElementById('cidItem' + capKey)?.classList.add('active');
    }

    /** 왼쪽 아이템 클릭 → 오른쪽 패널 렌더 */
    function _indSelect(key) {
        _indSelectedKey = key;
        _indHighlightItem(key);
        _indRenderRight(key);
    }

    /** 오른쪽 설정 패널 렌더 */
    function _indRenderRight(key) {
        const cfg   = _indGetConfig();
        const right = document.getElementById('cidRight');
        if (!right) return;

        const PLACEHOLDER_KEYS = ['ichimoku','supertrend','envelope','rsi','macd'];
        const NAMES = {
            ema: '이동평균선', bb: '볼린저 밴드', vwap: 'VWAP', volume: '볼륨',
            ichimoku: '일목균형표', supertrend: '슈퍼트렌드', envelope: '엔벨로프',
            rsi: 'RSI', macd: 'MACD'
        };

        let on, name;
        if (_IND_PL_MAP[key]) {
            // 가격 라인: 실제 localStorage 상태 반영
            on   = _indPlOn(key);
            name = _IND_PL_MAP[key].name;
        } else {
            on   = cfg[key]?.enabled !== false;
            name = NAMES[key] || key;
        }

        // 준비 중 항목은 타이틀에 토글 버튼 없이 표시
        let html;
        if (PLACEHOLDER_KEYS.includes(key)) {
            html = `<div class="cid-r-title">${name}</div>`;
        } else {
            html = `<div class="cid-r-title">${name}
                <button class="cid-r-toggle ${on ? 'on' : ''}"
                    onclick="event.stopPropagation();_indToggleEnabled('${key}')">
                    ${on ? '● ON' : '○ OFF'}
                </button>
            </div>`;
        }

        if (key === 'ema') {
            const periods = cfg.ema.periods;
            const canDel  = periods.length > 1;
            periods.forEach((p, idx) => {
                html += `<div class="cid-period-row">
                    <span class="cid-period-label">기간${idx + 1}</span>
                    <div class="cid-color-swatch" id="cidSwatch_ema_${idx}"
                        style="background:${p.color || '#7dd3fc'}"
                        onclick="event.stopPropagation();_indOpenColorPicker('ema',${idx},this)"
                        title="색상 변경"></div>
                    <select class="cid-width-select"
                        onchange="event.stopPropagation();_indSetWidth('ema',${idx},+this.value)">
                        <option value="1" ${(p.width||2)===1?'selected':''}>1px</option>
                        <option value="2" ${(p.width||2)===2?'selected':''}>2px</option>
                        <option value="3" ${(p.width||2)===3?'selected':''}>3px</option>
                    </select>
                    <select class="cid-src-select"
                        onchange="event.stopPropagation();_indSetSource('ema',${idx},this.value)">
                        <option value="close" ${(!p.source||p.source==='close')?'selected':''}>종가</option>
                        <option value="open"  ${p.source==='open' ?'selected':''}>시가</option>
                        <option value="high"  ${p.source==='high' ?'selected':''}>고가</option>
                        <option value="low"   ${p.source==='low'  ?'selected':''}>저가</option>
                    </select>
                    <input class="cid-period-input" type="number" min="1" max="500"
                        value="${p.period}"
                        onchange="event.stopPropagation();_indSetPeriod('ema',${idx},+this.value)"
                        onclick="event.stopPropagation()">
                    <button class="cid-del-btn" ${canDel ? '' : 'disabled'}
                        onclick="event.stopPropagation();_indRemovePeriod('ema',${idx})"
                        title="삭제">✕</button>
                </div>`;
            });
            const canAdd = periods.length < 6;
            html += `<button class="cid-add-btn" ${canAdd ? '' : 'disabled'}
                onclick="event.stopPropagation();_indAddPeriod('ema')">
                ⊕ 기간 추가 <span style="color:var(--text3);font-size:11px">(최대 6개)</span>
            </button>`;

        } else if (key === 'bb') {
            const b = cfg.bb;
            html += `<div class="cid-period-row">
                <span class="cid-period-label">기간</span>
                <div class="cid-color-swatch" id="cidSwatch_bb_0"
                    style="background:${b.color || '#f59e0b'}"
                    onclick="event.stopPropagation();_indOpenColorPicker('bb',0,this)"
                    title="색상 변경"></div>
                <select class="cid-width-select"
                    onchange="event.stopPropagation();_indSetWidth('bb',0,+this.value)">
                    <option value="1" ${(b.width||2)===1?'selected':''}>1px</option>
                    <option value="2" ${(b.width||2)===2?'selected':''}>2px</option>
                    <option value="3" ${(b.width||2)===3?'selected':''}>3px</option>
                </select>
                <input class="cid-period-input" type="number" min="2" max="200"
                    value="${b.period || 4}"
                    onchange="event.stopPropagation();_indSetPeriodBb(+this.value)"
                    onclick="event.stopPropagation()">
            </div>
            <div class="cid-note" style="margin-top:6px">2σ 볼린저 밴드 · 기본 기간: 4</div>`;

        } else if (key === 'vwap') {
            html += `<div class="cid-note">
                VWAP은 <strong>5분봉</strong> 선택 시 자동 표시됩니다.<br>
                세션 기준으로 계산되며 ±1σ 밴드와 함께 표시됩니다.
            </div>`;

        } else if (key === 'volume') {
            html += `<div class="cid-note">
                거래량 히스토그램은 차트 하단 20% 영역에 표시됩니다.<br>
                상승 캔들: <span style="color:#ef4444">빨간색</span> &nbsp;/&nbsp;
                하락 캔들: <span style="color:#3b82f6">파란색</span>
            </div>`;

        // ── 준비 중 placeholder ──
        } else if (key === 'ichimoku') {
            html += `<div class="cid-note">
                <strong>일목균형표 (Ichimoku Kinko Hyo)</strong><br><br>
                전환선·기준선·선행스팬·지연스팬 등 5선으로 구성된<br>
                추세·모멘텀·지지저항 종합 지표입니다.<br><br>
                <span style="color:var(--text3)">출시 예정</span>
            </div>`;
        } else if (key === 'supertrend') {
            html += `<div class="cid-note">
                <strong>슈퍼트렌드 (SuperTrend)</strong><br><br>
                ATR 기반 추세 추종 지표로, 매수·매도 신호와<br>
                현재 추세 방향을 단일 라인으로 표시합니다.<br><br>
                <span style="color:var(--text3)">출시 예정</span>
            </div>`;
        } else if (key === 'envelope') {
            html += `<div class="cid-note">
                <strong>엔벨로프 (Envelope)</strong><br><br>
                이동평균선에서 일정 비율(%) 떨어진 상·하단 밴드로<br>
                과매수·과매도 영역을 시각화합니다.<br><br>
                <span style="color:var(--text3)">출시 예정</span>
            </div>`;
        } else if (key === 'rsi') {
            html += `<div class="cid-note">
                <strong>RSI (Relative Strength Index)</strong><br><br>
                0~100 스케일의 모멘텀 오실레이터. 70 이상 과매수,<br>
                30 이하 과매도 구간으로 반전 시점을 포착합니다.<br><br>
                <span style="color:var(--text3)">하단 패널 출시 예정</span>
            </div>`;
        } else if (key === 'macd') {
            html += `<div class="cid-note">
                <strong>MACD (Moving Average Convergence Divergence)</strong><br><br>
                MACD선·시그널선·히스토그램으로 추세 전환과<br>
                모멘텀 강도를 동시에 파악합니다.<br><br>
                <span style="color:var(--text3)">하단 패널 출시 예정</span>
            </div>`;

        // ── 가격 라인 ──
        } else if (_IND_PL_MAP[key]) {
            html += `<div class="cid-note">${_IND_PL_MAP[key].desc}</div>`;
        }

        right.innerHTML = html;
    }

    /** 지표 ON/OFF 토글 */
    function _indToggleEnabled(key) {
        // ── 가격 라인 (pl_*): 매핑된 전역 함수 호출 ──
        if (_IND_PL_MAP[key]) {
            const fn = _IND_PL_MAP[key].fn;
            if (typeof window[fn] === 'function') { window[fn](); _updateDdStates?.(); }
            _indRefreshPanel();
            _indRenderRight(key);
            return;
        }
        // ── 준비 중 placeholder ──
        if (['ichimoku','supertrend','envelope','rsi','macd'].includes(key)) {
            if (typeof showToast === 'function') showToast('곧 출시 예정입니다 ✨');
            return;
        }
        const cfg = _indGetConfig();
        cfg[key].enabled = !(cfg[key].enabled !== false);
        _indSaveConfig();
        const on = cfg[key].enabled;
        // 기존 시리즈에 바로 적용
        if (key === 'ema') {
            Object.keys(lwMaSeries).forEach(k => {
                if (!k.endsWith('_data')) {
                    try { lwMaSeries[k]?.applyOptions({ visible: on }); } catch(_) {}
                }
            });
        } else if (key === 'bb') {
            try { lwBbUpper?.applyOptions({ visible: on });  } catch(_) {}
            try { lwBbLower?.applyOptions({ visible: on });  } catch(_) {}
            try { lwBbMiddle?.applyOptions({ visible: on }); } catch(_) {}
        } else if (key === 'vwap') {
            try { lwVwap?.applyOptions({ visible: on });      } catch(_) {}
            try { lwVwapUpper?.applyOptions({ visible: on }); } catch(_) {}
            try { lwVwapLower?.applyOptions({ visible: on }); } catch(_) {}
        } else if (key === 'volume') {
            try { lwVolumeSeries?.applyOptions({ visible: on }); } catch(_) {}
        }
        _indRefreshPanel();
    }

    /** 선 두께 변경 (즉시 반영) */
    function _indSetWidth(key, idx, width) {
        const cfg = _indGetConfig();
        if (key === 'ema') {
            if (!cfg.ema.periods[idx]) return;
            cfg.ema.periods[idx].width = width;
            const period     = cfg.ema.periods[idx].period;
            const seriesKey  = `ema${period}`;
            try { lwMaSeries[seriesKey]?.applyOptions({ lineWidth: width }); } catch(_) {}
        } else if (key === 'bb') {
            cfg.bb.width = width;
            try { lwBbUpper?.applyOptions({ lineWidth: width }); } catch(_) {}
            try { lwBbLower?.applyOptions({ lineWidth: width }); } catch(_) {}
        }
        _indSaveConfig();
    }

    /** 소스(종가/시가/고가/저가) 변경 → 재계산 */
    function _indSetSource(key, idx, source) {
        const cfg = _indGetConfig();
        if (key === 'ema') {
            if (!cfg.ema.periods[idx]) return;
            cfg.ema.periods[idx].source = source;
            _indSaveConfig();
            _indScheduleRebuild('ema');
        }
    }

    /** EMA 기간값 변경 */
    function _indSetPeriod(key, idx, period) {
        if (!period || period < 1) return;
        const cfg = _indGetConfig();
        if (key === 'ema' && cfg.ema.periods[idx]) {
            // 중복 방지
            if (cfg.ema.periods.some((p, i) => i !== idx && p.period === period)) return;
            cfg.ema.periods[idx].period = period;
            _indSaveConfig();
            _indScheduleRebuild('ema');
        }
    }

    /** BB 기간값 변경 */
    function _indSetPeriodBb(period) {
        if (!period || period < 2) return;
        const cfg   = _indGetConfig();
        cfg.bb.period = period;
        _indSaveConfig();
        _indScheduleRebuild('bb');
    }

    /** 기간 추가 */
    function _indAddPeriod(key) {
        const cfg = _indGetConfig();
        if (key === 'ema' && cfg.ema.periods.length < 6) {
            const existing = cfg.ema.periods.map(p => p.period);
            const defaults = [5, 10, 13, 20, 34, 50, 89, 100, 144, 200];
            const newPeriod = defaults.find(p => !existing.includes(p)) || (Math.max(...existing) + 10);
            cfg.ema.periods.push({
                period:  newPeriod,
                color:   _IND_PRESET_COLORS[cfg.ema.periods.length % _IND_PRESET_COLORS.length],
                width:   1,
                source: 'close',
            });
            _indSaveConfig();
            _indRenderRight('ema');
            _indScheduleRebuild('ema');
        }
    }

    /** 기간 삭제 */
    function _indRemovePeriod(key, idx) {
        const cfg = _indGetConfig();
        if (key === 'ema' && cfg.ema.periods.length > 1) {
            const period    = cfg.ema.periods[idx].period;
            const seriesKey = `ema${period}`;
            cfg.ema.periods.splice(idx, 1);
            _indSaveConfig();
            // 시리즈 즉시 제거
            if (lwMaSeries[seriesKey]) {
                try { lwChart?.removeSeries(lwMaSeries[seriesKey]); } catch(_) {}
                delete lwMaSeries[seriesKey];
                delete lwMaSeries[seriesKey + '_data'];
            }
            _indRenderRight('ema');
            _renderChartHeaderAt?.(null);
        }
    }

    /** 재계산 debounce (200ms) */
    function _indScheduleRebuild(key) {
        clearTimeout(_indDebounceTimer);
        _indDebounceTimer = setTimeout(() => _indRebuildSeries(key), 200);
    }

    /** 시리즈 재생성 (기간/소스 변경 시) */
    function _indRebuildSeries(key) {
        if (!lwChart || !_lastSigArgs) return;
        const cfg = _indGetConfig();
        const { ts, q } = _lastSigArgs;
        if (!q || !ts) return;

        if (key === 'ema') {
            // 기존 EMA 시리즈 모두 제거
            Object.keys(lwMaSeries).forEach(k => {
                if (!k.endsWith('_data')) {
                    try { lwChart.removeSeries(lwMaSeries[k]); } catch(_) {}
                }
            });
            lwMaSeries = {};
            // 설정 기반으로 재생성
            cfg.ema.periods.forEach(({ period, color, width, source }) => {
                const srcArr = source === 'open'  ? q.open  :
                               source === 'high'  ? q.high  :
                               source === 'low'   ? q.low   : q.close;
                const ema    = calcEMA(srcArr, period);
                const maData = [];
                for (let i = 0; i < ts.length; i++) {
                    if (ema[i] == null) continue;
                    maData.push({ time: ts[i], value: ema[i] });
                }
                if (maData.length) {
                    const series = lwChart.addLineSeries({
                        color:               color  || '#7dd3fc',
                        lineWidth:           width  || 2,
                        priceLineVisible:    false,
                        lastValueVisible:    true,
                        title:               `EMA${period}`,
                        crosshairMarkerVisible: false,
                        visible:             cfg.ema.enabled !== false,
                    });
                    series.setData(maData);
                    lwMaSeries[`ema${period}`]           = series;
                    lwMaSeries[`ema${period}_data`]      = ema;
                }
            });
            _renderChartHeaderAt?.(null);

        } else if (key === 'bb') {
            try { if (lwBbUpper)  lwChart.removeSeries(lwBbUpper);  } catch(_) {}
            try { if (lwBbLower)  lwChart.removeSeries(lwBbLower);  } catch(_) {}
            try { if (lwBbMiddle) lwChart.removeSeries(lwBbMiddle); } catch(_) {}
            lwBbUpper = lwBbLower = lwBbMiddle = null;
            const { color, width, period } = cfg.bb;
            const bb = calcBollingerBands(q.close, period || 4, 2);
            if (bb.upper.some(v => v != null)) {
                const upperData = [], lowerData = [];
                for (let i = 0; i < ts.length; i++) {
                    if (bb.upper[i] != null) upperData.push({ time: ts[i], value: bb.upper[i] });
                    if (bb.lower[i] != null) lowerData.push({ time: ts[i], value: bb.lower[i] });
                }
                lwBbUpper = lwChart.addLineSeries({
                    color: color || '#f59e0b', lineWidth: width || 2, lineStyle: 0,
                    priceLineVisible: false, lastValueVisible: true, title: 'BB+',
                    crosshairMarkerVisible: false, visible: cfg.bb.enabled !== false,
                });
                lwBbLower = lwChart.addLineSeries({
                    color: color || '#f59e0b', lineWidth: width || 2, lineStyle: 0,
                    priceLineVisible: false, lastValueVisible: true, title: 'BB-',
                    crosshairMarkerVisible: false, visible: cfg.bb.enabled !== false,
                });
                lwBbUpper.setData(upperData);
                lwBbLower.setData(lowerData);
            }
        }
    }

    /** 컬러 피커 팝업 열기 */
    function _indOpenColorPicker(key, idx, swatchEl) {
        _indCloseColorPicker();
        const cfg = _indGetConfig();
        const current = key === 'ema'
            ? (cfg.ema.periods[idx]?.color || '#7dd3fc')
            : (cfg.bb.color || '#f59e0b');

        const picker = document.createElement('div');
        picker.className = 'cid-color-picker';
        picker.id        = 'cidColorPicker';
        picker.onclick   = e => e.stopPropagation();

        const dots = _IND_PRESET_COLORS.map(c =>
            `<div class="cid-color-dot${c === current ? ' sel' : ''}"
                style="background:${c}"
                onclick="event.stopPropagation();_indPickColor('${key}',${idx},'${c}')"></div>`
        ).join('');

        picker.innerHTML = `
            <div class="cid-color-swatches">${dots}</div>
            <input class="cid-color-hex" type="text" value="${current}"
                maxlength="7" placeholder="#rrggbb"
                oninput="event.stopPropagation();_indPickColor('${key}',${idx},this.value)"
                onclick="event.stopPropagation()">
        `;

        // 팝업 위치: swatch 아래
        const r = swatchEl.getBoundingClientRect();
        picker.style.position = 'fixed';
        picker.style.top  = (r.bottom + 6) + 'px';
        picker.style.left = Math.max(8, r.left - 70) + 'px';
        document.body.appendChild(picker);

        setTimeout(() => {
            document.addEventListener('click', e => {
                if (!picker.contains(e.target) && !swatchEl.contains(e.target)) {
                    _indCloseColorPicker();
                }
            }, { once: true, capture: true });
        }, 0);
    }

    function _indCloseColorPicker() {
        document.getElementById('cidColorPicker')?.remove();
    }

    /** 색상 선택 (즉시 반영) */
    function _indPickColor(key, idx, color) {
        if (!color || color.length < 4 || !color.startsWith('#')) return;
        const cfg = _indGetConfig();
        if (key === 'ema') {
            if (!cfg.ema.periods[idx]) return;
            cfg.ema.periods[idx].color = color;
            const period    = cfg.ema.periods[idx].period;
            const seriesKey = `ema${period}`;
            try { lwMaSeries[seriesKey]?.applyOptions({ color }); } catch(_) {}
            // Swatch 업데이트
            const sw = document.getElementById(`cidSwatch_ema_${idx}`);
            if (sw) sw.style.background = color;
        } else if (key === 'bb') {
            cfg.bb.color = color;
            try { lwBbUpper?.applyOptions({ color }); } catch(_) {}
            try { lwBbLower?.applyOptions({ color }); } catch(_) {}
            const sw = document.getElementById('cidSwatch_bb_0');
            if (sw) sw.style.background = color;
        }
        _indSaveConfig();
        // 피커 내 선택된 dot 갱신
        document.querySelectorAll('#cidColorPicker .cid-color-dot').forEach(d => {
            const bg = d.style.backgroundColor;
            // CSS rgb → hex 비교는 어려우므로 onclick에서 색상 직접 저장한 방식으로 처리
            d.classList.toggle('sel', d.getAttribute('onclick')?.includes(`'${color}'`));
        });
        // hex input 업데이트
        const hex = document.querySelector('#cidColorPicker .cid-color-hex');
        if (hex && document.activeElement !== hex) hex.value = color;
    }

    function _cxtDraw() {
        const menu = document.getElementById('drawMenu');
        const btn  = document.getElementById('cxtDraw');
        if (!menu) { showToast?.('그리기 도구 준비중'); return; }
        const isOpen = menu.style.display !== 'none' && menu.style.display !== '';
        if (isOpen) {
            menu.style.display = 'none';
            btn?.classList.remove('active');
            setDrawTool('none');
        } else {
            menu.style.display = 'block';
            btn?.classList.add('active');
        }
    }
    function _cxtDrawClose() {
        const menu = document.getElementById('drawMenu');
        if (menu) menu.style.display = 'none';
        document.getElementById('cxtDraw')?.classList.remove('active');
        setDrawTool('none');
    }
    function _cxtRuler()   { showToast?.('📐 자 기능 — 곧 출시'); }
    function _cxtCompare() {
        if (_cmpSeries) { _cmpRemove(); return; }
        _cmpOpenSheet();
    }
    function _cxtSplit(ev) { _xcOpenLayoutPopover(ev); }

    // ── 종목비교 ────────────────────────────────────────────────────

    // 섹터별 피어 매핑
    const _CMP_PEERS = {
        NVDA:['TSM','AVGO','MU','AMD','QCOM','AMAT','ARM'],
        TSM:['NVDA','AVGO','MU','INTC','QCOM','AMAT'],
        AVGO:['NVDA','TSM','QCOM','TXN','ADI','MRVL'],
        MU:['NVDA','WDC','STX','AMAT','KLAC'],
        AMD:['NVDA','INTC','QCOM','AVGO','ARM'],
        INTC:['NVDA','AMD','AVGO','QCOM','TSM'],
        QCOM:['AVGO','INTC','AMD','TXN','ADI'],
        ARM:['NVDA','AMD','QCOM','INTC','AVGO'],
        AMAT:['KLAC','LRCX','ASML','TER','NVDA'],
        KLAC:['AMAT','LRCX','ASML','TER','ONTO'],
        AAPL:['MSFT','GOOGL','META','AMZN','NVDA'],
        MSFT:['AAPL','GOOGL','META','AMZN','CRM'],
        GOOGL:['MSFT','AAPL','META','AMZN','SNAP'],
        GOOG:['MSFT','AAPL','META','AMZN','SNAP'],
        META:['GOOGL','SNAP','AMZN','AAPL','PINS'],
        AMZN:['MSFT','GOOGL','WMT','AAPL','SHOP'],
        TSLA:['RIVN','LCID','F','GM','NIO'],
        SPY:['QQQ','IWM','DIA','VOO','VTI'],
        QQQ:['SPY','SOXX','VGT','XLK','TQQQ'],
        SOXX:['SMH','QQQ','VGT','SOXL','XSD'],
        SMH:['SOXX','QQQ','NVDA','AMD','TSM'],
        SOXL:['SOXS','NVDA','AMD','AVGO','SOXX'],
        TQQQ:['QQQ','SPY','SQQQ','SPXL','UPRO'],
        SPXL:['TQQQ','SPY','UPRO','QQQ','SOXL'],
    };
    const _CMP_NAMES = {
        NVDA:'엔비디아', TSM:'TSMC(ADR)', AVGO:'브로드컴', MU:'마이크론 테크놀로지',
        AMD:'AMD', INTC:'인텔', QCOM:'퀄컴', ARM:'ARM 홀딩스', AMAT:'어플라이드 머티리얼즈',
        KLAC:'KLA 코퍼레이션', LRCX:'램 리서치', ASML:'ASML 홀딩스',
        AAPL:'애플', MSFT:'마이크로소프트', GOOGL:'알파벳(GOOGL)', GOOG:'알파벳(GOOG)',
        META:'메타 플랫폼스', AMZN:'아마존', TSLA:'테슬라', RIVN:'리비안',
        SNAP:'스냅', CRM:'세일즈포스', TXN:'텍사스 인스트루먼트', ADI:'아나로그 디바이스',
        SPY:'SPDR S&P 500 ETF', QQQ:'인베스코 QQQ', IWM:'아이셰어스 러셀 2000',
        SOXX:'아이셰어스 반도체 ETF', SMH:'반에크 반도체 ETF',
        SOXL:'디렉시온 반도체 3× Bull', SOXS:'디렉시온 반도체 3× Bear',
        TQQQ:'ProShares 3× QQQ', SPXL:'디렉시온 S&P 500 3× Bull',
        VGT:'뱅가드 IT ETF', XLK:'테크 셀렉트 섹터 ETF',
        WDC:'웨스턴 디지털', F:'포드 모터', GM:'제너럴 모터스', NIO:'니오', LCID:'루시드',
        MRVL:'마벨 테크놀로지', PINS:'핀터레스트', SHOP:'쇼피파이',
        WMT:'월마트', DIA:'SPDR 다우존스 ETF', VOO:'뱅가드 S&P 500', VTI:'뱅가드 미국 전체',
    };
    const _CMP_SECTOR_SEMI  = new Set(['NVDA','TSM','AVGO','MU','AMD','INTC','QCOM','ARM','AMAT','KLAC','LRCX','ASML','MRVL','TER']);
    const _CMP_SECTOR_TECH  = new Set(['AAPL','MSFT','GOOGL','GOOG','META','AMZN','CRM','SNAP','SHOP','PINS']);
    const _CMP_SECTOR_ETF   = new Set(['SPY','QQQ','IWM','VOO','VTI','DIA','SOXX','SMH','SOXL','SOXS','TQQQ','SPXL','VGT','XLK','UPRO','SQQQ']);
    const _CMP_SECTOR_EV    = new Set(['TSLA','RIVN','LCID','NIO','F','GM']);

    function _cmpGetPeers(sym) {
        const s = (sym || '').toUpperCase();
        if (_CMP_PEERS[s]) return _CMP_PEERS[s].slice(0, 5);
        for (const [k, peers] of Object.entries(_CMP_PEERS)) {
            if (peers.includes(s)) return [k, ...peers.filter(p => p !== s)].slice(0, 5);
        }
        return currentMarket === 'KR'
            ? ['005930','000660','035420','051910','035720']
            : ['AAPL','MSFT','NVDA','GOOGL','META'];
    }

    function _cmpGetSectorLabel(sym) {
        const s = (sym || '').toUpperCase();
        if (_CMP_SECTOR_SEMI.has(s))  return '반도체';
        if (_CMP_SECTOR_TECH.has(s))  return '빅테크';
        if (_CMP_SECTOR_ETF.has(s))   return 'ETF';
        if (_CMP_SECTOR_EV.has(s))    return '전기차';
        return '유사 종목';
    }

    function _cmpSymColor(sym) {
        const PALETTE = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#06b6d4','#f97316','#84cc16'];
        let h = 0;
        for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) & 0xffffff;
        return PALETTE[Math.abs(h) % PALETTE.length];
    }

    function _cmpOpenSheet() {
        const modal = document.getElementById('cmpModal');
        if (!modal) return;
        const inp = document.getElementById('cmpInput');
        if (inp) inp.value = '';

        // 현재 종목명 헤더 갱신
        const nameEl   = document.getElementById('cmpStockName');
        const periodEl = document.getElementById('cmpStockPeriod');
        if (nameEl) nameEl.textContent = currentSymbol || '—';
        if (periodEl) periodEl.textContent = currentMarket === 'KR' ? '주' : 'Stock';

        // 시간 표시
        const now = new Date();
        const timeStr = `오늘 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} 기준`;
        const catTime = document.getElementById('cmpCatTime');
        if (catTime) catTime.textContent = timeStr;

        _cmpRenderRecent();
        _cmpRenderPeers(currentSymbol || '');

        // 버튼 기준으로 팝오버 위치 계산
        const btn = document.getElementById('cxtCompare');
        if (btn) {
            const r = btn.getBoundingClientRect();
            modal.style.top  = (r.bottom + 6) + 'px';
            modal.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 348)) + 'px';
        }
        modal.style.display = '';

        // 외부 클릭 시 닫기
        setTimeout(() => {
            document.addEventListener('click', _cmpDocClose, { once: true, capture: true });
        }, 0);
        setTimeout(() => inp?.focus(), 60);
    }

    function _cmpDocClose(e) {
        const modal = document.getElementById('cmpModal');
        const btn   = document.getElementById('cxtCompare');
        if (!modal) return;
        if (modal.contains(e.target) || btn?.contains(e.target)) {
            document.addEventListener('click', _cmpDocClose, { once: true, capture: true });
            return;
        }
        _cmpCloseSheet();
    }

    function _cmpCloseSheet() {
        const modal = document.getElementById('cmpModal');
        if (modal) modal.style.display = 'none';
    }

    function _cmpModalBgClick(e) { /* 팝오버 방식으로 전환 — 외부 클릭은 _cmpDocClose가 처리 */ }

    function _cmpRenderRecent() {
        const section = document.getElementById('cmpRecentSection');
        const chips   = document.getElementById('cmpRecentChips');
        const timeEl  = document.getElementById('cmpRecentTime');
        const recent  = JSON.parse(localStorage.getItem('stockai_cmp_recent') || '[]');
        if (!section) return;
        if (!recent.length) { section.style.display = 'none'; return; }
        section.style.display = '';
        const now = new Date();
        if (timeEl) timeEl.textContent = `오늘 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} 기준`;
        if (chips) chips.innerHTML = recent.map(sym => {
            const s = sym.replace(/[<>"']/g,'');
            return `<button class="cmp-recent-chip" onclick="_cmpSelectPeer('${s}')">${s}<span class="cmp-chip-x" onclick="event.stopPropagation();_cmpRemoveRecent('${s}')">×</span></button>`;
        }).join('');
    }

    function _cmpAddRecent(sym) {
        if (!sym) return;
        let r = JSON.parse(localStorage.getItem('stockai_cmp_recent') || '[]');
        r = [sym.toUpperCase(), ...r.filter(s => s !== sym.toUpperCase())].slice(0, 6);
        localStorage.setItem('stockai_cmp_recent', JSON.stringify(r));
    }

    function _cmpRemoveRecent(sym) {
        let r = JSON.parse(localStorage.getItem('stockai_cmp_recent') || '[]');
        r = r.filter(s => s !== sym);
        localStorage.setItem('stockai_cmp_recent', JSON.stringify(r));
        _cmpRenderRecent();
    }

    function _cmpRenderPeers(sym) {
        const listEl  = document.getElementById('cmpPeerList');
        const titleEl = document.getElementById('cmpCatTitle');
        const s = (sym || '').toUpperCase();
        if (titleEl) titleEl.textContent = s ? `${_cmpGetSectorLabel(s)} 유사 종목` : '유사 종목';
        if (!listEl) return;
        const peers = _cmpGetPeers(s);
        listEl.innerHTML = peers.map((p, i) => {
            const name  = _CMP_NAMES[p] || p;
            const color = _cmpSymColor(p);
            const rankCls = i < 3 ? ' rank-top' : '';
            return `<button class="cmp-peer-row" onclick="_cmpSelectPeer('${p}')">
                <span class="cmp-peer-rank${rankCls}">${i + 1}</span>
                <div class="cmp-peer-avatar" style="background:${color}">${p.charAt(0)}</div>
                <div class="cmp-peer-info">
                    <span class="cmp-peer-name">${name}</span>
                    <span class="cmp-peer-sym-label">${p}</span>
                </div>
                <span class="cmp-peer-chg" id="cmpChg_${p}">—</span>
            </button>`;
        }).join('');

        // 등락률 비동기 로드
        const symbols = peers.join(',');
        fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`)
            .then(r => r.json())
            .then(data => {
                if (!Array.isArray(data)) return;
                data.forEach(q => {
                    const el = document.getElementById('cmpChg_' + (q.symbol || q.ticker || ''));
                    if (!el) return;
                    const chg = q.regularMarketChangePercent ?? q.changePercent ?? null;
                    if (chg == null) return;
                    const isUp = chg >= 0;
                    el.textContent = (isUp ? '+' : '') + chg.toFixed(2) + '%';
                    el.className = 'cmp-peer-chg ' + (isUp ? 'up' : 'down');
                });
            }).catch(() => {});
    }

    function _cmpModalSearch(val) {
        const v = (val || '').trim().toUpperCase();
        const catSec = document.getElementById('cmpCategorySection');
        const recSec = document.getElementById('cmpRecentSection');
        if (!v) {
            if (catSec) catSec.style.display = '';
            _cmpRenderRecent();
            return;
        }
        // 검색 중에는 카테고리 섹션 숨김, 최근 섹션도 숨김
        if (catSec) catSec.style.display = 'none';
        if (recSec) recSec.style.display = 'none';
    }

    function _cmpSelectPeer(sym) {
        _cmpCloseSheet();
        _cmpLoad(sym);
    }

    async function _cmpSubmit() {
        const inp = document.getElementById('cmpInput');
        const raw = (inp?.value || '').trim().toUpperCase();
        if (!raw) return;
        _cmpCloseSheet();
        await _cmpLoad(raw);
    }

    async function _cmpLoad(rawSym) {
        if (!lwChart) { showToast('차트를 먼저 불러주세요.'); return; }
        const q = _lastSigArgs?.q;
        const mainTs = _lastSigArgs?.ts;
        if (!q || !mainTs?.length) { showToast('차트 데이터가 없습니다.'); return; }

        // 심볼 해석
        let fullSym;
        if (/\.\w{2,3}$/.test(rawSym)) {
            fullSym = rawSym;
        } else if (autoDetectMarket(rawSym) === 'KR') {
            const code = findKRCode(rawSym);
            fullSym = code + '.KS';
        } else {
            fullSym = findUSTicker(rawSym) || rawSym;
        }

        showToast('📊 비교 데이터 로딩 중...');
        try {
            const url = '/api/chart/' + encodeURIComponent(fullSym)
                + '?range=' + currentPeriod + '&interval=' + currentInterval + '&includePrePost=true';
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();

            // /api/chart/ returns Yahoo Finance wrapped structure: { chart: { result: [{...}] } }
            const result = data?.chart?.result?.[0];
            if (!result) throw new Error('데이터 없음 (result)');
            const cmpTs = result.timestamp;
            const cmpQ  = result.indicators?.quote?.[0];
            if (!cmpTs || !cmpQ) throw new Error('데이터 없음 (ts/q)');

            // 비교 시작점 — 메인 차트 첫 번째 타임스탬프 기준 정렬
            const mainFirst = mainTs[0];
            let cmpStartIdx = cmpTs.findIndex(t => t >= mainFirst);
            if (cmpStartIdx < 0) cmpStartIdx = 0;
            const cmpFirstClose = cmpQ.close[cmpStartIdx];
            if (!cmpFirstClose) throw new Error('비교 종목 시가 없음');

            // 메인 주식 첫 종가 — 정규화 기준
            const mainFirstClose = q.close.find(v => v != null);
            if (!mainFirstClose) throw new Error('메인 종목 종가 없음');

            // 정규화: cmp 가격을 메인 주식의 시작점과 맞춤 (같은 우축 스케일 사용)
            const lineData = [];
            for (let i = cmpStartIdx; i < cmpTs.length; i++) {
                const c = cmpQ.close[i];
                if (c == null) continue;
                const normalized = c * (mainFirstClose / cmpFirstClose);
                lineData.push({ time: cmpTs[i], value: normalized });
            }
            if (!lineData.length) throw new Error('겹치는 구간 없음');

            // 기존 시리즈 제거
            _cmpRemove(false);

            // 라인 시리즈 추가
            _cmpSeries = lwChart.addLineSeries({
                color: _cmpColor,
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 4,
                crosshairMarkerBorderColor: _cmpColor,
                crosshairMarkerBackgroundColor: _cmpColor,
            });
            _cmpSeries.setData(lineData);
            _cmpSymbol = rawSym;

            // 레전드 계산 (시작 대비 현재 등락률)
            const firstVal = lineData[0].value;
            const lastVal  = lineData[lineData.length - 1].value;
            const chgPct   = firstVal ? (lastVal / firstVal - 1) * 100 : 0;

            _cmpUpdateLegend(rawSym, chgPct);
            _cmpAddRecent(rawSym);
            document.getElementById('cxtCompare')?.classList.add('active');
            showToast(`${rawSym} 비교 추가됨`);
        } catch(e) {
            showToast('비교 실패: ' + e.message);
            warn('[cmp] load fail:', e);
        }
    }

    function _cmpRemove(doToast) {
        if (_cmpSeries) {
            try { lwChart?.removeSeries(_cmpSeries); } catch(_) {}
            _cmpSeries = null;
        }
        _cmpSymbol = null;
        const leg = document.getElementById('cmpLegend');
        if (leg) leg.style.display = 'none';
        document.getElementById('cxtCompare')?.classList.remove('active');
        if (doToast !== false) showToast('비교 종목 제거됨');
    }

    function _cmpUpdateLegend(sym, chgPct) {
        const leg = document.getElementById('cmpLegend');
        if (!leg) return;
        const symEl = leg.querySelector('.cmp-legend-sym');
        const chgEl = leg.querySelector('.cmp-legend-chg');
        if (symEl) symEl.textContent = sym;
        if (chgEl) {
            const sign = chgPct >= 0 ? '+' : '';
            chgEl.textContent = `${sign}${chgPct.toFixed(2)}%`;
            chgEl.style.color = chgPct > 0 ? '#EF4444' : chgPct < 0 ? '#3B82F6' : 'var(--text3)';
        }
        leg.style.display = 'flex';
    }

    /** 인터벌/기간 변경 시 비교 오버레이 자동 갱신 */
    function _cmpRefreshIfActive() {
        if (_cmpSymbol) _cmpLoad(_cmpSymbol);
    }

    // ══════════════════════════════════════════════════════════
    // Phase X1: 멀티 차트 그리드 (UI 스캐폴딩)