import type { ReactNode } from 'react'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  title: string
  description?: string
  // 게임 가이드처럼 내용이 많은 팝업은 넓게 연다
  wide?: boolean
  // 제목 줄을 옐로 바로 분리하고 우측에 닫기 버튼을 붙인다 (게임 가이드 팝업 형태)
  banner?: boolean
  // 배경을 눌러 닫을 수 있게 할지. 강제 안내(가이드 카운트다운·방 종료)에는 넘기지 않는다
  onClose?: () => void
  // 하단 버튼 영역
  actions?: ReactNode
  children?: ReactNode
}

// 확인/안내용 팝업. 배경 클릭으로 닫을 수 있는지는 onClose 유무로 결정된다.
export function Modal({
  open,
  title,
  description,
  wide,
  banner,
  onClose,
  actions,
  children,
}: ModalProps) {
  if (!open) return null
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={[styles.panel, wide ? styles.wide : ''].filter(Boolean).join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        {banner ? (
          <div className={styles.headerBar}>
            <div className={styles.headerTexts}>
              <h2 className={styles.title}>{title}</h2>
              {description && <p className={styles.description}>{description}</p>}
            </div>
            {onClose && (
              <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
                ✕
              </button>
            )}
          </div>
        ) : (
          <>
            <h2 className={styles.title}>{title}</h2>
            {description && <p className={styles.description}>{description}</p>}
          </>
        )}
        {children}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  )
}
