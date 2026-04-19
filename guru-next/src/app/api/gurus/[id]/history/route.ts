// GET /api/gurus/[id]/history
// Guru의 분기별 히스토리 (스파크라인/추세용)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toNumRequired, isoDate } from '@/lib/serialize';
import type { HistoryItem } from '@/types/guru';
import { MOCK_GURU_HISTORY } from '@/mocks/guru-mocks';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  try {
    const guru = await prisma.guru.findFirst({
      where: { OR: [{ id }, { cik: id }] },
      select: { id: true },
    });

    if (!guru) {
      const mock = MOCK_GURU_HISTORY[id];
      if (mock) return NextResponse.json({ data: mock, source: 'mock' });
      return NextResponse.json({ error: 'guru not found' }, { status: 404 });
    }

    const portfolios = await prisma.guruPortfolio.findMany({
      where: { guruId: guru.id },
      orderBy: { quarter: 'asc' },
      include: {
        positions: {
          orderBy: { weight: 'desc' },
          take: 1,
          include: { stock: { select: { ticker: true } } },
        },
      },
    });

    const data: HistoryItem[] = portfolios.map((p) => ({
      quarter: p.quarter,
      filingDate: isoDate(p.filingDate) as string,
      totalValue: toNumRequired(p.totalValue),
      positionCnt: p.positionCnt,
      topHolding: p.positions[0]
        ? {
            ticker: p.positions[0].stock.ticker,
            weight: Number(p.positions[0].weight),
          }
        : null,
    }));

    return NextResponse.json({ data, source: 'db' });
  } catch (err) {
    console.error('[GET /api/gurus/:id/history]', err);
    const mock = MOCK_GURU_HISTORY[id];
    if (mock) return NextResponse.json({ data: mock, source: 'mock-fallback' });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
