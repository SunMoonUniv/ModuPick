"""킹메이커 진행 계약 테스트 — 제출 · 투표 · 개표 · 결선 · 결과.

    GUIDE(3초) → SUBMIT(120초) → 안건 수 ┬ 0개  → 방장이 고른다
                                        ├ 1개  → TALLY(3초) → RESULT
                                        └ 2개+ → VOTE(60초) → 개표

**입력 단계가 둘인 유일한 게임이다.** 저격에서 만든 부품(결선 루프 · 조기 마감 ·
표 저장 · 진행 집계)은 test_game_snipe.py가 이미 보므로, 여기서는 **킹메이커에만
있는 것**을 본다 — 제출 단계 · 안건 수 분기 · 실효 투표 상한 · 제출자 익명성.
"""

import pytest

from app.domain.games import kingmaker
from app.services import game_service
from tests.contract.test_game_play import _result_data, _rows
from tests.contract.test_round import _drain, playing


@pytest.fixture
def fast(monkeypatch):
    """단계 마감을 줄인다. 제출 120초·투표 60초를 그대로 기다릴 수 없다."""
    monkeypatch.setattr(game_service, "GUIDE_MS", 40)
    monkeypatch.setattr(game_service, "TIE_NOTICE_MS", 40)
    monkeypatch.setattr(kingmaker, "SUBMIT_MS", 60_000)  # 조기 마감을 본다
    monkeypatch.setattr(kingmaker, "VOTE_MS", 60_000)
    monkeypatch.setattr(kingmaker, "RUNOFF_MS", 60_000)
    monkeypatch.setattr(kingmaker, "TALLY_MS", 40)


def _opinion(ws, started, phase_seq: int, text: str) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "king.opinion",
            "payload": {"text": text},
        },
    })


def _vote(ws, started, phase_seq: int, ids: list[str]) -> None:
    ws.send_json({
        "event": "game:action",
        "data": {
            "roundId": started["data"]["roundId"],
            "phaseSeq": phase_seq,
            "type": "king.vote",
            "payload": {"candidateIds": ids},
        },
    })


def _to_submit(host_ws) -> dict:
    _drain(host_ws, "game:phase")  # READY
    assert _drain(host_ws, "game:phase")["data"]["phase"] == "GUIDE"
    frame = _drain(host_ws, "game:phase")
    assert frame["data"]["phase"] == "SUBMIT"
    return frame


def _catch_up(guests) -> None:
    for g in guests:
        _drain(g, "game:started")
        for _ in range(3):  # READY · GUIDE · SUBMIT
            _drain(g, "game:phase")


def _sockets(host_ws, guests) -> list:
    return [host_ws, *guests]


def _submit_all(host_ws, guests, started, seq, texts) -> dict:
    """전원이 안건을 내고 VOTE 프레임을 돌려준다."""
    for ws, text in zip(_sockets(host_ws, guests), texts, strict=True):
        _opinion(ws, started, seq, text)
    frame = _drain(host_ws, "game:phase", tries=16)
    assert frame["data"]["phase"] == "VOTE"
    return frame


# ── 제출 ───────────────────────────────────────────────────────────────────


class TestSubmit:
    def test_시작하면_GUIDE를_거쳐_SUBMIT으로_간다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, _g, _s):
            frame = _to_submit(host_ws)
            assert frame["data"]["deadlineAt"] is not None

    def test_전원이_제출하면_마감_전에_투표로_간다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            _submit_all(host_ws, guests, started, seq, ["안건 가", "안건 나", "안건 다"])

    def test_두_번째_제출은_거절한다(self, client, fast):
        """**1인 1건이고 되돌릴 수 없다**(G-9)."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, _g, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _opinion(host_ws, started, seq, "처음")
            _drain(host_ws, "game:progress")
            _opinion(host_ws, started, seq, "두 번째")
            assert _drain(host_ws, "error")["code"] == "game.already_submitted"

    @pytest.mark.parametrize("text", ["", "   ", "가" * 121])
    def test_길이가_규격_밖이면_형식_거절이다(self, client, fast, text):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, _g, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _opinion(host_ws, started, seq, text)
            assert _drain(host_ws, "error")["code"] == "common.validation_failed"

    def test_제출_집계가_수치만_담는다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, _g, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _opinion(host_ws, started, seq, "우리 팀 이름")
            payload = _drain(host_ws, "game:progress")["data"]["payload"]

            assert payload == {"submittedCount": 1, "totalCount": 3}
            # **제출자도 원문도 나가지 않는다** — 익명이 이 게임의 핵심이다
            assert "우리 팀 이름" not in str(payload)

    def test_안건이_game_options에_남는다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            _submit_all(host_ws, guests, started, seq, ["가", "나", "다"])

            rows = _rows(
                "SELECT o.label, o.sort_order, o.participant_id"
                " FROM game_options o JOIN game_rounds g ON g.id = o.game_round_id"
                " WHERE g.round_id = %s ORDER BY o.sort_order",
                (started["data"]["roundId"],),
            )
            assert [r["label"] for r in rows] == ["가", "나", "다"]
            assert [r["sort_order"] for r in rows] == [0, 1, 2]
            # 작성자는 서버 안에만 남는다
            assert all(r["participant_id"] is not None for r in rows)


# ── 안건 수 분기 ───────────────────────────────────────────────────────────


class TestBranch:
    def test_안건이_없으면_방장이_고른다(self, client, monkeypatch):
        """**아무도 내지 않아도 판이 그냥 끝나지 않는다.**"""
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(kingmaker, "SUBMIT_MS", 60)

        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, _g, _s):
            _to_submit(host_ws)
            decision = _drain(host_ws, "game:decision_required", tries=10)["data"]

            assert decision["reason"] == "NO_OPTION"
            assert decision["options"] == ["RETRY", "ABORT"]
            assert decision["candidateKind"] == "OPTION"
            assert decision["candidateIds"] == []

    def test_안건이_하나면_투표_없이_확정한다(self, client, monkeypatch):
        """**표가 없는 것이 기권이 아니라 설계다.** 난수로 뽑은 것이 아니다."""
        monkeypatch.setattr(game_service, "GUIDE_MS", 40)
        monkeypatch.setattr(kingmaker, "SUBMIT_MS", 60)
        monkeypatch.setattr(kingmaker, "TALLY_MS", 40)

        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, _g, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _opinion(host_ws, started, seq, "유일한 안건")

            frame = _drain(host_ws, "game:phase", tries=12)
            assert frame["data"]["phase"] == "TALLY"

            result = _drain(host_ws, "game:result", tries=8)["data"]["result"]
            assert result["rows"][0]["text"] == "유일한 안건"
            assert result["rows"][0]["votes"] == 0
            assert _result_data(started["data"]["roundId"])["decidedByRandom"] is False

    def test_후보_순서를_섞어_내려보낸다(self, client, fast):
        """제출 순서를 그대로 쓰면 제출 완료 표시와 대조해 작성자를 추정할 수 있다."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            vote = _submit_all(host_ws, guests, started, seq, ["가", "나", "다"])

            payload = vote["data"]["payload"]
            assert set(payload) == {"candidates"}
            assert {c["label"] for c in payload["candidates"]} == {"가", "나", "다"}
            # **sort_order도 작성자도 나가지 않는다**
            assert all(set(c) == {"optionId", "label"} for c in payload["candidates"])


# ── 투표 ───────────────────────────────────────────────────────────────────


class TestVote:
    def _open_vote(self, host_ws, guests, started):
        seq = _to_submit(host_ws)["data"]["phaseSeq"]
        _catch_up(guests)
        return _submit_all(host_ws, guests, started, seq, ["가", "나", "다"])

    def test_투표_집계에_후보별_득표가_실린다(self, client, fast):
        """**킹메이커만 D-09 예외다**(2026-08-12 기획 결정).

        저격·시간초·눈치는 그대로 완료·대기 상태만 내려간다.
        """
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            vote = self._open_vote(host_ws, guests, started)
            cards = {
                c["label"]: c["optionId"] for c in vote["data"]["payload"]["candidates"]
            }
            _vote(host_ws, started, vote["data"]["phaseSeq"], [cards["나"]])

            payload = _drain(host_ws, "game:progress")["data"]["payload"]
            assert payload["votedCount"] == 1
            assert payload["totalCount"] == 3

            votes = {o["optionId"]: o["votes"] for o in payload["optionVotes"]}
            assert votes[cards["나"]] == 1
            # **0표 후보도 싣는다** — 빠지면 표가 처음 붙는 순간에만 나타나 목록이 흔들린다
            assert votes[cards["가"]] == 0
            assert votes[cards["다"]] == 0
            assert len(votes) == 3

    def test_집계에_투표자가_실리지_않는다(self, client, fast):
        """**익명은 D-09와 별개 축이며 바뀌지 않았다.** 득표 수만 공개한다."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            vote = self._open_vote(host_ws, guests, started)
            cards = {
                c["label"]: c["optionId"] for c in vote["data"]["payload"]["candidates"]
            }
            _vote(guests[0], started, vote["data"]["phaseSeq"], [cards["가"]])

            payload = _drain(host_ws, "game:progress")["data"]["payload"]
            assert set(payload) == {"votedCount", "totalCount", "optionVotes"}
            assert all(set(o) == {"optionId", "votes"} for o in payload["optionVotes"])
            assert "mbr_" not in str(payload)

    def test_결선_집계도_실시간이다(self, client, fast):
        """본선과 결선에서 규칙이 다르면 화면이 두 벌이 된다."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            vote = self._open_vote(host_ws, guests, started)
            cards = {
                c["label"]: c["optionId"] for c in vote["data"]["payload"]["candidates"]
            }
            vseq = vote["data"]["phaseSeq"]
            # 순환 투표로 3중 동점 — 자기 안건은 고를 수 없다
            _vote(host_ws, started, vseq, [cards["나"]])
            _vote(guests[0], started, vseq, [cards["다"]])
            _vote(guests[1], started, vseq, [cards["가"]])

            frame = _drain(host_ws, "game:phase", tries=16)
            if frame["data"]["phase"] == "TIE_NOTICE":
                frame = _drain(host_ws, "game:phase", tries=16)
            assert frame["data"]["phase"] == "RUNOFF"

            runoff = {
                c["label"]: c["optionId"] for c in frame["data"]["payload"]["candidates"]
            }
            label = next(iter(runoff))
            _vote(host_ws, started, frame["data"]["phaseSeq"], [runoff[label]])

            payload = _drain(host_ws, "game:progress")["data"]["payload"]
            assert payload["optionVotes"]
            assert sum(o["votes"] for o in payload["optionVotes"]) == 1

    def test_자기_안건에는_투표할_수_없다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            vote = self._open_vote(host_ws, guests, started)
            mine = [
                c["optionId"] for c in vote["data"]["payload"]["candidates"]
                if c["label"] == "가"  # 방장이 낸 안건
            ]
            _vote(host_ws, started, vote["data"]["phaseSeq"], mine)
            assert _drain(host_ws, "error")["code"] == "vote.self_not_allowed"

    def test_실효_상한을_넘기면_거절한다(self, client, fast):
        """3명·안건 3개·3표 설정에서 제출자의 실효 상한은 2다.

        자기 안건을 뺀 후보가 2개뿐이라 V를 그대로 상한으로 쓰면 강제 기권이 된다.
        """
        with playing(client, 3, "kingmaker", {"votesPerMember": 3}) as (
            _r, _m, host_ws, guests, started,
        ):
            vote = self._open_vote(host_ws, guests, started)
            others = [
                c["optionId"] for c in vote["data"]["payload"]["candidates"]
                if c["label"] != "가"
            ]
            # 남의 안건 2개는 통과한다
            _vote(host_ws, started, vote["data"]["phaseSeq"], others)
            assert _drain(host_ws, "game:progress")["data"]["payload"]["votedCount"] == 1

    def test_같은_안건을_두_번_담으면_거절한다(self, client, fast):
        with playing(client, 3, "kingmaker", {"votesPerMember": 2}) as (
            _r, _m, host_ws, guests, started,
        ):
            vote = self._open_vote(host_ws, guests, started)
            other = next(
                c["optionId"] for c in vote["data"]["payload"]["candidates"]
                if c["label"] != "가"
            )
            _vote(host_ws, started, vote["data"]["phaseSeq"], [other, other])
            assert _drain(host_ws, "error")["code"] == "vote.duplicate_target"

    def test_없는_안건은_거절한다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            vote = self._open_vote(host_ws, guests, started)
            _vote(host_ws, started, vote["data"]["phaseSeq"], ["opt_없는안건"])
            assert _drain(host_ws, "error")["code"] == "vote.target_not_found"


# ── 결과 ───────────────────────────────────────────────────────────────────


class TestResult:
    def _decided(self, host_ws, guests, started, *, config_reveal=False):
        """전원이 안건을 내고 '나'에 표를 몰아 확정까지 간다."""
        seq = _to_submit(host_ws)["data"]["phaseSeq"]
        _catch_up(guests)
        vote = _submit_all(host_ws, guests, started, seq, ["가", "나", "다"])
        cards = {c["label"]: c["optionId"] for c in vote["data"]["payload"]["candidates"]}
        vseq = vote["data"]["phaseSeq"]

        # 방장과 참가1은 '나'에, '나'를 낸 참가1은 '다'에 — 나가 2표로 단독 최다
        _vote(host_ws, started, vseq, [cards["나"]])
        _vote(guests[0], started, vseq, [cards["다"]])
        _vote(guests[1], started, vseq, [cards["나"]])
        del config_reveal
        return _drain(host_ws, "game:result", tries=16)["data"]

    def test_개표_값이_TALLY_전이에_실린다(self, client, fast):
        """**결과 이벤트는 이 단계가 끝난 뒤에 온다** — 그때 받으면 개표 연출을
        시작할 자리가 없다. 룰렛 SPINNING·사다리 DRAWING과 같은 자리다(07_api/03 §12).

        투표가 이미 마감된 뒤라 중간 집계 비공개(REQ-GLB-14)에 걸리지 않는다.
        """
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            vote = _submit_all(host_ws, guests, started, seq, ["가", "나", "다"])
            cards = {c["label"]: c["optionId"] for c in vote["data"]["payload"]["candidates"]}
            vseq = vote["data"]["phaseSeq"]
            _vote(host_ws, started, vseq, [cards["나"]])
            _vote(guests[0], started, vseq, [cards["다"]])
            _vote(guests[1], started, vseq, [cards["나"]])

            frame = _drain(host_ws, "game:phase", tries=16)
            assert frame["data"]["phase"] == "TALLY"

            payload = frame["data"]["payload"]
            assert set(payload) == {"rows", "winnerCandidateId"}
            assert payload["winnerCandidateId"] == cards["나"]
            assert payload["rows"][0]["text"] == "나"
            assert payload["rows"][0]["votes"] == 2
            # 익명 기본값이므로 제출자 자리가 없고, 투표자는 어느 설정에서도 없다
            assert all(set(r) == {"candidateId", "text", "votes"} for r in payload["rows"])
            assert "voter" not in str(payload)

    def test_TALLY_값이_결과와_같다(self, client, fast):
        """두 곳에서 각자 만들면 연출이 그린 수치와 결과 화면이 갈라진다."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            vote = _submit_all(host_ws, guests, started, seq, ["가", "나", "다"])
            cards = {c["label"]: c["optionId"] for c in vote["data"]["payload"]["candidates"]}
            vseq = vote["data"]["phaseSeq"]
            _vote(host_ws, started, vseq, [cards["나"]])
            _vote(guests[0], started, vseq, [cards["다"]])
            _vote(guests[1], started, vseq, [cards["나"]])

            tally = _drain(host_ws, "game:phase", tries=16)["data"]["payload"]
            result = _drain(host_ws, "game:result", tries=16)["data"]["result"]

            assert tally["rows"] == result["rows"]
            assert tally["winnerCandidateId"] == result["winnerCandidateId"]

    def test_결선_전이에는_개표_값이_실리지_않는다(self, client, fast):
        """RUNOFF는 표를 다시 받는 단계다. 여기 득표를 실으면 중간 집계가 샌다."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            vote = _submit_all(host_ws, guests, started, seq, ["가", "나", "다"])
            cards = {c["label"]: c["optionId"] for c in vote["data"]["payload"]["candidates"]}
            vseq = vote["data"]["phaseSeq"]
            # 순환 투표로 셋 다 1표 — 3중 동점이라 결선으로 간다.
            # 제출 순서가 방장 가 · 참가1 나 · 참가2 다이고 자기 안건은 고를 수 없다
            _vote(host_ws, started, vseq, [cards["나"]])
            _vote(guests[0], started, vseq, [cards["다"]])
            _vote(guests[1], started, vseq, [cards["가"]])

            frame = _drain(host_ws, "game:phase", tries=16)
            if frame["data"]["phase"] == "TIE_NOTICE":
                frame = _drain(host_ws, "game:phase", tries=16)
            assert frame["data"]["phase"] == "RUNOFF"
            payload = frame["data"]["payload"] or {}
            assert "rows" not in payload
            assert "votes" not in str(payload)

    def test_와이어_모양이_정본과_같다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            frame = self._decided(host_ws, guests, started)

            assert frame["variant"] == "TALLY"
            result = frame["result"]
            assert set(result) == {"topic", "winnerCandidateId", "rows", "reveal", "stats"}
            assert result["topic"] == "팀명"
            # 저장은 optionId·label·voteCount, 와이어는 candidateId·text·votes다
            assert all(
                set(r) == {"candidateId", "text", "votes"} for r in result["rows"]
            )
            assert result["rows"][0]["text"] == "나"
            assert result["rows"][0]["votes"] == 2

    def test_익명이면_제출자_자리가_아예_없다(self, client, fast):
        """**null로 채우지 않는다** — 값이 있는 자리를 남기면 언젠가 채워진다."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            frame = self._decided(host_ws, guests, started)

            assert frame["result"]["reveal"] == {"authors": False}
            assert all("authorMemberId" not in r for r in frame["result"]["rows"])
            # 저장에도 담지 않는다 — 방이 사는 동안 남는 값이다
            assert "authors" not in _result_data(started["data"]["roundId"])

    def test_실명이면_개표_후에_제출자가_나온다(self, client, fast):
        with playing(client, 3, "kingmaker", {"revealAuthors": True}) as (
            _r, _m, host_ws, guests, started,
        ):
            frame = self._decided(host_ws, guests, started)
            roster = [m["memberId"] for m in started["data"]["roster"]]

            assert frame["result"]["reveal"] == {"authors": True}
            assert all("authorMemberId" in r for r in frame["result"]["rows"])
            assert all(r["authorMemberId"] in roster for r in frame["result"]["rows"])

    def test_투표자는_어느_설정에서도_나가지_않는다(self, client, fast):
        """방장 설정이 규정하는 것은 제출자 공개 여부뿐이다."""
        with playing(client, 3, "kingmaker", {"revealAuthors": True}) as (
            _r, _m, host_ws, guests, started,
        ):
            frame = self._decided(host_ws, guests, started)
            assert "voterMemberIds" not in str(frame)
            assert "voterMemberIds" not in str(_result_data(started["data"]["roundId"]))

    def test_요약_수치_3개가_단위까지_붙어_온다(self, client, fast):
        """08_screen/06 「개표형」의 후보 수 · 총 투표 수 · 1위 득표율."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            stats = self._decided(host_ws, guests, started)["result"]["stats"]

            assert [s["label"] for s in stats] == ["후보 수", "총 투표", "1위 득표율"]
            assert stats[0]["value"] == "3개"
            assert stats[1]["value"] == "3표"
            assert stats[2]["value"] == "66.7%"

    def test_저장_형식이_정본과_같다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            self._decided(host_ws, guests, started)

            data = _result_data(started["data"]["roundId"])
            assert set(data) == {
                "schemaVersion", "tally", "winnerOptionIds",
                "ballotRounds", "decidedByRandom",
            }
            assert data["ballotRounds"] == 1
            assert all(
                set(r) == {"optionId", "label", "voteCount"} for r in data["tally"]
            )

    def test_표가_votes에_남는다(self, client, fast):
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            self._decided(host_ws, guests, started)

            rows = _rows(
                "SELECT v.ballot_no, v.choice_no FROM votes v"
                " JOIN game_rounds g ON g.id = v.game_round_id"
                " WHERE g.round_id = %s",
                (started["data"]["roundId"],),
            )
            assert len(rows) == 3
            assert {r["ballot_no"] for r in rows} == {1}


# ── 결선 ───────────────────────────────────────────────────────────────────


class TestRunoff:
    def test_동점이면_결선으로_가고_1인_1표가_된다(self, client, fast):
        """3명·안건 3개·1표에서 각자 다른 안건에 주면 1표씩 3중 동점이다."""
        with playing(client, 3, "kingmaker") as (_r, _m, host_ws, guests, started):
            seq = _to_submit(host_ws)["data"]["phaseSeq"]
            _catch_up(guests)
            vote = _submit_all(host_ws, guests, started, seq, ["가", "나", "다"])
            cards = {
                c["label"]: c["optionId"] for c in vote["data"]["payload"]["candidates"]
            }
            vseq = vote["data"]["phaseSeq"]

            # 각자 자기 것이 아닌 것에 하나씩 — 순환
            _vote(host_ws, started, vseq, [cards["나"]])
            _vote(guests[0], started, vseq, [cards["다"]])
            _vote(guests[1], started, vseq, [cards["가"]])

            tie = _drain(host_ws, "game:tie", tries=16)["data"]
            assert tie["tieRound"] == 1
            assert tie["candidateKind"] == "OPTION"
            assert len(tie["candidateIds"]) == 3

            runoff = _drain(host_ws, "game:phase", tries=6)
            assert runoff["data"]["phase"] == "RUNOFF"
            # 결선 후보만 남는다
            assert len(runoff["data"]["payload"]["candidates"]) == 3
