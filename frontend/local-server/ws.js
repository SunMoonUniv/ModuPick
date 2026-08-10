// Socket.IO 자리에 끼워 넣는 최소 WebSocket 어댑터.
//
// 실제 백엔드는 raw WebSocket을 쓴다 — 경로는 `/ws/rooms/{code}`이고, 연결 직후 3초 안에
// `conn:auth` 프레임을 보내야 인증이 끝난다. 임시 서버도 같은 규약으로 말해야 백엔드가 나왔을 때
// 프론트를 고치지 않고 주소만 바꿔 붙일 수 있다.
//
// server.js가 쓰던 Socket.IO API(io.use · io.to().emit · socket.join · socket.on …)를 그대로
// 흉내 내므로 server.js의 핸들러는 손대지 않는다. 규약의 정본은 백엔드 `app/ws/envelope.py`다.

import { WebSocketServer } from 'ws'

// 서버가 받아들이는 프로토콜 버전. 오래된 클라이언트는 여기서 거른다.
export const PROTOCOL_VERSION = 1

// 이 시간 안에 conn:auth가 오지 않으면 닫는다 — 인증 없는 소켓이 남아 있지 않게 한다.
const AUTH_TIMEOUT_MS = 3000
const MAX_FRAME_BYTES = 64 * 1024

// 종료 코드. 4000~4999는 애플리케이션 정의 구간이며 정본은 백엔드의 CloseCode다.
const CLOSE = {
  NORMAL: 1000,
  PROTOCOL_ERROR: 4002, // 규약 위반 · 지원하지 않는 protocolVersion
  UNAUTHORIZED: 4401, // 토큰 무효 · 방 없음
  AUTH_TIMEOUT: 4408, // 3초 안에 conn:auth가 오지 않음
  TOO_LARGE: 4413,
}

// S→C 성공 프레임. REST와 같은 공통 봉투에 event만 얹는다.
const okFrame = (event, data) =>
  JSON.stringify({
    event,
    success: true,
    code: 'ok',
    message: null,
    data,
    timestamp: new Date().toISOString(),
  })

// S→C 실패 프레임. 보낸 사람에게만 간다 — 소켓에는 요청·응답 짝이 없어서 data.event로 되돌려준다.
const errorFrame = (code, message, sourceEvent = null) =>
  JSON.stringify({
    event: 'error',
    success: false,
    code,
    message,
    data: { event: sourceEvent, requestId: null },
    timestamp: new Date().toISOString(),
  })

// C→S 프레임을 {event, data}로 가른다. 규약을 어기면 소켓을 닫고 null을 돌려준다.
function parseFrame(raw) {
  const text = typeof raw === 'string' ? raw : String(raw)
  if (Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) return { close: CLOSE.TOO_LARGE }
  let frame
  try {
    frame = JSON.parse(text)
  } catch {
    return { close: CLOSE.PROTOCOL_ERROR }
  }
  if (!frame || typeof frame.event !== 'string') return { close: CLOSE.PROTOCOL_ERROR }
  const data = frame.data
  return { event: frame.event, data: data && typeof data === 'object' ? data : {} }
}

/** httpServer에 소켓을 얹고 Socket.IO 모양의 io 객체를 돌려준다. */
export function createIO(httpServer) {
  const sockets = new Map() // socket.id → Socket
  const roomsOf = new Map() // 방 이름 → Set<Socket>
  const middlewares = []
  let onConnection = () => {}
  let seq = 0

  const wss = new WebSocketServer({ noServer: true })

  function send(socket, event, data) {
    if (socket.ws.readyState !== socket.ws.OPEN) return
    // server.js의 fail()이 socket.emit('error', {code, message})로 부르므로 여기서 실패 봉투로 바꾼다
    socket.ws.send(
      event === 'error' ? errorFrame(data.code, data.message) : okFrame(event, data),
    )
  }

  function broadcast(name, event, data, except) {
    for (const s of roomsOf.get(name) ?? []) if (s !== except) send(s, event, data)
  }

  class Socket {
    constructor(ws) {
      this.id = `sk_${++seq}`
      this.ws = ws
      this.data = {}
      this.handshake = { auth: {} }
      this.handlers = new Map()
      this.joined = new Set()
    }

    on(event, fn) {
      const list = this.handlers.get(event) ?? []
      list.push(fn)
      this.handlers.set(event, list)
    }

    fire(event, data) {
      for (const fn of this.handlers.get(event) ?? []) fn(data)
    }

    emit(event, data) {
      send(this, event, data)
    }

    join(name) {
      this.joined.add(name)
      const set = roomsOf.get(name) ?? new Set()
      set.add(this)
      roomsOf.set(name, set)
    }

    /** 같은 방의 **나를 뺀** 나머지에게 보낸다 (chat:typing 전용). */
    to(name) {
      return { emit: (event, data) => broadcast(name, event, data, this) }
    }

    /** Socket.IO의 disconnect(true)와 호출부를 맞춘다 — 숫자를 주면 그 종료 코드로 닫는다. */
    disconnect(code) {
      this.ws.close(typeof code === 'number' ? code : CLOSE.NORMAL)
    }
  }

  function detach(socket) {
    sockets.delete(socket.id)
    for (const name of socket.joined) roomsOf.get(name)?.delete(socket)
  }

  // io.use로 등록된 인증 미들웨어를 차례로 통과시킨다.
  function runMiddlewares(socket, done) {
    let i = 0
    const next = (err) => {
      if (err) return done(err)
      const fn = middlewares[i++]
      if (!fn) return done(null)
      fn(socket, next)
    }
    next()
  }

  httpServer.on('upgrade', (req, tcp, head) => {
    const path = new URL(req.url, 'http://local').pathname
    const matched = /^\/ws\/rooms\/([^/]+)$/.exec(path)
    if (!matched) return tcp.destroy()
    wss.handleUpgrade(req, tcp, head, (ws) => accept(ws, decodeURIComponent(matched[1])))
  })

  function accept(ws, pathCode) {
    const socket = new Socket(ws)
    const timer = setTimeout(() => ws.close(CLOSE.AUTH_TIMEOUT, 'auth timeout'), AUTH_TIMEOUT_MS)

    // 첫 프레임은 무조건 conn:auth다. 인증 전에는 어떤 이벤트도 처리하지 않는다.
    ws.once('message', (raw) => {
      clearTimeout(timer)
      const first = parseFrame(raw)
      if (first.close) return ws.close(first.close)
      if (first.event !== 'conn:auth') return ws.close(CLOSE.PROTOCOL_ERROR, 'auth expected')
      if (first.data.protocolVersion !== PROTOCOL_VERSION)
        return ws.close(CLOSE.PROTOCOL_ERROR, 'protocol version')

      // 경로의 방 코드는 표시용이고 정본은 프레임의 roomCode다 — 둘 다 없으면 인증이 실패한다.
      socket.handshake.auth = {
        code: first.data.roomCode ?? pathCode,
        token: first.data.memberToken,
      }

      runMiddlewares(socket, (err) => {
        if (err) return ws.close(CLOSE.UNAUTHORIZED, err.message)
        sockets.set(socket.id, socket)
        ws.on('message', (raw2) => {
          const next = parseFrame(raw2)
          if (next.close) return ws.close(next.close)
          socket.fire(next.event, next.data)
        })
        ws.on('close', () => {
          detach(socket)
          socket.fire('disconnect')
        })
        onConnection(socket)
      })
    })
  }

  return {
    use: (fn) => middlewares.push(fn),
    on: (event, fn) => {
      if (event === 'connection') onConnection = fn
    },
    to: (name) => ({ emit: (event, data) => broadcast(name, event, data, null) }),
    sockets: { sockets },
  }
}

// node local-server/ws.js --selfcheck — 프레임 파서만 확인한다(서버를 띄우지 않는다).
if (process.argv[2] === '--selfcheck') {
  const assert = (cond, what) => {
    if (!cond) throw new Error(`selfcheck 실패: ${what}`)
  }
  assert(parseFrame('{"event":"conn:auth","data":{"a":1}}').data.a === 1, 'data 통과')
  assert(parseFrame('{"event":"x"}').data !== undefined, 'data 없으면 빈 객체')
  assert(parseFrame('{"data":{}}').close === CLOSE.PROTOCOL_ERROR, 'event 없으면 규약 위반')
  assert(parseFrame('{').close === CLOSE.PROTOCOL_ERROR, 'JSON 아니면 규약 위반')
  assert(parseFrame('"x"'.padEnd(MAX_FRAME_BYTES + 1, 'y')).close === CLOSE.TOO_LARGE, '상한 초과')
  assert(JSON.parse(okFrame('a', { b: 1 })).success === true, '성공 봉투')
  assert(JSON.parse(errorFrame('NOT_HOST', 'm')).success === false, '실패 봉투')
  console.log('ws.js selfcheck OK')
}
