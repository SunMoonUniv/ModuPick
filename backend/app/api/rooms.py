"""REST 6종 — 대기방 진입 전의 전 통신.

대기방에 들어선 뒤의 모든 통신은 WebSocket으로 간다. 여기 있는 것은 방을 만들고
코드를 확인하고 슬롯을 잡고 프로필을 확정하기까지다.

응답은 전부 공통 봉투로 감싼다. 화면 분기는 HTTP 상태가 아니라 code 문자열로 한다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from fastapi.responses import JSONResponse

from app.api.deps import (
    IdempotencyKey,
    MemberContext,
    idempotency_key,
    require_member,
)
from app.api.errors import ok, success_body
from app.schemas.rest import (
    AvatarItem,
    AvatarListResponse,
    ConfirmProfileRequest,
    ConfirmProfileResponse,
    CreateRoomRequest,
    CreateRoomResponse,
    JoinResponse,
    RoomLookupResponse,
)
from app.services import participant_service, room_service

router = APIRouter(prefix="/api", tags=["rooms"])

#: 경로의 방 코드. 접두어 없이 숫자 6자리만 쓴다. MODU-427132는 화면 표시 전용이다.
CodePath = Annotated[str, Path(description="초대 코드 숫자 6자리")]


def _display(code: str) -> str:
    return f"MODU-{code}"


@router.post("/rooms", status_code=201)
async def create_room(
    body: CreateRoomRequest,
    idem: Annotated[IdempotencyKey, Depends(idempotency_key)],
) -> JSONResponse:
    """방 생성 + 방장 가입(PENDING).

    인증이 필요 없는 유일한 쓰기 엔드포인트다. 방장은 이 시점에 소켓을 열지 않고
    프로필 확정에 성공한 직후에 연다.
    """
    payload = body.model_dump()
    replayed = idem.replay(payload)
    if replayed is not None:
        status, cached = replayed
        return JSONResponse(status_code=status, content=cached)

    created = await room_service.create_room(body.roomName, body.maxMembers)
    data = CreateRoomResponse(
        code=created.code,
        displayCode=_display(created.code),
        roomName=created.room_name,
        maxMembers=created.max_members,
        memberId=created.member_id,
        memberToken=created.member_token,
        memberStatus="PENDING",
        isHost=True,
        expiresAt=created.expires_at,
    ).model_dump()

    envelope = success_body(data)
    idem.remember(payload, 201, envelope)
    return JSONResponse(status_code=201, content=envelope)


@router.get("/rooms/{code}")
async def lookup_room(code: CodePath) -> JSONResponse:
    """초대 코드 검증. 인증이 필요 없다.

    TODO(배포 전): IP 단위 rate limiting. 코드 공간이 100만이라 상한이 없으면
    전수 탐색으로 방 존재 여부를 캐낼 수 있다(common.rate_limited).
    """
    found = await room_service.lookup_room(code)
    return ok(
        RoomLookupResponse(
            code=found.code,
            displayCode=_display(found.code),
            roomName=found.room_name,
            roomStatus=found.room_status.name,
            maxMembers=found.max_members,
            currentMembers=found.current_members,
            hostNickname=found.host_nickname,
        ).model_dump()
    )


@router.post("/rooms/{code}/members", status_code=201)
async def join_room(
    code: CodePath,
    idem: Annotated[IdempotencyKey, Depends(idempotency_key)],
) -> JSONResponse:
    """가입 — 슬롯 선점 + 토큰 발급. 요청 본문이 없다.

    응답을 받으면 클라이언트는 곧바로 이 토큰으로 소켓 핸드셰이크를 시도한다.
    프로필 화면에 머무는 동안 소켓은 붙어 있지만 명단에는 아직 보이지 않는다.
    """
    body = {"code": code}
    replayed = idem.replay(body)
    if replayed is not None:
        status, cached = replayed
        return JSONResponse(status_code=status, content=cached)

    joined = await room_service.join_room(code)
    data = JoinResponse(
        memberId=joined.member_id,
        memberToken=joined.member_token,
        memberStatus="PENDING",
        isHost=False,
        currentMembers=joined.current_members,
        maxMembers=joined.max_members,
    ).model_dump()

    envelope = success_body(data)
    idem.remember(body, 201, envelope)
    return JSONResponse(status_code=201, content=envelope)


@router.get("/rooms/{code}/avatars")
async def list_avatars(
    code: CodePath,
    member: Annotated[MemberContext, Depends(require_member)],
) -> JSONResponse:
    """아바타 30종과 선점 현황. 가입 이후에만 호출할 수 있다.

    takenBy는 표시용 닉네임이며 식별자를 싣지 않는다 — 프로필 화면의 사람이 대기방
    참가자의 식별자를 알 이유가 없다.
    """
    del code
    slots = await participant_service.list_avatars(member.room_pk)
    return ok(
        AvatarListResponse(
            content=[
                AvatarItem(avatarId=s.avatar_id, taken=s.taken, takenBy=s.taken_by)
                for s in slots
            ],
            totalCount=len(slots),
        ).model_dump()
    )


@router.patch("/rooms/{code}/members/me")
async def confirm_profile(
    code: CodePath,
    body: ConfirmProfileRequest,
    member: Annotated[MemberContext, Depends(require_member)],
    idem: Annotated[IdempotencyKey, Depends(idempotency_key)],
) -> JSONResponse:
    """프로필 확정 → ACTIVE. 한 번만 확정할 수 있다.

    **응답의 nickname이 정본이다.** 같은 방에 같은 닉네임이 있으면 서버가 접미 숫자를
    붙여 확정하므로 요청값과 다를 수 있다.
    """
    del code
    payload = body.model_dump()
    replayed = idem.replay(payload)
    if replayed is not None:
        status, cached = replayed
        return JSONResponse(status_code=status, content=cached)

    confirmed = await participant_service.confirm_profile(
        participant_pk=member.participant_pk,
        room_pk=member.room_pk,
        nickname=body.nickname,
        avatar_id=body.avatarId,
        bio=body.bio,
    )
    data = ConfirmProfileResponse(
        memberId=confirmed.member_id,
        memberStatus="ACTIVE",
        nickname=confirmed.nickname,
        avatarId=confirmed.avatar_id,
        bio=confirmed.bio,
        isHost=confirmed.is_host,
        joinOrder=confirmed.join_order,
    ).model_dump()

    envelope = success_body(data)
    idem.remember(payload, 200, envelope)
    return JSONResponse(status_code=200, content=envelope)


@router.delete("/rooms/{code}/members/me", status_code=204)
async def leave(
    code: CodePath,
    member: Annotated[MemberContext, Depends(require_member)],
) -> Response:
    """소켓 연결 이전 이탈. 프로필 입력 화면에서 뒤로 가는 경우에만 쓴다.

    **방장이 호출하면 방이 삭제된다.** 204에는 본문을 싣지 않는다.
    """
    del code
    await participant_service.leave_before_socket(
        participant_pk=member.participant_pk,
        room_pk=member.room_pk,
        token=member.token,
    )
    return Response(status_code=204)
