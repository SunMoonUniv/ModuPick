import { useEffect, useState } from 'react'

import { avatarSrc } from '../../assets/avatars'
import { iconKingmaker, pointer, slice1, slice2, slice3, slice4, slice5, slice6, sunburstA, sunburstB } from '../../assets/home'
import { avatarTileColor } from '../../constants/avatarTiles'
import type { GameId } from '../../protocol/types'
import styles from './DemoPanel.module.css'

// 미리보기 한 판의 길이. CSS 애니메이션도 이 값을 `--demo-loop`으로 받아 쓰므로 여기만 고치면 전부 따라온다.
const LOOP_MS = 9000
// 화면을 다시 그리는 간격. 시간초 잡기의 소수점이 자연스럽게 흐를 만큼만 잦게 돈다.
const TICK_MS = 50
// 한 판에서 "진행 중"이 끝나고 결과가 나오는 지점 (0~1). CSS 키프레임의 70%와 같은 자리다.
const RESULT_AT = 0.7

// 미리보기에 등장하는 가짜 참가자 6명. 아바타 id는 저장소의 a01~a06을 쓴다.
// 실제 방과 아무 관련이 없는 장식이라 서버 데이터를 받지 않는다.
const DEMO_PLAYERS = [
  { name: '지호', avatarId: 'A01' },
  { name: '서연', avatarId: 'A02' },
  { name: '민준', avatarId: 'A03' },
  { name: '하늘', avatarId: 'A04' },
  { name: '도윤', avatarId: 'A05' },
  { name: '유진', avatarId: 'A06' },
]

// 룰렛 자리 좌표 — 원판 한가운데와 참가자 자리가 놓이는 반지름 (무대 좌표 기준)
const WHEEL_CX = 294.17
const WHEEL_CY = 202.92
const SEAT_RADIUS = 79
// 아바타 원 지름과 이름표 폭
const SEAT_SIZE = 29.961
const SEAT_LABEL_W = 59.923
// 첫 참가자(지호)가 앉는 각도. 화면 좌표계라 0도가 3시 방향이고 y는 아래로 커진다.
const SEAT_ANGLE_0 = 30

// 룰렛 테두리를 따라 도는 전구 12개 — 노랑과 흰색이 번갈아 켜진 모습이다
const BULBS = [
  [436.48, 198.15], [416.78, 271.69], [362.94, 325.53], [289.4, 345.24],
  [215.86, 325.53], [162.02, 271.69], [142.32, 198.15], [162.02, 124.61],
  [215.86, 70.78], [289.4, 51.07], [362.94, 70.78], [416.78, 124.61],
]

// 룰렛 파이 조각 6개. left/top/width/height는 272.376px 원 안에서 조각이 차지하는 사각형이다
const SLICES = [
  { src: slice1, left: 136.188, top: 136.188, width: 136.188, height: 117.942 },
  { src: slice2, left: 68.094, top: 136.188, width: 136.188, height: 136.188 },
  { src: slice3, left: 0, top: 136.188, width: 136.188, height: 117.942 },
  { src: slice4, left: 0, top: 18.246, width: 136.188, height: 117.942 },
  { src: slice5, left: 68.094, top: 0, width: 136.188, height: 136.188 },
  { src: slice6, left: 136.188, top: 18.246, width: 136.188, height: 117.942 },
]

// 눈치게임에서 각자 몇 번째로 누르는지. 같은 번호를 받은 사람들이 동시 입력으로 함께 탈락한다.
const NUNCHI_ORDER = [3, 1, 4, 2, 5, 5]
// 탈락자는 순번 배열에서 직접 뽑는다 — 손으로 적으면 순번을 고칠 때 조용히 어긋난다
const NUNCHI_OUT = NUNCHI_ORDER.flatMap((order, i, all) =>
  all.filter((o) => o === order).length > 1 ? [i] : [],
)

// 킹메이커 익명 안건과 득표수. 항상 내림차순이라 첫 줄이 1위다.
const KINGMAKER_OPTIONS = [
  { text: '코드 몬스터즈', votes: 3 },
  { text: '야근은 없다', votes: 2 },
  { text: '커피 한 잔의 여유', votes: 1 },
  { text: '월요일의 기적', votes: 0 },
]

// 사다리 레인 색은 실제 사다리 화면과 같은 순서를 쓴다
const LANE_COLORS = ['var(--color-yellow)', 'var(--color-pink)', 'var(--color-cyan)', 'var(--color-online)', 'var(--color-lilac)', 'var(--color-teal)']
const LADDER_ROLES = ['팀장', '기록', '발표', '간식', '총무', '사진']
// 사다리판 좌표계 (SVG viewBox 470×236 안). 기둥 간격 78은 실제 화면의 레인 간격 207을 약 0.38배로 줄인 값이다.
const LANE_X = (i: number) => 40 + i * 78
const LADDER_TOP = 22
const LADDER_BOTTOM = 196
// 기둥 굵기와 가로줄 두께도 실제 화면(12.656 / 8)을 같은 비율로 줄인 값이다
const POLE_W = 7
const RUNG_H = 4
// 가로줄 — [y, 왼쪽 레인 번호] 꼴이다. 같은 y에 겹치지 않게 한 칸 이상 띄워 놓았다.
const LADDER_RUNGS: [number, number][] = [
  [52, 0], [52, 3],
  [80, 1], [80, 4],
  [108, 0], [108, 2],
  [136, 1], [136, 3],
  [164, 2], [164, 4],
]

// 가로줄을 실제로 타고 내려가 레인별 경로와 도착 지점을 뽑는다.
// 경로를 손으로 적지 않고 가로줄에서 계산하므로, 가로줄을 고쳐도 꼬리·주자·도착 칩·결과 문구가 저절로 따라온다.
const LADDER_RUNS = LANE_COLORS.map((_, start) => {
  let lane = start
  let d = `M${LANE_X(lane)},${LADDER_TOP}`
  for (const [y, left] of [...LADDER_RUNGS].sort((a, b) => a[0] - b[0])) {
    if (left !== lane && left + 1 !== lane) continue
    const next = left === lane ? lane + 1 : left
    d += ` V${y} H${LANE_X(next)}`
    lane = next
  }
  return { d: `${d} V${LADDER_BOTTOM}`, end: lane }
})

// 게임마다 무대 왼쪽 위 알약에 뜨는 문구 — [진행 중, 결과] 두 벌이다.
// 사다리·눈치처럼 결과가 데이터에서 나오는 게임은 문구도 그 데이터에서 만들어 어긋나지 않게 한다.
const STAGE_PILL: Record<GameId, [string, string]> = {
  roulette: ['◷ 돌리는 중', '◉ 하늘 당첨!'],
  ladder: ['◷ 사다리 타는 중', `◉ ${DEMO_PLAYERS[0].name} → ${LADDER_ROLES[LADDER_RUNS[0].end]}`],
  kingmaker: [
    `◷ 익명 투표 중 · ${DEMO_PLAYERS.length}명`,
    `◉ ${KINGMAKER_OPTIONS[0].text} ${KINGMAKER_OPTIONS[0].votes}표로 확정`,
  ],
  timer: ['◷ 10.00초에 멈추기', '◉ 오차 0.13초 · 1위'],
  snipe: ['◷ 조준 중 · 익명', '◉ 민준 3표 피격'],
  nunchi: ['◷ 눈치 보는 중', `◉ ${NUNCHI_OUT.map((i) => DEMO_PLAYERS[i].name).join('·')} 동시 탈락`],
}

/* ── 게임별 무대 ── */

// 룰렛 — 원판이 세 바퀴 반 돌다 감속해 바늘 아래 한 명에서 멈춘다.
// 원판과 함께 도는 이름표는 글자가 뒤집히지 않도록 제자리에서 반대로 되돌린다.
function RouletteStage({ done }: { done: boolean }) {
  return (
    <>
      <div className={styles.wheelSpin}>
        <div className={styles.wheel}>
          {SLICES.map((s) => (
            <img
              key={s.src}
              className={styles.slice}
              src={s.src}
              alt=""
              style={{ left: s.left, top: s.top, width: s.width, height: s.height }}
            />
          ))}
        </div>

        {DEMO_PLAYERS.map((p, i) => {
          // 참가자 자리는 원 둘레에 고르게 놓인다
          const angleDeg = SEAT_ANGLE_0 + i * (360 / DEMO_PLAYERS.length)
          const rad = angleDeg * (Math.PI / 180)
          return (
            <span
              key={p.name}
              className={styles.seat}
              style={{
                left: WHEEL_CX + SEAT_RADIUS * Math.cos(rad) - SEAT_LABEL_W / 2,
                top: WHEEL_CY + SEAT_RADIUS * Math.sin(rad) - SEAT_SIZE / 2,
                // 아바타-이름 줄은 기본이 아래 방향(=+90도)이라, 자기 각도에 90도를 더하면
                // 아바타는 바깥에 남고 이름이 룰렛 중심 쪽을 향한다
                rotate: `${angleDeg + 90}deg`,
              }}
            >
              <i>
                <img src={avatarSrc(p.avatarId)} alt="" />
              </i>
              <b>{p.name}</b>
            </span>
          )
        })}
      </div>

      <span className={styles.ring} />
      {BULBS.map(([x, y], i) => (
        <span
          key={`${x}-${y}`}
          className={i % 2 === 0 ? styles.bulb : `${styles.bulb} ${styles.bulbLit}`}
          style={{ left: x, top: y }}
        />
      ))}

      <span className={styles.hub} />
      <span className={styles.hubText}>PICK!</span>

      <img className={styles.pointer} src={pointer} alt="" />
      <span className={styles.pointerDot} />
      <span className={styles.bubble}>{done ? '하늘 당첨! 🎉' : '누가 걸릴까?! 👀'}</span>
    </>
  )
}

/* 사다리 — 실제 화면(`LadderGame`)처럼 참가자마다 색 레인을 하나씩 갖고, 여섯 명이 동시에 내려간다.
   가로줄을 만나면 옆 레인으로 건너가고 지나온 자리에는 자기 색 꼬리가 남는다. */

function LadderStage({ done }: { done: boolean }) {
  return (
    <div className={styles.stageCenter}>
      {/* 판과 주자를 같은 크기의 상자에 겹쳐 놓는다 — SVG를 viewBox와 1:1 px로 그려야 주자의 경로 좌표가 맞는다 */}
      <div className={styles.ladderBoard}>
      <svg className={styles.ladder} viewBox="0 0 470 236">
        {/* 기둥 — 실제 화면처럼 레인 색을 채우고 잉크 테두리를 두른 둥근 막대다 */}
        {LANE_COLORS.map((color, i) => (
          <rect
            key={`lane-${i}`}
            className={styles.ladderLane}
            x={LANE_X(i) - POLE_W / 2}
            y={LADDER_TOP}
            width={POLE_W}
            height={LADDER_BOTTOM - LADDER_TOP}
            rx={POLE_W / 2}
            style={{ fill: color }}
          />
        ))}
        {LADDER_RUNGS.map(([y, left]) => (
          <rect
            key={`rung-${y}-${left}`}
            className={styles.ladderRung}
            x={LANE_X(left)}
            y={y - RUNG_H / 2}
            width={LANE_X(left + 1) - LANE_X(left)}
            height={RUNG_H}
            rx={RUNG_H / 2}
          />
        ))}
      </svg>

      {/* 주자 — 자기 레인의 경로를 실제로 타고 내려가는 아바타. 실제 화면처럼 이름 알약을 머리 위에 달고 다닌다 */}
      {DEMO_PLAYERS.map((p, i) => (
        <span key={p.name} className={styles.runner} style={{ offsetPath: `path('${LADDER_RUNS[i].d}')` }}>
          <b style={{ background: LANE_COLORS[i] }}>{p.name}</b>
          <i style={{ background: LANE_COLORS[i] }}>
            <img src={avatarSrc(p.avatarId)} alt="" />
          </i>
        </span>
      ))}
      </div>

      <div className={styles.ladderGoals}>
        {LADDER_RUNS.map((_, i) => {
          // 이 도착 칸에 실제로 들어온 주자를 찾아 이름을 붙인다
          const arrival = LADDER_RUNS.findIndex((r) => r.end === i)
          return (
            <span
              key={LADDER_ROLES[i]}
              className={done ? `${styles.goal} ${styles.goalDone}` : styles.goal}
              style={{ left: `${(LANE_X(i) / 470) * 100}%`, background: LANE_COLORS[arrival] }}
            >
              <b>{LADDER_ROLES[i]}</b>
              <em>{done ? DEMO_PLAYERS[arrival].name : '???'}</em>
            </span>
          )
        })}
      </div>
    </div>
  )
}

/* 킹메이커 — 실제 화면(`KingmakerGame`)의 투표 단계처럼 1위는 흰 스포트라이트 카드로 뜨고,
   나머지는 순위표로 선다. 득표한 항목과 0표 항목 사이에는 컷오프 선이 그인다. */

function KingmakerStage({ done }: { done: boolean }) {
  const top = KINGMAKER_OPTIONS[0]
  const rest = KINGMAKER_OPTIONS.slice(1)

  return (
    <div className={styles.stageCenter}>
      {/* 1위는 순위표에서 떼어내 흰 스포트라이트 카드로 세운다 (실제 화면의 `.spotlight`) */}
      <div className={styles.kmSpot}>
        <div className={styles.kmSpotMain}>
          <span className={styles.kmChips}>
            <b className={styles.kmChipTop}>
              <img src={iconKingmaker} alt="" />
              지금 1위
            </b>
            <b className={styles.kmChipRule}>최다 득표로 확정</b>
          </span>
          <span className={styles.kmTopText}>{top.text}</span>
          <span className={styles.kmTopBar}>
            <i style={{ animationDelay: '0.5s' }} />
          </span>
          <span className={styles.kmTopNote}>
            {done ? `${DEMO_PLAYERS.length}명 중 ${top.votes}명이 이 안건을 골랐어요` : '아직 투표가 들어오는 중…'}
          </span>
        </div>
        <span className={done ? `${styles.kmCount} ${styles.kmTopDone}` : styles.kmCount}>
          {done ? top.votes : '?'}
        </span>
        <span className={styles.kmVoteBadge}>VOTE!</span>
      </div>

      {/* 2위 아래 순위표는 실제 화면처럼 흰 카드 없이 무대 위에 바로 얹는다 */}
      <ul className={styles.kmRanks}>
        {rest.map((o, i) => (
          <li key={o.text}>
            {/* 표를 받은 항목과 아직 0표인 항목 사이에만 컷오프 선을 긋는다 */}
            {o.votes === 0 && rest[i - 1]?.votes > 0 && (
              <span className={styles.kmCutoff}>
                <i />
                <b>✂ 여기까지 득표 · 아래는 아직 0표</b>
              </span>
            )}
            <div className={o.votes === 0 ? `${styles.kmRow} ${styles.kmRowDim}` : styles.kmRow}>
              <span className={styles.kmRank}>{i + 2}</span>
              <b>{o.text}</b>
              <span className={styles.kmBar}>
                {/* 표가 하나씩 들어오는 것처럼 항목마다 시작 시각과 길이를 달리한다 */}
                <i
                  style={{
                    width: `${(o.votes / top.votes) * 100}%`,
                    animationDelay: `${1 + i * 0.55}s`,
                  }}
                />
              </span>
              <em>{done ? `${o.votes}표` : '…'}</em>
            </div>
          </li>
        ))}
      </ul>

      <span className={styles.kmLock}>🔒 누가 뭘 골랐는지 아무도 몰라요</span>
    </div>
  )
}

/* 시간초 잡기 — 실제 화면(`TimerGame`)처럼 큰 숫자판과 정지 타임라인을 나란히 둔다.
   목표선 오른쪽은 초과 구간이라 빗금이 깔리고, 멈춘 자리에 "나" 배지가 꽂힌다. */
const TIMER_TARGET = 10
const TIMER_STOPPED = 9.87
// 타임라인 눈금의 오른쪽 끝 (목표보다 넉넉히 잡아 초과 구간이 보이게 한다)
const TIMER_SCALE_MAX = 12

function TimerStage({ t, done }: { t: number; done: boolean }) {
  // 결과 시점 전까지는 0에서 멈춘 값까지 고르게 올라가고, 그 뒤로는 멈춘 값을 붙잡고 있는다
  const value = done ? TIMER_STOPPED : (t / RESULT_AT) * TIMER_STOPPED
  const pos = (value / TIMER_SCALE_MAX) * 100
  const targetPos = (TIMER_TARGET / TIMER_SCALE_MAX) * 100

  return (
    <div className={styles.stageCenter}>
      <div className={styles.board}>
      <div className={styles.tmHero}>
        <span className={styles.tmCaption}>
          {done ? '기록 확정 · 되돌릴 수 없어요' : '지금 흐르는 중 · 멈추면 즉시 확정'}
        </span>
        <span className={styles.tmRow}>
          <b className={done ? `${styles.tmValue} ${styles.tmValueStop}` : styles.tmValue}>
            {value.toFixed(2)}
          </b>
          <em className={styles.tmUnit}>초 경과</em>
          <span className={styles.tmDivider} />
          <span className={styles.tmRight}>
            <em>목표까지</em>
            <b>{Math.abs(TIMER_TARGET - value).toFixed(2)}</b>
            <em>{done ? '초 차이' : '초 남음'}</em>
          </span>
        </span>
      </div>

      <div className={styles.tmLine}>
        <span className={styles.tmTrack} />
        {/* 목표를 넘긴 구간 — 빗금으로 위험을 표시한다 */}
        <span className={styles.tmHazard} style={{ left: `${targetPos}%`, right: 0 }} />
        <span className={styles.tmFill} style={{ width: `${pos}%` }} />
        <span className={styles.tmTargetLine} style={{ left: `${targetPos}%` }} />
        <span className={styles.tmTargetTag} style={{ left: `${targetPos}%` }}>
          🎯 목표 {TIMER_TARGET.toFixed(2)}s
        </span>
        <span className={styles.tmMeLine} style={{ left: `${pos}%` }} />
        <span className={styles.tmMeBadge} style={{ left: `${pos}%` }}>나</span>
        <span className={styles.tmScaleLeft}>0.00s</span>
        <span className={styles.tmScaleRight}>{TIMER_SCALE_MAX.toFixed(2)}s</span>
      </div>
      </div>

      <div className={styles.tmPlayers}>
        {DEMO_PLAYERS.map((p, i) => (
          // 나(첫 사람) 말고는 순서대로 하나씩 멈춘 것처럼 보이게 시작 시각을 미룬다
          <span key={p.name} className={styles.tmPlayer} style={{ animationDelay: `${0.8 + i * 0.7}s` }}>
            <img src={avatarSrc(p.avatarId)} alt="" />
            <b>{p.name}</b>
            <em>✓ 정지</em>
          </span>
        ))}
      </div>
    </div>
  )
}

/* 익명 저격 — 실제 화면(`SnipeGame`)처럼 참가자 한 명이 조준경 하나가 된다.
   3중 링 + 십자 눈금 위에 아바타가 앉고, 조준선이 칸을 옮겨 다니다 한 명에서 멈춘다. */
const SNIPE_TARGET = 2

function SnipeStage({ done }: { done: boolean }) {
  return (
    <div className={styles.stageCenter}>
      <div className={styles.board}>
        <div className={styles.snipeGrid}>
          {DEMO_PLAYERS.map((p, i) => {
            const hit = done && i === SNIPE_TARGET
            return (
              <span key={p.name} className={hit ? `${styles.scopeCell} ${styles.scopeCellHit}` : styles.scopeCell}>
                <i className={styles.scopeRing1} />
                <i className={styles.scopeRing2} />
                <i className={styles.scopeRing3} />
                <i className={styles.scopeTickV} />
                <i className={styles.scopeTickH} />
                <span className={styles.scopeDisc} style={{ background: avatarTileColor(p.avatarId) }}>
                  <img src={avatarSrc(p.avatarId)} alt="" />
                </span>
                <b>{p.name}</b>
                <em>{hit ? '피격 3표' : done ? '세이프' : '조준 중…'}</em>
              </span>
            )
          })}
          {/* 격자 위를 옮겨 다니는 조준선 — 지나는 칸은 CSS 키프레임이 정한다 */}
          <span className={styles.scopeLock} />
        </div>

        <span className={styles.snipeHush}>🔒 쉿! 누가 누굴 쐈는지 아무도 몰라요</span>
      </div>
    </div>
  )
}

/* 눈치게임 — 실제 화면(`NunchiGame`)처럼 참가자 카드 줄 아래에 라운드 바와 UP 버튼을 둔다.
   순서대로 한 명씩 눌러 순번을 받고, 마지막 두 명이 같은 순간에 눌러 함께 탈락한다. */
// 순번 하나가 늘어나는 데 걸리는 시간 (초) — 마지막 순번이 결과 시점 직전에 닿도록 잡았다
const NUNCHI_BEAT = 1.15

function NunchiStage({ done }: { done: boolean }) {
  return (
    <div className={styles.stageCenter}>
      <div className={styles.board}>
      <div className={styles.nunchiRow}>
        {DEMO_PLAYERS.map((p, i) => {
          const out = done && NUNCHI_OUT.includes(i)
          return (
            <span
              key={p.name}
              className={out ? `${styles.nunchiCell} ${styles.nunchiCellOut}` : styles.nunchiCell}
              // 누르는 순서대로 불이 들어오게 각자 시작 시각을 미룬다
              style={{ animationDelay: `${NUNCHI_ORDER[i] * NUNCHI_BEAT}s` }}
            >
              <i className={styles.nunchiBadge}>{out ? '×' : NUNCHI_ORDER[i]}</i>
              <span className={styles.nunchiDisc} style={{ background: avatarTileColor(p.avatarId) }}>
                <img src={avatarSrc(p.avatarId)} alt="" />
              </span>
              <b>{p.name}</b>
              <em>{out ? '× 탈락' : `✓ ${NUNCHI_ORDER[i]}번째`}</em>
            </span>
          )
        })}
      </div>

      <div className={styles.nunchiBar}>
        <span className={styles.nunchiBarTitle}>
          {done ? '1라운드 종료!' : '지금 누르면 → 다음 순서'}
        </span>
        {/* 남은 시간 게이지 — 한 판 동안 줄어든다 */}
        <span className={styles.nunchiGauge}>
          <i />
        </span>
        {/* 눈금은 순번 개수만큼만 깔린다 — 마지막 두 명이 같은 순번이라 사람 수보다 하나 적다 */}
        <span className={styles.nunchiDots}>
          {Array.from({ length: Math.max(...NUNCHI_ORDER) }, (_, i) => (
            <b key={i} style={{ animationDelay: `${(i + 1) * NUNCHI_BEAT}s` }}>
              {i + 1}
            </b>
          ))}
        </span>
      </div>

      <span className={done ? `${styles.nunchiUp} ${styles.nunchiUpOut}` : styles.nunchiUp}>
        <b>{done ? '× 탈락' : '▲ UP!'}</b>
        <em>{done ? `동시 입력 · ${NUNCHI_OUT.length}명 탈락` : '누르면 다음 순서로 기록돼요'}</em>
      </span>
      </div>
    </div>
  )
}

interface DemoPanelProps {
  // 지금 보여줄 게임. 아래 슬라이더에서 고른 카드가 그대로 넘어온다
  game: { id: GameId; name: string; color: string }
}

// 표지 오른쪽의 "미리보기" 패널. 고른 게임 한 판이 9초짜리 연출로 계속 반복 재생된다.
// 소켓·API가 걸려 있지 않은 장식이라 등장인물과 결과는 전부 고정된 가짜 데이터다.
export function DemoPanel({ game }: DemoPanelProps) {
  // 한 판 안에서 지금 어디쯤인지 (0~1). 게임을 바꾸면 처음부터 다시 돈다.
  const [t, setT] = useState(0)

  useEffect(() => {
    // performance.now()가 아니라 CSS 애니메이션과 같은 시계(document.timeline)를 읽는다.
    // 탭을 벗어나면 CSS 애니메이션은 멈추는데 실제 시각은 계속 흘러서, 돌아왔을 때
    // "결과가 떴는데 원판은 아직 도는 중"처럼 어긋난다 — 같은 시계를 쓰면 둘이 같이 멈췄다 같이 이어진다.
    const clock = () => Number(document.timeline.currentTime ?? 0)
    const start = clock()
    const id = setInterval(() => setT(((clock() - start) % LOOP_MS) / LOOP_MS), TICK_MS)
    return () => clearInterval(id)
  }, [game.id])

  const done = t >= RESULT_AT
  const [pillPlaying, pillDone] = STAGE_PILL[game.id]
  // 아래 재생 바 — 트랙 폭(571.99)과 손잡이 지름(32.685)은 프레임 값 그대로다
  const fillWidth = 571.99 * t
  const knobLeft = 113.04 + fillWidth - 16.343

  return (
    <section className={styles.panel} aria-hidden="true">
      <span className={styles.title}>◆ {game.name}</span>
      <span className={styles.tag}>● 미리보기</span>
      <span className={styles.rule} />

      {/* key를 게임 id로 두면 게임을 바꿀 때 무대가 새로 붙어 CSS 애니메이션도 처음부터 다시 돈다 */}
      <div key={game.id} className={styles.stage} style={{ ['--demo-loop' as string]: `${LOOP_MS}ms` }}>
        <span className={styles.glow} />
        <img className={styles.sunburstB} src={sunburstB} alt="" />
        <img className={styles.sunburstA} src={sunburstA} alt="" />

        {game.id === 'roulette' && <RouletteStage done={done} />}
        {game.id === 'ladder' && <LadderStage done={done} />}
        {game.id === 'kingmaker' && <KingmakerStage done={done} />}
        {game.id === 'timer' && <TimerStage t={t} done={done} />}
        {game.id === 'snipe' && <SnipeStage done={done} />}
        {game.id === 'nunchi' && <NunchiStage done={done} />}

        <span className={styles.stagePill}>{done ? pillDone : pillPlaying}</span>
      </div>

      <span className={styles.listTitle}>◆ 참가자 · 6명</span>
      <ul className={styles.list}>
        {DEMO_PLAYERS.map((p, i) => (
          <li key={p.name} className={styles.row}>
            <span className={styles.rowAvatar}>
              <img src={avatarSrc(p.avatarId)} alt="" />
            </span>
            <span className={styles.rowName}>{p.name}</span>
            {/* 첫 사람만 방장이라 잉크색 왕관 줄, 나머지는 초록 접속 표시 */}
            <span className={i === 0 ? styles.rowHost : styles.rowOnline}>
              {i === 0 ? '👑 방장 · 접속' : '● 접속 중'}
            </span>
          </li>
        ))}
      </ul>

      <span className={styles.playButton}>▶</span>
      <span className={styles.track} />
      <span className={styles.trackFill} style={{ width: fillWidth }} />
      <span className={styles.knob} style={{ left: knobLeft }} />
      <span className={styles.elapsed}>
        0:0{Math.floor(t * (LOOP_MS / 1000))} / 0:0{LOOP_MS / 1000}
      </span>
    </section>
  )
}
