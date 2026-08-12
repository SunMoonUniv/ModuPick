// REST 호출 래퍼. 실패는 전부 ApiError로 던지고, 화면은 HTTP 상태가 아니라 error.code 문자열로 분기한다.

import { API_BASE } from './endpoint'
import { ApiError } from '../protocol/types'
import type {
  AvatarListResponse,
  ConfirmProfileRequest,
  ConfirmProfileResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  Envelope,
  GameDetail,
  GameId,
  GameSummary,
  JoinRoomResponse,
  RoomLookupResponse,
} from '../protocol/types'

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    })
  } catch {
    // 서버가 아예 안 떠 있는 경우 — 서버를 켜라는 안내로 이어진다
    throw new ApiError('common.internal', '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.', 0)
  }

  if (response.status === 204) return undefined as T
  // 성공이든 실패든 같은 봉투로 내려오므로 실제 값은 항상 data 안에 있다
  const body = (await response.json().catch(() => null)) as Envelope<T> | null
  if (!response.ok || body?.success === false) {
    throw new ApiError(
      body?.code && body.code !== 'ok' ? body.code : 'common.internal',
      body?.message ?? '알 수 없는 오류가 발생했습니다.',
      response.status,
    )
  }
  return body?.data as T
}

// 방 코드는 화면에서 `MODU-` 접두어로 보여주지만 서버는 6자리 숫자만 받는다
export function normalizeCode(input: string) {
  return input.trim().toUpperCase().replace(/^MODU-?/, '').replace(/\D/g, '')
}

// 표시용 코드. 가입 응답에는 방 코드가 실리지 않으므로 호출한 쪽이 알고 있는 값으로 만든다
export function toDisplayCode(code: string) {
  return `MODU-${code}`
}

export const api = {
  createRoom: (body: CreateRoomRequest) =>
    request<CreateRoomResponse>('/rooms', { method: 'POST', body: JSON.stringify(body) }),

  lookupRoom: (code: string) => request<RoomLookupResponse>(`/rooms/${code}`),

  joinRoom: (code: string) =>
    request<JoinRoomResponse>(`/rooms/${code}/members`, { method: 'POST' }),

  avatars: (code: string, token: string) =>
    request<AvatarListResponse>(`/rooms/${code}/avatars`, { token }),

  confirmProfile: (code: string, token: string, body: ConfirmProfileRequest) =>
    request<ConfirmProfileResponse>(`/rooms/${code}/members/me`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(body),
    }),

  leaveRoom: (code: string, token: string) =>
    request<void>(`/rooms/${code}/members/me`, { method: 'DELETE', token }),

  // 게임 메타 6종. 인증이 필요 없고 최소인원·설정 규격의 정본이다
  games: () => request<{ content: GameSummary[]; totalCount: number }>('/games'),

  // 가이드 팝업의 규칙·단계는 목록에 없고 상세에만 있다
  gameDetail: (gameId: GameId) => request<GameDetail>(`/games/${gameId}`),
}
