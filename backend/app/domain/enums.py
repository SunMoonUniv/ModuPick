"""도메인 열거값.

DB 저장값과 와이어 표기가 다르다 — 저장은 소문자, 와이어는 대문자다.
StrEnum의 value가 저장값이고 name이 와이어 표기이므로 변환 함수를 따로 두지 않는다.

    RoomStatus.WAITING.value  ->  "waiting"   DB
    RoomStatus.WAITING.name   ->  "WAITING"   API 응답

gameId만 예외로 와이어도 소문자다(roulette · ladder · ...). 그쪽은 value만 쓴다.
"""

from enum import StrEnum


class RoomStatus(StrEnum):
    """rooms.status — 종료는 값이 아니라 행 삭제다."""

    WAITING = "waiting"
    PLAYING = "playing"


class MemberStatus(StrEnum):
    """participants.status — 슬롯 선점(pending)과 명단 노출(active)을 가른다."""

    PENDING = "pending"
    ACTIVE = "active"


class Role(StrEnum):
    """participants.role — 방장 권한은 이양되지 않으므로 갱신 대상이 아니다."""

    HOST = "host"
    GUEST = "guest"


class RoundStatus(StrEnum):
    """game_rounds.status — 인메모리 phase와 다른 축이다."""

    READY = "ready"
    RUNNING = "running"
    FINISHED = "finished"
    CANCELLED = "cancelled"


class EndedReason(StrEnum):
    """game_rounds.ended_reason — 저장값이라 소문자다."""

    COMPLETED = "completed"
    HOST_LEFT = "host_left"
    LAST_MEMBER_LEFT = "last_member_left"
    ROOM_EXPIRED = "room_expired"
    SERVER_RESTART = "server_restart"
    ERROR = "error"


class GameId(StrEnum):
    """게임 6종. 와이어와 저장이 같은 소문자 슬러그다.

    프로토타입의 timecatch·sniper는 계약값이 아니다 — timer·snipe가 정본이다.
    """

    ROULETTE = "roulette"
    LADDER = "ladder"
    KINGMAKER = "kingmaker"
    TIMER = "timer"
    SNIPE = "snipe"
    NUNCHI = "nunchi"


class LeaveReason(StrEnum):
    """member:left의 reason — 와이어 전용이라 저장하지 않는다."""

    LEAVE = "LEAVE"
    KICK = "KICK"
    DISCONNECT = "DISCONNECT"


class RoomClosedReason(StrEnum):
    """room:closed의 reason — 와이어 전용. 폐기 사유는 통지에만 실린다."""

    HOST_LEFT = "HOST_LEFT"
    LAST_MEMBER_LEFT = "LAST_MEMBER_LEFT"
    EXPIRED = "EXPIRED"


#: 게임별 최소 인원. 최대는 6종 모두 방 정원 상한과 같다.
MIN_MEMBERS: dict[GameId, int] = {
    GameId.ROULETTE: 2,
    GameId.LADDER: 2,
    GameId.KINGMAKER: 3,
    GameId.TIMER: 2,
    GameId.SNIPE: 3,
    GameId.NUNCHI: 3,
}

#: 방 정원 범위.
MIN_ROOM_CAPACITY = 2
MAX_ROOM_CAPACITY = 10

#: 아바타 30종. 자산은 frontend/src/assets/avatars에 있다.
AVATAR_IDS: tuple[str, ...] = tuple(f"A{i:02d}" for i in range(1, 31))
