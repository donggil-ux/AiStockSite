-- 성장주 발굴(Growth-Stock Discovery) 레이어 — 기존 단기/중단기 스윙 가상매매와 완전히 독립된 신규 테이블.
-- 섹터/기업 데이터는 전역 공유 데이터이므로 user_id 컬럼 없음(의도적 설계).

CREATE TABLE IF NOT EXISTS sector_heat (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    sector_etf    TEXT NOT NULL,
    sector_label  TEXT,
    perf_1d       REAL, perf_5d REAL, perf_1mo REAL, perf_3mo REAL,
    rel_strength  REAL,
    news_score    REAL,
    heat_score    REAL,
    heat_rank     INTEGER,
    created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sector_heat_date_etf ON sector_heat (snapshot_date, sector_etf);
CREATE INDEX IF NOT EXISTS idx_sector_heat_rank ON sector_heat (snapshot_date, heat_rank);

CREATE TABLE IF NOT EXISTS growth_fundamentals (
    symbol             TEXT PRIMARY KEY,
    sector_etf         TEXT,
    industry           TEXT,
    pe_ratio           REAL,
    forward_pe         REAL,
    revenue_growth     REAL,
    earnings_growth    REAL,
    profit_margin      REAL,
    market_cap         REAL,
    analyst_rating     TEXT,
    target_mean_price  REAL,
    stage              TEXT,
    fundamentals_score REAL,
    updated_at         INTEGER NOT NULL,
    stale              INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS institutional_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol              TEXT NOT NULL,
    snapshot_date       TEXT NOT NULL,
    institutions_pct    REAL,
    insiders_pct        REAL,
    created_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inst_snap_sym_date ON institutional_snapshots (symbol, snapshot_date);

CREATE TABLE IF NOT EXISTS volume_flow (
    symbol            TEXT PRIMARY KEY,
    vol_ratio_20d     REAL,
    accumulation_days INTEGER,
    obv_trend         TEXT,
    flow_score        REAL,
    updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS news_momentum (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    scope          TEXT NOT NULL,
    key            TEXT NOT NULL,
    snapshot_date  TEXT NOT NULL,
    avg_score      REAL,
    headline_count INTEGER,
    catalyst_score REAL,
    created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_news_mom_key_date ON news_momentum (scope, key, snapshot_date);

CREATE TABLE IF NOT EXISTS growth_recommendations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol             TEXT NOT NULL,
    snapshot_date      TEXT NOT NULL,
    sector_etf         TEXT,
    recommendation     TEXT NOT NULL,
    confidence         TEXT NOT NULL,
    composite_score    REAL,
    fundamentals_score REAL,
    sector_score       REAL,
    flow_score         REAL,
    news_score         REAL,
    price_at_scan      REAL,
    reasons_json       TEXT,
    created_at         INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_growth_rec_sym_date ON growth_recommendations (symbol, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_growth_rec_date_score ON growth_recommendations (snapshot_date, composite_score DESC);
