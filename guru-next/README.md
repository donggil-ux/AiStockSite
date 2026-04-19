# 💎 Guru Portfolio (Next.js 14 스캐폴드)

Warren Buffett, Ray Dalio, Cathie Wood 등 투자 대가들의 **SEC 13F 공시 기반 포트폴리오** 페이지.

## 스택
- Next.js 14 (App Router) · TypeScript (strict)
- Tailwind CSS
- Prisma + PostgreSQL
- Recharts (Donut · Sparkline)

## 시작하기

```bash
cd guru-next
npm install
cp .env.example .env.local   # DATABASE_URL 설정
npx prisma migrate dev --name init
npm run dev
```

DB가 비어있어도 **mock data로 폴백**되도록 설계되어 있어, 즉시 페이지 확인 가능합니다.
- `/guru-portfolio` — 목록 (Buffett · Dalio · Wood)
- `/guru-portfolio/guru_buffett` — 상세

## 폴더 구조

```
guru-next/
├── prisma/schema.prisma              # 데이터 모델
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── gurus/
│   │   │   │   ├── route.ts          # GET /api/gurus
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts      # GET /api/gurus/[id]
│   │   │   │       └── history/route.ts
│   │   │   └── stocks/[ticker]/holders/route.ts
│   │   ├── guru-portfolio/
│   │   │   ├── page.tsx              # 목록 페이지
│   │   │   └── [id]/page.tsx         # 상세 페이지
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/guru/
│   │   ├── GuruCard.tsx
│   │   ├── GuruNavBar.tsx
│   │   ├── GuruListClient.tsx
│   │   ├── GuruDetailClient.tsx
│   │   ├── PortfolioSummary.tsx      # Donut + Stats
│   │   ├── StockPositionCard.tsx
│   │   ├── StatusBadge.tsx
│   │   └── SparklineChart.tsx
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── format.ts                 # USD / Shares 포맷
│   │   └── serialize.ts              # BigInt → number
│   ├── mocks/guru-mocks.ts           # Buffett / Dalio / Wood 목 데이터
│   └── types/guru.ts
├── tailwind.config.ts
└── tsconfig.json
```

## API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/gurus` | Guru 목록 + 최신 분기 Top 3 |
| GET | `/api/gurus/[id]` | Guru 상세 (`?quarter=YYYYQn` 선택) |
| GET | `/api/gurus/[id]/history` | 분기별 히스토리 |
| GET | `/api/stocks/[ticker]/holders` | 해당 종목 보유 Guru 역조회 |

DB에 데이터가 없으면 **mock 데이터 폴백** — 개발/데모 환경에서 바로 동작합니다.

## 컴포넌트 사용 예

```tsx
import { GuruCard } from '@/components/guru/GuruCard';
import { StatusBadge } from '@/components/guru/StatusBadge';
import { SparklineChart } from '@/components/guru/SparklineChart';

<GuruCard guru={guruListItem} />
<StatusBadge action="NEW" />
<SparklineChart data={[2.1, 5.3, 8.0, 12.1, 18.4, 22.0, 24.6, 25.4]} />
```

## 디자인 토큰

| Token | Value |
|---|---|
| `bg-[#0D1117]` | 페이지 배경 |
| `bg-[#161B22]` | 카드 배경 |
| `bg-[#1C222B]` | hover 배경 |
| `#3B82F6` | 강조 (blue-500) |
| `#22C55E` | 상승 / ADD |
| `#EF4444` | 하락 / REDUCE / SOLD |

숫자는 항상 `font-mono tabular-nums` — 정렬/비교 가독성 우선.
