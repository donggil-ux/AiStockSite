-- 0007_discovery.sql — 디스커버리 알림 (즐겨찾기 외 당일 발굴 종목)
-- signal_history 출처 구분: 'favs'(즐겨찾기) | 'discovery'(자동 발굴)
ALTER TABLE signal_history ADD COLUMN source TEXT DEFAULT 'favs';

-- 기존 구독자 notif_prefs 에 discovery 토글 기본 ON 주입
-- (notif_prefs 가 비어있거나 discovery 키가 없는 경우만)
UPDATE push_subscribers
SET notif_prefs = json_set(
    COALESCE(NULLIF(notif_prefs, ''), '{"buy":1,"tp":1,"stop":1,"pos":1}'),
    '$.discovery', 1
)
WHERE notif_prefs IS NULL
   OR notif_prefs = ''
   OR json_extract(notif_prefs, '$.discovery') IS NULL;
