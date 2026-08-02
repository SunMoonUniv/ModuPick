import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { Shell } from "../components/ui";
import { AVATARS, BOTS } from "../lib/data";
import { AvatarById } from "../components/Avatar";

const PAGE_SIZE = 15; // 5×3 그리드 · 좌우 페이징 (레이어 542:724 / 542:760)

/* ============ S-03 프로필 설정 (레이어 542:642) ============ */
export function Profile() {
  const goto = useApp((s) => s.goto);
  const confirmProfile = useApp((s) => s.confirmProfile);
  const taken = useApp((s) => s.takenAvatars);
  const roomName = useApp((s) => s.roomName);
  const roomCode = useApp((s) => s.roomCode);

  const [nick, setNick] = useState("");
  const [intro, setIntro] = useState("");
  const [avatarId, setAvatarId] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  const dupError = useMemo(
    () => BOTS.some((b) => b.nick === nick.trim()),
    [nick],
  );
  const canEnter = nick.trim().length > 0 && avatarId !== null && !dupError;
  const pages = Math.ceil(AVATARS.length / PAGE_SIZE);
  const pageAvatars = AVATARS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const randomPick = () => {
    const free = AVATARS.filter((a) => !(a.id in taken));
    if (!free.length) return;
    setAvatarId(free[Math.floor(Math.random() * free.length)].id);
  };

  return (
    <Shell>
      {/* 헤더 배지 — 시안 pill (레이어 542:680) */}
      <span
        className="f-meta"
        style={{
          position: "absolute",
          left: 59,
          top: 44,
          background: "var(--cyan)",
          border: "2.64px solid var(--ink)",
          borderRadius: 42,
          boxShadow: "3.16px 3.16px 0 var(--ink)",
          padding: "8px 17px",
          letterSpacing: 1,
        }}
      >
        🎮 캐릭터 고르기
      </span>
      {/* 제목 — Black Han 56 + 텍스트섀도우 4.2 */}
      <div
        style={{
          position: "absolute",
          left: 59,
          top: 96,
          fontFamily: "var(--font-black)",
          fontSize: 56,
          color: "#fff",
          textShadow: "4.2px 4.2px 0 var(--ink)",
        }}
      >
        캐릭터를 골라줘!
      </div>
      <div
        style={{
          position: "absolute",
          left: 59,
          top: 168,
          fontFamily: "var(--font-gothic)",
          fontWeight: 500,
          fontSize: 20,
          color: "rgba(255,255,255,.9)",
        }}
      >
        나를 대표할 동물 캐릭터를 고르고, 닉네임 정하고, 대기방으로 입장!
      </div>
      {/* 방 정보는 우측 상단이 아닌 좌측 하단 여백에 배치 (라벨 겹침 방지) */}
      <div
        className="f-meta"
        style={{
          position: "absolute",
          left: 785,
          top: 60,
          color: "rgba(255,255,255,.55)",
        }}
      >
        {roomName} · MODU-{roomCode}
      </div>
      {/* ◀ 뒤로가기 */}
      <button
        className="f-meta"
        onClick={() => goto("landing")}
        style={{
          position: "absolute",
          right: 74,
          top: 53,
          background: "var(--white)",
          border: "2.64px solid var(--ink)",
          borderRadius: 42,
          boxShadow: "3.16px 3.16px 0 var(--ink)",
          padding: "10px 16px",
          fontSize: 18,
        }}
      >
        ◀ 뒤로가기
      </button>

      {/* Player Card — 700×480 @59,214 (레이어 542:684) */}
      <div
        style={{
          position: "absolute",
          left: 59,
          top: 214,
          width: 700,
          height: 480,
          background: "var(--white)",
          border: "5.27px solid var(--ink)",
          borderRadius: 25.3,
          boxShadow: "12.7px 12.7px 0 var(--ink)",
          overflow: "hidden",
        }}
      >
        {/* 옐로 헤더 밴드 H55 + 구분선 */}
        <div
          style={{
            height: 50,
            background: "var(--yellow)",
            borderBottom: "4.2px solid var(--ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px 0 24px",
          }}
        >
          <span style={{ fontFamily: "var(--font-black)", fontSize: 24 }}>
            ★ 내 캐릭터
          </span>
          <span
            className="f-meta"
            style={{
              background: "var(--ink)",
              color: "var(--yellow)",
              borderRadius: 42,
              padding: "4px 13px",
            }}
          >
            P1
          </span>
        </div>
        {/* 아바타 히어로 — 스타버스트 원 + 캐릭터 (⌀207) */}
        <div style={{ position: "relative", height: 230, marginTop: 14 }}>
          <div
            style={{
              position: "absolute",
              left: 186,
              top: -14,
              width: 316,
              height: 316,
              borderRadius: "50%",
              background:
                "repeating-conic-gradient(rgba(255,79,212,.18) 0 12deg, transparent 12deg 24deg)",
            }}
          />
          {["✦", "★", "✧", "✦"].map((s, i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                left: [88, 534, 121, 508][i],
                top: [30, 62, 200, 200][i],
                color: "var(--pink)",
                fontSize: [30, 24, 20, 26][i],
              }}
            >
              {s}
            </span>
          ))}
          <div
            style={{
              position: "absolute",
              left: 241,
              top: -6,
              width: 207,
              height: 207,
              borderRadius: "50%",
              background: avatarId !== null ? "var(--cyan)" : "var(--track)",
              border: "5px solid var(--ink)",
              boxShadow: "4px 4px 0 var(--ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {avatarId !== null ? (
              <AvatarById id={avatarId} size={186} />
            ) : (
              <span
                style={{
                  fontFamily: "var(--font-black)",
                  fontSize: 56,
                  color: "#9d9aa8",
                }}
              >
                ?
              </span>
            )}
          </div>
        </div>
        {/* 이름 Black Han 56 + @handle + 구분선 + 순번 */}
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <div
            style={{
              fontFamily: "var(--font-black)",
              fontSize: 50,
              lineHeight: 1.1,
            }}
          >
            {nick.trim() || <span style={{ color: "#c2bfce" }}>닉네임</span>}
          </div>
          <div
            className="f-sub"
            style={{ color: "rgba(14,13,20,.55)", fontSize: 18, marginTop: 4 }}
          >
            {intro.trim()
              ? `@${intro.trim().replace(/^@/, "")} · 방장`
              : "@handle · 역할"}
          </div>
          <div
            style={{
              width: 400,
              height: 3.16,
              background: "rgba(14,13,20,.12)",
              margin: "12px auto 8px",
            }}
          />
          <div className="f-sub" style={{ fontSize: 20 }}>
            🎉 오늘의 1번째 참가자!
          </div>
        </div>
      </div>

      {/* 입장 CTA — 700×96 ink 필 + 옐로 텍스트 (레이어 542:714) */}
      <button
        disabled={!canEnter}
        onClick={() => confirmProfile(nick.trim(), avatarId!, intro)}
        style={{
          position: "absolute",
          left: 59,
          top: 718,
          width: 700,
          height: 96,
          background: "var(--ink)",
          borderRadius: 14.8,
          boxShadow: "8.4px 8.4px 0 rgba(14,13,20,.45)",
          color: "var(--yellow)",
          fontFamily: "var(--font-black)",
          fontSize: 34,
          opacity: canEnter ? 1 : 0.45,
        }}
      >
        ▶ 대기방 입장하기
      </button>
      {/* 하단 옐로 안내 pill */}
      <span
        className="f-btn"
        style={{
          position: "absolute",
          left: 59,
          top: 838,
          background: "var(--yellow)",
          border: "3.16px solid var(--ink)",
          borderRadius: 42,
          boxShadow: "4.2px 4.2px 0 var(--ink)",
          padding: "13px 19px",
        }}
      >
        🎉{" "}
        {canEnter
          ? "준비 끝! 입장해 볼까요?"
          : "팀원 5명이 먼저 와서 기다리는 중!"}
      </span>

      {/* 닉네임 — 523×72 @791,188 (레이어 542:702) */}
      <div style={{ position: "absolute", left: 791, top: 156 }}>
        <div
          className="f-meta"
          style={{ color: "var(--yellow)", fontSize: 18 }}
        >
          ● 닉네임 (필수)
          <span style={{ color: "rgba(255,255,255,.5)", marginLeft: 12 }}>
            {nick.length}/8
          </span>
        </div>
        <input
          value={nick}
          maxLength={8}
          onChange={(e) => setNick(e.target.value.slice(0, 8))}
          placeholder="예) 코딩왕지호"
          style={{
            marginTop: 12,
            width: 523,
            height: 72,
            background: "var(--white)",
            border: `3.16px solid ${dupError ? "var(--pink)" : "var(--ink)"}`,
            borderRadius: 10.5,
            boxShadow: "4.2px 4.2px 0 var(--ink)",
            padding: "0 20px",
            fontFamily: "var(--font-black)",
            fontSize: 28,
          }}
        />
        {dupError && (
          <div
            className="f-meta"
            style={{ color: "var(--pink)", marginTop: 6 }}
          >
            ⚠ 같은 방에 이미 있는 닉네임이에요
          </div>
        )}
      </div>
      {/* 한 줄 소개 — @1339,188 */}
      <div style={{ position: "absolute", left: 1339, top: 156 }}>
        <div className="f-meta" style={{ color: "var(--cyan)", fontSize: 18 }}>
          ○ 한 줄 소개 (선택)
        </div>
        <input
          value={intro}
          onChange={(e) => setIntro(e.target.value.slice(0, 24))}
          placeholder="@handle · 역할"
          className="f-sub"
          style={{
            marginTop: 12,
            width: 523,
            height: 72,
            background: "var(--white)",
            border: "3.16px solid var(--ink)",
            borderRadius: 10.5,
            boxShadow: "4.2px 4.2px 0 var(--ink)",
            padding: "0 20px",
            fontSize: 20,
          }}
        />
      </div>

      {/* ◆ 아바타 고르기 + 랜덤 뽑기 */}
      <div
        style={{
          position: "absolute",
          left: 791,
          top: 292,
          fontFamily: "var(--font-black)",
          fontSize: 34,
          color: "#fff",
        }}
      >
        ◆ 아바타 고르기
      </div>
      <div
        className="f-meta"
        style={{
          position: "absolute",
          left: 791,
          top: 341,
          color: "rgba(255,255,255,.8)",
        }}
      >
        30종 중 하나 · 선택된 캐릭터는 잠겨요 · {page + 1}/{pages} 페이지
      </div>
      <button
        onClick={randomPick}
        style={{
          position: "absolute",
          left: 1706,
          top: 289,
          background: "var(--pink)",
          border: "3.16px solid var(--ink)",
          borderRadius: 42,
          boxShadow: "4.2px 4.2px 0 var(--ink)",
          padding: "12px 19px",
          fontFamily: "var(--font-black)",
          fontSize: 20,
          color: "#fff",
        }}
      >
        🎲 <span>랜덤 뽑기</span>
      </button>

      {/* 아바타 그리드 — 856×504 @899,410 · 5×3 · gap 39/33 (레이어 542:724) */}
      <div
        style={{
          position: "absolute",
          left: 899,
          top: 410,
          width: 856,
          height: 504,
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gridTemplateRows: "repeat(3, 1fr)",
          gap: "33px 39px",
        }}
      >
        {pageAvatars.map((a) => {
          const lockedBy = taken[a.id];
          const mine = avatarId === a.id;
          return (
            <button
              key={a.id}
              disabled={!!lockedBy}
              onClick={() => setAvatarId(a.id)}
              title={a.name}
              style={{
                position: "relative",
                borderRadius: 17,
                overflow: "hidden",
                background: lockedBy
                  ? "#ccc9d6"
                  : mine
                    ? "var(--yellow)"
                    : a.tile,
                border: lockedBy
                  ? "3.3px dashed var(--ink)"
                  : mine
                    ? "4.7px solid var(--pink)"
                    : "3.3px solid var(--ink)",
                boxShadow: lockedBy
                  ? "none"
                  : mine
                    ? "6.6px 6.6px 0 var(--ink)"
                    : "4.7px 4.7px 0 var(--ink)",
                opacity: lockedBy ? 0.5 : 1,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 4,
                  transform: "translateX(-50%)",
                }}
              >
                <AvatarById id={a.id} size={126} />
              </div>
              {mine && (
                <span
                  className="f-meta"
                  style={{
                    position: "absolute",
                    left: 12,
                    bottom: 8,
                    background: "var(--ink)",
                    color: "var(--yellow)",
                    borderRadius: 38,
                    padding: "3px 11px",
                  }}
                >
                  ★ 내 캐릭터
                </span>
              )}
              {lockedBy && (
                <span
                  className="f-meta"
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: 6,
                    transform: "translateX(-50%)",
                    color: "rgba(14,13,20,.85)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {lockedBy} 선점
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 좌우 페이징 화살표 (레이어 542:719/720) */}
      <button
        disabled={page === 0}
        onClick={() => setPage((p) => p - 1)}
        style={{
          position: "absolute",
          left: 816,
          top: 634,
          fontSize: 44,
          color: "var(--yellow)",
          opacity: page === 0 ? 0.3 : 1,
          textShadow: "3px 3px 0 var(--ink)",
        }}
      >
        ◀
      </button>
      <button
        disabled={page === pages - 1}
        onClick={() => setPage((p) => p + 1)}
        style={{
          position: "absolute",
          left: 1775,
          top: 634,
          fontSize: 44,
          color: "var(--yellow)",
          opacity: page === pages - 1 ? 0.3 : 1,
          textShadow: "3px 3px 0 var(--ink)",
        }}
      >
        ▶
      </button>
    </Shell>
  );
}
