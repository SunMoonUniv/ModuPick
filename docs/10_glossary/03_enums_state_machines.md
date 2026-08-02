# enum과 상태 머신

> **대상**: ModuPick 전 문서·구현이 쓰는 값 집합과 상태 머신의 색인 — 어디에 무엇이 있고 정본이 어느 문서인지
> **작성일**: 2026-08-02
> **원천**: [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md)(DB 값 집합 6축) · [../06_database/04_options_votes_results.md](../06_database/04_options_votes_results.md)(result_data 값 규약) · [../07_api/03_socket_events.md](../07_api/03_socket_events.md)(와이어 값·configSchema) · [../07_api/02_rest.md](../07_api/02_rest.md)(게임 메타·결과 형태) · [../05_game_rules](../05_game_rules/README.md)(게임별 phase 6종) · [../02_features/06_result.md](../02_features/06_result.md)(결과 화면 형태 4종)

**본 문서는 색인이지 정본이 아니다.** 제품 전체에 흩어진 값 집합과 상태 머신을 한 곳에서 찾을 수 있게 모으고, 각 항목이 어느 문서에서 확정되는지를 가리킨다. 값이 어긋나면 정본 열이 가리키는 문서가 이긴다 — 본 문서는 정의를 새로 만들지 않는다. 유일한 예외는 **세는 기준을 밝히는 일**이며, 같은 것을 두 축으로 세는 자리가 여럿이라 그 구분을 여기서 한 번 정리한다.

전수는 **31종 · 라벨 132개**다.

## 세는 기준

같은 상태가 저장·와이어·화면에서 다른 이름을 갖는 자리가 있다. 개수를 셀 때 무엇을 하나로 보는지 먼저 정한다.

| 기준 | 내용 |
|------|------|
| 한 축 = 한 종 | 같은 상태를 DB는 소문자로, 와이어는 대문자로 표기하는 경우 **한 종으로 센다.** 표기가 둘이지 값 집합은 하나다 |
| 축이 다르면 다른 종 | 라운드의 영속 status(4값)와 인메모리 phase(4값)는 **다른 축**이라 각각 센다. 바뀌는 빈도도 보는 주체도 다르다 |
| 라벨 집합만 센다 | 상한이 있는 정수 범위(choice_no 1~10 · 투표 시간 5~60초)는 라벨이 아니라 범위이므로 종수에 넣지 않는다 |
| 제외 | **에러 코드**는 [02_error_codes.md](./02_error_codes.md)가 소유하므로 여기서 세지 않는다. **소켓 종료 코드**는 도메인 값이 아니라 프로토콜 코드라 별도 절에만 싣고 종수에서 뺀다 |

**표기 규약**: DB 컬럼은 소문자 스네이크(waiting), 와이어는 대문자 스크리밍 스네이크(WAITING), 게임 내부 phase도 대문자다. 같은 값의 두 표기를 섞어 쓰지 않는다.

## 종수와 라벨 집계

| 그룹 | 종 | 라벨 |
|------|:--:|:----:|
| 방·참가자·연결 | 6 | 14 |
| 라운드·게임 종류 | 4 | 20 |
| 게임별 내부 phase | 6 | 48 |
| 입력·판정·결과 | 8 | 30 |
| 투표 | 1 | 4 |
| 방장 설정 | 6 | 16 |
| **합계** | **31** | **132** |

검산 — 종: 6 + 4 + 6 + 8 + 1 + 6 = **31**.
검산 — 라벨: 14 + 20 + 48 + 30 + 4 + 16 = **132**.

## 방·참가자·연결 (6종 · 라벨 14)

| # | 축 | 값 수 | 값 | 정본 |
|:-:|----|:----:|-----|------|
| 1 | 방 상태 — rooms.status · roomStatus | 2 | waiting(WAITING) · playing(PLAYING) | [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md) |
| 2 | 참가자 상태 — participants.status · memberStatus | 2 | pending(PENDING) · active(ACTIVE) | [../06_database/02_rooms_participants.md](../06_database/02_rooms_participants.md) |
| 3 | 참가자 역할 — participants.role | 2 | host · guest | [../06_database/02_rooms_participants.md](../06_database/02_rooms_participants.md) |
| 4 | 연결 상태 — member:connection의 state | 2 | ONLINE · UNSTABLE | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 5 | 방 폐기 사유 — room:closed의 reason | 3 | HOST_LEFT · LAST_MEMBER_LEFT · EXPIRED | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 6 | 참가자 퇴장 사유 — member:left의 reason | 3 | LEAVE · KICK · DISCONNECT | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |

검산: 2 + 2 + 2 + 2 + 3 + 3 = **14**.

- **방 상태에 종료·폐기 값이 없다.** 방이 사라지는 것은 rooms 행 삭제이므로 저장되는 상태가 되지 않는다. 폐기 사유는 폐기 순간의 room:closed 통지에만 실린다.
- **참가자 역할은 갱신되지 않는다.** 방장 권한 위임이 없으므로 host 행의 role은 생성 후 바뀌지 않는다.
- **연결 상태는 이탈이 아니다.** UNSTABLE은 유예에 들어갔다는 뜻이며 이탈 확정은 member:left 또는 room:closed로만 통지된다.
- 정원 계산은 pending과 active를 **합산**하고 명단 노출은 active만 한다.

## 라운드·게임 종류 (4종 · 라벨 20)

| # | 축 | 값 수 | 값 | 정본 |
|:-:|----|:----:|-----|------|
| 7 | 라운드 영속 상태 — game_rounds.status | 4 | ready · running · finished · cancelled | [../06_database/03_game_rounds.md](../06_database/03_game_rounds.md) |
| 8 | 라운드 종료 사유 — game_rounds.ended_reason | 6 | completed · host_left · last_member_left · room_expired · server_restart · error | [../06_database/03_game_rounds.md](../06_database/03_game_rounds.md) |
| 9 | 와이어 단계 — game:phase의 phase | 4 | READY · PLAYING · TIE · RESULT | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 10 | 게임 종류 — game_rounds.game_type · gameId | 6 | roulette · ladder · kingmaker · timer · snipe · nunchi | [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md) |

검산: 4 + 6 + 4 + 6 = **20**.

- **status와 phase는 다른 축이다.** status는 MySQL에 남는 영속 상태로 판당 두세 번 바뀌고 서버만 본다. phase는 인메모리이며 초 단위로 바뀌고 클라이언트의 화면 전환을 유일하게 지시한다. 라운드에 phase 컬럼을 두지 않는 이유가 이것이다.
- ended_reason은 진행 중일 때 NULL이며 finished·cancelled에서는 반드시 값을 갖는다.
- 와이어 phase 4값은 게임별 내부 phase를 **축약한 값**이다. 아래 절에 대응이 있다.

## 게임 ID와 접두사 대응

게임 6종을 가리키는 표기가 셋이다 — 문서 접두사(대문자) · 계약 gameId(소문자 슬러그) · 화면 코드.

| 문서 도메인 | 접두사 | 계약 gameId(API·DB) | 화면 코드 | 결과 형태 | 최소 인원 |
|-------------|--------|--------------------|-----------|-----------|:--------:|
| 운명의 룰렛 | WHEEL | roulette | WHEEL-PLAY | 승자형(WINNER) | 2 |
| 사다리타기 | LADDER | ladder | LADDER-PLAY | 배정형(ASSIGN) | 2 |
| 킹메이커 | KING | kingmaker | KING-PLAY | 개표형(TALLY) | 3 |
| 시간초 잡기 | TIMER | **timer** | TIMER-PLAY | 승자형(WINNER) | 3 |
| 익명 저격 | SNIPE | **snipe** | SNIPE-PLAY | 승자형(WINNER) | 3 |
| 눈치게임 | NUNCHI | nunchi | NUNCHI-PLAY | 기록형(RECORD) | 3 |

- 접두사 12종 전체의 정본은 [04_id_conventions.md](./04_id_conventions.md)이며, 위 표는 그중 게임 6종만 뽑아 계약 gameId·결과 형태와 함께 놓은 색인이다.
- **계약 gameId와 프로토타입 gameId가 둘 다르다.** frontend/src/lib/types.ts는 시간초를 timecatch로, 저격을 sniper로 쓴다. [04_id_conventions.md](./04_id_conventions.md)의 매핑표가 "대응 gameId(frontend)" 열에 싣는 값이 그것이며, **계약값은 timer·snipe**다([../07_api/01_conventions.md](../07_api/01_conventions.md) · [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md)). 구현 정정 대상이며 문서가 이긴다.
- 최소 인원의 정본은 [../05_game_rules/README.md](../05_game_rules/README.md)의 스펙 시트이고 [../07_api/02_rest.md](../07_api/02_rest.md)의 게임 메타가 같은 값을 싣는다. 최대 인원은 6종 모두 10이다.
- **서버 난수 2 · 참가자 투표 2 · 참가자 실력 2의 분류는 값 집합이 아니다.** 화면에 표시하지 않는 문서상 구분이라 enum으로 두지 않는다.

## 게임별 내부 phase (6종 · 라벨 48)

각 게임의 판정 엔진이 갖는 상태 집합이다. **여기에는 값 목록만 싣고 전이 규칙·(상태 × 이벤트) 전표·종료 증명은 정본 문서가 소유한다.**

| # | 게임 | 값 수 | 값 | 정본 |
|:-:|------|:----:|-----|------|
| 11 | 운명의 룰렛 | 6 | GUIDE · ARMED · SPINNING · REVEAL · RESULT · ABORTED | [../05_game_rules/02_roulette.md](../05_game_rules/02_roulette.md) |
| 12 | 사다리타기 | 6 | GUIDE · ARMED · DRAWING · REVEAL · RESULT · ABORTED | [../05_game_rules/03_ladder.md](../05_game_rules/03_ladder.md) |
| 13 | 킹메이커 | 10 | GUIDE · SUBMIT · VOTE · TIE_NOTICE · RUNOFF · TALLY · DEADLOCK · RESULT · VOID · ABORTED | [../05_game_rules/04_kingmaker.md](../05_game_rules/04_kingmaker.md) |
| 14 | 시간초 잡기 | 9 | GUIDE · RUNNING · TIE_NOTICE · REMATCH · REVEAL · DEADLOCK · RESULT · VOID · ABORTED | [../05_game_rules/05_timer.md](../05_game_rules/05_timer.md) |
| 15 | 익명 저격 | 9 | GUIDE · VOTE · TIE_NOTICE · RUNOFF · REVEAL · DEADLOCK · RESULT · VOID · ABORTED | [../05_game_rules/06_snipe.md](../05_game_rules/06_snipe.md) |
| 16 | 눈치게임 | 8 | GUIDE · ROUND · ROUND_RESULT · VOID_ROUND · REVEAL · RESULT · VOID · ABORTED | [../05_game_rules/07_nunchi.md](../05_game_rules/07_nunchi.md) |

검산: 6 + 6 + 10 + 9 + 9 + 8 = **48**.

**6종 전부에 있는 값**은 GUIDE · RESULT · ABORTED 셋이다. REVEAL은 킹메이커만 없고(그 자리를 TALLY가 대신한다), VOID는 룰렛·사다리에 없으며(결과 없이 끝나는 경로가 방장 이탈뿐이다), TIE_NOTICE와 DEADLOCK은 반복을 갖는 킹메이커·시간초·저격 셋에만 있다.

| 값 | 뜻 |
|----|-----|
| GUIDE | 규칙 가이드 3초. 다시 하기로 진입하면 건너뛴다 |
| ARMED | 방장의 실행 입력을 기다린다. 30초 뒤 서버가 자동 실행한다 |
| SPINNING · DRAWING | 확정된 결과로 수렴하는 연출 구간 |
| SUBMIT · VOTE · RUNNING · ROUND | 참가자 입력을 받는 구간 |
| TIE_NOTICE | 동점자 명단을 3초 보인다. 값은 아직 공개하지 않는다 |
| RUNOFF · REMATCH | 후보를 좁혀 다시 겨루는 반복 구간. 최대 3회다 |
| ROUND_RESULT | 눈치게임 라운드 판정을 3초 공개한다 |
| VOID_ROUND | 눈치게임 무효 라운드. 타이머 없이 방장 선택만 받는다 |
| REVEAL · TALLY | 결과를 공개하고 3초 뒤 결과 화면으로 넘어간다 |
| DEADLOCK | 반복 상한을 소진하고 자동 진행을 멈춘 상태. 방장 선택을 기다린다 |
| RESULT | 결과 화면. 방장의 다시 하기·대기방으로를 기다린다 |
| VOID | 결과 없이 끝난 상태 |
| ABORTED | 방장 이탈로 끝난 상태. 어느 상태에서도 즉시 진입하는 흡수 상태다 |

**내부 phase와 와이어 phase의 대응**은 다음과 같다. 클라이언트는 와이어 4값만 보고 화면을 전환하며 내부 값을 알지 못한다.

| 와이어 phase | 내부 phase |
|-------------|-----------|
| READY | GUIDE · ARMED |
| PLAYING | SUBMIT · VOTE · RUNNING · ROUND · SPINNING · DRAWING · ROUND_RESULT |
| TIE | TIE_NOTICE · RUNOFF · REMATCH · DEADLOCK · VOID_ROUND |
| RESULT | REVEAL · TALLY · RESULT · VOID · ABORTED |

- 대응이 다대일이므로 **같은 와이어 phase 안에서도 phaseSeq가 다르면 다른 단계다.** 킹메이커의 제출과 투표가 둘 다 PLAYING인 것이 그 예이며, 결선 회차 구분도 phaseSeq가 맡는다.
- 위 대응은 색인이며 전이 규칙의 정본은 각 게임 문서의 (상태 × 이벤트) 전표다.

## 입력·판정·결과 (8종 · 라벨 30)

| # | 축 | 값 수 | 값 | 정본 |
|:-:|----|:----:|-----|------|
| 17 | 입력 종류 — game:action의 type | 8 | roulette.pick · ladder.start · king.opinion · king.vote · timer.start · timer.stop · snipe.vote · nunchi.up | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 18 | 교착 선택 — game:decide의 choice | 4 | PICK · RANDOM · RETRY · ABORT | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 19 | 결정 요구 사유 — game:decision_required의 reason | 3 | TIE_EXHAUSTED · VOID_ROUND · NO_OPTION | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 20 | 결선 후보 종류 — game:tie의 candidateKind | 2 | MEMBER · OPTION | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 21 | 눈치 라운드 판정 — verdict | 4 | SAFE · OVERLAP · NO_INPUT · LAST | [../05_game_rules/07_nunchi.md](../05_game_rules/07_nunchi.md) |
| 22 | 시간초 기록 상태 — records의 status | 3 | recorded · no_start · no_stop | [../06_database/04_options_votes_results.md](../06_database/04_options_votes_results.md) |
| 23 | 시간초 판정값 출처 — records의 source | 2 | CLIENT_MEASURED · SERVER_OBSERVED | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 24 | 결과 화면 형태 — variant | 4 | WINNER · ASSIGN · TALLY · RECORD | [../02_features/06_result.md](../02_features/06_result.md) |

검산: 8 + 4 + 3 + 2 + 4 + 3 + 2 + 4 = **30**.

- **입력 종류는 게임이 늘어도 소켓 표면을 늘리지 않는 장치다.** 게임별로 이벤트를 나누지 않고 game:action 하나에 type을 분기시킨다. 폐기된 값은 ladder.pick · ladder.reveal · king.vote의 targetMemberId 셋이다.
- **교착 선택 4값이 전부 모든 사유에 열리지는 않는다.** TIE_EXHAUSTED는 PICK·RANDOM·ABORT를, VOID_ROUND와 NO_OPTION은 RETRY·ABORT를 연다. 서버가 내려준 options 안의 값만 받는다.
- **눈치게임의 verdict는 '탈락'을 담지 않는다.** SAFE가 혼자 눌러 후보에서 빠진 **안전 확정**, OVERLAP이 판정창 안에 겹쳐 **잔류**, NO_INPUT이 누르지 않아 잔류, LAST가 최후 1인이다. 용어 정의는 [01_domain_terms.md](./01_domain_terms.md)가 소유한다.
- **저장 표기와 와이어 표기가 다른 자리가 둘 있다.** 눈치 verdict는 result_data에 alone · overlapped · none으로, 사다리 speed는 fast · normal · slow로 소문자로 저장된다([../06_database/04_options_votes_results.md](../06_database/04_options_votes_results.md)). 시간초 판정 기준도 저장은 judgeMode의 closest · farthest이고 설정은 CLOSEST · FARTHEST다. 같은 축이므로 종수는 한 번만 센다.
- **결과 화면 형태의 한국어 이름과 영문 값이 1:1이다** — 승자형 WINNER · 배정형 ASSIGN · 개표형 TALLY · 기록형 RECORD. 게임 6종과의 대응은 위 「게임 ID와 접두사 대응」 표에 있다.

## 투표 (1종 · 라벨 4)

| # | 축 | 값 수 | 값 | 정본 |
|:-:|----|:----:|-----|------|
| 25 | 결선 차수 — votes.ballot_no | 4 | 1(본투표) · 2(결선 1회) · 3(결선 2회) · 4(결선 3회) | [../06_database/04_options_votes_results.md](../06_database/04_options_votes_results.md) |

- **상한 4는 반복 상한에서 나온다.** 본투표 1회 + 결선 최대 3회이므로 ballot_no의 최댓값이 4이며, CHECK가 그것을 넘지 못하게 한다. 종료가 보장되지 않는 반복이 DB 수준에서도 불가능하다.
- **choice_no는 라벨이 아니라 범위다**(1~10). 그 차수에서 몇 번째 표인지를 서버가 접수 순서대로 배정하며 상한 10은 방 정원에서 온다. 게임별 실제 상한(킹메이커 1~3표 · 저격 1~2표)은 앱이 강제한다.
- 결과 데이터의 ballotRounds는 실제로 진행한 결선 차수이며 votes.ballot_no의 최댓값과 같다.

## 방장 설정 (6종 · 라벨 16)

configSchema 16개 항목 중 **값 집합을 갖는 것은 6개**다. 나머지 10개는 문자열·문자열 배열·불리언·정수 범위라 라벨 집합이 아니다. 규칙의 의미 정본은 [../05_game_rules/01_common.md](../05_game_rules/01_common.md)이고 와이어 규격 정본은 [../07_api/03_socket_events.md](../07_api/03_socket_events.md)다.

| # | 축 | 값 수 | 값 | 기본값 |
|:-:|----|:----:|-----|--------|
| 26 | ladder.speed — 진행 속도 | 3 | FAST · NORMAL · SLOW | NORMAL |
| 27 | kingmaker.votesPerMember — 1인 투표 수 | 3 | 1 · 2 · 3 | 1 |
| 28 | timer.targetSeconds — 목표 시간(초) | 3 | 5 · 7 · 10 | 5 |
| 29 | timer.criterion — 판정 기준 | 2 | CLOSEST · FARTHEST | CLOSEST |
| 30 | nunchi.windowMs — 판정창(밀리초) | 2 | 300 · 500 | 300 |
| 31 | nunchi.roundSeconds — 라운드 제한 시간(초) | 3 | 10 · 15 · 20 | 15 |

검산: 3 + 3 + 3 + 2 + 2 + 3 = **16**.

라벨 집합이 아닌 설정 10개 — roulette.topic · ladder.resultItems · kingmaker.topic · kingmaker.revealAuthors · timer.topic · snipe.question · snipe.voteSeconds · snipe.multiVote · snipe.revealVoters · nunchi.topic. 6 + 10 = **16항**이며 이 총수의 정본은 [../07_api/03_socket_events.md](../07_api/03_socket_events.md)다.

- **ladder.speed는 결과에 영향을 주지 않는다.** 애니메이션 길이만 바꾼다.
- **nunchi.windowMs는 화면에 0.3초·0.5초로 보이지만 내부값은 300·500 정수다.** 초 단위 설정을 부동소수점 곱셈으로 환산하지 않는 이유는 [05_units_and_time.md](./05_units_and_time.md)에 있다.
- 게임을 바꾸면 설정이 기본값으로 초기화된다.

## 상태 머신 색인 (6본)

전이도·(상태 × 이벤트) 전표·가드는 전부 정본 문서가 소유한다. 여기서는 어디를 보면 되는지만 가리킨다.

| # | 상태 머신 | 상태 수 | 정본 |
|:-:|-----------|:------:|------|
| 1 | 방 상태 | 4구간(저장은 2값) | [../04_architecture/README.md](../04_architecture/README.md) — 05_room_state_machine.md |
| 2 | 참가자 수명주기 | 3단계 | [../06_database/02_rooms_participants.md](../06_database/02_rooms_participants.md) |
| 3 | 연결 상태 | 3단계 | [../04_architecture/02_realtime_websocket.md](../04_architecture/02_realtime_websocket.md) |
| 4 | 라운드 영속 상태 | 4 | [../06_database/03_game_rounds.md](../06_database/03_game_rounds.md) |
| 5 | 와이어 단계 | 4 | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 6 | 게임별 내부 phase | 6 · 9 · 9 · 10 · 6 · 8 | [../05_game_rules](../05_game_rules/README.md)의 게임별 6본 |

### 방 상태 — 4구간과 2값

**세는 기준이 둘이라 값이 어긋나 보인다.** 두 축을 구분한다.

| 축 | 값 | 어디에 있나 |
|----|-----|-----------|
| 기능 구간 | **대기 · 진행 · 결과 · 폐기** 4구간 | 상태별 허용 동작을 가르는 서술 축. 정본은 04_architecture의 05_room_state_machine.md |
| 저장·와이어 | **waiting · playing** 2값 | rooms.status와 roomStatus. 정본은 [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md) |

- **결과 구간은 저장 상태가 아니다.** 판정이 끝나도 방은 playing을 유지하며, 결과 구간인지는 라운드의 인메모리 phase가 RESULT인지로 판정한다. 방장이 대기방 복귀를 보내야 waiting으로 돌아간다.
- **폐기 구간도 저장 상태가 아니다.** 방 종료는 rooms 행 삭제이며 CLOSED 값을 두지 않는다. 폐기 사유는 room:closed의 reason 3값이 싣는다.
- 전이는 대기 → 진행 → 결과 → 대기이며, **방장 이탈은 어느 구간에서든 폐기로 보낸다.**
- 구간별 허용 동작의 기능 관점 요약은 [../02_features/07_common.md](../02_features/07_common.md)에, 동작별 상세 판정은 [../02_features/08_permission_matrix.md](../02_features/08_permission_matrix.md)에 있다. 둘 다 요약이며 정본이 아니다.

### 참가자 수명주기

코드 검증(상태 없음) → 슬롯 선점(**대기** · pending) → 프로필 확정(**활성** · active) → 퇴장(left_at 기록)이다. 대기 상태는 정원에 세지만 다른 사람 화면에 보이지 않는다. 활성으로 올라가는 순간 member:joined가 브로드캐스트된다.

### 연결 상태

연결(정상) → 의심(UNSTABLE) → 이탈 확정이다. 의심 진입은 pong 미수신·전송 실패·소켓 종료 관측이고, 같은 소켓에서 프레임이 도착하면 해제된다. **의심은 이탈이 아니며 유예 시간이 지나야 확정된다.** 유예 값의 정본은 [../04_architecture/02_realtime_websocket.md](../04_architecture/02_realtime_websocket.md)다.

## 소켓 종료 코드 (8종 · 종수 집계 제외)

도메인 값 집합이 아니라 프로토콜 코드이므로 위 31종에 넣지 않는다. 정본은 [../07_api/03_socket_events.md](../07_api/03_socket_events.md)다.

| 코드 | 뜻 |
|:----:|-----|
| 1000 | 명시적 퇴장 — 나가기 버튼 · 페이지 이탈 |
| 4002 | 프로토콜 위반 · 지원하지 않는 protocolVersion |
| 4401 | 인증 실패 · 토큰 무효 · 방 없음 |
| 4403 | 강퇴 |
| 4408 | 3초 안에 인증 프레임이 오지 않음 |
| 4409 | 같은 토큰에 이미 다른 소켓이 붙어 있음 |
| 4410 | 방 종료 — room:closed 직후 |
| 4413 | 프레임 상한 64KB 초과 |

1001 · 1006 등 비정상 종료는 코드가 아니라 유예 경로로 처리한다. 에러 코드와의 대응은 [02_error_codes.md](./02_error_codes.md)에 있다.

## enum 타입을 쓰지 않는다

**MySQL ENUM 타입 대신 VARCHAR + CHECK를 쓴다.** ENUM은 값 추가·삭제가 테이블 재작성을 부르고 순서가 암묵적 정렬 기준이 되어 의미 없는 비교를 허용한다. 근거의 정본은 [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md)다.

DB에 두지 않는 값 집합도 있다.

| 대상 | 처리 | 이유 |
|------|------|------|
| 라운드 phase | 인메모리 | 초 단위로 바뀌고 결선 회차마다 다시 바뀐다. 밀리초 판정 경로에 DB 왕복을 넣지 않는다 |
| 게임 설정값 | game_rounds의 config JSON | 게임마다 항목이 달라 컬럼으로 펴면 대부분이 NULL이 된다 |
| 결과 데이터 | game_results의 result_data JSON | 게임별 구조가 다르고 승자 컬럼을 두지 않기로 했다 |
| 결과 화면 형태 | 컬럼 없음 | game_type에서 파생한다. 저장할 값이 아니다 |

config와 result_data는 각각 schemaVersion 정수를 갖는다. **현재 전부 1이다.**

## 관련 문서

- [01_domain_terms.md](./01_domain_terms.md) — 안전 확정·잔류·판정창·명단 스냅샷 용어 정의
- [02_error_codes.md](./02_error_codes.md) — 상태 위반이 반환하는 에러 코드 전수
- [04_id_conventions.md](./04_id_conventions.md) — 접두사 12종과 gameId 매핑
- [05_units_and_time.md](./05_units_and_time.md) — 판정창·목표 시간의 단위 규약
- [../05_game_rules/README.md](../05_game_rules/README.md) — 게임별 상태 머신·판정 알고리즘·종료 증명 정본
- [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md) — DB 값 집합·CHECK 정본
- [../07_api/03_socket_events.md](../07_api/03_socket_events.md) — 와이어 값·configSchema·종료 코드 정본
- [README.md](./README.md) — 폴더 색인
