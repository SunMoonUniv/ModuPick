-- ═══════════════════════════════════════════════════════════════════════════
-- 0010_rooms — 방
--
-- 정본     docs/06_database/02_rooms_participants.md 「1. rooms」
-- 선행     없음
-- 만드는 것 PK 1 · UNIQUE 1 · CHECK 5 · 인덱스 1
--
-- status는 waiting · playing 둘뿐이다. 방 종료는 값이 아니라 행 삭제이며,
-- 결과가 확정돼도 방은 playing을 유지하다가 방장의 대기방 복귀에서 waiting으로
-- 돌아간다. CLOSED 상태를 저장하지 않는 이유다.
--
-- 초대 코드는 숫자 6자리다. 코드 공간이 100만이라 DDL만으로는 전수 탐색을
-- 막지 못하며, 코드 검증 API의 rate limiting이 배포 전 필수다
-- (docs/11_fairness/README.md).
-- ═══════════════════════════════════════════════════════════════════════════

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
