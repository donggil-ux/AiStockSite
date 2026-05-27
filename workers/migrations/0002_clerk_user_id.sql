-- Clerk 인증 도입: user_id 컬럼 추가 (NULL 허용 — 비로그인 사용자 호환)
-- 적용: cd workers && npx wrangler d1 execute stockai-db --remote --file=./migrations/0002_clerk_user_id.sql

-- 1) push_subscribers
ALTER TABLE push_subscribers ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscribers(user_id);

-- 2) price_alerts
ALTER TABLE price_alerts ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts(user_id);

-- 3) user_favorites
ALTER TABLE user_favorites ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_fav_user ON user_favorites(user_id);

-- 4) Clerk 사용자 메타 (선택 — 향후 프로필 확장용)
CREATE TABLE IF NOT EXISTS users (
    user_id     TEXT PRIMARY KEY,                -- Clerk user_xxx
    email       TEXT,
    name        TEXT,
    avatar_url  TEXT,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
);
