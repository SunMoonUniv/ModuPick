// 소켓 연결 생성기. 프로필을 확정(active)한 뒤에만 호출한다 — pending 상태로는 서버가 인증을 거절한다.
//
// 전송은 raw WebSocket이다. 연결 직후 순서가 정해져 있다.
//
//     연결 → (3초 안) conn:auth → room:snapshot 1회 → 부분 갱신
//
// 서버가 보내는 프레임은 REST와 같은 공통 봉투라 실제 값은 항상 data 안에 있다.
// 스토어가 Socket.IO 시절과 같은 방식으로 쓰도록 on/emit/disconnect 네 가지만 노출한다.

import { SERVER_URL } from '../api/endpoint'
import type { ClientToServerEvents, ServerToClientEvents } from '../protocol/types'

// 서버가 받아들이는 프로토콜 버전 — 맞지 않으면 서버가 4002로 닫는다
const PROTOCOL_VERSION = 1

// 연결 자체의 상태 변화. 서버 이벤트가 아니라 이 모듈이 만들어 낸다.
interface LifecycleEvents {
  connect: () => void
  // 인증에 실패해 한 프레임도 받지 못하고 닫힌 경우 — 되돌아갈 경로가 없다
  connect_error: () => void
  disconnect: () => void
}

type AnyEvents = ServerToClientEvents & LifecycleEvents

export interface GameSocket {
  on<E extends keyof AnyEvents>(event: E, handler: AnyEvents[E]): void
  emit<E extends keyof ClientToServerEvents>(
    event: E,
    payload: Parameters<ClientToServerEvents[E]>[0],
  ): void
  removeAllListeners(): void
  disconnect(): void
}

// http(s)://host:8000 → ws(s)://host:8000/ws/rooms/{code}. 토큰은 URL에 싣지 않는다 — 접근 로그에 그대로 남는다.
function socketUrl(code: string) {
  const url = new URL(SERVER_URL)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/ws/rooms/${code}`
  url.search = ''
  return url.toString()
}

export function createSocket(code: string, token: string): GameSocket {
  const ws = new WebSocket(socketUrl(code))
  const handlers = new Map<string, ((payload: unknown) => void)[]>()
  // 한 프레임이라도 받았는지 — 인증 실패(connect_error)와 정상 연결 뒤 끊김(disconnect)을 가른다
  let received = false

  const fire = (event: string, payload?: unknown) => {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  }

  const send = (event: string, data: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, data }))
  }

  ws.onopen = () => {
    // 3초 안에 보내지 않으면 서버가 4408로 닫는다
    send('conn:auth', { protocolVersion: PROTOCOL_VERSION, roomCode: code, memberToken: token })
    fire('connect')
  }

  ws.onmessage = (raw) => {
    received = true
    let frame: { event?: string; success?: boolean; code?: string; message?: string; data?: unknown }
    try {
      frame = JSON.parse(raw.data as string)
    } catch {
      return
    }
    if (typeof frame.event !== 'string') return
    // 실패 프레임은 봉투 바깥에 code·message가 실려 오므로 스토어가 쓰던 모양으로 되돌려 준다
    if (frame.success === false) {
      fire('error', { code: frame.code, message: frame.message })
      return
    }
    fire(frame.event, frame.data)
  }

  // 재접속 개념이 없는 프로토콜이라 자동 재연결을 하지 않는다 — 끊기면 그대로 퇴장 처리한다
  ws.onclose = () => fire(received ? 'disconnect' : 'connect_error')

  return {
    on: (event, handler) => {
      const list = handlers.get(event as string) ?? []
      list.push(handler as (payload: unknown) => void)
      handlers.set(event as string, list)
    },
    emit: (event, payload) => send(event as string, payload),
    removeAllListeners: () => handlers.clear(),
    disconnect: () => ws.close(1000, 'leave'),
  }
}
