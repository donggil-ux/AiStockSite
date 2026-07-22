-- 섹터 히트맵 "시간외 거래 포함" 토글용 — 프리/포스트마켓 반영 등락률
ALTER TABLE stock_heatmap ADD COLUMN ext_change_pct REAL;
