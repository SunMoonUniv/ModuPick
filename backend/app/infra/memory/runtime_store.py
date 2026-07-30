"""서버 메모리에만 두는 상태: ready 플래그, 방별 마지막 활동 시각.

MVP는 백엔드 인스턴스가 1개로 고정되므로 프로세스 내 dict로 충분하다.
나중에 다중 인스턴스로 늘어나면 이 클래스를 Redis 구현체로 교체한다(ports.RoomRuntimeStore 참고).
"""

from datetime import datetime


class InMemoryRoomRuntimeStore:
    def __init__(self) -> None:
        self._ready: dict[int, dict[int, bool]] = {}
        self._last_activity: dict[int, datetime] = {}

    def get_ready_flags(self, room_id: int) -> dict[int, bool]:
        return dict(self._ready.get(room_id, {}))

    def set_ready(self, room_id: int, participant_id: int, ready: bool) -> None:
        self._ready.setdefault(room_id, {})[participant_id] = ready

    def clear_participant(self, room_id: int, participant_id: int) -> None:
        self._ready.get(room_id, {}).pop(participant_id, None)

    def touch(self, room_id: int, now: datetime) -> None:
        self._last_activity[room_id] = now

    def get_last_activity(self, room_id: int) -> datetime | None:
        return self._last_activity.get(room_id)

    def purge_room(self, room_id: int) -> None:
        self._ready.pop(room_id, None)
        self._last_activity.pop(room_id, None)
