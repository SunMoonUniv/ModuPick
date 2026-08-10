import type { HTMLAttributes } from 'react'
import styles from './Badge.module.css'

// 상태별 색이 정해져 있다 — 새 상태가 필요하면 여기에 추가하고 임의 색을 인라인으로 쓰지 않는다
export type BadgeTone = 'neutral' | 'host' | 'ready' | 'waiting' | 'out' | 'me'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

// 멤버 카드나 명단 행에 붙는 짧은 상태 라벨 (방장 / 준비완료 / 탈락 등).
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[tone], className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </span>
  )
}
