# WebSocket 이벤트

> **대상**: 대기방 진입 이후의 전 실시간 통신 정본 — 연결 수명주기 · 인증·권한 · 하트비트와 이탈 판정 · 순서 보장 · 타이머 동기화 · 멱등 · C→S 12종 · S→C 19종 · game:action type 8종 · configSchema
> **작성일**: 2026-08-02
> **개정일**: 2026-08-02 — 하트비트를 애플리케이션 이벤트에서 **WebSocket 제어 프레임 ping**으로 바꾸고 이탈 유예를 참가자 30초·방장 60초로 정정한다([../04_architecture/02_realtime_websocket.md](../04_architecture/02_realtime_websocket.md)에 정합). conn:ping·conn:pong 2종을 폐기해 C→S 13→12 · S→C 20→19가 된다
> **원천**: git ecceb11(docs/06_api/02_socket.md 376줄) · git 529e312(docs/api.md 「실시간 소켓 이벤트 명세」 · docs/db.md §10·§16) · docs_legacy/requirements.md §3(공통 기준·게임별 규칙) · §4.4 US-401~403 · §5 NFR-01~05 · [../04_architecture/02_realtime_websocket.md](../04_architecture/02_realtime_websocket.md)(하트비트·유예 정본) · frontend/src/lib/types.ts · frontend/src/games/Nunchi.tsx · backend/app/main.py

본 문서가 **WebSocket 이벤트의 전수 정본**이다. 이벤트 이름·페이로드 필드·발신자·수신 범위·트리거·순서 보장이 여기서 확정되고, 다른 문서는 이 값을 인용한다. 공통 응답 객체·식별자 직렬화·멱등 키·길이 상한은 [01_conventions.md](./01_conventions.md)를 따른다.

방 진입 전의 통신은 [02_rest.md](./02_rest.md)에 있다. 여기서 다루는 것은 소켓이 열린 뒤의 전부다 — 대기방·게임 선택·게임 진행·결과·방 종료.

## 전송과 룸

| 항목 | 규정 |
|------|------|
| 전송 | **Native WebSocket**이다. Socket.IO를 쓰지 않으므로 룸 관리·브로드캐스트·하트비트를 직접 구현한다 |
| 경로 | /ws/rooms/{code} — code는 접두어 없는 숫자 6자리다 |
| 룸 키 | room:{code} — 같은 룸의 소켓끼리만 브로드캐스트가 오간다 |
| 프레임 | JSON 텍스트 프레임 1건에 이벤트 1건. 하나의 프레임에 여러 이벤트를 묶지 않는다 |
| 인스턴스 | 단일 인스턴스·워커 1개다. 룸 상태가 프로세스 메모리에 있으므로 **인스턴스 간 브로드캐스트 중계 계층을 두지 않는다** |
| 프레임 상한 | 64KB. 초과하면 종료 코드 4413으로 닫는다 |

**프레임 봉투는 이벤트명과 데이터로만 이루어진다.**

```json
// C→S
{ "event": "game:action", "data": { } }
```

```json
// S→C — data 바깥은 공통 응답 객체다
{
  "event": "game:phase",
  "success": true,
  "code": "ok",
  "message": null,
  "data": { "roomVersion": 41 },
  "timestamp": "2026-08-02T06:04:05.123Z"
}
```

## 연결 수명주기

REST와 맞물려 있으므로 순서대로 정리한다.

| # | 시점 | 동작 |
|:-:|------|------|
| 1 | 참여자 연결 | POST /api/rooms/{code}/members 응답의 memberToken을 받는 **즉시** 핸드셰이크한다. 아직 프로필이 없는 PENDING 상태다 |
| 2 | 방장 연결 | PATCH /api/rooms/{code}/members/me로 프로필을 확정한 **직후** 핸드셰이크한다 |
| 3 | 인증 | 연결 직후 클라이언트가 **첫 프레임으로 conn:auth**를 보낸다. **3초** 안에 오지 않으면 서버가 종료 코드 4408로 닫는다 |
| 4 | 스냅샷 | 인증에 성공하면 서버가 **최초 1회 room:snapshot**을 보낸다. 이 하나로 대기방 화면을 통째로 그릴 수 있어야 하고 이후는 개별 이벤트로 부분 갱신만 한다 |
| 5 | 노출 | 프로필 확정으로 ACTIVE가 되는 순간 member:joined가 브로드캐스트된다. **PENDING 참가자는 소켓은 붙어 있지만 다른 사람 화면에는 아직 안 보인다** |
| 6 | 종료 | 나가기 버튼이 닫는 **종료 코드 1000**만 즉시 확정이다. 그 밖의 모든 종료와 하트비트 무응답은 **이탈 유예**를 거친다 |

**room:snapshot에 진행 중인 라운드가 실리는 경우는 없다.** 게임이 시작되면 새 입장이 막히고(room.already_playing) 재접속 경로가 없으므로, 소켓이 새로 붙는 시점의 방은 언제나 WAITING이다. 그래서 스냅샷에 round 필드를 두지 않는다 — 두면 채워질 일 없는 분기를 클라이언트가 구현하게 된다.

**재접속 경로를 두지 않는다.** 소켓이 끊긴 사람은 같은 자리로 돌아올 수 없다. 다시 들어오면 새 참가자이고, 진행 중인 방에는 그마저 막힌다. 끊긴 사람은 명단에 후보로 남아 미입력 처리된다.

## 인증과 권한

### conn:auth 핸드셰이크

토큰을 쿼리 문자열이 아니라 **첫 프레임**으로 받는다. Native WebSocket은 브라우저에서 요청 헤더를 지정할 수 없고, 쿼리 문자열에 담으면 프록시·접근 로그에 토큰이 그대로 남기 때문이다.

```json
{ "event": "conn:auth", "data": { "protocolVersion": 1, "roomCode": "427132", "memberToken": "k3Zp8w5nD2rQ..." } }
```

| 검증 | 실패 시 |
|------|---------|
| 3초 안에 도착했는가 | 종료 코드 4408 |
| protocolVersion을 서버가 지원하는가 | error common.protocol_unsupported → 종료 코드 4002 |
| 토큰이 유효하고 roomCode의 방에 속하는가 | error common.session_expired → 종료 코드 4401 |
| 그 토큰에 이미 다른 소켓이 붙어 있지 않은가 | **새 소켓을 거부**하고 종료 코드 4409. 기존 소켓은 유지한다 |
| 방이 아직 살아 있고 WAITING인가 | error room.already_playing 또는 room.not_found → 종료 코드 4401 |

- 인증 전에는 conn:auth 외의 어떤 이벤트도 처리하지 않는다. 다른 이벤트가 먼저 오면 error common.protocol_violation 후 종료 코드 4002로 닫는다.
- **중복 바인딩 거부가 재접속 불가의 소켓 층 구현이다.** 같은 토큰으로 두 번째 창을 열어 자리를 빼앗거나 두 화면에서 동시에 입력하는 경로가 여기서 닫힌다.

### 권한 판정

| 항목 | 규정 |
|------|------|
| 발신자 | 소켓에 바인딩된 memberId다. **C→S 페이로드에 발신자 memberId를 싣지 않는다** |
| 대상 지정 | memberId를 받는 유일한 자리는 member:kick의 대상이다. 그 값은 대상이지 발신자가 아니다 |
| 방장 판정 | 방 상태의 hostMemberId와 소켓 바인딩 memberId를 대조한다. **토큰 안의 역할을 믿지 않는다** |
| 방장 전용 | member:kick · game:select · game:config · game:random · game:start · game:decide · round:close **7종**. 참여자가 보내면 error member.not_host를 **보낸 사람에게만** 돌려준다 |
| 참여자 전용 | member:ready 1종. 방장은 준비 상태를 갖지 않으므로 보내면 game.invalid_action |
| 대상 소속 | member:kick의 대상과 게임 입력의 대상 식별자는 **같은 방·같은 라운드 소속인지** 서버가 재확인한다. ID는 권한 증명이 아니다 |

**남의 memberId를 사칭한 입력이 구조적으로 불가능한 이유가 이것이다.** 클라이언트가 자기 정체를 주장할 자리가 페이로드에 없다. 사칭하려면 남의 memberToken이 필요하고, 그 토큰은 발급 시 1회 전달된 뒤 어디에도 다시 노출되지 않으며 이미 다른 소켓에 바인딩되어 있어 두 번째 연결이 거부된다.

## 하트비트와 이탈 판정

**설계의 정본은 [../04_architecture/02_realtime_websocket.md](../04_architecture/02_realtime_websocket.md)이며 본 절은 그 값을 API 표면의 관점에서 싣는다.** 두 문서가 어긋나면 아키텍처가 우선한다.

원천 어디에도 판정 기준이 없었다. db.md §10은 "연결 종료 시 퇴장 처리"라고만 했고, 그 문장을 그대로 구현하면 **모바일에서 탭을 백그라운드로 보낸 사람이 즉시 퇴장 처리된다.** 방장이 초대 링크를 공유하려 다른 앱으로 전환하는 것은 이 서비스의 핵심 사용 흐름이고, 그때 방이 폭파되면 제품이 성립하지 않는다.

### 두 개의 시계

| 시계 | 값 | 하는 일 |
|------|:--:|---------|
| **하트비트** | **WebSocket 제어 프레임 ping** · 주기 **20초** · pong 대기 **3주기(60초)**. 무응답이면 서버가 소켓을 닫는다 | close 프레임이 오지 않는 죽은 연결(모바일 셀 전환·터널·엘리베이터)을 잡는다 |
| **이탈 유예** | **참가자 30초 · 방장 60초** | 이탈의 부작용(방 삭제·명단 변경·슬롯 해제)을 확정하기 전에 두는 창이다 |

최대 판정 시간은 **참가자 90초 · 방장 120초**다. 소켓 종료가 즉시 관측되면 유예만큼(30초·60초)이다.

### 왜 애플리케이션 이벤트가 아니라 제어 프레임인가

**제어 프레임의 pong은 브라우저가 JavaScript 실행 없이 돌려준다.** 애플리케이션 레벨의 ping·pong 이벤트를 쓰면 클라이언트 코드가 응답해야 하는데, 백그라운드 탭은 타이머가 스로틀링되고 페이지가 정지되므로 pong이 늦거나 아예 멈춘다. 즉 **이 기능이 존재하는 바로 그 시나리오에서 오작동한다** — 앱을 전환했을 뿐인 정상 사용자가 매번 연결 끊김으로 표시된다.

제어 프레임을 쓰면 그 오탐이 생기지 않고, uvicorn이 ws-ping-interval·ws-ping-timeout으로 프로토콜 레벨에서 처리하므로 애플리케이션 코드도 줄어든다. **그래서 conn:ping·conn:pong 이벤트를 두지 않는다.** 이벤트 목록에 하트비트가 없는 이유가 이것이다.

### 연결 상태 3단계

**소켓이 끊겼다는 사실과 사람이 방을 떠났다는 사실은 다르다.** 둘을 같은 것으로 다루면 백그라운드 전환이 곧 퇴장이 된다. 그래서 상태를 셋으로 나눈다.

| 상태 | 진입 | 벗어나는 길 | 와이어 표현 |
|------|------|------------|------------|
| **연결** | 핸드셰이크 수락 | — | member:connection의 state ONLINE |
| **의심** | 소켓 종료 관측 · pong 3주기 미수신 · 전송 실패 | 같은 소켓에서 프레임이 도착하면 연결로 복귀 · 유예 만료 시 이탈 확정 | member:connection의 state **UNSTABLE** + graceEndsAt |
| **이탈 확정** | 명시적 나가기 · 강퇴 · 유예 만료 | — | member:left 또는 room:closed |

**유예는 회복을 기다리는 창이 아니라 이탈 확정의 부작용을 늦추는 창이다.** 의심에서 연결로 돌아오는 유일한 경로는 같은 소켓에서 프레임이 오는 것인데, 제어 프레임 하트비트에서는 pong 미수신을 uvicorn이 소켓 종료로 처리하므로 실제로는 소켓이 이미 닫혀 있고 그 경로가 열리지 않는다. **새 소켓으로 돌아오는 경로는 두지 않는다** — 그것이 재접속이며 설계에 없다.

그렇다면 늦춰서 무엇을 얻는가. 방장의 경우 남은 사람들이 "방이 갑자기 사라졌다"가 아니라 "방장 연결이 끊겨 곧 방이 닫힌다"를 60초 동안 보게 되고, 그 예고가 있고 없고는 같은 결과를 전혀 다른 경험으로 만든다. 참가자의 경우 순간적인 네트워크 단절로 카드가 즉시 사라졌다 하는 깜빡임을 없앤다.

### 즉시 확정되는 경우와 그렇지 않은 경우

| 사건 | 처리 |
|------|------|
| 사용자가 **나가기 버튼**을 눌러 소켓을 **종료 코드 1000**으로 닫음 | 유예 없이 **즉시 확정** |
| DELETE /api/rooms/{code}/members/me | 유예 없이 즉시 확정(소켓 연결 이전 경로) |
| 방장이 강퇴 | 즉시 확정 |
| 소켓 종료 관측 — 브라우저 종료 · 탭 닫기 · 새로고침 · 네트워크 단절 | **의심 → 유예 만료 시 확정** |
| pong 3주기 미수신 | 서버가 소켓을 닫고 의심으로 보낸다 → 유예 만료 시 확정 |
| 전송 실패 | 그 소켓을 닫고 의심으로 보낸다 |

**클라이언트는 페이지 숨김·가시성 변경·beforeunload로 종료 코드 1000을 보내지 않는다.** 모바일에서는 앱 전환만으로도 이 사건이 발화하기 때문이다. 1000은 사용자가 나가기 버튼을 눌렀을 때만 쓴다. 창을 닫으려 할 때 이탈 경고를 띄우는 것은 권장하되 **그 경고가 1000을 대신 보내서는 안 된다.**

새로고침도 이 규칙을 따른다 — 코드 1000 없이 소켓이 닫히므로 의심을 거쳐 유예 만료로 확정된다. **새로고침하면 방에서 빠진다**는 원칙은 그대로이고, 빠지는 시점이 즉시가 아니라 유예 뒤일 뿐이다.

### 유예 중의 취급

| 축 | 대기 상태의 방 | 진행·결과 상태의 방 |
|----|---------------|--------------------|
| 명단 | 목록에 남고 member:connection의 UNSTABLE로 **연결 끊김** 표시가 붙는다 | 명단 스냅샷에 그대로 남는다 |
| **준비 상태** | **해제한다.** readyCount에서 빠지되 activeCount 모수에는 남으므로 **전원 준비 조건이 성립하지 않아 게임 시작이 막힌다** | 해당 없음 |
| 정원 | 슬롯을 계속 차지한다. 30초·60초 동안 새 사람이 그 자리에 들어오지 못한다 | 해당 없음 |
| 게임 입력 | 해당 없음 | 입력이 오지 않으므로 게임별 기본값으로 자동 처리한다 |
| 방장 | 방을 삭제하지 않고 대기한다. 방장 전용 이벤트는 보낼 소켓이 없어 자연히 잠긴다 | 판을 멈추지 않는다. 서버 타이머는 계속 흘러 phase 마감이 예정대로 일어난다 |
| 만료 타이머 | 갱신하지 않는다. 유예는 사용자 행동이 아니다 | 진행 중에는 원래 멈춰 있다 |
| **해소 수단** | 방장이 **강퇴**로 즉시 정리할 수 있다 | 없다. 명단 스냅샷이 고정돼 있다 |

**준비 상태를 해제하는 것이 시작을 막는 쪽으로 작동한다.** 연결이 끊긴 사람을 준비 완료로 세어 게임을 시작하면 그 사람은 처음부터 미입력자로 판에 들어간다. 대기방에서는 기다리거나 내보내는 편이 낫고, 그래서 방장의 강퇴가 해소 수단으로 남아 있다.

**유예 중에는 아직 이탈이 아니다.** 그래서 "방장 이탈 즉시 방 삭제"라는 전역 불변식과 충돌하지 않는다 — 삭제는 이탈이 **확정된** 순간에 즉시 일어난다.

**유예를 두어도 재접속은 여전히 불가하다.** 유예 안에 나갔던 사람이 링크를 다시 열면 그는 새 참가자이며, 정원에 자리가 있어야 들어오고 진행 중인 판에는 들어오지 못한다. 유예 창 안에서도 **같은 토큰의 새 핸드셰이크는 거부한다.**

### 확정 시 동작

| 대상 | 확정 동작 |
|------|-----------|
| 참가자 | member:left(reason DISCONNECT) 브로드캐스트 · left_at 갱신 · 슬롯 해제. **게임 중이면 명단 스냅샷에 후보로 남고 미입력 처리된다** |
| 방장 | room:closed(reason HOST_LEFT) 브로드캐스트 → 전원 소켓을 종료 코드 4410으로 닫고 방을 삭제한다. 진행 중이던 판은 결과 없이 끝난다 |
| 마지막 참가자 | 방을 삭제한다. 받을 사람이 없으므로 브로드캐스트하지 않는다 |

### 남는 위험과 값의 한계

- **OS가 브라우저 프로세스를 정지시켜 연결이 실제로 끊기면 유예 만료와 함께 방장의 방은 삭제된다.** 제어 프레임 하트비트가 백그라운드 전환의 대부분을 흡수하지만 전부는 아니다. 재접속을 두지 않고 방장 권한을 이양하지 않기로 한 이상 방장 없는 방은 진행할 수 없으므로 이 동작이 맞다고 판단한다.
- **30초·60초는 실측으로 검증한 값이 아니다.** 설계 근거로 정한 값이며, 통합 배포 후 하트비트 타임아웃 발생 수와 이탈 확정 사유 분포를 지표로 남겨 조정 근거를 만든다.
- 하트비트 주기·대기·유예 값은 **서버 설정으로 뺀다.** 코드에 상수로 박으면 계측 결과를 반영할 때 배포가 필요하다.

## 순서 보장 — roomVersion

### 무엇을 막는 장치인가

**단일 WebSocket 연결은 TCP 위에서 순서와 무손실을 보장한다.** 그러므로 같은 연결 안에서 브로드캐스트가 뒤집히거나 유실될 수 없고, 서버는 단일 인스턴스라 중계 계층의 재정렬도 없다. roomVersion이 필요한 이유는 다른 데 있다.

| 막는 것 | 설명 |
|---------|------|
| **채널 교차 경합** | PATCH /members/me의 REST 응답과 member:joined 브로드캐스트는 서로 다른 채널로 도착한다. 두 채널 사이에는 순서 보장이 없다 |
| **낙관적 갱신 충돌** | 클라이언트가 미리 그린 상태와 서버 이벤트 중 어느 쪽이 최신인지 판정한다 |
| **중복 전송 방어** | 서버 결함으로 같은 이벤트가 두 번 나가도 화면이 두 번 바뀌지 않는다 |

### 규칙

- **roomVersion은 방 상태가 바뀔 때마다 1씩 증가하는 정수**다. 방 생성 시 1에서 시작한다.
- 모든 S→C 이벤트의 data에 현재 roomVersion이 실린다.
- **상태 이벤트만 버전 게이트를 적용한다.** 클라이언트는 마지막으로 반영한 번호보다 **작거나 같은 상태 이벤트를 무시한다.**

| 구분 | 이벤트 | 게이트 |
|------|--------|:------:|
| 상태 이벤트 | room:snapshot · room:closed · member:joined · member:left · member:ready_changed · member:connection · game:selected · game:config_changed · game:started · game:phase · game:progress · game:tie · game:decision_required · game:result · round:closed | 적용 |
| 통지 이벤트 | chat:message · chat:typing · game:tick · error | **미적용** |

**통지 이벤트를 게이트에서 빼는 것이 원천에 없던 정정이다.** 원천은 "모든 S→C 이벤트에 roomVersion이 포함되고 작거나 같으면 무시한다"고만 적었는데, 그 규칙을 그대로 구현하면 방 상태를 바꾸지 않는 game:tick이 직전 상태 이벤트와 같은 번호를 달고 나가 **전부 버려진다.** 타이머가 영원히 갱신되지 않는다.

### 갭을 관측하면

받은 상태 이벤트의 roomVersion이 마지막 반영값 + 1이 아니면 유실이다. **정상 동작에서는 발생하지 않는다** — 위에서 본 대로 유실 경로가 없기 때문이다. 그러므로 갭은 서버 결함의 신호다.

- 클라이언트는 **반영을 멈추고** 오류 화면으로 이동해 재입장을 안내한다. 어긋난 상태로 게임을 계속하는 것이 판정 신뢰를 더 크게 깬다.
- **스냅샷 재요청 경로를 두지 않는다.** 복구 경로를 만들면 그것이 사실상의 재접속이 되고, 재접속 불가 원칙 위에 세운 판정·명단·익명성 설계 전체가 흔들린다.

## 타이머 동기화

**서버가 제한 시간의 주체다.** 클라이언트는 남은 시간을 그릴 뿐 마감을 판정하지 않는다.

### 마감을 트리거하는 것

| 항목 | 규정 |
|------|------|
| 트리거 | **서버 타이머 콜백**이다. 서버가 deadlineAt에 깨어나 마감을 처리하고 다음 단계를 브로드캐스트한다 |
| 클라이언트 | 마감을 알리는 C→S 이벤트가 **없다.** 클라이언트가 "시간 다 됐다"고 서버에 말하는 경로를 두지 않는다 |
| 조기 마감 | 전원이 입력을 마치면 시간이 남아도 서버가 타이머를 취소하고 즉시 다음 단계로 넘어간다 |
| 마감 직전 입력 | **서버 도착 시각**으로 판정한다. deadlineAt을 넘겨 도착하면 phaseSeq가 맞더라도 game.round_already_ended로 버린다 |

### game:tick

| 항목 | 규정 |
|------|------|
| 주기 | **1초** |
| 범위 | 제한 시간이 있는 단계에서만 흐른다. deadlineAt이 null인 단계에서는 보내지 않는다 |
| 수신 | 룸 전원 |
| 페이로드 | roundId · phaseSeq · remainMs · serverTime · roomVersion |
| 성격 | **표시 전용이다.** 판정 근거가 아니다 |

### 클라이언트의 보정 방법

1. **game:phase 또는 첫 game:tick을 받은 순간** 자기 단조 시계(performance.now)를 읽어 오프셋을 잰다 — 서버 기준 남은 시간과 자기 시계의 대응점을 잡는다.
2. 그 뒤로는 **자체 타이머로 매 프레임 그린다.** tick을 받을 때마다 숫자를 새로 그리지 않는다 — 네트워크가 튀면 카운트가 끊겨 보인다.
3. tick이 올 때마다 오프셋만 다시 재고, 차이가 크면 한 번에 점프시키지 않고 **몇 프레임에 걸쳐 수렴시킨다.**
4. 자체 계산이 0에 닿아도 **화면만 0으로 멈추고 상태를 바꾸지 않는다.** 다음 단계로의 전환은 언제나 game:phase 수신이 트리거다.
5. 벽시계(Date.now)를 쓰지 않는다. 사용자가 기기 시계를 바꾸거나 OS가 시각을 동기화하면 튄다.

## 멱등과 라운드 경계

규칙의 정본은 [01_conventions.md](./01_conventions.md)이며 소켓에서의 적용만 여기 적는다.

| 값 | 위치 | 판정 |
|-----|------|------|
| **requestId** | game:action · game:decide의 페이로드. 클라이언트가 UUIDv4로 생성 | (roundId, memberId, requestId)가 같으면 **재전송**이므로 최초 처리 결과를 그대로 재현한다 |
| **roundId** | 같은 두 이벤트 | 현재 라운드와 다르면 game.round_not_found · 이미 끝났으면 game.round_already_ended |
| **phaseSeq** | 같은 두 이벤트. game:phase가 발급 | 서버의 현재 값과 다르면 **game.stale_phase**로 버린다 |

- **다른 requestId로 온 같은 종류의 두 번째 입력**은 재전송이 아니라 두 번째 시도이므로 1회 제한 액션에서는 game.already_submitted로 거부한다.
- **이전 라운드에 도착한 입력**은 roundId 불일치로 버린다. **이전 단계·이전 결선 회차의 입력**은 phaseSeq 불일치로 버린다. 결선은 새 라운드가 아니라 같은 roundId 안의 단계이므로 roundId만으로는 1차 결선과 2차 결선의 입력을 구분할 수 없다.
- 버려진 입력에 대해서도 error를 **보낸 사람에게만** 돌려준다. 조용히 삼키면 클라이언트가 입력이 반영된 줄 알고 기다린다.

## C→S 이벤트 12종

| # | 이벤트 | 페이로드 | 보낼 수 있는 사람 | 서버 응답 |
|:-:|--------|----------|------------------|-----------|
| 1 | **conn:auth** | protocolVersion · roomCode · memberToken | 전원 · 연결 후 첫 프레임 1회 | room:snapshot(본인) |
| 2 | **member:ready** | ready | **참여자** | member:ready_changed(전원) |
| 3 | **member:kick** | memberId | **방장** | member:left(나머지) · error member.kicked(대상) |
| 4 | **chat:send** | text | 전원 | chat:message(전원 · 본인 포함) |
| 5 | **chat:typing** | typing | 전원 | chat:typing(본인 제외) |
| 6 | **game:select** | gameId | **방장** | game:selected(전원) |
| 7 | **game:config** | gameId · config | **방장** | game:config_changed(전원) |
| 8 | **game:random** | 없음 | **방장** | game:selected(전원) |
| 9 | **game:start** | 없음 | **방장** | game:started → game:phase(전원) |
| 10 | **game:action** | roundId · phaseSeq · requestId · type · payload | type마다 다르다 | game:progress 또는 다음 단계(전원) |
| 11 | **game:decide** | roundId · phaseSeq · requestId · choice · targetId | **방장** | game:phase 또는 game:result 또는 round:closed(전원) |
| 12 | **round:close** | roundId | **방장** | round:closed(전원) |

**하트비트 이벤트가 목록에 없다.** WebSocket 제어 프레임 ping을 쓰므로 클라이언트가 응답할 애플리케이션 이벤트가 필요하지 않다. 근거는 위 「하트비트와 이탈 판정」 절에 있다.

### 1. conn:auth — 핸드셰이크 인증

위 「인증과 권한」 절에 규정이 있다. 인증이 끝나기 전에는 어떤 이벤트도 처리하지 않는다.

### 2. member:ready — 준비 완료 토글

```json
{ "ready": true }
```

- **방장은 준비 상태를 갖지 않는다.** 방장이 보내면 game.invalid_action.
- 마지막 값이 이기는 상태 갱신이라 멱등 키가 없다.
- 게임이 끝나 대기방으로 돌아오면 참여자 전원의 준비가 해제된다. 서버가 round:closed와 함께 ready를 false로 초기화하고 member:ready_changed를 보낸다.

### 3. member:kick — 참가자 강퇴

```json
{ "memberId": "mbr_w3X4y5Z6a7B8c9D0e1F2g3" }
```

- 자기 자신을 보내면 member.self_kick.
- 대상이 이 방의 ACTIVE 참가자가 아니면 member.not_found.
- **대상**에게 error member.kicked를 보낸 뒤 종료 코드 4403으로 닫고, **나머지**에게 member:left(reason KICK)를 브로드캐스트한다.
- 게임 진행 중에는 받지 않는다(game.invalid_action). 명단 스냅샷이 고정된 뒤에 후보를 빼면 진행 중인 판정이 어긋난다.

### 4. chat:send — 채팅 전송

```json
{ "text": "다 모였으면 시작해요" }
```

- text는 1~200자다. 빈 문자열이거나 공백만이면 서버가 조용히 무시한다.
- 서버가 messageId와 sentAt을 붙여 chat:message로 **전원(보낸 본인 포함)** 에게 되돌린다. 본인 메시지도 서버를 한 번 다녀오므로 클라이언트가 미리 그리지 않고 기다렸다 그리면 전원의 순서가 같아진다.
- **서버는 채팅을 저장하지 않는다.** 브로드캐스트하고 버린다. 화면 복원은 클라이언트 로컬 저장이며, 나중에 들어온 사람은 이전 대화를 볼 수 없다.
- **방 전 구간에서 받는다** — 대기방·게임 진행 중·결과 화면 어디서 보내도 중계한다(D-45). 게임 종류나 단계에 따라 막지 않으며 킹메이커 제출·투표와 익명 저격 투표 중에도 열려 있다. 방이 폐기된 뒤에 도착한 것만 버린다.

### 5. chat:typing — 입력 중 표시

```json
{ "typing": true }
```

- 상태만 전달하며 저장하지 않는다. 만료 타이머도 갱신하지 않는다.
- 클라이언트는 3초간 갱신이 없으면 스스로 false로 되돌린다.

### 6. game:select — 게임 선택

```json
{ "gameId": "ladder" }
```

- 현재 인원이 그 게임의 최소 인원에 못 미치면 game.not_enough_members.
- 서버가 기본 설정값을 채워 game:selected로 전원에게 알린다. **게임을 바꾸면 설정이 기본값으로 초기화된다.**
- 게임 진행 중에는 받지 않는다.

### 7. game:config — 게임 옵션 변경

```json
{ "gameId": "ladder", "config": { "resultItems": ["팀장", "자료 조사", "PPT 제작"], "speed": "NORMAL" } }
```

- gameId가 서버가 가진 현재 선택과 다르면 game.invalid_action. 게임이 선택되지 않았으면 game.not_selected.
- config는 아래 configSchema를 따른다. 위반하면 game.invalid_config.
- **부분 갱신이다.** 보낸 필드만 덮어쓰고 나머지는 유지한다. 전체 교체로 하면 두 필드를 연달아 조작할 때 앞의 값이 되돌아간다.
- 조작할 때마다 보내면 트래픽이 과하므로 클라이언트가 **200~300ms 디바운스** 후 보낸다.
- **참여자 화면은 읽기 전용이지만 실시간으로 같이 바뀐다.**

### 8. game:random — 랜덤 게임 뽑기

- 페이로드가 없다. **서버가** 6종 중에서 고른다. 클라이언트가 뽑으면 방장 화면과 참여자 화면의 결과가 엇갈릴 수 있다.
- **현재 인원으로 시작할 수 없는 게임은 후보에서 뺀다.** 후보가 하나도 없으면 game.not_enough_members.
- 결과는 game:selected로 전원에게 동일하게 내려간다.

### 9. game:start — 게임 시작

페이로드가 없다. 현재 선택된 게임과 설정으로 라운드를 만든다.

| 검증 | 실패 시 |
|------|---------|
| 게임이 선택되어 있는가 | game.not_selected |
| ACTIVE 인원이 그 게임의 최소 인원 이상인가 | game.not_enough_members |
| **방장을 제외한 참여자 전원이 준비 완료인가** | game.not_all_ready |
| 설정값이 configSchema에 맞는가 | game.invalid_config |
| 방이 WAITING인가 | game.invalid_action |

- **유예 중(UNSTABLE)인 참여자는 준비가 해제되므로 시작을 막는다.** readyCount에서만 빠지고 activeCount 모수에는 남아 전원 준비 조건이 성립하지 않는다. 방장은 강퇴로 정리하거나 유예 만료를 기다린다.
- 성공하면 새 roundId를 발급하고 **명단 스냅샷을 고정**한 뒤 game:started를 브로드캐스트한다. 방 상태가 PLAYING이 되어 새 입장이 막힌다.
- **결과 화면의 다시 하기도 같은 이벤트를 재사용한다.** 같은 게임·같은 설정으로 새 roundId가 발급되고 가이드는 띄우지 않는다.

### 10. game:action — 플레이어 입력

게임 중 플레이어가 버튼을 누르는 모든 행위가 이 이벤트 하나로 들어온다. type 8종의 전수는 아래 「game:action type 8종」에 있다.

```json
{
  "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6",
  "phaseSeq": 2,
  "requestId": "8b1f0c4a-2d6e-4a19-9c33-51e0f2a7b8d4",
  "type": "king.vote",
  "payload": { "candidateIds": ["opt_O7p8Q9r0S1t2U3v4W5x6Y7", "opt_Z8a9B0c1D2e3F4g5H6i7J8"] }
}
```

### 11. game:decide — 방장 결정

game:decision_required가 나간 뒤에만 받는다.

```json
{ "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6", "phaseSeq": 7, "requestId": "…", "choice": "PICK", "targetId": "mbr_w3X4y5Z6a7B8c9D0e1F2g3" }
```

| choice | 뜻 | targetId |
|--------|-----|:--------:|
| **PICK** | 방장이 후보 중 하나를 지목해 확정한다 | 필수 |
| **RANDOM** | 서버가 후보 중에서 난수로 확정한다 | 없음 |
| **RETRY** | 같은 설정으로 그 단계를 다시 진행한다 | 없음 |
| **ABORT** | 결과 없이 라운드를 끝내고 대기방으로 돌아간다 | 없음 |

- **서버가 game:decision_required로 내려준 options 안의 값만** 받는다. 밖의 값이면 game.invalid_action.
- targetId는 그 요구에 실린 candidateIds 안에 있어야 한다. 아니면 vote.target_not_found.
- 요구되지 않은 시점에 오면 game.decision_not_required.
- 방장이 마감까지 응답하지 않으면 서버가 **ABORT로 처리한다.** 판이 무한정 열려 있지 않게 한다.

### 12. round:close — 대기방 복귀

```json
{ "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6" }
```

- 결과 화면에서 방장이 대기방으로를 누를 때 보낸다. game:action에 흡수하지 않는다.
- 서버가 round:closed를 전원에게 브로드캐스트하고 방 상태를 WAITING으로 되돌린다. 참여자 준비 상태를 전부 해제한다.
- **그 판의 결과는 다시 열어볼 수 없다.** 서버에는 방 수명 동안 남지만 조회 표면을 열지 않는다.

## S→C 이벤트 19종

| # | 이벤트 | 페이로드 | 받는 사람 | 트리거 |
|:-:|--------|----------|-----------|--------|
| 1 | **room:snapshot** | room · me · members · game | 본인만 | 인증 성공 직후 1회 |
| 2 | **room:closed** | reason | 전원 | 방장 이탈 확정 · 마지막 참가자 이탈 · 만료 |
| 3 | **member:joined** | member | 전원 | 프로필 확정(ACTIVE 전이) |
| 4 | **member:left** | memberId · reason · activeCount | 전원 | 이탈 확정 · 강퇴 |
| 5 | **member:ready_changed** | memberId · ready · readyCount · activeCount | 전원 | member:ready · 대기방 복귀 시 초기화 |
| 6 | **member:connection** | memberId · state · graceEndsAt | 전원 | 유예 진입·취소 |
| 7 | **chat:message** | messageId · memberId · text · sentAt | 전원 | chat:send |
| 8 | **chat:typing** | memberId · typing | **본인 제외** | chat:typing |
| 9 | **game:selected** | gameId · config · configSchemaVersion | 전원 | game:select · game:random |
| 10 | **game:config_changed** | gameId · config | 전원 | game:config |
| 11 | **game:started** | roundId · gameId · config · roster | 전원 | game:start |
| 12 | **game:phase** | roundId · phaseSeq · phase · tieRound · deadlineAt · serverTime · payload? | 전원 | 단계 전이 |
| 13 | **game:tick** | roundId · phaseSeq · remainMs · serverTime | 전원 | 1초 주기 |
| 14 | **game:progress** | roundId · phaseSeq · payload | 전원 | 입력 도착 · 라운드 판정 |
| 15 | **game:tie** | roundId · phaseSeq · tieRound · tieRoundMax · candidateKind · candidateIds · deadlineAt | 전원 | 동점 판정 |
| 16 | **game:decision_required** | roundId · phaseSeq · reason · options · candidateKind · candidateIds · deadlineAt | 전원 | 결선 상한 소진 · 무효 라운드 · 후보 없음 |
| 17 | **game:result** | roundId · gameId · variant · result · finishedAt | 전원 | 판정 확정 |
| 18 | **round:closed** | roomStatus | 전원 | round:close · ABORT |
| 19 | **error** | code · message · event · requestId | **보낸 사람만** | 요청 처리 실패 |

모든 data에 roomVersion이 실린다. 버전 게이트의 적용 범위는 위 「순서 보장」 절의 표를 따른다.

### 1. room:snapshot

이 이벤트 하나로 대기방 화면을 통째로 그릴 수 있어야 한다. 이후는 개별 이벤트로 부분 갱신만 한다.

```json
{
  "roomVersion": 41,
  "serverTime": "2026-08-02T06:04:05.123Z",
  "room": {
    "code": "427132",
    "displayCode": "MODU-427132",
    "roomName": "4조 · 알고리즘 스터디",
    "maxMembers": 8,
    "roomStatus": "WAITING",
    "hostMemberId": "mbr_a1B2c3D4e5F6g7H8i9J0k1",
    "expiresAt": "2026-08-02T06:14:05.000Z"
  },
  "me": { "memberId": "mbr_L2m3N4o5P6q7R8s9T0u1V2", "isHost": false, "memberStatus": "PENDING" },
  "members": [
    {
      "memberId": "mbr_a1B2c3D4e5F6g7H8i9J0k1", "nickname": "지호", "avatarId": "A06",
      "bio": "@jiho_dev", "isHost": true, "ready": false,
      "connection": "ONLINE", "joinOrder": 1
    }
  ],
  "game": { "gameId": "roulette", "config": { "topic": "팀장" }, "configSchemaVersion": 1 }
}
```

- members에는 **ACTIVE만** 들어간다. 프로필 입력 중인 PENDING은 제외한다.
- 게임이 아직 선택되지 않았으면 game은 null이다.
- **채팅과 진행 중인 라운드는 들어가지 않는다.** 서버가 채팅을 보관하지 않고, 진행 중인 방에는 새 소켓이 붙지 않는다.
- me.memberStatus로 클라이언트가 자신이 아직 프로필 화면에 있는지 대기방에 있는지 구분한다.

### 2. room:closed

```json
{ "reason": "HOST_LEFT", "roomVersion": 42 }
```

- reason은 **HOST_LEFT**(방장 이탈 확정) · **LAST_MEMBER_LEFT**(마지막 참가자 이탈) · **EXPIRED**(10분 무활동) 3값이다.
- 받은 직후 서버가 소켓을 종료 코드 4410으로 닫는다. 클라이언트는 사유별 팝업을 띄우고 표지 화면으로 보낸다.
- **결과 화면에 있던 참여자는 화면을 유지하고 이미지 저장만 허용한다.** 방은 사라졌지만 이미 확정된 결과를 눈앞에서 지울 이유가 없다.

### 3. member:joined

```json
{ "member": { "memberId": "mbr_w3X4y5Z6a7B8c9D0e1F2g3", "nickname": "서연", "avatarId": "A02", "bio": "", "isHost": false, "ready": false, "connection": "ONLINE", "joinOrder": 3 }, "roomVersion": 43 }
```

- 소켓 연결 시점이 아니라 **프로필 확정으로 ACTIVE가 된 순간** 나간다.
- 프로필 화면에 머무르는 사람도 이걸 받아 아바타 선점 현황을 갱신한다.
- 입퇴장 시스템 말풍선은 서버가 따로 내려주지 않는다. 클라이언트가 이 이벤트를 보고 직접 그린다.

### 4. member:left

```json
{ "memberId": "mbr_w3X4y5Z6a7B8c9D0e1F2g3", "reason": "DISCONNECT", "activeCount": 5, "roomVersion": 44 }
```

- reason은 **LEAVE**(직접 나감) · **KICK**(강퇴) · **DISCONNECT**(이탈 확정) 3값이다.
- **방장이 나간 경우는 이 이벤트가 아니라 room:closed다.**
- 게임 진행 중에도 나갈 수 있고 이 이벤트가 나가지만, **명단 스냅샷은 바뀌지 않는다.** 나간 사람은 후보에 남고 결과에도 이탈 표시와 함께 나온다.

### 5. member:ready_changed

```json
{ "memberId": "mbr_w3X4y5Z6a7B8c9D0e1F2g3", "ready": true, "readyCount": 4, "activeCount": 5, "roomVersion": 45 }
```

- readyCount·activeCount는 화면의 준비 밴드에 그대로 쓴다. 클라이언트가 직접 세지 않고 서버 값을 쓰면 오차가 생기지 않는다.
- **방장은 activeCount에 포함되지만 readyCount의 모수에서는 빠진다.** 시작 조건은 방장을 제외한 참여자 전원이므로, activeCount는 명단 인원이고 readyCount의 목표치는 activeCount - 1이다.
- **유예 중(UNSTABLE)인 참여자는 readyCount에서만 빠지고 activeCount에는 남는다.** 준비가 해제된 것으로 보아 게임 시작을 막는다는 뜻이다. 두 값 모두에서 빼면 연결이 끊긴 사람을 없는 셈 치고 게임이 시작되어 그가 처음부터 미입력자로 판에 들어간다.

### 6. member:connection

```json
{ "memberId": "mbr_a1B2c3D4e5F6g7H8i9J0k1", "state": "UNSTABLE", "graceEndsAt": "2026-08-02T06:04:50.000Z", "roomVersion": 46 }
```

- state는 **ONLINE**(연결) · **UNSTABLE**(의심) 2값이다. 의심으로 들어갈 때 UNSTABLE이, 같은 소켓에서 프레임이 도착해 연결로 복귀할 때 ONLINE이 나간다.
- graceEndsAt은 유예 만료 예정 시각이다. ONLINE일 때는 null이다.
- 대상이 참여자면 이 이벤트와 함께 member:ready_changed도 나간다. **의심으로 들어가면 준비가 해제되기 때문이다.**
- 클라이언트는 그 참가자 카드에 연결 확인 표시를 붙이고, 대상이 방장이면 방이 곧 닫힐 수 있음을 알리는 배너를 띄운다.
- **이 이벤트가 이탈을 뜻하지 않는다.** 이탈은 member:left 또는 room:closed로만 확정된다.

### 7. chat:message

```json
{ "messageId": "912", "memberId": "mbr_w3X4y5Z6a7B8c9D0e1F2g3", "text": "다 모였으면 시작해요", "sentAt": "2026-08-02T06:04:05.123Z", "roomVersion": 46 }
```

- memberId가 본인이면 오른쪽, 아니면 왼쪽 말풍선이다. 시스템 메시지를 서버가 보내는 경로는 없다.
- messageId는 서버 인메모리 시퀀스의 10진 문자열이며 방 수명 동안만 유일하다.

### 8. chat:typing

```json
{ "memberId": "mbr_w3X4y5Z6a7B8c9D0e1F2g3", "typing": true, "roomVersion": 46 }
```

보낸 사람 본인에게는 되돌리지 않는다.

### 9. game:selected

```json
{ "gameId": "ladder", "config": { "resultItems": ["팀장", "자료 조사", "PPT 제작"], "speed": "NORMAL" }, "configSchemaVersion": 1, "roomVersion": 47 }
```

- config에는 해당 게임의 **기본값**이 채워져 내려온다.
- configSchema 본문은 싣지 않는다. 클라이언트가 GET /api/games에서 이미 받았으므로 **버전만** 실어 대조하게 한다. 버전이 다르면 클라이언트가 GET /api/games/{gameId}로 다시 받는다.

### 10. game:config_changed

```json
{ "gameId": "ladder", "config": { "resultItems": ["팀장", "자료 조사", "PPT 제작"], "speed": "FAST" }, "roomVersion": 48 }
```

부분 갱신 요청을 받았더라도 **병합된 전체 config**를 내려보낸다. 클라이언트가 병합 결과를 스스로 계산하면 서버와 어긋날 수 있다.

### 11. game:started

```json
{
  "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6",
  "gameId": "kingmaker",
  "config": { "topic": "팀명", "votesPerMember": 1, "revealAuthors": false },
  "roster": [
    { "memberId": "mbr_a1B2c3D4e5F6g7H8i9J0k1", "nickname": "지호", "avatarId": "A06", "joinOrder": 1 }
  ],
  "roomVersion": 49
}
```

- roster가 **명단 스냅샷**이다. 이 배열이 그 판의 후보 전량이며 도중 이탈해도 바뀌지 않는다. joinOrder 순으로 정렬되어 있고 룰렛 조각 배치·사다리 레인 배치가 이 순서를 따른다.
- game:started 직후에 game:phase(READY)가 이어진다. 두 이벤트를 합치지 않는 이유는 라운드 생성과 단계 전이가 다른 축이기 때문이다 — 이후의 모든 단계 전이는 game:phase 하나만 보면 된다.

### 12. game:phase

```json
{ "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6", "phaseSeq": 1, "phase": "PLAYING", "tieRound": 0, "deadlineAt": "2026-08-02T06:06:05.000Z", "serverTime": "2026-08-02T06:04:05.123Z", "payload": null, "roomVersion": 50 }
```

| 필드 | 값 |
|------|-----|
| phase | **READY**(가이드·카운트다운) · **PLAYING**(입력) · **TIE**(동점 결선) · **RESULT**(결과 연출) |
| phaseSeq | 라운드 안에서 0부터 단조 증가한다. C→S 입력이 되싣는 값이다 |
| tieRound | 결선 회차다. TIE가 아니면 0, 결선이면 1~3 |
| deadlineAt | 이 단계가 끝나는 시각. 제한 시간이 없으면 null이며 이때 game:tick도 흐르지 않는다 |
| payload | 이 전이에만 필요한 게임별 부가 값. 해당 없으면 null이다 |

**payload는 연출이 시작되는 순간에 필요한 값을 싣는다.** 결과 이벤트는 연출이 끝난 뒤에 오므로 그때는 이미 늦고, 값이 전원에게 같게 도착하지 않으면 화면이 서로 다른 조각에서 멈춘다. game:progress가 같은 구조를 쓰므로 새 규약이 아니다.

| 게임 · 단계 | payload |
|------------|---------|
| 룰렛 SPINNING | winnerIndex |
| 사다리 DRAWING | assignments · ladderRungs |

값 이름은 [../06_database/04_options_votes_results.md](../06_database/04_options_votes_results.md)의 result_data 규약을 따른다. **전용 이벤트를 신설하지 않는다** — 게임마다 하나씩 늘어나고 S→C 전수가 바뀐다.

- **클라이언트는 이 이벤트만 보고 화면을 전환한다.** 자체 타이머가 0에 닿았다는 이유로 전환하지 않는다.
- 킹메이커의 제출·투표는 같은 PLAYING 안의 별개 단계가 아니라 **각각 phaseSeq가 다른 PLAYING**이다. 단계의 의미 구분은 진행 중인 게임과 phaseSeq로 클라이언트가 판단한다.

### 13. game:tick

```json
{ "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6", "phaseSeq": 1, "remainMs": 92000, "serverTime": "2026-08-02T06:04:33.123Z", "roomVersion": 50 }
```

위 「타이머 동기화」 절의 규정을 따른다. **버전 게이트를 적용하지 않는다.**

### 14. game:progress

```json
{ "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6", "phaseSeq": 1, "payload": { "submittedCount": 3, "totalCount": 5 }, "roomVersion": 50 }
```

**누가 무엇을 선택했는지는 어떤 경우에도 넣지 않는다.** 익명 저격과 킹메이커는 익명성이 기획 의도라 중간에 새면 안 되고, 다른 게임도 중간 집계를 아무에게도 보여주지 않는다.

| 게임 · 단계 | payload | 시점 |
|------------|---------|------|
| 킹메이커 제출 | submittedCount · totalCount | 입력이 도착할 때마다 |
| 킹메이커 투표 · 익명 저격 | votedCount · totalCount | 입력이 도착할 때마다 |
| 시간초 잡기 | startedCount · stoppedCount · totalCount | 입력이 도착할 때마다 |
| 룰렛 · 사다리 | 보내지 않는다 | — |
| **눈치게임** | round · verdicts · safeMemberIds · remainingMemberIds · nextRoundStartsAt | **라운드가 마감된 뒤에만** |

**눈치게임만 진행 중 집계를 보내지 않는 이유**는 이 게임에서 "누가 이미 눌렀다"는 사실 자체가 결정적 정보이기 때문이다. 다른 게임의 완료/대기 표시는 기다림을 가늠하게 할 뿐이지만, 눈치게임에서는 그것이 곧 정답을 알려준다.

```json
// 눈치게임 · 라운드 마감 후
{
  "round": 1,
  "verdicts": [
    { "memberId": "mbr_a1B2c3D4e5F6g7H8i9J0k1", "verdict": "SAFE",     "elapsedMs": 2100 },
    { "memberId": "mbr_w3X4y5Z6a7B8c9D0e1F2g3", "verdict": "OVERLAP",  "elapsedMs": 7000 },
    { "memberId": "mbr_H4i5J6k7L8m9N0o1P2q3R4", "verdict": "OVERLAP",  "elapsedMs": 7120 },
    { "memberId": "mbr_S5t6U7v8W9x0Y1z2A3b4C5", "verdict": "NO_INPUT", "elapsedMs": null }
  ],
  "safeMemberIds": ["mbr_a1B2c3D4e5F6g7H8i9J0k1"],
  "remainingMemberIds": ["mbr_w3X4y5Z6a7B8c9D0e1F2g3", "mbr_H4i5J6k7L8m9N0o1P2q3R4", "mbr_S5t6U7v8W9x0Y1z2A3b4C5"],
  "nextRoundStartsAt": "2026-08-02T06:05:10.000Z"
}
```

- verdict는 **SAFE**(혼자 눌러 안전 확정 · 후보에서 빠진다) · **OVERLAP**(판정창 안에 둘 이상이 눌러 남는다) · **NO_INPUT**(누르지 않아 남는다) · **LAST**(최후 1인으로 뽑힌다) 4값이다.
- **혼자 누른 사람이 안전하고 겹친 사람이 남는다.** frontend/src/games/Nunchi.tsx는 겹친 사람을 탈락시키는 정반대로 구현되어 있으며 이는 구현 결함이다. 겹치는 것이 이득인 구조는 일부러 겹치는 담합을 부르고 게임이 성립하지 않는다.
- elapsedMs는 라운드 시작을 0으로 한 **서버 도착 시각**의 경과 밀리초다.
- nextRoundStartsAt은 라운드 사이 3초 카운트다운의 종료 시각이다.

### 15. game:tie

```json
{
  "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6", "phaseSeq": 4, "tieRound": 1, "tieRoundMax": 3,
  "candidateKind": "OPTION", "candidateIds": ["opt_O7p8Q9r0S1t2U3v4W5x6Y7", "opt_Z8a9B0c1D2e3F4g5H6i7J8"],
  "deadlineAt": "2026-08-02T06:07:35.000Z", "roomVersion": 53
}
```

- candidateKind는 **MEMBER**(시간초 잡기 · 익명 저격) · **OPTION**(킹메이커) 2값이다. 룰렛·사다리·눈치게임은 동점이 발생하지 않는다.
- **tieRound와 tieRoundMax가 함께 실린다.** 화면이 "결선 2/3"을 그릴 수 있어야 하고, 무엇보다 반복이 끝난다는 사실이 참가자에게 보여야 한다.
- 결선은 새 라운드가 아니라 **같은 roundId 안의 TIE 단계**다. phaseSeq가 회차마다 올라간다.
- tieRound가 tieRoundMax에 도달하고도 단독 승자가 없으면 **다음은 game:tie가 아니라 game:decision_required**가 나간다. 종료가 보장되지 않는 반복을 두지 않는다.

### 16. game:decision_required

```json
{
  "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6", "phaseSeq": 8, "reason": "TIE_EXHAUSTED",
  "options": ["PICK", "RANDOM", "ABORT"],
  "candidateKind": "OPTION", "candidateIds": ["opt_O7p8Q9r0S1t2U3v4W5x6Y7", "opt_Z8a9B0c1D2e3F4g5H6i7J8"],
  "deadlineAt": "2026-08-02T06:09:00.000Z", "roomVersion": 57
}
```

| reason | 상황 | options |
|--------|------|---------|
| **TIE_EXHAUSTED** | 결선을 3회 했는데도 단독 승자가 없다 | PICK · RANDOM · ABORT |
| **VOID_ROUND** | 눈치게임에서 남은 사람 전원이 같은 판정창에 눌러 아무도 안전 확정하지 못했다 | RETRY · ABORT |
| **NO_OPTION** | 킹메이커에서 제출된 안건이 하나도 없다 | RETRY · ABORT |

- **방장만 game:decide로 응답할 수 있고**, 나머지는 대기 화면을 본다.
- deadlineAt까지 응답이 없으면 서버가 ABORT로 처리해 round:closed를 보낸다. 방장이 유예 중이면 이 경로로 판이 정리된다.
- 이 이벤트가 **모든 반복 규칙의 탈출구**다. 상한 없는 반복을 두지 않는다는 규약이 API 표면에서 이 이벤트로 구현된다.

### 17. game:result

```json
{ "roundId": "rnd_D6e7F8g9H0i1J2k3L4m5N6", "gameId": "roulette", "variant": "WINNER", "result": { }, "finishedAt": "2026-08-02T06:05:12.000Z", "roomVersion": 61 }
```

variant 4종은 frontend/src/lib/types.ts의 GameResult 유니언과 대응한다. 결과 데이터의 의미 정본은 [../05_game_rules](../05_game_rules/README.md)이며 여기서는 와이어 형태만 확정한다.

| variant | 게임 | result |
|---------|------|--------|
| **WINNER** | 룰렛 · 시간초 · 저격 | topic · winnerMemberId · detail · stats |
| **ASSIGN** | 사다리 | topic · pairs[{ memberId, itemLabel }] · seed · stats |
| **TALLY** | 킹메이커 | topic · winnerCandidateId · rows[{ candidateId, text, votes, authorMemberId?, voterMemberIds? }] · reveal · stats |
| **RECORD** | 눈치게임 | topic · pickedMemberId · rounds[{ round, rows[{ memberId, verdict, elapsedMs }] }] · stats |

WINNER의 detail은 게임마다 다르다.

| gameId | detail |
|--------|--------|
| roulette | seed · sliceOrder(memberId 배열) |
| timer | targetMs · criterion · records[{ memberId, elapsedMs, diffMs, source, status }] |
| snipe | tally[{ memberId, hits, voterMemberIds? }] · abstainCount · randomFallback |

- **익명 필드는 조건부다.** TALLY의 authorMemberId는 revealAuthors가 true일 때만 실린다. **거짓일 때는 필드를 null로 채우는 것이 아니라 아예 빼서 내려보낸다** — 값이 있는 자리를 남기면 그 자리를 채우는 구현이 언젠가 들어온다. **익명 저격의 지목자는 조건부가 아니다** — 어떤 설정에서도 담지 않는다.
- 익명 모드의 식별 정보는 이 이벤트 밖 어떤 경로로도 클라이언트에 내려가지 않는다.
- stats는 결과 화면 하단의 라벨·값 쌍 배열이다. 서버가 문구까지 확정해 내려보내 기기마다 다른 반올림이 생기지 않게 한다.
- 결과 연출이 끝난 뒤 3초에 결과 화면으로 전환하는 것은 **클라이언트 타이밍**이다. 서버는 game:phase(RESULT)와 game:result를 함께 보내고 그 뒤를 관여하지 않는다.

### 18. round:closed

```json
{ "roomStatus": "WAITING", "roomVersion": 62 }
```

방 상태가 PLAYING에서 WAITING으로 돌아가고 참여자 준비 상태가 전부 해제된다. 해제는 member:ready_changed로 각각 통지된다.

### 19. error

```json
{ "code": "game.stale_phase", "message": "이미 지난 단계의 입력이에요", "event": "game:action", "requestId": "8b1f0c4a-…", "roomVersion": 50 }
```

- **보낸 사람에게만** 간다. 브로드캐스트하지 않는다.
- **event와 requestId를 에코한다.** 소켓에는 요청-응답 짝이 없으므로 이 두 값이 없으면 클라이언트가 어떤 입력이 실패했는지 알 수 없다. 원천에는 없던 필드다.
- code는 REST와 완전히 같은 문자열을 쓴다. 소켓 전용 코드를 만들지 않는다.

## game:action type 8종

| # | 게임 | type | payload | 보내는 사람 | 횟수 |
|:-:|------|------|---------|------------|------|
| 1 | 운명의 룰렛 | **roulette.pick** | 없음 | **방장만** | 1회 |
| 2 | 사다리타기 | **ladder.start** | 없음 | **방장만** | 1회 |
| 3 | 킹메이커 | **king.opinion** | text | 전원 | 1회 |
| 4 | 킹메이커 | **king.vote** | candidateIds | 전원 | 1회(배열로 한 번에) |
| 5 | 시간초 잡기 | **timer.start** | 없음 | 전원 | 1회 |
| 6 | 시간초 잡기 | **timer.stop** | elapsedMs | 전원 | 1회 |
| 7 | 익명 저격 | **snipe.vote** | targetMemberIds | 전원 | 1회(배열로 한 번에) |
| 8 | 눈치게임 | **nunchi.up** | 없음 | 남은 사람 | 라운드당 1회 |

현재 게임·현재 단계와 맞지 않는 type이면 game.invalid_action이다.

| 필드 | 규칙 | 위반 |
|------|------|------|
| text (킹메이커) | 1~120자 · 1인 1건 · 제출 후 수정·취소 불가 | common.validation_failed |
| candidateIds (킹메이커) | 길이 1~votesPerMember · **서로 다른 안건에만** · 자기가 낸 안건 불가 | vote.limit_exceeded · vote.duplicate_target · vote.self_not_allowed |
| targetMemberIds (저격) | 길이 1~(multiVote면 2, 아니면 1) · **서로 다른 대상에만** · 자기 자신 불가 | vote.limit_exceeded · vote.duplicate_target · vote.self_not_allowed |
| elapsedMs (시간초) | 0 이상의 정수 밀리초. 아래 「시간초 잡기의 예외」 참조 | game.elapsed_rejected |

- 투표를 **배열로 한 번에 받는다.** 표를 한 장씩 받으면 서버가 부분 상태를 들고 있어야 하고 "서로 다른 대상" 검증이 도착 순서에 의존하며, 중간 집계 비노출과도 어긋난다. 한 번의 제출로 확정하고 수정을 허용하지 않는다.
- 안전 확정된 사람의 nunchi.up과 결선 후보가 아닌 사람의 재투표는 **game.not_eligible**이다. 원천의 ELIMINATED는 눈치게임이 탈락 구조라는 오해를 담고 있어 쓰지 않는다.
- 결선(TIE) 단계의 입력은 같은 type을 재사용한다. 후보 집합만 좁아진다.
- **폐기된 액션**: ladder.pick(참가자가 레인을 고르는 단계가 없다) · ladder.reveal(전원 경로를 동시에 공개한다) · king.vote의 targetMemberId(제출자 익명성이 붕괴한다).

## 시간초 잡기의 예외

**전 게임의 시간·순서 판정은 서버 도착 시각이다. 시간초 잡기의 경과 시간 하나만 예외다.**

### 왜 예외인가

다른 게임에서 서버 도착 시각을 쓰면 네트워크가 빠른 사람이 유리해질 뿐이지만, 시간초 잡기는 **경과 시간 자체가 판정값**이다. START 상행 지연과 STOP 상행 지연의 차이가 그대로 오차에 더해지므로, 서버 관측만 쓰면 참가자의 감각이 아니라 그 순간의 회선 상태가 순위를 정한다. 지연이 실력을 덮는 것이 더 큰 불공정이라 판단해 예외를 둔다.

### 어떻게 검증하는가

| 단계 | 동작 |
|------|------|
| 1 | 클라이언트가 START를 누르는 순간 **자기 단조 시계**(performance.now)를 읽고 timer.start를 보낸다 |
| 2 | 서버가 timer.start의 **도착 시각**을 기록한다 |
| 3 | 클라이언트가 STOP을 누르는 순간 단조 시계를 다시 읽어 **경과 시간을 정수 밀리초로** 계산하고 timer.stop에 실어 보낸다 |
| 4 | 서버가 timer.stop의 도착 시각을 기록하고 **serverElapsedMs = STOP 도착 − START 도착**을 계산한다 |
| 5 | **abs(elapsedMs − serverElapsedMs) ≤ 400ms**이면 elapsedMs를 판정값으로 채택한다 |
| 6 | 범위 밖이면 **elapsedMs를 버리고 serverElapsedMs를 판정값으로 쓴다.** 보낸 사람에게만 error game.elapsed_rejected를 통지한다 |

- 결과의 records[].source에 **CLIENT_MEASURED** 또는 **SERVER_OBSERVED**를 실어 어느 값으로 판정했는지 남긴다. 판정 근거가 사람마다 다를 수 있다면 그 사실이 결과에 보여야 한다.
- 거부된 사람을 최하위로 처리하지 않는 이유는, 조작해도 이득이 없고(원래대로 서버 관측값이 쓰일 뿐) 회선이 튄 정상 사용자가 억울하게 배제되지도 않기 때문이다.
- **범위 안의 조작은 이 검증으로 막지 못한다.** 400ms 안에서 값을 당기면 통과한다. 이 한계를 감수하는 근거는 [../11_fairness](../11_fairness/README.md)에 둔다.
- **400ms는 실측으로 검증한 값이 아니다.** 상행 지연 지터의 상한을 여유 있게 잡은 잠정값이며, 구현 후 계측으로 재검토해 기술 결정에 남긴다.
- 클라이언트가 **벽시계를 쓰면 안 된다.** Date.now는 사용자가 기기 시계를 바꾸거나 OS가 시각을 동기화하면 튄다. 단조 시계여야 한다.
- elapsedMs가 음수이거나 (목표 시간 + 3초)를 크게 넘으면 검증 이전에 common.validation_failed로 거부한다.

### 다른 시각 필드는 받지 않는다

원천의 clientStartAt · clientStopAt 같은 **벽시계 시각 필드를 두지 않는다.** 참고용으로만 쓴다고 적어도 언젠가 판정에 섞이고, 클라이언트 벽시계는 위조가 아니어도 틀린다. 받는 값은 **경과 시간 하나**뿐이고 그것도 서버가 대조한다.

## configSchema

GET /api/games · GET /api/games/{gameId}가 내려보내는 설정 규격이며 game:config가 이 규격을 따른다. 항목은 **16개**이고 근거는 docs_legacy/requirements.md §3.4다. 규칙의 의미 정본은 [../05_game_rules](../05_game_rules/README.md)다.

| gameId | 필드 | 타입 | 범위·값 | 기본값 |
|--------|------|------|---------|--------|
| roulette | topic | string | 1~12자 | 팀장 |
| ladder | resultItems | string[] | 1개 이상 · 각 1~12자 · **중복 허용** | 조별과제 세트 6항목 |
| ladder | speed | enum | FAST · NORMAL · SLOW | NORMAL |
| kingmaker | topic | string | 1~12자 | 팀명 |
| kingmaker | votesPerMember | enum | 1 · 2 · 3 | 1 |
| kingmaker | revealAuthors | boolean | false=익명 · true=실명 | false |
| timer | topic | string | 1~12자 | 팀장 |
| timer | targetSeconds | enum | 5 · 7 · 10 | 5 |
| timer | criterion | enum | CLOSEST · FARTHEST | CLOSEST |
| snipe | question | string | 1~30자 | 발표를 제일 잘할 것 같은 사람은? |
| snipe | voteSeconds | int | 5~60 | 10 |
| snipe | multiVote | boolean | false=1인 1표 · true=1인 2표 | false |
| nunchi | topic | string | 1~12자 | 팀장 |
| nunchi | windowMs | enum | 300 · 500 | 300 |
| nunchi | roundSeconds | enum | 10 · 15 · 20 | 15 |

- **사다리는 topic이 없다.** 항목 목록 자체가 주제 역할을 한다.
- 사다리의 resultItems 개수는 참가자 수와 다를 수 있고, **서버가 게임 시작 시 참가자 수에 맞춘다** — 적으면 X로 채우고 많으면 뒤에서 잘라낸다. 그래서 개수 자체는 설정 검증에서 막지 않는다.
- **게임을 바꾸면 설정이 기본값으로 초기화된다.** 이전 게임의 값이 남아 엉뚱하게 적용되는 사고를 막는다.
- 스키마가 바뀌면 configSchemaVersion을 올린다. game:selected가 그 값을 실어 클라이언트가 캐시한 스키마와 대조하게 한다.

## 소켓 종료 코드

| 코드 | 뜻 | 유예 |
|:----:|-----|:----:|
| 1000 | **명시적 퇴장** — 나가기 버튼에서만 쓴다. beforeunload·페이지 숨김에서는 쓰지 않는다 | 없음 |
| 1001 · 1006 · 그 밖 | 비정상 종료 · 새로고침 · 탭 닫기 · 앱 전환 후 정지 | **의심 → 유예** |
| 4002 | 프로토콜 위반 · 지원하지 않는 protocolVersion | 없음 |
| 4401 | 인증 실패 · 토큰 무효 · 방 없음 | 없음 |
| 4403 | 강퇴 | 없음 |
| 4408 | 3초 안에 conn:auth가 오지 않음 | 없음 |
| 4409 | 같은 토큰에 이미 다른 소켓이 붙어 있음 | 없음(**기존 소켓을 유지**한다) |
| 4410 | 방 종료 — room:closed 직후 | 없음 |
| 4413 | 프레임 상한 64KB 초과 | 없음 |

4000~4999는 애플리케이션 정의 구간이다. 클라이언트는 이 코드로 사용자에게 보여줄 문구를 고르고, **어느 코드에서도 자동 재연결을 시도하지 않는다.**

## 관련 문서

- 공통 규약 · 멱등 · 길이 상한 → [01_conventions.md](./01_conventions.md)
- 방 진입 전 통신 → [02_rest.md](./02_rest.md)
- 에러 매핑 · 종료 코드 대응 → [04_error_mapping.md](./04_error_mapping.md)
- 에러 코드 채번 정본 → [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md)
- 게임 규칙·판정 알고리즘·종료 증명 → [../05_game_rules/README.md](../05_game_rules/README.md)
- 시간과 타이밍·방 상태머신·인메모리↔DB 경계 → [../04_architecture/README.md](../04_architecture/README.md)
- 서버 판정 권위·익명성·치팅 방지 → [../11_fairness/README.md](../11_fairness/README.md)
- 이벤트별 DB 처리 → [../06_database/README.md](../06_database/README.md)
- 폴더 색인·고정 기준 → [README.md](./README.md)
