# 컴포넌트 규격

> 화면 ID는 [`04_requirements/01_screen_map.md`](../04_requirements/01_screen_map.md), 게임 규칙은 [`05_game_rules/00_common.md`](../05_game_rules/00_common.md)를 따른다.
> 최종 수정: 2026-07-26 · 소유자: [`TEAM.md`](../TEAM.md) 참조

---

- **카드**: white · border 잉크 5 · radius 20 · shadow `6px 6px 0 잉크`(하드 오프셋)
- **칩(pill)**: radius 999 · border 4 · 좌우 패딩 16~20
- **버튼**: radius 14~16 · border 4~5 · shadow 4~5 · 라벨 Do Hyeon 22~24
- **아바타**: 원형 ⌀42(채팅) ~ 60(카드) ~ 72+ · border 잉크 3~4 · 이미지 FILL
- **오토레이아웃 필수**: 리스트 · 카드 · 행처럼 구조적으로 묶이는 건 전부 auto-layout. 방사형 휠 · 장식 히어로만 절대배치.
- **그림자 잘림 주의**: 투명 레이아웃 컨테이너는 `clipsContent=false`(그림자 보존). 카드 배경 프레임과 스크롤 리스트만 클립한다.

---
