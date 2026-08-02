import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useApp } from "../lib/store";
import { Shell } from "../components/ui";
import { AvatarDisc } from "../components/Avatar";
import { gameMeta, pastel, PERSON_COLORS } from "../lib/data";
import type {
  AssignResult,
  RecordResult,
  TallyResult,
  WinnerResult,
} from "../lib/types";

/* ============ S-0Xb 결과 발표 · 공통 셸 + 4변형 (시트 12) ============ */

const STAT_TINTS = ["var(--cyan)", "var(--pink)", "var(--yellow)"];

export function Result() {
  const st = useApp();
  const result = st.result;
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  if (!result) return null;
  const meta = gameMeta(result.game);

  const savePng = async () => {
    if (!cardRef.current || saving) return;
    setSaving(true);
    try {
      const url = await toPng(cardRef.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `modupick-${result.game}-result.png`;
      a.click();
      st.showToast("🖼 결과 이미지를 저장했어요");
    } catch {
      st.showToast("이미지 저장에 실패했어요 — 다시 시도해 주세요");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <Confetti />
      <div className="content">
        {/* 헤더 */}
        <div className="screen-header">
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <span className="f-title" style={{ color: "#fff" }}>
                결과 발표
              </span>
              <span
                className="f-sub"
                style={{
                  color: "var(--yellow)",
                  letterSpacing: 3,
                  fontWeight: 700,
                }}
              >
                RESULT
              </span>
            </div>
            <div
              className="f-sub"
              style={{ color: "rgba(255,255,255,.85)", marginTop: 4 }}
            >
              ● {meta.name} · {result.purpose} · 방 MODU-{st.roomCode}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 12 }}>
          {/* 결과 카드 1221 — PNG 저장 영역 */}
          <div
            ref={cardRef}
            className="card"
            style={{
              width: 1221,
              height: 698, // 결과 카드 1221×698 (시트 12)
              padding: "24px 32px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              overflow: "hidden",
            }}
          >
            {result.variant === "winner" && <WinnerCard r={result} />}
            {result.variant === "assign" && <AssignCard r={result} />}
            {result.variant === "tally" && <TallyCard r={result} />}
            {result.variant === "record" && <RecordCard r={result} />}
          </div>

          {/* 액션 패널 550 */}
          <div
            className="card"
            style={{
              width: 550,
              height: 698,
              padding: 30,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div className="f-headline">◆ 결과 저장</div>
            <button
              className="btn btn-ink"
              onClick={savePng}
              style={{ flex: 1, minHeight: 120 }}
            >
              {saving ? "저장 중…" : "🖼 결과 이미지 저장"}
            </button>
            <div
              className="f-meta"
              style={{ color: "#9d9aa8", fontWeight: 700 }}
            >
              결과 카드를 PNG로 저장해 바로 공유할 수 있어요 (저장은 이미지뿐 ·
              D-13)
            </div>
            <div
              style={{
                height: 4,
                background: "var(--track)",
                borderRadius: 2,
                margin: "8px 0",
              }}
            />
            <div className="f-headline">다음은? · 👑 방장만 조작</div>
            <button
              className="btn btn-yellow"
              onClick={st.retryGame}
              style={{ flex: 1, minHeight: 120 }}
            >
              ↻ 다시 하기 (같은 설정 · 가이드 없음)
            </button>
            <button
              className="btn"
              onClick={st.backToLobby}
              style={{ flex: 1, minHeight: 120 }}
            >
              ← 대기방으로
            </button>
            <div className="f-meta" style={{ color: "#9d9aa8" }}>
              방장이 선택하면 전원에게 즉시 적용돼요
            </div>
          </div>
        </div>

        {/* Safe Band — 승자형 전용 (1803×160 · 시트 12) */}
        {result.variant === "winner" && <SafeBand r={result} />}
      </div>
    </Shell>
  );
}

/* ---------- 승자형 (룰렛·저격·시간초) ---------- */
function WinnerCard({ r }: { r: WinnerResult }) {
  const members = useApp((s) => s.members);
  const winner = members.find((m) => m.id === r.winnerId);
  const meta = gameMeta(r.game);
  if (!winner) return null;
  return (
    <>
      <div
        className="f-headline"
        style={{
          width: "100%",
          background: "var(--pink)",
          border: "4px solid var(--ink)",
          borderRadius: 12,
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        🎉 WINNER 🎉
      </div>
      <div style={{ position: "relative", marginTop: 30, flex: "none" }}>
        {/* 하드 엣지 후광 ⌀340 */}
        <div
          style={{
            position: "absolute",
            left: -30,
            top: -30,
            width: 340,
            height: 340,
            borderRadius: "50%",
            background: pastel("#FF4FD4", 0.35),
          }}
        />
        <span
          style={{
            position: "absolute",
            top: -58,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 64,
            zIndex: 2,
          }}
        >
          👑
        </span>
        <div style={{ position: "relative" }}>
          <AvatarDisc
            avatarId={winner.avatarId}
            color={winner.color}
            size={280}
            ring={6}
            shadow
          />
        </div>
      </div>
      <div
        className="f-hero"
        style={{ fontSize: 60, flex: "none", marginTop: 6 }}
      >
        {winner.nick}
      </div>
      <span
        className="f-btn"
        style={{
          background: "var(--ink)",
          color: "#fff",
          borderRadius: 999,
          padding: "8px 26px",
        }}
      >
        {meta.icon} {meta.name} · {r.purpose} 당첨!
      </span>
      <div style={{ display: "flex", gap: 24, marginTop: 8, width: "100%" }}>
        {r.stats.map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              height: 108,
              background: pastel(
                STAT_TINTS[i] === "var(--cyan)"
                  ? "#57EBFA"
                  : STAT_TINTS[i] === "var(--pink)"
                    ? "#FF4FD4"
                    : "#FFE23E",
                0.4,
              ),
              border: "3px solid var(--ink)",
              borderRadius: 14,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              className="f-meta"
              style={{ fontWeight: 700, color: "#413d4d" }}
            >
              {s.label}
            </span>
            <span className="f-headline">{s.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function SafeBand({ r }: { r: WinnerResult }) {
  const members = useApp((s) => s.members);
  return (
    <div
      style={{
        marginTop: 12,
        height: 160,
        background: "var(--white)",
        border: "5px solid var(--ink)",
        borderRadius: 20,
        boxShadow: "6px 6px 0 var(--ink)",
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "0 28px",
      }}
    >
      <span className="f-headline" style={{ whiteSpace: "nowrap" }}>
        😮 휴~ 비껴간 {r.safe.length}명
      </span>
      <div
        style={{
          display: "flex",
          gap: 16,
          flex: 1,
          justifyContent: "space-evenly",
        }}
      >
        {r.safe.map((s) => {
          const m = members.find((x) => x.id === s.id);
          if (!m) return null;
          return (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: pastel(m.color, 0.3),
                border: "3px solid var(--ink)",
                borderRadius: 999,
                padding: "8px 20px 8px 10px",
              }}
            >
              <AvatarDisc avatarId={m.avatarId} color={m.color} size={48} />
              <div>
                <div className="f-btn" style={{ fontSize: 22 }}>
                  {m.nick}
                </div>
                <div
                  className="f-meta"
                  style={{ fontWeight: 700, color: "#413d4d" }}
                >
                  {s.note}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- 배정형 (사다리) ---------- */
function AssignCard({ r }: { r: AssignResult }) {
  const members = useApp((s) => s.members);
  return (
    <>
      <div className="f-headline" style={{ alignSelf: "flex-start" }}>
        🪜 역할 배분 결과 · {r.purpose}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          width: "100%",
          flex: 1,
        }}
      >
        {r.pairs.map((p) => {
          const m = members.find((x) => x.id === p.id);
          if (!m) return null;
          return (
            <div
              key={p.id}
              style={{
                background: pastel(m.color, 0.22),
                border: "3px solid var(--ink)",
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "0 20px",
              }}
            >
              <AvatarDisc avatarId={m.avatarId} color={m.color} size={64} />
              <span className="f-name" style={{ fontSize: 30 }}>
                {m.nick}
              </span>
              <span
                className="f-headline"
                style={{ margin: "0 4px", color: "#9d9aa8" }}
              >
                →
              </span>
              <span
                className="f-btn"
                style={{
                  marginLeft: "auto",
                  background: p.roleLabel ? "var(--white)" : "var(--track)",
                  border: "3px solid var(--ink)",
                  borderRadius: 10,
                  padding: "10px 22px",
                  boxShadow: "3px 3px 0 var(--ink)",
                  color: p.roleLabel ? "var(--ink)" : "#9d9aa8",
                }}
              >
                {p.roleLabel || "배정 없음"}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 20, width: "100%" }}>
        {r.stats.map((s) => (
          <span
            key={s.label}
            className="f-meta"
            style={{
              background: "var(--input)",
              border: "3px solid var(--ink)",
              borderRadius: 999,
              padding: "8px 18px",
              fontWeight: 700,
            }}
          >
            {s.label} · {s.value}
          </span>
        ))}
        <span
          className="f-meta"
          style={{ marginLeft: "auto", color: "#9d9aa8", alignSelf: "center" }}
        >
          🔒 배정 확정 — 방장이 다시 돌리기 전까지 유지
        </span>
      </div>
    </>
  );
}

/* ---------- 개표형 (킹메이커) ---------- */
function TallyCard({ r }: { r: TallyResult }) {
  const members = useApp((s) => s.members);
  const nickOf = (id?: string) =>
    members.find((m) => m.id === id)?.nick ?? "익명";
  const maxV = Math.max(1, ...r.rows.map((x) => x.votes));
  return (
    <>
      <div
        className="f-title"
        style={{
          width: "100%",
          background: "var(--yellow)",
          border: "4px solid var(--ink)",
          borderRadius: 14,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        👑 {r.winnerText}
        <span
          className="f-meta"
          style={{ marginLeft: "auto", fontWeight: 700 }}
        >
          {r.purpose} 확정!
        </span>
      </div>
      <div
        className="f-meta"
        style={{ alignSelf: "flex-start", fontWeight: 700, color: "#6b6878" }}
      >
        ◆ 개표 결과 ·{" "}
        {r.reveal === "익명"
          ? "🤫 익명 모드 — 제안자·투표자 비공개"
          : "👀 실명 모드 — 제안자·투표자 공개"}
      </div>
      <div
        className="scroll-y"
        style={{
          width: "100%",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {r.rows.map((row, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flex: "none",
            }}
          >
            <span
              className="f-name"
              style={{
                width: 56,
                textAlign: "center",
                background: i === 0 ? "var(--yellow)" : "var(--input)",
                border: "3px solid var(--ink)",
                borderRadius: 10,
                padding: "4px 0",
              }}
            >
              {i + 1}위
            </span>
            <div style={{ width: 380 }}>
              <div className="f-sub" style={{ fontWeight: 700 }}>
                {row.text}
              </div>
              {r.reveal === "실명" && (
                <div className="f-meta" style={{ color: "#9d9aa8" }}>
                  제안 {nickOf(row.authorId)} · 투표{" "}
                  {row.voterIds?.length
                    ? row.voterIds.map(nickOf).join("·")
                    : "없음"}
                </div>
              )}
            </div>
            <div
              style={{
                flex: 1,
                height: 28,
                background: "var(--track)",
                border: "3px solid var(--ink)",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${(row.votes / maxV) * 100}%`,
                  height: "100%",
                  background: i === 0 ? "var(--green)" : "var(--cyan)",
                }}
              />
            </div>
            <span className="f-name" style={{ width: 64, textAlign: "right" }}>
              {row.votes}표
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 20, width: "100%" }}>
        {r.stats.map((s) => (
          <span
            key={s.label}
            className="f-meta"
            style={{
              background: "var(--input)",
              border: "3px solid var(--ink)",
              borderRadius: 999,
              padding: "8px 18px",
              fontWeight: 700,
            }}
          >
            {s.label} · {s.value}
          </span>
        ))}
      </div>
    </>
  );
}

/* ---------- 기록형 (눈치) ---------- */
function RecordCard({ r }: { r: RecordResult }) {
  const members = useApp((s) => s.members);
  const loser = members.find((m) => m.id === r.loserId);
  const nickOf = (id: string) => members.find((m) => m.id === id)?.nick ?? "";
  const verdictStyle = (v: string) =>
    v === "통과"
      ? { background: "#B9F5D8" }
      : v === "동시 탈락"
        ? { background: "var(--yellow)" }
        : v === "시간 초과"
          ? { background: pastel("#FF4FD4", 0.35) }
          : { background: "var(--lavender)" };
  return (
    <>
      <div
        className="f-headline"
        style={{
          width: "100%",
          background: "var(--yellow)",
          border: "4px solid var(--ink)",
          borderRadius: 14,
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        👑 최종 선정 —{" "}
        {loser && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
          >
            <AvatarDisc
              avatarId={loser.avatarId}
              color={loser.color}
              size={44}
            />
            <b>{loser.nick}</b>
          </span>
        )}
        <span
          className="f-meta"
          style={{ marginLeft: "auto", fontWeight: 700 }}
        >
          {r.purpose} 당첨! · 나머지는 통과
        </span>
      </div>
      <div
        className="scroll-y"
        style={{
          width: "100%",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {r.rounds.map((rd) => (
          <div key={rd.round} style={{ flex: "none" }}>
            <div className="f-sub" style={{ fontWeight: 700, marginBottom: 8 }}>
              ROUND {rd.round}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {rd.rows.map((row) => (
                <span
                  key={row.id}
                  className="f-meta"
                  style={{
                    border: "3px solid var(--ink)",
                    borderRadius: 999,
                    padding: "6px 16px",
                    fontWeight: 700,
                    ...verdictStyle(row.verdict),
                  }}
                >
                  {nickOf(row.id)} · {row.verdict}
                  {row.time ? ` (${row.time})` : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 20, width: "100%" }}>
        {r.stats.map((s) => (
          <span
            key={s.label}
            className="f-meta"
            style={{
              background: "var(--input)",
              border: "3px solid var(--ink)",
              borderRadius: 999,
              padding: "8px 18px",
              fontWeight: 700,
            }}
          >
            {s.label} · {s.value}
          </span>
        ))}
      </div>
    </>
  );
}

/* ---------- 컨페티 ---------- */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 26 }).map((_, i) => ({
        left: 80 + Math.random() * 1760,
        delay: Math.random() * 2.2,
        color: PERSON_COLORS[i % 6],
        rot: Math.random() * 90,
        size: 10 + Math.random() * 12,
      })),
    [],
  );
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 3,
      }}
    >
      {pieces.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: p.left,
            top: 10,
            width: p.size,
            height: p.size * 0.6,
            background: p.color,
            border: "2px solid var(--ink)",
            transform: `rotate(${p.rot}deg)`,
            animation: `confetti-fall 2.6s ${p.delay}s ease-in infinite`,
          }}
        />
      ))}
    </div>
  );
}
