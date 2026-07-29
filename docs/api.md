# API 기본 명세서

> ⚠️ **이 문서의 수치를 기획 근거로 인용하지 마세요.** 인터페이스 형태를 잡아 둔 문서이며, 글자 수·타임아웃 같은 구체적 수치는 초안 단계에서 임의로 채운 값이 섞여 있었습니다. 확정값의 정본은 [`requirements.md`](requirements.md)이고, 이 문서는 그 결정을 **인터페이스로 옮긴 결과**입니다.
>
> 두 문서가 어긋나면 `requirements.md`가 이깁니다. 고친 뒤에는 [`requirements.md §9.4`](requirements.md#94-정합성-점검-방법)의 점검 명령을 돌려 확인하세요.
>
> 마지막 정합화: **2026-07-29** (소켓 명세 초안 섹션 삭제 · `king.vote` 후보 ID 교정 · 스냅샷 채팅 제거 · `S-04H`/`S-04P` 정정)

# 공통 응답 규격 · 에러 코드

> "모든 응답은 공통 객체를 통해서만 통신. 성공/실패 모두" 규칙을 구체화한 초안입니다.
> 
- 날짜 포맷: ISO 8601 + 타임존 포함으로 통일
- 사용자 인증은 소켓 연결 시 응답받은 `guestToken , hostToken` 으로 인증.

## 성공 응답 (REST & 소켓 통신 공통)

```json
{
  "success": true,
  "code": "OK",
  "message": null,
  "data": { },
  "timestamp": "2026-07-24T15:04:05+09:00"
}
```

## 실패 응답

```json
{
  "success": false,
  "code": "ROOM_ALREADY_PLAYING",
  "message": "이미 진행 중인 방입니다",
  "data": null,
  "timestamp": "2026-07-24T15:04:05+09:00"
}
```

- HTTP 상태코드는 그대로 쓰고, 화면 분기는 `code` 문자열로 판단
- `message`는 그대로 팝업에 띄울 수 있는 한글 문구로 내려줌

## 에러 코드 초안 (REST , 소켓 통신 공통)

| code | HTTP | 상황 | 연결 화면 |
| --- | --- | --- | --- |
| `ROOM_NOT_FOUND` | 404 | 없는 방 코드 / 폭파된 방 | 01 표지 · 코드 입력 |
| `ROOM_ALREADY_PLAYING` | 409 | 게임 진행 중인 방 접속 시도 | 01a · C-04 팝업 |
| `ROOM_FULL` | 409 | 정원 초과 | S-03 → 입장 실패 |
| `ROOM_EXPIRED` | 410 | 10분 무요청 만료 (기획 ①) | 01 표지로 이동 |
| `NICKNAME_DUPLICATED` | 409 | 같은 방 내 닉네임 중복 | S-03 |
| `NICKNAME_INVALID` | 400 | 닉네임 1~8자 위반 | S-03 |
| `AVATAR_TAKEN` | 409 | 이미 선점된 캐릭터 | S-03 (`ㅇㅇ 선점` 배지) |
| `NOT_HOST` | 403 | 방장 전용 기능 호출 | S-04H |
| `NOT_ENOUGH_MEMBERS` | 400 | 게임별 최소 인원 미달 (룰렛·사다리·시간초·눈치 2명 / 킹메이커·저격 3명 · D-25) | S-04H 상태 밴드 |
| `INVALID_CONFIG` | 400 | 게임 설정 값 위반 (예: 사다리 결과 항목 > 참가자 수) | S-04H 설정 패널 |
| `ROUND_NOT_FOUND` | 404 | 종료된 라운드 재접근 | 결과 화면 |
| `ROUND_ALREADY_ENDED` | 409 | 마감 후 도착한 입력 (STOP/UP/투표) | 게임 공통 |
| `ALREADY_SUBMITTED` | 409 | 1회 제한 액션 재입력 | S-07-1, S-08, S-09 |
| `INVALID_ACTION` | 400 | 현재 phase에서 불가한 액션 | 게임 공통 |
| `SELF_VOTE_NOT_ALLOWED` | 400 | 자기 자신/자기 의견에 투표 | S-07, S-09 |
| `ELIMINATED` | 403 | 탈락자의 추가 입력 | S-10 |
| `SESSION_EXPIRED` | 401 | 게스트 토큰 만료 | 전체 |
| `HOST_LEFT` | 410 | 방장 이탈로 방 폭파 | 전체 → 메인 이동 + 팝업 |
| `KICKED` | 403 | 방장에 의해 강퇴됨 | 전체 → 메인 이동 |
- 소켓 에러도 같은 공통 객체 형태로 내려줄지
- 페이징 응답(`채팅 히스토리`)의 `data` 구조 표준형

## REST API 명세

| Method | 엔드포인트 | 역할 | 인증 |
| --- | --- | --- | --- |
| POST | `/api/rooms` | 방 생성 + 방장 가입 (`PENDING`) | - |
| GET | `/api/rooms/{code}` | 초대 코드 검증 | - |
| POST | `/api/rooms/{code}/members` | 가입 — 토큰 발급 (`PENDING`, 프로필 없음) | - |
| GET | `/api/rooms/{code}/avatars` | 아바타 30종 + 선점 현황 | Bearer |
| PATCH | `/api/rooms/{code}/members/me` | 프로필 확정(닉네임/아바타/소개) → `ACTIVE` | Bearer |
| DELETE | `/api/rooms/{code}/members/me` | 의도적 퇴장 (`PENDING`/`ACTIVE` 공용) | Bearer |
| GET | `/api/games` | 게임 메타 목록 조회 (6종) | - |
| GET | `/api/games/{gameId}` | 게임 상세 · 가이드 조회 | - |

**방 코드:** `MODU-` + 6자리 (예: `MODU-427132`). API 경로에는 접두어 없이 6자리만 전달

#### POST `/api/rooms` — 방 만들기 (S-02)

```json
// 요청
{
  "roomName": "4조 · 알고리즘 스터디",
  "maxMembers": 8
}
```

- `roomName`: 1~30자 (S-02 `12 / 30`)
- `maxMembers`: 2~10 (S-02 빠른 선택 2/4/6/8/10)

```json
// 응답 data
{
  "code": "427132",
  "displayCode": "MODU-427132",
  "roomName": "4조 · 알고리즘 스터디",
  "maxMembers": 8,
  "hostToken": "eyJhbGciOi...",
  "memberId": "mbr_01H...",
  "memberStatus": "PENDING",
  "expiresAt": "2026-07-24T15:14:05+09:00"
}
```

> 방 생성과 동시에 방장의 멤버 레코드도 `PENDING` 상태로 함께 만들어지고 `hostToken`이 발급된다. 방장은 이 토큰으로 REST(아바타 조회 등)는 바로 쓸 수 있지만, **소켓은 아직 연결하지 않는다.** S-03에서 `PATCH /rooms/{code}/members/me`로 프로필을 확정(`ACTIVE`)하고 대기방에 들어가는 시점에 소켓을 연결한다
> 

#### GET `/api/rooms/{code}` — 초대 코드 검증

```json
// 응답 data
{
  "code": "427132",
  "roomName": "4조 · 알고리즘 스터디",
  "roomStatus": "WAITING",
  "maxMembers": 8,
  "currentMembers": 5,
  "hostNickname": "코딩왕지호"
}
```

- `roomStatus`: `WAITING` | `PLAYING` | `CLOSED`
- `PLAYING`이면 `409 ROOM_ALREADY_PLAYING` → **C-04 팝업** 노출
- `currentMembers`는 `PENDING`(가입만 완료) + `ACTIVE`(프로필 확정) 인원을 합산한 값이다. 정원 초과를 정확히 막기 위해 아직 프로필을 안 채운 사람도 슬롯으로 계산한다

#### GET `/api/rooms/{code}/avatars` — 캐릭터 선점 현황 (S-03)

가입(`POST /members` 또는 방장의 `POST /rooms`) 이후에만 호출 가능 (Bearer 필요).

```json
// 응답 data
{
  "content": [
    { "avatarId": "A01", "name": "여우",   "imageUrl": "/assets/avatar/a01.png", "taken": true,  "takenBy": "서연" },
    { "avatarId": "A02", "name": "너구리", "imageUrl": "/assets/avatar/a02.png", "taken": false, "takenBy": null }
  ],
  "totalCount": 30
}
```

- 30종 고정 · 클라이언트가 8개씩 2페이지로 분할 (`캐릭터 선택칸 두번째 페이지`)
- `🎲 랜덤 뽑기`는 `taken: false` 중 클라이언트가 무작위 선택
- 아바타는 **클릭 시점이 아니라 `PATCH /members/me` 성공 시점**에 선점이 확정된다. 다른 사람이 먼저 확정지으면 **소켓 `member:joined`** 수신 시 목록을 갱신해 반영한다 (동시 클릭 경합은 늦게 제출한 쪽이 `AVATAR_TAKEN`으로 걸러짐)

#### POST `/api/rooms/{code}/members` — 가입 (01 표지 `참여` 클릭 시)

요청 바디 없음. `GET /rooms/{code}`로 코드가 검증된 직후, 프로필 입력 전에 호출해 **슬롯을 선점하고 토큰만 먼저 받는다.**

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

- 이 시점에 정원(`currentMembers` ≥ `maxMembers`)이 이미 찼으면 `409 ROOM_FULL`
- 방이 `PLAYING`이면 `409 ROOM_ALREADY_PLAYING`, 없는 방이면 `404 ROOM_NOT_FOUND`

> 응답을 받으면 클라이언트는 **곧바로** 이 `guestToken`으로 소켓 핸드셰이크를 시도한다 (S-03 진입과 동시). 연결되면 서버는 **최초 1회** `room:snapshot`으로 현재 방·참가자·게임 상태를 내려준다. 가입 후 15초 안에 핸드셰이크가 없으면 서버가 슬롯을 자동 해제한다. 소켓이 끊기면 따라 방에서 즉시 제거되며 같은 토큰으로 다시 붙는 경로는 없다.
> 

#### PATCH `/api/rooms/{code}/members/me` — 프로필 확정 (S-03 `대기방 입장하기`)

방장·참여자 공용. `PENDING` 상태에서만 호출 가능.

```json
// 요청
{
  "nickname": "코딩왕지호",
  "avatarId": "A06",
  "bio": "@jiho_dev · 프론트엔드 담당"
}
```

- `nickname`: 1~8자, 방 내 유일 (S-03 `5/8`) — 위반 시 `NICKNAME_DUPLICATED` / `NICKNAME_INVALID`
- `avatarId`: 이미 다른 사람이 확정한 아바타면 `AVATAR_TAKEN`
- `bio`: 0~20자, 선택 (S-03 `한 줄 소개 (선택)` · D-42)

```json
// 응답 data
{ "memberId": "mbr_01H...", "memberStatus": "ACTIVE", "nickname": "코딩왕지호", "avatarId": "A06", "bio": "@jiho_dev · 프론트엔드 담당" }
```

- 성공 시 `memberStatus`가 `ACTIVE`로 바뀌고, **이 시점에 소켓 `member:joined`가 브로드캐스트**된다 (참여자는 이미 연결된 소켓으로 다른 사람에게 자신이 보이기 시작하는 순간, 방장은 곧이어 직접 소켓을 여는 순간)
- **참여자**: 이미 가입 시점에 소켓이 연결돼 있으므로 이 호출은 프로필만 갱신한다
- **방장**: 이 호출이 성공한 **직후 클라이언트가 소켓을 연결**한다 (S-04H 대기방 진입)

#### DELETE `/api/rooms/{code}/members/me` — 퇴장

- `PENDING`(S-03에서 뒤로가기) / `ACTIVE`(대기방에서 나가기) 모두 호출 가능
- 방장이 호출하면 **방 폭파**: 전원에게 `room:closed { reason: "HOST_LEFT" }` 후 방 삭제 (기획 ①)
- 참여자면 `member:left { reason: "LEAVE" }` 브로드캐스트

#### POST `/api/rooms` — 방 만들기 (S-02)

```json
// 요청
{
  "roomName": "4조 · 알고리즘 스터디",
  "maxMembers": 8
}
```

- `roomName`: 1~30자 (S-02 `12 / 30`)
- `maxMembers`: 2~10 (S-02 빠른 선택 2/4/6/8/10

#### GET `/api/games` — 게임 메타 목록 조회 (01 표지 슬라이드 · S-04 게임 선택)

인증 불필요. 방 진입 전(01 표지)과 대기방 진입 후(소켓 연결 상태) 어디서든 동일하게 호출되는 **정적 메타데이터** 조회라 REST로 유지한다. 방·소켓 상태와 무관하므로 소켓에 태울 이유가 없다.

```json
// 요청
GET /api/games

// 요청 바디 없음 · 쿼리 파라미터 없음 · Authorization 헤더 불필요
```

```json
// 응답 data
{
  "content": [
    { "gameId": "roulette", "name": "운명의 룰렛", "description": "...", "configSchema": { } },
    { "gameId": "ladder", "name": "랜덤 사다리", "description": "...", "configSchema": { } }
  ],
  "totalCount": 6
}
```

- 게임 6종(운명의 룰렛 · 랜덤 사다리 · 킹메이커 · 시간초 잡기 · 익명 저격 · 눈치게임) 고정 목록 반환
- `configSchema`는 소켓 `game:config`로 보낼 수 있는 설정 항목의 규격(타입·범위). S-04H 설정 패널을 이 값으로 그린다

#### GET `/api/games/{gameId}` — 게임 상세 · 가이드 조회 (C-01 가이드 팝업 · 게임 화면 `?` 버튼)

인증 불필요. 위와 같은 이유로 REST 유지.

```json
// 요청
GET /api/games/roulette

// 요청 바디 없음 · Authorization 헤더 불필요
```

- `gameId`: `roulette` | `ladder` | `kingmaker` | `timer` | `snipe` | `nunchi`
- 없는 `gameId`면 `404 GAME_NOT_FOUND`

```json
// 응답 data
{
  "gameId": "roulette",
  "name": "운명의 룰렛",
  "rules": ["규칙 문구 1", "규칙 문구 2"],
  "configSchema": { }
}
```

- 가이드 팝업(C-01)에 쓰는 규칙 문구, 단계 설명, 설정 스키마를 반환
- 게임 화면 좌측 상단 `?` 버튼 재호출에도 동일 엔드포인트 사용

# **실시간 소켓 이벤트 명세**

> 대기방 진입 이후의 **모든 실시간 통신**을 정의합니다. 방 진입 전(방 생성 · 코드 검증 · 프로필 설정)은 위의 「REST API 명세」를 보세요. 프론트(문석용) / 백엔드(이연주, 원세찬) 검토 후 확정합니다.
> 

## 용어 정리 — 이 문서 읽는 법

| 용어 | 뜻 |
| --- | --- |
| **이벤트(event)** | 소켓으로 주고받는 메시지 한 건의 이름. `chat:send`처럼 `대상:동작` 형태로 짓는다. REST의 "엔드포인트"에 해당한다 |
| **페이로드(payload)** | 이벤트에 딸려 보내는 실제 데이터 덩어리. REST의 요청/응답 바디에 해당한다. 예: `{ text: "안녕" }` |
| **emit** | 이벤트를 "보낸다"는 동작. 클라이언트도 emit하고 서버도 emit한다 |
| **브로드캐스트(broadcast)** | 서버가 같은 방에 있는 **전원에게 동시에** 이벤트를 뿌리는 것. 대기방 화면이 모두에게 같이 갱신되는 원리 |
| **핸드셰이크(handshake)** | 소켓 연결을 처음 맺는 절차. 이때 토큰과 방 코드를 실어 보내 인증받는다 |
| **룸(room)** | 서버가 관리하는 논리적 그룹. 같은 룸에 묶인 소켓끼리만 브로드캐스트가 오간다 |
| **C→S / S→C** | C→S는 클라이언트가 서버로 보내는 이벤트, S→C는 서버가 클라이언트로 보내는 이벤트 |
| **roomVersion** | 방 상태가 바뀔 때마다 1씩 증가하는 정수. 네트워크 사정으로 이벤트 순서가 뒤집혔는지 판단하는 용도 |
| **roundId** | 게임 한 판을 가리키는 식별자. "다시 하기"를 누르면 새 `roundId`가 발급된다 |
| **phase** | 라운드의 진행 단계. `READY`(카운트다운) → `PLAYING`(진행) → `TIE`(동점자 재투표) → `RESULT`(결과) |

## 연결 수명주기

언제 연결하고 언제 끊기는지가 위의 REST 명세와 맞물려 있으므로 먼저 정리합니다.

1. **연결 시점 — 참여자**: `POST /api/rooms/{code}/members` 응답으로 `guestToken`을 받는 즉시 핸드셰이크 (S-03 진입과 동시). 이때는 아직 프로필이 없는 `PENDING` 상태다
2. **연결 시점 — 방장**: `PATCH /api/rooms/{code}/members/me`로 프로필을 확정한 **직후** 핸드셰이크 (S-04H 진입). 방장은 `hostToken`을 쓴다
3. **연결 직후**: 서버가 **최초 1회** `room:snapshot`을 보낸다. 현재 방·참가자·게임 상태 전체가 여기 들어있으므로 클라이언트는 이걸로 화면을 그리고, 이후는 개별 이벤트로 부분 갱신만 한다
4. **다른 사람에게 보이기 시작하는 시점**: 프로필 확정(`PATCH` 성공)으로 `ACTIVE`가 되는 순간 `member:joined`가 브로드캐스트된다. 즉 `PENDING` 참가자는 소켓은 붙어있지만 다른 사람 화면에는 아직 안 보인다
5. **연결 종료 = 퇴장**: 소켓이 끊기면 서버는 즉시 방에서 제거한다. **같은 토큰으로 다시 붙는 경로는 없다**
6. **미연결 자동 해제**: 가입 후 15초 안에 핸드셰이크가 없으면 서버가 슬롯을 푸다

> ⚠️ **재접속 개념이 없다는 게 이 설계의 핵심입니다.** "끊겼다가 돌아오면 상태 복구" 같은 복잡한 처리가 필요 없는 대신, 새로고침 한 번이면 방에서 빠진다는 뜻이라 프론트가 이탈 경고를 띄우는 게 좋습니다.
> 

## 공통 규칙

- 전송: WebSocket ([Socket.IO](http://Socket.IO) 여부는 기술 스택 확정 후)
- **룸 단위**: `room:{code}` — `code`는 `MODU-` 접두어 없이 6자리 숫자만 (예: `room:427132`). REST 경로 규칙과 동일하게 맞춘다
- **인증**: 핸드셰이크 시 `guestToken`(참여자) 또는 `hostToken`(방장) 전달. 유효하지 않으면 연결 거부 + `SESSION_EXPIRED`
- **응답 규격**: 모든 S→C 이벤트는 「공통 응답 규격」의 공통 객체(`success`/`code`/`message`/`data`/`timestamp`)로 감싸서 내려간다. 아래 표의 페이로드는 `data` 안에 들어가는 부분이다
- **순서 보장**: 모든 S→C 이벤트의 `data`에는 `roomVersion`이 포함된다. 클라이언트는 마지막으로 반영한 번호보다 작거나 같은 이벤트는 무시한다
- **권한 검증**: 방장 전용 이벤트를 참여자가 보내면 `NOT_HOST`를 보낸 사람에게만 돌려준다 (브로드캐스트 없음)

## 대기방 — 클라이언트가 보내는 이벤트 (C→S)

| # | 이벤트 | 페이로드 | 기능 | 보낼 수 있는 사람 |
| --- | --- | --- | --- | --- |
| 1 | `member:ready` | `{ ready }` | 준비 완료 토글 | 참여자 |
| 2 | `member:kick` | `{ memberId }` | 참가자 강퇴 | 방장 |
| 3 | `chat:send` | `{ text }` | 채팅 메시지 전송 | 전원 |
| 4 | `chat:typing` | `{ typing }` | 입력 중 표시 | 전원 |
| 5 | `game:select` | `{ gameId }` | 게임 선택 | 방장 |
| 6 | `game:config` | `{ gameId, config }` | 게임 옵션 변경 | 방장 |
| 7 | `game:random` | `{ }` | 랜덤 게임 뽑기 | 방장 |
| 8 | `game:start` | `{ }` | 게임 시작 | 방장 |

#### 1. `member:ready` — 준비 완료 토글 (S-04P, 참여자 전용)

참여자가 하단 `준비 완료` 버튼을 누를 때마다 보낸다. 방장은 준비 개념이 없으므로 보내지 않는다.

- `ready` (boolean) — `true`면 준비 완료, `false`면 해제
- 서버는 받은 즉시 `member:ready_changed`를 전원에게 브로드캐스트한다

```json
{ "ready": true }
```

#### 2. `member:kick` — 참가자 강퇴 (S-04H, 방장 전용)

- `memberId` (string) — 강퇴할 대상. 자기 자신을 보내면 `INVALID_ACTION`
- 대상자에게는 `error { code: "KICKED" }` → 소켓 강제 종료 → 01 표지로 이동
- 나머지에게는 `member:left { reason: "KICK" }` 브로드캐스트

```json
{ "memberId": "mbr_01H..." }
```

#### 3. `chat:send` — 채팅 메시지 전송

- `text` (string) — **길이 제한 없음**(화면설계서 `S-04H` 기준). 빈 문자열이거나 공백만 있으면 서버가 무시
- 서버가 `messageId`와 `sentAt`을 붙여 `chat:message`로 전원에게 되돌려준다 (보낸 본인 포함)
- 본인 메시지도 서버를 한 번 다녀서 돌아오므로, 클라이언트가 미리 그리지 않고 기다렸다 그리면 순서가 보장된다

```json
{ "text": "다 모였으면 시작해요" }
```

#### 4. `chat:typing` — 입력 중 표시

- `typing` (boolean) — 입력 시작 `true`, 중단·전송 후 `false`
- 상태만 전달하는 이벤트라 저장하지 않는다. 클라이언트는 3초간 갱신이 없으면 자동으로 `false` 처리한다

#### 5. `game:select` — 게임 선택 (방장 전용)

- `gameId` (string) — `roulette` | `ladder` | `kingmaker` | `timer` | `snipe` | `nunchi`
- 서버는 해당 게임의 기본 설정값을 적용하고 `game:selected`로 전원에게 알린다

#### 6. `game:config` — 게임 옵션 변경 (방장 전용)

방장이 우측 설정 패널을 조작할 때마다 보낸다. 참여자 화면은 읽기 전용이지만 **실시간으로 같이 바뀌어야** 한다.

- `gameId` (string) — 현재 선택된 게임. 서버가 가진 값과 다르면 `INVALID_ACTION`
- `config` (object) — 항목과 범위는 `GET /api/games/{gameId}`의 `configSchema`를 따른다. 위반 시 `INVALID_CONFIG`
- 타이핑할 때마다 보내면 트래픽이 과하므로 클라이언트가 200~300ms 디바운스 후 전송하는 걸 권장

```json
{ "gameId": "ladder", "config": { "resultItems": ["청소", "설거지", "면제"] } }
```

#### 7. `game:random` — 랜덤 게임 뽑기 (방장 전용)

- 페이로드 없음. 서버가 6종 중 무작위로 고른다
- **클라이언트가 아니라 서버가 뽑는 이유**: 클라이언트가 뽑으면 방장 화면과 참여자 화면의 결과가 엇갈릴 수 있다
- 결과는 `game:selected`로 전원에게 동일하게 내려간다

#### 8. `game:start` — 게임 시작 (방장 전용)

- 페이로드 없음. 현재 선택된 게임과 설정으로 라운드를 생성한다
- 서버 검증 조건: `ACTIVE` 인원 2명 이상(`NOT_ENOUGH_MEMBERS`), 게임 선택됨, 설정값 유효(`INVALID_CONFIG`)
- 성공 시 새 `roundId` 발급 + `game:started` 브로드캐스트. 방 상태가 `PLAYING`으로 바뀌어 이후 새로 들어오려는 사람은 `ROOM_ALREADY_PLAYING`으로 막힌다
- 결과 화면의 `↻ 다시 하기`도 **같은 이벤트**를 재사용한다 (새 `roundId` 발급)

## 대기방 — 서버가 보내는 이벤트 (S→C)

| # | 이벤트 | 페이로드 | 기능 | 받는 사람 |
| --- | --- | --- | --- | --- |
| 9 | `room:snapshot` | `{ room, members, game }` | 연결 직후 현재 상태 전체 | 본인만 |
| 10 | `member:joined` | `{ member }` | 새 참가자 등장 | 전원 |
| 11 | `member:left` | `{ memberId, reason }` | 참가자 이탈 | 전원 |
| 12 | `member:ready_changed` | `{ memberId, ready, readyCount, activeCount }` | READY n/m 갱신 | 전원 |
| 13 | `chat:message` | `{ messageId, memberId, text, sentAt }` | 채팅 메시지 수신 | 전원 |
| 14 | `chat:typing` | `{ memberId, typing }` | ●●● 표시 | 본인 제외 |
| 15 | `game:selected` | `{ gameId, config, configSchema }` | 선택된 게임 반영 | 전원 |
| 16 | `game:config_changed` | `{ config }` | 옵션 변경 반영 | 전원 |
| 17 | `game:started` | `{ roundId, gameId, config }` | 게임 화면으로 전환 | 전원 |
| 18 | `room:closed` | `{ reason }` | 방 종료(폭파) | 전원 |
| 19 | `error` | `{ code, message }` | 에러 통지 | 보낸 사람만 |

#### 9. `room:snapshot` — 연결 직후 최초 1회

이 이벤트 하나로 대기방 화면을 통째로 그릴 수 있어야 합니다. 이후에는 개별 이벤트로 부분 갱신만 합니다.

```json
{
  "room": { "code": "427132", "roomName": "4조 · 알고리즘 스터디", "maxMembers": 8, "hostMemberId": "mbr_01H..." },
  "members": [
    { "memberId": "mbr_01H...", "nickname": "코딩왕지호", "avatarId": "A06", "bio": "...", "isHost": true, "ready": false }
  ],
  "game": { "gameId": "roulette", "config": { }, "configSchema": { } },
  "roomVersion": 12
}
```

- `members`에는 `ACTIVE` 상태만 들어간다 (프로필 입력 중인 `PENDING`은 제외)
- **채팅은 스냅샷에 들어가지 않는다.** 서버는 채팅을 저장도 보관도 하지 않으며 화면 복원은 클라이언트 로컬 스토리지가 담당한다(D-26). 따라서 나중에 들어온 사람은 이전 대화를 볼 수 없다
- 게임이 아직 선택 안 됐으면 `game`은 `null`

#### 10. `member:joined` — 새 참가자 등장

누군가 `PATCH /members/me`로 프로필을 확정해 `ACTIVE`가 된 순간 발생합니다. **소켓 연결 시점과 다르다는 게 포인트**입니다.

- `member` (object) — `memberId`, `nickname`, `avatarId`, `bio`, `isHost`, `ready`
- 받은 클라이언트는 참가자 그리드에 카드를 추가하고 채팅창에 시스템 말풍선을 띄운다
- S-03에 머물러 있는 사람도 이걸 받아서 아바타 선점 현황을 갱신한다

#### 11. `member:left` — 참가자 이탈

- `memberId` (string) — 나간 사람
- `reason` (string) — `LEAVE`(직접 나감) | `KICK`(강퇴) | `DISCONNECT`(연결 끊김)
- 방장이 나간 경우는 이 이벤트가 아니라 `room:closed`가 나간다 (방장 이탈 = 방 폭파)

#### 12. `member:ready_changed` — 준비 상태 갱신

- `readyCount` / `activeCount` — 화면의 `READY n/m` 밴드에 그대로 쓴다. 클라이언트가 직접 세지 않고 서버 값을 쓰면 오차가 안 생긴다
- 준비 완료가 게임 시작의 필수 조건인지는 미확정 (아래 확정 항목 6번)

#### 13. `chat:message` — 채팅 메시지 수신

- `memberId`가 본인이면 오른쪽 말풍선, 아니면 왼쪽. `null`이면 시스템 메시지로 가운데 정렬
- 입퇴장 시스템 문구는 서버가 따로 내려주지 않고, 클라이언트가 `member:joined`/`member:left`를 보고 직접 그린다

#### 15. `game:selected` — 선택된 게임 반영

- `config`는 해당 게임의 **기본값**이 채워져 내려온다 (방장이 아직 손대지 않은 상태)
- `configSchema`는 REST `GET /api/games/{gameId}`와 동일한 값. 중복 전송을 생략할지는 확정 항목 7번 참고

#### 18. `room:closed` — 방 종료

방이 사라지는 모든 경우에 전원에게 나가고, 받은 즉시 소켓이 닫힙니다.

- `reason` (string) — `HOST_LEFT`(방장 이탈) | `EXPIRED`(10분 무요청 만료)
- 클라이언트는 사유별 팝업을 띄우고 01 표지로 보낸다

#### 19. `error` — 에러 통지

- 보낸 사람에게만 간다. 브로드캐스트하지 않는다
- `code`는 「공통 응답 규격 · 에러 코드」 표와 동일한 문자열을 쓴다 (REST와 공용)
- `message`는 그대로 토스트에 띄울 수 있는 한글 문구

## 게임 진행 (S-05 ~ S-10)

- `roundId` (string) — 현재 라운드. 끝난 라운드면 `ROUND_ALREADY_ENDED`

게임별로 이벤트를 나누지 않고 **공용 이벤트 + type 분기**로 가는 방향을 제안합니다.

| 방향 | 이벤트 | 페이로드 | 대상 화면 |
| --- | --- | --- | --- |
| C→S | `game:action` | `{ roundId, type, payload }` | 아래 type 표 참고 |
| S→C | `game:phase` | `{ roundId, phase, deadlineAt }` | READY / PLAYING / TIE / RESULT |
| S→C | `game:tick` | `{ roundId, serverTime, remainMs }` | 눈치게임 타이머 동기화 |
| S→C | `game:progress` | `{ roundId, payload }` | 투표 수, 생존자 수 등 중간 상태 |
| S→C | `game:tie` | `{ roundId, candidates }` | S-TIE 동점자 팝업 (S-07/08/09/10 공용) |
| S→C | `game:result` | `{ roundId, type, result }` | 결과 화면 (S-05b ~ S-10b) |

#### `game:action` — 플레이어 입력 (C→S)

게임 중 플레이어가 버튼을 누르는 모든 행위가 이 이벤트 하나로 들어옵니다.

- `type` (string) — 아래 표의 값 중 하나. 현재 게임과 안 맞으면 `INVALID_ACTION`
- `payload` (object) — `type`마다 모양이 다르다
- 1회 제한 액션을 두 번 보내면 `ALREADY_SUBMITTED`, 탈락자가 보내면 `ELIMINATED`

```json
{ "roundId": "rnd_01H...", "type": "king.vote", "payload": { "candidateId": "cnd_01H..." } }
```

| 게임 | type | payload | 보내는 사람 | 화면 |
| --- | --- | --- | --- | --- |
| 운명의 룰렛 | `roulette.pick` | `{ }` | 방장만 | S-05 · PICK 버튼 |
| 랜덤 사다리 | `ladder.start` | `{ mode, memberId? }` | 방장만 | S-06 · 개별/동시 진행 |
| 킹메이커 | `king.opinion` | `{ text }` | 전원 (1회) | S-07-1 · 의견 제출 |
| 킹메이커 | `king.vote` | `{ candidateId }` | 전원 (설정 표 수만큼) | S-07 · 투표 |
| 시간초 잡기 | `timer.start` | `{ clientStartAt }` | 전원 (1회) | S-08 · START 버튼 |
| 시간초 잡기 | `timer.stop` | `{ clientStopAt }` | 전원 (1회) | S-08 · STOP 버튼 |
| 익명 저격 | `snipe.vote` | `{ targetMemberId }` | 전원 (1~2회) | S-09 · 대상 선택 |
| 눈치게임 | `nunchi.up` | `{ }` | 생존자 | S-10 · UP 버튼 |
- `mode` (string) — `single`(참가자 한 명만 출발) | `all`(동시 시작). `single`이면 `memberId`가 함께 온다. **참가자는 이 액션을 보낼 수 없다**(D-16 · 레인 선택 없음)
- `text` (string) — 킹메이커 의견, 1~120자
- `candidateId` (string) — 투표할 **후보 식별자**. 멤버 식별자로 받지 않는다. 자기가 낸 후보면 서버가 작성자를 대조해 `SELF_VOTE_NOT_ALLOWED`로 거부한다(D-21)
  - 1인당 표 수는 방장 설정(기본 1표)을 따르고, **같은 후보에 몰아주기가 가능**하다. 총 표 수를 넘기면 `ALREADY_SUBMITTED`(D-40)
- `targetMemberId` (string) — 저격 지목 대상. 자기 자신이면 `SELF_VOTE_NOT_ALLOWED`
  - `중복 투표 가능` 설정이면 **1인 2표**이며 같은 대상에 몰아줄 수 있다. 초과분은 `ALREADY_SUBMITTED`(D-39)
- `clientStartAt` / `clientStopAt` (string) — 클라이언트가 버튼을 누른 시각. **참고용이며 판정은 서버 수신 시각으로 한다**(D-02)

#### `game:phase` — 단계 전환 (S→C)

라운드가 다음 단계로 넘어갈 때마다 전원에게 나갑니다. 클라이언트는 이 이벤트만 보고 화면을 전환하면 됩니다.

- `phase` (string) — `READY` | `PLAYING` | `TIE` | `RESULT`
- `deadlineAt` (string) — 이 단계가 끝나는 시각. 제한시간이 없는 단계면 `null`
- `READY`는 게임 시작 직후 카운트다운 구간으로, 전원의 화면을 맞추는 역할을 한다

#### `game:tick` — 타이머 동기화 (S→C)

사람마다 타이머가 다르게 보이는 걸 막습니다.

- `serverTime` (string) — 서버 기준 현재 시각
- `remainMs` (number) — 남은 시간(밀리초)
- **주기는 1초**다. 첫 tick으로 자기 시계와의 오차를 재고 그 뒤로는 클라이언트 자체 타이머를 돌리되, 매 tick마다 오차를 다시 보정한다(D-47). 숫자를 tick마다 새로 그리지는 않는다 — 네트워크가 튈 때 카운트가 끊겨 보이기 때문이다

#### `game:progress` — 중간 집계 (S→C)

- 게임별로 `payload` 모양이 다르다: 킹메이커·저격은 `{ votedCount, totalCount }`, 눈치게임은 `{ currentNumber, aliveMemberIds }`
- **누가 무엇을 선택했는지는 넣지 않는다** — 익명 저격·킹메이커는 익명성이 기획 의도라 중간에 새면 안 된다

#### `game:tie` — 동점자 발생 (S→C)

- `candidates` (array) — 동점인 `memberId` 목록
- 이걸 받으면 S-TIE 팝업을 띄우고, 해당 후보들끼리만 다시 `game:action`을 보낸다
- 재투표는 새 라운드가 아니라 **같은 `roundId` 안의 `TIE` phase**다

#### `game:result` — 최종 결과 (S→C)

- `type` (string) — 게임 종류. 클라이언트는 이걸로 결과 화면 레이아웃을 고른다 (S-05b ~ S-10b)
- `result` (object) — 게임별 결과 데이터. 룰렛·사다리는 당첨자, 킹메이커·저격은 득표 분포, 눈치는 탈락 순서 등
- 익명 게임을 결과 단계에서 실명 공개하는지는 미확정 (확정 항목 8번)

#### `round:closed` — 대기방 복귀 (S→C)

결과 화면에서 방장이 `← 대기방으로`를 누를 때 전원에게 나갑니다. 방 상태가 `PLAYING` → `WAITING`으로 돌아갑니다.

방장이 보내는 C→S 이벤트는 `round:close`로 따로 둔다. `game:action`에 흡수하지 않는다.

## 확정 기록

**이 절의 질문은 전건 해소되었다.** 확정 내용은 [`requirements.md §7`](requirements.md#7-확정된-설계-결정)의 `D-` 표가 정본이며, 아래는 어떤 질문이 어떤 결정으로 닫혔는지 되짚기 위한 기록이다.

| # | 질문 | 확정 | 결정 ID |
| --- | --- | --- | --- |
| 1 | 룰렛·사다리 결과 확정 시점 | 서버가 미리 확정하고 애니메이션만 재생 | D-01 |
| 2 | 시간초·눈치 판정 기준 시각 | **둘 다 서버 수신 시각.** 클라이언트가 보낸 시각은 참고용 | D-02 |
| 3 | 게임 중 이탈자 | 자동 기권 · 라운드는 계속 | D-03 |
| 4 | 동점 재대결 상한 | 제한 없음 | D-04 |
| 5 | 가이드 노출 기록 | 클라이언트 로컬 · 게임별 저장 | D-05 |
| 6 | 준비 완료 강제 | 참여자 전원 READY가 시작 필수 조건 | D-06 |
| 7 | `configSchema` 중복 전송 | REST로 받았다면 소켓에서 생략 가능 | D-07 |
| 8 | 익명 게임 실명 공개 | 방장이 설정에서 선택 · 투표 중에는 어느 모드든 익명 | D-08 |
| 9 | 채팅 과거 메시지 | 불러오지 않는다. 서버가 저장하지 않고 로컬 스토리지로 단일화 | D-09 · D-26 |
| 10 | 대기방 복귀 이벤트 | `round:close`로 분리 | D-10 |

> ⚠️ **2번은 원래 "시간초는 클라 요청 시각"으로 답이 적혀 있었다.** 2026-07-29 팀 확인으로 **시간초도 서버 수신 시각**(D-02)으로 통일했다. 클라이언트 시각을 쓰면 개발자 도구로 기록을 위조할 수 있어 [NFR-05](requirements.md#nfr-05--결과-무결성)가 성립하지 않기 때문이다. `timer.start`·`timer.stop`의 `clientStartAt`·`clientStopAt`은 **참고 필드로만 남긴다.**

## 2026-07-29 추가 확정

| 항목 | 확정 | 결정 ID |
| --- | --- | --- |
| 저격 `중복 투표 가능` | **1인 2표** · 같은 대상에 몰아주기 허용. 초과분은 `ALREADY_SUBMITTED` | D-39 |
| 킹메이커 다표 설정 | **같은 후보에 몰아주기 허용.** 총 표 수가 설정값을 넘을 때만 거부 | D-40 |
| 시간초 동점 재대결 | 같은 목표 시간으로 **동점자만 `START`부터 재시작.** 회차 제한 30초도 다시 적용 | D-41 |
| 한 줄 소개 · 저격 질문 길이 | `bio` **20자** · 저격 질문 직접 입력 **30자** | D-42 |
| `PENDING` 슬롯 회수 | 가입 후 **3분** 안에 프로필을 확정하지 않으면 서버가 슬롯을 해제한다 | D-43 |
| 결과 화면 방장 이탈 | 방은 폭파하되 **참여자 결과 화면은 유지**하고 PNG 저장만 허용한다 | D-44 |
| 방 만료 타이머 | **사용자 행동만** 갱신한다(채팅·준비·설정·게임 입력). `PLAYING` 중에는 만료 타이머를 멈춘다 | D-45 |
| 눈치게임 라운드 간격 | 라운드 사이 **3초 카운트다운** | D-46 |
| 서버 시각 동기화 | 최초 1회 오차 측정 + **1초 주기 `game:tick`** 보정 | D-47 |
| 사다리 결과 항목 중복 | **허용한다**(같은 역할에 2명이 배정될 수 있다) | D-48 |