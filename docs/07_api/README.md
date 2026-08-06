# 07_api — API 표면

> **대상**: ModuPick 프론트엔드와 백엔드가 주고받는 전 통신 표면 — REST 엔드포인트 8본(+ 운영 1본) · WebSocket 이벤트 31종(C→S 12 · S→C 19)의 경로·페이로드·권한·에러
> **작성일**: 2026-08-02
> **개정일**: 2026-08-02 — 하트비트를 WebSocket 제어 프레임 ping으로 정정하고 conn:ping·conn:pong 2종을 폐기한다([../04_architecture/02_realtime_websocket.md](../04_architecture/02_realtime_websocket.md)에 정합). C→S 13→12 · S→C 20→19 · 합 33→31
> **원천**: git 529e312(docs/api.md 584줄 · docs/db.md §10~18) · git ecceb11(docs/06_api/00~03 4문서) · docs_legacy/requirements.md(§3 게임 공통 기준 · §4 사용자 스토리 · §5 비기능 · §6 확정 결정) · frontend/src/lib/types.ts · frontend/src/lib/store.ts · backend/app/main.py · [../README.md](../README.md)(고정 기준·전역 불변식)

ModuPick의 통신 표면은 **둘**이다. 대기방에 들어가기 전의 요청은 REST이고, 대기방에 들어간 뒤의 모든 통신은 WebSocket이다. 경계는 **소켓이 존재하는가**가 아니라 **그 요청이 방 상태를 실시간으로 공유해야 하는가**다. 방을 만들고 코드를 검증하고 프로필을 확정하는 동안에는 공유할 방 상태가 아직 없거나 본인만의 것이고, 대기방에 들어선 순간부터는 모든 변화가 전원에게 같은 순간에 도달해야 한다.

본 폴더는 **프론트엔드와 백엔드의 유일한 계약**이다. 여기서 확정한 이벤트명·필드명·타입·권한·에러는 그대로 구현되며, 구현이 이 문서와 어긋나면 구현을 고친다. 다만 **에러 코드의 채번은 하지 않는다** — 후보를 제안할 뿐이고 전수 정본은 [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)다. 기능 ID·요구사항 ID·화면 코드도 채번하지 않는다.

## 표면 요약

| 표면 | 규모 | 정본 문서 | 상태 |
|------|:----:|-----------|:----:|
| REST — 제품 | **8본** | [02_rest.md](./02_rest.md) | ⬜ |
| REST — 운영 | **1본** — GET /health | [02_rest.md](./02_rest.md) | ✅ |
| WebSocket — C→S | **12종** | [03_socket_events.md](./03_socket_events.md) | ⬜ |
| WebSocket — S→C | **19종** | [03_socket_events.md](./03_socket_events.md) | ⬜ |
| game:action type | **8종** | [03_socket_events.md](./03_socket_events.md) | ⬜ |
| 에러 코드 후보 | **41종** | [04_error_mapping.md](./04_error_mapping.md) · 채번 정본은 10_glossary | ⬜ |

구현 상태는 backend/ 실제 코드 기준이다. backend/app/main.py에는 GET /health와 소켓 배선 확인용 WS /ws/echo만 있고 제품 표면은 미착수다.

## 통신 경계

| 구분 | 통신 | 근거 |
|------|------|------|
| 방 생성 · 코드 검증 · 가입 | REST | 소켓 연결 이전 단계다. 공유할 방 상태가 아직 없다 |
| 아바타 목록 조회 | REST | 카탈로그 조회다. 선점 현황의 실시간 갱신만 소켓(member:joined)이 담당한다 |
| 프로필 확정 | REST | 이 호출의 성공이 소켓 연결(방장) 또는 명단 노출(참여자)의 트리거다 |
| 게임 메타 · 가이드 | REST | 방·소켓 상태와 무관한 정적 데이터다 |
| 대기방 · 게임 진행 · 결과 | **WebSocket** | 전원이 같은 결과를 같은 순간에 보는 것이 본질이다 |

**퇴장 경로는 둘로 나뉜다.** 소켓 연결 이전(프로필 입력 중 뒤로가기)은 DELETE /api/rooms/{code}/members/me이고, 대기방·게임 중의 나가기 버튼은 **소켓 종료 코드 1000**이다. 소켓이 곧 닫히는 요청의 결과를 소켓으로 받을 수 없기 때문이며, 이 구분은 이탈 유예 판정([03_socket_events.md](./03_socket_events.md))의 입력이 된다. **1000은 나가기 버튼에서만 쓴다** — 앱 전환에서도 발화하는 페이지 숨김·beforeunload로 보내면 백그라운드 전환이 곧 퇴장이 된다.

## WebSocket 이벤트 전수 (요약)

전수 정본과 페이로드는 [03_socket_events.md](./03_socket_events.md)다. 아래는 이름만 싣는 색인이며 개수가 어긋나면 정본이 우선한다.

**C→S 12종** — conn:auth · member:ready · member:kick · chat:send · chat:typing · game:select · game:config · game:random · game:start · game:action · game:decide · round:close

**S→C 19종** — room:snapshot · room:closed · member:joined · member:left · member:ready_changed · member:connection · chat:message · chat:typing · game:selected · game:config_changed · game:started · game:phase · game:tick · game:progress · game:tie · game:decision_required · game:result · round:closed · error

이벤트명은 콜론 표기(대상:동작)만 쓴다. 게임별로 이벤트를 나누지 않고 game:action 하나에 type 8종을 분기시킨다 — 게임이 늘어도 소켓 표면이 늘지 않게 하기 위해서다.

## 인증 방식

로그인·회원가입이 없으므로 **참가자 식별은 방 가입 시 서버가 발급하는 토큰 하나**로 끝난다.

| 항목 | 규정 |
|------|------|
| 토큰 | **memberToken** — 서버가 발급하는 불투명 문자열(128비트 이상 난수의 base64url). JWT를 쓰지 않는다 |
| 발급 | POST /api/rooms(방장) · POST /api/rooms/{code}/members(참여자). 방마다·참가자마다 1개 |
| 수명 | 방 수명과 같다. 방이 사라지면 즉시 무효다. 별도 갱신 경로를 두지 않는다 |
| REST 전달 | Authorization: Bearer {memberToken} 헤더 |
| 소켓 전달 | 연결 직후 **첫 프레임 conn:auth**에 실어 보낸다. 쿼리 문자열에 담지 않는다 — 프록시·접근 로그에 토큰이 남기 때문이다 |
| 방장 판정 | 토큰 안의 역할이 아니라 **방 상태의 hostMemberId**와 소켓에 바인딩된 memberId를 대조한다 |
| 사칭 차단 | **C→S 이벤트 페이로드에 발신자 memberId를 싣지 않는다.** 발신자는 언제나 소켓 바인딩값이다. memberId를 받는 자리는 member:kick의 대상 지정 하나뿐이다 |
| 중복 바인딩 | 한 토큰에 소켓 1개만 붙는다. 이미 붙어 있는 토큰의 두 번째 핸드셰이크는 **거부**하고 기존 소켓을 유지한다 — 재접속 불가 원칙의 소켓 층 구현이다 |

**원천의 hostToken · guestToken 2필드는 폐기한다.** 두 값은 형식도 검증 경로도 같은데 이름만 달라, 클라이언트가 필드 이름으로 자기 권한을 아는 척하게 만들고 서버 판정과 어긋날 여지를 남긴다. 권한의 정본은 서버가 가진 방 상태다.

## 파일 목차

| 파일 | 내용 |
|------|------|
| [01_conventions.md](./01_conventions.md) | 공통 응답 객체 · ID 직렬화(10진 문자열) · 시각·단위 · 멱등 키 · 길이·크기 상한 · 페이지네이션 부재 사유 · 버전 정책 |
| [02_rest.md](./02_rest.md) | REST 엔드포인트 전수 8본 + 운영 1본 — 경로·메서드·요청·응답·권한·에러 |
| [03_socket_events.md](./03_socket_events.md) | **WebSocket 이벤트 전수 정본** — 연결 수명주기 · 하트비트·이탈 판정 · 순서 보장 · 타이머 동기화 · 멱등 · C→S 12종 · S→C 19종 · game:action type 8종 · configSchema |
| [04_error_mapping.md](./04_error_mapping.md) | 에러 코드 후보 ↔ HTTP 상태 ↔ 발생 지점 ↔ 소켓 종료 코드 매핑. 전수 정본은 10_glossary |

문서의 H2 순서는 **공통 규칙 → 표면 목록 → 상세 → 에러 → 관련 문서**로 고정한다.

## 고정 기준

수치의 정본은 [../README.md](../README.md)다. 아래는 본 폴더가 확정하거나 인용하는 값이며, 본 폴더가 정본인 항목은 그렇게 표기한다.

| 항목 | 기준 |
|------|------|
| REST 엔드포인트 | **제품 8본 · 운영 1본** — 본 폴더가 정본 |
| WebSocket 이벤트 | **C→S 12종 · S→C 19종 · 합 31종** — 본 폴더가 정본 |
| game:action type | **8종** — 본 폴더가 정본 |
| 게임 | **6종** · gameId는 roulette · ladder · kingmaker · timer · snipe · nunchi |
| 방장 설정 항목 | **15개** — 룰렛 1 · 사다리 2 · 킹메이커 3 · 시간초 3 · 저격 3 · 눈치 3. 규칙 정본은 [../05_game_rules](../05_game_rules/README.md) |
| 방 정원 | **2~10명** · 초대 코드는 숫자 6자리(표시할 때만 MODU- 접두) |
| 아바타 | **30종** — A01~A30. 근거는 frontend/src/lib/data.ts의 AVATAR_DEFS 30건 |
| 반복 상한 | 동점 결선·재대결 **최대 3회**. 초과 시 방장이 game:decide로 고른다 |
| 판정 기준 | 서버 도착 시각. **유일한 예외는 시간초 잡기의 경과 시간**이며 클라이언트 단조 시계 측정값을 서버가 대조 검증한다 |
| 재접속 | **불가**. 소켓이 끊기면 새 참가자로만 들어올 수 있고, 진행 중인 방에는 그마저 막힌다 |
| 에러 코드 | 후보 **41종** 제안. 채번·전수 정본은 [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md) |
| 인스턴스 | 백엔드 **단일 인스턴스·워커 1개**. 진행 중 상태는 프로세스 메모리, 확정 결과는 MySQL |

## 관련 문서

- 공통 규약 → [01_conventions.md](./01_conventions.md)
- REST 전수 → [02_rest.md](./02_rest.md)
- WebSocket 전수 정본 → [03_socket_events.md](./03_socket_events.md)
- 에러 매핑 → [04_error_mapping.md](./04_error_mapping.md)
- 에러 코드 채번 정본 → [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)
- ID 규약 → [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)
- 게임 규칙·판정 정본 → [../05_game_rules/README.md](../05_game_rules/README.md)
- 스키마·트랜잭션 정본 → [../06_database/README.md](../06_database/README.md)
- 서버 판정 권위·익명성 → [../11_fairness/README.md](../11_fairness/README.md)
- 고정 기준·전역 불변식 → [../README.md](../README.md)
