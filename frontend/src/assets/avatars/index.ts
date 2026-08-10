// 아바타 이미지 30종을 서버가 쓰는 avatarId(A01~A30)로 찾을 수 있게 모아둔다.
// Vite의 eager glob import라 번들에 정적으로 포함되고, 파일을 추가하면 자동으로 잡힌다.

const modules = import.meta.glob<{ default: string }>('./a*.png', { eager: true })

export const AVATAR_SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, mod]) => {
    // './a07.png' → 'A07'
    const id = path.replace('./', '').replace('.png', '').toUpperCase()
    return [id, mod.default]
  }),
)

// 없는 id가 들어와도 화면이 깨지지 않게 첫 번째 아바타로 대체한다
export function avatarSrc(avatarId: string | null | undefined) {
  if (!avatarId) return AVATAR_SOURCES.A01
  return AVATAR_SOURCES[avatarId] ?? AVATAR_SOURCES.A01
}
