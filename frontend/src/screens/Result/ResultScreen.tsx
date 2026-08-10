import { useEffect, useState } from 'react'

import { ScreenFrame } from '../../components/common'
import { api } from '../../api/rest'
import { useRoomStore } from '../../store/roomStore'
import type {
  AssignResult,
  GameMeta,
  NunchiConfig,
  RecordResult,
  TallyResult,
  WinnerResult,
} from '../../protocol/types'
import { AssignResultView } from './AssignResultView'
import { NunchiResultView } from './NunchiResultView'
import { RecordResultView } from './RecordResultView'
import { ResultActions } from './ResultActions'
import { SnipeResultView } from './SnipeResultView'
import { TallyResultView } from './TallyResultView'
import { WinnerResultView } from './WinnerResultView'
import styles from './ResultScreen.module.css'

// 게임 결과 화면. 결과 형태(variant) 4종에 따라 연출만 갈라지고, 하단의 다시 하기/대기방 복귀는 공통이다.
export function ResultScreen() {
  const room = useRoomStore((s) => s.room)
  const round = useRoomStore((s) => s.round)
  const result = useRoomStore((s) => s.result)

  const [catalog, setCatalog] = useState<GameMeta[]>([])

  // 어떤 게임의 결과인지 이름을 붙이려면 서버의 게임 메타데이터가 필요하다
  useEffect(() => {
    api
      .games()
      .then((res) => setCatalog(res.games))
      .catch(() => undefined)
  }, [])

  if (!room || !result) return null

  const gameId = round?.gameId ?? null
  const gameName = catalog.find((g) => g.gameId === gameId)?.name ?? ''
  const isAssign = result.variant === 'assign'
  const isRecord = result.variant === 'record'
  const tally = result.variant === 'tally' ? (result.result as TallyResult) : null
  // 투표자를 공개하는 판인지 — 서버가 voterNicknames를 실어 보냈는지로 가른다
  const reveal = tally?.rows.some((r) => r.voterNicknames !== undefined) ?? false
  // 같은 tally 결과라도 저격은 전용 프레임(542:2476)을 쓰고, 득표표는 킹메이커만 쓴다
  const snipeTally = tally && gameId === 'snipe' ? tally : null
  // 같은 winner 결과라도 눈치게임은 당첨자 카드가 아니라 라운드 기록 표(542:2619)로 발표한다
  const winner = result.variant === 'winner' ? (result.result as WinnerResult) : null
  const nunchiWinner = winner && gameId === 'nunchi' && winner.rounds ? winner : null

  // 무엇을 두고 겨뤘는지를 머리말에 싣는다 (당첨자 발표는 카드 안 알약이 이미 알려줘서 뺀다).
  // 저격은 질문이 카드 위쪽 띠에 통째로 올라가서 머리말에는 진행 방식만 적는다 (프레임 542:2476)
  const topic = isAssign
    ? (result.result as AssignResult).topic
    : isRecord
      ? (result.result as RecordResult).topic
      : snipeTally
        ? '익명 지목 투표'
        : nunchiWinner
          ? '라운드별 탈락 기록'
          : (tally?.topic ?? '')

  // 기록 결과 프레임(542:2292)은 목표 시간을, 집계 결과 프레임(878:5221)은 실명 여부를 머리말에 덧붙인다
  const extra = isRecord
    ? `목표 ${((result.result as RecordResult).targetMs / 1000).toFixed(2)}초`
    : tally && reveal
      ? '실명 공개'
      : ''

  return (
    <ScreenFrame fullBleed>
      <div className={styles.screen}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>
            {isAssign
              ? '역할 배분 완료'
              : isRecord
                ? '기록 발표'
                : snipeTally
                  ? '저격 완료'
                  : tally
                    ? '개표 완료'
                    : '결과 발표'}
          </h1>
          <span className={styles.titleEn}>RESULT</span>
        </div>
        <span className={styles.meta}>
          ● {[gameName, topic, extra].filter(Boolean).join(' · ')}
          {(gameName || topic || extra) && ' · '}방 {room.displayCode}
        </span>

        {/* 눈치게임 결과는 프레임(542:2619)의 라운드 기록 표로 발표한다 */}
        {nunchiWinner && (
          <NunchiResultView
            result={nunchiWinner}
            config={(round?.config as NunchiConfig | undefined) ?? null}
          />
        )}

        {/* 나머지 당첨자 1명 발표는 프레임(542:1119)을 그대로 적용했다 */}
        {winner && !nunchiWinner && gameId && (
          <WinnerResultView result={winner} gameId={gameId} gameName={gameName} />
        )}

        {/* 사다리 역할 배분은 프레임(542:2049)을 그대로 적용했다 */}
        {isAssign && (
          <AssignResultView
            result={result.result as AssignResult}
            elapsedMs={result.elapsedMs}
          />
        )}

        {/* 시간초 잡기 기록 순위는 프레임(542:2292)을 그대로 적용했다 */}
        {isRecord && <RecordResultView result={result.result as RecordResult} />}

        {/* 익명 저격의 최다 피격자 발표는 프레임(542:2476)을 그대로 적용했다 */}
        {snipeTally && <SnipeResultView result={snipeTally} reveal={reveal} />}

        {/* 킹메이커 득표 집계는 프레임(878:2320 익명 / 878:5221 실명)을 그대로 적용했다 */}
        {tally && !snipeTally && (
          <>
            <TallyResultView result={tally} reveal={reveal} kingmaker={gameId === 'kingmaker'} />
            <ResultActions wide />
          </>
        )}
      </div>
    </ScreenFrame>
  )
}
