import type { ReactNode } from 'react'
import { Avatar } from '../Avatar/Avatar'
import { Badge } from '../Badge/Badge'
import styles from './MemberTile.module.css'

interface MemberTileProps {
  nickname: string
  avatarId: string | null
  bio?: string
  isHost?: boolean
  isMe?: boolean
  isReady?: boolean
  // 탈락·이탈해서 흐리게 보여야 하는 상태
  isOut?: boolean
  // 탈락/이탈 대신 보여줄 문구 (예: '탈락', '나감')
  outLabel?: string
  // 지금 이 사람을 고른 상태 (저격 지목 등)
  isPicked?: boolean
  // 클릭해서 고를 수 있는 타일인지
  onSelect?: () => void
  // 방장이 강퇴할 수 있는 대상이면 넘긴다
  onKick?: () => void
  // 좌상단에 붙는 숫자 (순위·득표수 등)
  corner?: ReactNode
}

// 대기방 명단부터 게임 화면·결과 화면까지 사람 한 명을 보여주는 공통 타일.
// 상태 조합(방장/준비/탈락/지목)이 화면마다 달라서 전부 prop으로 받는다.
export function MemberTile({
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
  corner,
}: MemberTileProps) {
  const classes = [
    styles.tile,
    isMe ? styles.isMe : '',
    isReady ? styles.isReady : '',
    isPicked ? styles.isPicked : '',
    isOut ? styles.isOut : '',
    onSelect ? styles.selectable : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} onClick={onSelect}>
      {corner !== undefined && <span className={styles.corner}>{corner}</span>}
      {onKick && (
        <button type="button" className={styles.kick} onClick={onKick} aria-label="강퇴">
          ✕
        </button>
      )}
      <Avatar avatarId={avatarId} size="md" dimmed={isOut} />
      <span className={styles.nickname}>{nickname}</span>
      <span className={styles.bio}>{bio}</span>
      <div className={styles.badges}>
        {isHost && <Badge tone="host">방장</Badge>}
        {isMe && <Badge tone="me">나</Badge>}
        {isOut && <Badge tone="out">{outLabel}</Badge>}
        {!isOut && !isHost && (isReady ? <Badge tone="ready">준비완료</Badge> : <Badge tone="waiting">대기중</Badge>)}
      </div>
    </div>
  )
}
