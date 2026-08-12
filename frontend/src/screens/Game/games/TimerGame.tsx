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
  const me = useRoomStore((s) => s.me?.memberId ?? null)
  const progress = useRoomStore((s) => s.progress)
  const result = useRoomStore((s) => s.result)
  const sendAction = useRoomStore((s) => s.sendAction)
  const tie = useRoomStore((s) => s.tie)

  const config = round.config as TimerConfig
  // 설정은 초 단위이고 화면 계산은 전부 밀리초라 여기서 한 번만 옮긴다
  const targetMs = config.targetSeconds * 1000
  // 서버는 진행 상황을 사람별로 주지 않고 건수만 준다
  const counts = (progress ?? null) as { stoppedCount?: number; totalCount?: number } | null
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [stoppedMs, setStoppedMs] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const frame = useRef<number | null>(null)

  const phase = round.phase

  // 재대결이 열리면 내 기록을 비워 다시 START부터 하게 한다
  useEffect(() => {
    if (phase !== 'REMATCH') return
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
    const elapsedMs = Date.now() - (startedAt ?? Date.now())
    // 내가 잰 값을 같이 보낸다 — 안 보내면 서버가 자기 관측값을 쓰면서 game.elapsed_rejected를 통지한다
    sendAction('timer.stop', { elapsedMs: Math.max(1, Math.round(elapsedMs)) })
    setStoppedMs(elapsedMs)
  }

  const running = startedAt !== null && stoppedMs === null
  const showNumber = running && elapsed < VISIBLE_MS
  // 숫자가 가려진 동안에는 타임라인의 진행 막대·"나" 표시도 같이 감춘다 — 안 그러면 막대로 몇 초인지 읽힌다
  const showTrace = stoppedMs !== null || showNumber
  const shownMs = stoppedMs ?? elapsed
  const targetSec = config.targetSeconds
  // 목표선이 트랙의 62.5% 지점에 오도록 눈금 최대값을 잡는다 (프레임과 같은 비율)
  const trackMaxMs = targetMs * 1.6
  const ratio = (ms: number) => Math.min(1, Math.max(0, ms / trackMaxMs))
  const entrants = counts?.totalCount ?? round.roster.length
  const stoppedCount = counts?.stoppedCount ?? 0

  // 재대결은 직전 동점자만 겨룬다. 명단은 동점 통지(game:tie)로 한 번 와서 스토어가 들고 있다.
  // 대상이 아닌 사람이 START를 누르면 서버가 GAME_NOT_ELIGIBLE로 거절하므로 아예 잠근다.
  const rematchIds = phase === 'REMATCH' && tie ? tie.candidateIds : null
  const isSpectator = rematchIds !== null && me !== null && !rematchIds.includes(me)

  // 내 기록이 확정되기 전에는 남은 시간을 숫자로 알려주지 않는다 (감으로 맞추는 게임이라서)
  const remainSec = Math.max(0, (targetMs - shownMs) / 1000)

  return (
    <>
      {/* ── 오른쪽 위 상태 ── */}
      <span className={styles.targetPill}>🎯 목표 {targetSec.toFixed(2)}s</span>
      <span className={styles.topicPill}>
        <img src={GAME_ICONS.timer} alt="" />
        {config.topic} 뽑기
      </span>

      {/* ── 참가자 카드 줄 ── */}
      {/* 서버가 사람별 진행을 주지 않으므로 카드에는 정지 여부 대신 참가 사실만 그린다 */}
      {round.roster.map((member, i) => {
        return (
          <div
            key={member.memberId}
            className={styles.playerCard}
            style={{ left: CARD_LEFT + i * CARD_PITCH }}
          >
            <img className={styles.playerAvatar} src={avatarSrc(member.avatarId)} alt="" />
            <span className={styles.playerName}>{member.nickname}</span>
            <span className={styles.playerState}>
              {rematchIds && !rematchIds.includes(member.memberId)
                ? '· 이번 판은 관전'
                : '▶ 타이머 진행 중'}
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
            left: TRACK_LEFT + TRACK_WIDTH * ratio(targetMs),
            width: TRACK_WIDTH * (1 - ratio(targetMs)),
          }}
        />
        {showTrace && <span className={styles.fill} style={{ width: TRACK_WIDTH * ratio(shownMs) }} />}
        <span className={styles.trackOutline} />

        <span
          className={styles.targetLine}
          style={{ left: TRACK_LEFT + TRACK_WIDTH * ratio(targetMs) - 3.164 }}
        />
        <span
          className={styles.targetTag}
          style={{ left: TRACK_LEFT + TRACK_WIDTH * ratio(targetMs) - 88 }}
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
      ) : isSpectator ? (
        <span className={`${styles.bigButton} ${styles.bigDone}`}>동점자끼리 겨루는 중…</span>
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
          disabled={phase !== 'RUNNING' && phase !== 'REMATCH'}
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
            {stoppedCount} / {entrants} 정지 · {Math.max(0, entrants - stoppedCount)}명 STOP 대기
          </span>
        }
      />
    </>
  )
}
