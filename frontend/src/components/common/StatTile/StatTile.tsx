import type { ReactNode } from 'react'
import styles from './StatTile.module.css'

// 파운데이션 시트의 "Stat 3색 타일" — 여러 개를 나란히 놓을 땐 이 순서대로 색을 돌린다
export type StatTone = 'cyan' | 'pink' | 'yellow'

interface StatTileProps {
  label: string
  value: ReactNode
  tone?: StatTone
  // 지금 주목해야 하는 값이면 켠다 (내 기록, 1위 등)
  highlight?: boolean
}

// 라벨 + 큰 숫자 한 쌍을 보여주는 작은 판. 게임 설정 요약이나 결과 지표 줄에 쓴다.
export function StatTile({ label, value, tone = 'cyan', highlight }: StatTileProps) {
  const classes = [styles.tile, styles[tone], highlight ? styles.highlight : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}

// 인덱스에 따라 시안 → 핑크 → 옐로 순으로 색을 배정한다 (타일을 여러 개 늘어놓을 때)
export const STAT_TONES: StatTone[] = ['cyan', 'pink', 'yellow']
