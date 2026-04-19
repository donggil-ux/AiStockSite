// GET /api/gurus
// Guru 목록 + 최신 분기 Top 3 보유 종목
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toNum, isoDate } from '@/lib/serialize';
import type { GuruListItem } from '@/types/guru';

// 개발 중 mock 폴백 (DB가 비어 있을 때)
import { MOCK_GURUS_LIST } from '@/mocks/guru-mocks';

export const revalidate = 300; // 5분 캐시

export async function GET() {
  try {
    const gurus = await prisma.guru.findMany({
      orderBy: [{ aumUsd: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      include: {
        portfolios: {
          orderBy: { quarter: 'desc' },
          take: 1,
          include: {
            positions: {
              orderBy: { weight: 'desc' },
              take: 3,
              include: { stock: { select: { ticker: true } } },
            },
          },
        },
      },
    });

    // DB가 비어있으면 mock 반환 (개발 편의)
    if (gurus.length === 0) {
      return NextResponse.json({ data: MOCK_GURUS_LIST, source: 'mock' });
    }

    const data: GuruListItem[] = gurus.map((g) => {
      const latest = g.portfolios[0];
      return {
        id: g.id,
        cik: g.cik,
        name: g.name,
        manager: g.manager,
        emoji: g.emoji,
        tags: g.tags,
        aumUsd: toNum(g.aumUsd),
        lastFiledAt: isoDate(g.lastFiledAt),
        latestQuarter: latest?.quarter ?? null,
        top3:
          latest?.positions
            .filter((p) => p.stock.ticker)
            .map((p) => ({
              ticker: p.stock.ticker as string,
              weight: Number(p.weight),
            })) ?? [],
      };
    });

    return NextResponse.json({ data, source: 'db' });
  } catch (err) {
    console.error('[GET /api/gurus]', err);
    // DB 접근 실패 시에도 mock으로 폴백 (프로덕션은 에러 throw 권장)
    return NextResponse.json({ data: MOCK_GURUS_LIST, source: 'mock-fallback' }, { status: 200 });
  }
}
