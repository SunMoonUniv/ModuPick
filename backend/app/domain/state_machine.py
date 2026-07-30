"""방 상태 머신. 대기 -> 진행 -> 결과 -> 대기(또는 결과 -> 다시 진행)만 허용한다. (F-604)"""

from app.domain.enums import RoomStatus
from app.domain.errors import GameInProgressError, InvalidRoomTransitionError, ProfileLockedError

# RESULT -> WAITING은 "대기방으로"(F-506), RESULT -> IN_GAME은 "다시 하기"(F-505)에 대응한다.
_ALLOWED_TRANSITIONS: dict[RoomStatus, set[RoomStatus]] = {
    RoomStatus.WAITING: {RoomStatus.IN_GAME},
    RoomStatus.IN_GAME: {RoomStatus.RESULT},
    RoomStatus.RESULT: {RoomStatus.WAITING, RoomStatus.IN_GAME},
}


def assert_transition_allowed(current: RoomStatus, target: RoomStatus) -> None:
    if target not in _ALLOWED_TRANSITIONS.get(current, set()):
        raise InvalidRoomTransitionError(f"{current.value} -> {target.value} 전이는 허용되지 않습니다.")


def assert_can_join(status: RoomStatus) -> None:
    """새 참가자는 대기방 상태에서만 들어올 수 있다. (D-08, US-102-4)"""
    if status != RoomStatus.WAITING:
        raise GameInProgressError("게임이 진행 중이에요.")


def assert_can_kick(status: RoomStatus) -> None:
    """강퇴는 대기방 상태에서만 가능하다. (G-5, US-204-3)"""
    if status != RoomStatus.WAITING:
        raise GameInProgressError("게임이 진행 중에는 내보낼 수 없습니다.")


def assert_can_edit_profile(status: RoomStatus) -> None:
    """프로필 수정은 게임 시작 전(대기방)에서만 가능하다. (F-111)"""
    if status != RoomStatus.WAITING:
        raise ProfileLockedError("게임이 시작된 뒤에는 프로필을 바꿀 수 없습니다.")
