import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

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
    yield
    await engine.dispose()


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


@app.websocket("/ws/race/{session_id}")
async def race_ws(websocket: WebSocket, session_id: int):
    await race_websocket_handler(websocket, session_id)


@app.websocket("/ws/community/{session_id}")
async def community_ws(websocket: WebSocket, session_id: int):
    await community_websocket_handler(websocket, session_id)


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "version": "0.3.0", "env": settings.app_env}
