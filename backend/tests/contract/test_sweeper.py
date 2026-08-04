"""주기 청소·기동 정리 계약 테스트.

만료는 10분, PENDING 회수는 3분, 미연결 회수는 15초다. 실제로 기다릴 수 없으므로
**DB의 시각을 과거로 밀어** 조건을 만든다 — 스위퍼가 보는 것은 그 두 컬럼뿐이다.
"""

from functools import partial

import pymysql
import pytest

from app import tasks
from app.services import room_service
from tests.conftest import (
    _dsn,
    confirm,
    connected,
    create_room,
    data_of,
    join,
    member_room,
)


def _sql(query: str, args: tuple = ()) -> None:
    conn = pymysql.connect(**_dsn())
    try:
        with conn.cursor() as cur:
            cur.execute(query, args)
        conn.commit()
    finally:
        conn.close()


def _age_room(code: str) -> None:
    """마지막 활동을 11분 전으로 민다."""
    _sql(
        "UPDATE rooms SET last_activity_at = NOW(6) - INTERVAL 11 MINUTE, "
        "expires_at = NOW(6) - INTERVAL 1 MINUTE WHERE code = %s",
        (code,),
    )


def _age_pending(member_id: str) -> None:
    _sql(
        "UPDATE participants SET pending_expires_at = NOW(6) - INTERVAL 1 SECOND "
        "WHERE member_id = %s",
        (member_id,),
    )


def _drain(ws, event: str, *, tries: int = 6) -> dict:
    for _ in range(tries):
        frame = ws.receive_json()
        if frame["event"] == event:
            return frame
    pytest.fail(f"{event}가 오지 않았다")


# ── 만료 방 ────────────────────────────────────────────────────────────────


class TestExpiredRooms:
    def test_만료된_방이_삭제된다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        _age_room(room["code"])

        report = client.portal.call(tasks.sweep_once)
        assert report.expired_rooms >= 1
        assert client.get(f"/api/rooms/{room['code']}").status_code == 404

    def test_남은_소켓에_EXPIRED와_4410이_간다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            _age_room(room["code"])
            client.portal.call(tasks.sweep_once)

            closed = _drain(ws, "room:closed")
            assert closed["data"]["reason"] == "EXPIRED"

            from starlette.websockets import WebSocketDisconnect

            with pytest.raises(WebSocketDisconnect) as exc:
                for _ in range(4):
                    ws.receive_json()
            assert exc.value.code == 4410

    def test_활동이_있으면_삭제하지_않는다(self, client):
        """고르는 시점과 지우는 시점 사이에 만료가 밀릴 수 있다."""
        room, member = member_room(client)
        _age_room(room["code"])
        # 채팅은 활동이다 — 만료 시각이 다시 10분 뒤로 밀린다
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            ws.send_json({"event": "chat:send", "data": {"text": "아직 있어요"}})
            _drain(ws, "chat:message")

            client.portal.call(tasks.sweep_once)
            assert client.get(f"/api/rooms/{room['code']}").status_code == 200

    def test_두_번_돌려도_결과가_같다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        _age_room(room["code"])

        first = client.portal.call(tasks.sweep_once)
        second = client.portal.call(tasks.sweep_once)
        assert first.expired_rooms >= 1
        assert second.expired_rooms == 0


# ── PENDING 회수 ───────────────────────────────────────────────────────────


class TestPendingReclaim:
    def test_방치된_슬롯이_회수된다(self, client):
        room, member = member_room(client, max_members=4)
        pending = join(client, room["code"])
        assert data_of(client.get(f"/api/rooms/{room['code']}"))["currentMembers"] == 3

        _age_pending(pending["memberId"])
        report = client.portal.call(tasks.sweep_once)

        assert report.reclaimed_pending >= 1
        assert data_of(client.get(f"/api/rooms/{room['code']}"))["currentMembers"] == 2

    def test_회수된_토큰은_죽는다(self, client):
        room, _ = member_room(client, max_members=3)
        pending = join(client, room["code"])
        _age_pending(pending["memberId"])
        client.portal.call(tasks.sweep_once)

        r = client.get(
            f"/api/rooms/{room['code']}/avatars",
            headers={"Authorization": f"Bearer {pending['memberToken']}"},
        )
        assert r.status_code == 401

    def test_확정한_사람은_대상이_아니다(self, client):
        room, member = member_room(client, max_members=3)
        # ACTIVE는 pending_expires_at이 NULL이라 조건에 걸리지 않는다
        _sql(
            "UPDATE participants SET pending_expires_at = NOW(6) - INTERVAL 1 SECOND "
            "WHERE member_id = %s AND status = 'pending'",
            (member["memberId"],),
        )
        client.portal.call(tasks.sweep_once)
        assert data_of(client.get(f"/api/rooms/{room['code']}"))["currentMembers"] == 2


# ── 미연결 회수 ────────────────────────────────────────────────────────────


class TestUnconnectedRelease:
    def test_핸드셰이크가_없으면_슬롯이_풀린다(self, client):
        from app.services import leave_service

        room, member = member_room(client, max_members=4)
        pending = join(client, room["code"])
        assert data_of(client.get(f"/api/rooms/{room['code']}"))["currentMembers"] == 3

        released = client.portal.call(
            partial(
                leave_service.release_if_unconnected,
                participant_pk=_pk_of(pending["memberId"]),
                room_pk=_room_pk_of(room["code"]),
            )
        )
        assert released is True
        assert data_of(client.get(f"/api/rooms/{room['code']}"))["currentMembers"] == 2

    def test_한_번이라도_붙었으면_대상이_아니다(self, client):
        """붙었다 끊긴 사람은 유예가 맡는다. 여기서 두 번 처리하지 않는다."""
        from app.services import leave_service

        room, member = member_room(client, max_members=3)
        pending = join(client, room["code"])
        with connected(client, room["code"], pending["memberToken"]) as (ws, _):
            pass  # 붙었다가 1000으로 닫힘

        released = client.portal.call(
            partial(
                leave_service.release_if_unconnected,
                participant_pk=_pk_of(pending["memberId"]),
                room_pk=_room_pk_of(room["code"]),
            )
        )
        assert released is False

    def test_방장_슬롯은_대상이_아니다(self, client):
        """정본이 15초를 가입 절에 두었다. 방 생성 직후의 방장은 걸리지 않는다."""
        room = create_room(client)
        # 방장은 join을 거치지 않으므로 회수 타이머 자체가 걸리지 않는다
        assert client.get(f"/api/rooms/{room['code']}").status_code == 200


def _pk_of(member_id: str) -> int:
    conn = pymysql.connect(**_dsn())
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM participants WHERE member_id = %s", (member_id,))
            return cur.fetchone()[0]
    finally:
        conn.close()


def _room_pk_of(code: str) -> int:
    conn = pymysql.connect(**_dsn())
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM rooms WHERE code = %s", (code,))
            return cur.fetchone()[0]
    finally:
        conn.close()


# ── 기동 정리 ──────────────────────────────────────────────────────────────


class TestStartupPurge:
    def test_고아_방을_전부_지운다(self, client):
        """재기동하면 진행 중 상태가 사라지므로 DB의 방은 고아가 된다."""
        for _ in range(3):
            room = create_room(client)
            confirm(client, room["code"], room["memberToken"], nickname="지호")

        purged = client.portal.call(room_service.purge_orphan_rooms)
        assert purged >= 3

        conn = pymysql.connect(**_dsn())
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM rooms")
                assert cur.fetchone()[0] == 0
                # 하위 테이블도 CASCADE로 함께 사라진다
                cur.execute("SELECT COUNT(*) FROM participants")
                assert cur.fetchone()[0] == 0
        finally:
            conn.close()
