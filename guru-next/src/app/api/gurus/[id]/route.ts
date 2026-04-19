// GET /api/gurus/[id]
// Guru 상세 + 지정 분기(또는 최신) 포트폴리오
// /api/gurus/:id?quarter=2025Q4
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toNum, toNumRequired, decToNum, isoDate } from '@/lib/serialize';
import type { GuruDetail, PositionItem, SectorSlice } from '@/types/guru';
import { MOCK_GURU_DETAILS } from '@/mocks/guru-mocks';

const QUARTER_RE = /^\d{4}Q[1-4]$/;

// 섹터 팔레트 — PortfolioDonutChart 색상
const SECTOR_COLORS: Record<string, string> = {
  Technology: '#3B82F6',
  Financial: '#6366F1',
  Consumer: '#8B5CF6',
  Healthcare: '#EC4899',
  Energy: '#F59E0B',
  Industrial: '#10B981',
  Communication: '#EF4444',
  Materials: '#06B6D4',
  Other: '#71717A',
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const quarter = req.nextUrl.searchParams.get('quarter');
  if (quarter && !QUARTER_RE.test(quarter)) {
    return NextResponse.json({ error: 'invalid quarter' }, { status: 400 });
  }

  try {
    const guru = await prisma.guru.findFirst({
      where: { OR: [{ id }, { cik: id }] },
      include: {
        portfolios: {
          orderBy: { quarter: 'desc' },
        },
      },
    });

    if (!guru) {
      // mock 폴백
      const mock = MOCK_GURU_DETAILS[id];
      if (mock) return NextResponse.json({ data: mock, source: 'mock' });
      return NextResponse.json({ error: 'guru not found' }, { status: 404 });
    }

    const targetQuarter = quarter ?? guru.portfolios[0]?.quarter;
    let latestPortfolio: GuruDetail['latestPortfolio'] = null;

    if (targetQuarter) {
      const portfolio = await prisma.guruPortfolio.findUnique({
        where: { guruId_quarter: { guruId: guru.id, quarter: targetQuarter } },
        include: {
          positions: {
            orderBy: { weight: 'desc' },
            include: { stock: true },
          },
        },
      });

      if (portfolio) {
        // 섹터 집계
        const sectorMap = new Map<string, number>();
        portfolio.positions.forEach((p) => {
          const sec = p.stock.sector ?? 'Other';
          sectorMap.set(sec, (sectorMap.get(sec) ?? 0) + Number(p.weight));
        });
        const sectorBreakdown: SectorSlice[] = [...sectorMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, value]) => ({
            label,
            value: Number(value.toFixed(2)),
            color: SECTOR_COLORS[label] ?? SECTOR_COLORS.Other,
          }));

        const positions: PositionItem[] = portfolio.positions.map((p) => ({
          id: p.id,
          ticker: p.stock.ticker,
          name: p.stock.name,
          sector: p.stock.sector,
          shares: toNumRequired(p.shares),
          valueUsd: toNumRequired(p.valueUsd),
          weight: Number(p.weight),
          weightDelta: 0, // 별도 쿼리 비용 고려 — history API에서 계산 권장
          action: p.action,
          prevShares: toNum(p.prevShares),
          avgEntryEst: decToNum(p.avgEntryEst),
          sparkline: [], // history API에서 채움 (N+1 방지)
          heldSince: null,
        }));

        latestPortfolio = {
          quarter: portfolio.quarter,
          filingDate: isoDate(portfolio.filingDate) as string,
          totalValue: toNumRequired(portfolio.totalValue),
          positionCnt: portfolio.positionCnt,
          newCnt: portfolio.newCnt,
          soldCnt: portfolio.soldCnt,
          positions,
          sectorBreakdown,
        };
      }
    }

    const detail: GuruDetail = {
      id: guru.id,
      cik: guru.cik,
      name: guru.name,
      manager: guru.manager,
      emoji: guru.emoji,
      bio: guru.bio,
      foundedYear: guru.foundedYear,
      tags: guru.tags,
      aumUsd: toNum(guru.aumUsd),
      lastFiledAt: isoDate(guru.lastFiledAt),
      latestQuarter: guru.portfolios[0]?.quarter ?? null,
      top3: [], // 상세에서는 미사용
      quarters: guru.portfolios.map((p) => ({
        quarter: p.quarter,
        filingDate: isoDate(p.filingDate) as string,
        totalValue: toNumRequired(p.totalValue),
        positionCnt: p.positionCnt,
        newCnt: p.newCnt,
        soldCnt: p.soldCnt,
      })),
      latestPortfolio,
    };

    return NextResponse.json({ data: detail, source: 'db' });
  } catch (err) {
    console.error('[GET /api/gurus/:id]', err);
    const mock = MOCK_GURU_DETAILS[id];
    if (mock) return NextResponse.json({ data: mock, source: 'mock-fallback' });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
