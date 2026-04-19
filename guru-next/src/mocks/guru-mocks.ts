// Guru Portfolio Mock Data
// Warren Buffett / Ray Dalio / Cathie Wood 3명 기준
// API 연동 전 개발용. DB가 비어있을 때 폴백으로도 사용됨.

import type {
  GuruListItem,
  GuruDetail,
  HistoryItem,
  StockHolder,
  PositionItem,
  SectorSlice,
} from '@/types/guru';

// ────────────────────────────────────────────
// 목록용
// ────────────────────────────────────────────
export const MOCK_GURUS_LIST: GuruListItem[] = [
  {
    id: 'guru_buffett',
    cik: '0001067983',
    name: 'Berkshire Hathaway',
    manager: 'Warren Buffett',
    emoji: '🧓',
    tags: ['value', 'long-term'],
    aumUsd: 307_000_000_000,
    lastFiledAt: '2026-02-14',
    latestQuarter: '2025Q4',
    top3: [
      { ticker: 'AAPL', weight: 25.4 },
      { ticker: 'BAC', weight: 12.1 },
      { ticker: 'KO', weight: 9.0 },
    ],
  },
  {
    id: 'guru_dalio',
    cik: '0001350694',
    name: 'Bridgewater Associates',
    manager: 'Ray Dalio',
    emoji: '🌊',
    tags: ['macro', 'all-weather'],
    aumUsd: 16_800_000_000,
    lastFiledAt: '2026-02-13',
    latestQuarter: '2025Q4',
    top3: [
      { ticker: 'SPY', weight: 8.2 },
      { ticker: 'IEMG', weight: 6.5 },
      { ticker: 'GLD', weight: 5.8 },
    ],
  },
  {
    id: 'guru_wood',
    cik: '0001697748',
    name: 'ARK Investment Management',
    manager: 'Cathie Wood',
    emoji: '🚀',
    tags: ['growth', 'innovation', 'tech'],
    aumUsd: 14_200_000_000,
    lastFiledAt: '2026-02-14',
    latestQuarter: '2025Q4',
    top3: [
      { ticker: 'TSLA', weight: 11.8 },
      { ticker: 'COIN', weight: 8.3 },
      { ticker: 'ROKU', weight: 6.1 },
    ],
  },
];

// ────────────────────────────────────────────
// 상세용 — Position 팩토리
// ────────────────────────────────────────────
const mkPos = (p: Partial<PositionItem> & { ticker: string; name: string; weight: number }): PositionItem => ({
  id: `pos_${p.ticker}`,
  ticker: p.ticker,
  name: p.name,
  sector: p.sector ?? 'Technology',
  shares: p.shares ?? Math.floor(p.weight * 1_000_000),
  valueUsd: p.valueUsd ?? Math.floor(p.weight * 1_000_000_000),
  weight: p.weight,
  weightDelta: p.weightDelta ?? 0,
  action: p.action ?? 'HOLD',
  prevShares: p.prevShares ?? null,
  avgEntryEst: p.avgEntryEst ?? null,
  sparkline: p.sparkline ?? [p.weight * 0.6, p.weight * 0.8, p.weight * 0.9, p.weight * 0.95, p.weight],
  heldSince: p.heldSince ?? null,
});

const BUFFETT_SECTORS: SectorSlice[] = [
  { label: 'Technology', value: 42.1, color: '#3B82F6' },
  { label: 'Financial', value: 28.4, color: '#6366F1' },
  { label: 'Consumer', value: 14.9, color: '#8B5CF6' },
  { label: 'Energy', value: 8.2, color: '#F59E0B' },
  { label: 'Healthcare', value: 3.6, color: '#EC4899' },
  { label: 'Other', value: 2.8, color: '#71717A' },
];

const DALIO_SECTORS: SectorSlice[] = [
  { label: 'ETF/Index', value: 35.1, color: '#6366F1' },
  { label: 'Consumer', value: 21.4, color: '#8B5CF6' },
  { label: 'Healthcare', value: 14.2, color: '#EC4899' },
  { label: 'Technology', value: 12.8, color: '#3B82F6' },
  { label: 'Industrial', value: 9.3, color: '#10B981' },
  { label: 'Other', value: 7.2, color: '#71717A' },
];

const WOOD_SECTORS: SectorSlice[] = [
  { label: 'Technology', value: 58.3, color: '#3B82F6' },
  { label: 'Communication', value: 14.7, color: '#EF4444' },
  { label: 'Healthcare', value: 12.4, color: '#EC4899' },
  { label: 'Financial', value: 8.1, color: '#6366F1' },
  { label: 'Consumer', value: 4.9, color: '#8B5CF6' },
  { label: 'Other', value: 1.6, color: '#71717A' },
];

// ────────────────────────────────────────────
// Guru 상세
// ────────────────────────────────────────────
export const MOCK_GURU_DETAILS: Record<string, GuruDetail> = {
  guru_buffett: {
    id: 'guru_buffett',
    cik: '0001067983',
    name: 'Berkshire Hathaway',
    manager: 'Warren Buffett',
    emoji: '🧓',
    bio: '오마하의 현인. 가치투자의 대명사.',
    foundedYear: 1967,
    tags: ['value', 'long-term'],
    aumUsd: 307_000_000_000,
    lastFiledAt: '2026-02-14',
    latestQuarter: '2025Q4',
    top3: [],
    quarters: [
      { quarter: '2025Q4', filingDate: '2026-02-14', totalValue: 307_000_000_000, positionCnt: 47, newCnt: 3, soldCnt: 2 },
      { quarter: '2025Q3', filingDate: '2025-11-14', totalValue: 299_000_000_000, positionCnt: 46, newCnt: 1, soldCnt: 3 },
      { quarter: '2025Q2', filingDate: '2025-08-14', totalValue: 291_000_000_000, positionCnt: 48, newCnt: 2, soldCnt: 1 },
      { quarter: '2025Q1', filingDate: '2025-05-15', totalValue: 285_000_000_000, positionCnt: 47, newCnt: 0, soldCnt: 2 },
    ],
    latestPortfolio: {
      quarter: '2025Q4',
      filingDate: '2026-02-14',
      totalValue: 307_000_000_000,
      positionCnt: 47,
      newCnt: 3,
      soldCnt: 2,
      sectorBreakdown: BUFFETT_SECTORS,
      positions: [
        mkPos({ ticker: 'AAPL', name: 'Apple Inc.', weight: 25.41, weightDelta: 0.8, action: 'HOLD', sector: 'Technology', shares: 905_560_000, valueUsd: 187_200_000_000, avgEntryEst: 142.5, heldSince: '2016 Q1', sparkline: [4.1, 8.3, 14.2, 19.8, 22.1, 24.3, 24.6, 25.4] }),
        mkPos({ ticker: 'BAC', name: 'Bank of America Corp.', weight: 12.13, weightDelta: -0.4, action: 'REDUCE', sector: 'Financial', shares: 1_032_800_000, valueUsd: 37_200_000_000, avgEntryEst: 24.3, heldSince: '2017 Q3', sparkline: [13.2, 13.5, 13.1, 12.9, 12.8, 12.5, 12.5, 12.1] }),
        mkPos({ ticker: 'AXP', name: 'American Express Company', weight: 10.35, weightDelta: 0.2, action: 'HOLD', sector: 'Financial', shares: 151_610_000, valueUsd: 31_800_000_000, avgEntryEst: 78.9, heldSince: '1998 Q4', sparkline: [9.8, 9.9, 10.0, 10.1, 10.2, 10.2, 10.2, 10.4] }),
        mkPos({ ticker: 'KO', name: 'The Coca-Cola Company', weight: 9.02, weightDelta: 0.1, action: 'HOLD', sector: 'Consumer', shares: 400_000_000, valueUsd: 27_700_000_000, avgEntryEst: 6.5, heldSince: '1988 Q1', sparkline: [8.9, 8.9, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0] }),
        mkPos({ ticker: 'CVX', name: 'Chevron Corporation', weight: 6.82, weightDelta: 0.5, action: 'ADD', sector: 'Energy', shares: 126_900_000, valueUsd: 20_900_000_000, avgEntryEst: 119.5, heldSince: '2020 Q3', sparkline: [5.8, 6.0, 6.1, 6.2, 6.3, 6.5, 6.6, 6.8] }),
        mkPos({ ticker: 'OXY', name: 'Occidental Petroleum Corp.', weight: 4.91, weightDelta: 1.2, action: 'ADD', sector: 'Energy', shares: 244_900_000, valueUsd: 15_100_000_000, avgEntryEst: 54.2, heldSince: '2022 Q1', sparkline: [2.1, 2.8, 3.2, 3.5, 3.8, 4.1, 4.5, 4.9] }),
        mkPos({ ticker: 'KHC', name: 'The Kraft Heinz Company', weight: 3.24, weightDelta: 0, action: 'HOLD', sector: 'Consumer', shares: 325_600_000, valueUsd: 9_950_000_000, sparkline: [3.3, 3.3, 3.3, 3.2, 3.2, 3.2, 3.2, 3.2] }),
        mkPos({ ticker: 'MCO', name: "Moody's Corporation", weight: 2.84, weightDelta: 0.1, action: 'HOLD', sector: 'Financial', shares: 24_670_000, valueUsd: 8_720_000_000, sparkline: [2.6, 2.7, 2.7, 2.8, 2.8, 2.8, 2.8, 2.8] }),
        mkPos({ ticker: 'DVA', name: 'DaVita Inc.', weight: 1.42, weightDelta: 1.42, action: 'NEW', sector: 'Healthcare', shares: 36_100_000, valueUsd: 4_360_000_000, sparkline: [0, 0, 0, 0, 0, 0, 0, 1.42] }),
        mkPos({ ticker: 'VRSN', name: 'Verisign Inc.', weight: 0.76, weightDelta: -2.4, action: 'REDUCE', sector: 'Technology', shares: 11_440_000, valueUsd: 2_330_000_000, sparkline: [3.2, 3.1, 3.0, 2.8, 2.5, 2.0, 1.3, 0.76] }),
      ],
    },
  },

  guru_dalio: {
    id: 'guru_dalio',
    cik: '0001350694',
    name: 'Bridgewater Associates',
    manager: 'Ray Dalio',
    emoji: '🌊',
    bio: '세계 최대 헤지펀드. 매크로 & 리스크 패리티.',
    foundedYear: 1975,
    tags: ['macro', 'all-weather'],
    aumUsd: 16_800_000_000,
    lastFiledAt: '2026-02-13',
    latestQuarter: '2025Q4',
    top3: [],
    quarters: [
      { quarter: '2025Q4', filingDate: '2026-02-13', totalValue: 16_800_000_000, positionCnt: 720, newCnt: 48, soldCnt: 52 },
      { quarter: '2025Q3', filingDate: '2025-11-13', totalValue: 16_200_000_000, positionCnt: 724, newCnt: 41, soldCnt: 38 },
      { quarter: '2025Q2', filingDate: '2025-08-13', totalValue: 15_500_000_000, positionCnt: 721, newCnt: 35, soldCnt: 44 },
    ],
    latestPortfolio: {
      quarter: '2025Q4',
      filingDate: '2026-02-13',
      totalValue: 16_800_000_000,
      positionCnt: 720,
      newCnt: 48,
      soldCnt: 52,
      sectorBreakdown: DALIO_SECTORS,
      positions: [
        mkPos({ ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', weight: 8.24, weightDelta: 0.3, action: 'HOLD', sector: 'ETF/Index', sparkline: [7.8, 7.9, 8.0, 8.0, 8.1, 8.2, 8.2, 8.2] }),
        mkPos({ ticker: 'IEMG', name: 'iShares Core MSCI EM ETF', weight: 6.51, weightDelta: 1.2, action: 'ADD', sector: 'ETF/Index', sparkline: [4.2, 4.8, 5.1, 5.5, 5.8, 6.0, 6.3, 6.5] }),
        mkPos({ ticker: 'GLD', name: 'SPDR Gold Shares', weight: 5.82, weightDelta: 0.8, action: 'ADD', sector: 'ETF/Index', sparkline: [4.1, 4.5, 4.9, 5.2, 5.4, 5.6, 5.7, 5.8] }),
        mkPos({ ticker: 'PG', name: 'Procter & Gamble Company', weight: 4.15, weightDelta: -0.2, action: 'HOLD', sector: 'Consumer', sparkline: [4.3, 4.3, 4.2, 4.3, 4.2, 4.3, 4.2, 4.1] }),
        mkPos({ ticker: 'KO', name: 'The Coca-Cola Company', weight: 3.82, weightDelta: 0.1, action: 'HOLD', sector: 'Consumer', sparkline: [3.7, 3.7, 3.8, 3.8, 3.8, 3.8, 3.8, 3.8] }),
        mkPos({ ticker: 'WMT', name: 'Walmart Inc.', weight: 3.21, weightDelta: 3.21, action: 'NEW', sector: 'Consumer', sparkline: [0, 0, 0, 0, 0, 0, 0, 3.21] }),
        mkPos({ ticker: 'JNJ', name: 'Johnson & Johnson', weight: 2.91, weightDelta: -1.1, action: 'REDUCE', sector: 'Healthcare', sparkline: [4.0, 4.0, 3.9, 3.8, 3.5, 3.3, 3.0, 2.9] }),
        mkPos({ ticker: 'NVDA', name: 'NVIDIA Corporation', weight: 2.15, weightDelta: 0.4, action: 'ADD', sector: 'Technology', sparkline: [0.8, 1.1, 1.4, 1.6, 1.8, 1.9, 2.0, 2.15] }),
      ],
    },
  },

  guru_wood: {
    id: 'guru_wood',
    cik: '0001697748',
    name: 'ARK Investment Management',
    manager: 'Cathie Wood',
    emoji: '🚀',
    bio: '파괴적 혁신 기업에 집중 투자. 테슬라 초기 투자자.',
    foundedYear: 2014,
    tags: ['growth', 'innovation', 'tech'],
    aumUsd: 14_200_000_000,
    lastFiledAt: '2026-02-14',
    latestQuarter: '2025Q4',
    top3: [],
    quarters: [
      { quarter: '2025Q4', filingDate: '2026-02-14', totalValue: 14_200_000_000, positionCnt: 62, newCnt: 5, soldCnt: 8 },
      { quarter: '2025Q3', filingDate: '2025-11-14', totalValue: 13_100_000_000, positionCnt: 65, newCnt: 3, soldCnt: 4 },
    ],
    latestPortfolio: {
      quarter: '2025Q4',
      filingDate: '2026-02-14',
      totalValue: 14_200_000_000,
      positionCnt: 62,
      newCnt: 5,
      soldCnt: 8,
      sectorBreakdown: WOOD_SECTORS,
      positions: [
        mkPos({ ticker: 'TSLA', name: 'Tesla Inc.', weight: 11.82, weightDelta: 2.1, action: 'ADD', sector: 'Consumer', sparkline: [6.2, 7.1, 8.3, 9.2, 9.8, 10.5, 11.0, 11.82] }),
        mkPos({ ticker: 'COIN', name: 'Coinbase Global Inc.', weight: 8.31, weightDelta: -1.2, action: 'REDUCE', sector: 'Financial', sparkline: [9.8, 10.1, 10.0, 9.8, 9.5, 9.2, 8.8, 8.31] }),
        mkPos({ ticker: 'ROKU', name: 'Roku Inc.', weight: 6.14, weightDelta: 0.3, action: 'HOLD', sector: 'Communication', sparkline: [5.8, 5.9, 5.9, 6.0, 6.0, 6.1, 6.1, 6.14] }),
        mkPos({ ticker: 'PATH', name: 'UiPath Inc.', weight: 4.72, weightDelta: 0.8, action: 'ADD', sector: 'Technology', sparkline: [3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.5, 4.72] }),
        mkPos({ ticker: 'DKNG', name: 'DraftKings Inc.', weight: 3.91, weightDelta: 3.91, action: 'NEW', sector: 'Consumer', sparkline: [0, 0, 0, 0, 0, 0, 0, 3.91] }),
        mkPos({ ticker: 'ZM', name: 'Zoom Communications Inc.', weight: 3.45, weightDelta: -2.1, action: 'REDUCE', sector: 'Communication', sparkline: [8.2, 7.5, 6.9, 6.1, 5.4, 4.8, 4.2, 3.45] }),
        mkPos({ ticker: 'RBLX', name: 'Roblox Corporation', weight: 3.12, weightDelta: 0.4, action: 'HOLD', sector: 'Communication', sparkline: [2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.12] }),
      ],
    },
  },
};

// ────────────────────────────────────────────
// 히스토리
// ────────────────────────────────────────────
export const MOCK_GURU_HISTORY: Record<string, HistoryItem[]> = {
  guru_buffett: [
    { quarter: '2024Q1', filingDate: '2024-05-15', totalValue: 271_000_000_000, positionCnt: 45, topHolding: { ticker: 'AAPL', weight: 40.8 } },
    { quarter: '2024Q2', filingDate: '2024-08-14', totalValue: 280_000_000_000, positionCnt: 44, topHolding: { ticker: 'AAPL', weight: 30.1 } },
    { quarter: '2024Q3', filingDate: '2024-11-14', totalValue: 266_000_000_000, positionCnt: 46, topHolding: { ticker: 'AAPL', weight: 26.2 } },
    { quarter: '2024Q4', filingDate: '2025-02-14', totalValue: 272_000_000_000, positionCnt: 46, topHolding: { ticker: 'AAPL', weight: 24.6 } },
    { quarter: '2025Q1', filingDate: '2025-05-15', totalValue: 285_000_000_000, positionCnt: 47, topHolding: { ticker: 'AAPL', weight: 24.9 } },
    { quarter: '2025Q2', filingDate: '2025-08-14', totalValue: 291_000_000_000, positionCnt: 48, topHolding: { ticker: 'AAPL', weight: 24.3 } },
    { quarter: '2025Q3', filingDate: '2025-11-14', totalValue: 299_000_000_000, positionCnt: 46, topHolding: { ticker: 'AAPL', weight: 24.6 } },
    { quarter: '2025Q4', filingDate: '2026-02-14', totalValue: 307_000_000_000, positionCnt: 47, topHolding: { ticker: 'AAPL', weight: 25.4 } },
  ],
};

// ────────────────────────────────────────────
// 종목 → 보유 Guru 역조회
// ────────────────────────────────────────────
export const MOCK_STOCK_HOLDERS: Record<string, StockHolder[]> = {
  AAPL: [
    {
      guruId: 'guru_buffett',
      cik: '0001067983',
      name: 'Berkshire Hathaway',
      manager: 'Warren Buffett',
      emoji: '🧓',
      weight: 25.4,
      valueUsd: 187_200_000_000,
      shares: 905_560_000,
      action: 'HOLD',
      quarter: '2025Q4',
    },
  ],
  TSLA: [
    {
      guruId: 'guru_wood',
      cik: '0001697748',
      name: 'ARK Investment Management',
      manager: 'Cathie Wood',
      emoji: '🚀',
      weight: 11.82,
      valueUsd: 1_678_000_000,
      shares: 6_820_000,
      action: 'ADD',
      quarter: '2025Q4',
    },
  ],
  KO: [
    {
      guruId: 'guru_buffett',
      cik: '0001067983',
      name: 'Berkshire Hathaway',
      manager: 'Warren Buffett',
      emoji: '🧓',
      weight: 9.02,
      valueUsd: 27_700_000_000,
      shares: 400_000_000,
      action: 'HOLD',
      quarter: '2025Q4',
    },
    {
      guruId: 'guru_dalio',
      cik: '0001350694',
      name: 'Bridgewater Associates',
      manager: 'Ray Dalio',
      emoji: '🌊',
      weight: 3.82,
      valueUsd: 641_000_000,
      shares: 9_265_000,
      action: 'HOLD',
      quarter: '2025Q4',
    },
  ],
};
