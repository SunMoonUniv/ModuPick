import type { ReactNode } from 'react'
import { useState } from 'react'
import styles from './ScreenFrame.module.css'

interface ScreenFrameProps {
  // 상단 밴드를 띄울 방 정보. 홈/입장처럼 방이 없는 화면에서는 생략한다
  room?: {
    roomName: string
    displayCode: string
    memberCount: number
    maxMembers: number
    // 코드 옆 알약에 함께 표시할 문구 (예: 'READY 4')
    status?: string
  }
  // 방 이름 아래에 붙는 한 줄 — 지금 어떤 화면인지 알린다 (예: '● 실시간 대기방')
  subtitle?: string
  // 상단 밴드 오른쪽 끝에 덧붙일 요소 (게임 화면의 남은 시간 등)
  bandRight?: ReactNode
  // 인게임 무대용 어두운 배경을 쓸지 — 게임 화면에서만 켠다
  stage?: boolean
  // 본문을 화면 정중앙에 놓을지
  centered?: boolean
  // 여백 없이 본문이 1920×1080 전체를 쓰게 할지.
  // Figma 프레임 좌표를 그대로 써서 요소를 절대 배치하는 화면에서 켠다 (본문이 좌표계의 원점이 된다)
  fullBleed?: boolean
  children: ReactNode
}

// 모든 화면의 바깥 틀. 보라 배경·장식 창틀·좌우 59px 여백·상단 방 정보 밴드를 한곳에서 관리한다.
export function ScreenFrame({
  room,
  subtitle,
  bandRight,
  stage,
  centered,
  fullBleed,
  children,
}: ScreenFrameProps) {
  const [copied, setCopied] = useState(false)

  const copyCode = () => {
    if (!room) return
    // 다른 사람에게 방 코드를 불러줘야 하므로 한 번에 복사할 수 있게 한다
    navigator.clipboard?.writeText(room.displayCode).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => setCopied(false),
    )
  }

  return (
    <div
      className={[styles.frame, stage ? styles.stage : '', fullBleed ? styles.frameFullBleed : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.grid} />
      <div className={styles.windowFrame}>
        <span className={`${styles.corner} ${styles.cornerTL}`} />
        <span className={`${styles.corner} ${styles.cornerTR}`} />
        <span className={`${styles.corner} ${styles.cornerBL}`} />
        <span className={`${styles.corner} ${styles.cornerBR}`} />
      </div>

      {room && (
        <header className={styles.band}>
          <div className={styles.bandLeft}>
            <span className={styles.roomName}>{room.roomName}</span>
            {subtitle && <span className={styles.roomMeta}>{subtitle}</span>}
          </div>
          <div className={styles.bandRight}>
            {bandRight}
            <button type="button" className={styles.code} onClick={copyCode}>
              {copied ? '복사됨!' : `◈ ${room.displayCode}`}
            </button>
            <span className={styles.count}>
              {room.memberCount}/{room.maxMembers}명{room.status ? ` · ${room.status}` : ''}
            </span>
          </div>
        </header>
      )}
      <main
        className={[
          styles.body,
          room ? '' : styles.noBand,
          centered ? styles.centered : '',
          fullBleed ? styles.bodyFullBleed : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </main>
    </div>
  )
}
