import type { ReactNode } from 'react'

import { selectIsHost, useRoomStore } from '../../store/roomStore'
import styles from './ResultActions.module.css'

interface ResultActionsProps {
  // 1920×1080 좌표계에서 패널을 놓을 자리 — 결과 형태마다 프레임이 다른 위치에 둔다. wide 판에서는 무시된다
  left?: number
  top?: number
  // 세로 판 대신 화면 아래 전체 폭 밴드에 버튼 두 개를 눕힌 판을 쓴다 (집계 결과 프레임)
  wide?: boolean
  // 가로 판을 한 단계 낮고 얇게 — 위 카드가 y904까지 내려오는 눈치게임 결과 프레임(542:2773)용
  compact?: boolean
  // 가로 판 왼쪽의 빈 자리(세로선 x1115.78 왼쪽)에 얹을 내용. 좌표는 판 안쪽 기준으로 각 화면이 잡는다
  children?: ReactNode
}

// 결과 화면의 "다음은?" 패널. 다시 하기·대기방 복귀는 방장만 누를 수 있어 게스트에게는 잠겨 보인다.
export function ResultActions({ left, top, wide, compact, children }: ResultActionsProps) {
  const isHost = useRoomStore(selectIsHost)
  // 「다시 하기」는 전용 이벤트가 아니라 game:start다 — 서버가 방 상태를 보고 가른다
  const startGame = useRoomStore((s) => s.startGame)
  const closeRound = useRoomStore((s) => s.closeRound)

  return (
    <aside
      className={
        wide
          ? `${styles.panel} ${styles.wide} ${compact ? styles.compact : ''}`
          : styles.panel
      }
      style={wide ? undefined : { left, top }}
    >
      {children}
      <span className={styles.label}>
        {wide ? '다음은? · 방장만 조작 가능' : '다음은? · 방장만 조작'}
      </span>
      <button
        type="button"
        className={`${styles.button} ${styles.replay}`}
        onClick={startGame}
        disabled={!isHost}
      >
        ↻&nbsp;&nbsp;다시 하기
      </button>
      <span className={styles.rule} />
      <button
        type="button"
        className={`${styles.button} ${styles.back}`}
        onClick={closeRound}
        disabled={!isHost}
      >
        ←&nbsp;&nbsp;대기방으로
      </button>
    </aside>
  )
}
