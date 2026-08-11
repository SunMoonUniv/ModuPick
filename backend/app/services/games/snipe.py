"""익명 저격 진행 — 가이드 · 지목 · 개표 · 결선 · 결과.

    GUIDE(3초) → VOTE(설정) → 개표 ┬ 확정 → REVEAL(3초) → RESULT
                                  ├ 동점 → TIE_NOTICE(3초) → RUNOFF(절반) → 개표
                                  └ 교착 → DEADLOCK — 방장이 고른다

**투표형 게임의 첫 구현이다.** 결선 루프 · 조기 마감 · 표 저장 · 진행 집계가 여기서
처음 만들어지고 킹메이커와 시간초가 같은 부품을 쓴다.

**지목자는 어떤 설정에서도 공개하지 않는다.** 진행 집계는 수치만 담고, 결과에는
후보별 피격 수만 남으며, 그것을 여는 설정 자체를 두지 않는다.

규칙의 정본은 docs/05_game_rules/06_snipe.md다.
"""

import logging

from sqlalchemy import select

from app.domain import errors
from app.domain.games import snipe as rules
from app.domain.games.contract import Outcome
from app.infra.clock import clock
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import game_options, participants, votes
from app.infra.memory.runtime_store import RoundState, store
from app.services import game_service, round_service
from app.services.games.base import ActionSpec

log = logging.getLogger("modupick.game")

GAME_ID = rules.GAME_ID

#: 07_api/03 「game:action type 8종」의 7번. **전원 · 1회 · 배열로 한 번에.**
#: 결선도 같은 type을 재사용한다 — 후보 집합만 좁아진다.
ACTIONS: dict[str, ActionSpec] = {
    rules.VOTE_KIND: ActionSpec(
        phases=frozenset({rules.Phase.VOTE, rules.Phase.RUNOFF})
    ),
}


# ── 진입 ───────────────────────────────────────────────────────────────────


async def begin(room_pk: int, *, skip_guide: bool = False) -> None:
    """첫 단계로 들어간다. skip_guide는 「다시 하기」 경로다(G-4)."""
    state = store.round_of(room_pk)
    if state is None:
        return

    # 후보 행은 라운드가 설 때 이미 박혀 있다. 표를 넣을 때마다 조회하지 않도록
    # 여기서 한 번만 읽어 둔다 — 결선에서도 같은 행을 가리킨다.
    await _load_option_pks(state)

    if skip_guide:
        await _enter_vote(room_pk)
        return

    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.GUIDE, duration_ms=game_service.GUIDE_MS
    )
    game_service.arm(room_pk, seq, game_service.GUIDE_MS, _enter_vote)


async def _enter_vote(room_pk: int) -> None:
    """본선. **후보는 명단 스냅샷 전원**이고 도중 이탈자도 뽑힐 수 있다."""
    state = store.round_of(room_pk)
    if state is None:
        return
    duration = _vote_seconds(state) * 1000
    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.VOTE, duration_ms=duration
    )
    game_service.arm(room_pk, seq, duration, _tally)


async def _enter_runoff(room_pk: int) -> None:
    """결선. 후보가 동점자로 좁아지고 **명단 전원이 다시 투표한다.**

    투표 시간은 본선의 절반이되 5초 아래로 내려가지 않는다.
    """
    state = store.round_of(room_pk)
    if state is None:
        return
    duration = rules.runoff_ms(_vote_seconds(state))
    seq = await round_service.emit_phase(
        room_pk,
        phase=rules.Phase.RUNOFF,
        duration_ms=duration,
        tie_round=state.repeat,
    )
    game_service.arm(room_pk, seq, duration, _tally)


def _vote_seconds(state: RoundState) -> int:
    return int(state.config.get("voteSeconds", 10))


async def _load_option_pks(state: RoundState) -> None:
    """memberId -> game_options.id. 표가 가리킬 행이다.

    06_database/04 「저장 범위」가 저격의 game_options를 "지목 후보 1인 1행"으로
    규정하며 round_service가 라운드 시작에 박아 둔다.
    """
    async with readonly() as conn:
        rows = (
            await conn.execute(
                select(game_options.c.id, participants.c.member_id)
                .select_from(
                    game_options.join(
                        participants, game_options.c.participant_id == participants.c.id
                    )
                )
                .where(game_options.c.game_round_id == state.round_pk)
            )
        ).all()
    state.option_pks = {r.member_id: r.id for r in rows}


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
    """지목 1건을 받는다.

    **배열로 한 번에 받고 수정을 허용하지 않는다.** 표를 한 장씩 받으면 서버가 부분
    상태를 들고 있어야 하고 "서로 다른 대상" 검증이 도착 순서에 의존한다.

    검증에 걸리면 **요청 전체를 거절한다.** 앞의 몇 개만 반영하면 상한을 넘긴 요청이
    부분적으로 통과해 표를 균등하게 만드는 경로가 남는다.
    """
    if game_service.has_input_from(state, member_id, kind=action_type):
        raise errors.DomainError(errors.GAME_ALREADY_SUBMITTED)

    picks = _picks_of(payload)
    runoff = state.repeat > 0
    candidates = rules.candidates_of(_context(state))
    rules.check_ballot(
        candidates,
        member_id,
        picks,
        multi_vote=bool(state.config.get("multiVote", False)),
        runoff=runoff,
    )

    # **표는 DB에 남긴다.** 초 단위로 마감하는 입력이라 커밋 시각이 판정을 흔들지
    # 않는다(06_database/04 「저장 범위」).
    await _store_votes(room_pk, state, participant_pk=participant_pk, picks=picks)
    game_service.record_input(
        state, member_id=member_id, kind=action_type, payload=picks
    )

    voted = _voted_count(state)
    await game_service.emit_progress(
        room_pk, {"votedCount": voted, "totalCount": len(state.roster)}
    )

    # **명단 전원이 냈으면 마감을 기다리지 않는다.** 더 올 표가 없다.
    # 타이머를 먼저 접어 개표가 두 번 돌지 않게 한다.
    if voted >= len(state.roster):
        round_service.stop_timers(state)
        await _tally(room_pk)


def _picks_of(payload: dict | None) -> tuple[str, ...]:
    """targetMemberIds를 꺼낸다. 모양이 어긋나면 형식 거절이다.

    **값의 옳고 그름은 판정 모듈이 본다.** 여기서 보는 것은 형태뿐이다.
    """
    if not isinstance(payload, dict):
        raise errors.DomainError(errors.COMMON_VALIDATION_FAILED)
    raw = payload.get("targetMemberIds")
    if not isinstance(raw, list) or not all(isinstance(x, str) for x in raw):
        raise errors.DomainError(errors.COMMON_VALIDATION_FAILED)
    return tuple(raw)


def _voted_count(state: RoundState) -> int:
    return sum(1 for i in state.inputs if i.kind == rules.VOTE_KIND)


async def _store_votes(
    room_pk: int,
    state: RoundState,
    *,
    participant_pk: int,
    picks: tuple[str, ...],
) -> None:
    """표 1건당 votes 1행.

    ballot_no는 회차(본선 1 · 결선 2~4)이고 choice_no는 그 회차에서 몇 번째 표인지다.
    **uq_votes_ballot이 같은 사람의 같은 회차 중복 접수를 DB에서도 막는다.**
    """
    async with transaction() as conn:
        await conn.execute(
            votes.insert(),
            [
                {
                    "game_round_id": state.round_pk,
                    "room_id": room_pk,
                    "voter_participant_id": participant_pk,
                    "game_option_id": state.option_pks[target],
                    "ballot_no": state.repeat + 1,
                    "choice_no": i + 1,
                    "created_at": clock.now(),
                }
                for i, target in enumerate(picks)
            ],
        )


# ── 개표 ───────────────────────────────────────────────────────────────────


def _context(state: RoundState):
    return game_service.build_context(
        state, repeat=state.repeat, tie_pool=state.tie_pool
    )


async def _tally(room_pk: int) -> None:
    """개표한다. **마감과 조기 완료가 같은 자리로 들어온다.**

    둘 중 무엇이 먼저 닿아도 결과가 같아야 하므로 경로를 나누지 않는다. 단계 검사가
    두 번째 호출을 막는다 — 첫 호출이 다음 단계로 넘기고 나면 phase가 더 이상
    VOTE·RUNOFF가 아니다.
    """
    state = store.round_of(room_pk)
    if state is None or state.result_data is not None:
        return
    if state.phase not in (rules.Phase.VOTE, rules.Phase.RUNOFF):
        return

    verdict = rules.judge(_context(state), tuple(state.inputs))

    if verdict.outcome is Outcome.TIE:
        # 회차를 올리고 동점자 명단만 3초 보인다. **피격 수는 아직 감춘다**(G-10).
        await game_service.open_tie(
            room_pk,
            phase=rules.Phase.TIE_NOTICE,
            candidate_kind="MEMBER",
            candidate_ids=verdict.tie_pool,
            handler=_enter_runoff,
        )
        return

    if verdict.outcome is Outcome.HOST_CHOICE:
        # 결선 3회를 소진했다. 자동 진행을 멈추고 방장이 끊는다.
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
    """교착에서 방장이 다시 시작을 골랐다. 본선을 다시 연다.

    **회차 카운터를 0으로 되돌리고 이전 표를 지운다.** ballot_no가 1로 돌아가는데
    지난 표가 남아 있으면 uq_votes_ballot에 걸려 아무도 투표할 수 없게 된다.
    가이드는 띄우지 않는다(G-4).
    """
    state = store.round_of(room_pk)
    if state is None:
        return

    async with transaction() as conn:
        await conn.execute(votes.delete().where(votes.c.game_round_id == state.round_pk))

    state.repeat = 0
    state.tie_pool = ()
    log.info("저격 다시 시작 — room=%s round=%s", room_pk, state.round_id)
    await _enter_vote(room_pk)


async def _enter_result(room_pk: int) -> None:
    await game_service.enter_result(room_pk, phase=rules.Phase.RESULT)


# ── 저장 형식 → 와이어 형식 ────────────────────────────────────────────────


def wire_result(state: RoundState) -> tuple[str, dict]:
    """result_data를 game:result의 (variant, result)로 옮긴다.

    WINNER의 detail은 tally · abstainCount · randomFallback이다(07_api/03 §17).
    같은 값에 이름이 둘인 자리가 있다 — 저장은 hitCount, 와이어는 hits다.

    **지목자는 담지 않는다.** 조건부가 아니라 어떤 설정에서도 나가지 않으며, 저장
    형식에도 그 자리가 없다.
    """
    data = state.result_data or {}
    winners = data.get("winnerMemberIds") or []
    tally = data.get("tally") or []
    return "WINNER", {
        "topic": state.config.get("question"),
        "winnerMemberId": winners[0] if winners else None,
        "detail": {
            "tally": [
                {"memberId": row["memberId"], "hits": row["hitCount"]} for row in tally
            ],
            "abstainCount": data.get("abstainCount", 0),
            "randomFallback": data.get("decidedByRandom", False),
        },
        "stats": _stats(state),
    }


def _stats(state: RoundState) -> list[dict]:
    """결과 화면 하단의 요약 수치 3개.

    08_screen/06_result.md 「승자형」이 저격에 정한 최다 피격 수 · 총 지목 수 ·
    투표 시간이다. **서버가 문구까지 확정해 내려보낸다**(07_api/03 §17).
    """
    tally = (state.result_data or {}).get("tally") or []
    hits = [row["hitCount"] for row in tally]
    return [
        {"label": "최다 피격", "value": f"{max(hits) if hits else 0}표"},
        {"label": "총 지목", "value": f"{sum(hits)}표"},
        {"label": "투표 시간", "value": f"{_vote_seconds(state)}초"},
    ]
