import { avatarSrc } from '../../assets/avatars'
import { useRoomStore } from '../../store/roomStore'
import type { ResultStat } from '../../protocol/types'
import type { TimerView } from './adapters'
import { ConfettiPiece, type ConfettiSpec } from './confetti'
import { ResultActions } from './ResultActions'
import { ResultStats, serverStatItems } from './ResultStats'
import styles from './RecordResultView.module.css'

// 순위표가 1위부터 순서대로 돌려 쓰는 색 — 아바타 링과 정확도 막대에 같은 색을 쓴다
const RANK_TONES = [
  'var(--color-yellow)',
  'var(--color-online)',
  'var(--color-teal)',
  'var(--color-cyan)',
  'var(--color-pink)',
  'var(--color-lilac)',
]

// 아래 기록 분포 띠의 오차 칩 색 — 띠에 깔린 그라데이션의 정지점(0% / 34% / 67% / 100%)과 같은 색이다
const SPREAD_TONES = [
  'var(--color-error-near)',
  'var(--color-yellow)',
  'var(--color-pink)',
  'var(--color-lilac)',
]

// 화면 위쪽으로 흩날리는 색종이 (화면 좌표 기준, 프레임 값 그대로)
const PAGE_CONFETTI: ConfettiSpec[] = [
  [293.33, 17.14, 21.09, 18.98, -31, 2],
  [477.35, 112.85, 12.66, 25.31, 6, 3],
  [655.95, 120.23, 16.88, 18.98, 43, 4],
  [856.12, 123.95, 21.09, 25.31, -10, 0],
  [1033.05, 109.69, 12.66, 18.98, 27, 1],
  [1228.9, 109.67, 16.88, 25.31, -26, 2],
  [1415.28, 124.45, 21.09, 18.98, 11, 3],
  [1603.34, 98.05, 12.66, 25.31, -42, 4],
]

// 기록 분포 띠에서 1위 마크의 중심 x와, 1위~꼴찌 중심 사이의 전체 폭 (밴드 안쪽 좌표계)
const SPREAD_START = 82.11
const SPREAD_SPAN = 1400

// 프레임이 초를 소수점 두 자리로 적는다 ("5.02초")
function sec(ms: number) {
  return (ms / 1000).toFixed(2)
}

// 기록이 없는 사람(START·STOP이 닿지 않음)의 시간 칸. 빈칸으로 두면 자리만 비어 이유가 안 보인다
function secOrDash(ms: number | null) {
  return ms === null ? '-초' : `${sec(ms)}초`
}

// 부호를 붙인 목표 대비 시간차. 목표보다 빨랐으면 −, 늦었으면 + (프레임과 같은 유니코드 마이너스 기호)
function dev(ms: number) {
  return `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(2)}`
}

interface RecordResultViewProps {
  view: TimerView
  // 아래 통계 타일 줄. 문구까지 서버가 확정해 내려준다
  stats: ResultStat[]
}

// 시간초 잡기처럼 참가자별 기록으로 순위를 매기는 결과 화면 (S-08b · Figma 542:2292).
export function RecordResultView({ view, stats }: RecordResultViewProps) {
  const room = useRoomStore((s) => s.room)
  const me = useRoomStore((s) => s.me?.memberId ?? null)

  // 서버가 순위대로 보내온 순서를 그대로 쓴다
  const rows = view.rows
  const winner = rows[0]
  // 오차가 가장 큰 사람을 100%로 잡아 정확도 막대의 길이를 정한다 (기록 없는 사람은 계산에서 뺀다)
  const worstErrorMs = Math.max(1, ...rows.map((r) => r.absErrorMs ?? 0))
  // "오차 최대"가 승리 조건이면 막대가 반대로 길어진다
  const isClosest = view.criterion === 'CLOSEST'

  // 유효 기록이 하나도 없으면 순위표 자체가 성립하지 않는다
  if (!winner) return null

  // 정확도 막대의 채움 비율 (0~1). 기록이 없으면 빈 막대다.
  const fillRatio = (absErrorMs: number | null) => {
    if (absErrorMs === null) return 0
    const ratio = absErrorMs / worstErrorMs
    return isClosest ? 1 - ratio : ratio
  }

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 기록 순위 카드 ── */}
      <section className={styles.card}>
        <div className={styles.banner}>⏱&nbsp;&nbsp;기록 순위&nbsp;&nbsp;⏱</div>

        {/* 왼쪽 1위 스포트라이트 */}
        <span className={styles.halo} />
        <span className={styles.ring} style={{ background: RANK_TONES[0] }}>
          <img src={avatarSrc(winner.member.avatarId)} alt="" />
        </span>
        <span className={styles.trophy}>🏆</span>

        <h1 className={styles.winnerName}>{winner.member.nickname}</h1>
        <span className={styles.winnerPill}>
          <span className={styles.winnerPillIcon}>⏱</span>
          {winner.absErrorMs === null
            ? '기록 없음 · 1위'
            : `오차 ${sec(winner.absErrorMs)}초 · 1위!`}
        </span>
        <span className={styles.winnerSub}>
          목표 {sec(view.targetMs)}초 → {winner.member.memberId === me ? '내 기록' : '1위 기록'}{' '}
          {secOrDash(winner.elapsedMs)}
        </span>

        {/* 오른쪽 순위표 */}
        <span className={styles.listTitle}>
          ◆ 기록 순위 · 오차가 {isClosest ? '적은' : '큰'} 순
        </span>
        <div className={`${styles.records} scroll-thin`}>
          {rows.map((row, i) => {
            const tone = RANK_TONES[i % RANK_TONES.length]
            return (
              <div key={row.member.memberId} className={styles.record}>
                <span className={`${styles.rank} ${i === 0 ? styles.rankTop : ''}`}>
                  {row.rank}
                </span>
                <span className={styles.avatar} style={{ background: tone }}>
                  <img src={avatarSrc(row.member.avatarId)} alt="" />
                </span>
                <span className={styles.name}>{row.member.nickname}</span>
                <span className={styles.score}>{secOrDash(row.elapsedMs)}</span>
                <span className={styles.accuracy}>
                  <span
                    className={styles.accuracyFill}
                    style={{ width: `${fillRatio(row.absErrorMs) * 100}%`, background: tone }}
                  />
                </span>
                <span className={`${styles.dev} ${i === 0 ? styles.devTop : ''}`}>
                  {row.diffMs === null ? '—' : dev(row.diffMs)}
                </span>
              </div>
            )
          })}
        </div>

        <ResultStats top={565.31} items={serverStatItems(stats, [47.01, 425.67, 804.34])} />

        <span className={styles.cardFooter}>modupick · 방 {room?.displayCode}</span>
      </section>

      {/* ── 오른쪽 다음 진행 ── */}
      <ResultActions left={1312} top={272} />

      {/* ── 아래 기록 분포 띠 ── */}
      <section className={styles.spread}>
        <span className={styles.spreadTitle}>
          ⏱ 기록 분포 · 목표 {sec(view.targetMs)}초에{' '}
          {isClosest ? '가까울수록' : '멀수록'} 왼쪽 순위
        </span>
        <span className={styles.spreadTrack} />
        <span className={styles.spreadGoalTick} />
        <span className={styles.spreadGoal}>🎯 목표 {sec(view.targetMs)}초</span>

        {rows.map((row, i) => {
          // 마크는 기록값이 아니라 순위 간격으로 고르게 놓인다 — 1위가 왼쪽 끝, 꼴찌가 오른쪽 끝
          const t = rows.length > 1 ? i / (rows.length - 1) : 0
          const x = SPREAD_START + t * SPREAD_SPAN
          const chipTone = SPREAD_TONES[t < 0.34 ? 0 : t < 0.67 ? 1 : t < 1 ? 2 : 3]
          return (
            <span key={row.member.memberId} className={styles.mark} style={{ left: x }}>
              <span
                className={`${styles.markAvatar} ${i === 0 ? styles.markTop : ''}`}
                style={{ background: RANK_TONES[i % RANK_TONES.length] }}
              >
                <img src={avatarSrc(row.member.avatarId)} alt="" />
              </span>
              <span className={styles.markName}>
                {row.member.nickname} {row.elapsedMs === null ? '-' : sec(row.elapsedMs)}
              </span>
              <span className={styles.markDev} style={{ background: chipTone }}>
                {row.diffMs === null ? '—' : dev(row.diffMs)}
              </span>
            </span>
          )
        })}
      </section>
    </>
  )
}
