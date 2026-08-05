"""호출 빈도 상한 — 고정 창 카운터.

**GET /api/rooms/{code}에만 건다.** 초대 코드가 숫자 6자리라 이 표면만 무차별 대입으로
방 존재 여부를 캐낼 수 있다. 다른 표면에 상한을 걸면 정상 사용자의 연타가 먼저 걸린다.

인메모리에 두는 것이 맞다 — 인스턴스가 하나이고, 재기동으로 카운터가 사라지는 것은
정상 동작이다(기동 정리가 방을 전부 지우므로 캐낼 대상 자체가 사라진다).

고정 창을 쓴다. 창 경계에서 최대 2배가 통과할 수 있지만, 여기서 막으려는 것은
100만 코드 공간의 전수 탐색이라 그 오차가 문제되지 않는다 — 분당 40회로도 전수에
17일이 걸린다.
"""

from dataclasses import dataclass, field

from app.infra.clock import clock

#: 창 길이. 분당 상한이므로 60초다.
WINDOW_S = 60.0


@dataclass(slots=True)
class _Window:
    started_at: float
    count: int


@dataclass(slots=True)
class FixedWindowLimiter:
    limit: int
    _buckets: dict[str, _Window] = field(default_factory=dict)

    def allow(self, key: str) -> bool:
        """한 번 세고 통과 여부를 돌려준다."""
        now = clock.monotonic_s()
        window = self._buckets.get(key)
        if window is None or now - window.started_at >= WINDOW_S:
            self._buckets[key] = _Window(started_at=now, count=1)
            return True
        window.count += 1
        return window.count <= self.limit

    def purge_expired(self) -> int:
        """지난 창을 버린다. 스케줄러가 주기적으로 부른다.

        없으면 한 번씩 들른 IP의 항목이 프로세스 수명 동안 쌓인다.
        """
        now = clock.monotonic_s()
        stale = [k for k, w in self._buckets.items() if now - w.started_at >= WINDOW_S]
        for key in stale:
            del self._buckets[key]
        return len(stale)

    def reset(self) -> None:
        self._buckets.clear()

    def stats(self) -> dict[str, int]:
        return {"buckets": len(self._buckets)}
