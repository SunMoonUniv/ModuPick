import styles from './EmptyRow.module.css'

interface EmptyRowProps {
  // 상황을 한눈에 알리는 이모지
  icon?: string
  title: string
  description?: string
  // 흰 카드 안에 놓일 때 켠다 — 라벤더 점선은 흰 배경에서 거의 안 보인다
  onLight?: boolean
}

// 아직 아무것도 없는 목록 자리에 넣는 안내 (채팅 없음, 빈 참가자 자리 등).
export function EmptyRow({ icon = '?', title, description, onLight }: EmptyRowProps) {
  return (
    <div className={[styles.empty, onLight ? styles.onLight : ''].filter(Boolean).join(' ')}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.title}>{title}</span>
      {description && <span className={styles.description}>{description}</span>}
    </div>
  )
}
