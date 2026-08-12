"""다시 하기 계약 테스트 — 결과 화면에서 같은 판을 한 번 더(F-RESULT-05).

**전용 이벤트를 두지 않는다.** game:start가 방 상태에 따라 두 행으로 갈린다 —
대기에서 오면 게임 시작(전표 8행), 결과에서 오면 다시 하기(14행)다.

여기서 보는 것 넷 — 대기방을 거치지 않는다 · 가이드를 건너뛴다 · 명단을 그 시점의
참가자로 다시 고정한다 · 직전 라운드가 닫힌다.
"""

import pytest

from app.services import game_service
from tests.contract.test_game_play import _rows
from tests.contract.test_round import _drain, _room_pk, playing


@pytest.fixture
def fast(monkeypatch):
    """룰렛으로 한 판을 빠르게 끝내고 결과 화면까지 간다."""
    from app.domain.games import roulette

    monkeypatch.setattr(game_service, "GUIDE_MS", 40)
    monkeypatch.setattr(game_service, "ARMED_MS", 60)  # 자동 실행
    monkeypatch.setattr(game_service, "REVEAL_MS", 40)
    monkeypatch.setattr(roulette, "SPIN_MS", 40)


def _again(ws) -> None:
    ws.send_json({"event": "game:start", "data": {}})


def _to_result(host_ws, *, guided: bool = True) -> dict:
    """자동 실행으로 결과까지 흘려보내고 game:result를 돌려준다.

    **다시 하기로 연 판은 단계가 하나 적다** — 가이드를 건너뛰기 때문이다.
    """
    phases = 6 if guided else 5  # READY · (GUIDE) · ARMED · SPINNING · REVEAL · RESULT
    for _ in range(phases):
        _drain(host_ws, "game:phase", tries=14)
    return _drain(host_ws, "game:result", tries=8)


def _rounds_of(code: str) -> list[dict]:
    return _rows(
        "SELECT g.round_id, g.status, g.ended_reason FROM game_rounds g"
        " JOIN rooms r ON r.id = g.room_id WHERE r.code = %s"
        " ORDER BY g.id",
        (code,),
    )


# ── 성립 ───────────────────────────────────────────────────────────────────


class TestPlayAgain:
    def test_결과에서_다시_하기가_새_판을_연다(self, client, fast):
        with playing(client, 2, "roulette") as (room, _m, host_ws, _g, started):
            _to_result(host_ws)
            _again(host_ws)

            fresh = _drain(host_ws, "game:started", tries=8)["data"]
            assert fresh["roundId"] != started["data"]["roundId"]
            assert fresh["gameId"] == "roulette"
            assert fresh["config"] == started["data"]["config"]
            del room

    def test_가이드를_건너뛴다(self, client, fast):
        """**같은 사람들이 같은 규칙을 다시 본다**(G-4)."""
        with playing(client, 2, "roulette") as (_r, _m, host_ws, _g, _s):
            _to_result(host_ws)
            _again(host_ws)
            _drain(host_ws, "game:started", tries=8)

            assert _drain(host_ws, "game:phase")["data"]["phase"] == "READY"
            # 첫 판이었다면 여기가 GUIDE다
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "ARMED"

    def test_대기방을_거치지_않는다(self, client, fast):
        """round:closed를 보내지 않는다 — 방이 대기로 돌아가지 않는다."""
        with playing(client, 2, "roulette") as (room, _m, host_ws, _g, _s):
            _to_result(host_ws)
            _again(host_ws)
            _drain(host_ws, "game:started", tries=8)

            assert _rows(
                "SELECT status FROM rooms WHERE code = %s", (room["code"],)
            )[0]["status"] == "playing"

    def test_직전_라운드가_닫힌다(self, client, fast):
        with playing(client, 2, "roulette") as (room, _m, host_ws, _g, started):
            _to_result(host_ws)
            _again(host_ws)
            _drain(host_ws, "game:started", tries=8)

            rounds = _rounds_of(room["code"])
            assert len(rounds) == 2
            prev = next(
                r for r in rounds if r["round_id"] == started["data"]["roundId"]
            )
            assert prev["status"] == "finished"
            assert prev["ended_reason"] == "completed"
            # 새 라운드는 아직 돌고 있다
            assert rounds[-1]["status"] == "running"

    def test_전원이_같은_시작을_받는다(self, client, fast):
        with playing(client, 2, "roulette") as (_r, _m, host_ws, guests, _s):
            _drain(guests[0], "game:started")  # 첫 판의 것을 먼저 비운다
            _to_result(host_ws)
            _again(host_ws)

            mine = _drain(host_ws, "game:started", tries=8)
            theirs = _drain(guests[0], "game:started", tries=20)
            assert theirs["data"] == mine["data"]

    def test_명단을_그_시점의_참가자로_다시_고정한다(self, client, fast):
        """**도중에 나간 사람은 새 판의 후보가 아니다.**"""
        with playing(client, 3, "roulette") as (room, members, host_ws, _g, started):
            assert len(started["data"]["roster"]) == 3
            _to_result(host_ws)

            client.delete(
                f"/api/rooms/{room['code']}/members/me",
                headers={"Authorization": f"Bearer {members[0]['memberToken']}"},
            )
            _drain(host_ws, "member:left", tries=8)

            _again(host_ws)
            fresh = _drain(host_ws, "game:started", tries=8)["data"]
            assert len(fresh["roster"]) == 2
            assert members[0]["memberId"] not in [
                m["memberId"] for m in fresh["roster"]
            ]


# ── 거절 ───────────────────────────────────────────────────────────────────


class TestRejected:
    def test_참여자는_다시_할_수_없다(self, client, fast):
        with playing(client, 2, "roulette") as (_r, _m, host_ws, guests, _s):
            _to_result(host_ws)
            _again(guests[0])
            assert _drain(guests[0], "error", tries=20)["code"] == "member.not_host"

    def test_인원이_줄면_거절한다(self, client, fast):
        """**시작과 같은 검사를 다시 통과해야 한다.** 룰렛 최소 인원은 2다."""
        with playing(client, 2, "roulette") as (room, members, host_ws, _g, _s):
            _to_result(host_ws)

            client.delete(
                f"/api/rooms/{room['code']}/members/me",
                headers={"Authorization": f"Bearer {members[0]['memberToken']}"},
            )
            _drain(host_ws, "member:left", tries=8)

            _again(host_ws)
            assert _drain(host_ws, "error", tries=8)["code"] == "game.not_enough_members"

    def test_진행_중에는_거절한다(self, client, fast):
        """전표 8행 — 결과가 아닌 진행 중의 game:start는 이미 진행 중이라 거부다."""
        with playing(client, 2, "roulette") as (_r, _m, host_ws, _g, _s):
            _drain(host_ws, "game:phase")  # READY
            _again(host_ws)
            assert _drain(host_ws, "error", tries=8)["code"] == "game.invalid_action"

    def test_대기방에서는_평소대로_시작한다(self, client, fast):
        """같은 이벤트가 대기에서는 전표 8행으로 간다. 회귀 확인이다."""
        with playing(client, 2, "roulette") as (room, _m, host_ws, _g, started):
            _to_result(host_ws)
            host_ws.send_json({
                "event": "round:close",
                "data": {"roundId": started["data"]["roundId"]},
            })
            _drain(host_ws, "round:closed", tries=8)

            # 대기로 돌아왔으므로 준비가 필요하다 — 그 검사가 다시 산다
            _again(host_ws)
            assert _drain(host_ws, "error", tries=8)["code"] == "game.not_all_ready"
            del room


# ── 반복 ───────────────────────────────────────────────────────────────────


class TestRepeat:
    def test_연달아_두_번_할_수_있다(self, client, fast):
        """반복 횟수 제한이 없다 — 방장이 매번 누르므로 자동 반복이 아니다."""
        with playing(client, 2, "roulette") as (room, _m, host_ws, _g, _s):
            _to_result(host_ws)
            _again(host_ws)
            _drain(host_ws, "game:started", tries=8)

            _to_result(host_ws, guided=False)
            _again(host_ws)
            _drain(host_ws, "game:started", tries=8)

            assert len(_rounds_of(room["code"])) == 3

    def test_이전_판의_타이머가_새_판을_건드리지_않는다(self, client, fast):
        """직전 라운드의 인메모리 상태를 걷어내지 않으면 그 타이머가 살아남는다."""
        from app.infra.memory.runtime_store import store

        with playing(client, 2, "roulette") as (room, _m, host_ws, _g, started):
            _to_result(host_ws)
            _again(host_ws)
            fresh = _drain(host_ws, "game:started", tries=8)["data"]

            state = store.round_of(_room_pk(room["code"]))
            assert state.round_id == fresh["roundId"] != started["data"]["roundId"]
            # 새 라운드는 자기 phaseSeq를 0에서 다시 센다
            assert state.phase_seq <= 3
