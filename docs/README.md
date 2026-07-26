# ModuPick 문서

> **이 디렉터리가 ModuPick 스펙의 정본이다.** Notion에 남아 있는 스펙 페이지는 폐기됐다.
> 최종 수정: 2026-07-26

---

## ⚠️ 지금 막혀 있는 것

[`DECISIONS.md`](DECISIONS.md)에 **승인 대기 6건**이 있다. 결정 기한 **2026-08-02**, 미결 시 각 항목의 기본안으로 진행한다.

| 결정 | 무엇이 걸려 있나 |
|---|---|
| [D-03](DECISIONS.md#d-03) 방 만료 정의 | 방 수명 · 정리 로직 |
| [D-04](DECISIONS.md#d-04) 재접속 정책 | **새로고침 시 방에서 빠짐** — UX 리스크 |
| [D-06](DECISIONS.md#d-06) 데이터 저장 | 인프라 구성 · K8s replica 수 · Redis 도입 여부 |
| [D-10](DECISIONS.md#d-10) 가이드 팝업 `✕` | 게임 시작 UX |
| [D-19](DECISIONS.md#d-19) 킹메이커 투표 수 | 투표 UI·API 구조 |
| [D-24](DECISIONS.md#d-24) 시간초 시작 방식 | **Figma 시안 재작업 발생 여부** |

**구현 착수 전에 [`DECISIONS.md`](DECISIONS.md)를 반드시 읽는다.** 확정 전까지 해당 영역 구현이 뒤집힐 수 있다.

---

## 무엇을 알고 싶으면 어디를 보는가

| 질문 | 문서 |
|---|---|
| 이 제품이 뭘 하는 건가? 무엇을 만들고 무엇을 안 만드나? | [`01_overview/00_product.md`](01_overview/00_product.md) |
| 경쟁 서비스는? 왜 이 차별점인가? | [`01_overview/01_research.md`](01_overview/01_research.md) |
| 코드가 어느 디렉터리에 있나? | [`02_file_structure/00_repository.md`](02_file_structure/00_repository.md) ⚠️ |
| 무슨 언어·프레임워크·인프라를 쓰나? | [`03_architecture/00_tech_stack.md`](03_architecture/00_tech_stack.md) |
| 이 데이터는 어디 저장되나? 언제 사라지나? | [`03_architecture/01_data_model.md`](03_architecture/01_data_model.md) |
| 사용자가 화면에서 뭘 할 수 있나? | [`04_requirements/00_user_flow.md`](04_requirements/00_user_flow.md) |
| "대기방 화면"을 문서에서 뭐라고 불러야 하나? | [`04_requirements/01_screen_map.md`](04_requirements/01_screen_map.md) |
| 이 게임은 누가 이기나? 동점이면? | [`05_game_rules/00_common.md`](05_game_rules/00_common.md) |
| 응답 형식·에러 코드는? | [`06_api/00_conventions.md`](06_api/00_conventions.md) · [`06_api/03_error_codes.md`](06_api/03_error_codes.md) |
| 방 만들 때 어떤 API를 호출하나? | [`06_api/01_rest.md`](06_api/01_rest.md) |
| 게임 중에 어떤 소켓 이벤트가 오가나? | [`06_api/02_socket.md`](06_api/02_socket.md) |
| 이 버튼 몇 px인가? 무슨 색인가? | [`07_design/00_foundation.md`](07_design/00_foundation.md) |
| 이 화면 레이아웃 규격은? | [`07_design/03_screens.md`](07_design/03_screens.md) |
| 로컬에서 어떻게 띄우나? | [`08_development/00_setup.md`](08_development/00_setup.md) ⚠️ |
| 어떻게 배포하나? | [`09_deployment/00_overview.md`](09_deployment/00_overview.md) ⚠️ |
| 무엇을 테스트해야 하나? | [`10_testing/00_strategy.md`](10_testing/00_strategy.md) ⚠️ |
| **왜 이렇게 정했나? 이거 바꿔도 되나?** | [`DECISIONS.md`](DECISIONS.md) ★ |
| 이 문서는 누가 책임지나? | [`TEAM.md`](TEAM.md) |

⚠️ = 아직 채우지 않은 스텁. 무엇을 언제 쓸지는 문서 안에 적혀 있다.

---

## 읽는 순서

**처음 합류했다면** — `01_overview` → `04_requirements` → 자기 직군 폴더

| 직군 | 순서 |
|---|---|
| 프론트엔드 | `04_requirements/01_screen_map` → `07_design` → `06_api/02_socket` → `06_api/01_rest` |
| 백엔드 | `03_architecture` → `06_api` → `05_game_rules` |
| 기획 | `01_overview` → `04_requirements/00_user_flow` → `05_game_rules` → `DECISIONS` |
| 디자인 | `04_requirements/01_screen_map` → `07_design` → `04_requirements/00_user_flow` |

---

## 폴더 구조

전 문서 링크 목록이다. **⚠️ = 아직 채우지 않은 스텁.**

**`01_overview/`** — 제품
- [`00_product.md`](01_overview/00_product.md) — 정의 · 문제 · 차별점 · 타겟 · 범위 · 지표 · 리스크
- [`01_research.md`](01_overview/01_research.md) — 경쟁 분석 · 근거 자료 (원본 유실 · 재작성 필요)

**`02_file_structure/`** — 저장소 · 코드 구조
- [`00_repository.md`](02_file_structure/00_repository.md) — ⚠️ 스캐폴딩 후 작성

**`03_architecture/`** — 시스템 아키텍처
- [`00_tech_stack.md`](03_architecture/00_tech_stack.md) — 스택 선택 + 결정 근거 + 인프라 제약
- [`01_data_model.md`](03_architecture/01_data_model.md) — 저장 계층 3분류 · 엔티티 · 생명주기

**`04_requirements/`** — 요구사항 · 화면
- [`00_user_flow.md`](04_requirements/00_user_flow.md) — 화면별 사용자 동작
- [`01_screen_map.md`](04_requirements/01_screen_map.md) — 화면 ID 정본 + 구 체계 매핑 + 전이도

**`05_game_rules/`** — 게임 규칙 6종
- [`00_common.md`](05_game_rules/00_common.md) — 공통 진행 · 설정 요약 · 동점/전원탈락 처리
- [`01_roulette.md`](05_game_rules/01_roulette.md) — 운명의 룰렛 `S-05`
- [`02_ladder.md`](05_game_rules/02_ladder.md) — 랜덤 사다리 `S-06`
- [`03_kingmaker.md`](05_game_rules/03_kingmaker.md) — 킹메이커 `S-07`
- [`04_timer.md`](05_game_rules/04_timer.md) — 시간초 잡기 `S-08`
- [`05_snipe.md`](05_game_rules/05_snipe.md) — 익명 저격 `S-09`
- [`06_nunchi.md`](05_game_rules/06_nunchi.md) — 눈치게임 `S-10`

**`06_api/`** — API 명세
- [`00_conventions.md`](06_api/00_conventions.md) — 공통 응답 객체 · 규칙
- [`01_rest.md`](06_api/01_rest.md) — REST 8개 엔드포인트
- [`02_socket.md`](06_api/02_socket.md) — WebSocket 이벤트 · 수명주기
- [`03_error_codes.md`](06_api/03_error_codes.md) — 에러 코드 (REST·소켓 공용)

**`07_design/`** — 디자인 시스템
- [`00_foundation.md`](07_design/00_foundation.md) — 전제 · 폰트 · 타입 스케일 · 팔레트 · 그리드
- [`01_components.md`](07_design/01_components.md) — 카드 · 칩 · 버튼 · 아바타
- [`02_content_rules.md`](07_design/02_content_rules.md) — 콘텐츠·데이터 규칙 + 카피 톤
- [`03_screens.md`](07_design/03_screens.md) — 화면별 규격 + 결과 4변형
- [`04_figma.md`](07_design/04_figma.md) — 제작 규칙 · 반영 대기 7건
- [`05_checklist.md`](07_design/05_checklist.md) — 완성 전 확인 목록

**`08_development/`** — 개발 환경 · 컨벤션
- [`00_setup.md`](08_development/00_setup.md) — ⚠️ 첫 로컬 실행 후 작성

**`09_deployment/`** — 배포 · 인프라 · 운영
- [`00_overview.md`](09_deployment/00_overview.md) — ⚠️ 첫 배포 전 작성

**`10_testing/`** — 테스트 전략
- [`00_strategy.md`](10_testing/00_strategy.md) — ⚠️ 첫 기능 구현과 동시 작성

**루트 (메타 문서)**
- [`DECISIONS.md`](DECISIONS.md) — ★ 결정 로그. 스펙 변경은 여기부터
- [`TEAM.md`](TEAM.md) — 팀 구성 · 문서 소유자 · 변경 규칙
- `check-docs.sh` — 정합성 회귀 검증

> `DECISIONS.md`와 `TEAM.md`는 특정 카테고리에 속하지 않고 **전 문서를 가로지르는 메타 문서**라 루트에 둔다.

---


## 문서를 고칠 때

1. **[`DECISIONS.md`](DECISIONS.md)를 먼저 고친다.** 결정 없이 개별 문서만 바꾸면 다시 모순이 생긴다.
2. 각 결정 항목의 "영향" 목록에 적힌 문서를 수정한다.
3. 검증을 돌린다.

   ```bash
   ./docs/check-docs.sh
   ```

4. 새 화면을 만들면 [`04_requirements/01_screen_map.md`](04_requirements/01_screen_map.md)에 ID를 먼저 등록한다.
   등록되지 않은 ID를 쓰면 검증에 실패한다.

자세한 규칙은 [`TEAM.md`](TEAM.md) §3.

---

## 이 구조가 된 배경

2026-07-25 이전에는 스펙이 저장소 루트의 6개 파일(`README.md` · `document.md` · `techstack.md` · `games.md` · `design.md` · `api.md`, 총 1,579줄)에 흩어져 있었고, Notion 내보내기·초안·수정본이 한 파일 안에 뒤섞여 있었다.

전수 대조 결과 **구현 즉시 깨지는 충돌 4건 · 기능 스펙 충돌 12건 · 문서 구조 결함 10건**이 확인됐다. 대표적으로,

- 초대코드가 한쪽은 4자리, 다른 쪽은 6자리였다
- 재접속 정책이 문서 4곳에서 서로 달랐다 (있음 / 없음 / 새로고침해도 유지)
- 데이터를 어디에 저장하는지 정의한 문서가 아예 없었다 ("DB 없음" ↔ "PostgreSQL")
- 킹메이커 투표를 멤버 ID로 받게 돼 있어 익명성이 구조적으로 붕괴하는 상태였다
- 같은 화면을 4가지 이름 체계로 부르면서 매핑표가 없었고, `S-04P`는 한 파일 안에서 "방장"과 "참여자" 양쪽 뜻으로 쓰였다

문서마다 역할을 하나씩만 주고, 결정과 근거를 [`DECISIONS.md`](DECISIONS.md) 한 곳에 모으고,
화면 이름을 [`04_requirements/01_screen_map.md`](04_requirements/01_screen_map.md)로 통일해 재발을 막는 것이 이 구조의 목적이다.

**구 문서는 `legacy/`에 로컬 보관 중이다.** `.gitignore` 처리돼 저장소에는 올라가지 않는다.
`DECISIONS.md`의 근거 인용 129건이 `legacy/파일:줄번호`를 가리키므로, 로컬에서 삭제하면 근거 추적이 끊긴다.
