"""프로필 확정·아바타 조회·소켓 연결 이전 이탈.

닉네임·아바타 충돌은 **코드에서도 검사하되 DB 제약이 최종 판정**을 한다. 동시 요청은
코드 검사를 나란히 통과하고 UNIQUE에서 갈리므로, IntegrityError를 도메인 에러로
변환하는 경로를 반드시 둔다.

    uq_participants_active_nickname 위반 -> 접미를 다시 채번해 1회 재시도
    uq_participants_active_avatar   위반 -> member.avatar_taken
"""

from dataclasses import dataclass

from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.domain import errors, participant_rules
from app.domain.enums import AVATAR_IDS, MemberStatus, Role
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import store

_NOW = text("NOW(6)")
_EXPIRES = text("NOW(6) + INTERVAL 10 MINUTE")


@dataclass(frozen=True, slots=True)
class AvatarSlot:
    avatar_id: str
    taken: bool
    taken_by: str | None


@dataclass(frozen=True, slots=True)
class ConfirmedProfile:
    member_id: str
    nickname: str
    avatar_id: str
    bio: str | None
    is_host: bool
    join_order: int


def _is_duplicate(exc: IntegrityError, constraint: str) -> bool:
    return constraint in str(exc.orig)


async def _taken_profiles(conn: AsyncConnection, room_pk: int) -> tuple[set[str], dict[str, str]]:
    """활성 참가자의 닉네임(정규화)과 아바타 → 닉네임 맵."""
    rows = (
        await conn.execute(
            select(participants.c.nickname, participants.c.avatar_id).where(
                participants.c.room_id == room_pk,
                participants.c.status == MemberStatus.ACTIVE.value,
                participants.c.left_at.is_(None),
            )
        )
    ).all()
    nicknames = {r.nickname.strip().lower() for r in rows if r.nickname}
    avatars = {r.avatar_id: r.nickname for r in rows if r.avatar_id}
    return nicknames, avatars


# ── 4. 아바타 선점 현황 ────────────────────────────────────────────────────


async def list_avatars(room_pk: int) -> list[AvatarSlot]:
    """30종 고정. 선점은 프로필 확정 시점에 굳으므로 그때까지는 비어 보인다."""
    async with readonly() as conn:
        _, avatars = await _taken_profiles(conn, room_pk)
    return [
        AvatarSlot(avatar_id=a, taken=a in avatars, taken_by=avatars.get(a))
        for a in AVATAR_IDS
    ]


# ── 5. 프로필 확정 ─────────────────────────────────────────────────────────


async def confirm_profile(
    *,
    participant_pk: int,
    room_pk: int,
    nickname: str,
    avatar_id: str | None,
    bio: str | None,
) -> ConfirmedProfile:
    """PENDING을 ACTIVE로 올린다. 이 순간부터 다른 사람 화면에 보인다.

    한 번만 확정할 수 있다 — 이미 ACTIVE면 member.already_active다.
    """
    desired = participant_rules.normalize_nickname(nickname)
    normalized_bio = participant_rules.normalize_bio(bio)

    for attempt in range(2):
        try:
            confirmed = await _confirm_once(
                participant_pk=participant_pk,
                room_pk=room_pk,
                desired=desired,
                avatar_id=avatar_id,
                bio=normalized_bio,
            )
        except IntegrityError as exc:
            if _is_duplicate(exc, "uq_participants_active_avatar"):
                raise errors.DomainError(errors.MEMBER_AVATAR_TAKEN) from exc
            if _is_duplicate(exc, "uq_participants_active_nickname") and attempt == 0:
                # 같은 닉네임을 동시에 확정한 경합이다. 다시 세어 접미를 새로 붙인다.
                continue
            raise
        else:
            # 커밋 이후에만 발행한다. 이 순간부터 다른 사람 화면에 보인다.
            await _broadcast_joined(room_pk=room_pk, participant_pk=participant_pk)
            return confirmed
    raise errors.DomainError(errors.MEMBER_NICKNAME_INVALID)


async def _broadcast_joined(*, room_pk: int, participant_pk: int) -> None:
    from app.schemas.events import MemberJoinedData
    from app.services import room_service
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    member = await room_service.member_view_of(room_pk, participant_pk)
    frame = outgoing(
        "member:joined",
        MemberJoinedData(roomVersion=store.bump_version(room_pk), member=member).model_dump(),
    )
    await registry.broadcast(room_pk, frame)


async def _confirm_once(
    *,
    participant_pk: int,
    room_pk: int,
    desired: str,
    avatar_id: str | None,
    bio: str | None,
) -> ConfirmedProfile:
    async with transaction() as conn:
        await conn.execute(select(rooms.c.id).where(rooms.c.id == room_pk).with_for_update())

        me = (
            await conn.execute(
                select(
                    participants.c.member_id,
                    participants.c.status,
                    participants.c.role,
                    participants.c.left_at,
                )
                .where(participants.c.id == participant_pk)
                .with_for_update()
            )
        ).first()

        if me is None or me.left_at is not None:
            raise errors.DomainError(errors.COMMON_SESSION_EXPIRED)
        if me.status == MemberStatus.ACTIVE.value:
            raise errors.DomainError(errors.MEMBER_ALREADY_ACTIVE)

        taken_nicknames, taken_avatars = await _taken_profiles(conn, room_pk)
        final_nickname = participant_rules.resolve_nickname(desired, taken_nicknames)
        final_avatar = participant_rules.normalize_avatar(avatar_id, set(taken_avatars))

        await conn.execute(
            update(participants)
            .where(participants.c.id == participant_pk)
            .values(
                nickname=final_nickname,
                avatar_id=final_avatar,
                bio=bio,
                status=MemberStatus.ACTIVE.value,
                pending_expires_at=None,
            )
        )

        join_order = (
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

        await conn.execute(
            update(rooms)
            .where(rooms.c.id == room_pk)
            .values(last_activity_at=_NOW, expires_at=_EXPIRES)
        )

    return ConfirmedProfile(
        member_id=me.member_id,
        nickname=final_nickname,
        avatar_id=final_avatar,
        bio=bio,
        is_host=me.role == Role.HOST.value,
        join_order=join_order,
    )


# ── 6. 소켓 연결 이전 이탈 ─────────────────────────────────────────────────


async def leave_before_socket(*, participant_pk: int, room_pk: int, token: str):
    """프로필 입력 화면에서 뒤로 가는 경우에 쓴다.

    소켓이 이미 열려 있으면 보통 이 경로를 쓰지 않는다 — 종료 코드 1000이 그 자리를
    대신한다. 어느 쪽이든 **유예 없이 즉시 확정**이며, 확정 절차는 leave_service
    한 곳에만 있다.
    """
    from app.domain.enums import LeaveReason
    from app.services import leave_service

    return await leave_service.confirm(
        participant_pk=participant_pk,
        room_pk=room_pk,
        token=token,
        reason=LeaveReason.LEAVE,
    )
