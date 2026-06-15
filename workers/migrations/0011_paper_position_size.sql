-- 가상 매매 전략 업데이트: 종목당 투자금 $10,000 으로 상향 (5분할 × $2,000)
UPDATE paper_account SET position_size = 10000.0 WHERE position_size < 10000.0;
