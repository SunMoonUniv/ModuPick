import { useEffect, useMemo, useState } from 'react'

import { GameHud, HudPill } from '../../../components/common'
import { avatarSrc } from '../../../assets/avatars'
import { GAME_ICONS } from '../../../constants/gameVisuals'
import { useRemainMs } from '../../../hooks/useServerClock'
import { selectIsHost, useRoomStore } from '../../../store/roomStore'
import type { LadderConfig, LadderDrawPayload } from '../../../protocol/types'
import styles from './LadderGame.module.css'

// 레인 색 — 참가자 수만큼 순환한다. 기둥·도착 칩·이름표·꼬리가 모두 같은 색을 쓴다.
const LANE_COLORS = [
  'var(--color-yellow)',
  'var(--color-pink)',
  'var(--color-cyan)',
  'var(--color-online)',
  'var(--color-lilac)',
  'var(--color-teal)',
]
// 오른쪽 매칭 카드의 옅은 배경 — 레인 색과 짝을 이룬다
const CARD_TINTS = [
  '#fffadc',
  '#ffdff7',
  '#e1fbfe',
  '#d8f9e7',
  '#f2edff',
  '#e6fafa',
]

// 사다리판 좌표 (프레임 542:935 기준) — 6명일 때 레인 간격이 정확히 207px가 되도록 잡았다
const BOARD_LEFT = 59
const BOARD_SPAN = 1242
const POLE_TOP = 213.67
const POLE_HEIGHT = 610
const RUNG_TOP = 306.75
const RUNG_BOTTOM = 786.67
// 레인 간격 상한 (6명일 때의 간격). 인원이 적을수록 판을 넓히지 않고 가운데로 모은다 —
// 간격이 벌어지면 같은 속도로 건너가는 데 시간이 더 걸려 사다리가 느려 보인다.
const LANE_MAX = 207

// 주자별 내려가는 속도 배수 (1.00~1.18). 전원이 똑같이 내려가면 기계처럼 보여서 조금씩 흔든다.
// memberId에서 뽑으므로 모든 참가자 화면에서 같은 값이 나온다 — Math.random이면 화면마다 달라진다.
// 가장 느린 주자도 마감 시점에는 바닥에 닿으므로 결과 공개와 어긋나지 않는다.
const runnerSpeed = (memberId: string) => {
  let hash = 0
  for (let i = 0; i < memberId.length; i += 1) hash = (hash * 31 + memberId.charCodeAt(i)) >>> 0
  return 1 + ((hash % 1000) / 1000) * 0.18
}

// 랜덤 사다리. 서버가 확정한 사다리 구조와 최종 배정을 그대로 그려 화면 경로와 결과가 어긋날 수 없게 한다.
export function LadderGame() {
  const round = useRoomStore((s) => s.round)!
  const isHost = useRoomStore(selectIsHost)
  const sendAction = useRoomStore((s) => s.sendAction)

  const config = round.config as LadderConfig
  const members = round.roster
  const laneCount = members.length || 1
  const laneWidth = Math.min(BOARD_SPAN / laneCount, LANE_MAX)
  // 판이 좁아지면 남는 폭만큼 가운데로 민다
  const boardLeft = BOARD_LEFT + (BOARD_SPAN - laneWidth * laneCount) / 2
  const chipWidth = Math.min(186, laneWidth - 21)

  // 방장이 누른 뒤 서버 응답을 기다리는 동안 버튼을 잠근다 — 연타는 서버가 멱등 처리한다
  const [started, setStarted] = useState(false)
  const phaseRemain = useRemainMs(round.deadlineAt)

  // 가로줄과 배정은 DRAWING 단계의 payload로만 온다. 다음 단계에서 payload가 비므로 붙잡아 둔다.
  const [draw, setDraw] = useState<LadderDrawPayload | null>(null)
  useEffect(() => {
    if (round.phase !== 'DRAWING' || !round.payload) return
    setDraw(round.payload as unknown as LadderDrawPayload)
  }, [round.phase, round.payload])

  const structure = useMemo(() => {
    if (!draw) return null
    const rungs = draw.ladderRungs.map((r) => ({ row: r.row, lane: r.leftLane }))
    return { rungs, rowCount: Math.max(1, ...draw.ladderRungs.map((r) => r.row + 1)) }
  }, [draw])

  // 주자가 위에서 아래로 내려가는 진행률(0→1)을 DRAWING 마감에 맞춰 올린다
  const [progress, setProgress] = useState(0)
  const drawing = round.phase === 'DRAWING'
  useEffect(() => {
    if (!drawing || !round.deadlineAt) return
    const endAt = Date.parse(round.deadlineAt)
    const startAt = Date.now()
    const total = Math.max(1, endAt - startAt)
    let raf = 0
    const step = () => {
      const p = Math.min(1, (Date.now() - startAt) / total)
      setProgress(p)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [drawing, round.deadlineAt])

  // 연출이 끝난 REVEAL 이후에는 주자를 바닥에 붙여 둔다
  useEffect(() => {
    if (round.phase === 'REVEAL' || round.phase === 'RESULT') setProgress(1)
  }, [round.phase])

  // 레인 i의 중심 x — 주자·꼬리는 레인 사이를 건너가느라 정수가 아닌 레인 값도 넣는다
  const laneX = (lane: number) => boardLeft + lane * laneWidth + laneWidth / 2
  // 레인 i의 기둥 x (기둥 폭 12.656의 왼쪽 끝)
  const poleX = (i: number) => laneX(i) - 6.328
  // 가로줄 row의 y
  const rungY = (row: number, rowCount: number) =>
    rowCount <= 1 ? RUNG_TOP : RUNG_TOP + (row * (RUNG_BOTTOM - RUNG_TOP)) / (rowCount - 1)

  // 주자별 경로를 꺾은선(꼭짓점 목록)으로 미리 접어두고 구간 길이도 함께 잰다.
  // 진행률을 "남은 칸 수"가 아니라 "이동한 거리"에 태워야 내려갈 때와 건너갈 때의 속도가 같다
  // (홈 화면 미리보기가 offset-path로 얻는 것과 같은 등속 이동이다).
  const paths = useMemo(() => {
    if (!structure) return null
    const rowCount = Math.max(1, structure.rowCount)
    const x = (lane: number) => boardLeft + lane * laneWidth + laneWidth / 2
    const y = (row: number) =>
      rowCount <= 1 ? RUNG_TOP : RUNG_TOP + (row * (RUNG_BOTTOM - RUNG_TOP)) / (rowCount - 1)
    // row 칸에서 lane에 붙은 가로줄을 타면 도착하는 레인 (없으면 그대로)
    const crossTo = (row: number, lane: number) => {
      if (structure.rungs.some((r) => r.row === row && r.lane === lane)) return lane + 1
      if (structure.rungs.some((r) => r.row === row && r.lane === lane - 1)) return lane - 1
      return lane
    }

    return Array.from({ length: laneCount }, (_, index) => {
      const points = [{ x: x(index), y: POLE_TOP }]
      let lane = index
      for (let row = 0; row < rowCount; row += 1) {
        const next = crossTo(row, lane)
        if (next === lane) continue
        // 가로줄 높이까지 내려온 지점과 건너간 지점 — 그 사이가 가로 이동 구간이다
        points.push({ x: x(lane), y: y(row) }, { x: x(next), y: y(row) })
        lane = next
      }
      points.push({ x: x(lane), y: POLE_TOP + POLE_HEIGHT })

      const lengths = points
        .slice(1)
        .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
      return { points, lengths, total: lengths.reduce((a, b) => a + b, 0) }
    })
  }, [structure, laneCount, laneWidth, boardLeft])

  // 주자가 지금 있는 x·y — 경로 위를 일정한 속도로 걸어간 거리로 찾는다
  const runnerAt = (index: number, speed: number) => {
    const path = paths?.[index]
    if (!path) return { x: laneX(index), y: POLE_TOP }
    // 주자마다 속도가 조금 달라 같은 진행률이라도 서 있는 자리가 다르다. 도착 레인은 구조가 정하므로 바뀌지 않는다
    let left = Math.min(1, progress * speed) * path.total
    for (let i = 0; i < path.lengths.length; i += 1) {
      const len = path.lengths[i]
      if (left <= len || i === path.lengths.length - 1) {
        const f = len > 0 ? Math.min(1, left / len) : 1
        const a = path.points[i]
        const b = path.points[i + 1]
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
      }
      left -= len
    }
    return path.points[path.points.length - 1]
  }

  // 도착 칸에 놓인 항목 — 배정의 slot이 곧 도착 레인 번호다
  const bottomItem = (lane: number) => {
    if (!draw) return '???'
    return draw.assignments.find((a) => a.slot === lane)?.label ?? 'X'
  }

  return (
    <>
      {/* ── 오른쪽 위 상태 ── */}
      {/* 사다리 이모지(🪜, 이모지 13.0)는 윈도우 10 기본 글꼴에 없어 두부(□)로 나온다 — 저장소의 게임 아이콘을 쓴다 */}
      <span className={styles.startBanner}>
        <img className={styles.emblem} src={GAME_ICONS.ladder} alt="" /> 동시 시작!
      </span>
      <span className={styles.goCard}>
        GO GO! <img className={styles.emblem} src={GAME_ICONS.ladder} alt="" />
      </span>
      <span className={styles.tracePill}>
        {drawing
          ? `◷ 경로 추적 중… ${Math.max(0, Math.ceil(phaseRemain / 1000))}s`
          : round.phase === 'ARMED'
            ? `◷ 출발 대기 ${Math.max(0, Math.ceil(phaseRemain / 1000))}s`
            : '◷ 곧 출발'}
      </span>

      {/* ── 사다리판 ── */}
      {members.map((member, i) => {
        const color = LANE_COLORS[i % LANE_COLORS.length]
        return (
          <span
            key={`pole-${member.memberId}`}
            className={styles.pole}
            style={{ left: poleX(i), background: color }}
          />
        )
      })}

      {structure &&
        structure.rungs.map((rung) => (
          <span
            key={`rung-${rung.row}-${rung.lane}`}
            className={styles.rung}
            style={{
              left: poleX(rung.lane) + 6.328,
              top: rungY(rung.row, structure.rowCount),
              width: laneWidth,
            }}
          />
        ))}

      {/* 주자 뒤로 남는 꼬리 */}
      {draw &&
        members.map((member, i) => {
          const color = LANE_COLORS[i % LANE_COLORS.length]
          const { x, y } = runnerAt(i, runnerSpeed(member.memberId))
          return (
            <span
              key={`trail-${member.memberId}`}
              className={styles.trail}
              style={{
                left: x - 9.492,
                top: Math.max(POLE_TOP, y - 112.87),
                background: `linear-gradient(to bottom, transparent 0%, ${color} 100%)`,
              }}
            />
          )
        })}

      {/* 주자 — 아바타 원 + 이름 알약 */}
      {members.map((member, i) => {
        const color = LANE_COLORS[i % LANE_COLORS.length]
        const { x, y } = runnerAt(i, runnerSpeed(member.memberId))
        return (
          <div
            key={`runner-${member.memberId}`}
            className={styles.runner}
            style={{ left: x, top: y }}
          >
            <span className={styles.runnerChip} style={{ background: color }}>
              {member.nickname}
            </span>
            <span className={styles.runnerRing} style={{ background: color }}>
              <img src={avatarSrc(member.avatarId)} alt="" />
            </span>
          </div>
        )
      })}

      {/* 도착 칸 */}
      {members.map((_, i) => (
        <span
          key={`goal-${i}`}
          className={styles.goal}
          style={{
            left: boardLeft + i * laneWidth + (laneWidth - chipWidth) / 2,
            width: chipWidth,
            background: LANE_COLORS[i % LANE_COLORS.length],
          }}
        >
          {bottomItem(i)}
        </span>
      ))}

      {/* ── 오른쪽 매칭 현황 ── */}
      <aside className={styles.panel}>
        <span className={styles.panelTitle}>◆ 매칭 현황</span>
        <span className={styles.panelNote}>경로를 다 타면 확정!</span>
        <span className={styles.panelRule} />
        <div className={`${styles.panelList} scroll-thin`}>
          {members.map((member, i) => {
            const item = draw?.assignments.find((a) => a.memberId === member.memberId)?.label
            return (
              <div
                key={member.memberId}
                className={styles.memberCard}
                style={{ background: CARD_TINTS[i % CARD_TINTS.length] }}
              >
                <span
                  className={styles.memberAvatar}
                  style={{ background: LANE_COLORS[i % LANE_COLORS.length] }}
                >
                  <img src={avatarSrc(member.avatarId)} alt="" />
                </span>
                <span className={styles.memberName}>{member.nickname}</span>
                <span className={styles.roleSlot}>
                  <span className={item ? styles.roleValue : styles.rolePending}>{item ?? '???'}</span>
                  {!item && (
                    <span
                      className={styles.roleMark}
                      style={{ color: LANE_COLORS[i % LANE_COLORS.length] }}
                    >
                      ?
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </aside>

      <GameHud
        title={drawing ? '◷ 사다리 타는 중…' : '◷ 곧 출발합니다'}
        note={
          drawing
            ? `${members.length}명의 경로를 동시에 추적 · ${config.topic} 역할이 한 번에 배분돼요`
            : `방장이 실행하면 ${members.length}명이 동시에 출발해요`
        }
        // 방장만 누를 수 있고, 30초 안에 안 누르면 서버가 대신 실행한다
        center={
          round.phase === 'ARMED' &&
          (isHost ? (
            <button
              type="button"
              className={styles.startButton}
              disabled={started}
              onClick={() => {
                setStarted(true)
                sendAction('ladder.start')
              }}
            >
              사다리 타기
            </button>
          ) : (
            <span className={styles.startWaiting}>방장이 실행하기를 기다리는 중</span>
          ))
        }
        right={<HudPill>★ 결과는 모두에게 똑같이 · 공정</HudPill>}
      />
    </>
  )
}
