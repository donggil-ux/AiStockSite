-- 0017_seed_amount.sql — 계좌 리셋 시 기준이 되는 시드금액을 실제로 저장
-- 기존엔 텔레그램 '현황' 명령에서 시드를 $100,000으로 하드코딩해서, 리셋으로 시드가
-- 바뀌어도 표시/수익률 계산이 예전 값 기준으로 남아있는 문제가 있었음.
ALTER TABLE paper_account ADD COLUMN seed_amount REAL;
