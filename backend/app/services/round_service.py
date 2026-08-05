"""라운드 생명주기 — 시작 · 단계 전이 · 틱 · 대기방 복귀.

**게임별 판정은 여기 없다.** 이 모듈이 아는 것은 라운드가 어떻게 태어나고 어떤 축으로
전이하며 언제 닫히는가뿐이고, 어떤 단계를 어떤 순서로 밟을지는 게임마다 다르다.
그 부분은 판정 담당이 만드는 domain/games/의 순수 함수와 그것을 부르는 상위 서비스가
맡는다. 여기서는 emit_phase라는 원시 연산만 내어 준다.

두 축이 다르다.

    라운드 생성·종료   game_rounds 행 · 방 상태 WAITING <-> PLAYING · 명단 스냅샷
    단계 전이          phaseSeq · phase · 마감 시각 · 틱

그래서 game:started와 game:phase를 합치지 않는다. 이후의 모든 단계 전이는 game:phase
하나만 보면 된다.

**서버가 제한 시간의 주체다.** 클라이언트는 남은 시간을 그릴 뿐 마감을 판정하지 않으며,
마감을 알리는 C->S 이벤트를 두지 않는다.
"""

import asyncio
import logging
import secrets
from datetime import timedelta

from sqlalchemy import func, select, text, update

from app.domain import errors, game_config
from app.domain.enums import (
    MIN_MEMBERS,
    EndedReason,
    GameId,
    MemberStatus,
    Role,
    RoomStatus,
    RoundStatus,
)
from app.infra.clock import clock
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import game_rounds, participants, rooms
from app.infra.memory.runtime_store import RoundState, store
from app.infra.tokens import new_round_id
from app.schemas.rest import iso_z

log = logging.getLogger("modupick.round")

_NOW = text("NOW(6)")

#: game:tick 주기. 표시 전용이며 판정 근거가 아니다.
TICK_INTERVAL_S = 1.0

#: 시드 상한. 64비트 부호 없는 정수를 그대로 담는다(random_seed BIGINT UNSIGNED).
_SEED_MAX = 2**64


# ── 시작 ───────────────────────────────────────────────────────────────────


async def start(*, participant_pk: int, room_pk: int) -> None:
    """게임을 시작한다.

    검증 순서가 정해져 있다 — 방장 · 방 상태 · 게임 선택 · 최소 인원 · 전원 준비 ·
    설정 유효성. **잠근 뒤에 다시 본다**: 잠금 전 검사는 빠른 실패용이고, 정원과
    준비 상태는 그 사이에 바뀔 수 있다.

    성공하면 명단 스냅샷을 고정하고 방을 PLAYING으로 옮긴다. 그 순간부터 새 입장이
    막힌다 — 재접속 경로가 없어 판이 도는 방에 소켓을 새로 받을 수 없다.
    """
    from app.schemas.events import GameStartedData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    selection = store.selection_of(room_pk)
    if selection is None:
        raise errors.DomainError(errors.GAME_NOT_SELECTED)
    game_id = GameId(selection.game_id)

    # 설정은 저장 직전에 다시 검증한다. 규격이 바뀐 채로 남아 있을 수 있다.
    config = game_config.validate(game_id, selection.config)
    seed = secrets.randbelow(_SEED_MAX)
    round_id = new_round_id()

    async with transaction() as conn:
        await conn.execute(select(rooms.c.id).where(rooms.c.id == room_pk).with_for_update())

        me = (
            await conn.execute(
                select(participants.c.role, participants.c.status, participants.c.left_at)
                .where(participants.c.id == participant_pk)
                .with_for_update()
            )
        ).first()
        if me is None or me.left_at is not None:
            raise errors.DomainError(errors.COMMON_SESSION_EXPIRED)
        if me.role != Role.HOST.value:
            raise errors.DomainError(errors.MEMBER_NOT_HOST)

        room = (
            await conn.execute(select(rooms.c.status).where(rooms.c.id == room_pk))
        ).first()
        if room is None or room.status != RoomStatus.WAITING.value:
            raise errors.DomainError(errors.GAME_INVALID_ACTION)

        rows = (
            await conn.execute(
                select(
                    participants.c.id,
                    participants.c.member_id,
                    participants.c.nickname,
                    participants.c.avatar_id,
                    participants.c.role,
                )
                .where(
                    participants.c.room_id == room_pk,
                    participants.c.status == MemberStatus.ACTIVE.value,
                    participants.c.left_at.is_(None),
                )
                .order_by(participants.c.joined_at, participants.c.id)
            )
        ).all()

        if len(rows) < MIN_MEMBERS[game_id]:
            raise errors.DomainError(errors.GAME_NOT_ENOUGH_MEMBERS)

        # **방장을 제외한 참여자 전원이 준비여야 한다.** 유예 중인 사람은 진입 시점에
        # 준비가 해제되므로 여기서 자연히 걸린다.
        ready = store.ready_ids(room_pk)
        waiting = [r for r in rows if r.role != Role.HOST.value and r.id not in ready]
        if waiting:
            raise errors.DomainError(errors.GAME_NOT_ALL_READY)

        result = await conn.execute(
            game_rounds.insert().values(
                round_id=round_id,
                room_id=room_pk,
                game_type=game_id.value,
                status=RoundStatus.RUNNING.value,
                config=config,
                random_seed=seed,
                started_by=participant_pk,
                started_at=_NOW,
            )
        )
        round_pk = result.inserted_primary_key[0]

        await conn.execute(
            update(rooms)
            .where(rooms.c.id == room_pk)
            .values(status=RoomStatus.PLAYING.value, last_activity_at=_NOW)
        )

    roster = [
        {
            "memberId": r.member_id,
            "nickname": r.nickname,
            "avatarId": r.avatar_id,
            "joinOrder": i + 1,
        }
        for i, r in enumerate(rows)
    ]

    store.begin_round(
        room_pk,
        RoundState(
            round_id=round_id,
            round_pk=round_pk,
            game_id=game_id.value,
            config=config,
            roster=roster,
            seed=seed,
        ),
    )

    # 커밋 이후에만 발행한다.
    await registry.broadcast(
        room_pk,
        outgoing(
            "game:started",
            GameStartedData(
                roomVersion=store.bump_version(room_pk),
                roundId=round_id,
                gameId=game_id.value,
                config=config,
                roster=roster,
            ).model_dump(),
        ),
    )
    log.info("라운드 시작 — room=%s round=%s game=%s", room_pk, round_id, game_id.value)

    # game:started 직후에 game:phase(READY)가 이어진다.
    await emit_phase(room_pk, phase="READY")


# ── 단계 전이 ──────────────────────────────────────────────────────────────


async def emit_phase(
    room_pk: int,
    *,
    phase: str,
    duration_s: float | None = None,
    tie_round: int = 0,
) -> int:
    """단계를 전이하고 알린다. 새 phaseSeq를 돌려준다.

    **phaseSeq는 라운드 안에서 0부터 단조 증가한다.** C->S 입력이 이 값을 되싣고,
    서버의 현재 값과 다르면 지난 단계의 입력이므로 버린다.

    duration_s가 없으면 마감이 없는 단계이며 **틱도 흐르지 않는다.**
    """
    from app.schemas.events import GamePhaseData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    state = store.round_of(room_pk)
    if state is None:
        raise errors.DomainError(errors.GAME_ROUND_NOT_FOUND)

    # 이전 단계의 틱을 먼저 접는다. 두 단계의 틱이 겹쳐 나가지 않게 한다.
    _stop_tick(state)

    state.phase = phase
    state.phase_seq += 1
    state.tie_round = tie_round
    state.deadline_at = (
        clock.now() + timedelta(seconds=duration_s) if duration_s is not None else None
    )

    now = clock.now()
    await registry.broadcast(
        room_pk,
        outgoing(
            "game:phase",
            GamePhaseData(
                roomVersion=store.bump_version(room_pk),
                roundId=state.round_id,
                phaseSeq=state.phase_seq,
                phase=phase,
                tieRound=tie_round,
                deadlineAt=iso_z(state.deadline_at) if state.deadline_at else None,
                serverTime=iso_z(now),
            ).model_dump(),
        ),
    )

    if state.deadline_at is not None:
        # 태스크 참조는 RoundState가 들고 있다. 놓치면 GC가 중간에 거둬 간다.
        state.tick_task = asyncio.create_task(_tick_loop(room_pk, state.phase_seq))
    return state.phase_seq


def _stop_tick(state: RoundState) -> None:
    task = state.tick_task
    state.tick_task = None
    if isinstance(task, asyncio.Task) and not task.done():
        task.cancel()


async def _tick_loop(room_pk: int, phase_seq: int) -> None:
    """1초마다 남은 시간을 알린다.

    **표시 전용이다.** 판정 근거가 아니며 버전 게이트도 걸지 않는다 — 걸면 방 상태를
    바꾸지 않는 틱이 직전 상태 이벤트와 같은 번호를 달고 나가 전부 버려진다.
    """
    from app.schemas.events import GameTickData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    try:
        while True:
            await asyncio.sleep(TICK_INTERVAL_S)
            state = store.round_of(room_pk)
            # 단계가 바뀌었으면 이 루프는 지난 단계의 것이다.
            if state is None or state.phase_seq != phase_seq or state.deadline_at is None:
                return

            remain_ms = int((state.deadline_at - clock.now()).total_seconds() * 1000)
            if remain_ms <= 0:
                return

            await registry.broadcast(
                room_pk,
                outgoing(
                    "game:tick",
                    GameTickData(
                        roomVersion=store.version(room_pk),
                        roundId=state.round_id,
                        phaseSeq=phase_seq,
                        remainMs=remain_ms,
                        serverTime=iso_z(clock.now()),
                    ).model_dump(),
                ),
            )
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("틱 루프 오류 — room=%s phase=%s", room_pk, phase_seq)


# ── 종료 ───────────────────────────────────────────────────────────────────


async def close(*, participant_pk: int, room_pk: int, round_id: str) -> None:
    """결과 화면에서 대기방으로 돌아간다. 방장만 보낸다."""
    state = store.round_of(room_pk)
    if state is None or state.round_id != round_id:
        raise errors.DomainError(errors.GAME_ROUND_NOT_FOUND)

    async with readonly() as conn:
        me = (
            await conn.execute(
                select(participants.c.role).where(participants.c.id == participant_pk)
            )
        ).first()
    if me is None or me.role != Role.HOST.value:
        raise errors.DomainError(errors.MEMBER_NOT_HOST)

    await finish(room_pk, reason=EndedReason.COMPLETED, status=RoundStatus.FINISHED)


async def finish(
    room_pk: int,
    *,
    reason: EndedReason,
    status: RoundStatus = RoundStatus.FINISHED,
) -> bool:
    """라운드를 닫고 방을 대기 상태로 되돌린다.

    **모든 라운드 종료 경로의 종착점이다** — 방장의 대기방 복귀 · 무효 종료 · 만료.
    경로마다 따로 쓰면 준비 해제나 방 상태 복귀 하나를 빠뜨리게 된다.
    """
    from app.schemas.events import RoundClosedData
    from app.services import lobby_service
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    state = store.end_round(room_pk)
    if state is None:
        return False

    async with transaction() as conn:
        await conn.execute(select(rooms.c.id).where(rooms.c.id == room_pk).with_for_update())
        await conn.execute(
            update(game_rounds)
            .where(
                game_rounds.c.id == state.round_pk,
                game_rounds.c.status.in_(
                    [RoundStatus.READY.value, RoundStatus.RUNNING.value]
                ),
            )
            .values(status=status.value, ended_at=_NOW, ended_reason=reason.value)
        )
        await conn.execute(
            update(rooms)
            .where(rooms.c.id == room_pk)
            .values(status=RoomStatus.WAITING.value, last_activity_at=_NOW)
        )

    # 대기방으로 돌아오면 참여자 전원의 준비가 해제된다.
    cleared = store.ready_ids(room_pk)
    store.clear_ready(room_pk)

    await registry.broadcast(
        room_pk,
        outgoing(
            "round:closed",
            RoundClosedData(
                roomVersion=store.bump_version(room_pk),
                roomStatus=RoomStatus.WAITING.name,
            ).model_dump(),
        ),
    )

    # 해제는 member:ready_changed로 각각 통지된다.
    if cleared:
        async with readonly() as conn:
            rows = (
                await conn.execute(
                    select(participants.c.id, participants.c.member_id).where(
                        participants.c.id.in_(cleared)
                    )
                )
            ).all()
        for r in rows:
            await lobby_service.broadcast_ready(
                room_pk=room_pk, member_id=r.member_id, ready=False
            )

    log.info("라운드 종료 — room=%s round=%s 사유=%s", room_pk, state.round_id, reason.value)
    return True


async def active_round_count(room_pk: int) -> int:
    """진행 중 라운드 수. 테스트와 진단이 쓴다."""
    async with readonly() as conn:
        return (
            await conn.execute(
                select(func.count())
                .select_from(game_rounds)
                .where(
                    game_rounds.c.room_id == room_pk,
                    game_rounds.c.status.in_(
                        [RoundStatus.READY.value, RoundStatus.RUNNING.value]
                    ),
                )
            )
        ).scalar_one()
