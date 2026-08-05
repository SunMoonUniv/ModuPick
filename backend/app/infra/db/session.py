"""DB 엔진과 트랜잭션 경계.

쓰기 순서는 예외 없이 이렇다.

    1. 형식·길이 검증          (트랜잭션 밖)
    2. 트랜잭션 시작
         경합 행 잠금 (rooms -> game_rounds -> participants -> game_options -> votes)
         상태·권한·정원 재검증   <- 잠금 이후에 다시 본다
         영속 쓰기
       커밋
    3. 메모리 갱신
    4. 브로드캐스트

**트랜잭션 안에서 소켓 전송·외부 호출·대기를 하지 않는다.** 커밋이 실패했는데
전송이 이미 나가 있으면 되돌릴 수 없다.

**잠금 순서를 뒤집지 않는다.** 건너뛰는 것은 되지만 뒤로 돌아가는 것은 안 된다.
"""

import asyncio
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import TypeVar

from sqlalchemy import event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.config import settings

T = TypeVar("T")

#: 재시도 대상 MySQL 오류. 1213 deadlock · 1205 lock wait timeout.
_RETRYABLE_ERRNOS = frozenset({1213, 1205})

#: 교착·잠금 대기 초과 시 트랜잭션 전체를 다시 돌리는 횟수.
MAX_TX_RETRIES = 3


engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=10,
    max_overflow=10,
    echo=False,
)


@event.listens_for(engine.sync_engine, "connect")
def _init_connection(dbapi_connection, connection_record) -> None:  # noqa: ANN001
    """새 연결마다 세션 시간대를 UTC로 고정한다.

    서버 전역이 +00:00이어도(docker-compose의 --default-time-zone) 여기서 다시
    박는다. 운영 DB가 다르게 떠 있으면 저장·표시 시각이 통째로 밀리는데, 그 실패는
    조용해서 한참 뒤에야 드러난다.
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("SET SESSION time_zone = '+00:00'")
    finally:
        cursor.close()


def _is_retryable(exc: OperationalError) -> bool:
    args = getattr(exc.orig, "args", ())
    return bool(args) and args[0] in _RETRYABLE_ERRNOS


@asynccontextmanager
async def transaction() -> AsyncIterator[AsyncConnection]:
    """쓰기 트랜잭션. 블록을 정상 종료하면 커밋하고 예외가 나면 롤백한다."""
    async with engine.begin() as conn:
        yield conn


@asynccontextmanager
async def readonly() -> AsyncIterator[AsyncConnection]:
    """잠금이 필요 없는 조회. 트랜잭션을 열지 않는다."""
    async with engine.connect() as conn:
        yield conn


async def run_in_transaction(
    fn: Callable[[AsyncConnection], Awaitable[T]],
    *,
    retries: int = MAX_TX_RETRIES,
) -> T:
    """교착·잠금 대기 초과면 트랜잭션 **전체를** 짧은 무작위 지연과 함께 재시도한다.

    부분 재시도를 하지 않는 이유는 잠금을 이미 놓친 상태에서 이어 붙이면 잠금 순서가
    깨지기 때문이다.
    """
    last: OperationalError | None = None
    for attempt in range(retries):
        try:
            async with engine.begin() as conn:
                return await fn(conn)
        except OperationalError as exc:
            if not _is_retryable(exc):
                raise
            last = exc
            if attempt < retries - 1:
                await asyncio.sleep(random.uniform(0.01, 0.05) * (attempt + 1))
    assert last is not None
    raise last


async def ping() -> bool:
    """DB 연결 확인. readiness가 쓴다."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def missing_tables() -> list[str]:
    """업무 테이블 중 없는 것.

    기동 정리가 모든 방을 DELETE하므로, 스키마가 적용되지 않은 DB에 붙은 채로
    그 절차가 도는 것을 막는다. Alembic 리비전 대조를 두지 않는 대신의 최소 확인이다.
    """
    from app.infra.db.tables import BUSINESS_TABLES

    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT TABLE_NAME FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
            )
        )
        present = {r[0] for r in rows}
    return [t for t in BUSINESS_TABLES if t not in present]


async def dispose() -> None:
    await engine.dispose()
