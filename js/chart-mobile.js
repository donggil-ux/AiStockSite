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

// ── M5: 모바일 차트 제스처 ──────────────────────────────────────
// - 더블탭: 줌인 1 step (_cnbZoom 0.72)
// - 길게 누르기 (1초+): OHLC tooltip
// - 핀치 줌: LightweightCharts 기본 지원 (별도 구현 없음)
// - 좌우 스와이프: M4(app.js)에서 처리
(function _initM5MobileGestures() {
    'use strict';

    let _m5Hooked       = false;
    let _lastTapTime    = 0;
    let _longPressTimer = null;
    let _longActive     = false;
    let _sx = 0, _sy = 0, _cx = 0, _cy = 0;

    const LONG_MS  = 1000;  // 길게 누르기 임계
    const DBL_MS   = 300;   // 더블탭 간격
    const MOVE_LIM = 10;    // 이동 취소 임계 (px)

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
            // 기존 OHLC tooltip 내용 채우기 (chart-multi.js)
            if (typeof _onCrosshairMoveOhlc === 'function') {
                _onCrosshairMoveOhlc({ point: { x, y }, time });
            }
            // mobile-show 클래스로 CSS !important 오버라이드
            const tip = document.getElementById('chartOhlcTooltip');
            if (tip) tip.classList.add('mobile-show');
        } catch(_) {}
    }

    function _m5HideOhlc() {
        const tip = document.getElementById('chartOhlcTooltip');
        if (tip) tip.classList.remove('mobile-show');
    }

    /* ── 더블탭 줌 피드백 이모지 ── */
    function _m5ZoomFb() {
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap) return;
        wrap.querySelectorAll('.m5-zoom-fb').forEach(el => el.remove());
        const fb = document.createElement('div');
        fb.className = 'm5-zoom-fb';
        fb.textContent = '🔍';
        wrap.appendChild(fb);
        setTimeout(() => fb.remove(), 650);
    }

    /* ── 이벤트 훅 ── */
    function _attach() {
        const wrap = document.getElementById('tvChartWrap');
        if (!wrap || _m5Hooked) return;
        _m5Hooked = true;

        wrap.addEventListener('touchstart', e => {
            if (e.touches.length !== 1) {
                // 멀티터치 → 타이머·상태 초기화
                clearTimeout(_longPressTimer);
                _longActive = false;
                return;
            }
            const t = e.touches[0];
            _sx = _cx = t.clientX;
            _sy = _cy = t.clientY;

            // 더블탭 감지
            const now = Date.now();
            if ((now - _lastTapTime) < DBL_MS) {
                _lastTapTime = 0;
                clearTimeout(_longPressTimer);
                if (typeof _cnbZoom === 'function') _cnbZoom(0.72); // ~28% 확대
                _m5ZoomFb();
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

        wrap.addEventListener('touchmove', e => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            _cx = t.clientX;
            _cy = t.clientY;
            const dx = Math.abs(_cx - _sx), dy = Math.abs(_cy - _sy);
            if (dx > MOVE_LIM || dy > MOVE_LIM) {
                clearTimeout(_longPressTimer);
                if (_longActive) { _m5HideOhlc(); _longActive = false; }
            } else if (_longActive) {
                // 살짝 이동해도 위치 따라 OHLC 갱신
                _m5ShowOhlc(_cx, _cy);
            }
        }, { passive: true });

        wrap.addEventListener('touchend', () => {
            clearTimeout(_longPressTimer);
            if (_longActive) {
                setTimeout(_m5HideOhlc, 1800); // 1.8초 후 자동 숨김
                _longActive = false;
            }
        }, { passive: true });

        wrap.addEventListener('touchcancel', () => {
            clearTimeout(_longPressTimer);
            _m5HideOhlc();
            _longActive = false;
        }, { passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _attach);
    } else {
        _attach();
    }
})();
