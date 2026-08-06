"""SQLAlchemy Core 테이블 참조.

**제약을 여기에 다시 적지 않는다.** 스키마 정본은 db_migration/sql이며
CHECK 24 · UNIQUE 15 · FK 9 · VIRTUAL 생성 컬럼 4는 전부 거기 있다. 파이썬으로
옮겨 적으면 옮기다 빠뜨린 것이 조용히 사라지고, 두 곳이 갈라져도 드러나지 않는다.

이 모듈은 컬럼 이름과 타입만 알려 준다 — 쿼리를 조립하기 위한 최소 정보다.

**VIRTUAL 생성 컬럼(active_nickname · active_avatar_id · active_host_guard
· active_round_guard)은 정의하지 않는다.** INSERT·UPDATE 대상이 아니고, 정의하면
실수로 값을 넣는 코드가 나올 수 있다. 그 컬럼들이 강제하는 유일성은 DB가 본다.
"""

from sqlalchemy import Column, MetaData, SmallInteger, String, Table
from sqlalchemy.dialects.mysql import BIGINT, CHAR, JSON, TIMESTAMP

metadata = MetaData()

_PK = BIGINT(unsigned=True)
_TS = TIMESTAMP(fsp=6)


rooms = Table(
    "rooms",
    metadata,
    Column("id", _PK, primary_key=True, autoincrement=True),
    Column("code", CHAR(6), nullable=False),
    Column("room_name", String(30), nullable=False),
    Column("max_members", SmallInteger, nullable=False),
    Column("status", String(20), nullable=False),
    Column("created_at", _TS, nullable=False),
    Column("last_activity_at", _TS, nullable=False),
    Column("expires_at", _TS, nullable=False),
    Column("updated_at", _TS, nullable=False),
)


participants = Table(
    "participants",
    metadata,
    Column("id", _PK, primary_key=True, autoincrement=True),
    Column("member_id", String(40), nullable=False),
    Column("room_id", _PK, nullable=False),
    Column("status", String(10), nullable=False),
    Column("nickname", String(8)),
    Column("avatar_id", CHAR(3)),
    Column("bio", String(24)),
    Column("role", String(10), nullable=False),
    Column("joined_at", _TS, nullable=False),
    Column("pending_expires_at", _TS),
    Column("left_at", _TS),
    Column("updated_at", _TS, nullable=False),
)


game_rounds = Table(
    "game_rounds",
    metadata,
    Column("id", _PK, primary_key=True, autoincrement=True),
    Column("round_id", String(40), nullable=False),
    Column("room_id", _PK, nullable=False),
    Column("game_type", String(30), nullable=False),
    Column("status", String(20), nullable=False),
    Column("config", JSON, nullable=False),
    Column("random_seed", BIGINT(unsigned=True), nullable=False),
    Column("started_by", _PK),
    Column("created_at", _TS, nullable=False),
    Column("started_at", _TS),
    Column("ended_at", _TS),
    Column("ended_reason", String(30)),
    Column("updated_at", _TS, nullable=False),
)


game_options = Table(
    "game_options",
    metadata,
    Column("id", _PK, primary_key=True, autoincrement=True),
    Column("option_id", String(40), nullable=False),
    Column("game_round_id", _PK, nullable=False),
    Column("room_id", _PK, nullable=False),
    Column("participant_id", _PK),
    Column("label", String(120), nullable=False),
    Column("sort_order", SmallInteger, nullable=False),
)


votes = Table(
    "votes",
    metadata,
    Column("id", _PK, primary_key=True, autoincrement=True),
    Column("game_round_id", _PK, nullable=False),
    Column("room_id", _PK, nullable=False),
    Column("voter_participant_id", _PK, nullable=False),
    Column("game_option_id", _PK, nullable=False),
    Column("ballot_no", SmallInteger, nullable=False),
    Column("choice_no", SmallInteger, nullable=False),
    Column("created_at", _TS, nullable=False),
)


game_results = Table(
    "game_results",
    metadata,
    Column("id", _PK, primary_key=True, autoincrement=True),
    Column("game_round_id", _PK, nullable=False),
    Column("result_data", JSON, nullable=False),
    Column("created_at", _TS, nullable=False),
)


#: 기동 시 존재를 확인할 업무 테이블. alembic_version 같은 관리 테이블은 없다.
BUSINESS_TABLES: tuple[str, ...] = (
    "rooms",
    "participants",
    "game_rounds",
    "game_options",
    "votes",
    "game_results",
)
