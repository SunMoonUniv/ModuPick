"""운명의 룰렛 — 서버 난수로 참가자 1인을 뽑는다.

규칙의 정본은 docs/05_game_rules/02_roulette.md, 저장 형식의 정본은
docs/06_database/04_options_votes_results.md 「게임별 JSON 스키마」다.

동점도 미입력도 발생하지 않는 유일한 게임이다. 참가자 입력이 판정에 들어가지 않으므로
판정은 ARMED에서 SPINNING으로 넘어가는 한 순간에 끝난다.
"""

from collections.abc import Sequence
from enum import StrEnum

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome, Verdict
from app.domain.games.rng import Prng, random_below

GAME_ID = "roulette"
RESULT_SCHEMA_VERSION = 1

# 회전 연출은 서버 상수다. 원 기획은 "3~5초 회전"이라는 범위만 정했고 바퀴 수는 정하지
# 않았다. 라운드마다 난수로 뽑을 이유가 없어 고정한다 — 판정이 시드에서 당첨자 하나만
# 뽑는 일이 되고, 라운드마다 달라지는 값이 없으니 저장할 것도 없다.
SPIN_TURNS = 5
SPIN_MS = 5000


class Phase(StrEnum):
    """docs/10_glossary/03_enums_state_machines.md 가 고정한 룰렛 내부 phase 6종."""

    GUIDE = "GUIDE"        # 규칙 가이드 3초. 다시 하기로 진입하면 건너뛴다
    ARMED = "ARMED"        # 방장의 PICK을 기다린다. 30초 뒤 서버가 자동 실행한다
    SPINNING = "SPINNING"  # 확정된 결과로 수렴하는 연출 구간
    REVEAL = "REVEAL"      # 당첨 조각을 강조하고 3초 뒤 결과 화면으로 넘어간다
    RESULT = "RESULT"
    ABORTED = "ABORTED"    # 방장 이탈로 끝난 흡수 상태


def judge(ctx: JudgeContext, inputs: Sequence[JudgeInput] = ()) -> Verdict:
    """명단 스냅샷과 시드로 당첨자를 확정한다.

    inputs는 계약을 맞추려고 받되 판정에 쓰지 않는다. 방장이 30초 동안 PICK을 누르지
    않아 서버가 자동 실행한 경우 입력 배열이 비어 있는데, 그때도 같은 결과가 나와야
    하기 때문이다. 방장의 연타는 멱등 처리로 이 함수에 닿기 전에 걸러진다.
    """
    n = len(ctx.roster)
    if n == 0:
        raise ValueError("명단 스냅샷이 비어 있다")

    winner_index = random_below(Prng(ctx.seed, GAME_ID), n)
    winner = ctx.roster[winner_index]
    return Verdict(
        outcome=Outcome.DECIDED,  # 판정 출력이 단일 정수라 동점이라는 상태가 없다
        winner=winner,
        next_phase=Phase.SPINNING,
        next_deadline=SPIN_MS,
        persist={
            "schemaVersion": RESULT_SCHEMA_VERSION,
            "seed": ctx.seed,
            "winnerMemberIds": [winner],  # 한 명뿐인 게임도 배열로 담는다
            "wheelOrder": list(ctx.roster),  # 조각 배치 = 입장 순서
        },
        # 회전 시작 시점에 클라이언트가 목표 각도를 계산하려면 이 값이 필요하다.
        # 결과 발표 전이라 result_data로는 전달되지 않는다.
        detail={"winnerIndex": winner_index},
    )
