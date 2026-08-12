// ModuPick 프론트-서버 공통 계약 타입.
// 정본은 실제 백엔드 코드다 — REST는 `backend/app/schemas/rest.py`, 소켓은
// `backend/app/schemas/events.py`(생성물 `backend/devtools/socket-events.ts`),
// 게임 설정은 `backend/app/domain/game_config.py`, phase는 `backend/app/domain/games/*.py`다.
// 임시 서버(local-server/)는 이 계약과 다르며 더 이상 기준이 아니다.

/* ────────────────────────── 기본 식별자 ────────────────────────── */

// 멤버 식별자 — 서버가 발급하는 `mbr_` 접두 불투명 문자열 (내용을 파싱하지 말 것)
export type MemberId = string
// 라운드(게임 한 판) 식별자 — `rnd_` 접두
export type RoundId = string
// 킹메이커 안건 식별자 — `opt_` 접두. 와이어에서는 candidateId라는 이름으로 실린다
export type OptionId = string

// 게임 6종 식별자 — gameId만 와이어도 소문자다 (나머지 열거값은 전부 대문자)
export type GameId = 'roulette' | 'ladder' | 'kingmaker' | 'timer' | 'snipe' | 'nunchi'

// 방 상태 — 서버는 저장값(소문자)과 와이어 표기(대문자)를 구분하며 와이어에는 대문자만 실린다
export type RoomStatus = 'WAITING' | 'PLAYING'

// 멤버 상태 — PENDING은 프로필 확정 전 슬롯 선점 단계, ACTIVE는 확정 후 명단에 보이는 상태
export type MemberStatus = 'PENDING' | 'ACTIVE'

// 소켓 연결 품질 — UNSTABLE은 유예 중이라는 표시일 뿐 이탈 확정이 아니다
export type ConnectionState = 'ONLINE' | 'UNSTABLE'

// 소켓 프로토콜 버전 — conn:auth에 실어 보내며 다르면 서버가 4002로 닫는다
export const PROTOCOL_VERSION = 1

/* ────────────────────────── 공통 응답/에러 ────────────────────────── */

// 서버가 정의한 에러 코드 42종 — 형식은 {네임스페이스}.{snake_case}이고, 화면 분기는 HTTP 상태가 아니라 이 문자열로 판단한다.
// 네임스페이스는 발생 주체 기준 5종(room · member · game · vote · common)이며 게임별 전용 네임스페이스는 두지 않는다.
export type ErrorCode =
  // 방의 존재·상태·정원·수명
  | 'room.not_found'
  | 'room.already_playing'
  | 'room.full'
  | 'room.expired'
  | 'room.host_left'
  | 'room.code_exhausted'
  // 참가자의 자격·프로필·권한
  | 'member.not_found'
  | 'member.not_host'
  | 'member.not_active'
  | 'member.nickname_invalid'
  | 'member.avatar_invalid'
  | 'member.avatar_taken'
  | 'member.bio_too_long'
  | 'member.already_active'
  | 'member.kicked'
  | 'member.self_kick'
  // 게임 선택·설정·라운드·단계·입력 자격
  | 'game.not_found'
  | 'game.not_selected'
  | 'game.invalid_config'
  | 'game.not_enough_members'
  | 'game.not_all_ready'
  | 'game.round_not_found'
  | 'game.round_already_ended'
  | 'game.stale_phase'
  | 'game.invalid_action'
  | 'game.already_submitted'
  | 'game.not_eligible'
  | 'game.elapsed_rejected'
  | 'game.decision_not_required'
  // 표의 대상·수·중복 검증
  | 'vote.self_not_allowed'
  | 'vote.target_not_found'
  | 'vote.limit_exceeded'
  | 'vote.duplicate_target'
  // 인증·스키마 검증·프로토콜·전역 실패
  | 'common.unauthenticated'
  | 'common.session_expired'
  | 'common.validation_failed'
  | 'common.idempotency_conflict'
  | 'common.payload_too_large'
  | 'common.rate_limited'
  | 'common.protocol_unsupported'
  | 'common.protocol_violation'
  | 'common.internal'

// 성공·실패를 가리지 않는 공통 응답 봉투 — 실제 값은 언제나 data 안에 들어 있다.
// 소켓 S→C 프레임도 여기에 event 필드 하나를 더 얹은 형태를 쓴다.
export interface Envelope<T> {
  success: boolean
  code: ErrorCode | 'ok'
  message: string | null
  data: T
  timestamp: string
}

// 소켓 종료 코드 — 어느 코드에서도 자동 재연결하지 않는다. 재접속 경로가 없는 프로토콜이다.
export const CloseCode = {
  NORMAL: 1000,
  PROTOCOL_ERROR: 4002,
  UNAUTHORIZED: 4401,
  // 방장이 강퇴했다. 별도 이벤트 없이 이 코드로만 알려 준다
  KICKED: 4403,
  AUTH_TIMEOUT: 4408,
  // 같은 토큰으로 두 번째 연결을 시도했다. 기존 소켓이 살아남는다
  DUPLICATE: 4409,
  ROOM_CLOSED: 4410,
  TOO_LARGE: 4413,
} as const

// fetch 래퍼가 REST 실패를 throw할 때 쓰는 에러 — code로 화면 분기하려고 만든 클래스
export class ApiError extends Error {
  code: ErrorCode
  status: number

  constructor(code: ErrorCode, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/* ────────────────────────── 도메인 모델 ────────────────────────── */

// 명단에 보이는 참가자 한 명 — ACTIVE만 실린다 (프로필 입력 중인 PENDING은 남의 화면에 없다)
export interface Member {
  memberId: MemberId
  nickname: string
  // A01~A30 중 하나. 방 안에서 중복 불가
  avatarId: string
  // 한 줄 소개. 안 적었으면 null
  bio: string | null
  // 방장 위임이 없으므로 라운드 중에도 바뀌지 않는다
  isHost: boolean
  // 참여자 전용 준비 상태. 방장은 준비 집합에 아예 들어가지 않아 항상 false
  ready: boolean
  connection: ConnectionState
  // 방에서 몇 번째로 프로필을 확정했는지 (1부터). 룰렛 조각·사다리 레인 배치가 이 순서다
  joinOrder: number
}

// 방 메타데이터 — room:snapshot의 room 필드
export interface Room {
  // 서버 내부 6자리 숫자 코드. 소켓 인증과 URL에 쓰는 값이 이쪽이다
  code: string
  // 화면 표시용 `MODU-123456` 형태
  displayCode: string
  roomName: string
  maxMembers: number
  roomStatus: RoomStatus
  // 방장이 아직 프로필을 확정하지 않았으면 null
  hostMemberId: MemberId | null
  expiresAt: string
}

// 자신의 상태 — 프로필 화면에 있는지 대기방에 있는지 이 값으로 가른다
export interface Me {
  memberId: MemberId
  isHost: boolean
  memberStatus: MemberStatus
}

// 대기방에서 선택된 게임의 현재 상태 — 아직 아무것도 안 골랐으면 null.
// configSchema는 여기 실리지 않는다 — GET /api/games로 따로 받아 두고 버전만 대조한다.
export interface GameSelection {
  gameId: GameId
  config: GameConfig
  configSchemaVersion: number
}

/* ────────────────────────── 게임 설정(config) ────────────────────────── */

// 룰렛: 뽑을 역할/벌칙 한 줄
export interface RouletteConfig {
  topic: string
}

// 사다리: 주제와 도착 항목 목록, 연출 속도
export interface LadderConfig {
  topic: string
  // 도착 항목. 개수 제한이 없고 시작 시점에 서버가 인원수에 맞춰 X로 채우거나 뒤에서 자른다
  resultItems: string[]
  speed: 'FAST' | 'NORMAL' | 'SLOW'
}

// 킹메이커: 익명 안건 투표
export interface KingmakerConfig {
  topic: string
  // 1인당 던질 수 있는 표 수
  votesPerMember: 1 | 2 | 3
  // 결과 화면에서 안건 제시자를 실명 공개할지. 투표자는 어느 설정에서도 공개하지 않는다
  revealAuthors: boolean
}

// 시간초 잡기: 목표 시간과 승자 기준
export interface TimerConfig {
  topic: string
  // 목표 시간(초). 밀리초가 아니다
  targetSeconds: 5 | 7 | 10
  // CLOSEST = 오차 최소가 뽑힘, FARTHEST = 오차 최대가 뽑힘
  criterion: 'CLOSEST' | 'FARTHEST'
}

// 익명 저격: 질문과 투표 조건. 주제 필드 이름이 topic이 아니라 question이다
export interface SnipeConfig {
  question: string
  voteSeconds: number
  // 한 사람이 여러 명을 지목할 수 있는지
  multiVote: boolean
}

// 눈치게임: 동시입력 판정 폭과 라운드 제한시간
export interface NunchiConfig {
  topic: string
  // 이 시간(ms) 안에 겹친 입력은 동시 입력으로 본다
  windowMs: 300 | 500
  roundSeconds: 10 | 15 | 20
}

export type GameConfig =
  | RouletteConfig
  | LadderConfig
  | KingmakerConfig
  | TimerConfig
  | SnipeConfig
  | NunchiConfig

// gameId별 config 타입을 뽑아내기 위한 매핑 — 게임 화면에서 `ConfigOf<'timer'>`처럼 좁혀 쓴다
export interface ConfigByGame {
  roulette: RouletteConfig
  ladder: LadderConfig
  kingmaker: KingmakerConfig
  timer: TimerConfig
  snipe: SnipeConfig
  nunchi: NunchiConfig
}
export type ConfigOf<G extends GameId> = ConfigByGame[G]

/* ────────────────────────── configSchema (설정 UI 자동 생성용) ────────────────────────── */

// 설정 항목 하나 — 서버는 라벨을 내려주지 않으므로 화면 문구는 클라가 붙인다.
// kind별로 채워지는 필드가 다르다: enum은 choices, string/string_list는 maxLength, int는 min·max.
export interface ConfigField {
  name: string
  type: 'string' | 'string_list' | 'int' | 'enum' | 'boolean'
  default: unknown
  choices?: (string | number | boolean)[]
  maxLength?: number
  min?: number
  max?: number
}

// 한 게임의 설정 규격 — 순서가 곧 화면 표시 순서다 (객체가 아니라 배열이다)
export type ConfigSchema = ConfigField[]

// GET /api/games 목록 항목 하나
export interface GameSummary {
  gameId: GameId
  name: string
  // 대기방 게임 카드에 들어가는 한 줄 설명
  description: string
  minMembers: number
  maxMembers: number
  resultVariant: ResultVariant
  configSchema: ConfigSchema
}

// GET /api/games/{gameId} — 가이드 팝업이 쓰는 규칙·단계가 여기에만 있다
export interface GameDetail {
  gameId: GameId
  name: string
  minMembers: number
  resultVariant: ResultVariant
  // 가이드의 규칙 요약
  rules: string[]
  // 가이드의 진행 단계. 게임마다 2~4단계다
  steps: string[]
  configSchema: ConfigSchema
}

/* ────────────────────────── REST 요청/응답 ────────────────────────── */

export interface CreateRoomRequest {
  // 비우면(null) 서버가 기본 방 이름을 채운다
  roomName: string | null
  // 비우면(null) 서버가 기본 정원을 쓴다. 2~10
  maxMembers: number | null
}

// POST /api/rooms — 방과 PENDING 상태의 방장 슬롯을 함께 만든다
export interface CreateRoomResponse {
  code: string
  displayCode: string
  roomName: string
  maxMembers: number
  memberId: MemberId
  // 이후 모든 REST(Authorization: Bearer)와 소켓 인증에 쓰는 토큰
  memberToken: string
  memberStatus: 'PENDING'
  isHost: true
  expiresAt: string
}

// GET /api/rooms/{code} — 입장 화면에서 코드 유효성과 방 상태를 미리 확인. 인증이 필요 없다
export interface RoomLookupResponse {
  code: string
  displayCode: string
  roomName: string
  roomStatus: RoomStatus
  maxMembers: number
  // PENDING + ACTIVE 합산 (정원 판단 기준)
  currentMembers: number
  // 방장이 아직 프로필을 확정하지 않았으면 null
  hostNickname: string | null
}

// POST /api/rooms/{code}/members — 요청 바디 없음, PENDING 슬롯만 선점한다.
// 방 코드는 응답에 실리지 않으므로 호출한 쪽이 알고 있는 값을 그대로 쓴다
export interface JoinRoomResponse {
  memberId: MemberId
  memberToken: string
  memberStatus: 'PENDING'
  isHost: false
  currentMembers: number
  maxMembers: number
}

// GET /api/rooms/{code}/avatars 의 항목 하나 — 프로필 화면에서 3초 폴링으로 갱신한다
export interface AvatarSlot {
  avatarId: string
  // 이미 다른 사람이 확정(PATCH 성공)한 아바타인지. 클릭 시점이 아니라 확정 시점 기준
  taken: boolean
  // 선점한 사람의 표시용 닉네임. 식별자는 싣지 않는다
  takenBy: string | null
}

// GET /api/rooms/{code}/avatars 응답 — 항목 배열의 키가 content다
export interface AvatarListResponse {
  content: AvatarSlot[]
  totalCount: number
}

export interface ConfirmProfileRequest {
  // 1~8자, 공백 불가. 중복이어도 에러가 아니라 서버가 자동으로 번호를 붙인다
  nickname: string
  // null이면 서버가 미사용 최소 번호를 자동 배정
  avatarId: string | null
  bio: string | null
}

// PATCH /api/rooms/{code}/members/me — 성공하면 ACTIVE로 전환되고, 그 직후 소켓을 연결한다.
// 방 정보는 함께 오지 않는다 — 대기방 진입 후 room:snapshot이 그 역할을 한다.
// **nickname은 요청값이 아니라 이 응답값이 정본이다** — 중복이면 서버가 접미 숫자를 붙여 확정한다
export interface ConfirmProfileResponse {
  memberId: MemberId
  memberStatus: 'ACTIVE'
  nickname: string
  avatarId: string
  bio: string | null
  isHost: boolean
  // 방에서 몇 번째로 확정했는지 (1부터)
  joinOrder: number
}

/* ────────────────────────── 소켓: 게임별 phase ────────────────────────── */

// 게임마다 phase 집합이 다르다. 공통 phase는 READY·GUIDE·RESULT·ABORTED뿐이다.
// **모든 라운드는 READY로 시작한다** — game:started 직후 서버가 곧바로 보낸다
// (`app/services/round_service.py`). 게임의 첫 단계는 그 다음에 온다.
// ABORTED는 방장 이탈로 끝난 흡수 상태, VOID는 방장이 「대기방으로」를 골라 결과 없이 끝난 상태다.

export type RoulettePhase = 'READY' | 'GUIDE' | 'ARMED' | 'SPINNING' | 'REVEAL' | 'RESULT' | 'ABORTED'
export type LadderPhase = 'READY' | 'GUIDE' | 'ARMED' | 'DRAWING' | 'REVEAL' | 'RESULT' | 'ABORTED'
export type KingmakerPhase =
  | 'READY'
  | 'GUIDE'
  | 'SUBMIT'
  | 'VOTE'
  | 'TIE_NOTICE'
  | 'RUNOFF'
  | 'TALLY'
  | 'DEADLOCK'
  | 'RESULT'
  | 'VOID'
  | 'ABORTED'
export type TimerPhase =
  | 'READY'
  | 'GUIDE'
  | 'RUNNING'
  | 'TIE_NOTICE'
  | 'REMATCH'
  | 'REVEAL'
  | 'DEADLOCK'
  | 'RESULT'
  | 'VOID'
  | 'ABORTED'
export type SnipePhase =
  | 'READY'
  | 'GUIDE'
  | 'VOTE'
  | 'TIE_NOTICE'
  | 'RUNOFF'
  | 'REVEAL'
  | 'DEADLOCK'
  | 'RESULT'
  | 'VOID'
  | 'ABORTED'
export type NunchiPhase =
  | 'READY'
  | 'GUIDE'
  | 'ROUND'
  | 'ROUND_RESULT'
  | 'VOID_ROUND'
  | 'REVEAL'
  | 'RESULT'
  | 'VOID'
  | 'ABORTED'

export interface PhaseByGame {
  roulette: RoulettePhase
  ladder: LadderPhase
  kingmaker: KingmakerPhase
  timer: TimerPhase
  snipe: SnipePhase
  nunchi: NunchiPhase
}

// 어느 게임의 것인지 좁히기 전의 phase 전량
export type GamePhase = PhaseByGame[GameId]

/* ────────────────────────── 소켓: C→S ────────────────────────── */

// 클라이언트가 보내는 이벤트 이름 → payload 매핑. 서버가 받는 것은 이 11종뿐이다.
// **「다시 하기」 전용 이벤트가 없다** — 결과 화면에서 보낸 game:start를 서버가 방 상태로 가려 처리한다.
export interface ClientToServerEvents {
  'conn:auth': { protocolVersion: number; roomCode: string; memberToken: string }
  'member:ready': { ready: boolean }
  'member:kick': { memberId: MemberId }
  'chat:send': { text: string }
  'chat:typing': { typing: boolean }
  'game:select': { gameId: GameId }
  // 부분 갱신이다 — 보낸 필드만 덮어쓴다. 모르는 필드를 넣으면 game.invalid_config로 거절된다
  'game:config': { gameId: GameId; config: Record<string, unknown> }
  'game:random': Record<string, never>
  'game:start': Record<string, never>
  'game:action': GameActionRequest
  'game:decide': GameDecideRequest
  'round:close': { roundId: RoundId }
}

// 인게임 입력은 이벤트를 늘리지 않고 game:action 하나에 type으로 분기한다.
// **phaseSeq를 되싣는다** — 서버의 현재 값과 다르면 지난 단계의 입력이라 game.stale_phase로 버려진다.
export interface GameActionRequest {
  roundId: RoundId
  phaseSeq: number
  type: GameActionType
  requestId?: string
  payload?: Record<string, unknown>
}

// game:action의 type 8종. 각각 허용되는 phase가 정해져 있고 어긋나면 game.invalid_action이다.
export type GameActionType =
  // 방장만. ARMED에서 룰렛을 돌린다. 30초 동안 안 누르면 서버가 자동 실행한다
  | 'roulette.pick'
  // 방장만. ARMED에서 사다리를 실행한다. 30초 자동 실행은 같다
  | 'ladder.start'
  // SUBMIT에서 안건 1건을 익명 제출한다
  | 'king.opinion'
  // VOTE·RUNOFF에서 후보에 투표한다
  | 'king.vote'
  // RUNNING·REMATCH에서 각자 타이머를 시작·정지한다
  | 'timer.start'
  | 'timer.stop'
  // VOTE·RUNOFF에서 익명 지목한다. 빈 배열은 기권이다
  | 'snipe.vote'
  // ROUND에서 누른다
  | 'nunchi.up'

// 방장의 교착 해소 선택 — game:decision_required에 대한 응답
export interface GameDecideRequest {
  roundId: RoundId
  phaseSeq: number
  // RETRY = 같은 조건으로 다시, ABORT = 결과 없이 대기방으로
  choice: 'RETRY' | 'ABORT'
  requestId?: string
}

// type별 payload 모양. game:action을 보낼 때 이 표로 좁혀 쓴다.
export interface ActionPayloadByType {
  'roulette.pick': Record<string, never>
  'ladder.start': Record<string, never>
  'king.opinion': { text: string }
  // 후보 식별자. 서버는 candidateIds라는 이름으로 읽는다
  'king.vote': { candidateIds: OptionId[] }
  'timer.start': Record<string, never>
  // **클라가 잰 경과 시간을 같이 보낸다.** 안 보내면 서버가 자기 관측값으로 판정하면서
  // 보낸 사람에게 game.elapsed_rejected를 통지한다 — 정상 조작인데 매번 오류가 뜬다.
  // 서버 관측값과 0.4초 안에서 맞고 0 초과 개인 제한 이하일 때만 채택된다.
  'timer.stop': { elapsedMs: number }
  'snipe.vote': { targetMemberIds: MemberId[] }
  'nunchi.up': Record<string, never>
}

/* ────────────────────────── 소켓: S→C ────────────────────────── */

// 모든 S→C 이벤트가 공통으로 싣는 방 버전.
// **상태 이벤트에만 버전 게이트를 건다** — 통지(chat·tick·error)에 걸면 직전 상태 이벤트와
// 같은 번호를 달고 나간 프레임이 전부 버려진다.
export interface Versioned {
  roomVersion: number
}

// 인증 직후 딱 한 번 오는 초기 렌더용 전체 상태.
// 채팅과 진행 중인 라운드는 담기지 않는다 — 게임이 시작되면 새 소켓을 받지 않으므로
// 소켓이 붙는 시점의 방은 언제나 대기 상태다.
export interface SnapshotData extends Versioned {
  serverTime: string
  room: Room
  me: Me
  members: Member[]
  game: GameSelection | null
}

// 프로필 확정 시점에 나간다 — 소켓 연결 시점이 아니다
export interface MemberJoinedData extends Versioned {
  member: Member
}

// 방장이 나간 경우는 이 이벤트가 아니라 room:closed다
export interface MemberLeftData extends Versioned {
  memberId: MemberId
  reason: 'LEAVE' | 'KICK' | 'DISCONNECT'
  activeCount: number
}

// readyCount·activeCount는 서버가 세어 내려준다 — 클라가 명단을 세면 화면마다 값이 갈린다.
// 방장은 activeCount에 포함되지만 readyCount의 모수에서는 빠져, 목표치가 activeCount - 1이다.
export interface MemberReadyChangedData extends Versioned {
  memberId: MemberId
  ready: boolean
  readyCount: number
  activeCount: number
}

// 유예 진입·취소. **이 이벤트가 이탈을 뜻하지 않는다** — 이탈은 member:left나 room:closed로만 확정된다
export interface MemberConnectionData extends Versioned {
  memberId: MemberId
  state: ConnectionState
  // ONLINE으로 돌아오면 null
  graceEndsAt: string | null
}

// 보낸 본인을 포함한 전원에게 간다. 닉네임·아바타는 실리지 않으므로 명단에서 찾아 붙인다
export interface ChatMessageData extends Versioned {
  messageId: string
  memberId: MemberId
  text: string
  sentAt: string
}

export interface ChatTypingData extends Versioned {
  memberId: MemberId
  typing: boolean
}

// game:select · game:random 양쪽의 응답. configSchemaVersion으로 클라가 캐시한 규격과 대조한다
export interface GameSelectedData extends Versioned {
  gameId: GameId
  config: GameConfig
  configSchemaVersion: number
}

// 참여자 화면도 함께 바뀐다. 읽기 전용일 뿐이다
export interface GameConfigChangedData extends Versioned {
  gameId: GameId
  config: GameConfig
}

// 라운드에 고정된 참가자 한 명 — game:started의 roster 항목.
// **이 배열이 그 판의 후보 전량이며 도중 이탈해도 바뀌지 않는다.** joinOrder 순으로 정렬돼 있다.
export interface RosterEntry {
  memberId: MemberId
  nickname: string
  avatarId: string
  joinOrder: number
}

export interface GameStartedData extends Versioned {
  roundId: RoundId
  gameId: GameId
  config: GameConfig
  roster: RosterEntry[]
}

// 단계 전이. **클라이언트는 이 이벤트만 보고 화면을 전환한다** — 자체 타이머가 0에 닿았다는 이유로 넘기지 않는다.
// deadlineAt이 null이면 제한 시간이 없는 단계이며 그동안 game:tick도 흐르지 않는다.
export interface GamePhaseData extends Versioned {
  roundId: RoundId
  // 단계마다 1씩 오르는 일련번호. game:action에 그대로 되실어야 한다
  phaseSeq: number
  phase: GamePhase
  // 결선·재대결 회차 (본선은 0)
  tieRound: number
  deadlineAt: string | null
  serverTime: string
  // 연출 시작 값 (룰렛 목표 각도, 사다리 가로줄 등). 단계마다 모양이 다르다
  payload?: Record<string, unknown> | null
}

// 룰렛 SPINNING 단계의 payload — 어느 조각에서 멈추는지. 결과 이벤트는 연출이 끝난 뒤라 늦다
export interface RouletteSpinPayload {
  // 명단 스냅샷 순서 기준 조각 번호
  winnerIndex: number
}

// 사다리 DRAWING 단계의 payload — 가로줄 배치와 최종 배정이 함께 온다.
// rungs는 row 칸에서 leftLane과 leftLane+1을 잇는다. 칸 수는 최대 row + 1이다.
export interface LadderDrawPayload {
  assignments: { memberId: MemberId; slot: number; label: string }[]
  ladderRungs: { row: number; leftLane: number }[]
}

// 킹메이커 VOTE·RUNOFF 단계의 payload — 투표 화면이 그릴 후보 목록.
// **제출 순서(sort_order)도 제시자도 실리지 않는다** — 제출 완료 표시와 대조해 작성자를 추정할 수 있어서다.
export interface KingmakerBallotPayload {
  candidates: { optionId: OptionId; label: string }[]
}

// 입력이 몇 건 도착했는가. **누가 무엇을 골랐는지는 어떤 경우에도 실리지 않는다.**
// payload의 모양이 게임마다 다르므로 게임 화면이 좁혀 읽는다.
export interface GameProgressData extends Versioned {
  roundId: RoundId
  phaseSeq: number
  payload: ProgressPayload
}

// 게임별 game:progress payload.
// 눈치만 라운드가 마감된 뒤에 보낸다 — 그 게임에서는 "누가 이미 눌렀다"는 사실이 곧 정답이기 때문이다.
export type ProgressPayload =
  | { submittedCount: number; totalCount: number }
  | { votedCount: number; totalCount: number }
  | { startedCount: number; stoppedCount: number; totalCount: number }
  | NunchiRoundProgress

// 눈치 한 라운드의 판정 결과 — 라운드가 끝난 뒤에만 온다.
// 명단이 4종인 이유는 혼자 누름·겹쳐 누름이 결과가 같으면서(둘 다 빠진다) 화면 표시는 달라서다.
export interface NunchiRoundProgress {
  round: number
  verdicts: { memberId: MemberId; verdict: NunchiVerdict; elapsedMs: number | null }[]
  // 혼자 눌러 빠진 사람
  aloneMemberIds: MemberId[]
  // 판정창 안에 겹쳐 눌러 빠진 사람. 이들이 그 자리에서 라운드를 끊었다
  overlappedMemberIds: MemberId[]
  // 빠진 사람 전원 — 위 둘의 합집합이라 클라가 다시 계산하지 않아도 된다
  eliminatedMemberIds: MemberId[]
  // 못 눌러 다음 라운드로 넘어가는 사람
  survivingMemberIds: MemberId[]
  nextRoundStartsAt: string | null
}

// 눈치 라운드 판정 4값. **누르면 빠지고 못 누른 사람만 남는다** — 끝까지 못 누른 한 명이 뽑힌다
export type NunchiVerdict =
  // 혼자 눌러 빠진다
  | 'ALONE'
  // 판정창 안에 겹쳐 눌러 빠진다. 겹치는 순간 그 라운드가 끝난다
  | 'OVERLAP'
  // 누르지 못해 다음 라운드로 남는다
  | 'NO_INPUT'
  // 최후 1인으로 뽑힌다
  | 'LAST'

// 동점이라 다음 회차가 열린다. 결선은 새 라운드가 아니라 같은 roundId 안의 회차다.
// **득표 수는 싣지 않는다** — 다음 회차의 전략이 되기 때문이다.
export interface GameTieData extends Versioned {
  roundId: RoundId
  phaseSeq: number
  tieRound: number
  tieRoundMax: number
  candidateKind: 'MEMBER' | 'OPTION'
  candidateIds: string[]
  deadlineAt: string | null
}

// 자동 진행을 멈추고 방장이 고른다. **모든 반복 규칙의 탈출구다.**
// deadlineAt까지 응답이 없으면 서버가 ABORT로 처리한다.
export interface GameDecisionRequiredData extends Versioned {
  roundId: RoundId
  phaseSeq: number
  reason: 'TIE_EXHAUSTED' | 'VOID_ROUND' | 'NO_OPTION'
  options: ('RETRY' | 'ABORT')[]
  candidateKind: 'MEMBER' | 'OPTION'
  candidateIds: string[]
  deadlineAt: string
}

export interface GameResultData extends Versioned {
  roundId: RoundId
  gameId: GameId
  variant: ResultVariant
  result: GameResult
  finishedAt: string
}

// 1초 주기. **표시 전용이며 판정 근거가 아니다.**
export interface GameTickData extends Versioned {
  roundId: RoundId
  phaseSeq: number
  remainMs: number
  serverTime: string
}

// 대기방 복귀. 참여자 준비가 전부 해제된다
export interface RoundClosedData extends Versioned {
  roomStatus: RoomStatus
}

export interface RoomClosedData extends Versioned {
  reason: 'HOST_LEFT' | 'LAST_MEMBER_LEFT' | 'EXPIRED'
}

// error 프레임의 data — 코드와 문구는 봉투 쪽(code·message)에 있고 여기는 무엇에 대한 실패인지만 담는다
export interface ErrorData {
  event: string | null
  requestId: string | null
  roomVersion?: number
}

/* ────────────────────────── 소켓: 결과 payload ────────────────────────── */

// 결과 화면의 형태 4종. **게임과 1:1이 아니다** — 룰렛·시간초·저격이 모두 WINNER다.
export type ResultVariant = 'WINNER' | 'ASSIGN' | 'TALLY' | 'RECORD'

// 결과 화면 하단의 요약 수치. **서버가 문구까지 확정해 내려보내므로 클라가 계산하지 않는다.**
export interface ResultStat {
  label: string
  value: string
}

// 사람 1인이 뽑히는 형태 — 룰렛 · 시간초 · 저격.
// detail의 모양이 게임마다 다르므로 gameId로 좁혀 읽는다.
export interface WinnerResult {
  topic: string
  // 명단이 비는 예외 상황에서만 null이다
  winnerMemberId: MemberId | null
  detail: RouletteDetail | TimerDetail | SnipeDetail
  stats: ResultStat[]
}

// 룰렛 — 조각 배치와 시드. 재현·검증용이라 화면은 연출에만 쓴다
export interface RouletteDetail {
  seed: number
  // 조각 배치 순서 = 입장 순서
  sliceOrder: MemberId[]
}

// 시간초 — 목표와 전원의 기록
export interface TimerDetail {
  targetMs: number
  criterion: 'CLOSEST' | 'FARTHEST'
  records: TimerRecord[]
}

export interface TimerRecord {
  memberId: MemberId
  // 유효 기록이 없으면 null
  elapsedMs: number | null
  // 부호 있는 오차 (목표보다 빠르면 음수)
  diffMs: number | null
  // 값의 출처. 서버가 잰 것인지 대체값인지 가른다
  source: string
  // recorded = 유효, no_start = START 미도달, no_stop = STOP 미도달
  status: 'recorded' | 'no_start' | 'no_stop'
}

// 저격 — 사람별 피격 수. **지목자는 어떤 설정에서도 실리지 않는다.**
export interface SnipeDetail {
  tally: { memberId: MemberId; hits: number }[]
  abstainCount: number
  // 전원 동표 등으로 무작위 확정된 판인지
  randomFallback: boolean
}

// 전원 1:1 배정 — 사다리. optionId는 화면에 나가지 않는다
export interface AssignResult {
  topic: string
  pairs: { memberId: MemberId; itemLabel: string }[]
  seed: number
  stats: ResultStat[]
}

// 개표 — 킹메이커. **투표자는 어느 설정에서도 나가지 않는다.**
export interface TallyResult {
  topic: string
  winnerCandidateId: OptionId | null
  rows: TallyRow[]
  reveal: { authors: boolean }
  stats: ResultStat[]
}

export interface TallyRow {
  candidateId: OptionId
  text: string
  votes: number
  // revealAuthors가 켜진 판에만 이 자리가 생긴다. 익명이면 키 자체가 없다
  authorMemberId?: MemberId
}

// 라운드 기록 — 눈치. pickedMemberId가 최후 1인(뽑힌 사람)이다
export interface RecordResult {
  topic: string
  pickedMemberId: MemberId | null
  rounds: RecordRound[]
  stats: ResultStat[]
}

// 라운드마다 진행 중 판정(NunchiRoundProgress)과 같은 명단 4종을 함께 싣는다 —
// 결과 화면이 진행 화면과 같은 코드로 한 라운드를 그릴 수 있게 하려는 것이다
export interface RecordRound {
  round: number
  rows: { memberId: MemberId; verdict: NunchiVerdict; elapsedMs: number | null }[]
  aloneMemberIds: MemberId[]
  overlappedMemberIds: MemberId[]
  eliminatedMemberIds: MemberId[]
  survivingMemberIds: MemberId[]
}

export type GameResult = WinnerResult | AssignResult | TallyResult | RecordResult

// 서버가 보내는 이벤트 이름 → payload 매핑. S→C는 이 19종이 전량이다.
export interface ServerToClientEvents {
  'room:snapshot': SnapshotData
  'room:closed': RoomClosedData
  'member:joined': MemberJoinedData
  'member:left': MemberLeftData
  'member:ready_changed': MemberReadyChangedData
  'member:connection': MemberConnectionData
  'chat:message': ChatMessageData
  'chat:typing': ChatTypingData
  'game:selected': GameSelectedData
  'game:config_changed': GameConfigChangedData
  'game:started': GameStartedData
  'game:phase': GamePhaseData
  'game:tick': GameTickData
  'game:progress': GameProgressData
  'game:tie': GameTieData
  'game:decision_required': GameDecisionRequiredData
  'game:result': GameResultData
  'round:closed': RoundClosedData
  error: ErrorData
}

// 버전 게이트를 적용하는 상태 이벤트 — 이 목록에 없는 것은 게이트를 타지 않는다
export const STATE_EVENTS = [
  'room:snapshot',
  'room:closed',
  'member:joined',
  'member:left',
  'member:ready_changed',
  'member:connection',
  'game:selected',
  'game:config_changed',
  'game:started',
  'game:phase',
  'game:progress',
  'game:tie',
  'game:decision_required',
  'game:result',
  'round:closed',
] as const

// 채팅 한 줄 — 서버가 보관하지 않으므로 클라가 로컬스토리지에 쌓는다.
// 와이어에는 닉네임·아바타가 없어 명단에서 찾아 채운 뒤 저장한다.
export interface ChatMessage {
  messageId: string
  memberId: MemberId
  nickname: string
  avatarId: string
  text: string
  sentAt: string
}
