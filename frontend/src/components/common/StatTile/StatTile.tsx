import type { HTMLAttributes } from 'react';
import styles from './StatTile.module.css';

type StatTileColor = 'cyan' | 'pink' | 'yellow';

type StatTileProps = HTMLAttributes<HTMLDivElement> & {
  color?: StatTileColor;
};

// Stat 로우 그룹에 쓰이는 작은 장식용 색상 타일(App.tsx 갤러리 참고) — 내용·라벨 없음
export function StatTile({ color = 'cyan', className, ...rest }: StatTileProps) {
  return <div className={[styles.tile, styles[color], className].filter(Boolean).join(' ')} {...rest} />;
}
