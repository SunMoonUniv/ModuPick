# API 기본 명세서

해당 직군: API/서비스로직, 프론트
상태: 완료
최종 담당자: 연주 이, 문석용, 원세찬, 이도현
날짜: 2026년 7월 24일 → 2026년 7월 26일
선행 작업: 기획안 (https://app.notion.com/p/38a058de390280ad87d0d2564a76d1fe?pvs=21), 와이어프레임 / 화면 설계서 (https://app.notion.com/p/39f058de390280929ed4f166a20ffdd6?pvs=21)
우선순위(프로젝트 전체 기준): 보통
후속 작업: 프론트 개발 (https://app.notion.com/p/39f058de390280a28e60d64520005735?pvs=21), 백엔드 개발 (https://app.notion.com/p/39f058de39028016968ec34f1634dcbd?pvs=21)
진행률: 100

# ✅ API 구현 기준 v1.0 — 수정 요구사항·DB v0.8 동기화 (2026-07-30)

<aside>
📌

**현재 REST·WebSocket 구현의 단일 기준입니다.**

정본: [‣](https://app.notion.com/p/ab6de0c692b883fc95348175a0cef985?pvs=21)

DB: [‣](https://app.notion.com/p/744de0c692b883e981770145882dbe3c?pvs=21)

이 아래의 기존 초안과 충돌하면 v1.0을 사용합니다.

</aside>

## 0. 변경 위치·내용·이유

| 위치 | v1.0 계약 | 이유 |
| --- | --- | --- |
| 방장 이탈 | room:closed HOST_LEFT 후 방 삭제, host:changed 없음 | G-16, US-205, F-209 |
| 프로필 | PENDING에서 한 번만 PATCH, bio 24자, 중복 닉네임 자동 번호 | US-104, F-108~110 |
| Ready | guest 전용, host는 Ready 없음 | G-3, F-206·207 |
| 강퇴 | waiting에서만 가능, 이후 새 memberId로 재입장 허용 | US-204, F-208 |
| 방 상태 | WAITING / PLAYING / RESULT | F-211·604 |
| 사다리 | ladder.pick 제거, host의 ladder.start만 사용 | US-421, F-421~423 |
| 킹메이커 | targetMemberId 대신 optionIds 배열 | 익명 안건 투표와 1~3표 지원 |
| 저격 | targetMemberIds 배열 | 다중 지목 설정과 결선 반복 지원 |
| 시간초 | timer.start/stop payload에 클라이언트 시각 없음 | G-8, F-441 |
| 결과 | 난수 시드는 서버 저장, 과거 결과 조회 REST 없음 | US-504, F-507 |

## 1. 공통 계약

- code는 DB에 숫자 6자리로 저장하며 화면에는 MODU- 접두어를 붙입니다.
- memberId, roundId, optionId는 각각 mbr_, rnd_, opt_ 접두어가 붙은 불투명 문자열입니다.
- 모든 S→C data에는 roomVersion을 포함합니다.
- 날짜는 ISO 8601 타임존 포함, 판정용 시간은 서버 내부 정수 밀리초입니다.
- Bearer/소켓 토큰은 참가자 식별에 사용합니다. 권한은 현재 participants.role을 조회해 결정합니다.
- 모든 상태 변경 이벤트는 DB commit 이후 발행합니다.
- 유효한 REST 요청과 C→S 이벤트는 방의 10분 무활동 만료를 연장합니다.
- 재접속은 지원하지 않습니다. 소켓 종료 시 기존 memberId는 퇴장 처리됩니다.

## 2. REST API

| Method | Path | 기능 | 인증 |
| --- | --- | --- | --- |
| POST | /api/rooms | 방 + PENDING host 생성 | - |
| GET | /api/rooms/{code} | 입장 가능 여부·방 상태 조회 | - |
| POST | /api/rooms/{code}/members | PENDING guest 슬롯 생성 | - |
| GET | /api/rooms/{code}/avatars | 사용 가능한 아바타 조회 | Bearer |
| PATCH | /api/rooms/{code}/members/me | PENDING 프로필 최초 확정 | Bearer |
| DELETE | /api/rooms/{code}/members/me | 퇴장. host면 방 삭제 | Bearer |
| GET | /api/games | 게임 6종·최소 인원·configSchema | - |
| GET | /api/games/{gameId} | 가이드·설정 상세 | - |

> 과거 결과 목록·상세 조회 REST는 없습니다. /api/rooms/{code}/results 계열을 만들지 않습니다.
> 

### 2.1 POST /api/rooms

```json
{
  "roomName": "4조 알고리즘 스터디",
  "maxMembers": 8
}
```

- roomName은 공백이면 ModuPick 방, 최대 30자입니다.
- maxMembers는 2~10, 기본 10입니다.
- room과 PENDING host를 한 트랜잭션에서 만듭니다.
- 응답은 code, displayCode, hostToken, memberId, memberStatus=PENDING, expiresAt입니다.
- 방장은 이어서 PATCH 프로필을 한 번 호출한 뒤 소켓을 연결합니다.

### 2.2 GET /api/rooms/{code}

```json
{
  "code": "427132",
  "roomName": "4조 알고리즘 스터디",
  "roomStatus": "WAITING",
  "maxMembers": 8,
  "currentMembers": 4,
  "hostNickname": "지호"
}
```

- roomStatus는 WAITING / PLAYING / RESULT입니다.
- 입장은 WAITING에서만 허용합니다.
- PLAYING 또는 RESULT면 409 ROOM_ALREADY_PLAYING입니다.
- expiresAt이 지났으면 410 ROOM_EXPIRED를 반환하고 방을 삭제합니다.

### 2.3 POST /api/rooms/{code}/members

- room을 잠그고 PENDING+ACTIVE 합계가 maxMembers 미만인지 확인합니다.
- 브라우저 식별값·과거 강퇴 기록을 받거나 조회하지 않습니다.
- 강퇴된 사람이 다시 요청해도 WAITING이고 정원이 남으면 새 guestToken/memberId를 발급합니다.
- 15초 안에 소켓 핸드셰이크가 없으면 PENDING 슬롯을 해제합니다.

### 2.4 PATCH /api/rooms/{code}/members/me

```json
{
  "nickname": "지호",
  "avatarId": null,
  "bio": "@jiho_dev"
}
```

- PENDING 상태에서만 호출할 수 있습니다.
- ACTIVE에서 호출하면 409 PROFILE_ALREADY_CONFIRMED입니다.
- nickname은 1~8자·공백 금지입니다.
- 중복이면 오류가 아니라 지호2, 지호3처럼 서버가 최종 닉네임을 만듭니다.
- 8자 닉네임은 숫자 자리를 확보하도록 끝을 줄입니다.
- avatarId가 null이면 A01~A30 중 사용하지 않는 값을 자동 배정합니다.
- bio는 0~24자입니다.
- 응답에는 실제 확정된 nickname과 avatarId를 반환합니다.
- commit 후 member:joined를 발행합니다.
- NICKNAME_DUPLICATED는 더 이상 사용하지 않습니다.

### 2.5 DELETE /api/rooms/{code}/members/me

- guest: left_at 갱신 후 member:left reason=LEAVE.
- host: 남은 사람·room 상태와 관계없이 rooms DELETE.
- host가 PLAYING에서 나가면 결과를 만들지 않습니다.
- commit 후 room:closed reason=HOST_LEFT를 전원에게 보냅니다.
- 방장 위임과 host:changed는 없습니다.

### 2.6 GET /api/games

| gameId | 최소 인원 |
| --- | --- |
| roulette | 2 |
| ladder | 2 |
| kingmaker | 3 |
| timer | 2 |
| snipe | 3 |
| nunchi | 3 |

랜덤 게임 선택도 현재 ACTIVE 인원으로 시작 가능한 게임만 후보로 사용합니다.

## 3. WebSocket C→S

| 이벤트 | payload | 권한·조건 |
| --- | --- | --- |
| member:ready | { ready } | ACTIVE guest, waiting 전용 |
| member:kick | { memberId } | host, waiting 전용 |
| chat:send | { text } | ACTIVE, 200자 이하 |
| chat:typing | { typing } | ACTIVE |
| game:select | { gameId } | host, waiting |
| game:config | { gameId, config } | host, waiting |
| game:random | { } | host, waiting |
| game:start | { } | host, waiting·guest 전원 ready |
| game:replay | { roundId } | host, 현재 result 화면 전용 |
| game:action | { roundId, type, payload } | 게임·phase별 검증 |
| round:close | { roundId } | host, result→waiting |
- host가 member:ready를 보내면 INVALID_ACTION입니다.
- member:kick 대상은 guest만 가능하며 host 자신을 보낼 수 없습니다.
- RESULT 상태에서 신규 입장·프로필·강퇴는 허용하지 않습니다.
- game:replay는 현재 결과의 game_type/config만 사용하며 과거 round를 임의로 재실행하는 기능이 아닙니다.

## 4. game:action 계약

| 게임 | type | payload | 보내는 사람 |
| --- | --- | --- | --- |
| 룰렛 | roulette.pick | { } | host 1회 |
| 사다리 | ladder.start | { } | host 1회 |
| 킹메이커 | king.opinion | { text } | snapshot 전원 1회 |
| 킹메이커 | [king.vote](http://king.vote) | { optionIds } | snapshot 전원, ballot당 1회 |
| 시간초 | timer.start | { } | snapshot 전원, 시도당 1회 |
| 시간초 | timer.stop | { } | start 완료 참가자 1회 |
| 익명 저격 | [snipe.vote](http://snipe.vote) | { targetMemberIds } | snapshot 전원, ballot당 1회 |
| 눈치 | nunchi.up | { } | 현재 생존자, subRound당 1회 |
| 눈치 | nunchi.invalid_decision | { decision } | host, INVALID 상태 |

### 4.1 사다리

- ladder.pick과 laneIndex를 제거합니다.
- snapshot의 joinedAt/id 순서로 레인을 자동 배치합니다.
- host의 ladder.start에서 서버가 seed 기반 가로선과 최종 1:1 배정을 생성합니다.

### 4.2 킹메이커

```json
{
  "roundId": "rnd_01H...",
  "type": "king.vote",
  "payload": {
    "optionIds": ["opt_A1", "opt_B2"]
  }
}
```

- optionId는 안건 식별자이며 작성자 memberId를 노출하지 않습니다.
- optionIds 길이는 1~config.votesPerMember입니다.
- 같은 optionId 중복, 자기 안건, 허용 표 수 초과를 거절합니다.
- ballotNo는 서버가 phase에서 결정하며 클라이언트가 보내지 않습니다.
- 0개 안건은 설정 화면 복귀, 1개는 자동 확정, 동점은 30초 결선을 반복합니다.

### 4.3 시간초

```json
{
  "roundId": "rnd_01H...",
  "type": "timer.start",
  "payload": {}
}
```

```json
{
  "roundId": "rnd_01H...",
  "type": "timer.stop",
  "payload": {}
}
```

- clientStartAt과 clientStopAt을 보내지 않습니다.
- 서버는 각 이벤트가 ingress에 도착한 순간의 monotonic 시간을 참가자별로 기록합니다.
- elapsedMs = stopServerTime - startServerTime입니다.
- 게임 시작 10초 안에 start가 없거나 start 후 targetMs+3000 안에 stop이 없으면 최하위입니다.
- 늦게 도착한 stop은 ROUND_ALREADY_ENDED 또는 INVALID_ACTION으로 판정에 반영하지 않습니다.

### 4.4 익명 저격

```json
{
  "roundId": "rnd_01H...",
  "type": "snipe.vote",
  "payload": {
    "targetMemberIds": ["mbr_B", "mbr_C"]
  }
}
```

- allowMultipleTargets=false면 정확히 1명, true면 서로 다른 1명 이상입니다.
- 자기 memberId와 중복 대상은 거절합니다.
- 기권은 빈 배열 또는 제한 시간 미입력입니다.
- 동점 재투표의 ballotNo는 서버가 증가시킵니다.

## 5. WebSocket S→C

| 이벤트 | 핵심 data |
| --- | --- |
| room:snapshot | roomStatus, hostMemberId, ACTIVE members, selectedGame, config |
| member:joined | member |
| member:left | memberId, reason |
| member:kicked | 대상에게만 전송 후 소켓 종료 |
| member:ready_changed | memberId, ready |
| game:selected | gameId, config 기본값 |
| game:config_changed | gameId, config |
| game:started | roundId, gameId, roundMembers, config, guideEndsAt |
| game:phase | roundId, phase, deadlineAt |
| game:progress | 참가자별 COMPLETE/WAITING만 |
| game:tie | 후보 optionId/memberId, deadlineAt |
| game:result | roundId, type, result, resultScreenAt |
| round:closed | roundId |
| room:closed | reason=HOST_LEFT/EMPTY/INACTIVE |
| error | code, message |
- host:changed 이벤트는 없습니다.
- game:progress에는 입력 내용·시간 기록·후보별 득표를 넣지 않습니다.
- guest 이탈 후에도 게임 화면의 roundMembers에서는 제거하지 않고 departed=true만 표시합니다.
- host 이탈 시 game:result 없이 room:closed HOST_LEFT가 마지막 이벤트입니다.
- seed는 서버 보관 데이터이며 일반 game:result에 반드시 노출할 필요는 없습니다.
- 대기방 복귀 후 과거 result를 재전송하는 이벤트는 없습니다.

## 6. config 계약

| 게임 | 필드 | 검증 |
| --- | --- | --- |
| roulette | topic | 1~12자 |
| ladder | topic, items, speed | 각 항목 1~12자, fast/normal/slow |
| kingmaker | topic, votesPerMember, revealAuthors | 1~12자, 1/2/3 |
| timer | topic, targetMs, winnerRule | 5000/7000/10000, closest/farthest |
| snipe | topic, voteSeconds, allowMultipleTargets, revealVoters | 질문 1~30자, 5~60초 |
| nunchi | topic, decisionWindowMs, roundTimeoutMs | 300/500, 10000/15000/20000 |

게임 변경 시 이전 config를 버리고 새 게임 기본값으로 초기화합니다. 사다리 items는 시작 시 snapshot 인원수보다 적으면 X를 채우고 많으면 뒤에서 자릅니다.

## 7. 주요 오류 코드

| code | 상황 |
| --- | --- |
| ROOM_NOT_FOUND | 없는 코드 또는 이미 삭제된 방 |
| ROOM_EXPIRED | 10분 무활동 만료 |
| ROOM_FULL | PENDING+ACTIVE가 정원 도달 |
| ROOM_ALREADY_PLAYING | PLAYING 또는 RESULT 상태 입장 시도 |
| PROFILE_ALREADY_CONFIRMED | ACTIVE 참가자의 프로필 PATCH |
| NICKNAME_INVALID | 1~8자·공백 규칙 위반 |
| AVATAR_TAKEN | 명시한 아바타가 이미 사용 중 |
| NOT_HOST | host 전용 이벤트를 guest가 보냄 |
| NOT_ALL_READY | ACTIVE guest 중 미준비 존재 |
| NOT_ENOUGH_MEMBERS | 게임별 최소 인원 미달 |
| INVALID_CONFIG | 게임별 설정 범위 위반 |
| INVALID_OPTION | 현재 후보가 아닌 optionId/memberId |
| TOO_MANY_CHOICES | 허용 투표 수 초과 |
| SELF_VOTE_NOT_ALLOWED | 자기 안건·자기 자신 선택 |
| ALREADY_SUBMITTED | 같은 phase의 다른 내용 재입력 |
| ROUND_ALREADY_ENDED | 마감 후 도착한 입력 |
| HOST_LEFT | host 이탈로 방 삭제 |

NICKNAME_DUPLICATED는 제거합니다. 중복 닉네임은 성공 응답의 최종 nickname으로 해결합니다.

## 8. 트랜잭션·이벤트 순서

- 게임 시작: room 잠금 → host·상태·인원·guest Ready·config 검사 → snapshot/seed/round/options 생성 → playing → commit → game:started.
- guest 퇴장: room → round → participant 잠금 → left_at → commit → member:left.
- host 퇴장: room → participant 잠금 → DELETE room → commit → room:closed HOST_LEFT.
- 투표: round → voter → options 검증 → ballot/choice 저장 → commit → 완료 상태만 progress.
- 결과: round 잠금 → result 저장 → round finished → room result → commit → game:result.
- 대기방 복귀: room result 확인 → waiting → Ready 메모리 초기화 → commit → round:closed.
- 모든 쓰기 이벤트는 실패 시 브로드캐스트하지 않습니다.

## 9. 계약 테스트

- [ ]  roomName 30자 성공, 31자 실패
- [ ]  bio 24자 성공, 25자 실패
- [ ]  중복 닉네임이 오류가 아니라 숫자 접미사로 성공
- [ ]  ACTIVE 프로필 PATCH 거절
- [ ]  host member:ready 거절, guest 전원 Ready일 때만 시작
- [ ]  강퇴 후 WAITING에서 새 memberId로 재입장 성공
- [ ]  host가 waiting/playing/result 어느 상태에서 나가도 방 삭제
- [ ]  host 이탈 중인 판에서 game:result가 발생하지 않음
- [ ]  roomStatus RESULT 전달
- [ ]  게임별 최소 인원 적용
- [ ]  ladder.pick 거절, ladder.start 성공
- [ ]  [king.vote](http://king.vote) optionIds 1~3개·자기 안건·중복 검증
- [ ]  [snipe.vote](http://snipe.vote) 다중 대상 설정 검증
- [ ]  timer payload에 clientStartAt/clientStopAt 없음
- [ ]  동일 timer 입력은 최초 1회만 인정
- [ ]  과거 결과 REST·WebSocket 조회 경로 없음
- [ ]  room 삭제 시 result와 seed CASCADE 삭제

## 🍎 API 설계서 (Claude Code)

> 클라이언트와 서버가 **무엇을 주고받는가**를 정의한다.
`requirements.md`의 규칙을 REST 엔드포인트와 WebSocket 이벤트로 옮긴 결과물이다.
> 

| 최종 수정 | 2026-07-31 |
| --- | --- |
| 전송 | REST(HTTP) + Native WebSocket |
| 앞선 문서 | [requirements.md](https://app.notion.com/p/3ada1918c02a81c894afc32d3f211890?pvs=21) — 사용자가 무엇을 하고 싶은가 **★정본** |
|  | [features.md](https://app.notion.com/p/3ada1918c02a81b2aa2fccc9de6992ac?pvs=21) — 그러려면 무엇을 만들어야 하나 |
| 짝 문서 | [db.md](https://app.notion.com/p/3ada1918c02a81d58537e284bd5aa894?pvs=21) — 같은 계약의 저장 쪽 |

스펙이 어긋나면 `requirements.md`가 이긴다. 이 문서는 그 결정을 인터페이스로 옮긴 결과이며, 그 과정에서 새로 생긴 **인터페이스 결정은 §11에 `API-` 번호로** 남긴다.

---

## 1. 공통 계약

| # | 규칙 |
| --- | --- |
| C-1 | 방 코드는 **숫자 6자리**로 주고받는다. `MODU-` 접두어는 화면과 복사되는 초대 코드에만 붙이며, 응답에 `displayCode`로 함께 준다 |
| C-2 | `memberId`·`roundId`·`optionId`는 각각 `mbr_`·`rnd_`·`opt_` 접두어가 붙은 불투명 문자열이다 |
| C-3 | 모든 S→C 이벤트의 `data`에 `roomVersion`을 넣는다. 클라이언트는 마지막으로 반영한 번호보다 작거나 같으면 무시한다 |
| C-4 | 날짜는 ISO 8601(타임존 포함), 판정용 시간은 서버 내부 **정수 밀리초**다 |
| C-5 | 토큰은 참가자 식별에만 쓰고, 권한은 매번 현재 `participants.role`을 조회해 판단한다 |
| C-6 | 모든 상태 변경 이벤트는 **DB commit 이후** 발행한다. 실패하면 아무것도 브로드캐스트하지 않는다 |
| C-7 | 유효한 REST 요청과 C→S 이벤트는 방의 10분 무활동 만료를 연장한다. 서버 tick과 브로드캐스트는 연장하지 않는다 |
| C-8 | **재접속은 없다.** 소켓이 끊기면 그 `memberId`는 퇴장 처리되고 다시 붙는 경로가 없다(G-6 · D-09) |
| C-9 | 서버는 **단일 인스턴스**로 운영한다. 진행 상태를 프로세스 메모리에 두기 때문이다([db.md §2](https://app.notion.com/p/3ada1918c02a81d58537e284bd5aa894?pvs=21)) |

### 1.1 값 표기

저장값과 노출값을 항상 같게 둔다. 변환 계층이 없다([db.md §4](https://app.notion.com/p/3ada1918c02a81d58537e284bd5aa894?pvs=21)).

| 종류 | 표기 | 예 |
| --- | --- | --- |
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

1. **슬롯 선점** — 방을 만들거나 코드로 들어오면 `pending` 참가자가 생기고 토큰을 받는다. 이때부터 정원에 포함되며(D-46), **2분** 안에 프로필을 확정하지 않으면 슬롯이 풀린다.
2. **프로필 확정** — `PATCH`가 성공하면 `active`가 되고 `member:joined`가 브로드캐스트된다.
3. **소켓 연결** — 방장과 참가자 모두 **프로필 확정 직후**에 연결한다(D-46). `pending` 상태의 소켓은 존재하지 않으므로 서버는 소켓을 한 종류로만 관리한다.
4. **연결 종료 = 퇴장** — 끊기면 즉시 방에서 제거하고 `member:left { reason: "DISCONNECT" }`를 보낸다. 게임 중이라면 그 사람은 후보에 그대로 남는다(G-5 · US-403.1).

<aside>
⚠️

새로고침 한 번이면 방에서 빠진다. 프론트가 이탈 경고를 띄우는 편이 좋다.

</aside>

---

## 3. REST API

| Method | Path | 기능 | 인증 | 기능 ID |
| --- | --- | --- | --- | --- |
| `POST` | `/api/rooms` | 방 + `pending` 방장 생성 | — | F-101 · F-102 |
| `GET` | `/api/rooms/{code}` | 입장 가능 여부·방 상태 조회 | — | F-105 · F-211 |
| `POST` | `/api/rooms/{code}/members` | `pending` 참가자 슬롯 생성 | — | F-105 |
| `GET` | `/api/rooms/{code}/avatars` | 아바타 30종과 선점 현황 | Bearer | F-117 · F-118 · F-119 |
| `PATCH` | `/api/rooms/{code}/members/me` | 프로필 최초 확정 | Bearer | F-108 · F-109 · F-110 |
| `DELETE` | `/api/rooms/{code}/members/me` | 퇴장. 방장이면 방 삭제 | Bearer | F-209 |
| `GET` | `/api/games` | 게임 6종·최소 인원·설정 스키마 | — | F-301 |
| `GET` | `/api/games/{gameId}` | 가이드·설정 상세 | — | F-313 |

<aside>
🚫

**과거 결과 조회 엔드포인트는 만들지 않는다.** `/api/rooms/{code}/results` 계열이 없다(US-504.2 · F-507).

</aside>

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
- 입장은 `waiting`에서만 허용한다. `playing`이면 `409 ROOM_ALREADY_PLAYING`, `result`면 `409 ROOM_IN_RESULT`다(D-48)
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
- **프로필 화면에는 소켓이 없으므로**(§2) 이 엔드포인트를 **3초 주기로 다시 불러** 잠금 상태를 갱신한다(F-118 · `API-08`). 실시간 이벤트로 밀어주지 않는다. 최종 방어선은 제출 시점의 `AVATAR_TAKEN`이다

### 3.5 `PATCH /api/rooms/{code}/members/me` — 프로필 확정

```json
// 요청
{ "nickname": "지호", "avatarId": null, "bio": "@jiho_dev" }
```

- `pending` 상태에서만 호출할 수 있다. `active`면 `409 PROFILE_ALREADY_CONFIRMED`
- `nickname` **1~8자, 공백 문자를 포함할 수 없다**(D-44)
- 같은 방 활성 닉네임과 **대소문자를 무시하고** 겹치면 `409 NICKNAME_DUPLICATED`. 서버가 숫자를 붙여 바꾸지 않는다(D-44)
- `avatarId`가 `null`이면 `A01`~`A30` 중 안 쓰이는 가장 작은 값을 배정한다. 명시한 값이 이미 쓰이고 있으면 `409 AVATAR_TAKEN`
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
| --- | --- | --- | --- |
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

3초 가이드(F-312)와 게임 화면의 `?` 버튼이 같은 엔드포인트를 쓴다. 없는 `gameId`면 `404 GAME_NOT_FOUND`.

---

## 4. WebSocket — 클라이언트 → 서버

| 이벤트 | payload | 보낼 수 있는 사람·조건 | 기능 ID |
| --- | --- | --- | --- |
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
| --- | --- | --- | --- |
| 룰렛 | `roulette.pick` | `{ }` | 방장 1회 |
| 사다리 | `ladder.start` | `{ }` | 방장 1회 |
| 킹메이커 | `king.opinion` | `{ text }` | snapshot 전원 1회 |
| 킹메이커 | `king.vote` | `{ optionIds }` | snapshot 전원, 회차당 1회 |
| 시간초 | `timer.start` | `{ }` | snapshot 전원, 시도당 1회 |
| 시간초 | `timer.stop` | `{ }` | `start`를 마친 사람 1회 |
| 저격 | `snipe.vote` | `{ targetMemberIds }` | snapshot 전원, 회차당 1회 |
| 눈치 | `nunchi.up` | `{ }` | 현재 생존자, 서브라운드당 1회 |
| 눈치 | `nunchi.invalid_decision` | `{ decision }` | 방장 · `INVALID` phase에서만 |

**멱등** — 같은 내용을 다시 보내면 저장된 결과를 **성공으로** 돌려준다. 내용이 다르면 `ALREADY_SUBMITTED`다(D-52 · G-9 · NFR-04). 끝난 판에 도착한 입력은 `ROUND_ALREADY_ENDED`로 버린다.

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
- 자기 안건이면 `SELF_VOTE_NOT_ALLOWED`, 허용 표 수를 넘으면 `TOO_MANY_CHOICES`, 이번 회차 후보가 아니면 `INVALID_OPTION`
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
- 서버가 `memberId`를 그 라운드의 `optionId`로 변환해 저장한다([db.md §7](https://app.notion.com/p/3ada1918c02a81d58537e284bd5aa894?pvs=21))
- 전원 기권으로 유효표가 0이면 난수로 정하고 결과에 표시한다(US-452.5)

### 5.5 눈치

```json
{ "type": "nunchi.up", "payload": { } }
{ "type": "nunchi.invalid_decision", "payload": { "decision": "RESTART" } }
```

- **서브라운드(subRound)** 당 한 번만 누를 수 있다. 안전 확정된 사람의 입력은 무시한다(US-462.5)
- 판정은 최초 입력 도착 시각부터 `decisionWindowMs`(300 또는 500) 안의 입력을 한 그룹으로 묶는다
- 생존자 전원이 같은 판정창에 몰리면 **무효 라운드**가 되어 `phase: "INVALID"`로 전환되고 방장의 `nunchi.invalid_decision`을 기다린다
- `decision`은 `RESTART`(같은 인원으로 서브라운드 재시작) 또는 `ABORT`(대기방으로)다(US-463)

<aside>
💡

화면에 보이는 말은 그대로 "라운드"이고, `subRound`는 DB `game_rounds`(게임 한 판)와 겹치지 않게 두려고 쓰는 내부 식별자다(D-57).

</aside>

---

## 6. WebSocket — 서버 → 클라이언트

| 이벤트 | 핵심 data | 받는 사람 | 기능 ID |
| --- | --- | --- | --- |
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
| --- | --- | --- |
| `member:left` | `LEAVE` | 직접 나감 |
|  | `KICKED` | 방장이 내보냄 |
|  | `DISCONNECT` | 연결이 끊김 |
| `member:kicked` | `KICKED` | 내보내진 본인에게만. 받는 즉시 소켓이 닫힌다 |
| `round:closed` | `COMPLETED` | 결과를 보고 방장이 대기방으로 |
|  | `NO_OPTIONS` | 킹메이커 안건 0개 (US-433.6) |
|  | `NUNCHI_ABORTED` | 눈치 무효 라운드에서 방장이 `ABORT` (US-463.3) |
| `room:closed` | `HOST_LEFT` | 방장 이탈 |
|  | `EMPTY` | 마지막 참가자 이탈 |
|  | `INACTIVE` | 10분 무활동 |

**강퇴는 두 이벤트를 함께 발행한다**(D-49) — 대상은 소켓이 끊기기 전에 이유를 받아야 안내할 수 있고, 나머지는 목록에서 지우고 시스템 메시지를 남겨야 한다. `round:closed`의 `reason`은 DB `game_rounds.ended_reason`과 **같은 값**이다.

### 6.3 채팅

```json
// chat:message
{ "messageId": "msg_01H…", "memberId": "mbr_01H…",
  "text": "다 모였으면 시작해요", "sentAt": "2026-07-30T15:04:05+09:00" }
```

- 서버가 `messageId`·`sentAt`을 붙여 **보낸 본인을 포함한 전원**에게 돌려준다. 클라이언트가 미리 그리지 않고 기다렸다 그리면 순서가 보장된다
- `text`는 **200자 이하**(US-202.2). 빈 문자열이거나 공백뿐이면 서버가 버린다
- **시스템 메시지도 서버가 발행한다**(D-58). `memberId: null`이고 가운데 정렬로 그린다. 입장·퇴장·강퇴·게임 시작이 대상이다(F-205)
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
| --- | --- |
| `GUIDE` | 시작 직후 3초 가이드 |
| `PLAYING` | 공통 진행 (룰렛·사다리·시간초·눈치) |
| `SUBMIT` | 킹메이커 안건 제출 (2분) |
| `VOTE` | 킹메이커·저격 투표 |
| `TIE` | 결선 투표·동점자 재대결 |
| `INVALID` | 눈치 무효 라운드 — 방장 선택 대기 |
| `RESULT` | 결과 확정 후 |

게임별로 지나는 phase는 [db.md §10.2](https://app.notion.com/p/3ada1918c02a81d58537e284bd5aa894?pvs=21)에 정리돼 있다. `deadlineAt`은 제한 시간이 없는 단계면 `null`이다. 전원이 입력을 마치면 시간이 남아도 즉시 다음 phase로 넘어간다(US-402.4 · F-406).

**단계 전환 시 그 단계에 필요한 데이터를 함께 싣는다**(`API-09`). 지금은 킹메이커 하나가 해당한다.

| 게임 | phase | 함께 싣는 것 |
| --- | --- | --- |
| `kingmaker` | `VOTE` | `options[]` — 제출된 안건을 **작성자 없이 섞은 순서**로 (F-432 · US-431.4) |
| 그 밖 | — | 추가 필드 없음 |

안건이 1개뿐이면 투표를 건너뛰고 바로 확정하므로 `VOTE`에 들어가지 않는다(US-433.5). 0개면 판이 취소된다(§6.2 `round:closed { NO_OPTIONS }`). 결선 회차의 후보는 `game:tie`가 같은 모양으로 다시 내려준다.

**세 가지 재시작이 서로 다른 신호를 쓴다**(D-59).

| 상황 | 신호 |
| --- | --- |
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
| --- | --- |
| `serverTime` | 클라이언트가 자기 시계와의 오차를 재는 기준. `resultScreenAt`·`deadlineAt` 같은 절대 시각을 해석할 때 이 오차로 보정한다 |
| `phaseRemainMs` | 현재 phase의 남은 시간. 제한 시간이 없는 단계면 `null` (F-410) |
| `roomExpiresInMs` | 10분 무활동 만료까지 남은 시간. 사용자 행동이 있을 때마다 다시 늘어난다 (F-214) |
- 클라이언트는 **첫 틱으로 오차를 재고 이후에는 자체 타이머를 돌리되, 매 틱마다 보정**한다. 틱마다 숫자를 새로 그리면 네트워크가 튈 때 카운트가 끊겨 보인다.
- 이 이벤트는 **방 만료를 연장하지 않는다.** 서버가 보내는 것이지 사용자 행동이 아니다(C-7).

### 6.7 `game:result`

```json
{ "roundId": "rnd_01H…", "variant": "record",
  "result": { }, "resultScreenAt": "2026-07-30T15:06:08+09:00" }
```

- `variant`는 `winner` · `assign` · `tally` · `record` 4종이고 클라이언트는 이걸로 결과 화면을 고른다(F-502)
- `result`의 구조는 [db.md §9](https://app.notion.com/p/3ada1918c02a81d58537e284bd5aa894?pvs=21)와 같다
- `resultScreenAt`은 결과 화면으로 전환할 절대 시각이다. 연출이 끝난 시점부터 **3초 뒤**이며, 절대 시각으로 내려 참가자 간 편차를 0.5초 이내로 맞춘다(G-11 · US-501.2 · NFR-02)

---

## 7. 설정 계약 — F-306 · F-307 · F-309

`config`의 허용값과 **기본값의 정본은 서버**다(D-54). `GET /api/games/{gameId}`의 `configSchema`와 `game:selected`의 `config`가 같은 값을 내려주며, 프론트는 받은 값을 그리기만 한다. 게임을 바꾸면 이전 설정을 버리고 새 게임 기본값으로 초기화한다(D-19 · F-309).

| 게임 | 필드 | 허용값 | 기본값 |
| --- | --- | --- | --- |
| `roulette` | `topic` | 1~12자 | `팀장` |
| `ladder` | `topic` | 1~12자 | `조별과제` |
|  | `items` | 1~10개, 각 1~12자 | 조별과제 세트 6종 |
|  | `speed` | `fast` · `normal` · `slow` | `normal` |
| `kingmaker` | `topic` | 1~12자 | `팀명` |
|  | `votesPerMember` | `1` · `2` · `3` | `1` |
|  | `revealAuthors` | `true` · `false` | `false` |
| `timer` | `topic` | 1~12자 | `팀장` |
|  | `targetMs` | `5000` · `7000` · `10000` | `5000` |
|  | `winnerRule` | `closest` · `farthest` | `closest` |
| `snipe` | `topic` | 1~30자 (질문 문장) | `발표를 제일 잘할 것 같은 사람은?` |
|  | `voteSeconds` | 5~60 | `10` |
|  | `allowMultipleTargets` | `true` · `false` | `false` |
|  | `revealVoters` | `true` · `false` | `false` |
| `nunchi` | `topic` | 1~12자 | `팀장` |
|  | `decisionWindowMs` | `300` · `500` | `300` |
|  | `subRoundTimeoutMs` | `10000` · `15000` · `20000` | `15000` |

`topic`은 공백만으로 채울 수 없다. 범위를 벗어나면 `INVALID_CONFIG`다. 사다리는 **세트 칩 하나가 `topic`과 `items`를 함께 정한다** — 방장이 만지는 설정은 2개다(§3.2 · DB-05). `items`는 게임 시작 시 인원수에 맞춰 `X`로 채우거나 뒤에서 잘라내고, 그 결과를 다시 저장한다(F-310).

---

## 8. 오류 코드

| `code` | HTTP | 상황 |
| --- | --- | --- |
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

`message`는 그대로 띄울 수 있는 문구지만, **문구의 정본은 [screen.md](https://app.notion.com/p/3ada1918c02a81799231fda54fb66f9d?pvs=21)**다. 서버 문구와 화면 문구가 어긋나면 화면 쪽이 이긴다.

| code | 화면 |
| --- | --- |
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

DB 잠금 순서는 [db.md §15](https://app.notion.com/p/3ada1918c02a81d58537e284bd5aa894?pvs=21)를 따른다. 모든 브로드캐스트는 commit 이후다(C-6).

| 흐름 | 순서 |
| --- | --- |
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

이 문서를 쓰며 확정됐지만 **사용자가 관측하는 규칙**이라 `requirements.md §6`에 올린 것들이다. `db.md §17`의 D-44~D-53에 이어진다.

| ID | 결정 |
| --- | --- |
| D-54 | 게임 설정 기본값의 정본은 서버이며, 프론트는 받은 값을 그린다 |
| D-55 | `다시 하기`는 클라이언트가 설정을 보내지 않고 서버가 직전 판의 값을 쓴다 |
| D-56 | 시간초 동점자 재대결은 같은 판 안에서 진행한다 |
| D-57 | 눈치 내부 라운드는 화면에서 "라운드"로 부르고 내부 식별자는 `subRound`로 둔다 |
| D-58 | 입퇴장·게임 시작 시스템 메시지는 서버가 발행한다 |
| D-59 | 다시 하기·결선·무효 라운드 재시작은 서로 다른 신호를 쓴다 |

---

## 11. 이 문서에서 정한 인터페이스 결정

| ID | 결정 | 근거 |
| --- | --- | --- |
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

- [ ]  `roomName` 30자 성공 · 31자 실패, `bio` 24자 성공 · 25자 실패
- [ ]  닉네임에 공백이 있으면 `NICKNAME_INVALID`, 대소문자만 다른 중복이면 `NICKNAME_DUPLICATED`
- [ ]  `active` 상태에서 `PATCH` 재호출 시 `PROFILE_ALREADY_CONFIRMED`
- [ ]  `pending` 2분 만료 후 슬롯 회수 · `currentMembers`가 `pending`을 포함
- [ ]  방장의 `member:ready`가 `INVALID_ACTION`, guest 전원 ready일 때만 `game:start` 성공
- [ ]  `waiting`이 아닌 방에 입장 시 `ROOM_ALREADY_PLAYING` / `ROOM_IN_RESULT`가 각각 나옴
- [ ]  강퇴 시 대상은 `member:kicked`, 나머지는 `member:left { KICKED }`를 받음
- [ ]  방장이 `waiting`·`playing`·`result` 어디서 나가도 `room:closed { HOST_LEFT }`이고 `game:result`가 없음
- [ ]  `game:select`에서 최소 인원 미달이 `NOT_ENOUGH_MEMBERS`로 거절됨
- [ ]  참가자 이탈로 미달이 되면 선택이 해제되고 `selectableGameIds`가 갱신됨
- [ ]  `chat:send`가 200자 초과 시 거절, 보낸 본인도 `chat:message`를 받음
- [ ]  입퇴장 시 서버가 시스템 메시지(`memberId: null`)를 발행함
- [ ]  `king.vote`의 `optionIds` 1~3개 · 자기 안건 차단 · 중복 차단
- [ ]  `snipe.vote`의 다중 지목 설정과 자기 지목 차단
- [ ]  `timer.start`/`stop` payload에 클라이언트 시각이 없음
- [ ]  같은 입력 재전송이 성공을 반환하고, 다른 내용 재전송이 `ALREADY_SUBMITTED`
- [ ]  `game:started`의 `guideEndsAt`이 최초 시작에는 시각, `다시 하기`에는 `null`
- [ ]  결선은 `game:phase TIE`, 무효 라운드 재시작은 `game:phase PLAYING`으로 나감
- [ ]  킹메이커 안건 0개 시 `round:closed { NO_OPTIONS }`
- [ ]  과거 결과를 주는 REST·소켓 경로가 존재하지 않음
- [ ]  `game:progress`에 득표·기록·입력 내용이 들어 있지 않음

# 공통 응답 규격 · 에러 코드 (초안) (1)

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
| `NOT_ENOUGH_MEMBERS` | 400 | 2명 미만 시작 | S-04P 상태 밴드 |
| `INVALID_CONFIG` | 400 | 게임 설정 값 위반 (예: 사다리 결과 항목 > 참가자 수) | S-04P 설정 패널 |
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
- `bio`: 0~24자, 선택 (S-03 `한 줄 소개 (선택)`)

```json
// 응답 data
{ "memberId": "mbr_01H...", "memberStatus": "ACTIVE", "nickname": "코딩왕지호", "avatarId": "A06", "bio": "@jiho_dev · 프론트엔드 담당" }
```

- 성공 시 `memberStatus`가 `ACTIVE`로 바뀌고, **이 시점에 소켓 `member:joined`가 브로드캐스트**된다 (참여자는 이미 연결된 소켓으로 다른 사람에게 자신이 보이기 시작하는 순간, 방장은 곧이어 직접 소켓을 여는 순간)
- **참여자**: 이미 가입 시점에 소켓이 연결돼 있으므로 이 호출은 프로필만 갱신한다
- **방장**: 이 호출이 성공한 **직후 클라이언트가 소켓을 연결**한다 (S-04P 대기방 진입)

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
- `configSchema`는 소켓 `game:config`로 보낼 수 있는 설정 항목의 규격(타입·범위). S-04P 설정 패널을 이 값으로 그린다

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