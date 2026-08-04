"""채팅 중계.

**서버는 채팅을 저장하지 않는다.** 브로드캐스트하고 버린다. 화면 복원은 클라이언트
로컬 저장이며 나중에 들어온 사람은 이전 대화를 볼 수 없다(D-40).

그래서 이 모듈에는 DB 쓰기가 하나뿐이다 — 만료 연장. 채팅은 사람의 행동이므로
무활동 시계를 되돌린다.

**시스템 메시지를 서버가 보내는 경로는 없다.** 입퇴장 말풍선은 클라이언트가
member:joined·member:left를 보고 직접 그린다.
"""

from sqlalchemy import select

from app.domain import chat_rules, errors
from app.domain.enums import MemberStatus
from app.infra.clock import clock
from app.infra.db.session import readonly
from app.infra.db.tables import participants
from app.infra.memory.runtime_store import store
from app.schemas.rest import iso_z


async def _is_listed(participant_pk: int) -> bool:
    """명단에 오른 사람인가.

    PENDING은 members[]에 없다. 받는 쪽에 그릴 닉네임·아바타가 없으므로 중계하지
    않는다 — 페이로드가 memberId만 싣기 때문이다.
    """
    async with readonly() as conn:
        row = (
            await conn.execute(
                select(participants.c.status, participants.c.left_at).where(
                    participants.c.id == participant_pk
                )
            )
        ).first()
    return row is not None and row.left_at is None and row.status == MemberStatus.ACTIVE.value


async def send(*, participant_pk: int, room_pk: int, member_id: str, raw_text: str) -> None:
    """보낸 본인을 **포함한** 전원에게 되돌린다.

    본인 메시지도 서버를 한 번 다녀오므로, 클라이언트가 미리 그리지 않고 기다렸다
    그리면 전원의 말풍선 순서가 같아진다.
    """
    from app.schemas.events import ChatMessageData
    from app.services import room_service
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    if not await _is_listed(participant_pk):
        raise errors.DomainError(errors.GAME_INVALID_ACTION)

    # 공백만이면 조용히 무시한다. 200자 초과는 여기서 payload_too_large로 올라온다.
    text = chat_rules.normalize_text(raw_text)
    if text is None:
        return

    await room_service.touch(room_pk)

    frame = outgoing(
        "chat:message",
        ChatMessageData(
            # **버전을 올리지 않는다.** 채팅은 방 상태를 바꾸지 않는 통지 이벤트다.
            roomVersion=store.version(room_pk),
            messageId=store.next_message_id(room_pk),
            memberId=member_id,
            text=text,
            sentAt=iso_z(clock.now()),
        ).model_dump(),
    )
    await registry.broadcast(room_pk, frame)


async def typing(*, participant_pk: int, room_pk: int, member_id: str, typing: bool) -> None:
    """입력 중 표시. **보낸 사람 본인은 제외**한다.

    저장하지 않고 만료 타이머도 갱신하지 않는다 — 키를 누르는 것만으로 방이
    영원히 살아남게 두지 않는다. 클라이언트는 3초간 갱신이 없으면 스스로 false로
    되돌린다.

    이 이벤트에는 에러 코드가 없다. 자격이 없으면 조용히 버린다.
    """
    from app.schemas.events import ChatTypingData
    from app.ws.connection import registry
    from app.ws.envelope import outgoing

    if not await _is_listed(participant_pk):
        return

    frame = outgoing(
        "chat:typing",
        ChatTypingData(
            roomVersion=store.version(room_pk),
            memberId=member_id,
            typing=typing,
        ).model_dump(),
    )
    await registry.broadcast(room_pk, frame, exclude_participant=participant_pk)
