'use client';

// 목록 페이지 내 필터/정렬 인터랙션 담당 클라이언트 컴포넌트
import { useMemo, useState } from 'react';
import { GuruCard } from './GuruCard';
import type { GuruListItem } from '@/types/guru';

type SortKey = 'aumDesc' | 'aumAsc' | 'nameAsc' | 'filedDesc';

interface GuruListClientProps {
  initial: GuruListItem[];
}

export const GuruListClient = ({ initial }: GuruListClientProps) => {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('aumDesc');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  // 전체 태그 추출
  const allTags = useMemo(() => {
    const set = new Set<string>();
    initial.forEach((g) => g.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [initial]);

  // 필터 + 정렬
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = initial.filter((g) => {
      if (q) {
        const hay = `${g.name} ${g.manager ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (activeTags.size > 0) {
        if (!g.tags.some((t) => activeTags.has(t))) return false;
      }
      return true;
    });

    arr = [...arr].sort((a, b) => {
      switch (sortKey) {
        case 'aumDesc':
          return (b.aumUsd ?? 0) - (a.aumUsd ?? 0);
        case 'aumAsc':
          return (a.aumUsd ?? 0) - (b.aumUsd ?? 0);
        case 'nameAsc':
          return a.name.localeCompare(b.name);
        case 'filedDesc':
          return (b.lastFiledAt ?? '').localeCompare(a.lastFiledAt ?? '');
      }
    });

    return arr;
  }, [initial, query, sortKey, activeTags]);

  const toggleTag = (t: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  return (
    <>
      {/* 필터 바 */}
      <div className="sticky top-0 z-10 bg-[#0D1117]/90 backdrop-blur border-b border-zinc-800 py-3 mb-6">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 Guru 검색 (이름 · 매니저)"
            className="flex-1 lg:max-w-sm px-3 py-2 rounded-lg bg-[#161B22] border border-zinc-800
                       text-sm text-zinc-100 placeholder:text-zinc-600
                       focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50"
            aria-label="Guru 검색"
          />

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="px-3 py-2 rounded-lg bg-[#161B22] border border-zinc-800
                       text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            aria-label="정렬 기준"
          >
            <option value="aumDesc">AUM 높은순</option>
            <option value="aumAsc">AUM 낮은순</option>
            <option value="filedDesc">최신 공시순</option>
            <option value="nameAsc">이름 A→Z</option>
          </select>

          <div
            className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1"
            role="group"
            aria-label="태그 필터"
          >
            {allTags.map((t) => {
              const active = activeTags.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={`shrink-0 px-2.5 py-1 rounded-full border text-[11px] font-medium whitespace-nowrap
                              transition-colors ${
                                active
                                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/50'
                                  : 'bg-transparent text-zinc-400 border-zinc-800 hover:border-zinc-700'
                              }`}
                  aria-pressed={active}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2 text-[11px] text-zinc-500 font-mono tabular-nums">
          {list.length} gurus
          {activeTags.size > 0 && ` · filtered by ${activeTags.size} tag(s)`}
        </div>
      </div>

      {/* 그리드 */}
      {list.length === 0 ? (
        <div className="py-20 text-center text-zinc-500">
          🔍 조건에 맞는 Guru가 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 lg:gap-6">
          {list.map((g) => (
            <GuruCard key={g.id} guru={g} />
          ))}
        </div>
      )}
    </>
  );
};
