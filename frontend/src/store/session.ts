// 방 참가 자격(방 코드 + 토큰 + 내 memberId)을 탭 단위로 보관한다.
// 새로고침하면 서버에서 이미 퇴장 처리되므로 복구용이 아니라, 화면 전환 중 값을 잃지 않기 위한 용도다.

const KEY = 'modupick.session'

export interface Session {
  code: string
  displayCode: string
  token: string
  memberId: string
  // 프로필 확정(PATCH) 전인지 — 확정 전에는 소켓을 연결하면 안 된다
  pending: boolean
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function saveSession(session: Session) {
  sessionStorage.setItem(KEY, JSON.stringify(session))
}

export function clearSession() {
  sessionStorage.removeItem(KEY)
}

// 채팅은 서버가 저장하지 않으므로(명세 확정사항 9) 방 코드별로 로컬에 쌓아 대기방↔게임↔결과 전환에서 이어 붙인다
const chatKey = (code: string) => `modupick.chat.${code}`

export function loadChat<T>(code: string): T[] {
  try {
    const raw = localStorage.getItem(chatKey(code))
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

export function saveChat<T>(code: string, messages: T[]) {
  // 최근 100건만 남긴다 — 오래된 방 기록이 무한정 쌓이지 않게
  localStorage.setItem(chatKey(code), JSON.stringify(messages.slice(-100)))
}

// 게임별 가이드 팝업을 다시 보지 않기로 한 설정 (명세 확정사항 5)
const guideKey = (gameId: string) => `modupick.guide.${gameId}`

export function isGuideMuted(gameId: string) {
  return localStorage.getItem(guideKey(gameId)) === 'muted'
}

export function muteGuide(gameId: string, muted: boolean) {
  if (muted) localStorage.setItem(guideKey(gameId), 'muted')
  else localStorage.removeItem(guideKey(gameId))
}
