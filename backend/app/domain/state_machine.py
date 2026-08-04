"""방 상태 머신 — (상태 × 이벤트) 전표.

정본은 docs/04_architecture/05_room_state_machine.md의 전표이며, **모든 칸이 채워져
있어야 한다.** 빈 칸이 남으면 구현자가 임의로 메우고 그것이 결함이 된다. 이 모듈은
그 표를 그대로 옮겨 실행 가능하게 만든 것이다.

네 가지 결과가 서로 다르다.

    ALLOW   처리한다
    REJECT  발신자에게만 에러 코드를 돌려준다
    IGNORE  아무 응답도 하지 않고 상태를 바꾸지 않는다
    DROP    정상 흐름에서 생길 수 있는 늦은 입력을 조용히 없애고 처리 완료만 알린다

**셋 다 브로드캐스트하지 않는다.**

상태가 넷인데 DB의 rooms.status는 둘(waiting · playing)뿐이다. 결과는 진행 중인
라운드의 phase가 RESULT인 상태이고, 폐기는 값이 아니라 행 삭제다. 그래서 상태 판정은
DB 컬럼 하나가 아니라 room_state()가 합쳐 낸다.

**이 표는 빠른 실패용이다.** 최종 판정은 여전히 서비스가 잠근 뒤에 다시 본다 —
정원·준비 상태는 검사와 커밋 사이에 바뀔 수 있다.
"""

from dataclasses import dataclass
from enum import StrEnum, auto

from app.domain import errors
from app.domain.errors import ErrorSpec


class RoomPhase(StrEnum):
    """개념 상태 넷. DB의 rooms.status와 1:1이 아니다."""

    WAITING = "WAITING"
    PLAYING = "PLAYING"
    RESULT = "RESULT"
    DISCARDED = "DISCARDED"


class Action(StrEnum):
    """전표의 이벤트 23종. 번호는 정본 표의 행 번호다."""

    JOIN = "join"                       # 1  새 참가자 입장 요청
    HANDSHAKE = "handshake"             # 2  소켓 핸드셰이크
    CONFIRM_PROFILE = "confirm_profile"  # 3  프로필 확정
    READY = "ready"                     # 4  준비 완료 토글
    CHAT = "chat"                       # 5  채팅 전송
    GAME_SELECT = "game_select"         # 6  게임 선택
    GAME_CONFIG = "game_config"         # 7  게임 설정 변경
    GAME_START = "game_start"           # 8  게임 시작
    GAME_ACTION = "game_action"         # 9  게임 입력 도착
    JUDGE_SETTLED = "judge_settled"     # 10 판정 확정
    JUDGE_TIE = "judge_tie"             # 11 판정 동점(회차 < 3)
    JUDGE_EXHAUSTED = "judge_exhausted"  # 12 반복 상한 도달·무효 라운드
    HOST_DECIDE = "host_decide"         # 13 방장 선택 수신
    PLAY_AGAIN = "play_again"           # 14 다시 하기
    ROUND_CLOSE = "round_close"         # 15 대기방 복귀
    KICK = "kick"                       # 16 참가자 강퇴
    MEMBER_LEAVE = "member_leave"       # 17 참가자 명시적 나가기
    MEMBER_TIMEOUT = "member_timeout"   # 18 참가자 이탈 확정(유예 만료)
    HOST_LEAVE = "host_leave"           # 19 방장 명시적 나가기
    HOST_TIMEOUT = "host_timeout"       # 20 방장 이탈 확정(유예 만료)
    LAST_LEAVE = "last_leave"           # 21 마지막 참가자 이탈
    EXPIRED = "expired"                 # 22 10분 무활동 만료
    RESTART = "restart"                 # 23 서버 재기동


class Outcome(StrEnum):
    ALLOW = auto()
    REJECT = auto()
    IGNORE = auto()
    DROP = auto()


@dataclass(frozen=True, slots=True)
class Verdict:
    outcome: Outcome
    error: ErrorSpec | None = None

    @property
    def allowed(self) -> bool:
        return self.outcome is Outcome.ALLOW


_ALLOW = Verdict(Outcome.ALLOW)
_IGNORE = Verdict(Outcome.IGNORE)
_DROP = Verdict(Outcome.DROP)


def _reject(spec: ErrorSpec) -> Verdict:
    return Verdict(Outcome.REJECT, spec)


#: 폐기 상태에서 소켓 경로로 오는 것들. 방이 없으므로 세션이 끊긴 것으로 본다.
_GONE = _reject(errors.ROOM_NOT_FOUND)
_PLAYING = _reject(errors.ROOM_ALREADY_PLAYING)
_INVALID = _reject(errors.GAME_INVALID_ACTION)

#: (상태 × 이벤트) 전표. **모든 칸을 채운다.**
TABLE: dict[Action, dict[RoomPhase, Verdict]] = {
    Action.JOIN: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _PLAYING,
        RoomPhase.RESULT: _PLAYING,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.HANDSHAKE: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _PLAYING,
        RoomPhase.RESULT: _PLAYING,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.CONFIRM_PROFILE: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _INVALID,
        RoomPhase.RESULT: _INVALID,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.READY: {
        RoomPhase.WAITING: _ALLOW,
        # 진행·결과에서는 준비 개념이 없다. 정본은 "무시"라고 적었으나 소켓 규약이
        # 버려진 입력에도 발신자에게 error를 돌려주라고 하므로 거부로 옮긴다.
        RoomPhase.PLAYING: _INVALID,
        RoomPhase.RESULT: _INVALID,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.CHAT: {
        # 채팅은 방 전 구간에서 열린다(D-45).
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _ALLOW,
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.GAME_SELECT: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _INVALID,
        RoomPhase.RESULT: _INVALID,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.GAME_CONFIG: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _INVALID,
        RoomPhase.RESULT: _INVALID,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.GAME_START: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _INVALID,
        RoomPhase.RESULT: _INVALID,  # 다시 하기를 쓴다
        RoomPhase.DISCARDED: _GONE,
    },
    Action.GAME_ACTION: {
        RoomPhase.WAITING: _reject(errors.GAME_ROUND_NOT_FOUND),
        RoomPhase.PLAYING: _ALLOW,
        RoomPhase.RESULT: _DROP,  # 끝난 판의 입력이다
        RoomPhase.DISCARDED: _GONE,
    },
    Action.JUDGE_SETTLED: {
        RoomPhase.WAITING: _INVALID,
        RoomPhase.PLAYING: _ALLOW,  # 결과로 전이
        RoomPhase.RESULT: _IGNORE,  # 중복 종료에는 기존 결과를 그대로 돌려준다
        RoomPhase.DISCARDED: _IGNORE,
    },
    Action.JUDGE_TIE: {
        RoomPhase.WAITING: _INVALID,
        RoomPhase.PLAYING: _ALLOW,  # 상태는 진행 그대로
        RoomPhase.RESULT: _IGNORE,
        RoomPhase.DISCARDED: _IGNORE,
    },
    Action.JUDGE_EXHAUSTED: {
        RoomPhase.WAITING: _INVALID,
        RoomPhase.PLAYING: _ALLOW,  # 상태는 진행 그대로
        RoomPhase.RESULT: _IGNORE,
        RoomPhase.DISCARDED: _IGNORE,
    },
    Action.HOST_DECIDE: {
        RoomPhase.WAITING: _reject(errors.GAME_DECISION_NOT_REQUIRED),
        RoomPhase.PLAYING: _ALLOW,
        RoomPhase.RESULT: _reject(errors.GAME_DECISION_NOT_REQUIRED),
        RoomPhase.DISCARDED: _GONE,
    },
    Action.PLAY_AGAIN: {
        RoomPhase.WAITING: _INVALID,  # 직전 결과가 없다
        RoomPhase.PLAYING: _INVALID,
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.ROUND_CLOSE: {
        RoomPhase.WAITING: _INVALID,  # 이미 대기다
        RoomPhase.PLAYING: _INVALID,  # 진행 중 취소 경로를 두지 않는다
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.KICK: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _INVALID,  # 명단 스냅샷이 고정돼 있다
        RoomPhase.RESULT: _INVALID,
        RoomPhase.DISCARDED: _GONE,
    },
    Action.MEMBER_LEAVE: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _ALLOW,  # 후보로 남기고 미입력 기본값
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _IGNORE,  # 이미 정리됐다
    },
    Action.MEMBER_TIMEOUT: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _ALLOW,
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _IGNORE,
    },
    Action.HOST_LEAVE: {
        RoomPhase.WAITING: _ALLOW,  # 폐기로 전이
        RoomPhase.PLAYING: _ALLOW,  # 판은 결과 없이 끝난다
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _IGNORE,
    },
    Action.HOST_TIMEOUT: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _ALLOW,
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _IGNORE,
    },
    Action.LAST_LEAVE: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _ALLOW,
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _IGNORE,
    },
    Action.EXPIRED: {
        # **진행·결과에서는 만료 타이머가 멈춰 있다.** 전표는 전이가 일어난다고
        # 적었지만, 그 전이가 발화하려면 무활동이 쌓여야 하고 판이 도는 동안에는
        # 쌓이지 않는다. 스위퍼가 대기 상태만 고르는 것이 그 구현이다.
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _IGNORE,
        RoomPhase.RESULT: _IGNORE,
        RoomPhase.DISCARDED: _IGNORE,
    },
    Action.RESTART: {
        RoomPhase.WAITING: _ALLOW,
        RoomPhase.PLAYING: _ALLOW,  # 진행 중 라운드를 취소로 닫고 삭제한다
        RoomPhase.RESULT: _ALLOW,
        RoomPhase.DISCARDED: _IGNORE,
    },
}


def room_phase(*, room_status: str | None, round_phase: str | None) -> RoomPhase:
    """DB 상태와 인메모리 단계를 합쳐 개념 상태를 낸다.

    방 행이 없으면 폐기다 — **종료는 값이 아니라 행 삭제다.**
    """
    if room_status is None:
        return RoomPhase.DISCARDED
    if room_status != "playing":
        return RoomPhase.WAITING
    return RoomPhase.RESULT if round_phase == "RESULT" else RoomPhase.PLAYING


def decide(action: Action, phase: RoomPhase) -> Verdict:
    """전표를 읽는다. 채워지지 않은 칸은 존재하지 않는다."""
    return TABLE[action][phase]


def ensure(action: Action, phase: RoomPhase) -> None:
    """허용되지 않으면 도메인 에러를 던진다.

    IGNORE·DROP도 여기서는 에러로 올린다 — 소켓 규약이 버려진 입력에도 발신자에게
    error를 돌려주라고 하기 때문이다. 조용히 삼키면 클라이언트가 입력이 반영된 줄
    알고 기다린다.
    """
    verdict = decide(action, phase)
    if verdict.allowed:
        return
    raise errors.DomainError(verdict.error or errors.GAME_INVALID_ACTION)
