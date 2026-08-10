// 게임별 화면 표현용 값. 이름·설명·설정 스키마는 서버(GET /api/games)가 정본이고,
// 여기에는 서버가 알 필요 없는 시각 표현(아이콘 이미지·아이콘 타일 배경색)만 둔다.

import type { GameId } from '../protocol/types'
import kingmakerIcon from '../assets/games/kingmaker.png'
import ladderIcon from '../assets/games/ladder.png'
import nunchiIcon from '../assets/games/nunchi.png'
import rouletteIcon from '../assets/games/roulette.png'
import snipeIcon from '../assets/games/snipe.png'
import timerIcon from '../assets/games/timer.png'

// 게임 카드 왼쪽 타일에 얹는 아이콘 이미지 (Figma에서 내려받은 투명 배경 PNG)
export const GAME_ICONS: Record<GameId, string> = {
  roulette: rouletteIcon,
  ladder: ladderIcon,
  kingmaker: kingmakerIcon,
  timer: timerIcon,
  snipe: snipeIcon,
  nunchi: nunchiIcon,
}

// 인게임 화면 제목 옆에 붙는 영문 부제 — 프레임에만 있는 문구라 서버가 알지 못한다
export const GAME_SUBTITLES: Record<GameId, string> = {
  roulette: 'WHEEL OF FATE',
  ladder: 'LADDER PICK',
  kingmaker: 'KING MAKER',
  timer: 'TIMER STOP',
  snipe: 'SNIPER',
  nunchi: 'SENSE GAME',
}

// 제목 아래 시안색 한 줄에서 방 코드 앞에 붙는 설명. 프레임이 게임마다 다른 문구를 쓰는 경우만 적고,
// 없는 게임은 GameScreen이 기본 문구("실시간 진행")를 쓴다.
export const GAME_META_LINES: Partial<Record<GameId, string>> = {
  kingmaker: '익명 브레인스토밍 · 아이디어 제출 → 서바이벌 투표',
  snipe: '익명 지목 투표',
}

// 아이콘 타일의 배경색 — 6종이 서로 구분되도록 토큰에서 골라 배정한다
export const GAME_ACCENTS: Record<GameId, string> = {
  roulette: 'var(--color-game-roulette)',
  ladder: 'var(--color-game-ladder)',
  kingmaker: 'var(--color-game-kingmaker)',
  timer: 'var(--color-game-timer)',
  snipe: 'var(--color-game-snipe)',
  nunchi: 'var(--color-game-nunchi)',
}
