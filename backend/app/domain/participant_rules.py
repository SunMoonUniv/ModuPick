"""참가자 프로필 규칙 — 순수 함수.

닉네임 중복은 **거부가 아니라 채번**이다. 같은 방에 같은 닉네임이 있으면 서버가
뒤에 숫자를 붙여 확정하므로(지호 -> 지호2) member.nickname_duplicated 코드를 두지
않는다. 클라이언트는 요청에 실은 값이 아니라 응답의 nickname을 화면에 쓴다.

아바타도 미선택을 허용한다. 30종에 정원 10명이라 고갈되지 않는다.
"""

import secrets

from app.domain import errors
from app.domain.enums import AVATAR_IDS

NICKNAME_MAX = 8
BIO_MAX = 24

#: 접미 후보 상한. 정원이 10명이라 두 자리를 넘는 경우가 발생하지 않는다.
_MAX_SUFFIX = 12


def _fold(nickname: str) -> str:
    """DB의 active_nickname 생성식과 같은 정규화 — LOWER(TRIM(...))."""
    return nickname.strip().lower()


def normalize_nickname(raw: str) -> str:
    """길이·공백 검증. 중복은 여기서 보지 않는다."""
    nickname = raw.strip()
    if not nickname or len(nickname) > NICKNAME_MAX:
        raise errors.DomainError(errors.MEMBER_NICKNAME_INVALID)
    return nickname


def resolve_nickname(desired: str, taken: set[str]) -> str:
    """중복이면 접미 숫자를 붙여 확정한다.

    taken은 그 방의 활성 닉네임을 _fold한 집합이다. 접미를 붙여 상한을 넘으면
    앞을 잘라 길이에 맞춘다.
    """
    if _fold(desired) not in taken:
        return desired

    for n in range(2, _MAX_SUFFIX):
        suffix = str(n)
        head = desired
        if len(head) + len(suffix) > NICKNAME_MAX:
            head = head[: NICKNAME_MAX - len(suffix)]
        candidate = f"{head}{suffix}"
        if _fold(candidate) not in taken:
            return candidate

    # 정원 10명에서는 도달하지 않는다. 도달했다면 명단 계산이 어긋난 것이다.
    raise errors.DomainError(errors.MEMBER_NICKNAME_INVALID)


def normalize_avatar(raw: str | None, taken: set[str]) -> str:
    """아바타를 확정한다.

    생략하면 남은 것 중 하나를 무작위로 배정한다. 순서대로 채우면 방장이 늘 같은
    아바타를 받게 되어 방마다 화면이 똑같아진다.

    **선점 경합의 최종 판정은 DB의 UNIQUE가 한다.** 여기서 taken을 보는 것은
    빠른 실패이며, 동시에 같은 아바타를 확정하면 늦은 쪽이 IntegrityError로 걸린다.
    """
    if raw is None:
        free = [a for a in AVATAR_IDS if a not in taken]
        if not free:
            raise errors.DomainError(errors.MEMBER_AVATAR_TAKEN)
        return secrets.choice(free)

    if raw not in AVATAR_IDS:
        raise errors.DomainError(errors.MEMBER_AVATAR_INVALID)
    if raw in taken:
        raise errors.DomainError(errors.MEMBER_AVATAR_TAKEN)
    return raw


def normalize_bio(raw: str | None) -> str | None:
    """소개 태그. 선택 입력이며 공백만이면 없는 것으로 본다."""
    if raw is None:
        return None
    bio = raw.strip()
    if not bio:
        return None
    if len(bio) > BIO_MAX:
        raise errors.DomainError(errors.MEMBER_BIO_TOO_LONG)
    return bio
