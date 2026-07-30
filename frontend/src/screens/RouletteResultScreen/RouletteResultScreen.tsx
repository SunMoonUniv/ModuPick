import type { CSSProperties } from 'react';
import { Button, Card, SafeBandChip, ScreenFrame } from '../../components/common';
import { CHARACTERS, type Character } from '../../assets/avatars/characters';
import crownIcon from '../../assets/icons/crown.png';
import styles from './RouletteResultScreen.module.css';

// CHARACTERS 목록에서 이름으로 캐릭터를 찾는 헬퍼 — 없으면 첫 번째 캐릭터로 대체(데모 데이터라 항상 존재함)
const char = (name: string) => CHARACTERS.find((c) => c.name === name) ?? CHARACTERS[0];

// 이번 라운드의 팀장 당첨자 기본값 — 이 화면을 단독으로 열었을 때(예: 컴포넌트 갤러리) 보여줄 데모 데이터
const DEFAULT_WINNER = { name: '코딩왕지호', character: char('corgi-space-captain') };

// 당첨되지 않은 나머지 5명 — Safe Band에 왼쪽부터 표시되는 순서 그대로(Figma 실측 순서)
const SAFE_PLAYERS = [
  { name: '하늘', character: char('rabbit-speedster') },
  { name: '서연', character: char('sloth-king') },
  { name: '민준', character: char('goat-punk') },
  { name: '도윤', character: char('red-panda-thief') },
  { name: '유진', character: char('naked-mole-rat') },
];

const TOTAL_PLAYERS = 6;

type ConfettiPiece = { left: number; top: number; rot: number; color: string };

// 화면 상단 여백에 흩뿌려진 색종이 조각 좌표 — Figma는 이 영역에만 개별 애셋 8개를 쓰지만
// 장식 목적이라 애셋을 내려받는 대신 실측 좌표·회전값·색상을 그대로 옮긴 CSS 사각형으로 재현
const CONFETTI_TOP: ConfettiPiece[] = [
  { left: 293, top: 17, rot: -31, color: 'var(--cyan)' },
  { left: 477, top: 113, rot: 6, color: 'var(--green)' },
  { left: 656, top: 120, rot: 43, color: 'var(--lavender)' },
  { left: 856, top: 124, rot: -10, color: 'var(--pink)' },
  { left: 1033, top: 110, rot: 27, color: 'var(--yellow)' },
  { left: 1229, top: 110, rot: -26, color: 'var(--cyan)' },
  { left: 1415, top: 124, rot: 11, color: 'var(--green)' },
  { left: 1836, top: 56, rot: -42, color: 'var(--lavender)' },
];

// 결과 카드 안, 우승자 아바타 좌우에 흩뿌려진 색종이 조각(카드 기준 좌표) — Figma는 원래 30개 안팎이지만
// 장식이라 화면이 무거워지지 않도록 좌우 6개씩 대표 좌표만 재현
const CONFETTI_CARD: ConfettiPiece[] = [
  { left: 12, top: 91, rot: 45, color: 'var(--pink)' },
  { left: 134, top: 113, rot: -8, color: 'var(--yellow)' },
  { left: 194, top: 107, rot: 29, color: 'var(--cyan)' },
  { left: 311, top: 93, rot: -24, color: 'var(--green)' },
  { left: 35, top: 198, rot: 13, color: 'var(--lavender)' },
  { left: 147, top: 176, rot: -40, color: 'var(--pink)' },
  { left: 860, top: 91, rot: 7, color: 'var(--yellow)' },
  { left: 954, top: 115, rot: 44, color: 'var(--cyan)' },
  { left: 1038, top: 105, rot: -9, color: 'var(--green)' },
  { left: 1136, top: 98, rot: 28, color: 'var(--lavender)' },
  { left: 877, top: 189, rot: -25, color: 'var(--pink)' },
  { left: 977, top: 190, rot: 12, color: 'var(--yellow)' },
];

// 색종이 조각 좌표 배열을 절대 배치된 <span> 목록으로 그려주는 장식 전용 레이어(클릭 불가)
function ConfettiLayer({ pieces, className }: { pieces: ConfettiPiece[]; className: string }) {
  return (
    <div className={className} aria-hidden="true">
      {pieces.map((c, i) => (
        <span
          key={i}
          className={styles.confettiPiece}
          style={
            { left: c.left, top: c.top, background: c.color, transform: `rotate(${c.rot}deg)` } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

type RouletteResultScreenProps = {
  /** 당첨자 이름 — 없으면 데모 당첨자("코딩왕지호")를 보여줌 */
  winnerName?: string;
  /** 당첨자 캐릭터 — 없으면 데모 당첨자의 캐릭터를 보여줌 */
  winnerCharacter?: Character;
  /** "↻ 다시 하기" 클릭 시 호출 — 룰렛을 다시 돌리는 흐름으로 이어주는 용도(방장 전용 조작) */
  onReplay?: () => void;
  /** "← 대기방으로" 클릭 시 호출 — 결과 화면에서 대기방으로 되돌아가는 용도(방장 전용 조작) */
  onBackToWaitingRoom?: () => void;
};

// 운명의 룰렛 당첨자 발표 화면 — 룰렛이 멈춘 직후 모든 참가자에게 뜨는 결과 화면(Figma 542:1119, "S-05b · 룰렛 결과")
// 실제로는 서버가 추첨 결과를 소켓으로 모든 참가자에게 동기화해야 하는데, 지금은 RouletteScreen이 클라이언트에서 뽑은 당첨자를 그대로 props로 받아 보여줌(임시)
export function RouletteResultScreen({
  winnerName = DEFAULT_WINNER.name,
  winnerCharacter = DEFAULT_WINNER.character,
  onReplay,
  onBackToWaitingRoom,
}: RouletteResultScreenProps) {
  const winChancePercent = `${(100 / TOTAL_PLAYERS).toFixed(1)}%`;
  return (
    <ScreenFrame>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>결과 발표</h1>
            <span className={styles.caption}>RESULT</span>
          </div>
          <p className={styles.subtitle}>● 운명의 룰렛 · 팀장 뽑기 · 방 MODU-427132</p>
        </div>
      </div>

      <ConfettiLayer pieces={CONFETTI_TOP} className={styles.confettiTop} />

      <div className={styles.body}>
        {/* ---- 좌측: 결과 카드 + 세이프 밴드 ---- */}
        <div className={styles.colMain}>
          <Card className={styles.resultCard}>
            <div className={styles.resultHeaderStrip}>🎉 WINNER 🎉</div>

            <ConfettiLayer pieces={CONFETTI_CARD} className={styles.confettiCard} />

            <div className={styles.winnerZone}>
              {/* 아바타 뒤에서 은은하게 번지는 후광 — RouletteScreen 룰렛판 후광(.wheelGlow)과 같은 펄스 트릭 재사용 */}
              <div className={styles.haloRing} />
              <div className={styles.winnerAvatarCircle} style={{ background: winnerCharacter.tint }}>
                <img className={styles.winnerAvatarImg} src={winnerCharacter.image} alt={winnerName} />
              </div>
              {/* 왕관이 아바타 원 위쪽에 살짝 겹치도록 절대 배치(Figma 실측) */}
              <img className={styles.crownIcon} src={crownIcon} alt="" />
            </div>

            <h2 className={styles.winnerName}>{winnerName}</h2>

            <span className={styles.winnerBadge}>🎡 운명의 룰렛 · 팀장 당첨!</span>

            <div className={styles.statsRow}>
              <div className={`${styles.statTile} ${styles.statCyan}`}>
                <span className={styles.statValue}>{TOTAL_PLAYERS}명</span>
                <span className={styles.statLabel}>함께한 사람</span>
              </div>
              <div className={`${styles.statTile} ${styles.statPink}`}>
                <span className={styles.statValue}>{winChancePercent}</span>
                <span className={styles.statLabel}>당첨 확률</span>
              </div>
            </div>

            <p className={styles.cardFooterCaption}>modupick · 방 MODU-4271</p>
          </Card>

          <Card className={styles.safeBand}>
            <p className={styles.safeBandTitle}>😅 휴~ 비껴간 {SAFE_PLAYERS.length}명</p>
            <div className={styles.safeBandRow}>
              {SAFE_PLAYERS.map((p) => (
                <SafeBandChip
                  key={p.name}
                  name={p.name}
                  avatarSrc={p.character.image}
                  className={styles.safeBandItem}
                />
              ))}
            </div>
          </Card>
        </div>

        {/* ---- 우측: 방장 전용 공유/진행 액션 패널 ---- */}
        <Card className={styles.shareActions}>
          <p className={styles.shareLabel}>다음은? · 방장만 조작</p>
          <Button variant="accent" className={styles.shareBtnPrimary} onClick={onReplay}>
            ↻ 다시 하기
          </Button>
          <div className={styles.shareDivider} />
          <Button variant="secondary" className={styles.shareBtnSecondary} onClick={onBackToWaitingRoom}>
            ← 대기방으로
          </Button>
        </Card>
      </div>
    </ScreenFrame>
  );
}
