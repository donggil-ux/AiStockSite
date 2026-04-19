// 숫자/날짜 포맷 유틸 — mono 폰트 출력 전제
export const formatUSD = (v: number | null | undefined): string => {
  if (v == null) return '—';
  const n = Math.abs(v);
  if (n >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

export const formatShares = (v: number | null | undefined): string => {
  if (v == null) return '—';
  const n = Math.abs(v);
  if (n >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return `${v.toFixed(0)}`;
};

export const formatPercent = (v: number, digits = 2): string => `${v.toFixed(digits)}%`;

export const formatQuarter = (q: string): string => q.replace(/^(\d{4})Q(\d)/, '$2Q $1');
