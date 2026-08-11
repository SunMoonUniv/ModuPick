import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { useRoomStore } from './store/roomStore'
import { HomeScreen } from './screens/Home/HomeScreen'
import { CreateRoomScreen } from './screens/CreateRoom/CreateRoomScreen'
import { ProfileScreen } from './screens/Profile/ProfileScreen'
import { WaitingRoomScreen } from './screens/WaitingRoom/WaitingRoomScreen'
import { GameScreen } from './screens/Game/GameScreen'
import { ResultScreen } from './screens/Result/ResultScreen'
import { ClosedScreen } from './screens/Closed/ClosedScreen'

// 방 상태가 바뀌면 전원이 같은 화면으로 넘어가야 하므로, 라우팅을 사용자 클릭이 아니라 스토어 상태로 결정한다.
// (예: 방장이 게임을 시작하면 참가자 화면도 자동으로 /game으로 이동)
function useStateDrivenRouting() {
  const navigate = useNavigate()
  const location = useLocation()
  const connection = useRoomStore((s) => s.connection)
  const closed = useRoomStore((s) => s.closed)
  const round = useRoomStore((s) => s.round)
  const result = useRoomStore((s) => s.result)

  useEffect(() => {
    if (closed) {
      if (location.pathname !== '/closed') navigate('/closed', { replace: true })
      return
    }
    if (connection !== 'connected') return

    if (round) {
      if (location.pathname !== '/game') navigate('/game', { replace: true })
      return
    }
    // 라운드가 닫혀 대기방으로 돌아온 경우
    if (location.pathname === '/game' || location.pathname === '/result')
      navigate('/room', { replace: true })
  }, [closed, connection, round, location.pathname, navigate])

  // 결과 화면 전환 시점은 서버가 정한다 — 연출(REVEAL) 뒤 RESULT 단계로 넘기는 game:phase가
  // 전원에게 동시에 가므로, 클라가 따로 시각을 맞출 필요가 없다.
  useEffect(() => {
    if (!result || round?.phase !== 'RESULT') return
    navigate('/result', { replace: true })
  }, [result, round?.phase, navigate])
}

export function App() {
  useStateDrivenRouting()

  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      {/* 코드 입장은 홈 화면이 직접 처리하고 곧바로 /profile로 넘긴다 — 별도 입장 화면은 없다 */}
      <Route path="/create" element={<CreateRoomScreen />} />
      <Route path="/profile" element={<ProfileScreen />} />
      <Route path="/room" element={<WaitingRoomScreen />} />
      <Route path="/game" element={<GameScreen />} />
      <Route path="/result" element={<ResultScreen />} />
      <Route path="/closed" element={<ClosedScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
