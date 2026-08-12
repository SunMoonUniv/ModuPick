"""시간초 잡기 — 목표 시간에 가장 가까운(또는 먼) 1인을 뽑는다.

규칙의 정본은 docs/05_game_rules/05_timer.md, 저장 형식의 정본은
docs/06_database/04_options_votes_results.md 「게임별 JSON 스키마」다.

**클라이언트가 잰 값을 판정에 쓰는 유일한 게임이다.** 서버 도착 시각 차이로 경과 시간을
계산하면 그 값에 START·STOP 두 편도 지연의 차이가 실린다. 그 흔들림이 순위를 가르는
밀리초 오차보다 커서, 감각이 아니라 회선의 균일성이 승자를 정하게 된다. 그래서 측정은
클라이언트 단조 시계에 맡기고 서버가 자기 관측값으로 대조한다.

**대조에 실패한 값은 버리고 서버 관측값으로 판정한다**(07_api/03 §시간초 잡기의 예외).
승자 후보에서 빼지 않는 이유는 둘이다 — 조작해도 서버 관측값으로 되돌아갈 뿐이라 이득이
없고, 회선이 튄 정상 참가자가 억울하게 배제되지도 않는다. 어느 값으로 판정했는지는
records[].source에 남는다.

정본 충돌 — 05_game_rules/05_timer.md 와 04_architecture/04_time_and_timing.md 는 허용
오차를 300밀리초로 두고 대조 실패를 기록 무효(승자 후보 제외)로 규정한다. 07_api/03 ·
06_database/04 · 10_glossary/02·03 은 400밀리초와 서버 관측값 대체로 규정한다. **저장
형식 정본과 이미 구현된 errors.py 문구가 후자**이므로 후자를 따랐다. 앞의 두 문서를
정정해야 한다.
"""

from collections.abc import Sequence
from enum import StrEnum
from typing import Any

from app.domain.games.contract import JudgeContext, JudgeInput, Outcome, Verdict

GAME_ID = "timer"
RESULT_SCHEMA_VERSION = 1

#: game:action type. 뼈대가 이 문자열을 JudgeInput.kind로 넣어 준다(07_api/03).
#: STOP의 payload는 클라이언트가 잰 경과 시간(정수 밀리초) 하나뿐이다 —
#: 벽시계 시각 필드는 받지 않는다. 참고용이라 적어 두어도 언젠가 판정에 섞인다.
START_KIND = "timer.start"
STOP_KIND = "timer.stop"

#: 단계별 고정 시간. 목표 시간만 방장 설정에서 온다.
GUIDE_MS = 3_000
TIE_NOTICE_MS = 3_000
REVEAL_MS = 3_000

#: START 마감 — 라운드 시작 + 10초. 이 시각까지 닿지 않으면 미시작이다.
START_DEADLINE_MS = 10_000

#: 개인 제한의 여유분 — 그 참가자의 START 도착 + (목표 + 3초)까지 STOP을 받는다.
GRACE_MS = 3_000

#: 클라이언트 신고값과 서버 관측값의 허용 차이. **실측으로 검증한 값이 아니다** —
#: 상행 지연 지터의 상한을 여유 있게 잡은 잠정값이고, 통합 후 도착 시각 분포를
#: 측정해 재조정한다. 그때까지 400을 검증된 값으로 인용하지 않는다.
MARGIN_MS = 400

#: 재대결 상한. 소진하면 엔진이 TIE 대신 HOST_CHOICE를 낸다(01_common.md · ADR-19).
MAX_REMATCHES = 3


class Phase(StrEnum):
    """docs/10_glossary/03_enums_state_machines.md 가 고정한 시간초 phase 9종."""

    GUIDE = "GUIDE"
    RUNNING = "RUNNING"          # 본판. 명단 스냅샷 전원이 대상이다
    TIE_NOTICE = "TIE_NOTICE"    # 동점자 명단만 3초 보인다. 기록 값은 아직 감춘다
    REMATCH = "REMATCH"          # 동점자만 대상으로 줄여 같은 목표로 다시 한다
    REVEAL = "REVEAL"            # 순위표를 공개하고 3초 뒤 결과 화면으로 넘어간다
    DEADLOCK = "DEADLOCK"        # 재대결 3회를 소진하고 멈춘 상태. 방장 선택을 기다린다
    RESULT = "RESULT"
    VOID = "VOID"                # 방장이 대기방으로를 고른 경우
    ABORTED = "ABORTED"          # 방장 이탈로 끝난 흡수 상태


class Status(StrEnum):
    """기록 상태 3값. 저장 표기가 소문자다(06_database/04)."""

    RECORDED = "recorded"    # 유효 기록. 승자 후보다
    NO_START = "no_start"    # START 마감까지 START가 닿지 않았다
    NO_STOP = "no_stop"      # START는 했으나 개인 제한까지 STOP이 닿지 않았다


class Source(StrEnum):
    """판정값의 출처 2값. 사람마다 다를 수 있으므로 결과에 남긴다."""

    CLIENT_MEASURED = "CLIENT_MEASURED"
    SERVER_OBSERVED = "SERVER_OBSERVED"


#: 순위표의 군 순서 — 유효 기록자 뒤에 미정지, 그 뒤에 미시작을 붙인다.
#: 시간을 놓친 것과 판에 참여하지 않은 것을 구분해 늘어놓은 것이다.
_GROUP_ORDER = {Status.RECORDED: 0, Status.NO_STOP: 1, Status.NO_START: 2}


# ── 시간 축 ────────────────────────────────────────────────────────────────


def target_ms(ctx: JudgeContext) -> int:
    """목표 시간. 설정은 초이고 내부는 정수 밀리초다(10_glossary/05)."""
    return int(ctx.config.get("targetSeconds", 5)) * 1000


def limit_ms(target: int) -> int:
    """개인 제한의 폭 — 자기 START 도착 이후 이만큼까지 STOP을 받는다."""
    return target + GRACE_MS


def round_deadline_ms(target: int) -> int:
    """라운드 마감. 가장 늦게 START한 참가자의 개인 제한과 같은 시각이다.

    이 시각에 라운드가 반드시 끝난다 — 아무도 누르지 않아도 START 마감이 미시작을,
    START만 하고 멈추지 않아도 개인 제한이 미정지를 확정한다. 종료 증명이 이 성질에
    기댄다. 뼈대가 RUNNING·REMATCH의 next_deadline으로 쓴다.
    """
    return START_DEADLINE_MS + limit_ms(target)


def entrants_of(ctx: JudgeContext) -> tuple[str, ...]:
    """이 회차의 대상자. 본판은 명단 스냅샷 전원, 재대결은 직전 동점자 집합이다.

    도중 이탈자도 대상에 남는다 — 미시작으로 확정되어 승자 후보에서 빠질 뿐이다.
    """
    return tuple(ctx.tie_pool) if ctx.repeat > 0 else tuple(ctx.roster)


def measure(
    start_ms: int,
    stop_ms: int,
    client_ms: int | None,
    target: int,
) -> tuple[int, Source]:
    """판정에 쓸 경과 시간과 그 출처.

    클라이언트 신고값을 채택하는 조건은 둘이다 — 서버 관측값과 MARGIN_MS 안에서
    일치하고, 값 자체가 0 초과 개인 제한 이하다. 하나라도 어기면 신고값을 버리고
    서버 관측값으로 판정한다.

    **비교는 초과(>)이지 이상(≥)이 아니다.** 차이가 정확히 허용 오차면 채택한다.

    막지 못하는 것을 적어 둔다 — 허용 오차 **안에서의** 조작은 통과한다. 목표 5초에
    400밀리초면 최대 8퍼센트를 당길 수 있고 오차가 촘촘한 판에서는 순위를 바꾼다.
    예외를 두는 대가이며, 좁혀 가는 것이 이 게임의 공정성 개선 경로다.
    """
    observed = stop_ms - start_ms
    if client_ms is None or not 0 < client_ms <= limit_ms(target):
        return observed, Source.SERVER_OBSERVED
    if abs(client_ms - observed) > MARGIN_MS:
        return observed, Source.SERVER_OBSERVED
    return client_ms, Source.CLIENT_MEASURED


# ── 입력 수집 ──────────────────────────────────────────────────────────────


def _collect(
    inputs: Sequence[JudgeInput],
    entrants: Sequence[str],
    target: int,
) -> tuple[dict[str, int], dict[str, tuple[int, int | None]]]:
    """참가자별 최초 START 1건과 최초 STOP 1건을 모은다.

    **세 마감의 판별은 전부 서버 도착 시각으로 한다.** 예외는 경과 시간 값 하나뿐이며
    마감 판정에까지 예외를 넓히지 않는다 — 넓히면 클라이언트가 자기 마감을 정하게 된다.

    | 거르는 것 | 결과 |
    |---|---|
    | START 마감 뒤에 도착한 START | 그 참가자는 미시작 |
    | START 없이 온 STOP | 보지 않는다(선행 검사) |
    | 개인 제한 뒤에 도착한 STOP | 그 참가자는 미정지 |
    | 같은 참가자의 두 번째 입력 | 버린다. 되돌릴 수 없다(G-9) |
    """
    limit = limit_ms(target)
    pool = set(entrants)
    starts: dict[str, int] = {}
    stops: dict[str, tuple[int, int | None]] = {}
    for item in inputs:
        who = item.participant_id
        if who not in pool:
            continue
        if item.kind == START_KIND:
            if who in starts or item.arrived_ms > START_DEADLINE_MS:
                continue
            starts[who] = item.arrived_ms
        elif item.kind == STOP_KIND:
            if who in stops or who not in starts:
                continue
            if item.arrived_ms > starts[who] + limit:
                continue
            # 정수가 아닌 신고값은 없는 것으로 본다 — 형식 거절은 뼈대가 하지만
            # 판정이 그 가정 위에서 죽지 않게 한다. bool은 int의 하위형이라 뺀다.
            client = item.payload if type(item.payload) is int else None
            stops[who] = (item.arrived_ms, client)
    return starts, stops


# ── 판정 ───────────────────────────────────────────────────────────────────


def judge(ctx: JudgeContext, inputs: Sequence[JudgeInput] = ()) -> Verdict:
    """한 회차를 판정하고 확정·재대결·교착 중 하나를 낸다.

    **순위표는 판정 기준과 무관하게 절대 오차 오름차순이다.** 가장 먼 사람 기준이어도
    순위표를 뒤집지 않는다 — 오차가 큰 순으로 늘어놓으면 같은 화면이 설정에 따라 다른
    뜻이 되어 기록을 나란히 놓고 볼 수 없다. 뒤집히는 것은 승자 선정뿐이다.

    **미시작·미정지는 승자 후보에서 뺀다.** 가장 먼 사람 기준일 때 미입력자를 후보에
    남기면 아무것도 누르지 않는 것이 최적 전략이 되어 게임이 성립하지 않는다.

    **유효 기록이 0건이면 난수로 승자를 만들지 않는다.** 아무도 참여하지 않은 판에
    결과를 붙이지 않는다 — 재대결로 넘기고 3회를 소진하면 방장이 고른다.
    """
    entrants = entrants_of(ctx)
    if not entrants:
        raise ValueError("대상자 명단이 비어 있다")

    target = target_ms(ctx)
    farthest = str(ctx.config.get("criterion", "CLOSEST")).upper() == "FARTHEST"
    starts, stops = _collect(inputs, entrants, target)

    index = {member: i for i, member in enumerate(ctx.roster)}
    records: list[dict[str, Any]] = []
    for member in entrants:
        if member in stops:
            stop_ms, client = stops[member]
            elapsed, source = measure(starts[member], stop_ms, client, target)
            records.append({
                "memberId": member,
                "elapsedMs": elapsed,
                "diffMs": elapsed - target,          # 부호 포함. 표시용
                "absDiffMs": abs(elapsed - target),  # 판정용
                "rank": 0,
                "status": Status.RECORDED,
                "source": source,
            })
        else:
            records.append({
                "memberId": member,
                "elapsedMs": None,
                "diffMs": None,
                "absDiffMs": None,
                "rank": 0,
                "status": Status.NO_STOP if member in starts else Status.NO_START,
                "source": None,
            })

    # 오차가 밀리초까지 같을 때의 순서까지 스냅샷 인덱스로 고정한다. 같은 입력이면
    # 같은 순위표가 나와야 하고, 그 성질이 결과 재현의 근거다.
    records.sort(key=lambda r: (
        _GROUP_ORDER[r["status"]],
        r["absDiffMs"] if r["absDiffMs"] is not None else 0,
        index.get(r["memberId"], len(index)),
    ))
    for i, row in enumerate(records):
        row["rank"] = i + 1

    valid = [r for r in records if r["status"] == Status.RECORDED]
    if not valid:
        # 이 회차가 진전을 만들지 못했다. 대상자를 그대로 두고 다시 연다.
        return _unresolved(ctx, entrants)

    best = (max if farthest else min)(r["absDiffMs"] for r in valid)
    top = tuple(r["memberId"] for r in valid if r["absDiffMs"] == best)
    if len(top) > 1:
        return _unresolved(ctx, top)

    return Verdict(
        outcome=Outcome.DECIDED,
        winner=top[0],
        next_phase=Phase.REVEAL,
        next_deadline=REVEAL_MS,
        persist={
            "schemaVersion": RESULT_SCHEMA_VERSION,
            "records": records,
            "winnerMemberIds": [top[0]],  # 한 명뿐이어도 배열로 담는다
            "rematchRounds": ctx.repeat,  # 실제로 실시한 재대결 횟수
        },
    )


def _unresolved(ctx: JudgeContext, tied: Sequence[str]) -> Verdict:
    """단독 승자가 나오지 않은 회차. 재대결이 남았으면 열고 아니면 방장에게 넘긴다.

    **기록 값을 내보내지 않는다**(G-10). TIE_NOTICE는 동점자 명단만 3초 보이고
    누가 몇 밀리초였는지는 아직 감춘다 — 다음 회차의 전략이 되기 때문이다.

    재대결 진입은 뼈대가 한다 — 대상자를 tie_pool로 줄이고 기록을 비우며 repeat를
    1 올린다. 목표 시간과 판정 기준은 바꾸지 않는다.
    """
    if ctx.repeat < MAX_REMATCHES:
        return Verdict(
            outcome=Outcome.TIE,
            tie_pool=tuple(tied),
            next_phase=Phase.TIE_NOTICE,
            next_deadline=TIE_NOTICE_MS,
        )
    return Verdict(
        outcome=Outcome.HOST_CHOICE,
        tie_pool=tuple(tied),
        next_phase=Phase.DEADLOCK,  # 타이머가 없는 정지 상태다
    )
