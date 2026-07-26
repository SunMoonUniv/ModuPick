# REST API 명세

> **방 진입 전**(방 생성 · 코드 검증 · 프로필 설정)의 통신을 정의한다.
> 대기방 진입 이후의 실시간 통신은 [`06_api/02_socket.md`](02_socket.md)를 본다.
> 응답 형식과 에러 코드는 [`06_api/03_error_codes.md`](03_error_codes.md)를 따른다.
> 최종 수정: 2026-07-26 · 소유자: [TEAM.md](../TEAM.md) 참조

---

## 0. 공통 규칙

- 모든 응답은 [`00_conventions.md`](00_conventions.md)의 공통 객체로 감싼다.
  아래 예시의 `// 응답 data`는 그 객체의 `data` 필드 내용이다.
- **방 코드는 숫자 4자리**다([D-01](../DECISIONS.md#d-01)).
  API 경로에는 `MODU-` 접두어 없이 **4자리만** 전달한다 — `/api/rooms/4271`.
  `MODU-4271`은 화면에 보여줄 때만 쓰는 표시 형식이다.
- 인증은 `Authorization: Bearer {token}` 헤더로 한다. 토큰은 `hostToken` 또는 `guestToken`이다.

---

## 1. 엔드포인트 목록

| Method | 엔드포인트 | 역할 | 인증 | 화면 |
|---|---|---|---|---|
| `POST` | `/api/rooms` | 방 생성 + 방장 가입(`PENDING`) | — | `S-02` |
| `GET` | `/api/rooms/{code}` | 초대 코드 검증 | — | `S-01` |
| `POST` | `/api/rooms/{code}/members` | 가입 — 슬롯 선점 + 토큰 발급 | — | `S-01` → `S-03` |
| `GET` | `/api/rooms/{code}/avatars` | 아바타 15종 + 선점 현황 | Bearer | `S-03` |
| `PATCH` | `/api/rooms/{code}/members/me` | 프로필 확정 → `ACTIVE` | Bearer | `S-03` |
| `DELETE` | `/api/rooms/{code}/members/me` | 퇴장 | Bearer | `S-03` · `S-04-*` |
| `GET` | `/api/games` | 게임 메타 목록(6종) | — | `S-01` · `S-04-HOST` |
| `GET` | `/api/games/{gameId}` | 게임 상세 · 가이드 | — | `M-01` |

---

## 2. 방

### `POST /api/rooms` — 방 만들기 (`S-02`)

```json
// 요청
{
  "roomName": "4조 · 알고리즘 스터디",
  "maxMembers": 8
}
```

| 필드 | 규칙 |
|---|---|
| `roomName` | 1~30자. 직접 입력만 지원([D-33](../DECISIONS.md#d-33)) |
| `maxMembers` | 2~10. **생성 후 변경 불가**([D-32](../DECISIONS.md#d-32)) |

```json
// 응답 data
{
  "code": "4271",
  "displayCode": "MODU-4271",
  "roomName": "4조 · 알고리즘 스터디",
  "maxMembers": 8,
  "hostToken": "eyJhbGciOi...",
  "memberId": "mbr_01H...",
  "memberStatus": "PENDING",
  "expiresAt": "2026-07-26T15:14:05+09:00"
}
```

- 코드는 **서버가 자동 발급**한다. 방장이 지정할 수 없다.
  활성 방과 충돌하면 재추첨하고, 발급에 실패하면 `ROOM_CODE_EXHAUSTED`([D-02](../DECISIONS.md#d-02)).
- ⚠️ `expiresAt`의 의미는 [D-03](../DECISIONS.md#d-03) 승인 결과에 따라 달라진다.
  기본안(소켓 0명 10분)에서는 **소켓이 연결되면 갱신되는 값**이다.

> **방 생성과 동시에 방장의 멤버 레코드도 `PENDING`으로 만들어지고 `hostToken`이 발급된다.**
> 방장은 이 토큰으로 REST(아바타 조회 등)를 바로 쓸 수 있지만 **소켓은 아직 연결하지 않는다.**
> `S-03`에서 프로필을 확정(`ACTIVE`)하고 대기방에 들어가는 시점에 소켓을 연결한다.

### `GET /api/rooms/{code}` — 초대 코드 검증 (`S-01`)

```json
// 응답 data
{
  "code": "4271",
  "roomName": "4조 · 알고리즘 스터디",
  "roomStatus": "WAITING",
  "maxMembers": 8,
  "currentMembers": 5,
  "hostNickname": "지호"
}
```

- `roomStatus`: `WAITING` | `PLAYING` | `CLOSED`
- **`PLAYING`이면 `409 ROOM_ALREADY_PLAYING`** → `M-04` 차단 팝업을 띄운다.
- **`currentMembers`는 `PENDING` + `ACTIVE` 합산**이다.
  아직 프로필을 안 채운 사람도 슬롯을 차지해야 정원 초과를 정확히 막을 수 있다.

---

## 3. 멤버

### `POST /api/rooms/{code}/members` — 가입 (`S-01`에서 `참여` 클릭)

**요청 바디 없음.** `GET /rooms/{code}`로 코드가 검증된 직후, 프로필 입력 전에 호출해
**슬롯을 선점하고 토큰만 먼저 받는다.**

```json
// 응답 data
{
  "guestToken": "eyJhbGciOi...",
  "memberId": "mbr_01H...",
  "role": "GUEST",
  "memberStatus": "PENDING",
  "currentMembers": 6,
  "maxMembers": 8
}
```

| 상황 | 응답 |
|---|---|
| 정원이 이미 참 | `409 ROOM_FULL` |
| 방이 `PLAYING` | `409 ROOM_ALREADY_PLAYING` |
| 없는 방 | `404 ROOM_NOT_FOUND` |

> **응답을 받으면 클라이언트는 곧바로 이 `guestToken`으로 소켓 핸드셰이크를 시도한다**(`S-03` 진입과 동시).
> 연결되면 서버가 **최초 1회** `room:snapshot`으로 현재 방·참가자·게임 상태를 내려준다.
> **가입 후 15초 안에 핸드셰이크가 없으면 서버가 슬롯을 자동 해제한다.**

### `GET /api/rooms/{code}/avatars` — 아바타 선점 현황 (`S-03`)

가입(`POST /members` 또는 방장의 `POST /rooms`) 이후에만 호출할 수 있다 (Bearer 필요).

```json
// 응답 data
{
  "content": [
    { "avatarId": "A01", "name": "여우",   "imageUrl": "/assets/avatar/a01.png", "taken": true,  "takenBy": "서연" },
    { "avatarId": "A02", "name": "너구리", "imageUrl": "/assets/avatar/a02.png", "taken": false, "takenBy": null }
  ],
  "totalCount": 15
}
```

- **15종 고정.** 5×3 그리드 한 화면에 전부 표시하며 **페이징하지 않는다**([D-08](../DECISIONS.md#d-08)).
- 무작위 선택 기능은 제공하지 않는다([D-09](../DECISIONS.md#d-09)).
- **선점은 클릭 시점이 아니라 `PATCH /members/me` 성공 시점에 확정된다.**
  다른 사람이 먼저 확정하면 소켓 `member:joined` 수신 시 목록을 갱신해 반영한다.
  동시 클릭 경합은 **늦게 제출한 쪽이 `AVATAR_TAKEN`으로 걸러진다.**

### `PATCH /api/rooms/{code}/members/me` — 프로필 확정 (`S-03` `대기방 입장하기`)

방장·참여자 공용. **`PENDING` 상태에서만** 호출할 수 있다.

```json
// 요청
{
  "nickname": "지호",
  "avatarId": "A06",
  "bio": "@jiho_dev · 프론트엔드 담당"
}
```

| 필드 | 규칙 | 위반 시 |
|---|---|---|
| `nickname` | **1~8자 · 방 안에서 유일 · 필수** | `NICKNAME_INVALID` / `NICKNAME_DUPLICATED` |
| `avatarId` | 방 안에서 유일 | `AVATAR_TAKEN` |
| `bio` | 0~24자 · **선택** | — |

```json
// 응답 data
{
  "memberId": "mbr_01H...",
  "memberStatus": "ACTIVE",
  "nickname": "지호",
  "avatarId": "A06",
  "bio": "@jiho_dev · 프론트엔드 담당"
}
```

- 성공하면 `memberStatus`가 `ACTIVE`로 바뀌고, **이 시점에 소켓 `member:joined`가 브로드캐스트**된다.
- **참여자**: 가입 시점에 이미 소켓이 연결돼 있으므로 이 호출은 프로필만 갱신한다.
- **방장**: 이 호출이 성공한 **직후에 클라이언트가 소켓을 연결**한다(`S-04-HOST` 진입).

### `DELETE /api/rooms/{code}/members/me` — 퇴장

- `PENDING`(`S-03`에서 뒤로가기) · `ACTIVE`(대기방에서 나가기) 모두 호출 가능하다.
- **방장이 호출하면 방 폭파**: 전원에게 `room:closed { reason: "HOST_LEFT" }`를 보내고 방을 삭제한다([D-05](../DECISIONS.md#d-05)).
- 참여자면 `member:left { reason: "LEAVE" }`를 브로드캐스트한다.

---

## 4. 게임 메타

방 진입 전(`S-01`)과 대기방 진입 후(`S-04-HOST`) 어디서든 동일하게 호출되는 **정적 메타데이터**다.
방·소켓 상태와 무관하므로 소켓에 태우지 않고 REST로 유지한다. **인증 불필요.**

### `GET /api/games` — 게임 목록 (`S-01` 슬라이드 · `S-04-HOST` 게임 선택)

요청 바디·쿼리 파라미터·`Authorization` 헤더 모두 없다.

```json
// 응답 data
{
  "content": [
    { "gameId": "roulette", "name": "운명의 룰렛", "description": "...", "configSchema": { } },
    { "gameId": "ladder",   "name": "랜덤 사다리", "description": "...", "configSchema": { } }
  ],
  "totalCount": 6
}
```

- 게임 6종 고정 목록을 반환한다 — 운명의 룰렛 · 랜덤 사다리 · 킹메이커 · 시간초 잡기 · 익명 저격 · 눈치게임.
- `configSchema`는 소켓 `game:config`로 보낼 수 있는 설정 항목의 규격(타입·범위)이다.
  **`S-04-HOST`의 설정 패널을 이 값으로 그린다.**
  항목의 근거는 [`05_game_rules/00_common.md` §2](../05_game_rules/00_common.md#2-게임별-방장-설정-요약).

### `GET /api/games/{gameId}` — 게임 상세 · 가이드 (`M-01` · 게임 화면 `?` 버튼)

```json
// 응답 data
{
  "gameId": "roulette",
  "name": "운명의 룰렛",
  "rules": ["규칙 문구 1", "규칙 문구 2"],
  "configSchema": { }
}
```

- `gameId`: `roulette` | `ladder` | `kingmaker` | `timer` | `snipe` | `nunchi`
- 없는 `gameId`면 `404 GAME_NOT_FOUND`.
- 가이드 팝업(`M-01`)의 규칙 문구·단계 설명·설정 스키마를 반환한다.
- 게임 화면 좌상단 `?` 버튼의 재호출에도 **같은 엔드포인트**를 쓴다.

---

## 5. 왜 이 8개만 REST인가

**방 진입 전**에는 아직 소켓이 없거나, 소켓과 무관한 정적 데이터를 다루기 때문이다.
대기방에 들어간 뒤의 모든 통신은 소켓으로 간다.

| 구분 | 통신 | 이유 |
|---|---|---|
| 방 생성 · 코드 검증 · 가입 | REST | 소켓 연결 이전 단계 |
| 프로필 확정 | REST | 이 호출의 성공이 소켓 연결(방장) 또는 노출(참여자)의 트리거 |
| 아바타 목록 | REST | 카탈로그 조회 |
| 게임 메타 | REST | 방·소켓 상태와 무관한 정적 데이터 |
| 대기방 · 게임 진행 전부 | **소켓** | 실시간 동기화가 본질 |
