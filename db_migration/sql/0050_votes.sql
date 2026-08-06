-- ═══════════════════════════════════════════════════════════════════════════
-- 0050_votes — 투표
--
-- 정본     docs/06_database/04_options_votes_results.md 「4. votes」
-- 선행     game_rounds(id, room_id) · participants(id, room_id)
--          · game_options(id, game_round_id)
-- 만드는 것 PK 1 · UNIQUE 1 · CHECK 2 · FK 3 · 인덱스 3
--
-- 여기에 들어오는 입력은 킹메이커 의견 제출·킹메이커 투표·익명 저격 지목뿐이다.
-- 눈치게임 UP · 시간초 START·STOP · 룰렛 PICK · 사다리 START는 DB에 오지
-- 않는다 — DB 왕복이 끼면 도착 시각이 아니라 커밋 시각을 재게 되어 밀리초
-- 판정 자체가 틀어진다.
--
-- ballot_no와 choice_no는 원래 vote_no 하나에 섞여 있던 두 개념을 나눈 것이다.
--   ballot_no  결선 차수. 1 = 본투표 · 2~4 = 결선 1~3회
--   choice_no  그 차수에서 몇 번째 표인지. 1인 1표 게임은 항상 1
--
-- 상한 4는 동점 결선 최대 3회에서, 상한 10은 방 정원에서 나온다. 종료가
-- 보장되지 않는 반복이 DB 수준에서도 불가능하다.
--
-- 익명 게임에서도 voter_participant_id를 저장한다. 저장을 없애면 중복 투표를
-- 막을 수 없으므로 저장은 유지하고 응답·로그에서 노출 경로만 닫는다.
--
-- 같은 선택지에 여러 표를 주는 것과 자기 투표 금지는 DB가 막지 않는다. 전자는
-- 게임마다 규칙이 다르고, 후자는 다른 행을 조회해야 알 수 있어 CHECK로 쓸 수
-- 없다. 둘 다 앱이 강제한다.
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- 중복·재전송 차단. 1인 1표 게임은 choice_no가 항상 1이므로 같은 표가 다시
  -- 도착하면 여기에 걸리고, 서버는 기존 행을 조회해 같은 성공 응답을 준다.
  CONSTRAINT uq_votes_ballot
    UNIQUE (game_round_id, voter_participant_id, ballot_no, choice_no),

  CONSTRAINT fk_votes_round FOREIGN KEY (game_round_id, room_id)
    REFERENCES game_rounds(id, room_id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_voter FOREIGN KEY (voter_participant_id, room_id)
    REFERENCES participants(id, room_id) ON DELETE CASCADE,
  -- 복합 FK가 다른 회차의 선택지에 투표하는 경로를 차단한다.
  CONSTRAINT fk_votes_option FOREIGN KEY (game_option_id, game_round_id)
    REFERENCES game_options(id, game_round_id) ON DELETE CASCADE,

  CONSTRAINT ck_votes_ballot_no CHECK (ballot_no BETWEEN 1 AND 4),
  CONSTRAINT ck_votes_choice_no CHECK (choice_no BETWEEN 1 AND 10),

  INDEX idx_votes_round_room (game_round_id, room_id),
  INDEX idx_votes_voter_room (voter_participant_id, room_id),
  INDEX idx_votes_option_round (game_option_id, game_round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
