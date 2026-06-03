"""
Push bildirim endpoint'leri.

VAPID key üretimi için:
  pip install py-vapid
  vapid --gen --applicationServerKey

Üretilen key'leri .env'e ekle:
  VAPID_PRIVATE_KEY=...
  VAPID_PUBLIC_KEY=...
  VAPID_CLAIMS_EMAIL=admin@example.com
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_auth
from app.core.database import get_db
from app.core.redis_client import cache_key, get_redis
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notifications", tags=["bildirimler"])

SUBSCRIPTION_TTL = 30 * 24 * 3600  # 30 gün


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict  # {"p256dh": "...", "auth": "..."}
    expirationTime: int | None = None


@router.post("/subscribe", status_code=201)
async def subscribe(
    body: PushSubscription,
    user: User = Depends(require_auth),
):
    """Kullanıcının push aboneliğini kaydeder."""
    r = await get_redis()
    key = cache_key("push_sub", str(user.id))
    await r.set(key, json.dumps(body.model_dump()), ex=SUBSCRIPTION_TTL)
    logger.info("Push aboneliği kaydedildi: user=%s", user.id)
    return {"status": "subscribed"}


@router.delete("/subscribe", status_code=204)
async def unsubscribe(user: User = Depends(require_auth)):
    """Push aboneliğini iptal eder."""
    r = await get_redis()
    await r.delete(cache_key("push_sub", str(user.id)))
    return None


async def send_push_to_user(user_id: str, title: str, body: str, url: str = "/") -> bool:
    """
    Belirli bir kullanıcıya push bildirimi gönderir.
    VAPID kuruluysa gerçek bildirim gönderir, yoksa sadece loglar.
    """
    from app.core.config import settings

    r = await get_redis()
    raw = await r.get(cache_key("push_sub", user_id))
    if not raw:
        return False

    try:
        sub = json.loads(raw)
        vapid_key = getattr(settings, "vapid_private_key", "")

        if not vapid_key:
            logger.info("[Push DEMO] %s → %s: %s", user_id, title, body)
            return True

        from pywebpush import webpush, WebPushException
        webpush(
            subscription_info=sub,
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=vapid_key,
            vapid_claims={
                "sub": f"mailto:{getattr(settings, 'vapid_claims_email', 'admin@f1platform.com')}"
            },
        )
        return True
    except Exception as e:
        logger.warning("Push gönderilemedi: %s", e)
        return False


async def broadcast_push(title: str, body: str, url: str = "/", max_users: int = 1000) -> int:
    """
    Tüm kayıtlı kullanıcılara push bildirimi gönderir.
    Canlı yarış olayları (bayrak, pit, ilk tur) için kullanılır.
    """
    r = await get_redis()
    keys = await r.keys("push_sub:*")
    sent = 0
    for k in keys[:max_users]:
        user_id = k.split(":")[-1]
        if await send_push_to_user(user_id, title, body, url):
            sent += 1
    logger.info("Push broadcast: %d kullanıcıya gönderildi", sent)
    return sent
