import { useNavigate } from 'react-router-dom'

import { Button, Card, ScreenFrame } from '../../components/common'
import { useRoomStore, type ClosedReason } from '../../store/roomStore'
import { clearSession } from '../../store/session'
import styles from './ClosedScreen.module.css'

// 방을 더 이상 이용할 수 없게 된 이유별 안내 문구. 되돌아갈 경로가 없으므로 홈으로만 보낸다.
const MESSAGES: Record<ClosedReason, { icon: string; title: string; description: string }> = {
  HOST_LEFT: {
    icon: '🚪',
    title: '방장이 방을 나갔어요',
    description: '방장이 나가면 방이 사라집니다. 새 방을 만들거나 다른 코드로 입장해주세요.',
  },
  EMPTY: {
    // 이모지 13.0 이후 글자(🫧 등)는 윈도우 10 기본 이모지 글꼴에 없어 두부(□)로 나온다 — 오래된 이모지만 쓴다
    icon: '💨',
    title: '방에 아무도 남지 않았어요',
    description: '모든 참가자가 나가서 방이 닫혔습니다.',
  },
  INACTIVE: {
    icon: '⏰',
    title: '방이 만료되었어요',
    description: '10분 동안 아무 활동이 없어 방이 자동으로 닫혔습니다.',
  },
  KICKED: {
    icon: '👋',
    title: '방에서 내보내졌어요',
    description: '방장이 회원님을 방에서 내보냈습니다. 자리가 남아 있으면 다시 입장할 수 있어요.',
  },
  DISCONNECTED: {
    icon: '🔌',
    title: '연결이 끊겼어요',
    description:
      '이 서비스는 재접속을 지원하지 않아 연결이 끊기면 방에서 나가게 됩니다. 코드를 다시 입력해 입장해주세요.',
  },
}

// 방이 닫히거나 연결이 끊겼을 때 도착하는 종착 화면.
export function ClosedScreen() {
  const navigate = useNavigate()
  const closed = useRoomStore((s) => s.closed)
  const reset = useRoomStore((s) => s.reset)
  const info = MESSAGES[closed ?? 'DISCONNECTED']

  const goHome = () => {
    reset()
    clearSession()
    navigate('/', { replace: true })
  }

  return (
    <ScreenFrame centered>
      <Card className={styles.panel}>
        <span className={styles.icon}>{info.icon}</span>
        <h1 className={styles.title}>{info.title}</h1>
        <p className={styles.description}>{info.description}</p>
        <Button size="lg" onClick={goHome}>
          처음으로
        </Button>
      </Card>
    </ScreenFrame>
  )
}
