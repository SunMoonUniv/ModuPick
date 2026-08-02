# 03 데이터베이스·인프라

> **대상**: ModuPick(모두픽) — MySQL 8.4 데이터베이스와 AWS EC2 단일 인스턴스 배포
> **작성일**: 2026-08-02
> **원천**: git 529e312(docs/db.md §3 확정 정책 · §19~22 MySQL 런타임·연결·배포) · git ecceb11(docs/09_deployment/00_overview.md의 Nginx WebSocket 프록시 함정) · backend/app/config.py · [../README.md](../README.md)(고정 기준·전역 불변식) · [02_backend.md](./02_backend.md)

MySQL 데이터베이스 설정과 AWS EC2 위 Docker Compose 배포 형상을 정한다. 이 문서는 아직 저장소에 없는 docker-compose.yml·nginx 설정·EC2 리소스를 **설계 정본**으로 제시하며, 실측된 처리량이 아니라 권고값인 항목은 그렇게 명시한다. 선정 근거는 [04_decisions_rationale.md](./04_decisions_rationale.md)에 둔다.

## MySQL 설정

| 항목 | 값 | 근거 |
|------|-----|------|
| 버전 | **MySQL 8.4**(LTS) | docs_legacy/techstack.md D-49 확정, git 529e312 docs/db.md §3 |
| Docker 이미지 | mysql:8.4 | git 529e312 docs/db.md §19 |
| 스토리지 엔진 | InnoDB | git 529e312 docs/db.md §3·§6 |
| 문자셋·정렬 | utf8mb4 · utf8mb4_0900_ai_ci | git 529e312 docs/db.md §3·§6·§19·§22 |
| 시간대 | UTC(default-time-zone=+00:00). 저장은 UTC, 표시는 사용자 시간대로 변환 | ../README.md 전역 불변식 "시각" · git 529e312 docs/db.md §19 |
| SQL mode | ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION | git 529e312 docs/db.md §19·§22 |
| 격리 수준 | InnoDB 기본 REPEATABLE READ 유지 + 경쟁 행에는 SELECT ... FOR UPDATE | git 529e312 docs/db.md §3 |
| 시각 컬럼 | TIMESTAMP(6) | ../10_glossary/04_id_conventions.md |
| 판정 시간 | 부동소수점이 아닌 정수 밀리초 BIGINT | ../README.md 전역 불변식 "시각" |

## 연결 · 접속 문자열

애플리케이션(FastAPI, 비동기)과 Alembic(마이그레이션, 동기)은 같은 MySQL을 서로 다른 드라이버로 접속한다.

- 애플리케이션: mysql+aiomysql://\<user\>:\<password\>@\<host\>:3306/\<database\>?charset=utf8mb4 — backend/app/config.py의 database_url 기본값이 이 스킴을 쓴다.
- Alembic: mysql+pymysql://\<user\>:\<password\>@\<host\>:3306/\<database\>?charset=utf8mb4 — Alembic의 동기 마이그레이션 컨텍스트가 PyMySQL을 쓴다([02_backend.md](./02_backend.md) 데이터 계층 절 참고).

### 연결 풀 — 권장 시작값

- SQLAlchemy 비동기 엔진에 pool_pre_ping=true를 켠다(끊긴 커넥션을 재사용해 에러를 내는 대신 자동 재연결한다).
- pool_recycle은 MySQL의 wait_timeout보다 짧게 둔다.
- 백엔드가 단일 인스턴스·워커 1개로 고정되어 있으므로([02_backend.md](./02_backend.md)), 총 연결 수는 (pool_size + max_overflow) 하나로 계산한다 — 워커·인스턴스 수를 곱하는 계산은 필요 없다.
- 권장 시작값(실측 전 추정, 트래픽 확인 후 조정): pool_size 5 · max_overflow 10. MySQL 기본 max_connections(151)의 80%를 넘지 않는 범위에서 조정한다.
- connect_timeout·read_timeout·write_timeout·innodb_lock_wait_timeout·max_execution_time은 환경(로컬·운영)별로 지정한다.
- WebSocket 연결 하나가 DB 세션 하나를 계속 점유하지 않는다 — 이벤트 처리 시 세션을 열고 짧게 쓴 뒤 즉시 반환한다.

## Docker Compose 구성

MySQL·백엔드·Nginx 3개 컨테이너를 EC2 한 대 위에서 Docker Compose로 운영한다. 백엔드 컨테이너는 호스트에 포트를 직접 열지 않고 Nginx만 80·443을 연다 — 외부에서 백엔드·DB에 직접 접속할 경로를 두지 않는다.

```yaml
services:
  mysql:
    image: mysql:8.4
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    command:
      - --default-time-zone=+00:00
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_0900_ai_ci
      - --sql-mode=ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    restart: unless-stopped
    environment:
      DATABASE_URL: mysql+aiomysql://${MYSQL_USER}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE}?charset=utf8mb4
      CORS_ORIGINS: https://modupick.example.com
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
    expose:
      - "8000"
    depends_on:
      mysql:
        condition: service_healthy

  nginx:
    image: nginx:latest
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - backend

volumes:
  mysql_data:
```

필수 환경변수는 MYSQL_DATABASE·MYSQL_USER·MYSQL_PASSWORD·MYSQL_ROOT_PASSWORD·DATABASE_URL·CORS_ORIGINS다. 비밀값은 .env 등 컨테이너 밖 파일로 주입하고 저장소에 커밋하지 않는다. 배포 순서는 마이그레이션(Alembic upgrade head) 성공 확인 → 백엔드 컨테이너 기동 → 헬스 체크(GET /health) 확인 → Nginx 트래픽 연결이다.

## EC2 사양 권고

아래는 실측 부하 테스트 결과가 아니라 팀 프로젝트·시연 규모(방 정원 2~10명, 동시 방 수가 크지 않은 MVP)에 대한 시작점 권고다.

| 항목 | 권고 |
|------|------|
| 인스턴스 타입 | t3.small(2 vCPU · 2GiB) 시작점. MySQL·백엔드 컨테이너를 한 인스턴스에서 같이 돌리므로 메모리 여유가 부족하면 t3.medium(4GiB)으로 수직 확장한다 |
| 스토리지 | gp3 EBS 20GB 이상(OS·Docker 이미지·MySQL 데이터 포함) |
| 네트워크 | Elastic IP 고정 — 인스턴스 재시작 시 공인 IP가 바뀌면 도메인 A 레코드가 끊긴다 |
| 보안 그룹 | 22(SSH, 관리자 IP로 제한 권장)·80·443만 공개. 8000(백엔드)·3306(MySQL)은 Docker 내부 네트워크로만 통신하고 외부에 열지 않는다 |
| 확장 방식 | 수직 확장만 가능하다. 방 상태가 프로세스 메모리에 있어 인스턴스를 늘리는 수평 확장은 하지 않는다([04_decisions_rationale.md](./04_decisions_rationale.md)) |

## Nginx — WebSocket 프록시

기본 Nginx 설정으로는 WebSocket 핸드셰이크가 실패한다 — Upgrade·Connection 헤더를 명시적으로 전달해야 한다. 대기방 진입 이후 전 기능이 WebSocket으로 이뤄지므로 이 설정이 빠지면 서비스가 동작하지 않는다.

```nginx
server {
    listen 80;
    server_name api.modupick.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name api.modupick.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.modupick.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.modupick.example.com/privkey.pem;

    location /ws/ {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

proxy_read_timeout을 넉넉히 두지 않으면 Nginx 기본 타임아웃(60초)에 걸려 유휴 상태인 WebSocket 연결이 끊긴다.

## 도메인과 TLS — wss 필수 제약

프론트(Vercel)는 HTTPS로 서빙된다. 브라우저는 HTTPS 페이지에서 로드한 스크립트가 비보안 WebSocket(ws://)에 접속하는 것을 혼합 콘텐츠로 차단하므로, 백엔드는 반드시 wss://로 접속 가능해야 한다. wss는 유효한 TLS 인증서를 요구하고, Let's Encrypt를 포함한 공인 인증기관은 IP 주소가 아닌 도메인에만 인증서를 발급한다. 따라서 배포 전에 **도메인 확보가 선결 조건**이다.

절차:

1. 도메인을 확보한다(구매 또는 보유 도메인의 서브도메인, 예: api.modupick.example.com).
2. EC2에 Elastic IP를 할당한다.
3. DNS에서 그 도메인의 A 레코드가 Elastic IP를 가리키게 설정한다.
4. certbot(Let's Encrypt)으로 해당 도메인의 인증서를 발급한다(webroot 방식 — 위 Nginx 설정의 /.well-known/acme-challenge/ 경로 사용).
5. Nginx가 443에서 TLS를 종단하고 백엔드로는 평문으로 프록시한다.
6. certbot renew를 cron 또는 systemd timer로 주기 실행해 90일 만료 전에 자동 갱신한다.

도메인 없이 EC2 퍼블릭 IP만으로는 신뢰할 수 있는 인증서를 발급받을 수 없어 wss 연결이 성립하지 않는다 — Vercel 프론트가 서비스 전체를 열지 못하는 배포 차단 조건이므로, 배포 계획 초기에 해결한다.

## 관련 문서

- [02_backend.md](./02_backend.md) — SQLAlchemy·aiomysql·Alembic 애플리케이션 계층 구성
- [04_decisions_rationale.md](./04_decisions_rationale.md) — MySQL·단일 인스턴스·Docker Compose를 선택하고 Kubernetes·Redis를 폐기한 근거
- [../04_architecture/README.md](../04_architecture/README.md) — 시스템 구조·배포·기술결정(ADR)
- [../06_database/README.md](../06_database/README.md) — 테이블 명세·ERD
