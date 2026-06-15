// 종목 카테고리 분류 — 가상 매매 대상 필터링
// leveraged: 레버리지 ETF 고정 목록
// large_cap: 대형주 고정 목록
// mid_small: 나머지 (price > $5, rvol < 10, 급등주 제외)
// null: 매매 제외 (저가주, 급등주)

export const LEVERAGED_ETFS = new Set([
    'TQQQ','SOXL','UPRO','QLD','SSO','FNGU','LABU','TECL','WEBL',
    'SPXL','UDOW','CURE','DFEN','DPST','HIBL','NAIL','PILL','RETL',
]);

export const LARGE_CAP = new Set([
    'AAPL','MSFT','NVDA','GOOGL','GOOG','AMZN','META','TSLA','AMD',
    'AVGO','ORCL','CRM','NFLX','INTC','QCOM','TXN','MU','AMAT','KLAC',
    'LRCX','MRVL','ADI','SNPS','CDNS','ON','MPWR','ENPH','FSLR',
]);

/**
 * 종목을 카테고리로 분류한다.
 * @param {string} symbol
 * @param {number} price  현재가 (0이면 필터 건너뜀)
 * @param {number} rvol   상대 거래량 배수 (0이면 필터 건너뜀)
 * @returns {'leveraged'|'large_cap'|'mid_small'|null}
 */
export function classifySymbol(symbol, price = 0, rvol = 0) {
    if (LEVERAGED_ETFS.has(symbol)) return 'leveraged';
    if (LARGE_CAP.has(symbol))      return 'large_cap';
    // mid_small: 저가주·급등주 제외
    if (price > 0 && price <= 5)    return null;
    if (rvol  > 0 && rvol  >= 10)   return null; // 급등주
    return 'mid_small';
}
