# 뼈대 담당(A) 인계 — 룰렛 판정 현황

> **작성일**: 2026-08-05 · 브랜치 `sechan` (`0eab4d2`)
> **보낸 사람**: B(게임 판정) · **받는 사람**: A(뼈대)

한 줄로 — **룰렛 1종과 공통 계약이 끝났습니다. 붙이려면 계약 두 가지만 맞추면 됩니다.**
`dev/iee129`의 코드를 직접 읽고 대조했습니다.

---

## 1. 만든 것

```
app/domain/games/contract.py    judge(ctx, inputs) -> Verdict 공통 계약
app/domain/games/rng.py         시드 기반 결정적 PRNG · 거부 표본추출
app/domain/games/roulette.py    룰렛 판정
tests/domain/                   35건 (DB 불필요, 0.5초)
```

`04_architecture/03_judgment_engine.md`의 시그니처 그대로입니다. 시각을 읽지 않고 DB·소켓에 접근하지 않습니다.

---

## 2. 부르는 법

```python
from app.domain.games.contract import JudgeContext
from app.domain.games import roulette

state = store.round_of(room_pk)
ctx = JudgeContext(
    round_id=state.round_id,
    game_id=state.game_id,
    seed=state.seed,
    roster=tuple(m["memberId"] for m in state.roster),   # §3-1
    config=state.config,
)
verdict = roulette.judge(ctx, inputs)
```

| Verdict 필드 | 쓰임 |
|---|---|
| `outcome` | DECIDED · TIE · VOID · HOST_CHOICE |
| `winner` | 단독 승자의 memberId |
| `persist` | **result_data 그대로.** 변환 없이 저장하고 그대로 `game:result`로 |
| `next_phase` · `next_deadline` | 다음 phase · 제한 시간(**정수 밀리초**, §3-2) |
| `detail` | 연출 시작 값. 임시 자리 (§4) |

룰렛 `persist`:

```python
{"schemaVersion": 1, "seed": 12345678901234,
 "winnerMemberIds": ["mbr_..."],          # 한 명뿐이어도 배열
 "wheelOrder": ["mbr_...", "mbr_..."]}    # 조각 배치 = 입장 순서
```

인계 문서 §4의 요청("`persist`를 그대로 저장하고 그대로 내보낼 수 있게")은 맞춰 두었습니다.

---

## 3. 맞춰야 할 것 — 둘

`game_service`를 만들기 전에 닫아야 합니다.

### 3-1. roster의 모양

```python
# A — round_service.start()
roster = [{"memberId": ..., "nickname": ..., "avatarId": ..., "joinOrder": ...}]
# B — JudgeContext
roster: tuple[str, ...]   # memberId만
```

**호출부에서 memberId만 뽑아 넘겨 주세요.** `RoundState.roster`는 지금 형태 그대로 두시면 됩니다(`game:started`가 쓰고 있으니).

판정이 닉네임을 알면 **결과 재현이 표시 정보에 묶입니다** — 닉네임을 바꾸면 같은 시드가 다른 입력이 됩니다.

### 3-2. 마감 시간의 단위

| 어디 | 무엇 |
|------|------|
| `services/round_service.py:196-200` | `emit_phase(..., duration_s: float \| None = None, ...)` — **초** |
| `services/round_service.py:224` | `clock.now() + timedelta(seconds=duration_s)` |
| `infra/memory/runtime_store.py:107` | `deadline_at: datetime` |
| `schemas/events.py:239·249` | 와이어는 `deadlineAt`(ISO) · `remainMs: int`(**밀리초**) |
| `domain/games/contract.py:62` | `next_deadline: int \| None` — **정수 밀리초** |
| `domain/games/roulette.py:23·54` | `SPIN_MS = 5000` → `next_deadline=SPIN_MS` |

**`emit_phase`가 `duration_ms: int`를 받는 쪽을 제안합니다.** 문서가 이 축을 정해 두었습니다.

> `10_glossary/05_units_and_time.md:28` — **설정값은 처음부터 밀리초 정수로 보관하고 표시할 때만 초로 나눈다.** 초 단위 설정값을 내부에서 밀리초로 환산할 때 부동소수점 곱셈을 거치지 않는다 — 0.3초를 300으로 환산하는 과정에서 0.30000000000000004 같은 값이 나오면 판정창 경계가 흔들린다

같은 문서 `:26`이 "제한 시간은 초(설정) → 밀리초(내부), **표시 단위와 계산 단위를 섞지 않는다**"로 정하고, `04_id_conventions.md:86`도 "게임 판정 시간은 정수 밀리초 BIGINT"입니다. `emit_phase`는 내부 API이고 와이어(`remainMs`)도 이미 밀리초라, 지금은 `밀리초 → float초 → datetime` 으로 중간에 한 번만 float를 거치는 모양입니다.

**값이 깨지는 상황은 아닙니다.** 이 경로에 들어오는 값은 전부 정수 초이고(가이드 3초 · 자동 실행 30초 · 회전 5초 · 눈치 라운드 10·15·20초 · 저격 투표 5~60초) `timedelta(seconds=5.0)`은 정확합니다. 문서가 경고한 0.3초 사례는 판정창인데 그건 phase 마감이 아니라 그룹핑 파라미터라 이 경로를 타지 않습니다. **규약 정렬 문제입니다.**

다만 `deadline_at`이 표시 전용만은 아닙니다 — 킹메이커·저격은 **마감 만료가 판정 트리거**이고 어떤 입력을 받아들일지도 이 시각이 가릅니다.

**A의 함수이니 A가 정하시면 됩니다.** 바꾸지 않으신다면 호출부에서 한 번만 나누겠습니다. 실제 위험은 **두 군데에서 각자 변환하는 것** 하나뿐입니다.

```python
duration_s=verdict.next_deadline / 1000 if verdict.next_deadline else None
```

---

## 4. 나중에 정할 것 — 셋

| # | 무엇 | 언제 |
|:-:|------|------|
| 1 | **연출 시작 값을 실을 자리가 없습니다.** 클라이언트는 회전이 시작되는 순간 목표 각도를 알아야 하는데(룰렛 `winnerIndex`, 사다리 가로줄), `game:phase`에 자리가 없고 `game:result`는 연출이 끝난 뒤에 옵니다 → **`emit_phase`에 `payload` 인자 추가**를 제안합니다. `game:progress`가 이미 같은 패턴이고, 전용 이벤트를 만들면 S→C 19종→20종이라 고정 기준 수치가 바뀝니다 | 룰렛·사다리를 화면에 붙이기 전 |
| 2 | `Verdict.detail`은 1번 때문에 둔 **임시 필드**입니다. 계약 문서에 없는 자리이니, `game_service`가 이걸 읽는 코드를 쓰기 전에 1번을 닫아 주세요 | 1번 따라감 |
| 3 | **입력 수집층이 아직 없습니다.** 인계 문서 §3에 "`arrived_ms`는 뼈대가 넣어 준다"고 되어 있는데 `RoundState`에 입력 배열·도착 시각이 없습니다. A가 만드시는 게 맞는지 확인만 부탁드립니다. 룰렛·사다리는 입력을 판정에 쓰지 않아 지금은 없어도 됩니다 | 킹메이커 이후 |

---

## 5. 문서 수정 — B가 손대지 않았습니다

정본끼리 어긋나는 곳을 찾았습니다. 규칙 문서라 임의로 고치지 않았습니다.

| # | 무엇 | 어디 | 어떻게 |
|:-:|------|------|--------|
| 1 | **시드 폭 충돌** | `04_architecture/03_judgment_engine.md` | `crypto_random_bytes(16)`(128비트)만 다릅니다. 나머지 셋(게임 규칙 2본 · DB 컬럼)과 **A의 코드**가 64비트이니 `(8)`로 정정 |
| 2 | **룰렛 회전을 상수로 고정** | `05_game_rules/02_roulette.md` · `06_database/04` L178 | 아래 별도 설명 |
| 3 | **고정 기준 수치 낡음** | `docs/CLAUDE.md` | "C→S 10종 · S→C 15종" → 정본은 **12종 · 19종**. 같은 행의 다른 수치도 대조 필요 |
| 4 | **외부 식별자 규약 충돌** | `10_glossary/04_id_conventions.md` L84 · `07_api` 예시 | L84는 "PK를 10진 문자열로 직렬화"인데 `06_database/05`는 "PK를 노출하지 않는다"입니다. **A의 `tokens.py`가 옳은 쪽**이니 L84를 정정하고, 「ID 형식 요약」 표에 `mbr_`·`rnd_`·`opt_` 3행 추가. `07_api` 예시의 `"memberId": "1042"` 류 **약 28행**을 불투명 ID 모양으로 교체 |
| 5 | **저격 「지목자 공개」 삭제** | 문서 17개 + `game_config.py` | 아래 별도 설명 |
| 6 | **gameId 매핑 낡음** | `10_glossary/04_id_conventions.md` 접두사 표 | `timecatch`·`sniper` → **`timer`·`snipe`** 2행 |

### 2번 — 룰렛 회전 상수 고정

원 기획(`docs_legacy` §3.5.1)은 "**3~5초** 회전"이라는 **범위 서술**이었고 바퀴 수는 언급이 없었습니다. 프로토타입도 `dur = 4200` · 5바퀴 **고정**이었습니다. 그런데 재구성(2026-08-02)에서 라운드마다 난수로 뽑는 값이 됐습니다.

**`SPIN_TURNS = 5` · `SPIN_MS = 5000` 상수로 고정했습니다.** 라운드마다 다를 이유가 없고, 그러면 `spinDurationMs`를 어디에 저장할지 문제가 사라집니다(A의 `SCHEMA[ROULETTE] = (topic,)`이 이미 맞습니다 — 고칠 곳은 문서뿐).

문서: `02_roulette.md`의 판정 알고리즘에서 spinTurns·spinMs 출력 삭제 · 종료 증명의 5초 근거 문구 · 구현 대조 표 3행 중 2행 삭제, `06_database/04` L178에서 `spinDurationMs` 삭제.

### 5번 — 저격 「지목자 공개」 삭제

원 기획에 없던 항목입니다. `docs_legacy/requirements.md §7.3` 「이 문서에서 새로 정한 항목」이 이 설정을 명시적으로 열거합니다. 익명이 핵심인 게임에 공개 선택지를 붙이는 것이 기획 의도와 어긋나 **없애기로 했습니다.** 지목자는 항상 비공개입니다.

**킹메이커의 `revealAuthors`는 그대로 둡니다.**

- **코드**: `game_config.py`의 `SCHEMA[GameId.SNIPE]`에서 `_bool("revealVoters", False)` 삭제 + 관련 계약 테스트
- **수치 3개**: 저격 설정 4항→3항 · 게임별 설정 합계 16항→15항 · configSchema 총수 16항→15항
- **ID 재채번 없음**: REQ-SNIPE-10은 꼬리 번호라 삭제해도 결번이 없고, REQ-SNIPE-09·AC-98은 "지목자 식별 정보를 결과 응답에 담지 않는다"로 **고쳐 쓰면** 불변식이 오히려 강해집니다. F-SNIPE-01·08은 설명만 바뀝니다
- **문서 17개**: `01_overview/05·06` · `02_features/05·06` · `03_requirements/06·07·10` · `05_game_rules/README·01·06` · `06_database/04` · `07_api/03` · `08_screen/04·05·06` · `10_glossary/03` · `11_fairness/02`

행 단위 위치가 필요하시면 보내 드리겠습니다.

---

## 6. 머지할 때

**따로 부탁드릴 것이 없습니다.** 설정 파일을 하나도 건드리지 않았습니다 — `requirements.txt` · `pytest.ini` · `main.py` 전부 그대로입니다.

- `app/domain/__init__.py`를 추가했습니다(빈 파일). `app/`에는 있고 `app/domain/`에는 없던 상태였습니다
- B의 판정 테스트는 DB를 쓰지 않습니다. `pytest tests/domain`으로만 돌려도 되고, A의 `pytest.ini`(`testpaths = tests`)에 그대로 얹혀도 됩니다
- `catalog.py`는 `enums.GameId`·`MIN_MEMBERS`와 `game_config.SCHEMA`를 **import해서 씁니다.** 다시 정의하면 값이 갈라집니다

---

## 7. 대조해서 확인한 것

`dev/iee129`(`67ab567`)를 읽고 맞춰 본 결과입니다. 아래는 **이미 맞아서 할 일이 없습니다.**

| 항목 | 확인 |
|------|------|
| 시드 | `secrets.randbelow(2**64)` — B의 `Prng`가 요구하는 범위와 정확히 같습니다 |
| 외부 식별자 | `tokens.py`가 `mbr_`+base62 22자. `persist`에 그대로 담기니 PK 유출 경로가 없습니다 |
| roster 순서 | `ORDER BY joined_at, id` = 입장 순서 = 룰렛 조각 배치 기준 |
| 명단 스냅샷 | 시작 시 고정, 이탈해도 불변 — 판정이 기대하는 그대로입니다 |
| 룰렛 설정 | `SCHEMA[ROULETTE] = (topic,)` 1항 |
