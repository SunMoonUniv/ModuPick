"""방 상태 머신 전표 테스트 — DB 없이 돈다.

정본(docs/04_architecture/05_room_state_machine.md)이 **모든 칸을 채우라**고 규정하므로,
이 파일의 첫 시험이 그 완전성이다. 빈 칸이 남으면 구현자가 임의로 메우고 그것이
결함이 된다.
"""

import pytest

from app.domain import errors
from app.domain.state_machine import (
    TABLE,
    Action,
    Outcome,
    RoomPhase,
    decide,
    ensure,
    room_phase,
)


class TestCompleteness:
    def test_이벤트는_23종이다(self):
        assert len(Action) == 23

    def test_모든_칸이_채워져_있다(self):
        missing = [
            (a.name, p.name)
            for a in Action
            for p in RoomPhase
            if p not in TABLE.get(a, {})
        ]
        assert missing == [], f"빈 칸 {len(missing)}개: {missing[:5]}"

    def test_거부에는_반드시_코드가_붙는다(self):
        """거부는 발신자에게 에러 코드를 돌려준다. 코드가 없으면 돌려줄 것이 없다."""
        codeless = [
            (a.name, p.name)
            for a in Action
            for p in RoomPhase
            if decide(a, p).outcome is Outcome.REJECT and decide(a, p).error is None
        ]
        assert codeless == []

    def test_허용에는_코드가_붙지_않는다(self):
        stray = [
            (a.name, p.name)
            for a in Action
            for p in RoomPhase
            if decide(a, p).allowed and decide(a, p).error is not None
        ]
        assert stray == []


class TestPhaseDerivation:
    def test_방이_없으면_폐기다(self):
        assert room_phase(room_status=None, round_phase=None) is RoomPhase.DISCARDED

    def test_waiting은_대기다(self):
        assert room_phase(room_status="waiting", round_phase=None) is RoomPhase.WAITING

    def test_playing에_RESULT_단계면_결과다(self):
        assert room_phase(room_status="playing", round_phase="RESULT") is RoomPhase.RESULT

    def test_playing에_다른_단계면_진행이다(self):
        for phase in ("READY", "PLAYING", "TIE", None):
            assert room_phase(room_status="playing", round_phase=phase) is RoomPhase.PLAYING


class TestKeyCells:
    """전표에서 규칙이 갈리는 칸들."""

    def test_채팅은_전_구간에서_열린다(self):
        for p in (RoomPhase.WAITING, RoomPhase.PLAYING, RoomPhase.RESULT):
            assert decide(Action.CHAT, p).allowed
        assert not decide(Action.CHAT, RoomPhase.DISCARDED).allowed

    def test_강퇴는_대기에서만_된다(self):
        assert decide(Action.KICK, RoomPhase.WAITING).allowed
        assert not decide(Action.KICK, RoomPhase.PLAYING).allowed
        assert not decide(Action.KICK, RoomPhase.RESULT).allowed

    def test_진행_중_입장은_already_playing이다(self):
        v = decide(Action.JOIN, RoomPhase.PLAYING)
        assert v.error is errors.ROOM_ALREADY_PLAYING

    def test_대기방_복귀는_결과에서만_된다(self):
        assert decide(Action.ROUND_CLOSE, RoomPhase.RESULT).allowed
        assert not decide(Action.ROUND_CLOSE, RoomPhase.PLAYING).allowed

    def test_다시_하기는_결과에서만_된다(self):
        assert decide(Action.PLAY_AGAIN, RoomPhase.RESULT).allowed
        assert not decide(Action.PLAY_AGAIN, RoomPhase.WAITING).allowed

    def test_결과에_도착한_게임_입력은_버린다(self):
        assert decide(Action.GAME_ACTION, RoomPhase.RESULT).outcome is Outcome.DROP

    def test_방장_이탈은_어느_상태에서도_폐기로_간다(self):
        for p in (RoomPhase.WAITING, RoomPhase.PLAYING, RoomPhase.RESULT):
            assert decide(Action.HOST_LEAVE, p).allowed
            assert decide(Action.HOST_TIMEOUT, p).allowed

    def test_진행_중에는_만료가_발화하지_않는다(self):
        """진행·결과에서는 만료 타이머가 멈춰 있다."""
        assert decide(Action.EXPIRED, RoomPhase.WAITING).allowed
        assert decide(Action.EXPIRED, RoomPhase.PLAYING).outcome is Outcome.IGNORE
        assert decide(Action.EXPIRED, RoomPhase.RESULT).outcome is Outcome.IGNORE

    def test_재기동은_어느_상태에서도_지운다(self):
        for p in (RoomPhase.WAITING, RoomPhase.PLAYING, RoomPhase.RESULT):
            assert decide(Action.RESTART, p).allowed


class TestEnsure:
    def test_허용이면_통과한다(self):
        ensure(Action.CHAT, RoomPhase.PLAYING)

    def test_거부는_그_코드로_올라온다(self):
        with pytest.raises(errors.DomainError) as exc:
            ensure(Action.KICK, RoomPhase.PLAYING)
        assert exc.value.spec.code == "game.invalid_action"

    def test_폐기된_방은_room_not_found다(self):
        with pytest.raises(errors.DomainError) as exc:
            ensure(Action.CHAT, RoomPhase.DISCARDED)
        assert exc.value.spec.code == "room.not_found"
