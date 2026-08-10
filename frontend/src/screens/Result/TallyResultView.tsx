import { avatarSrc } from '../../assets/avatars'
import { useRoomStore } from '../../store/roomStore'
import type { TallyResult } from '../../protocol/types'
import { ConfettiPiece, type ConfettiSpec } from './confetti'
import styles from './TallyResultView.module.css'

// 득표 막대가 순위대로 돌려 쓰는 색 (프레임의 노랑·핑크·시안에 이어 팔레트에서 3색 더)
const BAR_TONES = [
  'var(--color-yellow)',
  'var(--color-pink)',
  'var(--color-cyan)',
  'var(--color-online)',
  'var(--color-lilac)',
  'var(--color-teal)',
]

// 화면 위쪽으로 흩날리는 색종이 (화면 좌표 기준, 프레임 값 그대로)
const PAGE_CONFETTI: ConfettiSpec[] = [
  [293.33, 17.14, 21.09, 18.98, -31, 2],
  [477.35, 112.85, 12.66, 25.31, 6, 3],
  [655.95, 120.23, 16.88, 18.98, 43, 4],
  [856.12, 112.02, 21.09, 25.31, -10, 0],
  [1033.05, 109.69, 12.66, 18.98, 27, 1],
  [1228.9, 108.29, 16.88, 25.31, -26, 2],
  [1415.28, 122.02, 21.09, 18.98, 11, 3],
  [1603.34, 98.05, 12.66, 25.31, -42, 4],
]

interface TallyResultViewProps {
  result: TallyResult
  // 투표자를 공개하는 판인지 — 서버가 voterNicknames를 실어 보냈는지로 가른다
  reveal: boolean
  // 킹메이커에서만 "제안자는 항상 비공개" 알림을 띄운다 (저격은 제안자 개념이 없다)
  kingmaker: boolean
}

// 득표로 하나를 확정하는 결과 화면 (S-07b · Figma 878:2320 익명 / 878:5221 실명).
// 킹메이커와 익명 저격이 같은 판을 쓴다.
export function TallyResultView({ result, reveal, kingmaker }: TallyResultViewProps) {
  const members = useRoomStore((s) => s.members)
  const round = useRoomStore((s) => s.round)

  const rows = [...result.rows].sort((a, b) => a.rank - b.rank)
  const total = rows.reduce((sum, r) => sum + r.votes, 0)
  const top = rows[0]
  const share = total > 0 ? ((top?.votes ?? 0) / total) * 100 : 0

  // 투표자 칩에 얼굴을 붙이려면 닉네임으로 참가자를 되찾아야 한다 (서버는 닉네임만 보낸다)
  const avatarOf = (nickname: string) =>
    round?.roundMembers.find((m) => m.nickname === nickname)?.avatarId ??
    members.find((m) => m.nickname === nickname)?.avatarId ??
    null

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 1위 발표 카드 ── */}
      <section className={styles.hero}>
        <div className={styles.strip}>🏆&nbsp;&nbsp;최다 득표 {result.topic} 확정&nbsp;&nbsp;🏆</div>
        {kingmaker && <span className={styles.stripChip}>🔒 아이디어 제안자는 항상 비공개</span>}

        <div className={styles.heroBody}>
          <h1 className={styles.heroName}>{result.winnerLabel}</h1>
          <p className={styles.heroCaption}>
            {total}표 중 {top?.votes ?? 0}표 획득 · 1위로 {result.topic} 확정!
          </p>
          <div className={styles.stats}>
            <span className={`${styles.stat} ${styles.statCyan}`}>
              <b>{total}표</b>총 투표 수
            </span>
            <span className={`${styles.stat} ${styles.statPink}`}>
              <b>{share.toFixed(1)}%</b>1위 득표율
            </span>
            <span className={`${styles.stat} ${styles.statYellow}`}>
              <b>{reveal ? '👀 실명' : '🤐 익명'}</b>투표 공개 방식
            </span>
          </div>
        </div>
      </section>

      {/* ── 개표 결과 ── */}
      <section className={styles.tally}>
        <div className={styles.tallyHead}>
          <h2>
            ◆ 개표 결과 · 후보 {rows.length}개 · 총 {total}표
          </h2>
          <span className={styles.modeChip}>
            {reveal ? '👀 실명 모드 · 누가 뭘 뽑았는지 공개' : '🤐 익명 모드 · 누가 뭘 뽑았는지 비공개'}
          </span>
        </div>

        <div className={`${styles.list} ${reveal ? styles.listReveal : ''} scroll-thin`}>
          {/* 실명 판만 세 칸이 무엇인지 머리글로 알려준다 */}
          {reveal && (
            <div className={styles.colHead}>
              <em className={styles.colName}>후보</em>
              <em className={styles.colVotes}>득표수</em>
              <em className={styles.colVoters}>투표한 사람</em>
            </div>
          )}

          {rows.map((row, i) => {
            const empty = row.votes === 0
            return (
              <div
                key={row.optionId ?? row.memberId ?? `${row.label}-${i}`}
                className={`${styles.row} ${empty ? styles.rowEmpty : ''}`}
              >
                <span className={`${styles.rank} ${row.rank === 1 ? styles.rankTop : ''}`}>
                  {row.rank}
                </span>
                <span className={styles.label}>{row.label}</span>
                <span className={styles.track}>
                  {!empty && (
                    <i
                      style={{
                        width: `${total > 0 ? (row.votes / total) * 100 : 0}%`,
                        background: BAR_TONES[i % BAR_TONES.length],
                      }}
                    />
                  )}
                </span>
                <b className={styles.votes}>{row.votes}표</b>

                {reveal && (
                  <span className={styles.voters}>
                    {row.voterNicknames?.length ? (
                      row.voterNicknames.map((nickname) => {
                        const avatarId = avatarOf(nickname)
                        return (
                          <span key={nickname} className={styles.voter}>
                            {avatarId && <img src={avatarSrc(avatarId)} alt="" />}
                            {nickname}
                          </span>
                        )
                      })
                    ) : (
                      <em className={styles.noVoter}>— 아무도 안 뽑았어요</em>
                    )}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
