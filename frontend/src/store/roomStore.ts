// 방 하나의 모든 실시간 상태를 담는 단일 스토어.
// 화면은 여기서 값을 읽고 액션만 호출한다 — 소켓 인스턴스를 컴포넌트가 직접 만지지 않는다.

import { create } from 'zustand'
import { createSocket, type GameSocket } from '../realtime/client'
import { loadChat, saveChat, type Session } from './session'
import type {
  ChatMessage,
  ErrorCode,
  GameActionPayload,
  GameConfig,
  GameId,
  GameResult,
  GameSelection,
  Member,
  MemberId,
  ResultVariant,
  Room,
  RoundState,
} from '../protocol/types'

// 방이 닫힌 이유 — 화면에 그대로 보여줄 안내 문구를 고르는 데 쓴다
export type ClosedReason = 'HOST_LEFT' | 'EMPTY' | 'INACTIVE' | 'KICKED' | 'DISCONNECTED'

interface TieState {
  candidates: { id: string; label: string }[]
  deadlineAt: string | null
}

interface ResultState {
  variant: ResultVariant
  result: GameResult
  // 이 시각이 되면 전원이 동시에 결과 화면으로 넘어간다 (API-05)
  resultScreenAt: string
  // 라운드 시작(가이드 포함)부터 결과 도착까지 클라이언트가 잰 시간. 서버가 안 보내주는 값이라 직접 잰다
  elapsedMs: number
}

interface RoomStore {
  session: Session | null
  connection: 'idle' | 'connecting' | 'connected' | 'closed'

  // 마지막으로 반영한 roomVersion — 이보다 크지 않은 이벤트는 순서가 뒤집힌 것으로 보고 버린다
  roomVersion: number

  room: Room | null
  members: Member[]
  me: MemberId | null
  game: GameSelection | null
  selectableGameIds: GameId[]
  round: RoundState | null

  chat: ChatMessage[]
  typingIds: MemberId[]

  // 게임 중 누가 제출을 마쳤는지 (내용은 서버가 안 보낸다)
  progress: Record<MemberId, 'COMPLETE' | 'WAITING'>
  // 킹메이커 투표 중 항목별 익명 득표수. 누가 넣었는지는 여전히 알 수 없다
  optionVotes: Record<string, number>
  tie: TieState | null
  result: ResultState | null
  // 시작 직후 3초 가이드가 끝나는 시각. null이면 가이드 없이 바로 시작
  guideEndsAt: string | null

  // 서버 시각 - 클라 시각. 모든 카운트다운은 이 보정값을 적용해 계산한다
  serverOffsetMs: number
  phaseRemainMs: number | null
  roomExpiresInMs: number | null

  closed: ClosedReason | null
  lastError: { code: ErrorCode; message: string } | null

  connect: (session: Session) => void
  disconnect: () => void
  reset: () => void
  clearError: () => void

  setReady: (ready: boolean) => void
  kick: (memberId: MemberId) => void
  sendChat: (text: string) => void
  sendTyping: (typing: boolean) => void
  selectGame: (gameId: GameId) => void
  updateConfig: (gameId: GameId, config: Partial<GameConfig>) => void
  randomGame: () => void
  startGame: () => void
  replayGame: () => void
  sendAction: (type: GameActionPayload['type'], payload?: Record<string, unknown>) => void
  closeRound: () => void
}

// 소켓은 스토어 상태가 아니라 모듈 변수로 들고 있는다 — 리렌더 대상이 아니기 때문
let socket: GameSocket | null = null
// 라운드가 시작한 클라이언트 시각. 결과가 오는 순간 한 번만 읽어 쓰므로 상태로 둘 필요가 없다
let roundStartedAt = 0

const emptyState = {
  roomVersion: 0,
  room: null,
  members: [],
  me: null,
  game: null,
  selectableGameIds: [] as GameId[],
  round: null,
  chat: [] as ChatMessage[],
  typingIds: [] as MemberId[],
  progress: {},
  optionVotes: {},
  tie: null,
  result: null,
  guideEndsAt: null,
  serverOffsetMs: 0,
  phaseRemainMs: null,
  roomExpiresInMs: null,
  closed: null,
  lastError: null,
}

export const useRoomStore = create<RoomStore>((set, get) => {
  // 순서가 뒤집힌 이벤트를 버리는 공통 가드. 통과하면 새 버전을 반영한 patch를 적용한다.
  const applyVersioned = (roomVersion: number, patch: Partial<RoomStore>) => {
    if (roomVersion <= get().roomVersion) return
    set({ ...patch, roomVersion } as Partial<RoomStore>)
  }

  return {
    session: null,
    connection: 'idle',
    ...emptyState,

    connect(session) {
      get().disconnect()
      set({
        ...emptyState,
        session,
        connection: 'connecting',
        chat: loadChat<ChatMessage>(session.code),
      })

      const s = createSocket(session.code, session.token)
      socket = s

      s.on('connect', () => set({ connection: 'connected' }))

      s.on('connect_error', () => {
        // 토큰이 죽었거나 방이 사라진 경우 — 되돌아갈 경로가 없으므로 종료 화면으로 보낸다
        set({ connection: 'closed', closed: 'DISCONNECTED' })
      })

      s.on('disconnect', () => {
        if (get().closed === null) set({ connection: 'closed', closed: 'DISCONNECTED' })
        else set({ connection: 'closed' })
      })

      s.on('room:snapshot', (p) => {
        set({
          roomVersion: p.roomVersion,
          room: p.room,
          members: p.members,
          me: p.me,
          game: p.game,
          selectableGameIds: p.selectableGameIds,
          round: p.round,
        })
      })

      s.on('member:joined', (p) => {
        const members = [...get().members.filter((m) => m.memberId !== p.member.memberId), p.member]
        // 인원이 늘면 최소인원 조건을 넘긴 게임이 새로 열리므로 같이 반영한다
        applyVersioned(p.roomVersion, { members, selectableGameIds: p.selectableGameIds })
      })

      s.on('member:left', (p) => {
        applyVersioned(p.roomVersion, {
          members: get().members.filter((m) => m.memberId !== p.memberId),
          selectableGameIds: p.selectableGameIds,
          // 라운드 중 이탈은 명단에서 지우지 않고 departed 표시만 켠다
          round: markDeparted(get().round, p.memberId),
        })
      })

      // 강퇴 통지는 소켓이 곧바로 끊기는 종료 이벤트라 버전 가드를 태우지 않는다
      s.on('member:kicked', () => set({ closed: 'KICKED' }))

      s.on('member:ready_changed', (p) => {
        applyVersioned(p.roomVersion, {
          members: get().members.map((m) =>
            m.memberId === p.memberId ? { ...m, ready: p.ready } : m,
          ),
        })
      })

      s.on('chat:message', (p) => {
        const { roomVersion: _v, ...message } = p
        const chat = [...get().chat, message].slice(-100)
        saveChat(session.code, chat)
        applyVersioned(p.roomVersion, { chat })
      })

      s.on('chat:typing', (p) => {
        const current = get().typingIds.filter((id) => id !== p.memberId)
        set({ typingIds: p.typing ? [...current, p.memberId] : current })
      })

      s.on('game:selected', (p) => {
        applyVersioned(p.roomVersion, {
          game: { gameId: p.gameId, config: p.config, configSchema: p.configSchema },
        })
      })

      s.on('game:config_changed', (p) => {
        const game = get().game
        if (!game) return
        applyVersioned(p.roomVersion, { game: { ...game, config: p.config } })
      })

      s.on('game:started', (p) => {
        roundStartedAt = Date.now()
        applyVersioned(p.roomVersion, {
          guideEndsAt: p.guideEndsAt,
          progress: {},
          optionVotes: {},
          tie: null,
          result: null,
          round: {
            roundId: p.roundId,
            gameId: p.gameId,
            config: p.config,
            roundMembers: p.roundMembers,
            phase: 'GUIDE',
            deadlineAt: p.guideEndsAt,
          },
        })
      })

      s.on('game:phase', (p) => {
        const round = get().round
        if (!round || round.roundId !== p.roundId) return
        applyVersioned(p.roomVersion, {
          // 새 단계로 넘어가면 이전 단계의 제출 현황·득표·동점 정보는 의미가 없으므로 지운다
          progress: {},
          optionVotes: {},
          tie: p.phase === 'TIE' ? get().tie : null,
          round: {
            ...round,
            phase: p.phase,
            deadlineAt: p.deadlineAt,
            options: p.options ?? round.options,
            subRound: p.subRound ?? round.subRound,
            aliveMemberIds: p.aliveMemberIds ?? round.aliveMemberIds,
          },
        })
      })

      s.on('game:progress', (p) => {
        const progress: Record<MemberId, 'COMPLETE' | 'WAITING'> = {}
        for (const e of p.entries) progress[e.memberId] = e.state
        // 킹메이커 투표 단계에서만 항목별 익명 득표수가 함께 온다
        const optionVotes = p.optionVotes
          ? Object.fromEntries(p.optionVotes.map((o) => [o.optionId, o.votes]))
          : get().optionVotes
        applyVersioned(p.roomVersion, { progress, optionVotes })
      })

      s.on('game:tie', (p) => {
        applyVersioned(p.roomVersion, {
          tie: { candidates: p.candidates, deadlineAt: p.deadlineAt },
        })
      })

      s.on('game:result', (p) => {
        applyVersioned(p.roomVersion, {
          result: {
            variant: p.variant,
            result: p.result,
            resultScreenAt: p.resultScreenAt,
            elapsedMs: roundStartedAt ? Date.now() - roundStartedAt : 0,
          },
        })
      })

      s.on('round:closed', (p) => {
        applyVersioned(p.roomVersion, {
          round: null,
          result: null,
          tie: null,
          progress: {},
          optionVotes: {},
          guideEndsAt: null,
          // 대기방으로 돌아오면 서버가 준비 상태를 초기화하므로 화면도 맞춰 내린다
          members: get().members.map((m) => ({ ...m, ready: false })),
        })
      })

      s.on('room:closed', (p) => {
        set({ closed: p.reason, connection: 'closed' })
      })

      s.on('server:tick', (p) => {
        set({
          serverOffsetMs: p.serverTime - Date.now(),
          phaseRemainMs: p.phaseRemainMs,
          roomExpiresInMs: p.roomExpiresInMs,
        })
      })

      s.on('error', (p) => set({ lastError: p }))
    },

    disconnect() {
      if (socket) {
        socket.removeAllListeners()
        socket.disconnect()
        socket = null
      }
    },

    reset() {
      get().disconnect()
      set({ session: null, connection: 'idle', ...emptyState })
    },

    clearError: () => set({ lastError: null }),

    setReady: (ready) => socket?.emit('member:ready', { ready }),
    kick: (memberId) => socket?.emit('member:kick', { memberId }),
    sendChat: (text) => socket?.emit('chat:send', { text }),
    sendTyping: (typing) => socket?.emit('chat:typing', { typing }),
    selectGame: (gameId) => socket?.emit('game:select', { gameId }),
    updateConfig: (gameId, config) => socket?.emit('game:config', { gameId, config }),
    randomGame: () => socket?.emit('game:random', {}),
    startGame: () => socket?.emit('game:start', {}),
    replayGame: () => socket?.emit('game:replay', {}),

    sendAction(type, payload) {
      const round = get().round
      if (!round) return
      socket?.emit('game:action', {
        roundId: round.roundId,
        type,
        payload: payload ?? {},
      } as GameActionPayload)
    },

    closeRound() {
      const round = get().round
      if (round) socket?.emit('round:close', { roundId: round.roundId })
    },
  }
})

// 라운드 명단에서 이탈자를 지우지 않고 departed만 켠다 (결과 화면에도 남아야 하므로)
function markDeparted(round: RoundState | null, memberId: MemberId): RoundState | null {
  if (!round) return round
  return {
    ...round,
    roundMembers: round.roundMembers.map((m) =>
      m.memberId === memberId ? { ...m, departed: true } : m,
    ),
  }
}

/* ────────────────────────── 파생 값 셀렉터 ────────────────────────── */

export const selectMe = (s: RoomStore) => s.members.find((m) => m.memberId === s.me) ?? null
export const selectIsHost = (s: RoomStore) => selectMe(s)?.role === 'host'
export const selectGuests = (s: RoomStore) => s.members.filter((m) => m.role === 'guest')
