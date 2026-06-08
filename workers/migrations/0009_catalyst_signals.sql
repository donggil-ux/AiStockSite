-- 0009_catalyst_signals.sql — 카탈리스트 스캐너 실전 forward-test 추적
-- 카탈리스트 점수가 실제 예측력이 있는지(점수↑ → 수익률↑) 검증.
-- 데일리 트레이딩과 달리 진입/손절이 아니라 "신호 후 N일 수익률"을 측정.
CREATE TABLE IF NOT EXISTS catalyst_signals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker      TEXT NOT NULL,
    score       REAL,
    tier        TEXT,                          -- 등급(이모지): 🚨긴급/🔴강한/🟠관심/⚪약한
    entry       REAL NOT NULL,                 -- 신호 시점 가격
    created_at  INTEGER NOT NULL,              -- 신호 발생 시각 (ms)
    -- 결과 (cron 이 채움)
    ret_1d      REAL,                          -- 1일 후 수익률 (%)
    ret_3d      REAL,                          -- 3일 후 수익률 (%)
    resolved    INTEGER DEFAULT 0,             -- 0=추적중, 1=3일 경과 완료
    resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cat_open ON catalyst_signals (resolved, created_at);
CREATE INDEX IF NOT EXISTS idx_cat_dedup ON catalyst_signals (ticker, created_at);
