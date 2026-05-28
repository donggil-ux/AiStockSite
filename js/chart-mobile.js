// js/chart-mobile.js — 차트 모바일 UX (Phase M / M2)
// M:  가격 라인 라벨 가시성 토글 (line sheet)
// M2: 캔들 마커 텍스트 제거 + 탭 시 bottom sheet 상세

function _linePrefs() {
    return {
        sr:     localStorage.getItem('stockai_line_sr')     === '1',
        bounce: localStorage.getItem('stockai_line_bounce') === '1',
        pull38: localStorage.getItem('stockai_line_pull38') === '1',
        pull50: localStorage.getItem('stockai_line_pull50') === '1',
    };
}

function toggleLineGroup(group) {
    const key = `stockai_line_${group}`;
    const cur = localStorage.getItem(key) === '1';
    localStorage.setItem(key, cur ? '0' : '1');
    _updateLineSheetUI();
    // _triggerSigRebuild 은 chart-sync.js 에 정의된 헬퍼
    if (typeof _triggerSigRebuild === 'function') _triggerSigRebuild();
}

function openLineSheet() {
    _updateLineSheetUI();
    const el = document.getElementById('lineSheet');
    if (el) { el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); }
    const bg = document.getElementById('lineSheetBg');
    if (bg) bg.style.display = 'block';
}

function closeLineSheet() {
    const el = document.getElementById('lineSheet');
    if (el) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }
    const bg = document.getElementById('lineSheetBg');
    if (bg) bg.style.display = 'none';
}

function _updateLineSheetUI() {
    const p = _linePrefs();
    const setChk = (id, v) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('checked', v);
        el.setAttribute('aria-checked', String(v));
    };
    setChk('lsChkSr',     p.sr);
    setChk('lsChkBounce', p.bounce);
    setChk('lsChkPull38', p.pull38);
    setChk('lsChkPull50', p.pull50);
}

// ── M2: 마커 탭 → 상세 bottom sheet ──────────────────────────────

function openMarkerSheet(time, data) {
    const el = document.getElementById('markerSheet');
    const bg = document.getElementById('markerSheetBg');
    if (!el) return;

    // 시간 포맷 (Unix seconds → 로컬 날짜+시각)
    const dt = new Date(Number(time) * 1000);
    const timeStr = dt.toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const isBuy = data.isBuy;
    const dirIcon = isBuy ? '🔴' : '🔵';
    const dirCls  = isBuy ? 'msh-buy' : 'msh-sell';
    const label   = data.label || (isBuy ? '매수 시그널' : '매도 시그널');

    // 등급 섹션 (등급 데이터 없으면 숨김)
    const hasGrade = !!(data.grade);
    const gradeSec = hasGrade ? `
        <div class="msh-grade-row">
            <span class="msh-grade-badge ${data.grade === 'S' ? 'msh-grade-s' : data.grade === 'A' ? 'msh-grade-a' : 'msh-grade-b'}">${data.grade}급</span>
            <span class="msh-stat">승률 <strong>${data.winRate ?? '—'}%</strong></span>
            <span class="msh-stat">점수 <strong>${data.score ?? '—'}/11</strong></span>
        </div>
        <div class="msh-rec">${data.recommendation || ''}</div>` : '';

    const factorHtml = (data.factors && data.factors.length)
        ? `<div class="msh-factors">${data.factors.map(f => `<div class="msh-factor">${f}</div>`).join('')}</div>`
        : '';

    el.innerHTML = `
        <div class="msh-handle"></div>
        <div class="msh-header">
            <span class="msh-icon ${dirCls}">${dirIcon}</span>
            <div class="msh-title-wrap">
                <div class="msh-title">${label}</div>
                <div class="msh-time">${timeStr}</div>
            </div>
            <button class="msh-close" onclick="closeMarkerSheet()" aria-label="닫기">✕</button>
        </div>
        ${gradeSec}
        ${factorHtml}
        <button class="msh-done" onclick="closeMarkerSheet()">확인</button>
    `;

    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    if (bg) bg.style.display = 'block';
}

function closeMarkerSheet() {
    const el = document.getElementById('markerSheet');
    if (el) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }
    const bg = document.getElementById('markerSheetBg');
    if (bg) bg.style.display = 'none';
}

// ── M6: ⚙ 종합 설정 시트 ──────────────────────────────────────

function openM6Sheet() {
    _m6UpdateUI();
    const el = document.getElementById('m6Sheet');
    if (el) { el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); }
    const bg = document.getElementById('m6SheetBg');
    if (bg) bg.style.display = 'block';
}

function closeM6Sheet() {
    const el = document.getElementById('m6Sheet');
    if (el) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }
    const bg = document.getElementById('m6SheetBg');
    if (bg) bg.style.display = 'none';
}

function _m6UpdateUI() {
    const setChk = (id, v) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('checked', !!v);
        el.setAttribute('aria-checked', String(!!v));
    };

    // 인디케이터 상태 (_indGetConfig 는 app.js에서 window 전역 노출)
    try {
        const ind = (typeof _indGetConfig === 'function') ? _indGetConfig() : {};
        setChk('m6ChkEma', ind.ema?.enabled !== false);
        setChk('m6ChkBb',  ind.bb?.enabled  !== false);
    } catch(_) {}

    // 분석 레이어 localStorage 키
    setChk('m6ChkKl',   localStorage.getItem('stockai_chart_kull')              !== '0');
    setChk('m6ChkSd',   localStorage.getItem('stockai_chart_smartdip_enabled')  === '1');
    setChk('m6ChkSepa', localStorage.getItem('stockai_chart_sepa')              !== '0');

    // 가격 라인 (M1 _linePrefs 재사용)
    try {
        const p = (typeof _linePrefs === 'function') ? _linePrefs() : {};
        setChk('m6ChkSr',     p.sr);
        setChk('m6ChkBounce', p.bounce);
        setChk('m6ChkPull38', p.pull38);
        setChk('m6ChkPull50', p.pull50);
    } catch(_) {}
}

// ── M5+M6: 모바일 차트 제스처 (개선판) ─────────────────────────
// M5: 더블탭(줌↔핏 토글), 길게 누르기(OHLC)
// M6: 핀치 줌 햅틱+뱃지, 두 손가락 탭(뷰 리셋), 스와이프 속도 기반 개선
(function _initM5MobileGestures() {
    'use strict';

    let _m5Hooked        = false;
    let _lastTapTime     = 0;
    let _longPressTimer  = null;
    let _longActive      = false;
    let _sx = 0, _sy = 0, _cx = 0, _cy = 0;
    let _touchStartTime  = 0;

    // 핀치 상태
    let _pinchActive     = false;
    let _pinchStartDist  = 0;
    let _pinchHapticDone = false;
    let _pinchTwoTapTime = 0;   // 두 손가락 탭 감지용

    // 더블탭 상태: 매 탭마다 줌인↔핏 토글
    let _dblFitMode      = false;

    const LONG_MS   = 900;   // 길게 누르기 임계 (ms)
    const DBL_MS    = 280;   // 더블탭 허용 간격 (ms)
    const MOVE_LIM  = 12;    // 이동 취소 임계 (px)
    const PINCH_LIM = 0.06;  // 핀치 비율 변화 임계 (6%)

    /* ── 플로팅 뱃지 ── */
    function _m5ShowBadge(text, dur) {
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap) return;
        wrap.querySelectorAll('.m6-badge').forEach(el => el.remove());
        const b = document.createElement('div');
        b.className = 'm6-badge';
        b.textContent = text;
        wrap.appendChild(b);
        setTimeout(() => b.remove(), dur || 700);
    }

    /* ── 하위 호환: _m5ZoomFb 별칭 ── */
    function _m5ZoomFb(icon) { _m5ShowBadge(icon || '🔍'); }

    /* ── OHLC 표시 ── */
    function _m5ShowOhlc(clientX, clientY) {
        if (!window.lwChart) return;
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
        try {
            const ts     = window.lwChart.timeScale();
            const logIdx = ts.coordinateToLogical(x);
            if (logIdx == null) return;
            const tsArr = window._lastSigArgs?.ts || [];
            if (!tsArr.length) return;
            const idx  = Math.max(0, Math.min(tsArr.length - 1, Math.round(logIdx)));
            const time = tsArr[idx];
            if (time == null) return;
            if (typeof _onCrosshairMoveOhlc === 'function') {
                _onCrosshairMoveOhlc({ point: { x, y }, time });
            }
            const tip = document.getElementById('chartOhlcTooltip');
            if (tip) tip.classList.add('mobile-show');
        } catch(_) {}
    }

    function _m5HideOhlc() {
        const tip = document.getElementById('chartOhlcTooltip');
        if (tip) tip.classList.remove('mobile-show');
    }

    /* ── 핀치 시작 거리 계산 ── */
    function _pinchDist(touches) {
        return Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );
    }

    /* ── 이벤트 훅 ── */
    function _attach() {
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap || _m5Hooked) return;
        _m5Hooked = true;

        /* ── touchstart ── */
        wrap.addEventListener('touchstart', e => {
            // ── 멀티터치 (2개 손가락) ──────────────────────────────
            if (e.touches.length === 2) {
                clearTimeout(_longPressTimer);
                _longActive = false;
                _pinchActive     = true;
                _pinchHapticDone = false;
                _pinchStartDist  = _pinchDist(e.touches);
                _pinchTwoTapTime = Date.now();
                return;
            }
            // 3+ 터치 → 무시
            if (e.touches.length > 2) return;

            // ── 단일 터치 ──────────────────────────────────────────
            const t = e.touches[0];
            _sx = _cx = t.clientX;
            _sy = _cy = t.clientY;
            _touchStartTime = Date.now();

            // 더블탭 감지
            const now = Date.now();
            if ((now - _lastTapTime) < DBL_MS) {
                _lastTapTime = 0;
                clearTimeout(_longPressTimer);
                if (_dblFitMode) {
                    // 핏 올 (차트 전체 보기)
                    if (window.lwChart) window.lwChart.timeScale().fitContent();
                    _m5ShowBadge('📐 전체 보기');
                    if (navigator.vibrate) navigator.vibrate([8, 8]);
                } else {
                    // 줌인
                    if (typeof _cnbZoom === 'function') _cnbZoom(0.72);
                    _m5ShowBadge('🔍 확대');
                    if (navigator.vibrate) navigator.vibrate([10]);
                }
                _dblFitMode = !_dblFitMode;
                return;
            }
            _lastTapTime = now;

            // 길게 누르기 타이머
            clearTimeout(_longPressTimer);
            _longActive = false;
            _longPressTimer = setTimeout(() => {
                _longActive = true;
                if (navigator.vibrate) navigator.vibrate(30);
                _m5ShowOhlc(_cx, _cy);
            }, LONG_MS);
        }, { passive: true });

        /* ── touchmove ── */
        wrap.addEventListener('touchmove', e => {
            // 핀치 진행 중
            if (e.touches.length === 2 && _pinchActive) {
                const dist  = _pinchDist(e.touches);
                const ratio = _pinchStartDist > 0 ? dist / _pinchStartDist : 1;
                // 임계 넘으면 햅틱 + 뱃지 (1회)
                if (!_pinchHapticDone && Math.abs(ratio - 1) > PINCH_LIM) {
                    _pinchHapticDone = true;
                    if (navigator.vibrate) navigator.vibrate(8);
                    _m5ShowBadge(ratio > 1 ? '🔍 확대' : '🔍 축소', 600);
                }
                return;
            }
            if (e.touches.length !== 1) return;

            const t = e.touches[0];
            _cx = t.clientX;
            _cy = t.clientY;
            const dx = Math.abs(_cx - _sx), dy = Math.abs(_cy - _sy);
            if (dx > MOVE_LIM || dy > MOVE_LIM) {
                clearTimeout(_longPressTimer);
                if (_longActive) { _m5HideOhlc(); _longActive = false; }
            } else if (_longActive) {
                _m5ShowOhlc(_cx, _cy);
            }
        }, { passive: true });

        /* ── touchend ── */
        wrap.addEventListener('touchend', e => {
            // 두 손가락 탭 감지: 핀치 거의 안 했는데 빠르게 손 뗀 경우 → 뷰 리셋
            if (_pinchActive && e.touches.length < 2) {
                _pinchActive = false;
                const elapsed   = Date.now() - _pinchTwoTapTime;
                const dist      = _pinchStartDist > 0
                    ? Math.abs(_pinchDist(e.changedTouches.length > 1
                        ? e.changedTouches : e.touches) - _pinchStartDist)
                    : 0;
                // 300ms 이내, 이동 30px 미만 → 두 손가락 탭 = 뷰 리셋
                if (elapsed < 300 && dist < 30) {
                    if (window.lwChart) window.lwChart.timeScale().fitContent();
                    _m5ShowBadge('📐 전체 보기');
                    if (navigator.vibrate) navigator.vibrate([8, 8]);
                    _dblFitMode = false; // 리셋 후 다음 더블탭은 줌인부터
                }
                return;
            }

            clearTimeout(_longPressTimer);
            if (_longActive) {
                setTimeout(_m5HideOhlc, 1800);
                _longActive = false;
            }
        }, { passive: true });

        /* ── touchcancel ── */
        wrap.addEventListener('touchcancel', () => {
            clearTimeout(_longPressTimer);
            _m5HideOhlc();
            _longActive = false;
            _pinchActive = false;
        }, { passive: true });
    }

    // 차트 렌더 후 다시 연결 가능하도록 전역 노출
    window._m5Reattach = function() { _m5Hooked = false; _attach(); };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _attach);
    } else {
        _attach();
    }
})();
