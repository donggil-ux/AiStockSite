-- ============================================================
-- 004_enable_rls.sql
-- Supabase 보안 경고 해결: 모든 public 테이블에 RLS 활성화.
--
-- 정책 전략:
--   - 서버는 SUPABASE_SERVICE_ROLE_KEY 사용 → RLS 우회
--   - 클라이언트(브라우저)는 Supabase 직접 호출 안 함
--   - 따라서 anon/authenticated 역할에는 정책 추가하지 않음 → 전부 deny
--
-- 실행 위치: Supabase Dashboard → SQL Editor → 새 쿼리 → 붙여넣고 Run
-- ============================================================

ALTER TABLE public.ai_analysis        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cusip_ticker       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earnings_summary   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guru               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guru_position      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guru_quarter       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_reason        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_alerts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits        ENABLE ROW LEVEL SECURITY;

-- (선택) 기존에 anon/authenticated 에게 직접 부여된 권한이 있다면 제거.
-- 서버가 service_role 이므로 anon/authenticated 권한이 모두 빠져도 동작합니다.
REVOKE ALL ON public.ai_analysis,
              public.cusip_ticker,
              public.earnings_summary,
              public.guru,
              public.guru_position,
              public.guru_quarter,
              public.news_reason,
              public.price_alerts,
              public.push_subscriptions,
              public.rate_limits
FROM anon, authenticated;
