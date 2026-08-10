// 서버 시각 기준 카운트다운 훅.
// 판정은 전부 서버가 하므로 화면 숫자도 로컬 시계가 아니라 server:tick으로 받은 보정값을 더해 계산한다.

import { useEffect, useState } from 'react'
import { useRoomStore } from '../store/roomStore'

// deadlineAt(ISO 문자열)까지 남은 밀리초. 마감이 없거나 지났으면 0을 돌려준다.
export function useRemainMs(deadlineAt: string | null | undefined) {
  const offset = useRoomStore((s) => s.serverOffsetMs)
  const [remain, setRemain] = useState(0)

  useEffect(() => {
    if (!deadlineAt) {
      setRemain(0)
      return
    }
    const target = new Date(deadlineAt).getTime()
    const update = () => setRemain(Math.max(0, target - (Date.now() + offset)))
    update()
    // 100ms 간격이면 초 단위 표시가 한 박자 늦게 바뀌는 일이 없다
    const id = setInterval(update, 100)
    return () => clearInterval(id)
  }, [deadlineAt, offset])

  return remain
}

// 밀리초를 화면에 쓰는 초 단위 정수로 (올림 — 0.1초 남았을 때 "0초"가 아니라 "1초"로 보이게)
export function toSeconds(ms: number) {
  return Math.ceil(ms / 1000)
}

// 밀리초를 `1.234초` 형태로 (시간초 잡기 기록 표시용)
export function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(3)}초`
}

// 부호를 붙인 시간차 — 목표보다 빨랐으면 `-0.312초`, 늦었으면 `+0.312초`
export function formatDiff(ms: number) {
  const sign = ms >= 0 ? '+' : '-'
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}초`
}
