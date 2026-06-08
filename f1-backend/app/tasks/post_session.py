"""
Oturum sonrası arka plan görevleri.

Bir F1 oturumu tamamlandıktan sonra çalıştırılır:
1. OpenF1'den tur sürelerini çekip DB'ye yaz
2. Pit stop verilerini senkronize et
3. Stint verilerini senkronize et
4. Aktif sezonun round_status'larını güncelle
"""

import logging
from datetime import date

from sqlalchemy import select

from app.core.database import CeleryAsyncSession
from app.core.redis_client import cache_delete_pattern
from app.models.f1 import Driver, Lap, PitStop, Round, Season, Session
from app.services import openf1
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.post_session.sync_session_laps", bind=True, max_retries=3)
def sync_session_laps(self, session_id: int) -> dict:
    """
    Bir oturumun tüm pilot tur verilerini OpenF1'den çekip veritabanına yazar.
    Celery task'ı olduğu için sync (asyncio.run kullanır).
    """
    import asyncio
    from app.core.redis_client import close_redis

    async def _run():
        try:
            return await _sync_session_laps_async(session_id)
        finally:
            await close_redis()

    return asyncio.run(_run())


async def _sync_session_laps_async(session_id: int) -> dict:
    async with CeleryAsyncSession() as db:
        result = await db.execute(
            select(Session).where(Session.id == session_id)
        )
        session = result.scalar_one_or_none()
        if session is None:
            logger.error("Session bulunamadı: %d", session_id)
            return {"error": "Session not found"}

        if session.session_key is None:
            logger.warning("session_key yok: %d", session_id)
            return {"error": "No session_key"}

        session_key = session.session_key

        # OpenF1'den pilotları al
        of1_drivers = await openf1.fetch_session_drivers(session_key)

        # Pilot numarası → DB driver_id eşleşmesi
        driver_map: dict[int, int] = {}  # driver_number → db.id
        for of1_d in of1_drivers:
            code = (of1_d.get("name_acronym") or "").upper()
            res = await db.execute(
                select(Driver).where(Driver.code == code)
            )
            drv = res.scalar_one_or_none()
            if drv:
                driver_map[of1_d["driver_number"]] = drv.id

        # Her pilot için tur verilerini çek ve yaz
        total_laps = 0
        for driver_number, driver_id in driver_map.items():
            laps_raw = await openf1.fetch_laps(session_key, driver_number)

            for lap_raw in laps_raw:
                # Compound normalize et
                compound = (lap_raw.get("compound") or "UNKNOWN").upper()
                if compound not in ("SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET", "UNKNOWN"):
                    compound = "UNKNOWN"

                # Aynı tur zaten var mı?
                existing = await db.execute(
                    select(Lap).where(
                        Lap.session_id == session_id,
                        Lap.driver_id == driver_id,
                        Lap.lap_number == lap_raw.get("lap_number"),
                    )
                )
                lap = existing.scalar_one_or_none()

                if lap is None:
                    lap = Lap(
                        session_id=session_id,
                        driver_id=driver_id,
                        lap_number=lap_raw.get("lap_number", 0),
                    )
                    db.add(lap)

                lap.lap_time = lap_raw.get("lap_duration")
                lap.sector1_time = lap_raw.get("duration_sector_1")
                lap.sector2_time = lap_raw.get("duration_sector_2")
                lap.sector3_time = lap_raw.get("duration_sector_3")
                lap.compound = compound
                lap.tyre_life = lap_raw.get("stint_tyre_life")
                lap.is_personal_best = lap_raw.get("is_personal_best", False)
                lap.is_pit_out_lap = lap_raw.get("is_pit_out_lap", False)
                lap.is_pit_in_lap = lap_raw.get("is_pit_in_lap", False)
                total_laps += 1

        # Pit stop verilerini çek
        pit_data = await openf1.fetch_stints(session_key)
        total_pits = 0
        for stint in pit_data:
            driver_number = stint.get("driver_number")
            driver_id = driver_map.get(driver_number)
            if driver_id is None:
                continue

            lap_number = stint.get("lap_start", 0)
            existing_pit = await db.execute(
                select(PitStop).where(
                    PitStop.session_id == session_id,
                    PitStop.driver_id == driver_id,
                    PitStop.lap_number == lap_number,
                )
            )
            if existing_pit.scalar_one_or_none() is None:
                pit = PitStop(
                    session_id=session_id,
                    driver_id=driver_id,
                    lap_number=lap_number,
                    tyre_out=(stint.get("compound") or "").upper() or None,
                )
                db.add(pit)
                total_pits += 1

        session.status = "finished"
        await db.commit()

        # Cache temizle
        await cache_delete_pattern(f"session_laps:{session_id}*")
        await cache_delete_pattern(f"pit_stops:{session_id}*")

        logger.info(
            "Session %d sync tamamlandı: %d tur, %d pit stop",
            session_id, total_laps, total_pits,
        )
        return {
            "session_id": session_id,
            "laps_synced": total_laps,
            "pits_synced": total_pits,
        }


@celery_app.task(name="app.tasks.post_session.sync_completed_sessions")
def sync_completed_sessions() -> dict:
    """
    Tarihi geçmiş ama henüz 'finished' olmayan oturumları tespit edip sync eder.
    Her gece çalışır.
    """
    import asyncio
    from app.core.redis_client import close_redis

    async def _run():
        try:
            return await _sync_completed_sessions_async()
        finally:
            await close_redis()

    return asyncio.run(_run())


async def _sync_completed_sessions_async() -> dict:
    from datetime import datetime, timezone

    async with CeleryAsyncSession() as db:
        result = await db.execute(
            select(Session)
            .join(Round, Session.round_id == Round.id)
            .where(
                Session.status != "finished",
                Round.race_date <= date.today(),
                Session.session_key.isnot(None),
            )
        )
        pending = result.scalars().all()

        triggered = []
        for s in pending:
            sync_session_laps.delay(s.id)
            triggered.append(s.id)
            logger.info("Session %d sync task tetiklendi", s.id)

        return {"triggered": triggered}


@celery_app.task(name="app.tasks.post_session.sync_race_weekend_sessions")
def sync_race_weekend_sessions() -> dict:
    """
    Bu haftanın yarış round'u için OpenF1'den session kayıtlarını çeker.
    Round tamamlanmamış olsa bile çalışır. Cuma-Cumartesi-Pazar akşamı tetiklenir.
    """
    import asyncio
    from app.core.redis_client import close_redis

    async def _run():
        try:
            return await _sync_race_weekend_sessions_async()
        finally:
            await close_redis()

    return asyncio.run(_run())


async def _sync_race_weekend_sessions_async() -> dict:
    from datetime import datetime, timedelta, timezone
    from app.services.sync import _determine_current_season, sync_sessions_for_round

    async with CeleryAsyncSession() as db:
        current_year = _determine_current_season()
        result = await db.execute(
            select(Season).where(Season.year == current_year)
        )
        season = result.scalar_one_or_none()
        if season is None:
            return {"error": f"{current_year} sezonu DB'de yok"}

        today = date.today()
        # Bu haftanın round'unu bul: race_date bugünden 2 gün önce ile 3 gün sonrası arasında
        round_result = await db.execute(
            select(Round).where(
                Round.season_id == season.id,
                Round.race_date >= today - timedelta(days=2),
                Round.race_date <= today + timedelta(days=3),
            )
        )
        rnd = round_result.scalar_one_or_none()
        if rnd is None:
            logger.info("Bu hafta için yarış round'u bulunamadı")
            return {"sessions_synced": 0}

        # Session kayıtlarını OpenF1'den çek (round_status'tan bağımsız)
        sessions = await sync_sessions_for_round(rnd, current_year, db)
        await db.commit()

        # Tarihi geçmiş session'lar için lap sync tetikle
        now = datetime.now(timezone.utc)
        triggered = []
        for s in sessions:
            if s.session_key and s.session_date and s.session_date < now:
                sync_session_laps.delay(s.id)
                triggered.append(s.id)
                logger.info("Hafta sonu session %d lap sync tetiklendi", s.id)

        logger.info(
            "Yarış haftası round %d: %d session bulundu, %d lap sync tetiklendi",
            rnd.round_number, len(sessions), len(triggered),
        )
        return {
            "round": rnd.round_number,
            "sessions_found": len(sessions),
            "laps_triggered": triggered,
        }


@celery_app.task(name="app.tasks.post_session.refresh_current_season_rounds")
def refresh_current_season_rounds() -> dict:
    """
    Aktif sezonun round_status'larını bugünün tarihiyle günceller.
    Pazartesi sabahı çalışır.
    """
    import asyncio
    from app.core.redis_client import close_redis

    async def _run():
        try:
            return await _refresh_async()
        finally:
            await close_redis()

    return asyncio.run(_run())


async def _refresh_async() -> dict:
    from app.services.sync import _determine_current_season, _round_status

    async with CeleryAsyncSession() as db:
        current_year = _determine_current_season()
        result = await db.execute(
            select(Season).where(Season.year == current_year)
        )
        season = result.scalar_one_or_none()
        if season is None:
            return {"error": f"{current_year} sezonu DB'de yok"}

        rounds_result = await db.execute(
            select(Round).where(Round.season_id == season.id)
        )
        rounds = rounds_result.scalars().all()
        updated = 0
        for rnd in rounds:
            new_status = _round_status(rnd.race_date)
            if rnd.round_status != new_status:
                rnd.round_status = new_status
                updated += 1

        await db.commit()
        await cache_delete_pattern(f"rounds:{current_year}:*")

        logger.info("%d sezonu: %d round_status güncellendi", current_year, updated)
        return {"year": current_year, "updated": updated}
