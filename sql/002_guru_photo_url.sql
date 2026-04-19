-- ============================================================
-- Guru 인물 사진 컬럼 + URL 주입
-- Supabase SQL Editor에서 실행 (Run without RLS)
-- ============================================================

ALTER TABLE guru ADD COLUMN IF NOT EXISTS photo_url text;

-- 위키피디아 Commons (upload.wikimedia.org) — 8명 검증 완료 (HTTP 200, image/jpeg)
-- null 값은 이모지 폴백 자동 적용
UPDATE guru SET photo_url = CASE cik
  WHEN '0001067983' THEN 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_%28cropped%29.jpg/330px-Warren_Buffett_at_the_2015_SelectUSA_Investment_Summit_%28cropped%29.jpg'
  WHEN '0001336528' THEN 'https://upload.wikimedia.org/wikipedia/commons/0/07/Valeant_Pharmaceuticals%27_Business_Model_%28headshot%29.jpg'
  WHEN '0001350694' THEN 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Web_Summit_2018_-_Forum_-_Day_2%2C_November_7_HM1_7481_%2844858045925%29.jpg/330px-Web_Summit_2018_-_Forum_-_Day_2%2C_November_7_HM1_7481_%2844858045925%29.jpg'
  WHEN '0001656456' THEN 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/David_Tepper_01.jpg/330px-David_Tepper_01.jpg'
  WHEN '0001029160' THEN 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/George_Soros%2C_Founder_and_Chairman_of_the_Open_Society_Foundations%2C_visits_the_EC_%283x4_cropped%29.jpg/330px-George_Soros%2C_Founder_and_Chairman_of_the_Open_Society_Foundations%2C_visits_the_EC_%283x4_cropped%29.jpg'
  WHEN '0001061165' THEN 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Seth_Klarman_at_147th_Preakness_Stakes.jpg/330px-Seth_Klarman_at_147th_Preakness_Stakes.jpg'
  WHEN '0001079114' THEN 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/David_Einhorn.jpg/320px-David_Einhorn.jpg'
  WHEN '0000921669' THEN 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Carl_Icahn%2C_1980s.jpg/330px-Carl_Icahn%2C_1980s.jpg'
  ELSE photo_url
END;

-- 확인
SELECT cik, name, manager,
       CASE WHEN photo_url IS NULL THEN '—' ELSE '✅' END AS photo
FROM guru
ORDER BY aum_usd DESC NULLS LAST;
