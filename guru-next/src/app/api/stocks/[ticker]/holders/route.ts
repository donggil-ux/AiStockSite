// GET /api/stocks/[ticker]/holders
// 해당 종목을 보유 중인 Guru 리스트 (각 Guru의 최신 분기 기준)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toNumRequired } from '@/lib/serialize';
import type { StockHolder } from '@/types/guru';
import { MOCK_STOCK_HOLDERS } from '@/mocks/guru-mocks';

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker?.toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: 'invalid ticker' }, { status: 400 });
  }

  try {
    // 해당 티커의 Stock 찾기
    const stocks = await prisma.stock.findMany({
      where: { ticker },
      select: { id: true },
    });
    if (stocks.length === 0) {
      // mock 폴백
      const mock = MOCK_STOCK_HOLDERS[ticker];
      if (mock) return NextResponse.json({ data: mock, source: 'mock' });
      return NextResponse.json({ data: [], source: 'empty' });
    }

    const stockIds = stocks.map((s) => s.id);

    // 포지션 → portfolio → guru join
    const positions = await prisma.position.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: { portfolio: { quarter: 'desc' } },
      include: {
        portfolio: {
          select: {
            quarter: true,
            guru: {
              select: { id: true, cik: true, name: true, manager: true, emoji: true },
            },
          },
        },
      },
    });

    // Guru별 최신 분기만 유지
    const seen = new Set<string>();
    const holders: StockHolder[] = [];
    for (const p of positions) {
      const g = p.portfolio.guru;
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      holders.push({
        guruId: g.id,
        cik: g.cik,
        name: g.name,
        manager: g.manager,
        emoji: g.emoji,
        weight: Number(p.weight),
        valueUsd: toNumRequired(p.valueUsd),
        shares: toNumRequired(p.shares),
        action: p.action,
        quarter: p.portfolio.quarter,
      });
    }
    holders.sort((a, b) => b.weight - a.weight);

    return NextResponse.json({ data: holders, source: 'db' });
  } catch (err) {
    console.error('[GET /api/stocks/:ticker/holders]', err);
    const mock = MOCK_STOCK_HOLDERS[ticker];
    if (mock) return NextResponse.json({ data: mock, source: 'mock-fallback' });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
