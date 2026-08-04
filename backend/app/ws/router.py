"""소켓 이벤트 라우팅.

연결 직후의 순서가 정해져 있다.

    accept -> (3초 안) conn:auth -> 인증 -> 명부 등록 -> room:snapshot 1회 -> 부분 갱신

**인증 전에는 conn:auth 외의 어떤 이벤트도 처리하지 않는다.** 다른 이벤트가 먼저
오면 규약 위반으로 닫는다.

토큰을 쿼리 문자열이 아니라 첫 프레임으로 받는 이유는 브라우저 WebSocket API가
요청 헤더를 지정할 수 없고, 쿼리 문자열에 담으면 프록시·접근 로그에 토큰이 그대로
남기 때문이다.
"""

import asyncio
import logging

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy import select

from app.domain import errors
from app.domain.enums import RoomStatus
from app.infra.db.session import readonly
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import store
from app.schemas.events import AuthRequest, ChatSendRequest, ReadyRequest, TypingRequest
from app.services import chat_service, lobby_service, room_service
from app.ws.connection import SocketConn, registry
from app.ws.envelope import (
    PROTOCOL_VERSION,
    CloseCode,
    ProtocolError,
    outgoing,
    outgoing_error,
    parse_incoming,
)

log = logging.getLogger("modupick.ws")

#: 연결 후 conn:auth를 기다리는 시간.
AUTH_TIMEOUT_S = 3.0


async def _reject(ws: WebSocket, spec, close_code: CloseCode, event: str | None = None) -> None:
    """개인 error를 보낸 뒤 닫는다. 방에는 알리지 않는다."""
    try:
        await ws.send_text(outgoing_error(spec, source_event=event))
    except Exception:
        pass
    try:
        await ws.close(code=close_code)
    except Exception:
        pass


async def _authenticate(ws: WebSocket, code: str) -> SocketConn | None:
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=AUTH_TIMEOUT_S)
    except TimeoutError:
        # 인증 프레임이 오지 않았다. 보낼 error가 없으므로 코드만 남기고 닫는다.
        await ws.close(code=CloseCode.AUTH_TIMEOUT)
        return None
    except (WebSocketDisconnect, RuntimeError):
        return None

    try:
        event, data = parse_incoming(raw)
    except ProtocolError as exc:
        await _reject(ws, exc.spec, exc.close_code)
        return None

    if event != "conn:auth":
        await _reject(ws, errors.COMMON_PROTOCOL_VIOLATION, CloseCode.PROTOCOL_ERROR, event)
        return None

    try:
        req = AuthRequest(**data)
    except ValidationError:
        await _reject(ws, errors.COMMON_VALIDATION_FAILED, CloseCode.PROTOCOL_ERROR, event)
        return None

    if req.protocolVersion != PROTOCOL_VERSION:
        await _reject(ws, errors.COMMON_PROTOCOL_UNSUPPORTED, CloseCode.PROTOCOL_ERROR, event)
        return None

    if req.roomCode != code:
        await _reject(ws, errors.COMMON_SESSION_EXPIRED, CloseCode.UNAUTHORIZED, event)
        return None

    binding = store.resolve_token(req.memberToken)
    if binding is None or binding.room_code != code:
        await _reject(ws, errors.COMMON_SESSION_EXPIRED, CloseCode.UNAUTHORIZED, event)
        return None

    # 같은 토큰의 두 번째 연결을 거부한다. **기존 소켓은 유지한다.**
    if registry.is_bound(req.memberToken):
        await _reject(ws, errors.COMMON_SESSION_EXPIRED, CloseCode.DUPLICATE, event)
        return None

    async with readonly() as conn:
        row = (
            await conn.execute(
                select(
                    participants.c.id,
                    participants.c.member_id,
                    participants.c.left_at,
                    rooms.c.id.label("room_pk"),
                    rooms.c.status.label("room_status"),
                )
                .select_from(participants.join(rooms, participants.c.room_id == rooms.c.id))
                .where(participants.c.id == binding.participant_id)
            )
        ).first()

    if row is None or row.left_at is not None:
        store.revoke_token(req.memberToken)
        await _reject(ws, errors.COMMON_SESSION_EXPIRED, CloseCode.UNAUTHORIZED, event)
        return None

    if row.room_status != RoomStatus.WAITING.value:
        # 게임이 시작되면 새 소켓을 받지 않는다. 재접속 경로가 없기 때문이다.
        await _reject(ws, errors.ROOM_ALREADY_PLAYING, CloseCode.UNAUTHORIZED, event)
        return None

    return SocketConn(
        ws=ws,
        token=req.memberToken,
        participant_id=row.id,
        member_id=row.member_id,
        room_id=row.room_pk,
        room_code=code,
    )


async def _handle_chat_send(conn: SocketConn, data: dict) -> None:
    req = ChatSendRequest(**data)
    await chat_service.send(
        participant_pk=conn.participant_id,
        room_pk=conn.room_id,
        member_id=conn.member_id,
        raw_text=req.text,
    )


async def _handle_chat_typing(conn: SocketConn, data: dict) -> None:
    req = TypingRequest(**data)
    await chat_service.typing(
        participant_pk=conn.participant_id,
        room_pk=conn.room_id,
        member_id=conn.member_id,
        typing=req.typing,
    )


async def _handle_member_ready(conn: SocketConn, data: dict) -> None:
    req = ReadyRequest(**data)
    await lobby_service.set_ready(
        participant_pk=conn.participant_id,
        room_pk=conn.room_id,
        member_id=conn.member_id,
        ready=req.ready,
    )


#: 인증 이후에 받는 이벤트. 게임 선택·입력은 이후 슬라이스에서 붙는다.
_HANDLERS = {
    "chat:send": _handle_chat_send,
    "chat:typing": _handle_chat_typing,
    "member:ready": _handle_member_ready,
}


async def _dispatch(conn: SocketConn, event: str, data: dict) -> None:
    """인증 이후의 이벤트 분기.

    **실패해도 연결을 닫지 않는다.** 규약 위반이 아니라 요청 처리 실패이므로
    보낸 사람에게만 error를 돌려주고 소켓은 살려 둔다. 조용히 삼키면 클라이언트가
    입력이 반영된 줄 알고 기다린다.
    """
    handler = _HANDLERS.get(event)
    if handler is None:
        await _send_error(conn, errors.GAME_INVALID_ACTION, event)
        return

    try:
        await handler(conn, data)
    except errors.DomainError as exc:
        await _send_error(conn, exc.spec, event, message=exc.message)
    except ValidationError:
        await _send_error(conn, errors.COMMON_VALIDATION_FAILED, event)


async def _send_error(
    conn: SocketConn, spec, event: str, *, message: str | None = None
) -> None:
    await conn.ws.send_text(
        outgoing_error(
            spec,
            source_event=event,
            room_version=store.version(conn.room_id),
            message=message,
        )
    )


async def serve(ws: WebSocket, code: str) -> None:
    await ws.accept()

    conn = await _authenticate(ws, code)
    if conn is None:
        return

    registry.add(conn)
    log.info("소켓 연결 — room=%s member=%s", code, conn.member_id)

    try:
        snapshot = await room_service.build_snapshot(
            room_pk=conn.room_id, me_participant_pk=conn.participant_id
        )
        await ws.send_text(outgoing("room:snapshot", snapshot))

        while True:
            raw = await ws.receive_text()
            try:
                event, data = parse_incoming(raw)
            except ProtocolError as exc:
                await _reject(ws, exc.spec, exc.close_code)
                return
            await _dispatch(conn, event, data)

    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("소켓 처리 중 오류 — room=%s member=%s", code, conn.member_id)
    finally:
        # 명부에서만 뺀다. **이탈 확정과 member:left는 이후 슬라이스가 맡는다** —
        # 소켓 종료와 사람이 방을 떠난 것은 다르고, 그 사이에 유예 창이 들어간다.
        registry.remove(conn)
        log.info("소켓 종료 — room=%s member=%s", code, conn.member_id)
