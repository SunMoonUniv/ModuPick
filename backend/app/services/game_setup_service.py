"""게임 선택·설정 동기화.

**방장만 바꾸고 전원이 같이 본다.** 참여자 화면은 읽기 전용이지만 실시간으로 함께
바뀐다 — 그래서 game:selected·game:config_changed가 방 전체 브로드캐스트다.

선택과 설정은 **인메모리 전용**이다. game_rounds에 남는 것은 게임 시작으로 라운드가
만들어지는 순간부터이며, 그전 상태는 재기동으로 사라지는 것이 정상이다.

랜덤 뽑기를 서버가 하는 이유는 클라이언트가 뽑으면 방장 화면과 참여자 화면의 결과가
엇갈릴 수 있기 때문이다.
"""

import secrets
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select

from app.domain import errors, game_config
from app.domain.enums import MIN_MEMBERS, GameId, MemberStatus, Role, RoomStatus
from app.infra.db.session import readonly
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import store


@dataclass(frozen=True, slots=True)
class HostContext:
    room_status: str
    active_count: int


async def _require_host(participant_pk: int, room_pk: int) -> HostContext:
    """방장 여부와 방 상태를 **DB에서 읽어** 판정한다.

    토큰이나 페이로드가 실어 보낸 역할을 믿지 않는다.
    """
    async with readonly() as conn:
        row = (
            await conn.execute(
                select(
                    participants.c.role,
                    participants.c.status,
                    participants.c.left_at,
                    rooms.c.status.label("room_status"),
                )
                .select_from(participants.join(rooms, participants.c.room_id == rooms.c.id))
                .where(participants.c.id == participant_pk)
            )
        ).first()

        if row is None or row.left_at is not None:
            raise errors.DomainError(errors.COMMON_SESSION_EXPIRED)
        if row.role != Role.HOST.value or row.status != MemberStatus.ACTIVE.value:
            raise errors.DomainError(errors.MEMBER_NOT_HOST)
        if row.room_status != RoomStatus.WAITING.value:
            # 게임 진행 중에는 선택·설정을 받지 않는다.
            raise errors.DomainError(errors.GAME_INVALID_ACTION)

        active = (
            await conn.execute(
                select(func.count())
                .select_from(participants)
                .where(
                    participants.c.room_id == room_pk,
                    participants.c.status == MemberStatus.ACTIVE.value,
                    participants.c.left_at.is_(None),
                )
            )
        ).scalar_one()

    return HostContext(room_status=row.room_status, active_count=active)


def _parse_game(raw: str) -> GameId:
    try:
        return GameId(raw)
    except ValueError as exc:
        raise errors.DomainError(errors.GAME_NOT_FOUND) from exc


async def _broadcast_selected(room_pk: int, game_id: GameId, config: dict[str, Any]) -> None:
    from app.schemas.events import GameSelectedData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    await registry.broadcast(
        room_pk,
        outgoing(
            "game:selected",
            GameSelectedData(
                roomVersion=store.bump_version(room_pk),
                gameId=game_id.value,
                config=config,
                configSchemaVersion=game_config.CONFIG_SCHEMA_VERSION,
            ).model_dump(),
        ),
    )


# ── game:select ────────────────────────────────────────────────────────────


async def select_game(*, participant_pk: int, room_pk: int, raw_game_id: str) -> None:
    """게임을 고른다. **설정은 기본값으로 초기화된다.**

    이전 게임의 값이 남아 엉뚱하게 적용되는 사고를 막는다. 같은 게임을 다시 골라도
    초기화한다 — 정본이 예외를 두지 않았고, 두면 "되돌리기"가 게임 재선택으로
    우연히 생긴다.
    """
    from app.services import room_service

    ctx = await _require_host(participant_pk, room_pk)
    game_id = _parse_game(raw_game_id)

    if ctx.active_count < MIN_MEMBERS[game_id]:
        raise errors.DomainError(errors.GAME_NOT_ENOUGH_MEMBERS)

    config = game_config.defaults(game_id)
    store.select_game(room_pk, game_id.value, config)

    await room_service.touch(room_pk)
    await _broadcast_selected(room_pk, game_id, config)


# ── game:random ────────────────────────────────────────────────────────────


async def pick_random(*, participant_pk: int, room_pk: int) -> None:
    """서버가 고른다. **현재 인원으로 시작할 수 없는 게임은 후보에서 뺀다.**"""
    from app.services import room_service

    ctx = await _require_host(participant_pk, room_pk)

    candidates = [g for g in GameId if MIN_MEMBERS[g] <= ctx.active_count]
    if not candidates:
        raise errors.DomainError(errors.GAME_NOT_ENOUGH_MEMBERS)

    game_id = secrets.choice(candidates)
    config = game_config.defaults(game_id)
    store.select_game(room_pk, game_id.value, config)

    await room_service.touch(room_pk)
    await _broadcast_selected(room_pk, game_id, config)


# ── game:config ────────────────────────────────────────────────────────────


async def change_config(
    *, participant_pk: int, room_pk: int, raw_game_id: str, patch: dict[str, Any]
) -> None:
    """설정을 부분 갱신한다.

    gameId를 함께 받는 이유는 **경합 때문이다** — 방장이 게임을 바꾸는 것과 디바운스로
    늦게 도착한 이전 게임의 설정 변경이 겹칠 수 있다. 현재 선택과 다르면 버린다.
    """
    from app.schemas.events import GameConfigChangedData
    from app.services import room_service
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    await _require_host(participant_pk, room_pk)

    selection = store.selection_of(room_pk)
    if selection is None:
        raise errors.DomainError(errors.GAME_NOT_SELECTED)
    if selection.game_id != raw_game_id:
        raise errors.DomainError(errors.GAME_INVALID_ACTION)

    game_id = _parse_game(raw_game_id)
    merged = game_config.merge(game_id, selection.config, patch)
    store.select_game(room_pk, game_id.value, merged)

    await room_service.touch(room_pk)
    await registry.broadcast(
        room_pk,
        outgoing(
            "game:config_changed",
            GameConfigChangedData(
                roomVersion=store.bump_version(room_pk),
                gameId=game_id.value,
                config=merged,
            ).model_dump(),
        ),
    )


def view_of(room_pk: int) -> dict[str, Any] | None:
    """room:snapshot의 game 필드. 아직 고르지 않았으면 null이다."""
    selection = store.selection_of(room_pk)
    if selection is None:
        return None
    return {
        "gameId": selection.game_id,
        "config": selection.config,
        "configSchemaVersion": game_config.CONFIG_SCHEMA_VERSION,
    }
