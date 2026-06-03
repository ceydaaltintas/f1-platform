"""
WebSocket yarış kapısı (gateway).

Bağlantı akışı:
1. İstemci /ws/race/{session_id} adresine bağlanır
2. Sunucu Redis'ten aktif session_key'i alır
3. Redis pub/sub kanallarını dinleyen bir arka plan görevi başlatır
4. Gelen mesajlar doğrudan WebSocket'e iletilir
5. İstemci bağlantısı kesilince kaynak temizlenir

Protocol:
  Client → Server: {"type": "subscribe", "channels": ["timing", "positions", "race_control", "radio"]}
  Server → Client: {"type": "timing", "data": {...}, "ts": "..."}
  Server → Client: {"type": "positions", "data": {...}, "ts": "..."}
  Server → Client: {"type": "race_control", "data": {...}, "ts": "..."}
  Server → Client: {"type": "radio", "data": {...}, "ts": "..."}
  Server → Client: {"type": "error", "message": "..."}
  Server → Client: {"type": "connected", "session_key": int, "channels": [...]}
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect

from app.services.live_session import (
    get_active_session,
    get_live_snapshot,
    make_channel,
)

logger = logging.getLogger(__name__)

ALL_CHANNELS = ["timing", "positions", "race_control", "radio"]


async def race_websocket_handler(websocket: WebSocket, session_id: int) -> None:
    """
    Ana WebSocket işleyicisi. FastAPI route'undan doğrudan çağrılır.
    """
    await websocket.accept()
    logger.info("WS bağlantısı: session_id=%d", session_id)

    # Aktif oturumu kontrol et
    active = await get_active_session()
    if active is None or active.get("session_id") != session_id:
        await websocket.send_json({
            "type": "error",
            "message": f"session_id={session_id} şu an canlı değil. "
                       "POST /api/v1/live/activate ile aktif edilmesi gerekir.",
        })
        await websocket.close(code=4004)
        return

    session_key: int = active["session_key"]
    subscribed_channels = list(ALL_CHANNELS)  # Varsayılan: hepsi

    # Bağlantı onayını gönder
    await websocket.send_json({
        "type": "connected",
        "session_id": session_id,
        "session_key": session_key,
        "channels": subscribed_channels,
    })

    # Geç bağlanan istemciler için son snapshot'ları gönder
    for kind in subscribed_channels:
        snapshot = await get_live_snapshot(session_key, kind)
        if snapshot:
            await websocket.send_json({
                "type": kind,
                "data": snapshot,
                "ts": datetime.now(timezone.utc).isoformat(),
                "is_snapshot": True,
            })

    # Redis pub/sub dinleyicisi
    redis_task = asyncio.create_task(
        _redis_listener(websocket, session_key, subscribed_channels)
    )

    try:
        # İstemciden gelen mesajları işle (subscribe güncelleme gibi)
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("type") == "subscribe":
                    new_channels = msg.get("channels", ALL_CHANNELS)
                    subscribed_channels[:] = [c for c in new_channels if c in ALL_CHANNELS]
                    await websocket.send_json({
                        "type": "subscribed",
                        "channels": subscribed_channels,
                    })
                elif msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        logger.info("WS bağlantısı kesildi: session_id=%d", session_id)
    finally:
        redis_task.cancel()
        try:
            await redis_task
        except asyncio.CancelledError:
            pass


async def _redis_listener(
    websocket: WebSocket,
    session_key: int,
    channels: list[str],
) -> None:
    """
    Redis pub/sub kanallarını dinler ve gelen mesajları WebSocket'e iletir.
    """
    import redis.asyncio as aioredis
    from app.core.config import settings

    # Ayrı bir Redis bağlantısı (pub/sub blocking için)
    r = aioredis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    pubsub = r.pubsub()

    channel_names = [make_channel(session_key, kind) for kind in channels]
    await pubsub.subscribe(*channel_names)
    logger.debug("Redis pub/sub abone olundu: %s", channel_names)

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                await websocket.send_text(message["data"])
            except Exception:
                break  # WebSocket kapatılmış
    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(*channel_names)
        await pubsub.close()
        await r.aclose()
        logger.debug("Redis pub/sub bağlantısı kapatıldı")
