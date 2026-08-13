"""눈치게임 진행 — 가이드 · 라운드 반복 · 최후 1인.

    GUIDE(3초) → ROUND(설정) → 판정 → ROUND_RESULT(3초) ┬ 탈락자 0·생존자 0 → 방장이 고른다
                                   ↑                    ├ 생존자 2 이상    → 다음 ROUND
                                   └────────────────────┤
                                                        └ 생존자 1        → REVEAL(3초) → RESULT

**라운드가 여러 번 도는 유일한 게임이다.** 그래서 판정이 지난 라운드 기록을 받고,
생존자 집합이 라운드마다 줄어든다.

**누르면 빠지고 못 누른 사람만 남는다.** 그래서 라운드를 끊는 것이 겹침이다 — 겹치는
순간 마감해야 아직 누르지 못한 사람들이 기회를 잃고 다음 라운드로 밀린다.

**누른 사람은 그 자리에서 통과가 확정이다.** 혼자였든 겹쳤든 후보에서 빠지므로
판정을 기다릴 것이 없다. 그래서 UP이 도착할 때마다 **마감 때와 같은 모양의 라운드
기록을** 그대로 내보내고, 그중 무엇을 그릴지는 화면이 고른다. 누구인지까지 밝혀도
되는 이유는 누르면 무조건 빠지는 구조라(D-38) 남이 이미 눌렀다는 것을 알아도 얻을
것이 없기 때문이다 — 혼자 눌러야 안전하던 종전 규칙에서는 그것이 곧 정답이라 가렸다.

규칙의 정본은 docs/05_game_rules/07_nunchi.md다.
"""

import logging

from app.domain import errors
from app.domain.games import nunchi as rules
from app.domain.games.contract import Outcome
from app.infra.memory.runtime_store import RoundState, store
from app.schemas.rest import iso_z
from app.services import game_service, round_service
from app.services.games.base import ActionSpec

log = logging.getLogger("modupick.game")

GAME_ID = rules.GAME_ID

#: 07_api/03 「game:action type 8종」의 8번. **남은 사람만 · 라운드당 1회.**
ACTIONS: dict[str, ActionSpec] = {
    rules.UP_KIND: ActionSpec(phases=frozenset({rules.Phase.ROUND})),
}


# ── 진입 ───────────────────────────────────────────────────────────────────


async def begin(room_pk: int, *, skip_guide: bool = False) -> None:
    """첫 단계로 들어간다. skip_guide는 「다시 하기」 경로다(G-4)."""
    state = store.round_of(room_pk)
    if state is None:
        return

    # 첫 라운드의 생존자는 명단 스냅샷 전원이다.
    state.survivors = tuple(m["memberId"] for m in state.roster)

    if skip_guide:
        await _enter_round(room_pk)
        return

    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.GUIDE, duration_ms=game_service.GUIDE_MS
    )
    game_service.arm(room_pk, seq, game_service.GUIDE_MS, _enter_round)


def _round_ms(state: RoundState) -> int:
    """라운드 제한 시간. 방장 설정에서 온다(10 · 15 · 20초)."""
    return int(state.config.get("roundSeconds", 15)) * 1000


async def _enter_round(room_pk: int) -> None:
    """한 라운드를 연다. 남은 사람만 누를 수 있다."""
    state = store.round_of(room_pk)
    if state is None:
        return
    duration = _round_ms(state)
    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.ROUND, duration_ms=duration
    )
    game_service.arm(room_pk, seq, duration, _judge)


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
    """UP 1건을 받는다.

    **이미 빠진 사람은 이번 라운드의 대상이 아니다.** 지난 라운드에 눌러 후보에서
    빠졌으므로 game.not_eligible이며, 「잘못 눌렀다」는 뜻의 invalid_action이 아니다.
    """
    del participant_pk, payload  # UP에는 페이로드가 없다

    survivors = state.survivors or ()
    if member_id not in survivors:
        raise errors.DomainError(errors.GAME_NOT_ELIGIBLE)
    if game_service.has_input_from(state, member_id, kind=action_type):
        raise errors.DomainError(errors.GAME_ALREADY_SUBMITTED)

    game_service.record_input(state, member_id=member_id, kind=action_type)
    ups = [i for i in state.inputs if i.kind == rules.UP_KIND]

    # **지금까지의 라운드 기록을 마감 때와 같은 모양으로 내보낸다.** 누른 사람은
    # 통과가 확정이므로 라운드가 끝나기를 기다릴 이유가 없다. 화면은 두 경로를 같은
    # 코드로 그린다.
    await _emit_pressed(room_pk, state, survivors, ups)

    # **겹치면 그 자리에서 라운드가 끝난다.** 직전에 받은 입력과의 간격이 판정창
    # 이하이면 겹침이며, 아직 누르지 못한 사람들은 기회를 잃고 다음 라운드로 밀린다.
    window_ms = int(state.config.get("windowMs", 300))
    overlapped = len(ups) >= 2 and ups[-1].arrived_ms - ups[-2].arrived_ms <= window_ms

    # **한 명만 남는 순간에도 끝난다.** 그 한 명에게 누를 기회를 주면, 안 누르면
    # 뽑히는 처지라 눌러서 전원 탈락(생존자 0)으로 판을 무르는 것이 언제나 이득이
    # 된다. 기회를 주지 않는 것으로 그 탈출구를 막는다.
    last_one = len(ups) >= len(survivors) - 1

    if overlapped or last_one:
        round_service.stop_timers(state)
        await _judge(room_pk)


# ── 판정 ───────────────────────────────────────────────────────────────────


async def _judge(room_pk: int) -> None:
    """한 라운드를 판정하고 결과를 3초 공개한다.

    **마감과 조기 완료가 같은 자리로 들어온다.** 단계 검사가 두 번째 호출을 막는다.
    """
    state = store.round_of(room_pk)
    if state is None or state.result_data is not None:
        return
    if state.phase != rules.Phase.ROUND:
        return

    ctx = game_service.build_context(
        state, alive=state.survivors, history=tuple(state.history)
    )
    verdict = rules.judge(ctx, tuple(state.inputs))
    detail = dict(verdict.detail or {})
    record = dict(detail.get("round") or {})

    # 확정이면 연출보다 저장이 먼저다. 판정이 persist에 전 라운드 기록까지 담아 둔다.
    if verdict.outcome is Outcome.DECIDED and not await game_service.settle(
        room_pk, verdict
    ):
        return

    # **무효 라운드도 기록에 남긴다.** 남기지 않으면 저장의 voidRound가 서지 않고,
    # 결과 화면이 "그 라운드에 무슨 일이 있었는가"를 보일 수 없다.
    state.history.append(record)
    if verdict.outcome is Outcome.TIE:
        # 생존자가 최소 1명 줄었다. 종료 증명이 이 성질에 기댄다.
        state.survivors = verdict.survivors

    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.ROUND_RESULT, duration_ms=rules.ROUND_RESULT_MS
    )
    await _emit_round(room_pk, record)

    if verdict.outcome is Outcome.VOID:
        game_service.arm(room_pk, seq, rules.ROUND_RESULT_MS, _require_decision)
    elif verdict.outcome is Outcome.TIE:
        game_service.arm(room_pk, seq, rules.ROUND_RESULT_MS, _enter_round)
    else:
        game_service.arm(room_pk, seq, rules.ROUND_RESULT_MS, _enter_reveal)


async def _emit_pressed(
    room_pk: int, state: RoundState, survivors: tuple[str, ...], ups: list
) -> None:
    """UP이 도착할 때마다 그 시점까지의 라운드 기록을 내보낸다.

    **마감 때와 완전히 같은 모양이다.** 무엇을 그릴지는 화면이 고르므로 서버가 미리
    골라 줄이지 않는다.

    판정은 마감과 같은 순수 함수를 쓴다. 뒤에 오는 입력이 앞 사람의 혼자 판정을
    겹침으로 뒤집을 수 있으나, **뒤집는 그 입력이 곧 라운드를 끊는 겹침이므로**
    화면에 남는 마지막 값은 마감 판정과 같다.
    """
    presses = {i.participant_id: i.arrived_ms for i in ups}
    result = rules.judge_round(
        survivors,
        presses,
        int(state.config.get("windowMs", 300)),
        order=[m["memberId"] for m in state.roster],
    )
    record = rules.build_record(len(state.history) + 1, survivors, presses, result)
    await _emit_round(room_pk, record, closed=False)


async def _emit_round(room_pk: int, record: dict, *, closed: bool = True) -> None:
    """한 라운드의 지금 판정을 알린다. **라운드 도중과 마감 뒤가 같은 모양을 쓴다.**

    명단을 4종으로 나눠 보낸다 — 혼자 누름·겹쳐 누름은 결과가 같지만(둘 다 탈락)
    화면이 다르게 그려야 하고, 탈락자 전원은 그 둘의 합집합이라 프론트가 다시 계산하지
    않게 함께 싣는다. elapsedMs는 라운드 시작을 0으로 한 **서버 도착 시각**이며,
    누르지 못한 사람은 null이다.

    pressedCount는 **순서 역전을 막는 축이다** — 거의 동시에 도착한 두 입력의 전송
    순서가 뒤집혀도 game_service가 이 수치로 늦게 온 작은 프레임을 버린다(AC-118).
    closed는 마감 프레임인지를 가른다. 마감 전에는 다음 라운드 시작 시각이 없다.
    """
    state = store.round_of(room_pk)
    if state is None:
        return
    await game_service.emit_progress(
        room_pk,
        {
            "round": record.get("roundNo"),
            "pressedCount": len(record.get("eliminatedMemberIds", ())),
            "verdicts": [
                {
                    "memberId": row["memberId"],
                    "verdict": row["verdict"],
                    "elapsedMs": row["offsetMs"],
                }
                for row in record.get("presses", ())
            ],
            "aloneMemberIds": list(record.get("aloneMemberIds", ())),
            "overlappedMemberIds": list(record.get("overlappedMemberIds", ())),
            "eliminatedMemberIds": list(record.get("eliminatedMemberIds", ())),
            "survivingMemberIds": list(record.get("survivingMemberIds", ())),
            "nextRoundStartsAt": (
                iso_z(state.deadline_at) if closed and state.deadline_at else None
            ),
        },
    )


async def _require_decision(room_pk: int) -> None:
    """무효 라운드. 뽑을 수 있는 상태가 아니므로 방장이 끊는다(D-39).

    두 경우가 여기로 온다 — **아무도 누르지 않아** 생존자가 그대로이거나, **전원이
    눌러** 남은 사람이 없거나다. 자동으로 다음 라운드를 열면 같은 상태가 반복될 수
    있다는 점에서 같으므로 둘을 구분하지 않는다.
    """
    state = store.round_of(room_pk)
    if state is None:
        return
    await game_service.require_decision(
        room_pk,
        phase=rules.Phase.VOID_ROUND,
        reason="VOID_ROUND",
        candidate_kind="MEMBER",
        candidate_ids=state.survivors or (),
    )


async def on_retry(room_pk: int) -> None:
    """방장이 다시 시작을 골랐다. **같은 생존자로 다음 라운드를 연다.**

    라운드 번호는 기록이 하나 쌓였으므로 자연히 1 오른다. 생존자 집합은 그대로다.
    """
    log.info("눈치 라운드 재시작 — room=%s", room_pk)
    await _enter_round(room_pk)


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

    RECORD의 result는 topic · pickedMemberId · rounds · stats다(07_api/03 §17).
    저장은 roundNo·offsetMs를 쓰고 와이어는 round·elapsedMs를 쓴다.

    **라운드마다 명단 4종을 함께 싣는다.** 진행 중 판정 페이로드와 같은 모양이라
    결과 화면이 진행 화면과 같은 코드로 라운드를 그릴 수 있다.
    """
    data = state.result_data or {}
    losers = data.get("loserMemberIds") or []
    return "RECORD", {
        "topic": state.config.get("topic"),
        "pickedMemberId": losers[0] if losers else None,
        "rounds": [
            {
                "round": row.get("roundNo"),
                "rows": [
                    {
                        "memberId": p["memberId"],
                        "verdict": p["verdict"],
                        "elapsedMs": p["offsetMs"],
                    }
                    for p in row.get("presses", ())
                ],
                "aloneMemberIds": list(row.get("aloneMemberIds", ())),
                "overlappedMemberIds": list(row.get("overlappedMemberIds", ())),
                "eliminatedMemberIds": list(row.get("eliminatedMemberIds", ())),
                "survivingMemberIds": list(row.get("survivingMemberIds", ())),
            }
            for row in data.get("rounds", ())
        ],
        "stats": _stats(state),
    }


def _stats(state: RoundState) -> list[dict]:
    """결과 화면 하단의 요약 수치 3개.

    08_screen/06_result.md 「기록형」이 정한 라운드 수 · 판정창 · 최종 선정자다.
    **선정자는 닉네임으로 내려보낸다** — 서버가 문구까지 확정한다(07_api/03 §17).
    """
    data = state.result_data or {}
    losers = data.get("loserMemberIds") or []
    names = {m["memberId"]: m["nickname"] for m in state.roster}
    window = int(state.config.get("windowMs", 300))
    return [
        {"label": "라운드 수", "value": f"{len(data.get('rounds', ()))}판"},
        {"label": "판정창", "value": f"{window / 1000:.1f}초"},
        {"label": "최종 선정", "value": names.get(losers[0], "-") if losers else "-"},
    ]
