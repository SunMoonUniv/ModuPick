import {
  Avatar,
  Badge,
  Button,
  Card,
  ChatBubble,
  CharacterTile,
  Chip,
  EmptyRow,
  Input,
  SafeBandChip,
  StatTile,
} from './components/common';
import { CHARACTERS } from './assets/avatars/characters';
import styles from './App.module.css';

// 컴포넌트 갤러리 / 스타일 가이드 — 실제 화면이 아니라 토큰·디자인 변경을
// 눈으로 확인하기 위해 src/components/common의 모든 컴포넌트를 렌더링함
function App() {
  return (
    <div className={styles.gallery}>
      <h1 className={styles.title}>ModuPick · 공통 컴포넌트</h1>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Card</span>
        <div className={styles.row}>
          <Card style={{ padding: 20, width: 220 }}>카드 본문</Card>
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Button</span>
        <div className={styles.row}>
          <Button variant="primary">▶ 버튼</Button>
          <Button variant="accent">시작하기</Button>
          <Button variant="secondary">취소</Button>
          <Button variant="primary" disabled>
            비활성
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Chip</span>
        <div className={styles.row}>
          <Chip color="yellow">◆ 옐로 칩</Chip>
          <Chip color="pink">◆ 핑크 칩</Chip>
          <Chip color="cyan">◆ 시안 칩</Chip>
          <Chip color="white">◆ 화이트 칩</Chip>
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Avatar</span>
        <div className={styles.row}>
          <Avatar size={42} />
          <Avatar size={60} />
          <Avatar size={72} />
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>StatTile</span>
        <div className={styles.row}>
          <StatTile color="cyan" />
          <StatTile color="pink" />
          <StatTile color="yellow" />
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Badge</span>
        <div className={styles.row}>
          <Badge variant="host" />
          <Badge variant="ready" />
          <Badge variant="pending" />
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>ChatBubble</span>
        <div className={styles.column}>
          <ChatBubble variant="other">상대 · 안녕하세요!</ChatBubble>
          <ChatBubble variant="self">본인 · 저요!</ChatBubble>
          <ChatBubble variant="system">시스템 · 유진님이 입장했어요</ChatBubble>
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Input</span>
        <div className={styles.column}>
          <Input placeholder="메시지 입력…" maxLength={16} defaultValue="" />
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>EmptyRow</span>
        <div className={styles.column}>
          <EmptyRow />
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>SafeBandChip</span>
        <div className={styles.row}>
          <SafeBandChip name="하늘" />
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>CharacterTile · 상태 3종</span>
        <div className={styles.row}>
          <CharacterTile character={CHARACTERS[0]} state="mine" />
          <CharacterTile character={CHARACTERS[1]} state="available" />
          <CharacterTile character={CHARACTERS[2]} state="taken" pickedBy="유진" />
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>CharacterTile · 캐릭터 30종 (1~30)</span>
        <div className={styles.row} style={{ flexWrap: 'wrap', maxWidth: 1600 }}>
          {CHARACTERS.map((character) => (
            <CharacterTile key={character.id} character={character} state="available" />
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
