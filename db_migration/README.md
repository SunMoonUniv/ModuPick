# db_migration — MySQL 8.4 스키마 구축

> **대상**: Docker로 띄운 MySQL 8.4에 ModuPick 업무 테이블 6개와 계정 2개를 만드는 SQL
> **작성일**: 2026-08-06
> **정본**: docs/06_database/ — 02_rooms_participants.md · 03_game_rounds.md · 04_options_votes_results.md(DDL) · 05_constraints_integrity.md(제약 전수) · 07_migrations_seed.md(파일 규약·계정·배포)

**여기가 스키마의 정본이다**(ADR-28). 번호 오름차순으로 적용하면 빈 MySQL 8.4에 스키마가 선다. 파일명 규약과 분할 단위는 07_migrations_seed.md 「적용 순서 — 6파일」을 그대로 따랐다.

## 파일

SQL은 전부 sql/ 아래에 있다. **apply.sh와 README를 그 바깥에 두는 것이 중요하다** — Docker 엔트리포인트는 initdb.d 안의 .sh도 실행하므로, 같은 자리에 있으면 컨테이너 초기화 중에 apply.sh가 저 자신을 실행한다.

| 파일 | 만드는 것 | 선행 의존 |
|------|----------|----------|
| sql/0000_database.sql | 데이터베이스 modupick | 없음 |
| sql/0010_rooms.sql | rooms — PK 1 · UNIQUE 1 · CHECK 5 · 인덱스 1 | 없음 |
| sql/0020_participants.sql | participants — PK 1 · UNIQUE 5 · CHECK 8 · FK 1 · 인덱스 2 · VIRTUAL 3 | rooms |
| sql/0030_game_rounds.sql | game_rounds — PK 1 · UNIQUE 3 · CHECK 6 · FK 2 · 인덱스 2 · VIRTUAL 1 | rooms · participants(id, room_id) |
| sql/0040_game_options.sql | game_options — PK 1 · UNIQUE 4 · CHECK 3 · FK 2 · 인덱스 2 | game_rounds(id, room_id) · participants(id, room_id) |
| sql/0050_votes.sql | votes — PK 1 · UNIQUE 1 · CHECK 2 · FK 3 · 인덱스 3 | game_rounds · participants · game_options(id, game_round_id) |
| sql/0060_game_results.sql | game_results — PK 1 · UNIQUE 1 · FK 1 | game_rounds |
| sql/0090_grants.sql | 계정 modupick · modupick_migrator | 위 전부 |
| sql/verify.sql | 검증(실패하면 오류로 멈춘다) | 위 전부 |
| apply.sh | 위를 순서대로 적용하고 검증까지 실행 | — |

**DDL 파일에 DROP TABLE이 없다.** 재적용의 편의가 운영의 위험과 맞바꿔지기 때문이다 — 파일 맨 앞의 DROP 블록은 개발에서는 편하지만 같은 파일이 운영에 닿는 순간 실수 한 번이 전건 삭제가 된다. 다시 만들려면 apply.sh --fresh처럼 지우려는 의도를 그 자리에서 밝힌다.

합계는 **테이블 6 · PK 6 · UNIQUE 15 · CHECK 24 · FK 9(전부 CASCADE) · 독립 인덱스 10 · VIRTUAL 생성 컬럼 4**이며 05_constraints_integrity.md의 전수와 일치한다.

**시드 데이터가 없다.** 방·참가자·라운드는 전부 런타임 생성물이고, 게임 메타 6종·아바타 30종·주제 템플릿은 테이블로 만들지 않는다(07_migrations_seed.md 「시드 데이터」).

## 적용

### 1) Docker initdb.d — 컨테이너를 처음 띄울 때 자동 적용

sql/ 을 마운트한다. MySQL 엔트리포인트가 **파일명 알파벳 순**으로 실행하므로 0000 → 0010 → … → 0090 → verify 순서가 그대로 성립한다. 저장소 루트의 docker-compose.yml이 이미 이렇게 설정돼 있다.

```yaml
services:
  database:
    image: mysql:8.4
    container_name: modupick-db
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?}
      MYSQL_DATABASE: modupick
    command:
      - --default-time-zone=+00:00
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_0900_ai_ci
    volumes:
      - db-data:/var/lib/mysql
      - ./db_migration/sql:/docker-entrypoint-initdb.d:ro
```

**initdb.d는 데이터 디렉터리가 비어 있을 때만 실행된다.** 스키마를 바꿨으면 `docker compose down -v` 로 볼륨을 지우고 다시 띄운다. ModuPick은 재기동마다 모든 방을 삭제하므로 잃을 데이터가 구조적으로 없다.

### 2) apply.sh — 이미 떠 있는 DB에 적용

```bash
# 실행 중인 컨테이너 안에서. devroot는 .env.example의 로컬 기본값이고,
# bootstrap.sh로 세운 서버는 root 비밀번호가 무작위라 .env에서 읽어야 한다.
MYSQL_PASSWORD=devroot ./apply.sh --container modupick-db
MYSQL_PASSWORD="$(grep '^MYSQL_ROOT_PASSWORD=' ../.env | cut -d= -f2-)" \
  ./apply.sh --container modupick-db

# 원격(EC2·RDS)에 mysql 클라이언트로
MYSQL_HOST=10.0.1.20 MYSQL_PASSWORD=... \
MODUPICK_APP_PASSWORD=... MODUPICK_MIGRATOR_PASSWORD=... ./apply.sh

./apply.sh --fresh        # 데이터베이스를 지우고 다시 만든다(확인을 묻는다)
./apply.sh --verify-only  # 적용 없이 검증만
```

### 3) 손으로

```bash
mysql -h HOST -u root -p < sql/0000_database.sql
for f in sql/0010_*.sql sql/0020_*.sql sql/0030_*.sql sql/0040_*.sql sql/0050_*.sql \
         sql/0060_*.sql sql/0090_grants.sql; do
  mysql -h HOST -u root -p modupick < "$f"
done
mysql -h HOST -u root -p modupick < sql/verify.sql
```

## 계정

| 계정 | 권한 | 용도 |
|------|------|------|
| modupick | 업무 테이블 SELECT · INSERT · UPDATE + rooms · game_rounds · game_options · votes · game_results DELETE. **participants에는 DELETE 없음** | 애플리케이션 런타임 |
| modupick_migrator | 위 + CREATE · DROP · ALTER · INDEX · REFERENCES | 배포 마이그레이션 전용 |

애플리케이션은 root나 ALL PRIVILEGES 계정을 쓰지 않는다. participants DELETE를 회수하는 것이 참가자 물리 삭제를 막는 마지막 방어선이다 — 참가자 행을 지우면 그 사람의 표가 CASCADE로 함께 사라져 개표가 어긋난다.

**0090_grants.sql의 비밀번호는 로컬 개발 기본값이다.** 운영에서는 `MODUPICK_APP_PASSWORD` · `MODUPICK_MIGRATOR_PASSWORD` 를 apply.sh에 주거나, 계정 생성 후 `ALTER USER`로 바꾼다. `CREATE USER IF NOT EXISTS`는 계정이 이미 있으면 비밀번호를 바꾸지 않으므로 재적용으로는 교체되지 않는다.

## 검증

`verify.sql`은 개수가 어긋나면 `SIGNAL`로 오류를 내 배포를 멈춘다. 검증이 실패해도 계속 진행되면 검증하지 않은 것과 같다.

확인 항목은 테이블 6 · PK 6 · UNIQUE 15 · CHECK 24 · FK 9 · VIRTUAL 4 · 전 FK가 CASCADE · 전 PK가 BIGINT UNSIGNED AUTO_INCREMENT · **세션 시간대가 실제로 UTC**다.

마지막 항목은 `time_zone` 설정값이 아니라 `NOW()`와 `UTC_TIMESTAMP()`의 차이를 본다. 실패하면 MySQL을 `--default-time-zone=+00:00`으로 띄운다 — 저장이 UTC가 아니면 만료·감사 시각이 통째로 밀린다.

**제약이 실제로 값을 거절하는지**는 개수 검증으로 알 수 없다. 05_constraints_integrity.md 「배포 전 실행 검증」 11건은 verify.sql 끝에 목록으로 남겨 두었고, 실제 검사는 backend/tests가 담당한다.

## 정본 일원화 — 2026-08-06

이 폴더를 만들면서 **backend/sql/schema.sql·grants.sql을 제거하고 정본을 여기로 옮겼다.** 같은 6테이블을 두 곳이 정의하면 언젠가 조용히 갈라지기 때문이다. 같은 변경 단위에서 함께 고친 것은 다음과 같다.

| 대상 | 변경 |
|------|------|
| backend/sql/ | 제거(schema.sql · grants.sql) |
| backend/docker-compose.yml | initdb.d 마운트를 ../db_migration/sql로 전환. 프로젝트 이름을 modupick으로 고정 |
| backend/app/main.py · infra/db/tables.py · config.py | 스키마 안내 경로를 db_migration으로 |
| backend/tests/conftest.py | 외부 ID 정규식의 출처 주석을 0020_participants.sql로 |
| docs/04_architecture/08_decision_records.md | **ADR-28 개정** — 단일 schema.sql에서 번호 붙은 파일 분할로 |
| docs/06_database/07_migrations_seed.md | 파일 위치를 db_migration/sql로, Alembic 러너 서술을 제거 |
| docs/06_database/README.md | alembic_version 언급 제거 |

### 남은 불일치 — 이 폴더 밖의 문제

**ADR-25가 ADR-28과 충돌한 채로 남아 있다.** ADR-25는 "스키마 마이그레이션은 Alembic으로 배포 단계에서 1회 실행한다"이고 ADR-28은 "마이그레이션 도구를 두지 않는다"이다. 이 충돌은 이 폴더를 만들기 전부터 있었고, 같은 뿌리에서 아래가 함께 어긋나 있다.

| 위치 | 내용 |
|------|------|
| docs/04_architecture/08_decision_records.md | ADR-25가 Alembic 채택을 결정한 채로 남아 있다. ADR-25의 「파급」은 마이그레이션 규약 정본을 06_database/README.md로 가리키지만 실제 정본은 07_migrations_seed.md다. 메타 블록과 도입부는 ADR이 27건이라고 적었지만 실제로는 ADR-37까지 있고, 결정 인덱스 표에 ADR-28~37이 등재되지 않았다 |
| docs/04_architecture/07_deployment_topology.md | 배포 절차가 "마이그레이션 1회 실행(ADR-25)"과 "readiness = 리비전 일치"를 든다. 필수 환경 변수로 MYSQL_USER·MYSQL_PASSWORD를 드는데 루트 compose는 쓰지 않는다 |
| docs/09_tech_stack/02_backend.md · 03_database_infra.md · 04_decisions_rationale.md · README.md | Alembic을 채택 스택으로 서술하고 배포 순서를 "Alembic upgrade head"로 적었다. 03_database_infra.md의 설계 정본 compose는 실물과 전면 불일치한다(서비스명 mysql·nginx · MYSQL_USER로 계정 생성 · initdb.d 없음). 02_backend.md는 DB 기본 포트를 3306으로 적었고(실제 3307), uvicorn 실행 명령에 --ws-ping-interval·--ws-ping-timeout이 빠졌으며, 의존성 표에 cryptography가 없다 |
| docs/01_overview/05_priorities_roadmap.md | 다음 작업으로 alembic.ini와 마이그레이션 디렉터리를 든다 |
| README.md | 스택 표에 Alembic이 있다 |
| backend/requirements.txt | alembic 1.18.5와 Mako가 설치돼 있으나 쓰이지 않는다 |
| backend/.env.example | DATABASE_URL의 포트가 3306이다. 실제는 3307이며 계정만 맞아떨어져 옳은 파일처럼 보인다 |
| .gitignore | `legacy/`와 그 주석이 가리키는 docs/DECISIONS.md가 둘 다 없다(실제는 docs_legacy/이며 추적 중). `.github`를 통째로 무시해 **새로 추가하는 워크플로 파일이 조용히 빠진다** — 기존 4개는 이미 추적 중이라 지금은 드러나지 않는다 |
| frontend/README.md | 정본으로 인용한 docs/draft_design 폴더가 없다 |

**정리하려면 ADR-25를 폐기하고 위 문서들을 같은 변경 단위에서 갱신해야 한다.** 이 폴더의 작업 범위를 넘어서므로 손대지 않았다.

### 비밀값 정책의 예외 — 2026-08-06

07_migrations_seed.md 「DB 계정·권한」은 "비밀값은 저장소에 넣지 않고 배포 환경의 비밀 저장소로 주입한다"고 적었다. **애플리케이션 계정은 이 규칙의 예외이며, 사용자 이름도 비밀번호도 modupick으로 저장소에 고정돼 있다.** 운영자가 명시적으로 선택한 값이다.

그 대가를 감수할 수 있다고 본 근거는 둘이다. (1) DB 포트가 127.0.0.1에만 바인딩되어 인스턴스 밖에서 이 계정으로 붙을 경로가 없다. (2) 이 계정에는 DDL 권한이 없고 participants DELETE도 없어, 탈취되어도 스키마를 바꾸거나 참가자 기록을 지울 수 없다.

**root 비밀번호에는 이 예외를 적용하지 않는다.** bootstrap.sh가 무작위로 만들어 .env에 적고 chmod 600으로 잠근다.

## 관련 문서

- DDL 전문·컬럼 사전 → docs/06_database/02_rooms_participants.md · 03_game_rounds.md · 04_options_votes_results.md
- 제약 전수·배포 전 실행 검증 11건 → docs/06_database/05_constraints_integrity.md
- 계정·권한·배포·백업 절차 → docs/06_database/07_migrations_seed.md
- 스키마 관리 방식 결정 → docs/04_architecture/08_decision_records.md ADR-28
