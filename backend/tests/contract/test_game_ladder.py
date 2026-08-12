"""사다리타기 진행 계약 테스트 — 자동 전이 · 전원 배정 · 결과 확정.

    GUIDE(3초) → ARMED(30초) → [START 또는 자동] → DRAWING(진행 속도) → REVEAL(3초) → RESULT

룰렛과 흐름이 같아 겹치는 검사(phaseSeq 단조 증가 · stale · round_not_found)는
test_game_play.py가 이미 본다. 여기서는 **사다리에만 있는 것**을 본다 — 전원 배정 ·
도착 항목의 정규화 · 저장 형식의 optionId · 진행 속도가 연출 길이를 정하는 것.

연출 상수는 monkeypatch로 줄여 돌린다. **값을 줄여도 규칙은 같다** — 순서와 전이
조건이 검증 대상이고 실제 밀리초는 05_game_rules/03_ladder.md가 고정한 상수다.
"""

from datetime import datetime

import pytest

from app.domain.games import ladder
from app.services import game_service
from tests.contract.test_game_play import _result_data, _rows
from tests.contract.test_round import _drain, _room_pk, playing


@pytest.fixture
def fast(monkeypatch):
    """연출 길이를 줄인다. 3초 + 30초 + 3.5초 + 3초를 그대로 기다릴 수는 없다."""
    monkeypatch.setattr(game_service, "GUIDE_MS", 40)
    monkeypatch.setattr(game_service, "ARMED_MS", 30_000)  # 자동 실행은 별도로 본다
    monkeypatch.setattr(game_service, "REVEAL_MS", 40)
    monkeypatch.setattr(ladder, "SPEED_MS", {"FAST": 40, "NORMAL": 40, "SLOW": 40})


def _start(host_ws, started, phase_seq: int) -> None:
    host_ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "ladder.start",
        },
    })


def _to_armed(host_ws) -> dict:
    """READY → GUIDE → ARMED까지 흘려보내고 ARMED 프레임을 돌려준다."""
    _drain(host_ws, "game:phase")  # READY
    guide = _drain(host_ws, "game:phase")
    assert guide["data"]["phase"] == "GUIDE"
    armed = _drain(host_ws, "game:phase")
    assert armed["data"]["phase"] == "ARMED"
    return armed


def _duration_ms(frame: dict) -> int:
    """그 단계의 제한 시간. deadlineAt과 serverTime의 차이다."""
    data = frame["data"]
    deadline = datetime.fromisoformat(data["deadlineAt"].replace("Z", "+00:00"))
    now = datetime.fromisoformat(data["serverTime"].replace("Z", "+00:00"))
    return int((deadline - now).total_seconds() * 1000)


# ── 자동 전이 ──────────────────────────────────────────────────────────────


class TestAutoPhases:
    def test_시작하면_GUIDE를_거쳐_ARMED로_간다(self, client, fast):
        with playing(client, 2, "ladder") as (_room, _members, host_ws, _guests, _started):
            _drain(host_ws, "game:phase")  # READY

            guide = _drain(host_ws, "game:phase")
            assert guide["data"]["phase"] == "GUIDE"

            armed = _drain(host_ws, "game:phase")
            assert armed["data"]["phase"] == "ARMED"
            # **방장이 누르지 않아도 판은 끝난다** — 자동 실행 마감이 걸려 있다
            assert armed["data"]["deadlineAt"] is not None

    def test_ARMED에는_가로선이_아직_없다(self, client, fast):
        """**미리 그리면 결과가 먼저 새어 나간다.** 판정은 START 이후에 돈다."""
        with playing(client, 2, "ladder") as (_room, _members, host_ws, _guests, _started):
            armed = _to_armed(host_ws)
            assert armed["data"]["payload"] is None


# ── 방장 입력 ──────────────────────────────────────────────────────────────


class TestStart:
    def test_START가_판정을_열고_DRAWING으로_간다(self, client, fast):
        with playing(client, 3, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])

            drawing = _drain(host_ws, "game:phase")
            assert drawing["data"]["phase"] == "DRAWING"
            assert drawing["data"]["deadlineAt"] is not None

    def test_DRAWING에_배정과_가로선이_실린다(self, client, fast):
        """**연출 시작 값은 전이와 함께 도착해야 한다.**

        경로가 그려지기 시작하는 순간 어디로 가는지 알아야 하는데 game:result는
        연출이 끝난 뒤에 온다.
        """
        with playing(client, 3, "ladder") as (_room, _members, host_ws, guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])

            payload = _drain(host_ws, "game:phase")["data"]["payload"]
            assert payload is not None
            assert set(payload) == {"assignments", "ladderRungs"}

            # **화면이 경로를 그리려면 도착 컬럼이 필요하다.** optionId는 저장 축이라
            # 연출에는 나가지 않는다.
            assert len(payload["assignments"]) == 3
            for row in payload["assignments"]:
                assert set(row) == {"memberId", "slot", "label"}
            assert all(set(r) == {"row", "leftLane"} for r in payload["ladderRungs"])

            # 전원이 같은 값을 받는다
            _drain(guests[0], "game:started")
            for _ in range(3):
                _drain(guests[0], "game:phase")
            assert _drain(guests[0], "game:phase")["data"]["payload"] == payload

    def test_참여자는_START를_보낼_수_없다(self, client, fast):
        with playing(client, 2, "ladder") as (_room, _members, host_ws, guests, started):
            armed = _to_armed(host_ws)
            guests[0].send_json({
                "event": "game:action",
                "data": {
                    "roundId": started["data"]["roundId"],
                    "phaseSeq": armed["data"]["phaseSeq"],
                    "type": "ladder.start",
                },
            })
            assert _drain(guests[0], "error")["code"] == "member.not_host"

    def test_룰렛의_type은_받지_않는다(self, client, fast):
        with playing(client, 2, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            host_ws.send_json({
                "event": "game:action",
                "data": {
                    "roundId": started["data"]["roundId"],
                    "phaseSeq": armed["data"]["phaseSeq"],
                    "type": "roulette.pick",
                },
            })
            assert _drain(host_ws, "error")["code"] == "game.invalid_action"

    def test_방장이_누르지_않아도_서버가_실행한다(self, client, monkeypatch):
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "ARMED_MS", 60)  # 자동 실행 마감
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)
        monkeypatch.setattr(ladder, "SPEED_MS", {"FAST": 40, "NORMAL": 40, "SLOW": 40})

        with playing(client, 2, "ladder") as (_room, _members, host_ws, _guests, started):
            _to_armed(host_ws)
            # START를 보내지 않는다
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "DRAWING"
            _drain(host_ws, "game:result", tries=12)
            assert _result_data(started["data"]["roundId"]) is not None


# ── 진행 속도 ──────────────────────────────────────────────────────────────


class TestSpeed:
    """**진행 속도는 애니메이션 길이만 바꾸고 결과에 영향을 주지 않는다.**"""

    @pytest.mark.parametrize(("speed", "expected"), [
        ("FAST", 2000), ("NORMAL", 3500), ("SLOW", 5000),
    ])
    def test_속도가_DRAWING_길이를_정한다(self, client, monkeypatch, speed, expected):
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)

        with playing(client, 2, "ladder", {"speed": speed}) as (
            _room, _members, host_ws, _guests, started,
        ):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])

            drawing = _drain(host_ws, "game:phase")
            assert drawing["data"]["phase"] == "DRAWING"
            # 전송 지연이 끼므로 폭으로 본다. 세 값의 간격이 1.5초라 겹치지 않는다.
            assert expected - 500 <= _duration_ms(drawing) <= expected


# ── 결과 ───────────────────────────────────────────────────────────────────


class TestResult:
    def test_REVEAL을_거쳐_RESULT와_game_result가_나온다(self, client, fast):
        with playing(client, 2, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])

            assert _drain(host_ws, "game:phase")["data"]["phase"] == "DRAWING"
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "REVEAL"

            result_phase = _drain(host_ws, "game:phase")
            assert result_phase["data"]["phase"] == "RESULT"
            # **결과 단계에는 마감이 없다** — 방장의 round:close를 기다린다
            assert result_phase["data"]["deadlineAt"] is None

            frame = _drain(host_ws, "game:result")
            assert frame["data"]["gameId"] == "ladder"
            assert frame["data"]["variant"] == "ASSIGN"

    def test_와이어_모양이_정본과_같다(self, client, fast):
        """07_api/03 §17의 ASSIGN 행이다. 저장 형식과 다른 모양이다."""
        with playing(client, 4, "ladder") as (_room, _members, host_ws, _guests, started):
            roster = [m["memberId"] for m in started["data"]["roster"]]
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            result = _drain(host_ws, "game:result")["data"]["result"]

            assert set(result) == {"topic", "pairs", "seed", "stats"}
            # 「주제 템플릿 4계열」의 B 계열 기본값이다
            assert result["topic"] == "조별과제"
            assert 0 <= result["seed"] < 2**64

            # **전원이 배정된다.** 1인 선정이 아니다
            assert [p["memberId"] for p in result["pairs"]] == roster
            assert all(set(p) == {"memberId", "itemLabel"} for p in result["pairs"])
            # optionId는 저장 축이라 화면에 나가지 않는다
            assert all("optionId" not in p for p in result["pairs"])

    def test_배정이_1대1_대응이다(self, client, fast):
        """**서로 다른 참가자가 같은 항목에 도착하지 않는다.**"""
        with playing(client, 6, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            pairs = _drain(host_ws, "game:result")["data"]["result"]["pairs"]

            assert len({p["memberId"] for p in pairs}) == 6
            data = _result_data(started["data"]["roundId"])
            assert len({a["optionId"] for a in data["assignments"]}) == 6

    def test_요약_수치_3개가_단위까지_붙어_온다(self, client, fast):
        """08_screen/06_result.md 「배정형」의 배정 인원 · 역할 항목 수 · 진행 속도."""
        with playing(client, 4, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            stats = _drain(host_ws, "game:result")["data"]["result"]["stats"]

            assert [s["label"] for s in stats] == ["배정 인원", "역할 항목", "진행 속도"]
            assert stats[0]["value"] == "4명"
            # 기본 항목은 조별과제 세트 6개다. **정규화 뒤 개수가 아니라 설정 원본이다**
            assert stats[1]["value"] == "6개"
            assert stats[2]["value"] == "보통"

    def test_전원이_같은_결과를_받는다(self, client, fast):
        with playing(client, 2, "ladder") as (_room, _members, host_ws, guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            mine = _drain(host_ws, "game:result")
            theirs = _drain(guests[0], "game:result")
            assert theirs["data"] == mine["data"]


# ── 도착 항목 ──────────────────────────────────────────────────────────────


class TestItems:
    def test_항목이_모자라면_X로_채운다(self, client, fast):
        """D-32. **배정이 누락된 것이 아니라 채워진 것임을 구분해야 한다.**"""
        with playing(client, 4, "ladder", {"resultItems": ["팀장", "발표"]}) as (
            _room, _members, host_ws, _guests, started,
        ):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            labels = [
                p["itemLabel"]
                for p in _drain(host_ws, "game:result")["data"]["result"]["pairs"]
            ]
            assert sorted(labels) == ["X", "X", "발표", "팀장"]

    def test_항목이_넘치면_뒤에서_자른다(self, client, fast):
        with playing(client, 2, "ladder", {"resultItems": ["하나", "둘", "셋", "넷"]}) as (
            _room, _members, host_ws, _guests, started,
        ):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            labels = [
                p["itemLabel"]
                for p in _drain(host_ws, "game:result")["data"]["result"]["pairs"]
            ]
            assert sorted(labels) == ["둘", "하나"]


# ── 저장 ───────────────────────────────────────────────────────────────────


class TestPersistence:
    def test_저장_형식이_정본과_같다(self, client, fast):
        """06_database/04 「게임별 JSON 스키마」의 사다리 행이다."""
        with playing(client, 3, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            _drain(host_ws, "game:result")

            data = _result_data(started["data"]["roundId"])
            assert data is not None
            assert set(data) == {"schemaVersion", "seed", "assignments", "ladderRungs"}
            assert data["schemaVersion"] == 1
            assert len(data["assignments"]) == 3

            # **저장은 optionId로 항목을 가리킨다.** slot은 연출 축이라 남지 않는다
            for row in data["assignments"]:
                assert set(row) == {"memberId", "optionId", "label"}
                assert row["optionId"].startswith("opt_")

    def test_도착_항목이_game_options에_남는다(self, client, fast):
        """06_database/04 「저장 범위」가 사다리를 '도착 항목(참가자 참조 없음)'으로
        규정한다. **participant_id가 NULL이라는 것이 룰렛과의 차이다.**"""
        with playing(client, 3, "ladder") as (_room, _members, _host_ws, _guests, started):
            rows = _rows(
                "SELECT o.option_id, o.label, o.sort_order, o.participant_id"
                " FROM game_options o JOIN game_rounds g ON g.id = o.game_round_id"
                " WHERE g.round_id = %s ORDER BY o.sort_order",
                (started["data"]["roundId"],),
            )
            assert len(rows) == 3  # 참가자 수에 맞춰 잘렸다
            assert [r["sort_order"] for r in rows] == [0, 1, 2]
            assert [r["label"] for r in rows] == ["팀장", "자료 조사", "PPT 제작"]
            assert all(r["participant_id"] is None for r in rows)
            assert all(r["option_id"].startswith("opt_") for r in rows)

    def test_저장된_optionId가_실제_행을_가리킨다(self, client, fast):
        """**저장 형식의 optionId는 sort_order로 조인해 채운다.** 도착 컬럼이 그
        행의 sort_order와 같은 축이라는 것이 그 근거다."""
        with playing(client, 3, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            drawing = _drain(host_ws, "game:phase")
            _drain(host_ws, "game:result")

            rows = _rows(
                "SELECT o.option_id, o.label, o.sort_order"
                " FROM game_options o JOIN game_rounds g ON g.id = o.game_round_id"
                " WHERE g.round_id = %s",
                (started["data"]["roundId"],),
            )
            by_id = {r["option_id"]: r for r in rows}
            slot_of = {
                a["memberId"]: a["slot"] for a in drawing["data"]["payload"]["assignments"]
            }

            for row in _result_data(started["data"]["roundId"])["assignments"]:
                option = by_id[row["optionId"]]
                assert option["label"] == row["label"]
                # 연출에 나간 slot과 저장의 sort_order가 같은 축이다
                assert option["sort_order"] == slot_of[row["memberId"]]

    def test_저장된_시드로_결과가_재현된다(self, client, fast):
        """판정 함수는 시각을 읽지 않는다. 같은 시드·같은 명단이면 언제나 같다."""
        import json

        from app.domain.games.contract import JudgeContext

        with playing(client, 4, "ladder") as (_room, _members, host_ws, _guests, started):
            roster = [m["memberId"] for m in started["data"]["roster"]]
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            pairs = _drain(host_ws, "game:result")["data"]["result"]["pairs"]

            round_id = started["data"]["roundId"]
            data = _result_data(round_id)
            raw = _rows(
                "SELECT config FROM game_rounds WHERE round_id = %s", (round_id,)
            )[0]["config"]
            config = json.loads(raw) if isinstance(raw, str) else raw

            # 저장된 시드와 저장된 설정만으로 같은 배정이 다시 나온다
            again = ladder.judge(
                JudgeContext(
                    round_id=round_id,
                    game_id="ladder",
                    seed=data["seed"],
                    roster=tuple(roster),
                    config=config,
                )
            )
            assert [a["label"] for a in again.assignments] == [
                p["itemLabel"] for p in pairs
            ]

    def test_저장된_시드가_라운드_시드와_같다(self, client, fast):
        """**다르면 결과 재현이 성립하지 않는다.** 사다리는 자기 검증이 어긋나면
        시드를 다시 뽑으므로 DB 갱신이 빠지면 이 검사가 깨진다."""
        with playing(client, 2, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            _drain(host_ws, "game:result")

            round_id = started["data"]["roundId"]
            stored = _rows(
                "SELECT random_seed FROM game_rounds WHERE round_id = %s", (round_id,)
            )[0]["random_seed"]
            assert _result_data(round_id)["seed"] == stored


# ── 입력 수집 ──────────────────────────────────────────────────────────────


class TestInputCollection:
    def test_START가_판정_함수까지_전달된다(self, client, fast, monkeypatch):
        seen: list = []
        original = ladder.judge

        def spy(ctx, inputs=()):
            seen.extend(inputs)
            return original(ctx, inputs)

        monkeypatch.setattr(ladder, "judge", spy)

        with playing(client, 2, "ladder") as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _start(host_ws, started, armed["data"]["phaseSeq"])
            _drain(host_ws, "game:phase")  # DRAWING

        starts = [i for i in seen if i.kind == "ladder.start"]
        assert len(starts) == 1
        assert starts[0].participant_id == started["data"]["roster"][0]["memberId"]

    def test_자동_실행에는_입력이_없다(self, client, monkeypatch):
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "ARMED_MS", 60)
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)
        monkeypatch.setattr(ladder, "SPEED_MS", {"FAST": 40, "NORMAL": 40, "SLOW": 40})

        seen: list = []
        original = ladder.judge

        def spy(ctx, inputs=()):
            seen.append(list(inputs))
            return original(ctx, inputs)

        monkeypatch.setattr(ladder, "judge", spy)

        with playing(client, 2, "ladder") as (_room, _members, host_ws, _guests, _started):
            _to_armed(host_ws)
            _drain(host_ws, "game:phase", tries=12)  # DRAWING

        assert seen == [[]]
