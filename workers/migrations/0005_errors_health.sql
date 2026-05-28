-- 운영 모니터링: 자체 에러 추적 + 일별 헬스 스냅샷
-- 적용: cd workers && npx wrangler d1 execute stockai-db --remote --file=./migrations/0005_errors_health.sql

-- 1) 에러 로그 — 클라이언트/Workers 양쪽에서 발생한 모든 에러
CREATE TABLE IF NOT EXISTS errors (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT NOT NULL,            -- 'client' | 'worker' | 'cron' | 'fetch'
    severity     TEXT NOT NULL DEFAULT 'error', -- 'error' | 'warn' | 'fatal'
    message      TEXT NOT NULL,            -- 에러 메시지 (최대 1000자)
    stack        TEXT,                     -- 스택 트레이스 (최대 4000자)
    context      TEXT,                     -- JSON: { url, ua, route, symbol, ... }
    fingerprint  TEXT,                     -- 그룹핑용 해시 (message+source 기반)
    sub_token    TEXT,                     -- 보고한 클라이언트 (선택)
    user_id      TEXT,                     -- 로그인 사용자 (선택)
    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_err_ts ON errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_err_fp ON errors(fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_err_src ON errors(source, created_at DESC);

-- 2) 헬스 스냅샷 — 일별 운영 메트릭 (트렌드 분석)
CREATE TABLE IF NOT EXISTS health_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date   TEXT UNIQUE NOT NULL, -- YYYY-MM-DD
    subscribers     INTEGER NOT NULL DEFAULT 0,
    active_24h      INTEGER NOT NULL DEFAULT 0,
    signals_24h     INTEGER NOT NULL DEFAULT 0,
    pushes_24h      INTEGER NOT NULL DEFAULT 0,
    errors_24h      INTEGER NOT NULL DEFAULT 0,
    feedbacks_24h   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_date ON health_snapshots(snapshot_date DESC);

-- 3) 에러 요약 view (그룹핑된 최근 에러)
-- D1 view 는 지원되지만 admin API 에서 직접 쿼리하는 게 더 유연 → 생성 안 함
