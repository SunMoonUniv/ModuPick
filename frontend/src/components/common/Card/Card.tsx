import type { HTMLAttributes } from 'react'
import styles from './Card.module.css'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  // 기본 여백을 넣을지. 내부에서 여백을 직접 잡는 경우 false로 끈다
  padded?: boolean
  // 클릭 가능한 카드인지 (호버·선택 상태가 생긴다)
  interactive?: boolean
  selected?: boolean
  disabled?: boolean
  // 어두운 게임 화면 위에 올리는 반전 카드
  inverse?: boolean
}

// 화면 위에 얹는 모든 흰 판의 기본형. 게임 선택 타일처럼 고를 수 있는 카드면 interactive/selected를 켠다.
export function Card({
  padded = true,
  interactive = false,
  selected = false,
  disabled = false,
  inverse = false,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = [
    styles.card,
    padded ? styles.padded : '',
    interactive ? styles.interactive : '',
    selected ? styles.selected : '',
    disabled ? styles.disabled : '',
    inverse ? styles.inverse : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
