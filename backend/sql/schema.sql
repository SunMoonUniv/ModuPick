-- ═══════════════════════════════════════════════════════════════════════════
-- ModuPick — 스키마 정본
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 대상   MySQL 8.4
-- 정본   docs/06_database/02_rooms_participants.md · 03_game_rounds.md
--        · 04_options_votes_results.md 의 DDL
-- 전수   docs/06_database/05_constraints_integrity.md
--
-- 이 파일이 스키마의 정본이다. Alembic을 쓰지 않으며 스키마를 바꿀 때는
-- 이 파일을 고치고 DB를 지운 뒤 다시 적용한다. ModuPick은 서버를 재기동할
-- 때마다 모든 방을 삭제하므로(docs/06_database/06_transactions_concurrency.md)
-- 보존해야 할 데이터가 구조적으로 존재하지 않는다.
--
-- ┌─ 경고 ────────────────────────────────────────────────────────────────┐
-- │ 아래 DROP 블록이 활성 상태다. 이 파일을 실행하면 기존 6테이블이 지워진다. │
-- └───────────────────────────────────────────────────────────────────────┘
--
-- 적용
--   mysql -u root -p modupick < backend/sql/schema.sql
--
-- 세션 설정 주의
--   시간대 +00:00과 strict SQL mode는 여기서 SET 해도 이 세션에만 적용된다.
--   애플리케이션 커넥션 풀이 새 연결마다 같은 설정을 적용해야 한다
--   (docs/06_database/06_transactions_concurrency.md 「연결·성능」).
--
-- 만들어지는 것
--   테이블 6 · PK 6 · UNIQUE 15 · CHECK 24 · FK 9(전부 CASCADE)
--   · 독립 인덱스 10 · VIRTUAL 생성 컬럼 4
--   전체 인덱스는 31개다(제약 부수 21 + 독립 10).
--   파일 끝의 검증 쿼리로 개수를 확인할 수 있다.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 0. 기존 테이블 정리 — FK 역순
-- ───────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS game_results;
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS game_options;
DROP TABLE IF EXISTS game_rounds;
DROP TABLE IF EXISTS participants;
DROP TABLE IF EXISTS rooms;


-- ───────────────────────────────────────────────────────────────────────────
-- 1. rooms — 방
--    PK 1 · UNIQUE 1 · CHECK 5 · 인덱스 1
--
--    status는 waiting · playing 둘뿐이다. 방 종료는 값이 아니라 행 삭제이며,
--    결과가 확정돼도 방은 playing을 유지하다가 방장의 대기방 복귀에서
--    waiting으로 돌아간다.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_name VARCHAR(30) NOT NULL,
  max_members SMALLINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_activity_at TIMESTAMP(6) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  CONSTRAINT pk_rooms PRIMARY KEY (id),
  CONSTRAINT uq_rooms_code UNIQUE (code),

  CONSTRAINT ck_rooms_code_format
    CHECK (REGEXP_LIKE(code, '^[0-9]{6}$', 'c')),
  CONSTRAINT ck_rooms_room_name_len
    CHECK (CHAR_LENGTH(TRIM(room_name)) BETWEEN 1 AND 30),
  CONSTRAINT ck_rooms_max_members
    CHECK (max_members BETWEEN 2 AND 10),
  CONSTRAINT ck_rooms_status
    CHECK (status IN ('waiting', 'playing')),
  CONSTRAINT ck_rooms_expiry_order
    CHECK (expires_at > last_activity_at),

  INDEX idx_rooms_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. participants — 방 참가자
--    PK 1 · UNIQUE 5 · CHECK 8 · FK 1 · 인덱스 2 · VIRTUAL 3
--
--    VIRTUAL 생성 컬럼 3종 위의 UNIQUE가 "활성인 것만 유일"을 표현한다.
--    퇴장한 참가자는 생성 컬럼이 NULL이 되어 UNIQUE 대상에서 빠지므로
--    새 참가자가 같은 닉네임·아바타를 다시 쓸 수 있다.
--
--    uq_participants_id_room은 조회용이 아니라 하위 3테이블 복합 FK의
--    대상 키다. 이것이 없으면 복합 FK를 선언조차 할 수 없다.
--
--    active_host_guard에 status 조건을 넣지 않는다 — PENDING 방장도
--    유일성 대상이어야 프로필 미확정 host가 여럿 생기지 않는다.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  nickname VARCHAR(8) NULL,
  avatar_id CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  bio VARCHAR(24) NULL,
  role VARCHAR(10) NOT NULL,
  joined_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  pending_expires_at TIMESTAMP(6) NULL,
  left_at TIMESTAMP(6) NULL,

  active_nickname VARCHAR(8)
    GENERATED ALWAYS AS (
      CASE WHEN status = 'active' AND left_at IS NULL
           THEN LOWER(TRIM(nickname)) ELSE NULL END
    ) VIRTUAL,
  active_avatar_id CHAR(3) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE WHEN status = 'active' AND left_at IS NULL
           THEN avatar_id ELSE NULL END
    ) VIRTUAL,
  active_host_guard TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN role = 'host' AND left_at IS NULL THEN 1 ELSE NULL END
    ) VIRTUAL,

  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  CONSTRAINT pk_participants PRIMARY KEY (id),
  CONSTRAINT uq_participants_member_id UNIQUE (member_id),
  CONSTRAINT uq_participants_id_room UNIQUE (id, room_id),
  CONSTRAINT uq_participants_active_nickname UNIQUE (room_id, active_nickname),
  CONSTRAINT uq_participants_active_avatar UNIQUE (room_id, active_avatar_id),
  CONSTRAINT uq_participants_active_host UNIQUE (room_id, active_host_guard),

  CONSTRAINT fk_participants_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE,

  CONSTRAINT ck_participants_member_id_format
    CHECK (REGEXP_LIKE(member_id, '^mbr_[0-9A-Za-z]{16,36}$', 'c')),
  CONSTRAINT ck_participants_status
    CHECK (status IN ('pending', 'active')),
  CONSTRAINT ck_participants_role
    CHECK (role IN ('host', 'guest')),
  CONSTRAINT ck_participants_profile_state CHECK (
    (status = 'pending' AND nickname IS NULL AND avatar_id IS NULL)
    OR
    (status = 'active' AND nickname IS NOT NULL AND avatar_id IS NOT NULL)
  ),
  CONSTRAINT ck_participants_nickname_len CHECK (
    nickname IS NULL OR CHAR_LENGTH(TRIM(nickname)) BETWEEN 1 AND 8
  ),
  CONSTRAINT ck_participants_avatar_id CHECK (
    avatar_id IS NULL
    OR REGEXP_LIKE(avatar_id, '^A(0[1-9]|[12][0-9]|30)$', 'c')
  ),
  CONSTRAINT ck_participants_bio_len CHECK (
    bio IS NULL OR CHAR_LENGTH(TRIM(bio)) BETWEEN 1 AND 24
  ),
  CONSTRAINT ck_participants_pending_window CHECK (
    status = 'pending' OR pending_expires_at IS NULL
  ),

  INDEX idx_participants_room_active (room_id, left_at, status),
  INDEX idx_participants_pending_expiry (pending_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. game_rounds — 게임 회차
--    PK 1 · UNIQUE 3 · CHECK 6 · FK 2 · 인덱스 2 · VIRTUAL 1
--
--    phase(READY·PLAYING·TIE·RESULT)를 컬럼으로 두지 않는다. 진행 단계는
--    초 단위로 바뀌고 재접속이 없어 복구 대상이 아니므로 인메모리에 둔다.
--    여기 있는 status는 되돌릴 수 없는 전이만 기록한다.
--
--    명단 스냅샷도 컬럼으로 두지 않는다. 인메모리가 들고 있고,
--    룰렛·저격은 game_options 행으로, 나머지는 결과 JSON이 명단을 확정한다.
--
--    random_seed는 64비트다. 판마다 1개 발급하며 게임 종류를 가리지 않는다.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE game_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  round_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  game_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ready',
  config JSON NOT NULL,
  random_seed BIGINT UNSIGNED NOT NULL,
  started_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at TIMESTAMP(6) NULL,
  ended_at TIMESTAMP(6) NULL,
  ended_reason VARCHAR(30) NULL,

  active_round_guard TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('ready', 'running') THEN 1 ELSE NULL END
    ) VIRTUAL,

  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  CONSTRAINT pk_game_rounds PRIMARY KEY (id),
  CONSTRAINT uq_game_rounds_round_id UNIQUE (round_id),
  CONSTRAINT uq_game_rounds_id_room UNIQUE (id, room_id),
  CONSTRAINT uq_game_rounds_active UNIQUE (room_id, active_round_guard),

  CONSTRAINT fk_game_rounds_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_rounds_started_by FOREIGN KEY (started_by, room_id)
    REFERENCES participants(id, room_id) ON DELETE CASCADE,

  CONSTRAINT ck_game_rounds_round_id_format
    CHECK (REGEXP_LIKE(round_id, '^rnd_[0-9A-Za-z]{16,36}$', 'c')),
  CONSTRAINT ck_game_rounds_game_type CHECK (
    game_type IN ('roulette', 'ladder', 'kingmaker', 'timer', 'snipe', 'nunchi')
  ),
  CONSTRAINT ck_game_rounds_status CHECK (
    status IN ('ready', 'running', 'finished', 'cancelled')
  ),
  CONSTRAINT ck_game_rounds_ended_reason CHECK (
    ended_reason IS NULL
    OR ended_reason IN ('completed', 'host_left', 'last_member_left',
                        'room_expired', 'server_restart', 'error')
  ),
  CONSTRAINT ck_game_rounds_time_order CHECK (
    ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at
  ),
  CONSTRAINT ck_game_rounds_terminal_state CHECK (
    (status IN ('ready', 'running')
       AND ended_at IS NULL AND ended_reason IS NULL)
    OR
    (status IN ('finished', 'cancelled')
       AND ended_at IS NOT NULL AND ended_reason IS NOT NULL)
  ),

  INDEX idx_game_rounds_room_created (room_id, created_at),
  INDEX idx_game_rounds_started_by (started_by, room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. game_options — 선택지
--    PK 1 · UNIQUE 4 · CHECK 3 · FK 2 · 인덱스 2
--
--    게임 4종이 쓴다 — 룰렛(참가자 후보) · 사다리(도착 항목, participant_id
--    NULL) · 킹메이커(제출 의견) · 저격(지목 후보). 시간초·눈치는 쓰지 않는다.
--
--    room_id는 교차 방 차단 축이다. 회차와 참가자가 같은 방인지를 DB가
--    직접 대조하므로 다른 방 참가자가 후보로 끼어드는 경로가 닫힌다.
--
--    uq_game_options_round_participant가 참가자당 선택지 1개를 강제하고,
--    킹메이커 의견 제출의 멱등이 여기서 성립한다. participant_id가 NULL인
--    사다리 항목은 MySQL UNIQUE가 NULL을 여러 개 허용하므로 영향받지 않는다.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE game_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  option_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  game_round_id BIGINT UNSIGNED NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  participant_id BIGINT UNSIGNED NULL,
  label VARCHAR(120) NOT NULL,
  sort_order SMALLINT NOT NULL,

  CONSTRAINT pk_game_options PRIMARY KEY (id),
  CONSTRAINT uq_game_options_option_id UNIQUE (option_id),
  CONSTRAINT uq_game_options_id_round UNIQUE (id, game_round_id),
  CONSTRAINT uq_game_options_round_order UNIQUE (game_round_id, sort_order),
  CONSTRAINT uq_game_options_round_participant
    UNIQUE (game_round_id, participant_id),

  CONSTRAINT fk_game_options_round FOREIGN KEY (game_round_id, room_id)
    REFERENCES game_rounds(id, room_id) ON DELETE CASCADE,
  CONSTRAINT fk_game_options_participant FOREIGN KEY (participant_id, room_id)
    REFERENCES participants(id, room_id) ON DELETE CASCADE,

  CONSTRAINT ck_game_options_option_id_format
    CHECK (REGEXP_LIKE(option_id, '^opt_[0-9A-Za-z]{16,36}$', 'c')),
  CONSTRAINT ck_game_options_label_len
    CHECK (CHAR_LENGTH(TRIM(label)) BETWEEN 1 AND 120),
  CONSTRAINT ck_game_options_sort_order
    CHECK (sort_order >= 0),

  INDEX idx_game_options_round_room (game_round_id, room_id),
  INDEX idx_game_options_participant_room (participant_id, room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. votes — 투표
--    PK 1 · UNIQUE 1 · CHECK 2 · FK 3 · 인덱스 3
--
--    킹메이커·저격만 쓴다. 밀리초 판정 입력(눈치 UP · 시간초 START/STOP
--    · 룰렛 PICK · 사다리 START)은 DB에 오지 않는다 — 기록하는 순간
--    도착 시각이 아니라 커밋 시각을 재게 된다.
--
--    ballot_no 상한 4가 반복 상한을 DB 수준에서 강제한다
--    (본투표 1 + 결선 최대 3). 종료가 보장되지 않는 반복이 불가능하다.
--
--    voter_participant_id는 익명 게임에서도 저장하되 응답·로그에서 제외한다.
--    저장을 없애면 중복 투표를 막을 수 없으므로 노출 경로만 닫는다.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE votes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  voter_participant_id BIGINT UNSIGNED NOT NULL,
  game_option_id BIGINT UNSIGNED NOT NULL,
  ballot_no SMALLINT NOT NULL DEFAULT 1,
  choice_no SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  CONSTRAINT pk_votes PRIMARY KEY (id),
  CONSTRAINT uq_votes_ballot
    UNIQUE (game_round_id, voter_participant_id, ballot_no, choice_no),

  CONSTRAINT fk_votes_round FOREIGN KEY (game_round_id, room_id)
    REFERENCES game_rounds(id, room_id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_voter FOREIGN KEY (voter_participant_id, room_id)
    REFERENCES participants(id, room_id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_option FOREIGN KEY (game_option_id, game_round_id)
    REFERENCES game_options(id, game_round_id) ON DELETE CASCADE,

  CONSTRAINT ck_votes_ballot_no CHECK (ballot_no BETWEEN 1 AND 4),
  CONSTRAINT ck_votes_choice_no CHECK (choice_no BETWEEN 1 AND 10),

  INDEX idx_votes_round_room (game_round_id, room_id),
  INDEX idx_votes_voter_room (voter_participant_id, room_id),
  INDEX idx_votes_option_round (game_option_id, game_round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. game_results — 확정 결과
--    PK 1 · UNIQUE 1 · FK 1
--
--    승자 컬럼을 두지 않는다. 사다리는 전원 배정이고 눈치게임의 "뽑힌 사람"은
--    승자가 아니라 최후 1인이라, 승자를 한 명으로 못 박는 컬럼은 절반의
--    게임에서 의미가 어긋난다. result_data 하나가 결과의 단일 기준이다.
--
--    CHECK가 하나도 없는 유일한 테이블이다. JSON 내부 구조는 게임별
--    Pydantic 모델이 저장 전에 검증한다.
--
--    room_id를 두지 않는 유일한 하위 테이블이다. 참가자를 참조하는 컬럼이
--    없어 교차 방 참조 경로가 애초에 없다.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE game_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  result_data JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  CONSTRAINT pk_game_results PRIMARY KEY (id),
  CONSTRAINT uq_game_results_round UNIQUE (game_round_id),

  CONSTRAINT fk_game_results_round FOREIGN KEY (game_round_id)
    REFERENCES game_rounds(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ═══════════════════════════════════════════════════════════════════════════
-- 적용 후 검증
--
-- DDL 문법이 통과한다고 의도대로 동작하는 것은 아니다. MySQL 버전이 낮으면
-- CHECK가 조용히 무시되고, 생성 컬럼과 복합 FK는 만들어지지 않을 수 있다.
-- 아래를 실제로 돌려 개수를 확인한다.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- -- 테이블 6개
-- SELECT COUNT(*) AS tables_6 FROM information_schema.TABLES
--  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';
--
-- -- PK 6 · UNIQUE 15 · FK 9
-- SELECT CONSTRAINT_TYPE, COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
--  WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE <> 'CHECK'
--  GROUP BY CONSTRAINT_TYPE;
--
-- -- CHECK 24
-- SELECT COUNT(*) AS checks_24 FROM information_schema.CHECK_CONSTRAINTS
--  WHERE CONSTRAINT_SCHEMA = DATABASE();
--
-- -- VIRTUAL 생성 컬럼 4
-- SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE() AND EXTRA LIKE '%VIRTUAL GENERATED%';
--
-- -- ON DELETE 규칙이 전부 CASCADE인지
-- SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
--  WHERE CONSTRAINT_SCHEMA = DATABASE();
--
-- -- 세션 시간대 +00:00
-- SELECT @@session.time_zone, @@global.time_zone;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 제약이 실제로 거절하는지 확인 — docs/06_database/05_constraints_integrity.md
-- 「배포 전 실행 검증」 11건에 대응한다. 전부 실패해야 정상이다.
-- ═══════════════════════════════════════════════════════════════════════════
--
--   1. 같은 방에 같은 닉네임 두 번(대소문자만 다르게)  → uq_participants_active_nickname
--   2. avatar_id = 'A31'                              → ck_participants_avatar_id
--   3. max_members = 11                               → ck_rooms_max_members
--   4. 같은 방에 role = 'host' 두 번(PENDING 포함)      → uq_participants_active_host
--   5. 공백만 있는 닉네임·label                        → ck_*_len (TRIM 후 길이)
--   6. 음수 sort_order · ballot_no = 5                 → ck_game_options_sort_order · ck_votes_ballot_no
--   7. 다른 방 참가자를 game_options에 INSERT           → fk_game_options_participant (복합)
--   8. 다른 회차 선택지에 투표                          → fk_votes_option (복합)
--   9. 같은 방에 진행 중(ready·running) 라운드 두 개    → uq_game_rounds_active
--  10. 같은 회차에 game_results 두 행                   → uq_game_results_round
--  11. status = 'finished'인데 ended_at IS NULL         → ck_game_rounds_terminal_state
--
-- 통과해야 하는 것
--   · 사다리 항목(participant_id NULL)이 복합 FK를 통과한다
--   · 퇴장한 참가자(left_at 채움)의 닉네임·아바타를 새 참가자가 재사용한다
--   · DELETE FROM rooms 한 문장으로 하위 5테이블이 전부 사라지고
--     다이아몬드 CASCADE 경로가 오류를 내지 않는다
-- ═══════════════════════════════════════════════════════════════════════════
