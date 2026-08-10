import { useEffect, useState } from 'react'

import { GameHud, HudPill } from '../../../components/common'
import { avatarSrc } from '../../../assets/avatars'
import { useRemainMs } from '../../../hooks/useServerClock'
import { useRoomStore } from '../../../store/roomStore'
import type { AssignResult, LadderConfig } from '../../../protocol/types'
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

// 랜덤 사다리. 서버가 확정한 사다리 구조와 최종 배정을 그대로 그려 화면 경로와 결과가 어긋날 수 없게 한다.
export function LadderGame() {
  const round = useRoomStore((s) => s.round)!
  const result = useRoomStore((s) => s.result)

  const config = round.config as LadderConfig
  const members = round.roundMembers
  const laneCount = members.length || 1
  const laneWidth = BOARD_SPAN / laneCount
  const chipWidth = Math.min(186, laneWidth - 21)

  const assign = result?.variant === 'assign' ? (result.result as AssignResult) : null
  const structure = assign?.ladder ?? null
  const revealRemain = useRemainMs(result?.resultScreenAt ?? null)

  // 결과가 도착하면 주자가 위에서 아래로 내려가는 진행률(0→1)을 시간에 맞춰 올린다
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    if (!result) return
    const endAt = new Date(result.resultScreenAt).getTime()
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
  }, [result])

  // 레인 i의 기둥 중심 x
  const poleX = (i: number) => BOARD_LEFT + i * laneWidth + laneWidth / 2 - 6.328
  // 가로줄 row의 y
  const rungY = (row: number, rowCount: number) =>
    rowCount <= 1 ? RUNG_TOP : RUNG_TOP + (row * (RUNG_BOTTOM - RUNG_TOP)) / (rowCount - 1)

  // 주자가 지금 서 있는 레인과 높이 — 구조가 있으면 실제 경로를 따라가고, 없으면 출발선에 세워둔다
  const runnerAt = (index: number) => {
    if (!structure) return { lane: index, y: POLE_TOP }
    const rowsDone = Math.floor(progress * structure.rowCount)
    let lane = index
    for (let row = 0; row < rowsDone; row += 1) {
      if (structure.rungs.some((r) => r.row === row && r.lane === lane)) lane += 1
      else if (structure.rungs.some((r) => r.row === row && r.lane === lane - 1)) lane -= 1
    }
    return { lane, y: POLE_TOP + progress * POLE_HEIGHT }
  }

  // 도착 레인에 놓인 항목 — 배정 결과를 역으로 찾아 채운다
  const bottomItem = (lane: number) => {
    if (!assign) return '???'
    const arrivals = assign.ladder?.arrivals ?? []
    const index = arrivals.findIndex((arrival) => arrival === lane)
    return index >= 0 ? (assign.assignments[index]?.item ?? 'X') : 'X'
  }

  return (
    <>
      {/* ── 오른쪽 위 상태 ── */}
      <span className={styles.startBanner}>🪜 동시 시작!</span>
      <span className={styles.goCard}>GO GO! 🪜</span>
      <span className={styles.tracePill}>
        {assign ? `◷ 경로 추적 중… ${Math.max(0, Math.ceil(revealRemain / 1000))}s` : '◷ 곧 출발'}
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
      {result &&
        members.map((member, i) => {
          const color = LANE_COLORS[i % LANE_COLORS.length]
          const { lane, y } = runnerAt(i)
          return (
            <span
              key={`trail-${member.memberId}`}
              className={styles.trail}
              style={{
                left: poleX(lane) - 3.164,
                top: Math.max(POLE_TOP, y - 112.87),
                background: `linear-gradient(to bottom, transparent 0%, ${color} 100%)`,
              }}
            />
          )
        })}

      {/* 주자 — 아바타 원 + 이름 알약 */}
      {members.map((member, i) => {
        const color = LANE_COLORS[i % LANE_COLORS.length]
        const { lane, y } = runnerAt(i)
        return (
          <div
            key={`runner-${member.memberId}`}
            className={styles.runner}
            style={{ left: poleX(lane) + 6.328, top: y }}
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
            left: BOARD_LEFT + i * laneWidth + (laneWidth - chipWidth) / 2,
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
            const item = assign?.assignments.find((a) => a.member.memberId === member.memberId)?.item
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
        title={assign ? '◷ 사다리 타는 중…' : '◷ 곧 출발합니다'}
        note={
          assign
            ? `${members.length}명의 경로를 동시에 추적 · ${config.topic} 역할이 한 번에 배분돼요`
            : `가이드가 끝나면 ${members.length}명이 동시에 출발해요`
        }
        right={<HudPill>★ 결과는 모두에게 똑같이 · 공정</HudPill>}
      />
    </>
  )
}
