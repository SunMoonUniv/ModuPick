"""게임 진행 — 판정 호출 · 결과 확정 · 단계 자동 전이.

`round_service`가 라운드의 생명주기(태어남·죽음)를 맡고, 여기가 **그 안에서 게임이
어떤 순서로 흐르는가**를 맡는다. 둘을 가르는 축은 "게임마다 다른가"다 — 라운드가
game_rounds 행을 만들고 방을 PLAYING으로 옮기는 방식은 6종이 같지만, 어떤 단계를
어떤 순서로 밟는지는 게임마다 다르다.

**서버가 제한 시간의 주체다.** 마감은 서버 타이머 콜백이 처리하며, 클라이언트가
"시간 다 됐다"고 알리는 C→S 이벤트를 두지 않는다(07_api/03 「타이머 동기화」).

판정 함수는 `domain/games/`의 순수 함수다. 시각을 읽지 않고 DB·소켓에 접근하지
않으므로, **저장된 시드로 언제든 같은 결과를 다시 낼 수 있다.** 그 성질을 지키려면
이 계층이 판정에 넘기는 값도 재현 가능한 것만이어야 한다 — 명단 스냅샷과 시드다.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime

from sqlalchemy import select

from app.domain import errors
from app.domain.enums import GameId, Role
from app.domain.games import roulette
from app.domain.games.contract import JudgeContext, Verdict
from app.infra.clock import clock
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import game_results, participants
from app.infra.memory.runtime_store import RoundState, store
from app.schemas.rest import iso_z
from app.services import round_service

log = logging.getLogger("modupick.game")


# ── 연출 길이 상수 ─────────────────────────────────────────────────────────
#
# 05_game_rules/02_roulette.md 「종료 증명」이 고정한 값이다. 서버 상수이며 방장
# 설정이 아니다 — 라운드마다 달라질 이유가 없고, 달라지면 종료 상한 41초를 증명할 수
# 없게 된다. 회전 시간(5000ms)만은 판정 함수가 돌려주므로 여기에 적지 않는다.

#: 규칙 가이드. 다시 하기로 진입하면 건너뛴다(G-4).
GUIDE_MS = 3_000
#: 방장의 PICK을 기다리는 시간. 지나면 서버가 자동 실행한다.
ARMED_MS = 30_000
#: 당첨 조각 강조. 지나면 결과 화면으로 넘어간다(G-11).
REVEAL_MS = 3_000


# ── 진입 ───────────────────────────────────────────────────────────────────


async def begin(room_pk: int, *, skip_guide: bool = False) -> None:
    """라운드 시작 직후 첫 게임 단계로 들어간다.

    `round_service.start`가 game:started와 game:phase(READY)까지 보낸 뒤 이어서
    부른다. READY는 라운드가 섰다는 뜻이고, 게임의 첫 단계는 여기서 시작한다.

    skip_guide는 「다시 하기」 경로다(G-4). 같은 사람들이 같은 규칙을 다시 보는 것이
    되므로 가이드를 건너뛴다.
    """
    state = store.round_of(room_pk)
    if state is None:
        return

    if state.game_id != GameId.ROULETTE.value:
        # 아직 만들지 않은 게임이다. READY에 머물며 방장의 round:close를 기다린다.
        log.info("판정 미구현 게임 — room=%s game=%s", room_pk, state.game_id)
        return

    if skip_guide:
        await _enter_armed(room_pk)
    else:
        seq = await round_service.emit_phase(
            room_pk, phase=roulette.Phase.GUIDE, duration_ms=GUIDE_MS
        )
        _arm(room_pk, seq, GUIDE_MS, _enter_armed)


async def _enter_armed(room_pk: int) -> None:
    """방장의 PICK을 기다린다. 30초가 지나면 서버가 대신 실행한다.

    **방장이 누르지 않아도 판은 끝난다.** 누르지 않으면 영원히 대기하는 것이
    프로토타입의 동작이었고, 그러면 방이 만료될 때까지 아무도 나가지 못한다.
    """
    seq = await round_service.emit_phase(
        room_pk, phase=roulette.Phase.ARMED, duration_ms=ARMED_MS
    )
    _arm(room_pk, seq, ARMED_MS, _run_judgment)


# ── 입력 ───────────────────────────────────────────────────────────────────


async def handle_action(
    *,
    participant_pk: int,
    room_pk: int,
    round_id: str,
    phase_seq: int,
    action_type: str,
) -> None:
    """game:action 하나를 받는다.

    검사 순서가 정해져 있다 — 라운드 · 단계 · type · 권한. **단계를 type보다 먼저
    본다**: 늦게 도착한 프레임은 type이 무엇이든 지난 단계의 입력이고, 그때
    game.invalid_action을 돌려주면 클라이언트가 "잘못 눌렀다"로 읽는다.
    """
    state = store.round_of(room_pk)
    if state is None or state.round_id != round_id:
        raise errors.DomainError(errors.GAME_ROUND_NOT_FOUND)
    if state.phase_seq != phase_seq:
        raise errors.DomainError(errors.GAME_STALE_PHASE)

    if action_type != _ACTION_OF.get(state.game_id):
        raise errors.DomainError(errors.GAME_INVALID_ACTION)

    if state.phase != roulette.Phase.ARMED:
        # SPINNING 이후의 PICK은 버린다. 최초 1회만 유효하다(멱등).
        raise errors.DomainError(errors.GAME_INVALID_ACTION)

    async with readonly() as conn:
        me = (
            await conn.execute(
                select(participants.c.role).where(participants.c.id == participant_pk)
            )
        ).first()
    if me is None or me.role != Role.HOST.value:
        raise errors.DomainError(errors.MEMBER_NOT_HOST)

    await _run_judgment(room_pk)


#: 게임별로 판정을 여는 game:action type. 07_api/03 「game:action type 8종」.
_ACTION_OF = {GameId.ROULETTE.value: "roulette.pick"}


# ── 판정 ───────────────────────────────────────────────────────────────────


async def _run_judgment(room_pk: int) -> None:
    """판정을 실행하고 결과를 확정한다.

    **방장의 PICK과 30초 자동 실행이 같은 자리로 들어온다.** 둘 중 무엇이 먼저
    닿아도 결과가 같아야 하므로(시드와 명단만으로 정해진다) 경로를 나누지 않는다.

    이 함수는 **한 라운드에 한 번만 통과한다.** 아래 선점 구간에 await이 없어서,
    연타로 들어온 두 번째 호출은 반드시 이미 채워진 result_data를 보고 돌아간다.
    """
    state = store.round_of(room_pk)
    if state is None or state.result_data is not None:
        return

    verdict = _judge(state)

    # ── 선점 구간: 여기에 await을 넣지 않는다 ──────────────────────────────
    state.result_data = dict(verdict.persist or {})
    state.decided_at = clock.now()
    # ────────────────────────────────────────────────────────────────────

    # 결과는 연출보다 먼저 저장한다. 회전 5초 사이에 서버가 죽어도 확정된 결과가
    # 남아 있어야 하고, 저장이 실패하면 연출을 시작하지 않는 편이 낫다.
    async with transaction() as conn:
        await conn.execute(
            game_results.insert().values(
                game_round_id=state.round_pk,
                result_data=state.result_data,
                created_at=state.decided_at,
            )
        )

    log.info(
        "판정 확정 — room=%s round=%s winner=%s",
        room_pk,
        state.round_id,
        verdict.winner,
    )

    # 연출 시작 값은 game:phase에 실어 보낸다. 전이와 값이 원자적으로 도착해야
    # "SPINNING인데 목표 각도를 모르는" 창이 생기지 않는다.
    seq = await round_service.emit_phase(
        room_pk,
        phase=verdict.next_phase or roulette.Phase.SPINNING,
        duration_ms=verdict.next_deadline,
        payload=dict(verdict.detail) if verdict.detail else None,
    )
    if verdict.next_deadline:
        _arm(room_pk, seq, verdict.next_deadline, _enter_reveal)


def _judge(state: RoundState) -> Verdict:
    """판정 함수에 넘길 문맥을 만들고 부른다.

    **roster에는 memberId만 넣는다.** RoundState.roster는 닉네임·아바타를 함께 들고
    있지만(game:started가 쓴다) 판정에 표시 정보가 들어가면 결과 재현이 그 값에
    묶인다 — 닉네임을 바꾸면 같은 시드가 다른 입력이 된다.
    """
    ctx = JudgeContext(
        round_id=state.round_id,
        game_id=state.game_id,
        seed=state.seed,
        roster=tuple(m["memberId"] for m in state.roster),
        config=state.config,
        phase=state.phase,
    )
    # 룰렛은 참가자 입력을 판정에 쓰지 않는다. 방장이 30초간 누르지 않아 서버가
    # 자동 실행한 경우와 같은 결과가 나와야 하기 때문이다.
    return roulette.judge(ctx)


async def _enter_reveal(room_pk: int) -> None:
    seq = await round_service.emit_phase(
        room_pk, phase=roulette.Phase.REVEAL, duration_ms=REVEAL_MS
    )
    _arm(room_pk, seq, REVEAL_MS, _enter_result)


async def _enter_result(room_pk: int) -> None:
    """결과 화면으로 넘긴다. **마감이 없는 단계다** — 방장의 round:close를 기다린다."""
    from app.schemas.events import GameResultData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    state = store.round_of(room_pk)
    if state is None or state.result_data is None:
        return

    await round_service.emit_phase(room_pk, phase=roulette.Phase.RESULT)

    finished_at = state.decided_at or clock.now()
    await registry.broadcast(
        room_pk,
        outgoing(
            "game:result",
            GameResultData(
                roomVersion=store.bump_version(room_pk),
                roundId=state.round_id,
                gameId=state.game_id,
                variant="WINNER",
                result=_wire_result(state),
                finishedAt=iso_z(finished_at),
            ).model_dump(),
        ),
    )


# ── 저장 형식 → 와이어 형식 ────────────────────────────────────────────────


def _wire_result(state: RoundState) -> dict:
    """result_data를 game:result의 result로 옮긴다.

    **두 형식은 다르다.** 저장(06_database/04 「게임별 JSON 스키마」)은 재현과 감사를
    위한 형태이고, 와이어(07_api/03 §17)는 화면이 그대로 그릴 수 있는 형태다.
    같은 값에 이름이 둘인 자리가 있고(wheelOrder ↔ sliceOrder), 판정이 만들지 않는
    값도 있다(topic · stats).

    **변환은 여기 한 곳에서만 한다.** 두 군데에서 각자 옮기면 한쪽만 고쳐진다.
    """
    data = state.result_data or {}
    winners = data.get("winnerMemberIds") or []
    return {
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
        {"label": "결정까지", "value": _elapsed_text(state.started_at, state.decided_at)},
    ]


def _elapsed_text(started: datetime | None, decided: datetime | None) -> str:
    """방장이 시작을 누른 순간부터 당첨자가 정해진 순간까지.

    가이드 3초와 방장이 망설인 시간이 모두 들어간다 — 사람이 체감하는 "이번 판에
    걸린 시간"이 그것이기 때문이다.
    """
    if started is None or decided is None:
        return "-"
    return f"{max(0.0, (decided - started).total_seconds()):.1f}초"


# ── 마감 타이머 ────────────────────────────────────────────────────────────


def _arm(
    room_pk: int,
    phase_seq: int,
    delay_ms: int,
    handler: Callable[[int], Awaitable[None]],
) -> None:
    """이 단계의 마감에 깨어날 태스크를 건다.

    **phaseSeq를 함께 들고 깨어난다.** 방장의 PICK으로 단계가 먼저 넘어갔다면 이
    태스크는 지난 단계의 것이므로 아무것도 하지 않아야 한다. 취소가 정상 경로이고
    이 검사는 취소를 놓친 경우의 두 번째 방어선이다.
    """
    state = store.round_of(room_pk)
    if state is None:
        return
    state.deadline_task = asyncio.create_task(
        _on_deadline(room_pk, phase_seq, delay_ms, handler)
    )


async def _on_deadline(
    room_pk: int,
    phase_seq: int,
    delay_ms: int,
    handler: Callable[[int], Awaitable[None]],
) -> None:
    try:
        await asyncio.sleep(delay_ms / 1000)
        state = store.round_of(room_pk)
        if state is None or state.phase_seq != phase_seq:
            return
        await handler(room_pk)
    except asyncio.CancelledError:
        raise
    except Exception:
        # **마감 처리의 실패가 방을 멈추게 두지 않는다.** 여기서 삼키지 않으면
        # 태스크가 조용히 죽고 판이 그 단계에 영원히 머문다.
        log.exception("마감 처리 실패 — room=%s phase_seq=%s", room_pk, phase_seq)
