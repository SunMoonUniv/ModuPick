import pytest

from app.domain.enums import ParticipantRole, RoomStatus
from app.domain.errors import (
    GameInProgressError,
    NotHostError,
    ParticipantKickedError,
    ProfileLockedError,
    RoomFullError,
    RoomNotFoundError,
)


def _create_room(room_service, capacity=None):
    return room_service.create_room(title=None, capacity=capacity, host_nickname="지호")


def test_join_returns_token_and_snapshot(room_service, participant_service):
    room = _create_room(room_service)

    joined = participant_service.join(room.room.code, "서연")

    assert joined.token
    assert joined.participant.nickname == "서연"
    assert joined.participant.role == ParticipantRole.GUEST


def test_join_resolves_nickname_collision(room_service, participant_service):
    room = _create_room(room_service)  # 방장 닉네임 "지호"

    joined = participant_service.join(room.room.code, "지호")

    assert joined.participant.nickname == "지호2"


def test_join_auto_assigns_avatar_when_not_specified(room_service, participant_service):
    room = _create_room(room_service)
    joined = participant_service.join(room.room.code, "서연")
    assert joined.participant.avatar


def test_join_raises_when_room_missing(participant_service):
    with pytest.raises(RoomNotFoundError):
        participant_service.join("MODU-000000", "서연")


def test_join_raises_when_room_full(room_service, participant_service):
    room = _create_room(room_service, capacity=2)  # 방장 포함 정원 2명
    participant_service.join(room.room.code, "서연")

    with pytest.raises(RoomFullError):
        participant_service.join(room.room.code, "민준")


def test_join_raises_when_game_in_progress(room_service, participant_service):
    room = _create_room(room_service)
    room_service.mark_in_game(room.room.id, room.host.id)

    with pytest.raises(GameInProgressError):
        participant_service.join(room.room.code, "서연")


def test_kicked_participant_cannot_rejoin_with_token(room_service, participant_service):
    room = _create_room(room_service)
    guest = participant_service.join(room.room.code, "서연")
    participant_service.kick(room.room.id, room.host.id, guest.participant.id)

    with pytest.raises(ParticipantKickedError):
        participant_service.join(room.room.code, "서연2", rejoin_token=guest.token)


def test_kicked_participant_can_join_another_room(room_service, participant_service):
    room_a = _create_room(room_service)
    room_b = _create_room(room_service)
    guest = participant_service.join(room_a.room.code, "서연")
    participant_service.kick(room_a.room.id, room_a.host.id, guest.participant.id)

    rejoined = participant_service.join(room_b.room.code, "서연", rejoin_token=guest.token)
    assert rejoined.participant.nickname == "서연"


def test_update_profile_changes_fields(room_service, participant_service):
    room = _create_room(room_service)

    updated = participant_service.update_profile(room.host.id, nickname="새닉네임", intro_tag="@octo")

    assert updated.nickname == "새닉네임"
    assert updated.intro_tag == "@octo"


def test_update_profile_blocked_during_game(room_service, participant_service):
    room = _create_room(room_service)
    room_service.mark_in_game(room.room.id, room.host.id)

    with pytest.raises(ProfileLockedError):
        participant_service.update_profile(room.host.id, nickname="새닉네임")


def test_toggle_ready_flips_by_default(room_service, participant_service):
    room = _create_room(room_service)

    assert participant_service.toggle_ready(room.host.id) is True
    assert participant_service.toggle_ready(room.host.id) is False


def test_toggle_ready_accepts_explicit_value(room_service, participant_service):
    room = _create_room(room_service)

    assert participant_service.toggle_ready(room.host.id, True) is True
    assert participant_service.toggle_ready(room.host.id, True) is True


def test_kick_requires_host(room_service, participant_service):
    room = _create_room(room_service)
    guest = participant_service.join(room.room.code, "서연")
    another = participant_service.join(room.room.code, "민준")

    with pytest.raises(NotHostError):
        participant_service.kick(room.room.id, guest.participant.id, another.participant.id)


def test_kick_blocked_during_game(room_service, participant_service):
    room = _create_room(room_service)
    guest = participant_service.join(room.room.code, "서연")
    room_service.mark_in_game(room.room.id, room.host.id)

    with pytest.raises(GameInProgressError):
        participant_service.kick(room.room.id, room.host.id, guest.participant.id)


def test_kick_frees_a_slot_for_new_joiners(room_service, participant_service):
    room = _create_room(room_service, capacity=2)
    guest = participant_service.join(room.room.code, "서연")
    participant_service.kick(room.room.id, room.host.id, guest.participant.id)

    joined = participant_service.join(room.room.code, "민준")
    assert joined.participant.nickname == "민준"


def test_leave_transfers_host_to_earliest_joined(room_service, participant_service, clock):
    room = _create_room(room_service)
    clock.advance(1)
    first_guest = participant_service.join(room.room.code, "서연")
    clock.advance(1)
    participant_service.join(room.room.code, "민준")

    outcome = participant_service.leave(room.room.id, room.host.id)

    assert outcome.room_deleted is False
    assert outcome.new_host.id == first_guest.participant.id


def test_leave_during_game_keeps_game_running(room_service, participant_service):
    room = _create_room(room_service)
    participant_service.join(room.room.code, "서연")
    room_service.mark_in_game(room.room.id, room.host.id)

    outcome = participant_service.leave(room.room.id, room.host.id)

    assert outcome.room_deleted is False
    assert room_service.get_room_status(room.room.code) == RoomStatus.IN_GAME


def test_leave_last_participant_deletes_room(room_service, participant_service):
    room = _create_room(room_service)

    outcome = participant_service.leave(room.room.id, room.host.id)

    assert outcome.room_deleted is True
    with pytest.raises(RoomNotFoundError):
        room_service.get_room_status(room.room.code)
