import pytest

from app.domain.enums import RoomStatus
from app.domain.errors import GameInProgressError, InvalidRoomTransitionError, ProfileLockedError
from app.domain.state_machine import (
    assert_can_edit_profile,
    assert_can_join,
    assert_can_kick,
    assert_transition_allowed,
)


@pytest.mark.parametrize(
    "current, target",
    [
        (RoomStatus.WAITING, RoomStatus.IN_GAME),
        (RoomStatus.IN_GAME, RoomStatus.RESULT),
        (RoomStatus.RESULT, RoomStatus.WAITING),
        (RoomStatus.RESULT, RoomStatus.IN_GAME),
    ],
)
def test_allowed_transitions_pass(current, target):
    assert_transition_allowed(current, target)  # 예외가 없으면 통과


@pytest.mark.parametrize(
    "current, target",
    [
        (RoomStatus.WAITING, RoomStatus.RESULT),
        (RoomStatus.IN_GAME, RoomStatus.WAITING),
        (RoomStatus.WAITING, RoomStatus.WAITING),
    ],
)
def test_disallowed_transitions_raise(current, target):
    with pytest.raises(InvalidRoomTransitionError):
        assert_transition_allowed(current, target)


def test_assert_can_join_allows_waiting_only():
    assert_can_join(RoomStatus.WAITING)
    with pytest.raises(GameInProgressError):
        assert_can_join(RoomStatus.IN_GAME)
    with pytest.raises(GameInProgressError):
        assert_can_join(RoomStatus.RESULT)


def test_assert_can_kick_allows_waiting_only():
    assert_can_kick(RoomStatus.WAITING)
    with pytest.raises(GameInProgressError):
        assert_can_kick(RoomStatus.IN_GAME)


def test_assert_can_edit_profile_allows_waiting_only():
    assert_can_edit_profile(RoomStatus.WAITING)
    with pytest.raises(ProfileLockedError):
        assert_can_edit_profile(RoomStatus.IN_GAME)
