import { useEffect, useState } from 'react'

import { GameHud, HudPill } from '../../../components/common'
import { avatarSrc } from '../../../assets/avatars'
import { AVATAR_TILE_COLORS } from '../../../constants/avatarTiles'
import { toSeconds, useRemainMs } from '../../../hooks/useServerClock'
import { useRoomStore } from '../../../store/roomStore'
import type { RosterEntry, SnipeConfig } from '../../../protocol/types'
import styles from './SnipeGame.module.css'

// 조준경 한 칸의 바깥 링 지름 — 링 안쪽 좌표는 전부 이 값의 절반(=중심)을 기준으로 잡는다
const RING = 160.313
// 프레임(542:1432)의 6인 배치에서 읽은 칸 간격
const COL_PITCH = 398.75
const ROW_PITCH = 294.21
// 사격장 카드의 가로 가운데 (카드가 x59~1280이라 중앙이 669.58)
const GRID_CX = 669.58
// 격자 첫 줄의 맨 윗변 — 카드 위쪽 라벨 알약(y264~315) 아래에서 시작한다
const GRID_TOP = 328.8
// 조준경 중심에서 위로 삐져나오는 조준선 길이 (격자를 세로 가운데로 맞출 때 쓴다)
const BLOCK_ABOVE = 96

// 총알 궤적 장식 — 프레임이 그려둔 4갈래를 그대로 옮겼다.
// 누가 누구를 쐈는지는 익명이라 실제 투표와 이어붙이면 안 되고, 발사된 개수만큼만 켠다.
// 각 갈래는 [궤적 점 5개(x, y, 지름), 총알 한 발] 순서다.
const TRACER_TRAILS: { dots: [number, number, number][]; bullet: [number, number] }[] = [
  {
    dots: [
      [485.33, 420.04, 9.492],
      [468, 421.09, 7.383],
      [460.33, 421.88, 5.801],
      [442.67, 422.67, 4.219],
      [424.67, 423.2, 3.164],
    ],
    bullet: [501.33, 417.93],
  },
  {
    dots: [
      [663.92, 587.69, 9.492],
      [664.98, 553.98, 7.383],
      [665.77, 540.01, 5.801],
      [666.56, 526.03, 4.219],
      [667.08, 511.79, 3.164],
    ],
    bullet: [661.81, 600.35],
  },
  {
    dots: [
      [891.72, 587.8, 9.492],
      [879.58, 558.41, 7.383],
      [854.17, 548.77, 5.801],
      [841.77, 539.12, 4.219],
      [829.1, 529.21, 3.164],
    ],
    bullet: [902.81, 596.13],
  },
  {
    dots: [
      [380.8, 557.25, 9.492],
      [368.93, 547.86, 7.383],
      [356.73, 538.21, 5.801],
      [344.53, 528.56, 4.219],
      [332, 518.65, 3.164],
    ],
    bullet: [391.33, 585.58],
  },
]

// 아바타별 타일 색 — 조준경 안쪽 원판과 "발사 완료" 알약이 같은 색을 쓴다 (프레임 확인값)
function tileColor(avatarId: string | null | undefined) {
  return AVATAR_TILE_COLORS[(avatarId ?? '').toUpperCase()] ?? 'var(--color-lavender)'
}

// 익명 저격. 질문에 어울리는 사람을 제한시간 안에 지목하고, 누가 찍었는지는 설정에 따라 결과에서만 공개된다.
export function SnipeGame() {
  const round = useRoomStore((s) => s.round)!
  const me = useRoomStore((s) => s.me?.memberId ?? null)
  const progress = useRoomStore((s) => s.progress)
  const tie = useRoomStore((s) => s.tie)
  const result = useRoomStore((s) => s.result)
  const sendAction = useRoomStore((s) => s.sendAction)

  const config = round.config as SnipeConfig
  // 서버는 사람별 제출 여부를 주지 않고 건수만 준다
  const counts = (progress ?? null) as { votedCount?: number; totalCount?: number } | null
  const [picked, setPicked] = useState<string[]>([])
  const [voted, setVoted] = useState(false)

  // 결선 투표가 열리면 선택을 초기화한다
  useEffect(() => {
    setPicked([])
    setVoted(false)
  }, [round.phase, round.tieRound])

  // 결선이면 동점 후보만 지목할 수 있다
  const candidateIds =
    tie && round.phase === 'RUNOFF' ? tie.candidateIds : round.roster.map((m) => m.memberId)

  const toggle = (memberId: string) => {
    if (voted || memberId === me || result) return
    setPicked((prev) => {
      if (prev.includes(memberId)) return prev.filter((id) => id !== memberId)
      if (!config.multiVote) return [memberId]
      return [...prev, memberId]
    })
  }

  // **기권은 보내지 않는 것이다.** 빈 배열을 보내면 서버가 vote.limit_exceeded로 거절한다
  // (`app/domain/games/snipe.py`의 check_ballot). 기권자는 마감 때 명단에서 빠진 수로 집계된다.
  // 프레임의 버튼이 하나뿐이라 같은 자리에서 지목과 기권을 함께 처리한다.
  const submit = () => {
    if (picked.length > 0) sendAction('snipe.vote', { targetMemberIds: picked })
    setVoted(true)
  }

  const members = round.roster
  const firedCount = counts?.votedCount ?? 0
  const remainSec = toSeconds(useRemainMs(round.deadlineAt))

  // 6명까지는 프레임 그대로 3×2, 그 이상은 4열로 늘리고 칸을 그만큼 줄인다 (방 정원이 10명이라서)
  const cols = members.length <= 6 ? 3 : 4
  const rows = Math.ceil(members.length / cols)
  const scale = Math.min(3 / cols, 2 / rows, 1)
  const gridCy = GRID_TOP + BLOCK_ABOVE * scale + ((rows - 1) * ROW_PITCH * scale) / 2

  // 내가 쏠 수 있는 대상 — 자기 자신은 뺀다. 결선이면 동점자만 남는다
  const targets = members.filter((m) => m.memberId !== me && candidateIds.includes(m.memberId))

  return (
    <>
      {/* ── 질문 띠 ── */}
      <div className={styles.question}>
        <span className={styles.questionIcon}>🎯</span>
        <span className={styles.questionText}>
          {round.phase === 'RUNOFF' ? '동점! 결선 저격' : config.question}
        </span>
        <span className={styles.questionPill}>
          🎯 {remainSec}초 · {firedCount}/{members.length} 발사
        </span>
      </div>

      {/* ── 사격장 ── */}
      <section className={styles.range}>
        <span className={styles.rangeGrid} />
        <span className={styles.rangeLabel}>
          {result ? '🎯 사격 종료 · 집계 중' : tie ? '🎯 결선 사격장' : '🎯 사격장 · 조준 중'}
        </span>
        <span className={styles.tension}>🎯 누가 걸릴까?!</span>
      </section>

      {/* ── 조준경 격자 — 참가자 한 명이 한 칸 ── */}
      {members.map((member, i) => {
        const cx = GRID_CX + ((i % cols) - (cols - 1) / 2) * COL_PITCH * scale
        const cy = gridCy + (Math.floor(i / cols) - (rows - 1) / 2) * ROW_PITCH * scale
        // 사람별 제출 여부는 서버가 감추므로 조준경에는 후보 여부만 그린다
        const out = !candidateIds.includes(member.memberId)
        return (
          <div
            key={member.memberId}
            className={out ? `${styles.target} ${styles.targetOut}` : styles.target}
            style={{
              left: cx - (RING / 2) * scale,
              top: cy - (RING / 2) * scale,
              transform: `scale(${scale})`,
            }}
          >
            <span className={styles.ring1} />
            <span className={styles.ring2} />
            <span className={styles.ring3} />
            <span className={`${styles.tick} ${styles.tickTop}`} />
            <span className={`${styles.tick} ${styles.tickBottom}`} />
            <span className={`${styles.tick} ${styles.tickLeft}`} />
            <span className={`${styles.tick} ${styles.tickRight}`} />
            <span className={styles.disc} style={{ background: tileColor(member.avatarId) }} />
            <img className={styles.face} src={avatarSrc(member.avatarId)} alt="" />
            <span className={styles.targetName}>{member.nickname}</span>
            <span className={styles.targetState}>{out ? '후보 아님' : '조준 중…'}</span>
          </div>
        )
      })}

      {/* 발사된 수만큼 켜지는 궤적 장식 — 3열 배치(6인 이하)에 맞춰 그려져 있어 그때만 보여준다 */}
      {cols === 3 &&
        TRACER_TRAILS.slice(0, Math.min(firedCount, TRACER_TRAILS.length)).map((trail, ti) => (
          <div key={ti}>
            {trail.dots.map(([x, y, d], di) => (
              <span
                key={di}
                className={styles.tracer}
                style={{ left: x, top: y, width: d, height: d }}
              />
            ))}
            <span className={styles.bullet} style={{ left: trail.bullet[0], top: trail.bullet[1] }} />
          </div>
        ))}

      {/* 익명이라는 걸 못 박는 장식 스티커 — 4열로 늘어나면 조준경과 겹쳐서 감춘다 */}
      {cols === 3 && (
        <div className={styles.hush}>
          <span className={styles.hushLock}>🔒</span>
          <span className={styles.hushText}>쉿!</span>
        </div>
      )}

      {/* ── 내 저격 패널 ── */}
      <aside className={styles.panel}>
        <h2 className={styles.panelTitle}>🔫 내 저격</h2>
        <span className={styles.panelSub}>
          익명 · {config.multiVote ? '여러 명' : '1명'} 지목 · {config.voteSeconds}초 안에
        </span>

        <div className={styles.panelList}>
          {targets.map((target: RosterEntry) => {
            const on = picked.includes(target.memberId)
            return (
              <button
                key={target.memberId}
                type="button"
                className={on ? `${styles.pick} ${styles.pickOn}` : styles.pick}
                disabled={voted || result !== null}
                onClick={() => toggle(target.memberId)}
              >
                <span
                  className={styles.pickDisc}
                  style={{ background: tileColor(target.avatarId) }}
                />
                <img className={styles.pickFace} src={avatarSrc(target.avatarId)} alt="" />
                <span className={styles.pickName}>{target.nickname}</span>
                <span className={styles.pickMark}>{on ? '🎯' : '○'}</span>
              </button>
            )
          })}
        </div>

        {/* 지목자 공개 설정 자체가 없다 — 어느 판에서도 비공개다 */}
        <span className={styles.panelNote}>🔒 누가 누굴 쐈는지 안 보여요</span>

        {result ? (
          <span className={`${styles.fire} ${styles.fireDone}`}>🎯 집계 완료!</span>
        ) : voted ? (
          <span className={`${styles.fire} ${styles.fireDone}`}>✓ 발사 완료 · 집계 대기</span>
        ) : (
          <button
            type="button"
            className={picked.length === 0 ? `${styles.fire} ${styles.fireAbstain}` : styles.fire}
            onClick={submit}
          >
            {picked.length === 0 ? '🙈 기권하기' : '🔫 발사!'}
          </button>
        )}
      </aside>

      <GameHud
        title={
          result
            ? '🎯 저격 집계 완료!'
            : round.phase === 'RUNOFF'
              ? '🎯 동점! 결선 저격 중…'
              : '🎯 저격 투표 중…'
        }
        note={`${config.voteSeconds}초 안에 익명 지목 · 최다 피격자가 당첨! · 결과는 총알 궤적으로 공개`}
        largeNote
        right={<HudPill tone="red">동점이면 동점자끼리 결선 투표</HudPill>}
      />
    </>
  )
}
