import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ScreenFrame } from '../../components/common'
import { api, normalizeCode, toDisplayCode } from '../../api/rest'
import { iconKingmaker, iconNunchi, iconRouletteA, iconRouletteB } from '../../assets/home'
import { useRoomStore } from '../../store/roomStore'
import { clearSession, saveSession } from '../../store/session'
import { presentError } from '../../constants/errorMessages'
import { ApiError } from '../../protocol/types'
import type { GameId } from '../../protocol/types'
import { DemoPanel } from './DemoPanel'
import styles from './HomeScreen.module.css'

// 하단 게임 슬라이더 카드 6장. left/top/rotate는 Figma 프레임 좌표 그대로이고,
// 문구는 카드 폭(282px)에 맞춰 프레임이 따로 쓴 짧은 표지용 카피라 서버 tagline과 다르다.
// rgb는 카드 왼쪽으로 흘러나가는 잔상 그림자 색에 쓰인다.
const GAME_CARDS: {
  id: GameId
  step: string
  name: string
  tagline: string
  color: string
  rgb: string
  left: number
  top: number
  rotate: number
}[] = [
  { id: 'roulette', step: '01', name: '운명의 룰렛', tagline: '돌려서 팀장 한 방에', color: 'var(--color-pink)', rgb: '255, 79, 212', left: 6.08, top: 34.07, rotate: 2.5 },
  { id: 'ladder', step: '02', name: '랜덤 사다리', tagline: '역할을 한 번에 배분', color: 'var(--color-cyan)', rgb: '87, 235, 250', left: 325.22, top: 30.27, rotate: -1.5 },
  { id: 'kingmaker', step: '03', name: '킹메이커', tagline: '익명 투표로 1인 선정', color: 'var(--color-yellow)', rgb: '255, 226, 62', left: 633.68, top: 47.66, rotate: 1.5 },
  { id: 'timer', step: '04', name: '시간초 잡기', tagline: '목표 시간에 딱 멈추기', color: 'var(--color-orange)', rgb: '255, 136, 51', left: 947.94, top: 72.87, rotate: 2 },
  { id: 'snipe', step: '05', name: '익명 저격', tagline: '10초 안에 익명 지목', color: 'var(--color-salmon)', rgb: '255, 140, 140', left: 1263.65, top: 24.07, rotate: -2.5 },
  { id: 'nunchi', step: '06', name: '눈치게임', tagline: '동시에 누르면 탈락', color: 'var(--color-violet)', rgb: '158, 102, 255', left: 1576.49, top: 40.41, rotate: -1 },
]

// 카드 6장이 한 바퀴 도는 가로 길이. 마지막 카드 x(1576.49)에 카드 사이 평균 간격(약 314)을 더하고
// 첫 카드 x(6.08)를 뺀 값이라, 카드 묶음을 이만큼 띄워 반복하면 이음매에서도 간격이 일정하게 보인다.
const CARD_CYCLE = 1884
// 카드 묶음 반복 횟수. 화면(1876px)이 한 주기만큼 밀려도 빈자리가 생기지 않으려면 3벌이 필요하다.
const CARD_COPIES = 3
// 슬라이더가 오른쪽으로 흐르는 속도 (초당 px)
const SLIDE_SPEED = 100

// 슬라이더 뒤로 흐르는 속도선. [클래스명, 색 rgb, 굵기, 길이, 세로위치, 가로위치] 순서의 순수 장식이다.
const SPEED_LINES: { rgb: string; peak: number; mid: number; h: number; w: number; top?: number; bottom?: number; left?: number; right?: number; via: number }[] = [
  { rgb: '87, 235, 250', peak: 0.42, mid: 0.23, h: 9, w: 820, top: 9, left: -37, via: 55 },
  { rgb: '255, 79, 212', peak: 0.24, mid: 0.13, h: 6, w: 640, top: 58, left: -140, via: 55 },
  { rgb: '255, 226, 62', peak: 0.3, mid: 0.17, h: 6, w: 1140, top: 24, right: -44, via: 55 },
  { rgb: '255, 79, 212', peak: 0.34, mid: 0.19, h: 11, w: 1000, top: 96, left: -120, via: 55 },
  { rgb: '191, 255, 58', peak: 0.26, mid: 0.14, h: 8, w: 1020, top: 132, right: -44, via: 55 },
  { rgb: '184, 153, 255', peak: 0.32, mid: 0.18, h: 9, w: 900, top: 188, left: -60, via: 55 },
  { rgb: '87, 235, 250', peak: 0.24, mid: 0.13, h: 7, w: 920, bottom: 37, right: -44, via: 55 },
  { rgb: '255, 226, 62', peak: 0.28, mid: 0.15, h: 10, w: 1260, bottom: 10, right: -44, via: 55 },
  { rgb: '255, 255, 255', peak: 0.34, mid: 0.17, h: 6, w: 780, top: 60, left: -60, via: 70 },
  { rgb: '255, 255, 255', peak: 0.3, mid: 0.15, h: 7, w: 740, top: 100, right: -44, via: 70 },
  { rgb: '255, 255, 255', peak: 0.28, mid: 0.14, h: 5, w: 960, top: 152, left: 580, via: 70 },
]

// 게임 카드 오른쪽 아래 아이콘. 원·막대로 그릴 수 있는 게임은 div로, 나머지는 내려받은 SVG로 그린다.
function GameCardIcon({ id }: { id: GameId }) {
  switch (id) {
    case 'roulette':
      return (
        <span className={styles.iconBox}>
          <img className={styles.iconQuadrantBR} src={iconRouletteA} alt="" />
          <img className={styles.iconQuadrantTL} src={iconRouletteB} alt="" />
          <span className={styles.iconRing} />
        </span>
      )
    case 'ladder':
      return (
        <span className={styles.iconBox}>
          <span className={styles.ladderLegL} />
          <span className={styles.ladderLegR} />
          <span className={styles.ladderRung} style={{ top: 14.112 }} />
          <span className={styles.ladderRung} style={{ top: 38.304 }} />
          <span className={styles.ladderRung} style={{ top: 62.496 }} />
        </span>
      )
    case 'kingmaker':
      return (
        <span className={styles.iconBox}>
          <img className={styles.iconCrown} src={iconKingmaker} alt="" />
        </span>
      )
    case 'timer':
      return (
        <span className={styles.iconBox}>
          <span className={styles.timerDial} />
          <span className={styles.timerCap} />
          <span className={styles.timerHand} />
        </span>
      )
    case 'snipe':
      return (
        <span className={styles.iconBox}>
          <span className={styles.targetOuter} />
          <span className={styles.targetInner} />
          <span className={styles.targetDot} />
        </span>
      )
    case 'nunchi':
      return (
        <span className={styles.iconBox}>
          <img className={styles.iconArrow} src={iconNunchi} alt="" />
        </span>
      )
  }
}

// 로고 옆의 전체화면 전환 버튼.
// 창이 1920×1080보다 작으면 무대가 소수 배율로 줄어 글자 획이 고르지 않게 그려진다 — 전체화면이면 배율이 1이 된다.
function FullscreenToggle() {
  // 'window'는 F11로 들어간 브라우저 자체 전체화면 — JS로 빠져나올 수 없어 버튼을 숨긴다
  const [mode, setMode] = useState<'normal' | 'api' | 'window'>('normal')

  useEffect(() => {
    const sync = () => {
      if (document.fullscreenElement) return setMode('api')
      // F11은 Fullscreen API 상태를 만들지 않아 창이 화면을 꽉 채웠는지로만 알 수 있다
      setMode(window.innerHeight >= screen.height - 4 ? 'window' : 'normal')
    }
    sync()
    document.addEventListener('fullscreenchange', sync)
    // F11로 드나들 때는 fullscreenchange 대신 창 크기만 바뀐다
    window.addEventListener('resize', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  // F11 전체화면은 JS로 빠져나올 수 없다 — 누를 수 없는 안내로 두고 나가는 방법만 알려준다
  if (mode === 'window') return <span className={styles.fullscreenHint}>F11 : 창 모드</span>

  const toggle = () => {
    // 사용자가 브라우저 설정으로 막아둘 수 있어 실패해도 화면은 그대로 둔다
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }

  return (
    <button type="button" className={styles.fullscreenHint} onClick={toggle}>
      {mode === 'api' ? 'F11 : 창 모드' : 'F11 : 전체화면'}
    </button>
  )
}

// 첫 진입 화면(표지). 방 만들기와 코드 입장이 한 줄에 함께 있고, 오른쪽 미리보기와 아래 게임 슬라이더는 장식이다.
export function HomeScreen() {
  const navigate = useNavigate()
  const reset = useRoomStore((s) => s.reset)
  const [serverDown, setServerDown] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  // 오른쪽 미리보기 패널이 지금 보여주는 게임. 아래 슬라이더의 카드를 누르면 바뀐다
  const [preview, setPreview] = useState<GameId>('roulette')

  const trackRef = useRef<HTMLDivElement>(null)
  // 카드에 마우스가 올라가 있는지. 상태로 두면 매 프레임 리렌더가 나므로 ref로만 읽는다
  const hoveringRef = useRef(false)

  // 슬라이더를 오른쪽으로 계속 흘린다. 마우스를 올리면 즉시 멈추지 않고 속도를 서서히 0으로 줄이고,
  // 벗어나면 다시 서서히 붙여 관성이 있는 것처럼 보이게 한다.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let last = performance.now()
    let x = 0
    let speed = 0

    const tick = (now: number) => {
      // 탭을 벗어났다 돌아오면 dt가 몇 초씩 튀어 카드가 순간이동하므로 한 프레임 몫으로 자른다
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const target = hoveringRef.current ? 0 : SLIDE_SPEED
      // 프레임 수에 상관없이 같은 감속감을 내는 지수 보간 — 값이 클수록 빨리 따라붙는다
      speed += (target - speed) * (1 - Math.exp(-dt * 4))
      x = (x + speed * dt) % CARD_CYCLE
      // 한 주기만큼 왼쪽에서 시작해 오른쪽으로 흐르다 제자리로 돌아온다 (이음매가 보이지 않는다)
      if (trackRef.current) trackRef.current.style.transform = `translateX(${x - CARD_CYCLE}px)`
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 홈으로 돌아왔다는 건 방을 떠났다는 뜻이라 이전 세션을 정리한다
  useEffect(() => {
    reset()
    clearSession()
  }, [reset])

  // 게임 목록 자체는 표지에 고정돼 있고, 이 호출은 임시 서버가 떠 있는지 확인하는 용도다
  useEffect(() => {
    api
      .games()
      .then(() => setServerDown(false))
      .catch(() => setServerDown(true))
  }, [])

  // 코드로 바로 입장 — 방 조회를 생략하고 슬롯 선점까지 한 번에 처리한다
  const join = async () => {
    if (code.length !== 6 || joining) return
    setJoining(true)
    setError(null)
    try {
      const res = await api.joinRoom(code)
      saveSession({
        code,
        displayCode: toDisplayCode(code),
        token: res.memberToken,
        memberId: res.memberId,
        pending: true,
      })
      navigate('/profile')
    } catch (e) {
      // 서버 message가 아니라 code로 문구를 고른다 — F-CMN-04 매핑(src/constants/errorMessages.ts)
      setError(e instanceof ApiError ? presentError(e.code).message : '입장하지 못했습니다.')
      setJoining(false)
    }
  }

  return (
    <ScreenFrame fullBleed>
      <div className={styles.screen}>
        <span className={styles.brand}>◆ MODU-PICK</span>
        <FullscreenToggle />

        {/* 오른쪽 위를 가로지르는 한 줄 소개 띠 */}
        <div className={styles.nav}>
          {/* 문구 사이 넓은 공백이 디자인의 일부라 공백을 그대로 살린다 (CSS white-space: pre-wrap) */}
          <p>{`설치도 로그인도 없이 !!          팀 역할 정하기를 게임처럼 !!           방을 만들고 !!           코드로 들어오면 바로 시작 !!!!!!!`}</p>
        </div>

        <span className={styles.eyebrow}>◆ 팀장·역할, 눈치싸움 없이</span>

        {/* 히어로 카피 3줄 — 줄마다 색과 시작 x가 달라 한 덩어리로 묶지 않는다 */}
        <h1 className={styles.heroYellow}>모두가</h1>
        <span className={styles.heroPink}>납득하는</span>
        <span className={styles.heroWhite}>유쾌한 픽</span>

        <button type="button" className={styles.createButton} onClick={() => navigate('/create')}>
          <span className={styles.createArrow}>▶</span>
          <span>새 방 만들기</span>
        </button>

        <div className={styles.codeField}>
          <span className={styles.codePrefix}>MODU-</span>
          <input
            className={styles.codeInput}
            value={code}
            maxLength={6}
            inputMode="numeric"
            placeholder="_ _ _ _ _ _"
            aria-label="방 코드"
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) join()
            }}
          />
          <button
            type="button"
            className={styles.joinButton}
            onClick={join}
            disabled={code.length !== 6 || joining}
          >
            {joining ? '…' : '참여'}
          </button>
        </div>

        {/* 입장 실패·서버 미기동 안내는 프레임에 없는 요소라 CTA 아래 빈 줄에 눕힌다 */}
        {(error || serverDown) && (
          <div className={styles.status}>
            {error ?? '임시 서버에 연결할 수 없습니다. 터미널에서 npm run server 를 먼저 실행해주세요.'}
          </div>
        )}

        <DemoPanel game={GAME_CARDS.find((g) => g.id === preview)!} />

        <span className={styles.stripNote}>▶ 6종 미니게임</span>
        <span className={`${styles.chevron} ${styles.chevron1}`}>»</span>
        <span className={`${styles.chevron} ${styles.chevron2}`}>»</span>
        <span className={`${styles.chevron} ${styles.chevron3}`}>»</span>

        <div className={styles.slider}>
          <span className={styles.railTop} />
          <span className={styles.railBottom} />

          {SPEED_LINES.map((l, i) => (
            <span
              key={i}
              className={styles.speedLine}
              style={{
                width: l.w,
                height: l.h,
                borderRadius: l.h / 2,
                top: l.top,
                bottom: l.bottom,
                left: l.left,
                right: l.right,
                background: `linear-gradient(to right, rgba(${l.rgb}, 0) 0%, rgba(${l.rgb}, ${l.mid}) ${l.via}%, rgba(${l.rgb}, ${l.peak}) 100%)`,
              }}
            />
          ))}

          {/* 카드 묶음을 CARD_CYCLE 간격으로 여러 벌 깔고 이 띠 전체를 옆으로 밀어 끊김 없이 돌린다 */}
          <div className={styles.cardTrack} ref={trackRef}>
            {Array.from({ length: CARD_COPIES }, (_, copy) =>
              GAME_CARDS.map((g) => (
                <button
                  type="button"
                  key={`${copy}-${g.id}`}
                  className={`${styles.gameCard} ${preview === g.id ? styles.gameCardActive : ''}`}
                  style={{
                    left: g.left + copy * CARD_CYCLE,
                    top: g.top,
                    background: g.color,
                    // 기울기는 카드마다 다르고 hover 확대·상승은 CSS가 붙이므로 변수로 넘긴다
                    ['--card-rotate' as string]: `${g.rotate}deg`,
                    boxShadow: `-22.176px 0 0 -5.04px rgba(${g.rgb}, 0.34), -12.096px 0 0 -2.016px rgba(${g.rgb}, 0.62), 7.056px 7.056px 0 0 var(--color-ink)`,
                  }}
                  onMouseEnter={() => (hoveringRef.current = true)}
                  onMouseLeave={() => (hoveringRef.current = false)}
                  onFocus={() => (hoveringRef.current = true)}
                  onBlur={() => (hoveringRef.current = false)}
                  onClick={() => setPreview(g.id)}
                  aria-label={`${g.name} 미리보기`}
                >
                  <span className={styles.cardDeco} />
                  <span className={styles.cardStep}>GAME {g.step}</span>
                  <span className={styles.cardNumber}>{Number(g.step)}</span>
                  <span className={styles.cardName}>{g.name}</span>
                  <span className={styles.cardTagline}>{g.tagline}</span>
                  <GameCardIcon id={g.id} />
                </button>
              )),
            )}
          </div>

          {/* 카드가 화면 밖으로 흘러 들어오고 나가는 것처럼 보이게 하는 좌우 페이드 */}
          <span className={styles.fadeIn} />
          <span className={styles.fadeOut} />
        </div>
      </div>
    </ScreenFrame>
  )
}
