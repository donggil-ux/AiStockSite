-- 시그널 정확도 추적: signal_history 결과 컬럼 추가
-- 적용: cd workers && npx wrangler d1 execute stockai-db --remote --file=./migrations/0003_signal_outcomes.sql

-- 결과 매칭 컬럼
ALTER TABLE signal_history ADD COLUMN resolved INTEGER DEFAULT 0;        -- 0=대기, 1=7일+ 경과
ALTER TABLE signal_history ADD COLUMN price_1h REAL;                     -- 1시간 후 가격
ALTER TABLE signal_history ADD COLUMN price_4h REAL;                     -- 4시간 후 가격
ALTER TABLE signal_history ADD COLUMN price_24h REAL;                    -- 24시간 후 가격
ALTER TABLE signal_history ADD COLUMN price_7d REAL;                     -- 7일 후 가격
ALTER TABLE signal_history ADD COLUMN max_gain_24h REAL;                 -- 24h 내 최대 수익률 (%) — buy 기준
ALTER TABLE signal_history ADD COLUMN max_loss_24h REAL;                 -- 24h 내 최대 손실률 (%)
ALTER TABLE signal_history ADD COLUMN resolved_at INTEGER;               -- 매칭 완료 시각

-- 결과 매칭 cron 이 빠르게 미해결 조회하도록 인덱스
CREATE INDEX IF NOT EXISTS idx_sig_unresolved ON signal_history(resolved, created_at);
