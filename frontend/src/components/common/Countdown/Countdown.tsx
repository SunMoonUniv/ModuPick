import { toSeconds } from '../../../hooks/useServerClock'
import styles from './Countdown.module.css'

interface CountdownProps {
  remainMs: number
  size?: 'sm' | 'md' | 'lg'
  // 이 시간 아래로 내려가면 빨간색으로 바뀐다
  urgentBelowMs?: number
  suffix?: string
}

// 남은 시간을 초 단위 숫자로 보여준다. 값은 useRemainMs로 계산해서 넘긴다.
export function Countdown({ remainMs, size = 'md', urgentBelowMs = 3000, suffix = '초' }: CountdownProps) {
  const urgent = remainMs <= urgentBelowMs
  return (
    <span
      className={[styles.countdown, styles[size], urgent ? styles.urgent : ''].filter(Boolean).join(' ')}
    >
      {toSeconds(remainMs)}
      {suffix}
    </span>
  )
}

interface CountdownBarProps {
  remainMs: number
  totalMs: number
  urgentBelowMs?: number
}

// 남은 시간을 막대로 보여주는 형태. 숫자와 함께 쓰면 마감 임박이 더 잘 읽힌다.
export function CountdownBar({ remainMs, totalMs, urgentBelowMs = 3000 }: CountdownBarProps) {
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainMs / totalMs)) : 0
  const urgent = remainMs <= urgentBelowMs
  return (
    <div className={styles.track}>
      <div
        className={[styles.fill, urgent ? styles.fillUrgent : ''].filter(Boolean).join(' ')}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}
