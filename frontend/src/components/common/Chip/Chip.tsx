import type { HTMLAttributes } from 'react';
import styles from './Chip.module.css';

type ChipColor = 'yellow' | 'pink' | 'cyan' | 'white' | 'green';

type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  color?: ChipColor;
};

// 작은 필(pill) 라벨 — 텍스트 옆에 붙는 뱃지/태그용, 클릭 액션은 Button을 쓸 것
export function Chip({ color = 'yellow', className, children, ...rest }: ChipProps) {
  return (
    <span className={[styles.chip, styles[color], className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </span>
  );
}
