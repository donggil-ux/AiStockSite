-- ============================================================
-- 005_auth_tables.sql
-- StockAI 회원가입(Supabase Auth) — 사용자별 즐겨찾기·설정 + 기존 테이블 user_id 연결
--
-- 사전 조건:
--   - Supabase Auth 의 Google·Apple OAuth Provider 가 활성화되어야 함
--     (Dashboard → Authentication → Providers)
--
-- 실행 위치: Supabase Dashboard → SQL Editor → 새 쿼리 → 붙여넣고 Run
-- ============================================================

-- 1) 사용자 즐겨찾기 (다기기 동기화)
CREATE TABLE IF NOT EXISTS public.user_favorites (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol  TEXT NOT NULL,
    market  TEXT NOT NULL CHECK (market IN ('US','KR')),
    name    TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, symbol, market)
);
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own favs" ON public.user_favorites;
CREATE POLICY "own favs" ON public.user_favorites
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 2) 사용자 설정 (차트 인터벌·테마·매매 모드 등)
CREATE TABLE IF NOT EXISTS public.user_prefs (
    user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    chart_period   TEXT,
    chart_interval TEXT,
    theme          TEXT,
    trade_mode     TEXT,
    extra          JSONB DEFAULT '{}'::jsonb,
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.user_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own prefs" ON public.user_prefs;
CREATE POLICY "own prefs" ON public.user_prefs
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 3) 기존 테이블에 user_id 추가 (nullable — 익명 endpoint 사용자와 공존)
ALTER TABLE public.price_alerts       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 4) 인덱스
CREATE INDEX IF NOT EXISTS idx_user_favs_user      ON public.user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_user   ON public.price_alerts(user_id)        WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_push_subs_user      ON public.push_subscriptions(user_id)  WHERE user_id IS NOT NULL;

-- 5) anon/authenticated 권한 회수 — 서버는 service_role 로 동작 (004_enable_rls.sql 패턴 유지)
REVOKE ALL ON public.user_favorites, public.user_prefs FROM anon, authenticated;
