# DB 모델링 / DB 구성

## ✅ MySQL 최종안 v0.4 — 2026-07-27

### 1. 문서 적용 기준

> **현재 구현의 단일 기준 문서입니다.** 이 문서만 읽어도 모델·Migration·서비스 트랜잭션·API 연동·배포·검증 범위를 파악할 수 있어야 합니다.
> 
- 2026-07-25안의 MySQL 제약조건·운영 설계를 기준으로 채택했습니다.
- 2026-07-26안에서 API 필드명, 게임 ID, 퇴장 처리, 게임별 저장표를 가져왔습니다.
- `room_id`를 참조하던 STORED 생성 컬럼은 FK CASCADE와 충돌할 수 있어 제거했습니다.
- 활성 참가자만 닉네임·방장 UNIQUE를 적용하며, 퇴장 참가자의 닉네임은 재사용할 수 있습니다.
- MySQL 기본 격리 수준인 REPEATABLE READ와 짧은 `SELECT ... FOR UPDATE`를 기준으로 합니다.
- 이 문서와 아래 과거 수정안이 충돌하면 이 최종안을 우선합니다.

### 2. 프로젝트 요약·DB 범위

ModuPick(모두픽)은 로그인 없이 초대 코드로 방에 입장해 팀장 정하기·역할 분담·팀명 결정을 6종 실시간 미니게임으로 처리하는 멀티플레이어 웹 서비스입니다. REST는 방 생성·코드 검증·가입·프로필 확정 등 대기방 진입 전 요청을 담당하고, WebSocket은 대기방 진입 이후 참가자 상태·게임 진행·투표·결과 전파를 담당합니다.

#### DB가 저장하는 데이터

- 방과 만료 시각
- 방 참가자와 방장 역할
- 게임 회차와 상태 전이
- 게임별 선택지
- 중복 방지를 위한 투표자와 투표 기록
- 최종 결과와 결과 스키마 버전

#### DB에 저장하지 않는 데이터

- 채팅 메시지
- Ready·온라인 여부·현재 WebSocket 연결
- 재접속 토큰·세션
- 타이머 tick·애니메이션 프레임
- 게임 중간 연출 상태와 일시적인 소켓 이벤트

#### 설계 목표

- 방 삭제 한 번으로 관련 데이터를 안전하게 정리합니다.
- 동시 입장·동시 게임 시작·중복 투표를 트랜잭션과 제약조건으로 방지합니다.
- 게임별 차이는 JSON으로 흡수하되 핵심 관계는 FK로 유지합니다.
- MVP 이후 계정·전적·통계 요구가 생겨도 현재 6개 테이블의 책임이 섞이지 않도록 합니다.

### 3. 확정 정책

| 항목 | 최종 기준 |  |
| --- | --- | --- |
| DB | MySQL 8.4 LTS · InnoDB · utf8mb4 · strict SQL mode · UTC |  |
| 식별자 | PK는 BIGINT UNSIGNED AUTO_INCREMENT, FK는 동일한 BIGINT UNSIGNED. API·WebSocket에서는 10진 문자열로 전달 |  |
| 최대 인원 | 10명. 저장값은 2~10 범위만 허용 |  |
| 방장 퇴장 | 진행 중 회차 취소 후 방 삭제. 모든 하위 데이터 CASCADE 삭제 |  |
| 방 만료 | 마지막 활동 후 10분 |  |
| 결과 보관 | 별도 보관하지 않으며 방 삭제 시 함께 삭제 |  |
| 채팅 | DB에 저장하지 않고 클라이언트 localStorage에 방별 저장 |  |
| 익명 투표 | 투표자 ID를 DB에는 저장하되 일반 API·WebSocket 응답에서는 숨김 |  |
| 재접속 | 지원하지 않음. 연결 종료 시 기존 참가자를 퇴장 처리 |  |
| Redis | MVP에서는 사용하지 않음. 백엔드 인스턴스 1개 고정 |  |
| 격리 수준 | InnoDB 기본 REPEATABLE READ 유지 + 경쟁 행 SELECT ... FOR UPDATE |  |

### 4. 구현 전 계약 상태

- **식별자 계약 — 확정:** 모든 엔티티 PK는 `BIGINT UNSIGNED AUTO_INCREMENT`, FK는 참조 PK와 동일한 `BIGINT UNSIGNED`를 사용합니다. API·WebSocket에서는 JavaScript 정밀도 문제를 피하도록 ID를 10진 문자열로 직렬화하며, 접두어·UUID·ULID 변환 계층은 두지 않습니다.
- **초대 코드:** 현재 DDL은 6자리 영문 대문자·숫자를 허용합니다. API 예시의 숫자 6자리만으로 규칙을 축소하지 않습니다. 숫자 6자리로 확정할 경우 코드 공간이 100만 개이므로 검증 API rate limiting을 함께 적용합니다.
- **채팅 snapshot:** DB 비저장은 확정입니다. `room:snapshot`에 최근 채팅 50건을 서버 메모리에서 제공할지는 Backend·API 팀이 별도로 결정합니다.

### 5. ERD

```
rooms
  ├── 1:N participants
  └── 1:N game_rounds
              ├── 1:N game_options
              ├── 1:N votes
              └── 1:1 game_results

participants ──< votes
participants ──< game_options
participants ──< game_results
```

회원가입이 MVP 제외 범위이므로 `users` 테이블은 만들지 않습니다. 참가자는 방 내부에서만 유효합니다.

### 6. 공통 컬럼·값 규칙

- 테이블·컬럼·인덱스·제약조건 이름은 `snake_case`를 사용합니다.
- 엔티티 PK는 `BIGINT UNSIGNED AUTO_INCREMENT`, FK는 동일한 `BIGINT UNSIGNED`를 사용합니다.
- `create_request_id`와 `request_id`는 엔티티 ID가 아닌 클라이언트 멱등 키이므로 `VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin`으로 분리합니다.
- API·WebSocket의 엔티티 ID는 10진 문자열로 제공합니다. 프런트엔드에서 `Number`·`parseInt`로 강제 변환하지 않습니다.
- 시각은 `TIMESTAMP(6)`에 저장하며 서버와 DB 세션 시간대를 `+00:00`으로 고정합니다.
- 게임 판정 시간은 부동소수점 대신 정수 밀리초 `BIGINT`를 사용합니다.
- 가변 게임 설정·결과만 JSON으로 두고 PK·FK·검색 조건은 일반 컬럼으로 유지합니다.
- 테이블 기본 설정은 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`입니다.

### 7. 테이블별 컬럼 사전

#### `rooms` — 방

- `id`: `BIGINT UNSIGNED`, PK, AUTO_INCREMENT. DB가 생성하는 내부 방 식별자.
- `code`: `VARCHAR(6)`, UNIQUE. 현재 작업 가정은 6자리 숫자.
- `room_name`: `VARCHAR(30)`. API `roomName`과 매핑.
- `max_participants`: `SMALLINT`. 2~10만 허용.
- `status`: `waiting` 또는 `playing`. 종료 상태는 행 삭제로 표현.
- `created_at`: 방 생성 시각.
- `expires_at`: 마지막 활동 시각 + 10분.
- `last_activity_at`: 만료 연장의 기준 시각.
- `state_version`: 상태 변경 경쟁 감지용 증가 값.
- `create_request_id`: 최대 64자의 ASCII 방 생성 요청 멱등 키. 대소문자를 구분해 UNIQUE 처리.
- `updated_at`: 마지막 변경 시각.
- 주요 인덱스: `code` UNIQUE, `create_request_id` UNIQUE, `expires_at` 조회 인덱스.

#### `participants` — 방 참가자

- `id`: `BIGINT UNSIGNED`, PK, AUTO_INCREMENT. 현재 연결 생명주기의 참가자 식별자.
- `room_id`: 방 FK, 방 삭제 시 CASCADE.
- `nickname`: 최대 8자 닉네임 원문.
- `avatar_key`: 최대 8자. 현재 애플리케이션 값은 `A01`~`A15`.
- `bio`: 최대 24자, 선택 입력.
- `role`: `host` 또는 `guest`.
- `joined_at`: 참가 시각.
- `left_at`: 개별 퇴장·강퇴 시각. 활성 참가자는 NULL.
- `active_nickname`: 활성 참가자만 `LOWER(TRIM(nickname))`을 반환하는 VIRTUAL 생성 컬럼.
- `active_host_guard`: 활성 host만 1을 반환하는 VIRTUAL 생성 컬럼.
- `updated_at`: 마지막 변경 시각.
- 주요 제약: `(room_id, active_nickname)` UNIQUE, `(room_id, active_host_guard)` UNIQUE.
- 개별 참가자는 물리 삭제하지 않습니다. 방 삭제 CASCADE에서만 실제 행이 삭제됩니다.

#### `game_rounds` — 게임 1회 실행

- `id`: `BIGINT UNSIGNED`, PK, AUTO_INCREMENT. WebSocket `roundId`에 10진 문자열로 매핑.
- `room_id`: 방 FK, 방 삭제 시 CASCADE.
- `game_type`: `roulette`, `ladder`, `kingmaker`, `timer`, `snipe`, `nunchi`.
- `status`: `ready`, `running`, `finished`, `cancelled`.
- `config`: 게임별 입력 설정 JSON.
- `started_by`: 시작한 참가자 FK. 참가자 삭제 시 NULL.
- `started_at`, `ended_at`: 실제 시작·종료 시각.
- `ended_reason`: `completed`, `host_cancelled`, `expired`, `error` 등의 종료 사유.
- `random_seed`: 서버가 만든 재현 가능한 난수 시드.
- `running_guard`: running 상태일 때만 1인 VIRTUAL 생성 컬럼.
- `state_version`: 종료 요청·상태 변경 경쟁 감지용 값.
- `updated_at`: 마지막 변경 시각.
- 주요 제약: `(room_id, running_guard)` UNIQUE로 방별 running 회차 최대 1개.

#### `game_options` — 게임 선택지

- `id`: `BIGINT UNSIGNED`, PK, AUTO_INCREMENT. 서버 내부 선택지 식별자.
- `game_round_id`: 게임 회차 FK, 회차 삭제 시 CASCADE.
- `participant_id`: 참가자가 곧 선택지인 게임에서 사용하는 참가자 FK. 참가자 삭제 시 NULL.
- `label`: 역할·벌칙·제출 의견 등 화면 표시값, 최대 100자.
- `sort_order`: 회차 내부 표시 순서 또는 레인 순서.
- 주요 제약: `(id, game_round_id)` UNIQUE, `(game_round_id, sort_order)` UNIQUE.

#### `votes` — 투표

- `id`: `BIGINT UNSIGNED`, PK, AUTO_INCREMENT.
- `game_round_id`: 투표 대상 회차 FK.
- `voter_participant_id`: 투표자 FK. 익명 모드에서도 중복 방지를 위해 내부 저장.
- `option_id`: 선택지 ID. `game_round_id`와 함께 복합 FK로 같은 회차의 선택지만 참조.
- `vote_no`: 한 참가자의 회차 내 투표 순번. 1 이상.
- `request_id`: 최대 64자의 ASCII 네트워크 재전송 방지 멱등 키. 대소문자를 구분해 UNIQUE 처리.
- `created_at`: 투표 접수 시각.
- 주요 제약: `request_id` UNIQUE, `(game_round_id, voter_participant_id, vote_no)` UNIQUE.

#### `game_results` — 최종 결과

- `id`: `BIGINT UNSIGNED`, PK, AUTO_INCREMENT.
- `game_round_id`: 회차 FK이자 UNIQUE. 회차당 결과 최대 1개.
- `winner_participant_id`: 승자가 참가자인 게임에서 사용. 참가자 삭제 시 NULL.
- `result_data`: 게임별 결과 JSON.
- `result_version`: 결과 스키마 버전. 1 이상.
- `created_at`: 결과 확정 시각.

### 8. 최종 DDL

#### `rooms`

```sql
CREATE TABLE rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(8) NOT NULL,
  room_name VARCHAR(30) NOT NULL,
  max_participants SMALLINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at TIMESTAMP(6) NOT NULL,
  last_activity_at TIMESTAMP(6) NOT NULL,
  state_version BIGINT NOT NULL DEFAULT 0,
  create_request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_rooms PRIMARY KEY (id),
  CONSTRAINT uq_rooms_code UNIQUE (code),
  CONSTRAINT uq_rooms_create_request_id UNIQUE (create_request_id),
  CONSTRAINT ck_rooms_code_format
    CHECK (REGEXP_LIKE(code, '^[A-Z0-9]{6}$', 'c')),
  CONSTRAINT ck_rooms_max_participants
    CHECK (max_participants BETWEEN 2 AND 10),
  CONSTRAINT ck_rooms_status
    CHECK (status IN ('waiting','playing')),
  INDEX idx_rooms_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

`CLOSED` 상태는 저장하지 않습니다. 방 종료는 `rooms` 행 삭제로 표현합니다.

#### `participants`

```sql
CREATE TABLE participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL,
  nickname VARCHAR(8) NOT NULL,
  avatar_key VARCHAR(8) NOT NULL,
  bio VARCHAR(24) NULL,
  role VARCHAR(10) NOT NULL,
  joined_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  left_at TIMESTAMP(6) NULL,
  active_nickname VARCHAR(8)
    GENERATED ALWAYS AS (
      CASE WHEN left_at IS NULL THEN LOWER(TRIM(nickname)) ELSE NULL END
    ) VIRTUAL,
  active_host_guard TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN role = 'host' AND left_at IS NULL THEN 1 ELSE NULL END
    ) VIRTUAL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_participants PRIMARY KEY (id),
  CONSTRAINT fk_participants_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT ck_participants_role CHECK (role IN ('host','guest')),
  CONSTRAINT uq_participants_active_nickname
    UNIQUE (room_id, active_nickname),
  CONSTRAINT uq_participants_active_host
    UNIQUE (room_id, active_host_guard),
  INDEX idx_participants_room_id (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- 개별 퇴장·강퇴는 `DELETE`가 아니라 `left_at` 갱신으로 처리합니다.
- 퇴장한 참가자의 닉네임은 새 참가자가 다시 사용할 수 있습니다.
- 참가자 물리 삭제는 방 전체 삭제의 CASCADE로만 일어납니다.
- `active_nickname`, `active_host_guard`에는 `room_id`를 포함하지 않습니다. `room_id`는 일반 컬럼으로 복합 UNIQUE에 참여시키므로 생성 컬럼과 FK CASCADE 제한이 충돌하지 않습니다.

#### `game_rounds`

```sql
CREATE TABLE game_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL,
  game_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL,
  config JSON NOT NULL,
  started_by BIGINT UNSIGNED NULL,
  started_at TIMESTAMP(6) NULL,
  ended_at TIMESTAMP(6) NULL,
  ended_reason VARCHAR(30) NULL,
  random_seed BIGINT NULL,
  running_guard TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN status = 'running' THEN 1 ELSE NULL END
    ) VIRTUAL,
  state_version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_game_rounds PRIMARY KEY (id),
  CONSTRAINT fk_game_rounds_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_rounds_started_by FOREIGN KEY (started_by)
    REFERENCES participants(id) ON DELETE SET NULL,
  CONSTRAINT ck_game_rounds_game_type CHECK (
    game_type IN ('roulette','ladder','kingmaker','timer','snipe','nunchi')
  ),
  CONSTRAINT ck_game_rounds_status CHECK (
    status IN ('ready','running','finished','cancelled')
  ),
  CONSTRAINT uq_game_rounds_running
    UNIQUE (room_id, running_guard),
  CONSTRAINT uq_game_rounds_id_room UNIQUE (id, room_id),
  INDEX idx_game_rounds_room_started (room_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

`running_guard`도 `room_id`를 참조하지 않는 VIRTUAL 생성 컬럼으로 둡니다. 방별 running 회차 최대 1개는 `(room_id, running_guard)` UNIQUE가 보장합니다.

#### `game_options`

```sql
CREATE TABLE game_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  participant_id BIGINT UNSIGNED NULL,
  label VARCHAR(100) NOT NULL,
  sort_order SMALLINT NOT NULL,
  CONSTRAINT pk_game_options PRIMARY KEY (id),
  CONSTRAINT fk_game_options_round FOREIGN KEY (game_round_id)
    REFERENCES game_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_options_participant FOREIGN KEY (participant_id)
    REFERENCES participants(id) ON DELETE SET NULL,
  CONSTRAINT uq_game_options_id_round UNIQUE (id, game_round_id),
  CONSTRAINT uq_game_options_round_order UNIQUE (game_round_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

#### `votes`

```sql
CREATE TABLE votes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  voter_participant_id BIGINT UNSIGNED NOT NULL,
  option_id BIGINT UNSIGNED NOT NULL,
  vote_no SMALLINT NOT NULL DEFAULT 1,
  request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_votes PRIMARY KEY (id),
  CONSTRAINT fk_votes_round FOREIGN KEY (game_round_id)
    REFERENCES game_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_voter FOREIGN KEY (voter_participant_id)
    REFERENCES participants(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_option_round FOREIGN KEY (option_id, game_round_id)
    REFERENCES game_options(id, game_round_id) ON DELETE CASCADE,
  CONSTRAINT uq_votes_request_id UNIQUE (request_id),
  CONSTRAINT uq_votes_round_voter_no
    UNIQUE (game_round_id, voter_participant_id, vote_no),
  CONSTRAINT ck_votes_vote_no CHECK (vote_no >= 1),
  INDEX idx_votes_round (game_round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

복합 FK로 다른 회차의 선택지에 투표하는 것을 DB에서 차단합니다. 익명 투표에서도 `voter_participant_id`는 중복 방지를 위해 저장하지만 외부 응답에서는 제외합니다.

#### `game_results`

```sql
CREATE TABLE game_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  winner_participant_id BIGINT UNSIGNED NULL,
  result_data JSON NOT NULL,
  result_version SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_game_results PRIMARY KEY (id),
  CONSTRAINT fk_game_results_round FOREIGN KEY (game_round_id)
    REFERENCES game_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_results_winner FOREIGN KEY (winner_participant_id)
    REFERENCES participants(id) ON DELETE SET NULL,
  CONSTRAINT uq_game_results_round UNIQUE (game_round_id),
  CONSTRAINT ck_game_results_version CHECK (result_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

### 9. 게임별 저장 테이블 사용

| 게임 | game_options | votes | 저장 방식 |
| --- | --- | --- | --- |
| 운명의 룰렛 | 사용 | 미사용 | 참가자를 후보로 만들고 서버 seed와 결과 저장 |
| 랜덤 사다리 | 사용 | 미사용 | 역할·벌칙 선택지와 최종 배정 저장 |
| 킹메이커 | 사용 | 사용 | 제출 의견과 투표 집계 저장 |
| 시간초 잡기 | 미사용 | 미사용 | 결과를 result_data에 직접 저장 |
| 익명 저격 | 사용 | 사용 | 참가자를 타깃 후보로 만들고 익명 투표 저장 |
| 눈치게임 | 미사용 | 미사용 | 클릭 순서·탈락자·승자를 result_data에 저장 |

### 10. 실시간 상태·연결 종료

| 데이터 | 저장 위치 | 갱신·삭제 시점 |
| --- | --- | --- |
| 방·참가자·회차·선택지·투표·결과 | MySQL 8.4 | 업무 트랜잭션마다 저장, 방 삭제 시 함께 삭제 |
| Ready·온라인·현재 소켓·게임 진행 메모리 | 단일 백엔드 인스턴스 메모리 | 이벤트마다 갱신, 연결 종료·방 삭제 시 제거 |
| 채팅 메시지 | 클라이언트 localStorage | 수신 시 방별 키로 저장, 퇴장·방 삭제 시 제거 |
| 타이머 tick·애니메이션 프레임 | 저장하지 않음 | 서버 시각·seed를 기준으로 클라이언트가 계산 |
- 재접속은 지원하지 않습니다. 새로고침 또는 WebSocket 종료 시 기존 참가자의 `left_at`을 갱신합니다.
- 다시 입장하면 새로운 참가자 ID를 발급합니다. 진행 중인 방에는 새 참가자로도 입장할 수 없습니다.
- 참가자 권한은 현재 WebSocket 연결에 서버 메모리로 바인딩하고 연결 종료 시 폐기합니다.
- 서버 장애로 메모리 상태가 사라지면 snapshot 복구를 시도하지 않고 연결을 종료합니다.
- `room:snapshot`의 최근 채팅 50건 제공 여부는 미확정이지만 어떤 결론이 나도 채팅을 DB에는 저장하지 않습니다.

### 11. 상태 머신·기본 처리 원칙

```
room: waiting → playing → waiting
      waiting/playing → 방장 퇴장·명시적 종료·10분 미활동 → DELETE CASCADE

round: ready → running → finished
       ready/running → cancelled
```

- 방 입장: room 행 잠금 → 상태·만료·현재 active 인원 확인 → participant 저장.
- 게임 시작: room 행 잠금 → round 생성 → room을 playing으로 변경.
- 투표: round·참가자·option을 같은 트랜잭션에서 검증하고 request_id UNIQUE로 재전송을 차단.
- 게임 종료: round 잠금 → result 저장 → round finished → room waiting.
- DB commit 이후에만 WebSocket 이벤트를 전송합니다.
- deadlock 또는 lock wait timeout은 트랜잭션 전체를 최대 3회 짧은 무작위 지연과 함께 재시도합니다.

### 12. 트랜잭션·동시성·멱등성 상세

InnoDB 기본 격리 수준인 REPEATABLE READ를 사용합니다. 경쟁이 발생하는 `rooms`·`game_rounds` 행만 짧게 `SELECT ... FOR UPDATE`로 잠그고 트랜잭션 내부에서는 외부 API 호출이나 WebSocket 전송을 하지 않습니다.

| 작업 | 하나의 트랜잭션에서 처리할 내용 | 경쟁 조건·멱등성 대응 |
| --- | --- | --- |
| 방 생성 | 코드 생성 → rooms 저장 → host participant 저장 | `create_request_id`와 `code` UNIQUE. 코드 충돌 시 제한된 횟수만 재생성 |
| 방 입장 | room 잠금 → 상태·만료·active 인원 확인 → participant 저장 | room `FOR UPDATE`로 마지막 한 자리에 대한 동시 초과 입장 방지 |
| 개별 퇴장·강퇴 | participant 잠금 → `left_at` 갱신 | 행 DELETE 금지. 이미 퇴장한 요청은 성공으로 처리 |
| 방장 퇴장 | room 잠금 → running round 취소 → rooms 삭제 | 하위 데이터 CASCADE. 이미 삭제된 재요청도 성공으로 처리 |
| 게임 시작 | room 잠금 → 상태·권한 확인 → round·options 생성 → room playing | `(room_id, running_guard)` UNIQUE로 running 회차 중복 차단 |
| 투표 | round·voter·option·투표 수 검증 → vote 저장 | `request_id`와 `(round, voter, vote_no)` UNIQUE로 재전송·동시 클릭 차단 |
| 게임 종료 | round 잠금 → version 확인 → result 저장 → round finished → room waiting | round당 result UNIQUE. 이미 종료된 요청에는 기존 결과 반환 |
| 명시적 종료·10분 만료 | room 잠금 → 만료 조건 재검증 → running round 취소 → rooms 삭제 | 만료 작업 간 중복 실행을 허용하되 최종 결과는 동일 |
- deadlock 또는 lock wait timeout은 전체 트랜잭션을 최대 3회 짧은 무작위 지연과 함께 재시도합니다.
- commit이 성공한 뒤에만 WebSocket 이벤트를 발행합니다.
- 이벤트 전송 실패는 기록하고 해당 소켓을 종료합니다. DB commit을 되돌리지는 않습니다.
- 입력 길이·JSON 형식 검증은 트랜잭션 전 처리하되 상태·권한·정원은 잠금 후 다시 확인합니다.
- `state_version`을 사용하는 요청은 요청 버전과 DB 버전이 다르면 409로 거절합니다.

### 13. 게임별 JSON 스키마

JSON은 자유 형식으로 사용하지 않습니다. 게임별 Pydantic 모델과 `schemaVersion`을 두고 필드 의미가 바뀌면 기존 데이터를 덮어쓰지 않고 버전을 올립니다.

| 게임 | config 핵심 값 | result_data 핵심 값 |
| --- | --- | --- |
| 룰렛 | `schemaVersion`, `winnerCount`, `optionMode`, `durationMs` | `selectedOptionIds`, `seed`, `drawOrder` |
| 사다리 | `schemaVersion`, `speed`, `allowDuplicateResult` | `assignments[{participantId, optionId, label}]`, `seed` |
| 킹메이커 | `schemaVersion`, `votesPerUser`, `anonymous`, `excludeSelf` | `ranking[{optionId, voteCount}]`, `winnerOptionIds` |
| 시간초 잡기 | `schemaVersion`, `durationMode`, `minMs`, `maxMs`, `bombCount` | `passes`, `eliminatedParticipantIds`, `serverElapsedMs` |
| 익명 저격 | `schemaVersion`, `hp`, `revealMode`, `votesPerUser` | `hitCounts`, `eliminatedParticipantIds`, `tieBreakRoundId` |
| 눈치게임 | `schemaVersion`, `duplicateWindowMs`, `endMode` | `clickOrder`, `eliminatedParticipantIds`, `winnerParticipantId` |
- JSON 최대 바이트 크기를 API에서 제한합니다.
- 참가자·선택지·회차 식별자는 존재 여부와 방 소속을 서비스 계층에서 검증합니다.
- 결과 재현에 필요한 게임은 `random_seed`와 result_data의 `seed`를 일치시킵니다.
- JSON 값을 검색 조건으로 사용해야 할 때만 별도 VIRTUAL 생성 컬럼과 인덱스를 추가합니다.

### 14. API·WebSocket 필드 매핑

- API 필드는 `roomName`, `bio`, `avatarKey`를 사용하고 DB에서는 `room_name`, `bio`, `avatar_key`로 매핑합니다.
- `avatar_key` 값은 현재 `A01`~`A15`를 허용하는 애플리케이션 검증을 둡니다.
- 게임 ID는 `roulette`, `ladder`, `kingmaker`, `timer`, `snipe`, `nunchi`로 통일합니다.
- `king.vote`, `snipe.vote`의 `{ targetMemberId }`는 서버가 해당 회차의 `game_options.participant_id`로 조회해 `votes.option_id`로 변환합니다.
- `ladder.pick`의 `{ laneIndex }`도 서버에서 회차별 레인과 option을 매핑합니다.
- 참가자 퇴장 시 `left_at`만 갱신하고 `participant.left`를 전송합니다. 방장 퇴장은 방 삭제 트랜잭션을 실행하고 commit 뒤 `room.deleted`를 전송합니다.

### 15. REST API와 DB 매핑

> 아래 경로는 DB 구현 기준의 권장 매핑입니다. 실제 API 명세의 최종 경로·payload와 공동 리뷰 후 확정해야 합니다.
> 

| 행위 | DB 처리 | 응답·후속 이벤트 |
| --- | --- | --- |
| `POST /rooms` | rooms와 host participant를 같은 트랜잭션에서 생성 | room ID, 초대 코드, participant ID |
| `GET /rooms/{code}` | 코드로 방 상태·만료·정원 조회 | 입장 가능 여부. 초대 코드 존재 여부의 과도한 노출 방지 |
| `POST /rooms/{code}/participants` | room 잠금 후 최대 10명 검증, participant 생성 | participant ID, `participant.joined` |
| `PATCH /participants/{participantId}` | 현재 연결 권한 확인 후 nickname·avatar_key·bio 변경 | 갱신 프로필 |
| `GET /rooms/{roomId}/state` | room + active participants + running round 조회 | 현재 상태. 재접속 복구 용도로는 사용하지 않음 |
| `POST /rooms/{roomId}/rounds` | round와 options 생성, room을 playing으로 변경 | round ID, `game.started` |
| `POST /rounds/{roundId}/votes` | 권한·횟수·option 검증 후 vote 생성 | `vote.accepted`; 익명 모드에서는 voter 제외 |
| `POST /rounds/{roundId}/finish` | result 저장, round finished, room waiting | `game.finished` |
| `DELETE /participants/{participantId}` | guest는 `left_at` 갱신, host는 room 삭제 | `participant.left` 또는 `room.deleted` |
| `DELETE /rooms/{roomId}` | running round 취소 후 room과 하위 데이터 삭제 | `room.deleted` |
- API 입력은 camelCase, DB 컬럼은 snake_case를 사용합니다.
- `roomName`→`room_name`, `avatarKey`→`avatar_key`, `targetMemberId`→참가자 선택지 조회로 명시적으로 변환합니다.
- DB의 `BIGINT UNSIGNED` ID는 API·WebSocket에서 10진 문자열로 직렬화합니다.
- ID는 권한 증명이 아닙니다. 참가자 권한은 현재 WebSocket 연결에 바인딩하고 모든 조회·변경에서 방 소속을 검증합니다.

### 16. WebSocket 이벤트와 DB 처리

| 이벤트 | DB 처리 | 주의사항 |
| --- | --- | --- |
| `participant.joined` | participant insert commit 후 발행 | active 참가자 목록을 기준으로 전파 |
| `participant.updated` | 프로필 update commit 후 발행 | bio 길이와 avatar key 검증 |
| `participant.left` | `left_at` update commit 후 발행 | 개별 참가자 DELETE 금지 |
| `game.started` | round·options 생성과 room playing commit 후 발행 | state_version 포함 권장 |
| `king.vote` | `targetMemberId`를 해당 회차 option으로 변환해 vote 저장 | voter 정보는 익명 응답에서 제외 |
| `snipe.vote` | `targetMemberId`를 참가자 option으로 변환해 vote 저장 | 자기 투표·투표 횟수는 config에 따라 검증 |
| `ladder.pick` | `laneIndex`를 해당 회차 option과 매핑 | 클라이언트 index를 DB ID로 직접 신뢰하지 않음 |
| `vote.accepted` | vote commit 후 요청자에게 응답 | request_id 재전송 시 기존 성공 결과 반환 |
| `game.finished` | result·round·room 상태 commit 후 발행 | result_version과 state_version 포함 권장 |
| `room.deleted` | room 삭제 commit 후 발행 | 모든 클라이언트 localStorage 방 키 삭제 |
- Ready·온라인·현재 게임 입력 같은 고빈도 상태는 DB에 기록하지 않습니다.
- WebSocket 메시지 처리마다 짧은 transaction scope를 열고 즉시 connection pool에 반환합니다.
- 메시지 순서가 중요한 이벤트에는 `state_version`을 포함하고 과거 버전 이벤트를 무시합니다.

### 17. 데이터 무결성 경계

#### DB가 직접 보장

- 초대 코드와 멱등 request ID의 전역 중복 금지
- 활성 참가자의 방별 닉네임 중복 금지
- 방별 active host 최대 1명
- 방별 running round 최대 1개
- 참가자별 회차 내 투표 순번 중복 금지
- 회차별 최종 결과 최대 1개
- 다른 회차 선택지로 투표하는 참조 오류 차단
- 존재하지 않는 방·회차·참가자·선택지 참조 차단
- 방 상태·회차 상태·정원·투표 순번의 기본 범위

#### 서비스 트랜잭션이 보장

- 참가자·started_by·voter·winner가 해당 회차의 방 소속인지
- 현재 active 참가자 수가 방 정원보다 작은지
- host가 없는 active 방이 생기지 않는지
- 요청자가 현재 연결에서 host 권한을 가졌는지
- 게임별 허용 투표 수와 자기 투표 제한을 지켰는지
- 현재 상태에서 요청한 상태 전이가 허용되는지
- JSON config·result가 game_type과 schemaVersion에 맞는지
- `expires_at` 연장 대상이 실제 사용자 활동인지

MySQL CHECK는 다른 행이나 다른 테이블을 조회하는 규칙에 사용하지 않습니다. 위 교차 행 규칙을 trigger로 숨기지 않고 서비스 계층의 명시적 검증·행 잠금·통합 테스트로 관리합니다. 생성 컬럼 UNIQUE는 “최대 1명/1개”를 보장하며 host 최소 1명은 방 생성 트랜잭션과 host 퇴장 시 방 삭제로 보장합니다.

### 18. 권한·보안·개인정보

- 초대 코드는 방 검색 값이며 로그인이나 영구 인증 수단이 아닙니다.
- 초대 코드 검증 실패가 반복되면 IP·세션 단위 rate limiting과 지연을 적용합니다.
- 재접속용 세션 토큰은 발급하거나 DB에 저장하지 않습니다.
- 참가자 ID와 host 권한은 현재 WebSocket 연결에 서버 메모리로 바인딩합니다.
- 익명 투표의 `voter_participant_id`는 DB 내부 중복 방지에만 사용하고 일반 응답·로그에서 제외합니다.
- 로그에는 초대 코드 전체, bio 원문, 투표자 식별값, DB 비밀번호를 남기지 않습니다.
- localStorage는 방별 key를 사용하고 퇴장·방 삭제 이벤트에서 제거합니다.
- nickname·bio·option label은 API와 DB 양쪽에서 길이를 제한하고 출력 시 escape합니다.
- SQLAlchemy parameter binding을 사용하며 문자열 연결로 SQL을 만들지 않습니다.
- 운영 연결은 TLS를 사용하고 비밀번호·DB URL은 Kubernetes Secret 또는 승인된 Secret 저장소로 주입합니다.
- 운영 DB 계정을 분리합니다.
- `modupick_app`: 필요한 SELECT·INSERT·UPDATE·DELETE만 허용
- `modupick_migrator`: 배포 migration에 필요한 DDL 권한만 허용
- 애플리케이션은 root 또는 ALL PRIVILEGES 계정을 사용하지 않음

### 19. MySQL 런타임·Migration 운영 규칙

#### MySQL 런타임 기준

- Docker image: `mysql:8.4`
- Runtime URL: `mysql+asyncmy://<user>:<password>@<host>:3306/<database>?charset=utf8mb4`
- 기본 설정: `default-time-zone=+00:00`, `character-set-server=utf8mb4`, `collation-server=utf8mb4_0900_ai_ci`
- SQL mode: `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`
- PK·FK는 SQLAlchemy MySQL dialect의 `BIGINT(unsigned=True)`로 선언하고 PK에 `autoincrement=True`를 적용합니다.
- INSERT 후 생성된 PK는 ORM flush에서 받아 사용하며 별도 UUID·ULID TypeDecorator를 두지 않습니다.
- VIRTUAL 생성 컬럼은 `Computed(..., persisted=False)` 또는 명시적 Alembic DDL로 생성합니다.
- 모든 FK·UNIQUE·CHECK·INDEX에 고정된 이름을 부여합니다.

#### Alembic 규칙

1. 이미 공유·적용된 migration 파일은 수정하지 않고 새 revision을 추가합니다.
2. `alembic revision --autogenerate` 결과는 후보안으로만 사용하고 DDL을 사람이 검토합니다.
3. 생성 컬럼 표현식과 복합 UNIQUE·복합 FK는 실제 생성 SQL을 확인합니다.
4. 데이터 변환과 큰 스키마 변경은 별도 revision으로 분리합니다.
5. 배포 호환성이 필요하면 **추가 → 양쪽 코드 호환 → 데이터 이관 → 구 컬럼 제거** 순서의 expand/contract 방식을 사용합니다.
6. 파괴적 변경 전에는 백업과 복원 절차를 먼저 검증합니다.
7. 빈 MySQL 8.4에서 `alembic upgrade head`를 실행합니다.
8. `alembic check`로 모델과 migration의 차이를 검사합니다.
9. 개발 환경에서는 downgrade·재-upgrade를 검증하되 운영 downgrade는 데이터 손실 가능성을 먼저 검토합니다.
10. seed 데이터는 migration에 넣지 않고 별도 명령으로 관리합니다.
11. migration은 Backend Pod 시작마다 실행하지 않고 배포 전용 Job에서 한 번만 실행합니다.
12. 여러 Alembic head가 생기면 merge revision으로 정리하고 운영 배포 전 단일 head인지 확인합니다.

MySQL DDL은 암묵적 commit이 발생할 수 있습니다. migration 중간 실패를 자동 rollback에만 의존하지 말고, 각 revision에 실패 후 상태 확인과 수동 정리 절차를 기록합니다.

### 20. 연결·성능 설정

- WebSocket 연결 하나가 DB session 하나를 계속 점유하지 않습니다.
- 이벤트 처리 시 session을 열고 짧게 사용한 뒤 즉시 반환합니다.
- 총 연결 수는 `(pool_size + max_overflow) × worker 수 × Pod 수`로 계산합니다.
- 예상 최대 연결 수가 MySQL `max_connections`의 80%를 넘지 않도록 합니다.
- SQLAlchemy `pool_pre_ping=true`를 사용합니다.
- `pool_recycle`은 MySQL `wait_timeout`보다 짧게 설정합니다.
- 연결 직후 세션 시간대 `+00:00`과 strict SQL mode 적용 여부를 확인합니다.
- 환경별로 `connect_timeout`, `read_timeout`, `write_timeout`, `innodb_lock_wait_timeout`, `max_execution_time`을 지정합니다.
- room state 조회는 필요한 관계만 eager loading하거나 명시적 query로 작성해 N+1을 방지합니다.
- 초대 코드, 방 참가자, 현재 회차, 만료 방 조회는 인덱스 사용을 `EXPLAIN ANALYZE`로 확인합니다.
- 타이머 tick·애니메이션·고빈도 소켓 이벤트를 저장하지 않아 write 부하를 제한합니다.
- 대용량 이벤트 로그를 저장하지 않으므로 MVP에서는 파티셔닝을 도입하지 않습니다.

### 21. 보관·삭제·백업

| 대상 | 확정 정책 | 처리 방식 |
| --- | --- | --- |
| 활성 방 | 마지막 활동 후 10분 만료 | running 회차 취소 후 rooms 삭제 |
| 참가자·회차·선택지·투표·결과 | 별도 보관하지 않음 | 방 삭제 시 FK CASCADE |
| 개별 퇴장 참가자 | 방이 살아 있는 동안 행 유지 | `left_at` 갱신, 방 삭제 때 물리 삭제 |
| 실시간 서버 메모리 | 방 삭제·연결 종료 시 제거 | 명시적 삭제, Redis TTL 사용 안 함 |
| 채팅 | DB 비저장 | 브라우저 localStorage 방별 key 삭제 |
| 운영 백업 | 1일 1회, 파괴적 migration 전 추가 | `mysqldump --single-transaction` 또는 MySQL Shell dump |
- 만료 검색은 `expires_at` 인덱스를 사용하고 삭제 작업은 1분 이내 주기로 실행합니다.
- 방장 퇴장과 명시적 방 종료는 요청 트랜잭션에서 즉시 삭제합니다.
- 이미 삭제된 방 데이터를 사용자에게 복구해 주는 기능은 제공하지 않습니다.
- 백업 파일 존재만 확인하지 않고 별도 MySQL 인스턴스에 복원해 테이블 수·행 수·FK 무결성을 검증합니다.
- 백업 보존 기간·암호화·저장 위치는 실제 배포 환경 확정 시 인프라 운영 문서에 기록합니다.

### 22. 배포·환경 운영 기준

- 백엔드 인스턴스는 MVP 동안 1개로 고정합니다. Kubernetes replicas를 2 이상으로 올리지 않습니다.
- nginx·Ingress의 WebSocket upgrade, idle timeout, 최대 payload 설정을 통합 테스트합니다.
- 필수 환경변수: `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, 애플리케이션 `DATABASE_URL`.
- 실제 비밀값은 `.env.example`에 넣지 않고 Secret으로 주입합니다.
- MySQL 기본 설정: `default-time-zone=+00:00`, `character-set-server=utf8mb4`, `collation-server=utf8mb4_0900_ai_ci`.
- SQL mode: `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`.
- liveness probe는 프로세스 생존만 확인합니다.
- readiness probe는 DB 연결과 migration revision 일치 여부를 확인합니다.
- 로컬·테스트·운영 DB와 계정을 분리합니다. 운영 DB를 로컬 개발에서 직접 사용하지 않습니다.
- 만료 삭제 작업은 단일 인스턴스의 scheduler 또는 별도 단일 Job 중 하나로 운영하고 중복 실행돼도 안전하게 구현합니다.
- 배포 순서: migration Job 성공 → Backend 배포 → readiness 확인 → 트래픽 전환.

### 23. 모니터링·알림 항목

#### DB·connection pool

- 활성 DB 연결 수, pool 사용률, pool 대기 시간
- 요청·소켓 이벤트별 query 수와 p95 query 시간
- slow query, lock wait, deadlock, 트랜잭션 재시도 횟수
- MySQL CPU·메모리·disk 사용량과 DB 저장 용량 증가 추세

#### 무결성·애플리케이션

- UNIQUE·FK·CHECK 위반 횟수
- 방 입장 409, 중복 투표, 상태 버전 충돌 횟수
- WebSocket 이벤트 전송 실패와 비정상 연결 종료 횟수
- 익명 투표 응답·로그에 voter 식별값이 포함됐는지 샘플 점검
- 초대 코드·bio·DB 비밀값이 로그에 포함됐는지 샘플 점검

#### 운영 작업

- 현재 Alembic revision과 배포 버전
- migration 성공·실패와 실행 시간
- 10분 만료 대상 수, 삭제 성공·실패·지연 시간, 삭제 행 수
- 백업 성공·실패, 마지막 복원 테스트 시각
- pool 고갈, migration 실패, 백업 실패, 만료 삭제 연속 실패는 즉시 확인 대상으로 둡니다.
- 세부 임계치는 10명 동시 입장과 여러 방 동시 게임 부하 테스트 후 확정합니다.

### 24. 테스트 매트릭스

#### 핵심 검증

- [ ]  빈 MySQL 8.4에서 전체 DDL·migration이 성공한다.
- [ ]  방별 active host가 2명 생성되지 않는다.
- [ ]  방별 running round가 2개 생성되지 않는다.
- [ ]  퇴장한 닉네임은 재사용할 수 있고 active 닉네임 중복은 거절된다.
- [ ]  방 삭제 시 참가자·회차·선택지·투표·결과가 함께 삭제된다.
- [ ]  개인 퇴장 시 기존 투표가 삭제되지 않는다.
- [ ]  다른 회차의 option으로 투표할 수 없다.
- [ ]  마지막 한 자리에 동시 입장해도 한 명만 성공한다.
- [ ]  익명 투표 응답에 voter ID가 포함되지 않는다.
- [ ]  채팅 메시지가 DB에 기록되지 않는다.
- [ ]  모든 엔티티 ID가 API·WebSocket에서 10진 문자열로 직렬화되고 프런트엔드에서 숫자로 강제 변환되지 않는다.
- [ ]  DB와 애플리케이션 세션 시간대가 `+00:00`이다.

#### 제약조건 테스트

- [ ]  `max_participants`가 2 미만 또는 10을 초과하면 DB가 거절한다.
- [ ]  확정된 초대 코드 형식과 맞지 않는 값이 거절된다.
- [ ]  같은 초대 코드와 같은 `create_request_id`를 두 번 저장할 수 없다.
- [ ]  한 방에 active host가 두 명 생성되지 않는다.
- [ ]  한 방에 running round가 두 개 생성되지 않는다.
- [ ]  활성 닉네임은 대소문자·앞뒤 공백 정규화 후 중복되지 않는다.
- [ ]  퇴장한 참가자의 닉네임은 새 참가자가 재사용할 수 있다.
- [ ]  다른 회차의 option으로 vote를 저장할 수 없다.
- [ ]  같은 회차·참가자·vote_no를 중복 저장할 수 없다.
- [ ]  한 회차에 result를 두 개 저장할 수 없다.
- [ ]  잘못된 room·round 상태 값과 1 미만의 result_version·vote_no가 거절된다.

#### 트랜잭션·동시성 테스트

- [ ]  남은 자리 1개에 여러 명이 동시에 입장해도 한 명만 성공한다.
- [ ]  동일한 방 생성 request_id를 재전송해도 방과 host가 한 번만 생성된다.
- [ ]  두 명이 동시에 게임 시작을 요청해도 running round가 하나만 생성된다.
- [ ]  동일한 투표 request_id를 재전송하면 기존 성공 결과가 반환된다.
- [ ]  게임 결과 저장 중 오류가 발생하면 result·round·room 상태가 함께 rollback된다.
- [ ]  방장 퇴장 시 running round 취소와 room 삭제가 한 트랜잭션에서 처리된다.
- [ ]  guest 퇴장 시 `left_at`만 갱신되고 기존 vote는 유지된다.
- [ ]  동일한 방 삭제 요청을 반복해도 최종 결과가 성공으로 일관된다.
- [ ]  만료 작업이 동시에 실행돼도 만료되지 않은 방은 삭제하지 않는다.
- [ ]  deadlock을 강제로 발생시켰을 때 최대 3회 재시도 후 성공 또는 명확한 오류로 종료한다.

#### API·WebSocket 계약 테스트

- [ ]  `roomName`, `avatarKey`, `bio`가 DB 컬럼에 손실 없이 매핑된다.
- [ ]  `snipe`, `nunchi` game ID가 CHECK와 소켓 이벤트에서 동일하다.
- [ ]  `targetMemberId`가 같은 회차의 game_option으로만 변환된다.
- [ ]  `laneIndex`가 서버의 회차별 option 순서와 일치한다.
- [ ]  DB commit 전에 `participant.joined`, `game.started`, `game.finished`, `room.deleted`가 전송되지 않는다.
- [ ]  state_version이 오래된 요청은 409 또는 정해진 소켓 오류로 거절된다.
- [ ]  진행 중인 방에는 새로운 참가자로 입장할 수 없다.
- [ ]  새로고침·연결 종료 후 기존 participant ID로 복구되지 않는다.

#### 개인정보·보안 테스트

- [ ]  익명 투표 API·WebSocket 응답에 voter ID가 포함되지 않는다.
- [ ]  채팅 메시지가 어떤 DB 테이블에도 기록되지 않는다.
- [ ]  초대 코드 전체·bio·투표자·DB 비밀번호가 애플리케이션 로그에 남지 않는다.
- [ ]  초대 코드 반복 검증에 rate limiting이 적용된다.
- [ ]  app 계정으로 DDL을 실행할 수 없고 migrator 계정만 migration 권한을 가진다.
- [ ]  SQL injection 문자열이 parameter binding으로 안전하게 처리된다.
- [ ]  방 삭제·퇴장 이벤트 후 해당 방 localStorage key가 제거된다.

#### Migration·타입 테스트

- [ ]  빈 MySQL 8.4에서 `alembic upgrade head`가 성공한다.
- [ ]  현재 revision이 있는 기존 DB에서 최신 revision까지 upgrade가 성공한다.
- [ ]  개발 환경에서 downgrade 후 재-upgrade가 성공한다.
- [ ]  `alembic check`가 모델과 migration의 불일치를 발견한다.
- [ ]  모든 PK가 `BIGINT UNSIGNED AUTO_INCREMENT`, 모든 FK가 동일한 `BIGINT UNSIGNED` 타입으로 생성된다.
- [ ]  DB와 애플리케이션 세션 시간대가 `+00:00`이고 `TIMESTAMP(6)` 정밀도가 유지된다.
- [ ]  VIRTUAL 생성 컬럼과 관련 UNIQUE가 실제 MySQL 8.4에서 생성된다.
- [ ]  방 삭제 CASCADE가 생성 컬럼 제약과 충돌하지 않는다.
- [ ]  migration 중간 실패 후 문서화된 수동 정리 절차로 일관된 상태를 복구할 수 있다.

#### 성능·운영 테스트

- [ ]  한 방에 10명이 동시에 입장할 때 정원과 응답 시간이 정상이다.
- [ ]  여러 방에서 동시에 투표·게임 종료를 실행해도 pool 고갈이 발생하지 않는다.
- [ ]  WebSocket 유휴 연결 수가 늘어도 DB connection 수가 같은 비율로 증가하지 않는다.
- [ ]  초대 코드·active 참가자·running round·만료 방 조회가 의도한 인덱스를 사용한다.
- [ ]  slow query·lock wait·deadlock 지표가 수집된다.
- [ ]  만료 삭제 작업이 1분 이내 주기로 실행되고 실패 알림이 발생한다.
- [ ]  백업을 새 MySQL 인스턴스에 복원한 뒤 테이블 수·행 수·FK 무결성을 확인한다.
- [ ]  migration 실패·백업 실패·pool 고갈 알림이 담당자에게 전달된다.

### 25. 구현 계획·담당 역할·완료 기준

#### 구현 단계

| 단계 | 산출물 | 선행 조건 | 완료 기준 |
| --- | --- | --- | --- |
| 1. 계약 확정 | 확정된 BIGINT 식별자 반영, 초대 코드·chat snapshot 결정 | PM·Backend·Frontend 공동 리뷰 | BIGINT 계약이 API·DB에 동일하게 반영되고 남은 미확정 2항목이 결정됨 |
| 2. 모델 구현 | SQLAlchemy 모델·Enum·MySQL unsigned BIGINT 타입·JSON Pydantic 모델 | 1단계 완료 | 모델 단위 테스트와 ID 문자열 직렬화 테스트 통과 |
| 3. Migration 구현 | 초기 Alembic revision과 downgrade·실패 복구 절차 | 최종 DDL 리뷰 | 빈 MySQL 8.4 upgrade와 `alembic check` 통과 |
| 4. 서비스 트랜잭션 | 방 생성·입장·퇴장·게임 시작·투표·종료·만료 처리 | 2·3단계 완료 | 동시성·멱등성 통합 테스트 통과 |
| 5. API·WebSocket 통합 | payload 변환, commit 후 이벤트 발행, 익명 응답 필터 | 실제 API 명세 확정 | 계약·개인정보 테스트 통과 |
| 6. 배포·운영 검증 | MySQL 설정, migration Job, pool, 만료 Job, 백업·모니터링 | 배포 환경·Secret 준비 | 부하·복원·알림 테스트 통과 |

#### 역할별 책임

| 역할 | 책임 | 필수 산출물 |
| --- | --- | --- |
| PM | 확정된 BIGINT 식별자 계약 승인, 초대 코드·chat snapshot의 제품 정책 확정, 최대 인원·만료·재접속 정책 변경 관리 | 결정 기록과 승인된 체크리스트 |
| DB/인프라 | DDL·제약조건·인덱스·MySQL 설정·Migration·백업·모니터링 검증 | ERD, Alembic revision, 복원 결과, 운영 설정 |
| Backend | 트랜잭션·행 잠금·멱등성·BIGINT 문자열 직렬화·JSON 검증·만료 삭제 구현 | SQLAlchemy 모델, repository/service 코드, 통합 테스트 |
| Frontend | camelCase 계약, localStorage 방별 저장·삭제, 재접속 미지원 UX, 익명 응답 처리 | API 타입, 소켓 핸들러, 저장소 삭제 테스트 |
| 공동 리뷰 | ERD와 API·WebSocket payload의 필드명·ID·상태·삭제 시점 일치 확인 | 리뷰 기록과 미해결 항목 0개 |

#### 의존성·리스크

- API·WebSocket ID를 JavaScript `Number`로 변환하면 장기적으로 정밀도 손실이 발생할 수 있으므로 계약 타입을 문자열로 고정합니다.
- 초대 코드를 숫자 6자리로 줄이면 탐색 가능성이 커지므로 rate limiting이 배포 전 필수입니다.
- Redis 없이 인스턴스를 2개 이상 실행하면 실시간 메모리 상태가 분리되므로 replica 증가는 금지합니다.
- 실제 API 이름이 문서와 다르면 DDL이 아니라 변환 계층과 매핑표를 먼저 수정합니다.
- `game_results.result_data` 스키마가 확정되지 않으면 결과 저장 구현과 계약 테스트가 완료되지 않습니다.
- migration 담당자·백업 복원 담당자가 정해지지 않으면 운영 배포 완료로 간주하지 않습니다.

#### 최종 성공 기준

- 6개 테이블 DDL과 Alembic migration이 MySQL 8.4에서 실제 실행됩니다.
- 동시 입장·동시 게임 시작·중복 투표가 제약조건과 트랜잭션으로 차단됩니다.
- 방장 퇴장·만료 시 모든 관련 데이터가 정책대로 삭제됩니다.
- 개인 퇴장 시 과거 투표가 유지되고 닉네임 재사용이 가능합니다.
- 익명 투표자·채팅·재접속 토큰이 외부 응답 또는 DB에 잘못 남지 않습니다.
- API·WebSocket·DB 필드명과 game ID가 하나의 계약으로 일치합니다.
- migration·부하·백업 복원·모니터링 테스트가 모두 통과합니다.

#### 남은 액션 아이템

- [x]  PM·Backend·Frontend: ID 형식을 `BIGINT UNSIGNED AUTO_INCREMENT` + API 10진 문자열로 확정
- [ ]  PM·Backend: 초대 코드 형식 확정
- [ ]  Backend·Frontend: `room:snapshot` 채팅 메모리 버퍼 여부 확정
- [ ]  Backend: 6개 게임의 config/result Pydantic 스키마 확정
- [ ]  Backend·Frontend: REST·WebSocket 경로·이벤트·payload 공동 확정
- [ ]  DB/인프라: 초기 Alembic revision과 MySQL 8.4 실행 결과 첨부
- [ ]  DB/인프라: migration·backup·restore 담당자 지정
- [ ]  전원: 최종 ERD·API 계약 공동 리뷰

### 26. 참고 자료·변경 이력

#### 참고 자료

#### 내부 문서

- [‣](https://app.notion.com/p/476de0c692b883c899a401a83cc3d37c?pvs=21)
- [‣](https://app.notion.com/p/17bde0c692b882afa547017e9a0db6e8?pvs=21)
- [‣](https://app.notion.com/p/705de0c692b88338bdbe81ccc4ba4cfa?pvs=21)

#### 공식 문서

- [MySQL 8.4 LTS](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html) — LTS 운영 기준
- [MySQL Foreign Key Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html) — InnoDB FK·CASCADE·생성 컬럼 기반 컬럼 제한
- [MySQL CHECK Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html) — CHECK 제약조건
- [Generated Columns and Indexes](https://dev.mysql.com/doc/refman/8.4/en/create-table-secondary-indexes.html) — VIRTUAL 생성 컬럼과 UNIQUE 인덱스
- [MySQL JSON](https://dev.mysql.com/doc/refman/8.4/en/json.html) — JSON 저장·검증
- [InnoDB Transaction Isolation](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html) — REPEATABLE READ
- [InnoDB Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html) — `SELECT ... FOR UPDATE`
- [MySQL Time Zone Support](https://dev.mysql.com/doc/refman/8.4/en/time-zone-support.html) — UTC 세션 설정
- [InnoDB Best Practices](https://dev.mysql.com/doc/refman/8.4/en/innodb-best-practices.html) — 명확한 자연 키가 없을 때 AUTO_INCREMENT PK 사용
- [Using AUTO_INCREMENT](https://dev.mysql.com/doc/refman/8.4/en/example-auto-increment.html) — AUTO_INCREMENT 생성·조회 규칙
- [SQLAlchemy MySQL Dialect](https://docs.sqlalchemy.org/en/20/dialects/mysql.html) — MySQL 연결·타입·드라이버
- [Alembic Autogenerate](https://alembic.sqlalchemy.org/en/latest/autogenerate.html) — migration 후보 생성과 `alembic check`

#### 변경 이력

- **2026-07-27 / v0.4:** 엔티티 식별자를 `BIGINT UNSIGNED AUTO_INCREMENT`로 확정. 모든 FK를 동일한 unsigned BIGINT로 통일하고 API·WebSocket ID를 10진 문자열로 고정. UUID·ULID 변환 계층 제거, 멱등 키는 대소문자를 구분하는 ASCII `VARCHAR(64)`로 분리.
- **2026-07-27 / v0.3:** 7/25안을 기준본으로 채택하고 7/26안의 API 필드·게임 매핑·퇴장 처리·게임별 저장표를 통합.
- **2026-07-27 / v0.3 풀버전 보강:** 컬럼 사전, 실시간 상태, 트랜잭션 매트릭스, 게임 JSON, REST·WebSocket 매핑, 무결성 경계, 보안, Migration, 성능, 보관·백업, 배포, 테스트, 모니터링, 구현 단계·담당 역할·완료 기준을 최종안 내부에 복원.
- `host_slot`, `running_slot`처럼 `room_id`를 참조하는 STORED 생성 컬럼 제거.
- active 참가자만 닉네임·방장 UNIQUE 제약을 적용하도록 수정.
- `READ COMMITTED` 강제 권장을 제거하고 MySQL 기본 `REPEATABLE READ`를 기준으로 통일.
- 아래 2026-07-25·2026-07-26 수정안은 검토 이력으로만 보관합니다.

## ✅ MySQL 최종안 v0.5 — API 명세 정합화 (2026-07-28)

> **현재 구현의 단일 기준 문서입니다.** [‣](https://app.notion.com/p/f9cde0c692b883979cbc0188a1b6163a?pvs=21)의 「REST API 명세」, 「실시간 소켓 이벤트 명세 수정본」, 문서 마지막의 확정 10개 항목을 기준으로 DB 구조와 처리 규칙을 맞췄습니다. 아래 v0.4 이하 문서는 변경 이력으로만 보관하며 구현 기준으로 사용하지 않습니다.
> 

### 1. 적용 원칙

- API 요청·응답 필드, REST 경로, WebSocket 이벤트명과 발생 시점은 API 명세서를 우선합니다.
- `memberId`, `roundId`, `messageId`는 접두어가 포함된 **불투명 문자열**입니다. 프런트엔드는 파싱하거나 숫자로 변환하지 않습니다.
- DB는 관계용 내부 PK로 `BIGINT UNSIGNED AUTO_INCREMENT`를 사용하고, API에 노출하는 참가자·라운드에는 별도 외부 ID를 둡니다.
- 방 코드는 `MODU-`를 제외한 숫자 6자리만 DB에 저장합니다. 화면 표시 시 `MODU-`를 붙입니다.
- 참가자는 `PENDING`으로 슬롯을 먼저 확보하고 프로필 확정 후 `ACTIVE`가 됩니다.
- 채팅, Ready, 온라인 여부, 현재 소켓, 타이머 tick, 게임 중간 연출은 DB에 저장하지 않습니다.
- 재접속은 지원하지 않습니다. 연결 종료 시 기존 참가자를 퇴장 처리하고 다시 입장하면 새 `memberId`를 발급합니다.
- 개별 참가자는 물리 삭제하지 않고 `left_at`을 갱신합니다. 방 삭제 시에만 FK CASCADE로 물리 삭제합니다.
- API에 없는 `create_request_id`, `votes.request_id`는 사용하지 않습니다. 투표 중복은 `(game_round_id, voter_participant_id, vote_no)` UNIQUE로 차단합니다.
- 모든 DB 변경 이벤트는 transaction commit 후 발행합니다.

### 2. API와 DB 필드 계약

| API | DB | 규칙 |
| --- | --- | --- |
| `code` | `rooms.code` | 숫자 6자리. `displayCode`는 `MODU-`를 붙여 생성 |
| `roomName` | `rooms.room_name` | 1~30자 |
| `maxMembers` | `rooms.max_members` | 2~10 |
| `memberId` | `participants.member_id` | `mbr_...` 형태의 불투명 문자열 |
| `memberStatus` | `participants.status` | `PENDING` / `ACTIVE` ↔ `pending` / `active` |
| `nickname` | `participants.nickname` | ACTIVE일 때 필수, 1~8자, 방 내 활성 참가자 UNIQUE |
| `avatarId` | `participants.avatar_id` | ACTIVE일 때 필수, `A01`~`A30`, 방 내 활성 참가자 UNIQUE |
| `bio` | `participants.bio` | 0~24자, 선택 |
| `roundId` | `game_rounds.round_id` | `rnd_...` 형태의 불투명 문자열 |
| `gameId` | `game_rounds.game_type` | `roulette`, `ladder`, `kingmaker`, `timer`, `snipe`, `nunchi` |
| `targetMemberId` | `participants.member_id` 조회 후 `game_options.participant_id` | 같은 방·같은 라운드인지 검증 |
| `laneIndex` | `game_options.sort_order` | 0부터 시작, 회차 내 UNIQUE |

### 3. ERD

```
rooms
  ├── 1:N participants
  └── 1:N game_rounds
              ├── 1:N game_options
              ├── 1:N votes
              └── 1:1 game_results

participants ──< game_options
participants ──< votes
participants ──< game_results
```

아바타 30종과 게임 메타 6종은 정적 애플리케이션 데이터이므로 별도 테이블을 만들지 않습니다.

### 4. 최종 DDL — MySQL 8.4

#### `rooms`

```sql
CREATE TABLE rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_name VARCHAR(30) NOT NULL,
  max_members SMALLINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at TIMESTAMP(3) NOT NULL,
  last_activity_at TIMESTAMP(3) NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_rooms PRIMARY KEY (id),
  CONSTRAINT uq_rooms_code UNIQUE (code),
  CONSTRAINT ck_rooms_code_format
    CHECK (REGEXP_LIKE(code, '^[0-9]{6}$', 'c')),
  CONSTRAINT ck_rooms_max_members
    CHECK (max_members BETWEEN 2 AND 10),
  CONSTRAINT ck_rooms_status
    CHECK (status IN ('waiting', 'playing')),
  INDEX idx_rooms_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- `CLOSED`는 DB 상태로 저장하지 않습니다. 방 종료·방장 퇴장·만료는 `rooms` 삭제로 표현합니다.
- 만료 시각이 지났지만 삭제 작업 전인 방은 `410 ROOM_EXPIRED`를 반환한 뒤 삭제합니다. 이미 물리 삭제된 코드는 `404 ROOM_NOT_FOUND`입니다.

#### `participants`

```sql
CREATE TABLE participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  nickname VARCHAR(8) NULL,
  avatar_id CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  bio VARCHAR(24) NULL,
  role VARCHAR(10) NOT NULL,
  joined_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  pending_expires_at TIMESTAMP(3) NULL,
  left_at TIMESTAMP(3) NULL,
  active_nickname VARCHAR(8)
    GENERATED ALWAYS AS (
      CASE
        WHEN status = 'active' AND left_at IS NULL
        THEN LOWER(TRIM(nickname))
        ELSE NULL
      END
    ) VIRTUAL,
  active_avatar_id CHAR(3) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE
        WHEN status = 'active' AND left_at IS NULL
        THEN avatar_id
        ELSE NULL
      END
    ) VIRTUAL,
  active_host_guard TINYINT
    GENERATED ALWAYS AS (
      CASE
        WHEN role = 'host' AND left_at IS NULL THEN 1
        ELSE NULL
      END
    ) VIRTUAL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_participants PRIMARY KEY (id),
  CONSTRAINT uq_participants_member_id UNIQUE (member_id),
  CONSTRAINT fk_participants_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT ck_participants_status CHECK (status IN ('pending', 'active')),
  CONSTRAINT ck_participants_role CHECK (role IN ('host', 'guest')),
  CONSTRAINT ck_participants_profile_state CHECK (
    (status = 'pending' AND nickname IS NULL AND avatar_id IS NULL)
    OR
    (status = 'active' AND nickname IS NOT NULL AND avatar_id IS NOT NULL)
  ),
  CONSTRAINT ck_participants_avatar CHECK (
    avatar_id IS NULL
    OR REGEXP_LIKE(avatar_id, '^A(0[1-9]|[12][0-9]|30)$', 'c')
  ),
  CONSTRAINT uq_participants_active_nickname
    UNIQUE (room_id, active_nickname),
  CONSTRAINT uq_participants_active_avatar
    UNIQUE (room_id, active_avatar_id),
  CONSTRAINT uq_participants_active_host
    UNIQUE (room_id, active_host_guard),
  INDEX idx_participants_room_active (room_id, left_at, status),
  INDEX idx_participants_pending_expiry (pending_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- `POST /api/rooms`는 방과 PENDING 방장을 같은 트랜잭션에서 생성합니다.
- `POST /api/rooms/{code}/members`는 PENDING 게스트를 생성하고 `pending_expires_at = NOW() + 15초`로 설정합니다.
- 게스트 핸드셰이크가 성공하면 `pending_expires_at`을 NULL로 갱신합니다. 15초가 지나도록 값이 남아 있는 PENDING 게스트만 `left_at`을 채워 슬롯을 해제합니다.
- 방장은 프로필 확정 후 소켓을 연결하므로 `pending_expires_at`을 처음부터 NULL로 둡니다.
- `PATCH /api/rooms/{code}/members/me`는 닉네임·아바타·bio를 저장하고 status를 ACTIVE로 바꿉니다.
- ACTIVE 전환 commit 후에만 `member:joined`를 브로드캐스트합니다.
- `currentMembers`는 `left_at IS NULL`인 PENDING+ACTIVE를 합산합니다. 조회·입장 트랜잭션 시작 시 `pending_expires_at <= NOW()`인 미연결 PENDING 게스트를 먼저 퇴장 처리합니다.
- 개별 퇴장·강퇴·연결 종료는 `left_at`만 갱신합니다.

#### `game_rounds`

```sql
CREATE TABLE game_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  round_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  game_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL,
  config JSON NOT NULL,
  started_by BIGINT UNSIGNED NULL,
  started_at TIMESTAMP(3) NULL,
  ended_at TIMESTAMP(3) NULL,
  ended_reason VARCHAR(30) NULL,
  active_round_guard TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('ready', 'running') THEN 1 ELSE NULL END
    ) VIRTUAL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_game_rounds PRIMARY KEY (id),
  CONSTRAINT uq_game_rounds_round_id UNIQUE (round_id),
  CONSTRAINT fk_game_rounds_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_rounds_started_by FOREIGN KEY (started_by)
    REFERENCES participants(id) ON DELETE SET NULL,
  CONSTRAINT ck_game_rounds_game_type CHECK (
    game_type IN ('roulette', 'ladder', 'kingmaker', 'timer', 'snipe', 'nunchi')
  ),
  CONSTRAINT ck_game_rounds_status CHECK (
    status IN ('ready', 'running', 'finished', 'cancelled')
  ),
  CONSTRAINT uq_game_rounds_active
    UNIQUE (room_id, active_round_guard),
  CONSTRAINT uq_game_rounds_id_room UNIQUE (id, room_id),
  INDEX idx_game_rounds_room_started (room_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- `roundId`는 API의 `rnd_...` 문자열을 그대로 사용합니다.
- API phase인 `READY`, `PLAYING`, `TIE`, `RESULT`는 단일 백엔드 메모리에서 관리합니다. 최종 영속 상태만 `ready`, `running`, `finished`, `cancelled`에 저장합니다.
- 결과 확정 시 round를 finished로 바꾸지만 room은 playing을 유지합니다.
- 방장이 `round:close`를 보내야 room을 waiting으로 변경하고 `round:closed`를 발행합니다.
- 결과 화면에서 `game:start`를 다시 보내면 finished 회차 이후 새 `roundId`로 재시작할 수 있습니다.

#### `game_options`

```sql
CREATE TABLE game_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  participant_id BIGINT UNSIGNED NULL,
  label VARCHAR(120) NOT NULL,
  sort_order SMALLINT NOT NULL,
  CONSTRAINT pk_game_options PRIMARY KEY (id),
  CONSTRAINT fk_game_options_round FOREIGN KEY (game_round_id)
    REFERENCES game_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_options_participant FOREIGN KEY (participant_id)
    REFERENCES participants(id) ON DELETE SET NULL,
  CONSTRAINT uq_game_options_id_round UNIQUE (id, game_round_id),
  CONSTRAINT uq_game_options_round_order UNIQUE (game_round_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

`king.opinion.text`의 API 최대 길이 120자에 맞춰 `label`도 120자로 통일합니다.

#### `votes`

```sql
CREATE TABLE votes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  voter_participant_id BIGINT UNSIGNED NOT NULL,
  option_id BIGINT UNSIGNED NOT NULL,
  vote_no SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_votes PRIMARY KEY (id),
  CONSTRAINT fk_votes_round FOREIGN KEY (game_round_id)
    REFERENCES game_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_voter FOREIGN KEY (voter_participant_id)
    REFERENCES participants(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_option_round FOREIGN KEY (option_id, game_round_id)
    REFERENCES game_options(id, game_round_id) ON DELETE CASCADE,
  CONSTRAINT uq_votes_round_voter_no
    UNIQUE (game_round_id, voter_participant_id, vote_no),
  CONSTRAINT ck_votes_vote_no CHECK (vote_no >= 1),
  INDEX idx_votes_round (game_round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- API `game:action`에는 request ID가 없으므로 `votes.request_id`를 두지 않습니다.
- UNIQUE 충돌 시 기존 투표를 조회해 동일한 성공 결과를 반환합니다.
- 익명 게임에서도 투표자는 중복 방지를 위해 내부 저장하지만 일반 응답·로그에서는 제외합니다.

#### `game_results`

```sql
CREATE TABLE game_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  winner_participant_id BIGINT UNSIGNED NULL,
  result_data JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_game_results PRIMARY KEY (id),
  CONSTRAINT fk_game_results_round FOREIGN KEY (game_round_id)
    REFERENCES game_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_results_winner FOREIGN KEY (winner_participant_id)
    REFERENCES participants(id) ON DELETE SET NULL,
  CONSTRAINT uq_game_results_round UNIQUE (game_round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

게임별 `result` 객체는 API의 `game:result { roundId, type, result }`에 맞는 Pydantic 모델로 검증한 뒤 `result_data`에 저장합니다.

### 5. REST API와 DB 처리

| API | DB 처리 | 주의사항 |
| --- | --- | --- |
| `POST /api/rooms` | rooms + PENDING host participant 생성 | `hostToken`, `memberId` 발급. API에 없는 멱등 키를 요구하지 않음 |
| `GET /api/rooms/{code}` | code로 상태·만료·PENDING+ACTIVE 인원 조회 | playing이면 `ROOM_ALREADY_PLAYING` |
| `POST /api/rooms/{code}/members` | room 잠금 후 정원 확인, PENDING guest 생성 | 15초 핸드셰이크 제한 |
| `GET /api/rooms/{code}/avatars` | 정적 A01~A30 + active participant의 avatar_id 조회 | Bearer 필요 |
| `PATCH /api/rooms/{code}/members/me` | PENDING participant 잠금, 프로필 저장, ACTIVE 전환 | commit 후 `member:joined` |
| `DELETE /api/rooms/{code}/members/me` | guest는 left_at, host는 room 삭제 | commit 후 `member:left` 또는 `room:closed` |
| `GET /api/games` | DB 미사용 | 정적 게임 6종 |
| `GET /api/games/{gameId}` | DB 미사용 | 정적 가이드·configSchema |

Bearer 토큰은 DB에 저장하는 재접속 세션이 아니라 현재 참가자·역할을 확인하는 서명 토큰으로 사용합니다. 소켓 연결 종료 후 동일 토큰으로 재접속하지 못하도록 서버 메모리 연결 상태와 `left_at`을 확인합니다.

### 6. WebSocket 이벤트와 DB 처리

#### 클라이언트 → 서버

| 이벤트 | DB 처리 |
| --- | --- |
| `member:ready` | DB 미사용, 서버 메모리 갱신 |
| `member:kick` | 대상 participant의 left_at 갱신 후 `member:left` |
| `chat:send`, `chat:typing` | DB 미사용 |
| `game:select`, `game:config`, `game:random` | 서버 메모리 갱신. game:start 시 config를 round에 저장 |
| `game:start` | round·options 생성, room playing |
| `game:action` / `king.opinion` | game_options에 최대 120자로 저장 |
| `game:action` / `king.vote`, `snipe.vote` | targetMemberId를 participant·option으로 변환해 vote 저장 |
| `game:action` / `ladder.pick` | laneIndex를 sort_order로 검증, 최종 배정만 결과에 저장 |
| `game:action` / timer·roulette·nunchi | 중간 입력은 메모리, 최종 결과만 저장 |
| `round:close` | host 권한 확인 후 room waiting으로 변경 |

#### 서버 → 클라이언트

- API 명세의 콜론 이벤트명만 사용합니다: `room:snapshot`, `member:joined`, `member:left`, `member:ready_changed`, `chat:message`, `chat:typing`, `game:selected`, `game:config_changed`, `game:started`, `game:phase`, `game:tick`, `game:progress`, `game:tie`, `game:result`, `round:closed`, `room:closed`, `error`.
- `participant.joined`, `game.started`, `room.deleted` 같은 점 표기 이벤트는 사용하지 않습니다.
- DB를 변경하는 이벤트는 commit 후 발행합니다.
- `roomVersion`은 Redis 없는 단일 백엔드 메모리에서 방별 증가 정수로 관리하고 모든 S→C `data`에 포함합니다. 재접속을 지원하지 않으므로 DB 컬럼으로 저장하지 않습니다.
- `room:snapshot`은 ACTIVE 참가자만 포함합니다.
- API 문서 마지막 확정 항목 9를 우선하여 서버는 과거 채팅 50건을 저장·복구하지 않습니다. `messages`는 생략하거나 빈 배열로 보내고, 게임 화면에서 대기방으로 돌아올 때의 채팅 복원은 프런트 localStorage가 담당합니다.
- `round:close` commit 후 `round:closed`를 전원에게 보내고 대기방으로 전환합니다.

### 7. 상태 머신

```
participant:
  PENDING ──프로필 확정──> ACTIVE ──퇴장/강퇴/연결종료──> left_at 설정
  PENDING ──15초 미연결 또는 취소──> left_at 설정

room:
  waiting ──game:start──> playing
  playing ──game:result──> playing (결과 화면 유지)
  playing ──round:close──> waiting
  playing ──game:start 재시도──> playing (새 roundId)
  waiting/playing ──방장 퇴장·만료──> DELETE CASCADE

round:
  ready ──시작──> running ──결과 확정──> finished
  ready/running ──취소·방 삭제──> cancelled
```

API phase `READY → PLAYING → TIE → RESULT`는 round 내부 진행 상태이며 서버 메모리에서 관리합니다. 재투표는 새 라운드가 아니라 같은 `roundId`의 TIE phase입니다.

### 8. 트랜잭션·동시성

- 방 생성: 방 + PENDING host를 한 트랜잭션에서 생성합니다.
- 방 입장: room을 `SELECT ... FOR UPDATE`로 잠근 뒤 만료된 미연결 PENDING 게스트를 먼저 퇴장 처리하고, `left_at IS NULL`인 PENDING+ACTIVE 인원을 세어 최대 정원을 검사합니다.
- 프로필 확정: participant와 room을 잠그고 닉네임·아바타 중복을 검사한 뒤 ACTIVE로 전환합니다. 생성 컬럼 UNIQUE가 마지막 경합을 차단합니다.
- 게임 시작: room을 잠그고 host·ACTIVE 2명 이상·준비 완료·설정을 확인한 뒤 round를 생성합니다.
- 투표: round·voter·option을 검증하고 UNIQUE로 중복을 차단합니다.
- 결과 확정: round 잠금 → result 저장 → round finished. room은 playing 유지.
- 대기방 복귀: `round:close`에서 room 잠금 → waiting 변경 → commit 후 `round:closed`.
- 방장 퇴장·만료: room 잠금 → 진행 회차 cancelled → room 삭제 → commit 후 `room:closed`.
- deadlock·lock wait timeout은 전체 트랜잭션을 제한된 횟수만 재시도합니다.

### 9. 필수 계약 테스트

- [ ]  `POST /api/rooms` 응답의 `memberId`가 문자열이며 DB `participants.member_id`와 같다.
- [ ]  PENDING 참가자는 nickname·avatarId 없이 생성된다.
- [ ]  PENDING+ACTIVE 합계가 maxMembers를 넘지 않는다.
- [ ]  가입 후 15초 안에 핸드셰이크하지 않은 guest 슬롯이 해제된다.
- [ ]  ACTIVE 전환 전에는 `member:joined`가 전송되지 않는다.
- [ ]  같은 방의 활성 닉네임과 아바타가 동시 요청에서도 중복되지 않는다.
- [ ]  A01~A30만 허용되고 A31은 거절된다.
- [ ]  방 코드는 숫자 6자리만 저장되고 `displayCode`에만 `MODU-`가 붙는다.
- [ ]  `king.opinion` 120자가 손실 없이 저장된다.
- [ ]  `king.vote`, `snipe.vote`의 targetMemberId가 같은 라운드 option으로만 변환된다.
- [ ]  익명 게임 응답·로그에 voter ID가 노출되지 않는다.
- [ ]  결과 확정 뒤에도 room은 playing이고 `round:close` 후 waiting으로 바뀐다.
- [ ]  이벤트명은 API 명세의 콜론 표기와 정확히 일치한다.
- [ ]  모든 S→C data에 증가하는 roomVersion이 포함된다.
- [ ]  채팅이 DB에 저장되지 않고 서버 snapshot에서 과거 50건을 복구하지 않는다.
- [ ]  guest 퇴장 시 기존 vote가 유지된다.
- [ ]  host 퇴장·방 만료 시 모든 하위 데이터가 CASCADE 삭제된다.
- [ ]  새로고침·소켓 종료 후 기존 memberId·토큰으로 재접속할 수 없다.
- [ ]  빈 MySQL 8.4에서 Alembic upgrade가 성공하고 모델과 migration이 일치한다.

### 10. 변경 이력과 남은 작업

- **2026-07-28 / v0.5:** API 명세를 최종 기준으로 채택했습니다.
- 외부 ID를 BIGINT 10진 문자열에서 `memberId`·`roundId` 불투명 문자열로 변경했습니다.
- 숫자 6자리 방 코드, `avatarId` A01~A30, PENDING/ACTIVE 참가자 수명주기를 반영했습니다.
- 활성 닉네임·아바타 중복 제약을 추가했습니다.
- API에 없는 `create_request_id`, `votes.request_id`, DB `state_version`을 제거했습니다.
- `king.opinion` 최대 120자에 맞춰 option label을 120자로 변경했습니다.
- REST 경로와 WebSocket 이벤트명을 API 명세와 동일하게 정리했습니다.
- 결과 확정과 대기방 복귀를 분리하고 `round:close`/`round:closed`를 반영했습니다.
- 채팅 snapshot 50건을 제거하고 localStorage 정책으로 통일했습니다.
- [ ]  Backend: `memberId`, `roundId` 생성기와 Pydantic 응답 타입 구현
- [ ]  Backend: 위 DDL 기준 SQLAlchemy 모델·Alembic revision 작성
- [ ]  Frontend: ID를 숫자로 변환하지 않고 불투명 문자열로 유지
- [ ]  Frontend·Backend: 콜론 이벤트명과 roomVersion 계약 테스트
- [ ]  DB/인프라: MySQL 8.4에서 전체 DDL·FK·생성 컬럼 실행 검증

## 반드시 수정해야 하는 충돌

| 중요도 | 항목 | 충돌 내용 |
| --- | --- | --- |
| 구현 차단 | ID 형식 | API는 `mbr_01H...`, `rnd_01H...` 형태를 사용하지만 DB v0.4는 `BIGINT UNSIGNED`를 10진 문자열로 내려주도록 확정했습니다. |
| 구현 차단 | PENDING/ACTIVE | API는 가입 시 `PENDING`, 프로필 확정 후 `ACTIVE`를 요구합니다. DB에는 상태 컬럼이 없고 `nickname`, `avatar_key`가 `NOT NULL`이라 PENDING 참가자를 생성할 수 없습니다. |
| 구현 차단 | 방 코드 | API는 숫자 6자리입니다. DB 설명은 숫자 가정, 계약 상태는 영문·숫자 6자리, 실제 DDL은 `VARCHAR(8)` + 영문·숫자 6자리 CHECK로 서로도 일치하지 않습니다. |
| 구현 차단 | 아바타 | API는 `avatarId`, 30종을 사용합니다. DB 매핑은 `avatarKey`, 값은 `A01~A15`로 적혀 있으며 방 안에서 아바타 중복을 막는 제약·트랜잭션 규칙도 없습니다. |
| 구현 차단 | 멱등 키 | DB의 `rooms.create_request_id`, `votes.request_id`는 `NOT NULL UNIQUE`인데 API 요청에는 해당 헤더나 필드가 없습니다. |
| 높음 | 이벤트 이름 | API는 `member:joined`, `game:started`, `room:closed` 등 콜론 형식이고, DB 문서는 `participant.joined`, `game.started`, `room.deleted` 등 점 형식입니다. |
| 높음 | 참가 이벤트 시점 | API의 `member:joined`는 PATCH로 ACTIVE가 된 뒤 발생합니다. DB 문서는 participant INSERT 직후 발행하도록 적혀 있습니다. |
| 높음 | 라운드 종료 | API는 결과 화면 이후 방장이 `round:close`를 보내야 대기방으로 복귀합니다. DB는 게임 결과 저장과 동시에 room을 `waiting`으로 바꿉니다. |
| 높음 | 의견 길이 | API의 `king.opinion.text`는 최대 120자지만 `game_options.label`은 `VARCHAR(100)`입니다. |
| 보통 | 채팅 snapshot | API의 마지막 확정 내용은 localStorage만 사용하고 과거 채팅을 불러오지 않는다는 정책입니다. 그런데 같은 API 문서의 `room:snapshot`에는 최근 50건이 포함되어 있고, DB는 아직 미확정으로 표시합니다. |
| 보통 | CLOSED/EXPIRED | API는 `roomStatus: CLOSED`와 `410 ROOM_EXPIRED`를 정의하지만 DB는 방을 즉시 삭제합니다. 삭제 후에는 일반적인 `ROOM_NOT_FOUND`와 구별할 기록이 없습니다. |
| 문서 문제 | REST 경로 | API는 `/api/rooms/{code}/members/me`를 사용하지만 DB 매핑표에는 `/rooms/{code}/participants`, `/participants/{id}` 등이 적혀 있습니다. |

특히 PENDING 구조는 단순 문서 차이가 아니라 실제 DDL로 구현할 수 없는 상태입니다. 최소한 다음과 같은 수정이 필요합니다.

- `participants.member_status`에 `pending/active` 추가
- PENDING 동안 `nickname`, `avatar_key` NULL 허용
- ACTIVE 참가자만 닉네임·아바타 UNIQUE 적용
- `member:joined`는 INSERT가 아니라 ACTIVE 전환 커밋 후 발행
- `currentMembers`는 `left_at IS NULL`인 PENDING+ACTIVE를 합산

# 개발 전 반드시 정리할 문제

### 1. 다른 방의 참가자가 연결될 수 있음 — 가장 중요

현재 FK는 “ID가 존재하는가”만 확인합니다. “같은 방 소속인가”는 확인하지 못합니다.

따라서 DB만 보면 다음 데이터가 들어갈 수 있습니다.

- A방 라운드의 `started_by`가 B방 참가자
- A방 선택지의 `participant_id`가 B방 참가자
- A방 투표의 `voter_participant_id`가 B방 참가자
- A방 결과의 승자가 B방 참가자

`votes.option_id + game_round_id`는 복합 FK로 같은 라운드 선택지만 허용하므로 잘 설계됐지만, 참가자 관련 FK에는 같은 방 검증이 없습니다.

선택지는 두 가지입니다.

- MVP 권장: 서비스에서 `participant.room_id == round.room_id`를 매번 검증하고 통합 테스트로 고정
- DB 완전 보장: 하위 테이블에도 `room_id`를 넣고 `(id, room_id)` 복합 FK 구성

현재 규모에서는 서비스 검증으로 충분하지만, 누락되면 조용히 잘못된 데이터가 저장되므로 반드시 공통 검증 함수로 만들어야 합니다.

### 2. `vote_no`의 의미가 불명확함

현재 UNIQUE는 다음과 같습니다.

```
UNIQUE (game_round_id, voter_participant_id, vote_no)
```

그런데 API에는 `vote_no`가 없습니다. 특히 동점 재투표는 같은 `roundId`에서 반복됩니다.

따라서 Backend가 다음을 명확히 결정해야 합니다.

- 최초 투표: `vote_no = 1`
- 첫 번째 동점 재투표: `vote_no = 2`
- 두 번째 동점 재투표: `vote_no = 3`
- 같은 단계에서 중복 클릭: 같은 `vote_no`를 사용해 기존 성공 결과 반환

개념상 `vote_no`보다 `ballot_no` 또는 `tie_round_no`가 더 정확합니다.

한 단계에서 한 사람이 여러 표를 행사할 가능성이 있다면 다음처럼 둘로 나눠야 합니다.

```
ballot_no   재투표 차수
choice_no   해당 차수에서 몇 번째 표인지
```

이 규칙 없이 구현하면 네트워크 재전송을 “새로운 재투표”로 오인할 수 있습니다.

### 3. 기본 입력 제약이 조금 부족함

현재 DDL은 아래 값을 허용합니다.

- 공백만 있는 닉네임
- 공백만 있는 게임 선택지·킹메이커 의견
- 음수 `sort_order`
- 임의 문자열 `member_id`, `round_id`
- 한 참가자가 같은 라운드에 선택지를 여러 개 생성

최소한 다음 제약은 추가하는 것이 좋습니다.

```
CHECK (
  nickname IS NULL
  OR CHAR_LENGTH(TRIM(nickname)) BETWEEN 1 AND 8
);

CHECK (
  CHAR_LENGTH(TRIM(label)) BETWEEN 1 AND 120
);

CHECK (
  sort_order >= 0
);

UNIQUE (
  game_round_id,
  participant_id
);
```

`UNIQUE(game_round_id, participant_id)`는 `participant_id = NULL`인 사다리 선택지는 여러 개 허용하면서, 룰렛·저격 후보와 킹메이커 의견은 참가자당 하나로 제한합니다. MySQL UNIQUE는 NULL을 여러 개 허용합니다.

`member_id`, `round_id`도 서버 생성값만 저장하겠지만 API 접두어가 확정 계약이라면 형식 검증을 추가하는 편이 안전합니다.

```
CHECK (
  REGEXP_LIKE(member_id, '^mbr_[A-Za-z0-9]+$', 'c')
);

CHECK (
  REGEXP_LIKE(round_id, '^rnd_[A-Za-z0-9]+$', 'c')
);
```

MySQL 8.4 CHECK는 결정적 내장 함수와 연산자를 허용하므로 이런 검증 방식 자체는 가능합니다. [MySQL CHECK 제약조건](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html)

### 4. `winner_participant_id`와 `result_data`가 충돌할 수 있음

현재 결과가 두 곳에 저장됩니다.

```
winner_participant_id
result_data
```

룰렛 복수 당첨, 사다리 다중 배정, 저격 복수 탈락처럼 “승자 한 명”으로 표현되지 않는 게임이 있습니다.

따라서 다음 중 하나로 정해야 합니다.

- `winner_participant_id`를 `primary_winner_participant_id`로 명확히 정의
- 승자가 정확히 한 명인 게임에서만 사용
- MVP에서는 컬럼을 제거하고 `result_data`만 단일 기준으로 사용

제가 선택한다면 **전적·통계 조회가 없는 현재 MVP에서는 `winner_participant_id`를 제거하고 `result_data`만 사용**하겠습니다. 두 곳의 결과가 서로 다르게 저장되는 문제를 없앨 수 있습니다.

### 5. 참가자 물리 삭제 시 투표가 사라짐

현재는 다음 구조입니다.

```
FOREIGN KEY (voter_participant_id)
REFERENCES participants(id)
ON DELETE CASCADE
```

정상 정책대로 `left_at`만 갱신하면 문제가 없습니다. 하지만 Backend 버그나 관리 SQL로 참가자 한 명을 DELETE하면 그 사람의 투표도 즉시 삭제됩니다.

따라서 다음 중 하나는 필요합니다.

- 참가자 개별 DELETE를 수행하는 repository 메서드를 만들지 않음
- 방 삭제 외에는 참가자 DELETE가 발생하지 않는 통합 테스트
- 운영 DB 계정에서 임의 DELETE 경로 제한
- 필요하면 `ON DELETE RESTRICT` 또는 nullable + `SET NULL` 검토

단, FK 정책을 바꾸면 방 전체 CASCADE 삭제 순서와 함께 실제 MySQL에서 검증해야 합니다.

## 지금 설계에서 잘된 부분

다음 부분은 유지해도 좋습니다.

- 내부 `BIGINT` PK와 외부 불투명 ID 분리
- 숫자 6자리 방 코드 UNIQUE
- `PENDING → ACTIVE → left_at` 생명주기
- 활성 닉네임·아바타만 UNIQUE 처리
- 방별 host 최대 1명
- 방별 active round 최대 1개
- 다른 라운드 option으로 투표하지 못하게 하는 복합 FK
- round당 result 최대 1개
- 방 삭제 시 하위 데이터 CASCADE
- Ready·채팅·소켓 상태를 DB에서 제외
- commit 이후 WebSocket 이벤트 발행
- `rooms` 행 잠금으로 정원·게임 시작 경쟁 처리

특히 VIRTUAL 생성 컬럼에 UNIQUE 인덱스를 두는 방식은 MySQL 8.4에서 지원됩니다. NULL이 아닌 활성 값만 중복을 막는 현재 접근은 기술적으로 타당합니다. [MySQL 생성 컬럼 인덱스](https://dev.mysql.com/doc/refman/8.4/en/create-table-secondary-indexes.html)

## Backend에서 반드시 지켜야 하는 잠금 순서

DDL만으로 보장되지 않는 정원·권한·상태 전이는 트랜잭션이 중요합니다.

권장 순서는 다음과 같습니다.

```
room 잠금
→ round 잠금
→ participant 잠금
→ option 검증
→ vote/result 저장
→ commit
→ WebSocket 이벤트 전송
```

같은 종류의 작업은 항상 동일한 순서로 잠가야 합니다. MySQL은 `SELECT ... FOR UPDATE`로 최신 행을 잠글 수 있지만, 트랜잭션마다 잠금 순서가 다르면 deadlock이 발생할 수 있습니다. 애플리케이션은 deadlock 발생 시 전체 트랜잭션을 재시도해야 합니다. [MySQL 잠금 읽기](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html), [deadlock 처리](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks-handling.html)

또한 `SET time_zone = '+00:00'`은 DDL을 실행한 세션에만 적용됩니다. 애플리케이션 connection pool에서 새 연결이 만들어질 때도 UTC를 적용해야 합니다.

## 최종 판단

제 판단은 다음과 같습니다.

- ERD 방향: 좋음
- MySQL 문법·제약조건 구성: 대체로 타당
- API 수명주기 정합성: 대부분 맞음
- DB 단독 무결성: 아직 부족
- 동점 재투표·중복 요청 규칙: 추가 확정 필요
- 실제 개발 시작: 가능
- 초기 migration 확정: 아직 이른 상태

최소한 아래 네 가지를 정리한 뒤 migration을 만드는 것이 안전합니다.

1. 같은 방 참가자 검증을 공통 서비스 로직과 테스트로 고정
2. `vote_no`를 재투표 차수로 명확히 정의
3. 닉네임·label·sort_order·option 중복 제약 추가
4. `winner_participant_id` 유지 여부 결정