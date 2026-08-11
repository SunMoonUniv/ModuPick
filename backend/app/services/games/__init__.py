"""게임별 진행 — gameId로 고르는 진행 모듈.

`game_service`가 6종이 같은 것을 맡고(입력 수집 · 판정 실행 · 결과 저장 · 마감
타이머), 여기 있는 모듈들이 **어떤 단계를 어떤 순서로 밟는가**를 맡는다.

판정 모듈(app/domain/games/)과 파일 이름이 1:1로 대응한다. 같은 게임의 판정과 진행이
같은 이름으로 두 곳에 있고, **판정은 순수 함수이며 진행은 소켓·DB·타이머를 안다.**
담당도 다르다 — 판정은 게임 담당이, 진행은 뼈대 담당이 만든다.

진행 모듈이 갖춰야 하는 것은 base.py가 적는다.
"""

from types import ModuleType

from app.services.games import kingmaker, ladder, roulette, snipe, timer

#: gameId -> 진행 모듈. **여기 없는 게임은 아직 붙지 않았다** — READY에 머물며
#: 방장의 round:close를 기다린다.
FLOWS: dict[str, ModuleType] = {
    roulette.GAME_ID: roulette,
    ladder.GAME_ID: ladder,
    snipe.GAME_ID: snipe,
    kingmaker.GAME_ID: kingmaker,
    timer.GAME_ID: timer,
}


def flow_of(game_id: str) -> ModuleType | None:
    """그 게임의 진행 모듈. 아직 붙지 않은 게임이면 None이다."""
    return FLOWS.get(game_id)
