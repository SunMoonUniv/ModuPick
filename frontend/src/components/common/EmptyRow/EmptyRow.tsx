import type { HTMLAttributes } from 'react';
import styles from './EmptyRow.module.css';

type EmptyRowProps = HTMLAttributes<HTMLDivElement>;

// 방의 빈 자리를 나타내는 점선 플레이스홀더 행 — children을 넘기면 기본 초대 문구를 덮어씀
export function EmptyRow({ className, children, ...rest }: EmptyRowProps) {
  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')} {...rest}>
      {children ?? '? 빈 자리 · 초대 링크로 참여 대기'}
    </div>
  );
}
