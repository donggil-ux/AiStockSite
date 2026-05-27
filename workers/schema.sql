-- StockAI Workers D1 Schema
-- 마이그레이션: wrangler d1 execute stockai-db --remote --file=./schema.sql

-- ── 푸시 구독자 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscribers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_token     TEXT UNIQUE NOT NULL,        -- 클라이언트 인증용
    endpoint      TEXT NOT NULL,               -- VAPID endpoint URL
    p256dh        TEXT NOT NULL,               -- 공개 키
    auth          TEXT NOT NULL,               -- 인증 시크릿
    favs          TEXT,                        -- JSON: ['NVDA','AAPL',...]
    notif_prefs   TEXT DEFAULT '{"buy":1,"tp":1,"stop":1,"pos":1}', -- 4종 토글
    market_filter TEXT DEFAULT 'ALL',          -- 'US' | 'KR' | 'ALL'
    created_at    INTEGER NOT NULL,            -- Unix ms
    last_seen     INTEGER NOT NULL             -- 마지막 활동 시각
);
CREATE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscribers(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_token    ON push_subscribers(sub_token);

-- ── 가격 알림 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_token    TEXT NOT NULL,                -- push_subscribers.sub_token 참조
    endpoint     TEXT NOT NULL,
    symbol       TEXT NOT NULL,                -- 'NVDA' 등
    target_price REAL NOT NULL,
    direction    TEXT NOT NULL DEFAULT 'above',-- 'above' | 'below'
    triggered    INTEGER NOT NULL DEFAULT 0,   -- 0=대기, 1=발송됨
    created_at   INTEGER NOT NULL,
    triggered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_token  ON price_alerts(sub_token);
CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON price_alerts(symbol, triggered);

-- ── 시그널 히스토리 (옵션, 통계용) ─────────────────────────
CREATE TABLE IF NOT EXISTS signal_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    market      TEXT NOT NULL DEFAULT 'US',
    direction   TEXT NOT NULL,                 -- 'buy' | 'sell'
    grade       TEXT,                          -- 'S' | 'A' | 'B' | 'C'
    score       REAL,
    win_rate    INTEGER,
    price       REAL,
    headline    TEXT,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sig_symbol_ts ON signal_history(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sig_grade     ON signal_history(grade, created_at DESC);

-- ── 즐겨찾기 (선택, 사용자 인증 도입 시) ─────────────────
CREATE TABLE IF NOT EXISTS user_favorites (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_token  TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    market     TEXT NOT NULL DEFAULT 'US',
    name       TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(sub_token, symbol, market)
);
CREATE INDEX IF NOT EXISTS idx_fav_token ON user_favorites(sub_token);
