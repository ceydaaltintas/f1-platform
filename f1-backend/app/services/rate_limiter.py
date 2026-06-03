"""
Redis tabanlı rate limiter.

Sliding window algoritması kullanır.
Her kullanıcı + eylem kombinasyonu için Redis'te sayaç tutulur.
"""

from app.core.redis_client import get_redis


async def is_allowed(user_id: str, action: str, limit: int, window_seconds: int) -> bool:
    """
    True dönerse işleme izin verilir, False dönerse rate limit aşıldı.

    Örnek:
        allowed = await is_allowed(str(user.id), "comment", limit=1, window_seconds=10)
    """
    key = f"rl:{action}:{user_id}"
    r = await get_redis()
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, window_seconds)
    return count <= limit


async def remaining(user_id: str, action: str) -> int:
    """Kullanıcının kalan TTL'sini saniye cinsinden döner (0 = serbest)."""
    key = f"rl:{action}:{user_id}"
    r = await get_redis()
    ttl = await r.ttl(key)
    return max(0, ttl)
