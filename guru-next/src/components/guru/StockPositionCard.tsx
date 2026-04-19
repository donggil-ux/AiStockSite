'use client';

// 종목 포지션 카드 — 데스크탑/모바일 반응형 + hover 인터랙션
import { StatusBadge } from './StatusBadge';
import { SparklineChart } from './SparklineChart';
import { formatUSD, formatShares } from '@/lib/format';
import type { PositionItem } from '@/types/guru';

interface StockPositionCardProps {
  rank: number;
  position: PositionItem;
  /** 클릭 시 종목 상세 팝오버 or 라우팅 */
  onClick?: (position: PositionItem) => void;
}

export const StockPositionCard = ({ rank, position, onClick }: StockPositionCardProps) => {
  const {
    ticker,
    name,
    weight,
    weightDelta,
    valueUsd,
    shares,
    avgEntryEst,
    heldSince,
    action,
    sparkline,
  } = position;

  const deltaPositive = weightDelta > 0;
  const deltaNegative = weightDelta < 0;
  const deltaColor = deltaPositive
    ? 'text-emerald-400'
    : deltaNegative
      ? 'text-rose-400'
      : 'text-zinc-500';
  const sparkColor = deltaPositive ? '#22C55E' : deltaNegative ? '#EF4444' : '#3B82F6';

  return (
    <button
      type="button"
      onClick={() => onClick?.(position)}
      className="w-full text-left group p-4 lg:p-5 rounded-xl lg:rounded-2xl
                 bg-[#161B22] border border-zinc-800
                 hover:bg-[#1C222B] hover:border-zinc-700
                 hover:shadow-lg hover:shadow-blue-500/5
                 active:scale-[0.998] transition-all duration-150
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
    >
      {/* Mobile: 세로 · Desktop(lg+): grid */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[48px_1fr_160px_220px] lg:gap-4 lg:items-center">
        {/* Rank (desktop only) */}
        <div className="hidden lg:block text-3xl font-light text-zinc-700 font-mono tabular-nums text-center">
          {String(rank).padStart(2, '0')}
        </div>

        {/* Primary: ticker / name / sparkline */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="lg:hidden text-xs font-mono text-zinc-600 tabular-nums">
              #{rank}
            </span>
            <span className="text-lg lg:text-xl font-bold text-zinc-100 font-mono tabular-nums">
              {ticker ?? '—'}
            </span>
            <StatusBadge action={action} />
            {/* Mobile: 비중 우측 */}
            <span className="lg:hidden ml-auto text-lg font-bold font-mono text-zinc-100 tabular-nums">
              {weight.toFixed(1)}%
            </span>
          </div>
          <p className="text-xs text-zinc-500 truncate">{name}</p>
          <div className="h-10">
            <SparklineChart data={sparkline} color={sparkColor} height={40} />
          </div>
        </div>

        {/* Weight 큰 수 (desktop only) */}
        <div className="hidden lg:flex flex-col items-end">
          <span className="text-2xl font-bold font-mono text-zinc-100 tabular-nums">
            {weight.toFixed(2)}%
          </span>
          <span className={`text-xs font-mono tabular-nums ${deltaColor}`}>
            {deltaPositive ? '▲' : deltaNegative ? '▼' : '—'}{' '}
            {Math.abs(weightDelta).toFixed(1)}%p
          </span>
        </div>

        {/* Metadata 4-grid */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono">
          <Meta label="Value" value={formatUSD(valueUsd)} />
          <Meta label="Shares" value={formatShares(shares)} />
          <Meta
            label="Avg Entry*"
            value={avgEntryEst != null ? `$${avgEntryEst.toFixed(2)}` : '—'}
            dim
          />
          <Meta label="Since" value={heldSince ?? '—'} dim />
        </dl>
      </div>
    </button>
  );
};

// ────────────────────────────────────────────
// 메타 필드 1칸
// ────────────────────────────────────────────
interface MetaProps {
  label: string;
  value: string;
  dim?: boolean;
}

const Meta = ({ label, value, dim = false }: MetaProps) => (
  <div>
    <dt className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</dt>
    <dd className={`tabular-nums ${dim ? 'text-zinc-400' : 'text-zinc-200'}`}>{value}</dd>
  </div>
);
