# WebSocket 이벤트 명세

> **대기방 진입 이후의 모든 실시간 통신**을 정의한다.
> 방 진입 전(방 생성 · 코드 검증 · 프로필 설정)은 [`06_api/01_rest.md`](01_rest.md)를 본다.
> 응답 형식과 에러 코드는 [`06_api/03_error_codes.md`](03_error_codes.md)를 따른다.
> 최종 수정: 2026-07-26 · 소유자: [TEAM.md](../TEAM.md) 참조

---

## 0. 용어 — 이 문서 읽는 법

| 용어 | 뜻 |
|---|---|
| **이벤트(event)** | 소켓으로 주고받는 메시지 한 건의 이름. `chat:send`처럼 `대상:동작` 형태로 짓는다. REST의 "엔드포인트"에 해당 |
| **페이로드(payload)** | 이벤트에 딸려 보내는 데이터. REST의 요청/응답 바디에 해당. 예: `{ text: "안녕" }` |
| **emit** | 이벤트를 "보낸다"는 동작. 클라이언트도 서버도 emit한다 |
| **브로드캐스트** | 서버가 같은 방의 **전원에게 동시에** 이벤트를 뿌리는 것 |
| **핸드셰이크** | 소켓 연결을 처음 맺는 절차. 이때 토큰과 방 코드를 실어 인증받는다 |
| **룸(room)** | 서버가 관리하는 논리적 그룹. 같은 룸의 소켓끼리만 브로드캐스트가 오간다 |
| **C→S / S→C** | C→S는 클라이언트가 서버로, S→C는 서버가 클라이언트로 보내는 이벤트 |
| **roomVersion** | 방 상태가 바뀔 때마다 +1 되는 정수. 이벤트 순서가 뒤집혔는지 판단하는 용도 |
| **roundId** | 게임 한 판의 식별자. `다시 하기`를 누르면 새로 발급된다 |
| **phase** | 라운드의 진행 단계. `READY` → `PLAYING` → (`TIE`) → `RESULT` |

**전송 방식은 Native WebSocket**이다. Socket.IO를 쓰지 않으므로 룸 관리·브로드캐스트를 직접 구현한다([D-26](../DECISIONS.md#d-26)).

---

## 1. 연결 수명주기

REST 명세와 맞물려 있으므로 먼저 정리한다.

1. **연결 시점 — 참여자**: `POST /api/rooms/{code}/members` 응답으로 `guestToken`을 받는 **즉시** 핸드셰이크(`S-03` 진입과 동시). 이때는 아직 프로필이 없는 `PENDING` 상태다.
2. **연결 시점 — 방장**: `PATCH /api/rooms/{code}/members/me`로 프로필을 확정한 **직후** 핸드셰이크(`S-04-HOST` 진입). 방장은 `hostToken`을 쓴다.
3. **연결 직후**: 서버가 **최초 1회** `room:snapshot`을 보낸다. 이 하나로 대기방 화면을 통째로 그릴 수 있어야 하며, 이후에는 개별 이벤트로 부분 갱신만 한다.
4. **다른 사람에게 보이기 시작하는 시점**: 프로필 확정으로 `ACTIVE`가 되는 순간 `member:joined`가 브로드캐스트된다.
   즉 **`PENDING` 참가자는 소켓은 붙어 있지만 다른 사람 화면에는 아직 안 보인다.**
5. **연결 종료 = 퇴장**: 소켓이 끊기면 서버는 즉시 방에서 제거한다.
6. **미연결 자동 해제**: 가입 후 15초 안에 핸드셰이크가 없으면 서버가 슬롯을 푼다.

> ⚠️ **재접속 개념이 없다**([D-04](../DECISIONS.md#d-04), 승인 대기).
> "끊겼다가 돌아오면 상태 복구" 같은 처리가 필요 없는 대신, **새로고침 한 번이면 방에서 빠진다.**
> 프론트가 이탈 경고(`beforeunload`)를 띄우는 것이 좋다.

---

## 2. 공통 규칙

- **룸 단위**: `room:{code}` — `code`는 `MODU-` 접두어 없이 **숫자 4자리**([D-01](../DECISIONS.md#d-01)).
  예: `room:4271`. REST 경로 규칙과 동일하게 맞춘다.
- **인증**: 핸드셰이크 시 `guestToken`(참여자) 또는 `hostToken`(방장)을 전달한다.
  유효하지 않으면 연결을 거부하고 `SESSION_EXPIRED`를 내려준다.
- **응답 규격**: 모든 S→C 이벤트는 [공통 응답 객체](03_error_codes.md#1-공통-응답-객체)로 감싸서 내려간다.
  아래 표의 페이로드는 **`data` 안에 들어가는 부분**이다.
- **순서 보장**: 모든 S→C 이벤트의 `data`에는 `roomVersion`이 포함된다.
  클라이언트는 마지막으로 반영한 번호보다 작거나 같은 이벤트를 무시한다.
- **권한 검증**: 방장 전용 이벤트를 참여자가 보내면 `NOT_HOST`를 **보낸 사람에게만** 돌려준다(브로드캐스트 없음).

---

## 3. 대기방 — 클라이언트가 보내는 이벤트 (C→S)

| # | 이벤트 | 페이로드 | 기능 | 보낼 수 있는 사람 |
|---|---|---|---|---|
| 1 | `member:ready` | `{ ready }` | 준비 완료 토글 | 참여자 |
| 2 | `member:kick` | `{ memberId }` | 참가자 강퇴 | **방장** |
| 3 | `chat:send` | `{ text }` | 채팅 메시지 전송 | 전원 |
| 4 | `chat:typing` | `{ typing }` | 입력 중 표시 | 전원 |
| 5 | `game:select` | `{ gameId }` | 게임 선택 | **방장** |
| 6 | `game:config` | `{ gameId, config }` | 게임 옵션 변경 | **방장** |
| 7 | `game:random` | `{ }` | 랜덤 게임 뽑기 | **방장** |
| 8 | `game:start` | `{ }` | 게임 시작 | **방장** |

### 1. `member:ready` — 준비 완료 토글 (`S-04-GUEST`)

참여자가 하단 `준비 완료` 버튼을 누를 때마다 보낸다. **방장은 준비 개념이 없으므로 보내지 않는다.**

```json
{ "ready": true }
```

- `ready` (boolean) — `true`면 준비 완료, `false`면 해제
- 서버는 받는 즉시 `member:ready_changed`를 전원에게 브로드캐스트한다.

### 2. `member:kick` — 참가자 강퇴 (`S-04-HOST`, 방장 전용)

```json
{ "memberId": "mbr_01H..." }
```

- 자기 자신을 보내면 `INVALID_ACTION`
- **대상자**에게는 `error { code: "KICKED" }` → 소켓 강제 종료 → `S-01`로 이동
- **나머지**에게는 `member:left { reason: "KICK" }` 브로드캐스트
- 방장 화면에서는 `M-05` 확인 모달을 거친 뒤 전송한다.

### 3. `chat:send` — 채팅 메시지 전송

```json
{ "text": "다 모였으면 시작해요" }
```

- `text` (string) — 1~200자. 빈 문자열이거나 공백만 있으면 서버가 무시한다.
- 서버가 `messageId`와 `sentAt`을 붙여 `chat:message`로 **전원(보낸 본인 포함)** 에게 되돌려준다.
- 본인 메시지도 서버를 한 번 다녀오므로, 클라이언트가 미리 그리지 않고 기다렸다 그리면 순서가 보장된다.

### 4. `chat:typing` — 입력 중 표시

- `typing` (boolean) — 입력 시작 `true`, 중단·전송 후 `false`
- 상태만 전달하는 이벤트라 **저장하지 않는다.**
- 클라이언트는 3초간 갱신이 없으면 자동으로 `false` 처리한다.

### 5. `game:select` — 게임 선택 (방장 전용)

- `gameId` — `roulette` | `ladder` | `kingmaker` | `timer` | `snipe` | `nunchi`
- 서버는 해당 게임의 **기본 설정값**을 적용하고 `game:selected`로 전원에게 알린다.

### 6. `game:config` — 게임 옵션 변경 (방장 전용)

방장이 우측 설정 패널을 조작할 때마다 보낸다. **참여자 화면은 읽기 전용이지만 실시간으로 같이 바뀌어야 한다.**

```json
{ "gameId": "ladder", "config": { "resultItems": ["청소", "설거지", "면제"], "speed": "NORMAL" } }
```

- `gameId` — 현재 선택된 게임. 서버가 가진 값과 다르면 `INVALID_ACTION`
- `config` — 항목과 범위는 §7 `configSchema`를 따른다. 위반 시 `INVALID_CONFIG`
- 타이핑할 때마다 보내면 트래픽이 과하므로 클라이언트가 **200~300ms 디바운스** 후 전송하는 것을 권장한다.

### 7. `game:random` — 랜덤 게임 뽑기 (방장 전용)

- 페이로드 없음. **서버가** 6종 중 무작위로 고른다.
- **클라이언트가 뽑지 않는 이유**: 클라이언트가 뽑으면 방장 화면과 참여자 화면의 결과가 엇갈릴 수 있다.
- 결과는 `game:selected`로 전원에게 동일하게 내려간다.

### 8. `game:start` — 게임 시작 (방장 전용)

- 페이로드 없음. 현재 선택된 게임과 설정으로 라운드를 생성한다.
- **서버 검증 조건**

  | 조건 | 실패 시 |
  |---|---|
  | `ACTIVE` 인원 2명 이상 | `NOT_ENOUGH_MEMBERS` |
  | **참여자 전원 READY**([D-12](../DECISIONS.md#d-12)) | `NOT_ALL_READY` |
  | 게임이 선택돼 있음 | `INVALID_ACTION` |
  | 설정값 유효 | `INVALID_CONFIG` |

- 성공하면 새 `roundId`를 발급하고 `game:started`를 브로드캐스트한다.
- 방 상태가 `PLAYING`으로 바뀌어, 이후 새로 들어오려는 사람은 `ROOM_ALREADY_PLAYING`으로 막힌다.
- **결과 화면의 `↻ 다시 하기`도 같은 이벤트를 재사용**한다(새 `roundId` 발급).

---

## 4. 대기방 — 서버가 보내는 이벤트 (S→C)

| # | 이벤트 | 페이로드 | 기능 | 받는 사람 |
|---|---|---|---|---|
| 9 | `room:snapshot` | `{ room, members, game, messages }` | 연결 직후 현재 상태 전체 | 본인만 |
| 10 | `member:joined` | `{ member }` | 새 참가자 등장 | 전원 |
| 11 | `member:left` | `{ memberId, reason }` | 참가자 이탈 | 전원 |
| 12 | `member:ready_changed` | `{ memberId, ready, readyCount, activeCount }` | READY n/m 갱신 | 전원 |
| 13 | `chat:message` | `{ messageId, memberId, text, sentAt }` | 채팅 메시지 수신 | 전원 |
| 14 | `chat:typing` | `{ memberId, typing }` | ●●● 표시 | 본인 제외 |
| 15 | `game:selected` | `{ gameId, config, configSchema? }` | 선택된 게임 반영 | 전원 |
| 16 | `game:config_changed` | `{ config }` | 옵션 변경 반영 | 전원 |
| 17 | `game:started` | `{ roundId, gameId, config }` | 게임 화면으로 전환 | 전원 |
| 18 | `round:closed` | `{ }` | 대기방으로 복귀 | 전원 |
| 19 | `room:closed` | `{ reason }` | 방 종료(폭파·만료) | 전원 |
| 20 | `error` | `{ code, message }` | 에러 통지 | 보낸 사람만 |

### 9. `room:snapshot` — 연결 직후 최초 1회

**이 이벤트 하나로 대기방 화면을 통째로 그릴 수 있어야 한다.** 이후에는 개별 이벤트로 부분 갱신만 한다.

```json
{
  "room": { "code": "4271", "roomName": "4조 · 알고리즘 스터디", "maxMembers": 8, "hostMemberId": "mbr_01H..." },
  "members": [
    { "memberId": "mbr_01H...", "nickname": "지호", "avatarId": "A06", "bio": "...", "isHost": true, "ready": false }
  ],
  "game": { "gameId": "roulette", "config": { }, "configSchema": { } },
  "messages": [
    { "messageId": "msg_01H...", "memberId": "mbr_01H...", "text": "안녕하세요", "sentAt": "2026-07-26T15:04:05+09:00" }
  ],
  "roomVersion": 12
}
```

- `members`에는 **`ACTIVE`만** 들어간다(프로필 입력 중인 `PENDING`은 제외).
- `messages`는 **최근 50건**으로 제한한다. 이보다 과거는 존재하지 않는다([D-07](../DECISIONS.md#d-07)).
- 게임이 아직 선택 안 됐으면 `game`은 `null`.

### 10. `member:joined` — 새 참가자 등장

누군가 `PATCH /members/me`로 프로필을 확정해 `ACTIVE`가 된 순간 발생한다.
**소켓 연결 시점과 다르다는 게 포인트다.**

- `member` — `memberId`, `nickname`, `avatarId`, `bio`, `isHost`, `ready`
- 받은 클라이언트는 참가자 그리드에 카드를 추가하고 채팅창에 시스템 말풍선을 띄운다.
- **`S-03`에 머물러 있는 사람도 이걸 받아 아바타 선점 현황을 갱신한다.**

### 11. `member:left` — 참가자 이탈

- `reason` — `LEAVE`(직접 나감) | `KICK`(강퇴) | `DISCONNECT`(연결 끊김)
- **방장이 나간 경우는 이 이벤트가 아니라 `room:closed`가 나간다**(방장 이탈 = 방 폭파, [D-05](../DECISIONS.md#d-05)).

### 12. `member:ready_changed` — 준비 상태 갱신

- `readyCount` / `activeCount` — 화면의 `READY n/m` 밴드에 그대로 쓴다.
  클라이언트가 직접 세지 않고 서버 값을 쓰면 오차가 생기지 않는다.
- **전원 READY는 게임 시작의 필수 조건이다**([D-12](../DECISIONS.md#d-12)).

### 13. `chat:message` — 채팅 메시지 수신

- `memberId`가 본인이면 오른쪽 말풍선, 아니면 왼쪽. **`null`이면 시스템 메시지로 가운데 정렬.**
- **입퇴장 시스템 문구는 서버가 따로 내려주지 않는다.** 클라이언트가 `member:joined`/`member:left`를 보고 직접 그린다.

### 15. `game:selected` — 선택된 게임 반영

- `config`는 해당 게임의 **기본값**이 채워져 내려온다(방장이 아직 손대지 않은 상태).
- `configSchema`는 **생략할 수 있다.** 클라이언트가 `GET /api/games/{gameId}`로 이미 받았다면 중복 전송하지 않는다([D-27](../DECISIONS.md#d-27)).

### 18. `round:closed` — 대기방 복귀

결과 화면에서 방장이 `← 대기방으로`를 눌러 `round:close`를 보냈을 때 전원에게 나간다([D-29](../DECISIONS.md#d-29)).
방 상태가 `PLAYING` → `WAITING`으로 돌아간다.

### 19. `room:closed` — 방 종료

방이 사라지는 모든 경우에 전원에게 나가고, 받은 즉시 소켓이 닫힌다.

- `reason` — `HOST_LEFT`(방장 이탈) | `EXPIRED`(만료, [D-03](../DECISIONS.md#d-03))
- 클라이언트는 사유별 팝업을 띄우고 `S-01`로 보낸다.

### 20. `error` — 에러 통지

- **보낸 사람에게만** 간다. 브로드캐스트하지 않는다.
- `code`는 [`06_api/03_error_codes.md`](03_error_codes.md)의 문자열을 그대로 쓴다(REST와 공용).
- `message`는 그대로 토스트에 띄울 수 있는 한글 문구다.

---

## 5. 게임 진행 (`S-05` ~ `S-10`)

게임별로 이벤트를 나누지 않고 **공용 이벤트 + `type` 분기**로 처리한다.

| 방향 | 이벤트 | 페이로드 | 대상 화면 |
|---|---|---|---|
| C→S | `game:action` | `{ roundId, type, payload }` | §6 type 표 참고 |
| C→S | `round:close` | `{ roundId }` | 결과 화면 · **방장만** |
| S→C | `game:phase` | `{ roundId, phase, deadlineAt }` | `READY` / `PLAYING` / `TIE` / `RESULT` |
| S→C | `game:tick` | `{ roundId, serverTime, remainMs }` | 시간초 · 눈치 타이머 동기화 |
| S→C | `game:progress` | `{ roundId, payload }` | 투표 수 · 생존자 수 등 중간 상태 |
| S→C | `game:tie` | `{ roundId, candidates }` | **`M-02`** 동점 모달 |
| S→C | `game:result` | `{ roundId, type, result }` | 결과 화면 `S-05R` ~ `S-10R` |

### `game:action` — 플레이어 입력 (C→S)

게임 중 플레이어가 버튼을 누르는 모든 행위가 이 이벤트 하나로 들어온다.

```json
{ "roundId": "rnd_01H...", "type": "king.vote", "payload": { "candidateId": "cnd_01H..." } }
```

| 필드 | 설명 |
|---|---|
| `roundId` | 현재 라운드. 끝난 라운드면 `ROUND_ALREADY_ENDED` |
| `type` | §6 표의 값 중 하나. 현재 게임과 안 맞으면 `INVALID_ACTION` |
| `payload` | `type`마다 모양이 다르다 |

- 1회 제한 액션을 두 번 보내면 `ALREADY_SUBMITTED`
- 탈락자가 보내면 `ELIMINATED`

### `game:phase` — 단계 전환 (S→C)

라운드가 다음 단계로 넘어갈 때마다 전원에게 나간다. **클라이언트는 이 이벤트만 보고 화면을 전환하면 된다.**

- `phase` — `READY` | `PLAYING` | `TIE` | `RESULT`
- `deadlineAt` — 이 단계가 끝나는 시각. 제한시간이 없으면 `null`
- `READY`는 게임 시작 직후 가이드 팝업(`M-01`) 구간으로, 전원의 화면을 맞추는 역할을 한다.
- **`TIE`는 새 라운드가 아니라 같은 `roundId` 안의 단계**다([D-11](../DECISIONS.md#d-11)).

### `game:tick` — 타이머 동기화 (S→C)

시간초 잡기·눈치게임처럼 초 단위가 중요한 게임에서 사람마다 타이머가 다르게 보이는 걸 막는다.

- `serverTime` — 서버 기준 현재 시각
- `remainMs` — 남은 시간(밀리초)
- 매 tick마다 다시 그리는 게 아니라, **첫 tick으로 자기 시계와의 오차를 재고 그 뒤는 클라이언트 자체 타이머를 돌리는 것**을 권장한다(전송량 절감).

### `game:progress` — 중간 집계 (S→C)

- 게임별로 `payload` 모양이 다르다.
  - 킹메이커 · 저격: `{ votedCount, totalCount }`
  - 눈치게임: `{ currentNumber, aliveMemberIds }`
- ⚠️ **누가 무엇을 선택했는지는 절대 넣지 않는다.** 익명 저격·킹메이커는 익명성이 기획 의도이므로 중간에 새면 안 된다.

### `game:tie` — 동점 발생 (S→C)

- `candidates` — 동점인 대상 목록.
  - 킹메이커는 **`candidateId` 배열**([D-18](../DECISIONS.md#d-18))
  - 시간초 · 저격은 `memberId` 배열
- 받으면 `M-02` 모달을 띄우고, 방장이 `동점자끼리 다시!`를 고르면 해당 후보들끼리만 다시 `game:action`을 보낸다.
- **재투표 횟수에 상한이 없다**([D-16](../DECISIONS.md#d-16)).

### `game:result` — 최종 결과 (S→C)

- `type` — 게임 종류. 클라이언트는 이걸로 결과 화면 레이아웃을 고른다(`S-05R` ~ `S-10R`).
- `result` — 게임별 결과 데이터. 구조는 [`05_game_rules/00_common.md`](../05_game_rules/00_common.md)의 각 "결과 데이터" 절을 따른다.
- ⚠️ **킹메이커 결과에 아이디어 제안자를 포함하지 않는다**([D-18](../DECISIONS.md#d-18)).
  실명 모드에서 공개하는 것은 **투표자**뿐이다([D-22](../DECISIONS.md#d-22)).

### `round:close` — 대기방 복귀 요청 (C→S, 방장 전용)

- 결과 화면에서 방장이 `← 대기방으로`를 누를 때 보낸다([D-29](../DECISIONS.md#d-29)).
- 참여자가 보내면 `NOT_HOST`.
- 서버는 `round:closed`를 전원에게 브로드캐스트하고 방 상태를 `WAITING`으로 되돌린다.

---

## 6. `game:action` type 정리

| 게임 | type | payload | 보내는 사람 | 화면 |
|---|---|---|---|---|
| 운명의 룰렛 | `roulette.pick` | `{ }` | **방장만** | `S-05` · PICK 버튼 |
| 랜덤 사다리 | `ladder.reveal` | `{ memberId }` | **방장만** | `S-06` · 캐릭터 클릭(순차 공개) |
| 랜덤 사다리 | `ladder.revealAll` | `{ }` | **방장만** | `S-06` · 동시 시작 |
| 킹메이커 | `king.opinion` | `{ text }` | 전원 (1회) | `S-07-1` · 의견 제출 |
| 킹메이커 | `king.vote` | `{ candidateId }` | 전원 (1회) | `S-07` · 투표 |
| 시간초 잡기 | `timer.stop` | `{ clientStopAt }` | 전원 (1회) | `S-08` · STOP 버튼 |
| 익명 저격 | `snipe.vote` | `{ targetMemberId }` | 전원 (1회) | `S-09` · 대상 선택 |
| 눈치게임 | `nunchi.up` | `{ }` | 생존자 | `S-10` · UP 버튼 |

**필드 규칙**

| 필드 | 규칙 |
|---|---|
| `memberId` (사다리) | 경로를 공개할 참가자. 이미 공개된 참가자면 `INVALID_ACTION` |
| `text` (킹메이커) | **1~120자**([D-20](../DECISIONS.md#d-20)) |
| `candidateId` (킹메이커) | 후보 ID. **자기가 제출한 후보면 `SELF_VOTE_NOT_ALLOWED`** — 서버가 내부 매핑으로 판정한다 |
| `targetMemberId` (저격) | 지목 대상. 자기 자신이면 `SELF_VOTE_NOT_ALLOWED` |
| `clientStopAt` (시간초) | 클라이언트가 버튼을 누른 시각. **참고용이며 공식 판정은 서버 수신 시각**([D-14](../DECISIONS.md#d-14)) |

> **폐기된 액션**
> - `ladder.pick { laneIndex }` — 참가자가 레인을 고르는 단계는 존재하지 않는다([D-23](../DECISIONS.md#d-23))
> - `timer.start { clientStartAt }` — 타이머는 서버가 자동으로 동시 출발시킨다([D-24](../DECISIONS.md#d-24), 승인 대기)
> - `king.vote { targetMemberId }` — 익명성이 붕괴하므로 `candidateId`로 대체([D-18](../DECISIONS.md#d-18))

---

## 7. `configSchema`

`GET /api/games/{gameId}`와 `game:selected`로 내려가는 설정 규격이다.
항목의 근거는 [`05_game_rules/00_common.md` §2](../05_game_rules/00_common.md#2-게임별-방장-설정-요약).

| gameId | 필드 | 타입 | 범위 · 값 | 기본값 |
|---|---|---|---|---|
| `roulette` | `purpose` | string | 1~16자 | — |
| `roulette` | `resultItems` | string[] | 1개 이상 | — |
| `ladder` | `purpose` | string | 1~16자 | — |
| `ladder` | `resultItems` | string[] | **개수 ≤ 참가자 수** | — |
| `ladder` | `speed` | enum | `FAST` \| `NORMAL` \| `SLOW` | `NORMAL` |
| `kingmaker` | `topic` | string | 1~16자 | — |
| `kingmaker` | `revealVoters` | boolean | `false`=익명 / `true`=실명 ([D-22](../DECISIONS.md#d-22)) | `false` |
| `timer` | `purpose` | string | 1~16자 | — |
| `timer` | `targetSeconds` | enum | `5` \| `7` \| `10` | `5` |
| `timer` | `criterion` | enum | `CLOSEST` \| `FARTHEST` | `CLOSEST` |
| `snipe` | `question` | string | 1~40자 (프리셋 또는 직접 입력) | — |
| `snipe` | `voteSeconds` | int | 5~30 | `10` |
| `nunchi` | `simultaneousMs` | enum | `300` \| `500` | `300` |
| `nunchi` | `endMode` | enum | `FIRST_OUT` \| `LAST_ONE` ([D-25](../DECISIONS.md#d-25)) | `FIRST_OUT` |

**킹메이커에는 `voteCount` 필드가 없다.** 1인 1표 고정이다([D-19](../DECISIONS.md#d-19), 승인 대기).

> ⚠️ 위 표의 문자열 길이 상한 중 `purpose`(16자) · `question`(40자) · `voteSeconds` 범위는
> 원본 문서에 명시가 없어 화면 시안의 입력 카운터를 근거로 정한 값이다([U-02](../DECISIONS.md#h-아직-결정되지-않은-것)).
> 구현 전 프론트·백엔드가 확인할 것.
