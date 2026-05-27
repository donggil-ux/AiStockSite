-- 0001: push_subscribers 에 notif_prefs (JSON) + market_filter 컬럼 추가
--   notif_prefs: 사용자의 알림 종류 선호 ({buy:1,tp:1,stop:1,pos:1})
--   market_filter: 'US' | 'KR' | 'ALL' — 어떤 시장의 시그널을 받을지

ALTER TABLE push_subscribers ADD COLUMN notif_prefs TEXT DEFAULT '{"buy":1,"tp":1,"stop":1,"pos":1}';
ALTER TABLE push_subscribers ADD COLUMN market_filter TEXT DEFAULT 'ALL';
