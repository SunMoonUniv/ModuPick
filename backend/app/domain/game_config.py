"""게임 설정 규격 — 순수 데이터와 검증.

정본은 docs/07_api/03_socket_events.md의 configSchema 표이며 항목은 **16개**다.
여기서 규격을 새로 만들지 않는다.

**판정 로직이 아니라 규격이다.** 게임별 판정 함수는 domain/games/에 따로 있고
(담당이 다르다) 이 모듈은 그것을 알지 못한다. 뼈대가 게임 선택·설정 동기화를
하려면 기본값과 허용 범위를 알아야 해서 여기에 둔다.

설정은 **부분 갱신**이다. 보낸 필드만 덮어쓰고 나머지는 유지한다 — 전체 교체로 하면
두 필드를 연달아 조작할 때 앞의 값이 되돌아간다.
"""

from dataclasses import dataclass
from typing import Any

from app.domain import errors
from app.domain.enums import GameId

#: 규격이 바뀌면 올린다. game:selected가 이 값을 실어 클라이언트가 캐시한 스키마와 대조한다.
CONFIG_SCHEMA_VERSION = 1

#: 사다리 기본 항목. 05_game_rules/01_common.md의 조별과제 세트다.
#: 프로토타입의 마지막 항목(총무)은 설계와 다르며 정본은 최종 정리다.
LADDER_DEFAULT_ITEMS = ("팀장", "자료 조사", "PPT 제작", "발표", "디자인", "최종 정리")


@dataclass(frozen=True, slots=True)
class FieldSpec:
    """설정 항목 하나.

    kind가 검증 방식을 정한다 — string · string_list · int · enum · boolean.
    """

    name: str
    kind: str
    default: Any
    choices: tuple[Any, ...] | None = None
    max_len: int | None = None
    minimum: int | None = None
    maximum: int | None = None


def _s(name: str, default: str, max_len: int) -> FieldSpec:
    return FieldSpec(name=name, kind="string", default=default, max_len=max_len)


def _enum(name: str, default: Any, choices: tuple[Any, ...]) -> FieldSpec:
    return FieldSpec(name=name, kind="enum", default=default, choices=choices)


def _bool(name: str, default: bool) -> FieldSpec:
    return FieldSpec(name=name, kind="boolean", default=default)


#: gameId -> 항목 목록. 합계 16개다.
SCHEMA: dict[GameId, tuple[FieldSpec, ...]] = {
    GameId.ROULETTE: (_s("topic", "팀장", 12),),
    GameId.LADDER: (
        FieldSpec(
            name="resultItems",
            kind="string_list",
            default=list(LADDER_DEFAULT_ITEMS),
            max_len=12,
        ),
        _enum("speed", "NORMAL", ("FAST", "NORMAL", "SLOW")),
    ),
    GameId.KINGMAKER: (
        _s("topic", "팀명", 12),
        _enum("votesPerMember", 1, (1, 2, 3)),
        _bool("revealAuthors", False),
    ),
    GameId.TIMER: (
        _s("topic", "팀장", 12),
        _enum("targetSeconds", 5, (5, 7, 10)),
        _enum("criterion", "CLOSEST", ("CLOSEST", "FARTHEST")),
    ),
    GameId.SNIPE: (
        _s("question", "발표를 제일 잘할 것 같은 사람은?", 30),
        FieldSpec(name="voteSeconds", kind="int", default=10, minimum=5, maximum=60),
        _bool("multiVote", False),
        # revealVoters(지목자 공개)는 두지 않는다. 원 기획에 없던 항목이며
        # (docs_legacy/requirements.md §7.3이 "이 문서에서 새로 정한 항목"으로 열거),
        # 익명이 핵심인 게임에 공개 선택지를 붙이는 것이 기획 의도와 어긋난다.
        # **지목자는 항상 비공개다.** 킹메이커의 revealAuthors는 그대로 둔다 —
        # 안건 제출자 공개와 사람 지목 공개는 성격이 다르고 그쪽은 원 기획에 있었다.
    ),
    GameId.NUNCHI: (
        _s("topic", "팀장", 12),
        _enum("windowMs", 300, (300, 500)),
        _enum("roundSeconds", 15, (10, 15, 20)),
    ),
}


def defaults(game_id: GameId) -> dict[str, Any]:
    """그 게임의 기본 설정.

    **게임을 바꾸면 여기로 되돌아간다.** 이전 게임의 값이 남아 엉뚱하게 적용되는
    사고를 막는다.
    """
    return {f.name: (list(f.default) if isinstance(f.default, list) else f.default)
            for f in SCHEMA[game_id]}


def _invalid() -> errors.DomainError:
    return errors.DomainError(errors.GAME_INVALID_CONFIG)


def _check(spec: FieldSpec, value: Any) -> Any:
    """항목 하나를 검증해 저장할 값으로 돌려준다.

    **bool을 int보다 먼저 본다.** 파이썬에서 True는 1이므로 순서를 뒤집으면
    votesPerMember에 true를 넣는 것이 1로 통과한다.
    """
    if spec.kind == "boolean":
        if not isinstance(value, bool):
            raise _invalid()
        return value

    if spec.kind == "string":
        if not isinstance(value, str):
            raise _invalid()
        text = value.strip()
        if not text or len(text) > (spec.max_len or 0):
            raise _invalid()
        return text

    if spec.kind == "string_list":
        # 개수는 막지 않는다 — 참가자 수에 맞추는 일은 게임 시작 시점에 서버가 한다.
        if not isinstance(value, list) or not value:
            raise _invalid()
        items = []
        for raw in value:
            if not isinstance(raw, str):
                raise _invalid()
            text = raw.strip()
            if not text or len(text) > (spec.max_len or 0):
                raise _invalid()
            items.append(text)  # 중복은 허용한다
        return items

    if spec.kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise _invalid()
        if value < (spec.minimum or 0) or value > (spec.maximum or 0):
            raise _invalid()
        return value

    if spec.kind == "enum":
        if isinstance(value, bool) or value not in (spec.choices or ()):
            raise _invalid()
        return value

    raise _invalid()


def merge(game_id: GameId, current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """부분 갱신. 보낸 필드만 덮어쓴다.

    모르는 필드가 오면 거절한다 — 조용히 버리면 클라이언트가 반영된 줄 안다.
    """
    known = {f.name: f for f in SCHEMA[game_id]}
    merged = dict(current)
    for name, value in patch.items():
        spec = known.get(name)
        if spec is None:
            raise _invalid()
        merged[name] = _check(spec, value)
    return merged


def validate(game_id: GameId, config: dict[str, Any]) -> dict[str, Any]:
    """전체 검증. 빠진 항목은 기본값으로 채운다. 게임 시작 직전 재검증이 쓴다."""
    return merge(game_id, defaults(game_id), config)


def describe(game_id: GameId) -> list[dict[str, Any]]:
    """GET /api/games가 내려보낼 규격 표현."""
    out = []
    for f in SCHEMA[game_id]:
        item: dict[str, Any] = {"name": f.name, "type": f.kind, "default": f.default}
        if f.choices is not None:
            item["choices"] = list(f.choices)
        if f.max_len is not None:
            item["maxLength"] = f.max_len
        if f.minimum is not None:
            item["min"] = f.minimum
        if f.maximum is not None:
            item["max"] = f.maximum
        out.append(item)
    return out
