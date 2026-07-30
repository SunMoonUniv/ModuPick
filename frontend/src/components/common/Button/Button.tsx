import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

// primary = 주 CTA(잉크 배경), accent = 강조용(옐로), secondary = 약한 강조(화이트),
// hero = 랜딩 히어로 전용 CTA(잉크 배경·옐로 텍스트), pink = 보조 액션(핑크 배경, 예: 참여)
type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'hero' | 'pink';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = 'primary', className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
