"""익명 저격 — 서로를 익명으로 지목해 1인을 뽑는다.

규칙의 정본은 docs/05_game_rules/06_snipe.md, 저장 형식의 정본은
docs/06_database/04_options_votes_results.md 「게임별 JSON 스키마」다.

킹메이커와 개표 구조가 같다. 다른 것은 **후보가 안건이 아니라 사람**이라는 점이며,
그래서 후보 집합이 따로 필요 없다 — 본선은 명단 스냅샷 전체이고 결선은 직전 회차의
동점자 집합(tie_pool)이다.

**지목자는 어떤 설정에서도 공개하지 않는다.** 결과에 담기는 것은 후보별 피격 수뿐이고
누가 누구를 지목했는지는 서버 안에만 남는다. 그것을 여는 설정 자체를 두지 않는다.
"""

from collections.abc import Sequence
from enum import StrEnum

from app.domain import errors
from app.domain.games.contract import JudgeContext, JudgeInput, Outcome, Verdict
from app.domain.games.rng import Prng, random_below

GAME_ID = "snipe"
RESULT_SCHEMA_VERSION = 1

#: game:action type. 뼈대가 이 문자열을 JudgeInput.kind로 넣어 준다(07_api/03).
VOTE_KIND = "snipe.vote"

#: 단계별 고정 시간. 본선 투표 시간만 방장 설정에서 온다.
GUIDE_MS = 3_000
TIE_NOTICE_MS = 3_000
REVEAL_MS = 3_000

#: 결선 투표 시간은 본선의 절반이되 이 값 아래로 내려가지 않는다.
#: 본선을 최소값 5초로 설정해도 결선이 2.5초가 되지 않는다.
MIN_RUNOFF_MS = 5_000

#: 결선 상한. 소진하면 엔진이 TIE 대신 HOST_CHOICE를 낸다(01_common.md · ADR-19).
MAX_RUNOFFS = 3


class Phase(StrEnum):
    """docs/10_glossary/03_enums_state_machines.md 가 고정한 저격 phase 9종."""

    GUIDE = "GUIDE"
    VOTE = "VOTE"                # 본선. 후보는 명단 스냅샷 전원이다
    TIE_NOTICE = "TIE_NOTICE"    # 동점자 명단만 3초 보인다. 피격 수는 아직 감춘다
    RUNOFF = "RUNOFF"            # 동점자만 후보로 남기고 명단 전원이 재투표한다
    REVEAL = "REVEAL"            # 피격 수를 공개하고 3초 뒤 결과 화면으로 넘어간다
    DEADLOCK = "DEADLOCK"        # 결선 3회를 소진하고 멈춘 상태. 방장 선택을 기다린다
    RESULT = "RESULT"
    VOID = "VOID"                # 방장이 대기방으로를 고른 경우
    ABORTED = "ABORTED"          # 방장 이탈로 끝난 흡수 상태


# ── 후보와 지목 상한 ───────────────────────────────────────────────────────


def candidates_of(ctx: JudgeContext) -> tuple[str, ...]:
    """이 회차의 후보 집합.

    **본선은 명단 스냅샷 전원**이고 도중 이탈자도 후보에 남아 뽑힐 수 있다.
    결선은 직전 회차의 동점자만 남는다 — 재투표는 후보가 아닌 사람도 포함해
    명단 전원이 한다.
    """
    return tuple(ctx.tie_pool) if ctx.repeat > 0 else tuple(ctx.roster)


def pick_limit(
    candidates: Sequence[str],
    voter_id: str,
    *,
    multi_vote: bool,
    runoff: bool,
) -> int:
    """이 사람이 지목할 수 있는 최대 인원.

    **결선은 1로 고정한다.** 후보가 2명 남고 상한이 2면 자기가 후보가 아닌 투표자는
    두 후보를 모두 지목하게 되어 표가 같은 폭으로 늘어난다 — 동점에서 시작한 결선이
    구조적으로 동점을 재생산한다.

    본선의 상한 max(1, m // 2)는 **표의 상쇄**에서 온다. 두 투표자의 지목 집합이
    각각 후보의 절반을 넘으면 비둘기집 원리로 반드시 겹치고, 지목 수가 절반을 넘는
    순간 모든 투표자의 표가 겹쳐 득표가 균등해진다. 극단은 전원 지목이며 그때는
    어떤 정보도 남지 않는다. 절반 이하로 묶어야 서로 다른 선호가 표 차이로 드러난다.

    방 인원이 5명 미만이면 중복 투표를 켜도 상한이 1이라 1인 1표와 같아진다.
    """
    if runoff or not multi_vote:
        return 1
    m = sum(1 for c in candidates if c != voter_id)
    return max(1, m // 2)


def check_ballot(
    candidates: Sequence[str],
    voter_id: str,
    picks: Sequence[str],
    *,
    multi_vote: bool,
    runoff: bool,
) -> None:
    """지목 1건을 접수해도 되는지 본다. 어기면 DomainError를 낸다.

    **하나라도 어기면 요청 전체를 거절한다.** 앞의 몇 개만 반영하면 상한을 넘긴
    요청이 부분적으로 통과해 표를 균등하게 만드는 경로가 남는다. 거절된 요청은
    미투표로 되돌아가므로 마감 전이면 다시 시도할 수 있다.

    마감 전후 판별과 멱등(최초 1회)은 단계 상태를 아는 뼈대가 맡는다.
    """
    limit = pick_limit(candidates, voter_id, multi_vote=multi_vote, runoff=runoff)
    if not picks or len(picks) > limit:
        raise errors.DomainError(errors.VOTE_LIMIT_EXCEEDED)
    if len(set(picks)) != len(picks):
        raise errors.DomainError(errors.VOTE_DUPLICATE_TARGET)
    for target in picks:
        if target == voter_id:
            # 후보 그리드에 자기 카드가 없으므로 정상 조작으로는 오지 않는다.
            raise errors.DomainError(errors.VOTE_SELF_NOT_ALLOWED)
        if target not in candidates:
            raise errors.DomainError(errors.VOTE_TARGET_NOT_FOUND)


def runoff_ms(vote_seconds: int) -> int:
    """결선 투표 시간. 본선의 절반이되 5초 아래로 내려가지 않는다."""
    return max(MIN_RUNOFF_MS, vote_seconds * 1000 // 2)


# ── 개표 ───────────────────────────────────────────────────────────────────


def _ballots(inputs: Sequence[JudgeInput]) -> dict[str, tuple[str, ...]]:
    """지목 입력을 voterId → 대상 ID 배열로 모은다.

    **한 사람의 최초 1건만 센다**(G-9). inputs는 도착 순으로 정렬되어 들어온다.
    """
    ballots: dict[str, tuple[str, ...]] = {}
    for item in inputs:
        if item.kind != VOTE_KIND or item.participant_id in ballots:
            continue
        ballots[item.participant_id] = tuple(item.payload or ())
    return ballots


def judge(ctx: JudgeContext, inputs: Sequence[JudgeInput] = ()) -> Verdict:
    """후보와 지목을 받아 확정·결선·교착 중 하나를 낸다.

    **도착 시각이 판정에 들어가지 않는다.** 표를 세는 순서는 결과를 바꾸지 않고
    동점 집합도 순서에 의존하지 않는다. 전원의 지목이 같은 밀리초에 도착해도
    결과가 흔들리지 않는 근거가 이것이다.

    난수를 쓰는 자리는 유효표 0 하나뿐이며 그것도 시드로 재현된다.
    """
    candidates = candidates_of(ctx)
    if not candidates:
        raise ValueError("후보 집합이 비어 있다")

    ballot_rounds = ctx.repeat + 1  # 본선 1회 + 지금까지의 결선 횟수
    ballots = _ballots(inputs)
    # 기권은 명단 스냅샷 기준이다 — 결선에서도 후보가 아닌 사람이 투표권을 갖는다.
    abstain = len(ctx.roster) - len(ballots)

    hits = {c: 0 for c in candidates}
    for picks in ballots.values():
        for target in picks:
            if target in hits:  # 결선에서 탈락한 후보로 온 표는 세지 않는다
                hits[target] += 1

    # 유효표 0 — 결선을 열어도 같은 0표 동점이 재생산되므로 난수로 끊는다.
    # 프로토타입은 정렬 첫 번째를 승자로 삼았는데, 그러면 명단 순서를 아는
    # 참가자에게 결과가 예측되어 공정성 결함이 된다.
    if not any(hits.values()):
        prng = Prng(ctx.seed, f"{GAME_ID}:void:{ctx.repeat}")
        winner = candidates[random_below(prng, len(candidates))]
        return _decided(winner, hits, ballot_rounds, abstain, by_random=True)

    # 방어적 처리 — 결선 후보는 동점 집합이라 항상 2명 이상이다(06_snipe.md 논증).
    if len(candidates) == 1:
        return _decided(candidates[0], hits, ballot_rounds, abstain, by_random=False)

    top_hits = max(hits.values())
    tied = tuple(c for c in candidates if hits[c] == top_hits)

    if len(tied) == 1:
        return _decided(tied[0], hits, ballot_rounds, abstain, by_random=False)

    if ctx.repeat < MAX_RUNOFFS:
        # 결선 진입은 뼈대가 한다 — 후보를 tie_pool로 줄이고 표를 비우며 repeat를
        # 1 올린다. 여기서는 피격 수를 내보내지 않는다(G-10).
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
    winner: str,
    hits: dict[str, int],
    ballot_rounds: int,
    abstain: int,
    *,
    by_random: bool,
) -> Verdict:
    """확정 결과를 만든다. 피격 수 많은 순으로 정렬해 둔다."""
    tally = sorted(
        ({"memberId": member, "hitCount": n} for member, n in hits.items()),
        key=lambda row: -row["hitCount"],
    )
    persist = {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "tally": tally,
        "winnerMemberIds": [winner],  # 한 명뿐이어도 배열로 담는다
        "ballotRounds": ballot_rounds,
        "abstainCount": abstain,
        "decidedByRandom": by_random,
    }
    return Verdict(
        outcome=Outcome.DECIDED,
        winner=winner,
        tally=tally,
        next_phase=Phase.REVEAL,
        next_deadline=REVEAL_MS,
        persist=persist,
        # 지목 쌍을 여는 설정은 없다. 축을 두면 언젠가 켜지므로 아예 두지 않는다.
        reveal={"voters": False},
    )
