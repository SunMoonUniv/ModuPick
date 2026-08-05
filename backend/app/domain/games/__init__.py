"""미니게임 6종의 판정 순수 함수.

전 게임이 judge(ctx, inputs) -> Verdict 한 형태를 갖는다. 형식이 같아야 새 게임을
붙일 때 빠진 처리를 셀 수 있다. 계약의 정본은 docs/04_architecture/03_judgment_engine.md,
규칙의 정본은 docs/05_game_rules/다.
"""

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome, Verdict

__all__ = ["JudgeContext", "JudgeInput", "Outcome", "Verdict"]
