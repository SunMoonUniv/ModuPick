import { useMemo, useRef, useState } from "react";
import { after, useApp } from "../lib/store";
import {
  Shell,
  ScreenHeader,
  StatusBand,
  FairPill,
  TopBadge,
} from "../components/ui";
import { AvatarDisc, AVATAR_IMGS } from "../components/Avatar";
import { pastel } from "../lib/data";

/* ============ S-06 랜덤 사다리 (Figma 542:935) ============ */
/* 시안 구조: 좌 = 보라 그리드 위 사다리 무대(흰 가로선 + person색 레인 + 아바타 레이스 + 하단 캔디 역할칩)
 *            우 = 매칭 현황 흰 카드(행마다 역할 슬롯머신 릴 — 결과는 끝까지 감춘다) */

const SW = 1221; // 무대 폭
const SH = 672; // 무대(SVG) 높이 (도착한 아바타가 역할칩을 덮지 않게 여유)
const PAD = 74; // 좌우 레인 여백
const TOP = 62; // 레인 시작 y
const H = 566; // 레인 길이 (끝이 역할칩 바로 위에 닿게)
const AV = 62; // 아바타 지름

interface Rung {
  level: number; // y
  col: number; // col ↔ col+1 연결
}

export function Ladder() {
  const st = useApp();
  const members = st.members;
  const n = members.length;
  const speedMs =
    st.settings.ladderSpeed === "빠르게"
      ? 2000
      : st.settings.ladderSpeed === "느리게"
        ? 5200
        : 3400;

  const xs = useMemo(
    () =>
      Array.from(
        { length: n },
        (_, i) => PAD + (i * (SW - PAD * 2)) / Math.max(1, n - 1),
      ),
    [n],
  );

  // ---- 서버(시뮬): 사다리 구조 + 역할 배치 확정 (D-16) ----
  const { rungs, roleSlots, paths } = useMemo(() => {
    const rungs: Rung[] = [];
    const levels = 7;
    for (let l = 0; l < levels; l++) {
      // 레벨 그리드에 스냅 — 지터가 크면 가로선이 서로 붙어 지저분해진다
      const y = TOP + 54 + (l * (H - 108)) / (levels - 1);
      const used = new Set<number>();
      for (let c = 0; c < n - 1; c++) {
        if (used.has(c - 1) || used.has(c)) continue;
        if (Math.random() < 0.5) {
          rungs.push({ level: y, col: c });
          used.add(c);
        }
      }
    }
    // 인접 갭마다 최소 1개 보장
    for (let c = 0; c < n - 1; c++) {
      if (!rungs.some((r) => r.col === c)) {
        const l = 1 + Math.floor(Math.random() * (levels - 2));
        rungs.push({
          level: TOP + 54 + (l * (H - 108)) / (levels - 1),
          col: c,
        });
      }
    }
    rungs.sort((a, b) => a.level - b.level);

    // 역할 슬롯: 항목 셔플 + 부족분 빈칸 (US-422)
    const roles = [...st.settings.ladderRoles];
    const slots: (string | null)[] = Array(n).fill(null);
    const order = Array.from({ length: n }, (_, i) => i).sort(
      () => Math.random() - 0.5,
    );
    roles.slice(0, n).forEach((r, i) => (slots[order[i]] = r));

    // 경로 계산 (참가자 i → 도착 컬럼)
    const paths = members.map((_, start) => {
      let c = start;
      const pts: [number, number][] = [[xs[c], TOP]];
      for (const r of rungs) {
        if (r.col === c) {
          pts.push([xs[c], r.level], [xs[c + 1], r.level]);
          c = c + 1;
        } else if (r.col === c - 1) {
          pts.push([xs[c], r.level], [xs[c - 1], r.level]);
          c = c - 1;
        }
      }
      pts.push([xs[c], TOP + H]);
      return { pts, end: c };
    });
    return { rungs, roleSlots: slots, paths };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, st.settings.ladderRoles, st.replay, xs]);

  // ---- 진행 상태 ----
  const [running, setRunning] = useState(false);
  const [frac, setFrac] = useState(0); // 0~1 공통 진행률
  const [elapsed, setElapsed] = useState(0);
  const jitter = useMemo(
    () => members.map(() => 0.82 + Math.random() * 0.36),
    [members],
  );
  const rafRef = useRef(0);
  const [confirmed, setConfirmed] = useState<boolean[]>(() =>
    members.map(() => false),
  );

  const start = () => {
    if (running) return; // 최초 1회만 (US-309)
    setRunning(true);
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / (speedMs * 1.25));
      setFrac(p);
      setElapsed((now - t0) / 1000);
      setConfirmed(members.map((_, i) => p * jitter[i] * 1.25 >= 1));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else {
        setConfirmed(members.map(() => true));
        after(3000, () => {
          st.finishGame({
            variant: "assign",
            game: "ladder",
            purpose: st.settings.topic,
            pairs: members.map((m, i) => ({
              id: m.id,
              roleLabel: roleSlots[paths[i].end] ?? "",
            })),
            stats: [
              { label: "참가자", value: `${n}명` },
              {
                label: "역할 항목",
                value: `${st.settings.ladderRoles.length}개`,
              },
              { label: "진행 속도", value: st.settings.ladderSpeed },
            ],
          });
        });
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  /** 경로 부분 렌더 (개인별 진행률) */
  const partialPath = (pts: [number, number][], f: number) => {
    if (f >= 1) return pts;
    const segs: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(
        pts[i][0] - pts[i - 1][0],
        pts[i][1] - pts[i - 1][1],
      );
      segs.push(d);
      total += d;
    }
    let left = total * f;
    const out: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (left >= segs[i - 1]) {
        out.push(pts[i]);
        left -= segs[i - 1];
      } else {
        const t = left / segs[i - 1];
        out.push([
          pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
          pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
        ]);
        break;
      }
    }
    return out;
  };

  /** 경로 끝에서 거슬러 올라간 코멧 꼬리 구간 */
  const tailOf = (pts: [number, number][], len = 92) => {
    const out: [number, number][] = [pts[pts.length - 1]];
    let left = len;
    for (let i = pts.length - 1; i > 0; i--) {
      const [x1, y1] = pts[i];
      const [x0, y0] = pts[i - 1];
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d <= left) {
        out.push(pts[i - 1]);
        left -= d;
      } else {
        const t = left / d;
        out.push([x1 + (x0 - x1) * t, y1 + (y0 - y1) * t]);
        break;
      }
    }
    return out;
  };

  const doneCount = confirmed.filter(Boolean).length;
  /** 각자 현재 위치 (대기 중이면 출발선) — 겹치면 좌우로 벌려 아바타·네임칩이 포개지지 않게 */
  const heads = useMemo(() => {
    const pos = paths.map((p, i) => {
      if (!running) return [...p.pts[0]] as [number, number];
      const f = Math.min(1, frac * jitter[i] * 1.25);
      const seg = partialPath(p.pts, f);
      return [...seg[seg.length - 1]] as [number, number];
    });
    for (let a = 0; a < pos.length; a++) {
      for (let b = a + 1; b < pos.length; b++) {
        const dx = pos[a][0] - pos[b][0];
        const dy = pos[a][1] - pos[b][1];
        if (Math.abs(dx) < AV + 6 && Math.abs(dy) < AV * 0.95) {
          const push = (AV + 6 - Math.abs(dx)) / 2 + 2;
          const s = dx >= 0 ? 1 : -1;
          pos[a][0] += s * push;
          pos[b][0] -= s * push;
        }
      }
    }
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, running, frac, jitter]);

  /* 릴에 흘릴 역할 목록 — 결과를 감추려 실제 배정과 무관하게 섞어 돌린다 */
  const reelItems = useMemo(() => {
    const base = st.settings.ladderRoles.length
      ? [...st.settings.ladderRoles]
      : ["팀장"];
    while (base.length < 4) base.push(...st.settings.ladderRoles, "???");
    return base.slice(0, 6);
  }, [st.settings.ladderRoles]);

  return (
    <Shell>
      <div className="content">
        <ScreenHeader
          title="랜덤 사다리"
          en="LADDER PICK"
          sub={`● ${st.settings.topic} · ${running ? "경로 추적 중" : "출발 대기"} · 방 MODU-${st.roomCode}`}
          onGuide={st.reopenGuide}
          right={
            <>
              <button
                className="btn btn-ink"
                disabled={running}
                onClick={start}
                style={{ height: 52, padding: "0 24px", fontSize: 21 }}
              >
                🪜 동시 시작!
              </button>
              <TopBadge color="var(--yellow)">
                {running
                  ? `⏱ 경로 추적 중… ${elapsed.toFixed(0)}s`
                  : "GO GO! 🪜"}
              </TopBadge>
              <TopBadge color="var(--green)">◉ {n}명 접속</TopBadge>
            </>
          }
        />

        <div style={{ display: "flex", gap: 30, marginTop: 22, height: 745 }}>
          {/* ── 좌: 사다리 무대 (시안대로 보라 그리드 위 직접) ── */}
          <div style={{ width: SW, position: "relative", flex: "none" }}>
            <svg width={SW} height={SH} style={{ display: "block" }}>
              {/* 레인 (참가자 고유색) */}
              {xs.map((x, i) => (
                <line
                  key={`lane-${i}`}
                  x1={x}
                  y1={TOP}
                  x2={x}
                  y2={TOP + H}
                  stroke={members[i]?.color}
                  strokeWidth={9}
                  strokeLinecap="round"
                />
              ))}
              {/* 가로 rung — 시안은 흰색 (보라 배경 위 대비) */}
              {rungs.map((r, i) => (
                <line
                  key={`rung-${i}`}
                  x1={xs[r.col]}
                  y1={r.level}
                  x2={xs[r.col + 1]}
                  y2={r.level}
                  stroke="#fff"
                  strokeWidth={9}
                  strokeLinecap="round"
                />
              ))}
              {/* 코멧 꼬리 — 경로 전체를 person색으로 덧칠하면 남의 레인 색을 덮어
                  컬럼 색 흐름(레인→아바타→역할칩)이 꼬인다. 지나온 자취는 짧게만. */}
              {running &&
                paths.map((p, i) => {
                  const f = Math.min(1, frac * jitter[i] * 1.25);
                  const pts = partialPath(p.pts, f);
                  if (pts.length < 2) return null;
                  const tail = tailOf(pts, 118);
                  const pl = tail.map((q) => q.join(",")).join(" ");
                  return (
                    <g key={`trace-${i}`}>
                      <polyline
                        points={pl}
                        fill="none"
                        stroke={members[i].color}
                        strokeWidth={13}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.85}
                      />
                      <polyline
                        points={pl}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.6}
                      />
                    </g>
                  );
                })}
              {/* 도착 지점 커넥터 — 레인 끝과 역할칩을 잇는 짧은 꼭지 */}
              {xs.map((x, i) => (
                <circle
                  key={`foot-${i}`}
                  cx={x}
                  cy={TOP + H}
                  r={9}
                  fill={members[i]?.color}
                  stroke="var(--ink)"
                  strokeWidth={3.5}
                />
              ))}
              {/* 아바타 레이스 (네임칩 + 캐릭터) */}
              {members.map((m, i) => {
                const [hx, hy] = heads[i];
                const r = AV / 2;
                return (
                  <g key={m.id} transform={`translate(${hx}, ${hy})`}>
                    <g transform={`translate(0, ${-r - 15})`}>
                      <rect
                        x={-42}
                        y={-15}
                        width={84}
                        height={30}
                        rx={15}
                        fill={m.color}
                        stroke="var(--ink)"
                        strokeWidth={3}
                      />
                      <text
                        y={7}
                        textAnchor="middle"
                        fontFamily="Black Han Sans"
                        fontSize={18}
                        fill="var(--ink)"
                      >
                        {m.nick}
                      </text>
                    </g>
                    <circle
                      r={r}
                      fill={m.color}
                      stroke="var(--ink)"
                      strokeWidth={3.5}
                    />
                    <clipPath id={`av-clip-${m.id}`}>
                      <circle r={r - 4} />
                    </clipPath>
                    <image
                      href={AVATAR_IMGS[m.avatarId] ?? AVATAR_IMGS[0]}
                      x={-(r - 4)}
                      y={-(r - 4)}
                      width={(r - 4) * 2}
                      height={(r - 4) * 2}
                      clipPath={`url(#av-clip-${m.id})`}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  </g>
                );
              })}
            </svg>

            {/* 하단 역할칩 — 레인 색으로 컬럼 흐름을 잇는다 (시안) */}
            <div style={{ position: "relative", height: 70, marginTop: 6 }}>
              {xs.map((x, i) => {
                const role = roleSlots[i];
                const arrived = confirmed.some(
                  (c, k) => c && paths[k].end === i,
                );
                const owner = members.find((_, k) => paths[k].end === i);
                return (
                  <div
                    key={`role-${i}`}
                    className="f-btn"
                    style={{
                      position: "absolute",
                      left: x,
                      top: 0,
                      transform: `translateX(-50%)${arrived ? " translateY(-3px)" : ""}`,
                      width: 178,
                      height: 62,
                      borderRadius: 14,
                      border: "4px solid var(--ink)",
                      background: role
                        ? arrived && owner
                          ? members[i]?.color
                          : pastel(members[i]?.color ?? "#ffffff", 0.55)
                        : "rgba(255,255,255,.22)",
                      boxShadow: arrived
                        ? "6px 7px 0 var(--ink)"
                        : "4px 5px 0 var(--ink)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                      color: role ? "var(--ink)" : "rgba(255,255,255,.75)",
                      transition: "transform .18s ease, box-shadow .18s ease",
                    }}
                  >
                    {role ?? "빈칸"}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 우: 매칭 현황 = 역할 슬롯머신 (결과는 끝까지 감춘다) ── */}
          <div
            className="card"
            style={{
              flex: 1,
              minWidth: 0,
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div className="f-headline">
              ◆ 매칭 현황
              <span
                className="f-meta"
                style={{ color: "#9d9aa8", marginLeft: 10 }}
              >
                경로를 다 타면 확정!
              </span>
            </div>
            {members.map((m, i) => {
              const done = confirmed[i];
              const role = roleSlots[paths[i].end];
              return (
                <div
                  key={m.id}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    borderRadius: 14,
                    border: "3px solid var(--ink)",
                    background: pastel(m.color, done ? 0.34 : 0.18),
                    boxShadow: "4px 4px 0 var(--ink)",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "0 16px",
                  }}
                >
                  <AvatarDisc avatarId={m.avatarId} color={m.color} size={50} />
                  <span className="f-name" style={{ fontSize: 26 }}>
                    {m.nick}
                  </span>
                  {/* 역할 슬롯 — 돌아가는 릴 + 페이드 마스크 + person색 페이라인 */}
                  <div
                    style={{
                      marginLeft: "auto",
                      position: "relative",
                      width: 200,
                      height: 52,
                      borderRadius: 10,
                      border: "3px solid var(--ink)",
                      background: "var(--white)",
                      overflow: "hidden",
                      flex: "none",
                    }}
                  >
                    {/* 중앙 후보칸 강조 밴드 */}
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: "50%",
                        height: 30,
                        transform: "translateY(-50%)",
                        background: m.color,
                        opacity: done ? 0.3 : 0.16,
                      }}
                    />
                    {done ? (
                      <div
                        className="f-btn"
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 21,
                        }}
                      >
                        {role ? `✓ ${role}` : "— 빈칸"}
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            animation: running
                              ? `reel-spin ${0.62 + i * 0.09}s linear infinite`
                              : `reel-spin ${2.6 + i * 0.3}s linear infinite`,
                          }}
                        >
                          {[...reelItems, ...reelItems].map((r, k) => (
                            <div
                              key={k}
                              className="f-btn"
                              style={{
                                height: 52,
                                lineHeight: "52px",
                                textAlign: "center",
                                fontSize: 21,
                                opacity: 0.3,
                              }}
                            >
                              {r}
                            </div>
                          ))}
                        </div>
                        {/* 위아래 페이드 — 하드 클립은 '잘린 글자'로 보인다 */}
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            pointerEvents: "none",
                            background:
                              "linear-gradient(#fff 6%, rgba(255,255,255,.25) 44%, rgba(255,255,255,.25) 56%, #fff 94%)",
                          }}
                        />
                        <span
                          className="f-name"
                          style={{
                            position: "absolute",
                            right: 12,
                            top: "50%",
                            transform: "translateY(-50%)",
                            color: m.color,
                            fontSize: 26,
                            WebkitTextStroke: "2px var(--ink)",
                          }}
                        >
                          ?
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <StatusBand
          step={doneCount === n ? "🎉" : running ? "2" : "1"}
          title={
            doneCount === n
              ? "배정 확정!"
              : running
                ? "사다리 타는 중…"
                : "참가자·역할 확인하기"
          }
          sub={
            doneCount === n
              ? "3초 후 결과 화면으로 이동해요 · 1인 1역할 · 전원에게 같은 결과"
              : running
                ? `${n}명의 경로를 동시에 추적 · 확정 ${doneCount}/${n} · 조작 불가`
                : "사다리 구조는 서버가 만들었고 전원에게 동일해요"
          }
          right={<FairPill text="결과는 모두에게 똑같이 · 공정" />}
        />
      </div>
    </Shell>
  );
}
