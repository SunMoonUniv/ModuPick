"""도메인 예외 계층. `code`는 API/소켓 담당자가 클라이언트 메시지로 매핑할 때 쓰는 안정적인 문자열이다."""


class DomainError(Exception):
    code: str = "DOMAIN_ERROR"


class RoomNotFoundError(DomainError):
    code = "ROOM_NOT_FOUND"


class RoomFullError(DomainError):
    code = "ROOM_FULL"


class GameInProgressError(DomainError):
    code = "GAME_IN_PROGRESS"


class ParticipantKickedError(DomainError):
    code = "PARTICIPANT_KICKED"


class InvalidRoomTitleError(DomainError):
    code = "INVALID_ROOM_TITLE"


class InvalidCapacityError(DomainError):
    code = "INVALID_CAPACITY"


class InvalidNicknameError(DomainError):
    code = "INVALID_NICKNAME"


class InvalidIntroTagError(DomainError):
    code = "INVALID_INTRO_TAG"


class NotHostError(DomainError):
    code = "NOT_HOST"


class ProfileLockedError(DomainError):
    code = "PROFILE_LOCKED"


class InvalidRoomTransitionError(DomainError):
    code = "INVALID_TRANSITION"


class RoomCodeExhaustedError(DomainError):
    code = "ROOM_CODE_EXHAUSTED"


class ParticipantNotFoundError(DomainError):
    code = "PARTICIPANT_NOT_FOUND"
