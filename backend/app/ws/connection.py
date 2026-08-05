"""방-소켓 명부와 브로드캐스트.

Native WebSocket을 쓰므로 룸 관리·브로드캐스트를 직접 구현한다. 단일 인스턴스·워커
1개라 인스턴스 간 중계 계층이 없다.

브로드캐스트 규약 넷을 지킨다.

    1. 방 단위로 페이로드를 **1회만 직렬화**한다. 10명에게 보낼 때 10번 만들지 않는다
    2. 수신자별로 **독립 전송**한다. 한 소켓의 실패가 다른 전송을 막지 않는다
    3. **확인 응답을 기다리지 않는다.** 전원 확인 후 확정하면 한 명의 지연이 전원의
       결과 전환을 늦춰 결과 동시성 목표가 깨진다
    4. **커밋 이후에만 발행한다.** 롤백된 사실을 화면에 남기지 않는다

**이 모듈은 서비스를 모른다.** 명부와 전송만 안다.
"""

import logging
from dataclasses import dataclass, field

from fastapi import WebSocket

log = logging.getLogger("modupick.ws")

#: 서버가 직접 닫은 소켓의 표식. 이 소켓의 종료는 이탈 사건이 아니다.
EVICTED = "evicted"


@dataclass(frozen=True, slots=True)
class SocketConn:
    """소켓 하나에 바인딩된 주체.

    **이후 모든 이벤트의 주체는 이 바인딩으로만 판정한다.** 페이로드가 실어 보낸
    식별자·역할은 쓰지 않는다. 그래서 C->S 페이로드에 발신자 memberId를 두지 않는다.
    """

    ws: WebSocket
    token: str
    participant_id: int
    member_id: str
    room_id: int
    room_code: str
    #: 소켓 수명 동안의 표식. 값이 아니라 이 소켓의 처지를 적는 곳이라 비교에서 뺀다
    flags: set[str] = field(default_factory=set, compare=False)


@dataclass(slots=True)
class ConnectionRegistry:
    #: room_id -> participant_id -> 소켓
    _rooms: dict[int, dict[int, SocketConn]] = field(default_factory=dict)
    #: token -> 소켓. 같은 토큰의 두 번째 연결을 거부하는 데 쓴다
    _by_token: dict[str, SocketConn] = field(default_factory=dict)

    # ── 명부 ───────────────────────────────────────────────────────────────

    def is_bound(self, token: str) -> bool:
        """이미 이 토큰으로 붙은 소켓이 있는가.

        **재접속 불가의 소켓 층 구현이다.** 같은 토큰으로 두 번째 창을 열어 자리를
        빼앗거나 두 화면에서 동시에 입력하는 경로가 여기서 닫힌다.
        """
        return token in self._by_token

    def add(self, conn: SocketConn) -> None:
        self._rooms.setdefault(conn.room_id, {})[conn.participant_id] = conn
        self._by_token[conn.token] = conn

    def remove(self, conn: SocketConn) -> None:
        room = self._rooms.get(conn.room_id)
        if room is not None:
            if room.get(conn.participant_id) is conn:
                del room[conn.participant_id]
            if not room:
                del self._rooms[conn.room_id]
        if self._by_token.get(conn.token) is conn:
            del self._by_token[conn.token]

    def members_of(self, room_id: int) -> list[SocketConn]:
        return list(self._rooms.get(room_id, {}).values())

    def find(self, room_id: int, participant_id: int) -> SocketConn | None:
        return self._rooms.get(room_id, {}).get(participant_id)

    def count(self, room_id: int) -> int:
        return len(self._rooms.get(room_id, {}))

    # ── 전송 ───────────────────────────────────────────────────────────────

    async def send(self, conn: SocketConn, frame: str) -> bool:
        """개인 전송. 실패하면 명부에서 빼고 False를 돌려준다."""
        try:
            await conn.ws.send_text(frame)
        except Exception:
            log.info("전송 실패 — participant=%s", conn.member_id)
            self.remove(conn)
            return False
        return True

    async def broadcast(
        self,
        room_id: int,
        frame: str,
        *,
        exclude_participant: int | None = None,
    ) -> int:
        """방 전체 전송. 이미 직렬화된 프레임 하나를 받는다.

        **대상 집합을 먼저 확정한 뒤 보낸다.** 전송 중 누가 나가도 그 회차의 대상은
        변하지 않는다.
        """
        targets = [
            c
            for c in self.members_of(room_id)
            if exclude_participant is None or c.participant_id != exclude_participant
        ]
        sent = 0
        for conn in targets:
            if await self.send(conn, frame):
                sent += 1
        return sent

    async def close_room(self, room_id: int, frame: str | None, code: int) -> None:
        """방 종료. 사유를 알린 뒤 전 소켓을 닫는다."""
        for conn in self.members_of(room_id):
            if frame is not None:
                await self.send(conn, frame)
            await self._shutdown(conn, code)

    async def evict(self, room_id: int, participant_id: int, spec, code: int) -> bool:
        """한 소켓만 사유를 알리고 닫는다. 강퇴가 쓴다."""
        from app.ws.envelope import outgoing_error

        conn = self.find(room_id, participant_id)
        if conn is None:
            return False
        await self.send(conn, outgoing_error(spec))
        await self._shutdown(conn, code)
        return True

    async def _shutdown(self, conn: SocketConn, code: int) -> None:
        """서버가 닫는다. **표식을 남겨 이탈 처리를 두 번 하지 않게 한다.**

        표식이 없으면 방장 이탈로 닫힌 소켓 하나하나가 다시 유예에 들어가고, 사라진
        방을 두고 이탈을 확정하려는 태스크가 인원수만큼 생긴다.
        """
        conn.flags.add(EVICTED)
        try:
            await conn.ws.close(code=code)
        except Exception:
            pass
        self.remove(conn)

    def stats(self) -> dict[str, int]:
        return {
            "rooms": len(self._rooms),
            "sockets": len(self._by_token),
        }


registry = ConnectionRegistry()
