import { useState } from 'react'
import type { ConfigSchema, GameConfig, GameId } from '../../../protocol/types'
import styles from './GameConfigForm.module.css'

// 자유 입력 항목에 한 번에 채워 넣을 수 있는 자주 쓰는 값. 서버 스키마에는 없는 순수 입력 편의라
// 여기(화면 쪽)에 둔다 — 값 자체는 그냥 텍스트라 서버가 알 필요가 없다.
const TEXT_PRESETS: Partial<Record<GameId, Record<string, string[]>>> = {
  roulette: { topic: ['팀장', '발표자', '당첨', '벌칙'] },
  ladder: { topic: ['조별과제', '역할 분담', '청소 당번'] },
  kingmaker: { topic: ['팀장', '발표자', '조장'] },
  snipe: { question: ['제일 늦게 올 사람은?', '오늘 발표는 누가 할까?'] },
}

interface GameConfigFormProps {
  // 프리셋 칩을 고르기 위해 어떤 게임의 설정인지 알아야 한다
  gameId: GameId
  schema: ConfigSchema
  config: GameConfig
  // 방장이 아니면 값만 보여주고 조작을 막는다
  editable: boolean
  // 바뀐 필드 하나만 담아 올린다 — 호출부가 game:config로 그대로 보낸다
  onChange: (patch: Record<string, unknown>) => void
}

// 서버가 내려준 configSchema만 보고 게임 설정 UI를 그린다.
// 게임이 6종이라 화면마다 폼을 따로 만들지 않고, 필드 타입(text/enum/list)별 렌더링만 정의해둔다.
export function GameConfigForm({ gameId, schema, config, editable, onChange }: GameConfigFormProps) {
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
              maxItems={field.maxItems}
              minItems={field.minItems}
              itemMaxLength={field.itemMaxLength}
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

// 자주 쓰는 값 칩 + 자유 입력 칸. 프리셋에 없는 값을 치면 "직접 입력" 칩이 켜진 상태가 된다.
function TextField({ value, maxLength, presets, onChange }: TextFieldProps) {
  const isCustom = presets.length > 0 && !presets.includes(value)

  return (
    <>
      {presets.length > 0 && (
        <div className={styles.chips}>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={value === preset ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              onClick={() => onChange(preset)}
            >
              {preset}
            </button>
          ))}
          <span className={isCustom ? `${styles.chip} ${styles.chipOn}` : styles.chip}>
            직접 입력
          </span>
        </div>
      )}
      <div className={styles.textBox}>
        <input
          className={styles.textInput}
          value={value}
          maxLength={maxLength}
          placeholder="예) 오늘 청소 당번은?"
          onChange={(e) => onChange(e.target.value)}
        />
        <span className={styles.counter}>
          {value.length}/{maxLength}
        </span>
      </div>
    </>
  )
}

interface ListFieldProps {
  items: string[]
  minItems: number
  maxItems: number
  itemMaxLength: number
  onChange: (next: string[]) => void
}

// 문자열 목록 편집 (사다리 결과 항목). 최소 개수 아래로는 지울 수 없다.
function ListField({ items, minItems, maxItems, itemMaxLength, onChange }: ListFieldProps) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const value = draft.trim()
    if (value.length === 0 || items.length >= maxItems) return
    onChange([...items, value])
    setDraft('')
  }

  return (
    <>
      <div className={styles.chips}>
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className={styles.chip}>
            {item}
            {items.length > minItems && (
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                aria-label={`${item} 삭제`}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      <div className={styles.textBox}>
        <input
          className={styles.textInput}
          value={draft}
          maxLength={itemMaxLength}
          placeholder={items.length >= maxItems ? `최대 ${maxItems}개까지예요` : '항목을 적고 Enter'}
          disabled={items.length >= maxItems}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) add()
          }}
        />
        <span className={styles.counter}>
          {items.length}/{maxItems}
        </span>
      </div>
    </>
  )
}
