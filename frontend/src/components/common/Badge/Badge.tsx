import type { HTMLAttributes } from 'react';
import styles from './Badge.module.css';

type BadgeVariant = 'host' | 'ready' | 'pending';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

// children을 안 넘겼을 때 보여줄 기본 라벨 텍스트
const LABEL: Record<BadgeVariant, string> = {
  host: '방장',
  ready: '✓ READY',
  pending: '· 준비 중',
};

// 참가자 상태 뱃지(방장/준비완료/대기중) — children을 넘기면 기본 라벨을 덮어씀
export function Badge({ variant, className, children, ...rest }: BadgeProps) {
  const resolvedVariant = variant ?? 'pending';
  return (
    <span
      className={[styles.badge, styles[resolvedVariant], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children ?? LABEL[resolvedVariant]}
    </span>
  );
}
