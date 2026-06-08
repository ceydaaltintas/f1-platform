"""
DB-aware veri çekme katmanı.

Biten session'lar için OpenF1 verisi PostgreSQL'e kalıcı olarak kaydedilir.
Geçmiş sezon Jolpica verisi de aynı şekilde DB'de tutulur.

Akış:
  DB'de var mı? → Evet → DB'den dön (hızlı, ~5ms)
                → Hayır → API'den çek → DB'ye kaydet → dön
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.f1 import (
    Driver,
    JolpicaSeasonCache,
    Lap,
    OpenF1CarDataCache,
    OpenF1LapsCache,
    OpenF1StintsCache,
    Session as F1Session,
)
from app.services import jolpica, openf1

logger = logging.getLogger(__name__)


def _is_finished(session: F1Session) -> bool:
    return session.status == "finished"


# ─── OpenF1 Laps ─────────────────────────────────────────────────────────────

async def get_laps(
    session: F1Session,
    driver_number: int,
    db: AsyncSession,
) -> list[dict]:
    """
    Bir pilotun tur verilerini döner.
    Biten session → DB'den (kalıcı cache).
    Aktif/upcoming → doğrudan OpenF1.
    """
    session_key = session.session_key
    if not session_key:
        return []

    if _is_finished(session):
        # DB'de var mı?
        row = await db.get(OpenF1LapsCache, (session_key, driver_number))
        if row:
            return row.data

        # Yok → OpenF1'den çek
        logger.info("DB cache miss: laps session_key=%s driver=%s", session_key, driver_number)
        data = await openf1.fetch_laps(session_key, driver_number)
        if data:
            try:
                db.add(OpenF1LapsCache(
                    session_key=session_key,
                    driver_number=driver_number,
                    data=data,
                ))
                await db.commit()
            except IntegrityError:
                await db.rollback()
                row = await db.get(OpenF1LapsCache, (session_key, driver_number))
                if row:
                    return row.data
        return data or []

    # Aktif session → direkt API
    return await openf1.fetch_laps(session_key, driver_number) or []


# ─── OpenF1 Stints ───────────────────────────────────────────────────────────

async def get_stints(
    session: F1Session,
    db: AsyncSession,
) -> list[dict]:
    """
    Bir session'ın tüm stint verilerini döner.
    Biten session → DB'den kalıcı cache.
    """
    session_key = session.session_key
    if not session_key:
        return []

    if _is_finished(session):
        row = await db.get(OpenF1StintsCache, session_key)
        if row:
            return row.data

        logger.info("DB cache miss: stints session_key=%s", session_key)
        data = await openf1.fetch_stints(session_key)
        if data:
            try:
                db.add(OpenF1StintsCache(session_key=session_key, data=data))
                await db.commit()
            except IntegrityError:
                await db.rollback()
                row = await db.get(OpenF1StintsCache, session_key)
                if row:
                    return row.data
        return data or []

    return await openf1.fetch_stints(session_key) or []


# ─── OpenF1 Session Drivers ──────────────────────────────────────────────────

async def get_session_drivers(session: F1Session) -> list[dict]:
    """
    Session pilotlarını döner.
    Biten session → Redis 24 saat cache.
    Aktif/upcoming → Redis 5 dakika cache.
    """
    from app.core.redis_client import cache_get, cache_key, cache_set

    session_key = session.session_key
    if not session_key:
        return []

    ck = cache_key("session_drivers", session_key)
    cached = await cache_get(ck)
    if cached:
        return cached

    data = await openf1.fetch_session_drivers(session_key) or []
    if data:
        ttl = 86_400 if _is_finished(session) else 300
        await cache_set(ck, data, ttl_seconds=ttl)
    return data


# ─── OpenF1 Car Data ─────────────────────────────────────────────────────────

async def get_car_data(
    session: F1Session,
    driver_number: int,
    db: AsyncSession,
) -> list[dict]:
    """
    Bir pilotun ham araba telemetri verisini döner.
    Biten session → DB'den kalıcı cache.
    Aktif/upcoming → doğrudan OpenF1.
    """
    session_key = session.session_key
    if not session_key:
        return []

    if _is_finished(session):
        row = await db.get(OpenF1CarDataCache, (session_key, driver_number))
        if row:
            return row.data

        logger.info("DB cache miss: car_data session_key=%s driver=%s", session_key, driver_number)
        data = await openf1.fetch_car_data(session_key, driver_number)
        if data:
            try:
                db.add(OpenF1CarDataCache(
                    session_key=session_key,
                    driver_number=driver_number,
                    data=data,
                ))
                await db.commit()
            except IntegrityError:
                await db.rollback()
                row = await db.get(OpenF1CarDataCache, (session_key, driver_number))
                if row:
                    return row.data
        return data or []

    return await openf1.fetch_car_data(session_key, driver_number) or []


# ─── Jolpica Sezon Sonuçları ──────────────────────────────────────────────────

async def get_season_all_results(year: int, db: AsyncSession) -> list[dict]:
    """
    Bir sezonun tüm yarış sonuçlarını döner.
    Geçmiş sezon → DB'den kalıcı (bir kez çekip sonsuza dek saklar).
    Güncel sezon → Redis cache + Jolpica (değişebilir).
    """
    from datetime import date
    current_year = date.today().year

    if year < current_year:
        # Geçmiş sezon — DB'ye bak
        row = await db.get(JolpicaSeasonCache, year)
        if row:
            return row.data

        logger.info("DB cache miss: jolpica season results year=%s", year)
        data = await jolpica.fetch_all_season_results(year)
        if data:
            db.add(JolpicaSeasonCache(year=year, results_data=data))
            await db.commit()
        return data or []

    # Güncel sezon → mevcut Redis cache akışı devam eder
    from app.core.redis_client import cache_get, cache_key, cache_set
    ck = cache_key("season_all_results", year)
    cached = await cache_get(ck)
    if cached:
        return cached
    data = await jolpica.fetch_all_season_results(year)
    if data:
        await cache_set(ck, data, ttl_seconds=3600)
    return data or []


# ─── Bulk Lap Sync (tek API çağrısı) ─────────────────────────────────────────

async def bulk_sync_to_lap_table(session: F1Session, db: AsyncSession) -> int:
    """
    Tüm pilotların turlarını TEK OpenF1 API çağrısıyla alır ve Lap tablosuna bulk yazar.
    İlk açılışta ~2-3 saniye. Sonraki açılışlar anında Lap tablosundan gelir.
    """
    if not _is_finished(session) or not session.session_key:
        return 0

    session_key = session.session_key

    # 1. Tek API çağrısı — tüm pilotların turları
    all_laps_raw = await openf1.fetch_all_session_laps(session_key)
    if not all_laps_raw:
        return 0

    # 2. Driver number → DB id eşleştirmesi (2 sorgu)
    of1_drivers = await openf1.fetch_session_drivers(session_key)
    codes = [(d.get("name_acronym") or "").upper() for d in of1_drivers]
    driver_number_to_id: dict[int, int] = {}
    if codes:
        drv_res = await db.execute(select(Driver).where(Driver.code.in_(codes)))
        code_to_id = {d.code: d.id for d in drv_res.scalars()}
        for d in of1_drivers:
            code = (d.get("name_acronym") or "").upper()
            dn = d.get("driver_number")
            if dn and code in code_to_id:
                driver_number_to_id[dn] = code_to_id[code]

    # 3. Mevcut turları tek sorguda al → set'e al (O(1) lookup)
    existing_res = await db.execute(
        select(Lap.driver_id, Lap.lap_number).where(Lap.session_id == session.id)
    )
    existing_set = {(row.driver_id, row.lap_number) for row in existing_res}

    # 4. Yeni Lap objelerini bellekte hazırla
    VALID_COMPOUNDS = {"SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"}
    new_laps = []
    for lap_raw in all_laps_raw:
        dn        = lap_raw.get("driver_number")
        driver_id = driver_number_to_id.get(dn)
        lap_num   = lap_raw.get("lap_number")
        if not driver_id or not lap_num:
            continue
        if (driver_id, lap_num) in existing_set:
            continue

        compound = (lap_raw.get("compound") or "UNKNOWN").upper()
        if compound not in VALID_COMPOUNDS:
            compound = "UNKNOWN"

        new_laps.append(Lap(
            session_id       = session.id,
            driver_id        = driver_id,
            lap_number       = lap_num,
            lap_time         = lap_raw.get("lap_duration"),
            sector1_time     = lap_raw.get("duration_sector_1"),
            sector2_time     = lap_raw.get("duration_sector_2"),
            sector3_time     = lap_raw.get("duration_sector_3"),
            compound         = compound,
            tyre_life        = lap_raw.get("stint_tyre_life"),
            is_personal_best = bool(lap_raw.get("is_personal_best", False)),
            is_pit_out_lap   = bool(lap_raw.get("is_pit_out_lap", False)),
            is_pit_in_lap    = bool(lap_raw.get("is_pit_in_lap", False)),
        ))

    # 5. Lap tablosuna bulk yaz
    try:
        if new_laps:
            db.add_all(new_laps)

        # OpenF1LapsCache'e de yaz (track_map ve telemetri için date_start gerekli)
        laps_by_dn: dict[int, list] = {}
        for lap_raw in all_laps_raw:
            dn = lap_raw.get("driver_number")
            if dn:
                laps_by_dn.setdefault(dn, []).append(lap_raw)

        existing_cache_res = await db.execute(
            select(OpenF1LapsCache.driver_number)
            .where(OpenF1LapsCache.session_key == session_key)
        )
        existing_cache_dns = {row.driver_number for row in existing_cache_res}

        for dn, laps in laps_by_dn.items():
            if dn not in existing_cache_dns:
                db.add(OpenF1LapsCache(session_key=session_key, driver_number=dn, data=laps))

        await db.commit()
    except IntegrityError:
        await db.rollback()
        logger.warning("Bulk sync IntegrityError — kısmi veri zaten vardı")
    except Exception as e:
        await db.rollback()
        logger.error("Bulk lap sync commit hatası: %s", e)
        return 0

    logger.info("Session %d: %d tur Lap+Cache tablosuna yazıldı", session.id, len(new_laps))
    return len(new_laps)


# ─── Eksik Veri Koruması ─────────────────────────────────────────────────────

async def ensure_laps_synced(session: F1Session, db: AsyncSession) -> None:
    """
    Bitmiş session için tüm pilotların tur verilerinin DB'de olduğundan emin olur.
    15'ten az pilot cache'deyse sync_session() çağırır (sıralı, rate-limit uyumlu).
    Leaderboard/pace gibi tüm pilotları gerektiren endpoint'ler bunu çağırır.
    """
    if not _is_finished(session) or not session.session_key:
        return

    from sqlalchemy import func
    result = await db.execute(
        select(func.count()).select_from(OpenF1LapsCache)
        .where(OpenF1LapsCache.session_key == session.session_key)
    )
    cached_count = result.scalar_one()
    if cached_count < 15:
        logger.info(
            "Session %s için %d pilot cache'de, tam sync başlıyor",
            session.session_key, cached_count,
        )
        await sync_session(session, db)


# ─── Toplu Session Sync ───────────────────────────────────────────────────────

async def sync_session(session: F1Session, db: AsyncSession) -> dict:
    """
    Biten bir session'ın tüm verisini DB'ye sync eder.
    Tüm pilotların lap + stint verilerini çeker ve kaydeder.
    """
    if not _is_finished(session):
        return {"status": "skipped", "reason": "session not finished"}

    session_key = session.session_key
    if not session_key:
        return {"status": "skipped", "reason": "no session_key"}

    import asyncio

    synced_drivers = 0
    errors = []

    # Stints — zaten cache'de değilse çek
    stints_row = await db.get(OpenF1StintsCache, session_key)
    if not stints_row:
        try:
            stints = await openf1.fetch_stints(session_key)
            if stints:
                db.add(OpenF1StintsCache(session_key=session_key, data=stints))
                await db.commit()
        except Exception as e:
            errors.append(f"stints: {e}")

    # Pilotlar — sıralı işle (rate limit: 3 req/s)
    try:
        drivers = await openf1.fetch_session_drivers(session_key)
    except Exception as e:
        return {"status": "error", "reason": f"drivers fetch failed: {e}"}

    for d in drivers:
        dn = d.get("driver_number")
        if not dn:
            continue
        row = await db.get(OpenF1LapsCache, (session_key, dn))
        if row:
            synced_drivers += 1
            continue
        try:
            laps = await openf1.fetch_laps(session_key, dn)
            if laps:
                db.add(OpenF1LapsCache(
                    session_key=session_key,
                    driver_number=dn,
                    data=laps,
                ))
                await db.commit()
                synced_drivers += 1
            await asyncio.sleep(0.35)  # ~3 req/s limit
        except Exception as e:
            errors.append(f"driver {dn}: {e}")
            await asyncio.sleep(1)

    return {
        "status":         "ok",
        "session_key":    session_key,
        "synced_drivers": synced_drivers,
        "total_drivers":  len(drivers),
        "errors":         errors,
    }
