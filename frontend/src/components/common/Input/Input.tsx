import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import styles from './Input.module.css'

interface CommonProps {
  label?: string
  // 입력창 아래 안내 문구. error가 있으면 그쪽이 우선한다
  helper?: string
  error?: string
  // 문구 없이 실패 상태(핑크 배경)만 표시할 때. 에러 메시지를 화면 다른 곳에 따로 띄우는 경우에 쓴다
  invalid?: boolean
  // 최대 글자수. 넘겨주면 우측에 `현재/최대` 카운터가 붙는다
  maxLength?: number
  leading?: ReactNode
  // 'card'는 흰 카드 안, 'purple'은 보라 배경 위에 필드가 바로 놓이는 경우 (흰 배경 + 하드 그림자)
  tone?: 'card' | 'purple'
  // tone='purple'일 때 라벨 색 — 필수 항목은 옐로, 선택 항목은 시안으로 구분한다
  accent?: 'yellow' | 'cyan'
}

type TextInputProps = CommonProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
    // 방 코드처럼 자간을 벌려 크게 보여줄지
    codeStyle?: boolean
    // 입력값 자체가 화면의 주인공일 때 (닉네임처럼) 제목용 폰트로 크게 보여준다
    strong?: boolean
  }

// 한 줄 텍스트 입력. 라벨·글자수 카운터·에러 문구를 한 덩어리로 묶어 화면마다 다시 만들지 않게 한다.
export function Input({
  label,
  helper,
  error,
  invalid = false,
  maxLength,
  leading,
  tone = 'card',
  accent = 'yellow',
  codeStyle = false,
  strong = false,
  value,
  ...rest
}: TextInputProps) {
  const length = String(value ?? '').length
  const onPurple = tone === 'purple'
  const failed = invalid || error !== undefined
  return (
    <div className={styles.field}>
      {label && (
        <span
          className={[styles.label, onPurple ? styles.labelOnPurple : '', onPurple ? styles[accent] : '']
            .filter(Boolean)
            .join(' ')}
        >
          {label}
        </span>
      )}
      <div
        className={[styles.shell, onPurple ? styles.shellOnPurple : '', failed ? styles.invalid : '']
          .filter(Boolean)
          .join(' ')}
      >
        {leading}
        <input
          className={[styles.control, codeStyle ? styles.code : '', strong ? styles.strong : '']
            .filter(Boolean)
            .join(' ')}
          value={value}
          maxLength={maxLength}
          {...rest}
        />
        {maxLength !== undefined && (
          <span className={styles.counter}>
            {length}/{maxLength}
          </span>
        )}
      </div>
      <span
        className={[
          styles.helper,
          onPurple ? styles.helperOnPurple : '',
          error ? styles.helperError : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {error ?? helper ?? ''}
      </span>
    </div>
  )
}

type TextAreaProps = CommonProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>

// 여러 줄 입력 (킹메이커 의견 제출처럼 긴 문장을 받을 때).
export function TextArea({ label, helper, error, maxLength, value, ...rest }: TextAreaProps) {
  const length = String(value ?? '').length
  return (
    <div className={styles.field}>
      {label && <span className={styles.label}>{label}</span>}
      <div
        className={[styles.shell, styles.multiline, error ? styles.invalid : '']
          .filter(Boolean)
          .join(' ')}
      >
        <textarea
          className={[styles.control, styles.textarea].join(' ')}
          value={value}
          maxLength={maxLength}
          {...rest}
        />
      </div>
      <div className={styles.field}>
        <span
          className={[styles.helper, error ? styles.helperError : ''].filter(Boolean).join(' ')}
        >
          {error ?? helper ?? ''}
          {maxLength !== undefined && (
            <span className={styles.counter}>
              {' '}
              · {length}/{maxLength}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
