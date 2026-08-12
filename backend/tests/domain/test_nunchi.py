"""눈치게임 판정 — docs/05_game_rules/07_nunchi.md 의 인수 기준 후보·경계값·반례

**누르면 빠지고 못 누른 사람만 남는다.** 혼자냐 겹쳤냐는 결과를 가르지 않으며
표시에만 쓴다. 끝까지 못 누른 한 명이 뽑힌다.
"""

import pytest

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome
from app.domain.games.nunchi import (
    GAME_ID,
    ROUND_RESULT_MS,
    UP_KIND,
    Judgment,
    Phase,
    judge,
    judge_round,
)

MEMBERS = ("m1", "m2", "m3", "m4", "m5")
W = 300  # 판정창 0.3초


def ctx(
    roster: tuple[str, ...] = MEMBERS,
    *,
    alive: tuple[str, ...] | None = None,
    window_ms: int = W,
    history: tuple = (),
) -> JudgeContext:
    return JudgeContext(
        round_id="3071",
        game_id=GAME_ID,
        seed=0x0123456789ABCDEF,
        roster=roster,
        config={"topic": "팀장", "windowMs": window_ms, "roundSeconds": 15},
        alive=alive,
        history=history,
    )


def up(member: str, at_ms: int, seq: int = 0) -> JudgeInput:
    return JudgeInput(participant_id=member, kind=UP_KIND, arrived_ms=at_ms, seq=seq)


def verdicts_of(verdict) -> dict[str, str]:
    return {row["memberId"]: row["verdict"] for row in verdict.detail["round"]["presses"]}


# ── 누르면 빠진다 ──────────────────────────────────────────────────────────


def test_혼자_눌러도_탈락이다():
    """혼자 누른 것은 안전이 아니라 후보에서 빠지는 것이다."""
    result = judge_round(("a", "b"), {"a": 1000, "b": 5000}, W)
    assert result["alone"] == ("a", "b")
    assert result["eliminated"] == ("a", "b")
    assert result["surviving"] == ()


def test_겹쳐_눌러도_탈락이다():
    result = judge_round(("a", "b"), {"a": 1000, "b": 1200}, W)
    assert set(result["overlapped"]) == {"a", "b"}
    assert set(result["eliminated"]) == {"a", "b"}
    assert result["surviving"] == ()


def test_못_누른_사람만_생존한다():
    result = judge_round(("a", "b", "c"), {"a": 1000, "b": 1200}, W)
    assert result["surviving"] == ("c",)
    assert result["verdicts"]["c"] == Judgment.NO_INPUT


def test_탈락자는_혼자와_겹침의_합집합이다():
    result = judge_round(("a", "b", "c"), {"a": 1000, "b": 1200, "c": 9000}, W)
    assert set(result["overlapped"]) == {"a", "b"}
    assert result["alone"] == ("c",)
    assert set(result["eliminated"]) == {"a", "b", "c"}


def test_탈락자가_누른_순서를_유지한다():
    result = judge_round(("a", "b", "c"), {"c": 9000, "a": 1000, "b": 1200}, W)
    assert result["eliminated"] == ("a", "b", "c")


# ── 혼자와 겹침을 가르는 경계 ──────────────────────────────────────────────


def test_간격이_판정창과_정확히_같으면_겹침이다():
    """비교는 이하(≤)가 겹침이다."""
    result = judge_round(("a", "b"), {"a": 1000, "b": 1500}, 500)
    assert set(result["overlapped"]) == {"a", "b"}
    assert result["alone"] == ()


def test_간격이_판정창보다_1밀리초_크면_둘_다_혼자다():
    result = judge_round(("a", "b"), {"a": 1000, "b": 1501}, 500)
    assert set(result["alone"]) == {"a", "b"}


def test_같은_밀리초에_누르면_겹침이다():
    result = judge_round(("a", "b"), {"a": 1000, "b": 1000}, W)
    assert set(result["overlapped"]) == {"a", "b"}


def test_연쇄로_겹치면_가운데도_끝도_전부_겹침이다():
    """앞뒤 간격 중 하나라도 판정창 이하면 겹침이다. 도착 순서에 의존하지 않는다."""
    result = judge_round(("a", "b", "c"), {"a": 2000, "b": 2200, "c": 2400}, W)
    assert set(result["overlapped"]) == {"a", "b", "c"}
    assert result["alone"] == ()


def test_혼자_겹침_구분은_도착_순서에_의존하지_않는다():
    forward = judge_round(("a", "b", "c"), {"a": 2000, "b": 2200, "c": 2400}, W)
    backward = judge_round(("c", "b", "a"), {"c": 2400, "b": 2200, "a": 2000}, W)
    assert forward["verdicts"] == backward["verdicts"]


def test_판정창_설정이_혼자와_겹침을_가른다():
    presses = {"a": 1000, "b": 1400}
    assert judge_round(("a", "b"), presses, 300)["alone"] == ("a", "b")
    assert set(judge_round(("a", "b"), presses, 500)["overlapped"]) == {"a", "b"}


# ── 라운드 결과의 네 갈래 ──────────────────────────────────────────────────


def test_생존자가_둘_이상이면_다음_라운드로_간다():
    verdict = judge(ctx(), [up("m1", 1000), up("m2", 5000)])
    assert verdict.outcome is Outcome.TIE
    assert set(verdict.survivors) == {"m3", "m4", "m5"}
    assert verdict.persist is None  # 아직 결과가 아니다


def test_생존자가_하나면_그_사람이_최후_1인이다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "c"


def test_겹쳐서_끝난_라운드도_생존자가_하나면_끝난다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 2000), up("b", 2100)])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "c"


def test_아무도_누르지_않으면_무효_라운드다():
    """미입력을 후보 제외로 쳐 주면 가만히 있는 것이 우세 전략이 된다."""
    verdict = judge(ctx(("a", "b", "c")), [])
    assert verdict.outcome is Outcome.VOID
    assert verdict.next_phase == Phase.VOID_ROUND
    assert verdict.next_deadline is None  # 타이머가 없는 정지 상태다
    assert verdict.survivors == ("a", "b", "c")  # 다시 시작하면 같은 생존자다


def test_전원이_누르면_뽑을_사람이_없어_무효_라운드다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000), up("c", 9000)])
    assert verdict.outcome is Outcome.VOID


def test_전원이_겹쳐도_무효_라운드다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 2000), up("b", 2100), up("c", 2200)])
    assert verdict.outcome is Outcome.VOID


def test_생존자_수가_줄면_라운드가_유한하게_끝난다():
    """종료 증명 — 자동 진행 갈래는 생존자 수를 반드시 줄인다."""
    verdict = judge(ctx(), [up("m1", 1000), up("m2", 5000)])
    assert len(verdict.survivors) < len(MEMBERS)


# ── 최후 1인 판정 표기 ─────────────────────────────────────────────────────


def test_최후_1인의_판정이_LAST로_바뀐다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdicts_of(verdict)["c"] == Judgment.LAST


def test_최후_1인_외의_판정은_그대로다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 2000), up("b", 2100)])
    labels = verdicts_of(verdict)
    assert labels["a"] == Judgment.OVERLAP
    assert labels["b"] == Judgment.OVERLAP
    assert labels["c"] == Judgment.LAST


# ── 멱등과 결정성 ──────────────────────────────────────────────────────────


def test_같은_라운드에_두_번_누르면_최초_1회만_센다():
    """G-9 — 두 번째는 버린다."""
    doubled = [up("m1", 1000), up("m1", 1100, seq=1), up("m2", 5000)]
    assert judge(ctx(), doubled).survivors == judge(
        ctx(), [up("m1", 1000), up("m2", 5000)]
    ).survivors


def test_생존자가_아닌_사람의_입력은_보지_않는다():
    """이미 빠진 사람의 추가 입력은 판정을 바꾸지 않는다."""
    alive = ("m3", "m4", "m5")
    with_ghost = judge(ctx(alive=alive), [up("m1", 1000), up("m3", 2000)])
    without = judge(ctx(alive=alive), [up("m3", 2000)])
    assert with_ghost.survivors == without.survivors


def test_같은_입력이면_판정이_언제나_같다():
    presses = [up("m1", 1000), up("m2", 5000)]
    assert judge(ctx(), presses) == judge(ctx(), presses)


def test_같은_밀리초의_순서를_명단_인덱스로_고정한다():
    """결정성을 위한 규칙이며 다른 뜻은 없다."""
    result = judge_round(("m1", "m2"), {"m2": 1000, "m1": 1000}, W, order=MEMBERS)
    assert result["ordered"] == ("m1", "m2")


# ── 라운드 기록 ────────────────────────────────────────────────────────────


def test_기록이_명단_4종을_담는다():
    verdict = judge(ctx(), [up("m1", 1000), up("m2", 2000), up("m3", 2100)])
    record = verdict.detail["round"]
    assert record["aloneMemberIds"] == ["m1"]
    assert record["overlappedMemberIds"] == ["m2", "m3"]
    assert record["eliminatedMemberIds"] == ["m1", "m2", "m3"]
    assert record["survivingMemberIds"] == ["m4", "m5"]


def test_기록이_생존자_전원의_판정을_담는다():
    """혼자 빠진 사람과 겹쳐 빠진 사람을 결과 화면이 구분해야 한다.

    생존자를 둘 남겨 라운드가 이어지게 한다 — 하나만 남으면 그 판정이 LAST로 덮인다.
    """
    roster = ("a", "b", "c", "d", "e")
    verdict = judge(ctx(roster), [up("a", 1000), up("b", 5000), up("c", 5100)])
    assert verdicts_of(verdict) == {
        "a": Judgment.ALONE,
        "b": Judgment.OVERLAP,
        "c": Judgment.OVERLAP,
        "d": Judgment.NO_INPUT,
        "e": Judgment.NO_INPUT,
    }


def test_못_누른_사람의_입력_시각이_비어_있다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 2000), up("b", 2100)])
    rows = {r["memberId"]: r["offsetMs"] for r in verdict.detail["round"]["presses"]}
    assert rows["c"] is None
    assert rows["a"] == 2000


def test_기록이_누른_순으로_정렬된다():
    verdict = judge(ctx(("a", "b", "c", "d")), [up("b", 5000), up("a", 1000)])
    assert [r["memberId"] for r in verdict.detail["round"]["presses"]] == ["a", "b", "c", "d"]


def test_라운드_번호가_지난_기록_수에서_나온다():
    past = ({"roundNo": 1, "eliminatedMemberIds": ["x"]}, {"roundNo": 2, "eliminatedMemberIds": ["y"]})
    verdict = judge(ctx(("a", "b", "c", "d"), history=past), [up("a", 2000), up("b", 2100)])
    assert verdict.detail["round"]["roundNo"] == 3


# ── 저장 형식 ─────────────────────────────────────────────────────────────


def test_저장_형식이_result_data_스키마를_따른다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.persist.keys() == {
        "schemaVersion",
        "rounds",
        "loserMemberIds",
        "voidRound",
    }
    assert verdict.persist["loserMemberIds"] == ["c"]


def test_저장이_지난_라운드를_모두_담는다():
    past = ({"roundNo": 1, "eliminatedMemberIds": ["x"], "presses": []},)
    verdict = judge(ctx(("a", "b", "c"), history=past), [up("a", 1000), up("b", 5000)])
    assert [r["roundNo"] for r in verdict.persist["rounds"]] == [1, 2]


def test_무효_라운드가_있었으면_표시한다():
    past = ({"roundNo": 1, "eliminatedMemberIds": [], "presses": []},)
    verdict = judge(ctx(("a", "b", "c"), history=past), [up("a", 1000), up("b", 5000)])
    assert verdict.persist["voidRound"] is True


def test_무효_라운드가_없었으면_거짓이다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.persist["voidRound"] is False


def test_확정이면_라운드_판정_공개로_넘어간다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.next_phase == Phase.ROUND_RESULT
    assert verdict.next_deadline == ROUND_RESULT_MS


# ── 경계값 ────────────────────────────────────────────────────────────────


def test_최소_인원_3에서_둘이_누르면_남은_하나가_바로_뽑힌다():
    """라운드를 한 번 더 열지 않는다."""
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "c"


def test_생존자_2명에서_한_명이_누르면_다른_한_명이_뽑힌다():
    """2인 구간은 한 라운드로 끝난다 — 먼저 누른 쪽이 빠진다."""
    verdict = judge(ctx(("a", "b")), [up("a", 1000)])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "b"


def test_최대_인원_10에서_판정한다():
    roster = tuple(f"p{i}" for i in range(10))
    presses = [up(m, 1000 + i * 1000) for i, m in enumerate(roster[:9])]
    verdict = judge(ctx(roster), presses)
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "p9"  # 끝까지 누르지 못한 사람


def test_이탈자만_남으면_그_사람이_최후_1인이다():
    """이탈자는 매 라운드 미입력으로 남는다."""
    verdict = judge(ctx(("a", "b", "gone")), [up("a", 1000), up("b", 5000)])
    assert verdict.winner == "gone"


def test_생존자_명단이_비어_있으면_판정할_수_없다():
    with pytest.raises(ValueError):
        judge(ctx(alive=()), [])


def test_라운드_마감_뒤_도착은_뼈대가_거른다():
    """판정은 넘어온 입력만 본다 — 마감 판별은 단계 상태를 아는 쪽의 몫이다."""
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.winner == "c"
