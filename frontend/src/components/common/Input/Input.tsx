import type { InputHTMLAttributes } from 'react';
import styles from './Input.module.css';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** 문자수 카운터 표시용 최대 길이 (예: 16) */
  maxLength?: number;
};

// "N / 최대" 문자수 카운터를 오버레이로 보여주는 입력 필드 — maxLength를 넘겨야 카운터가 렌더링됨
export function Input({ className, maxLength, value, ...rest }: InputProps) {
  const length = typeof value === 'string' ? value.length : 0; // 카운터는 controlled string value가 있어야 셀 수 있음
  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <input className={styles.input} maxLength={maxLength} value={value} {...rest} />
      {maxLength != null && (
        <span className={styles.counter}>
          {length} / {maxLength}
        </span>
      )}
    </div>
  );
}
