from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title="ModuPick API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.websocket("/ws/echo")
async def echo(websocket: WebSocket) -> None:
    """소켓 배선 확인용. 방 단위 이벤트 라우팅(F-601)으로 교체한다."""
    await websocket.accept()
    try:
        while True:
            await websocket.send_text(await websocket.receive_text())
    except WebSocketDisconnect:
        pass
