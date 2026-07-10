-- 0015_dt_signals_factors.sql — dt_signals에 세부 진입 지표 저장 (타점 정밀 분석용)
-- 기존엔 등급/점수만 남아서 "ADX 몇 이상이 실제로 잘 맞는지" 같은 세밀한 분석이 불가능했음.
-- ADX/RSI/거래량비율/ATR%를 신호 발생 시점 값으로 저장해, 승률·평균R과의 상관관계를 데이터로 검증 가능하게 함.
ALTER TABLE dt_signals ADD COLUMN adx      REAL;
ALTER TABLE dt_signals ADD COLUMN rsi      REAL;
ALTER TABLE dt_signals ADD COLUMN vol_ratio REAL;  -- RVOL (상대거래량)
ALTER TABLE dt_signals ADD COLUMN atr_pct  REAL;
