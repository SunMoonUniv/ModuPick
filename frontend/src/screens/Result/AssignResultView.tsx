import { avatarSrc } from '../../assets/avatars'
import { GAME_ICONS } from '../../constants/gameVisuals'
import { useRoomStore } from '../../store/roomStore'
import type { Member, ResultStat } from '../../protocol/types'
import type { AssignView } from './adapters'
import { ConfettiPiece, type ConfettiSpec } from './confetti'
import { ResultActions } from './ResultActions'
import { ResultStats, serverStatItems } from './ResultStats'
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
  return [member.bio, member.isHost ? '방장' : ''].filter(Boolean).join(' · ')
}

interface AssignResultViewProps {
  view: AssignView
  // 아래 통계 타일 줄. 문구까지 서버가 확정해 내려준다
  stats: ResultStat[]
}

// 사다리처럼 참가자 ↔ 항목을 1:1로 나눠 갖는 결과 화면 (S-06b · Figma 542:2049).
export function AssignResultView({ view, stats }: AssignResultViewProps) {
  const room = useRoomStore((s) => s.room)
  const members = useRoomStore((s) => s.members)

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 배분 결과 카드 ── */}
      <section className={styles.card}>
        {/* 사다리 이모지(🪜, 이모지 13.0)는 윈도우 10 기본 글꼴에 없어 두부(□)로 나온다 — 저장소의 게임 아이콘을 쓴다 */}
        <div className={styles.banner}>
          <img className={styles.bannerIcon} src={GAME_ICONS.ladder} alt="" />
          역할 배분 결과
          <img className={styles.bannerIcon} src={GAME_ICONS.ladder} alt="" />
        </div>

        <div className={`${styles.grid} scroll-thin`}>
          {view.pairs.map(({ member, item }, i) => {
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

        <ResultStats top={629.67} items={serverStatItems(stats, [47.67, 426.34, 805.01])} />

        <span className={styles.cardFooter}>modupick · 방 {room?.displayCode}</span>
      </section>

      <ResultActions left={1328} top={378} />
    </>
  )
}
