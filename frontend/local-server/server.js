// 백엔드가 나오기 전까지 쓰는 임시 로컬 서버 (Express + WebSocket, 인메모리).
// `API 기본 명세서 요약.md` / `실시간 소켓 이벤트 명세 요약.md`의 v1.0 계약을 그대로 구현하므로,
// 실제 백엔드가 붙으면 이 디렉터리만 지우고 프론트의 서버 주소만 바꾸면 된다.

import { createServer } from 'node:http'
import express from 'express'
import cors from 'cors'
import { createIO } from './ws.js'

import { GAMES, GAME_IDS, defaultConfig, mergeConfig } from './games.js'
import { ENGINES } from './engines.js'
import {
  rooms,
  AVATAR_IDS,
  createRoom,
  createMember,
  activeMembers,
  publicMember,
  publicRoom,
  takenAvatars,
  uniqueNickname,
  touchRoom,
  deleteRoom,
  scheduleOnRoom,
  makeId,
} from './state.js'

// 실제 백엔드(uvicorn)와 같은 포트를 기본값으로 둔다 — 프론트의 endpoint.ts가 8000을 보므로 설정 없이 붙는다.
const PORT = Number(process.env.PORT ?? 8000)
// 시작 직후 전원에게 보여주는 가이드 팝업 길이 = 게임이 자동으로 시작되기까지의 대기 시간
const GUIDE_MS = 5000

const app = express()
app.use(cors())
app.use(express.json())

const httpServer = createServer(app)
// 실제 백엔드와 같은 raw WebSocket 규약으로 말한다 — 어댑터의 설명은 ws.js에 있다.
const io = createIO(httpServer)

/* ────────────────────────── 브로드캐스트 헬퍼 ────────────────────────── */

// 방송할 때마다 roomVersion을 올린다 — 클라이언트는 이 값이 보관 중인 값보다 크지 않으면 이벤트를 버린다.
// 단조 증가를 보장해야 클라이언트의 순서 검증이 단순해지므로, 방송과 버전 증가를 한 함수로 묶어둔다.
function emitRoom(room, event, data) {
  room.version += 1
  io.to(`room:${room.code}`).emit(event, { ...data, roomVersion: room.version })
}

function emitTo(socket, event, data, room) {
  socket.emit(event, { ...data, roomVersion: room ? room.version : 0 })
}

function fail(socket, code, message) {
  socket.emit('error', { code: errorCode(code), message })
}

/* ────────────────────────── 공통 응답 봉투 ────────────────────────── */

// 서버 내부에서 쓰는 짧은 이름 → 계약의 에러 코드. 화면은 HTTP 상태가 아니라 이 문자열로 분기한다.
// 형식은 {네임스페이스}.{snake_case}이고 정본은 `src/protocol/types.ts`의 ErrorCode 42종이다.
const ERROR_CODE = {
  ROOM_NOT_FOUND: 'room.not_found',
  ROOM_ALREADY_PLAYING: 'room.already_playing',
  ROOM_IN_RESULT: 'room.already_playing',
  ROOM_FULL: 'room.full',
  SESSION_EXPIRED: 'common.session_expired',
  PROFILE_ALREADY_CONFIRMED: 'member.already_active',
  NICKNAME_INVALID: 'member.nickname_invalid',
  AVATAR_TAKEN: 'member.avatar_taken',
  NOT_HOST: 'member.not_host',
  GAME_NOT_FOUND: 'game.not_found',
  NOT_ENOUGH_MEMBERS: 'game.not_enough_members',
  NOT_ALL_READY: 'game.not_all_ready',
  INVALID_CONFIG: 'game.invalid_config',
  INVALID_ACTION: 'game.invalid_action',
  ROUND_ALREADY_ENDED: 'game.round_already_ended',
  ALREADY_SUBMITTED: 'game.already_submitted',
  INVALID_OPTION: 'vote.target_not_found',
  TOO_MANY_CHOICES: 'vote.limit_exceeded',
  SELF_VOTE_NOT_ALLOWED: 'vote.self_not_allowed',
}

// 이미 계약 형식이면 그대로 쓰고, 표에 없는 값은 삼키지 않고 common.internal로 떨어뜨린다.
const errorCode = (code) =>
  String(code).includes('.') ? code : (ERROR_CODE[code] ?? 'common.internal')

/* ────────────────────────── REST ────────────────────────── */

// 성공·실패를 가리지 않고 같은 봉투로 내려간다 — 실제 값은 언제나 data 안에 있다.
function sendOk(res, data, status = 200) {
  res.status(status).json({
    success: true,
    code: 'ok',
    message: null,
    data,
    timestamp: new Date().toISOString(),
  })
}

function httpError(res, status, code, message) {
  res.status(status).json({
    success: false,
    code: errorCode(code),
    message,
    data: null,
    timestamp: new Date().toISOString(),
  })
}

// :code 파라미터로 방을 찾아 req.room에 실어준다.
function withRoom(req, res, next) {
  const room = rooms.get(String(req.params.code).replace(/^MODU-/i, ''))
  if (!room) return httpError(res, 404, 'ROOM_NOT_FOUND', '존재하지 않는 방 코드입니다.')
  req.room = room
  next()
}

// Bearer 토큰으로 본인 멤버를 찾는다. 토큰은 식별용일 뿐이고 권한은 매번 role을 다시 본다.
function withMember(req, res, next) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const member = [...req.room.members.values()].find((m) => m.token === token)
  if (!member) return httpError(res, 401, 'SESSION_EXPIRED', '유효하지 않은 토큰입니다.')
  req.member = member
  next()
}

// 게임 6종 정적 메타데이터 — 인증 불필요
app.get('/api/games', (_req, res) => {
  sendOk(res, { games: GAME_IDS.map((id) => GAMES[id]) })
})

app.get('/api/games/:gameId', (req, res) => {
  const game = GAMES[req.params.gameId]
  if (!game) return httpError(res, 404, 'GAME_NOT_FOUND', '없는 게임입니다.')
  sendOk(res, game)
})

// 방 + pending 방장 슬롯을 함께 만든다. 방장은 이어서 PATCH로 프로필을 확정해야 한다.
app.post('/api/rooms', (req, res) => {
  const rawName = String(req.body?.roomName ?? '').trim()
  const roomName = rawName.length === 0 ? 'ModuPick 방' : rawName
  if (roomName.length > 30) return httpError(res, 400, 'INVALID_CONFIG', '방 이름은 30자 이하입니다.')

  const maxMembers = Number(req.body?.maxMembers ?? 10)
  if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 10)
    return httpError(res, 400, 'INVALID_CONFIG', '정원은 2~10명입니다.')

  const room = createRoom({ roomName, maxMembers })
  const hostMember = createMember(room, 'host')
  room.hostMemberId = hostMember.memberId

  sendOk(
    res,
    {
      code: room.code,
      displayCode: room.displayCode,
      roomName: room.roomName,
      maxMembers: room.maxMembers,
      memberId: hostMember.memberId,
      memberToken: hostMember.token,
      memberStatus: 'PENDING',
      isHost: true,
      expiresAt: new Date(room.expiresAt).toISOString(),
    },
    201,
  )
})

// 입장 화면에서 코드가 유효한지·들어갈 수 있는 상태인지 미리 확인한다
app.get('/api/rooms/:code', withRoom, (req, res) => {
  const room = req.room
  if (room.status === 'playing')
    return httpError(res, 409, 'ROOM_ALREADY_PLAYING', '이미 게임이 진행 중인 방입니다.')
  if (room.status === 'result')
    return httpError(res, 409, 'ROOM_IN_RESULT', '결과 확인 중인 방입니다.')

  const hostMember = room.members.get(room.hostMemberId)
  sendOk(res, {
    code: room.code,
    displayCode: room.displayCode,
    roomName: room.roomName,
    roomStatus: room.status.toUpperCase(),
    currentMembers: room.members.size,
    maxMembers: room.maxMembers,
    // 방장이 아직 프로필을 확정하지 않았으면 닉네임이 없다 — 빈 문자열이 아니라 null이다
    hostNickname: hostMember?.nickname || null,
  })
})

// pending 참가자 슬롯을 선점한다. 강퇴된 사람도 자리가 있으면 새 토큰으로 다시 들어올 수 있다.
app.post('/api/rooms/:code/members', withRoom, (req, res) => {
  const room = req.room
  if (room.status !== 'waiting')
    return httpError(res, 409, 'ROOM_ALREADY_PLAYING', '지금은 입장할 수 없는 방입니다.')
  if (room.members.size >= room.maxMembers)
    return httpError(res, 409, 'ROOM_FULL', '정원이 가득 찼습니다.')

  const member = createMember(room, 'guest')
  touchRoom(room)
  sendOk(
    res,
    {
      memberId: member.memberId,
      memberToken: member.token,
      memberStatus: 'PENDING',
      isHost: false,
      currentMembers: room.members.size,
      maxMembers: room.maxMembers,
    },
    201,
  )
})

// 아바타 30종과 선점 현황. 프로필 화면엔 소켓이 없어 클라이언트가 3초 주기로 폴링한다.
app.get('/api/rooms/:code/avatars', withRoom, withMember, (req, res) => {
  const taken = takenAvatars(req.room)
  // 선점자 닉네임을 함께 실어 보낸다 — 표시용이며 식별자는 담지 않는다
  const ownerOf = new Map()
  for (const m of req.room.members.values()) if (m.avatarId) ownerOf.set(m.avatarId, m.nickname)

  const content = AVATAR_IDS.map((avatarId) => ({
    avatarId,
    // 본인이 이미 고른 건 잠긴 걸로 보이지 않게 한다
    taken: taken.has(avatarId) && req.member.avatarId !== avatarId,
    takenBy: req.member.avatarId === avatarId ? null : (ownerOf.get(avatarId) ?? null),
  }))
  sendOk(res, { content, totalCount: content.length })
})

// 프로필 최초 확정 — pending에서 딱 한 번만 호출할 수 있고, 성공하면 active가 된다
app.patch('/api/rooms/:code/members/me', withRoom, withMember, (req, res) => {
  const room = req.room
  const member = req.member
  if (member.status !== 'pending')
    return httpError(res, 409, 'PROFILE_ALREADY_CONFIRMED', '이미 확정된 프로필입니다.')

  const nickname = String(req.body?.nickname ?? '').trim()
  if (nickname.length < 1 || nickname.length > 8 || /\s/.test(nickname))
    return httpError(res, 400, 'NICKNAME_INVALID', '닉네임은 공백 없이 1~8자입니다.')

  const bio = String(req.body?.bio ?? '').trim()
  if (bio.length > 24) return httpError(res, 400, 'member.bio_too_long', '소개는 24자 이하입니다.')

  const taken = takenAvatars(room)
  let avatarId = req.body?.avatarId ?? null
  if (avatarId === null) {
    // 지정하지 않으면 아직 안 쓰인 가장 앞 번호를 자동 배정한다
    avatarId = AVATAR_IDS.find((id) => !taken.has(id))
    if (!avatarId) return httpError(res, 409, 'AVATAR_TAKEN', '남은 아바타가 없습니다.')
  } else if (taken.has(avatarId)) {
    return httpError(res, 409, 'AVATAR_TAKEN', '방금 다른 사람이 선택한 아바타입니다.')
  } else if (!AVATAR_IDS.includes(avatarId)) {
    return httpError(res, 400, 'member.avatar_invalid', '없는 아바타입니다.')
  }

  // 중복 닉네임은 에러가 아니라 자동으로 번호를 붙인다 (v1.0)
  member.nickname = uniqueNickname(room, nickname)
  member.avatarId = avatarId
  member.bio = bio
  member.status = 'active'
  // 방에서 몇 번째로 확정했는지 (1부터). 확정 순서가 곧 명단·퍼슨 컬러 순서다
  member.joinOrder = activeMembers(room).length
  touchRoom(room)

  // 인원이 바뀌면 최소인원 조건을 만족하는 게임 목록도 달라지므로 함께 실어 보낸다 (API-06)
  emitRoom(room, 'member:joined', {
    member: publicMember(member),
    selectableGameIds: selectableGameIds(room),
  })
  // 방 정보는 함께 오지 않는다 — 대기방 진입 후 room:snapshot이 그 역할을 한다
  sendOk(res, {
    memberId: member.memberId,
    memberStatus: 'ACTIVE',
    // **응답의 nickname이 정본이다** — 중복이면 서버가 접미 숫자를 붙여 확정한다
    nickname: member.nickname,
    avatarId: member.avatarId,
    bio: member.bio || null,
    isHost: member.role === 'host',
    joinOrder: member.joinOrder,
  })
})

// 퇴장. 방장이 나가면 위임 없이 방 자체가 사라진다.
app.delete('/api/rooms/:code/members/me', withRoom, withMember, (req, res) => {
  removeMember(req.room, req.member, 'LEAVE')
  res.status(204).end()
})

/* ────────────────────────── 멤버 퇴장 / 방 종료 ────────────────────────── */

function removeMember(room, member, reason) {
  if (!room.members.has(member.memberId)) return

  if (member.role === 'host') {
    // 방장 이탈은 상태와 무관하게 방 삭제 — host:changed 같은 위임 이벤트는 없다
    closeRoom(room, 'HOST_LEFT')
    return
  }

  room.members.delete(member.memberId)

  if (reason === 'KICKED') {
    const targetSocket = io.sockets.sockets.get(member.socketId)
    if (targetSocket) {
      emitTo(targetSocket, 'member:kicked', { reason: 'KICKED' }, room)
      targetSocket.disconnect(true)
    }
  }
  emitRoom(room, 'member:left', {
    memberId: member.memberId,
    reason,
    selectableGameIds: selectableGameIds(room),
  })

  // 라운드 중이면 명단에서 빼지 않고 departed만 켠 뒤 엔진에 알린다
  if (room.round) {
    const rm = room.round.roundMembers.find((m) => m.memberId === member.memberId)
    if (rm) rm.departed = true
    if (room.round.phase !== 'RESULT') ENGINES[room.round.gameId].departed(makeCtx(room), member.memberId)
  }

  if (activeMembers(room).length === 0) closeRoom(room, 'EMPTY')
}

function closeRoom(room, reason) {
  emitRoom(room, 'room:closed', { reason })
  for (const m of room.members.values()) {
    const s = io.sockets.sockets.get(m.socketId)
    if (s) s.disconnect(true)
  }
  deleteRoom(room)
}

/* ────────────────────────── 라운드 진행 컨텍스트 ────────────────────────── */

// 엔진이 서버 기능(단계 전환·집계 방송·결과 확정)에 접근하는 통로.
// 엔진은 io나 room 내부 구조를 직접 만지지 않고 항상 이 객체만 쓴다.
function makeCtx(room) {
  const ctx = {
    room,
    round: room.round,
    now: () => Date.now(),

    // 현재 phase를 바꾸고 마감 타이머를 다시 건다
    setPhase(phase, { durationMs = null, options, subRound, aliveMemberIds } = {}) {
      const round = room.round
      round.phase = phase
      round.deadlineAt = durationMs === null ? null : Date.now() + durationMs
      if (options) round.options = options
      if (subRound !== undefined) round.subRound = subRound
      if (aliveMemberIds) round.aliveMemberIds = aliveMemberIds

      clearPhaseTimer(room)
      if (durationMs !== null) {
        round.phaseTimer = scheduleOnRoom(
          room,
          () => {
            if (room.round === round) ENGINES[round.gameId].deadline(makeCtx(room))
          },
          durationMs,
        )
      }

      emitRoom(room, 'game:phase', {
        roundId: round.roundId,
        phase,
        deadlineAt: round.deadlineAt === null ? null : new Date(round.deadlineAt).toISOString(),
        options,
        subRound,
        aliveMemberIds,
      })
    },

    // 누가 제출을 마쳤는지 알린다. 안건 내용과 "누가 어디에 넣었는지"는 절대 싣지 않고,
    // 킹메이커 투표 단계에서만 항목별 익명 득표수(optionVotes)를 함께 보낸다.
    progress(entries, optionVotes) {
      emitRoom(room, 'game:progress', { roundId: room.round.roundId, entries, optionVotes })
    },

    // 동점 처리 — 후보만 남기고 재투표/재대결 단계로 넘어간다
    tie(candidates, durationMs) {
      ctx.setPhase('TIE', { durationMs })
      emitRoom(room, 'game:tie', {
        roundId: room.round.roundId,
        candidates,
        deadlineAt: room.round.deadlineAt === null ? null : new Date(room.round.deadlineAt).toISOString(),
      })
    },

    // 결과 확정. revealDelayMs는 클라이언트가 연출을 재생할 시간이고, 그 뒤 전원이 동시에 결과 화면으로 넘어간다.
    finish(variant, result, revealDelayMs) {
      const round = room.round
      clearPhaseTimer(room)
      round.phase = 'RESULT'
      round.deadlineAt = null
      round.result = result
      round.variant = variant
      room.status = 'result'

      // 결과보다 phase 전환을 먼저 알려서, 연출이 끝나기 전에 클라이언트가 더 이상 입력을 보내지 않게 한다
      emitRoom(room, 'game:phase', { roundId: round.roundId, phase: 'RESULT', deadlineAt: null })
      emitRoom(room, 'game:result', {
        roundId: round.roundId,
        variant,
        result,
        resultScreenAt: new Date(Date.now() + revealDelayMs).toISOString(),
      })
    },

    // 라운드를 끝내고 대기방으로 되돌린다
    close(reason) {
      closeRound(room, reason)
    },
  }
  return ctx
}

function clearPhaseTimer(room) {
  if (room.round?.phaseTimer) {
    clearTimeout(room.round.phaseTimer)
    room.timers.delete(room.round.phaseTimer)
    room.round.phaseTimer = null
  }
}

function closeRound(room, reason) {
  const round = room.round
  if (!round) return
  clearPhaseTimer(room)
  room.round = null
  room.status = 'waiting'
  // 대기방으로 돌아오면 준비 상태를 전부 초기화한다
  for (const m of room.members.values()) m.ready = false

  emitRoom(room, 'round:closed', { roundId: round.roundId, reason })
}

// 클라이언트에 내려보내는 라운드 요약 — 내부 타이머 핸들 같은 건 빼고 보낸다
function publicRound(round) {
  if (!round) return null
  return {
    roundId: round.roundId,
    gameId: round.gameId,
    config: round.config,
    roundMembers: round.roundMembers,
    phase: round.phase,
    deadlineAt: round.deadlineAt === null ? null : new Date(round.deadlineAt).toISOString(),
    options: round.options,
    subRound: round.subRound,
    aliveMemberIds: round.aliveMemberIds,
  }
}

// 게임을 실제로 시작한다. wantGuide가 true면 가이드(GUIDE_MS) 뒤에 자동으로, false면(다시 하기) 곧바로 첫 phase를 연다.
// 어느 쪽이든 방장이 따로 시작 버튼을 누를 필요는 없다.
function startRound(room, wantGuide) {
  const members = activeMembers(room)
  const roundId = makeId('rnd')
  // 시간초 잡기만 참가자가 각자 START를 눌러 시작한다 — 가이드 대기 동안 그 버튼을 누르면 서버가 거절해 기록이 통째로 날아가므로 대기 없이 바로 연다
  const withGuide = wantGuide && room.game.gameId !== 'timer'
  const guideEndsAt = withGuide ? Date.now() + GUIDE_MS : null

  room.round = {
    roundId,
    gameId: room.game.gameId,
    config: room.game.config,
    roundMembers: members.map((m) => ({
      memberId: m.memberId,
      nickname: m.nickname,
      avatarId: m.avatarId,
      departed: false,
    })),
    phase: 'GUIDE',
    deadlineAt: guideEndsAt,
    // 엔진이 자유롭게 쓰는 게임별 진행 상태
    state: {},
    phaseTimer: null,
  }
  room.status = 'playing'

  emitRoom(room, 'game:started', {
    roundId,
    gameId: room.round.gameId,
    roundMembers: room.round.roundMembers,
    config: room.round.config,
    guideEndsAt: guideEndsAt === null ? null : new Date(guideEndsAt).toISOString(),
  })

  const begin = () => {
    if (room.round?.roundId === roundId) ENGINES[room.round.gameId].begin(makeCtx(room))
  }
  if (withGuide) scheduleOnRoom(room, begin, GUIDE_MS)
  else begin()
}

// 현재 인원으로 시작할 수 있는 게임 목록 — 최소인원 판단 근거를 서버에 둔다
function selectableGameIds(room) {
  const count = activeMembers(room).length
  return GAME_IDS.filter((id) => count >= GAMES[id].minMembers)
}

/* ────────────────────────── 소켓 ────────────────────────── */

// 프로필을 확정한(active) 사람만 소켓을 연결할 수 있다 — pending 상태의 소켓은 존재하지 않는다
io.use((socket, next) => {
  const { code, token } = socket.handshake.auth ?? {}
  const room = rooms.get(String(code ?? ''))
  if (!room) return next(new Error('ROOM_NOT_FOUND'))
  const member = [...room.members.values()].find((m) => m.token === token)
  if (!member) return next(new Error('SESSION_EXPIRED'))
  if (member.status !== 'active') return next(new Error('SESSION_EXPIRED'))
  socket.data.roomCode = room.code
  socket.data.memberId = member.memberId
  next()
})

io.on('connection', (socket) => {
  const room = rooms.get(socket.data.roomCode)
  if (!room) return socket.disconnect(true)
  const member = room.members.get(socket.data.memberId)
  if (!member) return socket.disconnect(true)

  member.socketId = socket.id
  socket.join(`room:${room.code}`)

  // 연결 직후 1회만 전체 상태를 내려주고, 이후에는 부분 갱신 이벤트만 보낸다
  emitTo(
    socket,
    'room:snapshot',
    {
      room: publicRoom(room),
      members: activeMembers(room).map(publicMember),
      game: room.game
        ? {
            gameId: room.game.gameId,
            config: room.game.config,
            configSchema: GAMES[room.game.gameId].configSchema,
          }
        : null,
      selectableGameIds: selectableGameIds(room),
      round: publicRound(room.round),
      me: member.memberId,
    },
    room,
  )

  // 방장 전용 이벤트를 참가자가 보내면 여기서 걸러낸다
  const requireHost = () => {
    if (member.role !== 'host') {
      fail(socket, 'NOT_HOST', '방장만 할 수 있습니다.')
      return false
    }
    return true
  }
  const requireWaiting = () => {
    if (room.status !== 'waiting') {
      fail(socket, 'INVALID_ACTION', '대기방에서만 할 수 있습니다.')
      return false
    }
    return true
  }

  socket.on('member:ready', ({ ready } = {}) => {
    if (!requireWaiting()) return
    // Ready는 참가자 전용 개념이라 방장이 보내면 거절한다
    if (member.role === 'host') return fail(socket, 'INVALID_ACTION', '방장은 준비 대상이 아닙니다.')
    member.ready = Boolean(ready)
    touchRoom(room)
    const actives = activeMembers(room)
    emitRoom(room, 'member:ready_changed', {
      memberId: member.memberId,
      ready: member.ready,
      readyCount: actives.filter((m) => m.role === 'guest' && m.ready).length,
      activeCount: actives.length,
    })
  })

  socket.on('member:kick', ({ memberId } = {}) => {
    if (!requireHost() || !requireWaiting()) return
    if (memberId === member.memberId) return fail(socket, 'INVALID_ACTION', '자기 자신은 강퇴할 수 없습니다.')
    const target = room.members.get(memberId)
    if (!target || target.role !== 'guest') return fail(socket, 'INVALID_ACTION', '없는 참가자입니다.')
    touchRoom(room)
    removeMember(room, target, 'KICKED')
  })

  socket.on('chat:send', ({ text } = {}) => {
    const body = String(text ?? '').trim()
    if (body.length < 1 || body.length > 200) return fail(socket, 'INVALID_ACTION', '1~200자만 보낼 수 있습니다.')
    touchRoom(room)
    // 서버는 채팅을 저장하지 않고 messageId/sentAt만 붙여 되돌린다 (이력은 클라 로컬스토리지)
    emitRoom(room, 'chat:message', {
      messageId: makeId('msg'),
      memberId: member.memberId,
      nickname: member.nickname,
      avatarId: member.avatarId,
      text: body,
      sentAt: new Date().toISOString(),
    })
  })

  socket.on('chat:typing', ({ typing } = {}) => {
    // 입력 중 표시는 저장하지 않고 본인을 뺀 나머지에게만 흘려보낸다
    socket.to(`room:${room.code}`).emit('chat:typing', {
      memberId: member.memberId,
      typing: Boolean(typing),
      roomVersion: room.version,
    })
  })

  socket.on('game:select', ({ gameId } = {}) => {
    if (!requireHost() || !requireWaiting()) return
    if (!GAMES[gameId]) return fail(socket, 'GAME_NOT_FOUND', '없는 게임입니다.')
    if (activeMembers(room).length < GAMES[gameId].minMembers)
      return fail(socket, 'NOT_ENOUGH_MEMBERS', `${GAMES[gameId].minMembers}명 이상 필요합니다.`)
    touchRoom(room)
    // 게임을 바꾸면 이전 설정은 버리고 새 게임의 기본값으로 초기화한다
    room.game = { gameId, config: defaultConfig(gameId) }
    emitRoom(room, 'game:selected', {
      gameId,
      config: room.game.config,
      configSchema: GAMES[gameId].configSchema,
    })
  })

  socket.on('game:config', ({ gameId, config } = {}) => {
    if (!requireHost() || !requireWaiting()) return
    if (!room.game || room.game.gameId !== gameId)
      return fail(socket, 'INVALID_ACTION', '선택된 게임과 다릅니다.')
    const next = mergeConfig(gameId, room.game.config, config)
    if (!next) return fail(socket, 'INVALID_CONFIG', '허용되지 않는 설정 값입니다.')
    touchRoom(room)
    room.game.config = next
    emitRoom(room, 'game:config_changed', { gameId, config: next })
  })

  socket.on('game:random', () => {
    if (!requireHost() || !requireWaiting()) return
    // 클라이언트가 각자 뽑으면 결과가 엇갈리므로 추첨은 서버가 한다
    const pool = selectableGameIds(room)
    if (pool.length === 0) return fail(socket, 'NOT_ENOUGH_MEMBERS', '가능한 게임이 없습니다.')
    const gameId = pool[Math.floor(Math.random() * pool.length)]
    touchRoom(room)
    room.game = { gameId, config: defaultConfig(gameId) }
    emitRoom(room, 'game:selected', {
      gameId,
      config: room.game.config,
      configSchema: GAMES[gameId].configSchema,
    })
  })

  socket.on('game:start', () => {
    if (!requireHost() || !requireWaiting()) return
    if (!room.game) return fail(socket, 'INVALID_ACTION', '게임을 먼저 선택해주세요.')
    const actives = activeMembers(room)
    if (actives.length < GAMES[room.game.gameId].minMembers)
      return fail(socket, 'NOT_ENOUGH_MEMBERS', '인원이 부족합니다.')
    // 참가자 전원이 준비완료여야 시작할 수 있다 (방장은 준비 대상이 아님)
    if (!actives.filter((m) => m.role === 'guest').every((m) => m.ready))
      return fail(socket, 'NOT_ALL_READY', '아직 준비하지 않은 참가자가 있습니다.')
    touchRoom(room)
    startRound(room, true)
  })

  socket.on('game:replay', () => {
    if (!requireHost()) return
    if (room.status !== 'result') return fail(socket, 'INVALID_ACTION', '결과 화면에서만 가능합니다.')
    touchRoom(room)
    clearPhaseTimer(room)
    room.round = null
    // 직전 판 설정을 그대로 재사용하고 가이드는 다시 띄우지 않는다
    startRound(room, false)
  })

  socket.on('game:action', ({ roundId, type, payload } = {}) => {
    const round = room.round
    if (!round || round.roundId !== roundId)
      return fail(socket, 'ROUND_ALREADY_ENDED', '이미 끝난 라운드입니다.')
    if (round.phase === 'GUIDE') return fail(socket, 'INVALID_ACTION', '아직 시작 전입니다.')
    const rm = round.roundMembers.find((m) => m.memberId === member.memberId)
    if (!rm || rm.departed) return fail(socket, 'SESSION_EXPIRED', '이 라운드의 참가자가 아닙니다.')

    touchRoom(room)
    const err = ENGINES[round.gameId].action(makeCtx(room), member, type, payload)
    if (err) fail(socket, err, '요청을 처리할 수 없습니다.')
  })

  socket.on('round:close', ({ roundId } = {}) => {
    if (!requireHost()) return
    if (!room.round || room.round.roundId !== roundId)
      return fail(socket, 'ROUND_ALREADY_ENDED', '이미 끝난 라운드입니다.')
    touchRoom(room)
    closeRound(room, 'COMPLETED')
  })

  socket.on('disconnect', () => {
    // 재접속 개념이 없으므로 소켓이 끊기는 즉시 퇴장 처리한다
    const stillHere = rooms.get(room.code)
    if (!stillHere || !stillHere.members.has(member.memberId)) return
    if (member.socketId !== socket.id) return
    removeMember(stillHere, member, 'DISCONNECT')
  })
})

/* ────────────────────────── 주기 작업 ────────────────────────── */

// 서버 시각·현재 단계 남은 시간·방 만료 남은 시간을 1초마다 한 이벤트로 묶어 보낸다 (API-07)
setInterval(() => {
  const now = Date.now()
  for (const room of rooms.values()) {
    if (room.members.size === 0) continue
    io.to(`room:${room.code}`).emit('server:tick', {
      serverTime: now,
      phaseRemainMs: room.round?.deadlineAt ? Math.max(0, room.round.deadlineAt - now) : null,
      roomExpiresInMs: Math.max(0, room.expiresAt - now),
      roomVersion: room.version,
    })
  }
}, 1000)

// 회수 대상 pending 슬롯을 정리한다.
// 무활동 방은 지우지 않는다 — 오래 열어둬도 방이 살아 있어야 한다는 사용자 결정.
setInterval(() => {
  const now = Date.now()
  for (const room of [...rooms.values()]) {
    for (const m of [...room.members.values()]) {
      // 2분 안에 프로필을 확정하지 않은 슬롯은 정원에서 돌려놓는다
      if (m.status === 'pending' && m.pendingExpiresAt <= now) {
        if (m.role === 'host') closeRoom(room, 'EMPTY')
        else room.members.delete(m.memberId)
      }
    }
  }
}, 5000)

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[ModuPick 임시 서버] http://0.0.0.0:${PORT} 에서 대기 중`)
})
