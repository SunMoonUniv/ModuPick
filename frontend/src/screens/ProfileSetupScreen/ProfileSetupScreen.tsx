import { useId, useState, type ChangeEvent } from 'react';
import { Button, Card, CharacterTile, Input, ScreenFrame } from '../../components/common';
import { CHARACTERS, type Character } from '../../assets/avatars/characters';
import styles from './ProfileSetupScreen.module.css';

const NICKNAME_MAX_LENGTH = 8; // 플레이어 카드 이름칸 폭 기준 실측(코딩왕지호=5자에 여유 3자)
const TILE_COUNT = 15; // "15종 중 하나" 문구와 맞춘 1페이지 분량 — 나머지 15종은 이후 페이지네이션 몫
const PARTICIPANT_NO = 6; // 오늘 이 방에 입장한 순번 — P6 태그·하단 문구에 공유되는 데모용 고정값

// 캐릭터 선택 타일 15칸 중 다른 사람이 이미 고른 자리 — index별 이름 지정, 나머지는 available
// 실제로는 서버가 동시 접속자 간 선점을 조율해야 함 — 지금은 고정값으로만 흉내냄(임시)
const TAKEN_BY: Record<number, string> = { 1: '서연', 5: '민준', 11: '하늘' };

type TileState = 'available' | 'taken' | 'mine';

// 캐릭터 15종 각각의 선점 상태 — index 0을 내 기본 캐릭터로 시작하고, 이후 클릭/랜덤 뽑기로 바뀜
function buildInitialStates(mineIndex: number): TileState[] {
  return CHARACTERS.slice(0, TILE_COUNT).map((_, index) => {
    if (index === mineIndex) return 'mine';
    return TAKEN_BY[index] ? 'taken' : 'available';
  });
}

type ProfileSetupScreenProps = {
  /** "◀ 뒤로가기" 클릭 시 호출 — 이전 화면(메인/방 만들기 등)으로 복귀하는 용도 */
  onBack?: () => void;
  /** "▶ 대기방 입장하기" 클릭 시 호출 — 닉네임·소개·고른 캐릭터를 실어 보내며, 실제 입장 처리는 이 화면 밖에서 담당 */
  onEnterRoom?: (profile: { nickname: string; intro: string; character: Character }) => void;
};

// 캐릭터 고르기 & 프로필 설정 화면 — 닉네임·한 줄 소개를 입력하고 30종 중 캐릭터를 골라 대기방에 입장하는 화면(Figma 542:642)
export function ProfileSetupScreen({ onBack, onEnterRoom }: ProfileSetupScreenProps) {
  const [nickname, setNickname] = useState('코딩왕지호');
  const [intro, setIntro] = useState('@jiho_dev · 프론트 담당');
  // 내가 고른 캐릭터의 인덱스 — 처음엔 0번(index 0)이 기본값
  const [myIndex, setMyIndex] = useState(0);
  const [tileStates, setTileStates] = useState(() => buildInitialStates(0));
  const nicknameId = useId();
  const introId = useId();

  const handleNicknameChange = (e: ChangeEvent<HTMLInputElement>) => setNickname(e.target.value);
  const handleIntroChange = (e: ChangeEvent<HTMLInputElement>) => setIntro(e.target.value);

  // 다른 사람이 고르지 않은 available 타일 클릭 시 내 캐릭터로 교체 — 이전 내 자리는 다시 available로 풀림
  const handlePickTile = (index: number) => {
    if (tileStates[index] !== 'available') return;
    setTileStates((prev) => prev.map((s, i) => (i === index ? 'mine' : i === myIndex ? 'available' : s)));
    setMyIndex(index);
  };

  const handleRandomPick = () => {
    const availableIndexes = tileStates.reduce<number[]>((acc, s, i) => (s === 'available' ? [...acc, i] : acc), []);
    if (availableIndexes.length === 0) return;
    const pick = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    handlePickTile(pick);
  };

  const myCharacter = CHARACTERS[myIndex];
  const canEnterRoom = nickname.trim().length > 0;
  const handleEnterRoom = () => {
    if (!canEnterRoom) return;
    onEnterRoom?.({ nickname: nickname.trim(), intro: intro.trim(), character: myCharacter });
  };

  return (
    <ScreenFrame>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.headerBadge}>🎮 캐릭터 고르기</span>
          <h1 className={styles.title}>캐릭터를 골라줘!</h1>
          <p className={styles.subtitle}>나를 대표할 동물 캐릭터를 고르고, 닉네임 정하고, 대기방으로 입장!</p>
        </div>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ◀ 뒤로가기
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.colLeft}>
          <Card className={styles.playerCard}>
            <div className={styles.playerCardTop}>
              <span className={styles.playerCardLabel}>★ 내 캐릭터</span>
              <span className={styles.playerCardTag}>P{PARTICIPANT_NO}</span>
            </div>

            <div className={styles.avatarStage}>
              {/* 아바타 주변 반짝임 장식 — 별도 에셋 없이 기존에도 쓰는 이모지 글리프로 표현 */}
              <span className={`${styles.sparkle} ${styles.sparkleTl}`}>✦</span>
              <span className={`${styles.sparkle} ${styles.sparkleTr}`}>✦</span>
              <span className={`${styles.sparkle} ${styles.sparkleBl}`}>✦</span>
              <span className={`${styles.sparkle} ${styles.sparkleBr}`}>✦</span>
              <div className={styles.avatarGlow}>
                <div className={styles.avatarRing} style={{ background: myCharacter.tint }}>
                  <img className={styles.avatarImage} src={myCharacter.image} alt={myCharacter.name} />
                </div>
              </div>
            </div>

            <p className={styles.playerName}>{nickname || '닉네임을 입력해주세요'}</p>
            <p className={styles.playerHandle}>{intro || '한 줄 소개를 입력해주세요'}</p>
            <div className={styles.playerDivider} />
            <p className={styles.playerJoinBadge}>🎉 오늘의 {PARTICIPANT_NO}번째 참가자!</p>
          </Card>

          <Button variant="hero" className={styles.enterButton} disabled={!canEnterRoom} onClick={handleEnterRoom}>
            ▶ 대기방 입장하기
          </Button>
          <div className={styles.footerPill}>🎉 팀원 5명이 먼저 와서 기다리는 중!</div>
        </div>

        <div className={styles.colRight}>
          <div className={styles.fieldsRow}>
            <div className={styles.field}>
              <label className={styles.fieldLabelRequired} htmlFor={nicknameId}>
                ● 닉네임 (필수)
              </label>
              <Input
                id={nicknameId}
                className={`${styles.fieldInput} ${styles.fieldInputName}`}
                value={nickname}
                onChange={handleNicknameChange}
                maxLength={NICKNAME_MAX_LENGTH}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabelOptional} htmlFor={introId}>
                ○ 한 줄 소개 (선택)
              </label>
              <Input
                id={introId}
                className={`${styles.fieldInput} ${styles.fieldInputIntro}`}
                value={intro}
                onChange={handleIntroChange}
              />
            </div>
          </div>

          <div className={styles.avatarSection}>
            <div className={styles.avatarSectionHead}>
              <div>
                <h2 className={styles.avatarSectionTitle}>◆ 아바타 고르기</h2>
                <p className={styles.avatarSectionDesc}>15종 중 하나 · 선택된 캐릭터는 잠겨요</p>
              </div>
              <Button variant="pink" className={styles.randomButton} onClick={handleRandomPick}>
                🎲 랜덤 뽑기
              </Button>
            </div>

            <div className={styles.tileGrid}>
              {CHARACTERS.slice(0, TILE_COUNT).map((character, index) => (
                <CharacterTile
                  key={character.id}
                  character={character}
                  state={tileStates[index]}
                  pickedBy={TAKEN_BY[index]}
                  onClick={() => handlePickTile(index)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}
