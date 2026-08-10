/**
 * 서버 계약값 ↔ 화면 표시값 변환.
 *
 * 화면은 한국어 라벨을 그대로 쓰고(`빠르게`·`익명`), 서버는 계약값을 쓴다
 * (`FAST`·`revealAuthors:false`). **둘을 섞지 않는다** — 화면 코드가 계약값을
 * 직접 다루기 시작하면 라벨을 바꿀 때마다 서버 규약을 건드리게 된다.
 *
 * 아바타도 마찬가지다. 화면은 0부터 세는 인덱스로 에셋을 찾고 서버는 A01~A30을
 * 쓴다. 변환을 여기 한 곳에만 둔다.
 */

import type { GameId, GameSettings } from "./types";
import { defaultSettings } from "./data";

/* ---------- 아바타 ---------- */

/** 화면 인덱스(0~29) → 서버 식별자(A01~A30). */
export const toAvatarId = (index: number): string =>
  `A${String(index + 1).padStart(2, "0")}`;

/** 서버 식별자 → 화면 인덱스. 모르는 값이면 0으로 떨어뜨린다. */
export function fromAvatarId(avatarId: string | null | undefined): number {
  const n = Number(String(avatarId ?? "").replace(/^A/, ""));
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n - 1 : 0;
}

/* ---------- 게임 설정 ---------- */

const LADDER_SPEED = {
  빠르게: "FAST",
  보통: "NORMAL",
  느리게: "SLOW",
} as const;
const LADDER_SPEED_BACK: Record<string, GameSettings["ladderSpeed"]> = {
  FAST: "빠르게",
  NORMAL: "보통",
  SLOW: "느리게",
};

const TC_CRITERIA = {
  "오차가 적은 사람": "CLOSEST",
  "오차가 큰 사람": "FARTHEST",
} as const;
const TC_CRITERIA_BACK: Record<string, GameSettings["tcCriteria"]> = {
  CLOSEST: "오차가 적은 사람",
  FARTHEST: "오차가 큰 사람",
};

/**
 * 화면 설정 → 서버 config.
 *
 * **그 게임의 항목만 보낸다.** 서버는 규격에 없는 필드를 game.invalid_config로
 * 거절하므로, 화면이 여섯 게임 설정을 한 덩어리로 들고 있는 것을 그대로 보내면 안 된다.
 */
export function toServerConfig(
  game: GameId,
  s: GameSettings,
): Record<string, unknown> {
  switch (game) {
    case "roulette":
      return { topic: s.topic };
    case "ladder":
      return { resultItems: s.ladderRoles, speed: LADDER_SPEED[s.ladderSpeed] };
    case "kingmaker":
      return {
        topic: s.topic,
        votesPerMember: s.kmVotes,
        revealAuthors: s.kmReveal === "실명",
      };
    case "timer":
      return {
        topic: s.topic,
        targetSeconds: s.tcTarget,
        criterion: TC_CRITERIA[s.tcCriteria],
      };
    case "snipe":
      return {
        question: s.snQuestion,
        voteSeconds: s.snTime,
        multiVote: s.snDup === "가능",
        revealVoters: s.snReveal === "공개",
      };
    case "nunchi":
      return {
        topic: s.topic,
        windowMs: s.nzWindow * 1000,
        roundSeconds: s.nzRound,
      };
  }
}

/** 서버 config → 화면 설정. 빠진 항목은 그 게임의 기본값으로 채운다. */
export function fromServerConfig(
  game: GameId,
  config: Record<string, unknown>,
): GameSettings {
  const base = defaultSettings(game);
  const pick = <T>(value: unknown, fallback: T): T =>
    value === undefined || value === null ? fallback : (value as T);

  switch (game) {
    case "roulette":
      return { ...base, topic: pick(config.topic, base.topic) };
    case "ladder":
      return {
        ...base,
        ladderRoles: pick(config.resultItems, base.ladderRoles),
        ladderSpeed:
          LADDER_SPEED_BACK[String(config.speed)] ?? base.ladderSpeed,
      };
    case "kingmaker":
      return {
        ...base,
        topic: pick(config.topic, base.topic),
        kmVotes: pick(config.votesPerMember, base.kmVotes),
        kmReveal: config.revealAuthors ? "실명" : "익명",
      };
    case "timer":
      return {
        ...base,
        topic: pick(config.topic, base.topic),
        tcTarget: pick(config.targetSeconds, base.tcTarget),
        tcCriteria:
          TC_CRITERIA_BACK[String(config.criterion)] ?? base.tcCriteria,
      };
    case "snipe":
      return {
        ...base,
        snQuestion: pick(config.question, base.snQuestion),
        snTime: pick(config.voteSeconds, base.snTime),
        snDup: config.multiVote ? "가능" : "불가",
        snReveal: config.revealVoters ? "공개" : "비공개",
      };
    case "nunchi":
      return {
        ...base,
        topic: pick(config.topic, base.topic),
        nzWindow: (pick(config.windowMs, 300) as number) === 500 ? 0.5 : 0.3,
        nzRound: pick(config.roundSeconds, base.nzRound),
      };
  }
}
