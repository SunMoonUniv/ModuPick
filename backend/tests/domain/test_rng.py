"""시드 기반 결정적 난수 — docs/05_game_rules/01_common.md 「판정의 결정성과 시드」"""

import pytest

from app.domain.games.rng import Prng, random_below

SEED = 0x0123456789ABCDEF


def test_같은_시드와_용도면_같은_수열이_나온다():
    a = [Prng(SEED, "roulette").next_uint32() for _ in range(5)]
    b = [Prng(SEED, "roulette").next_uint32() for _ in range(5)]
    assert a == b


def test_용도가_다르면_다른_수열이_나온다():
    """결선·재대결이 용도에 회차를 넣어 다른 수열을 뽑는 근거다."""
    same_seed = [Prng(SEED, "kingmaker:0").next_uint32() for _ in range(5)]
    other_purpose = [Prng(SEED, "kingmaker:1").next_uint32() for _ in range(5)]
    assert same_seed != other_purpose


def test_시드가_다르면_다른_수열이_나온다():
    assert Prng(SEED).next_uint32() != Prng(SEED + 1).next_uint32()


def test_스트림이_uint32_범위_안에_있다():
    prng = Prng(SEED)
    assert all(0 <= prng.next_uint32() < 2**32 for _ in range(100))


@pytest.mark.parametrize("seed", [-1, 2**64])
def test_64비트를_벗어난_시드는_거부한다(seed):
    with pytest.raises(ValueError):
        Prng(seed)


@pytest.mark.parametrize("n", [1, 2, 3, 7, 10])
def test_random_below는_범위_안의_값만_낸다(n):
    prng = Prng(SEED)
    assert all(0 <= random_below(prng, n) < n for _ in range(200))


@pytest.mark.parametrize("n", [0, -3])
def test_random_below는_양수가_아닌_n을_거부한다(n):
    with pytest.raises(ValueError):
        random_below(Prng(SEED), n)


@pytest.mark.parametrize("n", [3, 6, 7, 9])
def test_나머지_연산_편향이_생기는_n에서도_고르게_나온다(n):
    """거부 표본추출이 실제로 편향을 지우는지 본다. 편향이 생기는 n만 골랐다."""
    draws = 30_000
    prng = Prng(SEED, "uniformity")
    counts = [0] * n
    for _ in range(draws):
        counts[random_below(prng, n)] += 1

    expected = draws / n
    assert all(abs(count - expected) < expected * 0.1 for count in counts), counts
