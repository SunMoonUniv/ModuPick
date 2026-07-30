import { useState, type ChangeEvent, type CSSProperties } from 'react';
import { Avatar, Button, Card, Chip, ScreenFrame } from '../../components/common';
import { CHARACTERS } from '../../assets/avatars/characters';
import rouletteIcon from '../../assets/icons/roulette.png';
import ladderIcon from '../../assets/icons/ladder.png';
import crownIcon from '../../assets/icons/crown.png';
import hourglassIcon from '../../assets/icons/hourglass.png';
import targetIcon from '../../assets/icons/target.png';
import eyesIcon from '../../assets/icons/eyes.png';
import styles from './MainScreen.module.css';

const TICKER_TEXT =
  '설치도 로그인도 없이 !!          팀 역할 정하기를 게임처럼 !!           방을 만들고 !!           코드로 들어오면 바로 시작 !!!!!!!';

// 데모 룰렛에 등장하는 참가자 6명 — 실제 참가자 데이터가 아니라 랜딩 화면 미리보기 연출용 고정값
const DEMO_PARTICIPANTS = [
  { name: '지호', character: CHARACTERS[0], status: 'host' as const },
  { name: '서연', character: CHARACTERS[1], status: 'online' as const },
  { name: '민준', character: CHARACTERS[2], status: 'online' as const },
  { name: '하늘', character: CHARACTERS[3], status: 'online' as const },
  { name: '도윤', character: CHARACTERS[4], status: 'online' as const },
  { name: '유진', character: CHARACTERS[5], status: 'online' as const },
];

// 하단 슬라이더에 나열되는 6종 미니게임 — colorVar는 tokens.css의 게임별 컬러(--game-*) 이름
const GAMES = [
  {
    no: 1,
    title: '운명의 룰렛',
    subtitle: '돌려서 팀장 한 방에',
    colorVar: '--game-roulette',
    rotate: 2.5,
    icon: rouletteIcon,
  },
  {
    no: 2,
    title: '랜덤 사다리',
    subtitle: '역할을 한 번에 배분',
    colorVar: '--game-ladder',
    rotate: -1.5,
    icon: ladderIcon,
  },
  {
    no: 3,
    title: '킹메이커',
    subtitle: '익명 투표로 1인 선정',
    colorVar: '--game-kingmaker',
    rotate: 1.5,
    icon: crownIcon,
  },
  {
    no: 4,
    title: '시간초 잡기',
    subtitle: '목표 시간에 딱 멈추기',
    colorVar: '--game-timer',
    rotate: 2,
    icon: hourglassIcon,
  },
  {
    no: 5,
    title: '익명 저격',
    subtitle: '10초 안에 익명 지목',
    colorVar: '--game-sniper',
    rotate: -2.5,
    icon: targetIcon,
  },
  {
    no: 6,
    title: '눈치게임',
    subtitle: '동시에 누르면 탈락',
    colorVar: '--game-nunchi',
    rotate: -1,
    icon: eyesIcon,
  },
];

const JOIN_CODE_LENGTH = 5;

type MainScreenProps = {
  /** "새 방 만들기" 버튼 클릭 시 호출 — 방 만들기 화면으로 전환하는 용도 */
  onCreateRoom?: () => void;
  /** "참여" 클릭 시 5자리 코드와 함께 호출 — 코드가 실제 존재하는 방인지 확인하는 건 서버 몫이라 여기선 그대로 전달만 함 */
  onJoinRoom?: (code: string) => void;
};

// 메인 랜딩 화면 — 방 만들기/참여 진입점과 미니게임 소개를 보여주는 서비스 첫 화면(Figma 542:195)
export function MainScreen({ onCreateRoom, onJoinRoom }: MainScreenProps) {
  // 방 코드 입력값 — 서버가 없어 형식(5자)만 검사하고 실제 존재 여부는 확인하지 못함
  const [joinCode, setJoinCode] = useState('');
  const canJoin = joinCode.length === JOIN_CODE_LENGTH;

  const handleJoinCodeChange = (e: ChangeEvent<HTMLInputElement>) =>
    setJoinCode(e.target.value.toUpperCase().slice(0, JOIN_CODE_LENGTH));
  const handleJoin = () => {
    if (canJoin) onJoinRoom?.(joinCode);
  };

  return (
    <ScreenFrame>
      <div className={styles.topBar}>
          <span className={styles.logo}>◆ MODU-PICK</span>
          <div className={styles.ticker}>
            {/* 문구를 두 번 이어 붙여 마퀴가 끊김 없이 순환하도록 함 */}
            <div className={styles.tickerTrack}>
              <span>{TICKER_TEXT}</span>
              <span aria-hidden="true">{TICKER_TEXT}</span>
            </div>
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.hero}>
            <Chip color="pink" className={styles.heroChip}>
              ◆ 팀장·역할, 눈치싸움 없이
            </Chip>
            <h1 className={styles.headline}>
              <span className={`${styles.headlineLine} ${styles.headlineYellow}`} data-text="모두가">
                모두가
              </span>
              <span className={`${styles.headlineLine} ${styles.headlineName01}`} data-text="납득하는">
                납득하는
              </span>
              <span className={`${styles.headlineLine} ${styles.headlineWhite}`} data-text="유쾌한 픽">
                유쾌한 픽
              </span>
            </h1>

            <div className={styles.ctaRow}>
              <Button variant="hero" onClick={onCreateRoom}>
                ▶ 새 방 만들기
              </Button>
              <div className={styles.joinField}>
                <span>MODU-</span>
                <input
                  className={styles.joinInput}
                  placeholder="_ _ _ _ _"
                  maxLength={JOIN_CODE_LENGTH}
                  value={joinCode}
                  onChange={handleJoinCodeChange}
                />
                <Button variant="pink" disabled={!canJoin} onClick={handleJoin}>
                  참여
                </Button>
              </div>
            </div>

            <span className={styles.miniGameLabel}>▶ 6종 미니게임</span>
          </div>

          <Card className={styles.demoPanel}>
            <div className={styles.demoHeader}>
              <h2 className={styles.demoTitle}>◆ 운명의 룰렛</h2>
              <Chip color="pink">● 미리보기</Chip>
            </div>
            <div className={styles.demoDivider} />

            <div className={styles.demoContent}>
              <div className={styles.wheelScreen}>
                <Chip color="yellow" className={styles.timerChip}>
                  ◷ 돌리는 중 2초
                </Chip>
                <span className={styles.previewBubble}>누가 걸릴까?! 👀</span>

                <div className={styles.wheelStage}>
                  <div className={styles.wheelGlow} />
                  <div className={styles.wheelDisc} />
                  {DEMO_PARTICIPANTS.map((p, i) => (
                    <div key={p.name} className={styles.wheelAvatar} style={{ '--i': i } as CSSProperties}>
                      <Avatar src={p.character.image} alt={p.name} size={48} />
                      <span className={styles.wheelAvatarName}>{p.name}</span>
                    </div>
                  ))}
                  <div className={styles.wheelHub}>PICK!</div>
                  <div className={styles.wheelPointer} />
                </div>
              </div>

              <div className={styles.participants}>
                <div className={styles.participantsHead}>
                  <span>◆ 참가자 · {DEMO_PARTICIPANTS.length}명</span>
                </div>
                <div className={styles.participantList}>
                  {DEMO_PARTICIPANTS.map((p) => (
                    <Card key={p.name} className={styles.participantRow}>
                      <Avatar src={p.character.image} alt={p.name} size={40} />
                      <div className={styles.participantInfo}>
                        <span className={styles.participantName}>{p.name}</span>
                        {p.status === 'host' ? (
                          <span className={styles.participantStatusHost}>👑 방장 · 접속</span>
                        ) : (
                          <span className={styles.participantStatusOnline}>● 접속 중</span>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.demoFooter}>
              <Button variant="hero" className={styles.playButton}>
                ▶
              </Button>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill}>
                  <span className={styles.progressKnob} />
                </div>
              </div>
              <span className={styles.progressTime}>0:14 / 0:30</span>
            </div>
          </Card>
        </div>

        <div className={styles.railLine}>
          <span className={styles.railChevrons}>»»»</span>
        </div>
        <div className={styles.gameSlider}>
          {GAMES.map((game) => (
            <div
              key={game.no}
              className={styles.gameCard}
              style={{
                background: `var(${game.colorVar})`,
                transform: `rotate(${game.rotate}deg)`,
                zIndex: GAMES.length - game.no,
              }}
            >
              {/* 장식용 아이콘을 먼저 그려 배경에 깔고, 텍스트가 그 위에 올라오도록 함 */}
              <img className={styles.gameIcon} src={game.icon} alt="" />
              <span className={styles.gameCode}>GAME 0{game.no}</span>
              <div className={styles.gameNumber}>{game.no}</div>
              <p className={styles.gameTitle}>{game.title}</p>
              <p className={styles.gameSubtitle}>{game.subtitle}</p>
            </div>
          ))}
        </div>
    </ScreenFrame>
  );
}
