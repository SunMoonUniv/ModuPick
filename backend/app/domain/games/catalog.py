"""게임 메타 6종.

**여기서 새로 정의하는 값은 이름·설명·결과 화면 형태·가이드 문안뿐이다.** gameId와 최소
인원의 정본은 app.domain.enums이고 configSchema는 app.domain.game_config가 소유한다.
같은 값을 두 곳에 두면 조용히 갈라지므로 그쪽을 import해서 쓴다.

이름의 정본은 docs/05_game_rules/README.md 스펙 시트, 결과 화면 형태 4종은
docs/07_api/02_rest.md 「GET /api/games」다.
"""

from dataclasses import dataclass
from enum import StrEnum

from app.domain.enums import MIN_MEMBERS, GameId

#: 최대 인원. 6종 모두 같으며 방 정원 상한과 같은 값이다.
MAX_MEMBERS = 10


class ResultVariant(StrEnum):
    """결과 화면의 형태. 클라이언트가 레이아웃을 고르는 축이다."""

    WINNER = "WINNER"  # 사람 1인 — 룰렛 · 시간초 · 저격
    ASSIGN = "ASSIGN"  # 전원 역할 배정 — 사다리
    TALLY = "TALLY"    # 개표 — 킹메이커
    RECORD = "RECORD"  # 라운드 기록 — 눈치


@dataclass(frozen=True, slots=True)
class GameMeta:
    name: str
    description: str
    result_variant: ResultVariant
    rules: tuple[str, ...]  # 가이드의 규칙 요약
    steps: tuple[str, ...]  # 가이드의 진행 단계. 게임마다 2~4단계다


CATALOG: dict[GameId, GameMeta] = {
    GameId.ROULETTE: GameMeta(
        name="운명의 룰렛",
        description="돌림판이 멈춘 조각의 사람이 뽑힌다",
        result_variant=ResultVariant.WINNER,
        rules=(
            "참가자 전원이 같은 크기의 조각을 하나씩 갖는다",
            "방장이 PICK을 누르면 전원의 룰렛이 동시에 돈다",
        ),
        steps=("방장이 PICK", "5초 회전", "정해진 조각에서 정지"),
    ),
    GameId.LADDER: GameMeta(
        name="사다리타기",
        description="가로줄을 타고 내려가 전원의 역할이 한 번에 정해진다",
        result_variant=ResultVariant.ASSIGN,
        rules=(
            "참가자마다 레인이 하나씩 있고 도착 항목과 1:1로 대응한다",
            "방장이 실행하면 전원의 사다리가 동시에 그려진다",
        ),
        steps=("방장이 실행", "사다리 그리기", "전원 배정 공개"),
    ),
    GameId.KINGMAKER: GameMeta(
        name="킹메이커",
        description="익명으로 낸 안건 중 하나를 투표로 고른다",
        result_variant=ResultVariant.TALLY,
        rules=(
            "자기가 낸 안건에는 투표할 수 없다",
            "최다 득표가 동점이면 동점 안건만 두고 결선을 최대 3회 한다",
        ),
        steps=("안건 제출", "익명 투표", "개표·선정"),
    ),
    GameId.TIMER: GameMeta(
        name="시간초 잡기",
        description="목표 시간에 맞춰 멈추고 그 오차로 한 사람을 정한다",
        result_variant=ResultVariant.WINNER,
        rules=(
            "시작한 뒤 2초까지만 숫자가 보이고 그다음부터 가려진다",
            "제한 시간 안에 멈추지 않으면 최하위로 처리한다",
        ),
        steps=("타이머 시작", "감으로 정지", "오차 비교·선정"),
    ),
    GameId.SNIPE: GameMeta(
        name="익명 저격",
        description="질문에 대해 익명으로 지목해 가장 많이 지목된 사람이 뽑힌다",
        result_variant=ResultVariant.WINNER,
        rules=(
            "자기 자신은 지목할 수 없다",
            "누가 누구를 지목했는지는 공개하지 않는다",
        ),
        steps=("질문 확인", "익명 지목", "개표·선정"),
    ),
    GameId.NUNCHI: GameMeta(
        name="눈치게임",
        description="혼자 누른 사람은 빠지고 끝까지 남은 한 사람이 뽑힌다",
        result_variant=ResultVariant.RECORD,
        rules=(
            "판정창 안에 둘 이상이 누르면 그 사람들은 남는다",
            "제한 시간 안에 누르지 않아도 남는다",
        ),
        steps=("라운드 시작", "혼자 눌러 빠져나가기", "최후 1인 확정"),
    ),
}


def meta(game_id: GameId) -> GameMeta:
    return CATALOG[game_id]


def min_members(game_id: GameId) -> int:
    """최소 인원. 정본은 app.domain.enums.MIN_MEMBERS다."""
    return MIN_MEMBERS[game_id]
