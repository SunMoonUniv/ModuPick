import { avatarSrc } from '../../assets/avatars'
import { crownIcon } from '../../assets/icons'
import { useRoomStore } from '../../store/roomStore'
import { GAME_ICONS } from '../../constants/gameVisuals'
import type { GameId, WinnerResult } from '../../protocol/types'
import { CARD_CONFETTI, ConfettiPiece, PAGE_CONFETTI } from './confetti'
import { ResultActions } from './ResultActions'
import { ResultStats } from './ResultStats'
import { SafeBand } from './SafeBand'
import styles from './WinnerResultView.module.css'

interface WinnerResultViewProps {
  result: WinnerResult
  gameId: GameId
  gameName: string
}

// 룰렛·눈치처럼 당첨자 한 명을 발표하는 결과 화면 (S-05b · Figma 542:1119).
export function WinnerResultView({ result, gameId, gameName }: WinnerResultViewProps) {
  const room = useRoomStore((s) => s.room)
  const members = useRoomStore((s) => s.members)

  // 당첨자를 뺀 나머지 — 아래 "비껴간 사람" 띠에 깔린다
  const safeMembers = members.filter((m) => m.memberId !== result.winner.memberId)
  const total = members.length || 1
  const chance = ((1 / total) * 100).toFixed(1)

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 당첨자 카드 ── */}
      <section className={styles.card}>
        <div className={styles.banner}>🎉&nbsp;&nbsp;WINNER&nbsp;&nbsp;🎉</div>

        {CARD_CONFETTI.map((piece) => (
          <ConfettiPiece key={`card-${piece[0]}-${piece[1]}`} piece={piece} />
        ))}

        <span className={styles.halo} />
        <span className={styles.winnerRing}>
          <img src={avatarSrc(result.winner.avatarId)} alt="" />
        </span>
        <img className={styles.crown} src={crownIcon} alt="" />

        <h1 className={styles.winnerName}>{result.winner.nickname}</h1>
        <span className={styles.winnerPill}>
          <img src={GAME_ICONS[gameId]} alt="" />
          {gameName} · {result.topic} 당첨!
        </span>

        <ResultStats
          top={595.67}
          items={[
            { left: 250.34, tone: 'cyan', value: `${members.length}명`, label: '함께한 사람' },
            { left: 629.34, tone: 'pink', value: `${chance}%`, label: '당첨 확률' },
          ]}
        />

        <span className={styles.cardFooter}>modupick · 방 {room?.displayCode}</span>
      </section>

      {/* ── 오른쪽 다음 진행 ── */}
      <ResultActions left={1311.67} top={327} />

      {/* ── 아래 비껴간 사람 띠 ── */}
      <SafeBand members={safeMembers} />
    </>
  )
}
