import { useEffect, useMemo, useRef, useState } from "react";
import { after, useApp } from "../lib/store";
import {
  Shell,
  ScreenHeader,
  StatusBand,
  FairPill,
  TopBadge,
} from "../components/ui";
import { AvatarById } from "../components/Avatar";

/* ============ S-05 운명의 룰렛 (레이어 542:1289) ============
   좌 로스터 380×104 + 우 휠 ⌀683(중심 1165,529) · 림 점 20 · 중앙 PICK! 56 · 스타버스트 배경 */

type Phase = "idle" | "spin" | "reveal";

export function Roulette() {
  const st = useApp();
  const members = st.members;
  const n = members.length;

  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null);
  const angleRef = useRef(0);
  const [angle, setAngle] = useState(0);
  const rafRef = useRef(0);

  const spin = () => {
    if (phase !== "idle") return; // 최초 1회만 (US-309)
    const idx = Math.floor(Math.random() * n); // 서버(시뮬) 확정 (D-01)
    const sliceMid = (idx + 0.5) * (360 / n);
    const target = 360 * 5 + (360 - sliceMid);
    setWinnerIdx(idx);
    setPhase("spin");
    setCount(3);

    const dur = 4200;
    const t0 = performance.now();
    const from = angleRef.current % 360;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const a = from + (target - from) * eased;
      angleRef.current = a;
      setAngle(a);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else {
        setPhase("reveal");
        after(3000, () => {
          const winner = members[idx];
          st.finishGame({
            variant: "winner",
            game: "roulette",
            winnerId: winner.id,
            purpose: st.settings.topic,
            stats: [
              { label: "참여한 사람", value: `${n}명` },
              { label: "당첨 확률", value: `${(100 / n).toFixed(1)}%` },
              { label: "결정까지", value: `${(dur / 1000).toFixed(1)}초` },
            ],
            safe: members
              .filter((_, i) => i !== idx)
              .map((m) => ({ id: m.id, note: "세이프!" })),
          });
        });
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    [1000, 2000, 3000].forEach((ms, i) => after(ms, () => setCount(2 - i)));
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const slice = 360 / n;
  const R = 341.5; // ⌀683
  const slices = useMemo(
    () =>
      members.map((m, i) => {
        const a0 = ((i * slice - 90) * Math.PI) / 180;
        const a1 = (((i + 1) * slice - 90) * Math.PI) / 180;
        const large = slice > 180 ? 1 : 0;
        const p = (a: number) =>
          `${350 + R * Math.cos(a)} ${350 + R * Math.sin(a)}`;
        const mid = ((i * slice + slice / 2 - 90) * Math.PI) / 180;
        return {
          d: `M 350 350 L ${p(a0)} A ${R} ${R} 0 ${large} 1 ${p(a1)} Z`,
          mid,
          m,
        };
      }),
    [members, slice],
  );

  return (
    <Shell>
      {/* 스타버스트 + 글로우 (레이어 542:1323~1325) */}
      <div
        style={{
          position: "absolute",
          left: 666,
          top: 29,
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,79,212,.22) 0%, rgba(255,79,212,.06) 55%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 641,
          top: 4,
          width: 1050,
          height: 1050,
          background:
            "repeating-conic-gradient(rgba(255,255,255,.05) 0 9deg, transparent 9deg 18deg)",
          borderRadius: "50%",
          transform: "rotate(-6deg)",
          pointerEvents: "none",
        }}
      />

      <div className="content">
        <ScreenHeader
          title="운명의 룰렛"
          en="WHEEL OF FATE"
          sub={`● 실시간 진행 · 방 MODU-${st.roomCode}`}
          onGuide={st.reopenGuide}
          right={
            <>
              <TopBadge color="var(--green)">◉ {n}명 실시간 접속</TopBadge>
              <TopBadge color="var(--white)">
                🎯 {st.settings.topic} 뽑기
              </TopBadge>
            </>
          }
        />

        {/* 좌 로스터 — 380×104 (레이어 PL·) */}
        <div style={{ position: "absolute", left: 0, top: 104 }}>
          <div
            className="f-meta"
            style={{
              fontSize: 24,
              color: "rgba(255,255,255,.9)",
              letterSpacing: 1,
            }}
          >
            ◆ 팀 멤버 · {n}명
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              marginTop: 18,
            }}
          >
            {members.map((m, i) => (
              <div
                key={m.id}
                style={{
                  width: 380,
                  height: 104,
                  background:
                    phase === "reveal" && winnerIdx === i
                      ? "var(--yellow)"
                      : "var(--white)",
                  border: "3.16px solid var(--ink)",
                  borderRadius: 16.9,
                  boxShadow: "4.2px 5.3px 0 var(--ink)",
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  padding: "0 14px",
                }}
              >
                <div
                  style={{
                    width: 47,
                    height: 47,
                    borderRadius: "50%",
                    background: m.color,
                    border: "2.5px solid var(--ink)",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                  }}
                >
                  <AvatarById id={m.avatarId} size={37} />
                </div>
                <div>
                  <div
                    style={{ fontFamily: "var(--font-black)", fontSize: 28 }}
                  >
                    {m.nick}
                  </div>
                  <div className="f-meta" style={{ color: "#80808c" }}>
                    {m.isHost ? "👑 방장 · 접속" : "● 접속 중"}
                  </div>
                </div>
                {phase === "reveal" && winnerIdx === i && (
                  <span style={{ marginLeft: "auto", fontSize: 28 }}>🎉</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 휠 — 중심 (1106.5, 489) rel · ⌀700 */}
        <div
          style={{
            position: "absolute",
            left: 756,
            top: 100,
            width: 700,
            height: 700,
          }}
        >
          {/* 배너 — 검정 pill + 옐로 텍스트 (레이어 542:1421) */}
          <div
            style={{
              position: "absolute",
              top: -62,
              left: "50%",
              transform: "translateX(-50%)",
              background: "var(--ink)",
              color: "var(--yellow)",
              borderRadius: 42,
              boxShadow: "3.16px 3.16px 0 rgba(14,13,20,.5)",
              padding: "8px 15px",
              fontFamily: "var(--font-black)",
              fontSize: 20,
              whiteSpace: "nowrap",
              zIndex: 3,
            }}
          >
            {phase === "reveal" && winnerIdx !== null
              ? `🎉 ${members[winnerIdx].nick} 당첨!`
              : "누가 걸릴까?! 👀"}
          </div>

          <svg width={700} height={700} viewBox="0 0 700 700">
            {/* 외곽 링 ⌀700 */}
            <circle
              cx={350}
              cy={350}
              r={348}
              fill="#fff"
              stroke="var(--ink)"
              strokeWidth={4}
            />
            <g
              style={{
                transform: `rotate(${angle}deg)`,
                transformOrigin: "350px 350px",
              }}
            >
              {slices.map((s, i) => (
                <g key={s.m.id}>
                  <path
                    d={s.d}
                    fill={s.m.color}
                    stroke="var(--ink)"
                    strokeWidth={5}
                  />
                  {/* 아바타 ⌀76 흰 원 + 캐릭터 57 + 이름 Black Han 24 */}
                  <g
                    transform={`translate(${350 + 218 * Math.cos(s.mid) - 38}, ${350 + 218 * Math.sin(s.mid) - 52})`}
                  >
                    <circle
                      cx={38}
                      cy={38}
                      r={39}
                      fill="#fff"
                      stroke="var(--ink)"
                      strokeWidth={3}
                    />
                    <foreignObject x={9} y={9} width={58} height={58}>
                      <div
                        style={{
                          borderRadius: "50%",
                          overflow: "hidden",
                          width: 58,
                          height: 58,
                        }}
                      >
                        <AvatarById id={s.m.avatarId} size={58} />
                      </div>
                    </foreignObject>
                    <text
                      x={38}
                      y={106}
                      textAnchor="middle"
                      fontFamily="Black Han Sans"
                      fontSize={24}
                      fill="var(--ink)"
                      stroke="#fff"
                      strokeWidth={5}
                      paintOrder="stroke"
                    >
                      {s.m.nick}
                    </text>
                  </g>
                  {phase === "reveal" && winnerIdx === i && (
                    <path
                      d={s.d}
                      fill="rgba(255,226,62,.45)"
                      stroke="var(--yellow)"
                      strokeWidth={8}
                    />
                  )}
                </g>
              ))}
              {/* 림 점 ⌀22.75 × 20 (레이어 542:1340~1359) */}
              {Array.from({ length: 20 }).map((_, i) => {
                const a = (i / 20) * Math.PI * 2;
                return (
                  <circle
                    key={i}
                    cx={350 + 341 * Math.cos(a)}
                    cy={350 + 341 * Math.sin(a)}
                    r={11.4}
                    fill={i % 2 === 0 ? "var(--yellow)" : "#fff"}
                    stroke="var(--ink)"
                    strokeWidth={3}
                  />
                );
              })}
            </g>
            {/* 중앙 허브 ⌀190 + PICK! 56 */}
            <circle
              cx={350}
              cy={350}
              r={95}
              fill="#fff"
              stroke="var(--ink)"
              strokeWidth={6}
            />
            <text
              x={350}
              y={352}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Black Han Sans"
              fontSize={phase === "spin" ? 72 : 56}
              fill="var(--ink)"
            >
              {phase === "spin" ? count : "PICK!"}
            </text>
            {/* 포인터 — 상단 중앙 (레이어 Vector + 점) */}
            <path
              d="M 314 -12 L 386 -12 L 350 54 Z"
              fill="var(--pink)"
              stroke="var(--ink)"
              strokeWidth={5}
            />
            <circle
              cx={350}
              cy={4}
              r={10}
              fill="#fff"
              stroke="var(--ink)"
              strokeWidth={3}
            />
          </svg>
        </div>

        {/* HUD (레이어 542:1381) */}
        <StatusBand
          step={phase === "idle" ? "1" : phase === "spin" ? "3" : "🎉"}
          title={
            phase === "idle"
              ? `${st.settings.topic} 확인하기`
              : phase === "spin"
                ? "돌리는 중…"
                : `${winnerIdx !== null ? members[winnerIdx].nick : ""} 당첨!`
          }
          sub={
            phase === "idle"
              ? "방장이 돌리면 전원 화면에서 동시에 시작돼요"
              : phase === "spin"
                ? `${n}명 화면에서 동시에 회전 중 · ${count}초 후 ${st.settings.topic} 공개`
                : "3초 후 결과 화면으로 이동해요"
          }
          right={
            <>
              <FairPill text="결과는 아무도 못 바꿔요 · 모두 똑같이" />
              <button
                className="btn btn-yellow"
                disabled={phase !== "idle"}
                onClick={spin}
                style={{ height: 60, padding: "0 28px", fontSize: 24 }}
              >
                🎡 {st.settings.topic} 뽑기!
              </button>
            </>
          }
        />
      </div>
    </Shell>
  );
}
