# 기능ID → 화면코드 추적성

> **대상**: 기능 121건 전수의 표면 화면 매핑(미매핑 0 보장) · 화면별 담은 기능 수 파생 집계
> **작성일**: 2026-08-02
> **원천**: [../02_features/README.md](../02_features/README.md)(기능 121건 채번 정본) · 도메인 파일 7본(01_room_join · 02_lobby · 03_game_setup · 04_play_common · 05_games · 06_result · 07_common) · [../02_features/08_permission_matrix.md](../02_features/08_permission_matrix.md) · [README.md](./README.md)(화면 12본) · [01_standards.md](./01_standards.md) · [03_entry.md](./03_entry.md) · [04_lobby.md](./04_lobby.md) · [05_game_screens.md](./05_game_screens.md) · [06_result.md](./06_result.md)의 담은 기능ID

기능 하나하나가 **어느 화면에서 사용자에게 보이는가**를 잇는다. 매핑되지 않은 기능이 하나라도 있으면 그 기능은 만들어도 아무도 쓸 수 없거나 화면 설계에서 빠진 것이므로, 본 문서의 목적은 그 구멍을 0으로 유지하는 것이다. 기능ID는 [../02_features](../02_features/README.md)가 채번하고 화면코드는 [README.md](./README.md)가 채번하며, **본 문서는 둘을 잇기만 한다.**

## 매핑 규칙

| 규칙 | 내용 |
|------|------|
| 표면 화면 | 그 기능을 사용자가 조작하거나 결과를 보는 화면이다 |
| 서버 전용 기능 | 조작 표면이 없어도 **결과가 나타나는 화면**에 매핑하고 (서버)를 병기한다. 조작 표면이 없다는 것과 화면에 드러나지 않는다는 것은 다르다 |
| **게임 6종 공통** | 게임 6종 화면이 똑같이 담는 기능은 [05_game_screens.md](./05_game_screens.md)의 여섯이 공유하는 것 절이 대표로 담고 **한 번만 센다.** 여섯 번 세면 화면별 무게가 왜곡된다 |
| **전역** | 소속 화면이 하나로 정해지지 않는 횡단 기능은 [01_standards.md](./01_standards.md)가 대표로 담는다. F-CMN의 일부가 여기 해당한다 |
| 설정 기능의 이중 표면 | 게임별 설정 기능(F-{게임}-01)은 **설정 표면(SETUP-GAME)과 표시 표면(해당 게임 화면)** 둘 다에 매핑한다. 방장이 고르는 자리와 그 값이 판을 바꾸는 자리가 다르기 때문이다 |
| 공유 오버레이 | 여러 화면에서 열리는 오버레이 요소가 담는 기능은 **대표 소속 화면**에서만 센다([01_standards.md](./01_standards.md) §2-2) |

---

## 기능ID → 화면코드 매핑

### ROOM — 방 만들기·입장 (17건)

| 기능ID | 기능 | 표면 화면 |
|--------|------|-----------|
| F-ROOM-01 | 표지 화면 | ROOM-LANDING |
| F-ROOM-02 | 방 생성 폼 | ROOM-CREATE |
| F-ROOM-03 | 방 생성 | ROOM-CREATE(서버) |
| F-ROOM-04 | 초대 코드 발급 | ROOM-CREATE(서버) |
| F-ROOM-05 | 초대 코드 검증 조회 | ROOM-LANDING(서버) |
| F-ROOM-06 | 코드 입장 화면 | ROOM-LANDING |
| F-ROOM-07 | 초대 링크 라우팅 | ROOM-LANDING |
| F-ROOM-08 | 입장 검증·슬롯 선점 | ROOM-LANDING(서버) |
| F-ROOM-09 | 프로필 입력 화면 | ROOM-PROFILE |
| F-ROOM-10 | 아바타 선점 현황 | ROOM-PROFILE(서버) |
| F-ROOM-11 | 프로필 확정 | ROOM-PROFILE(서버) |
| F-ROOM-12 | 닉네임 중복 처리 | ROOM-PROFILE(서버) |
| F-ROOM-13 | 아바타 자동 배정 | ROOM-PROFILE(서버) |
| F-ROOM-14 | 프로필 변경 잠금 | ROOM-PROFILE |
| F-ROOM-15 | 미확정 슬롯 자동 회수 | ROOM-PROFILE(서버) |
| F-ROOM-16 | 초대 링크 공유 | LOBBY-MAIN |
| F-ROOM-17 | 방 나가기 | LOBBY-MAIN |

F-ROOM-17은 나가기 확인 오버레이 2종을 통해 SETUP-GAME · 게임 6종 · RESULT-MAIN에서도 열리지만, 오버레이의 대표 소속이 LOBBY-MAIN이므로 거기서만 센다.

### LOBBY — 대기방 (13건)

| 기능ID | 기능 | 표면 화면 |
|--------|------|-----------|
| F-LOBBY-01 | 대기방 화면 | LOBBY-MAIN |
| F-LOBBY-02 | 참가자 목록 동기화 | LOBBY-MAIN |
| F-LOBBY-03 | 방 스냅샷 전달 | LOBBY-MAIN(서버) |
| F-LOBBY-04 | 준비 완료 토글 | LOBBY-MAIN |
| F-LOBBY-05 | 준비 현황 표시 | LOBBY-MAIN |
| F-LOBBY-06 | 시작 게이트 | **SETUP-GAME** |
| F-LOBBY-07 | 채팅 전송·중계 | LOBBY-MAIN |
| F-LOBBY-08 | 채팅 로컬 보관·복원 | LOBBY-MAIN |
| F-LOBBY-09 | 시스템 메시지 | LOBBY-MAIN |
| F-LOBBY-10 | 입력 중 표시 | LOBBY-MAIN |
| F-LOBBY-11 | 참가자 강퇴 | LOBBY-MAIN |
| F-LOBBY-12 | 방장 이탈 폐기 | LOBBY-MAIN(서버) |
| F-LOBBY-13 | 방 자동 정리 | LOBBY-MAIN(서버) |

**F-LOBBY-06만 SETUP-GAME이 담는다.** 시작 버튼이 게임 선택·설정 표면에 있고 막는 근거(준비 현황)는 대기방에서 오기 때문이다.

**채팅 4건(F-LOBBY-07 · 08 · 09 · 10)은 게임 6종 화면과 RESULT-MAIN에서도 열린다.** 채팅이 방 전 구간에서 열리기 때문이며(D-45), 그 표면은 채팅 패널 요소가 담당한다. 요소의 대표 소속이 게임 6종이지만 **기능 집계는 LOBBY-MAIN에서 한 번만 한다** — 같은 기능의 같은 표면이 자리를 옮겨 다니는 것이지 기능이 늘어난 것이 아니다.

### SETUP — 게임 선택·설정 (13건)

| 기능ID | 기능 | 표면 화면 |
|--------|------|-----------|
| F-SETUP-01 | 게임 카탈로그 | SETUP-GAME |
| F-SETUP-02 | 최소 인원 미달 잠금 | SETUP-GAME |
| F-SETUP-03 | 게임 선택 동기화 | SETUP-GAME |
| F-SETUP-04 | 랜덤 게임 선택 | SETUP-GAME |
| F-SETUP-05 | 주제 템플릿 칩 | SETUP-GAME |
| F-SETUP-06 | 주제 직접 입력 | SETUP-GAME |
| F-SETUP-07 | 게임별 설정 패널 | SETUP-GAME |
| F-SETUP-08 | 설정 변경 동기화 | SETUP-GAME |
| F-SETUP-09 | 게임 변경 시 설정 초기화 | SETUP-GAME |
| F-SETUP-10 | 설정값 서버 검증 | SETUP-GAME(서버) |
| F-SETUP-11 | 게임 시작 | SETUP-GAME |
| F-SETUP-12 | 시작 가이드 | **게임 6종 공통**(게임 가이드 모달) |
| F-SETUP-13 | 규칙 안내 데이터 | SETUP-GAME |

### PLAY — 게임 진행 공통 (12건)

| 기능ID | 기능 | 표면 화면 |
|--------|------|-----------|
| F-PLAY-01 | 판정 엔진 | 게임 6종 공통(서버) |
| F-PLAY-02 | 서버 도착 시각 기록 | 게임 6종 공통(서버) |
| F-PLAY-03 | 입력 멱등 처리 | 게임 6종 공통(서버) |
| F-PLAY-04 | 라운드 단계 전이 | 게임 6종 공통 |
| F-PLAY-05 | 제한 시간 동기화 | 게임 6종 공통(단계 타이머 요소) |
| F-PLAY-06 | 진행 상황 동기화 | 게임 6종 공통(진행 상황 패널 요소) |
| F-PLAY-07 | 조기 진행 | 게임 6종 공통(서버) |
| F-PLAY-08 | 이탈자 후보 유지 | 게임 6종 공통(서버) |
| F-PLAY-09 | 미입력 자동 처리 | 게임 6종 공통(서버) |
| F-PLAY-10 | 결과 확정 브로드캐스트 | 게임 6종 공통 |
| F-PLAY-11 | 게임 화면 공통 프레임 | 게임 6종 공통 |
| F-PLAY-12 | 반복 상한과 방장 선택 | **KING-PLAY · SNIPE-PLAY · TIMER-PLAY** |

F-PLAY-12는 동점이 나는 3종에만 걸린다. 룰렛·사다리는 동점이 발생하지 않고, 눈치게임의 교착은 동점이 아니라 무효 라운드라 F-NUNCHI-07이 처리한다. **PLAY 접두사는 화면 코드를 갖지 않는다** — 진행 공통 표면은 게임 6종 화면 안의 공통 요소로 존재한다.

### 게임 6종 (47건)

| 기능ID | 기능 | 표면 화면 |
|--------|------|-----------|
| F-WHEEL-01 | 룰렛 설정 | SETUP-GAME · WHEEL-PLAY(표시) |
| F-WHEEL-02 | 조각 배치·내 조각 강조 | WHEEL-PLAY |
| F-WHEEL-03 | PICK 실행 | WHEEL-PLAY |
| F-WHEEL-04 | 당첨자·시드 확정 | WHEEL-PLAY(서버) |
| F-WHEEL-05 | 회전 연출 수렴 | WHEEL-PLAY |
| F-LADDER-01 | 사다리 설정 | SETUP-GAME · LADDER-PLAY(표시) |
| F-LADDER-02 | 항목 수 자동 맞춤 | SETUP-GAME |
| F-LADDER-03 | START 실행 | LADDER-PLAY |
| F-LADDER-04 | 사다리 구조 생성 | LADDER-PLAY(서버) |
| F-LADDER-05 | 경로 계산·배정 확정 | LADDER-PLAY(서버) |
| F-LADDER-06 | 레인 자동 배치 표시 | LADDER-PLAY |
| F-LADDER-07 | 동시 경로 연출 | LADDER-PLAY |
| F-KING-01 | 킹메이커 설정 | SETUP-GAME · KING-PLAY(표시) |
| F-KING-02 | 안건 제출 | KING-PLAY |
| F-KING-03 | 안건 셔플 공개 | KING-PLAY(서버) |
| F-KING-04 | 안건 투표 | KING-PLAY |
| F-KING-05 | 미제출자 투표권 | KING-PLAY(서버) |
| F-KING-06 | 개표·확정 | KING-PLAY(서버) |
| F-KING-07 | 결선 투표 | KING-PLAY |
| F-KING-08 | 안건 0건·1건 예외 | KING-PLAY(서버) |
| F-KING-09 | 제출자 실명 공개 | **RESULT-MAIN** |
| F-TIMER-01 | 시간초 설정 | SETUP-GAME · TIMER-PLAY(표시) |
| F-TIMER-02 | START·개별 타이머 | TIMER-PLAY |
| F-TIMER-03 | 숫자 블라인드 | TIMER-PLAY |
| F-TIMER-04 | STOP 확정 | TIMER-PLAY |
| F-TIMER-05 | 정지 시간 산출·검증 | TIMER-PLAY(서버) |
| F-TIMER-06 | 오차 계산·순위 산출 | TIMER-PLAY(서버) |
| F-TIMER-07 | 마감 처리 | TIMER-PLAY(서버) |
| F-TIMER-08 | 동점자 재대결 | TIMER-PLAY |
| F-TIMER-09 | 기록 공개 | TIMER-PLAY |
| F-SNIPE-01 | 저격 설정 | SETUP-GAME · SNIPE-PLAY(표시) |
| F-SNIPE-02 | 후보 목록 | SNIPE-PLAY |
| F-SNIPE-03 | 지목 제출 | SNIPE-PLAY |
| F-SNIPE-04 | 자기 지목 거절 | SNIPE-PLAY(서버) |
| F-SNIPE-05 | 피격 집계·확정 | SNIPE-PLAY(서버) |
| F-SNIPE-06 | 결선 재투표 | SNIPE-PLAY |
| F-SNIPE-07 | 유효표 0 처리 | SNIPE-PLAY(서버) |
| F-SNIPE-08 | 지목선 연출·마스킹 | SNIPE-PLAY |
| F-NUNCHI-01 | 눈치 설정 | SETUP-GAME · NUNCHI-PLAY(표시) |
| F-NUNCHI-02 | 라운드 진행·잔여 표시 | NUNCHI-PLAY |
| F-NUNCHI-03 | UP 입력 | NUNCHI-PLAY |
| F-NUNCHI-04 | 판정창 그룹핑 | NUNCHI-PLAY(서버) |
| F-NUNCHI-05 | 안전 확정·잔류 판정 | NUNCHI-PLAY(서버) |
| F-NUNCHI-06 | 최후 1인 확정 | NUNCHI-PLAY(서버) |
| F-NUNCHI-07 | 무효 라운드 처리 | NUNCHI-PLAY |
| F-NUNCHI-08 | 압박 연출 | NUNCHI-PLAY |
| F-NUNCHI-09 | 라운드 기록 집계 | NUNCHI-PLAY(서버) |

- **F-KING-09만 자기 게임 화면 밖으로 나간다.** 제출자 공개는 개표가 끝난 뒤에만 일어나고 그 표면이 결과 화면의 개표형 카드이기 때문이다(D-10).
- **F-LADDER-02는 SETUP-GAME에만 둔다.** 항목이 어떻게 맞춰졌는지를 보는 사람은 항목을 편집하는 방장이며, 그 자리가 설정 표면이다.

### RESULT — 결과·저장 (9건)

| 기능ID | 기능 | 표면 화면 |
|--------|------|-----------|
| F-RESULT-01 | 결과 화면 전환 | RESULT-MAIN |
| F-RESULT-02 | 결과 화면 4종 | RESULT-MAIN |
| F-RESULT-03 | 결과 이미지 저장 | RESULT-MAIN |
| F-RESULT-04 | 결과 공유 | RESULT-MAIN |
| F-RESULT-05 | 다시 하기 | RESULT-MAIN |
| F-RESULT-06 | 대기방 복귀 | RESULT-MAIN |
| F-RESULT-07 | 참가자 대기 안내 | RESULT-MAIN |
| F-RESULT-08 | 결과·시드 보관과 삭제 | RESULT-MAIN(서버) |
| F-RESULT-09 | 이탈자 표시 | RESULT-MAIN |

### CMN — 공통·오류 (10건)

| 기능ID | 기능 | 표면 화면 |
|--------|------|-----------|
| F-CMN-01 | WebSocket 연결 관리 | 전역(서버) — [01_standards.md](./01_standards.md) §4 |
| F-CMN-02 | 방 상태 머신 | 전역(서버) — [01_standards.md](./01_standards.md) §1 |
| F-CMN-03 | 공통 응답·에러 규격 | 전역(서버) — [01_standards.md](./01_standards.md) §4 |
| F-CMN-04 | 에러 문구 매핑 | 전역 — [01_standards.md](./01_standards.md) §4 |
| F-CMN-05 | 연결 끊김 안내 | LOBBY-MAIN |
| F-CMN-06 | 방 소멸 안내 | LOBBY-MAIN(방장 이탈·방 삭제 안내 요소) |
| F-CMN-07 | 진행 중 입장 거절 안내 | ROOM-LANDING(진행 중 방 입장 거절 안내 요소) |
| F-CMN-08 | 모바일 반응형 | 전역 — [01_standards.md](./01_standards.md) §5 |
| F-CMN-09 | 방장 권한 검증 | 전역(서버) — [01_standards.md](./01_standards.md) §1 |
| F-CMN-10 | 이벤트 순서 보장 | 전역(서버) — [01_standards.md](./01_standards.md) §4 |

**전역 7건은 12본 어디에도 소속되지 않는다.** 어느 한 화면의 기능이 아니라 전 화면이 지키는 규격이기 때문이며, 그 규격의 정본이 화면 표준 문서다. 3건(F-CMN-05 · 06 · 07)은 특정 오버레이 요소가 표면을 가지므로 그 요소의 대표 소속 화면에 매핑한다.

---

## 미매핑 점검

| 점검 항목 | 결과 |
|-----------|:----:|
| 기능 121건 중 표면 화면이 없는 것 | **0건** |
| 화면 12본 중 담은 기능ID가 0인 것 | **0본** |
| 서버 전용 기능 중 결과가 어느 화면에도 드러나지 않는 것 | **0건** |
| 화면 명세의 담은 기능ID와 본 매핑이 어긋나는 것 | **0건** |
| 화면 기능 표에 기능ID가 비어 있는 행 | **0행** |

접두사별 검산 — ROOM 17 · LOBBY 13 · SETUP 13 · PLAY 12 · WHEEL 5 · LADDER 7 · KING 9 · TIMER 9 · SNIPE 8 · NUNCHI 9 · RESULT 9 · CMN 10 = **121** ✓ ([../02_features/README.md](../02_features/README.md)의 집계와 일치)

---

## 화면별 담은 기능 수 (파생 집계)

**아래 표는 각 화면 명세의 담은 기능ID 항목을 센 파생값이다.** 정본은 화면 명세이며, 명세를 고치면 같은 변경 단위에서 이 표를 다시 센다.

| 구분 | 화면코드·버킷 | 담은 기능 수 | 담은 기능ID |
|------|--------------|:-----------:|-------------|
| 화면 | ROOM-LANDING | 6 | F-ROOM-01 · 05 · 06 · 07 · 08 · F-CMN-07 |
| 화면 | ROOM-CREATE | 3 | F-ROOM-02 · 03 · 04 |
| 화면 | ROOM-PROFILE | 7 | F-ROOM-09 · 10 · 11 · 12 · 13 · 14 · 15 |
| 화면 | LOBBY-MAIN | 16 | F-LOBBY-01 · 02 · 03 · 04 · 05 · 07 · 08 · 09 · 10 · 11 · 12 · 13 · F-ROOM-16 · 17 · F-CMN-05 · 06 |
| 화면 | SETUP-GAME | 20 | F-SETUP-01~11 · 13 · F-LOBBY-06 · F-WHEEL-01 · F-LADDER-01 · 02 · F-KING-01 · F-TIMER-01 · F-SNIPE-01 · F-NUNCHI-01 |
| 화면 | WHEEL-PLAY | 5 | F-WHEEL-01 · 02 · 03 · 04 · 05 |
| 화면 | LADDER-PLAY | 6 | F-LADDER-01 · 03 · 04 · 05 · 06 · 07 |
| 화면 | KING-PLAY | 9 | F-KING-01~08 · F-PLAY-12 |
| 화면 | TIMER-PLAY | 10 | F-TIMER-01~09 · F-PLAY-12 |
| 화면 | SNIPE-PLAY | 9 | F-SNIPE-01~08 · F-PLAY-12 |
| 화면 | NUNCHI-PLAY | 9 | F-NUNCHI-01~09 |
| 화면 | RESULT-MAIN | 10 | F-RESULT-01~09 · F-KING-09 |
| 버킷 | 게임 6종 공통 | 12 | F-PLAY-01~11 · F-SETUP-12 |
| 버킷 | 전역([01_standards.md](./01_standards.md)) | 7 | F-CMN-01 · 02 · 03 · 04 · 08 · 09 · 10 |

**합 129다.** 6 + 3 + 7 + 16 + 20 + 5 + 6 + 9 + 10 + 9 + 9 + 10 + 12 + 7 = 129.

### 129와 121이 다른 이유

**두 수는 세는 축이 다르다.** 121은 고유 기능ID 수이고 129는 버킷별 표면 수의 합이다. 한 기능이 여러 버킷에 표면을 가지면 그만큼 더 세어진다.

| 여러 버킷에 걸친 기능 | 버킷 수 | 초과 계상 |
|----------------------|:------:|:---------:|
| F-PLAY-12 반복 상한과 방장 선택 | 3(KING · TIMER · SNIPE) | +2 |
| F-WHEEL-01 룰렛 설정 | 2(SETUP-GAME · WHEEL-PLAY) | +1 |
| F-LADDER-01 사다리 설정 | 2(SETUP-GAME · LADDER-PLAY) | +1 |
| F-KING-01 킹메이커 설정 | 2(SETUP-GAME · KING-PLAY) | +1 |
| F-TIMER-01 시간초 설정 | 2(SETUP-GAME · TIMER-PLAY) | +1 |
| F-SNIPE-01 저격 설정 | 2(SETUP-GAME · SNIPE-PLAY) | +1 |
| F-NUNCHI-01 눈치 설정 | 2(SETUP-GAME · NUNCHI-PLAY) | +1 |

검산: 121 + 2 + 1 + 1 + 1 + 1 + 1 + 1 = **129** ✓. 두 값을 섞어 쓰지 않는다.

### 판독

- **SETUP-GAME이 20건으로 가장 무겁다.** 게임 6종의 설정이 전부 한 표면에 모이기 때문이며, 360px에서 이 화면을 탭으로 분리해야 하는 이유이기도 하다([01_standards.md](./01_standards.md) §5-4).
- **LOBBY-MAIN 16건이 그다음이다.** 참가자·채팅·방 수명이 한 화면에 겹친다.
- **게임 화면은 5~10건으로 고르다.** 공통 12건을 버킷으로 뺀 결과이며, 실제로 각 게임 화면이 그리는 것은 자기 기능 + 공통 12건이다.
- **ROOM-CREATE 3건이 가장 가볍다.** 입력 항목이 제목과 정원 둘뿐이다.

### 접두사별 분포

| 접두사 | 기능 수 | 주 표면 |
|--------|:------:|---------|
| ROOM | 17 | ROOM-LANDING 5 · ROOM-CREATE 3 · ROOM-PROFILE 7 · LOBBY-MAIN 2 |
| LOBBY | 13 | LOBBY-MAIN 12 · SETUP-GAME 1 |
| SETUP | 13 | SETUP-GAME 12 · 게임 6종 공통 1 |
| PLAY | 12 | 게임 6종 공통 11 · KING·TIMER·SNIPE 1 |
| WHEEL | 5 | WHEEL-PLAY(설정 1건은 SETUP-GAME 병행) |
| LADDER | 7 | LADDER-PLAY 5 · SETUP-GAME 2(설정 1건 병행) |
| KING | 9 | KING-PLAY 8 · RESULT-MAIN 1(설정 1건 병행) |
| TIMER | 9 | TIMER-PLAY 9(설정 1건 병행) |
| SNIPE | 8 | SNIPE-PLAY 8(설정 1건 병행) |
| NUNCHI | 9 | NUNCHI-PLAY 9(설정 1건 병행) |
| RESULT | 9 | RESULT-MAIN 9 |
| CMN | 10 | 전역 7 · LOBBY-MAIN 2 · ROOM-LANDING 1 |

합 121이다.

---

## 갱신 규약

기능·화면을 추가·변경하면 **같은 변경 단위에서** 아래를 함께 갱신한다. 정본 한 줄을 고치고 집계를 두면 두 값이 조용히 갈라지며 그 상태가 검증을 통과한 문서로 남는다.

1. 화면 명세(03~06)의 **화면 기능 표**와 **담은 기능ID**
2. 본 문서의 **기능ID → 화면코드 매핑**
3. 본 문서의 **화면별 담은 기능 수** 파생 집계와 129 검산식
4. [README.md](./README.md)의 화면 수·요소 수 집계
5. [../02_features/README.md](../02_features/README.md)의 접두사별 집계와 121
6. [../03_requirements/11_traceability.md](../03_requirements/11_traceability.md)의 REQ ↔ 기능 ↔ 화면 ↔ 테이블

---

## 관련 문서

- 화면 인벤토리 12본·요소 13종 → [README.md](./README.md)
- 화면 표준·전역 기능(F-CMN 7건)·담은 기능ID 표기 규약 → [01_standards.md](./01_standards.md)
- 화면 명세 → [03_entry.md](./03_entry.md) · [04_lobby.md](./04_lobby.md) · [05_game_screens.md](./05_game_screens.md) · [06_result.md](./06_result.md)
- 기능 ID 채번 정본 → [../02_features/README.md](../02_features/README.md)
- 권한 매트릭스 → [../02_features/08_permission_matrix.md](../02_features/08_permission_matrix.md)
- REQ ↔ 기능 ↔ 화면 ↔ 테이블 추적 → [../03_requirements/11_traceability.md](../03_requirements/11_traceability.md)
- ID·표기 규약 → [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)
