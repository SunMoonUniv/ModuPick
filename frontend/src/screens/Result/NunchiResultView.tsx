import { avatarSrc } from '../../assets/avatars'
import { AVATAR_TILE_COLORS } from '../../constants/avatarTiles'
import { useRoomStore } from '../../store/roomStore'
import type { NunchiConfig, NunchiRoundLog, WinnerResult } from '../../protocol/types'
import { ConfettiPiece, PAGE_CONFETTI } from './confetti'
import { ResultActions } from './ResultActions'
import styles from './NunchiResultView.module.css'

interface NunchiResultViewProps {
  result: WinnerResult
  // 판정 폭·라운드 제한을 요약 알약에 그대로 싣기 위해 라운드 설정을 받는다
  config: NunchiConfig | null
}

// 아바타별 타일 색 — 인게임 화면과 같은 색을 써서 같은 사람인 걸 알아보게 한다
function tileColor(avatarId: string | null | undefined) {
  return AVATAR_TILE_COLORS[(avatarId ?? '').toUpperCase()] ?? 'var(--color-lavender)'
}

// 라운드 하나의 탈락 사유를 화면 문구로
function reasonLabel(round: NunchiRoundLog) {
  switch (round.reason) {
    case 'SIMULTANEOUS':
      return round.gapMs === undefined
        ? '⚡ 동시 입력'
        : `⚡ 동시 입력 · ${(round.gapMs / 1000).toFixed(2)}초 차`
    case 'TIMEOUT':
      return '⏱ 제한시간 초과'
    case 'LAST_ONE':
      return '🐢 마지막 한 명'
    case 'ALL_PRESSED':
      return '💥 남은 전원이 누름'
    case 'DISCONNECTED':
      return '⏸ 연결 끊김'
  }
}

// 초 표기 — 안 누른 사람은 기록이 없다
function pressLabel(elapsedMs: number | null) {
  return elapsedMs === null ? '미입력' : `${(elapsedMs / 1000).toFixed(2)}초`
}

// 눈치게임 결과 — 라운드별 판정 기록 (S-10b · Figma 542:2619).
// 당첨자 카드 대신 "누가 언제 눌러서 살고 죽었는지"를 표로 펼치는 게 이 게임의 결과 발표다.
export function NunchiResultView({ result, config }: NunchiResultViewProps) {
  const round = useRoomStore((s) => s.round)
  const rounds = result.rounds ?? []

  const members = round?.roundMembers ?? []
  // 사유별 탈락 인원 — 요약 타일 3칸에 그대로 들어간다
  const bySimultaneous = rounds
    .filter((r) => r.reason === 'SIMULTANEOUS')
    .reduce((n, r) => n + r.eliminated.length, 0)
  // 프레임의 마지막 칸은 "제한시간 초과"만 세지만, 마지막 한 명·연결 끊김 탈락도 있어야 합이 맞아서 함께 센다
  const byOther = rounds
    .filter((r) => r.reason !== 'SIMULTANEOUS')
    .reduce((n, r) => n + r.eliminated.length, 0)

  return (
    <>
      {PAGE_CONFETTI.map((piece) => (
        <ConfettiPiece key={`page-${piece[0]}-${piece[1]}`} piece={piece} />
      ))}

      {/* ── 게임 종료 요약 ── */}
      <section className={styles.summary}>
        <h2 className={styles.summaryTitle}>
          🎬 게임 종료 · {rounds.length}라운드 진행
        </h2>
        <span className={styles.summarySub}>
          혼자 누르면 통과 · 겹치면 동시 탈락 · 시간 초과 시 탈락
        </span>
        {config && (
          <span className={styles.summaryChip}>
            ⚖ 동시 판정 {(config.decisionWindowMs / 1000).toFixed(1)}초 · 라운드 제한{' '}
            {Math.round(config.subRoundTimeoutMs / 1000)}초
          </span>
        )}

        <span className={`${styles.stat} ${styles.statCyan}`} style={{ left: 633.78 }}>
          <b>{members.length}명</b>참가자
        </span>
        <span className={`${styles.stat} ${styles.statGreen}`} style={{ left: 921.78 }}>
          <b>1명</b>✅ 통과
        </span>
        <span className={`${styles.stat} ${styles.statAmber}`} style={{ left: 1209.78 }}>
          <b>{bySimultaneous}명</b>⚡ 동시 입력 탈락
        </span>
        <span className={`${styles.stat} ${styles.statPink}`} style={{ left: 1497.78 }}>
          <b>{byOther}명</b>⏱ 제한시간·순서 탈락
        </span>
      </section>

      {/* ── 라운드별 판정 기록 ── */}
      <section className={styles.rounds}>
        <h2 className={styles.roundsTitle}>◆ 라운드별 판정 기록</h2>
        <div className={styles.legend}>
          <span className={`${styles.legendPill} ${styles.legendPass}`}>✅ 혼자 눌러서 통과</span>
          <span className={`${styles.legendPill} ${styles.legendSim}`}>
            ⚡ {config ? (config.decisionWindowMs / 1000).toFixed(1) : '0.3'}초 내 동시 입력 탈락
          </span>
          <span className={`${styles.legendPill} ${styles.legendTimeout}`}>
            ⏱ 제한시간 초과 탈락
          </span>
        </div>

        {/* 라운드가 3개를 넘으면 이 안에서만 세로로 스크롤된다 */}
        <div className={`${styles.roundList} scroll-thin`}>
          {rounds.map((r) => {
            const simultaneous = r.reason === 'SIMULTANEOUS'
            return (
              <div key={r.subRound} className={styles.round}>
                <div className={styles.rail}>
                  <span className={styles.railCaption}>ROUND</span>
                  <span className={styles.railNumber}>{r.subRound}</span>
                  <span className={styles.railEntered}>참가 {r.entered}명</span>
                </div>

                <div className={styles.roundBody}>
                  <div className={`${styles.line} scroll-thin`}>
                    <span className={`${styles.countPill} ${styles.countPass}`}>
                      ✅ 통과 {r.passed.length}명
                    </span>
                    {r.passed.map((p) => (
                      <span key={p.memberId} className={`${styles.chip} ${styles.chipPass}`}>
                        <span
                          className={styles.chipAvatar}
                          style={{ background: tileColor(p.avatarId) }}
                        />
                        <img className={styles.chipFace} src={avatarSrc(p.avatarId)} alt="" />
                        <span className={styles.chipName}>{p.nickname}</span>
                        <span className={styles.chipTime}>{pressLabel(p.elapsedMs)}</span>
                      </span>
                    ))}
                  </div>

                  <div className={`${styles.line} scroll-thin`}>
                    <span className={`${styles.countPill} ${styles.countFail}`}>
                      ❌ 탈락 {r.eliminated.length}명
                    </span>
                    <span
                      className={`${styles.reason} ${simultaneous ? styles.reasonSim : styles.reasonTimeout}`}
                    >
                      {reasonLabel(r)}
                    </span>
                    {r.eliminated.map((p) => (
                      <span
                        key={p.memberId}
                        className={`${styles.chip} ${simultaneous ? styles.chipSim : styles.chipTimeout}`}
                      >
                        <span
                          className={styles.chipAvatar}
                          style={{ background: tileColor(p.avatarId) }}
                        />
                        <img className={styles.chipFace} src={avatarSrc(p.avatarId)} alt="" />
                        <span className={styles.chipName}>{p.nickname}</span>
                        <span className={styles.chipTime}>{pressLabel(p.elapsedMs)}</span>
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
