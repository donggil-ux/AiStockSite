-- 가상매매 자본 풀 분리 — 단타(day)와 스윙(swing)이 서로 다른 잔고를 씀.
-- 사용자 지시: 3천만원은 단타 전용, 나머지는 중단기 스윙 전용.
-- balance 컬럼은 하위 호환을 위해 day_balance+swing_balance 합계로 계속 유지.
ALTER TABLE paper_account ADD COLUMN day_balance REAL DEFAULT 0;
ALTER TABLE paper_account ADD COLUMN day_position_size REAL DEFAULT 10000;
ALTER TABLE paper_account ADD COLUMN swing_balance REAL DEFAULT 0;
ALTER TABLE paper_account ADD COLUMN swing_position_size REAL DEFAULT 23000;
