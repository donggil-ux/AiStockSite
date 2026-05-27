// 입력 검증 (server.js 의 화이트리스트 그대로)
export const SYMBOL_RE = /^[A-Z0-9.\-\^=]{1,20}$/i;
export const VALID_RANGES = new Set(['1d','5d','1mo','3mo','6mo','1y','2y','5y','10y','ytd','max']);
export const VALID_INTERVALS = new Set(['1m','2m','5m','15m','30m','60m','90m','1h','1d','5d','1wk','1mo','3mo']);
export const VALID_TIMESPANS = new Set(['minute','hour','day','week','month']);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const validSymbol  = s => s && SYMBOL_RE.test(s);
export const validRange   = r => !r || VALID_RANGES.has(r);
export const validInterval= i => !i || VALID_INTERVALS.has(i);
export const validDate    = d => DATE_RE.test(d);

export function json(data, init = {}) {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...(init.headers || {}),
        },
    });
}
export function err(status, message) {
    return json({ error: message }, { status });
}
