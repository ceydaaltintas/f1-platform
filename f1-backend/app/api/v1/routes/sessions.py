import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.redis_client import cache_get, cache_key, cache_set
from app.models.f1 import Driver, DriverSession, Lap, PitStop, Session
from app.schemas.f1 import DriverSessionOut, LapOut, PitStopOut
from app.services import db_cache, openf1

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

    if laps:
        data = [
            {
                **LapOut.model_validate(lap).model_dump(mode="json"),
                "driver_code": lap.driver.code,
                "driver_id": lap.driver_id,
            }
            for lap in laps
        ]
        await cache_set(cache_k, data, ttl_seconds=86_400)
        return data

    # Lap tablosu boş — bitmiş session için db_cache üzerinden inline çek
    session_res = await db.execute(select(Session).where(Session.id == session_id))
    session = session_res.scalar_one_or_none()
    if session is None or not session.session_key or session.status != "finished":
        return []

    of1_drivers = await db_cache.get_session_drivers(session)
    driver_map: dict[int, tuple[str, int | None]] = {}
    for d in of1_drivers:
        code = (d.get("name_acronym") or "").upper()
        dn = d.get("driver_number")
        if not dn:
            continue
        drv_res = await db.execute(select(Driver).where(Driver.code == code))
        drv = drv_res.scalar_one_or_none()
        driver_map[dn] = (code, drv.id if drv else None)

    sem = asyncio.Semaphore(5)

    async def _fetch_driver_laps(dn: int, code: str, drv_id: int | None) -> list[dict]:
        async with sem:
            raw_laps = await db_cache.get_laps(session, dn, db)
        return [
            {
                "lap_number": lap.get("lap_number"),
                "lap_time": lap.get("lap_duration"),
                "sector1_time": lap.get("duration_sector_1"),
                "sector2_time": lap.get("duration_sector_2"),
                "sector3_time": lap.get("duration_sector_3"),
                "compound": (lap.get("compound") or "UNKNOWN").upper(),
                "tyre_life": lap.get("stint_tyre_life"),
                "is_personal_best": bool(lap.get("is_personal_best", False)),
                "is_pit_out_lap": bool(lap.get("is_pit_out_lap", False)),
                "is_pit_in_lap": bool(lap.get("is_pit_in_lap", False)),
                "driver_code": code,
                "driver_id": drv_id,
            }
            for lap in raw_laps
        ]

    nested = await asyncio.gather(*[
        _fetch_driver_laps(dn, code, drv_id)
        for dn, (code, drv_id) in driver_map.items()
    ])
    data = [item for sublist in nested for item in sublist]
    data.sort(key=lambda x: (x["driver_id"] or 0, x["lap_number"] or 0))
    if data:
        await cache_set(cache_k, data, ttl_seconds=86_400)
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
