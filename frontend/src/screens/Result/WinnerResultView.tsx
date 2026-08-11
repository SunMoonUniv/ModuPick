import { avatarSrc } from '../../assets/avatars'
import { crownIcon } from '../../assets/icons'
import { useRoomStore } from '../../store/roomStore'
import { memberOf } from './adapters'
import { GAME_ICONS } from '../../constants/gameVisuals'
import type { GameId, WinnerResult } from '../../protocol/types'
import { CARD_CONFETTI, ConfettiPiece, PAGE_CONFETTI } from './confetti'
import { ResultActions } from './ResultActions'
import { ResultStats, serverStatItems } from './ResultStats'
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
  const round = useRoomStore((s) => s.round)

  // 사람 정보는 결과 payload에 없다 — 라운드 명단 스냅샷과 이어 붙인다
  const roster = round?.roster ?? []
  const winner = memberOf(roster, result.winnerMemberId)
  // 당첨자를 뺀 나머지 — 아래 "비껴간 사람" 띠에 깔린다
  const safeMembers = roster.filter((m) => m.memberId !== winner.memberId)

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
          <img src={avatarSrc(winner.avatarId)} alt="" />
        </span>
        <img className={styles.crown} src={crownIcon} alt="" />

        <h1 className={styles.winnerName}>{winner.nickname}</h1>
        <span className={styles.winnerPill}>
          <img src={GAME_ICONS[gameId]} alt="" />
          {gameName} · {result.topic} 당첨!
        </span>

        {/* 요약 수치는 서버가 문구까지 확정해 내려준다 — 이 프레임은 두 칸만 놓인다 */}
        <ResultStats top={595.67} items={serverStatItems(result.stats, [250.34, 629.34])} />

        <span className={styles.cardFooter}>modupick · 방 {room?.displayCode}</span>
      </section>

      {/* ── 오른쪽 다음 진행 ── */}
      <ResultActions left={1311.67} top={327} />

      {/* ── 아래 비껴간 사람 띠 ── */}
      <SafeBand members={safeMembers} />
    </>
  )
}
