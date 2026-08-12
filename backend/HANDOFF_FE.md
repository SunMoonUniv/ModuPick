# 소켓 연동 인계 — 백엔드(뼈대) → 프론트

> **쓴 사람**: 백엔드 뼈대 담당 · **읽는 사람**: 프론트 담당 · PM
> **기준 커밋**: `4c6d3c0` · **작성일**: 2026-08-12
> **무엇**: 프론트가 임시 서버(`frontend/local-server/`) 계약으로 남아 있는 지점과, 실제 백엔드에 붙일 때 고쳐야 할 것의 전수 목록
> **성격**: 거래 문서다. 전환이 끝나면 이 파일을 지운다

---

## 0. 한 줄

**화면은 전부 있고 서버도 전부 있다. 둘을 잇는 계약이 어긋나 있다.** REST와 소켓 트랜스포트는 이미 실제 백엔드 기준으로 전환됐고, 남은 것은 **이벤트 이름 6건 + 결과 payload 4변형**이다.

지금 상태로 붙이면 방 생성·입장·채팅·준비까지는 정상이고, **게임에 들어가는 순간부터 어긋난다.**

---

## 1. 이미 맞는 것 — 손대지 않는다

| 구간 | 근거 |
|------|------|
| REST 6종 | `src/api/rest.ts`·`protocol/types.ts`가 실제 백엔드의 공통 봉투·`memberToken`·`PENDING`/`ACTIVE`·점 표기 에러 코드를 이미 기대한다. **임시 서버 상대로는 오히려 방 생성이 실패한다**(`frontend/CLAUDE.md:27`) |
| 소켓 경로 | `/ws/rooms/{code}` — `src/realtime/client.ts:36` ↔ `backend/app/main.py:130` 일치 |
| 인증 순서 | 연결 → 3초 안 `conn:auth` → `room:snapshot` 1회 → 부분 갱신. `client.ts:1-6` ↔ `ws/router.py:5` 일치 |
| 프로토콜 버전 | `PROTOCOL_VERSION = 1` 양쪽 동일 (`client.ts:14` ↔ `ws/envelope.py:28`) |
| 종료 코드 | 4002 · 4401 · 4408 · 4413 일치 |
| 접속 주소 | `src/api/endpoint.ts:9` — `VITE_SERVER_URL` 한 줄로 갈아끼운다. 코드 수정 없음 |

---

## 2. 이벤트 이름 갭 — 6건

`backend/devtools/socket-events.ts`(자동 생성 정본) ↔ `frontend/src/protocol/types.ts` 전수 대조.

| # | 백엔드 | 프론트 | 붙이면 생기는 일 | 고칠 쪽 |
|:-:|--------|--------|------------------|---------|
| 1 | `game:tick` | `server:tick` (`roomStore.ts:298`) | 모든 게임의 남은 시간 표시가 멈춘다 | 프론트 |
| 2 | `game:start`가 시작·다시하기를 겸함 (`ws/router.py:244`) | `game:replay` 송신 (`roomStore.ts:332`) | **결과 화면 「다시 하기」가 거절된다** | 프론트 |
| 3 | `member:left` + `reason=KICK` | `member:kicked` (`roomStore.ts:182`) | 강퇴당한 사람 화면이 안 넘어간다 | 프론트 |
| 4 | `game:decision_required` | 없음 | 결선·재대결 3회 소진 시 **판이 멈춘다** | 프론트 |
| 5 | `game:decide` (C→S) | 없음 | 위와 같음 — 방장이 RETRY·ABORT를 고를 수단이 없다 | 프론트 |
| 6 | `member:connection` | 없음 | 불안정 표시가 안 뜬다 | 프론트 |

**1·2·3은 에러도 안 나고 조용히 안 돈다.** 통합 테스트에서 놓치기 쉬운 종류다.

---

## 3. 결과 payload 갭 — 여기가 제일 크다

`game:result`의 `result`가 **변형 이름부터 다르다.**

### 3.1 variant 매핑이 서로 어긋난다

| 게임 | 백엔드 | 프론트 | |
|------|--------|--------|---|
| 룰렛 | `WINNER` | `winner` | 대소문자만 다름 |
| 사다리 | `ASSIGN` | `assign` | 대소문자만 다름 |
| 킹메이커 | `TALLY` | `tally` | 대소문자만 다름 |
| **시간초** | `WINNER` | `record` | **매핑 자체가 다름** |
| **저격** | `WINNER` | `tally` | **매핑 자체가 다름** |
| **눈치** | `RECORD` | `winner` + `rounds` | **매핑 자체가 다름** |

백엔드 매핑의 정본은 `docs/07_api/03_socket_events.md §17`이며, 시간초의 순위표는 `WINNER`의 `detail.records`에 들어간다(`services/games/timer.py`). 저격도 `WINNER`이며 집계는 `detail.tally`다(`services/games/snipe.py:318`).

### 3.2 필드 모양

| 변형 | 백엔드가 보내는 것 | 프론트가 기대하는 것 |
|------|-------------------|---------------------|
| 룰렛 `WINNER` | `topic · winnerMemberId · detail{seed, sliceOrder} · stats` | `topic · winner: RoundMember · detail?: string[]` |
| 사다리 `ASSIGN` | `topic · pairs[{memberId, itemLabel}] · seed · stats` | `topic · assignments[{member: RoundMember, item}] · ladder?` |
| 킹메이커 `TALLY` | `topic · winnerCandidateId · rows[{candidateId, text, votes}] · reveal · stats` | `topic · winnerLabel · rows[{label, votes, rank, ...}]` |
| 시간초 | `WINNER` + `detail{targetMs, criterion, records[{memberId, elapsedMs, diffMs, …}]}` | `record` + `targetMs · winnerRule · rows[{member: RoundMember, elapsedMs, diffMs, absErrorMs, rank}]` |
| 눈치 | `RECORD` + `rounds[{round, presses[{memberId, offsetMs, verdict}], safeMemberIds}]` | `winner` + `rounds[{subRound, entered, passed[], eliminated[], reason, gapMs?}]` |

### 3.3 사람을 가리키는 방식 — 백엔드는 안 바꾼다

프론트는 `RoundMember{memberId, nickname, avatarId, departed}` 객체를 기대하고, 백엔드는 **`memberId` 문자열만** 보낸다.

이건 갭이지만 **프론트에서 조인하는 것이 맞다.** 닉네임·아바타는 `room:snapshot`의 명단에 이미 있고 `member:joined`·`member:left`로 갱신된다. 결과 payload에 다시 실으면 같은 값이 두 경로로 오고 둘이 갈라질 수 있다. `departed`도 `member:left` 수신으로 프론트가 안다.

### 3.4 순위(`rank`)·정렬

프론트가 기대하는 `rank`를 백엔드는 보내지 않는다. 다만 **배열 순서가 곧 순위**다 — 시간초 `records`는 `recorded → no_stop → no_start` 군 순서이고 군 안에서 절대 오차 오름차순, 킹메이커·저격 `rows`는 득표 내림차순으로 이미 정렬돼 나간다. 동점 처리 규칙이 필요하면 그때 필드를 추가한다.

---

## 4. 프론트가 남긴 요청 4건 — 회신

`frontend/백엔드 연동 요청 사항.md`에 대한 답이다.

### ① `WinnerResult.rounds` (눈치 라운드 기록) — **이미 보내고 있다. 모양이 다르다**

백엔드는 `RECORD` variant의 `rounds`로 내보낸다(`domain/games/nunchi.py:252`). 다만 축이 다르다.

| | 백엔드 | 프론트 |
|---|--------|--------|
| 단위 | 사람별 판정 — `presses[{memberId, offsetMs, verdict}]`, `verdict ∈ SAFE·OVERLAP·NO_INPUT·LAST` | 그룹 — `passed[]` / `eliminated[]` + 라운드 사유 `reason` |
| 사유 | 사람마다 붙는다 | 라운드마다 하나 붙는다(`SIMULTANEOUS` 등) |

**필요한 정보는 전부 들어 있다.** `verdict`로 `passed`/`eliminated`를 가르고, 라운드 `reason`은 판정 분포에서 유도된다. **프론트에서 변환하는 것을 제안한다** — 같은 사실을 두 모양으로 저장하면 재현 검증(`result_data`는 시드로 재현 가능해야 한다)이 깨진다. 변환이 부담이면 백엔드가 와이어 단계에서 얹을 수 있으니 말해 달라.

⚠️ **미해결 결함 하나** — 전원이 각자 혼자 눌러 생존자가 0이 되는 경우, 최후 1인이 `verdicts`에는 `LAST`인데 `safeMemberIds`에도 들어 있다. 화면이 모순된 값을 받는다. `07_api/03 §14`가 이 경우를 정의하지 않아 **규칙부터 확정해야 한다.** 판정 담당 소관으로 넘겨 둔 건이다.

### ② `roulette.pick` / `ladder.start` 삭제 — **못 지운다. 대신 안 보내도 돈다**

두 액션은 백엔드에 살아 있다(`services/games/roulette.py:20` · `ladder.py:34`). 방장 전용이고 `ARMED` 단계에서만 받는다.

**프론트가 안 보내도 게임은 끝까지 간다** — `ARMED_MS = 30_000`(`game_service.py:52`)이 지나면 자동으로 다음 단계로 넘어간다. 즉 터지지는 않는다. **대신 매 판 30초 동안 화면이 멈춰 있는다.**

정본(`docs/05_game_rules/02_roulette.md`·`03_ladder.md`)이 방장 조작을 규정하므로 백엔드가 임의로 지울 수 없다. 선택지는 셋이고 **기획 결정이 필요하다**:

| 안 | 내용 | 대가 |
|:-:|------|------|
| A | 프론트에 「돌리기」·「사다리 타기」 버튼을 되살린다 | 화면 2본 수정. 정본 그대로 |
| B | 정본에서 `ARMED` 단계를 지우고 `GUIDE` → 판정 직행으로 고친다 | 문서 6본 + 백엔드 진행 모듈 2본 수정 |
| C | `ARMED_MS`를 3초쯤으로 줄여 사실상 자동 진행으로 만든다 | 가장 싸다. 방장 조작이 형식만 남는다 |

### ③ `GameProgress.optionVotes` (킹메이커 실시간 득표) — **줄 수 없다**

전역 불변식이 명시적으로 막는다 — *"진행 중에는 완료/대기 상태만 내려간다. **방장에게도 예외를 두지 않는다**"*(`docs/02_features/README.md`). `game:progress`에는 `submittedCount`·`votedCount`만 싣는다.

중간 득표가 보이면 뒤에 투표하는 사람이 앞선 결과를 보고 고르게 되어 익명 투표의 전제가 무너진다. **이 결정을 뒤집으려면 기획 결정이 필요하고, 백엔드 판단으로는 뒤집지 않는 편이 맞다.** 화면 쪽에서 진행률 표시로 바꾸는 것을 제안한다.

### ④ `game:result.roundElapsedMs` — **없다. 넣을 수 있다**

현재 `game:result`는 `roomVersion · roundId · gameId · variant · result · finishedAt`이다. 한 판에 걸린 시간은 라운드 시작 시각을 서버가 들고 있으므로 추가에 부담이 없다. **필요하다고 확정해 주면 넣는다** — `07_api/03` 갱신이 함께 간다.

---

## 5. 정본과 확인 방법

### 5.1 계약 정본

**`backend/devtools/socket-events.ts`** 하나다. 라우터·스키마에서 자동 생성되며, 목록이 어긋나면 `tests/domain/test_type_generator.py`가 CI에서 잡는다. 이 파일을 `frontend/src/protocol/types.ts`의 소켓 구간에 옮기면 된다.

```bash
cd backend && .venv/bin/python devtools/gen_socket_types.py   # 재생성
```

REST 구간은 이미 맞으므로 옮기지 않는다.

### 5.2 실제 서버로 확인

```bash
# 1) DB
docker compose up -d db

# 2) 백엔드
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

# 3) 프론트 — .env.local 한 줄
echo 'VITE_SERVER_URL=http://localhost:8000' > frontend/.env.local
cd frontend && npm run dev
```

`local-server`는 띄우지 않는다.

### 5.3 화면 없이 프레임만 보고 싶을 때

| 도구 | 쓰임 |
|------|------|
| `backend/devtools/console.html` | 방 생성 → 게임 선택 → 시작 → 단계별 프레임을 눈으로 본다 |
| `backend/devtools/playthrough.py` | 실제 연출 상수 그대로 6종을 한 판씩 돌려 프레임 시간 축을 찍는다 |

```
룰렛      GUIDE 3.0s → ARMED → SPINNING 5.0s → REVEAL 3.0s → RESULT      11.4초
사다리    GUIDE 3.0s → ARMED → DRAWING 3.5s → REVEAL 3.0s → RESULT        9.9초
시간초    GUIDE 3.0s → RUNNING → REVEAL 3.0s → RESULT                     6.7초
킹메이커  GUIDE 3.0s → SUBMIT → VOTE → TALLY 3.0s → RESULT                6.7초
저격      GUIDE 3.0s → VOTE → REVEAL 3.0s → RESULT                        6.4초
눈치      GUIDE 3.0s → ROUND → ROUND_RESULT 3.0s → REVEAL 3.0s → RESULT   10.4초
```

**위 시간은 방장이 `ARMED`에서 버튼을 누른 경우다.** 안 누르면 룰렛·사다리에 30초가 더 붙는다(②).

---

## 6. 결정이 필요한 것 — 3건

| # | 항목 | 누가 정하나 | 언제까지 |
|:-:|------|------------|---------|
| 1 | ② 룰렛·사다리 조작 주체 — A·B·C 중 하나 | 기획 · PM | 연동 착수 전 |
| 2 | ③ 킹메이커 실시간 득표 — 정본 유지 여부 | 기획 · PM | 연동 착수 전 |
| 3 | ① 눈치 `rounds` 변환을 어느 쪽이 하나 | 프론트 ↔ 백엔드 | 결과 화면 붙일 때 |

나머지(이벤트 이름 6건 · payload 4변형)는 **정본이 이미 정해져 있어 결정할 것이 없다.** 백엔드를 정본으로 프론트가 맞추면 된다.

---

## 7. 관련 문서

| 무엇 | 어디 |
|------|------|
| 소켓 이벤트 정본 | `docs/07_api/03_socket_events.md` |
| 결과 payload 정본 | `docs/06_database/04_options_votes_results.md` · `07_api/03 §17` |
| 게임 규칙 정본 | `docs/05_game_rules/` |
| 생성 타입 | `backend/devtools/socket-events.ts` |
| 프론트가 남긴 요청 원문 | `frontend/백엔드 연동 요청 사항.md` |
