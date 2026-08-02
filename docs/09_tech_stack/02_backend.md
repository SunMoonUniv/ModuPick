# 02 백엔드 스택

> **대상**: ModuPick(모두픽) — Python + FastAPI 기반 REST·WebSocket 백엔드
> **작성일**: 2026-08-02
> **원천**: backend/requirements.txt · backend/app/main.py · backend/app/config.py · backend/.venv/pyvenv.cfg · git 529e312(docs/db.md §19 MySQL 런타임·Migration 운영 규칙) · [../README.md](../README.md)(고정 기준·전역 불변식)

백엔드 계층의 기술 구성과 실제 설치된 버전을 정한다. docs/README.md의 현재 상태가 명시하듯 backend/는 헬스 체크·소켓 배선 확인용 엔드포인트만 있는 골격이며, 게임 로직·DB 연동·실시간 라우팅은 미착수다. 이 문서는 그 골격이 어떤 기술로 채워질지를 설계 정본으로 기술하며, 미착수 항목은 그렇게 밝힌다. 선정 근거는 [04_decisions_rationale.md](./04_decisions_rationale.md)에 둔다.

## 백엔드 스택

| 항목 | 버전 | 내용 |
|------|------|------|
| 언어 | **Python**(3.14, backend/.venv/pyvenv.cfg 실측) | 백엔드 런타임 |
| 프레임워크 | **FastAPI**(0.141.1) | REST + WebSocket을 한 프로세스에서 다루는 ASGI 프레임워크. Starlette(1.3.1) 위에서 동작한다 |
| ASGI 서버 | uvicorn(0.52.1) + uvloop(0.22.1) + httptools(0.8.0) | 운영 실행 서버. uvloop로 이벤트 루프를, httptools로 HTTP 파싱을 가속한다 |
| 실시간 프로토콜 | **Native WebSocket** — websockets(17.0.1) | Socket.IO 같은 래퍼 없이 FastAPI의 WebSocket을 그대로 쓴다. 프로토콜 구현체는 websockets 패키지다 |
| ORM | **SQLAlchemy**(2.0.51) | 비동기 엔진(create_async_engine) 기반 ORM·Core |
| DB 드라이버(런타임) | **aiomysql**(0.3.2) | 애플리케이션 비동기 경로의 MySQL 드라이버. SQLAlchemy 비동기 엔진과 짝을 이룬다 |
| DB 드라이버(마이그레이션) | PyMySQL(1.2.0) | Alembic이 동기 커넥션으로 DDL을 실행할 때 쓰는 드라이버(§ 데이터 계층 참고) |
| 마이그레이션 | **Alembic**(1.18.5, Mako 1.3.12 포함) | 스키마 버전 관리 |
| 검증·설정 | pydantic(2.13.4) + pydantic-settings(2.14.2) | 요청/응답 스키마 검증과 환경변수 기반 설정 로딩(backend/app/config.py) |
| 환경변수 로딩 | python-dotenv(1.2.2) | .env 파일 로딩(pydantic-settings 경유) |
| 폼·업로드 | python-multipart(0.0.32) | multipart/form-data 파싱(현재 미사용 엔드포인트 대비) |
| 이메일 검증 | email-validator(2.3.0) + dnspython(2.8.0) | pydantic EmailStr 검증용(현재 미사용) |
| HTTP 클라이언트 | httpx(0.28.1) | 테스트 클라이언트·외부 호출용 |
| 에러 트래킹 | sentry-sdk(2.66.1) | 의존성만 설치되어 있고 backend/app/main.py에서 아직 초기화하지 않는다 |
| CLI 도구 | fastapi-cli(0.0.32) · fastapi-cloud-cli(0.23.0), typer(0.27.0) · rich(15.0.0) 기반 | fastapi dev·fastapi run 명령 제공 |

requirements.txt는 위 직접 의존성 외에 anyio · h11 · httpcore · Jinja2 · MarkupSafe · PyYAML · certifi · idna 등 전이 의존성을 포함한다. 이들은 상위 패키지(Starlette·httpx·fastapi-cli)가 요구하는 부속 라이브러리이며 별도로 직접 호출하지 않는다.

## FastAPI 애플리케이션 구성

backend/app/main.py가 정의하는 앱은 현재 3개 표면만 갖는다.

- FastAPI(title="ModuPick API") — 앱 인스턴스.
- CORSMiddleware — allow_origins는 settings.cors_origin_list(콤마로 구분한 CORS_ORIGINS 환경변수를 리스트로 변환), allow_credentials는 True, allow_methods·allow_headers는 전체 허용이다.
- GET /health — {"ok": true} 고정 응답. 배포 헬스 체크용이다.
- WebSocket /ws/echo — 연결을 수락하고 받은 텍스트를 그대로 돌려주는 배선 확인용 엔드포인트다. 코드 주석이 "방 단위 이벤트 라우팅(F-601)으로 교체한다"고 명시하며, 이는 실제 방 이벤트 라우팅이 아직 구현되지 않았다는 뜻이다.

## 설정 관리 — pydantic-settings

backend/app/config.py의 Settings 클래스는 pydantic-settings의 BaseSettings를 상속한다.

- model_config: env_file=".env", extra="ignore"(정의하지 않은 환경변수는 무시).
- database_url: 기본값 mysql+aiomysql://modupick:modupick@127.0.0.1:3306/modupick. 환경변수 DATABASE_URL로 덮어쓴다.
- cors_origins: 기본값 http://localhost:5173. 환경변수 CORS_ORIGINS로 덮어쓰며 콤마로 여러 출처를 나열한다.
- cors_origin_list 프로퍼티가 cors_origins 문자열을 콤마 기준으로 분리·트리밍해 리스트로 반환하고, main.py의 CORSMiddleware가 이 값을 그대로 쓴다.

## 데이터 계층 — SQLAlchemy · aiomysql · Alembic

requirements.txt에는 SQLAlchemy·aiomysql·PyMySQL·Alembic이 모두 있지만, backend/app에는 아직 DB 엔진·세션·모델·alembic.ini·마이그레이션 디렉터리가 없다 — 의존성만 준비된 상태다. 설계 방향은 다음과 같다.

- 애플리케이션 런타임은 SQLAlchemy 비동기 엔진(create_async_engine)에 aiomysql 드라이버를 물려 settings.database_url(mysql+aiomysql://...)로 접속한다.
- Alembic은 동기 드라이버가 필요하므로 마이그레이션 전용 환경(env.py)에서는 같은 접속 정보를 mysql+pymysql:// 스킴으로 바꿔 PyMySQL로 DDL을 실행한다. 이것이 requirements.txt에 aiomysql과 PyMySQL이 함께 있는 이유다.
- 마이그레이션 파일은 배포 시 앱 컨테이너 기동 때마다 자동 실행하지 않고, 배포 절차의 별도 단계(마이그레이션 성공 확인 후 앱 기동)에서 1회 실행한다 — 단일 인스턴스·워커 1개 구성에서도 동시 실행 경쟁을 피하기 위해서다.
- WebSocket 연결 하나가 DB 세션 하나를 계속 점유하지 않는다. 이벤트 처리마다 세션을 열고 짧게 쓴 뒤 반환한다.

MySQL 자체의 설정·연결 풀·Docker Compose 구성은 [03_database_infra.md](./03_database_infra.md)에 둔다.

## 실행 명령

### 개발

```
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

fastapi-cli가 설치되어 있어 fastapi dev app/main.py로도 같은 개발 서버를 띄울 수 있다(자동 리로드는 watchfiles가 담당).

### 운영 — 단일 인스턴스·워커 1개 고정

```
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

워커 수를 1보다 크게 올리지 않는다. 이는 성능 튜닝의 여지가 아니라 설계 제약이다 — docs/README.md의 전역 불변식이 명시하듯 방의 진행 중 상태(라운드 phase·입력 도착 시각·판정창 그룹핑·생존자 명단·소켓 연결)는 서버 프로세스 메모리에 둘 예정이며, 워커·인스턴스가 2개 이상이면 같은 방의 참가자가 서로 다른 프로세스에 붙어 서로의 상태를 보지 못한다. 현재 backend/app/main.py는 아직 방 상태를 갖지 않는 골격이지만, 이후 구현 전 과정에서 이 제약을 유지한다. EC2 배포 형상은 [03_database_infra.md](./03_database_infra.md)에 둔다.

## 관련 문서

- [04_decisions_rationale.md](./04_decisions_rationale.md) — FastAPI·Native WebSocket·aiomysql을 선택한 근거, 워커 1개 고정이 Kubernetes·Redis를 폐기한 근거와 맞물리는 이유
- [03_database_infra.md](./03_database_infra.md) — MySQL 설정·Docker Compose·EC2 배포
- [../04_architecture/README.md](../04_architecture/README.md) — WebSocket 이벤트 라우팅·인메모리↔DB 경계
- [../06_database/README.md](../06_database/README.md) — 테이블 명세
