"""SQLAlchemy 세션 팩토리. 실제 배포에서는 DATABASE_URL 환경변수로 PostgreSQL을 가리키고,
테스트에서는 이 함수에 sqlite in-memory URL을 직접 넘겨 쓴다."""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def create_session_factory(database_url: str | None = None, **engine_kwargs):
    url = database_url or os.environ.get("DATABASE_URL", "sqlite:///:memory:")
    engine = create_engine(url, **engine_kwargs)
    return sessionmaker(bind=engine, expire_on_commit=False)
