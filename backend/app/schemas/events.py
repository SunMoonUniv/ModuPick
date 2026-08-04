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


class ChatSendRequest(BaseModel):
    """C->S chat:send.

    **필드 이름은 text다.** 길이 검사는 도메인 규칙이 하므로 여기서 max_length를
    걸지 않는다 — 걸면 201자가 validation_failed로 나가 정본이 정한
    common.payload_too_large와 어긋난다.
    """

    text: str


class TypingRequest(BaseModel):
    """C->S chat:typing."""

    typing: bool


class ReadyRequest(BaseModel):
    """C->S member:ready. 토글이 아니라 대입이다."""

    ready: bool


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


class MemberReadyChangedData(BaseModel):
    """S->C member:ready_changed.

    **readyCount와 activeCount는 서버가 세어 내려준다.** 클라이언트가 명단을 세면
    화면마다 값이 갈린다.

    방장은 activeCount에 포함되지만 readyCount의 모수에서는 빠진다. 시작 조건이
    방장을 제외한 참여자 전원이므로 readyCount의 목표치는 activeCount - 1이다.
    """

    roomVersion: int
    memberId: str
    ready: bool
    readyCount: int
    activeCount: int


class ChatMessageData(BaseModel):
    """S->C chat:message — 보낸 본인을 포함한 전원.

    본인 메시지도 서버를 한 번 다녀오므로 클라이언트가 미리 그리지 않고 기다렸다
    그리면 전원의 순서가 같아진다.

    **시스템 메시지를 서버가 보내는 경로는 없다.** 입퇴장 말풍선은 클라이언트가
    member:joined·member:left를 보고 직접 그린다.
    """

    roomVersion: int
    messageId: str
    memberId: str
    text: str
    sentAt: str


class ChatTypingData(BaseModel):
    """S->C chat:typing — **보낸 사람 본인은 제외**한다."""

    roomVersion: int
    memberId: str
    typing: bool


class RoomClosedData(BaseModel):
    """S->C room:closed — HOST_LEFT · LAST_MEMBER_LEFT · EXPIRED."""

    roomVersion: int
    reason: str
