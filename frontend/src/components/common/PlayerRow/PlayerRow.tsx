import { avatarSrc } from '../../../assets/avatars'
import { crownIcon } from '../../../assets/icons'
import styles from './PlayerRow.module.css'

interface PlayerRowProps {
  nickname: string
  avatarId: string | null
  // 한 줄 소개. 비어 있으면 아무것도 그리지 않는다
  bio?: string
  isHost?: boolean
  isMe?: boolean
  isReady?: boolean
  // 탈락·이탈해서 흐리게 보여야 하는 상태
  isOut?: boolean
  outLabel?: string
  // 지금 이 사람을 고른 상태 (저격 지목 등)
  isPicked?: boolean
  // 클릭해서 고를 수 있는 행인지
  onSelect?: () => void
  // 방장이 강퇴할 수 있는 대상이면 넘긴다
  onKick?: () => void
}

// 대기방 참가자 명단의 549×92 가로 행 카드. 세로 격자로 보여줘야 하는 게임 화면에서는 MemberTile을 쓴다.
export function PlayerRow({
  nickname,
  avatarId,
  bio,
  isHost,
  isMe,
  isReady,
  isOut,
  outLabel = '나감',
  isPicked,
  onSelect,
  onKick,
}: PlayerRowProps) {
  const classes = [
    styles.row,
    isHost ? styles.isHost : '',
    isMe ? styles.isMe : '',
    isPicked ? styles.isPicked : '',
    isOut ? styles.isOut : '',
    onSelect ? styles.selectable : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} onClick={onSelect}>
      <div className={styles.avatarWrap}>
        {isHost && <img className={styles.crown} src={crownIcon} alt="" />}
        <img className={styles.avatarImage} src={avatarSrc(avatarId)} alt="" />
      </div>

      <div className={styles.info}>
        <span className={styles.nickname}>{nickname}</span>
        {bio && <span className={styles.bio}>{bio}</span>}
      </div>

      <div className={styles.trailing}>
        {/* 방장 행은 "방장" 칩만으로 본인임이 드러나므로 "나" 칩을 겹쳐 달지 않는다 */}
        {isMe && !isHost && <span className={`${styles.chip} ${styles.chipMe}`}>나</span>}
        {isOut ? (
          <span className={`${styles.chip} ${styles.chipOut}`}>{outLabel}</span>
        ) : isHost ? (
          <span className={`${styles.chip} ${styles.chipHost}`}>방장</span>
        ) : isReady ? (
          <span className={`${styles.chip} ${styles.chipReady}`}>✓ READY</span>
        ) : (
          <span className={`${styles.chip} ${styles.chipIdle}`}>· 준비 중</span>
        )}
        {onKick && (
          <button
            type="button"
            className={styles.kick}
            onClick={(e) => {
              e.stopPropagation()
              onKick()
            }}
            aria-label="강퇴"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

interface EmptySeatProps {
  // 남은 자리 수 — 한 행으로 묶어 보여준다
  count: number
}

// 아직 아무도 들어오지 않은 자리를 알리는 점선 행.
export function EmptySeat({ count }: EmptySeatProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark}>?</span>
      <span className={styles.emptyText}>빈 자리 {count} · 초대 코드로 참여 대기</span>
    </div>
  )
}
