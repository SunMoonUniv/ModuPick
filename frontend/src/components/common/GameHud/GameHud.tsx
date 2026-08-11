import type { ReactNode } from 'react'
import styles from './GameHud.module.css'

interface GameHudProps {
  // 왼쪽 노란 원 안에 들어가는 짧은 값 — 남은 초, 라운드 번호, 이모지 등. 없으면 글이 왼쪽 끝까지 당겨진다
  badge?: ReactNode
  // 노란 원 없이 badge를 그대로 놓는다 — 킹메이커처럼 배지 자리에 그림 아이콘만 오는 프레임용
  bareBadge?: boolean
  // 지금 무엇을 하는 중인지 (예: "돌리는 중…")
  title: string
  // 한 줄 보충 설명
  note: string
  // 보충 설명을 20px로 키운다 — 킹메이커 프레임들이 다른 게임보다 한 단계 큰 글씨를 쓴다
  largeNote?: boolean
  // 밴드 한가운데. 방장이 눌러야 진행되는 버튼(룰렛·사다리 시작)이 여기 들어간다
  center?: ReactNode
  // 오른쪽 끝에 붙는 알약·버튼. 게임마다 다르다
  right?: ReactNode
}

// 인게임 화면 아래에 항상 깔리는 상태 밴드(1803×108). 6종 게임이 모두 같은 자리에 같은 모양으로 쓴다.
export function GameHud({ badge, bareBadge, largeNote, title, note, center, right }: GameHudProps) {
  // 배지가 없으면 글이 왼쪽 끝으로, 노란 원 없이 아이콘만 쓰면 그만큼 덜 밀려난다
  const offset = badge === undefined ? styles.flush : bareBadge ? styles.bare : ''

  return (
    <footer className={styles.hud}>
      {badge !== undefined && (
        <span className={bareBadge ? `${styles.badge} ${styles.badgePlain}` : styles.badge}>
          {badge}
        </span>
      )}
      <span className={`${styles.title} ${offset}`}>{title}</span>
      <span className={`${styles.note} ${offset} ${largeNote ? styles.noteLarge : ''}`}>{note}</span>
      {center && <div className={styles.center}>{center}</div>}
      {right && <div className={styles.right}>{right}</div>}
    </footer>
  )
}

// HUD 오른쪽에 자주 쓰는 알약 — "결과는 아무도 못 바꿔요" 같은 안내 문구용
export function HudPill({
  children,
  tone = 'yellow',
  raised,
}: {
  children: ReactNode
  // 알약 배경. 기본은 노랑이고, 킹메이커는 시안·익명 저격은 빨강을 쓴다
  tone?: 'yellow' | 'cyan' | 'red'
  // 테두리·여백을 한 단계 키우고 하드 그림자를 붙인다 (킹메이커 프레임 기준)
  raised?: boolean
}) {
  return (
    <span className={`${styles.pill} ${styles[tone]} ${raised ? styles.raised : ''}`}>
      {children}
    </span>
  )
}
