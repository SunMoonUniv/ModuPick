from sqlalchemy import select

from app.infra.db.orm_models import ParticipantORM, RoomORM


def test_activity_resets_inactivity_timer(room_service, participant_service, clock):
    room = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    clock.advance(9 * 60)

    participant_service.toggle_ready(room.host.id, True)  # 활동 발생 -> 타이머 리셋
    clock.advance(9 * 60)

    expired = room_service.sweep_expired_rooms(clock.now())
    assert expired == []


def test_deleting_room_cascades_to_participants(room_service, participant_service, session):
    room = room_service.create_room(title=None, capacity=None, host_nickname="지호")
    participant_service.join(room.room.code, "서연")

    room_service.delete_room(room.room.id)

    assert session.execute(select(RoomORM).where(RoomORM.id == room.room.id)).scalar_one_or_none() is None
    remaining = session.execute(
        select(ParticipantORM).where(ParticipantORM.room_id == room.room.id)
    ).scalars().all()
    assert remaining == []


def test_last_participant_leaving_deletes_room_and_participants(room_service, participant_service, session):
    room = room_service.create_room(title=None, capacity=None, host_nickname="지호")

    participant_service.leave(room.room.id, room.host.id)

    assert session.execute(select(RoomORM).where(RoomORM.id == room.room.id)).scalar_one_or_none() is None
    remaining = session.execute(
        select(ParticipantORM).where(ParticipantORM.room_id == room.room.id)
    ).scalars().all()
    assert remaining == []
