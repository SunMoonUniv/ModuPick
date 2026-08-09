"""킹메이커 판정 — docs/05_game_rules/04_kingmaker.md 의 인수 기준 후보·경계값·반례"""

import pytest

from app.domain import errors
from app.domain.games.contract import Candidate, JudgeContext, JudgeInput, Outcome
from app.domain.games.kingmaker import (
    GAME_ID,
    MAX_RUNOFFS,
    RESULT_SCHEMA_VERSION,
    RUNOFF_QUOTA,
    TALLY_MS,
    TIE_NOTICE_MS,
    VOTE_KIND,
    Phase,
    check_ballot,
    effective_quota,
    judge,
    shuffle_candidates,
    votable_count,
)

SEED = 0x0123456789ABCDEF
MEMBERS = ("m1", "m2", "m3", "m4", "m5")


def cand(n: int, author: str) -> Candidate:
    return Candidate(id=f"opt_{n}", text=f"안건{n}", author_id=author)


#: 5명 중 3명이 제출한 통상 배치.
CANDS = (cand(1, "m1"), cand(2, "m2"), cand(3, "m3"))


def ctx(
    candidates: tuple[Candidate, ...] = CANDS,
    *,
    seed: int = SEED,
    roster: tuple[str, ...] = MEMBERS,
    repeat: int = 0,
    votes_per_member: int = 1,
    reveal_authors: bool = False,
) -> JudgeContext:
    return JudgeContext(
        round_id="3071",
        game_id=GAME_ID,
        seed=seed,
        roster=roster,
        config={
            "topic": "팀명",
            "votesPerMember": votes_per_member,
            "revealAuthors": reveal_authors,
        },
        candidates=candidates,
        repeat=repeat,
    )


def vote(voter: str, *picks: str, seq: int = 0) -> JudgeInput:
    return JudgeInput(
        participant_id=voter, kind=VOTE_KIND, payload=list(picks), arrived_ms=100, seq=seq
    )


def counts_of(verdict) -> dict[str, int]:
    return {row["optionId"]: row["voteCount"] for row in verdict.persist["tally"]}


# ── 실효 투표 수 ───────────────────────────────────────────────────────────


def test_자기_안건은_투표_가능_후보에서_빠진다():
    assert votable_count(CANDS, "m1") == 2  # 자기 안건 1개 제외
    assert votable_count(CANDS, "m5") == 3  # 미제출자는 전부 고를 수 있다


def test_실효_상한이_설정값과_투표_가능_후보_수의_최솟값이다():
    """방장이 3표로 설정해도 안건이 모자라면 그만큼만 쓴다."""
    assert effective_quota(CANDS, "m1", 3) == 2  # min(3, 2)
    assert effective_quota(CANDS, "m5", 3) == 3  # min(3, 3)
    assert effective_quota(CANDS, "m5", 1) == 1  # min(1, 3)


def test_최소_인원_3에서_3표_설정의_실효_상한은_2다():
    """05_game_rules/04 경계값 표 — 안건이 최대 3개이고 하나가 자기 것이다."""
    assert effective_quota(CANDS, "m1", 3) == 2


# ── 접수 검증 ──────────────────────────────────────────────────────────────


def test_표를_다_쓰지_않아도_유효한_투표다():
    """Qi가 V보다 작아지는 조합에서 V표를 강제하면 강제 기권이 된다."""
    check_ballot(CANDS, "m5", ["opt_1"], quota=3)


def test_상한을_넘으면_요청_전체를_거절한다():
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(CANDS, "m1", ["opt_2", "opt_3"], quota=1)
    assert exc.value.spec is errors.VOTE_LIMIT_EXCEEDED


def test_자기_안건이_섞이면_실효_상한이_줄어_거절된다():
    """1인 3표·후보 3개·그중 하나가 자기 안건이면 상한이 2다."""
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(CANDS, "m1", ["opt_2", "opt_3", "opt_1"], quota=3)
    assert exc.value.spec is errors.VOTE_LIMIT_EXCEEDED


def test_0표_제출은_받지_않는다():
    """기권과 0표 제출을 구분할 실익이 없다. 마감까지 안 내면 기권이다."""
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(CANDS, "m5", [], quota=3)
    assert exc.value.spec is errors.VOTE_LIMIT_EXCEEDED


def test_같은_안건에_여러_표를_주면_거절한다():
    """몰아주기를 허용하면 1인 3표가 3배 가중 1표가 된다."""
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(CANDS, "m5", ["opt_1", "opt_1"], quota=3)
    assert exc.value.spec is errors.VOTE_DUPLICATE_TARGET


def test_없는_후보를_고르면_거절한다():
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(CANDS, "m5", ["opt_99"], quota=1)
    assert exc.value.spec is errors.VOTE_TARGET_NOT_FOUND


def test_자기가_낸_안건에는_투표할_수_없다():
    with pytest.raises(errors.DomainError) as exc:
        check_ballot(CANDS, "m1", ["opt_1"], quota=1)
    assert exc.value.spec is errors.VOTE_SELF_NOT_ALLOWED


def test_결선에서도_자기_안건_금지가_그대로다():
    """결선 후보는 2개 이상이고 1인이 낸 안건은 최대 1건이라 투표 불가자는 없다."""
    finalists = (CANDS[0], CANDS[1])
    assert effective_quota(finalists, "m1", RUNOFF_QUOTA) == 1
    with pytest.raises(errors.DomainError):
        check_ballot(finalists, "m1", ["opt_1"], quota=RUNOFF_QUOTA)
    check_ballot(finalists, "m1", ["opt_2"], quota=RUNOFF_QUOTA)


# ── 후보 순서 섞기 ─────────────────────────────────────────────────────────


def test_후보_순서가_시드로_결정되고_전원에게_같다():
    assert shuffle_candidates(CANDS, SEED) == shuffle_candidates(CANDS, SEED)


def test_후보_순서가_제출_순서와_달라진다():
    """제출 순서를 그대로 쓰면 먼저 낸 사람이 앞이라는 제출자 힌트가 된다."""
    orders = {shuffle_candidates(CANDS, s) for s in range(200)}
    assert len(orders) > 1


def test_섞는_것은_표시_전용이고_개표를_바꾸지_않는다():
    ballots = [vote("m4", "opt_1"), vote("m5", "opt_1"), vote("m2", "opt_3")]
    plain = judge(ctx(CANDS), ballots)
    shuffled = judge(ctx(shuffle_candidates(CANDS, SEED)), ballots)
    assert counts_of(plain) == counts_of(shuffled)
    assert plain.winner == shuffled.winner


# ── 개표 ───────────────────────────────────────────────────────────────────


def test_단독_최다면_확정한다():
    ballots = [vote("m2", "opt_1"), vote("m3", "opt_1"), vote("m4", "opt_2")]
    verdict = judge(ctx(), ballots)
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "opt_1"
    assert counts_of(verdict) == {"opt_1": 2, "opt_2": 1, "opt_3": 0}


def test_개표가_득표_순으로_정렬된다():
    ballots = [vote("m1", "opt_3"), vote("m2", "opt_3"), vote("m4", "opt_2")]
    rows = judge(ctx(), ballots).persist["tally"]
    assert [r["voteCount"] for r in rows] == [2, 1, 0]
    assert rows[0]["optionId"] == "opt_3"


def test_개표_행이_안건_문구를_함께_담는다():
    row = judge(ctx(), [vote("m4", "opt_1")]).persist["tally"][0]
    assert row == {"optionId": "opt_1", "label": "안건1", "voteCount": 1}


def test_미제출자도_투표한다():
    """제출은 권리이지 투표의 조건이 아니다(D-25)."""
    verdict = judge(ctx(), [vote("m5", "opt_2")])  # m5는 미제출자
    assert verdict.winner == "opt_2"


def test_표를_세는_순서가_결과를_바꾸지_않는다():
    ballots = [vote("m1", "opt_2"), vote("m2", "opt_3"), vote("m4", "opt_2")]
    assert counts_of(judge(ctx(), ballots)) == counts_of(judge(ctx(), list(reversed(ballots))))


def test_전원이_같은_밀리초에_도착해도_결과가_같다():
    """도착 시각은 판정에 들어가지 않는다."""
    same = [
        JudgeInput("m4", VOTE_KIND, ["opt_1"], arrived_ms=500, seq=0),
        JudgeInput("m5", VOTE_KIND, ["opt_1"], arrived_ms=500, seq=1),
    ]
    assert judge(ctx(), same).winner == "opt_1"


def test_같은_투표가_여러_번_도착해도_표가_늘지_않는다():
    """G-9 멱등 — 최초 1회만 인정한다."""
    repeated = [vote("m4", "opt_1", seq=i) for i in range(3)]
    assert counts_of(judge(ctx(), repeated))["opt_1"] == 1


def test_한_사람이_여러_표를_서로_다른_안건에_나눠_준다():
    """m5의 2표가 두 안건에 각각 들어간다. m4의 1표가 동점을 끊어 확정으로 만든다."""
    ballots = [vote("m5", "opt_1", "opt_2"), vote("m4", "opt_1")]
    assert counts_of(judge(ctx(votes_per_member=2), ballots)) == {
        "opt_1": 2,
        "opt_2": 1,
        "opt_3": 0,
    }


# ── 동점과 결선 ────────────────────────────────────────────────────────────


def test_동점이면_결선을_연다():
    ballots = [vote("m4", "opt_1"), vote("m5", "opt_2")]
    verdict = judge(ctx(), ballots)
    assert verdict.outcome is Outcome.TIE
    assert set(verdict.tie_pool) == {"opt_1", "opt_2"}
    assert verdict.next_phase == Phase.TIE_NOTICE
    assert verdict.next_deadline == TIE_NOTICE_MS


def test_결선_통지는_득표_수를_내보내지_않는다():
    """G-10 — 동점 후보 목록만 보이고 득표 수는 최종 개표에서만 공개한다."""
    verdict = judge(ctx(), [vote("m4", "opt_1"), vote("m5", "opt_2")])
    assert verdict.persist is None
    assert verdict.tally is None


@pytest.mark.parametrize("repeat", [0, 1, 2])
def test_결선_상한_전까지는_계속_결선을_연다(repeat):
    ballots = [vote("m4", "opt_1"), vote("m5", "opt_2")]
    assert judge(ctx(repeat=repeat), ballots).outcome is Outcome.TIE


def test_결선을_3회_소진하면_방장_선택으로_넘어간다():
    """엔진이 TIE 대신 HOST_CHOICE를 낸다(ADR-19). 종료 증명의 근거다."""
    ballots = [vote("m4", "opt_1"), vote("m5", "opt_2")]
    verdict = judge(ctx(repeat=MAX_RUNOFFS), ballots)
    assert verdict.outcome is Outcome.HOST_CHOICE
    assert set(verdict.tie_pool) == {"opt_1", "opt_2"}
    assert verdict.next_phase == Phase.DEADLOCK
    assert verdict.next_deadline is None  # 타이머가 없는 정지 상태다


def test_결선에서_탈락한_후보로_온_표는_세지_않는다():
    finalists = (CANDS[0], CANDS[1])
    verdict = judge(ctx(finalists, repeat=1), [vote("m4", "opt_1"), vote("m5", "opt_3")])
    assert verdict.winner == "opt_1"
    assert "opt_3" not in counts_of(verdict)


def test_반례_4명_4안건_3표는_4중_동점이_된다():
    """01_common.md 반례 1 — 각자 자기 안건을 뺀 3개에 줄 수밖에 없다."""
    members = ("p1", "p2", "p3", "p4")
    cands = tuple(cand(i + 1, m) for i, m in enumerate(members))
    ballots = [
        vote(m, *[c.id for c in cands if c.author_id != m]) for m in members
    ]
    verdict = judge(ctx(cands, roster=members, votes_per_member=3), ballots)
    assert verdict.outcome is Outcome.TIE
    assert len(verdict.tie_pool) == 4


def test_반례_3명_2안건_상호_배제는_1대1_동점이_된다():
    """01_common.md 반례 2 — 미제출자가 기권하면 A·B가 각 1표다."""
    cands = (cand(1, "p1"), cand(2, "p2"))
    ballots = [vote("p1", "opt_2"), vote("p2", "opt_1")]  # p3 기권
    verdict = judge(ctx(cands, roster=("p1", "p2", "p3")), ballots)
    assert verdict.outcome is Outcome.TIE
    assert set(verdict.tie_pool) == {"opt_1", "opt_2"}


# ── 유효표 0 ───────────────────────────────────────────────────────────────


def test_전원_기권이면_결선을_열지_않고_난수로_확정한다():
    """결선을 열어도 같은 0표 동점이 재생산된다(01_common.md)."""
    verdict = judge(ctx(), [])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner in {c.id for c in CANDS}
    assert verdict.persist["decidedByRandom"] is True
    assert all(row["voteCount"] == 0 for row in verdict.persist["tally"])


def test_유효표_0의_확정이_시드로_재현된다():
    assert judge(ctx(), []) == judge(ctx(), [])


def test_유효표_0의_확정이_시드에_따라_갈린다():
    assert len({judge(ctx(seed=s), []).winner for s in range(200)}) == len(CANDS)


def test_결선_회차마다_다른_난수를_쓴다():
    """같은 시드라도 회차가 다르면 같은 후보가 계속 뽑히지 않는다."""
    winners = {judge(ctx(repeat=r), []).winner for r in range(MAX_RUNOFFS + 1)}
    assert len(winners) > 1


def test_표가_하나라도_있으면_난수를_쓰지_않는다():
    verdict = judge(ctx(), [vote("m4", "opt_1")])
    assert verdict.persist["decidedByRandom"] is False


# ── 안건 수 분기 ───────────────────────────────────────────────────────────


def test_안건이_0개면_결과_없이_끝난다():
    verdict = judge(ctx(()), [])
    assert verdict.outcome is Outcome.VOID
    assert verdict.next_phase == Phase.VOID
    assert verdict.persist is None  # 결과를 남기지 않는다


def test_안건이_1개면_투표를_건너뛰고_확정한다():
    only = (cand(1, "m1"),)
    verdict = judge(ctx(only), [])
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "opt_1"


def test_안건_1개의_확정은_난수가_아니다():
    """표가 없는 것이 기권이 아니라 설계다. 유효표 0 분기보다 먼저 본다."""
    verdict = judge(ctx((cand(1, "m1"),)), [])
    assert verdict.persist["decidedByRandom"] is False


def test_문구가_같아도_후보_ID가_다르면_별개다():
    twins = (
        Candidate(id="opt_1", text="같은 문구", author_id="m1"),
        Candidate(id="opt_2", text="같은 문구", author_id="m2"),
    )
    verdict = judge(ctx(twins), [vote("m4", "opt_1"), vote("m5", "opt_2")])
    assert verdict.outcome is Outcome.TIE


# ── 익명성 ────────────────────────────────────────────────────────────────


def test_익명이면_제출자를_저장하지도_않는다():
    """result_data는 방이 사는 동안 남으므로 담아 두면 유출 경로가 된다."""
    verdict = judge(ctx(reveal_authors=False), [vote("m4", "opt_1")])
    assert "authors" not in verdict.persist
    assert verdict.reveal == {"authors": False}


def test_실명이면_안건별_제출자를_담는다():
    verdict = judge(ctx(reveal_authors=True), [vote("m4", "opt_1")])
    assert verdict.persist["authors"] == [
        {"optionId": "opt_1", "memberId": "m1"},
        {"optionId": "opt_2", "memberId": "m2"},
        {"optionId": "opt_3", "memberId": "m3"},
    ]
    assert verdict.reveal == {"authors": True}


@pytest.mark.parametrize("reveal", [True, False])
def test_투표자는_어느_설정에서도_공개하지_않는다(reveal):
    """공개 대상은 제출자뿐이다. 축 자체를 두지 않는다."""
    verdict = judge(ctx(reveal_authors=reveal), [vote("m4", "opt_1")])
    assert "voters" not in verdict.persist
    assert "voterMemberIds" not in verdict.persist
    assert verdict.reveal.keys() == {"authors"}


def test_투표자가_저장_어디에도_나타나지_않는다():
    verdict = judge(ctx(reveal_authors=True), [vote("m4", "opt_1"), vote("m5", "opt_2")])
    assert "m4" not in repr(verdict.persist)
    assert "m5" not in repr(verdict.persist)


# ── 저장 형식 ─────────────────────────────────────────────────────────────


def test_저장_형식이_result_data_스키마를_따른다():
    verdict = judge(ctx(), [vote("m4", "opt_1")])
    assert verdict.persist.keys() == {
        "schemaVersion",
        "tally",
        "winnerOptionIds",
        "ballotRounds",
        "decidedByRandom",
    }
    assert verdict.persist["schemaVersion"] == RESULT_SCHEMA_VERSION
    assert verdict.persist["winnerOptionIds"] == ["opt_1"]


def test_투표_회차가_본선_1회에_결선_횟수를_더한_값이다():
    """본선 1회 + 결선 최대 3회 = 최대 4회(01_common.md)."""
    for repeat in range(MAX_RUNOFFS + 1):
        verdict = judge(ctx(repeat=repeat), [vote("m4", "opt_1")])
        assert verdict.persist["ballotRounds"] == repeat + 1


def test_확정이면_개표_연출로_넘어간다():
    verdict = judge(ctx(), [vote("m4", "opt_1")])
    assert verdict.next_phase == Phase.TALLY
    assert verdict.next_deadline == TALLY_MS


def test_승자와_개표가_저장과_어긋나지_않는다():
    verdict = judge(ctx(), [vote("m4", "opt_1")])
    assert verdict.tally == verdict.persist["tally"]
    assert [verdict.winner] == verdict.persist["winnerOptionIds"]


# ── 경계값 ────────────────────────────────────────────────────────────────


def test_1명만_남아도_그_표로_확정한다():
    """이탈자는 기권으로 확정되고 남은 표로 단독 최다가 나오면 그대로 간다."""
    verdict = judge(ctx(), [vote("m4", "opt_2")])
    assert verdict.winner == "opt_2"


def test_최대_인원_10명_10안건에서_판정한다():
    members = tuple(f"p{i}" for i in range(10))
    cands = tuple(cand(i + 1, m) for i, m in enumerate(members))
    verdict = judge(ctx(cands, roster=members), [vote("p0", "opt_2")])
    assert verdict.winner == "opt_2"
    assert len(verdict.persist["tally"]) == 10
