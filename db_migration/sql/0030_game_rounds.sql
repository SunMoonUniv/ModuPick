-- ═══════════════════════════════════════════════════════════════════════════
-- 0030_game_rounds — 게임 회차
--
-- 정본     docs/06_database/03_game_rounds.md
-- 선행     rooms · participants(id, room_id)
-- 만드는 것 PK 1 · UNIQUE 3 · CHECK 6 · FK 2 · 인덱스 2 · VIRTUAL 생성 컬럼 1
--
-- phase를 컬럼으로 두지 않는다. 진행 단계(READY·PLAYING·TIE·RESULT)는 초 단위로
-- 바뀌고 재접속이 없어 복구 대상이 아니므로 인메모리에 둔다. 이 테이블의
-- status는 되돌릴 수 없는 전이만 기록하는 영속 축이며 판당 2~3회 바뀐다.
--
-- uq_game_rounds_active가 방별 진행 중인 판을 최대 1개로 강제한다. ready·
-- running일 때만 1이 되는 생성 컬럼 위의 UNIQUE라, 판이 끝나면 자동으로 자리가
-- 열린다.
--
-- random_seed는 게임 종류를 가리지 않고 판마다 1개 발급하며 NULL이 아니다.
-- 판이 진행되는 동안 클라이언트에 내려보내지 않는다 — 미리 알면 결과를 미리
-- 알 수 있다.
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- 복합 FK다. 어느 한 컬럼이 NULL이면 MySQL이 제약을 만족한 것으로 보므로
  -- started_by가 비어 있는 행도 통과한다.
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
  -- 종료 상태면 ended_at·ended_reason이 반드시 차 있고, 진행 상태면 반드시
  -- 비어 있다. 절반만 채운 행이 남지 않게 하는 제약이다.
  CONSTRAINT ck_game_rounds_terminal_state CHECK (
    (status IN ('ready', 'running')
       AND ended_at IS NULL AND ended_reason IS NULL)
    OR
    (status IN ('finished', 'cancelled')
       AND ended_at IS NOT NULL AND ended_reason IS NOT NULL)
  ),

  -- idx_game_rounds_started_by를 명시로 두는 이유는 MySQL이 FK에 맞는 인덱스가
  -- 없으면 이름을 정하지 않은 인덱스를 자동 생성하기 때문이다. 모든 인덱스에
  -- 고정된 이름을 준다는 규약을 지키려면 직접 선언해야 한다.
  INDEX idx_game_rounds_room_created (room_id, created_at),
  INDEX idx_game_rounds_started_by (started_by, room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
