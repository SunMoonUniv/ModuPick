import type { HTMLAttributes } from 'react'
import styles from './Chip.module.css'

// 알약 배경색. 화면 프레임이 같은 알약을 색만 바꿔 반복해서 쓰므로 색을 prop으로 뺐다
export type ChipColor = 'white' | 'cyan' | 'yellow' | 'pink' | 'ink' | 'lavender'

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  color?: ChipColor
  // 'sm'은 카드/타일 안에 얹히는 작은 알약 (예: 아바타 타일의 "★ 내 캐릭터")
  size?: 'sm' | 'md'
  // 하드 그림자를 붙일지 — 배경 위에 떠 있는 알약은 켜고, 카드 안에 박힌 알약은 끈다
  elevated?: boolean
  // 고정폭 메타 폰트로 쓸지 — 화면 프레임의 상태 알약이 이 폰트다
  mono?: boolean
  // 클릭해서 고를 수 있는 칩인지 (게임 설정의 세그먼트 선택 등)
  selectable?: boolean
  selected?: boolean
  disabled?: boolean
  // 넘기면 우측에 삭제 버튼이 붙는다 (사다리 결과 항목 편집)
  onRemove?: () => void
}

// 짧은 값 하나를 담는 알약 모양 요소. 설정 선택지, 상태 표시, 결과 항목 목록 등에 쓴다.
export function Chip({
  color = 'white',
  size = 'md',
  elevated = false,
  mono = false,
  selectable = false,
  selected = false,
  disabled = false,
  onRemove,
  className,
  children,
  ...rest
}: ChipProps) {
  const classes = [
    styles.chip,
    styles[color],
    styles[size],
    elevated ? styles.elevated : '',
    mono ? styles.mono : '',
    selectable ? styles.selectable : '',
    selected ? styles.selected : '',
    disabled ? styles.disabled : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={classes} {...rest}>
      {children}
      {onRemove && (
        <button
          type="button"
          className={styles.removeButton}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label="삭제"
        >
          ✕
        </button>
      )}
    </span>
  )
}
