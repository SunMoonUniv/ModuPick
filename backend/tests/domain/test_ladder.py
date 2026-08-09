"""사다리타기 판정 — docs/05_game_rules/03_ladder.md 의 인수 기준 후보와 경계값 표"""

from collections import Counter

import pytest

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome
from app.domain.games.ladder import (
    FILLER_LABEL,
    GAME_ID,
    MIN_LEVELS,
    RESULT_SCHEMA_VERSION,
    SPEED_MS,
    Phase,
    judge,
    normalize_items,
)

SEED = 0x0123456789ABCDEF
MEMBERS = ("A", "B", "C", "D", "E", "F")
ITEMS = ("팀장", "자료 조사", "PPT 제작", "발표", "디자인", "최종 정리")

START = JudgeInput(participant_id="A", kind="실행", arrived_ms=1200, seq=7)


def ctx(
    seed: int = SEED,
    roster: tuple[str, ...] = MEMBERS,
    items: tuple[str, ...] | None = ITEMS,
    speed: str = "NORMAL",
    **kwargs,
) -> JudgeContext:
    config = {"speed": speed}
    if items is not None:
        config["resultItems"] = list(items)
    return JudgeContext(
        round_id="3071", game_id=GAME_ID, seed=seed, roster=roster, config=config, **kwargs
    )


def slots_of(verdict) -> list[int]:
    return [a["slot"] for a in verdict.assignments]


# ── 결정성 ────────────────────────────────────────────────────────────────


def test_같은_시드와_같은_명단과_같은_항목이면_같은_결과가_나온다():
    assert judge(ctx()) == judge(ctx())


def test_고정_시드의_배정과_가로선이_바뀌지_않는다():
    """회귀 고정값이다. 이 테스트가 깨지면 PRNG 구성이나 난수 사용법이 바뀐 것이다."""
    verdict = judge(ctx())
    assert slots_of(verdict) == [3, 1, 5, 2, 0, 4]
    assert verdict.persist["ladderRungs"] == [
        {"row": 0, "leftLane": 3},
        {"row": 1, "leftLane": 2},
        {"row": 2, "leftLane": 1},
        {"row": 3, "leftLane": 0},
        {"row": 4, "leftLane": 1},
        {"row": 4, "leftLane": 3},
        {"row": 5, "leftLane": 2},
        {"row": 5, "leftLane": 4},
    ]


def test_시드가_다르면_배정이_갈린다():
    assert len({tuple(slots_of(judge(ctx(seed=s)))) for s in range(200)}) > 1


# ── 1:1 대응 ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("size", [2, 3, 6, 10])
def test_도착_컬럼이_0부터_n_1까지_정확히_한_번씩_나온다(size):
    """중복·누락 0. 사다리가 성립하는 조건 그 자체다."""
    roster = tuple(f"mbr_{i}" for i in range(size))
    for seed in range(60):
        assert sorted(slots_of(judge(ctx(seed=seed, roster=roster)))) == list(range(size))


def test_라벨이_하단_항목과_1대1로_대응한다():
    """같은 항목을 두 사람이 받는 일이 없다."""
    labels = [a["label"] for a in judge(ctx()).assignments]
    assert Counter(labels) == Counter(ITEMS)


def test_배정_라벨이_도착_컬럼의_항목과_같다():
    """항목을 섞지 않으므로 slot이 곧 하단 인덱스다."""
    for a in judge(ctx()).assignments:
        assert a["label"] == ITEMS[a["slot"]]


def test_배정이_명단_순서를_그대로_따른다():
    """참가자는 레인을 고르지 않고 입장 순서대로 배치된다(D-33)."""
    assert [a["memberId"] for a in judge(ctx()).assignments] == list(MEMBERS)


# ── 가로선의 성질 ──────────────────────────────────────────────────────────


def _levels(verdict) -> dict[int, list[int]]:
    levels: dict[int, list[int]] = {}
    for rung in verdict.persist["ladderRungs"]:
        levels.setdefault(rung["row"], []).append(rung["leftLane"])
    return levels


@pytest.mark.parametrize("size", [2, 3, 6, 10])
def test_같은_레벨의_갭은_서로_2_이상_떨어져_있다(size):
    """레인이 겹치면 한 레벨이 전단사가 아니게 되고 1:1 대응이 깨진다."""
    roster = tuple(f"mbr_{i}" for i in range(size))
    for seed in range(60):
        for gaps in _levels(judge(ctx(seed=seed, roster=roster))).values():
            ordered = sorted(gaps)
            assert all(b - a >= 2 for a, b in zip(ordered, ordered[1:])), ordered


@pytest.mark.parametrize("size", [2, 3, 6, 10])
def test_갭이_레인_범위_안에_있다(size):
    roster = tuple(f"mbr_{i}" for i in range(size))
    for seed in range(60):
        for rung in judge(ctx(seed=seed, roster=roster)).persist["ladderRungs"]:
            assert 0 <= rung["leftLane"] <= size - 2


@pytest.mark.parametrize("size", [2, 3, 6, 10])
def test_가로선이_항상_2개_이상이고_레벨이_최소_높이를_채운다(size):
    """0개면 사다리로 보이지 않는다. 장식 쌍이 그 자리를 메운다."""
    roster = tuple(f"mbr_{i}" for i in range(size))
    for seed in range(60):
        verdict = judge(ctx(seed=seed, roster=roster))
        rungs = verdict.persist["ladderRungs"]
        assert len(rungs) >= 2
        assert max(r["row"] for r in rungs) + 1 <= max(MIN_LEVELS, len(rungs))


def test_row가_0부터_빈틈없이_올라간다():
    rows = [r["row"] for r in judge(ctx()).persist["ladderRungs"]]
    assert rows == sorted(rows)
    assert rows[0] == 0


# ── 균등성 ────────────────────────────────────────────────────────────────


def test_도착_순열이_균등하다():
    """n=3이면 6가지 순열이 같은 확률로 나온다. 가로선을 먼저 뿌리면 깨지는 성질이다."""
    roster = ("a", "b", "c")
    draws = 3_000
    hits = Counter(tuple(slots_of(judge(ctx(seed=s, roster=roster)))) for s in range(draws))

    assert len(hits) == 6  # 3! 가지가 모두 나온다
    expected = draws / 6
    assert all(abs(hit - expected) < expected * 0.2 for hit in hits.values()), hits


# ── 입력을 보지 않는다 ─────────────────────────────────────────────────────


def test_방장이_누르지_않아_자동_실행돼도_같은_결과가_나온다():
    """ARMED 진입 30초 뒤의 서버 자동 실행은 입력 배열이 비어 있다."""
    assert judge(ctx(), []) == judge(ctx(), [START])


def test_참가자_입력이_섞여_들어와도_결과가_바뀌지_않는다():
    """레인 선택은 폐기됐다. 참가자 입력은 어느 상태에서도 정의되지 않는다."""
    noise = [START, JudgeInput("B", "누르기"), JudgeInput("C", "투표", payload="X")]
    assert judge(ctx(), noise) == judge(ctx(), [START])


def test_생존자_명단을_보지_않는다():
    """이탈로 접속자가 0명이 되어도 판정은 스냅샷 기준으로 그대로 실행된다."""
    assert judge(ctx(alive=())) == judge(ctx())


# ── 항목 정규화 ────────────────────────────────────────────────────────────


def test_항목이_모자라면_뒤를_X로_채운다():
    verdict = judge(ctx(items=ITEMS[:4]))
    assert sorted(a["label"] for a in verdict.assignments) == sorted(
        [*ITEMS[:4], FILLER_LABEL, FILLER_LABEL]
    )


def test_항목이_넘치면_뒤에서부터_잘라낸다():
    extra = (*ITEMS, "잘림1", "잘림2", "잘림3")
    verdict = judge(ctx(items=extra))
    assert Counter(a["label"] for a in verdict.assignments) == Counter(ITEMS)


def test_항목_1개에_참가자_10명이면_9명이_X를_받는다():
    roster = tuple(f"mbr_{i}" for i in range(10))
    labels = [a["label"] for a in judge(ctx(roster=roster, items=("팀장",))).assignments]
    assert Counter(labels) == Counter(["팀장", *[FILLER_LABEL] * 9])


def test_항목이_비어_있어도_전원이_X를_받고_판정이_선다():
    """설정 화면이 막지만 판정은 개수 검증을 하지 않는다 — 맞추는 일만 한다."""
    labels = [a["label"] for a in judge(ctx(items=())).assignments]
    assert labels == [FILLER_LABEL] * len(MEMBERS)


def test_항목을_섞지_않는다():
    """방장이 화면에서 본 순서가 하단 순서다. 난수원은 순열 하나뿐이다."""
    verdict = judge(ctx())
    bottom = [None] * len(MEMBERS)
    for a in verdict.assignments:
        bottom[a["slot"]] = a["label"]
    assert bottom == list(ITEMS)


@pytest.mark.parametrize(
    "items, n, expected",
    [
        (("가", "나"), 4, ["가", "나", "X", "X"]),
        (("가", "나", "다"), 2, ["가", "나"]),
        (("가", "나"), 2, ["가", "나"]),
        ((), 2, ["X", "X"]),
    ],
)
def test_항목_정규화가_개수를_참가자_수에_맞춘다(items, n, expected):
    assert normalize_items(items, n) == expected


# ── 진행 속도 ──────────────────────────────────────────────────────────────


def test_진행_속도는_연출_길이만_바꾸고_배정을_바꾸지_않는다():
    verdicts = {speed: judge(ctx(speed=speed)) for speed in SPEED_MS}
    assert {v.next_deadline for v in verdicts.values()} == set(SPEED_MS.values())
    assert len({tuple(slots_of(v)) for v in verdicts.values()}) == 1


def test_속도를_주지_않으면_보통으로_본다():
    assert judge(ctx(speed=None)).next_deadline == SPEED_MS["NORMAL"]


def test_규격_밖_속도는_거절한다():
    with pytest.raises(ValueError):
        judge(ctx(speed="TURBO"))


# ── 출력 범위 ─────────────────────────────────────────────────────────────


def test_다음_단계는_경로_그리기이고_마감이_연출_길이다():
    verdict = judge(ctx())
    assert verdict.next_phase == Phase.DRAWING
    assert verdict.next_deadline == SPEED_MS["NORMAL"]


def test_동점도_승자도_생존자도_남기지_않는다():
    """전원 배정 게임이라 승자라는 개념이 없고 반복 규칙도 없다."""
    verdict = judge(ctx())
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.winner is None
    assert verdict.tie_pool == ()
    assert verdict.survivors is None


def test_연출_값이_경로를_그릴_수_있는_두_가지다():
    """DRAWING 진입 시점에 필요한 값이다(07_api/03 「phase payload」)."""
    verdict = judge(ctx())
    assert verdict.detail.keys() == {"assignments", "ladderRungs"}
    assert verdict.detail["ladderRungs"] == verdict.persist["ladderRungs"]


# ── 저장 형식 ─────────────────────────────────────────────────────────────


def test_저장_형식이_result_data_스키마를_따른다():
    verdict = judge(ctx())
    assert verdict.persist.keys() == {
        "schemaVersion",
        "seed",
        "assignments",
        "ladderRungs",
    }
    assert verdict.persist["schemaVersion"] == RESULT_SCHEMA_VERSION
    assert verdict.persist["seed"] == SEED
    assert verdict.persist["assignments"] == verdict.assignments


def test_배정_항목이_세_축을_갖는다():
    for a in judge(ctx()).assignments:
        assert a.keys() == {"memberId", "slot", "label"}


# ── 경계값 ────────────────────────────────────────────────────────────────


def test_두_명이면_순열이_두_가지_뿐이고_둘_다_나온다():
    """갭이 하나뿐이라 항등과 전치 둘이며 각 1/2이다."""
    seen = {tuple(slots_of(judge(ctx(seed=s, roster=("a", "b"))))) for s in range(60)}
    assert seen == {(0, 1), (1, 0)}


def test_두_명이고_항등이면_가로선이_짝수_개다():
    """장식 쌍만 남으므로 상쇄된다. 상쇄되지 않으면 배정이 뒤집힌다."""
    for seed in range(60):
        verdict = judge(ctx(seed=seed, roster=("a", "b")))
        rungs = verdict.persist["ladderRungs"]
        identity = slots_of(verdict) == [0, 1]
        assert (len(rungs) % 2 == 0) is identity


@pytest.mark.parametrize("size", [2, 10])
def test_최소_인원과_최대_인원에서_정상_판정한다(size):
    roster = tuple(f"mbr_{i}" for i in range(size))
    verdict = judge(ctx(roster=roster))
    assert len(verdict.assignments) == size
    assert sorted(slots_of(verdict)) == list(range(size))


def test_명단이_비어_있으면_판정할_수_없다():
    with pytest.raises(ValueError):
        judge(ctx(roster=()))
