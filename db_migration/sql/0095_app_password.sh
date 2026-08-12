#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# 0095 앱 계정 비밀번호를 .env 값으로 맞춘다
#
# 선행   0090_grants.sql (계정이 이미 있어야 ALTER USER가 성립한다)
#
# 0090은 CREATE USER IF NOT EXISTS로 'modupick'@'%'를 만든다. 계정이 이미 있으면
# 비밀번호를 바꾸지 않는 구문이라, SQL 파일만으로는 .env의 값을 반영할 수 없다. 반면
# 백엔드의 DATABASE_URL은 .env 값을 쓴다. 둘이 어긋나면 DB는 healthy로 보이는 채
# (헬스체크는 root로 돈다) 백엔드만 access denied로 재시작을 반복한다.
#
# compose의 MYSQL_USER·MYSQL_PASSWORD로 대신하지 않는다. 그 경로는 엔트리포인트가
# 계정을 만들면서 대상 DB에 GRANT ALL까지 주어 0090의 최소 권한 설계를 덮는다.
#
# MODUPICK_APP_PASSWORD가 비어 있으면 아무것도 하지 않고 0090이 만든 값을 남긴다.
# CI가 그 경로로 돈다 — .env 없이 database만 띄우고, pytest는 backend/app/config.py의
# 기본 접속 정보를 쓴다. 이 스크립트가 기본값을 들고 있지 않은 이유이기도 하다.
# 비밀번호처럼 보이는 리터럴을 저장소에 두면 비밀 탐지기가 하드코딩으로 잡는다.
#
# 이 파일은 데이터 디렉터리가 비어 있을 때 한 번만 돈다. 엔트리포인트가 실행 비트 없는
# .sh를 source하므로 set -e를 켜지 않는다 — 여기서 켜면 초기화 셸 전체의 동작이 바뀐다.
# ─────────────────────────────────────────────────────────────────────────────

if [ -z "${MODUPICK_APP_PASSWORD:-}" ]; then
  echo "0095: MODUPICK_APP_PASSWORD가 비어 있어 앱 계정 비밀번호를 그대로 둔다(0090의 값)."
else
  # 역슬래시와 작은따옴표만 막으면 SQL 문자열 리터럴이 깨지지 않는다. .env.example이
  # 영문·숫자만 쓰라고 못박아 두었지만(DATABASE_URL에 그대로 들어간다) 한 번 더 막는다.
  modupick_app_pw_escaped="$(printf '%s' "$MODUPICK_APP_PASSWORD" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g")"

  # 비밀번호를 명령행에 두지 않는다 — 인자는 호스트의 ps에 그대로 보인다.
  # 초기화 중의 임시 서버는 네트워크를 열지 않으므로 유닉스 소켓으로 붙는다.
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot --batch <<SQL
ALTER USER 'modupick'@'%' IDENTIFIED BY '${modupick_app_pw_escaped}';
SQL

  echo "0095: 앱 계정 비밀번호를 MODUPICK_APP_PASSWORD 값으로 맞췄다."
  unset modupick_app_pw_escaped
fi
