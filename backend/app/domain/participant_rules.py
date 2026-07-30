"""참가자 프로필에 대한 순수 규칙. DB/난수 소스는 인자로 받아 부작용 없이 계산만 한다."""

from app.config import AVATAR_POOL, INTRO_TAG_MAX_LENGTH, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH
from app.domain.entities import ParticipantSnapshot
from app.domain.errors import InvalidIntroTagError, InvalidNicknameError


def validate_nickname_input(nickname: str) -> str:
    """공백만 입력하거나 1~8자를 벗어나면 거절한다. (F-108, US-104-1)"""
    stripped = (nickname or "").strip()
    if not (NICKNAME_MIN_LENGTH <= len(stripped) <= NICKNAME_MAX_LENGTH):
        raise InvalidNicknameError(f"닉네임은 {NICKNAME_MIN_LENGTH}~{NICKNAME_MAX_LENGTH}자여야 합니다.")
    return stripped


def resolve_nickname_collision(desired: str, existing: set[str]) -> str:
    """같은 방에 같은 닉네임이 있으면 숫자 접미사를 붙인다 (지호 -> 지호2). (F-109, US-104-2)"""
    if desired not in existing:
        return desired

    suffix = 2
    while True:
        candidate = _apply_suffix(desired, suffix)
        if candidate not in existing:
            return candidate
        suffix += 1


def _apply_suffix(base: str, suffix: int) -> str:
    suffix_text = str(suffix)
    max_base_length = max(NICKNAME_MAX_LENGTH - len(suffix_text), 1)
    return f"{base[:max_base_length]}{suffix_text}"


def validate_intro_tag(intro_tag: str | None) -> str | None:
    """선택 입력이다. 비어 있으면 None, 20자 초과면 거절한다. (F-108, US-104-4)"""
    if intro_tag is None:
        return None
    stripped = intro_tag.strip()
    if not stripped:
        return None
    if len(stripped) > INTRO_TAG_MAX_LENGTH:
        raise InvalidIntroTagError(f"소개 태그는 {INTRO_TAG_MAX_LENGTH}자를 넘을 수 없습니다.")
    return stripped


def assign_avatar(desired: str | None, taken: set[str]) -> str:
    """원하는 아바타가 없거나 이미 쓰이고 있으면 남은 아바타 중 하나를 배정한다. (F-110, US-104-3)"""
    if desired and desired not in taken:
        return desired
    for avatar in AVATAR_POOL:
        if avatar not in taken:
            return avatar
    # 정원(최대 10명)이 아바타 풀(30개)보다 항상 작으므로 실제로는 도달하지 않는다.
    raise ValueError("배정 가능한 아바타가 남아 있지 않습니다.")


def pick_successor_host(remaining_active: list[ParticipantSnapshot]) -> ParticipantSnapshot | None:
    """가장 먼저 입장한 활성 참가자를 다음 방장으로 고른다. 남은 사람이 없으면 None. (F-209, D-12)"""
    if not remaining_active:
        return None
    return min(remaining_active, key=lambda participant: participant.joined_at)
