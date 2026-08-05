"""토큰과 외부 식별자 생성.

memberToken은 **구조를 갖지 않는 base64url 문자열**이다. JWT를 쓰지 않는다 —
클라이언트가 파싱해 의미를 읽는 경로를 두지 않고, 권한은 토큰 안의 값이 아니라
방 상태와 소켓 바인딩을 대조해 판정한다. 토큰은 서버 메모리의 바인딩을 가리키는
핸들이며 성질은 세션에 가깝다.

외부 식별자(mbr_ · rnd_ · opt_)는 토큰과 다른 물건이다. 비밀이 아니라 API가
대상을 가리키는 값이지만, 내부 PK를 노출하면 방을 가로질러 연속 증가하는 값에서
다른 방의 참가자 수·생성 순서를 추정할 수 있으므로 추측 불가한 난수를 쓴다.
"""

import secrets
import string

#: 외부 식별자 본문 문자 집합. CHECK가 [0-9A-Za-z]{16,36}을 강제하므로
#: base64url(-, _ 포함)을 쓸 수 없다.
_ID_ALPHABET = string.ascii_letters + string.digits

#: 본문 길이. 62^22 ≈ 10^39로 충돌이 실질적으로 일어나지 않는다.
_ID_LENGTH = 22


def new_token() -> str:
    """memberToken. base64url 43자."""
    return secrets.token_urlsafe(32)


def _new_external_id(prefix: str) -> str:
    body = "".join(secrets.choice(_ID_ALPHABET) for _ in range(_ID_LENGTH))
    return f"{prefix}_{body}"


def new_member_id() -> str:
    return _new_external_id("mbr")


def new_round_id() -> str:
    return _new_external_id("rnd")


def new_option_id() -> str:
    return _new_external_id("opt")


def new_room_code() -> str:
    """초대 코드 숫자 6자리.

    순번·시각 기반 생성을 하지 않는다 — 예측 가능한 코드는 다음 방을 추측하게 한다.
    선행 0이 유효하므로 문자열로 다룬다.
    """
    return f"{secrets.randbelow(1_000_000):06d}"
