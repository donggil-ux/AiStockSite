-- 가상 매매 시스템 (Paper Trading)
-- 4분할 매수 / 4분할 익절 / 평단 -2% 손절 / 트레일링 스탑

CREATE TABLE IF NOT EXISTS paper_account (
    user_id        TEXT PRIMARY KEY,
    balance        REAL NOT NULL DEFAULT 100000.0, -- 현금 잔고 (USD)
    position_size  REAL NOT NULL DEFAULT 4000.0,   -- 종목당 총 투자 한도 (4분할 × $1,000)
    total_pnl      REAL NOT NULL DEFAULT 0,
    updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_trades (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT NOT NULL,
    symbol         TEXT NOT NULL,
    category       TEXT NOT NULL,  -- 'leveraged' | 'large_cap' | 'mid_small'
    style          TEXT NOT NULL,  -- 'day' | 'swing'
    dir            TEXT NOT NULL,  -- 'long' | 'short'
    -- 4분할 매수 상태
    tranche_count  INTEGER NOT NULL DEFAULT 0,
    first_price    REAL NOT NULL,               -- 1차 진입가 (손절 기준 분할 트리거용)
    avg_price      REAL,                        -- 현재 평균단가
    total_qty      REAL NOT NULL DEFAULT 0,
    total_invested REAL NOT NULL DEFAULT 0,     -- 총 투자금 USD
    stop_price     REAL,                        -- avg_price × 0.98
    peak_price     REAL,                        -- 고점 (트레일링 스탑용)
    -- 4분할 익절 달성 여부
    tp1_done       INTEGER NOT NULL DEFAULT 0,
    tp2_done       INTEGER NOT NULL DEFAULT 0,
    tp3_done       INTEGER NOT NULL DEFAULT 0,
    -- 연결 시그널
    signal_id      INTEGER,
    grade          TEXT,
    score          REAL,
    -- 상태
    status         TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'closed'
    realized_pnl   REAL NOT NULL DEFAULT 0,       -- 분할 익절로 실현된 손익
    exit_price     REAL,
    exit_at        INTEGER,
    close_reason   TEXT,  -- 'stop' | 'tp4_trail' | 'timeout' | 'manual'
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pt_user_status ON paper_trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pt_signal      ON paper_trades(signal_id);
CREATE INDEX IF NOT EXISTS idx_pt_symbol      ON paper_trades(symbol, status);

-- 개별 체결 내역 (분할 매수·익절 로그)
CREATE TABLE IF NOT EXISTS paper_fills (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id   INTEGER NOT NULL,
    user_id    TEXT NOT NULL,
    -- 'buy_t1'..'buy_t4' | 'sell_tp1'..'sell_tp3' | 'sell_stop' | 'sell_trail' | 'sell_manual'
    fill_type  TEXT NOT NULL,
    price      REAL NOT NULL,
    qty        REAL NOT NULL,
    amount     REAL NOT NULL,  -- price × qty
    pnl        REAL DEFAULT 0, -- 매도 체결만 (avg_price 기준)
    filled_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pf_trade ON paper_fills(trade_id);
CREATE INDEX IF NOT EXISTS idx_pf_user  ON paper_fills(user_id, filled_at DESC);
