from fastapi import APIRouter

from app.api.v1.routes.ai import router as ai_router
from app.api.v1.routes.auth import router as auth_router
from app.api.v1.routes.community import router as community_router
from app.api.v1.routes.live import router as live_router
from app.api.v1.routes.notifications import router as notifications_router
from app.api.v1.routes.seasons import router as seasons_router
from app.api.v1.routes.sessions import router as sessions_router
from app.api.v1.routes.standings import router as standings_router
from app.api.v1.routes.telemetry import router as telemetry_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(seasons_router)
api_router.include_router(sessions_router)
api_router.include_router(telemetry_router)
api_router.include_router(ai_router)
api_router.include_router(live_router)
api_router.include_router(community_router)
api_router.include_router(standings_router)
api_router.include_router(notifications_router)
