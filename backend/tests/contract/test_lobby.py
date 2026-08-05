"""채팅·준비 계약 테스트.

두 이벤트의 성격이 정반대라 함께 둔다.

    chat:message   통지 이벤트 — roomVersion을 올리지 않는다 · 본인 포함 전원
    chat:typing    통지 이벤트 — roomVersion을 올리지 않는다 · **본인 제외**
    ready_changed  상태 이벤트 — roomVersion을 올린다 · 서버가 센 집계를 싣는다
"""

import pytest

from tests.conftest import (
    confirm,
    connected,
    create_room,
    join,
    member_room,
)


def _drain(ws, event: str, *, tries: int = 4) -> dict:
    """원하는 이벤트가 나올 때까지 읽는다. 없으면 실패시킨다."""
    for _ in range(tries):
        frame = ws.receive_json()
        if frame["event"] == event:
            return frame
    pytest.fail(f"{event}가 오지 않았다")


# ── chat:send ──────────────────────────────────────────────────────────────


class TestChatSend:
    def test_보낸_본인도_받는다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.send_json({"event": "chat:send", "data": {"text": "다 모였어요"}})

                mine = _drain(guest_ws, "chat:message")
                theirs = _drain(host_ws, "chat:message")

        assert mine["data"]["text"] == "다 모였어요"
        assert mine["data"]["memberId"] == member["memberId"]
        assert theirs["data"] == mine["data"]

    def test_messageId는_방마다_1부터_증가한다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ids = []
            for text in ("하나", "둘", "셋"):
                ws.send_json({"event": "chat:send", "data": {"text": text}})
                ids.append(_drain(ws, "chat:message")["data"]["messageId"])
        assert ids == ["1", "2", "3"]

    def test_공백만_보내면_아무것도_오지_않는다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "chat:send", "data": {"text": "   \n  "}})
            # 무시된다면 다음 프레임은 뒤이어 보낸 정상 메시지여야 한다
            ws.send_json({"event": "chat:send", "data": {"text": "진짜"}})
            frame = _drain(ws, "chat:message")
        assert frame["data"]["text"] == "진짜"
        assert frame["data"]["messageId"] == "1"

    def test_200자는_통과하고_201자는_거절된다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):

            ws.send_json({"event": "chat:send", "data": {"text": "가" * 200}})
            assert len(_drain(ws, "chat:message")["data"]["text"]) == 200

            ws.send_json({"event": "chat:send", "data": {"text": "가" * 201}})
            err = _drain(ws, "error")
            assert err["code"] == "common.payload_too_large"
            assert err["data"]["event"] == "chat:send"

            # 거절 뒤에도 연결은 살아 있다
            ws.send_json({"event": "chat:send", "data": {"text": "그다음"}})
            assert _drain(ws, "chat:message")["data"]["text"] == "그다음"

    def test_앞뒤_공백을_뗀_길이로_잰다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "chat:send", "data": {"text": "  " + "가" * 200 + "  "}})
            assert len(_drain(ws, "chat:message")["data"]["text"]) == 200

    def test_통지_이벤트라_roomVersion을_올리지_않는다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, snapshot):
            before = snapshot["data"]["roomVersion"]
            ws.send_json({"event": "chat:send", "data": {"text": "안녕"}})
            frame = _drain(ws, "chat:message")
        assert frame["data"]["roomVersion"] == before

    def test_프로필_확정_전에는_보낼_수_없다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        pending = join(client, room["code"])
        with connected(client, room["code"], pending["memberToken"]) as (ws, _):
            ws.send_json({"event": "chat:send", "data": {"text": "저 아직 프로필 안 정했어요"}})
            err = _drain(ws, "error")
        assert err["code"] == "game.invalid_action"


# ── chat:typing ────────────────────────────────────────────────────────────


class TestChatTyping:
    def test_본인은_받지_않고_남은_받는다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.send_json({"event": "chat:typing", "data": {"typing": True}})

                relayed = _drain(host_ws, "chat:typing")
                # 본인에게는 오지 않는다 — 뒤이은 채팅이 먼저 도착하는 것으로 확인한다
                guest_ws.send_json({"event": "chat:send", "data": {"text": "확인"}})
                assert guest_ws.receive_json()["event"] == "chat:message"

        assert relayed["data"]["memberId"] == member["memberId"]
        assert relayed["data"]["typing"] is True

    def test_자격이_없으면_조용히_버린다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        pending = join(client, room["code"])
        with connected(client, room["code"], pending["memberToken"]) as (ws, _):
            ws.send_json({"event": "chat:typing", "data": {"typing": True}})
            # 에러도 오지 않는다. 다음에 보낸 잘못된 이벤트의 error가 첫 프레임이다
            ws.send_json({"event": "game:action", "data": {}})
            frame = ws.receive_json()
        assert frame["event"] == "error"
        assert frame["data"]["event"] == "game:action"


# ── member:ready ───────────────────────────────────────────────────────────


class TestMemberReady:
    def test_참여자_준비는_전원에게_간다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.send_json({"event": "member:ready", "data": {"ready": True}})
                mine = _drain(guest_ws, "member:ready_changed")
                theirs = _drain(host_ws, "member:ready_changed")

        assert mine["data"]["memberId"] == member["memberId"]
        assert mine["data"]["ready"] is True
        assert mine["data"]["readyCount"] == 1
        assert mine["data"]["activeCount"] == 2
        assert theirs["data"] == mine["data"]

    def test_방장은_준비_상태를_갖지_않는다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "member:ready", "data": {"ready": True}})
            err = _drain(ws, "error")
        assert err["code"] == "game.invalid_action"
        assert err["data"]["event"] == "member:ready"

    def test_방장은_activeCount에_들되_readyCount_모수에서_빠진다(self, client):
        """readyCount의 목표치는 activeCount - 1이다."""
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            ws.send_json({"event": "member:ready", "data": {"ready": True}})
            data = _drain(ws, "member:ready_changed")["data"]
        assert data["activeCount"] == 2
        assert data["readyCount"] == data["activeCount"] - 1

    def test_마지막_값이_이긴다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            for value in (True, True, False):
                ws.send_json({"event": "member:ready", "data": {"ready": value}})
                data = _drain(ws, "member:ready_changed")["data"]
        assert data["ready"] is False
        assert data["readyCount"] == 0

    def test_상태_이벤트라_roomVersion이_오른다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, snapshot):
            before = snapshot["data"]["roomVersion"]
            ws.send_json({"event": "member:ready", "data": {"ready": True}})
            after = _drain(ws, "member:ready_changed")["data"]["roomVersion"]
        assert after == before + 1

    def test_프로필_확정_전에는_준비할_수_없다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        pending = join(client, room["code"])
        with connected(client, room["code"], pending["memberToken"]) as (ws, _):
            ws.send_json({"event": "member:ready", "data": {"ready": True}})
            err = _drain(ws, "error")
        assert err["code"] == "game.invalid_action"

    def test_준비한_사람이_나가면_집계에서_빠진다(self, client):
        room, member = member_room(client, max_members=4)
        third = join(client, room["code"])
        confirm(client, room["code"], third["memberToken"], nickname="민준")

        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.send_json({"event": "member:ready", "data": {"ready": True}})
                assert _drain(guest_ws, "member:ready_changed")["data"]["readyCount"] == 1

                # 세 번째 사람이 REST로 이탈하면 명단이 줄어든다
                client.delete(
                    f"/api/rooms/{room['code']}/members/me",
                    headers={"Authorization": f"Bearer {third['memberToken']}"},
                )
                _drain(guest_ws, "member:left")

                guest_ws.send_json({"event": "member:ready", "data": {"ready": True}})
                data = _drain(guest_ws, "member:ready_changed")["data"]

        assert data["activeCount"] == 2
        assert data["readyCount"] == 1

    def test_스냅샷이_준비_상태를_싣는다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            ws.send_json({"event": "member:ready", "data": {"ready": True}})
            _drain(ws, "member:ready_changed")

            # 방장이 뒤늦게 붙어 받은 스냅샷에 그 값이 실려 있어야 한다
            with connected(client, room["code"], room["memberToken"]) as (host_ws, snapshot):
                by_id = {m["memberId"]: m for m in snapshot["data"]["members"]}

        assert by_id[member["memberId"]]["ready"] is True
        assert by_id[room["memberId"]]["ready"] is False


# ── 잘못된 페이로드 ────────────────────────────────────────────────────────


class TestMalformed:
    def test_필드가_빠지면_validation_failed(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            ws.send_json({"event": "member:ready", "data": {}})
            err = _drain(ws, "error")
        assert err["code"] == "common.validation_failed"

    def test_타입이_틀리면_validation_failed(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            ws.send_json({"event": "chat:send", "data": {"text": 42}})
            err = _drain(ws, "error")
        assert err["code"] == "common.validation_failed"
