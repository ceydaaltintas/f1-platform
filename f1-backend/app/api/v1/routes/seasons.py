from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.redis_client import cache_delete_pattern, cache_get, cache_key, cache_set
from app.models.f1 import Driver, Round, Season, Team
from app.schemas.f1 import DriverOut, RoundOut, SeasonOut, TeamOut
from app.services.sync import _determine_current_season, sync_full_season

router = APIRouter(tags=["seasons"])


def _season_cache_ttl(year: int) -> int:
    """Aktif sezon için kısa TTL (5dk), tarihsel için uzun (24 saat)."""
    current = _determine_current_season()
    return 300 if year == current else 86_400


# ─── Seasons ─────────────────────────────────────────────────────────────────

@router.get("/seasons", response_model=list[SeasonOut])
async def list_seasons(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Season).order_by(Season.year.desc()))
    seasons = result.scalars().all()

    out = []
    for s in seasons:
        total = await db.execute(select(func.count()).where(Round.season_id == s.id))
        completed = await db.execute(
            select(func.count()).where(Round.season_id == s.id, Round.round_status == "completed")
        )
        upcoming = await db.execute(
            select(func.count()).where(Round.season_id == s.id, Round.round_status == "upcoming")
        )
        out.append(
            SeasonOut(
                id=s.id,
                year=s.year,
                is_current=s.is_current,
                round_count=total.scalar(),
                rounds_completed=completed.scalar(),
                rounds_upcoming=upcoming.scalar(),
            )
        )
    return out


@router.get("/seasons/current", response_model=SeasonOut)
async def get_current_season(db: AsyncSession = Depends(get_db)):
    """Aktif sezonu döner. Henüz senkronize edilmemişse 404."""
    result = await db.execute(select(Season).where(Season.is_current.is_(True)))
    season = result.scalar_one_or_none()
    if season is None:
        year = _determine_current_season()
        raise HTTPException(
            404,
            f"Aktif sezon ({year}) henüz senkronize edilmedi. "
            f"POST /api/v1/seasons/{year}/sync ile başlatın.",
        )
    total = await db.execute(select(func.count()).where(Round.season_id == season.id))
    completed = await db.execute(
        select(func.count()).where(Round.season_id == season.id, Round.round_status == "completed")
    )
    upcoming = await db.execute(
        select(func.count()).where(Round.season_id == season.id, Round.round_status == "upcoming")
    )
    return SeasonOut(
        id=season.id,
        year=season.year,
        is_current=season.is_current,
        round_count=total.scalar(),
        rounds_completed=completed.scalar(),
        rounds_upcoming=upcoming.scalar(),
    )


@router.post("/seasons/{year}/sync", status_code=202)
async def sync_season_endpoint(year: int, db: AsyncSession = Depends(get_db)):
    """Belirtilen sezonu Jolpica'dan çekip veritabanına yazar.
    Aktif sezon için cache otomatik temizlenir.
    """
    if year < 1950 or year > date.today().year + 1:
        raise HTTPException(400, "Geçersiz sezon yılı")
    result = await sync_full_season(year, db)

    # Aktif sezon sync'i sonrası cache'i temizle
    if result["is_current"]:
        await cache_delete_pattern(f"rounds:{year}:*")
        await cache_delete_pattern("seasons:*")

    return {"message": f"{year} sezonu senkronize edildi", "stats": result}


# ─── Rounds ──────────────────────────────────────────────────────────────────

@router.get("/seasons/{year}/rounds", response_model=list[RoundOut])
async def list_rounds(
    year: int,
    status: str | None = Query(None, description="'completed' veya 'upcoming' filtresi"),
    db: AsyncSession = Depends(get_db),
):
    cache_k = cache_key("rounds", year, status or "all")
    cached = await cache_get(cache_k)
    if cached:
        return cached

    season_result = await db.execute(select(Season).where(Season.year == year))
    season = season_result.scalar_one_or_none()
    if season is None:
        raise HTTPException(
            404,
            f"{year} sezonu bulunamadı. POST /api/v1/seasons/{year}/sync ile senkronize edin.",
        )

    query = (
        select(Round)
        .where(Round.season_id == season.id)
        .options(selectinload(Round.sessions))
        .order_by(Round.round_number)
    )
    if status in ("completed", "upcoming"):
        query = query.where(Round.round_status == status)

    result = await db.execute(query)
    rounds = result.scalars().all()
    data = [RoundOut.model_validate(r).model_dump(mode="json") for r in rounds]
    await cache_set(cache_k, data, ttl_seconds=_season_cache_ttl(year))
    return data


@router.get("/seasons/{year}/next", response_model=RoundOut)
async def get_next_round(year: int, db: AsyncSession = Depends(get_db)):
    """Bir sonraki upcoming round'u döner."""
    season_result = await db.execute(select(Season).where(Season.year == year))
    season = season_result.scalar_one_or_none()
    if season is None:
        raise HTTPException(404, f"{year} sezonu bulunamadı")

    result = await db.execute(
        select(Round)
        .where(Round.season_id == season.id, Round.round_status == "upcoming")
        .options(selectinload(Round.sessions))
        .order_by(Round.round_number)
        .limit(1)
    )
    rnd = result.scalar_one_or_none()
    if rnd is None:
        raise HTTPException(404, "Bu sezon için önümüzdeki yarış bulunamadı")
    return rnd


@router.get("/rounds/{round_id}", response_model=RoundOut)
async def get_round(round_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Round)
        .where(Round.id == round_id)
        .options(selectinload(Round.sessions))
    )
    rnd = result.scalar_one_or_none()
    if rnd is None:
        raise HTTPException(404, "Round bulunamadı")
    return rnd


# ─── Drivers ─────────────────────────────────────────────────────────────────

@router.get("/drivers", response_model=list[DriverOut])
async def list_drivers(
    season: int | None = Query(None),
    team_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    cache_k = cache_key("drivers", season or "all", team_id or "all")
    cached = await cache_get(cache_k)
    if cached:
        return cached

    query = select(Driver).options(selectinload(Driver.current_team))
    if team_id:
        query = query.where(Driver.current_team_id == team_id)
    query = query.order_by(Driver.last_name)

    result = await db.execute(query)
    drivers = result.scalars().all()
    data = [DriverOut.model_validate(d).model_dump(mode="json") for d in drivers]
    ttl = _season_cache_ttl(season) if season else 3600
    await cache_set(cache_k, data, ttl_seconds=ttl)
    return data


@router.get("/drivers/{driver_id}", response_model=DriverOut)
async def get_driver(driver_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Driver)
        .where(Driver.id == driver_id)
        .options(selectinload(Driver.current_team))
    )
    driver = result.scalar_one_or_none()
    if driver is None:
        raise HTTPException(404, "Pilot bulunamadı")
    return driver


# ─── Teams ───────────────────────────────────────────────────────────────────

@router.get("/teams", response_model=list[TeamOut])
async def list_teams(
    season: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    cache_k = cache_key("teams", season or "all")
    cached = await cache_get(cache_k)
    if cached:
        return cached

    result = await db.execute(select(Team).order_by(Team.name))
    teams = result.scalars().all()
    data = [TeamOut.model_validate(t).model_dump(mode="json") for t in teams]
    ttl = _season_cache_ttl(season) if season else 3600
    await cache_set(cache_k, data, ttl_seconds=ttl)
    return data
