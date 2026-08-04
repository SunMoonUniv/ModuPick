"""REST 6종 계약 테스트.

docs/07_api/02_rest.md의 응답 규약과 docs/10_glossary/02_error_codes.md의 에러 코드를
그대로 검증한다. 슬라이스를 끝낼 때마다 해당 항목을 켠다.
"""

import uuid

import pytest

from tests.conftest import (
    MEMBER_ID_RE,
    auth,
    code_of,
    confirm,
    create_room,
    data_of,
    join,
)


# ── 1. POST /api/rooms ─────────────────────────────────────────────────────


class TestCreateRoom:
    def test_봉투와_필드(self, client):
        r = client.post("/api/rooms", json={"roomName": "4조 스터디", "maxMembers": 4})
        assert r.status_code == 201
        body = r.json()
        assert body["success"] is True
        assert body["code"] == "ok"
        assert body["message"] is None
        assert body["timestamp"].endswith("Z")

        d = body["data"]
        assert len(d["code"]) == 6 and d["code"].isdigit()
        assert d["displayCode"] == f"MODU-{d['code']}"
        assert MEMBER_ID_RE.match(d["memberId"])
        assert d["memberStatus"] == "PENDING"
        assert d["isHost"] is True
        assert d["expiresAt"].endswith("Z")

    def test_내부_PK를_노출하지_않는다(self, client):
        d = create_room(client)
        assert not d["memberId"].isdigit()
        assert "id" not in d

    @pytest.mark.parametrize(
        ("length", "expected"),
        [(1, 201), (30, 201), (31, 400)],
    )
    def test_방_제목_길이_경계(self, client, length, expected):
        r = client.post("/api/rooms", json={"roomName": "가" * length})
        assert r.status_code == expected, r.text
        if expected == 400:
            assert code_of(r) == "common.validation_failed"

    def test_제목을_비우면_기본값(self, client):
        assert create_room(client, roomName=None)["roomName"] == "ModuPick 방"
        assert create_room(client, roomName="   ")["roomName"] == "ModuPick 방"

    def test_정원_생략하면_10(self, client):
        assert create_room(client)["maxMembers"] == 10

    @pytest.mark.parametrize(("capacity", "expected"), [(2, 201), (10, 201), (1, 400), (11, 400)])
    def test_정원_범위(self, client, capacity, expected):
        r = client.post("/api/rooms", json={"maxMembers": capacity})
        assert r.status_code == expected, r.text


# ── 멱등 ───────────────────────────────────────────────────────────────────


class TestIdempotency:
    def test_같은_키_같은_본문은_최초_응답을_재현한다(self, client):
        key = str(uuid.uuid4())
        payload = {"roomName": "재전송", "maxMembers": 4}
        first = client.post("/api/rooms", json=payload, headers={"Idempotency-Key": key})
        again = client.post("/api/rooms", json=payload, headers={"Idempotency-Key": key})
        assert again.status_code == first.status_code
        assert data_of(again)["code"] == data_of(first)["code"]

    def test_같은_키_다른_본문은_거절한다(self, client):
        key = str(uuid.uuid4())
        client.post("/api/rooms", json={"roomName": "가"}, headers={"Idempotency-Key": key})
        r = client.post("/api/rooms", json={"roomName": "나"}, headers={"Idempotency-Key": key})
        assert r.status_code == 409
        assert code_of(r) == "common.idempotency_conflict"

    def test_키가_없어도_처리한다(self, client):
        assert client.post("/api/rooms", json={}).status_code == 201


# ── 2. GET /api/rooms/{code} ───────────────────────────────────────────────


class TestLookupRoom:
    def test_대기중인_방(self, client):
        room = create_room(client, maxMembers=4)
        d = data_of(client.get(f"/api/rooms/{room['code']}"))
        assert d["roomStatus"] == "WAITING"
        assert d["maxMembers"] == 4
        assert d["currentMembers"] == 1
        assert d["hostNickname"] is None

    def test_방장이_프로필을_확정하면_닉네임이_보인다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        d = data_of(client.get(f"/api/rooms/{room['code']}"))
        assert d["hostNickname"] == "지호"

    def test_없는_코드(self, client):
        r = client.get("/api/rooms/000001")
        assert r.status_code == 404
        assert code_of(r) == "room.not_found"

    def test_형식이_틀린_코드도_없는_방으로_본다(self, client):
        assert client.get("/api/rooms/ABC123").status_code == 404


# ── 3. POST /api/rooms/{code}/members ──────────────────────────────────────


class TestJoin:
    def test_슬롯_선점(self, client):
        room = create_room(client, maxMembers=4)
        d = join(client, room["code"])
        assert d["memberStatus"] == "PENDING"
        assert d["isHost"] is False
        assert d["currentMembers"] == 2

    def test_정원은_PENDING을_포함해_센다(self, client):
        """프로필을 아직 채우지 않은 사람도 자리를 차지한다."""
        room = create_room(client, maxMembers=2)
        join(client, room["code"])  # 아무도 프로필을 확정하지 않았다
        r = client.post(f"/api/rooms/{room['code']}/members")
        assert r.status_code == 409
        assert code_of(r) == "room.full"

    def test_가득_찬_방은_조회에서도_막힌다(self, client):
        room = create_room(client, maxMembers=2)
        join(client, room["code"])
        r = client.get(f"/api/rooms/{room['code']}")
        assert r.status_code == 409
        assert code_of(r) == "room.full"


# ── 인증 ───────────────────────────────────────────────────────────────────


class TestAuth:
    def test_헤더가_없으면_401(self, client):
        room = create_room(client)
        r = client.get(f"/api/rooms/{room['code']}/avatars")
        assert r.status_code == 401
        assert code_of(r) == "common.unauthenticated"

    def test_Bearer가_아니면_401(self, client):
        room = create_room(client)
        r = client.get(
            f"/api/rooms/{room['code']}/avatars",
            headers={"Authorization": room["memberToken"]},
        )
        assert code_of(r) == "common.unauthenticated"

    def test_모르는_토큰은_401(self, client):
        room = create_room(client)
        r = client.get(f"/api/rooms/{room['code']}/avatars", headers=auth("bogus-token"))
        assert r.status_code == 401
        assert code_of(r) == "common.session_expired"

    def test_다른_방의_토큰은_통하지_않는다(self, client):
        a = create_room(client)
        b = create_room(client)
        r = client.get(f"/api/rooms/{b['code']}/avatars", headers=auth(a["memberToken"]))
        assert r.status_code == 401
        assert code_of(r) == "common.session_expired"


# ── 4. GET /api/rooms/{code}/avatars ───────────────────────────────────────


class TestAvatars:
    def test_30종_전량(self, client):
        room = create_room(client)
        d = data_of(client.get(f"/api/rooms/{room['code']}/avatars", headers=auth(room["memberToken"])))
        assert d["totalCount"] == 30
        assert d["content"][0]["avatarId"] == "A01"
        assert d["content"][-1]["avatarId"] == "A30"
        assert all(not a["taken"] for a in d["content"])

    def test_선점은_프로필_확정_시점에_굳는다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호", avatarId="A06")
        d = data_of(client.get(f"/api/rooms/{room['code']}/avatars", headers=auth(room["memberToken"])))
        taken = [a for a in d["content"] if a["taken"]]
        assert [a["avatarId"] for a in taken] == ["A06"]
        assert taken[0]["takenBy"] == "지호"

    def test_takenBy는_닉네임이며_식별자가_아니다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호", avatarId="A06")
        d = data_of(client.get(f"/api/rooms/{room['code']}/avatars", headers=auth(room["memberToken"])))
        for slot in d["content"]:
            assert set(slot) == {"avatarId", "taken", "takenBy"}


# ── 5. PATCH /api/rooms/{code}/members/me ──────────────────────────────────


class TestConfirmProfile:
    def test_ACTIVE_전이(self, client):
        room = create_room(client)
        d = data_of(confirm(client, room["code"], room["memberToken"],
                            nickname="지호", avatarId="A06", bio="프론트 담당"))
        assert d["memberStatus"] == "ACTIVE"
        assert d["nickname"] == "지호"
        assert d["avatarId"] == "A06"
        assert d["bio"] == "프론트 담당"
        assert d["isHost"] is True
        assert d["joinOrder"] == 1

    def test_두_번_확정할_수_없다(self, client):
        room = create_room(client)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        r = confirm(client, room["code"], room["memberToken"], nickname="다시")
        assert r.status_code == 409
        assert code_of(r) == "member.already_active"

    def test_닉네임_중복은_접미로_해소한다(self, client):
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        guest = join(client, room["code"])
        d = data_of(confirm(client, room["code"], guest["memberToken"], nickname="지호"))
        assert d["nickname"] == "지호2"
        assert d["joinOrder"] == 2

    def test_대소문자만_다른_닉네임도_중복이다(self, client):
        """active_nickname이 LOWER(TRIM(...))이라 Jiho와 jiho가 같은 방에 공존하지 못한다."""
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="Jiho")
        guest = join(client, room["code"])
        d = data_of(confirm(client, room["code"], guest["memberToken"], nickname="jiho"))
        assert d["nickname"] == "jiho2"

    def test_앞뒤_공백도_중복_판정에_들어간다(self, client):
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호")
        guest = join(client, room["code"])
        d = data_of(confirm(client, room["code"], guest["memberToken"], nickname="  지호  "))
        assert d["nickname"] == "지호2"

    def test_아바타를_생략하면_서버가_배정한다(self, client):
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호", avatarId="A06")
        guest = join(client, room["code"])
        d = data_of(confirm(client, room["code"], guest["memberToken"], nickname="서연"))
        assert d["avatarId"] != "A06"
        assert d["avatarId"] in {f"A{i:02d}" for i in range(1, 31)}

    @pytest.mark.parametrize("nickname", ["", "   ", "가" * 9])
    def test_닉네임_규칙_위반(self, client, nickname):
        room = create_room(client)
        r = confirm(client, room["code"], room["memberToken"], nickname=nickname)
        assert r.status_code == 400
        assert code_of(r) in {"member.nickname_invalid", "common.validation_failed"}

    def test_닉네임_8자는_통과한다(self, client):
        room = create_room(client)
        d = data_of(confirm(client, room["code"], room["memberToken"], nickname="가" * 8))
        assert d["nickname"] == "가" * 8

    def test_없는_아바타(self, client):
        room = create_room(client)
        r = confirm(client, room["code"], room["memberToken"], nickname="지호", avatarId="A31")
        assert r.status_code == 400
        assert code_of(r) == "member.avatar_invalid"

    def test_선점된_아바타(self, client):
        room = create_room(client, maxMembers=4)
        confirm(client, room["code"], room["memberToken"], nickname="지호", avatarId="A06")
        guest = join(client, room["code"])
        r = confirm(client, room["code"], guest["memberToken"], nickname="서연", avatarId="A06")
        assert r.status_code == 409
        assert code_of(r) == "member.avatar_taken"

    @pytest.mark.parametrize(("length", "expected"), [(24, 200), (25, 400)])
    def test_소개_길이_경계(self, client, length, expected):
        room = create_room(client)
        r = confirm(client, room["code"], room["memberToken"], nickname="지호", bio="가" * length)
        assert r.status_code == expected, r.text
        if expected == 400:
            assert code_of(r) == "member.bio_too_long"

    def test_소개는_비워도_된다(self, client):
        room = create_room(client)
        assert data_of(confirm(client, room["code"], room["memberToken"], nickname="지호"))["bio"] is None


# ── 6. DELETE /api/rooms/{code}/members/me ─────────────────────────────────


class TestLeave:
    def test_참가자_이탈은_자리를_돌려준다(self, client):
        room = create_room(client, maxMembers=2)
        guest = join(client, room["code"])
        r = client.delete(f"/api/rooms/{room['code']}/members/me", headers=auth(guest["memberToken"]))
        assert r.status_code == 204
        assert not r.content
        assert data_of(client.get(f"/api/rooms/{room['code']}"))["currentMembers"] == 1

    def test_이탈하면_토큰이_죽는다(self, client):
        room = create_room(client, maxMembers=2)
        guest = join(client, room["code"])
        client.delete(f"/api/rooms/{room['code']}/members/me", headers=auth(guest["memberToken"]))
        r = client.get(f"/api/rooms/{room['code']}/avatars", headers=auth(guest["memberToken"]))
        assert r.status_code == 401

    def test_방장이_나가면_방이_사라진다(self, client):
        room = create_room(client, maxMembers=4)
        guest = join(client, room["code"])
        r = client.delete(f"/api/rooms/{room['code']}/members/me", headers=auth(room["memberToken"]))
        assert r.status_code == 204
        assert client.get(f"/api/rooms/{room['code']}").status_code == 404
        # 남은 참가자의 토큰도 함께 무효가 된다
        assert client.get(
            f"/api/rooms/{room['code']}/avatars", headers=auth(guest["memberToken"])
        ).status_code == 401

    def test_마지막_참가자가_나가도_방이_사라진다(self, client):
        room = create_room(client)
        client.delete(f"/api/rooms/{room['code']}/members/me", headers=auth(room["memberToken"]))
        assert client.get(f"/api/rooms/{room['code']}").status_code == 404
