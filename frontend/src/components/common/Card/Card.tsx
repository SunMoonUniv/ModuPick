import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

type CardProps = HTMLAttributes<HTMLDivElement>;

// 테두리·그림자가 있는 범용 컨테이너 — 패널의 기본 표면, 내부 padding은 없음
export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div className={[styles.card, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}
