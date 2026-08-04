"""인메모리 런타임 상태.

여기 있는 것은 전부 **재기동으로 사라지는 것이 정상**이다. 서버가 다시 뜨면
기동 정리가 DB의 모든 방을 삭제하므로, 토큰과 멱등 캐시가 함께 사라지는 것이
오히려 정합적이다. 살아남은 토큰이 가리킬 방이 없기 때문이다.

지금 담는 것은 둘이다.

    토큰 바인딩   token -> (participant_id, room_id, room_code)
    멱등 캐시     Idempotency-Key -> 최초 응답

준비 상태·라운드 단계·판정창 그룹 등 나머지 인메모리 상태는 1c 이후에 붙는다.
"""

from dataclasses import dataclass, field

from app.infra.clock import clock

#: 멱등 캐시 보관 시간. 방 무활동 만료와 같은 10분이다.
IDEMPOTENCY_TTL_S = 600.0


@dataclass(frozen=True, slots=True)
class TokenBinding:
    """토큰이 가리키는 참가자.

    **역할을 담지 않는다.** 방장 판정은 방이 보유한 방장 식별자와 대조해서 하며
    토큰 안의 값을 믿지 않는다. 여기에 is_host를 두면 그것을 신뢰하는 코드가
    언젠가 들어온다.
    """

    participant_id: int
    room_id: int
    room_code: str


@dataclass(slots=True)
class IdempotencyEntry:
    body_hash: str
    status: int
    payload: dict
    expires_at: float


@dataclass(slots=True)
class RuntimeStore:
    _tokens: dict[str, TokenBinding] = field(default_factory=dict)
    _room_tokens: dict[int, set[str]] = field(default_factory=dict)
    _idem: dict[str, IdempotencyEntry] = field(default_factory=dict)

    # ── 토큰 ───────────────────────────────────────────────────────────────

    def bind_token(self, token: str, binding: TokenBinding) -> None:
        self._tokens[token] = binding
        self._room_tokens.setdefault(binding.room_id, set()).add(token)

    def resolve_token(self, token: str) -> TokenBinding | None:
        """토큰이 가리키는 바인딩. 없으면 None이다.

        **이것만으로 유효하다고 판단하지 않는다.** 슬롯 회수는 DB의 left_at이
        관리하고 토큰은 메모리에 있어 둘이 어긋날 수 있으므로, 호출자가 참가자를
        조회해 left_at이 비어 있는지 다시 확인한다.
        """
        return self._tokens.get(token)

    def revoke_token(self, token: str) -> None:
        binding = self._tokens.pop(token, None)
        if binding is None:
            return
        room = self._room_tokens.get(binding.room_id)
        if room is not None:
            room.discard(token)
            if not room:
                del self._room_tokens[binding.room_id]

    def revoke_room(self, room_id: int) -> None:
        """방 삭제 시 그 방의 토큰을 일괄 제거한다."""
        for token in self._room_tokens.pop(room_id, set()):
            self._tokens.pop(token, None)

    # ── 멱등 ───────────────────────────────────────────────────────────────

    def idem_get(self, key: str) -> IdempotencyEntry | None:
        entry = self._idem.get(key)
        if entry is None:
            return None
        if entry.expires_at <= clock.monotonic_s():
            del self._idem[key]
            return None
        return entry

    def idem_put(self, key: str, body_hash: str, status: int, payload: dict) -> None:
        self._idem[key] = IdempotencyEntry(
            body_hash=body_hash,
            status=status,
            payload=payload,
            expires_at=clock.monotonic_s() + IDEMPOTENCY_TTL_S,
        )

    def purge_expired_idempotency(self) -> int:
        """만료된 멱등 항목을 정리한다. 스케줄러가 주기적으로 부른다."""
        now = clock.monotonic_s()
        stale = [k for k, v in self._idem.items() if v.expires_at <= now]
        for key in stale:
            del self._idem[key]
        return len(stale)

    # ── 진단 ───────────────────────────────────────────────────────────────

    def stats(self) -> dict[str, int]:
        return {
            "tokens": len(self._tokens),
            "rooms": len(self._room_tokens),
            "idempotency": len(self._idem),
        }


store = RuntimeStore()
