-- ═══════════════════════════════════════════════════════════════════════════
-- verify — 적용 결과 검증
--
-- 정본   docs/06_database/07_migrations_seed.md 「마이그레이션 검증」
--        · docs/06_database/05_constraints_integrity.md 「배포 전 실행 검증」
--
-- DDL 문법이 통과한다고 의도대로 만들어진 것은 아니다. MySQL 버전이 낮으면
-- CHECK가 조용히 무시되고 생성 컬럼과 복합 FK는 만들어지지 않는다. 개수가
-- 어긋나면 여기서 오류를 내 배포를 멈춘다 — 검증이 실패해도 계속 진행되면
-- 검증하지 않은 것과 같다.
--
-- 마이그레이션이 아니므로 번호를 붙이지 않는다. Docker의 initdb.d에 이 폴더를
-- 통째로 마운트하면 숫자 파일 뒤에 실행된다.
--
-- 대상 데이터베이스에 연결한 상태로 실행한다.
--   mysql -h HOST -u root -p modupick < verify.sql
-- ═══════════════════════════════════════════════════════════════════════════

DROP PROCEDURE IF EXISTS modupick_verify_schema;

DELIMITER $$

CREATE PROCEDURE modupick_verify_schema()
BEGIN
  DECLARE n INT;
  DECLARE msg VARCHAR(255);

  -- 테이블 6 — alembic_version 같은 관리 테이블은 만들지 않으므로 정확히 6이다
  SELECT COUNT(*) INTO n
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';
  IF n <> 6 THEN
    SET msg = CONCAT('[verify] 테이블은 6개여야 하는데 ', n, '개다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;

  -- PK 6
  SELECT COUNT(*) INTO n
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'PRIMARY KEY';
  IF n <> 6 THEN
    SET msg = CONCAT('[verify] PK는 6개여야 하는데 ', n, '개다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;

  -- UNIQUE 15
  SELECT COUNT(*) INTO n
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'UNIQUE';
  IF n <> 15 THEN
    SET msg = CONCAT('[verify] UNIQUE는 15개여야 하는데 ', n, '개다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;

  -- FK 9 — 복합 FK는 컬럼 수와 무관하게 1개로 센다
  SELECT COUNT(*) INTO n
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY';
  IF n <> 9 THEN
    SET msg = CONCAT('[verify] FK는 9개여야 하는데 ', n, '개다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;

  -- CHECK 24 — MySQL 8.0.16 미만에서는 파싱만 되고 만들어지지 않는다
  SELECT COUNT(*) INTO n
    FROM information_schema.CHECK_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE();
  IF n <> 24 THEN
    SET msg = CONCAT('[verify] CHECK는 24개여야 하는데 ', n, '개다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;

  -- VIRTUAL 생성 컬럼 4 — 활성 닉네임·아바타·방장·진행 중 라운드 가드
  SELECT COUNT(*) INTO n
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND EXTRA LIKE '%VIRTUAL GENERATED%';
  IF n <> 4 THEN
    SET msg = CONCAT('[verify] VIRTUAL 생성 컬럼은 4개여야 하는데 ', n, '개다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;

  -- ON DELETE는 9개 전부 CASCADE다. 하나라도 RESTRICT면 방 삭제가 막힌다
  SELECT COUNT(*) INTO n
    FROM information_schema.REFERENTIAL_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE() AND DELETE_RULE <> 'CASCADE';
  IF n <> 0 THEN
    SET msg = CONCAT('[verify] CASCADE가 아닌 FK가 ', n, '개다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;

  -- 모든 PK가 BIGINT UNSIGNED AUTO_INCREMENT다
  SELECT COUNT(*) INTO n
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND COLUMN_KEY = 'PRI'
     AND COLUMN_NAME = 'id'
     AND COLUMN_TYPE = 'bigint unsigned'
     AND EXTRA LIKE '%auto_increment%';
  IF n <> 6 THEN
    SET msg = CONCAT('[verify] BIGINT UNSIGNED AUTO_INCREMENT PK가 6개여야 하는데 ', n, '개다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;

  -- 저장은 UTC다. 시간대가 어긋나면 만료·감사 시각이 통째로 밀린다.
  -- time_zone 설정값이 아니라 실제 오프셋을 본다 — SYSTEM이라도 시스템이 UTC면
  -- 문제가 없고, +09:00이면 설정값이 무엇이든 문제다.
  IF TIMEDIFF(NOW(), UTC_TIMESTAMP()) <> '00:00:00' THEN
    SET msg = CONCAT('[verify] 세션 시간대가 UTC가 아니다. time_zone=', @@session.time_zone,
                     ' · 오프셋=', TIMEDIFF(NOW(), UTC_TIMESTAMP()),
                     ' — MySQL을 --default-time-zone=+00:00으로 띄운다');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg;
  END IF;
END$$

DELIMITER ;

CALL modupick_verify_schema();
DROP PROCEDURE modupick_verify_schema;

SELECT '[verify] 통과 — 테이블 6 · PK 6 · UNIQUE 15 · CHECK 24 · FK 9(전부 CASCADE) · VIRTUAL 4' AS result;


-- ═══════════════════════════════════════════════════════════════════════════
-- 여기까지는 개수 검증이다. 제약이 실제로 거절하는지는 값을 넣어 봐야 알 수
-- 있고, 그 11건은 backend/tests가 담당한다
-- (docs/06_database/05_constraints_integrity.md 「배포 전 실행 검증」).
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
-- ═══════════════════════════════════════════════════════════════════════════
