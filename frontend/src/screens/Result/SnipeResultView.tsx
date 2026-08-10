import { avatarSrc } from '../../assets/avatars'
import { useRoomStore } from '../../store/roomStore'
import type { TallyResult } from '../../protocol/types'
import { CARD_CONFETTI, ConfettiPiece, PAGE_CONFETTI } from './confetti'
import { ResultActions } from './ResultActions'
import { ResultStats } from './ResultStats'
import { SafeBand } from './SafeBand'
import styles from './SnipeResultView.module.css'

interface SnipeResultViewProps {
  result: TallyResult
  // 설정에서 지목자를 공개하기로 했는지 — 서버가 voterNicknames를 실어 보냈는지로 판단해 넘어온다
  reveal: boolean
}

// 익명 저격의 최다 피격자 발표 (S-09b · Figma 542:2476).
// 같은 tally 결과라도 킹메이커는 득표표(TallyResultView)를, 저격은 이 당첨자 카드를 쓴다.
export function SnipeResultView({ result, reveal }: SnipeResultViewProps) {
  const room = useRoomStore((s) => s.room)
  const round = useRoomStore((s) => s.round)

  const members = round?.roundMembers ?? []
  // 득표순으로 이미 정렬돼 오므로 맨 앞이 최다 피격자다
  const topRow = result.rows[0]
  const target = members.find((m) => m.memberId === topRow?.memberId)
  const votes = topRow?.votes ?? 0
  const total = members.length || 1
  const rate = ((votes / total) * 100).toFixed(1)

  // 받은 표는 사람마다 다르므로 비껴간 사람 알약에 그대로 실어 보여준다
  const votesOf = new Map(result.rows.map((r) => [r.memberId, r.votes]))
  const safeMembers = members.filter((m) => m.memberId !== topRow?.memberId)

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 최다 피격자 카드 ── */}
      <section className={styles.card}>
        <div className={styles.banner}>🎯&nbsp;&nbsp;Q. {result.topic}</div>

        {CARD_CONFETTI.map((piece) => (
          <ConfettiPiece key={`card-${piece[0]}-${piece[1]}`} piece={piece} />
        ))}

        <span className={styles.halo} />
        <span className={styles.ring}>
          <img src={avatarSrc(target?.avatarId)} alt="" />
        </span>
        {/* 당첨자 발표의 왕관 자리에 저격은 과녁이 들어간다 */}
        <span className={styles.mark}>🎯</span>

        <h1 className={styles.name}>{target?.nickname ?? result.winnerLabel}</h1>
        <span className={styles.pill}>
          <span className={styles.pillIcon}>🎯</span>
          익명 저격 · 최다 피격 {votes}표!
        </span>

        <ResultStats
          top={565.31}
          items={[
            { left: 47.01, tone: 'cyan', value: `${votes}표`, label: '나를 지목한 사람' },
            { left: 425.67, tone: 'pink', value: `${rate}%`, label: '지목률' },
            {
              left: 804.34,
              tone: 'yellow',
              value: reveal ? '👀 실명' : '🤐 익명',
              label: reveal ? '지목자 공개' : '지목자 비공개',
            },
          ]}
        />

        <span className={styles.footer}>modupick · 방 {room?.displayCode}</span>
      </section>

      {/* ── 오른쪽 다음 진행 ── */}
      <ResultActions left={1312} top={297} />

      {/* ── 아래 비껴간 사람 띠 ── */}
      <SafeBand
        members={safeMembers}
        pillLabel={(memberId) => {
          const got = votesOf.get(memberId) ?? 0
          return got > 0 ? `세이프! · ${got}표` : '세이프!'
        }}
      />
    </>
  )
}
