/**
 * 소켓 클라이언트.
 *
 * 연결 직후 순서가 정해져 있다.
 *
 *     연결 → (3초 안) conn:auth → room:snapshot 1회 → 부분 갱신
 *
 * **자동 재연결을 하지 않는다.** 재접속 경로가 설계에 없어 다시 붙어도 자리를
 * 되찾지 못하고 4409만 반복된다. 끊기면 그대로 화면에 알리고 표지로 보낸다.
 *
 * **버전 게이트는 상태 이벤트에만 건다.** 통지 이벤트(chat·tick·error)에까지 걸면
 * 방 상태를 바꾸지 않는 이벤트가 직전 상태 이벤트와 같은 번호를 달고 나가 전부
 * 버려진다.
 */

import {
  PROTOCOL_VERSION,
  STATE_EVENTS,
  type ClientEventName,
  type ClientEvents,
  type ServerEventName,
  type ServerEvents,
} from "./socket-events";
import { API_BASE } from "./api";

type Handler = {
  [E in ServerEventName]?: (data: ServerEvents[E]) => void;
};

export interface SocketCallbacks extends Handler {
  /** 소켓이 닫혔다. code는 정본의 종료 코드다(4401·4403·4409·4410 …). */
  onClose?: (code: number) => void;
  /** 개인 error 프레임. 보낸 사람에게만 온다. */
  onError?: (code: string, message: string, sourceEvent: string | null) => void;
}

const STATE = new Set<string>(STATE_EVENTS);

function socketUrl(code: string): string {
  const base = API_BASE || window.location.origin;
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/rooms/${code}`;
  url.search = "";
  // 토큰은 URL에 싣지 않는다 — 프록시·접근 로그에 그대로 남는다.
  return url.toString();
}

export class RoomSocket {
  private ws: WebSocket | null = null;
  private roomVersion = 0;
  private closed = false;

  private readonly code: string;
  private readonly token: string;
  private readonly cb: SocketCallbacks;

  constructor(code: string, token: string, cb: SocketCallbacks) {
    this.code = code;
    this.token = token;
    this.cb = cb;
  }

  open(): void {
    const ws = new WebSocket(socketUrl(this.code));
    this.ws = ws;

    ws.onopen = () => {
      // 3초 안에 보내지 않으면 서버가 4408로 닫는다.
      this.send("conn:auth", {
        protocolVersion: PROTOCOL_VERSION,
        roomCode: this.code,
        memberToken: this.token,
      });
    };
    ws.onmessage = (e) => this.receive(e.data as string);
    ws.onclose = (e) => {
      this.ws = null;
      if (!this.closed) this.cb.onClose?.(e.code);
    };
  }

  /** 나가기 버튼에서만 부른다. 페이지 숨김·새로고침에는 쓰지 않는다. */
  leave(): void {
    this.closed = true;
    this.ws?.close(1000, "leave");
    this.ws = null;
  }

  /** 화면을 떠날 때의 정리. 이탈 의사가 아니므로 코드를 싣지 않는다. */
  dispose(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  send<E extends ClientEventName>(event: E, data: ClientEvents[E]): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ event, data }));
  }

  private receive(raw: string): void {
    let frame: {
      event: string;
      success: boolean;
      code: string;
      message: string | null;
      data: Record<string, unknown>;
    };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (frame.success === false) {
      this.cb.onError?.(
        frame.code,
        frame.message ?? "",
        (frame.data?.event as string) ?? null,
      );
      return;
    }

    const version = frame.data?.roomVersion as number | undefined;
    if (typeof version === "number" && STATE.has(frame.event)) {
      if (frame.event === "room:snapshot") {
        // 스냅샷은 기준선을 새로 놓는다. 게이트에 걸면 아무것도 바뀌지 않은 방에
        // 다시 붙었을 때 화면이 빈 채로 남는다.
        this.roomVersion = version;
      } else if (version <= this.roomVersion) {
        return; // 지난 번호는 버린다
      } else {
        this.roomVersion = version;
      }
    }

    const handler = this.cb[frame.event as ServerEventName] as
      ((data: unknown) => void) | undefined;
    handler?.(frame.data);
  }
}
