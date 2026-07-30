import { useState, type CSSProperties } from 'react';
import {
  Button,
  ChatPanel,
  Chip,
  EmptyRow,
  GameSettingsPanel,
  PlayerRow,
  ScreenFrame,
  type ChatMessage,
  type GameSettingsPanelGame,
  type PlayerRowStatus,
} from '../../components/common';
import { CHARACTERS, type Character } from '../../assets/avatars/characters';
import crownIcon from '../../assets/icons/crown.png';
import rouletteIcon from '../../assets/icons/roulette.png';
import ladderIcon from '../../assets/icons/ladder.png';
import bombIcon from '../../assets/icons/bomb.png';
import targetIcon from '../../assets/icons/target.png';
import eyesIcon from '../../assets/icons/eyes.png';
import controllerIcon from '../../assets/icons/controller.png';
import diceIcon from '../../assets/icons/dice.png';
import playButtonIcon from '../../assets/icons/play-button.png';
import hourglassIcon from '../../assets/icons/hourglass.png';
import styles from './WaitingRoomScreen.module.css';

// CHARACTERS 목록에서 이름으로 캐릭터를 찾는 헬퍼 — 없으면 첫 번째 캐릭터로 대체(데모 데이터라 항상 존재함)
const char = (name: string) => CHARACTERS.find((c) => c.name === name) ?? CHARACTERS[0];

const DEFAULT_MAX_PLAYERS = 8;

// 현재 화면을 보는 사람이 방장인지 참여자인지 — 게임 선택 가능 여부·상태 밴드 버튼·본인 표시가 이 값 하나로 갈림
type WaitingRoomRole = 'host' | 'participant';

type Player = {
  id: string;
  name: string;
  subtitle: string;
  status: PlayerRowStatus;
  avatarSrc: string;
  avatarTint: string;
};

// 이 방의 참가자 6명 — 방장 1명 + READY 3명 + 준비 중 2명(Figma "P·이름" 노드 6종 그대로)
const PLAYERS: Player[] = [
  {
    id: 'jiho',
    name: '코딩왕지호',
    subtitle: '@jiho_dev · frontend · 방장',
    status: 'host',
    avatarSrc: char('corgi-space-captain').image,
    avatarTint: char('corgi-space-captain').tint,
  },
  {
    id: 'seoyeon',
    name: '서연',
    subtitle: 'frontend · react',
    status: 'ready',
    avatarSrc: char('sloth-king').image,
    avatarTint: char('sloth-king').tint,
  },
  {
    id: 'minjun',
    name: '민준',
    subtitle: '@minjun_dev',
    status: 'ready',
    avatarSrc: char('goat-punk').image,
    avatarTint: char('goat-punk').tint,
  },
  {
    id: 'haneul',
    name: '하늘',
    subtitle: 'backend · fastapi 자바의 신',
    status: 'ready',
    avatarSrc: char('rabbit-speedster').image,
    avatarTint: char('rabbit-speedster').tint,
  },
  {
    id: 'doyoon',
    name: '도윤',
    subtitle: 'design · figma',
    status: 'pending',
    avatarSrc: char('red-panda-thief').image,
    avatarTint: char('red-panda-thief').tint,
  },
  {
    id: 'yujin',
    name: '유진',
    subtitle: '@yujin · qa',
    status: 'pending',
    avatarSrc: char('naked-mole-rat').image,
    avatarTint: char('naked-mole-rat').tint,
  },
];

// 참여자 시점(role === 'participant')일 때 "나"로 표시할 행 — 방장 시점에서는 쓰이지 않음
const ME_PLAYER_ID = 'doyoon';

// 대기방 채팅 초기 로그 — 실제 전송/수신은 없고 화면 진입 시점의 스냅샷으로만 존재함
const INITIAL_MESSAGES: ChatMessage[] = [
  { id: 'm1', kind: 'other', author: '서연', avatarSrc: char('sloth-king').image, avatarTint: char('sloth-king').tint, text: '다들 밥은 드셨어?', time: '2:12' },
  { id: 'm2', kind: 'self', text: '룰렛부터 ㄱㄱ', time: '2:12' },
  { id: 'm3', kind: 'other', author: '하늘', avatarSrc: char('rabbit-speedster').image, avatarTint: char('rabbit-speedster').tint, text: '저 발표는 좀 자신없어요 😅', time: '2:13' },
  { id: 'm4', kind: 'self', text: '사다리도 있으니 ㄱㅊ', time: '2:14' },
  { id: 'm5', kind: 'other', author: '민준', avatarSrc: char('goat-punk').image, avatarTint: char('goat-punk').tint, text: 'ㅋㅋ 시간초 잡기 함?', time: '2:14' },
  { id: 'm6', kind: 'system', text: '유진님이 대기방에 입장했어요' },
  { id: 'm7', kind: 'other', author: '서연', avatarSrc: char('sloth-king').image, avatarTint: char('sloth-king').tint, text: '빨리 고고~ 준비 완료!', time: '2:16' },
  { id: 'm8', kind: 'system', text: "🎮 방장이 '운명의 룰렛'을 골랐어요" },
];

type GameOption = {
  id: GameSettingsPanelGame;
  name: string;
  desc: string;
  icon: string;
  tint: string; // 아이콘 배경·선택 카드 강조색 — tokens.css의 게임별 컬러 pill(--game-*) 재사용
  minPlayers?: number; // 있으면 카드에 "N명 이상" 조건 칩이 붙고 인원 미달 시 잠김
};

// 우측 "게임 선택" 그리드 6종 — 2열×3행, Figma 배치 순서(룰렛·사다리 / 킹메이커·시간초 / 저격·눈치) 그대로
const GAMES: GameOption[] = [
  { id: 'roulette', name: '운명의 룰렛', desc: '팀장·발표자 랜덤', icon: rouletteIcon, tint: 'var(--game-roulette)' },
  { id: 'ladder', name: '랜덤 사다리', desc: '역할 한 번에 배분', icon: ladderIcon, tint: 'var(--game-ladder)' },
  { id: 'kingmaker', name: '킹메이커', desc: '익명 투표로 선정', icon: crownIcon, tint: 'var(--game-kingmaker)', minPlayers: 3 },
  { id: 'timer', name: '시간초 잡기', desc: '폭탄 돌리기 서바이벌', icon: bombIcon, tint: 'var(--game-timer)' },
  { id: 'sniper', name: '익명 저격', desc: '익명 지목 투표', icon: targetIcon, tint: 'var(--game-sniper)', minPlayers: 3 },
  { id: 'nunchi', name: '눈치게임', desc: 'UP! 최후의 1인', icon: eyesIcon, tint: 'var(--game-nunchi)', minPlayers: 3 },
];

type WaitingRoomScreenProps = {
  /** 'host'면 게임 선택·강퇴·게임 시작이 가능하고, 'participant'면 구경 + 준비 완료만 가능함 */
  role: WaitingRoomRole;
  /** 방 이름 — 없으면 데모용 고정 방 이름을 보여줌 */
  roomName?: string;
  /** 방 코드(MODU-###### 형식) — 없으면 데모용 고정 코드를 보여줌 */
  roomCode?: string;
  /** 방 만들기에서 정한 최대 인원 — 없으면 데모 기본값(8명) */
  maxPlayers?: number;
  /** 나(현재 화면을 보는 사람)의 닉네임 — 있으면 참가자 목록의 내 자리 이름을 덮어씀 */
  myNickname?: string;
  /** 나의 캐릭터 — 있으면 참가자 목록의 내 자리 아바타를 덮어씀 */
  myCharacter?: Character;
  /** "나가기" 클릭 시 호출 — 방을 나가 이전 화면으로 돌아가는 처리는 이 화면 밖에서 담당 */
  onExit?: () => void;
  /** (host 전용) "게임 시작" 클릭 시 호출 */
  onStartGame?: () => void;
  /** (host 전용) 참가자 행의 강퇴(X) 버튼 클릭 시 호출 — 목록에서는 즉시 제거하고, 실제 강퇴 통보는 이 화면 밖(서버)에서 담당 */
  onKickPlayer?: (playerId: string) => void;
  /** (participant 전용) "준비 완료" 토글 클릭 시 호출 — 다음 준비 상태(true=완료)를 인자로 넘겨줌 */
  onToggleReady?: (ready: boolean) => void;
};

// 실시간 대기방 화면 — 참가자 무대·채팅·게임 선택을 한 화면에서 보여주며, role prop으로 방장/참여자 두 시점을 모두 렌더링함(Figma 542:422, 542:2783)
export function WaitingRoomScreen({
  role,
  roomName = '4조 · 알고리즘 스터디',
  roomCode = 'MODU-427132',
  maxPlayers = DEFAULT_MAX_PLAYERS,
  myNickname,
  myCharacter,
  onExit,
  onStartGame,
  onKickPlayer,
  onToggleReady,
}: WaitingRoomScreenProps) {
  const isHost = role === 'host';

  // 참가자 목록 — 강퇴가 실제로 화면에서 빠지는 걸 보여줘야 해서 상수가 아니라 상태로 관리함
  // 내 자리(host면 status:'host', participant면 ME_PLAYER_ID)는 프로필 설정에서 고른 닉네임·캐릭터로 치환
  const [players, setPlayers] = useState<Player[]>(() =>
    PLAYERS.map((p) => {
      const isSelf = isHost ? p.status === 'host' : p.id === ME_PLAYER_ID;
      if (!isSelf || !myNickname) return p;
      return { ...p, name: myNickname, avatarSrc: myCharacter?.image ?? p.avatarSrc, avatarTint: myCharacter?.tint ?? p.avatarTint };
    }),
  );

  // 방장이 고른 게임 — host 시점에서만 카드 클릭으로 바뀌고, participant 시점에서는 방장이 고른 값을 그대로 구경만 함
  const [selectedGame, setSelectedGame] = useState<GameSettingsPanelGame>('roulette');
  // 하단 "준비 완료" 버튼의 눌림 상태 — participant 전용, 백엔드 연동 전이라 로컬 토글로만 표시
  const [ready, setReady] = useState(true);

  const totalPlayers = players.length;
  const readyCount = players.filter((p) => p.status === 'host' || p.status === 'ready').length;
  const emptySeats = maxPlayers - totalPlayers;
  const selectedGameOption = GAMES.find((g) => g.id === selectedGame) ?? GAMES[0];

  // 강퇴 — 실제로는 서버가 대상에게 통보하고 모든 클라이언트 목록을 동기화해야 함, 지금은 내 화면에서만 즉시 제거(임시)
  const handleKickPlayer = (playerId: string) => {
    setPlayers((prev) => prev.filter((p) => p.id !== playerId));
    onKickPlayer?.(playerId);
  };

  // 랜덤 게임 — 인원 미달로 잠긴 게임은 제외하고 무작위로 하나 고름
  const handleRerollGame = () => {
    const pickable = GAMES.filter((g) => g.minPlayers == null || totalPlayers >= g.minPlayers);
    if (pickable.length === 0) return;
    setSelectedGame(pickable[Math.floor(Math.random() * pickable.length)].id);
  };

  const typingIndicator = {
    user: '도윤',
    avatarSrc: char('red-panda-thief').image,
    avatarTint: char('red-panda-thief').tint,
  };

  const handleToggleReady = () => {
    const next = !ready;
    setReady(next);
    onToggleReady?.(next);
  };

  return (
    <ScreenFrame>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{roomName}</h1>
          <p className={styles.subtitle}>● 실시간 대기방</p>
        </div>
        <div className={styles.headerPills}>
          <img className={styles.headerCrown} src={crownIcon} alt="" />
          <span className={styles.codePill}>◈ {roomCode}</span>
          <span className={styles.countPill}>
            {totalPlayers}/{maxPlayers}명 · READY {readyCount}
          </span>
        </div>
      </div>

      <div className={styles.body}>
        {/* ---- 좌측: 참가자 무대 ---- */}
        <div className={styles.colPlayers}>
          <p className={styles.sectionLabel}>
            ◆ PLAYERS · 참가자 무대 ({totalPlayers}/{maxPlayers})
          </p>
          <div className={styles.playerList}>
            {players.map((p) => (
              <PlayerRow
                key={p.id}
                name={p.name}
                subtitle={p.subtitle}
                status={p.status}
                avatarSrc={p.avatarSrc}
                avatarTint={p.avatarTint}
                isMe={!isHost && p.id === ME_PLAYER_ID}
                onKick={isHost && p.status !== 'host' ? () => handleKickPlayer(p.id) : undefined}
              />
            ))}
            {emptySeats > 0 && <EmptyRow>{`? · 빈 자리 ${emptySeats} · 초대 링크로 참여 대기`}</EmptyRow>}
          </div>
        </div>

        {/* ---- 가운데: 채팅 ---- */}
        <ChatPanel messages={INITIAL_MESSAGES} typing={typingIndicator} />

        {/* ---- 우측: 게임 선택(host는 조작 가능, participant는 구경만) + 설정 ---- */}
        <div className={styles.colGame}>
          <div className={styles.gameHeader}>
            <div>
              <h2 className={styles.gameTitle}>◆ 게임 선택</h2>
              <p className={styles.gameSubtitle}>
                {isHost
                  ? '방장만 선택 · 고르면 아래에서 바로 설정 · 3명 이상 게임은 인원 미달 시 잠김'
                  : '방장이 고르는 중 · 참여자는 선택 불가 · 3명 이상 게임은 인원 미달 시 잠김'}
              </p>
            </div>
            {/* participant 시점에서만 "카드가 클릭되지 않는다"는 잠금 안내 칩을 보여줌 */}
            {!isHost && (
              <Chip color="yellow" className={styles.lockChip}>
                방장만 변경 가능
              </Chip>
            )}
          </div>

          <div className={styles.gameGrid}>
            {GAMES.map((g) => {
              const locked = g.minPlayers != null && totalPlayers < g.minPlayers;
              const selected = g.id === selectedGame;

              if (!isHost) {
                // participant는 게임을 고를 수 없어 button이 아닌 div로 렌더링 — 선택되지 않은 카드는 모두 흐리게 표시해 방장의 선택만 도드라지게 함
                return (
                  <div
                    key={g.id}
                    className={[styles.gameCard, selected ? styles.gameCardSelected : styles.gameCardDimmed].join(' ')}
                    style={selected ? ({ background: g.tint, borderColor: g.tint } as CSSProperties) : undefined}
                  >
                    <span className={styles.gameIcon} style={{ background: g.tint }}>
                      <img src={g.icon} alt="" />
                    </span>
                    <span className={styles.gameText}>
                      <span className={styles.gameName}>{g.name}</span>
                      <span className={styles.gameDesc}>{g.desc}</span>
                    </span>
                    {g.minPlayers != null && !selected && (
                      <Chip color="yellow" className={styles.gameConditionChip}>
                        {g.minPlayers}명 이상
                      </Chip>
                    )}
                    {selected && <span className={styles.gameCheck}>✓</span>}
                  </div>
                );
              }

              return (
                <button
                  key={g.id}
                  type="button"
                  className={[styles.gameCard, selected ? styles.gameCardSelected : '', locked ? styles.gameCardLocked : '']
                    .filter(Boolean)
                    .join(' ')}
                  style={selected ? ({ background: g.tint, borderColor: g.tint } as CSSProperties) : undefined}
                  disabled={locked}
                  onClick={() => setSelectedGame(g.id)}
                >
                  <span className={styles.gameIcon} style={{ background: g.tint }}>
                    <img src={g.icon} alt="" />
                  </span>
                  <span className={styles.gameText}>
                    <span className={styles.gameName}>{g.name}</span>
                    <span className={styles.gameDesc}>{g.desc}</span>
                  </span>
                  {g.minPlayers != null && !selected && (
                    <Chip color="yellow" className={styles.gameConditionChip}>
                      {g.minPlayers}명 이상
                    </Chip>
                  )}
                  {selected && <span className={styles.gameCheck}>✓</span>}
                </button>
              );
            })}
          </div>

          {/* participant는 readOnly로 넘겨 자물쇠 표기 + 칩/입력 클릭 차단 */}
          <GameSettingsPanel game={selectedGame} readOnly={!isHost} className={styles.settingsPanel} />
        </div>
      </div>

      <div className={styles.statusBand}>
        <div className={styles.statusInfo}>
          <span className={styles.statusIcon}>
            <img src={isHost ? controllerIcon : hourglassIcon} alt="" />
          </span>
          <div>
            {isHost ? (
              <p className={styles.statusTitle}>◷ {selectedGameOption.name} 준비 완료!</p>
            ) : (
              <p className={styles.statusTitle}>◷ 방장이 시작하기를 기다리는 중</p>
            )}
            <p className={styles.statusSub}>
              {isHost
                ? `2명 이상이면 시작할 수 있어요 · 현재 ${totalPlayers}명 · READY ${readyCount}/${totalPlayers}`
                : `준비 완료를 누르면 방장 화면에 READY로 표시돼요 · 현재 ${totalPlayers}명 · READY ${readyCount}/${totalPlayers}`}
            </p>
          </div>
        </div>
        <div className={styles.statusActions}>
          {isHost ? (
            <>
              <Button variant="secondary" className={styles.rerollButton} onClick={handleRerollGame}>
                <img className={styles.btnIcon} src={diceIcon} alt="" />
                랜덤 게임
              </Button>
              <Button variant="secondary" className={styles.exitButton} onClick={onExit}>
                ← 나가기
              </Button>
              <Button variant="hero" className={styles.startButton} onClick={onStartGame}>
                <img className={styles.btnIcon} src={playButtonIcon} alt="" />
                게임 시작
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" className={styles.exitButton} onClick={onExit}>
                ← 나가기
              </Button>
              {/* 눌린 상태(ready)일 땐 hero 배리언트(잉크 배경)로 강조, 아직 안 눌렀으면 secondary(흰 배경)로 약하게 표시 */}
              <Button variant={ready ? 'hero' : 'secondary'} className={styles.readyButton} onClick={handleToggleReady}>
                ✓ 준비 완료
              </Button>
            </>
          )}
        </div>
      </div>
    </ScreenFrame>
  );
}
