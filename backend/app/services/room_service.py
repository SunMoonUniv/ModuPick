"""방 생성·조회·입장·삭제.

잠금 순서는 rooms -> participants 한 방향이다. 건너뛰는 것은 되지만 뒤로 돌아가지
않는다. 상태·정원은 **잠근 뒤에 다시 본다** — 잠금 전 검사는 빠른 실패용이다.

정원 카운트는 left_at이 비어 있는 PENDING + ACTIVE 합산이다. 프로필을 아직 채우지
않은 사람도 슬롯을 차지해야 정원 초과를 정확히 막는다.
"""

from dataclasses import dataclass

from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.domain import errors, room_rules
from app.domain.enums import MemberStatus, Role, RoomStatus
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import TokenBinding, store
from app.infra.tokens import new_member_id, new_room_code, new_token

_NOW = text("NOW(6)")
_EXPIRES = text("NOW(6) + INTERVAL 10 MINUTE")
_PENDING_EXPIRES = text("NOW(6) + INTERVAL 3 MINUTE")


@dataclass(frozen=True, slots=True)
class CreatedRoom:
    code: str
    room_name: str
    max_members: int
    member_id: str
    member_token: str
    expires_at: str


@dataclass(frozen=True, slots=True)
class RoomLookup:
    code: str
    room_name: str
    room_status: RoomStatus
    max_members: int
    current_members: int
    host_nickname: str | None


@dataclass(frozen=True, slots=True)
class JoinedMember:
    member_id: str
    member_token: str
    current_members: int
    max_members: int


async def _count_members(conn: AsyncConnection, room_pk: int) -> int:
    """PENDING + ACTIVE 합산. 나간 사람은 세지 않는다."""
    return (
        await conn.execute(
            select(func.count())
            .select_from(participants)
            .where(participants.c.room_id == room_pk, participants.c.left_at.is_(None))
        )
    ).scalar_one()


async def _reclaim_expired_pending(conn: AsyncConnection, room_pk: int) -> None:
    """만료된 슬롯을 먼저 회수한다.

    카운트 전에 돌려야 한다. 들어오다 만 사람이 자리를 영구히 점유하는 것을 막는
    백스톱이며, 스윕과 입장 트랜잭션 양쪽에서 일어난다.
    """
    await conn.execute(
        update(participants)
        .where(
            participants.c.room_id == room_pk,
            participants.c.status == MemberStatus.PENDING.value,
            participants.c.left_at.is_(None),
            participants.c.pending_expires_at.is_not(None),
            participants.c.pending_expires_at <= _NOW,
        )
        .values(left_at=_NOW)
    )


async def _lock_room(conn: AsyncConnection, code: str):
    """방 행을 잠그고 돌려준다. 없으면 room.not_found."""
    row = (
        await conn.execute(
            select(
                rooms.c.id,
                rooms.c.code,
                rooms.c.room_name,
                rooms.c.status,
                rooms.c.max_members,
                rooms.c.expires_at,
            )
            .where(rooms.c.code == code)
            .with_for_update()
        )
    ).first()
    if row is None:
        raise errors.DomainError(errors.ROOM_NOT_FOUND)
    return row


async def _delete_room(conn: AsyncConnection, room_pk: int) -> None:
    """방 행 하나를 지우면 하위 5테이블이 CASCADE로 함께 사라진다."""
    await conn.execute(rooms.delete().where(rooms.c.id == room_pk))


def _is_duplicate(exc: IntegrityError, constraint: str) -> bool:
    return constraint in str(exc.orig)


# ── 1. 방 만들기 ───────────────────────────────────────────────────────────


async def create_room(room_name: str | None, max_members: int | None) -> CreatedRoom:
    """방과 방장 참가자를 같은 트랜잭션에서 만든다.

    코드가 살아 있는 방과 충돌하면 재추첨한다. 각 시도를 별도 트랜잭션으로 두는
    이유는 실패한 INSERT가 트랜잭션을 오염시킨 채로 다음 시도를 이어붙이지 않기
    위해서다.
    """
    name = room_rules.normalize_room_name(room_name)
    capacity = room_rules.normalize_capacity(max_members)

    for _ in range(room_rules.MAX_CODE_ATTEMPTS):
        code = new_room_code()
        member_id = new_member_id()
        try:
            async with transaction() as conn:
                result = await conn.execute(
                    rooms.insert().values(
                        code=code,
                        room_name=name,
                        max_members=capacity,
                        status=RoomStatus.WAITING.value,
                        last_activity_at=_NOW,
                        expires_at=_EXPIRES,
                    )
                )
                room_pk = result.inserted_primary_key[0]

                result = await conn.execute(
                    participants.insert().values(
                        member_id=member_id,
                        room_id=room_pk,
                        status=MemberStatus.PENDING.value,
                        role=Role.HOST.value,
                        pending_expires_at=_PENDING_EXPIRES,
                    )
                )
                participant_pk = result.inserted_primary_key[0]

                expires = (
                    await conn.execute(select(rooms.c.expires_at).where(rooms.c.id == room_pk))
                ).scalar_one()
        except IntegrityError as exc:
            if _is_duplicate(exc, "uq_rooms_code"):
                continue
            raise
        else:
            token = new_token()
            store.init_version(room_pk)
            store.bind_token(
                token,
                TokenBinding(participant_id=participant_pk, room_id=room_pk, room_code=code),
            )
            from app.schemas.rest import iso_z

            return CreatedRoom(
                code=code,
                room_name=name,
                max_members=capacity,
                member_id=member_id,
                member_token=token,
                expires_at=iso_z(expires),
            )

    raise errors.DomainError(errors.ROOM_CODE_EXHAUSTED)


# ── 2. 초대 코드 검증 ──────────────────────────────────────────────────────


async def lookup_room(code: str) -> RoomLookup:
    """입장 자격을 판정한다. 인증이 필요 없다.

    만료 시각이 지났지만 스윕이 아직 오지 않은 방을 만나면 **그 자리에서 삭제한 뒤**
    만료로 응답한다. 삭제된 코드와 애초에 없던 코드는 구별하지 않는다.
    """
    async with readonly() as conn:
        row = (
            await conn.execute(
                select(
                    rooms.c.id,
                    rooms.c.code,
                    rooms.c.room_name,
                    rooms.c.status,
                    rooms.c.max_members,
                    rooms.c.expires_at,
                ).where(rooms.c.code == code)
            )
        ).first()
        if row is None:
            raise errors.DomainError(errors.ROOM_NOT_FOUND)

        now = (await conn.execute(select(text("NOW(6)")))).scalar_one()

    if room_rules.is_expired(row.expires_at, now):
        async with transaction() as conn:
            await _delete_room(conn, row.id)
        store.revoke_room(row.id)
        raise errors.DomainError(errors.ROOM_EXPIRED)

    if row.status == RoomStatus.PLAYING.value:
        raise errors.DomainError(errors.ROOM_ALREADY_PLAYING)

    async with readonly() as conn:
        current = await _count_members(conn, row.id)
        host_nickname = (
            await conn.execute(
                select(participants.c.nickname).where(
                    participants.c.room_id == row.id,
                    participants.c.role == Role.HOST.value,
                    participants.c.left_at.is_(None),
                )
            )
        ).scalar_one_or_none()

    if not room_rules.has_room_for_one_more(current, row.max_members):
        raise errors.DomainError(errors.ROOM_FULL)

    return RoomLookup(
        code=row.code,
        room_name=row.room_name,
        room_status=RoomStatus(row.status),
        max_members=row.max_members,
        current_members=current,
        host_nickname=host_nickname,
    )


# ── 3. 가입 — 슬롯 선점 ────────────────────────────────────────────────────


async def join_room(code: str) -> JoinedMember:
    """슬롯을 선점하고 토큰만 먼저 받는다. 요청 본문이 없다.

    방 행을 잠근 뒤 정원을 재확인하므로 마지막 한 자리에 대한 동시 입장 경합이
    여기서 직렬화된다.
    """
    member_id = new_member_id()

    async with transaction() as conn:
        room = await _lock_room(conn, code)

        now = (await conn.execute(select(text("NOW(6)")))).scalar_one()
        if room_rules.is_expired(room.expires_at, now):
            await _delete_room(conn, room.id)
            store.revoke_room(room.id)
            raise errors.DomainError(errors.ROOM_EXPIRED)

        if room.status == RoomStatus.PLAYING.value:
            raise errors.DomainError(errors.ROOM_ALREADY_PLAYING)

        await _reclaim_expired_pending(conn, room.id)

        current = await _count_members(conn, room.id)
        if not room_rules.has_room_for_one_more(current, room.max_members):
            raise errors.DomainError(errors.ROOM_FULL)

        result = await conn.execute(
            participants.insert().values(
                member_id=member_id,
                room_id=room.id,
                status=MemberStatus.PENDING.value,
                role=Role.GUEST.value,
                pending_expires_at=_PENDING_EXPIRES,
            )
        )
        participant_pk = result.inserted_primary_key[0]

        await conn.execute(
            update(rooms)
            .where(rooms.c.id == room.id)
            .values(last_activity_at=_NOW, expires_at=_EXPIRES)
        )

    token = new_token()
    store.bind_token(
        token,
        TokenBinding(participant_id=participant_pk, room_id=room.id, room_code=code),
    )

    return JoinedMember(
        member_id=member_id,
        member_token=token,
        current_members=current + 1,
        max_members=room.max_members,
    )


# ── 방 삭제 ────────────────────────────────────────────────────────────────


async def delete_room_now(room_pk: int) -> None:
    """즉시 삭제. 방장 이탈·마지막 참가자 이탈이 부른다."""
    async with transaction() as conn:
        await _delete_room(conn, room_pk)
    store.revoke_room(room_pk)


async def build_snapshot(*, room_pk: int, me_participant_pk: int) -> dict:
    """방 스냅샷 하나로 대기방 화면을 통째로 그릴 수 있게 만든다.

    members에는 **ACTIVE만** 들어간다. 프로필 입력 중인 PENDING은 소켓이 붙어 있어도
    다른 사람 화면에 보이지 않는다 — 그 구간이 존재하는 것이 이 설계의 특징이다.
    """
    from app.schemas.events import MeView, MemberView, RoomView, SnapshotData
    from app.schemas.rest import iso_z

    async with readonly() as conn:
        room = (
            await conn.execute(
                select(
                    rooms.c.code,
                    rooms.c.room_name,
                    rooms.c.max_members,
                    rooms.c.status,
                    rooms.c.expires_at,
                ).where(rooms.c.id == room_pk)
            )
        ).first()
        if room is None:
            raise errors.DomainError(errors.ROOM_NOT_FOUND)

        rows = (
            await conn.execute(
                select(
                    participants.c.id,
                    participants.c.member_id,
                    participants.c.nickname,
                    participants.c.avatar_id,
                    participants.c.bio,
                    participants.c.role,
                    participants.c.status,
                )
                .where(
                    participants.c.room_id == room_pk,
                    participants.c.left_at.is_(None),
                )
                .order_by(participants.c.joined_at, participants.c.id)
            )
        ).all()

    active = [r for r in rows if r.status == MemberStatus.ACTIVE.value]
    host_member_id = next((r.member_id for r in rows if r.role == Role.HOST.value), None)
    me = next((r for r in rows if r.id == me_participant_pk), None)
    if me is None:
        raise errors.DomainError(errors.COMMON_SESSION_EXPIRED)

    from app.infra.clock import clock

    unstable = store.unstable_ids(room_pk)

    return SnapshotData(
        roomVersion=store.version(room_pk),
        serverTime=iso_z(clock.now()),
        room=RoomView(
            code=room.code,
            displayCode=f"MODU-{room.code}",
            roomName=room.room_name,
            maxMembers=room.max_members,
            roomStatus=RoomStatus(room.status).name,
            hostMemberId=host_member_id,
            expiresAt=iso_z(room.expires_at),
        ),
        me=MeView(
            memberId=me.member_id,
            isHost=me.role == Role.HOST.value,
            memberStatus=MemberStatus(me.status).name,
        ),
        members=[
            MemberView(
                memberId=r.member_id,
                nickname=r.nickname,
                avatarId=r.avatar_id,
                bio=r.bio,
                isHost=r.role == Role.HOST.value,
                # 준비 상태는 인메모리가 정본이다. 방장은 애초에 집합에 들어가지 않는다.
                ready=store.is_ready(room_pk, r.id),
                # 유예 중이면 UNSTABLE이다. 뒤늦게 붙은 사람도 연결 끊김 표시를 본다.
                connection="UNSTABLE" if r.id in unstable else "ONLINE",
                joinOrder=i + 1,
            )
            for i, r in enumerate(active)
        ],
        game=None,
    ).model_dump()


async def member_view_of(room_pk: int, participant_pk: int) -> dict:
    """한 참가자의 명단 표현. member:joined가 쓴다."""
    from app.schemas.events import MemberView

    async with readonly() as conn:
        rows = (
            await conn.execute(
                select(
                    participants.c.id,
                    participants.c.member_id,
                    participants.c.nickname,
                    participants.c.avatar_id,
                    participants.c.bio,
                    participants.c.role,
                )
                .where(
                    participants.c.room_id == room_pk,
                    participants.c.status == MemberStatus.ACTIVE.value,
                    participants.c.left_at.is_(None),
                )
                .order_by(participants.c.joined_at, participants.c.id)
            )
        ).all()

    for i, r in enumerate(rows):
        if r.id == participant_pk:
            return MemberView(
                memberId=r.member_id,
                nickname=r.nickname,
                avatarId=r.avatar_id,
                bio=r.bio,
                isHost=r.role == Role.HOST.value,
                ready=False,
                connection="ONLINE",
                joinOrder=i + 1,
            ).model_dump()
    raise errors.DomainError(errors.MEMBER_NOT_FOUND)


async def active_count(room_pk: int) -> int:
    async with readonly() as conn:
        return (
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


async def touch(room_pk: int) -> None:
    """사용자 행동으로 만료를 연장한다. 하트비트·타이머 알림은 부르지 않는다."""
    async with transaction() as conn:
        await conn.execute(
            update(rooms)
            .where(rooms.c.id == room_pk, rooms.c.status == RoomStatus.WAITING.value)
            .values(last_activity_at=_NOW, expires_at=_EXPIRES)
        )
