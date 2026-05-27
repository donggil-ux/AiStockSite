# StockAI Workers — Cloudflare 백엔드

Vercel 정적 호스팅 + Cloudflare Workers 하이브리드 백엔드.
**MVP 범위**: 차트 데이터 프록시 + 푸시 알림 + Cron (가격 알림 / 실적 리마인더)

AI 분석 (`/api/catalyst/ai-analyze` 등) 은 Vercel 에 남겨둠.

---

## 📋 사전 준비

1. Cloudflare 계정 (https://dash.cloudflare.com/sign-up — 무료)
2. Node.js + npm
3. Wrangler CLI:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

---

## 🚀 배포 절차

### 1. KV 네임스페이스 생성 (Yahoo crumb 캐시)

```bash
cd workers
wrangler kv:namespace create CACHE
```

출력된 `id="..."` 값을 `wrangler.toml` 의 `[[kv_namespaces]]` 에 붙여넣기:
```toml
[[kv_namespaces]]
binding = "CACHE"
id = "여기에_KV_ID_붙여넣기"
```

### 2. D1 데이터베이스 생성 + 스키마 적용

```bash
wrangler d1 create stockai-db
```

출력된 `database_id="..."` 값을 `wrangler.toml` 의 `[[d1_databases]]` 에 붙여넣기:
```toml
[[d1_databases]]
binding = "DB"
database_name = "stockai-db"
database_id = "여기에_D1_ID_붙여넣기"
```

스키마 적용:
```bash
wrangler d1 execute stockai-db --remote --file=./schema.sql
```

### 3. 시크릿 설정

기존 Vercel 환경변수에서 복사:

```bash
# VAPID 키 (현재 index.html 의 VAPID_PUBLIC_KEY 와 짝)
wrangler secret put VAPID_PUBLIC_KEY
# → BC1xd7ln0Ib3Kr430J3W0dI2dBZPh9dL-YhwcZVhCdlAcRVpOeleeU66gULQ01BTmqWGGwy7HFCA_gAfRvdyb8U

wrangler secret put VAPID_PRIVATE_KEY
# → (Vercel 환경변수 또는 기존 발급된 값)

wrangler secret put VAPID_SUBJECT
# → mailto:rkd687@gmail.com

# Polygon API (선택, 미국 분봉용)
wrangler secret put POLYGON_API
```

### 4. 배포

```bash
wrangler deploy
```

배포되면 `https://stockai-api.<your-subdomain>.workers.dev` 같은 URL 제공.

### 5. 프론트엔드 연결

`index.html` / `js/app.js` 에서 API base URL 을 환경에 따라 분기:

```javascript
const API_BASE = location.hostname === 'localhost'
    ? '' // 로컬은 Express 그대로
    : 'https://stockai-api.<your-subdomain>.workers.dev'; // 프로덕션

// 푸시 구독 호출 변경
fetch(`${API_BASE}/api/push/subscribe`, ...)
fetch(`${API_BASE}/api/chart/${symbol}?...`)
```

---

## 🧪 로컬 개발

```bash
cd workers
npm install
wrangler dev          # http://localhost:8787 에서 실행
```

`schema.sql` 을 로컬 D1 에 적용하려면:
```bash
wrangler d1 execute stockai-db --local --file=./schema.sql
```

---

## 📊 모니터링

```bash
wrangler tail         # 실시간 로그 스트리밍
```

대시보드: https://dash.cloudflare.com → Workers & Pages → stockai-api

---

## 🗂️ 디렉토리 구조

```
workers/
├── wrangler.toml         # Cloudflare 설정 (KV/D1/Cron)
├── package.json          # 의존성 + 스크립트
├── schema.sql            # D1 스키마
├── README.md             # 이 파일
└── src/
    ├── index.js          # 메인 fetch + scheduled 핸들러
    ├── cron.js           # 5분/일별 cron 작업
    ├── routes/
    │   ├── yahoo.js      # /api/chart, /api/quote, /api/price 등
    │   ├── polygon.js    # /api/polygon/candles
    │   └── push.js       # /api/push/subscribe, /api/push/price-alert
    └── utils/
        ├── crumb.js      # Yahoo Finance crumb 인증 + 캐시
        ├── vapid.js      # Web Push (RFC 8291 aes128gcm) 직접 구현
        └── validators.js # 입력 검증 + json/err 헬퍼
```

---

## ⚠️ 알려진 제약 + 다음 단계

- **무료 한도**: 100K req/일, 함수 30초 (StockAI 트래픽엔 충분)
- **AI 분석 라우트**: Anthropic SDK 호출은 Vercel 에 남겨둠 (2단계에서 이전 고려)
- **Yahoo crumb 가끔 만료**: KV 1시간 TTL 자동 재발급. 만료 시 401/403/604 자동 재시도 로직 있음
- **WebSocket**: 현재 클라이언트가 직접 Alpaca 연결 — 백엔드 영향 없음

---

## 💡 디버깅

```bash
# 로컬에서 cron 강제 실행
wrangler dev --test-scheduled
curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'

# D1 쿼리
wrangler d1 execute stockai-db --remote --command "SELECT * FROM push_subscribers LIMIT 5"

# KV 조회
wrangler kv:key get --binding=CACHE "yf:crumb"
```
