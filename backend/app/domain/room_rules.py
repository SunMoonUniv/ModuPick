"""방 자체에 대한 순수 규칙. DB/난수 소스는 인자로 받아 부작용 없이 계산만 한다."""

from random import Random

from app.config import (
    DEFAULT_CAPACITY,
    DEFAULT_TITLE,
    MAX_CAPACITY,
    MIN_CAPACITY,
    ROOM_CODE_DIGITS,
    ROOM_CODE_PREFIX,
    TITLE_MAX_LENGTH,
)
from app.domain.errors import InvalidCapacityError, InvalidRoomTitleError


def normalize_title(title: str | None) -> str:
    """빈 값이면 기본 제목, 20자 초과면 거절한다. (F-101, US-101-2)"""
    stripped = (title or "").strip()
    if not stripped:
        return DEFAULT_TITLE
    if len(stripped) > TITLE_MAX_LENGTH:
        raise InvalidRoomTitleError(f"방 제목은 {TITLE_MAX_LENGTH}자를 넘을 수 없습니다.")
    return stripped


def normalize_capacity(capacity: int | None) -> int:
    """지정하지 않으면 기본 10명, 2~10명 범위를 벗어나면 거절한다. (F-101, US-101-3)"""
    if capacity is None:
        return DEFAULT_CAPACITY
    if not (MIN_CAPACITY <= capacity <= MAX_CAPACITY):
        raise InvalidCapacityError(f"정원은 {MIN_CAPACITY}~{MAX_CAPACITY}명이어야 합니다.")
    return capacity


def generate_room_code(rng: Random) -> str:
    """`MODU-######` 형태의 후보를 하나 생성한다. 충돌 여부 판단은 호출자(레포지토리) 몫이다. (F-102)"""
    upper_bound = 10**ROOM_CODE_DIGITS - 1
    digits = rng.randint(0, upper_bound)
    return f"{ROOM_CODE_PREFIX}{digits:0{ROOM_CODE_DIGITS}d}"


def is_all_ready(ready_flags: dict[int, bool], active_ids: list[int]) -> bool:
    """활성 참가자가 1명 이상이고 전원이 준비 완료 상태인지 확인한다. (G-3, F-207)"""
    if not active_ids:
        return False
    return all(ready_flags.get(pid, False) for pid in active_ids)
