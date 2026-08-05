"""인메모리 런타임 상태.

여기 있는 것은 전부 **재기동으로 사라지는 것이 정상**이다. 서버가 다시 뜨면
기동 정리가 DB의 모든 방을 삭제하므로, 토큰과 멱등 캐시가 함께 사라지는 것이
오히려 정합적이다. 살아남은 토큰이 가리킬 방이 없기 때문이다.

담는 것은 여섯이다.

    토큰 바인딩   token -> (participant_id, room_id, room_code)
    멱등 캐시     Idempotency-Key -> 최초 응답
    방 상태 버전  room_id -> 단조 증가 정수
    준비 상태     room_id -> 준비한 participant_id 집합
    채팅 시퀀스   room_id -> messageId 카운터
    이탈 유예     room_id -> participant_id -> (만료 예정 시각, 확정 태스크)

**준비 상태를 DB에 두지 않는다.** participants에 ready 컬럼이 없는 것이 설계다 —
방이 사라지면 함께 사라져야 하는 값이고, 매 토글마다 쓰기를 만들 이유가 없다.

라운드 단계·판정창 그룹 등 나머지 인메모리 상태는 이후 슬라이스에서 붙는다.
"""

from dataclasses import dataclass, field
from datetime import datetime

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


def _cancel(task: object | None) -> None:
    """유예 태스크를 접는다. 자기 자신을 취소하는 경우는 건너뛴다 —
    확정 처리 도중 end_grace를 부르면 그 태스크가 자기 목을 치게 된다."""
    if task is None:
        return
    import asyncio

    if not isinstance(task, asyncio.Task) or task.done():
        return
    try:
        if asyncio.current_task() is task:
            return
    except RuntimeError:
        pass
    task.cancel()


@dataclass(slots=True)
class GraceEntry:
    """이탈 유예 하나.

    태스크를 함께 들고 있는 이유는 **방이 먼저 사라질 수 있기** 때문이다. 방 삭제가
    태스크를 취소하지 않으면 유예가 만료될 때 없는 방을 두고 이탈을 확정하려 든다.
    """

    grace_ends_at: datetime
    task: object | None = None


@dataclass(slots=True)
class Selection:
    """게임 시작 전의 선택과 설정.

    **DB에 쓰지 않는다.** 라운드가 만들어지는 순간(game:start)에야 game_rounds에
    영속되며, 그전까지는 재기동으로 사라지는 것이 정상이다 — 재기동이 방을 전부
    지우므로 남길 대상 자체가 없다.
    """

    game_id: str
    config: dict


@dataclass(slots=True)
class RoundState:
    """진행 중인 라운드의 인메모리 상태.

    **명단 스냅샷이 여기에 있다.** 시작 순간 고정되며 도중 이탈해도 바뀌지 않는다 —
    나간 사람도 후보로 남고 결과에 이탈 표시와 함께 나온다.

    phase·마감 시각·타이머 핸들은 밀리초 경로라 DB에 쓰지 않는다. 라운드 자체는
    game_rounds에 있고 여기 있는 것은 그 위의 진행 상태다.
    """

    round_id: str
    round_pk: int
    game_id: str
    config: dict
    roster: list[dict]
    seed: int
    phase: str = "READY"
    phase_seq: int = 0
    tie_round: int = 0
    deadline_at: datetime | None = None
    tick_task: object | None = None


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
    _versions: dict[int, int] = field(default_factory=dict)
    _ready: dict[int, set[int]] = field(default_factory=dict)
    _chat_seq: dict[int, int] = field(default_factory=dict)
    _grace: dict[int, dict[int, GraceEntry]] = field(default_factory=dict)
    _handshaked: dict[int, set[int]] = field(default_factory=dict)
    _selection: dict[int, "Selection"] = field(default_factory=dict)
    _rounds: dict[int, "RoundState"] = field(default_factory=dict)

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
        """방 삭제 시 그 방에 딸린 인메모리 상태를 전부 버린다.

        **하나라도 빠뜨리면 그 방의 흔적이 프로세스가 죽을 때까지 남는다.** 방 식별자는
        재사용되지 않으므로 오염은 아니지만 누수다.
        """
        for token in self._room_tokens.pop(room_id, set()):
            self._tokens.pop(token, None)
        self._versions.pop(room_id, None)
        self._ready.pop(room_id, None)
        self._chat_seq.pop(room_id, None)
        self._handshaked.pop(room_id, None)
        self._selection.pop(room_id, None)
        self.end_round(room_id)
        for entry in self._grace.pop(room_id, {}).values():
            _cancel(entry.task)

    # ── 방 상태 버전 ───────────────────────────────────────────────────────

    def init_version(self, room_id: int) -> int:
        """방 생성 시 1에서 시작한다."""
        self._versions[room_id] = 1
        return 1

    def version(self, room_id: int) -> int:
        return self._versions.get(room_id, 1)

    def bump_version(self, room_id: int) -> int:
        """방 상태가 바뀔 때마다 1 올린다.

        **상태 이벤트에만 올린다.** 채팅·타이머 틱·에러는 방 상태를 바꾸지 않으므로
        버전을 올리지 않는다. 올리면 그 이벤트들이 직전 상태 이벤트와 같은 번호를
        달고 나가 클라이언트의 버전 게이트에 전부 걸러진다.
        """
        current = self._versions.get(room_id, 1) + 1
        self._versions[room_id] = current
        return current

    # ── 준비 상태 ──────────────────────────────────────────────────────────

    def set_ready(self, room_id: int, participant_id: int, ready: bool) -> None:
        """마지막 값이 이긴다. 토글이 아니라 대입이므로 멱등 키가 필요 없다."""
        bucket = self._ready.setdefault(room_id, set())
        if ready:
            bucket.add(participant_id)
        else:
            bucket.discard(participant_id)

    def is_ready(self, room_id: int, participant_id: int) -> bool:
        return participant_id in self._ready.get(room_id, ())

    def ready_ids(self, room_id: int) -> set[int]:
        return set(self._ready.get(room_id, set()))

    def clear_ready(self, room_id: int, participant_id: int | None = None) -> None:
        """participant_id를 주면 그 사람만, 없으면 방 전체를 해제한다.

        전체 해제는 대기방 복귀 시점(round:closed)에 쓴다.
        """
        if participant_id is None:
            self._ready.pop(room_id, None)
        else:
            self._ready.get(room_id, set()).discard(participant_id)

    # ── 게임 선택 ──────────────────────────────────────────────────────────

    def select_game(self, room_id: int, game_id: str, config: dict) -> Selection:
        selection = Selection(game_id=game_id, config=config)
        self._selection[room_id] = selection
        return selection

    def selection_of(self, room_id: int) -> Selection | None:
        return self._selection.get(room_id)

    def clear_selection(self, room_id: int) -> None:
        self._selection.pop(room_id, None)

    # ── 라운드 ─────────────────────────────────────────────────────────────

    def begin_round(self, room_id: int, state: "RoundState") -> None:
        self._rounds[room_id] = state

    def round_of(self, room_id: int) -> "RoundState | None":
        return self._rounds.get(room_id)

    def end_round(self, room_id: int) -> "RoundState | None":
        """라운드를 걷어낸다. **틱 타이머를 반드시 함께 접는다.**

        남겨 두면 끝난 라운드의 틱이 계속 나가고, 방이 사라진 뒤에도 브로드캐스트를
        시도한다.
        """
        state = self._rounds.pop(room_id, None)
        if state is not None:
            _cancel(state.tick_task)
        return state

    # ── 핸드셰이크 흔적 ────────────────────────────────────────────────────

    def mark_handshake(self, room_id: int, participant_id: int) -> None:
        """소켓이 한 번이라도 붙었다는 표식.

        **지금 붙어 있는가와 다르다.** 붙었다가 끊긴 사람은 유예가 맡으므로 미연결
        회수 대상이 아니다. 현재 연결만 보면 그 사람을 두 번 처리하게 된다.
        """
        self._handshaked.setdefault(room_id, set()).add(participant_id)

    def has_handshaked(self, room_id: int, participant_id: int) -> bool:
        return participant_id in self._handshaked.get(room_id, ())

    # ── 이탈 유예 ──────────────────────────────────────────────────────────

    def start_grace(self, room_id: int, participant_id: int, entry: GraceEntry) -> bool:
        """유예를 연다. **이미 열려 있으면 False**이며 기존 창을 유지한다.

        같은 사람이 두 번 의심에 들어가는 경우(전송 실패 직후 소켓 종료 관측)에
        창이 새로 열리면 이탈 확정이 무한히 미뤄진다.
        """
        bucket = self._grace.setdefault(room_id, {})
        if participant_id in bucket:
            return False
        bucket[participant_id] = entry
        return True

    def grace_of(self, room_id: int, participant_id: int) -> GraceEntry | None:
        return self._grace.get(room_id, {}).get(participant_id)

    def unstable_ids(self, room_id: int) -> set[int]:
        return set(self._grace.get(room_id, {}))

    def end_grace(self, room_id: int, participant_id: int) -> None:
        """유예를 닫는다. 확정됐거나 취소된 경우 모두 여기를 지난다."""
        bucket = self._grace.get(room_id)
        if bucket is None:
            return
        entry = bucket.pop(participant_id, None)
        if entry is not None:
            _cancel(entry.task)
        if not bucket:
            del self._grace[room_id]

    # ── 채팅 시퀀스 ────────────────────────────────────────────────────────

    def next_message_id(self, room_id: int) -> str:
        """방 수명 동안만 유일한 10진 문자열. 방이 사라지면 1로 돌아간다."""
        nxt = self._chat_seq.get(room_id, 0) + 1
        self._chat_seq[room_id] = nxt
        return str(nxt)

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
            "versions": len(self._versions),
            "ready": sum(len(v) for v in self._ready.values()),
        }


store = RuntimeStore()
