"""소켓 이벤트 TS 타입 생성기.

    python devtools/gen_socket_types.py > devtools/socket-events.ts

REST는 FastAPI가 /openapi.json을 자동 생성하므로 openapi-typescript로 뽑으면 되지만,
**소켓에는 그런 표면이 없다.** 손으로 옮겨 적으면 스키마가 바뀔 때 조용히 어긋나므로
app/schemas/events.py에서 직접 뽑는다.

이 파일이 아는 것은 모양뿐이다. 어떤 이벤트가 어떤 순서로 오가는지는 정본
docs/07_api/03_socket_events.md와 devtools/console.html이 보여준다.
"""

import sys
import types
import typing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import BaseModel  # noqa: E402

from app.domain import errors  # noqa: E402
from app.schemas import events  # noqa: E402
from app.ws.envelope import PROTOCOL_VERSION, CloseCode  # noqa: E402

#: C->S 이벤트 -> 페이로드 모델. 라우터의 분기표와 같은 집합이어야 한다.
CLIENT_EVENTS = {
    "conn:auth": "AuthRequest",
    "member:ready": "ReadyRequest",
    "member:kick": "KickRequest",
    "chat:send": "ChatSendRequest",
    "chat:typing": "TypingRequest",
    "game:select": "GameSelectRequest",
    "game:config": "GameConfigRequest",
    "game:random": None,
    "game:start": None,
    "game:action": "GameActionRequest",
    "round:close": "RoundCloseRequest",
}

#: S->C 이벤트 -> 페이로드 모델. None은 아직 구현되지 않은 이벤트다.
SERVER_EVENTS = {
    "room:snapshot": "SnapshotData",
    "room:closed": "RoomClosedData",
    "member:joined": "MemberJoinedData",
    "member:left": "MemberLeftData",
    "member:ready_changed": "MemberReadyChangedData",
    "member:connection": "MemberConnectionData",
    "chat:message": "ChatMessageData",
    "chat:typing": "ChatTypingData",
    "game:selected": "GameSelectedData",
    "game:config_changed": "GameConfigChangedData",
    "game:started": "GameStartedData",
    "game:phase": "GamePhaseData",
    "game:tick": "GameTickData",
    "game:result": "GameResultData",
    "round:closed": "RoundClosedData",
}

#: 버전 게이트를 적용하는 상태 이벤트. 정본의 표를 그대로 옮긴다.
STATE_EVENTS = [
    "room:snapshot", "room:closed", "member:joined", "member:left",
    "member:ready_changed", "member:connection", "game:selected",
    "game:config_changed", "game:started", "game:phase", "game:progress",
    "game:tie", "game:decision_required", "game:result", "round:closed",
]
NOTICE_EVENTS = ["chat:message", "chat:typing", "game:tick", "error"]


def ts_type(annotation) -> str:
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)

    if origin in (types.UnionType, typing.Union):
        parts = [ts_type(a) for a in args if a is not type(None)]
        nullable = any(a is type(None) for a in args)
        joined = " | ".join(dict.fromkeys(parts))
        return f"{joined} | null" if nullable else joined
    if origin in (list, set, tuple):
        return f"{ts_type(args[0]) if args else 'unknown'}[]"
    if origin is dict or annotation is dict:
        return "Record<string, unknown>"
    if annotation is str:
        return "string"
    if annotation is bool:
        return "boolean"
    if annotation in (int, float):
        return "number"
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation.__name__
    return "unknown"


def emit_interface(model: type[BaseModel]) -> str:
    doc = (model.__doc__ or "").strip().splitlines()
    head = doc[0] if doc else ""
    lines = [f"/** {head} */" if head else "", f"export interface {model.__name__} {{"]
    for name, field in model.model_fields.items():
        optional = "" if field.is_required() else "?"
        lines.append(f"  {name}{optional}: {ts_type(field.annotation)};")
    lines.append("}")
    return "\n".join(x for x in lines if x)


def main() -> None:
    models = [
        obj
        for obj in vars(events).values()
        if isinstance(obj, type) and issubclass(obj, BaseModel) and obj is not BaseModel
    ]

    out: list[str] = [
        "// 자동 생성 — 손으로 고치지 않는다.",
        "//   python devtools/gen_socket_types.py > devtools/socket-events.ts",
        "//",
        "// 규약의 정본은 docs/07_api/03_socket_events.md다.",
        "// REST 타입은 /openapi.json에서 openapi-typescript로 뽑는다.",
        "",
        f"export const PROTOCOL_VERSION = {PROTOCOL_VERSION};",
        "",
        "/** S->C 공통 봉투. 성공이든 실패든 같은 모양이다. */",
        "export interface Envelope<E extends string, D> {",
        "  event: E;",
        "  success: boolean;",
        "  code: string;",
        "  message: string | null;",
        "  data: D;",
        "  timestamp: string;",
        "}",
        "",
        "/** C->S 프레임. 이벤트명과 데이터만 담는다. */",
        "export interface Outgoing<E extends string, D> {",
        "  event: E;",
        "  data: D;",
        "}",
        "",
    ]

    out += [emit_interface(m) + "\n" for m in models]

    out.append("/** error 이벤트의 data. event와 requestId를 에코한다. */")
    out.append("export interface ErrorData {")
    out.append("  event: string | null;")
    out.append("  requestId: string | null;")
    out.append("  roomVersion?: number;")
    out.append("}\n")

    def mapping(name: str, table: dict[str, str | None]) -> list[str]:
        rows = [f"export interface {name} {{"]
        for event, model in table.items():
            rows.append(f'  "{event}": {model or "Record<string, never>"};')
        rows.append("}\n")
        return rows

    out += mapping("ClientEvents", CLIENT_EVENTS)
    out += mapping("ServerEvents", {**SERVER_EVENTS, "error": "ErrorData"})

    out += [
        "export type ClientEventName = keyof ClientEvents;",
        "export type ServerEventName = keyof ServerEvents;",
        "",
        "export type ServerFrame = {",
        "  [E in ServerEventName]: Envelope<E, ServerEvents[E]>;",
        "}[ServerEventName];",
        "",
        "export type ClientFrame = {",
        "  [E in ClientEventName]: Outgoing<E, ClientEvents[E]>;",
        "}[ClientEventName];",
        "",
        "/**",
        " * 버전 게이트를 적용하는 상태 이벤트.",
        " * 마지막으로 반영한 번호보다 작거나 같으면 무시한다.",
        " * **통지 이벤트에는 걸지 않는다** — 걸면 방 상태를 바꾸지 않는 이벤트가",
        " * 직전 상태 이벤트와 같은 번호를 달고 나가 전부 버려진다.",
        " */",
        "export const STATE_EVENTS = ["
        + ", ".join(f'"{e}"' for e in STATE_EVENTS)
        + "] as const;",
        "export const NOTICE_EVENTS = ["
        + ", ".join(f'"{e}"' for e in NOTICE_EVENTS)
        + "] as const;",
        "",
        "/** 소켓 종료 코드. **어느 코드에서도 자동 재연결하지 않는다.** */",
        "export const CloseCode = {",
    ]
    for code in CloseCode:
        out.append(f"  {code.name}: {int(code)},")
    out.append("} as const;\n")

    out.append("/** 에러 코드 전량. REST와 소켓이 같은 문자열을 쓴다. */")
    specs = sorted(
        {
            obj.code: obj
            for obj in vars(errors).values()
            if isinstance(obj, errors.ErrorSpec)
        }.values(),
        key=lambda s: s.code,
    )
    out.append("export const ERROR_CODES = [")
    for spec in specs:
        out.append(f'  "{spec.code}",')
    out.append("] as const;")
    out.append("export type ErrorCode = (typeof ERROR_CODES)[number];")

    print("\n".join(out))


if __name__ == "__main__":
    main()
