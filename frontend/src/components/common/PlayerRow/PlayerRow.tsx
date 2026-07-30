import type { HTMLAttributes } from 'react';
import { Badge } from '../Badge/Badge';
import { Chip } from '../Chip/Chip';
import crownIcon from '../../../assets/icons/crown.png';
import styles from './PlayerRow.module.css';

// 참가자 무대 한 줄의 상태 — host는 방장 본인 행, ready/pending은 나머지 참가자의 준비 여부
export type PlayerRowStatus = 'host' | 'ready' | 'pending';

type PlayerRowProps = Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> & {
  avatarSrc: string;
  avatarTint: string; // 아바타 원 배경색 — CHARACTERS 목록의 캐릭터별 tint 값을 그대로 씀
  name: string;
  subtitle: string; // "@handle · role · 방장" 형태의 한 줄 소개
  status: PlayerRowStatus;
  /** true면 상태 뱃지 옆에 "나" 칩이 붙음 — 참가자 화면에서 로그인한 본인 행 표시 전용 */
  isMe?: boolean;
  /** 넘기면 우측에 강퇴용 X 버튼이 뜸 — 방장 화면 전용, 참가자 화면에서는 생략할 것 */
  onKick?: () => void;
};

// 대기방 참가자 무대의 한 줄(아바타·이름·소개·상태 뱃지) — 방장/참가자 화면이 공통으로 쓰는 행 컴포넌트
export function PlayerRow({ avatarSrc, avatarTint, name, subtitle, status, isMe, onKick, className, ...rest }: PlayerRowProps) {
  return (
    <div
      className={[styles.row, status === 'host' ? styles.rowHost : '', className].filter(Boolean).join(' ')}
      {...rest}
    >
      <div className={styles.avatarWrap}>
        <div className={styles.avatarRing} style={{ background: avatarTint }}>
          <img className={styles.avatarImg} src={avatarSrc} alt={name} />
        </div>
        {/* 방장 본인 행에만 얹히는 왕관 장식 — Badge의 "방장" 라벨과 별개로 아바타 위에 겹쳐 보여줌 */}
        {status === 'host' && <img className={styles.crown} src={crownIcon} alt="" />}
      </div>

      <div className={styles.textCol}>
        <p className={styles.name}>{name}</p>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>

      {isMe && (
        <Chip color="cyan" className={styles.meChip}>
          나
        </Chip>
      )}

      <Badge variant={status} className={styles.badge} />

      {onKick && (
        <button type="button" className={styles.kickBtn} onClick={onKick} aria-label={`${name} 강퇴하기`}>
          ×
        </button>
      )}
    </div>
  );
}
