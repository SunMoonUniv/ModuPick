import { useEffect, useRef, useState } from 'react'

import { Button, Modal, ScreenFrame } from '../../components/common'
import { TieOverlay } from '../../components/game/TieOverlay/TieOverlay'
import { api } from '../../api/rest'
import { GAME_META_LINES, GAME_SUBTITLES } from '../../constants/gameVisuals'
import { useRemainMs } from '../../hooks/useServerClock'
import { useLeaveWarning } from '../../hooks/useLeaveWarning'
import { useRoomStore } from '../../store/roomStore'
import { isGuideMuted, muteGuide } from '../../store/session'
import type { GameDetail, KingmakerBallotPayload } from '../../protocol/types'

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
  const catalog = useRoomStore((s) => s.catalog)
  const lastError = useRoomStore((s) => s.lastError)
  const clearError = useRoomStore((s) => s.clearError)
  const tie = useRoomStore((s) => s.tie)
  const decision = useRoomStore((s) => s.decision)

  // 킹메이커 후보 문구는 투표 단계의 payload에만 실린다. 동점 통지 단계는 payload가 비어 있어
  // 그때 후보 이름을 붙이려면 직전 단계에서 받아둔 것을 써야 한다 — 그래서 여기 모아 둔다.
  const candidateLabels = useRef(new Map<string, string>())

  // 가이드의 규칙·단계는 목록이 아니라 상세 응답에만 있다
  const [detail, setDetail] = useState<GameDetail | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [muted, setMuted] = useState(false)

  const gameId = round?.gameId
  // 가이드 단계는 서버가 phase로 알려 준다 — 클라가 시간을 세어 넘기지 않는다
  const guideEndsAt = round?.phase === 'GUIDE' ? round.deadlineAt : null
  const guideRemain = useRemainMs(guideEndsAt)

  useLeaveWarning(true)

  useEffect(() => {
    if (!gameId) return
    api
      .gameDetail(gameId)
      .then(setDetail)
      .catch(() => undefined)
  }, [gameId])

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

  // 후보 목록이 실려 온 단계마다 갱신해 둔다 (라운드가 바뀌면 game:started가 payload를 비우므로 저절로 낡지 않는다)
  const ballot = round.payload as unknown as KingmakerBallotPayload | null
  ballot?.candidates?.forEach((c) => candidateLabels.current.set(c.optionId, c.label))

  // 동점·교착 오버레이에 찍을 문구. 사람은 라운드 명단에서, 킹메이커 후보는 위 캐시에서 찾는다
  const namesOf = (kind: 'MEMBER' | 'OPTION', ids: string[]) =>
    kind === 'MEMBER'
      ? ids.map((id) => round.roster.find((m) => m.memberId === id)?.nickname ?? '알 수 없음')
      : ids.map((id) => candidateLabels.current.get(id) ?? '후보')

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

      {/* 동점 통지(3초)와 교착 시 방장 선택은 6종이 같은 상태를 쓰므로 여기서 한 번만 그린다 */}
      {decision ? (
        <TieOverlay
          mode="decision"
          names={namesOf(decision.candidateKind, decision.candidateIds)}
          options={decision.options}
          reason={decision.reason}
          deadlineAt={decision.deadlineAt}
        />
      ) : (
        round.phase === 'TIE_NOTICE' &&
        tie && <TieOverlay mode="notice" names={namesOf(tie.candidateKind, tie.candidateIds)} />
      )}

      <Modal
        open={guideOpen && meta !== null}
        wide
        banner
        title={`${meta?.name ?? ''} · 게임 가이드`}
        description={meta?.description}
        onClose={guideEndsAt && guideRemain > 0 ? undefined : () => setGuideOpen(false)}
      >
        <div className={styles.guideList}>
          {(detail?.steps ?? []).map((step, i) => (
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

