# 에러 코드 ↔ API 표면 매핑

> **대상**: 에러 코드 후보 41종과 REST 엔드포인트 9본 · WebSocket 이벤트 31종의 대응 — HTTP 상태 · 발생 지점 · 소켓 종료 코드 · 클라이언트 처리
> **작성일**: 2026-08-02
> **개정일**: 2026-08-02 — 하트비트가 WebSocket 제어 프레임으로 바뀌어 conn:pong 행을 걷어내고 WebSocket 이벤트 수를 33종 → 31종으로 정정한다
> **원천**: git 529e312(docs/api.md 「에러 코드 초안」 20건) · git ecceb11(docs/06_api/03_error_codes.md 23건) · docs_legacy/requirements.md US-104·US-602 · [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)(네임스페이스 규약)

**본 문서는 에러 코드를 채번하지 않는다.** 전수·유일 등재의 정본은 [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)이며, 여기서는 API 표면이 필요로 하는 코드를 **후보로 제안하고** 표면과의 대응만 기술한다. 사전이 다른 이름이나 다른 상태 코드로 확정하면 그쪽이 이기고 본 문서를 같은 변경 단위에서 갱신한다.

## 매핑 원칙

| 원칙 | 내용 |
|------|------|
| 단일 코드 집합 | REST와 WebSocket이 **같은 문자열**을 쓴다. 소켓 전용 코드를 만들지 않는다 |
| 분기 기준 | 화면 분기는 code로 한다. HTTP 상태는 거들 뿐이다 |
| 네임스페이스 | 발생 주체 기준 **5종** — room · member · game · vote · common. 게임별 전용 네임스페이스를 두지 않는다 |
| 소켓 상태 코드 | 소켓에는 HTTP 상태가 없으므로 아래 표의 상태는 **REST에서 쓰이는 값**이다. 소켓에서는 code만 쓴다 |
| 수신 범위 | 소켓 error는 **보낸 사람에게만** 간다. 브로드캐스트하지 않는다 |
| 정보 노출 | message에 내부 식별자·SQL·토큰을 싣지 않는다 |

## room — 방 (6종)

| 코드 후보 | HTTP | 발생 지점 | 클라이언트 처리 |
|-----------|:----:|-----------|----------------|
| room.not_found | 404 | GET /api/rooms/{code} · POST /members · conn:auth | 코드 입력란에 오류 표시 |
| room.already_playing | 409 | GET /api/rooms/{code} · POST /members · conn:auth | 차단 팝업 — 게임이 끝날 때까지 기다리라고 안내 |
| room.full | 409 | GET /api/rooms/{code} · POST /members | 코드 입력란에 정원 초과 표시 |
| room.expired | 410 | GET /api/rooms/{code} · POST /members · conn:auth | 표지 화면으로 이동 |
| room.host_left | 410 | 방장 이탈 확정 — room:closed의 reason과 짝 | 팝업 후 표지 화면으로 이동 |
| room.code_exhausted | 503 | POST /api/rooms | 방 만들기 화면에서 재시도 안내 |

**원천의 ROOM_EXPIRED와 HOST_LEFT는 REST 에러와 소켓 통지가 뒤섞여 있었다.** 방장 이탈은 요청에 대한 실패가 아니라 서버가 먼저 알리는 사건이므로 **room:closed의 reason이 정본**이고, room.host_left는 그 사유를 코드 문자열로 참조해야 하는 자리(로그·화면 문구 선택)에서만 쓴다.

## member — 참가자 (9종)

| 코드 후보 | HTTP | 발생 지점 | 클라이언트 처리 |
|-----------|:----:|-----------|----------------|
| member.not_found | 404 | member:kick · PATCH /members/me | 무시하고 명단을 서버 값으로 되돌린다 |
| member.not_host | 403 | 방장 전용 C→S 7종 | 토스트. 화면 가드가 뚫린 경우이므로 버튼 상태를 재계산한다 |
| member.nickname_invalid | 400 | PATCH /members/me | 닉네임 입력란에 오류 표시 |
| member.avatar_invalid | 400 | PATCH /members/me | 아바타 선택을 초기화한다 |
| member.avatar_taken | 409 | PATCH /members/me | 아바타 목록을 갱신하고 다시 고르게 한다 |
| member.bio_too_long | 400 | PATCH /members/me | 소개 입력란에 오류 표시 |
| member.already_active | 409 | PATCH /members/me | 대기방으로 넘긴다. 이미 확정된 상태다 |
| member.kicked | 403 | member:kick의 **대상자에게** | 팝업 후 표지 화면. 뒤이어 소켓이 4403으로 닫힌다 |
| member.self_kick | 400 | member:kick | 무시한다. 정상 화면에서는 발생하지 않는다 |

**member.nickname_duplicated를 두지 않는다.** 같은 방에 같은 닉네임이 있으면 서버가 접미 숫자를 붙여 확정하므로(US-104.2) 거부할 일이 없다. 원천 api.md의 NICKNAME_DUPLICATED 409는 이 규칙과 어긋나 폐기한다.

## game — 게임 (13종)

| 코드 후보 | HTTP | 발생 지점 | 클라이언트 처리 |
|-----------|:----:|-----------|----------------|
| game.not_found | 404 | GET /api/games/{gameId} | 개발 오류. 사용자에게 노출되지 않는다 |
| game.not_selected | 400 | game:config · game:start | 설정 패널을 비활성으로 되돌린다 |
| game.invalid_config | 400 | game:config · game:start | 설정 패널에 오류 표시 |
| game.not_enough_members | 400 | game:select · game:random · game:start | 상태 밴드에 최소 인원 안내 |
| game.not_all_ready | 400 | game:start | 상태 밴드에 준비 인원 안내 |
| game.round_not_found | 404 | game:action · game:decide · round:close | 무시한다. 이미 지난 라운드다 |
| game.round_already_ended | 409 | game:action | 입력 버튼을 잠그고 다음 이벤트를 기다린다 |
| game.stale_phase | 409 | game:action · game:decide | 무시한다. 이미 지난 단계다 |
| game.invalid_action | 400 | game:action 외 대부분의 C→S | 무시한다. 화면 상태와 서버 상태가 어긋난 경우다 |
| game.already_submitted | 409 | game:action(1회 제한 액션) | 제출 완료 표시로 되돌린다 |
| game.not_eligible | 403 | nunchi.up(안전 확정자) · 결선(후보 아님) | 입력 버튼을 잠근다 |
| game.elapsed_rejected | 409 | timer.stop | **판정은 서버 관측값으로 진행된다.** 알림만 띄우고 대기를 유지한다 |
| game.decision_not_required | 409 | game:decide | 무시한다 |

- **game.stale_phase는 원천에 없던 코드다.** 이전 단계·이전 결선 회차에 도착한 입력을 roundId만으로는 구분할 수 없어 phaseSeq 검증이 필요하고, 그 실패에 이름이 있어야 클라이언트가 "지난 판"과 "지난 단계"를 다르게 처리한다.
- **game.elapsed_rejected는 실패가 아니라 통지다.** 입력은 받아들여졌고 판정값의 출처만 바뀌었다. 클라이언트가 이 코드를 실패로 처리해 재입력을 유도하면 안 된다.
- **원천의 ELIMINATED를 game.not_eligible로 대체한다.** 눈치게임은 탈락 구조가 아니라 안전 확정 구조이므로(혼자 누른 사람이 빠진다) ELIMINATED라는 이름이 규칙을 반대로 전달한다.

## vote — 투표 (4종)

| 코드 후보 | HTTP | 발생 지점 | 클라이언트 처리 |
|-----------|:----:|-----------|----------------|
| vote.self_not_allowed | 400 | king.vote · snipe.vote | 해당 항목을 비활성으로 표시한다 |
| vote.target_not_found | 404 | king.vote · snipe.vote · game:decide | 후보 목록을 서버 값으로 되돌린다 |
| vote.limit_exceeded | 409 | king.vote · snipe.vote | 선택 가능 수를 안내한다 |
| vote.duplicate_target | 400 | king.vote · snipe.vote | 같은 대상에 몰아줄 수 없음을 안내한다 |

**vote.limit_exceeded를 game.already_submitted와 분리한다.** 표 수를 넘긴 것과 이미 제출한 것은 사용자가 해야 할 다음 동작이 다르다 — 앞은 선택을 줄이는 것이고 뒤는 기다리는 것이다. 원천은 둘 다 ALREADY_SUBMITTED로 묶어 화면이 안내를 고를 수 없었다.

## common — 공통 (9종)

| 코드 후보 | HTTP | 발생 지점 | 클라이언트 처리 |
|-----------|:----:|-----------|----------------|
| common.unauthenticated | 401 | Bearer가 필요한 REST 3본 | 표지 화면으로 이동 |
| common.session_expired | 401 | 전 표면 · conn:auth | 팝업 후 표지 화면. **재입장이 필요하다고 안내한다** |
| common.validation_failed | 400 | 전 표면 | 해당 입력란에 오류 표시 |
| common.idempotency_conflict | 409 | 멱등 키를 쓰는 REST 3본(POST /api/rooms · POST /members · PATCH /members/me) | 재시도하지 않는다. 개발 오류다 |
| common.payload_too_large | 413 | 전 표면 | 입력 길이를 줄이도록 안내 |
| common.rate_limited | 429 | GET /api/rooms/{code} | 잠시 뒤 재시도 안내 |
| common.protocol_unsupported | 400 | conn:auth | **강제 새로고침을 안내한다.** 오래된 번들이 붙은 경우다 |
| common.protocol_violation | 400 | 소켓 전 이벤트 | 재입장 안내. 정상 화면에서는 발생하지 않는다 |
| common.internal | 500 | 전 표면 | 일반 오류 안내 |

## REST 엔드포인트별 대응

| 엔드포인트 | 낼 수 있는 코드 |
|-----------|----------------|
| POST /api/rooms | common.validation_failed · common.idempotency_conflict · room.code_exhausted · common.internal |
| GET /api/rooms/{code} | room.not_found · room.already_playing · room.full · room.expired · common.rate_limited |
| POST /api/rooms/{code}/members | room.not_found · room.already_playing · room.full · room.expired · common.idempotency_conflict |
| GET /api/rooms/{code}/avatars | common.unauthenticated · common.session_expired · room.not_found |
| PATCH /api/rooms/{code}/members/me | member.nickname_invalid · member.avatar_invalid · member.avatar_taken · member.bio_too_long · member.already_active · member.not_found · common.unauthenticated · common.session_expired · common.idempotency_conflict |
| DELETE /api/rooms/{code}/members/me | common.unauthenticated · common.session_expired |
| GET /api/games | common.internal |
| GET /api/games/{gameId} | game.not_found |
| GET /health | 없다 — 공통 응답 객체를 쓰지 않는다 |

전 엔드포인트가 common.validation_failed · common.payload_too_large · common.internal을 낼 수 있으므로 위 표에서는 각 엔드포인트 고유의 코드만 적었다.

## WebSocket 이벤트별 대응

| C→S 이벤트 | 낼 수 있는 코드 |
|-----------|----------------|
| conn:auth | common.protocol_unsupported · common.session_expired · room.not_found · room.already_playing · room.expired |
| member:ready | game.invalid_action |
| member:kick | member.not_host · member.self_kick · member.not_found · game.invalid_action |
| chat:send | game.invalid_action · common.payload_too_large |
| chat:typing | 없다 |
| game:select | member.not_host · game.not_found · game.not_enough_members · game.invalid_action |
| game:config | member.not_host · game.not_selected · game.invalid_config · game.invalid_action |
| game:random | member.not_host · game.not_enough_members · game.invalid_action |
| game:start | member.not_host · game.not_selected · game.not_enough_members · game.not_all_ready · game.invalid_config · game.invalid_action |
| game:action | game.round_not_found · game.round_already_ended · game.stale_phase · game.invalid_action · game.already_submitted · game.not_eligible · game.elapsed_rejected · vote.* 4종 · common.validation_failed |
| game:decide | member.not_host · game.decision_not_required · game.round_not_found · game.stale_phase · game.invalid_action · vote.target_not_found |
| round:close | member.not_host · game.round_not_found · game.invalid_action |

인증 전에 도착한 모든 이벤트는 common.protocol_violation이다.

## 소켓 종료 코드와의 대응

**error 이벤트가 곧 연결 종료를 뜻하지는 않는다.** 대부분의 오류는 알린 뒤 연결을 유지한다. 아래 다섯만 error 직후 소켓이 닫힌다.

| 코드 후보 | 종료 코드 | 순서 |
|-----------|:--------:|------|
| common.protocol_unsupported | 4002 | error → close |
| common.protocol_violation | 4002 | error → close |
| common.session_expired(conn:auth) | 4401 | error → close |
| room.not_found · room.already_playing · room.expired(conn:auth) | 4401 | error → close |
| member.kicked | 4403 | error → close |

error 없이 닫히는 종료 코드도 있다 — 4408(인증 타임아웃) · 4409(토큰 중복 바인딩) · 4410(방 종료 · 직전에 room:closed가 나간다) · 4413(프레임 상한 초과).

**클라이언트는 어느 종료 코드에서도 자동 재연결을 시도하지 않는다.** 재접속 경로가 없으므로 재연결은 자리를 되찾지 못하고 4409만 반복시킨다.

## 원천 코드와의 대조

원천 두 본의 코드와 본 문서 후보의 대응이다. 이름 형식이 SCREAMING_SNAKE에서 {namespace}.{snake_case}로 바뀐 것은 [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)의 규약을 따른 것이다.

| 원천 코드 | 본 문서 후보 | 비고 |
|-----------|-------------|------|
| ROOM_NOT_FOUND · ROOM_ALREADY_PLAYING · ROOM_FULL · ROOM_EXPIRED | room.not_found · room.already_playing · room.full · room.expired | 이름만 변환 |
| ROOM_CODE_EXHAUSTED | room.code_exhausted | 이름만 변환 |
| HOST_LEFT · KICKED | room.host_left · member.kicked | 네임스페이스 재배치 |
| **NICKNAME_DUPLICATED** | — | **폐기.** 중복은 서버가 접미 채번으로 해소한다 |
| NICKNAME_INVALID · AVATAR_TAKEN | member.nickname_invalid · member.avatar_taken | 이름만 변환 |
| NOT_HOST · NOT_ENOUGH_MEMBERS · NOT_ALL_READY | member.not_host · game.not_enough_members · game.not_all_ready | 인원·준비는 게임 시작 조건이므로 game으로 옮긴다 |
| INVALID_CONFIG · INVALID_ACTION | game.invalid_config · game.invalid_action | 이름만 변환 |
| ROUND_NOT_FOUND · ROUND_ALREADY_ENDED | game.round_not_found · game.round_already_ended | 이름만 변환 |
| **ALREADY_SUBMITTED** | game.already_submitted · **vote.limit_exceeded** | **분리.** 재제출과 표 수 초과는 안내가 다르다 |
| SELF_VOTE_NOT_ALLOWED | vote.self_not_allowed | 이름만 변환 |
| **ELIMINATED** | **game.not_eligible** | **개명.** 눈치게임은 탈락 구조가 아니다 |
| SESSION_EXPIRED | common.session_expired | 이름만 변환 |
| GAME_NOT_FOUND | game.not_found | 이름만 변환 |

**신설 후보 19종** — member 5종(not_found · avatar_invalid · bio_too_long · already_active · self_kick) · game 4종(not_selected · stale_phase · elapsed_rejected · decision_not_required) · vote 2종(target_not_found · duplicate_target) · common 8종(unauthenticated · validation_failed · idempotency_conflict · payload_too_large · rate_limited · protocol_unsupported · protocol_violation · internal).

후보 41종의 구성은 room 6 · member 9 · game 13 · vote 4 · common 9이며, 그중 원천 계승 21종 · 분리 1종 · 신설 19종이다.

## 관련 문서

- **에러 코드 채번·전수 정본** → [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)
- 네임스페이스 규약 → [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)
- 공통 응답 객체 → [01_conventions.md](./01_conventions.md)
- REST 표면 → [02_rest.md](./02_rest.md)
- WebSocket 표면 · 종료 코드 → [03_socket_events.md](./03_socket_events.md)
- 오류 안내 화면 → [../08_screen/README.md](../08_screen/README.md)
- 폴더 색인·고정 기준 → [README.md](./README.md)
