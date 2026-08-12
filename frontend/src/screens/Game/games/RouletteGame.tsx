import { useEffect, useState } from 'react'

import { GameHud, HudPill } from '../../../components/common'
import { avatarSrc } from '../../../assets/avatars'
import { crownIcon } from '../../../assets/icons'
import { GAME_ICONS } from '../../../constants/gameVisuals'
import {
  pointer,
  slice1,
  slice2,
  slice3,
  slice4,
  slice5,
  slice6,
  sunburstA,
  sunburstB,
} from '../../../assets/home'
import { useRemainMs } from '../../../hooks/useServerClock'
import { selectIsHost, useRoomStore } from '../../../store/roomStore'
import type { RouletteConfig } from '../../../protocol/types'
import styles from './RouletteGame.module.css'

// 당첨 조각에 멈추기 전까지 도는 바퀴 수 (연출용)
const SPIN_TURNS = 6

// 룰렛 파이 조각 6종. left/top/width/height는 682.657px 원 안에서 조각이 차지하는 사각형이다.
// 6명이 넘으면 조각 이미지가 모자라므로 그때는 conic-gradient로 대신 그린다.
const SLICES = [
  { src: slice1, left: 341.329, top: 341.329, width: 341.329, height: 295.599 },
  { src: slice2, left: 170.664, top: 341.329, width: 341.329, height: 341.329 },
  { src: slice3, left: 0, top: 341.329, width: 341.329, height: 295.599 },
  { src: slice4, left: 0, top: 45.74, width: 341.329, height: 295.599 },
  { src: slice5, left: 170.664, top: 0, width: 341.329, height: 341.329 },
  { src: slice6, left: 341.329, top: 45.74, width: 341.329, height: 295.599 },
]
// 조각 이미지를 못 쓸 때(7명 이상) 쓰는 색 — 조각 SVG와 같은 순서·같은 색이다
const SLICE_COLORS = ['#ff4fd4', '#57ebfa', '#ffe23e', '#29db78', '#b899ff', '#ff8c8c']

// 룰렛 테두리를 따라 도는 전구 20개 — 프레임 좌표 그대로다
const BULBS = [
  [1623.7, 517.58], [1600.86, 631.66], [1534.57, 734.56], [1428.32, 816.23],
  [1298.23, 868.66], [1154.02, 886.73], [1009.82, 868.66], [879.72, 816.23],
  [773.48, 734.56], [707.19, 631.66], [684.35, 517.58], [707.19, 403.51],
  [773.48, 300.61], [879.72, 218.94], [1009.82, 166.51], [1154.02, 148.44],
  [1298.23, 166.51], [1428.32, 218.94], [1534.57, 300.61], [1600.86, 403.51],
]

// 바퀴(682.657px) 안에서 참가자 자리를 놓을 반지름과 자리 지름 — 인원수에 맞춰 원 위에 고르게 배치한다
const SEAT_RADIUS = 240
const SEAT_SIZE = 75.851

// 운명의 룰렛. 방장이 PICK을 누르면(30초 안에 안 누르면 서버가 대신) 서버가 당첨자를 확정하고,
// 화면은 SPINNING 단계의 payload가 알려 준 조각으로 회전만 재생한다.
export function RouletteGame() {
  const round = useRoomStore((s) => s.round)!
  const members = useRoomStore((s) => s.members)
  const isHost = useRoomStore(selectIsHost)
  const sendAction = useRoomStore((s) => s.sendAction)

  const config = round.config as RouletteConfig
  // 조각 배치는 명단 스냅샷 순서(=입장 순서)를 그대로 따른다
  const seats = round.roster
  const sliceAngle = 360 / seats.length

  const [rotation, setRotation] = useState(0)
  const spinning = round.phase === 'SPINNING' || round.phase === 'REVEAL'
  // 방장이 누른 뒤 서버 응답을 기다리는 동안 버튼을 잠근다 — 연타는 서버가 멱등 처리한다
  const [picked, setPicked] = useState(false)

  // SPINNING 단계의 payload에 당첨 조각 번호가 실려 온다. 결과 이벤트는 연출이 끝난 뒤라 늦다.
  const winnerIndex = round.phase === 'SPINNING' ? Number(round.payload?.winnerIndex ?? -1) : -1

  useEffect(() => {
    if (winnerIndex < 0) return
    // 조각의 중앙이 12시 방향에 오도록 — 조각은 12시부터 시계방향으로 배치돼 있다
    const centerAngle = winnerIndex * sliceAngle + sliceAngle / 2
    setRotation(SPIN_TURNS * 360 - centerAngle)
  }, [winnerIndex, sliceAngle])

  // 회전 시간은 서버가 준 마감까지다 (룰렛은 5초로 고정돼 있다)
  const phaseRemain = useRemainMs(round.deadlineAt)
  const spinMs = round.phase === 'SPINNING' ? Math.max(0, phaseRemain) : 5000

  // 조각 이미지는 6칸짜리라 인원이 다르면 색만으로 원을 채운다
  const useSliceImages = seats.length === 6
  const conic = `conic-gradient(${seats
    .map((_, i) => {
      const color = SLICE_COLORS[i % SLICE_COLORS.length]
      return `${color} ${i * sliceAngle}deg ${(i + 1) * sliceAngle}deg`
    })
    .join(', ')})`

  return (
    <>
      {/* ── 오른쪽 위 상태 ── */}
      <span className={styles.onlinePill}>◉ {members.length}명 실시간 접속</span>
      <span className={styles.topicPill}>
        <img src={GAME_ICONS.roulette} alt="" />
        {config.topic} 뽑기
      </span>

      {/* ── 왼쪽 참가자 목록 ── */}
      <span className={styles.listTitle}>◆ 팀 멤버 · {members.length}명</span>
      <div className={`${styles.list} scroll-thin`}>
        {members.map((member) => (
          <div key={member.memberId} className={styles.playerCard}>
            <span className={styles.playerAvatar}>
              <img src={avatarSrc(member.avatarId)} alt="" />
            </span>
            <span className={styles.playerName}>{member.nickname}</span>
            <span className={styles.playerMeta}>
              {member.isHost ? (
                <>
                  <img className={styles.playerCrown} src={crownIcon} alt="" />
                  방장 · 접속
                </>
              ) : (
                '● 접속 중'
              )}
            </span>
          </div>
        ))}
      </div>

      {/* ── 룰렛 무대 ── */}
      <span className={styles.glow} />
      <img className={styles.sunburstA} src={sunburstA} alt="" />
      <img className={styles.sunburstB} src={sunburstB} alt="" />

      <span className={styles.bubble}>누가 걸릴까?! 👀</span>

      <div
        className={styles.wheel}
        style={{
          transform: `rotate(${rotation}deg)`,
          ['--roulette-spin-ms' as string]: `${spinMs}ms`,
          background: useSliceImages ? undefined : conic,
        }}
      >
        {useSliceImages &&
          SLICES.map((s) => (
            <img
              key={s.src}
              className={styles.slice}
              src={s.src}
              alt=""
              style={{ left: s.left, top: s.top, width: s.width, height: s.height }}
            />
          ))}

        {seats.map((member, i) => {
          // 조각 중앙 방향으로 밀어낸 자리에 아바타와 이름을 놓는다 (12시부터 시계방향).
          // 화면 좌표계라 0도가 3시 방향이고 y는 아래로 커진다.
          const angleDeg = i * sliceAngle + sliceAngle / 2 - 90
          const angle = angleDeg * (Math.PI / 180)
          const x = 341.329 + SEAT_RADIUS * Math.cos(angle) - SEAT_SIZE / 2
          const y = 341.329 + SEAT_RADIUS * Math.sin(angle) - SEAT_SIZE / 2
          return (
            <div
              key={member.memberId}
              className={styles.seat}
              // 아바타-이름 줄은 기본이 아래 방향(=+90도)이라, 조각 중앙 방향에 90도를 더하면
              // 아바타는 바깥에 남고 이름이 룰렛 중심 쪽을 향한다. 바퀴와 함께 돌아간다.
              style={{ left: x, top: y, transform: `rotate(${angleDeg + 90}deg)` }}
            >
              <span className={styles.seatRing}>
                <img src={avatarSrc(member.avatarId)} alt="" />
              </span>
              <span className={styles.seatName}>{member.nickname}</span>
            </div>
          )
        })}
      </div>

      <span className={styles.ring} />
      {BULBS.map(([x, y], i) => (
        <span
          key={`${x}-${y}`}
          className={i % 2 === 0 ? styles.bulb : `${styles.bulb} ${styles.bulbLit}`}
          style={{ left: x, top: y }}
        />
      ))}

      <span className={styles.hubGlow} />
      {/* 원판 중앙은 표시만 한다 — 돌리는 버튼은 아래 상태 밴드 가운데에 있다 */}
      <span className={styles.hub}>PICK!</span>
      <img className={styles.pointer} src={pointer} alt="" />
      <span className={styles.pointerDot} />

      <GameHud
        badge={round.deadlineAt ? Math.max(0, Math.ceil(phaseRemain / 1000)) : '◷'}
        title={
          round.phase === 'ARMED'
            ? isHost
              ? 'PICK을 눌러주세요'
              : '방장이 돌리기를 기다리는 중'
            : spinning
              ? '돌리는 중…'
              : '곧 돌아갑니다'
        }
        note={
          round.phase === 'ARMED'
            ? `제한 시간 안에 아무도 누르지 않으면 저절로 돌아가요`
            : spinning
              ? `${members.length}명 화면에서 동시에 회전 중 · 곧 ${config.topic} 공개`
              : `${config.topic}을(를) 뽑는 룰렛이 곧 열려요`
        }
        // 방장만 누를 수 있고, 30초 안에 안 누르면 서버가 대신 돌린다
        center={
          round.phase === 'ARMED' &&
          (isHost ? (
            <button
              type="button"
              className={styles.spinButton}
              disabled={picked}
              onClick={() => {
                setPicked(true)
                sendAction('roulette.pick')
              }}
            >
              돌리기
            </button>
          ) : (
            <span className={styles.spinWaiting}>방장이 돌리기를 기다리는 중</span>
          ))
        }
        right={<HudPill>★ 결과는 아무도 못 바꿔요 · 모두 똑같이</HudPill>}
      />
    </>
  )
}
