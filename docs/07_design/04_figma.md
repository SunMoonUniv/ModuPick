# Figma 제작 규칙 · 반영 대기

> 화면 ID는 [`04_requirements/01_screen_map.md`](../04_requirements/01_screen_map.md), 게임 규칙은 [`05_game_rules/00_common.md`](../05_game_rules/00_common.md)를 따른다.
> 최종 수정: 2026-07-26 · 소유자: [`TEAM.md`](../TEAM.md) 참조

---

아래는 **문서상 확정됐으나 Figma 시안에 아직 반영되지 않은** 항목이다.
반영 전까지 시안과 문서가 어긋난 상태이므로, **구현은 이 문서를 따른다.**

| # | 항목 | 대상 시안 | 필요한 작업 | 근거 |
|---|---|---|---|---|
| 1 | 시간초 대기 화면 · `[▶ START!]` 버튼 폐기 | 초안 `857:7` | **화면 삭제** 또는 카운트다운 화면으로 교체. `M-01` 시간초 가이드 ① 스텝 문구도 수정 | [D-24](../DECISIONS.md#d-24) ⚠️ 승인 대기 |
| 2 | 아바타 8개×2페이지 → 15개 5×3 한 화면 | `1091:7` · 초안 `539:576` | 그리드 재구성, 좌우 페이징 컨트롤 제거 | [D-08](../DECISIONS.md#d-08) |
| 3 | `🎲 랜덤 뽑기` 버튼 제거 | `1091:7` · 초안 `539:576` | 버튼 삭제 후 레이아웃 재정렬 | [D-09](../DECISIONS.md#d-09) |
| 4 | 눈치게임 `종료 방식` 설정 컨트롤 신설 | `S-04-HOST` 설정 패널 | 라디오/토글 2択 추가 | [D-25](../DECISIONS.md#d-25) |
| 5 | 확인 모달 3종 신규 제작 | — | `M-05` · `M-06` · `M-07` [`03_screens.md`](03_screens.md) 규격대로 제작 | [`04_requirements/01_screen_map.md`](../04_requirements/01_screen_map.md) §3.4 |
| 6 | 좌표 체계 `y144/y938` → `y159/y932` | 규격 시트 `1033:7` 전 장 | 전 장 METRICS 재검산 | [D-30](../DECISIONS.md#d-30) |
| 7 | 6자리 방코드 → 4자리 | 초안 `539:2969` 등 | 전 화면 코드 표기 교체 | [D-01](../DECISIONS.md#d-01) |

**1번은 [D-24](../DECISIONS.md#d-24) 승인 결과에 달려 있다.** 참가자 개별 START 안이 채택되면 재작업이 불필요하다.

---

## 12. Figma 제작 규칙 (스크립팅 함정 = 하네스)

> 실제로 화면을 깨뜨렸던 함정들이다. 재작업 시 반드시 지킨다.

- **`createFrame` 기본값이 `clipsContent=true`** → 투명 레이아웃 컨테이너는 만든 즉시 `false`로. 안 그러면 FILL 폭 카드의 **우/하 그림자가 잘린다.**
- **`resize()`는 sizing mode를 FIXED로 리셋** → 세로 hug가 필요하면 `primaryAxisSizingMode='AUTO'`를 **resize 뒤에** 다시 설정한다.
- **텍스트 편집 전 현재 폰트 로드** (`getStyledTextSegments(['fontName'])` → `loadFontAsync`). 안 하면 `unloaded font` 에러로 스크립트 전체가 원자적 실패한다.
- **텍스트가 짧아지면 좌측 앵커에 남아 중심이 이탈**한다(예: 코딩왕지호 → 지호). 중앙 배치 요소는 `textAlignHorizontal='CENTER'` + 폭 기준 재중앙.
- **크로스페이지 노드 접근**: 다른 페이지 노드는 `figma.root.children`에서 페이지를 찾아 `setCurrentPageAsync` 후 접근한다(`getNodeByIdAsync`만으로는 null이 날 수 있다).
- **회전 · 방사형 노드**는 `node.x`가 시각 좌상단과 다르다 → `absoluteBoundingBox`로 좌표를 계산한다.
- **`layoutSizing*='FILL'`은 `appendChild` 후에** 설정한다(부모가 auto-layout이어야 유효).
- **오버플로 검산**: 화면당 컬럼·리스트 콘텐츠 총 높이가 밴드(`y932`) 위에 들어오는지 계산한다. 넘치면 카드 패딩·itemSpacing부터 줄이고 **폰트 크기는 마지막에** 줄인다.
- **큰 트리는 복제**: 휠(50+ 노드) · 위너 히어로(컨페티·헤일로)처럼 손으로 다시 그리기 비싼 자산은 원본에서 `clone()`해 보존하고 나머지만 오토레이아웃으로 교체한다.

---
