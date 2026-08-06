import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app import tasks
from app.api import games, rooms
from app.api.errors import register_exception_handlers
from app.config import settings
from app.infra.db.session import dispose, missing_tables
from app.services import room_service
from app.ws import router as ws_router

log = logging.getLogger("modupick")


def _configure_logging() -> None:
    """modupick 로거가 실제로 내보내게 한다.

    **기동 정리 건수는 예기치 않은 재기동을 사후에 알 수 있는 유일한 흔적이다.**
    핸들러가 없으면 그 기록이 어디에도 남지 않는다 — uvicorn의 기본 설정은 자기
    로거만 붙이고 애플리케이션 로거는 건드리지 않는다.
    """
    logger = logging.getLogger("modupick")
    if logger.handlers:
        return
    handler = logging.StreamHandler()

    # **로그 메시지가 전부 한글이다.** 윈도우에서 표준 오류를 파일이나 파이프로
    # 넘기면 스트림 인코딩이 콘솔이 아니라 로케일 기본값(cp949)이 되고, 거기 없는
    # 문자를 만나면 UnicodeEncodeError가 로깅 호출부까지 올라온다. 로그 한 줄
    # 때문에 요청 처리가 죽는 일은 없어야 하므로 그 자리에서 치환하게 둔다.
    stream = getattr(handler, "stream", None)
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(errors="backslashreplace")
        except (ValueError, OSError):
            pass

    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s — %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(settings.log_level.upper())


_configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """기동·종료 절차.

    순서가 규정돼 있다 — **정리가 끝나기 전에는 트래픽을 받지 않는다.** 정리 도중에
    만들어진 새 방이 삭제 대상에 섞이지 않게 하려는 것이다.

        스키마 확인 → 고아 방 정리 → 스케줄러 기동 → (트래픽 수용)

    스키마 확인이 앞에 오는 이유는 그다음이 **전건 삭제**이기 때문이다. 구조가 어긋난
    DB에 그 절차를 돌리면 위험하다. Alembic 리비전 대조를 두지 않는 대신의 확인이다.
    """
    del app
    missing = await missing_tables()
    if missing:
        raise RuntimeError(
            f"스키마가 적용되지 않았습니다. 없는 테이블: {', '.join(missing)} "
            "— backend/sql/schema.sql을 적용한 뒤 다시 기동하세요."
        )
    log.info("업무 테이블 6개 확인됨")

    orphans = await room_service.purge_orphan_rooms()
    if orphans:
        log.warning("기동 정리 — 고아 방 %d개 삭제. 예기치 않은 재기동의 흔적이다", orphans)

    sweeper = asyncio.create_task(tasks.run_forever())
    log.info("청소 스케줄러 기동 — 주기 %.0f초", settings.sweep_interval_s)

    yield

    sweeper.cancel()
    with suppress(asyncio.CancelledError):
        await sweeper
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
app.include_router(games.router)


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
