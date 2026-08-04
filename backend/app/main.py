import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api import rooms
from app.api.errors import register_exception_handlers
from app.config import settings
from app.infra.db.session import dispose, missing_tables
from app.ws import router as ws_router

log = logging.getLogger("modupick")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """기동·종료 절차.

    **스키마가 적용되지 않은 DB에 붙은 채로 뜨지 않는다.** 서버는 기동 시 모든 방을
    삭제하는 정리 절차를 갖게 되므로(1c 이후), 구조가 어긋난 DB에 그 절차를 돌리면
    위험하다. Alembic 리비전 대조를 두지 않는 대신의 최소 확인이다.
    """
    del app
    missing = await missing_tables()
    if missing:
        raise RuntimeError(
            f"스키마가 적용되지 않았습니다. 없는 테이블: {', '.join(missing)} "
            "— backend/sql/schema.sql을 적용한 뒤 다시 기동하세요."
        )
    log.info("업무 테이블 6개 확인됨")
    yield
    await dispose()


app = FastAPI(title="ModuPick API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(rooms.router)


@app.get("/health")
async def health() -> dict[str, bool]:
    """프로세스 생존 확인.

    **DB 연결을 확인하지 않는다.** 방 상태가 프로세스 메모리에 있으므로 DB가 잠시
    끊겨도 진행 중인 판은 계속되어야 하고, 여기서 실패를 보고하면 배포 도구가
    프로세스를 죽여 방을 통째로 날린다. 공통 응답 봉투도 쓰지 않는다 — 로드밸런서가
    읽는 표면이라 제품 규약을 따를 이유가 없다.
    """
    return {"ok": True}


if settings.devtools_enabled:
    _CONSOLE = Path(__file__).resolve().parents[1] / "devtools" / "console.html"

    @app.get("/devtools/console.html", include_in_schema=False)
    async def devtools_console() -> FileResponse:
        """검증 콘솔.

        정적 파일 하나를 API 서버가 직접 내려준다. **같은 오리진에서 열려야** REST가
        CORS를 타지 않고 소켓 URL도 location에서 그대로 유도된다.

        /openapi.json은 프론트 인계 산출물이므로 이 경로를 스키마에서 뺀다.
        """
        return FileResponse(_CONSOLE, media_type="text/html; charset=utf-8")


@app.websocket("/ws/rooms/{code}")
async def room_socket(websocket: WebSocket, code: str) -> None:
    """대기방 진입 이후의 전 실시간 통신.

    토큰은 경로가 아니라 첫 프레임(conn:auth)으로 받는다. 쿼리 문자열에 담으면
    프록시·접근 로그에 토큰이 그대로 남는다.
    """
    await ws_router.serve(websocket, code)
