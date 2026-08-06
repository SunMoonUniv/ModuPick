# 06_database — 데이터베이스

> **대상**: ModuPick — MySQL 8.4 위의 업무 테이블 6종·컬럼·제약·인덱스·트랜잭션·마이그레이션, 그리고 서버 인메모리와의 경계
> **작성일**: 2026-08-02
> **원천**: git 529e312 docs/db.md(MySQL 최종안 v0.4·v0.5 · 1,405줄 · 최종 DDL과 미해결 충돌 목록) · git 529e312 docs/api.md(REST·소켓 계약 584줄) · git ecceb11 docs/03_architecture/01_data_model.md(인메모리 대안 설계) · docs_legacy/requirements.md §3.1 G-13 · §5 NFR-08·NFR-09 · §6 D-13·D-38·D-40 · backend/requirements.txt · backend/app/config.py · frontend/src/screens · [../README.md](../README.md)(고정 기준·전역 불변식)

본 폴더는 ModuPick이 **영속화하는 것과 하지 않는 것의 경계**를 확정하고, 영속 쪽 6테이블의 스키마·제약·트랜잭션을 정본으로 기술한다. ModuPick은 **하이브리드**다 — 밀리초 판정에 쓰는 진행 중 상태는 서버 프로세스 메모리에 두고, 방·참가자·라운드·선택지·투표·확정 결과만 MySQL에 기록한다. **판정 경로에 DB 왕복을 넣지 않는다**는 것이 이 폴더 전체를 관통하는 제약이다.

구현 상태는 전 테이블 ⬜(미착수)다. backend/에는 FastAPI 골격(backend/app/main.py · backend/app/config.py)과 의존성 목록만 있고 모델·마이그레이션·서비스 트랜잭션은 하나도 없다.

## 테이블 6종 (이름 집합 — 대조 정본)

rooms · participants · game_rounds · game_options · votes · game_results

| # | 테이블 | 역할 | 컬럼 | 수명 | 상태 |
|:-:|--------|------|:----:|------|:----:|
| 1 | rooms | 방 — 초대 코드·이름·정원·상태·만료 시각 | 9 | 생성 → 방장 이탈·마지막 참가자 이탈·10분 무활동 중 먼저 오는 것에서 삭제 | ⬜ |
| 2 | participants | 방 참가자 — 신원(닉네임·아바타·소개)·역할·가입 상태 | 15 | 가입 → 퇴장 시 left_at 갱신 → 방 삭제 시 물리 삭제 | ⬜ |
| 3 | game_rounds | 게임 1회 실행 — 게임 종류·설정·시드·영속 상태 | 14 | 시작 → 확정·취소 → 방 삭제 시 물리 삭제 | ⬜ |
| 4 | game_options | 선택지 — 룰렛·저격의 참가자 후보, 사다리 도착 항목, 킹메이커 의견 | 7 | 라운드 생성·의견 제출 → 라운드 삭제 시 동반 삭제 | ⬜ |
| 5 | votes | 투표 — 킹메이커·익명 저격의 한 표 | 8 | 표 접수 → 라운드 삭제 시 동반 삭제 | ⬜ |
| 6 | game_results | 확정 결과 — 게임별 결과 JSON | 4 | 결과 확정 시 1행 → 라운드 삭제 시 동반 삭제 | ⬜ |

**users 테이블을 만들지 않는다.** 로그인·회원가입이 범위 밖이므로 참가자는 방 내부에서만 유효하다. **게임 메타 6종·아바타 30종 카탈로그 테이블도 만들지 않는다** — 배포마다 바뀌지 않는 정적 애플리케이션 데이터이며, 테이블로 두면 시드와 코드가 갈라진다.

## 집계 — 본 폴더가 정본인 값

| 항목 | 값 | 정본 |
|------|-----|------|
| 테이블 | **6개**. 마이그레이션 도구를 두지 않으므로(ADR-28) alembic_version 같은 관리 테이블이 없고, 스키마의 테이블은 이 6개가 전부다 | 본 문서의 이름 집합 |
| 컬럼 | **57개** — 저장 53 + VIRTUAL 생성 4 | 위 표의 컬럼 열 합산(9 + 15 + 14 + 7 + 8 + 4) |
| 제약 | **54개** — PK 6 · UNIQUE 15 · CHECK 24 · FK 9 | [05_constraints_integrity.md](./05_constraints_integrity.md) |
| 인덱스 | **31개** — 제약 부수 21(PK 6 + UNIQUE 15) + 독립 10 | [05_constraints_integrity.md](./05_constraints_integrity.md) |
| VIRTUAL 생성 컬럼 | **4개** — active_nickname · active_avatar_id · active_host_guard · active_round_guard | [02_rooms_participants.md](./02_rooms_participants.md) · [03_game_rounds.md](./03_game_rounds.md) |
| 마이그레이션 | **테이블 6파일** — 0010~0060. db_migration/sql에는 데이터베이스 생성(0000) · 계정(0090) · 검증(verify)이 더 있어 파일은 모두 9개다 | [07_migrations_seed.md](./07_migrations_seed.md) |
| 시드 데이터 | **없다** | [07_migrations_seed.md](./07_migrations_seed.md) |
| 외부 식별자 접두어 | **3종** — mbr_ · rnd_ · opt_ | [05_constraints_integrity.md](./05_constraints_integrity.md) |

기능 수·요구사항 수·화면 수·에러 코드 수 같은 폴더 밖 수치의 정본은 [../README.md](../README.md)다.

## 인메모리 ↔ DB 경계

전역 불변식의 상태 경계를 데이터 단위로 편 표다. **왼쪽 열의 어느 항목도 밀리초 판정 경로에서 DB를 읽거나 쓰지 않는다.**

| 데이터 | 위치 | 근거 |
|--------|------|------|
| 방 메타 — 코드·이름·정원·상태·만료 시각 | **MySQL** | 초대 코드 유일성과 정원을 DB 제약이 강제해야 동시 요청이 갈라지지 않는다 |
| 참가자 신원 — 닉네임·아바타·소개·역할·가입 상태 | **MySQL** | 방 안의 닉네임·아바타 선점을 UNIQUE가 강제한다 |
| 라운드 메타 — 게임 종류·설정 JSON·난수 시드·영속 상태 | **MySQL** | 결과 재현 근거이며 방별 진행 라운드 1개를 UNIQUE가 강제한다 |
| 선택지 — 참가자 후보·사다리 도착 항목·킹메이커 의견 | **MySQL** | 투표의 참조 대상이라 투표와 같은 트랜잭션 경계에 있어야 한다 |
| 투표 — 킹메이커·익명 저격의 한 표 | **MySQL** | 초 단위 입력이고 중복 차단을 UNIQUE가 맡는다 |
| 확정 결과 | **MySQL** | 라운드당 1개를 UNIQUE가 강제해 이중 확정을 막는다 |
| 라운드 phase — READY·PLAYING·TIE·RESULT | 인메모리 | 초당 여러 번 바뀌며 재접속이 없어 복구할 대상이 아니다 |
| 입력 도착 시각 — 눈치게임 UP · 시간초 START/STOP | 인메모리 | **밀리초 판정 경로.** DB 왕복이 들어가면 도착 시각이 아니라 커밋 시각을 재게 된다 |
| 판정창 그룹핑 — 동시 입력을 0.3초 또는 0.5초 창으로 묶음 | 인메모리 | 위와 같은 이유. 확정된 그룹만 결과 JSON에 실린다 |
| 생존자 명단 — 눈치게임 라운드별 잔류자 | 인메모리 | 라운드 사이에만 유효하고 최종 안전 확정 순서만 결과에 남는다 |
| 명단 스냅샷 — 게임 시작 시 고정된 참가자 목록 | 인메모리 | 룰렛·저격은 game_options 행이 스냅샷을 겸하고, 나머지 게임은 결과 JSON에 실려 확정된다 |
| 준비 상태(ready) · 소켓 연결 · 토큰 바인딩 | 인메모리 | 연결 수명과 같고 연결이 끊기면 의미가 사라진다 |
| roomVersion — 이벤트 순서 판정용 증가 정수 | 인메모리 | 재접속이 없어 프로세스 밖에서 이어질 필요가 없다 |
| 채팅 메시지 | **클라이언트 localStorage** | 서버에 대화 기록을 쌓지 않는다(docs_legacy/requirements.md D-40) |
| 타이머 tick·애니메이션 프레임 | 저장하지 않음 | 서버 시각과 시드로 클라이언트가 계산한다 |

- **투표는 DB, 밀리초 입력은 인메모리다.** 킹메이커·익명 저격의 표는 도착 즉시 votes에 기록하고, 눈치게임 UP과 시간초 START/STOP은 인메모리에만 두며 확정 결과만 game_results에 남는다. 게임별 전수는 [04_options_votes_results.md](./04_options_votes_results.md)의 저장 범위 표가 정본이다.
- **판정창 폭과 그룹핑 알고리즘의 정본은 [../05_game_rules/07_nunchi.md](../05_game_rules/07_nunchi.md)다.** 본 폴더는 그 판정이 DB를 거치지 않는다는 경계만 고정하고 창 폭·묶는 규칙을 다시 정의하지 않는다. 판정창은 **0.3초 또는 0.5초**이며 방장이 고른다.
- **인메모리 상태는 재기동에서 복구하지 않는다.** 기동 정리 절차가 남은 방을 전부 회수한다([06_transactions_concurrency.md](./06_transactions_concurrency.md)).
- 이 경계를 무너뜨리는 확장(Redis 도입·인스턴스 증설)은 하지 않는다. 백엔드는 **단일 인스턴스·워커 1개**다.

## 런타임 기준

| 항목 | 기준 | 근거 |
|------|------|------|
| DB | **MySQL 8.4** LTS · InnoDB · utf8mb4 · utf8mb4_0900_ai_ci | git 529e312 docs/db.md §3 |
| 드라이버 | mysql+aiomysql — SQLAlchemy 2.0. 마이그레이션 도구를 두지 않는다(ADR-28). caching_sha2_password 인증에 cryptography가 필요하다 | backend/requirements.txt · backend/app/config.py |
| 시간대 | 서버·DB 세션 모두 +00:00 고정. 저장은 UTC, 표시는 사용자 시간대 | [../README.md](../README.md) 전역 불변식 |
| SQL mode | ONLY_FULL_GROUP_BY · STRICT_TRANS_TABLES · ERROR_FOR_DIVISION_BY_ZERO · NO_ENGINE_SUBSTITUTION | git 529e312 docs/db.md §19 |
| 시각 컬럼 | TIMESTAMP(6) | [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md) |
| 판정 시간 | 부동소수점이 아니라 정수 밀리초 BIGINT. 결과 JSON 안에서만 쓴다 | [../README.md](../README.md) 전역 불변식 |
| DB 계정 | modupick(DML) · modupick_migrator(DDL) 분리. 애플리케이션은 root를 쓰지 않는다 | [07_migrations_seed.md](./07_migrations_seed.md) |

## 폴더 목차

| 파일 | 내용 |
|------|------|
| [01_erd.md](./01_erd.md) | ERD·관계와 카디널리티·CASCADE 경로·다이아몬드 삭제 경로 |
| [02_rooms_participants.md](./02_rooms_participants.md) | rooms · participants 명세 — 초대 코드 발급, PENDING→ACTIVE 수명주기, 닉네임·아바타 선점 |
| [03_game_rounds.md](./03_game_rounds.md) | game_rounds 명세 — 영속 status와 인메모리 phase의 분리, 난수 시드 보관 |
| [04_options_votes_results.md](./04_options_votes_results.md) | game_options · votes · game_results 명세 — 게임별 저장 범위와 config·result JSON 스키마 |
| [05_constraints_integrity.md](./05_constraints_integrity.md) | CHECK 24 · UNIQUE 15 · FK 9 전수 · DB가 강제하는 규칙과 앱이 강제하는 규칙의 분담 |
| [06_transactions_concurrency.md](./06_transactions_concurrency.md) | 트랜잭션 경계·잠금 순서·격리 수준·멱등 성립 근거·경쟁 조건별 처리·서버 재기동 정리 |
| [07_migrations_seed.md](./07_migrations_seed.md) | 마이그레이션 파일 규약(NNNN_{name}.sql)·적용 순서·시드 부재의 근거·DB 계정 |

## 확정한 설계 판단

git 529e312 docs/db.md가 미해결로 남긴 항목을 본 폴더에서 닫았다. 판단의 상세와 근거는 각 문서에 있고, 여기서는 결론만 싣는다.

| 항목 | 확정 | 상세 |
|------|------|------|
| 외부 식별자 | 내부 BIGINT PK를 노출하지 않고 **불투명 문자열 3종**(mbr_ · rnd_ · opt_)을 쓴다 | [05_constraints_integrity.md](./05_constraints_integrity.md) |
| 초대 코드 | **숫자 6자리** CHAR(6). 표시할 때만 MODU- 접두어를 붙인다 | [02_rooms_participants.md](./02_rooms_participants.md) |
| 교차 방 참조 | game_options·votes에 room_id를 두고 **복합 FK로 DB가 직접 차단**한다 | [05_constraints_integrity.md](./05_constraints_integrity.md) |
| 투표 순번 | vote_no를 **ballot_no(결선 차수 1~4) + choice_no(차수 내 표 순번)** 둘로 나눈다 | [04_options_votes_results.md](./04_options_votes_results.md) |
| 승자 컬럼 | game_results.winner_participant_id를 **두지 않는다**. 결과의 단일 기준은 result_data다 | [04_options_votes_results.md](./04_options_votes_results.md) |
| 멱등 키 컬럼 | create_request_id·request_id를 **두지 않는다**. 멱등은 자연 키 UNIQUE가 성립시킨다 | [06_transactions_concurrency.md](./06_transactions_concurrency.md) |
| 결과 보관 | 방 수명 밖으로 **보관하지 않는다**. 예외를 두지 않는 근거를 남긴다 | [04_options_votes_results.md](./04_options_votes_results.md) |
| 재기동 | 기동 시 남은 라운드를 취소하고 **모든 방을 삭제**한다 | [06_transactions_concurrency.md](./06_transactions_concurrency.md) |

## 관련 문서

- 고정 기준·전역 불변식 → [../README.md](../README.md)
- 인메모리↔DB 경계의 아키텍처 서술·판정 엔진 → [../04_architecture/README.md](../04_architecture/README.md)
- 게임 규칙·판정 알고리즘·종료 증명 → [../05_game_rules/README.md](../05_game_rules/README.md)
- REST·WebSocket 계약과 이벤트명 → [../07_api/README.md](../07_api/README.md) · [../07_api/03_socket_events.md](../07_api/03_socket_events.md)
- ID 규약·테이블 표기 → [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)
- 에러 코드 전수 → [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)
- 익명성·개인정보 수명·치팅 방지 → [../11_fairness/README.md](../11_fairness/README.md)
- REQ ↔ 기능 ↔ 화면 ↔ 테이블 추적 → [../03_requirements/11_traceability.md](../03_requirements/11_traceability.md)
