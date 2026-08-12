"""익명 저격 진행 계약 테스트 — 지목 · 개표 · 결선 · 교착 · 결과.

    GUIDE(3초) → VOTE(설정) → 개표 ┬ 확정 → REVEAL(3초) → RESULT
                                  ├ 동점 → TIE_NOTICE(3초) → RUNOFF(절반) → 개표
                                  └ 교착 → DEADLOCK — 방장이 고른다

**투표형 게임의 첫 계약이다.** 여기서 처음 검증하는 것 넷 — 진행 집계(game:progress) ·
결선 루프(game:tie) · 교착 탈출(game:decision_required · game:decide) · 표 저장(votes).

익명성 검사를 함께 둔다. 지목자가 새는 경로는 진행 집계 · 결과 · 저장 셋인데
**어느 쪽에도 나가지 않아야 한다.**
"""

import pytest

from app.domain.games import snipe
from app.services import game_service
from tests.contract.test_game_play import _result_data, _rows
from tests.contract.test_round import _drain, playing


@pytest.fixture
def fast(monkeypatch):
    """연출 길이를 줄인다. 마감은 설정값이라 테스트마다 config로 준다."""
    monkeypatch.setattr(game_service, "GUIDE_MS", 40)
    monkeypatch.setattr(game_service, "REVEAL_MS", 40)
    monkeypatch.setattr(game_service, "TIE_NOTICE_MS", 40)
    monkeypatch.setattr(snipe, "MIN_RUNOFF_MS", 40)


def _vote(ws, started, phase_seq: int, targets: list[str]) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "snipe.vote",
            "payload": {"targetMemberIds": targets},
        },
    })


def _decide(ws, started, phase_seq: int, choice: str) -> None:
    ws.send_json({
        "event": "game:decide",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "choice": choice,
        },
    })


def _to_vote(host_ws) -> dict:
    """READY → GUIDE → VOTE까지 흘려보내고 VOTE 프레임을 돌려준다."""
    _drain(host_ws, "game:phase")  # READY
    assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
    frame = _drain(host_ws, "game:phase")
    assert frame["data"]["phase"] == "VOTE"
    return frame


def _members(started) -> list[str]:
    return [m["memberId"] for m in started["data"]["roster"]]


def _sockets(host_ws, guests) -> list:
    """명단 순서와 같은 소켓 배열. roster[0]이 방장이다."""
    return [host_ws, *guests]


def _catch_up(guests) -> None:
    """참여자 소켓을 VOTE 단계까지 흘려보낸다."""
    for g in guests:
        _drain(g, "game:started")
        for _ in range(3):  # READY · GUIDE · VOTE
            _drain(g, "game:phase")


# ── 자동 전이 ──────────────────────────────────────────────────────────────


class TestAutoPhases:
    def test_시작하면_GUIDE를_거쳐_VOTE로_간다(self, client, fast):
        with playing(client, 3, "snipe") as (_r, _m, host_ws, _g, _s):
            _drain(host_ws, "game:phase")  # READY
            assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
            vote = _drain(host_ws, "game:phase")
            assert vote["data"]["phase"] == "VOTE"
            assert vote["data"]["deadlineAt"] is not None


# ── 지목 접수 ──────────────────────────────────────────────────────────────


class TestBallot:
    def test_자기_지목은_거절한다(self, client, fast):
        with playing(client, 3, "snipe") as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _vote(host_ws, started, seq, [_members(started)[0]])
            assert _drain(host_ws, "error")["code"] == "vote.self_not_allowed"

    def test_명단_밖_대상은_거절한다(self, client, fast):
        with playing(client, 3, "snipe") as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _vote(host_ws, started, seq, ["mbr_없는사람"])
            assert _drain(host_ws, "error")["code"] == "vote.target_not_found"

    def test_같은_대상을_두_번_담으면_거절한다(self, client, fast):
        with playing(client, 5, "snipe", {"multiVote": True}) as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            target = _members(started)[1]
            _vote(host_ws, started, seq, [target, target])
            assert _drain(host_ws, "error")["code"] == "vote.duplicate_target"

    def test_상한을_넘기면_거절한다(self, client, fast):
        """5명방 중복 투표 상한은 2다 — 후보 4명의 절반."""
        with playing(client, 5, "snipe", {"multiVote": True}) as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            others = _members(started)[1:4]
            _vote(host_ws, started, seq, others)  # 3명 지목
            assert _drain(host_ws, "error")["code"] == "vote.limit_exceeded"

    def test_중복_투표가_꺼져_있으면_상한이_1이다(self, client, fast):
        with playing(client, 5, "snipe") as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _vote(host_ws, started, seq, _members(started)[1:3])
            assert _drain(host_ws, "error")["code"] == "vote.limit_exceeded"

    def test_두_번째_지목은_거절한다(self, client, fast):
        """**한 번의 제출로 확정하고 수정을 허용하지 않는다**(G-9)."""
        with playing(client, 3, "snipe") as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            members = _members(started)
            _vote(host_ws, started, seq, [members[1]])
            _drain(host_ws, "game:progress")
            _vote(host_ws, started, seq, [members[2]])
            assert _drain(host_ws, "error")["code"] == "game.already_submitted"

    def test_페이로드가_없으면_형식_거절이다(self, client, fast):
        with playing(client, 3, "snipe") as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            host_ws.send_json({
                "event": "game:action",
                "data": {
                    "roundId": started["data"]["roundId"],
                    "phaseSeq": seq,
                    "type": "snipe.vote",
                },
            })
            assert _drain(host_ws, "error")["code"] == "common.validation_failed"


# ── 진행 집계 ──────────────────────────────────────────────────────────────


class TestProgress:
    def test_지목이_도착할_때마다_집계가_나간다(self, client, fast):
        with playing(client, 3, "snipe") as (_r, _m, host_ws, guests, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _vote(host_ws, started, seq, [_members(started)[1]])

            frame = _drain(host_ws, "game:progress")
            assert frame["data"]["payload"] == {"votedCount": 1, "totalCount": 3}
            assert frame["data"]["phaseSeq"] == seq
            del guests

    def test_집계에_지목_내용이_실리지_않는다(self, client, fast):
        """**누가 무엇을 골랐는지는 어떤 경우에도 넣지 않는다**(07_api/03 §14)."""
        with playing(client, 3, "snipe") as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _vote(host_ws, started, seq, [_members(started)[1]])
            payload = _drain(host_ws, "game:progress")["data"]["payload"]

            assert set(payload) == {"votedCount", "totalCount"}
            assert "mbr_" not in str(payload)


# ── 개표 ───────────────────────────────────────────────────────────────────


class TestTally:
    def test_전원이_투표하면_마감_전에_개표한다(self, client, fast):
        """**더 올 표가 없으면 기다리지 않는다.** 투표 시간을 60초로 두고 본다."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)

            # 전원이 roster[1]을 지목한다 — 단독 최다
            for i, ws in enumerate(_sockets(host_ws, guests)):
                _vote(ws, started, seq, [members[2] if i == 1 else members[1]])

            assert _drain(host_ws, "game:phase", tries=12)["data"]["phase"] == "REVEAL"

    def test_단독_최다가_승자다(self, client, fast):
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)

            for i, ws in enumerate(_sockets(host_ws, guests)):
                _vote(ws, started, seq, [members[2] if i == 1 else members[1]])

            result = _drain(host_ws, "game:result", tries=14)["data"]
            assert result["variant"] == "WINNER"
            assert result["result"]["winnerMemberId"] == members[1]
            assert result["result"]["detail"]["randomFallback"] is False

    def test_전원_기권이면_난수로_확정한다(self, client, monkeypatch):
        """**정렬 첫 번째를 승자로 삼지 않는다** — 명단 순서를 아는 참가자에게
        결과가 예측되면 공정성 결함이다."""
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(game_service, "REVEAL_MS", 40)

        with playing(client, 3, "snipe", {"voteSeconds": 5}) as (_r, _m, host_ws, _g, started):
            _to_vote(host_ws)
            # 아무도 투표하지 않고 마감을 기다린다
            result = _drain(host_ws, "game:result", tries=20)["data"]["result"]

            assert result["winnerMemberId"] in _members(started)
            assert result["detail"]["randomFallback"] is True
            assert result["detail"]["abstainCount"] == 3


# ── 결선 ───────────────────────────────────────────────────────────────────


class TestRunoff:
    def test_동점이면_game_tie가_나가고_RUNOFF로_간다(self, client, fast):
        """3명 순환 지목 — A→B, B→C, C→A로 전원 1표 3중 동점이다."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)
            sockets = _sockets(host_ws, guests)

            for i, ws in enumerate(sockets):
                _vote(ws, started, seq, [members[(i + 1) % 3]])

            tie = _drain(host_ws, "game:tie", tries=14)["data"]
            assert tie["tieRound"] == 1
            assert tie["tieRoundMax"] == 3
            assert tie["candidateKind"] == "MEMBER"
            assert sorted(tie["candidateIds"]) == sorted(members)

            # TIE_NOTICE를 거쳐 결선으로 간다
            assert _drain(host_ws, "game:phase", tries=6)["data"]["phase"] == "RUNOFF"

    def test_동점_통지에_피격_수가_실리지_않는다(self, client, fast):
        """**득표 수는 아직 감춘다**(G-10) — 다음 회차의 전략이 된다."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)

            for i, ws in enumerate(_sockets(host_ws, guests)):
                _vote(ws, started, seq, [members[(i + 1) % 3]])

            tie = _drain(host_ws, "game:tie", tries=14)["data"]
            assert "tally" not in tie
            assert "hitCount" not in str(tie)

    def test_결선_3회를_소진하면_교착이다(self, client, fast):
        """순환 지목을 네 번 반복한다 — 본선 1 + 결선 3."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            members = _members(started)
            sockets = _sockets(host_ws, guests)

            for _round in range(4):
                for i, ws in enumerate(sockets):
                    _vote(ws, started, seq, [members[(i + 1) % 3]])
                frame = _drain(host_ws, "game:phase", tries=16)
                if frame["data"]["phase"] == "DEADLOCK":
                    break
                assert frame["data"]["phase"] == "TIE_NOTICE"
                seq = _drain(host_ws, "game:phase", tries=6)["data"]["phaseSeq"]

            decision = _drain(host_ws, "game:decision_required", tries=6)["data"]
            assert decision["reason"] == "TIE_EXHAUSTED"
            assert decision["options"] == ["RETRY", "ABORT"]
            assert decision["candidateKind"] == "MEMBER"
            assert decision["deadlineAt"] is not None


# ── 교착 해소 ──────────────────────────────────────────────────────────────


class TestDecide:
    def _deadlock(self, host_ws, guests, started):
        """순환 지목 4회로 교착을 만든다. 마지막 phaseSeq를 돌려준다."""
        seq = _to_vote(host_ws)["data"]["phaseSeq"]
        _catch_up(guests)
        members = _members(started)
        sockets = _sockets(host_ws, guests)

        for _round in range(4):
            for i, ws in enumerate(sockets):
                _vote(ws, started, seq, [members[(i + 1) % 3]])
            frame = _drain(host_ws, "game:phase", tries=16)
            if frame["data"]["phase"] == "DEADLOCK":
                return frame["data"]["phaseSeq"]
            seq = _drain(host_ws, "game:phase", tries=6)["data"]["phaseSeq"]
        raise AssertionError("교착에 이르지 못했다")

    def test_참여자는_결정할_수_없다(self, client, fast):
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = self._deadlock(host_ws, guests, started)
            _decide(guests[0], started, seq, "ABORT")
            # 결선 네 회차를 도는 동안 참여자 소켓에 phase·progress·tie가 쌓여 있다
            assert _drain(guests[0], "error", tries=60)["code"] == "member.not_host"

    def test_options_밖의_값은_거절한다(self, client, fast):
        """**RANDOM과 PICK은 두지 않는다** — 05_game_rules/01_common.md."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = self._deadlock(host_ws, guests, started)
            _decide(host_ws, started, seq, "RANDOM")
            assert _drain(host_ws, "error")["code"] == "game.invalid_action"

    def test_ABORT는_결과_없이_대기방으로_보낸다(self, client, fast):
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = self._deadlock(host_ws, guests, started)
            _decide(host_ws, started, seq, "ABORT")

            closed = _drain(host_ws, "round:closed", tries=6)["data"]
            assert closed["roomStatus"] == "WAITING"
            assert _result_data(started["data"]["roundId"]) is None

    def test_RETRY는_본선을_다시_연다(self, client, fast):
        """**회차 카운터가 0으로 돌아가고 가이드는 띄우지 않는다**(G-4)."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            seq = self._deadlock(host_ws, guests, started)
            _decide(host_ws, started, seq, "RETRY")

            frame = _drain(host_ws, "game:phase", tries=6)
            assert frame["data"]["phase"] == "VOTE"
            assert frame["data"]["tieRound"] == 0

            # 지난 회차의 표가 남아 있으면 uq_votes_ballot에 걸려 아무도 못 낸다
            _vote(host_ws, started, frame["data"]["phaseSeq"], [_members(started)[1]])
            assert _drain(host_ws, "game:progress")["data"]["payload"]["votedCount"] == 1

    def test_요구되지_않은_시점의_결정은_거절한다(self, client, fast):
        with playing(client, 3, "snipe") as (_r, _m, host_ws, _g, started):
            seq = _to_vote(host_ws)["data"]["phaseSeq"]
            _decide(host_ws, started, seq, "ABORT")
            assert _drain(host_ws, "error")["code"] == "game.decision_not_required"


# ── 결과와 저장 ────────────────────────────────────────────────────────────


class TestResult:
    def _decided(self, host_ws, guests, started):
        seq = _to_vote(host_ws)["data"]["phaseSeq"]
        _catch_up(guests)
        members = _members(started)
        for i, ws in enumerate(_sockets(host_ws, guests)):
            _vote(ws, started, seq, [members[2] if i == 1 else members[1]])
        return _drain(host_ws, "game:result", tries=14)["data"]

    def test_와이어_모양이_정본과_같다(self, client, fast):
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            result = self._decided(host_ws, guests, started)["result"]

            assert set(result) == {"topic", "winnerMemberId", "detail", "stats"}
            assert result["topic"] == "발표를 제일 잘할 것 같은 사람은?"
            assert set(result["detail"]) == {"tally", "abstainCount", "randomFallback"}
            # 저장은 hitCount, 와이어는 hits다
            assert all(set(r) == {"memberId", "hits"} for r in result["detail"]["tally"])

    def test_지목자가_어디에도_나가지_않는다(self, client, fast):
        """**조건부가 아니다.** 어떤 설정에서도 담지 않는다."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            frame = self._decided(host_ws, guests, started)
            assert "voterMemberIds" not in str(frame)

            data = _result_data(started["data"]["roundId"])
            assert "voterMemberIds" not in str(data)
            assert "voters" not in str(data)

    def test_요약_수치_3개가_단위까지_붙어_온다(self, client, fast):
        """08_screen/06 「승자형」이 저격에 정한 최다 피격 · 총 지목 · 투표 시간."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            stats = self._decided(host_ws, guests, started)["result"]["stats"]

            assert [s["label"] for s in stats] == ["최다 피격", "총 지목", "투표 시간"]
            assert stats[0]["value"] == "2표"
            assert stats[1]["value"] == "3표"
            assert stats[2]["value"] == "60초"

    def test_저장_형식이_정본과_같다(self, client, fast):
        """06_database/04 「게임별 JSON 스키마」의 저격 행이다."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            self._decided(host_ws, guests, started)

            data = _result_data(started["data"]["roundId"])
            assert set(data) == {
                "schemaVersion", "tally", "winnerMemberIds",
                "ballotRounds", "abstainCount", "decidedByRandom",
            }
            assert data["ballotRounds"] == 1
            assert data["abstainCount"] == 0
            assert all(set(r) == {"memberId", "hitCount"} for r in data["tally"])

    def test_후보가_game_options에_남는다(self, client, fast):
        """06_database/04 「저장 범위」가 저격을 '지목 후보 1인 1행'으로 규정한다."""
        with playing(client, 3, "snipe") as (_r, _m, _host, _g, started):
            rows = _rows(
                "SELECT o.label, o.sort_order, o.participant_id"
                " FROM game_options o JOIN game_rounds g ON g.id = o.game_round_id"
                " WHERE g.round_id = %s ORDER BY o.sort_order",
                (started["data"]["roundId"],),
            )
            assert len(rows) == 3
            assert all(r["participant_id"] is not None for r in rows)

    def test_표가_votes에_남는다(self, client, fast):
        """**초 단위로 마감하는 입력이라 DB에 기록한다**(06_database/04)."""
        with playing(client, 3, "snipe", {"voteSeconds": 60}) as (_r, _m, host_ws, guests, started):
            self._decided(host_ws, guests, started)

            rows = _rows(
                "SELECT v.ballot_no, v.choice_no FROM votes v"
                " JOIN game_rounds g ON g.id = v.game_round_id"
                " WHERE g.round_id = %s",
                (started["data"]["roundId"],),
            )
            assert len(rows) == 3  # 3명이 1표씩
            assert {r["ballot_no"] for r in rows} == {1}  # 본선
            assert {r["choice_no"] for r in rows} == {1}
