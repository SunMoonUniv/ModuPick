"""방/참가자 상태값. features.md F-604(방 상태 머신), requirements.md §2(용어) 기준."""

from enum import Enum


class RoomStatus(str, Enum):
    WAITING = "WAITING"    # 대기방
    IN_GAME = "IN_GAME"    # 게임 진행 중
    RESULT = "RESULT"      # 결과 화면


class ParticipantRole(str, Enum):
    HOST = "HOST"
    GUEST = "GUEST"


class ParticipantStatus(str, Enum):
    ACTIVE = "ACTIVE"    # 방에 남아있는 상태
    LEFT = "LEFT"        # 스스로 퇴장
    KICKED = "KICKED"    # 방장이 강퇴 (같은 방 재입장 차단 대상)
