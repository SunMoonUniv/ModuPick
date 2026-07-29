import { useEffect, useMemo, useState } from "react";
import { after, useApp } from "../lib/store";
import {
  Shell,
  ScreenHeader,
  StatusBand,
  FairPill,
  TopBadge,
} from "../components/ui";
import { AvatarById } from "../components/Avatar";
import { ModalFrame } from "../components/Modals";
import { ME_ID } from "../lib/data";
import type { Member } from "../lib/types";

/* ============ S-09 익명 저격 (시트 10) ============ */
/* 질문 밴드 + 사격장 그리드(본인 제외) + 내 저격 패널 · 지목 내역은 끝까지 비공개 */

export function Sniper() {
  const st = useApp();
  const members = st.members;
  const n = members.length;
  const duration = st.settings.snTime;

  const [timeLeft, setTimeLeft] = useState(duration);
  const [fired, setFired] = useState<Set<string>>(new Set()); // 발사 완료한 사람
  const [myTarget, setMyTarget] = useState<string | null>(null);
  const [myFired, setMyFired] = useState(false);
  const [hits, setHits] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<"aim" | "reveal">("aim");
  const [tieNames, setTieNames] = useState<string[] | null>(null);
  const [revoteNo, setRevoteNo] = useState(0);

  const candidates = members.filter((m) => !m.isMe); // 본인 카드는 그리드에서 제외

  /* ---- 카운트다운 ---- */
  useEffect(() => {
    setTimeLeft(duration);
    const iv = window.setInterval(
      () => setTimeLeft((t) => Math.max(0, t - 1)),
      1000,
    );
    return () => window.clearInterval(iv);
  }, [duration, revoteNo]);

  /* ---- 봇 발사 (타겟은 서버에만 · 화면 비공개) ---- */
  useEffect(() => {
    members
      .filter((m) => !m.isMe)
      .forEach((b, i) => {
        after(1600 + i * 1400 + Math.random() * 1500, () => {
          setFired((s) => new Set(s).add(b.id));
          const options = members.filter((m) => m.id !== b.id);
          const pick = options[Math.floor(Math.random() * options.length)];
          setHits((h) => ({ ...h, [pick.id]: (h[pick.id] ?? 0) + 1 }));
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revoteNo]);

  const fire = () => {
    if (myFired || !myTarget) return; // 1회 확정 (US-309)
    setMyFired(true);
    setFired((s) => new Set(s).add(ME_ID));
    setHits((h) => ({ ...h, [myTarget]: (h[myTarget] ?? 0) + 1 }));
  };

  /* ---- 전원 발사 또는 시간 종료 → 판정 ---- */
  const allFired = fired.size >= n;
  useEffect(() => {
    if (phase !== "aim") return;
    if (!allFired && timeLeft > 0) return;
    const tally = members.map((m) => ({ m, v: hits[m.id] ?? 0 }));
    const max = Math.max(...tally.map((t) => t.v));
    const top = tally.filter((t) => t.v === max && max > 0);
    if (top.length !== 1) {
      after(800, () =>
        setTieNames(
          top.length ? top.map((t) => t.m.nick) : members.map((m) => m.nick),
        ),
      );
      return;
    }
    setPhase("reveal");
    after(3000, () => {
      const sorted = [...tally].sort((a, b) => b.v - a.v);
      st.finishGame({
        variant: "winner",
        game: "sniper",
        winnerId: sorted[0].m.id,
        purpose: st.settings.snQuestion,
        stats: [
          { label: "최다 피격", value: `${sorted[0].v}발` },
          {
            label: "총 발사",
            value: `${tally.reduce((a, b) => a + b.v, 0)}발`,
          },
          { label: "투표 시간", value: `${duration}초` },
        ],
        safe: sorted
          .slice(1)
          .map(({ m, v }) => ({ id: m.id, note: `${v}발 피격` })),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFired, timeLeft, phase]);

  const winner = useMemo(() => {
    if (phase !== "reveal") return null;
    const tally = members.map((m) => ({ m, v: hits[m.id] ?? 0 }));
    return [...tally].sort((a, b) => b.v - a.v)[0]?.m ?? null;
  }, [phase, hits, members]);

  const restartVote = () => {
    setTieNames(null);
    setFired(new Set());
    setMyFired(false);
    setMyTarget(null);
    setHits({});
    setRevoteNo((v) => v + 1);
  };

  return (
    <Shell>
      <div className="content">
        <ScreenHeader
          title="익명 저격"
          en="SNIPER"
          sub={`● 저격 투표 중 · 방 MODU-${st.roomCode}`}
          onGuide={st.reopenGuide}
          right={
            <TopBadge color="var(--red)">
              <span style={{ color: "#fff" }}>
                ⏱ {timeLeft}초 · {fired.size} / {n} 발사
              </span>
            </TopBadge>
          }
        />

        {/* 질문 밴드 · 옐로 r12 */}
        <div
          className="f-headline"
          style={{
            marginTop: 16,
            background: "var(--yellow)",
            border: "4px solid var(--ink)",
            borderRadius: 12,
            height: 96,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 24px",
          }}
        >
          🎯 {st.settings.snQuestion}
          <span
            className="f-meta"
            style={{
              marginLeft: "auto",
              background: "var(--red)",
              color: "#fff",
              borderRadius: 999,
              padding: "6px 18px",
              fontWeight: 700,
            }}
          >
            ⏱ {timeLeft}초 안에 발사!
          </span>
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 20, height: 588 }}>
          {/* 사격장 그리드 1221 — 본인 제외 · 동심원 과녁 */}
          <div
            className="card"
            style={{ width: 1221, padding: 24, position: "relative" }}
          >
            <div
              className="f-btn"
              style={{
                position: "absolute",
                top: -20,
                left: "50%",
                transform: "translateX(-50%)",
                background: "var(--ink)",
                color: "#fff",
                borderRadius: 999,
                padding: "6px 24px",
                whiteSpace: "nowrap",
                zIndex: 2,
              }}
            >
              {phase === "reveal" && winner
                ? `💥 ${winner.nick} 최다 피격!`
                : "👀 누가 걸릴까?! · 🤫 쉿!"}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 24,
                height: "100%",
                alignItems: "stretch",
              }}
            >
              {candidates.map((m) => (
                <TargetCard
                  key={m.id}
                  m={m}
                  fired={fired.has(m.id)}
                  chosen={myTarget === m.id}
                  hit={phase === "reveal" && winner?.id === m.id}
                  onPick={() => !myFired && setMyTarget(m.id)}
                />
              ))}
            </div>
          </div>

          {/* 내 저격 550 */}
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
            <div className="f-headline">◆ 내 저격</div>
            <div
              className="f-meta"
              style={{ color: "#9d9aa8", fontWeight: 700 }}
            >
              익명 · 1명 지목 · {duration}초 안에 · 나는 지목할 수 없어요
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                flex: 1,
                marginTop: 8,
              }}
            >
              {candidates.map((m) => {
                const chosen = myTarget === m.id;
                return (
                  <button
                    key={m.id}
                    disabled={myFired}
                    onClick={() => setMyTarget(m.id)}
                    className="f-sub"
                    style={{
                      height: 72,
                      textAlign: "left",
                      border: "3px solid var(--ink)",
                      borderRadius: 12,
                      padding: "0 18px",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      background: chosen ? "var(--red)" : "var(--white)",
                      color: chosen ? "#fff" : "var(--ink)",
                    }}
                  >
                    {chosen ? "●" : "○"} {m.nick}
                    {chosen && (
                      <span style={{ marginLeft: "auto" }}>✓ 조준</span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              className="btn btn-red"
              disabled={!myTarget || myFired}
              onClick={fire}
              style={{ height: 70 }}
            >
              {myFired ? "✓ 발사 완료 — 변경 불가" : "🔫 발사!"}
            </button>
          </div>
        </div>

        <StatusBand
          step={phase === "reveal" ? "💥" : "2"}
          title={phase === "reveal" ? "최다 피격 확정!" : "저격 투표 중…"}
          sub={
            phase === "reveal"
              ? "3초 후 결과 화면으로 이동해요"
              : `${fired.size} / ${n} 발사 · 누가 누구를 지목했는지는 끝까지 비공개`
          }
          right={<FairPill text="투표 중 지목은 아무도 못 봐요" />}
        />
      </div>

      {/* 동점 (C-02) — 전원 재투표 (games.md §6.6) */}
      {tieNames && (
        <ModalFrame
          badge="🏁 동점 발생!"
          badgeColor="var(--yellow)"
          title="동점이 나왔어요!"
          body="동점 후보를 유지하고 전원이 다시 투표해요"
          chips={tieNames}
          onClose={() => setTieNames(null)}
          secondary={{ label: "◀ 대기방으로", onClick: () => st.backToLobby() }}
          primary={{ label: "🔥 재투표!", onClick: restartVote }}
        />
      )}
    </Shell>
  );
}

/* ---------- 과녁 카드 — 동심원 3겹 + 중앙 아바타 ---------- */
function TargetCard({
  m,
  fired,
  chosen,
  hit,
  onPick,
}: {
  m: Member;
  fired: boolean;
  chosen: boolean;
  hit: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      style={{
        border: chosen ? "5px solid var(--red)" : "4px solid var(--ink)",
        borderRadius: 16,
        background: hit ? "var(--yellow)" : "var(--input)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        position: "relative",
      }}
    >
      <div style={{ position: "relative", width: 170, height: 170 }}>
        {/* 동심원 3겹 ⌀160 / 112 / 64 */}
        {[80, 56, 32].map((r, i) => (
          <div
            key={r}
            style={{
              position: "absolute",
              left: 85 - r,
              top: 85 - r,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              border: `3.5px solid ${i === 0 ? "var(--red)" : "var(--ink)"}`,
              background: i === 1 ? "#fff" : "transparent",
            }}
          />
        ))}
        {/* 십자선 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 83,
            height: 3,
            background: "rgba(14,13,20,.25)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 83,
            width: 3,
            background: "rgba(14,13,20,.25)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 85 - 29,
            top: 85 - 29,
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: m.color,
            border: "3px solid var(--ink)",
            boxShadow: "3px 3px 0 var(--ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <AvatarById id={m.avatarId} size={46} />
        </div>
      </div>
      <span className="f-name">{m.nick}</span>
      <span
        className="f-meta"
        style={{
          fontWeight: 700,
          borderRadius: 999,
          border: "2px solid var(--ink)",
          padding: "2px 14px",
          background: fired ? m.color : "var(--white)",
          color: "var(--ink)",
        }}
      >
        {fired ? "발사 완료" : "조준 중…"}
      </span>
      {hit && (
        <span
          className="f-btn anim-pop"
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            background: "var(--red)",
            color: "#fff",
            borderRadius: 999,
            padding: "4px 14px",
            transform: "rotate(6deg)",
          }}
        >
          💥 명중!
        </span>
      )}
    </button>
  );
}
