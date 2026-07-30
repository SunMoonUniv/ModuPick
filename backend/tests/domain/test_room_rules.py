import random
import re

import pytest

from app.config import DEFAULT_CAPACITY, DEFAULT_TITLE, MAX_CAPACITY, MIN_CAPACITY
from app.domain.errors import InvalidCapacityError, InvalidRoomTitleError
from app.domain.room_rules import generate_room_code, is_all_ready, normalize_capacity, normalize_title


def test_normalize_title_uses_default_when_blank():
    assert normalize_title(None) == DEFAULT_TITLE
    assert normalize_title("   ") == DEFAULT_TITLE


def test_normalize_title_trims_whitespace():
    assert normalize_title("  우리 팀  ") == "우리 팀"


def test_normalize_title_rejects_over_20_chars():
    with pytest.raises(InvalidRoomTitleError):
        normalize_title("가" * 21)


def test_normalize_capacity_uses_default_when_none():
    assert normalize_capacity(None) == DEFAULT_CAPACITY


def test_normalize_capacity_accepts_boundaries():
    assert normalize_capacity(MIN_CAPACITY) == MIN_CAPACITY
    assert normalize_capacity(MAX_CAPACITY) == MAX_CAPACITY


@pytest.mark.parametrize("capacity", [MIN_CAPACITY - 1, MAX_CAPACITY + 1, 0, 100])
def test_normalize_capacity_rejects_out_of_range(capacity):
    with pytest.raises(InvalidCapacityError):
        normalize_capacity(capacity)


def test_generate_room_code_matches_format():
    code = generate_room_code(random.Random(0))
    assert re.fullmatch(r"MODU-\d{6}", code)


def test_is_all_ready_false_when_no_active_participants():
    assert is_all_ready({}, []) is False


def test_is_all_ready_true_when_all_flagged():
    assert is_all_ready({1: True, 2: True}, [1, 2]) is True


def test_is_all_ready_false_when_one_missing():
    assert is_all_ready({1: True, 2: False}, [1, 2]) is False


def test_is_all_ready_false_when_flag_absent():
    assert is_all_ready({1: True}, [1, 2]) is False
