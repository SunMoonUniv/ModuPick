// 가짜 참가자 봇 — 화면은 전부 6인 기준이라 혼자서는 검증이 안 된다.
// 브라우저 탭 하나가 방을 만들고(방장), 나머지 인원을 이 스크립트가 채운다.
//
//   node devtools/bots.mjs MODU-147098 5
//   node devtools/bots.mjs 147098 5 http://192.168.0.10:8000
//
// 의존성이 없다 — Node 18+의 내장 fetch와 Node 22+의 내장 WebSocket만 쓴다.
// 봇은 게임 입력도 흉내 내므로 룰렛부터 눈치까지 6종을 끝까지 돌려볼 수 있다.
// 방장이 눌러야 시작하는 단계(룰렛 ARMED·사다리 ARMED)는 브라우저 쪽에서 눌러야 한다.

const PROTOCOL_VERSION = 1

const [rawCode, rawCount, rawServer] = process.argv.slice(2)
if (!rawCode) {
  console.error('사용법: node devtools/bots.mjs <방 코드> [인원=5] [서버=http://localhost:8000]')
  process.exit(1)
}

// 화면은 MODU-147098로 보여주지만 서버가 받는 것은 6자리 숫자뿐이다
const code = rawCode.trim().toUpperCase().replace(/^MODU-?/, '').replace(/\D/g, '')
const count = Number(rawCount ?? 5)
const server = (rawServer ?? process.env.VITE_SERVER_URL ?? 'http://localhost:8000').replace(/\/$/, '')
const wsBase = server.replace(/^http/, 'ws')

const NAMES = ['지호', '민준', '유진', '서연', '하늘', '도윤', '수아', '건우', '나연']

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${server}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const envelope = await res.json().catch(() => null)
  if (!res.ok || envelope?.success === false) {
    throw new Error(`${method} ${path} 실패: ${envelope?.code ?? res.status} ${envelope?.message ?? ''}`)
  }
  return envelope?.data
}

// 봇 하나 = 슬롯 선점(POST) → 프로필 확정(PATCH) → 소켓 연결 → 준비 완료.
// **avatarId는 null로 보낸다** — 서버가 남은 번호를 알아서 배정해 봇끼리 부딪히지 않는다.
async function spawn(index) {
  const nickname = NAMES[index % NAMES.length]
  const joined = await api(`/rooms/${code}/members`, { method: 'POST' })
  const token = joined.memberToken
  await api(`/rooms/${code}/members/me`, {
    method: 'PATCH',
    token,
    body: { nickname, avatarId: null, bio: '봇' },
  })

  const ws = new WebSocket(`${wsBase}/ws/rooms/${code}`)
  const bot = { nickname, ws, memberId: null, round: null }

  const send = (event, data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, data }))
  }

  ws.addEventListener('open', () => {
    // 3초 안에 보내지 않으면 서버가 4408로 닫는다
    send('conn:auth', { protocolVersion: PROTOCOL_VERSION, roomCode: code, memberToken: token })
  })

  ws.addEventListener('message', (raw) => {
    let frame
    try {
      frame = JSON.parse(raw.data)
    } catch {
      return
    }
    if (frame.success === false) {
      console.log(`  [${nickname}] 거절 ${frame.code} ${frame.message ?? ''}`)
      return
    }
    handle(bot, frame.event, frame.data, send)
  })

  ws.addEventListener('close', (e) => console.log(`  [${nickname}] 연결 종료 (${e.code})`))
  return bot
}

// 게임별 입력. **roundId와 phaseSeq를 반드시 되싣는다** — 빠뜨리면 서버가 조용히 버려서
// "아무도 입력하지 않은 판"이 되고, 결과 화면까지는 넘어가므로 알아채기 어렵다.
function act(bot, send, type, payload) {
  if (!bot.round) return
  send('game:action', {
    roundId: bot.round.roundId,
    phaseSeq: bot.round.phaseSeq,
    type,
    payload: payload ?? {},
  })
}

// 사람이 누르는 시늉 — 전원이 같은 순간에 누르면 눈치게임이 매번 겹침 판정이 된다
const soon = (fn, min, max) => setTimeout(fn, min + Math.random() * (max - min))

function handle(bot, event, data, send) {
  switch (event) {
    case 'room:snapshot':
      bot.memberId = data.me?.memberId ?? null
      send('member:ready', { ready: true })
      break

    case 'game:started':
      bot.round = { roundId: data.roundId, gameId: data.gameId, phaseSeq: 0, config: data.config }
      // 저격은 명단에서 대상을 골라야 해서 라운드 참가자를 들고 있는다
      bot.roster = data.roster.map((m) => m.memberId)
      break

    case 'game:phase': {
      if (!bot.round || bot.round.roundId !== data.roundId) break
      bot.round.phaseSeq = data.phaseSeq
      play(bot, data.phase, data.payload, send)
      break
    }

    // 대기방으로 돌아오면 서버가 준비 상태를 전부 내린다 — 다시 올려야 연달아 검증할 수 있다
    case 'round:closed':
      bot.round = null
      send('member:ready', { ready: true })
      break

    default:
      break
  }
}

// 단계별 봇 행동. 방장 전용 액션(roulette.pick·ladder.start)은 브라우저가 누른다.
function play(bot, phase, payload, send) {
  const gameId = bot.round?.gameId
  if (gameId === 'kingmaker') {
    if (phase === 'SUBMIT') {
      soon(() => act(bot, send, 'king.opinion', { text: `${bot.nickname}의 의견` }), 400, 1500)
    }
    if (phase === 'VOTE' || phase === 'RUNOFF') {
      const candidates = payload?.candidates ?? []
      // 자기 안건에는 투표할 수 없다(vote.self_not_allowed) — 본문으로 걸러 낸다
      const votable = candidates.filter((c) => c.label !== `${bot.nickname}의 의견`)
      const pick = votable[Math.floor(Math.random() * votable.length)]
      if (pick) soon(() => act(bot, send, 'king.vote', { candidateIds: [pick.optionId] }), 500, 2000)
    }
  }

  if (gameId === 'timer' && (phase === 'RUNNING' || phase === 'REMATCH')) {
    const targetMs = (bot.round?.config?.targetSeconds ?? 5) * 1000
    soon(() => {
      act(bot, send, 'timer.start')
      const startedAt = Date.now()
      // 목표 언저리에서 멈춘다 — 오차가 사람마다 달라야 순위표가 의미 있게 나온다.
      // **elapsedMs를 같이 보낸다** — 빼면 서버가 자기 관측값을 쓰면서 game.elapsed_rejected를 통지한다
      setTimeout(
        () => act(bot, send, 'timer.stop', { elapsedMs: Date.now() - startedAt }),
        targetMs + (Math.random() * 800 - 400),
      )
    }, 200, 900)
  }

  if (gameId === 'snipe' && (phase === 'VOTE' || phase === 'RUNOFF')) {
    // **빈 배열은 기권이 아니라 거절이다**(vote.limit_exceeded). 기권은 아예 보내지 않는 것이다.
    const targets = (bot.roster ?? []).filter((id) => id !== bot.memberId)
    const target = targets[Math.floor(Math.random() * targets.length)]
    if (target) soon(() => act(bot, send, 'snipe.vote', { targetMemberIds: [target] }), 600, 2500)
  }

  if (gameId === 'nunchi' && phase === 'ROUND') {
    // 흩어진 시각에 눌러야 혼자 누른 사람이 생기고 게임이 진행된다
    soon(() => act(bot, send, 'nunchi.up'), 800, 6000)
  }
}

const bots = []
for (let i = 0; i < count; i += 1) {
  try {
    // 순차로 붙인다 — 동시에 붙이면 정원 경계에서 어느 봇이 밀렸는지 알기 어렵다
    bots.push(await spawn(i))
    console.log(`[${i + 1}/${count}] ${bots[i].nickname} 입장`)
  } catch (e) {
    // 서버가 안 떠 있거나 방 코드가 틀린 경우가 대부분이라 스택 대신 이유만 보여준다
    console.error(`입장 실패: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`)
    console.error(`  서버 ${server} 가 떠 있는지, 방 코드 ${code} 가 맞는지 확인할 것`)
    process.exit(1)
  }
}

console.log(`\n봇 ${bots.length}명 대기 중. Ctrl+C로 종료하면 전원 퇴장한다.`)

const bye = () => {
  for (const bot of bots) bot.ws.close(1000, 'leave')
  process.exit(0)
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
