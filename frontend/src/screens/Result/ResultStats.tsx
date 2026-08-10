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
