import type { ImgHTMLAttributes } from 'react';
import defaultAvatar from '../../../assets/avatars/avatar-placeholder-1.svg';
import styles from './Avatar.module.css';

type AvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'width' | 'height'> & {
  /** px, 스펙 범위 42~72 (참가자 카드 표준 60) */
  size?: number;
};

// 원형 아바타 이미지 — src가 없으면 기본 플레이스홀더로 대체됨
export function Avatar({ size = 60, src, alt = '', className, ...rest }: AvatarProps) {
  return (
    <img
      src={src ?? defaultAvatar}
      alt={alt}
      width={size}
      height={size}
      className={[styles.avatar, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      {...rest}
    />
  );
}
