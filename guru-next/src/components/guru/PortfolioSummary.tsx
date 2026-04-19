'use client';

// 포트폴리오 요약: 섹터 도넛 차트 + 범례 + 핵심 통계
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatUSD } from '@/lib/format';
import type { PortfolioSnapshot } from '@/types/guru';

interface PortfolioSummaryProps {
  snapshot: PortfolioSnapshot;
}

export const PortfolioSummary = ({ snapshot }: PortfolioSummaryProps) => {
  const { sectorBreakdown, positionCnt, newCnt, soldCnt, totalValue, positions } = snapshot;

  // Top 10 합산 (집중도)
  const top10Pct = positions.slice(0, 10).reduce((sum, p) => sum + p.weight, 0);
  const avgWeight = positions.length > 0 ? 100 / positions.length : 0;
  const sectorCnt = new Set(positions.map((p) => p.sector ?? 'Other')).size;

  return (
    <section
      className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 lg:p-6 rounded-2xl bg-[#161B22] border border-zinc-800"
      aria-labelledby="portfolio-summary-heading"
    >
      <h2 id="portfolio-summary-heading" className="sr-only">
        포트폴리오 요약
      </h2>

      {/* 좌측: Donut + 범례 */}
      <div className="flex flex-col lg:flex-row items-center gap-6">
        <div className="relative shrink-0" style={{ width: 240, height: 240 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={sectorBreakdown}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={72}
                outerRadius={110}
                paddingAngle={1}
                isAnimationActive={false}
              >
                {sectorBreakdown.map((s) => (
                  <Cell key={s.label} fill={s.color} stroke="#0D1117" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#161B22',
                  border: '1px solid #27272A',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* 중앙 텍스트 */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-[32px] font-bold font-mono text-zinc-100 leading-none tabular-nums">
              {positionCnt}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider">positions</div>
          </div>
        </div>

        {/* 범례 */}
        <ul className="flex-1 w-full grid grid-cols-2 gap-x-4 gap-y-2 self-center">
          {sectorBreakdown.slice(0, 8).map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-xs">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="flex-1 text-zinc-300 truncate">{s.label}</span>
              <span className="font-mono text-zinc-400 tabular-nums">
                {s.value.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 우측: Key Stats */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 content-center border-t lg:border-t-0 lg:border-l border-zinc-800 pt-4 lg:pt-0 lg:pl-6">
        <Stat label="Total Value" value={formatUSD(totalValue)} mono />
        <Stat label="Positions" value={String(positionCnt)} mono />
        <Stat
          label="New This Quarter"
          value={`${newCnt} 🆕`}
          valueClass={newCnt > 0 ? 'text-emerald-300' : ''}
          mono
        />
        <Stat
          label="Closed Positions"
          value={`${soldCnt} 🔴`}
          valueClass={soldCnt > 0 ? 'text-rose-300' : ''}
          mono
        />
        <Stat
          label="Top 10 Concentration"
          value={`${top10Pct.toFixed(1)}%`}
          mono
        />
        <Stat label="Avg Position Size" value={`${avgWeight.toFixed(2)}%`} mono />
        <Stat label="Sector Spread" value={`${sectorCnt} sectors`} />
      </dl>
    </section>
  );
};

// ────────────────────────────────────────────
// 내부: Stat 블록
// ────────────────────────────────────────────
interface StatProps {
  label: string;
  value: string;
  valueClass?: string;
  mono?: boolean;
}

const Stat = ({ label, value, valueClass = '', mono = false }: StatProps) => (
  <div>
    <dt className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">{label}</dt>
    <dd
      className={`text-base font-bold text-zinc-100 ${
        mono ? 'font-mono tabular-nums' : ''
      } ${valueClass}`}
    >
      {value}
    </dd>
  </div>
);
