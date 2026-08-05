"""프레임 봉투.

C->S는 이벤트명과 데이터만 담는다.

    { "event": "conn:auth", "data": { } }

S->C는 REST와 같은 공통 응답 객체에 event를 얹는다. 봉투를 공유하므로 에러 코드도
REST와 같은 문자열을 쓴다 — 소켓 전용 코드를 만들지 않는다.

    { "event": "room:snapshot", "success": true, "code": "ok",
      "message": null, "data": { }, "timestamp": "..." }

**프레임 하나에 이벤트 하나다.** 여러 이벤트를 묶어 보내지 않는다.
"""

import json
from enum import IntEnum
from typing import Any

from app.domain.errors import ErrorSpec
from app.infra.clock import clock
from app.schemas.rest import iso_z

#: 프레임 상한. 초과하면 4413으로 닫는다.
MAX_FRAME_BYTES = 64 * 1024

#: 서버가 지원하는 프로토콜 버전. 오래된 번들이 붙으면 여기서 거른다.
PROTOCOL_VERSION = 1


class CloseCode(IntEnum):
    """소켓 종료 코드. 4000~4999는 애플리케이션 정의 구간이다.

    **어느 코드에서도 클라이언트가 자동 재연결을 시도하지 않는다.** 재접속 경로가
    없어 재연결은 자리를 되찾지 못하고 4409만 반복시킨다.
    """

    NORMAL = 1000              # 나가기 버튼에서만. beforeunload·페이지 숨김에는 쓰지 않는다
    PROTOCOL_ERROR = 4002      # 규약 위반 · 지원하지 않는 protocolVersion
    UNAUTHORIZED = 4401        # 인증 실패 · 토큰 무효 · 방 없음
    KICKED = 4403              # 강퇴
    AUTH_TIMEOUT = 4408        # 3초 안에 conn:auth가 오지 않음
    DUPLICATE = 4409           # 같은 토큰에 이미 다른 소켓. 기존 소켓을 유지한다
    ROOM_CLOSED = 4410         # 방 종료. 직전에 room:closed가 나간다
    TOO_LARGE = 4413           # 프레임 상한 초과


class ProtocolError(Exception):
    """규약 위반. 개인 error 후 소켓을 닫는다."""

    def __init__(self, spec: ErrorSpec, close_code: CloseCode) -> None:
        self.spec = spec
        self.close_code = close_code
        super().__init__(spec.code)


def parse_incoming(raw: str) -> tuple[str, dict]:
    """C->S 프레임을 (event, data)로 가른다."""
    if len(raw.encode()) > MAX_FRAME_BYTES:
        from app.domain import errors

        raise ProtocolError(errors.COMMON_PAYLOAD_TOO_LARGE, CloseCode.TOO_LARGE)

    try:
        frame = json.loads(raw)
    except json.JSONDecodeError as exc:
        from app.domain import errors

        raise ProtocolError(errors.COMMON_PROTOCOL_VIOLATION, CloseCode.PROTOCOL_ERROR) from exc

    if not isinstance(frame, dict) or not isinstance(frame.get("event"), str):
        from app.domain import errors

        raise ProtocolError(errors.COMMON_PROTOCOL_VIOLATION, CloseCode.PROTOCOL_ERROR)

    data = frame.get("data")
    return frame["event"], data if isinstance(data, dict) else {}


def outgoing(event: str, data: dict[str, Any]) -> str:
    """성공 S->C 프레임. data에는 호출자가 roomVersion을 실어 둔다."""
    return json.dumps(
        {
            "event": event,
            "success": True,
            "code": "ok",
            "message": None,
            "data": data,
            "timestamp": iso_z(clock.now()),
        },
        ensure_ascii=False,
    )


def outgoing_error(
    spec: ErrorSpec,
    *,
    source_event: str | None = None,
    request_id: str | None = None,
    room_version: int | None = None,
    message: str | None = None,
) -> str:
    """실패 S->C 프레임. **보낸 사람에게만** 간다.

    event와 requestId를 에코하는 이유는 소켓에 요청-응답 짝이 없기 때문이다.
    두 값이 없으면 클라이언트가 어떤 입력이 실패했는지 알 수 없다.
    """
    data: dict[str, Any] = {"event": source_event, "requestId": request_id}
    if room_version is not None:
        data["roomVersion"] = room_version
    return json.dumps(
        {
            "event": "error",
            "success": False,
            "code": spec.code,
            "message": message or spec.message,
            "data": data,
            "timestamp": iso_z(clock.now()),
        },
        ensure_ascii=False,
    )
