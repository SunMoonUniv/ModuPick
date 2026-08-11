import { useNavigate } from 'react-router-dom'

import { Button, Card, ScreenFrame } from '../../components/common'
import { useRoomStore, type ClosedReason } from '../../store/roomStore'
import { clearSession } from '../../store/session'
import styles from './ClosedScreen.module.css'

// 방을 더 이상 이용할 수 없게 된 이유별 안내 문구. 되돌아갈 경로가 없으므로 홈으로만 보낸다.
const MESSAGES: Record<ClosedReason, { icon: string; title: string; description: string }> = {
  // 방장 이탈만 전용 카드(C-06 · Figma 661:8)로 그린다 — 아래 hostLeft 분기를 볼 것
  HOST_LEFT: {
    icon: '💥',
    title: '방장이 이탈했어요',
    description: '방장이 나가서 방이 폭파됐어요.',
  },
  LAST_MEMBER_LEFT: {
    // 이모지 13.0 이후 글자(🫧 등)는 윈도우 10 기본 이모지 글꼴에 없어 두부(□)로 나온다 — 오래된 이모지만 쓴다
    icon: '💨',
    title: '방에 아무도 남지 않았어요',
    description: '모든 참가자가 나가서 방이 닫혔습니다.',
  },
  EXPIRED: {
    icon: '⏰',
    title: '방이 만료되었어요',
    description: '오랫동안 아무 활동이 없어 방이 자동으로 닫혔습니다.',
  },
  DUPLICATE: {
    icon: '👥',
    title: '이미 다른 탭에서 접속 중이에요',
    description: '같은 참가 자격으로는 한 곳에서만 접속할 수 있습니다. 먼저 열어 둔 탭을 확인해주세요.',
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

  // 방장 이탈은 어느 화면에서 맞든 같은 카드로 알린다 (대기방·인게임·결과 전부 room:closed로 온다)
  if (closed === 'HOST_LEFT') {
    return (
      <ScreenFrame centered>
        <div className={styles.hostLeft}>
          <span className={styles.hostLeftBadge}>{info.icon}</span>
          <h1 className={styles.hostLeftTitle}>{info.title}</h1>
          <p className={styles.hostLeftBody}>{info.description}</p>
          {/* 프레임에는 버튼이 없지만 이 화면에서 빠져나갈 길이 여기뿐이라 남겨 둔다 */}
          <Button size="lg" onClick={goHome}>
            처음으로
          </Button>
        </div>
      </ScreenFrame>
    )
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
