"""소켓 이벤트 페이로드.

**모든 S->C 이벤트의 data에 roomVersion이 실린다.** 클라이언트는 마지막으로 반영한
번호보다 작거나 같은 **상태 이벤트**를 무시한다. 통지 이벤트(chat·tick·error)에는
게이트를 걸지 않는다 — 걸면 방 상태를 바꾸지 않는 이벤트가 직전 상태 이벤트와 같은
번호를 달고 나가 전부 버려진다.

식별자는 외부 식별자(mbr_)와 방 코드만 나간다. 내부 BIGINT PK는 어느 페이로드에도
실리지 않는다.
"""

from pydantic import BaseModel


class AuthRequest(BaseModel):
    """C->S conn:auth — 연결 후 첫 프레임."""

    protocolVersion: int
    roomCode: str
    memberToken: str


class MemberView(BaseModel):
    """명단에 보이는 참가자. ACTIVE만 실린다."""

    memberId: str
    nickname: str
    avatarId: str
    bio: str | None
    isHost: bool
    ready: bool
    connection: str
    joinOrder: int


class RoomView(BaseModel):
    code: str
    displayCode: str
    roomName: str
    maxMembers: int
    roomStatus: str
    hostMemberId: str | None
    expiresAt: str


class MeView(BaseModel):
    """자신의 상태. 프로필 화면에 있는지 대기방에 있는지 이 값으로 가른다."""

    memberId: str
    isHost: bool
    memberStatus: str


class SnapshotData(BaseModel):
    """S->C room:snapshot — 인증 직후 최초 1회.

    **이 하나로 대기방 화면을 통째로 그릴 수 있어야 한다.** 이후는 개별 이벤트로
    부분 갱신만 한다.

    채팅과 진행 중인 라운드는 담지 않는다. 서버가 채팅을 보관하지 않고, 게임이
    시작되면 새 입장이 막혀 소켓이 새로 붙는 시점의 방은 언제나 대기 상태다.
    """

    roomVersion: int
    serverTime: str
    room: RoomView
    me: MeView
    members: list[MemberView]
    game: dict | None = None


class MemberJoinedData(BaseModel):
    """S->C member:joined — 소켓 연결이 아니라 **프로필 확정** 시점에 나간다."""

    roomVersion: int
    member: MemberView


class MemberLeftData(BaseModel):
    """S->C member:left — reason은 LEAVE · KICK · DISCONNECT 3값이다.

    **방장이 나간 경우는 이 이벤트가 아니라 room:closed다.**
    """

    roomVersion: int
    memberId: str
    reason: str
    activeCount: int


class RoomClosedData(BaseModel):
    """S->C room:closed — HOST_LEFT · LAST_MEMBER_LEFT · EXPIRED."""

    roomVersion: int
    reason: str
