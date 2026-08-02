# 01_overview — 제품 개요

> **대상**: ModuPick(모두픽) — 링크 하나로 모여 미니게임 6종으로 팀장·역할·안건을 정하는 실시간 팀 의사결정 웹 서비스
> **작성일**: 2026-08-02
> **원천**: [../README.md](../README.md)(고정 기준·전역 불변식) · [06_design_decisions.md](./06_design_decisions.md)(확정 제품 결정 D-01~48) · docs_legacy/requirements.md §1·§2·§6·§7·§8 · frontend/src · backend/app

신규 합류자와 평가자가 가장 먼저 읽는 폴더다. 제품이 무엇이고 누구를 위한 것이며 어떤 근거로 이렇게 설계됐는지 맥락을 잡는다. 여기서 맥락을 잡은 뒤 [../09_tech_stack](../09_tech_stack/README.md) → [../04_architecture](../04_architecture/README.md) → [../02_features](../02_features/README.md) 순으로 넘어간다.

본 폴더는 **제품 결정 D-NN의 채번 정본**이다. 기술 차원 결정(ADR)은 [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md)가 채번하며 본 폴더는 그것을 인용만 한다.

ModuPick은 **아직 구현되지 않았다.** 본 폴더를 포함한 docs/ 전체는 앞으로 무엇을 만들 것인가를 확정해 기술하는 **설계 정본(to-be)** 이며 진행 상태 보고서가 아니다. 프로토타입의 구현 현황과 명세와 어긋난 지점은 [05_priorities_roadmap.md](./05_priorities_roadmap.md)에만 등재한다.

## 파일 목차

| 파일 | 내용 |
|------|------|
| [01_product_summary.md](./01_product_summary.md) | 제품 정의·해결하는 문제·3원칙(공정·동시·가벼움)·핵심 사용 흐름·미니게임 6종 개요 |
| [02_goals_scope.md](./02_goals_scope.md) | 목표·MVP 범위·**범위 밖**(범위 밖 항목의 유일한 등재처)·성공 기준 |
| [03_personas_roles.md](./03_personas_roles.md) | 사용 맥락 3종·역할 2종(방장·참가자)의 권한과 책임·**방장 권한 비이양 원칙** |
| [04_domain_map.md](./04_domain_map.md) | 도메인 12개 지도·접두사 대응·도메인 간 흐름도 |
| [05_priorities_roadmap.md](./05_priorities_roadmap.md) | 우선순위 정의(P0·P1·P2)·구현 현황·**구현 정정 목록**·잔여 작업과 착수 순서 |
| [06_design_decisions.md](./06_design_decisions.md) | **확정 제품 결정 D-01~48의 채번 정본**·구 Q-01~05 처리·폐기된 설계·구 D 번호 대응표 |

## 한눈에 보는 제품

| 항목 | 값 |
|------|-----|
| 한 줄 정의 | 모두가 납득하는 유쾌한 선택 — 팀 의사결정을 실시간 미니게임으로 |
| 쓰이는 자리 | 조별 과제 · 스터디 · 사내 TF |
| 정하는 것 | 팀장·발표자 등 사람 1인 · 전원 역할 배정 · 팀명·안건 1개 |
| 3원칙 | 공정(결과는 서버가 확정한다) · 동시(전원이 같은 순간에 본다) · 가벼움(링크와 닉네임이면 끝난다) |
| 역할 | **2종** — 방장(HOST) · 참가자(MEMBER). 방장도 참가자에 포함되며 권한은 이양되지 않는다 |
| 미니게임 | **6종** — 운명의 룰렛 · 사다리타기 · 킹메이커 · 시간초 잡기 · 익명 저격 · 눈치게임 |
| 방 정원 | **2~10명**. 방 생성 시 확정하며 이후 변경할 수 없다 |
| 확정 제품 결정 | **D-01~48**. 미확정 항목은 남기지 않는다 |
| 현재 상태 | frontend 프로토타입 🔶(봇 시뮬레이션) · backend 골격 ⬜ · DB ⬜ |

## 폴더가 확정하는 것

| 항목 | 이 폴더의 역할 |
|------|----------------|
| 제품 결정 D-NN | **채번 정본**이다. 다른 폴더는 D-NN을 인용만 한다 |
| 범위 밖 항목 | [02_goals_scope.md](./02_goals_scope.md)가 **유일한 등재처**다. 다른 문서는 부정형 언급만 한다 |
| 구현 정정 목록 | [05_priorities_roadmap.md](./05_priorities_roadmap.md)가 **유일한 등재처**다. 문서를 구현에 맞추지 않는다 |
| 역할 권한 모델 | [03_personas_roles.md](./03_personas_roles.md)가 방장·참가자 권한의 정본이다. 기능 단위 매트릭스는 [../02_features](../02_features/README.md)가 잇는다 |
| 도메인 경계 | [04_domain_map.md](./04_domain_map.md)가 12도메인과 접두사 대응을 싣는다. 매핑 정본은 [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md)다 |

**이 폴더가 확정하지 않는 것** — 기능 수·요구사항 수·화면 수·에러 코드는 각 정본 폴더가 확정하며 본 폴더는 인용만 한다. 기술 결정(프레임워크·저장 아키텍처·배포 형상·프로토콜)은 ADR이며 [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md)가 채번한다.

## 관련 문서

- [../README.md](../README.md) — 문서 지도·읽는 순서·고정 기준·전역 불변식
- [../CLAUDE.md](../CLAUDE.md) — 작성 규약·범위 규약
- [../02_features/README.md](../02_features/README.md) — 기능 채번 정본
- [../05_game_rules/README.md](../05_game_rules/README.md) — 게임 6종 상세 규칙·종료 증명
- [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md) — 기술 결정 ADR 채번 정본
- [../11_fairness/README.md](../11_fairness/README.md) — 공정성·익명성 구현 정본
- [../10_glossary/04_id_conventions.md](../10_glossary/04_id_conventions.md) — ID 규약·구 ID 매핑
