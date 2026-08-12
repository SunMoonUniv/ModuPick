"""킹메이커 진행 — 가이드 · 안건 제출 · 투표 · 개표 · 결선 · 결과.

    GUIDE(3초) → SUBMIT(120초) → 안건 수 ┬ 0개  → 방장이 고른다
                                        ├ 1개  → TALLY(3초) → RESULT
                                        └ 2개+ → VOTE(60초) → 개표 ┬ 확정 → TALLY
                                                                  ├ 동점 → TIE_NOTICE → RUNOFF(30초)
                                                                  └ 교착 → DEADLOCK

**사람이 아니라 아이디어를 정하는 유일한 게임이다.** 그래서 입력 단계가 둘이고
(제출·투표) 익명성의 부담이 제출자 쪽에 걸린다.

저격에서 만든 부품을 그대로 쓴다 — 결선 루프 · 조기 마감 · 표 저장 · 진행 집계.
다른 것은 **후보가 사람이 아니라 제출된 안건**이라는 점이다.

규칙의 정본은 docs/05_game_rules/04_kingmaker.md다.
"""

import logging

from sqlalchemy import select

from app.domain import errors
from app.domain.games import kingmaker as rules
from app.domain.games.contract import Candidate, Outcome
from app.infra.clock import clock
from app.infra.db.session import readonly, transaction
from app.infra.db.tables import game_options, participants, votes
from app.infra.memory.runtime_store import RoundState, store
from app.infra.tokens import new_option_id
from app.services import game_service, round_service
from app.services.games.base import ActionSpec

log = logging.getLogger("modupick.game")

GAME_ID = rules.GAME_ID

#: 07_api/03 「game:action type 8종」의 3·4번. **둘 다 전원 · 각 1회.**
#: 제출과 투표는 단계가 달라 type만으로도 갈리지만 단계 조건을 함께 둔다.
ACTIONS: dict[str, ActionSpec] = {
    rules.OPINION_KIND: ActionSpec(phases=frozenset({rules.Phase.SUBMIT})),
    rules.VOTE_KIND: ActionSpec(
        phases=frozenset({rules.Phase.VOTE, rules.Phase.RUNOFF})
    ),
}


# ── 진입 ───────────────────────────────────────────────────────────────────


async def begin(room_pk: int, *, skip_guide: bool = False) -> None:
    """첫 단계로 들어간다. skip_guide는 「다시 하기」 경로다(G-4)."""
    if skip_guide:
        await _enter_submit(room_pk)
        return

    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.GUIDE, duration_ms=game_service.GUIDE_MS
    )
    game_service.arm(room_pk, seq, game_service.GUIDE_MS, _enter_submit)


async def _enter_submit(room_pk: int) -> None:
    """안건을 익명으로 1건씩 받는다. **제출 후 수정·취소는 없다.**"""
    seq = await round_service.emit_phase(
        room_pk, phase=rules.Phase.SUBMIT, duration_ms=rules.SUBMIT_MS
    )
    game_service.arm(room_pk, seq, rules.SUBMIT_MS, _close_submit)


async def _enter_vote(room_pk: int) -> None:
    """본선 투표. **후보 순서를 시드로 섞어 내려보낸다.**

    제출 순서를 그대로 쓰면 "먼저 제출한 사람이 앞"이라는 정보가 제출자 힌트가 된다.
    표시 전용이며 개표에는 영향을 주지 않는다 — 표는 후보 ID로 세기 때문이다.
    """
    state = store.round_of(room_pk)
    if state is None:
        return
    seq = await round_service.emit_phase(
        room_pk,
        phase=rules.Phase.VOTE,
        duration_ms=rules.VOTE_MS,
        payload=_ballot_payload(state),
    )
    game_service.arm(room_pk, seq, rules.VOTE_MS, _tally)


async def _enter_runoff(room_pk: int) -> None:
    """결선. 후보가 동점 안건으로 좁아지고 **1인 1표가 된다.**"""
    state = store.round_of(room_pk)
    if state is None:
        return
    seq = await round_service.emit_phase(
        room_pk,
        phase=rules.Phase.RUNOFF,
        duration_ms=rules.RUNOFF_MS,
        tie_round=state.repeat,
        payload=_ballot_payload(state),
    )
    game_service.arm(room_pk, seq, rules.RUNOFF_MS, _tally)


def _ballot_payload(state: RoundState) -> dict:
    """투표 화면이 그릴 후보 목록.

    **sort_order를 내려보내지 않는다**(06_database/04) — 제출 순서를 보여주면 제출
    완료 표시와 대조해 작성자를 추정할 수 있다. author_id도 나가지 않는다.
    """
    ordered = rules.shuffle_candidates(_current_candidates(state), state.seed)
    return {
        "candidates": [{"optionId": c.id, "label": c.text} for c in ordered]
    }


# ── 안건 제출 ──────────────────────────────────────────────────────────────


async def on_action(
    room_pk: int,
    state: RoundState,
    *,
    participant_pk: int,
    member_id: str,
    action_type: str,
    payload: dict | None = None,
) -> None:
    """제출과 투표를 단계에 맞게 갈라 받는다."""
    if action_type == rules.OPINION_KIND:
        await _accept_opinion(
            room_pk, state, participant_pk=participant_pk,
            member_id=member_id, payload=payload,
        )
        return
    await _accept_vote(
        room_pk, state, participant_pk=participant_pk,
        member_id=member_id, payload=payload,
    )


async def _accept_opinion(
    room_pk: int,
    state: RoundState,
    *,
    participant_pk: int,
    member_id: str,
    payload: dict | None,
) -> None:
    """안건 1건을 받는다. **1인 1건이고 되돌릴 수 없다**(G-9)."""
    if game_service.has_input_from(state, member_id, kind=rules.OPINION_KIND):
        raise errors.DomainError(errors.GAME_ALREADY_SUBMITTED)

    text = _text_of(payload)

    # **입력을 먼저 담아 순번을 선점한다.** record_input은 await이 없어 그 사이에
    # 다른 제출이 끼어들 수 없다. DB에 넣은 뒤에 담으면 거의 동시에 도착한 둘이
    # 같은 sort_order를 계산해 uq_game_options_round_order에 걸린다.
    #
    # 이 단계에는 안건만 도착하므로 입력 순번이 곧 제출 순번이다.
    item = game_service.record_input(
        state, member_id=member_id, kind=rules.OPINION_KIND, payload=text
    )
    # **몇 번째 제출인지도 같은 동기 구간에서 확정한다.** DB 왕복 뒤에 세면 그
    # 사이에 들어온 제출까지 세어, 마지막이 아닌 사람도 「전원 제출」로 읽는다.
    # 그러면 조기 마감이 인원수만큼 돌아 다음 단계가 여러 번 열린다.
    submitted = _count(state, rules.OPINION_KIND)

    # uq_game_options_round_participant가 1인 1건을 DB에서도 막는다 — 인메모리
    # 검사를 통과한 중복 제출이 있어도 여기서 걸린다.
    async with transaction() as conn:
        await conn.execute(
            game_options.insert().values(
                option_id=new_option_id(),
                game_round_id=state.round_pk,
                room_id=room_pk,
                participant_id=participant_pk,
                label=text,
                sort_order=item.seq,
            )
        )
    await game_service.emit_progress(
        room_pk, {"submittedCount": submitted, "totalCount": len(state.roster)}
    )

    # **명단 전원이 냈으면 마감을 기다리지 않는다.** 더 올 안건이 없다.
    if submitted >= len(state.roster):
        round_service.stop_timers(state)
        await _close_submit(room_pk)


def _text_of(payload: dict | None) -> str:
    """안건 원문을 꺼낸다. 1~120자이며 공백만으로는 확정할 수 없다."""
    if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
        raise errors.DomainError(errors.COMMON_VALIDATION_FAILED)
    text = payload["text"].strip()
    if not text or len(text) > rules.MAX_OPINION_LEN:
        raise errors.DomainError(errors.COMMON_VALIDATION_FAILED)
    return text


async def _close_submit(room_pk: int) -> None:
    """제출을 닫고 안건 수로 갈라진다.

    **안건 수 분기를 판정에 맡기지 않는다.** 2개 이상인데 judge를 부르면 아직 표가
    없어 「유효표 0」 분기에 걸려 난수로 확정해 버린다. 투표를 열지 말지는 진행의
    판단이고 판정은 표가 모인 뒤에 부른다.
    """
    state = store.round_of(room_pk)
    if state is None or state.phase != rules.Phase.SUBMIT:
        return

    await _load_candidates(state)
    if state.phase != rules.Phase.SUBMIT:
        # 안건을 읽는 사이에 누가 먼저 다음 단계로 넘겼다. 두 번째 방어선이다.
        return
    count = len(state.candidates)

    if count == 0:
        # 게임을 성립시킬 수 없다. **방장이 다시 받을지 끝낼지 고른다** —
        # 눈치게임의 무효 라운드와 같은 처리다.
        await game_service.require_decision(
            room_pk,
            phase=rules.Phase.DEADLOCK,
            reason="NO_OPTION",
            candidate_kind="OPTION",
            candidate_ids=(),
        )
        return

    if count == 1:
        # 투표 단계를 건너뛴다. 표가 없는 것이 기권이 아니라 설계이므로 판정이
        # 「유효표 0」보다 먼저 이 경우를 본다.
        await _tally(room_pk)
        return

    await _enter_vote(room_pk)


async def _load_candidates(state: RoundState) -> None:
    """제출된 안건을 Candidate 목록으로 읽는다.

    author_id는 자기 안건 투표 금지를 판정하려고 들고 있으며 **서버 밖으로 나가지
    않는다** — 방장이 실명 공개를 켠 경우의 개표 후 공개만 예외다.
    """
    async with readonly() as conn:
        rows = (
            await conn.execute(
                select(
                    game_options.c.id,
                    game_options.c.option_id,
                    game_options.c.label,
                    participants.c.member_id,
                )
                .select_from(
                    game_options.join(
                        participants, game_options.c.participant_id == participants.c.id
                    )
                )
                .where(game_options.c.game_round_id == state.round_pk)
                .order_by(game_options.c.sort_order)
            )
        ).all()

    state.candidates = [
        Candidate(id=r.option_id, text=r.label, author_id=r.member_id) for r in rows
    ]
    state.option_pks = {r.option_id: r.id for r in rows}


# ── 투표 ───────────────────────────────────────────────────────────────────


def _current_candidates(state: RoundState) -> tuple[Candidate, ...]:
    """이 회차의 후보. 결선이면 직전 동점 안건으로 좁아진다."""
    if state.repeat > 0 and state.tie_pool:
        pool = set(state.tie_pool)
        return tuple(c for c in state.candidates if c.id in pool)
    return tuple(state.candidates)


def _quota(state: RoundState) -> int:
    """1인 투표 수. **결선은 방장 설정과 무관하게 1이다.**

    후보가 m개 남고 quota가 m-1이면 자기 안건이 없는 투표자는 남은 후보 전부에
    1표씩 줄 수밖에 없어 동점으로 시작한 결선이 구조적으로 동점을 재생산한다.
    """
    if state.repeat > 0:
        return rules.RUNOFF_QUOTA
    return int(state.config.get("votesPerMember", 1))


async def _accept_vote(
    room_pk: int,
    state: RoundState,
    *,
    participant_pk: int,
    member_id: str,
    payload: dict | None,
) -> None:
    """투표 1건을 받는다. **배열로 한 번에 받고 수정을 허용하지 않는다.**"""
    if game_service.has_input_from(state, member_id, kind=rules.VOTE_KIND):
        raise errors.DomainError(errors.GAME_ALREADY_SUBMITTED)

    picks = _picks_of(payload)
    rules.check_ballot(_current_candidates(state), member_id, picks, _quota(state))

    await _store_votes(room_pk, state, participant_pk=participant_pk, picks=picks)
    game_service.record_input(
        state, member_id=member_id, kind=rules.VOTE_KIND, payload=picks
    )

    voted = _count(state, rules.VOTE_KIND)
    await game_service.emit_progress(
        room_pk, {"votedCount": voted, "totalCount": len(state.roster)}
    )

    if voted >= len(state.roster):
        round_service.stop_timers(state)
        await _tally(room_pk)


def _picks_of(payload: dict | None) -> tuple[str, ...]:
    """candidateIds를 꺼낸다. **값의 옳고 그름은 판정 모듈이 본다.**"""
    if not isinstance(payload, dict):
        raise errors.DomainError(errors.COMMON_VALIDATION_FAILED)
    raw = payload.get("candidateIds")
    if not isinstance(raw, list) or not all(isinstance(x, str) for x in raw):
        raise errors.DomainError(errors.COMMON_VALIDATION_FAILED)
    return tuple(raw)


def _count(state: RoundState, kind: str) -> int:
    return sum(1 for i in state.inputs if i.kind == kind)


async def _store_votes(
    room_pk: int,
    state: RoundState,
    *,
    participant_pk: int,
    picks: tuple[str, ...],
) -> None:
    """표 1건당 votes 1행. ballot_no는 회차, choice_no는 그 회차의 몇 번째 표인지다."""
    async with transaction() as conn:
        await conn.execute(
            votes.insert(),
            [
                {
                    "game_round_id": state.round_pk,
                    "room_id": room_pk,
                    "voter_participant_id": participant_pk,
                    "game_option_id": state.option_pks[cid],
                    "ballot_no": state.repeat + 1,
                    "choice_no": i + 1,
                    "created_at": clock.now(),
                }
                for i, cid in enumerate(picks)
            ],
        )


# ── 개표 ───────────────────────────────────────────────────────────────────


async def _tally(room_pk: int) -> None:
    """개표한다. **마감과 조기 완료가 같은 자리로 들어온다.**

    안건 1개로 투표를 건너뛴 경우도 여기로 온다 — 판정이 그 분기를 「유효표 0」보다
    먼저 보므로 난수 확정이 아니라 단독 확정이 된다.
    """
    state = store.round_of(room_pk)
    if state is None or state.result_data is not None:
        return
    if state.phase not in (rules.Phase.SUBMIT, rules.Phase.VOTE, rules.Phase.RUNOFF):
        return

    ctx = game_service.build_context(
        state,
        candidates=_current_candidates(state),
        repeat=state.repeat,
        tie_pool=state.tie_pool,
    )
    verdict = rules.judge(ctx, tuple(state.inputs))

    if verdict.outcome is Outcome.TIE:
        await game_service.open_tie(
            room_pk,
            phase=rules.Phase.TIE_NOTICE,
            candidate_kind="OPTION",
            candidate_ids=verdict.tie_pool,
            handler=_enter_runoff,
        )
        return

    if verdict.outcome is Outcome.HOST_CHOICE:
        await game_service.require_decision(
            room_pk,
            phase=rules.Phase.DEADLOCK,
            reason="TIE_EXHAUSTED",
            candidate_kind="OPTION",
            candidate_ids=verdict.tie_pool,
        )
        return

    if verdict.outcome is Outcome.VOID:
        # 판정이 안건 0개를 본 경우다. 진행이 먼저 걸러 내므로 정상 경로로는 오지
        # 않지만, 오면 방장에게 넘긴다.
        await game_service.require_decision(
            room_pk,
            phase=rules.Phase.DEADLOCK,
            reason="NO_OPTION",
            candidate_kind="OPTION",
            candidate_ids=(),
        )
        return

    if not await game_service.settle(room_pk, verdict):
        return

    seq = await round_service.emit_phase(
        room_pk,
        phase=verdict.next_phase or rules.Phase.TALLY,
        duration_ms=verdict.next_deadline,
    )
    if verdict.next_deadline:
        game_service.arm(room_pk, seq, verdict.next_deadline, _enter_result)


async def on_retry(room_pk: int) -> None:
    """방장이 다시 시작을 골랐다. **제출부터 다시 받는다.**

    안건 0개(NO_OPTION)와 결선 소진(TIE_EXHAUSTED) 둘 다 이 자리로 온다. 회차를
    0으로 되돌리고 이전 표·안건을 지운다 — 안건이 남아 있으면
    uq_game_options_round_participant에 걸려 아무도 다시 낼 수 없다. 가이드는
    띄우지 않는다(G-4).
    """
    state = store.round_of(room_pk)
    if state is None:
        return

    async with transaction() as conn:
        await conn.execute(votes.delete().where(votes.c.game_round_id == state.round_pk))
        await conn.execute(
            game_options.delete().where(
                game_options.c.game_round_id == state.round_pk
            )
        )

    state.repeat = 0
    state.tie_pool = ()
    state.candidates = []
    state.option_pks = {}
    log.info("킹메이커 다시 시작 — room=%s round=%s", room_pk, state.round_id)
    await _enter_submit(room_pk)


async def _enter_result(room_pk: int) -> None:
    await game_service.enter_result(room_pk, phase=rules.Phase.RESULT)


# ── 저장 형식 → 와이어 형식 ────────────────────────────────────────────────


def wire_result(state: RoundState) -> tuple[str, dict]:
    """result_data를 game:result의 (variant, result)로 옮긴다.

    TALLY의 result는 topic · winnerCandidateId · rows · reveal · stats다(07_api/03 §17).
    저장은 optionId·label·voteCount이고 와이어는 candidateId·text·votes다.

    **익명이면 authorMemberId 자리를 아예 뺀다.** null로 채우면 그 자리를 채우는
    구현이 언젠가 들어온다. **투표자는 어느 설정에서도 나가지 않는다.**
    """
    data = state.result_data or {}
    winners = data.get("winnerOptionIds") or []
    authors = {a["optionId"]: a["memberId"] for a in data.get("authors", ())}
    reveal = "authors" in data

    rows = []
    for row in data.get("tally", ()):
        item = {
            "candidateId": row["optionId"],
            "text": row["label"],
            "votes": row["voteCount"],
        }
        if reveal:
            item["authorMemberId"] = authors.get(row["optionId"])
        rows.append(item)

    return "TALLY", {
        "topic": state.config.get("topic"),
        "winnerCandidateId": winners[0] if winners else None,
        "rows": rows,
        "reveal": {"authors": reveal},
        "stats": _stats(state),
    }


def _stats(state: RoundState) -> list[dict]:
    """결과 화면 하단의 요약 수치 3개.

    08_screen/06_result.md 「개표형」이 정한 후보 수 · 총 투표 수 · 1위 득표율이다.
    """
    tally = (state.result_data or {}).get("tally") or []
    votes_cast = [row["voteCount"] for row in tally]
    total = sum(votes_cast)
    top = max(votes_cast) if votes_cast else 0
    return [
        {"label": "후보 수", "value": f"{len(tally)}개"},
        {"label": "총 투표", "value": f"{total}표"},
        {"label": "1위 득표율", "value": f"{top / total * 100:.1f}%" if total else "-"},
    ]
