# 02_rooms_participants — 방·참가자

> **대상**: ModuPick — rooms · participants 두 테이블의 컬럼·제약·인덱스·수명주기와 초대 코드 발급 규칙
> **작성일**: 2026-08-02
> **원천**: git 529e312 docs/db.md v0.5 §4 rooms·participants DDL · §2 API-DB 필드 계약 · §7 상태 머신 · git 529e312 docs/api.md(초대 코드 숫자 6자리 · 아바타 30종 · PENDING 슬롯 3분) · docs_legacy/requirements.md §6 D-01·D-13·D-14·D-32 · frontend/src/screens/Profile.tsx(닉네임 8자·소개 24자) · frontend/src/screens/CreateRoom.tsx(방 이름 30자) · frontend/src/screens/Landing.tsx(코드 숫자 6자리) · frontend/src/assets/avatars(30종)

방 하나가 서비스의 완결된 단위다. rooms는 초대 코드와 만료 시각을 들고, participants는 그 방 안에서만 유효한 신원을 든다. 두 테이블은 **방 밖으로 나가는 참조를 갖지 않으며**, 방 행이 사라지면 참가자도 물리적으로 사라진다.

두 테이블이 강제하는 핵심은 셋이다 — **초대 코드 전역 유일** · **방 안 활성 닉네임·아바타 유일** · **방 안 활성 방장 최대 1명**. 셋 다 VIRTUAL 생성 컬럼 위의 UNIQUE로 표현해 퇴장한 참가자의 값은 재사용할 수 있게 열어 둔다.

## 테이블 목록

| # | 테이블 | 보관 내용 | 컬럼 | 상태 |
|:-:|--------|----------|:----:|:----:|
| 1 | rooms | 방 — 초대 코드·이름·정원·상태·활동과 만료 시각 | 9 | ⬜ |
| 2 | participants | 방 참가자 — 외부 ID·가입 상태·신원·역할·퇴장 시각 | 15 | ⬜ |

## 1. rooms — 방

| 컬럼명 | 타입 | NULL | 키 | 설명 |
|--------|------|:--:|----|------|
| id | BIGINT UNSIGNED | N | PK · AUTO_INCREMENT | 내부 식별자. **API·소켓에 노출하지 않는다** — 외부는 초대 코드로 방을 가리킨다 |
| code | CHAR(6) ascii_bin | N | UQ | 초대 코드. **숫자 6자리**이며 CHECK가 형식을 강제한다. 표시할 때만 MODU- 접두어를 붙인다 |
| room_name | VARCHAR(30) | N | | 방 이름. CHECK로 공백 제거 후 1~30자 |
| max_members | SMALLINT | N | | 정원. CHECK 2~10. **방 생성 시 확정되며 이후 바꾸지 않는다** |
| status | VARCHAR(20) | N | | waiting · playing. DEFAULT 'waiting'. 종료 상태는 값이 아니라 **행 삭제**로 표현한다 |
| created_at | TIMESTAMP(6) | N | | 생성 시각. DEFAULT CURRENT_TIMESTAMP(6) |
| last_activity_at | TIMESTAMP(6) | N | | 마지막 사용자 행동 시각. 만료 연장의 기준점 |
| expires_at | TIMESTAMP(6) | N | | last_activity_at + 10분. CHECK expires_at > last_activity_at |
| updated_at | TIMESTAMP(6) | N | | 마지막 변경 시각. ON UPDATE CURRENT_TIMESTAMP(6) |

```sql
CREATE TABLE rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_name VARCHAR(30) NOT NULL,
  max_members SMALLINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_activity_at TIMESTAMP(6) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_rooms PRIMARY KEY (id),
  CONSTRAINT uq_rooms_code UNIQUE (code),
  CONSTRAINT ck_rooms_code_format
    CHECK (REGEXP_LIKE(code, '^[0-9]{6}$', 'c')),
  CONSTRAINT ck_rooms_room_name_len
    CHECK (CHAR_LENGTH(TRIM(room_name)) BETWEEN 1 AND 30),
  CONSTRAINT ck_rooms_max_members
    CHECK (max_members BETWEEN 2 AND 10),
  CONSTRAINT ck_rooms_status
    CHECK (status IN ('waiting', 'playing')),
  CONSTRAINT ck_rooms_expiry_order
    CHECK (expires_at > last_activity_at),
  INDEX idx_rooms_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- **CLOSED 상태를 저장하지 않는다.** 방 종료·방장 이탈·만료는 전부 rooms 행 삭제이며, 그 순간 하위 데이터가 CASCADE로 함께 사라진다.
- **status는 waiting·playing 둘뿐이다.** 결과가 확정돼도 방은 playing을 유지하고, 방장이 대기방 복귀를 보내야 waiting으로 돌아간다([03_game_rounds.md](./03_game_rounds.md)).
- **만료 스윕은 status = 'waiting'인 방만 본다.** 게임 진행 중에는 만료 타이머가 멈춘다(git 529e312 docs/api.md 2026-07-29 추가 확정). playing 방이 소켓 이벤트 없이 남는 이상 상태에 대비해 **last_activity_at + 30분** 강제 회수 안전망을 함께 둔다 — 가장 긴 게임(킹메이커 3분 30초)의 8배 이상이라 정상 진행을 끊지 않는다.
- **last_activity_at을 갱신하는 것은 사용자 행동뿐이다** — 채팅·준비 토글·설정 변경·게임 입력·입퇴장이다. 서버 타이머 tick과 하트비트는 갱신하지 않는다. 갱신 대상이 실제 사용자 행동인지는 앱이 판정한다.

### 초대 코드 — 발급·충돌·추측 방지

**숫자 6자리로 확정한다.** git 529e312 docs/db.md는 DDL(영문 대문자+숫자 6자리)과 API 예시(숫자 6자리)가 서로 어긋난 채였고, [../README.md](../README.md)의 고정 기준이 숫자 6자리이므로 그쪽으로 통일한다. 코드 공간은 **100만 개**다.

| 축 | 규칙 |
|----|------|
| 생성 | 암호학적 난수원으로 000000~999999 균등 추출한다. **순번·시각 기반 생성을 하지 않는다** — 예측 가능한 코드는 다음 방을 추측할 수 있게 만든다 |
| 유일성 | uq_rooms_code가 전역 유일을 강제한다. INSERT가 중복으로 실패하면 새 코드를 뽑아 **최대 10회** 재시도하고, 10회 모두 실패하면 서버 오류로 응답한다 |
| 충돌 확률 | 동시 방 100개(docs_legacy/requirements.md NFR-07) 기준 점유율 0.01%이므로 첫 시도 충돌 확률이 1만분의 1이다. 10회 재시도는 사실상 소진되지 않는다 |
| 회수·재사용 | 방이 삭제되면 코드가 함께 사라지고 **다시 발급될 수 있다.** 삭제된 방의 코드로 들어오면 없는 방으로 처리한다 |
| 추측 방지 | 코드 검증 요청에 IP·세션 단위 rate limiting과 실패 누적 지연을 적용한다. 상한값과 임계치의 정본은 [../11_fairness/README.md](../11_fairness/README.md)다 |
| 응답 형태 | **행이 아직 남아 있는 만료 방**은 만료로 응답하고 그 자리에서 삭제한다. **이미 삭제된 코드와 애초에 없던 코드는 구별하지 않고** 없는 방으로 응답한다. 정원·참가자 정보는 입장 자격을 갖추기 전에 내려보내지 않는다 |
| 로그 | 초대 코드 전체를 애플리케이션 로그에 남기지 않는다 |

**rate limiting은 배포 전 필수다.** 코드 공간이 100만이라 초당 수백 회 조회가 가능하면 전수 탐색이 현실적인 시간 안에 끝난다. 코드 자릿수를 늘리는 대신 요청 상한으로 막는 것이 이 설계의 선택이며, 그 대가로 rate limiting이 없는 배포는 허용되지 않는다.

## 2. participants — 방 참가자

| 컬럼명 | 타입 | NULL | 키 | 설명 |
|--------|------|:--:|----|------|
| id | BIGINT UNSIGNED | N | PK · UQ(id, room_id) | 내부 식별자. UQ는 하위 테이블 복합 FK의 대상 키다 |
| member_id | VARCHAR(40) ascii_bin | N | UQ | **외부 식별자.** mbr_ 접두어 + 추측 불가 난수 문자열. API·소켓이 참가자를 가리키는 유일한 값 |
| room_id | BIGINT UNSIGNED | N | FK → rooms.id (**CASCADE**) | 소속 방 |
| status | VARCHAR(10) | N | | pending · active. DEFAULT 'pending' |
| nickname | VARCHAR(8) | Y | | 닉네임 원문. ACTIVE일 때 필수. CHECK로 공백 제거 후 1~8자 |
| avatar_id | CHAR(3) ascii_bin | Y | | A01~A30. ACTIVE일 때 필수. CHECK가 형식을 강제 |
| bio | VARCHAR(24) | Y | | 한 줄 소개. 선택 입력. CHECK로 공백 제거 후 1~24자 또는 NULL |
| role | VARCHAR(10) | N | | host · guest. **권한은 다른 참가자에게 넘어가지 않는다** |
| joined_at | TIMESTAMP(6) | N | | 가입 시각. DEFAULT CURRENT_TIMESTAMP(6) |
| pending_expires_at | TIMESTAMP(6) | Y | | PENDING 슬롯 만료 시각(joined_at + 3분). ACTIVE 전환 시 NULL로 지운다 |
| left_at | TIMESTAMP(6) | Y | | 퇴장·강퇴·연결 종료·슬롯 회수 시각. **활성 참가자는 NULL** |
| active_nickname | VARCHAR(8) **VIRTUAL** | Y | UQ(room_id, active_nickname) | ACTIVE이고 미퇴장일 때만 LOWER(TRIM(nickname)). 그 외 NULL |
| active_avatar_id | CHAR(3) **VIRTUAL** | Y | UQ(room_id, active_avatar_id) | ACTIVE이고 미퇴장일 때만 avatar_id. 그 외 NULL |
| active_host_guard | TINYINT **VIRTUAL** | Y | UQ(room_id, active_host_guard) | host이고 미퇴장일 때만 1. 그 외 NULL |
| updated_at | TIMESTAMP(6) | N | | 마지막 변경 시각. ON UPDATE CURRENT_TIMESTAMP(6) |

```sql
CREATE TABLE participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  nickname VARCHAR(8) NULL,
  avatar_id CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  bio VARCHAR(24) NULL,
  role VARCHAR(10) NOT NULL,
  joined_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  pending_expires_at TIMESTAMP(6) NULL,
  left_at TIMESTAMP(6) NULL,
  active_nickname VARCHAR(8)
    GENERATED ALWAYS AS (
      CASE WHEN status = 'active' AND left_at IS NULL
           THEN LOWER(TRIM(nickname)) ELSE NULL END
    ) VIRTUAL,
  active_avatar_id CHAR(3) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE WHEN status = 'active' AND left_at IS NULL
           THEN avatar_id ELSE NULL END
    ) VIRTUAL,
  active_host_guard TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN role = 'host' AND left_at IS NULL THEN 1 ELSE NULL END
    ) VIRTUAL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_participants PRIMARY KEY (id),
  CONSTRAINT uq_participants_member_id UNIQUE (member_id),
  CONSTRAINT uq_participants_id_room UNIQUE (id, room_id),
  CONSTRAINT fk_participants_room FOREIGN KEY (room_id)
    REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT ck_participants_member_id_format
    CHECK (REGEXP_LIKE(member_id, '^mbr_[0-9A-Za-z]{16,36}$', 'c')),
  CONSTRAINT ck_participants_status
    CHECK (status IN ('pending', 'active')),
  CONSTRAINT ck_participants_role
    CHECK (role IN ('host', 'guest')),
  CONSTRAINT ck_participants_profile_state CHECK (
    (status = 'pending' AND nickname IS NULL AND avatar_id IS NULL)
    OR
    (status = 'active' AND nickname IS NOT NULL AND avatar_id IS NOT NULL)
  ),
  CONSTRAINT ck_participants_nickname_len CHECK (
    nickname IS NULL OR CHAR_LENGTH(TRIM(nickname)) BETWEEN 1 AND 8
  ),
  CONSTRAINT ck_participants_avatar_id CHECK (
    avatar_id IS NULL
    OR REGEXP_LIKE(avatar_id, '^A(0[1-9]|[12][0-9]|30)$', 'c')
  ),
  CONSTRAINT ck_participants_bio_len CHECK (
    bio IS NULL OR CHAR_LENGTH(TRIM(bio)) BETWEEN 1 AND 24
  ),
  CONSTRAINT ck_participants_pending_window CHECK (
    status = 'pending' OR pending_expires_at IS NULL
  ),
  CONSTRAINT uq_participants_active_nickname
    UNIQUE (room_id, active_nickname),
  CONSTRAINT uq_participants_active_avatar
    UNIQUE (room_id, active_avatar_id),
  CONSTRAINT uq_participants_active_host
    UNIQUE (room_id, active_host_guard),
  INDEX idx_participants_room_active (room_id, left_at, status),
  INDEX idx_participants_pending_expiry (pending_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- **생성 컬럼에 room_id를 넣지 않는다.** room_id는 일반 컬럼으로 복합 UNIQUE에 참여시킨다. FK가 걸린 컬럼을 생성 컬럼 식에 넣으면 CASCADE와 충돌할 수 있어 git 529e312 docs/db.md v0.4에서 이미 제거된 설계다.
- **활성 값만 유일하다.** 퇴장한 참가자의 닉네임·아바타는 생성 컬럼이 NULL이 되어 UNIQUE 대상에서 빠지고, 새 참가자가 같은 값을 다시 쓸 수 있다. MySQL UNIQUE는 NULL을 여러 개 허용한다.
- **avatar_id는 A01~A30이다.** 아바타 자산 30종이 frontend/src/assets/avatars에 있고 git 529e312 docs/api.md도 30종을 쓴다. git 529e312 docs/db.md v0.4의 A01~A15 서술은 폐기한다.
- **아바타 선점을 DB가 강제한다.** git 529e312 docs/db.md는 "방 안 아바타 중복을 막는 제약이 없다"를 구현 차단 충돌로 남겼는데, uq_participants_active_avatar가 그 자리를 닫는다.
- **role은 갱신 대상이 아니다.** 방장 권한 위임이 없으므로 host 행의 role은 생성 후 바뀌지 않는다. 방장이 나가면 방이 삭제된다.

### PENDING → ACTIVE → 퇴장 수명주기

```
[방 생성]  ─ POST /api/rooms ────────────▶ PENDING host   (pending_expires_at = joined_at + 3분)
[가입]     ─ POST .../members ───────────▶ PENDING guest  (pending_expires_at = joined_at + 3분)

PENDING ── 프로필 확정(PATCH) ──▶ ACTIVE   (pending_expires_at = NULL · 커밋 후 참가 이벤트 발행)
PENDING ── 3분 경과 또는 소켓 종료 ──▶ left_at 설정 (슬롯 해제)
ACTIVE  ── 퇴장·강퇴·소켓 종료 ──▶ left_at 설정
어느 상태든 ── 방 삭제 ──▶ 행 물리 삭제(CASCADE)
```

| 규칙 | 내용 |
|------|------|
| 슬롯 확보 | 가입은 PENDING 행 INSERT로 **먼저 자리를 잡는다**. 프로필을 아직 채우지 않은 사람도 정원을 차지해야 정원 초과를 정확히 막는다 |
| 정원 계산 | 현재 인원 = left_at IS NULL인 **PENDING + ACTIVE 합산**이다. 입장 트랜잭션이 rooms 행을 잠근 뒤 센다 |
| 화면 노출 | 다른 사람 화면과 방 스냅샷에는 **ACTIVE만** 실린다. "소켓은 붙었지만 아직 보이지 않는" 구간이 PENDING이다 |
| 참가 이벤트 시점 | 참가 브로드캐스트는 INSERT가 아니라 **ACTIVE 전환 커밋 후**에 발행한다 |
| 슬롯 회수 | pending_expires_at <= NOW()인 PENDING은 left_at을 채워 슬롯을 연다. 회수는 만료 스윕과 입장 트랜잭션 양쪽에서 일어난다 |
| PENDING 방장 회수 | 방장이 3분 안에 프로필을 확정하지 않으면 방장이 없는 방이 되므로 **방 자체를 삭제한다** |
| 퇴장 | 개별 퇴장·강퇴·연결 종료는 전부 left_at 갱신이다. **행을 지우지 않는다** — 지우면 그 사람의 표가 CASCADE로 함께 사라진다 |
| 재입장 | 다시 들어오면 새 행·새 member_id다. 진행 중인 방에는 새 참가자로도 들어갈 수 없다 |
| 프로필 수정 | ACTIVE 이후 닉네임·아바타·소개 변경은 같은 행 UPDATE이며 활성 UNIQUE가 그대로 적용된다 |

**PENDING 만료를 DB 컬럼으로 두는 이유**는 슬롯 점유가 DB에서 세는 값이기 때문이다. 소켓 연결 여부는 인메모리가 알고 연결이 끊기면 즉시 left_at을 채우지만, **핸드셰이크조차 오지 않아 인메모리에 흔적이 없는 가입**은 DB만 알고 있다. pending_expires_at은 그 경우의 백스톱이며, 서버가 재기동해도 슬롯이 영구히 잠기지 않게 한다.

## 인덱스

| 테이블 | 인덱스 | 구성 | 용도 |
|--------|--------|------|------|
| rooms | pk_rooms | PK(id) | 내부 조회 |
| rooms | uq_rooms_code | UNIQUE(code) | 초대 코드 조회·중복 차단. 코드 검증 API의 유일한 접근 경로 |
| rooms | idx_rooms_expires_at | (expires_at) | 만료 스윕 |
| participants | pk_participants | PK(id) | 내부 조회 |
| participants | uq_participants_member_id | UNIQUE(member_id) | 외부 ID 조회 |
| participants | uq_participants_id_room | UNIQUE(id, room_id) | **하위 테이블 복합 FK의 대상 키** |
| participants | uq_participants_active_nickname | UNIQUE(room_id, active_nickname) | 활성 닉네임 유일 |
| participants | uq_participants_active_avatar | UNIQUE(room_id, active_avatar_id) | 활성 아바타 유일(선점) |
| participants | uq_participants_active_host | UNIQUE(room_id, active_host_guard) | 방별 활성 방장 최대 1명 |
| participants | idx_participants_room_active | (room_id, left_at, status) | 방의 현재 인원 카운트·명단 조회 |
| participants | idx_participants_pending_expiry | (pending_expires_at) | PENDING 슬롯 회수 스윕 |

- uq_participants_id_room은 조회 성능이 아니라 **복합 FK를 성립시키기 위한 것**이다. MySQL은 FK 대상이 PK 또는 UNIQUE의 왼쪽 접두여야 하므로, (id, room_id) 조합에 UNIQUE가 없으면 game_rounds·game_options·votes의 복합 FK를 선언할 수 없다.
- fk_participants_room의 참조 컬럼 room_id는 idx_participants_room_active가 왼쪽 접두로 덮으므로 MySQL이 자동 인덱스를 만들지 않는다.

## 특이사항

- **외부 식별자를 따로 두는 이유는 추측 차단이다.** 내부 PK는 방을 가로질러 연속 증가하므로 노출하면 다른 방의 참가자 수·생성 순서를 추정할 수 있다. member_id는 난수 문자열이라 그 경로가 닫힌다. 같은 이유로 rooms.id도 노출하지 않고 외부에서는 초대 코드로만 방을 가리킨다.
- **닉네임 비교는 대소문자·앞뒤 공백을 정규화한 뒤 한다.** active_nickname이 LOWER(TRIM(...))이므로 " Jiho "와 "jiho"는 같은 방에 공존할 수 없다. 원문은 nickname 컬럼이 그대로 보관해 화면에 표시한다.
- **bio는 24자다.** frontend/src/screens/Profile.tsx와 docs_legacy/requirements.md가 24자이고 git 529e312 docs/api.md의 20자 서술과 어긋난다. 프로토타입 구현과 요구사항 정본이 일치하는 24자를 택한다.
- **호스트 최소 1명은 DB가 강제하지 못한다.** 생성 컬럼 UNIQUE는 "최대 1명"만 보장한다. 최소 1명은 방 생성 트랜잭션이 host를 함께 만들고, host가 나가면 방을 삭제하는 것으로 성립한다([05_constraints_integrity.md](./05_constraints_integrity.md)).
- **정원 상한도 DB가 강제하지 못한다.** max_members는 2~10 범위만 CHECK가 보고, 현재 인원이 그 값보다 작은지는 rooms 행을 잠근 입장 트랜잭션이 센다([06_transactions_concurrency.md](./06_transactions_concurrency.md)).

## 관련 문서

- 관계·CASCADE 경로 → [01_erd.md](./01_erd.md)
- 라운드와 방 상태의 연동 → [03_game_rounds.md](./03_game_rounds.md)
- 제약 전수·DB와 앱의 강제 분담 → [05_constraints_integrity.md](./05_constraints_integrity.md)
- 입장·프로필 확정·퇴장 트랜잭션과 잠금 순서 → [06_transactions_concurrency.md](./06_transactions_concurrency.md)
- 초대 코드 rate limiting·익명성 위협 모델 → [../11_fairness/README.md](../11_fairness/README.md)
- 방 수명·정원 고정 기준 → [../README.md](../README.md)
