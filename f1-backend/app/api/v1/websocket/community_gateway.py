"""
Community WebSocket kapısı.

URL: /ws/community/{session_id}

Yalnızca dinleme (read-only) kanalıdır.
Yazma işlemleri (yorum, oy) REST üzerinden yapılır,
REST handler Redis'e yayınlar, bu gateway istemcilere iletir.

Kanallar:
  f1:community:{session_id}:comment     → yeni yorum
  f1:community:{session_id}:poll_new    → yeni anket
  f1:community:{session_id}:poll_update → anket güncelleme (oy)
  f1:community:{session_id}:reaction    → anlık tepki
"""

import asyncio
import json
import logging
from datetime import UTC, datetime

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

COMMUNITY_CHANNELS = ["comment", "poll_new", "poll_update", "reaction"]


async def community_websocket_handler(websocket: WebSocket, session_id: int) -> None:
    await websocket.accept()
    logger.info("Community WS bağlantısı: session_id=%d", session_id)

    await websocket.send_json({
        "type": "connected",
        "session_id": session_id,
        "channels": COMMUNITY_CHANNELS,
        "ts": datetime.now(UTC).isoformat(),
    })

    redis_task = asyncio.create_task(
        _community_redis_listener(websocket, session_id)
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        logger.info("Community WS kesildi: session_id=%d", session_id)
    finally:
        redis_task.cancel()
        try:
            await redis_task
        except asyncio.CancelledError:
            pass


async def _community_redis_listener(websocket: WebSocket, session_id: int) -> None:
    import redis.asyncio as aioredis
    from app.core.config import settings

    r = aioredis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    pubsub = r.pubsub()

    channels = [f"f1:community:{session_id}:{kind}" for kind in COMMUNITY_CHANNELS]
    await pubsub.subscribe(*channels)
    logger.debug("Community pub/sub abone: %s", channels)

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                await websocket.send_text(message["data"])
            except Exception:
                break
    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(*channels)
        await pubsub.close()
        await r.aclose()
