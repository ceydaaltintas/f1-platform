from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.redis_client import cache_get, cache_key, cache_set
from app.models.f1 import DriverSession, Lap, PitStop, Session
from app.schemas.f1 import DriverSessionOut, LapOut, PitStopOut

router = APIRouter(tags=["sessions"])


@router.get("/sessions/{session_id}", response_model=dict)
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.round))
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "Oturum bulunamadı")
    return {
        "id": session.id,
        "type": session.type,
        "status": session.status,
        "session_date": session.session_date,
        "session_key": session.session_key,
        "round": {
            "id": session.round.id,
            "name": session.round.name,
            "round_number": session.round.round_number,
        },
    }


@router.get("/sessions/{session_id}/results", response_model=list[DriverSessionOut])
async def get_session_results(session_id: int, db: AsyncSession = Depends(get_db)):
    cache_k = cache_key("session_results", session_id)
    cached = await cache_get(cache_k)
    if cached:
        return cached

    result = await db.execute(
        select(DriverSession)
        .where(DriverSession.session_id == session_id)
        .options(
            selectinload(DriverSession.driver).selectinload(DriverSession.driver.property.mapper.class_.current_team),
            selectinload(DriverSession.team),
        )
        .order_by(DriverSession.finish_position)
    )
    results = result.scalars().all()
    data = [DriverSessionOut.model_validate(r).model_dump(mode="json") for r in results]
    await cache_set(cache_k, data, ttl_seconds=600)
    return data


@router.get("/sessions/{session_id}/laps", response_model=list[dict])
async def get_session_laps(session_id: int, db: AsyncSession = Depends(get_db)):
    """Tüm pilotların tur verilerini döner."""
    cache_k = cache_key("session_laps", session_id)
    cached = await cache_get(cache_k)
    if cached:
        return cached

    result = await db.execute(
        select(Lap)
        .where(Lap.session_id == session_id)
        .options(selectinload(Lap.driver))
        .order_by(Lap.driver_id, Lap.lap_number)
    )
    laps = result.scalars().all()
    data = [
        {
            **LapOut.model_validate(lap).model_dump(mode="json"),
            "driver_code": lap.driver.code,
            "driver_id": lap.driver_id,
        }
        for lap in laps
    ]
    await cache_set(cache_k, data, ttl_seconds=600)
    return data


@router.get("/sessions/{session_id}/laps/{driver_code}", response_model=list[LapOut])
async def get_driver_laps(
    session_id: int,
    driver_code: str,
    db: AsyncSession = Depends(get_db),
):
    from app.models.f1 import Driver

    driver_result = await db.execute(
        select(Driver).where(Driver.code == driver_code.upper())
    )
    driver = driver_result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(404, f"Pilot bulunamadı: {driver_code}")

    result = await db.execute(
        select(Lap)
        .where(Lap.session_id == session_id, Lap.driver_id == driver.id)
        .order_by(Lap.lap_number)
    )
    return result.scalars().all()


@router.get("/sessions/{session_id}/pit_stops", response_model=list[PitStopOut])
async def get_pit_stops(session_id: int, db: AsyncSession = Depends(get_db)):
    cache_k = cache_key("pit_stops", session_id)
    cached = await cache_get(cache_k)
    if cached:
        return cached

    result = await db.execute(
        select(PitStop)
        .where(PitStop.session_id == session_id)
        .order_by(PitStop.lap_number)
    )
    data = [PitStopOut.model_validate(p).model_dump(mode="json") for p in result.scalars().all()]
    await cache_set(cache_k, data, ttl_seconds=600)
    return data
