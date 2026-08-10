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
  defaultSettings,
  GAMES,
  gameMeta,
  nowTime,
  PERSON_COLORS,
} from "./data";
import * as api from "./api";
import { RoomSocket } from "./socket";
import {
  fromAvatarId,
  fromServerConfig,
  toAvatarId,
  toServerConfig,
} from "./mapping";
import type { MemberView, SnapshotData } from "./socket-events";

/**
 * 화면 상태.
 *
 * **명단·채팅·준비·게임 선택은 전부 서버가 정한다.** 화면은 서버 이벤트를 받아
 * 그리기만 하고 스스로 만들어 내지 않는다 — 낙관적 갱신을 두지 않는 이유는
 * 판정 권위가 서버에 있기 때문이다(D-04).
 *
 * 예외가 하나 있다. **입퇴장 시스템 말풍선은 서버가 내려주지 않는다** — 클라이언트가
 * member:joined·member:left를 보고 직접 그린다(07_api/03_socket_events.md).
 */

/* ---------- 게임 연출용 타이머 (판정이 붙기 전까지의 데모) ---------- */
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

/** 참가 순서대로 퍼슨 컬러를 준다. 서버는 색을 모른다 — 표시 규격이다. */
const colorOf = (joinOrder: number) =>
  PERSON_COLORS[(joinOrder - 1) % PERSON_COLORS.length];

let socket: RoomSocket | null = null;
let myMemberId = "";

function toMember(v: MemberView): Member {
  return {
    id: v.memberId,
    nick: v.nickname,
    handle: v.bio ? `@${v.bio.replace(/^@/, "")}` : `@${v.nickname}`,
    role: v.isHost ? "방장" : "참가자",
    avatarId: fromAvatarId(v.avatarId),
    color: colorOf(v.joinOrder),
    isHost: v.isHost,
    isMe: v.memberId === myMemberId,
    ready: v.ready,
    online: v.connection !== "UNSTABLE",
  };
}

interface AppState {
  screen: Screen;
  /* 방 */
  roomName: string;
  capacity: number;
  roomCode: string; // 숫자 6자리 (D-12)
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
  /* 통신 */
  busy: boolean;

  /* actions */
  goto: (s: Screen) => void;
  createRoom: (name: string, capacity: number) => Promise<void>;
  tryJoin: (code: string) => Promise<"notfound" | "playing" | "full" | "ok">;
  loadAvatars: () => Promise<void>;
  confirmProfile: (
    nick: string,
    avatarId: number,
    intro: string,
  ) => Promise<void>;
  sendChat: (text: string) => void;
  setTyping: (typing: boolean) => void;
  selectGame: (g: GameId) => void;
  randomGame: () => void;
  patchSettings: (p: Partial<GameSettings>) => void;
  toggleReady: () => void;
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
  leaveRoom: () => void;
  explodeRoom: () => void;
}

const EMPTY = {
  members: [] as Member[],
  chat: [] as ChatMsg[],
  takenAvatars: {} as Record<number, string>,
  selectedGame: null,
  playing: false,
  replay: false,
  result: null,
  typingId: null,
};

export const useApp = create<AppState>((set, get) => {
  /** 서버 이벤트를 화면 상태로 접는다. */
  const bindSocket = (code: string, token: string) => {
    socket?.dispose();
    socket = new RoomSocket(code, token, {
      "room:snapshot": (d) => {
        const snap = d as SnapshotData;
        const game = snap.game as { gameId: string; config: Record<string, unknown> } | null;
        myMemberId = snap.me.memberId;
        set({
          roomName: snap.room.roomName,
          capacity: snap.room.maxMembers,
          roomCode: snap.room.code,
          members: snap.members.map(toMember),
          selectedGame: (game?.gameId as GameId) ?? null,
          settings: game
            ? fromServerConfig(game.gameId as GameId, game.config)
            : get().settings,
          screen: snap.me.memberStatus === "ACTIVE" ? "lobby" : "profile",
        });
      },

      "member:joined": (d) => {
        const m = toMember(d.member);
        set((st) => ({
          members: [...st.members.filter((x) => x.id !== m.id), m].sort(
            (a, b) => a.avatarId - b.avatarId,
          ),
          // 입퇴장 말풍선은 서버가 내려주지 않는다 — 여기서 그린다.
          chat: [
            ...st.chat,
            msg({ kind: "system", text: `${m.nick}님이 입장했어요` }),
          ],
          takenAvatars: { ...st.takenAvatars, [m.avatarId]: m.nick },
        }));
      },

      "member:left": (d) => {
        const gone = get().members.find((m) => m.id === d.memberId);
        const how = d.reason === "KICK" ? "내보내졌어요" : "나갔어요";
        set((st) => ({
          members: st.members.filter((m) => m.id !== d.memberId),
          chat: gone
            ? [
                ...st.chat,
                msg({ kind: "system", text: `${gone.nick}님이 ${how}` }),
              ]
            : st.chat,
        }));
      },

      "member:ready_changed": (d) =>
        set((st) => ({
          members: st.members.map((m) =>
            m.id === d.memberId ? { ...m, ready: d.ready } : m,
          ),
        })),

      "member:connection": (d) =>
        set((st) => ({
          members: st.members.map((m) =>
            m.id === d.memberId ? { ...m, online: d.state !== "UNSTABLE" } : m,
          ),
        })),

      "chat:message": (d) =>
        set((st) => ({
          chat: [
            ...st.chat,
            msg({
              kind: d.memberId === myMemberId ? "mine" : "other",
              senderId: d.memberId,
              text: d.text,
            }),
          ],
        })),

      "chat:typing": (d) => {
        set({ typingId: d.typing ? d.memberId : null });
        // 3초간 갱신이 없으면 스스로 내린다. 서버는 false를 보장하지 않는다.
        if (d.typing) {
          after(3000, () => {
            if (get().typingId === d.memberId) set({ typingId: null });
          });
        }
      },

      "game:selected": (d) =>
        set((st) => ({
          selectedGame: d.gameId as GameId,
          settings: fromServerConfig(d.gameId as GameId, d.config),
          chat: [
            ...st.chat,
            msg({
              kind: "system",
              text: `🎮 방장이 '${gameMeta(d.gameId as GameId).name}'을(를) 골랐어요`,
            }),
          ],
        })),

      "game:config_changed": (d) =>
        set({ settings: fromServerConfig(d.gameId as GameId, d.config) }),

      "game:started": () => {
        const st = get();
        const suppress = st.selectedGame
          ? (st.guideSuppressed[st.selectedGame] ?? false)
          : false;
        set({
          playing: true,
          replay: false,
          screen: "game",
          result: null,
          guideOpen: !suppress,
        });
      },

      "round:closed": () =>
        set((st) => ({
          playing: false,
          replay: false,
          result: null,
          screen: "lobby",
          chat: [
            ...st.chat,
            msg({
              kind: "system",
              text: "대기방으로 돌아왔어요. 준비 완료를 다시 눌러 주세요",
            }),
          ],
        })),

      "room:closed": (d) =>
        set({
          ...EMPTY,
          screen: "landing",
          roomName: "",
          roomCode: "",
          modal: d.reason === "HOST_LEFT" ? { kind: "hostLeft" } : null,
          toast:
            d.reason === "EXPIRED" ? "오래 활동이 없어 방이 사라졌어요" : null,
        }),

      onError: (code, message) => {
        // 서버가 사람이 읽을 문구까지 실어 보낸다. 화면이 코드별 문구를 따로 두지 않는다.
        if (code === "member.kicked") {
          set({ ...EMPTY, screen: "landing", modal: null, toast: message });
          return;
        }
        get().showToast(message);
      },

      onClose: (closeCode) => {
        socket = null;
        if (closeCode === 1000 || closeCode === 4410) return; // 이미 처리했다
        set({ ...EMPTY, screen: "landing", roomCode: "", roomName: "" });
        if (closeCode !== 4403)
          get().showToast("연결이 끊겼어요. 다시 입장해 주세요");
      },
    });
    socket.open();
  };

  return {
    screen: "landing",
    roomName: "",
    capacity: 8,
    roomCode: "",
    ...EMPTY,
    settings: defaultSettings("roulette"),
    guideOpen: false,
    guideSuppressed: {},
    modal: null,
    toast: null,
    busy: false,

    goto: (s) => set({ screen: s }),

    createRoom: async (name, capacity) => {
      clearBotTimers();
      set({ busy: true });
      try {
        const room = await api.createRoom(name, capacity);
        api.setToken(room.memberToken);
        myMemberId = room.memberId;
        set({
          ...EMPTY,
          roomName: room.roomName,
          capacity: room.maxMembers,
          roomCode: room.code,
          screen: "profile",
        });
        // 프로필을 고르는 동안에도 소켓을 연다 — 다른 사람의 아바타 선점이
        // 실시간으로 보여야 하기 때문이다(PENDING 구간).
        bindSocket(room.code, room.memberToken);
        await get().loadAvatars();
      } catch (e) {
        get().showToast(
          e instanceof api.ApiError ? e.message : "방을 만들지 못했어요",
        );
      } finally {
        set({ busy: false });
      }
    },

    tryJoin: async (code) => {
      set({ busy: true });
      try {
        const found = await api.lookupRoom(code);
        const joined = await api.joinRoom(code);
        api.setToken(joined.memberToken);
        myMemberId = joined.memberId;
        set({
          ...EMPTY,
          roomName: found.roomName,
          capacity: joined.maxMembers,
          roomCode: code,
          screen: "profile",
        });
        bindSocket(code, joined.memberToken);
        await get().loadAvatars();
        return "ok";
      } catch (e) {
        if (!(e instanceof api.ApiError)) return "notfound";
        if (e.code === "room.already_playing") {
          set({ modal: { kind: "alreadyPlaying" } });
          return "playing";
        }
        if (e.code === "room.full") {
          get().showToast(e.message);
          return "full";
        }
        return "notfound";
      } finally {
        set({ busy: false });
      }
    },

    loadAvatars: async () => {
      const code = get().roomCode;
      if (!code) return;
      try {
        const { content } = await api.listAvatars(code);
        const taken: Record<number, string> = {};
        for (const slot of content) {
          if (slot.taken)
            taken[fromAvatarId(slot.avatarId)] = slot.takenBy ?? "";
        }
        set({ takenAvatars: taken });
      } catch {
        /* 선점 현황은 없어도 진행할 수 있다 — 최종 판정은 확정 시 서버가 한다 */
      }
    },

    confirmProfile: async (nick, avatarId, intro) => {
      const code = get().roomCode;
      set({ busy: true });
      try {
        await api.confirmProfile(code, {
          nickname: nick,
          avatarId: toAvatarId(avatarId),
          bio: intro.trim() || undefined,
        });
        // 명단·화면 전환은 서버의 room:snapshot·member:joined가 만든다.
        // 여기서 미리 그리지 않는 이유는 닉네임을 서버가 채번할 수 있기 때문이다.
        set({ screen: "lobby" });
      } catch (e) {
        if (e instanceof api.ApiError) {
          get().showToast(e.message);
          if (e.code === "member.avatar_taken") await get().loadAvatars();
        }
      } finally {
        set({ busy: false });
      }
    },

    sendChat: (text) => {
      const t = text.trim();
      if (!t) return; // 공백만이면 서버가 조용히 무시한다 — 보내지도 않는다
      socket?.send("chat:send", { text: t });
    },

    setTyping: (typing) => socket?.send("chat:typing", { typing }),

    selectGame: (g) => {
      const st = get();
      if (st.members.length < gameMeta(g).minPlayers) return; // 빠른 실패 (D-25)
      socket?.send("game:select", { gameId: g });
    },

    randomGame: () => socket?.send("game:random", {}),

    patchSettings: (p) => {
      const st = get();
      if (!st.selectedGame) return;
      // 화면은 즉시 반영하고 서버 확인을 기다린다 — 슬라이더가 끊겨 보이지 않게.
      const next = { ...st.settings, ...p };
      set({ settings: next });
      socket?.send("game:config", {
        gameId: st.selectedGame,
        config: toServerConfig(st.selectedGame, next),
      });
    },

    toggleReady: () => {
      const me = get().members.find((m) => m.isMe);
      if (!me || me.isHost) return; // 방장은 준비 상태를 갖지 않는다
      socket?.send("member:ready", { ready: !me.ready });
    },

    startGame: () => socket?.send("game:start", {}),

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
      clearBotTimers();
      set({ replay: true, result: null, screen: "game", guideOpen: false });
    },

    backToLobby: () => {
      clearBotTimers();
      const roundOpen = get().playing;
      if (roundOpen) socket?.send("round:close", { roundId: "" });
      set({ playing: false, replay: false, result: null, screen: "lobby" });
    },

    requestKick: (memberId) => set({ modal: { kind: "kick", memberId } }),

    confirmKick: () => {
      const modal = get().modal;
      if (modal?.kind !== "kick") return set({ modal: null });
      socket?.send("member:kick", { memberId: modal.memberId });
      set({ modal: null });
    },

    openModal: (m) => set({ modal: m }),
    closeModal: () => set({ modal: null }),

    showToast: (t) => {
      set({ toast: t });
      after(2400, () => set({ toast: null }));
    },

    leaveRoom: () => {
      clearBotTimers();
      // 소켓이 열려 있으면 종료 코드 1000이 이탈이다. 열기 전이면 REST를 쓴다.
      if (socket) socket.leave();
      else void api.leaveRoom(get().roomCode).catch(() => {});
      socket = null;
      api.setToken(null);
      set({
        ...EMPTY,
        modal: null,
        screen: "landing",
        roomName: "",
        roomCode: "",
      });
    },

    explodeRoom: () => get().leaveRoom(),
  };
});

/** 최소 인원을 채운 게임만. 랜덤 뽑기 후보 판정과 같은 규칙이다. */
export const playableGames = (memberCount: number) =>
  GAMES.filter((g) => memberCount >= g.minPlayers);
