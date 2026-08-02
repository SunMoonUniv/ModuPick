# 03_game_rounds — 게임 회차

> **대상**: ModuPick — game_rounds 테이블의 컬럼·제약·인덱스, 영속 status와 인메모리 phase의 분리, 난수 시드 보관
> **작성일**: 2026-08-02
> **원천**: git 529e312 docs/db.md v0.5 §4 game_rounds DDL · §7 상태 머신 · v0.4 §7 컬럼 사전(random_seed) · git 529e312 docs/api.md(game:phase READY·PLAYING·TIE·RESULT · round:close) · docs_legacy/requirements.md §3.1 G-13 · §6 D-38·D-39 · git ecceb11 docs/03_architecture/01_data_model.md §2.3(Round 인메모리 필드)

game_rounds는 **게임 한 판의 영속 기록**이다. 어떤 게임을 어떤 설정과 어떤 시드로 돌렸고 언제 어떻게 끝났는지를 담으며, 판이 진행되는 동안의 초 단위 상태는 담지 않는다. 방 하나에 진행 중인 판은 **최대 1개**이고 그것을 DB 제약이 강제한다.

이 테이블에서 가장 중요한 설계 판단은 **phase를 컬럼으로 두지 않는 것**이다. 진행 단계는 초당 여러 번 바뀌고 재접속이 없어 복구 대상이 아니므로 인메모리에 둔다. DB는 되돌릴 수 없는 전이만 기록한다.

## 테이블 명세

| # | 테이블 | 보관 내용 | 컬럼 | 상태 |
|:-:|--------|----------|:----:|:----:|
| 3 | game_rounds | 게임 1회 실행 — 종류·설정·시드·영속 상태·종료 사유 | 14 | ⬜ |

| 컬럼명 | 타입 | NULL | 키 | 설명 |
|--------|------|:--:|----|------|
| id | BIGINT UNSIGNED | N | PK · UQ(id, room_id) | 내부 식별자. UQ는 하위 테이블 복합 FK의 대상 키다 |
| round_id | VARCHAR(40) ascii_bin | N | UQ | **외부 식별자.** rnd_ 접두어 + 추측 불가 난수 문자열. API·소켓이 판을 가리키는 유일한 값 |
| room_id | BIGINT UNSIGNED | N | FK → rooms.id (**CASCADE**) · 복합 FK 대상 축 | 소속 방 |
| game_type | VARCHAR(30) | N | | roulette · ladder · kingmaker · timer · snipe · nunchi. CHECK가 6종을 강제 |
| status | VARCHAR(20) | N | | ready · running · finished · cancelled. **영속 상태이며 phase가 아니다** |
| config | JSON | N | | 방장이 확정한 게임 설정 + schemaVersion. 시작 시점 값이 그대로 굳는다 |
| random_seed | BIGINT UNSIGNED | N | | 서버가 만든 재현 가능한 난수 시드. **판마다 1개 발급하며 NULL이 아니다** |
| started_by | BIGINT UNSIGNED | Y | FK (started_by, room_id) → participants(id, room_id) (**CASCADE**) | 판을 시작한 방장 |
| created_at | TIMESTAMP(6) | N | | 라운드 행 생성 시각. DEFAULT CURRENT_TIMESTAMP(6) |
| started_at | TIMESTAMP(6) | Y | | 입력을 받기 시작한 시각. running 전이에서 채운다 |
| ended_at | TIMESTAMP(6) | Y | | 확정·취소 시각. 종료 상태에서 반드시 채워진다 |
| ended_reason | VARCHAR(30) | Y | | completed · host_left · last_member_left · room_expired · server_restart · error |
| active_round_guard | TINYINT **VIRTUAL** | Y | UQ(room_id, active_round_guard) | status가 ready·running일 때만 1. 그 외 NULL |
| updated_at | TIMESTAMP(6) | N | | 마지막 변경 시각. ON UPDATE CURRENT_TIMESTAMP(6) |

```sql
CREATE TABLE game_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  round_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  game_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ready',
  config JSON NOT NULL,
  random_seed BIGINT UNSIGNED NOT NULL,
  started_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at TIMESTAMP(6) NULL,
  ended_at TIMESTAMP(6) NULL,
  ended_reason VARCHAR(30) NULL,
  active_round_guard TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('ready', 'running') THEN 1 ELSE NULL END
    ) VIRTUAL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_game_rounds PRIMARY KEY (id),
  CONSTRAINT uq_game_rounds_round_id UNIQUE (round_id),
  CONSTRAINT uq_game_rounds_id_room UNIQUE (id, room_id),
  CONSTRAINT uq_game_rounds_active UNIQUE (room_id, active_round_guard),
  CONSTRAINT fk_game_rounds_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_game_rounds_started_by FOREIGN KEY (started_by, room_id)
    REFERENCES participants(id, room_id) ON DELETE CASCADE,
  CONSTRAINT ck_game_rounds_round_id_format
    CHECK (REGEXP_LIKE(round_id, '^rnd_[0-9A-Za-z]{16,36}$', 'c')),
  CONSTRAINT ck_game_rounds_game_type CHECK (
    game_type IN ('roulette', 'ladder', 'kingmaker', 'timer', 'snipe', 'nunchi')
  ),
  CONSTRAINT ck_game_rounds_status CHECK (
    status IN ('ready', 'running', 'finished', 'cancelled')
  ),
  CONSTRAINT ck_game_rounds_ended_reason CHECK (
    ended_reason IS NULL
    OR ended_reason IN ('completed', 'host_left', 'last_member_left',
                        'room_expired', 'server_restart', 'error')
  ),
  CONSTRAINT ck_game_rounds_time_order CHECK (
    ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at
  ),
  CONSTRAINT ck_game_rounds_terminal_state CHECK (
    (status IN ('ready', 'running')
       AND ended_at IS NULL AND ended_reason IS NULL)
    OR
    (status IN ('finished', 'cancelled')
       AND ended_at IS NOT NULL AND ended_reason IS NOT NULL)
  ),
  INDEX idx_game_rounds_room_created (room_id, created_at),
  INDEX idx_game_rounds_started_by (started_by, room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

## 영속 status와 인메모리 phase의 분리

두 축이 있고 **이름이 비슷해 섞이기 쉽다.** 무엇을 어디에 두는지 먼저 고정한다.

| 축 | 값 | 위치 | 바뀌는 빈도 | 누가 본다 |
|----|-----|------|-----------|----------|
| **status** | ready · running · finished · cancelled | **MySQL** game_rounds.status | 판당 2~3회 | 서버. 클라이언트에 그대로 내려보내지 않는다 |
| **phase** | READY · PLAYING · TIE · RESULT | 인메모리 | 초 단위. 동점 결선마다 다시 바뀐다 | 클라이언트. 화면 전환의 유일한 신호 |

- **phase를 컬럼으로 두지 않는 이유**는 셋이다. (1) 재접속이 없어 복구할 대상이 아니다. (2) 동점 결선이 같은 판 안에서 최대 3회 반복하므로 phase 전이가 판당 6회를 넘을 수 있고, 그때마다 DB 왕복이 붙으면 전원 동시 전환(0.5초 이내 편차)이 흔들린다. (3) phase는 마감 시각·생존자 명단 같은 인메모리 값과 한 덩어리로 움직여 절반만 영속화하면 두 사실의 정본이 갈라진다.
- **동점 결선은 새 판이 아니다.** 같은 round_id 안에서 phase가 TIE로 바뀔 뿐이며, status는 running을 유지한다. 결선 차수는 votes.ballot_no가 기록한다([04_options_votes_results.md](./04_options_votes_results.md)).
- **다시 하기는 새 판이다.** 결과 화면에서 같은 설정으로 다시 돌리면 새 round_id로 행이 하나 더 생긴다.

### status 전이도

```
                       game:start 트랜잭션
                              │
                              ▼
                          [ ready ]        인메모리 phase = READY (가이드·카운트다운)
                              │
                     카운트다운 종료 · 입력 개시
                              │
                              ▼
                        [ running ]        인메모리 phase = PLAYING ↔ TIE (최대 3회 결선)
                          │        │
              결과 확정    │        │   방장 이탈 · 마지막 참가자 이탈
                          │        │   · 방 만료 · 서버 재기동 · 처리 오류
                          ▼        ▼
                    [ finished ]  [ cancelled ]
```

| 전이 | 트리거 | 가드 | 함께 바뀌는 것 |
|------|--------|------|--------------|
| (없음) → ready | 방장의 게임 시작 | 방이 waiting · 방장 본인 · 게임별 최소 인원 충족 · 방장 제외 전원 준비 완료 | rooms.status = playing · game_options 생성 |
| ready → running | 인메모리 READY 단계 종료 | 방이 아직 살아 있다 | started_at 기록 |
| running → finished | 판정 완료 | 그 판의 결과가 아직 없다(UNIQUE) | game_results 1행 INSERT · ended_at · ended_reason = completed |
| ready·running → cancelled | 방장 이탈 · 마지막 참가자 이탈 · 방 만료 · 서버 재기동 · 처리 오류 | — | ended_at · 해당 ended_reason. 대부분 rooms 삭제와 같은 트랜잭션이다 |
| finished → (없음) | 방장의 대기방 복귀 | 방장 본인 | rooms.status = waiting. **라운드 행은 그대로 남는다** |

- **결과 확정과 대기방 복귀는 분리돼 있다.** 결과가 확정돼도 방은 playing을 유지하고 전원이 결과 화면에 머문다. 방장이 대기방 복귀를 보내야 rooms.status가 waiting이 된다. git 529e312 docs/db.md v0.4가 "결과 저장과 동시에 방을 waiting으로 바꾼다"고 적었던 것을 v0.5가 뒤집었고, 본 문서는 v0.5를 따른다.
- **finished와 cancelled는 종료 상태다.** 둘 다 ended_at·ended_reason이 반드시 차 있고, active_round_guard가 NULL이 되어 같은 방에서 다음 판을 시작할 수 있게 열린다.
- **status를 되돌리는 전이가 없다.** finished·cancelled에서 나가는 화살표는 없으며, 새 판이 필요하면 새 행을 만든다.

### (상태 × 사건) 대응

| 사건 \ status | ready | running | finished | cancelled |
|---------------|-------|---------|----------|-----------|
| 게임 입력 도착 | 버린다(아직 개시 전) | 처리한다 | 버린다(끝난 판) | 버린다 |
| 결과 확정 요청 | 일어나지 않는다 | finished로 전이 | 기존 결과를 그대로 반환(멱등) | 무시한다 |
| 같은 방에서 새 판 시작 | 거절(UNIQUE) | 거절(UNIQUE) | 허용 | 허용 |
| 방장 이탈·방 만료 | cancelled 후 방 삭제 | cancelled 후 방 삭제 | 방 삭제 | 방 삭제 |
| 서버 재기동 | cancelled(server_restart) 후 방 삭제 | cancelled(server_restart) 후 방 삭제 | 방 삭제 | 방 삭제 |

빈칸을 남기지 않는다. 어느 칸도 "정의되지 않음"이 아니다.

## 난수 시드 보관

| 축 | 규칙 |
|----|------|
| 발급 | **판마다 1개**를 라운드 생성 트랜잭션에서 발급한다. 암호학적 난수원에서 64비트 부호 없는 정수를 뽑는다 |
| NOT NULL | 게임 종류를 가리지 않고 발급한다. 서버 난수를 쓰는 자리가 게임마다 다를 뿐(룰렛 당첨 · 사다리 가로줄 생성 · 킹메이커 후보 표시 순열) 전부 같은 시드에서 파생하므로 NULL 분기를 두지 않는다 |
| 노출 | 판이 진행되는 동안 시드를 클라이언트에 내려보내지 않는다. **미리 알면 결과를 미리 알 수 있다** |
| 결과 동봉 | 결과가 확정된 뒤에는 result_data의 seed 필드에 같은 값을 실어 재현 근거를 남긴다. 두 값은 반드시 같다 |
| 보관 기간 | 방이 살아 있는 동안이다. 방이 사라지면 라운드와 함께 삭제된다(docs_legacy/requirements.md G-13·D-38) |
| 재현 | 시드 + config + 그 판의 game_options가 있으면 서버 난수 결과를 다시 계산할 수 있다. 참가자 입력에 의존하는 게임(킹메이커·저격)은 votes까지 있어야 재현된다 |

**시드는 결과를 만드는 값이지 결과를 담는 값이 아니다.** 결과 자체는 game_results.result_data 하나가 정본이며, 시드로 재계산한 값과 저장된 결과가 다르면 저장된 결과가 이긴다 — 판정은 이미 전원에게 전달된 뒤이기 때문이다.

## config JSON

- **시작 시점의 방장 설정이 그대로 굳는다.** 게임 진행 중 설정 변경 경로가 없으므로 config는 INSERT 이후 바뀌지 않는다.
- 게임을 바꾸면 설정이 기본값으로 초기화되며, 그 초기화는 대기방 인메모리에서 일어나고 DB에는 시작 시점 값만 들어온다.
- **자유 형식이 아니다.** 게임별 Pydantic 모델과 schemaVersion으로 검증한 뒤 저장한다. 필드 의미가 바뀌면 기존 데이터를 덮어쓰지 않고 버전을 올린다. 게임별 규격은 [04_options_votes_results.md](./04_options_votes_results.md)가 정본이다.
- **JSON 값을 검색 조건으로 쓰지 않는다.** 필요해지면 그때 VIRTUAL 생성 컬럼과 인덱스를 추가한다.
- config 최대 바이트 크기는 API 계층이 제한한다.

## 인덱스

| 인덱스 | 구성 | 용도 |
|--------|------|------|
| pk_game_rounds | PK(id) | 내부 조회 |
| uq_game_rounds_round_id | UNIQUE(round_id) | 외부 ID 조회 |
| uq_game_rounds_id_room | UNIQUE(id, room_id) | **game_options·votes 복합 FK의 대상 키** |
| uq_game_rounds_active | UNIQUE(room_id, active_round_guard) | **방별 진행 중 판 최대 1개** |
| idx_game_rounds_room_created | (room_id, created_at) | 방의 판 이력 시계열. fk_game_rounds_room의 커버 인덱스를 겸한다 |
| idx_game_rounds_started_by | (started_by, room_id) | fk_game_rounds_started_by의 커버 인덱스 |

- idx_game_rounds_started_by를 명시로 두는 이유는 MySQL이 FK에 맞는 인덱스가 없으면 이름을 정하지 않은 인덱스를 자동 생성하기 때문이다. **모든 인덱스에 고정된 이름을 준다**는 규약을 지키려면 직접 선언해야 한다.
- **started_at 기준 인덱스를 두지 않는다.** 시작하지 못하고 취소된 판은 started_at이 NULL이라 정렬 축으로 쓸 수 없다. 판 순서는 created_at으로 센다.

## 특이사항

- **started_by가 NULL일 수 있다.** 복합 FK의 어느 한 컬럼이 NULL이면 MySQL이 제약을 만족한 것으로 보므로, 서버가 자동으로 만든 판(있다면)도 들어갈 수 있다. 현재 설계에서 판을 시작하는 주체는 방장뿐이므로 실제로는 항상 채워진다.
- **started_at은 판정 기준이 아니다.** 시간 판정의 기준점은 인메모리가 확정한 시작 시각이고, started_at은 그 값을 기록한 사본이다. DB 쓰기 지연이 판정에 섞이지 않도록 이 순서를 뒤집지 않는다.
- **명단 스냅샷은 이 테이블에 없다.** 게임이 시작되면 참가자 명단이 고정되지만, 그 명단은 인메모리가 들고 있고 룰렛·저격에서만 game_options 행으로 남는다. 나머지 게임은 결과 JSON이 명단을 확정한다.
- **cancelled 라운드도 지우지 않는다.** 취소는 상태 전이이며 행 삭제가 아니다. 대부분의 취소는 방 삭제와 같은 트랜잭션에서 일어나 결국 CASCADE로 사라지지만, 취소 이유를 남긴 뒤 삭제하는 순서를 지켜 부분 실패 시에도 상태가 모순되지 않게 한다.

## 관련 문서

- 선택지·투표·결과와의 관계 → [04_options_votes_results.md](./04_options_votes_results.md)
- 방 상태와의 연동·정원 → [02_rooms_participants.md](./02_rooms_participants.md)
- 제약 전수·DB와 앱의 강제 분담 → [05_constraints_integrity.md](./05_constraints_integrity.md)
- 게임 시작·결과 확정·재기동 정리 트랜잭션 → [06_transactions_concurrency.md](./06_transactions_concurrency.md)
- 게임별 규칙·상태 머신·종료 증명 → [../05_game_rules/README.md](../05_game_rules/README.md)
- phase 전이 이벤트 계약 → [../07_api/03_socket_events.md](../07_api/03_socket_events.md)
