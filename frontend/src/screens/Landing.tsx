import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { DEMO_ROSTER, GAMES, PERSON_COLORS } from "../lib/data";
import { AvatarById } from "../components/Avatar";
import type { GameId } from "../lib/types";

/* 데모 로스터 아바타 = Figma 로스터 (코기·나무늘보·염소·토끼·레서판다·두더지쥐) */
const DEMO_AVATARS = [0, 1, 9, 11, 5, 21];

/* 미리보기 스크린 상단 배지 — 게임마다 다른 진행 상황을 보여준다 */
const DEMO_BADGES: Record<GameId, { left: string; center: string }> = {
  roulette: { left: "◷ 돌리는 중 2초", center: "누가 걸릴까?! 👀" },
  ladder: { left: "◷ 경로 추적 중", center: "누가 어떤 역할 될까?! 🪜" },
  kingmaker: { left: "◷ 개표 중", center: "VOTE! 👑" },
  timer: { left: "◷ 타이머 진행", center: "감으로 멈춰! 💣" },
  snipe: { left: "◷ 투표 9초", center: "🔒 쉿! 조준 중" },
  nunchi: { left: "◷ ROUND 1", center: "혼자 눌러야 통과 👀" },
};

/* ============ S-01 표지 (레이어 542:195) ============ */
export function Landing() {
  const goto = useApp((s) => s.goto);
  const tryJoin = useApp((s) => s.tryJoin);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [demoGame, setDemoGame] = useState<GameId>("roulette");

  const join = async () => {
    if (code.length !== 6) return;
    setCodeError(null);
    const r = await tryJoin(code);
    if (r === "notfound") setCodeError("방을 찾을 수 없어요");
  };

  return (
    <>
      <div className="bg-grid" />
      {/* 셸 — 보더 6.33 · r4.2 · 코너칩 */}
      <div className="shell" />
      {[
        { left: 29, top: 23 },
        { right: 29, top: 23 },
        { left: 29, bottom: 23 },
        { right: 29, bottom: 23 },
      ].map((pos, i) => (
        <div key={i} className="shell-corner" style={pos} />
      ))}

      {/* 로고 — NanumGothicCoding 24 시안 @45,38 */}
      <div
        className="f-meta"
        style={{
          position: "absolute",
          left: 45,
          top: 38,
          color: "var(--cyan)",
          fontSize: 24,
        }}
      >
        ◆ MODU-PICK
      </div>

      {/* 러닝 밴드(Nav) — 955×58 @915,31 · 흰 밴드 + ink 텍스트 · 좌→우 */}
      <div
        style={{
          position: "absolute",
          left: 915,
          top: 31,
          width: 953,
          height: 58,
          background: "var(--white)",
          border: "3.16px solid var(--ink)",
          borderRadius: 6,
          boxShadow: "4.2px 4.2px 0 var(--ink)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          zIndex: 2,
        }}
      >
        <div
          style={{
            whiteSpace: "nowrap",
            fontFamily: "var(--font-black)",
            fontSize: 17,
            color: "var(--ink)",
            animation: "marquee-ltr 18s linear infinite",
          }}
        >
          {Array.from({ length: 2 }).map((_, i) => (
            <span key={i}>
              &nbsp;설치도 로그인도 없이 !! · 팀 역할 정하기를 게임처럼 !! ·
              결과는 서버가, 재미는 모두가 !! · 설치도 로그인도 없이 !! · 팀
              역할 정하기를 게임처럼 !! · 결과는 서버가, 재미는 모두가 !! ·
            </span>
          ))}
        </div>
      </div>

      {/* 히어로 배지 — 핑크 pill 289×40 @105,112 · Gothic A1 20 */}
      <div
        className="f-sub"
        style={{
          position: "absolute",
          left: 105,
          top: 112,
          height: 40,
          background: "var(--pink)",
          border: "2.5px solid var(--ink)",
          borderRadius: 40,
          padding: "0 22px",
          display: "flex",
          alignItems: "center",
          fontSize: 20,
        }}
      >
        ◆ 팀장·역할, 눈치싸움 없이
      </div>

      {/* 헤드라인 3줄 — Black Han 134.4 + 하드 텍스트 섀도우 (레이어 실측 좌표) */}
      {[
        { text: "모두가", color: "var(--yellow)", left: 105, top: 204 },
        { text: "납득하는", color: "var(--pink)", left: 81, top: 343 },
        { text: "유쾌한 픽", color: "#fff", left: 115, top: 475 },
      ].map((l) => (
        <div
          key={l.text}
          style={{
            position: "absolute",
            left: l.left,
            top: l.top,
            fontFamily: "var(--font-black)",
            fontSize: 134.4,
            lineHeight: "134px",
            color: l.color,
            textShadow: "6.6px 6.6px 0 var(--ink)",
            whiteSpace: "nowrap",
          }}
        >
          {l.text}
        </div>
      ))}

      {/* CTA — 231×80 ink r8 · 옐로 텍스트 (레이어) */}
      <button
        onClick={() => goto("create")}
        style={{
          position: "absolute",
          left: 103,
          top: 649,
          width: 231,
          height: 80,
          background: "var(--ink)",
          borderRadius: 8,
          color: "var(--yellow)",
          fontFamily: "var(--font-black)",
          fontSize: 24,
          boxShadow: "5px 5px 0 rgba(14,13,20,.4)",
        }}
      >
        ▶ 새 방 만들기
      </button>

      {/* 코드 입력 — 388×80 r8 + 참여 81×56 핑크 내접 */}
      <div style={{ position: "absolute", left: 376, top: 649 }}>
        {/* 힌트·에러는 입력 박스 '위'에 — 아래는 '▶ 6종 미니게임' 줄과 겹침 */}
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 2,
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 12,
            whiteSpace: "nowrap",
          }}
        >
          {codeError && (
            <span
              className="f-meta"
              style={{ color: "var(--pink)", fontWeight: 700 }}
            >
              ⚠ {codeError}
            </span>
          )}
          <span className="f-meta" style={{ color: "rgba(255,255,255,.6)" }}>
            팁: 427132 는 진행 중인 방 코드예요
          </span>
        </div>
        <div
          style={{
            width: 388,
            height: 80,
            background: "var(--white)",
            border: `3.16px solid ${codeError ? "var(--pink)" : "var(--ink)"}`,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            padding: "0 8px 0 15px",
            gap: 4,
          }}
        >
          <span
            className="f-meta"
            style={{ fontSize: 26, color: "rgba(14,13,20,.85)" }}
          >
            MODU-
          </span>
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setCodeError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder="_ _ _ _ _ _"
            className="f-meta"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              fontSize: 24,
              letterSpacing: 2,
            }}
          />
          <button
            className="f-sub"
            disabled={code.length !== 6}
            onClick={join}
            style={{
              width: 81,
              height: 56,
              borderRadius: 6,
              background: code.length === 6 ? "var(--pink)" : "var(--track)",
              color: code.length === 6 ? "var(--ink)" : "#9d9aa8",
              border: "2.5px solid var(--ink)",
              fontSize: 24,
              fontFamily: "var(--font-gothic)",
              flex: "none",
            }}
          >
            참여
          </button>
        </div>
      </div>

      {/* 데모 패널 (레이어: Demo Panel 953×643 @915,100) */}
      <DemoPanel game={demoGame} />

      {/* ▶ 6종 미니게임 + »»» */}
      <div
        style={{
          position: "absolute",
          left: 36,
          top: 742,
          color: "#fff",
          fontFamily: "var(--font-black)",
          fontSize: 28,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        ▶ 6종 미니게임
        <span className="f-meta" style={{ color: "rgba(255,255,255,.6)" }}>
          카드에 올리면 데모가 바뀌어요
        </span>
        <span
          style={{ color: "var(--yellow)", fontSize: 30, letterSpacing: 4 }}
        >
          »»»
        </span>
      </div>
      <GameSlider active={demoGame} onPick={setDemoGame} />
    </>
  );
}

/* ---------- 데모 패널 — 퍼플 스크린 + 참가자 리스트 + 재생바 (레이어) ---------- */
function DemoPanel({ game }: { game: GameId }) {
  const meta = GAMES.find((g) => g.id === game)!;
  const [t, setT] = useState(14);
  useEffect(() => {
    const iv = window.setInterval(() => setT((v) => (v + 1) % 31), 1000);
    return () => window.clearInterval(iv);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: 915,
        top: 100,
        width: 953,
        height: 643,
        background: "var(--white)",
        border: "6.8px solid var(--ink)",
        borderRadius: 13.6,
        boxShadow: "8px 8px 0 var(--ink)",
        zIndex: 1,
      }}
    >
      {/* 패널 헤더 */}
      <div
        style={{
          position: "absolute",
          left: 28,
          top: 22,
          fontFamily: "var(--font-black)",
          fontSize: 31,
        }}
      >
        ◆ {meta.name}
      </div>
      <span
        className="f-meta"
        style={{
          position: "absolute",
          left: 787,
          top: 23,
          background: "var(--pink)",
          border: "3.4px solid var(--ink)",
          borderRadius: 54,
          color: "#fff",
          padding: "8px 16px",
        }}
      >
        ● 미리보기
      </span>

      {/* 스크린 — 퍼플 596×408 @28,113 */}
      <div
        style={{
          position: "absolute",
          left: 28.6,
          top: 113,
          width: 596.5,
          height: 408.6,
          background: "var(--bg-purple)",
          border: "4px solid var(--ink)",
          borderRadius: 13.6,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          className="f-meta"
          style={{
            position: "absolute",
            left: 17.7,
            top: 17.7,
            background: "var(--yellow)",
            border: "2.7px solid var(--ink)",
            borderRadius: 54,
            padding: "5px 12px",
            fontSize: 15,
            zIndex: 2,
          }}
        >
          {DEMO_BADGES[game].left}
        </span>
        <span
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            top: 8,
            background: "var(--ink)",
            color: "var(--yellow)",
            border: "2px solid var(--ink)",
            borderRadius: 9.5,
            padding: "5px 12px",
            fontFamily: "var(--font-black)",
            fontSize: 15,
            zIndex: 2,
            whiteSpace: "nowrap",
          }}
        >
          {DEMO_BADGES[game].center}
        </span>
        {game === "roulette" && <MiniRoulette />}
        {game === "ladder" && <MiniLadder />}
        {game === "kingmaker" && <MiniKingmaker />}
        {game === "timer" && <MiniTimeCatch />}
        {game === "snipe" && <MiniSniper />}
        {game === "nunchi" && <MiniNunchi />}
      </div>

      {/* 참가자 리스트 — 261×379 @651,150 */}
      <div style={{ position: "absolute", left: 655, top: 118 }}>
        <div
          className="f-meta"
          style={{ fontSize: 17.7, color: "rgba(14,13,20,.7)" }}
        >
          ◆ 참가자 · 6명
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10.5,
            marginTop: 14,
          }}
        >
          {DEMO_ROSTER.map((n, i) => (
            <div
              key={n}
              style={{
                width: 256,
                height: 54.5,
                border: "2.7px solid var(--ink)",
                borderRadius: 12.3,
                background: "var(--white)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "0 10px",
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: PERSON_COLORS[i],
                  border: "2.5px solid var(--ink)",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                }}
              >
                <AvatarById id={DEMO_AVATARS[i]} size={29} />
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-black)", fontSize: 19 }}>
                  {n}
                </div>
                <div
                  className="f-meta"
                  style={{
                    fontSize: 12.3,
                    color: i === 0 ? "var(--ink)" : "var(--green)",
                  }}
                >
                  {i === 0 ? "👑 방장 · 접속" : "● 접속 중"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 재생 컨트롤 */}
      <div
        style={{
          position: "absolute",
          left: 28.6,
          top: 541,
          width: 60,
          height: 60,
          background: "var(--ink)",
          borderRadius: 13.6,
          color: "var(--yellow)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-black)",
          fontSize: 24.5,
        }}
      >
        ▶
      </div>
      <div
        style={{
          position: "absolute",
          left: 106,
          top: 563,
          width: 580,
          height: 16,
          background: "var(--track)",
          border: "2.5px solid var(--ink)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${(t / 30) * 100}%`,
            height: "100%",
            background: "var(--pink)",
            transition: "width 1s linear",
          }}
        />
      </div>
      <span
        className="f-meta"
        style={{
          position: "absolute",
          left: 707,
          top: 562,
          fontSize: 17.7,
          color: "rgba(14,13,20,.6)",
        }}
      >
        0:{String(t).padStart(2, "0")} / 0:30
      </span>
    </div>
  );
}

/** 표지 데모 미니 룰렛 — 벌브 12 + 허브 + 포인터 (레이어 Screen 재현) */
function MiniRoulette() {
  const angleRef = useRef(0);
  const [, force] = useState(0);
  useEffect(() => {
    let raf: number;
    const tick = () => {
      angleRef.current = (angleRef.current + 1.6) % 360;
      force((v) => v + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const slices = useMemo(
    () =>
      DEMO_ROSTER.map((n, i) => {
        const a0 = (i * 60 - 90) * (Math.PI / 180);
        const a1 = ((i + 1) * 60 - 90) * (Math.PI / 180);
        const p = (a: number) =>
          `${150 + 130 * Math.cos(a)} ${150 + 130 * Math.sin(a)}`;
        return {
          d: `M 150 150 L ${p(a0)} A 130 130 0 0 1 ${p(a1)} Z`,
          color: PERSON_COLORS[i],
          name: n,
          mid: (i * 60 + 30 - 90) * (Math.PI / 180),
          avatarId: DEMO_AVATARS[i],
        };
      }),
    [],
  );
  return (
    <svg
      width={330}
      height={330}
      viewBox="0 0 300 300"
      style={{ marginTop: 18 }}
    >
      <g transform={`rotate(${angleRef.current} 150 150)`}>
        {slices.map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill={s.color}
            stroke="var(--ink)"
            strokeWidth={4}
          />
        ))}
        {/* 벌브 12 (레이어: Bulb 1~12) */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <circle
              key={i}
              cx={150 + 138 * Math.cos(a)}
              cy={150 + 138 * Math.sin(a)}
              r={4.8}
              fill="var(--yellow)"
              stroke="var(--ink)"
              strokeWidth={2}
            />
          );
        })}
        {slices.map((s, i) => (
          <text
            key={`t${i}`}
            x={150 + 92 * Math.cos(s.mid)}
            y={150 + 92 * Math.sin(s.mid) + 6}
            textAnchor="middle"
            fontFamily="Black Han Sans"
            fontSize={19}
            fill="#0E0D14"
          >
            {s.name}
          </text>
        ))}
      </g>
      <circle
        cx={150}
        cy={150}
        r={40}
        fill="#fff"
        stroke="var(--ink)"
        strokeWidth={5}
      />
      <text
        x={150}
        y={158}
        textAnchor="middle"
        fontFamily="Black Han Sans"
        fontSize={22}
        fill="#0E0D14"
      >
        PICK!
      </text>
      <path
        d="M 138 4 L 162 4 L 150 28 Z"
        fill="var(--pink)"
        stroke="var(--ink)"
        strokeWidth={4}
      />
    </svg>
  );
}

/* ---------- 표지 데모 공통 ---------- */

/** ms 주기로 0→1을 반복하는 진행률 */
function useLoop(ms: number) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setP(((now - t0) % ms) / ms);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
  return p;
}

/** 데모용 아바타 원 (person색 + 캐릭터) */
function DemoDisc({ i, size = 40 }: { i: number; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: PERSON_COLORS[i],
        border: "3px solid var(--ink)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <AvatarById id={DEMO_AVATARS[i]} size={size * 0.78} />
    </div>
  );
}

/** 사다리 — 6인이 레인을 타고 내려가는 레이스 */
function MiniLadder() {
  const p = useLoop(6200);
  const W = 540;
  const TOP = 30;
  const H = 236;
  const N = 6;
  const xs = useMemo(
    () => Array.from({ length: N }, (_, i) => 40 + (i * (W - 80)) / (N - 1)),
    [],
  );
  const rungs = useMemo(
    () =>
      [
        [34, 0],
        [34, 3],
        [76, 1],
        [76, 4],
        [118, 2],
        [118, 0],
        [160, 3],
        [160, 1],
        [200, 4],
        [200, 2],
      ].map(([dy, c]) => ({ y: TOP + dy, c })),
    [],
  );
  const paths = useMemo(
    () =>
      xs.map((_, start) => {
        let c = start;
        const pts: [number, number][] = [[xs[c], TOP]];
        for (const r of [...rungs].sort((a, b) => a.y - b.y)) {
          if (r.c === c) {
            pts.push([xs[c], r.y], [xs[c + 1], r.y]);
            c += 1;
          } else if (r.c === c - 1) {
            pts.push([xs[c], r.y], [xs[c - 1], r.y]);
            c -= 1;
          }
        }
        pts.push([xs[c], TOP + H]);
        return pts;
      }),
    [xs, rungs],
  );
  /** 경로 위 진행률 f 지점 */
  const at = (pts: [number, number][], f: number): [number, number] => {
    const segs = pts
      .slice(1)
      .map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
    let left = segs.reduce((a, b) => a + b, 0) * Math.min(1, f);
    for (let i = 0; i < segs.length; i++) {
      if (left > segs[i]) {
        left -= segs[i];
        continue;
      }
      const t = segs[i] ? left / segs[i] : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      ];
    }
    return pts[pts.length - 1];
  };
  /* 편차가 작으면 6명이 한 줄로 뭉쳐 레이스로 안 보인다 — 계단식으로 흩어지게 */
  const speeds = [1.3, 1.0, 1.18, 1.06, 1.42, 1.12];

  return (
    <svg
      width={W}
      height={330}
      viewBox={`0 0 ${W} 330`}
      style={{ marginTop: 14 }}
    >
      {xs.map((x, i) => (
        <line
          key={`l${i}`}
          x1={x}
          y1={TOP}
          x2={x}
          y2={TOP + H}
          stroke={PERSON_COLORS[i]}
          strokeWidth={6}
          strokeLinecap="round"
        />
      ))}
      {rungs.map((r, i) => (
        <line
          key={`r${i}`}
          x1={xs[r.c]}
          y1={r.y}
          x2={xs[r.c + 1]}
          y2={r.y}
          stroke="#fff"
          strokeWidth={6}
          strokeLinecap="round"
        />
      ))}
      {/* 하단 역할 슬롯 */}
      {xs.map((x, i) => (
        <g key={`s${i}`} transform={`translate(${x - 38}, ${TOP + H + 14})`}>
          <rect
            width={76}
            height={34}
            rx={9}
            fill={PERSON_COLORS[i]}
            stroke="var(--ink)"
            strokeWidth={3}
          />
          <text
            x={38}
            y={23}
            textAnchor="middle"
            fontFamily="Black Han Sans"
            fontSize={16}
            fill="#0E0D14"
          >
            ?
          </text>
        </g>
      ))}
      {/* 주자 — 위치는 경로 위 그대로(밀어내면 레인을 벗어나 허공에 뜬다).
          대신 이름칩 높이를 이웃끼리 어긋나게 해 서로 포개지지 않게 한다. */}
      {(() => {
        const pos = paths.map(
          (pts, i) => at(pts, Math.min(1, p * speeds[i])) as [number, number],
        );
        // 같은 레인을 나란히 내려가면 원이 포개진다 — 세로로만 벌린다(레인은 안 벗어남)
        for (let a = 0; a < pos.length; a++)
          for (let b = a + 1; b < pos.length; b++) {
            if (Math.abs(pos[a][0] - pos[b][0]) > 10) continue;
            const dy = pos[a][1] - pos[b][1];
            if (Math.abs(dy) >= 36) continue;
            const push = (36 - Math.abs(dy)) / 2;
            const s = dy >= 0 ? 1 : -1;
            pos[a][1] += s * push;
            pos[b][1] -= s * push;
          }
        const off = pos.map(() => 0); // 칩만 좌우로 비킨다
        for (let a = 0; a < pos.length; a++)
          for (let b = a + 1; b < pos.length; b++) {
            const dx = pos[a][0] + off[a] - (pos[b][0] + off[b]);
            if (Math.abs(dx) < 62 && Math.abs(pos[a][1] - pos[b][1]) < 30) {
              const push = (62 - Math.abs(dx)) / 2 + 2;
              const s = dx >= 0 ? 1 : -1;
              off[a] += s * push;
              off[b] -= s * push;
            }
          }
        return pos.map(([x, y], i) => ({ x, y, ox: off[i] }));
      })().map(({ x: cx, y: cy, ox }, i) => {
        const lift = i % 2 ? 48 : 27;
        return (
          <g key={`h${i}`}>
            <line
              x1={cx}
              y1={cy - 13}
              x2={cx + ox}
              y2={cy - lift + 9}
              stroke="var(--ink)"
              strokeWidth={2}
            />
            <g transform={`translate(${cx + ox}, ${cy - lift})`}>
              <rect
                x={-28}
                y={-11}
                width={56}
                height={22}
                rx={11}
                fill={PERSON_COLORS[i]}
                stroke="var(--ink)"
                strokeWidth={2.5}
              />
              <text
                y={6}
                textAnchor="middle"
                fontFamily="Black Han Sans"
                fontSize={13}
                fill="#0E0D14"
              >
                {DEMO_ROSTER[i]}
              </text>
            </g>
            <circle
              cx={cx}
              cy={cy}
              r={15}
              fill={PERSON_COLORS[i]}
              stroke="var(--ink)"
              strokeWidth={3.5}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** 킹메이커 — 익명 아이디어가 표를 받아 게이지가 차오른다 */
function MiniKingmaker() {
  const IDEAS = ["눈치백단 크루", "야근은 없다", "커피는 셀프"];
  const ORDER = [0, 2, 0, 1, 0, 1, 2];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(
      () => setStep((s) => (s + 1) % (ORDER.length + 3)),
      620,
    );
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const votes = [0, 0, 0];
  ORDER.slice(0, step).forEach((k) => (votes[k] += 1));
  const total = Math.max(
    1,
    votes.reduce((a, b) => a + b, 0),
  );
  const lead = votes.indexOf(Math.max(...votes));

  return (
    <div
      style={{ width: 520, display: "flex", flexDirection: "column", gap: 16 }}
    >
      {IDEAS.map((text, i) => (
        <div
          key={text}
          style={{
            background: "var(--white)",
            border: "3.5px solid var(--ink)",
            borderRadius: 12,
            boxShadow: "4px 4px 0 var(--ink)",
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-black)",
              fontSize: 19,
              width: 152,
            }}
          >
            {votes[i] > 0 && i === lead ? "👑 " : ""}
            {text}
          </span>
          <div
            style={{
              flex: 1,
              height: 20,
              background: "var(--track)",
              border: "2.5px solid var(--ink)",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${(votes[i] / total) * 100}%`,
                height: "100%",
                background: i === lead ? "var(--green)" : "var(--cyan)",
                transition: "width .45s ease",
              }}
            />
          </div>
          <span className="f-meta" style={{ width: 34, textAlign: "right" }}>
            {votes[i]}표
          </span>
        </div>
      ))}
      <div
        className="f-meta"
        style={{ color: "rgba(255,255,255,.75)", textAlign: "center" }}
      >
        🔒 누가 냈는지 · 누가 찍었는지 아무도 몰라요
      </div>
    </div>
  );
}

/** 시간초 잡기 — 2초 뒤 블라인드, 감으로 STOP */
function MiniTimeCatch() {
  const p = useLoop(6000);
  const t = p * 6;
  const masked = t > 2 && t < 4.6;
  const stopped = t >= 4.6;
  return (
    <div style={{ textAlign: "center", color: "#fff" }}>
      <div className="f-meta" style={{ color: "rgba(255,255,255,.8)" }}>
        🎯 목표 5.00초
      </div>
      <div
        style={{
          fontFamily: "var(--font-black)",
          fontSize: 108,
          lineHeight: "112px",
          color: stopped ? "var(--yellow)" : "#fff",
        }}
      >
        {stopped ? "4.87" : masked ? "?.??" : t.toFixed(2)}
      </div>
      <div
        className="f-btn"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 250,
          height: 62,
          marginTop: 10,
          borderRadius: 12,
          border: "3.5px solid var(--ink)",
          boxShadow: "4px 4px 0 var(--ink)",
          background: stopped ? "var(--track)" : "var(--red)",
          color: stopped ? "#6b6878" : "#fff",
          fontSize: 28,
          animation: masked ? "pulse-soft .9s ease-in-out infinite" : undefined,
        }}
      >
        {stopped ? "✓ 기록 완료" : "STOP"}
      </div>
      <div
        className="f-meta"
        style={{ color: "rgba(255,255,255,.75)", marginTop: 12 }}
      >
        {stopped
          ? "오차 0.13초 · 서버 시각 기준"
          : masked
            ? "숫자가 가려졌어요 — 이제 감으로!"
            : "2초까지만 보여요"}
      </div>
    </div>
  );
}

/** 익명 저격 — 조준경이 후보 사이를 옮겨 다닌다 (결과는 감춤) */
function MiniSniper() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setIdx((i) => (i + 1) % 6), 820);
    return () => window.clearInterval(iv);
  }, []);
  return (
    <div style={{ width: 520 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
        }}
      >
        {DEMO_ROSTER.map((nick, i) => {
          const aimed = i === idx;
          return (
            <div
              key={nick}
              style={{
                height: 118,
                borderRadius: 12,
                border: `3.5px solid ${aimed ? "var(--red)" : "var(--ink)"}`,
                background: aimed ? "#fff" : "rgba(255,255,255,.86)",
                boxShadow: aimed
                  ? "0 0 0 5px rgba(250,92,87,.35)"
                  : "3px 3px 0 var(--ink)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "box-shadow .2s ease, border-color .2s ease",
              }}
            >
              <div style={{ position: "relative" }}>
                <DemoDisc i={i} size={44} />
                {aimed && (
                  <div
                    style={{
                      position: "absolute",
                      inset: -9,
                      borderRadius: "50%",
                      border: "3px solid var(--red)",
                    }}
                  />
                )}
              </div>
              <span style={{ fontFamily: "var(--font-black)", fontSize: 17 }}>
                {nick}
              </span>
              <span
                className="f-meta"
                style={{ fontSize: 12, color: "#6b6878" }}
              >
                {aimed ? "🎯 조준!" : "조준 중…"}
              </span>
            </div>
          );
        })}
      </div>
      <div
        className="f-meta"
        style={{
          color: "rgba(255,255,255,.78)",
          textAlign: "center",
          marginTop: 14,
        }}
      >
        누가 누구를 지목했는지는 끝까지 비공개
      </div>
    </div>
  );
}

/** 눈치게임 — UP 순서가 하나씩 쌓인다 */
function MiniNunchi() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setStep((s) => (s + 1) % 6), 780);
    return () => window.clearInterval(iv);
  }, []);
  const pressed = Math.min(4, step);
  return (
    <div style={{ width: 520, textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
        {DEMO_ROSTER.slice(0, 5).map((nick, i) => {
          const up = i < pressed;
          return (
            <div
              key={nick}
              style={{
                width: 92,
                height: 96,
                borderRadius: 12,
                border: "3.5px solid var(--ink)",
                background: up ? "#B9F5D8" : "var(--yellow)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <DemoDisc i={i} size={38} />
              <span style={{ fontFamily: "var(--font-black)", fontSize: 15 }}>
                {nick}
              </span>
              <span className="f-meta" style={{ fontSize: 11 }}>
                {up ? `${i + 1}번째` : "눈치 중"}
              </span>
            </div>
          );
        })}
      </div>
      <div
        className="f-btn"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 208,
          height: 72,
          marginTop: 18,
          borderRadius: 14,
          border: "4px dashed var(--red)",
          background: "var(--red)",
          color: "#fff",
          fontSize: 34,
          animation: "pulse-soft .8s ease-in-out infinite",
        }}
      >
        ▲ UP!
      </div>
      <div
        className="f-meta"
        style={{ color: "rgba(255,255,255,.78)", marginTop: 12 }}
      >
        지금 누르면 → {pressed + 1}번째 · 겹치면 둘 다 탈락
      </div>
    </div>
  );
}

/* ---------- 게임 슬라이더 — 좌→우 마퀴 + 스피드 라인 (레이어 Game Slider (→)) ---------- */
function GameSlider({
  active,
  onPick,
}: {
  active: GameId;
  onPick: (g: GameId) => void;
}) {
  const tilt = [2.5, -1.5, 1.5, -2.5, 2, -1];
  return (
    <div
      style={{
        position: "absolute",
        left: 22,
        top: 790,
        width: 1876,
        height: 262,
        overflow: "hidden",
      }}
    >
      {/* 스피드 라인 */}
      {[
        { w: 820, h: 9, top: 18 },
        { w: 640, h: 6, top: 66 },
        { w: 1140, h: 6, top: 118 },
        { w: 1000, h: 11, top: 168 },
        { w: 900, h: 9, top: 214 },
      ].map((l, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: (i * 397) % 1500,
            top: l.top,
            width: l.w,
            height: l.h,
            background: "rgba(255,255,255,.12)",
            borderRadius: l.h / 2,
          }}
        />
      ))}
      <div
        className="marquee-rail"
        style={{ gap: 25, paddingRight: 25, paddingTop: 8 }}
      >
        {[0, 1].map((copy) =>
          GAMES.map((g, gi) => (
            <button
              key={`${copy}-${g.id}`}
              onClick={() => onPick(g.id)}
              onMouseEnter={() => onPick(g.id)}
              style={{
                width: 288,
                height: 228,
                flex: "none",
                background: g.tint,
                border: "5px solid var(--ink)",
                borderRadius: 18,
                boxShadow:
                  active === g.id
                    ? "8px 8px 0 var(--ink)"
                    : "5px 5px 0 var(--ink)",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: 16,
                gap: 4,
                position: "relative",
                overflow: "hidden",
                transform: `rotate(${tilt[gi]}deg)${active === g.id ? " translateY(-6px)" : ""}`,
                transition: "transform .15s ease, box-shadow .15s ease",
              }}
            >
              {/* 데코 원 (레이어 Deco) */}
              <div
                style={{
                  position: "absolute",
                  right: -34,
                  bottom: -34,
                  width: 133,
                  height: 133,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,.28)",
                }}
              />
              <span
                className="f-meta"
                style={{ fontSize: 14, color: "rgba(14,13,20,.6)" }}
              >
                {g.no}
              </span>
              <span style={{ fontSize: 52, lineHeight: 1.15 }}>{g.icon}</span>
              <span style={{ fontFamily: "var(--font-black)", fontSize: 25.2 }}>
                {g.name}
              </span>
              <span
                className="f-meta"
                style={{ fontSize: 15, color: "rgba(14,13,20,.72)" }}
              >
                {g.sliderSub}
              </span>
            </button>
          )),
        )}
      </div>
      {/* 좌우 페이드 마스크 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 120,
          background: "linear-gradient(to right, #5b2de7, transparent)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 120,
          background: "linear-gradient(to left, #5b2de7, transparent)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
