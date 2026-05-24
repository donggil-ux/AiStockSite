// js/api.js
// 책임: 서버 API fetch 호출 래퍼
// 의존: utils.js, state.js

    // Backend API Proxy (Yahoo Finance URL → 백엔드 엔드포인트 매핑)
    // ========================================
    function mapToBackend(url) {
        const base = 'https://query1.finance.yahoo.com';
        if (!url.startsWith(base)) return url;
        const p = url.slice(base.length);

        // /v8/finance/chart/{symbol}?range=&interval=&includePrePost=
        const chartM = p.match(/^\/v8\/finance\/chart\/([^?]+)(\?.*)?$/);
        if (chartM) {
            const sym = chartM[1];
            const params = new URLSearchParams(chartM[2]?.slice(1) || '');
            const q = new URLSearchParams();
            ['range', 'interval', 'includePrePost'].forEach(k => { if (params.has(k)) q.set(k, params.get(k)); });
            return `${API_BASE}/api/chart/${sym}?${q}`;
        }

        // /v7/finance/quote?symbols=...
        if (p.startsWith('/v7/finance/quote')) {
            const params = new URLSearchParams(p.includes('?') ? p.split('?')[1] : '');
            return `${API_BASE}/api/quote?symbols=${params.get('symbols') || ''}`;
        }

        // /v10/finance/quoteSummary/{symbol}?modules=...
        const summaryM = p.match(/^\/v10\/finance\/quoteSummary\/([^?]+)(\?.*)?$/);
        if (summaryM) {
            const sym = summaryM[1];
            const params = new URLSearchParams(summaryM[2]?.slice(1) || '');
            return `${API_BASE}/api/summary/${sym}?modules=${params.get('modules') || ''}`;
        }

        // /v1/finance/screener/predefined/saved?scrIds={filter}&count=...
        if (p.startsWith('/v1/finance/screener')) {
            const params = new URLSearchParams(p.includes('?') ? p.split('?')[1] : '');
            return `${API_BASE}/api/screener/${params.get('scrIds') || ''}?count=${params.get('count') || 100}`;
        }

        return url;
    }

    async function fetchWithProxy(url, timeout = 8000) {
        const backendUrl = mapToBackend(url);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
            const res = await fetch(backendUrl, { signal: ctrl.signal });
            clearTimeout(timer);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `서버 오류 (${res.status})`);
            }
            return await res.json();
        } catch(e) {
            clearTimeout(timer);
            if (e.name === 'AbortError') throw new Error('요청 시간이 초과되었습니다.');
            throw new Error(e.message || '데이터를 가져올 수 없습니다.');
        }
    }

    // ========================================