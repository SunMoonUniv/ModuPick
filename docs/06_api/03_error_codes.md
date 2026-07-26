# 에러 코드

> REST와 WebSocket이 함께 쓰는 규격이다. [`01_rest.md`](01_rest.md) · [`02_socket.md`](02_socket.md)가 이 문서를 따른다.
> 최종 수정: 2026-07-26

---

## 방 · 입장

| code | HTTP | 상황 | 표시 화면 |
|---|---|---|---|
| `ROOM_NOT_FOUND` | 404 | 없는 방 코드 · 이미 폭파된 방 | `S-01` 코드 입력란 |
| `ROOM_ALREADY_PLAYING` | 409 | 게임 진행 중인 방에 입장 시도 | **`M-04`** 차단 팝업 |
| `ROOM_FULL` | 409 | 정원 초과 | `S-01` 코드 입력란 |
| `ROOM_EXPIRED` | 410 | 방 만료 ([D-03](../DECISIONS.md#d-03)) | `S-01`로 이동 |
| `ROOM_CODE_EXHAUSTED` | 503 | 활성 방이 10,000개에 근접해 코드 발급 실패 ([D-02](../DECISIONS.md#d-02)) | `S-02` 방 만들기 |

## 프로필

| code | HTTP | 상황 | 표시 화면 |
|---|---|---|---|
| `NICKNAME_DUPLICATED` | 409 | 같은 방 안에서 닉네임 중복 | `S-03` |
| `NICKNAME_INVALID` | 400 | 닉네임 1~8자 위반 | `S-03` |
| `AVATAR_TAKEN` | 409 | 이미 선점된 아바타 | `S-03` (잠금 배지로 표시) |

> `AVATAR_TAKEN`은 **동시 클릭 경합에서 늦게 확정한 쪽**에 발생한다.
> 선점은 클릭 시점이 아니라 프로필 확정 시점에 결정되기 때문이다([`06_api/01_rest.md`](01_rest.md) 참조).

## 권한 · 대기방

| code | HTTP | 상황 | 표시 화면 |
|---|---|---|---|
| `NOT_HOST` | 403 | 방장 전용 기능을 참여자가 호출 | `S-04-GUEST` |
| `NOT_ENOUGH_MEMBERS` | 400 | 2명 미만인데 게임 시작 시도 | `S-04-HOST` 상태 밴드 |
| `NOT_ALL_READY` | 400 | 참여자 전원 READY가 아닌데 시작 시도 ([D-12](../DECISIONS.md#d-12)) | `S-04-HOST` 상태 밴드 |
| `INVALID_CONFIG` | 400 | 게임 설정 값 위반 (예: 사다리 결과 항목 > 참가자 수) | `S-04-HOST` 설정 패널 |

## 게임 진행

| code | HTTP | 상황 | 표시 화면 |
|---|---|---|---|
| `ROUND_NOT_FOUND` | 404 | 종료된 라운드에 재접근 | 결과 화면 |
| `ROUND_ALREADY_ENDED` | 409 | 마감 후 도착한 입력 (STOP / UP / 투표) | 게임 공통 |
| `ALREADY_SUBMITTED` | 409 | 1회 제한 액션을 두 번 이상 전송 | `S-07-1` · `S-07` · `S-08` · `S-09` · `S-10` |
| `INVALID_ACTION` | 400 | 현재 phase에서 불가능한 액션 | 게임 공통 |
| `SELF_VOTE_NOT_ALLOWED` | 400 | 자기 자신 / 자기 의견에 투표 | `S-07` · `S-09` |
| `ELIMINATED` | 403 | 탈락자가 추가 입력 | `S-10` |

## 세션 · 종료

| code | HTTP | 상황 | 표시 화면 |
|---|---|---|---|
| `SESSION_EXPIRED` | 401 | 토큰이 무효 — 방이 사라졌거나 잘못된 토큰 ([D-05](../DECISIONS.md#d-05)) | 전체 → `S-01` |
| `HOST_LEFT` | 410 | 방장 이탈로 방 폭파 | 전체 → `S-01` + 안내 팝업 |
| `KICKED` | 403 | 방장에 의해 강퇴됨 | 전체 → `S-01` |

## 정적 리소스

| code | HTTP | 상황 | 표시 화면 |
|---|---|---|---|
| `GAME_NOT_FOUND` | 404 | 존재하지 않는 `gameId` 조회 | — (개발 오류) |

---

## 3. 소켓에서의 에러

- 소켓 에러도 **[`00_conventions.md`](00_conventions.md)의 공통 객체 형태**로 내려간다.
- `error` 이벤트는 **보낸 사람에게만** 간다. **브로드캐스트하지 않는다.**
- 사용하는 `code` 문자열은 REST와 **완전히 동일**하다. 별도 소켓 전용 코드를 만들지 않는다.

```json
{
  "success": false,
  "code": "NOT_HOST",
  "message": "방장만 사용할 수 있는 기능이에요",
  "data": null,
  "timestamp": "2026-07-26T15:04:05+09:00"
}
```

---

## 4. 화면별 에러 대응 정리

| 화면 | 받을 수 있는 에러 |
|---|---|
| `S-01` | `ROOM_NOT_FOUND` · `ROOM_FULL` · `ROOM_EXPIRED` · `ROOM_ALREADY_PLAYING`(→ `M-04`) |
| `S-02` | `ROOM_CODE_EXHAUSTED` |
| `S-03` | `NICKNAME_DUPLICATED` · `NICKNAME_INVALID` · `AVATAR_TAKEN` · `ROOM_FULL` |
| `S-04-HOST` | `NOT_ENOUGH_MEMBERS` · `NOT_ALL_READY` · `INVALID_CONFIG` |
| `S-04-GUEST` | `NOT_HOST` |
| 게임 진행 (`S-05`~`S-10`) | `ROUND_ALREADY_ENDED` · `ALREADY_SUBMITTED` · `INVALID_ACTION` · `SELF_VOTE_NOT_ALLOWED` · `ELIMINATED` |
| 전체 공통 | `SESSION_EXPIRED` · `HOST_LEFT` · `KICKED` |
