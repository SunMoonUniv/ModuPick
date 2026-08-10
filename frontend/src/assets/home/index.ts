// 표지(홈) 화면 전용 벡터 에셋. Figma 542:195에서 내려받았고, 원과 선처럼 CSS로 그릴 수 있는 도형은
// 파일로 두지 않았다 — 여기 있는 건 CSS로는 못 그리는 파이 조각·별빛·삼각형·아이콘뿐이다.

// 룰렛 파이 조각 6개. 시계 방향이 아니라 조각마다 원 안의 고정 위치가 정해져 있다 (CSS에서 배치)
export { default as slice1 } from './slice-1.svg'
export { default as slice2 } from './slice-2.svg'
export { default as slice3 } from './slice-3.svg'
export { default as slice4 } from './slice-4.svg'
export { default as slice5 } from './slice-5.svg'
export { default as slice6 } from './slice-6.svg'

// 룰렛 뒤에 깔리는 별빛 두 겹. B가 더 크고 흐리며 A가 그 위에 겹친다
export { default as sunburstA } from './sunburst-a.svg'
export { default as sunburstB } from './sunburst-b.svg'

// 룰렛 위에서 당첨 조각을 가리키는 아래쪽 삼각형
export { default as pointer } from './pointer.svg'

// 게임 카드 오른쪽 아래 장식 아이콘 — 원·사각형으로 되는 게임은 CSS로 그려서 파일이 없다
export { default as iconRouletteA } from './icon-roulette-a.svg'
export { default as iconRouletteB } from './icon-roulette-b.svg'
export { default as iconKingmaker } from './icon-kingmaker.svg'
export { default as iconNunchi } from './icon-nunchi.svg'
