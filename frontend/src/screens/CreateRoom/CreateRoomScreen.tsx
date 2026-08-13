import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ScreenFrame } from '../../components/common'
import { api } from '../../api/rest'
import { saveSession } from '../../store/session'
import { presentError } from '../../constants/errorMessages'
import { ApiError } from '../../protocol/types'
import styles from './CreateRoomScreen.module.css'

// 인원 슬라이더가 다루는 범위 — 명세상 2~10명
const MIN_MEMBERS = 2
const MAX_MEMBERS = 10
// "빠른 선택" 칩으로 한 번에 고를 수 있는 값
const PRESETS = [2, 4, 6, 8, 10]
// 이름을 비우고 만들면 서버가 붙여주는 기본 방 이름 — 미리보기에도 같은 값을 보여준다
const DEFAULT_ROOM_NAME = 'ModuPick 방'

// 미리보기 패널 아래쪽 3단계 안내. 원 색깔만 단계마다 다르다.
const STEPS = [
  { color: 'var(--color-pink)', title: '방 코드를 친구에게 공유', desc: 'MODU-______ 형식의 코드가 바로 발급돼요' },
  { color: 'var(--color-cyan)', title: '코드만 입력하면 바로 입장', desc: '설치도 로그인도 필요 없어요' },
  { color: 'var(--color-yellow)', title: '대기방에서 게임 고르고 시작', desc: '팀장 · 역할 · 팀명까지 한 화면에서' },
]

// 방을 만드는 화면(S-02). 여기서는 pending 슬롯만 선점하고, 실제 입장은 다음 프로필 화면에서 확정된다.
export function CreateRoomScreen() {
  const navigate = useNavigate()
  const [roomName, setRoomName] = useState('')
  const [maxMembers, setMaxMembers] = useState(8)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 슬라이더 채움 폭과 손잡이 위치를 함께 계산한다 (트랙 폭 1141px)
  const ratio = (maxMembers - MIN_MEMBERS) / (MAX_MEMBERS - MIN_MEMBERS)
  const fillWidth = ratio * 1141
  const previewName = roomName.trim() || DEFAULT_ROOM_NAME

  const step = (delta: number) =>
    setMaxMembers((n) => Math.min(MAX_MEMBERS, Math.max(MIN_MEMBERS, n + delta)))

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.createRoom({ roomName: roomName.trim() || null, maxMembers })
      // 프로필 확정 전이므로 pending으로 저장한다 — 이 상태로는 소켓을 열 수 없다
      saveSession({
        code: res.code,
        displayCode: res.displayCode,
        token: res.memberToken,
        memberId: res.memberId,
        pending: true,
      })
      navigate('/profile')
    } catch (e) {
      // 서버 message가 아니라 code로 문구를 고른다 — F-CMN-04 매핑(src/constants/errorMessages.ts)
      setError(e instanceof ApiError ? presentError(e.code).message : '방을 만들지 못했습니다.')
      setSubmitting(false)
    }
  }

  return (
    <ScreenFrame fullBleed>
      <div className={styles.screen}>
        <h1 className={styles.title}>새 방 만들기</h1>
        <span className={styles.subtitle}>● 방 정보를 입력하고 친구들을 초대하세요</span>
        <button type="button" className={styles.backButton} onClick={() => navigate('/')}>
          ◀&nbsp;&nbsp;뒤로가기
        </button>

        {/* ── 방 이름 카드 ── */}
        <section className={styles.nameCard}>
          <span className={styles.cardTitle}>🏷️ 방 이름</span>
          <span className={styles.cardHint}>최대 30글자까지 입력할 수 있어요</span>
          <div className={styles.nameInput}>
            <input
              value={roomName}
              maxLength={30}
              placeholder={`비워두면 '${DEFAULT_ROOM_NAME}'으로 만들어져요`}
              onChange={(e) => setRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
              }}
            />
            <span className={styles.counter}>{roomName.length} / 30</span>
          </div>
        </section>

        {/* ── 최대 인원 카드 ── */}
        <section className={styles.membersCard}>
          <span className={styles.cardTitle}>👥 최대 인원</span>
          <span className={styles.cardHint}>최소 2명 ~ 최대 10명까지 설정할 수 있어요</span>

          <div className={styles.stepper}>
            <button type="button" className={styles.stepMinus} onClick={() => step(-1)}>
              −
            </button>
            <span className={styles.stepValue}>
              <b>{maxMembers}</b>명
            </span>
            <button type="button" className={styles.stepPlus} onClick={() => step(1)}>
              +
            </button>
          </div>
          <span className={styles.stepperDivider} />

          <span className={styles.presetLabel}>빠른 선택</span>
          <div className={styles.presets}>
            {PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={n === maxMembers ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                onClick={() => setMaxMembers(n)}
              >
                {n}명
              </button>
            ))}
          </div>

          <span className={styles.track} />
          <span className={styles.trackFill} style={{ width: fillWidth }} />
          <span className={styles.knob} style={{ left: 34.73 + fillWidth - 16.875 }} />
          {/* 눈에 보이는 막대 위에 투명한 range를 겹쳐 드래그·키보드 조작을 그대로 얻는다 */}
          <input
            className={styles.range}
            type="range"
            min={MIN_MEMBERS}
            max={MAX_MEMBERS}
            value={maxMembers}
            aria-label="최대 인원"
            onChange={(e) => setMaxMembers(Number(e.target.value))}
          />
          <span className={styles.rangeMin}>{MIN_MEMBERS}</span>
          <span className={styles.rangeMax}>{MAX_MEMBERS}</span>
        </section>

        {/* ── 안내 줄 ── */}
        <div className={styles.privacyHint}>
          <span className={styles.privacyMain}>🔒&nbsp;&nbsp;방 코드를 받은 사람만 입장할 수 있어요</span>
          <span className={styles.privacySub}>인원은 대기방에서도 변경 가능</span>
        </div>

        {/* ── 오른쪽 미리보기 ── */}
        <aside className={styles.preview}>
          <span className={styles.previewTitle}>◆ 미리보기</span>
          <span className={styles.previewSub}>입력한 정보가 대기방에 이렇게 보여요</span>

          <span className={styles.fieldLabel} style={{ top: 114.03 }}>
            방 이름
          </span>
          <span className={styles.fieldName}>{previewName}</span>
          <span className={styles.fieldLabel} style={{ top: 206.03 }}>
            최대 인원
          </span>
          <span className={styles.fieldMembers}>{maxMembers}명</span>
          <span className={styles.fieldLabel} style={{ top: 290.03 }}>
            방 코드
          </span>
          <span className={styles.fieldCode}>생성 시 MODU-**** 자동 발급</span>

          {STEPS.map((s, i) => (
            <div key={s.title} className={styles.stepCard} style={{ top: 390.03 + i * 114 }}>
              <span className={styles.stepBadge} style={{ background: s.color }}>
                {i + 1}
              </span>
              <span className={styles.stepTitle}>{s.title}</span>
              <span className={styles.stepDesc}>{s.desc}</span>
            </div>
          ))}
        </aside>

        {/* ── 하단 상태 밴드 ── */}
        <footer className={styles.band}>
          <span className={styles.bandBadge}>🚪</span>
          <span className={styles.bandTitle}>
            {previewName} · 최대 {maxMembers}명
          </span>
          {/* 실패 안내는 프레임에 자리가 없어 밴드 설명 줄을 그대로 빌려 쓴다 */}
          <span className={error ? `${styles.bandSub} ${styles.bandError}` : styles.bandSub}>
            {error ?? '방을 만들면 방 코드가 바로 발급돼요 · 친구에게 공유하세요'}
          </span>
          <button type="button" className={styles.submitButton} onClick={submit} disabled={submitting}>
            <span>🚪</span>
            <span>{submitting ? '만드는 중…' : '방 만들기'}</span>
          </button>
        </footer>
      </div>
    </ScreenFrame>
  )
}
