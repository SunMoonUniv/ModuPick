"""게임 메타 2종 — 목록과 상세.

인증이 필요 없다. 표지 화면과 대기방 어디서든 같게 호출되는 정적 메타데이터라
소켓에 태우지 않는다. 값은 서버가 정본이며 클라이언트가 자기 목록을 들고 있지 않는다.
"""

from typing import Annotated

from fastapi import APIRouter, Path
from fastapi.responses import JSONResponse

from app.api.errors import ok
from app.domain import errors, game_config
from app.domain.enums import GameId
from app.domain.games import catalog

router = APIRouter(prefix="/api", tags=["games"])

GameIdPath = Annotated[str, Path(description="게임 식별자")]


def _summary(game_id: GameId) -> dict:
    m = catalog.meta(game_id)
    return {
        "gameId": game_id.value,
        "name": m.name,
        "description": m.description,
        "minMembers": catalog.min_members(game_id),
        "maxMembers": catalog.MAX_MEMBERS,
        "resultVariant": m.result_variant.value,
        "configSchema": game_config.describe(game_id),
    }


@router.get("/games")
async def list_games() -> JSONResponse:
    """게임 메타 목록 6종."""
    content = [_summary(game_id) for game_id in GameId]
    return ok({"content": content, "totalCount": len(content)})


@router.get("/games/{game_id}")
async def get_game(game_id: GameIdPath) -> JSONResponse:
    """게임 상세·가이드. 없는 gameId면 game.not_found."""
    try:
        gid = GameId(game_id)
    except ValueError:
        raise errors.DomainError(errors.GAME_NOT_FOUND) from None

    m = catalog.meta(gid)
    return ok(
        {
            "gameId": gid.value,
            "name": m.name,
            "minMembers": catalog.min_members(gid),
            "resultVariant": m.result_variant.value,
            "rules": list(m.rules),
            "steps": list(m.steps),
            "configSchema": game_config.describe(gid),
        }
    )
