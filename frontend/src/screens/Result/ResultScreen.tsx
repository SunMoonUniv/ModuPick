import { ScreenFrame } from '../../components/common'
import { useRoomStore } from '../../store/roomStore'
import type { AssignResult, RecordResult, TallyResult, WinnerResult } from '../../protocol/types'
import { toAssignView, toNunchiView, toSnipeView, toTallyView, toTimerView } from './adapters'
import { AssignResultView } from './AssignResultView'
import { NunchiResultView } from './NunchiResultView'
import { RecordResultView } from './RecordResultView'
import { ResultActions } from './ResultActions'
import { SnipeResultView } from './SnipeResultView'
import { TallyResultView } from './TallyResultView'
import { WinnerResultView } from './WinnerResultView'
import styles from './ResultScreen.module.css'

// 게임 결과 화면.
//
// **결과 형태(variant)와 게임은 1:1이 아니다** — 룰렛·시간초·저격이 모두 WINNER이고 세 payload의
// detail이 서로 다르다. 그래서 어느 연출을 쓸지는 variant가 아니라 gameId로 고른다.
// 하단의 다시 하기/대기방 복귀는 공통이다.
export function ResultScreen() {
  const room = useRoomStore((s) => s.room)
  const round = useRoomStore((s) => s.round)
  const result = useRoomStore((s) => s.result)
  const catalog = useRoomStore((s) => s.catalog)

  if (!room || !result) return null

  const gameId = result.gameId
  const gameName = catalog.find((g) => g.gameId === gameId)?.name ?? ''
  // 사람 정보는 결과 payload에 없다 — 라운드 명단 스냅샷과 이어 붙인다
  const roster = round?.roster ?? []

  // 게임별로 payload의 모양이 정해져 있어 여기서 한 번만 좁힌다
  const timer = gameId === 'timer' ? toTimerView(result.result as WinnerResult, roster) : null
  const snipe = gameId === 'snipe' ? toSnipeView(result.result as WinnerResult, roster) : null
  const tally = gameId === 'kingmaker' ? toTallyView(result.result as TallyResult, roster) : null
  const assign = gameId === 'ladder' ? toAssignView(result.result as AssignResult, roster) : null
  const nunchi = gameId === 'nunchi' ? toNunchiView(result.result as RecordResult, roster) : null
  const winner = gameId === 'roulette' ? (result.result as WinnerResult) : null

  // 무엇을 두고 겨뤘는지를 머리말에 싣는다 (당첨자 발표는 카드 안 알약이 이미 알려줘서 뺀다).
  // 저격은 질문이 카드 위쪽 띠에 통째로 올라가서 머리말에는 진행 방식만 적는다 (프레임 542:2476)
  const topic = assign
    ? assign.topic
    : snipe
      ? '익명 지목 투표'
      : nunchi
        ? '라운드별 판정 기록'
        : tally
          ? tally.topic
          : ''

  // 기록 결과 프레임(542:2292)은 목표 시간을, 집계 결과 프레임(878:5221)은 실명 여부를 머리말에 덧붙인다
  const extra = timer
    ? `목표 ${(timer.targetMs / 1000).toFixed(2)}초`
    : tally?.revealAuthors
      ? '제시자 공개'
      : ''

  return (
    <ScreenFrame fullBleed>
      <div className={styles.screen}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>
            {assign
              ? '역할 배분 완료'
              : timer
                ? '기록 발표'
                : snipe
                  ? '저격 완료'
                  : tally
                    ? '개표 완료'
                    : nunchi
                      ? '최종 선정'
                      : '결과 발표'}
          </h1>
          <span className={styles.titleEn}>RESULT</span>
        </div>
        <span className={styles.meta}>
          ● {[gameName, topic, extra].filter(Boolean).join(' · ')}
          {(gameName || topic || extra) && ' · '}방 {room.displayCode}
        </span>

        {/* 눈치게임 결과는 프레임(542:2619)의 라운드 기록 표로 발표한다 */}
        {nunchi && <NunchiResultView view={nunchi} stats={(result.result as RecordResult).stats} />}

        {/* 룰렛의 당첨자 1명 발표는 프레임(542:1119)을 그대로 적용했다 */}
        {winner && <WinnerResultView result={winner} gameId="roulette" gameName={gameName} />}

        {/* 사다리 역할 배분은 프레임(542:2049)을 그대로 적용했다 */}
        {assign && (
          <AssignResultView view={assign} stats={(result.result as AssignResult).stats} />
        )}

        {/* 시간초 잡기 기록 순위는 프레임(542:2292)을 그대로 적용했다 */}
        {timer && <RecordResultView view={timer} stats={(result.result as WinnerResult).stats} />}

        {/* 익명 저격의 최다 피격자 발표는 프레임(542:2476)을 그대로 적용했다 */}
        {snipe && <SnipeResultView view={snipe} stats={(result.result as WinnerResult).stats} />}

        {/* 킹메이커 득표 집계는 프레임(878:2320 익명 / 878:5221 실명)을 그대로 적용했다 */}
        {tally && (
          <>
            <TallyResultView view={tally} stats={(result.result as TallyResult).stats} />
            <ResultActions wide />
          </>
        )}
      </div>
    </ScreenFrame>
  )
}
