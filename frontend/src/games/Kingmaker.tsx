import { useEffect, useMemo, useState } from "react";
import { after, useApp } from "../lib/store";
import {
  Shell,
  ScreenHeader,
  StatusBand,
  FairPill,
  TopBadge,
  ProgressBar,
} from "../components/ui";
import { ModalFrame } from "../components/Modals";
import { ME_ID } from "../lib/data";

/* ============ S-07 킹메이커 (시트 08) ============ */
/* 2단계: ① 익명 의견 제출 (3패널) → ② 서바이벌 투표 (랭킹 + 내 투표) → ③ 확정 */

interface Idea {
  id: number;
  text: string;
  authorId: string;
}

const BOT_IDEAS = [
  "알고리즘 파이터즈",
  "커밋의 요정들",
  "빌드성공 기원단",
  "새벽 세 시의 기적",
  "머지왕 김머지",
];

type Phase = "submit" | "vote" | "confirm";

export function Kingmaker() {
  const st = useApp();
  const members = st.members;
  const n = members.length;

  const [phase, setPhase] = useState<Phase>("submit");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [myText, setMyText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(120); // 제출 2분 (D-28)

  // 투표 상태
  const [candidates, setCandidates] = useState<Idea[]>([]);
  const [votes, setVotes] = useState<Record<number, string[]>>({});
  const [myVote, setMyVote] = useState<number | null>(null);
  const [voteDone, setVoteDone] = useState<Set<string>>(new Set());
  const [voteLeft, setVoteLeft] = useState(60); // 투표 1분 (D-28)
  const [tie, setTie] = useState<Idea[] | null>(null);

  /* ---- 제한 시간 타이머 ---- */
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (phase === "submit") setTimeLeft((t) => Math.max(0, t - 1));
      else if (phase === "vote") setVoteLeft((t) => Math.max(0, t - 1));
    }, 1000);
    return () => window.clearInterval(iv);
  }, [phase]);

  /* ---- 봇 제출 시퀀스 ---- */
  useEffect(() => {
    const bots = members.filter((m) => !m.isMe);
    bots.forEach((b, i) => {
      after(2200 + i * 1900 + Math.random() * 900, () => {
        setIdeas((prev) =>
          prev.some((x) => x.authorId === b.id)
            ? prev
            : [
                ...prev,
                {
                  id: prev.length + 1,
                  text: BOT_IDEAS[i % BOT_IDEAS.length],
                  authorId: b.id,
                },
              ],
        );
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- 전원 제출 → 투표 단계 ---- */
  useEffect(() => {
    if (phase !== "submit" || ideas.length < n) return;
    after(1200, () => {
      const shuffled = [...ideas].sort(() => Math.random() - 0.5);
      setCandidates(shuffled);
      startVoting(shuffled);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideas.length, phase, n]);

  const startVoting = (cands: Idea[], onlyTied = false) => {
    setPhase("vote");
    setVotes({});
    setMyVote(null);
    setVoteDone(new Set());
    setVoteLeft(60);
    setTie(null);
    // 봇 투표 — 자기 의견 제외 (서버 판정, D-21)
    members
      .filter((m) => !m.isMe)
      .forEach((b, i) => {
        after(2500 + i * 1700 + Math.random() * 1200, () => {
          const options = cands.filter((c) => c.authorId !== b.id);
          if (!options.length) return;
          const pick = options[Math.floor(Math.random() * options.length)];
          setVotes((v) => ({ ...v, [pick.id]: [...(v[pick.id] ?? []), b.id] }));
          setVoteDone((s) => new Set(s).add(b.id));
        });
      });
    void onlyTied;
  };

  const submitIdea = () => {
    if (submitted || !myText.trim()) return;
    setSubmitted(true);
    setIdeas((prev) => [
      ...prev,
      { id: prev.length + 1, text: myText.trim(), authorId: ME_ID },
    ]);
  };

  const castVote = () => {
    if (myVote === null || voteDone.has(ME_ID)) return;
    setVotes((v) => ({ ...v, [myVote]: [...(v[myVote] ?? []), ME_ID] }));
    setVoteDone((s) => new Set(s).add(ME_ID));
  };

  /* ---- 전원 투표 → 확정 or 동점 ---- */
  useEffect(() => {
    if (phase !== "vote" || voteDone.size < n) return;
    const tally = candidates.map((c) => ({ c, v: (votes[c.id] ?? []).length }));
    const max = Math.max(...tally.map((t) => t.v));
    const top = tally.filter((t) => t.v === max);
    if (top.length > 1) {
      after(900, () => setTie(top.map((t) => t.c)));
      return;
    }
    setPhase("confirm");
    after(3000, () => {
      const sorted = [...tally].sort((a, b) => b.v - a.v);
      st.finishGame({
        variant: "tally",
        game: "kingmaker",
        purpose: st.settings.topic,
        winnerText: sorted[0].c.text,
        reveal: st.settings.kmReveal,
        rows: sorted.map((t) => ({
          text: t.c.text,
          votes: t.v,
          authorId: t.c.authorId,
          voterIds: votes[t.c.id] ?? [],
        })),
        stats: [
          { label: "후보", value: `${candidates.length}개` },
          {
            label: "총 투표",
            value: `${tally.reduce((a, b) => a + b.v, 0)}표`,
          },
          { label: "공개 방식", value: st.settings.kmReveal },
        ],
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteDone.size, phase]);

  const tallySorted = useMemo(() => {
    const t = candidates.map((c) => ({ c, v: (votes[c.id] ?? []).length }));
    return [...t].sort((a, b) => b.v - a.v);
  }, [candidates, votes]);

  const stepChip = (
    no: number,
    label: string,
    active: boolean,
    done: boolean,
  ) => (
    <span
      className="f-meta"
      style={{
        background: active
          ? "var(--yellow)"
          : done
            ? "var(--green)"
            : "var(--white)",
        border: "3px solid var(--ink)",
        borderRadius: 999,
        padding: "6px 18px",
        fontWeight: 700,
        opacity: active || done ? 1 : 0.55,
      }}
    >
      {done ? "✓" : `${no}`} {label}
    </span>
  );

  return (
    <Shell>
      <div className="content">
        <ScreenHeader
          title="킹메이커"
          en="KINGMAKER"
          sub={`● ${phase === "submit" ? `익명 의견 제출 중 · ${ideas.length} / ${n} 제출` : phase === "vote" ? `익명 투표 중 · 1인 ${st.settings.kmVotes}표` : "팀명 확정!"} · 방 MODU-${st.roomCode}`}
          onGuide={st.reopenGuide}
          right={
            <>
              <TopBadge
                color={
                  st.settings.kmReveal === "익명"
                    ? "var(--lavender)"
                    : "var(--cyan)"
                }
              >
                {st.settings.kmReveal === "익명"
                  ? "🤫 익명 모드"
                  : "👀 실명 모드"}
              </TopBadge>
              <TopBadge color="var(--yellow)">
                ⏱ {phase === "submit" ? `${timeLeft}초` : `${voteLeft}초`}
              </TopBadge>
            </>
          }
        />

        {/* 스텝 표시 3칩 · 중앙 정렬 (시트 08) */}
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 12,
            justifyContent: "center",
          }}
        >
          {stepChip(
            1,
            "익명 의견 제출",
            phase === "submit",
            phase !== "submit",
          )}
          {stepChip(2, "서바이벌 투표", phase === "vote", phase === "confirm")}
          {stepChip(3, "확정", phase === "confirm", false)}
        </div>

        {/* 주제 박스 · 옐로 r12 */}
        <div
          className="f-headline"
          style={{
            marginTop: 14,
            background: "var(--yellow)",
            border: "4px solid var(--ink)",
            borderRadius: 12,
            height: 80,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 24px",
          }}
        >
          이번 주제 🎯 <b>{st.settings.topic}</b> — 우리 팀, 뭐로 할까?
          <span
            className="f-meta"
            style={{ marginLeft: "auto", fontWeight: 700 }}
          >
            제안자도 투표자도 비공개
          </span>
        </div>

        {phase === "submit" ? (
          /* ---- ① 의견 제출: 420 + 869 + 450 ---- */
          <div style={{ display: "flex", gap: 32, marginTop: 20, height: 545 }}>
            <div className="card" style={{ width: 420, padding: 24 }}>
              <div className="f-headline">◆ 제출 현황</div>
              <div className="f-hero" style={{ fontSize: 76, marginTop: 20 }}>
                {ideas.length}{" "}
                <span style={{ fontSize: 40, color: "#9d9aa8" }}>
                  / {n} 제출
                </span>
              </div>
              <div style={{ marginTop: 16 }}>
                <ProgressBar ratio={ideas.length / n} />
              </div>
              <div
                className="f-meta"
                style={{ color: "#6b6878", marginTop: 16 }}
              >
                아직 {n - ideas.length}명이 고민 중이에요.
                <br />
                제출하면 바로 반영됩니다
              </div>
            </div>
            <div
              className="card"
              style={{
                width: 869,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div className="f-headline">◆ 내 의견 제출</div>
              <textarea
                className="field"
                disabled={submitted}
                placeholder="팀 이름을 자유롭게 적어주세요"
                value={myText}
                maxLength={120}
                onChange={(e) => setMyText(e.target.value.slice(0, 120))}
                style={{
                  flex: 1,
                  resize: "none",
                  fontSize: 24,
                  opacity: submitted ? 0.6 : 1,
                }}
              />
              <div
                className="f-meta"
                style={{ color: "#9d9aa8", display: "flex" }}
              >
                <span>🔒 누가 썼는지 아무도 몰라요 · 제출 후 수정 불가</span>
                <span style={{ marginLeft: "auto" }}>
                  {myText.length} / 120
                </span>
              </div>
              <button
                className="btn btn-pink"
                disabled={submitted || !myText.trim()}
                onClick={submitIdea}
                style={{ height: 68 }}
              >
                {submitted
                  ? "✓ 제출 완료 — 수정·취소 불가"
                  : "💡 아이디어 던지기"}
              </button>
            </div>
            <div
              className="card"
              style={{ width: 450, padding: 24, overflow: "hidden" }}
            >
              <div className="f-headline">◆ 익명 아이디어</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginTop: 14,
                }}
              >
                {ideas.map((idea) => (
                  <div
                    key={idea.id}
                    className="f-sub anim-pop"
                    style={{
                      border: "3px solid var(--ink)",
                      borderRadius: 12,
                      padding: "12px 16px",
                      fontWeight: 700,
                      background: "var(--input)",
                    }}
                  >
                    💡 {idea.text}
                  </div>
                ))}
                {Array.from({ length: Math.max(0, n - ideas.length) }).map(
                  (_, i) => (
                    <div
                      key={`ghost-${i}`}
                      className="f-meta"
                      style={{
                        border: "3px dashed #c2bfce",
                        borderRadius: 12,
                        padding: "12px 16px",
                        color: "#9d9aa8",
                        fontWeight: 700,
                      }}
                    >
                      아직 도착 전…
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ---- ② 서바이벌 투표: 랭킹 1221 + 내 투표 550 ---- */
          <div style={{ display: "flex", gap: 32, marginTop: 20, height: 545 }}>
            <div
              className="card"
              style={{ width: 1221, padding: 24, position: "relative" }}
            >
              <div
                className="f-headline"
                style={{ display: "flex", alignItems: "center", gap: 14 }}
              >
                🏆 지금 1위
                <span
                  className="f-btn"
                  style={{
                    background: "var(--pink)",
                    border: "3px solid var(--ink)",
                    borderRadius: 999,
                    padding: "2px 18px",
                    transform: "rotate(-2deg)",
                  }}
                >
                  VOTE!
                </span>
                <span
                  className="f-meta"
                  style={{ color: "#9d9aa8", marginLeft: "auto" }}
                >
                  득표 집계는 공개 · 투표자는 비공개 (US-311)
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  marginTop: 16,
                }}
              >
                {tallySorted.map(({ c, v }, i) => {
                  const maxV = Math.max(1, tallySorted[0].v);
                  return (
                    <div key={c.id}>
                      {/* 컷오프 라인 — ✂ 여기까지 생존 (시트 08) */}
                      {i === 1 && tallySorted[0].v > 0 && (
                        <div
                          className="f-meta"
                          style={{
                            border: "3px dashed var(--pink)",
                            borderRadius: 999,
                            padding: "4px 20px",
                            color: "var(--pink)",
                            fontWeight: 700,
                            textAlign: "center",
                            marginBottom: 12,
                          }}
                        >
                          ✂ 여기까지 생존 — 최다 득표만 확정돼요
                        </div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 14,
                        }}
                      >
                        <span
                          className="f-name"
                          style={{
                            width: 56,
                            textAlign: "center",
                            background:
                              i === 0 && v > 0
                                ? "var(--yellow)"
                                : "var(--input)",
                            border: "3px solid var(--ink)",
                            borderRadius: 10,
                            padding: "4px 0",
                          }}
                        >
                          {i + 1}위
                        </span>
                        <span
                          className="f-sub"
                          style={{ width: 330, fontWeight: 700 }}
                        >
                          {c.text}
                          {c.authorId === ME_ID && (
                            <span
                              className="f-meta"
                              style={{ color: "#9d9aa8" }}
                            >
                              {" "}
                              (내 의견)
                            </span>
                          )}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            height: 30,
                            background: "var(--track)",
                            border: "3px solid var(--ink)",
                            borderRadius: 999,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${(v / maxV) * 100}%`,
                              height: "100%",
                              background:
                                i === 0 && v > 0
                                  ? "var(--green)"
                                  : "var(--cyan)",
                              transition: "width .4s ease",
                            }}
                          />
                        </div>
                        <span
                          className="f-name"
                          style={{ width: 60, textAlign: "right" }}
                        >
                          {v > 0 ? `${v}표` : "0표"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {phase === "confirm" && (
                <div
                  className="f-title anim-pop"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(255,255,255,.88)",
                    borderRadius: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  👑 {tallySorted[0]?.c.text}
                  <span className="f-sub" style={{ color: "#55515f" }}>
                    팀명 확정! 3초 후 결과 화면으로 이동해요
                  </span>
                </div>
              )}
            </div>
            <div
              className="card"
              style={{
                width: 550,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div className="f-headline">
                ◆ 내 투표 · 1인 {st.settings.kmVotes}표
              </div>
              <div
                className="scroll-y"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  flex: 1,
                }}
              >
                {candidates.map((c) => {
                  const isMine = c.authorId === ME_ID;
                  const chosen = myVote === c.id;
                  return (
                    <button
                      key={c.id}
                      disabled={isMine || voteDone.has(ME_ID)}
                      onClick={() => setMyVote(c.id)}
                      className="f-sub"
                      style={{
                        textAlign: "left",
                        border: "3px solid var(--ink)",
                        borderRadius: 12,
                        padding: "12px 16px",
                        fontWeight: 700,
                        background: chosen
                          ? "var(--ink)"
                          : isMine
                            ? "var(--track)"
                            : "var(--white)",
                        color: chosen
                          ? "#fff"
                          : isMine
                            ? "#9d9aa8"
                            : "var(--ink)",
                        flex: "none",
                      }}
                    >
                      {chosen ? "● " : "○ "}
                      {c.text}
                      {isMine && " — 내가 낸 의견"}
                      {chosen && " ✓"}
                    </button>
                  );
                })}
              </div>
              <button
                className="btn btn-ink"
                disabled={myVote === null || voteDone.has(ME_ID)}
                onClick={castVote}
                style={{ height: 64 }}
              >
                {voteDone.has(ME_ID)
                  ? "✓ 투표 완료 — 변경 불가"
                  : "✓ 투표 완료"}
              </button>
            </div>
          </div>
        )}

        <StatusBand
          step={phase === "submit" ? "1" : phase === "vote" ? "2" : "3"}
          title={
            phase === "submit"
              ? "익명 팀명 접수 중…"
              : phase === "vote"
                ? "익명 투표 중…"
                : "팀명 확정!"
          }
          sub={
            phase === "submit"
              ? `${ideas.length} / ${n} 도착 · 제출하면 수정할 수 없어요`
              : phase === "vote"
                ? `${voteDone.size} / ${n} 투표 · 동점이면 동점 후보끼리 재투표`
                : "결과 화면으로 이동합니다"
          }
          right={<FairPill text="누가 뭘 골랐는지 아무도 몰라요" />}
        />
      </div>

      {/* 동점 발생 (C-02) — 동점 후보만 남기고 결선 투표 */}
      {tie && (
        <ModalFrame
          badge="🏁 동점 발생!"
          badgeColor="var(--yellow)"
          title="동점이 나왔어요!"
          body="같은 표를 받은 후보끼리 다시 정해요 · 기존 투표는 초기화"
          chips={tie.map((t) => t.text)}
          onClose={() => setTie(null)}
          secondary={{
            label: "◀ 대기방으로",
            onClick: () => st.backToLobby(),
          }}
          primary={{
            label: "🔥 동점자끼리 다시!",
            onClick: () => {
              const cands = tie;
              setCandidates(cands);
              startVoting(cands, true);
            },
          }}
        />
      )}
    </Shell>
  );
}
