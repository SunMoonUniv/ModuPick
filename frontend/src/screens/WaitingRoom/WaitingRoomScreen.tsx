import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, ChatPanel, EmptySeat, Modal, PlayerRow, ScreenFrame } from '../../components/common'
import { GameConfigForm } from '../../components/game/GameConfigForm/GameConfigForm'
import { api } from '../../api/rest'
import { controllerIcon, crownIcon, diceIcon, hourglassIcon, playIcon } from '../../assets/icons'
import { GAME_ACCENTS, GAME_ICONS } from '../../constants/gameVisuals'
import { useLeaveWarning } from '../../hooks/useLeaveWarning'
import { selectIsHost, selectableGameIds, useRoomStore } from '../../store/roomStore'
import { clearSession, loadSession } from '../../store/session'
import styles from './WaitingRoomScreen.module.css'

// game:config를 매 타건마다 보내면 방송이 과해지므로 잠깐 모아서 보낸다
const CONFIG_DEBOUNCE_MS = 250

// 게임 카드 6장의 2열 격자 위치 — 프레임 좌표 그대로다 (왼쪽 열 1192, 오른쪽 열 1538)
const CARD_COL = [1192, 1538]
const CARD_ROW = [212, 336, 460]

// 대기방. 참가자 무대·채팅·게임 선택/설정이 좌·중·우로 놓이고, 하단 밴드에 현재 상황과 주요 액션이 모인다.
export function WaitingRoomScreen() {
  const navigate = useNavigate()
  const room = useRoomStore((s) => s.room)
  const members = useRoomStore((s) => s.members)
  const me = useRoomStore((s) => s.me?.memberId ?? null)
  const game = useRoomStore((s) => s.game)
  const connection = useRoomStore((s) => s.connection)
  const lastError = useRoomStore((s) => s.lastError)
  const clearError = useRoomStore((s) => s.clearError)
  const isHost = useRoomStore(selectIsHost)

  const setReady = useRoomStore((s) => s.setReady)
  const kick = useRoomStore((s) => s.kick)
  const selectGame = useRoomStore((s) => s.selectGame)
  const updateConfig = useRoomStore((s) => s.updateConfig)
  const randomGame = useRoomStore((s) => s.randomGame)
  const startGame = useRoomStore((s) => s.startGame)
  const reset = useRoomStore((s) => s.reset)

  const catalog = useRoomStore((s) => s.catalog)
  const [leaveOpen, setLeaveOpen] = useState(false)

  // 인원이 모자라 못 고르는 게임을 가린다. **스토어 셀렉터로 두면 매번 새 배열이라 무한 렌더가 된다**
  const selectable = useMemo(() => selectableGameIds(catalog, members.length), [catalog, members.length])

  // 새로고침·창 닫기는 곧 퇴장이라 확인창을 띄운다 (재접속 경로가 없다)
  useLeaveWarning(connection === 'connected')

  // 서버가 거절 사유를 보내면 잠깐 보여주고 스스로 지운다
  useEffect(() => {
    if (!lastError) return
    const id = setTimeout(clearError, 2600)
    return () => clearTimeout(id)
  }, [lastError, clearError])

  // 세션이 없거나 연결이 끊긴 채로 이 화면에 오면 처음으로 되돌린다
  useEffect(() => {
    if (connection === 'idle') navigate('/', { replace: true })
  }, [connection, navigate])

  const myMember = members.find((m) => m.memberId === me) ?? null
  const guests = members.filter((m) => !m.isHost)
  const readyCount = guests.filter((m) => m.ready).length
  const selectedMeta = catalog.find((g) => g.gameId === game?.gameId) ?? null

  // 시작 조건: 게임 선택 + 최소 인원 + 참가자 전원 준비완료
  const startBlockReason = useMemo(() => {
    if (!game) return '게임을 먼저 선택해주세요'
    if (selectedMeta && members.length < selectedMeta.minMembers)
      return `${selectedMeta.minMembers}명 이상 모여야 시작할 수 있어요`
    if (readyCount < guests.length)
      return `준비 ${readyCount}/${guests.length} — 아직 준비 중인 참가자가 있어요`
    return null
  }, [game, selectedMeta, members.length, readyCount, guests.length])

  // 방장이 방금 바꾼 값. **서버 방송이 같은 값으로 되돌아올 때까지 화면에 얹어 둔다** —
  // 올리자마자 지우면 방송이 오기 전 한 박자 동안 옛 값이 보여 칩과 글자가 튄다.
  const [draft, setDraft] = useState<Record<string, unknown>>({})

  // 설정 변경은 디바운스해서 보낸다. 서버가 부분 갱신이라 draft를 통째로 다시 보내도 안전하다
  useEffect(() => {
    if (!game || Object.keys(draft).length === 0) return
    const id = setTimeout(() => updateConfig(game.gameId, draft as never), CONFIG_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [draft, game, updateConfig])

  // 내가 올린 값이 그대로 돌아오면 그 키는 화면에서 내린다 (남의 변경은 그대로 따라간다)
  useEffect(() => {
    if (!game) return
    const applied = game.config as unknown as Record<string, unknown>
    setDraft((prev) => {
      const rest = Object.fromEntries(
        Object.entries(prev).filter(
          ([key, value]) => JSON.stringify(applied[key]) !== JSON.stringify(value),
        ),
      )
      return Object.keys(rest).length === Object.keys(prev).length ? prev : rest
    })
  }, [game])

  // 게임을 바꾸면 설정이 서버 기본값으로 되돌아가므로 얹어 둔 값도 버린다
  useEffect(() => {
    setDraft({})
  }, [game?.gameId])

  const leave = async () => {
    const session = loadSession()
    if (session) await api.leaveRoom(session.code, session.token).catch(() => undefined)
    reset()
    clearSession()
    navigate('/', { replace: true })
  }

  if (!room) return null

  // 설정 폼에는 아직 서버가 확인해 주지 않은 내 입력도 얹어 보여줘 값이 튀지 않게 한다
  const shownConfig = game ? { ...game.config, ...draft } : undefined
  const emptySeats = Math.max(0, room.maxMembers - members.length)

  return (
    <ScreenFrame fullBleed>
      <div className={styles.screen}>
        {/* ── 머리말 ── */}
        <h1 className={styles.title}>{room.roomName}</h1>
        <span className={styles.subtitle}>● 실시간 대기방</span>
        {isHost && <img className={styles.headerCrown} src={crownIcon} alt="" />}
        <div className={styles.headerChips}>
          <span className={styles.codeChip}>◈ {room.displayCode}</span>
          <span className={styles.countChip}>
            {members.length}/{room.maxMembers}명 · READY {readyCount}
          </span>
        </div>

        {/* ── 왼쪽: 참가자 무대 ── */}
        <span className={styles.playersTitle}>
          ◆ PLAYERS · 참가자 무대 ({members.length}/{room.maxMembers})
        </span>
        <div className={`${styles.playerList} scroll-thin`}>
          {members.map((member) => (
            <PlayerRow
              key={member.memberId}
              nickname={member.nickname}
              avatarId={member.avatarId}
              bio={member.bio ?? undefined}
              isHost={member.isHost}
              isMe={member.memberId === me}
              isReady={member.ready}
              onKick={isHost && !member.isHost ? () => kick(member.memberId) : undefined}
            />
          ))}
          {emptySeats > 0 && <EmptySeat count={emptySeats} />}
        </div>

        {/* ── 가운데: 채팅 ── */}
        <div className={styles.chat}>
          <ChatPanel />
        </div>

        {/* ── 오른쪽: 게임 선택 ── */}
        <span className={styles.gamesTitle}>◆ 게임 선택</span>
        <span className={styles.gamesNote}>
          {isHost
            ? '방장만 선택 · 고르면 아래에서 바로 설정 · 3명 이상 게임은 인원 미달 시 잠김'
            : '방장이 고르는 중이에요 · 설정도 방장만 바꿀 수 있어요'}
        </span>
        {!isHost && <span className={styles.lockChip}>방장만 변경 가능</span>}

        {catalog.map((meta, i) => {
          const locked = !selectable.includes(meta.gameId)
          const selected = game?.gameId === meta.gameId
          const classes = [
            styles.gameCard,
            selected ? styles.gameSelected : '',
            locked ? styles.gameLocked : '',
            isHost ? '' : styles.gameReadonly,
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={meta.gameId}
              className={classes}
              style={{ left: CARD_COL[i % 2], top: CARD_ROW[Math.floor(i / 2)] }}
              onClick={() => isHost && !locked && selectGame(meta.gameId)}
            >
              <span className={styles.gameIcon} style={{ background: GAME_ACCENTS[meta.gameId] }}>
                <img src={GAME_ICONS[meta.gameId]} alt="" />
              </span>
              <span className={styles.gameNameRow}>
                <span className={styles.gameName}>{meta.name}</span>
                {meta.minMembers > 2 && !selected && (
                  <span className={styles.gameRequire}>{meta.minMembers}명 이상</span>
                )}
              </span>
              <span className={styles.gameTagline}>{meta.description}</span>
              {selected && <span className={styles.gameCheck}>✓</span>}
            </div>
          )
        })}

        {/* ── 오른쪽 아래: 선택한 게임 설정 ── */}
        <div className={styles.settings}>
          <span className={styles.settingsTitle}>
            {isHost
              ? `⚙️ ${game ? `${selectedMeta?.name ?? ''} 설정` : '게임 설정'}`
              : `🔒 ${game ? `${selectedMeta?.name ?? ''} 설정` : '게임 설정'} · 읽기 전용`}
          </span>
          <span className={styles.settingsNote}>
            {game
              ? '게임을 바꾸면 설정도 자동으로 바뀌어요'
              : isHost
                ? '위에서 게임을 고르면 설정이 나타나요'
                : '방장이 게임을 고르는 중이에요'}
          </span>
          {game && shownConfig && (
            <div className={styles.settingsBody}>
              <GameConfigForm
                gameId={game.gameId}
                schema={selectedMeta?.configSchema ?? []}
                config={shownConfig}
                memberCount={members.length}
                editable={isHost}
                onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
              />
            </div>
          )}
        </div>

        {/* ── 하단 상태 밴드 ── */}
        <footer className={styles.band}>
          <span className={styles.bandBadge}>
            <img src={isHost ? controllerIcon : hourglassIcon} alt="" />
          </span>
          <span className={styles.bandTitle}>
            {isHost
              ? game
                ? `◷ ${selectedMeta?.name ?? ''} 준비 완료!`
                : '◷ 게임을 골라주세요'
              : '◷ 방장이 시작하기를 기다리는 중'}
          </span>
          <span className={styles.bandNote}>
            {isHost
              ? (startBlockReason ??
                `${selectedMeta?.minMembers ?? 2}명 이상이면 시작할 수 있어요 · 현재 ${members.length}명 · READY ${readyCount}/${guests.length}`)
              : `준비 완료를 누르면 방장 화면에 READY로 표시돼요 · 현재 ${members.length}명 · READY ${readyCount}/${guests.length}`}
          </span>

          <div className={styles.bandActions}>
            <button type="button" className={styles.leaveButton} onClick={() => setLeaveOpen(true)}>
              <span>←</span>
              <span>나가기</span>
            </button>
            {isHost ? (
              <>
                <button type="button" className={styles.randomButton} onClick={randomGame}>
                  <img src={diceIcon} alt="" />
                  <span>랜덤 게임</span>
                </button>
                <button
                  type="button"
                  className={styles.startButton}
                  onClick={startGame}
                  disabled={startBlockReason !== null}
                >
                  <img src={playIcon} alt="" />
                  <span>게임 시작</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className={myMember?.ready ? styles.readyButtonOn : styles.readyButton}
                onClick={() => setReady(!myMember?.ready)}
              >
                {myMember?.ready ? '✓ 준비 완료' : '준비 하기'}
              </button>
            )}
          </div>
        </footer>

        {lastError && <div className={styles.toast}>{lastError.message}</div>}
      </div>

      <Modal
        open={leaveOpen}
        title="방에서 나갈까요?"
        description={
          isHost
            ? '방장이 나가면 방이 사라지고 모든 참가자가 나가게 됩니다.'
            : '한 번 나가면 같은 자리로 돌아올 수 없어요. 다시 들어오려면 코드를 새로 입력해야 합니다.'
        }
        onClose={() => setLeaveOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setLeaveOpen(false)}>
              머무르기
            </Button>
            <Button variant="danger" onClick={leave}>
              나가기
            </Button>
          </>
        }
      />
    </ScreenFrame>
  )
}
