"""참가자 프로필·준비상태·강퇴·이탈을 다루는 응용 서비스.

FastAPI/WebSocket을 전혀 모른다. 입력은 순수 값, 출력은 dataclass 또는 DomainError뿐이다.
서비스 메서드 1번 호출 = 커밋 1번을 계약으로 삼는다 - 호출부는 세션 관리를 신경 쓸 필요 없다.
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.entities import ParticipantSnapshot
from app.domain.enums import ParticipantRole, ParticipantStatus
from app.domain.errors import (
    NotHostError,
    ParticipantKickedError,
    ParticipantNotFoundError,
    RoomFullError,
    RoomNotFoundError,
)
from app.domain.participant_rules import (
    assign_avatar,
    pick_successor_host,
    resolve_nickname_collision,
    validate_intro_tag,
    validate_nickname_input,
)
from app.domain.state_machine import assert_can_edit_profile, assert_can_join, assert_can_kick
from app.infra.db.orm_models import ParticipantORM, RoomORM
from app.ports import Clock, RoomRuntimeStore


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def participant_to_snapshot(orm: ParticipantORM) -> ParticipantSnapshot:
    return ParticipantSnapshot(
        id=orm.id,
        room_id=orm.room_id,
        nickname=orm.nickname,
        avatar=orm.avatar,
        intro_tag=orm.intro_tag,
        role=orm.role,
        status=orm.status,
        joined_at=orm.joined_at,
    )


def create_participant_record(
    session: Session,
    room: RoomORM,
    nickname: str,
    avatar: str | None,
    intro_tag: str | None,
    role: ParticipantRole,
    now: datetime,
) -> tuple[ParticipantORM, str]:
    """방/참가자 공통 생성 로직. RoomService.create_room과 ParticipantService.join이 함께 쓴다."""
    clean_nickname = validate_nickname_input(nickname)
    active = [p for p in room.participants if p.status == ParticipantStatus.ACTIVE]
    resolved_nickname = resolve_nickname_collision(clean_nickname, {p.nickname for p in active})
    resolved_avatar = assign_avatar(avatar, {p.avatar for p in active})
    clean_intro_tag = validate_intro_tag(intro_tag)

    token = secrets.token_urlsafe(24)
    participant = ParticipantORM(
        room_id=room.id,
        nickname=resolved_nickname,
        avatar=resolved_avatar,
        intro_tag=clean_intro_tag,
        role=role,
        status=ParticipantStatus.ACTIVE,
        joined_at=now,
        session_token_hash=_hash_token(token),
    )
    session.add(participant)
    session.flush()
    return participant, token


@dataclass(frozen=True)
class JoinResult:
    participant: ParticipantSnapshot
    token: str


@dataclass(frozen=True)
class LeaveOutcome:
    room_deleted: bool
    new_host: ParticipantSnapshot | None


class ParticipantService:
    def __init__(self, session: Session, runtime_store: RoomRuntimeStore, clock: Clock):
        self._session = session
        self._runtime_store = runtime_store
        self._clock = clock

    def join(
        self,
        room_code: str,
        nickname: str,
        avatar: str | None = None,
        intro_tag: str | None = None,
        rejoin_token: str | None = None,
    ) -> JoinResult:
        """입장 판정 순서: 방 없음 -> 강퇴 이력 -> 진행 중 -> 정원 초과. (F-105, F-108~110)"""
        room = self._get_room_by_code_or_raise(room_code)

        if rejoin_token is not None:
            token_hash = _hash_token(rejoin_token)
            kicked = self._session.execute(
                select(ParticipantORM).where(
                    ParticipantORM.room_id == room.id,
                    ParticipantORM.session_token_hash == token_hash,
                    ParticipantORM.status == ParticipantStatus.KICKED,
                )
            ).scalar_one_or_none()
            if kicked is not None:
                raise ParticipantKickedError("이 방에서 강퇴되어 다시 들어올 수 없습니다.")

        assert_can_join(room.status)

        active_count = sum(1 for p in room.participants if p.status == ParticipantStatus.ACTIVE)
        if active_count >= room.capacity:
            raise RoomFullError("방이 가득 찼어요.")

        now = self._clock.now()
        participant, token = create_participant_record(
            self._session, room, nickname, avatar, intro_tag, ParticipantRole.GUEST, now
        )
        self._session.commit()
        self._runtime_store.touch(room.id, now)
        return JoinResult(participant=participant_to_snapshot(participant), token=token)

    def update_profile(
        self, participant_id: int, nickname: str, avatar: str | None = None, intro_tag: str | None = None
    ) -> ParticipantSnapshot:
        """게임 시작 전(대기방)에서만 프로필을 통째로 다시 제출하는 방식이다. (F-111)"""
        participant = self._get_participant_or_raise(participant_id)
        assert_can_edit_profile(participant.room.status)

        others = [
            p for p in participant.room.participants
            if p.status == ParticipantStatus.ACTIVE and p.id != participant_id
        ]

        clean_nickname = validate_nickname_input(nickname)
        participant.nickname = resolve_nickname_collision(clean_nickname, {p.nickname for p in others})
        participant.avatar = assign_avatar(avatar, {p.avatar for p in others})
        participant.intro_tag = validate_intro_tag(intro_tag)

        self._session.commit()
        self._runtime_store.touch(participant.room_id, self._clock.now())
        return participant_to_snapshot(participant)

    def toggle_ready(self, participant_id: int, ready: bool | None = None) -> bool:
        """ready 인자를 안 주면 현재 상태를 반전시킨다. (F-206)"""
        participant = self._get_participant_or_raise(participant_id)
        current = self._runtime_store.get_ready_flags(participant.room_id).get(participant_id, False)
        new_value = ready if ready is not None else not current
        self._runtime_store.set_ready(participant.room_id, participant_id, new_value)
        self._runtime_store.touch(participant.room_id, self._clock.now())
        return new_value

    def kick(self, room_id: int, host_id: int, target_id: int) -> None:
        """대기방에서만 방장이 강퇴할 수 있다. 강퇴된 사람은 status=KICKED로 남아 재입장이 차단된다. (F-208)"""
        room = self._get_room_by_id_or_raise(room_id)
        assert_can_kick(room.status)

        host = self._get_participant_or_raise(host_id)
        if host.room_id != room_id or host.role != ParticipantRole.HOST:
            raise NotHostError("방장만 강퇴할 수 있습니다.")

        target = self._get_participant_or_raise(target_id)
        if target.room_id != room_id:
            raise ParticipantNotFoundError("해당 방에 참가자가 없습니다.")

        target.status = ParticipantStatus.KICKED
        self._runtime_store.clear_participant(room_id, target_id)
        self._session.commit()
        self._runtime_store.touch(room_id, self._clock.now())

    def leave(self, room_id: int, participant_id: int) -> LeaveOutcome:
        """방장이 나가면 최초 입장자에게 위임하고, 마지막 참가자가 나가면 방을 삭제한다. (F-209/210, D-12/13)"""
        room = self._get_room_by_id_or_raise(room_id)
        participant = self._get_participant_or_raise(participant_id)
        was_host = participant.role == ParticipantRole.HOST

        participant.status = ParticipantStatus.LEFT
        self._runtime_store.clear_participant(room_id, participant_id)

        remaining = [
            participant_to_snapshot(p) for p in room.participants
            if p.status == ParticipantStatus.ACTIVE and p.id != participant_id
        ]

        if not remaining:
            self._session.delete(room)
            self._session.commit()
            self._runtime_store.purge_room(room_id)
            return LeaveOutcome(room_deleted=True, new_host=None)

        new_host_snapshot = None
        if was_host:
            successor = pick_successor_host(remaining)
            if successor is not None:
                successor_orm = self._get_participant_or_raise(successor.id)
                successor_orm.role = ParticipantRole.HOST
                new_host_snapshot = participant_to_snapshot(successor_orm)

        self._session.commit()
        self._runtime_store.touch(room_id, self._clock.now())
        return LeaveOutcome(room_deleted=False, new_host=new_host_snapshot)

    def list_active_participants(self, room_id: int) -> list[ParticipantSnapshot]:
        room = self._get_room_by_id_or_raise(room_id)
        return [participant_to_snapshot(p) for p in room.participants if p.status == ParticipantStatus.ACTIVE]

    def _get_room_by_code_or_raise(self, room_code: str) -> RoomORM:
        room = self._session.execute(select(RoomORM).where(RoomORM.code == room_code)).scalar_one_or_none()
        if room is None:
            raise RoomNotFoundError("없는 방이에요.")
        return room

    def _get_room_by_id_or_raise(self, room_id: int) -> RoomORM:
        room = self._session.get(RoomORM, room_id)
        if room is None:
            raise RoomNotFoundError("없는 방이에요.")
        return room

    def _get_participant_or_raise(self, participant_id: int) -> ParticipantORM:
        participant = self._session.get(ParticipantORM, participant_id)
        if participant is None:
            raise ParticipantNotFoundError("참가자를 찾을 수 없습니다.")
        return participant
