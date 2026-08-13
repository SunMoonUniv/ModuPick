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

from app.config import settings
from app.domain import errors, state_machine
from app.domain.enums import RoomStatus
from app.infra.clock import clock
from app.infra.db.session import readonly
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import store
from app.infra.metrics import dispatch_latency
from app.schemas.events import (
    AuthRequest,
    ChatSendRequest,
    GameActionRequest,
    GameConfigRequest,
    GameDecideRequest,
    GameSelectRequest,
    KickRequest,
    ReadyRequest,
    RoundCloseRequest,
    TypingRequest,
)
from app.services import (
    chat_service,
    game_service,
    game_setup_service,
    leave_service,
    lobby_service,
    room_service,
    round_service,
)
from app.ws.connection import EVICTED, SocketConn, registry
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

#: 소켓에서 떼어 낸 뒷정리 태스크. 참조를 들고 있지 않으면 GC가 중간에 거둬 간다.
_detached: set[asyncio.Task] = set()


def detach(coro) -> None:
    """소켓 태스크의 수명에서 떼어 낸다.

    **이탈 처리는 소켓보다 오래 산다** — 유예가 30·60초다. 소켓 태스크의 finally
    안에서 await하면, 그 태스크가 취소되는 순간 열려 있던 DB 커넥션이 반납되지 않은
    채 남는다(정리 코드도 취소된 컨텍스트에서는 끝까지 돌지 못한다).
    """
    task = asyncio.create_task(coro)
    _detached.add(task)
    task.add_done_callback(_detached.discard)


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

    # **유예 중인 자리는 되찾을 수 없다.** 유예는 회복을 기다리는 창이 아니라 이탈
    # 확정의 부작용을 늦추는 창이다. 여기를 열어 두면 그것이 곧 재접속이 되고,
    # 재접속 불가 위에 세운 판정·명단·익명성 설계가 흔들린다. 링크를 다시 연 사람은
    # 새 참가자이며 정원에 자리가 있어야 들어온다.
    if store.grace_of(binding.room_id, binding.participant_id) is not None:
        await _reject(ws, errors.COMMON_SESSION_EXPIRED, CloseCode.UNAUTHORIZED, event)
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


async def _handle_member_kick(conn: SocketConn, data: dict) -> None:
    req = KickRequest(**data)
    await lobby_service.kick(
        actor_pk=conn.participant_id,
        room_pk=conn.room_id,
        target_member_id=req.memberId,
    )


async def _handle_game_select(conn: SocketConn, data: dict) -> None:
    req = GameSelectRequest(**data)
    await game_setup_service.select_game(
        participant_pk=conn.participant_id,
        room_pk=conn.room_id,
        raw_game_id=req.gameId,
    )


async def _handle_game_random(conn: SocketConn, data: dict) -> None:
    del data  # 페이로드가 없다. 서버가 고른다
    await game_setup_service.pick_random(
        participant_pk=conn.participant_id, room_pk=conn.room_id
    )


async def _handle_game_config(conn: SocketConn, data: dict) -> None:
    req = GameConfigRequest(**data)
    await game_setup_service.change_config(
        participant_pk=conn.participant_id,
        room_pk=conn.room_id,
        raw_game_id=req.gameId,
        patch=req.config,
    )


async def _handle_game_start(conn: SocketConn, data: dict) -> None:
    """게임 시작과 「다시 하기」가 같은 이벤트로 들어온다(07_api/03 §9).

    **전용 이벤트를 두지 않는다** — C→S 12종이 고정 기준이고, 방장이 하는 일도
    「같은 게임·같은 설정으로 판을 연다」로 같다. 다른 것은 어디서 눌렀는가뿐이라
    방 상태로 가른다.
    """
    del data  # 페이로드가 없다. 현재 선택과 설정으로 라운드를 만든다

    if _phase_of(conn.room_id) is state_machine.RoomPhase.RESULT:
        await round_service.play_again(
            participant_pk=conn.participant_id, room_pk=conn.room_id
        )
        return
    await round_service.start(participant_pk=conn.participant_id, room_pk=conn.room_id)


async def _handle_round_close(conn: SocketConn, data: dict) -> None:
    req = RoundCloseRequest(**data)
    await round_service.close(
        participant_pk=conn.participant_id, room_pk=conn.room_id, round_id=req.roundId
    )


async def _handle_game_action(conn: SocketConn, data: dict) -> None:
    req = GameActionRequest(**data)
    await game_service.handle_action(
        participant_pk=conn.participant_id,
        room_pk=conn.room_id,
        member_id=conn.member_id,
        round_id=req.roundId,
        phase_seq=req.phaseSeq,
        action_type=req.type,
        payload=req.payload,
    )


async def _handle_game_decide(conn: SocketConn, data: dict) -> None:
    req = GameDecideRequest(**data)
    await game_service.handle_decide(
        participant_pk=conn.participant_id,
        room_pk=conn.room_id,
        round_id=req.roundId,
        phase_seq=req.phaseSeq,
        choice=req.choice,
    )


#: 인증 이후에 받는 이벤트. **C→S 12종과 정확히 일치해야 한다**
#: (tests/domain/test_type_generator.py가 devtools/gen_socket_types.py의
#: CLIENT_EVENTS와 이 dict의 키 집합이 같은지 대조한다). devtools 전용 진단
#: 이벤트(아래 DEVTOOLS_METRICS_EVENT)를 여기 넣지 않는 이유가 그것이다 — 정식
#: 프로토콜 표면이 아니므로 그 대조에 끼면 안 된다.
_HANDLERS = {
    "chat:send": _handle_chat_send,
    "chat:typing": _handle_chat_typing,
    "member:ready": _handle_member_ready,
    "member:kick": _handle_member_kick,
    "game:select": _handle_game_select,
    "game:random": _handle_game_random,
    "game:config": _handle_game_config,
    "game:start": _handle_game_start,
    "game:action": _handle_game_action,
    "game:decide": _handle_game_decide,
    "round:close": _handle_round_close,
}

#: devtools 전용 진단 이벤트명. C→S 12종에 속하지 않으므로 `_HANDLERS`·`_ACTIONS`에
#: 넣지 않고 serve()의 수신 루프에서 직접 가로챈다(아래 _maybe_serve_devtools_query).
#: devtools/console.html이 OpenAPI 스키마 밖에 있는 것(main.py의
#: include_in_schema=False)과 같은 이유다 — 문서화된 프로토콜이 아니라 검증
#: 도구 전용 조회 경로다.
DEVTOOLS_METRICS_EVENT = "devtools:metrics"


async def _maybe_serve_devtools_query(conn: SocketConn, event: str) -> bool:
    """devtools 전용 조회를 상태 게이트·`_dispatch` 바깥에서 처리한다.

    **`_dispatch`를 거치지 않는 이유는 셋이다.**
    1. `_HANDLERS`에 넣으면 위 대조 테스트가 깨진다(정식 12종이 아니다).
    2. 상태 전표(`_ACTIONS`)에 없는 이벤트라 어차피 게이트를 타지 않지만, 그렇다고
       `_dispatch`의 처리 지연 표본에 이 조회 자체가 섞이면 계측이 스스로를 재는
       잡음이 낀다.
    3. 처리할 값이 이미 계산돼 있는 조회라 실패 분기(DomainError 등)를 태울 이유가
       없다.

    devtools_enabled가 꺼져 있으면 **이 이벤트를 아예 모르는 척한다** — 다른
    미등록 이벤트와 똑같이 game.invalid_action을 돌려준다. 그래야 꺼진 배포
    환경에서 devtools 전용 채널이 존재한다는 사실 자체가 새지 않는다.
    """
    if event != DEVTOOLS_METRICS_EVENT:
        return False
    if settings.devtools_enabled:
        await conn.ws.send_text(
            outgoing("devtools:dispatch_metrics", {"samples": dispatch_latency.snapshot()})
        )
    else:
        await _send_error(conn, errors.GAME_INVALID_ACTION, event)
    return True


#: 소켓 이벤트를 전표의 이벤트로 옮긴다. 여기 없는 것은 상태 게이트를 타지 않는다.
_ACTIONS = {
    "chat:send": state_machine.Action.CHAT,
    "chat:typing": state_machine.Action.CHAT,
    "member:ready": state_machine.Action.READY,
    "member:kick": state_machine.Action.KICK,
    "game:select": state_machine.Action.GAME_SELECT,
    "game:random": state_machine.Action.GAME_SELECT,
    "game:config": state_machine.Action.GAME_CONFIG,
    "game:start": state_machine.Action.GAME_START,
    "game:action": state_machine.Action.GAME_ACTION,
    "game:decide": state_machine.Action.HOST_DECIDE,
    "round:close": state_machine.Action.ROUND_CLOSE,
}


def _action_of(event: str, phase: state_machine.RoomPhase) -> state_machine.Action | None:
    """이 이벤트가 전표의 어느 행인가. 여기 없는 것은 상태 게이트를 타지 않는다.

    **game:start만 방 상태에 따라 두 행으로 갈린다.** 대기에서 오면 게임 시작(8행),
    결과에서 오면 다시 하기(14행)다. 두 행의 판정이 서로 반대라 — 결과에서 시작은
    거부, 대기에서 다시 하기는 거부 — 하나로 묶으면 어느 쪽이든 막힌다.
    """
    if event == "game:start" and phase is state_machine.RoomPhase.RESULT:
        return state_machine.Action.PLAY_AGAIN
    return _ACTIONS.get(event)


def _phase_of(room_pk: int) -> state_machine.RoomPhase:
    """개념 상태를 **인메모리만 보고** 낸다.

    라운드 상태는 방 상태 전이와 같은 서비스에서 함께 만들어지고 사라지므로, 빠른
    실패용 판정에는 DB를 다시 읽을 이유가 없다. 매 채팅마다 질의를 붙이면 그것이
    브로드캐스트 경로의 비용이 된다.
    """
    state = store.round_of(room_pk)
    if state is None:
        return state_machine.RoomPhase.WAITING
    if state.phase == "RESULT":
        return state_machine.RoomPhase.RESULT
    return state_machine.RoomPhase.PLAYING


async def _dispatch(conn: SocketConn, event: str, data: dict) -> None:
    """인증 이후의 이벤트 분기.

    **실패해도 연결을 닫지 않는다.** 규약 위반이 아니라 요청 처리 실패이므로
    보낸 사람에게만 error를 돌려주고 소켓은 살려 둔다. 조용히 삼키면 클라이언트가
    입력이 반영된 줄 알고 기다린다.

    상태 전표를 **먼저** 본다. 빠른 실패용이며, 최종 판정은 서비스가 잠근 뒤에
    다시 한다 — 정원·준비 상태는 검사와 커밋 사이에 바뀔 수 있다.

    **이 함수의 진입~반환 구간이 REQ-NFR-01 서버 내부 처리 축의 측정 구간이다**
    (프레임 도착 → 처리완료). 성공이든 실패든 클라이언트 입장에서는 "보내고 나서
    뭔가 돌아오기까지"가 같은 기다림이므로 에러 분기도 포함해서 잰다. 미등록
    이벤트(handler is None)는 상태 게이트조차 타지 않는 규약 위반에 가까운 경로라
    빼고 잰다 — 그건 서버가 "처리"한 것이 아니라 즉시 거절한 것이다.
    """
    handler = _HANDLERS.get(event)
    if handler is None:
        await _send_error(conn, errors.GAME_INVALID_ACTION, event)
        return

    started_ms = clock.monotonic_ms()
    try:
        phase = _phase_of(conn.room_id)
        action = _action_of(event, phase)
        if action is not None:
            state_machine.ensure(action, phase)
        await handler(conn, data)
    except errors.DomainError as exc:
        await _send_error(conn, exc.spec, event, message=exc.message)
    except ValidationError:
        await _send_error(conn, errors.COMMON_VALIDATION_FAILED, event)
    except Exception:
        # **핸들러의 결함이 사람을 방에서 쫓아내지 않는다.** 여기서 잡지 않으면
        # 예외가 serve()까지 올라가 소켓이 조용히 닫히고, 그 사람은 이유도 모른 채
        # 유예를 거쳐 이탈 확정된다.
        log.exception("이벤트 처리 실패 — event=%s room=%s", event, conn.room_code)
        await _send_error(conn, errors.COMMON_INTERNAL, event)
    finally:
        # 단조 시계 읽기 1회 + list append 1회뿐이다(devtools_enabled가 꺼져 있으면
        # 그마저도 dispatch_latency.record 안에서 즉시 반환한다). 처리 경로에
        # 새 지연을 더하지 않는다.
        dispatch_latency.record(event, clock.monotonic_ms() - started_ms)


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
    # 핸드셰이크가 있었다는 표식. 미연결 슬롯 회수가 이 값을 본다.
    store.mark_handshake(conn.room_id, conn.participant_id)
    log.info("소켓 연결 — room=%s member=%s", code, conn.member_id)

    close_code: int | None = None
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
            if await _maybe_serve_devtools_query(conn, event):
                continue
            await _dispatch(conn, event, data)

    except WebSocketDisconnect as exc:
        # **클라이언트가 보낸 종료 코드다.** 1000만 즉시 이탈이고 나머지는 유예로 간다.
        close_code = exc.code
    except RuntimeError:
        # 서버가 먼저 닫은 뒤의 receive다. 이탈 사건이 아니다.
        pass
    except Exception:
        log.exception("소켓 처리 중 오류 — room=%s member=%s", code, conn.member_id)
    finally:
        registry.remove(conn)
        log.info("소켓 종료 — room=%s member=%s code=%s", code, conn.member_id, close_code)
        if EVICTED not in conn.flags:
            # 서버가 닫은 소켓은 이미 처리가 끝났다. 두 번 이탈시키지 않는다.
            detach(
                leave_service.on_socket_closed(
                    participant_pk=conn.participant_id,
                    room_pk=conn.room_id,
                    member_id=conn.member_id,
                    token=conn.token,
                    close_code=close_code,
                )
            )
