import { create } from "zustand";
import type {
  ChatMsg,
  GameId,
  GameResult,
  GameSettings,
  Member,
  ModalKind,
  Screen,
} from "./types";
import {
  BOT_CHAT,
  BOTS,
  defaultSettings,
  GAMES,
  gameMeta,
  ME_ID,
  nowTime,
  PERSON_COLORS,
} from "./data";

/* ---------- 데모 봇 타이머 레지스트리 ---------- */
const timers = new Set<number>();
export function after(ms: number, fn: () => void): number {
  const t = window.setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
  return t;
}
export function clearBotTimers() {
  timers.forEach((t) => window.clearTimeout(t));
  timers.clear();
}

let chatSeq = 0;
const msg = (partial: Omit<ChatMsg, "id" | "time">): ChatMsg => ({
  ...partial,
  id: ++chatSeq,
  time: nowTime(),
});

function makeBotMember(botIdx: number): Member {
  const b = BOTS[botIdx];
  return {
    id: b.id,
    nick: b.nick,
    handle: b.handle,
    role: b.role,
    avatarId: b.avatarId,
    color: PERSON_COLORS[b.colorIdx],
    isHost: false,
    isMe: false,
    ready: false,
    online: true,
  };
}

interface AppState {
  screen: Screen;
  /* 방 */
  roomName: string;
  capacity: number;
  roomCode: string; // MODU-###### 숫자 6자리 (D-12)
  members: Member[];
  chat: ChatMsg[];
  typingId: string | null;
  /* 프로필 진행 중 실시간 선점 (avatarId → 닉네임) */
  takenAvatars: Record<number, string>;
  /* 게임 */
  selectedGame: GameId | null;
  settings: GameSettings;
  playing: boolean;
  replay: boolean;
  guideOpen: boolean;
  guideSuppressed: Partial<Record<GameId, boolean>>;
  result: GameResult | null;
  /* 오버레이 */
  modal: ModalKind;
  toast: string | null;

  /* actions */
  goto: (s: Screen) => void;
  createRoom: (name: string, capacity: number) => void;
  tryJoin: (code: string) => "notfound" | "playing" | "ok";
  confirmProfile: (nick: string, avatarId: number, intro: string) => void;
  sendChat: (text: string) => void;
  selectGame: (g: GameId) => void;
  randomGame: () => void;
  patchSettings: (p: Partial<GameSettings>) => void;
  toggleReadyDemo: () => void;
  startGame: () => void;
  closeGuide: (suppress?: boolean) => void;
  reopenGuide: () => void;
  finishGame: (r: GameResult) => void;
  retryGame: () => void;
  backToLobby: () => void;
  requestKick: (memberId: string) => void;
  confirmKick: () => void;
  openModal: (m: ModalKind) => void;
  closeModal: () => void;
  showToast: (t: string) => void;
  explodeRoom: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  screen: "landing",
  roomName: "",
  capacity: 8,
  roomCode: "",
  members: [],
  chat: [],
  typingId: null,
  takenAvatars: {},
  selectedGame: null,
  settings: defaultSettings("roulette"),
  playing: false,
  replay: false,
  guideOpen: false,
  guideSuppressed: {},
  result: null,
  modal: null,
  toast: null,

  goto: (s) => set({ screen: s }),

  createRoom: (name, capacity) => {
    clearBotTimers();
    // 초대 코드는 숫자 6자리 · 서버 발급 (D-12)
    const code = String(100000 + Math.floor(Math.random() * 900000));
    set({
      roomName: name,
      capacity,
      roomCode: code,
      members: [],
      chat: [],
      takenAvatars: {},
      selectedGame: null,
      playing: false,
      replay: false,
      result: null,
      screen: "profile",
    });
    // 프로필을 고르는 동안 팀원들이 실시간으로 아바타를 선점한다 (US-105)
    const claims: [number, number][] = [
      [1800, 0], // 서연
      [4200, 1], // 민준
      [6800, 2], // 하늘
    ];
    claims.forEach(([ms, botIdx]) =>
      after(ms, () =>
        set((st) => ({
          takenAvatars: {
            ...st.takenAvatars,
            [BOTS[botIdx].avatarId]: BOTS[botIdx].nick,
          },
        })),
      ),
    );
  },

  tryJoin: (code) => {
    if (code === "427132") {
      set({ modal: { kind: "alreadyPlaying" } });
      return "playing";
    }
    return "notfound";
  },

  confirmProfile: (nick, avatarId, intro) => {
    const handle = intro.trim()
      ? `@${intro.trim().replace(/^@/, "")}`
      : "@" + nick;
    const me: Member = {
      id: ME_ID,
      nick,
      handle,
      role: "방장",
      avatarId,
      color: PERSON_COLORS[0],
      isHost: true,
      isMe: true,
      ready: true, // 방장은 항시 준비 상태 (US-205)
      online: true,
    };
    set({
      members: [me],
      screen: "lobby",
      chat: [msg({ kind: "system", text: `${nick}님이 방을 만들었어요 👑` })],
    });

    // ---- 봇 입장 시퀀스 ----
    const joins: [number, number][] = [
      [1200, 0],
      [2400, 1],
      [4200, 2],
      [6400, 3],
      [8800, 4],
    ];
    joins.forEach(([ms, botIdx]) =>
      after(ms, () => {
        const st = get();
        if (st.screen !== "lobby") return;
        const bot = makeBotMember(botIdx);
        set({
          members: [...st.members, bot],
          chat: [
            ...st.chat,
            msg({ kind: "system", text: `${bot.nick}님이 입장했어요` }),
          ],
        });
      }),
    );
    // ---- 봇 채팅 (입력 중 표시 → 메시지) ----
    BOT_CHAT.forEach(({ botIdx, text, delay }) => {
      after(delay - 1400, () => {
        if (get().screen === "lobby") set({ typingId: BOTS[botIdx].id });
      });
      after(delay, () => {
        const st = get();
        if (st.screen !== "lobby") return;
        set({
          typingId: null,
          chat: [
            ...st.chat,
            msg({ kind: "other", senderId: BOTS[botIdx].id, text }),
          ],
        });
      });
    });
    // ---- 봇 준비 완료 ----
    const readies: [number, number][] = [
      [11000, 0],
      [12500, 4],
      [14000, 1],
      [16000, 2],
      [18000, 3],
    ];
    readies.forEach(([ms, botIdx]) =>
      after(ms, () => {
        const st = get();
        if (st.screen !== "lobby") return;
        set({
          members: st.members.map((m) =>
            m.id === BOTS[botIdx].id ? { ...m, ready: true } : m,
          ),
        });
      }),
    );
  },

  sendChat: (text) => {
    const t = text.trim();
    if (!t) return; // 공백만 입력하면 전송되지 않는다 (US-202)
    set((st) => ({
      chat: [...st.chat, msg({ kind: "mine", senderId: ME_ID, text: t })],
    }));
  },

  selectGame: (g) => {
    const st = get();
    const meta = gameMeta(g);
    if (st.members.length < meta.minPlayers) return; // 최소 인원 미달 (D-25)
    if (st.selectedGame === g) return;
    set({
      selectedGame: g,
      settings: defaultSettings(g), // 게임 교체 시 설정 초기화 (US-301)
      chat: [
        ...st.chat,
        msg({
          kind: "system",
          text: `🎮 방장이 '${meta.name}'을(를) 골랐어요`,
        }),
      ],
    });
  },

  randomGame: () => {
    const st = get();
    const playable = GAMES.filter((g) => st.members.length >= g.minPlayers);
    if (!playable.length) return;
    const pick = playable[Math.floor(Math.random() * playable.length)];
    get().selectGame(pick.id);
  },

  patchSettings: (p) => set((st) => ({ settings: { ...st.settings, ...p } })),

  toggleReadyDemo: () => {
    // 데모 보조: 봇 전원 READY 즉시 토글 (발표 중 대기 시간 단축)
    set((st) => ({
      members: st.members.map((m) => (m.isHost ? m : { ...m, ready: true })),
    }));
  },

  startGame: () => {
    const st = get();
    if (!st.selectedGame) return;
    const everyoneReady = st.members
      .filter((m) => !m.isHost)
      .every((m) => m.ready);
    if (
      !everyoneReady ||
      st.members.length < gameMeta(st.selectedGame).minPlayers
    )
      return;
    clearBotTimers();
    const suppress = st.guideSuppressed[st.selectedGame] ?? false;
    set({
      playing: true,
      replay: false,
      screen: "game",
      result: null,
      guideOpen: !suppress, // D-34: 첫 시작에만 가이드
    });
  },

  closeGuide: (suppress) => {
    const st = get();
    set({
      guideOpen: false,
      guideSuppressed:
        suppress && st.selectedGame
          ? { ...st.guideSuppressed, [st.selectedGame]: true }
          : st.guideSuppressed,
    });
  },

  reopenGuide: () => set({ guideOpen: true }),

  finishGame: (r) => set({ result: r, screen: "result", guideOpen: false }),

  retryGame: () => {
    // 다시 하기: 같은 설정 · 가이드 미노출 (D-34)
    clearBotTimers();
    set({ replay: true, result: null, screen: "game", guideOpen: false });
  },

  backToLobby: () => {
    clearBotTimers();
    set((st) => ({
      playing: false,
      replay: false,
      result: null,
      screen: "lobby",
      // 게임 후 준비 상태 해제 — 채팅 이력은 유지 (US-203)
      members: st.members.map((m) => (m.isHost ? m : { ...m, ready: false })),
      chat: [
        ...st.chat,
        msg({
          kind: "system",
          text: "대기방으로 돌아왔어요. 준비 완료를 다시 눌러 주세요",
        }),
      ],
    }));
    // 봇들이 다시 준비 완료
    BOTS.forEach((b, i) =>
      after(2500 + i * 1300, () => {
        const st = get();
        if (st.screen !== "lobby") return;
        set({
          members: st.members.map((m) =>
            m.id === b.id ? { ...m, ready: true } : m,
          ),
        });
      }),
    );
  },

  requestKick: (memberId) => set({ modal: { kind: "kick", memberId } }),

  confirmKick: () => {
    const st = get();
    const modal = st.modal;
    if (modal?.kind !== "kick") return;
    const target = st.members.find((m) => m.id === modal.memberId);
    if (!target) return set({ modal: null });
    set({
      modal: null,
      members: st.members.filter((m) => m.id !== target.id),
      chat: [
        ...st.chat,
        msg({ kind: "system", text: `${target.nick}님이 내보내졌어요` }),
      ],
    });
  },

  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null }),

  showToast: (t) => {
    set({ toast: t });
    after(2400, () => set({ toast: null }));
  },

  explodeRoom: () => {
    // 방장이 나가면 방은 폭파된다 (US-601)
    clearBotTimers();
    set({
      modal: null,
      screen: "landing",
      members: [],
      chat: [],
      selectedGame: null,
      playing: false,
      result: null,
      roomName: "",
      roomCode: "",
    });
  },
}));
