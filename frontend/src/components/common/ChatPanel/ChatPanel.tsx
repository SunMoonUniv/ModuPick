import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Card } from '../Card/Card';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import { Input } from '../Input/Input';
import styles from './ChatPanel.module.css';

const MESSAGE_MAX_LENGTH = 200;

// 채팅 로그 한 줄 — kind로 말풍선(상대/본인) vs 가운데 정렬 시스템 알림을 구분함
export type ChatMessage = {
  id: string;
  kind: 'other' | 'self' | 'system';
  author?: string; // kind가 'other'일 때만 말풍선 위에 표시되는 발신자 이름
  avatarSrc?: string; // kind가 'other'일 때만 쓰이는 발신자 아바타 이미지
  avatarTint?: string; // 발신자 아바타 원 배경색
  time?: string; // 이미 "2:12"처럼 포맷된 타임스탬프 — 컴포넌트는 별도 포맷팅을 하지 않음
  text: string;
};

type TypingIndicator = {
  user: string;
  avatarSrc: string;
  avatarTint: string;
};

type ChatPanelProps = {
  messages: ChatMessage[]; // 초기 채팅 로그 — 전송 시 컴포넌트 내부 state에 이어붙을 뿐 서버로는 전송되지 않음
  typing?: TypingIndicator; // 넘기면 하단에 "○○님이 입력 중…" 인디케이터가 보임
  className?: string;
};

// 대기방 공통 채팅 패널 — 방장/참가자 화면이 동일하게 쓰는 로그+입력창(Figma 542:561 "Chat")
export function ChatPanel({ messages, typing, className }: ChatPanelProps) {
  const [log, setLog] = useState(messages);
  const [draft, setDraft] = useState('');

  const handleDraftChange = (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value);

  // 전송 — 백엔드가 없으므로 지금 시각을 붙여 내 말풍선으로 로그 맨 끝에 추가만 함
  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    const now = new Date();
    const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    setLog((prev) => [...prev, { id: `local-${now.getTime()}`, kind: 'self', text, time }]);
    setDraft('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <Card className={[styles.panel, className].filter(Boolean).join(' ')}>
      <div className={styles.header}>
        <p className={styles.title}>◆ CHAT</p>
        <p className={styles.subtitle}>대기방 채팅 · 실시간</p>
      </div>
      <div className={styles.divider} />

      <div className={styles.log}>
        {log.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className={styles.systemPill}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={styles.group}>
              {m.kind === 'other' && <p className={styles.author}>{m.author}</p>}
              <div className={m.kind === 'self' ? styles.rowSelf : styles.row}>
                {m.kind === 'other' && (
                  <div className={styles.avatarRing} style={{ background: m.avatarTint }}>
                    <img className={styles.avatarImg} src={m.avatarSrc} alt="" />
                  </div>
                )}
                {m.kind === 'self' && m.time && <span className={styles.time}>{m.time}</span>}
                <ChatBubble variant={m.kind}>{m.text}</ChatBubble>
                {m.kind === 'other' && m.time && <span className={styles.time}>{m.time}</span>}
              </div>
            </div>
          ),
        )}

        {typing && (
          <div className={styles.group}>
            <div className={styles.row}>
              <div className={styles.avatarRing} style={{ background: typing.avatarTint }}>
                <img className={styles.avatarImg} src={typing.avatarSrc} alt="" />
              </div>
              <ChatBubble variant="other" className={styles.typingBubble}>
                ● ● ●
              </ChatBubble>
              <span className={styles.time}>{typing.user}님이 입력 중…</span>
            </div>
          </div>
        )}
      </div>

      <div className={styles.inputRow}>
        <Input
          className={styles.input}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder="메시지 입력…"
        />
        <button type="button" className={styles.sendBtn} onClick={handleSend} aria-label="메시지 보내기">
          ▶
        </button>
      </div>
    </Card>
  );
}
