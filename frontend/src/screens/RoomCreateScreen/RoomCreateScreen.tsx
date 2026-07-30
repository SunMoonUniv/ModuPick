import { useId, useState, type ChangeEvent, type CSSProperties } from 'react';
import { Button, Card, Input, ScreenFrame } from '../../components/common';
import styles from './RoomCreateScreen.module.css';

const NAME_MAX_LENGTH = 30;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
// 스테퍼·슬라이더와 함께 값이 동기화되는 인원수 빠른 선택 프리셋
const PLAYER_PRESETS = [2, 4, 6, 8, 10];

// 대기방 미리보기에 표시되는 3단계 진행 안내
const PREVIEW_STEPS = [
  { title: '방 코드를 친구에게 공유', desc: 'MODU-______ 형식의 코드가 바로 발급돼요' },
  { title: '코드만 입력하면 바로 입장', desc: '설치도 로그인도 필요 없어요' },
  { title: '대기방에서 게임 고르고 시작', desc: '팀장 · 역할 · 팀명까지 한 화면에서' },
];

type RoomCreateScreenProps = {
  /** "◀ 뒤로가기" 클릭 시 호출 — 메인 화면으로 복귀하는 용도 */
  onBack?: () => void;
  /** "방 만들기" 클릭 시 호출 — 방 이름이 비어 있으면 버튼 자체가 비활성화되어 호출되지 않음 */
  onCreateRoom?: (data: { name: string; maxPlayers: number }) => void;
};

// 새 방 만들기 화면 — 메인 화면의 "새 방 만들기" 버튼을 누르면 표시되며, 방 이름·최대 인원을 입력하고 방을 생성함(Figma 542:1922)
export function RoomCreateScreen({ onBack, onCreateRoom }: RoomCreateScreenProps) {
  const [roomName, setRoomName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(8);
  const sliderId = useId();

  const trimmedName = roomName.trim();
  const canCreate = trimmedName.length > 0;
  const sliderFillPercent = ((maxPlayers - MIN_PLAYERS) / (MAX_PLAYERS - MIN_PLAYERS)) * 100;

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => setRoomName(e.target.value);
  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => setMaxPlayers(Number(e.target.value));
  const decreasePlayers = () => setMaxPlayers((n) => Math.max(MIN_PLAYERS, n - 1));
  const increasePlayers = () => setMaxPlayers((n) => Math.min(MAX_PLAYERS, n + 1));
  const handleCreateClick = () => {
    if (!canCreate) return;
    onCreateRoom?.({ name: trimmedName, maxPlayers });
  };

  return (
    <ScreenFrame>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>새 방 만들기</h1>
          <p className={styles.subtitle}>● 방 정보를 입력하고 친구들을 초대하세요</p>
        </div>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ◀ 뒤로가기
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.colLeft}>
          <div className={styles.cardsGroup}>
            <Card className={styles.roomNameCard}>
              <p className={styles.cardTitle}>🏷️ 방 이름</p>
              <p className={styles.cardDesc}>최대 {NAME_MAX_LENGTH}글자까지 입력할 수 있어요</p>
              <Input
                className={styles.nameInput}
                value={roomName}
                onChange={handleNameChange}
                maxLength={NAME_MAX_LENGTH}
                placeholder="예: 4조 · 알고리즘 스터디"
              />
            </Card>

            <Card className={styles.playersCard}>
              <p className={styles.cardTitle}>👥 최대 인원</p>
              <p className={styles.cardDesc}>
                최소 {MIN_PLAYERS}명 ~ 최대 {MAX_PLAYERS}명까지 설정할 수 있어요
              </p>

              <div className={styles.stepperRow}>
                <button
                  type="button"
                  className={styles.stepBtnMinus}
                  onClick={decreasePlayers}
                  disabled={maxPlayers <= MIN_PLAYERS}
                  aria-label="최대 인원 줄이기"
                >
                  −
                </button>
                <div className={styles.numBox}>
                  <span className={styles.numBoxValue}>{maxPlayers}</span>
                  <span className={styles.numBoxUnit}>명</span>
                </div>
                <button
                  type="button"
                  className={styles.stepBtnPlus}
                  onClick={increasePlayers}
                  disabled={maxPlayers >= MAX_PLAYERS}
                  aria-label="최대 인원 늘리기"
                >
                  +
                </button>

                <div className={styles.stepperDivider} />

                <div className={styles.presetGroup}>
                  <span className={styles.presetLabel}>빠른 선택</span>
                  <div className={styles.presetChips}>
                    {PLAYER_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`${styles.presetChip} ${preset === maxPlayers ? styles.presetChipActive : ''}`}
                        onClick={() => setMaxPlayers(preset)}
                      >
                        {preset}명
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.sliderRow}>
                <label htmlFor={sliderId} className={styles.srOnly}>
                  최대 인원 슬라이더
                </label>
                <input
                  id={sliderId}
                  type="range"
                  className={styles.slider}
                  style={{ '--fill-percent': `${sliderFillPercent}%` } as CSSProperties}
                  min={MIN_PLAYERS}
                  max={MAX_PLAYERS}
                  value={maxPlayers}
                  onChange={handleSliderChange}
                />
                <div className={styles.sliderScale}>
                  <span>{MIN_PLAYERS}</span>
                  <span>{MAX_PLAYERS}</span>
                </div>
              </div>
            </Card>
          </div>

          <div className={styles.hintBar}>
            <span>🔒 방 코드를 받은 사람만 입장할 수 있어요</span>
          </div>
        </div>

        <div className={styles.colRight}>
          <Card className={styles.previewCard}>
            <p className={styles.cardTitle}>◆ 미리보기</p>
            <p className={styles.cardDesc}>입력한 정보가 대기방에 이렇게 보여요</p>

            <div className={styles.previewField}>
              <span className={styles.previewLabel}>방 이름</span>
              <span className={`${styles.previewValue} ${trimmedName ? '' : styles.previewPlaceholder}`}>
                {trimmedName || '방 이름을 입력해주세요'}
              </span>
            </div>
            <div className={styles.previewField}>
              <span className={styles.previewLabel}>최대 인원</span>
              <span className={styles.previewValueSmall}>{maxPlayers}명</span>
            </div>
            <div className={styles.previewField}>
              <span className={styles.previewLabel}>방 코드</span>
              <span className={styles.previewValueSmall}>생성 시 MODU-**** 자동 발급</span>
            </div>
          </Card>

          <Card className={styles.stepsCard}>
            <p className={styles.cardTitle}>◆ 이렇게 진행돼요</p>
            {PREVIEW_STEPS.map((step, i) => (
              <div key={step.title} className={styles.stepRow}>
                <span className={styles.stepBadge}>{i + 1}</span>
                <div className={styles.stepText}>
                  <p className={styles.stepTitle}>{step.title}</p>
                  <p className={styles.stepDesc}>{step.desc}</p>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div className={styles.statusBand}>
        <div className={styles.statusInfo}>
          <span className={styles.statusIcon}>🚪</span>
          <div>
            <p className={styles.statusTitle}>
              {trimmedName ? `${trimmedName} · 최대 ${maxPlayers}명` : `방 이름을 입력해주세요 · 최대 ${maxPlayers}명`}
            </p>
            <p className={styles.statusSub}>방을 만들면 방 코드가 바로 발급돼요 · 친구에게 공유하세요</p>
          </div>
        </div>
        <Button variant="hero" className={styles.createButton} disabled={!canCreate} onClick={handleCreateClick}>
          🚪 방 만들기
        </Button>
      </div>
    </ScreenFrame>
  );
}
