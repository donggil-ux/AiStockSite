-- ============================================================
-- TOP100 상승/하락 이유(뉴스 헤드라인 한글 요약) 공유 캐시
-- 여러 서버 인스턴스 + 첫 방문 유저 간 캐시 공유 → Yahoo 재호출 최소화
-- Supabase SQL Editor 에서 실행
-- ============================================================

CREATE TABLE IF NOT EXISTS news_reason (
    symbol      text PRIMARY KEY,
    text        text NOT NULL DEFAULT '',
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 오래된 엔트리 조회 최적화
CREATE INDEX IF NOT EXISTS news_reason_updated_idx
    ON news_reason (updated_at DESC);

-- RLS 는 기본 비활성 (서버가 service_role 로 접근). 필요 시:
-- ALTER TABLE news_reason ENABLE ROW LEVEL SECURITY;

-- 검증
SELECT count(*) AS rows, max(updated_at) AS latest FROM news_reason;
