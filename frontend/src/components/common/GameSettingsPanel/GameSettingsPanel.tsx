import { useState, type ChangeEvent } from 'react';
import { Card } from '../Card/Card';
import { Input } from '../Input/Input';
import styles from './GameSettingsPanel.module.css';

// 대기방에서 고를 수 있는 미니게임 6종 — 값에 따라 아래 설정 항목 전체가 바뀜
export type GameSettingsPanelGame = 'roulette' | 'ladder' | 'nunchi' | 'kingmaker' | 'timer' | 'sniper';

// 패널 상단 제목에 쓰이는 게임별 한글 이름
const GAME_NAME: Record<GameSettingsPanelGame, string> = {
  roulette: '운명의 룰렛',
  ladder: '랜덤 사다리',
  nunchi: '눈치게임',
  kingmaker: '킹메이커',
  timer: '시간초 잡기',
  sniper: '익명 저격',
};

const CUSTOM_OPTION = '직접 입력';
const LADDER_MAX_ITEMS = 8; // 사다리 결과 항목 최대 개수 (Figma "1/8" 표기 기준)
const KINGMAKER_MIN_VOTES = 1;
const KINGMAKER_MAX_VOTES = 5; // Figma에 상한 표기가 없어 임의로 정한 값

type GameSettingsPanelProps = {
  /** 현재 대기방에서 선택된 미니게임 — 바뀌면 아래 설정 항목 전체가 해당 게임 전용 UI로 즉시 전환됨 */
  game: GameSettingsPanelGame;
  /** true면 참가자용 읽기 전용 모드 — 자물쇠 아이콘·안내 문구로 바뀌고 칩/입력 클릭이 막힘(방장 화면은 기본값 false로 기존 동작 유지) */
  readOnly?: boolean;
  className?: string;
};

// 대기방에 삽입되는 "게임 설정" 패널 — 선택된 미니게임(game)에 맞춰 옵션 칩·입력창을 바꿔 보여줌
export function GameSettingsPanel({ game, readOnly = false, className }: GameSettingsPanelProps) {
  return (
    <Card className={[styles.panel, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <p className={styles.title}>
          {readOnly ? '🔒' : '⚙️'} {GAME_NAME[game]} 설정{readOnly && ' · 읽기 전용'}
        </p>
        <p className={styles.subtitle}>게임을 바꾸면 설정도 자동으로 바뀌어요</p>
      </div>
      {/* key={game}으로 게임이 바뀔 때마다 하위 트리를 새로 마운트해 이전 게임의 선택 상태가 남지 않게 함 */}
      {/* fields는 Card의 flex-column·gap을 그대로 이어받는 래퍼 — readOnly일 때만 포인터 이벤트를 막아 칩/입력 클릭이 먹지 않게 함(참가자는 설정을 볼 뿐 바꿀 수 없음) */}
      <div className={[styles.fields, readOnly ? styles.readOnlyFields : ''].filter(Boolean).join(' ')}>
        <SettingsFields key={game} game={game} />
      </div>
    </Card>
  );
}

// 게임별 설정 항목 스위치 — 실제 useState는 각 게임 전용 필드 컴포넌트가 들고 있음
function SettingsFields({ game }: { game: GameSettingsPanelGame }) {
  switch (game) {
    case 'roulette':
      return <RouletteFields />;
    case 'ladder':
      return <LadderFields />;
    case 'nunchi':
      return <NunchiFields />;
    case 'kingmaker':
      return <KingmakerFields />;
    case 'timer':
      return <TimerFields />;
    case 'sniper':
      return <SniperFields />;
  }
}

type ChipRowProps = {
  options: string[]; // 표시할 칩 라벨 목록 (순서대로 렌더링)
  value: string;
  onChange: (value: string) => void;
};

// 흰 배경 필 여러 개 중 하나만 잉크색으로 반전되는 선택형 칩 한 줄 — 6개 게임 설정이 공통으로 쓰는 패턴
function ChipRow({ options, value, onChange }: ChipRowProps) {
  return (
    <div className={styles.chipRow}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`${styles.chip} ${option === value ? styles.chipActive : ''}`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

type TopicChipFieldProps = {
  label: string; // 섹션 라벨 — "무엇을 정할까?" 또는 "질문"
  options: string[]; // 마지막 항목이 "직접 입력"인 칩 옵션 목록
  selected: string;
  onSelect: (value: string) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
  customPlaceholder: string;
};

// "칩으로 고르거나 직접 입력" 패턴 — 룰렛/눈치게임/킹메이커/시간초잡기/익명저격 5종이 공유하는 필드
function TopicChipField({
  label,
  options,
  selected,
  onSelect,
  customValue,
  onCustomChange,
  customPlaceholder,
}: TopicChipFieldProps) {
  const handleCustomChange = (e: ChangeEvent<HTMLInputElement>) => onCustomChange(e.target.value);
  return (
    <div className={styles.section}>
      <p className={styles.sectionLabel}>{label}</p>
      <ChipRow options={options} value={selected} onChange={onSelect} />
      {selected === CUSTOM_OPTION && (
        <Input value={customValue} onChange={handleCustomChange} maxLength={30} placeholder={customPlaceholder} />
      )}
    </div>
  );
}

// 운명의 룰렛 설정 — "무엇을 정할까?" 칩 + 직접 입력 (Figma 542:1860)
function RouletteFields() {
  const options = ['팀장', '발표자', '당첨', '벌칙', CUSTOM_OPTION];
  const [selected, setSelected] = useState(CUSTOM_OPTION); // 스크린샷상 기본 선택이 "직접 입력"
  const [customTopic, setCustomTopic] = useState('');
  return (
    <TopicChipField
      label="무엇을 정할까?"
      options={options}
      selected={selected}
      onSelect={setSelected}
      customValue={customTopic}
      onCustomChange={setCustomTopic}
      customPlaceholder="예) 오늘 청소 당번은?"
    />
  );
}

// 랜덤 사다리 설정 — 결과 항목을 자유롭게 추가/삭제하는 리스트 + 사다리 속도 칩 (Figma 542:1880)
function LadderFields() {
  const [items, setItems] = useState<string[]>(['']);
  const [speed, setSpeed] = useState('빠름'); // 스크린샷상 기본 선택

  const updateItem = (index: number, value: string) =>
    setItems((prev) => prev.map((v, i) => (i === index ? value : v)));
  const addItem = () => setItems((prev) => (prev.length >= LADDER_MAX_ITEMS ? prev : [...prev, '']));
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  return (
    <>
      <div className={styles.section}>
        <p className={styles.sectionLabel}>무엇을 정할까?</p>
        <div className={styles.ladderList}>
          {items.map((value, index) => (
            // eslint-disable-next-line react/no-array-index-key -- 항목이 이름 없는 텍스트라 인덱스 외의 안정적인 키가 없음
            <div key={index} className={styles.ladderRow}>
              <input
                className={styles.ladderInput}
                value={value}
                onChange={(e) => updateItem(index, e.target.value)}
                maxLength={30}
                placeholder="내용을 입력해 주세요"
              />
              {items.length > 1 && (
                <button
                  type="button"
                  className={styles.ladderRemove}
                  onClick={() => removeItem(index)}
                  aria-label={`${index + 1}번째 항목 삭제`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className={styles.ladderAdd}
            onClick={addItem}
            disabled={items.length >= LADDER_MAX_ITEMS}
          >
            + 추가 입력
          </button>
          <p className={styles.ladderHint}>필요한 만큼 입력 항목을 추가할 수 있어요 (최대 {LADDER_MAX_ITEMS}개)</p>
        </div>
      </div>
      <div className={styles.section}>
        <p className={styles.sectionLabel}>사다리 게임 속도</p>
        <ChipRow options={['빠름', '보통', '느리게']} value={speed} onChange={setSpeed} />
      </div>
    </>
  );
}

// 눈치게임 설정 — "무엇을 정할까?" 칩 + 직접 입력 + 동시 판정 시간 (Figma 542:1751)
function NunchiFields() {
  const [selected, setSelected] = useState(CUSTOM_OPTION);
  const [customTopic, setCustomTopic] = useState('');
  const [judgeTime, setJudgeTime] = useState('0.3초');
  return (
    <>
      <TopicChipField
        label="무엇을 정할까?"
        options={['팀장', '발표자', CUSTOM_OPTION]}
        selected={selected}
        onSelect={setSelected}
        customValue={customTopic}
        onCustomChange={setCustomTopic}
        customPlaceholder="예) 오늘 청소 당번은?"
      />
      <div className={styles.section}>
        <p className={styles.sectionLabel}>동시 판정 시간</p>
        <ChipRow options={['0.3초', '0.5초']} value={judgeTime} onChange={setJudgeTime} />
      </div>
    </>
  );
}

// 킹메이커 설정 — "무엇을 정할까?" 칩 + 직접 입력 + 1인당 투표 횟수 스테퍼 + 익명/실명 (Figma 542:1793)
function KingmakerFields() {
  const options = ['팀장', '주제 발표', '의제', '팀명', '당번', CUSTOM_OPTION];
  const [selected, setSelected] = useState(CUSTOM_OPTION);
  const [customTopic, setCustomTopic] = useState('');
  const [voteCount, setVoteCount] = useState(1);
  const [anonymity, setAnonymity] = useState('익명');

  return (
    <>
      <TopicChipField
        label="무엇을 정할까?"
        options={options}
        selected={selected}
        onSelect={setSelected}
        customValue={customTopic}
        onCustomChange={setCustomTopic}
        customPlaceholder="예) 오늘 청소 당번은?"
      />
      <div className={styles.section}>
        <p className={styles.sectionLabel}>1인당 투표 횟수</p>
        <div className={styles.stepperRow}>
          <button
            type="button"
            className={`${styles.stepBtn} ${styles.stepBtnMinus}`}
            onClick={() => setVoteCount((n) => Math.max(KINGMAKER_MIN_VOTES, n - 1))}
            disabled={voteCount <= KINGMAKER_MIN_VOTES}
            aria-label="투표 횟수 줄이기"
          >
            −
          </button>
          <div className={styles.stepNumBox}>{voteCount}</div>
          <button
            type="button"
            className={`${styles.stepBtn} ${styles.stepBtnPlus}`}
            onClick={() => setVoteCount((n) => Math.min(KINGMAKER_MAX_VOTES, n + 1))}
            disabled={voteCount >= KINGMAKER_MAX_VOTES}
            aria-label="투표 횟수 늘리기"
          >
            +
          </button>
          <span className={styles.stepUnit}>회</span>
        </div>
      </div>
      <div className={styles.section}>
        <p className={styles.sectionLabel}>투표 결과 익명 / 실명</p>
        <ChipRow options={['익명', '실명']} value={anonymity} onChange={setAnonymity} />
      </div>
    </>
  );
}

// 시간초 잡기 설정 — "무엇을 정할까?" 칩 + 직접 입력 + 목표 시간 + 당첨 기준 (Figma 542:1830)
function TimerFields() {
  const [selected, setSelected] = useState(CUSTOM_OPTION);
  const [customTopic, setCustomTopic] = useState('');
  const [seconds, setSeconds] = useState('5초');
  const [criterion, setCriterion] = useState('오차가 적은 사람');

  return (
    <>
      <TopicChipField
        label="무엇을 정할까?"
        options={['팀장', '주제 발표', CUSTOM_OPTION]}
        selected={selected}
        onSelect={setSelected}
        customValue={customTopic}
        onCustomChange={setCustomTopic}
        customPlaceholder="예) 오늘 청소 당번은?"
      />
      <div className={styles.section}>
        <p className={styles.sectionLabel}>타이머 (목표 시간) - 최대 10초</p>
        <ChipRow options={['5초', '7초', '10초']} value={seconds} onChange={setSeconds} />
      </div>
      <div className={styles.section}>
        <p className={styles.sectionLabel}>당첨 기준</p>
        <ChipRow options={['오차가 적은 사람', '오차가 큰 사람']} value={criterion} onChange={setCriterion} />
      </div>
    </>
  );
}

// 익명 저격 설정 — 프리셋 질문 칩(직접 입력 포함) + 중복 투표 여부 + 투표 시간 (Figma 542:1773)
function SniperFields() {
  const questionOptions = [
    '숨겨진 PPT 장인 관상은?',
    '진정한 팀장의 자질을 가진 사람은?',
    '가장 디자인을 잘하는 사람은?',
    CUSTOM_OPTION,
  ];
  const [question, setQuestion] = useState(questionOptions[0]);
  const [customQuestion, setCustomQuestion] = useState('');
  const [duplicate, setDuplicate] = useState('중복 투표 불가');
  // Figma 스펙에 "투표 시간" 라벨만 있고 실제 컨트롤이 잘려 있어, 다른 타이머형 설정과 동일한 칩 형태로 보완함
  const [voteTime, setVoteTime] = useState('20초');

  return (
    <>
      <TopicChipField
        label="질문"
        options={questionOptions}
        selected={question}
        onSelect={setQuestion}
        customValue={customQuestion}
        onCustomChange={setCustomQuestion}
        customPlaceholder="예) 나만 아는 그 사람의 비밀은?"
      />
      <div className={styles.section}>
        <p className={styles.sectionLabel}>중복 투표 여부</p>
        <ChipRow options={['중복 투표 불가', '중복 투표 가능']} value={duplicate} onChange={setDuplicate} />
      </div>
      <div className={styles.section}>
        <p className={styles.sectionLabel}>투표 시간</p>
        <ChipRow options={['10초', '20초', '30초']} value={voteTime} onChange={setVoteTime} />
      </div>
    </>
  );
}
