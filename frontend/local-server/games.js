// 게임 6종의 메타데이터·설정 스키마·기본값 정본.
// 명세상 "기본값 정본은 서버"이므로 클라이언트는 이 값을 GET /api/games로 받아 설정 UI를 그린다 — 프론트에 같은 값을 복사해두지 말 것.

export const GAMES = {
  roulette: {
    gameId: 'roulette',
    name: '운명의 룰렛',
    tagline: '한 명만 무작위로 뽑아요',
    minMembers: 2,
    maxMembers: 10,
    guide: [
      '참가자 전원이 균등한 확률로 룰렛 조각에 배치됩니다.',
      '방장이 PICK을 누르면 전원 화면에서 같은 룰렛이 돌아갑니다.',
      '당첨자는 서버가 미리 정하며, 회전 애니메이션은 연출입니다.',
    ],
    configSchema: {
      topic: { type: 'text', label: '뽑을 항목', minLength: 1, maxLength: 12, default: '팀장' },
    },
  },

  ladder: {
    gameId: 'ladder',
    name: '랜덤 사다리',
    tagline: '전원에게 역할을 한 번에 배분해요',
    minMembers: 2,
    maxMembers: 10,
    guide: [
      '위쪽에 참가자, 아래쪽에 결과 항목이 배치됩니다.',
      '방장이 시작하면 서버가 확정한 사다리를 전원이 같이 내려갑니다.',
      '항목이 인원보다 적으면 남는 자리는 X로 채워집니다.',
    ],
    configSchema: {
      // 사다리는 주제가 곧 도착 항목이다 — "팀장"만 넣으면 한 명만 팀장이고 나머지는 X가 된다.
      items: {
        type: 'list',
        label: '주제 (도착 항목)',
        minItems: 1,
        maxItems: 10,
        itemMaxLength: 12,
        default: ['팀장'],
      },
      speed: {
        type: 'enum',
        label: '진행 속도',
        options: [
          { value: 'fast', label: '빠르게' },
          { value: 'normal', label: '보통' },
          { value: 'slow', label: '느리게' },
        ],
        default: 'normal',
      },
    },
  },

  kingmaker: {
    gameId: 'kingmaker',
    name: '킹메이커',
    tagline: '익명으로 낸 의견 중 하나를 투표로 정해요',
    minMembers: 3,
    maxMembers: 10,
    guide: [
      '주제에 맞는 의견을 2분 안에 익명으로 제출합니다 (120자).',
      '제출된 의견은 작성자를 가린 채 공개되고, 1분 동안 투표합니다.',
      '자기 의견에는 투표할 수 없고, 동점이면 동점 후보끼리 결선 투표합니다.',
    ],
    configSchema: {
      topic: { type: 'text', label: '주제', minLength: 1, maxLength: 12, default: '팀명' },
      votesPerMember: {
        type: 'enum',
        label: '1인당 투표 수',
        options: [
          { value: 1, label: '1표' },
          { value: 2, label: '2표' },
          { value: 3, label: '3표' },
        ],
        default: 1,
      },
      revealAuthors: {
        type: 'enum',
        label: '제시자 공개',
        options: [
          { value: false, label: '익명' },
          { value: true, label: '실명' },
        ],
        default: false,
      },
    },
  },

  timer: {
    gameId: 'timer',
    name: '시간초 잡기',
    tagline: '목표 시간에 가장 가깝게 멈춰요',
    minMembers: 2,
    maxMembers: 10,
    guide: [
      'START를 누르면 각자의 타이머가 돌아갑니다.',
      '숫자는 2초까지만 보이고 그 뒤로는 감춰집니다 — 감으로 STOP을 누르세요.',
      'STOP은 한 번만 유효하고, 판정은 서버가 잰 밀리초 기준입니다.',
    ],
    configSchema: {
      topic: { type: 'text', label: '뽑을 항목', minLength: 1, maxLength: 12, default: '팀장' },
      targetMs: {
        type: 'enum',
        label: '목표 시간',
        options: [
          { value: 5000, label: '5초' },
          { value: 7000, label: '7초' },
          { value: 10000, label: '10초' },
        ],
        default: 5000,
      },
      winnerRule: {
        type: 'enum',
        label: '기준',
        options: [
          { value: 'closest', label: '오차 최소' },
          { value: 'farthest', label: '오차 최대' },
        ],
        default: 'closest',
      },
    },
  },

  snipe: {
    gameId: 'snipe',
    name: '익명 저격',
    tagline: '질문에 어울리는 사람을 몰래 지목해요',
    minMembers: 3,
    maxMembers: 10,
    guide: [
      '질문이 공개되면 제한시간 안에 어울리는 사람을 지목합니다.',
      '자기 자신은 지목할 수 없고, 누가 찍었는지는 설정에 따라 공개됩니다.',
      '가장 많이 지목된 사람이 당첨되며, 동점이면 방장이 재투표를 고를 수 있습니다.',
    ],
    configSchema: {
      topic: {
        type: 'text',
        label: '질문',
        minLength: 1,
        maxLength: 30,
        default: '발표를 제일 잘할 것 같은 사람은?',
      },
      voteSeconds: {
        type: 'enum',
        label: '투표 시간',
        options: [
          { value: 10, label: '10초' },
          { value: 20, label: '20초' },
          { value: 30, label: '30초' },
          { value: 60, label: '60초' },
        ],
        default: 10,
      },
      allowMultipleTargets: {
        type: 'enum',
        label: '중복 지목',
        options: [
          { value: false, label: '1명만' },
          { value: true, label: '여러 명' },
        ],
        default: false,
      },
      revealVoters: {
        type: 'enum',
        label: '투표자 공개',
        options: [
          { value: false, label: '익명' },
          { value: true, label: '실명' },
        ],
        default: false,
      },
    },
  },

  nunchi: {
    gameId: 'nunchi',
    name: '눈치게임',
    tagline: '혼자 UP을 눌러야 살아남아요',
    minMembers: 3,
    maxMembers: 10,
    guide: [
      '제한시간 안에 UP을 한 번 누릅니다.',
      '판정 시간 안에 두 명 이상이 겹치면 그 인원이 한꺼번에 탈락합니다.',
      '아무도 겹치지 않으면 마지막까지 남은 한 명이 탈락합니다.',
    ],
    configSchema: {
      topic: { type: 'text', label: '뽑을 항목', minLength: 1, maxLength: 12, default: '팀장' },
      decisionWindowMs: {
        type: 'enum',
        label: '동시 입력 판정',
        options: [
          { value: 300, label: '0.3초 (기본)' },
          { value: 500, label: '0.5초 (하드)' },
        ],
        default: 300,
      },
      subRoundTimeoutMs: {
        type: 'enum',
        label: '라운드 제한시간',
        options: [
          { value: 10000, label: '10초' },
          { value: 15000, label: '15초' },
          { value: 20000, label: '20초' },
        ],
        default: 15000,
      },
    },
  },
}

export const GAME_IDS = Object.keys(GAMES)

// 스키마의 default만 뽑아 새 config 객체를 만든다 — 게임을 바꾸면 이전 설정을 버리고 항상 이걸로 초기화한다
export function defaultConfig(gameId) {
  const schema = GAMES[gameId].configSchema
  const config = {}
  for (const [key, field] of Object.entries(schema)) {
    config[key] = Array.isArray(field.default) ? [...field.default] : field.default
  }
  return config
}

// 클라이언트가 보낸 부분 config를 스키마에 맞게 검증·정규화한다. 허용 범위를 벗어나면 null을 돌려 INVALID_CONFIG로 거절한다.
export function mergeConfig(gameId, current, patch) {
  const schema = GAMES[gameId].configSchema
  const next = { ...current }
  for (const [key, raw] of Object.entries(patch ?? {})) {
    const field = schema[key]
    if (!field) return null
    if (field.type === 'text') {
      if (typeof raw !== 'string') return null
      const text = raw.trim()
      if (text.length < field.minLength || text.length > field.maxLength) return null
      next[key] = text
    } else if (field.type === 'enum') {
      if (!field.options.some((o) => o.value === raw)) return null
      next[key] = raw
    } else if (field.type === 'list') {
      if (!Array.isArray(raw)) return null
      const items = raw.map((v) => String(v).trim()).filter((v) => v.length > 0)
      if (items.length < field.minItems || items.length > field.maxItems) return null
      if (items.some((v) => v.length > field.itemMaxLength)) return null
      next[key] = items
    }
  }
  return next
}
