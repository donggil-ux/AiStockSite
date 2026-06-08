-- 0008_dt_signals.sql — 데일리 트레이딩 스캐너 실전 forward-test 추적
-- 스캐너가 내보낸 실제 신호를 기록 → cron이 트레일링 청산을 시뮬레이션해 실측 R 산출.
-- 백테스트(과거 데이터)와 달리 "실시간으로 본 신호"의 사후 성과 = 편향 없는 진짜 승률.
CREATE TABLE IF NOT EXISTS dt_signals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,                 -- '5m' | '15m'
    dir         TEXT NOT NULL,                 -- 'buy' | 'sell'
    mode        TEXT DEFAULT 'trend',          -- 'trend' | 'bounce'
    grade       TEXT,                          -- 'S' | 'A' | 'B'
    score       REAL,                          -- 컨플루언스 점수
    entry       REAL NOT NULL,                 -- 진입가 (신호 발생 시 종가)
    stop        REAL NOT NULL,                 -- 초기 손절가
    be          REAL,                          -- 본전 이동 트리거 (+1R)
    stop_dist   REAL NOT NULL,                 -- 1R 거리 (|entry-stop|)
    created_at  INTEGER NOT NULL,              -- 신호 발생 시각 (ms)
    -- 결과 (cron 이 채움)
    resolved    INTEGER DEFAULT 0,             -- 0=진행중, 1=청산됨
    outcome     TEXT,                          -- 'win' | 'loss' | 'timeout'
    exit_price  REAL,
    exit_r      REAL,                          -- 실현 손익 (R 배수)
    resolved_at INTEGER
);
-- 같은 종목·방향·날짜 중복 신호 방지 (날짜는 created_at 일자 단위로 앱에서 dedupe)
CREATE INDEX IF NOT EXISTS idx_dt_signals_open ON dt_signals (resolved, created_at);
CREATE INDEX IF NOT EXISTS idx_dt_signals_dedup ON dt_signals (symbol, dir, tf, created_at);
