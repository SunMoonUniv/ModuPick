import { useEffect, useRef, useState } from 'react'
import type { ConfigSchema, GameConfig, GameId } from '../../../protocol/types'
import styles from './GameConfigForm.module.css'

// 자유 입력 항목에 한 번에 채워 넣을 수 있는 자주 쓰는 값. 서버 스키마에는 없는 순수 입력 편의라
// 여기(화면 쪽)에 둔다 — 값 자체는 그냥 텍스트라 서버가 알 필요가 없다.
// 사다리(ladder)의 items는 목록이지만 프리셋은 한 칸짜리 목록으로 들어간다 — 한 명만 그 역할이고 나머지는 X다.
const TEXT_PRESETS: Partial<Record<GameId, Record<string, string[]>>> = {
  roulette: { topic: ['팀장', '발표자', '당첨', '벌칙'] },
  ladder: { items: ['팀장', '발표자', '청소 당번'] },
  kingmaker: { topic: ['팀장', '발표자', '조장'] },
  snipe: { question: ['제일 늦게 올 사람은?', '오늘 발표는 누가 할까?'] },
}

interface GameConfigFormProps {
  // 프리셋 칩을 고르기 위해 어떤 게임의 설정인지 알아야 한다
  gameId: GameId
  schema: ConfigSchema
  config: GameConfig
  // 지금 방에 있는 인원수 — 목록 항목은 이 수를 넘을 수 없다(넘겨봐야 서버가 잘라낸다)
  memberCount: number
  // 방장이 아니면 값만 보여주고 조작을 막는다
  editable: boolean
  // 바뀐 필드 하나만 담아 올린다 — 호출부가 game:config로 그대로 보낸다
  onChange: (patch: Record<string, unknown>) => void
}

// 서버가 내려준 configSchema만 보고 게임 설정 UI를 그린다.
// 게임이 6종이라 화면마다 폼을 따로 만들지 않고, 필드 타입(text/enum/list)별 렌더링만 정의해둔다.
export function GameConfigForm({
  gameId,
  schema,
  config,
  memberCount,
  editable,
  onChange,
}: GameConfigFormProps) {
  const values = config as unknown as Record<string, unknown>

  return (
    <div className={[styles.form, editable ? '' : styles.readonly].filter(Boolean).join(' ')}>
      {Object.entries(schema).map(([key, field]) => (
        <div key={key} className={styles.field}>
          <span className={styles.label}>{field.label}</span>

          {field.type === 'text' && (
            <TextField
              value={String(values[key] ?? '')}
              maxLength={field.maxLength}
              presets={TEXT_PRESETS[gameId]?.[key] ?? []}
              onChange={(next) => onChange({ [key]: next })}
            />
          )}

          {field.type === 'enum' && (
            <div className={styles.chips}>
              {field.options.map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  className={
                    values[key] === option.value ? `${styles.chip} ${styles.chipOn}` : styles.chip
                  }
                  onClick={() => onChange({ [key]: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {field.type === 'list' && (
            <ListField
              items={(values[key] as string[]) ?? []}
              // 인원수보다 많은 항목은 어차피 서버가 잘라내므로 칸 자체를 못 늘리게 한다
              maxItems={Math.min(field.maxItems, memberCount)}
              itemMaxLength={field.itemMaxLength}
              presets={TEXT_PRESETS[gameId]?.[key] ?? []}
              onChange={(next) => onChange({ [key]: next })}
            />
          )}
        </div>
      ))}
    </div>
  )
}

interface TextFieldProps {
  value: string
  maxLength: number
  // 눌러서 값을 통째로 바꾸는 자주 쓰는 값. 비어 있으면 칩 줄을 그리지 않는다
  presets: string[]
  onChange: (next: string) => void
}

// 자주 쓰는 값 칩 + 자유 입력 칸. "직접 입력"을 고른 동안에만 입력 칸이 열리고, 프리셋을 고르면 잠긴다.
function TextField({ value, maxLength, presets, onChange }: TextFieldProps) {
  // 프리셋이 없는 필드는 항상 자유 입력. 처음 들어온 값이 프리셋에 없으면 직접 입력 상태로 시작한다.
  const [isCustom, setIsCustom] = useState(presets.length === 0 || !presets.includes(value))
  // 지우는 도중의 빈 칸을 담아둔다 — 서버는 빈 값을 거절하므로 화면 값과 올릴 값을 나눠야 한다
  const [draft, setDraft] = useState(value)
  // 마지막으로 내가 올린 값. 이것과 같은 값이 되돌아오는 건 내 입력의 메아리라 화면을 건드리지 않는다
  const sent = useRef(value)

  // 방장이 밖에서 바꾼 값만 따라간다 (내 입력 중에 다른 방 이벤트가 와도 치던 글자가 되돌아가지 않는다)
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value
      setDraft(value)
    }
  }, [value])

  // 빈 값은 올리지 않는다 — 서버 검증(minLength 1)에 걸려 "허용되지 않는 입력값"이 된다
  const push = (next: string) => {
    setDraft(next)
    if (next.trim()) {
      sent.current = next
      onChange(next)
    }
  }

  return (
    <>
      {presets.length > 0 && (
        <div className={styles.chips}>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={
                !isCustom && value === preset ? `${styles.chip} ${styles.chipOn}` : styles.chip
              }
              onClick={() => {
                setIsCustom(false)
                push(preset)
              }}
            >
              {preset}
            </button>
          ))}
          <button
            type="button"
            className={isCustom ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => {
              setIsCustom(true)
              // 프리셋 값이 남아 있으면 칸을 비워 바로 치게 한다. 서버 값은 새로 칠 때까지 그대로 둔다
              if (presets.includes(value)) setDraft('')
            }}
          >
            직접 입력
          </button>
        </div>
      )}
      {/* 직접 입력이 아닐 때는 회색으로 잠근 읽기 전용 칸 */}
      <div className={isCustom ? styles.textBox : `${styles.textBox} ${styles.textBoxLocked}`}>
        <input
          className={styles.textInput}
          value={isCustom ? draft : value}
          maxLength={maxLength}
          placeholder="예) 오늘 청소 당번은?"
          readOnly={!isCustom}
          tabIndex={isCustom ? undefined : -1}
          onChange={(e) => push(e.target.value)}
        />
        <span className={styles.counter}>
          {(isCustom ? draft : value).length}/{maxLength}
        </span>
      </div>
    </>
  )
}

interface ListFieldProps {
  items: string[]
  // 인원수까지만 늘릴 수 있다 — 호출부가 스키마 상한과 인원수 중 작은 값을 넘긴다
  maxItems: number
  itemMaxLength: number
  // 한 칸짜리 목록으로 들어가는 자주 쓰는 값. 비어 있으면 칩 줄을 그리지 않는다
  presets: string[]
  onChange: (next: string[]) => void
}

// 문자열 목록 편집 (사다리 도착 항목). 프리셋을 고르면 그 값 하나로 잠기고,
// "직접 입력"을 고르면 한 칸에서 시작해 "추가 입력"으로 인원수만큼 칸을 늘릴 수 있다.
function ListField({ items, maxItems, itemMaxLength, presets, onChange }: ListFieldProps) {
  const [isCustom, setIsCustom] = useState(
    presets.length === 0 || items.length !== 1 || !presets.includes(items[0]),
  )
  // 입력 중인 빈 칸은 서버가 저장하지 않으므로 칸 자체는 여기서 들고 있는다
  const [rows, setRows] = useState<string[]>(items.length > 0 ? items : [''])
  // 마지막으로 내가 올린 목록. 이것과 같은 값이 되돌아오는 건 내 입력의 메아리라 화면을 건드리지 않는다
  const sent = useRef(items.join('\n'))

  // 방장이 밖에서 바꾼 값만 따라간다 (내 입력 중에 다른 방 이벤트가 와도 치던 칸이 되돌아가지 않는다)
  useEffect(() => {
    if (items.join('\n') !== sent.current) {
      sent.current = items.join('\n')
      setRows(items.length > 0 ? items : [''])
    }
  }, [items])

  // 빈 칸을 뺀 값만 올린다 — 서버 스키마는 빈 문자열도, 빈 목록(minItems 1)도 받지 않는다.
  // 전부 비면 아무것도 올리지 않고 서버 값을 그대로 둔다 ("허용되지 않는 입력값" 응답 방지)
  const push = (next: string[]) => {
    setRows(next)
    const filled = next.map((v) => v.trim()).filter(Boolean)
    if (filled.length > 0) {
      sent.current = filled.join('\n')
      onChange(filled)
    }
  }

  const selected = presets.length > 0 && !isCustom ? (items[0] ?? '') : ''

  return (
    <>
      {presets.length > 0 && (
        <div className={styles.chips}>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={selected === preset ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              onClick={() => {
                setIsCustom(false)
                push([preset])
              }}
            >
              {preset}
            </button>
          ))}
          <button
            type="button"
            className={isCustom ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => {
              setIsCustom(true)
              // 프리셋 값이 남아 있으면 칸을 비워 바로 치게 한다. 서버 값은 새로 칠 때까지 그대로 둔다
              if (presets.includes(items[0] ?? '')) setRows([''])
            }}
          >
            직접 입력
          </button>
        </div>
      )}

      {/* 직접 입력이 아닐 때는 고른 값을 회색 읽기 전용 칸 하나로만 보여준다 */}
      {!isCustom && presets.length > 0 ? (
        <div className={`${styles.textBox} ${styles.textBoxLocked}`}>
          <input className={styles.textInput} value={selected} readOnly tabIndex={-1} />
          <span className={styles.counter}>1/{maxItems}</span>
        </div>
      ) : (
        <>
          {rows.map((row, index) => (
            <div key={index} className={styles.textBox}>
              <input
                className={styles.textInput}
                value={row}
                maxLength={itemMaxLength}
                placeholder={`항목 ${index + 1}`}
                onChange={(e) => push(rows.map((v, i) => (i === index ? e.target.value : v)))}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  className={styles.rowRemove}
                  onClick={() => push(rows.filter((_, i) => i !== index))}
                  aria-label={`항목 ${index + 1} 삭제`}
                >
                  ✕
                </button>
              )}
              <span className={styles.counter}>
                {index + 1}/{maxItems}
              </span>
            </div>
          ))}
          {rows.length < maxItems && (
            <button type="button" className={styles.addRow} onClick={() => setRows([...rows, ''])}>
              <span className={styles.addRowIcon}>+</span>
              추가 입력
            </button>
          )}
        </>
      )}
    </>
  )
}
