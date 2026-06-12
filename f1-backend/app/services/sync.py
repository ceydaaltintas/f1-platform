"""
Jolpica → Veritabanı senkronizasyon servisi.

Önemli davranışlar:
- Aktif sezon (is_current=True) tespiti otomatik yapılır.
- Tamamlanan round'lar "completed", gelecekteki round'lar "upcoming" olarak işaretlenir.
- Cache TTL'leri aktif sezon için kısa, tarihsel sezonlar için uzun tutulur.
"""

import logging
from datetime import date, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.f1 import Driver, Round, Season, Team
from app.services import jolpica

logger = logging.getLogger(__name__)


def _determine_current_season() -> int:
    """Bugünün tarihine göre aktif F1 sezonunu tespit eder.
    F1 sezonu genellikle Mart başı – Kasım sonu arasında.
    Ocak–Şubat ise bir önceki yıl 'aktif' kabul edilir.
    """
    today = date.today()
    return today.year if today.month >= 3 else today.year - 1


def _round_status(race_date: date | None) -> str:
    """Yarış tarihi bugünden önceyse completed, değilse upcoming."""
    if race_date is None:
        return "upcoming"
    return "completed" if race_date <= date.today() else "upcoming"


async def sync_season(year: int, db: AsyncSession) -> Season:
    """Sezonu veritabanında oluşturur ya da mevcut olanı döner.
    Aktif sezonu is_current=True olarak işaretler.
    """
    current_year = _determine_current_season()

    # Önce tüm sezonların is_current'ını False'a çek
    if year == current_year:
        await db.execute(update(Season).values(is_current=False))
        await db.flush()

    result = await db.execute(select(Season).where(Season.year == year))
    season = result.scalar_one_or_none()
    if season is None:
        season = Season(year=year, is_current=(year == current_year))
        db.add(season)
        logger.info("Yeni sezon oluşturuldu: %d (aktif: %s)", year, season.is_current)
    else:
        season.is_current = (year == current_year)

    await db.flush()
    return season


async def sync_teams(year: int, db: AsyncSession) -> dict[str, Team]:
    """Takımları çekip upsert eder. jolpica_id → Team haritası döner."""
    constructors = await jolpica.fetch_season_constructors(year)
    team_map: dict[str, Team] = {}

    for raw in constructors:
        parsed = jolpica.parse_team(raw)
        result = await db.execute(select(Team).where(Team.jolpica_id == parsed["jolpica_id"]))
        team = result.scalar_one_or_none()

        if team is None:
            team = Team(**parsed)
            db.add(team)
            logger.info("Yeni takım: %s", parsed["name"])
        else:
            team.name = parsed["name"]
            team.nationality = parsed["nationality"]

        team_map[parsed["jolpica_id"]] = team

    await db.flush()
    return team_map


async def sync_drivers(year: int, team_map: dict[str, Team], db: AsyncSession) -> dict[str, Driver]:
    """Pilotları çekip upsert eder, takımlarıyla ilişkilendirir."""
    # Standings'den pilot→takım eşleşmesini al
    standings = await jolpica.fetch_driver_standings(year)
    driver_team: dict[str, str] = {
        s["Driver"]["driverId"]: s["Constructors"][0]["constructorId"]
        for s in standings
        if s.get("Constructors")
    }

    raw_drivers = await jolpica.fetch_season_drivers(year)
    driver_map: dict[str, Driver] = {}

    for raw in raw_drivers:
        parsed = jolpica.parse_driver(raw)
        result = await db.execute(
            select(Driver).where(Driver.jolpica_id == parsed["jolpica_id"])
        )
        driver = result.scalar_one_or_none()

        dob_str = parsed.pop("date_of_birth", None)
        dob = date.fromisoformat(dob_str) if dob_str else None

        if driver is None:
            driver = Driver(**parsed, date_of_birth=dob)
            db.add(driver)
        else:
            for k, v in parsed.items():
                setattr(driver, k, v)
            driver.date_of_birth = dob

        # Takım ilişkilendirme (mevcut sezondan)
        team_id_str = driver_team.get(parsed["jolpica_id"])
        if team_id_str and team_id_str in team_map:
            driver.current_team = team_map[team_id_str]

        driver_map[parsed["jolpica_id"]] = driver

    await db.flush()
    return driver_map


async def sync_rounds(year: int, season: Season, db: AsyncSession) -> list[Round]:
    """Yarışları çekip upsert eder; geçmişte kalan yarışlar completed, ilerisi upcoming."""
    races = await jolpica.fetch_season_rounds(year)
    rounds: list[Round] = []

    for raw in races:
        parsed = jolpica.parse_round(raw)
        race_date_str = parsed.pop("race_date", None)
        race_date = date.fromisoformat(race_date_str) if race_date_str else None
        race_datetime_str = parsed.pop("race_datetime", None)
        race_datetime = (
            datetime.fromisoformat(race_datetime_str.replace("Z", "+00:00"))
            if race_datetime_str else None
        )
        status = _round_status(race_date)

        result = await db.execute(
            select(Round).where(
                Round.season_id == season.id,
                Round.round_number == parsed["round_number"],
            )
        )
        rnd = result.scalar_one_or_none()

        if rnd is None:
            rnd = Round(
                **parsed,
                season_id=season.id,
                race_date=race_date,
                race_datetime=race_datetime,
                round_status=status,
            )
            db.add(rnd)
            logger.info(
                "Yeni round: %s [%s]", parsed["name"], status
            )
        else:
            for k, v in parsed.items():
                setattr(rnd, k, v)
            rnd.race_date = race_date
            rnd.race_datetime = race_datetime
            rnd.round_status = status  # Her sync'te güncelle

        rounds.append(rnd)

    await db.flush()
    return rounds


SESSION_TYPE_MAP = {
    "Practice 1": "practice1",
    "Practice 2": "practice2",
    "Practice 3": "practice3",
    "Qualifying": "qualifying",
    "Sprint Qualifying": "sprint_qualifying",
    "Sprint": "sprint",
    "Race": "race",
}


async def sync_sessions_for_round(round_: Round, year: int, db: AsyncSession) -> list:
    """
    Tamamlanmış bir round için OpenF1'den session'ları çekip upsert eder.
    round_.meeting_key dolu değilse OpenF1'den bulur ve kaydeder.
    """
    from app.services import openf1
    from app.models.f1 import Session
    from datetime import timezone

    # Meeting key bulunamazsa OpenF1'den bul
    if round_.meeting_key is None:
        meetings = await openf1.fetch_meetings(year)
        for m in meetings:
            # Önce meeting_number ile dene (bazı yıllarda dolu olur)
            if m.get("meeting_number") and m.get("meeting_number") == round_.round_number:
                round_.meeting_key = m["meeting_key"]
                await db.flush()
                break
            # meeting_name eşleştirmesi (2026 gibi meeting_number boş olan yıllar için)
            m_name = (m.get("meeting_name") or "").lower().strip()
            r_name = (round_.name or "").lower().strip()
            if m_name and r_name and (m_name in r_name or r_name in m_name):
                round_.meeting_key = m["meeting_key"]
                await db.flush()
                break
            # circuit_short_name ↔ locality eşleştirmesi (fallback)
            m_circuit = (m.get("circuit_short_name") or "").lower().strip()
            r_locality = (round_.locality or "").lower().strip()
            if m_circuit and r_locality and m_circuit in r_locality:
                round_.meeting_key = m["meeting_key"]
                await db.flush()
                break

    if round_.meeting_key is None:
        logger.warning("Round %d için meeting_key bulunamadı, session sync atlanıyor", round_.round_number)
        return []

    raw_sessions = await openf1.fetch_sessions(round_.meeting_key)
    sessions_created = []

    for raw in raw_sessions:
        session_name = raw.get("session_name", "")
        session_type = SESSION_TYPE_MAP.get(session_name)
        if session_type is None:
            logger.debug("Bilinmeyen session tipi: %s — atlanıyor", session_name)
            continue

        session_key = raw.get("session_key")
        date_start_str = raw.get("date_start")
        session_date = None
        if date_start_str:
            try:
                from datetime import datetime, timezone
                session_date = datetime.fromisoformat(date_start_str.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                pass

        # Tarihe göre gerçek durum: gelecekte ise upcoming, geçtiyse finished
        from datetime import datetime, timezone
        now_utc = datetime.now(timezone.utc)
        resolved_status = "finished" if (session_date and session_date < now_utc) else "upcoming"

        # session_key varsa önce ara, yoksa round+type ile bul
        result = await db.execute(
            select(Session).where(Session.session_key == session_key)
        ) if session_key else None

        existing = result.scalar_one_or_none() if result else None

        if existing is None:
            # round+type ile kontrol
            result2 = await db.execute(
                select(Session).where(
                    Session.round_id == round_.id,
                    Session.type == session_type,
                )
            )
            existing = result2.scalar_one_or_none()

        if existing is None:
            session_obj = Session(
                round_id=round_.id,
                type=session_type,
                status=resolved_status,
                session_date=session_date,
                session_key=session_key,
            )
            db.add(session_obj)
            logger.info("Yeni session: %s (key=%s) round %d status=%s", session_type, session_key, round_.round_number, resolved_status)
        else:
            existing.session_key = session_key
            existing.session_date = session_date
            # Aktif oturumu ezme; sadece upcoming/finished arasında güncelle
            if existing.status != "active":
                existing.status = resolved_status
            session_obj = existing

        sessions_created.append(session_obj)

    await db.flush()
    return sessions_created


async def sync_full_season(year: int, db: AsyncSession) -> dict:
    """Bir sezonun tüm meta verilerini senkronize eder."""
    current_year = _determine_current_season()
    logger.info(
        "=== %d sezonu senkronizasyonu başlıyor (aktif sezon: %d) ===",
        year, current_year,
    )

    season = await sync_season(year, db)
    team_map = await sync_teams(year, db)
    driver_map = await sync_drivers(year, team_map, db)
    rounds = await sync_rounds(year, season, db)

    # Tamamlanan round'lar için session'ları OpenF1'den çek
    total_sessions = 0
    for rnd in rounds:
        if rnd.round_status == "completed":
            try:
                sessions = await sync_sessions_for_round(rnd, year, db)
                total_sessions += len(sessions)
            except Exception as exc:
                logger.warning("Round %d session sync hatası: %s", rnd.round_number, exc)

    completed = sum(1 for r in rounds if r.round_status == "completed")
    upcoming = sum(1 for r in rounds if r.round_status == "upcoming")

    await db.commit()

    logger.info(
        "=== %d tamamlandı: %d takım, %d pilot, %d round (%d bitti, %d önümüzdeki), %d session ===",
        year, len(team_map), len(driver_map), len(rounds), completed, upcoming, total_sessions,
    )
    return {
        "year": year,
        "is_current": season.is_current,
        "teams": len(team_map),
        "drivers": len(driver_map),
        "rounds_total": len(rounds),
        "rounds_completed": completed,
        "rounds_upcoming": upcoming,
        "sessions_synced": total_sessions,
    }
