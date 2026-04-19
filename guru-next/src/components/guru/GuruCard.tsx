// 목록 페이지 Guru 카드
// 서버 컴포넌트로 동작 가능 (링크만 포함)
import Link from 'next/link';
import { formatUSD } from '@/lib/format';
import type { GuruListItem } from '@/types/guru';

interface GuruCardProps {
  guru: GuruListItem;
}

export const GuruCard = ({ guru }: GuruCardProps) => {
  const { id, name, manager, emoji, aumUsd, lastFiledAt, tags, top3, latestQuarter } = guru;

  return (
    <Link
      href={`/guru-portfolio/${id}`}
      className="group flex flex-col gap-4 p-5 rounded-2xl bg-[#161B22] border border-zinc-800
                 hover:border-zinc-700 hover:bg-[#1C222B] hover:shadow-lg hover:shadow-blue-500/5
                 transition-all duration-150"
      aria-label={`${name} 포트폴리오 상세 보기`}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="text-4xl leading-none" aria-hidden>
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-zinc-100 truncate">{name}</h3>
          {manager && <p className="text-xs text-zinc-500 mt-0.5 truncate">{manager}</p>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold font-mono text-zinc-100 tabular-nums">
            {formatUSD(aumUsd)}
          </div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">AUM</div>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-zinc-800" />

      {/* Top 3 Holdings */}
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
          Top 3 Holdings
        </div>
        {top3.length > 0 ? (
          top3.map((h) => (
            <div key={h.ticker} className="flex items-center gap-2">
              <span className="w-14 text-xs font-bold text-zinc-200 font-mono tabular-nums">
                {h.ticker}
              </span>
              <span className="w-14 text-xs text-zinc-400 font-mono tabular-nums">
                {h.weight.toFixed(1)}%
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-blue-500/70 group-hover:bg-blue-500 transition-colors"
                  style={{ width: `${Math.min(h.weight * 2.5, 100)}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-zinc-600 italic">보유 종목 정보 없음</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-2">
        <div className="flex gap-1 flex-wrap">
          {tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="px-2 py-0.5 rounded-md bg-zinc-800/60 text-[10px] text-zinc-400 font-medium"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="text-[10px] text-zinc-500 font-mono tabular-nums">
          {latestQuarter ?? '—'}
          {lastFiledAt && <span className="ml-1.5">· {lastFiledAt}</span>}
        </div>
      </div>
    </Link>
  );
};
