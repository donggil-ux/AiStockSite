// js/components/tab-state.js
// 탭 로딩 / 에러 / 빈 상태 공통 UI 컴포넌트
// 의존: utils.js (escHtml, skel-block CSS)

/**
 * 스켈레톤 로딩 상태 HTML 반환
 * @param {number[]} rows  각 행의 너비(%). 기본: [100, 80, 90]
 */
function tabLoading(rows) {
    const widths = rows || [100, 80, 90];
    const bars = widths.map(w =>
        `<div class="skel-block ts-skel" style="width:${w}%;"></div>`
    ).join('');
    return `<div class="tab-state tab-state--loading">${bars}</div>`;
}

/**
 * 에러 상태 HTML 반환
 * @param {string} msg       에러 메시지
 * @param {string} retryCall 재시도 onclick 문자열 (예: "reloadShortTab()")
 */
function tabError(msg, retryCall) {
    const safe = (typeof escHtml === 'function') ? escHtml(msg || '데이터를 불러올 수 없습니다.') : (msg || '데이터를 불러올 수 없습니다.');
    const btn  = retryCall
        ? `<button class="ts-retry" onclick="${retryCall}">↺ 다시 시도</button>`
        : '';
    return `<div class="tab-state tab-state--error"><span class="ts-state-icon">⚠</span><span class="ts-msg">${safe}</span>${btn}</div>`;
}

/**
 * 빈 상태 HTML 반환
 * @param {string} icon  이모지 아이콘 (기본 📭)
 * @param {string} msg   메시지
 */
function tabEmpty(icon, msg) {
    const safe = (typeof escHtml === 'function') ? escHtml(msg || '데이터가 없습니다.') : (msg || '데이터가 없습니다.');
    return `<div class="tab-state tab-state--empty"><span class="ts-state-icon">${icon || '📭'}</span><span class="ts-msg">${safe}</span></div>`;
}
