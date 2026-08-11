"""룰렛 진행 — 가이드 · 방장 대기 · 회전 연출 · 결과.

    GUIDE(3초) → ARMED(30초) → [PICK 또는 자동 실행] → SPINNING(5초) → REVEAL(3초) → RESULT

규칙의 정본은 docs/05_game_rules/02_roulette.md이며 「종료 증명」이 상한 41초를 이
값들로 논증한다. 연출 길이는 서버 상수이고 방장 설정이 아니다 — 라운드마다 달라질
이유가 없고, 달라지면 그 증명이 성립하지 않는다.
"""

from app.domain.games import roulette as rules
from app.infra.memory.runtime_store import RoundState, store
from app.services import game_service, round_service
from app.services.games.base import ActionSpec

GAME_ID = rules.GAME_ID

#: 07_api/03 「game:action type 8종」의 1번. **방장만 · ARMED에서만 · 1회.**
#: SPINNING 이후의 PICK은 phases에 걸려 버려진다 — 최초 1회만 유효하다(멱등).
ACTIONS: dict[str, ActionSpec] = {
    "roulette.pick": ActionSpec(phases=frozenset({rules.Phase.ARMED}), host_only=True),
}


# ── 진입 ───────────────────────────────────────────────────────────────────


async def begin(room_pk: int, *, skip_guide: bool = False) -> None:
    """첫 단계로 들어간다.

    skip_guide는 「다시 하기」 경로다(G-4). 같은 사람들이 같은 규칙을 다시 보는 것이
    되므로 가이드를 건너뛴다.
    """
    if skip_guide:
        await _enter_armed(room_pk)
        return

    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.GUIDE, duration_ms=game_service.GUIDE_MS
    )
    game_service.arm(room_pk, seq, game_service.GUIDE_MS, _enter_armed)


async def _enter_armed(room_pk: int) -> None:
    """방장의 PICK을 기다린다. 30초가 지나면 서버가 대신 실행한다.

    **방장이 누르지 않아도 판은 끝난다.** 누르지 않으면 영원히 대기하는 것이
    프로토타입의 동작이었고, 그러면 방이 만료될 때까지 아무도 나가지 못한다.
    """
    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.ARMED, duration_ms=game_service.ARMED_MS
    )
    game_service.arm(room_pk, seq, game_service.ARMED_MS, run)


# ── 입력 ───────────────────────────────────────────────────────────────────


async def on_action(
    room_pk: int,
    state: RoundState,
    *,
    participant_pk: int,
    member_id: str,
    action_type: str,
    payload: dict | None = None,
) -> None:
    """PICK 1건을 받고 곧바로 판정을 연다.

    **판정에 쓰이지 않더라도 입력을 남긴다.** 「방장이 언제 눌렀는가」는 자동 실행과
    구분되는 유일한 흔적이고, 입력 경로를 게임마다 다르게 두지 않는다.
    """
    del participant_pk, payload  # 룰렛의 PICK에는 페이로드가 없다

    game_service.record_input(state, member_id=member_id, kind=action_type)
    await run(room_pk)


# ── 판정 ───────────────────────────────────────────────────────────────────


async def run(room_pk: int) -> None:
    """판정을 실행하고 결과를 확정한다.

    **방장의 PICK과 30초 자동 실행이 같은 자리로 들어온다.** 둘 중 무엇이 먼저
    닿아도 결과가 같아야 하므로(시드와 명단만으로 정해진다) 경로를 나누지 않는다.

    **한 라운드에 한 번만 통과한다.** settle이 result_data로 선점하며 그 구간에
    await이 없어, 연타로 들어온 두 번째 호출은 반드시 이미 채워진 값을 보고 돌아간다.
    """
    state = store.round_of(room_pk)
    if state is None or state.result_data is not None:
        return

    ctx = game_service.build_context(state)
    # 룰렛은 참가자 입력을 판정에 쓰지 않는다. 방장이 30초간 누르지 않아 서버가
    # 자동 실행한 경우와 같은 결과가 나와야 하기 때문이다. 그래도 배열은 그대로
    # 넘긴다 — 계약이 그 모양이고, 게임마다 호출부를 다르게 두면 합류 지점이 늘어난다.
    verdict = rules.judge(ctx, tuple(state.inputs))

    if not await game_service.settle(room_pk, verdict):
        return

    # 연출 시작 값은 game:phase에 실어 보낸다. 전이와 값이 원자적으로 도착해야
    # "SPINNING인데 목표 각도를 모르는" 창이 생기지 않는다.
    seq = await round_service.emit_phase(
        room_pk,
        phase=verdict.next_phase or rules.Phase.SPINNING,
        duration_ms=verdict.next_deadline,
        payload=dict(verdict.detail) if verdict.detail else None,
    )
    if verdict.next_deadline:
        game_service.arm(room_pk, seq, verdict.next_deadline, _enter_reveal)


async def _enter_reveal(room_pk: int) -> None:
    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.REVEAL, duration_ms=game_service.REVEAL_MS
    )
    game_service.arm(room_pk, seq, game_service.REVEAL_MS, _enter_result)


async def _enter_result(room_pk: int) -> None:
    await game_service.enter_result(room_pk, phase=rules.Phase.RESULT)


# ── 저장 형식 → 와이어 형식 ────────────────────────────────────────────────


def wire_result(state: RoundState) -> tuple[str, dict]:
    """result_data를 game:result의 (variant, result)로 옮긴다.

    **두 형식은 다르다.** 저장(06_database/04 「게임별 JSON 스키마」)은 재현과 감사를
    위한 형태이고, 와이어(07_api/03 §17)는 화면이 그대로 그릴 수 있는 형태다.
    같은 값에 이름이 둘인 자리가 있고(wheelOrder ↔ sliceOrder), 판정이 만들지 않는
    값도 있다(topic · stats).

    **변환은 여기 한 곳에서만 한다.** 두 군데에서 각자 옮기면 한쪽만 고쳐진다.
    """
    data = state.result_data or {}
    winners = data.get("winnerMemberIds") or []
    return "WINNER", {
        "topic": state.config.get("topic"),
        "winnerMemberId": winners[0] if winners else None,
        "detail": {"seed": data.get("seed"), "sliceOrder": data.get("wheelOrder", [])},
        "stats": _stats(state),
    }


def _stats(state: RoundState) -> list[dict]:
    """결과 화면 하단의 요약 수치 3개.

    **서버가 문구까지 확정해 내려보낸다**(07_api/03 §17). 숫자만 내리면 기기마다
    반올림이 달라져 같은 판을 본 사람들이 다른 확률을 읽는다.

    항목은 08_screen/06_result.md 「승자형」이 정한 참가자 수 · 당첨 확률 ·
    결정까지 걸린 시간이다.
    """
    n = len(state.roster)
    return [
        {"label": "참가자 수", "value": f"{n}명"},
        {"label": "당첨 확률", "value": f"{100 / n:.1f}%" if n else "-"},
        {"label": "결정까지", "value": game_service.elapsed_text(state)},
    ]
