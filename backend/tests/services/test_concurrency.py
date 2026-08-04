"""트랜잭션·경합 테스트 — 계약 표면이 아니라 **서비스 계층**을 직접 부른다.

계약 테스트는 요청을 하나씩 보내므로 "잠근 뒤에 다시 본다"가 실제로 무엇을 막는지
보지 못한다. 여기서는 같은 방에 동시에 들어가고 같은 닉네임을 동시에 확정한다.

    정원 경합     마지막 한 자리에 여럿이 달려들 때 정확히 한 명만 들어간다
    닉네임 경합   코드 검사를 나란히 통과하고 UNIQUE에서 갈린다
    아바타 경합   늦은 쪽이 member.avatar_taken으로 떨어진다
    라운드 경합   같은 방에 진행 중 라운드가 둘일 수 없다
"""

import asyncio
from functools import partial

import pytest

from app.domain import errors
from app.services import game_setup_service, participant_service, room_service
from tests.conftest import _truncate


@pytest.fixture
def portal(client):
    """앱의 이벤트 루프. 서비스를 직접 부르려면 이 위에서 돌려야 한다."""
    _truncate()
    yield client.portal
    _truncate()


def run(portal, coro_factory):
    return portal.call(coro_factory)


async def _gather(*coros):
    """전부 돌리고 예외도 값으로 받는다."""
    return await asyncio.gather(*coros, return_exceptions=True)


def _codes(results) -> list[str]:
    return sorted(
        r.spec.code for r in results if isinstance(r, errors.DomainError)
    )


class TestCapacityRace:
    def test_마지막_한_자리에_정확히_한_명만_들어간다(self, portal):
        created = run(portal, partial(room_service.create_room, "경합", 2))
        # 방장이 1자리를 쓰므로 남은 자리는 하나다
        results = run(portal, partial(_gather, *[
            room_service.join_room(created.code) for _ in range(6)
        ]))

        joined = [r for r in results if not isinstance(r, Exception)]
        assert len(joined) == 1
        assert _codes(results) == ["room.full"] * 5

    def test_정원이_남으면_모두_들어간다(self, portal):
        created = run(portal, partial(room_service.create_room, "여유", 10))
        results = run(portal, partial(_gather, *[
            room_service.join_room(created.code) for _ in range(9)
        ]))
        assert all(not isinstance(r, Exception) for r in results), _codes(results)
        # 정원이 찼으므로 한 명 더는 막힌다
        with pytest.raises(errors.DomainError) as exc:
            run(portal, partial(room_service.join_room, created.code))
        assert exc.value.spec.code == "room.full"

    def test_PENDING도_정원에_센다(self, portal):
        """프로필을 아직 채우지 않은 사람도 슬롯을 차지해야 정원 초과를 막는다."""
        created = run(portal, partial(room_service.create_room, "대기", 3))
        run(portal, partial(room_service.join_room, created.code))
        run(portal, partial(room_service.join_room, created.code))
        with pytest.raises(errors.DomainError) as exc:
            run(portal, partial(room_service.join_room, created.code))
        assert exc.value.spec.code == "room.full"


class TestProfileRace:
    def _room_with(self, portal, n: int, capacity: int = 10):
        created = run(portal, partial(room_service.create_room, "프로필", capacity))
        members = [
            run(portal, partial(room_service.join_room, created.code)) for _ in range(n)
        ]
        return created, members

    def _pk(self, portal, token: str) -> tuple[int, int]:
        from app.infra.memory.runtime_store import store

        binding = store.resolve_token(token)
        return binding.participant_id, binding.room_id

    def test_같은_닉네임을_동시에_확정하면_서버가_채번한다(self, portal):
        created, members = self._room_with(portal, 4)
        coros = []
        for m in members:
            pk, room_pk = self._pk(portal, m.member_token)
            coros.append(
                participant_service.confirm_profile(
                    participant_pk=pk, room_pk=room_pk,
                    nickname="지호", avatar_id=None, bio=None,
                )
            )
        results = run(portal, partial(_gather, *coros))

        ok = [r for r in results if not isinstance(r, Exception)]
        assert len(ok) == len(members), _codes(results)
        # **닉네임 중복은 거부가 아니라 채번이다.** 전부 서로 달라야 한다
        names = sorted(r.nickname for r in ok)
        assert len(set(names)) == len(names), names
        assert all(n.startswith("지호") for n in names)

    def test_같은_아바타를_동시에_고르면_늦은_쪽이_떨어진다(self, portal):
        created, members = self._room_with(portal, 4)
        coros = []
        for i, m in enumerate(members):
            pk, room_pk = self._pk(portal, m.member_token)
            coros.append(
                participant_service.confirm_profile(
                    participant_pk=pk, room_pk=room_pk,
                    nickname=f"참가{i}", avatar_id="A07", bio=None,
                )
            )
        results = run(portal, partial(_gather, *coros))

        ok = [r for r in results if not isinstance(r, Exception)]
        assert len(ok) == 1
        assert ok[0].avatar_id == "A07"
        assert _codes(results) == ["member.avatar_taken"] * 3

    def test_두_번_확정할_수_없다(self, portal):
        created, members = self._room_with(portal, 1)
        pk, room_pk = self._pk(portal, members[0].member_token)
        run(portal, partial(
            participant_service.confirm_profile,
            participant_pk=pk, room_pk=room_pk, nickname="지호",
            avatar_id=None, bio=None,
        ))
        with pytest.raises(errors.DomainError) as exc:
            run(portal, partial(
                participant_service.confirm_profile,
                participant_pk=pk, room_pk=room_pk, nickname="바꿔치기",
                avatar_id=None, bio=None,
            ))
        assert exc.value.spec.code == "member.already_active"


class TestRoundRace:
    def _ready_room(self, portal):
        from app.infra.memory.runtime_store import store

        created = run(portal, partial(room_service.create_room, "라운드", 4))
        host_pk = store.resolve_token(created.member_token).participant_id
        room_pk = store.resolve_token(created.member_token).room_id
        run(portal, partial(
            participant_service.confirm_profile,
            participant_pk=host_pk, room_pk=room_pk, nickname="방장",
            avatar_id=None, bio=None,
        ))

        guest = run(portal, partial(room_service.join_room, created.code))
        guest_pk = store.resolve_token(guest.member_token).participant_id
        run(portal, partial(
            participant_service.confirm_profile,
            participant_pk=guest_pk, room_pk=room_pk, nickname="참가",
            avatar_id=None, bio=None,
        ))
        store.set_ready(room_pk, guest_pk, True)
        run(portal, partial(
            game_setup_service.select_game,
            participant_pk=host_pk, room_pk=room_pk, raw_game_id="roulette",
        ))
        return host_pk, room_pk

    def test_동시에_시작해도_라운드는_하나다(self, portal):
        from app.services import round_service

        host_pk, room_pk = self._ready_room(portal)
        results = run(portal, partial(_gather, *[
            round_service.start(participant_pk=host_pk, room_pk=room_pk)
            for _ in range(4)
        ]))

        ok = [r for r in results if not isinstance(r, Exception)]
        assert len(ok) == 1, _codes(results)
        assert run(portal, partial(round_service.active_round_count, room_pk)) == 1


class TestIdempotency:
    def test_같은_키_같은_본문은_최초_응답을_재현한다(self, client):
        key = "idem-same-body"
        first = client.post("/api/rooms", json={"roomName": "멱등"},
                            headers={"Idempotency-Key": key})
        second = client.post("/api/rooms", json={"roomName": "멱등"},
                             headers={"Idempotency-Key": key})
        assert first.status_code == second.status_code == 201
        assert first.json()["data"] == second.json()["data"]

    def test_같은_키_다른_본문은_거절한다(self, client):
        key = "idem-other-body"
        client.post("/api/rooms", json={"roomName": "처음"},
                    headers={"Idempotency-Key": key})
        r = client.post("/api/rooms", json={"roomName": "다른 본문"},
                        headers={"Idempotency-Key": key})
        assert r.status_code == 409
        assert r.json()["code"] == "common.idempotency_conflict"
