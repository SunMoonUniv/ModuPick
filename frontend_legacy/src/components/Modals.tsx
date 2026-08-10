import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../lib/store";
import { GUIDES, gameMeta } from "../lib/data";

/* ============ C-01 게임 가이드 모달 (레이어 621:449) ============
   흰 카드 r21 · 보더 4.2 · 섀도 8.4 · 옐로 헤더 H100 · 요약 핑크12% · STEP 회색 · TIP 옐로35% dashed */
export function GuideModal() {
  const selectedGame = useApp((s) => s.selectedGame);
  const closeGuide = useApp((s) => s.closeGuide);
  const [count, setCount] = useState(3);
  const [noMore, setNoMore] = useState(false);

  useEffect(() => {
    setCount(3);
    const iv = window.setInterval(
      () => setCount((c) => Math.max(0, c - 1)),
      1000,
    );
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    if (count === 0) closeGuide(noMore);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedGame) return null;
  const meta = gameMeta(selectedGame);
  const guide = GUIDES[selectedGame];

  return (
    <div className="dim">
      <div
        className="anim-modal"
        style={{
          width: 746,
          background: "var(--white)",
          border: "4.2px solid var(--ink)",
          borderRadius: 21,
          boxShadow: "8.4px 8.4px 0 var(--ink)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 헤더 — 옐로 H100 */}
        <div
          style={{
            background: "var(--yellow)",
            height: 100,
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "0 17px 0 25px",
            borderBottom: "4.2px solid var(--ink)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="f-head">
              {meta.icon} {meta.name} · 게임 가이드
            </div>
            <div
              className="f-meta"
              style={{ color: "rgba(14,13,20,.6)", marginTop: 4 }}
            >
              30초면 충분해요 · {guide.steps.length}단계만 기억하세요
            </div>
          </div>
          <button
            onClick={() => closeGuide(noMore)}
            aria-label="닫기"
            style={{
              width: 44,
              height: 44,
              background: "var(--white)",
              border: "2.64px solid var(--ink)",
              borderRadius: 12.7,
              fontFamily: "var(--font-black)",
              fontSize: 24,
              flex: "none",
            }}
          >
            ✕
          </button>
        </div>
        {/* 바디 */}
        <div
          style={{
            padding: "18px 25px",
            display: "flex",
            flexDirection: "column",
            gap: 13,
            alignItems: "center",
          }}
        >
          {/* 한 줄 요약 — 핑크 12% + 핑크 보더 */}
          <div
            className="f-sub"
            style={{
              width: 696,
              minHeight: 64,
              background: "rgba(255,79,212,0.12)",
              border: "2.64px solid var(--pink)",
              borderRadius: 12.7,
              display: "flex",
              alignItems: "center",
              padding: "0 15px",
              fontSize: 20,
            }}
          >
            🎯 {guide.oneLiner}
          </div>
          {/* STEP 카드 — #F7F7FA */}
          {guide.steps.map((s, i) => (
            <div
              key={i}
              style={{
                width: 696,
                background: "var(--input)",
                border: "2.64px solid var(--ink)",
                borderRadius: 14.8,
                display: "flex",
                gap: 13,
                padding: 15,
              }}
            >
              <span
                style={{
                  width: 44,
                  height: 44,
                  background: "var(--ink)",
                  color: "var(--yellow)",
                  borderRadius: 10.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-black)",
                  fontSize: 20,
                  flex: "none",
                }}
              >
                {i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="f-sub" style={{ fontSize: 24 }}>
                  {s.title}
                </div>
                <div
                  className="f-meta"
                  style={{
                    fontSize: 18,
                    lineHeight: 1.7,
                    color: "rgba(14,13,20,.62)",
                    marginTop: 4,
                  }}
                >
                  {s.desc}
                </div>
              </div>
            </div>
          ))}
          {/* TIP — 옐로 35% dashed */}
          <div
            className="f-meta"
            style={{
              width: 696,
              background: "rgba(255,226,62,0.35)",
              border: "2.64px dashed var(--ink)",
              borderRadius: 12.7,
              padding: "13px 15px",
              fontSize: 18,
              lineHeight: 1.7,
              color: "rgba(14,13,20,.8)",
            }}
          >
            💡 {guide.tip}
          </div>
          <button
            className="btn btn-green"
            style={{ width: 696, height: 56, fontSize: 24 }}
            onClick={() => closeGuide(noMore)}
          >
            알겠어요, 시작! · {count}초 후 자동 시작
          </button>
          <label
            className="f-meta"
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              cursor: "pointer",
              color: "#6b6878",
              alignSelf: "flex-start",
            }}
          >
            <input
              type="checkbox"
              checked={noMore}
              onChange={(e) => setNoMore(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            이 게임 가이드 다시 보지 않기
          </label>
        </div>
      </div>
    </div>
  );
}

/* ============ 알림 카드 — C-06 · C-07 공통 해부 (레이어 661:8 / 625:102) ============
   흰 r30 · 보더 5 · 섀도 12,14 · 배지 원 124 + 이모지 64 · 제목 Black Han 46 · 본문 Gothic A1 Bold 19 */
export function NoticeCard({
  badge,
  badgeBg,
  title,
  body,
  actions,
  onClose,
}: {
  badge: string;
  badgeBg: string;
  title: string;
  body: string;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dim" onClick={onClose}>
      <div
        className="anim-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 652,
          background: "var(--white)",
          border: "5px solid var(--ink)",
          borderRadius: 30,
          boxShadow: "12px 14px 0 var(--ink)",
          padding: "60px 56px 52px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
        }}
      >
        <div
          style={{
            width: 124,
            height: 124,
            borderRadius: 62,
            background: badgeBg,
            border: "5px solid var(--ink)",
            boxShadow: "5px 6px 0 var(--ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
          }}
        >
          {badge}
        </div>
        <div
          style={{
            fontFamily: "var(--font-black)",
            fontSize: 46,
            textAlign: "center",
          }}
        >
          {title}
        </div>
        <div
          className="f-sub"
          style={{
            fontSize: 19,
            lineHeight: "30px",
            color: "rgba(14,13,20,.72)",
            textAlign: "center",
          }}
        >
          {body}
        </div>
        {actions}
      </div>
    </div>
  );
}

/* ============ 공용 확인 모달 (동점·강퇴·방폭파 등) ============ */
export function ModalFrame({
  badge,
  badgeColor,
  title,
  body,
  chips,
  onClose,
  secondary,
  primary,
}: {
  badge: string;
  badgeColor: string;
  title: string;
  body: string;
  chips?: string[];
  onClose: () => void;
  secondary?: { label: string; onClick: () => void };
  primary?: { label: string; onClick: () => void };
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dim" onClick={!primary ? onClose : undefined}>
      <div
        className="anim-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          minHeight: 460,
          background: "var(--white)",
          border: "5px solid var(--ink)",
          borderRadius: 30,
          boxShadow: "12px 14px 0 var(--ink)",
          padding: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            right: 22,
            top: 16,
            fontFamily: "var(--font-black)",
            fontSize: 28,
          }}
          aria-label="닫기"
        >
          ✕
        </button>
        <span
          className="f-meta"
          style={{
            background: badgeColor,
            border: "2.64px solid var(--ink)",
            borderRadius: 999,
            padding: "8px 18px",
            fontWeight: 700,
          }}
        >
          {badge}
        </span>
        <div
          style={{
            fontFamily: "var(--font-black)",
            fontSize: 40,
            textAlign: "center",
          }}
        >
          {title}
        </div>
        <div
          className="f-sub"
          style={{
            textAlign: "center",
            color: "rgba(14,13,20,.72)",
            fontSize: 19,
          }}
        >
          {body}
        </div>
        {chips && (
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {chips.map((c) => (
              <span
                key={c}
                className="f-meta"
                style={{
                  background: "var(--input)",
                  border: "2.1px solid var(--ink)",
                  borderRadius: 999,
                  padding: "8px 16px",
                  fontWeight: 700,
                }}
              >
                {c}
              </span>
            ))}
          </div>
        )}
        {(secondary || primary) && (
          <div style={{ display: "flex", gap: 20, marginTop: "auto" }}>
            {secondary && (
              <button
                className="btn"
                style={{ width: 310, height: 80 }}
                onClick={secondary.onClick}
              >
                {secondary.label}
              </button>
            )}
            {primary && (
              <button
                className="btn btn-ink"
                style={{ width: 310, height: 80 }}
                onClick={primary.onClick}
              >
                {primary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ 전역 모달 디스패처 ============ */
export function Modals() {
  const modal = useApp((s) => s.modal);
  const toast = useApp((s) => s.toast);
  const closeModal = useApp((s) => s.closeModal);
  const confirmKick = useApp((s) => s.confirmKick);
  const explodeRoom = useApp((s) => s.explodeRoom);
  const members = useApp((s) => s.members);
  const retryGame = useApp((s) => s.retryGame);
  const backToLobby = useApp((s) => s.backToLobby);

  return (
    <>
      {toast && (
        <div className="toast-block">
          <span>{toast}</span>
        </div>
      )}
      {modal && modal.kind === "alreadyPlaying" && (
        <ModalFrame
          badge="🚫 진행 중 방"
          badgeColor="var(--pink)"
          title="이미 진행중인 방입니다"
          body="잠시 후 다시 시도해 주세요"
          onClose={closeModal}
        />
      )}
      {/* C-06 · 방장 이탈 (레이어 661:8) — 닫으면 표지로 (방 폭파) */}
      {modal && modal.kind === "hostLeft" && (
        <NoticeCard
          badge="💥"
          badgeBg="var(--pink)"
          title="방장이 이탈했어요"
          body="방장이 나가서 방이 폭파됐어요."
          onClose={explodeRoom}
          actions={
            <button
              className="btn btn-ink"
              style={{ width: 300, height: 66 }}
              onClick={explodeRoom}
            >
              ◀ 표지로 돌아가기
            </button>
          }
        />
      )}
      {modal && modal.kind === "kick" && (
        <ModalFrame
          badge="⚠️ 강퇴 확인"
          badgeColor="var(--pink)"
          title={`정말 ${members.find((m) => m.id === modal.memberId)?.nick ?? ""}님을 추방하시겠습니까?`}
          body="내보낸 팀원은 초대 코드로 다시 들어올 수 있어요"
          onClose={closeModal}
          secondary={{ label: "취소", onClick: closeModal }}
          primary={{ label: "추방하기", onClick: confirmKick }}
        />
      )}
      {modal && modal.kind === "explode" && (
        <ModalFrame
          badge="⚠️ 방 폭파"
          badgeColor="var(--yellow)"
          title="방을 나가시겠어요?"
          body="방장이 나가면 방이 사라지고 전원이 표지로 이동해요"
          onClose={closeModal}
          secondary={{ label: "취소", onClick: closeModal }}
          primary={{ label: "방 폭파", onClick: explodeRoom }}
        />
      )}
      {modal && modal.kind === "tie" && (
        <ModalFrame
          badge="🏁 동점 발생!"
          badgeColor="var(--yellow)"
          title="동점이 나왔어요!"
          body="같은 표를 받은 후보끼리 다시 정해요"
          chips={modal.names}
          onClose={closeModal}
          secondary={{
            label: "◀ 대기방으로",
            onClick: () => {
              closeModal();
              backToLobby();
            },
          }}
          primary={{
            label: "🔥 동점자끼리 다시!",
            onClick: () => {
              closeModal();
              retryGame();
            },
          }}
        />
      )}
      {modal && modal.kind === "allout" && (
        <ModalFrame
          badge="😵 전원 탈락"
          badgeColor="var(--pink)"
          title="모두 탈락했어요!"
          body="생존자 0명 · 처음부터 다시 할까요?"
          onClose={closeModal}
          secondary={{
            label: "◀ 대기방으로",
            onClick: () => {
              closeModal();
              backToLobby();
            },
          }}
          primary={{
            label: "🔄 처음부터 다시!",
            onClick: () => {
              closeModal();
              retryGame();
            },
          }}
        />
      )}
    </>
  );
}
