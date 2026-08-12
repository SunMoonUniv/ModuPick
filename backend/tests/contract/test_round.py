"""라운드 생명주기 계약 테스트 — 시작 · 단계 전이 · 틱 · 대기방 복귀.

**게임별 판정은 여기 없다.** 이 파일이 보는 것은 라운드가 어떻게 태어나고 어떤 축으로
전이하며 언제 닫히는가뿐이다. 어떤 단계를 어떤 순서로 밟을지는 게임마다 다르고 그것은
판정 담당의 몫이다.

    라운드 생성·종료   game_rounds 행 · 방 상태 WAITING <-> PLAYING · 명단 스냅샷
    단계 전이          phaseSeq · phase · 마감 시각 · 틱
"""

import time
from contextlib import ExitStack, contextmanager
from functools import partial

import pymysql
import pytest

from app.domain.enums import EndedReason, RoundStatus
from app.domain.games import kingmaker, ladder, nunchi, roulette, timer
from app.services import game_service, round_service
from tests.conftest import _dsn, confirm, connected, create_room, join, send_auth


def _drain(ws, event: str, *, tries: int = 8) -> dict:
    for _ in range(tries):
        frame = ws.receive_json()
        if frame["event"] == event:
            return frame
    pytest.fail(f"{event}가 오지 않았다")


def _lobby(client, size: int):
    """방장 + (size-1)명이 프로필까지 확정한 방."""
    room = create_room(client, maxMembers=10)
    confirm(client, room["code"], room["memberToken"], nickname="지호")
    members = []
    for i in range(size - 1):
        m = join(client, room["code"])
        confirm(client, room["code"], m["memberToken"], nickname=f"참가{i}")
        members.append(m)
    return room, members


@contextmanager
def playing(client, size: int, game: str = "roulette", config: dict | None = None):
    """전원의 소켓을 열고 게임을 시작한 상태.

    **참여자 소켓을 시작 전에 열어 둔다.** 진행 중에는 새 소켓이 붙지 않으므로,
    나중에 열려고 하면 방에 들어갈 수 없다.

    config는 **시작 전에** 넣는다. 설정 변경은 대기방에서만 받으므로(전표 7행)
    시작한 뒤에는 끼워 넣을 자리가 없다.
    """
    room, members = _lobby(client, size)
    with ExitStack() as stack:
        host_ws, _ = stack.enter_context(connected(client, room["code"], room["memberToken"]))
        guests = [
            stack.enter_context(connected(client, room["code"], m["memberToken"]))[0]
            for m in members
        ]

        host_ws.send_json({"event": "game:select", "data": {"gameId": game}})
        _drain(host_ws, "game:selected")
        for g in guests:
            _drain(g, "game:selected")

        # **None만 미지정이다.** config는 부분 갱신이라 빈 dict도 유효한 입력이고,
        # falsy로 걸러 버리면 호출자가 {}를 명시해도 설정 이벤트가 생략된다.
        if config is not None:
            host_ws.send_json({
                "event": "game:config", "data": {"gameId": game, "config": config}
            })
            _drain(host_ws, "game:config_changed")
            for g in guests:
                _drain(g, "game:config_changed")

        for g in guests:
            g.send_json({"event": "member:ready", "data": {"ready": True}})
        for _ in members:
            _drain(host_ws, "member:ready_changed")
        for g in guests:
            for _ in members:
                _drain(g, "member:ready_changed")

        host_ws.send_json({"event": "game:start", "data": {}})
        started = _drain(host_ws, "game:started")
        yield room, members, host_ws, guests, started


def _to_result(client, code: str, host_ws) -> None:
    """결과 단계로 옮긴다.

    **대기방 복귀는 결과에서만 받는다**(전표 15행). 판정이 아직 없으므로 단계 전이
    원시 연산을 직접 불러 그 자리를 만든다.
    """
    client.portal.call(
        partial(round_service.emit_phase, _room_pk(code), phase="RESULT")
    )
    _drain(host_ws, "game:phase")


def _round_row(round_id: str) -> dict:
    conn = pymysql.connect(**_dsn())
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT * FROM game_rounds WHERE round_id = %s", (round_id,))
            return cur.fetchone()
    finally:
        conn.close()


def _one(sql: str, args: tuple):
    conn = pymysql.connect(**_dsn())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        conn.close()


def _room_status(code: str) -> str:
    return _one("SELECT status FROM rooms WHERE code = %s", (code,)) or "삭제됨"


def _room_pk(code: str) -> int:
    return _one("SELECT id FROM rooms WHERE code = %s", (code,))


# ── 시작 전 검증 ───────────────────────────────────────────────────────────


class TestStartGuards:
    def test_게임을_고르지_않으면_not_selected(self, client):
        room, _ = _lobby(client, 2)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:start", "data": {}})
            assert _drain(ws, "error")["code"] == "game.not_selected"

    def test_준비하지_않은_참여자가_있으면_not_all_ready(self, client):
        room, _ = _lobby(client, 2)
        with connected(client, room["code"], room["memberToken"]) as (ws, _):
            ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
            _drain(ws, "game:selected")
            ws.send_json({"event": "game:start", "data": {}})
            assert _drain(ws, "error")["code"] == "game.not_all_ready"

    def test_방장이_아니면_not_host(self, client):
        room, members = _lobby(client, 2)
        with connected(client, room["code"], room["memberToken"]) as (host_ws, _):
            host_ws.send_json({"event": "game:select", "data": {"gameId": "roulette"}})
            _drain(host_ws, "game:selected")
            with connected(client, room["code"], members[0]["memberToken"]) as (ws, _):
                ws.send_json({"event": "game:start", "data": {}})
                assert _drain(ws, "error")["code"] == "member.not_host"

    def test_인원이_빠져_최소_미달이면_not_enough_members(self, client):
        """고를 때는 됐는데 시작 직전에 사람이 나갈 수 있다."""
        room, members = _lobby(client, 3)
        with ExitStack() as stack:
            host_ws, _ = stack.enter_context(
                connected(client, room["code"], room["memberToken"])
            )
            host_ws.send_json({"event": "game:select", "data": {"gameId": "kingmaker"}})
            _drain(host_ws, "game:selected")

            for m in members:
                ws, _ = stack.enter_context(connected(client, room["code"], m["memberToken"]))
                ws.send_json({"event": "member:ready", "data": {"ready": True}})
                _drain(host_ws, "member:ready_changed")

            client.delete(
                f"/api/rooms/{room['code']}/members/me",
                headers={"Authorization": f"Bearer {members[-1]['memberToken']}"},
            )
            _drain(host_ws, "member:left")

            host_ws.send_json({"event": "game:start", "data": {}})
            assert _drain(host_ws, "error")["code"] == "game.not_enough_members"


# ── 시작 ───────────────────────────────────────────────────────────────────


class TestStart:
    def test_라운드가_생기고_방이_PLAYING이_된다(self, client):
        with playing(client, 3) as (room, _members, _host, _guests, started):
            d = started["data"]
            assert d["roundId"].startswith("rnd_")
            assert d["gameId"] == "roulette"
            assert d["config"] == {"topic": ""}
            assert [m["joinOrder"] for m in d["roster"]] == [1, 2, 3]
            assert _room_status(room["code"]) == "playing"

            row = _round_row(d["roundId"])
            assert row["game_type"] == "roulette"
            assert row["status"] == RoundStatus.RUNNING.value
            assert row["started_at"] is not None
            assert row["ended_at"] is None
            assert 0 <= row["random_seed"] < 2**64

    def test_started_직후_READY_단계가_이어진다(self, client):
        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            phase = _drain(host_ws, "game:phase")
            d = phase["data"]
            assert d["phase"] == "READY"
            assert d["roundId"] == started["data"]["roundId"]
            assert d["phaseSeq"] == 1
            assert d["tieRound"] == 0
            assert d["deadlineAt"] is None  # 제한 시간이 없는 단계다
            assert d["serverTime"].endswith("Z")
            assert d["roomVersion"] == started["data"]["roomVersion"] + 1

    def test_전원이_같은_started를_받는다(self, client):
        with playing(client, 2) as (_room, _members, host_ws, guests, started):
            theirs = _drain(guests[0], "game:started")
            assert theirs["data"] == started["data"]
            del host_ws

    def test_명단_스냅샷은_이탈해도_바뀌지_않는다(self, client):
        with playing(client, 3) as (room, members, host_ws, _guests, started):
            assert len(started["data"]["roster"]) == 3
            client.delete(
                f"/api/rooms/{room['code']}/members/me",
                headers={"Authorization": f"Bearer {members[0]['memberToken']}"},
            )
            left = _drain(host_ws, "member:left")
            assert left["data"]["activeCount"] == 2
            # 라운드는 계속 살아 있고 후보도 그대로다
            assert client.portal.call(
                partial(round_service.active_round_count, _room_pk(room["code"]))
            ) == 1

    def test_진행_중에는_새_소켓이_붙지_않는다(self, client):
        with playing(client, 2) as (room, members, _host, _guests, _started):
            with client.websocket_connect(f"/ws/rooms/{room['code']}") as ws:
                send_auth(ws, room["code"], members[0]["memberToken"])
                # 이미 붙어 있는 토큰이라 중복으로 먼저 걸린다 — 방장 토큰으로 다시 본다
                assert ws.receive_json()["code"] == "common.session_expired"

    def test_진행_중에는_게임을_바꾸거나_강퇴할_수_없다(self, client):
        with playing(client, 2) as (_room, members, host_ws, _guests, _started):
            host_ws.send_json({"event": "game:select", "data": {"gameId": "ladder"}})
            assert _drain(host_ws, "error")["code"] == "game.invalid_action"
            host_ws.send_json({
                "event": "member:kick", "data": {"memberId": members[0]["memberId"]},
            })
            assert _drain(host_ws, "error")["code"] == "game.invalid_action"

    def test_진행_중에는_준비를_바꿀_수_없다(self, client):
        with playing(client, 2) as (_room, _members, _host, guests, _started):
            guests[0].send_json({"event": "member:ready", "data": {"ready": False}})
            assert _drain(guests[0], "error")["code"] == "game.invalid_action"

    def test_두_번째_시작은_거절된다(self, client):
        """같은 방에 진행 중 라운드가 둘일 수 없다."""
        with playing(client, 2) as (_room, _members, host_ws, _guests, _started):
            host_ws.send_json({"event": "game:start", "data": {}})
            assert _drain(host_ws, "error")["code"] == "game.invalid_action"

    def test_진행_중에도_채팅은_열려_있다(self, client):
        """방 전 구간에서 받는다(D-45)."""
        with playing(client, 2) as (_room, _members, host_ws, _guests, _started):
            host_ws.send_json({"event": "chat:send", "data": {"text": "잘해봐요"}})
            assert _drain(host_ws, "chat:message")["data"]["text"] == "잘해봐요"


# ── 단계 전이와 틱 ─────────────────────────────────────────────────────────


@pytest.fixture
def no_flow(monkeypatch):
    """게임별 자동 전이를 끈다.

    **판정이 아직 없는 게임을 무대로 삼던 방식은 버렸다.** 게임이 하나씩 붙을 때마다
    무대를 옮겨야 하고, 옮길 곳이 없어지면 이 계약을 시험할 자리 자체가 사라진다.
    끄는 쪽이 무엇을 보는지도 분명하다 — 여기가 보는 것은 emit_phase라는 원시 연산이고
    게임 진행이 함께 돌면 phaseSeq가 흘러가 그 계약이 게임 규칙과 섞인다.
    """

    async def noop(room_pk: int, *, skip_guide: bool = False) -> None:
        del room_pk, skip_guide

    monkeypatch.setattr(game_service, "begin", noop)


class TestPhaseAndTick:
    """emit_phase라는 **원시 연산**의 계약이다.

    게임별 자동 전이는 no_flow가 끈다. 각 게임이 어떤 단계를 어떤 순서로 밟는지는
    test_game_play.py(룰렛) · test_game_ladder.py(사다리)가 따로 본다.
    """

    def test_마감이_있는_단계는_틱이_흐른다(self, client, no_flow):
        with playing(client, 2) as (room, _members, host_ws, _guests, started):
            _drain(host_ws, "game:phase")  # READY
            seq = client.portal.call(
                partial(
                    round_service.emit_phase,
                    _room_pk(room["code"]),
                    phase="PLAYING",
                    duration_ms=4000,
                )
            )
            phase = _drain(host_ws, "game:phase")
            assert phase["data"]["phase"] == "PLAYING"
            assert phase["data"]["phaseSeq"] == seq == 2
            assert phase["data"]["deadlineAt"] is not None

            tick = _drain(host_ws, "game:tick")
            assert tick["data"]["roundId"] == started["data"]["roundId"]
            assert tick["data"]["phaseSeq"] == 2
            assert 0 < tick["data"]["remainMs"] <= 4000
            # **틱은 통지 이벤트라 버전을 밀지 않는다**
            assert tick["data"]["roomVersion"] == phase["data"]["roomVersion"]

    def test_단계가_바뀌면_이전_틱이_멈춘다(self, client, no_flow):
        with playing(client, 2) as (room, _members, host_ws, _guests, _started):
            _drain(host_ws, "game:phase")
            room_pk = _room_pk(room["code"])

            client.portal.call(
                partial(round_service.emit_phase, room_pk, phase="PLAYING", duration_ms=8000)
            )
            _drain(host_ws, "game:phase")
            _drain(host_ws, "game:tick")

            client.portal.call(
                partial(round_service.emit_phase, room_pk, phase="RESULT", duration_ms=8000)
            )
            _drain(host_ws, "game:phase")
            for _ in range(2):
                assert _drain(host_ws, "game:tick")["data"]["phaseSeq"] == 3

    def test_마감이_없으면_틱이_흐르지_않는다(self, client, no_flow):
        with playing(client, 2) as (_room, _members, host_ws, _guests, _started):
            _drain(host_ws, "game:phase")  # READY — deadlineAt null
            host_ws.send_json({"event": "chat:send", "data": {"text": "틱 없나요"}})
            # 틱이 흐른다면 이 프레임보다 먼저 도착했을 것이다
            assert host_ws.receive_json()["event"] == "chat:message"

    def test_TIE_단계는_결선_회차를_싣는다(self, client, no_flow):
        with playing(client, 2) as (room, _members, host_ws, _guests, _started):
            _drain(host_ws, "game:phase")
            client.portal.call(
                partial(
                    round_service.emit_phase,
                    _room_pk(room["code"]),
                    phase="TIE",
                    tie_round=2,
                )
            )
            phase = _drain(host_ws, "game:phase")
            assert phase["data"]["phase"] == "TIE"
            assert phase["data"]["tieRound"] == 2

    def test_전원이_같은_phase를_받는다(self, client, no_flow):
        with playing(client, 2) as (_room, _members, host_ws, guests, _started):
            _drain(guests[0], "game:started")
            mine = _drain(host_ws, "game:phase")
            theirs = _drain(guests[0], "game:phase")
            assert theirs["data"] == mine["data"]


# ── 대기방 복귀 ────────────────────────────────────────────────────────────


class TestClose:
    def test_방장이_닫으면_대기방으로_돌아간다(self, client):
        with playing(client, 2) as (room, _members, host_ws, _guests, started):
            _drain(host_ws, "game:phase")
            _to_result(client, room["code"], host_ws)
            host_ws.send_json({
                "event": "round:close", "data": {"roundId": started["data"]["roundId"]},
            })
            closed = _drain(host_ws, "round:closed")
            assert closed["data"]["roomStatus"] == "WAITING"
            assert _room_status(room["code"]) == "waiting"

            row = _round_row(started["data"]["roundId"])
            assert row["status"] == RoundStatus.FINISHED.value
            assert row["ended_reason"] == EndedReason.COMPLETED.value
            assert row["ended_at"] is not None

    def test_복귀하면_준비가_전부_해제된다(self, client):
        with playing(client, 2) as (room, _members, host_ws, _guests, started):
            _drain(host_ws, "game:phase")
            _to_result(client, room["code"], host_ws)
            host_ws.send_json({
                "event": "round:close", "data": {"roundId": started["data"]["roundId"]},
            })
            _drain(host_ws, "round:closed")
            cleared = _drain(host_ws, "member:ready_changed")
            assert cleared["data"]["ready"] is False
            assert cleared["data"]["readyCount"] == 0

    def test_복귀_뒤에는_다시_시작할_수_있다(self, client):
        """결과 화면의 다시 하기도 같은 이벤트를 재사용한다."""
        with playing(client, 2) as (room, _members, host_ws, guests, started):
            _drain(host_ws, "game:phase")
            _to_result(client, room["code"], host_ws)
            host_ws.send_json({
                "event": "round:close", "data": {"roundId": started["data"]["roundId"]},
            })
            _drain(host_ws, "round:closed")

            # 준비가 풀렸으므로 다시 준비해야 한다
            host_ws.send_json({"event": "game:start", "data": {}})
            assert _drain(host_ws, "error")["code"] == "game.not_all_ready"

            guests[0].send_json({"event": "member:ready", "data": {"ready": True}})
            _drain(host_ws, "member:ready_changed")

            host_ws.send_json({"event": "game:start", "data": {}})
            again = _drain(host_ws, "game:started")
            assert again["data"]["roundId"] != started["data"]["roundId"]

    def test_방장이_아니면_닫을_수_없다(self, client):
        with playing(client, 2) as (room, _members, host_ws, guests, started):
            _drain(host_ws, "game:phase")
            _to_result(client, room["code"], host_ws)
            guests[0].send_json({
                "event": "round:close", "data": {"roundId": started["data"]["roundId"]},
            })
            assert _drain(guests[0], "error")["code"] == "member.not_host"

    def test_진행_중에는_닫을_수_없다(self, client):
        """진행 중 취소 경로를 두지 않는다(전표 15행)."""
        with playing(client, 2) as (_room, _members, host_ws, _guests, started):
            _drain(host_ws, "game:phase")  # READY
            host_ws.send_json({
                "event": "round:close", "data": {"roundId": started["data"]["roundId"]},
            })
            assert _drain(host_ws, "error")["code"] == "game.invalid_action"

    def test_다른_roundId로는_닫을_수_없다(self, client):
        with playing(client, 2) as (room, _members, host_ws, _guests, _started):
            _drain(host_ws, "game:phase")
            _to_result(client, room["code"], host_ws)
            host_ws.send_json({
                "event": "round:close", "data": {"roundId": "rnd_0000000000000000"},
            })
            assert _drain(host_ws, "error")["code"] == "game.round_not_found"


# ── 만료 스위퍼와의 경계 ───────────────────────────────────────────────────


class TestExpiryDuringPlay:
    def test_진행_중인_방은_만료로_지우지_않는다(self, client):
        """진행 중에는 만료 타이머가 멈춰 있다."""
        from app import tasks

        with playing(client, 2) as (room, _members, _host, _guests, _started):
            conn = pymysql.connect(**_dsn())
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE rooms SET last_activity_at = NOW(6) - INTERVAL 11 MINUTE, "
                        "expires_at = NOW(6) - INTERVAL 1 MINUTE WHERE code = %s",
                        (room["code"],),
                    )
                conn.commit()
            finally:
                conn.close()

            report = client.portal.call(tasks.sweep_once)
            assert report.expired_rooms == 0
            assert _room_status(room["code"]) == "playing"


# ── 정원 상한 경계 ─────────────────────────────────────────────────────────


def _king_opinion(ws, started, phase_seq: int, text: str) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "king.opinion",
            "payload": {"text": text},
        },
    })


def _timer_start(ws, started, phase_seq: int) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "timer.start",
        },
    })


def _timer_stop(ws, started, phase_seq: int, elapsed_ms: int) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "timer.stop",
            "payload": {"elapsedMs": elapsed_ms},
        },
    })


def _nunchi_up(ws, started, phase_seq: int) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "nunchi.up",
        },
    })


def _drain_guests(guests, *, tries: int = 40) -> None:
    """모든 참여자 소켓을 game:result까지 밀어낸다.

    **닫기 전에 비우지 않으면 밀린 미수신 프레임이 남는다.** conftest.py의
    _clean_between이 이미 적어 둔 대로, 소켓이 닫힐 때마다 이탈 처리가 백그라운드
    태스크로 떨어져 소켓보다 오래 산다. 10명 방을 그대로 닫으면 안 읽은 채로 쌓인
    아홉 소켓의 이탈 처리가 한꺼번에 겹쳐 다음 테스트의 방 생성과 DB 락을 다툰다.
    참여자도 방장과 같은 결과를 받았는지 함께 확인되는 부수 효과도 있다.
    """
    for g in guests:
        _drain(g, "game:result", tries=tries)


class TestCapacityBoundary:
    """AC-35 — 정원 상한 10명으로 게임 6종이 전부 결과까지 도달하는지 본다.

    게임별 계약 테스트(test_game_*.py)는 각자 최소 인원으로만 돈다. 여기서는 그
    게임들이 이미 본 진행 규칙을 다시 보지 않는다 — **10명 규모에서도 라운드가
    중간에 끊기지 않고 game:result까지 가는가**만 본다. 그래서 각 게임에서 가장
    짧은 결과 경로(방장이 누르지 않아도 서버가 대신 실행 · 전원이 기권해도 난수로
    확정 등, 다른 파일이 이미 검증해 둔 경로)를 그대로 재사용한다.
    """

    @pytest.fixture(autouse=True)
    def _settle(self):
        """다음 테스트가 시작하기 전에 이탈 처리 백그라운드 태스크가 가라앉을
        시간을 준다. 10명 방을 연달아 여섯 번 닫으면 그 누적만으로 DB 데드락이
        나는 것을 실제로 봤다(위 _drain_guests의 설명과 같은 성질)."""
        yield
        time.sleep(1.0)

    def test_룰렛이_10명_정원에서_끝까지_돈다(self, client, monkeypatch):
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "ARMED_MS", 60)  # 자동 실행 마감
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)
        monkeypatch.setattr(roulette, "SPIN_MS", 40)

        with playing(client, 10, "roulette") as (_room, _members, host_ws, guests, started):
            assert len(started["data"]["roster"]) == 10
            for _ in range(3):
                _drain(host_ws, "game:phase")  # READY · GUIDE · ARMED
            # 방장이 PICK을 보내지 않아도 자동 실행 마감이 판정을 연다
            assert _drain(host_ws, "game:phase", tries=6)["data"]["phase"] == "SPINNING"
            result = _drain(host_ws, "game:result", tries=12)["data"]
            assert result["variant"] == "WINNER"
            _drain_guests(guests)

    def test_사다리가_10명_정원에서_끝까지_돈다(self, client, monkeypatch):
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "ARMED_MS", 60)  # 자동 실행 마감
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)
        monkeypatch.setattr(ladder, "SPEED_MS", {"FAST": 40, "NORMAL": 40, "SLOW": 40})

        with playing(client, 10, "ladder") as (_room, _members, host_ws, guests, started):
            assert len(started["data"]["roster"]) == 10
            for _ in range(3):
                _drain(host_ws, "game:phase")  # READY · GUIDE · ARMED
            assert _drain(host_ws, "game:phase", tries=6)["data"]["phase"] == "DRAWING"
            result = _drain(host_ws, "game:result", tries=12)["data"]
            assert result["variant"] == "ASSIGN"
            assert len(result["result"]["pairs"]) == 10
            _drain_guests(guests)

    def test_킹메이커가_10명_정원에서_끝까지_돈다(self, client, monkeypatch):
        """안건을 하나만 내고 나머지 아홉이 침묵해도 제출 마감이 확정으로 끝맺는다."""
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(kingmaker, "SUBMIT_MS", 60)  # 조기 마감
        monkeypatch.setattr(kingmaker, "TALLY_MS", 40)

        with playing(client, 10, "kingmaker") as (_room, _members, host_ws, guests, started):
            assert len(started["data"]["roster"]) == 10
            _drain(host_ws, "game:phase")  # READY
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
            submit = _drain(host_ws, "game:phase")
            assert submit["data"]["phase"] == "SUBMIT"

            _king_opinion(host_ws, started, submit["data"]["phaseSeq"], "유일한 안건")

            tally = _drain(host_ws, "game:phase", tries=12)
            assert tally["data"]["phase"] == "TALLY"
            result = _drain(host_ws, "game:result", tries=8)["data"]
            assert result["variant"] == "TALLY"
            _drain_guests(guests)

    def test_저격이_10명_정원에서_끝까지_돈다(self, client, monkeypatch):
        """전원이 기권해도 마감이 난수로 확정해 결과까지 간다."""
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)

        with playing(client, 10, "snipe", {"voteSeconds": 5}) as (
            _room, _members, host_ws, guests, started,
        ):
            assert len(started["data"]["roster"]) == 10
            _drain(host_ws, "game:phase")  # READY
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "VOTE"
            # 아무도 투표하지 않고 마감을 기다린다

            result = _drain(host_ws, "game:result", tries=20)["data"]["result"]
            assert result["detail"]["randomFallback"] is True
            assert result["detail"]["abstainCount"] == 10
            _drain_guests(guests)

    def test_시간초가_10명_정원에서_끝까지_돈다(self, client, monkeypatch):
        """둘만 기록을 내고 나머지 여덟이 미시작으로 확정되어도 결과가 난다."""
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)
        monkeypatch.setattr(game_service, "TIE_NOTICE_MS", 40)
        monkeypatch.setattr(timer, "round_deadline_ms", lambda target: 400)

        with playing(client, 10, "timer") as (_room, _members, host_ws, guests, started):
            assert len(started["data"]["roster"]) == 10
            _drain(host_ws, "game:phase")  # READY
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
            running = _drain(host_ws, "game:phase")
            assert running["data"]["phase"] == "RUNNING"
            seq = running["data"]["phaseSeq"]

            for ws, elapsed in ((host_ws, 200), (guests[0], 60)):
                _timer_start(ws, started, seq)
                _timer_stop(ws, started, seq, elapsed)
            # 나머지 여덟 명은 아무것도 하지 않는다 — 마감이 미시작으로 확정한다

            frame = _drain(host_ws, "game:result", tries=20)["data"]
            assert frame["variant"] == "WINNER"
            roster_ids = {m["memberId"] for m in started["data"]["roster"]}
            assert frame["result"]["winnerMemberId"] in roster_ids
            _drain_guests(guests)

    def test_눈치가_10명_정원에서_끝까지_돈다(self, client, monkeypatch):
        """겹쳐 누르면 그 자리에서 둘이 함께 빠진다.

        그 성질을 반복해 10명을 1명까지 줄인다 — 간격을 벌리지 않고 거의 동시에
        보내면 겹침으로 잡혀 라운드가 즉시 끝나므로, sleep 없이도 여러 라운드를
        빠르게 통과할 수 있다. 마지막 생존자 둘에서는 한쪽만 누르면(last_one)
        그 자리에서 끝난다.
        """
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)
        monkeypatch.setattr(nunchi, "ROUND_RESULT_MS", 40)

        with playing(client, 10, "nunchi") as (_room, _members, host_ws, guests, started):
            assert len(started["data"]["roster"]) == 10
            _drain(host_ws, "game:phase")  # READY
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
            seq = _drain(host_ws, "game:phase")["data"]["phaseSeq"]

            # 매 라운드 두 명씩 겹쳐 눌러 뺀다 — 10 → 8 → 6 → 4 → 2
            pairs = [
                (host_ws, guests[0]), (guests[1], guests[2]),
                (guests[3], guests[4]), (guests[5], guests[6]),
            ]
            for a, b in pairs:
                _nunchi_up(a, started, seq)
                _nunchi_up(b, started, seq)
                _drain(host_ws, "game:progress", tries=12)
                seq = _drain(host_ws, "game:phase", tries=8)["data"]["phaseSeq"]

            # 마지막 생존자 둘 중 하나만 누르면 그 자리에서 끝난다
            _nunchi_up(guests[7], started, seq)

            result = _drain(host_ws, "game:result", tries=16)["data"]["result"]
            assert result["pickedMemberId"] == started["data"]["roster"][-1]["memberId"]
            _drain_guests(guests)
