'use client';

// 상세 페이지 상단 Guru 스위처 (가로 스크롤)
// 현재 Guru 활성화 + 좌우 fade mask
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { GuruListItem } from '@/types/guru';

interface GuruNavBarProps {
  gurus: GuruListItem[];
  currentId: string;
}

export const GuruNavBar = ({ gurus, currentId }: GuruNavBarProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // 현재 Guru를 뷰포트 중앙으로 스크롤 인
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [currentId]);

  if (gurus.length === 0) return null;

  return (
    <nav
      className="sticky top-0 z-20 bg-[#0D1117]/90 backdrop-blur border-b border-zinc-800"
      aria-label="Guru 전환"
    >
      <div className="relative">
        {/* 좌측 fade */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-8
                     bg-gradient-to-r from-[#0D1117] to-transparent z-10"
          aria-hidden
        />
        {/* 우측 fade */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-8
                     bg-gradient-to-l from-[#0D1117] to-transparent z-10"
          aria-hidden
        />

        <div
          ref={scrollRef}
          className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide snap-x"
          style={{ scrollbarWidth: 'none' }}
        >
          {gurus.map((g) => {
            const isActive = g.id === currentId;
            return (
              <Link
                key={g.id}
                ref={isActive ? activeRef : undefined}
                href={`/guru-portfolio/${g.id}`}
                className={`shrink-0 snap-start flex items-center gap-2 px-3 py-2.5 rounded-xl border
                           transition-all duration-150 min-w-[160px] ${
                             isActive
                               ? 'bg-blue-500/10 border-blue-500/50 text-zinc-100'
                               : 'border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200'
                           }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="text-xl leading-none" aria-hidden>
                  {g.emoji}
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold truncate">{g.name}</span>
                  {g.manager && (
                    <span className="text-[10px] text-zinc-500 truncate">{g.manager}</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
