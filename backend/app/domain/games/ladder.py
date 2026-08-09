"""사다리타기 — 서버 난수로 전원에게 항목을 배정한다.

규칙의 정본은 docs/05_game_rules/03_ladder.md, 저장 형식의 정본은
docs/06_database/04_options_votes_results.md 「게임별 JSON 스키마」다.

**도착 순열을 먼저 뽑고 그 순열을 실현하는 가로선을 역산한다.** 가로선을 확률로
먼저 뿌리고 경로를 사후에 읽는 방식은 도착 분포가 균등하지 않다 — 인접 레인으로 갈
확률이 먼 레인으로 갈 확률보다 커진다. 순서를 뒤집은 것이 이 게임의 핵심 설계다.

그래서 **난수를 쓰는 자리가 하나뿐이다.** 항목 배치도 가로선 좌표도 난수를 쓰지
않는다. 난수원이 하나여야 결과 분포를 논증할 수 있고 시드 재현이 성립한다.
"""

from collections.abc import Sequence
from enum import StrEnum

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome, Verdict
from app.domain.games.rng import Prng, random_below

GAME_ID = "ladder"
RESULT_SCHEMA_VERSION = 1

#: 항목이 참가자 수보다 적을 때 채우는 라벨. 배정된 역할이 없다는 뜻이다(D-32).
FILLER_LABEL = "X"

#: 진행 속도 → 연출 길이. **애니메이션 길이만 바꾸고 결과에 영향을 주지 않는다.**
#: 판정은 이 값을 읽지 않으며 마감 시간으로 실어 보내기만 한다.
SPEED_MS = {"FAST": 2000, "NORMAL": 3500, "SLOW": 5000}
DEFAULT_SPEED = "NORMAL"

#: 가로선이 몇 개 나오든 사다리로 보이게 하는 최소 높이. 순열을 바꾸지 않는다.
MIN_LEVELS = 5


class Phase(StrEnum):
    """docs/05_game_rules/03_ladder.md 「상태 머신」이 고정한 사다리 내부 phase 6종."""

    GUIDE = "GUIDE"      # 규칙 가이드 3초. 다시 하기로 진입하면 건너뛴다
    ARMED = "ARMED"      # 방장의 START를 기다린다. 30초 뒤 서버가 자동 실행한다
    DRAWING = "DRAWING"  # 가로선이 공개되고 전원의 경로가 동시에 그려진다
    REVEAL = "REVEAL"    # 최종 연결을 확정 표시하고 3초 뒤 결과 화면으로 넘어간다
    RESULT = "RESULT"
    ABORTED = "ABORTED"  # 방장 이탈로 끝난 흡수 상태


def normalize_items(items: Sequence[str], n: int) -> list[str]:
    """도착 항목 개수를 참가자 수 n에 맞춘다.

    모자라면 뒤에 X를 채우고 넘치면 **뒤에서부터** 잘라낸다(D-32). 방장 설정은
    개수를 막지 않으므로(game_config의 string_list) 맞추는 일이 여기로 온다.

    **섞지 않는다.** 방장이 설정 화면에서 본 순서 그대로 하단에 놓아야 "화면에서 본
    항목 순서가 결과의 항목 순서와 같다"는 검증 가능한 성질이 남는다. 항목까지
    섞으면 난수원이 둘이 되고 어느 쪽이 결과를 만들었는지 설명할 수 없다.

    ARMED에서 하단을 그릴 때도 같은 결과가 필요하다. 뼈대가 따로 구현하면 두 벌이
    갈라지므로 공개 함수로 둔다.
    """
    if n < 0:
        raise ValueError(f"참가자 수는 0 이상이어야 한다: {n}")
    if len(items) >= n:
        return list(items[:n])
    return list(items) + [FILLER_LABEL] * (n - len(items))


def _draw_permutation(prng: Prng, n: int) -> list[int]:
    """Fisher–Yates. perm[i] = 참가자 i가 도착할 컬럼이며 n!가지가 균등하다.

    **유일한 난수 소비 지점이다.**
    """
    perm = list(range(n))
    for i in range(n - 1, 0, -1):
        j = random_below(prng, i + 1)
        perm[i], perm[j] = perm[j], perm[i]
    return perm


def _decompose_to_swaps(perm: Sequence[int]) -> list[int]:
    """순열을 인접 전치의 열로 분해한다. 원소는 갭 인덱스이고 **순서가 의미를 갖는다.**

    갭 e는 컬럼 e와 e+1을 잇는다. 선택 정렬과 같은 모양이며 길이는 최대 n(n-1)/2다.
    """
    n = len(perm)
    cur = list(range(n))          # cur[c] = 지금 컬럼 c를 지나는 참가자
    target = [0] * n              # target[c] = 컬럼 c에 도착해야 하는 참가자
    for participant, column in enumerate(perm):
        target[column] = participant

    swaps: list[int] = []
    for c in range(n):
        d = next(i for i in range(c, n) if cur[i] == target[c])
        for e in range(d - 1, c - 1, -1):
            cur[e], cur[e + 1] = cur[e + 1], cur[e]
            swaps.append(e)
    return swaps


def _pack_levels(swaps: Sequence[int]) -> list[set[int]]:
    """전치의 열을 레벨로 묶어 높이를 줄인다. **열 순서를 지키며 앞으로 당기지 않는다.**

    같은 레벨의 갭 사이 거리를 2 이상으로 강제한다 — 그래야 갭 g가 건드리는 레인
    {g, g+1}과 갭 h가 건드리는 {h, h+1}이 서로소가 되어 한 레벨이 서로소인 전치들의
    곱이 된다. 이것이 1:1 대응 보장의 두 번째 축이다.
    """
    levels: list[set[int]] = []
    cursor: set[int] = set()
    for g in swaps:
        if not cursor or all(abs(g - h) >= 2 for h in cursor):
            cursor.add(g)
        else:
            levels.append(cursor)
            cursor = {g}
    if cursor:
        levels.append(cursor)
    return levels


def _decorate(levels: list[set[int]]) -> list[set[int]]:
    """최소 높이를 채우고, 가로선이 너무 적으면 상쇄되는 장식 쌍을 더한다.

    장식이 없으면 순열이 항등일 때 가로선이 0개가 되어 사다리로 보이지 않는다.
    **연속한 두 빈 레벨의 같은 갭**에 놓으므로 사이에 다른 전치가 끼지 않고 반드시
    상쇄된다 — 순열은 바뀌지 않는다.

    갭은 0으로 고정한다. 여기서 난수를 뽑으면 난수원이 둘이 된다.
    """
    while len(levels) < MIN_LEVELS:
        levels.append(set())
    if sum(len(level) for level in levels) >= 2:
        return levels

    row = next(i for i in range(len(levels) - 1) if not levels[i] and not levels[i + 1])
    levels[row].add(0)
    levels[row + 1].add(0)
    return levels


def _trace(levels: Sequence[set[int]], n: int) -> list[int]:
    """가로선을 실제로 따라가 참가자별 도착 컬럼을 구한다.

    레벨 안의 갭은 서로 2 이상 떨어져 있으므로 **어떤 순서로 적용해도 결과가 같다.**
    """
    assign = []
    for i in range(n):
        c = i
        for level in levels:
            for g in level:
                if g == c:
                    c += 1
                elif g == c - 1:
                    c -= 1
        assign.append(c)
    return assign


def judge(ctx: JudgeContext, inputs: Sequence[JudgeInput] = ()) -> Verdict:
    """명단 스냅샷·항목·시드로 전원 배정을 확정한다.

    inputs는 계약을 맞추려고 받되 판정에 쓰지 않는다. 방장이 30초 동안 START를
    누르지 않아 서버가 자동 실행한 경우 입력 배열이 비어 있는데, 그때도 같은 결과가
    나와야 하기 때문이다. 참가자 입력은 어느 상태에서도 정의되지 않는다.
    """
    n = len(ctx.roster)
    if n == 0:
        raise ValueError("명단 스냅샷이 비어 있다")

    slots = normalize_items(ctx.config.get("resultItems") or (), n)
    speed = ctx.config.get("speed") or DEFAULT_SPEED
    if speed not in SPEED_MS:
        raise ValueError(f"진행 속도가 규격 밖이다: {speed}")

    perm = _draw_permutation(Prng(ctx.seed, GAME_ID), n)
    levels = _decorate(_pack_levels(_decompose_to_swaps(perm)))

    # 자기 검증. 알고리즘이 옳다면 절대 실패하지 않으며, 실패한다면 구현 결함이므로
    # 어긋난 결과를 내보내는 것보다 판을 세우는 편이 낫다. 호출부는 시드를 다시 뽑아
    # **최대 한 번** 재시도하고 두 번째도 실패하면 판을 중단한다(05_game_rules/03).
    if _trace(levels, n) != perm:
        raise RuntimeError("사다리 자기 검증 실패 — 경로가 뽑은 순열과 어긋났다")

    # optionId는 game_options 행의 외부 식별자라 순수 판정 함수가 알 수 없다.
    # 도착 컬럼(slot)이 그 행의 sort_order와 같은 축이므로 저장 직전에 뼈대가 채운다.
    assignments = [
        {"memberId": member, "slot": perm[i], "label": slots[perm[i]]}
        for i, member in enumerate(ctx.roster)
    ]
    rungs = [
        {"row": row, "leftLane": gap}
        for row, level in enumerate(levels)
        for gap in sorted(level)
    ]

    return Verdict(
        outcome=Outcome.DECIDED,  # 판정 출력이 순열이라 동점이라는 상태가 없다
        assignments=assignments,
        next_phase=Phase.DRAWING,
        next_deadline=SPEED_MS[speed],
        persist={
            "schemaVersion": RESULT_SCHEMA_VERSION,
            "seed": ctx.seed,
            "assignments": assignments,
            "ladderRungs": rungs,
        },
        # 경로가 그려지기 시작하는 순간에 클라이언트가 있어야 하는 값이다.
        # 결과 발표 전이라 result_data로는 전달되지 않는다(07_api/03 「phase payload」).
        detail={"assignments": assignments, "ladderRungs": rungs},
    )
