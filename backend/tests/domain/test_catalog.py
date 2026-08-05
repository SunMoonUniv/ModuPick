"""게임 메타 6종과 GET /api/games 2종.

핸들러를 직접 부른다. TestClient를 쓰면 lifespan이 돌아 MySQL이 필요한데, 이 두
엔드포인트는 DB를 보지 않으므로 그 비용을 치를 이유가 없다. 경로·상태코드까지 확인하는
계약 테스트는 tests/contract/의 몫이다.
"""

import asyncio
import json

import pytest

from app.api.games import get_game, list_games
from app.domain import errors, game_config
from app.domain.enums import MIN_MEMBERS, GameId
from app.domain.games import catalog
from app.domain.games.catalog import CATALOG, MAX_MEMBERS, ResultVariant


def body(response) -> dict:
    """공통 봉투에서 data를 꺼낸다."""
    envelope = json.loads(response.body)
    assert envelope["success"] is True and envelope["code"] == "ok"
    return envelope["data"]


# ── 카탈로그 ──────────────────────────────────────────────────────────────


def test_게임_6종이_전부_등재되어_있다():
    assert set(CATALOG) == set(GameId)
    assert len(CATALOG) == 6


def test_최소_인원은_enums를_그대로_쓴다():
    """같은 값을 두 곳에 두지 않는다."""
    assert {g: catalog.min_members(g) for g in GameId} == MIN_MEMBERS


def test_최대_인원은_6종_모두_10이다():
    assert MAX_MEMBERS == 10


def test_결과_화면_형태의_분포가_스펙_시트와_같다():
    counts: dict[ResultVariant, int] = {}
    for m in CATALOG.values():
        counts[m.result_variant] = counts.get(m.result_variant, 0) + 1
    assert counts == {
        ResultVariant.WINNER: 3,  # 룰렛 · 시간초 · 저격
        ResultVariant.ASSIGN: 1,  # 사다리
        ResultVariant.TALLY: 1,   # 킹메이커
        ResultVariant.RECORD: 1,  # 눈치
    }


def test_이름과_설명이_비어_있지_않고_중복되지_않는다():
    names = [m.name for m in CATALOG.values()]
    assert len(set(names)) == 6
    assert all(m.name and m.description for m in CATALOG.values())


@pytest.mark.parametrize("game_id", list(GameId))
def test_가이드_단계는_2에서_4개다(game_id):
    """docs/08_screen/05_game_screens.md — 단계 수는 게임마다 2~4단계다."""
    meta = catalog.meta(game_id)
    assert 2 <= len(meta.steps) <= 4
    assert meta.rules


# ── GET /api/games ────────────────────────────────────────────────────────


def test_목록은_6종을_totalCount와_함께_돌려준다():
    data = body(asyncio.run(list_games()))
    assert data["totalCount"] == 6 and len(data["content"]) == 6
    assert [item["gameId"] for item in data["content"]] == [g.value for g in GameId]


def test_목록_항목의_키가_계약과_같다():
    item = body(asyncio.run(list_games()))["content"][0]
    assert item.keys() == {
        "gameId",
        "name",
        "description",
        "minMembers",
        "maxMembers",
        "resultVariant",
        "configSchema",
    }


def test_분류를_응답에_싣지_않는다():
    """서버 난수 2 · 참가자 투표 2 · 참가자 실력 2는 화면에 표시하지 않는 문서상 구분이다."""
    blob = json.dumps(body(asyncio.run(list_games())), ensure_ascii=False)
    assert "난수" not in blob and "category" not in blob


# ── GET /api/games/{gameId} ───────────────────────────────────────────────


@pytest.mark.parametrize("game_id", list(GameId))
def test_상세는_규칙과_단계를_담는다(game_id):
    data = body(asyncio.run(get_game(game_id.value)))
    assert data["gameId"] == game_id.value
    assert data["rules"] and data["steps"]
    assert data["minMembers"] == MIN_MEMBERS[game_id]


def test_상세의_configSchema는_game_config가_정본이다():
    data = body(asyncio.run(get_game(GameId.SNIPE.value)))
    assert data["configSchema"] == game_config.describe(GameId.SNIPE)


def test_없는_게임이면_game_not_found다():
    with pytest.raises(errors.DomainError) as exc:
        asyncio.run(get_game("timecatch"))  # 프로토타입이 쓰던 낡은 값
    assert exc.value.spec is errors.GAME_NOT_FOUND
    assert exc.value.spec.status == 404


def test_두_경로가_앱에_등록되어_있다():
    """핸들러를 직접 부르는 테스트는 경로 오타를 잡지 못한다. 여기서 잡는다.

    app.openapi()는 앱 객체만 있으면 되고 기동(테이블 확인)을 거치지 않으므로 DB가
    필요 없다. 상태코드까지 확인하는 실제 HTTP 테스트는 tests/contract/의 몫이다.
    """
    from app.main import app

    paths = app.openapi()["paths"]
    assert "get" in paths["/api/games"]
    assert "get" in paths["/api/games/{game_id}"]
