'use client';

// 상세 페이지 탭 + 종목 리스트 + 팝오버 인터랙션
import { useMemo, useState } from 'react';
import { PortfolioSummary } from './PortfolioSummary';
import { StockPositionCard } from './StockPositionCard';
import { StatusBadge } from './StatusBadge';
import { formatUSD, formatShares } from '@/lib/format';
import type { GuruDetail, PositionItem } from '@/types/guru';

type TabKey = 'all' | 'buy' | 'sell';

interface GuruDetailClientProps {
  detail: GuruDetail;
}

export const GuruDetailClient = ({ detail }: GuruDetailClientProps) => {
  const [tab, setTab] = useState<TabKey>('all');
  const [selectedQuarter, setSelectedQuarter] = useState<string>(
    detail.latestQuarter ?? ''
  );
  const [selected, setSelected] = useState<PositionItem | null>(null);

  const portfolio = detail.latestPortfolio;

  const filtered: PositionItem[] = useMemo(() => {
    if (!portfolio) return [];
    switch (tab) {
      case 'buy':
        return portfolio.positions.filter((p) => p.action === 'NEW' || p.action === 'ADD');
      case 'sell':
        return portfolio.positions.filter(
          (p) => p.action === 'REDUCE' || p.action === 'SOLD'
        );
      default:
        return portfolio.positions;
    }
  }, [portfolio, tab]);

  const tabCounts = useMemo(() => {
    if (!portfolio) return { all: 0, buy: 0, sell: 0 };
    return {
      all: portfolio.positions.length,
      buy: portfolio.positions.filter(
        (p) => p.action === 'NEW' || p.action === 'ADD'
      ).length,
      sell: portfolio.positions.filter(
        (p) => p.action === 'REDUCE' || p.action === 'SOLD'
      ).length,
    };
  }, [portfolio]);

  if (!portfolio) {
    return (
      <div className="py-20 text-center text-zinc-500">
        ⚠️ 이 Guru의 포트폴리오 데이터가 아직 크롤링되지 않았습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 포트폴리오 요약 (도넛 + 통계) */}
      <PortfolioSummary snapshot={portfolio} />

      {/* 탭 + 분기 선택 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-zinc-800">
        <div role="tablist" aria-label="포트폴리오 탭" className="flex gap-1">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')} count={tabCounts.all}>
            포트폴리오
          </TabButton>
          <TabButton active={tab === 'buy'} onClick={() => setTab('buy')} count={tabCounts.buy}>
            📈 매수
          </TabButton>
          <TabButton active={tab === 'sell'} onClick={() => setTab('sell')} count={tabCounts.sell}>
            📉 매도
          </TabButton>
        </div>

        <select
          value={selectedQuarter}
          onChange={(e) => {
            setSelectedQuarter(e.target.value);
            // 분기 변경: URL param 업데이트 → 서버 재호출 (단순 구현: window.location)
            const u = new URL(window.location.href);
            u.searchParams.set('quarter', e.target.value);
            window.location.assign(u.toString());
          }}
          className="px-3 py-1.5 rounded-lg bg-[#161B22] border border-zinc-800 text-xs text-zinc-100
                     font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          aria-label="분기 선택"
        >
          {detail.quarters.map((q) => (
            <option key={q.quarter} value={q.quarter}>
              {q.quarter} · {q.filingDate}
            </option>
          ))}
        </select>
      </div>

      {/* 포지션 리스트 */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-zinc-500">
          해당 탭에 포지션이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((p, i) => (
            <StockPositionCard
              key={p.id}
              rank={i + 1}
              position={p}
              onClick={setSelected}
            />
          ))}
        </div>
      )}

      {/* 종목 클릭 팝오버 (간단 모달) */}
      {selected && (
        <StockDetailPopover
          position={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};

// ────────────────────────────────────────────
// 탭 버튼
// ────────────────────────────────────────────
interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}

const TabButton = ({ active, onClick, count, children }: TabButtonProps) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${
      active
        ? 'text-zinc-100 border-b-2 border-blue-500 -mb-px'
        : 'text-zinc-500 hover:text-zinc-300'
    }`}
  >
    {children}
    <span
      className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${
        active ? 'bg-blue-500/20 text-blue-300' : 'bg-zinc-800 text-zinc-400'
      }`}
    >
      {count}
    </span>
  </button>
);

// ────────────────────────────────────────────
// 종목 상세 팝오버 (간단 모달 구현)
// ────────────────────────────────────────────
interface StockDetailPopoverProps {
  position: PositionItem;
  onClose: () => void;
}

const StockDetailPopover = ({ position, onClose }: StockDetailPopoverProps) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="position-popover-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                 bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-[#161B22] border border-zinc-800 rounded-t-2xl sm:rounded-2xl
                   p-5 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3
              id="position-popover-title"
              className="text-lg font-bold font-mono text-zinc-100"
            >
              {position.ticker ?? '—'}
            </h3>
            <p className="text-xs text-zinc-500 truncate">{position.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl leading-none"
            aria-label="닫기"
          >
            ✕
          </button>
        </header>

        <div className="flex items-center gap-2 mb-4">
          <StatusBadge action={position.action} />
          <span className="text-2xl font-bold font-mono text-zinc-100 tabular-nums">
            {position.weight.toFixed(2)}%
          </span>
          {position.weightDelta !== 0 && (
            <span
              className={`text-xs font-mono tabular-nums ${
                position.weightDelta > 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {position.weightDelta > 0 ? '▲' : '▼'}{' '}
              {Math.abs(position.weightDelta).toFixed(1)}%p
            </span>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs font-mono mb-4">
          <div>
            <dt className="text-[10px] text-zinc-500 uppercase">Value</dt>
            <dd className="text-zinc-200 text-sm tabular-nums">
              {formatUSD(position.valueUsd)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-zinc-500 uppercase">Shares</dt>
            <dd className="text-zinc-200 text-sm tabular-nums">
              {formatShares(position.shares)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-zinc-500 uppercase">Avg Entry</dt>
            <dd className="text-zinc-400 text-sm tabular-nums">
              {position.avgEntryEst != null
                ? `$${position.avgEntryEst.toFixed(2)}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-zinc-500 uppercase">Since</dt>
            <dd className="text-zinc-400 text-sm">{position.heldSince ?? '—'}</dd>
          </div>
        </dl>

        {position.ticker && (
          <a
            href={`/stocks/${position.ticker}`}
            className="block w-full text-center py-2.5 rounded-lg
                       bg-blue-500/20 border border-blue-500/40 text-blue-200 text-sm font-semibold
                       hover:bg-blue-500/30 transition-colors"
          >
            📊 전체 차트 보러가기 →
          </a>
        )}
      </div>
    </div>
  );
};
