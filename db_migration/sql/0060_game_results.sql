-- ═══════════════════════════════════════════════════════════════════════════
-- 0060_game_results — 확정 결과
--
-- 정본     docs/06_database/04_options_votes_results.md 「5. game_results」
-- 선행     game_rounds
-- 만드는 것 PK 1 · UNIQUE 1 · FK 1
--
-- 승자 컬럼을 두지 않는다. 사다리는 전원 배정이고, 저격은 무효표 처리에서
-- 복수 후보가 남을 수 있으며, 눈치게임의 "뽑힌 사람"은 승자가 아니라 최후
-- 1인이다. 승자를 한 명으로 못 박는 컬럼은 절반의 게임에서 의미가 어긋나고
-- 두 곳에 저장된 결과가 갈라질 위험만 남는다. result_data 하나가 결과의 단일
-- 기준이다.
--
-- result_version 컬럼도 두지 않는다. 버전은 result_data 안의 schemaVersion
-- 하나가 정본이다.
--
-- CHECK가 하나도 없는 유일한 테이블이다. JSON 내부 구조는 게임별 Pydantic
-- 모델이 저장 전에 검증한다. MySQL CHECK로 JSON 내부를 검사하면 스키마가 DDL과
-- 코드 두 곳에 생겨 마이그레이션마다 함께 고쳐야 한다.
--
-- room_id를 두지 않는 유일한 하위 테이블이다. 참가자를 참조하는 컬럼이 없어
-- 교차 방 참조 경로가 애초에 없다.
--
-- uq_game_results_round가 결과 확정을 멱등하게 만든다. 이미 끝난 판에 확정
-- 요청이 다시 오면 UNIQUE에 걸리고 서버는 기존 결과를 돌려준다.
-- ═══════════════════════════════════════════════════════════════════════════

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
