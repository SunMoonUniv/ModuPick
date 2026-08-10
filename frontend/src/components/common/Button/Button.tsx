import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

// 색 변형 — primary는 화면당 하나의 주요 동작에만 쓰고, 나머지 동작은 secondary/soft/ghost로 내린다
export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'soft' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  // 가로를 꽉 채울지 (폼 제출 버튼처럼)
  block?: boolean
  // 모서리를 완전히 둥근 알약으로 — 화면 프레임의 보조 액션(뒤로가기, 랜덤 뽑기)이 이 모양이다
  pill?: boolean
  // 텍스트 앞에 붙는 이모지/아이콘
  leading?: ReactNode
}

// 모든 화면의 클릭 동작에 쓰는 기본 버튼. 새 스타일이 필요하면 여기에 variant를 추가하고 복사본을 만들지 않는다.
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  pill = false,
  leading,
  children,
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    block ? styles.block : '',
    pill ? styles.pill : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={classes} {...rest}>
      {leading}
      {children}
    </button>
  )
}
