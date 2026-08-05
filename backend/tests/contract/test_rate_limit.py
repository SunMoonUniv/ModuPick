"""호출 빈도 상한 계약 테스트.

**GET /api/rooms/{code}에만 건다.** 초대 코드가 숫자 6자리라 이 표면만 무차별 대입으로
방 존재 여부를 캐낼 수 있고, 다른 표면에 걸면 정상 사용자의 연타가 먼저 걸린다.
"""

import pytest

from app.api.deps import client_ip, lookup_limiter
from app.config import settings
from app.infra.memory.rate_limit import FixedWindowLimiter
from tests.conftest import confirm, create_room, join


@pytest.fixture(autouse=True)
def _no_delay(monkeypatch):
    """거절 지연을 끈다. 실제 값은 0.5초라 테스트가 그만큼 늘어진다."""
    monkeypatch.setattr(settings, "lookup_reject_delay_s", 0.0)
    yield


class TestLookupLimit:
    def test_상한을_넘으면_429(self, client, monkeypatch):
        monkeypatch.setattr(lookup_limiter, "limit", 3)
        room = create_room(client)

        for _ in range(3):
            assert client.get(f"/api/rooms/{room['code']}").status_code == 200

        r = client.get(f"/api/rooms/{room['code']}")
        assert r.status_code == 429
        assert r.json()["code"] == "common.rate_limited"
        assert r.json()["message"]

    def test_없는_코드도_같이_센다(self, client, monkeypatch):
        """전수 탐색을 막는 것이 목적이므로 실패한 조회가 더 세어져야 한다."""
        monkeypatch.setattr(lookup_limiter, "limit", 2)
        for _ in range(2):
            assert client.get("/api/rooms/000001").status_code == 404
        assert client.get("/api/rooms/000002").status_code == 429

    def test_다른_표면에는_걸지_않는다(self, client, monkeypatch):
        """정상 사용자의 연타가 먼저 걸리면 안 된다."""
        monkeypatch.setattr(lookup_limiter, "limit", 1)
        room = create_room(client)
        client.get(f"/api/rooms/{room['code']}")  # 상한 소진

        confirm(client, room["code"], room["memberToken"], nickname="지호")
        for _ in range(5):
            assert client.post("/api/rooms", json={}).status_code == 201
            assert join(client, room["code"])
        assert client.get(
            f"/api/rooms/{room['code']}/avatars",
            headers={"Authorization": f"Bearer {room['memberToken']}"},
        ).status_code == 200


class TestWindow:
    def test_창이_지나면_다시_열린다(self, monkeypatch):
        limiter = FixedWindowLimiter(limit=2)
        now = [1000.0]
        monkeypatch.setattr(
            "app.infra.memory.rate_limit.clock",
            type("C", (), {"monotonic_s": staticmethod(lambda: now[0])})(),
        )
        assert limiter.allow("1.2.3.4") is True
        assert limiter.allow("1.2.3.4") is True
        assert limiter.allow("1.2.3.4") is False

        now[0] += 61.0
        assert limiter.allow("1.2.3.4") is True

    def test_IP마다_따로_센다(self):
        limiter = FixedWindowLimiter(limit=1)
        assert limiter.allow("1.1.1.1") is True
        assert limiter.allow("2.2.2.2") is True
        assert limiter.allow("1.1.1.1") is False

    def test_지난_창은_청소된다(self, monkeypatch):
        """한 번씩 들른 IP가 프로세스 수명 동안 쌓이지 않게 한다."""
        limiter = FixedWindowLimiter(limit=5)
        now = [0.0]
        monkeypatch.setattr(
            "app.infra.memory.rate_limit.clock",
            type("C", (), {"monotonic_s": staticmethod(lambda: now[0])})(),
        )
        for i in range(10):
            limiter.allow(f"10.0.0.{i}")
        assert limiter.stats()["buckets"] == 10

        now[0] += 61.0
        assert limiter.purge_expired() == 10
        assert limiter.stats()["buckets"] == 0


class TestClientIp:
    def test_기본값은_XFF를_믿지_않는다(self, monkeypatch):
        """프록시 없이 노출된 상태에서 믿으면 헤더를 바꿔 상한을 우회한다."""
        monkeypatch.setattr(settings, "trust_proxy", False)
        req = type(
            "R", (), {"headers": {"x-forwarded-for": "9.9.9.9"},
                      "client": type("C", (), {"host": "1.1.1.1"})()},
        )()
        assert client_ip(req) == "1.1.1.1"

    def test_켜면_XFF의_첫_항목을_쓴다(self, monkeypatch):
        monkeypatch.setattr(settings, "trust_proxy", True)
        req = type(
            "R", (), {"headers": {"x-forwarded-for": "9.9.9.9, 10.0.0.1"},
                      "client": type("C", (), {"host": "1.1.1.1"})()},
        )()
        assert client_ip(req) == "9.9.9.9"
