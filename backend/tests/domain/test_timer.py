"""시간초 잡기 판정 — docs/05_game_rules/05_timer.md 의 인수 기준 후보·경계값·반례"""

import pytest

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome
from app.domain.games.timer import (
    GAME_ID,
    MARGIN_MS,
    MAX_REMATCHES,
    REVEAL_MS,
    START_DEADLINE_MS,
    START_KIND,
    STOP_KIND,
    TIE_NOTICE_MS,
    Phase,
    Source,
    Status,
    entrants_of,
    judge,
    limit_ms,
    measure,
    round_deadline_ms,
)

MEMBERS = ("m1", "m2", "m3")
TARGET = 5_000  # 목표 5초


def ctx(
    roster: tuple[str, ...] = MEMBERS,
    *,
    target_seconds: int = 5,
    criterion: str = "CLOSEST",
    repeat: int = 0,
    tie_pool: tuple[str, ...] = (),
) -> JudgeContext:
    return JudgeContext(
        round_id="4120",
        game_id=GAME_ID,
        seed=0x0123456789ABCDEF,
        roster=roster,
        config={"topic": "팀장", "targetSeconds": target_seconds, "criterion": criterion},
        phase=Phase.RUNNING,
        repeat=repeat,
        tie_pool=tie_pool,
    )


def start(member: str, at_ms: int = 0) -> JudgeInput:
    return JudgeInput(participant_id=member, kind=START_KIND, arrived_ms=at_ms)


def stop(member: str, at_ms: int, elapsed=None) -> JudgeInput:
    """신고값을 주지 않으면 정직한 클라이언트로 본다 — 서버 관측값과 같게 보낸다."""
    return JudgeInput(participant_id=member, kind=STOP_KIND, payload=elapsed, arrived_ms=at_ms)


def honest(member: str, elapsed: int, at_ms: int = 0) -> list[JudgeInput]:
    """START 후 정확히 elapsed 뒤에 STOP이 닿고 신고값도 그 값인 참가자."""
    return [start(member, at_ms), stop(member, at_ms + elapsed, elapsed)]


def rows_of(verdict) -> dict[str, dict]:
    return {r["memberId"]: r for r in verdict.persist["records"]}


def ranking_of(verdict) -> tuple[str, ...]:
    return tuple(r["memberId"] for r in verdict.persist["records"])


# ── 인수 기준 ──────────────────────────────────────────────────────────────


def test_가장_가까운_사람이_뽑힌다():
    """A 4910 · B 5030 · C 5420 → 오차 90 · 30 · 420 이므로 B."""
    verdict = judge(ctx(), [*honest("m1", 4910), *honest("m2", 5030), *honest("m3", 5420)])

    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner == "m2"
    assert verdict.next_phase == Phase.REVEAL
    assert verdict.next_deadline == REVEAL_MS


def test_같은_기록에서_가장_먼_사람_기준이면_뒤집힌다():
    inputs = [*honest("m1", 4910), *honest("m2", 5030), *honest("m3", 5420)]

    assert judge(ctx(criterion="FARTHEST"), inputs).winner == "m3"


def test_표시용_시간_차이는_부호를_갖는다():
    verdict = judge(ctx(), [*honest("m1", 4910), *honest("m2", 5030), *honest("m3", 5420)])
    rows = rows_of(verdict)

    assert [rows[m]["diffMs"] for m in MEMBERS] == [-90, 30, 420]
    assert [rows[m]["absDiffMs"] for m in MEMBERS] == [90, 30, 420]


def test_STOP을_두_번_누르면_최초_1회만_접수된다():
    inputs = [start("m1"), stop("m1", 4910, 4910), stop("m1", 5000, 5000)]
    inputs += honest("m2", 9999)

    assert rows_of(judge(ctx(), inputs))["m1"]["elapsedMs"] == 4910


def test_START_마감까지_누르지_않으면_미시작이다():
    verdict = judge(ctx(), [*honest("m1", 4990), *honest("m2", 4000)])
    rows = rows_of(verdict)

    assert rows["m3"]["status"] == Status.NO_START
    assert rows["m3"]["elapsedMs"] is None
    assert verdict.winner != "m3"


def test_개인_제한까지_멈추지_않으면_미정지다():
    over = limit_ms(TARGET) + 1
    inputs = [*honest("m1", 4990), start("m2"), stop("m2", over, over)]

    rows = rows_of(judge(ctx(), inputs))
    assert rows["m2"]["status"] == Status.NO_STOP
    assert rows["m2"]["elapsedMs"] is None


def test_가장_먼_사람_기준에서도_미입력자는_승자가_아니다():
    """미입력이 최적 전략이 되면 게임이 성립하지 않는다."""
    verdict = judge(ctx(criterion="FARTHEST"), [*honest("m1", 4990), *honest("m2", 5400)])

    assert verdict.winner == "m2"


def test_START_없이_STOP만_보내면_보지_않는다():
    verdict = judge(ctx(), [*honest("m1", 4990), stop("m2", 3000, 3000)])

    assert rows_of(verdict)["m2"]["status"] == Status.NO_START


def test_같은_입력으로_다시_판정하면_순위표가_같다():
    inputs = [*honest("m1", 5100), *honest("m2", 4950), *honest("m3", 5300)]

    assert ranking_of(judge(ctx(), inputs)) == ranking_of(judge(ctx(), inputs))


# ── 클라이언트 신고값의 검증 ───────────────────────────────────────────────


def test_허용_오차_안이면_신고값을_채택한다():
    """서버 관측 5000 · 신고 4900 → 100ms 차이는 통과한다."""
    verdict = judge(ctx(), [start("m1"), stop("m1", 5000, 4900), *honest("m2", 3000)])
    row = rows_of(verdict)["m1"]

    assert row["elapsedMs"] == 4900
    assert row["source"] == Source.CLIENT_MEASURED


def test_허용_오차_밖이면_서버_관측값으로_대체한다():
    """1000ms를 당겨 신고해도 이득이 없다. 승자 후보에는 그대로 남는다."""
    verdict = judge(ctx(), [start("m1"), stop("m1", 5000, 4000), *honest("m2", 3000)])
    row = rows_of(verdict)["m1"]

    assert row["elapsedMs"] == 5000
    assert row["source"] == Source.SERVER_OBSERVED
    assert row["status"] == Status.RECORDED
    assert verdict.winner == "m1"  # 서버 관측값으로도 오차가 가장 작다


def test_차이가_정확히_허용_오차면_채택한다():
    """비교는 초과이지 이상이 아니다."""
    assert measure(0, 5000, 5000 - MARGIN_MS, TARGET)[1] == Source.CLIENT_MEASURED
    assert measure(0, 5000, 5000 - MARGIN_MS - 1, TARGET)[1] == Source.SERVER_OBSERVED


def test_신고값이_개인_제한을_넘으면_대체한다():
    over = limit_ms(TARGET) + 1

    assert measure(0, 5000, over, TARGET) == (5000, Source.SERVER_OBSERVED)


def test_신고값이_0_이하거나_정수가_아니면_대체한다():
    assert measure(0, 5000, 0, TARGET) == (5000, Source.SERVER_OBSERVED)
    assert measure(0, 5000, None, TARGET) == (5000, Source.SERVER_OBSERVED)

    verdict = judge(ctx(), [start("m1"), stop("m1", 5000, "4900"), *honest("m2", 3000)])
    assert rows_of(verdict)["m1"]["source"] == Source.SERVER_OBSERVED


# ── 순위표 ─────────────────────────────────────────────────────────────────


def test_순위표는_유효_미정지_미시작_순으로_늘어선다():
    over = limit_ms(TARGET) + 1
    inputs = [*honest("m3", 5100), start("m1"), stop("m1", over, over)]

    verdict = judge(ctx(), inputs)
    assert ranking_of(verdict) == ("m3", "m1", "m2")
    assert [r["rank"] for r in verdict.persist["records"]] == [1, 2, 3]


def test_같은_사유_안에서는_스냅샷_순이다():
    verdict = judge(ctx(), honest("m2", 5000))

    assert ranking_of(verdict) == ("m2", "m1", "m3")


def test_순위표는_판정_기준과_무관하게_오차_오름차순이다():
    inputs = [*honest("m1", 5400), *honest("m2", 5030), *honest("m3", 4910)]
    expected = ("m2", "m3", "m1")  # 오차 30 · 90 · 400

    assert ranking_of(judge(ctx(), inputs)) == expected
    assert ranking_of(judge(ctx(criterion="FARTHEST"), inputs)) == expected


def test_오차가_같으면_스냅샷_순으로_늘어선다():
    """m3과 m1의 오차가 둘 다 100이다. 도착은 m3이 먼저지만 순위는 스냅샷 순이다."""
    inputs = [*honest("m3", 4900), *honest("m1", 5100), *honest("m2", 5030)]

    assert ranking_of(judge(ctx(), inputs)) == ("m2", "m1", "m3")


# ── 동점과 교착 ────────────────────────────────────────────────────────────


def test_오차가_밀리초까지_같으면_재대결이다():
    verdict = judge(ctx(), [*honest("m1", 4880), *honest("m2", 5120), *honest("m3", 5400)])

    assert verdict.outcome is Outcome.TIE
    assert set(verdict.tie_pool) == {"m1", "m2"}
    assert verdict.next_phase == Phase.TIE_NOTICE
    assert verdict.next_deadline == TIE_NOTICE_MS


def test_재대결_통지는_기록_값을_내보내지_않는다():
    """동점자 명단만 3초 보이고 누가 몇 밀리초였는지는 감춘다(G-10)."""
    verdict = judge(ctx(), [*honest("m1", 4880), *honest("m2", 5120), *honest("m3", 5400)])

    assert verdict.persist is None
    assert verdict.detail is None


def test_재대결을_3회_소진하면_방장이_고른다():
    inputs = [*honest("m1", 4880), *honest("m2", 5120)]
    verdict = judge(ctx(repeat=MAX_REMATCHES, tie_pool=("m1", "m2")), inputs)

    assert verdict.outcome is Outcome.HOST_CHOICE
    assert verdict.next_phase == Phase.DEADLOCK
    assert verdict.next_deadline is None  # 타이머가 없는 정지 상태다


def test_재대결_대상자는_동점자로_줄고_나머지는_보지_않는다():
    inputs = [*honest("m1", 5100), *honest("m2", 5200), *honest("m3", 5000)]
    verdict = judge(ctx(repeat=1, tie_pool=("m1", "m2")), inputs)

    assert verdict.winner == "m1"
    assert set(rows_of(verdict)) == {"m1", "m2"}


def test_실시한_재대결_횟수를_남긴다():
    verdict = judge(ctx(repeat=2, tie_pool=("m1", "m2")), honest("m1", 5000))

    assert verdict.persist["rematchRounds"] == 2


def test_재대결에서_이탈자는_미시작으로_빠지고_남은_사람이_뽑힌다():
    verdict = judge(ctx(repeat=1, tie_pool=("m1", "m2")), honest("m2", 5300))

    assert verdict.winner == "m2"
    assert rows_of(verdict)["m1"]["status"] == Status.NO_START


# ── 경계값 ─────────────────────────────────────────────────────────────────


def test_전원이_아무것도_누르지_않으면_난수로_정하지_않는다():
    verdict = judge(ctx(), [])

    assert verdict.outcome is Outcome.TIE
    assert verdict.winner is None
    assert set(verdict.tie_pool) == set(MEMBERS)


def test_전원_미입력으로_재대결까지_소진하면_교착이다():
    verdict = judge(ctx(repeat=MAX_REMATCHES, tie_pool=MEMBERS), [])

    assert verdict.outcome is Outcome.HOST_CHOICE
    assert verdict.winner is None


def test_유효_기록이_하나뿐이면_기준과_무관하게_그_사람이다():
    for criterion in ("CLOSEST", "FARTHEST"):
        assert judge(ctx(criterion=criterion), honest("m2", 7000)).winner == "m2"


def test_START가_마감_1밀리초_뒤에_닿으면_미시작이다():
    at = START_DEADLINE_MS
    late = [start("m1", at + 1), stop("m1", at + 1 + 4990, 4990)]
    on_time = [start("m2", at), stop("m2", at + 4990, 4990)]

    rows = rows_of(judge(ctx(), [*late, *on_time]))
    assert rows["m1"]["status"] == Status.NO_START
    assert rows["m2"]["status"] == Status.RECORDED


def test_STOP이_개인_제한_1밀리초_뒤에_닿으면_미정지다():
    limit = limit_ms(TARGET)
    inputs = [start("m1"), stop("m1", limit, limit), start("m2"), stop("m2", limit + 1, limit)]

    rows = rows_of(judge(ctx(), inputs))
    assert rows["m1"]["status"] == Status.RECORDED
    assert rows["m2"]["status"] == Status.NO_STOP


def test_개인_제한은_그_사람의_START_도착이_원점이다():
    """m2는 9초에 시작했으므로 9+8초까지 받는다. 라운드 원점 8초가 아니다."""
    inputs = [start("m2", 9_000), stop("m2", 9_000 + 5_000, 5_000)]

    assert rows_of(judge(ctx(), inputs))["m2"]["status"] == Status.RECORDED


def test_최소_인원_2명에서도_돈다():
    verdict = judge(ctx(("a", "b")), [*honest("a", 4900), *honest("b", 5300)])

    assert verdict.winner == "a"


def test_최대_인원_10명에서도_돈다():
    roster = tuple(f"m{i}" for i in range(10))
    inputs = [i for n, m in enumerate(roster) for i in honest(m, 5000 + n * 10)]

    verdict = judge(ctx(roster), inputs)
    assert verdict.winner == "m0"
    assert len(verdict.persist["records"]) == 10


def test_목표_시간이_바뀌면_마감도_따라간다():
    assert limit_ms(10_000) == 13_000
    assert round_deadline_ms(10_000) == 23_000
    assert round_deadline_ms(5_000) == 18_000


def test_대상자가_비면_판정하지_않는다():
    with pytest.raises(ValueError):
        judge(ctx(()), [])


def test_본판_대상자는_명단_전원이고_재대결은_동점자뿐이다():
    assert entrants_of(ctx()) == MEMBERS
    assert entrants_of(ctx(repeat=1, tie_pool=("m1", "m2"))) == ("m1", "m2")
