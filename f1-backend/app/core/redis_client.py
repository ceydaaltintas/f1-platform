import asyncio
import json
from typing import Any

import redis.asyncio as aioredis

from app.core.config import settings

_redis_client: aioredis.Redis | None = None
_redis_loop_id: int | None = None


async def get_redis() -> aioredis.Redis:
    """
    Redis client döner.
    FastAPI: tek event loop → singleton client yeniden kullanılır.
    Celery: asyncio.run() her seferinde yeni loop açar → yeni client oluşturulur.
    """
    global _redis_client, _redis_loop_id
    loop = asyncio.get_running_loop()
    if _redis_client is None or id(loop) != _redis_loop_id:
        _redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        _redis_loop_id = id(loop)
    return _redis_client


async def cache_get(key: str) -> Any | None:
    r = await get_redis()
    value = await r.get(key)
    if value is None:
        return None
    return json.loads(value)


async def cache_set(key: str, value: Any, ttl_seconds: int = 300) -> None:
    r = await get_redis()
    await r.set(key, json.dumps(value, default=str), ex=ttl_seconds)


async def cache_delete(key: str) -> None:
    r = await get_redis()
    await r.delete(key)


async def cache_delete_pattern(pattern: str) -> None:
    r = await get_redis()
    keys = await r.keys(pattern)
    if keys:
        await r.delete(*keys)


def cache_key(*parts: Any) -> str:
    return ":".join(str(p) for p in parts)


async def close_redis() -> None:
    """Mevcut event loop'taki Redis client'ı kapat. Celery task sonunda çağrılır."""
    global _redis_client, _redis_loop_id
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception:
            pass
        _redis_client = None
        _redis_loop_id = None
