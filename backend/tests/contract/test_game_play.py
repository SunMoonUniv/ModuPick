"""룰렛 진행 계약 테스트 — 자동 전이 · 판정 · 결과 확정.

라운드 생명주기(`test_round.py`)와 가르는 축은 "게임마다 다른가"다. 여기서 보는 것은
**룰렛이 어떤 순서로 흐르고 무엇을 남기는가**다.

    GUIDE(3초) → ARMED(30초) → [PICK 또는 자동] → SPINNING(5초) → REVEAL(3초) → RESULT

연출 상수는 monkeypatch로 줄여 돌린다. **값을 줄여도 규칙은 같다** — 순서와 전이
조건이 검증 대상이고 실제 밀리초는 05_game_rules/02_roulette.md가 고정한 상수다.
"""

import json

import pymysql
import pytest

from app.domain.games import roulette
from app.services import game_service
from tests.conftest import _dsn
from tests.contract.test_round import _drain, playing


@pytest.fixture
def fast(monkeypatch):
    """연출 길이를 줄인다. 3초 + 30초 + 5초 + 3초를 그대로 기다릴 수는 없다."""
    monkeypatch.setattr(game_service, "GUIDE_MS", 40)
    monkeypatch.setattr(game_service, "ARMED_MS", 30_000)  # 자동 실행은 별도로 본다
    monkeypatch.setattr(game_service, "REVEAL_MS", 40)
    monkeypatch.setattr(roulette, "SPIN_MS", 40)


def _rows(sql: str, args: tuple) -> list[dict]:
    conn = pymysql.connect(**_dsn())
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(sql, args)
            return list(cur.fetchall())
    finally:
        conn.close()


def _result_data(round_id: str) -> dict | None:
    rows = _rows(
        "SELECT r.result_data FROM game_results r"
        " JOIN game_rounds g ON g.id = r.game_round_id"
        " WHERE g.round_id = %s",
        (round_id,),
    )
    if not rows:
        return None
    raw = rows[0]["result_data"]
    return json.loads(raw) if isinstance(raw, str) else raw


def _pick(host_ws, started, phase_seq: int) -> None:
    host_ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "roulette.pick",
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


# ── 자동 전이 ──────────────────────────────────────────────────────────────


class TestAutoPhases:
    def test_시작하면_GUIDE를_거쳐_ARMED로_간다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, _guests, _started):
            _drain(host_ws, "game:phase")  # READY

            guide = _drain(host_ws, "game:phase")
            assert guide["data"]["phase"] == "GUIDE"
            assert guide["data"]["deadlineAt"] is not None

            armed = _drain(host_ws, "game:phase")
            assert armed["data"]["phase"] == "ARMED"
            # **방장이 누르지 않아도 판은 끝난다** — 자동 실행 마감이 걸려 있다
            assert armed["data"]["deadlineAt"] is not None

    def test_전원이_같은_단계를_같은_순서로_받는다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, guests, _started):
            _drain(guests[0], "game:started")
            for _ in range(3):  # READY · GUIDE · ARMED
                assert _drain(guests[0], "game:phase")["data"] == _drain(
                    host_ws, "game:phase"
                )["data"]

    def test_phaseSeq는_단조_증가한다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, _guests, _started):
            seqs = [_drain(host_ws, "game:phase")["data"]["phaseSeq"] for _ in range(3)]
            assert seqs == [1, 2, 3]


# ── 방장 입력 ──────────────────────────────────────────────────────────────


class TestPick:
    def test_PICK이_판정을_열고_SPINNING으로_간다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])

            spin = _drain(host_ws, "game:phase")
            assert spin["data"]["phase"] == "SPINNING"
            assert spin["data"]["deadlineAt"] is not None

    def test_SPINNING에_winnerIndex가_실린다(self, client, fast):
        """**연출 시작 값은 전이와 함께 도착해야 한다.**

        회전이 시작되는 순간 목표 각도를 알아야 하는데 game:result는 연출이 끝난 뒤에
        온다. 값이 전원에게 같게 도착하지 않으면 화면이 서로 다른 조각에서 멈춘다.
        """
        with playing(client, 3) as (_room, _members, host_ws, guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])

            spin = _drain(host_ws, "game:phase")
            payload = spin["data"]["payload"]
            assert payload is not None
            assert 0 <= payload["winnerIndex"] < 3

            # 전원이 같은 값을 받는다
            _drain(guests[0], "game:started")
            for _ in range(3):
                _drain(guests[0], "game:phase")
            assert _drain(guests[0], "game:phase")["data"]["payload"] == payload

    def test_방장이_아니면_거절한다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, guests, started):
            armed = _to_armed(host_ws)
            guests[0].send_json({
                "event": "game:action",
                "data": {
                    "roundId": started["data"]["roundId"],
                    "phaseSeq": armed["data"]["phaseSeq"],
                    "type": "roulette.pick",
                },
            })
            assert _drain(guests[0], "error")["code"] == "member.not_host"

    def test_지난_단계의_입력은_stale_phase다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"] - 1)
            assert _drain(host_ws, "error")["code"] == "game.stale_phase"

    def test_다른_판의_입력은_round_not_found다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, _guests, _started):
            armed = _to_armed(host_ws)
            host_ws.send_json({
                "event": "game:action",
                "data": {
                    "roundId": "rnd_없는판",
                    "phaseSeq": armed["data"]["phaseSeq"],
                    "type": "roulette.pick",
                },
            })
            assert _drain(host_ws, "error")["code"] == "game.round_not_found"

    def test_게임과_맞지_않는_type은_invalid_action이다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            host_ws.send_json({
                "event": "game:action",
                "data": {
                    "roundId": started["data"]["roundId"],
                    "phaseSeq": armed["data"]["phaseSeq"],
                    "type": "ladder.start",
                },
            })
            assert _drain(host_ws, "error")["code"] == "game.invalid_action"

    def test_연타해도_판정은_한_번만_돈다(self, client, fast):
        """두 번째 PICK은 이미 SPINNING이라 버려진다(멱등)."""
        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            seq = armed["data"]["phaseSeq"]
            _pick(host_ws, started, seq)
            spin = _drain(host_ws, "game:phase")
            assert spin["data"]["phase"] == "SPINNING"

            _pick(host_ws, started, seq)
            # phaseSeq가 이미 밀렸으므로 지난 단계의 입력으로 걸린다
            assert _drain(host_ws, "error")["code"] == "game.stale_phase"

            assert len(_rows(
                "SELECT r.id FROM game_results r JOIN game_rounds g"
                " ON g.id = r.game_round_id WHERE g.round_id = %s",
                (started["data"]["roundId"],),
            )) == 1


# ── 결과 ───────────────────────────────────────────────────────────────────


class TestResult:
    def test_REVEAL을_거쳐_RESULT와_game_result가_나온다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])

            assert _drain(host_ws, "game:phase")["data"]["phase"] == "SPINNING"
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "REVEAL"

            result_phase = _drain(host_ws, "game:phase")
            assert result_phase["data"]["phase"] == "RESULT"
            # **결과 단계에는 마감이 없다** — 방장의 round:close를 기다린다
            assert result_phase["data"]["deadlineAt"] is None

            frame = _drain(host_ws, "game:result")
            assert frame["data"]["gameId"] == "roulette"
            assert frame["data"]["variant"] == "WINNER"
            assert frame["data"]["finishedAt"].endswith("Z")

    def test_와이어_모양이_정본과_같다(self, client, fast):
        """저장 형식과 다른 모양이다. 변환이 한 곳에서만 일어나는지 본다."""
        with playing(client, 3) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])
            frame = _drain(host_ws, "game:result")

            result = frame["data"]["result"]
            assert set(result) == {"topic", "winnerMemberId", "detail", "stats"}
            assert result["topic"] == "팀장"
            assert result["winnerMemberId"].startswith("mbr_")
            assert 0 <= result["detail"]["seed"] < 2**64
            assert len(result["detail"]["sliceOrder"]) == 3

            # **저장 이름이 와이어에 새지 않는다.** wheelOrder는 저장 쪽 이름이고
            # winnerIndex는 연출 시작 값이라 game:phase에 실린다.
            assert "wheelOrder" not in result["detail"]
            assert "winnerIndex" not in result["detail"]

    def test_요약_수치_3개가_단위까지_붙어_온다(self, client, fast):
        with playing(client, 4) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])
            stats = _drain(host_ws, "game:result")["data"]["result"]["stats"]

            assert [s["label"] for s in stats] == ["참가자 수", "당첨 확률", "결정까지"]
            assert stats[0]["value"] == "4명"
            assert stats[1]["value"] == "25.0%"
            assert stats[2]["value"].endswith("초")

    def test_승자가_명단_안에_있다(self, client, fast):
        with playing(client, 3) as (_room, _members, host_ws, _guests, started):
            roster = [m["memberId"] for m in started["data"]["roster"]]
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])
            result = _drain(host_ws, "game:result")["data"]["result"]

            assert result["winnerMemberId"] in roster
            assert result["detail"]["sliceOrder"] == roster

    def test_전원이_같은_결과를_받는다(self, client, fast):
        with playing(client, 2) as (_room, _members, host_ws, guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])
            mine = _drain(host_ws, "game:result")
            theirs = _drain(guests[0], "game:result")
            assert theirs["data"] == mine["data"]


# ── 저장 ───────────────────────────────────────────────────────────────────


class TestPersistence:
    def test_저장_형식이_정본과_같다(self, client, fast):
        """06_database/04 「게임별 JSON 스키마」의 룰렛 행이다."""
        with playing(client, 3) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])
            _drain(host_ws, "game:result")

            data = _result_data(started["data"]["roundId"])
            assert data is not None
            assert set(data) == {"schemaVersion", "seed", "winnerMemberIds", "wheelOrder"}
            assert data["schemaVersion"] == 1
            assert len(data["winnerMemberIds"]) == 1
            assert len(data["wheelOrder"]) == 3

    def test_저장된_시드가_라운드_시드와_같다(self, client, fast):
        """**다르면 결과 재현이 성립하지 않는다.**"""
        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])
            _drain(host_ws, "game:result")

            round_id = started["data"]["roundId"]
            stored = _rows(
                "SELECT random_seed FROM game_rounds WHERE round_id = %s", (round_id,)
            )[0]["random_seed"]
            assert _result_data(round_id)["seed"] == stored

    def test_저장된_시드로_결과가_재현된다(self, client, fast):
        """판정 함수는 시각을 읽지 않는다. 같은 시드·같은 명단이면 언제나 같다."""
        from app.domain.games.contract import JudgeContext

        with playing(client, 4) as (_room, _members, host_ws, _guests, started):
            armed = _to_armed(host_ws)
            _pick(host_ws, started, armed["data"]["phaseSeq"])
            result = _drain(host_ws, "game:result")["data"]["result"]
            data = _result_data(started["data"]["roundId"])

            again = roulette.judge(
                JudgeContext(
                    round_id=started["data"]["roundId"],
                    game_id="roulette",
                    seed=data["seed"],
                    roster=tuple(data["wheelOrder"]),
                )
            )
            assert again.winner == result["winnerMemberId"]

    def test_참가자_후보가_game_options에_남는다(self, client, fast):
        """06_database/04 「저장 범위」가 룰렛을 '참가자 후보 1인 1행'으로 규정한다."""
        with playing(client, 3) as (_room, _members, _host_ws, _guests, started):
            rows = _rows(
                "SELECT o.option_id, o.label, o.sort_order, o.participant_id"
                " FROM game_options o JOIN game_rounds g ON g.id = o.game_round_id"
                " WHERE g.round_id = %s ORDER BY o.sort_order",
                (started["data"]["roundId"],),
            )
            assert len(rows) == 3
            assert [r["sort_order"] for r in rows] == [0, 1, 2]
            assert [r["label"] for r in rows] == [
                m["nickname"] for m in started["data"]["roster"]
            ]
            assert all(r["option_id"].startswith("opt_") for r in rows)
            assert all(r["participant_id"] is not None for r in rows)


# ── 자동 실행 ──────────────────────────────────────────────────────────────


class TestAutoRun:
    def test_방장이_누르지_않아도_서버가_실행한다(self, client, monkeypatch):
        """**누르지 않으면 영원히 대기하는 것이 프로토타입의 동작이었다.**

        그러면 방이 만료될 때까지 아무도 나가지 못한다. ARMED 진입 30초 뒤 서버가
        대신 판정을 실행한다.
        """
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "ARMED_MS", 60)  # 자동 실행 마감
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)
        monkeypatch.setattr(roulette, "SPIN_MS", 40)

        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            _to_armed(host_ws)
            # PICK을 보내지 않는다
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "SPINNING"
            frame = _drain(host_ws, "game:result", tries=12)
            assert frame["data"]["result"]["winnerMemberId"].startswith("mbr_")
            assert _result_data(started["data"]["roundId"]) is not None
