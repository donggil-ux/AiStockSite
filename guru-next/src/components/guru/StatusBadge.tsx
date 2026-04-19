// 상태 뱃지: NEW / 증가(ADD) / 감소(REDUCE) / SOLD OUT / HOLD
// 서버/클라이언트 어느 쪽에서도 렌더 가능 (pure component)
import type { PositionAction } from '@/types/guru';

interface StatusBadgeProps {
  action: PositionAction;
  /** 'sm' = compact 버전 (10px) / 'md' = 기본 (11px) */
  size?: 'sm' | 'md';
  className?: string;
}

interface BadgeStyle {
  cls: string;
  icon: string;
  label: string;
}

const BADGE_STYLES: Record<PositionAction, BadgeStyle> = {
  NEW:    { cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300', icon: '🆕', label: 'NEW' },
  ADD:    { cls: 'bg-blue-500/15    border-blue-500/40    text-blue-300',    icon: '▲',  label: '증가' },
  REDUCE: { cls: 'bg-amber-500/15   border-amber-500/40   text-amber-300',   icon: '▼',  label: '감소' },
  SOLD:   { cls: 'bg-rose-500/15    border-rose-500/40    text-rose-300',    icon: '✕',  label: 'SOLD OUT' },
  HOLD:   { cls: 'bg-zinc-500/10    border-zinc-700       text-zinc-400',    icon: '—',  label: 'HOLD' },
};

export const StatusBadge = ({ action, size = 'md', className = '' }: StatusBadgeProps) => {
  const b = BADGE_STYLES[action];
  const sz = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center gap-1 ${sz} rounded-full border
                  font-semibold leading-none whitespace-nowrap ${b.cls} ${className}`}
      aria-label={`상태: ${b.label}`}
    >
      <span aria-hidden>{b.icon}</span>
      <span>{b.label}</span>
    </span>
  );
};
