// 자동 생성 — 손으로 고치지 않는다.
//   python devtools/gen_socket_types.py > devtools/socket-events.ts
//
// 규약의 정본은 docs/07_api/03_socket_events.md다.
// REST 타입은 /openapi.json에서 openapi-typescript로 뽑는다.

export const PROTOCOL_VERSION = 1;

/** S->C 공통 봉투. 성공이든 실패든 같은 모양이다. */
export interface Envelope<E extends string, D> {
  event: E;
  success: boolean;
  code: string;
  message: string | null;
  data: D;
  timestamp: string;
}

/** C->S 프레임. 이벤트명과 데이터만 담는다. */
export interface Outgoing<E extends string, D> {
  event: E;
  data: D;
}

/** C->S conn:auth — 연결 후 첫 프레임. */
export interface AuthRequest {
  protocolVersion: number;
  roomCode: string;
  memberToken: string;
}

/** C->S chat:send. */
export interface ChatSendRequest {
  text: string;
}

/** C->S chat:typing. */
export interface TypingRequest {
  typing: boolean;
}

/** C->S member:ready. 토글이 아니라 대입이다. */
export interface ReadyRequest {
  ready: boolean;
}

/** C->S member:kick — 방장만. 대상은 외부 식별자로 지목한다. */
export interface KickRequest {
  memberId: string;
}

/** C->S game:select — 방장만. */
export interface GameSelectRequest {
  gameId: string;
}

/** C->S game:config — 방장만. **부분 갱신이다.** */
export interface GameConfigRequest {
  gameId: string;
  config: Record<string, unknown>;
}

/** 명단에 보이는 참가자. ACTIVE만 실린다. */
export interface MemberView {
  memberId: string;
  nickname: string;
  avatarId: string;
  bio: string | null;
  isHost: boolean;
  ready: boolean;
  connection: string;
  joinOrder: number;
}

export interface RoomView {
  code: string;
  displayCode: string;
  roomName: string;
  maxMembers: number;
  roomStatus: string;
  hostMemberId: string | null;
  expiresAt: string;
}

/** 자신의 상태. 프로필 화면에 있는지 대기방에 있는지 이 값으로 가른다. */
export interface MeView {
  memberId: string;
  isHost: boolean;
  memberStatus: string;
}

/** S->C room:snapshot — 인증 직후 최초 1회. */
export interface SnapshotData {
  roomVersion: number;
  serverTime: string;
  room: RoomView;
  me: MeView;
  members: MemberView[];
  game?: Record<string, unknown> | null;
}

/** S->C member:joined — 소켓 연결이 아니라 **프로필 확정** 시점에 나간다. */
export interface MemberJoinedData {
  roomVersion: number;
  member: MemberView;
}

/** S->C member:left — reason은 LEAVE · KICK · DISCONNECT 3값이다. */
export interface MemberLeftData {
  roomVersion: number;
  memberId: string;
  reason: string;
  activeCount: number;
}

/** S->C member:ready_changed. */
export interface MemberReadyChangedData {
  roomVersion: number;
  memberId: string;
  ready: boolean;
  readyCount: number;
  activeCount: number;
}

/** S->C member:connection — 유예 진입·취소. */
export interface MemberConnectionData {
  roomVersion: number;
  memberId: string;
  state: string;
  graceEndsAt: string | null;
}

/** S->C chat:message — 보낸 본인을 포함한 전원. */
export interface ChatMessageData {
  roomVersion: number;
  messageId: string;
  memberId: string;
  text: string;
  sentAt: string;
}

/** S->C chat:typing — **보낸 사람 본인은 제외**한다. */
export interface ChatTypingData {
  roomVersion: number;
  memberId: string;
  typing: boolean;
}

/** S->C game:selected — game:select · game:random 양쪽의 응답. */
export interface GameSelectedData {
  roomVersion: number;
  gameId: string;
  config: Record<string, unknown>;
  configSchemaVersion: number;
}

/** C->S round:close — 방장만. game:action에 흡수하지 않는다. */
export interface RoundCloseRequest {
  roundId: string;
}

/** S->C game:started. */
export interface GameStartedData {
  roomVersion: number;
  roundId: string;
  gameId: string;
  config: Record<string, unknown>;
  roster: Record<string, unknown>[];
}

/** S->C game:phase — 단계 전이. */
export interface GamePhaseData {
  roomVersion: number;
  roundId: string;
  phaseSeq: number;
  phase: string;
  tieRound: number;
  deadlineAt: string | null;
  serverTime: string;
  payload?: Record<string, unknown> | null;
}

/** C->S game:action — 게임 중의 모든 플레이어 입력이 이 하나로 들어온다. */
export interface GameActionRequest {
  roundId: string;
  phaseSeq: number;
  type: string;
  requestId?: string | null;
  payload?: Record<string, unknown> | null;
}

/** S->C game:result — 확정된 결과. */
export interface GameResultData {
  roomVersion: number;
  roundId: string;
  gameId: string;
  variant: string;
  result: Record<string, unknown>;
  finishedAt: string;
}

/** S->C game:tick — 1초 주기. **표시 전용이며 판정 근거가 아니다.** */
export interface GameTickData {
  roomVersion: number;
  roundId: string;
  phaseSeq: number;
  remainMs: number;
  serverTime: string;
}

/** S->C round:closed — 대기방 복귀. 참여자 준비가 전부 해제된다. */
export interface RoundClosedData {
  roomVersion: number;
  roomStatus: string;
}

/** S->C game:config_changed — **참여자 화면도 함께 바뀐다.** 읽기 전용일 뿐이다. */
export interface GameConfigChangedData {
  roomVersion: number;
  gameId: string;
  config: Record<string, unknown>;
}

/** S->C room:closed — HOST_LEFT · LAST_MEMBER_LEFT · EXPIRED. */
export interface RoomClosedData {
  roomVersion: number;
  reason: string;
}

/** error 이벤트의 data. event와 requestId를 에코한다. */
export interface ErrorData {
  event: string | null;
  requestId: string | null;
  roomVersion?: number;
}

export interface ClientEvents {
  "conn:auth": AuthRequest;
  "member:ready": ReadyRequest;
  "member:kick": KickRequest;
  "chat:send": ChatSendRequest;
  "chat:typing": TypingRequest;
  "game:select": GameSelectRequest;
  "game:config": GameConfigRequest;
  "game:random": Record<string, never>;
  "game:start": Record<string, never>;
  "game:action": GameActionRequest;
  "round:close": RoundCloseRequest;
}

export interface ServerEvents {
  "room:snapshot": SnapshotData;
  "room:closed": RoomClosedData;
  "member:joined": MemberJoinedData;
  "member:left": MemberLeftData;
  "member:ready_changed": MemberReadyChangedData;
  "member:connection": MemberConnectionData;
  "chat:message": ChatMessageData;
  "chat:typing": ChatTypingData;
  "game:selected": GameSelectedData;
  "game:config_changed": GameConfigChangedData;
  "game:started": GameStartedData;
  "game:phase": GamePhaseData;
  "game:tick": GameTickData;
  "game:result": GameResultData;
  "round:closed": RoundClosedData;
  "error": ErrorData;
}

export type ClientEventName = keyof ClientEvents;
export type ServerEventName = keyof ServerEvents;

export type ServerFrame = {
  [E in ServerEventName]: Envelope<E, ServerEvents[E]>;
}[ServerEventName];

export type ClientFrame = {
  [E in ClientEventName]: Outgoing<E, ClientEvents[E]>;
}[ClientEventName];

/**
 * 버전 게이트를 적용하는 상태 이벤트.
 * 마지막으로 반영한 번호보다 작거나 같으면 무시한다.
 * **통지 이벤트에는 걸지 않는다** — 걸면 방 상태를 바꾸지 않는 이벤트가
 * 직전 상태 이벤트와 같은 번호를 달고 나가 전부 버려진다.
 */
export const STATE_EVENTS = ["room:snapshot", "room:closed", "member:joined", "member:left", "member:ready_changed", "member:connection", "game:selected", "game:config_changed", "game:started", "game:phase", "game:progress", "game:tie", "game:decision_required", "game:result", "round:closed"] as const;
export const NOTICE_EVENTS = ["chat:message", "chat:typing", "game:tick", "error"] as const;

/** 소켓 종료 코드. **어느 코드에서도 자동 재연결하지 않는다.** */
export const CloseCode = {
  NORMAL: 1000,
  PROTOCOL_ERROR: 4002,
  UNAUTHORIZED: 4401,
  KICKED: 4403,
  AUTH_TIMEOUT: 4408,
  DUPLICATE: 4409,
  ROOM_CLOSED: 4410,
  TOO_LARGE: 4413,
} as const;

/** 에러 코드 전량. REST와 소켓이 같은 문자열을 쓴다. */
export const ERROR_CODES = [
  "common.idempotency_conflict",
  "common.internal",
  "common.payload_too_large",
  "common.protocol_unsupported",
  "common.protocol_violation",
  "common.rate_limited",
  "common.session_expired",
  "common.unauthenticated",
  "common.validation_failed",
  "game.already_submitted",
  "game.decision_not_required",
  "game.elapsed_rejected",
  "game.invalid_action",
  "game.invalid_config",
  "game.not_all_ready",
  "game.not_eligible",
  "game.not_enough_members",
  "game.not_found",
  "game.not_selected",
  "game.round_already_ended",
  "game.round_not_found",
  "game.stale_phase",
  "member.already_active",
  "member.avatar_invalid",
  "member.avatar_taken",
  "member.bio_too_long",
  "member.kicked",
  "member.nickname_invalid",
  "member.not_active",
  "member.not_found",
  "member.not_host",
  "member.self_kick",
  "room.already_playing",
  "room.code_exhausted",
  "room.expired",
  "room.full",
  "room.host_left",
  "room.not_found",
  "vote.duplicate_target",
  "vote.limit_exceeded",
  "vote.self_not_allowed",
  "vote.target_not_found",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
