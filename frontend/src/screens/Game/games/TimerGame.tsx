import { useEffect, useRef, useState } from 'react'

import { GameHud } from '../../../components/common'
import { avatarSrc } from '../../../assets/avatars'
import { GAME_ICONS } from '../../../constants/gameVisuals'
import { useRoomStore } from '../../../store/roomStore'
import type { TimerConfig } from '../../../protocol/types'
import styles from './TimerGame.module.css'

// 숫자를 보여주는 구간 — 이 시간이 지나면 감으로만 맞춰야 한다 (서버 가이드 문구와 같은 2초)
const VISIBLE_MS = 2000

// 참가자 카드 격자 — 한 줄에 6장, 카드 폭 283 + 간격 21
const CARD_LEFT = 59
const CARD_PITCH = 304

// 타임라인 트랙 좌표 (프레임 542:2995 기준)
const TRACK_LEFT = 27.78
const TRACK_WIDTH = 1738.667

// 시간초 잡기. 화면의 숫자는 참고용 표시일 뿐이고, 판정은 서버가 잰 start~stop 간격으로만 이뤄진다.
export function TimerGame() {
  const round = useRoomStore((s) => s.round)!
  const me = useRoomStore((s) => s.me)
  const progress = useRoomStore((s) => s.progress)
  const result = useRoomStore((s) => s.result)
  const sendAction = useRoomStore((s) => s.sendAction)

  const config = round.config as TimerConfig
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [stoppedMs, setStoppedMs] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const frame = useRef<number | null>(null)

  const phase = round.phase

  // 동점 재대결 안내가 뜨면 내 기록을 비워 다시 START부터 하게 한다
  useEffect(() => {
    if (phase !== 'TIE') return
    setStartedAt(null)
    setStoppedMs(null)
    setElapsed(0)
  }, [phase])

  // 화면 숫자는 로컬 시계로 굴린다 — 어디까지나 표시용이고 판정에는 쓰이지 않는다
  useEffect(() => {
    if (startedAt === null || stoppedMs !== null) return
    const tick = () => {
      setElapsed(Date.now() - startedAt)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [startedAt, stoppedMs])

  const start = () => {
    sendAction('timer.start')
    setStartedAt(Date.now())
  }

  const stop = () => {
    sendAction('timer.stop')
    setStoppedMs(Date.now() - (startedAt ?? Date.now()))
  }

  const running = startedAt !== null && stoppedMs === null
  const showNumber = running && elapsed < VISIBLE_MS
  // 숫자가 가려진 동안에는 타임라인의 진행 막대·"나" 표시도 같이 감춘다 — 안 그러면 막대로 몇 초인지 읽힌다
  const showTrace = stoppedMs !== null || showNumber
  const shownMs = stoppedMs ?? elapsed
  const targetSec = config.targetMs / 1000
  // 목표선이 트랙의 62.5% 지점에 오도록 눈금 최대값을 잡는다 (프레임과 같은 비율)
  const trackMaxMs = config.targetMs * 1.6
  const ratio = (ms: number) => Math.min(1, Math.max(0, ms / trackMaxMs))
  const stoppedCount = round.roundMembers.filter((m) => progress[m.memberId] === 'COMPLETE').length

  // 내 기록이 확정되기 전에는 남은 시간을 숫자로 알려주지 않는다 (감으로 맞추는 게임이라서)
  const remainSec = Math.max(0, (config.targetMs - shownMs) / 1000)

  return (
    <>
      {/* ── 오른쪽 위 상태 ── */}
      <span className={styles.targetPill}>🎯 목표 {targetSec.toFixed(2)}s</span>
      <span className={styles.topicPill}>
        <img src={GAME_ICONS.timer} alt="" />
        {config.topic} 뽑기
      </span>

      {/* ── 참가자 카드 줄 ── */}
      {round.roundMembers.map((member, i) => {
        const done = progress[member.memberId] === 'COMPLETE'
        return (
          <div
            key={member.memberId}
            className={styles.playerCard}
            style={{ left: CARD_LEFT + i * CARD_PITCH }}
          >
            <img className={styles.playerAvatar} src={avatarSrc(member.avatarId)} alt="" />
            <span className={styles.playerName}>{member.nickname}</span>
            <span className={done ? `${styles.playerState} ${styles.stateDone}` : styles.playerState}>
              {member.departed ? '⏸ 나감' : done ? '✓ 정지 완료' : '▶ 타이머 진행 중'}
            </span>
            {member.memberId === me && <span className={styles.playerMe}>나</span>}
          </div>
        )
      })}

      {/* ── 큰 숫자판 ── */}
      <section className={styles.hero}>
        <span className={styles.heroCaption}>
          {stoppedMs !== null
            ? '기록 확정 · 서버 판정을 기다리는 중'
            : running
              ? '지금 흐르는 중 · 멈추면 즉시 확정'
              : 'START를 누르면 시작돼요'}
        </span>
        <span className={styles.heroValue}>
          {stoppedMs !== null || showNumber ? (shownMs / 1000).toFixed(2) : '?.??'}
        </span>
        <span className={styles.heroUnit}>초 경과</span>

        <span className={styles.heroDivider} />

        <span className={styles.heroRightLabel}>목표까지</span>
        <span className={styles.heroRightValue}>
          {stoppedMs !== null || showNumber ? remainSec.toFixed(2) : '?.??'}
        </span>
        <span className={styles.heroRightUnit}>
          {stoppedMs !== null ? '초 차이 · 판정 대기' : '초 남음 · 지금이 기회'}
        </span>
      </section>

      {/* ── 정지 타임라인 ── */}
      <section className={styles.timeline}>
        <span className={styles.timelineCaption}>
          {showTrace
            ? '정지 타임라인 · 목표선에서 멀수록 오차가 큽니다'
            : '정지 현황 · 기록과 오차는 전원이 멈춘 뒤 한 번에 공개돼요'}
        </span>
        <span className={styles.timelineHazardLabel}>
          {showTrace ? '▨ 목표 초과 구간' : '🔒 기록 비공개'}
        </span>

        <span className={styles.track} />
        {/* 목표를 넘긴 구간 — 빗금으로 위험을 표시한다 */}
        <span
          className={styles.hazard}
          style={{
            left: TRACK_LEFT + TRACK_WIDTH * ratio(config.targetMs),
            width: TRACK_WIDTH * (1 - ratio(config.targetMs)),
          }}
        />
        {showTrace && <span className={styles.fill} style={{ width: TRACK_WIDTH * ratio(shownMs) }} />}
        <span className={styles.trackOutline} />

        <span
          className={styles.targetLine}
          style={{ left: TRACK_LEFT + TRACK_WIDTH * ratio(config.targetMs) - 3.164 }}
        />
        <span
          className={styles.targetTag}
          style={{ left: TRACK_LEFT + TRACK_WIDTH * ratio(config.targetMs) - 88 }}
        >
          🎯 목표 {targetSec.toFixed(2)}s
        </span>

        {showTrace && (
          <>
            <span
              className={styles.meLine}
              style={{ left: TRACK_LEFT + TRACK_WIDTH * ratio(shownMs) - 3.164 }}
            />
            <span
              className={styles.meBadge}
              style={{ left: TRACK_LEFT + TRACK_WIDTH * ratio(shownMs) - 17.93 }}
            >
              나
            </span>
          </>
        )}

        <span className={styles.scaleLeft}>0.00s</span>
        <span className={styles.scaleRight}>{(trackMaxMs / 1000).toFixed(2)}s</span>
      </section>

      {/* ── 큰 버튼 ── */}
      {result ? (
        <span className={`${styles.bigButton} ${styles.bigDone}`}>기록 집계 완료!</span>
      ) : stoppedMs !== null ? (
        <span className={`${styles.bigButton} ${styles.bigDone}`}>
          ✓ {(stoppedMs / 1000).toFixed(2)}초 기록
        </span>
      ) : running ? (
        <button type="button" className={`${styles.bigButton} ${styles.bigStop}`} onClick={stop}>
          ✋ STOP!
        </button>
      ) : (
        // PLAYING이 열리기 전에 누르면 서버가 거절해 기록이 날아가므로 그 동안은 잠가둔다
        <button
          type="button"
          className={`${styles.bigButton} ${styles.bigStart}`}
          onClick={start}
          disabled={phase !== 'PLAYING'}
        >
          ▶ START
        </button>
      )}

      <GameHud
        title={
          result
            ? '◷ 기록 집계 완료!'
            : running
              ? '◷ 시간초 잡는 중…'
              : stoppedMs !== null
                ? '◷ 판정 대기 중…'
                : '◷ START를 눌러주세요'
        }
        note="단 한 번만 누를 수 있어요 · 되돌릴 수 없습니다"
        right={
          <span className={styles.hudPill}>
            {stoppedCount} / {round.roundMembers.length} 정지 ·{' '}
            {round.roundMembers.length - stoppedCount}명 STOP 대기
          </span>
        }
      />
    </>
  )
}
