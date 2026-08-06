# ═══════════════════════════════════════════════════════════════════════════
# ModuPick 백엔드 — FastAPI + Native WebSocket
#
# 베이스는 python:3.14.6-slim으로 고정한다. 호스트의 backend/.venv와 같은
# 버전이라 "로컬에서는 되는데 컨테이너에서는 안 되는" 차이가 인터프리터에서
# 생기지 않는다.
#
# 두 단계로 나눈다. 휠을 컴파일하는 데 필요한 gcc는 builder에만 두고 실행
# 이미지에는 넣지 않는다 — 실행 이미지에 컴파일러가 있으면 크기도 늘고 침해
# 시 쓸 수 있는 도구가 늘어난다.
# ═══════════════════════════════════════════════════════════════════════════

# ── 1단계: 의존성 설치 ─────────────────────────────────────────────────────
FROM python:3.14.6-slim AS builder

# uvloop·httptools·greenlet은 순수 파이썬이 아니다. 파이썬 3.14용 미리 만든
# 휠이 없는 배포판·아키텍처에서는 여기서 컴파일한다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc \
 && rm -rf /var/lib/apt/lists/*

# 의존성만 먼저 복사한다. 소스가 바뀌어도 requirements.txt가 그대로면 이
# 레이어가 캐시에서 나와 재빌드가 몇 초로 끝난다.
COPY requirements.txt /tmp/requirements.txt

RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt


# ── 2단계: 실행 이미지 ─────────────────────────────────────────────────────
FROM python:3.14.6-slim AS runtime

# PYTHONDONTWRITEBYTECODE  읽기 전용으로 돌 때 .pyc 쓰기 실패를 만들지 않는다
# PYTHONUNBUFFERED         stdout을 모아 두지 않는다. docker logs가 실시간이어야 한다
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# root로 돌리지 않는다. 컨테이너 침해가 곧 호스트 uid 0이 되는 경로를 닫는다.
RUN useradd --create-home --shell /usr/sbin/nologin modupick
COPY --chown=modupick:modupick app ./app
COPY --chown=modupick:modupick devtools ./devtools
USER modupick

EXPOSE 8000

# 하트비트는 WebSocket 제어 프레임 ping이다(ADR·07_api/03_socket_events.md).
# 이 두 값은 backend/app/config.py의 ws_ping_interval_s·ws_ping_timeout_s와
# 같아야 한다 — uvicorn에 넘기는 자리가 여기뿐이라 코드가 강제하지 못한다.
#
# --reload를 쓰지 않는다. 파일 감시가 붙으면 재기동이 곧 전 방 소멸인 제품에서
# 실수 한 번이 서비스 중단이 된다.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--ws-ping-interval", "20", \
     "--ws-ping-timeout", "60"]
