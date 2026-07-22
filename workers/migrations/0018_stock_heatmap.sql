-- 섹터 히트맵 — 종목 레벨(시총/등락률) 스냅샷. sector_heat(0013)는 섹터 11개 랭킹만 있어서
-- 트리맵 안쪽(섹터→종목) 레이어에 쓸 종목별 데이터가 별도로 필요함.
-- 섹터/기업 데이터는 전역 공유 데이터이므로 user_id 컬럼 없음 (sector_heat과 동일한 설계).

CREATE TABLE IF NOT EXISTS stock_heatmap (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date  TEXT NOT NULL,
    symbol         TEXT NOT NULL,
    sector_etf     TEXT NOT NULL,
    company_name   TEXT,
    market_cap     REAL,
    day_change_pct REAL,
    price          REAL,
    created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_heatmap_date_sym ON stock_heatmap (snapshot_date, symbol);
CREATE INDEX IF NOT EXISTS idx_stock_heatmap_sector ON stock_heatmap (snapshot_date, sector_etf);
