import { avatarSrc } from '../../assets/avatars'
import { useRoomStore } from '../../store/roomStore'
import type { AssignResult, Member } from '../../protocol/types'
import { ConfettiPiece, type ConfettiSpec } from './confetti'
import { ResultActions } from './ResultActions'
import { ResultStats } from './ResultStats'
import styles from './AssignResultView.module.css'

// 역할 카드가 순서대로 돌려 쓰는 파스텔 배경과 아바타 링 색 (프레임의 6종을 그대로)
const ROLE_TONES = [
  { bg: 'var(--color-stat-yellow)', ring: 'var(--color-yellow)' },
  { bg: 'var(--color-stat-pink)', ring: 'var(--color-pink)' },
  { bg: 'var(--color-pastel-3)', ring: 'var(--color-cyan)' },
  { bg: 'var(--color-pastel-1)', ring: 'var(--color-online)' },
  { bg: 'var(--color-pastel-4)', ring: 'var(--color-lilac)' },
  { bg: 'var(--color-pastel-5)', ring: 'var(--color-teal)' },
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

// 이름 아래 한 줄 — 대기방에서 쓴 소개글에 방장 표시를 덧붙인다 (둘 다 없으면 빈 줄)
function subLine(member: Member | undefined) {
  if (!member) return ''
  return [member.bio, member.role === 'host' ? '방장' : ''].filter(Boolean).join(' · ')
}

interface AssignResultViewProps {
  result: AssignResult
  // 라운드 시작부터 결과 도착까지 걸린 시간 — "사다리 소요" 통계에 쓴다
  elapsedMs: number
}

// 사다리처럼 참가자 ↔ 항목을 1:1로 나눠 갖는 결과 화면 (S-06b · Figma 542:2049).
export function AssignResultView({ result, elapsedMs }: AssignResultViewProps) {
  const room = useRoomStore((s) => s.room)
  const members = useRoomStore((s) => s.members)

  // 같은 항목이 두 사람에게 갈 수도 있어 배분된 역할 수는 중복을 뺀 개수로 센다
  const roleCount = new Set(result.assignments.map((a) => a.item)).size

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 배분 결과 카드 ── */}
      <section className={styles.card}>
        <div className={styles.banner}>🪜&nbsp;&nbsp;역할 배분 결과&nbsp;&nbsp;🪜</div>

        <div className={`${styles.grid} scroll-thin`}>
          {result.assignments.map(({ member, item }, i) => {
            const tone = ROLE_TONES[i % ROLE_TONES.length]
            const sub = subLine(members.find((m) => m.memberId === member.memberId))
            return (
              <div key={member.memberId} className={styles.role} style={{ background: tone.bg }}>
                <span className={styles.avatar} style={{ background: tone.ring }}>
                  <img src={avatarSrc(member.avatarId)} alt="" />
                </span>
                <span className={styles.name}>
                  <b>{member.nickname}</b>
                  {sub && <em>{sub}</em>}
                </span>
                <span className={styles.pill}>{item}</span>
              </div>
            )
          })}
        </div>

        <span className={styles.lock}>🔒&nbsp;&nbsp;배분 확정 · 방장이 다시 돌리기 전까지 유지돼요</span>

        <ResultStats
          top={629.67}
          items={[
            {
              left: 47.67,
              tone: 'cyan',
              value: `${result.assignments.length}명`,
              label: '역할 배분 완료',
            },
            { left: 426.34, tone: 'pink', value: `${roleCount}개`, label: '배분된 역할' },
            {
              left: 805.01,
              tone: 'yellow',
              value: `${(elapsedMs / 1000).toFixed(1)}초`,
              label: '사다리 소요',
            },
          ]}
        />

        <span className={styles.cardFooter}>modupick · 방 {room?.displayCode}</span>
      </section>

      <ResultActions left={1328} top={378} />
    </>
  )
}
