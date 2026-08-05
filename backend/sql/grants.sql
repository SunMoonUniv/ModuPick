-- ═══════════════════════════════════════════════════════════════════════════
-- ModuPick — DB 계정·권한 (로컬 개발용)
--
-- 정본  docs/06_database/07_migrations_seed.md 「DB 계정·권한」
--
-- schema.sql이 먼저 적용된 뒤에 실행한다. 테이블 단위 GRANT는 대상 테이블이
-- 이미 있어야 하기 때문이다. docker-compose가 10_schema → 20_grants 순으로
-- 마운트해 순서를 강제한다.
--
-- 운영 비밀값은 이 파일에 두지 않는다. 아래 값은 로컬 전용이다.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- modupick_app — 애플리케이션 계정
--
-- participants에 DELETE를 주지 않는다. 참가자를 개별 삭제하면 그 사람의 표가
-- CASCADE로 함께 사라져 개표가 어긋나므로, 퇴장·강퇴·연결 종료는 전부
-- left_at 갱신으로 처리하고 물리 삭제 경로 자체를 없앤다.
--
-- 방어는 3중이다 — 애플리케이션에 삭제 메서드를 두지 않고, 통합 테스트로
-- 고정하고, 여기서 권한을 회수한다. 이 파일이 셋째다.
--
-- 방 삭제(DELETE FROM rooms)는 이 계정으로 정상 동작한다. InnoDB의 CASCADE는
-- 자식 테이블 DELETE 권한을 요구하지 않으며, MySQL 8.4에서 확인했다
-- (participants 직접 DELETE는 1142로 거부되고 rooms 삭제는 성공).
-- ───────────────────────────────────────────────────────────────────────────

CREATE USER IF NOT EXISTS 'modupick_app'@'%' IDENTIFIED BY 'apppass';

GRANT SELECT, INSERT, UPDATE ON modupick.* TO 'modupick_app'@'%';

GRANT DELETE ON modupick.rooms        TO 'modupick_app'@'%';
GRANT DELETE ON modupick.game_rounds  TO 'modupick_app'@'%';
GRANT DELETE ON modupick.game_options TO 'modupick_app'@'%';
GRANT DELETE ON modupick.votes        TO 'modupick_app'@'%';
GRANT DELETE ON modupick.game_results TO 'modupick_app'@'%';
-- participants — DELETE 없음

FLUSH PRIVILEGES;


-- ───────────────────────────────────────────────────────────────────────────
-- 확인
--
--   SHOW GRANTS FOR 'modupick_app'@'%';
--
-- participants에 DELETE가 없어야 하고, 아래 둘이 각각 이렇게 나와야 한다.
--
--   DELETE FROM participants WHERE ...   → ERROR 1142 (거부)
--   DELETE FROM rooms WHERE ...          → 성공, 하위가 CASCADE로 사라짐
-- ───────────────────────────────────────────────────────────────────────────
