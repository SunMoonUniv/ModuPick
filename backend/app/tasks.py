"""주기 청소.

**프로세스 안의 단일 스케줄러다**(ADR-21). 워커가 하나이고 인스턴스가 하나라 외부
스케줄러를 두지 않는다. 세 가지를 쓸어낸다.

    만료 방        마지막 활동 +10분이 지난 방을 삭제하고 남은 소켓에 사유를 알린다
    PENDING 회수   3분 안에 프로필을 확정하지 않은 슬롯을 되돌린다
    멱등 캐시      만료된 항목을 버린다

**중복 실행돼도 결과가 같다.** 대상을 고른 뒤 잠그고 조건을 다시 보므로, 두 번 돌아도
두 번 삭제되지 않는다.

미연결 15초 회수는 여기 없다 — 가입 시점에 건 타이머가 잡는다(leave_service).
60초 주기에 맡기면 15초 규칙이 실질적으로 15~75초가 된다.
"""

import asyncio
import logging
from dataclasses import dataclass

from sqlalchemy import select, text

from app.api.deps import lookup_limiter
from app.config import settings
from app.domain.enums import LeaveReason, MemberStatus, RoomClosedReason, RoomStatus
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import store

log = logging.getLogger("modupick.tasks")

_NOW = text("NOW(6)")


@dataclass(frozen=True, slots=True)
class SweepReport:
    expired_rooms: int
    reclaimed_pending: int
    purged_idempotency: int
    purged_rate_limit: int = 0

    def any(self) -> bool:
        return bool(self.expired_rooms or self.reclaimed_pending or self.purged_idempotency)


# ── 만료 방 ────────────────────────────────────────────────────────────────


async def _delete_if_expired(room_pk: int) -> bool:
    """방을 잠그고 만료 조건을 **다시 본다.**

    고르는 시점과 지우는 시점 사이에 누군가 채팅을 보내 만료가 밀렸을 수 있다.
    """
    async with transaction() as conn:
        row = (
            await conn.execute(
                select(rooms.c.id)
                .where(
                    rooms.c.id == room_pk,
                    rooms.c.expires_at <= _NOW,
                    rooms.c.status == RoomStatus.WAITING.value,
                )
                .with_for_update()
            )
        ).first()
        if row is None:
            return False
        await conn.execute(rooms.delete().where(rooms.c.id == room_pk))
        return True


async def _sweep_expired_rooms() -> int:
    from app.schemas.events import RoomClosedData
    from app.ws.connection import registry
    from app.ws.envelope import CloseCode, outgoing

    async with readonly() as conn:
        targets = [
            r.id
            for r in (
                await conn.execute(
                    select(rooms.c.id).where(
                        rooms.c.expires_at <= _NOW,
                        # **진행 중에는 만료 타이머가 멈춰 있다.** 판이 도는 방을
                        # 무활동으로 지우면 결과를 눈앞에서 잃는다.
                        rooms.c.status == RoomStatus.WAITING.value,
                    )
                )
            ).all()
        ]

    swept = 0
    for room_pk in targets:
        if not await _delete_if_expired(room_pk):
            continue
        swept += 1
        # 커밋 이후에 알린다. 사유를 구분해 주어야 화면이 표지로 안내할 수 있다.
        frame = outgoing(
            "room:closed",
            RoomClosedData(
                roomVersion=store.bump_version(room_pk),
                reason=RoomClosedReason.EXPIRED.value,
            ).model_dump(),
        )
        await registry.close_room(room_pk, frame, CloseCode.ROOM_CLOSED)
        store.revoke_room(room_pk)
        log.info("만료 방 삭제 — room=%s", room_pk)
    return swept


# ── PENDING 슬롯 ───────────────────────────────────────────────────────────


async def _sweep_pending() -> int:
    """프로필을 확정하지 않고 방치된 슬롯을 되돌린다.

    회수가 없으면 들어오다 만 사람이 자리를 영구히 점유한다. 확정 절차는
    leave_service 한 곳뿐이므로 여기서도 그것을 부른다 — 대상이 방장이면 방 삭제까지
    같은 규칙으로 이어진다.
    """
    from app.services import leave_service

    async with readonly() as conn:
        targets = (
            await conn.execute(
                select(
                    participants.c.id,
                    participants.c.room_id,
                    participants.c.member_id,
                ).where(
                    participants.c.status == MemberStatus.PENDING.value,
                    participants.c.left_at.is_(None),
                    participants.c.pending_expires_at.is_not(None),
                    participants.c.pending_expires_at <= _NOW,
                )
            )
        ).all()

    for t in targets:
        await leave_service.confirm(
            participant_pk=t.id,
            room_pk=t.room_id,
            member_id=t.member_id,
            reason=LeaveReason.DISCONNECT,
        )
        log.info("PENDING 슬롯 회수 — room=%s member=%s", t.room_id, t.member_id)
    return len(targets)


# ── 실행 ───────────────────────────────────────────────────────────────────


async def sweep_once() -> SweepReport:
    report = SweepReport(
        expired_rooms=await _sweep_expired_rooms(),
        reclaimed_pending=await _sweep_pending(),
        purged_idempotency=store.purge_expired_idempotency(),
        # 한 번씩 들른 IP의 항목이 프로세스 수명 동안 쌓이지 않게 한다.
        purged_rate_limit=lookup_limiter.purge_expired(),
    )
    if report.any():
        log.info(
            "청소 — 만료 방 %d · PENDING 회수 %d · 멱등 %d",
            report.expired_rooms,
            report.reclaimed_pending,
            report.purged_idempotency,
        )
    return report


async def run_forever() -> None:
    """주기 실행. **한 번의 실패가 루프를 죽이지 않는다.**

    스위퍼가 멈추면 만료된 방이 영원히 남고 그것을 알려 줄 사람이 없다.
    """
    while True:
        try:
            await asyncio.sleep(settings.sweep_interval_s)
            await sweep_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("청소 중 오류 — 다음 주기에 다시 시도한다")
