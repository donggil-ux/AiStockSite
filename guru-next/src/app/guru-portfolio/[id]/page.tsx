// /guru-portfolio/[id] — Guru 상세 페이지 (서버 컴포넌트)
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { GuruNavBar } from '@/components/guru/GuruNavBar';
import { GuruDetailClient } from '@/components/guru/GuruDetailClient';
import { MOCK_GURUS_LIST, MOCK_GURU_DETAILS } from '@/mocks/guru-mocks';
import { formatUSD } from '@/lib/format';
import type { GuruDetail, GuruListItem } from '@/types/guru';

interface PageProps {
  params: { id: string };
  searchParams: { quarter?: string };
}

async function fetchGuruDetail(id: string, quarter?: string): Promise<GuruDetail | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const qs = quarter ? `?quarter=${quarter}` : '';
    const res = await fetch(`${base}/api/gurus/${id}${qs}`, {
      next: { revalidate: 300 },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: GuruDetail };
    return json.data;
  } catch (err) {
    console.warn('[guru detail] API fetch failed, using mock:', err);
    return MOCK_GURU_DETAILS[id] ?? null;
  }
}

async function fetchGurus(): Promise<GuruListItem[]> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/gurus`, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: GuruListItem[] };
    return json.data;
  } catch {
    return MOCK_GURUS_LIST;
  }
}

export async function generateMetadata({ params }: PageProps) {
  const mock = MOCK_GURU_DETAILS[params.id];
  return {
    title: mock
      ? `💎 ${mock.name} — Guru Portfolio`
      : '💎 Guru Portfolio',
  };
}

export default async function GuruDetailPage({ params, searchParams }: PageProps) {
  const [detail, allGurus] = await Promise.all([
    fetchGuruDetail(params.id, searchParams.quarter),
    fetchGurus(),
  ]);

  if (!detail) notFound();

  return (
    <main className="min-h-screen bg-[#0D1117] text-zinc-100">
      {/* Guru Switcher */}
      <GuruNavBar gurus={allGurus} currentId={detail.id} />

      <div className="max-w-7xl mx-auto px-4 lg:px-8 pt-6 pb-16">
        {/* Back */}
        <Link
          href="/guru-portfolio"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 mb-4"
        >
          ← 전체 Guru 목록
        </Link>

        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6 pb-6 border-b border-zinc-800">
          <div className="text-5xl leading-none" aria-hidden>
            {detail.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold truncate">{detail.name}</h1>
            <p className="text-sm text-zinc-400 mt-1">
              {detail.manager}
              <span className="text-zinc-600"> · CIK {detail.cik}</span>
              {detail.foundedYear && (
                <span className="text-zinc-600"> · {detail.foundedYear}-</span>
              )}
            </p>
            {detail.bio && (
              <p className="text-xs text-zinc-500 mt-2 max-w-2xl">{detail.bio}</p>
            )}
            {detail.tags.length > 0 && (
              <div className="flex gap-1 mt-2">
                {detail.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-md bg-zinc-800/60 text-[10px] text-zinc-400 font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl lg:text-2xl font-bold font-mono text-zinc-100 tabular-nums">
              {formatUSD(detail.aumUsd)}
            </div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
              AUM · {detail.lastFiledAt ?? '—'}
            </div>
          </div>
        </header>

        {/* 본문 (탭 + 포지션 리스트) */}
        <GuruDetailClient detail={detail} />
      </div>
    </main>
  );
}
