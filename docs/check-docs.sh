#!/usr/bin/env bash
#
# ModuPick 문서 정합성 검증
#
#   사용법:  ./docs/check-docs.sh        (또는 docs/ 안에서 ./check-docs.sh)
#
# 2026-07-25 문서 재구축에서 해소한 모순이 다시 들어오는 것을 막는다.
# 각 규칙은 DECISIONS.md의 결정 항목에 대응한다.
#
# ── 오탐 처리 ──────────────────────────────────────────────────────────
# 폐기된 값을 "인용·교정·매핑" 목적으로 쓰는 줄은 위반이 아니다. 세 가지로 거른다.
#
#   1) 공통 예외(QUOTE)  — legacy/ 인용, 폐기·금지 표시, ❌, 취소선
#   2) 규칙별 예외        — 같은 줄에 올바른 값이 함께 있으면 "교정 서술"로 본다
#                          (예: "6자리 → 4자리"는 6자리를 고치라는 지시다)
#   3) 파일 제외          — 구 체계를 담는 것이 존재 이유인 문서
#                          (01_screen_map.md = 구 ID 매핑표, README.md = 재구축 배경)
#
# 규칙을 추가할 때는 예외를 넓히기 전에 "이 줄이 정말 의도된 것인가"를 먼저 본다.

set -uo pipefail
cd "$(dirname "$0")" || exit 1

SCREEN_MAP="04_requirements/01_screen_map.md"
FAIL=0
PASS=0

# 전체 문서 목록 (중첩 폴더 포함)
mapfile -t ALL < <(find . -name '*.md' -type f | sed 's|^\./||' | sort) 2>/dev/null \
  || ALL=($(find . -name '*.md' -type f | sed 's|^\./||' | sort))

# 공통 예외 — 이 패턴이 있는 줄은 인용으로 본다
QUOTE='legacy/|폐기|금지|❌|~~|사용하지'

# rule <id> <설명> <패턴> [규칙별예외패턴] [제외파일...]
rule() {
  local id="$1" desc="$2" pat="$3" allow="${4:-}"; shift 4 2>/dev/null || shift 3
  local excl=("$@")

  local files=() f skip x
  for f in "${ALL[@]}"; do
    skip=0
    for x in "${excl[@]:-}"; do [ "$f" = "$x" ] && skip=1; done
    [ "$skip" -eq 0 ] && files+=("$f")
  done

  local hits
  hits=$(grep -nE "$pat" "${files[@]}" 2>/dev/null | grep -vE "$QUOTE" || true)
  [ -n "$allow" ] && hits=$(printf '%s' "$hits" | grep -vE "$allow" || true)

  if [ -z "$hits" ]; then
    printf '  \033[32m✓\033[0m %-3s %s\n' "$id" "$desc"
    PASS=$((PASS+1))
  else
    printf '  \033[31m✗\033[0m %-3s %s\n' "$id" "$desc"
    printf '%s\n' "$hits" | sed 's/^/        /'
    FAIL=$((FAIL+1))
  fi
}

ok()  { printf '  \033[32m✓\033[0m %-3s %s\n' "$1" "$2"; PASS=$((PASS+1)); }
bad() { printf '  \033[31m✗\033[0m %-3s %s\n' "$1" "$2"; printf '%s' "$3" | sed 's/^/        /'; FAIL=$((FAIL+1)); }

echo
echo "ModuPick 문서 정합성 검증"
printf '문서 %d개 · ' "${#ALL[@]}"
echo "─────────────────────────────────────────────"
echo

# ── A. 값 모순 ──────────────────────────────────────────────────────────
echo "A. 값 모순"

rule 1 "초대코드 6자리 예시 없음 (D-01)" \
     'MODU-[0-9]{5,}|427132'      '4자리'          "$SCREEN_MAP"
rule 2 "\"6자리\" 표현 없음 (D-01)" \
     '6자리'                       '4자리'
rule 3 "아바타 30종 표현 없음 (D-08)" \
     '30종'                        '15종'
rule 4 "랜덤 뽑기 미구현 유지 (D-09)" \
     '랜덤 뽑기'                    'D-09|없음|구현하지|제거'
rule 5 "킹메이커 후보 40자 없음 (D-20)" \
     '킹메이커[^|]*1~40자|1~40자[^|]*킹메이커|0 / 40자'
rule 6 "Socket.IO 미확정 표현 없음 (D-26)" \
     'Socket\.IO 여부|기술 스택 확정 후'
rule 7 "폐기 좌표(y144·y914·y938) 없음 (D-30)" \
     'y938|y144|y914'              'y159|y932'

echo

# ── B. 폐기된 API ───────────────────────────────────────────────────────
echo "B. 폐기된 소켓 액션"

rule 8  "timer.start 없음 (D-24)"              'timer\.start'            'D-24'
rule 9  "ladder.pick / laneIndex 없음 (D-23)"  'ladder\.pick|laneIndex'  'D-23'
rule 10 "킹메이커 targetMemberId 없음 (D-18)"  'king\.vote[^|]*targetMemberId|targetMemberId[^|]*킹메이커'  'D-18|대체'

echo

# ── C. 화면 ID 체계 ─────────────────────────────────────────────────────
echo "C. 화면 ID 체계"

rule 11 "구 ID(S-04P·S-0Xb·C-0X·S-TIE) 없음" \
     'S-04P|S-04H|S-0[5-9]b|S-10b|\bC-0[1-4]\b|S-TIE'  ''  "$SCREEN_MAP" README.md
rule 12 "구 절번호(§7.x) 참조 없음" \
     '§7\.[0-9]'                                        ''  "$SCREEN_MAP"

# 13. 모든 화면 ID 참조가 screen-map에 등록돼 있는가
IDPAT='`(S-[0-9]+(-HOST|-GUEST|-1)?R?|M-[0-9]+)`'
KNOWN=$(grep -oE "$IDPAT" "$SCREEN_MAP" | tr -d '`' | sort -u)
USED=$(grep -ohE "$IDPAT" "${ALL[@]}" | tr -d '`' | sort -u)
UNKNOWN=$(comm -13 <(printf '%s\n' "$KNOWN") <(printf '%s\n' "$USED"))
[ -z "$UNKNOWN" ] && ok 13 "모든 화면 ID가 screen-map에 등록됨" \
                  || bad 13 "screen-map에 없는 화면 ID 사용" "$UNKNOWN"$'\n'

echo

# ── D. 문서 무결성 ──────────────────────────────────────────────────────
echo "D. 문서 무결성"

# 14. 상대 링크 깨짐 (각 문서의 디렉터리 기준으로 해석)
BROKEN=""
for f in "${ALL[@]}"; do
  d=$(dirname "$f")
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    case "$t" in http*|\#*|mailto:*) continue;; esac
    [ -e "$d/$t" ] || BROKEN="${BROKEN}${f} → ${t}"$'\n'
  done < <(grep -oE '\]\([^)]+\)' "$f" | sed -E 's/^\]\(//; s/\)$//; s/#.*//' | sort -u)
done
[ -z "$BROKEN" ] && ok 14 "상대 링크 깨짐 없음" || bad 14 "깨진 링크" "$BROKEN"

# 15. 존재하지 않는 문서 참조
rule 15 "없는 문서(DB 설계·기능명세서) 참조 없음" 'DB 설계|기능명세서'

# 16. DECISIONS.md의 모든 결정에 근거가 있는가
NOEV=$(awk '
  /^### D-[0-9]+/ { if (id != "" && has == 0) print id; id=$2; has=0; next }
  /^## /          { if (id != "" && has == 0) print id; id=""; next }
  /\*\*근거\*\*|\*\*기본안\*\*/ { if (id != "") has=1 }
  END { if (id != "" && has == 0) print id }
' DECISIONS.md)
[ -z "$NOEV" ] && ok 16 "모든 결정에 근거 기재됨" || bad 16 "근거 없는 결정" "$NOEV"$'\n'

# 17. 인덱스(README.md)에 등록되지 않은 문서가 있는가 — 문서가 늘어날 때 누락 방지
ORPHAN=""
for f in "${ALL[@]}"; do
  case "$f" in README.md) continue;; esac
  grep -qF "$f" README.md || ORPHAN="${ORPHAN}${f}"$'\n'
done
[ -z "$ORPHAN" ] && ok 17 "모든 문서가 README 인덱스에 등록됨" \
                 || bad 17 "README 인덱스에 없는 문서" "$ORPHAN"

echo
echo "─────────────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m전체 통과\033[0m — %d개 규칙 · 문서 %d개\n\n' "$PASS" "${#ALL[@]}"
  exit 0
else
  printf '\033[31m%d개 규칙 실패\033[0m (통과 %d)\n\n' "$FAIL" "$PASS"
  exit 1
fi
