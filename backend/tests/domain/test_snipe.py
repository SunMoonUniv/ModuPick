"""익명 저격 판정 — docs/05_game_rules/06_snipe.md 의 인수 기준 후보·경계값·반례"""

import pytest

from app.domain import errors
from app.domain.games.contract import JudgeContext, JudgeInput, Outcome
from app.domain.games.snipe import (
    GAME_ID,
    MAX_RUNOFFS,
    MIN_RUNOFF_MS,
    RESULT_SCHEMA_VERSION,
    REVEAL_MS,
    TIE_NOTICE_MS,
    VOTE_KIND,
    Phase,
    candidates_of,
    check_ballot,
    judge,
    pick_limit,
    runoff_ms,
)

SEED = 0x0123456789ABCDEF
MEMBERS = ("m1", "m2", "m3", "m4", "m5")


def ctx(
    roster: tuple[str, ...] = MEMBERS,
    *,
    seed: int = SEED,
    repeat: int = 0,
    tie_pool: tuple[str, ...] = (),
    multi_vote: bool = False,
    vote_seconds: int = 10,
) -> JudgeContext:
    return JudgeContext(
        round_id="3071",
        game_id=GAME_ID,
        seed=seed,
        roster=roster,
        config={
            "question": "발표를 제일 잘할 것 같은 사람은?",
            "voteSeconds": vote_seconds,
            "multiVote": multi_vote,
        },
        repeat=repeat,
        tie_pool=tie_pool,
    )


def shot(voter: str, *targets: str, seq: int = 0) -> JudgeInput:
    return JudgeInput(
        participant_id=voter, kind=VOTE_KIND, payload=list(targets), arrived_ms=100, seq=seq
    )


def hits_of(verdict) -> dict[str, int]:
    return {row["memberId"]: row["hitCount"] for row in verdict.persist["tally"]}


# ── 후보 집합 ──────────────────────────────────────────────────────────────


def test_본선_후보는_명단_스냅샷_전원이다():
    """도중 이탈자도 후보에 남고 뽑힐 수 있다."""
    assert candidates_of(ctx()) == MEMBERS


def test_결선_후보는_직전_동점자만_남는다():
    assert candidates_of(ctx(repeat=1, tie_pool=("m1", "m2"))) == ("m1", "m2")


# ── 지목 상한 ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "size, expected",
    [(3, 1), (4, 1), (5, 2), (6, 2), (7, 3), (8, 3), (9, 4), (10, 4)],
)
def test_중복_투표_상한이_후보_수의_절반이다(size, expected):
    """05_game_rules/06_snipe.md 「중복 투표 상한」 표 그대로다."""
    roster = tuple(f"p{i}" for i in range(size))
    assert pick_limit(roster, "p0", multi_vote=True, runoff=False) == expected


def test_중복_투표가_불가면_상한이_1이다():
    assert pick_limit(MEMBERS, "m1", multi_vote=False, runoff=False) == 1


def test_5명_미만이면_중복_투표를_켜도_1인_1표와_같다():
    for size in (3, 4):
        roster = tuple(f"p{i}" for i in range(size))
        assert pick_limit(roster, "p0", multi_vote=True, runoff=False) == 1


def test_결선은_중복_투표_설정과_무관하게_1이다():
    """후보 2명에 상한 2면 두 후보가 같은 폭으로 늘어 동점이 재생산된다."""
    assert pick_limit(("m1", "m2"), "m1", multi_vote=True, runoff=True) == 1
    assert pick_limit(MEMBERS, "m1", multi_vote=True, runoff=True) == 1


# ── 접수 검증 ──────────────────────────────────────────────────────────────


def test_상한까지_다_고르지_않아도_유효하다():
    """부분 지목을 허용한다. 1명 이상이면 유효한 투표다."""
    check_ballot(MEMBERS, "m1", ["m2"], multi_vote=True, runoff=False)


def test_상한을_넘기면_요청_전체를_거절한다():
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(MEMBERS, "m1", ["m2", "m3", "m4"], multi_vote=True, runoff=False)
    assert exc.value.spec is errors.VOTE_LIMIT_EXCEEDED


def test_10명방에서_전원_지목_시도를_막는다():
    """표를 균등하게 만들어 판을 무의미하게 하는 경로다."""
    roster = tuple(f"p{i}" for i in range(10))
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(roster, "p0", list(roster[1:]), multi_vote=True, runoff=False)
    assert exc.value.spec is errors.VOTE_LIMIT_EXCEEDED


def test_0명_지목은_받지_않는다():
    with pytest.raises(errors.DomainError):
        check_ballot(MEMBERS, "m1", [], multi_vote=True, runoff=False)


def test_같은_대상을_두_번_담으면_거절한다():
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(MEMBERS, "m1", ["m2", "m2"], multi_vote=True, runoff=False)
    assert exc.value.spec is errors.VOTE_DUPLICATE_TARGET


def test_자기_자신은_지목할_수_없다():
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(MEMBERS, "m1", ["m1"], multi_vote=False, runoff=False)
    assert exc.value.spec is errors.VOTE_SELF_NOT_ALLOWED


def test_후보_밖의_대상은_거절한다():
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(("m1", "m2"), "m1", ["m3"], multi_vote=False, runoff=True)
    assert exc.value.spec is errors.VOTE_TARGET_NOT_FOUND


def test_결선_후보에_자기가_남아도_투표할_수_있다():
    """후보가 2명 이상이므로 자기를 빼도 최소 1명이 남는다."""
    finalists = ("m1", "m2")
    with pytest.raises(errors.DomainError):
        check_ballot(finalists, "m1", ["m1"], multi_vote=False, runoff=True)
    check_ballot(finalists, "m1", ["m2"], multi_vote=False, runoff=True)


# ── 결선 투표 시간 ─────────────────────────────────────────────────────────


def test_결선_시간이_본선의_절반이다():
    assert runoff_ms(60) == 30_000
    assert runoff_ms(20) == 10_000


def test_본선이_최소값이면_결선도_5초를_유지한다():
    """절반인 2.5초로 내려가지 않는다."""
    assert runoff_ms(5) == MIN_RUNOFF_MS
    assert runoff_ms(10) == MIN_RUNOFF_MS


# ── 개표 ───────────────────────────────────────────────────────────────────


def test_최다_피격이_뽑힌다():
    ballots = [shot("m1", "m2"), shot("m3", "m2"), shot("m4", "m5")]
    verdict = judge(ctx(), ballots)
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "m2"
    assert hits_of(verdict) == {"m1": 0, "m2": 2, "m3": 0, "m4": 0, "m5": 1}


def test_개표가_피격_순으로_정렬된다():
    ballots = [shot("m1", "m3"), shot("m2", "m3"), shot("m4", "m5")]
    rows = judge(ctx(), ballots).persist["tally"]
    assert [r["hitCount"] for r in rows] == [2, 1, 0, 0, 0]
    assert rows[0]["memberId"] == "m3"


def test_표를_세는_순서가_결과를_바꾸지_않는다():
    ballots = [shot("m1", "m2"), shot("m3", "m2"), shot("m4", "m5")]
    assert hits_of(judge(ctx(), ballots)) == hits_of(judge(ctx(), list(reversed(ballots))))


def test_전원이_같은_밀리초에_도착해도_결과가_같다():
    same = [
        JudgeInput("m1", VOTE_KIND, ["m2"], arrived_ms=500, seq=0),
        JudgeInput("m3", VOTE_KIND, ["m2"], arrived_ms=500, seq=1),
    ]
    assert judge(ctx(), same).winner == "m2"


def test_같은_지목이_여러_번_도착해도_표가_늘지_않는다():
    """G-9 멱등 — 최초 1회만 인정한다."""
    repeated = [shot("m1", "m2", seq=i) for i in range(3)]
    assert hits_of(judge(ctx(), repeated))["m2"] == 1


def test_중복_투표로_여러_명을_지목한다():
    ballots = [shot("m1", "m2", "m3"), shot("m4", "m2")]
    verdict = judge(ctx(multi_vote=True), ballots)
    assert verdict.winner == "m2"
    assert hits_of(verdict)["m3"] == 1


def test_기권_수를_센다():
    """명단 5명 중 2명만 투표하면 기권이 3명이다."""
    verdict = judge(ctx(), [shot("m1", "m2"), shot("m3", "m2")])
    assert verdict.persist["abstainCount"] == 3


# ── 동점과 결선 ────────────────────────────────────────────────────────────


def test_동점이면_결선을_연다():
    verdict = judge(ctx(), [shot("m1", "m2"), shot("m2", "m1")])
    assert verdict.outcome is Outcome.TIE
    assert set(verdict.tie_pool) == {"m1", "m2"}
    assert verdict.next_phase == Phase.TIE_NOTICE
    assert verdict.next_deadline == TIE_NOTICE_MS


def test_결선_통지는_피격_수를_내보내지_않는다():
    """G-10 — 동점자 명단만 보이고 피격 수는 최종 개표에서만 공개한다."""
    verdict = judge(ctx(), [shot("m1", "m2"), shot("m2", "m1")])
    assert verdict.persist is None
    assert verdict.tally is None


@pytest.mark.parametrize("repeat", [1, 2])
def test_결선_상한_전까지는_계속_결선을_연다(repeat):
    verdict = judge(
        ctx(repeat=repeat, tie_pool=("m1", "m2")),
        [shot("m3", "m1"), shot("m4", "m2")],
    )
    assert verdict.outcome is Outcome.TIE


def test_결선을_3회_소진하면_방장_선택으로_넘어간다():
    verdict = judge(
        ctx(repeat=MAX_RUNOFFS, tie_pool=("m1", "m2")),
        [shot("m3", "m1"), shot("m4", "m2")],
    )
    assert verdict.outcome is Outcome.HOST_CHOICE
    assert set(verdict.tie_pool) == {"m1", "m2"}
    assert verdict.next_phase == Phase.DEADLOCK
    assert verdict.next_deadline is None


def test_결선은_동점자만_집계한다():
    """탈락한 후보로 온 표는 세지 않는다."""
    verdict = judge(ctx(repeat=1, tie_pool=("m1", "m2")), [shot("m3", "m1"), shot("m4", "m5")])
    assert verdict.winner == "m1"
    assert "m5" not in hits_of(verdict)


def test_결선에도_명단_전원이_투표한다():
    """후보가 아닌 참가자도 투표권을 잃지 않는다."""
    verdict = judge(ctx(repeat=1, tie_pool=("m1", "m2")), [shot("m5", "m1")])
    assert verdict.winner == "m1"
    assert verdict.persist["abstainCount"] == 4  # 5명 중 1명만 투표했다


def test_반례_3명_순환_지목은_3중_동점이_된다():
    """01_common.md 반례 3 — 상한 없는 결선을 폐기한 근거다."""
    trio = ("a", "b", "c")
    ballots = [shot("a", "b"), shot("b", "c"), shot("c", "a")]
    verdict = judge(ctx(trio), ballots)
    assert verdict.outcome is Outcome.TIE
    assert set(verdict.tie_pool) == set(trio)


def test_반례_기권_섞인_1대1_동점():
    """A가 B를 B가 A를 지목하고 C는 기권하면 1:1이다."""
    trio = ("a", "b", "c")
    verdict = judge(ctx(trio), [shot("a", "b"), shot("b", "a")])
    assert verdict.outcome is Outcome.TIE
    assert set(verdict.tie_pool) == {"a", "b"}


# ── 유효표 0 ───────────────────────────────────────────────────────────────


def test_전원_기권이면_결선을_열지_않고_난수로_확정한다():
    verdict = judge(ctx(), [])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner in MEMBERS
    assert verdict.persist["decidedByRandom"] is True
    assert verdict.persist["abstainCount"] == len(MEMBERS)


def test_유효표_0의_확정이_명단_순서를_따르지_않는다():
    """정렬 첫 번째를 뽑으면 명단 순서를 아는 참가자에게 결과가 예측된다."""
    winners = {judge(ctx(seed=s), []).winner for s in range(200)}
    assert winners == set(MEMBERS)


def test_유효표_0의_확정이_시드로_재현된다():
    assert judge(ctx(), []) == judge(ctx(), [])


def test_결선_회차마다_다른_난수를_쓴다():
    winners = {
        judge(ctx(repeat=r, tie_pool=MEMBERS), []).winner for r in range(MAX_RUNOFFS + 1)
    }
    assert len(winners) > 1


def test_결선에서_전원_기권하면_결선_후보_중에서_뽑는다():
    finalists = ("m1", "m2")
    verdict = judge(ctx(repeat=1, tie_pool=finalists), [])
    assert verdict.winner in finalists
    assert verdict.persist["decidedByRandom"] is True


def test_표가_하나라도_있으면_난수를_쓰지_않는다():
    assert judge(ctx(), [shot("m1", "m2")]).persist["decidedByRandom"] is False


# ── 익명성 ────────────────────────────────────────────────────────────────


def test_지목_쌍이_결과_어디에도_담기지_않는다():
    """이를 여는 설정은 없다. 결과에 남는 것은 피격 수뿐이다."""
    verdict = judge(ctx(), [shot("m1", "m2"), shot("m3", "m2")])
    assert verdict.persist.keys() == {
        "schemaVersion",
        "tally",
        "winnerMemberIds",
        "ballotRounds",
        "abstainCount",
        "decidedByRandom",
    }
    assert all(row.keys() == {"memberId", "hitCount"} for row in verdict.persist["tally"])


def test_지목자를_여는_축이_없다():
    assert judge(ctx(), [shot("m1", "m2")]).reveal == {"voters": False}


# ── 저장 형식 ─────────────────────────────────────────────────────────────


def test_저장_형식이_result_data_스키마를_따른다():
    verdict = judge(ctx(), [shot("m1", "m2")])
    assert verdict.persist["schemaVersion"] == RESULT_SCHEMA_VERSION
    assert verdict.persist["winnerMemberIds"] == ["m2"]  # 한 명뿐이어도 배열이다


def test_투표_회차가_본선_1회에_결선_횟수를_더한_값이다():
    for repeat in range(MAX_RUNOFFS + 1):
        verdict = judge(ctx(repeat=repeat, tie_pool=MEMBERS), [shot("m1", "m2")])
        assert verdict.persist["ballotRounds"] == repeat + 1


def test_확정이면_공개_연출로_넘어간다():
    verdict = judge(ctx(), [shot("m1", "m2")])
    assert verdict.next_phase == Phase.REVEAL
    assert verdict.next_deadline == REVEAL_MS


def test_승자와_개표가_저장과_어긋나지_않는다():
    verdict = judge(ctx(), [shot("m1", "m2")])
    assert verdict.tally == verdict.persist["tally"]
    assert [verdict.winner] == verdict.persist["winnerMemberIds"]


# ── 경계값 ────────────────────────────────────────────────────────────────


def test_최소_인원_3에서_판정한다():
    trio = ("a", "b", "c")
    verdict = judge(ctx(trio), [shot("a", "b"), shot("c", "b")])
    assert verdict.winner == "b"


def test_최대_인원_10에서_판정한다():
    roster = tuple(f"p{i}" for i in range(10))
    verdict = judge(ctx(roster), [shot("p0", "p5"), shot("p1", "p5")])
    assert verdict.winner == "p5"
    assert len(verdict.persist["tally"]) == 10


def test_1명만_투표해도_그_표로_확정한다():
    """이탈자는 기권으로 확정되고 후보로는 남아 뽑힐 수 있다."""
    verdict = judge(ctx(), [shot("m1", "m4")])
    assert verdict.winner == "m4"
    assert verdict.persist["abstainCount"] == 4


def test_후보가_1명이면_방어적으로_확정한다():
    """정상 경로에서는 발생하지 않는다(06_snipe.md 논증)."""
    verdict = judge(ctx(repeat=1, tie_pool=("m1",)), [shot("m2", "m1")])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "m1"


def test_후보가_비어_있으면_판정할_수_없다():
    with pytest.raises(ValueError):
        judge(ctx(repeat=1, tie_pool=()), [])
