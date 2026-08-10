import { useEffect, useState } from 'react'

import { Button, Modal, ScreenFrame } from '../../components/common'
import { api } from '../../api/rest'
import { GAME_META_LINES, GAME_SUBTITLES } from '../../constants/gameVisuals'
import { useRemainMs } from '../../hooks/useServerClock'
import { useLeaveWarning } from '../../hooks/useLeaveWarning'
import { useRoomStore } from '../../store/roomStore'
import { isGuideMuted, muteGuide } from '../../store/session'
import type { GameMeta } from '../../protocol/types'

import { RouletteGame } from './games/RouletteGame'
import { LadderGame } from './games/LadderGame'
import { KingmakerGame } from './games/KingmakerGame'
import { TimerGame } from './games/TimerGame'
import { SnipeGame } from './games/SnipeGame'
import { NunchiGame } from './games/NunchiGame'
import styles from './GameScreen.module.css'

// 인게임 화면의 껍데기. 제목 줄·접속 알약·가이드 팝업만 공통으로 얹고,
// 무대와 하단 상태 밴드(GameHud)는 게임별 컴포넌트가 직접 그린다.
export function GameScreen() {
  const round = useRoomStore((s) => s.round)
  const room = useRoomStore((s) => s.room)
  const guideEndsAt = useRoomStore((s) => s.guideEndsAt)
  const lastError = useRoomStore((s) => s.lastError)
  const clearError = useRoomStore((s) => s.clearError)

  const [catalog, setCatalog] = useState<GameMeta[]>([])
  const [guideOpen, setGuideOpen] = useState(false)
  const [muted, setMuted] = useState(false)

  const guideRemain = useRemainMs(guideEndsAt)

  useLeaveWarning(true)

  useEffect(() => {
    api
      .games()
      .then((res) => setCatalog(res.games))
      .catch(() => undefined)
  }, [])

  const gameId = round?.gameId

  // 최초 시작에는 가이드를 자동으로 띄운다. "다시 하기"는 guideEndsAt이 null이라 뜨지 않는다.
  useEffect(() => {
    if (!gameId) return
    const alreadyMuted = isGuideMuted(gameId)
    setMuted(alreadyMuted)
    if (guideEndsAt && !alreadyMuted) setGuideOpen(true)
  }, [gameId, guideEndsAt])

  // 가이드 시간이 끝나면 자동으로 닫히고, 그 순간 서버가 라운드를 시작한다
  useEffect(() => {
    if (!guideOpen || !guideEndsAt) return
    if (guideRemain <= 0) setGuideOpen(false)
  }, [guideOpen, guideEndsAt, guideRemain])

  useEffect(() => {
    if (!lastError) return
    const id = setTimeout(clearError, 2600)
    return () => clearTimeout(id)
  }, [lastError, clearError])

  if (!round || !room) return null

  const meta = catalog.find((g) => g.gameId === round.gameId) ?? null

  return (
    <ScreenFrame fullBleed>
      <div className={styles.screen}>
        {/* ── 제목 줄 — 게임 이름 · 가이드 버튼 · 영문 부제가 한 줄에 붙는다 ── */}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{meta?.name ?? ''}</h1>
          <button
            type="button"
            className={styles.guideButton}
            onClick={() => setGuideOpen(true)}
            aria-label="게임 가이드"
          >
            ?
          </button>
          <span className={styles.subtitleEn}>{GAME_SUBTITLES[round.gameId]}</span>
        </div>
        <span className={styles.meta}>
          ● {GAME_META_LINES[round.gameId] ?? '실시간 진행'} · 방 {room.displayCode}
        </span>

        {/* 오른쪽 위 상태 표시는 게임마다 내용이 달라 각 게임 컴포넌트가 직접 그린다 */}

        {/* 프레임을 적용한 게임은 1920×1080 좌표계에 직접 그린다 */}
        {round.gameId === 'roulette' && <RouletteGame />}
        {round.gameId === 'ladder' && <LadderGame />}
        {round.gameId === 'timer' && <TimerGame />}
        {/* 킹메이커는 제출 단계만 프레임을 적용해서, 나머지 단계의 예전 레이아웃은 컴포넌트가 직접 감싼다 */}
        {round.gameId === 'kingmaker' && <KingmakerGame />}
        {round.gameId === 'snipe' && <SnipeGame />}
        {round.gameId === 'nunchi' && <NunchiGame />}

        {lastError && <div className={styles.toast}>{lastError.message}</div>}
      </div>

      <Modal
        open={guideOpen && meta !== null}
        wide
        banner
        title={`${meta?.name ?? ''} · 게임 가이드`}
        description={meta?.tagline}
        onClose={guideEndsAt && guideRemain > 0 ? undefined : () => setGuideOpen(false)}
      >
        <div className={styles.guideList}>
          {meta?.guide.map((step, i) => (
            <div key={step} className={styles.guideStep}>
              <span className={styles.guideIndex}>{i + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
        <div className={styles.guideFooter}>
          <label className={styles.guideMute}>
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => {
                setMuted(e.target.checked)
                muteGuide(round.gameId, e.target.checked)
              }}
            />
            이 게임은 다음부터 자동으로 열지 않기
          </label>
          {guideEndsAt && guideRemain > 0 ? (
            <span>{Math.ceil(guideRemain / 1000)}초 후 자동 시작</span>
          ) : (
            <Button size="sm" variant="soft" onClick={() => setGuideOpen(false)}>
              닫기
            </Button>
          )}
        </div>
      </Modal>
    </ScreenFrame>
  )
}

