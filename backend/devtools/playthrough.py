"""게임 6종 한 판씩 육안 확인 — **연출 길이를 줄이지 않는다.**

    uvicorn app.main:app --port 8001 &
    MODUPICK_PORT=8001 python devtools/playthrough.py            6종 전부
    MODUPICK_PORT=8001 python devtools/playthrough.py nunchi     한 종만

계약 테스트는 monkeypatch로 3초·30초를 40밀리초로 줄여 돌린다. 그래서 **순서와
전이 조건**은 보지만 **사람이 겪는 흐름**은 보지 못한다 — 연출이 너무 길지 않은지,
프레임 사이 빈 구간이 화면을 멈춰 보이게 하지 않는지, 화면이 그리는 데 필요한 값이
그 시점에 도착하는지는 실제 상수로 돌려야 드러난다.

여기서 보는 것은 **프레임의 시간 축**이다. 각 줄 앞의 밀리초는 라운드 시작부터
잰 값이며, 그 간격이 곧 참가자가 기다리는 시간이다.

방장이 곧바로 누르는 경로로 돌린다 — 자동 실행 마감(30초)이나 제출 마감(120초)을
그대로 기다리면 6종에 5분이 넘게 걸리고, 그 마감은 계약 테스트가 이미 본다.
"""

import asyncio
import json
import os
import sys
import time
from typing import Any

import httpx
import websockets

#: 붙을 서버. **개발 서버를 띄워 둔 채 다른 포트로 확인할 수 있게 열어 둔다** —
#: 오래 떠 있는 서버는 옛 코드일 수 있고, 그러면 READY에서 멈춘 채 끝난다.
PORT = os.environ.get("MODUPICK_PORT", "8000")
BASE = f"http://127.0.0.1:{PORT}"
WS = f"ws://127.0.0.1:{PORT}"
PROTOCOL_VERSION = 1

#: 게임별 최소 인원. 이 수만큼 방에 넣는다.
SIZE = {
    "roulette": 2, "ladder": 2, "timer": 2,
    "kingmaker": 3, "snipe": 3, "nunchi": 3,
}

#: 한 판이 끝났다고 보는 프레임. 이걸 받으면 그 게임의 관찰을 멈춘다.
DONE = "game:result"


class Member:
    """참가자 하나 — REST로 들어와 소켓을 연다."""

    def __init__(self, token: str, member_id: str, nickname: str) -> None:
        self.token = token
        self.member_id = member_id
        self.nickname = nickname
        self.ws: Any = None

    async def send(self, event: str, data: dict | None = None) -> None:
        await self.ws.send(json.dumps({"event": event, "data": data or {}}))


async def _post(client: httpx.AsyncClient, path: str, **kw) -> dict:
    r = await client.post(path, **kw)
    r.raise_for_status()
    return r.json()["data"]


async def _open_room(client: httpx.AsyncClient, size: int) -> tuple[str, list[Member]]:
    """방을 만들고 size명이 프로필까지 확정한 상태로 만든다."""
    room = await _post(client, "/api/rooms", json={"roomName": "육안 확인", "maxMembers": 10})
    code = room["code"]
    members = [Member(room["memberToken"], room["memberId"], "방장")]

    for i in range(size - 1):
        joined = await _post(client, f"/api/rooms/{code}/members")
        members.append(Member(joined["memberToken"], joined["memberId"], f"참가{i + 1}"))

    for i, m in enumerate(members):
        r = await client.patch(
            f"/api/rooms/{code}/members/me",
            headers={"Authorization": f"Bearer {m.token}"},
            json={"nickname": m.nickname, "avatarId": f"A{i + 1:02d}"},
        )
        r.raise_for_status()
    return code, members


async def _connect(code: str, members: list[Member]) -> None:
    for m in members:
        m.ws = await websockets.connect(f"{WS}/ws/rooms/{code}")
        await m.send("conn:auth", {
            "protocolVersion": PROTOCOL_VERSION, "roomCode": code, "memberToken": m.token,
        })
        await m.ws.recv()  # room:snapshot


async def _drain(m: Member, timeout: float = 0.05) -> list[dict]:
    """지금 큐에 쌓인 프레임을 전부 꺼낸다. 없으면 빈 목록이다."""
    out = []
    while True:
        try:
            raw = await asyncio.wait_for(m.ws.recv(), timeout=timeout)
        except (TimeoutError, asyncio.TimeoutError):
            return out
        out.append(json.loads(raw))


def _line(started: float, frame: dict) -> str:
    """프레임 한 줄. 앞의 밀리초가 라운드 시작부터 잰 값이다."""
    event = frame["event"]
    data = frame.get("data", {})
    at = int((time.monotonic() - started) * 1000)

    if event == "game:phase":
        tail = f"{data['phase']:<12}"
        if data.get("deadlineAt"):
            tail += " 마감있음"
        if data.get("payload"):
            tail += f" payload={sorted(data['payload'])}"
        if data.get("tieRound"):
            tail += f" tieRound={data['tieRound']}"
    elif event == "game:progress":
        tail = str(data.get("payload"))
    elif event == "game:result":
        tail = f"variant={data['variant']} stats={[s['value'] for s in data['result']['stats']]}"
    elif event == "game:tie":
        tail = f"{data['tieRound']}/{data['tieRoundMax']} 후보 {len(data['candidateIds'])}명"
    elif event == "game:decision_required":
        tail = f"reason={data['reason']} options={data['options']}"
    elif event == "error":
        tail = f"{data.get('code')} {data.get('message', '')}"
    else:
        tail = ""
    return f"  {at:>6}ms  {event:<24} {tail}"


# ── 게임별 입력 ────────────────────────────────────────────────────────────


#: 입력을 받는 단계. 이 단계가 열리면 그 자리에서 넣는다.
INPUT_PHASES = frozenset({"ARMED", "SUBMIT", "VOTE", "RUNOFF", "RUNNING", "ROUND"})


def _snipe_targets(ids: list[str], pool: tuple[str, ...]) -> list[str]:
    """**표를 한 사람에게 모은다.** 순환 지목은 매번 3파전 동점이라 결선만 보게 된다.

    후보(결선이면 동점자 명단)의 첫 사람을 다 같이 찍되, 자기 자신은 찍을 수 없으니
    그 한 사람만 두 번째를 찍는다.
    """
    cands = list(pool) or ids
    return [next(c for c in cands if c != me) for me in ids]


def _king_pick(cards: list[dict], index: int) -> str:
    """자기가 낸 안건에는 투표할 수 없다 — 그것만 피해 첫 카드를 찍는다.

    후보는 섞여 오고 글쓴이도 감춰져 있다. 여기서는 안건 글에 낸 사람 번호를 미리
    적어 두었으므로 그것으로 가른다. 확인 도구라서 쓸 수 있는 지름길이다.
    """
    mine = f"안건 {index + 1}"
    return next(c["optionId"] for c in cards if c["label"] != mine)


async def _play(
    game: str,
    members: list[Member],
    round_id: str,
    seq: int,
    phase: str,
    payload: dict | None,
    tie_pool: tuple[str, ...],
) -> None:
    """그 단계가 요구하는 입력을 넣는다. 방장이 곧바로 누르는 경로다."""
    ids = [m.member_id for m in members]

    async def action(m: Member, kind: str, body: dict | None = None) -> None:
        data: dict[str, Any] = {"roundId": round_id, "phaseSeq": seq, "type": kind}
        if body is not None:
            data["payload"] = body
        await m.send("game:action", data)

    if game == "roulette":
        await action(members[0], "roulette.pick")
    elif game == "ladder":
        await action(members[0], "ladder.start")
    elif game == "snipe":
        for m, target in zip(members, _snipe_targets(ids, tie_pool), strict=True):
            await action(m, "snipe.vote", {"targetMemberIds": [target]})
    elif game == "timer":
        for m in members:
            await action(m, "timer.start")
        await asyncio.sleep(0.3)
        for i, m in enumerate(members):
            await action(m, "timer.stop", {"elapsedMs": 300 + i * 60})
    elif game == "nunchi":
        for i, m in enumerate(members):
            if i:
                await asyncio.sleep(0.5)  # 판정창(0.3초)보다 넉넉히 벌린다
            await action(m, "nunchi.up")
    elif game == "kingmaker":
        if phase == "SUBMIT":
            for i, m in enumerate(members):
                await action(m, "king.opinion", {"text": f"안건 {i + 1}"})
        else:  # VOTE · RUNOFF — 후보가 payload로 온다
            cards = (payload or {})["candidates"]
            for i, m in enumerate(members):
                await action(m, "king.vote", {"candidateIds": [_king_pick(cards, i)]})


# ── 한 판 ──────────────────────────────────────────────────────────────────


async def run(game: str) -> bool:
    size = SIZE[game]
    print(f"\n{'=' * 72}\n{game}  ({size}명)\n{'=' * 72}")

    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        code, members = await _open_room(client, size)
        await _connect(code, members)
        host = members[0]

        await host.send("game:select", {"gameId": game})
        for m in members:
            await _drain(m)

        for g in members[1:]:
            await g.send("member:ready", {"ready": True})
        for m in members:
            await _drain(m)

        started_at = time.monotonic()
        await host.send("game:start")

        round_id = ""
        tie_pool: tuple[str, ...] = ()
        done: set[int] = set()  # 입력을 이미 넣은 phaseSeq
        deadline = time.monotonic() + 70

        while time.monotonic() < deadline:
            frames = await _drain(host, timeout=0.2)
            for f in frames:
                print(_line(started_at, f))
                data = f.get("data", {})

                if f["event"] == "game:started":
                    round_id = data["roundId"]
                elif f["event"] == "game:result":
                    return True
                elif f["event"] == "game:tie":
                    # 결선 후보다. 저격은 단계 payload가 아니라 이쪽으로만 온다
                    tie_pool = tuple(data["candidateIds"])
                elif f["event"] == "game:decision_required":
                    # 교착. 기다리면 방이 정리되므로 다시 시작을 고른다
                    await host.send("game:decide", {
                        "roundId": round_id,
                        "phaseSeq": data["phaseSeq"],
                        "choice": "RETRY",
                    })
                elif f["event"] == "game:phase":
                    phase, seq = data["phase"], data["phaseSeq"]
                    if phase in INPUT_PHASES and seq not in done:
                        done.add(seq)
                        await _play(
                            game, members, round_id, seq,
                            phase, data.get("payload"), tie_pool,
                        )
            # 참여자 큐도 비워 준다 — 쌓이면 서버가 전송에서 막힌다
            for g in members[1:]:
                await _drain(g, timeout=0.01)

        print("  … 70초 안에 결과가 나오지 않았다")
        return False


async def main() -> int:
    games = sys.argv[1:] or list(SIZE)
    unknown = [g for g in games if g not in SIZE]
    if unknown:
        print(f"모르는 게임: {', '.join(unknown)}\n고를 수 있는 것: {', '.join(SIZE)}")
        return 2

    try:
        async with httpx.AsyncClient(base_url=BASE, timeout=3) as c:
            (await c.get("/health")).raise_for_status()
    except Exception:
        print(f"{BASE}에 서버가 없다. uvicorn app.main:app --port {PORT} 로 띄운 뒤 다시 돌린다.")
        return 2

    results = {}
    for game in games:
        try:
            results[game] = await run(game)
        except Exception as exc:  # noqa: BLE001 — 육안 확인 도구다. 무엇이 터졌는지만 보인다
            print(f"  !! {type(exc).__name__}: {exc}")
            results[game] = False

    print(f"\n{'=' * 72}")
    for game, ok in results.items():
        print(f"  {'통과' if ok else '실패'}  {game}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
