"""테스트 공용 픽스처. 실제 PostgreSQL 없이 SQLite in-memory로 서비스 계층을 검증한다."""

import random
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.infra.db.base import Base
from app.infra.memory.runtime_store import InMemoryRoomRuntimeStore
from app.services.participant_service import ParticipantService
from app.services.room_service import RoomService


class FixedClock:
    """실시간 대기 없이 시간 경과(예: 10분 무활동 만료)를 테스트하기 위한 가짜 시계."""

    def __init__(self, now: datetime):
        self._now = now

    def now(self) -> datetime:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)


@pytest.fixture
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db_session = factory()
    try:
        yield db_session
    finally:
        db_session.close()


@pytest.fixture
def clock():
    return FixedClock(datetime(2026, 7, 30, 12, 0, 0))


@pytest.fixture
def rng():
    return random.Random(0)


@pytest.fixture
def runtime_store():
    return InMemoryRoomRuntimeStore()


@pytest.fixture
def room_service(session, runtime_store, clock, rng):
    return RoomService(session, runtime_store, clock, rng)


@pytest.fixture
def participant_service(session, runtime_store, clock):
    return ParticipantService(session, runtime_store, clock)
