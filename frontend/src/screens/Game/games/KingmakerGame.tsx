import { useEffect, useRef, useState } from 'react'

import { GameHud, HudPill } from '../../../components/common'
import {
  ballotIcon,
  crownIcon,
  lightbulbIcon,
  starIcon,
  starPinkIcon,
  starYellowIcon,
  stepArrowIcon,
  sunburstIcon,
  targetIcon,
} from '../../../assets/icons'
import { useRemainMs } from '../../../hooks/useServerClock'
import { useRoomStore } from '../../../store/roomStore'
import type { KingmakerConfig } from '../../../protocol/types'
import common from './GameCommon.module.css'
import styles from './KingmakerGame.module.css'

// 아이디어 카드가 순서대로 돌려 쓰는 3색 (프레임의 노랑·시안·핑크)
const IDEA_TONES = ['var(--color-yellow)', 'var(--color-cyan)', 'var(--color-pink)']

// 상단 진행 배지 3단계 — 제출 → 투표 → 확정
const STEPS = ['① 익명 팀명 제출', '② 서바이벌 투표', '③ 팀명 확정']

// 남은 시간을 `01:12` 꼴로
function mmss(ms: number) {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// 킹메이커. 익명으로 의견을 모은 뒤(SUBMIT) 작성자를 가린 채 투표한다(VOTE/TIE).
export function KingmakerGame() {
  const round = useRoomStore((s) => s.round)!
  const tie = useRoomStore((s) => s.tie)
  const result = useRoomStore((s) => s.result)
  const sendAction = useRoomStore((s) => s.sendAction)

  const config = round.config as KingmakerConfig
  const [picked, setPicked] = useState<string[]>([])
  const [voted, setVoted] = useState(false)
  // 내가 낸 안건 본문. 서버가 투표 단계에서 제시자를 감춰 보내서, 어느 게 내 것인지는 이 값으로만 알 수 있다
  const [myText, setMyText] = useState('')

  // 결선 투표가 시작되면 이전 선택을 비워 다시 고르게 한다
  useEffect(() => {
    setPicked([])
    setVoted(false)
  }, [round.phase, tie?.candidates.length])

  const toggleOption = (optionId: string) => {
    setPicked((prev) => {
      if (prev.includes(optionId)) return prev.filter((id) => id !== optionId)
      if (prev.length >= config.votesPerMember) {
        // 1표짜리 설정에서는 새로 고른 쪽으로 바꿔주는 편이 자연스럽다
        return config.votesPerMember === 1 ? [optionId] : prev
      }
      return [...prev, optionId]
    })
  }

  const submitVote = () => {
    if (picked.length === 0) return
    sendAction('king.vote', { optionIds: picked })
    setVoted(true)
  }

  // 결선이면 동점 후보만, 아니면 서버가 준 전체 안건 목록
  const options = tie
    ? tie.candidates.map((c) => ({ optionId: c.id, text: c.label }))
    : (round.options ?? [])

  if (round.phase === 'SUBMIT') return <SubmitStage onSubmitted={setMyText} />

  if (round.phase === 'VOTE' || round.phase === 'TIE') {
    return (
      <VoteStage
        options={options}
        myText={myText}
        picked={picked}
        voted={voted}
        onToggle={toggleOption}
        onSubmit={submitVote}
      />
    )
  }

  return (
    <div className={styles.legacyStage}>
      <div className={common.wrap}>
        <h1 className={common.topic}>{config.topic}</h1>
        <span className={common.reveal}>{result ? '결과 집계 완료!' : '집계 중...'}</span>
      </div>
    </div>
  )
}

// 보라 배경 위 장식 별 — [x, y, 한 변, 색] (프레임 878:684 좌표)
const VOTE_STARS: [number, number, number, string][] = [
  [62, 191.95, 31.641, starYellowIcon],
  [1240.68, 196.17, 25.313, starIcon],
  [62, 413.44, 23.203, starPinkIcon],
  [1276.58, 533.67, 27.422, starYellowIcon],
  [1276.02, 764.17, 25.313, starIcon],
]

// 별 SVG는 그림자 여백까지 담고 있어 실제 그림보다 약 1.58배 크다
const STAR_BLEED = 1.58

interface VoteStageProps {
  options: { optionId: string; text: string }[]
  // 내가 낸 안건 본문 — 자기 의견에는 투표할 수 없어 이 줄만 잠근다
  myText: string
  picked: string[]
  voted: boolean
  onToggle: (optionId: string) => void
  onSubmit: () => void
}

// 투표 단계 (S-07 · Figma 878:684). 왼쪽은 실시간 득표 현황, 오른쪽은 내 투표용지.
function VoteStage({ options, myText, picked, voted, onToggle, onSubmit }: VoteStageProps) {
  const round = useRoomStore((s) => s.round)!
  const progress = useRoomStore((s) => s.progress)
  const optionVotes = useRoomStore((s) => s.optionVotes)

  const config = round.config as KingmakerConfig
  const remain = useRemainMs(round.deadlineAt)
  const fullMs = useRef(0)
  if (remain > fullMs.current) fullMs.current = remain

  const alive = round.roundMembers.filter((m) => !m.departed)
  const doneCount = alive.filter((m) => progress[m.memberId] === 'COMPLETE').length

  // 득표가 많은 순으로 세우되, 같으면 서버가 준 순서를 유지한다
  const ranked = options
    .map((o) => ({ ...o, votes: optionVotes[o.optionId] ?? 0 }))
    .sort((a, b) => b.votes - a.votes)
  const [top, ...rest] = ranked
  const maxVotes = Math.max(1, top?.votes ?? 0)
  // 2위와의 표 차 — 스포트라이트 아래 한 줄에 쓴다
  const lead = (top?.votes ?? 0) - (rest[0]?.votes ?? 0)

  // 프레임의 컷오프 선은 득표한 항목과 아직 0표인 항목을 가르는 자리다
  const votedCount = rest.filter((o) => o.votes > 0).length
  const above = rest.slice(0, votedCount)
  const below = rest.slice(votedCount)

  return (
    <>
      <img className={styles.sunburst} src={sunburstIcon} alt="" />
      {VOTE_STARS.map(([x, y, size, src]) => (
        <img
          key={`${x}-${y}`}
          className={styles.voteStar}
          src={src}
          alt=""
          style={{
            left: x - (size * (STAR_BLEED - 1)) / 2,
            top: y - (size * (STAR_BLEED - 1)) / 2,
            width: size * STAR_BLEED,
            height: size * STAR_BLEED,
          }}
        />
      ))}

      <span className={styles.headPill}>
        ◷ 집계 중 · {doneCount}/{alive.length} 투표
      </span>

      {/* ── 1위 스포트라이트 ── */}
      <section className={styles.spotlight}>
        <div className={styles.spotlightMain}>
          <span className={styles.chipRow}>
            <span className={styles.chipTop}>
              <img src={crownIcon} alt="" />
              지금 1위
            </span>
            <span className={styles.chipRule}>
              1인 {config.votesPerMember}표 · 익명
            </span>
          </span>
          <h2 className={styles.topText}>{top?.text ?? '—'}</h2>
          <span className={styles.topBar}>
            <i style={{ width: `${((top?.votes ?? 0) / maxVotes) * 100}%` }} />
          </span>
          <p className={styles.topNote}>
            {(top?.votes ?? 0) === 0
              ? '🔥 아직 아무도 안 눌렀어요'
              : `🔥 2위와 ${lead === 0 ? '동점' : `${lead}표 차`} · 아직 ${alive.length - doneCount}명이 안 눌렀어요`}
          </p>
        </div>
        <span className={styles.topCount}>{top?.votes ?? 0}표</span>
      </section>

      <span className={styles.voteBadge}>
        <img src={ballotIcon} alt="" />
        VOTE!
      </span>

      {/* ── 2위 아래 순위표 ── */}
      <div className={`${styles.ranks} scroll-thin`}>
        <div className={styles.rankGroup}>
          {above.map((o, i) => (
            <RankRow key={o.optionId} rank={i + 2} option={o} maxVotes={maxVotes} />
          ))}
        </div>

        {/* 양쪽에 항목이 있을 때만 컷오프 선을 긋는다 */}
        {above.length > 0 && below.length > 0 && (
          <div className={styles.cutoff}>
            <span className={styles.cutoffLine} />
            <span className={styles.cutoffChip}>✂ 여기까지 득표 · 아래는 아직 0표</span>
          </div>
        )}

        <div className={styles.rankGroup}>
          {below.map((o, i) => (
            <RankRow
              key={o.optionId}
              rank={above.length + i + 2}
              option={o}
              maxVotes={maxVotes}
              dim
            />
          ))}
        </div>
      </div>

      {/* ── 남은 시간 바 ── */}
      <div className={styles.timerBar}>
        <h3>◷ 남은 시간</h3>
        <span className={styles.timerGroove}>
          <i style={{ width: `${fullMs.current > 0 ? (remain / fullMs.current) * 100 : 100}%` }} />
        </span>
        <b>{mmss(remain)}</b>
      </div>

      {/* ── 오른쪽 내 투표용지 ── */}
      <section className={styles.ballot}>
        <div className={styles.ballotHead}>
          <h3>🔒 내 투표</h3>
          <p>
            익명 · 1인 {config.votesPerMember}표 · 팀명 {options.length}개 중 하나
          </p>
        </div>

        <div className={`${styles.ballotList} scroll-thin`}>
          {options.map((option) => {
            const mine = myText !== '' && option.text === myText
            const selected = picked.includes(option.optionId)
            return (
              <button
                key={option.optionId}
                type="button"
                disabled={voted || mine}
                className={[
                  styles.ballotItem,
                  mine ? styles.ballotMine : '',
                  selected ? styles.ballotPicked : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onToggle(option.optionId)}
              >
                <span className={styles.ballotText}>{option.text}</span>
                {mine ? (
                  <em className={styles.ballotTag}>내 제출</em>
                ) : (
                  <i className={styles.ballotRadio}>{selected ? '✓' : ''}</i>
                )}
              </button>
            )
          })}
        </div>

        <span className={styles.ballotLock}>🔒 제출자도 투표자도 비공개</span>

        <button
          type="button"
          className={styles.ballotSubmit}
          onClick={onSubmit}
          disabled={voted || picked.length === 0}
        >
          {voted ? '✓ 투표 완료' : '✓ 투표하기'}
        </button>
      </section>

      <GameHud
        largeNote
        badge="2"
        title={round.phase === 'TIE' ? '◷ 동점! 결선 투표…' : '◷ 익명 투표 중…'}
        note={`${doneCount}/${alive.length}명 투표 완료 · 최다 득표 ${config.topic}이 우리 팀 이름으로 확정`}
        right={<HudPill raised>★ 누가 뭘 골랐는지 아무도 몰라요</HudPill>}
      />
    </>
  )
}

// 2위 이하 한 줄 — 등수 배지 · 안건 이름 · 득표 막대 · 표 수
function RankRow({
  rank,
  option,
  maxVotes,
  dim,
}: {
  rank: number
  option: { optionId: string; text: string; votes: number }
  maxVotes: number
  // 아직 0표라 흐리게 내리는 줄
  dim?: boolean
}) {
  return (
    <div className={`${styles.rankRow} ${dim ? styles.rankDim : ''}`}>
      <span className={styles.rankBadge}>{rank}</span>
      <span className={styles.rankText}>{option.text}</span>
      <span className={styles.rankBar}>
        <i style={{ width: `${Math.max(2.26, (option.votes / maxVotes) * 100)}%` }} />
        {option.votes === 0 && <em>아직 0표</em>}
      </span>
      <b className={styles.rankCount}>{option.votes}표</b>
    </div>
  )
}

// 의견 제출 단계 (S-07-1 · Figma 878:1750). 제한 시간 안에 익명으로 한 줄을 던진다.
function SubmitStage({ onSubmitted }: { onSubmitted: (text: string) => void }) {
  const round = useRoomStore((s) => s.round)!
  const me = useRoomStore((s) => s.me)
  const progress = useRoomStore((s) => s.progress)
  const sendAction = useRoomStore((s) => s.sendAction)

  const config = round.config as KingmakerConfig
  const [draft, setDraft] = useState('')

  const remain = useRemainMs(round.deadlineAt)
  // 서버가 제출 단계의 전체 길이를 따로 보내주지 않아, 이 단계에서 본 가장 큰 남은 시간을 100%로 삼는다
  const fullMs = useRef(0)
  if (remain > fullMs.current) fullMs.current = remain

  const alive = round.roundMembers.filter((m) => !m.departed)
  const doneCount = alive.filter((m) => progress[m.memberId] === 'COMPLETE').length
  const leftCount = alive.length - doneCount
  const mine = progress[me ?? ''] === 'COMPLETE'

  const submit = () => {
    const text = draft.trim()
    if (text.length === 0) return
    sendAction('king.opinion', { text })
    onSubmitted(text)
  }

  return (
    <>
      {/* 오른쪽 위 제출 현황 알약 — 공통 껍데기의 제목 줄 오른쪽 끝에 붙는다 */}
      <span className={styles.headPill}>
        <img src={lightbulbIcon} alt="" />
        {doneCount}/{alive.length} 제출 · {leftCount}명 남음
      </span>

      {/* 장식 — 프레임 좌표 그대로 */}
      <span className={styles.ideaBadge}>
        <img src={ballotIcon} alt="" />
        IDEA!
      </span>
      <img className={styles.star} src={starIcon} alt="" />

      <div className={styles.page}>
        {/* ── 섹션 제목 + 단계 배지 ── */}
        <div className={styles.sectionRow}>
          <div className={styles.sectionHead}>
            <h2>◆ 의견 내기</h2>
            <p>이번 주제에 대한 {config.topic} 아이디어를 익명으로 던지세요</p>
          </div>
          <div className={styles.steps}>
            {STEPS.map((label, i) => (
              <span
                key={label}
                className={`${styles.step} ${i === 0 ? styles.stepActive : ''}`}
                style={{ left: i * 408 }}
              >
                {label}
              </span>
            ))}
            <img className={styles.stepArrow} style={{ left: 282 }} src={stepArrowIcon} alt="" />
            <img className={styles.stepArrow} style={{ left: 687 }} src={stepArrowIcon} alt="" />
          </div>
        </div>

        {/* ── 왼쪽 보드 · 가운데 제출 카드 · 오른쪽 아이디어 덱 ── */}
        <div className={styles.mainRow}>
          <div className={styles.boards}>
            <section className={styles.board}>
              <h3>◆ 누가 냈을까?</h3>
              <p>
                {doneCount}/{alive.length} 제출 ·{' '}
                {leftCount > 0 ? `${leftCount}명만 더 내면 투표 시작` : '곧 투표가 시작돼요'}
              </p>
              <span className={styles.bar}>
                <i
                  className={styles.barFill}
                  style={{
                    width: `${(doneCount / Math.max(1, alive.length)) * 100}%`,
                    background: 'var(--color-online)',
                  }}
                />
              </span>
              <p>
                ★{' '}
                {mine
                  ? leftCount > 0
                    ? `남은 ${leftCount}명을 기다리는 중`
                    : '모두 제출 완료'
                  : `나까지 내면 ${Math.max(0, leftCount - 1)}명 남아요`}
              </p>
            </section>

            <section className={styles.board}>
              <div className={styles.boardTitleRow}>
                <h3>◷ 남은 시간</h3>
                <b>{mmss(remain)}</b>
              </div>
              <p>제한 시간 내 미제출 시 자동 기권</p>
              <span className={styles.bar}>
                <i
                  className={styles.barFill}
                  style={{
                    width: `${fullMs.current > 0 ? (remain / fullMs.current) * 100 : 100}%`,
                    background: 'var(--color-yellow)',
                  }}
                />
              </span>
              <p>★ 시간이 끝나면 투표 단계로 자동 전환</p>
            </section>
          </div>

          <section className={styles.submitCard}>
            <img className={styles.cardIcon} src={lightbulbIcon} alt="" />
            <h3 className={styles.cardTitle}>내 의견 제출</h3>
            <p className={styles.cardSub}>익명으로 등록돼요 · 제출된 {config.topic}으로 다음 단계에서 투표해요</p>
            <span className={styles.cardRule} />

            <span className={styles.topicBanner}>
              <img src={targetIcon} alt="" />
              <span>
                <em>이번 주제</em>
                <b>{config.topic}</b>
              </span>
            </span>

            <div className={styles.inputBox}>
              <textarea
                value={draft}
                maxLength={120}
                disabled={mine}
                placeholder="예) 코드 몬스터즈 — 밤새 코드 씹어먹자는 뜻 🔥"
                onChange={(e) => setDraft(e.target.value)}
              />
              <span className={styles.counter}>{draft.length} / 120자</span>
            </div>

            <span className={styles.lockLine}>🔒 누가 썼는지 아무도 몰라요 · 제출 후 수정 불가</span>

            <button
              type="button"
              className={styles.submitButton}
              onClick={submit}
              disabled={mine || draft.trim().length === 0}
            >
              <em>💡</em>
              {mine ? '제출 완료' : '아이디어 던지기'}
            </button>
          </section>

          <div className={styles.deck}>
            <div className={styles.deckHead}>
              <h3>◆ 익명 아이디어 덱</h3>
              <p>지금까지 {doneCount}개 · 누가 냈는지 아무도 몰라요</p>
            </div>

            <div className={`${styles.deckList} scroll-thin`}>
              {Array.from({ length: doneCount }, (_, i) => (
                <div
                  key={i}
                  className={styles.idea}
                  style={{ background: IDEA_TONES[i % IDEA_TONES.length] }}
                >
                  <em>🔒 익명</em>
                  {/* 제출 단계에서는 서버가 본문을 보내지 않는다 — 투표가 열릴 때 한꺼번에 공개된다 */}
                  <b>제출 완료</b>
                </div>
              ))}
              {leftCount > 0 && (
                <div className={styles.ideaEmpty}>
                  <em>❓</em>아직 {leftCount}개가 더 올 예정
                </div>
              )}
            </div>

            <span className={styles.deckFoot}>🔒 제출하면 수정할 수 없어요 · 투표는 다음 단계</span>
          </div>
        </div>
      </div>

      <GameHud
        bareBadge
        badge={<img className={styles.hudIcon} src={lightbulbIcon} alt="" />}
        title={mine ? '다른 참가자를 기다리는 중…' : `${config.topic} 모으는 중…`}
        note="익명으로 제출하세요 · 모두 내면 서바이벌 투표로 넘어가요"
        right={<HudPill tone="cyan">동점 시 동점 의견끼리 재투표</HudPill>}
      />
    </>
  )
}

