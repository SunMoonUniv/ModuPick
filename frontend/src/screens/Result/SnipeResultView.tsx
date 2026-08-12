import { avatarSrc } from '../../assets/avatars'
import { useRoomStore } from '../../store/roomStore'
import type { WinnerResult } from '../../protocol/types'
import type { SnipeView } from './adapters'
import { CARD_CONFETTI, ConfettiPiece, PAGE_CONFETTI } from './confetti'
import { ResultActions } from './ResultActions'
import { ResultStats, serverStatItems } from './ResultStats'
import { SafeBand } from './SafeBand'
import styles from './SnipeResultView.module.css'

interface SnipeResultViewProps {
  view: SnipeView
  // 아래 통계 타일 줄. 문구까지 서버가 확정해 내려준다
  stats: WinnerResult['stats']
}

// 익명 저격의 최다 피격자 발표 (S-09b · Figma 542:2476).
// 저격은 결과 형태가 WINNER지만 당첨자 발표(542:1119)와 달리 질문과 피격 수를 함께 싣는다.
export function SnipeResultView({ view, stats }: SnipeResultViewProps) {
  const room = useRoomStore((s) => s.room)
  const round = useRoomStore((s) => s.round)

  const members = round?.roster ?? []
  // 피격 수는 사람마다 다르므로 비껴간 사람 알약에 그대로 실어 보여준다
  const hitsOf = new Map(view.tally.map((row) => [row.member.memberId, row.hits]))
  const votes = hitsOf.get(view.winner.memberId) ?? 0
  const safeMembers = members.filter((m) => m.memberId !== view.winner.memberId)

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 최다 피격자 카드 ── */}
      <section className={styles.card}>
        {/* 질문은 방장이 비워 둘 수 있다(서버 기본값이 빈 문자열이다). 밴드 전체가 질문 자리라 */}
        {/* 비면 라벨만 뜬 빈 띠가 남으므로 아예 그리지 않는다 */}
        {view.topic && <div className={styles.banner}>🎯&nbsp;&nbsp;Q. {view.topic}</div>}

        {CARD_CONFETTI.map((piece) => (
          <ConfettiPiece key={`card-${piece[0]}-${piece[1]}`} piece={piece} />
        ))}

        <span className={styles.halo} />
        <span className={styles.ring}>
          <img src={avatarSrc(view.winner.avatarId)} alt="" />
        </span>
        {/* 당첨자 발표의 왕관 자리에 저격은 과녁이 들어간다 */}
        <span className={styles.mark}>🎯</span>

        <h1 className={styles.name}>{view.winner.nickname}</h1>
        <span className={styles.pill}>
          <span className={styles.pillIcon}>🎯</span>
          {/* 전원 동표라 무작위로 갈린 판은 그렇게 밝힌다 — 표만 보면 왜 이 사람인지 알 수 없다 */}
          {view.randomFallback ? '동표 · 무작위 확정!' : `익명 저격 · 최다 피격 ${votes}표!`}
        </span>

        <ResultStats top={565.31} items={serverStatItems(stats, [47.01, 425.67, 804.34])} />

        <span className={styles.footer}>modupick · 방 {room?.displayCode}</span>
      </section>

      {/* ── 오른쪽 다음 진행 ── */}
      <ResultActions left={1312} top={297} />

      {/* ── 아래 비껴간 사람 띠 ── */}
      <SafeBand
        members={safeMembers}
        pillLabel={(memberId) => {
          const got = hitsOf.get(memberId) ?? 0
          return got > 0 ? `세이프! · ${got}표` : '세이프!'
        }}
      />
    </>
  )
}
