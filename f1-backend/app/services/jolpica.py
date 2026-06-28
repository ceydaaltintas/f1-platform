"""
Jolpica API servisi (Ergast'ın resmi halefi).
Base URL: https://api.jolpi.ca/ergast/f1

Tüm endpoint'ler JSON döner ve sayfalama destekler.
"""

import logging
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings

logger = logging.getLogger(__name__)

BASE_URL = settings.jolpica_base_url
TIMEOUT = 30.0


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
)
async def _get(path: str, params: dict | None = None) -> dict:
    """Jolpica API'ye GET isteği gönderir, hata durumunda retry uygular."""
    url = f"{BASE_URL}/{path}"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()


async def _get_all_pages(path: str, data_key: str) -> list[dict]:
    """Tüm sayfaları çekerek tek liste döner."""
    limit = 100
    offset = 0
    results: list[dict] = []

    while True:
        data = await _get(path, params={"limit": limit, "offset": offset})
        table = data.get("MRData", {})
        items: list = []

        # Dinamik key keşfi (RaceTable, DriverTable vb.)
        for key, val in table.items():
            if isinstance(val, dict) and data_key in val:
                items = val[data_key]
                break

        results.extend(items)
        total = int(table.get("total", 0))
        offset += limit
        if offset >= total:
            break

    return results


# ─── Public API ─────────────────────────────────────────────────────────────

async def fetch_season_rounds(year: int) -> list[dict]:
    """Bir sezonun tüm yarışlarını çeker."""
    logger.info("Jolpica: %d sezonu round'ları çekiliyor", year)
    races = await _get_all_pages(f"{year}.json", "Races")
    return races


async def fetch_season_drivers(year: int) -> list[dict]:
    """Bir sezonda yarışan tüm pilotları çeker."""
    logger.info("Jolpica: %d sezonu pilotları çekiliyor", year)
    return await _get_all_pages(f"{year}/drivers.json", "Drivers")


async def fetch_season_constructors(year: int) -> list[dict]:
    """Bir sezondaki tüm yapımcıları/takımları çeker."""
    logger.info("Jolpica: %d sezonu takımları çekiliyor", year)
    return await _get_all_pages(f"{year}/constructors.json", "Constructors")


async def fetch_all_season_results(year: int) -> list[dict]:
    """
    Bir sezonun TÜM yarış sonuçlarını tek çağrıda çeker.
    Jolpica: /{year}/results.json  (sayfalama destekli)
    Her yarış için tüm sürücü pozisyonları dahildir.
    """
    logger.info("Jolpica: %d sezonu tüm yarış sonuçları çekiliyor", year)
    return await _get_all_pages(f"{year}/results.json", "Races")


async def fetch_race_results(year: int, round_number: int) -> list[dict]:
    """Belirli bir yarışın sonuçlarını çeker."""
    data = await _get(f"{year}/{round_number}/results.json")
    races = data.get("MRData", {}).get("RaceTable", {}).get("Races", [])
    return races[0].get("Results", []) if races else []


async def fetch_qualifying_results(year: int, round_number: int) -> list[dict]:
    """Sıralama turundaki sonuçları çeker."""
    data = await _get(f"{year}/{round_number}/qualifying.json")
    races = data.get("MRData", {}).get("RaceTable", {}).get("Races", [])
    return races[0].get("QualifyingResults", []) if races else []


async def fetch_driver_results(driver_id: str) -> list[dict]:
    """Bir pilotun tüm kariyer yarış sonuçlarını çeker."""
    all_races: list[dict] = []
    offset = 0
    while True:
        data = await _get(f"drivers/{driver_id}/results.json?limit=100&offset={offset}")
        races = data.get("MRData", {}).get("RaceTable", {}).get("Races", [])
        all_races.extend(races)
        total = int(data.get("MRData", {}).get("total", 0))
        offset += 100
        if offset >= total:
            break
    return all_races


async def fetch_driver_standings(year: int, round_number: int | None = None) -> list[dict]:
    """Şampiyona pilotlar sıralamasını çeker."""
    path = f"{year}/driverStandings.json"
    if round_number:
        path = f"{year}/{round_number}/driverStandings.json"
    data = await _get(path)
    lists = (
        data.get("MRData", {})
        .get("StandingsTable", {})
        .get("StandingsLists", [])
    )
    return lists[0].get("DriverStandings", []) if lists else []


async def fetch_constructor_standings(year: int) -> list[dict]:
    """Şampiyona takımlar sıralamasını çeker."""
    data = await _get(f"{year}/constructorStandings.json")
    lists = (
        data.get("MRData", {})
        .get("StandingsTable", {})
        .get("StandingsLists", [])
    )
    return lists[0].get("ConstructorStandings", []) if lists else []


# ─── Veri dönüştürücüler ────────────────────────────────────────────────────

def parse_round(race: dict) -> dict:
    """Jolpica round verisini iç formata dönüştürür."""
    circuit = race.get("Circuit", {})
    location = circuit.get("Location", {})

    race_date = race.get("date")
    race_time = race.get("time")  # örn. "13:00:00Z" (UTC)
    race_datetime = f"{race_date}T{race_time}" if race_date and race_time else None

    return {
        "round_number": int(race["round"]),
        "name": race["raceName"],
        "circuit_name": circuit.get("circuitName", ""),
        "country": location.get("country"),
        "locality": location.get("locality"),
        "race_date": race_date,
        "race_datetime": race_datetime,
    }


def parse_driver(driver: dict) -> dict:
    """Jolpica pilot verisini iç formata dönüştürür."""
    return {
        "jolpica_id": driver["driverId"],
        "code": driver.get("code", driver["driverId"][:3].upper()),
        "first_name": driver.get("givenName", ""),
        "last_name": driver.get("familyName", ""),
        "number": int(driver["permanentNumber"]) if driver.get("permanentNumber") else None,
        "nationality": driver.get("nationality"),
        "date_of_birth": driver.get("dateOfBirth"),
    }


def parse_team(constructor: dict) -> dict:
    """Jolpica takım verisini iç formata dönüştürür."""
    return {
        "jolpica_id": constructor["constructorId"],
        "name": constructor["name"],
        "nationality": constructor.get("nationality"),
    }
