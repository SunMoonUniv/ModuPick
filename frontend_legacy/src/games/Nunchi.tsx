import { useEffect, useMemo, useRef, useState } from "react";
import { after, useApp } from "../lib/store";
import {
  Shell,
  ScreenHeader,
  StatusBand,
  FairPill,
  TopBadge,
} from "../components/ui";
import { AvatarDisc } from "../components/Avatar";
import { ME_ID } from "../lib/data";
import type { RecordResult } from "../lib/types";
import { ModalFrame, NoticeCard } from "../components/Modals";

/* ============ S-10 눈치게임 (시트 11) ============ */
/* 15초 라운드 반복 · 서버 도착 시각 판정 · 판정 시간 내 겹치면 전원 탈락 · 최후 1명 = 최종 선정자 */
/* 생존자가 1명이 되면 자동 확정하지 않고 '마지막 1인 라운드'를 열어 UP을 눌러야 확정 (시간 제한 없음) */

const ROUND_SEC = 15; // D-32 고정

interface Press {
  id: string;
  t: number; // 라운드 시작 기준 초
}

export function Nunchi() {
  const st = useApp();
  const members = st.members;
  const win = st.settings.nzWindow;

  const [round, setRound] = useState(1);
  const [alive, setAlive] = useState<string[]>(() => members.map((m) => m.id));
  const [presses, setPresses] = useState<Press[]>([]);
  const [phase, setPhase] = useState<"live" | "judge" | "final">("live");
  const [timeLeft, setTimeLeft] = useState(ROUND_SEC);
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<RecordResult["rounds"]>([]);
  const [allout, setAllout] = useState(false);
  const [finalId, setFinalId] = useState<string | null>(null);
  const [c7Dismissed, setC7Dismissed] = useState(false); // C-07 시간초과 알림

  const roundT0 = useRef(performance.now());
  const judgedRef = useRef(false);
  const pressesRef = useRef<Press[]>([]);
  const aliveRef = useRef(alive);
  const phaseRef = useRef(phase);
  pressesRef.current = presses;
  aliveRef.current = alive;
  phaseRef.current = phase;

  /* ---- 라운드 시작 ---- */
  const startRound = (no: number, aliveIds: string[]) => {
    setRound(no);
    setAlive(aliveIds);
    setPresses([]);
    setVerdicts({});
    setPhase("live");
    setTimeLeft(ROUND_SEC);
    setC7Dismissed(false);
    judgedRef.current = false;
    roundT0.current = performance.now();
    // 봇 프레스 예약 — 겹칠 수도, 안 겹칠 수도 (판정은 '서버' 수신 시각)
    // 마지막 1인 라운드면 봇도 스스로 UP을 눌러 마무리 (자동 탈락 없음)
    const soloRound = aliveIds.length === 1;
    aliveIds
      .filter((id) => id !== ME_ID)
      .forEach((id) => {
        const t = soloRound
          ? 1.8 + Math.random() * 1.6
          : 1.5 + Math.random() * 11.5;
        after(t * 1000, () => {
          if (phaseRef.current !== "live") return;
          if (!aliveRef.current.includes(id)) return;
          if (pressesRef.current.some((p) => p.id === id)) return;
          setPresses((prev) =>
            prev.some((p) => p.id === id)
              ? prev
              : [
                  ...prev,
                  { id, t: (performance.now() - roundT0.current) / 1000 },
                ],
          );
        });
      });
  };

  useEffect(() => {
    startRound(
      1,
      members.map((m) => m.id),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- 타이머 ---- */
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (phaseRef.current !== "live") return;
      if (aliveRef.current.length <= 1) return; // 마지막 1인 라운드 = 시간 제한 없음
      const el = (performance.now() - roundT0.current) / 1000;
      setTimeLeft(Math.max(0, ROUND_SEC - el));
    }, 100);
    return () => window.clearInterval(iv);
  }, []);

  const pressUp = () => {
    if (phase !== "live") return;
    if (!alive.includes(ME_ID)) return;
    if (presses.some((p) => p.id === ME_ID)) return; // 1회만 (US-309)
    setPresses((prev) => [
      ...prev,
      { id: ME_ID, t: (performance.now() - roundT0.current) / 1000 },
    ]);
  };

  /* ---- 판정 트리거: 시간 종료 또는 전원 입력 ---- */
  /* 마지막 1인 라운드는 시간 종료로 판정하지 않음 — 본인이 UP을 눌러야만 확정 */
  useEffect(() => {
    if (phase !== "live" || judgedRef.current) return;
    const solo = alive.length === 1;
    const allPressed = alive.every((id) => presses.some((p) => p.id === id));
    if (allPressed || (!solo && timeLeft <= 0)) {
      judgedRef.current = true;
      after(allPressed ? 500 : 0, judge);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, presses.length, phase]);

  const finalize = (id: string, roundNo: number) => {
    setFinalId(id);
    setPhase("final");
    after(3000, () => {
      st.finishGame({
        variant: "record",
        game: "nunchi",
        purpose: st.settings.topic,
        loserId: id,
        rounds: [...historyRef.current],
        stats: [
          { label: "라운드", value: `${roundNo}회` },
          { label: "판정 시간", value: `${win}초` },
          { label: "최종 선정", value: nickOf(id) },
        ],
      });
    });
  };

  const judge = () => {
    /* 마지막 1인 라운드 — 본인이 UP을 누른 시점에만 최종 확정 (D-23) */
    if (aliveRef.current.length === 1) {
      const last = aliveRef.current[0];
      const p = pressesRef.current.find((x) => x.id === last);
      setVerdicts({ [last]: "최후 잔류" });
      setPhase("judge");
      setHistory((h) => [
        ...h,
        {
          round,
          rows: [
            {
              id: last,
              verdict: "최후 잔류" as const,
              time: p ? `+${p.t.toFixed(2)}s` : undefined,
            },
          ],
        },
      ]);
      after(1600, () => finalize(last, round));
      return;
    }

    const sorted = [...pressesRef.current].sort((a, b) => a.t - b.t);
    // 동시 입력 그룹핑 — 그룹 최초 클릭 기준 판정 시간 이내 (games.md §7.6)
    const groups: Press[][] = [];
    for (const p of sorted) {
      const g = groups[groups.length - 1];
      if (g && p.t - g[0].t <= win) g.push(p);
      else groups.push([p]);
    }
    const v: Record<string, string> = {};
    const eliminated = new Set<string>();
    groups.forEach((g) => {
      if (g.length >= 2)
        g.forEach((p) => ((v[p.id] = "동시 탈락"), eliminated.add(p.id)));
      else v[g[0].id] = "통과";
    });
    aliveRef.current.forEach((id) => {
      if (!sorted.some((p) => p.id === id)) {
        v[id] = "시간 초과";
        eliminated.add(id);
      }
    });
    // 탈락자가 없으면 마지막 입력자가 탈락 (클린 라운드)
    if (eliminated.size === 0 && sorted.length > 1) {
      const last = sorted[sorted.length - 1];
      v[last.id] = "최후 잔류";
      eliminated.add(last.id);
    }
    setVerdicts(v);
    setPhase("judge");
    setHistory((h) => [
      ...h,
      {
        round,
        rows: aliveRef.current.map((id) => ({
          id,
          verdict: (v[id] ??
            "통과") as RecordResult["rounds"][number]["rows"][number]["verdict"],
          time: sorted.find((p) => p.id === id)
            ? `+${sorted.find((p) => p.id === id)!.t.toFixed(2)}s`
            : undefined,
        })),
      },
    ]);

    const survivors = aliveRef.current.filter((id) => !eliminated.has(id));
    after(2600, () => {
      if (survivors.length === 0) {
        setAllout(true); // C-03 전원 탈락
      } else {
        // 1명만 남아도 자동 확정하지 않고 라운드를 한 번 더 — UP을 눌러야 확정
        startRound(round + 1, survivors);
      }
    });
  };

  const historyRef = useRef(history);
  historyRef.current = history;

  const nickOf = (id: string) => members.find((m) => m.id === id)?.nick ?? "";
  const memberOf = (id: string) => members.find((m) => m.id === id)!;

  const sortedPresses = useMemo(
    () => [...presses].sort((a, b) => a.t - b.t),
    [presses],
  );
  const myPressed = presses.some((p) => p.id === ME_ID);
  const myAlive = alive.includes(ME_ID);
  const deadCount = members.length - alive.length;
  const tense = round >= 2 || timeLeft < 5;
  /** 마지막 1인 라운드 — 시간 제한 없이 UP을 눌러야 확정 */
  const solo = alive.length === 1;
  const soloNick = solo ? nickOf(alive[0]) : "";

  return (
    <Shell>
      <div className="content">
        <ScreenHeader
          title="눈치게임"
          en="SENSE GAME"
          sub={`● ${st.settings.topic} · ROUND ${round} · 눈치 보는 중 · 방 MODU-${st.roomCode}`}
          onGuide={st.reopenGuide}
          right={
            <>
              <TopBadge color="var(--green)">
                👥 생존 {alive.length} / {members.length}
              </TopBadge>
              <TopBadge color="var(--pink)">💥 탈락 {deadCount}</TopBadge>
            </>
          }
        />

        {/* Howto 바 */}
        <div
          className="f-meta"
          style={{
            marginTop: 14,
            height: 56,
            background: "var(--white)",
            border: "4px solid var(--ink)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            gap: 28,
            padding: "0 24px",
            fontWeight: 700,
          }}
        >
          <span>◆ 이렇게 이긴다</span>
          <span>혼자 UP! = 통과</span>
          <span>· {win}초 내 겹치면 둘 다 탈락</span>
          <span>· 시간 초과도 탈락</span>
          <span>· 마지막 1인은 직접 UP!</span>
          <span style={{ marginLeft: "auto", color: "#9d9aa8" }}>
            끝까지 남은 1명이 {st.settings.topic} 당첨!
          </span>
        </div>

        {/* 플레이어 보드 6칸 */}
        <div style={{ display: "flex", gap: 22, marginTop: 16 }}>
          {members.map((m) => {
            const isAlive = alive.includes(m.id);
            const press = sortedPresses.findIndex((p) => p.id === m.id);
            const pressed = press >= 0;
            const verdict = verdicts[m.id];
            return (
              <div
                key={m.id}
                style={{
                  flex: 1,
                  height: 152,
                  borderRadius: 14,
                  border: "4px solid var(--ink)",
                  background: !isAlive
                    ? "var(--track)"
                    : verdict === "동시 탈락" ||
                        verdict === "시간 초과" ||
                        verdict === "최후 잔류"
                      ? "var(--pink)"
                      : pressed
                        ? "#B9F5D8"
                        : "var(--yellow)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  opacity: isAlive ? 1 : 0.55,
                  position: "relative",
                }}
              >
                <AvatarDisc avatarId={m.avatarId} color={m.color} size={52} />
                <span className="f-btn" style={{ fontSize: 22 }}>
                  {m.nick}
                  {m.isMe && " (나)"}
                </span>
                <span className="f-meta" style={{ fontWeight: 700 }}>
                  {!isAlive
                    ? "✕ 탈락"
                    : verdict
                      ? verdict
                      : pressed
                        ? `${press + 1}번째 눌렀어요`
                        : solo
                          ? "🔥 마지막 UP 대기"
                          : "? 아직 눈치 보는 중"}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 16, height: 400 }}>
          {/* 무대 1221 */}
          <div
            className="card"
            style={{
              width: 1221,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              animation:
                tense && phase === "live"
                  ? "shake 0.5s ease-in-out infinite"
                  : undefined,
            }}
          >
            <div className="f-headline">
              {solo ? (
                <>
                  마지막 1인 <b>{soloNick}</b> — 직접 UP을 눌러야 확정!
                </>
              ) : (
                <>
                  지금 누르면 → <b>{sortedPresses.length + 1}번째</b>
                </>
              )}
            </div>
            {/* 카운트다운 바 */}
            <div
              style={{
                width: "92%",
                height: 24,
                background: "var(--track)",
                border: "3px solid var(--ink)",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: solo ? "100%" : `${(timeLeft / ROUND_SEC) * 100}%`,
                  height: "100%",
                  background: solo
                    ? "var(--yellow)"
                    : timeLeft < 5
                      ? "var(--red)"
                      : "var(--green)",
                  transition: "width .1s linear",
                }}
              />
            </div>
            <div
              className="f-meta"
              style={{ fontWeight: 700, color: "#6b6878" }}
            >
              {solo
                ? `시간 제한 없음 · UP을 누르면 끝나요 · 라운드 ${round}`
                : `남은 시간 ${timeLeft.toFixed(1)}초 · 라운드 ${round}`}
            </div>
            {/* UP 버튼 + 점선 압박 링 */}
            <div
              style={{
                border: "4px dashed var(--red)",
                borderRadius: 24,
                padding: 14,
                marginTop: 4,
              }}
            >
              <button
                className="btn btn-red"
                disabled={phase !== "live" || myPressed || !myAlive}
                onClick={pressUp}
                style={{
                  width: 300,
                  height: 128,
                  fontSize: 54,
                  fontFamily: "var(--font-black)",
                }}
              >
                ▲ UP!
              </button>
            </div>
            <div
              className="f-meta"
              style={{ color: "#9d9aa8", fontWeight: 700 }}
            >
              {solo
                ? myAlive
                  ? myPressed
                    ? "UP! 확정 — 결과를 정리하는 중이에요"
                    : "혼자 남았어요 · 시간 제한 없이 UP을 눌러야 확정돼요"
                  : `${soloNick} 혼자 남았어요 — 직접 UP을 누르는 중…`
                : myPressed
                  ? `누르면 ${sortedPresses.findIndex((p) => p.id === ME_ID) + 1}번째로 기록됐어요 — 이제 기도할 시간`
                  : myAlive
                    ? "누르면 N번째로 기록돼요 · 한 번만!"
                    : "탈락 — 다음 라운드를 관전해요"}
            </div>
            {phase === "final" && finalId && (
              <div
                className="f-headline anim-pop"
                style={{
                  background: "var(--yellow)",
                  border: "4px solid var(--ink)",
                  borderRadius: 999,
                  padding: "8px 28px",
                }}
              >
                👑 최후의 1인 {nickOf(finalId)} — {st.settings.topic} 당첨!
              </div>
            )}
          </div>

          {/* 눌린 순서 550 */}
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
            <div className="f-headline">◆ 눌린 순서</div>
            <div
              className="f-meta"
              style={{ color: "#9d9aa8", fontWeight: 700 }}
            >
              SERVER TIME · 서버 도착 시각 기준 · 네트워크와 무관하게 공정
            </div>
            <div
              className="scroll-y"
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {sortedPresses.map((p, i) => (
                <div
                  key={p.id}
                  className="anim-pop"
                  style={{
                    height: 68,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    border: "3px solid var(--ink)",
                    borderRadius: 12,
                    padding: "0 14px",
                    background:
                      verdicts[p.id] === "동시 탈락" ||
                      verdicts[p.id] === "최후 잔류"
                        ? "var(--pink)"
                        : "#B9F5D8",
                    flex: "none",
                  }}
                >
                  <span className="f-name" style={{ width: 36 }}>
                    {i + 1}
                  </span>
                  <AvatarDisc
                    avatarId={memberOf(p.id).avatarId}
                    color={memberOf(p.id).color}
                    size={40}
                  />
                  <span className="f-btn" style={{ fontSize: 22 }}>
                    {nickOf(p.id)}
                  </span>
                  <span
                    className="f-meta"
                    style={{ marginLeft: "auto", fontWeight: 700 }}
                  >
                    +{p.t.toFixed(2)}초
                  </span>
                </div>
              ))}
              {alive
                .filter((id) => !presses.some((p) => p.id === id))
                .map((id) => (
                  <div
                    key={id}
                    className="f-meta"
                    style={{
                      height: 48,
                      display: "flex",
                      alignItems: "center",
                      border: "3px dashed #c2bfce",
                      borderRadius: 12,
                      padding: "0 14px",
                      color: "#9d9aa8",
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    — 아직 · {nickOf(id)}
                  </div>
                ))}
            </div>
          </div>
        </div>

        <StatusBand
          step={
            phase === "judge"
              ? "⚖️"
              : phase === "final"
                ? "👑"
                : solo
                  ? "🔥"
                  : "⚡"
          }
          title={
            phase === "judge"
              ? "판정 중…"
              : phase === "final"
                ? "최종 선정!"
                : solo
                  ? "마지막 1인!"
                  : "눈치 보는 중…"
          }
          sub={
            phase === "judge"
              ? `동시 입력(${win}초)과 시간 초과를 걸러내는 중`
              : phase === "final"
                ? "3초 후 결과 화면으로 이동해요"
                : solo
                  ? `${soloNick} 혼자 남았어요 · 시간 제한 없이 UP을 눌러야 확정돼요`
                  : `겹치면 둘 다 탈락 · 남은 시간 ${timeLeft.toFixed(1)}초`
          }
          style={
            tense && phase === "live"
              ? { animation: "band-flash 0.8s ease-in-out infinite" }
              : undefined
          }
          right={<FairPill text={`동시 판정 ${win}초 · 서버 도착 시각 기준`} />}
        />
      </div>

      {/* C-07 · 시간초과 탈락 알림 (레이어 625:102) */}
      {phase === "judge" && verdicts[ME_ID] === "시간 초과" && !c7Dismissed && (
        <NoticeCard
          badge="😓"
          badgeBg="#897c86"
          title="탈락했어요 ㅜㅜ"
          body="시간 초과로 인해 탈락했어요"
          onClose={() => setC7Dismissed(true)}
        />
      )}
      {/* C-03 전원 탈락 */}
      {allout && (
        <ModalFrame
          badge="😵 전원 탈락"
          badgeColor="var(--pink)"
          title="모두 탈락했어요!"
          body="생존자 0명 — 처음부터 다시 할까요? (가이드는 다시 안 떠요)"
          onClose={() => setAllout(false)}
          secondary={{ label: "◀ 대기방으로", onClick: () => st.backToLobby() }}
          primary={{
            label: "🔄 처음부터 다시!",
            onClick: () => {
              setAllout(false);
              setHistory([]);
              startRound(
                1,
                members.map((m) => m.id),
              );
            },
          }}
        />
      )}
    </Shell>
  );
}
