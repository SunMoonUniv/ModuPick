import type { ResultStat } from '../../protocol/types'
import styles from './ResultStats.module.css'

// 타일 배경으로 쓸 수 있는 파스텔 3색 — 프레임마다 왼쪽부터 이 순서로 깔린다
export type ResultStatTone = 'cyan' | 'pink' | 'yellow'

export interface ResultStatItem {
  // 결과 카드 안쪽 좌표계에서 타일이 놓일 x — 프레임마다 값이 다르다
  left: number
  tone: ResultStatTone
  // 큰 글씨로 올라가는 숫자 ("6명", "5.00초")
  value: string
  // 숫자 아래 설명 ("참가자", "목표 시간")
  label: string
}

interface ResultStatsProps {
  // 타일 한 줄이 놓일 y — 결과 카드 안쪽 좌표계 기준
  top: number
  items: ResultStatItem[]
}

// 타일 색은 왼쪽부터 이 순서로 깔린다
const TONE_ORDER: ResultStatTone[] = ['cyan', 'pink', 'yellow']

// 서버가 내려준 요약 수치를 타일 줄에 앉힌다.
// **문구도 값도 서버가 확정한 것을 그대로 쓴다** — 화면이 다시 계산하면 게임마다 기준이 갈린다.
// lefts는 그 프레임에서 타일이 놓이는 x 좌표이며, 남는 수치는 그리지 않는다.
export function serverStatItems(stats: ResultStat[], lefts: number[]): ResultStatItem[] {
  return (stats ?? []).slice(0, lefts.length).map((stat, i) => ({
    left: lefts[i],
    tone: TONE_ORDER[i % TONE_ORDER.length],
    value: stat.value,
    label: stat.label,
  }))
}

// 결과 카드 아래쪽을 가로지르는 통계 타일 줄. 당첨자·역할 배분·기록 결과가 자리만 바꿔 같은 판을 쓴다.
export function ResultStats({ top, items }: ResultStatsProps) {
  return (
    <>
      {items.map((item) => (
        <span
          key={item.label}
          className={`${styles.stat} ${styles[item.tone]}`}
          style={{ left: item.left, top }}
        >
          <b>{item.value}</b>
          {item.label}
        </span>
      ))}
    </>
  )
}
