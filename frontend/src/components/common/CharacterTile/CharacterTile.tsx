import type { ButtonHTMLAttributes } from 'react';
import type { Character } from '../../../assets/avatars/characters';
import styles from './CharacterTile.module.css';

// available = 선택 가능, taken = 타인이 이미 선택함(비활성), mine = 현재 사용자가 선택한 캐릭터
type CharacterTileState = 'available' | 'taken' | 'mine';

type CharacterTileProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  character: Character;
  state: CharacterTileState;
  /** state === 'taken'일 때 표시할 선택한 사람 이름 (예: "하늘" → "하늘 선정") */
  pickedBy?: string;
};

// 게임 내 캐릭터 선택 타일(Figma 618:5799) — CHARACTERS 30종 중 하나를 상태별 스타일로 렌더링
export function CharacterTile({ character, state, pickedBy, className, style, ...rest }: CharacterTileProps) {
  // tint는 available·mine 둘 다 원본 색 그대로 사용 — taken일 때만 회색 고정 배경으로 바뀜
  const tileStyle = state === 'taken' ? style : { background: character.tint, ...style };

  return (
    <button
      type="button"
      disabled={state === 'taken'}
      className={[styles.tile, styles[state], className].filter(Boolean).join(' ')}
      style={tileStyle}
      {...rest}
    >
      <img className={styles.image} src={character.image} alt={character.name} />
      {state === 'taken' && <span className={styles.label}>{pickedBy ?? 'OO'} 선정</span>}
      {state === 'mine' && <span className={styles.mineBadge}>★ 내 캐릭터</span>}
    </button>
  );
}
