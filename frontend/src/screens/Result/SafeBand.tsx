import { avatarSrc } from '../../assets/avatars'
import styles from './SafeBand.module.css'
import type { MemberId } from '../../protocol/types'

// 카드가 순서대로 돌려 쓰는 파스텔 배경과 아바타 링 색
const SAFE_TONES = [
  { bg: 'var(--color-pastel-1)', ring: 'var(--color-online)' },
  { bg: 'var(--color-pastel-2)', ring: 'var(--color-pink)' },
  { bg: 'var(--color-pastel-3)', ring: 'var(--color-cyan)' },
  { bg: 'var(--color-pastel-4)', ring: 'var(--color-lilac)' },
  { bg: 'var(--color-pastel-5)', ring: 'var(--color-yellow)' },
]

interface SafeBandProps {
  // 당첨자를 뺀 나머지 — Member와 RoundMember를 둘 다 받을 수 있게 최소 형태로 받는다
  members: { memberId: MemberId; nickname: string; avatarId: string }[]
  // 알약 문구를 사람마다 바꾸고 싶을 때 (없으면 전원 "세이프!")
  pillLabel?: (memberId: MemberId) => string
}

// 결과 화면 맨 아래 "휴~ 비껴간 N명" 띠 (프레임 542:1119 · 542:2476 공용).
// 당첨자 발표와 저격 결과가 같은 판을 써서 공통으로 뺐다.
export function SafeBand({ members, pillLabel }: SafeBandProps) {
  return (
    <section className={styles.band}>
      <span className={styles.title}>😅 휴~ 비껴간 {members.length}명</span>
      <div className={`${styles.list} scroll-thin`}>
        {members.map((member, i) => {
          const tone = SAFE_TONES[i % SAFE_TONES.length]
          return (
            <div key={member.memberId} className={styles.card} style={{ background: tone.bg }}>
              <span className={styles.avatar} style={{ background: tone.ring }}>
                <img src={avatarSrc(member.avatarId)} alt="" />
              </span>
              <span className={styles.name}>{member.nickname}</span>
              <span className={styles.pill}>{pillLabel?.(member.memberId) ?? '세이프!'}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
