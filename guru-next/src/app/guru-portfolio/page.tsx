// /guru-portfolio — Guru 목록 페이지 (서버 컴포넌트)
import { Suspense } from 'react';
import { GuruListClient } from '@/components/guru/GuruListClient';
import { MOCK_GURUS_LIST } from '@/mocks/guru-mocks';
import type { GuruListItem } from '@/types/guru';
import { formatUSD } from '@/lib/format';

export const metadata = {
  title: '💎 Guru Portfolio · 부자들의 포트폴리오',
  description: 'Warren Buffett, Ray Dalio, Cathie Wood 등 투자 대가들의 실시간 13F 공시 기반 포트폴리오.',
};

// 서버에서 초기 데이터 fetch — Next.js 14 App Router
async function fetchGurus(): Promise<GuruListItem[]> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/gurus`, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: GuruListItem[] };
    return json.data;
  } catch (err) {
    console.warn('[guru-portfolio page] API fetch failed, using mock:', err);
    return MOCK_GURUS_LIST;
  }
}

export default async function GuruPortfolioPage() {
  const gurus = await fetchGurus();

  const totalAum = gurus.reduce((s, g) => s + (g.aumUsd ?? 0), 0);
  const latestFiled =
    gurus
      .map((g) => g.lastFiledAt)
      .filter((d): d is string => !!d)
      .sort()
      .reverse()[0] ?? null;

  return (
    <main className="min-h-screen bg-[#0D1117] text-zinc-100">
      {/* HERO */}
      <section className="px-4 lg:px-8 pt-10 pb-6 max-w-7xl mx-auto">
        <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">
          💎 부자들의 포트폴리오
        </h1>
        <p className="mt-2 text-sm text-zinc-400 max-w-2xl">
          Warren Buffett, Ray Dalio, Cathie Wood 등 투자 대가들의 실시간 SEC 13F 공시 포트폴리오.
          <span className="text-zinc-600 ml-1">(최대 45일 지연)</span>
        </p>

        {/* 상단 스탯 */}
        <dl className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Gurus" value={String(gurus.length)} />
          <Stat label="Total AUM" value={formatUSD(totalAum)} />
          <Stat label="Latest Filing" value={latestFiled ?? '—'} />
          <Stat label="Coverage" value="13F-HR / SEC EDGAR" small />
        </dl>
      </section>

      {/* 필터 + 그리드 */}
      <section className="px-4 lg:px-8 pb-16 max-w-7xl mx-auto">
        <Suspense fallback={<div className="py-20 text-center text-zinc-500">불러오는 중...</div>}>
          <GuruListClient initial={gurus} />
        </Suspense>
      </section>
    </main>
  );
}

interface StatProps {
  label: string;
  value: string;
  small?: boolean;
}
const Stat = ({ label, value, small = false }: StatProps) => (
  <div className="rounded-xl bg-[#161B22] border border-zinc-800 p-3 lg:p-4">
    <dt className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</dt>
    <dd
      className={`mt-1 font-bold text-zinc-100 font-mono tabular-nums ${
        small ? 'text-xs' : 'text-lg lg:text-xl'
      }`}
    >
      {value}
    </dd>
  </div>
);
