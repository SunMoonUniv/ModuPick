"""예외 → 공통 응답 봉투.

성공이든 실패든 같은 형태로 내려간다. 화면 분기는 HTTP 상태가 아니라 code로 한다.

**message·data에 스택 트레이스·SQL 원문·컬럼명·토큰 값을 싣지 않는다.** 원인을
모르는 실패는 common.internal 하나로 접고 문구를 상황별로 나누지 않는다 — 나누면
서버가 알지 못하는 것을 아는 척하게 된다.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain import errors
from app.domain.errors import DomainError, ErrorSpec
from app.infra.clock import clock
from app.schemas.rest import iso_z

log = logging.getLogger("modupick.api")


def success_body(data: Any) -> dict:
    return {
        "success": True,
        "code": "ok",
        "message": None,
        "data": data,
        "timestamp": iso_z(clock.now()),
    }


def failure_body(spec: ErrorSpec, message: str | None = None) -> dict:
    return {
        "success": False,
        "code": spec.code,
        "message": message or spec.message,
        "data": None,
        "timestamp": iso_z(clock.now()),
    }


def ok(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status, content=success_body(data))


def fail(spec: ErrorSpec, message: str | None = None) -> JSONResponse:
    return JSONResponse(status_code=spec.status, content=failure_body(spec, message))


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError) -> JSONResponse:
        return fail(exc.spec, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # 어느 필드가 틀렸는지는 로그로만 남긴다. 응답에는 컬럼·스키마 정보를 싣지 않는다.
        log.info("validation failed: %s", exc.errors())
        return fail(errors.COMMON_VALIDATION_FAILED)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return fail(errors.ROOM_NOT_FOUND)
        if exc.status_code == 413:
            return fail(errors.COMMON_PAYLOAD_TOO_LARGE)
        if exc.status_code == 401:
            return fail(errors.COMMON_UNAUTHENTICATED)
        return fail(errors.COMMON_INTERNAL)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return fail(errors.COMMON_INTERNAL)
