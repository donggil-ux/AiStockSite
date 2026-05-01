-- ──────────────────────────────────────────────
-- 분산 Rate Limiter 용 테이블
-- Supabase Studio → SQL Editor 에서 1회 실행
-- ──────────────────────────────────────────────

create table if not exists public.rate_limits (
    ip            text        not null,
    key           text        not null,
    last_call_ts  timestamptz not null default now(),
    primary key (ip, key)
);

create index if not exists rate_limits_last_call_idx
    on public.rate_limits (last_call_ts);

-- ──────────────────────────────────────────────
-- RLS (Row Level Security) — 보안 옵션
-- ──────────────────────────────────────────────

-- 옵션 A (권장 — 간단): RLS 비활성화
-- 서버만 이 테이블을 사용하므로 RLS 불필요. 다만 anon key 가 노출되어 있다면
-- 악의적 사용자가 Supabase REST API 로 직접 INSERT/DELETE 시도 가능 (cost-benefit 기준 OK).
alter table public.rate_limits disable row level security;

-- 옵션 B (보안 강화 — 선택): RLS 활성화 + 서버는 service_role 사용
-- 이 경우 .env 에 SUPABASE_SERVICE_ROLE_KEY 추가 후 server.js 의 getSupabase() 가
-- service role 키를 쓰도록 수정 필요. anon key 클라이언트는 이 테이블 접근 차단.
-- alter table public.rate_limits enable row level security;
-- (정책 추가 안 함 → anon 접근 자동 거부)

-- ──────────────────────────────────────────────
-- 만료 항목 자동 정리 (선택 — Supabase pg_cron 확장 필요)
-- ──────────────────────────────────────────────
-- 24시간 이상 된 rate-limit 행 자동 삭제 (pg_cron 미사용 시 수동 실행해도 무방)
-- delete from public.rate_limits where last_call_ts < now() - interval '24 hours';
