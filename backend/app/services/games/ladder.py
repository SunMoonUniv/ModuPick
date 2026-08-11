"""사다리타기 진행 — 가이드 · 방장 대기 · 경로 연출 · 결과.

    GUIDE(3초) → ARMED(30초) → [START 또는 자동 실행] → DRAWING(진행 속도) → REVEAL(3초) → RESULT

룰렛과 같은 흐름이고 다른 것은 셋이다 — 연출 길이가 방장 설정(진행 속도)에서 오고,
결과가 1인 선정이 아니라 전원 배정이며, 저장 직전에 뼈대가 optionId를 채운다.

규칙의 정본은 docs/05_game_rules/03_ladder.md이며 「종료 증명」이 상한 41초를 이
값들로 논증한다.
"""

import logging
import secrets
from dataclasses import replace

from sqlalchemy import select, update

from app.domain.enums import EndedReason, RoundStatus
from app.domain.games import ladder as rules
from app.domain.games.contract import Verdict
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import game_options, game_rounds
from app.infra.memory.runtime_store import RoundState, store
from app.services import game_service, round_service
from app.services.games.base import ActionSpec

log = logging.getLogger("modupick.game")

GAME_ID = rules.GAME_ID

#: 07_api/03 「game:action type 8종」의 2번. **방장만 · ARMED에서만 · 1회.**
#: 참가자 입력은 어느 단계에서도 정의되지 않는다 — 레인 선택은 폐기됐다(D-33).
ACTIONS: dict[str, ActionSpec] = {
    "ladder.start": ActionSpec(phases=frozenset({rules.Phase.ARMED}), host_only=True),
}

#: 진행 속도의 화면 문구. **서버가 문구까지 확정해 내려보낸다**(07_api/03 §17) —
#: 요약 수치를 숫자나 코드로 내리면 화면마다 다른 말로 옮겨진다.
_SPEED_TEXT = {"FAST": "빠르게", "NORMAL": "보통", "SLOW": "느리게"}


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
    """상단 참가자·하단 항목이 놓인 채 방장의 START를 기다린다.

    가로선은 아직 보이지 않는다 — 판정이 아직 돌지 않았고, 미리 그리면 결과가 먼저
    새어 나간다. 30초가 지나면 서버가 대신 실행한다.
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
    """START 1건을 받고 곧바로 판정을 연다.

    **판정에 쓰이지 않더라도 입력을 남긴다.** 「방장이 언제 눌렀는가」는 자동 실행과
    구분되는 유일한 흔적이고, 입력 경로를 게임마다 다르게 두지 않는다.
    """
    del participant_pk, payload  # START에는 페이로드가 없다

    game_service.record_input(state, member_id=member_id, kind=action_type)
    await run(room_pk)


# ── 판정 ───────────────────────────────────────────────────────────────────


async def run(room_pk: int) -> None:
    """판정을 실행하고 배정을 확정한다.

    **방장의 START와 30초 자동 실행이 같은 자리로 들어온다.** 둘 중 무엇이 먼저
    닿아도 결과가 같아야 하므로(시드와 명단만으로 정해진다) 경로를 나누지 않는다.
    """
    state = store.round_of(room_pk)
    if state is None or state.result_data is not None:
        return

    verdict = await _judge(state)
    if verdict is None:
        # 자기 검증이 두 번 다 어긋났다. **결과를 내보내지 않고 판을 세운다** —
        # 어긋난 배정을 남기는 것보다 낫다(05_game_rules/03).
        await round_service.finish(
            room_pk, reason=EndedReason.ERROR, status=RoundStatus.CANCELLED
        )
        return

    verdict = await _with_option_ids(state, verdict)
    if not await game_service.settle(room_pk, verdict):
        return

    # 경로가 그려지기 시작하는 순간 클라이언트에 가로선과 배정이 있어야 한다. 전이와
    # 값이 원자적으로 도착해야 "DRAWING인데 어디로 가는지 모르는" 창이 생기지 않는다.
    seq = await round_service.emit_phase(
        room_pk,
        phase=verdict.next_phase or rules.Phase.DRAWING,
        duration_ms=verdict.next_deadline,
        payload=dict(verdict.detail) if verdict.detail else None,
    )
    if verdict.next_deadline:
        game_service.arm(room_pk, seq, verdict.next_deadline, _enter_reveal)


async def _judge(state: RoundState) -> Verdict | None:
    """판정한다. 자기 검증에 실패하면 시드를 다시 뽑아 한 번만 더 시도한다.

    알고리즘이 옳다면 이 검증은 절대 실패하지 않으며, 실패한다면 그것은 구현 결함이다
    (05_game_rules/03 「1:1 대응이 보장되는 이유」). 두 번째도 실패하면 None이다.
    """
    for attempt in range(2):
        try:
            return rules.judge(game_service.build_context(state), tuple(state.inputs))
        except RuntimeError:
            log.exception(
                "사다리 자기 검증 실패 — round=%s 시도=%s", state.round_id, attempt + 1
            )
            if attempt == 0:
                await _reseed(state)
    return None


async def _reseed(state: RoundState) -> None:
    """시드를 다시 뽑는다.

    **DB에도 함께 쓴다.** game_rounds.random_seed와 result_data.seed가 갈라지면
    저장된 시드로 결과를 다시 낼 수 없어 재현성이 무너진다.
    """
    state.seed = secrets.randbelow(round_service.SEED_MAX)
    async with transaction() as conn:
        await conn.execute(
            update(game_rounds)
            .where(game_rounds.c.id == state.round_pk)
            .values(random_seed=state.seed)
        )


async def _with_option_ids(state: RoundState, verdict: Verdict) -> Verdict:
    """저장할 assignments의 slot을 optionId로 바꾼다.

    **저장과 전송이 다른 축을 쓴다.** 저장 형식(06_database/04)은 도착 항목을
    game_options 행으로 가리키고, DRAWING payload는 화면이 경로를 그려야 해서 도착
    컬럼 번호를 그대로 쓴다. optionId는 순수 판정 함수가 알 수 없는 값이므로 이
    자리가 채운다 — **도착 컬럼이 그 행의 sort_order와 같은 축이다.**

    **detail은 건드리지 않는다.** 연출은 slot으로 그린다.

    도착 컬럼에 맞는 행이 없으면 KeyError로 터진다. **조용히 None을 저장하지
    않는다** — 저장 스키마가 optionId를 실제 행을 가리키는 값으로 규정하므로 빈 값이
    남으면 결과를 나중에 읽을 때 항목을 찾을 수 없고, 그 상태가 정상처럼 보인다.
    누락은 라운드 시작의 선택지 적재가 어긋났을 때만 생기는 구현 결함이다.
    """
    by_slot = await _option_ids(state.round_pk)
    persist = dict(verdict.persist or {})
    persist["assignments"] = [
        {
            "memberId": a["memberId"],
            "optionId": by_slot[a["slot"]],
            "label": a["label"],
        }
        for a in persist.get("assignments", ())
    ]
    return replace(verdict, persist=persist)


async def _option_ids(round_pk: int) -> dict[int, str]:
    """sort_order -> option_id. 라운드가 설 때 박아 둔 도착 항목 행이다."""
    async with readonly() as conn:
        rows = (
            await conn.execute(
                select(game_options.c.sort_order, game_options.c.option_id).where(
                    game_options.c.game_round_id == round_pk
                )
            )
        ).all()
    return {r.sort_order: r.option_id for r in rows}


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

    ASSIGN의 result는 topic · pairs · seed · stats다(07_api/03 §17). 저장의
    assignments가 여기서 pairs가 되고 **optionId는 화면에 나가지 않는다** — 항목을
    가리키는 것은 label이고 optionId는 저장·감사 축이다.
    """
    data = state.result_data or {}
    return "ASSIGN", {
        "topic": state.config.get("topic"),
        "pairs": [
            {"memberId": a["memberId"], "itemLabel": a["label"]}
            for a in data.get("assignments", ())
        ],
        "seed": data.get("seed"),
        "stats": _stats(state),
    }


def _stats(state: RoundState) -> list[dict]:
    """결과 화면 하단의 요약 수치 3개.

    08_screen/06_result.md 「배정형」이 정한 배정 인원 · 역할 항목 수 · 진행 속도다.

    **역할 항목 수는 방장이 설정한 원본 개수다.** 정규화한 뒤의 개수는 참가자 수와
    항상 같아 타일 둘이 같은 숫자를 보이고, 잘렸는지 채워졌는지도 읽을 수 없다.
    """
    items = state.config.get("resultItems") or ()
    speed = state.config.get("speed") or rules.DEFAULT_SPEED
    return [
        {"label": "배정 인원", "value": f"{len(state.roster)}명"},
        {"label": "역할 항목", "value": f"{len(items)}개"},
        {"label": "진행 속도", "value": _SPEED_TEXT.get(speed, speed)},
    ]
