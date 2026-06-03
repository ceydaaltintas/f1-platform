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
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.f1 import (
    JolpicaSeasonCache,
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
            db.add(OpenF1LapsCache(
                session_key=session_key,
                driver_number=driver_number,
                data=data,
            ))
            await db.commit()
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
            db.add(OpenF1StintsCache(session_key=session_key, data=data))
            await db.commit()
        return data or []

    return await openf1.fetch_stints(session_key) or []


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
