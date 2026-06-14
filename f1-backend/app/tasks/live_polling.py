"""
Canlı yarış polling görevi.

Her 4 saniyede bir çalışır:
1. Redis'ten aktif oturum anahtarını okur
2. OpenF1'den güncel veri çeker (pozisyon, aralık, tur, bayrak)
3. Değişen verileri Redis pub/sub kanallarına yayınlar
4. WebSocket gateway bu kanalları dinleyip bağlı istemcilere iletir

Celery beat tarafından her 4 saniyede tetiklenir.
"""

import json
import logging
from datetime import datetime, timezone

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# Önceki polling ile aynı veri gelirse yayınlama (değişiklik takibi)
_last_timing_hash: dict[int, str] = {}
_last_positions_hash: dict[int, str] = {}


@celery_app.task(name="app.tasks.live_polling.poll_live_session", bind=True)
def poll_live_session(self) -> dict:
    """Ana polling görevi. Asyncio.run ile async iç fonksiyonu çağırır."""
    import asyncio
    from app.core.redis_client import close_redis

    async def _run():
        try:
            return await _poll_async()
        finally:
            await close_redis()

    return asyncio.run(_run())


async def _poll_async() -> dict:
    import httpx
    from app.core.config import settings
    from app.services import openf1
    from app.services.live_session import (
        clear_active_session,
        check_openf1_live_status,
        get_active_session,
        publish,
        save_live_snapshot,
    )

    active = await get_active_session()
    if active is None:
        return {"status": "no_active_session"}

    session_key: int = active["session_key"]

    # Oturum hâlâ canlı mı?
    status = await check_openf1_live_status(session_key)
    if status == "finished":
        logger.info("Oturum bitti, aktif kayıt temizleniyor: sk=%d", session_key)
        await clear_active_session()
        return {"status": "session_finished", "session_key": session_key}

    base = settings.openf1_base_url
    results: dict[str, int] = {}

    headers = await openf1._auth_headers()
    async with httpx.AsyncClient(timeout=8, headers=headers) as client:

        # ── 1. Anlık Pozisyonlar ────────────────────────────────────────
        try:
            resp = await client.get(f"{base}/position", params={"session_key": session_key})
            if resp.status_code == 200:
                positions_raw = resp.json()
                # Her pilotun en son konumunu al
                latest: dict[int, dict] = {}
                for p in positions_raw:
                    dn = p.get("driver_number")
                    if dn is not None:
                        latest[dn] = p
                positions = list(latest.values())

                payload = {
                    "positions": [
                        {
                            "driver_number": p.get("driver_number"),
                            "x": p.get("x"),
                            "y": p.get("y"),
                            "z": p.get("z"),
                            "date": p.get("date"),
                        }
                        for p in positions
                    ]
                }
                await save_live_snapshot(session_key, "positions", payload)
                await publish(session_key, "positions", payload)
                results["positions"] = len(positions)
        except Exception as e:
            logger.warning("Pozisyon polling hatası: %s", e)

        # ── 2. Aralıklar (timing tower) ─────────────────────────────────
        try:
            resp = await client.get(f"{base}/intervals", params={"session_key": session_key})
            if resp.status_code == 200:
                intervals_raw = resp.json()
                # Her pilot için en son aralık
                latest_i: dict[int, dict] = {}
                for iv in intervals_raw:
                    dn = iv.get("driver_number")
                    if dn is not None:
                        latest_i[dn] = iv

                payload = {
                    "intervals": [
                        {
                            "driver_number": iv.get("driver_number"),
                            "gap_to_leader": iv.get("gap_to_leader"),
                            "interval": iv.get("interval"),
                            "date": iv.get("date"),
                        }
                        for iv in latest_i.values()
                    ]
                }
                await save_live_snapshot(session_key, "timing", payload)
                await publish(session_key, "timing", payload)
                results["intervals"] = len(latest_i)
        except Exception as e:
            logger.warning("Interval polling hatası: %s", e)

        # ── 3. Race Control (bayraklar, SC, VSC) ────────────────────────
        try:
            resp = await client.get(f"{base}/race_control", params={"session_key": session_key})
            if resp.status_code == 200:
                messages = resp.json()
                # Son 60 saniyedeki mesajları gönder
                now = datetime.now(timezone.utc)
                recent = []
                for m in messages[-20:]:  # Son 20 mesajı kontrol et
                    ts_str = m.get("date", "")
                    if ts_str:
                        try:
                            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                            if (now - ts).total_seconds() < 60:
                                recent.append(m)
                        except ValueError:
                            pass

                if recent:
                    payload = {
                        "messages": [
                            {
                                "message": m.get("message"),
                                "flag": m.get("flag"),
                                "category": m.get("category"),
                                "driver_number": m.get("driver_number"),
                                "date": m.get("date"),
                            }
                            for m in recent
                        ]
                    }
                    await publish(session_key, "race_control", payload)
                    results["race_control_msgs"] = len(recent)
        except Exception as e:
            logger.warning("Race control polling hatası: %s", e)

        # ── 4. Takım Radyosu ────────────────────────────────────────────
        try:
            resp = await client.get(f"{base}/team_radio", params={"session_key": session_key})
            if resp.status_code == 200:
                radios = resp.json()
                now = datetime.now(timezone.utc)
                # Son 30 saniyedeki yeni radyo mesajları
                recent_radio = []
                for r in radios[-10:]:
                    ts_str = r.get("date", "")
                    if ts_str:
                        try:
                            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                            if (now - ts).total_seconds() < 30:
                                recent_radio.append(r)
                        except ValueError:
                            pass

                if recent_radio:
                    payload = {
                        "recordings": [
                            {
                                "driver_number": r.get("driver_number"),
                                "recording_url": r.get("recording_url"),
                                "date": r.get("date"),
                            }
                            for r in recent_radio
                        ]
                    }
                    await publish(session_key, "radio", payload)
                    results["radio"] = len(recent_radio)
        except Exception as e:
            logger.warning("Radyo polling hatası: %s", e)

    logger.debug("Poll tamamlandı sk=%d: %s", session_key, results)
    return {"session_key": session_key, "status": "ok", **results}


@celery_app.task(name="app.tasks.live_polling.detect_and_activate_live_session")
def detect_and_activate_live_session() -> dict:
    """
    Mevcut yılda canlı bir oturum olup olmadığını kontrol eder.
    Bulursa otomatik olarak aktive eder.
    Celery beat tarafından her dakika çalıştırılır.
    """
    import asyncio
    from app.core.redis_client import close_redis

    async def _run():
        try:
            return await _detect_async()
        finally:
            await close_redis()

    return asyncio.run(_run())


async def _detect_async() -> dict:
    from datetime import date
    from app.services.live_session import auto_detect_live_session, get_active_session, set_active_session
    from app.services.sync import _determine_current_season

    # Zaten aktif oturum varsa atla
    existing = await get_active_session()
    if existing:
        return {"status": "already_active", "session_key": existing["session_key"]}

    year = _determine_current_season()
    live = await auto_detect_live_session(year)

    if live is None:
        return {"status": "no_live_session"}

    # DB'de session_key ile eşleşen kaydı bul
    from app.core.database import CeleryAsyncSession
    from sqlalchemy import select
    from app.models.f1 import Session

    session_id = None
    async with CeleryAsyncSession() as db:
        result = await db.execute(
            select(Session).where(Session.session_key == live["session_key"])
        )
        s = result.scalar_one_or_none()
        if s:
            session_id = s.id
            s.status = "active"
            await db.commit()

    if session_id:
        await set_active_session(session_id, live["session_key"], year)
        logger.info("Canlı oturum aktive edildi: sk=%d", live["session_key"])
        return {"status": "activated", "session_key": live["session_key"], "session_id": session_id}

    return {"status": "session_not_in_db", "session_key": live["session_key"]}
