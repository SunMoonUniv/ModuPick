import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Avatar, Chip, ScreenFrame } from '../../components/common';
import { CHARACTERS } from '../../assets/avatars/characters';
import styles from './RouletteScreen.module.css';

// CHARACTERS 목록에서 이름으로 캐릭터를 찾는 헬퍼 — 없으면 첫 번째 캐릭터로 대체(데모 데이터라 항상 존재함)
const char = (name: string) => CHARACTERS.find((c) => c.name === name) ?? CHARACTERS[0];

// 좌측 "팀 멤버" 목록에 뜨는 순서 그대로의 참가자 6명(Figma "PL·이름" 노드 6종 그대로)
const PLAYERS = [
  { name: '지호', isHost: true, character: char('corgi-space-captain') },
  { name: '서연', isHost: false, character: char('sloth-king') },
  { name: '민준', isHost: false, character: char('goat-punk') },
  { name: '하늘', isHost: false, character: char('rabbit-speedster') },
  { name: '도윤', isHost: false, character: char('red-panda-thief') },
  { name: '유진', isHost: false, character: char('naked-mole-rat') },
];

// 룰렛판 12시 방향부터 시계방향으로 도는 자리 순서 — PLAYERS 배열 인덱스를 가리킴(좌측 목록 순서와는 다름, Figma 실측 좌표로 계산)
// 이 순서가 .wheelDisc의 conic-gradient 6색 배치 순서와 반드시 짝을 이뤄야 함(둘 다 아래에서 정의)
const WHEEL_SEATS = [4, 5, 0, 1, 2, 3];

// 룰렛판을 감싸는 점 장식 20개 — 홀/짝으로 흰색·노란색을 번갈아 배치
const DOT_COUNT = 20;

// 카운트다운 시작 초 — 이 값이 0이 되는 순간 당첨자를 뽑고 onSpinComplete를 호출함
const COUNTDOWN_START = 3;

type RouletteScreenProps = {
  /** 카운트다운이 끝나고 당첨자가 정해지면 호출 — 실제로는 서버가 모든 참가자에게 같은 당첨자를 브로드캐스트해야 하는데,
   * 지금은 서버가 없어 이 화면(클라이언트)에서 무작위로 뽑아 전달함(임시) */
  onSpinComplete?: (winner: (typeof PLAYERS)[number]) => void;
};

// 운명의 룰렛 실시간 진행 화면 — 방장이 "운명의 룰렛"을 시작하면 뜨는 팀장 뽑기용 회전 연출 화면(Figma 542:1289, "S-05 · 룰렛")
export function RouletteScreen({ onSpinComplete }: RouletteScreenProps) {
  const [count, setCount] = useState(COUNTDOWN_START);
  // 0에 도달했을 때 onSpinComplete가 정확히 한 번만 불리도록 막는 가드(리렌더로 콜백 참조가 바뀌어도 중복 호출 안 됨)
  const hasFiredRef = useRef(false);

  // 1초마다 카운트다운 감소, 0에 도달하면 당첨자를 무작위로 뽑아 알림
  useEffect(() => {
    if (count > 0) {
      const timer = setTimeout(() => setCount((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (!hasFiredRef.current) {
      hasFiredRef.current = true;
      const winner = PLAYERS[Math.floor(Math.random() * PLAYERS.length)];
      onSpinComplete?.(winner);
    }
  }, [count, onSpinComplete]);

  return (
    <ScreenFrame>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>운명의 룰렛</h1>
            <span className={styles.caption}>WHEEL OF FATE</span>
            <button type="button" className={styles.helpBtn} aria-label="게임 가이드 보기">
              ?
            </button>
          </div>
          <p className={styles.subtitle}>● 실시간 진행 · 방 MODU-427132</p>
        </div>

        <div className={styles.headerBadges}>
          <Chip color="green">◉ 6명 실시간 접속</Chip>
          {/* Figma 실측 폰트가 이 칩만 Black Han Sans라 className으로 로컬 오버라이드 */}
          <Chip color="white" className={styles.leaderChip}>
            팀장 뽑기
          </Chip>
        </div>
      </div>

      <div className={styles.body}>
        {/* ---- 좌측: 팀 멤버 목록 ---- */}
        <div className={styles.colPlayers}>
          <p className={styles.sectionLabel}>◆ 팀 멤버 · {PLAYERS.length}명</p>
          <div className={styles.playerList}>
            {PLAYERS.map((p) => (
              <div key={p.name} className={styles.playerCard}>
                <div className={styles.playerAvatar} style={{ background: p.character.tint }}>
                  <img className={styles.playerAvatarImg} src={p.character.image} alt={p.name} />
                </div>
                <div className={styles.playerText}>
                  <p className={styles.playerName}>{p.name}</p>
                  {/* 방장 여부를 별도 뱃지가 아니라 상태 문구 안에 왕관 이모지로 녹여 넣음(Figma 텍스트 원문 그대로) */}
                  <p className={styles.playerStatus}>{p.isHost ? '👑 방장 · 접속' : '● 접속 중'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- 중앙: 룰렛판 ---- */}
        <div className={styles.wheelWrap}>
          <div className={styles.wheelStage}>
            <span className={styles.wheelBubble}>누가 걸릴까?! 👀</span>

            <div className={styles.wheelGlow} />

            {/* 점 장식 링 — 실제 판이 아니라 장식용이라 클릭 불가, CSS 회전 트릭으로 원형 배치 */}
            {Array.from({ length: DOT_COUNT }).map((_, i) => (
              <span key={i} className={styles.wheelDot} style={{ '--i': i } as CSSProperties} />
            ))}

            {/* 색 배정만 도는 판 — 아바타는 고정해 이름표가 계속 읽히게 하고, 배경 조각색만 빙글빙글 돌려 회전감을 냄 */}
            <div className={styles.wheelDisc} />

            {WHEEL_SEATS.map((playerIndex, i) => {
              const p = PLAYERS[playerIndex];
              return (
                <div key={p.name} className={styles.wheelAvatar} style={{ '--i': i } as CSSProperties}>
                  <Avatar src={p.character.image} alt={p.name} size={64} />
                  <span className={styles.wheelAvatarName}>{p.name}</span>
                </div>
              );
            })}

            <div className={styles.wheelHub}>PICK!</div>
          </div>
        </div>
      </div>

      <div className={styles.statusBand}>
        <div className={styles.statusInfo}>
          <span className={styles.countdownBadge}>{Math.max(count, 0)}</span>
          <div>
            <p className={styles.statusTitle}>{count > 0 ? '돌리는 중…' : '팀장 공개!'}</p>
            <p className={styles.statusSub}>
              {count > 0 ? `6명 화면에서 동시에 회전 중 · ${count}초 후 팀장 공개` : '결과 화면으로 이동할게요'}
            </p>
          </div>
        </div>
        <Chip color="yellow" className={styles.notePill}>
          ★ 결과는 아무도 못 바꿔요 · 모두 똑같이
        </Chip>
      </div>
    </ScreenFrame>
  );
}
