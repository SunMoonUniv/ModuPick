import re

import pytest

from app.config import DEFAULT_CAPACITY, DEFAULT_TITLE
from app.domain.enums import RoomStatus
from app.domain.errors import (
    InvalidCapacityError,
    InvalidRoomTitleError,
    InvalidRoomTransitionError,
    RoomNotFoundError,
)


def test_create_room_applies_defaults(room_service):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")

    assert result.room.title == DEFAULT_TITLE
    assert result.room.capacity == DEFAULT_CAPACITY
    assert result.room.status == RoomStatus.WAITING
    assert re.fullmatch(r"MODU-\d{6}", result.room.code)
    assert result.host.nickname == "지호"
    assert result.host_token  # 원문 토큰이 반환된다


def test_create_room_rejects_invalid_title(room_service):
    with pytest.raises(InvalidRoomTitleError):
        room_service.create_room(title="가" * 21, capacity=None, host_nickname="지호")


def test_create_room_rejects_invalid_capacity(room_service):
    with pytest.raises(InvalidCapacityError):
        room_service.create_room(title=None, capacity=1, host_nickname="지호")


def test_get_room_status_returns_current_status(room_service):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    assert room_service.get_room_status(result.room.code) == RoomStatus.WAITING


def test_get_room_status_raises_when_missing(room_service):
    with pytest.raises(RoomNotFoundError):
        room_service.get_room_status("MODU-000000")


def test_check_start_eligibility_blocks_when_not_enough_people(room_service):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")

    eligibility = room_service.check_start_eligibility(result.room.id)

    assert eligibility.can_start is False
    assert eligibility.total_count == 1


def test_check_start_eligibility_blocks_when_not_all_ready(room_service, participant_service):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    participant_service.join(result.room.code, "서연")
    participant_service.toggle_ready(result.host.id, True)

    eligibility = room_service.check_start_eligibility(result.room.id)

    assert eligibility.can_start is False
    assert "1명" in eligibility.reason


def test_check_start_eligibility_true_when_all_ready(room_service, participant_service):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    guest = participant_service.join(result.room.code, "서연")
    participant_service.toggle_ready(result.host.id, True)
    participant_service.toggle_ready(guest.participant.id, True)

    eligibility = room_service.check_start_eligibility(result.room.id)

    assert eligibility.can_start is True
    assert eligibility.reason is None
    assert eligibility.ready_count == 2


def test_full_state_cycle_including_replay(room_service):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    room_id = result.room.id

    assert room_service.mark_in_game(room_id, result.host.id).status == RoomStatus.IN_GAME
    assert room_service.mark_result(room_id).status == RoomStatus.RESULT
    assert room_service.return_to_waiting(room_id, result.host.id).status == RoomStatus.WAITING
    # 다시 하기: 결과 화면에서 대기방을 거치지 않고 바로 다음 판으로
    assert room_service.mark_in_game(room_id, result.host.id).status == RoomStatus.IN_GAME
    assert room_service.mark_result(room_id).status == RoomStatus.RESULT
    assert room_service.mark_in_game(room_id, result.host.id).status == RoomStatus.IN_GAME


def test_invalid_transition_raises(room_service):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    with pytest.raises(InvalidRoomTransitionError):
        room_service.mark_result(result.room.id)  # WAITING -> RESULT는 건너뛰기 전이


def test_sweep_expired_rooms_deletes_after_inactivity(room_service, clock):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    clock.advance(11 * 60)

    expired = room_service.sweep_expired_rooms(clock.now())

    assert expired == [result.room.id]
    with pytest.raises(RoomNotFoundError):
        room_service.get_room_status(result.room.code)


def test_sweep_expired_rooms_keeps_recently_active(room_service, clock):
    result = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    clock.advance(9 * 60)

    expired = room_service.sweep_expired_rooms(clock.now())

    assert expired == []
    assert room_service.get_room_status(result.room.code) == RoomStatus.WAITING
