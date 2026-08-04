import type { GameId, GameSettings } from "./types";

/* ---------- 퍼슨 컬러 (시트 06·07 멤버 로스터/레인 컬러) ---------- */
export const PERSON_COLORS = [
  "#FF4FD4", // 핑크 · 지호
  "#FFE23E", // 옐로 · 서연
  "#57EBFA", // 시안 · 민준
  "#46E08A", // 그린 · 하늘
  "#C9B8FF", // 라벤더 · 도윤
  "#FF8A3D", // 오렌지 · 유진
  "#FF6B6B",
  "#7DF0C0",
  "#8AB4FF",
  "#FFC24B",
];

/** 파스텔 변환: person × 0.30 + white × 0.70 (Safe Band 칩 규격) */
export function pastel(hex: string, ratio = 0.3): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * ratio + 255 * (1 - ratio));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/* ---------- 아바타 30종 — Figma 캐릭터 에셋 + 타일 캔디색 (542:5737 / 542:642) ---------- */
export interface AvatarSpec {
  id: number;
  name: string;
  tile: string; // 미선택 타일 배경색 (레이어 실측 + 팔레트 보간)
}
const AVATAR_DEFS: [string, string][] = [
  ["우주 코기", "#FFE23E"],
  ["나무늘보 킹", "#FFC780"],
  ["게이머 캣", "#FF8C8C"],
  ["하이에나", "#80EBBF"],
  ["알파카 디바", "#FFC780"],
  ["레서판다 도둑", "#772727"],
  ["안전요원 악어", "#CCF26B"],
  ["고블린 샤크", "#B899FF"],
  ["문어 박사", "#FF4FD4"],
  ["펑크 염소", "#73E5E5"],
  ["셰프 카우", "#007AFF"],
  ["스피드 토끼", "#FF8C8C"],
  ["레슬러 햄스터", "#F5E4A0"],
  ["DJ 펭귄", "#80BFFF"],
  ["정비공 오리너구리", "#73E5E5"],
  ["복서 크랩", "#FF8C8C"],
  ["카피바라", "#F5E4A0"],
  ["탐정 오리", "#CCF26B"],
  ["복어", "#FFE23E"],
  ["비둘기 부장", "#80BFFF"],
  ["해커 너구리", "#B899FF"],
  ["두더지쥐", "#FFC780"],
  ["부엉이 교수", "#80EBBF"],
  ["택배 달팽이", "#FFE23E"],
  ["광대 물범", "#80BFFF"],
  ["마법사 카멜레온", "#CCF26B"],
  ["바이커 멧돼지", "#FF8C8C"],
  ["아홀로틀", "#FF4FD4"],
  ["박쥐", "#B899FF"],
  ["코미디언 개구리", "#73E5E5"],
];
export const AVATARS: AvatarSpec[] = AVATAR_DEFS.map(([name, tile], i) => ({
  id: i,
  name,
  tile,
}));

/* ---------- 봇 참가자 (시트 04 · 참가자 6인 고정) ---------- */
export interface BotSpec {
  id: string;
  nick: string;
  handle: string;
  role: string;
  avatarId: number;
  colorIdx: number;
}
/* Figma 로스터 매핑: 서연=나무늘보 · 민준=염소 · 하늘=토끼 · 도윤=레서판다 · 유진=두더지쥐 */
export const BOTS: BotSpec[] = [
  {
    id: "seoyeon",
    nick: "서연",
    handle: "frontend",
    role: "react",
    avatarId: 1,
    colorIdx: 1,
  },
  {
    id: "minjun",
    nick: "민준",
    handle: "@minjun_dev",
    role: "PPT",
    avatarId: 9,
    colorIdx: 2,
  },
  {
    id: "haneul",
    nick: "하늘",
    handle: "backend",
    role: "fastapi",
    avatarId: 11,
    colorIdx: 3,
  },
  {
    id: "doyun",
    nick: "도윤",
    handle: "design",
    role: "figma",
    avatarId: 5,
    colorIdx: 4,
  },
  {
    id: "yujin",
    nick: "유진",
    handle: "@yujin",
    role: "qa",
    avatarId: 21,
    colorIdx: 5,
  },
];
export const ME_ID = "me";

/* ---------- 게임 메타 (시트 01·04) ---------- */
export interface GameMeta {
  id: GameId;
  no: string;
  icon: string;
  name: string;
  en: string;
  /** 대기방 게임 카드 부제 (레이어 542:422) */
  sub: string;
  /** 표지 슬라이더 부제 (레이어 542:195) */
  sliderSub: string;
  /** 아이콘 사각 틴트 (레이어 542:422) */
  tint: string;
  minPlayers: number;
  variant: "winner" | "assign" | "tally" | "record";
}
export const GAMES: GameMeta[] = [
  {
    id: "roulette",
    no: "GAME 01",
    icon: "🎡",
    name: "운명의 룰렛",
    en: "WHEEL OF FATE",
    sub: "팀장·발표자 랜덤",
    sliderSub: "돌려서 팀장 한 방에",
    tint: "#FF6B3E",
    minPlayers: 2,
    variant: "winner",
  },
  {
    id: "ladder",
    no: "GAME 02",
    icon: "🪜",
    name: "랜덤 사다리",
    en: "LADDER PICK",
    sub: "역할 한 번에 배분",
    sliderSub: "역할을 한 번에 배분",
    tint: "#57EBFA",
    minPlayers: 2,
    variant: "assign",
  },
  {
    id: "kingmaker",
    no: "GAME 03",
    icon: "👑",
    name: "킹메이커",
    en: "KINGMAKER",
    sub: "익명 투표로 선정",
    sliderSub: "익명 투표로 1인 선정",
    tint: "#FFE23E",
    minPlayers: 3,
    variant: "tally",
  },
  {
    id: "timer",
    no: "GAME 04",
    icon: "💣",
    name: "시간초 잡기",
    en: "TIME CATCH",
    sub: "폭탄 돌리기 서바이벌",
    sliderSub: "목표 시간에 딱 멈추기",
    tint: "#29DB78",
    minPlayers: 2,
    variant: "winner",
  },
  {
    id: "snipe",
    no: "GAME 05",
    icon: "🎯",
    name: "익명 저격",
    en: "SNIPER",
    sub: "익명 지목 투표",
    sliderSub: "10초 안에 익명 지목",
    tint: "#FFB041",
    minPlayers: 3,
    variant: "winner",
  },
  {
    id: "nunchi",
    no: "GAME 06",
    icon: "👀",
    name: "눈치게임",
    en: "SENSE GAME",
    sub: "UP! 최후의 1인",
    sliderSub: "동시에 누르면 탈락",
    tint: "#B899FF",
    minPlayers: 3,
    variant: "record",
  },
];
export const gameMeta = (id: GameId): GameMeta =>
  GAMES.find((g) => g.id === id)!;

/* ---------- 설정 기본값 + 프리셋 (§6.1 C-05) ---------- */
export const TOPIC_PRESETS: Record<GameId, string[]> = {
  roulette: ["팀장", "발표자", "당첨", "벌칙"],
  ladder: ["역할 분담", "청소 구역", "벌칙"],
  kingmaker: ["팀장", "주제 발표", "의제", "팀명", "당번"],
  timer: ["팀장", "발표자", "벌칙"],
  snipe: [],
  nunchi: ["팀장", "벌칙", "커피 셔틀"],
};
export const SNIPER_PRESETS = [
  "숨겨진 PPT 장인 관상은?",
  "발표를 가장 잘할 것 같은 사람은?",
  "가장 먼저 지각할 것 같은 사람은?",
];

export function defaultSettings(game: GameId): GameSettings {
  return {
    topic: TOPIC_PRESETS[game][0] ?? "팀장",
    // 시안(542:935) 하단 역할칩 6종 — 참가자 수만큼만 배정된다
    // 정본의 조별과제 세트(05_game_rules/01_common.md) — 마지막은 총무가 아니라 최종 정리다
    ladderRoles: ["팀장", "자료 조사", "PPT 제작", "발표", "디자인", "최종 정리"],
    ladderSpeed: "보통",
    kmVotes: 1,
    kmReveal: "익명",
    tcTarget: 5,
    tcCriteria: "오차가 적은 사람",
    snQuestion: SNIPER_PRESETS[0],
    snDup: "불가",
    snTime: 10,
    snReveal: "비공개",
    nzWindow: 0.3,
    nzRound: 15,
  };
}

/* ---------- 게임 가이드 (C-01 · 시트 05) ---------- */
export interface GuideSpec {
  oneLiner: string;
  steps: { title: string; desc: string }[];
  tip: string;
}
export const GUIDES: Record<GameId, GuideSpec> = {
  roulette: {
    oneLiner: "주제를 확인하고 룰렛을 지켜보세요",
    steps: [
      {
        title: "주제 확인하기",
        desc: "무엇을 뽑는 룰렛인지 상단에서 확인해요",
      },
      { title: "룰렛 확인하기", desc: "전원이 같은 확률의 조각으로 배치돼요" },
      { title: "결과 확인하기", desc: "방장이 돌리면 3~5초 뒤 한 명이 뽑혀요" },
    ],
    tip: "결과는 서버에서 정해지고 모두에게 똑같이 보여요",
  },
  ladder: {
    oneLiner: "내 세로선이 어디에 도착하는지 지켜보세요",
    steps: [
      {
        title: "참가자·역할 확인",
        desc: "위는 참가자, 아래는 방장이 정한 역할이에요",
      },
      { title: "경로 추적", desc: "가로선을 만나면 무조건 꺾어서 내려가요" },
      { title: "매칭 확정", desc: "도착한 순서대로 역할이 확정돼요" },
    ],
    tip: "사다리 구조는 서버가 만들고 전원에게 동일해요",
  },
  kingmaker: {
    oneLiner: "아이디어를 익명으로 던지고, 표로 결정해요",
    steps: [
      { title: "의견 제출", desc: "주제에 맞는 아이디어를 익명으로 제출해요" },
      { title: "서바이벌 투표", desc: "내 의견을 뺀 후보에 투표해요" },
      { title: "팀명 확정", desc: "최다 득표가 그대로 확정돼요" },
    ],
    tip: "투표하는 동안엔 누가 냈는지 아무도 몰라요",
  },
  timer: {
    oneLiner: "감으로 목표 시간에 맞춰 STOP을 누르세요",
    steps: [
      { title: "START", desc: "내 타이머는 내가 눌러야 시작돼요" },
      { title: "2초 뒤 블라인드", desc: "2초까지만 보이고 그 뒤엔 가려져요" },
      { title: "STOP 1회", desc: "단 한 번, 되돌릴 수 없어요" },
      { title: "오차 비교", desc: "목표와의 오차로 순위를 정해요" },
    ],
    tip: "판정은 화면이 아니라 서버 시각 기준이에요",
  },
  snipe: {
    oneLiner: "질문에 가장 어울리는 사람을 몰래 지목하세요",
    steps: [
      { title: "질문 확인", desc: "상단 질문을 읽고 후보를 살펴봐요" },
      { title: "조준·발사", desc: "한 명을 골라 발사! 나는 지목할 수 없어요" },
      { title: "최다 피격", desc: "가장 많이 지목된 사람이 당첨돼요" },
    ],
    tip: "누가 누구를 지목했는지는 끝까지 비공개예요",
  },
  nunchi: {
    oneLiner: "타이밍을 살피다가 혼자일 때 UP을 누르세요",
    steps: [
      { title: "타이밍 살피기", desc: "15초 안에 한 번만 누를 수 있어요" },
      {
        title: "겹치지 않게 누르기",
        desc: "판정 시간 안에 겹치면 둘 다 탈락!",
      },
    ],
    tip: "서버 도착 시각 기준이라 네트워크와 무관하게 공정해요",
  },
};

/* ---------- 표지 데모용 더미 참가자 (US-109) ---------- */
export const DEMO_ROSTER = ["지호", "서연", "민준", "하늘", "도윤", "유진"];

/* ---------- 대기방 봇 채팅 스크립트 ---------- */
export const BOT_CHAT: { botIdx: number; text: string; delay: number }[] = [
  { botIdx: 0, text: "안녕하세요!! 다들 반가워요 👋", delay: 2600 },
  { botIdx: 2, text: "팀장 뽑는 거죠? 저는 아니길…", delay: 5200 },
  { botIdx: 1, text: "ㅋㅋㅋ 다들 눈치 보는 중", delay: 7600 },
  { botIdx: 3, text: "공정하게 게임으로 정해요!", delay: 9800 },
  { botIdx: 4, text: "준비 눌렀습니다 🔥", delay: 12600 },
];

export const nowTime = () =>
  new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
