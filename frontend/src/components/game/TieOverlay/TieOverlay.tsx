import { Button, Chip } from '../../common'
import { useRemainMs, toSeconds } from '../../../hooks/useServerClock'
import { useRoomStore } from '../../../store/roomStore'
import styles from './TieOverlay.module.css'

// 칩이 돌려 쓰는 색 — 프레임(542:4966)의 옐로·시안·핑크 순서를 그대로 반복한다
const CHIP_COLORS = ['yellow', 'cyan', 'pink'] as const

// 방장이 고르는 선택지의 문구. 서버가 보내주는 options 값만 그린다
const CHOICE_LABELS = {
  RETRY: '🔁 동점자끼리 다시!',
  ABORT: '◀ 대기방으로',
} as const

// 버튼을 놓는 순서는 프레임 고정이다 — 서버가 options를 어떤 순서로 보내든 왼쪽이 "대기방으로"다
const CHOICE_ORDER = ['ABORT', 'RETRY'] as const

export type TieOverlayMode = 'notice' | 'decision'

interface TieOverlayProps {
  // notice = 동점자 명단만 3초 보여주고 서버가 다음 단계로 넘긴다 (버튼 없음)
  // decision = 반복 상한을 소진해 멈춘 상태. 방장의 선택을 기다린다 (버튼 있음)
  mode: TieOverlayMode
  // 칩에 찍을 문구. 사람이면 닉네임, 킹메이커면 후보 문구 — 부르는 쪽이 이미 이어 붙여서 넘긴다
  names: string[]
  // decision 모드에서 서버가 알려 준 선택지. 화면이 임의로 늘리지 않는다
  options?: ('RETRY' | 'ABORT')[]
  // 교착 사유. 눈치의 무효 라운드만 문구가 다르다
  reason?: 'TIE_EXHAUSTED' | 'VOID_ROUND' | 'NO_OPTION'
  // 이 시각까지 방장이 안 고르면 서버가 대기방으로 되돌린다
  deadlineAt?: string | null
}

// 동점 통지(3초)와 교착 시 방장 선택을 같은 카드로 그리는 오버레이 (Figma 542:4966).
// **게임별로 붙이지 않고 GameScreen 한 곳에서만 띄운다** — 6종이 같은 상태를 공유하기 때문이다.
export function TieOverlay({ mode, names, options, reason, deadlineAt }: TieOverlayProps) {
  const isHost = useRoomStore((s) => s.me?.isHost ?? false)
  const decide = useRoomStore((s) => s.decide)
  const remain = useRemainMs(deadlineAt)

  const isVoidRound = reason === 'VOID_ROUND'
  const title = mode === 'notice' ? '동점이 나왔어요!' : isVoidRound ? '무효 라운드!' : '동점이 계속됐어요!'
  const badge = mode === 'notice' ? '⚑ 동점 발생!' : '⚑ 방장 선택 필요'
  const body =
    mode === 'notice'
      ? '동점자끼리 한 번 더 겨룹니다.'
      : isVoidRound
        ? '남은 전원이 같은 구간에 몰려 이 회차로는 아무도 가릴 수 없어요.'
        : '동점자끼리 다시 승부하거나, 대기방으로 돌아갈 수 있어요.'
  // 점수·득표·기록은 절대 붙이지 않는다 — 다음 회차의 전략이 되므로 서버도 보내지 않는다
  const caption = isVoidRound ? `남은 ${names.length}명 · 판정 불가` : `동점 ${names.length}명 · 같은 점수`

  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <Chip color="yellow" size="sm" elevated mono className={styles.badge}>
          {badge}
        </Chip>

        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>

        <div className={styles.names}>
          {names.map((name, i) => (
            <Chip key={`${name}-${i}`} color={CHIP_COLORS[i % CHIP_COLORS.length]} elevated className={styles.name}>
              {name}
            </Chip>
          ))}
        </div>
        <p className={styles.caption}>{caption}</p>

        {mode === 'decision' && (
          <>
            <span className={styles.divider} />
            {isHost ? (
              <div className={styles.actions}>
                {CHOICE_ORDER.filter((choice) => (options ?? CHOICE_ORDER).includes(choice)).map(
                  (choice) => (
                    <Button
                      key={choice}
                      size="md"
                      block
                      className={choice === 'RETRY' ? styles.retryButton : styles.choiceButton}
                      variant={choice === 'RETRY' ? 'primary' : 'secondary'}
                      onClick={() => decide(choice)}
                    >
                      {CHOICE_LABELS[choice]}
                    </Button>
                  ),
                )}
              </div>
            ) : (
              <p className={styles.waiting}>방장이 다시 할지 고르는 중이에요</p>
            )}
            <p className={styles.footnote}>
              방장이 선택하면 모두에게 바로 적용돼요
              {deadlineAt && remain > 0 && ` · ${toSeconds(remain)}초 뒤 자동으로 대기방`}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
