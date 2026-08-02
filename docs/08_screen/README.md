# 08_screen — 화면 명세

> **대상**: ModuPick 화면 인벤토리 전수 — 화면코드·화면명·진입 조건·접근 권한·우선순위·구현 상태와 도메인 파일 목차
> **작성일**: 2026-08-02
> **원천**: frontend/src/App.tsx(screen 스토어 전수) · frontend/src/screens/(6본) · frontend/src/games/(6본) · frontend/src/components/Modals.tsx · frontend/src/lib/store.ts · types.ts · data.ts · docs_legacy/requirements.md §4 · git 529e312 docs/screens.md · git ecceb11 docs/07_design/03_screens.md · [../README.md](../README.md)(고정 기준) · [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)(화면 코드 규약)

본 폴더는 **화면 코드의 채번 정본**이다. ModuPick은 링크 하나로 모여 미니게임 6종으로 팀장·역할·안건을 정하는 단일 화면 웹 앱이며, 화면 코드는 {도메인}-{의미} 형식으로 적고 **12본으로 고정**한다. 모달·오버레이·공통 섹션은 독립 화면 코드를 두지 않고 소속 화면의 요소로 기술하며 그 정본은 [01_standards.md](./01_standards.md)다. 여기서 확정한 화면 코드는 수정 없이 그대로 구현한다.

## 화면 코드가 상태값의 조합인 이유

frontend는 라우터를 두지 않고 **단일 라우트에서 상태 전환으로 화면을 바꾼다.** 화면을 고르는 값은 두 개다 — frontend/src/lib/store.ts의 screen(landing · create · profile · lobby · game · result 6값)과 selectedGame(roulette · ladder · kingmaker · timecatch · sniper · nunchi 6값)이다. frontend/src/App.tsx가 screen 값으로 6개 컴포넌트를 갈라 렌더하고, screen이 game일 때만 frontend/src/screens/GameHost.tsx가 selectedGame으로 다시 6갈래를 가른다.

따라서 화면 코드는 **논리 단위**이며 물리 라우트와 1:1이 아니다. 본 문서는 그 논리 단위를 (screen 값 × selectedGame 값)의 조합으로 정의한다.

## 화면 인벤토리 (12본)

| 화면코드 | 화면명 | 진입 조건 | 접근 권한 | 우선순위 | 상태 |
|----------|--------|-----------|-----------|:--------:|:----:|
| **ROOM-LANDING** | 표지 | screen=landing. 앱 최초 진입 · 방 삭제·이탈 후 복귀 | 전원(방 밖) | P0 | 🔶 |
| **ROOM-CREATE** | 새 방 만들기 | screen=create. 표지의 새 방 만들기 | 전원(방 밖) | P0 | 🔶 |
| **ROOM-PROFILE** | 프로필 설정 | screen=profile. 방 생성 직후 · 코드·링크 입장 검증 통과 직후 | 슬롯을 선점한 사람 | P0 | 🔶 |
| **LOBBY-MAIN** | 실시간 대기방 | screen=lobby. 프로필 확정 직후 · 결과 화면에서 대기방 복귀 | 방장·참가자 | P0 | 🔶 |
| **SETUP-GAME** | 게임 선택·설정 | screen=lobby의 게임 선택·설정 표면. 데스크톱은 대기방과 병치, 모바일은 탭 전환 | 방장 조작 · 참가자 읽기 전용 | P0 | 🔶 |
| **WHEEL-PLAY** | 운명의 룰렛 | screen=game · selectedGame=roulette | 방장 입력 · 참가자 관람 | P0 | 🔶 |
| **LADDER-PLAY** | 사다리타기 | screen=game · selectedGame=ladder | 방장 입력 · 참가자 관람 | P0 | 🔶 |
| **KING-PLAY** | 킹메이커 | screen=game · selectedGame=kingmaker | 전원 입력 | P0 | 🔶 |
| **TIMER-PLAY** | 시간초 잡기 | screen=game · selectedGame=timecatch | 전원 입력 | P0 | 🔶 |
| **SNIPE-PLAY** | 익명 저격 | screen=game · selectedGame=sniper | 전원 입력 | P0 | 🔶 |
| **NUNCHI-PLAY** | 눈치게임 | screen=game · selectedGame=nunchi | 전원 입력 | P0 | 🔶 |
| **RESULT-MAIN** | 결과 발표 | screen=result. 게임 화면의 결과 연출 공개 시점부터 3초 뒤 자동 전환 | 전원 열람·저장 · 다음 동작은 방장 | P0 | 🔶 |

### 세는 기준

화면을 세는 축이 셋이라 값이 갈린다. **정본은 화면 코드 축의 12본**이며 나머지 두 축은 참고값이다. 세 값을 섞어 쓰지 않는다.

| 축 | 값 | 내용 |
|----|:--:|------|
| **화면 코드 축(정본)** | **12본** | 본 표의 12본. SETUP-GAME을 독립 화면으로 센다 |
| 상태값 조합 축 | 11본 | screen 6값 중 game이 selectedGame으로 6분화(5 + 6). SETUP-GAME은 LOBBY-MAIN과 같은 상태값이라 세지 않는다 |
| screen 상태값 축 | 6본 | landing · create · profile · lobby · game · result |

**SETUP-GAME을 독립 화면으로 세는 이유**는 둘이다. ① 게임 선택·설정은 F-SETUP 접두사를 갖는 독립 기능군이고 방장 전용 조작 축이 대기방과 다르다. ② 최소 지원 폭 360px에서는 참가자 목록·채팅·게임 선택을 한 화면에 병치할 수 없어 탭으로 분리되므로, 모바일에서는 물리적으로도 다른 표면이 된다([01_standards.md](./01_standards.md) §5).

### 인벤토리 판독

- **우선순위는 그 화면이 담는 기능의 최고 우선순위를 따른다.** 화면 안에 P1 기능이 섞여 있어도 P0 기능이 하나라도 있으면 화면은 P0이다. 그 결과 **12본 전부가 P0**이다 — 미니게임 6종은 제품 정의에 속하는 고정 기준이라 어느 하나를 빼면 다른 제품이 된다. 화면 단위 우선순위로는 범위를 줄일 수 없으며, 범위 조절은 기능 단위에서 한다.
- **12본 전부가 🔶(진행 중)이다. ✅는 0본 · ⬜도 0본이다.** 프로토타입이 12본 전부의 화면 연출을 갖췄으나 **서버가 없어 판정·동기화가 하나도 없다.** 봇 시뮬레이션과 클라이언트 난수로 결과를 만들고 있으므로 어떤 화면도 완료가 아니다. 판정 근거는 [01_standards.md](./01_standards.md) §7이다.
- **접근 권한은 방장·참가자 2역할뿐이다.** 관전자·부방장·운영자를 두지 않으며 방장도 참가자에 포함된다. 역할 정의와 동작별 서버 검증 지점의 정본은 [../02_features/08_permission_matrix.md](../02_features/08_permission_matrix.md)다.
- **게임 진행 공통(PLAY)과 공통·오류(CMN)는 화면 코드를 갖지 않는다.** 진행 공통 표면은 게임 6종 화면 안의 공통 요소로, 오류·안내 표면은 소속 화면의 오버레이 요소로 기술한다. 기능 접두사 12종과 화면 코드의 도메인 접두사는 집합이 다르다.

## 화면 코드 없는 화면 내 요소 (13종)

모달·오버레이·전 화면 공통 섹션은 독립 화면 코드를 두지 않는다. frontend/src/components/Modals.tsx가 제공하는 오버레이를 전수로 뽑고 게임 화면이 공유하는 공통 섹션을 더해 **13종**이다. 요소별 명세 블록의 정본은 [01_standards.md](./01_standards.md) §2-2이며 각 요소는 소속 화면 명세 뒤에 붙는다.

| # | 요소 | 소속 화면 | 상세 |
|:--:|------|-----------|------|
| 1 | 게임 가이드 모달 | 게임 6종 화면 | [05_game_screens.md](./05_game_screens.md) |
| 2 | 진행 중 방 입장 거절 안내 | ROOM-LANDING | [03_entry.md](./03_entry.md) |
| 3 | 방장 이탈·방 삭제 안내 | LOBBY-MAIN · SETUP-GAME · 게임 6종 · RESULT-MAIN | [04_lobby.md](./04_lobby.md) |
| 4 | 참가자 강퇴 확인 | LOBBY-MAIN | [04_lobby.md](./04_lobby.md) |
| 5 | 방장 나가기 확인(방 삭제 경고) | LOBBY-MAIN · SETUP-GAME · 게임 6종 · RESULT-MAIN | [04_lobby.md](./04_lobby.md) |
| 6 | 참가자 나가기 확인 | LOBBY-MAIN · SETUP-GAME · 게임 6종 · RESULT-MAIN | [04_lobby.md](./04_lobby.md) |
| 7 | 동점 결선·교착 해소 안내 | KING-PLAY · SNIPE-PLAY · TIMER-PLAY | [05_game_screens.md](./05_game_screens.md) |
| 8 | 무효 라운드 안내 | NUNCHI-PLAY | [05_game_screens.md](./05_game_screens.md) |
| 9 | 전역 토스트 | 전 화면 | [01_standards.md](./01_standards.md) |
| 10 | 상태 밴드(HUD) | ROOM-CREATE · LOBBY-MAIN · SETUP-GAME · 게임 6종 | [01_standards.md](./01_standards.md) |
| 11 | 진행 상황 패널(완료·대기) | KING-PLAY · TIMER-PLAY · SNIPE-PLAY · NUNCHI-PLAY | [05_game_screens.md](./05_game_screens.md) |
| 12 | 단계 타이머(남은 시간) | KING-PLAY · TIMER-PLAY · SNIPE-PLAY · NUNCHI-PLAY | [05_game_screens.md](./05_game_screens.md) |
| 13 | 채팅 패널 | 게임 6종 · RESULT-MAIN | [05_game_screens.md](./05_game_screens.md) |

- 위 표는 **오버레이 8종(1~8) + 섹션·전역 요소 5종(9~13)**으로 합 13종이다.
- **채팅 패널(#13)이 여기 있는 이유**는 게임 중 채팅이 허용되면서(D-45) 게임 6종과 결과 화면이 같은 표면을 공유하게 됐기 때문이다. LOBBY-MAIN의 채팅은 대기방 3분할 레이아웃의 주 표면이라 요소가 아니라 화면 구성 요소로 기술한다 — 같은 기능이지만 소속 축이 다르다.
- 요소는 H3 블록으로 소속 화면 블록 뒤에 붙인다. 화면 인벤토리 집계는 **{화면코드} — {화면명} 형식의 H2만** 세므로 요소가 화면 수에 섞이지 않는다.
- **요소 블록을 갖는 것은 11종(1~8 · 11 · 12 · 13)이다.** 소속 화면이 하나로 정해지지 않는 전역 요소 2종(9 전역 토스트 · 10 상태 밴드)은 블록 대신 [01_standards.md](./01_standards.md) §3 공통 패턴과 §8 디자인 토큰이 규격을 확정한다. 11 + 2 = 13이다.
- **참가자 나가기 확인(#6)은 코드에 표면이 없다.** frontend/src/lib/types.ts의 ModalKind에 leave 종류가 선언되어 있으나 frontend/src/components/Modals.tsx에 대응 분기가 없어 어디서도 열리지 않는다. 설계에는 필요한 표면이므로 등재하고 구현 정정 대상으로 남긴다.
- **무효 라운드 안내(#8)는 이름과 동작을 함께 고쳐야 한다.** 현행 구현은 "전원 탈락 · 생존자 0명"을 알리는 allout 모달이지만, 정본 규칙에서 눈치게임은 겹친 사람이 탈락하지 않으므로 전원 탈락 상태가 존재하지 않는다([05_game_screens.md](./05_game_screens.md) NUNCHI-PLAY 비고).

## 집계

| 항목 | 값 | 세는 기준 |
|------|:--:|-----------|
| 화면 | **12본** | 화면 코드 축. ROOM 3 · LOBBY 1 · SETUP 1 · 게임 6 · RESULT 1 |
| 화면 내 요소 | **13종** | 오버레이 8 + 섹션·전역 요소 5 |
| 우선순위 분포 | P0 **12** · P1 0 · P2 0 | 화면이 담는 기능의 최고 우선순위 |
| 구현 상태 분포 | ⬜ 0 · 🔶 **12** · ✅ 0 | frontend/ · backend/의 실제 코드 |
| 화면 코드 도메인 접두사 | **10종** | ROOM · LOBBY · SETUP · WHEEL · LADDER · KING · TIMER · SNIPE · NUNCHI · RESULT. 기능 접두사 12종 중 PLAY · CMN은 화면 코드를 갖지 않는다 |

접두사별 화면 수는 ROOM 3 · LOBBY 1 · SETUP 1 · WHEEL 1 · LADDER 1 · KING 1 · TIMER 1 · SNIPE 1 · NUNCHI 1 · RESULT 1이며 합 12다.

## 도메인 파일

| 파일 | 담는 내용 | 화면 수 |
|------|----------|:------:|
| [01_standards.md](./01_standards.md) | 화면 명세 템플릿 · 공통 패턴 · 레이아웃·스크롤 규격 · 상태 처리 4종 · 반응형 규격 · UI 품질 기준 · 디자인 토큰 | 0 |
| [02_traceability.md](./02_traceability.md) | 기능ID → 화면코드 매핑(미매핑 0 보장) · 화면별 담은 기능 수 파생 집계 | 0 |
| [03_entry.md](./03_entry.md) | ROOM-LANDING · ROOM-CREATE · ROOM-PROFILE(+ 진행 중 방 입장 거절 안내) | 3 |
| [04_lobby.md](./04_lobby.md) | LOBBY-MAIN · SETUP-GAME(+ 방장 이탈 안내 · 강퇴 확인 · 나가기 확인 2종) | 2 |
| [05_game_screens.md](./05_game_screens.md) | WHEEL-PLAY · LADDER-PLAY · KING-PLAY · TIMER-PLAY · SNIPE-PLAY · NUNCHI-PLAY(+ 게임 가이드 · 진행 상황 패널 · 단계 타이머 · 채팅 패널 · 동점 안내 · 무효 라운드 안내) | 6 |
| [06_result.md](./06_result.md) | RESULT-MAIN — 결과 화면 4변형(승자형·배정형·개표형·기록형) · 이미지 저장 | 1 |

합계 0 + 0 + 3 + 2 + 6 + 1 = **12본**이다.

## 고정 기준 (정본은 [../README.md](../README.md))

| 항목 | 기준 |
|------|------|
| 화면 | **12본** — ROOM 3 · LOBBY 1 · SETUP 1 · 게임 6 · RESULT 1. 본 문서가 정본이다 |
| 화면 내 요소 | **13종** — 오버레이 8 + 섹션·전역 5. 본 문서가 정본이다 |
| 미니게임 | 6종 — 운명의 룰렛 · 사다리타기 · 킹메이커 · 시간초 잡기 · 익명 저격 · 눈치게임 |
| 기능 접두사 | 12종. 그중 화면 코드에 쓰는 도메인 접두사는 10종 |
| 역할 | 2역할 — 방장(Host) · 참가자(Member). 방장도 참가자에 포함된다 |
| 방 정원 | 2~10명. 게임별 최소 인원은 2 또는 3 |
| 최소 지원 폭 | **360px**. 그 폭에서 가로 스크롤이 발생하지 않는다(D-47) |
| 터치 표적 | 최소 44×44 CSS px. 게임 입력 버튼은 최소 높이 64px(D-48) |
| 우선순위 | P0(핵심 경로) · P1(실사용 보완) · P2(선택·후속) |
| 구현 상태 | ⬜ 미착수 · 🔶 진행 중 · ✅ 완료. 기준은 frontend/ · backend/의 실제 코드 |

## 관련 문서

- 화면 표준·반응형 규격·UI 품질 기준 → [01_standards.md](./01_standards.md)
- 기능ID → 화면코드 추적성 → [02_traceability.md](./02_traceability.md)
- 기능 명세 정본 → [../02_features/README.md](../02_features/README.md)
- 권한 매트릭스 → [../02_features/08_permission_matrix.md](../02_features/08_permission_matrix.md)
- 게임 규칙 정본 → [../05_game_rules/README.md](../05_game_rules/README.md)
- 확정된 제품 결정(D-NN) → [../01_overview/06_design_decisions.md](../01_overview/06_design_decisions.md)
- ID·표기 규약 → [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)
- 고정 기준·전역 불변식 → [../README.md](../README.md)
