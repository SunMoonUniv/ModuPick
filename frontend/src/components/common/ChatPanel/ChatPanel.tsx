import { useEffect, useRef, useState } from 'react'
import { avatarSrc } from '../../../assets/avatars'
import { sendIcon } from '../../../assets/icons'
import { useRoomStore } from '../../../store/roomStore'
import styles from './ChatPanel.module.css'

// 채팅 입력이 멈춘 뒤 이만큼 지나면 "입력 중" 표시를 스스로 내린다 (서버가 false를 안 보내줄 수도 있으므로)
const TYPING_IDLE_MS = 3000

// 보낸 시각을 "2:12" 꼴로 — 프레임이 초를 빼고 24시간제 없이 짧게 쓴다
function formatTime(iso: string) {
  const d = new Date(iso)
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 대기방 가운데에 붙는 528×770 채팅 패널. 메시지 이력은 서버가 저장하지 않아 스토어가 로컬스토리지로 관리한다.
export function ChatPanel() {
  const chat = useRoomStore((s) => s.chat)
  const members = useRoomStore((s) => s.members)
  const me = useRoomStore((s) => s.me)
  const typingIds = useRoomStore((s) => s.typingIds)
  const sendChat = useRoomStore((s) => s.sendChat)
  const sendTyping = useRoomStore((s) => s.sendTyping)

  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const typingTimer = useRef<number | null>(null)

  // 새 메시지가 오면 항상 맨 아래로 붙여둔다
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.length, typingIds.length])

  const submit = () => {
    const text = draft.trim()
    if (text.length === 0) return
    sendChat(text)
    setDraft('')
    sendTyping(false)
  }

  const onChange = (value: string) => {
    setDraft(value)
    sendTyping(value.length > 0)
    if (typingTimer.current) window.clearTimeout(typingTimer.current)
    typingTimer.current = window.setTimeout(() => sendTyping(false), TYPING_IDLE_MS)
  }

  // 내가 입력 중인 건 나에게 보여줄 필요가 없다
  const typing = typingIds
    .filter((id) => id !== me)
    .map((id) => members.find((m) => m.memberId === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))

  return (
    <div className={styles.panel}>
      <span className={styles.title}>◆ CHAT</span>
      <span className={styles.subtitle}>대기방 채팅 · 실시간</span>
      <span className={styles.rule} />

      <div className={`${styles.list} scroll-thin`} ref={listRef}>
        {chat.length === 0 && <div className={styles.systemPill}>첫 메시지를 남겨보세요</div>}

        {chat.map((message) => {
          const mine = message.memberId === me
          return (
            <div
              key={message.messageId}
              className={mine ? `${styles.row} ${styles.rowMine}` : styles.row}
            >
              {!mine && (
                <span className={styles.avatar}>
                  <img src={avatarSrc(message.avatarId)} alt="" />
                </span>
              )}
              <div className={styles.bubbleWrap}>
                {!mine && <span className={styles.author}>{message.nickname}</span>}
                <div className={styles.bubbleLine}>
                  <span className={mine ? `${styles.bubble} ${styles.bubbleMine}` : styles.bubble}>
                    {message.text}
                  </span>
                  <span className={styles.time}>{formatTime(message.sentAt)}</span>
                </div>
              </div>
            </div>
          )
        })}

        {typing.map((member) => (
          <div key={member.memberId} className={styles.row}>
            <span className={styles.avatar}>
              <img src={avatarSrc(member.avatarId)} alt="" />
            </span>
            <div className={styles.bubbleWrap}>
              <div className={styles.bubbleLine}>
                <span className={`${styles.bubble} ${styles.bubbleTyping}`}>● ● ●</span>
                <span className={styles.time}>{member.nickname}님이 입력 중…</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.composer}>
        <input
          className={styles.input}
          value={draft}
          maxLength={200}
          placeholder="메시지 입력…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          }}
        />
        <span className={styles.counter}>{draft.length} / 200</span>
      </div>
      <button
        type="button"
        className={styles.send}
        onClick={submit}
        disabled={draft.trim().length === 0}
        aria-label="보내기"
      >
        <img src={sendIcon} alt="" />
      </button>
    </div>
  )
}
