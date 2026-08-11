"""게임 진행 공통 — 입력 수집 · 판정 실행 · 결과 확정 · 마감 타이머.

축이 셋이다.

    round_service        라운드의 생명주기 — 태어남·죽음과 단계 전이라는 원시 연산
    game_service         그 안에서 판정이 어떻게 실행되고 결과가 어떻게 확정되는가
    services/games/*     어떤 단계를 어떤 순서로 밟는가 — 게임마다 다르다

가르는 기준은 하나다 — **6종이 같으면 여기, 게임마다 다르면 진행 모듈이다.**

**서버가 제한 시간의 주체다.** 마감은 서버 타이머 콜백이 처리하며, 클라이언트가
"시간 다 됐다"고 알리는 C→S 이벤트를 두지 않는다(07_api/03 「타이머 동기화」).

판정 함수는 `domain/games/`의 순수 함수다. 시각을 읽지 않고 DB·소켓에 접근하지
않으므로, **저장된 시드로 언제든 같은 결과를 다시 낼 수 있다.** 그 성질을 지키려면
이 계층이 판정에 넘기는 값도 재현 가능한 것만이어야 한다 — 명단 스냅샷과 시드다.

**진행 모듈이 여기를 import하고 여기는 진행 모듈을 늦게 부른다.** 모듈 최상단에서
서로를 참조하면 import 고리가 생긴다.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable

from sqlalchemy import select

from app.domain import errors
from app.domain.enums import Role
from app.domain.games.contract import JudgeContext, JudgeInput, Verdict
from app.infra.clock import clock
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import game_results, participants
from app.infra.memory.runtime_store import RoundState, store
from app.schemas.rest import iso_z
from app.services import round_service

log = logging.getLogger("modupick.game")


# ── 연출 길이 상수 ─────────────────────────────────────────────────────────
#
# 05_game_rules가 고정한 값 중 **여러 게임이 같게 쓰는 것**만 여기 둔다. 게임 하나만
# 쓰는 값(룰렛의 회전 5초 · 사다리의 진행 속도)은 그 게임의 판정 모듈이 들고 있다.
#
# 서버 상수이며 방장 설정이 아니다 — 라운드마다 달라질 이유가 없고, 달라지면 각
# 게임의 「종료 증명」이 상한을 논증할 수 없게 된다.

#: 규칙 가이드. 6종 공통이며 다시 하기로 진입하면 건너뛴다(G-4).
GUIDE_MS = 3_000
#: 방장의 실행을 기다리는 시간. 룰렛·사다리가 쓰며 지나면 서버가 자동 실행한다.
ARMED_MS = 30_000
#: 확정된 결과를 강조하는 연출. 지나면 결과 화면으로 넘어간다(G-11).
REVEAL_MS = 3_000


# ── 진입 ───────────────────────────────────────────────────────────────────


async def begin(room_pk: int, *, skip_guide: bool = False) -> None:
    """라운드 시작 직후 첫 게임 단계로 들어간다.

    `round_service.start`가 game:started와 game:phase(READY)까지 보낸 뒤 이어서
    부른다. READY는 라운드가 섰다는 뜻이고, 게임의 첫 단계는 여기서 시작한다.

    skip_guide는 「다시 하기」 경로다(G-4). 처리는 게임마다 다르므로 그대로 넘긴다.
    """
    from app.services.games import flow_of

    state = store.round_of(room_pk)
    if state is None:
        return

    flow = flow_of(state.game_id)
    if flow is None:
        # 아직 붙지 않은 게임이다. READY에 머물며 방장의 round:close를 기다린다.
        log.info("진행 미구현 게임 — room=%s game=%s", room_pk, state.game_id)
        return

    await flow.begin(room_pk, skip_guide=skip_guide)


# ── 입력 ───────────────────────────────────────────────────────────────────


async def handle_action(
    *,
    participant_pk: int,
    room_pk: int,
    member_id: str,
    round_id: str,
    phase_seq: int,
    action_type: str,
    payload: dict | None = None,
) -> None:
    """game:action 하나를 받는다.

    검사 순서가 정해져 있다 — 라운드 · 단계 · type · 권한. **단계를 type보다 먼저
    본다**: 늦게 도착한 프레임은 type이 무엇이든 지난 단계의 입력이고, 그때
    game.invalid_action을 돌려주면 클라이언트가 "잘못 눌렀다"로 읽는다.

    **권한은 맨 뒤에 본다.** 지난 단계의 입력에 member.not_host를 돌려주면 방장이
    "권한이 없다"로 읽는다. 접수 조건은 진행 모듈의 ACTIONS가 적고 여기서는 그 표를
    읽기만 한다.
    """
    from app.services.games import flow_of

    state = store.round_of(room_pk)
    if state is None or state.round_id != round_id:
        raise errors.DomainError(errors.GAME_ROUND_NOT_FOUND)
    if state.phase_seq != phase_seq:
        raise errors.DomainError(errors.GAME_STALE_PHASE)

    flow = flow_of(state.game_id)
    spec = flow.ACTIONS.get(action_type) if flow is not None else None
    if spec is None:
        # 이 게임이 받지 않는 type이다.
        raise errors.DomainError(errors.GAME_INVALID_ACTION)
    if state.phase not in spec.phases:
        raise errors.DomainError(errors.GAME_INVALID_ACTION)
    if spec.host_only:
        await ensure_host(participant_pk)

    await flow.on_action(
        room_pk,
        state,
        participant_pk=participant_pk,
        member_id=member_id,
        action_type=action_type,
        payload=payload,
    )


async def ensure_host(participant_pk: int) -> None:
    """방장이 아니면 거절한다.

    **토큰이 들고 있는 역할을 믿지 않는다.** 참가자 행을 다시 읽어 대조한다.
    """
    async with readonly() as conn:
        me = (
            await conn.execute(
                select(participants.c.role).where(participants.c.id == participant_pk)
            )
        ).first()
    if me is None or me.role != Role.HOST.value:
        raise errors.DomainError(errors.MEMBER_NOT_HOST)


# ── 입력 수집 ──────────────────────────────────────────────────────────────


def record_input(
    state: RoundState,
    *,
    member_id: str,
    kind: str,
    payload: object = None,
) -> JudgeInput:
    """입력 1건을 이번 단계의 배열에 담고 그 항목을 돌려준다.

    **도착 시각은 서버가 붙인다.** 클라이언트가 보낸 시각을 믿으면 그것이 곧
    판정 조작 경로가 된다 — 눈치게임과 시간초는 밀리초 차이로 순위가 갈린다.
    예외는 시간초의 경과 시간뿐이며 그쪽은 별도 검증을 둔다(07_api/03).

    arrived_ms는 **라운드 시작을 원점으로 하는 상대 정수 밀리초**다(계약 문서
    JudgeInput). 절대 시각을 넘기지 않는 이유는 판정 함수가 시각을 읽지 않아야
    같은 시드·같은 입력에서 같은 결과가 재현되기 때문이다.

    seq는 **같은 밀리초에 둘 이상이 도착했을 때만** 의미를 갖는 보조 축이다.
    도착 순서를 결정론적으로 고정해 두지 않으면 같은 입력 집합이 실행할 때마다
    다른 순서로 정렬될 수 있다.
    """
    origin = state.started_at or clock.now()
    arrived_ms = max(0, int((clock.now() - origin).total_seconds() * 1000))

    item = JudgeInput(
        participant_id=member_id,
        kind=kind,
        payload=payload,
        arrived_ms=arrived_ms,
        seq=state.input_seq,
    )
    state.input_seq += 1
    state.inputs.append(item)
    return item


def has_input_from(state: RoundState, member_id: str, *, kind: str | None = None) -> bool:
    """이번 단계에 이 사람의 입력이 이미 있는가.

    **1인 1회 제한은 게임마다 다르다** — 눈치게임은 라운드마다 1회, 시간초는
    START와 STOP 각 1회다. 그래서 kind까지 보는 경로를 함께 둔다.
    """
    return any(
        i.participant_id == member_id and (kind is None or i.kind == kind)
        for i in state.inputs
    )


# ── 판정 ───────────────────────────────────────────────────────────────────


def build_context(state: RoundState, **extra) -> JudgeContext:
    """판정 함수에 넘길 문맥을 만든다.

    **roster에는 memberId만 넣는다.** RoundState.roster는 닉네임·아바타를 함께 들고
    있지만(game:started가 쓴다) 판정에 표시 정보가 들어가면 결과 재현이 그 값에
    묶인다 — 닉네임을 바꾸면 같은 시드가 다른 입력이 된다.

    extra는 그 게임이 쓰는 축이다(alive · candidates · history · repeat · tie_pool).
    쓰지 않는 축은 넘기지 않으며 계약이 기본값을 준다.
    """
    return JudgeContext(
        round_id=state.round_id,
        game_id=state.game_id,
        seed=state.seed,
        roster=tuple(m["memberId"] for m in state.roster),
        config=state.config,
        phase=state.phase,
        **extra,
    )


async def settle(room_pk: int, verdict: Verdict) -> bool:
    """확정 결과를 저장한다. 이미 확정된 라운드면 아무것도 하지 않고 False다.

    **선점 구간에 await을 넣지 않는다.** 연타로 들어온 두 번째 호출이 반드시 이미
    채워진 result_data를 보고 돌아가야 한 라운드에 결과가 하나만 남는다.

    결과는 연출보다 먼저 저장한다. 연출이 흐르는 사이에 서버가 죽어도 확정된 결과가
    남아 있어야 하고, 저장이 실패하면 연출을 시작하지 않는 편이 낫다.
    """
    state = store.round_of(room_pk)
    if state is None or state.result_data is not None:
        return False

    # ── 선점 구간: 여기에 await을 넣지 않는다 ──────────────────────────────
    state.result_data = dict(verdict.persist or {})
    state.decided_at = clock.now()
    # ────────────────────────────────────────────────────────────────────

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
    return True


# ── 결과 ───────────────────────────────────────────────────────────────────


async def enter_result(room_pk: int, *, phase: str) -> None:
    """결과 화면으로 넘기고 game:result를 발행한다.

    **마감이 없는 단계다** — 방장의 round:close를 기다린다. 와이어 형식으로 옮기는
    일은 게임마다 다르므로 진행 모듈의 wire_result가 한다.
    """
    from app.schemas.events import GameResultData
    from app.services.games import flow_of
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    state = store.round_of(room_pk)
    if state is None or state.result_data is None:
        return
    flow = flow_of(state.game_id)
    if flow is None:
        return

    await round_service.emit_phase(room_pk, phase=phase)

    variant, result = flow.wire_result(state)
    finished_at = state.decided_at or clock.now()
    await registry.broadcast(
        room_pk,
        outgoing(
            "game:result",
            GameResultData(
                roomVersion=store.bump_version(room_pk),
                roundId=state.round_id,
                gameId=state.game_id,
                variant=variant,
                result=result,
                finishedAt=iso_z(finished_at),
            ).model_dump(),
        ),
    )


def elapsed_text(state: RoundState) -> str:
    """방장이 시작을 누른 순간부터 결과가 정해진 순간까지.

    가이드 3초와 방장이 망설인 시간이 모두 들어간다 — 사람이 체감하는 "이번 판에
    걸린 시간"이 그것이기 때문이다. 결과 화면의 요약 수치가 쓴다.
    """
    started, decided = state.started_at, state.decided_at
    if started is None or decided is None:
        return "-"
    return f"{max(0.0, (decided - started).total_seconds()):.1f}초"


# ── 마감 타이머 ────────────────────────────────────────────────────────────


def arm(
    room_pk: int,
    phase_seq: int,
    delay_ms: int,
    handler: Callable[[int], Awaitable[None]],
) -> None:
    """이 단계의 마감에 깨어날 태스크를 건다.

    **phaseSeq를 함께 들고 깨어난다.** 방장의 입력으로 단계가 먼저 넘어갔다면 이
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
