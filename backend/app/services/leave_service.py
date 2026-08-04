"""이탈 — 의심 진입 · 유예 · 확정.

**소켓이 끊겼다는 사실과 사람이 방을 떠났다는 사실은 다르다.** 둘을 같은 것으로
다루면 모바일에서 앱을 전환한 것만으로 방이 폭파된다. 그래서 상태가 셋이다.

    연결 ──(소켓 종료 관측·pong 미수신·전송 실패)──▶ 의심 ──(유예 만료)──▶ 이탈 확정
                                                          │
    나가기(1000)·강퇴·REST 이탈 ─────────────────────────┘ 유예 없이 즉시

**유예는 회복을 기다리는 창이 아니다.** 새 소켓으로 돌아오는 경로는 없고(재접속 불가),
종료된 소켓에는 복귀 경로도 없다. 늦춰서 얻는 것은 예고다 — 남은 사람이 "방이 갑자기
사라졌다"가 아니라 "방장 연결이 끊겨 곧 닫힌다"를 60초 동안 본다.

확정은 **한 곳에서만** 한다. REST 이탈·나가기·강퇴·유예 만료가 모두 confirm으로 모인다.
경로마다 따로 쓰면 방 삭제 조건 하나를 어느 한쪽에서 빠뜨리게 된다.
"""

import asyncio
import logging
from dataclasses import dataclass

from sqlalchemy import func, select, text, update

from app.config import settings
from app.domain.enums import LeaveReason, MemberStatus, RoomClosedReason, Role
from app.infra.clock import clock
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import GraceEntry, store
from app.schemas.rest import iso_z

log = logging.getLogger("modupick.leave")

_NOW = text("NOW(6)")


@dataclass(frozen=True, slots=True)
class LeaveOutcome:
    room_deleted: bool
    was_host: bool
    was_active: bool


# ── 의심 진입 ──────────────────────────────────────────────────────────────


async def enter_unstable(*, participant_pk: int, room_pk: int, member_id: str) -> bool:
    """소켓이 끊겼지만 아직 이탈이 아니다. 유예를 열고 방에 알린다.

    유예 길이가 방장만 두 배인 이유는 **방 삭제가 되돌릴 수 없기** 때문이다. 초대
    링크를 공유하러 다른 앱에 다녀오는 왕복이 그 창 안에 들어가야 한다.
    """
    from app.schemas.events import MemberConnectionData
    from app.services import lobby_service
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    async with readonly() as conn:
        row = (
            await conn.execute(
                select(participants.c.role, participants.c.status, participants.c.left_at)
                .where(participants.c.id == participant_pk)
            )
        ).first()

    if row is None or row.left_at is not None:
        return False  # 이미 확정됐다. 열 유예가 없다.

    grace_s = settings.grace_host_s if row.role == Role.HOST.value else settings.grace_member_s
    ends_at = clock.now() + _timedelta(grace_s)

    if not store.start_grace(room_pk, participant_pk, GraceEntry(grace_ends_at=ends_at)):
        return False  # 이미 유예 중이다. 창을 새로 열지 않는다.

    task = asyncio.create_task(
        _expire(delay_s=grace_s, participant_pk=participant_pk, room_pk=room_pk,
                member_id=member_id)
    )
    entry = store.grace_of(room_pk, participant_pk)
    if entry is not None:
        entry.task = task

    # 준비를 해제한다. **readyCount에서만 빠지고 activeCount에는 남는다** — 둘 다에서
    # 빼면 연결이 끊긴 사람을 없는 셈 치고 게임이 시작되어 그가 미입력자로 들어간다.
    if row.status == MemberStatus.ACTIVE.value and row.role != Role.HOST.value:
        if store.is_ready(room_pk, participant_pk):
            store.clear_ready(room_pk, participant_pk)
            await lobby_service.broadcast_ready(
                room_pk=room_pk, member_id=member_id, ready=False
            )

    if row.status == MemberStatus.ACTIVE.value:
        await registry.broadcast(
            room_pk,
            outgoing(
                "member:connection",
                MemberConnectionData(
                    roomVersion=store.bump_version(room_pk),
                    memberId=member_id,
                    state="UNSTABLE",
                    graceEndsAt=iso_z(ends_at),
                ).model_dump(),
            ),
        )
    log.info("의심 진입 — room=%s member=%s grace=%.0fs", room_pk, member_id, grace_s)
    return True


def _timedelta(seconds: float):
    from datetime import timedelta

    return timedelta(seconds=seconds)


async def _expire(*, delay_s: float, participant_pk: int, room_pk: int, member_id: str) -> None:
    """유예가 만료되면 이탈을 확정한다.

    **확정 직전에 상태를 다시 본다.** 잠든 사이에 방이 사라졌거나 다른 경로로 이미
    확정됐을 수 있다.
    """
    try:
        await asyncio.sleep(delay_s)
        if store.grace_of(room_pk, participant_pk) is None:
            return  # 취소됐다
        await confirm(
            participant_pk=participant_pk,
            room_pk=room_pk,
            member_id=member_id,
            reason=LeaveReason.DISCONNECT,
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("유예 만료 처리 실패 — room=%s member=%s", room_pk, member_id)


# ── 확정 ───────────────────────────────────────────────────────────────────


async def confirm(
    *,
    participant_pk: int,
    room_pk: int,
    member_id: str | None = None,
    token: str | None = None,
    reason: LeaveReason,
    notify_room: bool = True,
) -> LeaveOutcome:
    """이탈을 확정한다. **모든 이탈 경로의 종착점이다.**

    방장이 나가면 방을 삭제한다. 마지막 참가자가 나가도 삭제한다 — 받을 사람이
    없으므로 그때는 브로드캐스트하지 않는다.

    이미 나간 상태의 재요청도 성공으로 처리한다(자연 멱등).
    """
    store.end_grace(room_pk, participant_pk)
    store.clear_ready(room_pk, participant_pk)

    room_deleted = False

    async with transaction() as conn:
        room = (
            await conn.execute(select(rooms.c.id).where(rooms.c.id == room_pk).with_for_update())
        ).first()
        if room is None:
            # 방이 이미 사라졌다. 정리할 것은 인메모리뿐이다.
            if token:
                store.revoke_token(token)
            return LeaveOutcome(room_deleted=True, was_host=False, was_active=False)

        me = (
            await conn.execute(
                select(
                    participants.c.role,
                    participants.c.status,
                    participants.c.left_at,
                    participants.c.member_id,
                )
                .where(participants.c.id == participant_pk)
                .with_for_update()
            )
        ).first()

        if me is not None and me.left_at is None:
            await conn.execute(
                update(participants)
                .where(participants.c.id == participant_pk)
                .values(left_at=_NOW)
            )

        is_host = me is not None and me.role == Role.HOST.value
        was_active = me is not None and me.status == MemberStatus.ACTIVE.value
        member_id = member_id or (me.member_id if me is not None else "")

        remaining = (
            await conn.execute(
                select(func.count())
                .select_from(participants)
                .where(participants.c.room_id == room_pk, participants.c.left_at.is_(None))
            )
        ).scalar_one()

        if is_host or remaining == 0:
            await conn.execute(rooms.delete().where(rooms.c.id == room_pk))
            room_deleted = True

    # **커밋 이후에만 발행한다.** 롤백된 사실을 화면에 남기지 않는다.
    if notify_room:
        await _announce(
            room_pk=room_pk,
            member_id=member_id,
            reason=reason,
            was_active=was_active,
            room_deleted=room_deleted,
            is_host=is_host,
        )

    if room_deleted:
        store.revoke_room(room_pk)
    elif token:
        store.revoke_token(token)

    return LeaveOutcome(room_deleted=room_deleted, was_host=is_host, was_active=was_active)


async def _announce(
    *,
    room_pk: int,
    member_id: str,
    reason: LeaveReason,
    was_active: bool,
    room_deleted: bool,
    is_host: bool,
) -> None:
    """이탈을 알린다.

    **방장이 나간 경우는 member:left가 아니라 room:closed다.** 방이 사라졌다는 사실이
    한 사람이 나갔다는 사실보다 크고, 남은 사람은 표지로 돌아가야 한다.

    PENDING이라 아직 아무에게도 보이지 않았다면 알리지 않는다 — 명단에 없던 사람의
    퇴장을 알리면 받는 쪽에 지울 카드가 없다.
    """
    from app.schemas.events import MemberLeftData, RoomClosedData
    from app.services import room_service
    from app.ws.connection import registry
    from app.ws.envelope import CloseCode, outgoing

    if room_deleted:
        closed_reason = (
            RoomClosedReason.HOST_LEFT if is_host else RoomClosedReason.LAST_MEMBER_LEFT
        )
        frame = outgoing(
            "room:closed",
            RoomClosedData(
                roomVersion=store.bump_version(room_pk), reason=closed_reason.value
            ).model_dump(),
        )
        await registry.close_room(room_pk, frame, CloseCode.ROOM_CLOSED)
        return

    if not was_active:
        return

    frame = outgoing(
        "member:left",
        MemberLeftData(
            roomVersion=store.bump_version(room_pk),
            memberId=member_id,
            reason=reason.value,
            activeCount=await room_service.active_count(room_pk),
        ).model_dump(),
    )
    await registry.broadcast(room_pk, frame)


# ── 소켓 종료 진입점 ───────────────────────────────────────────────────────


async def on_socket_closed(
    *, participant_pk: int, room_pk: int, member_id: str, token: str, close_code: int | None
) -> None:
    """소켓이 닫혔다. 즉시 확정과 유예를 가른다.

    **종료 코드 1000만 즉시 확정이다.** 클라이언트는 나가기 버튼에서만 1000을 쓰고
    페이지 숨김·새로고침·앱 전환에는 쓰지 않는다 — 모바일에서는 앱 전환만으로도
    그 사건이 발화하기 때문이다.
    """
    from app.ws.envelope import CloseCode

    if close_code == CloseCode.NORMAL:
        await confirm(
            participant_pk=participant_pk,
            room_pk=room_pk,
            member_id=member_id,
            token=token,
            reason=LeaveReason.LEAVE,
        )
        return

    await enter_unstable(participant_pk=participant_pk, room_pk=room_pk, member_id=member_id)


# ── 미연결 슬롯 회수 ───────────────────────────────────────────────────────


async def release_if_unconnected(*, participant_pk: int, room_pk: int) -> bool:
    """가입 후 정해진 시간 안에 핸드셰이크가 없으면 슬롯을 푼다.

    **주기 스위퍼가 아니라 가입 시점에 예약한 타이머로 잰다.** 60초 주기에 맡기면
    15초 규칙이 실질적으로 15~75초가 되고, 정원이 찬 방에서 그 차이는 못 들어오는
    사람의 대기 시간이 된다.

    회수 대상은 **가입 경로의 참가자뿐이다.** 방 생성 직후의 방장은 여기 걸리지
    않는다 — 정본이 이 값을 가입 절에 두었다.
    """
    if store.has_handshaked(room_pk, participant_pk):
        return False

    async with readonly() as conn:
        row = (
            await conn.execute(
                select(participants.c.status, participants.c.left_at, participants.c.member_id)
                .where(participants.c.id == participant_pk)
            )
        ).first()

    if row is None or row.left_at is not None or row.status != MemberStatus.PENDING.value:
        return False

    log.info("미연결 슬롯 회수 — room=%s member=%s", room_pk, row.member_id)
    await confirm(
        participant_pk=participant_pk,
        room_pk=room_pk,
        member_id=row.member_id,
        reason=LeaveReason.DISCONNECT,
    )
    return True


def schedule_unconnected_release(*, participant_pk: int, room_pk: int) -> None:
    """가입 직후에 회수 타이머를 건다. 실패해도 요청을 막지 않는다."""
    from app.ws.router import detach

    async def _later() -> None:
        await asyncio.sleep(settings.unconnected_release_s)
        await release_if_unconnected(participant_pk=participant_pk, room_pk=room_pk)

    try:
        detach(_later())
    except RuntimeError:
        # 이벤트 루프 밖이다(단위 테스트 등). 회수는 스위퍼가 대신 잡는다.
        log.debug("회수 타이머를 걸지 못했다 — room=%s", room_pk)
