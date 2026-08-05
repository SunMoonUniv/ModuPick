"""판정 엔진 공통 계약.

정본은 docs/04_architecture/03_judgment_engine.md 「게임별 판정 호출 규약」이다.
판정 함수는 **현재 시각을 읽지 않고 DB에 접근하지 않으며 소켓을 모른다** — 인자로 받은
값만 쓴다. 이 세 금지가 지켜지지 않으면 결정론이 깨지고 사후 검증이 불가능해진다.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Outcome(StrEnum):
    """판정 결과의 종류. docs/04_architecture/03_judgment_engine.md 「결과 종류의 뜻」"""

    DECIDED = "DECIDED"          # 단독 승자 또는 전원 배정이 확정됐다
    TIE = "TIE"                  # 동점이라 다음 회차가 필요하다. 상한은 3회다
    VOID = "VOID"                # 판이 성립하지 않았다
    HOST_CHOICE = "HOST_CHOICE"  # 자동 진행을 멈추고 방장이 골라야 한다


@dataclass(frozen=True, slots=True)
class JudgeInput:
    """수용된 입력 1건. 판정 함수에는 도착 순으로 정렬되어 들어온다."""

    participant_id: str          # 주체 — 소켓 바인딩에서 온 값. 페이로드를 믿지 않는다
    kind: str                    # 제출 · 투표 · 지목 · 시작 · 정지 · 누르기 · 실행
    payload: Any = None
    arrived_ms: int = 0          # 라운드 시작을 원점으로 하는 상대 정수 밀리초
    seq: int = 0                 # 같은 밀리초일 때만 쓰는 결정론적 보조 축


@dataclass(frozen=True, slots=True)
class JudgeContext:
    """판정 문맥. 게임이 쓰지 않는 축은 기본값으로 둔다."""

    round_id: str
    game_id: str
    seed: int                                    # 라운드 시드
    roster: tuple[str, ...]                      # 명단 스냅샷. 시작 이후 변하지 않는다
    config: Mapping[str, Any] = field(default_factory=dict)   # 방장 설정
    alive: tuple[str, ...] | None = None         # 생존자 명단 — 눈치게임에서만 쓴다
    phase: str = ""
    repeat: int = 0                              # 결선·재대결·무효 재시작마다 1 증가
    started_ms: int = 0                          # 단계 시작 시각
    deadline_ms: int | None = None               # 단계 마감. 제한이 없으면 None
    tie_pool: tuple[str, ...] = ()               # 직전 회차의 동점자 집합


@dataclass(frozen=True, slots=True)
class Verdict:
    """판정 결과. 게임이 내지 않는 값은 None으로 둔다."""

    outcome: Outcome
    winner: str | None = None                    # 단독 승자 (1인 선정 게임)
    assignments: Any = None                      # 전원 배정 (사다리타기)
    tally: Any = None                            # 개표 결과 (킹메이커 · 익명 저격)
    survivors: tuple[str, ...] | None = None     # 다음 회차 생존자 (눈치게임)
    tie_pool: tuple[str, ...] = ()               # 다음 회차 동점자 집합 (TIE일 때)
    next_phase: str | None = None
    next_deadline: int | None = None             # 다음 단계의 제한 시간(밀리초)
    persist: Mapping[str, Any] | None = None     # 영속 대상 — result_data 형식 그대로다
    reveal: Mapping[str, Any] | None = None      # 공개 범위 — 익명 게임에서만 쓴다
    detail: Mapping[str, Any] | None = None      # 연출 파라미터 (아래 주석)


# detail은 계약 문서의 Verdict에 없는 자리다. 룰렛의 winnerIndex처럼 **연출이 시작되는
# 시점에 클라이언트가 필요로 하지만 result_data에도 소켓 이벤트에도 자리가 없는 값**이
# 실제로 있어서 둔다. 전송 위치가 문서에서 확정되면 그 자리로 옮기고 이 필드를 없앤다.
