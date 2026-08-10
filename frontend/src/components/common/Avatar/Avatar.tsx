import type { HTMLAttributes } from 'react'
import { avatarSrc } from '../../../assets/avatars'
import styles from './Avatar.module.css'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  // 서버가 주는 A01~A30 식별자
  avatarId: string | null | undefined
  size?: AvatarSize
  // 프로필 화면에서 지금 고른 상태
  selected?: boolean
  // 다른 사람이 이미 선점해 고를 수 없는 상태
  taken?: boolean
  // 탈락자·이탈자처럼 흐리게 보여야 하는 상태
  dimmed?: boolean
}

// 캐릭터 아바타 원형 이미지. 크기만 다를 뿐 모든 화면이 같은 컴포넌트를 쓴다.
export function Avatar({
  avatarId,
  size = 'md',
  selected = false,
  taken = false,
  dimmed = false,
  className,
  ...rest
}: AvatarProps) {
  const classes = [
    styles.avatar,
    styles[size],
    selected ? styles.selected : '',
    taken ? styles.taken : '',
    dimmed ? styles.dimmed : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      <img className={styles.image} src={avatarSrc(avatarId)} alt="" draggable={false} />
    </div>
  )
}
