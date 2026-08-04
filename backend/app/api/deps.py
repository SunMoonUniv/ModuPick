"""요청 의존성 — 토큰 검증과 멱등 키.

토큰 검증은 두 겹이다.

    1. 인메모리 맵에서 바인딩을 찾는다
    2. **DB에서 참가자를 조회해 left_at이 비어 있는지 확인한다**

2번이 필요한 이유는 슬롯 회수와 토큰 제거가 같은 트랜잭션이 아니기 때문이다.
슬롯은 DB의 left_at이 관리하고 토큰은 메모리에 있어, 회수 경로 하나라도 토큰 제거를
빠뜨리면 가리킬 참가자가 없는 토큰이 남는다. 여기서 한 번 더 보면 그 구멍이 닫힌다.

**권한은 토큰에서 읽지 않는다.** 방장 여부는 조회한 participants.role로 판단한다.
"""

import hashlib
import json
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Path, Request
from sqlalchemy import select

from app.domain import errors
from app.domain.enums import MemberStatus, Role
from app.infra.db.session import readonly
from app.infra.db.tables import participants, rooms
from app.infra.memory.runtime_store import store


@dataclass(frozen=True, slots=True)
class MemberContext:
    """요청을 보낸 참가자. 전부 서버가 조회한 값이며 클라이언트 주장이 아니다."""

    token: str
    participant_pk: int
    member_id: str
    room_pk: int
    room_code: str
    status: MemberStatus
    role: Role

    @property
    def is_host(self) -> bool:
        return self.role is Role.HOST

    @property
    def is_active(self) -> bool:
        return self.status is MemberStatus.ACTIVE


def _bearer(authorization: str | None) -> str:
    if not authorization:
        raise errors.DomainError(errors.COMMON_UNAUTHENTICATED)
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise errors.DomainError(errors.COMMON_UNAUTHENTICATED)
    return token.strip()


async def require_member(
    code: Annotated[str, Path()],
    authorization: Annotated[str | None, Header()] = None,
) -> MemberContext:
    token = _bearer(authorization)

    binding = store.resolve_token(token)
    if binding is None:
        raise errors.DomainError(errors.COMMON_SESSION_EXPIRED)

    if binding.room_code != code:
        # 다른 방의 토큰으로 접근했다. 방 존재 여부를 알려주지 않는다.
        raise errors.DomainError(errors.COMMON_SESSION_EXPIRED)

    async with readonly() as conn:
        row = (
            await conn.execute(
                select(
                    participants.c.id,
                    participants.c.member_id,
                    participants.c.room_id,
                    participants.c.status,
                    participants.c.role,
                    participants.c.left_at,
                    rooms.c.code,
                )
                .select_from(participants.join(rooms, participants.c.room_id == rooms.c.id))
                .where(participants.c.id == binding.participant_id)
            )
        ).first()

    if row is None or row.left_at is not None:
        # 슬롯이 회수됐거나 방이 사라졌다. 남은 토큰을 여기서 정리한다.
        store.revoke_token(token)
        raise errors.DomainError(errors.COMMON_SESSION_EXPIRED)

    return MemberContext(
        token=token,
        participant_pk=row.id,
        member_id=row.member_id,
        room_pk=row.room_id,
        room_code=row.code,
        status=MemberStatus(row.status),
        role=Role(row.role),
    )


async def require_active_member(
    member: Annotated[MemberContext, Depends(require_member)],
) -> MemberContext:
    """프로필을 확정한 참가자만 통과시킨다."""
    if not member.is_active:
        raise errors.DomainError(errors.MEMBER_NOT_ACTIVE)
    return member


@dataclass(frozen=True, slots=True)
class IdempotencyKey:
    """Idempotency-Key 헤더. **강제하지 않는다** — 없으면 그냥 처리한다.

    같은 키로 같은 본문이 다시 오면 최초 응답을 그대로 재현하고, 같은 키에 다른
    본문이 오면 거절한다. 본문 해시를 함께 보관해 대조한다.
    """

    key: str | None

    @staticmethod
    def hash_body(body: object) -> str:
        payload = json.dumps(body, sort_keys=True, ensure_ascii=False, default=str)
        return hashlib.sha256(payload.encode()).hexdigest()

    def replay(self, body: object) -> tuple[int, dict] | None:
        """재전송이면 (status, payload)를 돌려준다."""
        if self.key is None:
            return None
        entry = store.idem_get(self.key)
        if entry is None:
            return None
        if entry.body_hash != self.hash_body(body):
            raise errors.DomainError(errors.COMMON_IDEMPOTENCY_CONFLICT)
        return entry.status, entry.payload

    def remember(self, body: object, status: int, payload: dict) -> None:
        if self.key is None:
            return
        store.idem_put(self.key, self.hash_body(body), status, payload)


async def idempotency_key(
    request: Request,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> IdempotencyKey:
    del request
    return IdempotencyKey(key=idempotency_key)
