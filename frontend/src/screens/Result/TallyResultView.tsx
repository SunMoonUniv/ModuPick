import { avatarSrc } from '../../assets/avatars'
import type { ResultStat } from '../../protocol/types'
import type { TallyView } from './adapters'
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
  view: TallyView
  // 아래 통계 타일 줄. 문구까지 서버가 확정해 내려준다
  stats: ResultStat[]
}

// 득표로 하나를 확정하는 결과 화면 (S-07b · Figma 878:2320 익명 / 878:5221 실명).
// 킹메이커 전용이다 — 저격은 결과 형태가 WINNER라 다른 화면을 쓴다.
//
// **공개되는 것은 제시자이고 투표자가 아니다.** 누가 어디에 넣었는지는 어느 설정에서도 나오지 않아
// 프레임의 「투표한 사람」 칸을 「제안자」로 바꿔 채웠다.
export function TallyResultView({ view, stats }: TallyResultViewProps) {
  const rows = view.rows
  const total = rows.reduce((sum, r) => sum + r.votes, 0)
  const reveal = view.revealAuthors

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 1위 발표 카드 ── */}
      <section className={styles.hero}>
        <div className={styles.strip}>🏆&nbsp;&nbsp;최다 득표 {view.topic} 확정&nbsp;&nbsp;🏆</div>
        {/* 투표자는 어느 설정에서도 공개되지 않는다 */}
        <span className={styles.stripChip}>🔒 누가 어디에 넣었는지는 항상 비공개</span>

        <div className={styles.heroBody}>
          <h1 className={styles.heroName}>{view.winnerLabel}</h1>
          <p className={styles.heroCaption}>
            {total}표 중 {rows[0]?.votes ?? 0}표 획득 · 1위로 {view.topic} 확정!
          </p>
          <div className={styles.stats}>
            {/* 요약 수치는 서버가 문구까지 확정해 내려준다 */}
            {stats.map((stat, i) => (
              <span
                key={stat.label}
                className={`${styles.stat} ${[styles.statCyan, styles.statPink, styles.statYellow][i % 3]}`}
              >
                <b>{stat.value}</b>
                {stat.label}
              </span>
            ))}
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
            {reveal ? '👀 제시자 공개 · 누가 낸 안건인지 표시' : '🤐 익명 모드 · 제시자도 비공개'}
          </span>
        </div>

        <div className={`${styles.list} ${reveal ? styles.listReveal : ''} scroll-thin`}>
          {/* 실명 판만 세 칸이 무엇인지 머리글로 알려준다 */}
          {reveal && (
            <div className={styles.colHead}>
              <em className={styles.colName}>후보</em>
              <em className={styles.colVotes}>득표수</em>
              <em className={styles.colVoters}>제안자</em>
            </div>
          )}

          {rows.map((row, i) => {
            const empty = row.votes === 0
            return (
              <div
                key={row.candidateId}
                className={`${styles.row} ${empty ? styles.rowEmpty : ''}`}
              >
                <span className={`${styles.rank} ${row.rank === 1 ? styles.rankTop : ''}`}>
                  {row.rank}
                </span>
                <span className={styles.label}>{row.text}</span>
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
                    {row.author ? (
                      <span className={styles.voter}>
                        <img src={avatarSrc(row.author.avatarId)} alt="" />
                        {row.author.nickname}
                      </span>
                    ) : (
                      <em className={styles.noVoter}>— 제안자 없음</em>
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
