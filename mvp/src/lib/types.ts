export type Screen =
  "landing" | "create" | "profile" | "lobby" | "game" | "result";

export type GameId =
  "roulette" | "ladder" | "kingmaker" | "timecatch" | "sniper" | "nunchi";

export interface Member {
  id: string;
  nick: string;
  handle: string;
  role: string;
  avatarId: number;
  color: string;
  isHost: boolean;
  isMe: boolean;
  ready: boolean;
  online: boolean;
}

export interface ChatMsg {
  id: number;
  kind: "mine" | "other" | "system";
  senderId?: string;
  text: string;
  time: string;
}

/** 게임별 설정 (C-05) — 게임 교체 시 기본값으로 초기화 */
export interface GameSettings {
  /** 공통 · 무엇을 정할까? (표시용 라벨, D-24) */
  topic: string;
  /** 사다리 · 결과 항목 (최소 1 ~ 참가자 수) */
  ladderRoles: string[];
  /** 사다리 · 진행 속도 */
  ladderSpeed: "빠르게" | "보통" | "느리게";
  /** 킹메이커 · 1인당 투표 횟수 */
  kmVotes: number;
  /** 킹메이커 · 결과 익명/실명 */
  kmReveal: "익명" | "실명";
  /** 시간초 · 목표 시간(초) */
  tcTarget: 5 | 7 | 10;
  /** 시간초 · 당첨 기준 */
  tcCriteria: "오차가 적은 사람" | "오차가 큰 사람";
  /** 익명 저격 · 질문 */
  snQuestion: string;
  /** 익명 저격 · 중복 투표 */
  snDup: "불가" | "가능";
  /** 익명 저격 · 투표 시간(초) */
  snTime: number;
  /** 눈치 · 동시 판정 시간 */
  nzWindow: 0.3 | 0.5;
}

/* ---------- 결과 (시트 12 · 4변형) ---------- */

/** 승자형 — 룰렛·저격·시간초 */
export interface WinnerResult {
  variant: "winner";
  game: GameId;
  winnerId: string;
  /** [게임]·[목적] 당첨 pill 문구 */
  purpose: string;
  stats: { label: string; value: string }[];
  /** Safe Band 멤버 칩 (비껴간 사람) */
  safe: { id: string; note: string }[];
}

/** 배정형 — 사다리 */
export interface AssignResult {
  variant: "assign";
  game: "ladder";
  purpose: string;
  pairs: { id: string; roleLabel: string }[];
  stats: { label: string; value: string }[];
}

/** 개표형 — 킹메이커 */
export interface TallyResult {
  variant: "tally";
  game: "kingmaker";
  purpose: string;
  winnerText: string;
  rows: {
    text: string;
    votes: number;
    authorId?: string;
    voterIds?: string[];
  }[];
  reveal: "익명" | "실명";
  stats: { label: string; value: string }[];
}

/** 기록형 — 눈치 */
export interface RecordResult {
  variant: "record";
  game: "nunchi";
  purpose: string;
  loserId: string;
  rounds: {
    round: number;
    rows: {
      id: string;
      verdict: "통과" | "동시 탈락" | "시간 초과" | "최후 잔류";
      time?: string;
    }[];
  }[];
  stats: { label: string; value: string }[];
}

export type GameResult =
  WinnerResult | AssignResult | TallyResult | RecordResult;

export type ModalKind =
  | { kind: "tie"; names: string[] }
  | { kind: "allout" }
  | { kind: "kick"; memberId: string }
  | { kind: "leave" }
  | { kind: "explode" }
  | { kind: "hostLeft" }
  | { kind: "alreadyPlaying" }
  | null;
