# ModuPick API 명세서

> 클라이언트와 서버가 **무엇을 주고받는가**를 정의한다.
> `requirements.md`의 규칙을 REST 엔드포인트와 WebSocket 이벤트로 옮긴 결과물이다.

| | |
|---|---|
| 최종 수정 | 2026-07-30 |
| 전송 | REST(HTTP) + Native WebSocket |
| 앞선 문서 | [`requirements.md`](requirements.md) — 사용자가 무엇을 하고 싶은가 **★정본** |
| | [`features.md`](features.md) — 그러려면 무엇을 만들어야 하나 |
| 짝 문서 | [`db.md`](db.md) — 같은 계약의 저장 쪽 |

스펙이 어긋나면 `requirements.md`가 이긴다. 이 문서는 그 결정을 인터페이스로 옮긴 결과이며,
그 과정에서 새로 생긴 **인터페이스 결정은 §11에 `API-` 번호로** 남긴다.

---

## 1. 공통 계약

| # | 규칙 |
|---|---|
| C-1 | 방 코드는 **숫자 6자리**로 주고받는다. `MODU-` 접두어는 화면과 복사되는 초대 코드에만 붙이며, 응답에 `displayCode`로 함께 준다 |
| C-2 | `memberId`·`roundId`·`optionId`는 각각 `mbr_`·`rnd_`·`opt_` 접두어가 붙은 불투명 문자열이다 |
| C-3 | 모든 S→C 이벤트의 `data`에 `roomVersion`을 넣는다. 클라이언트는 마지막으로 반영한 번호보다 작거나 같으면 무시한다 |
| C-4 | 날짜는 ISO 8601(타임존 포함), 판정용 시간은 서버 내부 **정수 밀리초**다 |
| C-5 | 토큰은 참가자 식별에만 쓰고, 권한은 매번 현재 `participants.role`을 조회해 판단한다 |
| C-6 | 모든 상태 변경 이벤트는 **DB commit 이후** 발행한다. 실패하면 아무것도 브로드캐스트하지 않는다 |
| C-7 | 유효한 REST 요청과 C→S 이벤트는 방의 10분 무활동 만료를 연장한다. 서버 tick과 브로드캐스트는 연장하지 않는다 |
| C-8 | **재접속은 없다.** 소켓이 끊기면 그 `memberId`는 퇴장 처리되고 다시 붙는 경로가 없다(G-6 · D-09) |
| C-9 | 서버는 **단일 인스턴스**로 운영한다. 진행 상태를 프로세스 메모리에 두기 때문이다([`db.md §2`](db.md#2-저장-경계--무엇이-db에-남고-무엇이-안-남는가)) |

### 1.1 값 표기

저장값과 노출값을 항상 같게 둔다. 변환 계층이 없다([`db.md §4`](db.md#4-값-표기-규칙)).

| 종류 | 표기 | 예 |
|---|---|---|
| 상태·종류 | **소문자** | `roomStatus: "waiting"` · `memberStatus: "pending"` · `gameId: "roulette"` |
| 사유·판정 | **대문자** | `reason: "KICKED"` · `verdict: "SAFE"` |
| 프로토콜 상수 | **대문자** | `phase: "VOTE"` · `code: "ROOM_FULL"` |

### 1.2 응답 규격

```json
// 성공
{ "success": true, "code": "OK", "message": null,
  "data": { }, "timestamp": "2026-07-30T15:04:05+09:00" }

// 실패
{ "success": false, "code": "ROOM_IN_RESULT",
  "message": "결과를 보는 중이에요",
  "data": null, "timestamp": "2026-07-30T15:04:05+09:00" }
```

- HTTP 상태 코드는 그대로 쓰되 **화면 분기는 `code` 문자열로** 한다.
- `message`는 그대로 띄울 수 있는 한국어 문구다.
- S→C 소켓 이벤트도 같은 봉투를 쓰며, 아래 표의 페이로드는 `data` 안에 들어간다.

---

## 2. 연결 수명주기 — F-601

```
POST /rooms  또는  POST /rooms/{code}/members     ← 슬롯 선점 (memberStatus: pending)
        ↓                                            정원에 이미 포함된다 · 2분 뒤 자동 회수
PATCH /rooms/{code}/members/me                     ← 프로필 확정 (memberStatus: active)
        ↓
WebSocket 핸드셰이크                                 ← 방장·참가자 모두 이 시점에 연결
        ↓
room:snapshot (최초 1회)  →  개별 이벤트로 부분 갱신
```

1. **슬롯 선점** — 방을 만들거나 코드로 들어오면 `pending` 참가자가 생기고 토큰을 받는다.
   이때부터 정원에 포함되며(D-46), **2분** 안에 프로필을 확정하지 않으면 슬롯이 풀린다.
2. **프로필 확정** — `PATCH`가 성공하면 `active`가 되고 `member:joined`가 브로드캐스트된다.
3. **소켓 연결** — 방장과 참가자 모두 **프로필 확정 직후**에 연결한다(D-46). `pending` 상태의
   소켓은 존재하지 않으므로 서버는 소켓을 한 종류로만 관리한다.
4. **연결 종료 = 퇴장** — 끊기면 즉시 방에서 제거하고 `member:left { reason: "DISCONNECT" }`를 보낸다.
   게임 중이라면 그 사람은 후보에 그대로 남는다(G-5 · US-403.1).

> 새로고침 한 번이면 방에서 빠진다. 프론트가 이탈 경고를 띄우는 편이 좋다.

---

## 3. REST API

| Method | Path | 기능 | 인증 | 기능 ID |
|---|---|---|---|---|
| `POST` | `/api/rooms` | 방 + `pending` 방장 생성 | — | F-101 · F-102 |
| `GET` | `/api/rooms/{code}` | 입장 가능 여부·방 상태 조회 | — | F-105 · F-211 |
| `POST` | `/api/rooms/{code}/members` | `pending` 참가자 슬롯 생성 | — | F-105 |
| `GET` | `/api/rooms/{code}/avatars` | 아바타 30종과 선점 현황 | Bearer | F-117 · F-118 · F-119 |
| `PATCH` | `/api/rooms/{code}/members/me` | 프로필 최초 확정 | Bearer | F-108 · F-109 · F-110 |
| `DELETE` | `/api/rooms/{code}/members/me` | 퇴장. 방장이면 방 삭제 | Bearer | F-209 |
| `GET` | `/api/games` | 게임 6종·최소 인원·설정 스키마 | — | F-301 |
| `GET` | `/api/games/{gameId}` | 가이드·설정 상세 | — | F-313 |

> **과거 결과 조회 엔드포인트는 만들지 않는다.** `/api/rooms/{code}/results` 계열이 없다(US-504.2 · F-507).

### 3.1 `POST /api/rooms` — 방 만들기

```json
// 요청
{ "roomName": "4조 알고리즘 스터디", "maxMembers": 8 }
```
- `roomName` 1~30자. 비어 있거나 공백뿐이면 `ModuPick 방`
- `maxMembers` 2~10, 기본 10

```json
// 응답 data
{ "code": "427132", "displayCode": "MODU-427132",
  "roomName": "4조 알고리즘 스터디", "maxMembers": 8,
  "hostToken": "eyJhbGciOi…", "memberId": "mbr_01H…",
  "memberStatus": "pending",
  "pendingExpiresAt": "2026-07-30T15:06:05+09:00",
  "expiresAt": "2026-07-30T15:14:05+09:00" }
```

방과 `pending` 방장을 한 트랜잭션에서 만든다. 방장은 이어서 `PATCH`로 프로필을 확정한 뒤 소켓을 연결한다.

### 3.2 `GET /api/rooms/{code}` — 코드 검증

```json
// 응답 data
{ "code": "427132", "roomName": "4조 알고리즘 스터디",
  "roomStatus": "waiting", "maxMembers": 8,
  "currentMembers": 4, "hostNickname": "지호" }
```

- `roomStatus`는 `waiting` · `playing` · `result`
- `currentMembers`는 **`pending` + `active` 합산**이다(D-46)
- 입장은 `waiting`에서만 허용한다. `playing`이면 `409 ROOM_ALREADY_PLAYING`,
  `result`면 `409 ROOM_IN_RESULT`다(D-48)
- `expiresAt`이 지났으면 `410 ROOM_EXPIRED`를 반환하고 방을 삭제한다

### 3.3 `POST /api/rooms/{code}/members` — 슬롯 선점

요청 바디 없음.

```json
// 응답 data
{ "guestToken": "eyJhbGciOi…", "memberId": "mbr_01H…",
  "role": "guest", "memberStatus": "pending",
  "currentMembers": 6, "maxMembers": 8,
  "pendingExpiresAt": "2026-07-30T15:06:05+09:00" }
```

- 방을 잠그고 `pending`+`active` 합계가 `maxMembers` 미만인지 확인한다. 차 있으면 `409 ROOM_FULL`
- 브라우저 식별값이나 과거 강퇴 기록을 받지도 조회하지도 않는다(NFR-08)
- 강퇴된 사람이 다시 요청해도 `waiting`이고 자리가 있으면 새 토큰과 새 `memberId`를 발급한다(US-204.2)
- **2분** 안에 프로필을 확정하지 않으면 슬롯을 회수한다

### 3.4 `GET /api/rooms/{code}/avatars` — 아바타 선점 현황

```json
// 응답 data
{ "content": [
    { "avatarId": "A01", "name": "여우", "imageUrl": "/assets/avatar/a01.png",
      "taken": true, "takenBy": "서연" },
    { "avatarId": "A02", "name": "너구리", "imageUrl": "/assets/avatar/a02.png",
      "taken": false, "takenBy": null }
  ],
  "totalCount": 30 }
```

- **30종 고정**이며 한 방에서 중복해 쓸 수 없다(D-45). 이름·타일색을 함께 준다(F-117)
- 선점은 클릭이 아니라 `PATCH` 성공 시점에 확정된다. 동시 클릭은 늦게 제출한 쪽이 `AVATAR_TAKEN`으로 걸러진다
- 정원이 최대 10명이라 자동 배정이 실패할 일은 없다
- **프로필 화면에는 소켓이 없으므로**(§2) 이 엔드포인트를 **3초 주기로 다시 불러** 잠금 상태를 갱신한다(F-118 · `API-08`).
  실시간 이벤트로 밀어주지 않는다. 최종 방어선은 제출 시점의 `AVATAR_TAKEN`이다

### 3.5 `PATCH /api/rooms/{code}/members/me` — 프로필 확정

```json
// 요청
{ "nickname": "지호", "avatarId": null, "bio": "@jiho_dev" }
```

- `pending` 상태에서만 호출할 수 있다. `active`면 `409 PROFILE_ALREADY_CONFIRMED`
- `nickname` **1~8자, 공백 문자를 포함할 수 없다**(D-44)
- 같은 방 활성 닉네임과 **대소문자를 무시하고** 겹치면 `409 NICKNAME_DUPLICATED`.
  서버가 숫자를 붙여 바꾸지 않는다(D-44)
- `avatarId`가 `null`이면 `A01`~`A30` 중 안 쓰이는 가장 작은 값을 배정한다.
  명시한 값이 이미 쓰이고 있으면 `409 AVATAR_TAKEN`
- `bio` 0~24자, 선택

```json
// 응답 data
{ "memberId": "mbr_01H…", "memberStatus": "active",
  "nickname": "지호", "avatarId": "A06", "bio": "@jiho_dev" }
```

commit 후 `member:joined`를 발행한다. 클라이언트는 이 응답을 받고 소켓을 연결한다.

### 3.6 `DELETE /api/rooms/{code}/members/me` — 퇴장

- 참가자: `left_at`을 갱신하고 `member:left { reason: "LEAVE" }`를 브로드캐스트
- 방장: 남은 사람과 방 상태에 관계없이 방을 삭제하고 `room:closed { reason: "HOST_LEFT" }`(G-16 · D-12)
- `playing`에서 방장이 나가면 결과를 만들지 않는다
- 방장 위임과 `host:changed`는 없다

### 3.7 `GET /api/games` — 게임 목록

```json
// 응답 data
{ "content": [
    { "gameId": "roulette", "name": "운명의 룰렛", "description": "…",
      "minMembers": 2, "resultVariant": "winner", "configSchema": { } }
  ],
  "totalCount": 6 }
```

| `gameId` | 이름 | 최소 인원 | 결과 형태 |
|---|---|---|---|
| `roulette` | 운명의 룰렛 | 2 | `winner` |
| `ladder` | 랜덤 사다리 | 2 | `assign` |
| `kingmaker` | 킹메이커 | 3 | `tally` |
| `timer` | 시간초 잡기 | 2 | `winner` |
| `snipe` | 익명 저격 | 3 | `winner` |
| `nunchi` | 눈치게임 | 3 | `record` |

`configSchema`에는 **항목별 허용값과 기본값이 함께 들어간다**. 기본값의 정본은 서버다(D-54 · §7).

### 3.8 `GET /api/games/{gameId}` — 가이드·설정 상세

```json
// 응답 data
{ "gameId": "roulette", "name": "운명의 룰렛",
  "oneLiner": "서버가 정한 조각에서 멈춘다",
  "steps": ["방장이 PICK을 누른다", "…"],
  "criteria": "서버 난수",
  "topicPresets": ["팀장", "발표자", "자료 조사", "PPT 제작"],
  "configSchema": { } }
```

3초 가이드(F-312)와 게임 화면의 `?` 버튼이 같은 엔드포인트를 쓴다.
없는 `gameId`면 `404 GAME_NOT_FOUND`.

---

## 4. WebSocket — 클라이언트 → 서버

| 이벤트 | payload | 보낼 수 있는 사람·조건 | 기능 ID |
|---|---|---|---|
| `member:ready` | `{ ready }` | `active` guest · `waiting`에서만 | F-206 |
| `member:kick` | `{ memberId }` | 방장 · `waiting`에서만 · 대상은 guest | F-208 |
| `chat:send` | `{ text }` | `active` 전원 · 200자 이하 | F-203 |
| `chat:typing` | `{ typing }` | `active` 전원 | F-203 |
| `game:select` | `{ gameId }` | 방장 · `waiting` | F-303 |
| `game:config` | `{ gameId, config }` | 방장 · `waiting` | F-308 |
| `game:random` | `{ }` | 방장 · `waiting` | F-304 |
| `game:start` | `{ }` | 방장 · `waiting` · guest 전원 ready | F-311 |
| `game:replay` | `{ }` | 방장 · `result`에서만 | F-505 |
| `game:action` | `{ roundId, type, payload }` | 게임·phase별 (§5) | F-40x · F-4xx |
| `round:close` | `{ roundId }` | 방장 · `result` → `waiting` | F-506 |

- **참가자는 방장 전용 이벤트를 보낼 수 없다.** 화면에서 잠그는 것과 별개로 서버가 `NOT_HOST`로 거절한다(F-213).
- 방장이 `member:ready`를 보내면 `INVALID_ACTION`이다. 방장은 준비 상태를 갖지 않는다(G-3 · D-14).
- `member:kick`의 대상으로 자기 자신을 보내면 `INVALID_ACTION`이다.
- `result` 상태에서는 새 입장·프로필 확정·강퇴를 허용하지 않는다.
- `game:select`·`game:random`은 **최소 인원을 그 자리에서 검사**한다. 미달이면 `NOT_ENOUGH_MEMBERS`(D-50).
- `game:replay`는 직전 판의 `gameType`·`config`를 서버가 DB에서 읽어 쓴다. 클라이언트가 설정을 보내지 않는다(D-55).

---

## 5. `game:action` 계약

게임 중 참가자의 모든 입력이 이 이벤트 하나로 들어온다.

```json
{ "roundId": "rnd_01H…", "type": "king.vote",
  "payload": { "optionIds": ["opt_a1", "opt_b2"] } }
```

| 게임 | `type` | payload | 보내는 사람 |
|---|---|---|---|
| 룰렛 | `roulette.pick` | `{ }` | 방장 1회 |
| 사다리 | `ladder.start` | `{ }` | 방장 1회 |
| 킹메이커 | `king.opinion` | `{ text }` | snapshot 전원 1회 |
| 킹메이커 | `king.vote` | `{ optionIds }` | snapshot 전원, 회차당 1회 |
| 시간초 | `timer.start` | `{ }` | snapshot 전원, 시도당 1회 |
| 시간초 | `timer.stop` | `{ }` | `start`를 마친 사람 1회 |
| 저격 | `snipe.vote` | `{ targetMemberIds }` | snapshot 전원, 회차당 1회 |
| 눈치 | `nunchi.up` | `{ }` | 현재 생존자, 서브라운드당 1회 |
| 눈치 | `nunchi.invalid_decision` | `{ decision }` | 방장 · `INVALID` phase에서만 |

**멱등** — 같은 내용을 다시 보내면 저장된 결과를 **성공으로** 돌려준다.
내용이 다르면 `ALREADY_SUBMITTED`다(D-52 · G-9 · NFR-04).
끝난 판에 도착한 입력은 `ROUND_ALREADY_ENDED`로 버린다.

### 5.1 룰렛 · 사다리

- 참가자는 조작하지 않는다. 방장만 `roulette.pick` / `ladder.start`를 보낸다(Q-01 잠정).
- 사다리는 레인을 고르지 않는다. snapshot 순서로 자동 배치된다(US-421.1 · D-32).
- 서버가 시드로 결과를 먼저 확정하고 클라이언트는 정해진 결과로 수렴하는 애니메이션만 그린다(G-2).

### 5.2 킹메이커

```json
{ "type": "king.opinion", "payload": { "text": "모두픽" } }
{ "type": "king.vote", "payload": { "optionIds": ["opt_a1", "opt_b2"] } }
```

- `text` 1~120자. 1인 1건이며 제출 후 수정·취소할 수 없다(US-431.2·3)
- `optionIds` 길이는 1 이상 `config.votesPerMember` 이하. **서로 다른 안건에만** 나눠 준다(§3.5.3)
- 자기 안건이면 `SELF_VOTE_NOT_ALLOWED`, 허용 표 수를 넘으면 `TOO_MANY_CHOICES`,
  이번 회차 후보가 아니면 `INVALID_OPTION`
- `ballotNo`는 서버 phase가 정한다. 클라이언트가 보내지 않는다
- 안건 0개면 판을 취소하고 대기방으로, 1개면 투표를 건너뛰고 확정한다(US-433.5·6)

### 5.3 시간초

```json
{ "type": "timer.start", "payload": { } }
{ "type": "timer.stop",  "payload": { } }
```

- **클라이언트 시각을 보내지 않는다.** 서버가 각 이벤트의 ingress 도착 monotonic 시각을 기록한다(G-8 · D-05)
- `elapsedMs = stopServerTime − startServerTime`, 정수 밀리초
- 게임 시작 후 10초 안에 `start`가 없거나, `start` 후 `targetMs + 3000` 안에 `stop`이 없으면 최하위다
- 늦게 도착한 `stop`은 판정에 반영하지 않는다
- 절대 오차가 밀리초까지 같으면 **같은 판 안에서** `TIE` phase로 넘어가 동점자만 다시 한다(D-56)

### 5.4 저격

```json
{ "type": "snipe.vote", "payload": { "targetMemberIds": ["mbr_B", "mbr_C"] } }
```

- `allowMultipleTargets`가 `false`면 정확히 1명, `true`면 서로 다른 1명 이상
- 자기 자신은 `SELF_VOTE_NOT_ALLOWED`, 같은 대상 중복은 거절
- 기권은 빈 배열이거나 제한 시간 미입력이다. 기권은 누구의 표도 늘리지 않는다
- 서버가 `memberId`를 그 라운드의 `optionId`로 변환해 저장한다([`db.md §7`](db.md#7-game_options를-쓰는-게임))
- 전원 기권으로 유효표가 0이면 난수로 정하고 결과에 표시한다(US-452.5)

### 5.5 눈치

```json
{ "type": "nunchi.up", "payload": { } }
{ "type": "nunchi.invalid_decision", "payload": { "decision": "RESTART" } }
```

- **서브라운드(subRound)** 당 한 번만 누를 수 있다. 안전 확정된 사람의 입력은 무시한다(US-462.5)
- 판정은 최초 입력 도착 시각부터 `decisionWindowMs`(300 또는 500) 안의 입력을 한 그룹으로 묶는다
- 생존자 전원이 같은 판정창에 몰리면 **무효 라운드**가 되어 `phase: "INVALID"`로 전환되고
  방장의 `nunchi.invalid_decision`을 기다린다
- `decision`은 `RESTART`(같은 인원으로 서브라운드 재시작) 또는 `ABORT`(대기방으로)다(US-463)

> 화면에 보이는 말은 그대로 "라운드"이고, `subRound`는 DB `game_rounds`(게임 한 판)와
> 겹치지 않게 두려고 쓰는 내부 식별자다(D-57).

---

## 6. WebSocket — 서버 → 클라이언트

| 이벤트 | 핵심 data | 받는 사람 | 기능 ID |
|---|---|---|---|
| `room:snapshot` | `room`, `members`, `game`, `roomVersion` | 본인 (연결 직후 1회) | F-202 |
| `member:joined` | `member` | 전원 | F-201 |
| `member:left` | `memberId`, `reason` | 전원 | F-201 |
| `member:kicked` | `reason: "KICKED"` | **대상에게만** → 소켓 종료 | F-208 |
| `member:ready_changed` | `memberId`, `ready`, `readyCount`, `activeCount` | 전원 | F-206 |
| `chat:message` | `messageId`, `memberId`, `text`, `sentAt` | 전원 (보낸 본인 포함) | F-203 · F-205 |
| `chat:typing` | `memberId`, `typing` | 본인 제외 | F-203 |
| `game:selected` | `gameId`, `config`, `configSchema` | 전원 | F-303 |
| `game:config_changed` | `gameId`, `config` | 전원 | F-308 |
| `game:started` | `roundId`, `gameId`, `roundMembers`, `config`, `guideEndsAt` | 전원 | F-311 · F-312 |
| `game:phase` | `roundId`, `phase`, `deadlineAt` | 전원 | F-405 |
| `server:tick` | `serverTime`, `phaseRemainMs`, `roomExpiresInMs` | 전원 (1초 주기) | F-410 · F-214 |
| `game:progress` | 참가자별 `COMPLETE`/`WAITING`만 | 전원 | F-404 |
| `game:tie` | 후보 목록, `deadlineAt` | 전원 | F-436 · F-446 · F-454 |
| `game:result` | `roundId`, `variant`, `result`, `resultScreenAt` | 전원 | F-409 · F-501 |
| `round:closed` | `roundId`, `reason` | 전원 | F-506 |
| `room:closed` | `reason` | 전원 → 소켓 종료 | F-209 · F-210 |
| `error` | `code`, `message` | 보낸 사람만 | F-603 |

- `host:changed` 이벤트는 없다. 방장 권한은 넘어가지 않는다(D-12).
- `game:progress`에는 입력 내용·시간 기록·후보별 득표를 넣지 않는다(G-10 · D-22).
- 참가자가 이탈해도 `roundMembers`에서 빼지 않고 `departed: true`만 표시한다(G-5).
- 방장이 이탈하면 `game:result` 없이 `room:closed { reason: "HOST_LEFT" }`가 마지막 이벤트다.
- 난수 시드는 서버 보관 데이터이며 일반 `game:result`에 반드시 넣을 필요는 없다.
- 대기방 복귀 후 과거 결과를 다시 보내는 이벤트는 없다(US-504.2).

### 6.1 `room:snapshot`

이 이벤트 하나로 대기방 화면을 통째로 그린다. 이후에는 개별 이벤트로 부분 갱신만 한다.

```json
{ "room": { "code": "427132", "displayCode": "MODU-427132",
            "roomName": "4조 알고리즘 스터디", "roomStatus": "waiting",
            "maxMembers": 8, "hostMemberId": "mbr_01H…" },
  "members": [
    { "memberId": "mbr_01H…", "nickname": "지호", "avatarId": "A06",
      "bio": "@jiho_dev", "isHost": true, "ready": false }
  ],
  "game": { "gameId": "roulette", "config": { }, "configSchema": { },
            "selectableGameIds": ["roulette", "ladder", "timer"] },
  "roomVersion": 12 }
```

- `members`에는 `active`만 들어간다. 프로필 입력 중인 `pending`은 다른 사람에게 보이지 않는다
- **채팅은 스냅샷에 없다.** 서버가 저장하지 않으므로 나중에 들어온 사람은 이전 대화를 볼 수 없다(D-40)
- 게임이 아직 선택되지 않았으면 `game.gameId`는 `null`
- `selectableGameIds`는 현재 인원으로 시작 가능한 게임이다(F-302 · D-50)

### 6.2 `member:left` · `member:kicked` · `room:closed`의 사유

| 이벤트 | `reason` | 뜻 |
|---|---|---|
| `member:left` | `LEAVE` | 직접 나감 |
| | `KICKED` | 방장이 내보냄 |
| | `DISCONNECT` | 연결이 끊김 |
| `member:kicked` | `KICKED` | 내보내진 본인에게만. 받는 즉시 소켓이 닫힌다 |
| `round:closed` | `COMPLETED` | 결과를 보고 방장이 대기방으로 |
| | `NO_OPTIONS` | 킹메이커 안건 0개 (US-433.6) |
| | `NUNCHI_ABORTED` | 눈치 무효 라운드에서 방장이 `ABORT` (US-463.3) |
| `room:closed` | `HOST_LEFT` | 방장 이탈 |
| | `EMPTY` | 마지막 참가자 이탈 |
| | `INACTIVE` | 10분 무활동 |

**강퇴는 두 이벤트를 함께 발행한다**(D-49) — 대상은 소켓이 끊기기 전에 이유를 받아야 안내할 수 있고,
나머지는 목록에서 지우고 시스템 메시지를 남겨야 한다.
`round:closed`의 `reason`은 DB `game_rounds.ended_reason`과 **같은 값**이다.

### 6.3 채팅

```json
// chat:message
{ "messageId": "msg_01H…", "memberId": "mbr_01H…",
  "text": "다 모였으면 시작해요", "sentAt": "2026-07-30T15:04:05+09:00" }
```

- 서버가 `messageId`·`sentAt`을 붙여 **보낸 본인을 포함한 전원**에게 돌려준다.
  클라이언트가 미리 그리지 않고 기다렸다 그리면 순서가 보장된다
- `text`는 **200자 이하**(US-202.2). 빈 문자열이거나 공백뿐이면 서버가 버린다
- **시스템 메시지도 서버가 발행한다**(D-58). `memberId: null`이고 가운데 정렬로 그린다.
  입장·퇴장·강퇴·게임 시작이 대상이다(F-205)
- 서버는 채팅을 저장하지 않는다. 화면 복원은 브라우저 로컬 스토리지가 담당한다(D-40 · F-204)
- `chat:typing`은 상태만 전달하며 저장하지 않는다. 클라이언트는 3초간 갱신이 없으면 스스로 `false` 처리한다

### 6.4 `game:started`와 3초 가이드

```json
{ "roundId": "rnd_01H…", "gameId": "nunchi",
  "roundMembers": [ { "participantId": 12, "memberId": "mbr_a1b2",
                      "nickname": "지호", "avatarId": "A06",
                      "sortOrder": 0, "departed": false } ],
  "config": { }, "guideEndsAt": "2026-07-30T15:04:08+09:00" }
```

`guideEndsAt`이 `null`이면 가이드를 띄우지 않는다. **`다시 하기`가 이 경우다**(G-4 · D-17).

### 6.5 `game:phase`

```json
{ "roundId": "rnd_01H…", "phase": "VOTE",
  "deadlineAt": "2026-07-30T15:05:05+09:00",
  "options": [ { "optionId": "opt_a1", "label": "모두픽" },
               { "optionId": "opt_b2", "label": "결정장애 해결단" } ] }
```

| `phase` | 뜻 |
|---|---|
| `GUIDE` | 시작 직후 3초 가이드 |
| `PLAYING` | 공통 진행 (룰렛·사다리·시간초·눈치) |
| `SUBMIT` | 킹메이커 안건 제출 (2분) |
| `VOTE` | 킹메이커·저격 투표 |
| `TIE` | 결선 투표·동점자 재대결 |
| `INVALID` | 눈치 무효 라운드 — 방장 선택 대기 |
| `RESULT` | 결과 확정 후 |

게임별로 지나는 phase는 [`db.md §10.2`](db.md#102-판-상태와-소켓-phase)에 정리돼 있다.
`deadlineAt`은 제한 시간이 없는 단계면 `null`이다. 전원이 입력을 마치면 시간이 남아도
즉시 다음 phase로 넘어간다(US-402.4 · F-406).

**단계 전환 시 그 단계에 필요한 데이터를 함께 싣는다**(`API-09`). 지금은 킹메이커 하나가 해당한다.

| 게임 | phase | 함께 싣는 것 |
|---|---|---|
| `kingmaker` | `VOTE` | `options[]` — 제출된 안건을 **작성자 없이 섞은 순서**로 (F-432 · US-431.4) |
| 그 밖 | — | 추가 필드 없음 |

안건이 1개뿐이면 투표를 건너뛰고 바로 확정하므로 `VOTE`에 들어가지 않는다(US-433.5).
0개면 판이 취소된다(§6.2 `round:closed { NO_OPTIONS }`).
결선 회차의 후보는 `game:tie`가 같은 모양으로 다시 내려준다.

**세 가지 재시작이 서로 다른 신호를 쓴다**(D-59).

| 상황 | 신호 |
|---|---|
| 다시 하기 | **새 판**이므로 `game:started` (`guideEndsAt: null`) |
| 결선 투표·동점자 재대결 | **같은 판**이므로 `game:phase` → `TIE` |
| 눈치 무효 라운드 재시작 | **같은 판의 다음 서브라운드**이므로 `game:phase` → `PLAYING` |

### 6.6 `server:tick` — 시각 동기화

```json
{ "serverTime": "2026-07-30T15:04:05.000+09:00",
  "phaseRemainMs": 42000, "roomExpiresInMs": 540000 }
```

**1초 주기**로 전원에게 나간다. 세 가지가 전부 "서버 시계에 맞춘다"는 같은 일이라 한 이벤트로 묶었다(`API-07`).

| 필드 | 용도 |
|---|---|
| `serverTime` | 클라이언트가 자기 시계와의 오차를 재는 기준. `resultScreenAt`·`deadlineAt` 같은 절대 시각을 해석할 때 이 오차로 보정한다 |
| `phaseRemainMs` | 현재 phase의 남은 시간. 제한 시간이 없는 단계면 `null` (F-410) |
| `roomExpiresInMs` | 10분 무활동 만료까지 남은 시간. 사용자 행동이 있을 때마다 다시 늘어난다 (F-214) |

- 클라이언트는 **첫 틱으로 오차를 재고 이후에는 자체 타이머를 돌리되, 매 틱마다 보정**한다.
  틱마다 숫자를 새로 그리면 네트워크가 튈 때 카운트가 끊겨 보인다.
- 이 이벤트는 **방 만료를 연장하지 않는다.** 서버가 보내는 것이지 사용자 행동이 아니다(C-7).

### 6.7 `game:result`

```json
{ "roundId": "rnd_01H…", "variant": "record",
  "result": { }, "resultScreenAt": "2026-07-30T15:06:08+09:00" }
```

- `variant`는 `winner` · `assign` · `tally` · `record` 4종이고 클라이언트는 이걸로 결과 화면을 고른다(F-502)
- `result`의 구조는 [`db.md §9`](db.md#9-result_data-스키마)와 같다
- `resultScreenAt`은 결과 화면으로 전환할 절대 시각이다. 연출이 끝난 시점부터 **3초 뒤**이며,
  절대 시각으로 내려 참가자 간 편차를 0.5초 이내로 맞춘다(G-11 · US-501.2 · NFR-02)

---

## 7. 설정 계약 — F-306 · F-307 · F-309

`config`의 허용값과 **기본값의 정본은 서버**다(D-54). `GET /api/games/{gameId}`의 `configSchema`와
`game:selected`의 `config`가 같은 값을 내려주며, 프론트는 받은 값을 그리기만 한다.
게임을 바꾸면 이전 설정을 버리고 새 게임 기본값으로 초기화한다(D-19 · F-309).

| 게임 | 필드 | 허용값 | 기본값 |
|---|---|---|---|
| `roulette` | `topic` | 1~12자 | `팀장` |
| `ladder` | `topic` | 1~12자 | `조별과제` |
| | `items` | 1~10개, 각 1~12자 | 조별과제 세트 6종 |
| | `speed` | `fast` · `normal` · `slow` | `normal` |
| `kingmaker` | `topic` | 1~12자 | `팀명` |
| | `votesPerMember` | `1` · `2` · `3` | `1` |
| | `revealAuthors` | `true` · `false` | `false` |
| `timer` | `topic` | 1~12자 | `팀장` |
| | `targetMs` | `5000` · `7000` · `10000` | `5000` |
| | `winnerRule` | `closest` · `farthest` | `closest` |
| `snipe` | `topic` | 1~30자 (질문 문장) | `발표를 제일 잘할 것 같은 사람은?` |
| | `voteSeconds` | 5~60 | `10` |
| | `allowMultipleTargets` | `true` · `false` | `false` |
| | `revealVoters` | `true` · `false` | `false` |
| `nunchi` | `topic` | 1~12자 | `팀장` |
| | `decisionWindowMs` | `300` · `500` | `300` |
| | `subRoundTimeoutMs` | `10000` · `15000` · `20000` | `15000` |

`topic`은 공백만으로 채울 수 없다. 범위를 벗어나면 `INVALID_CONFIG`다.
사다리는 **세트 칩 하나가 `topic`과 `items`를 함께 정한다** — 방장이 만지는 설정은 2개다(§3.2 · DB-05).
`items`는 게임 시작 시 인원수에 맞춰 `X`로 채우거나 뒤에서 잘라내고, 그 결과를 다시 저장한다(F-310).

---

## 8. 오류 코드

| `code` | HTTP | 상황 |
|---|---|---|
| `ROOM_NOT_FOUND` | 404 | 없는 코드이거나 이미 삭제된 방 |
| `ROOM_EXPIRED` | 410 | 10분 무활동 만료 |
| `ROOM_FULL` | 409 | `pending`+`active`가 정원에 도달 |
| `ROOM_ALREADY_PLAYING` | 409 | 게임 진행 중인 방에 입장 시도 |
| `ROOM_IN_RESULT` | 409 | 결과 화면 상태인 방에 입장 시도 (D-48) |
| `PROFILE_ALREADY_CONFIRMED` | 409 | `active` 참가자의 프로필 재확정 |
| `NICKNAME_INVALID` | 400 | 1~8자·공백 문자 금지 위반 |
| `NICKNAME_DUPLICATED` | 409 | 같은 방에 대소문자 무시 동일 닉네임 존재 (D-44) |
| `AVATAR_TAKEN` | 409 | 명시한 아바타가 이미 쓰이는 중 |
| `NOT_HOST` | 403 | 방장 전용 동작을 참가자가 시도 |
| `NOT_ALL_READY` | 400 | 활성 guest 중 미준비 존재 |
| `NOT_ENOUGH_MEMBERS` | 400 | 게임별 최소 인원 미달 (`game:select` · `game:start` · `game:replay` 세 곳 모두) |
| `INVALID_CONFIG` | 400 | 설정 범위 위반 |
| `INVALID_OPTION` | 400 | 이번 회차 후보가 아닌 대상 |
| `TOO_MANY_CHOICES` | 400 | 허용 표 수 초과 |
| `SELF_VOTE_NOT_ALLOWED` | 400 | 자기 안건·자기 자신 선택 |
| `ALREADY_SUBMITTED` | 409 | 같은 단계에 **다른 내용**으로 재입력 |
| `ROUND_ALREADY_ENDED` | 409 | 마감 후 도착한 입력 |
| `INVALID_ACTION` | 400 | 현재 phase·역할에서 불가능한 동작 |
| `GAME_NOT_FOUND` | 404 | 없는 `gameId` |
| `SESSION_EXPIRED` | 401 | 토큰이 유효하지 않음 |

### 8.1 코드 → 화면

`message`는 그대로 띄울 수 있는 문구지만, **문구의 정본은 [`screen.md`](screen.md)**다. 서버 문구와 화면 문구가
어긋나면 화면 쪽이 이긴다.

| code | 화면 |
|---|---|
| `ROOM_NOT_FOUND` · `ROOM_FULL` | `S-01` 인라인 오류 (코드는 지우지 않는다) |
| `ROOM_ALREADY_PLAYING` · `ROOM_IN_RESULT` | `O-08` 입장 거절 — 상태별 문구 2종 |
| `ROOM_EXPIRED` | `O-07` 방 소멸 안내 (10분 무활동) |
| `SESSION_EXPIRED` | `O-06` 연결 끊김 (재접속 불가 · G-6) |
| `NICKNAME_INVALID` · `NICKNAME_DUPLICATED` · `AVATAR_TAKEN` | `S-03` 인라인 오류 — 그 자리에서 다시 고른다 |
| `NOT_HOST` · `NOT_ALL_READY` · `NOT_ENOUGH_MEMBERS` · `INVALID_CONFIG` | `S-04` 토스트·상태 밴드 |
| 그 밖의 게임 중 오류 | 게임 화면 토스트 |

- `error` 이벤트는 **보낸 사람에게만** 간다. 브로드캐스트하지 않는다.
- 같은 내용의 재전송은 오류가 아니라 **성공**이다(D-52). `ALREADY_SUBMITTED`는 내용이 다를 때만이다.
- 방장 이탈·마지막 이탈·무활동은 오류가 아니라 `room:closed` 이벤트로 알린다.

---

## 9. 트랜잭션과 이벤트 순서

DB 잠금 순서는 [`db.md §15`](db.md#15-잠금-순서)를 따른다. 모든 브로드캐스트는 commit 이후다(C-6).

| 흐름 | 순서 |
|---|---|
| 게임 시작 | room 잠금 → 방장·상태·인원·Ready·config 검증 → snapshot/seed/round/options 생성 → `playing` → commit → `game:started` |
| 참가자 퇴장 | room → round → participant 잠금 → `left_at` → commit → `member:left` |
| 강퇴 | room → participant 잠금 → `left_at` → commit → 대상에게 `member:kicked`, 나머지에게 `member:left { KICKED }` |
| 방장 퇴장 | room → participant 잠금 → `DELETE room` → commit → `room:closed { HOST_LEFT }` |
| 투표 | round → voter → 후보 검증 → ballot/choice 저장 → commit → 완료 상태만 `game:progress` |
| 결과 확정 | round 잠금 → `result_data` 저장 → round `finished` → room `result` → commit → `game:result` |
| 판 취소 | round 잠금 → round `cancelled`+`ended_reason` → room `waiting` → commit → `round:closed { reason }` |
| 대기방 복귀 | room `result` 확인 → `waiting` → Ready 메모리 초기화 → commit → `round:closed { COMPLETED }` |
| 다시 하기 | room 잠금 → 직전 round의 `game_type`·`config` 조회 → 새 snapshot·최소 인원 재검사 → 새 round → commit → `game:started { guideEndsAt: null }` |

---

## 10. requirements로 올린 결정

이 문서를 쓰며 확정됐지만 **사용자가 관측하는 규칙**이라 `requirements.md §6`에 올린 것들이다.
`db.md §17`의 D-44~D-53에 이어진다.

| ID | 결정 |
|---|---|
| D-54 | 게임 설정 기본값의 정본은 서버이며, 프론트는 받은 값을 그린다 |
| D-55 | `다시 하기`는 클라이언트가 설정을 보내지 않고 서버가 직전 판의 값을 쓴다 |
| D-56 | 시간초 동점자 재대결은 같은 판 안에서 진행한다 |
| D-57 | 눈치 내부 라운드는 화면에서 "라운드"로 부르고 내부 식별자는 `subRound`로 둔다 |
| D-58 | 입퇴장·게임 시작 시스템 메시지는 서버가 발행한다 |
| D-59 | 다시 하기·결선·무효 라운드 재시작은 서로 다른 신호를 쓴다 |

---

## 11. 이 문서에서 정한 인터페이스 결정

| ID | 결정 | 근거 |
|---|---|---|
| API-01 | 화면 분기는 HTTP 상태가 아니라 `code` 문자열로 한다 | 같은 409 안에 정원 초과·중복 닉네임·진행 중이 섞여 있어 상태 코드만으로는 갈라지지 않는다 |
| API-02 | 모든 S→C에 `roomVersion`을 실어 순서가 뒤집힌 이벤트를 클라이언트가 버리게 한다 | 부분 갱신 방식이라 순서가 어긋나면 화면이 실제 상태와 달라진다 |
| API-03 | 게임 입력을 `game:action` 하나로 받고 `type`으로 가른다 | 게임별 이벤트를 따로 두면 6종 × 단계만큼 이벤트가 늘어난다 |
| API-04 | `game:progress`는 완료/대기 상태만 싣는다 | G-10이 중간 집계 비공개를 요구하므로 페이로드 자체에 득표가 없어야 안전하다 |
| API-05 | `resultScreenAt`을 절대 시각으로 내린다 | 각자 3초를 세면 네트워크 지연만큼 전환이 어긋나 NFR-02(0.5초)를 못 맞춘다 |
| API-06 | `room:snapshot`에 `selectableGameIds`를 실어 최소 인원 판단 근거를 서버에 둔다 | 프론트가 최소 인원 규칙을 따로 갖지 않아도 되고, 인원 변동 시 서버가 다시 계산해 보낸다 |
| API-07 | 서버 시각·phase 남은 시간·방 만료 남은 시간을 `server:tick` 하나로 1초마다 보낸다 | 셋 다 "서버 시계에 맞춘다"는 같은 일이다. 나누면 같은 주기로 두 이벤트가 나가고 클라이언트가 두 시각을 각각 신뢰해야 한다 |
| API-08 | 프로필 화면의 아바타 선점 현황은 소켓이 아니라 `GET /avatars` 재조회로 갱신한다 | 소켓은 프로필 확정 뒤에 연결되므로(D-46) 그 화면에는 실시간 채널이 없다. 아바타 선점은 사람당 한 번뿐이라 초당 갱신이 필요 없다 |
| API-09 | `game:phase`가 그 단계에 필요한 데이터를 함께 싣는다 (킹메이커 `VOTE`의 `options[]`) | 결선 후보는 `game:tie`가 이미 그렇게 주고 있어, 최초 투표에만 목록이 없는 비대칭이었다. 전용 이벤트를 두면 "phase는 `VOTE`인데 목록은 아직 안 온" 중간 상태가 생긴다 |

---

## 12. 계약 테스트

- [ ] `roomName` 30자 성공 · 31자 실패, `bio` 24자 성공 · 25자 실패
- [ ] 닉네임에 공백이 있으면 `NICKNAME_INVALID`, 대소문자만 다른 중복이면 `NICKNAME_DUPLICATED`
- [ ] `active` 상태에서 `PATCH` 재호출 시 `PROFILE_ALREADY_CONFIRMED`
- [ ] `pending` 2분 만료 후 슬롯 회수 · `currentMembers`가 `pending`을 포함
- [ ] 방장의 `member:ready`가 `INVALID_ACTION`, guest 전원 ready일 때만 `game:start` 성공
- [ ] `waiting`이 아닌 방에 입장 시 `ROOM_ALREADY_PLAYING` / `ROOM_IN_RESULT`가 각각 나옴
- [ ] 강퇴 시 대상은 `member:kicked`, 나머지는 `member:left { KICKED }`를 받음
- [ ] 방장이 `waiting`·`playing`·`result` 어디서 나가도 `room:closed { HOST_LEFT }`이고 `game:result`가 없음
- [ ] `game:select`에서 최소 인원 미달이 `NOT_ENOUGH_MEMBERS`로 거절됨
- [ ] 참가자 이탈로 미달이 되면 선택이 해제되고 `selectableGameIds`가 갱신됨
- [ ] `chat:send`가 200자 초과 시 거절, 보낸 본인도 `chat:message`를 받음
- [ ] 입퇴장 시 서버가 시스템 메시지(`memberId: null`)를 발행함
- [ ] `king.vote`의 `optionIds` 1~3개 · 자기 안건 차단 · 중복 차단
- [ ] `snipe.vote`의 다중 지목 설정과 자기 지목 차단
- [ ] `timer.start`/`stop` payload에 클라이언트 시각이 없음
- [ ] 같은 입력 재전송이 성공을 반환하고, 다른 내용 재전송이 `ALREADY_SUBMITTED`
- [ ] `game:started`의 `guideEndsAt`이 최초 시작에는 시각, `다시 하기`에는 `null`
- [ ] 결선은 `game:phase TIE`, 무효 라운드 재시작은 `game:phase PLAYING`으로 나감
- [ ] 킹메이커 안건 0개 시 `round:closed { NO_OPTIONS }`
- [ ] 과거 결과를 주는 REST·소켓 경로가 존재하지 않음
- [ ] `game:progress`에 득표·기록·입력 내용이 들어 있지 않음
