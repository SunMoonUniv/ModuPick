"""계약 테스트 공용 설비.

**실제 MySQL 8.4에 붙어 돈다.** 제약이 실제로 걸리는지가 이 제품의 첫 관문이고,
가짜 DB로는 VIRTUAL 생성 컬럼 위의 UNIQUE도 복합 FK도 확인할 수 없다.

    docker compose up -d       먼저 DB를 띄운다
    .venv/bin/pytest tests     그다음 돌린다

TestClient는 앱을 직접 호출하므로 uvicorn을 따로 띄우지 않는다. lifespan도 실행되어
기동 시 테이블 확인이 함께 검증된다.
"""

import re
from contextlib import contextmanager
from urllib.parse import unquote, urlparse

import pymysql
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.main import app


def _dsn() -> dict:
    """config의 SQLAlchemy DSN을 PyMySQL 인자로 바꾼다."""
    url = urlparse(settings.database_url.replace("mysql+aiomysql://", "mysql://"))
    return {
        "host": url.hostname or "127.0.0.1",
        "port": url.port or 3306,
        "user": unquote(url.username or ""),
        "password": unquote(url.password or ""),
        "database": (url.path or "/").lstrip("/"),
    }


def _truncate() -> None:
    """방을 전부 지운다. 하위 5테이블은 CASCADE로 함께 사라진다."""
    conn = pymysql.connect(**_dsn())
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM rooms")
        conn.commit()
    finally:
        conn.close()


@pytest.fixture(scope="session")
def client():
    _truncate()
    with TestClient(app) as c:
        yield c
    _truncate()


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    """테스트마다 호출 상한 카운터를 비운다.

    상한이 IP 단위라 TestClient의 모든 요청이 한 통에 들어간다. 비우지 않으면
    조회를 쓰는 테스트가 늘어날 때마다 무관한 테스트가 429로 깨진다.
    """
    from app.api.deps import lookup_limiter

    lookup_limiter.reset()
    yield


@pytest.fixture
def clean():
    """방이 남아 있으면 안 되는 테스트가 쓴다."""
    _truncate()
    yield
    _truncate()


# ── 응답 헬퍼 ──────────────────────────────────────────────────────────────


def data_of(response) -> dict:
    return response.json()["data"]


def code_of(response) -> str:
    return response.json()["code"]


def create_room(client, **kwargs) -> dict:
    """방을 만들고 data를 돌려준다."""
    payload = {"roomName": kwargs.pop("roomName", "테스트 방"), **kwargs}
    r = client.post("/api/rooms", json=payload)
    assert r.status_code == 201, r.text
    return data_of(r)


def join(client, code: str) -> dict:
    r = client.post(f"/api/rooms/{code}/members")
    assert r.status_code == 201, r.text
    return data_of(r)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def confirm(client, code: str, token: str, **profile):
    return client.patch(
        f"/api/rooms/{code}/members/me",
        json={"nickname": profile.pop("nickname", "참가자"), **profile},
        headers=auth(token),
    )


#: 외부 식별자 형식. schema.sql의 CHECK와 같은 정규식이다.
MEMBER_ID_RE = re.compile(r"^mbr_[0-9A-Za-z]{16,36}$")


# ── 소켓 헬퍼 ──────────────────────────────────────────────────────────────


def send_auth(ws, code, token, *, version=1, room_code=None):
    ws.send_json(
        {
            "event": "conn:auth",
            "data": {
                "protocolVersion": version,
                "roomCode": room_code or code,
                "memberToken": token,
            },
        }
    )


def expect_close(ws, code: int) -> None:
    with pytest.raises(WebSocketDisconnect) as exc:
        ws.receive_json()
    assert exc.value.code == code


@contextmanager
def connected(client, code, token):
    """인증까지 마치고 스냅샷을 받은 소켓.

    반드시 with으로 쓴다 — TestClient의 소켓 컨텍스트는 종료 시 백그라운드 스레드를
    정리하므로, close()만 부르고 빠져나오면 스레드가 쌓여 뒤 테스트가 멈춘다.
    """
    with client.websocket_connect(f"/ws/rooms/{code}") as ws:
        send_auth(ws, code, token)
        snapshot = ws.receive_json()
        assert snapshot["event"] == "room:snapshot"
        yield ws, snapshot


def member_room(client, *, nickname="지호", guest="서연", max_members=4):
    """방장 + 참여자 한 명이 프로필까지 확정한 방.

    준비·채팅 검증은 최소 두 사람이 있어야 성립한다.
    """
    room = create_room(client, maxMembers=max_members)
    confirm(client, room["code"], room["memberToken"], nickname=nickname)
    member = join(client, room["code"])
    confirm(client, room["code"], member["memberToken"], nickname=guest)
    return room, member
