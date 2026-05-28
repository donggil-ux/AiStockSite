-- 알림 품질 강화 + 사용자 피드백 루프
-- 적용: cd workers && npx wrangler d1 execute stockai-db --remote --file=./migrations/0004_feedback_quiet.sql

-- 1) 시그널 알림 cooldown 추적용 (마지막 푸시 시각 + max_loss 경고 발송 여부)
ALTER TABLE signal_history ADD COLUMN pushed_at INTEGER;             -- 마지막으로 푸시 발송한 시각
ALTER TABLE signal_history ADD COLUMN loss_alerted INTEGER DEFAULT 0; -- max_loss 경고 발송 여부

-- 2) 조용 시간대 (per-subscriber 설정 — 야간 음소거)
-- quiet: JSON {"enabled": 1, "start": 22, "end": 7, "tz_offset_min": 540}
--   tz_offset_min: 사용자 timezone 의 UTC 대비 분 (KST=540, EST=-300)
ALTER TABLE push_subscribers ADD COLUMN quiet TEXT;

-- 3) 시그널 피드백 (👍/👎)
CREATE TABLE IF NOT EXISTS signal_feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id   INTEGER NOT NULL,                       -- signal_history.id 참조
    sub_token   TEXT,                                   -- 익명 (비로그인)
    user_id     TEXT,                                   -- 로그인 (Clerk user_id)
    rating      INTEGER NOT NULL,                       -- +1 (👍) / -1 (👎)
    note        TEXT,                                   -- 옵션 코멘트 (향후)
    created_at  INTEGER NOT NULL,
    UNIQUE(signal_id, sub_token),
    UNIQUE(signal_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_fb_signal ON signal_feedback(signal_id);
CREATE INDEX IF NOT EXISTS idx_fb_user   ON signal_feedback(user_id);
