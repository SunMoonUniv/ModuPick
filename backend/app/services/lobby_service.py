"""대기방 조작 — 준비 토글.

**준비 상태는 인메모리에만 있다.** participants에 ready 컬럼을 두지 않은 것이
설계다. 방이 사라지면 함께 사라져야 하는 값이고, 토글마다 쓰기를 만들 이유가 없다.

집계 권위는 서버에 있다.

    activeCount  명단 인원 — 방장을 포함한다
    readyCount   준비한 참여자 수 — **방장은 모수에서 빠진다**

시작 조건이 방장을 제외한 참여자 전원이므로 readyCount의 목표치는 activeCount - 1이다.
클라이언트가 명단을 세면 화면마다 값이 갈리므로 두 값을 서버가 실어 보낸다.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.domain import errors
from app.domain.enums import MemberStatus, Role, RoomStatus
from app.infra.db.session import readonly
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import store


@dataclass(frozen=True, slots=True)
class ReadyTally:
    ready_count: int
    active_count: int


async def _active_roster(conn: AsyncConnection, room_pk: int) -> list:
    """명단에 오른 참가자의 (id, role). 정원·집계의 근거는 언제나 DB다."""
    return (
        await conn.execute(
            select(participants.c.id, participants.c.role).where(
                participants.c.room_id == room_pk,
                participants.c.status == MemberStatus.ACTIVE.value,
                participants.c.left_at.is_(None),
            )
        )
    ).all()


def _tally(rows: list, room_pk: int, *, unstable: set[int] = frozenset()) -> ReadyTally:
    """준비 수를 센다.

    **인메모리 준비 집합을 그대로 세지 않고 DB 명단과 교집합을 낸다.** 나간 사람의
    식별자가 집합에 남아 있어도 집계가 부풀지 않는다.

    unstable은 유예 중인 참가자다. **readyCount에서만 빼고 activeCount에는 남긴다** —
    둘 다에서 빼면 연결이 끊긴 사람을 없는 셈 치고 게임이 시작되어 그가 처음부터
    미입력자로 판에 들어간다.
    """
    ready = store.ready_ids(room_pk)
    counted = {
        r.id for r in rows if r.role != Role.HOST.value and r.id in ready and r.id not in unstable
    }
    return ReadyTally(ready_count=len(counted), active_count=len(rows))


async def tally(room_pk: int, *, unstable: set[int] = frozenset()) -> ReadyTally:
    async with readonly() as conn:
        return _tally(await _active_roster(conn, room_pk), room_pk, unstable=unstable)


async def set_ready(*, participant_pk: int, room_pk: int, member_id: str, ready: bool) -> None:
    """준비 상태를 대입하고 방 전체에 알린다.

    토글이 아니라 대입이므로 **마지막 값이 이긴다.** 같은 값을 다시 보내도 오류가
    아니며 멱등 키가 필요 없다.
    """
    from app.schemas.events import MemberReadyChangedData
    from app.services import room_service
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

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

        if row is None or row.left_at is not None or row.status != MemberStatus.ACTIVE.value:
            # 프로필을 확정하지 않은 사람은 준비할 대상이 아니다.
            raise errors.DomainError(errors.GAME_INVALID_ACTION)
        if row.role == Role.HOST.value:
            # 방장은 준비 상태를 갖지 않는다. 자기 자신을 기다리는 구조를 만들지 않는다.
            raise errors.DomainError(errors.GAME_INVALID_ACTION)
        if row.room_status != RoomStatus.WAITING.value:
            raise errors.DomainError(errors.GAME_INVALID_ACTION)

        store.set_ready(room_pk, participant_pk, ready)
        counts = _tally(await _active_roster(conn, room_pk), room_pk)

    await room_service.touch(room_pk)

    frame = outgoing(
        "member:ready_changed",
        MemberReadyChangedData(
            roomVersion=store.bump_version(room_pk),
            memberId=member_id,
            ready=ready,
            readyCount=counts.ready_count,
            activeCount=counts.active_count,
        ).model_dump(),
    )
    await registry.broadcast(room_pk, frame)
