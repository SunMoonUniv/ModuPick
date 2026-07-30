"""방/참가자 도메인에서 쓰는 고정값. requirements.md §3.4 · features.md F-101/102/108 기준."""

MIN_CAPACITY = 2
MAX_CAPACITY = 10
DEFAULT_CAPACITY = 10
DEFAULT_TITLE = "ModuPick 방"
TITLE_MAX_LENGTH = 20

NICKNAME_MIN_LENGTH = 1
NICKNAME_MAX_LENGTH = 8
INTRO_TAG_MAX_LENGTH = 20

ROOM_CODE_PREFIX = "MODU-"
ROOM_CODE_DIGITS = 6
ROOM_CODE_MAX_RETRIES = 10

ROOM_INACTIVITY_MINUTES = 10

# 아바타 자동 배정용 기본 풀. 실제 아바타 목록은 프론트/디자인 쪽과 맞춰 갱신한다.
AVATAR_POOL = [f"avatar-{i:02d}" for i in range(1, 31)]
