import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { Button, Card, CharacterTile, Input, ScreenFrame } from '../../components/common';
import { CHARACTERS, type Character } from '../../assets/avatars/characters';
import { getAvatars } from '../../realtime/client';
import styles from './ProfileSetupScreen.module.css';

const NICKNAME_MAX_LENGTH = 8; // 플레이어 카드 이름칸 폭 기준 실측(코딩왕지호=5자에 여유 3자)
const TILE_COUNT = 15; // 한 페이지에 보여줄 타일 수(5열 x 3행) — 캐릭터 30종을 좌우 화살표로 두 페이지에 나눠 봄
const PAGE_COUNT = Math.ceil(CHARACTERS.length / TILE_COUNT);
const AVATAR_POLL_MS = 3000; // 이 화면엔 소켓이 없어(프로필 확정 전) 선점 현황을 주기적으로 다시 불러 갱신함(API 기본 명세서 API-08)

type TileState = 'available' | 'taken' | 'mine';

type ProfileSetupScreenProps = {
  /** "◀ 뒤로가기" 클릭 시 호출 — 이전 화면(메인/방 만들기 등)으로 복귀하는 용도 */
  onBack?: () => void;
  /** "▶ 대기방 입장하기" 클릭 시 호출 — 닉네임·소개·고른 캐릭터를 실어 보내며, 실제 입장 처리는 이 화면 밖에서 담당 */
  onEnterRoom?: (profile: { nickname: string; intro: string; character: Character }) => void;
  /** 서버 방 코드(숫자 6자리) — 아바타 선점 현황 폴링에 씀 */
  roomCode: string;
  /** POST /rooms 또는 POST /members에서 받은 토큰 — 폴링 인증에 씀 */
  token: string;
};

// 캐릭터 고르기 & 프로필 설정 화면 — 닉네임·한 줄 소개를 입력하고 30종 중 캐릭터를 골라 대기방에 입장하는 화면(Figma 542:642)
export function ProfileSetupScreen({ onBack, onEnterRoom, roomCode, token }: ProfileSetupScreenProps) {
  const [nickname, setNickname] = useState('코딩왕지호');
  const [intro, setIntro] = useState('@jiho_dev · 프론트 담당');
  // 내가 고른 캐릭터의 인덱스(0~29, CHARACTERS 전체 기준) — 처음엔 0번이 기본값
  const [myIndex, setMyIndex] = useState(0);
  // 지금 보고 있는 타일 페이지(0~PAGE_COUNT-1) — 좌우 화살표로만 넘김
  const [page, setPage] = useState(0);
  // 서버가 확정한(=PATCH를 이미 마친) 아바타 선점 현황 — avatarId(1~30) -> 가져간 사람 닉네임
  const [takenBy, setTakenBy] = useState<Map<number, string>>(new Map());
  const nicknameId = useId();
  const introId = useId();

  // 3초마다 다시 불러 다른 사람이 그새 확정한 캐릭터를 반영 — 이 화면엔 소켓이 없어 실시간 푸시를 받을 방법이 없음
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getAvatars(roomCode, token);
        if (cancelled) return;
        const next = new Map<number, string>();
        for (const a of res.content) if (a.taken && a.takenBy) next.set(a.avatarId, a.takenBy);
        setTakenBy(next);
      } catch {
        // 일시적인 네트워크 오류는 다음 폴링에서 알아서 회복되므로 조용히 무시
      }
    };
    poll();
    const timer = setInterval(poll, AVATAR_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [roomCode, token]);

  // 폴링 결과 내가 고른 자리가 이미(또는 그새) 다른 사람 걸로 확정돼 있으면 첫 available 자리로 자동으로 옮겨줌 — 안 그러면 제출 시 무조건 AVATAR_TAKEN으로 튕김
  useEffect(() => {
    if (!takenBy.has(CHARACTERS[myIndex].id)) return;
    const nextAvailable = CHARACTERS.findIndex((c) => !takenBy.has(c.id));
    if (nextAvailable !== -1) setMyIndex(nextAvailable);
  }, [takenBy, myIndex]);

  // 캐릭터 30종 전체의 선점 상태 — 내가 고른 자리는 mine, 다른 사람이 이미 확정한(PATCH 완료) 자리는 taken
  const tileStates: TileState[] = CHARACTERS.map((c, index) => {
    if (index === myIndex) return 'mine';
    return takenBy.has(c.id) ? 'taken' : 'available';
  });
  // 현재 페이지에 보여줄 15칸만 잘라냄
  const pageCharacters = CHARACTERS.slice(page * TILE_COUNT, page * TILE_COUNT + TILE_COUNT);
  const pageTileStates = tileStates.slice(page * TILE_COUNT, page * TILE_COUNT + TILE_COUNT);
  const participantNo = takenBy.size + 1; // 이미 확정한 사람 수 + 이제 막 들어오는 나

  const handleNicknameChange = (e: ChangeEvent<HTMLInputElement>) => setNickname(e.target.value);
  const handleIntroChange = (e: ChangeEvent<HTMLInputElement>) => setIntro(e.target.value);

  // 다른 사람이 고르지 않은 available 타일 클릭 시 내 캐릭터로 교체 — 실제 선점 확정은 "대기방 입장하기"의 PATCH 성공 시점이라 그 전까진 로컬 선택일 뿐
  const handlePickTile = (index: number) => {
    if (tileStates[index] !== 'available') return;
    setMyIndex(index);
  };

  const handleRandomPick = () => {
    const availableIndexes = tileStates.reduce<number[]>((acc, s, i) => (s === 'available' ? [...acc, i] : acc), []);
    if (availableIndexes.length === 0) return;
    const pick = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    handlePickTile(pick);
    setPage(Math.floor(pick / TILE_COUNT)); // 다른 페이지에서 뽑혔으면 그 페이지로 같이 넘겨 보여줌
  };

  // 좌우 화살표 — 페이지 양 끝에서는 순환하지 않고 그대로 멈춤
  const handlePrevPage = () => setPage((p) => Math.max(0, p - 1));
  const handleNextPage = () => setPage((p) => Math.min(PAGE_COUNT - 1, p + 1));

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
              <span className={styles.playerCardTag}>P{participantNo}</span>
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
            <p className={styles.playerJoinBadge}>🎉 오늘의 {participantNo}번째 참가자!</p>
          </Card>

          <Button variant="hero" className={styles.enterButton} disabled={!canEnterRoom} onClick={handleEnterRoom}>
            ▶ 대기방 입장하기
          </Button>
          {takenBy.size > 0 && <div className={styles.footerPill}>🎉 팀원 {takenBy.size}명이 먼저 와서 기다리는 중!</div>}
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
                <p className={styles.avatarSectionDesc}>{CHARACTERS.length}종 중 하나 · 선택된 캐릭터는 잠겨요</p>
              </div>
              <Button variant="pink" className={styles.randomButton} onClick={handleRandomPick}>
                🎲 랜덤 뽑기
              </Button>
            </div>

            <div className={styles.tileNav}>
              <button
                type="button"
                className={styles.tileNavArrow}
                onClick={handlePrevPage}
                disabled={page === 0}
                aria-label="이전 캐릭터 페이지"
              >
                ◀
              </button>
              <span className={styles.tileNavPage}>
                {page + 1} / {PAGE_COUNT}
              </span>
              <button
                type="button"
                className={styles.tileNavArrow}
                onClick={handleNextPage}
                disabled={page === PAGE_COUNT - 1}
                aria-label="다음 캐릭터 페이지"
              >
                ▶
              </button>
            </div>

            <div className={styles.tileGrid}>
              {pageCharacters.map((character, i) => {
                const globalIndex = page * TILE_COUNT + i;
                return (
                  <CharacterTile
                    key={character.id}
                    character={character}
                    state={pageTileStates[i]}
                    pickedBy={takenBy.get(character.id)}
                    onClick={() => handlePickTile(globalIndex)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}
