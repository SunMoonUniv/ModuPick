"""REQ-NFR-01 왕복·서버 내부 처리 지연 실측 — **추정하지 않고 잰다.**

    uvicorn app.main:app --port 8001 &
    MODUPICK_PORT=8001 python devtools/latency.py            5경로 각 100회
    MODUPICK_PORT=8001 python devtools/latency.py 300        회차를 바꿔서

REQ-NFR-01은 두 축이다.

    왕복        요청을 보낸 시각 ~ 그 결과 프레임이 도착한 시각. **클라이언트
                시계 하나**로 잰다(이 프로세스의 단조 시계). 판정선 p95 1초
    서버 내부   프레임이 서버에 도착 ~ 처리를 끝낸 시각. **서버 시계 하나**로
                잰다(app/infra/metrics.py의 dispatch_latency, app/ws/router.py의
                `_dispatch`가 채운다). 판정선 p95 100밀리초

두 축 모두 시계를 하나만 쓰므로 기기 간 시각 동기가 필요 없다.

**서버 내부 축은 이 스크립트가 새 요청을 만들어 재지 않는다.** 준비·채팅·설정변경
왕복을 재는 동안 서버가 이미 `_dispatch` 구간의 표본을 쌓아 뒀으므로, 이 스크립트는
그 값을 devtools 전용 소켓 이벤트(devtools:metrics)로 **조회만** 한다. 서버가
DEVTOOLS_ENABLED=false로 떠 있으면(배포 기본값) 이 이벤트 자체가 등록돼 있지 않아
game.invalid_action이 돌아오고, 이 스크립트는 그 축을 "재지 못함"으로 표시한다.

**입장·퇴장은 서버 내부 축에 없다.** 그 둘은 REST 경로(POST·PATCH·DELETE
/api/rooms/{code}/members...)라 `_dispatch`를 타지 않는다 — WebSocket 프레임
분기만 재는 것이 이번 계측의 범위다(2026-08-12-verification-round-2.md §3 E).
왕복 축은 다섯 경로 전부를 그대로 잰다.

측정 경로 다섯은 REQ-NFR-01이 지정한 것이다 — 입장 · 퇴장 · 채팅 · 설정 변경 ·
준비 상태. 각 회차는 순차로 돈다. 동시 부하 시험이 아니라 지연 분포를 보는 것이라
앞 회차의 결과가 도착한 뒤 다음 회차를 시작한다.
"""

import asyncio
import json
import os
import sys
import time
from typing import Any

import httpx
import websockets

PORT = os.environ.get("MODUPICK_PORT", "8000")
BASE = f"http://127.0.0.1:{PORT}"
WS = f"ws://127.0.0.1:{PORT}"
PROTOCOL_VERSION = 1

#: 기본 회차. REQ-NFR-01이 경로마다 100회 이상을 요구한다.
ROUNDS = 100

#: 판정선. 왕복은 p95 1초, 서버 처리는 p95 100밀리초다.
ROUNDTRIP_P95_MS = 1000
SERVER_P95_MS = 100

#: _dispatch가 재는 이벤트 이름 -> 화면 표기. 준비·채팅·설정변경 셋만 REQ-NFR-01의
#: 다섯 경로와 겹친다(입장·퇴장은 REST라 서버 내부 축에 없다 — 모듈 docstring 참고).
SERVER_EVENT_LABELS = {
    "member:ready": "준비",
    "chat:send": "채팅",
    "game:config": "설정변경",
}


class Member:
    def __init__(self, token: str, member_id: str) -> None:
        self.token = token
        self.member_id = member_id
        self.ws: Any = None

    async def send(self, event: str, data: dict | None = None) -> None:
        await self.ws.send(json.dumps({"event": event, "data": data or {}}))

    async def wait_for(self, event: str, timeout: float = 5.0) -> dict:
        """그 이벤트가 올 때까지 읽는다. 사이에 낀 다른 프레임은 버린다."""
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError(f"{event} 프레임이 {timeout}초 안에 오지 않았다")
            raw = await asyncio.wait_for(self.ws.recv(), timeout=left)
            frame = json.loads(raw)
            if frame.get("event") == event:
                return frame


async def _post(client: httpx.AsyncClient, path: str, **kw) -> dict:
    r = await client.post(path, **kw)
    r.raise_for_status()
    return r.json()["data"]


async def _confirm(client: httpx.AsyncClient, code: str, m: Member, nickname: str, avatar: str) -> None:
    r = await client.patch(
        f"/api/rooms/{code}/members/me",
        headers={"Authorization": f"Bearer {m.token}"},
        json={"nickname": nickname, "avatarId": avatar},
    )
    r.raise_for_status()


async def _connect(code: str, m: Member) -> None:
    m.ws = await websockets.connect(f"{WS}/ws/rooms/{code}")
    await m.send("conn:auth", {
        "protocolVersion": PROTOCOL_VERSION, "roomCode": code, "memberToken": m.token,
    })
    await m.wait_for("room:snapshot")


def _percentile(values: list[float], q: float) -> float:
    """가장 가까운 순위값. 표본이 100개면 p95는 95번째다."""
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * len(ordered) + 0.5) - 1))
    return ordered[index]


def _report(name: str, samples: list[float], threshold_ms: float) -> bool:
    p50 = _percentile(samples, 0.50)
    p95 = _percentile(samples, 0.95)
    p99 = _percentile(samples, 0.99)
    worst = max(samples) if samples else 0.0
    ok = p95 <= threshold_ms
    mark = "OK  " if ok else "FAIL"
    print(
        f"  {mark} {name:<10} n={len(samples):<4} "
        f"p50={p50:7.1f}ms  p95={p95:7.1f}ms  p99={p99:7.1f}ms  max={worst:7.1f}ms"
    )
    return ok


# ── 경로별 측정 ────────────────────────────────────────────────────────────


async def measure_ready(rounds: int, host: Member, guest: Member) -> list[float]:
    """준비 토글 → 방장이 member:ready_changed를 받기까지."""
    out = []
    for i in range(rounds):
        t0 = time.monotonic()
        await guest.send("member:ready", {"ready": i % 2 == 0})
        await host.wait_for("member:ready_changed")
        out.append((time.monotonic() - t0) * 1000)
    return out


async def measure_chat(rounds: int, host: Member, guest: Member) -> list[float]:
    """채팅 전송 → 방장이 chat:message를 받기까지."""
    out = []
    for i in range(rounds):
        t0 = time.monotonic()
        await guest.send("chat:send", {"text": f"측정 {i}"})
        await host.wait_for("chat:message")
        out.append((time.monotonic() - t0) * 1000)
    return out


async def measure_config(rounds: int, host: Member, guest: Member) -> list[float]:
    """방장 설정 변경 → 참가자가 game:config_changed를 받기까지."""
    await host.send("game:select", {"gameId": "roulette"})
    await guest.wait_for("game:selected")

    out = []
    for i in range(rounds):
        t0 = time.monotonic()
        await host.send("game:config", {
            "gameId": "roulette", "config": {"topic": f"측정{i % 100}"},
        })
        await guest.wait_for("game:config_changed")
        out.append((time.monotonic() - t0) * 1000)
    return out


async def measure_join(
    rounds: int, client: httpx.AsyncClient, code: str, host: Member
) -> tuple[list[float], list[float]]:
    """입장·퇴장을 한 쌍으로 돈다.

    **프로필 확정이 입장 이벤트의 기점이다** — 슬롯 선점만으로는 명단에 들어가지
    않아 member:joined가 나가지 않는다(정본 규약). 정원을 넘기지 않도록 한 명씩
    넣고 바로 뺀다.
    """
    joined, left = [], []
    for i in range(rounds):
        slot = await _post(client, f"/api/rooms/{code}/members")
        guest = Member(slot["memberToken"], slot["memberId"])

        t0 = time.monotonic()
        await _confirm(client, code, guest, f"측정{i:03d}", f"A{(i % 28) + 3:02d}")
        await host.wait_for("member:joined")
        joined.append((time.monotonic() - t0) * 1000)

        t1 = time.monotonic()
        r = await client.delete(
            f"/api/rooms/{code}/members/me",
            headers={"Authorization": f"Bearer {guest.token}"},
        )
        r.raise_for_status()
        await host.wait_for("member:left")
        left.append((time.monotonic() - t1) * 1000)
    return joined, left


async def measure_server_side(host: Member) -> dict[str, list[float]] | None:
    """서버가 `_dispatch`에서 쌓아 둔 처리 지연 표본을 조회만 한다.

    **새 요청을 만들지 않는다.** 앞서 돈 준비·채팅·설정변경 라운드가 이미 서버
    프로세스에 표본을 쌓아 뒀다(app/infra/metrics.py, 프로세스 수명 동안 누적).
    여기서는 devtools 전용 소켓 이벤트로 그 값을 읽기만 한다.

    devtools_enabled가 꺼진 서버라면 "devtools:metrics"가 등록돼 있지 않아
    game.invalid_action이 돌아온다 — 그 경우 None을 돌려주고 호출자가 그 축을
    "재지 못함"으로 표시한다.
    """
    await host.send("devtools:metrics")
    deadline = time.monotonic() + 5.0
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError("devtools:metrics 응답이 5초 안에 오지 않았다")
        raw = await asyncio.wait_for(host.ws.recv(), timeout=left)
        frame = json.loads(raw)
        if frame.get("event") == "devtools:dispatch_metrics":
            samples = frame["data"]["samples"]
            return {
                SERVER_EVENT_LABELS.get(evt, evt): [float(v) for v in values]
                for evt, values in samples.items()
                if values
            }
        if frame.get("event") == "error" and frame.get("data", {}).get("event") == "devtools:metrics":
            # devtools_enabled=false — 이 이벤트 자체가 서버에 없다.
            return None


async def main() -> int:
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else ROUNDS

    async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as client:
        room = await _post(client, "/api/rooms", json={"roomName": "지연 측정", "maxMembers": 10})
        code = room["code"]
        host = Member(room["memberToken"], room["memberId"])
        await _confirm(client, code, host, "방장", "A01")

        slot = await _post(client, f"/api/rooms/{code}/members")
        guest = Member(slot["memberToken"], slot["memberId"])
        await _confirm(client, code, guest, "참가", "A02")

        await _connect(code, host)
        await _connect(code, guest)

        print(
            f"\n방 {code} · 경로마다 {rounds}회 · "
            f"판정선 왕복 p95 {ROUNDTRIP_P95_MS}ms · 서버 내부 p95 {SERVER_P95_MS}ms\n"
        )

        results = {
            "준비": await measure_ready(rounds, host, guest),
            "채팅": await measure_chat(rounds, host, guest),
            "설정변경": await measure_config(rounds, host, guest),
        }
        results["입장"], results["퇴장"] = await measure_join(rounds, client, code, host)

        print("\n왕복 반영 시간 (클라이언트 시계 기준)\n")
        passed = all(_report(name, samples, ROUNDTRIP_P95_MS) for name, samples in results.items())

        every = [v for samples in results.values() for v in samples]
        print()
        _report("전 경로", every, ROUNDTRIP_P95_MS)

        # 서버 내부 처리 지연 — 위에서 돈 준비·채팅·설정변경 라운드가 이미
        # `_dispatch`를 통과했으므로 여기서는 그 표본을 조회만 한다.
        server_samples = await measure_server_side(host)
        if server_samples:
            print("\n서버 내부 처리 지연 (도착 → 처리완료, 서버 단조 시계 기준)\n")
            server_passed = all(
                _report(name, samples, SERVER_P95_MS) for name, samples in server_samples.items()
            )
            print(
                "\n입장·퇴장은 REST 경로라 이 축에 없다 — _dispatch(WebSocket)만 잰다. "
                "왕복 축은 위에서 다섯 경로 전부를 쟀다.\n"
            )
        else:
            server_passed = False
            print(
                "\n서버 내부 처리 지연을 재지 못했다 — 서버가 DEVTOOLS_ENABLED=false로 "
                "떠 있어 devtools:metrics 자체가 없다. 왕복만으로 REQ-NFR-01의 두 축을 "
                "모두 통과했다고 적지 않는다.\n"
            )

        await host.ws.close()
        await guest.ws.close()
        return 0 if (passed and server_passed) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
