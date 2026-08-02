import { useState } from "react";
import { useApp } from "../lib/store";
import { Shell, StatusBand } from "../components/ui";

const CAP_CHIPS = [2, 4, 6, 8, 10];

/* ============ S-02 방 만들기 (시트 02) ============ */
export function CreateRoom() {
  const goto = useApp((s) => s.goto);
  const createRoom = useApp((s) => s.createRoom);
  const [name, setName] = useState("");
  const [cap, setCap] = useState(8);
  const valid = name.trim().length > 0;

  return (
    <Shell>
      <div className="content">
        {/* 헤더 */}
        <div className="screen-header">
          <div>
            <div className="f-title" style={{ color: "#fff" }}>
              새 방 만들기
            </div>
            <div
              className="f-sub"
              style={{ color: "rgba(255,255,255,.85)", marginTop: 4 }}
            >
              ● 방 정보를 입력하고 친구들을 초대하세요
            </div>
          </div>
          <button
            className="pill f-btn"
            style={{ height: 55, padding: "0 24px" }}
            onClick={() => goto("landing")}
          >
            ◀ 홈으로
          </button>
        </div>

        {/* 본문 2컬럼 1221 + 32 + 550 */}
        <div style={{ display: "flex", gap: 32, marginTop: 26 }}>
          <div
            style={{
              width: 1221,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* 방 이름 카드 */}
            <div className="card" style={{ padding: "28px 32px" }}>
              <div
                className="f-headline"
                style={{ display: "flex", alignItems: "center", gap: 12 }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    background: "var(--yellow)",
                    border: "3px solid var(--ink)",
                    borderRadius: 4,
                  }}
                />
                방 이름
                <span
                  className="f-meta"
                  style={{ color: "#9d9aa8", marginLeft: "auto" }}
                >
                  {name.length} / 30
                </span>
              </div>
              <input
                className="field"
                style={{ marginTop: 16, height: 72 }}
                placeholder="예) 4조 · 알고리즘 스터디"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 30))}
                maxLength={30}
              />
            </div>

            {/* 최대 인원 카드 — 스테퍼 + 칩 + 슬라이더 3방향 동기화 */}
            <div className="card" style={{ padding: "28px 32px" }}>
              <div
                className="f-headline"
                style={{ display: "flex", alignItems: "center", gap: 12 }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    background: "var(--cyan)",
                    border: "3px solid var(--ink)",
                    borderRadius: 4,
                  }}
                />
                최대 인원
                <span className="f-meta" style={{ color: "#9d9aa8" }}>
                  2 ~ 10명 · 방 생성 후 변경 불가
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 28,
                  marginTop: 20,
                }}
              >
                {/* 스테퍼 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0,
                    border: "4px solid var(--ink)",
                    borderRadius: 14,
                    overflow: "hidden",
                  }}
                >
                  <button
                    className="f-headline"
                    disabled={cap <= 2}
                    onClick={() => setCap((c) => Math.max(2, c - 1))}
                    style={{
                      width: 64,
                      height: 64,
                      background: cap <= 2 ? "var(--track)" : "var(--input)",
                      opacity: cap <= 2 ? 0.5 : 1,
                    }}
                  >
                    −
                  </button>
                  <div
                    className="f-headline"
                    style={{
                      width: 120,
                      textAlign: "center",
                      borderLeft: "4px solid var(--ink)",
                      borderRight: "4px solid var(--ink)",
                      lineHeight: "64px",
                    }}
                  >
                    {cap} 명
                  </div>
                  <button
                    className="f-headline"
                    disabled={cap >= 10}
                    onClick={() => setCap((c) => Math.min(10, c + 1))}
                    style={{
                      width: 64,
                      height: 64,
                      background: cap >= 10 ? "var(--track)" : "var(--input)",
                      opacity: cap >= 10 ? 0.5 : 1,
                    }}
                  >
                    +
                  </button>
                </div>
                {/* 빠른 선택 칩 */}
                <div style={{ display: "flex", gap: 12 }}>
                  {CAP_CHIPS.map((c) => (
                    <button
                      key={c}
                      className="pill pill-thin f-btn"
                      onClick={() => setCap(c)}
                      style={{
                        background:
                          cap === c ? "var(--yellow)" : "var(--white)",
                        boxShadow:
                          cap === c ? "3px 3px 0 var(--ink)" : undefined,
                      }}
                    >
                      {c}명
                    </button>
                  ))}
                </div>
              </div>
              {/* 슬라이더 — 트랙 시안 · 노브 핑크 */}
              <input
                type="range"
                min={2}
                max={10}
                value={cap}
                onChange={(e) => setCap(Number(e.target.value))}
                style={{
                  width: "100%",
                  marginTop: 26,
                  accentColor: "var(--pink)",
                  height: 20,
                }}
              />
              <div
                className="f-meta"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#9d9aa8",
                }}
              >
                <span>2명</span>
                <span>세 컨트롤은 같은 값으로 움직여요</span>
                <span>10명</span>
              </div>
            </div>

            {/* 힌트 바 */}
            <div
              className="f-sub"
              style={{
                background: "var(--lavender)",
                border: "4px solid var(--ink)",
                borderRadius: 14,
                padding: "16px 20px",
                fontWeight: 700,
              }}
            >
              🔒 방 코드를 받은 사람만 입장할 수 있어요
            </div>
          </div>

          {/* 우측 550: 미리보기 + 3스텝 */}
          <div
            style={{
              width: 550,
              display: "flex",
              flexDirection: "column",
              gap: 24,
            }}
          >
            <div className="card" style={{ padding: 32 }}>
              <div className="f-headline">◆ 미리보기</div>
              <div
                className="f-meta"
                style={{ color: "#9d9aa8", marginTop: 4 }}
              >
                입력한 정보가 대기방에 이렇게 보여요
              </div>
              <div
                style={{
                  marginTop: 16,
                  background: "var(--input)",
                  border: "3px solid var(--ink)",
                  borderRadius: 14,
                  padding: 20,
                }}
              >
                <div className="f-name" style={{ minHeight: 34 }}>
                  {name.trim() || (
                    <span style={{ color: "#c2bfce" }}>방 이름</span>
                  )}
                </div>
                <div className="f-meta" style={{ marginTop: 6 }}>
                  최대 인원 · {cap}명
                </div>
                <div
                  className="f-meta"
                  style={{
                    marginTop: 10,
                    background: "var(--yellow)",
                    border: "3px solid var(--ink)",
                    borderRadius: 999,
                    display: "inline-block",
                    padding: "4px 14px",
                    fontWeight: 700,
                  }}
                >
                  방 코드: MODU-****** 자동 발급
                </div>
              </div>
            </div>
            <div className="card" style={{ padding: 32, flex: 1 }}>
              <div className="f-headline">◆ 이렇게 진행돼요</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  marginTop: 18,
                }}
              >
                {[
                  "코드 공유하기",
                  "코드 입력해 입장",
                  "대기방에서 게임 시작",
                ].map((s, i) => (
                  <div
                    key={s}
                    className="f-sub"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      background: "var(--input)",
                      border: "3px solid var(--ink)",
                      borderRadius: 12,
                      padding: "16px 18px",
                      fontWeight: 700,
                    }}
                  >
                    <span
                      className="f-btn"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        background: [
                          "var(--pink)",
                          "var(--cyan)",
                          "var(--green)",
                        ][i],
                        border: "3px solid var(--ink)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                      }}
                    >
                      {i + 1}
                    </span>
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 상태 밴드 */}
        <StatusBand
          step="◈"
          title={valid ? `${name.trim()}` : "방 이름을 입력해 주세요"}
          sub={
            valid
              ? `최대 ${cap}명 · 방을 만들면 방 코드가 바로 발급돼요`
              : "이름을 입력하면 만들 수 있어요 · 최대 인원은 지금 정한 값으로 확정"
          }
          right={
            <button
              className="btn"
              disabled={!valid}
              onClick={() => createRoom(name.trim(), cap)}
              style={{
                width: 219,
                height: 60,
                background: "var(--green-cta)",
                color: "var(--yellow)",
                fontSize: 28,
              }}
            >
              ▶ 방 만들기
            </button>
          }
        />
      </div>
    </Shell>
  );
}
