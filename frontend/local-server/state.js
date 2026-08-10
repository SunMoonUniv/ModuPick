// 임시 로컬 서버의 인메모리 저장소. DB 없이 프로세스 메모리에만 방을 들고 있으므로 서버를 재시작하면 모든 방이 사라진다.
// 명세상 실서버도 "단일 인스턴스, 진행 상태를 프로세스 메모리에 보관"이라 이 구조로도 동작 계약은 동일하다.

import { randomBytes } from 'node:crypto'

// 방 코드(6자리 숫자) → room 객체
export const rooms = new Map()

// 방 만료 예정 시각을 계산할 때 쓰는 값.
// 무활동으로 방을 지우는 동작은 없애서 실제로 만료되지는 않지만,
// API 계약이 expiresAt / roomExpiresInMs 필드를 요구하므로 값 자체는 계속 채워 보낸다.
export const ROOM_IDLE_MS = 10 * 60 * 1000
// 프로필을 확정하지 않은 pending 슬롯이 회수되기까지의 시간
export const PENDING_TTL_MS = 2 * 60 * 1000
// 아바타는 A01~A30 고정 30종
export const AVATAR_IDS = Array.from({ length: 30 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`)

// 접두사 붙은 불투명 ID 생성 — 클라이언트는 내용을 파싱하지 않는다
export function makeId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`
}

export function makeToken() {
  return randomBytes(24).toString('hex')
}

// 아직 쓰이지 않은 6자리 방 코드를 뽑는다
export function makeRoomCode() {
  let code
  do {
    code = String(Math.floor(100000 + Math.random() * 900000))
  } while (rooms.has(code))
  return code
}

export function createRoom({ roomName, maxMembers }) {
  const code = makeRoomCode()
  const now = Date.now()
  const room = {
    code,
    displayCode: `MODU-${code}`,
    roomName,
    maxMembers,
    status: 'waiting',
    hostMemberId: null,
    createdAt: now,
    expiresAt: now + ROOM_IDLE_MS,
    // 모든 S→C 이벤트에 실어 보내는 순서 판단용 카운터 — 상태가 바뀔 때마다 1씩 올린다
    version: 0,
    // memberId → member
    members: new Map(),
    // 대기방에서 고른 게임 { gameId, config } (미선택이면 null)
    game: null,
    // 진행 중인 라운드 (없으면 null)
    round: null,
    // 이 방에 걸어둔 setTimeout 핸들 모음 — 방을 지울 때 전부 해제한다
    timers: new Set(),
  }
  rooms.set(code, room)
  return room
}

export function createMember(room, role) {
  const now = Date.now()
  const member = {
    memberId: makeId('mbr'),
    token: makeToken(),
    nickname: '',
    avatarId: null,
    bio: '',
    role,
    status: 'pending',
    ready: false,
    joinedAt: new Date(now).toISOString(),
    pendingExpiresAt: now + PENDING_TTL_MS,
    // 연결된 소켓 id (아직 핸드셰이크 전이면 null)
    socketId: null,
  }
  room.members.set(member.memberId, member)
  return member
}

// 정원 판단은 pending + active 합산 기준 (선점만 하고 안 들어온 사람도 자리를 차지한다)
export function memberCount(room) {
  return room.members.size
}

export function activeMembers(room) {
  return [...room.members.values()].filter((m) => m.status === 'active')
}

export function host(room) {
  return room.members.get(room.hostMemberId) ?? null
}

// 소켓/REST 응답에 실어 보내는 공개용 멤버 형태 — token·socketId 같은 내부 필드는 절대 내보내지 않는다
export function publicMember(m) {
  return {
    memberId: m.memberId,
    nickname: m.nickname,
    avatarId: m.avatarId,
    bio: m.bio,
    role: m.role,
    // 계약의 상태값은 대문자다 — 내부 비교는 소문자로 두고 내보낼 때만 맞춘다
    status: m.status.toUpperCase(),
    ready: m.ready,
    joinedAt: m.joinedAt,
  }
}

export function publicRoom(room) {
  return {
    code: room.code,
    displayCode: room.displayCode,
    roomName: room.roomName,
    maxMembers: room.maxMembers,
    // 계약의 상태값은 대문자다 — 내부 비교는 소문자로 두고 내보낼 때만 맞춘다
    status: room.status.toUpperCase(),
    hostMemberId: room.hostMemberId,
    expiresAt: new Date(room.expiresAt).toISOString(),
  }
}

// 방 안에서 이미 확정된 아바타 집합 — 선점은 프로필 PATCH 성공 시점에만 확정된다
export function takenAvatars(room) {
  const taken = new Set()
  for (const m of room.members.values()) {
    if (m.avatarId) taken.add(m.avatarId)
  }
  return taken
}

// 닉네임 중복은 에러가 아니라 자동 번호 부여 — 지호가 있으면 지호2, 지호2도 있으면 지호3
export function uniqueNickname(room, wanted) {
  const used = new Set([...room.members.values()].map((m) => m.nickname).filter(Boolean))
  if (!used.has(wanted)) return wanted
  let n = 2
  while (used.has(`${wanted}${n}`)) n += 1
  return `${wanted}${n}`
}

// 유효한 요청이 들어올 때마다 무활동 만료를 미룬다 (서버 tick·브로드캐스트로는 연장하지 않는다)
export function touchRoom(room) {
  room.expiresAt = Date.now() + ROOM_IDLE_MS
}

// 방에 걸린 타이머를 모두 해제한다 — 방 삭제나 라운드 중단 시 유령 타이머가 남지 않게
export function clearRoomTimers(room) {
  for (const t of room.timers) clearTimeout(t)
  room.timers.clear()
}

// 방 수명에 묶인 setTimeout — 방이 사라지면 같이 정리된다
export function scheduleOnRoom(room, fn, delayMs) {
  const handle = setTimeout(() => {
    room.timers.delete(handle)
    fn()
  }, Math.max(0, delayMs))
  room.timers.add(handle)
  return handle
}

export function deleteRoom(room) {
  clearRoomTimers(room)
  rooms.delete(room.code)
}
