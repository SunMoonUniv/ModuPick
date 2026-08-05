"""채팅 텍스트 규칙 — 순수 함수.

**빈 입력과 너무 긴 입력의 처리가 다르다.**

    공백만·빈 문자열  ->  조용히 무시한다. 에러를 돌려주지 않는다
    200자 초과        ->  common.payload_too_large

앞은 사용자가 실수로 엔터를 친 것이고 뒤는 규약을 넘어선 것이다. 빈 입력에 에러를
띄우면 화면에 아무 의미 없는 경고가 뜬다.
"""

from app.domain import errors

TEXT_MAX = 200


def normalize_text(raw: str) -> str | None:
    """중계할 텍스트. 무시해야 하면 None이다.

    길이는 **다듬은 뒤**에 잰다. 앞뒤 공백으로 상한을 넘긴 것을 거절하면 사용자는
    보이지 않는 문자 때문에 거절당한다.
    """
    text = raw.strip()
    if not text:
        return None
    if len(text) > TEXT_MAX:
        raise errors.DomainError(errors.COMMON_PAYLOAD_TOO_LARGE)
    return text
