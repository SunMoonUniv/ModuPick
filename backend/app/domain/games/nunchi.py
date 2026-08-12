"""눈치게임 — 누른 사람이 빠지고 끝까지 못 누른 한 명이 뽑힌다.

규칙의 정본은 docs/05_game_rules/07_nunchi.md, 저장 형식의 정본은
docs/06_database/04_options_votes_results.md 「게임별 JSON 스키마」다.

**누르면 빠진다.** 혼자 눌렀든 판정창 안에 겹쳐 눌렀든 그 라운드에 UP을 누른 사람은
전부 후보에서 빠진다. 누르지 못한 사람만 다음 라운드로 넘어가고, 끝까지 남은 한 명이
뽑힌다.

**겹침은 라운드를 끊는다.** 판정창 안에 겹쳐 누르는 순간 그 라운드가 그 자리에서
끝나므로, 아직 누르지 못한 사람들은 누를 기회를 잃고 다음 라운드로 밀린다. 늦으면
남의 겹침 때문에 기회가 날아간다는 것이 이 게임의 압박이다.

**혼자냐 겹쳤냐는 결과를 가르지 않는다.** 둘 다 빠지며, 구분은 결과 화면 표시에만
쓴다. 그래서 판정이 두 명단을 따로 낸다.

**라운드가 여러 번 도는 유일한 게임이다.** 그래서 판정이 지난 라운드 기록을 받는다 —
저장 형식이 전 라운드의 판정을 담기 때문이다.
"""

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome, Verdict

GAME_ID = "nunchi"
RESULT_SCHEMA_VERSION = 1

#: game:action type. 이미 빠진 사람과 재입력은 뼈대가 game.not_eligible로 거른다.
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
    """라운드 판정 4값.

    **ALONE과 OVERLAP은 결과가 같다** — 둘 다 탈락이며 다음 라운드로 가지 않는다.
    나뉘어 있는 이유는 결과 화면이 "혼자 눌러 빠졌다"와 "겹쳐서 빠졌다"를 다르게
    보여야 하기 때문이다.
    """

    ALONE = "ALONE"        # 혼자 눌러 탈락. 다음 라운드로 가지 않는다
    OVERLAP = "OVERLAP"    # 판정창 안에 겹쳐 눌러 탈락. 이 순간 라운드가 끝났다
    NO_INPUT = "NO_INPUT"  # 누르지 못해 생존. 다음 라운드로 간다
    LAST = "LAST"          # 최후 1인으로 뽑힌다


# ── 라운드 판정 ────────────────────────────────────────────────────────────


def _presses(inputs: Sequence[JudgeInput], survivors: Sequence[str]) -> dict[str, int]:
    """UP 입력을 참가자 → 도착 시각으로 모은다.

    **라운드당 최초 1회만 센다**(G-9). 이미 빠진 사람의 입력은 애초에 뼈대가
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
    """한 라운드를 판정한다. 누른 사람은 전부 탈락, 못 누른 사람만 생존한다.

    혼자와 겹침을 가르는 기준은 **인접 간격**이다 — 시각 오름차순으로 정렬해 앞뒤
    간격이 둘 다 판정창을 넘으면 혼자, 하나라도 판정창 이하면 겹침이다. 정렬된
    배열에서 인접하지 않은 입력과의 간격은 인접 간격보다 항상 크므로 이것으로 충분하다.

    **겹침 집단은 한 라운드에 하나뿐이다.** 진행 모듈이 겹침을 본 그 자리에서 라운드를
    끊기 때문이다. 그래도 판정은 일반형으로 두어 마감 경로와 조기 종료 경로가 같은
    규칙을 타게 한다.

    **비교는 이하(≤)가 겹침이다.** 간격이 정확히 판정창이면 겹친 것이다.
    """
    index = {member: i for i, member in enumerate(order or survivors)}
    ordered = sorted(
        ((m, t) for m, t in presses.items() if m in index),
        key=lambda pair: (pair[1], index[pair[0]]),  # 같은 밀리초면 스냅샷 순
    )

    verdicts: dict[str, str] = {}
    alone: list[str] = []
    overlapped: list[str] = []
    for i, (member, t) in enumerate(ordered):
        prev_gap = t - ordered[i - 1][1] if i > 0 else None
        next_gap = ordered[i + 1][1] - t if i < len(ordered) - 1 else None
        isolated = (prev_gap is None or prev_gap > window_ms) and (
            next_gap is None or next_gap > window_ms
        )
        if isolated:
            alone.append(member)
            verdicts[member] = Judgment.ALONE
        else:
            overlapped.append(member)
            verdicts[member] = Judgment.OVERLAP

    # 못 누른 사람만 다음 라운드로 간다.
    surviving: list[str] = []
    for member in survivors:
        if member not in presses:
            surviving.append(member)
            verdicts[member] = Judgment.NO_INPUT

    return {
        "alone": tuple(alone),
        "overlapped": tuple(overlapped),
        # 탈락자 전원. 혼자와 겹침의 합집합이며 누른 순서를 유지한다.
        "eliminated": tuple(m for m, _ in ordered),
        "surviving": tuple(surviving),
        "verdicts": verdicts,
        "ordered": tuple(m for m, _ in ordered),
    }


def _record(
    round_no: int,
    survivors: Sequence[str],
    presses: Mapping[str, int],
    result: Mapping[str, Any],
) -> dict[str, Any]:
    """저장·표시용 라운드 기록.

    **명단 4종을 그대로 담는다.** 진행 중 페이로드와 최종 결과가 같은 모양을 쓰므로
    결과 화면이 라운드별 판정을 진행 화면과 같은 코드로 그릴 수 있다.
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
        "aloneMemberIds": list(result["alone"]),
        "overlappedMemberIds": list(result["overlapped"]),
        "eliminatedMemberIds": list(result["eliminated"]),
        "survivingMemberIds": list(result["surviving"]),
    }


def _decided(
    loser: str,
    record: dict[str, Any],
    history: Sequence[Mapping[str, Any]],
) -> Verdict:
    """최후 1인이 정해졌다. 그 사람의 판정만 LAST로 덮고 저장 형식을 만든다."""
    record["presses"] = [
        {**row, "verdict": Judgment.LAST} if row["memberId"] == loser else row
        for row in record["presses"]
    ]
    rounds = [*history, record]
    return Verdict(
        outcome=Outcome.DECIDED,
        winner=loser,
        next_phase=Phase.ROUND_RESULT,
        next_deadline=ROUND_RESULT_MS,
        persist={
            "schemaVersion": RESULT_SCHEMA_VERSION,
            "rounds": rounds,
            "loserMemberIds": [loser],  # 한 명뿐이어도 배열로 담는다
            # 아무도 빠지지 못한 라운드가 한 번이라도 있었는가.
            "voidRound": any(not r["eliminatedMemberIds"] for r in rounds),
        },
        detail={"round": record},
    )


def _void(survivors: tuple[str, ...], detail: dict[str, Any]) -> Verdict:
    """무효 라운드. 자동으로 다음 라운드를 열지 않고 방장이 끊는다(D-35)."""
    return Verdict(
        outcome=Outcome.VOID,
        survivors=survivors,  # 다시 시작하면 같은 생존자로 연다
        next_phase=Phase.VOID_ROUND,  # 타이머가 없는 정지 상태다
        detail=detail,
    )


# ── 판정 ───────────────────────────────────────────────────────────────────


def judge(ctx: JudgeContext, inputs: Sequence[JudgeInput] = ()) -> Verdict:
    """한 라운드를 판정하고 다음 동작을 정한다.

    다음 동작은 **탈락자와 생존자의 크기로만** 정해진다.

    | 조건 | 다음 동작 |
    |------|----------|
    | 탈락자 0 | 무효 라운드 — 아무도 누르지 않아 생존자가 줄지 않았다 |
    | 생존자 0 | 무효 라운드 — 전원이 눌러 뽑을 사람이 남지 않았다 |
    | 생존자 1 | 종료 — 끝까지 못 누른 그 한 명이 뽑힌다 |
    | 생존자 2 이상 | 다음 라운드 — 생존자를 못 누른 사람들로 줄인다 |

    **탈락자 0을 무효로 돌리는 것이 안 누르기를 막는 자리다.** 미입력을 후보 제외로
    쳐 주면 전원이 가만히 있는 것이 우세 전략이 되어 게임이 성립하지 않는다.

    **생존자 0은 정상 경로로는 오지 않는다.** 진행 모듈이 생존자가 한 명 남는 순간
    라운드를 끊으므로 마지막 한 명은 누를 기회를 얻지 못한다 — 그 기회를 주면 안
    누르면 뽑히는 사람이 눌러서 판을 무르는 것이 언제나 이득이 되어 게임이 끝나지
    않는다. 이 갈래는 그 불변식이 깨졌을 때를 위한 방어다.

    **원점이 어디든 판정은 같다.** 혼자·겹침 구분은 입력 사이의 간격만 보므로
    arrived_ms의 원점이 무엇이든 결과가 바뀌지 않는다. 다만 저장되는 offsetMs는
    표시값이므로 라운드 시작이 원점이어야 한다.
    """
    survivors = tuple(ctx.alive) if ctx.alive is not None else tuple(ctx.roster)
    if not survivors:
        raise ValueError("생존자 명단이 비어 있다")

    window_ms = int(ctx.config.get("windowMs", 300))
    presses = _presses(inputs, survivors)
    result = judge_round(survivors, presses, window_ms, order=ctx.roster)
    eliminated, surviving = result["eliminated"], result["surviving"]

    round_no = len(ctx.history) + 1
    record = _record(round_no, survivors, presses, result)

    # 연출과 저장이 같은 값을 본다. ROUND_RESULT가 이 기록을 그대로 그린다.
    detail = {"round": record}

    # 아무도 누르지 않았다. 생존자가 그대로이므로 자동으로 다음 라운드를 열지 않는다.
    if not eliminated:
        return _void(survivors, detail)

    # 전원이 눌러 아무도 남지 않았다. 뽑을 사람이 없으므로 방장이 끊는다.
    if not surviving:
        return _void(survivors, detail)

    if len(surviving) >= 2:
        # 생존자가 최소 1 줄었으므로 진전이 있다. 종료 증명이 이 성질에 기댄다.
        return Verdict(
            outcome=Outcome.TIE,
            survivors=surviving,
            next_phase=Phase.ROUND_RESULT,
            next_deadline=ROUND_RESULT_MS,
            detail=detail,
        )

    return _decided(surviving[0], record, ctx.history)
