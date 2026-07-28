import type { HTMLAttributes } from 'react';
import { Avatar } from '../Avatar/Avatar';
import styles from './SafeBandChip.module.css';

type SafeBandChipProps = HTMLAttributes<HTMLDivElement> & {
  name: string;
  avatarSrc?: string;
};

// 서바이벌 게임 결과 밴드에서 탈락하지 않은 참가자를 보여주는 행 (아바타 + 이름 + "세이프!" 필)
export function SafeBandChip({ name, avatarSrc, className, ...rest }: SafeBandChipProps) {
  return (
    <div className={[styles.chip, className].filter(Boolean).join(' ')} {...rest}>
      <Avatar size={40} src={avatarSrc} alt="" />
      <span className={styles.name}>{name}</span>
      <span className={styles.safeLabel}>세이프!</span>
    </div>
  );
}
