#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ModuPick — 마이그레이션 적용
#
# 정본  docs/06_database/07_migrations_seed.md
#
# sql/ 안의 파일을 번호 오름차순으로 적용하고 verify.sql로 결과를 검증한다.
# 검증이 실패하면 0이 아닌 코드로 끝난다.
#
# SQL이 sql/ 하위에 따로 있는 이유는 이 폴더를 Docker의 initdb.d에 통째로
# 마운트하기 때문이다. 엔트리포인트는 .sh도 실행하므로 apply.sh가 같은 자리에
# 있으면 컨테이너 초기화 중에 저 자신이 돌아간다.
#
# 사용
#   ./apply.sh                              로컬 mysql 클라이언트로 접속
#   ./apply.sh --container modupick-db      실행 중인 컨테이너 안에서 실행
#   ./apply.sh --fresh                      데이터베이스를 지우고 다시 만든다
#   ./apply.sh --verify-only                적용 없이 검증만
#
# 접속 정보는 환경 변수로 준다.
#   MYSQL_HOST(127.0.0.1) · MYSQL_PORT(3306) · MYSQL_USER(root)
#   · MYSQL_PASSWORD · MYSQL_DATABASE(modupick)
#
# 운영 계정 비밀번호는 저장소에 두지 않는다. 아래 둘을 주면 0090_grants.sql의
# 개발 기본값을 적용 시점에만 치환한다(파일은 고치지 않는다).
#   MODUPICK_APP_PASSWORD · MODUPICK_MIGRATOR_PASSWORD
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# cd 하기 전에 자기 경로를 절대경로로 잡아 둔다. --help가 자기 자신을 sed로 읽는데,
# cd 뒤에는 호출에 쓰인 상대경로($0)가 더 이상 유효하지 않다.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "$SELF")"

HOST="${MYSQL_HOST:-127.0.0.1}"
PORT="${MYSQL_PORT:-3306}"
USER="${MYSQL_USER:-root}"
PASSWORD="${MYSQL_PASSWORD:-}"
DATABASE="${MYSQL_DATABASE:-modupick}"

CONTAINER=""
FRESH=0
VERIFY_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container) CONTAINER="${2:?--container 뒤에 컨테이너 이름이 필요하다}"; shift 2 ;;
    --fresh)     FRESH=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    -h|--help)   sed -n '3,26p' "$SELF" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "모르는 옵션: $1" >&2; exit 2 ;;
  esac
done

# ── mysql 실행 ────────────────────────────────────────────────────────────
# 첫 인자가 데이터베이스 이름이고(빈 문자열이면 지정하지 않는다) SQL은 stdin으로
# 받는다. 비밀번호는 명령행이 아니라 MYSQL_PWD로 넘겨 ps에 노출되지 않게 한다.
mysql_run() {
  local db="$1"
  local args=(--default-character-set=utf8mb4 --batch --raw)
  [[ -n "$db" ]] && args+=("$db")

  if [[ -n "$CONTAINER" ]]; then
    docker exec -i -e MYSQL_PWD="$PASSWORD" "$CONTAINER" \
      mysql -u"$USER" "${args[@]}"
  else
    MYSQL_PWD="$PASSWORD" mysql -h"$HOST" -P"$PORT" -u"$USER" "${args[@]}"
  fi
}

apply_file() {
  local db="$1" file="$2"
  printf '  %-28s' "$file"
  mysql_run "$db" < "$file" > /dev/null
  echo 'OK'
}

# sed 치환에 쓸 값을 이스케이프한다. 비밀번호에 / & \ 가 들어가도 깨지지 않는다.
sed_escape() { printf '%s' "$1" | sed -e 's/[\/&\\]/\\&/g'; }

# ── 검증만 ────────────────────────────────────────────────────────────────
if [[ $VERIFY_ONLY -eq 1 ]]; then
  echo "검증 — $DATABASE"
  mysql_run "$DATABASE" < sql/verify.sql
  exit 0
fi

echo "적용 대상 — ${CONTAINER:+컨테이너 $CONTAINER · }$USER@$HOST:$PORT/$DATABASE"

# ── 초기화 ────────────────────────────────────────────────────────────────
if [[ $FRESH -eq 1 ]]; then
  read -r -p "$DATABASE 를 통째로 지운다. 계속하려면 yes: " confirm
  [[ "$confirm" == "yes" ]] || { echo '중단했다.'; exit 1; }
  echo "DROP DATABASE IF EXISTS \`$DATABASE\`;" | mysql_run ''
  echo '  데이터베이스를 지웠다.'
fi

# ── 스키마 ────────────────────────────────────────────────────────────────
echo '스키마'
apply_file '' sql/0000_database.sql
for f in sql/0010_*.sql sql/0020_*.sql sql/0030_*.sql sql/0040_*.sql sql/0050_*.sql sql/0060_*.sql; do
  # 글로브가 아무것도 못 찾으면 패턴 문자열이 그대로 넘어온다. 그대로 두면
  # mysql이 알 수 없는 오류를 내므로 여기서 무엇이 없는지 밝힌다.
  [[ -f "$f" ]] || { echo "필요한 마이그레이션 파일이 없다: $f" >&2; exit 1; }
  apply_file "$DATABASE" "$f"
done

# ── 계정·권한 ─────────────────────────────────────────────────────────────
echo '계정·권한'
printf '  %-28s' 'sql/0090_grants.sql'
grants_sql="$(cat sql/0090_grants.sql)"
if [[ -n "${MODUPICK_APP_PASSWORD:-}" ]]; then
  grants_sql="$(printf '%s' "$grants_sql" \
    | sed "s/IDENTIFIED BY 'modupick'/IDENTIFIED BY '$(sed_escape "$MODUPICK_APP_PASSWORD")'/")"
  note_app=' (app 비밀번호 치환)'
else
  note_app=' (app 비밀번호 = 개발 기본값)'
fi
if [[ -n "${MODUPICK_MIGRATOR_PASSWORD:-}" ]]; then
  grants_sql="$(printf '%s' "$grants_sql" \
    | sed "s/IDENTIFIED BY 'migratorpass'/IDENTIFIED BY '$(sed_escape "$MODUPICK_MIGRATOR_PASSWORD")'/")"
  note_mig=' · migrator 치환'
else
  note_mig=' · migrator = 개발 기본값'
fi
printf '%s' "$grants_sql" | mysql_run "$DATABASE" > /dev/null
echo "OK${note_app}${note_mig}"

# ── 검증 ──────────────────────────────────────────────────────────────────
echo '검증'
mysql_run "$DATABASE" < sql/verify.sql

# CREATE USER IF NOT EXISTS는 계정이 이미 있으면 비밀번호를 바꾸지 않는다.
# 기존 계정의 비밀번호를 갈아 끼우려면 ALTER USER를 직접 실행한다
# (0090_grants.sql 파일 끝 참고).
