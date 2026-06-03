from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

# bcrypt 4.x + passlib uyumsuzluğunu bypass et: sha256_crypt kullan.
# sha256_crypt de güvenli bir password hashing algoritmasıdır.
pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "access"},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def create_refresh_token(subject: str) -> str:
    expire = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "refresh"},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as e:
        raise ValueError(f"Geçersiz token: {e}") from e
