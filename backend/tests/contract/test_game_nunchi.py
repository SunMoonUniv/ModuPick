"""눈치게임 진행 계약 테스트 — 라운드 반복 · 겹침 조기 종료 · 무효 라운드.

    GUIDE(3초) → ROUND(설정) → 판정 → ROUND_RESULT(3초) ┬ 탈락자 0      → 방장이 고른다
                                   ↑                    ├ 생존자 2 이상 → 다음 ROUND
                                   └────────────────────┤
                                                        └ 생존자 1      → REVEAL → RESULT

교착 탈출(game:decision_required · game:decide)은 test_game_snipe.py가 이미 본다.
여기서는 **눈치에만 있는 것**을 본다 — 누르면 빠진다 · 겹침이 라운드를 끊는다 ·
한 명 남으면 끊는다 · 누를 때마다 통과자가 나간다 · 빠진 사람의 재입력 차단.

**라운드를 끊는 트리거가 셋이다.** 겹침 · 생존자 한 명 남음 · 제한 시간 마감.
그래서 테스트는 누를 사람 수를 세어 가며 눌러야 한다 — 생존자 n명 방에서 n-1명이
누르는 순간 라운드가 끝나므로, 그 뒤에 보낸 UP은 거절된다.

**입력 시각을 벌리려면 실제로 시간이 흘러야 한다.** 혼자와 겹침은 서버 도착 시각의
간격으로 갈리므로 sleep 없이는 전부 겹침이 된다. 판정창을 최소값(0.3초)으로 두고
필요한 만큼만 기다린다.
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
    """라운드 마감이 판정을 만드는 것을 보는 테스트가 쓴다.

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
    """서로 겹치지 않게 순서대로 누른다. 판정창 0.3초보다 넉넉히 벌린다.

    **넘긴 소켓만 누른다.** 생존자 전원을 넘기면 마지막 한 명이 누르기 전에 라운드가
    끝나 그 UP이 거절되므로, 호출부가 누를 사람을 골라 넘긴다.
    """
    for i, ws in enumerate(sockets):
        if i:
            time.sleep(gap)
        _up(ws, started, seq)


def _verdicts(payload) -> dict[str, str]:
    return {v["memberId"]: v["verdict"] for v in payload["verdicts"]}


def _closed(ws, tries: int = 24) -> dict:
    """라운드가 마감된 집계 프레임까지 흘려 읽는다.

    **누를 때마다 도중 집계가 먼저 나가므로 첫 game:progress는 마감 프레임이 아니다.**
    두 프레임은 모양이 같고 다음 라운드 시작 시각이 실린 쪽만 마감 프레임이다.
    """
    for _ in range(tries):
        payload = _drain(ws, "game:progress", tries=tries)["data"]["payload"]
        if payload["nextRoundStartsAt"] is not None:
            return payload
    pytest.fail("마감 집계가 오지 않았다")


# ── 자동 전이 ──────────────────────────────────────────────────────────────


class TestAutoPhases:
    def test_시작하면_GUIDE를_거쳐_ROUND로_간다(self, client, fast):
        with playing(client, 3, "nunchi") as (_r, _m, host_ws, _g, _s):
            frame = _to_round(host_ws)
            assert frame["data"]["deadlineAt"] is not None


# ── 입력 규칙 ──────────────────────────────────────────────────────────────


class TestInput:
    def test_누를_때마다_통과한_사람이_나간다(self, client, fast):
        """**누른 사람은 그 자리에서 통과가 확정이다.** 라운드가 끝나기를 기다리지 않는다.

        누구인지까지 싣는다 — 누르면 무조건 빠지는 구조라(D-38) 남이 이미 눌렀다는
        것을 알아도 얻을 것이 없다. 모양은 마감 프레임과 같고 화면이 골라 쓴다.
        """
        with playing(client, 4, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, _g, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            host = _members(started)[0]
            _up(host_ws, started, seq)

            payload = _drain(host_ws, "game:progress", tries=12)["data"]["payload"]
            assert payload["pressedCount"] == 1
            assert payload["eliminatedMemberIds"] == [host]
            assert host not in payload["survivingMemberIds"]
            # 라운드가 아직 살아 있으므로 다음 라운드 시작 시각은 아직 없다
            assert payload["nextRoundStartsAt"] is None
            assert _verdicts(payload)[host] == "ALONE"

    def test_같은_라운드에_두_번_누르면_거절한다(self, client, fast):
        with playing(client, 4, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, _g, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _up(host_ws, started, seq)
            _up(host_ws, started, seq)
            assert _drain(host_ws, "error")["code"] == "game.already_submitted"


# ── 라운드 반복 ────────────────────────────────────────────────────────────


class TestRounds:
    def test_라운드_결과가_마감_뒤에_나간다(self, client, fast):
        """3명 방에서 둘이 벌려 누르면 남은 한 명이 그 자리에서 뽑힌다."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)
            _spread([host_ws, guests[0]], started, seq)

            payload = _closed(host_ws)
            assert set(payload) == {
                "round", "pressedCount", "verdicts", "aloneMemberIds",
                "overlappedMemberIds", "eliminatedMemberIds", "survivingMemberIds",
                "nextRoundStartsAt",
            }
            assert payload["round"] == 1
            assert payload["pressedCount"] == 2
            # 둘 다 혼자 눌러 빠졌고 겹친 사람은 없다
            assert payload["aloneMemberIds"] == members[:2]
            assert payload["overlappedMemberIds"] == []
            assert payload["eliminatedMemberIds"] == members[:2]
            assert payload["survivingMemberIds"] == [members[2]]
            # 끝까지 못 누른 사람이 최후 1인으로 바뀐다
            assert _verdicts(payload)[members[2]] == "LAST"

    def test_겹치면_그_자리에서_라운드가_끝난다(self, client, fast):
        """겹친 둘만 빠지고, 아직 누르지 못한 사람들이 다음 라운드로 밀린다."""
        with playing(client, 4, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)

            # 방장과 첫 손님이 붙여 누른다 — 나머지 둘은 누를 새가 없다
            _up(host_ws, started, seq)
            _up(guests[0], started, seq)

            payload = _closed(host_ws)
            assert sorted(payload["overlappedMemberIds"]) == sorted(members[:2])
            assert payload["aloneMemberIds"] == []
            assert sorted(payload["survivingMemberIds"]) == sorted(members[2:])

            # 생존자가 줄어든 채로 다음 라운드가 열린다
            frame = _drain(host_ws, "game:phase", tries=8)
            assert frame["data"]["phase"] == "ROUND"

            # 이미 빠진 사람은 이번 라운드의 대상이 아니다
            _up(host_ws, started, frame["data"]["phaseSeq"])
            assert _drain(host_ws, "error")["code"] == "game.not_eligible"

    def test_한_명만_남으면_그_자리에서_끊는다(self, client, fast):
        """마지막 한 명에게 누를 기회를 주면 눌러서 판을 무를 수 있다."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)
            _spread([host_ws, guests[0]], started, seq)

            _closed(host_ws)

            # 라운드가 이미 끝나 단계가 넘어갔으므로 마지막 사람의 UP은 받지 않는다
            # (도중 집계까지 쌓여 있어 error 앞의 프레임이 여럿이다)
            _up(guests[1], started, seq)
            assert _drain(guests[1], "error", tries=20)["code"] == "game.stale_phase"
            assert _drain(host_ws, "game:result", tries=16)["data"][
                "result"
            ]["pickedMemberId"] == members[2]

    def test_누르지_않으면_남는다(self, client, fast, short_round):
        """미입력은 빠지는 것이 아니다 — 다음 라운드로 넘어간다."""
        with playing(client, 4, "nunchi") as (
            _r, _m, host_ws, guests, started,
        ):
            seq = _to_round(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)
            _up(host_ws, started, seq)  # 방장만 누르고 마감을 기다린다

            payload = _closed(host_ws)
            assert payload["eliminatedMemberIds"] == [members[0]]
            verdicts = _verdicts(payload)
            assert verdicts[members[1]] == "NO_INPUT"
            assert verdicts[members[2]] == "NO_INPUT"
            assert all(
                v["elapsedMs"] is None
                for v in payload["verdicts"]
                if v["verdict"] == "NO_INPUT"
            )


# ── 무효 라운드 ────────────────────────────────────────────────────────────


class TestVoidRound:
    def test_아무도_누르지_않으면_방장이_고른다(self, client, fast, short_round):
        """빠진 사람이 없어 생존자 수가 줄지 않았다(D-35)."""
        with playing(client, 3, "nunchi") as (
            _r, _m, host_ws, guests, started,
        ):
            _to_round(host_ws)
            _catch_up(guests)

            payload = _drain(host_ws, "game:progress", tries=14)["data"]["payload"]
            assert payload["eliminatedMemberIds"] == []
            assert len(payload["survivingMemberIds"]) == 3

            decision = _drain(host_ws, "game:decision_required", tries=8)["data"]
            assert decision["reason"] == "VOID_ROUND"
            assert decision["options"] == ["RETRY", "ABORT"]
            assert sorted(decision["candidateIds"]) == sorted(_members(started))

    def test_RETRY는_같은_생존자로_다시_연다(self, client, fast, short_round):
        with playing(client, 3, "nunchi") as (
            _r, _m, host_ws, guests, started,
        ):
            _to_round(host_ws)
            _catch_up(guests)

            decision = _drain(host_ws, "game:decision_required", tries=16)["data"]
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
            _spread([host_ws, guests[0]], started, frame["data"]["phaseSeq"])
            payload = _closed(host_ws)
            assert payload["round"] == 2


# ── 결과 ───────────────────────────────────────────────────────────────────


class TestResult:
    def _decided(self, host_ws, guests, started):
        """3명 방에서 둘이 벌려 누르면 한 라운드로 끝난다 — 못 누른 사람이 뽑힌다."""
        seq = _to_round(host_ws)["data"]["phaseSeq"]
        _catch_up(guests)
        _spread([host_ws, guests[0]], started, seq)
        return _drain(host_ws, "game:result", tries=16)["data"]

    def test_와이어_모양이_정본과_같다(self, client, fast):
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            frame = self._decided(host_ws, guests, started)

            assert frame["variant"] == "RECORD"
            result = frame["result"]
            assert set(result) == {"topic", "pickedMemberId", "rounds", "stats"}
            assert result["topic"] == ""
            # 끝까지 누르지 못한 사람이 뽑힌다
            assert result["pickedMemberId"] == _members(started)[-1]
            assert all(
                set(r) == {
                    "round", "rows", "aloneMemberIds", "overlappedMemberIds",
                    "eliminatedMemberIds", "survivingMemberIds",
                }
                for r in result["rounds"]
            )
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

    def test_혼자와_겹침이_결과에서_갈린다(self, client, fast):
        """둘 다 빠지지만 결과 화면이 구분해 그려야 한다."""
        with playing(client, 3, "nunchi", {"roundSeconds": 20}) as (
            _r, _m, host_ws, guests, started,
        ):
            result = self._decided(host_ws, guests, started)["result"]
            rows = {r["memberId"]: r["verdict"] for r in result["rounds"][0]["rows"]}
            members = _members(started)
            assert rows[members[0]] == "ALONE"
            assert rows[members[1]] == "ALONE"

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
                    "roundNo", "presses", "aloneMemberIds", "overlappedMemberIds",
                    "eliminatedMemberIds", "survivingMemberIds",
                }
                for r in data["rounds"]
            )

    def test_무효_라운드가_있었으면_결과에_남는다(self, client, fast, short_round):
        """**그 라운드도 기록에 남기고 무효였음을 표시한다**(08_screen/06)."""
        with playing(client, 3, "nunchi") as (
            _r, _m, host_ws, guests, started,
        ):
            _to_round(host_ws)
            _catch_up(guests)  # 아무도 누르지 않아 무효 라운드가 된다

            decision = _drain(host_ws, "game:decision_required", tries=16)["data"]
            host_ws.send_json({
                "event": "game:decide",
                "data": {
                    "roundId": started["data"]["roundId"],
                    "phaseSeq": decision["phaseSeq"],
                    "choice": "RETRY",
                },
            })
            frame = _drain(host_ws, "game:phase", tries=8)
            _spread([host_ws, guests[0]], started, frame["data"]["phaseSeq"])
            _drain(host_ws, "game:result", tries=16)

            data = _result_data(started["data"]["roundId"])
            assert data["voidRound"] is True
            assert len(data["rounds"]) == 2
            assert data["rounds"][0]["eliminatedMemberIds"] == []
