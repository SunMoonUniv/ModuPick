# 팀 구성 · 문서 소유자

> 최종 수정: 2026-07-26
> ⚠️ **이 문서에는 확인이 필요한 항목이 있다.** §1의 "확인 필요" 표시를 채워 주세요.

---

## 1. 팀 구성 (6명)

| 이름 | 역할 | 근거 |
|---|---|---|
| 이연주 | **백엔드** | `legacy/api.md:272` · `:339` — "백엔드(이연주, 원세찬)" |
| 원세찬 | **백엔드** | `legacy/api.md:272` · `:339` — 위와 동일 |
| 문석용 | **프론트엔드** | `legacy/api.md:272` · `:339` — "프론트(문석용)" |
| 김효성 | ❓ **확인 필요** | `legacy/techstack.md:6` 담당자 명단에만 등장 |
| 서현석 | ❓ **확인 필요** | `legacy/techstack.md:6` 담당자 명단에만 등장 |
| 이도현 | ❓ **확인 필요** | `legacy/api.md:6` 담당자 명단에만 등장 |

**직군 구분**은 `legacy/techstack.md:3`에 3개로 정의돼 있다 — `API/서비스로직/기획` · `DB/인프라` · `프론트`.
확정된 3명이 백엔드·프론트를 맡고 있으므로, 나머지 3명이 **DB/인프라와 기획**을 나눠 맡는 구조로 보이나 근거 문서가 없다.

> **원본 문서의 명단 불일치**
> `legacy/techstack.md:6`은 「연주 이, 원세찬, 문석용, 김효성, 서현석」 5명,
> `legacy/api.md:6`은 「연주 이, 문석용, 원세찬, 이도현」 4명을 담당자로 적고 있다.
> 두 명단의 합집합이 6명이고, 이전 공수 산정 기록(`../../.omc/progress.txt`, "6명×3.5주×10h")과 인원이 일치한다.
> "연주 이"와 "이연주"는 Notion 표기 방식 차이로 같은 사람이다.

---

## 2. 문서 소유자

각 문서에 **책임자 1명**을 둔다. 소유자 외의 변경은 소유자 리뷰를 거친다.
아래는 §1의 확정 역할에 근거한 **제안**이며, 미확정 역할이 정해지면 채운다.

| 문서 | 소유자(제안) | 근거 |
|---|---|---|
| [`01_overview/00_product.md`](01_overview/00_product.md) | 기획 담당 ❓ | 제품 정의는 기획 직군 |
| [`04_requirements/00_user_flow.md`](04_requirements/00_user_flow.md) | 기획 담당 ❓ | |
| [`04_requirements/01_screen_map.md`](04_requirements/01_screen_map.md) | **문석용**(프론트) | 화면 ID를 가장 많이 참조하는 직군 |
| [`05_game_rules/00_common.md`](05_game_rules/00_common.md) | 기획 담당 ❓ | |
| [`07_design/00_foundation.md`](07_design/00_foundation.md) | 디자인 담당 ❓ | |
| [`03_architecture/00_tech_stack.md`](03_architecture/00_tech_stack.md) | **원세찬**(백엔드) | |
| [`03_architecture/01_data_model.md`](03_architecture/01_data_model.md) | DB/인프라 담당 ❓ | `legacy/techstack.md:9` 후속 작업 "DB 모델링 / DB 구성" |
| [`06_api/01_rest.md`](06_api/01_rest.md) | **이연주**(백엔드) | `legacy/api.md:339` REST 확정 담당 |
| [`06_api/02_socket.md`](06_api/02_socket.md) | **원세찬**(백엔드) · **문석용**(프론트) 공동 | `legacy/api.md:339` "프론트(문석용) / 백엔드(이연주, 원세찬) 검토 후 확정" |
| [`06_api/03_error_codes.md`](06_api/03_error_codes.md) | **이연주**(백엔드) | REST·소켓 공용이므로 REST 소유자에 붙임 |
| [DECISIONS.md](DECISIONS.md) | **전원 합의** | 스펙 결정의 단일 출처 |
| TEAM.md (이 문서) | **전원 합의** | |

---

## 3. 문서 변경 규칙

1. **스펙을 바꾸려면 [DECISIONS.md](DECISIONS.md)를 먼저 고친다.** 결정 번호(`D-xx`)를 새로 붙이거나 기존 항목의 상태를 바꾼 뒤, 영향받는 문서를 수정한다.
2. 결정 없이 개별 문서만 고치면 **다시 문서 간 모순이 생긴다.** 2026-07-25 이전 상태가 정확히 그랬다.
3. 수정 후 반드시 정합성 검증을 돌린다.

   ```bash
   cd ModuPick && ./docs/check-docs.sh
   ```

4. 화면을 새로 만들면 [`04_requirements/01_screen_map.md`](04_requirements/01_screen_map.md)에 ID를 먼저 등록한다. 등록되지 않은 ID를 다른 문서에서 쓰면 검증에 실패한다.

---

## 4. 정본 위치

| 종류 | 정본 | 비고 |
|---|---|---|
| 스펙 문서 | **이 저장소의 `docs/`** | 2026-07-25 결정 |
| 디자인 | **Figma `xXFnM0pydDOcK12CS10X9l`** | [D-31](DECISIONS.md#d-31) |
| 일정·태스크 | Notion | `legacy/techstack.md:9`의 후속 작업 링크 |
| 구 스펙 문서 | `legacy/` (폐기, 근거 추적용 보존) | |

Notion에 남아 있는 스펙 페이지(기술 스택 · API 명세 등)는 **폐기**다.
각 페이지 최상단에 아래 배너를 추가해 주세요.

```
⚠️ 이 페이지는 폐기되었습니다. 정본: github.com/SunMoonUniv/ModuPick → docs/
```
