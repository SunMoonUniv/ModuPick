import { avatarSrc } from '../../assets/avatars'
import { AVATAR_TILE_COLORS } from '../../constants/avatarTiles'
import type { NunchiVerdict, ResultStat } from '../../protocol/types'
import type { NunchiView } from './adapters'
import { ConfettiPiece, PAGE_CONFETTI } from './confetti'
import { ResultActions } from './ResultActions'
import styles from './NunchiResultView.module.css'

interface NunchiResultViewProps {
  view: NunchiView
  // 아래 요약 타일. 문구까지 서버가 확정해 내려준다
  stats: ResultStat[]
}

// 아바타별 타일 색 — 인게임 화면과 같은 색을 써서 같은 사람인 걸 알아보게 한다
function tileColor(avatarId: string | null | undefined) {
  return AVATAR_TILE_COLORS[(avatarId ?? '').toUpperCase()] ?? 'var(--color-lavender)'
}

// 판정 4값의 화면 문구. **이 게임에는 탈락이 없다** — 빠져나가거나 후보로 남거나 둘 중 하나다.
function verdictLabel(verdict: NunchiVerdict) {
  switch (verdict) {
    case 'SAFE':
      return '✅ 혼자 눌러 안전'
    case 'OVERLAP':
      return '⚡ 겹쳐 누름 · 남음'
    case 'NO_INPUT':
      return '⏱ 안 누름 · 남음'
    case 'LAST':
      return '🎯 최후 1인'
  }
}

// 초 표기 — 안 누른 사람은 기록이 없다
function pressLabel(elapsedMs: number | null) {
  return elapsedMs === null ? '미입력' : `${(elapsedMs / 1000).toFixed(2)}초`
}

// 프레임(542:2619)의 요약 타일 4칸. **여기만 서버 stats가 아니라 판정 기록을 직접 센다** —
// 서버가 주는 stats 3개(라운드 수·판정창·최종 선정)에는 사람 수가 하나도 없기 때문이다.
// 계산이 아니라 같은 payload를 세는 것뿐이라 서버 판정과 어긋날 여지는 없다.
function verdictTiles(rounds: NunchiView['rounds']) {
  const rows = rounds.flatMap((r) => r.rows)
  const uniqueSafe = new Set(rows.filter((r) => r.verdict === 'SAFE').map((r) => r.member.memberId))
  const count = (verdict: NunchiVerdict) => rows.filter((r) => r.verdict === verdict).length
  return [
    { label: '참가자', value: `${rounds[0]?.rows.length ?? 0}명` },
    { label: '✅ 빠져나감', value: `${uniqueSafe.size}명` },
    { label: '⚡ 겹쳐 누름', value: `${count('OVERLAP')}회` },
    { label: '⏱ 안 누름', value: `${count('NO_INPUT')}회` },
  ]
}

// 눈치게임 결과 — 라운드별 판정 기록 (S-10b · Figma 542:2619).
// 당첨자 카드 대신 "누가 언제 눌러서 빠져나갔는지"를 표로 펼치는 게 이 게임의 결과 발표다.
export function NunchiResultView({ view, stats }: NunchiResultViewProps) {
  const rounds = view.rounds
  const tiles = verdictTiles(rounds)

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 게임 종료 요약 ── */}
      <section className={styles.summary}>
        <h2 className={styles.summaryTitle}>🎬 게임 종료 · {rounds.length}라운드 진행</h2>
        <span className={styles.summarySub}>
          혼자 누르면 빠져나가고 · 겹치거나 안 누르면 그대로 남는다 · 끝까지 남은 한 명이 뽑힌다
        </span>
        {/* 라운드 수·판정창·최종 선정은 서버가 문구까지 확정해 내려주므로 그대로 이어 붙인다 */}
        <span className={styles.summaryChip}>
          ◇ {stats.map((stat) => `${stat.label} ${stat.value}`).join(' · ')}
        </span>

        {tiles.map((tile, i) => (
          <span
            key={tile.label}
            className={`${styles.stat} ${[styles.statCyan, styles.statGreen, styles.statAmber, styles.statPink][i % 4]}`}
            style={{ left: 633.78 + i * 288 }}
          >
            <b>{tile.value}</b>
            {tile.label}
          </span>
        ))}
      </section>

      {/* ── 라운드별 판정 기록 ── */}
      <section className={styles.rounds}>
        <h2 className={styles.roundsTitle}>◆ 라운드별 판정 기록</h2>
        <div className={styles.legend}>
          <span className={`${styles.legendPill} ${styles.legendPass}`}>✅ 혼자 눌러서 빠져나감</span>
          <span className={`${styles.legendPill} ${styles.legendSim}`}>⚡ 겹쳐 눌러 그대로 남음</span>
          <span className={`${styles.legendPill} ${styles.legendTimeout}`}>⏱ 안 눌러 그대로 남음</span>
        </div>

        {/* 라운드가 3개를 넘으면 이 안에서만 세로로 스크롤된다 */}
        <div className={`${styles.roundList} scroll-thin`}>
          {rounds.map((r) => {
            const safe = r.rows.filter((row) => row.verdict === 'SAFE')
            const stayed = r.rows.filter((row) => row.verdict !== 'SAFE')
            // 겹쳐 누른 사람이 하나라도 있으면 그 라운드는 동시 입력으로 갈린 판이다
            const overlapped = stayed.some((row) => row.verdict === 'OVERLAP')
            return (
              <div key={r.round} className={styles.round}>
                <div className={styles.rail}>
                  <span className={styles.railCaption}>ROUND</span>
                  <span className={styles.railNumber}>{r.round}</span>
                  <span className={styles.railEntered}>참가 {r.rows.length}명</span>
                </div>

                <div className={styles.roundBody}>
                  <div className={`${styles.line} scroll-thin`}>
                    <span className={`${styles.countPill} ${styles.countPass}`}>
                      ✅ 빠져나감 {safe.length}명
                    </span>
                    {safe.map((row) => (
                      <span
                        key={row.member.memberId}
                        className={`${styles.chip} ${styles.chipPass}`}
                      >
                        <span
                          className={styles.chipAvatar}
                          style={{ background: tileColor(row.member.avatarId) }}
                        />
                        <img
                          className={styles.chipFace}
                          src={avatarSrc(row.member.avatarId)}
                          alt=""
                        />
                        <span className={styles.chipName}>{row.member.nickname}</span>
                        <span className={styles.chipTime}>{pressLabel(row.elapsedMs)}</span>
                      </span>
                    ))}
                  </div>

                  <div className={`${styles.line} scroll-thin`}>
                    <span className={`${styles.countPill} ${styles.countFail}`}>
                      ↩ 남음 {stayed.length}명
                    </span>
                    <span
                      className={`${styles.reason} ${overlapped ? styles.reasonSim : styles.reasonTimeout}`}
                    >
                      {overlapped ? '⚡ 판정창 안에 겹침' : '⏱ 입력 없음'}
                    </span>
                    {stayed.map((row) => (
                      <span
                        key={row.member.memberId}
                        className={`${styles.chip} ${row.verdict === 'OVERLAP' ? styles.chipSim : styles.chipTimeout}`}
                      >
                        <span
                          className={styles.chipAvatar}
                          style={{ background: tileColor(row.member.avatarId) }}
                        />
                        <img
                          className={styles.chipFace}
                          src={avatarSrc(row.member.avatarId)}
                          alt=""
                        />
                        <span className={styles.chipName}>{row.member.nickname}</span>
                        <span className={styles.chipTime}>{verdictLabel(row.verdict)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <ResultActions wide compact />
    </>
  )
}
