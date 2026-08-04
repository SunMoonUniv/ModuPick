"""이탈 유예·확정·강퇴 계약 테스트.

**소켓이 끊긴 것과 사람이 방을 떠난 것은 다르다.** 그 차이가 이 파일의 주제다.

    종료 코드 1000  ->  유예 없이 즉시 확정 (나가기 버튼)
    그 밖의 종료    ->  의심(UNSTABLE) -> 유예 만료 -> 확정
    강퇴            ->  유예 없이 즉시 확정

유예는 30초·60초라 실제로 기다리면 테스트가 성립하지 않는다. 설정값이므로 낮춘다 —
**상수로 박혀 있었다면 이 검증 자체가 불가능하다.**
"""

import pytest

from app.config import settings
from tests.conftest import (
    confirm,
    connected,
    join,
    member_room,
    send_auth,
)


@pytest.fixture
def fast_grace(monkeypatch):
    """유예를 50밀리초로 줄인다. 값이 설정으로 빠져 있어 가능한 검증이다."""
    monkeypatch.setattr(settings, "grace_member_s", 0.05)
    monkeypatch.setattr(settings, "grace_host_s", 0.05)
    yield


def _drain(ws, event: str, *, tries: int = 6) -> dict:
    for _ in range(tries):
        frame = ws.receive_json()
        if frame["event"] == event:
            return frame
    pytest.fail(f"{event}가 오지 않았다")


def _expect_closed(ws, code: int) -> None:
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as exc:
        for _ in range(6):
            ws.receive_json()
    assert exc.value.code == code


# ── 즉시 확정 ──────────────────────────────────────────────────────────────


class TestImmediateLeave:
    def test_코드_1000은_유예_없이_확정된다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.close(1000)
                left = _drain(host_ws, "member:left")

        assert left["data"]["memberId"] == member["memberId"]
        assert left["data"]["reason"] == "LEAVE"
        assert left["data"]["activeCount"] == 1

    def test_즉시_확정에는_UNSTABLE이_끼지_않는다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.close(1000)
                first = host_ws.receive_json()
        assert first["event"] == "member:left"

    def test_방장이_1000으로_닫으면_방이_닫힌다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
            with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
                host_ws.close(1000)
                closed = _drain(guest_ws, "room:closed")
                assert closed["data"]["reason"] == "HOST_LEFT"
                _expect_closed(guest_ws, 4410)

        assert client.get(f"/api/rooms/{room['code']}").status_code == 404


# ── 유예 ───────────────────────────────────────────────────────────────────


class TestGrace:
    def test_비정상_종료는_의심으로_들어간다(self, client, fast_grace):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.close(1001)  # 브라우저가 페이지를 떠남
                conn_ev = _drain(host_ws, "member:connection")
                left = _drain(host_ws, "member:left")

        assert conn_ev["data"]["memberId"] == member["memberId"]
        assert conn_ev["data"]["state"] == "UNSTABLE"
        assert conn_ev["data"]["graceEndsAt"].endswith("Z")
        # 유예가 끝나면 확정된다
        assert left["data"]["reason"] == "DISCONNECT"

    def test_의심에_들어가면_준비가_해제된다(self, client, fast_grace):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.send_json({"event": "member:ready", "data": {"ready": True}})
                on = _drain(host_ws, "member:ready_changed")
                assert on["data"]["readyCount"] == 1

                guest_ws.close(1001)
                off = _drain(host_ws, "member:ready_changed")

        assert off["data"]["ready"] is False
        assert off["data"]["readyCount"] == 0
        # **activeCount에는 남는다.** 둘 다에서 빼면 없는 셈 치고 게임이 시작된다
        assert off["data"]["activeCount"] == 2

    def test_유예_만료로_슬롯이_풀린다(self, client, fast_grace):
        """정원이 찬 방에서 확정 전후로 새 참가 가능 여부가 갈린다."""
        room, member = member_room(client, max_members=2)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                full = client.post(f"/api/rooms/{room['code']}/members")
                assert full.json()["code"] == "room.full"

                guest_ws.close(1001)
                _drain(host_ws, "member:left")

            # 확정이 끝나 자리가 났다
            assert client.post(f"/api/rooms/{room['code']}/members").status_code == 201

    def test_방장의_비정상_종료는_유예_뒤_방을_닫는다(self, client, fast_grace):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
            with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
                host_ws.close(1001)
                conn_ev = _drain(guest_ws, "member:connection")
                assert conn_ev["data"]["memberId"] == room["memberId"]
                closed = _drain(guest_ws, "room:closed")
                assert closed["data"]["reason"] == "HOST_LEFT"
                _expect_closed(guest_ws, 4410)

        assert client.get(f"/api/rooms/{room['code']}").status_code == 404

    def test_유예_중에는_명단에_남고_UNSTABLE로_보인다(self, client, monkeypatch):
        # 유예를 길게 잡아 그 구간을 관측한다
        monkeypatch.setattr(settings, "grace_member_s", 30.0)
        room, member = member_room(client, max_members=4)
        third = join(client, room["code"])
        confirm(client, room["code"], third["memberToken"], nickname="민준")

        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], third["memberToken"]) as (third_ws, _):
                third_ws.close(1001)
                _drain(host_ws, "member:connection")

                # 뒤늦게 붙은 소켓의 스냅샷에도 그 표시가 실린다
                with connected(client, room["code"], member["memberToken"]) as (_, snapshot):
                    by_id = {m["memberId"]: m for m in snapshot["data"]["members"]}

        assert third["memberId"] in by_id
        assert by_id[third["memberId"]]["connection"] == "UNSTABLE"
        assert by_id[room["memberId"]]["connection"] == "ONLINE"

    def test_유예_중에도_같은_토큰의_새_소켓은_거부된다(self, client, monkeypatch):
        """유예를 두어도 재접속은 여전히 불가하다.

        유예는 자리를 지켜 주는 장치가 아니라 이탈 확정의 부작용을 늦추는 장치다.
        여기를 열면 그것이 곧 재접속이 된다.
        """
        monkeypatch.setattr(settings, "grace_member_s", 30.0)
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.close(1001)
                _drain(host_ws, "member:connection")

            with client.websocket_connect(f"/ws/rooms/{room['code']}") as again:
                send_auth(again, room["code"], member["memberToken"])
                err = again.receive_json()
                assert err["event"] == "error"
                assert err["code"] == "common.session_expired"
                _expect_closed(again, 4401)


# ── 강퇴 ───────────────────────────────────────────────────────────────────


class TestKick:
    def test_대상은_4403으로_닫히고_나머지는_member_left를_받는다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                host_ws.send_json(
                    {"event": "member:kick", "data": {"memberId": member["memberId"]}}
                )
                err = guest_ws.receive_json()
                assert err["event"] == "error"
                assert err["code"] == "member.kicked"
                _expect_closed(guest_ws, 4403)

                left = _drain(host_ws, "member:left")

        assert left["data"]["memberId"] == member["memberId"]
        assert left["data"]["reason"] == "KICK"
        assert left["data"]["activeCount"] == 1

    def test_자기_자신은_내보낼_수_없다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "member:kick", "data": {"memberId": room["memberId"]}})
            err = _drain(ws, "error")
        assert err["code"] == "member.self_kick"

    def test_방장이_아니면_내보낼_수_없다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            ws.send_json({"event": "member:kick", "data": {"memberId": room["memberId"]}})
            err = _drain(ws, "error")
        assert err["code"] == "member.not_host"

    def test_없는_대상은_not_found(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json(
                {"event": "member:kick", "data": {"memberId": "mbr_0000000000000000"}}
            )
            err = _drain(ws, "error")
        assert err["code"] == "member.not_found"

    def test_강퇴된_사람은_같은_코드로_다시_들어온다(self, client):
        """강퇴는 제재가 아니라 반응 없는 사람을 치우는 수단이다."""
        room, member = member_room(client, max_members=4)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                host_ws.send_json(
                    {"event": "member:kick", "data": {"memberId": member["memberId"]}}
                )
                _expect_closed(guest_ws, 4403)
                _drain(host_ws, "member:left")

            again = join(client, room["code"])
            r = confirm(client, room["code"], again["memberToken"], nickname="서연")
            assert r.status_code == 200


# ── PENDING ────────────────────────────────────────────────────────────────


class TestPendingLeave:
    def test_명단에_없던_사람의_퇴장은_알리지_않는다(self, client):
        room, _ = member_room(client, max_members=4)
        pending = join(client, room["code"])

        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], pending["memberToken"]) as (p_ws, _):
                p_ws.close(1000)
            # member:left가 아니라 채팅이 다음 프레임이어야 한다
            host_ws.send_json({"event": "chat:send", "data": {"text": "확인"}})
            frame = _drain(host_ws, "chat:message")
        assert frame["event"] == "chat:message"
