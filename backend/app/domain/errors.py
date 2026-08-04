"""도메인 에러 42종.

정본은 docs/10_glossary/02_error_codes.md이며 여기서 코드를 새로 만들지 않는다.
REST와 WebSocket이 같은 문자열을 쓴다 — 소켓 전용 코드를 두지 않는다.

message는 그대로 화면에 띄울 수 있는 한국어 문안이다. 프론트가 코드별 문구를
따로 관리하지 않게 하려는 규약이므로 서버가 실어 보낸다.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ErrorSpec:
    code: str
    status: int
    message: str


class DomainError(Exception):
    """도메인 규칙 위반. api/errors.py가 공통 응답 봉투로 변환한다."""

    def __init__(self, spec: ErrorSpec, *, message: str | None = None) -> None:
        self.spec = spec
        self.message = message or spec.message
        super().__init__(f"{spec.code}: {self.message}")


# ── room — 방 (6종) ────────────────────────────────────────────────────────
ROOM_NOT_FOUND = ErrorSpec("room.not_found", 404, "없는 방이에요")
ROOM_ALREADY_PLAYING = ErrorSpec(
    "room.already_playing", 409, "게임이 진행 중이에요. 끝나면 들어올 수 있어요"
)
ROOM_FULL = ErrorSpec("room.full", 409, "방이 가득 찼어요")
ROOM_EXPIRED = ErrorSpec("room.expired", 410, "오래 활동이 없어 방이 사라졌어요")
ROOM_HOST_LEFT = ErrorSpec("room.host_left", 410, "방장이 나가서 방이 사라졌어요")
ROOM_CODE_EXHAUSTED = ErrorSpec(
    "room.code_exhausted", 503, "지금은 방을 만들 수 없어요. 잠시 뒤 다시 시도해 주세요"
)

# ── member — 참가자 (10종) ─────────────────────────────────────────────────
MEMBER_NOT_FOUND = ErrorSpec("member.not_found", 404, "찾을 수 없는 참가자예요")
MEMBER_NOT_HOST = ErrorSpec("member.not_host", 403, "방장만 할 수 있어요")
MEMBER_NOT_ACTIVE = ErrorSpec("member.not_active", 403, "프로필을 먼저 정해 주세요")
MEMBER_NICKNAME_INVALID = ErrorSpec(
    "member.nickname_invalid", 400, "닉네임은 1~8자로 적어 주세요"
)
MEMBER_AVATAR_INVALID = ErrorSpec("member.avatar_invalid", 400, "고를 수 없는 아바타예요")
MEMBER_AVATAR_TAKEN = ErrorSpec(
    "member.avatar_taken", 409, "방금 다른 분이 고른 아바타예요. 다른 걸 골라 주세요"
)
MEMBER_BIO_TOO_LONG = ErrorSpec("member.bio_too_long", 400, "소개는 24자까지 적을 수 있어요")
MEMBER_ALREADY_ACTIVE = ErrorSpec("member.already_active", 409, "이미 입장했어요")
MEMBER_KICKED = ErrorSpec("member.kicked", 403, "방장이 내보냈어요")
MEMBER_SELF_KICK = ErrorSpec("member.self_kick", 400, "자기 자신은 내보낼 수 없어요")

# ── game — 게임 (13종) ─────────────────────────────────────────────────────
GAME_NOT_FOUND = ErrorSpec("game.not_found", 404, "찾을 수 없는 게임이에요")
GAME_NOT_SELECTED = ErrorSpec("game.not_selected", 400, "게임을 먼저 골라 주세요")
GAME_INVALID_CONFIG = ErrorSpec("game.invalid_config", 400, "설정값을 다시 확인해 주세요")
GAME_NOT_ENOUGH_MEMBERS = ErrorSpec(
    "game.not_enough_members", 400, "사람이 더 모여야 시작할 수 있어요"
)
GAME_NOT_ALL_READY = ErrorSpec("game.not_all_ready", 400, "아직 준비하지 않은 분이 있어요")
GAME_ROUND_NOT_FOUND = ErrorSpec("game.round_not_found", 404, "지난 판이라 반영되지 않았어요")
GAME_ROUND_ALREADY_ENDED = ErrorSpec("game.round_already_ended", 409, "이미 끝난 판이에요")
GAME_STALE_PHASE = ErrorSpec("game.stale_phase", 409, "이미 지난 단계의 입력이에요")
GAME_INVALID_ACTION = ErrorSpec("game.invalid_action", 400, "지금은 할 수 없는 동작이에요")
GAME_ALREADY_SUBMITTED = ErrorSpec("game.already_submitted", 409, "이미 제출했어요")
GAME_NOT_ELIGIBLE = ErrorSpec(
    "game.not_eligible", 403, "이번 단계에서는 입력하지 않아도 돼요"
)
GAME_ELAPSED_REJECTED = ErrorSpec(
    "game.elapsed_rejected", 409, "기록이 서버 측정값으로 반영됐어요"
)
GAME_DECISION_NOT_REQUIRED = ErrorSpec(
    "game.decision_not_required", 409, "지금은 고를 차례가 아니에요"
)

# ── vote — 투표 (4종) ──────────────────────────────────────────────────────
VOTE_SELF_NOT_ALLOWED = ErrorSpec("vote.self_not_allowed", 400, "자기 자신은 고를 수 없어요")
VOTE_TARGET_NOT_FOUND = ErrorSpec("vote.target_not_found", 404, "고를 수 없는 대상이에요")
VOTE_LIMIT_EXCEEDED = ErrorSpec("vote.limit_exceeded", 409, "고를 수 있는 수를 넘었어요")
VOTE_DUPLICATE_TARGET = ErrorSpec(
    "vote.duplicate_target", 400, "같은 대상은 한 번만 고를 수 있어요"
)

# ── common — 공통 (9종) ────────────────────────────────────────────────────
COMMON_UNAUTHENTICATED = ErrorSpec("common.unauthenticated", 401, "다시 입장해 주세요")
COMMON_SESSION_EXPIRED = ErrorSpec(
    "common.session_expired", 401, "연결이 만료됐어요. 다시 입장해 주세요"
)
COMMON_VALIDATION_FAILED = ErrorSpec(
    "common.validation_failed", 400, "입력값을 다시 확인해 주세요"
)
COMMON_IDEMPOTENCY_CONFLICT = ErrorSpec(
    "common.idempotency_conflict", 409, "요청을 처리하지 못했어요. 다시 시도해 주세요"
)
COMMON_PAYLOAD_TOO_LARGE = ErrorSpec("common.payload_too_large", 413, "내용이 너무 길어요")
COMMON_RATE_LIMITED = ErrorSpec(
    "common.rate_limited", 429, "요청이 잦아요. 잠시 뒤 다시 시도해 주세요"
)
COMMON_PROTOCOL_UNSUPPORTED = ErrorSpec(
    "common.protocol_unsupported", 400, "화면을 새로고침해 주세요"
)
COMMON_PROTOCOL_VIOLATION = ErrorSpec(
    "common.protocol_violation", 400, "연결에 문제가 생겼어요. 다시 입장해 주세요"
)
COMMON_INTERNAL = ErrorSpec("common.internal", 500, "잠시 문제가 생겼어요. 다시 시도해 주세요")


#: 전수 검증용. docs/10_glossary/02_error_codes.md가 42종을 확정했다.
ALL_SPECS: tuple[ErrorSpec, ...] = (
    ROOM_NOT_FOUND, ROOM_ALREADY_PLAYING, ROOM_FULL, ROOM_EXPIRED,
    ROOM_HOST_LEFT, ROOM_CODE_EXHAUSTED,
    MEMBER_NOT_FOUND, MEMBER_NOT_HOST, MEMBER_NOT_ACTIVE, MEMBER_NICKNAME_INVALID,
    MEMBER_AVATAR_INVALID, MEMBER_AVATAR_TAKEN, MEMBER_BIO_TOO_LONG,
    MEMBER_ALREADY_ACTIVE, MEMBER_KICKED, MEMBER_SELF_KICK,
    GAME_NOT_FOUND, GAME_NOT_SELECTED, GAME_INVALID_CONFIG, GAME_NOT_ENOUGH_MEMBERS,
    GAME_NOT_ALL_READY, GAME_ROUND_NOT_FOUND, GAME_ROUND_ALREADY_ENDED,
    GAME_STALE_PHASE, GAME_INVALID_ACTION, GAME_ALREADY_SUBMITTED,
    GAME_NOT_ELIGIBLE, GAME_ELAPSED_REJECTED, GAME_DECISION_NOT_REQUIRED,
    VOTE_SELF_NOT_ALLOWED, VOTE_TARGET_NOT_FOUND, VOTE_LIMIT_EXCEEDED,
    VOTE_DUPLICATE_TARGET,
    COMMON_UNAUTHENTICATED, COMMON_SESSION_EXPIRED, COMMON_VALIDATION_FAILED,
    COMMON_IDEMPOTENCY_CONFLICT, COMMON_PAYLOAD_TOO_LARGE, COMMON_RATE_LIMITED,
    COMMON_PROTOCOL_UNSUPPORTED, COMMON_PROTOCOL_VIOLATION, COMMON_INTERNAL,
)
