import { useEffect, useState } from 'react'

import { Button, GameHud, HudPill } from '../../../components/common'
import { avatarSrc } from '../../../assets/avatars'
import { AVATAR_TILE_COLORS } from '../../../constants/avatarTiles'
import { toSeconds, useRemainMs } from '../../../hooks/useServerClock'
import { selectIsHost, useRoomStore } from '../../../store/roomStore'
import type { MemberId, NunchiConfig } from '../../../protocol/types'
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

// 눈치게임. 판정 시간 안에 두 명 이상이 겹치면 그 인원이 통째로 탈락하고, 마지막에 남은 한 명이 최종 결과가 된다.
export function NunchiGame() {
  const round = useRoomStore((s) => s.round)!
  const me = useRoomStore((s) => s.me)
  const progress = useRoomStore((s) => s.progress)
  const result = useRoomStore((s) => s.result)
  const isHost = useRoomStore(selectIsHost)
  const sendAction = useRoomStore((s) => s.sendAction)

  const config = round.config as NunchiConfig
  const [pressed, setPressed] = useState(false)
  // 누가 몇 번째로 눌렀는지 — 서버는 완료/대기만 알려주므로 progress가 바뀌는 순서를 클라가 직접 쌓는다
  const [presses, setPresses] = useState<{ memberId: MemberId; at: number }[]>([])

  // 서브라운드가 바뀌면 다시 누를 수 있어야 한다
  useEffect(() => {
    setPressed(false)
  }, [round.subRound, round.phase])

  // 단계가 바뀔 때마다 서버가 progress를 비워서 보내므로, 비면 순서도 같이 초기화된다
  useEffect(() => {
    const done = Object.keys(progress).filter((id) => progress[id] === 'COMPLETE')
    if (done.length === 0) {
      setPresses((prev) => (prev.length === 0 ? prev : []))
      return
    }
    setPresses((prev) => {
      const known = new Set(prev.map((p) => p.memberId))
      const added = done
        .filter((id) => !known.has(id))
        .map((id) => ({ memberId: id, at: Date.now() }))
      return added.length === 0 ? prev : [...prev, ...added]
    })
  }, [progress])

  const aliveIds = round.aliveMemberIds ?? round.roundMembers.map((m) => m.memberId)
  const amAlive = me !== null && aliveIds.includes(me)
  const members = round.roundMembers
  const remainMs = useRemainMs(round.deadlineAt)

  const orderOf = new Map(presses.map((p, i) => [p.memberId, i + 1]))
  const nextOrder = presses.length + 1
  const waitingCount = aliveIds.filter((id) => !orderOf.has(id)).length
  const windowSec = (config.decisionWindowMs / 1000).toFixed(1)
  const limitSec = Math.round(config.subRoundTimeoutMs / 1000)
  const gaugeRatio = Math.max(0, Math.min(1, remainMs / config.subRoundTimeoutMs))

  // 카드가 6장을 넘으면 폭을 줄여서 한 줄에 다 들어가게 한다 (방 정원이 10명이라서)
  const cardW = Math.min(CARD_W, (BOARD_W - (members.length - 1) * MIN_GAP) / members.length)
  const cardGap = members.length > 1 ? (BOARD_W - members.length * cardW) / (members.length - 1) : 0

  // 눈금 사이 간격 — 인원이 많아지면 좁혀서 정해진 구간 안에 붙여둔다
  const dotCount = aliveIds.length
  const dotGap = Math.max(4, (DOT_SPAN - dotCount * DOT_SIZE) / Math.max(1, dotCount - 1))

  // 전원 탈락은 판이 성립하지 않아 방장의 결정을 기다린다 (전용 프레임 542:3525은 아직 미적용)
  if (round.phase === 'INVALID') {
    return (
      <>
        <section className={styles.stage}>
          <div className={styles.roundBar}>
            <span className={styles.roundTitle}>전원 탈락!</span>
          </div>
          <div className={styles.invalidPanel}>
            <span className={styles.invalidText}>남은 사람이 없어 이 판은 성립하지 않았어요.</span>
            {isHost ? (
              <div className={styles.invalidActions}>
                <Button
                  size="lg"
                  variant="accent"
                  onClick={() => sendAction('nunchi.invalid_decision', { decision: 'RESTART' })}
                >
                  처음부터 다시
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => sendAction('nunchi.invalid_decision', { decision: 'ABORT' })}
                >
                  대기방으로
                </Button>
              </div>
            ) : (
              <span className={styles.invalidText}>방장이 다시 할지 결정하는 중이에요</span>
            )}
          </div>
        </section>
        <span className={styles.pressure} />
        <GameHud
          title="💥 전원 탈락!"
          note="같은 판정 구간에 남은 전원이 몰려서 승자가 없어요"
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
          👥 생존 {aliveIds.length} / {members.length} · 탈락 {members.length - aliveIds.length}
        </span>
        <span className={styles.chipTopic}>🎯 {config.topic} 뽑기</span>
      </div>

      {/* ── 이렇게 이긴다 띠 ── */}
      <div className={styles.howto}>
        <span className={styles.howtoLabel}>◆ 이렇게 이긴다</span>
        <div className={styles.steps}>
          <span className={styles.step}>
            <span className={`${styles.stepBadge} ${styles.stepOne}`}>1</span>아무 때나 혼자 UP! 을
            누른다
          </span>
          <span className={styles.stepArrow}>→</span>
          <span className={styles.step}>
            <span className={`${styles.stepBadge} ${styles.stepTwo}`}>2</span>
            {windowSec}초 안에 겹쳐 누르면 둘 다 탈락
          </span>
          <span className={styles.stepArrow}>→</span>
          <span className={styles.step}>
            <span className={`${styles.stepBadge} ${styles.stepThree}`}>3</span>제한시간까지 계속
            눈치만 봐도 탈락
          </span>
        </div>
      </div>

      {/* ── 참가자 카드 줄 ── */}
      <div className={styles.board}>
        {members.map((member, i) => {
          const out = !aliveIds.includes(member.memberId) || member.departed
          const order = orderOf.get(member.memberId)
          const state = out ? 'out' : order ? 'done' : 'wait'
          return (
            <div
              key={member.memberId}
              className={`${styles.card} ${styles[`card_${state}`]}`}
              style={{ left: i * (cardW + cardGap), width: cardW }}
            >
              <span className={styles.cardBadge}>
                {state === 'out' ? '×' : (order ?? '?')}
              </span>
              <span className={styles.cardRing} style={{ background: tileColor(member.avatarId) }} />
              <img className={styles.cardFace} src={avatarSrc(member.avatarId)} alt="" />
              <span className={styles.cardName}>
                {member.nickname}
                {member.memberId === me ? ' (나)' : ''}
              </span>
              <span className={styles.cardState}>
                {member.departed
                  ? '⏸ 나감'
                  : out
                    ? '× 탈락'
                    : order
                      ? `✓ ${order}번째로 누름`
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
            {round.phase === 'READY'
              ? `${round.subRound ?? 1}라운드 종료!`
              : `지금 누르면 →  ${nextOrder}번째`}
          </span>

          {/* 라운드 사이의 대기 구간은 제한시간이 없어서 게이지를 아예 감춘다 */}
          {round.phase !== 'READY' && (
            <>
              <span className={styles.gaugeLabel}>
                남은 {toSeconds(remainMs)}초 · 제한시간 {limitSec}초
              </span>
              <span className={styles.gaugeTrack} />
              <span className={styles.gaugeFill} style={{ width: 392 * gaugeRatio }} />
            </>
          )}

          {/* 생존자 수만큼 눈금이 깔리고, 누른 사람 자리에는 순번이 박힌다 */}
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

        {round.phase === 'READY' ? (
          <span className={`${styles.up} ${styles.upWait}`}>
            <span className={styles.upLabel}>⏸ 대기</span>
            <span className={styles.upNote}>다음 라운드를 여는 중</span>
          </span>
        ) : (
          <button
            type="button"
            className={styles.up}
            disabled={!amAlive || pressed || result !== null}
            onClick={() => {
              sendAction('nunchi.up')
              setPressed(true)
            }}
          >
            <span className={styles.upLabel}>{amAlive ? (pressed ? '✓ 완료' : '▲ UP!') : '× 탈락'}</span>
            <span className={styles.upNote}>
              {!amAlive
                ? '이번 판은 여기서 끝났어요'
                : pressed
                  ? `${orderOf.get(me ?? '') ?? nextOrder - 1}번째로 기록됐어요`
                  : `누르면 ${nextOrder}번째로 기록돼요`}
            </span>
          </button>
        )}
      </section>

      {/* ── 눌린 순서 ── */}
      <aside className={styles.order}>
        <h2 className={styles.orderTitle}>◆ 눌린 순서</h2>
        {/* 서버는 완료 여부만 보내주므로 여기 시간은 클라가 받은 순간을 기준으로 잰 값이다 */}
        <span className={styles.orderCaption}>도착 순서</span>
        <span className={styles.orderRule} />

        <div className={`${styles.orderList} scroll-thin`}>
          {presses.map((press, i) => {
            const member = members.find((m) => m.memberId === press.memberId)
            const diff = (press.at - presses[0].at) / 1000
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
            : round.phase === 'READY'
              ? '⏸ 다음 라운드 준비 중…'
              : '⚡ 눈치 보는 중…'
        }
        note={
          round.phase === 'READY'
            ? '탈락자를 정리하고 곧 다음 라운드를 엽니다'
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
