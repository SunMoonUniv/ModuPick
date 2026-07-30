"""방 생성·상태 조회·상태 전이·만료 정리를 다루는 응용 서비스.

FastAPI/WebSocket을 전혀 모른다. 입력은 순수 값, 출력은 dataclass 또는 DomainError뿐이다.
서비스 메서드 1번 호출 = 커밋 1번을 계약으로 삼는다 - 호출부는 세션 관리를 신경 쓸 필요 없다.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import MIN_CAPACITY, ROOM_CODE_MAX_RETRIES, ROOM_INACTIVITY_MINUTES
from app.domain.entities import ParticipantSnapshot, RoomSnapshot
from app.domain.enums import ParticipantRole, ParticipantStatus, RoomStatus
from app.domain.errors import RoomCodeExhaustedError, RoomNotFoundError
from app.domain.room_rules import generate_room_code, is_all_ready, normalize_capacity, normalize_title
from app.domain.state_machine import assert_transition_allowed
from app.infra.db.orm_models import RoomORM
from app.ports import Clock, RandomSource, RoomRuntimeStore
from app.services.participant_service import create_participant_record, participant_to_snapshot


def _to_room_snapshot(orm: RoomORM) -> RoomSnapshot:
    return RoomSnapshot(
        id=orm.id,
        code=orm.code,
        title=orm.title,
        capacity=orm.capacity,
        status=orm.status,
        created_at=orm.created_at,
    )


@dataclass(frozen=True)
class CreateRoomResult:
    room: RoomSnapshot
    host: ParticipantSnapshot
    host_token: str


@dataclass(frozen=True)
class StartEligibility:
    can_start: bool
    reason: str | None
    ready_count: int
    total_count: int


class RoomService:
    def __init__(self, session: Session, runtime_store: RoomRuntimeStore, clock: Clock, rng: RandomSource):
        self._session = session
        self._runtime_store = runtime_store
        self._clock = clock
        self._rng = rng

    def create_room(
        self,
        title: str | None,
        capacity: int | None,
        host_nickname: str,
        host_avatar: str | None = None,
        host_intro_tag: str | None = None,
    ) -> CreateRoomResult:
        """방을 만들고 방장을 첫 참가자로 등록한다. (F-101/102, US-101)"""
        norm_title = normalize_title(title)
        norm_capacity = normalize_capacity(capacity)
        now = self._clock.now()

        room = self._insert_room_with_unique_code(norm_title, norm_capacity, now)
        host_orm, token = create_participant_record(
            self._session, room, host_nickname, host_avatar, host_intro_tag, ParticipantRole.HOST, now
        )
        self._session.commit()
        self._runtime_store.touch(room.id, now)
        return CreateRoomResult(
            room=_to_room_snapshot(room), host=participant_to_snapshot(host_orm), host_token=token
        )

    def _insert_room_with_unique_code(self, title: str, capacity: int, now: datetime) -> RoomORM:
        """코드 후보를 만들어 INSERT부터 시도하고, UNIQUE 위반이면 재시도한다(SELECT-then-INSERT 레이스 회피)."""
        for _ in range(ROOM_CODE_MAX_RETRIES):
            code = generate_room_code(self._rng)
            room = RoomORM(code=code, title=title, capacity=capacity, status=RoomStatus.WAITING, created_at=now)
            self._session.add(room)
            try:
                self._session.flush()
                return room
            except IntegrityError:
                self._session.rollback()
        raise RoomCodeExhaustedError("방 코드를 발급하지 못했습니다. 다시 시도해주세요.")

    def get_room_status(self, code: str) -> RoomStatus:
        return self._get_room_by_code_or_raise(code).status

    def check_start_eligibility(self, room_id: int) -> StartEligibility:
        """최소 인원과 전원 준비 완료 여부를 함께 판정한다. (F-206/207, G-3)"""
        room = self._get_room_by_id_or_raise(room_id)
        active = [p for p in room.participants if p.status == ParticipantStatus.ACTIVE]
        total_count = len(active)
        ready_flags = self._runtime_store.get_ready_flags(room_id)
        ready_count = sum(1 for p in active if ready_flags.get(p.id, False))

        if total_count < MIN_CAPACITY:
            return StartEligibility(False, f"{MIN_CAPACITY}명 이상 모여야 시작할 수 있어요.", ready_count, total_count)

        active_ids = [p.id for p in active]
        if not is_all_ready(ready_flags, active_ids):
            remaining = total_count - ready_count
            return StartEligibility(False, f"{remaining}명이 아직 준비하지 않았어요.", ready_count, total_count)

        return StartEligibility(True, None, ready_count, total_count)

    def mark_in_game(self, room_id: int, actor_participant_id: int) -> RoomSnapshot:
        # actor_participant_id는 방장 권한 확인용으로 남겨둔다 - 실제 "언제 시작할지"는
        # 게임 선택 모듈(착수 순서 2~4번)이 호출 전에 이미 방장인지 확인했다고 가정한다.
        return self._transition(room_id, RoomStatus.IN_GAME)

    def mark_result(self, room_id: int) -> RoomSnapshot:
        return self._transition(room_id, RoomStatus.RESULT)

    def return_to_waiting(self, room_id: int, actor_participant_id: int) -> RoomSnapshot:
        return self._transition(room_id, RoomStatus.WAITING)

    def _transition(self, room_id: int, target: RoomStatus) -> RoomSnapshot:
        room = self._get_room_by_id_or_raise(room_id)
        assert_transition_allowed(room.status, target)
        room.status = target
        self._session.commit()
        self._runtime_store.touch(room_id, self._clock.now())
        return _to_room_snapshot(room)

    def sweep_expired_rooms(self, now: datetime) -> list[int]:
        """10분 이상 활동이 없는 방을 찾아 삭제하고, 삭제된 room_id 목록을 반환한다. (F-210, D-13)"""
        cutoff = timedelta(minutes=ROOM_INACTIVITY_MINUTES)
        expired_ids = []
        for room in self._session.execute(select(RoomORM)).scalars():
            last_activity = self._runtime_store.get_last_activity(room.id) or room.created_at
            if now - last_activity >= cutoff:
                expired_ids.append(room.id)

        for room_id in expired_ids:
            self.delete_room(room_id)
        return expired_ids

    def delete_room(self, room_id: int) -> None:
        room = self._session.get(RoomORM, room_id)
        if room is not None:
            self._session.delete(room)
            self._session.commit()
        self._runtime_store.purge_room(room_id)

    def _get_room_by_code_or_raise(self, code: str) -> RoomORM:
        room = self._session.execute(select(RoomORM).where(RoomORM.code == code)).scalar_one_or_none()
        if room is None:
            raise RoomNotFoundError("없는 방이에요.")
        return room

    def _get_room_by_id_or_raise(self, room_id: int) -> RoomORM:
        room = self._session.get(RoomORM, room_id)
        if room is None:
            raise RoomNotFoundError("없는 방이에요.")
        return room
