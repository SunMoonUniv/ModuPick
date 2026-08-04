"""게임 선택·설정 동기화 계약 테스트.

**방장만 바꾸고 전원이 같이 본다.** 참여자 화면은 읽기 전용이지만 실시간으로 함께
바뀌므로, 이 파일의 대부분은 "게스트 소켓에도 같은 프레임이 오는가"를 본다.

설정 규격의 정본은 docs/07_api/03_socket_events.md의 configSchema 표(16개 항목)다.
"""

import pytest

from app.domain import game_config
from app.domain.enums import MIN_MEMBERS, GameId
from tests.conftest import confirm, connected, create_room, join, member_room


def _drain(ws, event: str, *, tries: int = 6) -> dict:
    for _ in range(tries):
        frame = ws.receive_json()
        if frame["event"] == event:
            return frame
    pytest.fail(f"{event}가 오지 않았다")


def _room_of(client, size: int):
    """방장 + (size-1)명이 프로필까지 확정한 방."""
    room = create_room(client, maxMembers=10)
    confirm(client, room["code"], room["memberToken"], nickname="지호")
    members = []
    for i in range(size - 1):
        m = join(client, room["code"])
        confirm(client, room["code"], m["memberToken"], nickname=f"참가{i}")
        members.append(m)
    return room, members


# ── configSchema 자체 ──────────────────────────────────────────────────────


class TestSchema:
    def test_항목은_16개다(self):
        total = sum(len(fields) for fields in game_config.SCHEMA.values())
        assert total == 16

    def test_6종_전부_규격이_있다(self):
        assert set(game_config.SCHEMA) == set(GameId)

    def test_기본값이_정본과_같다(self):
        assert game_config.defaults(GameId.ROULETTE) == {"topic": "팀장"}
        assert game_config.defaults(GameId.TIMER) == {
            "topic": "팀장", "targetSeconds": 5, "criterion": "CLOSEST",
        }
        assert game_config.defaults(GameId.NUNCHI) == {
            "topic": "팀장", "windowMs": 300, "roundSeconds": 15,
        }
        ladder = game_config.defaults(GameId.LADDER)
        assert ladder["speed"] == "NORMAL"
        assert ladder["resultItems"] == [
            "팀장", "자료 조사", "PPT 제작", "발표", "디자인", "최종 정리",
        ]

    def test_사다리에는_topic이_없다(self):
        """항목 목록 자체가 주제 역할을 한다."""
        assert "topic" not in game_config.defaults(GameId.LADDER)

    def test_기본값을_바꿔도_원본이_안_변한다(self):
        first = game_config.defaults(GameId.LADDER)
        first["resultItems"].append("오염")
        assert len(game_config.defaults(GameId.LADDER)["resultItems"]) == 6


class TestValidation:
    @pytest.mark.parametrize(
        "game,patch",
        [
            (GameId.ROULETTE, {"topic": ""}),
            (GameId.ROULETTE, {"topic": "가" * 13}),
            (GameId.ROULETTE, {"topic": 42}),
            (GameId.ROULETTE, {"없는필드": "값"}),
            (GameId.LADDER, {"speed": "TURBO"}),
            (GameId.LADDER, {"resultItems": []}),
            (GameId.LADDER, {"resultItems": ["가" * 13]}),
            (GameId.LADDER, {"resultItems": "문자열"}),
            (GameId.KINGMAKER, {"votesPerMember": 4}),
            (GameId.KINGMAKER, {"revealAuthors": "true"}),
            (GameId.TIMER, {"targetSeconds": 6}),
            (GameId.SNIPE, {"voteSeconds": 4}),
            (GameId.SNIPE, {"voteSeconds": 61}),
            (GameId.SNIPE, {"question": "가" * 31}),
            (GameId.NUNCHI, {"windowMs": 400}),
            (GameId.NUNCHI, {"roundSeconds": 12}),
        ],
    )
    def test_규격을_벗어나면_거절한다(self, game, patch):
        from app.domain import errors

        with pytest.raises(errors.DomainError) as exc:
            game_config.merge(game, game_config.defaults(game), patch)
        assert exc.value.spec.code == "game.invalid_config"

    def test_불리언을_정수_열거에_넣을_수_없다(self):
        """파이썬에서 True는 1이다. 검사 순서가 틀리면 통과한다."""
        from app.domain import errors

        with pytest.raises(errors.DomainError):
            game_config.merge(
                GameId.KINGMAKER, game_config.defaults(GameId.KINGMAKER),
                {"votesPerMember": True},
            )

    def test_부분_갱신이라_나머지는_유지된다(self):
        base = game_config.defaults(GameId.SNIPE)
        once = game_config.merge(GameId.SNIPE, base, {"voteSeconds": 30})
        twice = game_config.merge(GameId.SNIPE, once, {"multiVote": True})
        assert twice["voteSeconds"] == 30
        assert twice["multiVote"] is True
        assert twice["question"] == base["question"]

    def test_사다리_항목_중복은_허용한다(self):
        merged = game_config.merge(
            GameId.LADDER, game_config.defaults(GameId.LADDER),
            {"resultItems": ["청소", "청소", "청소"]},
        )
        assert merged["resultItems"] == ["청소", "청소", "청소"]

    def test_항목_개수는_막지_않는다(self):
        """참가자 수에 맞추는 일은 게임 시작 시점에 서버가 한다."""
        merged = game_config.merge(
            GameId.LADDER, game_config.defaults(GameId.LADDER), {"resultItems": ["하나"]},
        )
        assert merged["resultItems"] == ["하나"]


# ── game:select ────────────────────────────────────────────────────────────


class TestSelect:
    def test_전원이_같은_game_selected를_받는다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                host_ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
                mine = _drain(host_ws, "game:selected")
                theirs = _drain(guest_ws, "game:selected")

        assert mine["data"]["gameId"] == "roulette"
        assert mine["data"]["config"] == {"topic": "팀장"}
        assert mine["data"]["configSchemaVersion"] == 1
        assert theirs["data"] == mine["data"]

    def test_상태_이벤트라_roomVersion이_오른다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, snapshot):
            before = snapshot["data"]["roomVersion"]
            ws.send_json({"event": "game:select", "data": {"gameId": "ladder"}})
            after = _drain(ws, "game:selected")["data"]["roomVersion"]
        assert after == before + 1

    def test_방장이_아니면_거절한다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
            err = _drain(ws, "error")
        assert err["code"] == "member.not_host"

    def test_없는_게임은_not_found(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "timecatch"}})
            err = _drain(ws, "error")
        assert err["code"] == "game.not_found"

    def test_인원이_모자라면_not_enough_members(self, client):
        """킹메이커는 3명부터다. 지금은 2명이다."""
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "kingmaker"}})
            err = _drain(ws, "error")
        assert err["code"] == "game.not_enough_members"

    def test_게임을_바꾸면_설정이_기본값으로_돌아간다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "ladder"}})
            _drain(ws, "game:selected")
            ws.send_json({
                "event": "game:config",
                "data": {"gameId": "ladder", "config": {"speed": "FAST"}},
            })
            assert _drain(ws, "game:config_changed")["data"]["config"]["speed"] == "FAST"

            ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
            _drain(ws, "game:selected")
            ws.send_json({"event": "game:select", "data": {"gameId": "ladder"}})
            back = _drain(ws, "game:selected")

        assert back["data"]["config"]["speed"] == "NORMAL"


# ── game:random ────────────────────────────────────────────────────────────


class TestRandom:
    def test_서버가_고른_결과가_전원에게_같다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                host_ws.send_json({"event": "game:random", "data": {}})
                mine = _drain(host_ws, "game:selected")
                theirs = _drain(guest_ws, "game:selected")
        assert mine["data"]["gameId"] in {g.value for g in GameId}
        assert theirs["data"] == mine["data"]

    def test_인원으로_시작할_수_없는_게임은_후보에서_뺀다(self, client):
        """2명이면 최소 3명 게임 3종이 빠진다."""
        room, _ = member_room(client)
        two_player = {g.value for g in GameId if MIN_MEMBERS[g] <= 2}
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            for _ in range(12):
                ws.send_json({"event": "game:random", "data": {}})
                assert _drain(ws, "game:selected")["data"]["gameId"] in two_player

    def test_방장이_아니면_거절한다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], member["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:random", "data": {}})
            assert _drain(ws, "error")["code"] == "member.not_host"


# ── game:config ────────────────────────────────────────────────────────────


class TestConfig:
    def test_참여자_화면도_함께_바뀐다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                host_ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
                _drain(host_ws, "game:selected")
                _drain(guest_ws, "game:selected")

                host_ws.send_json({
                    "event": "game:config",
                    "data": {"gameId": "roulette", "config": {"topic": "발표자"}},
                })
                mine = _drain(host_ws, "game:config_changed")
                theirs = _drain(guest_ws, "game:config_changed")

        assert mine["data"]["config"]["topic"] == "발표자"
        assert theirs["data"] == mine["data"]

    def test_선택_전에는_not_selected(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({
                "event": "game:config",
                "data": {"gameId": "roulette", "config": {"topic": "발표자"}},
            })
            assert _drain(ws, "error")["code"] == "game.not_selected"

    def test_현재_선택과_다른_gameId는_버린다(self, client):
        """디바운스로 늦게 도착한 이전 게임의 변경이 여기서 걸린다."""
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
            _drain(ws, "game:selected")
            ws.send_json({
                "event": "game:config",
                "data": {"gameId": "ladder", "config": {"speed": "FAST"}},
            })
            assert _drain(ws, "error")["code"] == "game.invalid_action"

    def test_규격_위반은_invalid_config(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
            _drain(ws, "game:selected")
            ws.send_json({
                "event": "game:config",
                "data": {"gameId": "roulette", "config": {"topic": "가" * 13}},
            })
            err = _drain(ws, "error")
        assert err["code"] == "game.invalid_config"
        assert err["data"]["event"] == "game:config"

    def test_거절돼도_이전_설정이_남는다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
            _drain(ws, "game:selected")
            ws.send_json({
                "event": "game:config",
                "data": {"gameId": "roulette", "config": {"topic": "발표자"}},
            })
            _drain(ws, "game:config_changed")
            ws.send_json({
                "event": "game:config",
                "data": {"gameId": "roulette", "config": {"topic": ""}},
            })
            _drain(ws, "error")
            ws.send_json({
                "event": "game:config",
                "data": {"gameId": "roulette", "config": {}},
            })
            kept = _drain(ws, "game:config_changed")
        assert kept["data"]["config"]["topic"] == "발표자"

    def test_방장이_아니면_거절한다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            host_ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
            _drain(host_ws, "game:selected")
            with connected(client, room["code"], member["memberToken"]) as (guest_ws, _):
                guest_ws.send_json({
                    "event": "game:config",
                    "data": {"gameId": "roulette", "config": {"topic": "내맘대로"}},
                })
                assert _drain(guest_ws, "error")["code"] == "member.not_host"


# ── 스냅샷 ─────────────────────────────────────────────────────────────────


class TestSnapshot:
    def test_고르기_전에는_game이_null이다(self, client):
        room, _ = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (_, snapshot):
            assert snapshot["data"]["game"] is None

    def test_뒤늦게_붙은_사람도_현재_선택을_본다(self, client):
        room, member = member_room(client)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            host_ws.send_json({"event": "game:select", "data": {"gameId": "timer"}})
            _drain(host_ws, "game:selected")
            host_ws.send_json({
                "event": "game:config",
                "data": {"gameId": "timer", "config": {"targetSeconds": 10}},
            })
            _drain(host_ws, "game:config_changed")

            with connected(client, room["code"], member["memberToken"]) as (_, snapshot):
                game = snapshot["data"]["game"]

        assert game["gameId"] == "timer"
        assert game["config"]["targetSeconds"] == 10
        assert game["configSchemaVersion"] == 1

    def test_인원이_늘면_큰_게임도_고를_수_있다(self, client):
        room, members = _room_of(client, 3)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "kingmaker"}})
            selected = _drain(ws, "game:selected")
        assert selected["data"]["gameId"] == "kingmaker"
        assert selected["data"]["config"]["votesPerMember"] == 1
