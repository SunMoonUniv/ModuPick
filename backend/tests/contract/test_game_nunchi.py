"""눈치게임 진행 계약 테스트 — 라운드 반복 · 고립 판정 · 무효 라운드.

    GUIDE(3초) → ROUND(설정) → 판정 → ROUND_RESULT(3초) ┬ safe 0        → 방장이 고른다
                                   ↑                    ├ remain 2 이상 → 다음 ROUND
                                   └────────────────────┤
                                                        └ remain 1 이하 → REVEAL → RESULT

교착 탈출(game:decision_required · game:decide)은 test_game_snipe.py가 이미 본다.
여기서는 **눈치에만 있는 것**을 본다 — 라운드 반복 · 생존자 축소 · 진행 중 집계
비노출 · 안전 확정자의 재입력 차단.

**입력 시각을 벌리려면 실제로 시간이 흘러야 한다.** 고립 판정은 서버 도착 시각의
간격을 보므로 sleep 없이는 전원이 같은 판정창에 묶인다. 판정창을 최소값(0.3초)으로
두고 필요한 만큼만 기다린다.
"""

import time

import pytest

from app.domain.games import nunchi
from app.services import game_service
from app.services.games import nunchi as flow
from tests.contract.test_game_play import _result_data
from tests.contract.test_round import _drain, playing


@pytest.fixture
def fast(monkeypatch):
    """연출을 줄인다. 라운드 마감은 설정값이라 테스트마다 config로 준다."""
    monkeypatch.setattr(game_service, "GUIDE_MS", 40)
    monkeypatch.setattr(game_service, "REVEAL_MS", 40)
    monkeypatch.setattr(nunchi, "ROUND_RESULT_MS", 40)


@pytest.fixture
def short_round(monkeypatch):
    """라운드 마감이 확정을 만드는 것을 보는 테스트가 쓴다.

    제한 시간은 방장 설정(10·15·20초)이라 config로는 줄일 수 없다. **fast 뒤에
    받아야 한다.**
    """
    monkeypatch.setattr(flow, "_round_ms", lambda state: 600)


def _up(ws, started, phase_seq: int) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "nunchi.up",
        },
    })


def _to_round(host_ws) -> dict:
    _drain(host_ws, "game:phase")  # READY
    assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
    frame = _drain(host_ws, "game:phase")
    assert frame["data"]["phase"] == "ROUND"
    return frame


def _catch_up(guests) -> None:
    for g in guests:
        _drain(g, "game:started")
        for _ in range(3):  # READY · GUIDE · ROUND
            _drain(g, "game:phase")


def _sockets(host_ws, guests) -> list:
    return [host_ws, *guests]


def _members(started) -> list[str]:
    return [m["memberId"] for m in started["data"]["roster"]]


def _spread(sockets, started, seq, gap: float = 0.5) -> None:
    """서로 겹치지 않게 순서대로 누른다. 판정창 0.3초보다 넉넉히 벌린다."""
    for i, ws in enumerate(sockets):
        if i:
            time.sleep(gap)
        _up(ws, started, seq)


# ── 자동 전이 ──────────────────────────────────────────────────────────────


class TestAutoPhases:
    def test_시작하면_GUIDE를_거쳐_ROUND로_간다(self, client, fast):
        with playing(client, 3, "nunchi") as (_r, _m, host_ws, _g, _s):
            frame = _to_round(host_ws)
            assert frame["data"]["deadlineAt"] is not None


# ── 입력 규칙 ──────────────────────────────────────────────────────────────


class TestInput:
    def test_진행_중에는_집계가_나가지_않는다(self, client, fast):
        """**누가 이미 눌렀다는 사실 자체가 정답이다**(07_api/03 §14).

        다른 게임은 입력이 도착할 때마다 집계를 보내지만 이 게임만 보내지 않는다.
        """
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, _g, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _up(host_ws, started, seq)

            # 라운드가 아직 살아 있는 동안에는 어떤 프레임도 오지 않는다
            host_ws.send_json({"event": "chat:send", "data": {"text": "누가 눌렀나요"}})
            assert host_ws.receive_json()["event"] == "chat:message"

    def test_같은_라운드에_두_번_누르면_거절한다(self, client, fast):
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, _g, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _up(host_ws, started, seq)
            _up(host_ws, started, seq)
            assert _drain(host_ws, "error")["code"] == "game.already_submitted"


# ── 라운드 반복 ────────────────────────────────────────────────────────────


class TestRounds:
    def test_라운드_결과가_마감_뒤에_나간다(self, client, fast):
        """3명이 충분히 벌려 누르면 전원이 안전 확정되고 가장 늦은 사람이 최후 1인이다."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            _spread(_sockets(host_ws, guests), started, seq)

            progress = _drain(host_ws, "game:progress", tries=12)["data"]
            payload = progress["payload"]
            assert set(payload) == {
                "round", "verdicts", "safeMemberIds",
                "remainingMemberIds", "nextRoundStartsAt",
            }
            assert payload["round"] == 1
            assert len(payload["safeMemberIds"]) == 3
            assert payload["remainingMemberIds"] == []
            # 전원이 안전 확정됐고 가장 늦게 누른 사람이 최후 1인으로 바뀐다
            labels = [v["verdict"] for v in payload["verdicts"]]
            assert sorted(labels) == ["LAST", "SAFE", "SAFE"]
            assert payload["verdicts"][-1]["verdict"] == "LAST"

    def test_겹친_사람만_다음_라운드로_넘어간다(self, client, fast):
        """**혼자 누른 사람이 안전하고 겹친 사람이 남는다**(D-34)."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)

            # 방장만 먼저 혼자, 나머지 둘은 붙여서 누른다
            _up(host_ws, started, seq)
            time.sleep(0.6)
            _up(guests[0], started, seq)
            _up(guests[1], started, seq)

            payload = _drain(host_ws, "game:progress", tries=12)["data"]["payload"]
            members = _members(started)
            assert payload["safeMemberIds"] == [members[0]]
            assert sorted(payload["remainingMemberIds"]) == sorted(members[1:])

            # 생존자가 줄어든 채로 다음 라운드가 열린다
            frame = _drain(host_ws, "game:phase", tries=8)
            assert frame["data"]["phase"] == "ROUND"

            # 안전 확정자는 이번 라운드의 대상이 아니다
            _up(host_ws, started, frame["data"]["phaseSeq"])
            assert _drain(host_ws, "error")["code"] == "game.not_eligible"

    def test_누르지_않으면_남는다(self, client, fast, short_round):
        """미입력은 탈락이 아니다 — 안전 확정되지 못했을 뿐이다."""
        with playing(client, 3, "nunchi") as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            _up(host_ws, started, seq)  # 방장만 누르고 마감을 기다린다

            payload = _drain(host_ws, "game:progress", tries=14)["data"]["payload"]
            members = _members(started)
            assert payload["safeMemberIds"] == [members[0]]
            verdicts = {v["memberId"]: v["verdict"] for v in payload["verdicts"]}
            assert verdicts[members[1]] == "NO_INPUT"
            assert verdicts[members[2]] == "NO_INPUT"
            assert all(
                v["elapsedMs"] is None
                for v in payload["verdicts"]
                if v["verdict"] == "NO_INPUT"
            )


# ── 무효 라운드 ────────────────────────────────────────────────────────────


class TestVoidRound:
    def test_아무도_안전하지_않으면_방장이_고른다(self, client, fast):
        """전원이 같은 판정창에 눌러 생존자 수가 줄지 않았다(D-35)."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            for ws in _sockets(host_ws, guests):  # 벌리지 않고 연달아
                _up(ws, started, seq)

            payload = _drain(host_ws, "game:progress", tries=12)["data"]["payload"]
            assert payload["safeMemberIds"] == []
            assert len(payload["remainingMemberIds"]) == 3

            decision = _drain(host_ws, "game:decision_required", tries=8)["data"]
            assert decision["reason"] == "VOID_ROUND"
            assert decision["options"] == ["RETRY", "ABORT"]
            assert sorted(decision["candidateIds"]) == sorted(_members(started))

    def test_RETRY는_같은_생존자로_다시_연다(self, client, fast):
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            for ws in _sockets(host_ws, guests):
                _up(ws, started, seq)

            decision = _drain(host_ws, "game:decision_required", tries=14)["data"]
            host_ws.send_json({
                "event": "game:decide",
                "data": {
                    "roundId": started["data"]["roundId"],
                    "phaseSeq": decision["phaseSeq"],
                    "choice": "RETRY",
                },
            })

            frame = _drain(host_ws, "game:phase", tries=8)
            assert frame["data"]["phase"] == "ROUND"

            # 생존자가 그대로라 전원이 다시 누를 수 있고, 라운드 번호는 1 오른다
            _spread(_sockets(host_ws, guests), started, frame["data"]["phaseSeq"])
            payload = _drain(host_ws, "game:progress", tries=12)["data"]["payload"]
            assert payload["round"] == 2


# ── 결과 ───────────────────────────────────────────────────────────────────


class TestResult:
    def _decided(self, host_ws, guests, started):
        """3명이 벌려 누르면 한 라운드로 끝난다 — 가장 늦게 누른 사람이 최후 1인."""
        seq = _to_round(host_ws)["data"]["phaseSeq"]
        _catch_up(guests)
        _spread(_sockets(host_ws, guests), started, seq)
        return _drain(host_ws, "game:result", tries=16)["data"]

    def test_와이어_모양이_정본과_같다(self, client, fast):
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            frame = self._decided(host_ws, guests, started)

            assert frame["variant"] == "RECORD"
            result = frame["result"]
            assert set(result) == {"topic", "pickedMemberId", "rounds", "stats"}
            assert result["topic"] == "팀장"
            # 가장 늦게 누른 사람이 뽑힌다
            assert result["pickedMemberId"] == _members(started)[-1]
            assert all(set(r) == {"round", "rows"} for r in result["rounds"])
            assert all(
                set(row) == {"memberId", "verdict", "elapsedMs"}
                for r in result["rounds"]
                for row in r["rows"]
            )

    def test_최후_1인이_LAST로_표시된다(self, client, fast):
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            result = self._decided(host_ws, guests, started)["result"]
            picked = result["pickedMemberId"]
            last_round = result["rounds"][-1]
            verdicts = {row["memberId"]: row["verdict"] for row in last_round["rows"]}
            assert verdicts[picked] == "LAST"

    def test_요약_수치_3개가_단위까지_붙어_온다(self, client, fast):
        """08_screen/06 「기록형」의 라운드 수 · 판정창 · 최종 선정자."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            frame = self._decided(host_ws, guests, started)
            stats = frame["result"]["stats"]

            assert [s["label"] for s in stats] == ["라운드 수", "판정창", "최종 선정"]
            assert stats[0]["value"] == "1판"
            assert stats[1]["value"] == "0.3초"
            # **닉네임으로 내려보낸다** — 서버가 문구까지 확정한다
            picked = frame["result"]["pickedMemberId"]
            nickname = next(
                m["nickname"] for m in started["data"]["roster"]
                if m["memberId"] == picked
            )
            assert stats[2]["value"] == nickname

    def test_저장_형식이_정본과_같다(self, client, fast):
        """06_database/04 「게임별 JSON 스키마」의 눈치게임 행이다."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            self._decided(host_ws, guests, started)

            data = _result_data(started["data"]["roundId"])
            assert set(data) == {
                "schemaVersion", "rounds", "loserMemberIds", "voidRound",
            }
            assert data["voidRound"] is False
            assert len(data["loserMemberIds"]) == 1
            assert all(
                set(r) == {
                    "roundNo", "presses", "safeMemberIds", "remainingMemberIds",
                }
                for r in data["rounds"]
            )

    def test_무효_라운드가_있었으면_결과에_남는다(self, client, fast):
        """**그 라운드도 기록에 남기고 무효였음을 표시한다**(08_screen/06)."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            for ws in _sockets(host_ws, guests):  # 무효 라운드를 만든다
                _up(ws, started, seq)

            decision = _drain(host_ws, "game:decision_required", tries=14)["data"]
            host_ws.send_json({
                "event": "game:decide",
                "data": {
                    "roundId": started["data"]["roundId"],
                    "phaseSeq": decision["phaseSeq"],
                    "choice": "RETRY",
                },
            })
            frame = _drain(host_ws, "game:phase", tries=8)
            _spread(_sockets(host_ws, guests), started, frame["data"]["phaseSeq"])
            _drain(host_ws, "game:result", tries=16)

            data = _result_data(started["data"]["roundId"])
            assert data["voidRound"] is True
            assert len(data["rounds"]) == 2
            assert data["rounds"][0]["safeMemberIds"] == []
