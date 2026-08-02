# 10_glossary — 용어·코드 사전

> **대상**: ModuPick 전 문서의 단일 참조점 — 도메인 용어 · 에러 코드 · enum과 상태 머신 · ID 규약 · 단위와 시간
> **작성일**: 2026-08-02
> **원천**: [../README.md](../README.md)(고정 기준·전역 불변식) · [../CLAUDE.md](../CLAUDE.md)(작성 규약) · 본 폴더 5문서

**용어·코드·ID가 막히면 여기를 본다.** 다른 폴더는 자기 도메인의 규칙을 소유하고, 그 규칙을 적을 때 쓰는 **말과 식별자**는 본 폴더가 소유한다. 같은 것을 문서마다 다르게 부르면 규칙이 어긋나므로 정의는 여기서만 단일하게 유지하고 다른 문서는 다시 정의하지 않고 링크한다. 값이 문서 간 어긋나면 본 사전이 이긴다.

## 파일 목차

| 파일 | 무엇의 정본인가 | 담는 것 |
|------|----------------|---------|
| [01_domain_terms.md](./01_domain_terms.md) | **도메인 용어 정본** | 방·참가자·방장·라운드·명단 스냅샷·서버 도착 시각·판정창·안전 확정·잔류·기권·미입력·결선·재대결·교착 해소·이탈·방 폐기 6그룹 + **쓰지 않는 말** 목록 |
| [02_error_codes.md](./02_error_codes.md) | **에러 코드 채번·전수 정본** | {namespace}.{snake_case} 코드 **42종 · 5네임스페이스** 전수 + HTTP 상태 규약 · 네임스페이스 배정 규칙 · 사용자 문안 · 발생 지점 · 소켓 종료 코드 대응 |
| [03_enums_state_machines.md](./03_enums_state_machines.md) | 색인(정본 아님) | 값 집합 **31종 · 라벨 132개**와 상태 머신 **6본**의 소재 색인 + 세는 기준 · 게임 ID와 접두사 대응 · 내부 phase ↔ 와이어 phase 대응 |
| [04_id_conventions.md](./04_id_conventions.md) | **ID 형식·채번 규약 정본** | F-ID · REQ-ID · 화면 코드 · 에러 코드 형식 · D-NN · ADR-NN · AC-NN · 테이블/컬럼 · 마이그레이션 + 기능 접두사 12종 · 구 스펙 ID 매핑 |
| [05_units_and_time.md](./05_units_and_time.md) | **단위·시각 표준 정본** | 시각 표준(UTC 저장·단조 시계 판정) · 시간 정밀도(정수 밀리초) · 게임별 판정 기준 시각 · 시간초 잡기의 예외 · 길이와 개수 상한 · 표시 규약 |

**본 폴더에서 채번하는 것은 에러 코드 하나다.** F-ID · REQ-ID · 화면 코드 · D-NN · ADR-NN · AC-NN은 각 정본 문서가 채번하며 [04_id_conventions.md](./04_id_conventions.md)는 **형식만** 규정한다.

## 이 사전이 확정하는 값

| 항목 | 값 | 정본 |
|------|-----|------|
| 에러 코드 | **42종 · 5네임스페이스** — room 6 · member 10 · game 13 · vote 4 · common 9 | [02_error_codes.md](./02_error_codes.md) |
| 값 집합(enum) | **31종 · 라벨 132개** | [03_enums_state_machines.md](./03_enums_state_machines.md)가 세되 각 값의 정본은 06_database · 07_api · 05_game_rules다 |
| 상태 머신 | **6본** — 방 상태 · 참가자 수명주기 · 연결 상태 · 라운드 영속 상태 · 와이어 단계 · 게임별 내부 phase 6종 | 전이 규칙은 각 정본 문서가 소유한다 |
| ID 형식 | **9종** — 기능 · 요구사항 · 화면 · 에러 · 제품 결정 · 기술 결정 · 인수 기준 · 테이블/컬럼 · 마이그레이션 | [04_id_conventions.md](./04_id_conventions.md) |
| 기능 접두사 | **12종** — ROOM · LOBBY · SETUP · PLAY · WHEEL · LADDER · KING · TIMER · SNIPE · NUNCHI · RESULT · CMN | [04_id_conventions.md](./04_id_conventions.md) |

**enum 31종은 본 폴더가 만든 값이 아니라 센 값이다.** 값 자체는 [../06_database/05_constraints_integrity.md](../06_database/05_constraints_integrity.md) · [../07_api/03_socket_events.md](../07_api/03_socket_events.md) · [../05_game_rules](../05_game_rules/README.md)가 확정하고, 본 폴더는 흩어진 것을 한 곳에서 찾을 수 있게 모아 세는 기준을 밝힌다.

## 다른 폴더에서 인용하는 값

본 폴더가 정의를 담되 수치의 정본은 다른 폴더인 항목이다. 값이 바뀌면 정본 문서를 고치고 본 폴더는 인용을 갱신한다.

| 항목 | 값 | 정본 |
|------|-----|------|
| 미니게임 | **6종** · gameId는 roulette · ladder · kingmaker · timer · snipe · nunchi | [../05_game_rules/README.md](../05_game_rules/README.md) |
| 테이블 | **6개** · 값 집합 축 6종 · 라벨 22개 | [../06_database/README.md](../06_database/README.md) |
| WebSocket 이벤트 | **C→S 12종 · S→C 19종**(합 31) · game:action type 8종 · 종료 코드 8종 | [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| REST 엔드포인트 | **제품 8본 · 운영 1본** | [../07_api/02_rest.md](../07_api/02_rest.md) |
| 방장 설정 항목 | **16개**(그중 값 집합을 갖는 것 6개) | [../07_api/03_socket_events.md](../07_api/03_socket_events.md)의 configSchema |
| 결과 화면 형태 | **4종** — 승자형 · 배정형 · 개표형 · 기록형 | [../02_features/06_result.md](../02_features/06_result.md) |
| 방 정원 · 아바타 · 반복 상한 | 2~10명 · 30종 · 3회 | [../README.md](../README.md)의 고정 기준 |

## 이 사전의 원칙

- **중복 정의 금지** — 용어·코드·식별자의 정의는 본 폴더에만 둔다. 다른 문서는 정의를 다시 쓰지 않고 링크한다.
- **에러 코드는 여기서만 채번한다** — 도메인 문서는 자기가 쓰는 코드를 등재하고, 전수·최종 판정은 [02_error_codes.md](./02_error_codes.md)가 한다. [../07_api/04_error_mapping.md](../07_api/04_error_mapping.md)는 후보를 제안할 뿐이며 어긋나면 사전이 이긴다.
- **발화하지 않는 코드를 등재하지 않는다** — 실제로 나갈 수 있는 표면이 없으면 계약에 올리지 않는다. 코드가 계약에 오르면 구현자는 없는 분기를 만들고 검수자는 재현되지 않는 항목을 붙든다.
- **개수를 쓰면 그 자리에서 세어 맞춘다** — 에러 코드도 enum도 산식으로 합을 보인다. 정본 한 줄을 고치고 집계를 두면 두 값이 조용히 갈라진다.
- **세는 기준이 둘이면 기준을 밝힌다** — 방 상태는 기능 구간 4개와 저장값 2개가 다르고, 라운드는 영속 status 4값과 인메모리 phase 4값이 다른 축이다. 두 값을 섞어 쓰지 않는다.
- **'탈락'을 쓰지 않는다** — 눈치게임에서 후보에서 빠지는 것이 유리하고 남는 것이 불리해 뜻이 뒤집혀 읽힌다. 빠지는 쪽은 **안전 확정**, 남는 쪽은 **잔류**로만 쓰며 코드 이름에도 쓰지 않는다.

## 읽는 순서

1. 말이 막히면 → [01_domain_terms.md](./01_domain_terms.md)
2. 실패 응답을 만들거나 화면 분기를 짜면 → [02_error_codes.md](./02_error_codes.md)
3. 상태값·설정값이 무엇무엇인지 찾으면 → [03_enums_state_machines.md](./03_enums_state_machines.md) → 거기가 가리키는 정본
4. 새 식별자를 붙이면 → [04_id_conventions.md](./04_id_conventions.md) → 해당 채번 정본
5. 시간·길이를 다루면 → [05_units_and_time.md](./05_units_and_time.md)

## 관련 문서

- [../README.md](../README.md) — 문서 지도·고정 기준·전역 불변식
- [../CLAUDE.md](../CLAUDE.md) — 작성 규약
- [../02_features/README.md](../02_features/README.md) — 기능 ID 채번 정본
- [../05_game_rules/README.md](../05_game_rules/README.md) — 게임 규칙·상태 머신 정본
- [../06_database/README.md](../06_database/README.md) — 스키마·제약·값 집합 정본
- [../07_api/README.md](../07_api/README.md) — API 표면·에러 매핑
- [../08_screen/README.md](../08_screen/README.md) — 화면 인벤토리·오류 안내 화면
