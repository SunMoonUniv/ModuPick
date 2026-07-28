import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

// primary = 주 CTA(잉크 배경), accent = 강조용(옐로), secondary = 약한 강조(화이트)
type ButtonVariant = 'primary' | 'accent' | 'secondary';

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
