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

/* ============ S-08 시간초 잡기 (시트 09) ============ */
/* 3상태 연출: 대기 → 진행(2초 후 숫자 마스킹) → 비공개 · STOP 1회 · 판정은 서버(시뮬) 시각 */

export function TimeCatch() {
  const st = useApp();
  const members = st.members;
  const n = members.length;
  const target = st.settings.tcTarget;
  const limit = target + 3; // 개인 제한 시간 = 목표 + 3초

  const [started, setStarted] = useState(false); // 내 START
  const [now, setNow] = useState(0); // 내 경과 (초)
  const [myStop, setMyStop] = useState<number | null>(null);
  const [botStops, setBotStops] = useState<Record<string, number>>({});
  const [botRunning, setBotRunning] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState(false);
  const t0Ref = useRef(0);
  const rafRef = useRef(0);

  /* ---- 봇: 각자 START → target±노이즈에 STOP ---- */
  useEffect(() => {
    members
      .filter((m) => !m.isMe)
      .forEach((b, i) => {
        after(600 + i * 700 + Math.random() * 800, () =>
          setBotRunning((s) => new Set(s).add(b.id)),
        );
        const err = (Math.random() * 2 - 1) * (0.15 + Math.random() * 1.1);
        const stopAt = Math.max(0.8, target + err);
        after(1800 + i * 700 + stopAt * 1000, () =>
          setBotStops((prev) => ({
            ...prev,
            [b.id]: Math.round(stopAt * 1000),
          })),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- 내 타이머 ---- */
  const start = () => {
    if (started) return;
    setStarted(true);
    t0Ref.current = performance.now();
    const tick = () => {
      const t = (performance.now() - t0Ref.current) / 1000;
      setNow(t);
      if (t >= limit) {
        // 제한 시간 초과 → 자동 최하위 마감 (games.md §5.5)
        setMyStop(Math.round(limit * 1000));
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!started || myStop !== null) return; // STOP 1회 (US-309)
    cancelAnimationFrame(rafRef.current);
    // performance.now() 차이는 이미 ms — 봇 기록과 같은 ms 단위로 저장
    setMyStop(Math.round(performance.now() - t0Ref.current));
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /* ---- 전원 STOP → 판정 ---- */
  const stops = useMemo(() => {
    const map: Record<string, number> = { ...botStops };
    if (myStop !== null) map[ME_ID] = myStop;
    return map;
  }, [botStops, myStop]);
  const stoppedCount = Object.keys(stops).length;

  useEffect(() => {
    if (stoppedCount < n || revealed) return;
    setRevealed(true);
    after(2600, () => {
      const rows = members.map((m) => {
        const ms = stops[m.id];
        const err = Math.abs(ms - target * 1000);
        return { m, ms, err };
      });
      const asc = st.settings.tcCriteria === "오차가 적은 사람";
      const sorted = [...rows].sort((a, b) =>
        asc ? a.err - b.err : b.err - a.err,
      );
      const win = sorted[0];
      const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}초`;
      const diff = (ms: number) => {
        const d = (ms - target * 1000) / 1000;
        return `${d >= 0 ? "+" : ""}${d.toFixed(2)}`;
      };
      st.finishGame({
        variant: "winner",
        game: "timer",
        winnerId: win.m.id,
        purpose: st.settings.topic,
        stats: [
          { label: "목표 시간", value: `${target.toFixed(2)}초` },
          { label: "당첨 기록", value: fmt(win.ms) },
          { label: "당첨 오차", value: `${(win.err / 1000).toFixed(2)}초` },
        ],
        safe: sorted
          .slice(1)
          .map(({ m, ms }) => ({ id: m.id, note: `${diff(ms)}초` })),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stoppedCount, n, revealed]);

  const masked = started && now >= 2 && myStop === null;
  const myDisplay =
    myStop !== null
      ? revealed
        ? (myStop / 1000).toFixed(2)
        : "기록됨"
      : masked
        ? "?.??"
        : now.toFixed(2);
  const gapDisplay =
    myStop !== null || masked ? "?.??" : Math.max(0, target - now).toFixed(2);

  return (
    <Shell>
      <div className="content">
        <ScreenHeader
          title="시간초 잡기"
          en="TIME CATCH"
          sub={`● ${st.settings.topic} · ${st.settings.tcCriteria} 당첨 · 방 MODU-${st.roomCode}`}
          onGuide={st.reopenGuide}
          right={
            <>
              <TopBadge color="var(--yellow)">🎯 목표 {target}.00s</TopBadge>
              {masked && (
                <TopBadge color="var(--lavender)">🙈 타이머 비공개</TopBadge>
              )}
            </>
          }
        />

        {/* 플레이어 칩 행 (283×80 × n) */}
        <div style={{ display: "flex", gap: 22, marginTop: 20 }}>
          {members.map((m) => {
            const stopped = m.id in stops;
            const running = m.isMe
              ? started && !stopped
              : botRunning.has(m.id) && !stopped;
            return (
              <div
                key={m.id}
                style={{
                  flex: 1,
                  height: 80,
                  background: stopped
                    ? "var(--green)"
                    : running
                      ? "var(--white)"
                      : "var(--track)",
                  border: "4px solid var(--ink)",
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "0 14px",
                }}
              >
                <AvatarDisc avatarId={m.avatarId} color={m.color} size={48} />
                <div>
                  <div className="f-btn" style={{ fontSize: 22 }}>
                    {m.nick}
                    {m.isMe && " (나)"}
                  </div>
                  <div
                    className="f-meta"
                    style={{ fontWeight: 700, color: "#413d4d" }}
                  >
                    {stopped
                      ? revealed
                        ? `${(stops[m.id] / 1000).toFixed(2)}s`
                        : "🔒 기록됨"
                      : running
                        ? "진행 중…"
                        : "대기 중"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Timer Hero — 흰 카드 좌우 2분할 · Black Han 대형 숫자 */}
        <div
          className="card"
          style={{
            marginTop: 20,
            height: 300,
            display: "flex",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              className="f-sub"
              style={{ fontWeight: 700, color: "#6b6878" }}
            >
              내 경과
            </div>
            <div className="f-hero" style={{ fontSize: 160 }}>
              {myDisplay}
            </div>
          </div>
          <div style={{ width: 5, background: "var(--track)" }} />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              className="f-sub"
              style={{ fontWeight: 700, color: "#6b6878" }}
            >
              목표까지
            </div>
            <div
              className="f-hero"
              style={{
                fontSize: 160,
                color: masked ? "#c2bfce" : "var(--ink)",
              }}
            >
              {gapDisplay}
            </div>
            <div
              className="f-meta"
              style={{ color: "#9d9aa8", fontWeight: 700 }}
            >
              {masked
                ? "🙈 2초 이후엔 아무도 볼 수 없어요"
                : "누가 언제 멈추는지는 비공개"}
            </div>
          </div>
        </div>

        {/* Stop Timeline — 목표선 + 세이프 밴드 + 초과 구간 */}
        <div
          className="card"
          style={{ marginTop: 20, height: 150, padding: "18px 40px" }}
        >
          <div style={{ position: "relative", height: 44, marginTop: 22 }}>
            <div
              style={{
                position: "absolute",
                inset: "14px 0",
                background: "var(--track)",
                borderRadius: 999,
                border: "3px solid var(--ink)",
                overflow: "hidden",
              }}
            >
              {/* 세이프 밴드(그린 ±0.5s) + 초과 위험(빨강 target~limit) */}
              <div
                style={{
                  position: "absolute",
                  left: `${((target - 0.5) / limit) * 100}%`,
                  width: `${(1 / limit) * 100}%`,
                  top: 0,
                  bottom: 0,
                  background: "var(--green)",
                  opacity: 0.85,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: `${(target / limit) * 100}%`,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  background:
                    "repeating-linear-gradient(45deg, rgba(255,66,66,.35) 0 12px, transparent 12px 24px)",
                }}
              />
              {/* 내 진행 마커 */}
              {started && !masked && myStop === null && (
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.min(100, (now / limit) * 100)}%`,
                    top: 0,
                    bottom: 0,
                    width: 8,
                    background: "var(--pink)",
                  }}
                />
              )}
            </div>
            {/* 목표선 */}
            <div
              style={{
                position: "absolute",
                left: `${(target / limit) * 100}%`,
                top: -22,
                transform: "translateX(-50%)",
                textAlign: "center",
              }}
            >
              <div
                className="f-meta"
                style={{ fontWeight: 700, whiteSpace: "nowrap" }}
              >
                🎯 목표 {target}.00초
              </div>
              <div
                style={{
                  width: 5,
                  height: 60,
                  background: "var(--ink)",
                  margin: "0 auto",
                }}
              />
            </div>
            <div
              className="f-meta"
              style={{
                position: "absolute",
                left: 0,
                top: 48,
                color: "#9d9aa8",
              }}
            >
              0.00
            </div>
            <div
              className="f-meta"
              style={{
                position: "absolute",
                right: 0,
                top: 48,
                color: "#9d9aa8",
              }}
            >
              {limit}.00 · 초과 = 최하위
            </div>
          </div>
        </div>

        {/* START / STOP 버튼 900×139 중앙 */}
        <div
          style={{ display: "flex", justifyContent: "center", marginTop: 22 }}
        >
          {!started ? (
            <button
              className="btn btn-green"
              onClick={start}
              style={{
                width: 900,
                height: 139,
                fontSize: 54,
                fontFamily: "var(--font-black)",
              }}
            >
              ▶ START!
            </button>
          ) : (
            <button
              className="btn btn-red"
              disabled={myStop !== null}
              onClick={stop}
              style={{
                width: 900,
                height: 139,
                fontSize: 60,
                fontFamily: "var(--font-black)",
                animation:
                  myStop === null
                    ? "pulse-soft 0.9s ease-in-out infinite"
                    : undefined,
              }}
            >
              {myStop === null ? "STOP" : "✓ 기록 완료"}
            </button>
          )}
        </div>

        <StatusBand
          step={!started ? "1" : stoppedCount < n ? "2" : "🎉"}
          title={
            !started
              ? "내 타이머는 내가 시작해요"
              : stoppedCount < n
                ? "타이머 진행 중"
                : "전원 기록 완료!"
          }
          sub={
            !started
              ? "START 후 2초까지만 숫자가 보여요"
              : stoppedCount < n
                ? `${stoppedCount} / ${n} 정지 · 제한시간 = 목표+3초 · STOP은 단 한 번!`
                : "오차 비교 중 · 3초 후 결과 화면으로 이동해요"
          }
          right={<FairPill text="판정은 서버 시각 기준 · 되돌리기 불가" />}
        />
      </div>
    </Shell>
  );
}
