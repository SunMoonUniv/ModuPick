/**
 * 아바타 — Figma 「몰입 디자인」 캐릭터 에셋 30종 (542:5737 · 팀 제작 원본 이미지)
 * a01 코기 ~ a30 개구리 · D-15: 이모지 placeholder 금지
 */
const modules = import.meta.glob<string>("../assets/avatars/*.png", {
  eager: true,
  import: "default",
});
export const AVATAR_IMGS: string[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k]);

/** id 기반 캐릭터 이미지 */
export function AvatarById({ id, size = 64 }: { id: number; size?: number }) {
  const src = AVATAR_IMGS[id] ?? AVATAR_IMGS[0];
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ display: "block", objectFit: "cover", pointerEvents: "none" }}
    />
  );
}

/** 퍼슨 컬러 원판 안의 캐릭터 (게임 화면 공통 · 레이어: 아바타 원 + 이미지) */
export function AvatarDisc({
  avatarId,
  color,
  size = 64,
  ring = 3.16,
  shadow = false,
}: {
  avatarId: number;
  color: string;
  size?: number;
  ring?: number;
  shadow?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: `${ring}px solid var(--ink)`,
        boxShadow: shadow ? "3px 3px 0 var(--ink)" : undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flex: "none",
      }}
    >
      <AvatarById id={avatarId} size={size * 0.82} />
    </div>
  );
}
