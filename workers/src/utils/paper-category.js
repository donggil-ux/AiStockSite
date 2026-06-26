// 종목 카테고리 분류 — 가상 매매 대상 필터링
// leveraged: 레버리지 ETF 고정 목록
// large_cap: 대형주 고정 목록
// mid_small: 나머지 (price > $5, rvol < 10, 급등주 제외)
// null: 매매 제외 (저가주, 급등주, 코인관련주, 수동 금지 종목)

// 코인 관련주 매매 금지 목록 — COIN(코인베이스)·HOOD(로빈후드)는 제외
// 비트코인 채굴사, 코인 재무 보유사, 비트코인 현물 ETF 등
export const CRYPTO_BLOCKED = new Set([
    // 비트코인 채굴사
    'MARA','RIOT','CLSK','HUT','BITF','BTBT','CIFR','WULF','CORZ','IREN','BTDR','BMNR',
    // 코인 재무 보유 (BTC 적립식 매수 기업)
    'MSTR','SMLR','MTPLF',
    // 비트코인·크립토 현물/선물 ETF
    'BITO','GBTC','IBIT','FBTC','ARKB','HODL','BTCO','BITX','BITI',
]);

export const LEVERAGED_ETFS = new Set([
    // 롱 레버리지 (2x/3x) — 지수/섹터
    'TQQQ','QLD','SOXL','UPRO','SSO','SPXL','UDOW','FNGU','LABU','TECL','WEBL',
    'CURE','DFEN','DPST','HIBL','NAIL','PILL','RETL','BULZ','NVDL','TSLL','AMZU',
    // 개별 종목 롱 레버리지 (2x)
    'AAPU','MSFU',
    // 역레버리지 (숏 ETF) — 하락장 수익
    'SQQQ','SPXS','SOXS','QID','SDOW','TECS','SRTY','TZA',
    // 개별 종목 숏 레버리지 (2x)
    'NVDS','TSLS',
]);

// 섹터 로테이션 (원칙 11) — 종목 → SPDR 섹터 ETF 매핑
// null 또는 미포함 = 광범위 시장 ETF → 섹터 필터 제외
export const SECTOR_MAP = {
    // XLK — Technology
    NVDA:'XLK', AAPL:'XLK', MSFT:'XLK', AVGO:'XLK', AMD:'XLK', SMCI:'XLK', PLTR:'XLK',
    // XLC — Communication
    GOOGL:'XLC', META:'XLC', NFLX:'XLC',
    // XLY — Consumer Discretionary
    TSLA:'XLY', AMZN:'XLY', SHOP:'XLY', RBLX:'XLY',
    // XLF — Financials
    COIN:'XLF', HOOD:'XLF', SOFI:'XLF',
    // XLI — Industrials
    RKLB:'XLI',
    // 레버리지 ETF → 기초자산 섹터
    TQQQ:'XLK', QLD:'XLK', SOXL:'XLK', TECL:'XLK', FNGU:'XLK', BULZ:'XLK',
    NVDL:'XLK', NVDS:'XLK',
    SQQQ:'XLK', SOXS:'XLK', TECS:'XLK', QID:'XLK',
    AAPU:'XLK', MSFU:'XLK',
    TSLL:'XLY', TSLS:'XLY', AMZU:'XLY',
    // UPRO/SPXL/SSO/SPXS/UDOW/SDOW → 광범위, 미포함(필터 제외)
};

export const LARGE_CAP = new Set([
    'AAPL','MSFT','NVDA','GOOGL','GOOG','AMZN','META','TSLA','AMD',
    'AVGO','ORCL','CRM','INTC','QCOM','TXN','MU','AMAT','KLAC',
    'LRCX','MRVL','ADI','SNPS','CDNS','ON','MPWR','ENPH','FSLR',
]);

// 수동 매매 금지 종목 — 변동성·유동성·전략 부적합 등 이유로 개별 차단
export const TRADE_BLOCKED = new Set([
    'NFLX', // 변동성 크고 진입 타이밍 까다로움
]);

/**
 * 종목을 카테고리로 분류한다.
 * @param {string} symbol
 * @param {number} price  현재가 (0이면 필터 건너뜀)
 * @param {number} rvol   상대 거래량 배수 (0이면 필터 건너뜀)
 * @returns {'leveraged'|'large_cap'|'mid_small'|null}
 */
export function classifySymbol(symbol, price = 0, rvol = 0) {
    if (TRADE_BLOCKED.has(symbol))    return null; // 수동 매매 금지
    if (CRYPTO_BLOCKED.has(symbol))  return null; // 코인 관련주 차단 (COIN·HOOD 제외)
    if (LEVERAGED_ETFS.has(symbol))  return 'leveraged';
    if (LARGE_CAP.has(symbol))       return 'large_cap';
    // mid_small: 저가주·급등주 제외
    if (price > 0 && price <= 5)     return null;
    if (rvol  > 0 && rvol  >= 10)    return null; // 급등주
    return 'mid_small';
}
