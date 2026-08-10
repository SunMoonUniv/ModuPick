import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { Shell, StatusBand } from "../components/ui";
import { AvatarById } from "../components/Avatar";
import { GAMES, gameMeta, SNIPER_PRESETS, TOPIC_PRESETS } from "../lib/data";
import type { GameId, GameSettings } from "../lib/types";

/* ============ S-04 실시간 대기방 · 방장 (레이어 542:422) ============ */
export function Lobby() {
  const st = useApp();
  const me = st.members.find((m) => m.isMe);
  const isHost = me?.isHost ?? false;
  const readyCount = st.members.filter((m) => !m.isHost && m.ready).length;
  const guestCount = st.members.filter((m) => !m.isHost).length;
  const allReady = guestCount > 0 && readyCount === guestCount;
  const canStart =
    !!st.selectedGame &&
    allReady &&
    st.members.length >=
      (st.selectedGame ? gameMeta(st.selectedGame).minPlayers : 99);

  // 데모용 'R = 전원 준비' 단축키는 제거했다. 준비는 각자가 서버에 보내는 것이며
  // 한 화면이 남의 상태를 바꿀 수 있으면 그것이 곧 클라이언트 판정이다.

  const copyCode = () => {
    navigator.clipboard?.writeText(`MODU-${st.roomCode}`).catch(() => {});
    st.showToast("📋 방 코드가 복사됐어요 — 카톡·디스코드에 붙여넣기!");
  };

  return (
    <Shell>
      <div className="content">
        {/* 헤더 — 제목 40 + 서브 시안 + 우상단 배지 (레이어) */}
        <div className="screen-header">
          <div>
            <div className="f-title" style={{ color: "#fff" }}>
              {st.roomName}
            </div>
            <div
              className="f-meta"
              style={{ color: "var(--cyan)", marginTop: 14, letterSpacing: 1 }}
            >
              ● 실시간 대기방
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 26 }}>👑</span>
            <button
              className="f-meta"
              onClick={copyCode}
              title="누르면 복사돼요"
              style={{
                background: "var(--yellow)",
                border: "2.64px solid var(--ink)",
                borderRadius: 42,
                boxShadow: "3.16px 3.16px 0 var(--ink)",
                padding: "10px 17px",
                fontSize: 18,
              }}
            >
              ◈ MODU-{st.roomCode}
            </button>
            <span
              className="f-sub"
              style={{
                background: "var(--pink)",
                border: "2.64px solid var(--ink)",
                borderRadius: 42,
                boxShadow: "3.16px 3.16px 0 var(--ink)",
                padding: "10px 17px",
                fontSize: 18,
              }}
            >
              {st.members.length}/{st.capacity}명 · READY {readyCount}
            </span>
          </div>
        </div>

        {/* 좌 참가자(549) · 중앙 채팅(528) · 우 게임 선택(670) */}
        <ParticipantStage />
        <ChatColumn />
        <GamePickColumn />

        {/* HUD (레이어: Status) */}
        <StatusBand
          step="◷"
          title={
            canStart
              ? `${st.selectedGame && gameMeta(st.selectedGame).name} 준비 완료!`
              : !st.selectedGame
                ? "게임을 골라 주세요"
                : "준비를 기다리는 중…"
          }
          sub={`2명 이상이면 시작할 수 있어요 · 현재 ${st.members.length}명 · READY ${readyCount}/${guestCount}`}
          right={
            <>
              {/* 게임 선택·시작은 방장만. 참여자에게는 준비 토글이 그 자리를 쓴다 */}
              {isHost ? (
                <>
                  <button
                    className="btn btn-cyan"
                    style={{ height: 60, padding: "0 22px" }}
                    onClick={st.randomGame}
                  >
                    🎲 랜덤 게임
                  </button>
                  <button
                    className="btn"
                    disabled={!canStart}
                    onClick={st.startGame}
                    style={{
                      width: 203,
                      height: 60,
                      background: "var(--green-cta)",
                      color: "var(--yellow)",
                      fontSize: 28,
                    }}
                  >
                    ▶ 게임 시작
                  </button>
                </>
              ) : (
                <button
                  className="btn"
                  onClick={st.toggleReady}
                  style={{
                    width: 240,
                    height: 60,
                    background: me?.ready ? "var(--ink)" : "var(--green-cta)",
                    color: me?.ready ? "#fff" : "var(--yellow)",
                    fontSize: 28,
                  }}
                >
                  {me?.ready ? "준비 해제" : "✓ 준비 완료"}
                </button>
              )}
              <button
                className="btn"
                onClick={() => st.openModal({ kind: "explode" })}
                style={{
                  height: 60,
                  padding: "0 20px",
                  background: "var(--red)",
                  color: "#fff",
                }}
              >
                ← 나가기
              </button>
            </>
          }
        />
      </div>
    </Shell>
  );
}

/* ---------- 참가자 무대 — 카드 549×92 (레이어 P·) ---------- */
function ParticipantStage() {
  const members = useApp((s) => s.members);
  const capacity = useApp((s) => s.capacity);
  const requestKick = useApp((s) => s.requestKick);
  const empty = capacity - members.length;

  return (
    <div style={{ position: "absolute", left: 0, top: 104, width: 549 }}>
      <div className="f-meta" style={{ fontSize: 24, color: "var(--yellow)" }}>
        ◆ PLAYERS · 참가자 무대 ({members.length}/{capacity})
      </div>
      <div
        className="scroll-y"
        style={{
          marginTop: 12,
          height: 700,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {members.map((m) => (
          <div
            key={m.id}
            className="anim-pop"
            style={{
              height: 92,
              background: "var(--white)",
              border: "3.16px solid var(--ink)",
              borderRadius: 14.8,
              boxShadow: m.isHost
                ? "5.3px 5.3px 0 var(--ink)"
                : "3.16px 3.16px 0 var(--ink)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "0 16px",
              flex: "none",
              position: "relative",
            }}
          >
            <div style={{ position: "relative", flex: "none" }}>
              <div
                style={{
                  width: 53,
                  height: 53,
                  borderRadius: "50%",
                  background: m.color,
                  border: "2.6px solid var(--ink)",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AvatarById id={m.avatarId} size={42} />
              </div>
              {m.isHost && (
                <span
                  style={{
                    position: "absolute",
                    top: -16,
                    left: 13,
                    fontSize: 20,
                  }}
                >
                  👑
                </span>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-black)", fontSize: 28 }}>
                {m.nick}
              </div>
              <div
                className="f-meta"
                style={{
                  color: "rgba(14,13,20,.5)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.handle} · {m.role}
                {m.isHost && m.role !== "방장" && " · 방장"}
              </div>
            </div>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {m.isHost ? (
                <span className="badge badge-host">방장</span>
              ) : m.ready ? (
                <span className="badge badge-ready">✓ READY</span>
              ) : (
                <span
                  className="f-meta"
                  style={{ color: "rgba(14,13,20,.45)" }}
                >
                  · 준비 중
                </span>
              )}
              {!m.isHost && (
                <button
                  className="f-meta"
                  title="강퇴"
                  onClick={() => requestKick(m.id)}
                  style={{
                    width: 27,
                    height: 27,
                    borderRadius: 6.3,
                    border: "2.1px solid var(--ink)",
                    background: "var(--input)",
                    fontWeight: 700,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
        {empty > 0 && (
          <div
            className="f-meta"
            style={{
              height: 64,
              background: "rgba(255,255,255,.06)",
              border: "2.64px dashed rgba(255,255,255,.6)",
              borderRadius: 14.8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,.6)",
              flex: "none",
            }}
          >
            빈 자리 {empty} · 초대 링크로 참여 대기
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- 채팅 — 528×770 (레이어 Chat) ---------- */
function ChatColumn() {
  const chat = useApp((s) => s.chat);
  const members = useApp((s) => s.members);
  const typingId = useApp((s) => s.typingId);
  const sendChat = useApp((s) => s.sendChat);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo({
      top: boxRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat.length, typingId]);

  const memberOf = (id?: string) => members.find((m) => m.id === id);
  const send = () => {
    sendChat(text);
    setText("");
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 577,
        top: 104,
        width: 528,
        height: 792,
        background: "var(--white)",
        border: "4.2px solid var(--ink)",
        borderRadius: 16.9,
        boxShadow: "4.2px 5.3px 0 var(--ink)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-black)", fontSize: 28 }}>
          ◆ CHAT
        </span>
        <span className="f-meta" style={{ color: "rgba(14,13,20,.5)" }}>
          대기방 채팅 · 실시간
        </span>
      </div>
      <div
        ref={boxRef}
        className="scroll-y"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          paddingRight: 6,
        }}
      >
        {chat.map((c) => {
          const sender = memberOf(c.senderId);
          if (c.kind === "system")
            return (
              <div key={c.id} style={{ alignSelf: "center" }}>
                <span
                  className="f-meta"
                  style={{
                    background: "#efebfb",
                    borderRadius: 42,
                    padding: "6px 16px",
                  }}
                >
                  {c.text}
                </span>
              </div>
            );
          if (c.kind === "mine")
            return (
              <div
                key={c.id}
                style={{ alignSelf: "flex-end", maxWidth: "82%" }}
              >
                <div
                  className="f-sub"
                  style={{
                    background: "var(--pink)",
                    border: "2.64px solid var(--ink)",
                    borderRadius: "14px 14px 4px 14px",
                    padding: "10px 14px",
                  }}
                >
                  {c.text}
                </div>
              </div>
            );
          return (
            <div
              key={c.id}
              style={{ display: "flex", gap: 10, maxWidth: "88%" }}
            >
              {sender && (
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    background: sender.color,
                    border: "2.1px solid var(--ink)",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                    marginTop: 2,
                  }}
                >
                  <AvatarById id={sender.avatarId} size={30} />
                </div>
              )}
              <div>
                <div
                  className="f-meta"
                  style={{ color: "#80808c", marginBottom: 3 }}
                >
                  {sender?.nick}
                  <span style={{ marginLeft: 8 }}>{c.time}</span>
                </div>
                <div
                  className="f-sub"
                  style={{
                    background: "var(--white)",
                    border: "2.64px solid var(--ink)",
                    borderRadius: "4px 14px 14px 14px",
                    padding: "10px 14px",
                    display: "inline-block",
                  }}
                >
                  {c.text}
                </div>
              </div>
            </div>
          );
        })}
        {typingId && (
          <div className="f-meta" style={{ color: "#a0a0b0" }}>
            <span style={{ animation: "blink-dots 1s infinite" }}>● ● ●</span>{" "}
            <span style={{ color: "#80808c" }}>
              {memberOf(typingId)?.nick}님이 입력 중…
            </span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div
          style={{
            flex: 1,
            height: 55,
            background: "var(--input)",
            border: "3.16px solid var(--ink)",
            borderRadius: 12.7,
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            gap: 8,
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 200))}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="메시지 입력…"
            className="f-sub"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
            }}
          />
          <span className="f-meta" style={{ color: "#9d9aa8", fontSize: 14 }}>
            {text.length} / 200
          </span>
        </div>
        <button
          onClick={send}
          style={{
            width: 55,
            height: 55,
            borderRadius: "50%",
            background: "var(--cyan)",
            border: "3.16px solid var(--ink)",
            boxShadow: "3px 3px 0 var(--ink)",
            fontFamily: "var(--font-black)",
            fontSize: 22,
            flex: "none",
          }}
        >
          ▶
        </button>
      </div>
    </div>
  );
}

/* ---------- 게임 선택 · 설정 — 카드 324×104 + 아이콘 사각 틴트 (레이어 G·) ---------- */
function GamePickColumn() {
  const members = useApp((s) => s.members);
  const selectedGame = useApp((s) => s.selectedGame);
  const selectGame = useApp((s) => s.selectGame);

  return (
    <div style={{ position: "absolute", left: 1133, top: 104, width: 670 }}>
      <div
        style={{ fontFamily: "var(--font-black)", fontSize: 28, color: "#fff" }}
      >
        ◆ 게임 선택
      </div>
      <div
        className="f-meta"
        style={{ color: "rgba(255,255,255,.85)", marginTop: 8 }}
      >
        방장만 선택 · 고르면 아래에서 바로 설정 · 3명 이상 게임은 인원 미달 시
        잠김
      </div>
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "324px 324px",
          gap: "20px 22px",
        }}
      >
        {GAMES.map((g) => {
          const lack = members.length < g.minPlayers;
          const sel = selectedGame === g.id;
          return (
            <button
              key={g.id}
              disabled={lack}
              onClick={() => selectGame(g.id)}
              style={{
                height: 104,
                borderRadius: 14.8,
                border: sel
                  ? "4.2px solid var(--ink)"
                  : "3.16px solid var(--ink)",
                background: sel ? "var(--pink)" : "var(--white)",
                boxShadow: sel ? "4.2px 4.2px 0 var(--ink)" : undefined,
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "0 14px",
                opacity: lack ? 0.55 : 1,
                textAlign: "left",
                position: "relative",
              }}
            >
              <span
                style={{
                  width: 53,
                  height: 53,
                  borderRadius: 12.7,
                  background: g.tint,
                  border: "2.64px solid var(--ink)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                  flex: "none",
                }}
              >
                {g.icon}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-black)",
                    fontSize: 24,
                  }}
                >
                  {g.name}
                </span>
                <span className="f-meta" style={{ color: "rgba(14,13,20,.6)" }}>
                  {g.sub}
                </span>
              </span>
              {sel && (
                <span
                  style={{
                    position: "absolute",
                    right: 14,
                    top: 34,
                    width: 27,
                    height: 27,
                    borderRadius: "50%",
                    background: "var(--white)",
                    border: "2.1px solid var(--ink)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-black)",
                    fontSize: 16,
                  }}
                >
                  ✓
                </span>
              )}
              {lack && (
                <span
                  className="f-meta"
                  style={{
                    position: "absolute",
                    right: 12,
                    top: 12,
                    background: "var(--yellow)",
                    border: "2.1px solid var(--ink)",
                    borderRadius: 42,
                    padding: "2px 10px",
                    fontSize: 14,
                  }}
                >
                  {g.minPlayers}명 이상
                </span>
              )}
            </button>
          );
        })}
      </div>
      <SettingsPanel />
    </div>
  );
}

/* ---------- 설정 패널 (레이어 Game Settings 672×224+) ---------- */
function SettingsPanel() {
  const selectedGame = useApp((s) => s.selectedGame);
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const members = useApp((s) => s.members);

  return (
    <div
      className="scroll-y"
      style={{
        marginTop: 20,
        width: 670,
        height: 260,
        background: "var(--white)",
        border: "3.16px solid var(--ink)",
        borderRadius: 14,
        boxShadow: "4.2px 4.2px 0 var(--ink)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {!selectedGame ? (
        <div
          className="f-meta"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9d9aa8",
          }}
        >
          ⚙️ 게임을 고르면 설정이 여기에 나타나요
        </div>
      ) : (
        <>
          <div style={{ fontFamily: "var(--font-black)", fontSize: 20 }}>
            ⚙️ {gameMeta(selectedGame).name} 설정
          </div>
          <div
            className="f-meta"
            style={{ fontSize: 14, color: "rgba(14,13,20,.5)" }}
          >
            게임을 바꾸면 설정도 자동으로 바뀌어요 · 참여자에겐 읽기 전용
          </div>
          {selectedGame !== "snipe" && (
            <TopicPicker
              game={selectedGame}
              settings={settings}
              patch={patch}
            />
          )}
          {selectedGame === "ladder" && (
            <>
              <RoleEditor
                settings={settings}
                patch={patch}
                max={members.length}
              />
              <ChipRow
                label="진행 속도"
                options={["빠르게", "보통", "느리게"]}
                value={settings.ladderSpeed}
                onPick={(v) =>
                  patch({ ladderSpeed: v as GameSettings["ladderSpeed"] })
                }
              />
            </>
          )}
          {selectedGame === "kingmaker" && (
            <>
              <ChipRow
                label="1인당 투표 횟수"
                options={["1회", "2회"]}
                value={`${settings.kmVotes}회`}
                onPick={(v) => patch({ kmVotes: Number(v[0]) })}
              />
              <ChipRow
                label="투표 결과 공개"
                options={["익명", "실명"]}
                value={settings.kmReveal}
                onPick={(v) => patch({ kmReveal: v as "익명" | "실명" })}
              />
            </>
          )}
          {selectedGame === "timer" && (
            <>
              <ChipRow
                label="목표 시간 (최대 10초)"
                options={["5초", "7초", "10초"]}
                value={`${settings.tcTarget}초`}
                onPick={(v) =>
                  patch({ tcTarget: Number(v.replace("초", "")) as 5 | 7 | 10 })
                }
              />
              <ChipRow
                label="당첨 기준"
                options={["오차가 적은 사람", "오차가 큰 사람"]}
                value={settings.tcCriteria}
                onPick={(v) =>
                  patch({ tcCriteria: v as GameSettings["tcCriteria"] })
                }
              />
            </>
          )}
          {selectedGame === "snipe" && (
            <>
              <div>
                <SettingLabel text="질문 (프리셋 또는 직접 입력)" />
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginTop: 6,
                  }}
                >
                  {SNIPER_PRESETS.map((q) => (
                    <button
                      key={q}
                      className="f-sub"
                      onClick={() => patch({ snQuestion: q })}
                      style={{
                        textAlign: "left",
                        border: "2.5px solid var(--ink)",
                        borderRadius: 40,
                        padding: "7px 14px",
                        fontSize: 14,
                        background:
                          settings.snQuestion === q
                            ? "var(--ink)"
                            : "var(--white)",
                        color:
                          settings.snQuestion === q
                            ? "var(--yellow)"
                            : "var(--ink)",
                      }}
                    >
                      {settings.snQuestion === q ? "● " : "○ "}
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <ChipRow
                label="중복 투표"
                options={["불가", "가능"]}
                value={settings.snDup}
                onPick={(v) => patch({ snDup: v as "불가" | "가능" })}
              />
            </>
          )}
          {selectedGame === "nunchi" && (
            <ChipRow
              label="동시 판정 시간"
              options={["0.3초 기본", "0.5초 하드"]}
              value={settings.nzWindow === 0.3 ? "0.3초 기본" : "0.5초 하드"}
              onPick={(v) =>
                patch({ nzWindow: v.startsWith("0.3") ? 0.3 : 0.5 })
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function SettingLabel({ text }: { text: string }) {
  return (
    <div
      className="f-meta"
      style={{ fontSize: 14, color: "rgba(14,13,20,.7)" }}
    >
      {text}
    </div>
  );
}

/** 공통 · 무엇을 정할까? — 선택 칩 = 검정 bg + 옐로 텍스트 (레이어) */
function TopicPicker({
  game,
  settings,
  patch,
}: {
  game: GameId;
  settings: GameSettings;
  patch: (p: Partial<GameSettings>) => void;
}) {
  const presets = TOPIC_PRESETS[game];
  const isCustom = !presets.includes(settings.topic);
  const [customOn, setCustomOn] = useState(isCustom);

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      className="f-sub"
      onClick={onClick}
      style={{
        border: "2.5px solid var(--ink)",
        borderRadius: 40,
        padding: "6px 14px",
        fontSize: 14,
        background: active ? "var(--ink)" : "var(--white)",
        color: active ? "var(--yellow)" : "var(--ink)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <SettingLabel text="무엇을 정할까?" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {presets.map((p) =>
          chip(p, !customOn && settings.topic === p, () => {
            setCustomOn(false);
            patch({ topic: p });
          }),
        )}
        {chip("✏️ 직접 입력", customOn, () => setCustomOn(true))}
      </div>
      {customOn && (
        <div
          style={{
            marginTop: 8,
            width: 613,
            height: 44,
            background: "var(--input)",
            border: "2.5px solid var(--ink)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            gap: 8,
          }}
        >
          <input
            className="f-sub"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              fontSize: 14,
            }}
            placeholder="예) 오늘 청소 당번은?"
            value={isCustom ? settings.topic : ""}
            maxLength={16}
            onChange={(e) => patch({ topic: e.target.value.slice(0, 16) })}
          />
          <span className="f-meta" style={{ fontSize: 11, color: "#9d9aa8" }}>
            {isCustom ? settings.topic.length : 0}/16
          </span>
        </div>
      )}
    </div>
  );
}

function RoleEditor({
  settings,
  patch,
  max,
}: {
  settings: GameSettings;
  patch: (p: Partial<GameSettings>) => void;
  max: number;
}) {
  const [draft, setDraft] = useState("");
  const roles = settings.ladderRoles;
  const full = roles.length >= max;

  const add = () => {
    const v = draft.trim();
    if (!v || full) return;
    patch({ ladderRoles: [...roles, v] });
    setDraft("");
  };

  return (
    <div>
      <SettingLabel
        text={`결과 항목 (${roles.length} / 최대 ${max}·참가자 수)`}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {roles.map((r, i) => (
          <span
            key={`${r}-${i}`}
            className="f-sub"
            style={{
              border: "2.5px solid var(--ink)",
              borderRadius: 40,
              padding: "5px 7px 5px 13px",
              fontSize: 14,
              background: "var(--cyan)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {r}
            <button
              disabled={roles.length <= 1}
              onClick={() =>
                patch({ ladderRoles: roles.filter((_, j) => j !== i) })
              }
              style={{ fontWeight: 700, opacity: roles.length <= 1 ? 0.3 : 1 }}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          className="f-sub"
          style={{
            width: 170,
            border: "2.5px solid var(--ink)",
            borderRadius: 40,
            padding: "5px 13px",
            fontSize: 14,
            background: full ? "var(--track)" : "var(--input)",
          }}
          placeholder={full ? "인원수까지 가득!" : "+ 역할 · Enter"}
          value={draft}
          disabled={full}
          onChange={(e) => setDraft(e.target.value.slice(0, 12))}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
      </div>
    </div>
  );
}

function ChipRow({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div>
      <SettingLabel text={label} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {options.map((o) => (
          <button
            key={o}
            className="f-sub"
            onClick={() => onPick(o)}
            style={{
              border: "2.5px solid var(--ink)",
              borderRadius: 40,
              padding: "6px 14px",
              fontSize: 14,
              background: value === o ? "var(--ink)" : "var(--white)",
              color: value === o ? "var(--yellow)" : "var(--ink)",
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
