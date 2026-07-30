"""서비스 계층이 의존하는 경계. 실제 구현체는 app/infra/에 있다.

Clock과 RandomSource는 실제로는 각각 SystemClock 인스턴스와 random.Random 인스턴스를 그대로 넘기면 되고,
여기 있는 Protocol은 타입 힌트/문서화 목적이다(런타임에 강제되지 않음).
"""

from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class RandomSource(Protocol):
    def randint(self, a: int, b: int) -> int: ...


class RoomRuntimeStore(Protocol):
    """ready 플래그와 마지막 활동 시각. 다중 인스턴스로 확장되면 Redis 구현체로 교체할 자리."""

    def get_ready_flags(self, room_id: int) -> dict[int, bool]: ...

    def set_ready(self, room_id: int, participant_id: int, ready: bool) -> None: ...

    def clear_participant(self, room_id: int, participant_id: int) -> None: ...

    def touch(self, room_id: int, now: datetime) -> None: ...

    def get_last_activity(self, room_id: int) -> datetime | None: ...

    def purge_room(self, room_id: int) -> None: ...
