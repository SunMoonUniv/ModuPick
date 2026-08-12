"""REQ-NFR-01 왕복 반영 시간 실측 — **추정하지 않고 잰다.**

    uvicorn app.main:app --port 8001 &
    MODUPICK_PORT=8001 python devtools/latency.py            5경로 각 100회
    MODUPICK_PORT=8001 python devtools/latency.py 300        회차를 바꿔서

무엇을 재는가 — **클라이언트 왕복**이다. 요청을 보낸 시각과 그 결과 프레임이
도착한 시각의 차이이며, 두 값 모두 이 프로세스의 단조 시계 하나로 읽는다.
기기 간 시각 동기가 필요 없는 이유가 그것이다(09_nonfunctional.md REQ-NFR-01).

**서버 내부 처리 지연(도착 → 송출)은 여기서 재지 않는다.** 그 축은 서버가 두 시각을
기록해야 나오며 계측 코드를 넣는 별도 작업이다. 로컬 측정에서는 네트워크 구간이
거의 0이라 왕복이 처리 지연의 상한 역할을 하지만, **상한을 측정값으로 적지 않는다.**

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


def _report(name: str, samples: list[float]) -> bool:
    p50 = _percentile(samples, 0.50)
    p95 = _percentile(samples, 0.95)
    p99 = _percentile(samples, 0.99)
    worst = max(samples) if samples else 0.0
    ok = p95 <= ROUNDTRIP_P95_MS
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

        print(f"\n방 {code} · 경로마다 {rounds}회 · 판정선 왕복 p95 {ROUNDTRIP_P95_MS}ms\n")

        results = {
            "준비": await measure_ready(rounds, host, guest),
            "채팅": await measure_chat(rounds, host, guest),
            "설정변경": await measure_config(rounds, host, guest),
        }
        results["입장"], results["퇴장"] = await measure_join(rounds, client, code, host)

        print("\n왕복 반영 시간 (클라이언트 시계 기준)\n")
        passed = all(_report(name, samples) for name, samples in results.items())

        every = [v for samples in results.values() for v in samples]
        print()
        _report("전 경로", every)
        print(
            "\n서버 내부 처리 지연(도착 → 송출)은 이 도구가 재지 않는다. "
            "왕복만으로 REQ-NFR-01의 두 축을 모두 통과했다고 적지 않는다.\n"
        )

        await host.ws.close()
        await guest.ws.close()
        return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
