// Guru Portfolio 공용 타입
// API 응답/UI 컴포넌트가 공유하는 DTO

export type PositionAction = 'NEW' | 'ADD' | 'REDUCE' | 'HOLD' | 'SOLD';

export interface GuruListItem {
  id: string;
  cik: string;
  name: string;
  manager: string | null;
  emoji: string;
  tags: string[];
  aumUsd: number | null;        // BigInt → number (서버에서 toString or Number 변환)
  lastFiledAt: string | null;   // ISO date
  latestQuarter: string | null;
  top3: Array<{ ticker: string; weight: number }>;
}

export interface GuruDetail extends GuruListItem {
  bio: string | null;
  foundedYear: number | null;
  quarters: Array<{
    quarter: string;
    filingDate: string;
    totalValue: number;
    positionCnt: number;
    newCnt: number;
    soldCnt: number;
  }>;
  latestPortfolio: PortfolioSnapshot | null;
}

export interface PortfolioSnapshot {
  quarter: string;
  filingDate: string;
  totalValue: number;
  positionCnt: number;
  newCnt: number;
  soldCnt: number;
  positions: PositionItem[];
  sectorBreakdown: SectorSlice[];
}

export interface PositionItem {
  id: string;
  ticker: string | null;
  name: string;
  sector: string | null;
  shares: number;
  valueUsd: number;
  weight: number;
  weightDelta: number;          // pp vs prev quarter
  action: PositionAction;
  prevShares: number | null;
  avgEntryEst: number | null;
  sparkline: number[];          // 최대 8Q weight history
  heldSince: string | null;     // '2016 Q1'
}

export interface SectorSlice {
  label: string;
  value: number;  // % of portfolio
  color: string;
}

export interface StockHolder {
  guruId: string;
  cik: string;
  name: string;
  manager: string | null;
  emoji: string;
  weight: number;
  valueUsd: number;
  shares: number;
  action: PositionAction;
  quarter: string;
}

export interface HistoryItem {
  quarter: string;
  filingDate: string;
  totalValue: number;
  positionCnt: number;
  topHolding: { ticker: string | null; weight: number } | null;
}
