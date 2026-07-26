# 데이터 모델 · 저장 정책

> **어떤 데이터가 어디에 저장되고 언제 사라지는가**를 정의한다.
> ⚠️ 저장 위치는 [D-06](../DECISIONS.md#d-06) **승인 대기** — 아래는 기본안 기준이다.
> 최종 수정: 2026-07-26

---

## 1. 저장 계층 3분류

ModuPick은 **일회성 서비스**다. 방은 결정이 끝나면 사라지고 아무것도 남기지 않는다.
그래서 저장 계층을 셋으로 나눈다.

| 계층 | 저장 대상 | 수명 | 왜 여기인가 |
|---|---|---|---|
| **서버 인메모리** | 방 · 멤버 · 라운드 · 채팅 링버퍼 | 방이 삭제될 때까지 | 재접속이 없어([D-04](../DECISIONS.md#d-04)) 복구할 필요가 없다 |
| **PostgreSQL** | 게임 메타 6종 · 아바타 카탈로그 15종 | 영구 (정적) | 배포마다 바뀌지 않는 읽기 전용 카탈로그 |
| **클라이언트 로컬스토리지** | 내 채팅 기록 · 가이드 "다시 보지 않기" | 브라우저에 남는 동안 | 서버가 알 필요 없는 개인 설정([D-17](../DECISIONS.md#d-17)) |

```
┌──────────────────────────── 서버 프로세스 ────────────────────────────┐
│  Room ──┬── Member (2~10)                                             │
│         ├── Round  (0~1, 진행 중일 때만)                               │
│         └── ChatBuffer (최근 50건, 링버퍼)                             │
│                          ↑ 전부 인메모리 · 방 삭제 시 함께 소멸          │
└───────────────────────────────────────────────────────────────────────┘
              │ 읽기만                              │ 서버가 모름
              ▼                                     ▼
┌──────────── PostgreSQL ────────────┐   ┌──── 브라우저 로컬스토리지 ────┐
│  Game   (6행, 고정)                 │   │  chat:{roomCode}             │
│  Avatar (15행, 고정)                │   │  guideSkip:{gameId}          │
└─────────────────────────────────────┘   └──────────────────────────────┘
```

---

## 2. 인메모리 엔티티

### 2.1 Room

| 필드 | 타입 | 설명 |
|---|---|---|
| `code` | string(4) | 초대 코드. **숫자 4자리**([D-01](../DECISIONS.md#d-01)). 표시할 때만 `MODU-` 접두어를 붙인다 |
| `roomName` | string | 1~30자 |
| `maxMembers` | int | 2~10. **방 생성 시 확정되며 이후 변경 불가**([D-32](../DECISIONS.md#d-32)) |
| `roomStatus` | enum | `WAITING` \| `PLAYING` \| `CLOSED` |
| `hostMemberId` | string | 방장 멤버 ID |
| `roomVersion` | int | 방 상태가 바뀔 때마다 +1. 이벤트 순서 뒤집힘 감지용 |
| `createdAt` | datetime | ISO 8601 + 타임존 |
| `lastActiveAt` | datetime | 마지막으로 소켓이 연결돼 있던 시각. 만료 판정에 쓴다([D-03](../DECISIONS.md#d-03)) |

**상태 전이**

```
                  게임 시작                 대기방 복귀
  [생성] → WAITING ────────→ PLAYING ────────────→ WAITING
              │                  │                    │
              └──────────────────┴────────────────────┘
                                 ▼
                             CLOSED → 삭제 + 코드 회수
              (방장 이탈 D-05 / 소켓 0명 10분 D-03)
```

### 2.2 Member

| 필드 | 타입 | 설명 |
|---|---|---|
| `memberId` | string | 서버 발급 식별자 |
| `roomCode` | string(4) | 소속 방 |
| `nickname` | string | **1~8자 · 같은 방 안에서 유일**. `PENDING` 상태에서는 비어 있다 |
| `avatarId` | string | 아바타 ID. **같은 방 안에서 유일** |
| `bio` | string | 한 줄 소개. 0~24자, 선택 |
| `isHost` | boolean | 방장 여부 |
| `ready` | boolean | 준비 완료 여부. 방장은 항상 `true`로 간주 |
| `memberStatus` | enum | `PENDING`(가입만) \| `ACTIVE`(프로필 확정) |
| `token` | string | `hostToken`(방장) 또는 `guestToken`(참여자). 방이 사라지면 무효([D-05](../DECISIONS.md#d-05)) |

**상태 전이**

```
  [가입] → PENDING ──프로필 확정(PATCH)──→ ACTIVE ──소켓 끊김/퇴장/강퇴──→ 제거
              │
              └── 15초 안에 소켓 핸드셰이크가 없으면 슬롯 자동 해제
```

**중요한 구분**

- **정원 계산**(`currentMembers`)은 `PENDING` + `ACTIVE`를 **합산**한다.
  프로필을 아직 안 채운 사람도 슬롯을 차지해야 정원 초과를 정확히 막을 수 있다.
- **다른 사람 화면에 보이는 것**은 `ACTIVE`뿐이다. `room:snapshot.members`와 참가자 목록에는 `ACTIVE`만 들어간다.
- 즉 **"소켓은 붙었지만 아직 안 보이는" 구간이 존재한다.** 이게 `PENDING`이다.

### 2.3 Round

게임 한 판. 방에 **최대 1개**만 존재하며 `PLAYING` 상태일 때만 있다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `roundId` | string | 라운드 식별자. `다시 하기`를 누르면 **새로 발급**된다 |
| `roomCode` | string(4) | 소속 방 |
| `gameId` | enum | `roulette` \| `ladder` \| `kingmaker` \| `timer` \| `snipe` \| `nunchi` |
| `config` | object | 게임별 방장 설정. 규격은 [`05_game_rules/00_common.md` §2](../05_game_rules/00_common.md#2-게임별-방장-설정-요약) |
| `phase` | enum | `READY` → `PLAYING` → (`TIE`) → `RESULT` |
| `participants` | array | **게임 시작 시점에 고정된** 참가자 목록 |
| `seed` | string | 무작위 결과 재현용 서버 시드. 룰렛·사다리에 사용([D-13](../DECISIONS.md#d-13)) |
| `startedAt` | datetime | 서버 기준 시작 시각. 시간 판정의 기준점([D-14](../DECISIONS.md#d-14)) |
| `deadlineAt` | datetime | 현재 phase의 마감 시각. 제한이 없으면 `null` |
| `actions` | map | `memberId → 입력 기록`. 1회 제한 검증에 사용 |
| `result` | object | 확정된 결과. 게임별 구조는 [`05_game_rules/00_common.md`](../05_game_rules/00_common.md)의 각 "결과 데이터" 절 |

> **동점 재진행은 새 라운드가 아니다.** 같은 `roundId` 안에서 `phase`가 `TIE`로 바뀔 뿐이다([D-11](../DECISIONS.md#d-11)).
> `다시 하기`만 새 `roundId`를 만든다.

**킹메이커의 추가 구조** — 익명성 유지를 위해 매핑을 분리한다([D-18](../DECISIONS.md#d-18)).

| 필드 | 설명 |
|---|---|
| `candidates` | `candidateId → text` — **클라이언트에 내려보내는 것** |
| `candidateAuthors` | `candidateId → memberId` — **절대 클라이언트에 내려보내지 않는다.** 자기 의견 투표 차단에만 서버 내부에서 사용 |
| `votes` | `memberId → candidateId` — 실명 모드에서만 투표자를 공개([D-22](../DECISIONS.md#d-22)) |

### 2.4 ChatBuffer

| 필드 | 타입 | 설명 |
|---|---|---|
| `messageId` | string | 메시지 식별자 |
| `memberId` | string | 보낸 사람. `null`이면 시스템 메시지 |
| `text` | string | 1~200자 |
| `sentAt` | datetime | 서버가 붙인 시각 |

- **최근 50건만** 유지하는 링버퍼다. 51번째가 들어오면 가장 오래된 것이 밀려난다.
- **DB에 저장하지 않는다**([D-07](../DECISIONS.md#d-07)).
- 과거 메시지를 더 불러오는 기능이 없다([D-28](../DECISIONS.md#d-28)).

---

## 3. PostgreSQL (정적 카탈로그)

배포 시 시드 데이터로 채워 넣고, 런타임에는 **읽기만** 한다.

### 3.1 `game` (6행 고정)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `game_id` | varchar PK | `roulette` \| `ladder` \| `kingmaker` \| `timer` \| `snipe` \| `nunchi` |
| `name` | varchar | 표시명 (운명의 룰렛 등) |
| `description` | text | 한 줄 부제 |
| `rules` | jsonb | 가이드 팝업(`M-01`)에 쓰는 규칙 문구 배열 |
| `config_schema` | jsonb | 방장 설정 항목의 타입·범위. 근거는 [`05_game_rules/00_common.md` §2](../05_game_rules/00_common.md#2-게임별-방장-설정-요약) |

### 3.2 `avatar` (15행 고정)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `avatar_id` | varchar PK | `A01` ~ `A15` |
| `name` | varchar | 동물 이름 (여우 · 너구리 등) |
| `image_url` | varchar | `/assets/avatar/a01.png` |

- **정확히 15종**이다([D-08](../DECISIONS.md#d-08)). 5×3 그리드 한 화면에 전부 들어간다.
- **선점 여부는 이 테이블에 저장하지 않는다.** 선점은 방마다 다르므로 인메모리 `Member.avatarId`로 판정한다.

---

## 4. 클라이언트 로컬스토리지

서버는 이 데이터의 존재를 모른다.

| 키 | 값 | 용도 |
|---|---|---|
| `chat:{roomCode}` | 메시지 배열 | 게임 종료 후 대기방으로 돌아왔을 때 내 채팅 기록 복원([D-07](../DECISIONS.md#d-07)) |
| `guideSkip:{gameId}` | boolean | 가이드 "다시 보지 않기" 체크 상태([D-17](../DECISIONS.md#d-17)) |

---

## 5. 생명주기 요약

| 데이터 | 언제 생기나 | 언제 사라지나 |
|---|---|---|
| Room | `POST /api/rooms` | 방장 이탈([D-05](../DECISIONS.md#d-05)) 또는 소켓 0명 10분([D-03](../DECISIONS.md#d-03)) |
| 초대 코드 | 방 생성 시 자동 발급 | 방 삭제 시 **회수 후 재사용**([D-02](../DECISIONS.md#d-02)) |
| Member (PENDING) | `POST /rooms/{code}/members` | 15초 내 소켓 미연결 시 자동 해제 |
| Member (ACTIVE) | `PATCH /rooms/{code}/members/me` | 소켓 끊김 · 퇴장 · 강퇴 · 방 삭제 |
| Round | `game:start` | 방 삭제 또는 `round:close`([D-29](../DECISIONS.md#d-29)) |
| ChatBuffer | 첫 메시지 | 방 삭제 (또는 51번째 메시지가 밀어냄) |
| Game / Avatar | 배포 시 시드 | 사라지지 않음 |

---

## 6. 지표 집계 수단이 없다 ⚠️

[`01_overview/00_product.md` §7](../01_overview/00_product.md#7-핵심-지표)의 핵심 지표(방 생성 수 · 게임 완주율 등)를
**이 데이터 모델로는 집계할 수 없다.** 방·라운드가 인메모리에만 있다가 사라지기 때문이다.

집계하려면 다음 중 하나가 필요하다.

| 방법 | 영향 |
|---|---|
| 서버 애플리케이션 로그 집계 | 코드 변경 최소. 로그 수집·보관 구성 필요 |
| 이벤트 전용 테이블 신설 (방 생성·게임 종료만 기록) | PostgreSQL에 쓰기가 생긴다. 개인정보는 없으므로 부담은 작다 |
| 외부 분석 도구 연동 | 프론트에 SDK 추가 |

**아직 정해지지 않았다** ([U-04](../DECISIONS.md#h-아직-결정되지-않은-것)).

---

## 7. [D-06](../DECISIONS.md#d-06) 대안이 채택되면 무엇이 바뀌나

| 대안 | 이 문서에서 바뀌는 것 |
|---|---|
| **(A) 인메모리** (기본안) | 현재 문서 그대로. 서버 `replica=1` 고정 |
| **(B) Redis 추가** | §2 인메모리 엔티티가 전부 Redis로 이동. 키 설계·TTL 정책 신설 필요. 수평 확장 가능 |
| **(C) PostgreSQL 전면 영속** | §2 엔티티가 전부 테이블이 된다. `room` · `member` · `round` · `chat_message` 스키마와 인덱스·정리 배치 필요. §6 지표 집계 문제도 함께 해결된다 |
