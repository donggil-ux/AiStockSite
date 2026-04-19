// Prisma BigInt/Decimal → JSON-safe number 변환 유틸
// Next.js API Route에서 JSON 직렬화 시 BigInt는 기본 직렬화 불가

export const toNum = (v: bigint | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  return typeof v === 'bigint' ? Number(v) : v;
};

export const toNumRequired = (v: bigint | number): number => {
  return typeof v === 'bigint' ? Number(v) : v;
};

export const decToNum = (v: { toNumber?: () => number } | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  return typeof v.toNumber === 'function' ? v.toNumber() : Number(v);
};

export const isoDate = (d: Date | null | undefined): string | null => {
  return d ? d.toISOString().slice(0, 10) : null;
};
