import { avatarSrc } from '../../assets/avatars'
import { avatarTileColor } from '../../constants/avatarTiles'
import { Chip } from '../../components/common'
import styles from './AvatarTile.module.css'

interface AvatarTileProps {
  // 서버가 주는 A01~A30 식별자. 배경색도 이 값으로 정해진다
  avatarId: string
  // 다른 사람이 이미 확정(PATCH 성공)해 고를 수 없는 상태
  taken: boolean
  // 선점한 사람의 닉네임. 서버가 주지 않는 경우에만 비어 있다
  takenBy?: string | null
  // 지금 내가 고른 상태
  selected: boolean
  onSelect: () => void
}

// 프로필 화면 아바타 그리드의 칸 하나. 아바타마다 배경색이 다르고, 선점·선택 상태를 색과 테두리로 구분한다.
// 사람 정보를 보여주는 MemberTile과 달리 "고를 수 있는 후보"만 담기 때문에 프로필 화면 전용이다.
export function AvatarTile({ avatarId, taken, takenBy, selected, onSelect }: AvatarTileProps) {
  const classes = [styles.tile, taken ? styles.taken : '', selected ? styles.selected : '']
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={classes}
      // 선점(회색)·선택(옐로) 칸은 상태색이 고정이라 아바타 고유색을 칠하지 않는다
      style={taken || selected ? undefined : { background: avatarTileColor(avatarId) }}
      onClick={onSelect}
      disabled={taken}
      aria-pressed={selected}
    >
      <img className={styles.image} src={avatarSrc(avatarId)} alt="" draggable={false} />
      {selected && (
        <Chip className={styles.label} color="ink" size="sm" mono>
          ★ 내 캐릭터
        </Chip>
      )}
      {/* 선점자 닉네임은 GET /avatars의 takenBy로 온다. 못 받은 경우에만 이름 없이 상태만 알린다 */}
      {taken && <span className={styles.takenLabel}>{takenBy ? `${takenBy} 선점` : '선점됨'}</span>}
    </button>
  )
}
