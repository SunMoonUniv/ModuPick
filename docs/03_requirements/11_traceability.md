# 추적성 — REQ ↔ 기능 ↔ 화면 ↔ 테이블

> **대상**: 요구사항 193항의 도메인별 추적 관계 · 구 스펙 ID 대응표 · 커버리지 판정
> **작성일**: 2026-08-02
> **원천**: [README.md](./README.md)(REQ 193 · AC 120 채번 정본) · [../02_features/README.md](../02_features/README.md)(기능 121 채번 정본) · [../08_screen/README.md](../08_screen/README.md)(화면 12본) · [../06_database/README.md](../06_database/README.md)(테이블 6) · docs_legacy/requirements.md(구 US·G·NFR)

요구사항이 **무엇으로 구현되고 어디에 나타나며 무엇에 저장되는가**를 잇는다. 매핑이 비어 있는 요구사항은 구현할 근거가 없거나 표면이 빠진 것이므로, 본 문서의 목적은 그 구멍을 0으로 유지하는 것이다. 각 ID는 자기 정본이 채번하고 **본 문서는 잇기만 한다.**

기능ID → 화면코드의 상세 매핑은 [../08_screen/02_traceability.md](../08_screen/02_traceability.md)가 정본이며, 여기서는 그 축을 요구사항 쪽에서 되짚는다.

## 도메인별 추적

| 도메인 | REQ | 기능 접두사 | 표면 화면 | 관련 테이블 |
|--------|:---:|-------------|-----------|-------------|
| 방 만들기·입장 | REQ-ROOM **21** | F-ROOM 17 | ROOM-LANDING · ROOM-CREATE · ROOM-PROFILE | rooms · participants |
| 대기방 | REQ-LOBBY **17** | F-LOBBY 13 | LOBBY-MAIN | rooms · participants |
| 게임 선택·설정 | REQ-SETUP **16** | F-SETUP 13 | SETUP-GAME | game_rounds · game_options |
| 게임 진행 공통 | REQ-PLAY **15** | F-PLAY 12 | 게임 6종 공통 요소 | game_rounds · game_results |
| 운명의 룰렛 | REQ-WHEEL **7** | F-WHEEL 5 | WHEEL-PLAY | game_rounds · game_options · game_results |
| 사다리타기 | REQ-LADDER **9** | F-LADDER 7 | LADDER-PLAY | game_rounds · game_options · game_results |
| 킹메이커 | REQ-KING **14** | F-KING 9 | KING-PLAY · RESULT-MAIN(실명 공개) | game_rounds · game_options · votes · game_results |
| 시간초 잡기 | REQ-TIMER **14** | F-TIMER 9 | TIMER-PLAY | game_rounds · game_results |
| 익명 저격 | REQ-SNIPE **9** | F-SNIPE 8 | SNIPE-PLAY | game_rounds · game_options · votes · game_results |
| 눈치게임 | REQ-NUNCHI **10** | F-NUNCHI 9 | NUNCHI-PLAY | game_rounds · game_results |
| 결과·저장 | REQ-RESULT **10** | F-RESULT 9 | RESULT-MAIN | game_results · game_rounds |
| 공통·오류 | REQ-CMN **11** | F-CMN 10 | 전역(화면 코드 없음) | — |
| 전역 규칙 | REQ-GLB **24** | 횡단 — 전 접두사 | 전 화면 | 전 테이블 |
| 비기능 | REQ-NFR **16** | 횡단 — 전 접두사 | 전 화면 | 전 테이블 |

21 + 17 + 16 + 15 + 7 + 9 + 14 + 14 + 9 + 10 + 10 + 11 = **153**(도메인) · 24 + 16 = **40**(횡단) · 합 **193**이다.

**REQ 수와 기능 수가 다른 것은 정상이다.** 요구사항 하나가 기능 여럿을 요구하기도 하고(전역 규칙), 기능 하나가 요구사항 여럿을 만족시키기도 한다(공통 프레임). 두 수가 같아야 할 이유가 없으며 **매핑이 비어 있지 않은 것만이 조건**이다.

## 횡단 요구사항이 도메인에 걸리는 방식

REQ-GLB와 REQ-NFR은 특정 화면·테이블에 속하지 않고 전 도메인을 관통한다. 검증도 도메인별로 나눠 한다.

| 횡단 축 | 어디서 검증하는가 |
|---------|------------------|
| 서버 판정 권위 | 게임 6종 각각의 판정 알고리즘이 서버에서 도는지 — [../05_game_rules](../05_game_rules/README.md) 의사코드 |
| 입력 멱등·낡은 입력 폐기 | 게임 6종 각각의 (상태 × 이벤트) 전표 — [../04_architecture/05_room_state_machine.md](../04_architecture/05_room_state_machine.md) |
| 명단 스냅샷 고정 | 게임 시작 전이 · 이탈 처리 |
| 중간 집계 비공개 | 입력형 4종의 진행 상황 패널 — [../08_screen/05_game_screens.md](../08_screen/05_game_screens.md) |
| 반복 상한 3회 | 킹메이커·익명 저격·시간초의 종료 증명 |
| 실시간 반영·결과 동시성 | 소켓 이벤트 브로드캐스트 — [../07_api/03_socket_events.md](../07_api/03_socket_events.md) |
| 접근성·반응형 | 화면 12본 전부 — [../08_screen/01_standards.md](../08_screen/01_standards.md) §5 |
| 개인정보·데이터 수명 | 방 폐기 경로 4종 — [../11_fairness/04_privacy_data_lifecycle.md](../11_fairness/04_privacy_data_lifecycle.md) |

## 커버리지 판정

| 축 | 기준 | 결과 |
|----|------|------|
| REQ → 기능 | 모든 REQ가 관련 기능을 하나 이상 갖는다 | 미매핑 **0** |
| 기능 → 화면 | 모든 기능이 표면 화면을 갖는다(서버 전용은 결과가 나타나는 화면에 매핑) | 미매핑 **0** — 정본 [../08_screen/02_traceability.md](../08_screen/02_traceability.md) |
| REQ → AC | 검증이 필요한 REQ가 인수 기준을 갖는다 | 정본 [10_acceptance_criteria.md](./10_acceptance_criteria.md) |
| 에러 코드 → API 표면 | 사전의 42종이 전부 발생 지점을 갖는다 | 정본 [../10_glossary/02_error_codes.md](../10_glossary/02_error_codes.md) |

**기능 121건 중 화면 표면이 없는 것은 없다.** 서버 전용 기능도 그 결과가 드러나는 화면에 매핑한다 — 조작 표면이 없다는 것과 화면에 드러나지 않는다는 것은 다르다.

## 구 스펙 ID 대응

docs_legacy의 번호대 체계를 접두사 체계로 옮긴 결과다. 구 번호는 **재사용하지 않으며** 이 표는 과거 논의를 추적하기 위해서만 둔다.

| 구 ID | 구 건수 | 신 체계 | 비고 |
|-------|:------:|---------|------|
| US-1xx 방 만들기·입장 | 5 | REQ-ROOM | 21건으로 세분화 |
| US-2xx 대기방 | 6 | REQ-LOBBY | 17건으로 세분화(채팅 전 구간 허용 반영) |
| US-3xx 게임 선택·설정 | 7 | REQ-SETUP | 16건으로 세분화 |
| US-40x 게임 진행 공통 | 3 | REQ-PLAY | 15건으로 세분화 |
| US-41x~46x 게임별 | 12 | REQ-WHEEL·LADDER·KING·TIMER·SNIPE·NUNCHI | 게임별 접두사로 분화, 합 63건 |
| US-5xx 결과·저장 | 4 | REQ-RESULT | 10건으로 세분화 |
| US-6xx 공통·오류 | 2 | REQ-CMN | 11건으로 세분화 |
| G-1~16 게임 공통 규칙 | 16 | REQ-GLB | 24건으로 세분화 |
| NFR-01~10 비기능 | 10 | REQ-NFR | 16건으로 재정의·세분화 |
| D-01~40 설계 결정 | 40 | D-NN · ADR-NN | 제품 결정은 D(48건) · 기술 결정은 ADR(27건)로 분리 |
| Q-01~05 미확정 | 5 | D-NN | 전부 결정으로 승격. **미확정 항목을 남기지 않는다** |

**구 40항이 신 193항으로 늘어난 이유**는 범위가 커져서가 아니라 **검증 단위로 쪼갰기 때문**이다. 구 스펙의 사용자 스토리 하나가 Given/When/Then 여러 줄을 품고 있었고, 그 줄 하나하나가 독립적으로 검증 가능한 요구사항이므로 각각을 REQ로 채번했다. 검증할 수 없는 크기의 요구사항은 요구사항이 아니다.

**구 스펙에 없던 요구사항도 있다.** 연결 끊김 판정 기준 · 서버 재기동 시 방 정리 · 반복 상한 · 킹메이커 실효 투표 수 상한 · 접근성 최소선은 원천에 정의가 없어 본 문서군이 새로 확정했다. 근거는 [../01_overview/06_design_decisions.md](../01_overview/06_design_decisions.md)와 [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md)에 있다.

## 갱신 규약

기능·요구사항·화면·테이블·에러코드를 추가·변경하면 **같은 변경 단위에서** 본 문서와 [../08_screen/02_traceability.md](../08_screen/02_traceability.md)를 함께 갱신한다. 도메인별 추적 표의 수치는 각 정본에서 직접 센 파생값이므로 정본을 고치면 여기서 다시 센다.

## 관련 문서

- REQ·AC 채번 정본 → [README.md](./README.md)
- 기능 채번 정본 → [../02_features/README.md](../02_features/README.md)
- 기능ID → 화면코드 정본 → [../08_screen/02_traceability.md](../08_screen/02_traceability.md)
- 인수 기준 → [10_acceptance_criteria.md](./10_acceptance_criteria.md)
- ID 규약·구 ID 매핑 규약 → [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)
- 고정 기준·전역 불변식 → [../README.md](../README.md)
