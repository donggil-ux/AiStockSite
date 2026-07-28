-- 가상매매에 토스증권 실제 수수료 체계 반영 (거래대금 0.1%, $10 미만 주문 무료)
-- 나중에 체결 내역 상세표시에서 수수료를 보여줄 수 있도록 체결(fill) 단위로 저장
ALTER TABLE paper_fills ADD COLUMN fee REAL DEFAULT 0;
