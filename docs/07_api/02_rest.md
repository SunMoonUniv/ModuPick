# REST 엔드포인트

> **대상**: 대기방 진입 전의 전 통신 — 방 생성 · 코드 검증 · 가입 · 아바타 조회 · 프로필 확정 · 퇴장 · 게임 메타 2본 + 운영 1본
> **작성일**: 2026-08-02
> **개정일**: 2026-08-02 — 종료 코드 1000의 용도를 나가기 버튼으로 한정한다(beforeunload·페이지 숨김에서는 쓰지 않는다). REST 표면 자체는 바뀌지 않았다
> **원천**: git 529e312(docs/api.md 「REST API 명세」 · docs/db.md §15) · git ecceb11(docs/06_api/01_rest.md) · docs_legacy/requirements.md §4.1 US-101~105 · frontend/src/lib/store.ts(createRoom · tryJoin · confirmProfile) · backend/app/main.py

대기방에 들어가기 전의 요청만 REST다. 대기방에 들어선 뒤의 모든 통신은 [03_socket_events.md](./03_socket_events.md)로 간다. 공통 응답 객체·식별자 직렬화·멱등 키·길이 상한은 [01_conventions.md](./01_conventions.md)를 따르며 여기서 다시 정의하지 않는다.

## 공통 규칙

| 항목 | 규칙 |
|------|------|
| 기본 경로 | /api |
| 인증 | Authorization: Bearer {memberToken}. 필요한 엔드포인트에만 요구한다 |
| 방 코드 | 경로에는 접두어 없이 **숫자 6자리**만 넣는다 — /api/rooms/427132. MODU-427132는 화면 표시 전용이다 |
| 요청 본문 | JSON · camelCase. DB 컬럼(snake_case)과의 변환은 서버가 한다 |
| 응답 | [01_conventions.md](./01_conventions.md)의 공통 객체. 아래 예시의 "응답 data"는 그 객체의 data 필드다 |
| 상태 검증 순서 | 형식·길이 검증 → 방 행 잠금 → 상태·만료·정원 재확인 → 변경. 잠금 전 검증은 빠른 실패용이고 판정은 잠금 뒤에 한다(db.md §12) |
| 이벤트 발행 | DB 커밋이 성공한 뒤에만 소켓 이벤트를 발행한다. 트랜잭션 안에서 소켓 전송을 하지 않는다 |

## 엔드포인트 목록

| # | Method | 경로 | 역할 | 인증 | 멱등 키 | 상태 |
|:-:|:------:|------|------|:----:|:------:|:----:|
| 1 | POST | /api/rooms | 방 생성 + 방장 가입(PENDING) | — | 필수 | ⬜ |
| 2 | GET | /api/rooms/{code} | 초대 코드 검증 | — | — | ⬜ |
| 3 | POST | /api/rooms/{code}/members | 가입 — 슬롯 선점 + 토큰 발급 | — | 필수 | ⬜ |
| 4 | GET | /api/rooms/{code}/avatars | 아바타 30종 + 선점 현황 | Bearer | — | ⬜ |
| 5 | PATCH | /api/rooms/{code}/members/me | 프로필 확정 → ACTIVE | Bearer | 필수 | ⬜ |
| 6 | DELETE | /api/rooms/{code}/members/me | **소켓 연결 이전** 이탈 | Bearer | — | ⬜ |
| 7 | GET | /api/games | 게임 메타 목록 6종 | — | — | ⬜ |
| 8 | GET | /api/games/{gameId} | 게임 상세 · 가이드 | — | — | ⬜ |

**제품 표면은 이 8본 전량이다.** 이 밖의 기능을 REST로 올리지 않는다. 운영 표면 GET /health는 아래 「운영 표면」 절에서 따로 다루며 8본에 포함하지 않는다.

**퇴장 경로가 6번 하나가 아니라는 점에 주의한다.** 6번은 소켓을 아직 열지 않은 참가자(프로필 입력 중 뒤로가기)의 이탈만 담당한다. 대기방·게임 중의 나가기 버튼은 **소켓 종료 코드 1000**이며, 소켓이 곧 닫히는 요청의 결과를 소켓으로 받을 수 없기 때문이다. 이 구분은 이탈 유예 판정의 입력이 된다 — **1000은 나가기 버튼에서만 쓰고 beforeunload·페이지 숨김에서는 쓰지 않는다.**

## 1. POST /api/rooms — 방 만들기

방과 방장의 참가자 레코드를 **같은 트랜잭션**에서 만든다. 인증이 필요 없는 유일한 쓰기 엔드포인트다.

```json
// 요청
{
  "roomName": "4조 · 알고리즘 스터디",
  "maxMembers": 8
}
```

| 필드 | 규칙 | 위반 |
|------|------|------|
| roomName | 1~30자 · 필수 · 공백만 불가 | common.validation_failed |
| maxMembers | 2~10 정수 · 필수 · **생성 후 변경 불가** | common.validation_failed |

```json
// 응답 data (201)
{
  "code": "427132",
  "displayCode": "MODU-427132",
  "roomName": "4조 · 알고리즘 스터디",
  "maxMembers": 8,
  "memberId": "1042",
  "memberToken": "b9Qk7x2mF1sV...",
  "memberStatus": "PENDING",
  "isHost": true,
  "expiresAt": "2026-08-02T06:14:05.000Z"
}
```

- 코드는 **서버가 발급한다.** 방장이 지정할 수 없다. 활성 방과 충돌하면 재추첨하고 제한 횟수 안에 실패하면 room.code_exhausted.
- **방장은 이 시점에 소켓을 열지 않는다.** memberToken으로 아바타 조회는 바로 할 수 있지만, 소켓은 5번 프로필 확정에 성공한 직후에 연다.
- expiresAt은 방 만료 시각이다. 갱신 규칙은 아래 「방 수명과 만료」 절에 있다.

## 2. GET /api/rooms/{code} — 초대 코드 검증

인증이 필요 없다. 링크로 들어온 사람이 프로필 화면으로 갈 수 있는지 판정한다.

```json
// 응답 data (200)
{
  "code": "427132",
  "displayCode": "MODU-427132",
  "roomName": "4조 · 알고리즘 스터디",
  "roomStatus": "WAITING",
  "maxMembers": 8,
  "currentMembers": 5,
  "hostNickname": "지호"
}
```

| 상황 | 응답 |
|------|------|
| 없는 코드 · 이미 사라진 방 | 404 room.not_found |
| 게임 진행 중 | **409 room.already_playing** — 차단 팝업을 띄운다 |
| 정원이 이미 참 | 409 room.full |
| 만료된 방 | 410 room.expired |

- roomStatus는 WAITING · PLAYING 2값이다. 방이 닫히면 행이 삭제되므로 CLOSED 상태는 조회로 관측되지 않는다 — 원천의 CLOSED는 폐기한다.
- **currentMembers는 PENDING + ACTIVE 합산**이다. 아직 프로필을 안 채운 사람도 슬롯을 차지해야 정원 초과를 정확히 막는다.
- hostNickname은 방장이 아직 PENDING이면 null이다.
- **무차별 대입 방어**: 코드가 6자리 숫자이므로 이 엔드포인트는 방 존재 여부를 노출한다. IP 단위로 분당 20회를 넘으면 429 common.rate_limited로 거절하고 지연을 준다(db.md §18).

## 3. POST /api/rooms/{code}/members — 가입

**요청 본문이 없다.** 2번으로 코드가 검증된 직후, 프로필 입력 전에 호출해 슬롯을 선점하고 토큰만 먼저 받는다.

```json
// 응답 data (201)
{
  "memberId": "1047",
  "memberToken": "k3Zp8w5nD2rQ...",
  "memberStatus": "PENDING",
  "isHost": false,
  "currentMembers": 6,
  "maxMembers": 8
}
```

| 상황 | 응답 |
|------|------|
| 정원이 이미 참 | 409 room.full |
| 게임 진행 중 | 409 room.already_playing |
| 없는 방 | 404 room.not_found |
| 만료된 방 | 410 room.expired |

- 방 행을 잠그고 정원을 재확인한 뒤 참가자를 만든다. 마지막 한 자리에 대한 동시 입장 경합은 이 잠금이 막는다.
- 응답을 받으면 클라이언트는 **곧바로** 이 memberToken으로 소켓 핸드셰이크를 시도한다(프로필 화면 진입과 동시).
- **슬롯 자동 해제가 둘 있다.** 가입 후 **15초** 안에 핸드셰이크가 없으면 슬롯을 푼다. 핸드셰이크가 있어도 가입 후 **3분** 안에 5번으로 프로필을 확정하지 않으면 슬롯을 푼다. 앞의 값은 연결 실패를, 뒤의 값은 화면을 열어 둔 채 방치하는 것을 막는다.

## 4. GET /api/rooms/{code}/avatars — 아바타 선점 현황

가입 이후에만 호출할 수 있다.

```json
// 응답 data (200)
{
  "content": [
    { "avatarId": "A01", "name": "우주 코기", "imageUrl": "/assets/avatar/a01.png", "taken": true,  "takenBy": "서연" },
    { "avatarId": "A02", "name": "나무늘보 킹", "imageUrl": "/assets/avatar/a02.png", "taken": false, "takenBy": null }
  ],
  "totalCount": 30
}
```

- **30종 고정**이다. 근거는 frontend/src/lib/data.ts의 AVATAR_DEFS 30건이며, db.md §14의 A01~A15 검증 규칙은 A01~A30으로 확장해야 한다.
- **선점은 클릭 시점이 아니라 5번 성공 시점에 확정된다.** 그동안 다른 사람이 먼저 확정하면 소켓 member:joined를 받아 목록을 갱신한다.
- takenBy는 표시용 닉네임이며 memberId를 싣지 않는다. 프로필 화면의 사람이 대기방 참가자의 식별자를 알 이유가 없다.

## 5. PATCH /api/rooms/{code}/members/me — 프로필 확정

방장·참여자 공용이다. **PENDING 상태에서만** 호출할 수 있고 **한 번만** 확정할 수 있다(US-104.5).

```json
// 요청
{
  "nickname": "지호",
  "avatarId": "A06",
  "bio": "@jiho_dev · 프론트엔드 담당"
}
```

| 필드 | 규칙 | 위반 |
|------|------|------|
| nickname | 1~8자 · 필수 · 공백만 불가. **방 안에서 중복이면 서버가 접미 숫자를 붙여 확정한다** | member.nickname_invalid |
| avatarId | A01~A30 · **생략 가능**. 생략하면 서버가 남은 것 중 하나를 배정한다 | member.avatar_invalid · member.avatar_taken |
| bio | 0~24자 · 선택 | member.bio_too_long |

```json
// 응답 data (200)
{
  "memberId": "1047",
  "memberStatus": "ACTIVE",
  "nickname": "지호2",
  "avatarId": "A06",
  "bio": "@jiho_dev · 프론트엔드 담당",
  "isHost": false,
  "joinOrder": 6
}
```

- **응답의 nickname이 정본이다.** 중복 채번으로 요청값과 다를 수 있으므로 클라이언트는 응답값을 화면에 쓴다.
- joinOrder는 입장 순서(1부터)다. 룰렛 조각 배치와 사다리 레인 배치가 이 순서를 따르므로(requirements.md §3.5.1 · §3.5.2) 프로필 확정 시점에 확정되어야 한다.
- 성공하면 memberStatus가 ACTIVE로 바뀌고 **이 시점에 소켓 member:joined가 브로드캐스트**된다.
- **참여자**는 가입 시점에 이미 소켓이 붙어 있으므로 이 호출은 프로필만 확정한다. **방장**은 이 호출이 성공한 **직후에** 소켓을 연다.
- 이미 ACTIVE인데 다시 부르면 409 member.already_active. 같은 멱등 키의 재전송은 최초 결과를 재현한다.

## 6. DELETE /api/rooms/{code}/members/me — 소켓 연결 이전 이탈

프로필 입력 화면에서 뒤로 가는 경우에만 쓴다. **소켓이 이미 열려 있으면 이 호출을 쓰지 않는다** — 소켓 종료 코드 1000이 그 자리를 대신한다.

- 성공하면 204를 돌려주고 슬롯을 푼다. 이미 나간 상태의 재요청도 204다(자연 멱등).
- **방장이 호출하면 방을 삭제한다.** 남아 있는 참가자 전원에게 room:closed(reason HOST_LEFT)를 보내고 소켓을 닫는다.
- 참여자면 명단에 노출된 적이 있는 경우에만 member:left(reason LEAVE)를 브로드캐스트한다. PENDING이라 아직 아무에게도 안 보였다면 브로드캐스트하지 않는다.
- 소켓이 열려 있는 상태에서 호출되면 서버는 요청을 처리한 뒤 해당 소켓을 종료 코드 1000으로 닫는다.

## 7. GET /api/games — 게임 메타 목록

인증이 필요 없다. 표지 화면과 대기방 어디서든 같게 호출되는 정적 메타데이터라 소켓에 태우지 않는다.

```json
// 응답 data (200)
{
  "content": [
    {
      "gameId": "roulette",
      "name": "운명의 룰렛",
      "description": "돌림판이 멈춘 조각의 사람이 뽑힌다",
      "minMembers": 2,
      "maxMembers": 10,
      "resultVariant": "WINNER",
      "configSchema": { }
    }
  ],
  "totalCount": 6
}
```

| gameId | 이름 | 최소 인원 | 결과 형태 |
|--------|------|:--------:|-----------|
| roulette | 운명의 룰렛 | 2 | WINNER |
| ladder | 사다리타기 | 2 | ASSIGN |
| kingmaker | 킹메이커 | 3 | TALLY |
| timer | 시간초 잡기 | 2 | WINNER |
| snipe | 익명 저격 | 3 | WINNER |
| nunchi | 눈치게임 | 3 | RECORD |

- 최소 인원의 근거는 requirements.md §3.2 스펙 시트다. 최대 인원은 6종 모두 10이다.
- resultVariant 4종(WINNER · ASSIGN · TALLY · RECORD)은 frontend/src/lib/types.ts의 GameResult 유니언과 대응한다. 클라이언트가 결과 화면 레이아웃을 고르는 축이다.
- **서버 난수 2 · 참가자 투표 2 · 참가자 실력 2의 분류는 응답에 싣지 않는다.** 화면에 표시하지 않는 문서상 구분이기 때문이다(requirements.md §3.2).
- configSchema의 전수는 [03_socket_events.md](./03_socket_events.md)의 configSchema 절이 정본이다.

## 8. GET /api/games/{gameId} — 게임 상세 · 가이드

```json
// 응답 data (200)
{
  "gameId": "roulette",
  "name": "운명의 룰렛",
  "minMembers": 2,
  "resultVariant": "WINNER",
  "rules": ["참가자 전원이 같은 크기의 조각을 하나씩 갖는다", "방장이 PICK을 누르면 전원의 룰렛이 동시에 돈다"],
  "steps": ["방장이 PICK", "3~5초 회전", "정해진 조각에서 정지"],
  "configSchema": { }
}
```

- 없는 gameId면 404 game.not_found.
- 게임 시작 직후의 가이드 팝업과 게임 화면의 도움말 버튼이 같은 엔드포인트를 쓴다.
- 가이드 노출 이력은 서버가 보관하지 않는다. 다시 보지 않기 선택은 클라이언트 로컬 저장이다.

## 방 수명과 만료

REST 응답의 expiresAt이 무엇을 뜻하는지 여기서 확정한다.

| 사유 | 시점 | 통지 |
|------|------|------|
| 방장 이탈 확정 | 즉시 | room:closed(HOST_LEFT) |
| 마지막 참가자 이탈 확정 | 즉시 | 받을 사람이 없다 |
| **10분 무활동** | expiresAt 도달 | room:closed(EXPIRED) |

- 만료 타이머는 **사용자 행동만** 갱신한다 — 채팅·준비 토글·게임 설정 변경·게임 입력. 하트비트 제어 프레임과 tick은 갱신하지 않는다. 사람이 없는 방을 소켓이 살려 두면 안 되기 때문이다.
- 게임이 진행 중(PLAYING)인 동안은 만료 타이머를 **멈춘다.** 긴 게임이 무활동으로 오인되지 않게 한다.
- **이탈 유예 중에는 아직 이탈이 아니다.** 유예가 끝나 확정된 순간에 위 표의 "즉시"가 적용된다. 유예 규정은 [03_socket_events.md](./03_socket_events.md)에 있다.

## 운영 표면

| Method | 경로 | 역할 | 인증 | 상태 |
|:------:|------|------|:----:|:----:|
| GET | /health | 프로세스 생존 확인 | — | ✅ |

- 응답은 공통 응답 객체를 쓰지 않는다. 로드밸런서·배포 스크립트가 읽는 표면이라 제품 규약을 따를 이유가 없다.
- **DB 연결 상태를 확인하지 않는다.** 방 상태가 프로세스 메모리에 있으므로 DB가 잠시 끊겨도 진행 중인 판은 계속되어야 하고, 여기서 실패를 보고하면 배포 도구가 프로세스를 죽여 방을 통째로 날린다.
- backend/app/main.py에 구현되어 있다.

## 에러

각 엔드포인트가 낼 수 있는 코드의 전량과 HTTP 상태 매핑은 [04_error_mapping.md](./04_error_mapping.md)에 있다. 채번 정본은 [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)다.

## 관련 문서

- 공통 규약 · 멱등 · 길이 상한 → [01_conventions.md](./01_conventions.md)
- 대기방 이후의 전 통신 → [03_socket_events.md](./03_socket_events.md)
- 에러 매핑 → [04_error_mapping.md](./04_error_mapping.md)
- 테이블·트랜잭션 정본 → [../06_database/README.md](../06_database/README.md)
- 게임 규칙·최소 인원 정본 → [../05_game_rules/README.md](../05_game_rules/README.md)
- 화면 명세 → [../08_screen/README.md](../08_screen/README.md)
- 폴더 색인·고정 기준 → [README.md](./README.md)
