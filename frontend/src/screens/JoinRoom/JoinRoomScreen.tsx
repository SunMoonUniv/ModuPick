import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, Card, Input, ScreenFrame } from '../../components/common'
import { api, normalizeCode, toDisplayCode } from '../../api/rest'
import { saveSession } from '../../store/session'
import { presentError } from '../../constants/errorMessages'
import { ApiError } from '../../protocol/types'
import type { RoomLookupResponse } from '../../protocol/types'
import styles from './JoinRoomScreen.module.css'

// 방 코드로 들어가는 화면. 6자리를 다 입력하면 자동으로 조회해서 들어갈 수 있는 방인지 먼저 확인한다.
export function JoinRoomScreen() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<RoomLookupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 6자리가 채워지는 순간 조회 — 버튼을 한 번 더 누르게 하지 않는다
  useEffect(() => {
    setPreview(null)
    setError(null)
    if (code.length !== 6) return
    let cancelled = false
    api
      .lookupRoom(code)
      .then((res) => {
        if (!cancelled) setPreview(res)
      })
      .catch((e) => {
        // 서버 message가 아니라 code로 문구를 고른다 — F-CMN-04 매핑(src/constants/errorMessages.ts)
        if (!cancelled) setError(e instanceof ApiError ? presentError(e.code).message : '방을 찾을 수 없습니다.')
      })
    return () => {
      cancelled = true
    }
  }, [code])

  const submit = async () => {
    if (!preview) return
    setSubmitting(true)
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
      setSubmitting(false)
    }
  }

  return (
    <ScreenFrame centered>
      <Card className={styles.panel}>
        <h1 className={styles.title}>코드로 입장</h1>
        <p className={styles.description}>방장이 알려준 6자리 코드를 입력해주세요.</p>

        <Input
          codeStyle
          value={code}
          maxLength={6}
          inputMode="numeric"
          placeholder="000000"
          leading={<span className={styles.prefix}>MODU-</span>}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          }}
        />

        {preview && (
          <div className={styles.preview}>
            <span className={styles.previewName}>{preview.roomName}</span>
            <span className={styles.previewMeta}>
              방장 {preview.hostNickname || '(입장 중)'} · {preview.currentMembers}/
              {preview.maxMembers}명
            </span>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <Button size="lg" onClick={submit} disabled={!preview || submitting}>
            {submitting ? '입장 중...' : '입장하기'}
          </Button>
          <Button size="lg" variant="ghost" onClick={() => navigate('/')}>
            뒤로
          </Button>
        </div>
      </Card>
    </ScreenFrame>
  )
}
