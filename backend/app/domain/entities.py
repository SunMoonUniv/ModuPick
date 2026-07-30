"""서비스 계층이 주고받는 불변 스냅샷. DB/ORM 세부사항을 감춘 순수 값 객체다."""

from dataclasses import dataclass
from datetime import datetime

from app.domain.enums import ParticipantRole, ParticipantStatus, RoomStatus


@dataclass(frozen=True)
class RoomSnapshot:
    id: int
    code: str
    title: str
    capacity: int
    status: RoomStatus
    created_at: datetime


@dataclass(frozen=True)
class ParticipantSnapshot:
    id: int
    room_id: int
    nickname: str
    avatar: str
    intro_tag: str | None
    role: ParticipantRole
    status: ParticipantStatus
    joined_at: datetime
