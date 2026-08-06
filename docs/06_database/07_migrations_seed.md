# 07_migrations_seed — 마이그레이션·시드

> **대상**: ModuPick — 마이그레이션 파일 규약과 적용 순서, 시드 데이터, DB 계정·권한, 배포와 백업 절차
> **작성일**: 2026-08-02
> **개정일**: 2026-08-06 — Alembic을 러너로 쓰는 서술을 걷어내고 파일 위치를 backend/migrations/에서 저장소 루트 db_migration/sql로 옮긴다. [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md) ADR-28이 마이그레이션 도구를 두지 않기로 결정한 것과 어긋난 채였다
> **원천**: git 529e312 docs/db.md §19 MySQL 런타임·Migration 운영 규칙 · §18 권한·보안 · §21 보관·삭제·백업 · §22 배포·환경 운영 기준 · backend/requirements.txt(SQLAlchemy 2.0.51 · aiomysql · PyMySQL · cryptography) · backend/app/config.py(mysql+aiomysql DATABASE_URL) · [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)(마이그레이션 파일명 규약) · [../README.md](../README.md)(배포 형상)

스키마의 정본은 **마이그레이션 파일**이다. 문서의 DDL과 파일이 어긋나면 파일이 이긴 것이 아니라 **둘 다 결함**이며, 같은 변경 단위에서 함께 고친다.

MySQL 8.4의 VIRTUAL 생성 컬럼 · 복합 FK · CHECK는 자동 생성 도구가 정확히 만들어 내지 못한다. 그래서 **DDL은 사람이 쓴 SQL 파일에 두고 마이그레이션 도구를 두지 않는다**(ADR-28). 방이 일회성이고 재기동이 모든 방을 지우므로 기존 데이터를 지키며 구조를 바꿔야 할 상황 자체가 없다 — 리비전 그래프가 푸는 문제가 이 제품에 존재하지 않는다.

## 파일 규약

| 항목 | 규약 |
|------|------|
| 위치 | **db_migration/sql/** — 저장소 루트다. 백엔드와 DB를 같은 Docker 형상으로 올리므로 스키마가 백엔드 코드 안이 아니라 배포 단위에서 읽는 자리에 있어야 한다 |
| 파일명 | **NNNN_{name}.sql** — 4자리 번호 + snake_case 이름 |
| 번호 | 10 단위로 매긴다. 사이에 끼워 넣을 자리를 남기기 위해서다 |
| 내용 | 순수 MySQL DDL. 한 파일이 한 관심사를 담는다. **DROP TABLE을 두지 않는다** |
| 적용 | 번호 오름차순. Docker의 initdb.d가 파일명 알파벳 순으로 같은 순서를 만들고, 이미 떠 있는 DB에는 db_migration/apply.sh가 같은 순서로 적용한다 |
| 검증 | db_migration/sql/verify.sql이 적용 결과를 개수로 대조하고 어긋나면 오류로 멈춘다. 번호를 붙이지 않아 마지막에 실행된다 |
| 이름 | 모든 FK·UNIQUE·CHECK·INDEX에 고정된 이름을 준다. MySQL이 이름을 스스로 정하게 두지 않는다 |
| 이력 테이블 | **두지 않는다.** 리비전 관리가 없으므로 alembic_version 같은 관리 테이블도 없고, 스키마의 테이블은 업무 테이블 6개가 전부다 |

**DDL 파일에 DROP TABLE을 두지 않는 이유**는 재적용의 편의가 운영의 위험과 맞바꿔지기 때문이다. 파일 맨 앞의 DROP 블록은 개발에서는 편하지만 같은 파일이 운영에 닿는 순간 실수 한 번이 전건 삭제가 된다. 다시 만들어야 하면 apply.sh --fresh처럼 지우려는 의도를 그 자리에서 밝힌다.

**계정·권한(0090_grants.sql)은 마이그레이션이 아니다.** 스키마 이력과 별개로 환경마다 다시 적용하며, 번호를 0090으로 떨어뜨려 둔 것은 initdb.d의 실행 순서를 맞추기 위해서다.

## 적용 순서 — 6파일

FK가 참조하는 테이블이 먼저 있어야 하므로 순서를 바꿀 수 없다.

| 순서 | 파일 | 만드는 것 | 선행 의존 |
|:----:|------|----------|----------|
| 1 | 0010_rooms.sql | rooms — PK 1 · UNIQUE 1 · CHECK 5 · 인덱스 1 | 없음 |
| 2 | 0020_participants.sql | participants — PK 1 · UNIQUE 5 · CHECK 8 · FK 1 · 인덱스 2 · VIRTUAL 3 | rooms |
| 3 | 0030_game_rounds.sql | game_rounds — PK 1 · UNIQUE 3 · CHECK 6 · FK 2 · 인덱스 2 · VIRTUAL 1 | rooms · participants(id, room_id) |
| 4 | 0040_game_options.sql | game_options — PK 1 · UNIQUE 4 · CHECK 3 · FK 2 · 인덱스 2 | game_rounds(id, room_id) · participants(id, room_id) |
| 5 | 0050_votes.sql | votes — PK 1 · UNIQUE 1 · CHECK 2 · FK 3 · 인덱스 3 | game_rounds · participants · game_options(id, game_round_id) |
| 6 | 0060_game_results.sql | game_results — PK 1 · UNIQUE 1 · FK 1 | game_rounds |

합계는 PK 6 · UNIQUE 15 · CHECK 24 · FK 9 · 독립 인덱스 10 · VIRTUAL 생성 컬럼 4이며 [05_constraints_integrity.md](./05_constraints_integrity.md)의 전수와 일치한다.

- **인덱스를 별도 파일로 분리하지 않는다.** 인덱스가 10개뿐이고 전부 특정 테이블에 묶여 있어, 테이블 정의와 같은 파일에 두는 편이 리뷰에서 빠뜨릴 여지가 적다.
- **각 파일은 CREATE TABLE 한 문장이다.** ALTER로 나눠 붙이지 않는다. 나누면 중간 실패 시 반쪽 상태가 남는다.
- 각 DDL 전문은 [02_rooms_participants.md](./02_rooms_participants.md) · [03_game_rounds.md](./03_game_rounds.md) · [04_options_votes_results.md](./04_options_votes_results.md)에 있다.

## 운영 규칙

| # | 규칙 |
|:-:|------|
| 1 | 구조를 바꾸면 해당 파일을 고치고 다시 적용한다. 리비전이 없으므로 변경분을 새 번호로 쌓지 않는다 — **번호를 추가하는 것은 테이블이 새로 생길 때뿐이다** |
| 2 | 자동 생성 결과는 **후보안으로만** 쓰고 DDL을 사람이 검토한다. 특히 생성 컬럼 식·복합 UNIQUE·복합 FK는 실제 생성 SQL을 눈으로 확인한다 |
| 3 | 문서의 DDL과 파일을 같은 변경 단위에서 함께 고친다. 한쪽만 고친 상태를 커밋하지 않는다 |
| 4 | 파괴적 변경 전에는 백업과 **복원 절차를 먼저 검증한다** |
| 5 | 빈 MySQL 8.4에서 전체 적용이 성공하는지 확인한다 |
| 6 | 적용한 뒤에는 verify.sql을 돌린다. **개수 검증을 건너뛴 적용은 적용하지 않은 것과 같다** |
| 7 | 시드 데이터를 DDL 파일에 넣지 않는다 |
| 8 | 마이그레이션은 서버 프로세스 시작마다 실행하지 않고 **배포 전용 단계에서 한 번만** 실행한다 |
| 9 | **MySQL DDL은 암묵적 커밋을 일으킬 수 있다.** 중간 실패를 자동 되돌리기에만 맡기지 말고 실패 후 상태 확인과 수동 정리 절차를 함께 기록한다 |
| 10 | **데이터를 지키며 구조를 바꿔야 하는 요구가 생기면 ADR-28을 먼저 뒤집는다.** 무중단 컬럼 이관(추가 → 양쪽 코드 호환 → 데이터 이관 → 구 컬럼 제거)이나 되돌리기 절차를 리비전 없이 흉내 내지 않는다 |

## 시드 데이터

**업무 테이블 6개에 시드가 없다.** 이것이 정본이며, 근거를 남긴다.

| 후보 | 판단 |
|------|------|
| 방·참가자·라운드 | 전부 런타임 생성물이다. 미리 넣을 값이 없다 |
| 게임 메타 6종 | **테이블을 만들지 않는다.** 이름·부제·규칙 문구·설정 스키마는 배포마다 코드와 함께 움직이는 정적 데이터이고, 테이블로 두면 코드와 시드가 갈라진다 |
| 아바타 카탈로그 30종 | **테이블을 만들지 않는다.** 이미지 자산이 frontend/src/assets/avatars에 있고 참가자의 아바타 선점은 participants.avatar_id가 판정한다. 카탈로그 행은 이미지 파일 목록의 사본일 뿐이다 |
| 주제 템플릿 | 위와 같다. 정적 애플리케이션 데이터다 |

- **정적 데이터를 테이블로 만들지 않는 판단의 대가**는 값을 바꿀 때 배포가 필요하다는 것이다. 게임 6종·아바타 30종은 배포 없이 바뀌어야 할 이유가 없고, 오히려 배포 없이 바뀌면 프론트엔드 자산과 어긋난다.
- **로컬 개발용 표본 데이터**(방 1개 + 참가자 3명 등)가 필요하면 마이그레이션이 아니라 별도 명령으로 둔다. 운영에서 실행되지 않는 경로에 놓는다.

## DB 계정·권한

| 계정 | 권한 | 용도 |
|------|------|------|
| modupick | 업무 테이블에 필요한 SELECT · INSERT · UPDATE · DELETE만. **participants에는 DELETE를 주지 않는다** | 애플리케이션 |
| modupick_migrator | 배포 마이그레이션에 필요한 DDL 권한 | 마이그레이션 실행 |

- **애플리케이션은 root나 ALL PRIVILEGES 계정을 쓰지 않는다.**
- **participants DELETE 권한을 회수하는 것이 참가자 물리 삭제를 막는 마지막 방어선이다.** 애플리케이션에 삭제 메서드를 두지 않는 것이 첫째, 통합 테스트가 둘째, 권한 회수가 셋째다. 방 삭제는 rooms 행을 지우는 것이고 하위 삭제는 InnoDB가 수행하므로 앱이 participants DELETE 권한을 가질 이유가 없다 — **다만 이 전제(CASCADE가 자식 테이블 권한을 요구하지 않는다)는 배포 전 실제 MySQL 8.4에서 확인한다.**
- 로컬·테스트·운영 DB와 계정을 분리한다. 운영 DB를 로컬 개발에서 직접 쓰지 않는다.
- 비밀값은 저장소에 넣지 않고 배포 환경의 비밀 저장소로 주입한다. 운영 연결은 TLS를 쓴다.
- 로그에 DB 비밀번호·연결 URL·초대 코드 전체·소개 원문·투표자 식별값을 남기지 않는다.

## 배포 절차

배포 형상은 **프론트 Vercel · 백엔드 AWS EC2 단일 인스턴스·워커 1개 · DB MySQL 8.4**다. 수평 확장과 무중단 배포를 하지 않는다.

| 순서 | 단계 |
|:----:|------|
| 1 | 백업을 만든다(파괴적 변경이면 복원까지 검증한 뒤 진행) |
| 2 | 마이그레이션을 **배포 전용 단계에서 1회** 실행하고 verify.sql이 통과하는지 확인한다 |
| 3 | 백엔드를 재기동한다 |
| 4 | 기동 정리가 남은 라운드를 취소하고 모든 방을 삭제한다([06_transactions_concurrency.md](./06_transactions_concurrency.md)) |
| 5 | readiness 확인 — DB 연결과 업무 테이블 6개의 존재를 본다. **정리가 끝나기 전에는 통과하지 않는다** |
| 6 | 트래픽을 받는다 |

- **배포는 곧 전 방 종료다.** 진행 중이던 방이 끊기므로 사용이 적은 시간대에 배포한다.
- liveness는 프로세스 생존만 확인하고, readiness는 DB 연결과 업무 테이블 6개의 존재를 확인한다. 리비전 대조는 두지 않는다(ADR-28).
- 필수 환경 변수는 DATABASE_URL과 CORS 허용 출처다(backend/app/config.py). 실제 비밀값을 예시 파일에 넣지 않는다.

## 백업·복원

| 항목 | 기준 |
|------|------|
| 주기 | 1일 1회. 파괴적 마이그레이션 직전에 추가로 1회 |
| 방식 | 트랜잭션 일관성을 보장하는 덤프 |
| 검증 | **파일 존재만 확인하지 않는다.** 별도 MySQL 인스턴스에 복원해 테이블 수·행 수·FK 무결성을 확인한다 |
| 복구 범위 | 이미 삭제된 방 데이터를 사용자에게 복구해 주는 기능은 **제공하지 않는다** |
| 보존·암호화 | 보존 기간·암호화·저장 위치는 배포 환경 확정 시 인프라 운영 문서에 기록한다 |

**백업의 목적은 사용자 데이터 복구가 아니라 운영 사고 복구다.** 방은 10분이면 사라지고 결과도 방과 함께 삭제되므로 복원할 가치가 있는 사용자 데이터가 존재하지 않는다. 백업은 마이그레이션 실패나 인스턴스 손상에서 **스키마와 서비스를 되살리기 위한 것**이다.

## 마이그레이션 검증

빈 MySQL 8.4에서 실제로 실행해 확인하는 항목이다. 확인 전에는 "적용된다"고 적지 않는다.

| # | 확인 |
|:-:|------|
| 1 | 빈 MySQL 8.4에서 0000~0090 전체 적용이 성공한다 |
| 2 | 이미 스키마가 있는 DB에 apply.sh --fresh로 재적용이 성공한다 |
| 3 | verify.sql이 개수 불일치를 **오류로** 잡아낸다. 경고만 남기고 넘어가지 않는다 |
| 4 | 모든 PK가 BIGINT UNSIGNED AUTO_INCREMENT, 모든 FK가 같은 타입으로 만들어진다 |
| 5 | VIRTUAL 생성 컬럼 4종과 그 위의 UNIQUE 4종이 실제로 만들어진다 |
| 6 | 복합 FK 6종이 만들어지고 어느 한 컬럼이 NULL인 행이 통과한다 |
| 7 | 방 삭제 CASCADE가 다이아몬드 경로에서 오류를 내지 않는다 |
| 8 | 세션 시간대가 +00:00이고 TIMESTAMP(6) 정밀도가 유지된다 |
| 9 | modupick 계정으로 DDL을 실행할 수 없고, 같은 계정으로 rooms를 삭제할 때 하위 CASCADE가 동작한다 |
| 10 | 중간 실패 후 문서에 적힌 수동 정리 절차로 일관된 상태를 되찾을 수 있다 |

제약 동작 자체의 검증 목록은 [05_constraints_integrity.md](./05_constraints_integrity.md)에 있다.

## 관련 문서

- 제약·인덱스 전수와 배포 전 실행 검증 → [05_constraints_integrity.md](./05_constraints_integrity.md)
- 기동 정리 절차·만료 스윕 → [06_transactions_concurrency.md](./06_transactions_concurrency.md)
- 테이블별 DDL 전문 → [02_rooms_participants.md](./02_rooms_participants.md) · [03_game_rounds.md](./03_game_rounds.md) · [04_options_votes_results.md](./04_options_votes_results.md)
- 마이그레이션 파일명 규약 → [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)
- 기술 스택·배포 형상 → [../09_tech_stack/README.md](../09_tech_stack/README.md)
- 배포·운영 기술 결정 → [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md)
