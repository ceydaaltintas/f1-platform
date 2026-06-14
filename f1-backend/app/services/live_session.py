"""
Canlı yarış oturum yöneticisi.

Aktif oturumu Redis'te saklar ve OpenF1'den durum sorgular.
Diğer modüller bu servisi kullanarak "şu an canlı var mı?" sorusunu yanıtlar.
"""

import json
import logging
from datetime import datetime, timezone

import httpx

from app.core.config import settings
from app.core.redis_client import cache_delete, cache_get, cache_set, get_redis
from app.services import openf1

logger = logging.getLogger(__name__)

# Redis anahtarları
KEY_ACTIVE_SESSION    = "f1:active_session"      # {"session_id": int, "session_key": int, "year": int}
KEY_LIVE_STATE        = "f1:live:state:{sk}"     # Son timing/pozisyon snapshot'ı
KEY_LAST_POLL_TS      = "f1:live:last_poll:{sk}"  # Son polling timestamp'i
CHANNEL_PREFIX        = "f1:live:{sk}"           # Redis pub/sub kanal tabanı


def make_channel(session_key: int, kind: str) -> str:
    """Pub/sub kanal adı üretir. kind: timing | positions | race_control | radio"""
    return f"f1:live:{session_key}:{kind}"


# ─── Aktif Oturum ───────────────────────────────────────────────────────────

async def set_active_session(session_id: int, session_key: int, year: int) -> None:
    """Aktif canlı oturumu Redis'e yazar. TTL: 6 saat (bir yarış süresi)."""
    data = {"session_id": session_id, "session_key": session_key, "year": year}
    await cache_set(KEY_ACTIVE_SESSION, data, ttl_seconds=6 * 3600)
    logger.info("Aktif oturum ayarlandı: session_id=%d, session_key=%d", session_id, session_key)


async def get_active_session() -> dict | None:
    """Aktif oturumu döner. Yoksa None."""
    return await cache_get(KEY_ACTIVE_SESSION)


async def clear_active_session() -> None:
    """Aktif oturumu temizler (yarış bitti veya manuel)."""
    await cache_delete(KEY_ACTIVE_SESSION)
    logger.info("Aktif oturum temizlendi")


# ─── OpenF1 Canlılık Kontrolü ───────────────────────────────────────────────

async def check_openf1_live_status(session_key: int) -> str:
    """
    OpenF1'den oturum durumunu sorgular.
    Döner: "live" | "finished" | "unknown"
    """
    try:
        headers = await openf1._auth_headers()
        async with httpx.AsyncClient(timeout=10, headers=headers) as client:
            resp = await client.get(
                f"{settings.openf1_base_url}/sessions",
                params={"session_key": session_key},
            )
            resp.raise_for_status()
            data = resp.json()
            if not data:
                return "unknown"
            session = data[0]
            status = (session.get("session_status") or "").lower()
            if status in ("started", "active", "aborted"):
                return "live"
            if status in ("finished", "complete"):
                return "finished"
            return "unknown"
    except Exception as e:
        logger.warning("OpenF1 canlılık kontrolü başarısız: %s", e)
        return "unknown"


async def auto_detect_live_session(year: int) -> dict | None:
    """
    Mevcut yılda aktif bir oturum bulmaya çalışır.
    Bulursa {"session_key": int, "meeting_key": int, "name": str} döner.
    """
    try:
        headers = await openf1._auth_headers()
        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            resp = await client.get(
                f"{settings.openf1_base_url}/sessions",
                params={"year": year},
            )
            resp.raise_for_status()
            sessions = resp.json()

        now = datetime.now(timezone.utc)
        for s in sessions:
            date_start_str = s.get("date_start")
            date_end_str   = s.get("date_end")
            if not date_start_str:
                continue
            try:
                date_start = datetime.fromisoformat(date_start_str.replace("Z", "+00:00"))
                date_end   = datetime.fromisoformat(date_end_str.replace("Z", "+00:00")) if date_end_str else None
            except ValueError:
                continue

            # Canlı pencere: başlamış ama bitmemiş
            if date_start <= now and (date_end is None or date_end >= now):
                logger.info("Canlı oturum tespit edildi: %s (sk=%s)", s.get("session_name"), s.get("session_key"))
                return {
                    "session_key": s.get("session_key"),
                    "meeting_key": s.get("meeting_key"),
                    "session_name": s.get("session_name"),
                    "circuit": s.get("circuit_short_name"),
                }
        return None
    except Exception as e:
        logger.warning("Otomatik oturum tespiti başarısız: %s", e)
        return None


# ─── Live State Snapshot ────────────────────────────────────────────────────

async def save_live_snapshot(session_key: int, kind: str, data: dict) -> None:
    """Son polling sonucunu Redis'e yazar (WebSocket geç bağlanan istemciler için)."""
    key = f"f1:live:snapshot:{session_key}:{kind}"
    await cache_set(key, data, ttl_seconds=120)


async def get_live_snapshot(session_key: int, kind: str) -> dict | None:
    """Son kaydedilen snapshot'ı döner."""
    key = f"f1:live:snapshot:{session_key}:{kind}"
    return await cache_get(key)


# ─── Redis Pub/Sub Yayını ───────────────────────────────────────────────────

async def publish(session_key: int, kind: str, data: dict) -> None:
    """Veriyi Redis pub/sub kanalına yayınlar."""
    r = await get_redis()
    channel = make_channel(session_key, kind)
    payload = json.dumps({"type": kind, "data": data, "ts": datetime.now(timezone.utc).isoformat()})
    await r.publish(channel, payload)
