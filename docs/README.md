# ModuPick 설계 문서 (docs)

> **대상**: ModuPick(모두픽) — 링크 하나로 모여 미니게임 6종으로 팀장·역할·안건을 정하는 실시간 팀 의사결정 웹 서비스
> **작성일**: 2026-08-02
> **성격**: **설계 정본(to-be)**. 앞으로 무엇을 만들 것인가를 확정해 기술하며, 기능·화면·API·테이블마다 구현 상태를 함께 싣는다. 문서가 확정되면 그대로 구현하고, 구현이 문서와 어긋나면 구현을 고친다.
> **원천**: docs_legacy/(구 스펙 3본 · requirements.md 833줄 정본) · frontend/src(프로토타입 구현 실측) · git 529e312(db.md 1,405줄 · api.md 584줄) · git ecceb11(30문서 체계 3,603줄)

본 문서군은 ModuPick의 게임 규칙·판정·스키마·API·화면·공정성이 **무엇이고 왜 그렇게 정해졌는지**를 목적별 11폴더에 담는다. 진행 상태 보고서가 아니라 구현 지침이며, 각 항목의 진척은 상태 열(⬜🔶✅)이 따로 말한다.

## 현재 상태

- **frontend/** — React 19 + Vite + TypeScript 프로토타입. 화면과 연출은 있으나 서버가 없어 봇 시뮬레이션으로 동작한다. 명세와 어긋난 지점이 있으며 정정 대상은 [01_overview/05_priorities_roadmap.md](./01_overview/05_priorities_roadmap.md)에 등재한다.
- **backend/** — FastAPI 골격만 있다(헬스 체크·소켓 배선 확인용 엔드포인트). 게임 로직·DB·실시간 라우팅은 미착수다.
- 문서는 **설계된 것**을 담는다. 프로토타입이 구현한 화면 연출을 기능 완료로 표기하지 않는다.

## 문서 지도

| 폴더 | 내용 | 핵심 독자 |
|------|------|-----------|
| [01_overview](./01_overview/README.md) | 제품 정의·목표·범위·역할·도메인 지도·우선순위·확정 제품 결정(D-NN) | 전원·평가자 |
| [02_features](./02_features/README.md) | 도메인별 기능 명세(**F-ID 채번 정본**)·방장/참가자 권한 매트릭스 | 전 개발 |
| [03_requirements](./03_requirements/README.md) | 요구사항 정본(REQ-*)·전역 규칙·비기능·인수기준(AC-NN)·추적성 | 전 개발·QA |
| [04_architecture](./04_architecture/README.md) | 시스템 구조·WebSocket·판정 엔진·시간과 타이밍·방 상태머신·인메모리↔DB 경계·배포·기술결정(ADR) | 전 개발 |
| [05_game_rules](./05_game_rules/README.md) | 게임 공통 기준 + 6종 상세. **각 게임 문서는 상태머신·판정 의사코드·종료 증명·경계값 표를 반드시 담는다** | 전 개발 |
| [06_database](./06_database/README.md) | ERD·테이블 명세·제약·트랜잭션과 동시성·마이그레이션 | 백엔드·DB |
| [07_api](./07_api/README.md) | 규약·REST·WebSocket 이벤트·에러 매핑 | 전 개발 |
| [08_screen](./08_screen/README.md) | 화면 표준·화면 인벤토리·기능ID→화면코드 추적성·화면 명세 | 프론트·디자인 |
| [09_tech_stack](./09_tech_stack/README.md) | 기술 스택과 선정 사유 | 전원 |
| [10_glossary](./10_glossary/README.md) | 도메인 용어·**에러코드 전수 정본**·enum과 상태머신·ID 규약·단위와 시간 | 전원(단일 참조점) |
| [11_fairness](./11_fairness/README.md) | 서버 판정 권위·익명성·치팅 방지·개인정보 수명·위협 모델 | 전 개발 |

## 읽는 순서 (권장)

1. **맥락 잡기** — 01_overview → 09_tech_stack → 04_architecture
2. **무엇을 만드나** — 02_features → 05_game_rules → 03_requirements
3. **어떻게 만드나** — 06_database → 07_api → 08_screen → 11_fairness
4. 용어·에러코드·ID가 막히면 언제든 → 10_glossary

## 고정 기준 (전 문서 공통)

문서 간 수치·식별자가 어긋나지 않도록 다음 기준을 모든 문서가 동일하게 인용한다. 정본이 지정된 항목은 그 문서가 값을 확정하고 본 README가 그 값을 싣는다.

| 항목 | 기준 |
|------|------|
| 미니게임 | **6종** — 운명의 룰렛 · 사다리타기 · 킹메이커 · 시간초 잡기 · 익명 저격 · 눈치게임. 구성은 서버 난수 2 · 참가자 투표 2 · 참가자 실력 2이며 **화면에는 이 분류를 표시하지 않는다** |
| 도메인 | **12개** — 방 만들기·입장 · 대기방 · 게임 선택·설정 · 게임 진행 공통 · 게임 6종 각각 · 결과·저장 · 공통·오류 |
| 기능 접두사 | **12종** — ROOM · LOBBY · SETUP · PLAY · WHEEL · LADDER · KING · TIMER · SNIPE · NUNCHI · RESULT · CMN |
| 방 정원 | **2~10명**. 방장이 방 생성 시 정하며 이후 변경할 수 없다. 게임별 최소 인원은 2 또는 3이다 |
| 초대 코드 | MODU- 접두어 + **숫자 6자리**. 표시할 때만 접두어를 붙인다 |
| 기능 | **121건** — ROOM 17 · LOBBY 13 · SETUP 13 · PLAY 12 · CMN 10 · KING 9 · NUNCHI 9 · RESULT 9 · TIMER 9 · SNIPE 8 · LADDER 7 · WHEEL 5 (정본 [02_features/README.md](./02_features/README.md)) |
| 요구사항 | **194항** — 도메인 154 + 횡단 40(REQ-GLB 24 · REQ-NFR 16) (정본 [03_requirements/README.md](./03_requirements/README.md)) |
| 인수 기준 | **120항** — AC-NN (정본 [03_requirements/10_acceptance_criteria.md](./03_requirements/10_acceptance_criteria.md)) |
| 제품 결정 · 기술 결정 | **D 48건 · ADR 37건** (정본 [01_overview/06_design_decisions.md](./01_overview/06_design_decisions.md) · [04_architecture/08_decision_records.md](./04_architecture/08_decision_records.md)) |
| 화면 | **12본** — ROOM 3 · LOBBY 1 · SETUP 1 · 게임 6 · RESULT 1. 화면 내 요소 **13종** (정본 [08_screen/README.md](./08_screen/README.md)) |
| 테이블 | **6개** — rooms · participants · game_rounds · game_options · votes · game_results. 이름 집합 정본은 [06_database/README.md](./06_database/README.md) |
| REST · WebSocket | REST **8본**(+ 운영 1본) · WebSocket 이벤트 **31종**(C→S 12 · S→C 19) (정본 [07_api/README.md](./07_api/README.md)). 이벤트명은 콜론 표기(room:snapshot 형식)만 쓴다 |
| 에러 코드 | **42종 · 5네임스페이스**(room · member · game · vote · common). 전수 정본 [10_glossary/02_error_codes.md](./10_glossary/02_error_codes.md). 형식은 {namespace}.{snake_case} + HTTP 상태 |
| 반복 상한 | 동점 결선·동점자 재대결은 **최대 3회**. 3회에도 단독 승자가 없으면 방장이 선택한다 |
| 방 수명 | 방장 이탈 즉시 · 마지막 참가자 이탈 즉시 · **10분 무활동** 중 먼저 오는 것 |
| 배포 형상 | 프론트 Vercel · 백엔드 AWS EC2(FastAPI + WebSocket) · DB MySQL 8.4. **백엔드는 단일 인스턴스·워커 1개 고정** |
| 우선순위 | P0(핵심 경로 — 없으면 서비스 미성립) · P1(실사용 보완) · P2(선택·후속) |
| 구현 상태 | ⬜ 미착수 · 🔶 진행 중 · ✅ 완료. 기준은 frontend/ · backend/의 실제 코드다 |

## ID·표기 규약

| 종류 | 형식 | 예 | 채번 정본 |
|------|------|-----|-----------|
| 기능 ID | F-{접두사}-NN | F-LOBBY-03 | [02_features](./02_features/README.md)의 도메인 파일 |
| 요구사항 ID | REQ-{접두사}-NN | REQ-NUNCHI-02 | [03_requirements](./03_requirements/README.md)의 도메인 파일 |
| 화면 코드 | {도메인}-{의미} | LOBBY-MAIN | [08_screen/README.md](./08_screen/README.md) |
| 에러 코드 | {namespace}.{snake_case} + HTTP 상태 | room.not_found | [10_glossary/02_error_codes.md](./10_glossary/02_error_codes.md) |
| 제품 결정 | D-NN | D-07 | [01_overview/06_design_decisions.md](./01_overview/06_design_decisions.md) |
| 기술 결정 | ADR-NN | ADR-02 | [04_architecture/08_decision_records.md](./04_architecture/08_decision_records.md) |
| 인수 기준 | AC-NN | AC-03 | [03_requirements/10_acceptance_criteria.md](./03_requirements/10_acceptance_criteria.md) |
| 테이블·컬럼 | snake_case | game_rounds | [06_database](./06_database/README.md) |

새 ID는 각 정본 문서에서만 채번한다. 접두사별 01부터 연속 채번하며 **결번을 만들지 않는다.** 횡단 요구사항 접두사는 REQ-GLB(전역 규칙) · REQ-NFR(비기능) 2종이다. 구 스펙(docs_legacy)의 US-NNN · F-NNN 번호는 재사용하지 않으며 대응 관계는 [10_glossary/04_id_conventions.md](./10_glossary/04_id_conventions.md)의 매핑표에만 남긴다.

## 전역 불변식

| 항목 | 규칙 |
|------|------|
| 공정 | **결과는 서버가 확정한다.** 클라이언트는 이미 정해진 결과로 수렴하는 연출을 그릴 뿐이며, 화면·기기·네트워크 속도가 결과를 바꾸지 못한다 |
| 동시 | 전원이 같은 결과를 같은 순간에 본다. 먼저 아는 사람을 만들지 않는다 |
| 가벼움 | 로그인·회원가입·설치·개인정보 수집이 없다. 링크와 닉네임이면 참여가 끝난다 |
| 판정 기준 | 시간·순서 판정은 **서버 도착 시각**이다. 클라이언트 시계와 네트워크 지연은 판정 기준이 되지 않는다. **유일한 예외는 시간초 잡기의 경과 시간**이며, 클라이언트 단조 시계가 측정하고 서버가 자신이 관측한 START·STOP 도착 시각 차이로 허용 범위를 검증한다(범위 밖이면 거부). 예외의 근거는 [11_fairness/01_server_authority.md](./11_fairness/01_server_authority.md)에 둔다 |
| 멱등 | 같은 입력은 **최초 1회만** 인정한다. 이미 끝난 판·이전 라운드에 도착한 입력은 버린다 |
| 명단 스냅샷 | 게임이 시작되면 참가자 명단이 고정된다. 도중 이탈해도 후보에 남고 결과에도 표시된다. 방장 이탈만 예외다 |
| 재접속 | **불가하다.** 나갔다 들어오면 새 참가자이며 진행 중인 판에는 낄 수 없다. 끊긴 사람은 돌아올 수 없지만 후보로 남아 미입력 처리된다 |
| 미입력 | 입력하지 않은 참가자는 게임별 기본값으로 자동 처리한다. 한 명 때문에 판이 멈추지 않는다 |
| 방장 | 권한은 다른 참가자에게 **넘어가지 않는다.** 방장이 나가면 방이 삭제되고 진행 중이던 판은 결과 없이 끝난다 |
| 시작 조건 | **방장을 제외한 참가자 전원**이 준비 완료여야 방장이 시작할 수 있다. 방장은 준비 상태를 갖지 않는다 |
| 반복 종료 | 동점 결선·재대결은 **최대 3회**다. 3회에도 단독 승자가 없으면 방장이 다음 동작을 고른다. **종료가 보장되지 않는 반복 규칙을 두지 않는다** |
| 중간 집계 | 투표·입력이 진행되는 동안 중간 집계를 **아무에게도** 보여주지 않는다. 완료/대기 상태만 보인다 |
| 익명 | 킹메이커 제출자와 익명 저격 지목자는 방장 설정이 공개로 되어 있을 때만, 그것도 개표 후에만 드러난다. 서버가 가진 식별 정보는 그 외 경로로 클라이언트에 내려가지 않는다 |
| 상태 경계 | **진행 중 상태**(라운드 phase · 입력 도착 시각 · 판정창 그룹핑 · 생존자 명단 · 소켓 연결 · 준비 상태)는 서버 인메모리에 둔다. **방·참가자·라운드·선택지·투표·확정 결과**는 MySQL에 기록한다. 밀리초 판정 경로에 DB 왕복을 넣지 않는다 |
| 인스턴스 | 백엔드는 **단일 인스턴스·워커 1개**다. 방 상태가 프로세스 메모리에 있으므로 수평 확장과 무중단 배포를 하지 않는다 |
| 데이터 수명 | 방이 사라지면 참가자·결과·시드가 함께 삭제된다. 채팅은 서버에 저장하지 않고 각자 브라우저에 보관한다 |
| 개인정보 | 이메일·전화번호·계정을 수집하지 않는다. 닉네임·아바타·소개 태그만 방 수명 동안 보관한다 |
| 시각 | 저장은 UTC, 표시는 사용자 시간대. 게임 판정 시간은 부동소수점이 아니라 **정수 밀리초**로 기록한다 |

상세 정의는 [10_glossary](./10_glossary/README.md)에 둔다.

## 문서 작성 규약

세부 작업 규약은 [CLAUDE.md](./CLAUDE.md)를 따른다. 핵심만 적는다.

- 폴더 인덱스 파일명은 **README.md**. 세부 파일은 NN_snake_case.md 번호 접두.
- 코드·식별자·경로·테이블/컬럼명은 평문 또는 굵게로 표기한다 — **인라인 백틱은 사용하지 않는다**(펜스 코드 블록은 허용).
- 각 문서는 **필요한 정보만 간결·구조적으로** 담는다. 표·목록 우선, 중복·과설명 배제, 열거 구분자는 가운뎃점( · ).
- 문서 간 링크는 상대경로만. 구현 근거는 저장소 경로(frontend/src/... · docs_legacy/...)를 평문으로 표기해 인용한다.
- **05_game_rules의 게임별 문서는 상태머신·판정 의사코드·종료 증명·경계값 표·인수 기준을 전부 담는다.** 하나라도 빠지면 미완성이다.
