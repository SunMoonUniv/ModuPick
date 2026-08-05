"""REST 요청·응답 모델.

성공이든 실패든 **모든 응답이 같은 봉투**로 내려간다. 각 엔드포인트의 페이로드는
data 안에 들어가고, 화면 분기는 HTTP 상태가 아니라 code 문자열로 한다.

    { "success": true, "code": "ok", "message": null,
      "data": { }, "timestamp": "2026-08-02T06:04:05.123Z" }

식별자는 **외부 식별자**(mbr_ · rnd_ · opt_)와 방 코드만 나간다. 내부 BIGINT PK는
어느 응답에도 실리지 않는다 — 방을 가로질러 연속 증가하는 값이라 노출하면 다른 방의
참가자 수·생성 순서를 추정할 수 있다.
"""

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field

from app.domain.enums import MAX_ROOM_CAPACITY, MIN_ROOM_CAPACITY


def iso_z(dt: datetime) -> str:
    """ISO 8601 · UTC · Z 접미 · 밀리초 3자리.

    오프셋 표기(+09:00)를 쓰지 않는다. 저장이 UTC이고 DB 세션도 UTC라 와이어에서만
    지역 오프셋을 쓰면 변환 지점이 하나 늘어난다.
    """
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)
    utc = aware.astimezone(UTC)
    return f"{utc.strftime('%Y-%m-%dT%H:%M:%S')}.{utc.microsecond // 1000:03d}Z"


class Envelope(BaseModel):
    success: bool
    code: str
    message: str | None
    data: Any
    timestamp: str


# ── 1. POST /api/rooms ─────────────────────────────────────────────────────


class CreateRoomRequest(BaseModel):
    roomName: str | None = Field(default=None, max_length=64)
    maxMembers: int | None = Field(default=None, ge=MIN_ROOM_CAPACITY, le=MAX_ROOM_CAPACITY)


class CreateRoomResponse(BaseModel):
    code: str
    displayCode: str
    roomName: str
    maxMembers: int
    memberId: str
    memberToken: str
    memberStatus: str
    isHost: bool
    expiresAt: str


# ── 2. GET /api/rooms/{code} ───────────────────────────────────────────────


class RoomLookupResponse(BaseModel):
    code: str
    displayCode: str
    roomName: str
    roomStatus: str
    maxMembers: int
    currentMembers: int
    hostNickname: str | None


# ── 3. POST /api/rooms/{code}/members ──────────────────────────────────────


class JoinResponse(BaseModel):
    memberId: str
    memberToken: str
    memberStatus: str
    isHost: bool
    currentMembers: int
    maxMembers: int


# ── 4. GET /api/rooms/{code}/avatars ───────────────────────────────────────


class AvatarItem(BaseModel):
    avatarId: str
    taken: bool
    takenBy: str | None


class AvatarListResponse(BaseModel):
    content: list[AvatarItem]
    totalCount: int


# ── 5. PATCH /api/rooms/{code}/members/me ──────────────────────────────────


class ConfirmProfileRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=64)
    avatarId: str | None = Field(default=None, max_length=8)
    bio: str | None = Field(default=None, max_length=64)


class ConfirmProfileResponse(BaseModel):
    memberId: str
    memberStatus: str
    nickname: str
    avatarId: str
    bio: str | None
    isHost: bool
    joinOrder: int
