# 06_transactions_concurrency — 트랜잭션·동시성

> **대상**: ModuPick — 트랜잭션 경계·잠금 순서·격리 수준·멱등 성립 근거·경쟁 조건별 처리·서버 재기동 정리
> **작성일**: 2026-08-02
> **원천**: git 529e312 docs/db.md §11 상태 머신·기본 처리 원칙 · §12 트랜잭션·동시성·멱등성 상세 · v0.5 §8 트랜잭션·동시성 ·「Backend에서 반드시 지켜야 하는 잠금 순서」 · git 529e312 docs/api.md(2026-07-29 추가 확정 — PENDING 슬롯 3분 · PLAYING 중 만료 타이머 정지) · docs_legacy/requirements.md §5 NFR-01·NFR-04 · §6 D-13 · [05_constraints_integrity.md](./05_constraints_integrity.md)

제약이 못 잡는 것 — **정원 · 권한 · 상태 전이 · 최소 1명** — 은 전부 트랜잭션이 잡는다. 백엔드가 단일 인스턴스·워커 1개라 분산 잠금이 필요 없고, 경쟁하는 행만 짧게 잠그면 된다.

이 문서를 관통하는 규칙은 셋이다. **잠금 순서를 뒤집지 않는다** · **커밋 전에 이벤트를 보내지 않는다** · **밀리초 판정 경로에 트랜잭션을 두지 않는다**.

## 격리 수준과 잠금 원칙

| 항목 | 기준 |
|------|------|
| 격리 수준 | InnoDB 기본 **REPEATABLE READ**를 그대로 쓴다. 세션에서 바꾸지 않는다 |
| 잠금 | 경쟁이 실제로 일어나는 **rooms·game_rounds 행만** SELECT ... FOR UPDATE로 짧게 잠근다 |
| 트랜잭션 안에서 금지 | 외부 API 호출 · WebSocket 전송 · 대기(sleep) · 사용자 입력 대기 |
| 트랜잭션 밖에서 먼저 | 입력 길이·형식·JSON 스키마 검증. **상태·권한·정원은 잠근 뒤 다시 확인한다** |
| 세션 수명 | WebSocket 연결 하나가 DB 세션을 계속 점유하지 않는다. 이벤트 처리마다 짧게 열고 즉시 풀에 반환한다 |
| 재시도 | deadlock 또는 lock wait timeout이면 **트랜잭션 전체를 최대 3회** 짧은 무작위 지연과 함께 재시도한다. 3회 후에도 실패하면 오류로 응답한다 |
| 커밋 후 발행 | 모든 DB 변경 이벤트는 **커밋이 성공한 뒤에만** 발행한다. 전송이 실패해도 커밋을 되돌리지 않고 기록한 뒤 해당 소켓을 종료한다 |

**REPEATABLE READ에서 반복 조회가 옛 스냅샷을 보는 문제**는 잠금 읽기로 피한다. SELECT ... FOR UPDATE는 최신 커밋된 행을 읽으므로, 정원 카운트처럼 다른 트랜잭션의 변경을 반드시 봐야 하는 조회는 rooms 행을 잠근 뒤에 한다.

## 잠금 순서

**모든 트랜잭션이 같은 순서로 잠근다.** 순서가 트랜잭션마다 다르면 deadlock이 난다.

```
rooms
  → game_rounds
    → participants
      → game_options
        → votes / game_results
  → commit
    → WebSocket 이벤트 발행
```

- 모든 단계를 잠글 필요는 없다. **건너뛰는 것은 되지만 뒤로 돌아가는 것은 안 된다** — participants를 잠근 뒤 rooms를 잠그는 트랜잭션을 만들지 않는다.
- 같은 테이블에서 여러 행을 잠글 때는 **PK 오름차순**으로 잠근다. 예를 들어 만료 스윕이 여러 방을 처리할 때는 rooms.id 순서로 한 방씩 별도 트랜잭션으로 처리한다.
- 잠금 없이 읽어도 되는 조회(게임 메타·정적 목록)는 트랜잭션을 열지 않는다.

## 트랜잭션 전수

| # | 작업 | 잠금 | 한 트랜잭션에서 하는 일 | 커밋 후 |
|:-:|------|------|----------------------|--------|
| 1 | 방 생성 | 없음(INSERT) | 초대 코드 생성 → rooms INSERT → PENDING host INSERT | 방 정보·방장 토큰 응답 |
| 2 | 코드 검증 | 없음(읽기) | code로 방 조회. 만료 시각이 지났으면 **#13으로 넘겨 삭제한 뒤** 만료로 응답 | 입장 가능 여부 응답 |
| 3 | 가입(PENDING) | rooms FOR UPDATE | 만료된 PENDING 회수 → 상태·만료 재확인 → 현재 인원 카운트 → PENDING guest INSERT(pending_expires_at = NOW() + 3분) | 참가자 토큰 응답 |
| 4 | 프로필 확정(ACTIVE) | rooms → participants FOR UPDATE | 닉네임·아바타 중복 확인 → nickname·avatar_id·bio 저장 → status = active · pending_expires_at = NULL | **참가 이벤트 발행** |
| 5 | 프로필 수정 | rooms → participants FOR UPDATE | 활성 UNIQUE 재검사 후 UPDATE | 프로필 갱신 이벤트 |
| 6 | 개별 퇴장·강퇴·연결 종료 | rooms → participants FOR UPDATE | left_at 갱신. **방장이 나가거나 활성 참가자가 0명이 되면 #13으로 이어 방 삭제** | 이탈 이벤트 또는 방 종료 이벤트 |
| 7 | 게임 시작 | rooms → (game_rounds) FOR UPDATE | 방 waiting·방장 본인·최소 인원·전원 준비 확인 → game_rounds INSERT(ready) → game_options INSERT → rooms.status = playing · last_activity_at 갱신 | 게임 시작 이벤트 |
| 8 | 입력 개시(ready → running) | game_rounds FOR UPDATE | status = running · started_at 기록 | phase 전이 이벤트 |
| 9 | 킹메이커 의견 제출 | 없음(INSERT) | game_options INSERT. UNIQUE 충돌이면 **기존 행을 조회해 같은 성공 응답** | 제출 완료 표시 |
| 10 | 투표 접수 | 없음(INSERT) | votes INSERT. UNIQUE 충돌이면 기존 행을 조회해 같은 성공 응답 | 투표 완료 표시 |
| 11 | 결과 확정 | game_rounds FOR UPDATE | status 확인 → game_results INSERT → status = finished · ended_at · ended_reason = completed | **결과 이벤트 발행** |
| 12 | 대기방 복귀 | rooms FOR UPDATE | rooms.status = waiting · last_activity_at·expires_at 갱신 | 대기방 복귀 이벤트 |
| 13 | 방 삭제 | rooms FOR UPDATE | 진행 중 라운드를 cancelled로(ended_at·ended_reason) → rooms DELETE(하위 CASCADE) | 방 종료 이벤트 |
| 14 | 만료 스윕 | 방마다 rooms FOR UPDATE | 대상 방을 골라 방별로 #13 실행 | 남은 소켓에 방 종료 이벤트 |
| 15 | PENDING 회수 스윕 | rooms → participants FOR UPDATE | pending_expires_at <= NOW()인 PENDING의 left_at 갱신. **대상이 방장이면 #13** | 필요 시 방 종료 이벤트 |
| 16 | 기동 정리 | 없음(일괄) | 남은 진행 라운드 전부 cancelled → 모든 rooms DELETE | 없음(연결이 없다) |

- **#9·#10에 행 잠금이 없다.** 회차를 잠그면 열 명의 투표가 직렬화되어 응답이 늘어진다. 중복·초과는 UNIQUE와 인메모리 잔여 표 카운트가 막으므로 잠금이 필요 없다.
- **#11은 반드시 회차를 잠근다.** 결과 확정은 되돌릴 수 없는 전이이고 두 테이블을 함께 바꾼다.
- **#2가 삭제를 유발할 수 있다.** 만료 시각이 지났지만 스윕이 아직 오지 않은 방을 조회하면 그 자리에서 삭제한 뒤 만료로 응답한다. 삭제된 코드와 없던 코드의 응답을 구별하지 않는다.
- **#7에서 rooms.status를 playing으로 바꾸면 만료 타이머가 멈춘다.** 만료 스윕은 waiting인 방만 보기 때문이다.
- 밀리초 판정 입력(눈치 UP · 시간초 START·STOP · 룰렛 PICK · 사다리 START)은 **표에 없다.** DB를 건드리지 않기 때문이다.

## 멱등 성립 근거

**멱등 키 컬럼을 두지 않는다.** git 529e312 docs/db.md v0.4는 rooms.create_request_id와 votes.request_id를 NOT NULL UNIQUE로 뒀는데 API 요청에는 그 필드가 없어 구현이 불가능했고, v0.5가 두 컬럼을 제거했다. 본 설계는 v0.5를 따르고 **자연 키 UNIQUE로 멱등을 성립시킨다.**

| 요청 | 멱등 성립 근거 | 재전송의 결과 |
|------|--------------|-------------|
| 방 생성 | **없다** | 방이 하나 더 생긴다. 아래 별도 항 참조 |
| 가입 | **없다** | PENDING 슬롯이 하나 더 잡힌다. 3분 뒤 회수된다 |
| 프로필 확정·수정 | 같은 값 UPDATE는 자연 멱등 | 결과가 같다 |
| 퇴장·강퇴 | left_at이 이미 차 있으면 성공으로 처리 | 결과가 같다 |
| 게임 시작 | uq_game_rounds_active | 진행 중 판이 이미 있어 거절된다 |
| 킹메이커 의견 제출 | uq_game_options_round_participant | 기존 행을 조회해 같은 성공 응답 |
| 투표(1인 1표) | uq_votes_ballot (choice_no가 항상 1) | 기존 행을 조회해 같은 성공 응답 |
| 투표(다표) | 인메모리 잔여 표 카운트 | 표가 남아 있으면 **새 표로 인정된다**. 아래 별도 항 참조 |
| 결과 확정 | uq_game_results_round | 기존 결과를 반환 |
| 대기방 복귀 | 이미 waiting이면 성공으로 처리 | 결과가 같다 |
| 방 삭제 | 행이 없으면 성공으로 처리 | 결과가 같다 |

### 방 생성·가입에 멱등 키를 두지 않은 판단

API 계약에 멱등 키 필드가 없고, 그것을 새로 요구하면 클라이언트·서버·문서 세 곳의 계약이 바뀐다. 그 비용에 견줘 **재전송의 실제 피해가 작다**는 것이 판단의 근거다.

| 축 | 방 생성 재전송 | 가입 재전송 |
|----|--------------|-----------|
| 생기는 것 | 참가자 0명인 방 1개 | PENDING 슬롯 1개 |
| 회수 | 10분 무활동 만료 | 3분 뒤 PENDING 회수 |
| 사용자에게 보이는 피해 | 없다(응답은 하나만 받는다) | 정원 1칸이 최대 3분 잠긴다 |
| 완화 | 클라이언트가 응답 수신 전 버튼을 잠근다 | 위와 같다 |

**정원이 작은 방(2명)에서 가입 재전송이 나면 3분 동안 한 자리가 잠긴다는 것이 이 판단의 대가다.** 그 대가를 감수하는 이유는 대안(멱등 키 도입)이 계약 변경을 부르고, 클라이언트가 응답 전 재요청을 하지 않는 것으로 사실상 막히기 때문이다.

### 다표 투표의 재전송

1인 1표 게임에서는 choice_no가 항상 1이라 재전송이 UNIQUE에 흡수된다. **다표 설정에서는 흡수되지 않는다** — 같은 대상에 두 번 클릭한 것과 재전송을 구별할 정보가 요청에 없기 때문이다. 그래서 다표 게임에서는 **표를 하나 쓸 때마다 남은 표 수를 응답으로 알리고 화면이 그것을 표시한다.** 표를 다 쓰면 다음 입력은 DB에 닿기 전에 거절된다.

## 경쟁 조건별 처리

| 경쟁 | 언제 | 처리 | 무엇이 막는가 |
|------|------|------|-------------|
| **동시 입장 — 마지막 한 자리** | 남은 자리 1개에 여러 명이 동시에 가입 | rooms 행을 FOR UPDATE로 잠가 **인원 카운트와 INSERT를 직렬화**한다. 늦은 요청은 정원 초과로 거절 | 잠금(#3) |
| **정원 초과** | PENDING이 남아 슬롯을 물고 있을 때 | 카운트 전에 만료된 PENDING을 먼저 회수한다. 카운트는 left_at IS NULL인 PENDING+ACTIVE 합산 | 잠금 + 회수 순서(#3) |
| **동시 닉네임·아바타 선점** | 두 명이 같은 닉네임·아바타로 동시에 프로필 확정 | 잠금 뒤 중복 조회로 대부분 걸러지고, 마지막 경합은 생성 컬럼 UNIQUE가 끊는다 | uq_participants_active_nickname · uq_participants_active_avatar |
| **동시 게임 시작** | 방장이 두 번 눌렀거나 두 소켓에서 시작 요청 | rooms를 잠근 뒤 진행 중 판을 확인하고, 그래도 통과한 두 번째는 UNIQUE가 끊는다 | uq_game_rounds_active |
| **중복 투표** | 같은 표를 두 번 보냄 | UNIQUE 충돌을 잡아 기존 행을 조회해 같은 성공 응답을 돌려준다 | uq_votes_ballot |
| **다른 회차 선택지 투표** | 이전 판의 선택지 ID로 투표 | INSERT가 FK에서 거부된다 | fk_votes_option |
| **다른 방 참가자 참조** | 잘못된 ID 조합 | INSERT가 복합 FK에서 거부된다 | 복합 FK 3종 |
| **동시 결과 확정** | 판정 완료 신호가 겹침 | 회차를 잠그고 상태를 다시 본다. 통과한 두 번째는 UNIQUE가 끊고 기존 결과를 반환 | uq_game_results_round |
| **끝난 판에 도착한 입력** | 마감 뒤 도착 | 인메모리 phase가 RESULT·종료면 DB에 닿기 전에 버린다 | 인메모리 phase |
| **이전 라운드 입력** | 새 판이 시작된 뒤 옛 roundId로 도착 | round_id 대조 후 버린다 | 인메모리 + 회차 조회 |
| **만료 스윕과 사용자 요청** | 스윕이 방을 지우는 사이 사용자가 입장 | 스윕이 rooms를 잠그고 만료 조건을 다시 확인한다. 스윕이 이기면 사용자 요청은 없는 방으로 응답 | 잠금 + 조건 재검증(#14) |
| **스윕 중복 실행** | 스윕이 겹쳐 돌아감 | 방 삭제는 행이 없으면 성공이므로 중복 실행해도 최종 상태가 같다 | 멱등 |
| **방장 이탈과 결과 확정** | 결과 확정 중 방장이 나감 | 둘 다 rooms를 먼저 잠그므로 직렬화된다. 방 삭제가 먼저 이기면 결과는 저장되지 않고 판이 결과 없이 끝난다 | 잠금 순서 |
| **deadlock** | 잠금 순서가 같아도 갭 잠금 등으로 발생 가능 | 트랜잭션 전체를 최대 3회 짧은 무작위 지연과 함께 재시도 | 재시도 |

## 서버 재기동 시 정리

**인메모리 상태가 사라지면 DB에 방과 진행 중 라운드가 고아로 남는다.** 재접속이 없으므로 그 방들은 아무도 이어받을 수 없다 — 소켓이 전부 끊겼고, 다시 들어오는 사람은 새 참가자이며, 진행 중인 방에는 새 참가자로도 들어갈 수 없다. 살아 있는 방이 하나도 없는 상태다.

**그러므로 기동 시 모든 방을 삭제한다.**

| 단계 | 내용 |
|:----:|------|
| 1 | 애플리케이션 기동 시 마이그레이션 리비전이 최신인지 확인한다 |
| 2 | status가 ready·running인 game_rounds를 전부 cancelled로 바꾸고 ended_at = NOW() · ended_reason = server_restart를 채운다 |
| 3 | 모든 rooms 행을 삭제한다. 하위 5테이블이 CASCADE로 함께 사라진다 |
| 4 | 정리한 방 수·라운드 수를 기동 로그에 남긴다 |
| 5 | **정리가 끝난 뒤에만** readiness probe가 통과해 트래픽을 받는다 |

- **2단계를 3단계 앞에 두는 이유**는 부분 실패 대비다. 3단계가 실패해도 라운드는 취소된 상태로 남아 "진행 중이라고 주장하는 판"이 없다.
- **왜 waiting 방까지 지우는가.** 방 수명 규칙이 "마지막 참가자 이탈 즉시 삭제"이고 재기동 직후 모든 방의 접속자가 0명이므로, waiting 방을 남기는 것은 그 규칙을 어기고 초대 코드만 점유하는 결과가 된다.
- **무중단 배포를 하지 않는다.** 단일 인스턴스·워커 1개라 배포는 곧 재기동이고 재기동은 곧 전 방 종료다. 배포는 사용이 적은 시간대에 하고, 진행 중인 방이 끊긴다는 사실을 운영 규칙으로 받아들인다.
- **크래시 복구도 같은 절차다.** 프로세스가 비정상 종료해도 다음 기동에서 같은 정리가 돌아 상태가 수렴한다.

## 방 만료·회수 규칙

| 대상 | 기준 | 실행 |
|------|------|------|
| waiting 방 | last_activity_at + 10분 | 만료 스윕이 **1분 이내 주기**로 돌며 삭제 |
| playing 방 | 만료 타이머 정지 | 스윕 대상에서 제외한다 |
| playing 방 안전망 | last_activity_at + 30분 | 소켓 이벤트 없이 남은 이상 상태를 강제 회수한다. 가장 긴 게임(킹메이커 3분 30초)의 8배 이상이라 정상 진행을 끊지 않는다 |
| PENDING 참가자 | joined_at + 3분 | PENDING 회수 스윕과 입장 트랜잭션 양쪽에서 회수. **방장이면 방 삭제** |
| 방장 이탈 | 즉시 | 요청·소켓 종료 처리 트랜잭션에서 즉시 삭제 |
| 마지막 참가자 이탈 | 즉시 | 활성 참가자가 0명이 되는 트랜잭션에서 즉시 삭제 |

- **last_activity_at을 갱신하는 것은 사용자 행동뿐이다** — 채팅·준비 토글·설정 변경·게임 입력·입퇴장이다. 타이머 tick과 하트비트는 갱신하지 않는다.
- 만료 스윕은 idx_rooms_expires_at를 쓴다. 대상이 많아도 **방 하나당 하나의 짧은 트랜잭션**으로 처리해 긴 잠금을 만들지 않는다.
- 스윕은 단일 인스턴스 안의 스케줄러로 돌린다. 중복 실행돼도 안전하지만 별도 프로세스를 두지 않는다.

## 연결·성능

| 항목 | 기준 |
|------|------|
| 세션 점유 | WebSocket 연결 하나가 DB 세션을 계속 잡지 않는다. 이벤트마다 열고 즉시 반환한다 |
| 총 연결 수 | (pool_size + max_overflow) × 워커 1 × 인스턴스 1. **MySQL max_connections의 80%를 넘지 않게** 잡는다 |
| 연결 확인 | pool_pre_ping을 켜고 pool_recycle을 MySQL wait_timeout보다 짧게 둔다 |
| 세션 초기화 | 새 연결마다 시간대 +00:00과 strict SQL mode 적용 여부를 확인한다. **DDL을 실행한 세션에만 적용되는 설정이 아님을 보장해야 한다** |
| 타임아웃 | connect_timeout · read_timeout · write_timeout · innodb_lock_wait_timeout · max_execution_time을 환경별로 지정한다 |
| N+1 방지 | 방 상태 조회는 필요한 관계만 명시적으로 함께 읽는다 |
| 쓰기 부하 | 타이머 tick·애니메이션·고빈도 소켓 이벤트를 저장하지 않아 쓰기가 방·판 단위로만 발생한다 |

## 관련 문서

- 제약이 막는 것과 트랜잭션이 막는 것의 분담 → [05_constraints_integrity.md](./05_constraints_integrity.md)
- 방·참가자 수명주기 → [02_rooms_participants.md](./02_rooms_participants.md)
- 회차 상태 전이 → [03_game_rounds.md](./03_game_rounds.md)
- 투표 멱등의 근거가 되는 UNIQUE → [04_options_votes_results.md](./04_options_votes_results.md)
- 마이그레이션·기동 순서·DB 계정 → [07_migrations_seed.md](./07_migrations_seed.md)
- 판정 엔진·시간과 타이밍 → [../04_architecture/README.md](../04_architecture/README.md)
- 이벤트 발행 시점 계약 → [../07_api/03_socket_events.md](../07_api/03_socket_events.md)
