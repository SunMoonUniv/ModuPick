#!/usr/bin/env bash
# ModuPick docs/ 정합성 검사
# 사용법: bash docs/check-docs.sh   (저장소 루트에서 실행)
# 종료 코드 0 = 전 항목 통과, 1 = 실패 항목 있음

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
DOCS=docs
FAIL=0

pass() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=1; }
head2() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# 펜스 코드 블록을 제거한 본문을 표준출력으로 낸다
strip_fences() {
  awk '/^```/{f=!f; next} !f' "$1"
}

ALL_MD=$(find "$DOCS" -name '*.md' | sort)

# ─────────────────────────────────────────────────────────
head2 "1. 폴더 구조"
EXPECTED_DIRS="01_overview 02_features 03_requirements 04_architecture 05_game_rules 06_database 07_api 08_screen 09_tech_stack 10_glossary 11_fairness"
for d in $EXPECTED_DIRS; do
  if [ -d "$DOCS/$d" ]; then
    [ -f "$DOCS/$d/README.md" ] && pass "$d/README.md 존재" || fail "$d/README.md 없음"
  else
    fail "$d/ 폴더 없음"
  fi
done
[ -f "$DOCS/README.md" ] && pass "docs/README.md 존재" || fail "docs/README.md 없음"
[ -f "$DOCS/CLAUDE.md" ] && pass "docs/CLAUDE.md 존재" || fail "docs/CLAUDE.md 없음"

# ─────────────────────────────────────────────────────────
head2 "2. 메타 블록 (H1 → blockquote 대상·작성일·원천)"
for f in $ALL_MD; do
  [ "$(basename "$f")" = "check-docs.sh" ] && continue
  h1=$(head -1 "$f")
  case "$h1" in
    "# "*) ;;
    *) fail "$f — 첫 줄이 H1이 아니다"; continue ;;
  esac
  blk=$(sed -n '2,8p' "$f")
  echo "$blk" | grep -q '^> \*\*대상\*\*:' || fail "$f — 메타 블록에 대상 없음"
  echo "$blk" | grep -q '^> \*\*작성일\*\*:' || fail "$f — 메타 블록에 작성일 없음"
  echo "$blk" | grep -q '^> \*\*원천\*\*:' || fail "$f — 메타 블록에 원천 없음"
done
pass "메타 블록 검사 완료 ($(echo "$ALL_MD" | wc -l | tr -d ' ')개 문서)"

# ─────────────────────────────────────────────────────────
head2 "3. 인라인 백틱 금지 (펜스 블록 밖)"
BT=0
for f in $ALL_MD; do
  n=$(strip_fences "$f" | grep -c '`' || true)
  if [ "$n" -gt 0 ]; then
    fail "$f — 인라인 백틱 ${n}줄"
    BT=$((BT + n))
  fi
done
[ "$BT" -eq 0 ] && pass "인라인 백틱 0건"

# ─────────────────────────────────────────────────────────
head2 "4. 상대 링크 유효성"
BROKEN=0
for f in $ALL_MD; do
  dir=$(dirname "$f")
  # [텍스트](경로) 에서 경로만 뽑고 앵커·외부 URL 제외
  grep -oE '\]\([^)]+\)' "$f" | sed 's/^](//; s/)$//' | while read -r link; do
    # 링크가 아닌 것을 거른다 — 배열 표기 뒤의 괄호 설명(wheelOrder[](조각 배치) 등)이
    # ](...) 형태와 같아 잡히므로, 경로에 쓰지 않는 문자가 있으면 링크로 보지 않는다
    case "$link" in
      http*|\#*|mailto:*) continue ;;
      *" "*|*,*|*"("*) continue ;;
    esac
    case "$link" in
      */*|*.md) ;;
      *) continue ;;
    esac
    target="${link%%#*}"
    [ -z "$target" ] && continue
    if [ ! -e "$dir/$target" ]; then
      echo "BROKEN|$f|$target"
    fi
  done
done > /tmp/modupick-links.txt
BROKEN=$(grep -c '^BROKEN' /tmp/modupick-links.txt || true)
if [ "$BROKEN" -gt 0 ]; then
  while IFS='|' read -r _ src tgt; do fail "$src → $tgt"; done < /tmp/modupick-links.txt
else
  pass "깨진 링크 0건"
fi

# ─────────────────────────────────────────────────────────
head2 "5. ID 채번 연속성 (결번·중복 금지)"
check_series() {
  local label="$1" pattern="$2"
  local ids
  ids=$(grep -rhoE "$pattern" $DOCS --include='*.md' | sort -u)
  [ -z "$ids" ] && { printf '  --   %s — 아직 채번 없음\n' "$label"; return; }
  # 접두사별로 번호 연속성 검사
  echo "$ids" | sed -E 's/-([0-9]+)$/ \1/' | awk -v L="$label" '
    { pre[$1]; n[$1"|"int($2)]=1; if (int($2) > max[$1]) max[$1]=int($2) }
    END {
      bad=0
      for (p in pre) {
        for (i = 1; i <= max[p]; i++) {
          if (!((p"|"i) in n)) { printf "MISSING %s %s-%02d\n", L, p, i; bad=1 }
        }
      }
      if (!bad) printf "OKSERIES %s\n", L
    }'
}
{
  check_series "F(기능)" 'F-[A-Z]+-[0-9]+'
  check_series "REQ(요구사항)" 'REQ-[A-Z]+-[0-9]+'
} > /tmp/modupick-ids.txt
grep '^OKSERIES' /tmp/modupick-ids.txt | while read -r _ l; do pass "$l — 결번 없음"; done
grep '^MISSING' /tmp/modupick-ids.txt | while read -r _ l id; do fail "$l — 결번 $id"; done

# D·ADR·AC는 채번 정본 파일에서만 센다. 다른 문서의 인용과
# docs_legacy의 구 D-NN 인용이 섞이면 연속성 판정이 깨진다
declare_owner() {
  case "$1" in
    D)   echo "$DOCS/01_overview/06_design_decisions.md" ;;
    ADR) echo "$DOCS/04_architecture/08_decision_records.md" ;;
    AC)  echo "$DOCS/03_requirements/10_acceptance_criteria.md" ;;
  esac
}
for series in "D" "ADR" "AC"; do
  owner=$(declare_owner "$series")
  [ -f "$owner" ] || { printf '  --   %s-NN — 채번 정본 없음\n' "$series"; continue; }
  ids=$(grep -ohE "^(\| ?|#+ )(\*\*)?${series}-[0-9]+" "$owner" | grep -oE "${series}-[0-9]+" | sed "s/${series}-//" | sort -n -u)
  if [ -z "$ids" ]; then printf '  --   %s-NN — 아직 채번 없음\n' "$series"; continue; fi
  maxid=$(echo "$ids" | tail -1)
  cnt=$(echo "$ids" | wc -l | tr -d ' ')
  if [ "$((10#$maxid))" -eq "$cnt" ]; then pass "${series}-NN — 01~${maxid} 연속 (${cnt}건)"
  else fail "${series}-NN — 최대 ${maxid}인데 ${cnt}건만 존재(결번)"; fi
done

# ─────────────────────────────────────────────────────────
head2 "6. 에러 코드 전수 등재"
GLOSS="$DOCS/10_glossary/02_error_codes.md"
if [ -f "$GLOSS" ]; then
  # 네임스페이스 5종으로만 좁힌다. 그러지 않으면 파일명·테이블.컬럼·메서드 호출이 전부 잡힌다
  # 펜스 블록(의사코드·SQL) 안의 member.rank 같은 변수 표기는 에러 코드가 아니다
  used=$(for f in $ALL_MD; do strip_fences "$f"; done \
        | grep -ohE '\b(room|member|game|vote|common)\.[a-z_]{3,}\b' \
        | grep -vE '\.(md|sh|ts|tsx|py|json|sql|css|html)$' | sort -u)
  miss=0
  for c in $used; do
    grep -q "$c" "$GLOSS" || { fail "에러 코드 $c 가 사전에 없음"; miss=$((miss+1)); }
  done
  [ "$miss" -eq 0 ] && pass "사용된 에러 코드 전부 사전 등재"
else
  printf '  --   10_glossary/02_error_codes.md 아직 없음\n'
fi

# ─────────────────────────────────────────────────────────
head2 "7. 게임 규칙 문서 필수 요소"
GR="$DOCS/05_game_rules"
if [ -d "$GR" ]; then
  for f in "$GR"/0[2-7]_*.md; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    for need in "상태" "판정" "종료" "경계"; do
      grep -q "$need" "$f" || fail "$b — '$need' 관련 절 없음"
    done
    grep -q '^```' "$f" || fail "$b — 의사코드·상태 전이도(펜스 블록) 없음"
  done
  pass "게임 규칙 문서 필수 요소 검사 완료"
else
  printf '  --   05_game_rules 아직 없음\n'
fi

# ─────────────────────────────────────────────────────────
head2 "8. 금지 표현"
# '미정'은 시간초의 정당한 상태명 미정지·미시작과 겹치므로 조사가 붙은 형태만 잡는다.
# '상한 없음'·'무한 반복'은 폐기 이력을 서술할 때 정당하게 등장한다.
if grep -rn "무한 반복\|미정이\|미정임\|미정 상태\|미확정으로\|TBD\|TODO\|추후 결정\|나중에 정한다" $DOCS --include='*.md' \
   | grep -v "폐기\|않는다\|없다\|막는다\|구 D-\|대체\|정정" > /tmp/modupick-forbidden.txt 2>/dev/null; then
  while read -r l; do fail "미확정 표현: $l"; done < /tmp/modupick-forbidden.txt
else
  pass "미확정·보류 표현 0건"
fi

# 금지어 '탈락' — 용어집이 안전 확정·잔류로 대체하도록 규정했다.
# 허용: 용어집 정의·구현 정정 목록·폐기된 구조를 설명하는 부정형 서술
grep -rn "탈락" $DOCS --include='*.md' \
  | grep -v "10_glossary/01_domain_terms.md" \
  | grep -v "05_priorities_roadmap.md" \
  | grep -v "탈락하는 구조\|탈락 구조\|탈락시키\|탈락으로\|구 스펙\|쓰지 않는다\|오해\|즉시 탈락\|첫 탈락\|전원 탈락" \
  | grep -v "안전 확정\|구현 결함\|고친다\|고쳐야\|정본 규칙\|이름을 읽은\|이름만의 문제" \
  > /tmp/modupick-eliminated.txt 2>/dev/null
if [ -s /tmp/modupick-eliminated.txt ]; then
  while read -r l; do fail "금지어 '탈락'(안전 확정·잔류로): ${l:0:120}"; done < /tmp/modupick-eliminated.txt
else
  pass "금지어 '탈락' 0건(정의·정정목록·부정형 서술 제외)"
fi

# ─────────────────────────────────────────────────────────
printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m전 항목 통과\033[0m\n'
else
  printf '\033[31m실패 항목 있음\033[0m\n'
fi
exit $FAIL
