"""시간초 잡기 진행 — 가이드 · 측정 · 판정 · 재대결 · 결과.

    GUIDE(3초) → RUNNING(10초 + 목표 + 3초) → 판정 ┬ 확정 → REVEAL(3초) → RESULT
                                                  ├ 동점 → TIE_NOTICE(3초) → REMATCH → 판정
                                                  └ 교착 → DEADLOCK — 방장이 고른다

**클라이언트가 잰 값을 판정에 쓰는 유일한 게임이다.** 서버 도착 시각으로 경과 시간을
계산하면 START·STOP 두 편도 지연의 차이가 값에 실려, 감각이 아니라 회선이 승자를
정한다. 측정은 클라이언트 단조 시계에 맡기고 서버가 자기 관측값으로 대조한다.

**대조에 실패해도 승자 후보에서 빼지 않는다.** 신고값을 버리고 서버 관측값으로
판정할 뿐이다 — 조작해도 이득이 없고 회선이 튄 정상 참가자도 배제되지 않는다.
어느 값으로 판정했는지는 records[].source에 남고, 대체됐다는 사실은 **그 사람에게만**
알린다.

규칙의 정본은 docs/05_game_rules/05_timer.md다.
"""

import logging

from app.domain import errors
from app.domain.games import timer as rules
from app.domain.games.contract import Outcome
from app.infra.memory.runtime_store import RoundState, store
from app.services import game_service, round_service
from app.services.games.base import ActionSpec

log = logging.getLogger("modupick.game")

GAME_ID = rules.GAME_ID

#: 07_api/03 「game:action type 8종」의 5·6번. **전원 · 각 1회.**
#: 재대결도 같은 type을 재사용한다 — 대상자만 좁아진다.
ACTIONS: dict[str, ActionSpec] = {
    rules.START_KIND: ActionSpec(
        phases=frozenset({rules.Phase.RUNNING, rules.Phase.REMATCH})
    ),
    rules.STOP_KIND: ActionSpec(
        phases=frozenset({rules.Phase.RUNNING, rules.Phase.REMATCH})
    ),
}


# ── 진입 ───────────────────────────────────────────────────────────────────


async def begin(room_pk: int, *, skip_guide: bool = False) -> None:
    """첫 단계로 들어간다. skip_guide는 「다시 하기」 경로다(G-4)."""
    if skip_guide:
        await _enter_running(room_pk)
        return

    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.GUIDE, duration_ms=game_service.GUIDE_MS
    )
    game_service.arm(room_pk, seq, game_service.GUIDE_MS, _enter_running)


async def _enter_running(room_pk: int) -> None:
    """본판. **명단 스냅샷 전원이 대상이다.**

    라운드 마감은 가장 늦게 START한 참가자의 개인 제한과 같은 시각이다. 이 시각에
    판이 반드시 끝난다 — 아무도 누르지 않아도 START 마감이 미시작을, START만 하고
    멈추지 않아도 개인 제한이 미정지를 확정한다.
    """
    await _open_round(room_pk, phase=rules.Phase.RUNNING)


async def _enter_rematch(room_pk: int) -> None:
    """재대결. 대상이 직전 동점자로 줄고 목표 시간·판정 기준은 그대로다."""
    await _open_round(room_pk, phase=rules.Phase.REMATCH)


async def _open_round(room_pk: int, *, phase: str) -> None:
    state = store.round_of(room_pk)
    if state is None:
        return
    duration = rules.round_deadline_ms(_target(state))
    seq = await round_service.emit_phase(
        room_pk, phase=phase, duration_ms=duration, tie_round=state.repeat
    )
    game_service.arm(room_pk, seq, duration, _judge)


def _target(state: RoundState) -> int:
    return int(state.config.get("targetSeconds", 5)) * 1000


def _context(state: RoundState):
    return game_service.build_context(
        state, repeat=state.repeat, tie_pool=state.tie_pool
    )


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
    """START와 STOP을 받는다. **각자 1회이고 되돌릴 수 없다**(G-9)."""
    entrants = rules.entrants_of(_context(state))
    if member_id not in entrants:
        # 재대결에서 동점자가 아닌 사람이다. 이번 회차에는 입력하지 않아도 된다.
        raise errors.DomainError(errors.GAME_NOT_ELIGIBLE)
    if game_service.has_input_from(state, member_id, kind=action_type):
        raise errors.DomainError(errors.GAME_ALREADY_SUBMITTED)

    if action_type == rules.START_KIND:
        game_service.record_input(state, member_id=member_id, kind=action_type)
    else:
        await _accept_stop(
            room_pk, state, participant_pk=participant_pk,
            member_id=member_id, payload=payload,
        )

    started, stopped = _counts(state)
    await game_service.emit_progress(
        room_pk,
        {
            "startedCount": started,
            "stoppedCount": stopped,
            "totalCount": len(entrants),
        },
    )

    # **대상자 전원이 멈췄으면 마감을 기다리지 않는다.** 미시작·미정지는 시간이
    # 지나야 확정되므로 그쪽은 마감이 맡는다.
    if stopped >= len(entrants):
        round_service.stop_timers(state)
        await _judge(room_pk)


async def _accept_stop(
    room_pk: int,
    state: RoundState,
    *,
    participant_pk: int,
    member_id: str,
    payload: dict | None,
) -> None:
    """STOP 1건. 신고한 경과 시간을 서버 관측값과 대조한다.

    **START 없이 온 STOP은 받지 않는다.** 판정도 보지 않지만 여기서 걸러야 참가자가
    "멈췄는데 기록이 없다"는 상태에 빠지지 않는다.
    """
    start = _find(state, member_id, rules.START_KIND)
    if start is None:
        raise errors.DomainError(errors.GAME_INVALID_ACTION)

    client_ms = _elapsed_of(payload)
    item = game_service.record_input(
        state, member_id=member_id, kind=rules.STOP_KIND, payload=client_ms
    )

    # 판정과 같은 함수로 대조한다. 두 벌로 갈라지면 통지와 결과가 어긋난다.
    _, source = rules.measure(
        start.arrived_ms, item.arrived_ms, client_ms, _target(state)
    )
    if source is rules.Source.SERVER_OBSERVED:
        # **보낸 사람에게만 알린다.** 기록은 남고 순위표에도 오른다.
        await game_service.notify(
            room_pk, participant_pk, errors.GAME_ELAPSED_REJECTED
        )


def _elapsed_of(payload: dict | None) -> int | None:
    """elapsedMs를 꺼낸다. **0 이상의 정수만 받는다**(07_api/03).

    None이면 판정이 서버 관측값을 쓴다. bool은 int의 하위형이라 뺀다.
    """
    if payload is None:
        return None
    if not isinstance(payload, dict):
        raise errors.DomainError(errors.COMMON_VALIDATION_FAILED)
    raw = payload.get("elapsedMs")
    if raw is None:
        return None
    if type(raw) is not int or raw < 0:
        raise errors.DomainError(errors.COMMON_VALIDATION_FAILED)
    return raw


def _find(state: RoundState, member_id: str, kind: str):
    for item in state.inputs:
        if item.participant_id == member_id and item.kind == kind:
            return item
    return None


def _counts(state: RoundState) -> tuple[int, int]:
    started = sum(1 for i in state.inputs if i.kind == rules.START_KIND)
    stopped = sum(1 for i in state.inputs if i.kind == rules.STOP_KIND)
    return started, stopped


# ── 판정 ───────────────────────────────────────────────────────────────────


async def _judge(room_pk: int) -> None:
    """한 회차를 판정한다. **마감과 조기 완료가 같은 자리로 들어온다.**"""
    state = store.round_of(room_pk)
    if state is None or state.result_data is not None:
        return
    if state.phase not in (rules.Phase.RUNNING, rules.Phase.REMATCH):
        return

    verdict = rules.judge(_context(state), tuple(state.inputs))

    if verdict.outcome is Outcome.TIE:
        # **기록 값을 내보내지 않는다**(G-10). 동점자 명단만 3초 보인다.
        await game_service.open_tie(
            room_pk,
            phase=rules.Phase.TIE_NOTICE,
            candidate_kind="MEMBER",
            candidate_ids=verdict.tie_pool,
            handler=_enter_rematch,
        )
        return

    if verdict.outcome is Outcome.HOST_CHOICE:
        await game_service.require_decision(
            room_pk,
            phase=rules.Phase.DEADLOCK,
            reason="TIE_EXHAUSTED",
            candidate_kind="MEMBER",
            candidate_ids=verdict.tie_pool,
        )
        return

    if not await game_service.settle(room_pk, verdict):
        return

    seq = await round_service.emit_phase(
        room_pk,
        phase=verdict.next_phase or rules.Phase.REVEAL,
        duration_ms=verdict.next_deadline,
    )
    if verdict.next_deadline:
        game_service.arm(room_pk, seq, verdict.next_deadline, _enter_result)


async def on_retry(room_pk: int) -> None:
    """교착에서 방장이 다시 시작을 골랐다. 본판을 다시 연다.

    **재대결 카운터를 0으로 되돌린다.** 기록은 인메모리에만 있고 단계 전이가 비우므로
    따로 지울 것이 없다. 가이드는 띄우지 않는다(G-4).
    """
    state = store.round_of(room_pk)
    if state is None:
        return
    state.repeat = 0
    state.tie_pool = ()
    log.info("시간초 다시 시작 — room=%s round=%s", room_pk, state.round_id)
    await _enter_running(room_pk)


async def _enter_result(room_pk: int) -> None:
    await game_service.enter_result(room_pk, phase=rules.Phase.RESULT)


# ── 저장 형식 → 와이어 형식 ────────────────────────────────────────────────


def wire_result(state: RoundState) -> tuple[str, dict]:
    """result_data를 game:result의 (variant, result)로 옮긴다.

    WINNER의 detail은 targetMs · criterion · records다(07_api/03 §17). 저장은
    판정용 절대 오차(absDiffMs)까지 들고 있지만 화면은 부호 있는 오차를 그리므로
    **저장 그대로를 내보내지 않는다.**
    """
    data = state.result_data or {}
    winners = data.get("winnerMemberIds") or []
    return "WINNER", {
        "topic": state.config.get("topic"),
        "winnerMemberId": winners[0] if winners else None,
        "detail": {
            "targetMs": _target(state),
            "criterion": state.config.get("criterion", "CLOSEST"),
            "records": [
                {
                    "memberId": r["memberId"],
                    "elapsedMs": r["elapsedMs"],
                    "diffMs": r["diffMs"],
                    "source": r["source"],
                    "status": r["status"],
                }
                for r in data.get("records", ())
            ],
        },
        "stats": _stats(state),
    }


def _stats(state: RoundState) -> list[dict]:
    """결과 화면 하단의 요약 수치 3개.

    08_screen/06_result.md 「승자형」이 시간초에 정한 목표 시간 · 1위 기록 ·
    1위 오차다. 1위는 순위표의 첫 행이며 유효 기록이 없으면 비운다.
    """
    records = (state.result_data or {}).get("records") or []
    top = next((r for r in records if r["status"] == "recorded"), None)
    target = _target(state)
    return [
        {"label": "목표 시간", "value": f"{target / 1000:.0f}초"},
        {
            "label": "1위 기록",
            "value": f"{top['elapsedMs'] / 1000:.2f}초" if top else "-",
        },
        {
            "label": "1위 오차",
            "value": f"{top['diffMs'] / 1000:+.2f}초" if top else "-",
        },
    ]
