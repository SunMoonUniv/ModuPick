"""방 규칙 — 순수 함수.

DB·소켓·현재 시각을 직접 만지지 않는다. 필요한 값은 인자로 받는다.
"""

from datetime import datetime, timedelta

from app.domain import errors
from app.domain.enums import MAX_ROOM_CAPACITY, MIN_ROOM_CAPACITY

#: 방 제목을 비우면 넣는 값.
DEFAULT_ROOM_NAME = "ModuPick 방"

#: 정원 기본값.
DEFAULT_CAPACITY = MAX_ROOM_CAPACITY

#: 마지막 사용자 행동 이후 이만큼 지나면 방이 만료된다.
IDLE_TTL = timedelta(minutes=10)

#: 슬롯 선점 후 프로필을 확정하지 않으면 회수하는 시한.
PENDING_TTL = timedelta(minutes=3)

#: 초대 코드 재추첨 한도. 동시 방 100개 기준 점유율이 0.01%라 사실상 소진되지 않는다.
MAX_CODE_ATTEMPTS = 10

_ROOM_NAME_MAX = 30


def normalize_room_name(raw: str | None) -> str:
    """방 제목을 확정한다.

    비우거나 공백만 보내면 기본값을 넣는다 — 제목이 없다고 방 생성을 막지 않는다.
    길이 초과만 거절한다.
    """
    if raw is None:
        return DEFAULT_ROOM_NAME
    name = raw.strip()
    if not name:
        return DEFAULT_ROOM_NAME
    if len(name) > _ROOM_NAME_MAX:
        raise errors.DomainError(
            errors.COMMON_VALIDATION_FAILED,
            message=f"방 제목은 {_ROOM_NAME_MAX}자까지 적을 수 있어요",
        )
    return name


def normalize_capacity(raw: int | None) -> int:
    """정원을 확정한다. 생성 시에만 정하며 이후 바꿀 수 없다."""
    if raw is None:
        return DEFAULT_CAPACITY
    if not MIN_ROOM_CAPACITY <= raw <= MAX_ROOM_CAPACITY:
        raise errors.DomainError(
            errors.COMMON_VALIDATION_FAILED,
            message=f"정원은 {MIN_ROOM_CAPACITY}~{MAX_ROOM_CAPACITY}명 사이로 정해 주세요",
        )
    return raw


def expires_at(last_activity_at: datetime) -> datetime:
    return last_activity_at + IDLE_TTL


def pending_expires_at(joined_at: datetime) -> datetime:
    return joined_at + PENDING_TTL


def is_expired(expires: datetime, now: datetime) -> bool:
    """만료 여부.

    스윕이 아직 오지 않은 방을 조회로 만날 수 있으므로 요청 경로에서도 본다.
    """
    return expires <= now


def has_room_for_one_more(current_members: int, max_members: int) -> bool:
    """정원 여유.

    current_members는 **PENDING + ACTIVE 합산**이다. 프로필을 아직 채우지 않은
    사람도 슬롯을 차지해야 정원 초과를 정확히 막는다.
    """
    return current_members < max_members
