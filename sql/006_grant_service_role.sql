-- ============================================================
-- 006_grant_service_role.sql
-- Supabase 정책 변경 대응 (2026-10-30 강제 적용)
--
-- 변경 사항:
--   2026-05-30 부터 신규 프로젝트에서 public 스키마 테이블은
--   명시적 GRANT 없이는 Data API(supabase-js, PostgREST, GraphQL)로
--   접근 불가. 2026-10-30 부터는 기존 프로젝트도 강제 적용.
--
-- 이 프로젝트 영향:
--   - 서버(server.js)는 SUPABASE_SERVICE_ROLE_KEY 로 supabase-js 사용
--   - = Data API 경유 → service_role 에 명시적 GRANT 필요
--   - 클라이언트는 Supabase 직접 호출 안 함 → 영향 없음
--
-- 이 파일이 하는 일:
--   public 스키마의 모든 기존 테이블에 service_role 전 권한 부여 (idempotent).
--   anon / authenticated 권한은 회수 상태 유지 (004_enable_rls.sql 패턴).
--
-- 실행 위치: Supabase Dashboard → SQL Editor → 새 쿼리 → 붙여넣고 Run
-- ============================================================

-- 기존 테이블 — Data API 호출 가능하도록 service_role 권한 명시 부여
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_analysis        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cusip_ticker       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.earnings_summary   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guru               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guru_position      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guru_quarter       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.news_reason        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limits        TO service_role;

-- 회원가입 단계에서 추가될 테이블 (005_auth_tables.sql 적용 후 실행)
-- (테이블이 아직 없다면 다음 두 줄에서 에러나도 무시 — 005 적용 후 재실행하면 됨)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_favorites     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_prefs         TO service_role;

-- 시퀀스(자동 PK) 권한 — 일부 테이블이 SERIAL 또는 GENERATED 사용 시 필요
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 향후 추가되는 테이블·시퀀스에 대해서도 service_role 자동 권한 부여
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- 검증: service_role 이 받은 권한 확인
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE grantee = 'service_role' AND table_schema = 'public'
-- ORDER BY table_name, privilege_type;
