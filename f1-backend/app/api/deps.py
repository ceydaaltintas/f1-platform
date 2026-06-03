"""
FastAPI dependency'leri: zorunlu ve opsiyonel auth.

Kullanım:
    @router.post("/comments")
    async def create_comment(user: User = Depends(require_auth)):
        ...

    @router.get("/comments")
    async def list_comments(user: User | None = Depends(optional_auth)):
        ...
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)


async def _resolve_user(
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
) -> User | None:
    if credentials is None:
        return None
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        return None
    if payload.get("type") != "access":
        return None
    result = await db.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()
    return user if user and user.is_active else None


async def optional_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Opsiyonel auth — token yoksa None döner."""
    return await _resolve_user(credentials, db)


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Zorunlu auth — token yoksa veya geçersizse 401."""
    user = await _resolve_user(credentials, db)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bu işlem için giriş yapmanız gerekiyor",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
