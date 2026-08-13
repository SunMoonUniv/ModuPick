import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, Chip, Input, ScreenFrame } from '../../components/common'
import { AvatarTile } from './AvatarTile'
import { avatarSrc } from '../../assets/avatars'
import { arrowIcon, sparkleIcon } from '../../assets/icons'
import { api } from '../../api/rest'
import { useRoomStore } from '../../store/roomStore'
import { loadSession, saveSession } from '../../store/session'
import { presentError } from '../../constants/errorMessages'
import { ApiError } from '../../protocol/types'
import type { AvatarSlot } from '../../protocol/types'
import styles from './ProfileScreen.module.css'

// 이 화면에는 아직 소켓이 없어서 아바타 선점 현황을 폴링으로 갱신한다 (API-08)
const AVATAR_POLL_MS = 3000
// 아바타 그리드 한 페이지에 놓이는 칸 수 — Figma 프레임의 5열×3행
const PAGE_SIZE = 15

// 주인공 카드 아바타 주변에 흩뿌리는 반짝임 위치. Figma 프레임(542:684)의 좌표를 그대로 옮겼다
const SPARKLES = [
  { left: 88, top: 121, size: 32 },
  { left: 535, top: 153, size: 25 },
  { left: 121, top: 311, size: 21 },
  { left: 509, top: 311, size: 27 },
]

// 닉네임·아바타·한 줄 소개를 정해 입장을 확정하는 화면 (Figma S-03 · 542:642).
// PATCH가 성공해야 active가 되고, 그 직후에만 소켓을 연결할 수 있다.
export function ProfileScreen() {
  const navigate = useNavigate()
  const connect = useRoomStore((s) => s.connect)
  const session = loadSession()

  const [nickname, setNickname] = useState('')
  const [bio, setBio] = useState('')
  const [avatarId, setAvatarId] = useState<string | null>(null)
  const [slots, setSlots] = useState<AvatarSlot[]>([])
  const [page, setPage] = useState(0)
  // 내가 몇 번째 참가자인지 — 카드의 "P6" 뱃지와 하단 안내 문구에 쓴다
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 세션 없이 이 화면에 직접 들어온 경우엔 처음부터 다시 시작하게 한다
  const hasSession = session !== null
  useEffect(() => {
    if (!hasSession) navigate('/', { replace: true })
  }, [hasSession, navigate])

  // loadSession()이 매 렌더마다 새 객체를 돌려주므로, 훅 의존성에는 값이 안 바뀌는 원시 필드만 쓴다
  const code = session?.code
  const token = session?.token

  // 다른 사람이 방금 확정한 아바타를 반영하기 위해 3초마다 다시 읽는다
  useEffect(() => {
    if (!code || !token) return
    let cancelled = false
    const load = () => {
      api
        .avatars(code, token)
        .then((res) => {
          if (!cancelled) setSlots(res.content)
        })
        .catch(() => undefined)
    }
    load()
    const id = setInterval(load, AVATAR_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [code, token])

  // 내 순번을 알려면 현재 인원이 필요한데 이 화면엔 소켓이 없어 방 조회로 한 번만 가져온다.
  // 실패해도 화면은 그대로 동작해야 하므로 순번 표시만 생략한다
  useEffect(() => {
    if (!code) return
    let cancelled = false
    api
      .lookupRoom(code)
      .then((res) => {
        if (!cancelled) setMemberCount(res.currentMembers)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [code])

  const pageCount = Math.max(1, Math.ceil(slots.length / PAGE_SIZE))
  const pageSlots = useMemo(
    () => slots.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [slots, page],
  )

  if (!session) return null

  // 남은 아바타 중 하나를 무작위로 고르고, 그 아바타가 있는 페이지로 넘겨서 선택 결과를 보여준다
  const pickRandom = () => {
    const free = slots.filter((slot) => !slot.taken)
    if (free.length === 0) return
    const picked = free[Math.floor(Math.random() * free.length)]
    setAvatarId(picked.avatarId)
    setPage(Math.floor(slots.indexOf(picked) / PAGE_SIZE))
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.confirmProfile(session.code, session.token, {
        nickname: nickname.trim(),
        avatarId,
        bio: bio.trim() || null,
      })
      // 서버가 닉네임 중복을 자동 번호로 바꿨을 수 있으므로 응답 값을 기준으로 삼는다
      const confirmed = { ...session, memberId: res.memberId, pending: false }
      saveSession(confirmed)
      connect(confirmed)
      navigate('/room', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'member.avatar_taken') {
        // 선점 경쟁에서 밀린 경우 — 선택을 풀고 다시 고르게 한다
        setAvatarId(null)
      }
      // 서버 message가 아니라 code로 문구를 고른다 — F-CMN-04 매핑(src/constants/errorMessages.ts)
      setError(e instanceof ApiError ? presentError(e.code).message : '입장하지 못했습니다.')
      setSubmitting(false)
    }
  }

  const canSubmit = nickname.trim().length >= 1 && !/\s/.test(nickname.trim()) && !submitting
  // 방 조회 전에는 순번을 모르므로 뱃지·안내 문구를 숨긴다
  const alreadyWaiting = memberCount === null ? null : Math.max(0, memberCount - 1)

  return (
    <ScreenFrame fullBleed>
      <div className={styles.screen}>
        <Chip className={styles.eyebrow} color="cyan" elevated mono>
          🎮 캐릭터 고르기
        </Chip>
        <h1 className={styles.title}>캐릭터를 골라줘!</h1>
        <p className={styles.subtitle}>
          나를 대표할 동물 캐릭터를 고르고, 닉네임 정하고, 대기방으로 입장!
        </p>
        <Button className={styles.back} variant="secondary" size="sm" pill onClick={() => navigate('/')}>
          ◀ 뒤로가기
        </Button>

        {/* ── 좌측: 지금 고른 조합을 그대로 보여주는 주인공 카드 ── */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <span className={styles.cardHeadTitle}>★ 내 캐릭터</span>
            {memberCount !== null && (
              <Chip className={styles.cardBadge} color="ink" size="sm" mono>
                P{memberCount}
              </Chip>
            )}
          </header>

          <span className={styles.glow} />
          <span className={styles.disc} />
          <img className={styles.hero} src={avatarSrc(avatarId)} alt="" draggable={false} />
          {SPARKLES.map((sparkle) => (
            <img
              key={`${sparkle.left}-${sparkle.top}`}
              className={styles.sparkle}
              src={sparkleIcon}
              alt=""
              style={{ left: sparkle.left, top: sparkle.top, width: sparkle.size, height: sparkle.size }}
            />
          ))}

          <p className={styles.cardName}>{nickname.trim() || '닉네임'}</p>
          <p className={styles.cardBio}>{bio.trim() || '한 줄 소개가 여기 보여요'}</p>
          <div className={styles.cardDivider} />
          {memberCount !== null && (
            <p className={styles.cardOrder}>🎉 오늘의 {memberCount}번째 참가자!</p>
          )}
        </section>

        <Button className={styles.enter} onClick={submit} disabled={!canSubmit}>
          ▶ {submitting ? '입장 중...' : '대기방 입장하기'}
        </Button>

        {/* 입장 실패 문구와 대기 인원 안내는 같은 자리를 쓴다 — 실패했을 때는 그쪽이 우선이다 */}
        {error ? (
          <Chip className={styles.waitingNote} color="pink" elevated>
            ⚠ {error}
          </Chip>
        ) : (
          alreadyWaiting !== null &&
          alreadyWaiting > 0 && (
            <Chip className={styles.waitingNote} color="yellow" elevated>
              🎉 팀원 {alreadyWaiting}명이 먼저 와서 기다리는 중!
            </Chip>
          )
        )}

        {/* ── 우측: 입력 필드 두 개 + 아바타 그리드 ── */}
        <div className={styles.nicknameField}>
          <Input
            label="● 닉네임 (필수)"
            tone="purple"
            accent="yellow"
            strong
            value={nickname}
            maxLength={8}
            placeholder="공백 없이 1~8자"
            // 실패 문구는 입장 버튼 아래에 따로 띄우므로 여기서는 핑크 배경으로 실패 상태만 알린다
            invalid={error !== null}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <div className={styles.bioField}>
          <Input
            label="○ 한 줄 소개 (선택)"
            tone="purple"
            accent="cyan"
            value={bio}
            maxLength={24}
            placeholder="예: 오늘은 발표하기 싫어요"
            onChange={(e) => setBio(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && canSubmit) submit()
            }}
          />
        </div>

        <h2 className={styles.gridTitle}>◆ 아바타 고르기</h2>
        <p className={styles.gridNote}>{slots.length}종 중 하나 · 선택된 캐릭터는 잠겨요</p>
        <Button className={styles.random} variant="danger" size="sm" pill onClick={pickRandom}>
          <span>🎲</span>
          <span className={styles.randomLabel}>랜덤 뽑기</span>
        </Button>

        <button
          type="button"
          className={`${styles.pager} ${styles.pagerPrev}`}
          onClick={() => setPage((p) => (p - 1 + pageCount) % pageCount)}
          disabled={pageCount < 2}
          aria-label="이전 아바타 페이지"
        >
          <img src={arrowIcon} alt="" />
        </button>
        <button
          type="button"
          className={`${styles.pager} ${styles.pagerNext}`}
          onClick={() => setPage((p) => (p + 1) % pageCount)}
          disabled={pageCount < 2}
          aria-label="다음 아바타 페이지"
        >
          <img src={arrowIcon} alt="" />
        </button>

        <div className={styles.grid}>
          {pageSlots.map((slot) => (
            <AvatarTile
              key={slot.avatarId}
              avatarId={slot.avatarId}
              taken={slot.taken}
              takenBy={slot.takenBy}
              selected={avatarId === slot.avatarId}
              onSelect={() => setAvatarId(slot.avatarId)}
            />
          ))}
        </div>
      </div>
    </ScreenFrame>
  )
}
