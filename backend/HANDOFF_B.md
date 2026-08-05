# 판정 담당(B) 인계 — 백엔드 뼈대 현황

> **작성일**: 2026-08-04 · 브랜치 `dev/iee129` (`06db57a`)
> **보낸 사람**: A(뼈대) · **받는 사람**: B(게임 판정)

한 줄로 — **뼈대는 라운드 시작까지 끝났고, 판정 함수를 부를 자리만 비어 있습니다.**
그 자리는 `round_service.emit_phase` 하나입니다.

---

## 1. 먼저 알아야 할 것: plan.md §5는 무효입니다

plan.md는 "**규칙 자체가 존재하지 않아** 잠정값으로 넘길 수 없는" 미결정 7건을 B가
닫아야 한다고 적었습니다. **docs/가 전부 닫아 놨습니다.** 규칙을 새로 정하는 일이
아니라 **문서를 옮겨 적는 일**입니다.

| plan.md §5가 막힌다고 한 것 | docs/ 현황 |
|---|---|
| 눈치 종료 조건 | `05_game_rules/07_nunchi.md` — 종료 증명 있음 |
| 판정창 그룹핑 알고리즘 | 같은 문서 §판정 알고리즘 |
| 시간초 무한 재대결 | `05_game_rules/05_timer.md` |
| 킹메이커 시간 상수 | `05_game_rules/04_kingmaker.md` |
| Q-01 조작 주체 | `02_features/08_permission_matrix.md` |
| 게임별 연출 길이 상수표 | **항목 자체가 성립하지 않음** — `resultScreenAt`이라는 필드가 docs 계약에 없습니다 |

게임 6종 문서가 전부 **판정 알고리즘(의사코드) · 종료 증명 · 경계값 표 · 인수 기준**을
갖고 있습니다. 규칙을 고민하지 말고 **문서가 이긴다**는 전제로 그대로 구현하세요.

```
docs/05_game_rules/
  01_common.md   02_roulette.md  03_ladder.md
  04_kingmaker.md 05_timer.md    06_snipe.md   07_nunchi.md
```

---

## 2. 지금 돌아가는 것 / 안 돌아가는 것

| 구간 | 상태 |
|---|:---:|
| 방 만들기 · 코드 조회 · 참가 · 아바타 · 프로필 확정 · 이탈 (REST 6종) | 완료 |
| 소켓 연결 · 인증 · 방 스냅샷 · 명단 이벤트 | 완료 |
| 채팅 · 준비 · 강퇴 · 이탈 유예(30/60초) · 주기 청소 · 기동 정리 | 완료 |
| 게임 선택 · 설정 동기화 (configSchema 16항목) | 완료 |
| `game:start` → 라운드 생성 · 명단 스냅샷 고정 · PLAYING 전이 · `game:phase(READY)` | 완료 |
| **게임별 단계 진행 · 판정 · 결과 저장 · `game:result`** | **비어 있음 = B 몫** |
| `game:action` · `game:decide` | 라우터에 없음 (보내면 `game.invalid_action`) |

검증 현황 — 계약·도메인·서비스 테스트 **224건**, 실서버 프로토콜 재생 **85건**,
브라우저 두 창 **9건 + 21건**. 전부 통과 상태입니다.

프론트도 **대기방까지는 실서버에 붙어 있습니다**(`frontend/src/lib/`). 게임 화면부터는
아직 클라이언트 시뮬레이션이라, B의 판정이 붙는 순간 그쪽도 서버 값으로 갈아탑니다.

---

## 3. B가 만들 것

plan.md §3.2의 파일 목록 그대로입니다.

```
app/domain/games/catalog.py            게임 메타 (최소 인원은 이미 domain/enums.py에 있음)
app/domain/games/roulette.py · ladder.py · kingmaker.py · timer.py · snipe.py · nunchi.py
app/api/games.py                       GET /api/games · GET /api/games/{gameId}
tests/domain/                          DB 없이 도는 순수 규칙 테스트
```

**시그니처는 docs가 정해 뒀습니다** — `04_architecture/03_judgment_engine.md §게임별 판정 호출 규약`.

```
judge(ctx, inputs) -> Verdict     # 순수 함수. 시각을 읽지 않고 DB·소켓에 접근하지 않는다

ctx      round_id · game_id · config · roster · alive · seed · phase ·
         repeat · started_ms · deadline_ms · tie_pool
inputs   participant_id · kind · payload · arrived_ms · seq   (도착 순 정렬)
Verdict  outcome(DECIDED|TIE|VOID|HOST_CHOICE) · winner · assignments · tally ·
         survivors · tie_pool · next_phase · next_deadline · persist
```

**시각을 직접 읽지 마세요.** `arrived_ms`·`started_ms`는 뼈대가 넣어 줍니다. 시드도
`ctx.seed`로 들어옵니다(라운드마다 64비트, `game_rounds.random_seed`에 저장됨) — 판정에
난수가 필요하면 그 시드로만 만드세요. 같은 입력이 같은 결과를 내야 재현이 됩니다.

---

## 4. 접점은 두 곳뿐입니다

### ① 단계 전이 — `round_service.emit_phase`

```python
await round_service.emit_phase(room_pk, phase="PLAYING", duration_s=10.0)
await round_service.emit_phase(room_pk, phase="TIE", tie_round=1)
```

`phaseSeq` 증가 · `game:phase` 브로드캐스트 · 1초 틱 시작·정지를 이 함수가 다 합니다.
게임별 상위 서비스(예: `game_service.py`)가 판정 결과를 보고 이걸 부르면 됩니다.

라운드 상태는 `store.round_of(room_pk)`에 있습니다 — `round_id` · `config` · `roster`
(**명단 스냅샷, 도중 이탈해도 불변**) · `seed` · `phase` · `phase_seq` · `deadline_at`.

### ② 결과 저장 — `game_results.result_data` (JSON)

와이어 형태는 `07_api/03_socket_events.md §17 game:result`, 의미 정본은
`05_game_rules`입니다. **variant 4종**(WINNER · ASSIGN · TALLY · RECORD)이
`frontend/src/lib/types.ts`의 `GameResult` 유니언과 1:1 대응합니다.

판정 함수가 돌려준 `persist`를 뼈대가 그대로 저장하고 그대로 내보낼 수 있게 맞춰
주세요. 이 한 가지만 합의되면 3단계 합류에서 변환 코드가 안 생깁니다.

---

## 5. 파일 경계

| 손대세요 | 손대지 마세요 |
|---|---|
| `app/domain/games/` · `app/api/games.py` · `tests/domain/` | `app/services/` · `app/ws/` · `app/infra/` · `sql/` · `devtools/` |

겹치는 자리가 하나 있습니다 — **게임 설정 규격**은 이미 `app/domain/game_config.py`에
있습니다(configSchema 16항목·기본값·부분 갱신 검증, 계약 테스트 43건). 판정 함수는
`ctx.config`로 검증된 값을 받으므로 다시 검증할 필요가 없습니다. 규격을 바꿔야 하면
말씀해 주세요.

---

## 6. 바뀐 계약값 — 확인 부탁드립니다

프로토타입이 쓰던 **`timecatch` · `sniper`는 계약값이 아닙니다.** 정본은 `timer` ·
`snipe`이고 DB CHECK도 그 값만 받습니다. 프론트는 이미 교체했습니다.

```
roulette · ladder · kingmaker · timer · snipe · nunchi
```

---

## 7. 로컬에서 띄우는 법

```bash
# DB (MySQL 8.4, 포트 3307 — 로컬 mysqld의 3306을 피했습니다)
cd backend && docker compose up -d

# 서버
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --ws-ping-interval 20 --ws-ping-timeout 60

# 테스트 (실제 MySQL에 붙어 돕니다)
pytest
```

확인 수단이 셋 있습니다.

| 수단 | 무엇을 보나 |
|---|---|
| `http://127.0.0.1:8000/devtools/console.html` | 소켓 프레임을 직접 보내고 받는 검증 콘솔. **임의 프레임 입력창**이 있어 `game:action` 같은 미구현 이벤트를 두드려 볼 수 있습니다 |
| `backend/devtools/eyeball.py` | 콘솔을 진짜 Chrome으로 두 창 띄워 21건 검증 |
| `frontend/devtools/two-windows.py` | 제품 화면을 두 창 띄워 9건 검증 (`HEADED=1`이면 눈으로 보입니다) |
| `/openapi.json` · `backend/devtools/socket-events.ts` | REST·소켓 타입. 소켓 타입은 `gen_socket_types.py`가 스키마에서 생성합니다 |

---

## 8. 합류할 때 정할 것

지금 당장은 아니고, B의 판정 6종이 테스트로 검증된 뒤에 같이 정하면 되는 것들입니다.

1. `game_service.py`를 누가 만들지 — 판정 호출·결과 저장·브로드캐스트를 잇는 층
2. `game:action`의 type 8종 라우팅 (`07_api/03_socket_events.md §game:action type 8종`)
3. 방장 결정(`game:decide`)의 RETRY·ABORT 처리 — 선택지는 **RETRY·ABORT 둘만** 두기로 확정돼 있습니다
4. 결과 화면 진입 시점(`round:close`는 **RESULT 단계에서만** 받습니다 — 전표 15행)
