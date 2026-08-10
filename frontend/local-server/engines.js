// 미니게임 6종의 서버측 판정 엔진.
// 공통 규칙: 결과는 항상 서버가 먼저 확정하고, 클라이언트 애니메이션은 확정된 결과를 재생하는 연출일 뿐이다.
//
// 각 엔진이 구현하는 메서드
//   begin(ctx)                          가이드가 끝난 뒤 첫 phase를 연다
//   action(ctx, member, type, payload)  game:action 처리. 거절할 땐 에러 코드 문자열을 반환한다
//   deadline(ctx)                       현재 phase의 마감 시각이 지났을 때
//   departed(ctx, memberId)             라운드 도중 소켓이 끊긴 사람이 생겼을 때

import { makeId } from './state.js'

/* ────────────────────────── 공통 유틸 ────────────────────────── */

// Fisher-Yates 셔플 — 원본을 건드리지 않고 새 배열을 돌려준다
function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// 라운드에 남아 있는(아직 이탈하지 않은) 참가자 — 새 입력을 받을 수 있는 사람들
function alive(ctx) {
  return ctx.round.roundMembers.filter((m) => !m.departed)
}

function findRoundMember(ctx, memberId) {
  return ctx.round.roundMembers.find((m) => m.memberId === memberId) ?? null
}

// game:progress용 완료/대기 목록 — 내용이나 득표는 절대 싣지 않는다
function progressFrom(ctx, doneIds) {
  return ctx.round.roundMembers.map((m) => ({
    memberId: m.memberId,
    state: doneIds.has(m.memberId) ? 'COMPLETE' : 'WAITING',
  }))
}

// 같은 내용 재전송은 성공, 다른 내용 재전송은 ALREADY_SUBMITTED (명세의 멱등 규칙)
function idempotencyCheck(previous, next) {
  if (previous === undefined) return null
  return JSON.stringify(previous) === JSON.stringify(next) ? 'DUPLICATE_OK' : 'ALREADY_SUBMITTED'
}

/* ────────────────────────── 1. 운명의 룰렛 ────────────────────────── */

// 룰렛 회전 연출 길이 — 이 시간이 지난 뒤 전원이 동시에 결과 화면으로 넘어간다
const ROULETTE_SPIN_MS = 4500

const roulette = {
  // 가이드가 끝나면 곧바로 당첨자를 확정하고 회전 연출 시간을 준다 — 방장이 누를 것이 없다
  begin(ctx) {
    ctx.setPhase('PLAYING', { durationMs: null })

    // 후보는 시작 시점에 고정된 명단 전체 — 도중 이탈자도 후보에서 빼지 않는다
    const winner = pickRandom(ctx.round.roundMembers)

    ctx.finish(
      'winner',
      { variant: 'winner', topic: ctx.round.config.topic, winner },
      ROULETTE_SPIN_MS,
    )
  },

  action() {
    return 'INVALID_ACTION'
  },

  deadline() {},
  departed() {},
}

/* ────────────────────────── 2. 랜덤 사다리 ────────────────────────── */

// 진행 속도 설정별 애니메이션 길이
const LADDER_DURATION_MS = { fast: 2500, normal: 4000, slow: 6000 }

// 겹치지 않는 가로줄을 무작위로 깔고, 각 레인이 어디로 도착하는지 실제로 따라가서 계산한다.
// 애니메이션이 이 구조 그대로 재생되므로 화면 경로와 최종 배정이 어긋날 수 없다.
function buildLadder(laneCount) {
  const rowCount = Math.max(8, laneCount * 2)
  const rungs = []
  for (let row = 0; row < rowCount; row += 1) {
    // 한 행에 붙어 있는 가로줄이 두 개 생기면 경로가 모호해지므로 lane을 건너뛰며 배치한다
    let lane = 0
    while (lane < laneCount - 1) {
      if (Math.random() < 0.45) {
        rungs.push({ row, lane })
        lane += 2
      } else {
        lane += 1
      }
    }
  }
  const arrivals = []
  for (let start = 0; start < laneCount; start += 1) {
    let lane = start
    for (let row = 0; row < rowCount; row += 1) {
      if (rungs.some((r) => r.row === row && r.lane === lane)) lane += 1
      else if (rungs.some((r) => r.row === row && r.lane === lane - 1)) lane -= 1
    }
    arrivals.push(lane)
  }
  return { laneCount, rowCount, rungs, arrivals }
}

const ladder = {
  // 가이드가 끝나면 곧바로 사다리를 확정하고 내려가는 연출 시간을 준다 — 방장이 누를 것이 없다
  begin(ctx) {
    ctx.setPhase('PLAYING', { durationMs: null })

    const members = ctx.round.roundMembers
    const laneCount = members.length

    // 결과 항목을 인원수에 맞춘다 — 모자라면 X로 채우고, 넘치면 잘라낸다
    const items = [...ctx.round.config.items]
    while (items.length < laneCount) items.push('X')
    items.length = laneCount

    const structure = buildLadder(laneCount)
    const bottom = shuffled(items)
    const assignments = members.map((m, i) => ({ member: m, item: bottom[structure.arrivals[i]] }))

    ctx.finish(
      'assign',
      { variant: 'assign', topic: ctx.round.config.topic, assignments, ladder: structure },
      LADDER_DURATION_MS[ctx.round.config.speed] ?? LADDER_DURATION_MS.normal,
    )
  },

  action() {
    return 'INVALID_ACTION'
  },

  deadline() {},
  departed() {},
}

/* ────────────────────────── 3. 킹메이커 ────────────────────────── */

// 의견 제출 2분, 투표 1분 (기획안 고정값)
const KING_SUBMIT_MS = 120_000
const KING_VOTE_MS = 60_000
// 결과 공개까지의 짧은 연출 시간
const KING_REVEAL_MS = 2000

// 현재 투표 회차의 표를 세어 순위표를 만든다
function tallyKingmaker(ctx) {
  const counts = new Map(ctx.round.state.candidates.map((o) => [o.optionId, 0]))
  const voterNames = new Map(ctx.round.state.candidates.map((o) => [o.optionId, []]))
  for (const [voterId, optionIds] of ctx.round.state.votes) {
    const voter = findRoundMember(ctx, voterId)
    for (const optionId of optionIds) {
      if (!counts.has(optionId)) continue
      counts.set(optionId, counts.get(optionId) + 1)
      if (voter) voterNames.get(optionId).push(voter.nickname)
    }
  }
  return { counts, voterNames }
}

const kingmaker = {
  begin(ctx) {
    ctx.round.state = { opinions: new Map(), options: [], candidates: [], votes: new Map(), voteRound: 1 }
    ctx.setPhase('SUBMIT', { durationMs: KING_SUBMIT_MS })
  },

  action(ctx, member, type, payload) {
    const st = ctx.round.state

    if (type === 'king.opinion') {
      if (ctx.round.phase !== 'SUBMIT') return 'ROUND_ALREADY_ENDED'
      const text = String(payload?.text ?? '').trim()
      if (text.length < 1 || text.length > 120) return 'INVALID_OPTION'
      const dup = idempotencyCheck(st.opinions.get(member.memberId), text)
      if (dup === 'ALREADY_SUBMITTED') return 'ALREADY_SUBMITTED'
      st.opinions.set(member.memberId, text)
      ctx.progress(progressFrom(ctx, new Set(st.opinions.keys())))
      // 남은 사람 전원이 냈으면 2분을 다 기다리지 않고 바로 투표로 넘어간다
      if (alive(ctx).every((m) => st.opinions.has(m.memberId))) kingmaker.closeSubmit(ctx)
      return null
    }

    if (type === 'king.vote') {
      if (ctx.round.phase !== 'VOTE' && ctx.round.phase !== 'TIE') return 'ROUND_ALREADY_ENDED'
      const ids = payload?.optionIds
      if (!Array.isArray(ids) || ids.length < 1) return 'INVALID_OPTION'
      if (ids.length > ctx.round.config.votesPerMember) return 'TOO_MANY_CHOICES'
      if (new Set(ids).size !== ids.length) return 'INVALID_OPTION'
      const valid = new Set(st.candidates.map((o) => o.optionId))
      if (ids.some((id) => !valid.has(id))) return 'INVALID_OPTION'
      // 자기가 낸 안건에는 투표할 수 없다
      if (st.candidates.some((o) => ids.includes(o.optionId) && o.authorMemberId === member.memberId))
        return 'SELF_VOTE_NOT_ALLOWED'

      const dup = idempotencyCheck(st.votes.get(member.memberId), ids)
      if (dup === 'ALREADY_SUBMITTED') return 'ALREADY_SUBMITTED'
      st.votes.set(member.memberId, ids)
      // 투표 화면(878:684)이 실시간 득표 막대를 그리므로 항목별 익명 카운트를 함께 보낸다
      const { counts } = tallyKingmaker(ctx)
      ctx.progress(
        progressFrom(ctx, new Set(st.votes.keys())),
        st.candidates.map((o) => ({ optionId: o.optionId, votes: counts.get(o.optionId) ?? 0 })),
      )
      if (alive(ctx).every((m) => st.votes.has(m.memberId))) kingmaker.closeVote(ctx)
      return null
    }

    return 'INVALID_ACTION'
  },

  // 제출 마감 — 익명 안건 목록을 만들어 투표 phase를 연다
  closeSubmit(ctx) {
    const st = ctx.round.state
    if (ctx.round.phase !== 'SUBMIT') return
    st.options = shuffled(
      [...st.opinions.entries()].map(([memberId, text]) => ({
        optionId: makeId('opt'),
        text,
        authorMemberId: memberId,
        authorNickname: findRoundMember(ctx, memberId)?.nickname ?? '',
      })),
    )
    if (st.options.length === 0) {
      // 아무도 의견을 내지 않으면 투표할 대상이 없으므로 라운드를 그냥 닫는다
      ctx.close('NO_OPTIONS')
      return
    }
    st.candidates = st.options
    st.votes = new Map()
    // 제출 단계에선 제시자를 감춰서 내려보낸다
    ctx.setPhase('VOTE', {
      durationMs: KING_VOTE_MS,
      options: st.candidates.map((o) => ({ optionId: o.optionId, text: o.text })),
    })
  },

  // 투표 마감 — 최다 득표가 단독이면 확정, 동점이면 동점 후보끼리 결선 투표
  closeVote(ctx) {
    const st = ctx.round.state
    if (ctx.round.phase !== 'VOTE' && ctx.round.phase !== 'TIE') return
    const { counts, voterNames } = tallyKingmaker(ctx)
    const max = Math.max(...counts.values())
    const top = st.candidates.filter((o) => counts.get(o.optionId) === max)

    if (top.length > 1 && st.candidates.length > 1) {
      // 결선: 기존 표를 모두 버리고 동점 후보만 남긴다 (안건 재제출은 없음)
      st.candidates = top
      st.votes = new Map()
      st.voteRound += 1
      ctx.tie(
        top.map((o) => ({ id: o.optionId, label: o.text })),
        KING_VOTE_MS,
      )
      return
    }

    const reveal = ctx.round.config.revealAuthors
    const rows = [...st.options]
      .map((o) => ({
        label: o.text,
        optionId: o.optionId,
        votes: counts.get(o.optionId) ?? 0,
        rank: 0,
        authorNickname: reveal ? o.authorNickname : undefined,
        voterNicknames: reveal ? (voterNames.get(o.optionId) ?? []) : undefined,
      }))
      .sort((a, b) => b.votes - a.votes)
    rows.forEach((r, i) => {
      r.rank = i > 0 && rows[i - 1].votes === r.votes ? rows[i - 1].rank : i + 1
    })

    ctx.finish(
      'tally',
      { variant: 'tally', topic: ctx.round.config.topic, rows, winnerLabel: top[0].text },
      KING_REVEAL_MS,
    )
  },

  deadline(ctx) {
    // 제출 시간 초과 = 의견 없음, 투표 시간 초과 = 기권으로 처리하고 그대로 마감한다
    if (ctx.round.phase === 'SUBMIT') kingmaker.closeSubmit(ctx)
    else if (ctx.round.phase === 'VOTE' || ctx.round.phase === 'TIE') kingmaker.closeVote(ctx)
  },

  departed(ctx) {
    // 남은 사람들이 이미 다 냈다면 이탈자를 기다릴 이유가 없으므로 즉시 마감을 재평가한다
    const st = ctx.round.state
    if (ctx.round.phase === 'SUBMIT' && alive(ctx).every((m) => st.opinions.has(m.memberId)))
      kingmaker.closeSubmit(ctx)
    else if (
      (ctx.round.phase === 'VOTE' || ctx.round.phase === 'TIE') &&
      alive(ctx).every((m) => st.votes.has(m.memberId))
    )
      kingmaker.closeVote(ctx)
  },
}

/* ────────────────────────── 4. 시간초 잡기 ────────────────────────── */

// START를 누르지 않고 버틸 수 있는 시간 — 넘기면 자동 최하위
const TIMER_START_GRACE_MS = 10_000
// STOP 허용 여유 — 목표 시간 + 이 값을 넘기면 기록 없음
const TIMER_STOP_GRACE_MS = 3000
const TIMER_REVEAL_MS = 2000
// 동점 재대결 안내를 보여주는 시간
const TIMER_TIE_NOTICE_MS = 3000

const timerGame = {
  begin(ctx) {
    ctx.round.state = { records: new Map(), participants: null, rematchDone: false }
    timerGame.openPlaying(ctx)
  },

  // 이번 판에 실제로 조작해야 하는 사람들만 대상으로 PLAYING을 연다 (재대결이면 동점자만)
  openPlaying(ctx) {
    const st = ctx.round.state
    const target = st.participants ?? alive(ctx).map((m) => m.memberId)
    st.participants = target
    for (const id of target) st.records.delete(id)
    ctx.setPhase('PLAYING', {
      durationMs: TIMER_START_GRACE_MS + ctx.round.config.targetMs + TIMER_STOP_GRACE_MS,
    })
  },

  action(ctx, member, type) {
    const st = ctx.round.state
    if (ctx.round.phase !== 'PLAYING') return 'ROUND_ALREADY_ENDED'
    if (!st.participants.includes(member.memberId)) return 'INVALID_ACTION'
    const rec = st.records.get(member.memberId) ?? {}

    if (type === 'timer.start') {
      if (rec.startAt) return 'ALREADY_SUBMITTED'
      // 클라이언트가 보낸 시각은 신뢰하지 않고 서버 수신 시각을 기록한다
      st.records.set(member.memberId, { ...rec, startAt: ctx.now() })
      return null
    }

    if (type === 'timer.stop') {
      if (!rec.startAt) return 'INVALID_ACTION'
      if (rec.stopAt) return 'ALREADY_SUBMITTED'
      const stopAt = ctx.now()
      const elapsedMs = stopAt - rec.startAt
      // 제한시간을 넘겨 도착한 STOP은 기록으로 인정하지 않는다
      const valid = elapsedMs <= ctx.round.config.targetMs + TIMER_STOP_GRACE_MS
      st.records.set(member.memberId, { ...rec, stopAt, elapsedMs: valid ? elapsedMs : null })
      ctx.progress(progressFrom(ctx, new Set([...st.records.keys()].filter((id) => st.records.get(id).stopAt))))
      if (st.participants.every((id) => st.records.get(id)?.stopAt)) timerGame.settle(ctx)
      return null
    }

    return 'INVALID_ACTION'
  },

  settle(ctx) {
    if (ctx.round.phase !== 'PLAYING') return
    const st = ctx.round.state
    const { targetMs, winnerRule } = ctx.round.config

    const rows = ctx.round.roundMembers.map((m) => {
      const rec = st.records.get(m.memberId)
      const elapsedMs = rec?.elapsedMs ?? null
      return {
        member: m,
        elapsedMs,
        diffMs: elapsedMs === null ? null : elapsedMs - targetMs,
        absErrorMs: elapsedMs === null ? null : Math.abs(elapsedMs - targetMs),
        // 동점을 밀리초까지 가른 뒤에도 같으면 STOP이 먼저 도착한 순서로 갈라준다
        stopAt: rec?.stopAt ?? Number.MAX_SAFE_INTEGER,
        rank: 0,
      }
    })

    // 기록 없는 사람(START 미실행·시간초과)은 무조건 최하위
    const ranked = [...rows].sort((a, b) => {
      if (a.absErrorMs === null) return b.absErrorMs === null ? 0 : 1
      if (b.absErrorMs === null) return -1
      return winnerRule === 'farthest' ? b.absErrorMs - a.absErrorMs : a.absErrorMs - b.absErrorMs
    })
    ranked.forEach((r, i) => {
      r.rank = i > 0 && ranked[i - 1].absErrorMs === r.absErrorMs ? ranked[i - 1].rank : i + 1
    })

    // 1위가 밀리초까지 동점이면 그 사람들끼리 한 번 더 겨룬다
    const leaders = ranked.filter((r) => r.rank === 1 && r.absErrorMs !== null)
    if (leaders.length > 1 && !st.rematchDone) {
      st.rematchDone = true
      st.participants = leaders.map((r) => r.member.memberId)
      ctx.tie(
        leaders.map((r) => ({ id: r.member.memberId, label: r.member.nickname })),
        TIMER_TIE_NOTICE_MS,
      )
      return
    }
    // 재대결 뒤에도 같으면 STOP이 먼저 서버에 도착한 사람을 위로 올린다
    if (leaders.length > 1) {
      leaders.sort((a, b) => a.stopAt - b.stopAt)
      leaders.forEach((r, i) => {
        r.rank = i + 1
      })
      ranked.sort((a, b) => a.rank - b.rank)
    }

    const result = {
      variant: 'record',
      topic: ctx.round.config.topic,
      targetMs,
      winnerRule,
      rows: ranked.map(({ stopAt: _stopAt, ...r }) => r),
      winnerMemberId: ranked[0].member.memberId,
    }
    ctx.finish('record', result, TIMER_REVEAL_MS)
  },

  // 동점 재대결 안내가 끝나면 동점자만으로 PLAYING을 다시 연다
  resumeAfterTie(ctx) {
    timerGame.openPlaying(ctx)
  },

  deadline(ctx) {
    if (ctx.round.phase === 'TIE') timerGame.resumeAfterTie(ctx)
    else timerGame.settle(ctx)
  },

  departed(ctx, memberId) {
    const st = ctx.round.state
    st.participants = st.participants.filter((id) => id !== memberId)
    if (ctx.round.phase === 'PLAYING' && st.participants.every((id) => st.records.get(id)?.stopAt))
      timerGame.settle(ctx)
  },
}

/* ────────────────────────── 5. 익명 저격 ────────────────────────── */

const SNIPE_REVEAL_MS = 2000

const snipe = {
  begin(ctx) {
    ctx.round.state = { votes: new Map(), candidates: alive(ctx).map((m) => m.memberId) }
    ctx.setPhase('VOTE', { durationMs: ctx.round.config.voteSeconds * 1000 })
  },

  action(ctx, member, type, payload) {
    if (type !== 'snipe.vote') return 'INVALID_ACTION'
    if (ctx.round.phase !== 'VOTE' && ctx.round.phase !== 'TIE') return 'ROUND_ALREADY_ENDED'
    const st = ctx.round.state
    const ids = payload?.targetMemberIds
    if (!Array.isArray(ids)) return 'INVALID_OPTION'
    if (ids.includes(member.memberId)) return 'SELF_VOTE_NOT_ALLOWED'
    if (new Set(ids).size !== ids.length) return 'INVALID_OPTION'
    if (!ctx.round.config.allowMultipleTargets && ids.length > 1) return 'TOO_MANY_CHOICES'
    if (ids.some((id) => !st.candidates.includes(id))) return 'INVALID_OPTION'

    const dup = idempotencyCheck(st.votes.get(member.memberId), ids)
    if (dup === 'ALREADY_SUBMITTED') return 'ALREADY_SUBMITTED'
    st.votes.set(member.memberId, ids)
    ctx.progress(progressFrom(ctx, new Set(st.votes.keys())))
    if (alive(ctx).every((m) => st.votes.has(m.memberId))) snipe.settle(ctx)
    return null
  },

  settle(ctx) {
    if (ctx.round.phase !== 'VOTE' && ctx.round.phase !== 'TIE') return
    const st = ctx.round.state
    const reveal = ctx.round.config.revealVoters

    const counts = new Map(st.candidates.map((id) => [id, 0]))
    const voterNames = new Map(st.candidates.map((id) => [id, []]))
    for (const [voterId, targets] of st.votes) {
      const voter = findRoundMember(ctx, voterId)
      for (const t of targets) {
        if (!counts.has(t)) continue
        counts.set(t, counts.get(t) + 1)
        if (voter) voterNames.get(t).push(voter.nickname)
      }
    }

    const max = Math.max(...counts.values())
    let top = st.candidates.filter((id) => counts.get(id) === max)

    // 전원이 기권해 아무도 표를 못 받았으면 난수로 한 명을 고른다
    if (max === 0) top = [pickRandom(st.candidates)]

    if (top.length > 1) {
      // 동점 후보만 남기고 표를 초기화해 결선 투표를 반복한다
      st.candidates = top
      st.votes = new Map()
      ctx.tie(
        top.map((id) => ({ id, label: findRoundMember(ctx, id)?.nickname ?? '' })),
        ctx.round.config.voteSeconds * 1000,
      )
      return
    }

    const rows = ctx.round.roundMembers
      .map((m) => ({
        label: m.nickname,
        memberId: m.memberId,
        votes: counts.get(m.memberId) ?? 0,
        rank: 0,
        voterNicknames: reveal ? (voterNames.get(m.memberId) ?? []) : undefined,
      }))
      .sort((a, b) => b.votes - a.votes)
    rows.forEach((r, i) => {
      r.rank = i > 0 && rows[i - 1].votes === r.votes ? rows[i - 1].rank : i + 1
    })

    const winner = findRoundMember(ctx, top[0])
    ctx.finish(
      'tally',
      { variant: 'tally', topic: ctx.round.config.topic, rows, winnerLabel: winner?.nickname ?? '' },
      SNIPE_REVEAL_MS,
    )
  },

  deadline(ctx) {
    // 시간이 다 되면 미투표자는 기권 처리하고 집계한다
    snipe.settle(ctx)
  },

  departed(ctx) {
    const st = ctx.round.state
    if (alive(ctx).length > 0 && alive(ctx).every((m) => st.votes.has(m.memberId))) snipe.settle(ctx)
  },
}

/* ────────────────────────── 6. 눈치게임 ────────────────────────── */

const NUNCHI_REVEAL_MS = 2500
// 서브라운드 사이에 탈락 연출을 보여주는 간격
const NUNCHI_BREAK_MS = 2500

// 탈락 사유 코드 → 기록 문장에 쓰는 한글 표기
const NUNCHI_REASON_TEXT = {
  SIMULTANEOUS: '동시 입력',
  TIMEOUT: '시간 초과',
  LAST_ONE: '마지막 생존',
  ALL_PRESSED: '전원 입력',
  DISCONNECTED: '연결 끊김',
}

const nunchi = {
  begin(ctx) {
    ctx.round.state = {
      aliveIds: alive(ctx).map((m) => m.memberId),
      subRound: 0,
      clicks: [],
      // 라운드별 탈락자 기록 — 결과 화면 설명 줄에 쓴다
      history: [],
      // 같은 내용을 화면이 표로 그릴 수 있게 쪼갠 판 (결과 프레임 542:2619용)
      rounds: [],
      roundStartAt: 0,
      entered: 0,
    }
    nunchi.openSubRound(ctx)
  },

  openSubRound(ctx) {
    const st = ctx.round.state
    st.subRound += 1
    st.clicks = []
    st.roundStartAt = ctx.now()
    st.entered = st.aliveIds.length
    ctx.setPhase('PLAYING', {
      durationMs: ctx.round.config.subRoundTimeoutMs,
      subRound: st.subRound,
      aliveMemberIds: [...st.aliveIds],
    })
  },

  action(ctx, member, type, payload) {
    const st = ctx.round.state

    if (type === 'nunchi.invalid_decision') {
      if (ctx.round.phase !== 'INVALID') return 'INVALID_ACTION'
      if (member.role !== 'host') return 'NOT_HOST'
      if (payload?.decision === 'RESTART') {
        // 처음부터 다시: 생존자를 라운드 시작 명단으로 되돌린다
        st.aliveIds = alive(ctx).map((m) => m.memberId)
        st.subRound = 0
        st.history.push('전원 탈락 — 처음부터 다시 시작')
        // 라운드 번호가 1부터 다시 붙으므로 표도 비운다
        st.rounds = []
        nunchi.openSubRound(ctx)
      } else {
        ctx.close('NUNCHI_ABORTED')
      }
      return null
    }

    if (type !== 'nunchi.up') return 'INVALID_ACTION'
    if (ctx.round.phase !== 'PLAYING') return 'ROUND_ALREADY_ENDED'
    if (!st.aliveIds.includes(member.memberId)) return 'ELIMINATED'
    if (st.clicks.some((c) => c.memberId === member.memberId)) return 'ALREADY_SUBMITTED'

    const at = ctx.now()
    st.clicks.push({ memberId: member.memberId, at })
    ctx.progress(progressFrom(ctx, new Set(st.clicks.map((c) => c.memberId))))

    // 직전 클릭과의 간격이 판정 시간보다 짧으면 동시 입력 — 그 묶음이 통째로 탈락하고 서브라운드가 끝난다
    const window = ctx.round.config.decisionWindowMs
    if (st.clicks.length >= 2) {
      const group = [st.clicks[st.clicks.length - 1]]
      for (let i = st.clicks.length - 2; i >= 0; i -= 1) {
        if (group[group.length - 1].at - st.clicks[i].at < window) group.push(st.clicks[i])
        else break
      }
      if (group.length >= 2) {
        nunchi.resolve(ctx, group.map((c) => c.memberId), 'SIMULTANEOUS')
        return null
      }
    }

    // 한 명만 빼고 전부 눌렀으면 남은 그 한 명이 탈락한다
    const remaining = st.aliveIds.filter((id) => !st.clicks.some((c) => c.memberId === id))
    if (remaining.length === 1) nunchi.resolve(ctx, remaining, 'LAST_ONE')
    else if (remaining.length === 0) nunchi.resolve(ctx, [...st.aliveIds], 'ALL_PRESSED')
    return null
  },

  // 이번 서브라운드 탈락자를 확정하고 다음 단계를 정한다
  resolve(ctx, eliminatedIds, reason) {
    if (ctx.round.phase !== 'PLAYING') return
    const st = ctx.round.state
    const names = eliminatedIds.map((id) => findRoundMember(ctx, id)?.nickname ?? '')
    st.history.push(`${st.subRound}라운드 · ${NUNCHI_REASON_TEXT[reason]} · 탈락 ${names.join(', ')}`)
    st.rounds.push(nunchi.buildLog(ctx, eliminatedIds, reason))
    st.aliveIds = st.aliveIds.filter((id) => !eliminatedIds.includes(id))

    if (st.aliveIds.length === 0) {
      // 생존자가 하나도 안 남으면 판이 성립하지 않으므로 방장 결정을 기다린다
      ctx.setPhase('INVALID', { durationMs: null })
      return
    }

    if (st.aliveIds.length === 1) {
      // 마지막 한 명이 최종 결과 — 이 사람이 뽑힌 사람이다
      const winner = findRoundMember(ctx, st.aliveIds[0])
      ctx.finish(
        'winner',
        {
          variant: 'winner',
          topic: ctx.round.config.topic,
          winner,
          detail: st.history,
          rounds: st.rounds,
        },
        NUNCHI_REVEAL_MS,
      )
      return
    }

    // 다음 서브라운드는 탈락 연출을 보여준 뒤에 시작한다
    ctx.setPhase('READY', { durationMs: NUNCHI_BREAK_MS, aliveMemberIds: [...st.aliveIds] })
  },

  // 이번 서브라운드를 결과 화면 표가 쓰는 형태로 남긴다 (누가 언제 눌렀고 왜 갈렸는지)
  buildLog(ctx, eliminatedIds, reason) {
    const st = ctx.round.state
    const clickAt = new Map(st.clicks.map((c) => [c.memberId, c.at]))
    const entry = (id) => {
      const m = findRoundMember(ctx, id)
      const at = clickAt.get(id)
      return {
        memberId: id,
        nickname: m?.nickname ?? '',
        avatarId: m?.avatarId ?? '',
        elapsedMs: at === undefined ? null : at - st.roundStartAt,
      }
    }
    // 누른 순서대로 세워야 화면의 "N번째" 표시와 순서가 맞는다
    const byClick = (a, b) => (clickAt.get(a) ?? Infinity) - (clickAt.get(b) ?? Infinity)
    const log = {
      subRound: st.subRound,
      entered: st.entered,
      passed: st.aliveIds
        .filter((id) => !eliminatedIds.includes(id) && clickAt.has(id))
        .sort(byClick)
        .map(entry),
      eliminated: [...eliminatedIds].sort(byClick).map(entry),
      reason,
    }

    if (reason === 'SIMULTANEOUS') {
      const times = eliminatedIds
        .map((id) => clickAt.get(id))
        .filter((t) => t !== undefined)
        .sort((a, b) => a - b)
      // 가장 가까웠던 두 입력의 간격 — 얼마나 아슬아슬했는지 보여주는 값이다
      if (times.length >= 2) log.gapMs = Math.min(...times.slice(1).map((t, i) => t - times[i]))
    }

    return log
  },

  deadline(ctx) {
    const st = ctx.round.state
    if (ctx.round.phase === 'READY') {
      nunchi.openSubRound(ctx)
      return
    }
    if (ctx.round.phase !== 'PLAYING') return
    // 시간 내 미입력자는 전원 탈락
    const silent = st.aliveIds.filter((id) => !st.clicks.some((c) => c.memberId === id))
    nunchi.resolve(ctx, silent.length > 0 ? silent : [...st.aliveIds], 'TIMEOUT')
  },

  departed(ctx, memberId) {
    // 연결이 끊기면 즉시 탈락 처리한다
    const st = ctx.round.state
    if (ctx.round.phase === 'PLAYING' && st.aliveIds.includes(memberId))
      nunchi.resolve(ctx, [memberId], 'DISCONNECTED')
  },
}

export const ENGINES = { roulette, ladder, kingmaker, timer: timerGame, snipe, nunchi }
