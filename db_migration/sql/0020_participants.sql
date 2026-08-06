-- ═══════════════════════════════════════════════════════════════════════════
-- 0020_participants — 방 참가자
--
-- 정본     docs/06_database/02_rooms_participants.md 「2. participants」
-- 선행     rooms
-- 만드는 것 PK 1 · UNIQUE 5 · CHECK 8 · FK 1 · 인덱스 2 · VIRTUAL 생성 컬럼 3
--
-- 방 안에서 유일해야 하는 셋 — 활성 닉네임 · 활성 아바타 · 활성 방장 — 을 전부
-- VIRTUAL 생성 컬럼 위의 UNIQUE로 표현한다. 퇴장한 참가자는 생성 컬럼이 NULL이
-- 되어 UNIQUE 대상에서 빠지므로 새 참가자가 같은 값을 다시 쓸 수 있다.
-- MySQL UNIQUE가 NULL을 여러 개 허용하는 성질을 그대로 쓴 것이다.
--
-- 생성 컬럼 식에 room_id를 넣지 않는다. FK가 걸린 컬럼을 생성 컬럼에 넣으면
-- CASCADE와 충돌할 수 있어, room_id는 일반 컬럼으로 복합 UNIQUE에만 참여한다.
--
-- uq_participants_id_room은 조회용이 아니라 하위 3테이블의 복합 FK를
-- 성립시키기 위한 대상 키다. MySQL은 FK 대상이 PK 또는 UNIQUE의 왼쪽 접두여야
-- 하므로 이 UNIQUE가 없으면 교차 방 차단 자체를 선언할 수 없다.
--
-- 퇴장·강퇴·연결 종료는 전부 left_at 갱신이며 행을 지우지 않는다. 지우면 그
-- 사람의 표가 CASCADE로 함께 사라져 개표가 어긋난다.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- ACTIVE이고 미퇴장일 때만 값을 갖는다. 닉네임은 대소문자·앞뒤 공백을
  -- 정규화해 비교하므로 " Jiho "와 "jiho"가 같은 방에 공존하지 못한다.
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
  -- 방장은 PENDING 단계에서도 자리를 차지해야 하므로 status를 보지 않는다.
  active_host_guard TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN role = 'host' AND left_at IS NULL THEN 1 ELSE NULL END
    ) VIRTUAL,

  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  CONSTRAINT pk_participants PRIMARY KEY (id),
  CONSTRAINT uq_participants_member_id UNIQUE (member_id),
  CONSTRAINT uq_participants_id_room UNIQUE (id, room_id),

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

  CONSTRAINT uq_participants_active_nickname
    UNIQUE (room_id, active_nickname),
  CONSTRAINT uq_participants_active_avatar
    UNIQUE (room_id, active_avatar_id),
  CONSTRAINT uq_participants_active_host
    UNIQUE (room_id, active_host_guard),

  INDEX idx_participants_room_active (room_id, left_at, status),
  INDEX idx_participants_pending_expiry (pending_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
