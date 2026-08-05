"""소켓 연결·스냅샷·명단 이벤트 계약 테스트.

연결 직후 순서를 검증한다.

    accept -> (3초 안) conn:auth -> 인증 -> room:snapshot 1회 -> 부분 갱신
"""

from tests.conftest import (
    auth,
    confirm,
    connected,
    create_room,
    join,
)
from tests.conftest import expect_close as _expect_close
from tests.conftest import send_auth as _send_auth


# ── 인증 ───────────────────────────────────────────────────────────────────


class TestHandshake:
    def test_인증_성공하면_스냅샷이_온다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], room["memberToken"])
            msg = ws.receive_json()
            assert msg["event"] == "room:snapshot"
            assert msg["success"] is True
            assert msg["code"] == "ok"
            assert msg["timestamp"].endswith("Z")

    def test_인증_전_다른_이벤트는_규약_위반(self, client):
        room = create_room(client)
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            ws.send_json({"event": "chat:send", "data": {"text": "먼저 말 걸기"}})
            err = ws.receive_json()
            assert err["event"] == "error"
            assert err["code"] == "common.protocol_violation"
            _expect_close(ws, 4002)

    def test_지원하지_않는_프로토콜_버전(self, client):
        room = create_room(client)
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], room["memberToken"], version=99)
            err = ws.receive_json()
            assert err["code"] == "common.protocol_unsupported"
            _expect_close(ws, 4002)

    def test_모르는_토큰(self, client):
        room = create_room(client)
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], "bogus-token")
            err = ws.receive_json()
            assert err["code"] == "common.session_expired"
            _expect_close(ws, 4401)

    def test_경로와_페이로드의_방_코드가_다르면_거절(self, client):
        room = create_room(client)
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], room["memberToken"], room_code="000000")
            assert ws.receive_json()["code"] == "common.session_expired"
            _expect_close(ws, 4401)

    def test_다른_방의_토큰(self, client):
        a = create_room(client)
        b = create_room(client)
        with client.websocket_connect(f"/ws/rooms/{b['code']}") as ws:
            _send_auth(ws, b["code"], a["memberToken"])
            assert ws.receive_json()["code"] == "common.session_expired"
            _expect_close(ws, 4401)

    def test_같은_토큰의_두_번째_연결은_거부하고_기존을_유지한다(self, client):
        """재접속 불가의 소켓 층 구현이다. 두 화면에서 동시에 입력하는 경로가 닫힌다."""
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        with connected(client, room["code"], room["memberToken"]) as (first, _):
            with client.websocket_connect(f"/ws/rooms/{room['code']}") as second:
                _send_auth(second, room["code"], room["memberToken"])
                second.receive_json()
                _expect_close(second, 4409)
            # 기존 소켓은 살아 있다 — 새 참가자 입장이 여전히 도달한다
            guest = join(client, room["code"])
            confirm(client, room["code"], guest["memberToken"], nickname="서연")
            assert first.receive_json()["event"] == "member:joined"

    def test_형식이_깨진_프레임(self, client):
        room = create_room(client)
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            ws.send_text("이건 JSON이 아니다")
            assert ws.receive_json()["code"] == "common.protocol_violation"
            _expect_close(ws, 4002)

    def test_인증_타임아웃(self, client, monkeypatch):
        from app.ws import router

        monkeypatch.setattr(router, "AUTH_TIMEOUT_S", 0.05)
        room = create_room(client)
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _expect_close(ws, 4408)


# ── 스냅샷 ─────────────────────────────────────────────────────────────────


class TestSnapshot:
    def test_방과_나와_명단을_담는다(self, client):
        room = create_room(client, roomName="4조 스터디", maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호", avatarId="A06")
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], room["memberToken"])
            d = ws.receive_json()["data"]

        assert d["room"]["code"] == room["code"]
        assert d["room"]["displayCode"] == f"MODU-{room['code']}"
        assert d["room"]["roomName"] == "4조 스터디"
        assert d["room"]["roomStatus"] == "WAITING"
        assert d["room"]["hostMemberId"] == room["memberId"]
        assert d["me"]["memberStatus"] == "ACTIVE"
        assert d["me"]["isHost"] is True
        assert d["members"][0]["nickname"] == "지호"
        assert d["members"][0]["joinOrder"] == 1
        assert d["game"] is None
        assert d["serverTime"].endswith("Z")

    def test_PENDING은_명단에_없지만_소켓은_붙는다(self, client):
        """가입 직후 프로필 화면에 머무는 구간이다. 소켓은 살아 있고 명단에는 없다."""
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        guest = join(client, room["code"])

        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], guest["memberToken"])
            d = ws.receive_json()["data"]

        assert d["me"]["memberStatus"] == "PENDING"
        assert [m["nickname"] for m in d["members"]] == ["지호"]

    def test_내부_PK를_담지_않는다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], room["memberToken"])
            d = ws.receive_json()["data"]
        assert d["me"]["memberId"].startswith("mbr_")
        assert all(m["memberId"].startswith("mbr_") for m in d["members"])


# ── 명단 이벤트 ────────────────────────────────────────────────────────────


class TestMemberEvents:
    def test_프로필_확정이_member_joined를_발행한다(self, client):
        """소켓 연결이 아니라 ACTIVE 전이 시점이다."""
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        with connected(client, room["code"], room["memberToken"]) as (ws, snapshot):
            before = snapshot["data"]["roomVersion"]
            guest = join(client, room["code"])
            confirm(client, room["code"], guest["memberToken"], nickname="서연", avatarId="A02")

            msg = ws.receive_json()
            assert msg["event"] == "member:joined"
            assert msg["data"]["member"]["nickname"] == "서연"
            assert msg["data"]["member"]["avatarId"] == "A02"
            assert msg["data"]["member"]["joinOrder"] == 2
            assert msg["data"]["roomVersion"] == before + 1

    def test_가입만으로는_아무_이벤트도_없다(self, client):
        """슬롯 선점은 명단에 보이지 않는다."""
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            join(client, room["code"])
            # 다음 이벤트는 가입이 아니라 그 뒤의 프로필 확정이어야 한다
            guest2 = join(client, room["code"])
            confirm(client, room["code"], guest2["memberToken"], nickname="하늘")
            assert ws.receive_json()["data"]["member"]["nickname"] == "하늘"

    def test_참가자_이탈은_member_left(self, client):
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        guest = join(client, room["code"])
        confirm(client, room["code"], guest["memberToken"], nickname="서연")

        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            client.delete(
                f"/api/rooms/{room['code']}/members/me", headers=auth(guest["memberToken"])
            )
            msg = ws.receive_json()
            assert msg["event"] == "member:left"
            assert msg["data"]["memberId"] == guest["memberId"]
            assert msg["data"]["reason"] == "LEAVE"
            assert msg["data"]["activeCount"] == 1

    def test_방장_이탈은_room_closed와_소켓_종료(self, client):
        """방장이 나간 경우는 member:left가 아니다. 방이 사라졌다는 사실이 먼저다."""
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        guest = join(client, room["code"])
        confirm(client, room["code"], guest["memberToken"], nickname="서연")

        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], guest["memberToken"])
            ws.receive_json()  # snapshot

            client.delete(
                f"/api/rooms/{room['code']}/members/me", headers=auth(room["memberToken"])
            )
            msg = ws.receive_json()
            assert msg["event"] == "room:closed"
            assert msg["data"]["reason"] == "HOST_LEFT"
            _expect_close(ws, 4410)

    def test_roomVersion은_상태가_바뀔_때마다_오른다(self, client):
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        with connected(client, room["code"], room["memberToken"]) as (ws, snapshot):
            versions = [snapshot["data"]["roomVersion"]]
            for nickname in ("서연", "하늘"):
                g = join(client, room["code"])
                confirm(client, room["code"], g["memberToken"], nickname=nickname)
                versions.append(ws.receive_json()["data"]["roomVersion"])
            assert versions == sorted(set(versions))
            assert versions[-1] - versions[0] == 2


# ── 게임 진행 중 ───────────────────────────────────────────────────────────


class TestPlayingRoom:
    def test_알_수_없는_이벤트는_개인_error로_돌려주고_연결을_유지한다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:action", "data": {}})
            err = ws.receive_json()
            assert err["event"] == "error"
            assert err["data"]["event"] == "game:action"
            # 연결은 살아 있다
            ws.send_json({"event": "game:action", "data": {}})
            assert ws.receive_json()["event"] == "error"

    def test_진행_중인_방에는_새_소켓이_붙지_않는다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        # 게임 시작은 아직 없으므로 상태를 직접 옮겨 검증한다
        import pymysql

        from tests.conftest import _dsn

        conn = pymysql.connect(**_dsn())
        try:
            with conn.cursor() as cur:
                cur.execute("UPDATE rooms SET status='playing' WHERE code=%s", (room["code"],))
            conn.commit()
        finally:
            conn.close()

        with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
            _send_auth(ws, room["code"], room["memberToken"])
            assert ws.receive_json()["code"] == "room.already_playing"
            _expect_close(ws, 4401)


class TestHandlerFailure:
    def test_핸들러_결함이_사람을_쫓아내지_않는다(self, client, monkeypatch):
        """예외가 serve()까지 오르면 소켓이 조용히 닫히고 이탈로 이어진다."""
        from app.services import chat_service

        async def boom(**kwargs):
            raise RuntimeError("일부러 낸 결함")

        monkeypatch.setattr(chat_service, "send", boom)

        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "chat:send", "data": {"text": "안녕"}})
            err = ws.receive_json()
            assert err["event"] == "error"
            assert err["code"] == "common.internal"
            assert err["data"]["event"] == "chat:send"

            # 연결은 살아 있다
            ws.send_json({"event": "game:action", "data": {}})
            assert ws.receive_json()["code"] == "game.invalid_action"
