"""눈치게임 — 혼자 누른 사람이 안전해지고 마지막 한 명이 뽑힌다.

규칙의 정본은 docs/05_game_rules/07_nunchi.md, 저장 형식의 정본은
docs/06_database/04_options_votes_results.md 「게임별 JSON 스키마」다.

**혼자 누를수록 유리한 구조다**(D-34). 혼자 누른 사람은 안전 확정되어 후보에서 빠지고,
판정창 안에 겹친 사람과 누르지 않은 사람이 남아 다시 붙는다. 구 기획의 "동시 입력자
전원 탈락"은 일부러 겹치는 것이 이득이 되어 게임이 성립하지 않으므로 폐기됐다.
frontend/src/games/Nunchi.tsx가 아직 폐기된 구조로 되어 있으니 대조하지 말 것.

**라운드가 여러 번 도는 유일한 게임이다.** 그래서 판정이 지난 라운드 기록을 받는다 —
저장 형식이 전 라운드의 판정을 담기 때문이다.
"""

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome, Verdict

GAME_ID = "nunchi"
RESULT_SCHEMA_VERSION = 1

#: game:action type. 안전 확정자와 재입력은 뼈대가 game.not_eligible로 거른다.
UP_KIND = "nunchi.up"

#: 단계별 고정 시간. 라운드 제한 시간만 방장 설정에서 온다.
GUIDE_MS = 3_000
ROUND_RESULT_MS = 3_000
REVEAL_MS = 3_000


class Phase(StrEnum):
    """docs/10_glossary/03_enums_state_machines.md 가 고정한 눈치 phase 8종."""

    GUIDE = "GUIDE"
    ROUND = "ROUND"                # UP을 받는다. 생존자와 라운드 번호를 갖는다
    ROUND_RESULT = "ROUND_RESULT"  # 그 라운드의 판정을 3초 공개한다
    VOID_ROUND = "VOID_ROUND"      # 무효 라운드 모달. 타이머 없이 방장 선택만 받는다
    REVEAL = "REVEAL"              # 최후 1인을 공개하고 3초 뒤 결과로 넘어간다
    RESULT = "RESULT"
    VOID = "VOID"                  # 방장이 대기방으로를 골라 결과 없이 끝난 상태
    ABORTED = "ABORTED"            # 방장 이탈로 끝난 흡수 상태


class Judgment(StrEnum):
    """라운드 판정 4값. **'탈락'을 담지 않는다** — 이 게임에 탈락이 없다."""

    SAFE = "SAFE"          # 혼자 눌러 안전 확정. 후보에서 빠진다
    OVERLAP = "OVERLAP"    # 판정창 안에 겹쳐 남는다
    NO_INPUT = "NO_INPUT"  # 누르지 않아 남는다
    LAST = "LAST"          # 최후 1인으로 뽑힌다


# ── 라운드 판정 ────────────────────────────────────────────────────────────


def _presses(inputs: Sequence[JudgeInput], survivors: Sequence[str]) -> dict[str, int]:
    """UP 입력을 참가자 → 도착 시각으로 모은다.

    **라운드당 최초 1회만 센다**(G-9). 생존자가 아닌 사람의 입력은 애초에 뼈대가
    game.not_eligible로 거르지만, 판정도 생존자 집합 밖은 보지 않는다.
    """
    alive = set(survivors)
    out: dict[str, int] = {}
    for item in inputs:
        if item.kind != UP_KIND or item.participant_id in out:
            continue
        if item.participant_id in alive:
            out[item.participant_id] = item.arrived_ms
    return out


def judge_round(
    survivors: Sequence[str],
    presses: Mapping[str, int],
    window_ms: int,
    *,
    order: Sequence[str] = (),
) -> dict[str, Any]:
    """한 라운드의 고립 판정. safe · remain · verdicts · groups를 낸다.

    **판정하는 것은 그룹이 아니라 고립이다.** D-34가 정의하는 것은 "혼자 누른 사람"이고
    혼자의 뜻은 "내 옆에 아무도 없다"이지 "내가 속한 그룹의 크기가 1"이 아니다.

        p가 안전 확정될 조건: 다른 어떤 입력 q에 대해서도 |t(p) − t(q)| > W

    정렬하면 **바로 앞·바로 뒤 간격만** 보면 된다 — 인접하지 않은 입력과의 간격은
    인접 간격보다 항상 크다.

    앵커 방식(그룹 최초 입력에서 W 이내를 같은 그룹으로 묶는 것)을 쓰지 않는 이유는
    도착 순서에 의존하기 때문이다. A 2.00 · B 2.20 · C 2.40에 판정창 0.3이면 B와 C는
    똑같이 0.20초 간격인데 앵커 방식은 B만 겹침으로 본다. 그 차이를 만드는 것은
    "누가 그룹의 첫 번째였는가"라는 우연이고 그 우연은 네트워크 지연으로 바뀐다.

    **비교는 초과(>)이지 이상(≥)이 아니다.** 간격이 정확히 판정창이면 겹침이다.
    """
    index = {member: i for i, member in enumerate(order or survivors)}
    ordered = sorted(
        ((m, t) for m, t in presses.items() if m in index),
        key=lambda pair: (pair[1], index[pair[0]]),  # 같은 밀리초면 스냅샷 순
    )

    verdicts: dict[str, str] = {}
    safe: list[str] = []
    remain: list[str] = []
    for i, (member, t) in enumerate(ordered):
        prev_gap = t - ordered[i - 1][1] if i > 0 else None
        next_gap = ordered[i + 1][1] - t if i < len(ordered) - 1 else None
        isolated = (prev_gap is None or prev_gap > window_ms) and (
            next_gap is None or next_gap > window_ms
        )
        if isolated:
            safe.append(member)
            verdicts[member] = Judgment.SAFE
        else:
            remain.append(member)
            verdicts[member] = Judgment.OVERLAP

    # 미입력자는 남는다. 안전 확정되지 못했을 뿐 탈락이 아니다.
    for member in survivors:
        if member not in presses:
            remain.append(member)
            verdicts[member] = Judgment.NO_INPUT

    return {
        "safe": tuple(safe),
        "remain": tuple(remain),
        "verdicts": verdicts,
        "ordered": tuple(m for m, _ in ordered),
        "groups": _groups(ordered, window_ms),
    }


def _groups(ordered: Sequence[tuple[str, int]], window_ms: int) -> tuple[tuple[str, ...], ...]:
    """표시용 연결 성분. **판정에는 쓰지 않는다.**

    인접 간격이 판정창 이하인 것끼리 이어 붙인다. 원소가 1개인 성분은 고립 판정의
    안전 확정자와 정확히 일치하므로 표시와 판정이 어긋나지 않는다 — 성분 크기가 1이면
    앞뒤 간격이 모두 판정창을 넘는다는 뜻이다.
    """
    if not ordered:
        return ()
    groups: list[list[str]] = [[ordered[0][0]]]
    for i in range(1, len(ordered)):
        if ordered[i][1] - ordered[i - 1][1] <= window_ms:
            groups[-1].append(ordered[i][0])
        else:
            groups.append([ordered[i][0]])
    return tuple(tuple(g) for g in groups)


def _record(
    round_no: int,
    survivors: Sequence[str],
    presses: Mapping[str, int],
    result: Mapping[str, Any],
) -> dict[str, Any]:
    """저장·표시용 라운드 기록.

    **미입력자도 담는다.** remainingMemberIds만으로는 겹쳐서 남은 사람과 누르지 않아
    남은 사람을 가릴 수 없는데, 결과 화면은 그 둘을 구분해 보여야 한다.
    """
    verdicts = result["verdicts"]
    rows = [
        {"memberId": m, "offsetMs": presses[m], "verdict": verdicts[m]}
        for m in result["ordered"]
    ]
    rows += [
        {"memberId": m, "offsetMs": None, "verdict": verdicts[m]}
        for m in survivors
        if m not in presses
    ]
    return {
        "roundNo": round_no,
        "presses": rows,
        "safeMemberIds": list(result["safe"]),
        "remainingMemberIds": list(result["remain"]),
    }


# ── 판정 ───────────────────────────────────────────────────────────────────


def judge(ctx: JudgeContext, inputs: Sequence[JudgeInput] = ()) -> Verdict:
    """한 라운드를 판정하고 다음 동작을 정한다.

    라운드 결과의 네 갈래는 **safe와 remain의 크기로만** 정해진다.

    | 조건 | 다음 동작 |
    |------|----------|
    | safe 0 | 무효 라운드 — 방장이 고른다. 생존자 수가 줄지 않았다 |
    | remain 0 | 종료 — 가장 늦게 누른 안전 확정자가 최후 1인 |
    | remain 1 | 종료 — 남은 한 명이 최후 1인 |
    | remain 2 이상 | 다음 라운드 — 생존자를 remain으로 줄인다 |

    **원점이 어디든 판정은 같다.** 고립 판정은 입력 사이의 간격만 보므로 arrived_ms의
    원점이 라운드 시작이든 라운드 생명주기 시작이든 safe·remain이 바뀌지 않는다.
    다만 저장되는 offsetMs는 표시값이므로 라운드 시작이 원점이어야 한다.
    """
    survivors = tuple(ctx.alive) if ctx.alive is not None else tuple(ctx.roster)
    if not survivors:
        raise ValueError("생존자 명단이 비어 있다")

    window_ms = int(ctx.config.get("windowMs", 300))
    presses = _presses(inputs, survivors)
    result = judge_round(survivors, presses, window_ms, order=ctx.roster)
    safe, remain = result["safe"], result["remain"]

    round_no = len(ctx.history) + 1
    record = _record(round_no, survivors, presses, result)

    # 연출과 저장이 같은 값을 본다. ROUND_RESULT가 이 기록을 그대로 그린다.
    detail = {"round": record, "groups": [list(g) for g in result["groups"]]}

    # 안전 확정자가 없으면 생존자 수가 줄지 않았다. 자동으로 다음 라운드를 열면
    # 같은 상태가 반복될 수 있으므로 방장이 끊는다(D-35). 전원 겹침·전원 미입력·
    # 혼재 셋을 구분하지 않는다 — 처리가 같다.
    if not safe:
        return Verdict(
            outcome=Outcome.VOID,
            survivors=survivors,  # 다시 시작하면 같은 생존자로 연다
            next_phase=Phase.VOID_ROUND,  # 타이머가 없는 정지 상태다
            detail=detail,
        )

    if len(remain) >= 2:
        # 생존자 수가 최소 1 줄었으므로 진전이 있다. 종료 증명이 이 성질에 기댄다.
        return Verdict(
            outcome=Outcome.TIE,
            survivors=remain,
            next_phase=Phase.ROUND_RESULT,
            next_deadline=ROUND_RESULT_MS,
            detail=detail,
        )

    # 종료. remain이 비면 전원이 각자 혼자 눌러 아무도 남지 않은 경우이며, 이 게임이
    # 시종 버티기를 겨루는 규칙과 일관되게 가장 늦게 누른 사람을 고른다.
    loser = remain[0] if remain else result["ordered"][-1]
    record["presses"] = [
        {**row, "verdict": Judgment.LAST} if row["memberId"] == loser else row
        for row in record["presses"]
    ]
    rounds = [*ctx.history, record]
    return Verdict(
        outcome=Outcome.DECIDED,
        winner=loser,
        next_phase=Phase.ROUND_RESULT,
        next_deadline=ROUND_RESULT_MS,
        persist={
            "schemaVersion": RESULT_SCHEMA_VERSION,
            "rounds": rounds,
            "loserMemberIds": [loser],  # 한 명뿐이어도 배열로 담는다
            "voidRound": any(not r["safeMemberIds"] for r in rounds),
        },
        detail={"round": record, "groups": detail["groups"]},
    )
