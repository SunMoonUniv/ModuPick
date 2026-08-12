"""시간초 잡기 진행 계약 테스트 — 측정 · 대조 · 순위표 · 재대결.

    GUIDE(3초) → RUNNING(10초 + 목표 + 3초) → 판정 ┬ 확정 → REVEAL(3초) → RESULT
                                                  ├ 동점 → TIE_NOTICE(3초) → REMATCH
                                                  └ 교착 → DEADLOCK

결선 루프와 교착 탈출은 test_game_snipe.py가 이미 본다. 여기서는 **시간초에만
있는 것**을 본다 — 클라이언트 신고값의 대조 · 대체 통지의 수신 범위 · 미시작과
미정지의 구분 · 순위표의 군 순서.

라운드 마감을 monkeypatch로 줄인다. **값을 줄여도 규칙은 같다** — 검증 대상은
무엇이 어떤 순서로 확정되는가이고 실제 밀리초는 05_game_rules/05_timer.md가
고정한 상수다.
"""

import pytest

from app.domain.games import timer
from app.services import game_service
from tests.contract.test_game_play import _result_data
from tests.contract.test_round import _drain, playing


@pytest.fixture
def fast(monkeypatch):
    """연출을 줄이되 **라운드 마감은 넉넉히 둔다**.

    이 파일의 대부분은 「전원이 멈추면 마감을 기다리지 않는다」는 조기 마감 경로를
    본다. 마감을 짧게 잡으면 입력을 다 보내기 전에 타이머가 먼저 발화해, 늦게 온
    참가자가 미시작으로 확정되고 그 뒤 입력이 지난 단계의 것이 된다. 실제로 그
    경합이 산발적 실패로 나타났다.
    """
    monkeypatch.setattr(game_service, "GUIDE_MS", 40)
    monkeypatch.setattr(game_service, "REVEAL_MS", 40)
    monkeypatch.setattr(game_service, "TIE_NOTICE_MS", 40)
    monkeypatch.setattr(timer, "round_deadline_ms", lambda target: 3_000)


@pytest.fixture
def short_deadline(monkeypatch):
    """마감이 확정을 만드는 것을 보는 테스트가 쓴다.

    미시작·미정지는 시간이 지나야 확정되므로 조기 마감으로는 만들 수 없다.
    **fast 뒤에 받아야 한다** — 같은 속성을 덮어쓴다.
    """
    monkeypatch.setattr(timer, "round_deadline_ms", lambda target: 400)


def _start(ws, started, phase_seq: int) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "timer.start",
        },
    })


def _stop(ws, started, phase_seq: int, elapsed_ms: int | None) -> None:
    payload = {"elapsedMs": elapsed_ms} if elapsed_ms is not None else {}
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "timer.stop",
            "payload": payload,
        },
    })


def _decide(ws, started, phase_seq: int, choice: str) -> None:
    ws.send_json({
        "event": "game:decide",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "choice": choice,
        },
    })


def _to_running(host_ws) -> dict:
    _drain(host_ws, "game:phase")  # READY
    assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
    frame = _drain(host_ws, "game:phase")
    assert frame["data"]["phase"] == "RUNNING"
    return frame


def _catch_up(guests) -> None:
    for g in guests:
        _drain(g, "game:started")
        for _ in range(3):  # READY · GUIDE · RUNNING
            _drain(g, "game:phase")


def _sockets(host_ws, guests) -> list:
    return [host_ws, *guests]


def _records(started) -> list[dict]:
    return _result_data(started["data"]["roundId"])["records"]


def _by_member(started) -> dict[str, dict]:
    return {r["memberId"]: r for r in _records(started)}


# ── 자동 전이 ──────────────────────────────────────────────────────────────


class TestAutoPhases:
    def test_시작하면_GUIDE를_거쳐_RUNNING으로_간다(self, client, fast):
        with playing(client, 2, "timer") as (_r, _m, host_ws, _g, _s):
            frame = _to_running(host_ws)
            assert frame["data"]["deadlineAt"] is not None


# ── 측정과 대조 ────────────────────────────────────────────────────────────


class TestMeasure:
    def test_신고값이_서버_관측과_맞으면_그대로_쓴다(self, client, fast):
        """**클라이언트가 잰 값을 판정에 쓰는 유일한 게임이다.**

        서로 다른 값을 신고한다 — 같은 값이면 절대 오차가 같아 동점이 되고
        재대결로 넘어가 결과가 나오지 않는다.
        """
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)

            for ws, reported in zip(_sockets(host_ws, guests), [60, 200], strict=True):
                _start(ws, started, seq)
                _stop(ws, started, seq, reported)

            _drain(host_ws, "game:result", tries=20)
            rows = _records(started)
            assert {r["elapsedMs"] for r in rows} == {60, 200}
            assert all(r["status"] == "recorded" for r in rows)
            assert all(r["source"] == "CLIENT_MEASURED" for r in rows)

    def test_서버_관측과_크게_다르면_대체한다(self, client, fast):
        """**승자 후보에서 빼지 않는다.** 서버 관측값으로 되돌릴 뿐이다."""
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = [m["memberId"] for m in started["data"]["roster"]]

            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, 4_900)  # 실제로는 방금 눌렀다
            _start(guests[0], started, seq)
            _stop(guests[0], started, seq, 60)

            _drain(host_ws, "game:result", tries=20)
            rows = _by_member(started)

            assert rows[members[0]]["source"] == "SERVER_OBSERVED"
            assert rows[members[0]]["elapsedMs"] < 1_000  # 신고값이 아니라 관측값
            assert rows[members[0]]["status"] == "recorded"  # 기록은 남는다
            assert rows[members[1]]["source"] == "CLIENT_MEASURED"

    def test_대체_통지는_보낸_사람에게만_간다(self, client, fast):
        """**남에게 보내면 누가 회선이 튀었는지를 방 전체에 알리는 일이 된다.**"""
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)

            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, 4_900)

            assert _drain(host_ws, "error")["code"] == "game.elapsed_rejected"

            # 참가자에게는 진행 집계만 간다
            _start(guests[0], started, seq)
            _stop(guests[0], started, seq, 60)
            for _ in range(8):
                frame = guests[0].receive_json()
                assert frame["event"] != "error"
                if frame["event"] == "game:phase":
                    break

    def test_상한을_넘는_신고값도_관측값으로_대체한다(self, client, fast):
        """0 초과 개인 제한 이하가 아니면 채택하지 않는다."""
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = [m["memberId"] for m in started["data"]["roster"]]

            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, 99_999)  # 목표 + 3초를 한참 넘는다
            _start(guests[0], started, seq)
            _stop(guests[0], started, seq, 60)

            _drain(host_ws, "game:result", tries=20)
            assert _by_member(started)[members[0]]["source"] == "SERVER_OBSERVED"

    def test_음수_신고값은_형식_거절이다(self, client, fast):
        with playing(client, 2, "timer") as (_r, _m, host_ws, _g, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, -1)
            assert _drain(host_ws, "error")["code"] == "common.validation_failed"


# ── 입력 규칙 ──────────────────────────────────────────────────────────────


class TestInput:
    def test_START_없이_STOP은_받지_않는다(self, client, fast):
        with playing(client, 2, "timer") as (_r, _m, host_ws, _g, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _stop(host_ws, started, seq, 100)
            assert _drain(host_ws, "error")["code"] == "game.invalid_action"

    def test_두_번째_START는_거절한다(self, client, fast):
        """**되돌릴 수 없다**(G-9)."""
        with playing(client, 2, "timer") as (_r, _m, host_ws, _g, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _start(host_ws, started, seq)
            _drain(host_ws, "game:progress")
            _start(host_ws, started, seq)
            assert _drain(host_ws, "error")["code"] == "game.already_submitted"

    def test_진행_집계에_시작과_정지가_따로_실린다(self, client, fast):
        with playing(client, 2, "timer") as (_r, _m, host_ws, _g, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]

            _start(host_ws, started, seq)
            assert _drain(host_ws, "game:progress")["data"]["payload"] == {
                "startedCount": 1, "stoppedCount": 0, "totalCount": 2,
            }
            _stop(host_ws, started, seq, 60)
            assert _drain(host_ws, "game:progress")["data"]["payload"] == {
                "startedCount": 1, "stoppedCount": 1, "totalCount": 2,
            }


# ── 미시작·미정지 ──────────────────────────────────────────────────────────


class TestUnfinished:
    def test_아무것도_안_누르면_미시작이다(self, client, fast, short_deadline):
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = [m["memberId"] for m in started["data"]["roster"]]

            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, 60)
            # 참가자는 가만히 있는다 — 마감이 미시작을 확정한다

            _drain(host_ws, "game:result", tries=20)
            rows = _by_member(started)
            assert rows[members[1]]["status"] == "no_start"
            assert rows[members[1]]["elapsedMs"] is None
            assert rows[members[1]]["source"] is None

    def test_START만_하면_미정지다(self, client, fast, short_deadline):
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = [m["memberId"] for m in started["data"]["roster"]]

            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, 60)
            _start(guests[0], started, seq)  # STOP을 보내지 않는다

            _drain(host_ws, "game:result", tries=20)
            assert _by_member(started)[members[1]]["status"] == "no_stop"

    def test_순위표가_유효_미정지_미시작_순이다(self, client, fast, short_deadline):
        """시간을 놓친 것과 판에 참여하지 않은 것을 구분해 늘어놓는다."""
        with playing(client, 3, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)

            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, 60)
            _start(guests[0], started, seq)  # 미정지
            # guests[1]은 미시작

            _drain(host_ws, "game:result", tries=20)
            statuses = [r["status"] for r in _records(started)]
            assert statuses == ["recorded", "no_stop", "no_start"]
            assert [r["rank"] for r in _records(started)] == [1, 2, 3]


# ── 판정 기준 ──────────────────────────────────────────────────────────────


class TestCriterion:
    def test_가장_가까운_사람이_이긴다(self, client, fast):
        """**신고값은 서버 관측과 400밀리초 안에서만 채택된다.**

        테스트는 STOP을 즉시 보내므로 관측값이 수 밀리초다. 목표에 가까운 큰 값을
        신고하면 대조에 걸려 관측값으로 대체되므로, 채택되는 범위 안에서 서로 다른
        값을 골라 오차 크기로 승자를 가른다.
        """
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = [m["memberId"] for m in started["data"]["roster"]]

            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, 200)   # 오차 4800 — 목표에 더 가깝다
            _start(guests[0], started, seq)
            _stop(guests[0], started, seq, 60)  # 오차 4940

            result = _drain(host_ws, "game:result", tries=20)["data"]["result"]
            assert result["winnerMemberId"] == members[0]

    def test_가장_먼_사람_기준에서도_순위표는_그대로다(self, client, fast):
        """**뒤집히는 것은 승자 선정뿐이다.** 순위표는 절대 오차 오름차순이다."""
        with playing(client, 2, "timer", {"criterion": "FARTHEST"}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = [m["memberId"] for m in started["data"]["roster"]]

            _start(host_ws, started, seq)
            _stop(host_ws, started, seq, 200)   # 오차 4800
            _start(guests[0], started, seq)
            _stop(guests[0], started, seq, 60)  # 오차 4940 — 더 멀다

            result = _drain(host_ws, "game:result", tries=20)["data"]["result"]
            assert result["winnerMemberId"] == members[1]  # 먼 쪽이 이긴다
            # 순위표는 오차가 작은 순 그대로다
            assert [r["memberId"] for r in _records(started)] == members


# ── 재대결 ─────────────────────────────────────────────────────────────────


class TestRematch:
    def test_동점이면_재대결로_간다(self, client, fast):
        """같은 값을 신고하면 절대 오차가 같아 단독 승자가 없다.

        **신고값은 허용 오차 안이어야 한다.** 테스트는 START 직후 STOP을 보내므로
        서버 관측 경과 시간이 몇 밀리초다. 신고값이 MARGIN_MS를 넘게 벗어나면 대조에
        실패해 사람마다 다른 관측값으로 판정되고, 두 관측값이 같은 밀리초일 때만
        동점이 된다 — 부하에 따라 갈리는 산발적 실패다.
        """
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = [m["memberId"] for m in started["data"]["roster"]]

            for ws in _sockets(host_ws, guests):
                _start(ws, started, seq)
                _stop(ws, started, seq, 200)

            tie = _drain(host_ws, "game:tie", tries=20)["data"]
            assert tie["tieRound"] == 1
            assert tie["candidateKind"] == "MEMBER"
            assert sorted(tie["candidateIds"]) == sorted(members)

            rematch = _drain(host_ws, "game:phase", tries=8)
            assert rematch["data"]["phase"] == "REMATCH"

    def test_재대결_대상이_아니면_입력할_수_없다(self, client, fast):
        """3명 중 둘만 동점이면 나머지는 이번 회차에 입력하지 않는다."""
        with playing(client, 3, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)

            # 방장과 참가1이 같은 값 — 참가2는 미시작이라 후보에서 빠진다
            for ws in (host_ws, guests[0]):
                _start(ws, started, seq)
                _stop(ws, started, seq, 200)

            _drain(host_ws, "game:tie", tries=20)
            rematch = _drain(host_ws, "game:phase", tries=8)
            assert rematch["data"]["phase"] == "REMATCH"

            _start(guests[1], started, rematch["data"]["phaseSeq"])
            assert _drain(guests[1], "error", tries=40)["code"] == "game.not_eligible"

    def test_재대결_3회를_소진하면_교착이다(self, client, fast):
        """같은 값을 네 번 반복 신고한다 — 본판 1 + 재대결 3.

        저격과 같은 결선 부품을 쓰므로 소진 경로도 같다(test_game_snipe.py
        TestRunoff). 여기서는 **시간초 고유의 값**을 본다 — 후보 종류가 안건이
        아니라 사람이라는 것과, 회차마다 game:tie가 오고 tieRound가 1·2·3으로
        오른다는 것.
        """
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = [m["memberId"] for m in started["data"]["roster"]]

            for expected_round in (1, 2, 3):
                for ws in _sockets(host_ws, guests):
                    _start(ws, started, seq)
                    _stop(ws, started, seq, 200)

                tie = _drain(host_ws, "game:tie", tries=20)["data"]
                assert tie["tieRound"] == expected_round
                assert tie["candidateKind"] == "MEMBER"
                assert sorted(tie["candidateIds"]) == sorted(members)

                rematch = _drain(host_ws, "game:phase", tries=8)
                assert rematch["data"]["phase"] == "REMATCH"
                seq = rematch["data"]["phaseSeq"]

            # 네 번째 동점 신고는 재대결 상한(3)을 넘겨 방장에게 넘어간다
            for ws in _sockets(host_ws, guests):
                _start(ws, started, seq)
                _stop(ws, started, seq, 200)

            decision = _drain(host_ws, "game:decision_required", tries=20)["data"]
            assert decision["reason"] == "TIE_EXHAUSTED"
            assert decision["options"] == ["RETRY", "ABORT"]
            assert decision["candidateKind"] == "MEMBER"
            assert decision["deadlineAt"] is not None


# ── 교착 해소 ──────────────────────────────────────────────────────────────


class TestDecide:
    def _deadlock(self, host_ws, guests, started, seq: int) -> int:
        """같은 값을 네 번 반복 신고해 재대결을 소진한다. 마지막 phaseSeq를 돌려준다."""
        for _round in range(4):
            for ws in _sockets(host_ws, guests):
                _start(ws, started, seq)
                _stop(ws, started, seq, 200)
            frame = _drain(host_ws, "game:phase", tries=20)
            if frame["data"]["phase"] == "DEADLOCK":
                return frame["data"]["phaseSeq"]
            assert frame["data"]["phase"] == "TIE_NOTICE"
            seq = _drain(host_ws, "game:phase", tries=8)["data"]["phaseSeq"]
        raise AssertionError("교착에 이르지 못했다")

    def test_RETRY는_본판을_다시_연다(self, client, fast):
        """**회차 카운터가 0으로 돌아가고 가이드는 띄우지 않는다**(G-4)."""
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            seq = _to_running(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)

            decide_seq = self._deadlock(host_ws, guests, started, seq)
            _decide(host_ws, started, decide_seq, "RETRY")

            frame = _drain(host_ws, "game:phase", tries=8)
            assert frame["data"]["phase"] == "RUNNING"
            assert frame["data"]["tieRound"] == 0

            # 대상자가 직전 동점자 집합이 아니라 명단 전원으로 돌아왔는지 본다
            _start(host_ws, started, frame["data"]["phaseSeq"])
            payload = _drain(host_ws, "game:progress")["data"]["payload"]
            assert payload == {"startedCount": 1, "stoppedCount": 0, "totalCount": 2}


# ── 결과 ───────────────────────────────────────────────────────────────────


class TestResult:
    def _decided(self, host_ws, guests, started):
        seq = _to_running(host_ws)["data"]["phaseSeq"]
        _catch_up(guests)
        _start(host_ws, started, seq)
        _stop(host_ws, started, seq, 200)
        _start(guests[0], started, seq)
        _stop(guests[0], started, seq, 60)
        return _drain(host_ws, "game:result", tries=20)["data"]

    def test_와이어_모양이_정본과_같다(self, client, fast):
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            frame = self._decided(host_ws, guests, started)

            assert frame["variant"] == "WINNER"
            result = frame["result"]
            assert set(result) == {"topic", "winnerMemberId", "detail", "stats"}
            assert result["topic"] == ""
            assert set(result["detail"]) == {"targetMs", "criterion", "records"}
            assert result["detail"]["targetMs"] == 5_000
            assert result["detail"]["criterion"] == "CLOSEST"
            # 판정용 절대 오차와 순위는 저장 축이라 와이어에 나가지 않는다
            assert all(
                set(r) == {"memberId", "elapsedMs", "diffMs", "source", "status"}
                for r in result["detail"]["records"]
            )

    def test_요약_수치_3개가_단위까지_붙어_온다(self, client, fast):
        """08_screen/06 「승자형」이 시간초에 정한 목표 시간 · 1위 기록 · 1위 오차."""
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            stats = self._decided(host_ws, guests, started)["result"]["stats"]

            assert [s["label"] for s in stats] == ["목표 시간", "1위 기록", "1위 오차"]
            assert stats[0]["value"] == "5초"
            assert stats[1]["value"] == "0.20초"
            assert stats[2]["value"] == "-4.80초"

    def test_저장_형식이_정본과_같다(self, client, fast):
        """06_database/04 「게임별 JSON 스키마」의 시간초 행이다."""
        with playing(client, 2, "timer") as (_r, _m, host_ws, guests, started):
            self._decided(host_ws, guests, started)

            data = _result_data(started["data"]["roundId"])
            assert set(data) == {
                "schemaVersion", "records", "winnerMemberIds", "rematchRounds",
            }
            assert data["rematchRounds"] == 0
            assert all(
                set(r) == {
                    "memberId", "elapsedMs", "diffMs", "absDiffMs",
                    "rank", "status", "source",
                }
                for r in data["records"]
            )
