# 05_constraints_integrity — 제약·무결성

> **대상**: ModuPick — CHECK 24 · UNIQUE 15 · FK 9 · PK 6 전수와 인덱스 31, DB가 강제하는 규칙과 앱이 강제하는 규칙의 분담
> **작성일**: 2026-08-02
> **원천**: git 529e312 docs/db.md §17 데이터 무결성 경계 · v0.4·v0.5 최종 DDL · git 529e312 docs/db.md「개발 전 반드시 정리할 문제」1(교차 방 참조)·3(입력 제약)·5(참가자 물리 삭제) · [01_erd.md](./01_erd.md) · [02_rooms_participants.md](./02_rooms_participants.md) · [03_game_rounds.md](./03_game_rounds.md) · [04_options_votes_results.md](./04_options_votes_results.md)

무결성 강제 지점을 한자리에 모은 참조표다. 컬럼별 설명은 테이블 문서에 있고, 여기서는 **제약의 전수와 그 근거**, 그리고 **어느 층이 무엇을 맡는지**를 고정한다.

강제는 세 층이다 — **제약(CHECK · UNIQUE · FK)** · **트랜잭션(행 잠금 + 명시 검증)** · **앱 검증(Pydantic·서비스 규칙)**. 트리거를 쓰지 않는다. 교차 행 규칙을 트리거로 숨기면 판정 로직이 DB와 코드 두 곳으로 갈라지고, 단일 인스턴스에서는 트랜잭션 잠금으로 같은 보장을 얻을 수 있다.

제약 총수는 **54개**다 — PK 6 + UNIQUE 15 + CHECK 24 + FK 9.

## 값 집합 — enum 타입을 쓰지 않는 이유

MySQL ENUM 타입 대신 **VARCHAR + CHECK**를 쓴다. ENUM은 값 추가·삭제가 ALTER TABLE 재작성을 부르고, 순서가 암묵적 정렬 기준이 되어 의미 없는 비교를 허용한다. 값 집합 축은 **6종**이며 라벨 총 **22개**다(2 + 2 + 2 + 4 + 6 + 6 = 22).

| # | 축 | 값 수 | 값 | 강제 |
|:-:|----|:----:|-----|------|
| 1 | rooms.status | 2 | waiting · playing | ck_rooms_status. **종료는 값이 아니라 행 삭제다** |
| 2 | participants.status | 2 | pending · active | ck_participants_status |
| 3 | participants.role | 2 | host · guest | ck_participants_role. 위임이 없어 갱신되지 않는다 |
| 4 | game_rounds.status | 4 | ready · running · finished · cancelled | ck_game_rounds_status |
| 5 | game_rounds.game_type | 6 | roulette · ladder · kingmaker · timer · snipe · nunchi | ck_game_rounds_game_type |
| 6 | game_rounds.ended_reason | 6 | completed · host_left · last_member_left · room_expired · server_restart · error | ck_game_rounds_ended_reason. NULL 허용(진행 중) |

game_type의 6값은 [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)의 접두사↔gameId 매핑표와 같은 집합이며, 어느 한쪽이 바뀌면 둘을 함께 고친다.

## 외부 식별자 접두어 3종

내부 BIGINT PK를 API·소켓에 노출하지 않는다. 노출하면 방을 가로질러 연속 증가하는 값에서 다른 방의 참가자 수·생성 순서를 추정할 수 있고, 킹메이커 후보에서는 제출 순서가 드러나 익명성이 깨진다.

| 접두어 | 컬럼 | 형식 CHECK | 가리키는 것 |
|--------|------|-----------|------------|
| mbr_ | participants.member_id | ck_participants_member_id_format | 참가자 |
| rnd_ | game_rounds.round_id | ck_game_rounds_round_id_format | 게임 한 판 |
| opt_ | game_options.option_id | ck_game_options_option_id_format | 선택지(킹메이커 후보 식별자를 겸한다) |

- 형식은 접두어 + 영숫자 16~36자이며 **추측 불가한 난수원에서 만든다.** 순번·시각 기반 생성을 하지 않는다.
- 방은 외부 식별자를 따로 두지 않는다. **초대 코드가 그 역할을 한다.**
- **ID는 권한 증명이 아니다.** 값을 안다고 접근이 열리지 않으며, 모든 조회·변경에서 현재 소켓에 바인딩된 참가자의 방 소속을 검증한다.

## CHECK 제약 24개

| 테이블 | 제약명 | 내용 |
|--------|--------|------|
| rooms | ck_rooms_code_format | code가 숫자 6자리(정규식 ^[0-9]{6}$) |
| rooms | ck_rooms_room_name_len | room_name 공백 제거 후 1~30자 |
| rooms | ck_rooms_max_members | max_members 2~10 |
| rooms | ck_rooms_status | status가 waiting · playing |
| rooms | ck_rooms_expiry_order | expires_at > last_activity_at |
| participants | ck_participants_member_id_format | member_id가 mbr_ + 영숫자 16~36자 |
| participants | ck_participants_status | status가 pending · active |
| participants | ck_participants_role | role이 host · guest |
| participants | ck_participants_profile_state | **PENDING이면 닉네임·아바타가 둘 다 NULL, ACTIVE면 둘 다 NOT NULL** |
| participants | ck_participants_nickname_len | nickname NULL 또는 공백 제거 후 1~8자 |
| participants | ck_participants_avatar_id | avatar_id NULL 또는 A01~A30 |
| participants | ck_participants_bio_len | bio NULL 또는 공백 제거 후 1~24자 |
| participants | ck_participants_pending_window | ACTIVE 행은 pending_expires_at을 갖지 않는다 |
| game_rounds | ck_game_rounds_round_id_format | round_id가 rnd_ + 영숫자 16~36자 |
| game_rounds | ck_game_rounds_game_type | game_type이 6종 |
| game_rounds | ck_game_rounds_status | status가 ready · running · finished · cancelled |
| game_rounds | ck_game_rounds_ended_reason | ended_reason NULL 또는 6종 |
| game_rounds | ck_game_rounds_time_order | ended_at >= started_at (둘 다 있을 때) |
| game_rounds | ck_game_rounds_terminal_state | **진행 상태면 ended_at·ended_reason이 둘 다 NULL, 종료 상태면 둘 다 NOT NULL** |
| game_options | ck_game_options_option_id_format | option_id가 opt_ + 영숫자 16~36자 |
| game_options | ck_game_options_label_len | label 공백 제거 후 1~120자 |
| game_options | ck_game_options_sort_order | sort_order 0 이상 |
| votes | ck_votes_ballot_no | ballot_no 1~4 (**본투표 1 + 결선 최대 3**) |
| votes | ck_votes_choice_no | choice_no 1~10 (정원 상한) |

테이블별 카운트: rooms 5 · participants 8 · game_rounds 6 · game_options 3 · votes 2 · game_results 0 = **24**.

- **game_results만 CHECK를 갖지 않는다.** result_data의 내부 구조는 게임별 Pydantic 모델이 저장 전에 검증한다. JSON 내부를 CHECK로 검사하면 같은 스키마가 DDL과 코드 두 곳에 생겨 마이그레이션마다 함께 고쳐야 한다.
- **공백만 있는 값을 전부 막는다.** TRIM 후 길이를 재는 CHECK 5종(room_name · nickname · bio · label)이 그 자리를 닫는다. git 529e312 docs/db.md가 "공백만 있는 닉네임·선택지가 들어간다"를 미해결로 남긴 항목이다.
- **상태 짝 CHECK 2종이 반쪽 상태를 막는다** — ck_participants_profile_state와 ck_game_rounds_terminal_state다. 두 컬럼이 함께 움직여야 하는 규칙을 애플리케이션 순서에 맡기지 않는다.
- **정원 상한 CHECK는 값 범위만 본다.** max_members가 2~10인지는 CHECK가 보지만 현재 인원이 그보다 작은지는 다른 행을 세야 알 수 있어 트랜잭션이 맡는다.

## PK·UNIQUE 21개

### PK 6개 — 테이블당 1개

전부 BIGINT UNSIGNED AUTO_INCREMENT 단일 컬럼이다: rooms · participants · game_rounds · game_options · votes · game_results.

**복합 PK도 자연키 PK도 쓰지 않는다.** 초대 코드처럼 자연키 후보가 있는 테이블도 대리 키를 PK로 두는 이유는, 자연키를 하위 테이블 FK로 끌고 가면 값이 바뀔 때 연쇄 갱신이 필요하고 인덱스가 커지기 때문이다.

### UNIQUE 15개

| 테이블 | 제약 | 목적 |
|--------|------|------|
| rooms | uq_rooms_code (code) | 초대 코드 전역 유일 |
| participants | uq_participants_member_id (member_id) | 외부 ID 전역 유일 |
| participants | uq_participants_id_room (id, room_id) | **하위 3테이블 복합 FK의 대상 키** |
| participants | uq_participants_active_nickname (room_id, active_nickname) | 방 안 활성 닉네임 유일 |
| participants | uq_participants_active_avatar (room_id, active_avatar_id) | 방 안 활성 아바타 유일(선점) |
| participants | uq_participants_active_host (room_id, active_host_guard) | **방별 활성 방장 최대 1명** |
| game_rounds | uq_game_rounds_round_id (round_id) | 외부 ID 전역 유일 |
| game_rounds | uq_game_rounds_id_room (id, room_id) | **game_options·votes 복합 FK의 대상 키** |
| game_rounds | uq_game_rounds_active (room_id, active_round_guard) | **방별 진행 중 판 최대 1개** |
| game_options | uq_game_options_option_id (option_id) | 외부 ID 전역 유일 |
| game_options | uq_game_options_id_round (id, game_round_id) | **votes 복합 FK의 대상 키** |
| game_options | uq_game_options_round_order (game_round_id, sort_order) | 회차 내 순서 유일 |
| game_options | uq_game_options_round_participant (game_round_id, participant_id) | **참가자당 선택지 1개** |
| votes | uq_votes_ballot (game_round_id, voter_participant_id, ballot_no, choice_no) | **중복·재전송 차단** |
| game_results | uq_game_results_round (game_round_id) | **회차당 결과 1행** |

- **대상 키용 UNIQUE 3종**(participants · game_rounds · game_options)은 조회 성능이 아니라 **복합 FK를 성립시키기 위한 것**이다. MySQL은 FK 참조 대상이 인덱스의 왼쪽 접두여야 하므로, (id, room_id) 조합에 인덱스가 없으면 복합 FK를 선언할 수 없다.
- **VIRTUAL 생성 컬럼 위의 UNIQUE 4종**(active_nickname · active_avatar_id · active_host_guard · active_round_guard)이 "활성인 것만 유일"을 표현한다. MySQL은 UNIQUE 안의 NULL을 여러 개 허용하므로, 조건을 만족하지 않는 행이 NULL이 되어 대상에서 빠진다. PostgreSQL의 부분 유니크 인덱스에 해당하는 자리를 MySQL에서 이 방식으로 메운다.
- **생성 컬럼 식에 room_id를 넣지 않는다.** FK가 걸린 컬럼을 생성 컬럼 식에 쓰면 CASCADE와 충돌할 수 있다. room_id는 일반 컬럼으로 복합 UNIQUE에 참여시킨다.
- **"최대 1개"만 보장한다.** 활성 방장 최소 1명, 진행 중 판 최소 0개 같은 하한은 UNIQUE가 표현하지 못해 트랜잭션이 맡는다.

## FK 9개 — 전부 CASCADE

| # | 제약명 | 대상 → 부모 | 컬럼 | 형태 |
|:-:|--------|-------------|------|------|
| 1 | fk_participants_room | participants → rooms | room_id | 단일 |
| 2 | fk_game_rounds_room | game_rounds → rooms | room_id | 단일 |
| 3 | fk_game_rounds_started_by | game_rounds → participants | (started_by, room_id) | **복합** |
| 4 | fk_game_options_round | game_options → game_rounds | (game_round_id, room_id) | **복합** |
| 5 | fk_game_options_participant | game_options → participants | (participant_id, room_id) | **복합** |
| 6 | fk_votes_round | votes → game_rounds | (game_round_id, room_id) | **복합** |
| 7 | fk_votes_voter | votes → participants | (voter_participant_id, room_id) | **복합** |
| 8 | fk_votes_option | votes → game_options | (game_option_id, game_round_id) | **복합** |
| 9 | fk_game_results_round | game_results → game_rounds | game_round_id | 단일 |

**ON DELETE는 9개 전부 CASCADE다. SET NULL·RESTRICT·NO ACTION을 쓰지 않는다.**

- 방 밖으로 존속해야 할 데이터가 없다. 방이 사라지면 남길 것이 없다는 제품 결정이 FK 정책 하나로 표현된다.
- **SET NULL을 쓸 수 없는 구조적 이유도 있다.** 복합 FK의 SET NULL은 room_id까지 NULL로 만드는데 room_id는 NOT NULL이라 MySQL이 DDL 단계에서 거부한다.
- **RESTRICT도 쓸 수 없다.** 방 삭제 CASCADE가 participants와 game_rounds 양쪽으로 퍼지고 그 둘이 다시 같은 하위 행에 도달하는 다이아몬드 구조라, 어느 한 경로에 RESTRICT를 두면 삭제 순서에 따라 방 삭제 자체가 실패할 수 있다.

## 교차 방 참조 차단 — 복합 FK 5개

**FK가 확인하는 것은 "그 ID가 존재하는가"이지 "같은 방인가"가 아니다.** 단일 컬럼 FK만 두면 A방의 판이 B방 참가자를 시작자로 갖거나, A방의 투표가 B방 참가자의 표로 들어가는 데이터가 DB 수준에서 허용된다. 값이 조용히 들어간 뒤 개표에서만 드러나는 실패 모드다.

| 복합 FK | 차단 대상 |
|---------|----------|
| fk_game_rounds_started_by (started_by, room_id) | 다른 방 참가자가 이 방의 판을 시작한 것으로 기록되는 것 |
| fk_game_options_participant (participant_id, room_id) | 다른 방 참가자가 이 판의 후보·의견 작성자가 되는 것 |
| fk_votes_voter (voter_participant_id, room_id) | 다른 방 참가자의 표가 이 판에 섞이는 것 |
| fk_game_options_round (game_round_id, room_id) | 선택지의 room_id가 회차의 방과 어긋나는 것 |
| fk_votes_round (game_round_id, room_id) | 표의 room_id가 회차의 방과 어긋나는 것 |
| fk_votes_option (game_option_id, game_round_id) | **다른 회차의 선택지에 투표하는 것** |

**서비스 검증 대신 DB 보장을 택했다.** git 529e312 docs/db.md는 두 안을 제시하며 MVP에서는 서비스 검증을 권했다. 본 설계는 후자(DB 완전 보장)를 택한다. 근거는 셋이다.

1. **비용이 작다.** game_options와 votes에 room_id 컬럼 하나씩, 총 2개를 더하는 것으로 끝난다.
2. **판정 성능에 영향이 없다.** 두 테이블은 확정 기록 경로이지 밀리초 판정 경로가 아니다.
3. **누락이 조용하다.** 서비스 검증은 새 코드 경로가 생길 때마다 빠뜨릴 수 있고, 빠뜨려도 즉시 드러나지 않는다. 제약은 빠뜨릴 수 없다.

**room_id는 파생값이지만 어긋날 수 없다.** fk_game_options_round·fk_votes_round가 회차의 room_id와 대조하므로 다른 값을 넣으면 INSERT가 실패한다. 중복 저장이되 검증된 중복이다.

**참가자를 참조하는 컬럼이 없는 game_results에는 room_id를 두지 않는다.** 규칙은 하나다 — **room_id는 참가자를 참조하는 테이블에만 둔다.**

## 인덱스 31개

**제약 부수 21**(PK 6 + UNIQUE 15) + **독립 10** = 31이다.

### 독립 인덱스 10개

| # | 테이블 | 인덱스 | 컬럼 | 용도 |
|:-:|--------|--------|------|------|
| 1 | rooms | idx_rooms_expires_at | (expires_at) | 만료 스윕 |
| 2 | participants | idx_participants_room_active | (room_id, left_at, status) | 현재 인원 카운트·명단 조회. fk_participants_room 커버 |
| 3 | participants | idx_participants_pending_expiry | (pending_expires_at) | PENDING 슬롯 회수 스윕 |
| 4 | game_rounds | idx_game_rounds_room_created | (room_id, created_at) | 방의 판 이력. fk_game_rounds_room 커버 |
| 5 | game_rounds | idx_game_rounds_started_by | (started_by, room_id) | fk_game_rounds_started_by 커버 |
| 6 | game_options | idx_game_options_round_room | (game_round_id, room_id) | fk_game_options_round 커버 |
| 7 | game_options | idx_game_options_participant_room | (participant_id, room_id) | fk_game_options_participant 커버 |
| 8 | votes | idx_votes_round_room | (game_round_id, room_id) | fk_votes_round 커버 |
| 9 | votes | idx_votes_voter_room | (voter_participant_id, room_id) | fk_votes_voter 커버 |
| 10 | votes | idx_votes_option_round | (game_option_id, game_round_id) | fk_votes_option 커버 · 선택지별 득표 집계 |

- **FK 커버 인덱스를 전부 이름 붙여 선언한다.** MySQL은 FK에 맞는 인덱스가 없으면 이름을 스스로 정한 인덱스를 만든다. "모든 FK·UNIQUE·CHECK·INDEX에 고정된 이름을 준다"는 규약이 그것을 허용하지 않으므로, 기존 인덱스가 왼쪽 접두로 덮지 못하는 FK 6개(#5~#10)에 대응하는 인덱스를 직접 선언한다.
- **독립 인덱스가 하나도 없는 테이블은 game_results 하나다.** 유일한 조회 축(game_round_id)을 UNIQUE 인덱스가 그대로 겸한다.
- **JSON 컬럼에 인덱스를 두지 않는다.** config·result_data를 검색 조건으로 쓰는 요구가 없다. 생기면 그때 VIRTUAL 생성 컬럼과 인덱스를 추가한다.
- 인덱스 사용 여부는 배포 전 EXPLAIN으로 확인한다 — 초대 코드 조회 · 방 인원 카운트 · 진행 중 판 조회 · 만료 방 조회 넷이다.

## DB가 강제하는 규칙 · 앱이 강제하는 규칙

### DB가 직접 보장 — 우회 경로가 없다

| 규칙 | 강제 지점 |
|------|----------|
| 초대 코드 전역 유일 | uq_rooms_code |
| 외부 ID 3종 전역 유일과 형식 | uq_*_member_id·round_id·option_id + 형식 CHECK 3종 |
| 방 안 활성 닉네임·아바타 유일 | uq_participants_active_nickname · uq_participants_active_avatar |
| 방별 활성 방장 최대 1명 | uq_participants_active_host |
| 방별 진행 중 판 최대 1개 | uq_game_rounds_active |
| 회차당 결과 최대 1행 | uq_game_results_round |
| 참가자당 선택지 최대 1개 | uq_game_options_round_participant |
| 같은 (회차, 투표자, 차수, 표 순번) 중복 불가 | uq_votes_ballot |
| 다른 회차 선택지로 투표 불가 | fk_votes_option |
| **다른 방 참가자가 끼어드는 것** | 복합 FK 3종(started_by · participant_id · voter_participant_id) |
| 존재하지 않는 방·회차·참가자·선택지 참조 | FK 9종 |
| 방 삭제 시 하위 전부 삭제 | ON DELETE CASCADE 9종 |
| 값 범위·형식·상태 짝 | CHECK 24종 |
| 결선 차수 상한 4 | ck_votes_ballot_no. **종료가 보장되지 않는 반복이 DB 수준에서도 불가능하다** |

### 트랜잭션이 보장 — 행 잠금 + 명시 검증

| 규칙 | 왜 DB 제약이 못 하나 |
|------|---------------------|
| 현재 인원이 정원보다 작다 | 다른 행을 세야 안다. CHECK는 다른 행을 조회할 수 없다 |
| 방장 없는 활성 방이 생기지 않는다 | "최소 1명"은 UNIQUE로 표현되지 않는다. 방 생성 트랜잭션이 host를 함께 만들고 host 이탈 시 방을 지워 성립시킨다 |
| 현재 상태에서 그 상태 전이가 허용된다 | 전이 규칙은 이전 값과 새 값의 관계이며 행 단위 CHECK 밖이다 |
| 요청자가 이 방의 방장이다 | 권한은 현재 소켓 연결에 바인딩된 인메모리 값이다 |
| 만료 대상이 실제로 만료됐다 | 스윕과 사용자 요청이 겹칠 수 있어 잠근 뒤 조건을 다시 본다 |
| 결과 확정과 라운드 종료가 함께 일어난다 | 두 테이블의 원자성이라 트랜잭션 경계의 문제다 |

### 앱이 강제 — 검증하지 않으면 잘못된 데이터가 들어간다

| 규칙 | 강제 지점 | 미강제 시 결과 |
|------|----------|--------------|
| 자기 안건·자기 자신에게 투표 금지 | 서비스 검증(participant_id와 voter_participant_id 대조) | 셀프 투표가 집계에 섞인다 |
| 게임별 1인 표 수 상한과 몰아주기 허용 여부 | 서비스 검증 + 인메모리 잔여 표 카운트 | 한 사람이 표를 초과 행사한다 |
| 게임별 최소 인원(2 또는 3) | 게임 시작 트랜잭션 | 성립하지 않는 판이 시작된다 |
| 사다리 도착 항목 수 = 참가자 수 | 게임 시작 트랜잭션(부족분 X 채움·초과분 절단) | 1:1 배정이 깨진다 |
| config·result_data가 game_type과 schemaVersion에 맞다 | 게임별 Pydantic 모델 | 소비 코드가 없는 키를 읽는다 |
| result_data.seed = game_rounds.random_seed | 결과 확정 트랜잭션 | 재현 검증이 성립하지 않는다 |
| 킹메이커 후보 표시 순서를 무작위 순열로 준다 | 인메모리 순열 | 제출 순서로 작성자가 추정돼 익명성이 깨진다 |
| 익명 게임 응답·로그에 투표자 식별값을 넣지 않는다 | 응답 직렬화·로깅 필터 | 익명성이 무너진다 |
| last_activity_at 갱신 대상이 실제 사용자 행동이다 | 서비스 검증 | 아무도 없는 방이 만료되지 않는다 |
| 초대 코드 검증 rate limiting | API 계층 | 100만 코드 공간이 전수 탐색된다 |

**앱 강제 항목은 통합 테스트로 고정한다.** 제약이 못 잡는 규칙은 코드 경로가 늘 때마다 빠뜨릴 수 있으므로, 각 항목에 대응하는 테스트가 없으면 그 규칙은 강제되지 않는 것으로 본다.

## 제약으로 표현할 수 없는 것 — 한계 등재

| 요구 | 강제 위치 | 우회 경로 |
|------|----------|----------|
| 정원 초과 입장 금지 | 입장 트랜잭션(rooms 행 잠금) | rooms를 잠그지 않는 INSERT 경로를 만들면 뚫린다 |
| 활성 방장 최소 1명 | 방 생성 트랜잭션 · 방장 이탈 시 방 삭제 | 관리 SQL로 host의 left_at을 직접 채우면 방장 없는 방이 남는다 |
| 자기 투표 금지 | 서비스 검증 | 서비스를 거치지 않는 INSERT는 통과한다 |
| 게임별 표 수 상한 | 인메모리 잔여 표 + 서비스 검증 | 위와 같다 |
| JSON 스키마 일치 | Pydantic 모델 | 직접 INSERT는 통과한다 |
| **참가자 개별 물리 삭제 금지** | 애플리케이션에 삭제 메서드를 두지 않음 + modupick 계정 권한 회수 | 관리 계정으로 직접 DELETE하면 그 참가자의 표가 CASCADE로 사라진다 |

**참가자 물리 삭제는 FK 정책으로 막을 수 없다.** votes.voter_participant_id를 RESTRICT로 두면 개별 삭제는 막히지만 방 삭제 CASCADE가 함께 막힐 위험이 있다(다이아몬드 경로). 그래서 **경로 자체를 없애는 방식**으로 닫는다 — 삭제 메서드를 만들지 않고, 운영 계정에서 participants DELETE 권한을 회수하며, "방 삭제 외에는 participants 행이 사라지지 않는다"를 통합 테스트로 고정한다([07_migrations_seed.md](./07_migrations_seed.md)).

## 배포 전 실행 검증

DDL 문법이 통과한다고 의도대로 동작하는 것은 아니다. 아래는 **빈 MySQL 8.4에서 실제로 실행해 확인하는 항목**이며, 확인 전에는 "동작한다"고 적지 않는다.

| # | 확인 |
|:-:|------|
| 1 | VIRTUAL 생성 컬럼 4종과 그 위의 UNIQUE 4종이 실제로 생성된다 |
| 2 | 복합 FK 6종이 생성되고, 어느 한 컬럼이 NULL인 행(사다리 항목·started_by NULL)이 통과한다 |
| 3 | 다른 방 참가자를 참조하는 INSERT가 복합 FK로 거부된다 |
| 4 | rooms 1행 삭제로 하위 5테이블이 전부 사라지고, **다이아몬드 CASCADE 경로가 오류를 내지 않는다** |
| 5 | 퇴장한 참가자의 닉네임·아바타를 새 참가자가 재사용할 수 있다 |
| 6 | 방에 활성 방장 2명, 진행 중 판 2개, 회차당 결과 2행이 만들어지지 않는다 |
| 7 | 공백만 있는 닉네임·label과 음수 sort_order, ballot_no 5가 거부된다 |
| 8 | 마지막 한 자리에 동시 입장해도 한 명만 성공한다 |
| 9 | 같은 표를 재전송하면 행이 늘지 않고 기존 결과가 반환된다 |
| 10 | modupick 계정이 rooms를 삭제할 때 하위 CASCADE가 정상 동작한다 |
| 11 | 세션 시간대가 +00:00이고 TIMESTAMP(6) 정밀도가 유지된다 |

## 관련 문서

- 관계·CASCADE 경로 → [01_erd.md](./01_erd.md)
- 컬럼별 상세 → [02_rooms_participants.md](./02_rooms_participants.md) · [03_game_rounds.md](./03_game_rounds.md) · [04_options_votes_results.md](./04_options_votes_results.md)
- 잠금 순서·트랜잭션 경계 → [06_transactions_concurrency.md](./06_transactions_concurrency.md)
- DDL을 만드는 마이그레이션·DB 계정 → [07_migrations_seed.md](./07_migrations_seed.md)
- 제약 위반이 표면화되는 에러 코드 → [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)
- 익명성 유출 경로·치팅 방지 → [../11_fairness/README.md](../11_fairness/README.md)
