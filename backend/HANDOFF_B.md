# 판정 담당(B) 인계 — 백엔드 뼈대 현황

> **작성일**: 2026-08-06 · 브랜치 `dev/iee129`
> **보낸 사람**: A(뼈대) · **받는 사람**: B(게임 판정)
> **개정**: 2026-08-06 — 룰렛 합류 완료. 사다리 요청과 계약 확정분으로 전면 개정

한 줄로 — **룰렛은 시작부터 결과까지 붙었습니다. 사다리 판정을 주시면 같은 자리에 얹습니다.**

---

## 1. 룰렛은 이렇게 붙었습니다

`game_service.py`가 판정을 부르고 결과를 저장해 내보내기까지 잇습니다.

```
GUIDE(3초) → ARMED(30초) → [PICK 또는 자동 실행] → SPINNING(5초) → REVEAL(3초) → RESULT
```

부르는 자리는 `game_service._judge`입니다.

```python
ctx = JudgeContext(
    round_id=state.round_id, game_id=state.game_id, seed=state.seed,
    roster=tuple(m["memberId"] for m in state.roster),   # memberId만
    config=state.config, phase=state.phase,
)
verdict = roulette.judge(ctx, tuple(state.inputs))
```

말씀하신 **§3-1(roster)**과 **§3-2(밀리초)**는 제안대로 닫았습니다.

| 항목 | 결과 |
|---|---|
| roster | 호출부에서 memberId만 뽑아 넘깁니다. `RoundState.roster`는 그대로입니다 |
| 시간 단위 | `emit_phase`가 **정수 밀리초**를 받습니다. `duration_ms=verdict.next_deadline`을 그대로 넘깁니다 |
| 연출 값 자리 | `emit_phase(payload=...)`를 열었습니다. **`Verdict.detail`을 없애셔도 됩니다** |
| 입력 수집층 | 만들었습니다 — 아래 §3 |

---

## 2. `persist`를 그대로 내보내지는 못합니다

인계 문서에 "변환 없이 저장하고 그대로 `game:result`로"라고 적어 주셨는데, **저장은 그대로 맞고 전송은 모양이 다릅니다.** 정본 두 곳이 서로 다른 형태를 규정합니다.

| 어디 | 룰렛의 모양 |
|---|---|
| 저장 `06_database/04` | schemaVersion · seed · winnerMemberIds[] · wheelOrder[] |
| 전송 `07_api/03 §17` | variant · result{ topic · winnerMemberId · detail{seed · sliceOrder} · stats } |

`persist`는 **저장 형식과 정확히 일치**해 변환 없이 들어갑니다. 전송할 때만 이름이 바뀌는 자리가 있고(`wheelOrder` → `sliceOrder`) 판정이 만들지 않는 값도 있습니다(`topic` · `stats`). 변환은 `game_service._wire_result` 한 곳에서만 합니다.

**B가 하실 일은 없습니다.** `persist`를 저장 형식(`06_database/04`)에 맞춰 주시면 나머지는 뼈대가 합니다.

---

## 3. 입력 수집층은 만들었습니다

§4-3에서 확인 요청하신 항목입니다. **A가 만드는 것이 맞아** 넣었습니다.

```python
JudgeInput(participant_id=<memberId>, kind=<action type>, payload=..., arrived_ms=..., seq=...)
```

- **도착 시각은 서버가 붙입니다.** 클라이언트가 보낸 시각을 믿으면 그것이 곧 판정 조작 경로가 됩니다
- `arrived_ms`는 **라운드 시작을 원점으로 하는 상대 정수 밀리초**입니다(계약 문서 그대로)
- `seq`는 같은 밀리초에 둘 이상 도착했을 때의 결정론적 보조 축입니다
- **단계가 바뀌면 배열을 비웁니다.** 지난 단계 입력을 다음 판정이 보지 않습니다

`arrived_ms` 원점을 **라운드 시작**으로 잡았습니다. 눈치게임처럼 라운드가 여러 번 도는 게임에서 단계 시작 원점이 편하시면 `ctx.started_ms`와 함께 조정하겠습니다.

---

## 4. 다음은 사다리입니다 — 협의할 것 하나

`03_ladder.md`가 의사코드·종료 증명·경계값까지 정해 뒀으니 그대로 옮기시면 됩니다. **다만 `optionId` 때문에 룰렛과 사정이 다릅니다.**

저장 형식이 이렇습니다.

```
assignments[{ memberId, optionId, label }]      06_database/04
```

`optionId`(`opt_...`)는 **DB가 발급하는 값**이고 판정 함수는 DB를 모릅니다. 게다가 `game_options`에 넣을 도착 항목은 **정규화된 뒤의 것**이라(`03_ladder.md:78` — n보다 많으면 자르고 적으면 X로 채운다) 그 정규화 결과를 뼈대가 알아야 행을 만들 수 있습니다.

**A 제안 — 판정은 인덱스로 돌려주시고 optionId는 뼈대가 채웁니다.**

```python
Verdict(
    outcome=DECIDED,
    assignments=({"memberId": "mbr_...", "slotIndex": 2, "label": "발표"}, ...),
    detail={"slots": ["팀장", "자료 조사", ...],        # 정규화된 하단 항목(순서 그대로)
            "ladderRungs": [{"row": 0, "leftLane": 1}, ...]},
    persist={...},          # optionId 자리는 비워 두시거나 아예 빼 주세요
    next_phase="DRAWING", next_deadline=<밀리초>,
)
```

뼈대가 하는 일 — `slots`로 `game_options` 행 n개를 만들고(정본이 사다리를 "도착 항목 · 참가자 참조 없음"으로 규정), `slotIndex`로 `option_id`를 이어 `persist`에 채운 뒤 저장합니다.

| # | 근거 |
|:-:|------|
| 1 | **판정이 DB 발급값을 알 수 없습니다.** 계층 규칙상 domain은 값을 받아 값을 돌려줍니다 |
| 2 | 정규화가 판정 로직의 일부라(난수 소비 전 1단계) 뼈대가 따로 구현하면 **같은 규칙이 두 곳에 생깁니다** |
| 3 | 룰렛의 `winnerIndex`와 같은 축입니다 — 인덱스로 주고 이름은 뼈대가 붙입니다 |

**다른 모양이 편하시면 말씀해 주세요.** 필요한 것은 둘뿐입니다 — *정규화된 항목 배열*과 *참가자 → 항목 대응*. 담기는 자리는 어디든 맞추겠습니다.

`ladderRungs`는 연출 시작 값이라 `game:phase(DRAWING)`의 payload로 나갑니다(A-01에서 열어 둔 자리). 결과 저장에도 함께 들어갑니다.

---

## 5. 지금 돌아가는 것 / 안 돌아가는 것

| 구간 | 상태 |
|---|:---:|
| REST 6종 · 소켓 · 대기방 · 채팅 · 준비 · 강퇴 · 이탈 유예 · 청소 | 완료 |
| 게임 선택 · 설정 동기화 (configSchema **15항목**) | 완료 |
| 라운드 생성 · 명단 스냅샷 · 단계 전이 · 틱 | 완료 |
| **룰렛** — 자동 전이 · 판정 · 결과 저장 · `game:result` | **완료** |
| `game:action` 라우팅 · 입력 수집 | 완료 (현재 type은 `roulette.pick` 하나) |
| 사다리 · 킹메이커 · 시간초 · 저격 · 눈치 | **비어 있음** |
| `game:decide` | 라우터에 없음 |

검증 — 계약 테스트 **309건**, 브라우저 두 창 **28건**. 전부 통과 상태입니다.

판정이 없는 게임을 고르면 라운드는 서지만 READY에 머뭅니다(`game_service.begin`이 로그만 남기고 돌아갑니다). 방장의 `round:close`로 빠져나올 수 있습니다.

---

## 6. 파일 경계

| 손대세요 | 손대지 마세요 |
|---|---|
| `app/domain/games/` · `app/api/games.py` · `tests/domain/` | `app/services/` · `app/ws/` · `app/infra/` · `sql/` · `devtools/` |

게임 설정 규격은 `app/domain/game_config.py`에 있습니다. 판정 함수는 `ctx.config`로 **검증된 값**을 받으므로 다시 검증할 필요가 없습니다.

**저격 설정이 3항으로 줄었습니다** — `revealVoters`(지목자 공개)를 폐기했습니다. 원 기획에 없던 항목이고 익명이 핵심인 게임에 공개 선택지를 붙이는 것이 의도와 어긋납니다. 지목자는 항상 비공개이며, 결과 응답에 지목자 식별 정보를 **어떤 경우에도** 담지 않습니다.

---

## 7. 문서 정정은 끝났습니다

`HANDOFF_A.md §5`에 적어 주신 6건을 전부 반영했고, 대조 중 2건을 더 찾아 함께 고쳤습니다.

| # | 무엇 |
|:-:|------|
| 1 | 시드 폭 — `crypto_random_bytes(16)` → `(8)` |
| 2 | 룰렛 회전 상수 고정 — 판정 알고리즘·종료 증명·구현 대조 |
| 3 | 고정 기준 수치 — C→S 12종 · S→C 19종 |
| 4 | 외부 식별자 규약 — 84행 정정 + 「ID 형식 요약」에 `mbr_`·`rnd_`·`opt_` 추가 + `07_api` 예시 39건 |
| 5 | 저격 「지목자 공개」 폐기 — 문서 17개 + 파생 집계 |
| 6 | gameId 매핑 — `timecatch`·`sniper` → `timer`·`snipe` |
| 7 | `06_database/04`의 config 열이 **6종 중 5종**에서 정본과 불일치 |
| 8 | configSchema 총수 16 → 15 |

`docs/check-docs.sh`로 ID 채번 연속성·링크·에러 코드 전수를 검사합니다. 문서를 고치셨으면 이걸 돌려 주세요.

---

## 8. 로컬에서 띄우는 법

```bash
# DB (MySQL 8.4, 포트 3307 — 로컬 mysqld의 3306을 피했습니다)
cd backend && docker compose up -d

# 서버 — macOS · Linux
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --ws-ping-interval 20 --ws-ping-timeout 60

# 테스트 (실제 MySQL에 붙어 돕니다)
pytest
```

**윈도우는 가상환경 활성화 경로가 다릅니다.**

```powershell
cd backend; docker compose up -d

python -m venv .venv; .venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt

# 한글 로그가 cp949로 떨어지지 않게 UTF-8 모드로 띄웁니다
$env:PYTHONUTF8 = "1"
uvicorn app.main:app --reload --ws-ping-interval 20 --ws-ping-timeout 60

pytest
```

uvloop는 윈도우를 지원하지 않아 환경 표지로 걸러 뒀습니다. 없으면 uvicorn이 asyncio 기본 이벤트 루프로 돌며 동작은 같습니다. 줄바꿈은 `.gitattributes`가 LF로 고정합니다.

`pip install -r requirements-dev.txt` 하나면 됩니다 — 그 파일이 `requirements.txt`를 포함하고 pytest·flake8·playwright를 더합니다.

확인 수단이 넷 있습니다.

| 수단 | 무엇을 보나 |
|---|---|
| `http://127.0.0.1:8000/devtools/console.html` | 소켓 프레임을 직접 보내고 받는 검증 콘솔. **돌리기(PICK) 버튼**과 결과 표시가 붙어 있어 룰렛을 끝까지 돌려볼 수 있습니다 |
| `backend/devtools/eyeball.py` | 콘솔을 진짜 Chrome으로 두 창 띄워 28건 검증. `CONSOLE_URL`로 포트를 바꿀 수 있습니다 |
| `frontend/devtools/two-windows.py` | 제품 화면을 두 창 띄워 검증 (`HEADED=1`이면 눈으로 보입니다) |
| `/openapi.json` · `backend/devtools/socket-events.ts` | REST·소켓 타입. 소켓 타입은 `gen_socket_types.py`가 스키마에서 생성합니다 |

---

## 9. 남은 협의

1. **사다리의 `optionId` 처리** — §4. 이것만 정하면 사다리는 바로 붙습니다
2. `game:decide`의 RETRY·ABORT 처리 — 선택지는 **둘만** 두기로 확정돼 있습니다
3. 킹메이커부터는 입력이 **DB에도** 남습니다(`votes`·`game_options`). 인메모리 배열은 밀리초 판정용이고, 초 단위로 마감하는 표는 행으로 남깁니다(`06_database/04` 「저장 범위」) — 그 경계는 킹메이커 착수 때 같이 보면 됩니다
