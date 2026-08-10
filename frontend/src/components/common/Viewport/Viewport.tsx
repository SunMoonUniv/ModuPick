import { useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import styles from './Viewport.module.css'

// 디자인이 고정된 무대 크기 (tokens.css의 --layout-width / --layout-height와 같은 값)
const STAGE_WIDTH = 1920
const STAGE_HEIGHT = 1080

// 창 크기에 맞춰 무대 전체를 몇 배로 키울지/줄일지 계산해 --app-scale에 넣는다.
// 가로·세로 중 작은 배율을 쓰므로 비율이 유지되고, 남는 쪽은 보라 여백이 된다.
// 첫 화면이 원본 크기로 한 번 번쩍이지 않도록 그리기 전(useLayoutEffect)에 값을 넣는다.
function useAppScale() {
  useLayoutEffect(() => {
    const apply = () => {
      const scale = Math.min(
        window.innerWidth / STAGE_WIDTH,
        window.innerHeight / STAGE_HEIGHT,
      )
      document.documentElement.style.setProperty('--app-scale', String(scale))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])
}

// 모든 화면을 감싸는 확대·축소 무대.
// 화면들은 여전히 1920×1080 좌표로만 그리고, 창 크기 대응은 여기서 통째로 배율을 먹여 해결한다.
export function Viewport({ children }: { children: ReactNode }) {
  useAppScale()

  return (
    <div className={styles.viewport}>
      <div className={styles.stage}>{children}</div>
    </div>
  )
}
