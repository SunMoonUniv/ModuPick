# API 공통 규약

> **대상**: 07_api 전 문서가 공유하는 규약 — 요청·응답 형식 · 식별자 직렬화 · 시각과 단위 · 멱등 키 · 길이·크기 상한 · 페이지네이션 부재 사유 · 버전 정책
> **작성일**: 2026-08-02
> **원천**: git 529e312(docs/api.md 「공통 응답 규격」 · docs/db.md §12~16) · git ecceb11(docs/06_api/00_conventions.md) · docs_legacy/requirements.md §4.1 US-104 · §5 NFR-03·NFR-04 · [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)

REST와 WebSocket이 함께 지키는 규약을 여기서 한 번만 정의한다. [02_rest.md](./02_rest.md) · [03_socket_events.md](./03_socket_events.md)는 이 문서를 인용하며 다시 정의하지 않는다. 규약이 어긋나면 본 문서가 이긴다.

## 공통 응답 객체

성공이든 실패든 **모든 응답과 모든 S→C 이벤트는 같은 형태**로 내려간다. 각 엔드포인트·이벤트의 페이로드는 data 안에 들어간다.

```json
{
  "success": true,
  "code": "ok",
  "message": null,
  "data": { },
  "timestamp": "2026-08-02T06:04:05.123Z"
}
```

```json
{
  "success": false,
  "code": "room.already_playing",
  "message": "이미 게임이 시작된 방이에요",
  "data": null,
  "timestamp": "2026-08-02T06:04:05.123Z"
}
```

| 규칙 | 내용 |
|------|------|
| 분기 기준 | HTTP 상태 코드는 그대로 쓰되 **화면 분기는 code 문자열로 판단한다.** 상태 코드는 거들 뿐이다 |
| code 형식 | 성공은 ok 고정. 실패는 {namespace}.{snake_case}이며 REST와 소켓이 **같은 문자열**을 쓴다. 소켓 전용 코드를 따로 만들지 않는다 |
| message | 그대로 팝업·토스트에 띄울 수 있는 한국어 문구다. 프론트가 코드별 문구를 따로 관리하지 않게 한다 |
| 내부 정보 | 스택 트레이스·SQL 원문·컬럼명·토큰 값을 message나 data에 싣지 않는다 |
| 소켓 실패 | S→C **error** 이벤트가 같은 객체로 내려가며 **보낸 사람에게만** 간다. 브로드캐스트하지 않는다 |
| 소켓 성공 | 성공 S→C 이벤트의 data에는 항상 **roomVersion**이 포함된다. 규칙은 [03_socket_events.md](./03_socket_events.md)에 있다 |

**소켓에는 요청-응답 짝이 없다.** C→S 이벤트의 성공은 뒤따르는 브로드캐스트로 관측하고, 실패만 error로 되돌아온다. 클라이언트가 자기 입력을 미리 그리지 않고 브로드캐스트를 기다려 그리면 전원의 화면 순서가 서버 순서와 같아진다.

## 식별자 직렬화

| 종류 | 와이어 표현 | 규칙 |
|------|------------|------|
| memberId · roundId · candidateId · messageId | **10진 문자열** | DB의 BIGINT UNSIGNED를 그대로 직렬화한다. JavaScript의 Number는 2^53을 넘으면 정밀도를 잃으므로 **클라이언트가 Number·parseInt로 변환하지 않는다.** 비교는 문자열 비교다 |
| 방 코드 code | **숫자 6자리 문자열** | 선행 0이 유효하므로 정수로 다루지 않는다. API 경로·소켓 룸 키에는 접두어 없이 6자리만 쓴다 |
| 표시용 코드 displayCode | MODU-{code} | 화면에만 쓴다. 입력으로 받지 않는다 |
| gameId | 소문자 슬러그 | roulette · ladder · kingmaker · timer · snipe · nunchi 6종 고정 |
| avatarId | A{2자리} | A01~A30. 근거는 frontend/src/lib/data.ts의 AVATAR_DEFS 30건 |
| memberToken | base64url 불투명 문자열 | 구조를 갖지 않는다. 클라이언트가 파싱해 의미를 읽는 경로를 두지 않는다 |
| 멱등 키 | UUIDv4 문자열 | 클라이언트가 생성한다. 엔티티 ID가 아니므로 ID 규약과 분리한다 |

**원천의 mbr_01H... · rnd_01H... 예시는 폐기한다.** [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)가 PK를 BIGINT UNSIGNED AUTO_INCREMENT로 확정했고 접두어 있는 ULID를 쓰지 않는다. 본 폴더의 모든 예시는 "1042" 같은 10진 문자열을 쓴다.

## 시각과 단위

| 항목 | 규칙 |
|------|------|
| 와이어 시각 | **ISO 8601 · UTC · Z 접미 · 밀리초 3자리** — 2026-08-02T06:04:05.123Z. 오프셋 표기(+09:00)를 쓰지 않는다 |
| 표시 시각 | 클라이언트가 사용자 시간대로 변환해 그린다. 서버는 변환하지 않는다 |
| 판정 시간 | **정수 밀리초**다. 부동소수점 초 단위를 쓰지 않는다(NFR-03) |
| 클라이언트 시계 | 판정에 쓰지 않는다. **유일한 예외는 시간초 잡기의 경과 시간**이며 규정은 [03_socket_events.md](./03_socket_events.md)에 있다 |
| 남은 시간 | remainMs — 정수 밀리초. 음수를 내려보내지 않고 0에서 멈춘다 |
| 서버 시각 | serverTime — 시각 동기화의 기준값이다. game:phase · game:tick · room:snapshot이 싣는다 |

**원천의 +09:00 예시는 폐기한다.** 저장은 UTC이고 DB 세션 시간대도 UTC로 고정되어 있으므로(db.md §19), 와이어에서만 지역 오프셋을 쓰면 변환 지점이 하나 늘어나고 서머타임 없는 지역이라는 우연에 기대게 된다.

## 멱등 키

같은 입력은 **최초 1회만** 인정한다. 재전송과 두 번째 시도를 구분하는 것이 핵심이다.

| 표면 | 키 | 중복 시 동작 |
|------|-----|-------------|
| POST /api/rooms | 요청 헤더 **Idempotency-Key**(UUIDv4). DB의 rooms.create_request_id에 UNIQUE | **최초 결과를 그대로 재현**한다. 새 방을 만들지 않는다 |
| POST /api/rooms/{code}/members | 요청 헤더 **Idempotency-Key** | 최초 결과(같은 memberId·같은 memberToken)를 재현한다. 슬롯을 두 번 먹지 않는다 |
| PATCH /api/rooms/{code}/members/me | 요청 헤더 **Idempotency-Key** + 상태 가드(PENDING에서만 호출 가능) | 같은 키면 최초 결과를 재현한다. 다른 키로 두 번째 확정을 시도하면 member.already_active |
| DELETE /api/rooms/{code}/members/me | 키 없음 | 자연 멱등이다. 이미 나간 상태의 재요청도 성공으로 처리한다 |
| 소켓 **game:action** · **game:decide** | 페이로드의 **requestId**(UUIDv4). 서버는 (roundId, memberId, requestId)로 판정 | **최초 처리 결과를 그대로 재현**한다. 에러가 아니다 |
| 소켓 그 외 C→S | 키 없음 | 마지막 값이 이기는 상태 갱신이거나(member:ready · chat:typing · game:config) 결과가 같은 조작이다 |

**재전송과 두 번째 시도는 다르다.** 같은 requestId로 다시 온 입력은 재전송이므로 최초 결과를 재현하고, **다른 requestId로 같은 종류의 입력**이 오면 두 번째 시도이므로 1회 제한 액션에서는 game.already_submitted로 거부한다. 원천은 이 둘을 구분하지 않아 네트워크 재전송이 사용자 오류로 보이는 결함이 있었다.

**다른 본문에 같은 멱등 키를 쓰면 거부한다**(common.idempotency_conflict). 최초 요청의 본문 해시를 키와 함께 보관하고 대조한다. 멱등 키의 보관 수명은 방 수명과 같다.

## 라운드 경계와 낡은 입력

이미 끝난 판·이전 단계에 도착한 입력은 버린다. 판정에는 세 값이 함께 쓰인다.

| 값 | 발급 | 검증 |
|-----|------|------|
| **roundId** | game:started가 새 라운드마다 발급 | 현재 라운드와 다르면 game.round_not_found. 이미 끝난 라운드면 game.round_already_ended |
| **phaseSeq** | game:phase가 단계 전이마다 0부터 단조 증가시켜 발급 | 서버의 현재 값과 다르면 **game.stale_phase**로 버린다 |
| **서버 도착 시각** | — | 마감 시각을 지나 도착한 입력은 phaseSeq가 맞더라도 버린다 |

phaseSeq는 라운드 안의 단계뿐 아니라 **동점 결선 회차까지 하나의 값으로 덮는다.** 결선은 새 라운드가 아니라 같은 roundId 안의 TIE 단계이므로 roundId만으로는 1차 결선의 입력과 2차 결선의 입력을 구분할 수 없다. 원천에는 이 구분 장치가 없었다.

## 길이·크기 상한

| 대상 | 상한 | 근거 |
|------|:----:|------|
| roomName | 1~30자 | requirements.md §3.4 |
| nickname | 1~8자 | requirements.md US-104.1 |
| bio | 0~24자 · 선택 | requirements.md US-104.4 |
| 주제 topic | 1~12자 | requirements.md §3.3 · US-304.2 |
| 저격 질문 question | 1~30자 | requirements.md §3.3 D — 문장이라 별도 상한 |
| 사다리 결과 항목 1건 | 1~12자 | requirements.md US-306.3 |
| 킹메이커 의견 text | 1~120자 | requirements.md §3.5.3 · D-24 |
| 채팅 text | 1~200자 | 서버가 저장하지 않아도 브로드캐스트 대역과 화면 붕괴를 막아야 한다. 공백만 있으면 서버가 무시한다 |
| 요청 본문 · 소켓 프레임 | **64KB** | 초과 시 common.payload_too_large. 소켓은 종료 코드 4413으로 닫는다 |

- 상한은 **클라이언트와 서버 양쪽에서** 검증한다. 클라이언트 검증은 사용성이고 판정은 서버다.
- 문자 수는 코드 포인트가 아니라 **유니코드 확장 자소 군집** 기준으로 센다. 이모지 하나가 8자를 먹으면 닉네임 상한이 의미를 잃는다.
- 출력 시 escape는 서버·클라이언트 양쪽에서 한다(db.md §18).

## 닉네임 중복은 거부가 아니라 채번이다

같은 방에 같은 닉네임이 있으면 **서버가 뒤에 숫자를 붙여 구분한다**(지호 → 지호2). requirements.md US-104.2가 정본이며, 원천 api.md의 NICKNAME_DUPLICATED 409는 이 규칙과 어긋나므로 채택하지 않는다.

- 접미를 붙여 8자를 넘으면 앞을 잘라 8자에 맞춘다.
- **클라이언트는 요청에 실은 값이 아니라 응답의 nickname을 화면에 쓴다.** 서버가 바꿔 확정할 수 있기 때문이다.
- 정원이 10명이므로 접미가 두 자리를 넘는 경우는 발생하지 않는다.

**아바타도 미선택을 허용한다**(US-104.3). avatarId를 생략하면 서버가 남은 아바타 중 하나를 배정한다. 아바타 30종에 정원 10명이므로 고갈되지 않으며, member.avatar_taken은 **동시 클릭 경합에서 늦게 확정한 쪽**에만 발생한다.

## 페이지네이션을 두지 않는다

목록을 돌려주는 표면은 셋뿐이고 셋 다 상한이 작고 고정이다. 쪽을 나누면 얻는 것 없이 왕복과 상태만 늘어난다.

| 목록 | 최대 건수 | 형태 |
|------|:--------:|------|
| GET /api/games | 6 (고정) | 전량 |
| GET /api/rooms/{code}/avatars | 30 (고정) | 전량 |
| room:snapshot의 members | 10 (방 정원 상한) | 전량 |

- **채팅 히스토리 목록이 없다.** 서버가 채팅을 저장하지 않으므로 조회할 대상 자체가 없고, 화면 복원은 클라이언트 로컬 스토리지가 담당한다. 원천 ecceb11의 room:snapshot messages 최근 50건은 폐기한다.
- **결과 이력 목록이 없다.** 대기방으로 돌아오면 그 판의 결과를 다시 열어볼 수 없다(US-504.2). 서버에는 방 수명 동안 남지만 조회 표면을 열지 않는다.
- 응답의 목록은 { content, totalCount } 형태로 감싼다. 나중에 쪽 나눔이 필요해져도 최상위 배열을 객체로 바꾸는 파괴적 변경을 하지 않기 위해서다.

## 왜 쿠키 세션이 아니라 토큰인가

이 제품에는 **로그인이 없다**(D-02). 계정·비밀번호·로그인 세션이라는 개념이 존재하지 않으므로 여기서 다루는 것은 인증이 아니라 **참가자 식별**이다. 그럼에도 "쿠키 세션이 낫지 않은가"는 반복해서 나오는 질문이라 판단 근거를 남긴다.

**지금 설계는 이미 무상태 토큰이 아니다.** 토큰은 클레임을 담아 서버가 검증만 하고 마는 물건이 아니라, 서버 메모리의 소켓 바인딩을 만드는 **핸들**이다. 권한 판정은 토큰 안의 값이 아니라 방 상태의 방장 식별자와 소켓 바인딩을 대조해서 한다([03_socket_events.md](./03_socket_events.md)). 서버가 상태를 들고 있고 토큰이 그것을 가리킨다는 점에서 성질은 세션에 가깝다.

**쿠키가 나은 점은 분명하다.** 브라우저 WebSocket API는 요청 헤더를 지정할 수 없어서 지금은 토큰을 첫 프레임(conn:auth)으로 보내는 우회를 쓴다. 쿠키였다면 핸드셰이크에 자동으로 실려 이 우회가 필요 없다.

**그런데 배포 형상이 그것을 막는다.**

| 형상 | 쿠키 세션 | 판정 |
|------|-----------|------|
| 프론트 Vercel + 백엔드 EC2 별도 도메인 (현재) | SameSite=None; Secure가 필요하고 **Safari ITP·Chrome 서드파티 쿠키 차단에 걸린다** | 쓸 수 없다 |
| 프론트·백엔드 같은 도메인(EC2 Nginx가 둘 다 서빙) | 1st-party 쿠키로 동작하며 핸드셰이크에 자동 전달된다 | 쿠키가 낫다 |

모바일 우선 제품에서 iOS Safari 사용자가 방에 들어가지 못하는 것은 감수할 수 없다. **배포 형상은 프론트 Vercel · 백엔드 EC2로 확정됐으므로(ADR-22) 토큰 방식이 확정이다.** 쿠키 세션은 검토 대상이 아니다.

같은 도메인 배치는 ADR-22가 버린 대안이 아니라 **검토 후 채택하지 않은 형상**이다 — 정적 자원 배포마다 소켓 서버를 재기동하게 되고 재기동이 곧 진행 중 방 소멸이기 때문이다([../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md) ADR-24). 만약 이 형상이 바뀌면 본 절과 핸드셰이크 규약뿐 아니라 CORS 설정과 wss 인증서 범위도 함께 바뀐다([../09_tech_stack/03_database_infra.md](../09_tech_stack/03_database_infra.md)).

## 버전 정책

| 축 | 정책 |
|----|------|
| REST 경로 | **버전 접두어를 두지 않는다** — /api/v1을 쓰지 않는다 |
| 소켓 프로토콜 | **protocolVersion 정수**를 conn:auth에 싣는다. 서버가 지원하지 않는 값이면 연결을 거부한다 |
| 게임 config·result JSON | db.md §13의 **schemaVersion 정수**를 그대로 노출한다. 필드 의미가 바뀌면 값을 올리고 기존 데이터를 덮어쓰지 않는다 |

**경로 버전을 두지 않는 이유**는 구·신 버전이 동시에 살아 있는 구간이 없기 때문이다. 클라이언트는 하나이고, 프론트와 백엔드는 같은 배포 단위로 나가며, 백엔드는 단일 인스턴스·워커 1개라 무중단 롤링 배포를 하지 않는다. 버전 접두어는 그 구간이 있을 때만 값을 한다.

**대신 소켓 프로토콜 버전이 필요하다.** 브라우저에 오래된 번들이 캐시된 채로 새 서버에 붙는 경우는 배포 형상과 무관하게 발생하며, 그때 이벤트 이름이나 페이로드가 조용히 어긋나면 게임 도중에 알 수 없는 오동작이 된다. 핸드셰이크에서 한 번 걸러 재입장을 안내하는 편이 낫다.

## 관련 문서

- REST 전수 → [02_rest.md](./02_rest.md)
- WebSocket 전수 정본 → [03_socket_events.md](./03_socket_events.md)
- 에러 매핑 → [04_error_mapping.md](./04_error_mapping.md)
- 에러 코드 채번 정본 → [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)
- ID 규약 정본 → [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)
- 트랜잭션·멱등 구현 → [../06_database/README.md](../06_database/README.md)
- 폴더 색인·고정 기준 → [README.md](./README.md)
