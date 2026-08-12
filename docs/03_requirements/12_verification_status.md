# 검증 회차 기록

> **대상**: 인수 기준 AC-01~120의 항목별 확인 상태
> **작성일**: 2026-08-12
> **원천**: [10_acceptance_criteria.md](./10_acceptance_criteria.md)(기준 정본) · backend/tests(전건 680건 통과) · backend/devtools/playthrough.py(연출 상수 실측) · frontend/src(화면 표면)

[10_acceptance_criteria.md](./10_acceptance_criteria.md)는 **기준 자체의 정본**이고, 본 문서는 그 기준이 **지금 어디까지 확인됐는지**를 싣는다. 기준이 바뀌면 저쪽을 고치고 여기의 판정을 다시 매긴다.

**확인하지 못한 것을 통과로 적지 않는다.** 자동 검증으로 분류한 항목은 그 기대 출력을 실제로 확인하는 테스트가 있고 CI에서 회귀가 잡히는 것만 해당한다.

## 판정 기호

| 기호 | 뜻 | 회귀 방지 |
|------|-----|----------|
| ✅ 자동 | 계약·도메인 테스트가 기대 출력을 확인한다 | CI가 잡는다 |
| 🔶 서버만 | 서버 몫은 자동 확인되고 화면 몫이 남았다 | 서버 부분만 잡는다 |
| 👁 수동 | 자동화되지 않았다. 사람이 확인해야 한다 | 없다 |
| 🖥 화면 | 서버가 관여하지 않는다. 프론트 단독 항목이다 | 없다 |

## 집계

| 판정 | 수 | 비고 |
|------|:--:|------|
| ✅ 자동 | 91 | QA가 다시 돌 필요가 없다 |
| 🔶 서버만 | 21 | 화면이 붙은 뒤 화면 몫만 확인한다 |
| 👁 수동 | 0 | AC-03 · AC-35가 계약 테스트로 옮겨가며 0이 됐다 |
| 🖥 화면 | 8 | 프론트 담당 확인 항목이다 |

91 + 21 + 0 + 8 = **120**.

**QA가 사람 손으로 돌아야 하는 것은 29건**(🔶 21 · 👁 0 · 🖥 8)이며, 그중 21건은 화면 몫만 남은 항목이라 서버 거동을 다시 확인할 필요가 없다.

## 방 만들기·입장 — AC-01~08

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-01 | ✅ | tests/contract/test_rest.py TestCreateRoom — 제목을 비우면 기본값 · 정원 생략하면 10 |
| AC-02 | ✅ | 같은 클래스 — 정원 범위 |
| AC-03 | ✅ | test_rest.py TestCreateRoom — 연속 20회 발급에 중복이 없고 6자리 형식이다 |
| AC-04 | ✅ | test_rest.py TestJoin — 정원은 PENDING을 포함해 센다 · tests/services/test_concurrency.py TestCapacityRace |
| AC-05 | 🔶 | 소켓 차단은 test_round.py — 진행 중에는 새 소켓이 붙지 않는다. **REST 입장 거절 경로는 미확인** |
| AC-06 | ✅ | test_rest.py TestConfirmProfile — 닉네임 중복은 접미로 해소한다 · 대소문자 · 앞뒤 공백 |
| AC-07 | ✅ | 같은 클래스 — 아바타를 생략하면 서버가 배정한다 · 선점된 아바타 |
| AC-08 | ✅ | test_sweeper.py TestPendingReclaim — 방치된 슬롯이 회수된다 |

## 대기방 — AC-09~16

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-09 | ✅ | test_round.py TestStartGuards — 준비하지 않은 참여자가 있으면 not_all_ready |
| AC-10 | ✅ | test_lobby.py TestMemberReady — 방장은 준비 상태를 갖지 않는다 · readyCount 모수에서 빠진다 |
| AC-11 | ✅ | 같은 클래스 — 스냅샷이 준비 상태를 싣는다 |
| AC-12 | 🔶 | test_lobby.py TestChatSend 길이 경계 · test_round.py 진행 중에도 채팅은 열려 있다. **네 시점 전수는 AC-117과 함께 화면에서 본다** |
| AC-13 | 🔶 | 서버 저장 없음은 스키마가 보장한다. **로컬 보관·복원은 F-LOBBY-08 미착수** |
| AC-14 | ✅ | test_leave.py TestKick 전건 |
| AC-15 | ✅ | test_round.py — 진행 중에는 게임을 바꾸거나 강퇴할 수 없다 |
| AC-16 | ✅ | test_sweeper.py 만료된 방이 삭제된다 · test_round.py 진행 중인 방은 만료로 지우지 않는다 |

## 게임 선택·설정 — AC-17~23

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-17 | ✅ | test_game_setup.py TestSelect — 인원이 모자라면 not_enough_members · 인원이 늘면 큰 게임도 고를 수 있다 |
| AC-18 | ✅ | 같은 파일 TestRandom — 서버가 고른 결과가 전원에게 같다 · 인원으로 시작할 수 없는 게임은 후보에서 뺀다 |
| AC-19 | ✅ | TestValidation — 규격을 벗어나면 거절한다 |
| AC-20 | ✅ | TestSelect — 게임을 바꾸면 설정이 기본값으로 돌아간다 |
| AC-21 | ✅ | TestConfig — 규격 위반은 invalid_config · 거절돼도 이전 설정이 남는다 |
| AC-22 | ✅ | test_round.py TestStartGuards 4종 · test_game_setup.py |
| AC-23 | 🔶 | test_play_again.py 가이드를 건너뛴다. **게임 도중 가이드 재열기는 화면 몫** |

## 게임 진행 공통 — AC-24~32

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-24 | ✅ | 게임별 두 번째 입력 거절 6종 — 룰렛 연타해도 판정은 한 번만 돈다 · 킹메이커 · 저격 · 시간초 · 눈치 |
| AC-25 | ✅ | test_game_play.py TestPick — 지난 단계의 입력은 stale_phase다. 기준도 stale_phase로 고쳐 일치한다(아래 갭 4는 해소됨) |
| AC-26 | ✅ | 같은 클래스 — 다른 판의 입력은 round_not_found다 |
| AC-27 | ✅ | test_game_kingmaker.py 제출 집계가 수치만 담는다 · test_game_snipe.py 집계에 지목 내용이 실리지 않는다 · test_game_nunchi.py 진행 중에는 집계가 나가지 않는다 |
| AC-28 | ✅ | test_game_kingmaker.py — 전원이 제출하면 마감 전에 투표로 간다 |
| AC-29 | 🔶 | test_round.py 명단 스냅샷은 이탈해도 바뀌지 않는다. **결과의 이탈 표시는 F-RESULT-09 미착수** |
| AC-30 | ✅ | test_socket.py 방장 이탈은 room_closed와 소켓 종료 · test_rest.py 방장이 나가면 방이 사라진다 |
| AC-31 | 🔶 | test_round.py 마감이 있는 단계는 틱이 흐른다. **두 기기 비교는 수동** |
| AC-32 | 🔶 | 전환 상수는 서버가 고정하고 devtools/playthrough.py가 6종 실측을 찍는다. **화면 전환 시각 일치는 수동** |

## 경계값 — AC-33~40

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-33 | ✅ | 계약 테스트가 6종을 각 게임 최소 인원으로 돌린다 |
| AC-34 | ✅ | test_game_setup.py 인원이 모자라면 not_enough_members · test_round.py 인원이 빠져 최소 미달이면 |
| AC-35 | ✅ | test_round.py TestCapacityBoundary — 게임 6종이 각각 정원 10명 최단 경로로 game:result까지 도달한다 |
| AC-36 | ✅ | 6종 전수 — 룰렛·사다리 서버 자동 실행 · 킹메이커 안건 0개 · 저격 전원 기권 난수 · 시간초 미시작 · 눈치 무효 라운드 |
| AC-37 | ✅ | test_game_nunchi.py 겹친 사람만 다음 라운드로 넘어간다 · 도메인 판정 테스트 |
| AC-38 | 🔶 | 명단 스냅샷 유지는 확인된다. **이탈 표시는 화면 몫** |
| AC-39 | ✅ | test_round.py 명단 스냅샷 · 최소 인원 검사가 시작 시점에만 걸린다 |
| AC-40 | ✅ | test_round.py 진행 중에는 새 소켓이 붙지 않는다 · 게임을 바꾸거나 강퇴할 수 없다 |

## 운명의 룰렛 — AC-41~49

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-41 | 🖥 | 조각 배치·강조는 화면이 그린다 |
| AC-42 | 🔶 | test_game_play.py SPINNING에 winnerIndex가 실린다. **회전 연출은 화면** |
| AC-43 | 🖥 | 두 기기 최종 회전각 일치 |
| AC-44 | 🖥 | 프레임 누락 후 스냅 |
| AC-45 | ✅ | test_game_play.py TestPick — 연타해도 판정은 한 번만 돈다 |
| AC-46 | ✅ | TestAutoRun — 방장이 누르지 않아도 서버가 실행한다 |
| AC-47 | ✅ | TestPick — 방장이 아니면 거절한다 |
| AC-48 | ✅ | TestPersistence — 저장된 시드로 결과가 재현된다 |
| AC-49 | 🔶 | 명단 유지는 확인된다. **이탈 표시는 화면 몫** |

## 사다리타기 — AC-50~59

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-50 | 🔶 | 서버는 레인 선택 단계를 두지 않는다. **세로선·항목 그리기는 화면** |
| AC-51 | ✅ | test_game_ladder.py TestItems — 항목이 모자라면 X로 채운다 |
| AC-52 | ✅ | 같은 클래스 — 항목이 넘치면 뒤에서 자른다 |
| AC-53 | ✅ | tests/contract/test_game_setup.py TestValidation — 규격을 벗어나면 거절한다 · 항목이 비면 거절한다 |
| AC-54 | ✅ | TestPersistence — 저장된 시드로 결과가 재현된다 |
| AC-55 | ✅ | TestResult 배정이 1대1 대응이다 · 도메인 테스트 49건 |
| AC-56 | ✅ | tests/domain/test_ladder.py — 항등 순열에서도 가로선이 놓인다 |
| AC-57 | 🖥 | 픽셀 좌표는 다르되 배정이 같다 |
| AC-58 | ✅ | TestSpeed — 속도가 DRAWING 길이를 정한다 |
| AC-59 | ✅ | TestStart 방장이 누르지 않아도 서버가 실행한다 · 방장 이탈 |

## 킹메이커 — AC-60~75

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-60 | ✅ | test_game_kingmaker.py TestResult — 와이어 모양이 정본과 같다 |
| AC-61 | ✅ | TestBranch — 후보 순서를 섞어 내려보낸다 |
| AC-62 | ✅ | TestVote — 자기 안건에는 투표할 수 없다 |
| AC-63 | ✅ | TestVote — 실효 상한을 넘기면 거절한다 |
| AC-64 | ✅ | tests/domain/test_kingmaker.py |
| AC-65 | ✅ | TestVote — 같은 안건을 두 번 담으면 거절한다 |
| AC-66 | ✅ | TestRunoff — 동점이면 결선으로 가고 1인 1표가 된다 |
| AC-67 | ✅ | 같은 클래스 |
| AC-68 | ✅ | test_game_kingmaker.py TestRunoff — 결선 3회 소진이 교착이다 · TestDecide — RETRY로 안건 제출부터 다시 연다 |
| AC-69 | ✅ | TestBranch — 안건이 없으면 방장이 고른다 |
| AC-70 | ✅ | TestBranch — 안건이 하나면 투표 없이 확정한다 |
| AC-71 | ✅ | tests/domain/test_kingmaker.py 전원 기권 |
| AC-72 | ✅ | TestResult — 익명이면 제출자 자리가 아예 없다 |
| AC-73 | ✅ | TestResult — 실명이면 개표 후에 제출자가 나온다 · 투표자는 어느 설정에서도 나가지 않는다 |
| AC-74 | ✅ | TestSubmit — 두 번째 제출은 거절한다 |
| AC-75 | ✅ | 마감 이후 입력 거절 공통 경로 |

## 시간초 잡기 — AC-76~89

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-76 | ✅ | test_game_timer.py TestCriterion — 가장 가까운 사람이 이긴다 |
| AC-77 | ✅ | 같은 클래스 — 가장 먼 사람 기준에서도 순위표는 그대로다 |
| AC-78 | 🖥 | 경과 시간 가리기는 화면 |
| AC-79 | ✅ | TestInput — 두 번째 START는 거절한다 |
| AC-80 | ✅ | TestUnfinished — 아무것도 안 누르면 미시작이다 |
| AC-81 | ✅ | TestUnfinished — START만 하면 미정지다 |
| AC-82 | 🔶 | TestUnfinished 순위표가 유효·미정지·미시작 순이다. **기준이 낡았다(아래 갭 2)** |
| AC-83 | ✅ | TestCriterion · TestUnfinished |
| AC-84 | 🔶 | TestMeasure 서버 관측과 크게 다르면 대체한다. **기준이 낡았다(아래 갭 2)** |
| AC-85 | ✅ | TestMeasure — 신고값이 서버 관측과 맞으면 그대로 쓴다 |
| AC-86 | ✅ | TestInput — START 없이 STOP은 받지 않는다 |
| AC-87 | ✅ | TestRematch — 동점이면 재대결로 간다 |
| AC-88 | ✅ | test_game_timer.py TestRematch — 재대결 3회 소진이 교착이다 · TestDecide — RETRY로 본판을 다시 연다 |
| AC-89 | ✅ | tests/domain/test_timer.py 정렬 전건 |

## 익명 저격 — AC-90~98

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-90 | ✅ | test_game_snipe.py TestBallot — 자기 지목은 거절한다 |
| AC-91 | ✅ | TestBallot — 중복 투표가 꺼져 있으면 상한이 1이다 |
| AC-92 | ✅ | TestBallot — 상한을 넘기면 거절한다 |
| AC-93 | ✅ | TestTally · TestProgress |
| AC-94 | 🔶 | TestTally 단독 최다가 승자다. **지목선 연출은 화면** |
| AC-95 | ✅ | TestRunoff — 동점이면 game_tie가 나가고 RUNOFF로 간다 |
| AC-96 | ✅ | TestRunoff — 결선 3회를 소진하면 교착이다 · TestDecide |
| AC-97 | ✅ | TestTally — 전원 기권이면 난수로 확정한다 |
| AC-98 | ✅ | TestResult — 지목자가 어디에도 나가지 않는다 |

## 눈치게임 — AC-99~107

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-99 | ✅ | test_game_nunchi.py TestRounds · tests/domain/test_nunchi.py |
| AC-100 | ✅ | 도메인 판정창 경계 테스트 |
| AC-101 | ✅ | 도메인 판정창 설정값 테스트 |
| AC-102 | ✅ | TestInput 자격 없는 입력 거절. **기준의 에러 코드가 폐기된 이름이다(아래 갭 1)** |
| AC-103 | ✅ | TestInput — 같은 라운드에 두 번 누르면 거절한다 |
| AC-104 | ✅ | TestResult — 최후 1인이 LAST로 표시된다 |
| AC-105 | ✅ | TestVoidRound — 아무도 안전하지 않으면 방장이 고른다 |
| AC-106 | ✅ | 같은 클래스 · 도메인 종료 증명 테스트 |
| AC-107 | 🔶 | TestResult 저장 형식이 정본과 같다(명단 4종 포함). **라운드 기록 표는 화면** |

## 결과·저장 — AC-108~113

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-108 | 🔶 | 6종 와이어 모양이 정본과 같다는 계약 테스트가 있다. **결과 화면 표시는 화면 몫이며 변형 매핑이 어긋나 있다** |
| AC-109 | 🖥 | 결과 이미지 저장 규격 |
| AC-110 | ✅ | test_play_again.py TestPlayAgain 전건 · TestRejected 참여자는 다시 할 수 없다 |
| AC-111 | ✅ | TestRejected — 인원이 줄면 거절한다 |
| AC-112 | ✅ | test_round.py TestClose — 복귀하면 준비가 전부 해제된다 |
| AC-113 | 🔶 | 재열람 API가 없음은 확인된다. **방 삭제 시 동반 삭제는 AC-119와 함께 본다** |

## 공통·오류 — AC-114~120

| AC | 판정 | 근거 |
|----|:----:|------|
| AC-114 | 🖥 | 재접속 안내 문구 |
| AC-115 | 🔶 | 세 사유의 서버 코드는 갈라져 있다. **문구 구분은 F-CMN-04 미착수** |
| AC-116 | 🔶 | 방장 전용 이벤트 개별 거절은 확인된다. **7종 전수와 비브로드캐스트 확인은 미실시** |
| AC-117 | 🔶 | 상태별 거절이 게임별 테스트에 흩어져 있다. **상태 × 동작 전수 대조표는 미실시** |
| AC-118 | ✅ | tests/services/test_concurrency.py TestProgressOrder — 늦게 도착한 작은 집계는 버린다 · 버린 프레임은 roomVersion을 쓰지 않는다 |
| AC-119 | 🔶 | 채팅 미저장·개인정보 미수집은 스키마가 보장한다. **삭제 후 0행 확인은 미실시** |
| AC-120 | 🖥 | 반응형·터치 표적 규격 |

## 비기능 실측 — REQ-NFR-01

REQ-NFR-01은 왕복(클라이언트 시계 기준)과 서버 내부 처리 지연(서버 시계 기준) 두 축을 요구한다. 두 축 모두 각자 시계 하나만 써서 기기 간 시각 동기 문제를 피한다.

### 왕복 — 클라이언트 시계 기준

2026-08-12에 backend/devtools/latency.py로 5경로 각 100회, 합 500 표본을 냈다. 측정값은 **요청 전송 시각과 그 결과 프레임 도착 시각의 차이**이며 두 값 모두 측정 프로세스의 단조 시계 하나로 읽는다.

| 경로 | p50 | p95 | p99 | 최대 |
|------|----:|----:|----:|-----:|
| 준비 상태 | 4.1 | 5.3 | 8.0 | 8.0 |
| 채팅 | 3.4 | 4.2 | 6.9 | 6.9 |
| 설정 변경 | 4.0 | 4.4 | 4.8 | 4.8 |
| 입장 | 8.7 | 10.3 | 12.8 | 12.8 |
| 퇴장 | 7.2 | 8.6 | 12.6 | 12.6 |
| **전 경로** | **4.2** | **9.1** | **10.7** | **12.8** |

단위는 밀리초다. 왕복 판정선인 p95 1000밀리초를 다섯 경로 모두 통과한다.

### 서버 내부 처리 지연 — 서버 시계 기준

이번 회차에 계측 코드를 넣어 쟀다. app/ws/router.py의 _dispatch — 프레임 도착부터 처리 완료까지 — 를 서버 단조 시계 하나로 감싸며, 성공·실패 응답을 모두 포함하고 상태 게이트조차 타지 않는 미등록 이벤트는 뺀다. 계측 모듈은 app/infra/metrics.py(신규)이고, 새 스위치를 두지 않고 기존 devtools_enabled를 그대로 쓴다 — 배포 기본값(docker-compose.yml)이 이미 꺼져 있어 운영 환경에는 영향이 없다.

| 경로 | p95 |
|------|----:|
| 준비 상태 | 6.0 |
| 채팅 | 4.0 |
| 설정 변경 | 5.0 |

단위는 밀리초다. 판정선 100밀리초 대비 17~25배 여유가 있다. 입장·퇴장은 REST 경로라 _dispatch를 타지 않아 이 축에 없다 — 그 둘의 지연은 위 왕복 표가 담당한다.

**이 두 축을 합쳐 REQ-NFR-01 통과로 적지 않는다.** 남은 것은 네트워크 구간 하나뿐이다.

| 빠진 것 | 내용 |
|---------|------|
| 네트워크 구간 | 왕복 측정이 루프백이라 실제 사용자와 서버 사이의 지연이 0이다. 배포 환경에서 다시 잰다 |

## 기준과 구현이 어긋난 지점 — 6건(전부 해소)

확인 과정에서 나왔다. 여섯 건 모두 닫혔다 — 넷(1 · 2 · 4 · 6)은 기준 문서 쪽이 낡아 실제 구현에 맞춰 고쳤고, 하나(3)는 처음부터 갭이 아니었던 오독이었으며, 하나(5)는 눈치 승패 구조 개정(D-38)으로 그 상태 자체가 정상 경로에서 사라져 해소됐다.

| # | 항목 | 내용 |
|:-:|------|------|
| 1 | ~~AC-102의 에러 코드~~ | **해소됐다.** 10_acceptance_criteria.md가 2026-08-12자 개정에서 AC-102의 기대 에러 코드를 game.eliminated에서 game.not_eligible로 이미 고쳤다. [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)가 game.eliminated를 폐기하고 game.not_eligible로 통일한 정본이며, 구현과 소켓 정본도 not_eligible이다 |
| 2 | ~~AC-82 · AC-84의 기록 무효~~ | **해소됐다.** 10_acceptance_criteria.md가 2026-08-12자 개정에서 AC-82 · AC-84를 이미 서버 관측값으로 판정 서술로 고쳤다 — [../05_game_rules/05_timer.md](../05_game_rules/05_timer.md)가 2026-08-11에 대조 실패 처리를 기록 무효에서 서버 관측값으로 판정으로 정정하고 기록 상태를 4값에서 3값으로 줄인 것에 맞춘 결과다 |
| 3 | ~~AC-53의 항목 0개~~ | **해소됐다.** 서버는 빈 목록을 이미 game.invalid_config로 거절한다. 처음에 갭으로 적은 것은 오독이었다 — 계약 테스트 이름이 항목 개수는 막지 않는다였고 실제로는 1개 허용을 확인하는 테스트였다. 이름을 항목이 참가자 수와 달라도 된다로 고치고 빈 목록 거절 테스트를 새로 두었다. [../07_api/03_socket_events.md](../07_api/03_socket_events.md)의 "개수 자체는 막지 않는다"는 서술도 참가자 수와의 일치로 좁혔다 |
| 4 | ~~AC-25의 에러 코드~~ | **해소됐다.** 구현이 옳고 기준이 틀렸다 — [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)가 game.round_already_ended(같은 라운드가 끝난 것)와 game.stale_phase(라운드는 같은데 단계·결선 회차가 지난 것)를 명시적으로 가른다. AC-25 시나리오는 단계 마감 시각 1밀리초 뒤라 라운드는 살아 있고 단계만 넘어갔으므로 stale_phase가 맞다. 10_acceptance_criteria.md가 AC-25의 기대 결과를 game.stale_phase로 이미 고쳤다 |
| 5 | ~~눈치 잔류 0명의 결과 표현~~ | **해소됐다.** 승패 구조 개정(D-38, 2026-08-12)으로 잔류자가 한 명 남는 순간 라운드가 끊겨 잔류 0이 정상 경로에서 사라졌고, 최후 1인은 안전 확정자 목록에 들어가지 않는다 |
| 6 | ~~게임별 설정 표의 기본값 두 자리(주제·질문 · 사다리 도착 항목)~~ | **해소됐다.** [../05_game_rules/01_common.md](../05_game_rules/01_common.md)의 「게임별 설정」 표가 두 자리에서 구현과 다른 기본값을 적어 뒀다. **(a) 주제·질문** — 6종 전부 채워진 기본값을 적었으나(룰렛 팀장 · 사다리 조별과제 · 킹메이커 팀명 · 시간초 팀장 · 저격 발표를 제일 잘할 것 같은 사람은? · 눈치 팀장), 구현(backend/app/domain/game_config.py:56~61)은 처음부터 6종 전부 빈 문자열이다 — 값을 미리 채우면 방장이 지우지 않고 남의 판 문구를 그대로 쓰는 사고가 나서다. **(b) 사다리 도착 항목** — 조별과제 세트 6항목을 적었으나, 구현(game_config.py:23~26)은 팀장 한 칸뿐이다 — 인원보다 많은 칸을 미리 채우면 방장이 지우기 전까지 설정 화면이 인원과 어긋난 목록을 보여줘서다. 둘 다 설정 화면이 예시·안내로 보완하므로 구현 쪽 판단이 나중이고 더 구체적이다. 그쪽으로 닫아 01_common.md의 두 기본값을 고쳤다. (a)는 저격 결과 화면의 질문 밴드가 비어 나오는 실연동에서, (b)는 6인 방에서 항목이 한 칸뿐이라 방장만 팀장을 받고 나머지 다섯이 X로 채워지는 실연동에서 각각 드러났다 — 그 X 채우기 자체는 AC-51대로의 정상 동작이라 결함이 아니다. (a)의 여파로 10_acceptance_criteria.md:69의 AC-20 표현도 함께 맞췄다 — "주제도 D 계열 기본값으로 돌아와 있다"를 "주제(질문)는 빈 값으로 돌아와 있다. 템플릿 칩은 그대로 있어 다시 누르면 값이 들어간다"로 고쳤다 |

## 결함이 아님을 확인한 것

| 항목 | 확인 내용 |
|------|----------|
| 게임 중 방장 이탈의 ABORTED 단계 | 게임 6종의 상태 머신과 [../10_glossary/03_enums_state_machines.md](../10_glossary/03_enums_state_machines.md)가 ABORTED를 흡수 상태로 정의하고 서버는 그 단계 프레임을 발행하지 않는다. **[../07_api/03_socket_events.md](../07_api/03_socket_events.md)는 ABORTED를 한 번도 언급하지 않아 발행을 요구하지 않으며**, [../05_game_rules/02_roulette.md](../05_game_rules/02_roulette.md)가 "방이 삭제되므로 어떤 상태에서도 즉시 이 상태로 간다"고 규정한다. 방 삭제와 소켓 종료가 그 전이를 대신하므로 구현과 기준이 어긋나지 않는다 |

## 다음 회차에서 좁힐 것

| 항목 | 내용 |
|------|------|
| AC-116 · AC-117 · AC-119 | 전수 대조표 형태라 표를 만들어 한 번에 확인한다 |

## 관련 문서

- 인수 기준 정본 → [10_acceptance_criteria.md](./10_acceptance_criteria.md)
- 요구사항 정본 → [README.md](./README.md)
- 게임 규칙·경계값 → [../05_game_rules/README.md](../05_game_rules/README.md)
- 에러 코드 정본 → [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)
- 기능 구현 상태 → [../02_features/README.md](../02_features/README.md)
