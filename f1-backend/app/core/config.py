from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Uygulama
    app_name: str = "F1 Platform"
    app_env: str = "development"
    debug: bool = True
    secret_key: str = "change-me-in-production"

    # Veritabanı
    database_url: str = "postgresql+asyncpg://f1user:f1pass@localhost:5432/f1platform"

    # Redis
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # Auth
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # Dış API'ler
    anthropic_api_key: str = ""
    groq_api_key: str = ""
    openf1_base_url: str = "https://api.openf1.org/v1"
    openf1_username: str = ""
    openf1_password: str = ""
    jolpica_base_url: str = "https://api.jolpi.ca/ergast/f1"

    # CORS
    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://hotlap.live",
        "https://www.hotlap.live",
        "https://supportive-encouragement-production-afa2.up.railway.app",
    ]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
