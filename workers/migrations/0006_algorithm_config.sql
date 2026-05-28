-- 자동 알고리즘 보정 시스템
-- 적용: cd workers && npx wrangler d1 execute stockai-db --remote --file=./migrations/0006_algorithm_config.sql

-- 1) 동적 알고리즘 설정 (key-value 스토어)
-- 매주 자동 보정으로 업데이트되며, detectSignal() 이 KV 캐시 통해 읽음
CREATE TABLE IF NOT EXISTS algorithm_config (
    key         TEXT PRIMARY KEY,         -- 'thresholds' | 'last_calibration' | ...
    value       TEXT NOT NULL,            -- JSON 페이로드
    updated_at  INTEGER NOT NULL,
    notes       TEXT                       -- 보정 사유/근거 (사람이 읽기 위해)
);

-- 2) 종목별 가중치 / 블랙리스트
-- avg_return < 임계값인 종목은 자동 블랙리스트 (시그널 미발송)
CREATE TABLE IF NOT EXISTS symbol_weights (
    symbol         TEXT PRIMARY KEY,
    weight         REAL NOT NULL DEFAULT 1.0,    -- 0.0 (블랙리스트) ~ 2.0 (가중치 강화)
    samples        INTEGER NOT NULL DEFAULT 0,    -- 보정 시 분석된 시그널 수
    avg_return     REAL,                          -- 보정 시점 평균 수익률 (%)
    winrate        REAL,                          -- 실제 승률 (%)
    user_rating    REAL,                          -- 사용자 평가 (-1~+1)
    blacklisted    INTEGER NOT NULL DEFAULT 0,    -- 1 = 시그널 발송 차단
    updated_at     INTEGER NOT NULL,
    reason         TEXT                            -- 보정 이유
);
CREATE INDEX IF NOT EXISTS idx_sw_blacklist ON symbol_weights(blacklisted, updated_at);

-- 3) 보정 히스토리 (감사용)
CREATE TABLE IF NOT EXISTS calibration_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at          INTEGER NOT NULL,
    samples_analyzed INTEGER NOT NULL,
    thresholds_before TEXT,                       -- JSON
    thresholds_after  TEXT,                       -- JSON
    symbols_updated   INTEGER NOT NULL DEFAULT 0,
    symbols_blacklisted INTEGER NOT NULL DEFAULT 0,
    notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_calib_ts ON calibration_log(run_at DESC);

-- 4) 초기 기본 설정 — detectSignal 의 현재 하드코딩 값
INSERT OR IGNORE INTO algorithm_config (key, value, updated_at, notes) VALUES
    ('thresholds', '{"S":7.0,"A":5.5,"B":4.0,"min_score_for_push":5.5}', strftime('%s','now') * 1000, 'initial default'),
    ('blacklist_rule', '{"min_samples":5,"max_avg_return":-3.0}', strftime('%s','now') * 1000, 'symbol blacklist: 5+ samples and avg return < -3%'),
    ('last_calibration', '{"run_at":0,"reason":"not yet run"}', strftime('%s','now') * 1000, 'updated on each weekly run');
