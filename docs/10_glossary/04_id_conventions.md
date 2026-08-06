# ID·표기 규약

> **대상**: ModuPick 전 문서·구현의 식별자·번호 체계
> **작성일**: 2026-08-02
> **원천**: [../README.md](../README.md)(고정 기준·ID 규약) · [../CLAUDE.md](../CLAUDE.md)(작성 규약) · docs_legacy/requirements.md §9.1(구 ID 규칙)

기능·요구사항·화면·에러·결정 식별자의 형식을 단일하게 규정한다. 문서 간 식별자가 어긋나지 않도록 본 규약이 정본이며, 새 ID는 각 소유 문서에서만 채번한다. 본 문서는 **형식과 매핑 규약만** 규정하고 개수를 자체 인용하지 않는다 — 개수는 각 정본 문서가 확정하고 [../README.md](../README.md)가 싣는다.

## ID 형식 요약

| 종류 | 형식 | 예 | 채번 정본 |
|------|------|-----|-----------|
| 기능 ID | F-{접두사}-NN | F-LOBBY-03 | [../02_features](../02_features/README.md)의 해당 도메인 파일 |
| 요구사항 ID | REQ-{접두사}-NN | REQ-NUNCHI-02 | [../03_requirements](../03_requirements/README.md)의 해당 도메인 파일 |
| 화면 코드 | {도메인}-{의미} | LOBBY-MAIN | [../08_screen/README.md](../08_screen/README.md) |
| 에러 코드 | {namespace}.{snake_case} + HTTP 상태 | room.not_found | [02_error_codes.md](./02_error_codes.md) |
| 제품 결정 | D-NN | D-07 | [../01_overview/06_design_decisions.md](../01_overview/06_design_decisions.md) |
| 기술 결정 | ADR-NN | ADR-02 | [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md) |
| 인수 기준 | AC-NN | AC-03 | [../03_requirements/10_acceptance_criteria.md](../03_requirements/10_acceptance_criteria.md) |
| 참가자 외부 ID | mbr_ + base62 16~36자 | mbr_a1B2c3D4e5F6g7H8i9J0k1 | [../06_database/02_rooms_participants.md](../06_database/02_rooms_participants.md) |
| 판 외부 ID | rnd_ + base62 | rnd_D6e7F8g9H0i1J2k3L4m5N6 | [../06_database/03_game_rounds.md](../06_database/03_game_rounds.md) |
| 선택지 외부 ID | opt_ + base62 | opt_O7p8Q9r0S1t2U3v4W5x6Y7 | [../06_database/04_options_votes_results.md](../06_database/04_options_votes_results.md) |
| 테이블·컬럼 | snake_case | game_rounds | [../06_database](../06_database/README.md) |
| 마이그레이션 | NNNN_{name}.sql(4자리) | 0010_rooms.sql | [../06_database/07_migrations_seed.md](../06_database/07_migrations_seed.md) |

각 ID는 **자기 정본 문서에서만** 채번한다. 타 폴더 문서는 참조만 하며 정본 밖에서 새 번호를 만들지 않는다.

외부 식별자(mbr_ · rnd_ · opt_)는 **base62**(영문 대소문자 + 숫자)로 뽑는다. 파이썬의 secrets.token_urlsafe는 하이픈과 밑줄을 섞어 내보내 participants의 CHECK 제약에 걸린다.

## 결번을 두지 않는다

접두사별로 01부터 연속 채번하며 번호를 건너뛰지 않는다. 구 스펙(docs_legacy/features.md)은 번호대 방식(F-101~F-604)을 쓰다가 F-111이 빠진 결번을 만들었고, 이 때문에 "전 기능이 등재되어 있는가"를 번호만으로 확인할 수 없었다. 접두사 방식으로 바꾼 이유가 이것이다.

**폐기된 표면의 ID는 재사용하지 않는다.** 기능이 사라지면 그 번호는 비워 두는 것이 아니라 뒤 번호를 당겨 연속을 유지하되, 폐기 사실과 구 번호를 폐기 목록에 남긴다.

## 기능 접두사 (12종)

접두사는 12종이며 문서 도메인과 1:1로 대응한다. 게임 6종은 각각 독립 접두사를 갖는다.

| 번호 | 문서 도메인 | 접두사 | 대응 gameId(frontend) |
|:----:|-------------|--------|---------------------|
| 01 | 방 만들기·입장 | ROOM | — |
| 02 | 대기방 | LOBBY | — |
| 03 | 게임 선택·설정 | SETUP | — |
| 04 | 게임 진행 공통 | PLAY | — |
| 05 | 운명의 룰렛 | WHEEL | roulette |
| 06 | 사다리타기 | LADDER | ladder |
| 07 | 킹메이커 | KING | kingmaker |
| 08 | 시간초 잡기 | TIMER | timer |
| 09 | 익명 저격 | SNIPE | snipe |
| 10 | 눈치게임 | NUNCHI | nunchi |
| 11 | 결과·저장 | RESULT | — |
| 12 | 공통·오류 | CMN | — |

- **접두사와 gameId는 표기가 다르다.** 문서는 대문자 접두사(WHEEL), 코드는 소문자 gameId(roulette)를 쓴다. 위 표가 둘 사이의 유일한 매핑 정본이다.
- 접두사별 기능 수와 총수는 [../02_features/README.md](../02_features/README.md)가 확정한다.
- 게임 6종의 **규칙**은 접두사별 기능이 아니라 [../05_game_rules](../05_game_rules/README.md)가 담는다. 기능 ID는 그 규칙을 사용자가 조작하는 표면에만 붙인다.

## 요구사항 ID

- 형식은 REQ-{접두사}-NN이며 기능 접두사 12종을 그대로 쓴다.
- 도메인에 속하지 않는 횡단 요구사항은 전용 접두사 2종을 쓴다.

| 접두사 | 범위 |
|--------|------|
| REQ-GLB | 전역 규칙 — 전 게임 공통 기준·금지 사항·공통 요건 |
| REQ-NFR | 비기능 — 성능·실시간성·판정 정확도·브라우저·접근성 |

기술·운영 요구사항은 별도 접두사를 두지 않고 [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md)의 ADR로 다룬다 — 배포 형상과 인스턴스 제약은 요구사항이 아니라 아키텍처 결정이기 때문이다.

## 화면 코드

- 형식은 {도메인}-{의미}다. 끝은 순번이 아니라 **의미형 토큰**을 쓴다(ROOM-CREATE · LOBBY-MAIN · RESULT-MAIN).
- 게임 화면은 게임 접두사를 쓴다 — WHEEL-PLAY · LADDER-PLAY · KING-PLAY · TIMER-PLAY · SNIPE-PLAY · NUNCHI-PLAY.
- 화면 코드는 **논리 단위**이며 물리 라우트와 1:1이 아니다. frontend는 단일 라우트에서 상태 전환으로 화면을 바꾸므로(frontend/src/App.tsx의 screen 스토어) 화면 코드는 그 상태값과 게임 종류의 조합으로 정의한다.
- 모달·오버레이는 독립 화면 코드를 두지 않고 소속 화면의 요소로 기술한다. 목록의 정본은 [../08_screen/README.md](../08_screen/README.md)다.
- 총 화면 수와 요소 수의 정본은 [../08_screen/README.md](../08_screen/README.md)다.

## 에러 코드

- 형식은 {namespace}.{snake_case} + HTTP 상태다. 네임스페이스는 **소문자**이며 기능 접두사(대문자)와 표기가 다르다.
- 네임스페이스는 기능 접두사를 그대로 소문자화하지 않는다 — 에러는 발생 주체 기준으로 묶는다(room · member · game · vote · common).
- 게임별 전용 네임스페이스를 두지 않는다. 게임 입력 오류는 game 네임스페이스로 채번하고 어느 게임에서 발생하는지는 코드가 아니라 설명이 밝힌다.
- 전수·유일 등재는 [02_error_codes.md](./02_error_codes.md)이며 각 도메인 문서는 자기 도메인이 쓰는 코드를 등재하되 채번은 사전이 판정한다.

## 테이블·컬럼

- snake_case를 쓴다. 테이블 6개의 이름 집합 정본은 [../06_database/README.md](../06_database/README.md)다.
- PK는 BIGINT UNSIGNED AUTO_INCREMENT이며 **API·WebSocket에 노출하지 않는다.** 외부 식별자를 가진 엔티티는 그것으로만 가리키고, 방은 초대 코드가 그 역할을 한다. 노출하면 방을 가로질러 연속 증가하는 값에서 다른 방의 참가자 수·생성 순서를 추정할 수 있고, 킹메이커 후보에서는 제출 순서가 드러나 익명성이 깨진다([../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md)). 외부 식별자는 이미 문자열이므로 JavaScript 정밀도 문제도 함께 사라진다.
- 시각은 TIMESTAMP(6)에 저장하고 서버·DB 세션 시간대를 UTC로 고정한다.
- 게임 판정 시간은 부동소수점이 아니라 **정수 밀리초 BIGINT**를 쓴다.
- 멱등 키(create_request_id · request_id)는 엔티티 ID가 아니므로 VARCHAR ASCII로 분리한다.

## 구 스펙 ID 매핑

docs_legacy의 US-NNN(사용자 스토리 40건) · F-NNN(기능 89건) 번호는 **재사용하지 않는다.** 구 번호로 논의된 이력을 추적할 수 있도록 대응 관계만 남긴다.

| 구 체계 | 신 체계 | 대응 방식 |
|---------|---------|-----------|
| US-1xx (방 만들기·입장) | REQ-ROOM-NN | 번호대 → 접두사 |
| US-2xx (대기방) | REQ-LOBBY-NN | 번호대 → 접두사 |
| US-3xx (게임 선택·설정) | REQ-SETUP-NN | 번호대 → 접두사 |
| US-40x (게임 진행 공통) | REQ-PLAY-NN | 번호대 → 접두사 |
| US-41x~46x (게임별) | REQ-{게임접두사}-NN | 게임별 접두사로 분화 |
| US-5xx (결과·저장) | REQ-RESULT-NN | 번호대 → 접두사 |
| US-6xx (공통·오류) | REQ-CMN-NN | 번호대 → 접두사 |
| F-1xx~6xx | F-{접두사}-NN | 위와 같은 도메인 대응 |
| G-1~16 (게임 공통 규칙) | REQ-GLB-NN | 전역 규칙 접두사로 통합 |
| NFR-01~10 | REQ-NFR-NN | 비기능 접두사로 통합 |
| D-01~40 (설계 결정) | D-NN | 번호 체계 동일. 제품 결정은 D, 기술 결정은 ADR로 분리해 재배치 |
| Q-01~05 (미확정) | D-NN 또는 ADR-NN | 전부 확정해 결정으로 승격한다. 미확정 항목을 남기지 않는다 |

**항목 단위 대응표**(구 US-101 → 신 REQ-ROOM-01 같은 1:1 매핑)는 [../03_requirements/11_traceability.md](../03_requirements/11_traceability.md)의 부록에 둔다 — 신 ID 채번이 끝난 뒤 생성되는 파생 자료이므로 추적성 문서가 소유한다.

## 관련 문서

- [02_error_codes.md](./02_error_codes.md) — 에러 코드 전수 정본
- [../02_features/README.md](../02_features/README.md) — 기능 ID 채번 정본
- [../03_requirements/11_traceability.md](../03_requirements/11_traceability.md) — REQ ↔ 기능 ↔ 화면 ↔ 테이블 추적과 구 ID 대응표
- [../08_screen/README.md](../08_screen/README.md) — 화면 인벤토리
- [../README.md](../README.md) — 고정 기준·전역 불변식
