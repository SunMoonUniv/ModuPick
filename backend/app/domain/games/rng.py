"""시드 기반 결정적 난수.

정본은 docs/05_game_rules/01_common.md 「판정의 결정성과 시드」와
docs/04_architecture/03_judgment_engine.md 「난수와 시드」다.

시드 자체는 서버가 라운드 생성 시 암호학적 난수원에서 뽑는다 — 시각·방 코드·참가자
수에서 유도하면 예측할 수 있다. 여기서는 **그 시드에서 값을 꺼내는 방법**만 정한다.
"""

import hashlib

SEED_BITS = 64
_UINT32 = 2**32


class Prng:
    """시드와 용도 문자열로 초기화하는 결정적 uint32 스트림.

    같은 (seed, purpose)면 언제나 같은 수열이 나온다. 저장된 시드로 판정을 다시
    돌려 같은 결과가 나오는지 검증할 수 있는 근거가 이것이다. 용도 문자열이 다르면
    같은 시드에서도 겹치지 않는 수열을 뽑는다 — 결선·재대결이 용도에 회차를 넣어
    다른 수열을 쓰는 방식이 여기에 기댄다.
    """

    __slots__ = ("_prefix", "_counter")

    def __init__(self, seed: int, purpose: str = "") -> None:
        if not 0 <= seed < 2**SEED_BITS:
            raise ValueError(f"시드는 {SEED_BITS}비트 부호 없는 정수여야 한다: {seed}")
        self._prefix = seed.to_bytes(SEED_BITS // 8, "big") + purpose.encode("utf-8")
        self._counter = 0

    def next_uint32(self) -> int:
        digest = hashlib.blake2b(
            self._prefix + self._counter.to_bytes(8, "big"), digest_size=4
        ).digest()
        self._counter += 1
        return int.from_bytes(digest, "big")


def random_below(prng: Prng, n: int) -> int:
    """0 이상 n 미만의 균등 정수.

    나머지 연산 편향을 거부 표본추출로 없앤다 — n이 3·6·7·9일 때 편향이 실제로 생긴다.
    """
    if n <= 0:
        raise ValueError(f"n은 1 이상이어야 한다: {n}")
    limit = _UINT32 - (_UINT32 % n)
    while True:
        x = prng.next_uint32()
        if x < limit:
            return x % n
