// js/chart-sync.js
// 책임: 멀티차트 시간축·십자선·종목 동기화 (X3)
// 의존: state.js, chart-multi.js

    // Chart Drawing Tools (차트 드로잉 도구)
    // ========================================
    let drawTool = 'none';       // none | line | hline | ray | rect | fib | angle
    let drawColor = '#ef4444';
    let drawWidth = 1;
    let drawObjects = [];        // { type, points, color, width }
    let drawState = null;        // { phase, startX, startY, startPrice, startTime }
    let drawPreview = null;      // 미리보기 좌표

    function toggleDrawToolbar() {
        // 레거시 호출 → 새 drawMenu 토글로 위임
        _cxtDraw?.();
    }

    // ── 자석 모드 (OHLC 스냅) ────────────────────────────────────────
    let _drawMagnetOn = false;
    function toggleDrawMagnet() {
        _drawMagnetOn = !_drawMagnetOn;
        const toggle = document.getElementById('drawMagnetToggle');
        if (toggle) toggle.classList.toggle('on', _drawMagnetOn);
    }

    // 자동 추세각도 시리즈 추적 (재클릭 시 이전 라인 제거)
    let _autoTrendLineSeries = [];

    function clearAutoTrendAngles() {
        _autoTrendLineSeries.forEach(s => { try { lwChart?.removeSeries(s); } catch(e) {} });
        _autoTrendLineSeries = [];
    }

    // 자동 추세각도: 차트 네이티브 LineSeries 로 그리기 (EMA 라인과 동일 메커니즘 — 안정적)
    function addAutoTrendAngle() {
        if (typeof stockData === 'undefined' || !stockData) {
            if (typeof showToast === 'function') showToast('종목을 먼저 검색하세요');
            return;
        }
        const q = stockData.indicators?.quote?.[0];
        const ts = stockData.timestamp;
        if (!q?.close || !ts || typeof lwChart === 'undefined' || !lwChart) {
            if (typeof showToast === 'function') showToast('차트 데이터가 없습니다');
            return;
        }
        // 이전 자동 각도선 제거 (중복 방지)
        clearAutoTrendAngles();
        // 최근 40개 유효 캔들 (시간 정렬 보장)
        const pairs = [];
        for (let i = ts.length - 1; i >= 0 && pairs.length < 40; i--) {
            const c = q.close[i];
            if (c != null && ts[i] != null) pairs.unshift({ t: ts[i], p: c });
        }
        if (pairs.length < 10) {
            if (typeof showToast === 'function') showToast('데이터 부족 — 10봉 이상 필요');
            return;
        }
        // 선형회귀 y = a + b*x
        const n = pairs.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        pairs.forEach((p, i) => { sumX += i; sumY += p.p; sumXY += i * p.p; sumXX += i * i; });
        const denom = n * sumXX - sumX * sumX;
        if (denom === 0) { if (typeof showToast === 'function') showToast('회귀 계산 실패'); return; }
        const slope = (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;
        // 봉당 변동률 + 시각 각도(픽셀 기반, 가능 시)
        const slopePctPerBar = intercept ? (slope / intercept) * 100 : 0;
        let pixelAngleDeg = null;
        try {
            const x1 = lwChart.timeScale().timeToCoordinate(pairs[0].t);
            const x2 = lwChart.timeScale().timeToCoordinate(pairs[n-1].t);
            const y1 = lwCandleSeries?.priceToCoordinate(intercept);
            const y2 = lwCandleSeries?.priceToCoordinate(intercept + slope * (n-1));
            if (x1 != null && x2 != null && y1 != null && y2 != null) {
                pixelAngleDeg = Math.atan2(-(y2 - y1), x2 - x1) * 180 / Math.PI;
            }
        } catch (_) {}
        const dir = slope > 0 ? '상승' : slope < 0 ? '하락' : '횡보';
        const dirEmoji = slope > 0 ? '📈' : slope < 0 ? '📉' : '➖';
        const titleAngle = pixelAngleDeg != null ? `${pixelAngleDeg >= 0 ? '+' : ''}${pixelAngleDeg.toFixed(1)}°` : `${slopePctPerBar.toFixed(2)}%/봉`;

        // 회귀 라인 데이터
        const lineData = pairs.map((pair, i) => ({
            time: pair.t,
            value: intercept + slope * i,
        }));

        // 네이티브 LineSeries 추가 — EMA 와 동일 메커니즘 (확실히 그려짐)
        const series = lwChart.addLineSeries({
            color: '#a78bfa',
            lineWidth: 3,
            lineStyle: 2, // dashed
            priceLineVisible: false,
            lastValueVisible: true,
            title: `추세 ${titleAngle}`,
            crosshairMarkerVisible: false,
        });
        series.setData(lineData);
        _autoTrendLineSeries.push(series);

        if (typeof showToast === 'function') {
            const angStr = pixelAngleDeg != null ? ` · 각도 ${pixelAngleDeg.toFixed(1)}°` : '';
            showToast(`${dirEmoji} ${n}봉 ${dir} 추세 · 봉당 ${slopePctPerBar >= 0 ? '+' : ''}${slopePctPerBar.toFixed(2)}%${angStr}`);
        }
    }

    function setDrawTool(tool) {
        // 미구현 도구 — 토스트 안내 후 무시
        const _comingSoon = ['pitchfork', 'fib_channel', 'fib_fan', 'text'];
        if (_comingSoon.includes(tool)) {
            const labels = { pitchfork:'피치포크', fib_channel:'피보나치 채널', fib_fan:'속도 저항 팬', text:'텍스트' };
            showToast?.(`🚧 ${labels[tool]} — 준비중`);
            return;
        }

        drawTool = tool;
        drawState = null;
        drawPreview = null;

        // 새 메뉴 버튼 활성화 표시
        document.querySelectorAll('#drawMenu .draw-menu-item[id^="dmBtn"]').forEach(b => b.classList.remove('active'));
        const dmId = 'dmBtn' + tool.charAt(0).toUpperCase() + tool.slice(1);
        document.getElementById(dmId)?.classList.add('active');

        // 좌측 세로 그리기 dock 버튼 동기화 (TradingView)
        document.querySelectorAll('#drawDock .draw-dock-btn').forEach(b => b.classList.remove('active'));
        const _dockMap = { none:'ddockCursor', line:'ddockLine', hline:'ddockHline', fib:'ddockFib', rect:'ddockRect', ellipse:'ddockEllipse' };
        document.getElementById(_dockMap[tool])?.classList.add('active');

        // 캔버스 활성화
        const canvas = document.getElementById('drawCanvas');
        if (tool === 'none') {
            canvas?.classList.remove('active');
            if (lwChart) lwChart.applyOptions({ handleScroll: true, handleScale: true });
        } else {
            canvas?.classList.add('active');
            if (lwChart) lwChart.applyOptions({ handleScroll: false, handleScale: false });
        }
        redrawCanvas();
    }

    function setDrawColor(color) {
        drawColor = color;
        document.querySelectorAll('.draw-color-btn2').forEach(b => {
            b.classList.toggle('active', b.dataset.color === color);
        });
        // 레거시 버튼 (혹시 남아있을 경우)
        document.querySelectorAll('.draw-color-btn').forEach(b => {
            b.classList.toggle('active', b.style.background === color || b.style.backgroundColor === color);
        });
    }

    function setDrawWidth(w) {
        drawWidth = w;
        document.querySelectorAll('.draw-width-btn2').forEach(b => b.classList.toggle('active', +b.dataset.w === w));
        document.querySelectorAll('.draw-width-btn').forEach(b => b.classList.toggle('active', +b.dataset.w === w));
    }

    function undoDraw() {
        if (drawObjects.length === 0) return;
        drawObjects.pop();
        redrawCanvas();
        updateDrawBadge();
    }

    // ========================================
    // 차트 실시간 지표 시그널 — 배지·마커·지지/저항선
    // ========================================
    let _chartLiveLines = []; // 자동 S/R priceLine refs (재렌더 시 정리)
    // Kullamägi + 보조지표 통합 — 페이지 로드 시 둘 중 하나라도 ON이면 통일
    {
        const _kullState = localStorage.getItem('stockai_chart_kull') !== '0';
        const _sigState  = localStorage.getItem('stockai_chart_sig_lines') !== '0';
        const _unified   = _kullState || _sigState;
        localStorage.setItem('stockai_chart_kull', _unified ? '1' : '0');
        localStorage.setItem('stockai_chart_sig_lines', _unified ? '1' : '0');
    }
    let _chartLinesEnabled = localStorage.getItem('stockai_chart_sig_lines') !== '0'; // 기본 ON
    let _chartTpLevel = parseInt(localStorage.getItem('stockai_chart_tp_level') || '1'); // 익절 단계: 1=1차만 2=1~2차 3=전체
    // ── [분석 ▾] 레이어 플래그 — 함수 정의보다 위로 끌어올려 TDZ 방지 ──
    // (이 변수들은 toggleKullamagiLayer 등 여러 곳에서 참조됨)
    let _chartKullamagiEnabled = localStorage.getItem('stockai_chart_kull') !== '0';
    let _chartSepaEnabled      = localStorage.getItem('stockai_chart_sepa') !== '0';
    let _chartSmartDipEnabled  = localStorage.getItem('stockai_chart_smartdip_enabled') === '1';
    let _priceLabelRegistry = []; // 우측 가격 라벨 중복 방지 — ±0.8% 이내 중복 시 낮은 우선순위 라벨 숨김
    let _lastSigArgs = null;  // 토글 시 즉시 재렌더용
    // 마커 캐시 — 줌/스크롤로 차트가 재계산될 때 마커가 사라지는 현상 방지
    // setMarkers 호출 시 항상 _lastMarkers 에도 저장 → visibleRangeChange 등에서 복원 가능
    let _lastMarkers = [];
    // ── 분할차트 가격선 셀별 독립 관리 ────────────────────────────────
    // 각 price line이 어느 candleSeries에 속하는지 Map으로 추적.
    // 렌더 시 현재 셀(lwCandleSeries) 소유 라인만 제거 → 다른 셀 라인은 보존.
    const _plSeries = new Map(); // Map<priceLine, candleSeries>

    // price line 생성 + 소유권 등록 + 배열에 추가
    function _pushPriceLine(arr, pl) {
        if (pl == null) return;
        _plSeries.set(pl, lwCandleSeries);
        arr.push(pl);
    }

    // 배열에서 현재 셀(lwCandleSeries) 소유 라인만 제거, 나머지는 보존해 반환
    function _clearOwnLines(arr) {
        const keep = [];
        arr.forEach(pl => {
            const owner = _plSeries.get(pl) ?? lwCandleSeries;
            if (owner === lwCandleSeries) {
                try { owner.removePriceLine(pl); } catch(e) {}
                _plSeries.delete(pl);
            } else {
                keep.push(pl); // 다른 셀 라인 → 유지
            }
        });
        return keep;
    }
    // ── 가격라인 깜빡임 방지 ─────────────────────────────────────────
    // 봉·종목·타임프레임이 바뀌지 않으면 라인 재빌드를 건너뜀
    let _lastRenderTs  = null;  // 마지막 가격라인 재빌드 봉 시간
    let _lastRenderSym = null;  // 마지막 재빌드 종목
    let _lastRenderTf  = null;  // 마지막 재빌드 타임프레임
    let _layerDirty    = true;  // true → 다음 렌더에서 강제 재빌드 (토글·종목 변경 시 세팅)
    let _signalGrades = {};
    let _lastSymbolForGrades = null; // 종목 변경 감지용 (캐시 무효화)
    // 디폴트: B (C 제거됨 — B/A/S 3단계)
    let _minGradeFilter = localStorage.getItem('stockai_min_grade') || 'B';
    // 'all'/'D'/'C' 잔존값 마이그레이션
    if (_minGradeFilter === 'all' || _minGradeFilter === 'D' || _minGradeFilter === 'C') {
        _minGradeFilter = 'B';
        localStorage.setItem('stockai_min_grade', 'B');
    }
    let _alpacaWs        = null;   // Alpaca WebSocket 연결
    let _wsLiveCandle    = null;   // 현재 형성 중인 실시간 캔들
    let _wsTradeThrottle = 0;      // 캔들 업데이트 스로틀 (ms)
    let _isMobileView = window.innerWidth <= 768; // 모바일 뷰 여부 (라인 개수 자동 제한)

    function _updateChartLinesBtnUi() {
        const btn = document.getElementById('chartSigLinesBtn');
        if (!btn) return;
        if (_chartLinesEnabled) {
            btn.style.color = 'var(--text1)';
            btn.style.background = 'var(--bg2)';
            btn.title = '자동 라인 끄기';
        } else {
            btn.style.color = 'var(--text3)';
            btn.style.background = 'transparent';
            btn.title = '자동 라인 켜기';
        }
    }

    function toggleChartSigLines() {
        _chartLinesEnabled = !_chartLinesEnabled;
        localStorage.setItem('stockai_chart_sig_lines', _chartLinesEnabled ? '1' : '0');
        _updateChartLinesBtnUi();
        if (_lastSigArgs) {
            _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb);
        } else {
            // 캐시 없으면 라인만 제거
            _chartLiveLines = _clearOwnLines(_chartLiveLines);
        }
    }

    // ── 매수·매도 시그널 사운드 알림 (v694) ──────────────────────
    // 차트 사운드 기본값 ON — 사용자가 명시적으로 끄지 않는 한 매수·매도 시그널 발생 시 알림
    // (localStorage 키 부재 시 → ON, '0' 명시 → OFF, '1' 명시 → ON)
    let _chartSoundEnabled = localStorage.getItem('stockai_chart_sound') !== '0';
    let _sigAudioCtx = null;

    function _updateChartSoundBtnUi() {
        const btn = document.getElementById('chartSoundBtn');
        if (!btn) return;
        if (_chartSoundEnabled) {
            btn.style.color = 'var(--text1)';
            btn.style.background = 'var(--bg2)';
            btn.title = '시그널 사운드 끄기';
        } else {
            btn.style.color = 'var(--text3)';
            btn.style.background = 'transparent';
            btn.title = '시그널 사운드 켜기 — 매수·매도 시그널 발생 시 소리 알림';
        }
    }

    // Web Audio 비프음 — buy: 상승 2음 / sell: 하강 2음
    // 알림 사운드 설정 헬퍼 — 설정 모달에서 저장된 값 사용
    function _getNotifSoundCfg() {
        const type = localStorage.getItem('stockai_notif_sound_type') || 'both'; // voice|effect|both|off
        const volPct = parseInt(localStorage.getItem('stockai_notif_volume') || '80', 10);
        const vol = Math.max(0, Math.min(1, (isNaN(volPct) ? 80 : volPct) / 100));
        return { type, vol };
    }

    function _playSignalSound(kind) {
        const cfg = _getNotifSoundCfg();
        if (cfg.type === 'off' || cfg.type === 'voice') return; // 무음 or 목소리만이면 효과음 스킵
        if (cfg.vol <= 0) return;
        try {
            if (!_sigAudioCtx) _sigAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = _sigAudioCtx;
            const fire = () => {
                const tones = kind === 'buy' ? [660, 990] : [520, 350];
                tones.forEach((freq, i) => {
                    const t0 = ctx.currentTime + i * 0.16;
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, t0);
                    gain.gain.setValueAtTime(0.0001, t0);
                    gain.gain.exponentialRampToValueAtTime(0.32 * cfg.vol, t0 + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
                    osc.connect(gain); gain.connect(ctx.destination);
                    osc.start(t0); osc.stop(t0 + 0.16);
                });
            };
            // suspend 상태면 resume 완료 후 재생 (currentTime 유효성 보장)
            if (ctx.state === 'suspended') ctx.resume().then(fire).catch(() => {});
            else fire();
        } catch (e) { warn('[sig-sound]', e?.message); }
    }

    // 음성 안내 — "{종목} 매수/매도" 읽어주기 (v699)
    function _speakSignal(ticker, dirKo) {
        const cfg = _getNotifSoundCfg();
        if (cfg.type === 'off' || cfg.type === 'effect') return; // 무음 or 효과음만이면 TTS 스킵
        if (cfg.vol <= 0) return;
        try {
            const synth = window.speechSynthesis;
            if (!synth) return;
            synth.cancel(); // 이전 발화 중단
            const u = new SpeechSynthesisUtterance(`${ticker}, ${dirKo}`);
            u.lang = 'ko-KR';
            u.rate = 1.05;
            u.volume = cfg.vol;
            synth.speak(u);
        } catch (e) {}
    }

    // AudioContext 깨우기 — 백그라운드 복귀·iOS 자동 suspend 대응 (v697)
    //   브라우저는 페이지가 백그라운드로 가거나 일정 시간 지나면 AudioContext 를
    //   suspend 시킴. setInterval(폴링) 안의 resume() 은 사용자 제스처가 아니라
    //   iOS 등에서 무시됨 → 사용자 제스처마다 resume 호출해 살아있게 유지.
    function _ensureAudioReady() {
        if (!_chartSoundEnabled) return;
        try {
            if (!_sigAudioCtx) _sigAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (_sigAudioCtx.state === 'suspended') _sigAudioCtx.resume();
        } catch (e) {}
    }
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach(ev =>
        document.addEventListener(ev, _ensureAudioReady, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) _ensureAudioReady(); });

    function toggleChartSound() {
        _chartSoundEnabled = !_chartSoundEnabled;
        localStorage.setItem('stockai_chart_sound', _chartSoundEnabled ? '1' : '0');
        _updateChartSoundBtnUi();
        // 켜는 클릭(사용자 제스처)에 AudioContext 활성화 + 확인음 재생
        if (_chartSoundEnabled) {
            _ensureAudioReady();
            _playSignalSound('buy');
            try { showToast('🔔 시그널 사운드 ON — 매수·매도 시그널 발생 시 알림'); } catch(e) {}
        } else {
            try { showToast('🔕 시그널 사운드 OFF'); } catch(e) {}
        }
    }

    // ── 매수·매도 시그널 알림 배너 — 10초 프로그레스바 (v695) ──────
    let _sigAlertTimer = null;
    function _showSignalAlert(text, isBuy, subText) {
        let el = document.getElementById('sigAlert');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sigAlert';
            el.className = 'sig-alert';
            el.innerHTML = `<div class="sig-alert-row">
                    <div class="sig-alert-texts">
                        <div class="sig-alert-msg" id="sigAlertMsg"></div>
                        <div class="sig-alert-sub" id="sigAlertSub"></div>
                    </div>
                    <button class="sig-alert-close" id="sigAlertClose" aria-label="닫기">✕</button>
                </div>
                <div class="sig-alert-track"><div class="sig-alert-bar" id="sigAlertBar"></div></div>`;
            document.body.appendChild(el);
            // 닫기 버튼 — 사용자가 직접 알림 닫기
            el.querySelector('#sigAlertClose').addEventListener('click', (ev) => {
                ev.stopPropagation();
                el.classList.remove('show');
                if (_sigAlertTimer) { clearTimeout(_sigAlertTimer); _sigAlertTimer = null; }
            });
        }
        // 전체화면이면 차트 카드 안으로, 아니면 body 로 — stacking context 보장 (v696)
        //   전체화면 카드(position:fixed, z-index 99999)가 별도 stacking context 라
        //   body 자식 배너는 그 아래로 가려짐 → 카드 안에 넣어 항상 최상단 노출
        const fsCard = document.querySelector('.tv-chart-card.fullscreen');
        const parent = fsCard || document.body;
        if (el.parentElement !== parent) parent.appendChild(el);
        const msg = el.querySelector('#sigAlertMsg');
        const sub = el.querySelector('#sigAlertSub');
        const bar = el.querySelector('#sigAlertBar');
        el.classList.toggle('sig-alert--buy', !!isBuy);
        el.classList.toggle('sig-alert--sell', !isBuy);
        msg.textContent = text;
        if (sub) { sub.textContent = subText || ''; sub.style.display = subText ? '' : 'none'; }
        el.classList.add('show');
        // 프로그레스바 리셋 → 20초 동안 0%로 감소
        bar.style.transition = 'none';
        bar.style.width = '100%';
        void bar.offsetWidth; // reflow 강제 → transition 재시작
        bar.style.transition = 'width 20s linear';
        bar.style.width = '0%';
        // 20초 경과 후 배너 숨김
        if (_sigAlertTimer) clearTimeout(_sigAlertTimer);
        _sigAlertTimer = setTimeout(() => { el.classList.remove('show'); }, 20300);
    }

    // 우측 가격 라벨 + EMA·BB 라인 토글 (한꺼번에 켜기/끄기)
    let _chartLabelsVisible = localStorage.getItem('stockai_chart_labels') === '1'; // 기본 숨김 (사용자가 켤 때만 표시)
    function _applyChartLabelsVisibility() {
        const v = _chartLabelsVisible;
        // 라벨(lastValue) + 라인 자체(visible) 동시 토글
        const applyBoth = s => {
            if (!s || typeof s.applyOptions !== 'function') return;
            try { s.applyOptions({ lastValueVisible: v, visible: v, priceLineVisible: v }); } catch (_) {}
        };
        try { Object.values(lwMaSeries || {}).forEach(s => applyBoth(s)); } catch (_) {}
        applyBoth(lwBbUpper);
        applyBoth(lwBbLower);
        applyBoth(lwBbMiddle);
        try { (_autoTrendLineSeries || []).forEach(s => applyBoth(s)); } catch (_) {}
        const btn = document.getElementById('chartLabelsBtn');
        if (btn) {
            btn.style.color = v ? 'var(--text)' : 'var(--text3)';
            btn.style.background = v ? 'var(--bg3)' : 'transparent';
            btn.title = v ? '보조 라인·라벨 숨기기 (EMA·BB)' : '보조 라인·라벨 표시 (EMA·BB)';
        }
    }
    function toggleChartLabels() {
        _chartLabelsVisible = !_chartLabelsVisible;
        localStorage.setItem('stockai_chart_labels', _chartLabelsVisible ? '1' : '0');
        _applyChartLabelsVisibility();
    }

    function _clearChartLiveSignals() {
        _chartLiveLines = _clearOwnLines(_chartLiveLines);
        _priceLabelRegistry = []; // 라벨 레지스트리도 초기화
        try { lwCandleSeries?.setMarkers([]); } catch(e) {}
        const bar = document.getElementById('chartSigBar');
        if (bar) bar.innerHTML = '';
    }

    // ── 우측 가격 라벨 중복 방지 ──────────────────────────────────
    // priority: 낮을수록 우선순위 높음
    //   1 = 손절선
    //   2 = SD 분할매수 (1~6차) — _renderSplitBuyLayer
    //   3 = 익절 1차
    //   4 = 익절 2~3차 / 지지·저항
    //   5 = 동적 지지 (EMA, VWAP) / 기타
    // ±0.5% 이내 같은 가격대에 더 높은 우선순위 라인이 이미 있으면 axisLabel 숨김
    function _claimPriceLabel(price, priority) {
        if (!price || !isFinite(price) || price <= 0) return false;
        const TOL = price * 0.005;
        const conflict = _priceLabelRegistry.find(p => Math.abs(p.price - price) <= TOL && p.priority <= priority);
        if (!conflict) { _priceLabelRegistry.push({ price, priority }); return true; }
        return false;
    }

    // ── 익절 단계 토글 ────────────────────────────────────────────
    function toggleTpLevel() {
        _chartTpLevel = _chartTpLevel >= 3 ? 1 : _chartTpLevel + 1;
        localStorage.setItem('stockai_chart_tp_level', String(_chartTpLevel));
        _updateTpBtnUi();
        if (_lastSigArgs) { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
        try { _posDrawChartLine(); } catch(e) {}
    }
    // ── 알림 기록 패널 ───────────────────────────────────────────
    let _sigHistoryOpen = false;
    function toggleSigHistoryPanel() {
        _sigHistoryOpen = !_sigHistoryOpen;
        const btn = document.getElementById('sigHistoryBtn');
        if (btn) { btn.style.color = _sigHistoryOpen ? '#F59E0B' : 'var(--text3)'; btn.style.background = _sigHistoryOpen ? 'var(--bg3)' : 'transparent'; }
        const fab = document.getElementById('alertFab');
        if (fab) fab.classList.toggle('active', _sigHistoryOpen);
        _renderSigHistoryPanel();
    }
    // 3일 이내 + 현재 종목 카운트 — 배지에 사용
    function _sigHistoryRecentCount() {
        const cutoff = Date.now() - 3 * 86400000;
        const sym = typeof currentSymbol !== 'undefined' ? currentSymbol : null;
        let n = 0;
        for (const h of _sigHistory) {
            if (h.ts < cutoff) continue;
            if (sym && h.symbol !== sym) continue;
            n++;
        }
        return n;
    }
    function _updateSigHistoryBadge() {
        const count = _sigHistoryRecentCount();
        const badge = document.getElementById('splitCalcAlertBadge');
        if (badge) {
            badge.style.display = count > 0 ? 'inline-block' : 'none';
            badge.textContent = count > 99 ? '99+' : String(count);
        }
    }
    function _renderSigHistoryPanel() {
        // 배지 업데이트 (3일 이내 알림만 카운트)
        const unread = _sigHistoryRecentCount();
        const badge = document.getElementById('sigHistoryBadge');
        if (badge) { badge.style.display = unread > 0 ? '' : 'none'; badge.textContent = unread > 9 ? '9+' : String(unread); }
        // alertFab 배지 동기화
        const fabBadge = document.getElementById('alertFabBadge');
        if (fabBadge) { fabBadge.style.display = unread > 0 ? '' : 'none'; fabBadge.textContent = unread > 9 ? '9+' : String(unread); }
        // splitCalc 알림 버튼 배지 동기화
        _updateSigHistoryBadge();

        let panel = document.getElementById('sigHistoryPanel');
        if (!_sigHistoryOpen) { if (panel) panel.remove(); return; }
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'sigHistoryPanel';
            // 모달 백드롭 오버레이 (화면 중앙 정렬)
            panel.style.cssText = `position:fixed;inset:0;z-index:9500;
                background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;
                padding:20px;font-size:13px;`;
            // 백드롭(모달 바깥) 클릭 시 닫기
            panel.addEventListener('click', e => { if (e.target === panel) toggleSigHistoryPanel(); });
            document.body.appendChild(panel);
        }
        // 필터 상태
        const _flt = panel._filter || 'all';
        // 1) 현재 종목만  2) 최근 3일치  3) 최신순 정렬  4) 매수/매도 필터
        const _cutoff = Date.now() - 3 * 86400000;
        const _curSym = typeof currentSymbol !== 'undefined' ? currentSymbol : null;
        const _base = _sigHistory
            .filter(h => h.ts >= _cutoff)
            .filter(h => !_curSym || h.symbol === _curSym)
            .sort((a, b) => b.ts - a.ts);
        const filtered = _flt === 'all' ? _base : _base.filter(h => h.dir === _flt);
        const fmtTime = ts => {
            const d = new Date(ts);
            const today = new Date();
            const isToday = d.toDateString() === today.toDateString();
            return isToday
                ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        };
        // 헤더
        const bgAll  = _flt==='all'  ? 'var(--bg4)' : 'var(--bg)';
        const bgBuy  = _flt==='buy'  ? 'rgba(239,68,68,.18)' : 'var(--bg)';
        const bgSell = _flt==='sell' ? 'rgba(59,130,246,.18)' : 'var(--bg)';
        const clBuy  = _flt==='buy'  ? '#ef4444' : 'var(--text)';
        const clSell = _flt==='sell' ? '#3b82f6' : 'var(--text)';
        // 모달 박스 (헤더 고정 + 목록 스크롤)
        let html = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;'
            + 'width:min(420px,100%);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;'
            + 'box-shadow:0 12px 48px rgba(0,0,0,.5);">';
        // 헤더 — 현재 종목 표시
        const _hdrSym = _curSym ? ` · ${escHtml(_curSym)}` : '';
        html += '<div style="display:flex;align-items:center;gap:6px;padding:12px 14px;border-bottom:1px solid var(--border);">'
            + '<span style="font-weight:700;font-size:14px;flex:1;">🔔 알림내역' + _hdrSym + '</span>'
            + '<button onclick="document.getElementById(\'sigHistoryPanel\')._filter=\'all\';_renderSigHistoryPanel();" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:' + bgAll + ';color:var(--text);cursor:pointer;">전체</button>'
            + '<button onclick="document.getElementById(\'sigHistoryPanel\')._filter=\'buy\';_renderSigHistoryPanel();" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:' + bgBuy + ';color:' + clBuy + ';cursor:pointer;">매수</button>'
            + '<button onclick="document.getElementById(\'sigHistoryPanel\')._filter=\'sell\';_renderSigHistoryPanel();" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:' + bgSell + ';color:' + clSell + ';cursor:pointer;">매도</button>'
            + '<button onclick="_sigHistory=[];localStorage.removeItem(\'stockai_sig_history\');_renderSigHistoryPanel();" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text3);cursor:pointer;">지우기</button>'
            + '<button onclick="toggleSigHistoryPanel()" style="font-size:16px;padding:2px 6px;border:none;background:transparent;color:var(--text3);cursor:pointer;">✕</button>'
            + '</div>';
        // 목록 (스크롤 영역)
        html += '<div style="overflow-y:auto;flex:1;">';
        if (filtered.length === 0) {
            html += '<div style="padding:32px 24px;text-align:center;color:var(--text3);">알림내역이 없습니다</div>';
        } else {
            // 시그널 가격 포맷터 (KR: 원, US: $)
            const fmtSigPrice = (p, mkt) => {
                if (p == null || !isFinite(p) || p <= 0) return '';
                return mkt === 'KR' ? Math.round(p).toLocaleString() + '원' : '$' + Number(p).toFixed(2);
            };
            filtered.forEach(function(h) {
                const isBuyH  = h.dir === 'buy';
                const rowBg   = isBuyH ? 'rgba(239,68,68,.04)' : 'rgba(59,130,246,.04)';
                const chipBg  = isBuyH ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)';
                const chipCl  = isBuyH ? '#ef4444' : '#3b82f6';
                const dirLbl  = isBuyH ? '매수' : '매도';
                const sub     = h.subText ? '<div style="font-size:11px;color:var(--text3);margin-top:2px;">' + escHtml(h.subText) + '</div>' : '';
                // 종목 티커 배지 — 서로 다른 종목 알림 구분
                const tkr     = h.symbol
                    ? '<span style="display:inline-block;font-size:10px;font-weight:800;background:' + chipBg + ';color:' + chipCl + ';padding:1px 6px;border-radius:4px;margin-right:6px;letter-spacing:.2px;">' + escHtml(h.symbol) + '</span>'
                    : '';
                // 가격 chip (헤드라인 옆) — 매수/매도 동일 색 강조
                const priceStr = fmtSigPrice(h.price, h.market);
                const priceChip = priceStr
                    ? '<span style="display:inline-block;font-size:11px;font-weight:700;color:' + chipCl + ';margin-left:6px;letter-spacing:.2px;">@ ' + escHtml(priceStr) + '</span>'
                    : '';
                html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border);background:' + rowBg + ';">'
                    + '<div style="width:34px;height:20px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;margin-top:1px;background:' + chipBg + ';color:' + chipCl + ';">' + dirLbl + '</div>'
                    + '<div style="flex:1;min-width:0;">'
                    + '<div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + tkr + escHtml(h.headline) + priceChip + '</div>'
                    + sub
                    + '</div>'
                    + '<div style="font-size:10px;color:var(--text3);white-space:nowrap;flex-shrink:0;margin-top:2px;">' + fmtTime(h.ts) + '</div>'
                    + '</div>';
            });
        }
        html += '</div>'; // 목록 스크롤 영역 닫기
        html += '</div>'; // 모달 박스 닫기
        panel.innerHTML = html;
    }

    function _updateTpBtnUi() {
        const btn = document.getElementById('chartTpLevelBtn');
        if (!btn) return;
        const labels = { 1: '익절1', 2: '익절2', 3: '익절全' };
        const titles = {
            1: '익절 1차만 표시 중 — 클릭하면 1~2차 표시',
            2: '익절 1~2차 표시 중 — 클릭하면 1~3차 표시',
            3: '익절 전체(1~3차) 표시 중 — 클릭하면 1차만 표시',
        };
        btn.textContent = labels[_chartTpLevel] || '익절1';
        btn.title = titles[_chartTpLevel] || '';
        if (_chartTpLevel === 1) { btn.style.color = 'var(--text3)'; btn.style.background = 'transparent'; }
        else if (_chartTpLevel === 2) { btn.style.color = 'var(--text1)'; btn.style.background = 'var(--bg2)'; }
        else { btn.style.color = '#22d3ee'; btn.style.background = 'var(--bg2)'; }
    }

    // 스윙 고점/저점 감지 — 좌우 lookback 봉 모두보다 높/낮 + 최소 거리 보장
    function _detectSwingPoints(highs, lows, ts, lookback = 5, minDistBars = 8) {
        const peaks = [], troughs = [];
        const N = highs.length;
        for (let i = lookback; i < N - lookback; i++) {
            const h = highs[i], l = lows[i];
            if (h == null || l == null) continue;
            let isPeak = true, isTrough = true;
            for (let k = 1; k <= lookback; k++) {
                if (highs[i-k] == null || highs[i+k] == null) { isPeak = false; }
                else if (highs[i-k] >= h || highs[i+k] >= h) isPeak = false;
                if (lows[i-k] == null || lows[i+k] == null) { isTrough = false; }
                else if (lows[i-k] <= l || lows[i+k] <= l) isTrough = false;
                if (!isPeak && !isTrough) break;
            }
            if (isPeak)   peaks.push({ i, price: h, ts: ts[i] });
            if (isTrough) troughs.push({ i, price: l, ts: ts[i] });
        }
        // 너무 가까운 점들은 약한 것 제거
        const dedupe = arr => {
            const out = [];
            for (const p of arr) {
                if (out.length && Math.abs(p.i - out[out.length-1].i) < minDistBars) {
                    const prev = out[out.length-1];
                    if (Math.abs(p.price - prev.price) > Math.abs(prev.price * 0.01)) {
                        // 더 강한 것으로 교체
                        if ((arr === peaks && p.price > prev.price) || (arr === troughs && p.price < prev.price)) {
                            out[out.length-1] = p;
                        }
                    }
                    continue;
                }
                out.push(p);
            }
            return out;
        };
        return { peaks: dedupe(peaks), troughs: dedupe(troughs) };
    }

    function _detectMinerviniSetup(candleData) {
        if (!candleData || candleData.length < 200) return null;
        const closes  = candleData.map(c => c.close);
        const highs   = candleData.map(c => c.high);
        const lows    = candleData.map(c => c.low);
        const volumes = candleData.map(c => c.volume);
        const n = closes.length;
        const cur = closes[n - 1];

        const ma50  = calcSMA(closes, 50);
        const ma150 = calcSMA(closes, 150);
        const ma200 = calcSMA(closes, 200);
        const lastMa50 = ma50[n-1], lastMa150 = ma150[n-1], lastMa200 = ma200[n-1];
        if (!lastMa50 || !lastMa150 || !lastMa200) return null;

        const cond1 = cur > lastMa150 && cur > lastMa200;
        const cond2 = lastMa150 > lastMa200;
        const ma200_20ago = ma200[n - 21];
        const cond3 = ma200_20ago != null && lastMa200 > ma200_20ago;
        const cond4 = lastMa50 > lastMa150 && lastMa150 > lastMa200;
        const cond5 = cur > lastMa50;
        const low52w  = Math.min(...lows.slice(-252));
        const high52w = Math.max(...highs.slice(-252));
        const cond6 = (cur - low52w) / low52w >= 0.30;
        const cond7 = (high52w - cur) / high52w <= 0.25;
        const rs1m = n > 21  ? (cur / closes[n-21]  - 1) * 100 : 0;
        const rs3m = n > 63  ? (cur / closes[n-63]  - 1) * 100 : 0;
        const rs6m = n > 126 ? (cur / closes[n-126] - 1) * 100 : 0;
        const rsScore = rs1m * 0.4 + rs3m * 0.3 + rs6m * 0.3;
        const cond8 = rsScore >= 15;

        const trendTemplateScore = [cond1,cond2,cond3,cond4,cond5,cond6,cond7,cond8].filter(Boolean).length;
        const isStage2 = trendTemplateScore >= 7;

        if (!isStage2) return { signal: false, reason: 'Stage 2 미충족', trendTemplateScore, conds:{cond1,cond2,cond3,cond4,cond5,cond6,cond7,cond8} };

        // VCP
        const vcpWindow = 40;
        const s1 = closes.slice(-vcpWindow, -Math.floor(vcpWindow*2/3));
        const s2 = closes.slice(-Math.floor(vcpWindow*2/3), -Math.floor(vcpWindow/3));
        const s3 = closes.slice(-Math.floor(vcpWindow/3));
        const rng = arr => arr.length < 2 ? 0 : (Math.max(...arr) - Math.min(...arr)) / Math.min(...arr) * 100;
        const range1 = rng(s1), range2 = rng(s2), range3 = rng(s3);
        const isVCP = range1 > range2 && range2 > range3 && range3 < range1 * 0.6;

        // Pivot
        const pivot = s3.length > 0 ? Math.max(...s3) : cur;
        const pivotBroken = cur > pivot * 0.998;

        // Volume
        const vols = volumes.slice(-50).filter(v => v != null);
        const avgVol50 = vols.length > 0 ? vols.reduce((a,b)=>a+b,0)/vols.length : 0;
        const curVol = volumes[n-1] || 0;
        const volRatio = avgVol50 > 0 ? curVol / avgVol50 : 0;
        const volConfirm = volRatio >= 1.5;

        const entrySignal = isStage2 && isVCP && pivotBroken && volConfirm;

        const atrArr = calcATR(highs, lows, closes, 14);
        const atr = atrArr[atrArr.length-1] || 0;

        const entryPrice = cur;
        const stopLoss   = +(entryPrice * 0.925).toFixed(2);
        const tp1Price   = +(entryPrice * 1.10).toFixed(2);
        const tp2Price   = +(entryPrice * 1.25).toFixed(2);
        const tp3Price   = +(entryPrice * 1.50).toFixed(2);

        return {
            signal: entrySignal, stage2: isStage2, vcp: isVCP,
            pivot: +pivot.toFixed(2), pivotBroken, volRatio: +volRatio.toFixed(2), volConfirm,
            rsScore: +rsScore.toFixed(1), trendTemplateScore, atr,
            entryPrice, stopLoss, tp1Price, tp2Price, tp3Price,
            rs1m: +rs1m.toFixed(1), rs3m: +rs3m.toFixed(1), rs6m: +rs6m.toFixed(1),
            ranges: { range1: +range1.toFixed(1), range2: +range2.toFixed(1), range3: +range3.toFixed(1) },
        };
    }

    // ── 등급 캐시 무효화 (종목 변경 시만) ─────────────────────────────
    function _maybeInvalidateGradesCache() {
        if (_lastSymbolForGrades !== currentSymbol) {
            _signalGrades = {};
            _lastSigGrade = null; // 종목 변경 시 마지막 등급도 리셋 → 새 종목 첫 시그널이 패널에 반영되도록
            try { window._lastSigGrade = null; } catch(_){}
            _lastSymbolForGrades = currentSymbol;
            log('[grade] cache invalidated for', currentSymbol);
        }
    }

    // ── 등급 캐시 우선 조회 헬퍼 ──────────────────────────────────────
    // isLastBar=true: 실시간 봉 → 항상 재계산 (마지막 봉 close가 계속 변동)
    // isLastBar=false: 확정된 과거 봉 → 캐시 우선 사용 (등급 안정)
    // 최신 캔들 등급 캐시 — 신호 등급 패널 렌더에 사용
    // _lastSigGrade.ts 추가 → 마지막 봉이 아닌 어떤 봉에서 마지막으로 시그널이 발생했는지 추적
    let _lastSigGrade = null;
    function _gradeForBar(cacheKey, opts, isLastBar) {
        // 모든 호출에서 시그널이 감지된 경우 → _lastSigGrade 최신화 (timestamp 기반 비교)
        try {
            const sg = _calcSignalGrade(opts);
            if (sg && sg.grade) {
                _signalGrades[cacheKey] = sg;
                // cacheKey 형식: `${ts[i]}_<sig_key>` — ts 추출
                const tsMatch = cacheKey.match(/^(\d+)_/);
                const sigTs = tsMatch ? parseInt(tsMatch[1], 10) : null;
                if (!_lastSigGrade || (sigTs && sigTs >= (_lastSigGrade.ts || 0))) {
                    _lastSigGrade = { ...sg, signalType: opts?.signalType || 'buy', ts: sigTs };
                    try { window._lastSigGrade = _lastSigGrade; } catch(_){}
                }
                return sg;
            }
        } catch(e) {}
        return _signalGrades[cacheKey] || { grade: 'B', fallback: true, winRate: 60, score: 5 };
    }

    // 신호 등급 패널 렌더링 — _lastSigGrade 기준
    // 마지막 분석 시각 — pulse + "방금/N초 전" 표시
    let _sigPanelLastUpdate = 0;
    function _fmtRelativeShort(ms) {
        const s = Math.floor(ms / 1000);
        if (s < 5)    return '방금';
        if (s < 60)   return s + '초 전';
        if (s < 3600) return Math.floor(s / 60) + '분 전';
        return Math.floor(s / 3600) + '시간 전';
    }
    // 패널 표시 중에는 1초마다 "방금/N초 전" 라벨 갱신
    let _sigPanelTickTimer = null;
    function _startSigPanelTick() {
        if (_sigPanelTickTimer) return;
        _sigPanelTickTimer = setInterval(() => {
            const el = document.getElementById('sgpRefreshTime');
            if (!el || !_sigPanelLastUpdate) return;
            el.textContent = _fmtRelativeShort(Date.now() - _sigPanelLastUpdate);
        }, 1000);
    }

    // ── 신호 등급 패널 드래그 핸들러 (플로팅 모드) ────────────────
    function _attachSgpDrag(panel) {
        if (!panel || panel._sgpDragHooked) return;
        panel._sgpDragHooked = true;
        let startX = 0, startY = 0, origLeft = 0, origBottom = 0, dragging = false, moved = false;
        const onDown = (e) => {
            // 토글 버튼 / 인터랙티브 자식 클릭은 드래그 시작 안 함
            const t = e.target;
            if (t.closest && (t.closest('button') || t.closest('a') || t.closest('input'))) return;
            const pt = e.touches ? e.touches[0] : e;
            startX = pt.clientX; startY = pt.clientY;
            const rect = panel.getBoundingClientRect();
            const parentRect = panel.parentElement.getBoundingClientRect();
            origLeft   = rect.left - parentRect.left;
            // bottom 거리 = 부모 하단 - 패널 하단
            origBottom = parentRect.bottom - rect.bottom;
            dragging = true; moved = false;
            panel.classList.add('sgp-dragging');
        };
        const onMove = (e) => {
            if (!dragging) return;
            const pt = e.touches ? e.touches[0] : e;
            const dx = pt.clientX - startX;
            const dy = pt.clientY - startY;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return; // 미세 움직임 무시
            moved = true;
            const parent = panel.parentElement;
            const maxX = parent.clientWidth  - panel.offsetWidth - 4;
            const maxB = parent.clientHeight - panel.offsetHeight - 4;
            const nx = Math.max(4, Math.min(maxX, origLeft + dx));
            // 하단 기준: 마우스가 아래로 가면 bottom 줄어듦
            const nb = Math.max(4, Math.min(maxB, origBottom - dy));
            panel.style.left   = nx + 'px';
            panel.style.bottom = nb + 'px';
            panel.style.top    = 'auto';
            if (e.cancelable) e.preventDefault();
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            panel.classList.remove('sgp-dragging');
            if (moved) {
                // 위치 저장 + 토글 클릭 방지 (드래그 직후 click 차단)
                try {
                    localStorage.setItem('stockai_sgp_pos_v2', JSON.stringify({
                        left:   parseFloat(panel.style.left)   || 0,
                        bottom: parseFloat(panel.style.bottom) || 0,
                    }));
                } catch(_) {}
                panel._suppressClickUntil = Date.now() + 250;
            }
        };
        panel.addEventListener('mousedown', onDown);
        panel.addEventListener('touchstart', onDown, { passive: true });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
        // 드래그 직후 헤더 클릭(접기 토글)이 잘못 발화하지 않도록
        const header = panel.querySelector('.sgp-header');
        if (header) {
            header.addEventListener('click', (e) => {
                if (panel._suppressClickUntil && Date.now() < panel._suppressClickUntil) {
                    e.stopPropagation(); e.preventDefault();
                }
            }, true);
        }
    }

    function _renderSigGradePanel() {
        const panel = document.getElementById('sigGradePanel');
        if (!panel) return;
        // ── 플로팅 위치 보장: chartCell1 안으로 이동 (한번만) ──
        // tvChartCard 의 flex item 으로 있으면 차트 영역을 침해하므로
        // chart-cell1 (position:relative) 내부로 옮겨 절대 위치 플로팅으로 만듦.
        if (!panel._sgpReparented) {
            const target = document.getElementById('chartCell1');
            if (target && panel.parentElement !== target) {
                target.appendChild(panel);
                panel._sgpReparented = true;
                panel.classList.add('sgp-floating');
                // 저장된 위치 복원 (v2 키 — 좌하단 기준)
                // 구버전 stockai_sgp_pos 는 상단 기준이므로 무시
                try { localStorage.removeItem('stockai_sgp_pos'); } catch(_) {}
                try {
                    const saved = JSON.parse(localStorage.getItem('stockai_sgp_pos_v2') || 'null');
                    if (saved && typeof saved.left === 'number' && typeof saved.bottom === 'number') {
                        panel.style.left   = saved.left + 'px';
                        panel.style.bottom = saved.bottom + 'px';
                        panel.style.top    = 'auto';
                    }
                } catch(_) {}
                _attachSgpDrag(panel);
            }
        }
        // 신호 라인 비활성 시 숨김
        if (!_chartLinesEnabled) { panel.style.display = 'none'; return; }
        // 갱신 트래킹 — 패널 렌더할 때마다 시각 기록 + pulse 애니메이션
        _sigPanelLastUpdate = Date.now();
        panel.classList.remove('sgp-pulse');
        void panel.offsetWidth; // reflow
        panel.classList.add('sgp-pulse');
        const refreshTime = document.getElementById('sgpRefreshTime');
        if (refreshTime) refreshTime.textContent = '방금';
        _startSigPanelTick();
        // 등급 없으면 빈 상태 카드 (분석 대기 중)
        if (!_lastSigGrade) {
            panel.style.display = '';
            const badge = document.getElementById('sgpBadge');
            if (badge) { badge.textContent = '—'; badge.style.background = 'var(--bg3)'; badge.style.borderColor = 'var(--border)'; badge.style.color = 'var(--text2)'; }
            const winRateEl = document.getElementById('sgpWinRate');
            if (winRateEl) winRateEl.textContent = '분석 대기 중';
            // 빈 상태에서도 점수/TF/최약조건 초기화
            const scoreEl = document.getElementById('sgpScore');
            if (scoreEl) scoreEl.textContent = '—';
            const fillEl = document.getElementById('sgpScoreFill');
            if (fillEl) fillEl.style.width = '0%';
            const weakEl = document.getElementById('sgpWeak');
            if (weakEl) { weakEl.textContent = ''; weakEl.style.display = 'none'; }
            const tfEl = document.getElementById('sgpTf');
            if (tfEl) {
                const _iv = (typeof currentInterval !== 'undefined' && currentInterval) || '5m';
                tfEl.textContent = ({'1m':'1분','2m':'2분','5m':'5분','15m':'15분','30m':'30분','60m':'1시간','1h':'1시간','1d':'일','1wk':'주','1mo':'월'}[_iv]) || _iv;
            }
            const body = document.getElementById('sgpBody');
            if (body) body.innerHTML = '<div class="sgp-empty">아직 강한 시그널이 감지되지 않았습니다 — 폴링 중...</div>';
            return;
        }
        const sg = _lastSigGrade;
        const grade = sg.grade || 'B';
        const winRate = sg.winRate ?? 60;
        const factors = Array.isArray(sg.factors) ? sg.factors : [];

        // 등급별 색상 — 라이트 모드의 S 는 가독성 위해 검정으로 분기
        const _isLightTheme = (document.documentElement.getAttribute('data-theme') || 'dark') === 'light';
        const gradeMeta = {
            S: _isLightTheme
                ? { bg:'rgba(0,0,0,.08)',     bc:'#111111', cl:'#111111' }   // 라이트: 검정
                : { bg:'rgba(255,215,0,.18)', bc:'#FFD700', cl:'#FFD700' },  // 다크: 금색
            A: { bg:'rgba(34,197,94,.18)',   bc:'#22C55E', cl:'#22C55E' },
            B: { bg:'rgba(59,130,246,.18)',  bc:'#3B82F6', cl:'#3B82F6' },
            C: { bg:'rgba(156,163,175,.18)', bc:'#9CA3AF', cl:'#9CA3AF' },
        }[grade] || { bg:'rgba(59,130,246,.18)', bc:'#3B82F6', cl:'#3B82F6' };
        const badge = document.getElementById('sgpBadge');
        if (badge) {
            badge.textContent = grade;
            badge.style.background = gradeMeta.bg;
            badge.style.borderColor = gradeMeta.bc;
            badge.style.color = gradeMeta.cl;
        }
        const winRateEl = document.getElementById('sgpWinRate');
        if (winRateEl) winRateEl.textContent = `승률 ${winRate}%`;

        // ── 추가 UX (강화된 패널) ──
        // TF 라벨 — 1m/2m/5m/15m/30m/60m/1d 등
        const tfEl = document.getElementById('sgpTf');
        if (tfEl) {
            const _iv = (typeof currentInterval !== 'undefined' && currentInterval) || '5m';
            const tfLabel = {
                '1m':'1분','2m':'2분','5m':'5분','15m':'15분','30m':'30분',
                '60m':'1시간','1h':'1시간','1d':'일','1wk':'주','1mo':'월'
            }[_iv] || _iv;
            tfEl.textContent = tfLabel;
        }
        // 점수 (0~10) + 진행률 바
        const scoreVal = Math.max(0, Math.min(10, +(sg.score || 0)));
        const scoreEl = document.getElementById('sgpScore');
        if (scoreEl) scoreEl.textContent = scoreVal.toFixed(1);
        const fillEl = document.getElementById('sgpScoreFill');
        if (fillEl) fillEl.style.width = (scoreVal / 10 * 100) + '%';
        // 최약 조건 — ❌/⚠️/🟡/⚪ 우선순위로 첫번째 추출 (factors + weakFactors)
        const weakEl = document.getElementById('sgpWeak');
        if (weakEl) {
            const weakArr = Array.isArray(sg.weakFactors) ? sg.weakFactors : [];
            const all = [...factors, ...weakArr];
            const weakOne = all.find(f => f.startsWith('❌'))
                         || all.find(f => f.startsWith('⚠️'))
                         || all.find(f => f.startsWith('🟡'))
                         || all.find(f => f.startsWith('⚪'));
            if (weakOne) {
                const txt = weakOne.replace(/^[❌⚠️🟡✅⚪]\s*/, '').slice(0, 18);
                weakEl.textContent = '⚠ ' + txt;
                weakEl.title = weakOne;
                weakEl.style.display = '';
            } else {
                weakEl.textContent = '';
                weakEl.style.display = 'none';
            }
        }

        // body — 컨플루언스 조건 체크리스트 (통과 + 미달 모두 표시 = 10개 풀 체크)
        const body = document.getElementById('sgpBody');
        if (body) {
            const weakArr2 = Array.isArray(sg.weakFactors) ? sg.weakFactors : [];
            const allConds = [...factors, ...weakArr2];
            // 다음 등급까지 부족 점수 계산 + 가장 큰 영향 미달 조건 1개
            const sc = +sg.score || 0;
            // weakFactors 는 잠재 점수 큰 순으로 정렬되어 있음 → 첫번째가 최고 leverage
            const _bestWeak = weakArr2[0] || '';
            // 라벨에서 잠재 점수 부분만 추출 (예: "⚪ 추세 미정렬 (잠재 +2)" → 라벨 + +2)
            const _bestWeakLabel = _bestWeak.replace(/^⚪\s*/, '').replace(/\s*\(잠재 \+[\d.]+\)$/, '');
            const _bestWeakPtsM = _bestWeak.match(/\(잠재 \+([\d.]+)\)$/);
            const _bestWeakPts = _bestWeakPtsM ? _bestWeakPtsM[1] : null;
            const _bestHtml = _bestWeakPts
                ? ` <span class="sgp-best-tip">→ <b>${escHtml(_bestWeakLabel)}</b> 충족 시 <b style="color:#22C55E;">+${_bestWeakPts}</b></span>`
                : '';
            let nextHtml = '';
            if (sc >= 9)      nextHtml = `<div class="sgp-next-grade max-grade">🏆 최고 등급 <b>S</b> 달성 — 모든 조건 충족됨</div>`;
            else if (sc >= 7) nextHtml = `<div class="sgp-next-grade"><span class="sgp-next-grade-badge" style="background:rgba(255,215,0,.16);color:#FFD700;border-color:rgba(255,215,0,.35);">S</span>등급까지 <span class="sgp-next-grade-pts">${(9-sc).toFixed(1)}점</span> 부족${_bestHtml}</div>`;
            else if (sc >= 5) nextHtml = `<div class="sgp-next-grade"><span class="sgp-next-grade-badge">A</span>등급까지 <span class="sgp-next-grade-pts">${(7-sc).toFixed(1)}점</span> 부족${_bestHtml}</div>`;
            else              nextHtml = `<div class="sgp-next-grade"><span class="sgp-next-grade-badge" style="background:rgba(59,130,246,.16);color:#3B82F6;border-color:rgba(59,130,246,.35);">B</span>등급까지 <span class="sgp-next-grade-pts">${(5-sc).toFixed(1)}점</span> 부족${_bestHtml}</div>`;

            if (!allConds.length) {
                body.innerHTML = nextHtml + '<div class="sgp-empty">데이터 부족 — 조건을 분석할 수 없습니다</div>';
            } else {
                // 첫번째 weak 가 'best leverage' — 별도 highlight 클래스 추가
                let weakSeen = 0;
                body.innerHTML = nextHtml + allConds.map(f => {
                    const isWeak = f.startsWith('⚪');
                    const cls = f.startsWith('✅') ? 'sgp-cond-pass'
                              : f.startsWith('🟡') ? 'sgp-cond-mid'
                              : f.startsWith('❌') ? 'sgp-cond-fail'
                              : f.startsWith('⚠️') ? 'sgp-cond-fail'
                              : isWeak ? 'sgp-cond-skip'
                              : 'sgp-cond-other';
                    let extraCls = '';
                    if (isWeak) {
                        if (weakSeen === 0) extraCls = ' sgp-cond-best-leverage';
                        weakSeen++;
                    }
                    return `<div class="sgp-condition ${cls}${extraCls}">${escHtml(f)}</div>`;
                }).join('');
            }
        }

        // 접기/펴기 상태 복원
        const collapsed = localStorage.getItem('stockai_sgp_collapsed') === '1';
        panel.classList.toggle('collapsed', collapsed);
        const toggle = document.getElementById('sgpToggle');
        if (toggle) toggle.textContent = collapsed ? '▸' : '▾';

        panel.style.display = '';
    }

    function _toggleSigGradePanel() {
        const panel = document.getElementById('sigGradePanel');
        if (!panel) return;
        const cur = panel.classList.toggle('collapsed');
        localStorage.setItem('stockai_sgp_collapsed', cur ? '1' : '0');
        const toggle = document.getElementById('sgpToggle');
        if (toggle) toggle.textContent = cur ? '▸' : '▾';
    }
    try { window._toggleSigGradePanel = _toggleSigGradePanel; } catch(_) {}

    function renderChartLiveSignals(candleData, ts, q, bb) {
        _isMobileView = window.innerWidth <= 768; // 렌더 시마다 갱신
        const bar = document.getElementById('chartSigBar');
        if (!bar || !lwCandleSeries || !candleData?.length) return;
        _lastSigArgs = { candleData, ts, q, bb }; // 토글 시 즉시 재렌더용
        try { window._lastSigArgs = _lastSigArgs; _updateJumpBtnVisibility?.(); _cnbUpdatePresetUi?.(); _renderChartHeaderAt?.(); } catch(_) {}
        // Phase X1-b: 활성 셀 캐시 갱신 (셀 전환 시 재빌드에 사용)
        const _xcAc = _xcCells[_xcActiveCellId];
        if (_xcAc) { _xcAc._lastCandleData = candleData; _xcAc._lastTs = ts; _xcAc._lastQ = q; }
        if (_xcActiveCellId === 'cell1') { try { _xcUpdateCellOhlc('cell1'); } catch(_){} }
        _updateChartLinesBtnUi();
        _updateChartSoundBtnUi();
        _updateTpBtnUi();
        try { _updateDdStates(); } catch(_) {}

        // ── 가격라인 재빌드 판단 (깜빡임 방지) ─────────────────────────────
        // 봉 시간·종목·타임프레임이 동일하면 라인 rebuild 생략 → 폴링 깜빡임 제거
        const _curLastTs = ts?.[ts.length - 1] ?? null;
        const _doRebuild = _layerDirty
            || _curLastTs      !== _lastRenderTs
            || currentSymbol   !== _lastRenderSym
            || currentInterval !== _lastRenderTf;
        if (_doRebuild) {
            _layerDirty    = false;
            _lastRenderTs  = _curLastTs;
            _lastRenderSym = currentSymbol;
            _lastRenderTf  = currentInterval;
            // 기존 가격 라인 제거 + 레지스트리 초기화 (레이어 재빌드 전에만 수행)
            _chartLiveLines = _clearOwnLines(_chartLiveLines);
            _priceLabelRegistry = [];
        }
        // 캔들 마커 초기화 — _doRebuild 시에만 실제로 클리어
        // (줌/스크롤로 폴링이 fire될 때 마커가 사라지는 현상 방지)
        if (_doRebuild) {
            try { lwCandleSeries?.setMarkers([]); _lastMarkers = []; } catch(e) {}
        }

        const closes = q.close, highs = q.high, lows = q.low;
        const lastVal = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
        const findLastIdx = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; };

        // 1) 지표 계산 — 각각 try/catch: 데이터 이상으로 throw해도 나머지 배지는 유지
        let rsi = [], macdLine = [], signalLine = [], histogram = [];
        try { rsi = calcRSI(closes); } catch(e) {}
        // MACD 파라미터 — 분봉별 최적화 (짧은 TF는 더 빠른 응답)
        //   5m 이하 → (5,13,4)   15m → (8,17,6)   30m → (10,21,7)   1h+ → (12,26,9) 표준
        try {
            const _macIv = typeof currentInterval !== 'undefined' ? (currentInterval || '') : '';
            const _macP  = /^(1m|2m|5m)$/.test(_macIv) ? [5, 13, 4]
                         : _macIv === '15m'           ? [8, 17, 6]
                         : _macIv === '30m'           ? [10, 21, 7]
                         :                              [12, 26, 9];
            const _m = calcMACD(closes, _macP[0], _macP[1], _macP[2]);
            macdLine = _m.macdLine; signalLine = _m.signalLine; histogram = _m.histogram;
        } catch(e) {}
        // 실시간 현재가 우선 사용 (프리마켓/애프터마켓 포함)
        const _livePx = (typeof _posCurrentPrice === 'function') ? _posCurrentPrice() : null;
        const lastClose = (_livePx != null && _livePx > 0) ? _livePx : lastVal(closes);
        const lastRSI = lastVal(rsi);
        const lastMACD = lastVal(macdLine);
        const lastSig  = lastVal(signalLine);
        const lastBBU = bb ? lastVal(bb.upper) : null;
        const lastBBL = bb ? lastVal(bb.lower) : null;

        // 차트 좌상단 지표 오버레이 (RSI + MACD diff)
        try {
            const _indOv = document.getElementById('chartIndOverlay');
            if (_indOv) {
                const rTxt = lastRSI != null ? `RSI <b>${lastRSI.toFixed(1)}</b>` : '';
                const mDiff = lastMACD != null && lastSig != null ? lastMACD - lastSig : null;
                const mColor = mDiff != null ? (mDiff >= 0 ? '#f87171' : '#60a5fa') : '';
                const mTxt = mDiff != null
                    ? `MACD <b style="color:${mColor}">${mDiff >= 0 ? '+' : ''}${mDiff.toFixed(2)}</b>`
                    : '';
                _indOv.innerHTML = [rTxt, mTxt].filter(Boolean).join('&nbsp;&nbsp;');
            }
        } catch(_) {}

        // 2) 배지 생성 — 한국식: 강세=빨강, 약세=파랑
        const badges = [];
        if (lastRSI != null) {
            if (lastRSI >= 70) badges.push({ label: `RSI ${lastRSI.toFixed(0)} 과매수`, cls: 'sig-red' });
            else if (lastRSI <= 30) badges.push({ label: `RSI ${lastRSI.toFixed(0)} 과매도`, cls: 'sig-blue' });
            else badges.push({ label: `RSI ${lastRSI.toFixed(0)}`, cls: 'sig-neutral' });
        }
        // MACD 골든/데드 크로스 — 최근 5봉 안에서 교차 발생했는지
        if (lastMACD != null && lastSig != null) {
            let crossIdx = -1, crossDir = null;
            const mIdx = findLastIdx(macdLine);
            for (let i = Math.max(1, mIdx - 5); i <= mIdx; i++) {
                if (macdLine[i] == null || signalLine[i] == null || macdLine[i-1] == null || signalLine[i-1] == null) continue;
                const prev = macdLine[i-1] - signalLine[i-1];
                const cur = macdLine[i] - signalLine[i];
                if (prev <= 0 && cur > 0) { crossIdx = i; crossDir = 'golden'; }
                else if (prev >= 0 && cur < 0) { crossIdx = i; crossDir = 'dead'; }
            }
            if (crossDir === 'golden') badges.push({ label: 'MACD 골든크로스', cls: 'sig-red' });
            else if (crossDir === 'dead') badges.push({ label: 'MACD 데드크로스', cls: 'sig-blue' });
            else badges.push({ label: lastMACD > lastSig ? 'MACD 양(+)' : 'MACD 음(-)',
                                cls: lastMACD > lastSig ? 'sig-red' : 'sig-blue' });
        }
        // 볼린저밴드 위치
        if (lastBBU != null && lastBBL != null && lastClose != null) {
            if (lastClose >= lastBBU * 0.998) badges.push({ label: 'BB 상단', cls: 'sig-red' });
            else if (lastClose <= lastBBL * 1.002) badges.push({ label: 'BB 하단', cls: 'sig-blue' });
        }
        // Rayner Stage 배지 (가장 앞에) — try/catch: 실패해도 RSI·MACD 배지는 표시
        // let 선언 필수: ema20Data·ema50Data·ema200Data·stageInfo 는 아래 마커 루프에서도 사용
        let ema20Data = [], ema50Data = [], ema200Data = [], stageInfo = null;
        try {
            ema20Data  = lwMaSeries.ema20_data  || calcEMA(closes, 20);
            ema50Data  = lwMaSeries.ema50_data  || calcEMA(closes, 50);
            ema200Data = lwMaSeries.ema200_data || calcEMA(closes, 200);
            stageInfo = _detectMarketStage(closes, ema200Data, ema50Data);
            if (stageInfo) {
                const cls = stageInfo.stage === 2 ? 'sig-red'
                           : stageInfo.stage === 4 ? 'sig-blue'
                           : stageInfo.stage === 3 ? 'sig-neutral' : 'sig-neutral';
                badges.unshift({ label: `Stage ${stageInfo.stage} · ${stageInfo.label}`, cls });
            }
        } catch(e) {}
        bar.innerHTML = badges.map(b => `<span class="chart-sig-pill ${b.cls}">${escHtml(b.label)}</span>`).join('');

        // 포지션 손절/익절 근접 알림 배지
        try {
            const _pa = (typeof _posActiveForTicker === 'function') ? _posActiveForTicker(currentSymbol) : null;
            if (_pa && lastClose != null && (_pa.status === 'holding' || _pa.status === 'watching')) {
                const _fmtPr = p => _posFmtP(p, currentMarket);
                if (_pa.tp2 && lastClose >= _pa.tp2 * 0.99) {
                    bar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill sig-red pos-alert-pill">💰💰 2차 익절 근접 ${_fmtPr(_pa.tp2)}</span>`);
                } else if (_pa.tp1 && lastClose >= _pa.tp1 * 0.99) {
                    bar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill sig-red pos-alert-pill">💰 1차 익절 근접 ${_fmtPr(_pa.tp1)}</span>`);
                }
                if (_pa.stopLoss && lastClose <= _pa.stopLoss * 1.005) {
                    bar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill sig-blue pos-alert-pill">⚠️ 손절선 근접 ${_fmtPr(_pa.stopLoss)}</span>`);
                }
            }
        } catch(e) {}

        // 3) 매수·매도 마커 — RSI 반전 + MACD 교차
        // ── 등급 계산 공통 변수 (모든 마커 섹션에서 공유) ──────────
        const opens     = q.open    || [];
        const volumes   = q.volume  || [];
        const emaC20    = calcEMA(closes, 20);
        const emaC60    = calcEMA(closes, 60);
        const emaC120   = calcEMA(closes, 120);
        const emaC240   = calcEMA(closes, 240);
        const _v3AtrArr = calcATR(q.high, q.low, q.close, 14);
        _maybeInvalidateGradesCache(); // 종목 변경 시만 초기화, 폴링 시는 캐시 유지
        const _lastBarIdx = closes.length - 1; // 마지막 봉 인덱스 (실시간 봉)
        if (!window._smartDipAnalysis) window._smartDipAnalysis = {};
        // 모든 마커에 공유되는 _calcSignalGrade 기본 opts
        const _gradeBase = {
            closes, highs, lows, opens, volumes, rsi,
            ma20: emaC20, ma60: emaC60, ma120: emaC120, ma240: emaC240,
            macd: macdLine, macdSignal: signalLine,
            atr: _v3AtrArr, bb,
        };
        // 시그널 마커 색상 — 캔들(빨강/초록/파랑)과 명확히 차별화되는 채도 높은 톤
        // S: 금색 / A: 사이안(청록) / B: 보라 / C: 회색
        const _gc = g => g === 'S' ? '#FFD700' : g === 'A' ? '#00E5FF' : g === 'B' ? '#A855F7' : '#9CA3AF';

        const markers = [];
        // RSI: 과매도(<30)에서 다음봉 상승 → 매수 △ / 과매수(>70)에서 다음봉 하락 → 매도 ▽
        for (let i = 14; i < rsi.length - 1; i++) {
            if (rsi[i] == null || rsi[i+1] == null) continue;
            if (rsi[i] <= 30 && rsi[i+1] > 30 && closes[i+1] > closes[i]) {
                const sg = _gradeForBar(`${ts[i+1]}_rsi_buy`, { ..._gradeBase, i: i+1, signalType: 'buy' }, i+1 === _lastBarIdx);
                if (_passesGradeFilter(sg.grade, sg.fallback)) {
                    markers.push({ time: ts[i+1], position: 'belowBar', color: _gc(sg.grade), shape: 'arrowUp', _label: `RSI매수 [${sg.grade}]` });
                }
            } else if (rsi[i] >= 70 && rsi[i+1] < 70 && closes[i+1] < closes[i]) {
                const sg = _gradeForBar(`${ts[i+1]}_rsi_sell`, { ..._gradeBase, i: i+1, signalType: 'sell' }, i+1 === _lastBarIdx);
                if (_passesGradeFilter(sg.grade, sg.fallback)) {
                    markers.push({ time: ts[i+1], position: 'aboveBar', color: _gc(sg.grade), shape: 'arrowDown', _label: `RSI매도 [${sg.grade}]` });
                }
            }
        }
        // MACD 골든/데드 크로스 마커
        for (let i = 26; i < macdLine.length; i++) {
            if (macdLine[i] == null || signalLine[i] == null || macdLine[i-1] == null || signalLine[i-1] == null) continue;
            const prev = macdLine[i-1] - signalLine[i-1];
            const cur  = macdLine[i]   - signalLine[i];
            if (prev <= 0 && cur > 0) {
                const sg = _gradeForBar(`${ts[i]}_macd_buy`, { ..._gradeBase, i, signalType: 'buy' }, i === _lastBarIdx);
                if (_passesGradeFilter(sg.grade, sg.fallback)) {
                    markers.push({ time: ts[i], position: 'belowBar', color: _gc(sg.grade), shape: 'arrowUp', _label: `MACD매수 [${sg.grade}]` });
                }
            } else if (prev >= 0 && cur < 0) {
                const sg = _gradeForBar(`${ts[i]}_macd_sell`, { ..._gradeBase, i, signalType: 'sell' }, i === _lastBarIdx);
                if (_passesGradeFilter(sg.grade, sg.fallback)) {
                    markers.push({ time: ts[i], position: 'aboveBar', color: _gc(sg.grade), shape: 'arrowDown', _label: `MACD매도 [${sg.grade}]` });
                }
            }
        }
        // Rayner 진입 마커 (풀백/브레이크아웃/반전)
        const raynerEntries = _detectRaynerEntries(stageInfo, closes, q.volume || [], ema20Data, ema50Data, ema200Data, ts);
        raynerEntries.forEach(e => {
            const sg = _gradeForBar(`${e.time}_rayner_buy`, { ..._gradeBase, i: e.idx, signalType: 'buy' }, e.idx === _lastBarIdx);
            if (_passesGradeFilter(sg.grade, sg.fallback)) {
                markers.push({ time: e.time, position: 'belowBar', color: e.color, shape: 'arrowUp', _label: `${e.label} [${sg.grade}]` });
            }
        });
        // 캔들 패턴 마커 (최근 5봉)
        const candlePatterns = _detectCandlePatterns(q.open, highs, lows, closes, 5);
        candlePatterns.forEach(p => {
            const t = ts[p.idx];
            if (t == null) return;
            const isBull = p.dir === 'bull';
            const isBear = p.dir === 'bear';
            const sigT = isBull ? 'buy' : isBear ? 'sell' : 'buy';
            const sg = _gradeForBar(`${t}_candle_${sigT}`, { ..._gradeBase, i: p.idx, signalType: sigT }, p.idx === _lastBarIdx);
            if (_passesGradeFilter(sg.grade, sg.fallback)) {
                markers.push({
                    time: t,
                    position: isBull ? 'belowBar' : isBear ? 'aboveBar' : 'inBar',
                    color: isBull ? '#ef4444' : isBear ? '#3b82f6' : '#94a3b8',
                    shape: isBull ? 'arrowUp' : isBear ? 'arrowDown' : 'circle',
                    _label: `${p.label} [${sg.grade}]`,
                });
            }
        });
        // ── 확장 시그널 (v699) — 미국 데이트레이딩 핵심 시그널 ──
        // ① 골든/데드 크로스 — EMA50 × EMA200 (장기 추세 전환)
        for (let i = 1; i < ema50Data.length; i++) {
            const p50 = ema50Data[i-1], p200 = ema200Data[i-1], c50 = ema50Data[i], c200 = ema200Data[i];
            if (p50 == null || p200 == null || c50 == null || c200 == null) continue;
            if (p50 <= p200 && c50 > c200) {
                const sg = _gradeForBar(`${ts[i]}_golden`, { ..._gradeBase, i, signalType: 'buy' }, i === _lastBarIdx);
                if (_passesGradeFilter(sg.grade, sg.fallback)) {
                    markers.push({ time: ts[i], position: 'belowBar', color: '#FF6FA8', shape: 'arrowUp', _label: `골든크로스 [${sg.grade}]` });
                }
            } else if (p50 >= p200 && c50 < c200) {
                const sg = _gradeForBar(`${ts[i]}_dead`, { ..._gradeBase, i, signalType: 'sell' }, i === _lastBarIdx);
                if (_passesGradeFilter(sg.grade, sg.fallback)) {
                    markers.push({ time: ts[i], position: 'aboveBar', color: '#A855F7', shape: 'arrowDown', _label: `데드크로스 [${sg.grade}]` });
                }
            }
        }
        // ② 거래량 급증 — 20봉 평균 대비 2.5배 + 상승봉
        {
            const vols = volumes;
            for (let i = 20; i < closes.length; i++) {
                if (vols[i] == null || closes[i] == null || closes[i-1] == null) continue;
                let sum = 0, cnt = 0;
                for (let j = i-20; j < i; j++) { if (vols[j] != null) { sum += vols[j]; cnt++; } }
                const avg = cnt ? sum / cnt : 0;
                if (avg > 0 && vols[i] >= avg * 2.5 && closes[i] > closes[i-1]) {
                    const sg = _gradeForBar(`${ts[i]}_vol`, { ..._gradeBase, i, signalType: 'buy' }, i === _lastBarIdx);
                    if (_passesGradeFilter(sg.grade, sg.fallback)) {
                        markers.push({ time: ts[i], position: 'belowBar', color: '#FFD700', shape: 'arrowUp', _label: `거래량급증 [${sg.grade}]` });
                    }
                }
            }
        }
        // ③ 볼린저 밴드 돌파/이탈 — 종가가 상단 위로 돌파 / 하단 아래로 이탈
        if (bb && bb.upper && bb.lower) {
            for (let i = 1; i < closes.length; i++) {
                if (closes[i] == null || closes[i-1] == null) continue;
                const cu = bb.upper[i], pu = bb.upper[i-1], cl = bb.lower[i], pl = bb.lower[i-1];
                if (pu != null && cu != null && closes[i-1] <= pu && closes[i] > cu) {
                    const sg = _gradeForBar(`${ts[i]}_bb_buy`, { ..._gradeBase, i, signalType: 'buy' }, i === _lastBarIdx);
                    if (_passesGradeFilter(sg.grade, sg.fallback)) {
                        markers.push({ time: ts[i], position: 'belowBar', color: '#FF6FA8', shape: 'arrowUp', _label: `BB돌파 [${sg.grade}]` });
                    }
                } else if (pl != null && cl != null && closes[i-1] >= pl && closes[i] < cl) {
                    const sg = _gradeForBar(`${ts[i]}_bb_sell`, { ..._gradeBase, i, signalType: 'sell' }, i === _lastBarIdx);
                    if (_passesGradeFilter(sg.grade, sg.fallback)) {
                        markers.push({ time: ts[i], position: 'aboveBar', color: '#A855F7', shape: 'arrowDown', _label: `BB이탈 [${sg.grade}]` });
                    }
                }
            }
        }
        // ④ 신고가 마커 — 사용자 요청으로 제거 (v708)

        // ── EMA 눌림목(매수) / 이탈(매도) 마커 ──────────────────────
        // (emaC20/60/120/240, opens, volumes, _v3AtrArr, _signalGrades 는 위에서 이미 선언)
        {
            const { adx: _v3AdxArr } = calcADX(q.high, q.low, q.close, 14);
            // SPX EMA 추세 (1회 계산)
            const _v3SpxUp = (() => {
                const sd = window._spxCache;
                if (!sd || sd.length <= 20) return null;
                const sc = sd.map(d => d.close);
                const se = calcEMA(sc, 20);
                const sl = sc[sc.length - 1], se20 = se[se.length - 1];
                return (sl != null && se20 != null) ? sl > se20 : null;
            })();

            // ── EMA 매수 쿨다운 변수 (봉 인덱스 기준) ──
            let lastBuy1Bar = -999;
            let lastBuy2Bar = -999;
            let lastBuy3Bar = -999;
            // 타임프레임 → 분 단위 변환
            const _tfMin = (() => {
                const iv = currentInterval || '1d';
                if (iv === '1h' || iv === '60m') return 60;
                if (iv === '1d' || iv === '1wk') return 1440;
                const m = iv.match(/^(\d+)m$/);
                return m ? parseInt(m[1], 10) : 1440;
            })();
            const BUY_COOLDOWN = _tfMin <= 1  ? 30   // 1분봉:  30봉 = 30분
                              : _tfMin <= 3  ? 15   // 3분봉:  15봉 = 45분
                              : _tfMin <= 5  ? 15   // 5분봉:  15봉 = 75분 (데일리 단타 최적)
                              : _tfMin <= 10 ? 12   // 10분봉: 12봉 = 2시간
                              : _tfMin <= 15 ? 8    // 15분봉:  8봉 = 2시간
                              : _tfMin <= 30 ? 4    // 30분봉:  4봉 = 2시간
                              : _tfMin <= 60 ? 2    // 60분봉:  2봉 = 2시간
                              : 1;                  // 일봉+:   1봉 = 1일

            // ── EMA 매도 쿨다운 변수 ──
            let lastSell1Bar = -999;
            let lastSell2Bar = -999;
            let lastSell3Bar = -999;
            const SELL_COOLDOWN = 3;  // 3봉 이내 재발생 금지

            for (let i = 5; i < closes.length; i++) {
                const c = closes[i], l = lows[i], h = highs[i], o = opens[i];
                const rsiVal = rsi[i] != null ? rsi[i] : 50;
                const t = ts[i];
                if (!t || c == null || l == null || h == null) continue;
                const isBullCandle = o != null ? c > o : c > (closes[i-1] || c);
                const isRsiSafe = rsiVal > 40;
                const e20 = emaC20[i], e60 = emaC60[i], e120 = emaC120[i], e240 = emaC240[i];
                const isAligned = e20 && e60 && e120 && e20 > e60 && e60 > e120;

                // SuperTrend 대체: EMA 정배열 = 상승 추세
                const stUp = e20 && e60 && e120
                    ? (e20 > e60 && e60 > e120)
                    : true;

                // ── 매수 마커 — Smart Dip v3 필터 + 컨플루언스 등급 ──
                const _gradeOpts = {
                    i, signalType: 'buy',
                    closes, highs, lows, opens, volumes,
                    rsi, ma20: emaC20, ma60: emaC60, ma120: emaC120, ma240: emaC240,
                    macd: macdLine, macdSignal: signalLine,
                    atr: _v3AtrArr, bb,
                };
                if (e20 && l <= e20 * 1.002 && isBullCandle && isRsiSafe
                    && isAligned && stUp
                    && (i - lastBuy1Bar) >= BUY_COOLDOWN) {
                    const v3 = _smartDipV3Filter({
                        i, closes, highs, lows, opens, volumes,
                        ema20: emaC20, ema60: emaC60, ema120: emaC120, ema240: emaC240,
                        rsi, atrArr: _v3AtrArr, adxArr: _v3AdxArr, _spxTrendUp: _v3SpxUp,
                        currentInterval, ts,
                    });
                    if (v3.pass) {
                        const sg = _gradeForBar(`${t}_buy1`, _gradeOpts, i === _lastBarIdx);
                        if (_passesGradeFilter(sg.grade, sg.fallback)) {
                            markers.push({ time: t, position: 'belowBar', color: _gc(sg.grade), shape: 'arrowUp', _label: `매수1 [${sg.grade}] ${sg.winRate}%` });
                            window._smartDipAnalysis[t] = { ...v3, num: 1 };
                            lastBuy1Bar = i;
                        }
                    }
                } else if (e60 && l <= e60 * 1.002 && isBullCandle && isRsiSafe
                    && e60 > (e120 || 0) && stUp
                    && (i - lastBuy2Bar) >= BUY_COOLDOWN) {
                    const v3 = _smartDipV3Filter({
                        i, closes, highs, lows, opens, volumes,
                        ema20: emaC20, ema60: emaC60, ema120: emaC120, ema240: emaC240,
                        rsi, atrArr: _v3AtrArr, adxArr: _v3AdxArr, _spxTrendUp: _v3SpxUp,
                        currentInterval, ts,
                    });
                    if (v3.pass) {
                        const sg = _gradeForBar(`${t}_buy2`, { ..._gradeOpts }, i === _lastBarIdx);
                        if (_passesGradeFilter(sg.grade, sg.fallback)) {
                            markers.push({ time: t, position: 'belowBar', color: _gc(sg.grade), shape: 'arrowUp', _label: `매수2 [${sg.grade}] ${sg.winRate}%` });
                            window._smartDipAnalysis[t] = { ...v3, num: 2 };
                            lastBuy2Bar = i;
                        }
                    }
                } else if (e120 && l <= e120 * 1.002 && isBullCandle && isRsiSafe
                    && e120 > (e240 || 0) && stUp
                    && (i - lastBuy3Bar) >= BUY_COOLDOWN) {
                    const v3 = _smartDipV3Filter({
                        i, closes, highs, lows, opens, volumes,
                        ema20: emaC20, ema60: emaC60, ema120: emaC120, ema240: emaC240,
                        rsi, atrArr: _v3AtrArr, adxArr: _v3AdxArr, _spxTrendUp: _v3SpxUp,
                        currentInterval, ts,
                    });
                    if (v3.pass) {
                        const sg = _gradeForBar(`${t}_buy3`, { ..._gradeOpts }, i === _lastBarIdx);
                        if (_passesGradeFilter(sg.grade, sg.fallback)) {
                            markers.push({ time: t, position: 'belowBar', color: _gc(sg.grade), shape: 'arrowUp', _label: `매수3 [${sg.grade}] ${sg.winRate}%` });
                            window._smartDipAnalysis[t] = { ...v3, num: 3 };
                            lastBuy3Bar = i;
                        }
                    }
                }

                // ── 매도 마커 — EMA 하향 이탈 + 등급 필터 ──
                const prevC = closes[i-1];
                const prevE20 = emaC20[i-1], prevE60 = emaC60[i-1], prevE120 = emaC120[i-1];
                const _sellGradeOpts = {
                    i, signalType: 'sell',
                    closes, highs, lows, opens, volumes,
                    rsi, ma20: emaC20, ma60: emaC60, ma120: emaC120, ma240: emaC240,
                    macd: macdLine, macdSignal: signalLine,
                    atr: _v3AtrArr, bb,
                };
                if (prevC != null && e20 && prevE20 && prevC > prevE20 && c < e20
                    && (i - lastSell1Bar) >= SELL_COOLDOWN) {
                    const sg = _gradeForBar(`${t}_sell1`, _sellGradeOpts, i === _lastBarIdx);
                    if (_passesGradeFilter(sg.grade, sg.fallback)) {
                        const sc = sg.grade === 'S' ? '#FFD700' : sg.grade === 'A' ? '#22C55E' : '#EF4444';
                        markers.push({ time: t, position: 'aboveBar', color: sc, shape: 'arrowDown', _label: `매도1 [${sg.grade}] ${sg.winRate}%` });
                        lastSell1Bar = i;
                    }
                } else if (prevC != null && e60 && prevE60 && prevC > prevE60 && c < e60
                    && (i - lastSell2Bar) >= SELL_COOLDOWN) {
                    const sg = _gradeForBar(`${t}_sell2`, _sellGradeOpts, i === _lastBarIdx);
                    if (_passesGradeFilter(sg.grade, sg.fallback)) {
                        const sc = sg.grade === 'S' ? '#FFD700' : sg.grade === 'A' ? '#22C55E' : '#EF4444';
                        markers.push({ time: t, position: 'aboveBar', color: sc, shape: 'arrowDown', _label: `매도2 [${sg.grade}] ${sg.winRate}%` });
                        lastSell2Bar = i;
                    }
                } else if (prevC != null && e120 && prevE120 && prevC > prevE120 && c < e120
                    && (i - lastSell3Bar) >= SELL_COOLDOWN) {
                    const sg = _gradeForBar(`${t}_sell3`, _sellGradeOpts, i === _lastBarIdx);
                    if (_passesGradeFilter(sg.grade, sg.fallback)) {
                        const sc = sg.grade === 'S' ? '#FFD700' : sg.grade === 'A' ? '#22C55E' : '#EF4444';
                        markers.push({ time: t, position: 'aboveBar', color: sc, shape: 'arrowDown', _label: `매도3 [${sg.grade}] ${sg.winRate}%` });
                        lastSell3Bar = i;
                    }
                }
            }
        }

        // M2: 마커 우선순위 — 높을수록 우선 (매수 > 매도 > 지표 순)
        const _mPri = m => {
            const t = m._label || '';
            if (t.startsWith('매수1') || t.startsWith('매도1')) return 5;
            if (t.startsWith('매수2') || t.startsWith('매도2')) return 4;
            if (t.startsWith('매수3') || t.startsWith('매도3')) return 3;
            if (t.startsWith('골든크로스') || t.startsWith('데드크로스') || t.startsWith('브레이크')) return 3;
            if (t.startsWith('RSI') || t.startsWith('MACD')) return 2;
            return 1;
        };
        // M2: 봉당 1개 — 같은 timestamp 중 최고 우선순위 1개 (동률 시 매수(belowBar) 우선)
        const _byCandleMap = new Map();
        for (const m of markers) {
            const ex = _byCandleMap.get(m.time);
            if (!ex) { _byCandleMap.set(m.time, m); continue; }
            const nP = _mPri(m), eP = _mPri(ex);
            if (nP > eP || (nP === eP && m.position === 'belowBar' && ex.position !== 'belowBar')) {
                _byCandleMap.set(m.time, m);
            }
        }
        // M2: 마커 상세 데이터 맵 → bottom sheet 에서 참조
        window._markerDataMap = {};
        for (const [time, m] of _byCandleMap) {
            const t = m._label || '';
            const sfx = t.startsWith('매수1') ? 'buy1' : t.startsWith('매수2') ? 'buy2'
                : t.startsWith('매수3') ? 'buy3' : t.startsWith('매도1') ? 'sell1'
                : t.startsWith('매도2') ? 'sell2' : t.startsWith('매도3') ? 'sell3' : null;
            const sg = sfx ? _signalGrades?.[`${time}_${sfx}`] : null;
            window._markerDataMap[time] = {
                label: t, isBuy: m.position === 'belowBar',
                grade: sg?.grade || null, winRate: sg?.winRate || null,
                score: sg?.score || null, stars: sg?.stars || null,
                factors: sg?.factors || [], recommendation: sg?.recommendation || '',
            };
        }
        // 최종 배열 + 500개 제한
        let uniqMarkers = [..._byCandleMap.values()].sort((a, b) => a.time - b.time);
        if (uniqMarkers.length > 500) {
            uniqMarkers = uniqMarkers
                .sort((a, b) => _mPri(b) - _mPri(a) || b.time - a.time)
                .slice(0, 500)
                .sort((a, b) => a.time - b.time);
        }
        // M2: _label / text 제거 → 화살표 아이콘만 표시 (텍스트 마커 완전 제거)
        // 색상 통일: 매수 화살표(arrowUp)=노랑, 매도 화살표(arrowDown)=초록
        const _finalMarkers = uniqMarkers.map(({ _label, text, ...rest }) => {
            const m = { ...rest, size: 1 };
            if (m.shape === 'arrowUp')        m.color = '#FFD400'; // 매수 = 노랑
            else if (m.shape === 'arrowDown') m.color = '#22C55E'; // 매도 = 초록
            return m;
        });
        try {
            if (_finalMarkers && _finalMarkers.length > 0) {
                lwCandleSeries.setMarkers(_finalMarkers);
                _lastMarkers = _finalMarkers; // 캐시 → 줌/스크롤 시 복원용
                try { window._lastMarkers = _lastMarkers; } catch(_) {}
            }
        } catch(e) { warn('[markers]', e.message); }

        // 신호 등급 패널 렌더 — _lastSigGrade 캐시 기준 (등급 계산은 마커 생성 과정에서 이미 _gradeForBar 호출됨)
        try { _renderSigGradePanel(); } catch(e) {}

        // 3.4) 종목 로드 시 historical 마커 → 알림 패널 backfill (한 번만)
        // 폴링 중 신규 시그널만 추가하는 구조라 종목 전환 직후 패널이 비어 있는 문제 해결
        try {
            if (currentSymbol && uniqMarkers.length > 0) {
                const fillKey = `_sigBackfilled_${currentSymbol}`;
                // 1) 기존 _sigHistory 의 모든 종목 중복 제거 (이전 broken backfill 정리)
                //    key = ts | symbol | headline (가격 제외 — 가격은 봉종가/현재가 차이로 미세 변동 가능)
                const _seenAll = new Set();
                const _dedup = _sigHistory.filter(h => {
                    const k = `${h.ts}|${h.symbol}|${h.headline}`;
                    if (_seenAll.has(k)) return false;
                    _seenAll.add(k);
                    return true;
                });
                if (_dedup.length !== _sigHistory.length) {
                    _sigHistory.length = 0;
                    _dedup.forEach(h => _sigHistory.push(h));
                    localStorage.setItem('stockai_sig_history', JSON.stringify(_sigHistory));
                }
                // 2) 종목별 backfill (세션 1회만)
                if (!window[fillKey]) {
                    window[fillKey] = true;
                    // 차트 위에 있는 시그널 중 최근 30개만 backfill (3일치 표시 위해 확장)
                    const recentMarkers = uniqMarkers.slice(-30).reverse();
                    // 키 형식 통일: ts + headline (full label + " 시그널")
                    const existingKeys = new Set(
                        _sigHistory.filter(h => h.symbol === currentSymbol)
                                   .map(h => `${h.ts}|${h.headline}`)
                    );
                    // 마커 time → 가격 매핑 (해당 봉 종가)
                    const _tsToClose = {};
                    if (ts && q?.close) {
                        for (let i = 0; i < ts.length; i++) {
                            if (q.close[i] != null) _tsToClose[ts[i]] = q.close[i];
                        }
                    }
                    let added = 0;
                    recentMarkers.forEach(m => {
                        const tsMs    = (m.time || 0) * 1000;
                        const label   = m._label || (m.position === 'belowBar' ? '매수' : '매도');
                        const headline = `${label} 시그널`;
                        const key      = `${tsMs}|${headline}`;
                        if (existingKeys.has(key)) return;
                        existingKeys.add(key); // 같은 backfill 루프 안의 중복도 방어
                        _sigHistory.unshift({
                            ts: tsMs,
                            symbol: currentSymbol,
                            market: currentMarket,
                            price:  _tsToClose[m.time] ?? null,
                            dir: m.position === 'belowBar' ? 'buy' : 'sell',
                            headline,
                            subText: '',
                            historical: true, // backfill 표식
                        });
                        added++;
                    });
                    if (added > 0) {
                        if (_sigHistory.length > _SIG_HISTORY_MAX) _sigHistory.length = _SIG_HISTORY_MAX;
                        localStorage.setItem('stockai_sig_history', JSON.stringify(_sigHistory));
                    }
                }
                // 종목 변경 시 항상 배지 갱신 (backfill 여부와 무관)
                _renderSigHistoryPanel();
            }
        } catch(e) { warn('[sig backfill]', e.message); }

        // 3.5) 새 시그널 감지 → 토스트 (폴링으로 신규 마커 도착 시)
        const latest = uniqMarkers[uniqMarkers.length - 1];
        if (latest && currentSymbol) {
            const newKey = `${currentSymbol}:${latest.time}:${latest.position}:${latest._label||''}`;
            const prevSameSymbol = _lastSigKey && _lastSigKey.startsWith(currentSymbol + ':');
            // 종목 첫 로드 시 최근 시그널이 "fresh" 면 1회 자동 표시
            // 분봉(1m/2m/5m): 4시간 이내 → 당일 시그널 모두 포함
            // 그 외 타임프레임: 1봉 이내
            const _ivToSec = { '1m':60,'2m':120,'5m':300,'15m':900,'30m':1800,'60m':3600,'90m':5400,'1h':3600,'1d':86400,'1wk':604800,'1mo':2592000 };
            const _barSec = _ivToSec[currentInterval] || 300;
            const _isShortTFforFresh = /^(1m|2m|5m)$/.test(currentInterval || '');
            const _freshWindowSec = _isShortTFforFresh ? 4 * 3600 : _barSec * 1.5; // 단봉 4시간, 그 외 1.5봉
            const _ageSec = Date.now()/1000 - (latest.time || 0);
            const _isFreshOnFirstLoad = !prevSameSymbol && _ageSec >= 0 && _ageSec < _freshWindowSec;
            if ((prevSameSymbol && _lastSigKey !== newKey) || _isFreshOnFirstLoad) {
                const isBuy = latest.position === 'belowBar';
                const dir   = isBuy ? '매수' : '매도';
                let effectiveBuy = isBuy; // 포지션 로직으로 방향 바뀔 때 사운드·음성에 사용
                let emoji = isBuy ? '🔴' : '🔵';
                let headline = `${latest._label||dir} 시그널`;
                let subText = ''; // 포지션 전용 서브텍스트 (스코프 상위 선언)
                // ── 내 포지션 상태 연동 (v716 3단계) ──
                let posSkip = false;
                try {
                    const _pa = _posActiveForTicker(currentSymbol);
                    if (_pa) {
                        if (_pa.status === 'holding') {
                            if (isBuy) {
                                // 손실 단계별 분할매수 알림 (v717)
                                let _pnl = null;
                                try { _pnl = _posPnlPct(_pa.entryPrice, _posCurrentPrice()); } catch(e) {}
                                // 표시값(소수1자리)과 분류 기준 일치 — 반올림 후 판정
                                if (_pnl != null) _pnl = Math.round(_pnl * 10) / 10;
                                if (_pnl != null && _pnl <= -7) {
                                    emoji = '🟣'; headline = `2차 분할매수 검토 — 손실 ${_pnl.toFixed(1)}% (${latest._label||''})`;
                                } else if (_pnl != null && _pnl <= -3) {
                                    emoji = '🟣'; headline = `1차 분할매수 검토 — 손실 ${_pnl.toFixed(1)}% (${latest._label||''})`;
                                } else {
                                    posSkip = true;                     // 수익 중 / 손실 -3% 미만 — 매수 알림 억제
                                }
                            }
                            else {
                                // 포지션 상태에 맞는 구체적인 알림 메시지 생성
                                emoji = '💰';
                                const _fmtP = p => currentMarket === 'KR'
                                    ? Math.round(p).toLocaleString() + '원'
                                    : '$' + Number(p).toFixed(2);

                                const _entry   = _pa.entryPrice;
                                const _sl      = _pa.stopLoss;
                                const _tp1     = _pa.tp1;
                                const _tp2     = _pa.tp2;
                                const _tp3     = _pa.tp3;
                                // 실시간 가격 우선 (Alpaca) — 없으면 Yahoo Finance 최근 종가 폴백
                                const _rtPrice = (typeof _posCurrentPrice === 'function')
                                    ? (_posCurrentPrice() || lastClose)
                                    : lastClose;
                                const _pnlPct  = _entry
                                    ? (_rtPrice - _entry) / _entry * 100
                                    : null;
                                // subText는 상위 스코프에서 선언됨 (let subText = '')

                                // ── 손절 ──────────────────────────────────
                                // 손절 이탈 (손절가 아래)
                                if (_sl && _rtPrice < _sl) {
                                    emoji = '🔴';
                                    headline = `🚨 손절 — 현재가 ${_fmtP(_rtPrice)} · 손절가 ${_fmtP(_sl)}`;
                                    subText  = '손절가 이탈 · 즉시 손절 검토';

                                // 손절 근접 (손절가 대비 0.5% 이내)
                                } else if (_sl && _rtPrice <= _sl * 1.005 && _rtPrice >= _sl) {
                                    emoji = '🔴';
                                    headline = `⚠️ 손절 근접 — 현재가 ${_fmtP(_rtPrice)} · 손절가 ${_fmtP(_sl)}`;
                                    subText  = '손절가까지 ' + (((_rtPrice - _sl) / _sl) * 100).toFixed(2) + '% 남음';

                                // ── 익절 ──────────────────────────────────
                                // 3차 익절 근접 (2% 이내)
                                } else if (_tp3 && Math.abs(_rtPrice - _tp3) / _tp3 <= 0.02) {
                                    emoji = '🎉';
                                    headline = `🎉 익절 — 3차 목표가 ${_fmtP(_tp3)} 근접`;
                                    subText  = '30% 익절 검토';

                                // 3차 익절 달성
                                } else if (_tp3 && _rtPrice >= _tp3) {
                                    emoji = '🎉';
                                    headline = `🎉 익절 달성 — 3차 ${_fmtP(_tp3)} 돌파`;
                                    subText  = '전량 익절 검토';

                                // 2차 익절 근접 (2% 이내)
                                } else if (_tp2 && Math.abs(_rtPrice - _tp2) / _tp2 <= 0.02) {
                                    emoji = '💰';
                                    headline = `💰 익절 — 2차 목표가 ${_fmtP(_tp2)} 근접`;
                                    subText  = '40% 익절 검토';

                                // 2차 익절 달성
                                } else if (_tp2 && _rtPrice >= _tp2) {
                                    emoji = '💰';
                                    headline = `💰 익절 달성 — 2차 ${_fmtP(_tp2)} 돌파`;
                                    subText  = `3차 목표가 ${_fmtP(_tp3 || _tp2)}까지 보유`;

                                // 1차 익절 근접 (2% 이내)
                                } else if (_tp1 && Math.abs(_rtPrice - _tp1) / _tp1 <= 0.02) {
                                    emoji = '✅';
                                    headline = `✅ 익절 — 1차 목표가 ${_fmtP(_tp1)} 근접`;
                                    subText  = '30% 익절 검토';

                                // 1차 익절 달성
                                } else if (_tp1 && _rtPrice >= _tp1) {
                                    emoji = '✅';
                                    headline = `✅ 익절 달성 — 1차 ${_fmtP(_tp1)} 돌파`;
                                    const nextTarget = _tp2 || _tp3;
                                    subText  = nextTarget
                                        ? `다음 목표 ${_fmtP(nextTarget)}`
                                        : '익절 고려';

                                // ── 매수 (분할매수) ────────────────────────
                                } else if (_pnlPct !== null && _pnlPct <= -1) {
                                    effectiveBuy = true; // 매도→매수 전환 — 사운드·음성 방향 보정
                                    const _splits = _pa.splits || [];
                                    const _nextSplit = _splits
                                        .filter(sp => sp.price < _rtPrice && sp.nth > 1)
                                        .sort((a, b) => b.price - a.price)[0];
                                    if (_splits.length > 1 && _nextSplit) {
                                        emoji = '📊';
                                        headline = `📊 매수 — ${_nextSplit.nth}차 분할매수 진입가 ${_fmtP(_nextSplit.price)}`;
                                        subText  = `손실 ${_pnlPct.toFixed(1)}% · 추가 매수 검토`;
                                    } else if (_splits.length > 1) {
                                        emoji = '📊';
                                        headline = `📊 매수 대기 — ${_splits.length}차 분할매수 계획 설정됨`;
                                        subText  = `손실 ${_pnlPct.toFixed(1)}%`;
                                    } else {
                                        emoji = '💰';
                                        headline = `보유 중 (${_pnlPct.toFixed(1)}%) · 분할매수 검토`;
                                        subText  = `손절 ${_sl ? _fmtP(_sl) : '미설정'}`;
                                    }

                                // 수익 중 / 진입가 근처 — 포지션 유지 중이므로 매도 시그널 억제
                                } else {
                                    posSkip = true; // 손절·익절 조건 미해당 → 일반 매도 알림 억제
                                }
                            }
                        } else if (_pa.status === 'watching') {
                            if (isBuy) {
                                emoji = '🎯'; headline = `관심 종목 진입가 근접 (${latest._label||''})`;
                            } else {
                                posSkip = true; // 관망 중(미진입) — 매도 시그널 억제
                            }
                        }
                    } else {
                        const _pl = _posLatestForTicker(currentSymbol);
                        if (_pl && _pl.status === 'closed') {
                            emoji = '🔄';
                            headline = `재진입 검토 시그널 (${latest._label||''})`;
                        } else {
                            posSkip = true; // 포지션 없으면 알림 억제
                        }
                    }
                } catch(e) {}
                if (!posSkip) {
                    // 시그널 발생가 + ATR 기반 목표가 — 매수가·매도가 함께 안내 (v700)
                    let subStr = '';
                    try {
                        const sIdx = ts.indexOf(latest.time);
                        // 실시간 현재가 우선, 마커 봉 종가는 폴백
                        const _livePx = _posCurrentPrice();
                        const sp = (_livePx != null && _livePx > 0)
                            ? _livePx
                            : (sIdx >= 0 && q.close[sIdx] != null)
                                ? q.close[sIdx]
                                : candleData[candleData.length - 1]?.close;
                        const atr = calcATR(q.high, q.low, q.close).filter(v => v != null).pop();
                        const fmtP = p => currentMarket === 'KR'
                            ? Math.round(p).toLocaleString() + '원'
                            : '$' + Number(p).toFixed(2);
                        if (sp != null) {
                            if (atr && atr > 0) {
                                const tgt = isBuy ? sp + atr * 2 : sp - atr * 2;
                                subStr = isBuy
                                    ? `매수 ${fmtP(sp)}   →   목표 매도 ${fmtP(tgt)}`
                                    : `매도 ${fmtP(sp)}   →   목표 매수 ${fmtP(tgt)}`;
                            } else {
                                subStr = `${dir} ${fmtP(sp)}`;
                            }
                        }
                    } catch(e) {}
                    // ── 포지션 알림 중복 억제 (동일 headline 5분 쿨다운) ──
                    const _posAlertKey = `${currentSymbol}:${headline}`;
                    const _now = Date.now();
                    if (_lastPosAlertKey === _posAlertKey && _now - _lastPosAlertTime < 5 * 60 * 1000) {
                        // 5분 이내 동일 알림 → skip
                    } else {
                        _lastPosAlertKey  = _posAlertKey;
                        _lastPosAlertTime = _now;
                        const _finalSub = (typeof subText !== 'undefined' && subText) ? subText : subStr;
                        // ── 알림 히스토리 저장 ──
                        try {
                            _sigHistory.unshift({
                                ts:       _now,
                                symbol:   currentSymbol,
                                market:   currentMarket,
                                price:    (typeof lastClose === 'number' && lastClose > 0) ? lastClose : null,
                                dir:      effectiveBuy ? 'buy' : 'sell',
                                headline: headline,
                                subText:  _finalSub,
                            });
                            if (_sigHistory.length > _SIG_HISTORY_MAX) _sigHistory.length = _SIG_HISTORY_MAX;
                            localStorage.setItem('stockai_sig_history', JSON.stringify(_sigHistory));
                            _renderSigHistoryPanel();
                        } catch(e) {}
                        // 10초 프로그레스바 시그널 알림
                        try {
                            const _dirKey = effectiveBuy ? 'buy1' : 'sell1';
                            const _sg = _signalGrades?.[`${latest.time}_${_dirKey}`]
                                     || _signalGrades?.[`${latest.time}_buy2`]
                                     || _signalGrades?.[`${latest.time}_sell2`];
                            const _gradeSub = _sg
                                ? `[${_sg.grade}급 ${_sg.stars}] 예상 승률 ${_sg.winRate}% · ${_sg.recommendation}`
                                : '';
                            const _alertSub = _gradeSub
                                ? _gradeSub + (_finalSub ? '\n' + _finalSub : '')
                                : _finalSub;
                            _showSignalAlert(`${emoji} ${currentSymbol} · ${headline}`, effectiveBuy, _alertSub);
                        } catch(e) {}
                        // 매수·매도 시그널 사운드 + 음성 안내
                        try {
                            if (_chartSoundEnabled) {
                                _playSignalSound(effectiveBuy ? 'buy' : 'sell');
                                setTimeout(() => _speakSignal(currentSymbol, effectiveBuy ? '매수' : '매도'), 380);
                            }
                        } catch(e) {}
                    }
                }
            }
            _lastSigKey = newKey;
            try { window._lastSigKey = _lastSigKey; } catch(_) {}
            // 내 포지션 진입가 라인 재그리기 (봉 변경·강제 재빌드 시에만)
            if (_doRebuild) { try { _posDrawChartLine(); } catch(e) {} }
        }

        // ── 가격 라인 + 레이어 — 재빌드 필요 시에만 (깜빡임 방지) ─────────
        if (_doRebuild) {

        // 라인 토글 OFF → 보조지표 가격 라인만 건너뜀, 분석 레이어는 각 자체 플래그로 제어
        if (_chartLinesEnabled) {

        // 4) 자동 지지·저항선 — 최근 90봉 스윙 고점·저점 (v683)
        //    적응형 범위: ±28% 이내 우선, 부족하면 범위 무관 가장 가까운 것으로 보충
        //    → 일·주·월봉 모두 항상 지지선 표시 보장 (월봉은 스윙 폭이 커 28% 밖일 수 있음)
        const recentN = Math.min(90, candleData.length);
        const startIdx = candleData.length - recentN;
        const slicedHi = highs.slice(startIdx), slicedLo = lows.slice(startIdx), slicedTs = ts.slice(startIdx);
        const { peaks, troughs } = _detectSwingPoints(slicedHi, slicedLo, slicedTs, 5, 8);
        const curPrice = lastClose || 0;
        const _srHi = curPrice * 1.10;  // 저항선 상한 (+10%) — 라인 과부하 방지
        const _srLo = curPrice * 0.90;  // 지지선 하한 (-10%)
        // 저항선 — 현재가 위. ±10% 이내 우선, 없으면 가장 가까운 2개
        const _resAbove = peaks.filter(p => p.price > curPrice).sort((a,b) => a.price - b.price);
        let resistances = _resAbove.filter(p => p.price <= _srHi).slice(0, 2);
        if (!resistances.length) resistances = _resAbove.slice(0, 2);
        // 지지선 — 현재가 아래. ±10% 이내 우선, 부족하면 가장 가까운 것으로 보충
        const _supBelow = troughs.filter(p => p.price < curPrice).sort((a,b) => b.price - a.price);
        let supports = _supBelow.filter(p => p.price >= _srLo).slice(0, 2);
        if (!supports.length) supports = _supBelow.slice(0, 2);
        // 폴백 — 스윙 저점이 전혀 없으면(현재가가 저점 부근) 최근 40봉 최저가를 지지선으로 (v685)
        if (supports.length === 0) {
            const _recentLows = lows.slice(Math.max(0, lows.length - 40)).filter(v => v != null);
            if (_recentLows.length) {
                const _recLow = Math.min(..._recentLows);
                if (_recLow < curPrice) supports = [{ price: _recLow, i: -1 }];
            }
        }
        const addLine = (price, color, label, style, priority = 4) => {
            try {
                // 모바일: 돌파 라인만 축 라벨 표시, 저항/지지는 라인만 유지
                const _isMob = window.innerWidth <= 600;
                const _baseVisible = _claimPriceLabel(price, priority);
                const axisLabelVisible = _isMob
                    ? (_baseVisible && !!(label && label.includes('돌파')))
                    : _baseVisible;
                const pl = lwCandleSeries.createPriceLine({
                    price, color, lineWidth: 2, lineStyle: style != null ? style : 0,
                    axisLabelVisible,
                    title: label,
                });
                _pushPriceLine(_chartLiveLines, pl);
            } catch(e) {}
        };
        // 가격 라벨 포맷 — KR/US 통화 분기
        const _lpFmt = p => currentMarket === 'KR'
            ? Math.round(p).toLocaleString() + '원'
            : '$' + p.toFixed(2);
        // Phase M: 가격 라인 라벨 가시성 prefs (기본 OFF)
        const _lp = (typeof _linePrefs === 'function') ? _linePrefs() : {};
        if (_lp.sr) resistances.forEach(r => addLine(r.price, 'rgba(239,68,68,0.9)', `📍${_lpFmt(r.price)}`, undefined, 4));
        let _bounceBadgeShown = false; // 중복 배지 방지
        supports.forEach(s => {
            const _distPct = curPrice > 0 ? (curPrice - s.price) / s.price * 100 : 999;
            if (_distPct >= 0 && _distPct <= 5.0) {
                // 지지선 5% 이내 — 지지 반등 매수 가능
                if (_lp.bounce) addLine(s.price, 'rgba(34,197,94,0.9)', `🔄${_lpFmt(s.price)}`, 0, 3);
                if (bar && !_bounceBadgeShown) {
                    bar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill sig-emerald">🔄 지지 반등 매수</span>`);
                    _bounceBadgeShown = true;
                }
            } else {
                if (_lp.sr) addLine(s.price, 'rgba(59,130,246,0.9)', `📍${_lpFmt(s.price)}`, undefined, 4);
            }
        });

        // 4.5) 눌림목 · 돌파 자리 (v684) — 모든 인터벌 (분·일·주·월봉)
        //   돌파 자리 = 최근 20봉 최고가 (현재가 아래면 미표시 — 이미 돌파됨)
        //   눌림목 자리 = EMA20 (상승 추세에서 되돌림 매수 지점), 현재가 위면 미표시
        try {
            const ema20Arr = lwMaSeries.ema20_data || calcEMA(closes, 20);
            const lastEma20 = lastVal(ema20Arr);
            // 돌파 라인 — 최근 20봉(현재봉 제외) 최고가
            const last20Hi = highs.slice(Math.max(0, highs.length - 21), highs.length - 1).filter(v => v != null);
            if (last20Hi.length >= 5) {
                const breakoutLv = Math.max(...last20Hi);
                if (breakoutLv > curPrice && breakoutLv <= curPrice * 1.35) {
                    // 돌파 대기 중 — 노란 점선
                    addLine(breakoutLv, 'rgba(234,179,8,0.95)', `🚀${_lpFmt(breakoutLv)}`, 2, 3);
                } else if (curPrice >= breakoutLv && curPrice <= breakoutLv * 1.05) {
                    // 돌파 직후 (0~5% 이내) — 초록 실선 + 진입 배지
                    addLine(breakoutLv, 'rgba(34,197,94,0.95)', `✅${_lpFmt(breakoutLv)}`, 0, 2);
                    if (bar) bar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill sig-emerald">✅ 돌파 진입</span>`);
                }
            }
            // 눌림목 라인 — EMA20 (현재가가 EMA20 위 = 상승 추세일 때만)
            if (lastEma20 != null && lastEma20 < curPrice && lastEma20 >= curPrice * 0.80) {
                addLine(lastEma20, 'rgba(34,197,94,0.95)', `🟢${_lpFmt(lastEma20)}`, 2, 3);
            }
        } catch(e) {}

        } // end if (_chartLinesEnabled) — 보조지표 가격 라인 블록 끝

        // 6) Kullamägi 레이어 — _chartKullamagiEnabled 자체 플래그로 제어 (sig_lines와 독립)
        try { _renderKullamagiLayer(q, ts, bb); } catch (e) { warn('[kull] render fail', e); }

        // 7) 6번 역피라미딩 분할매수 레이어 — _chartSplitEnabled 자체 플래그 (독립 모듈)
        // 항상 호출 → 내부에서 클리어 먼저 실행 (OFF 시에도 잔류 라인 제거)
        try { _renderSplitBuyLayer(q, ts); } catch (e) { warn('[split] render fail', e); }

        // 8) 눌림목 감지 레이어 — _chartPullbackEnabled 자체 플래그 (독립 모듈)
        try { _renderPullbackLayer(q, ts); } catch (e) { warn('[pullback] render fail', e); }

        // 9) 지지/저항선 자동 감지 레이어 (5봉 피벗 + 1~5★ 강도 평가)
        try { _renderSrLayer(q, ts); } catch (e) { warn('[sr] render fail', e); }

        // 10) Smart Dip — 눌림목 피보나치 분할매수 레이어
        try { _renderSmartDipLayer(q, ts); } catch (e) { warn('[smartdip] render fail', e); }

        } // end if (_doRebuild) — 가격 라인 재빌드 블록 끝
    }

    // ═══════════════════════════════════════════════════════════
    // Smart Dip — 눌림목 피보나치 분할매수 + 포지션 연동
    // ═══════════════════════════════════════════════════════════
    const SMART_DIP_MAP = {
        'NVDL':{ base:'NVDA', mult:2.0, type:'lev2' },
        'TSLL':{ base:'TSLA', mult:1.5, type:'lev2' },
        'SOFA':{ base:'SOFI', mult:2.0, type:'lev2' },
        'OKLL':{ base:'OKLO', mult:2.0, type:'lev2' },
        'IONX':{ base:'IONQ', mult:2.0, type:'lev2' },
        'TQQQ':{ base:'QQQ',  mult:3.0, type:'lev3' },
        'SOXL':{ base:'SOXX', mult:3.0, type:'lev3' },
        'OKLO':{ base:null,   mult:1.0, type:'small' },
        'IONQ':{ base:null,   mult:1.0, type:'small' },
        'SOFI':{ base:null,   mult:1.0, type:'small' },
        'RGTI':{ base:null,   mult:1.0, type:'small' },
        'RKLB':{ base:null,   mult:1.0, type:'small' },
    };

    function _sdGetCoeff(ticker) {
        const t = SMART_DIP_MAP[ticker?.toUpperCase()]?.type;
        if (t === 'lev3') return { sl:0.3, tp1:1.0, tp2:2.0, maxEntry:4, allocs:[5,10,15,20] };
        if (t === 'lev2') return { sl:0.5, tp1:1.5, tp2:3.0, maxEntry:5, allocs:[5,8,12,15,10] };
        if (t === 'small') return { sl:0.7, tp1:1.5, tp2:3.0, maxEntry:6, allocs:[5,8,12,15,5,5] };
        return { sl:1.0, tp1:2.0, tp2:4.0, maxEntry:6, allocs:[5,8,10,15,7,5] };
    }

    const SD_FIB = [0.236, 0.382, 0.500, 0.618, 0.786, 0.886];

    // ── Smart Dip 분봉 최적화 헬퍼 ────────────────────────────────
    // 타임프레임별 룩백 봉 수
    //   1m  → 200봉 (≈반 거래일)   5m  → 100봉 (≈1 거래일)
    //   15m → 60봉  (≈2 거래일)    30m → 50봉  (기존)
    //   1h  → 40봉                 1d  → 20봉
    function _sdLookback(iv) {
        const m = { '1m':200,'2m':150,'5m':100,'15m':60,'30m':50,
                    '60m':40,'90m':40,'1h':40,'1d':20,'1wk':15,'1mo':12 };
        return m[iv] || 50;
    }
    // 타임프레임별 ATR 기간 — 분봉은 변동성에 더 민감하게
    function _sdAtrPeriod(iv) {
        if (!iv) return 14;
        if (/^(1m|2m|5m)$/.test(iv))   return 20;
        if (/^(15m|30m)$/.test(iv))     return 14;
        return 10; // 60m, 1d, 1wk+
    }
    // 타임프레임별 Pivot 윈도우 — 0이면 단순 max/min 사용
    function _sdPivotWin(iv) {
        if (!iv) return 0;
        if (/^(1m|2m|5m|15m)$/.test(iv)) return 5;
        if (/^(30m|60m|90m|1h)$/.test(iv)) return 3;
        return 0; // 일봉 이상 → 단순 max/min (넓은 레인지가 적합)
    }
    // 타임프레임별 Fibonacci range ATR 클램프 배수 [min, max]
    //   5m 이하 → [5, 30]   15m → [4, 25]   30m → [3, 20]   1h+ → [2, 15]
    function _sdFibClamp(iv) {
        if (!iv || /^(1m|2m|5m)$/.test(iv)) return { min: 5, max: 30 };
        if (iv === '15m') return { min: 4, max: 25 };
        if (iv === '30m') return { min: 3, max: 20 };
        return { min: 2, max: 15 };
    }
    // Pivot 방식 Swing High/Low 탐지 (폴백: 단순 max/min)
    // 거래량 가중 Pivot Swing 탐지
    // - pivotWin 윈도우 내 좌우 모두보다 높/낮은 캔들을 후보로
    // - 후보 중 직전 20봉 거래량 평균의 1.2배 이상인 캔들만 인정 (노이즈 스파이크 제외)
    // - 폴백: pivot 미발견 시 단순 max/min (volumes 미사용)
    // volMultiplier — 타임프레임별 Pivot 거래량 필터 강도
    //   5m 이하 → 1.2x  15m → 1.3x  30m → 1.4x  1h+ → 1.2x (기본)
    function _sdVolMultiplier(iv) {
        if (!iv) return 1.2;
        if (iv === '15m') return 1.3;
        if (iv === '30m') return 1.4;
        return 1.2;
    }

    function _sdSwingPoints(highs, lows, volumes, N, lb, pivotWin, volMultiplier) {
        const _volMin = (volMultiplier != null && isFinite(volMultiplier)) ? volMultiplier : 1.2;
        let swHigh = -Infinity, swLow = Infinity;
        // 거래량 평균 계산 헬퍼 (직전 20봉, null 제외)
        const _avgVol = (idx) => {
            if (!volumes || !Array.isArray(volumes)) return null;
            const arr = volumes.slice(Math.max(0, idx - 20), idx).filter(v => v != null && v > 0);
            if (!arr.length) return null;
            return arr.reduce((s, v) => s + v, 0) / arr.length;
        };
        // volumes 가 제공된 경우만 거래량 필터 적용 (하위 호환)
        const _volPass = (idx) => {
            if (!volumes || !Array.isArray(volumes)) return true;
            const v = volumes[idx];
            const avg = _avgVol(idx);
            if (v == null || avg == null || avg <= 0) return true; // 데이터 부족 시 통과
            return v >= avg * _volMin;
        };
        if (pivotWin > 0) {
            const start = N - lb + pivotWin;
            const end   = N - pivotWin;
            for (let i = start; i < end; i++) {
                if (highs[i] != null) {
                    let isPH = true;
                    for (let j = 1; j <= pivotWin && isPH; j++) {
                        if ((i-j >= 0 && highs[i-j] != null && highs[i-j] >= highs[i]) ||
                            (i+j <  N && highs[i+j] != null && highs[i+j] >= highs[i])) isPH = false;
                    }
                    if (isPH && highs[i] > swHigh && _volPass(i)) swHigh = highs[i];
                }
                if (lows[i] != null) {
                    let isPL = true;
                    for (let j = 1; j <= pivotWin && isPL; j++) {
                        if ((i-j >= 0 && lows[i-j] != null && lows[i-j] <= lows[i]) ||
                            (i+j <  N && lows[i+j] != null && lows[i+j] <= lows[i]))  isPL = false;
                    }
                    if (isPL && lows[i] < swLow && _volPass(i)) swLow = lows[i];
                }
            }
        }
        // 폴백: pivot 미발견 또는 pivotWin=0 → 단순 최대/최솟값 (거래량 무시, 데이터 안정성)
        if (!isFinite(swHigh) || !isFinite(swLow) || swHigh <= swLow) {
            for (let i = N - lb; i < N; i++) {
                if (highs[i] != null && highs[i] > swHigh) swHigh = highs[i];
                if (lows[i]  != null && lows[i]  < swLow)  swLow  = lows[i];
            }
        }
        return { swHigh, swLow };
    }

    function getSmartDipMode(ticker) {
        const pos = _posActiveForTicker(ticker);
        const cur = _posCurrentPrice();
        if (!pos || pos.status === 'watching') return 'entry';
        if (pos.status === 'closed') return 'reentry';
        if (pos.status === 'holding' && cur && pos.entryPrice) {
            return (cur - pos.entryPrice) / pos.entryPrice >= 0 ? 'profit' : 'loss';
        }
        return 'entry';
    }

    let _smartDipLines = [];
    // _chartSmartDipEnabled 는 상단(174~)에서 미리 선언됨 — TDZ 방지를 위해 중복 선언 제거

    function _clearSmartDipLines() {
        _smartDipLines = _clearOwnLines(_smartDipLines);
    }

    function _sdAddLine(price, color, width, style, title) {
        if (!price || !isFinite(price) || price <= 0 || !lwCandleSeries) return;
        // 모바일: 골든존(★)만 축 라벨 노출 (손절은 _sdAddStopLine 전용)
        const _isMob = window.innerWidth <= 600;
        const axisLabelVisible = _isMob ? !!(title && title.includes('★')) : true;
        try {
            _pushPriceLine(_smartDipLines, lwCandleSeries.createPriceLine({
                price, color, lineWidth: width, lineStyle: style, axisLabelVisible, title,
            }));
        } catch(e) {}
    }

    // M3: 손절선 전용 — 1px dashed, rgba(239,68,68,0.6), 가격축 chip만, 텍스트 없음
    function _sdAddStopLine(price) {
        if (!price || !isFinite(price) || price <= 0 || !lwCandleSeries) return;
        try {
            _pushPriceLine(_smartDipLines, lwCandleSeries.createPriceLine({
                price,
                color: 'rgba(239,68,68,0.6)',
                lineWidth: 1,
                lineStyle: 2,   // Dashed
                axisLabelVisible: true,
                title: '',
            }));
        } catch(e) {}
    }

    // ── 신호 컨플루언스 등급 계산 (10가지 조건) ──────────────────────
    function _calcSignalGrade(opts) {
        const {
            i, signalType,
            closes, highs, lows, opens, volumes,
            rsi, ma20, ma60, ma120, ma240,
            macd, macdSignal,
            atr, bb,
        } = opts || {};

        // 폴백 (데이터 부족 시 B → 대부분 필터 통과)
        const _fb = () => ({
            grade: 'B', score: 5, winRate: 60,
            stars: '⭐⭐⭐', factors: ['데이터 부족'],
            recommendation: '신중 진입', fallback: true,
        });

        if (!closes || !Array.isArray(closes) || closes.length === 0) return _fb();
        if (i == null || i < 5 || closes[i] == null) return _fb();

        // null-safe 배열 접근
        const sg = (arr, idx) =>
            arr && Array.isArray(arr) && arr[idx] != null ? arr[idx] : null;

        let score = 0;
        const factors = [];
        const weak = []; // 미달 조건 {label, max} (점수 영향 X, 잠재 점수 큰 순 정렬용)
        // 미달 표시 헬퍼 — 카테고리에서 factors push 가 없으면 잠재 점수와 함께 weak 등록
        const _markIfNoneNew = (lenBefore, label, maxPts) => {
            if (factors.length === lenBefore) weak.push({ label, max: maxPts });
        };
        // 점수와 함께 통과 factor 추가 (사용자가 '어느 조건이 몇 점인지' 즉시 확인)
        const _addPass = (icon, label, pts) => {
            score += pts;
            const sign = pts >= 0 ? '+' : '';
            factors.push(`${icon} ${label} ${sign}${pts}`);
        };
        const c = closes[i];

        // 1. 추세 방향 일치 (HTF) — 최대 2점
        let _pushed = factors.length;
        const ma20i = sg(ma20, i), ma60i = sg(ma60, i), ma120i = sg(ma120, i);
        const trendUp = ma20i != null && ma60i != null && ma120i != null && ma20i > ma60i && ma60i > ma120i;
        const trendDn = ma20i != null && ma60i != null && ma120i != null && ma20i < ma60i && ma60i < ma120i;
        if (signalType === 'buy' && trendUp)       _addPass('✅', '추세 정배열', 2);
        else if (signalType === 'sell' && trendDn) _addPass('✅', '추세 역배열', 2);
        else if (signalType === 'buy' && trendDn)  _addPass('❌', '하락 추세 역방향 매수', -1);
        _markIfNoneNew(_pushed, '추세 미정렬', 2);

        // 2. EMA20 위치 — 최대 1점
        _pushed = factors.length;
        if (ma20i != null) {
            if (signalType === 'buy'  && c > ma20i) _addPass('✅', 'EMA20 위', 1);
            else if (signalType === 'sell' && c < ma20i) _addPass('✅', 'EMA20 아래', 1);
        }
        _markIfNoneNew(_pushed, signalType === 'buy' ? 'EMA20 미상승' : 'EMA20 미하락', 1);

        // 3. 거래량 — 1.5점
        const vols = (volumes && Array.isArray(volumes)) ? volumes : [];
        // 타임프레임별 lookback 최적화 (노이즈 구간일수록 더 긴 평균 필요)
        //   1m/2m/5m → 8봉(~40분)  15m → 12봉(~3h)  30m → 15봉(~7h)  1h+ → 20봉
        const _iv        = typeof currentInterval !== 'undefined' ? (currentInterval || '') : '';
        const _isShortTF = /^(1m|2m|5m)$/.test(_iv);
        const _isMidTF   = /^(15m|30m)$/.test(_iv);
        const volLookback = _isShortTF ? 8 : _iv === '15m' ? 12 : _iv === '30m' ? 15 : 20;
        const vSlice = vols.slice(Math.max(0, i-volLookback), i).filter(v => v != null);
        const vAvg = vSlice.length ? vSlice.reduce((s,v) => s+v, 0) / vSlice.length : 0;
        const vRatio = vAvg > 0 ? (vols[i] || 0) / vAvg : 1;
        // 3. 거래량 — 최대 1.5점
        _pushed = factors.length;
        if (vRatio >= 2.0)      _addPass('✅', `거래량 ${vRatio.toFixed(1)}x`, 1.5);
        else if (vRatio >= 1.5) _addPass('✅', `거래량 ${vRatio.toFixed(1)}x`, 1);
        else if (vRatio >= 1.2) _addPass('🟡', `거래량 ${vRatio.toFixed(1)}x`, 0.5);
        _markIfNoneNew(_pushed, `거래량 ${vRatio.toFixed(1)}x (낮음)`, 1.5);

        // 4. RSI — 1.5점
        // 타임프레임별 과매도/과매수 임계값 — 분봉일수록 노이즈 크므로 더 엄격하게
        //   5m 이하 → 25/75   15m → 27/73   30m → 28/72   1h+ → 30/70
        const RSI_OS = _isShortTF ? 25 : _iv === '15m' ? 27 : _iv === '30m' ? 28 : 30;
        const RSI_OB = _isShortTF ? 75 : _iv === '15m' ? 73 : _iv === '30m' ? 72 : 70;
        // 4. RSI — 최대 1.5점
        const rsiVal = sg(rsi, i) ?? 50;
        _pushed = factors.length;
        if (signalType === 'buy') {
            if (rsiVal < RSI_OS)                   _addPass('✅', `RSI ${rsiVal.toFixed(0)} (과매도)`, 1.5);
            else if (rsiVal >= 40 && rsiVal <= 60) _addPass('✅', `RSI ${rsiVal.toFixed(0)} (중립)`, 1);
            else if (rsiVal > RSI_OB)              _addPass('❌', `RSI ${rsiVal.toFixed(0)} (과매수)`, -1);
        } else {
            if (rsiVal > RSI_OB)      _addPass('✅', `RSI ${rsiVal.toFixed(0)} (과매수)`, 1.5);
            else if (rsiVal < RSI_OS) _addPass('❌', `RSI ${rsiVal.toFixed(0)} (과매도)`, -1);
        }
        _markIfNoneNew(_pushed, `RSI ${rsiVal.toFixed(0)} (애매)`, 1.5);

        // 5. MACD — 1.5점
        const macdi = sg(macd, i), macdSi = sg(macdSignal, i);
        const macdPi = sg(macd, i-1), macdPS = sg(macdSignal, i-1);
        // 5. MACD — 최대 1.5점
        _pushed = factors.length;
        if (macdi != null && macdSi != null && macdPi != null && macdPS != null) {
            const diff = macdi - macdSi, diffP = macdPi - macdPS;
            if (signalType === 'buy'  && diff > 0 && diffP <= 0)      _addPass('✅', 'MACD 골든크로스', 1.5);
            else if (signalType === 'buy'  && diff > 0)               _addPass('🟡', 'MACD 양수', 0.5);
            else if (signalType === 'sell' && diff < 0 && diffP >= 0) _addPass('✅', 'MACD 데드크로스', 1.5);
            else if (signalType === 'sell' && diff < 0)               _addPass('🟡', 'MACD 음수', 0.5);
        }
        _markIfNoneNew(_pushed, 'MACD 비호의적', 1.5);

        // 6. 캔들 패턴 — 1점
        // 분봉일수록 노이즈 캔들이 많으므로 해머/슈팅스타 body 비율을 더 엄격하게
        //   5m 이하 → *2.5   15m → *2.2   30m+ → *2.0
        const _wickRatio = _isShortTF ? 2.5 : _iv === '15m' ? 2.2 : 2.0;
        const op = opens && Array.isArray(opens) ? opens : [];
        _pushed = factors.length;
        // 6. 캔들 패턴 — 최대 1점
        if (sg(op, i) != null && sg(highs, i) != null && sg(lows, i) != null && i > 0) {
            const body  = Math.abs(c - op[i]);
            const upper = highs[i] - Math.max(op[i], c);
            const lower = Math.min(op[i], c) - lows[i];
            if (signalType === 'buy') {
                if (lower >= body * _wickRatio && upper < body)                                              _addPass('✅', '해머 패턴', 1);
                else if (c > op[i] && closes[i-1] < op[i-1] && c > op[i-1] && op[i] < closes[i-1])           _addPass('✅', 'Bullish Engulfing', 1);
            } else {
                if (upper >= body * _wickRatio && lower < body)                                              _addPass('✅', 'Shooting Star', 1);
                else if (c < op[i] && closes[i-1] > op[i-1] && c < op[i-1] && op[i] > closes[i-1])           _addPass('✅', 'Bearish Engulfing', 1);
            }
        }
        _markIfNoneNew(_pushed, '캔들 패턴 없음', 1);

        // 7. ATR 적정 범위 — 0.5점
        // 타임프레임별 허용 변동성 범위 차별화 (분봉은 자연스럽게 ATR% 높음)
        //   5m 이하: 0.3~5.0%, >8.0% 패널티
        //   15m    : 0.4~4.0%, >6.0% 패널티
        //   30m    : 0.5~3.5%, >5.5% 패널티
        //   1h+    : 0.5~3.0%, >5.0% 패널티 (기존)
        const _atrMin  = _isShortTF ? 0.3 : _iv === '15m' ? 0.4 : 0.5;
        const _atrMax  = _isShortTF ? 5.0 : _iv === '15m' ? 4.0 : _iv === '30m' ? 3.5 : 3.0;
        const _atrPen  = _isShortTF ? 8.0 : _iv === '15m' ? 6.0 : _iv === '30m' ? 5.5 : 5.0;
        // 7. ATR — 최대 0.5점
        const atri = sg(atr, i);
        _pushed = factors.length;
        let _atrPctStr = '?';
        if (atri != null && c > 0) {
            const atrPct = (atri / c) * 100;
            _atrPctStr = atrPct.toFixed(1);
            if (atrPct >= _atrMin && atrPct <= _atrMax) _addPass('✅', `ATR ${_atrPctStr}%`, 0.5);
            else if (atrPct > _atrPen)                  _addPass('⚠️', `ATR ${_atrPctStr}% (과다)`, -0.5);
        }
        _markIfNoneNew(_pushed, `ATR ${_atrPctStr}% (범위 외)`, 0.5);

        // 8. Bollinger Band 위치 — 0.5점
        // 분봉일수록 BB를 자주 터치 → 더 극단적인 위치(밴드 바깥 근접)만 의미 있음
        //   5m 이하 → 0.25/0.75   15m → 0.27/0.73   30m+ → 0.30/0.70
        const _bbBuyThr  = _isShortTF ? 0.25 : _iv === '15m' ? 0.27 : 0.30;
        const _bbSellThr = _isShortTF ? 0.75 : _iv === '15m' ? 0.73 : 0.70;
        // 8. Bollinger Band — 최대 0.5점
        _pushed = factors.length;
        if (bb && bb.upper && bb.lower && sg(bb.upper, i) != null && sg(bb.lower, i) != null) {
            const bbRange = bb.upper[i] - bb.lower[i];
            if (bbRange > 0) {
                const bbPos = (c - bb.lower[i]) / bbRange;
                if (signalType === 'buy'  && bbPos < _bbBuyThr)       _addPass('✅', 'BB 하단 근접', 0.5);
                else if (signalType === 'sell' && bbPos > _bbSellThr) _addPass('✅', 'BB 상단 근접', 0.5);
            }
        }
        _markIfNoneNew(_pushed, signalType === 'buy' ? 'BB 하단 미근접' : 'BB 상단 미근접', 0.5);

        // 9. 모멘텀 — 0.5점 (타임프레임별 봉 수 최적화)
        //   5m 이하 → 5봉(~25분)   15m → 8봉(~2h)   30m → 6봉(~3h)   1h+ → 5봉
        const momLb  = _isShortTF ? 5 : _iv === '15m' ? 8 : _iv === '30m' ? 6 : 5;
        // 9. 모멘텀 — 최대 0.5점
        const prevCmom = closes[Math.max(0, i - momLb)];
        _pushed = factors.length;
        let _momStr = '?';
        if (prevCmom != null && prevCmom > 0) {
            const momVal = ((c - prevCmom) / prevCmom) * 100;
            _momStr = (momVal >= 0 ? '+' : '') + momVal.toFixed(1) + '%';
            if (signalType === 'buy'  && momVal > 0 && momVal < 5)       _addPass('✅', `모멘텀 +${momVal.toFixed(1)}%`, 0.5);
            else if (signalType === 'sell' && momVal < 0 && momVal > -5) _addPass('✅', `모멘텀 ${momVal.toFixed(1)}%`, 0.5);
        }
        _markIfNoneNew(_pushed, `모멘텀 ${_momStr} (방향 불일치)`, 0.5);

        // 10. 지지/저항 — 1점
        // 분봉에서 lookback이 너무 길면 전날/전전날 고저가가 섞여 의미 희석
        //   5m → 50봉(~4h)   15m → 30봉(~7.5h)   30m → 20봉(~10h)   1h+ → 30봉
        const _srLb = _isShortTF ? 50 : _iv === '15m' ? 30 : _iv === '30m' ? 20 : 30;
        const lb = Math.min(_srLb, i);
        const rH = (highs || []).slice(Math.max(0, i-lb), i).filter(v => v != null);
        const rL = (lows  || []).slice(Math.max(0, i-lb), i).filter(v => v != null);
        // 10. 지지/저항 — 최대 1점
        _pushed = factors.length;
        if (rH.length && rL.length) {
            const maxH = Math.max(...rH), minL = Math.min(...rL);
            if (signalType === 'buy'  && minL > 0 && Math.abs(c - minL) / minL < 0.02)      _addPass('✅', '지지선 근접', 1);
            else if (signalType === 'sell' && maxH > 0 && Math.abs(c - maxH) / maxH < 0.02) _addPass('✅', '저항선 근접', 1);
        }
        _markIfNoneNew(_pushed, signalType === 'buy' ? '지지선 미근접' : '저항선 미근접', 1);

        // 최종 등급 (D 제거 — C/B/A/S 4단계)
        const grade    = score >= 9 ? 'S' : score >= 7 ? 'A' : score >= 5 ? 'B' : 'C';
        const winRate  = score >= 9 ? 85  : score >= 7 ? 72  : score >= 5 ? 60  : 50;
        const stars    = score >= 9 ? '⭐⭐⭐⭐⭐' : score >= 7 ? '⭐⭐⭐⭐' : score >= 5 ? '⭐⭐⭐' : '⭐⭐';
        const recommendation = grade === 'S' ? '강력 진입' : grade === 'A' ? '진입 권장' : grade === 'B' ? '신중 진입' : '관망 권장';
        // 미달 조건은 잠재 점수 큰 순으로 정렬 후 라벨 문자열로 변환 ('어떻게 등급 올릴지' 안내)
        weak.sort((a, b) => b.max - a.max);
        const weakFactors = weak.map(w => `⚪ ${w.label} (잠재 +${w.max})`);
        // factors = 통과/부분/약점 (✅/🟡/❌/⚠️), weak = 미달 (⚪). 푸시 알림은 통과만 사용
        return {
            grade, score: +score.toFixed(1), winRate, stars,
            factors,                       // 점수 영향 + 유의미 (시그널 콜아웃 용)
            weakFactors,                   // 점수 영향 X, 잠재 점수 큰 순으로 정렬됨
            recommendation, fallback: false,
        };
    }

    // ── 등급 필터 함수 ──────────────────────────────────────────────
    function _setMinGrade(grade) {
        log('[grade] filter changed:', grade);
        _minGradeFilter = grade;
        localStorage.setItem('stockai_min_grade', grade);
        // 버튼 활성화 UI (grade-btn 레거시 + grade-seg-btn 모두 지원)
        document.querySelectorAll('.grade-btn, .grade-seg-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.grade === grade));
        // 시그널 캐시 초기화 (재계산 강제)
        _signalGrades = {};
        // 마커 클리어 후 재렌더링
        try { if (lwCandleSeries) lwCandleSeries.setMarkers([]); } catch(e) {}
        if (_lastSigArgs) {
            try {
                _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb);
            } catch(e) {
                console.error('[grade] render fail', e);
            }
        } else {
            warn('[grade] _lastSigArgs is null — open a stock first');
        }
    }

    function _passesGradeFilter(grade, isFallback) {
        if (isFallback) return true;           // 폴백 마커는 무조건 통과
        const order = { C: 0, B: 1, A: 2, S: 3 };
        const min = order[_minGradeFilter];
        const cur = order[grade];
        if (min === undefined) return true;    // 알 수 없는 필터값 → 통과
        if (cur === undefined) return true;    // 알 수 없는 등급 → 통과
        return cur >= min;
    }

    // ── Smart Dip v3 진입 품질 필터 ─────────────────────────────────
    function _smartDipV3Filter(opts) {
        const {
            i, closes, highs, lows, opens, volumes,
            ema20, ema60, ema120, ema240,
            rsi, atrArr, adxArr, _spxTrendUp,
            currentInterval, ts,
        } = opts;
        const c = closes[i];
        const reasons = [];
        let qualityScore = 0;

        // 필터 1: ADX 추세 강도 (Linda Raschke Holy Grail)
        const adxVal = adxArr[i] || 0;
        if (adxVal < 25) {
            reasons.push(`❌ ADX ${adxVal.toFixed(0)} (추세 약함)`);
            return { pass: false, reasons, qualityScore };
        }
        qualityScore += adxVal >= 35 ? 2 : 1;
        reasons.push(`✅ ADX ${adxVal.toFixed(0)} (추세 강함)`);

        // 필터 2: HTF 추세 정렬 (다중 시간 프레임)
        const htfLag = currentInterval === '1m' ? 15
                     : currentInterval === '5m'  ? 6
                     : currentInterval === '15m' ? 4
                     : currentInterval === '30m' ? 2 : 1;
        const _e60prev  = ema60[Math.max(0, i - htfLag * 5)];
        const _e120prev = ema120[Math.max(0, i - htfLag * 10)];
        const htfTrendUp = ema60[i] != null && _e60prev != null
                        && ema60[i] > _e60prev
                        && ema120[i] != null && _e120prev != null
                        && ema120[i] > _e120prev;
        if (!htfTrendUp) {
            reasons.push('❌ HTF 추세 약함');
            return { pass: false, reasons, qualityScore };
        }
        qualityScore += 2;
        reasons.push('✅ HTF 상승 추세');

        // 필터 3: 거래량 확인 (Wyckoff)
        const volSlice = volumes.slice(Math.max(0, i - 20), i).filter(v => v != null);
        const volAvg20 = volSlice.length ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length : 0;
        const volRatio  = volAvg20 > 0 ? (volumes[i]   || 0) / volAvg20 : 1;
        const volPrevR  = volAvg20 > 0 ? (volumes[i-1] || 0) / volAvg20 : 1;
        const volRecovery = volPrevR < 1.0 && volRatio > 1.2;
        if (volRatio < 0.8) {
            reasons.push(`❌ 거래량 부족 ${volRatio.toFixed(1)}x`);
            return { pass: false, reasons, qualityScore };
        }
        if (volRecovery)        { qualityScore += 2; reasons.push(`✅ 거래량 회복 ${volRatio.toFixed(1)}x`); }
        else if (volRatio >= 1.2) { qualityScore += 1; reasons.push(`✅ 거래량 ${volRatio.toFixed(1)}x`); }

        // 필터 4: 직전 봉 급락 방지 + 양봉 확인 (Al Brooks)
        if (i > 0 && opens[i-1] != null && opens[i-1] > 0) {
            const prevDrop = ((closes[i-1] - opens[i-1]) / opens[i-1]) * 100;
            if (prevDrop < -3) {
                reasons.push(`❌ 직전 봉 급락 ${prevDrop.toFixed(1)}%`);
                return { pass: false, reasons, qualityScore };
            }
        }
        if (opens[i] != null && closes[i] > opens[i]) {
            qualityScore += 1;
            reasons.push('✅ 양봉 반등 확인');
        } else {
            reasons.push('❌ 현재 봉 음봉 (반등 미확인)');
            return { pass: false, reasons, qualityScore };
        }

        // 필터 5: ATR 변동성 (과다 시 차단)
        const curAtr = atrArr[i] || 0;
        const atrPct = c > 0 ? (curAtr / c) * 100 : 0;
        if (atrPct > 5.0) {
            reasons.push(`❌ ATR ${atrPct.toFixed(1)}% (변동성 과다)`);
            return { pass: false, reasons, qualityScore };
        }
        if (atrPct >= 1.0 && atrPct <= 3.0) { qualityScore += 1; reasons.push(`✅ ATR ${atrPct.toFixed(1)}% (적정)`); }

        // 필터 6: S&P 500 시장 환경
        if (_spxTrendUp === true)       { qualityScore += 1; reasons.push('✅ S&P 500 상승 추세'); }
        else if (_spxTrendUp === false)  { qualityScore -= 1; reasons.push('❌ S&P 500 하락 추세 (시장 약세)'); }

        // 필터 7: RSI 위치 (과매수 차단)
        const rsiVal = rsi[i] != null ? rsi[i] : 50;
        if (rsiVal > 75) {
            reasons.push(`❌ RSI ${rsiVal.toFixed(0)} (과매수)`);
            return { pass: false, reasons, qualityScore };
        }
        if (rsiVal >= 40 && rsiVal <= 65) { qualityScore += 1; reasons.push(`✅ RSI ${rsiVal.toFixed(0)} (적정)`); }

        // 필터 8: 장 시작 30분 노이즈 회피 (미국 장)
        if (ts && ts[i]) {
            const d = new Date(ts[i] * 1000);
            const h = d.getUTCHours(), m = d.getUTCMinutes();
            if ((h === 13 && m >= 30) || (h === 14 && m === 0)) {
                qualityScore -= 1;
                reasons.push('❌ 장 시작 30분 (노이즈 회피)');
            }
        }

        const pass  = qualityScore >= 5;
        const grade = qualityScore >= 8 ? 'S' : qualityScore >= 6 ? 'A' : qualityScore >= 4 ? 'B' : 'C';
        return {
            pass,
            qualityScore: +qualityScore.toFixed(1),
            grade,
            reasons,
            adx:      +adxVal.toFixed(1),
            volRatio: +volRatio.toFixed(2),
            atrPct:   +atrPct.toFixed(2),
            rsiVal:   +rsiVal.toFixed(0),
        };
    }

    // ── S&P 500(SPY) 시장 환경 캐시 ─────────────────────────────────
    async function _loadSpxData() {
        try {
            const to   = new Date().toISOString().split('T')[0];
            const from = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
            const r = await fetch(`/api/polygon/candles?ticker=SPY&timespan=day&multiplier=1&from=${from}&to=${to}`);
            if (!r.ok) return;
            const d = await r.json();
            if (d?.candles?.length) window._spxCache = d.candles;
        } catch(e) { warn('[spx cache]', e.message); }
    }

    // renderSmartDipQuality 제거됨 (v830)

    // ── Smart Dip 진입 후 N봉 결과 추적 ────────────────────────────
    function _trackSmartDipResult(entryT, entryPx) {
        setTimeout(() => {
            try {
                const tsArr = _lastSigArgs?.ts;
                const clArr = _lastSigArgs?.q?.close;
                if (!tsArr || !clArr) return;
                const lastIdx = clArr.length - 1;
                let exitPx = null;
                for (let i = lastIdx; i >= 0; i--) { if (clArr[i] != null) { exitPx = clArr[i]; break; } }
                if (!exitPx) return;
                const pnlPct = ((exitPx - entryPx) / entryPx) * 100;
                const history = JSON.parse(localStorage.getItem('stockai_sd_history') || '[]');
                history.push({
                    entryT, entryPx, exitPx, pnlPct,
                    grade: window._smartDipAnalysis?.[entryT]?.grade,
                    win: pnlPct > 0,
                });
                if (history.length > 500) history.shift();
                localStorage.setItem('stockai_sd_history', JSON.stringify(history));
            } catch(_) {}
        }, 60 * 1000);
    }

    // ── 당일 본장 5분봉 캐시 (Smart Dip 전용 — 차트 인터벌 무관) ──
    let _sdBars5m = null;       // { open, high, low, close, volume, ts } — 당일 정규장 5분봉
    let _sdBars5mSym = null;    // 캐시된 종목
    let _sdBars5mTs = 0;        // 마지막 로드 시각(ms)
    let _sdBarsLoading = false;
    const _SD_BARS_TTL = 5 * 60 * 1000; // 5분

    async function _loadSmartDipBars(symbol, force) {
        symbol = symbol || (typeof currentSymbol !== 'undefined' ? currentSymbol : null);
        if (!symbol || _sdBarsLoading) return;
        // 한국 종목(.KS/.KQ)은 미지원 → 캐시 비우고 현재 q 폴백
        if (/\.(KS|KQ)$/i.test(symbol)) { _sdBars5m = null; _sdBars5mSym = null; return; }
        // 같은 종목 + 5분 이내 + 강제 아님 → skip
        if (!force && _sdBars5mSym === symbol && (Date.now() - _sdBars5mTs) < _SD_BARS_TTL) return;
        _sdBarsLoading = true;
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
            const data = await fetchWithProxy(url);
            const r = data?.chart?.result?.[0];
            const ind = r?.indicators?.quote?.[0];
            if (r?.timestamp && ind?.close && ind.close.filter(v => v != null).length >= 30) {
                _sdBars5m = { open: ind.open, high: ind.high, low: ind.low, close: ind.close, volume: ind.volume, ts: r.timestamp };
                _sdBars5mSym = symbol;
                _sdBars5mTs = Date.now();
                // 로드 완료 → 마지막 시그널 인자로 Smart Dip 재렌더
                if (_chartSmartDipEnabled && _lastSigArgs?.q) {
                    try { _renderSmartDipLayer(_lastSigArgs.q, _lastSigArgs.ts); } catch(_) {}
                }
            }
        } catch (e) { try { warn('[smartdip] bars load fail', e?.message); } catch(_) {} }
        finally { _sdBarsLoading = false; }
    }

    function _renderSmartDipLayer(q) {
        _clearSmartDipLines();
        const el = document.getElementById('smartDipCard');
        if (!_chartSmartDipEnabled) { if (el) el.style.display = 'none'; return; }
        if (!lwCandleSeries || !q) return;

        // Smart Dip 활성인데 당일 5분봉 캐시가 없거나 오래됐으면 비동기 로드 (현재 종목)
        if (_chartSmartDipEnabled && typeof currentSymbol !== 'undefined' && currentSymbol
            && !/\.(KS|KQ)$/i.test(currentSymbol)
            && (_sdBars5mSym !== currentSymbol || (Date.now() - _sdBars5mTs) > _SD_BARS_TTL)) {
            _loadSmartDipBars(currentSymbol);
        }

        // ── 당일 본장 5분봉 우선 (차트 인터벌 무관 — 당일 단타 진입 관점) ──
        // _sdBars5m 캐시(현재 종목, 정규장 5분봉)가 충분하면 그것으로, 없으면 현재 차트 q 폴백.
        const _today5mOk = _sdBars5m && _sdBars5mSym === currentSymbol
            && (_sdBars5m.close || []).filter(v => v != null).length >= 30;
        const src  = _today5mOk ? _sdBars5m : q;
        const _sdIv = _today5mOk ? '5m' : currentInterval;

        const closes = src.close || [], highs = src.high || [], lows = src.low || [], volumes = src.volume || [];
        const N = closes.length;
        if (N < 30) { if (el) el.style.display = 'none'; return; }

        const lastVal = arr => { for (let i = arr.length-1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
        const lastClose = lastVal(closes);
        if (!lastClose) { if (el) el.style.display = 'none'; return; }

        const fmtP = p => currentMarket === 'KR' ? Math.round(p).toLocaleString()+'원' : '$'+p.toFixed(2);
        const fmtPct = v => v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '';

        // Swing high/low — 당일 5분봉(또는 폴백 차트) 기준 룩백 + Pivot 방식 감지
        const lb = Math.min(_sdLookback(_sdIv), N);
        const pivotWin = _sdPivotWin(_sdIv);
        const volMult = _sdVolMultiplier(_sdIv);
        const { swHigh, swLow } = _sdSwingPoints(highs, lows, volumes, N, lb, pivotWin, volMult);
        if (!isFinite(swHigh) || !isFinite(swLow) || swHigh <= swLow) { if (el) el.style.display = 'none'; return; }

        // Fibonacci range ATR 정규화 — 타임프레임별 클램프 범위 차별화
        //   swing 폭이 비정상적으로 작거나(노이즈) 거대(왜곡)할 때 ATR 배수로 제한
        const rawRange = swHigh - swLow;
        const atrArr = calcATR(src.high, src.low, src.close, _sdAtrPeriod(_sdIv));
        const atr = lastVal(atrArr) || rawRange * 0.02;
        const { min: fibMin, max: fibMax } = _sdFibClamp(_sdIv);
        const range = Math.max(atr * fibMin, Math.min(rawRange, atr * fibMax));
        const ema20 = lastVal(calcEMA(closes, 20));

        const coeff = _sdGetCoeff(currentSymbol);
        const { sl, tp1, tp2, maxEntry, allocs } = coeff;

        // Fibonacci 진입 레벨
        // 앵커를 현재가 이하로 고정 → 1차가 항상 현재가 아래에 위치
        // (swHigh가 현재가보다 높을 때 1차가 현재가 위로 올라가는 버그 방지)
        const anchor = Math.min(swHigh, lastClose * 0.9995);
        const entryLevels = SD_FIB.slice(0, maxEntry).map((fib, i) => ({
            num: i+1, fib, price: +(anchor - fib * range).toFixed(4), alloc: allocs[i] || 5
        }));

        const goldenIdx = entryLevels.findIndex(e => e.fib === 0.618);
        const goldenEntry = goldenIdx >= 0 ? entryLevels[goldenIdx] : entryLevels[entryLevels.length - 1];
        // 손절선 음수 보호 — swLow 가 매우 낮을 때 음수 방지 (가격의 5% 아래로 fallback)
        const stopLossRaw = swLow - atr * sl;
        const stopLoss = stopLossRaw > 0.01 ? stopLossRaw : Math.max(0.01, lastClose * 0.95);
        const tp1Price = goldenEntry.price + (goldenEntry.price - stopLoss) * tp1;
        const tp2Price = goldenEntry.price + (goldenEntry.price - stopLoss) * tp2;

        const mode = getSmartDipMode(currentSymbol);
        const pos = _posActiveForTicker(currentSymbol);
        const cur = _posCurrentPrice();
        const SD_AMBER = '#F59E0B';

        // ── 차트 라인 ──
        if (mode === 'entry' || mode === 'reentry') {
            // 현재가 아래 레벨만 표시
            let sdVisible = entryLevels.filter(e => e.price < lastClose);
            // ATR 폴백 조건:
            //   (1) 현재가 아래 레벨 자체가 없거나
            //   (2) 현재가 아래 레벨이 있어도 활성화된 그룹의 레벨이 없는 경우
            //   → 활성 그룹 기준으로 폴백해야 1~2차가 현재가 위일 때도 표시됨
            const _sdGrpOf = num => num <= 2 ? '1_2' : num <= 4 ? '3_4' : '5_6';
            const _anyEnabledBelow = sdVisible.some(
                ({ num }) => localStorage.getItem(`stockai_sd_show_${_sdGrpOf(num)}`) !== '0'
            );
            if (!_anyEnabledBelow) {
                // 활성화된 그룹 기준 ATR 폴백 — 현재가 아래에 재계산
                const SD_FIB_VALS = SD_FIB.slice(0, maxEntry);
                sdVisible = entryLevels.map((e, i) => ({
                    ...e,
                    price: +(lastClose - atr * SD_FIB_VALS[i] * 3).toFixed(2),
                })).filter(e => e.price > 0);
            }
            // 지지선 연동 — sdVisible[0](첫 진입) 가격을 현재가 근접 지지선으로 교체
            // 조건: 지지선이 현재가 -3% 이내 AND 기존 1차 계산가와 ±2% 이내
            if (_srLevels?.supports?.length && sdVisible.length > 0) {
                const nearSupport = _srLevels.supports
                    .filter(s => s.price < lastClose && s.price > lastClose * 0.97)
                    .sort((a, b) => b.price - a.price)[0]; // 현재가에 가장 가까운 지지선
                if (nearSupport) {
                    const firstEntry = sdVisible[0];
                    const pctDiff = Math.abs(firstEntry.price - nearSupport.price) / firstEntry.price;
                    if (pctDiff <= 0.02) {
                        sdVisible[0] = { ...firstEntry, price: nearSupport.price, _supportSnapped: true };
                    }
                }
            }

            sdVisible.forEach(({ num, fib, price, _supportSnapped }) => {
                const grp = num <= 2 ? '1_2' : num <= 4 ? '3_4' : '5_6';
                if (localStorage.getItem(`stockai_sd_show_${grp}`) === '0') return;
                const isGolden = fib === 0.618;
                const lineLabel = isGolden ? `★${fmtP(price)}` : `${num}차${fmtP(price)}`;
                _sdAddLine(price, isGolden ? SD_AMBER : 'rgba(245,158,11,0.45)', isGolden ? 2 : 1, isGolden ? 0 : 2, lineLabel);
            });
            _sdAddStopLine(stopLoss);
            if (mode === 'reentry' && pos?.entryPrice) _sdAddLine(pos.entryPrice, '#94a3b8', 1, 2, `↩${fmtP(pos.entryPrice)}`);
            if (mode === 'reentry' && pos?.closedPrice) _sdAddLine(pos.closedPrice, '#64748b', 1, 2, `↗${fmtP(pos.closedPrice)}`);
        } else if (mode === 'loss') {
            // 내 진입 라인은 포지션 카드(_addPosLine)에서 표시 — Smart Dip 중복 제거
            const done = pos?.splitCount || 1;
            // 현재가 아래 남은 레벨만 표시
            entryLevels.slice(done).filter(e => e.price < lastClose).forEach(({ num, fib, price }) => {
                const grp = num <= 2 ? '1_2' : num <= 4 ? '3_4' : '5_6';
                if (localStorage.getItem(`stockai_sd_show_${grp}`) === '0') return;
                _sdAddLine(price, SD_AMBER, 1, 2, `${num}차${fmtP(price)}`);
            });
            _sdAddStopLine(pos?.stopLoss || stopLoss);
        } else if (mode === 'profit') {
            // 내 진입 라인은 포지션 카드(_addPosLine)에서 표시 — Smart Dip 중복 제거
            const t1 = pos?.tp1 || tp1Price, t2 = pos?.tp2 || tp2Price;
            _sdAddLine(t1, '#22C55E', 2, 0, `TP1${fmtP(t1)}`);
            _sdAddLine(t2, '#86EFAC', 1, 2, `TP2${fmtP(t2)}`);
            if (ema20) _sdAddLine(ema20, 'rgba(255,255,255,0.6)', 1, 2, `EMA${fmtP(ema20)}`);
        }

        // ── 카드 HTML ──
        if (el) {
            el.style.display = 'block';
            el.innerHTML = _buildSmartDipCard(mode, pos, cur, entryLevels, goldenEntry,
                stopLoss, tp1Price, tp2Price, ema20, coeff, fmtP, fmtPct);
            // 데이터 출처 표시 — 당일 본장 5분봉 기준일 때 배지에 라벨 추가
            if (_today5mOk) {
                const badge = el.querySelector('.sd-mode-badge');
                if (badge) badge.insertAdjacentHTML('beforeend', '<span class="sd-today-tag">· 당일 본장 5분봉</span>');
            }
        }
    }

    function _buildSmartDipCard(mode, pos, cur, entryLevels, goldenEntry,
        stopLoss, tp1Price, tp2Price, ema20, coeff, fmtP, fmtPct) {

        const modeInfo = {
            entry:   { icon:'📍', label:'무포지션 — 진입 분석 모드',   cls:'sd-m-entry' },
            loss:    { icon:'📉', label:'보유 중 — 분할매수 분석 중',   cls:'sd-m-loss' },
            profit:  { icon:'📈', label:'보유 중 — 익절 분석 중',       cls:'sd-m-profit' },
            reentry: { icon:'✅', label:'매도 완료 — 재진입 분석 중',   cls:'sd-m-reentry' },
        }[mode] || { icon:'📍', label:'진입 분석 모드', cls:'sd-m-entry' };

        const pnlSuffix = (mode === 'loss' || mode === 'profit') && cur && pos?.entryPrice
            ? ' ' + fmtPct((cur - pos.entryPrice) / pos.entryPrice * 100) : '';

        const fibRow = ({ num, fib, price, alloc }, isGolden, extra = '') =>
            `<div class="sd-row${isGolden ? ' sd-golden-row' : ''}">
                <span class="sd-row-num">${num}차</span>
                <span class="sd-row-alloc">${alloc}%</span>
                <span class="sd-row-price">${fmtP(price)}</span>
                <span class="sd-row-fib">(${(fib*100).toFixed(1)}%)</span>
                ${isGolden ? '<span class="sd-golden-tag">★골든존</span>' : ''}
                ${extra}
            </div>`;

        let body = '';

        if (mode === 'entry') {
            const stopRR = goldenEntry.price > stopLoss ? ((tp1Price - goldenEntry.price) / (goldenEntry.price - stopLoss)).toFixed(1) : '-';
            body = `
            <div class="sd-section">─── 진입 후보 ───</div>
            ${entryLevels.map(e => {
                const isGolden = e.fib === 0.618;
                const dist = cur ? `<span class="sd-dist">${((e.price - cur) / cur * 100 >= 0 ? '+' : '') + ((e.price - cur) / cur * 100).toFixed(1)}%</span>` : '';
                return fibRow(e, isGolden, dist);
            }).join('')}
            <div class="sd-divider"></div>
            <div class="sd-row"><span class="sd-label-red">손절선</span><span class="sd-price-red">${fmtP(stopLoss)}</span></div>
            <div class="sd-row"><span class="sd-label-green">익절1</span><span class="sd-price-green">${fmtP(tp1Price)}</span><span class="sd-rr">R:R 1:${stopRR}</span></div>
            <div class="sd-row"><span class="sd-label-green">익절2</span><span class="sd-price-green">${fmtP(tp2Price)}</span><span class="sd-rr">R:R 1:${coeff.tp2.toFixed(1)}</span></div>
            <div class="sd-recommend">→ 추천 첫 진입: ${goldenEntry.num}차 라인 <b>${fmtP(goldenEntry.price)}</b></div>`;
        }
        else if (mode === 'loss') {
            const done = pos?.splitCount || 1;
            const remaining = entryLevels.slice(done);
            const slPrice = pos?.stopLoss || stopLoss;
            const slDist = cur ? ((cur - slPrice) / cur * 100) : null;
            const nearSL = slDist != null && slDist <= 2;
            body = `
            <div class="sd-pos-row">평균 단가 <b>${fmtP(pos.entryPrice)}</b> · ${done}차 완료</div>
            ${remaining.length
                ? `<div class="sd-section">─── 남은 분할매수 ───</div>` + remaining.map(e => fibRow(e, e.fib === 0.618)).join('')
                : `<div class="sd-section">모든 분할매수 차수 완료</div>`}
            <div class="sd-divider"></div>
            <div class="sd-row">
                <span class="sd-label-red">손절선</span>
                <span class="sd-price-red">${fmtP(slPrice)}</span>
                ${slDist != null ? `<span class="sd-rr">현재 ${slDist.toFixed(1)}%</span>` : ''}
            </div>
            ${nearSL ? `<div class="sd-warning-bar sd-warn-red">🔴 추가 진입 금지 — 손절선 근접</div>` : ''}
            <div class="sd-recommend">→ 손절선까지 ${slDist != null ? Math.abs(slDist).toFixed(1) : '-'}% 남음</div>`;
        }
        else if (mode === 'profit') {
            const t1 = pos?.tp1 || tp1Price, t2 = pos?.tp2 || tp2Price;
            const t1Pct = pos?.entryPrice ? ((t1 - pos.entryPrice) / pos.entryPrice * 100).toFixed(1) : null;
            const t2Pct = pos?.entryPrice ? ((t2 - pos.entryPrice) / pos.entryPrice * 100).toFixed(1) : null;
            const t1Dist = cur ? ((t1 - cur) / cur * 100).toFixed(1) : null;
            const emaPct = (ema20 && pos?.entryPrice) ? ((ema20 - pos.entryPrice) / pos.entryPrice * 100).toFixed(1) : null;
            const alert1 = cur && t1 && cur >= t1 * 0.98;
            const alert2 = cur && t2 && cur >= t2 * 0.98;
            const alertEma = ema20 && cur && cur < ema20;
            body = `
            <div class="sd-pos-row">평균 단가 <b>${fmtP(pos.entryPrice)}</b> · 현재 <b>${cur ? fmtP(cur) : '-'}</b></div>
            <div class="sd-section">─── 익절 계획 ───</div>
            <div class="sd-row sd-tp1-row">
                <span class="sd-row-num">1차 익절</span>
                <span class="sd-row-alloc">40%</span>
                <span class="sd-price-green">${fmtP(t1)}</span>
                ${t1Pct != null ? `<span class="sd-row-fib">(+${t1Pct}%)</span>` : ''}
                ${t1Dist != null ? `<span class="sd-dist">→ +${t1Dist}% 남음</span>` : ''}
            </div>
            <div class="sd-row">
                <span class="sd-row-num">2차 익절</span>
                <span class="sd-row-alloc">35%</span>
                <span style="color:#86EFAC;font-weight:600">${fmtP(t2)}</span>
                ${t2Pct != null ? `<span class="sd-row-fib">(+${t2Pct}%)</span>` : ''}
            </div>
            <div class="sd-row">
                <span class="sd-row-num">트레일링</span>
                <span class="sd-row-alloc">25%</span>
                <span class="sd-row-price">${ema20 ? `EMA20 ${fmtP(ema20)}` : 'EMA20 이탈 시'}</span>
                ${emaPct != null ? `<span class="sd-row-fib">(${parseFloat(emaPct)>=0?'+':''}${emaPct}%)</span>` : ''}
            </div>
            ${alert1 ? `<div class="sd-warning-bar sd-warn-amber">💰 1차 익절 근접 — 청산 고려</div>` : ''}
            ${alert2 ? `<div class="sd-warning-bar sd-warn-amber">💰💰 2차 익절 근접</div>` : ''}
            ${alertEma ? `<div class="sd-warning-bar sd-warn-amber">🔔 트레일링 스톱 — 청산 검토</div>` : ''}`;
        }
        else if (mode === 'reentry') {
            const realPnl = pos?.closedPrice && pos?.entryPrice
                ? (pos.closedPrice - pos.entryPrice) / pos.entryPrice * 100 : null;
            body = `
            <div class="sd-pos-row">
                진입 <b>${fmtP(pos.entryPrice)}</b> → 매도 <b>${pos.closedPrice ? fmtP(pos.closedPrice) : '-'}</b>
                ${realPnl != null ? `<span style="color:${realPnl>=0?'#22C55E':'#EF4444'};margin-left:6px;">실현 ${fmtPct(realPnl)}</span>` : ''}
            </div>
            <div class="sd-section">─── 재진입 분석 ───</div>
            ${entryLevels.map(e => {
                const isGolden = e.fib === 0.618;
                const dist = cur ? `<span class="sd-dist">${((e.price - cur) / cur * 100 >= 0 ? '+' : '') + ((e.price - cur) / cur * 100).toFixed(1)}%</span>` : '';
                return fibRow(e, isGolden, dist);
            }).join('')}
            <div class="sd-recommend">→ 재진입 최적 구간: ${goldenEntry.num}차 <b>${fmtP(goldenEntry.price)}</b></div>`;
        }

        return `<div class="card sd-card">
            <div class="card-title">⚡ Smart Dip
                <span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:4px;">눌림목 피보나치 분할매수</span>
            </div>
            <div class="sd-mode-badge ${modeInfo.cls}">${modeInfo.icon} ${modeInfo.label}${pnlSuffix}</div>
            ${body}
        </div>`;
    }

    function toggleSmartDipLayer() {
        const newState = !_chartSmartDipEnabled;
        // 라디오 방식: ON 시 다른 분석 자동 OFF
        if (newState) {
            if (_chartKullamagiEnabled) {
                _chartKullamagiEnabled = false;
                localStorage.setItem('stockai_chart_kull', '0');
                _updateKullagBtnUi();
            }
            if (_chartSepaEnabled) {
                _chartSepaEnabled = false;
                localStorage.setItem('stockai_chart_sepa', '0');
                const sepaEl = document.getElementById('sepaAnalysis');
                if (sepaEl) sepaEl.classList.add('sepa-hidden');
            }
            // 수정 1: Smart Dip ON → 분할매수 자동 OFF (중복 라인 방지)
            if (_chartSplitEnabled) {
                _chartSplitEnabled = false;
                localStorage.setItem('stockai_chart_split_enabled', '0');
            }
        }
        _chartSmartDipEnabled = newState;
        localStorage.setItem('stockai_chart_smartdip_enabled', newState ? '1' : '0');
        // 켤 때 당일 본장 5분봉 즉시 로드 (다음 렌더 대기 없이)
        if (newState && typeof currentSymbol !== 'undefined' && currentSymbol) {
            try { _loadSmartDipBars(currentSymbol, true); } catch(_) {}
        }
        if (_lastSigArgs) {
            try { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); } catch(e) {}
        } else {
            _clearSmartDipLines();
            const el = document.getElementById('smartDipCard');
            if (el) el.style.display = 'none';
        }
    }

    function toggleSmartDipGroup(group) {
        const key = `stockai_sd_show_${group}`;
        const cur = localStorage.getItem(key) !== '0';
        localStorage.setItem(key, cur ? '0' : '1');
        if (_lastSigArgs) {
            try { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
            catch(e) {}
        }
    }

    // Phase M: chart-mobile.js에서 호출 — 가격 라인 라벨 토글 후 즉시 재렌더
    function _triggerSigRebuild() {
        if (_lastSigArgs) {
            try { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
            catch(e) {}
        }
    }

    // ── Minervini SEPA 토글 (카드 표시/숨김) ─────────────────────
    // _chartSepaEnabled 는 상단(174~)에서 미리 선언됨 — TDZ 방지를 위해 중복 선언 제거

    // 차트 라인 관리 (_detectMinerviniSetup 연동)
    let _minerviniChartLines = [];
    function _clearMinerviniChartLines() {
        _minerviniChartLines = _clearOwnLines(_minerviniChartLines);
        document.querySelectorAll('.minervini-badge').forEach(e => e.remove());
    }
    function _mvAddLine(price, color, width, style, title) {
        if (!lwCandleSeries || price == null || isNaN(price)) return;
        const _isMob = window.innerWidth <= 600;
        const axisLabelVisible = _isMob ? !!(title && title.includes('손절')) : true;
        try {
            _pushPriceLine(_minerviniChartLines, lwCandleSeries.createPriceLine({
                price, color, lineWidth: width, lineStyle: style, axisLabelVisible, title,
            }));
        } catch(e) {}
    }
    // 초기 상태 반영 (sepaAnalysis는 렌더 후 표시 여부 제어)
    (function _sdSepaInit() {
        const el = document.getElementById('sepaAnalysis');
        if (el && !_chartSepaEnabled) el.classList.add('sepa-hidden');
    })();

    // ── EMA 눌림목 백테스팅 ────────────────────────────────────────
    function _runBacktest(candleData, ts, cooldown) {
        if (!candleData || candleData.length < 120) return null;

        const closes  = candleData.map(c => c.close);
        const highs   = candleData.map(c => c.high);
        const lows    = candleData.map(c => c.low);
        const opens   = candleData.map(c => c.open);

        const emaC20  = calcEMA(closes, 20);
        const emaC60  = calcEMA(closes, 60);
        const emaC120 = calcEMA(closes, 120);
        const emaC240 = calcEMA(closes, 240);

        const trades = [];
        let lastBuy1 = -999, lastBuy2 = -999, lastBuy3 = -999;
        let inTrade = false;
        let entryPrice = 0;
        let entryBar = 0;

        for (let i = 5; i < closes.length; i++) {
            const c = closes[i], o = opens[i];
            const l = lows[i];
            const isBull = c > o;

            const e20  = emaC20[i],  e60  = emaC60[i];
            const e120 = emaC120[i], e240 = emaC240[i];

            const stUp = e20 && e60 && e120
                ? (e20 > e60 && e60 > e120) : false;

            // ── 매수 신호 ──
            if (!inTrade) {
                let buySignal = false;
                if (e20 && l <= e20 * 1.002 && isBull && stUp
                    && (i - lastBuy1) >= cooldown) {
                    buySignal = true; lastBuy1 = i;
                } else if (e60 && l <= e60 * 1.002 && isBull
                    && e60 > (e120||0) && stUp
                    && (i - lastBuy2) >= cooldown) {
                    buySignal = true; lastBuy2 = i;
                } else if (e120 && l <= e120 * 1.002 && isBull
                    && e120 > (e240||0) && stUp
                    && (i - lastBuy3) >= cooldown) {
                    buySignal = true; lastBuy3 = i;
                }
                if (buySignal) {
                    inTrade = true;
                    entryPrice = closes[i];
                    entryBar = i;
                }
            }

            // ── 매도 신호 (EMA20 이탈 또는 20봉 타임아웃) ──
            if (inTrade && i > entryBar) {
                const prevC   = closes[i-1];
                const prevE20 = emaC20[i-1];
                const sellSignal = e20 && prevE20 && prevC > prevE20 && c < e20;
                const timeout = (i - entryBar) >= 20;
                if (sellSignal || timeout) {
                    const pnl = (closes[i] - entryPrice) / entryPrice * 100;
                    trades.push({
                        entryBar, exitBar: i,
                        entryPrice, exitPrice: closes[i],
                        pnl: +pnl.toFixed(2),
                        win: pnl > 0,
                        timeout,
                    });
                    inTrade = false;
                }
            }
        }

        if (trades.length === 0) return null;

        const wins    = trades.filter(t => t.win).length;
        const losses  = trades.length - wins;
        const winRate = (wins / trades.length * 100).toFixed(1);
        const avgPnl  = (trades.reduce((s,t) => s + t.pnl, 0) / trades.length).toFixed(2);
        const avgWin  = wins > 0
            ? (trades.filter(t=>t.win).reduce((s,t)=>s+t.pnl,0)/wins).toFixed(2) : '0';
        const avgLoss = losses > 0
            ? (trades.filter(t=>!t.win).reduce((s,t)=>s+t.pnl,0)/losses).toFixed(2) : '0';
        const maxWin  = Math.max(...trades.map(t=>t.pnl)).toFixed(2);
        const maxLoss = Math.min(...trades.map(t=>t.pnl)).toFixed(2);

        return { trades, total: trades.length, wins, losses, winRate,
                 avgPnl, avgWin, avgLoss, maxWin, maxLoss, cooldown };
    }

    async function _openBacktest() {
        if (!currentSymbol) {
            showToast('⚠️ 종목을 먼저 선택해주세요');
            return;
        }

        // ── 로딩 모달 먼저 표시 ──
        let modal = document.getElementById('backtestModal');
        if (modal) modal.remove();
        modal = document.createElement('div');
        modal.id = 'backtestModal';
        modal.style.cssText = `position:fixed;inset:0;z-index:9999;
            background:rgba(0,0,0,0.7);display:flex;align-items:center;
            justify-content:center;padding:16px;`;
        modal.innerHTML = `
            <div style="background:var(--bg2);border-radius:16px;
                        padding:40px;text-align:center;min-width:280px">
                <div style="font-size:24px;margin-bottom:12px">📊</div>
                <div style="font-size:14px;font-weight:700;color:var(--text1);margin-bottom:6px">
                    백테스팅 데이터 로드 중...
                </div>
                <div style="font-size:12px;color:var(--text3)">
                    더 많은 봉 데이터를 가져오고 있어요
                </div>
            </div>`;
        document.body.appendChild(modal);

        try {
            // ── 현재 타임프레임 확인 ──
            const _ts  = (_lastSigArgs && _lastSigArgs.ts) || [];
            const tfSec = _ts.length >= 2 ? (_ts[1] - _ts[0]) : 300;
            const tfMin = Math.round(tfSec / 60);

            // ── 기간 설정 ──
            const startDays = tfMin <= 1  ? 7
                            : tfMin <= 5  ? 30
                            : tfMin <= 15 ? 60
                            : tfMin <= 60 ? 90
                            : 365;
            const intervalMap = {
                1:'1m', 2:'2m', 5:'5m', 15:'15m',
                30:'30m', 60:'60m', 1440:'1d',
            };
            const interval  = intervalMap[tfMin] || currentInterval || '5m';
            const endDate   = new Date();
            const startDate = new Date(endDate - startDays * 86400000);
            const startStr  = startDate.toISOString().split('T')[0];
            const endStr    = endDate.toISOString().split('T')[0];

            // ── Yahoo Finance API 호출 ──
            let btCandles = (_lastSigArgs && _lastSigArgs.candleData) || [];
            let btTs      = _ts;
            let dataSource = `현재 차트 (${btCandles.length}봉)`;

            try {
                const url = `/api/chart?symbol=${encodeURIComponent(currentSymbol)}&interval=${interval}&start=${startStr}&end=${endStr}`;

                // 재시도 1회 (429 시 1.5초 지연)
                const fetchWithRetry = async (u, retries = 1) => {
                    const res = await fetch(u);
                    if (res.status === 429 && retries > 0) {
                        await new Promise(ok => setTimeout(ok, 1500));
                        return fetchWithRetry(u, retries - 1);
                    }
                    return res;
                };

                const r = await fetchWithRetry(url);

                if (r.ok) {
                    const raw = await r.json();
                    const quotes = raw?.chart?.result?.[0];
                    if (quotes) {
                        const _tsArr = quotes.timestamp || [];
                        const _q     = quotes.indicators?.quote?.[0] || {};
                        const parsed = _tsArr.map((t, i) => ({
                            time:   t,
                            open:   _q.open?.[i],
                            high:   _q.high?.[i],
                            low:    _q.low?.[i],
                            close:  _q.close?.[i],
                            volume: _q.volume?.[i],
                        })).filter(c => c.close != null);
                        if (parsed.length >= 120) {
                            btCandles = parsed;
                            btTs      = parsed.map(c => c.time);
                            dataSource = `API (${parsed.length}봉)`;
                        }
                    }
                } else if (r.status === 429) {
                    showToast('⚠️ API 요청 한도 초과 — 현재 차트 데이터로 백테스팅해요');
                    dataSource = `현재 차트 (${btCandles.length}봉)`;
                }
            } catch(fetchErr) { /* 네트워크 오류 → 폴백: 기존 candleData 사용 */ }

            const tfLabel = tfMin < 60
                ? `${tfMin}분봉`
                : tfMin === 60 ? '1시간봉' : '일봉';

            if (btCandles.length < 120) {
                modal.remove();
                showToast('⚠️ 데이터가 부족해요 (최소 120봉 필요)');
                return;
            }

            // ── 6가지 쿨다운 비교 ──
            const cooldowns = [5, 10, 15, 24, 30, 60];
            const results   = cooldowns.map(cd => _runBacktest(btCandles, btTs, cd));

            const minTrades  = Math.min(...results.filter(r => r).map(r => r.total));
            const hasWarning = minTrades < 20;

            // 타임프레임 기반 동적 라벨 (봉수 × 분 = 실제 시간)
            const _cdLabel = cd => {
                const mins = cd * tfMin;
                if (mins < 60) return `${cd}봉 (${mins}분)`;
                const h = Math.floor(mins / 60), m = mins % 60;
                return m > 0 ? `${cd}봉 (${h}시간 ${m}분)` : `${cd}봉 (${h}시간)`;
            };
            const cooldownLabels = Object.fromEntries(cooldowns.map(cd => [cd, _cdLabel(cd)]));

            const rows = results.map((r, idx) => {
                if (!r) return `<tr><td style="padding:6px 8px">${cooldownLabels[cooldowns[idx]]}</td>
                    <td colspan="6" style="color:var(--text3);text-align:center;padding:6px 8px">신호 없음</td></tr>`;
                const isTop = results.filter(x=>x)
                    .sort((a,b)=>parseFloat(b.winRate)-parseFloat(a.winRate))[0]
                    ?.cooldown === r.cooldown;
                return `<tr style="${isTop?'background:rgba(34,197,94,0.08);':''}">
                    <td style="padding:6px 8px;font-weight:${isTop?'700':'400'}">
                        ${cooldownLabels[r.cooldown]}${isTop?' 🏆':''}
                    </td>
                    <td style="padding:6px 8px;text-align:center;font-weight:700;color:${parseFloat(r.winRate)>=55?'#22C55E':parseFloat(r.winRate)>=45?'#F59E0B':'#EF4444'}">
                        ${r.winRate}%
                    </td>
                    <td style="padding:6px 8px;text-align:center">${r.total}회</td>
                    <td style="padding:6px 8px;text-align:center;color:${parseFloat(r.avgPnl)>0?'#22C55E':'#EF4444'}">
                        ${parseFloat(r.avgPnl)>0?'+':''}${r.avgPnl}%
                    </td>
                    <td style="padding:6px 8px;text-align:center;color:#22C55E">+${r.avgWin}%</td>
                    <td style="padding:6px 8px;text-align:center;color:#EF4444">${r.avgLoss}%</td>
                    <td style="padding:6px 8px;text-align:center;font-size:10px;color:var(--text3)">
                        +${r.maxWin}% / ${r.maxLoss}%
                    </td>
                </tr>`;
            }).join('');

            const bestResult = results.filter(x=>x)
                .sort((a,b)=>parseFloat(b.winRate)-parseFloat(a.winRate))[0];

            const tradeRows = bestResult
                ? bestResult.trades.slice(-10).reverse().map(t => `
                    <tr>
                        <td style="padding:5px 8px;color:${t.win?'#22C55E':'#EF4444'}">
                            ${t.win?'✅ 수익':'❌ 손실'}
                        </td>
                        <td style="padding:5px 8px;text-align:center">$${t.entryPrice.toFixed(2)}</td>
                        <td style="padding:5px 8px;text-align:center">$${t.exitPrice.toFixed(2)}</td>
                        <td style="padding:5px 8px;text-align:center;font-weight:700;color:${t.pnl>0?'#22C55E':'#EF4444'}">
                            ${t.pnl>0?'+':''}${t.pnl}%
                        </td>
                        <td style="padding:5px 8px;text-align:center;font-size:10px;color:var(--text3)">
                            ${t.timeout?'⏱️ 타임아웃':'📉 매도'}
                        </td>
                    </tr>`).join('')
                : '';

            modal.innerHTML = `
            <div style="background:var(--bg2);border-radius:16px;width:100%;
                        max-width:700px;max-height:85dvh;overflow-y:auto;padding:20px;"
                 onclick="event.stopPropagation()">
                <div style="display:flex;justify-content:space-between;
                            align-items:center;margin-bottom:16px">
                    <div>
                        <div style="font-size:16px;font-weight:700;color:var(--text1)">
                            📊 EMA 백테스팅
                        </div>
                        <div style="font-size:11px;color:var(--text3);margin-top:2px">
                            ${currentFullSymbol} · ${tfLabel} · ${dataSource} 기준
                            (${startDays}일치)
                        </div>
                    </div>
                    <button onclick="document.getElementById('backtestModal').remove()"
                        style="background:none;border:none;color:var(--text3);
                               font-size:20px;cursor:pointer;line-height:1">✕</button>
                </div>

                ${hasWarning ? `
                <div style="background:rgba(245,158,11,0.1);
                            border:1px solid rgba(245,158,11,0.3);
                            border-radius:8px;padding:10px 12px;
                            margin-bottom:12px;font-size:11px;color:#F59E0B">
                    ⚠️ 거래 수가 적어 통계 신뢰도가 낮아요.
                    더 긴 타임프레임(15분봉, 1시간봉)으로 테스트해보세요.
                </div>` : ''}

                <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">
                    🏆 쿨다운별 승률 비교
                </div>
                <div style="overflow-x:auto;margin-bottom:16px">
                    <table style="width:100%;border-collapse:collapse;font-size:12px">
                        <thead>
                            <tr style="border-bottom:2px solid var(--border)">
                                <th style="padding:6px 8px;text-align:left;color:var(--text3)">쿨다운</th>
                                <th style="padding:6px 8px;text-align:center;color:var(--text3)">승률</th>
                                <th style="padding:6px 8px;text-align:center;color:var(--text3)">거래수</th>
                                <th style="padding:6px 8px;text-align:center;color:var(--text3)">평균손익</th>
                                <th style="padding:6px 8px;text-align:center;color:var(--text3)">평균수익</th>
                                <th style="padding:6px 8px;text-align:center;color:var(--text3)">평균손실</th>
                                <th style="padding:6px 8px;text-align:center;color:var(--text3)">최대</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

                ${bestResult ? `
                <div style="background:rgba(34,197,94,0.08);
                            border:1px solid rgba(34,197,94,0.2);
                            border-radius:10px;padding:12px;margin-bottom:16px">
                    <div style="font-size:11px;color:#22C55E;font-weight:700;margin-bottom:4px">
                        🏆 최적 쿨다운: ${cooldownLabels[bestResult.cooldown]}
                    </div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap">
                        <span style="font-size:13px;font-weight:700;color:var(--text1)">
                            승률 ${bestResult.winRate}%
                        </span>
                        <span style="font-size:13px;color:${parseFloat(bestResult.avgPnl)>0?'#22C55E':'#EF4444'}">
                            평균 ${parseFloat(bestResult.avgPnl)>0?'+':''}${bestResult.avgPnl}%
                        </span>
                        <span style="font-size:13px;color:var(--text2)">
                            총 ${bestResult.total}회 거래
                        </span>
                    </div>
                </div>` : ''}

                ${tradeRows ? `
                <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">
                    📋 최근 거래 내역 (최적 쿨다운 기준 10개)
                </div>
                <div style="overflow-x:auto">
                    <table style="width:100%;border-collapse:collapse;font-size:12px">
                        <thead>
                            <tr style="border-bottom:1px solid var(--border)">
                                <th style="padding:5px 8px;text-align:left;color:var(--text3)">결과</th>
                                <th style="padding:5px 8px;text-align:center;color:var(--text3)">매수가</th>
                                <th style="padding:5px 8px;text-align:center;color:var(--text3)">매도가</th>
                                <th style="padding:5px 8px;text-align:center;color:var(--text3)">손익</th>
                                <th style="padding:5px 8px;text-align:center;color:var(--text3)">사유</th>
                            </tr>
                        </thead>
                        <tbody>${tradeRows}</tbody>
                    </table>
                </div>` : ''}

                <div style="margin-top:16px;padding:10px;background:rgba(245,158,11,0.08);
                            border-radius:8px;font-size:10px;color:var(--text3);line-height:1.5">
                    ⚠️ 백테스팅은 과거 데이터 기반 참고 지표예요.
                    실제 매매 결과와 다를 수 있으며, 수수료·슬리피지 미반영.
                    투자 판단의 보조 도구로만 활용해주세요.
                </div>
            </div>`;

            modal.onclick = e => { if (e.target === modal) modal.remove(); };

        } catch(e) {
            document.getElementById('backtestModal')?.remove();
            showToast('⚠️ 백테스팅 실패: ' + e.message);
        }
    }

    function toggleSepaLayer() {
        const newState = !_chartSepaEnabled;
        // 라디오 방식: ON 시 다른 분석 자동 OFF
        if (newState) {
            if (_chartKullamagiEnabled) {
                _chartKullamagiEnabled = false;
                localStorage.setItem('stockai_chart_kull', '0');
                _updateKullagBtnUi();
            }
            if (_chartSmartDipEnabled) {
                _chartSmartDipEnabled = false;
                localStorage.setItem('stockai_chart_smartdip_enabled', '0');
            }
        }
        _chartSepaEnabled = newState;
        localStorage.setItem('stockai_chart_sepa', newState ? '1' : '0');
        const el = document.getElementById('sepaAnalysis');
        if (el) {
            if (_chartSepaEnabled) {
                el.classList.remove('sepa-hidden');
                try { renderMinerviniSEPA(); } catch(e) {}
            } else {
                el.classList.add('sepa-hidden');
                _clearMinerviniChartLines(); // 차트 라인 + 배지 즉시 제거
            }
        }
        // 차트 라인 갱신 (꺼진 레이어 잔류 라인 즉시 제거)
        if (_lastSigArgs) {
            try { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
            catch(e) {}
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Kullamägi (Mark Minervini 계열 모멘텀 트레이더) 분석 레이어
    // 4가지 핵심 셋업: EP / Bull Flag / Breakout / Parabolic Short
    // 타임프레임·종목 유형 자동 감지 → 매칭 셋업 우선 표시
    // ═══════════════════════════════════════════════════════════
    let _chartKullamagiLines = [];
    // _chartKullamagiEnabled 는 상단(174~)에서 미리 선언됨 — TDZ 방지를 위해 중복 선언 제거

    // 페이지 로드 시 분석 라디오 상태 강제 정리
    // 둘 이상 ON이면 우선순위 적용: Smart Dip > Kullamägi > SEPA
    (function _initAnalysisRadioState() {
        const onCount = [_chartKullamagiEnabled, _chartSepaEnabled, _chartSmartDipEnabled].filter(Boolean).length;
        if (onCount <= 1) return;
        if (_chartSmartDipEnabled) {
            _chartKullamagiEnabled = false;
            _chartSepaEnabled = false;
            localStorage.setItem('stockai_chart_kull', '0');
            localStorage.setItem('stockai_chart_sepa', '0');
        } else if (_chartKullamagiEnabled) {
            _chartSepaEnabled = false;
            localStorage.setItem('stockai_chart_sepa', '0');
        }
    })();

    // ── Kullamägi 버튼 UI ──────────────────────────────────────
    function _updateKullagBtnUi() {
        const btn = document.getElementById('chartKullamagiBtn');
        if (!btn) return;
        if (_chartKullamagiEnabled) {
            btn.style.color = '#9D4EDD';
            btn.style.background = 'rgba(157,78,221,.12)';
            btn.style.borderColor = 'rgba(157,78,221,.5)';
            btn.title = 'Kullamägi + 매매 라인 켜짐 — 클릭하면 끄기';
        } else {
            btn.style.color = 'var(--text3)';
            btn.style.background = 'transparent';
            btn.style.borderColor = 'var(--border)';
            btn.title = 'Kullamägi + 매매 라인 끄짐 — 클릭하면 켜기';
        }
    }

    function toggleKullamagiLayer() {
        const newState = !_chartKullamagiEnabled;
        // 라디오 방식: ON 시 다른 분석 자동 OFF
        if (newState) {
            if (_chartSepaEnabled) {
                _chartSepaEnabled = false;
                localStorage.setItem('stockai_chart_sepa', '0');
                const sepaEl = document.getElementById('sepaAnalysis');
                if (sepaEl) sepaEl.classList.add('sepa-hidden');
            }
            if (_chartSmartDipEnabled) {
                _chartSmartDipEnabled = false;
                localStorage.setItem('stockai_chart_smartdip_enabled', '0');
            }
        }
        _chartKullamagiEnabled = newState;
        localStorage.setItem('stockai_chart_kull', newState ? '1' : '0');
        _updateKullagBtnUi();
        if (_lastSigArgs) {
            try { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
            catch(e) {}
        }
    }

    function _clearKullamagiLines() {
        _chartKullamagiLines = _clearOwnLines(_chartKullamagiLines);
    }

    // ── 종목 유형 자동 감지 ──────────────────────────────────────
    function _kullDetectTickerType(symbol) {
        if (!symbol) return 'default';
        const s = symbol.toUpperCase();
        // 레버리지 ETF
        if (/^(TQQQ|SQQQ|UPRO|SPXU|UDOW|SDOW|LABU|LABD|SOXL|SOXS|NUGT|DUST|JNUG|JDST|TNA|TZA|UVXY|SVXY|FAS|FAZ|ERX|ERY|TECL|TECS|NAIL|DRN|DRV|CURE|PILL|DFEN|WANT|RETL|CLAW|MIDU|SMDD|HIBL|HIBS|BNKU|BNKD|DPST|DYST|NEED|OILU|OILD|GUSH|DRIP|YINN|YANG|EDC|EDZ|EURL|EFO|EFU|EZJ|SSO|SDS|QLD|QID|DDM|DXD|MVV|MZZ)$/.test(s)) return 'leveraged_etf';
        // 대형주 (S&P 500 주요 / 나스닥 100 대형)
        if (/^(AAPL|MSFT|NVDA|GOOGL|GOOG|META|AMZN|TSLA|AVGO|ORCL|AMD|INTC|CSCO|QCOM|TXN|AMAT|ASML|MU|NFLX|ADBE|CRM|NOW|SNOW|PLTR|UBER|ABNB|SHOP|ZS|CRWD|PANW|DDOG|VEEV|WDAY|OKTA|GTLB|NET|BILL|MNDY|CSGP|AXON|ENPH|SEDG|FSLR|RUN|ILMN|MRNA|PFE|JNJ|UNH|LLY|ABBV|BMY|GILD|AMGN|CVS|V|MA|JPM|BAC|GS|MS|BRK.B|WFC|AXP|SPGI|MCO|BLK|ICE|CME|CB|WM|RSG|ECL|SHW|LIN|APD|MLM|VMC|CAT|DE|HON|GE|MMM|BA|RTX|LMT|NOC|GD|EMR|ETN|PH|ITW|IR|XOM|CVX|COP|EOG|PSX|MPC|VLO|PXD|HAL|BKR|SLB|FANG|OXY)$/.test(s)) return 'large_cap';
        // 소형주/테마주 — 나머지
        return 'small_theme';
    }

    // ── Kullamägi 셋업 감지 ────────────────────────────────────
    function _kullDetectSetups(q, ts) {
        const closes = q.close || [], highs = q.high || [], lows = q.low || [], vols = q.volume || [];
        const N = closes.length;
        if (N < 50) return [];

        const lastIdx = (() => { for (let i = N-1; i >= 0; i--) if (closes[i] != null) return i; return -1; })();
        if (lastIdx < 30) return [];

        const close  = closes[lastIdx];
        const high   = highs[lastIdx];
        const low    = lows[lastIdx];
        const vol    = vols[lastIdx] || 0;
        if (!close) return [];

        // EMAs
        const ema10  = calcEMA(closes, 10);
        const ema20  = calcEMA(closes, 20);
        const ema50  = calcEMA(closes, 50);
        const atrArr = calcATR(highs, lows, closes, 14);
        const lastVal = arr => { for (let i = arr.length-1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
        const e10 = lastVal(ema10), e20 = lastVal(ema20), e50 = lastVal(ema50);
        const atr = lastVal(atrArr);
        if (!e10 || !e20 || !e50 || !atr || atr <= 0) return [];

        // 타임프레임별 거래량 lookback — 분봉일수록 노이즈 평탄화 위해 더 긴 평균 필요
        //   5m 이하 → 30봉   15m → 20봉   30m → 15봉   1h+ → 20봉
        const _kullIv  = typeof currentInterval !== 'undefined' ? (currentInterval || '') : '';
        const _kullShort = /^(1m|2m|5m)$/.test(_kullIv);
        const _kullVolLb = _kullShort ? 30 : _kullIv === '15m' ? 20 : _kullIv === '30m' ? 15 : 20;
        let volSum = 0, volCnt = 0;
        for (let i = Math.max(0, lastIdx - (_kullVolLb - 1)); i <= lastIdx; i++) { if (vols[i]) { volSum += vols[i]; volCnt++; } }
        const avgVol = volCnt ? volSum / volCnt : 0;
        const rvol = avgVol > 0 ? vol / avgVol : 0;

        const setups = [];
        const fmtP = p => currentMarket === 'KR' ? Math.round(p).toLocaleString() + '원' : '$' + p.toFixed(2);
        const pctOf = (p, base) => base ? (((p - base) / base) * 100).toFixed(2) : '0';

        // ── 1) EP (Episodic Pivot) ────────────────────────────────
        // 타임프레임별 갭/RVOL 임계값 — 분봉은 더 엄격하게(거짓 EP 감소)
        //   5m 이하 → 갭 2.0% / RVOL 2.5x   15m → 2.5% / 2.2x
        //   30m    → 3.0% / 2.0x            1h+ → 3.0% / 2.0x (기존)
        const prevClose = closes[lastIdx - 1];
        const gapPct = prevClose ? ((close - prevClose) / prevClose) * 100 : 0;
        const _epGapMin  = _kullShort ? 2.0 : _kullIv === '15m' ? 2.5 : 3.0;
        const _epRvolMin = _kullShort ? 2.5 : _kullIv === '15m' ? 2.2 : 2.0;
        const isEP = gapPct >= _epGapMin && rvol >= _epRvolMin && close > e50;
        if (isEP) {
            const entry = low - atr * 0.1;  // 당일 저점 부근 재진입
            const stop  = low - atr * 0.5;
            const tp1   = entry + (entry - stop) * 2;
            const tp2   = entry + (entry - stop) * 4;
            const rr    = (entry - stop) > 0 ? (tp1 - entry) / (entry - stop) : 0;
            setups.push({
                id: 'ep', label: 'EP (Episodic Pivot)', color: '#9D4EDD',
                desc: `갭업 +${gapPct.toFixed(1)}% · RVOL ${rvol.toFixed(1)}x · EMA50 위`,
                entry, stop, tp1, tp2, rr,
                score: 30 + (gapPct >= 5 ? 10 : 5) + (rvol >= 3 ? 10 : 5) + (close > e20 ? 5 : 0),
                fmtP, pctOf,
            });
        }

        // ── 2) Bull Flag ──────────────────────────────────────────
        // 최근 10봉 중 강한 상승 후 좁은 조정 (최근 5봉 범위 < 이전 추세의 30%)
        let preTrend = 0, flagRange = 0;
        if (lastIdx >= 15) {
            const base = closes[lastIdx - 10];
            const peak = Math.max(...highs.slice(lastIdx - 10, lastIdx - 4).filter(v => v != null));
            preTrend = base && peak ? ((peak - base) / base) * 100 : 0;
            const rLow  = Math.min(...lows.slice(lastIdx - 4, lastIdx + 1).filter(v => v != null));
            const rHigh = Math.max(...highs.slice(lastIdx - 4, lastIdx + 1).filter(v => v != null));
            flagRange = peak > 0 ? ((rHigh - rLow) / peak) * 100 : 0;
        }
        const isBullFlag = preTrend >= 8 && flagRange < preTrend * 0.4 && close > e20;
        if (isBullFlag) {
            // 기 고점 브레이크 기준
            const pivotHigh = Math.max(...highs.slice(lastIdx - 4, lastIdx + 1).filter(v => v != null));
            const entry = pivotHigh + atr * 0.05;
            const stop  = low - atr * 0.5;
            const tp1   = entry + (entry - stop) * 2;
            const tp2   = entry + (entry - stop) * 3;
            const rr    = (entry - stop) > 0 ? (tp1 - entry) / (entry - stop) : 0;
            setups.push({
                id: 'bull_flag', label: 'Bull Flag', color: '#22c55e',
                desc: `추세 +${preTrend.toFixed(1)}% 후 좁은 기 형성 · EMA20 위`,
                entry, stop, tp1, tp2, rr,
                score: 25 + (preTrend >= 15 ? 10 : 5) + (rvol >= 1.5 ? 10 : 0) + (close > e10 ? 5 : 0),
                fmtP, pctOf,
            });
        }

        // ── 3) Breakout (신고점 돌파) ─────────────────────────────
        // 최근 40봉 고점 부근에서 거래량 증가 + EMA 정배열
        const high40 = lastIdx >= 40 ? Math.max(...highs.slice(lastIdx - 39, lastIdx).filter(v => v != null)) : 0;
        const nearHigh40 = high40 > 0 && close >= high40 * 0.98;
        const emaAligned = e10 > e20 && e20 > e50;
        const isBreakout = nearHigh40 && emaAligned && rvol >= 1.5 && !isEP;
        if (isBreakout) {
            const entry = high40 + atr * 0.05;
            const stop  = e20 - atr * 0.2;
            const tp1   = entry + (entry - stop) * 2;
            const tp2   = entry + (entry - stop) * 3.5;
            const rr    = (entry - stop) > 0 ? (tp1 - entry) / (entry - stop) : 0;
            setups.push({
                id: 'breakout', label: 'Breakout', color: '#f59e0b',
                desc: `40봉 고점 ${fmtP(high40)} 돌파 · EMA 정배열 · RVOL ${rvol.toFixed(1)}x`,
                entry, stop, tp1, tp2, rr,
                score: 20 + (rvol >= 2 ? 15 : 5) + (emaAligned ? 10 : 0) + (close > e10 ? 5 : 0),
                fmtP, pctOf,
            });
        }

        // ── 4) Parabolic Short ────────────────────────────────────
        // 최근 5봉 연속 상승 + 이격도 과열 + 거래량 감소 징후
        let consecUp = 0;
        for (let i = lastIdx - 4; i <= lastIdx; i++) {
            if (closes[i] != null && closes[i-1] != null && closes[i] > closes[i-1]) consecUp++;
        }
        const overextended = e20 > 0 ? ((close - e20) / e20) * 100 : 0;
        const isParabolic = consecUp >= 4 && overextended >= 15 && rvol >= 1.5;
        if (isParabolic) {
            // 공매도 셋업 — 현재 고점 매도 또는 지지 붕괴 숏
            const entry = high;
            const stop  = high + atr * 0.5;
            const tp1   = entry - (stop - entry) * 2;
            const tp2   = e20;
            const rr    = (stop - entry) > 0 ? (entry - tp1) / (stop - entry) : 0;
            setups.push({
                id: 'parabolic_short', label: 'Parabolic Short', color: '#ef4444',
                desc: `${consecUp}봉 연속 상승 · EMA20 이격 +${overextended.toFixed(1)}% 과열`,
                entry, stop, tp1, tp2, rr,
                score: 15 + (overextended >= 25 ? 15 : overextended >= 20 ? 10 : 5) + (consecUp >= 5 ? 10 : 5),
                fmtP, pctOf,
            });
        }

        // 점수 내림차순 정렬
        setups.sort((a, b) => b.score - a.score);
        return setups;
    }

    // ── Kullamägi 점수 (0-100) ───────────────────────────────────
    function _kullCalcScore(q, ts, setups) {
        const closes = q.close || [], highs = q.high || [], lows = q.low || [], vols = q.volume || [];
        const N = closes.length;
        if (N < 50) return { total: 0, breakdown: [] };

        const lastIdx = (() => { for (let i = N-1; i >= 0; i--) if (closes[i] != null) return i; return -1; })();
        if (lastIdx < 20) return { total: 0, breakdown: [] };

        const close = closes[lastIdx];
        const ema10  = calcEMA(closes, 10);
        const ema20  = calcEMA(closes, 20);
        const ema50  = calcEMA(closes, 50);
        const lastVal = arr => { for (let i = arr.length-1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
        const e10 = lastVal(ema10), e20 = lastVal(ema20), e50 = lastVal(ema50);
        if (!e10 || !e20 || !e50 || !close) return { total: 0, breakdown: [] };

        const breakdown = [];
        let total = 0;

        // 1) 트렌드 방향 (EMA 정배열) — 25점
        const trendScore = (e10 > e20 ? 12 : 0) + (e20 > e50 ? 13 : 0);
        breakdown.push({ label: 'EMA 정배열 (10>20>50)', score: trendScore, max: 25, ok: trendScore >= 20 });
        total += trendScore;

        // 2) 가격 vs EMA20 — 20점
        const priceVsEma = close > e20 ? (close > e10 ? 20 : 12) : 0;
        breakdown.push({ label: '가격 > EMA20', score: priceVsEma, max: 20, ok: priceVsEma >= 12 });
        total += priceVsEma;

        // 3) 거래량 확인 — 20점
        let volSum = 0, volCnt = 0;
        for (let i = Math.max(0, lastIdx - 19); i <= lastIdx; i++) { if (vols[i]) { volSum += vols[i]; volCnt++; } }
        const avgVol = volCnt ? volSum / volCnt : 0;
        const rvol = avgVol > 0 ? (vols[lastIdx] || 0) / avgVol : 0;
        const volScore = rvol >= 2 ? 20 : rvol >= 1.5 ? 14 : rvol >= 1.0 ? 8 : 0;
        breakdown.push({ label: `RVOL ${rvol.toFixed(1)}x`, score: volScore, max: 20, ok: rvol >= 1.5 });
        total += volScore;

        // 4) 셋업 감지 여부 — 20점
        const setupScore = setups.length >= 2 ? 20 : setups.length === 1 ? 12 : 0;
        breakdown.push({ label: `셋업 감지 (${setups.length}개)`, score: setupScore, max: 20, ok: setups.length >= 1 });
        total += setupScore;

        // 5) 추세 지속성 — 15점 (최근 10봉 양봉 비율)
        let upBars = 0;
        for (let i = Math.max(0, lastIdx - 9); i <= lastIdx; i++) {
            if (closes[i] != null && (q.open || [])[i] != null && closes[i] > (q.open || [])[i]) upBars++;
        }
        const trendCont = Math.round((upBars / 10) * 15);
        breakdown.push({ label: `양봉 비율 ${upBars}/10`, score: trendCont, max: 15, ok: upBars >= 6 });
        total += trendCont;

        return { total: Math.min(100, total), breakdown };
    }

    // ── Kullamägi 차트 라인 렌더 ──────────────────────────────────
    function _renderKullamagiLayer(q, ts, bb) {
        const el = document.getElementById('kullamagiAnalysis');
        _clearKullamagiLines();

        if (!q || !q.close || !q.close.length || !stockData) {
            if (el) el.innerHTML = '';
            return;
        }

        const setups = _kullDetectSetups(q, ts);
        const scoreData = _kullCalcScore(q, ts, setups);
        const tickerType = _kullDetectTickerType(currentSymbol);

        // 차트 라인 — 상위 셋업 1개 표시 (토글 ON 시)
        if (_chartKullamagiEnabled && setups.length > 0 && lwCandleSeries) {
            const best = setups[0];
            const addKL = (price, color, style, width, label, priority = 3) => {
                if (price == null || !isFinite(price) || price <= 0) return;
                try {
                    const axisLabelVisible = _claimPriceLabel(price, priority);
                    const pl = lwCandleSeries.createPriceLine({
                        price, color, lineWidth: width, lineStyle: style,
                        axisLabelVisible, title: label,
                    });
                    _pushPriceLine(_chartKullamagiLines, pl);
                } catch(e) {}
            };
            addKL(best.entry, best.color,    0, 2, `진입 ${best.fmtP(best.entry)}`, 2);
            addKL(best.stop,  'rgba(239,68,68,0.6)', 2, 1, '', 1);  // M3: dashed thin
            addKL(best.tp1,   '#22c55e',     1, 1, `익절1 ${best.fmtP(best.tp1)} (R:R 1:${best.rr.toFixed(1)})`, 3);
            if (best.tp2 && _chartTpLevel >= 2) addKL(best.tp2, '#a3e635', 1, 1, `익절2 ${best.fmtP(best.tp2)}`, 5);
        }

        // 시그널 배지
        const bar = document.getElementById('chartSigBar');
        if (bar && setups.length > 0) {
            const best = setups[0];
            const pillCls = best.id === 'parabolic_short' ? 'sig-blue' : 'sig-red';
            bar.insertAdjacentHTML('beforeend',
                `<span class="chart-sig-pill" style="background:rgba(157,78,221,.15);color:#9D4EDD;border-color:rgba(157,78,221,.4)">⚡ Kullamägi: ${escHtml(best.label)}</span>`
            );
        }

        // Kullamägi 활성 시 셋업 없으면 안내 배지
        if (_chartKullamagiEnabled) {
            const _noSetupBar = document.getElementById('chartSigBar');
            if (_noSetupBar && setups.length === 0) {
                _noSetupBar.insertAdjacentHTML('beforeend',
                    `<span class="chart-sig-pill" style="background:rgba(157,78,221,0.1);color:#9D4EDD;border-color:rgba(157,78,221,0.3)">🟣 Kullamägi — 현재 셋업 없음</span>`
                );
            }
        }

        // 카드 렌더
        _renderKullamagiCard(setups, scoreData, tickerType);
        _updateKullagBtnUi();
    }

    function _renderKullamagiCard(setups, scoreData, tickerType) {
        const el = document.getElementById('kullamagiAnalysis');
        if (!el) return;

        const fmtScore = s => {
            if (s >= 75) return { cls: 'kull-score-a', label: 'A등급 — 강한 매수' };
            if (s >= 55) return { cls: 'kull-score-b', label: 'B등급 — 조건부 진입' };
            if (s >= 35) return { cls: 'kull-score-c', label: 'C등급 — 관망' };
            return { cls: 'kull-score-d', label: 'D등급 — 진입 비권장' };
        };
        const { cls: scoreCls, label: scoreLabel } = fmtScore(scoreData.total);

        const typeLabel = {
            large_cap: '대형주', small_theme: '소형·테마주',
            leveraged_etf: '레버리지 ETF', default: '일반',
        }[tickerType] || '일반';

        // 셋업 카드 HTML
        const setupsHtml = setups.length === 0
            ? `<div class="kull-no-setup">감지된 셋업 없음 — 추세 형성 대기 중</div>`
            : setups.map((s, idx) => {
                const rrCls = s.rr >= 2 ? 'kull-rr-good' : 'kull-rr-warn';
                return `
                <div class="kull-setup ${idx === 0 ? 'kull-setup-best' : ''}">
                    <div class="kull-setup-header">
                        <span class="kull-setup-dot" style="background:${s.color}"></span>
                        <span class="kull-setup-name">${escHtml(s.label)}</span>
                        ${idx === 0 ? '<span class="kull-best-badge">최우선</span>' : ''}
                        <span class="kull-setup-score">점수 ${s.score}</span>
                    </div>
                    <div class="kull-setup-desc">${escHtml(s.desc)}</div>
                    <div class="kull-setup-grid">
                        <div class="kull-grid-item kull-entry">
                            <span class="kull-grid-label">진입가</span>
                            <strong>${s.fmtP(s.entry)}</strong>
                            <span class="kull-grid-pct ${parseFloat(s.pctOf(s.entry, 0)) >= 0 ? '' : ''}"></span>
                        </div>
                        <div class="kull-grid-item kull-stop">
                            <span class="kull-grid-label">손절가</span>
                            <strong>${s.fmtP(s.stop)}</strong>
                        </div>
                        <div class="kull-grid-item kull-tp1">
                            <span class="kull-grid-label">익절1</span>
                            <strong>${s.fmtP(s.tp1)}</strong>
                        </div>
                        <div class="kull-grid-item kull-tp2">
                            <span class="kull-grid-label">익절2</span>
                            <strong>${s.tp2 ? s.fmtP(s.tp2) : '-'}</strong>
                        </div>
                    </div>
                    <div class="kull-rr-bar">
                        <span class="kull-rr-label">R:R</span>
                        <span class="${rrCls}">1 : ${s.rr.toFixed(1)}</span>
                        ${s.rr < 2 ? '<span class="kull-rr-warn-txt">⚠️ 1:2 미만 — 진입 비권장</span>' : ''}
                    </div>
                </div>`;
            }).join('');

        // 점수 분해 HTML
        const breakdownHtml = scoreData.breakdown.map(b => `
            <div class="kull-bd-row">
                <span class="kull-bd-label">${escHtml(b.label)}</span>
                <div class="kull-bd-bar-wrap">
                    <div class="kull-bd-bar" style="width:${Math.round((b.score/b.max)*100)}%;background:${b.ok ? '#9D4EDD' : '#94a3b8'}"></div>
                </div>
                <span class="kull-bd-score ${b.ok ? 'kull-bd-ok' : ''}">${b.score}/${b.max}</span>
            </div>`).join('');

        el.innerHTML = `
            <div class="card kull-card">
                <div class="card-title">
                    <span class="dot" style="background:#9D4EDD"></span>
                    Kullamägi 분석
                    <span class="kull-type-badge">${escHtml(typeLabel)}</span>
                </div>

                <!-- 종합 점수 -->
                <div class="kull-score-wrap">
                    <div class="kull-score-circle ${scoreCls}">
                        <span class="kull-score-num">${scoreData.total}</span>
                        <span class="kull-score-max">/100</span>
                    </div>
                    <div class="kull-score-right">
                        <div class="kull-score-label">${escHtml(scoreLabel)}</div>
                        <div class="kull-score-desc">Kullamägi 모멘텀 종합점수 — EP·Bull Flag·Breakout·Parabolic Short 셋업 기반</div>
                    </div>
                </div>

                <!-- 점수 분해 -->
                <div class="kull-breakdown">${breakdownHtml}</div>

                <!-- 감지된 셋업 -->
                <div class="kull-setups-title">📊 감지된 셋업 (${setups.length}개)</div>
                <div class="kull-setups">${setupsHtml}</div>
            </div>
        `;
    }


    // ═══════════════════════════════════════════════════════════
    // 6번 역피라미딩 분할매수 레이어 — 피보나치 기반 자동 계산
    // Kullamägi / Minervini SEPA 와 완전 독립
    // localStorage: stockai_chart_split_enabled
    // ═══════════════════════════════════════════════════════════
    let _chartSplitLines = [];
    let _chartSplitEnabled = localStorage.getItem('stockai_chart_split_enabled') !== '0';
    let _lastTrailingToastTime = 0; // 트레일링 손절 토스트 쓰로틀 (1분)

    // 분할매수 버튼 UI 업데이트
    function _updateSplitBuyBtnUi() {
        const btn = document.getElementById('chartSplitBuyBtn');
        if (!btn) return;
        if (_chartSplitEnabled) {
            btn.style.color = '#06B6D4';
            btn.style.background = 'rgba(6,182,212,.12)';
            btn.style.borderColor = 'rgba(6,182,212,.5)';
            btn.title = '분할매수 라인 끄기';
        } else {
            btn.style.color = 'var(--text3)';
            btn.style.background = 'transparent';
            btn.style.borderColor = 'var(--border)';
            btn.title = '6번 역피라미딩 분할매수 라인 켜기';
        }
    }

    function toggleSplitBuyLayer() {
        _chartSplitEnabled = !_chartSplitEnabled;
        localStorage.setItem('stockai_chart_split_enabled', _chartSplitEnabled ? '1' : '0');
        // 분할매수 ON 시 Smart Dip 자동 OFF (두 레이어 동시 활성 방지)
        if (_chartSplitEnabled && _chartSmartDipEnabled) {
            _chartSmartDipEnabled = false;
            localStorage.setItem('stockai_chart_smartdip_enabled', '0');
            _updateDdStates();
        }
        _updateSplitBuyBtnUi();
        _updateDdStates();
        if (_lastSigArgs) {
            try { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
            catch(e) {}
        }
    }

    // SD 차수 그룹 토글 (1~2차 / 3~4차 / 5~6차 독립 on/off)
    function toggleSplitGroup(group) {
        const key = `stockai_split_show_${group}`;
        const cur = localStorage.getItem(key) !== '0';
        localStorage.setItem(key, cur ? '0' : '1');
        if (_lastSigArgs) {
            try { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
            catch(e) {}
        }
        if (typeof _updateDdStates === 'function') _updateDdStates();
    }
    // _toggleSplitGroup: 하위 호환 별칭 (toggleSplitGroup으로 통합됨)
    const _toggleSplitGroup = toggleSplitGroup;

    function _clearSplitBuyLines() {
        _chartSplitLines = _clearOwnLines(_chartSplitLines);
    }

    // 종목 유형별 ATR 계수 + 최대 진입 차수
    function getSplitBuyCoeff(ticker) {
        const s = (ticker || '').toUpperCase();
        const LEVERAGED_3X = new Set(['TQQQ','SQQQ','SOXL','SOXS','SPXL','SPXU','UPRO','SDOW','UDOW','LABU','LABD','NUGT','DUST','TNA','TZA','FAS','FAZ','TECL','TECS','NAIL','DRN','DRV']);
        const LEVERAGED_2X = new Set(['NVDL','TSLL','SOFA','OKLL','IONX','MSTU','AMZU','AAPB','QLD','QID','SSO','SDS','DDM','DXD','MVV','MZZ','CURE','HIBL','HIBS']);
        const SMALL_THEME  = new Set(['OKLO','IONQ','SOFI','RGTI','QBTS','SOUN','RKLB','ACHR','JOBY','LILM','SPCE','ASTS','LUNR','MNTS','OPEN','CLOV','WISH','BBIG','WKHS','RIDE']);
        if (LEVERAGED_3X.has(s)) return { atrMult: 0.3, maxEntries: 4, typeLabel: '3x 레버리지 ETF' };
        if (LEVERAGED_2X.has(s)) return { atrMult: 0.5, maxEntries: 5, typeLabel: '2x 레버리지 ETF' };
        if (SMALL_THEME.has(s))  return { atrMult: 0.7, maxEntries: 4, typeLabel: '소형 테마주' };
        return { atrMult: 1.0, maxEntries: 6, typeLabel: '일반 개별주' };
    }

    // 피보나치 스윙 고점·저점 탐색 (최근 lookback 봉)
    function _findSplitSwingHL(highs, lows, closes, lookback) {
        const n = closes.length;
        if (n < 20) return null;
        const window = Math.min(lookback || 60, n);
        const slice_h = highs.slice(n - window).filter(v => v != null);
        const slice_l = lows.slice(n - window).filter(v => v != null);
        if (!slice_h.length || !slice_l.length) return null;

        const swingHigh = Math.max(...slice_h);
        const swingLow  = Math.min(...slice_l);
        const range     = swingHigh - swingLow;
        if (range <= 0) return null;

        // 스윙 고점이 저점보다 뒤에 나타나는지 확인 (하락 조정 국면 = 진입 기회)
        const hiIdx = highs.lastIndexOf(swingHigh);
        const loIdx = lows.lastIndexOf(swingLow);
        // 고점 → 저점 순서여야 의미 있는 피보나치 (조정 구간)
        // 저점 → 고점 순서이면 반등 중 — 여전히 레트레이스 레벨 계산은 가능
        return { swingHigh, swingLow, range, hiIdx, loIdx };
    }

    // 6차 분할매수 레벨 계산
    // ── SMC: FVG (Fair Value Gap) 감지 ─────────────────────────────
    // 상승 FVG: 이전 봉 고점 < 다음 봉 저점 → 가격 불균형 상승 구간
    // 하락 FVG: 이전 봉 저점 > 다음 봉 고점 → 가격 불균형 하락 구간
    function _detectFVG(candleData) {
        const fvgs = [];
        if (!candleData || candleData.length < 3) return fvgs;

        for (let i = 1; i < candleData.length - 1; i++) {
            const prev = candleData[i - 1];
            const curr = candleData[i];
            const next = candleData[i + 1];
            if (!prev || !curr || !next) continue;

            // 상승 FVG: 이전 봉 고점 < 다음 봉 저점
            if (prev.high < next.low) {
                fvgs.push({
                    type: 'bullish',
                    top: next.low,
                    bottom: prev.high,
                    mid: (next.low + prev.high) / 2,
                    time: curr.time,
                });
            }
            // 하락 FVG: 이전 봉 저점 > 다음 봉 고점
            if (prev.low > next.high) {
                fvgs.push({
                    type: 'bearish',
                    top: prev.low,
                    bottom: next.high,
                    mid: (prev.low + next.high) / 2,
                    time: curr.time,
                });
            }
        }
        // 최근 5개만 반환
        return fvgs.slice(-5);
    }

    // ─── Smart Dip v2 — SATS (Self-Aware Trend System) 알고리즘 ────
    // ER: 추세 효율성 (0~1). 1에 가까울수록 강한 추세, 0에 가까울수록 횡보
    function _calcER(closes, len) {
        if (!closes || closes.length < len + 1) return 0.5;
        const valid = closes.filter(v => v != null);
        if (valid.length < len + 1) return 0.5;
        const n = valid.length;
        const change = Math.abs(valid[n-1] - valid[n-1-len]);
        let volatility = 0;
        for (let i = n-len; i < n; i++) volatility += Math.abs(valid[i] - valid[i-1]);
        return volatility > 0 ? Math.min(change / volatility, 1) : 0.5;
    }

    // TQI: 추세 품질 지수 (0~1). 4가지 팩터 가중 평균 (ER / 거래량 / 구조 / 모멘텀)
    function _calcTQI(closes, highs, lows, volumes, er) {
        if (!closes || closes.length < 20) return 0.5;
        const valid = closes.filter(v => v != null);
        const n = valid.length;

        // 1. ER 팩터 (가중치 0.35)
        const tqiEr = Math.min(Math.max(er, 0), 1);

        // 2. 거래량 팩터 (가중치 0.20)
        let tqiVol = 0.5;
        if (volumes && volumes.length >= 20) {
            const vols = volumes.filter(v => v != null && v > 0);
            if (vols.length >= 20) {
                const vMean = vols.slice(-20).reduce((a,b) => a+b, 0) / 20;
                const vStd  = Math.sqrt(vols.slice(-20).reduce((a,b) => a + (b-vMean)**2, 0) / 20);
                const vZ = vStd > 0 ? (vols[vols.length-1] - vMean) / vStd : 0;
                tqiVol = Math.min(Math.max((vZ + 1) / 3, 0), 1);
            }
        }

        // 3. 구조 팩터 — 20봉 내 가격 위치 (가중치 0.25)
        const slen = Math.min(20, valid.length);
        const structHi = Math.max(...highs.slice(-slen).filter(v => v != null));
        const structLo = Math.min(...lows.slice(-slen).filter(v => v != null));
        const structRange = structHi - structLo;
        const pricePos = structRange > 0 ? (valid[n-1] - structLo) / structRange : 0.5;
        const tqiStruct = Math.min(Math.abs(pricePos - 0.5) * 2, 1);

        // 4. 모멘텀 팩터 — 방향 일치 봉 비율 (가중치 0.20)
        const momLen = Math.min(10, n - 1);
        const winChange = valid[n-1] - valid[n-1-momLen];
        let aligned = 0;
        for (let i = n-momLen; i < n; i++) {
            const d = valid[i] - valid[i-1];
            if ((winChange > 0 && d > 0) || (winChange < 0 && d < 0)) aligned++;
        }
        const tqiMom = aligned / momLen;

        return Math.min(Math.max(tqiEr*0.35 + tqiVol*0.20 + tqiStruct*0.25 + tqiMom*0.20, 0), 1);
    }

    // SuperTrend: 1 = 상승 추세, -1 = 하락 추세 (ATR 밴드 기반)
    function _calcSuperTrend(closes, highs, lows, atr, mult) {
        if (!closes || closes.length < 20) return 1;
        const n = closes.length;
        const m = mult || 2.0;
        let trend = 1, upperBand = 0, lowerBand = 0;
        for (let i = 1; i < n; i++) {
            if (closes[i] == null || highs[i] == null || lows[i] == null) continue;
            const hl2 = (highs[i] + lows[i]) / 2;
            const atrVal = atr || (highs[i] - lows[i]);
            const newLower = hl2 - m * atrVal;
            const newUpper = hl2 + m * atrVal;
            lowerBand = (closes[i-1] > lowerBand) ? Math.max(newLower, lowerBand) : newLower;
            upperBand = (closes[i-1] < upperBand) ? Math.min(newUpper, upperBand) : newUpper;
            if      (trend === -1 && closes[i] > upperBand) trend =  1;
            else if (trend ===  1 && closes[i] < lowerBand) trend = -1;
        }
        return trend;
    }

    function _calcSplitBuyLevels(q, atr, emaHint = {}) {
        const closes = q.close || [], highs = q.high || [], lows = q.low || [], volumes = q.volume || [];
        const n = closes.length;
        if (n < 20) return null;

        // ─── Smart Dip v2: TQI + ER + SuperTrend 필터 ───────────────
        // 타임프레임별 SuperTrend ATR 배수 — 분봉은 더 타이트하게(과민 신호 감소)
        //   5m 이하 → 1.8   15m → 2.0   30m → 2.2   1h+ → 2.0 (기존)
        const _splitIv    = typeof currentInterval !== 'undefined' ? (currentInterval || '') : '';
        const _splitShort = /^(1m|2m|5m)$/.test(_splitIv);
        const _stMult     = _splitShort ? 1.8 : _splitIv === '15m' ? 2.0 : _splitIv === '30m' ? 2.2 : 2.0;
        const er      = _calcER(closes, 20);
        const tqi     = _calcTQI(closes, highs, lows, volumes, er);
        const stTrend = _calcSuperTrend(closes, highs, lows, atr, _stMult);
        if (tqi < 0.3)      return null;   // 추세 품질 부족 — 진입 억제
        if (stTrend === -1) return null;   // SuperTrend 하락 — 진입 억제

        const lastClose = (() => { for (let i = n-1; i >= 0; i--) if (closes[i] != null) return closes[i]; return null; })();
        if (!lastClose) return null;

        // 타임프레임별 스윙 탐색 범위 — 분봉은 더 많은 봉으로 충분한 가격 범위 확보
        // 15m·30m: 200봉 ≈ 8~10거래일, 60m: 120봉 ≈ 3주, 1d: 60봉 ≈ 3개월
        const _splitLb = {
            '1m':300,'3m':250,'5m':200,'10m':200,'15m':200,
            '30m':150,'60m':120,'1h':120,'120m':100,'240m':80,
            '1d':60,'1wk':40,'1mo':24
        };
        const hl = _findSplitSwingHL(highs, lows, closes, _splitLb[currentInterval] || 60);
        if (!hl) return null;

        const { swingHigh, swingLow, range } = hl;
        const isKR = currentMarket === 'KR';
        const fmtP = p => isKR ? Math.round(p).toLocaleString() + '원' : '$' + p.toFixed(2);
        const pctOf = (p, base) => base > 0 ? (((p - base) / base) * 100).toFixed(1) : '0';

        // 피보나치 레트레이스 레벨 (고점에서 저점 방향)
        // price = swingHigh - range * fibPct
        const FIBS = [
            { pct: 0.236, weight: 5,  label: '진입 1차', color: '#06B6D4', width: 1, style: 1, suffix: '' },
            { pct: 0.382, weight: 10, label: '진입 2차', color: '#06B6D4', width: 1, style: 1, suffix: '' },
            { pct: 0.500, weight: 15, label: '진입 3차', color: '#06B6D4', width: 2, style: 0, suffix: '' },
            { pct: 0.618, weight: 20, label: '진입 4차', color: '#06B6D4', width: 2, style: 0, suffix: ' ★핵심' },
            { pct: 0.786, weight: 22, label: '진입 5차', color: '#F97316', width: 2, style: 0, suffix: ' ⚠️신중' },
            { pct: 0.886, weight: 28, label: '진입 6차', color: '#EF4444', width: 2, style: 0, suffix: ' 🔴마지막' },
        ];

        const allLevels = FIBS.map(f => ({
            ...f,
            price: swingHigh - range * f.pct,
            fibLabel: (f.pct * 100).toFixed(1) + '%',
            fmtP, pctOf,
        }));

        // 현재가 아래 라인만 표시
        // 모두 현재가 위에 있으면 ATR 기반으로 현재가 아래 재계산
        let levels = allLevels.filter(lv => lv.price < lastClose);

        if (levels.length === 0) {
            const FIBS_PCT = [0.236, 0.382, 0.500, 0.618, 0.786, 0.886];
            levels = FIBS.map((f, i) => ({
                ...f,
                price: +(lastClose - (atr || lastClose * 0.02) * FIBS_PCT[i] * 3).toFixed(2),
                fibLabel: (f.pct * 100).toFixed(1) + '%',
                fmtP, pctOf,
            })).filter(lv => lv.price > 0);
        }

        // ── EMA 눌림목이 감지되면 EMA 가격을 진입가로 우선 사용 ──────
        const { swEma20: _hEma20, swEma60: _hEma60, swEma120: _hEma120,
                emaPullback1: _pb1, emaPullback2: _pb2, emaPullback3: _pb3 } = emaHint;
        const _emaLevels = [];
        if (_pb1 && _hEma20  != null) _emaLevels.push({ price: +_hEma20.toFixed(isKR?0:2),  label: '진입 1차', fibLabel: 'EMA 20',  weight: 30, suffix: '',      color: '#06B6D4', width: 2, style: 0, fmtP, pctOf });
        if (_pb2 && _hEma60  != null) _emaLevels.push({ price: +_hEma60.toFixed(isKR?0:2),  label: '진입 2차', fibLabel: 'EMA 60',  weight: 30, suffix: '',      color: '#06B6D4', width: 2, style: 0, fmtP, pctOf });
        if (_pb3 && _hEma120 != null) _emaLevels.push({ price: +_hEma120.toFixed(isKR?0:2), label: '진입 3차', fibLabel: 'EMA 120', weight: 40, suffix: ' ★핵심', color: '#F59E0B', width: 2, style: 0, fmtP, pctOf });
        if (_emaLevels.length > 0) {
            const _emaBelow = _emaLevels.filter(lv => lv.price < lastClose);
            if (_emaBelow.length > 0) levels = _emaBelow;
        }

        // ER 기반 최대 차수 제한 — 타임프레임별 임계값 차별화
        //   5m 이하 → 0.45/0.22   15m → 0.50/0.25   30m → 0.55/0.28   1h+ → 0.50/0.25
        const _erHi = _splitShort ? 0.45 : _splitIv === '15m' ? 0.50 : _splitIv === '30m' ? 0.55 : 0.50;
        const _erLo = _splitShort ? 0.22 : _splitIv === '15m' ? 0.25 : _splitIv === '30m' ? 0.28 : 0.25;
        const erMaxEntry = er > _erHi ? 4 : er > _erLo ? 3 : 0;
        if (erMaxEntry === 0) return null;
        if (levels.length > erMaxEntry) levels = levels.slice(0, erMaxEntry);

        // 손절선 ATR 오프셋 — 타임프레임별 (분봉은 더 타이트, 30m+ 더 여유)
        //   5m 이하 → 0.25배   15m → 0.30배   30m → 0.35배   1h+ → 0.30배
        const _stopMult = _splitShort ? 0.25 : _splitIv === '15m' ? 0.30 : _splitIv === '30m' ? 0.35 : 0.30;
        const stopPrice = swingLow - (atr || swingLow * 0.03) * _stopMult;

        // SMC: Premium / Discount Zone 계산 (스윙 고저점 50% 기준)
        const equilibrium  = (swingHigh + swingLow) / 2;
        const isDiscount   = lastClose <= equilibrium;  // 50% 아래 → 저가 매수 적합
        const isPremium    = lastClose > equilibrium;   // 50% 위  → 고가 주의

        // ─── v2: 신호 품질 점수 + 동적 익절 ──────────────────────────
        const score    = Math.round((tqi * 0.5 + er * 0.3 + (stTrend === 1 ? 0.2 : 0)) * 100);
        const dynScale = Math.min(Math.max(tqi * 0.6 + 1.0 * 0.4, 0.5), 2.0);
        const tp1      = +(swingLow + (swingHigh - swingLow) * 0.618 * dynScale).toFixed(2);
        const tp2      = +(swingLow + (swingHigh - swingLow) * 1.0   * dynScale).toFixed(2);

        return { levels, stopPrice, swingHigh, swingLow, range, lastClose, fmtP, pctOf,
                 equilibrium: +equilibrium.toFixed(2), isDiscount, isPremium,
                 tqi, er, stTrend, score, dynScale, tp1, tp2, erMaxEntry };
    }

    // 금지 조건 감지 (SPY MA20, VIX 대신 내부 근사값 사용)
    function _splitBuyWarnings(q) {
        const closes = q.close || [], volumes = q.volume || [];
        const n = closes.length;
        if (n < 25) return [];
        const lastClose = (() => { for (let i = n-1; i >= 0; i--) if (closes[i] != null) return closes[i]; return null; })();
        if (!lastClose) return [];

        const warnings = [];

        // 1) 88.6% 이탈 = 스윙 저점 근처 (추세 종료 가능성)
        // — levels에서 판단, 여기선 거래량+가격 하락 패턴만 체크
        // 거래량 감소 + 가격 하락 (최근 5봉)
        let volDropBars = 0;
        for (let i = Math.max(1, n-5); i < n; i++) {
            if (closes[i] != null && closes[i-1] != null && volumes[i] != null && volumes[i-1] != null) {
                if (closes[i] < closes[i-1] && volumes[i] < volumes[i-1]) volDropBars++;
            }
        }
        if (volDropBars >= 3) warnings.push({ code: 'vol_drop', text: '⚠️ 모멘텀 소실 — 거래량 감소·가격 하락 연속', warnOnly: true });

        // 2) 최근 5봉 모두 하락 = 5차·6차 비권장
        let consecDown = 0;
        for (let i = Math.max(1, n-5); i < n; i++) {
            if (closes[i] != null && closes[i-1] != null && closes[i] < closes[i-1]) consecDown++;
        }
        if (consecDown >= 5) warnings.push({ code: 'strong_down', text: '⚠️ 시장 약세 전환 — 신중 구간 (5차·6차 진입 비권장)', disable5_6: true });

        return warnings;
    }

    // 메인 레이어 렌더
    function _renderSplitBuyLayer(q, ts) {
        _clearSplitBuyLines();
        _updateSplitBuyBtnUi();

        const el = document.getElementById('rrAnalysis'); // R:R 카드에 섹션 추가용
        if (!q || !q.close || !q.close.length) return;

        const atrArr = calcATR(q.high, q.low, q.close, 14);
        const atr = (() => { for (let i = atrArr.length-1; i >= 0; i--) if (atrArr[i] != null) return atrArr[i]; return null; })();
        if (!atr) return;

        // ─── Smart Dip v2 스윙: EMA 5단계 계산 ───────────────────────
        const _swCloses = q.close || [];
        const _ema20A   = calcEMA(_swCloses, 20);
        const _ema60A   = calcEMA(_swCloses, 60);
        const _ema120A  = calcEMA(_swCloses, 120);
        const _ema240A  = calcEMA(_swCloses, 240);
        const _ema480A  = calcEMA(_swCloses, 480);
        const _emaGet   = arr => { for (let i = arr.length-1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
        const swEma20   = _emaGet(_ema20A);
        const swEma60   = _emaGet(_ema60A);
        const swEma120  = _emaGet(_ema120A);
        const swEma240  = _emaGet(_ema240A);
        const swEma480  = _emaGet(_ema480A);
        // 포지션 모달 EMA 240 손절 버튼용 전역 노출
        try { window._lastEma240 = swEma240; } catch(e) {}
        const isEmaAligned = swEma20 != null && swEma60 != null && swEma120 != null && swEma240 != null
            && swEma20 > swEma60 && swEma60 > swEma120 && swEma120 > swEma240;
        // EMA 눌림목 감지 — 최근 캔들이 EMA에 닿고 양봉 마감 + RSI ≥ 40
        const _swCd    = _lastSigArgs?.candleData;
        const _swLast  = _swCd?.length ? _swCd[_swCd.length - 1] : null;
        const _swBull  = _swLast && _swLast.close > _swLast.open;
        const _swRsiArr = calcRSI(_swCloses);
        const _swLastRsi = _emaGet(_swRsiArr);
        const _swRsiOk  = _swLastRsi != null ? _swLastRsi > 40 : true;
        const emaPullback1 = !!(_swLast && swEma20  != null && _swLast.low <= swEma20  && _swBull && _swRsiOk);
        const emaPullback2 = !!(_swLast && swEma60  != null && _swLast.low <= swEma60  && _swBull && _swRsiOk && swEma60  > (swEma120 || 0));
        const emaPullback3 = !!(_swLast && swEma120 != null && _swLast.low <= swEma120 && _swBull && _swRsiOk && swEma120 > (swEma240 || 0));

        // ── EMA 240 트레일링 손절 자동 업데이트 ────────────────────
        // 분할매수 ON + 포지션 보유 중 + EMA240이 현재 손절가보다 높을 때만 업데이트 (항상 위 방향)
        // Smart Dip ON 시 _chartSplitEnabled=false 로 자동 비활성 → 트레일링 손절 미실행 (정상)
        if (_chartSplitEnabled && swEma240 != null && typeof _posActiveForTicker === 'function') {
            const _trailPa = _posActiveForTicker(currentSymbol);
            if (_trailPa && _trailPa.status === 'holding') {
                const _curStop = _trailPa.stopLoss || 0;
                if (swEma240 > _curStop) {
                    const _trailArr = _posLoad();
                    const _trailRec = _trailArr.find(p => p.id === _trailPa.id);
                    if (_trailRec) {
                        _trailRec.stopLoss = +(swEma240.toFixed(currentMarket === 'KR' ? 0 : 2));
                        _posSaveAll(_trailArr);
                        try { _posDrawChartLine(); } catch(e) {}
                        const _now = Date.now();
                        if (_now - _lastTrailingToastTime > 60000) {
                            _lastTrailingToastTime = _now;
                            const _fmtT = v => currentMarket === 'KR' ? Math.round(v).toLocaleString()+'원' : '$'+v.toFixed(2);
                            try { showToast(`📈 트레일링 손절 업데이트: ${_fmtT(_trailRec.stopLoss)}`); } catch(e) {}
                        }
                    }
                }
            }
        }

        const _emaHint = { swEma20, swEma60, swEma120, swEma240, emaPullback1, emaPullback2, emaPullback3 };
        const data = _calcSplitBuyLevels(q, atr, _emaHint);
        if (!data) return;

        const coeff = getSplitBuyCoeff(currentSymbol);
        const { levels, stopPrice, swingHigh, swingLow, lastClose, fmtP, pctOf,
                tqi = 0.5, er = 0.5, stTrend = 1, score = 50, dynScale = 0.8, tp1, tp2 } = data;

        const warnings = _splitBuyWarnings(q);
        const has5_6Warn = warnings.some(w => w.disable5_6);

        // ── 차트 라인 ── Smart Dip 활성 시 중복 방지 ──────────────
        if (_chartSplitEnabled && !_chartSmartDipEnabled && lwCandleSeries) {
            const addLine = (price, color, style, width, title, priority = 2) => {
                if (price == null || !isFinite(price) || price <= 0) return;
                try {
                    const axisLabelVisible = _claimPriceLabel(price, priority);
                    const pl = lwCandleSeries.createPriceLine({
                        price, color, lineWidth: width, lineStyle: style,
                        axisLabelVisible, title,
                    });
                    _pushPriceLine(_chartSplitLines, pl);
                } catch(e) {}
            };

            const mobileMaxEntries = _isMobileView ? Math.min(coeff.maxEntries, 4) : coeff.maxEntries;
            levels.forEach((lv, idx) => {
                const entryNum = idx + 1;
                // 차수 그룹별 표시 여부 (1~2차/3~4차/5~6차 독립 토글)
                const groupKey = entryNum <= 2 ? '1_2' : entryNum <= 4 ? '3_4' : '5_6';
                const groupVisible = localStorage.getItem(`stockai_split_show_${groupKey}`) !== '0';
                if (!groupVisible) return;

                const active = entryNum <= mobileMaxEntries && !(has5_6Warn && entryNum >= 5);
                // 우측 가격 라벨 배경색 2차 기준(#06B6D4)으로 통일
                const color = active ? '#06B6D4' : 'rgba(148,163,184,0.4)';
                // 1차 진입가 강조 (🎯, 굵은 실선, 높은 우선순위)
                // 필터링 후 재배치된 순서대로 번호 재생성
                const newLabel = `진입 ${entryNum}차`;
                const suffix = entryNum >= 5 ? ' ⚠️신중'
                             : entryNum === levels.length ? ' 🔴마지막' : '';
                const title = entryNum === 1
                    ? `🎯 진입 1차 ${fmtP(lv.price)} (${lv.fibLabel})`
                    : `${newLabel} ${fmtP(lv.price)} (${lv.fibLabel}) — ${lv.weight}%${suffix}`;
                const width = entryNum === 1 ? 3 : (active ? lv.width : 1);
                const priority = entryNum === 1 ? 1 : 2;
                addLine(lv.price, color, lv.style, width, title, priority);
            });

            // 손절선 — Smart Dip 활성 시 SD 레이어가 손절선 표시 → 중복 방지
            // M3: 1px dashed, 0.6 opacity, 가격축 chip만 (title 없음)
            if (!_chartSmartDipEnabled) {
                addLine(stopPrice, 'rgba(239,68,68,0.6)', 2, 1, '', 1);
            }

            // 평균 단가 라인 (포지션 등록 시)
            const pos = typeof _posActiveForTicker === 'function' ? _posActiveForTicker(currentSymbol) : null;
            if (pos && pos.entryPrice) {
                const avg = pos.entryPrice;
                const pnl = ((lastClose - avg) / avg * 100);
                const pnlTxt = (pnl >= 0 ? '+' : '') + pnl.toFixed(1) + '%';
                const pnlLabel = pnl >= 0 ? ` 📈${pnlTxt}` : ` 📉${pnlTxt}`;
                addLine(avg, '#9D4EDD', 1, 2, `평균 ${fmtP(avg)} (${pos.splitCount || '?'}차 완료)${pnlLabel}`);
            }

            // 시그널 배지 — 종목 유형 + 핵심 진입 가격
            const bar = document.getElementById('chartSigBar');
            if (bar && levels.length > 0) {
                // 종목 유형 배지 (1~N차 안내)
                const _sdTypeBadgeMap = {
                    '3x 레버리지 ETF': { icon: '🔋', label: '3x 레버리지', cls: 'sig-red' },
                    '2x 레버리지 ETF': { icon: '🔋', label: '2x 레버리지', cls: 'sig-neutral' },
                    '소형 테마주':      { icon: '📍', label: '소형주',       cls: 'sig-neutral' },
                    '일반 개별주':      { icon: '📊', label: '일반주',       cls: 'sig-neutral' },
                };
                const _sdTypeMeta = _sdTypeBadgeMap[coeff.typeLabel] || { icon: '📊', label: '일반주', cls: 'sig-neutral' };
                bar.insertAdjacentHTML('beforeend',
                    `<span class="chart-sig-pill ${_sdTypeMeta.cls}" title="${coeff.typeLabel} — 총 ${coeff.maxEntries}차 분할매수 활성">${_sdTypeMeta.icon} ${_sdTypeMeta.label} (1~${coeff.maxEntries}차)</span>`
                );
                // 핵심 4차 진입 가격 (0.618 황금비율) — levels < 4이면 표시 안함
                if (levels.length >= 4) {
                    const lvl4 = levels[3];
                    bar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill" style="background:rgba(6,182,212,.15);color:#06B6D4;border-color:rgba(6,182,212,.4)">분할매수 핵심 ${fmtP(lvl4.price)} (${lvl4.fibLabel})</span>`
                    );
                }
                warnings.filter(w => w.warnOnly).forEach(w => {
                    bar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill sig-neutral">${w.text}</span>`
                    );
                });
            }
            // ── v2: 동적 익절 라인 (TP1 / TP2) ──────────────────────
            if (tp1 && tp2 && tp1 > lastClose) {
                addLine(tp1, 'rgba(34,197,94,0.55)', 2, 1, `TP1 ${fmtP(tp1)}`, 3);
                addLine(tp2, 'rgba(34,197,94,0.85)', 0, 1, `TP2 ${fmtP(tp2)}`, 3);
            }
        }

        // ── SMC: Premium/Discount Zone 배지 + Equilibrium 라인 ────
        if (_chartSplitEnabled && data.equilibrium) {
            const { isDiscount, isPremium, equilibrium } = data;
            const zoneBar = document.getElementById('chartSigBar');
            if (zoneBar) {
                zoneBar.querySelectorAll('.sd-zone-badge').forEach(el => el.remove());
                if (isDiscount) {
                    zoneBar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill sd-zone-badge" style="background:rgba(34,197,94,0.12);color:#22C55E;border-color:rgba(34,197,94,0.4)">💚 Discount Zone — 매수 적합 구간</span>`
                    );
                } else if (isPremium) {
                    zoneBar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill sd-zone-badge" style="background:rgba(239,68,68,0.12);color:#EF4444;border-color:rgba(239,68,68,0.4)">🔴 Premium Zone — 고가 구간 주의</span>`
                    );
                }
            }
            // Equilibrium 라인 (회색 점선)
            if (lwCandleSeries) {
                try {
                    const axisLabelVisible = _claimPriceLabel(equilibrium, 4);
                    const eqLine = lwCandleSeries.createPriceLine({
                        price: equilibrium,
                        color: 'rgba(148,163,184,0.6)',
                        lineWidth: 1,
                        lineStyle: 2,
                        axisLabelVisible,
                        title: `EQ ${fmtP(equilibrium)}`,
                    });
                    _pushPriceLine(_chartSplitLines, eqLine);
                } catch(e) {}
            }
        }

        // ── SMC: FVG + 피보나치 진입 라인 겹침 배지 ───────────────
        const _fvgCandleData = _lastSigArgs?.candleData;
        const _allFvgs = _detectFVG(_fvgCandleData);
        const bullishFVGs = _allFvgs.filter(f => f.type === 'bullish');

        if (_chartSplitEnabled && bullishFVGs.length > 0) {
            const fvgBar = document.getElementById('chartSigBar');
            levels.forEach((lv, idx) => {
                const entryNum = idx + 1;
                if (entryNum > coeff.maxEntries) return;
                const hasFVG = bullishFVGs.some(fvg =>
                    lv.price >= fvg.bottom * 0.995 &&
                    lv.price <= fvg.top   * 1.005
                );
                if (hasFVG && fvgBar) {
                    fvgBar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill" style="background:rgba(245,158,11,0.15);color:#F59E0B;border-color:rgba(245,158,11,0.5)">💎 FVG + 진입 ${entryNum}차 겹침 — 강한 진입 포인트</span>`
                    );
                }
            });
        }

        // ── Smart Dip v2 배지 (TQI / ER / Score) ──────────────────
        if (_chartSplitEnabled) {
            const v2Bar = document.getElementById('chartSigBar');
            if (v2Bar) {
                const tqiColor = tqi > 0.6 ? 'rgba(34,197,94,0.15)' : tqi > 0.35 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)';
                const tqiTxt   = tqi > 0.6 ? '#22C55E' : tqi > 0.35 ? '#F59E0B' : '#EF4444';
                const tqiLabel = tqi > 0.6 ? '고품질' : tqi > 0.35 ? '보통' : '저품질';
                const erLabel  = er > 0.5 ? '강한 추세' : er > 0.25 ? '보통 추세' : '횡보';
                const scoreColor = score >= 70 ? '#22C55E' : score >= 50 ? '#F59E0B' : '#EF4444';
                v2Bar.insertAdjacentHTML('beforeend',
                    `<span class="chart-sig-pill" style="background:${tqiColor};color:${tqiTxt};border-color:${tqiColor.replace('0.15','0.4')}">TQI ${(tqi*100).toFixed(0)} · ${tqiLabel}</span>`
                );
                v2Bar.insertAdjacentHTML('beforeend',
                    `<span class="chart-sig-pill" style="background:rgba(99,102,241,0.1);color:#818CF8;border-color:rgba(99,102,241,0.3)">ER ${(er*100).toFixed(0)} · ${erLabel}</span>`
                );
                v2Bar.insertAdjacentHTML('beforeend',
                    `<span class="chart-sig-pill" style="background:rgba(15,23,42,0.4);color:${scoreColor};border-color:rgba(255,255,255,0.1)">Score ${score}/100</span>`
                );
            }
        }

        // ── EMA 정배열 / 눌림목 배지 ───────────────────────────────
        if (_chartSplitEnabled) {
            const _isKR2 = currentMarket === 'KR';
            const _fmtEma = v => v == null ? '-' : _isKR2 ? Math.round(v).toLocaleString()+'원' : '$'+v.toFixed(2);
            const eBar = document.getElementById('chartSigBar');
            if (eBar) {
                if (emaPullback1 || emaPullback2 || emaPullback3) {
                    const pNum = emaPullback3 ? 3 : emaPullback2 ? 2 : 1;
                    const pVal = emaPullback3 ? swEma120 : emaPullback2 ? swEma60 : swEma20;
                    eBar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill" style="background:rgba(34,197,94,0.12);color:#22C55E;border-color:rgba(34,197,94,0.4)">📈 EMA ${pNum}차 눌림목 ${_fmtEma(pVal)}</span>`
                    );
                }
                eBar.insertAdjacentHTML('beforeend', isEmaAligned
                    ? `<span class="chart-sig-pill" style="background:rgba(99,102,241,0.1);color:#818CF8;border-color:rgba(99,102,241,0.3)">✅ EMA 정배열</span>`
                    : `<span class="chart-sig-pill" style="background:rgba(239,68,68,0.1);color:#EF4444;border-color:rgba(239,68,68,0.3)">❌ EMA 역배열</span>`
                );
            }
        }

        // ── EMA 240 이탈 경고 배지 ─────────────────────────────────
        if (_chartSplitEnabled && swEma240 != null && lastClose != null && lastClose < swEma240) {
            const wBar = document.getElementById('chartSigBar');
            if (wBar) {
                const _isKR3 = currentMarket === 'KR';
                const _fmtW  = v => _isKR3 ? Math.round(v).toLocaleString()+'원' : '$'+v.toFixed(2);
                wBar.insertAdjacentHTML('beforeend',
                    `<span class="chart-sig-pill" style="background:rgba(239,68,68,0.15);color:#EF4444;border-color:rgba(239,68,68,0.4)">⚠️ EMA 240 이탈 ${_fmtW(swEma240)} — 손절 고려</span>`
                );
            }
        }

        // ── R:R 카드에 분할매수 섹션 주입 ──────────────────────────
        _appendSplitBuyToRR(data, coeff, warnings, bullishFVGs);
    }

    // R:R 카드 하단에 분할매수 섹션 추가
    function _appendSplitBuyToRR(data, coeff, warnings, bullishFVGs = []) {
        const rrEl = document.getElementById('rrAnalysis');
        if (!rrEl || !rrEl.innerHTML || !data) return;

        const { levels, stopPrice, swingHigh, swingLow, lastClose, fmtP, pctOf,
                equilibrium, isDiscount, isPremium,
                tqi = 0.5, er = 0.5, stTrend = 1, score = 50, dynScale = 0.8, tp1, tp2 } = data;
        const isKR = currentMarket === 'KR';
        const has5_6Warn = warnings.some(w => w.disable5_6);

        // 전체 진입 시 평균 단가 계산
        let avgNumerator = 0, totalWeight = 0;
        levels.forEach((lv, idx) => {
            if (idx < coeff.maxEntries) {
                avgNumerator += lv.price * lv.weight;
                totalWeight  += lv.weight;
            }
        });
        const avgPrice    = totalWeight > 0 ? avgNumerator / totalWeight : 0;
        const slLoss      = avgPrice > 0 ? ((stopPrice - avgPrice) / avgPrice * 100).toFixed(1) : '?';

        const rowsHtml = levels.map((lv, idx) => {
            const num = idx + 1;
            const active = num <= coeff.maxEntries && !(has5_6Warn && num >= 5);
            const colorStyle = active ? `color:${lv.color};` : 'color:var(--text3);';
            const inactiveTag = !active ? '<span class="split-rr-inactive">비활성</span>' : '';
            return `<div class="split-rr-row ${active ? '' : 'split-rr-row-dim'}">
                <span style="${colorStyle}font-weight:700">${lv.label}</span>
                <span style="${colorStyle}">${lv.weight}%</span>
                <span style="${colorStyle}font-variant-numeric:tabular-nums">${fmtP(lv.price)}</span>
                <span style="color:var(--text3)">${lv.fibLabel}</span>
                <span>${escHtml(lv.suffix.trim())}${inactiveTag}</span>
            </div>`;
        }).join('');

        const avgPnl = avgPrice > 0 ? ((lastClose - avgPrice) / avgPrice * 100) : 0;
        const avgPnlTxt = (avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(1) + '%';
        const avgPnlCls = avgPnl >= 0 ? 'color:#22c55e' : 'color:#ef4444';

        const warnHtml = warnings.map(w =>
            `<div class="split-rr-warn">${escHtml(w.text)}</div>`
        ).join('');

        const sectionHtml = `
        <div class="split-rr-section">
            <div class="split-rr-title">
                <span style="color:#06B6D4;font-weight:800">⬇ 6번 역피라미딩 분할 계획</span>
                <span class="split-rr-type-badge">${coeff.typeLabel}</span>
            </div>
            ${warnHtml}
            <div class="split-rr-header">
                <span>차수</span><span>비중</span><span>진입가</span><span>피보나치</span><span></span>
            </div>
            ${rowsHtml}
            <div class="split-rr-summary">
                <div class="split-rr-sum-row">
                    <span>전체 진입 시 평균 단가</span>
                    <strong style="font-variant-numeric:tabular-nums">${fmtP(avgPrice)}</strong>
                    <span style="${avgPnlCls};font-size:11px">${avgPnlTxt}</span>
                </div>
                <div class="split-rr-sum-row">
                    <span>손절선</span>
                    <strong style="color:#ef4444;font-variant-numeric:tabular-nums">${fmtP(stopPrice)}</strong>
                </div>
                <div class="split-rr-sum-row">
                    <span>손절 시 예상 손실 (평균 기준)</span>
                    <strong style="color:#ef4444">${slLoss}%</strong>
                </div>
            </div>
            ${equilibrium != null ? `
            <div class="sd-smc-summary">
                <div class="sd-smc-title">📐 SMC 분석</div>
                <div class="sd-smc-row">
                    <span>Zone</span>
                    <span style="color:${isDiscount ? '#22C55E' : '#EF4444'};font-weight:700">
                        ${isDiscount ? '💚 Discount (매수 적합)' : '🔴 Premium (고가 주의)'}
                    </span>
                </div>
                <div class="sd-smc-row">
                    <span>Equilibrium (50%)</span>
                    <span style="font-variant-numeric:tabular-nums">${fmtP(equilibrium)}</span>
                </div>
                ${bullishFVGs.length > 0 ? `
                <div class="sd-smc-row">
                    <span>상승 FVG</span>
                    <span style="color:#F59E0B;font-weight:700">💎 ${bullishFVGs.length}개 감지</span>
                </div>` : ''}
            </div>` : ''}
            ${tqi != null ? `
            <div class="sd-v2-section">
                <div class="sd-v2-title">Smart Dip v2 분석</div>
                <div class="sd-v2-row">
                    <span>TQI (추세 품질)</span>
                    <span style="color:${tqi > 0.6 ? '#22C55E' : tqi > 0.35 ? '#F59E0B' : '#EF4444'};font-weight:700">${(tqi*100).toFixed(0)}/100 · ${tqi > 0.6 ? '고품질' : tqi > 0.35 ? '보통' : '저품질'}</span>
                </div>
                <div class="sd-v2-row">
                    <span>ER (추세 효율)</span>
                    <span>${(er*100).toFixed(0)}% · ${er > 0.5 ? '강한 추세' : er > 0.25 ? '보통 추세' : '횡보'}</span>
                </div>
                <div class="sd-v2-row">
                    <span>SuperTrend</span>
                    <span style="color:${stTrend === 1 ? '#22C55E' : '#EF4444'}">${stTrend === 1 ? '▲ 상승 추세' : '▼ 하락 추세'}</span>
                </div>
                <div class="sd-v2-row">
                    <span>신호 점수</span>
                    <span style="color:${score >= 70 ? '#22C55E' : score >= 50 ? '#F59E0B' : '#EF4444'};font-weight:700">${score}/100</span>
                </div>
                <div class="sd-v2-row">
                    <span>동적 익절 스케일</span>
                    <span>×${dynScale.toFixed(2)}</span>
                </div>
                ${tp1 ? `<div class="sd-v2-row"><span>익절 TP1 (61.8%)</span><span style="color:#22C55E;font-variant-numeric:tabular-nums">${fmtP(tp1)}</span></div>` : ''}
                ${tp2 ? `<div class="sd-v2-row"><span>익절 TP2 (100%)</span><span style="color:#22C55E;font-variant-numeric:tabular-nums">${fmtP(tp2)}</span></div>` : ''}
            </div>` : ''}
            ${(() => {
                const _paSw = typeof _posActiveForTicker === 'function' ? _posActiveForTicker(currentSymbol) : null;
                if (!_paSw || _paSw.status !== 'holding' || !_paSw.entryPrice) return '';
                const _pEntry = _paSw.entryPrice;
                const _pStop  = _paSw.stopLoss;
                const _pRisk  = _pStop ? _pEntry - _pStop : 0;
                const _pRR    = _paSw.tp2 && _pRisk > 0 ? ((_paSw.tp2 - _pEntry) / _pRisk).toFixed(2) : null;
                const _holdMs = _paSw.entryDate ? Date.now() - new Date(_paSw.entryDate).getTime() : 0;
                const _holdD  = _holdMs > 0 ? Math.floor(_holdMs / 86400000) : 0;
                return `
            <div class="sd-v2-section">
                <div class="sd-v2-title">📋 스윙 매매 계획</div>
                <div class="sd-v2-row"><span>진입가</span><span style="font-variant-numeric:tabular-nums">${fmtP(_pEntry)}</span></div>
                ${_pStop ? `<div class="sd-v2-row"><span>손절 (EMA 240)</span><span style="color:#EF4444;font-variant-numeric:tabular-nums">${fmtP(_pStop)}</span></div>` : ''}
                ${_paSw.tp1 ? `<div class="sd-v2-row"><span>익절 1차 (30%)</span><span style="color:#22C55E;font-variant-numeric:tabular-nums">${fmtP(_paSw.tp1)}</span></div>` : ''}
                ${_paSw.tp2 ? `<div class="sd-v2-row"><span>익절 2차 (40%)</span><span style="color:#06B6D4;font-variant-numeric:tabular-nums">${fmtP(_paSw.tp2)}</span></div>` : ''}
                ${_paSw.tp3 ? `<div class="sd-v2-row"><span>익절 3차 (30%)</span><span style="color:#9D4EDD;font-variant-numeric:tabular-nums">${fmtP(_paSw.tp3)}</span></div>` : ''}
                ${_pRR ? `<div class="sd-v2-row"><span>R:R 비율</span><span style="font-weight:700">${_pRR}:1</span></div>` : ''}
                <div class="sd-v2-row"><span>보유 D+</span><span>${_holdD}일</span></div>
            </div>`;
            })()}
        </div>`;

        // 기존 R:R 카드 .card div 안에 주입 (끝에 append)
        const card = rrEl.querySelector('.rr-card');
        if (card) card.insertAdjacentHTML('beforeend', sectionHtml);
    }

    // ═══════════════════════════════════════════════════════════
    // 눌림목 감지 시스템 — 피보나치 38.2/50/61.8% + 반등 신호 포착
    // Kullamägi / Minervini SEPA / 분할매수 와 완전 독립
    // localStorage: stockai_chart_pullback_enabled
    // ═══════════════════════════════════════════════════════════
    let _chartPullbackLines   = [];
    let _chartPullbackMarkers = [];  // 반등 신호 마커 (캔들 시리즈 마커에 합산)
    let _chartPullbackEnabled = localStorage.getItem('stockai_chart_pullback_enabled') !== '0';

    // 버튼 UI 업데이트
    function _updatePullbackBtnUi() {
        const btn = document.getElementById('chartPullbackBtn');
        if (!btn) return;
        if (_chartPullbackEnabled) {
            btn.style.color = '#10B981';
            btn.style.background = 'rgba(16,185,129,.12)';
            btn.style.borderColor = 'rgba(16,185,129,.5)';
            btn.title = '눌림목 라인 끄기';
        } else {
            btn.style.color = 'var(--text3)';
            btn.style.background = 'transparent';
            btn.style.borderColor = 'var(--border)';
            btn.title = '눌림목 감지 + 피보나치 라인 켜기';
        }
    }

    function togglePullbackLayer() {
        _chartPullbackEnabled = !_chartPullbackEnabled;
        localStorage.setItem('stockai_chart_pullback_enabled', _chartPullbackEnabled ? '1' : '0');
        _updatePullbackBtnUi();
        if (_lastSigArgs) {
            try { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
            catch(e) {}
        }
    }

    function _clearPullbackLines() {
        _chartPullbackLines = _clearOwnLines(_chartPullbackLines);
    }

    // 타임프레임별 스윙 탐색 봉 수
    function _pullbackLookback() {
        switch (currentInterval) {
            case '5m':  return 100;
            case '15m': return 80;
            case '60m': return 60;
            default:    return 60;   // 1d, 1wk
        }
    }

    // 타임프레임별 예상 보유 시간 라벨
    function _pullbackHoldLabel() {
        switch (currentInterval) {
            case '5m':  return '수분~1시간 (5분봉)';
            case '15m': return '1~4시간 (15분봉)';
            case '60m': return '당일~2일 (60분봉)';
            default:    return '1~2주 (일봉)';
        }
    }

    // 스윙 저점(상승 출발점) ~ 고점 탐색
    function _pullbackSwingHL(highs, lows, closes, lookback) {
        const n = closes.length;
        if (n < 20) return null;
        const lb = Math.min(lookback, n);
        // 최근 lookback 봉에서 고점·저점 찾기
        let swHigh = -Infinity, swLow = Infinity;
        let hiIdx = -1, loIdx = -1;
        for (let i = n - lb; i < n; i++) {
            if (highs[i] != null && highs[i] > swHigh) { swHigh = highs[i]; hiIdx = i; }
            if (lows[i]  != null && lows[i]  < swLow)  { swLow  = lows[i];  loIdx = i; }
        }
        if (hiIdx < 0 || loIdx < 0) return null;
        const range = swHigh - swLow;
        if (range <= 0) return null;
        return { swHigh, swLow, range, hiIdx, loIdx };
    }

    // 조건 1: 상승 추세 확인 (20봉 +10% + EMA 정배열)
    function _pullbackCond1(closes, ema10, ema20, ema50, lastIdx) {
        const lookback20 = Math.max(0, lastIdx - 19);
        const base = closes[lookback20];
        const cur  = closes[lastIdx];
        if (!base || !cur) return false;
        const gain20 = (cur - base) / base * 100;
        const lastVal = arr => { for (let i = arr.length-1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
        const e10 = lastVal(ema10), e20 = lastVal(ema20), e50 = lastVal(ema50);
        if (!e10 || !e20 || !e50) return false;
        return gain20 >= 10 && e10 > e20 && e20 > e50;
    }

    // 조건 2: 일시적 조정 중 (-5% ~ -25%, 거래량 정상)
    function _pullbackCond2(closes, volumes, highs, lastIdx) {
        // 최근 고점 (lookback 내)
        const lb = Math.min(40, lastIdx);
        let recentHigh = -Infinity;
        for (let i = lastIdx - lb; i <= lastIdx; i++) {
            if (highs[i] != null && highs[i] > recentHigh) recentHigh = highs[i];
        }
        const cur = closes[lastIdx];
        if (!cur || recentHigh <= 0) return { pass: false };
        const drawdown = (cur - recentHigh) / recentHigh * 100; // 음수
        if (drawdown < -25 || drawdown > -5) return { pass: false, drawdown };

        // 거래량: 20일 평균 이하 — 분봉별 임계값 차별화
        //   5m 이하 → 0.75x   15m → 0.80x   30m → 0.85x   1h+ → 0.80x (기존)
        let volSum = 0, volCnt = 0;
        for (let i = Math.max(0, lastIdx - 19); i < lastIdx; i++) {
            if (volumes[i]) { volSum += volumes[i]; volCnt++; }
        }
        const avgVol = volCnt ? volSum / volCnt : 0;
        const rvol = avgVol > 0 ? (volumes[lastIdx] || 0) / avgVol : 1;
        const _pbIv     = typeof currentInterval !== 'undefined' ? (currentInterval || '') : '';
        const _pbVolMax = /^(1m|2m|5m)$/.test(_pbIv) ? 0.75 : _pbIv === '15m' ? 0.80 : _pbIv === '30m' ? 0.85 : 0.80;
        return { pass: rvol <= _pbVolMax, drawdown, rvol, recentHigh };
    }

    // 조건 3: RSI 정상 눌림 — 분봉별 밴드 차별화
    //   5m 이하 → 33~55   15m → 30~55   30m → 28~52   1h+ → 30~55 (기존)
    function _pullbackCond3(closes) {
        const rsi = calcRSI(closes, 14);
        const cur = (() => { for (let i = rsi.length-1; i >= 0; i--) if (rsi[i] != null) return rsi[i]; return null; })();
        if (cur == null) return { pass: false };
        const _pbIv     = typeof currentInterval !== 'undefined' ? (currentInterval || '') : '';
        const _pbRsiMin = /^(1m|2m|5m)$/.test(_pbIv) ? 33 : _pbIv === '30m' ? 28 : 30;
        const _pbRsiMax = _pbIv === '30m' ? 52 : 55;
        return { pass: cur >= _pbRsiMin && cur <= _pbRsiMax, rsi: cur, oversold: cur < _pbRsiMin };
    }

    // 동적 지지선 피보나치 일치 감지 (±0.5%)
    function _pullbackDynamicSupport(fibLevels, ema20val, ema50val) {
        const hits = [];
        const match = (price, label, color) => {
            if (!price) return;
            for (const fl of fibLevels) {
                const pct = Math.abs(price - fl.price) / fl.price * 100;
                if (pct <= 0.5) {
                    hits.push({ label, color, fibLabel: fl.label, price, fibPrice: fl.price, pct: pct.toFixed(2) });
                }
            }
        };
        match(ema20val, 'EMA 20', '#f97316');
        match(ema50val, 'EMA 50', '#eab308');
        return hits;
    }

    // 반등 신호 감지 (4조건)
    function _pullbackBounceSignals(q, ts) {
        const closes  = q.close  || [];
        const opens   = q.open   || [];
        const volumes = q.volume || [];
        const n = closes.length;
        if (n < 10) return { count: 0, signals: [] };

        const lastIdx = n - 1;
        const signals = [];

        // 1) 첫 양봉 (종가 > 직전 종가 AND 종가 > 시가)
        if (closes[lastIdx] != null && closes[lastIdx - 1] != null
            && closes[lastIdx] > closes[lastIdx - 1]
            && opens[lastIdx] != null && closes[lastIdx] > opens[lastIdx]) {
            signals.push('양봉');
        }

        // 2) RSI 반등 (최저점 후 3봉 연속 상승)
        const rsi = calcRSI(closes, 14);
        let rsiRebound = false;
        if (rsi.length >= 4) {
            const r1 = rsi[rsi.length-1], r2 = rsi[rsi.length-2], r3 = rsi[rsi.length-3], r4 = rsi[rsi.length-4];
            if (r1 != null && r2 != null && r3 != null && r4 != null
                && r1 > r2 && r2 > r3 && r3 < r4) rsiRebound = true;
        }
        if (rsiRebound) signals.push('RSI 반등');

        // 3) 거래량 증가 — 분봉별 임계값 (분봉은 거짓 surge 방지를 위해 더 높게)
        //   5m 이하 → 1.4x   15m → 1.3x   30m → 1.25x   1h+ → 1.3x (기존)
        if (n >= 6) {
            let vSum = 0;
            for (let i = lastIdx - 5; i < lastIdx; i++) { if (volumes[i]) vSum += volumes[i]; }
            const avg5 = vSum / 5;
            const _pbIv2  = typeof currentInterval !== 'undefined' ? (currentInterval || '') : '';
            const _pbSurge = /^(1m|2m|5m)$/.test(_pbIv2) ? 1.4 : _pbIv2 === '30m' ? 1.25 : 1.3;
            if (avg5 > 0 && (volumes[lastIdx] || 0) >= avg5 * _pbSurge) signals.push('거래량 급증');
        }

        // 4) VWAP 위 회복 (분봉만, 전역 lwVwap 시리즈 활용 — 근사값: 직전봉 이후 상승)
        if ((currentInterval === '5m' || currentInterval === '15m' || currentInterval === '60m')) {
            // VWAP 정확한 값 없을 경우 EMA20을 근사 대체
            const ema20 = calcEMA(closes, 20);
            const e20last = (() => { for (let i = ema20.length-1; i >= 0; i--) if (ema20[i] != null) return ema20[i]; return null; })();
            if (e20last && closes[lastIdx] != null && closes[lastIdx] > e20last
                && closes[lastIdx - 1] != null && closes[lastIdx - 1] <= e20last) {
                signals.push('VWAP/EMA20 위 회복');
            }
        }

        return { count: signals.count, signals, count: signals.length };
    }

    // 추세 종료 경고 감지
    function _pullbackTrendEndWarnings(q, fibs) {
        const closes  = q.close  || [];
        const volumes = q.volume || [];
        const n = closes.length;
        const warns = [];
        if (n < 10) return warns;

        const lastClose = (() => { for (let i = n-1; i >= 0; i--) if (closes[i] != null) return closes[i]; return null; })();
        const ema10 = calcEMA(closes, 10);
        const ema20 = calcEMA(closes, 20);
        const lastVal = arr => { for (let i = arr.length-1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
        const e10 = lastVal(ema10), e20 = lastVal(ema20);

        // 1) 61.8% 이탈 (가격이 골든존 아래)
        const golden = fibs.find(f => f.fibPct === 0.618);
        if (golden && lastClose != null && lastClose < golden.price) {
            warns.push({ code: 'golden_break', text: '⚠️ 추세 종료 가능성 — 61.8% 이탈, 눌림목 전략 비활성화', disableAll: true });
        }

        // 2) EMA10이 EMA20 아래 크로스
        if (e10 != null && e20 != null && e10 < e20) {
            // 직전봉에서 e10 > e20 이었는지 확인 (크로스 감지)
            const prev10 = ema10[ema10.length - 2];
            const prev20 = ema20[ema20.length - 2];
            if (prev10 != null && prev20 != null && prev10 >= prev20) {
                warns.push({ code: 'ema_cross', text: '⚠️ 단기 추세 전환 — EMA10↓EMA20 크로스, 진입 보류' });
            }
        }

        // 3) 거래량 급증 + 큰 음봉
        const lastIdx = n - 1;
        if (lastIdx >= 5) {
            let vSum = 0;
            for (let i = lastIdx - 5; i < lastIdx; i++) { if (volumes[i]) vSum += volumes[i]; }
            const avg5 = vSum / 5;
            const opens = q.open || [];
            const bigDown = closes[lastIdx] != null && opens[lastIdx] != null
                && (closes[lastIdx] - opens[lastIdx]) / opens[lastIdx] * 100 < -3;
            if (avg5 > 0 && (volumes[lastIdx] || 0) >= avg5 * 2.0 && bigDown) {
                warns.push({ code: 'panic_sell', text: '⚠️ 공황 매도 감지 — 거래량 급증 + 큰 음봉, 추가 하락 가능성' });
            }
        }

        return warns;
    }

    // ── 메인 레이어 렌더 ──────────────────────────────────────────
    function _renderPullbackLayer(q, ts) {
        _clearPullbackLines();
        _updatePullbackBtnUi();

        if (!q || !q.close || !q.close.length || !stockData) return;

        const closes  = q.close  || [];
        const highs   = q.high   || [];
        const lows    = q.low    || [];
        const volumes = q.volume || [];
        const n = closes.length;
        const lastIdx = (() => { for (let i = n-1; i >= 0; i--) if (closes[i] != null) return i; return -1; })();
        if (lastIdx < 20) return;

        const lastClose = closes[lastIdx];
        const isKR = currentMarket === 'KR';
        const fmtP = p => isKR ? Math.round(p).toLocaleString() + '원' : '$' + p.toFixed(2);

        // EMA 계산
        const ema10arr = calcEMA(closes, 10);
        const ema20arr = calcEMA(closes, 20);
        const ema50arr = calcEMA(closes, 50);
        const lastVal = arr => { for (let i = arr.length-1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
        const e10 = lastVal(ema10arr), e20 = lastVal(ema20arr), e50 = lastVal(ema50arr);

        // 3가지 조건 평가
        const cond1 = _pullbackCond1(closes, ema10arr, ema20arr, ema50arr, lastIdx);
        const cond2 = _pullbackCond2(closes, volumes, highs, lastIdx);
        const cond3 = _pullbackCond3(closes);

        const isPullback = cond1 && cond2.pass && cond3.pass;

        // 스윙 저점~고점 탐색 (눌림 여부와 관계없이 피보나치 계산)
        const lb = _pullbackLookback();
        const swing = _pullbackSwingHL(highs, lows, closes, lb);

        // 피보나치 레벨 계산
        const FIB_DEFS = [
            { fibPct: 0.382, label: '눌림 38.2%', lineStyle: 1, width: 1 },
            { fibPct: 0.500, label: '눌림 50%',   lineStyle: 1, width: 2 },
            { fibPct: 0.618, label: '눌림 61.8% ★골든존', lineStyle: 0, width: 2 },
        ];
        let fibs = [];
        if (swing) {
            fibs = FIB_DEFS.map(f => ({
                ...f,
                price: swing.swHigh - swing.range * f.fibPct,
            }));
        }

        // 추세 종료 경고
        const trendWarns = fibs.length ? _pullbackTrendEndWarnings(q, fibs) : [];
        const disableAll = trendWarns.some(w => w.disableAll);

        // 동적 지지 일치
        const dynSupport = fibs.length ? _pullbackDynamicSupport(fibs, e20, e50) : [];

        // 반등 신호
        const bounce = _pullbackBounceSignals(q, ts);

        // ── 분할매수 연동 안내 (두 버튼 동시 ON) ──────────────────
        const splitActive = _chartSplitEnabled;
        const bothActive  = _chartPullbackEnabled && splitActive;

        // ── 차트 라인 그리기 ────────────────────────────────────────
        if (_chartPullbackEnabled && lwCandleSeries && fibs.length) {
            const COLOR = disableAll ? 'rgba(148,163,184,0.4)' : '#10B981';
            const addPL = (price, color, style, width, title, priority = 5) => {
                if (!price || !isFinite(price) || price <= 0) return;
                try {
                    const axisLabelVisible = _claimPriceLabel(price, priority);
                    const pl = lwCandleSeries.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible, title });
                    _pushPriceLine(_chartPullbackLines, pl);
                } catch(e) {}
            };

            // ── 분할매수 동시 활성 시: 같은 피보 가격대 라인 중복 스킵 ─────
            let _splitPrices = [];
            if (bothActive) {
                try {
                    const _spAtr = (() => { const a = calcATR(q.high, q.low, q.close, 14); for (let i = a.length-1; i>=0; i--) if (a[i]!=null) return a[i]; return null; })();
                    const _spData = _spAtr ? _calcSplitBuyLevels(q, _spAtr) : null;
                    if (_spData) _splitPrices = _spData.levels.map(l => l.price);
                } catch(_) {}
            }

            // 피보나치 3단계 — 분할매수와 ±1.2% 이내 중복이면 스킵
            const _lp3 = (typeof _linePrefs === 'function') ? _linePrefs() : {};
            fibs.forEach(f => {
                if (bothActive && _splitPrices.some(sp => Math.abs(sp - f.price) / Math.max(f.price, 1) <= 0.012)) return;
                // Phase M: 38.2 / 50 는 토글 OFF 시 스킵 (기본 숨김), 61.8 골든존은 항상 표시
                if (f.fibPct === 0.382 && !_lp3.pull38) return;
                if (f.fibPct === 0.500 && !_lp3.pull50) return;
                const shortTitle = f.fibPct === 0.618 ? `★${fmtP(f.price)}`
                    : f.fibPct === 0.382 ? `38%${fmtP(f.price)}`
                    : `50%${fmtP(f.price)}`;
                addPL(f.price, disableAll ? 'rgba(148,163,184,0.4)' : COLOR, f.lineStyle, f.width, shortTitle);
            });

            // 추세 종료 위험선 (스윙 저점 아래 작은 버퍼)
            if (swing) {
                const atrArr = calcATR(highs, lows, closes, 14);
                const atr = lastVal(atrArr) || lastClose * 0.01;
                const dangerLine = swing.swLow - atr * 0.2;
                addPL(dangerLine, '#EF4444', 1, 2, `⚠️ 추세 종료 위험선 ${fmtP(dangerLine)} — 이탈 시 전략 폐기`);
            }

            // 분할매수 연동 안내 (sigBar에 표시)
            if (bothActive) {
                const bar = document.getElementById('chartSigBar');
                if (bar) {
                    bar.insertAdjacentHTML('beforeend',
                        `<span class="chart-sig-pill" style="background:rgba(16,185,129,.15);color:#10B981;border-color:rgba(16,185,129,.4)">✅ 눌림목+분할매수 연동 활성</span>`
                    );
                }
            }
        }

        // ── 시그널 배지 (sigBar) ──────────────────────────────────
        if (_chartPullbackEnabled) {
            const bar = document.getElementById('chartSigBar');
            if (bar) {
                if (isPullback && !disableAll) {
                    // 반등 신호 강도 배지
                    const bCnt = bounce.count;
                    if (bCnt >= 4) {
                        bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill sig-red">🟢🟢 최강 반등 신호</span>`);
                    } else if (bCnt >= 3) {
                        bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill sig-red">🟢 강한 반등 신호</span>`);
                    } else if (bCnt >= 2) {
                        bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill sig-neutral">🟡 반등 신호</span>`);
                    }
                    // 동적 지지 일치 배지
                    if (dynSupport.length >= 2) {
                        bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill" style="background:rgba(16,185,129,.15);color:#10B981;border-color:rgba(16,185,129,.4)">🟢 최강 진입 자리 — 피보+EMA+VWAP 동시</span>`);
                    } else if (dynSupport.length === 1) {
                        bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill" style="background:rgba(16,185,129,.12);color:#10B981;border-color:rgba(16,185,129,.35)">🟢 강한 눌림목 — 피보+${dynSupport[0].label} 일치</span>`);
                    }
                    bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill" style="background:rgba(16,185,129,.12);color:#10B981;border-color:rgba(16,185,129,.35)">📉 눌림목 구간</span>`);
                } else if (!isPullback) {
                    if (_chartPullbackEnabled) {
                        let reason = '추세 형성 대기';
                        if (!cond1)      reason = '상승 추세 미확인';
                        else if (cond3.oversold) reason = '⚠️ RSI 과매도 — 별도 전략 필요';
                        else if (!cond2.pass) reason = '조정 범위 벗어남';
                        bar.insertAdjacentHTML('beforeend',
                            `<span class="chart-sig-pill sig-neutral">⬜ 눌림목 아님 — ${reason}</span>`
                        );
                    }
                }
                // 추세 종료 경고
                trendWarns.forEach(w => {
                    bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill sig-neutral">${w.text}</span>`);
                });
            }
        }

        // ── R:R 카드에 눌림목 섹션 주입 ──────────────────────────
        _appendPullbackToRR({
            isPullback, cond1, cond2, cond3, fibs, dynSupport,
            bounce, trendWarns, disableAll, swing, fmtP, lastClose,
        });
    }

    // R:R 카드 하단에 눌림목 섹션 추가
    function _appendPullbackToRR(d) {
        const rrEl = document.getElementById('rrAnalysis');
        if (!rrEl || !rrEl.innerHTML) return;
        const card = rrEl.querySelector('.rr-card');
        if (!card) return;

        const { isPullback, cond1, cond2, cond3, fibs, dynSupport, bounce, trendWarns, disableAll, swing, fmtP, lastClose } = d;
        const isKR = currentMarket === 'KR';
        const pctTxt = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

        // 피보나치 라인 HTML
        const fibsHtml = fibs.length ? fibs.map(f => {
            const diff = lastClose && f.price ? ((lastClose - f.price) / f.price * 100) : null;
            const isGolden = f.fibPct === 0.618;
            return `<div class="pb-rr-fib-row ${isGolden ? 'pb-rr-golden' : ''}">
                <span style="${isGolden ? 'font-weight:800;color:#10B981' : 'color:var(--text2)'}">${f.label}</span>
                <strong style="font-variant-numeric:tabular-nums">${fmtP(f.price)}</strong>
                ${diff != null ? `<span style="color:${diff >= 0 ? '#22c55e' : '#ef4444'};font-size:11px">${pctTxt(diff)}</span>` : ''}
            </div>`;
        }).join('') : '<div style="color:var(--text3);font-size:12px">데이터 부족</div>';

        // 동적 지지 일치 HTML
        const dynHtml = dynSupport.length
            ? dynSupport.map(ds => `<div class="pb-rr-dyn">🟢 ${escHtml(ds.label)} ${fmtP(ds.price)} — 피보나치 ${ds.fibLabel}와 ±${ds.pct}% 일치</div>`).join('')
            : '<div style="color:var(--text3);font-size:12px">일치 없음</div>';

        // 반등 신호 강도 라벨
        const bCnt = bounce.count;
        const bounceLabel = bCnt >= 4 ? '🟢🟢 최강 (4/4)' : bCnt >= 3 ? '🟢 강함 (3/4)' : bCnt >= 2 ? '🟡 보통 (2/4)' : '⬜ 없음';

        // 추세 경고 HTML
        const warnHtml = trendWarns.map(w => `<div class="pb-rr-warn">${escHtml(w.text)}</div>`).join('');

        // 위험선 HTML
        const dangerHtml = swing ? `<div class="pb-rr-danger">⚠️ 추세 종료 위험선: ${fmtP(swing.swLow)} — 이탈 시 전략 폐기</div>` : '';

        // 현황 요약
        let statusHtml;
        if (isPullback && !disableAll) {
            statusHtml = `<div class="pb-rr-status pb-rr-status-ok">✅ 눌림목 구간 — 피보나치 진입 유효</div>`;
        } else if (trendWarns.some(w => w.disableAll)) {
            statusHtml = `<div class="pb-rr-status pb-rr-status-warn">⚠️ 추세 종료 가능성 — 눌림목 전략 비활성화</div>`;
        } else if (cond3.oversold) {
            statusHtml = `<div class="pb-rr-status pb-rr-status-warn">⚠️ RSI 과매도 — 별도 반등 전략 필요</div>`;
        } else {
            statusHtml = `<div class="pb-rr-status pb-rr-status-none">⬜ 눌림목 구간 아님 — 추세 형성 대기</div>`;
        }

        const holdLabel = _pullbackHoldLabel();
        const isLevETF = ['TQQQ','SOXL','SPXL','SQQQ','UPRO','SDOW','QLD','SSO'].includes((currentSymbol||'').toUpperCase());
        const levWarn = (isLevETF && (currentInterval === '60m' || currentInterval === '1d'))
            ? `<div class="pb-rr-warn">⚠️ 레버리지 ETF 보유 시간 주의 (Decay)</div>` : '';

        const sectionHtml = `
        <div class="pb-rr-section">
            <div class="pb-rr-title">
                <span style="color:#10B981;font-weight:800">📉 눌림목 분석</span>
                ${isPullback && !disableAll ? '<span class="pb-rr-active-badge">활성</span>' : ''}
            </div>
            ${warnHtml}
            ${statusHtml}
            <div class="pb-rr-grid">
                <div class="pb-rr-item">
                    <div class="pb-rr-item-label">조정 폭</div>
                    <div class="pb-rr-item-val">${cond2.drawdown != null ? pctTxt(cond2.drawdown) : '—'}</div>
                </div>
                <div class="pb-rr-item">
                    <div class="pb-rr-item-label">RSI</div>
                    <div class="pb-rr-item-val ${cond3.oversold ? 'pb-rr-red' : cond3.pass ? 'pb-rr-green' : ''}">${cond3.rsi != null ? cond3.rsi.toFixed(1) : '—'}</div>
                </div>
                <div class="pb-rr-item">
                    <div class="pb-rr-item-label">거래량</div>
                    <div class="pb-rr-item-val ${cond2.rvol != null && cond2.rvol <= 0.8 ? 'pb-rr-green' : ''}">${cond2.rvol != null ? cond2.rvol.toFixed(2)+'x' : '—'}</div>
                </div>
                <div class="pb-rr-item">
                    <div class="pb-rr-item-label">반등 신호</div>
                    <div class="pb-rr-item-val" style="font-size:11px">${bounceLabel}</div>
                </div>
            </div>
            <div class="pb-rr-sub-title">피보나치 되돌림</div>
            ${fibsHtml}
            <div class="pb-rr-sub-title" style="margin-top:8px">동적 지지 일치</div>
            ${dynHtml}
            ${dangerHtml}
            <div class="pb-rr-hold">📅 예상 보유 시간: ${holdLabel}</div>
            ${levWarn}
        </div>`;

        card.insertAdjacentHTML('beforeend', sectionHtml);
    }

    // ═══════════════════════════════════════════════════════════
    // 지지/저항선 자동 감지 시스템
    // 5봉 피벗 + 강도 평가(1~5★) + 돌파/이탈 감지
    // localStorage: stockai_chart_sr_enabled, stockai_chart_sr_mode
    // ═══════════════════════════════════════════════════════════
    let _chartSrLines   = [];
    let _chartSrEnabled = localStorage.getItem('stockai_chart_sr_enabled') !== '0';
    let _chartSrMode    = parseInt(localStorage.getItem('stockai_chart_sr_mode') || '3'); // 3=3★이상(기본) 5=5★만
    let _srLevels       = null; // 다른 레이어에서 참조 가능한 감지 결과 캐시 (SR 비활성 시에도 항상 계산)

    function _updateSrBtnUi() {
        const btn = document.getElementById('chartSrBtn');
        const lbl = document.getElementById('chartSrBtnTxt');
        if (!btn) return;
        if (!_chartSrEnabled) {
            btn.style.color = 'var(--text3)'; btn.style.background = 'transparent'; btn.style.borderColor = 'var(--border)';
            btn.title = '지지/저항선 ON';
            if (lbl) lbl.textContent = '지지저항';
        } else {
            const modeLabel = _chartSrMode === 5 ? '5★' : '3★';
            btn.style.color = '#F59E0B'; btn.style.background = 'rgba(245,158,11,.12)'; btn.style.borderColor = 'rgba(245,158,11,.4)';
            btn.title = `지지/저항 ON (${modeLabel}) — 클릭 시 OFF`;
            if (lbl) lbl.textContent = `지지저항 ${modeLabel}`;
        }
    }

    function toggleSrLayer() {
        _chartSrEnabled = !_chartSrEnabled;
        localStorage.setItem('stockai_chart_sr_enabled', _chartSrEnabled ? '1' : '0');
        _updateSrBtnUi();
        if (_lastSigArgs) { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
    }

    function toggleSrMode(mode) {
        if (!_chartSrEnabled) _chartSrEnabled = true;
        _chartSrMode = mode;
        localStorage.setItem('stockai_chart_sr_enabled', '1');
        localStorage.setItem('stockai_chart_sr_mode', String(_chartSrMode));
        _updateSrBtnUi();
        if (_lastSigArgs) { _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb); }
    }

    function _clearSrLines() {
        _chartSrLines = _clearOwnLines(_chartSrLines);
    }

    // 타임프레임별 감지 범위
    function _srLookback() {
        const map = { '5m': 200, '15m': 200, '60m': 200, '1d': 200, '1wk': 100, '1mo': 60 };
        return map[currentInterval] || 200;
    }

    // 5봉 피벗 감지 + 클러스터링 + 1~5★ 강도 평가
    function _srDetectLevels(q, ts) {
        const closes = q.close || [], highs = q.high || [], lows = q.low || [], volumes = q.volume || [];
        const n = closes.length;
        if (n < 15) return { resistances: [], supports: [] };

        // sessionStorage 캐시 (타임프레임 변경 시 자동 무효화)
        const lastTs = ts[ts.length - 1];
        const cacheKey = `stockai_sr_${currentSymbol}_${currentInterval}_${lastTs}`;
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch(_) {}

        const lb = _srLookback();
        const startIdx = Math.max(0, n - lb);
        const PIVOT = 5;

        // Step 1: 피벗 고점·저점 탐색
        const pivotHighs = [], pivotLows = [];
        for (let i = startIdx + PIVOT; i < n - PIVOT; i++) {
            const h = highs[i], l = lows[i];
            if (h == null || l == null) continue;
            let isH = true, isL = true;
            for (let k = 1; k <= PIVOT; k++) {
                if (isH && (highs[i-k]==null||highs[i+k]==null||highs[i-k]>=h||highs[i+k]>=h)) isH = false;
                if (isL && (lows[i-k]==null||lows[i+k]==null||lows[i-k]<=l||lows[i+k]<=l)) isL = false;
                if (!isH && !isL) break;
            }
            if (isH) pivotHighs.push({ price: h, idx: i });
            if (isL)  pivotLows.push({ price: l, idx: i });
        }

        // Step 2: 가까운 피벗 클러스터링 (±0.8% → 하나의 레벨로 병합)
        const clusterPivots = (pivots) => {
            pivots.sort((a, b) => a.price - b.price);
            const clusters = [];
            for (const p of pivots) {
                const last = clusters[clusters.length - 1];
                if (last && Math.abs(p.price - last.price) / last.price <= 0.008) {
                    const t = last._cnt + 1;
                    last.price = (last.price * last._cnt + p.price) / t;
                    last._cnt = t; last.indices.push(p.idx);
                } else {
                    clusters.push({ price: p.price, _cnt: 1, indices: [p.idx] });
                }
            }
            return clusters;
        };

        // 60봉 평균 거래량
        const avgVol60 = (() => {
            let s = 0, c = 0;
            for (let i = Math.max(0, n-60); i < n; i++) if (volumes[i] != null) { s += volumes[i]; c++; }
            return c > 0 ? s / c : 0;
        })();

        // Step 3: 강도 평가 (최대 5★)
        const scoreCluster = (cluster, type) => {
            const { price } = cluster;
            const TOL = price * 0.008;
            let stars = 0, touchCount = 0, lastTouchIdx = -1, volSum = 0, volCnt = 0;

            // 터치 횟수 — 봉의 고저가 범위가 가격 ±TOL과 겹치는 횟수
            for (let i = startIdx; i < n; i++) {
                const h = highs[i] || 0, l = lows[i] || 0;
                if (h > 0 && l > 0 && h >= price - TOL && l <= price + TOL) {
                    touchCount++; lastTouchIdx = i;
                    if (volumes[i] != null) { volSum += volumes[i]; volCnt++; }
                }
            }

            // 별점 ①: 터치 횟수
            if (touchCount >= 5) stars += 2; else if (touchCount >= 3) stars += 1;

            // 별점 ②: 터치 시 거래량 (평균 1.5배 이상)
            const touchAvgVol = volCnt > 0 ? volSum / volCnt : 0;
            if (avgVol60 > 0 && touchAvgVol >= avgVol60 * 1.5) stars += 1;

            // 별점 ③: 라운드 넘버 (심리적 가격대)
            const isRound = (p) => {
                const rounds = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 50000];
                return rounds.some(r => r > 0 && p >= r * 0.5 && Math.abs(p % r) / r <= 0.003);
            };
            if (isRound(price)) stars += 1;

            // 별점 ④: 신선도 (최근 30봉 이내 터치)
            if (lastTouchIdx >= n - 30) stars += 1;

            return { price, type, stars: Math.min(stars, 5), touchCount, lastTouchIdx };
        };

        const result = {
            resistances: clusterPivots(pivotHighs).map(c => scoreCluster(c, 'resistance')),
            supports:    clusterPivots(pivotLows).map(c => scoreCluster(c, 'support')),
        };

        // 결과 캐시 저장 (sessionStorage — 타임프레임 변경 시 자동 무효화)
        try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch(_) {}
        return result;
    }

    // 돌파/이탈 자동 감지 (거래량 동반 필수)
    function _srDetectBreakouts(levels, q) {
        const closes = q.close || [], volumes = q.volume || [];
        const n = closes.length;
        if (n < 3) return [];
        const lastClose = closes[n-1], prevClose = closes[n-2];
        if (lastClose == null || prevClose == null) return [];
        let avgVol = 0, cnt = 0;
        for (let i = Math.max(0, n-20); i < n-1; i++) if (volumes[i] != null) { avgVol += volumes[i]; cnt++; }
        avgVol = cnt > 0 ? avgVol / cnt : 0;
        const isHighVol = avgVol > 0 && (volumes[n-1] || 0) >= avgVol * 1.5;
        const events = [];
        for (const r of levels.resistances) {
            if (r.stars >= 3 && prevClose < r.price && lastClose > r.price * 1.003 && isHighVol)
                events.push({ type: 'breakout', level: r });
        }
        for (const s of levels.supports) {
            if (s.stars >= 3 && prevClose > s.price && lastClose < s.price * 0.997 && isHighVol)
                events.push({ type: 'breakdown', level: s });
        }
        return events;
    }

    // 메인 레이어 렌더
    function _renderSrLayer(q, ts) {
        // 5분봉 + SR OFF 상태인데 자동 활성화를 한 번도 안 한 경우 → 1회 자동 ON
        // 사용자 편의를 위해 5분봉에서는 지지/저항이 거의 필수이므로 처음 한 번만 자동 켜기.
        // 이후 사용자가 다시 OFF 하면 그 상태 그대로 유지 (stockai_sr_auto_5m_done 플래그로 보호).
        try {
            if (currentInterval === '5m'
                && localStorage.getItem('stockai_chart_sr_enabled') === '0'
                && !localStorage.getItem('stockai_sr_auto_5m_done')) {
                _chartSrEnabled = true;
                localStorage.setItem('stockai_chart_sr_enabled', '1');
                localStorage.setItem('stockai_sr_auto_5m_done', '1');
                if (typeof showToast === 'function') showToast('5분봉 지지/저항선이 자동 활성화되었습니다 📍');
            }
        } catch(_) {}
        _clearSrLines();
        _updateSrBtnUi();
        // SR 비활성 시에도 _srLevels는 항상 계산 — Smart Dip 등 다른 레이어에서 참조
        if (q?.close?.length) {
            try { _srLevels = _srDetectLevels(q, ts); } catch(_) { _srLevels = null; }
        }
        if (!_chartSrEnabled || !q?.close?.length || !lwCandleSeries) return;

        const lastClose = (() => { for (let i = q.close.length-1; i >= 0; i--) if (q.close[i] != null) return q.close[i]; return null; })();
        if (!lastClose) return;

        const isKR = currentMarket === 'KR';
        const fmtP  = p => isKR ? Math.round(p).toLocaleString() + '원' : '$' + p.toFixed(2);
        const starStr = n => '★'.repeat(Math.min(Math.max(n, 0), 5));

        const levels   = _srLevels || _srDetectLevels(q, ts); // 이미 계산된 캐시 재사용
        const breakouts = _srDetectBreakouts(levels, q);

        const minStars = _chartSrMode === 5 ? 5 : 3;
        const priceHi  = lastClose * 1.15;  // ±10% → ±15% 로 확장
        const priceLo  = lastClose * 0.85;

        // 돌파된 저항 (리테스트 → 지지 라벨 자동 변경)
        const brokenPrices = new Set(breakouts.filter(b => b.type === 'breakout').map(b => b.level.price));

        const srMaxLines = _isMobileView ? 2 : 3;  // 모바일도 최대 2개, 데스크탑 3개
        const visRes = levels.resistances
            .filter(r => r.price > lastClose * 1.001 && r.price <= priceHi && r.stars >= minStars)
            .sort((a, b) => a.price - b.price).slice(0, srMaxLines);

        const visSup = levels.supports
            .filter(s => s.price < lastClose * 0.999 && s.price >= priceLo && s.stars >= minStars)
            .sort((a, b) => b.price - a.price).slice(0, srMaxLines);

        // 차트 라인 생성 — lineStyle: 2(대시)로 일반 이동평균선과 구분
        const addSrLine = (price, color, width, label, priority, style) => {
            if (!price || !isFinite(price) || price <= 0) return;
            try {
                const axisLabelVisible = _claimPriceLabel(price, priority);
                const pl = lwCandleSeries.createPriceLine({ price, color, lineWidth: width, lineStyle: style ?? 2, axisLabelVisible, title: label });
                _pushPriceLine(_chartSrLines, pl);
            } catch(e) {}
        };

        visRes.forEach(r => {
            const isRetest = brokenPrices.has(r.price);
            // 저항: 강한(4★+) → 선명한 빨강 실선, 보통 → 연빨강 대시
            const color = isRetest ? '#60A5FA' : (r.stars >= 4 ? '#F87171' : '#FCA5A5');
            const width = r.stars >= 4 ? 2.5 : 2;
            const style = r.stars >= 4 ? 0 : 2;   // 4★+ 실선, 그 외 대시
            const typeLabel = isRetest ? '이전저항→지지' : '저항';
            addSrLine(r.price, color, width, `${typeLabel} ${starStr(r.stars)} ${fmtP(r.price)}`, r.stars >= 4 ? 4 : 6, style);
        });

        visSup.forEach(s => {
            // 지지: 강한(4★+) → 선명한 파랑 실선, 보통 → 연파랑 대시
            const color = s.stars >= 4 ? '#60A5FA' : '#93C5FD';
            const width = s.stars >= 4 ? 2.5 : 2;
            const style = s.stars >= 4 ? 0 : 2;
            addSrLine(s.price, color, width, `지지 ${starStr(s.stars)} ${fmtP(s.price)}`, s.stars >= 4 ? 4 : 6, style);
        });

        // ── 시그널 배지 ──────────────────────────────────────────
        const bar = document.getElementById('chartSigBar');
        if (bar) {
            // 돌파/이탈 배지
            breakouts.forEach(b => {
                if (b.type === 'breakout')
                    bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill sig-red">🟢 저항 돌파 ${starStr(b.level.stars)} ${fmtP(b.level.price)}</span>`);
                else
                    bar.insertAdjacentHTML('beforeend', `<span class="chart-sig-pill sig-blue">🔴 지지 이탈 ${starStr(b.level.stars)} ${fmtP(b.level.price)} — 하락 주의</span>`);
            });
            // 눌림목 연동 — 강한 지지가 현재가 근처에 있을 때
            if (_chartPullbackEnabled && visSup.some(s => s.stars >= 4)) {
                const best = visSup.filter(s => s.stars >= 4)[0];
                bar.insertAdjacentHTML('beforeend',
                    `<span class="chart-sig-pill" style="background:rgba(245,158,11,.15);color:#F59E0B;border-color:rgba(245,158,11,.4)">🟢🟢 눌림목+지지 ${starStr(best.stars)} 연동 — 최강 진입</span>`);
            }
        }

        // R:R 카드 섹션
        _appendSrToRR({ visRes, visSup, lastClose, fmtP, starStr });
    }

    // R:R 카드 하단에 지지/저항 섹션 추가
    function _appendSrToRR({ visRes, visSup, lastClose, fmtP, starStr }) {
        const rrEl = document.getElementById('rrAnalysis');
        if (!rrEl || !rrEl.innerHTML) return;
        const card = rrEl.querySelector('.rr-card');
        if (!card) return;

        const nearestRes = visRes[0], nearestSup = visSup[0];
        const pctFmt = t => { const v = (t - lastClose) / lastClose * 100; return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };

        const resHtml = nearestRes
            ? `<div class="sr-rr-item sr-rr-res">
                <small class="sr-rr-item-label">위 저항</small>
                <div class="sr-rr-stars">${starStr(nearestRes.stars)}</div>
                <strong>${fmtP(nearestRes.price)}</strong>
                <span class="sr-rr-pct sr-rr-up">${pctFmt(nearestRes.price)}</span>
               </div>`
            : `<div class="sr-rr-item"><small class="sr-rr-item-label">위 저항</small><span style="color:var(--text3);font-size:12px">±10% 내 없음</span></div>`;

        const supHtml = nearestSup
            ? `<div class="sr-rr-item sr-rr-sup">
                <small class="sr-rr-item-label">아래 지지</small>
                <div class="sr-rr-stars">${starStr(nearestSup.stars)}</div>
                <strong>${fmtP(nearestSup.price)}</strong>
                <span class="sr-rr-pct sr-rr-down">${pctFmt(nearestSup.price)}</span>
               </div>`
            : `<div class="sr-rr-item"><small class="sr-rr-item-label">아래 지지</small><span style="color:var(--text3);font-size:12px">±10% 내 없음</span></div>`;

        const modeLabel = _chartSrMode === 3 ? '3★+ 전체' : '5★ 기본';
        const sectionHtml = `
        <div class="sr-rr-section">
            <div class="sr-rr-title">
                <span style="color:#F59E0B;font-weight:800">📊 지지/저항 분석</span>
                <span class="sr-rr-badge">${modeLabel}</span>
            </div>
            <div class="sr-rr-grid">${resHtml}${supHtml}</div>
            ${(nearestRes || nearestSup) ? `<div class="sr-rr-summary-row">
                ${nearestRes ? `<span>저항까지 <strong class="sr-rr-up">${pctFmt(nearestRes.price)}</strong></span>` : ''}
                ${nearestSup ? `<span>지지까지 <strong class="sr-rr-down">${pctFmt(nearestSup.price)}</strong></span>` : ''}
            </div>` : ''}
        </div>`;

        card.insertAdjacentHTML('beforeend', sectionHtml);
    }

    // ═══════════════════════════════════════════════════════════
    // 툴바 드롭다운 — [분석 ▾] / [라인 ▾]
    // ═══════════════════════════════════════════════════════════
    function _ddOpenMenu(menu, btn) {
        if (!menu || !btn) return;
        // position:fixed to escape chart-toolbar overflow:auto clipping on all viewports
        const r = btn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top  = (r.bottom + 5) + 'px';
        menu.style.left = Math.min(r.left, window.innerWidth - 190) + 'px';
        menu.style.zIndex = '99999';
        menu.style.display = 'block';
    }

    function _toggleAnalysisDd(e) {
        e.stopPropagation();
        const isMobile = window.innerWidth <= 768
            || document.querySelector('.tv-chart-card.fullscreen') !== null;
        // 모바일(768px 이하) 또는 전체화면이면 바텀시트 사용
        if (isMobile) {
            _openChartBottomSheet('분석', 'analysisDdMenu');
            return;
        }
        const menu = document.getElementById('analysisDdMenu');
        const btn  = document.getElementById('analysisDdBtn');
        if (!menu) return;
        const open = menu.style.display !== 'none';
        _closeAllDds();
        if (!open) { _ddOpenMenu(menu, btn); btn.dataset.open = '1'; }
    }

    function _toggleLineDd(e) {
        e.stopPropagation();
        const isMobile = window.innerWidth <= 768
            || document.querySelector('.tv-chart-card.fullscreen') !== null;
        // 모바일(768px 이하) 또는 전체화면이면 바텀시트 사용
        if (isMobile) {
            _openChartBottomSheet('라인', 'lineDdMenu');
            return;
        }
        const menu = document.getElementById('lineDdMenu');
        const btn  = document.getElementById('lineDdBtn');
        if (!menu) return;
        const open = menu.style.display !== 'none';
        _closeAllDds();
        if (!open) { _ddOpenMenu(menu, btn); btn.dataset.open = '1'; }
    }

    // ── [⋯ 더보기] 드롭다운 (익절/백테스트/소리/알림내역/AI라인) ──
    function _moreDdSyncLabels() {
        // 익절 단계 라벨
        const tpEl = document.getElementById('moreTpState');
        if (tpEl) {
            const lv = parseInt(localStorage.getItem('stockai_chart_tp_level') || '1', 10);
            tpEl.textContent = lv >= 3 ? '전체' : lv === 2 ? '1~2차' : '1차';
        }
        // 소리 on/off 라벨
        const sndEl = document.getElementById('moreSoundState');
        if (sndEl) {
            const on = localStorage.getItem('stockai_chart_sound') !== '0';
            sndEl.textContent = on ? '켜짐' : '꺼짐';
            sndEl.classList.toggle('more-dd-state-on', on);
        }
    }
    function _toggleMoreDd(e) {
        if (e) e.stopPropagation();
        const isMobile = window.innerWidth <= 768
            || document.querySelector('.tv-chart-card.fullscreen') !== null;
        if (isMobile) { _moreDdSyncLabels(); _openChartBottomSheet('더보기', 'moreDdMenu'); return; }
        const menu = document.getElementById('moreDdMenu');
        const btn  = document.getElementById('moreDdBtn');
        if (!menu) return;
        const open = menu.style.display !== 'none';
        _closeAllDds();
        if (!open) { _moreDdSyncLabels(); _ddOpenMenu(menu, btn); btn.dataset.open = '1'; }
    }

    // ── 차트 모바일 바텀시트 ─────────────────────────────────────
    let _bsSnapshot = null;   // 열 때 상태 스냅샷 (취소 시 복원)
    let _bsMenuId   = null;   // 현재 시트가 미러링 중인 드롭다운 메뉴 id

    // onclick 문자열에서 시트 닫기 호출 제거 (확인 버튼으로만 닫힘)
    function _bsStripClose(oc) {
        return (oc || '')
            .replace(/;?\s*_closeChartBottomSheet\(\)\s*;?/g, '')
            .replace(/;?\s*_cancelChartBottomSheet\(\)\s*;?/g, '');
    }

    // 바텀시트 body 렌더 — 항목 토글 후에도 재호출되어 체크 상태 반영
    function _bsRenderBody() {
        const bodyEl = document.getElementById('chartBottomSheetBody');
        const menu   = document.getElementById(_bsMenuId);
        if (!bodyEl || !menu) return;
        bodyEl.innerHTML = '';

        Array.from(menu.children).forEach(child => {
            // ── 하위 그룹 div (chart-dd-sub) — 부모 표시 중일 때만 ──
            if (child.classList.contains('chart-dd-sub')) {
                if (child.style.display === 'none') return;
                Array.from(child.children).forEach(subItem => {
                    const clone = subItem.cloneNode(true);
                    // 중복 id 제거 (원본 메뉴와 충돌 방지)
                    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
                    clone.removeAttribute('id');
                    clone.removeAttribute('style');
                    clone.style.cssText = [
                        'display:flex','align-items:center','gap:10px',
                        'padding:11px 20px 11px 48px','font-size:13px',
                        'color:var(--text2)','border-bottom:1px solid var(--border)',
                        'cursor:pointer','background:rgba(0,0,0,0.06)',
                        'position:relative','width:100%','box-sizing:border-box',
                    ].join(';');
                    // 세로 연결선
                    const line = document.createElement('div');
                    line.style.cssText = 'position:absolute;left:32px;top:0;bottom:0;width:2px;background:var(--border);';
                    clone.insertBefore(line, clone.firstChild);
                    const oc = _bsStripClose(subItem.getAttribute('onclick'));
                    if (oc) clone.setAttribute('onclick', oc + ';_bsRenderBody();');
                    bodyEl.appendChild(clone);
                });
                return;
            }
            // ── 일반 항목 (chart-dd-item / button) ──
            if (child.classList.contains('chart-dd-item') || child.tagName === 'BUTTON') {
                const clone = child.cloneNode(true);
                clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
                clone.removeAttribute('id');
                clone.removeAttribute('style');
                clone.style.cssText = [
                    'display:flex','align-items:center','gap:10px',
                    'padding:14px 20px','font-size:14px',
                    'color:var(--text1)','border-bottom:1px solid var(--border)',
                    'cursor:pointer','width:100%','box-sizing:border-box',
                    'background:var(--bg2)',
                ].join(';');
                const oc = _bsStripClose(child.getAttribute('onclick'));
                if (oc) clone.setAttribute('onclick', oc + ';_bsRenderBody();');
                bodyEl.appendChild(clone);
            }
        });
    }

    function _openChartBottomSheet(title, menuId) {
        const sheet   = document.getElementById('chartBottomSheet');
        const content = document.getElementById('chartBottomSheetContent');
        const titleEl = document.getElementById('chartBottomSheetTitle');
        const menu    = document.getElementById(menuId);
        if (!sheet || !menu) return;

        // 전체화면 stacking context 회피 — body 최상위로 이동
        if (sheet.parentElement !== document.body) {
            document.body.appendChild(sheet);
        }

        _bsMenuId = menuId;

        // 현재 상태 스냅샷 저장 (취소 시 복원)
        _bsSnapshot = {
            vars: {
                kull:     _chartKullamagiEnabled,
                sepa:     _chartSepaEnabled,
                smartDip: _chartSmartDipEnabled,
                split:    _chartSplitEnabled,
                pullback: _chartPullbackEnabled,
                sr:       _chartSrEnabled,
                srMode:   _chartSrMode,
            },
            ls: {},
        };
        [
            'stockai_chart_kull','stockai_chart_sepa','stockai_chart_smartdip_enabled',
            'stockai_chart_split_enabled','stockai_chart_pullback_enabled',
            'stockai_chart_sr_enabled','stockai_chart_sr_mode',
            'stockai_sd_show_1_2','stockai_sd_show_3_4','stockai_sd_show_5_6',
            'stockai_split_show_1_2','stockai_split_show_3_4','stockai_split_show_5_6',
        ].forEach(k => { _bsSnapshot.ls[k] = localStorage.getItem(k); });

        titleEl.textContent = title;
        _bsRenderBody();

        // 바텀시트 열기
        sheet.style.display = 'flex';
        sheet.style.alignItems = 'flex-end';
        // iOS Safari rAF 즉시 실행 버그 방지 → setTimeout으로 다음 프레임 보장
        setTimeout(() => { content.style.transform = 'translateY(0)'; }, 20);
    }

    function _closeChartBottomSheet() {
        const sheet   = document.getElementById('chartBottomSheet');
        const content = document.getElementById('chartBottomSheetContent');
        if (!sheet) return;
        content.style.transform = 'translateY(100%)';
        setTimeout(() => { sheet.style.display = 'none'; }, 300);
    }

    // 확인 — 현재 상태 확정 (스냅샷 폐기) 후 닫기
    function _confirmChartBottomSheet() {
        _bsSnapshot = null;
        _closeChartBottomSheet();
        if (_lastSigArgs) {
            try {
                _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb);
            } catch(e) {}
        }
        _updateDdStates();
    }

    // 취소 — 열 때 스냅샷으로 변수/localStorage 복원 후 닫기
    function _cancelChartBottomSheet() {
        if (_bsSnapshot) {
            const v = _bsSnapshot.vars;
            _chartKullamagiEnabled = v.kull;
            _chartSepaEnabled      = v.sepa;
            _chartSmartDipEnabled  = v.smartDip;
            _chartSplitEnabled     = v.split;
            _chartPullbackEnabled  = v.pullback;
            _chartSrEnabled        = v.sr;
            _chartSrMode           = v.srMode;
            Object.entries(_bsSnapshot.ls).forEach(([k, val]) => {
                if (val === null) localStorage.removeItem(k);
                else              localStorage.setItem(k, val);
            });
            _bsSnapshot = null;
        }
        _closeChartBottomSheet();
        if (_lastSigArgs) {
            try {
                _layerDirty = true; renderChartLiveSignals(_lastSigArgs.candleData, _lastSigArgs.ts, _lastSigArgs.q, _lastSigArgs.bb);
            } catch(e) {}
        }
        _updateDdStates();
    }

    function _closeAllDds(e) {
        const am = document.getElementById('analysisDdMenu');
        const lm = document.getElementById('lineDdMenu');
        const mm = document.getElementById('moreDdMenu');
        const ab = document.getElementById('analysisDdBtn');
        const lb = document.getElementById('lineDdBtn');
        const mb = document.getElementById('moreDdBtn');
        if (am) am.style.display = 'none';
        if (lm) lm.style.display = 'none';
        if (mm) mm.style.display = 'none';
        if (ab) delete ab.dataset.open;
        if (lb) delete lb.dataset.open;
        if (mb) delete mb.dataset.open;
        // 그리기 메뉴: 클릭이 메뉴 또는 cxtDraw 버튼 바깥이면 닫기
        const dm = document.getElementById('drawMenu');
        if (dm && dm.style.display !== 'none') {
            const btn = document.getElementById('cxtDraw');
            if (e && (dm.contains(e.target) || btn?.contains(e.target))) return;
            dm.style.display = 'none';
            btn?.classList.remove('active');
            if (typeof drawTool !== 'undefined' && drawTool !== 'none') setDrawTool('none');
        }
    }

    function _setDdCheck(id, isChecked) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('checked', isChecked);
    }

    function _updateDdStates() {
        // ── [분석 ▾] — Kullamägi / SEPA / Smart Dip ─────────────
        const kullOn = typeof _chartKullamagiEnabled !== 'undefined' && _chartKullamagiEnabled;
        const sepaOn = typeof _chartSepaEnabled      !== 'undefined' && _chartSepaEnabled;
        const sdOn   = typeof _chartSmartDipEnabled  !== 'undefined' && _chartSmartDipEnabled;

        _setDdCheck('ddKullamagiCheck', kullOn);
        _setDdCheck('ddSepaCheck',      sepaOn);
        _setDdCheck('ddSmartDipCheck',  sdOn);

        // SD 서브메뉴 표시/숨김 + 하위 그룹 체크
        const elSdSub = document.getElementById('sdSubMenu');
        if (elSdSub) elSdSub.style.display = sdOn ? 'block' : 'none';
        _setDdCheck('ddSd12Check', localStorage.getItem('stockai_sd_show_1_2') !== '0');
        _setDdCheck('ddSd34Check', localStorage.getItem('stockai_sd_show_3_4') !== '0');
        _setDdCheck('ddSd56Check', localStorage.getItem('stockai_sd_show_5_6') !== '0');

        // ── 분석 버튼 색상 (하나라도 ON이면 활성) ────────────────
        const analysisBtn = document.getElementById('analysisDdBtn');
        if (analysisBtn) {
            const anyOn = kullOn || sepaOn || sdOn;
            const activeColor = sdOn ? '#F59E0B' : sepaOn ? '#3B82F6' : '#9D4EDD';
            analysisBtn.style.color      = anyOn ? activeColor : 'var(--text3)';
            analysisBtn.style.background = anyOn ? `rgba(${sdOn?'245,158,11':sepaOn?'59,130,246':'157,78,221'},.12)` : 'transparent';
            analysisBtn.style.borderColor = anyOn ? `rgba(${sdOn?'245,158,11':sepaOn?'59,130,246':'157,78,221'},.5)` : 'var(--border)';
        }

        // ── [라인 ▾] — 분할매수 / 눌림목 / 지지저항 ─────────────
        const splitOn = typeof _chartSplitEnabled    !== 'undefined' && _chartSplitEnabled;
        const pbOn    = typeof _chartPullbackEnabled !== 'undefined' && _chartPullbackEnabled;
        const srOn    = typeof _chartSrEnabled       !== 'undefined' && _chartSrEnabled;

        _setDdCheck('ddSplitCheck',    splitOn);
        _setDdCheck('ddPullbackCheck', pbOn);
        _setDdCheck('ddSrCheck',       srOn);

        // 분할매수 하위 그룹 체크 상태 + 서브메뉴 표시
        const splitSub = document.getElementById('splitSubMenu');
        if (splitSub) splitSub.style.display = splitOn ? 'block' : 'none';
        _setDdCheck('ddSplit12Check', localStorage.getItem('stockai_split_show_1_2') !== '0');
        _setDdCheck('ddSplit34Check', localStorage.getItem('stockai_split_show_3_4') !== '0');
        _setDdCheck('ddSplit56Check', localStorage.getItem('stockai_split_show_5_6') !== '0');

        // 수정 3: Smart Dip ON 시 분할매수 버튼 흐리게 + 안내 툴팁
        const splitBtn = document.getElementById('ddSplitCheck')?.closest('.chart-dd-item');
        if (splitBtn) {
            if (sdOn) {
                splitBtn.style.opacity = '0.4';
                splitBtn.title = 'Smart Dip 활성 시 자동 비활성';
            } else {
                splitBtn.style.opacity = '';
                splitBtn.title = '';
            }
        }

        // 지지저항 서브메뉴 표시/숨김 + 모드 체크 상태
        const srSub = document.getElementById('srSubMenu');
        if (srSub) srSub.style.display = srOn ? 'block' : 'none';
        const srMode = typeof _chartSrMode !== 'undefined' ? _chartSrMode : 3;
        _setDdCheck('ddSr3Check', srMode === 3);
        _setDdCheck('ddSr5Check', srMode === 5);

        const lineBtn = document.getElementById('lineDdBtn');
        if (lineBtn) {
            const anyOn = splitOn || pbOn || srOn;
            lineBtn.style.color      = anyOn ? 'var(--text1)' : 'var(--text3)';
            lineBtn.style.background = anyOn ? 'var(--bg2)'   : 'transparent';
            lineBtn.style.borderColor = 'var(--border)';
        }
    }

    // 수정 4: 페이지 로드 시 Smart Dip과 분할매수 동시 ON이면 Smart Dip 우선 적용
    function _initLayerState() {
        const sdOn    = localStorage.getItem('stockai_chart_smartdip_enabled') === '1';
        const splitOn = localStorage.getItem('stockai_chart_split_enabled') !== '0';
        if (sdOn && splitOn) {
            _chartSplitEnabled = false;
            localStorage.setItem('stockai_chart_split_enabled', '0');
        }
    }
    _initLayerState();
    _updateDdStates();

    // 외부 클릭 시 드롭다운 닫기
    document.addEventListener('click', _closeAllDds);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeAllDds(); });

    function clearAllDrawings() {
        drawObjects = [];
        drawState = null;
        drawPreview = null;
        redrawCanvas();
        updateDrawBadge();
    }

    function updateDrawBadge() {
        const badge = document.getElementById('drawCountBadge');
        if (badge) badge.textContent = drawObjects.length;
    }

    // 좌표 변환: 캔버스 픽셀 → (time, price)
    function canvasToChart(x, y) {
        if (!lwChart) return null;
        const timeScale = lwChart.timeScale();
        const priceScale = lwCandleSeries;
        if (!priceScale) return null;

        const time = timeScale.coordinateToTime(x);
        const logic = timeScale.coordinateToLogical(x);
        // price 변환은 series 기반
        const coordPrice = priceScale.coordinateToPrice(y);
        return { time, logic, price: coordPrice, x, y };
    }

    // 좌표 변환: (time, price) → 캔버스 픽셀
    function chartToCanvas(time, price) {
        if (!lwChart || !lwCandleSeries) return null;
        const x = lwChart.timeScale().timeToCoordinate(time);
        const y = lwCandleSeries.priceToCoordinate(price);
        if (x === null || y === null) return null;
        return { x, y };
    }

    function getCanvasXY(e) {
        const canvas = document.getElementById('drawCanvas');
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    // 피보나치 되돌림 레벨
    const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

    // ── AI 추세선 hit-test ──
    // 클릭 좌표(cx, cy)가 tl 선과 HIT_THRESHOLD px 이내인지 반환
    function hitTestAiTrendline(canvas, tl, cx, cy) {
        const HIT_THRESHOLD = 9;
        const x1 = (tl.point1.x / 1000) * canvas.width;
        const y1 = (tl.point1.y / 1000) * canvas.height;
        const dx01 = (tl.point2.x - tl.point1.x) / 1000 * canvas.width;
        const dy01 = (tl.point2.y - tl.point1.y) / 1000 * canvas.height;
        if (Math.abs(dx01) < 0.5) return false;
        const slope = dy01 / dx01;
        const xEnd = canvas.width;
        const yEnd = slope * (xEnd - x1) + y1;
        // 선분 (x1,y1)→(xEnd,yEnd)까지의 거리
        const segDx = xEnd - x1, segDy = yEnd - y1;
        const lenSq = segDx * segDx + segDy * segDy;
        if (lenSq < 1) return false;
        // 클릭 점의 선 위 t (0~1 내에 있어야 선분 범위)
        const t = Math.max(0, Math.min(1, ((cx - x1) * segDx + (cy - y1) * segDy) / lenSq));
        const nearX = x1 + t * segDx, nearY = y1 + t * segDy;
        const dist = Math.sqrt((cx - nearX) ** 2 + (cy - nearY) ** 2);
        return dist <= HIT_THRESHOLD;
    }

    // ── AI 추세선 삭제 버튼 표시/숨김 ──
    function _showAiTrendDeleteBtn(canvasEl, cx, cy) {
        const btn = document.getElementById('aiTrendDeleteBtn');
        if (!btn) return;
        const wrap = canvasEl.parentElement;
        const wRect = wrap.getBoundingClientRect();
        const cRect = canvasEl.getBoundingClientRect();
        const relX = cx + (cRect.left - wRect.left);
        const relY = cy + (cRect.top - wRect.top);
        btn.style.left = Math.min(relX + 8, wRect.width - 120) + 'px';
        btn.style.top  = Math.max(relY - 32, 4) + 'px';
        btn.classList.add('show');
    }
    function _hideAiTrendDeleteBtn() {
        const btn = document.getElementById('aiTrendDeleteBtn');
        if (btn) btn.classList.remove('show');
        selectedAiTrendlineIdx = -1;
    }

    // ── 선택된 AI 추세선 삭제 ──
    function deleteSelectedAiTrendline() {
        // [Bug-fix] 인덱스를 _hide 전에 캡처 (rapid click 레이스 방지)
        const idx = selectedAiTrendlineIdx;
        if (idx < 0 || idx >= lwAiCanvasTrendlines.length) {
            _hideAiTrendDeleteBtn(); return;
        }
        lwAiCanvasTrendlines.splice(idx, 1);
        _hideAiTrendDeleteBtn();
        redrawCanvas();
        // lwAiLastData 동기화 및 저장
        // [Fix-E] .data null 체크 추가
        if (lwAiLastData && lwAiLastData.data) {
            lwAiLastData.data.trendlines = [...lwAiCanvasTrendlines];
            if (currentSymbol) {
                _aiLsSave(currentSymbol, lwAiLastData.data);
                fetch('/api/ai-analysis/' + encodeURIComponent(currentSymbol), {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(lwAiLastData.data),
                }).catch(() => {});
            }
        }
    }

    // ── AI 추세선 canvas Ray 드로잉 ──
    // tl: { point1: {x,y}, point2: {x,y} }  — 1000×1000 그리드 기준
    function drawAiTrendlineOnCanvas(ctx, canvas, tl, isSelected) {
        const x1 = (tl.point1.x / 1000) * canvas.width;
        const y1 = (tl.point1.y / 1000) * canvas.height;
        const x2 = (tl.point2.x / 1000) * canvas.width;
        const y2 = (tl.point2.y / 1000) * canvas.height;
        const dx = x2 - x1;
        if (Math.abs(dx) < 0.5) return; // 수직선 스킵
        const slope = (y2 - y1) / dx;
        const xEnd = canvas.width;
        const yEnd = slope * (xEnd - x1) + y1;
        ctx.save();
        if (isSelected) {
            // 선택 상태: 밝은 노란+글로우 효과
            ctx.shadowColor = '#FACC15';
            ctx.shadowBlur = 8;
            ctx.strokeStyle = '#fff176';
            ctx.lineWidth = 3;
        } else {
            ctx.strokeStyle = '#FACC15';
            ctx.lineWidth = 2;
        }
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(xEnd, yEnd);
        ctx.stroke();
        // 시작점 원형 마커
        ctx.beginPath();
        ctx.arc(x1, y1, isSelected ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#fff176' : '#FACC15';
        ctx.fill();
        ctx.restore();
    }

    function redrawCanvas() {
        const canvas = document.getElementById('drawCanvas');
        if (!canvas) return;
        const wrap = document.getElementById('tvChartWrap');
        // [Fix-D] wrap 또는 유효한 크기가 없으면 조기 종료 (null crash 방지)
        if (!wrap || !wrap.clientWidth || !wrap.clientHeight) return;
        canvas.width = wrap.clientWidth;
        canvas.height = wrap.clientHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const isLight = document.documentElement.getAttribute('data-theme') === 'light';

        // 기존 드로잉 오브젝트 그리기
        drawObjects.forEach(obj => drawObject(ctx, obj, canvas, isLight));

        // AI 추세선 (canvas Ray, 1000×1000 좌표계)
        if (lwAiCanvasTrendlines.length) {
            lwAiCanvasTrendlines.forEach((tl, i) => drawAiTrendlineOnCanvas(ctx, canvas, tl, i === selectedAiTrendlineIdx));
        }

        // 클라이언트 스윙 추세선 (time+price → 실좌표 변환)
        if (lwClientTrendlines.length) {
            lwClientTrendlines.forEach(tl => {
                const p1 = chartToCanvas(tl.time1, tl.price1);
                const p2 = chartToCanvas(tl.time2, tl.price2);
                if (!p1 || !p2) return;
                const dx = p2.x - p1.x;
                if (Math.abs(dx) < 0.5) return;
                const slope = (p2.y - p1.y) / dx;
                const xEnd = canvas.width;
                const yEnd = p1.y + slope * (xEnd - p1.x);
                ctx.save();
                ctx.strokeStyle = tl.color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([8, 4]);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(xEnd, yEnd);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = '600 10px Pretendard, sans-serif';
                ctx.fillStyle = tl.color;
                ctx.fillText(tl.label, Math.min(p1.x + 6, canvas.width - 60), p1.y - 4);
                ctx.restore();
            });
        }

        // 미리보기 그리기
        if (drawState && drawPreview) {
            drawPreviewObj(ctx, canvas, isLight);
        }
    }

    function drawObject(ctx, obj, canvas, isLight) {
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = obj.width;
        ctx.setLineDash([]);

        if (obj.type === 'line') {
            const p1 = chartToCanvas(obj.points[0].time, obj.points[0].price);
            const p2 = chartToCanvas(obj.points[1].time, obj.points[1].price);
            if (!p1 || !p2) return;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        } else if (obj.type === 'hline') {
            const y = lwCandleSeries?.priceToCoordinate(obj.points[0].price);
            if (y === null || y === undefined) return;
            ctx.setLineDash([6, 3]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
            // 가격 레이블
            ctx.setLineDash([]);
            const label = currentMarket === 'KR' ? Math.round(obj.points[0].price).toLocaleString() : obj.points[0].price.toFixed(2);
            ctx.font = '600 10px Pretendard, sans-serif';
            ctx.fillStyle = obj.color;
            const tw = ctx.measureText(label).width;
            ctx.fillRect(canvas.width - tw - 10, y - 8, tw + 8, 16);
            ctx.fillStyle = isLight ? '#fff' : '#000';
            ctx.fillText(label, canvas.width - tw - 6, y + 4);
        } else if (obj.type === 'ray') {
            const p1 = chartToCanvas(obj.points[0].time, obj.points[0].price);
            const p2 = chartToCanvas(obj.points[1].time, obj.points[1].price);
            if (!p1 || !p2) return;
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len === 0) return;
            const ext = 3000;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p1.x + dx / len * ext, p1.y + dy / len * ext);
            ctx.stroke();
            // 시작점 원
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = obj.color;
            ctx.fill();
        } else if (obj.type === 'rect') {
            const p1 = chartToCanvas(obj.points[0].time, obj.points[0].price);
            const p2 = chartToCanvas(obj.points[1].time, obj.points[1].price);
            if (!p1 || !p2) return;
            ctx.fillStyle = obj.color + '15';
            ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        } else if (obj.type === 'fib') {
            const p1 = chartToCanvas(obj.points[0].time, obj.points[0].price);
            const p2 = chartToCanvas(obj.points[1].time, obj.points[1].price);
            if (!p1 || !p2) return;
            const high = obj.points[0].price;
            const low = obj.points[1].price;
            const range = high - low;
            ctx.font = '600 10px Pretendard, sans-serif';
            FIB_LEVELS.forEach(level => {
                const price = high - range * level;
                const y = lwCandleSeries?.priceToCoordinate(price);
                if (y === null || y === undefined) return;
                ctx.strokeStyle = obj.color;
                ctx.globalAlpha = level === 0 || level === 1 ? 0.8 : 0.5;
                ctx.setLineDash(level === 0.5 ? [4, 4] : []);
                ctx.lineWidth = obj.width;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
                // 레이블
                const pLabel = currentMarket === 'KR' ? Math.round(price).toLocaleString() : price.toFixed(2);
                ctx.globalAlpha = 1;
                ctx.setLineDash([]);
                ctx.fillStyle = obj.color;
                ctx.fillText(`${(level * 100).toFixed(1)}%  ${pLabel}`, 8, y - 4);
            });
            ctx.globalAlpha = 1;
            // 배경 영역
            const yTop = lwCandleSeries?.priceToCoordinate(high);
            const yBot = lwCandleSeries?.priceToCoordinate(low);
            if (yTop != null && yBot != null) {
                ctx.fillStyle = obj.color + '08';
                ctx.fillRect(0, yTop, canvas.width, yBot - yTop);
            }
        } else if (obj.type === 'vline') {
            const vx = lwChart?.timeScale().timeToCoordinate(obj.points[0].time);
            if (vx === null || vx === undefined) return;
            ctx.setLineDash([6, 3]);
            ctx.beginPath(); ctx.moveTo(vx, 0); ctx.lineTo(vx, canvas.height); ctx.stroke();
            ctx.setLineDash([]);
        } else if (obj.type === 'cross') {
            const cx2 = lwChart?.timeScale().timeToCoordinate(obj.points[0].time);
            const cy2 = lwCandleSeries?.priceToCoordinate(obj.points[0].price);
            if (cx2 == null || cy2 == null) return;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(0, cy2); ctx.lineTo(canvas.width, cy2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx2, 0); ctx.lineTo(cx2, canvas.height); ctx.stroke();
            ctx.setLineDash([]);
        } else if (obj.type === 'ellipse') {
            const ep1 = chartToCanvas(obj.points[0].time, obj.points[0].price);
            const ep2 = chartToCanvas(obj.points[1].time, obj.points[1].price);
            if (!ep1 || !ep2) return;
            const ecx = (ep1.x + ep2.x) / 2, ecy = (ep1.y + ep2.y) / 2;
            const erx = Math.abs(ep2.x - ep1.x) / 2, ery = Math.abs(ep2.y - ep1.y) / 2;
            if (erx < 1 || ery < 1) return;
            ctx.fillStyle = obj.color + '18';
            ctx.beginPath(); ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (obj.type === 'angle') {
            const p1 = chartToCanvas(obj.points[0].time, obj.points[0].price);
            const p2 = chartToCanvas(obj.points[1].time, obj.points[1].price);
            if (!p1 || !p2) return;

            // 1) 메인 선 (point1 → point2)
            ctx.strokeStyle = obj.color;
            ctx.lineWidth = obj.width;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();

            // 2) 수평 기준선 (점선, p1에서 p2 방향으로 연장)
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const refDir = dx >= 0 ? 1 : -1;
            const refLen = Math.max(80, Math.abs(dx) + 30);
            ctx.strokeStyle = obj.color + '88';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p1.x + refLen * refDir, p1.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // 3) 각도 계산 (화면 픽셀 기준, 화면 y축은 반전이므로 -dy)
            const angleRad = Math.atan2(-dy, dx * refDir);  // 기준선이 좌측이면 부호 보정
            const angleDeg = Math.abs(angleRad * 180 / Math.PI);
            const isUp = -dy >= 0;  // 위쪽으로 향함 (상승 추세)

            // 4) 호(arc) — p1 중심, 반경 동적 (선 길이 1/3, max 50)
            const lineLen = Math.sqrt(dx * dx + dy * dy);
            const arcR = Math.min(50, Math.max(28, lineLen / 3));
            ctx.strokeStyle = obj.color;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            // canvas arc 의 각도: 0 = 우측 양의 x, +각도 = 시계방향
            // refDir 가 1이면 시작 0, 종료 -angleRad (CCW 그리기로 위로); -1이면 시작 PI, 종료 PI+angleRad
            if (refDir > 0) {
                ctx.arc(p1.x, p1.y, arcR, 0, isUp ? -angleRad : -angleRad, !isUp);
            } else {
                ctx.arc(p1.x, p1.y, arcR, Math.PI, isUp ? Math.PI + angleRad : Math.PI + angleRad, isUp);
            }
            ctx.stroke();

            // 5) 각도 라벨 ("32.5°") — 호의 중간 각도 위치 + 약간 바깥쪽
            const midAng = refDir > 0
                ? (isUp ? -angleRad / 2 : -angleRad / 2)
                : (isUp ? Math.PI + angleRad / 2 : Math.PI + angleRad / 2);
            const labelDist = arcR + 22;
            const labelX = p1.x + Math.cos(midAng) * labelDist;
            const labelY = p1.y + Math.sin(midAng) * labelDist;
            const text = `${angleDeg.toFixed(1)}°`;
            ctx.font = 'bold 12px Pretendard, ui-sans-serif, system-ui, sans-serif';
            const tw = ctx.measureText(text).width;
            const padX = 6, padY = 4;
            const boxW = tw + padX * 2;
            const boxH = 12 + padY * 2;
            // 배경 박스
            ctx.fillStyle = isLight ? 'rgba(255,255,255,0.95)' : 'rgba(17,22,32,0.95)';
            ctx.strokeStyle = obj.color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.rect(labelX - boxW / 2, labelY - boxH / 2, boxW, boxH);
            ctx.fill();
            ctx.stroke();
            // 텍스트
            ctx.fillStyle = obj.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, labelX, labelY);
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        }
    }

    function drawPreviewObj(ctx, canvas, isLight) {
        const s = drawState;
        const p = drawPreview;
        ctx.strokeStyle = drawColor + 'aa';
        ctx.lineWidth = drawWidth;
        ctx.setLineDash([4, 4]);

        if (s.tool === 'line' || s.tool === 'ray' || s.tool === 'angle') {
            ctx.beginPath();
            ctx.moveTo(s.startX, s.startY);
            if (s.tool === 'ray') {
                const dx = p.x - s.startX, dy = p.y - s.startY;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                ctx.lineTo(s.startX + dx / len * 3000, s.startY + dy / len * 3000);
            } else {
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            // angle 프리뷰 — 현재 각도 미리 표시
            if (s.tool === 'angle') {
                const dx = p.x - s.startX, dy = p.y - s.startY;
                const angDeg = Math.abs(Math.atan2(-dy, Math.abs(dx)) * 180 / Math.PI);
                ctx.setLineDash([]);
                ctx.fillStyle = drawColor;
                ctx.font = 'bold 11px Pretendard, sans-serif';
                ctx.fillText(`${angDeg.toFixed(1)}°`, p.x + 8, p.y - 8);
                ctx.setLineDash([4, 4]);
            }
        } else if (s.tool === 'hline') {
            ctx.beginPath();
            ctx.moveTo(0, p.y);
            ctx.lineTo(canvas.width, p.y);
            ctx.stroke();
        } else if (s.tool === 'vline') {
            ctx.beginPath();
            ctx.moveTo(p.x, 0);
            ctx.lineTo(p.x, canvas.height);
            ctx.stroke();
        } else if (s.tool === 'cross') {
            ctx.beginPath();
            ctx.moveTo(0, s.startY); ctx.lineTo(canvas.width, s.startY); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(s.startX, 0); ctx.lineTo(s.startX, canvas.height); ctx.stroke();
        } else if (s.tool === 'rect') {
            ctx.strokeRect(s.startX, s.startY, p.x - s.startX, p.y - s.startY);
        } else if (s.tool === 'ellipse') {
            const ecx = (s.startX + p.x) / 2, ecy = (s.startY + p.y) / 2;
            const erx = Math.abs(p.x - s.startX) / 2 || 1, ery = Math.abs(p.y - s.startY) / 2 || 1;
            ctx.beginPath(); ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2); ctx.stroke();
        } else if (s.tool === 'fib') {
            ctx.beginPath();
            ctx.moveTo(s.startX, s.startY);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    // 캔버스 이벤트 핸들러
    (function initDrawCanvas() {
        const canvas = document.getElementById('drawCanvas');
        if (!canvas) return;

        canvas.addEventListener('mousedown', function(e) {
            // drawTool 비활성 상태 → AI 추세선 hit-test
            if (drawTool === 'none' && lwAiCanvasTrendlines.length) {
                const { x, y } = getCanvasXY(e);
                let hit = -1;
                for (let i = 0; i < lwAiCanvasTrendlines.length; i++) {
                    if (hitTestAiTrendline(canvas, lwAiCanvasTrendlines[i], x, y)) { hit = i; break; }
                }
                if (hit >= 0) {
                    selectedAiTrendlineIdx = hit;
                    redrawCanvas();
                    _showAiTrendDeleteBtn(canvas, x, y);
                    e.stopPropagation();
                    return;
                } else {
                    _hideAiTrendDeleteBtn();
                    redrawCanvas();
                }
            }
            if (drawTool === 'none' || !lwChart) return;
            const { x, y } = getCanvasXY(e);
            const chart = canvasToChart(x, y);
            if (!chart) return;

            if (drawTool === 'hline') {
                // 수평선 — 클릭 한 번으로 완성
                drawObjects.push({ type: 'hline', points: [{ time: chart.time, price: chart.price }], color: drawColor, width: drawWidth });
                redrawCanvas(); updateDrawBadge(); return;
            }
            if (drawTool === 'vline') {
                // 수직선 — 클릭 한 번으로 완성
                drawObjects.push({ type: 'vline', points: [{ time: chart.time, price: chart.price }], color: drawColor, width: drawWidth });
                redrawCanvas(); updateDrawBadge(); return;
            }
            if (drawTool === 'cross') {
                // 크로스 — 클릭 한 번으로 완성
                drawObjects.push({ type: 'cross', points: [{ time: chart.time, price: chart.price }], color: drawColor, width: drawWidth });
                redrawCanvas(); updateDrawBadge(); return;
            }

            // 나머지 도구는 시작점 설정
            drawState = {
                tool: drawTool,
                startX: x,
                startY: y,
                startTime: chart.time,
                startPrice: chart.price,
            };
        });

        // [Fix-D] requestAnimationFrame 스로틀링 — mousemove마다 redraw 방지
        let _rafPending = false;
        canvas.addEventListener('mousemove', function(e) {
            if (!drawState) return;
            const { x, y } = getCanvasXY(e);
            drawPreview = { x, y };
            if (!_rafPending) {
                _rafPending = true;
                requestAnimationFrame(() => { redrawCanvas(); _rafPending = false; });
            }
        });

        canvas.addEventListener('mouseup', function(e) {
            if (!drawState || drawTool === 'none') return;
            const { x, y } = getCanvasXY(e);
            const chart = canvasToChart(x, y);
            if (!chart) { drawState = null; drawPreview = null; return; }

            const s = drawState;
            drawObjects.push({
                type: s.tool,
                points: [
                    { time: s.startTime, price: s.startPrice },
                    { time: chart.time, price: chart.price },
                ],
                color: drawColor,
                width: drawWidth,
            });
            drawState = null;
            drawPreview = null;
            redrawCanvas();
            updateDrawBadge();
        });

        // 차트 스크롤/줌 시 캔버스 다시 그리기
        const observer = new MutationObserver(() => redrawCanvas());
        observer.observe(canvas.parentElement, { childList: true, subtree: true });
    })();

    // 차트 timeScale 변경 시 드로잉 갱신
    function hookDrawRedraw() {
        if (!lwChart) return;
        lwChart.timeScale().subscribeVisibleTimeRangeChange(() => redrawCanvas());
        lwChart.subscribeCrosshairMove(() => {
            if (drawObjects.length > 0 || drawState) redrawCanvas();
        });
    }

    // Ctrl+Z 단축키 → 통합 keydown 핸들러로 이동 (하단 참고)




    // ========================================