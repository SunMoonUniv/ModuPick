"""방/참가자 영구 저장 모델. ready 상태·온라인 여부처럼 순간의 값은 여기 두지 않는다(memory/runtime_store.py)."""

from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import ParticipantRole, ParticipantStatus, RoomStatus
from app.infra.db.base import Base


class RoomORM(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(20))
    capacity: Mapped[int]
    status: Mapped[RoomStatus] = mapped_column(SAEnum(RoomStatus), default=RoomStatus.WAITING)
    created_at: Mapped[datetime]

    participants: Mapped[list["ParticipantORM"]] = relationship(
        back_populates="room", cascade="all, delete-orphan"
    )


class ParticipantORM(Base):
    __tablename__ = "participants"
    # 닉네임 중복은 서비스 계층(resolve_nickname_collision)에서 먼저 해소하지만,
    # 동시 요청 레이스에 대비한 안전망으로 DB에도 제약을 걸어둔다.
    __table_args__ = (UniqueConstraint("room_id", "nickname", name="uq_participant_room_nickname"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    nickname: Mapped[str] = mapped_column(String(8))
    avatar: Mapped[str] = mapped_column(String(32))
    intro_tag: Mapped[str | None] = mapped_column(String(20), nullable=True)
    role: Mapped[ParticipantRole] = mapped_column(SAEnum(ParticipantRole))
    status: Mapped[ParticipantStatus] = mapped_column(
        SAEnum(ParticipantStatus), default=ParticipantStatus.ACTIVE
    )
    joined_at: Mapped[datetime]
    # 원문 토큰은 저장하지 않는다 - 강퇴 재입장 차단(rejoin_token)용 해시만 둔다.
    session_token_hash: Mapped[str] = mapped_column(String(64))

    room: Mapped["RoomORM"] = relationship(back_populates="participants")
