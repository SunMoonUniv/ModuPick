from datetime import datetime

import pytest

from app.config import AVATAR_POOL
from app.domain.entities import ParticipantSnapshot
from app.domain.enums import ParticipantRole, ParticipantStatus
from app.domain.errors import InvalidIntroTagError, InvalidNicknameError
from app.domain.participant_rules import (
    assign_avatar,
    pick_successor_host,
    resolve_nickname_collision,
    validate_intro_tag,
    validate_nickname_input,
)


def _snapshot(id_: int, joined_at: datetime) -> ParticipantSnapshot:
    return ParticipantSnapshot(
        id=id_,
        room_id=1,
        nickname=f"참가자{id_}",
        avatar=AVATAR_POOL[id_],
        intro_tag=None,
        role=ParticipantRole.GUEST,
        status=ParticipantStatus.ACTIVE,
        joined_at=joined_at,
    )


def test_validate_nickname_input_trims_whitespace():
    assert validate_nickname_input("  지호  ") == "지호"


@pytest.mark.parametrize("nickname", ["", "   ", "a" * 9])
def test_validate_nickname_input_rejects_invalid_length(nickname):
    with pytest.raises(InvalidNicknameError):
        validate_nickname_input(nickname)


def test_resolve_nickname_collision_returns_as_is_when_free():
    assert resolve_nickname_collision("지호", set()) == "지호"


def test_resolve_nickname_collision_appends_suffix():
    assert resolve_nickname_collision("지호", {"지호"}) == "지호2"


def test_resolve_nickname_collision_increments_until_free():
    assert resolve_nickname_collision("지호", {"지호", "지호2", "지호3"}) == "지호4"


def test_resolve_nickname_collision_truncates_when_suffix_would_overflow():
    base = "a" * 8
    result = resolve_nickname_collision(base, {base})
    assert result == "a" * 7 + "2"
    assert len(result) == 8


def test_validate_intro_tag_blank_becomes_none():
    assert validate_intro_tag(None) is None
    assert validate_intro_tag("   ") is None


def test_validate_intro_tag_trims_whitespace():
    assert validate_intro_tag("  @octo  ") == "@octo"


def test_validate_intro_tag_rejects_over_20_chars():
    with pytest.raises(InvalidIntroTagError):
        validate_intro_tag("a" * 21)


def test_assign_avatar_uses_desired_when_free():
    assert assign_avatar(AVATAR_POOL[0], set()) == AVATAR_POOL[0]


def test_assign_avatar_falls_back_when_desired_taken():
    result = assign_avatar(AVATAR_POOL[0], {AVATAR_POOL[0]})
    assert result != AVATAR_POOL[0]
    assert result in AVATAR_POOL


def test_assign_avatar_auto_picks_when_no_preference():
    result = assign_avatar(None, {AVATAR_POOL[0]})
    assert result == AVATAR_POOL[1]


def test_pick_successor_host_returns_earliest_joined():
    later = _snapshot(1, datetime(2026, 7, 30, 12, 5))
    earlier = _snapshot(2, datetime(2026, 7, 30, 12, 0))
    assert pick_successor_host([later, earlier]) == earlier


def test_pick_successor_host_returns_none_when_empty():
    assert pick_successor_host([]) is None
