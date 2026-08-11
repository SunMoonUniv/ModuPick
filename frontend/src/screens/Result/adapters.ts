// 결과 payload를 화면이 그대로 그릴 수 있는 모양으로 옮긴다.
//
// 서버는 사람을 memberId로만 내려보내므로(닉네임·아바타가 없다) 라운드 명단 스냅샷과 이어 붙이는 일이
// 어느 결과 화면에나 필요하다. 그 접합을 화면마다 반복하지 않으려고 여기 모았다.
// 계산은 하지 않는다 — 요약 수치(stats)는 서버가 문구까지 확정해 내려준다.

import type {
  AssignResult,
  MemberId,
  NunchiVerdict,
  RecordResult,
  RosterEntry,
  SnipeDetail,
  TallyResult,
  TimerDetail,
  WinnerResult,
} from '../../protocol/types'

// 결과 화면이 사람 한 명을 그릴 때 필요한 최소 정보
export type ResultMember = RosterEntry

// 명단에 없는 memberId(있어서는 안 되지만 결과가 통째로 비는 것보다 낫다)는 자리만 채운다
const PLACEHOLDER: ResultMember = {
  memberId: '',
  nickname: '알 수 없음',
  avatarId: 'A01',
  joinOrder: 0,
}

export function memberOf(roster: ResultMember[], memberId: MemberId | null): ResultMember {
  if (!memberId) return PLACEHOLDER
  return roster.find((m) => m.memberId === memberId) ?? { ...PLACEHOLDER, memberId }
}

/* ────────────────────────── 시간초 잡기 (WINNER + TimerDetail) ────────────────────────── */

export interface TimerRow {
  member: ResultMember
  // 유효 기록이 없으면 null (START·STOP이 닿지 않은 경우)
  elapsedMs: number | null
  // 목표 대비 부호 있는 오차. 목표보다 빠르면 음수
  diffMs: number | null
  // 순위 막대 길이에 쓰는 절대 오차
  absErrorMs: number | null
  rank: number
}

export interface TimerView {
  targetMs: number
  // CLOSEST면 오차가 적은 쪽이 1위다
  criterion: 'CLOSEST' | 'FARTHEST'
  // 아래에서 다시 매긴 순위 순서다 — 서버가 준 배열 순서를 그대로 쓰지 않는다
  rows: TimerRow[]
}

// **서버의 records 순서(와 rank)는 |오차| 오름차순 한 방향뿐이다.**
// 오차가 큰 쪽이 이기는 판(FARTHEST)에서는 그 1번이 실제 승자(winnerMemberId)와 어긋나므로
// 여기서 판정 기준에 맞춰 다시 세운다. 기록이 없는 사람은 어느 기준에서도 맨 뒤다.
export function toTimerView(result: WinnerResult, roster: ResultMember[]): TimerView {
  const detail = result.detail as TimerDetail
  const rows: TimerRow[] = (detail.records ?? []).map((r) => ({
    member: memberOf(roster, r.memberId),
    elapsedMs: r.elapsedMs,
    diffMs: r.diffMs,
    absErrorMs: r.diffMs === null ? null : Math.abs(r.diffMs),
    // 정렬한 뒤에 채운다
    rank: 0,
  }))

  const farthest = detail.criterion === 'FARTHEST'
  // 기록 없는 사람끼리는 서버가 준 순서(미정지 → 미시작)를 그대로 둔다 — Array.sort가 안정 정렬이다
  rows.sort((a, b) => {
    if (a.absErrorMs === null || b.absErrorMs === null) {
      return (a.absErrorMs === null ? 1 : 0) - (b.absErrorMs === null ? 1 : 0)
    }
    return farthest ? b.absErrorMs - a.absErrorMs : a.absErrorMs - b.absErrorMs
  })
  rows.forEach((row, i) => {
    row.rank = i + 1
  })

  return { targetMs: detail.targetMs, criterion: detail.criterion, rows }
}

/* ────────────────────────── 익명 저격 (WINNER + SnipeDetail) ────────────────────────── */

export interface SnipeView {
  topic: string
  winner: ResultMember
  // 사람별 피격 수. 지목자는 어느 설정에서도 실리지 않는다
  tally: { member: ResultMember; hits: number }[]
  abstainCount: number
  // 전원 동표 등으로 무작위 확정된 판인지
  randomFallback: boolean
}

export function toSnipeView(result: WinnerResult, roster: ResultMember[]): SnipeView {
  const detail = result.detail as SnipeDetail
  return {
    topic: result.topic,
    winner: memberOf(roster, result.winnerMemberId),
    tally: (detail.tally ?? []).map((row) => ({
      member: memberOf(roster, row.memberId),
      hits: row.hits,
    })),
    abstainCount: detail.abstainCount ?? 0,
    randomFallback: detail.randomFallback ?? false,
  }
}

/* ────────────────────────── 킹메이커 (TALLY) ────────────────────────── */

export interface TallyView {
  topic: string
  winnerCandidateId: string | null
  // 서버가 득표 순으로 보내온 순서를 그대로 쓴다
  rows: {
    candidateId: string
    text: string
    votes: number
    rank: number
    // 제시자 실명 공개를 켠 판에서만 채워진다
    author: ResultMember | null
  }[]
  // 제시자를 공개하는 판인지
  revealAuthors: boolean
  winnerLabel: string
}

export function toTallyView(result: TallyResult, roster: ResultMember[]): TallyView {
  const reveal = result.reveal?.authors === true
  return {
    topic: result.topic,
    winnerCandidateId: result.winnerCandidateId,
    rows: (result.rows ?? []).map((row, i) => ({
      candidateId: row.candidateId,
      text: row.text,
      votes: row.votes,
      rank: i + 1,
      author: reveal && row.authorMemberId ? memberOf(roster, row.authorMemberId) : null,
    })),
    revealAuthors: reveal,
    winnerLabel:
      result.rows?.find((r) => r.candidateId === result.winnerCandidateId)?.text ?? '—',
  }
}

/* ────────────────────────── 사다리 (ASSIGN) ────────────────────────── */

export interface AssignView {
  topic: string
  pairs: { member: ResultMember; item: string }[]
}

export function toAssignView(result: AssignResult, roster: ResultMember[]): AssignView {
  return {
    topic: result.topic,
    pairs: (result.pairs ?? []).map((p) => ({
      member: memberOf(roster, p.memberId),
      item: p.itemLabel,
    })),
  }
}

/* ────────────────────────── 눈치게임 (RECORD) ────────────────────────── */

export interface NunchiView {
  topic: string
  // 끝까지 남아 뽑힌 한 명. **탈락이 아니라 선정이다**
  picked: ResultMember
  rounds: {
    round: number
    rows: { member: ResultMember; verdict: NunchiVerdict; elapsedMs: number | null }[]
  }[]
}

export function toNunchiView(result: RecordResult, roster: ResultMember[]): NunchiView {
  return {
    topic: result.topic,
    picked: memberOf(roster, result.pickedMemberId),
    rounds: (result.rounds ?? []).map((r) => ({
      round: r.round,
      rows: (r.rows ?? []).map((row) => ({
        member: memberOf(roster, row.memberId),
        verdict: row.verdict,
        elapsedMs: row.elapsedMs,
      })),
    })),
  }
}
