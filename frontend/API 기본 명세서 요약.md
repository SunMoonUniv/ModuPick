# API 기본 명세서 요약

> 원본: `API 기본 명세서.md`

## 문서 구조 (원본이 3단 구성이라 우선순위 주의)
1. **`API 구현 기준 v1.0`**(원본 상단) — 최종 확정본. 아래 두 문서와 충돌하면 **이게 이긴다**.
2. **`🍎 API 설계서 (Claude Code)`**(원본 중단) — v1.0 이전에 작성된 상세 본문. v1.0이 건드리지 않은 부분은 이 문서가 기준.
3. **`공통 응답 규격·에러 코드 (초안)(1)`**(원본 최하단) — 가장 오래된 초안. **더 이상 유효하지 않음, 참고 금지** (예: `NICKNAME_DUPLICATED`를 에러로 처리, 상태값 대문자 `WAITING`/`PENDING` 등 전부 v1.0에서 뒤집힘).

## v1.0에서 바뀐 것 (최우선 적용)
| 항목 | 확정 내용 |
| --- | --- |
| 방장 이탈 | `room:closed HOST_LEFT` 후 방 삭제. `host:changed` 없음(방장 위임 없음) |
| 프로필 | `PENDING`에서 딱 한 번만 PATCH. `bio` 24자. **닉네임 중복은 에러 아님** — 서버가 지호2, 지호3처럼 자동 번호 부여 |
| Ready | guest 전용. host는 Ready 개념 없음 |
| 강퇴 | `waiting`에서만 가능. 강퇴 후 새 `memberId`로 재입장 허용 |
| 방 상태 | `WAITING` / `PLAYING` / `RESULT` 3종 (표기는 소문자 `waiting`/`playing`/`result`) |
| 사다리 | `ladder.pick`(레인 선택) 제거. host의 `ladder.start`만 사용 — snapshot 순서로 자동 배치 |
| 킹메이커 | `targetMemberId` 대신 `optionIds` 배열 (안건 익명 투표, 1~3표) |
| 저격 | `targetMemberIds` 배열 (다중 지목 설정 + 결선 반복 지원) |
| 시간초 | `timer.start`/`stop` payload에 클라이언트 시각 없음 — 서버가 수신 시각 기록 |
| 결과 | 난수 시드는 서버만 보관. 과거 결과 조회 REST 없음 |

## 공통 계약
- 방 코드: DB엔 숫자 6자리, 화면엔 `MODU-` 접두어
- `memberId`/`roundId`/`optionId`는 각각 `mbr_`/`rnd_`/`opt_` 접두 불투명 문자열
- 모든 S→C `data`에 `roomVersion` 포함 (작거나 같으면 클라가 무시)
- 날짜는 ISO 8601(+타임존), 판정용 시각은 서버 내부 **정수 밀리초**
- 토큰은 식별용, 권한은 매번 `participants.role` 재조회로 판단
- 상태 변경 이벤트는 **DB commit 이후**에만 발행 (실패 시 브로드캐스트 없음)
- 유효한 REST/C→S 이벤트는 방의 10분 무활동 만료를 연장 (서버 tick·브로드캐스트는 연장 안 함)
- **재접속 없음** — 소켓 끊기면 그 memberId는 바로 퇴장, 되돌아오는 경로 없음
- 서버는 **단일 인스턴스** (진행 상태를 프로세스 메모리에 둠)
- 표기 규칙: 상태·종류는 소문자(`roomStatus: "waiting"`), 사유·판정·프로토콜 상수는 대문자(`reason: "KICKED"`, `phase: "VOTE"`)

## 연결 수명주기
```
POST /rooms 또는 POST /rooms/{code}/members  → pending 슬롯 선점, 정원에 포함, 2분 내 미확정 시 자동 회수
PATCH /rooms/{code}/members/me               → 프로필 확정, active로 전환
WebSocket 핸드셰이크                          → 방장·참가자 모두 프로필 확정 "직후" 연결 (pending 상태 소켓은 없음)
room:snapshot (최초 1회)                      → 이후 개별 이벤트로 부분 갱신
```
연결 종료 = 즉시 퇴장(`member:left DISCONNECT`). 게임 중이면 후보 명단엔 남음. 새로고침 한 번이면 방에서 빠지므로 이탈 경고 UI 권장.

## REST API
| Method | Path | 기능 | 인증 |
| --- | --- | --- | --- |
| POST | `/api/rooms` | 방 + pending 방장 생성 | - |
| GET | `/api/rooms/{code}` | 입장 가능 여부·방 상태 조회 | - |
| POST | `/api/rooms/{code}/members` | pending 참가자 슬롯 생성 | - |
| GET | `/api/rooms/{code}/avatars` | 아바타 30종 + 선점 현황 | Bearer |
| PATCH | `/api/rooms/{code}/members/me` | 프로필 최초 확정 | Bearer |
| DELETE | `/api/rooms/{code}/members/me` | 퇴장(host면 방 삭제) | Bearer |
| GET | `/api/games` | 게임 6종·최소인원·configSchema | - |
| GET | `/api/games/{gameId}` | 가이드·설정 상세 | - |

과거 결과 조회 REST(`/rooms/{code}/results`)는 **만들지 않음**.

### POST /api/rooms
- `roomName` 1~30자(빈값→"ModuPick 방"), `maxMembers` 2~10(기본 10, v1.0 하단 §2.1 표기 기준. 🍎 문서는 기본 10이라 명시)
- 응답: `code`, `displayCode`, `hostToken`, `memberId`, `memberStatus: pending`, `pendingExpiresAt`, `expiresAt`
- 방장은 이어서 PATCH로 프로필 확정 후 소켓 연결

### GET /api/rooms/{code}
- 응답: `roomStatus`(`waiting`/`playing`/`result`), `currentMembers`(pending+active 합산), `hostNickname` 등
- `playing`이면 `409 ROOM_ALREADY_PLAYING`, `result`면 `409 ROOM_IN_RESULT`
- 만료면 `410 ROOM_EXPIRED` + 방 삭제

### POST /api/rooms/{code}/members
- 요청 바디 없음. pending+active 합계가 정원 미만인지 확인, 차있으면 `409 ROOM_FULL`
- 강퇴된 사람이 재요청해도 자리 있으면 새 토큰/새 memberId 발급
- 2분 내 프로필 미확정 시 슬롯 회수

### GET /api/rooms/{code}/avatars
- 30종 고정, 방 내 중복 불가. 선점은 **PATCH 성공 시점**에 확정 (클릭 시점 아님)
- 프로필 화면엔 소켓이 없으므로 **3초 주기 폴링**으로 갱신 (API-08). 최종 방어선은 제출 시 `AVATAR_TAKEN`

### PATCH /api/rooms/{code}/members/me
- `pending`에서만 호출 가능, `active`면 `409 PROFILE_ALREADY_CONFIRMED`
- `nickname` 1~8자·공백 불가. **중복이어도 에러 아님** — 서버가 지호2, 지호3처럼 자동 번호 (v1.0)
- `avatarId` null이면 A01~A30 중 미사용 최소값 자동 배정, 명시값이 이미 사용중이면 `409 AVATAR_TAKEN`
- `bio` 0~24자, 선택
- commit 후 `member:joined` 발행. 클라이언트는 이 응답 받고 소켓 연결

### DELETE /api/rooms/{code}/members/me
- guest: `member:left LEAVE` 브로드캐스트
- host: 상태 무관하게 방 삭제, `room:closed HOST_LEFT` 전원 발송. `playing`에서 나가면 결과 안 만듦
- 방장 위임/`host:changed` 없음

### GET /api/games, GET /api/games/{gameId}
- 인증 불필요, 정적 메타데이터
- 게임별 최소 인원: roulette 2 · ladder 2 · kingmaker 3 · timer 2 · snipe 3 · nunchi 3
- `configSchema`엔 허용값+기본값 함께 포함 (기본값 정본은 서버)

## WebSocket C→S
| 이벤트 | payload | 조건 |
| --- | --- | --- |
| `member:ready` | `{ ready }` | active guest, waiting 전용. host가 보내면 `INVALID_ACTION` |
| `member:kick` | `{ memberId }` | host, waiting 전용, 대상은 guest만(자기자신 불가) |
| `chat:send` | `{ text }` | active 전원, 200자 이하 |
| `chat:typing` | `{ typing }` | active 전원 |
| `game:select` | `{ gameId }` | host, waiting, 최소인원 그 자리에서 검사 |
| `game:config` | `{ gameId, config }` | host, waiting |
| `game:random` | `{ }` | host, waiting |
| `game:start` | `{ }` | host, waiting, **guest 전원 ready 필수** |
| `game:replay` | `{ }` | host, result에서만. 직전 판 설정을 서버가 재사용(클라가 설정 안 보냄) |
| `game:action` | `{ roundId, type, payload }` | 게임·phase별 (아래) |
| `round:close` | `{ roundId }` | host, result→waiting |

참가자가 host 전용 이벤트 보내면 서버가 `NOT_HOST`로 거절. result 상태에선 신규 입장/프로필/강퇴 불가.

## game:action 계약
| 게임 | type | payload | 보내는 사람 |
| --- | --- | --- | --- |
| 룰렛 | `roulette.pick` | `{ }` | host 1회 |
| 사다리 | `ladder.start` | `{ }` | host 1회 (레인 선택 없음, snapshot 순서 자동 배치) |
| 킹메이커 | `king.opinion` | `{ text }` | 전원 1회, 1~120자 |
| 킹메이커 | `king.vote` | `{ optionIds }` | 전원, 회차당 1회, 1~votesPerMember개, 서로 다른 안건만 |
| 시간초 | `timer.start`/`timer.stop` | `{ }` | 클라 시각 없음, 서버가 ingress 도착 시각 기록 |
| 저격 | `snipe.vote` | `{ targetMemberIds }` | allowMultipleTargets 설정 따름, 자기자신/중복 거절 |
| 눈치 | `nunchi.up` | `{ }` | 생존자, 서브라운드당 1회 |
| 눈치 | `nunchi.invalid_decision` | `{ decision: RESTART\|ABORT }` | host, INVALID phase에서만 |

**멱등**: 같은 내용 재전송은 성공 취급, 다른 내용 재전송은 `ALREADY_SUBMITTED`. 마감 후 도착은 `ROUND_ALREADY_ENDED`.

- 시간초: `elapsedMs = stopServerTime - startServerTime`. 시작 10초 내 start 없거나 start 후 targetMs+3000 내 stop 없으면 최하위. 밀리초까지 동점이면 같은 판 안에서 TIE phase
- 저격: 전원 기권(빈 배열)이면 난수로 결정
- 눈치: decisionWindowMs 안에 몰린 입력을 한 그룹으로 판정, 생존자 전원이 한 그룹에 몰리면 INVALID phase → host의 RESTART/ABORT 대기

## WebSocket S→C
| 이벤트 | 핵심 data | 받는 사람 |
| --- | --- | --- |
| `room:snapshot` | room, members(active만), game, `selectableGameIds`, roomVersion | 본인, 연결 직후 1회 |
| `member:joined` | member | 전원 |
| `member:left` | memberId, reason(LEAVE/KICKED/DISCONNECT) | 전원 |
| `member:kicked` | reason: KICKED | **대상에게만**, 받는 즉시 소켓 종료 |
| `member:ready_changed` | memberId, ready, readyCount, activeCount | 전원 |
| `chat:message` | messageId, memberId, text, sentAt | 전원(본인 포함) |
| `chat:typing` | memberId, typing | 본인 제외 |
| `game:selected` | gameId, config, configSchema | 전원 |
| `game:config_changed` | gameId, config | 전원 |
| `game:started` | roundId, gameId, roundMembers, config, guideEndsAt | 전원 |
| `game:phase` | roundId, phase, deadlineAt(+킹메이커 VOTE는 options[]) | 전원 |
| `server:tick` | serverTime, phaseRemainMs, roomExpiresInMs | 전원, **1초 주기** |
| `game:progress` | 참가자별 COMPLETE/WAITING만(득표·내용 없음) | 전원 |
| `game:tie` | 후보 목록, deadlineAt | 전원 |
| `game:result` | roundId, variant(winner/assign/tally/record), result, resultScreenAt | 전원 |
| `round:closed` | roundId, reason(COMPLETED/NO_OPTIONS/NUNCHI_ABORTED) | 전원 |
| `room:closed` | reason(HOST_LEFT/EMPTY/INACTIVE) | 전원, 소켓 종료 |
| `error` | code, message | 보낸 사람만 |

- `host:changed` 이벤트 없음(방장 권한 이양 없음)
- 이탈자도 `roundMembers`에서 제거 안 하고 `departed: true`만 표시
- 강퇴는 두 이벤트 동시 발행: 대상에게 `member:kicked`, 나머지에게 `member:left KICKED`
- `game:started`의 `guideEndsAt`은 최초 시작엔 시각, "다시 하기"엔 `null`
- 채팅은 스냅샷에 없음(서버가 저장 안 함, 로컬스토리지로 복원)

## config 계약 (허용값 / 기본값)
| 게임 | 필드 | 허용값 | 기본값 |
| --- | --- | --- | --- |
| roulette | topic | 1~12자 | 팀장 |
| ladder | topic / items / speed | 1~12자 / 1~10개 각1~12자 / fast·normal·slow | 조별과제 / 세트6종 / normal |
| kingmaker | topic / votesPerMember / revealAuthors | 1~12자 / 1·2·3 / true·false | 팀명 / 1 / false |
| timer | topic / targetMs / winnerRule | 1~12자 / 5000·7000·10000 / closest·farthest | 팀장 / 5000 / closest |
| snipe | topic / voteSeconds / allowMultipleTargets / revealVoters | 1~30자 / 5~60 / true·false / true·false | (질문문구) / 10 / false / false |
| nunchi | topic / decisionWindowMs / subRoundTimeoutMs | 1~12자 / 300·500 / 10000·15000·20000 | 팀장 / 300 / 15000 |

기본값 정본은 서버. 게임 바꾸면 이전 설정 버리고 새 기본값으로 초기화. 사다리 `items`는 시작 시 인원수 맞춰 자동 보정(X 채움/자르기).

## 주요 오류 코드
`ROOM_NOT_FOUND`(404) `ROOM_EXPIRED`(410) `ROOM_FULL`(409) `ROOM_ALREADY_PLAYING`(409) `ROOM_IN_RESULT`(409) `PROFILE_ALREADY_CONFIRMED`(409) `NICKNAME_INVALID`(400) `AVATAR_TAKEN`(409) `NOT_HOST`(403) `NOT_ALL_READY`(400) `NOT_ENOUGH_MEMBERS`(400) `INVALID_CONFIG`(400) `INVALID_OPTION`(400) `TOO_MANY_CHOICES`(400) `SELF_VOTE_NOT_ALLOWED`(400) `ALREADY_SUBMITTED`(409, 내용 다를 때만) `ROUND_ALREADY_ENDED`(409) `INVALID_ACTION`(400) `GAME_NOT_FOUND`(404) `SESSION_EXPIRED`(401)

**`NICKNAME_DUPLICATED`는 v1.0에서 제거됨** — 자동 번호 부여로 대체. `error` 이벤트는 보낸 사람에게만 감(브로드캐스트 없음).

## 트랜잭션·이벤트 순서
게임 시작: room 잠금→방장·상태·인원·ready·config 검증→snapshot/round 생성→playing→**commit**→`game:started`
참가자 퇴장: 잠금→left_at→commit→`member:left`
강퇴: 잠금→left_at→commit→대상 `member:kicked` + 나머지 `member:left KICKED`
방장 퇴장: 잠금→방 DELETE→commit→`room:closed HOST_LEFT`
투표: 후보 검증→저장→commit→완료자만 `game:progress`
결과: 저장→round finished→room result→commit→`game:result`
대기방 복귀: result 확인→waiting→ready 초기화→commit→`round:closed`
모든 쓰기 이벤트는 **실패 시 브로드캐스트 안 함**.

## 확정된 인터페이스 설계 결정 (API-01~09)
- 화면 분기는 HTTP 상태가 아니라 `code` 문자열로
- 모든 S→C에 `roomVersion` — 순서 뒤집힌 이벤트는 클라가 버림
- 게임 입력은 `game:action` 하나 + `type` 분기 (이벤트 폭발 방지)
- `game:progress`는 완료/대기 상태만 (득표·내용 비공개)
- `resultScreenAt`은 절대 시각(참가자 간 전환 오차 0.5초 이내 목표)
- `room:snapshot.selectableGameIds`로 최소인원 판단 근거를 서버에 둠
- 서버시각·phase남은시간·방만료남은시간을 `server:tick` 하나로 1초마다 통합 전송
- 프로필 화면 아바타 선점 현황은 소켓 대신 `GET /avatars` 3초 폴링 (프로필 확정 전엔 소켓 없음)
- `game:phase`가 그 단계 필요 데이터 동반 (킹메이커 VOTE의 options[])

## 지금 단계에서 필요한 부분 (프론트-임시서버 구현 스코프 판단용)
LAN 로컬 임시 서버로 대기방까지만 구현할 경우 최소 필요 영역:
- REST: `POST /rooms`, `GET /rooms/{code}`, `POST /rooms/{code}/members`, `PATCH /rooms/{code}/members/me`, `DELETE /rooms/{code}/members/me`, `GET /games`(설정 스키마 그리는 데 필요)
- 소켓 C→S: `member:ready`, `member:kick`, `chat:send`, `chat:typing`, `game:select`, `game:config`, `game:random`, `game:start`
- 소켓 S→C: `room:snapshot`, `member:joined`, `member:left`, `member:kicked`, `member:ready_changed`, `chat:message`, `chat:typing`, `game:selected`, `game:config_changed`, `game:started`
- 인게임 프로토콜(`game:action`/`game:phase`/`server:tick`/`game:progress`/`game:tie`/`game:result`/`round:closed`)은 6개 게임 화면 로컬 시뮬레이션을 실제로 걷어낼 때 이어서 필요
