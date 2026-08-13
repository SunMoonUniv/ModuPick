import { useEffect, useState } from 'react'

import { GameHud, HudPill } from '../../../components/common'
import { avatarSrc } from '../../../assets/avatars'
import { AVATAR_TILE_COLORS } from '../../../constants/avatarTiles'
import { toSeconds, useRemainMs } from '../../../hooks/useServerClock'
import { useRoomStore } from '../../../store/roomStore'
import type { MemberId, NunchiConfig, NunchiRoundProgress } from '../../../protocol/types'
import styles from './NunchiGame.module.css'

// 참가자 카드 한 장의 프레임 기준 폭 — 6명일 때 이 값이 그대로 쓰이고, 더 많으면 줄어든다
const CARD_W = 223.594
const BOARD_W = 1803
// 카드가 줄어들 때 최소한 남겨두는 간격
const MIN_GAP = 16

// 라운드 띠 오른쪽 눈금이 차지하는 구간 (왼쪽 게이지와 겹치지 않는 선)
const DOT_SIZE = 31.641
const DOT_RIGHT = 1187.64
const DOT_SPAN = 312

// 아바타별 타일 색 — 카드의 아바타 링과 눌린 순서 목록이 같은 색을 쓴다
function tileColor(avatarId: string | null | undefined) {
  return AVATAR_TILE_COLORS[(avatarId ?? '').toUpperCase()] ?? 'var(--color-lavender)'
}

// 눈치게임. UP을 누른 사람은 후보에서 빠지고, 끝까지 못 누른 한 명이 최종 결과가 된다.
export function NunchiGame() {
  const round = useRoomStore((s) => s.round)!
  const me = useRoomStore((s) => s.me?.memberId ?? null)
  const progress = useRoomStore((s) => s.progress)
  const result = useRoomStore((s) => s.result)
  const sendAction = useRoomStore((s) => s.sendAction)

  const config = round.config as NunchiConfig
  const [pressed, setPressed] = useState(false)

  // **누른 사람은 혼자든 겹쳤든 후보에서 빠진다.** 못 누른 사람만 다음 라운드로 남는다.
  // 라운드 판정은 라운드가 끝난 뒤에만 온다 — 진행 중에 보이면 그것이 곧 정답이기 때문이다.
  const roundLog = (progress ?? null) as NunchiRoundProgress | null
  const [outIds, setOutIds] = useState<MemberId[]>([])

  // 판이 새로 열리면 누적한 빠져나간 사람 목록을 비운다
  useEffect(() => {
    if (round.phase === 'GUIDE') setOutIds([])
  }, [round.phase])

  // 라운드 판정이 오면 그 회차에 빠진 사람을 누적한다
  useEffect(() => {
    const out = roundLog?.eliminatedMemberIds
    if (!out || out.length === 0) return
    setOutIds((prev) => [...new Set([...prev, ...out])])
  }, [roundLog])

  // 새 라운드가 열리면 다시 누를 수 있어야 한다
  useEffect(() => {
    if (round.phase === 'ROUND') setPressed(false)
  }, [round.phase, round.phaseSeq])

  const members = round.roster
  // 아직 뽑힐 수 있는 사람들 — 눌러서 빠진 사람을 뺀 나머지다
  const candidateIds = members.map((m) => m.memberId).filter((id) => !outIds.includes(id))
  const amCandidate = me !== null && candidateIds.includes(me)
  const remainMs = useRemainMs(round.deadlineAt)

  // 눌린 순서와 시각은 서버가 잰 값이다 (라운드가 끝난 뒤 한 번에 온다)
  const presses = (roundLog?.verdicts ?? [])
    .filter((v) => v.elapsedMs !== null)
    .sort((a, b) => (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0))
  const verdictOf = new Map((roundLog?.verdicts ?? []).map((v) => [v.memberId, v.verdict]))
  const orderOf = new Map(presses.map((v, i) => [v.memberId, i + 1]))
  const nextOrder = presses.length + 1
  const waitingCount = candidateIds.filter((id) => !orderOf.has(id)).length
  const roundNo = roundLog?.round ?? 1
  const windowSec = (config.windowMs / 1000).toFixed(1)
  const limitSec = config.roundSeconds
  const gaugeRatio = Math.max(0, Math.min(1, remainMs / (config.roundSeconds * 1000)))

  // 카드 줄 자체가 눌린 순서표가 된다 — 누른 사람이 순번대로 왼쪽으로 당겨지고 아직 안 누른 사람은 뒤로 밀린다
  // 지난 라운드에 이미 빠진 사람은 이번 라운드 순번이 없으므로 맨 앞에 그대로 쌓아 둔다
  const rankOf = (id: MemberId) => {
    const order = orderOf.get(id)
    if (order) return 1000 + order
    return outIds.includes(id) ? 0 : 2000
  }
  // sort가 안정 정렬이라 같은 순위끼리는 명단 순서를 지킨다
  const lineup = [...members].sort((a, b) => rankOf(a.memberId) - rankOf(b.memberId))

  // 카드가 6장을 넘으면 폭을 줄여서 한 줄에 다 들어가게 한다 (방 정원이 10명이라서)
  const cardW = Math.min(CARD_W, (BOARD_W - (members.length - 1) * MIN_GAP) / members.length)
  const cardGap = members.length > 1 ? (BOARD_W - members.length * cardW) / (members.length - 1) : 0

  // 눈금 사이 간격 — 인원이 많아지면 좁혀서 정해진 구간 안에 붙여둔다
  const dotCount = candidateIds.length
  const dotGap = Math.max(4, (DOT_SPAN - dotCount * DOT_SIZE) / Math.max(1, dotCount - 1))

  // 아무도 못 눌렀거나 남은 전원이 눌러버리면 그 회차로는 가릴 수 없어 방장의 결정을 기다린다
  // (전용 프레임 542:3525은 아직 미적용)
  if (round.phase === 'VOID_ROUND') {
    return (
      <>
        <section className={styles.stage}>
          <div className={styles.roundBar}>
            <span className={styles.roundTitle}>무효 라운드!</span>
          </div>
          {/* 방장의 선택지는 GameScreen의 동점·교착 오버레이가 6종 공통으로 그린다 — 여기서 또 그리지 않는다 */}
        </section>
        <span className={styles.pressure} />
        <GameHud
          title="💥 무효 라운드!"
          note="아무도 못 눌렀거나 남은 전원이 눌러버려서 이 회차로는 가릴 수 없어요"
          largeNote
          right={<HudPill>방장이 다시 할지 고르는 중</HudPill>}
        />
      </>
    )
  }

  return (
    <>
      {/* ── 오른쪽 위 상태 알약 ── */}
      <div className={styles.hudChips}>
        <span className={styles.chipAlive}>
          👥 남은 후보 {candidateIds.length} / {members.length} · 빠져나감 {outIds.length}
        </span>
        <span className={styles.chipTopic}>🎯 {config.topic} 뽑기</span>
      </div>

      {/* ── 이렇게 이긴다 띠 ── */}
      <div className={styles.howto}>
        <span className={styles.howtoLabel}>◆ 이렇게 이긴다</span>
        <div className={styles.steps}>
          <span className={styles.step}>
            <span className={`${styles.stepBadge} ${styles.stepOne}`}>1</span>아무 때나 혼자 UP! 을 누른다
          </span>
          <span className={styles.stepArrow}>→</span>
          <span className={styles.step}>
            <span className={`${styles.stepBadge} ${styles.stepTwo}`}>2</span>
            {windowSec}초 안에 겹쳐 눌러도 둘 다 빠진다
          </span>
          <span className={styles.stepArrow}>→</span>
          <span className={styles.step}>
            <span className={`${styles.stepBadge} ${styles.stepThree}`}>3</span>끝까지 못 누른 한 사람이 뽑힌다
          </span>
        </div>
      </div>

      {/* ── 참가자 카드 줄 ── */}
      <div className={styles.board}>
        {lineup.map((member, i) => {
          // out은 「빠져나갔다」는 뜻이다 — 눌러서 후보에서 빠졌으니 더 이상 뽑힐 일이 없다
          const out = outIds.includes(member.memberId)
          const order = orderOf.get(member.memberId)
          const state = out ? 'out' : order ? 'done' : 'wait'
          return (
            <div
              key={member.memberId}
              className={`${styles.card} ${styles[`card_${state}`]}`}
              style={{ left: i * (cardW + cardGap), width: cardW }}
            >
              {/* 이번 라운드에 눌렀으면 몇 번째였는지를 남긴다 — 지난 라운드에 빠진 사람은 순번이 없어 ✓만 뜬다 */}
              <span className={styles.cardBadge}>{order ?? (out ? '✓' : '?')}</span>
              <span className={styles.cardRing} style={{ background: tileColor(member.avatarId) }} />
              <img className={styles.cardFace} src={avatarSrc(member.avatarId)} alt="" />
              <span className={styles.cardName}>
                {member.nickname}
                {member.memberId === me ? ' (나)' : ''}
              </span>
              <span className={styles.cardState}>
                {/* 혼자 누름과 겹쳐 누름은 결과가 같지만(둘 다 빠진다) 눈치를 이겨서 빠진 것과 */}
                {/* 남과 부딪혀 빠진 것은 판이 다르므로 문구를 가른다 — 서버가 판정값으로 알려준다 */}
                {verdictOf.get(member.memberId) === 'OVERLAP'
                  ? '≡ 겹쳐 눌러 빠짐'
                  : verdictOf.get(member.memberId) === 'ALONE'
                    ? '★ 혼자 눌러 통과'
                    : out
                      ? '✓ 눌러서 빠짐'
                      : order
                        ? `${order}번째로 누름`
                        : '◌ 아직 눈치 보는 중'}
              </span>
            </div>
          )
        })}
      </div>

      {/* ── 무대 ── */}
      <section className={styles.stage}>
        <span className={styles.pressureRing} />

        <div className={styles.roundBar}>
          <span className={styles.roundTitle}>
            {round.phase === 'ROUND_RESULT'
              ? `${roundNo}라운드 종료!`
              : `지금 누르면 →  ${nextOrder}번째`}
          </span>

          {/* 라운드 사이의 판정 공개 구간은 누를 수 없어 게이지를 아예 감춘다 */}
          {round.phase === 'ROUND' && (
            <>
              <span className={styles.gaugeLabel}>
                남은 {toSeconds(remainMs)}초 · 제한시간 {limitSec}초
              </span>
              <span className={styles.gaugeTrack} />
              <span className={styles.gaugeFill} style={{ width: 392 * gaugeRatio }} />
            </>
          )}

          {/* 남은 후보 수만큼 눈금이 깔리고, 누른 사람 자리에는 순번이 박힌다 */}
          {Array.from({ length: dotCount }, (_, i) => (
            <span
              key={i}
              className={i < presses.length ? `${styles.dot} ${styles.dotOn}` : styles.dot}
              style={{ left: DOT_RIGHT - DOT_SIZE - (dotCount - 1 - i) * (DOT_SIZE + dotGap) }}
            >
              {i < presses.length ? i + 1 : '?'}
            </span>
          ))}
        </div>

        {round.phase !== 'ROUND' ? (
          <span className={`${styles.up} ${styles.upWait}`}>
            <span className={styles.upLabel}>⏸ 대기</span>
            <span className={styles.upNote}>판정을 공개하는 중</span>
          </span>
        ) : (
          <button
            type="button"
            className={styles.up}
            disabled={!amCandidate || pressed || result !== null}
            onClick={() => {
              sendAction('nunchi.up')
              setPressed(true)
            }}
          >
            <span className={styles.upLabel}>
              {amCandidate ? (pressed ? '✓ 완료' : '▲ UP!') : '✓ 안전'}
            </span>
            <span className={styles.upNote}>
              {!amCandidate
                ? '눌러서 빠져나왔어요'
                : pressed
                  ? '눌렀어요'
                  : '누르면 빠져나갈 수 있어요'}
            </span>
          </button>
        )}
      </section>

      {/* ── 눌린 순서 ── */}
      <aside className={styles.order}>
        <h2 className={styles.orderTitle}>◆ 눌린 순서</h2>
        {/* 순서와 시각은 전부 서버가 잰 값이다. 라운드가 끝난 뒤에 한 번에 온다 */}
        <span className={styles.orderCaption}>{roundNo}라운드 · 서버 판정 순서</span>
        <span className={styles.orderRule} />

        <div className={`${styles.orderList} scroll-thin`}>
          {presses.map((press, i) => {
            const member = members.find((m) => m.memberId === press.memberId)
            const diff = ((press.elapsedMs ?? 0) - (presses[0].elapsedMs ?? 0)) / 1000
            return (
              <div key={press.memberId} className={styles.orderRow}>
                <span className={styles.orderDot}>{i + 1}</span>
                <span
                  className={styles.orderRing}
                  style={{ background: tileColor(member?.avatarId) }}
                />
                <img className={styles.orderFace} src={avatarSrc(member?.avatarId)} alt="" />
                <span className={styles.orderName}>{member?.nickname ?? ''}</span>
                <span className={styles.orderTime}>
                  {i === 0 ? '0.0s' : `+${diff.toFixed(1)}s`}
                </span>
              </div>
            )
          })}
        </div>

        <span className={styles.orderRuleMid} />
        <div className={styles.orderNext}>
          <span className={`${styles.orderDot} ${styles.orderDotEmpty}`}>
            {waitingCount > 0 ? nextOrder : '·'}
          </span>
          <span className={`${styles.orderRing} ${styles.orderRingEmpty}`} />
          <span className={styles.orderNextMark}>?</span>
          <span className={styles.orderNextText}>
            {waitingCount > 0 ? '다음은 누구?' : '이번 라운드 끝!'}
          </span>
        </div>
        <span className={styles.orderRuleBottom} />
        <span className={styles.orderFooter}>
          ★ 서버 도착 시각 기준 · 네트워크와 무관하게 공정 판정
        </span>
      </aside>

      {/* 상태 밴드 뒤에 깔리는 붉은 긴장감 */}
      <span className={styles.pressure} />

      <GameHud
        title={
          result
            ? '🏁 결과 공개 중…'
            : round.phase === 'ROUND_RESULT'
              ? '⏸ 라운드 판정 공개 중…'
              : '⚡ 눈치 보는 중…'
        }
        note={
          round.phase === 'ROUND_RESULT'
            ? '누른 사람을 빼고 곧 다음 라운드를 엽니다'
            : waitingCount > 0
              ? `남은 ${waitingCount}명이 언제 누를지 아무도 몰라요`
              : '이번 라운드 판정을 기다리는 중이에요'
        }
        largeNote
        right={<HudPill>⚖ 동시 판정 {windowSec}초</HudPill>}
      />
    </>
  )
}
