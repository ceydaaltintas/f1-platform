"""
OpenF1 REST API servisi.
Base URL: https://api.openf1.org/v1

Tamamlanan oturumlar ücretsiz, canlı veri ücretli abonelik gerektirir.
Tüm timestamp'ler ISO 8601 UTC formatındadır.
"""

import logging
import time
from datetime import datetime
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings

logger = logging.getLogger(__name__)

BASE_URL = settings.openf1_base_url
TOKEN_URL = "https://api.openf1.org/token"
TIMEOUT = 20.0
# OpenF1 ücretsiz tier: 3 istek/sn, 30 istek/dk
HEADERS = {"Accept": "application/json"}

# Paid plan: OAuth2 password grant ile Firebase JWT alınır (1 saat geçerli)
_token_cache: dict[str, Any] = {"access_token": None, "expires_at": 0.0}


async def _auth_headers() -> dict[str, str]:
    """Geçerli bir Bearer token varsa header döner, yoksa yeni token alır."""
    if not (settings.openf1_username and settings.openf1_password):
        return {}

    if _token_cache["access_token"] and _token_cache["expires_at"] > time.time() + 30:
        return {"Authorization": f"Bearer {_token_cache['access_token']}"}

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "username": settings.openf1_username,
                "password": settings.openf1_password,
                "grant_type": "password",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"] = time.time() + int(data["expires_in"])
    return {"Authorization": f"Bearer {_token_cache['access_token']}"}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
async def _get(path: str, params: dict | None = None) -> list[dict[str, Any]]:
    """OpenF1'e GET isteği gönderir. Her zaman liste döner."""
    import asyncio as _asyncio
    url = f"{BASE_URL}/{path}"
    headers = {**HEADERS, **await _auth_headers()}
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=headers) as client:
        resp = await client.get(url, params={k: v for k, v in (params or {}).items() if v is not None})
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", "60"))
            logger.warning("OpenF1 rate limit (429), %ds bekleniyor", retry_after)
            await _asyncio.sleep(retry_after)
            resp.raise_for_status()
        resp.raise_for_status()
        return resp.json()


# ─── Meetings & Sessions ─────────────────────────────────────────────────────

async def fetch_meetings(year: int) -> list[dict]:
    """Bir yıldaki tüm meeting (yarış haftası) bilgilerini getirir."""
    return await _get("meetings", {"year": year})


async def fetch_sessions(meeting_key: int) -> list[dict]:
    """Bir meeting'e ait tüm oturumları (FP, Q, Race vb.) getirir."""
    return await _get("sessions", {"meeting_key": meeting_key})


async def find_session_key(
    year: int,
    circuit_key: str | None = None,
    session_name: str | None = None,
    round_number: int | None = None,
) -> int | None:
    """OpenF1 session_key'ini meeting listesinden bulur."""
    meetings = await fetch_meetings(year)

    # Round numarası veya devre ismiyle eşleştir
    match = None
    for m in meetings:
        if circuit_key and circuit_key.lower() in (m.get("circuit_short_name") or "").lower():
            match = m
            break
        if round_number and m.get("meeting_number") == round_number:
            match = m
            break

    if match is None:
        return None

    sessions = await fetch_sessions(match["meeting_key"])
    for s in sessions:
        sname = (s.get("session_name") or "").lower()
        if session_name and session_name.lower() in sname:
            return s["session_key"]
        if not session_name and "race" in sname:
            return s["session_key"]

    return None


# ─── Drivers ─────────────────────────────────────────────────────────────────

async def fetch_session_drivers(session_key: int) -> list[dict]:
    """Oturumdaki tüm pilotları ve araba numaralarını getirir."""
    return await _get("drivers", {"session_key": session_key})


async def get_driver_number(session_key: int, driver_code: str) -> int | None:
    """Pilot kodundan (örn. 'VER') araba numarasını bulur."""
    drivers = await fetch_session_drivers(session_key)
    for d in drivers:
        if (d.get("name_acronym") or "").upper() == driver_code.upper():
            return d["driver_number"]
    return None


# ─── Laps ────────────────────────────────────────────────────────────────────

async def fetch_laps(session_key: int, driver_number: int) -> list[dict]:
    """Bir pilotun tüm tur verilerini getirir (timestamp dahil)."""
    return await _get("laps", {"session_key": session_key, "driver_number": driver_number})


async def fetch_all_session_laps(session_key: int) -> list[dict]:
    """Tüm pilotların turlarını tek API isteğiyle getirir."""
    return await _get("laps", {"session_key": session_key})


def find_lap(laps: list[dict], lap_number: int | str) -> dict | None:
    """Belirli tur numarasını veya 'fastest' tur'u bulur."""
    if not laps:
        return None

    if lap_number == "fastest":
        valid = [
            lap for lap in laps
            if lap.get("lap_duration") is not None and not lap.get("is_pit_out_lap", False)
        ]
        return min(valid, key=lambda x: x["lap_duration"]) if valid else None

    num = int(lap_number)
    for lap in laps:
        if lap.get("lap_number") == num:
            return lap
    return None


# ─── Car Telemetry ────────────────────────────────────────────────────────────

async def fetch_car_data(
    session_key: int,
    driver_number: int,
    date_start: str | None = None,
    date_end: str | None = None,
) -> list[dict]:
    """
    Araç telemetrisini getirir: hız, gaz, fren, DRS, RPM, vites.
    ~3.7 Hz örnekleme hızında; bir tur için ~200-300 veri noktası.
    """
    params = {"session_key": session_key, "driver_number": driver_number}
    if date_start:
        params["date>"] = date_start
    if date_end:
        params["date<"] = date_end
    return await _get("car_data", params)


async def fetch_lap_telemetry(
    session_key: int,
    driver_number: int,
    laps: list[dict],
    lap_number: int | str = "fastest",
) -> dict:
    """
    Belirli bir tur için telemetriyi zaman damgasıyla keser ve döner.
    Aynı zamanda mesafeyi hız x zaman'dan hesaplar (yaklaşık).
    """
    lap = find_lap(laps, lap_number)
    if lap is None:
        return {"lap": None, "telemetry": []}

    date_start = lap.get("date_start")
    lap_duration = lap.get("lap_duration", 120)
    date_end = None

    if date_start and lap_duration:
        from datetime import timedelta
        start_dt = datetime.fromisoformat(date_start.replace("Z", "+00:00"))
        end_dt = start_dt + timedelta(seconds=float(lap_duration) + 2)
        date_end = end_dt.isoformat()

    car_data = await fetch_car_data(session_key, driver_number, date_start, date_end)

    # Kümülatif mesafeyi hesapla (speed km/sa → m/s)
    enriched = []
    cumulative_dist = 0.0
    prev_ts: datetime | None = None

    for point in car_data:
        ts_str = point.get("date", "")
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")) if ts_str else None

        if ts and prev_ts:
            dt = (ts - prev_ts).total_seconds()
            speed_ms = (point.get("speed", 0) or 0) / 3.6
            cumulative_dist += speed_ms * dt

        enriched.append({
            "date": ts_str,
            "speed": point.get("speed"),
            "throttle": point.get("throttle"),
            "brake": point.get("brake"),
            "drs": point.get("drs"),
            "rpm": point.get("rpm"),
            "gear": point.get("n_gear"),
            "dist_m": round(cumulative_dist, 1),
        })
        prev_ts = ts

    return {
        "lap": {
            "number": lap.get("lap_number"),
            "duration": lap.get("lap_duration"),
            "date_start": date_start,
            "compound": lap.get("compound"),
            "sector1": lap.get("duration_sector_1"),
            "sector2": lap.get("duration_sector_2"),
            "sector3": lap.get("duration_sector_3"),
            "is_personal_best": lap.get("is_personal_best", False),
        },
        "telemetry": enriched,
    }


# ─── Location (GPS) ───────────────────────────────────────────────────────────

async def fetch_location(
    session_key: int,
    driver_number: int,
    date_start: str | None = None,
    date_end: str | None = None,
) -> list[dict]:
    """GPS konumlarını getirir: x, y, z koordinatları."""
    params = {"session_key": session_key, "driver_number": driver_number}
    if date_start:
        params["date>"] = date_start
    if date_end:
        params["date<"] = date_end
    return await _get("location", params)


async def fetch_live_locations(session_key: int, since: str) -> list[dict]:
    """Tüm pilotların belirli bir zamandan sonraki GPS konumlarını getirir (canlı harita için)."""
    return await _get("location", {"session_key": session_key, "date>": since})


async def fetch_track_map(session_key: int, driver_number: int, laps: list[dict]) -> list[dict]:
    """
    En hızlı turun GPS koordinatlarından pist haritası üretir.
    x, y koordinatları normalize edilmiş SVG-ready formatta döner.
    """
    result = await fetch_track_map_with_bounds(session_key, driver_number, laps)
    return result["points"]


async def fetch_track_map_with_bounds(session_key: int, driver_number: int, laps: list[dict]) -> dict:
    """
    Pist haritasını ve normalize için kullanılan sınırları (x_min, y_min, scale)
    birlikte döner — canlı araç konumlarını aynı koordinat sistemine
    eşlemek için kullanılır.
    """
    empty = {"points": [], "x_min": 0.0, "y_min": 0.0, "scale": 1.0}

    lap = find_lap(laps, "fastest")
    if lap is None:
        return empty

    date_start = lap.get("date_start")
    lap_duration = lap.get("lap_duration", 120)

    date_end = None
    if date_start and lap_duration:
        from datetime import timedelta
        start_dt = datetime.fromisoformat(date_start.replace("Z", "+00:00"))
        date_end = (start_dt + timedelta(seconds=float(lap_duration) + 1)).isoformat()

    try:
        points = await fetch_location(session_key, driver_number, date_start, date_end)
    except Exception as e:
        logger.warning("Track map location fetch başarısız: %s", e)
        return empty
    if not points:
        return empty

    # Normalize: -500..+500 → 0..1000 (SVG koordinat sistemi)
    xs = [p["x"] for p in points if p.get("x") is not None]
    ys = [p["y"] for p in points if p.get("y") is not None]
    if not xs or not ys:
        return empty

    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    x_range = x_max - x_min or 1
    y_range = y_max - y_min or 1
    scale = 1000 / max(x_range, y_range)

    norm_points = [
        {
            "x": round((p["x"] - x_min) * scale, 1) if p.get("x") is not None else None,
            "y": round((p["y"] - y_min) * scale, 1) if p.get("y") is not None else None,
        }
        for p in points
        if p.get("x") is not None and p.get("y") is not None
    ]

    return {"points": norm_points, "x_min": x_min, "y_min": y_min, "scale": scale}


# ─── Stints ──────────────────────────────────────────────────────────────────

async def fetch_positions(session_key: int) -> list[dict]:
    """Tüm pilotların anlık konum verilerini getirir (FIA timing)."""
    url = f"{BASE_URL}/position"
    try:
        headers = {**HEADERS, **await _auth_headers()}
        async with httpx.AsyncClient(timeout=120.0, headers=headers) as client:
            resp = await client.get(url, params={"session_key": session_key})
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.warning("Position fetch başarısız session_key=%s: %s", session_key, e)
        return []


async def fetch_weather(session_key: int) -> list[dict]:
    """Yarış sırasındaki hava durumu verilerini getirir."""
    return await _get("weather", {"session_key": session_key})


async def fetch_stints(session_key: int, driver_number: int | None = None) -> list[dict]:
    """Lastik stint verilerini getirir."""
    params: dict = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _get("stints", params)


# ─── Intervals ───────────────────────────────────────────────────────────────

async def fetch_intervals(session_key: int) -> list[dict]:
    """Araç aralıklarını getirir (gap_to_leader, interval)."""
    return await _get("intervals", {"session_key": session_key})


# ─── Session Result ──────────────────────────────────────────────────────────

async def fetch_session_result(session_key: int) -> list[dict]:
    """
    Oturum sonucu (pozisyon, dnf/dns/dsq ve sıralama için Q1/Q2/Q3 süreleri).
    Sıralama oturumlarında `duration` alanı [Q1, Q2, Q3] sürelerini içerir
    (elenen pilotlarda ilgili segmentler None'dur).
    """
    return await _get("session_result", {"session_key": session_key})


# ─── Race Control ─────────────────────────────────────────────────────────────

async def fetch_race_control(session_key: int) -> list[dict]:
    """Bayrak, güvenlik arabası ve yarış kontrol mesajlarını getirir."""
    return await _get("race_control", {"session_key": session_key})
