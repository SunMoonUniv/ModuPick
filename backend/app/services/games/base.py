"""진행 모듈의 공통 계약.

`game_service`가 6종이 같은 것을 맡고(입력 수집 · 판정 실행 · 결과 저장 · 마감
타이머), 같은 패키지의 게임별 모듈이 **어떤 단계를 어떤 순서로 밟는가**를 맡는다.
그 둘 사이의 약속이 여기 있다.

**이 모듈은 game_service를 import하지 않는다.** 진행 모듈이 game_service를 부르고
game_service가 레지스트리를 늦게 부르는 방향이라, 계약만 담은 이 자리가 어느 쪽도
참조하지 않아야 import 고리가 생기지 않는다.
"""

from dataclasses import dataclass

#: 진행 모듈이 갖춰야 하는 것 — 아래 다섯이 전부다. 파이썬 모듈은 클래스가 아니라
#: Protocol로 정적 검사되지 않지만, 무엇을 갖춰야 하는지 한 곳에 적어 둔다.
#:
#:     GAME_ID: str
#:     ACTIONS: dict[str, ActionSpec]
#:     async begin(room_pk, *, skip_guide=False) -> None
#:     async on_action(state, *, participant_pk, member_id, action_type, payload) -> None
#:     wire_result(state) -> tuple[str, dict]      # (variant, result)


@dataclass(frozen=True, slots=True)
class ActionSpec:
    """game:action type 하나를 받는 조건.

    **단계를 권한보다 먼저 본다.** 늦게 도착한 프레임은 보낸 사람이 누구든 지난
    단계의 입력이고, 그때 member.not_host를 돌려주면 방장이 "권한이 없다"로 읽는다.
    검사 순서는 game_service.handle_action이 지키며 여기서는 조건만 적는다.

    phases에 없는 단계로 온 입력은 game.invalid_action이다. 룰렛의 SPINNING 이후
    PICK처럼 **정상 흐름에서 늦게 도착할 수 있는 것도 여기서 걸린다** — 최초 1회만
    유효하다는 멱등이 이 조건으로 성립한다.
    """

    phases: frozenset[str]
    host_only: bool = False
