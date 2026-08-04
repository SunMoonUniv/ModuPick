# 협의 대장 — B(게임 판정) → A(뼈대)

> **쓴 사람**: B(세찬) · **읽는 사람**: A(연주)
> **무엇**: 판정 6종을 구현하며 나온, B 혼자 정할 수 없는 항목의 누적 기록
> **성격**: 스펙이 아니다. 정본은 언제나 docs/이며, 여기서 결정된 것은 docs/에 반영한 뒤 상태를 닫는다
> **최종 수정**: 2026-08-04

두 갈래다.

- **A-NN — A와 합의할 것.** B와 A의 코드가 맞닿는 지점. A가 결정하거나 확인해야 진행된다
- **D-NN — 문서를 고쳐야 할 것.** 정본끼리 어긋나는 지점. **B가 임의로 고치지 않는다**

| 상태 | 뜻 |
|:----:|-----|
| 🔴 | 열림 — 결정·승인 대기 |
| 🟡 | 방향은 정해짐 — 확정만 남음 |
| ✅ | 닫힘 |

---

## 한눈에 보기

| ID | 상태 | 한 줄 | 누가 정하나 | 언제까지 |
|----|:----:|-------|------------|---------|
| [A-01](#a-01--회전연출-파라미터를-실어-보낼-이벤트가-없다) | 🟡 | 연출 시작 값(룰렛 winnerIndex · 사다리 가로줄)을 보낼 이벤트가 없다 → game:phase에 payload 추가 | A | 4단계 전 |
| [A-02](#a-02--verdictdetail은-임시-자리다) | 🟡 | `Verdict.detail`은 A-01 때문에 둔 임시 필드 | A-01 따라감 | 3단계 합류 전 |
| [A-04](#a-04--시드는-a가-64비트로-발급한다) | 🔴 | 시드는 A가 `secrets.randbits(64)`로 발급 | A | 3단계 합류 전 |
| [A-05](#a-05--pytestflake8이-requirementstxt에-없다) | 🔴 | 개발 의존성(pytest·flake8)을 어디에 적을지 | A | 아무 때나 |
| [D-01](#d-01--시드-폭이-문서마다-다르다) | 🔴 | 시드 폭 64비트 vs 128비트 | 사용자 승인 | A-04와 함께 |
| [D-02](#d-02--룰렛-회전-연출을-서버-상수로-고정한다) | 🔴 | 룰렛 회전을 5바퀴 · 5000ms 상수로 고정 — 저장 논쟁 소멸 | 결정 끝 · 반영만 남음 | 4단계 전 |
| [D-03](#d-03--docsclaudemd의-고정-기준-수치가-낡았다) | 🔴 | docs/CLAUDE.md 고정 기준 수치가 낡음 | 사용자 승인 | 아무 때나 |
| [**D-04**](#d-04--외부-식별자-규약이-정본끼리-반대로-적혀-있다) | 🔴 | **외부 식별자 규약 충돌 — A의 1b를 막는다** | 사용자 승인 | **1b 착수 전** |
| [D-05](#d-05--익명-저격의-지목자-공개-설정을-없앤다) | 🔴 | 저격의 「지목자 공개」 설정 삭제 — 문서 17개 연쇄 | 결정 끝 · 반영만 남음 | 6단계 전 |
| [A-03](#a-03--roster에-넣는-식별자는-member_id다) | ✅ | roster에는 member_id를 넣는다(정본이 이미 규정) | — | 닫힘 |

**지금 급한 것은 D-04 하나다.** 나머지는 어느 것도 당장 작업을 막지 않는다.

---

## A가 판정 함수를 부르는 방법

합의 항목을 읽기 전에 알아야 할 계약이다. 상세는 `app/domain/games/contract.py`에 있다.

```python
from app.domain.games.contract import JudgeContext, JudgeInput
from app.domain.games import roulette

ctx = JudgeContext(
    round_id="rnd_...",          # 외부 식별자
    game_id="roulette",
    seed=1234567890,             # 64비트 부호 없는 정수 (A-04)
    roster=("mbr_...", ...),     # 명단 스냅샷. 입장 순서. member_id다 (A-03)
    config={...},                # 방장 설정
)
verdict = roulette.judge(ctx, inputs)   # inputs는 수용된 입력 배열(도착 순)
```

돌려받는 `Verdict`에서 A가 쓰는 것:

| 필드 | 쓰임 |
|------|------|
| `outcome` | DECIDED · TIE · VOID · HOST_CHOICE |
| `winner` | 단독 승자의 member_id |
| `persist` | **result_data 그대로다.** 변환 없이 game_results.result_data에 넣고 game:result로 내보낸다 |
| `next_phase` · `next_deadline` | 다음 내부 phase와 그 단계의 제한 시간(밀리초) |
| `detail` | 연출 파라미터. 임시 자리다 — [A-02](#a-02--verdictdetail은-임시-자리다) |

**판정 함수는 현재 시각을 읽지 않고 DB·소켓에 접근하지 않는다.** 인자로 받은 값만 쓴다. 같은 시드·같은 입력이면 언제나 같은 결과가 나오므로 저장된 시드로 재현 검증이 가능하다.

---

## A-NN — A와 합의할 것

### A-01 🟡 회전·연출 파라미터를 실어 보낼 이벤트가 없다

**막는 것**: 4단계(룰렛·사다리) · **관련**: docs/05_game_rules/02_roulette.md · docs/07_api/03_socket_events.md §12
**2026-08-04**: 사용자가 아래 B 제안을 채택했다. A가 확정하면 닫는다.

**문제** — 클라이언트는 연출이 **시작되는 순간** 목표 각도를 알아야 한다. 룰렛은 `winnerIndex`, 사다리는 가로줄 좌표다. 그런데 S→C 19종 어디에도 이 값을 실을 자리가 없다 — game:phase는 roundId · phaseSeq · phase · tieRound · deadlineAt · serverTime뿐이고, game:result는 **연출이 끝난 뒤에** 오는 이벤트다.

값이 전원에게 같게 도착하지 않으면 화면이 서로 다른 조각에서 멈춘다.

**[D-02](#d-02--룰렛-회전-연출을-서버-상수로-고정한다)로 범위가 줄었다** — 회전 바퀴 수·시간이 서버 상수가 되어 보낼 값이 `winnerIndex` 하나로 줄었다. 그래도 이 값은 연출 시작 시점에 도착해야 하므로 항목 자체는 남는다.

**B 제안 — game:phase에 게임별 `payload`를 추가한다.**

| # | 근거 |
|:-:|------|
| 1 | **이미 있는 패턴이다.** game:progress가 `roundId · phaseSeq · payload` 구조로 게임별 payload를 싣고, 게임·단계별 payload 표가 문서에 있다. 새 규약이 아니다 |
| 2 | **전이와 값이 원자적으로 도착한다.** 회전 파라미터는 SPINNING 전이 그 순간에 필요하고 game:phase가 곧 그 전이다. 별도 이벤트면 "SPINNING인데 각도를 모르는" 창이 생기고 순서 보장을 따로 다뤄야 한다 |
| 3 | **사다리도 같은 자리에서 닫힌다.** DRAWING 전이에 가로줄을 싣는다. 전용 이벤트로 가면 게임마다 하나씩 늘어난다 |

전용 이벤트 신설은 S→C **19종 → 20종**이라 고정 기준 수치가 바뀌어 docs/README.md · 07_api/README.md · 03_socket_events.md의 전수 목록을 함께 갱신해야 한다. payload 추가는 03_socket_events.md §12 한 곳 + 표 하나다.

**A가 할 일** — 채택하면 03_socket_events.md §12에 payload 필드를 추가하고, game:progress와 같은 형태의 (게임 × 단계) payload 표를 둔다.

| 게임 · 단계 | payload |
|------------|---------|
| 룰렛 SPINNING | winnerIndex |
| 사다리 DRAWING | assignments · ladderRungs |

값 이름은 06_database의 result_data 규약을 따른다.

**B쪽 영향 없음** — 어느 쪽으로 결정되든 `Verdict.detail`이 이미 세 값을 담고 있어 판정 함수는 바뀌지 않는다.

---

### A-02 🟡 `Verdict.detail`은 임시 자리다

**막는 것**: 없음 (A-01 파생) · **관련**: docs/04_architecture/03_judgment_engine.md 「게임별 판정 호출 규약」

**문제** — 계약 문서의 Verdict에는 `detail`이 없다. A-01의 값처럼 **판정이 만들지만 result_data에도 소켓 이벤트에도 자리가 없는 값**을 담으려고 B가 임시로 둔 필드다.

**A가 할 일** — 3단계 합류에서 `game_service`가 `detail`을 읽는 코드를 쓰기 **전에** A-01을 먼저 닫는다. 임시 자리에 의존하는 코드가 생기면 없애기 어려워진다. A-01이 닫히면 값을 그 자리로 옮기고 이 필드를 삭제한다.

---

### A-04 🔴 시드는 A가 64비트로 발급한다

**막는 것**: 3단계 합류 · **관련**: docs/06_database/03_game_rounds.md · [D-01](#d-01--시드-폭이-문서마다-다르다)

**문제** — B의 `Prng`는 **64비트 부호 없는 정수** 시드를 받고 범위를 벗어나면 `ValueError`를 던진다. 조용히 잘리면 결과 재현이 깨지기 때문에 일부러 터뜨린다. A가 발급하는 값이 여기 맞아야 한다.

**A가 할 일**

```python
seed = secrets.randbits(64)      # 암호학적 난수원
# game_rounds.random_seed(BIGINT UNSIGNED)에 저장하고
# 같은 정수를 JudgeContext.seed로 넘긴다
```

**시각·방 코드·참가자 수에서 유도하지 않는다** — 유도하면 결과를 예측할 수 있다. 폭이 64인지 128인지는 문서가 갈려 있어([D-01](#d-01--시드-폭이-문서마다-다르다)) 그쪽 승인과 함께 확정된다.

---

### A-05 🔴 pytest·flake8이 requirements.txt에 없다

**막는 것**: 없음 · **관련**: .github/workflows/ci-backend.yml · plan.md P-07 · P-13

**문제** — CI는 `pip install pytest flake8`을 따로 실행해 돌아가지만 requirements.txt에는 둘 다 없다. 새로 받은 사람이 `pip install -r requirements.txt` 후 `pytest`를 치면 실패한다. 또 plan.md P-07은 **pyproject.toml + uv.lock**을 정했는데 리포지터리에는 requirements.txt가 있다.

**A가 할 일** — 개발 의존성을 어디에 적을지 정한다. requirements.txt를 유지한다면 `requirements-dev.txt` 분리가 통상적이다. 의존성 관리 방식이 A의 결정 범위라 B는 requirements.txt를 건드리지 않았다.

**B가 한 것(통보)** — `backend/conftest.py`를 만들었다. 주석 2줄짜리 빈 파일이며, pytest가 `backend/`를 sys.path에 올려 tests/에서 `app` 패키지를 import하게 하는 것이 유일한 목적이다. backend 루트라 A 영역과 닿아 적어 둔다.

---

## D-NN — 문서를 고쳐야 할 것 (반영 대기)

> **B가 임의로 고치지 않는다.** 아래 항목은 파일·위치·바꿀 내용까지 적어 두었으므로 그대로 적용하면 된다.
>
> **적용할 때의 규약** — docs/CLAUDE.md 「추적성 동시 갱신」에 따라 기능·요구사항·화면·테이블·에러코드가 바뀌면 03_requirements/11_traceability.md와 08_screen/02_traceability.md를 **같은 변경 단위에서** 갱신한다. 개수를 적은 자리는 그 자리에서 다시 센다.
>
> **한 번에 몰아서 하는 편이 싸다** — D-02 · D-05가 같은 파일(06_database/04 · 07_api/03)을 건드리고, 파생 집계는 마지막에 한 번만 다시 세면 된다.

### D-01 🔴 시드 폭이 문서마다 다르다

**막는 것**: 없음 (구현은 64비트로 진행) · **규모**: 한 줄

| 문서 | 값 |
|------|-----|
| docs/05_game_rules/01_common.md 「판정의 결정성과 시드」 | **64비트** |
| docs/05_game_rules/02_roulette.md 판정 알고리즘 | **64비트** |
| docs/06_database/03_game_rounds.md random_seed | **BIGINT UNSIGNED**(64비트) |
| docs/04_architecture/03_judgment_engine.md 「난수와 시드」 | `crypto_random_bytes(16)` = **128비트** |

3:1이고 DB 컬럼이 64비트라 **구현은 64비트로 했다.** 아키텍처 문서의 의사코드 한 줄이 어긋난 것으로 보인다.

**제안** — `crypto_random_bytes(16)` → `crypto_random_bytes(8)`. 해당 줄만 고친다.

---

### D-02 🔴 룰렛 회전 연출을 서버 상수로 고정한다

**막는 것**: 없음 · **규모**: 3개 파일 · **출처**: 사용자 결정(2026-08-04)

**결정** — 룰렛의 회전 바퀴 수와 회전 시간을 **라운드마다 뽑지 않고 서버 상수로 고정한다.**

```
SPIN_TURNS = 5
SPIN_MS    = 5000
```

**결정 경위** — 원래는 "spinDurationMs가 방장 설정 자리(game_rounds.config)에 있는데 서버가 뽑는 값이라 어색하다"는 지적이었다. config냐 result_data냐를 따지다 **애초에 라운드마다 다를 이유가 없다**는 데 이르렀다.

| 시점 | 내용 |
|------|------|
| 원 기획 (docs_legacy/requirements.md §3.5.1 · US-411) | "룰렛이 **3~5초** 회전한 뒤 정해진 조각에서 멈춘다" — 연출 길이의 **범위 서술**이다. 바퀴 수는 언급이 없다 |
| 프로토타입 (frontend/src/games/Roulette.tsx) | `const dur = 4200` · `360 * 5` — **고정값** |
| 문서 재구성 (2026-08-02) | `spinMs = 3000 + randomBelow(prng, 2001)` · `spinTurns = 5 + randomBelow(prng, 3)` — **라운드마다 난수 추출**로 바뀌었다 |

범위 서술을 라운드별 난수 추출로 구현한 것이 재구성 중 생겼다. 「구현 대조」 표는 프로토타입이 어긋난다고 등재했으나 실은 프로토타입이 원 기획대로였다.

**이 결정이 없애는 것**

| 대상 | 효과 |
|------|------|
| config vs result_data 논쟁 | **소멸.** 라운드마다 다른 값이 아니므로 DB에 저장할 것 자체가 없다 |
| [A-01](#a-01--회전연출-파라미터를-실어-보낼-이벤트가-없다) 전송 payload | `winnerIndex` 하나로 줄어든다 |
| 판정 함수 | PRNG 소비 3회 → **1회**. "소비 순서가 결과의 일부"라는 규약이 필요 없어진다 |
| 종료 증명 | **영향 없다.** 지금도 SPINNING 최대 체류를 5초(상한값)로 계산해 41초를 냈다 |

**문서 수정 대상 — 3개 파일**

| 파일 | 위치 | 바꿀 내용 |
|------|------|-----------|
| 05_game_rules/02_roulette.md | 판정 알고리즘 | 출력에서 spinTurns · spinMs 삭제 · 의사코드 3줄 → 1줄 · "소비 순서가 결과의 일부다" 항목 삭제 |
| | 종료 증명 표 | SPINNING 5초의 근거를 "spinMs 상한이 5000ms" → "회전 상수 5000ms"로 |
| | 구현 대조 표 | 「회전 바퀴 수」 행 **삭제**(프로토타입 5바퀴 = 서버 상수 5) · 「각도 계산식」 행 **삭제**(완전히 일치) · 「회전 시간」 행은 남기되 "클라이언트 상수 4200ms → 서버 상수 5000ms"로 |
| 06_database/04_options_votes_results.md | L178 | 룰렛 config에서 **spinDurationMs 삭제** |
| 07_api/03_socket_events.md | A-01 반영 시 | SPINNING payload를 winnerIndex 하나로 |

**B는 반영 완료** — `roulette.py`가 상수 2개를 갖고 `Verdict.detail`은 `{"winnerIndex": n}` 하나만 담는다. `next_deadline`은 SPIN_MS다.

---

### D-03 🔴 docs/CLAUDE.md의 고정 기준 수치가 낡았다

**막는 것**: 없음 · **규모**: 한 줄 + 같은 행의 다른 수치 대조

**문제** — docs/CLAUDE.md는 고정 기준을 "WebSocket 이벤트 **C→S 10종 · S→C 15종**"으로 적는다. 정본인 docs/README.md와 07_api/README.md는 **C→S 12종 · S→C 19종 · 합 31종**이다. 03_socket_events.md의 개정 기록(2026-08-02)이 conn:ping·conn:pong 폐기로 C→S 13→12 · S→C 20→19가 됐음을 남기고 있어, CLAUDE.md만 그 이전 값에 멈춰 있다.

고정 기준을 "전 문서가 동일하게 인용한다"고 못박은 문서 자신이 어긋난 값을 들고 있어서, 이 표를 보고 작업하면 틀린 수치를 옮기게 된다.

**제안** — 해당 값을 C→S 12종 · S→C 19종으로 고친다. 같은 행의 다른 수치(게임 6종 · 화면 12본 · 테이블 6 등)도 정본과 대조해 함께 확인한다.

---

### D-04 🔴 외부 식별자 규약이 정본끼리 반대로 적혀 있다

**막는 것**: **A의 1b(REST 6종)** · **규모**: 규약 2곳 + 07_api 예시 수십 군데
**관련**: docs/10_glossary/04_id_conventions.md · docs/06_database/05_constraints_integrity.md · docs/07_api 전반

**문제**

| 문서 | 규정 |
|------|------|
| 10_glossary/04_id_conventions.md 84행 | "PK는 BIGINT UNSIGNED AUTO_INCREMENT이며 API·WebSocket에서는 JavaScript 정밀도 문제를 피하려 **10진 문자열**로 직렬화한다" |
| 06_database/05_constraints_integrity.md 30행 | "**내부 BIGINT PK를 API·소켓에 노출하지 않는다.** 노출하면 방을 가로질러 연속 증가하는 값에서 다른 방의 참가자 수·생성 순서를 추정할 수 있고, 킹메이커 후보에서는 제출 순서가 드러나 익명성이 깨진다" |
| 07_api/02_rest.md · 03_socket_events.md | 예시가 전부 `"memberId": "1042"` · `"roundId": "3071"` |

**예시 실수가 아니라 규약 자체의 충돌이다.** 07_api는 어긋난 쪽이 아니라 두 규약 중 하나를 충실히 따랐다.

**이것이 1b를 막는 이유** — participants에는 `ck_participants_member_id_format` CHECK가 걸려 있다(`^mbr_[0-9A-Za-z]{16,36}$`). 07_api 예시대로 만들면 `POST /members`가 INSERT에서 거절된다.

**B 판단 — DB 쪽이 이겨야 한다.**

| # | 근거 |
|:-:|------|
| 1 | **CHECK 제약이 강제한다.** "1042"는 INSERT가 거절된다. 문서 취향이 아니라 스키마가 막는다 |
| 2 | **두 규칙이 실제로는 충돌하지 않는다.** 10진 문자열 규칙의 이유는 JS 정밀도인데 mbr_a1b2...는 이미 문자열이라 그 문제가 없다. 불투명 ID가 그 목표를 자동으로 만족한다 |
| 3 | **익명성이 걸려 있다.** 킹메이커 후보에 연속 PK를 노출하면 제출 순서가 드러난다 |

84행 규칙이 적용될 대상도 사실상 없다 — 외부에서 참조되는 엔티티(참가자·판·선택지)는 전부 외부 식별자를 갖고 방은 초대 코드가 그 역할을 한다. 구 스펙의 잔재로 보인다. 덧붙여 04_id_conventions.md의 「ID 형식 요약」 표에는 **mbr_ · rnd_ · opt_ 3종이 아예 없다.**

**제안**

1. 84행을 "외부 식별자를 가진 엔티티는 그것으로만 가리키고 내부 PK를 노출하지 않는다"로 정정
2. 「ID 형식 요약」 표에 mbr_ · rnd_ · opt_ 3행 추가
3. 07_api의 예시 페이로드를 불투명 ID 모양으로 교체 — A 영역이다

**3번의 실제 분량**(2026-08-04 기준):

| 파일 | 대상 |
|------|------|
| 07_api/02_rest.md | `"memberId": "숫자"` **3행** |
| 07_api/03_socket_events.md | `"memberId": "숫자"` **14행** · `"roundId"·"messageId"·"optionId"`의 숫자 예시 **11행** |

약 28행이며 값만 `mbr_...` · `rnd_...` · `opt_...` 모양으로 바꾸면 된다. messageId는 DB 테이블이 없는 값이라(채팅은 서버에 저장하지 않는다) 별도 판단이 필요하다.

**B쪽 영향** — tests/domain의 `round_id="3071"`(문서 예시를 베낀 값)뿐이다. 판정 로직은 식별자를 문자열로만 다뤄 바뀌지 않는다.

**A에게 함께 전할 것** — 파이썬에서 `secrets.token_urlsafe()`는 `-`·`_`를 섞어 내보내 CHECK에 걸린다. base62(`string.ascii_letters + string.digits`)로 뽑아야 한다.

---

### D-05 🔴 익명 저격의 「지목자 공개」 설정을 없앤다

**막는 것**: 없음 (6단계 전까지) · **규모**: 14개 문서 · **출처**: 사용자 결정(2026-08-04)

**결정** — 익명 저격의 방장 설정 4항 중 **지목자 공개(비공개·공개)를 없앤다.** 지목자는 항상 비공개다. 저격의 방장 설정은 3항(주제·투표 시간·중복 투표)이 되고, 게임별 설정 합계는 16항 → **15항**이 된다.

**폐기 사유** — 원 기획에 없던 항목이다. docs_legacy/requirements.md §7.3 「이 문서에서 새로 정한 항목」이 "저격 지목자 공개 설정"을 명시적으로 열거한다 — 구 스펙 작성 중 추가된 것이 2026-08-02 재구성에서 D-35로 승격됐다. 익명이 핵심인 게임에 공개 선택지를 붙이는 것은 기획 의도와 어긋난다.

**킹메이커의 결과 실명 공개(revealAuthors)는 그대로 둔다**(사용자 확정). 안건 제출자 공개와 사람 지목 공개는 성격이 다르고, 킹메이커 쪽은 원 기획에 있던 항목이다.

**연쇄 갱신 대상 — 17개 파일**

행 번호는 2026-08-04 기준이며, 적용 전에 문자열로 다시 찾는다.

| # | 파일 | 위치 | 바꿀 내용 |
|:-:|------|------|-----------|
| 1 | 01_overview/06_design_decisions.md | L91 **D-35** | 행을 지우지 않고 **폐기 표시 + 사유**를 남긴다. 번호는 당기지 않는다 |
| 2 | 01_overview/05_priorities_roadmap.md | L74 구현 정정 6번 | **삭제.** 프로토타입에 설정이 없던 것이 맞았던 셈이 된다. 목록 번호를 다시 센다 |
| 3 | 02_features/05_games.md | L121 F-SNIPE-01 | 설명에서 「지목자 공개 여부」 삭제 (4항 → 3항) |
| | | L128 F-SNIPE-08 | "지목자 공개가 비공개면" 조건 삭제 — 마스킹이 **상시 적용**된다 |
| | | L201 구현 대조 | "지목자 공개 설정과 마스킹 연출이 없다" → 마스킹 연출만 남긴다 |
| 4 | 02_features/06_result.md | L39 | 조건절 삭제 — "누가 누구를 지목했는지 결과 화면에 드러나지 않는다" |
| 5 | 03_requirements/06_games.md | L99 REQ-SNIPE-01 | 4항 → 3항. 기본값 목록과 검증 문구("항목이 넷인지")도 함께 |
| | | L107 REQ-SNIPE-09 | **문구 수정** — "지목자 식별 정보를 결과 응답에 담지 않는다"로 무조건 규칙화 |
| | | L108 REQ-SNIPE-10 | **삭제.** 마지막 번호라 결번이 생기지 않는다 |
| 6 | 03_requirements/07_result.md | L36 | 조건절 삭제 |
| 7 | 03_requirements/10_acceptance_criteria.md | L183 **AC-98** | **문구 수정** — 앞 절반(비공개 검증)만 남기고 뒤 절반(공개 설정 검증) 삭제. REQ-SNIPE-10 참조 제거 |
| 8 | 05_game_rules/README.md | 스펙 시트 「방장 설정 수」 | 저격 **4 → 3** |
| 9 | 05_game_rules/01_common.md | L79 | 설정 전수 표에서 행 **삭제** |
| | | L84 검산 | 저격 4→3 · 합 **16항 → 15항** |
| 10 | 05_game_rules/06_snipe.md | L19 개요 | 4항 → 3항 |
| | | L90 「지목자 공개」 절 | **절 전체 삭제** |
| | | L260 구현 대조 | 행 삭제 — 구현이 어긋난 지점이 아니게 된다 |
| | | L280 · L281 인수 기준 후보 | 두 줄을 "지목자 식별 정보는 어떤 경우에도 응답에 담기지 않는다" 한 줄로 |
| 11 | 06_database/04_options_votes_results.md | L182 | config에서 **revealVoters** 삭제 · result_data에서 **voters[...]** 삭제 |
| 12 | 07_api/03_socket_events.md | L687 | snipe detail에서 **voterMemberIds?** 삭제 |
| | | L689 | 「익명 필드는 조건부다」에서 snipe 부분 삭제. 킹메이커 authorMemberId 조건은 **유지** |
| | | L787 configSchema | **snipe.revealVoters 행 삭제** |
| 13 | 08_screen/04_lobby.md | L195 | 저격 설정 4항 → 3항 |
| | | L227 | 「지목자 공개」 행 삭제 |
| 14 | 08_screen/05_game_screens.md | L303 | 설정 표시 항목에서 삭제 |
| | | L310 · L333 | 조건절 삭제 — 마스킹 상시 적용 |
| | | L341 | "지목자 공개 설정 자체가 없다"는 구현 정정 항목 **삭제** |
| 15 | 08_screen/06_result.md | L89 비고 | 조건절 삭제 |
| 16 | 10_glossary/03_enums_state_machines.md | L181 | 설정 목록에서 **snipe.revealVoters** 삭제 · 검산 **6 + 10 = 16항 → 6 + 9 = 15항** |
| 17 | 11_fairness/02_anonymity.md | L27 | 저격 부분 삭제, 킹메이커 실명 공개 서술은 유지 |
| | | L155 | "지목자 공개 설정과 무관하다" → 설정 언급만 제거(3명 지목 관계 복원 문제 자체는 남는다) |

추적성 두 곳(03_requirements/11_traceability.md · 08_screen/02_traceability.md)은 **F·REQ ID가 삭제되지 않으므로 매핑이 그대로다.** REQ-SNIPE-10 삭제만 반영하면 된다.

**ID 재채번은 필요 없다.** 삭제 대상이 꼬리 번호이거나 문구 수정으로 살아남는다 — REQ-SNIPE-10은 마지막 번호라 지워도 결번이 없고, REQ-SNIPE-09와 AC-98은 무조건 규칙으로 고쳐 쓰면 불변식이 오히려 강해진다. F-SNIPE-01 · 08은 설명만 바뀌고 ID가 남는다.

**바뀌는 수치 3개** — 저격 방장 설정 4항→3항 · 게임별 설정 합계 16항→15항 · configSchema 설정 총수 16항→15항.

**D-35 처리** — 항목 자리에 **폐기 표시와 사유를 남기고 번호는 당기지 않는다.** 04_id_conventions.md의 재채번 조항은 "**기능이** 사라지면 뒤 번호를 당겨 연속을 유지한다"로 표면 기능(F-ID)을 대상으로 하며, D-NN은 결정 이력이라 번호를 당기면 과거 논의 추적이 깨진다. 결정을 뒤집는 경우가 아니라 기획에 없던 항목을 되돌리는 경우이므로 새 D-NN 채번도 하지 않는다.

---

## 닫힌 항목

### A-03 ✅ roster에 넣는 식별자는 member_id다

**2026-08-04 닫힘 — 합의할 것이 아니라 정본이 이미 정한 규약이었다.**

docs/06_database/04_options_votes_results.md 「게임별 JSON 스키마」 공통 규약이 "참가자는 memberId(mbr_...) — 외부 불투명 ID를 쓴다. result_data는 결과 이벤트 payload로 그대로 나가므로 내부 BIGINT PK를 담으면 유출된다"고 적고, 02_rooms_participants.md가 member_id를 "API·소켓이 참가자를 가리키는 유일한 값"으로 못박는다.

**남는 것은 전달뿐** — `JudgeContext.roster`와 `JudgeInput.participant_id`에 **member_id를 넣는다.**

| A가 roster에 넣는 값 | 결과 |
|---------------------|------|
| **member_id** | 판정 → persist → 저장 → 전송까지 **변환 0회** |
| 내부 id | 내부 PK가 result_data JSON에 박히고 그대로 클라이언트로 유출된다. 막으려면 저장 직전·전송 직전에 변환 코드를 넣어야 한다 |

DB 계층이 잠금·조인 때문에 내부 id를 들고 다니는 게 자연스러워 습관적으로 그쪽을 넘길 수 있고, **넘어가도 판정은 정상 동작해 테스트로는 잡히지 않는다** — 결과 JSON을 눈으로 봐야 드러난다. 그래서 닫힌 뒤에도 남겨 둔다.

B는 형식을 검사하지 않는다. `roster`는 `tuple[str, ...]`이라 어떤 문자열이든 통과하지만, 판정 도메인이 ID 형식을 아는 것은 계층 규칙(domain은 값을 받아 값을 돌려준다)에 어긋나고 합의 한 줄이면 닫히는 문제다. 필요해지면 services 계층에서 막는다.

---

## 관련 문서

| 무엇 | 어디 |
|------|------|
| 판정 계약 | docs/04_architecture/03_judgment_engine.md |
| 게임 규칙 정본 | docs/05_game_rules/ |
| 저장 형식 정본 | docs/06_database/04_options_votes_results.md |
| 소켓 이벤트 정본 | docs/07_api/03_socket_events.md |
| 실행 계획 · 역할 분담 | C:\MdPick\docs\plan.md §6.1 |
| B가 만든 코드 | backend/app/domain/games/ · backend/tests/domain/ |
