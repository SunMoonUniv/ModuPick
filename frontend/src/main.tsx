import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import './styles/global.css'
import { App } from './App'
import { Viewport } from './components/common'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 화면은 전부 1920×1080 좌표로만 그리고, 창 크기 대응은 Viewport가 무대 전체에 배율을 먹여 처리한다 */}
    <Viewport>
      {/* 주소는 항상 그대로 두고 화면만 바뀌어야 해서 MemoryRouter를 쓴다.
          경로(/room, /game …)는 메모리에만 남으므로 주소창·뒤로가기·새로고침으로는 특정 화면에 들어올 수 없다. */}
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </Viewport>
  </StrictMode>,
)
