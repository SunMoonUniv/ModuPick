import type { CSSProperties, ReactNode } from "react";

/** 화면 셸 — 배경 그리드 + 보더 6.33 r4.2 + 코너칩 핑크 4개 (레이어 공통) */
export function Shell({ children }: { children?: ReactNode }) {
  const corners: CSSProperties[] = [
    { left: 29, top: 23 },
    { right: 29, top: 23 },
    { left: 29, bottom: 23 },
    { right: 29, bottom: 23 },
  ];
  return (
    <>
      <div className="bg-grid" />
      <div className="shell" />
      {corners.map((pos, i) => (
        <div key={i} className="shell-corner" style={pos} />
      ))}
      {children}
    </>
  );
}

/**
 * 게임·플로우 공통 헤더 (레이어 542:1289):
 * 제목 Black Han 40 white @59,44 · 영문 Black Han 18 옐로 · ? 옐로 원 52 · 서브 NanumGothicCoding 16 시안 @y100
 */
export function ScreenHeader({
  title,
  en,
  sub,
  onGuide,
  right,
  titleShadow = false,
}: {
  title: string;
  en?: string;
  sub?: string;
  onGuide?: () => void;
  right?: ReactNode;
  titleShadow?: boolean;
}) {
  return (
    <div className="screen-header">
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            className={`f-title${titleShadow ? " txt-shadow" : ""}`}
            style={{ color: "#fff" }}
          >
            {title}
          </span>
          {en && (
            <span
              style={{
                fontFamily: "var(--font-black)",
                fontSize: 18,
                color: "var(--yellow)",
                alignSelf: "flex-end",
                paddingBottom: 6,
              }}
            >
              {en}
            </span>
          )}
          {onGuide && (
            <button
              onClick={onGuide}
              title="게임 가이드 다시 보기"
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "var(--yellow)",
                border: "3px solid var(--ink)",
                boxShadow: "4px 4px 0 var(--ink)",
                fontFamily: "var(--font-black)",
                fontSize: 34,
              }}
            >
              ?
            </button>
          )}
        </div>
        {sub && (
          <div
            className="f-meta"
            style={{ color: "var(--cyan)", marginTop: 14, letterSpacing: 1 }}
          >
            {sub}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {right}
      </div>
    </div>
  );
}

/**
 * HUD 상태 밴드 — 흰 카드 1803×108 (레이어 S-05/S-04 HUD)
 * 좌: 스텝 원(옐로 ⌀55 + Black Han 40) + 제목 Black Han 34 + 서브 NanumGothicCoding 16 #666673
 */
export function StatusBand({
  step,
  title,
  sub,
  right,
  style,
}: {
  step?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="status-band" style={style}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 20, minWidth: 0 }}
      >
        {step !== undefined && (
          <span
            style={{
              width: 55,
              height: 55,
              borderRadius: "50%",
              background: "var(--yellow)",
              border: "3px solid var(--ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-black)",
              fontSize: 30,
              flex: "none",
            }}
          >
            {step}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="f-head" style={{ whiteSpace: "nowrap" }}>
            {title}
          </div>
          {sub && (
            <div className="f-meta" style={{ color: "#666673", marginTop: 2 }}>
              {sub}
            </div>
          )}
        </div>
      </div>
      {right && (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {right}
        </div>
      )}
    </div>
  );
}

/** 공정성 pill — 옐로 (레이어: HUD 우측) */
export function FairPill({ text }: { text: string }) {
  return (
    <span
      className="f-meta"
      style={{
        background: "var(--yellow)",
        border: "2.1px solid var(--ink)",
        color: "var(--ink)",
        borderRadius: 999,
        padding: "10px 17px",
        fontWeight: 700,
      }}
    >
      ★ {text}
    </span>
  );
}

/** 우상단 배지 (레이어: ◉ 접속 그린 pill 등) */
export function TopBadge({
  color = "var(--green)",
  children,
}: {
  color?: string;
  children: ReactNode;
}) {
  return (
    <span
      className="f-meta"
      style={{
        background: color,
        border: "3.16px solid var(--ink)",
        borderRadius: 999,
        boxShadow: "3.16px 3.16px 0 var(--ink)",
        padding: "9px 16px",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** 진행 바 */
export function ProgressBar({
  ratio,
  fill = "var(--green)",
  height = 18,
  track = "var(--track)",
}: {
  ratio: number;
  fill?: string;
  height?: number;
  track?: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height,
        background: track,
        borderRadius: 999,
        border: "3px solid var(--ink)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
          height: "100%",
          background: fill,
          transition: "width .3s ease",
        }}
      />
    </div>
  );
}
