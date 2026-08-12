// 방 하나의 모든 실시간 상태를 담는 단일 스토어.
// 화면은 여기서 값을 읽고 액션만 호출한다 — 소켓 인스턴스를 컴포넌트가 직접 만지지 않는다.
//
// 이벤트 이름과 payload의 정본은 backend/app/schemas/events.py다.

import { create } from 'zustand'
import { createSocket, type GameSocket, type SocketError } from '../realtime/client'
import { api } from '../api/rest'
import { loadChat, saveChat, type Session } from './session'
import { CloseCode } from '../protocol/types'
import type {
  ChatMessage,
  GameActionType,
  GameConfig,
  GameId,
  GameResult,
  GamePhase,
  GameSelection,
  GameSummary,
  Me,
  Member,
  MemberId,
  ProgressPayload,
  ResultVariant,
  Room,
  RosterEntry,
} from '../protocol/types'
import type { ActionPayloadByType } from '../protocol/types'

// 방이 닫힌 이유 — 화면에 그대로 보여줄 안내 문구를 고르는 데 쓴다.
// 앞의 셋은 서버의 room:closed reason이고 뒤의 셋은 소켓 종료 코드로만 알 수 있는 것들이다.
export type ClosedReason =
  | 'HOST_LEFT'
  | 'LAST_MEMBER_LEFT'
  | 'EXPIRED'
  | 'KICKED'
  | 'DUPLICATE'
  | 'DISCONNECTED'

// 라운드 하나의 진행 상태 — game:started 이후 화면이 계속 참조한다
export interface RoundState {
  roundId: string
  gameId: GameId
  config: GameConfig
  // 시작 시점에 고정된 명단 스냅샷. 도중 이탈해도 바뀌지 않는다
  roster: RosterEntry[]
  phase: GamePhase
  // 단계마다 1씩 오르는 번호. game:action에 그대로 되실어야 서버가 받아 준다
  phaseSeq: number
  // 결선·재대결 회차. 본선은 0이다
  tieRound: number
  deadlineAt: string | null
  // 연출 시작 값 (룰렛 목표 조각, 사다리 가로줄 등). 단계마다 모양이 다르다
  payload: Record<string, unknown> | null
}

// 동점으로 다음 회차가 열렸다는 통지
interface TieState {
  tieRound: number
  tieRoundMax: number
  candidateKind: 'MEMBER' | 'OPTION'
  candidateIds: string[]
  deadlineAt: string | null
}

// 방장의 교착 해소 선택을 기다리는 상태. 참여자 화면은 대기 문구만 띄운다
interface DecisionState {
  reason: 'TIE_EXHAUSTED' | 'VOID_ROUND' | 'NO_OPTION'
  options: ('RETRY' | 'ABORT')[]
  candidateKind: 'MEMBER' | 'OPTION'
  candidateIds: string[]
  deadlineAt: string
}

interface ResultState {
  gameId: GameId
  variant: ResultVariant
  result: GameResult
  finishedAt: string
}

interface RoomStore {
  session: Session | null
  connection: 'idle' | 'connecting' | 'connected' | 'closed'

  // 마지막으로 반영한 roomVersion — 이보다 크지 않은 상태 이벤트는 순서가 뒤집힌 것으로 보고 버린다
  roomVersion: number

  room: Room | null
  members: Member[]
  me: Me | null
  game: GameSelection | null
  // GET /api/games의 메타 6종. 최소인원과 설정 규격의 정본이라 연결 시 한 번 받아 둔다
  catalog: GameSummary[]
  round: RoundState | null

  chat: ChatMessage[]
  typingIds: MemberId[]

  // game:progress의 payload를 그대로 둔다 — 게임마다 모양이 달라 화면이 좁혀 읽는다.
  // **누가 무엇을 골랐는지는 어떤 게임에서도 오지 않는다.**
  progress: ProgressPayload | null
  tie: TieState | null
  decision: DecisionState | null
  result: ResultState | null

  // 서버 시각 - 클라 시각. 모든 카운트다운은 이 보정값을 적용해 계산한다
  serverOffsetMs: number
  // 현재 단계 남은 시간(ms). 마감 없는 단계면 null
  phaseRemainMs: number | null

  closed: ClosedReason | null
  lastError: SocketError | null

  connect: (session: Session) => void
  disconnect: () => void
  reset: () => void
  clearError: () => void

  setReady: (ready: boolean) => void
  kick: (memberId: MemberId) => void
  sendChat: (text: string) => void
  sendTyping: (typing: boolean) => void
  selectGame: (gameId: GameId) => void
  updateConfig: (gameId: GameId, config: Record<string, unknown>) => void
  randomGame: () => void
  // 게임 시작과 「다시 하기」가 같은 이벤트다 — 서버가 방 상태를 보고 가른다
  startGame: () => void
  sendAction: <T extends GameActionType>(type: T, payload?: ActionPayloadByType[T]) => void
  decide: (choice: 'RETRY' | 'ABORT') => void
  closeRound: () => void
}

// 소켓은 스토어 상태가 아니라 모듈 변수로 들고 있는다 — 리렌더 대상이 아니기 때문
let socket: GameSocket | null = null

const emptyState = {
  roomVersion: 0,
  room: null,
  members: [],
  me: null,
  game: null,
  round: null,
  chat: [] as ChatMessage[],
  typingIds: [] as MemberId[],
  progress: null,
  tie: null,
  decision: null,
  result: null,
  serverOffsetMs: 0,
  phaseRemainMs: null,
  closed: null,
  lastError: null,
}

// 동점자 명단(tie)을 다음 단계까지 들고 가야 하는 단계들.
// **서버는 game:tie를 TIE_NOTICE 단계에 딱 한 번만 보낸다.** 이어지는 결선·재대결 단계에서
// 명단을 다시 알려주지 않으므로, 여기 없는 단계로 넘어갈 때만 비운다.
// (비우는 시점을 틀리면 결선인데도 전원이 대상인 것처럼 그려진다)
const TIE_KEEP_PHASES = new Set(['TIE_NOTICE', 'RUNOFF', 'REMATCH', 'DEADLOCK', 'VOID_ROUND'])

// 방장의 선택을 기다리는 단계. **여기서 벗어나면 선택은 이미 끝난 것이다** —
// 서버가 "선택이 반영됐다"는 이벤트를 따로 보내지 않으므로, 다음 단계가 오는 것이 곧 그 신호다.
// (비우지 않으면 방장이 「다시」를 골라 새 라운드가 열려도 선택 창이 화면에 남는다)
const DECISION_PHASES = new Set(['DEADLOCK', 'VOID_ROUND'])

// 소켓 종료 코드를 화면이 안내할 수 있는 사유로 옮긴다. 알 수 없는 코드는 일반 끊김으로 본다.
function reasonOfCloseCode(code: number): ClosedReason {
  if (code === CloseCode.KICKED) return 'KICKED'
  if (code === CloseCode.DUPLICATE) return 'DUPLICATE'
  if (code === CloseCode.ROOM_CLOSED) return 'EXPIRED'
  return 'DISCONNECTED'
}

export const useRoomStore = create<RoomStore>((set, get) => {
  // 순서가 뒤집힌 상태 이벤트를 버리는 공통 가드. 통과하면 새 버전을 반영한 patch를 적용한다.
  const applyVersioned = (roomVersion: number, patch: Partial<RoomStore>) => {
    if (roomVersion <= get().roomVersion) return
    set({ ...patch, roomVersion } as Partial<RoomStore>)
  }

  // 현재 라운드에 대한 이벤트만 반영한다. 끝난 판의 늦은 프레임은 버린다.
  const roundPatch = (roundId: string, patch: Partial<RoundState>): Partial<RoomStore> | null => {
    const round = get().round
    if (!round || round.roundId !== roundId) return null
    return { round: { ...round, ...patch } }
  }

  return {
    session: null,
    connection: 'idle',
    catalog: [],
    ...emptyState,

    connect(session) {
      get().disconnect()
      set({
        ...emptyState,
        session,
        connection: 'connecting',
        chat: loadChat<ChatMessage>(session.code),
      })

      // 최소인원 판단과 설정 규격은 서버가 정본이다. 실패해도 대기방은 뜨므로 조용히 넘긴다.
      api
        .games()
        .then((res) => set({ catalog: res.content }))
        .catch(() => undefined)

      const s = createSocket(session.code, session.token)
      socket = s

      s.on('connect', () => set({ connection: 'connected' }))

      s.on('connect_error', () => {
        // 토큰이 죽었거나 방이 사라진 경우 — 되돌아갈 경로가 없으므로 종료 화면으로 보낸다
        set({ connection: 'closed', closed: 'DISCONNECTED' })
      })

      s.on('disconnect', (code) => {
        // room:closed를 이미 받았으면 그쪽 사유가 더 구체적이라 덮어쓰지 않는다
        if (get().closed === null) set({ closed: reasonOfCloseCode(code) })
        set({ connection: 'closed' })
      })

      s.on('room:snapshot', (p) => {
        set({
          roomVersion: p.roomVersion,
          serverOffsetMs: Date.parse(p.serverTime) - Date.now(),
          room: p.room,
          me: p.me,
          members: p.members,
          game: p.game,
        })
      })

      s.on('member:joined', (p) => {
        const members = [...get().members.filter((m) => m.memberId !== p.member.memberId), p.member]
        applyVersioned(p.roomVersion, { members })
      })

      s.on('member:left', (p) => {
        applyVersioned(p.roomVersion, {
          members: get().members.filter((m) => m.memberId !== p.memberId),
        })
      })

      s.on('member:ready_changed', (p) => {
        applyVersioned(p.roomVersion, {
          members: get().members.map((m) =>
            m.memberId === p.memberId ? { ...m, ready: p.ready } : m,
          ),
        })
      })

      s.on('member:connection', (p) => {
        // 유예 진입은 이탈이 아니다 — 명단에서 지우지 않고 연결 표시만 바꾼다
        applyVersioned(p.roomVersion, {
          members: get().members.map((m) =>
            m.memberId === p.memberId ? { ...m, connection: p.state } : m,
          ),
        })
      })

      s.on('chat:message', (p) => {
        // 와이어에 닉네임·아바타가 없어 명단에서 찾아 채운 뒤 보관한다
        const author = get().members.find((m) => m.memberId === p.memberId)
        const message: ChatMessage = {
          messageId: p.messageId,
          memberId: p.memberId,
          // 명단에 없는 사람 = 이미 나갔거나 아직 명단이 도착하지 않은 사람.
          // 이름 자리를 비워두면 누가 쓴 말인지 알 수 없어 "퇴장"으로 못 박고 얼굴은 비운다
          nickname: author?.nickname ?? '퇴장',
          avatarId: author?.avatarId ?? '',
          text: p.text,
          sentAt: p.sentAt,
        }
        const chat = [...get().chat, message].slice(-100)
        saveChat(session.code, chat)
        // 채팅은 통지 이벤트라 버전 게이트를 걸지 않는다 — 걸면 같은 번호의 프레임이 전부 버려진다
        set({ chat })
      })

      s.on('chat:typing', (p) => {
        const current = get().typingIds.filter((id) => id !== p.memberId)
        set({ typingIds: p.typing ? [...current, p.memberId] : current })
      })

      s.on('game:selected', (p) => {
        applyVersioned(p.roomVersion, {
          game: {
            gameId: p.gameId,
            config: p.config,
            configSchemaVersion: p.configSchemaVersion,
          },
        })
      })

      s.on('game:config_changed', (p) => {
        const game = get().game
        if (!game) return
        applyVersioned(p.roomVersion, { game: { ...game, config: p.config } })
      })

      s.on('game:started', (p) => {
        applyVersioned(p.roomVersion, {
          progress: null,
          tie: null,
          decision: null,
          result: null,
          round: {
            roundId: p.roundId,
            gameId: p.gameId,
            config: p.config,
            roster: p.roster,
            // 첫 단계는 곧바로 오는 game:phase가 확정한다. 그전까지는 가이드로 둔다
            phase: 'GUIDE',
            phaseSeq: 0,
            tieRound: 0,
            deadlineAt: null,
            payload: null,
          },
        })
      })

      s.on('game:phase', (p) => {
        const patch = roundPatch(p.roundId, {
          phase: p.phase,
          phaseSeq: p.phaseSeq,
          tieRound: p.tieRound,
          deadlineAt: p.deadlineAt,
          payload: p.payload ?? null,
        })
        if (!patch) return
        applyVersioned(p.roomVersion, {
          ...patch,
          // 단계가 바뀌면 이전 단계의 집계는 의미가 없다
          progress: null,
          // 동점 명단만은 결선·재대결이 이어지는 동안 유지한다 (TIE_KEEP_PHASES 참고)
          tie: TIE_KEEP_PHASES.has(p.phase) ? get().tie : null,
          decision: DECISION_PHASES.has(p.phase) ? get().decision : null,
          serverOffsetMs: Date.parse(p.serverTime) - Date.now(),
        })
      })

      s.on('game:progress', (p) => {
        const round = get().round
        // 지난 단계의 늦은 집계가 새 단계를 덮지 않게 막는다
        if (!round || round.roundId !== p.roundId || round.phaseSeq !== p.phaseSeq) return
        applyVersioned(p.roomVersion, { progress: p.payload })
      })

      s.on('game:tie', (p) => {
        applyVersioned(p.roomVersion, {
          tie: {
            tieRound: p.tieRound,
            tieRoundMax: p.tieRoundMax,
            candidateKind: p.candidateKind,
            candidateIds: p.candidateIds,
            deadlineAt: p.deadlineAt,
          },
        })
      })

      s.on('game:decision_required', (p) => {
        applyVersioned(p.roomVersion, {
          decision: {
            reason: p.reason,
            options: p.options,
            candidateKind: p.candidateKind,
            candidateIds: p.candidateIds,
            deadlineAt: p.deadlineAt,
          },
        })
      })

      s.on('game:result', (p) => {
        applyVersioned(p.roomVersion, {
          decision: null,
          result: {
            gameId: p.gameId,
            variant: p.variant,
            result: p.result,
            finishedAt: p.finishedAt,
          },
        })
      })

      s.on('round:closed', (p) => {
        applyVersioned(p.roomVersion, {
          round: null,
          result: null,
          tie: null,
          decision: null,
          progress: null,
          phaseRemainMs: null,
          room: get().room ? { ...get().room!, roomStatus: p.roomStatus } : null,
          // 대기방으로 돌아오면 서버가 준비 상태를 초기화하므로 화면도 맞춰 내린다
          members: get().members.map((m) => ({ ...m, ready: false })),
        })
      })

      s.on('room:closed', (p) => {
        set({ closed: p.reason, connection: 'closed' })
      })

      s.on('game:tick', (p) => {
        // 표시 전용이라 버전 게이트를 걸지 않는다
        set({
          serverOffsetMs: Date.parse(p.serverTime) - Date.now(),
          phaseRemainMs: p.remainMs,
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
      set({ session: null, connection: 'idle', catalog: get().catalog, ...emptyState })
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

    sendAction(type, payload) {
      const round = get().round
      if (!round) return
      socket?.emit('game:action', {
        roundId: round.roundId,
        // 서버의 현재 값과 다르면 game.stale_phase로 버려진다
        phaseSeq: round.phaseSeq,
        type,
        payload: (payload ?? {}) as Record<string, unknown>,
      })
    },

    decide(choice) {
      const round = get().round
      if (!round) return
      socket?.emit('game:decide', { roundId: round.roundId, phaseSeq: round.phaseSeq, choice })
    },

    closeRound() {
      const round = get().round
      if (round) socket?.emit('round:close', { roundId: round.roundId })
    },
  }
})

/* ────────────────────────── 파생 값 셀렉터 ────────────────────────── */

export const selectMe = (s: RoomStore) =>
  s.members.find((m) => m.memberId === s.me?.memberId) ?? null
export const selectIsHost = (s: RoomStore) => s.me?.isHost === true
export const selectGuests = (s: RoomStore) => s.members.filter((m) => !m.isHost)

// 현재 인원으로 시작할 수 있는 게임. 서버가 목록을 내려주지 않으므로 메타의 최소인원으로 가른다
// **셀렉터로 쓰지 않는다.** zustand 셀렉터가 매번 새 배열을 만들면 리액트가 상태가 바뀐 것으로 보고
// 무한 렌더에 빠진다("getSnapshot should be cached"). 화면이 catalog·members를 구독한 뒤 useMemo로 부른다.
export function selectableGameIds(catalog: GameSummary[], memberCount: number): GameId[] {
  return catalog.filter((g) => memberCount >= g.minMembers).map((g) => g.gameId)
}

// 라운드 명단에서 한 명을 찾는다. 결과 payload가 memberId만 주므로 화면이 이걸로 이어 붙인다
export const selectRosterMember = (s: RoomStore, memberId: MemberId | null) =>
  memberId ? (s.round?.roster.find((m) => m.memberId === memberId) ?? null) : null
