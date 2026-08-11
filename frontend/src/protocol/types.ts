// ModuPick 프론트-서버 공통 계약 타입.
// REST 구간(방 생성~프로필 확정)은 실제 백엔드(`backend/app/schemas/rest.py` · `app/domain/errors.py`)를 정본으로 삼는다.
// 소켓 구간은 아직 임시 서버(local-server/) 계약이며, 백엔드 소켓 전환 작업에서 함께 옮긴다.

/* ────────────────────────── 기본 식별자 ────────────────────────── */

// 멤버 식별자 — 서버가 발급하는 `mbr_` 접두 불투명 문자열 (내용을 파싱하지 말 것)
export type MemberId = string
// 라운드(게임 한 판) 식별자 — `rnd_` 접두
export type RoundId = string
// 킹메이커 안건 식별자 — `opt_` 접두
export type OptionId = string

// 게임 6종 식별자 — 서버/클라 양쪽에서 이 문자열 그대로 사용
export type GameId = 'roulette' | 'ladder' | 'kingmaker' | 'timer' | 'snipe' | 'nunchi'

// 방 상태 — 서버는 저장값(소문자)과 와이어 표기(대문자)를 구분하며 API에는 대문자만 실린다.
// 결과 화면은 방 상태가 아니라 라운드의 단계(phase)이므로 여기 값이 아니다.
export type RoomStatus = 'WAITING' | 'PLAYING'

// 멤버 상태 — PENDING은 프로필 확정 전 슬롯 선점 단계, ACTIVE는 확정 후 명단에 보이는 상태
export type MemberStatus = 'PENDING' | 'ACTIVE'

// 방 안에서의 권한 — 방장 위임이 없으므로 라운드 중에도 바뀌지 않는다
export type MemberRole = 'host' | 'guest'

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

// 방에 들어와 있는 사람 한 명 — 대기방 명단·게임 화면·결과 화면이 모두 이 형태를 쓴다
export interface Member {
  memberId: MemberId
  nickname: string
  // A01~A30 중 하나. 방 안에서 중복 불가
  avatarId: string
  // 한 줄 소개, 0~24자 (없으면 빈 문자열)
  bio: string
  role: MemberRole
  status: MemberStatus
  // guest 전용 준비 상태. host는 Ready 개념이 없어 항상 false
  ready: boolean
  joinedAt: string
}

// 방 메타데이터 — snapshot과 REST 조회가 공유하는 형태
export interface Room {
  // 서버 내부 6자리 숫자 코드
  code: string
  // 화면 표시용 `MODU-123456` 형태
  displayCode: string
  roomName: string
  maxMembers: number
  status: RoomStatus
  hostMemberId: MemberId
  // 10분 무활동 만료 시각 (ISO 8601)
  expiresAt: string
}

// 대기방에서 선택된 게임의 현재 상태 — 아직 아무것도 안 골랐으면 null
export interface GameSelection {
  gameId: GameId
  // 현재 확정된 옵션 값 (게임별 형태가 달라 느슨하게 둔다)
  config: GameConfig
  configSchema: ConfigSchema
}

/* ────────────────────────── 게임 설정(config) ────────────────────────── */

// 룰렛: 뽑을 역할/벌칙 한 줄
export interface RouletteConfig {
  topic: string
}

// 사다리: 하단 결과 항목 목록과 애니메이션 속도
export interface LadderConfig {
  // 주제가 곧 도착 항목이다 — 별도의 topic 필드가 없다. 1~10개, 각 1~12자.
  // 시작 시 인원수에 맞춰 서버가 X로 채우거나 자른다
  items: string[]
  speed: 'fast' | 'normal' | 'slow'
}

// 킹메이커: 익명 안건 투표
export interface KingmakerConfig {
  topic: string
  // 1인당 던질 수 있는 표 수 (1·2·3)
  votesPerMember: number
  // 결과 화면에서 안건 제시자를 실명 공개할지
  revealAuthors: boolean
}

// 시간초 잡기: 목표 시간과 승자 기준
export interface TimerConfig {
  topic: string
  // 목표 시간 (5000·7000·10000 ms)
  targetMs: number
  // closest = 오차 최소가 당첨, farthest = 오차 최대가 당첨
  winnerRule: 'closest' | 'farthest'
}

// 익명 저격: 질문과 투표 조건
export interface SnipeConfig {
  // 질문 문구, 1~30자
  topic: string
  voteSeconds: number
  // 한 사람이 여러 명을 지목할 수 있는지
  allowMultipleTargets: boolean
  // 결과에서 누가 누구를 찍었는지 공개할지
  revealVoters: boolean
}

// 눈치게임: 동시입력 판정 폭과 서브라운드 제한시간
export interface NunchiConfig {
  topic: string
  // 이 시간(ms) 안에 몰린 클릭은 동시 입력으로 간주 (300 = 기본, 500 = 하드)
  decisionWindowMs: number
  subRoundTimeoutMs: number
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

// 자유 입력 문자열 필드 (주제 등)
export interface TextField {
  type: 'text'
  label: string
  minLength: number
  maxLength: number
  default: string
}

// 정해진 값 중 하나를 고르는 필드 — 세그먼트 버튼으로 그린다
export interface EnumField {
  type: 'enum'
  label: string
  // 실제 저장값과 화면 표기를 함께 넘겨 클라가 라벨을 하드코딩하지 않게 한다
  options: { value: string | number | boolean; label: string }[]
  default: string | number | boolean
}

// 문자열 목록 필드 (사다리 결과 항목) — 칩 추가/삭제 UI로 그린다
export interface ListField {
  type: 'list'
  label: string
  minItems: number
  maxItems: number
  itemMaxLength: number
  default: string[]
}

export type ConfigField = TextField | EnumField | ListField

// 게임 하나의 설정 스키마 — 키는 config의 필드명과 일치한다
export type ConfigSchema = Record<string, ConfigField>

// GET /api/games 응답의 항목 하나
export interface GameMeta {
  gameId: GameId
  name: string
  // 대기방 게임 카드에 들어가는 한 줄 설명
  tagline: string
  minMembers: number
  maxMembers: number
  configSchema: ConfigSchema
  // 시작 직후 3초 가이드 팝업에 표시할 진행 방법 (순서대로)
  guide: string[]
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
  // 10분 무활동 만료 시각
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

/* ────────────────────────── 소켓: C→S ────────────────────────── */

// 클라이언트가 보내는 이벤트 이름 → payload 매핑
export interface ClientToServerEvents {
  'member:ready': (p: { ready: boolean }) => void
  'member:kick': (p: { memberId: MemberId }) => void
  'chat:send': (p: { text: string }) => void
  'chat:typing': (p: { typing: boolean }) => void
  'game:select': (p: { gameId: GameId }) => void
  'game:config': (p: { gameId: GameId; config: Partial<GameConfig> }) => void
  'game:random': (p: Record<string, never>) => void
  'game:start': (p: Record<string, never>) => void
  'game:replay': (p: Record<string, never>) => void
  'game:action': (p: GameActionPayload) => void
  'round:close': (p: { roundId: RoundId }) => void
}

// 인게임 입력은 이벤트를 늘리지 않고 game:action 하나에 type으로 분기한다 (API-03)
export type GameActionPayload =
  | { roundId: RoundId; type: 'roulette.pick'; payload: Record<string, never> }
  | { roundId: RoundId; type: 'ladder.start'; payload: Record<string, never> }
  | { roundId: RoundId; type: 'king.opinion'; payload: { text: string } }
  | { roundId: RoundId; type: 'king.vote'; payload: { optionIds: OptionId[] } }
  | { roundId: RoundId; type: 'timer.start'; payload: Record<string, never> }
  | { roundId: RoundId; type: 'timer.stop'; payload: Record<string, never> }
  | { roundId: RoundId; type: 'snipe.vote'; payload: { targetMemberIds: MemberId[] } }
  | { roundId: RoundId; type: 'nunchi.up'; payload: Record<string, never> }
  | { roundId: RoundId; type: 'nunchi.invalid_decision'; payload: { decision: 'RESTART' | 'ABORT' } }

/* ────────────────────────── 소켓: S→C ────────────────────────── */

// 모든 S→C 이벤트가 공통으로 싣는 방 버전 — 받은 값이 보관 중인 값보다 작거나 같으면 무시한다 (API-02)
export interface Versioned {
  roomVersion: number
}

// 연결 직후 딱 한 번 오는 초기 렌더용 전체 상태
export interface RoomSnapshot extends Versioned {
  room: Room
  // active인 사람만 포함 (pending은 아직 명단에 안 보임)
  members: Member[]
  game: GameSelection | null
  // 현재 인원으로 시작 가능한 게임들 — 최소인원 판단 근거를 서버에 둔다 (API-06)
  selectableGameIds: GameId[]
  // 재접속 직후 진행 중인 라운드가 있으면 그 요약 (없으면 null)
  round: RoundState | null
  me: MemberId
}

// 게임 진행 단계 — 게임마다 쓰는 값이 다르다
export type GamePhase =
  | 'GUIDE'
  | 'READY'
  | 'PLAYING'
  | 'SUBMIT'
  | 'VOTE'
  | 'TIE'
  | 'INVALID'
  | 'RESULT'

// 라운드 하나의 진행 상태 — game:started 이후 화면이 계속 참조한다
export interface RoundState {
  roundId: RoundId
  gameId: GameId
  config: GameConfig
  // 시작 시점에 고정된 참가자 명단. 도중 이탈해도 제거하지 않고 departed만 켠다
  roundMembers: RoundMember[]
  phase: GamePhase
  // 현재 phase의 마감 시각 (없는 phase면 null)
  deadlineAt: string | null
  // 킹메이커 VOTE phase에서만 채워지는 익명 안건 목록
  options?: KingmakerOption[]
  // 눈치게임에서 현재 몇 번째 서브라운드인지 (1부터)
  subRound?: number
  // 눈치게임 생존자 — 서브라운드마다 갱신
  aliveMemberIds?: MemberId[]
}

// 라운드에 고정된 참가자 한 명
export interface RoundMember {
  memberId: MemberId
  nickname: string
  avatarId: string
  // 라운드 도중 소켓이 끊겨 나간 사람. 명단에는 남되 새 입력만 막는다
  departed: boolean
}

// 킹메이커 안건 하나 — 제시자는 revealAuthors가 true인 결과 화면에서만 채워진다
export interface KingmakerOption {
  optionId: OptionId
  text: string
  authorMemberId?: MemberId
  authorNickname?: string
}

// 서버가 1초마다 쏘는 시각 동기화 — 클라 타이머는 이 값을 기준으로 보정한다 (API-07)
export interface ServerTick extends Versioned {
  // 서버 기준 현재 시각 (epoch ms)
  serverTime: number
  // 현재 phase 남은 시간 (ms). phase에 마감이 없으면 null
  phaseRemainMs: number | null
  roomExpiresInMs: number
}

// 중간 집계 — 누가 냈는지만 알린다 (API-04)
export interface GameProgress extends Versioned {
  roundId: RoundId
  entries: { memberId: MemberId; state: 'COMPLETE' | 'WAITING' }[]
  // 킹메이커 투표 단계에서만 채워지는 항목별 익명 득표수 (`878:684`의 실시간 득표 현황이 요구한다).
  // 누가 어디에 넣었는지는 여전히 알 수 없어 "투표자 비공개" 규칙과 어긋나지 않는다.
  optionVotes?: { optionId: OptionId; votes: number }[]
}

// 결과 형태 4종 — 화면이 어떤 연출을 쓸지 이 값으로 고른다
export type ResultVariant = 'winner' | 'assign' | 'tally' | 'record'

// 눈치게임 한 라운드에서 누가 왜 살고 죽었는지 — 결과 화면(542:2619)의 "라운드별 판정 기록" 표가 그대로 쓴다.
// 기본 계약(detail 문자열)만으로는 시각·사유·인물을 갈라 그릴 수 없어 넓힌 필드다.
export interface NunchiRoundLog {
  subRound: number
  // 이 라운드를 시작한 인원
  entered: number
  // 혼자 눌러 살아남은 사람들, 누른 순서대로. elapsedMs는 라운드 시작부터의 경과
  passed: { memberId: MemberId; nickname: string; avatarId: string; elapsedMs: number }[]
  // 이 라운드에서 탈락한 사람들. elapsedMs가 null이면 제한시간까지 아예 안 누른 것
  eliminated: { memberId: MemberId; nickname: string; avatarId: string; elapsedMs: number | null }[]
  // 탈락 사유 — 겹쳐 누름 / 시간 초과 / 마지막 한 명만 남음 / 남은 전원이 눌러버림 / 연결 끊김
  reason: 'SIMULTANEOUS' | 'TIMEOUT' | 'LAST_ONE' | 'ALL_PRESSED' | 'DISCONNECTED'
  // 겹쳐 누름일 때 가장 가까웠던 두 입력의 간격(ms)
  gapMs?: number
}

// 단독 당첨자 1명 (룰렛·저격·눈치)
export interface WinnerResult {
  variant: 'winner'
  topic: string
  winner: RoundMember
  // 눈치게임 라운드별 탈락 순서 등, 게임별 부가 설명 줄
  detail?: string[]
  // 눈치게임 전용 — 라운드별 판정 기록. 없으면 당첨자 카드(542:1119)로 발표한다
  rounds?: NunchiRoundLog[]
}

// 참가자 ↔ 항목 1:1 배정 (사다리)
export interface AssignResult {
  variant: 'assign'
  topic: string
  assignments: { member: RoundMember; item: string }[]
  // 사다리 애니메이션을 서버 확정 경로대로 재생하기 위한 구조
  ladder?: LadderStructure
}

// 득표 집계 (킹메이커·저격)
export interface TallyResult {
  variant: 'tally'
  topic: string
  // 득표순 정렬. 익명 모드면 voters는 비어 있다
  rows: {
    label: string
    votes: number
    rank: number
    optionId?: OptionId
    memberId?: MemberId
    authorNickname?: string
    voterNicknames?: string[]
  }[]
  winnerLabel: string
}

// 기록 경쟁 (시간초 잡기)
export interface RecordResult {
  variant: 'record'
  topic: string
  targetMs: number
  winnerRule: 'closest' | 'farthest'
  rows: {
    member: RoundMember
    // 서버가 잰 경과 시간. START를 안 눌러 실격이면 null
    elapsedMs: number | null
    // 표시용 부호 포함 시간차 (목표보다 빠르면 음수)
    diffMs: number | null
    // 판정용 절대 오차
    absErrorMs: number | null
    rank: number
  }[]
  winnerMemberId: MemberId
}

export type GameResult = WinnerResult | AssignResult | TallyResult | RecordResult

// 사다리 구조 — 서버가 확정한 가로줄 위치와 각 참가자의 최종 경로
export interface LadderStructure {
  laneCount: number
  // 세로로 몇 칸인지
  rowCount: number
  // 가로줄: row 번째 칸에서 lane과 lane+1을 잇는다
  rungs: { row: number; lane: number }[]
  // 참가자별 도착 레인 (출발 레인 인덱스 순서)
  arrivals: number[]
}

// 서버가 이벤트로 보내는 이름 → payload 매핑
export interface ServerToClientEvents {
  'room:snapshot': (p: RoomSnapshot) => void
  // 인원이 바뀌면 최소인원을 만족하는 게임 목록도 함께 갱신된다
  'member:joined': (p: Versioned & { member: Member; selectableGameIds: GameId[] }) => void
  'member:left': (
    p: Versioned & {
      memberId: MemberId
      reason: 'LEAVE' | 'KICKED' | 'DISCONNECT'
      selectableGameIds: GameId[]
    },
  ) => void
  'member:kicked': (p: Versioned & { reason: 'KICKED' }) => void
  'member:ready_changed': (
    p: Versioned & {
      memberId: MemberId
      ready: boolean
      readyCount: number
      activeCount: number
    },
  ) => void
  'chat:message': (p: Versioned & ChatMessage) => void
  'chat:typing': (p: Versioned & { memberId: MemberId; typing: boolean }) => void
  'game:selected': (
    p: Versioned & { gameId: GameId; config: GameConfig; configSchema: ConfigSchema },
  ) => void
  'game:config_changed': (p: Versioned & { gameId: GameId; config: GameConfig }) => void
  'game:started': (
    p: Versioned & {
      roundId: RoundId
      gameId: GameId
      roundMembers: RoundMember[]
      config: GameConfig
      // 최초 시작이면 3초 가이드가 끝나는 시각, "다시 하기"면 null (가이드 생략)
      guideEndsAt: string | null
    },
  ) => void
  'game:phase': (
    p: Versioned & {
      roundId: RoundId
      phase: GamePhase
      deadlineAt: string | null
      options?: KingmakerOption[]
      subRound?: number
      aliveMemberIds?: MemberId[]
    },
  ) => void
  'server:tick': (p: ServerTick) => void
  'game:progress': (p: GameProgress) => void
  'game:tie': (
    p: Versioned & {
      roundId: RoundId
      // 동점으로 남은 후보들 (킹메이커는 안건, 나머지는 사람)
      candidates: { id: string; label: string }[]
      deadlineAt: string | null
    },
  ) => void
  'game:result': (
    p: Versioned & {
      roundId: RoundId
      variant: ResultVariant
      result: GameResult
      // 전원이 동시에 결과 화면으로 넘어가는 절대 시각 (API-05)
      resultScreenAt: string
    },
  ) => void
  'round:closed': (
    p: Versioned & {
      roundId: RoundId
      reason: 'COMPLETED' | 'NO_OPTIONS' | 'NUNCHI_ABORTED'
    },
  ) => void
  'room:closed': (p: Versioned & { reason: 'HOST_LEFT' | 'EMPTY' | 'INACTIVE' }) => void
  error: (p: { code: ErrorCode; message: string }) => void
}

// 채팅 한 줄 — 서버가 저장하지 않으므로 클라가 로컬스토리지에 쌓는다
export interface ChatMessage {
  messageId: string
  memberId: MemberId
  nickname: string
  avatarId: string
  text: string
  sentAt: string
}
