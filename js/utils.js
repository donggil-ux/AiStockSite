// js/utils.js
// 책임: 공통 유틸리티 (포맷터, 날짜 변환, 순수 함수)
// 의존: 없음

    function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); }; }

    // HTML 이스케이프 유틸 (XSS 방지)
    function escHtml(str) {
        return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    // Levenshtein 거리 (퍼지 검색용)
    // ========================================
    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        let prev = Array.from({length: b.length + 1}, (_, i) => i);
        let curr = new Array(b.length + 1);
        for (let i = 1; i <= a.length; i++) {
            curr[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i-1] === b[j-1] ? 0 : 1;
                curr[j] = Math.min(curr[j-1]+1, prev[j]+1, prev[j-1]+cost);
            }
            [prev, curr] = [curr, prev];
        }
        return prev[b.length];
    }

    // ========================================
    // 통합 자동완성 서제스트
    // Returns: [{ ticker, name, koreanName, market, type, sector, score }]
    // ========================================
    function searchSuggest(query, limit = 8) {
        const q = query.trim();
        if (!q) return [];
        const results = [], seen = new Set(), qLow = q.toLowerCase();
        const isNumericSix = /^\d{6}$/.test(q);
        const isEnglish = /^[A-Za-z.\-]+$/.test(q);

        function add(ticker, name, koreanName, market, type, sector, score) {
            const key = ticker + ':' + market;
            if (seen.has(key)) return;
            seen.add(key);
            results.push({ ticker, name, koreanName, market, type, sector, score });
        }

        // 1. 영문 티커 정확 매칭 (ETF 우선)
        if (isEnglish) {
            const up = q.toUpperCase();
            if (US_ETF_NAMES[up]) {
                const e = US_ETF_NAMES[up];
                add(up, e.name, e.korean[0]||up, 'US', 'etf', e.sector, 100);
            }
            const korEntry = Object.entries(US_STOCK_NAMES).find(([,v]) => v === up);
            if (korEntry) {
                const meta = ASSET_META[up] || {};
                add(up, up, korEntry[0], 'US', meta.type||'stock', meta.sector||'US', 100);
            }
        }
        // 2. 한국 코드 정확 매칭
        if (isNumericSix && KR_STOCK_NAMES[q]) {
            const meta = ASSET_META[q] || {};
            add(q, KR_STOCK_NAMES[q], KR_STOCK_NAMES[q], 'KR', meta.type||'stock', meta.sector||'한국주식', 100);
        }
        // 3. 한국 종목명 정확 매칭
        for (const [code, name] of Object.entries(KR_STOCK_NAMES)) {
            if (name.toLowerCase() === qLow) {
                const meta = ASSET_META[code] || {};
                add(code, name, name, 'KR', meta.type||'stock', meta.sector||'한국주식', 95);
            }
        }
        // 4. 미국 한글명 / ETF 한글명 정확 매칭
        if (!isEnglish) {
            if (US_STOCK_NAMES[q]) {
                const t = US_STOCK_NAMES[q], meta = ASSET_META[t]||{};
                add(t, t, q, 'US', meta.type||'stock', meta.sector||'US', 95);
            }
            for (const [ticker, etf] of Object.entries(US_ETF_NAMES)) {
                if (etf.korean.some(k => k.toLowerCase() === qLow))
                    add(ticker, etf.name, etf.korean[0], 'US', 'etf', etf.sector, 95);
            }
        }
        // 5. ETF 부분 매칭 (티커 시작, 이름 포함, 테마)
        for (const [ticker, etf] of Object.entries(US_ETF_NAMES)) {
            if (ticker.startsWith(q.toUpperCase()) ||
                etf.name.toLowerCase().includes(qLow) ||
                etf.korean.some(k => k.toLowerCase().includes(qLow)) ||
                etf.themes.some(t => t.toLowerCase().includes(qLow)))
                add(ticker, etf.name, etf.korean[0]||ticker, 'US', 'etf', etf.sector, 80);
        }
        // 6. 한국 부분 매칭
        for (const [code, name] of Object.entries(KR_STOCK_NAMES)) {
            if (name.toLowerCase().includes(qLow) || code.includes(q)) {
                const meta = ASSET_META[code] || {};
                add(code, name, name, 'KR', meta.type||'stock', meta.sector||'한국주식', 75);
            }
        }
        // 7. 미국 부분 매칭
        if (!isEnglish) {
            for (const [korName, ticker] of Object.entries(US_STOCK_NAMES)) {
                if (korName.toLowerCase().includes(qLow)) {
                    const meta = ASSET_META[ticker]||{};
                    add(ticker, ticker, korName, 'US', meta.type||'stock', meta.sector||'US', 70);
                }
            }
        } else {
            for (const [korName, ticker] of Object.entries(US_STOCK_NAMES)) {
                if (ticker.toUpperCase().startsWith(q.toUpperCase())) {
                    const meta = ASSET_META[ticker]||{};
                    add(ticker, ticker, korName, 'US', meta.type||'stock', meta.sector||'US', 70);
                }
            }
        }
        // 8. 퍼지 매칭 (결과 < 2개일 때만, 길이 ≥ 2)
        if (results.length < 2 && q.length >= 2) {
            const T = 2;
            for (const [code, name] of Object.entries(KR_STOCK_NAMES)) {
                const d = levenshtein(qLow, name.slice(0, q.length+2).toLowerCase());
                if (d <= T) { const m=ASSET_META[code]||{}; add(code, name, name, 'KR', m.type||'stock', m.sector||'한국주식', 60-d*10); }
            }
            if (!isEnglish) {
                for (const [korName, ticker] of Object.entries(US_STOCK_NAMES)) {
                    const d = levenshtein(qLow, korName.slice(0, q.length+2).toLowerCase());
                    if (d <= T) { const m=ASSET_META[ticker]||{}; add(ticker, ticker, korName, 'US', m.type||'stock', m.sector||'US', 60-d*10); }
                }
            }
        }
        results.sort((a,b) => b.score - a.score);
        return results.slice(0, limit);
    }

    // ========================================
    // ========================================

    // ========================================
    function showLoading(text) {
        document.getElementById('loadingText').textContent = text || '데이터를 불러오는 중...';
        document.getElementById('loadingOverlay').classList.add('active');
    }

    function hideLoading() {
        document.getElementById('loadingOverlay').classList.remove('active');
    }

    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }

    /**
     * 상단 고정 스낵바 표시
     * @param {string} msg       표시할 메시지
     * @param {'error'|'warning'|'success'|'info'} type  색상 타입 (기본: 'error')
     * @param {number} duration  노출 시간(ms) (기본: 4000)
     */
    function showSnackbar(msg, type = 'error', duration = 4000) {
        const el = document.getElementById('snackbar');
        if (!el) return;
        clearTimeout(el._snackTimer);
        el.textContent = msg;
        el.className = `snackbar ${type} show`;
        el._snackTimer = setTimeout(() => el.classList.remove('show'), duration);
    }

    /** AI 판독기 버튼 n초 쿨다운 (카운트다운 텍스트 표시) */
    let _aiCooldownActive = false;
    let _aiCooldownIv = null;
    function startAiCooldown(seconds = 8) {
        clearInterval(_aiCooldownIv); // 기존 interval 정리 (중복 호출 방어)
        _aiCooldownActive = true;
        let remaining = seconds;
        const _setBtn = (dis, txt) => {
            const b = document.getElementById('chartAiReaderBtn');
            if (!b) return;
            b.disabled = dis;
            b.textContent = txt;
            b.style.cursor = dis ? 'not-allowed' : '';
            b.style.opacity = dis ? '0.5' : '';
        };
        _setBtn(true, `재시도 가능 ${remaining}초 후`);
        _aiCooldownIv = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(_aiCooldownIv);
                _aiCooldownIv = null;
                _aiCooldownActive = false;
                _setBtn(false, '🔍 AI분석');
            } else {
                _setBtn(true, `재시도 가능 ${remaining}초 후`);
            }
        }, 1000);
    }
