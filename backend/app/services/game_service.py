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
from collections.abc import Awaitable, Callable, Sequence

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
#: 동점자 명단만 보여 주는 구간. **기록 값은 아직 감춘다**(G-10).
TIE_NOTICE_MS = 3_000

#: 결선·재대결 상한. 상한을 세는 것은 판정 모듈이지만(MAX_RUNOFFS · MAX_REMATCHES)
#: 화면이 "결선 2/3"을 그리려면 뼈대도 알아야 한다. 05_game_rules/01_common.md.
TIE_ROUND_MAX = 3

#: 방장이 교착 해소를 고르는 시간. **정본에 수치가 없어 정한 값이다** — 상의할
#: 시간은 되면서 판이 오래 열려 있지 않은 폭으로 킹메이커 투표와 같은 60초를 쓴다.
#: 지나면 서버가 ABORT로 처리한다(07_api/03 §16).
DECISION_MS = 60_000


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


async def handle_decide(
    *,
    participant_pk: int,
    room_pk: int,
    round_id: str,
    phase_seq: int,
    choice: str,
) -> None:
    """game:decide 하나를 받는다. **방장의 교착 해소 선택이다.**

    검사 순서는 game:action과 같다 — 라운드 · 단계 · 요구 여부 · 값 · 권한.
    권한을 맨 뒤에 두는 이유도 같다: 지난 단계의 입력에 member.not_host를 돌려주면
    방장이 "권한이 없다"로 읽는다.

    ABORT는 게임과 무관하게 라운드를 닫는다. RETRY는 어디로 되돌아가는지가 게임마다
    달라 진행 모듈이 맡는다 — 저격은 VOTE, 킹메이커는 SUBMIT, 눈치는 같은 생존자의
    다음 ROUND다.
    """
    from app.domain.enums import EndedReason
    from app.services.games import flow_of

    state = store.round_of(room_pk)
    if state is None or state.round_id != round_id:
        raise errors.DomainError(errors.GAME_ROUND_NOT_FOUND)
    if state.phase_seq != phase_seq:
        raise errors.DomainError(errors.GAME_STALE_PHASE)
    if state.decision is None:
        raise errors.DomainError(errors.GAME_DECISION_NOT_REQUIRED)
    if choice not in state.decision["options"]:
        raise errors.DomainError(errors.GAME_INVALID_ACTION)
    await ensure_host(participant_pk)

    # **먼저 지운다.** 되돌아간 뒤에도 요구가 남아 있으면 두 번째 game:decide가
    # 다음 단계를 건드린다.
    state.decision = None

    if choice == "ABORT":
        await round_service.finish(room_pk, reason=EndedReason.COMPLETED)
        return

    flow = flow_of(state.game_id)
    if flow is None:
        return
    await flow.on_retry(room_pk)


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


# ── 진행 상황 ──────────────────────────────────────────────────────────────


async def emit_progress(room_pk: int, payload: dict) -> None:
    """입력이 몇 건 도착했는지 알린다.

    **누가 무엇을 골랐는지는 어떤 경우에도 넣지 않는다**(07_api/03 §14). 호출부가
    수치만 담은 payload를 만들어 넘긴다.
    """
    from app.schemas.events import GameProgressData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    state = store.round_of(room_pk)
    if state is None:
        return

    await registry.broadcast(
        room_pk,
        outgoing(
            "game:progress",
            GameProgressData(
                roomVersion=store.bump_version(room_pk),
                roundId=state.round_id,
                phaseSeq=state.phase_seq,
                payload=payload,
            ).model_dump(),
        ),
    )


async def notify(
    room_pk: int, participant_pk: int, spec, *, event: str = "game:action"
) -> None:
    """한 사람에게만 알린다. **브로드캐스트하지 않는다.**

    시간초의 game.elapsed_rejected가 이 경로를 쓴다 — 어느 참가자의 신고값이
    서버 관측값으로 대체됐는지는 그 사람만 알면 되고, 남에게 보내면 그것이 곧
    "누가 회선이 튀었는가"를 방 전체에 알리는 일이 된다.
    """
    from app.ws.connection import registry
    from app.ws.envelope import outgoing_error

    conn = registry.find(room_pk, participant_pk)
    if conn is None:
        return
    await registry.send(
        conn,
        outgoing_error(spec, source_event=event, room_version=store.version(room_pk)),
    )


# ── 회차와 교착 ────────────────────────────────────────────────────────────


async def open_tie(
    room_pk: int,
    *,
    phase: str,
    candidate_kind: str,
    candidate_ids: Sequence[str],
    handler: Callable[[int], Awaitable[None]],
    duration_ms: int = TIE_NOTICE_MS,
) -> None:
    """동점을 알리고 다음 회차 안내 구간으로 넘긴다.

    **회차를 세는 것이 여기다.** 판정 모듈은 repeat를 읽기만 하고 올리지 않으므로,
    이 자리가 빠지면 결선이 영원히 1회차로 돌아 상한이 발화하지 않는다.

    득표 수는 싣지 않는다 — 다음 회차의 전략이 되기 때문이다(G-10). 명단만 보인다.
    """
    from app.schemas.events import GameTieData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    state = store.round_of(room_pk)
    if state is None:
        return

    state.repeat += 1
    state.tie_pool = tuple(candidate_ids)

    seq = await round_service.emit_phase(
        room_pk, phase=phase, duration_ms=duration_ms, tie_round=state.repeat
    )
    await registry.broadcast(
        room_pk,
        outgoing(
            "game:tie",
            GameTieData(
                roomVersion=store.bump_version(room_pk),
                roundId=state.round_id,
                phaseSeq=seq,
                tieRound=state.repeat,
                tieRoundMax=TIE_ROUND_MAX,
                candidateKind=candidate_kind,
                candidateIds=list(candidate_ids),
                deadlineAt=iso_z(state.deadline_at) if state.deadline_at else None,
            ).model_dump(),
        ),
    )
    arm(room_pk, seq, duration_ms, handler)


async def require_decision(
    room_pk: int,
    *,
    phase: str,
    reason: str,
    candidate_kind: str,
    candidate_ids: Sequence[str],
    options: Sequence[str] = ("RETRY", "ABORT"),
) -> None:
    """자동 진행을 멈추고 방장의 선택을 기다린다.

    **모든 반복 규칙의 탈출구다.** 이 자리가 없으면 종료가 보장되지 않는 반복이
    생긴다. 마감까지 응답이 없으면 서버가 ABORT로 처리해 판이 열린 채 남지 않는다.

    선택지는 RETRY · ABORT 둘이다. 05_game_rules/01_common.md 「교착 해소 선택」이
    무작위 확정을 명시적으로 배제한다 — 붙이면 룰렛과 구분되지 않기 때문이다.
    """
    from app.schemas.events import GameDecisionRequiredData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    state = store.round_of(room_pk)
    if state is None:
        return

    state.decision = {
        "reason": reason,
        "options": list(options),
        "candidateIds": list(candidate_ids),
    }

    seq = await round_service.emit_phase(room_pk, phase=phase, duration_ms=DECISION_MS)
    await registry.broadcast(
        room_pk,
        outgoing(
            "game:decision_required",
            GameDecisionRequiredData(
                roomVersion=store.bump_version(room_pk),
                roundId=state.round_id,
                phaseSeq=seq,
                reason=reason,
                options=list(options),
                candidateKind=candidate_kind,
                candidateIds=list(candidate_ids),
                deadlineAt=iso_z(state.deadline_at) if state.deadline_at else "",
            ).model_dump(),
        ),
    )
    arm(room_pk, seq, DECISION_MS, _decision_timeout)


async def _decision_timeout(room_pk: int) -> None:
    """방장이 마감까지 고르지 않았다. **ABORT로 처리한다.**

    방장이 유예 중이거나 화면을 떠난 경우가 여기로 온다. 판을 무한정 열어 두지
    않는다는 규약이 이 경로다(07_api/03 §16).
    """
    from app.domain.enums import EndedReason

    state = store.round_of(room_pk)
    if state is None or state.decision is None:
        return
    state.decision = None
    log.info("방장 결정 마감 — room=%s round=%s ABORT로 처리한다", room_pk, state.round_id)
    await round_service.finish(room_pk, reason=EndedReason.COMPLETED)


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
