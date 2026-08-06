-- ═══════════════════════════════════════════════════════════════════════════
-- 0090_grants — DB 계정·권한
--
-- 정본   docs/06_database/07_migrations_seed.md 「DB 계정·권한」
-- 선행   0010~0060 전부. 테이블 단위 GRANT는 대상 테이블이 이미 있어야 한다
--
-- ┌─ 경고 ────────────────────────────────────────────────────────────────┐
-- │ 아래 비밀번호는 로컬 개발용 기본값이다. 운영에 그대로 올리지 않는다.     │
-- │ apply.sh에 MODUPICK_APP_PASSWORD · MODUPICK_MIGRATOR_PASSWORD 환경     │
-- │ 변수를 주면 적용 시점에 치환된다. 이미 만들어진 계정의 비밀번호는       │
-- │ 파일 끝의 ALTER USER 스니펫으로 바꾼다.                                │
-- └───────────────────────────────────────────────────────────────────────┘
--
-- 이 파일은 마이그레이션이 아니다. 문서의 「적용 순서 — 6파일」은 0010~0060을
-- 가리키며, 계정·권한은 스키마 이력과 별개로 환경마다 다시 적용한다. 번호를
-- 0090으로 떨어뜨려 둔 이유는 Docker의 initdb.d가 파일명 알파벳 순으로
-- 실행하기 때문이다.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- modupick — 애플리케이션 계정
--
-- 애플리케이션은 root나 ALL PRIVILEGES 계정을 쓰지 않는다. DDL 권한이 없으므로
-- 이 계정으로는 테이블을 바꿀 수 없다.
--
-- participants에 DELETE를 주지 않는다. 참가자를 개별 삭제하면 그 사람의 표가
-- CASCADE로 함께 사라져 개표가 어긋나므로, 퇴장·강퇴·연결 종료는 전부 left_at
-- 갱신으로 처리하고 물리 삭제 경로 자체를 없앤다. 방어는 3중이다 —
-- 애플리케이션에 삭제 메서드를 두지 않고, 통합 테스트로 고정하고, 여기서
-- 권한을 회수한다. 이 파일이 셋째다.
--
-- 방 삭제(DELETE FROM rooms)는 이 계정으로 정상 동작한다. InnoDB의 CASCADE는
-- 자식 테이블 DELETE 권한을 요구하지 않으며 MySQL 8.4에서 확인했다
-- (participants 직접 DELETE는 1142로 거부되고 rooms 삭제는 성공).
-- ───────────────────────────────────────────────────────────────────────────

CREATE USER IF NOT EXISTS 'modupick'@'%' IDENTIFIED BY 'modupick';

GRANT SELECT, INSERT, UPDATE ON modupick.* TO 'modupick'@'%';

GRANT DELETE ON modupick.rooms        TO 'modupick'@'%';
GRANT DELETE ON modupick.game_rounds  TO 'modupick'@'%';
GRANT DELETE ON modupick.game_options TO 'modupick'@'%';
GRANT DELETE ON modupick.votes        TO 'modupick'@'%';
GRANT DELETE ON modupick.game_results TO 'modupick'@'%';
-- participants — DELETE 없음


-- ───────────────────────────────────────────────────────────────────────────
-- modupick_migrator — 마이그레이션 실행 계정
--
-- 배포 전용 단계에서만 쓴다. 애플리케이션 런타임이 이 계정으로 붙지 않는다.
-- DELETE와 DML을 함께 주는 이유는 데이터 이관 리비전이 기존 행을 옮겨야 하기
-- 때문이다.
-- ───────────────────────────────────────────────────────────────────────────

CREATE USER IF NOT EXISTS 'modupick_migrator'@'%' IDENTIFIED BY 'migratorpass';

GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, DROP, ALTER, INDEX, REFERENCES
  ON modupick.* TO 'modupick_migrator'@'%';


-- ═══════════════════════════════════════════════════════════════════════════
-- 확인
--
--   SHOW GRANTS FOR 'modupick'@'%';
--
-- participants에 DELETE가 없어야 하고, 아래 둘이 각각 이렇게 나와야 한다.
--
--   DELETE FROM participants WHERE ...   → ERROR 1142 (거부)
--   DELETE FROM rooms WHERE ...          → 성공, 하위가 CASCADE로 사라짐
--
--
-- 운영 비밀번호 교체 — 저장소에 값을 남기지 않고 셸에서 직접 실행한다
--
--   ALTER USER 'modupick'@'%'       IDENTIFIED BY '<비밀 저장소의 값>';
--   ALTER USER 'modupick_migrator'@'%'  IDENTIFIED BY '<비밀 저장소의 값>';
--
-- 접속 호스트를 좁히려면 '%' 대신 앱 컨테이너의 서브넷을 쓴다. 같은 Docker
-- 네트워크 안에서만 붙는다면 예를 들어 'modupick'@'172.%'이다.
-- ═══════════════════════════════════════════════════════════════════════════
