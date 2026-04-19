-- Guru Portfolio — 13F 기반 부자들의 포트폴리오
-- Run this in Supabase SQL Editor

-- ============================================================
-- 1. Guru 마스터
-- ============================================================
create table if not exists guru (
  cik            text primary key,        -- 10자리 0-padded, e.g. '0001067983'
  name           text not null,
  manager        text,
  emoji          text default '💎',
  tags           text[] default '{}',
  aum_usd        bigint,
  last_filed_at  date,
  created_at     timestamptz default now()
);

-- ============================================================
-- 2. 분기별 13F 파일링 메타
-- ============================================================
create table if not exists guru_quarter (
  cik         text not null references guru(cik) on delete cascade,
  quarter     text not null,              -- '2025Q4'
  filing_date date not null,
  accession   text not null,
  total_value bigint,
  primary key (cik, quarter)
);

-- ============================================================
-- 3. 분기별 보유 종목 스냅샷
-- ============================================================
create table if not exists guru_position (
  cik         text not null,
  quarter     text not null,              -- '2025Q4'
  cusip       text not null,
  ticker      text,                        -- nullable (OpenFIGI 미매핑 시)
  name        text,
  shares      bigint,
  value_usd   bigint,
  weight      numeric(7,3),                -- %, 0.000 ~ 100.000
  action      text,                        -- 'NEW'|'ADD'|'REDUCE'|'HOLD'|'SOLD'
  prev_shares bigint,
  primary key (cik, quarter, cusip),
  foreign key (cik, quarter) references guru_quarter(cik, quarter) on delete cascade
);

create index if not exists idx_guru_position_ticker_q on guru_position (ticker, quarter);
create index if not exists idx_guru_position_weight   on guru_position (cik, quarter, weight desc);

-- ============================================================
-- 4. CUSIP → Ticker 매핑 캐시 (OpenFIGI)
-- ============================================================
create table if not exists cusip_ticker (
  cusip      text primary key,
  ticker     text,
  name       text,
  exchange   text,
  updated_at timestamptz default now()
);

-- ============================================================
-- 5. 시드 Guru 15인
-- ============================================================
insert into guru (cik, name, manager, emoji, tags) values
  ('0001067983', 'Berkshire Hathaway',     'Warren Buffett',     '🧓', array['long-term','value']),
  ('0001649339', 'Scion Asset Management', 'Michael Burry',      '🔮', array['contrarian','short']),
  ('0001336528', 'Pershing Square',        'Bill Ackman',        '⚡', array['activist','concentrated']),
  ('0001350694', 'Bridgewater Associates', 'Ray Dalio',          '🌊', array['macro','all-weather']),
  ('0001656456', 'Appaloosa Management',   'David Tepper',       '🐎', array['distressed','value']),
  ('0001536411', 'Duquesne Family Office', 'Stan Druckenmiller', '🎯', array['macro','momentum']),
  ('0001029160', 'Soros Fund Management',  'George Soros',       '🦅', array['macro','reflexivity']),
  ('0001061165', 'Baupost Group',          'Seth Klarman',       '📚', array['value','margin-of-safety']),
  ('0001040273', 'Third Point',            'Dan Loeb',           '✉️', array['activist','event']),
  ('0001079114', 'Greenlight Capital',     'David Einhorn',      '💡', array['long-short','value']),
  ('0001167483', 'Tiger Global',           'Chase Coleman',      '🐯', array['growth','tech']),
  ('0001135730', 'Coatue Management',      'Philippe Laffont',   '🦁', array['tech','growth']),
  ('0000921669', 'Icahn Enterprises',      'Carl Icahn',         '🗡️', array['activist']),
  ('0000807985', 'Harris Associates',      'Bill Nygren',        '🏛️', array['value','long-term']),
  ('0001569205', 'Fundsmith',              'Terry Smith',        '🇬🇧', array['quality','long-term'])
on conflict (cik) do nothing;
