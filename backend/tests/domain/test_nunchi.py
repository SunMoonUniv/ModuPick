"""눈치게임 판정 — docs/05_game_rules/07_nunchi.md 의 인수 기준 후보·경계값·반례"""

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


# ── 고립 판정 ──────────────────────────────────────────────────────────────


def test_혼자_누르면_안전_확정된다():
    result = judge_round(("a", "b"), {"a": 1000, "b": 5000}, W)
    assert result["safe"] == ("a", "b")
    assert result["remain"] == ()


def test_판정창_안에_겹치면_남는다():
    result = judge_round(("a", "b"), {"a": 1000, "b": 1200}, W)
    assert result["safe"] == ()
    assert set(result["remain"]) == {"a", "b"}


def test_연쇄로_겹치면_가운데도_끝도_전부_겹침이다():
    """앵커 방식이면 C가 단독이 되지만 고립 판정은 대칭이다."""
    result = judge_round(("a", "b", "c"), {"a": 2000, "b": 2200, "c": 2400}, W)
    assert result["safe"] == ()
    assert set(result["remain"]) == {"a", "b", "c"}


def test_고립_판정은_도착_순서에_의존하지_않는다():
    """같은 간격이면 먼저 누른 쪽과 나중에 누른 쪽의 판정이 같아야 한다."""
    forward = judge_round(("a", "b", "c"), {"a": 2000, "b": 2200, "c": 2400}, W)
    backward = judge_round(("c", "b", "a"), {"c": 2400, "b": 2200, "a": 2000}, W)
    assert forward["verdicts"] == backward["verdicts"]


def test_간격이_판정창과_정확히_같으면_겹침이다():
    """비교는 초과(>)이지 이상(≥)이 아니다."""
    result = judge_round(("a", "b"), {"a": 1000, "b": 1500}, 500)
    assert result["safe"] == ()


def test_간격이_판정창보다_1밀리초_크면_둘_다_안전_확정이다():
    result = judge_round(("a", "b"), {"a": 1000, "b": 1501}, 500)
    assert set(result["safe"]) == {"a", "b"}


def test_미입력자는_남는다():
    """안전 확정되지 못했을 뿐 탈락이 아니다."""
    result = judge_round(("a", "b"), {"a": 1000}, W)
    assert result["safe"] == ("a",)
    assert result["remain"] == ("b",)
    assert result["verdicts"]["b"] == Judgment.NO_INPUT


def test_같은_밀리초에_눌러도_동점이_아니라_겹침이다():
    """간격이 0이라 판정창 안이다. 동점이라는 상태가 정의되지 않는다."""
    result = judge_round(("a", "b"), {"a": 1000, "b": 1000}, W)
    assert set(result["remain"]) == {"a", "b"}


def test_원천_판정_예시와_8행이_일치한다():
    """docs_legacy §3.5.6 — 판정창 0.3초 · 5명. 원천의 판정과 같은 결과가 나온다."""
    survivors = ("지호", "서연", "민준", "하늘", "도윤")
    presses = {"지호": 2100, "서연": 5400, "민준": 7000, "하늘": 7120}
    result = judge_round(survivors, presses, W)
    assert set(result["safe"]) == {"지호", "서연"}
    assert result["verdicts"] == {
        "지호": Judgment.SAFE,
        "서연": Judgment.SAFE,
        "민준": Judgment.OVERLAP,
        "하늘": Judgment.OVERLAP,
        "도윤": Judgment.NO_INPUT,
    }


def test_원천_2라운드도_일치한다():
    result = judge_round(("민준", "하늘", "도윤"), {"민준": 1800, "하늘": 4000}, W)
    assert set(result["safe"]) == {"민준", "하늘"}
    assert result["remain"] == ("도윤",)


def test_games_문서_예시도_일치한다():
    """git 529e312 docs/games.md §7.4 — A 2.00 · B 2.12 · C 2.62 · 판정창 0.3초."""
    result = judge_round(("A", "B", "C"), {"A": 2000, "B": 2120, "C": 2620}, W)
    assert result["safe"] == ("C",)
    assert set(result["remain"]) == {"A", "B"}


# ── 표시용 연결 성분 ───────────────────────────────────────────────────────


def test_연결_성분이_인접_간격으로_묶인다():
    result = judge_round(("a", "b", "c"), {"a": 1000, "b": 1200, "c": 5000}, W)
    assert result["groups"] == (("a", "b"), ("c",))


def test_원소가_1개인_성분이_안전_확정자와_정확히_일치한다():
    """표시와 판정이 어긋나지 않는다는 성질이다."""
    presses = {"a": 1000, "b": 1200, "c": 5000, "d": 9000, "e": 9100}
    result = judge_round(("a", "b", "c", "d", "e"), presses, W)
    singles = {g[0] for g in result["groups"] if len(g) == 1}
    assert singles == set(result["safe"])


# ── 라운드 결과의 네 갈래 ──────────────────────────────────────────────────


def test_안전_확정자가_없으면_무효_라운드다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 2000), up("b", 2200), up("c", 2400)])
    assert verdict.outcome is Outcome.VOID
    assert verdict.next_phase == Phase.VOID_ROUND
    assert verdict.next_deadline is None  # 타이머가 없는 정지 상태다
    assert verdict.survivors == ("a", "b", "c")  # 다시 시작하면 같은 생존자다


def test_전원_미입력도_무효_라운드다():
    """구 스펙이 정의하지 않았던 경우를 안전 확정자 0으로 일반화했다."""
    verdict = judge(ctx(("a", "b", "c")), [])
    assert verdict.outcome is Outcome.VOID


def test_겹침과_미입력이_섞여도_무효_라운드다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 2000), up("b", 2100)])
    assert verdict.outcome is Outcome.VOID


def test_잔류자가_둘_이상이면_다음_라운드로_간다():
    verdict = judge(ctx(), [up("m1", 1000), up("m2", 5000), up("m3", 5100)])
    assert verdict.outcome is Outcome.TIE
    assert set(verdict.survivors) == {"m2", "m3", "m4", "m5"}
    assert verdict.persist is None  # 아직 결과가 아니다


def test_잔류자가_하나면_그_사람이_최후_1인이다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "c"


def test_전원이_고립되면_가장_늦게_누른_사람이_최후_1인이다():
    """무효로 되돌리지 않는다 — 그 라운드에는 실제로 진전이 있었다."""
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000), up("c", 9000)])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "c"


def test_생존자_수가_줄면_라운드가_유한하게_끝난다():
    """종료 증명 — 자동 진행 갈래는 생존자 수를 반드시 줄인다."""
    verdict = judge(ctx(), [up("m1", 1000), up("m2", 5000), up("m3", 5100)])
    assert len(verdict.survivors) < len(MEMBERS)


# ── 최후 1인 판정 표기 ─────────────────────────────────────────────────────


def test_최후_1인의_판정이_LAST로_바뀐다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdicts_of(verdict)["c"] == Judgment.LAST


def test_가장_늦은_안전_확정자도_LAST로_표시된다():
    verdict = judge(ctx(("a", "b")), [up("a", 1000), up("b", 5000)])
    assert verdict.winner == "b"
    assert verdicts_of(verdict)["b"] == Judgment.LAST
    assert verdicts_of(verdict)["a"] == Judgment.SAFE


# ── 멱등과 결정성 ──────────────────────────────────────────────────────────


def test_같은_라운드에_두_번_누르면_최초_1회만_센다():
    """G-9 — 두 번째는 버린다."""
    doubled = [up("m1", 1000), up("m1", 1100, seq=1), up("m2", 5000), up("m3", 5100)]
    assert judge(ctx(), doubled).survivors == judge(
        ctx(), [up("m1", 1000), up("m2", 5000), up("m3", 5100)]
    ).survivors


def test_생존자가_아닌_사람의_입력은_보지_않는다():
    """안전 확정자의 추가 입력은 판정을 바꾸지 않는다."""
    alive = ("m3", "m4", "m5")
    with_ghost = judge(ctx(alive=alive), [up("m1", 1000), up("m3", 2000), up("m4", 9000)])
    without = judge(ctx(alive=alive), [up("m3", 2000), up("m4", 9000)])
    assert with_ghost.winner == without.winner


def test_같은_입력이면_판정이_언제나_같다():
    presses = [up("m1", 1000), up("m2", 5000), up("m3", 5100)]
    assert judge(ctx(), presses) == judge(ctx(), presses)


def test_같은_밀리초의_순서를_명단_인덱스로_고정한다():
    """결정성을 위한 규칙이며 다른 뜻은 없다."""
    result = judge_round(("m1", "m2"), {"m2": 1000, "m1": 1000}, W, order=MEMBERS)
    assert result["ordered"] == ("m1", "m2")


# ── 라운드 기록 ────────────────────────────────────────────────────────────


def test_기록이_생존자_전원의_판정을_담는다():
    """겹쳐서 남은 사람과 누르지 않아 남은 사람을 결과 화면이 구분해야 한다."""
    verdict = judge(ctx(("a", "b", "c")), [up("a", 2000), up("b", 2100)])
    assert verdicts_of(verdict) == {
        "a": Judgment.OVERLAP,
        "b": Judgment.OVERLAP,
        "c": Judgment.NO_INPUT,
    }


def test_미입력자의_입력_시각이_비어_있다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 2000), up("b", 2100)])
    rows = {r["memberId"]: r["offsetMs"] for r in verdict.detail["round"]["presses"]}
    assert rows["c"] is None
    assert rows["a"] == 2000


def test_기록이_누른_순으로_정렬된다():
    verdict = judge(ctx(("a", "b", "c")), [up("b", 5000), up("a", 1000)])
    assert [r["memberId"] for r in verdict.detail["round"]["presses"]] == ["a", "b", "c"]


def test_라운드_번호가_지난_기록_수에서_나온다():
    past = ({"roundNo": 1, "safeMemberIds": ["x"]}, {"roundNo": 2, "safeMemberIds": ["y"]})
    verdict = judge(ctx(("a", "b", "c"), history=past), [up("a", 2000), up("b", 2100)])
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
    past = ({"roundNo": 1, "safeMemberIds": ["x"], "presses": [], "remainingMemberIds": []},)
    verdict = judge(ctx(("a", "b", "c"), history=past), [up("a", 1000), up("b", 5000)])
    rounds = verdict.persist["rounds"]
    assert [r["roundNo"] for r in rounds] == [1, 2]


def test_무효_라운드가_있었으면_표시한다():
    past = ({"roundNo": 1, "safeMemberIds": [], "presses": [], "remainingMemberIds": []},)
    verdict = judge(ctx(("a", "b", "c"), history=past), [up("a", 1000), up("b", 5000)])
    assert verdict.persist["voidRound"] is True


def test_무효_라운드가_없었으면_거짓이다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.persist["voidRound"] is False


def test_확정이면_라운드_판정_공개로_넘어간다():
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.next_phase == Phase.ROUND_RESULT
    assert verdict.next_deadline == ROUND_RESULT_MS


# ── 판정창 설정 ────────────────────────────────────────────────────────────


def test_판정창_설정이_판정을_바꾼다():
    presses = [up("a", 1000), up("b", 1400), up("c", 9000)]
    assert judge(ctx(("a", "b", "c"), window_ms=300), presses).winner == "c"
    # 0.5초 판정창에서는 a와 b가 겹쳐 남고 c만 안전해진다
    assert judge(ctx(("a", "b", "c"), window_ms=500), presses).outcome is Outcome.TIE


# ── 경계값 ────────────────────────────────────────────────────────────────


def test_최소_인원_3에서_둘이_안전하면_남은_하나가_바로_뽑힌다():
    """라운드를 한 번 더 열지 않는다."""
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "c"


def test_최대_인원_10에서_판정한다():
    roster = tuple(f"p{i}" for i in range(10))
    presses = [up(m, 1000 + i * 1000) for i, m in enumerate(roster)]
    verdict = judge(ctx(roster), presses)
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "p9"  # 가장 늦게 누른 사람


def test_이탈자만_남으면_그_사람이_최후_1인이다():
    """이탈자는 매 라운드 미입력으로 남는다. 원천 예시의 도윤과 같은 경로다."""
    verdict = judge(ctx(("a", "b", "gone")), [up("a", 1000), up("b", 5000)])
    assert verdict.winner == "gone"


def test_생존자_명단이_비어_있으면_판정할_수_없다():
    with pytest.raises(ValueError):
        judge(ctx(alive=()), [])


def test_라운드_마감_뒤_도착은_뼈대가_거른다():
    """판정은 넘어온 입력만 본다 — 마감 판별은 단계 상태를 아는 쪽의 몫이다."""
    verdict = judge(ctx(("a", "b", "c")), [up("a", 1000), up("b", 5000)])
    assert verdict.winner == "c"
