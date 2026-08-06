#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ModuPick — EC2 초기 세팅
#
# 갓 만든 EC2 인스턴스에서 저장소를 클론한 뒤 이 스크립트 하나만 실행하면
# 서비스가 뜬다. 하는 일은 순서대로 아홉이다.
#
#   1. OS 확인            Amazon Linux 2023 · Ubuntu · Debian
#   2. 스왑 확보          메모리 2GB 미만이면 2GB 스왑을 만든다
#   3. Docker 설치        엔진 + compose 플러그인
#   4. Python 3.14.6 설치  uv로 받고, 실패하면 소스에서 빌드한다
#   5. backend/.venv      가상환경을 만들고 requirements.txt를 설치한다
#   6. .env 생성          비밀번호를 무작위로 만들어 채운다
#   7. DB 기동            스키마가 자동 적용된다. 앱 계정 비밀번호를 맞춘다
#   8. 백엔드 기동        이미지를 빌드하고 띄운다
#   9. 헬스체크           /health가 응답할 때까지 기다린다
#
# 여러 번 실행해도 안전하다. 이미 되어 있는 단계는 건너뛰고, .env가 있으면
# 덮어쓰지 않는다.
#
# 사용법
#   ./bootstrap.sh              전체 실행
#   ./bootstrap.sh --skip-venv  호스트 Python·가상환경을 건너뛴다(컨테이너만)
#   ./bootstrap.sh --help
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# --help가 자기 자신을 sed로 읽는다. cd 뒤에는 호출에 쓰인 상대경로가 유효하지
# 않으므로 절대경로로 잡아 둔다.
SELF="$REPO_ROOT/$(basename "${BASH_SOURCE[0]}")"
cd "$REPO_ROOT"

PYTHON_VERSION=3.14.6
SKIP_VENV=0

# ── 출력 ──────────────────────────────────────────────────────────────────
if [[ -t 2 ]]; then
  C_STEP=$'\033[1;36m'; C_OK=$'\033[1;32m'; C_WARN=$'\033[1;33m'
  C_ERR=$'\033[1;31m';  C_DIM=$'\033[2m';   C_OFF=$'\033[0m'
else
  C_STEP=''; C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_OFF=''
fi

# 로그는 전부 stderr로 보낸다. 아래에 값을 돌려주는 함수(install_python_with_uv
# 등)를 $(...)로 받는 자리가 있어서, 로그가 stdout으로 나가면 그 값에 섞인다.
STEP_NO=0
step() { STEP_NO=$((STEP_NO + 1)); printf '\n%s[%d/9] %s%s\n' "$C_STEP" "$STEP_NO" "$*" "$C_OFF" >&2; }
info() { printf '      %s\n' "$*" >&2; }
dim()  { printf '      %s%s%s\n' "$C_DIM" "$*" "$C_OFF" >&2; }
ok()   { printf '      %s✓ %s%s\n' "$C_OK" "$*" "$C_OFF" >&2; }
warn() { printf '      %s! %s%s\n' "$C_WARN" "$*" "$C_OFF" >&2; }
die()  { printf '\n%s✗ %s%s\n\n' "$C_ERR" "$*" "$C_OFF" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-venv) SKIP_VENV=1; shift ;;
    -h|--help)   sed -n '3,24p' "$SELF" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "모르는 옵션: $1" ;;
  esac
done

printf '%s\n' "═══════════════════════════════════════════════════════════"
printf '  ModuPick — EC2 초기 세팅\n'
printf '  %s\n' "$REPO_ROOT"
printf '%s\n' "═══════════════════════════════════════════════════════════"

# sudo가 되는지 먼저 본다. 4단계쯤에서 막히면 앞의 작업이 헛수고가 된다.
if [[ $EUID -eq 0 ]]; then
  SUDO=""
elif sudo -n true 2>/dev/null; then
  SUDO="sudo"
elif sudo true 2>/dev/null; then
  SUDO="sudo"
else
  die "sudo를 쓸 수 없습니다. EC2 기본 사용자(ec2-user 또는 ubuntu)로 실행하세요."
fi


# ── 1. OS 확인 ────────────────────────────────────────────────────────────
step "OS 확인"

[[ -r /etc/os-release ]] || die "/etc/os-release가 없습니다. 지원하지 않는 OS입니다."
# shellcheck disable=SC1091
. /etc/os-release

case "${ID:-}" in
  amzn)          PKG=dnf ;;
  ubuntu|debian) PKG=apt ;;
  *)
    die "지원하지 않는 OS입니다: ${PRETTY_NAME:-$ID}
      Amazon Linux 2023 · Ubuntu · Debian에서만 검증했습니다."
    ;;
esac
ok "${PRETTY_NAME:-$ID} ($(uname -m))"

pkg_install() {
  case "$PKG" in
    dnf) $SUDO dnf install -y "$@" >/dev/null || return 1 ;;
    apt) DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq "$@" >/dev/null || return 1 ;;
  esac
}

info "패키지 목록을 갱신합니다..."
case "$PKG" in
  dnf) $SUDO dnf makecache -q >/dev/null 2>&1 || true ;;
  apt) $SUDO apt-get update -qq >/dev/null 2>&1 || true ;;
esac

# 이미 있는 것은 설치 목록에서 뺀다. Amazon Linux 2023에는 curl-minimal이 기본
# 설치돼 있는데, curl 패키지가 그것과 충돌해 dnf가 통째로 실패한다. 그러면 나머지
# 도구까지 설치되지 않은 채 1단계에서 스크립트가 끝난다.
BASE_PKGS=()
for p in tar gzip git; do command -v "$p" >/dev/null 2>&1 || BASE_PKGS+=("$p"); done
command -v curl >/dev/null 2>&1 || BASE_PKGS+=(curl)
[[ -d /etc/ssl/certs ]] || BASE_PKGS+=(ca-certificates)

if [[ ${#BASE_PKGS[@]} -gt 0 ]]; then
  info "설치할 것: ${BASE_PKGS[*]}"
  pkg_install "${BASE_PKGS[@]}" || die "기본 도구 설치에 실패했습니다: ${BASE_PKGS[*]}
      직접 설치한 뒤 다시 실행하세요."
fi
command -v curl >/dev/null 2>&1 || die "curl이 없습니다. 설치한 뒤 다시 실행하세요."
ok "기본 도구 준비됨"


# ── 2. 스왑 확보 ──────────────────────────────────────────────────────────
step "스왑 확인"

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
info "메모리 ${MEM_MB}MB · 스왑 ${SWAP_MB}MB"

if [[ $MEM_MB -lt 2048 && $SWAP_MB -lt 512 ]]; then
  # t2.micro·t3.micro는 1GB다. MySQL 8.4와 파이썬 빌드가 동시에 돌면 OOM으로
  # 죽는다. 느려도 죽지 않는 편이 낫다.
  if [[ ! -f /swapfile ]]; then
    info "메모리가 작아 2GB 스왑을 만듭니다..."
    $SUDO fallocate -l 2G /swapfile 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    $SUDO chmod 600 /swapfile
    $SUDO mkswap /swapfile >/dev/null
    $SUDO swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
    ok "스왑 2GB 생성 — 재부팅 후에도 유지됩니다"
  else
    $SUDO swapon /swapfile 2>/dev/null || true
    ok "스왑 파일이 이미 있습니다"
  fi
else
  ok "스왑을 만들지 않아도 됩니다"
fi


# ── 3. Docker 설치 ────────────────────────────────────────────────────────
step "Docker 설치"

if command -v docker >/dev/null 2>&1; then
  ok "이미 설치됨 — $(docker --version)"
else
  info "Docker를 설치합니다..."
  case "$PKG" in
    dnf)
      pkg_install docker || die "Docker 설치에 실패했습니다."
      ;;
    apt)
      # curl | sh 로 이어 붙이면 파이프라인이 실패해도 set -e가 먼저 스크립트를
      # 끝내 버려 아래 die에 닿지 못한다. 무엇이 실패했는지 알 수 있게 나눈다.
      curl -fsSL https://get.docker.com -o /tmp/get-docker.sh \
        || die "get.docker.com에서 설치 스크립트를 받지 못했습니다.
      아웃바운드 네트워크와 DNS를 확인하세요."
      $SUDO sh /tmp/get-docker.sh >/dev/null \
        || die "Docker 설치 스크립트가 실패했습니다. 직접 실행해 원인을 보세요:
      sudo sh /tmp/get-docker.sh"
      rm -f /tmp/get-docker.sh
      ;;
  esac
  command -v docker >/dev/null 2>&1 || die "Docker 설치에 실패했습니다."
  ok "$(docker --version)"
fi

$SUDO systemctl enable --now docker >/dev/null 2>&1 || die "Docker 데몬을 시작하지 못했습니다."
ok "Docker 데몬 실행 중"

# compose는 도커 플러그인이다. Amazon Linux 2023 저장소에는 없어서 직접 받는다.
if ! $SUDO docker compose version >/dev/null 2>&1; then
  info "docker compose 플러그인을 설치합니다..."
  case "$(uname -m)" in
    x86_64)  COMPOSE_ARCH=x86_64 ;;
    aarch64) COMPOSE_ARCH=aarch64 ;;
    *) die "지원하지 않는 아키텍처입니다: $(uname -m)" ;;
  esac
  PLUGIN_DIR=/usr/local/lib/docker/cli-plugins
  $SUDO mkdir -p "$PLUGIN_DIR"
  $SUDO curl -fsSL \
    "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${COMPOSE_ARCH}" \
    -o "$PLUGIN_DIR/docker-compose" \
    || die "compose 플러그인을 내려받지 못했습니다. 아웃바운드 네트워크를 확인하세요."
  $SUDO chmod +x "$PLUGIN_DIR/docker-compose" || die "compose 플러그인에 실행 권한을 주지 못했습니다."
  $SUDO docker compose version >/dev/null 2>&1 || die "docker compose 플러그인 설치에 실패했습니다."
fi
ok "$($SUDO docker compose version)"

# 현재 사용자를 docker 그룹에 넣는다. 지금 셸에는 반영되지 않으므로 이 스크립트는
# 계속 sudo로 도커를 부르고, 다음 로그인부터 sudo 없이 쓸 수 있다.
NEED_RELOGIN=0
# $USER는 user-data·cron·su 경로에서 비어 있을 수 있다. set -u 아래에서 그대로
# 쓰면 unbound variable로 끝난다.
ME="${USER:-$(id -un)}"
if [[ -n "$SUDO" ]] && ! id -nG "$ME" | tr ' ' '\n' | grep -qx docker; then
  $SUDO usermod -aG docker "$ME"
  NEED_RELOGIN=1
  warn "$ME 를 docker 그룹에 넣었습니다. 다음 로그인부터 sudo 없이 docker를 쓸 수 있습니다."
fi

DOCKER="$SUDO docker"


# ── 4. Python 설치 ────────────────────────────────────────────────────────
step "Python ${PYTHON_VERSION} 준비"

py_version_of() { "$1" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))' 2>/dev/null || true; }

find_existing_python() {
  local cand
  for cand in python3.14 python3 "$HOME/.local/share/uv/python"/*/bin/python3.14; do
    cand="$(command -v "$cand" 2>/dev/null || echo "$cand")"
    [[ -x "$cand" ]] || continue
    [[ "$(py_version_of "$cand")" == "$PYTHON_VERSION" ]] && { echo "$cand"; return 0; }
  done
  return 1
}

install_python_with_uv() {
  if ! command -v uv >/dev/null 2>&1; then
    info "uv를 설치합니다(파이썬 배포본을 받아 오는 도구)..."
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || return 1
  fi
  export PATH="$HOME/.local/bin:$PATH"
  command -v uv >/dev/null 2>&1 || return 1

  info "uv로 Python ${PYTHON_VERSION}을 받습니다..."
  uv python install "$PYTHON_VERSION" >/dev/null 2>&1 || return 1

  local found
  found="$(uv python find "$PYTHON_VERSION" 2>/dev/null || true)"
  [[ -x "$found" ]] && { echo "$found"; return 0; }
  return 1
}

build_python_from_source() {
  info "소스에서 빌드합니다. 인스턴스 크기에 따라 10~25분 걸립니다..."
  case "$PKG" in
    dnf)
      $SUDO dnf groupinstall -y "Development Tools" >/dev/null 2>&1 || true
      pkg_install gcc make openssl-devel bzip2-devel libffi-devel zlib-devel \
                  readline-devel sqlite-devel xz-devel
      ;;
    apt)
      pkg_install build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev \
                  libsqlite3-dev libffi-dev liblzma-dev
      ;;
  esac

  local src=/tmp/python-src
  rm -rf "$src"; mkdir -p "$src"
  curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tgz" \
    | tar -xz -C "$src" --strip-components=1 || return 1

  ( cd "$src" \
    && ./configure --prefix=/usr/local --with-ensurepip=install >/dev/null \
    && make -j"$(nproc)" >/dev/null \
    && $SUDO make altinstall >/dev/null ) || return 1

  [[ -x /usr/local/bin/python3.14 ]] && { echo /usr/local/bin/python3.14; return 0; }
  return 1
}

if [[ $SKIP_VENV -eq 1 ]]; then
  ok "--skip-venv — 호스트 Python을 건너뜁니다"
  PYTHON_BIN=""
elif PYTHON_BIN="$(find_existing_python)"; then
  ok "이미 있습니다 — $PYTHON_BIN"
else
  PYTHON_BIN="$(install_python_with_uv || true)"
  if [[ -z "$PYTHON_BIN" ]]; then
    warn "uv로 받지 못했습니다. 소스 빌드로 넘어갑니다."
    PYTHON_BIN="$(build_python_from_source || true)"
  fi
  [[ -n "$PYTHON_BIN" ]] || die "Python ${PYTHON_VERSION} 설치에 실패했습니다.
      컨테이너만 띄우려면 ./bootstrap.sh --skip-venv 로 다시 실행하세요."
  ok "설치됨 — $PYTHON_BIN ($(py_version_of "$PYTHON_BIN"))"
fi


# ── 5. 가상환경 ───────────────────────────────────────────────────────────
step "backend/.venv 준비"

if [[ $SKIP_VENV -eq 1 ]]; then
  ok "건너뜁니다"
else
  cd "$REPO_ROOT/backend"

  if [[ -x .venv/bin/python ]] && [[ "$(py_version_of .venv/bin/python)" == "$PYTHON_VERSION" ]]; then
    ok "가상환경이 이미 있습니다"
  else
    [[ -d .venv ]] && { warn "버전이 다른 .venv를 지우고 다시 만듭니다"; rm -rf .venv; }
    info "가상환경을 만듭니다..."
    "$PYTHON_BIN" -m venv .venv || die "가상환경 생성에 실패했습니다."
  fi

  info "의존성을 설치합니다(몇 분 걸립니다)..."
  # activate는 PS1 같은 미설정 변수를 건드리므로 set -u를 잠시 푼다.
  set +u
  # shellcheck disable=SC1091
  source .venv/bin/activate
  set -u
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt || die "requirements.txt 설치에 실패했습니다."
  ok "$(pip list 2>/dev/null | wc -l | tr -d ' ')개 패키지 설치됨"
  deactivate

  cd "$REPO_ROOT"
fi


# ── 6. .env 생성 ──────────────────────────────────────────────────────────
step ".env 준비"

# /dev/urandom을 통째로 tr에 물리면 head가 먼저 끝나면서 tr이 SIGPIPE로 죽고,
# pipefail이 그 141을 파이프라인 결과로 삼아 set -e가 스크립트를 끝낸다. 입력을
# 4KB로 끊으면 tr이 스스로 끝나므로 그 경로가 사라진다. LC_ALL=C는 로케일에
# 따라 tr이 바이트를 문자로 해석하려다 실패하는 것을 막는다.
rand_secret() {
  local s
  s="$(head -c 4096 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 32)"
  [[ ${#s} -eq 32 ]] || die "무작위 비밀번호를 만들지 못했습니다(길이 ${#s})."
  printf '%s' "$s"
}

if [[ -f .env ]]; then
  ok ".env가 이미 있습니다 — 덮어쓰지 않습니다"
else
  [[ -f .env.example ]] || die ".env.example이 없습니다. 저장소가 온전한지 확인하세요."

  # 앱 계정(modupick/modupick)은 .env.example의 값을 그대로 쓴다 — 운영자가 고른
  # 값이다. root와 migrator는 무작위로 만든다. 둘 다 스키마를 통째로 지울 수 있어
  # 저장소에 든 기본값을 그대로 두면 안 된다. 값은 .env에 적고 chmod 600으로 잠근다.
  ROOT_PW="$(rand_secret)"
  MIGRATOR_PW="$(rand_secret)"

  # EC2 퍼블릭 IP를 CORS 기본값에 넣어 둔다. 프론트엔드를 어디에 올리든
  # 결국 바꿔야 하는 값이지만, 비워 두면 무엇을 넣어야 하는지 알기 어렵다.
  TOKEN="$(curl -fsS -X PUT "http://169.254.169.254/latest/api/token" \
            -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --max-time 2 2>/dev/null || true)"
  PUBLIC_IP="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" \
            "http://169.254.169.254/latest/meta-data/public-ipv4" --max-time 2 2>/dev/null || true)"

  cp .env.example .env
  sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${ROOT_PW}|" .env
  sed -i "s|^MODUPICK_MIGRATOR_PASSWORD=.*|MODUPICK_MIGRATOR_PASSWORD=${MIGRATOR_PW}|" .env
  if [[ -n "$PUBLIC_IP" ]]; then
    sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://${PUBLIC_IP}:5173,http://localhost:5173|" .env
    dim "CORS_ORIGINS에 http://${PUBLIC_IP}:5173 을 넣었습니다. 프론트엔드 주소로 바꾸세요."
  fi
  chmod 600 .env
  ok ".env 생성 — 앱 계정 modupick/modupick · root와 migrator는 무작위"
fi

# .env를 source하지 않는다. 값에 공백이나 따옴표가 섞이면 bash가 그 뒤를 명령으로
# 실행하고, 그것만으로 스크립트가 끝난다. 필요한 값만 그대로 읽는다.
# compose는 어차피 .env를 스스로 읽으므로 export할 이유도 없다.
env_get() { grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- || true; }

MODUPICK_APP_PASSWORD="$(env_get MODUPICK_APP_PASSWORD)"
MODUPICK_MIGRATOR_PASSWORD="$(env_get MODUPICK_MIGRATOR_PASSWORD)"
BACKEND_PORT="$(env_get BACKEND_PORT)"


# ── 7. 데이터베이스 ───────────────────────────────────────────────────────
step "데이터베이스 기동"

info "modupick-db를 띄웁니다. 첫 기동에 db_migration/sql이 자동 적용됩니다..."
$DOCKER compose up -d database >/dev/null 2>&1 || die "DB 컨테이너 기동에 실패했습니다.
      로그: $SUDO docker compose logs database"

info "초기화를 기다립니다..."
for i in $(seq 1 90); do
  state="$($DOCKER inspect modupick-db --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
  [[ "$state" == "healthy" ]] && break
  [[ $((i % 15)) -eq 0 ]] && dim "  ... $((i * 2))초 경과 (현재: $state)"
  sleep 2
done
[[ "$state" == "healthy" ]] || die "DB가 준비되지 않았습니다(현재: $state).
      로그:   $SUDO docker compose logs database
      되돌리기: $SUDO docker compose down -v && ./bootstrap.sh"
ok "DB 준비됨"

# root로 SQL을 실행한다. SQL도 비밀번호도 명령행에 두지 않는다 — docker exec의
# 인자는 호스트의 ps에 그대로 보이고, 그러면 .env를 chmod 600으로 잠근 것이
# 무의미해진다. SQL은 stdin으로 흘리고, root 비밀번호는 컨테이너가 이미 갖고
# 있는 환경변수를 컨테이너 안에서 푼다(작은따옴표라 호스트에서 확장되지 않는다).
db_root_sql() {
  $DOCKER exec -i modupick-db \
    sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 --batch "$@"' \
    _ "$@"
}

# initdb.d의 0090_grants.sql은 저장소에 든 기본값으로 계정을 만든다. .env가 다른
# 값을 담고 있으면 여기서 DB 쪽을 맞춘다. 같으면 아무것도 바뀌지 않는다.
# migrator는 DDL 권한이 있어 기본값을 그대로 두지 않는다.
if [[ "${MODUPICK_APP_PASSWORD:-modupick}" != "modupick" ]]; then
  info "앱 계정 비밀번호를 .env 값으로 맞춥니다..."
  printf "ALTER USER 'modupick'@'%%' IDENTIFIED BY '%s';\n" "$MODUPICK_APP_PASSWORD" \
    | db_root_sql || die "앱 계정 비밀번호 변경에 실패했습니다."
  ok "앱 계정 비밀번호 적용됨"
fi

if [[ -n "${MODUPICK_MIGRATOR_PASSWORD:-}" ]]; then
  info "마이그레이션 계정 비밀번호를 적용합니다..."
  printf "ALTER USER 'modupick_migrator'@'%%' IDENTIFIED BY '%s';\n" "$MODUPICK_MIGRATOR_PASSWORD" \
    | db_root_sql || die "마이그레이션 계정 비밀번호 변경에 실패했습니다."
  ok "마이그레이션 계정 비밀번호 적용됨"
fi

info "스키마를 검증합니다..."
if db_root_sql modupick < db_migration/sql/verify.sql 2>/dev/null | grep -q '통과'; then
  ok "테이블 6 · PK 6 · UNIQUE 15 · CHECK 24 · FK 9 · VIRTUAL 4"
else
  die "스키마 검증에 실패했습니다.
      DB 로그에 오류가 없는데도 여기서 막힌다면, 볼륨에 남은 예전 root 비밀번호와
      .env의 값이 어긋난 경우입니다. 아래로 통째로 다시 만드세요.
        $SUDO docker compose down -v && ./bootstrap.sh"
fi


# ── 8. 백엔드 ─────────────────────────────────────────────────────────────
step "백엔드 기동"

BUILD_LOG=/tmp/modupick-build.log
info "이미지를 빌드합니다. 작은 인스턴스에서는 5~20분 걸립니다."
dim "  진행 상황을 보려면 다른 창에서: tail -f $BUILD_LOG"
$DOCKER compose build --progress plain backend > "$BUILD_LOG" 2>&1 || die "이미지 빌드에 실패했습니다.

$(tail -25 "$BUILD_LOG" 2>/dev/null)

      전체 로그: $BUILD_LOG"
ok "이미지 빌드됨"

$DOCKER compose up -d backend >/dev/null 2>&1 || die "백엔드 기동에 실패했습니다.
      로그: $SUDO docker compose logs backend"
ok "컨테이너 기동됨"


# ── 9. 헬스체크 ───────────────────────────────────────────────────────────
step "헬스체크"

PORT="${BACKEND_PORT:-8000}"
for i in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
  # 컨테이너가 죽어 재시작 루프에 빠졌으면 기다릴 이유가 없다.
  running="$($DOCKER inspect modupick-backend --format '{{.State.Running}}' 2>/dev/null || echo false)"
  restarts="$($DOCKER inspect modupick-backend --format '{{.RestartCount}}' 2>/dev/null || echo 0)"
  if [[ "$running" != "true" ]] || [[ "$restarts" -gt 3 ]]; then
    printf '\n'
    $DOCKER compose logs --tail 30 backend || true
    die "백엔드가 정상적으로 뜨지 않았습니다(재시작 ${restarts}회).
      로그: $SUDO docker compose logs backend"
  fi
  sleep 2
done

[[ "${HEALTHY:-0}" == "1" ]] || {
  $DOCKER compose logs --tail 30 backend || true
  die "헬스체크가 응답하지 않습니다.
      로그: $SUDO docker compose logs -f backend"
}
ok "GET /health → $(curl -fsS "http://127.0.0.1:${PORT}/health")"


# ── 완료 ──────────────────────────────────────────────────────────────────
printf '\n%s\n' "═══════════════════════════════════════════════════════════"
printf '  %s세팅 완료%s\n' "$C_OK" "$C_OFF"
printf '%s\n\n' "═══════════════════════════════════════════════════════════"

$DOCKER compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true

printf '\n'
if [[ -n "${PUBLIC_IP:-}" ]]; then
  printf '  API        http://%s:%s/docs\n' "$PUBLIC_IP" "$PORT"
  printf '  헬스체크    http://%s:%s/health\n' "$PUBLIC_IP" "$PORT"
  printf '\n  %s보안 그룹 인바운드에 TCP %s이 열려 있어야 외부에서 보입니다.%s\n' "$C_DIM" "$PORT" "$C_OFF"
else
  printf '  API        http://127.0.0.1:%s/docs\n' "$PORT"
fi

printf '\n  다음에 쓸 만한 명령\n'
printf '    %sdocker compose ps%s                상태 보기\n'        "$C_DIM" "$C_OFF"
printf '    %sdocker compose logs -f backend%s   백엔드 로그\n'       "$C_DIM" "$C_OFF"
printf '    %sdocker compose restart backend%s   백엔드만 재시작\n'   "$C_DIM" "$C_OFF"
printf '    %sdocker compose down%s              전체 정지\n'         "$C_DIM" "$C_OFF"

if [[ $NEED_RELOGIN -eq 1 ]]; then
  printf '\n  %s! 지금은 docker 앞에 sudo가 필요합니다. exit 후 다시 접속하면 없어도 됩니다.%s\n' \
    "$C_WARN" "$C_OFF"
fi
printf '\n'
