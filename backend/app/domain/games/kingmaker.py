"""킹메이커 — 익명 제출과 투표로 안건 1개를 정한다.

규칙의 정본은 docs/05_game_rules/04_kingmaker.md, 저장 형식의 정본은
docs/06_database/04_options_votes_results.md 「게임별 JSON 스키마」다.

사람이 아니라 **아이디어**를 정하는 유일한 게임이라 규칙의 부담이 익명성과 표 계산
양쪽에 걸린다. 두 축이 이 모듈의 전부다.

**표 계산** — 1인 투표 수 설정 V가 그대로 상한이 되지 않는다. 자기 안건에는 투표할 수
없고 몰아주기도 안 되므로 투표 가능한 후보가 V보다 적을 수 있다. 실효 상한 Qi로
클램프하지 않으면 그 참가자는 투표를 완료할 수 없어 강제 기권이 된다.

**익명성** — 후보와 제출자의 연결은 서버 안에만 둔다. 투표는 후보 ID로 접수하고,
자기 안건 판정은 서버가 매핑을 대조해서 한다. 투표자는 어느 설정에서도 공개하지
않는다 — 방장이 실명 공개를 켜도 드러나는 것은 제출자뿐이다.
"""

from collections.abc import Sequence
from enum import StrEnum

from app.domain import errors
from app.domain.games.contract import (
    Candidate,
    JudgeContext,
    JudgeInput,
    Outcome,
    Verdict,
)
from app.domain.games.rng import Prng, random_below

GAME_ID = "kingmaker"
RESULT_SCHEMA_VERSION = 1

#: game:action type. 뼈대가 이 문자열을 JudgeInput.kind로 넣어 준다(07_api/03).
OPINION_KIND = "king.opinion"
VOTE_KIND = "king.vote"

#: 안건 1건의 최대 길이. 07_api/03 「game:action 입력」.
MAX_OPINION_LEN = 120

#: 단계별 제한 시간. 05_game_rules/04 「종료 증명」이 고정한 값이다.
SUBMIT_MS = 120_000
VOTE_MS = 60_000
RUNOFF_MS = 30_000
TIE_NOTICE_MS = 3_000
TALLY_MS = 3_000

#: 결선 상한. 소진하면 엔진이 TIE 대신 HOST_CHOICE를 낸다(01_common.md · ADR-19).
MAX_RUNOFFS = 3

#: 결선의 1인 투표 수는 방장 설정과 무관하게 1이다.
#:
#: 후보가 m개 남고 quota가 t표일 때 t가 m에 가까울수록 표가 균등해지는 압력이 커진다.
#: m = t + 1이면 자기 안건이 없는 모든 투표가 상쇄적이어서, 동점으로 시작한 결선이
#: 구조적으로 동점을 재생산한다. 결선은 남은 후보 중 단일 선호를 묻는 단계다.
RUNOFF_QUOTA = 1


class Phase(StrEnum):
    """docs/10_glossary/03_enums_state_machines.md 가 고정한 킹메이커 phase 10종."""

    GUIDE = "GUIDE"
    SUBMIT = "SUBMIT"            # 안건을 익명으로 1건 제출한다
    VOTE = "VOTE"                # 섞인 후보에 투표한다. 자기 안건은 비활성이다
    TIE_NOTICE = "TIE_NOTICE"    # 동점 후보 명단만 3초 보인다. 득표 수는 아직 감춘다
    RUNOFF = "RUNOFF"            # 동점 후보만 남기고 다시 투표한다. 표는 초기화한다
    TALLY = "TALLY"              # 득표 순으로 개표하고 3초 뒤 결과 화면으로 넘어간다
    DEADLOCK = "DEADLOCK"        # 결선 3회를 소진하고 멈춘 상태. 방장 선택을 기다린다
    RESULT = "RESULT"
    VOID = "VOID"                # 안건 0개 · 방장이 대기방으로를 고른 경우
    ABORTED = "ABORTED"          # 방장 이탈로 끝난 흡수 상태


# ── 표 계산 규격 ───────────────────────────────────────────────────────────


def votable_count(candidates: Sequence[Candidate], voter_id: str) -> int:
    """이 사람이 투표할 수 있는 후보 수 Ci. 자기가 낸 안건은 빠진다."""
    return sum(1 for c in candidates if c.author_id != voter_id)


def effective_quota(candidates: Sequence[Candidate], voter_id: str, quota: int) -> int:
    """실효 투표 수 상한 Qi = min(quota, Ci).

    **설정 시점에는 V를 검증할 수 없다.** 후보 수는 제출 단계가 끝나야 정해지므로
    방장이 3표로 설정해도 안건이 2개만 나올 수 있다. 그래서 검증이 아니라 이
    클램프로 처리한다.
    """
    return min(quota, votable_count(candidates, voter_id))


def check_ballot(
    candidates: Sequence[Candidate],
    voter_id: str,
    picks: Sequence[str],
    quota: int,
) -> None:
    """투표 1건을 접수해도 되는지 본다. 어기면 DomainError를 낸다.

    **하나라도 어기면 요청 전체를 거절한다.** 일부만 반영하면 참가자가 자기 표가
    어디까지 들어갔는지 알 수 없고, 거절된 요청은 미투표로 되돌아가므로 마감 전이면
    다시 시도할 수 있다.

    마감 전후 판별과 멱등(최초 1회)은 단계 상태를 아는 뼈대가 맡는다 — 여기서는
    시각을 읽지 않는다.
    """
    limit = effective_quota(candidates, voter_id, quota)
    if not picks or len(picks) > limit:
        raise errors.DomainError(errors.VOTE_LIMIT_EXCEEDED)
    if len(set(picks)) != len(picks):
        # 몰아주기를 허용하면 1인 3표가 3배 가중 1표가 되어 다표제의 뜻이 사라진다.
        raise errors.DomainError(errors.VOTE_DUPLICATE_TARGET)

    by_id = {c.id: c for c in candidates}
    for cid in picks:
        if cid not in by_id:
            raise errors.DomainError(errors.VOTE_TARGET_NOT_FOUND)
        if by_id[cid].author_id == voter_id:
            raise errors.DomainError(errors.VOTE_SELF_NOT_ALLOWED)


def shuffle_candidates(
    candidates: Sequence[Candidate], seed: int
) -> tuple[Candidate, ...]:
    """후보 표시 순서를 라운드 시드로 섞는다. 순서는 전원에게 같다.

    제출 순서를 그대로 쓰면 "먼저 제출한 사람이 앞"이라는 정보가 제출자 힌트가 된다.
    표시 전용이며 **개표에는 영향을 주지 않는다** — 표는 후보 ID로 세기 때문이다.
    """
    prng = Prng(seed, f"{GAME_ID}:order")
    out = list(candidates)
    for i in range(len(out) - 1, 0, -1):
        j = random_below(prng, i + 1)
        out[i], out[j] = out[j], out[i]
    return tuple(out)


# ── 개표 ───────────────────────────────────────────────────────────────────


def _ballots(inputs: Sequence[JudgeInput]) -> dict[str, tuple[str, ...]]:
    """투표 입력을 voterId → 후보 ID 배열로 모은다.

    **한 사람의 최초 1건만 센다**(G-9). 같은 요청이 여러 번 도착해도 표가 늘지 않아야
    한다. inputs는 도착 순으로 정렬되어 들어오므로 먼저 온 것이 최초다.
    """
    ballots: dict[str, tuple[str, ...]] = {}
    for item in inputs:
        if item.kind != VOTE_KIND or item.participant_id in ballots:
            continue
        picks = item.payload or ()
        ballots[item.participant_id] = tuple(picks)
    return ballots


def _persist(
    candidates: Sequence[Candidate],
    counts: dict[str, int],
    winners: Sequence[str],
    ballot_rounds: int,
    *,
    reveal_authors: bool,
    by_random: bool,
) -> dict:
    """result_data를 만든다. 06_database/04 「게임별 JSON 스키마」 그대로다.

    **득표 순으로 정렬해 둔다.** 개표 화면이 그 순서로 그리고, 같은 표면 후보 순서를
    유지해 같은 입력이 같은 저장 결과를 낸다.
    """
    by_id = {c.id: c for c in candidates}
    rows = sorted(
        ({"optionId": cid, "label": by_id[cid].text, "voteCount": n} for cid, n in counts.items()),
        key=lambda row: -row["voteCount"],
    )
    data = {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "tally": rows,
        "winnerOptionIds": list(winners),
        "ballotRounds": ballot_rounds,
        "decidedByRandom": by_random,
    }
    if reveal_authors:
        # 익명이면 제출자를 **저장하지도 않는다.** result_data는 방이 사는 동안
        # 남으므로, 담아 두면 공개 설정과 무관하게 유출 경로가 하나 생긴다.
        data["authors"] = [
            {"optionId": c.id, "memberId": c.author_id} for c in candidates
        ]
    return data


def judge(ctx: JudgeContext, inputs: Sequence[JudgeInput] = ()) -> Verdict:
    """후보와 표를 받아 확정·결선·교착 중 하나를 낸다.

    **도착 시각이 판정에 들어가지 않는다.** 표를 세는 순서는 결과를 바꾸지 않고
    (덧셈의 교환법칙) 동점 집합도 순서에 의존하지 않는다. 전원의 투표가 같은
    밀리초에 도착해도 결과가 흔들리지 않는 근거가 이것이다.

    난수를 쓰는 자리는 유효표 0 하나뿐이며 그것도 시드로 재현된다.
    """
    candidates = tuple(ctx.candidates)
    reveal_authors = bool(ctx.config.get("revealAuthors", False))
    ballot_rounds = ctx.repeat + 1  # 본선 1회 + 지금까지의 결선 횟수

    # 안건 0개 — 게임을 성립시킬 수 없다. 결과를 남기지 않고 설정 화면으로 되돌린다.
    if not candidates:
        return Verdict(outcome=Outcome.VOID, next_phase=Phase.VOID)

    counts = {c.id: 0 for c in candidates}

    # 안건 1개 — 투표 단계를 건너뛴다. 표가 없는 것이 기권이 아니라 설계이므로
    # 아래 유효표 0 분기보다 먼저 본다. 난수로 뽑은 것이 아니다.
    if len(candidates) == 1:
        return _decided(
            candidates, counts, candidates[0].id, ballot_rounds,
            reveal_authors=reveal_authors, by_random=False,
        )

    for picks in _ballots(inputs).values():
        for cid in picks:
            if cid in counts:  # 결선에서 탈락한 후보로 온 표는 세지 않는다
                counts[cid] += 1

    # 유효표 0 — 결선을 열어도 같은 0표 동점이 재생산되므로 난수로 끊는다.
    # 킹메이커·저격이 난수 확정을 쓰는 유일한 자리다(01_common.md).
    if not any(counts.values()):
        prng = Prng(ctx.seed, f"{GAME_ID}:void:{ctx.repeat}")
        winner = candidates[random_below(prng, len(candidates))]
        return _decided(
            candidates, counts, winner.id, ballot_rounds,
            reveal_authors=reveal_authors, by_random=True,
        )

    top_votes = max(counts.values())
    tied = tuple(c.id for c in candidates if counts[c.id] == top_votes)

    if len(tied) == 1:
        return _decided(
            candidates, counts, tied[0], ballot_rounds,
            reveal_authors=reveal_authors, by_random=False,
        )

    if ctx.repeat < MAX_RUNOFFS:
        # 결선 진입은 뼈대가 한다 — 후보를 tie_pool로 줄이고 표를 비우며 repeat를
        # 1 올린다. 여기서는 득표 수를 내보내지 않는다(G-10).
        return Verdict(
            outcome=Outcome.TIE,
            tie_pool=tied,
            next_phase=Phase.TIE_NOTICE,
            next_deadline=TIE_NOTICE_MS,
        )

    return Verdict(
        outcome=Outcome.HOST_CHOICE,
        tie_pool=tied,
        next_phase=Phase.DEADLOCK,  # 타이머가 없는 정지 상태다
    )


def _decided(
    candidates: Sequence[Candidate],
    counts: dict[str, int],
    winner_id: str,
    ballot_rounds: int,
    *,
    reveal_authors: bool,
    by_random: bool,
) -> Verdict:
    persist = _persist(
        candidates, counts, [winner_id], ballot_rounds,
        reveal_authors=reveal_authors, by_random=by_random,
    )
    return Verdict(
        outcome=Outcome.DECIDED,
        winner=winner_id,  # 사람이 아니라 안건의 ID다
        tally=persist["tally"],
        next_phase=Phase.TALLY,
        next_deadline=TALLY_MS,
        persist=persist,
        # 뼈대가 개표 응답에 제출자를 실어도 되는지 여기서 정한다. 투표자는 어느
        # 설정에서도 공개하지 않으므로 축 자체를 두지 않는다.
        reveal={"authors": reveal_authors},
    )
