-- ═══════════════════════════════════════════════════════════════════════════
-- 0040_game_options — 선택지
--
-- 정본     docs/06_database/04_options_votes_results.md 「3. game_options」
-- 선행     game_rounds(id, room_id) · participants(id, room_id)
-- 만드는 것 PK 1 · UNIQUE 4 · CHECK 3 · FK 2 · 인덱스 2
--
-- 룰렛·저격의 참가자 후보, 킹메이커의 제출된 의견, 사다리의 도착 항목이 전부
-- 이 테이블에 들어온다. 사다리 도착 항목만 participant_id가 NULL이다.
--
-- room_id는 교차 방 차단 축이다. 회차와 참가자를 각각 (id, room_id) 쌍으로
-- 참조해, 다른 방의 참가자를 이 회차의 선택지로 넣는 경로를 DB가 닫는다.
--
-- uq_game_options_round_participant가 참가자당 선택지 1개를 강제하며, 킹메이커
-- 의견 제출의 멱등이 여기서 성립한다. 같은 제출이 다시 도착하면 이 UNIQUE에
-- 걸리고 서버는 기존 행을 조회해 같은 성공 응답을 돌려준다. participant_id가
-- NULL인 사다리 항목은 MySQL UNIQUE가 NULL을 여러 개 허용하므로 영향이 없다.
--
-- sort_order를 외부에 노출하는 자리는 사다리 레인 하나뿐이다. 킹메이커 후보의
-- 표시 순서는 인메모리 순열이 정한다 — 제출 순서를 그대로 보여주면 제출 완료
-- 표시와 대조해 작성자를 추정할 수 있어 익명성이 깨진다.
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- 120자는 킹메이커 의견 상한에서 온 값이다.
  CONSTRAINT ck_game_options_label_len
    CHECK (CHAR_LENGTH(TRIM(label)) BETWEEN 1 AND 120),
  CONSTRAINT ck_game_options_sort_order CHECK (sort_order >= 0),

  INDEX idx_game_options_round_room (game_round_id, room_id),
  INDEX idx_game_options_participant_room (participant_id, room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
