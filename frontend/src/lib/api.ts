/**
 * REST 6종 — 대기방에 들어서기 전까지의 전 통신.
 *
 * 대기방에 들어선 뒤의 통신은 전부 소켓이다(`socket.ts`).
 *
 * 응답은 성공이든 실패든 같은 봉투로 온다. **화면 분기는 HTTP 상태가 아니라 code
 * 문자열로 한다** — 서버가 사람이 읽을 문구(message)까지 실어 보내므로 화면이
 * 코드별 문구를 따로 관리하지 않는다.
 */

import type { ErrorCode } from "./socket-events";

/** 개발 중에는 vite 프록시가 같은 오리진으로 넘겨준다(vite.config.ts). */
export const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface Envelope<T> {
  success: boolean;
  code: string;
  message: string | null;
  data: T;
  timestamp: string;
}

/** 서버가 규약대로 돌려준 실패. 화면은 code로 분기하고 message를 그대로 띄운다. */
export class ApiError extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let memberToken: string | null = null;

export const setToken = (token: string | null): void => {
  memberToken = token;
};
export const getToken = (): string | null => memberToken;

/**
 * 멱등 키는 **동작 하나에 하나**다.
 *
 * 호출마다 새로 만들면 재시도가 중복 처리된다. 성공했을 때만 버린다.
 */
const idemKeys = new Map<string, string>();
function idemFor(action: string): string {
  const existing = idemKeys.get(action);
  if (existing) return existing;
  const key = crypto.randomUUID();
  idemKeys.set(action, key);
  return key;
}

async function call<T>(
  method: string,
  path: string,
  opts: { body?: unknown; auth?: boolean; idem?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth && memberToken) headers.Authorization = `Bearer ${memberToken}`;
  if (opts.idem) headers["Idempotency-Key"] = idemFor(opts.idem);

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (res.status === 204) {
    if (opts.idem) idemKeys.delete(opts.idem);
    return undefined as T;
  }

  const envelope = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !envelope || envelope.success !== true) {
    throw new ApiError(
      envelope?.code ?? `http.${res.status}`,
      envelope?.message ?? "잠시 문제가 생겼어요. 다시 시도해 주세요",
      res.status,
    );
  }
  if (opts.idem) idemKeys.delete(opts.idem);
  return envelope.data;
}

/* ---------- 1. 방 만들기 ---------- */

export interface CreatedRoom {
  code: string;
  displayCode: string;
  roomName: string;
  maxMembers: number;
  memberId: string;
  memberToken: string;
  memberStatus: string;
  isHost: boolean;
  expiresAt: string;
}

export const createRoom = (roomName: string, maxMembers: number) =>
  call<CreatedRoom>("POST", "/api/rooms", {
    body: { roomName, maxMembers },
    idem: "create",
  });

/* ---------- 2. 초대 코드 조회 ---------- */

export interface RoomLookup {
  code: string;
  displayCode: string;
  roomName: string;
  roomStatus: string;
  maxMembers: number;
  currentMembers: number;
  hostNickname: string | null;
}

export const lookupRoom = (code: string) =>
  call<RoomLookup>("GET", `/api/rooms/${code}`);

/* ---------- 3. 참가 ---------- */

export interface JoinedRoom {
  memberId: string;
  memberToken: string;
  memberStatus: string;
  isHost: boolean;
  currentMembers: number;
  maxMembers: number;
}

export const joinRoom = (code: string) =>
  call<JoinedRoom>("POST", `/api/rooms/${code}/members`, {
    idem: `join:${code}`,
  });

/* ---------- 4. 아바타 선점 현황 ---------- */

export interface AvatarSlot {
  avatarId: string;
  taken: boolean;
  takenBy: string | null;
}

export const listAvatars = (code: string) =>
  call<{ content: AvatarSlot[]; totalCount: number }>(
    "GET",
    `/api/rooms/${code}/avatars`,
    { auth: true },
  );

/* ---------- 5. 프로필 확정 ---------- */

export interface ConfirmedProfile {
  memberId: string;
  memberStatus: string;
  nickname: string;
  avatarId: string;
  bio: string | null;
  isHost: boolean;
  joinOrder: number;
}

/**
 * **응답의 nickname이 정본이다.** 같은 방에 같은 닉네임이 있으면 서버가 뒤에 숫자를
 * 붙여 확정하므로 요청에 실은 값과 다를 수 있다.
 */
export const confirmProfile = (
  code: string,
  profile: { nickname: string; avatarId?: string; bio?: string },
) =>
  call<ConfirmedProfile>("PATCH", `/api/rooms/${code}/members/me`, {
    body: profile,
    auth: true,
    idem: "confirm",
  });

/* ---------- 6. 이탈 ---------- */

/** 소켓을 열기 전 구간에만 쓴다. 열려 있으면 종료 코드 1000이 그 자리를 대신한다. */
export const leaveRoom = (code: string) =>
  call<void>("DELETE", `/api/rooms/${code}/members/me`, { auth: true });
