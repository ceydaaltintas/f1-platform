import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.api.v1.websocket.community_gateway import community_websocket_handler
from app.api.v1.websocket.race_gateway import race_websocket_handler
from app.core.config import settings
from app.core.database import engine
from app.models import *  # noqa: F401,F403

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("F1 Platform API başlıyor — %s", settings.app_env)
    await _startup_sync()
    yield
    await engine.dispose()


async def _startup_sync():
    """Uygulama başlarken bu haftanın session'larını otomatik sync eder."""
    from datetime import timedelta
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.f1 import Season, Round
    from app.services.sync import sync_sessions_for_round, _determine_current_season

    try:
        async with AsyncSessionLocal() as db:
            current_year = _determine_current_season()
            result = await db.execute(select(Season).where(Season.year == current_year))
            season = result.scalar_one_or_none()
            if season is None:
                logger.info("Startup sync: %d sezonu henüz yok, atlanıyor", current_year)
                return

            from datetime import date
            today = date.today()
            round_result = await db.execute(
                select(Round).where(
                    Round.season_id == season.id,
                    Round.race_date >= today - timedelta(days=2),
                    Round.race_date <= today + timedelta(days=7),
                )
            )
            rnd = round_result.scalar_one_or_none()
            if rnd is None:
                logger.info("Startup sync: bu hafta yarış yok")
                return

            sessions = await sync_sessions_for_round(rnd, current_year, db)
            await db.commit()
            logger.info(
                "Startup sync: Round %d (%s) — %d session güncellendi",
                rnd.round_number, rnd.name, len(sessions),
            )
    except Exception as exc:
        logger.warning("Startup sync hatası (kritik değil): %s", exc)


app = FastAPI(
    title="F1 Platform API",
    version="0.3.0",
    description="Formula 1 telemetri, canlı yarış ve topluluk platformu",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Yakalanmayan tüm exception'lar için CORS başlıklı 503 döner."""
    origin = request.headers.get("origin", "")
    headers = {}
    if origin in settings.allowed_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    logger.error("Unhandled exception: %s %s — %s", request.method, request.url, exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Geçici hata, lütfen tekrar deneyin."},
        headers=headers,
    )


@app.websocket("/ws/race/{session_id}")
async def race_ws(websocket: WebSocket, session_id: int):
    await race_websocket_handler(websocket, session_id)


@app.websocket("/ws/community/{session_id}")
async def community_ws(websocket: WebSocket, session_id: int):
    await community_websocket_handler(websocket, session_id)


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "version": "0.3.0", "env": settings.app_env}
