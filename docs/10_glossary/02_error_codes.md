# 에러 코드

> **대상**: ModuPick의 REST·WebSocket 전 표면이 반환하는 도메인 에러 코드 전수 — 코드 · HTTP 상태 · 발생 조건 · 사용자 문안 · 발생 지점
> **작성일**: 2026-08-02
> **원천**: [../07_api/04_error_mapping.md](../07_api/04_error_mapping.md)(후보 41종) · [../07_api/02_rest.md](../07_api/02_rest.md)(REST 8본) · [../07_api/03_socket_events.md](../07_api/03_socket_events.md)(소켓 이벤트 31종·종료 코드) · [../07_api/01_conventions.md](../07_api/01_conventions.md)(공통 응답 객체·멱등) · [../02_features/07_common.md](../02_features/07_common.md)(공통·오류 도메인) · [../11_fairness/01_server_authority.md](../11_fairness/01_server_authority.md)(판정 의사코드) · [04_id_conventions.md](./04_id_conventions.md)(형식·네임스페이스 규약)

에러 코드의 **채번 정본**이다. 전수는 **42종 · 5네임스페이스**이며 새 코드는 여기서만 만든다. [../07_api/04_error_mapping.md](../07_api/04_error_mapping.md)는 API 표면이 필요로 하는 코드를 후보로 제안하고, 본 문서가 그 후보를 검토해 확정한다 — 두 문서가 어긋나면 **본 문서가 이긴다**. 각 도메인 문서는 자기가 쓰는 코드만 등재하며 채번하지 않는다.

## 채번 규약

| 규칙 | 내용 |
|------|------|
| 형식 | {namespace}.{snake_case} + HTTP 상태. 네임스페이스는 **소문자**이며 기능 접두사(대문자)와 표기가 다르다 |
| 네임스페이스 | **발생 주체 기준 5종** — room · member · game · vote · common. 게임별 전용 네임스페이스를 두지 않는다 |
| 단일 코드 집합 | REST와 WebSocket이 **같은 문자열**을 쓴다. 소켓 전용 코드를 만들지 않는다 |
| 분기 기준 | 화면 분기는 code로 한다. HTTP 상태는 거들 뿐이다 |
| 문안 동봉 | 서버가 공통 응답 객체의 message에 한국어 문안을 실어 보낸다. 프론트가 코드별 문구를 따로 관리하지 않는다 |
| 정보 노출 | message·data에 스택 트레이스·SQL 원문·컬럼명·토큰 값을 싣지 않는다 |
| 수신 범위 | 소켓 error는 **보낸 사람에게만** 간다. 브로드캐스트하지 않는다 |
| 문안 톤 | 원인을 사용자 탓으로 돌리지 않는다. 무엇이 일어났는지와 다음에 무엇을 하면 되는지만 적는다 |

**발화하지 않는 코드를 등재하지 않는다.** 코드가 계약에 오르면 구현자는 그 분기를 만들고 검수자는 그 경로를 재현하려 한다. 실제로 나갈 수 있는 표면이 없으면 등재하지 않고, 표면이 생기면 그때 넣는다.

## HTTP 상태 규약

| 상태 | 의미 |
|:----:|------|
| 400 | 입력 형식·범위 검증 실패 · 현재 상태에서 허용되지 않는 동작 |
| 401 | 미인증(토큰 부재) · 토큰 무효·만료 |
| 403 | 인증됐으나 권한·자격이 없음 |
| 404 | 대상 부재 |
| 409 | 상태 충돌 · 이미 처리됨 · 정원·상한 초과 |
| 410 | 대상이 사라짐(방 폐기·만료) |
| 413 | 본문·프레임 크기 상한 초과 |
| 429 | 호출 빈도 상한 초과 |
| 500 | 미분류 서버 오류 |
| 503 | 자원 고갈로 지금은 처리할 수 없음 |

- **401과 403의 구분**: 토큰이 없거나 무효면 401, 토큰은 유효한데 그 동작을 할 자격이 없으면 403이다.
- **404와 410의 구분**: 처음부터 없는 것은 404, 있었으나 사라진 것은 410이다. 없는 초대 코드는 room.not_found(404)이고 만료된 방은 room.expired(410)다.
- **409와 410의 구분**: 409는 지금은 안 되지만 대상이 살아 있고, 410은 대상 자체가 없다. 게임 진행 중인 방은 409, 폐기된 방은 410이다.
- **소켓에는 HTTP 상태가 없다.** 아래 표의 상태는 REST에서 쓰이는 값이며 소켓은 code만 쓴다. 같은 코드가 두 표면에서 다른 상태를 갖지 않는다.

## 네임스페이스 배정 규칙

| 네임스페이스 | 범위 | 개수 |
|-------------|------|:----:|
| room | 방의 존재·상태·정원·수명 | 6 |
| member | 참가자의 자격·프로필·권한 | 10 |
| game | 게임 선택·설정·라운드·단계·입력 자격 | 13 |
| vote | 표의 대상·수·중복 검증 | 4 |
| common | 인증·스키마 검증·프로토콜·전역 실패 | 9 |

- **게임별 전용 네임스페이스를 두지 않는다.** 게임 입력 오류는 game으로 채번하고 어느 게임에서 나는지는 코드가 아니라 발생 지점 열이 밝힌다. 게임이 늘어도 네임스페이스가 늘지 않는다.
- **인원·준비 조건은 member가 아니라 game이다.** 최소 인원 미달·준비 미완료는 참가자의 결함이 아니라 게임을 시작할 수 없는 상태이므로 발생 주체가 게임이다.
- **투표 검증만 vote로 분리한다.** 표의 대상·수·중복은 킹메이커와 익명 저격이 같은 규칙을 쓰고 사용자가 해야 할 다음 동작이 game과 다르다 — game은 대개 기다리는 것이고 vote는 선택을 고치는 것이다.

## room — 방 (6종)

| 코드 | HTTP | 발생 조건 | 사용자 문안 | 발생 지점 |
|------|:----:|-----------|------------|-----------|
| room.not_found | 404 | 없는 초대 코드 · 이미 삭제된 방 | 없는 방이에요 | GET /api/rooms/{code} · POST /api/rooms/{code}/members · GET /api/rooms/{code}/avatars · conn:auth |
| room.already_playing | 409 | 게임이 진행 중이라 새 입장을 받지 않는다 | 게임이 진행 중이에요. 끝나면 들어올 수 있어요 | GET /api/rooms/{code} · POST /api/rooms/{code}/members · conn:auth |
| room.full | 409 | 정원이 이미 찼다. 카운트는 PENDING + ACTIVE 합산이다 | 방이 가득 찼어요 | GET /api/rooms/{code} · POST /api/rooms/{code}/members |
| room.expired | 410 | 10분 무활동으로 만료된 방 | 오래 활동이 없어 방이 사라졌어요 | GET /api/rooms/{code} · POST /api/rooms/{code}/members · conn:auth |
| room.host_left | 410 | 방장 이탈이 확정되어 방이 폐기됐다 | 방장이 나가서 방이 사라졌어요 | room:closed(reason HOST_LEFT)와 짝을 이루는 코드 |
| room.code_exhausted | 503 | 초대 코드 재추첨을 제한 횟수까지 했는데도 활성 방과 충돌한다 | 지금은 방을 만들 수 없어요. 잠시 뒤 다시 시도해 주세요 | POST /api/rooms |

- **room.host_left는 요청 실패가 아니라 사건의 코드다.** 방장 이탈은 서버가 먼저 알리는 것이므로 정본은 room:closed의 reason이고, 이 코드는 그 사유를 문자열로 참조해야 하는 자리(화면 문구 선택·로그)에서 쓴다. 방 행이 이미 삭제된 뒤 도착한 REST 요청은 room.not_found다.
- **room.expired와 room.host_left를 하나로 묶지 않는다.** 둘 다 방이 사라진 것이지만 사용자가 이해해야 할 사실이 다르다 — 앞은 시간이 지나서이고 뒤는 사람이 나가서다.
- **방 폐기 상태를 값으로 저장하지 않는다.** 종료는 rooms 행 삭제이므로(정본 [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md)) 조회로 관측되는 것은 room.not_found뿐이고, 폐기 사유는 폐기 순간의 room:closed 통지에만 실린다.

## member — 참가자 (10종)

| 코드 | HTTP | 발생 조건 | 사용자 문안 | 발생 지점 |
|------|:----:|-----------|------------|-----------|
| member.not_found | 404 | 대상이 이 방의 ACTIVE 참가자가 아니다 | 찾을 수 없는 참가자예요 | member:kick · PATCH /api/rooms/{code}/members/me |
| member.not_host | 403 | 방장 전용 동작을 방장이 아닌 참가자가 보냈다 | 방장만 할 수 있어요 | 방장 전용 C→S 7종 — member:kick · game:select · game:config · game:random · game:start · game:decide · round:close |
| member.not_active | 403 | 프로필을 아직 확정하지 않은 PENDING 참가자가 대기방 이벤트를 보냈다 | 프로필을 먼저 정해 주세요 | member:ready · chat:send · chat:typing |
| member.nickname_invalid | 400 | 닉네임이 1~8자를 벗어나거나 공백만이다 | 닉네임은 1~8자로 적어 주세요 | PATCH /api/rooms/{code}/members/me |
| member.avatar_invalid | 400 | avatarId가 A01~A30 형식이 아니다 | 고를 수 없는 아바타예요 | PATCH /api/rooms/{code}/members/me |
| member.avatar_taken | 409 | 동시 선택 경합에서 다른 참가자가 먼저 확정했다 | 방금 다른 분이 고른 아바타예요. 다른 걸 골라 주세요 | PATCH /api/rooms/{code}/members/me |
| member.bio_too_long | 400 | 소개 태그가 24자를 넘는다 | 소개는 24자까지 적을 수 있어요 | PATCH /api/rooms/{code}/members/me |
| member.already_active | 409 | 이미 ACTIVE인 참가자가 다른 멱등 키로 프로필 확정을 다시 시도했다 | 이미 입장했어요 | PATCH /api/rooms/{code}/members/me |
| member.kicked | 403 | 방장이 이 참가자를 내보냈다 | 방장이 내보냈어요 | member:kick의 **대상자에게만**. 직후 소켓이 4403으로 닫힌다 |
| member.self_kick | 400 | 방장이 자기 자신을 내보내려 했다 | 자기 자신은 내보낼 수 없어요 | member:kick |

- **member.nickname_duplicated를 두지 않는다.** 같은 방에 같은 닉네임이 있으면 서버가 접미 숫자를 붙여 확정하므로(지호 → 지호2) 거부할 일이 없다. 클라이언트는 요청에 실은 값이 아니라 **응답의 nickname**을 화면에 쓴다.
- **member.not_active를 game.invalid_action에서 분리한다.** 가입 직후의 참가자는 PENDING 상태로 소켓이 붙어 있으므로([../07_api/02_rest.md](../07_api/02_rest.md)의 3번 엔드포인트) 프로필 확정 전에 대기방 이벤트를 보낼 수 있다. game.invalid_action은 "무시하라"는 뜻이지만 이 경우 사용자가 할 일이 분명히 있다 — 프로필을 확정하면 된다.
- **member.kicked는 대상자 한 명에게만 간다.** 나머지에게는 member:left(reason KICK)가 브로드캐스트되며 에러가 아니다.
- **member.avatar_taken은 화면 가드가 뚫린 결함이 아니다.** 아바타 30종에 정원 10명이라 고갈되지 않으며, 이 코드는 같은 아바타를 동시에 확정한 경합에서 늦은 쪽에만 발생한다.

## game — 게임 (13종)

| 코드 | HTTP | 발생 조건 | 사용자 문안 | 발생 지점 |
|------|:----:|-----------|------------|-----------|
| game.not_found | 404 | gameId가 6종 밖이다 | 찾을 수 없는 게임이에요 | GET /api/games/{gameId} · game:select |
| game.not_selected | 400 | 게임이 선택되지 않은 상태에서 설정·시작을 시도했다 | 게임을 먼저 골라 주세요 | game:config · game:start |
| game.invalid_config | 400 | 설정값이 configSchema의 타입·범위를 벗어난다 | 설정값을 다시 확인해 주세요 | game:config · game:start |
| game.not_enough_members | 400 | ACTIVE 인원이 그 게임의 최소 인원에 못 미친다. 랜덤 뽑기는 후보가 하나도 없을 때다 | 사람이 더 모여야 시작할 수 있어요 | game:select · game:random · game:start |
| game.not_all_ready | 400 | 방장을 제외한 참여자 중 준비하지 않은 사람이 있다 | 아직 준비하지 않은 분이 있어요 | game:start |
| game.round_not_found | 404 | 입력이 실은 roundId가 현재 라운드와 다르다 | 지난 판이라 반영되지 않았어요 | game:action · game:decide · round:close |
| game.round_already_ended | 409 | 라운드가 이미 종료된 뒤 입력이 도착했다 | 이미 끝난 판이에요 | game:action |
| game.stale_phase | 409 | 입력이 실은 phaseSeq가 서버의 현재 값과 다르다. 이전 단계·이전 결선 회차의 입력이다 | 이미 지난 단계의 입력이에요 | game:action · game:decide |
| game.invalid_action | 400 | 현재 방 상태·게임·단계에서 정의되지 않은 동작이다 | 지금은 할 수 없는 동작이에요 | 대부분의 C→S — member:ready · member:kick · chat:send · game:select · game:config · game:random · game:start · game:action · game:decide · round:close |
| game.already_submitted | 409 | 1회 제한 액션을 다른 requestId로 다시 보냈다 | 이미 제출했어요 | game:action |
| game.not_eligible | 403 | 그 단계의 입력 자격이 없다 — 안전 확정한 참가자의 추가 입력 · 결선 후보가 아닌 참가자의 재투표 | 이번 단계에서는 입력하지 않아도 돼요 | game:action(nunchi.up · 결선의 king.vote · snipe.vote · timer.start · timer.stop) |
| game.elapsed_rejected | 409 | 클라이언트가 보고한 경과 시간이 서버 관측값과 허용 오차를 벗어났다 | 기록이 서버 측정값으로 반영됐어요 | game:action(timer.stop) |
| game.decision_not_required | 409 | 교착 결정을 요구하지 않은 시점에 방장이 결정을 보냈다 | 지금은 고를 차례가 아니에요 | game:decide |

- **game.round_not_found와 game.round_already_ended와 game.stale_phase는 셋 다 다르다.** 앞은 라운드가 바뀐 것, 가운데는 같은 라운드가 끝난 것, 뒤는 라운드는 같은데 단계·결선 회차가 지난 것이다. roundId만으로는 1차 결선과 2차 결선의 입력을 가를 수 없어 phaseSeq 검증이 따로 필요하고, 그 실패에 이름이 있어야 클라이언트가 "지난 판"과 "지난 단계"를 다르게 처리한다.
- **game.elapsed_rejected는 실패가 아니라 통지다.** 입력은 받아들여졌고 판정값의 출처만 서버 관측값으로 바뀐다([../11_fairness/01_server_authority.md](../11_fairness/01_server_authority.md)). 클라이언트가 이 코드를 실패로 처리해 재입력을 유도하면 안 되며, 결과의 source 필드가 어느 값으로 판정했는지 남긴다.
- **game.eliminated를 쓰지 않는다.** 눈치게임은 혼자 누른 사람이 **안전 확정**하고 겹친 사람이 **잔류**하는 구조라 그 이름이 규칙을 정반대로 전달한다. 자격 없음은 game.not_eligible 하나로 통일하고, [01_domain_terms.md](./01_domain_terms.md)가 금지한 '탈락'을 코드 이름에도 쓰지 않는다.
- **game.invalid_action은 채팅·준비 토글에도 쓴다.** 발생 주체가 참가자가 아니라 그 동작을 막고 있는 방·라운드 상태이기 때문이다. 게임 진행 중의 chat:send·member:kick이 이 코드로 거절된다.
- **버려지는 입력에는 코드를 내지 않는다.** 게임 규칙이 "버린다"로 규정한 입력(방장이 아닌 사람의 룰렛 PICK · 라운드 마감 후 도착한 눈치 UP)은 상태를 바꾸지 않고 에러도 올리지 않는다([../05_game_rules/01_common.md](../05_game_rules/01_common.md)의 멱등 규칙).

## vote — 투표 (4종)

| 코드 | HTTP | 발생 조건 | 사용자 문안 | 발생 지점 |
|------|:----:|-----------|------------|-----------|
| vote.self_not_allowed | 400 | 자기 자신 또는 자기가 낸 안건을 골랐다 | 자기 자신은 고를 수 없어요 | game:action(king.vote · snipe.vote) |
| vote.target_not_found | 404 | 고른 대상이 현재 후보 집합에 없다 | 고를 수 없는 대상이에요 | game:action(king.vote · snipe.vote) · game:decide(targetId) |
| vote.limit_exceeded | 409 | 고른 수가 그 회차의 실효 투표 수 상한을 넘는다 | 고를 수 있는 수를 넘었어요 | game:action(king.vote · snipe.vote) |
| vote.duplicate_target | 400 | 한 요청 안에서 같은 대상을 두 번 이상 골랐다 | 같은 대상은 한 번만 고를 수 있어요 | game:action(king.vote · snipe.vote) |

- **vote.limit_exceeded를 game.already_submitted와 분리한다.** 표 수를 넘긴 것과 이미 제출한 것은 사용자가 해야 할 다음 동작이 다르다 — 앞은 선택을 줄이는 것이고 뒤는 기다리는 것이다.
- **투표는 배열로 한 번에 받고 하나라도 어기면 요청 전체를 거절한다.** 부분 반영을 두지 않으므로 거절된 요청은 미투표 상태로 되돌아가고 남은 시간 안에 다시 보낼 수 있다.
- **결선에서는 상한이 1로 고정된다.** 본선의 1인 투표 수 설정과 무관하며, 이 규칙을 어긴 요청도 vote.limit_exceeded다.

## common — 공통 (9종)

| 코드 | HTTP | 발생 조건 | 사용자 문안 | 발생 지점 |
|------|:----:|-----------|------------|-----------|
| common.unauthenticated | 401 | Authorization 헤더가 없거나 형식이 틀렸다 | 다시 입장해 주세요 | Bearer가 필요한 REST 3본 — GET /api/rooms/{code}/avatars · PATCH /api/rooms/{code}/members/me · DELETE /api/rooms/{code}/members/me |
| common.session_expired | 401 | memberToken이 무효하거나 방이 사라져 토큰이 만료됐다 | 연결이 만료됐어요. 다시 입장해 주세요 | 전 REST 표면 · conn:auth |
| common.validation_failed | 400 | 요청 본문·페이로드가 스키마·길이 규약을 벗어난다 | 입력값을 다시 확인해 주세요 | 전 REST 표면 · game:action |
| common.idempotency_conflict | 409 | 같은 멱등 키로 다른 본문이 도착했다 | 요청을 처리하지 못했어요. 다시 시도해 주세요 | 멱등 키를 쓰는 REST 3본 — POST /api/rooms · POST /api/rooms/{code}/members · PATCH /api/rooms/{code}/members/me |
| common.payload_too_large | 413 | 요청 본문·소켓 프레임이 64KB를 넘는다 | 내용이 너무 길어요 | 전 REST 표면 · chat:send. 소켓은 종료 코드 4413으로 닫힌다 |
| common.rate_limited | 429 | IP 단위 호출 빈도 상한을 넘었다 | 요청이 잦아요. 잠시 뒤 다시 시도해 주세요 | GET /api/rooms/{code} |
| common.protocol_unsupported | 400 | conn:auth의 protocolVersion을 서버가 지원하지 않는다 | 화면을 새로고침해 주세요 | conn:auth. 직후 소켓이 4002로 닫힌다 |
| common.protocol_violation | 400 | 인증 전에 도착한 이벤트 · 규약 밖 프레임 | 연결에 문제가 생겼어요. 다시 입장해 주세요 | 소켓 전 이벤트. 직후 소켓이 4002로 닫힌다 |
| common.internal | 500 | 위 어디에도 해당하지 않는 서버 오류 | 잠시 문제가 생겼어요. 다시 시도해 주세요 | 전 표면 |

- **common.internal_error를 쓰지 않는다.** 네임스페이스가 이미 오류임을 말하므로 접미 error가 중복이다. 표기는 common.internal 하나로 통일한다.
- **common.protocol_unsupported의 문안이 재입장이 아니라 새로고침인 이유**는 오래된 번들이 캐시된 경우이기 때문이다. 다시 입장해도 같은 번들이면 같은 실패가 반복된다.
- **common.rate_limited는 GET /api/rooms/{code}에만 건다.** 초대 코드가 숫자 6자리라 이 표면만 무차별 대입으로 방 존재 여부를 캐낼 수 있다. 다른 표면에 상한을 걸면 정상 사용자의 연타가 먼저 걸린다.
- **common.internal의 문안을 상황별로 나누지 않는다.** 원인을 모르는 실패이므로 여러 문구를 두면 서버가 알지 못하는 것을 아는 척하게 된다.

## 네임스페이스별 개수와 총수

| 네임스페이스 | 코드 수 | 구성 |
|-------------|:-------:|------|
| room | **6** | not_found · already_playing · full · expired · host_left · code_exhausted |
| member | **10** | not_found · not_host · not_active · nickname_invalid · avatar_invalid · avatar_taken · bio_too_long · already_active · kicked · self_kick |
| game | **13** | not_found · not_selected · invalid_config · not_enough_members · not_all_ready · round_not_found · round_already_ended · stale_phase · invalid_action · already_submitted · not_eligible · elapsed_rejected · decision_not_required |
| vote | **4** | self_not_allowed · target_not_found · limit_exceeded · duplicate_target |
| common | **9** | unauthenticated · session_expired · validation_failed · idempotency_conflict · payload_too_large · rate_limited · protocol_unsupported · protocol_violation · internal |
| **합계** | **42** | |

검산: 6 + 10 + 13 + 4 + 9 = **42**.

HTTP 상태별 분포 — 400 **14종** · 401 **2종** · 403 **4종** · 404 **5종** · 409 **11종** · 410 **2종** · 413 **1종** · 429 **1종** · 500 **1종** · 503 **1종**.
검산: 14 + 2 + 4 + 5 + 11 + 2 + 1 + 1 + 1 + 1 = **42**.

## 07_api 후보와의 대조

[../07_api/04_error_mapping.md](../07_api/04_error_mapping.md)가 제안한 후보 **41종**을 검토해 **42종**으로 확정했다. 확정 내역은 다음과 같다.

| 판정 | 종수 | 항목 |
|------|:----:|------|
| 후보 그대로 확정 | 41 | room 6 · member 9 · game 13 · vote 4 · common 9 전부 |
| **신설** | **1** | **member.not_active(403)** — PENDING 참가자의 대기방 이벤트 |
| 폐기 | 0 | — |
| **합계** | **42** | 41 + 1 |

**member.not_active를 신설한 근거**는 후보 41종에 이 상태의 이름이 없기 때문이다. 가입(POST /api/rooms/{code}/members) 응답 직후 클라이언트는 프로필 화면에 머문 채 소켓을 연다. 그 구간의 참가자는 PENDING이며 명단에 노출되지 않는데도 소켓이 살아 있어 member:ready·chat:send를 보낼 수 있다. 후보 매핑은 이 경우를 game.invalid_action(무시한다)으로 흡수하지만, 사용자가 해야 할 일이 분명한 상황을 "무시"로 처리하면 화면이 아무 안내도 하지 못한다.

## 타 문서와 어긋난 항목

본 문서가 정본이므로 아래 항목은 해당 문서를 고친다. 코드 이름·상태가 다른 것이지 규칙이 다른 것이 아니다.

| 문서 | 현재 표기 | 확정 표기 | 사유 |
|------|-----------|-----------|------|
| [../02_features/07_common.md](../02_features/07_common.md) | common.internal_error(500) | **common.internal** | 네임스페이스가 오류를 뜻하므로 접미 error가 중복이다 |
| [../02_features/01_room_join.md](../02_features/01_room_join.md) | member.nickname_duplicated(409) | **폐기** | 중복 닉네임은 서버가 접미 채번으로 해소하므로 거부 경로가 없다 |
| [../08_screen/03_entry.md](../08_screen/03_entry.md) | member.nickname_duplicated(409) | **폐기** | 위와 같다 |
| [../02_features/04_play_common.md](../02_features/04_play_common.md) | game.eliminated(403) | **game.not_eligible** | 눈치게임은 안전 확정·잔류 구조이며 '탈락'은 금지어다 |
| [../02_features/05_games.md](../02_features/05_games.md) | game.eliminated(403) | **game.not_eligible** | 위와 같다 |
| [../02_features/08_permission_matrix.md](../02_features/08_permission_matrix.md) | game.eliminated | **game.not_eligible** | 위와 같다 |
| [../11_fairness/03_anti_cheat.md](../11_fairness/03_anti_cheat.md) | game.eliminated | **game.not_eligible** | 위와 같다 |

**game.eliminated는 이름만의 문제가 아니다.** 그 이름을 읽은 구현자는 눈치게임을 "겹친 사람이 탈락하는 게임"으로 만들고, 그러면 일부러 겹치는 담합이 이득이 되어 게임이 성립하지 않는다. 프로토타입이 실제로 그렇게 구현되어 있다.

## 소켓 종료 코드와의 관계

**error 이벤트가 곧 연결 종료를 뜻하지 않는다.** 대부분의 오류는 알린 뒤 연결을 유지한다. 아래 다섯만 error 직후 소켓이 닫힌다.

| 코드 | 종료 코드 | 순서 |
|------|:--------:|------|
| common.protocol_unsupported | 4002 | error → close |
| common.protocol_violation | 4002 | error → close |
| common.session_expired(conn:auth) | 4401 | error → close |
| room.not_found · room.already_playing · room.expired(conn:auth) | 4401 | error → close |
| member.kicked | 4403 | error → close |

- error 없이 닫히는 종료 코드가 넷 있다 — 4408(인증 타임아웃) · 4409(토큰 중복 바인딩) · 4410(방 종료 · 직전에 room:closed가 나간다) · 4413(프레임 상한 초과). **이 넷에는 대응 에러 코드를 두지 않는다.** 클라이언트가 받을 error 프레임이 없으므로 코드를 만들어도 발화하지 않는다.
- 종료 코드 전수와 유예 규정의 정본은 [../07_api/03_socket_events.md](../07_api/03_socket_events.md)다.
- **어느 종료 코드에서도 클라이언트가 자동 재연결을 시도하지 않는다.** 재접속 경로가 없어 재연결은 자리를 되찾지 못하고 4409만 반복시킨다.

## 코드를 내지 않는 자리

에러가 아닌 것을 에러로 만들지 않는다. 아래는 실패처럼 보이지만 코드를 내지 않는 경로다.

| 상황 | 처리 | 근거 |
|------|------|------|
| 같은 requestId의 재전송 | 최초 처리 결과를 그대로 재현한다 | 재전송과 두 번째 시도는 다르다([../07_api/01_conventions.md](../07_api/01_conventions.md)) |
| 같은 멱등 키·같은 본문의 재요청 | 최초 결과를 재현한다 | 위와 같다 |
| 이미 나간 참가자의 DELETE 재요청 | 204로 성공 처리한다 | 자연 멱등이다 |
| 빈 문자열·공백만인 채팅 | 조용히 무시한다 | 화면에 띄울 실패가 아니다 |
| 규칙이 "버린다"로 규정한 게임 입력 | 상태를 바꾸지 않고 응답하지 않는다 | 게임별 (상태 × 이벤트) 표가 정본이다 |
| 닉네임 중복 | 서버가 접미 숫자를 붙여 확정한다 | 거부 경로를 두지 않는다 |
| 아바타 미선택 | 서버가 남은 것 중 하나를 배정한다 | 선택이 필수가 아니다 |
| UNIQUE 충돌로 걸린 멱등 요청 | 기존 행을 조회해 같은 성공 응답을 돌려준다 | DB 충돌이 곧 사용자 오류가 아니다([../06_database/06_transactions_concurrency.md](../06_database/06_transactions_concurrency.md)) |

## 관련 문서

- [04_id_conventions.md](./04_id_conventions.md) — 에러 코드 형식·네임스페이스 규약
- [03_enums_state_machines.md](./03_enums_state_machines.md) — 상태 위반이 일어나는 enum과 상태 머신
- [01_domain_terms.md](./01_domain_terms.md) — 안전 확정·잔류·기권·미입력 정의
- [../07_api/04_error_mapping.md](../07_api/04_error_mapping.md) — 코드 ↔ API 표면 매핑(본 문서의 미러)
- [../07_api/01_conventions.md](../07_api/01_conventions.md) — 공통 응답 객체·멱등 키
- [../02_features/07_common.md](../02_features/07_common.md) — 공통·오류 도메인 기능
- [../08_screen/README.md](../08_screen/README.md) — 오류 안내 화면
- [README.md](./README.md) — 폴더 색인
