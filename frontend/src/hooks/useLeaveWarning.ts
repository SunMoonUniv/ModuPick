// 새로고침·탭 닫기 경고.
// 이 서비스는 재접속 경로가 없어서 새로고침 한 번이면 그대로 방에서 빠지므로, 방 안에 있는 동안은 확인창을 띄운다.

import { useEffect } from 'react'

export function useLeaveWarning(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 최신 브라우저는 문구를 무시하고 기본 경고창만 띄우지만, 값을 넣어야 경고가 켜진다
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [enabled])
}
