-- 0016_blocklist_expiry.sql — 매매 금지 목록에 만료 시각 추가 (기간제 금지 지원)
-- NULL이면 기존처럼 영구 금지, 값이 있으면 그 시각 이후 자동 해제.
ALTER TABLE paper_blocklist ADD COLUMN expires_at INTEGER;
