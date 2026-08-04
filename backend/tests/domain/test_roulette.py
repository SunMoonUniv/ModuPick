"""운명의 룰렛 판정 — docs/05_game_rules/02_roulette.md 의 인수 기준 후보와 경계값 표"""

import pytest

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome
from app.domain.games.roulette import (
    GAME_ID,
    RESULT_SCHEMA_VERSION,
    SPIN_MS,
    SPIN_TURNS,
    Phase,
    judge,
)

SEED = 0x0123456789ABCDEF
MEMBERS = ("A", "B", "C", "D", "E", "F")

PICK = JudgeInput(participant_id="A", kind="실행", arrived_ms=1200, seq=7)


def ctx(seed: int = SEED, roster: tuple[str, ...] = MEMBERS, **kwargs) -> JudgeContext:
    return JudgeContext(
        round_id="3071", game_id=GAME_ID, seed=seed, roster=roster, **kwargs
    )


# ── 결정성 ────────────────────────────────────────────────────────────────


def test_같은_시드와_같은_명단이면_같은_결과가_나온다():
    assert judge(ctx()) == judge(ctx())


def test_고정_시드의_당첨자가_바뀌지_않는다():
    """회귀 고정값이다. 이 테스트가 깨지면 PRNG 구성이나 난수 사용법이 바뀐 것이다."""
    verdict = judge(ctx())
    assert verdict.detail == {"winnerIndex": 3}
    assert verdict.winner == "D"


def test_시드가_다르면_당첨자가_갈린다():
    winners = {judge(ctx(seed=seed)).winner for seed in range(200)}
    assert len(winners) == len(MEMBERS)


# ── 입력을 보지 않는다 ─────────────────────────────────────────────────────


def test_방장이_누르지_않아_자동_실행돼도_같은_결과가_나온다():
    """ARMED 진입 30초 뒤의 서버 자동 실행은 입력 배열이 비어 있다."""
    assert judge(ctx(), []) == judge(ctx(), [PICK])


def test_방장이_연타해도_결과가_하나다():
    rapid_picks = [
        JudgeInput("A", "실행", arrived_ms=1200 + i * 300, seq=i) for i in range(5)
    ]
    assert judge(ctx(), rapid_picks) == judge(ctx(), [PICK])


def test_참가자_입력이_섞여_들어와도_결과가_바뀌지_않는다():
    """비방장 입력은 상태를 바꾸지 않고 결과에도 반영하지 않는다."""
    noise = [PICK, JudgeInput("B", "누르기"), JudgeInput("C", "투표", payload="X")]
    assert judge(ctx(), noise) == judge(ctx(), [PICK])


def test_생존자_명단을_보지_않는다():
    """이탈로 접속자가 0명이 되어도 판정은 스냅샷 기준으로 그대로 실행된다."""
    assert judge(ctx(alive=())) == judge(ctx())


# ── 출력 범위 ─────────────────────────────────────────────────────────────


def test_회전_연출은_시드와_무관한_서버_상수다():
    """라운드마다 뽑지 않는다. 난수를 다시 끌어들이면 이 테스트가 깨진다."""
    assert {judge(ctx(seed=seed)).next_deadline for seed in range(50)} == {SPIN_MS}
    assert (SPIN_TURNS, SPIN_MS) == (5, 5000)


def test_판정은_당첨자만_정한다():
    """연출 파라미터가 판정 출력에 섞이지 않는다."""
    assert judge(ctx()).detail.keys() == {"winnerIndex"}


def test_다음_단계는_회전이고_마감이_회전_시간이다():
    verdict = judge(ctx())
    assert verdict.next_phase == Phase.SPINNING
    assert verdict.next_deadline == SPIN_MS


def test_동점도_생존자도_남기지_않는다():
    """동점이라는 상태가 정의되지 않는 게임이다. 반복 규칙도 없다."""
    verdict = judge(ctx())
    assert verdict.outcome is Outcome.DECIDED
    assert verdict.tie_pool == ()
    assert verdict.survivors is None


# ── 저장 형식 ─────────────────────────────────────────────────────────────


def test_저장_형식이_result_data_스키마를_따른다():
    verdict = judge(ctx())
    assert verdict.persist == {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "seed": SEED,
        "winnerMemberIds": [verdict.winner],  # 한 명뿐이어도 배열이다
        "wheelOrder": list(MEMBERS),  # 조각 배치는 입장 순서다
    }


# ── 경계값 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("size", [2, 10])
def test_최소_인원과_최대_인원에서_정상_판정한다(size):
    roster = tuple(f"mbr_{i}" for i in range(size))
    verdict = judge(ctx(roster=roster))
    assert verdict.winner in roster
    assert verdict.persist["wheelOrder"] == list(roster)


@pytest.mark.parametrize("size", [2, 3, 10])
def test_조각마다_당첨_확률이_같다(size):
    """n명이면 각 조각의 당첨 확률이 1/n이다."""
    roster = tuple(f"mbr_{i}" for i in range(size))
    draws = 3_000
    hits = [0] * size
    for seed in range(draws):
        hits[judge(ctx(seed=seed, roster=roster)).detail["winnerIndex"]] += 1

    expected = draws / size
    assert all(abs(hit - expected) < expected * 0.15 for hit in hits), hits


def test_명단이_비어_있으면_판정할_수_없다():
    with pytest.raises(ValueError):
        judge(ctx(roster=()))
