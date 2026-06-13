"""
Şampiyona sıralaması servisi.

Jolpica'dan pilot ve takım sıralamalarını çeker.
Aktif sezon için 5dk TTL, tarihsel için 24s TTL.
"""

import logging
from app.core.redis_client import cache_get, cache_key, cache_set
from app.services import jolpica
from app.services.sync import _determine_current_season

logger = logging.getLogger(__name__)


def _ttl(year: int) -> int:
    return 300 if year == _determine_current_season() else 86_400


async def get_driver_standings(year: int, round_number: int | None = None) -> list[dict]:
    ck = cache_key("standings", "drivers", year, round_number or "latest")
    cached = await cache_get(ck)
    if cached:
        return cached

    raw = await jolpica.fetch_driver_standings(year, round_number)

    standings = []
    for entry in raw:
        drv = entry.get("Driver", {})
        constructors = entry.get("Constructors", [{}])
        standings.append({
            "position": int(entry.get("position", 0)),
            "points": float(entry.get("points", 0)),
            "wins": int(entry.get("wins", 0)),
            "driver_id": drv.get("driverId", ""),
            "code": drv.get("code", drv.get("driverId", "")[:3].upper()),
            "first_name": drv.get("givenName", ""),
            "last_name": drv.get("familyName", ""),
            "number": drv.get("permanentNumber"),
            "nationality": drv.get("nationality"),
            "team_id": constructors[0].get("constructorId", "") if constructors else "",
            "team_name": constructors[0].get("name", "") if constructors else "",
        })

    await cache_set(ck, standings, ttl_seconds=_ttl(year))
    return standings


async def get_constructor_standings(year: int) -> list[dict]:
    ck = cache_key("standings", "constructors", year)
    cached = await cache_get(ck)
    if cached:
        return cached

    raw = await jolpica.fetch_constructor_standings(year)

    standings = []
    for entry in raw:
        con = entry.get("Constructor", {})
        standings.append({
            "position": int(entry.get("position", 0)),
            "points": float(entry.get("points", 0)),
            "wins": int(entry.get("wins", 0)),
            "team_id": con.get("constructorId", ""),
            "team_name": con.get("name", ""),
            "nationality": con.get("nationality"),
        })

    await cache_set(ck, standings, ttl_seconds=_ttl(year))
    return standings


async def get_h2h_circuit(
    code1: str, code2: str,
    year_from: int = 2020, year_to: int | None = None,
) -> list[dict]:
    """
    İki pilotun pist bazında H2H karşılaştırması.
    Her yıl için tek Jolpica çağrısıyla tüm sezon sonuçlarını çeker.
    """
    if year_to is None:
        from datetime import date
        year_to = date.today().year

    c1 = code1.upper()
    c2 = code2.upper()

    # Sıralı cache key (VER-NOR == NOR-VER)
    k1, k2 = sorted([c1, c2])
    ck = cache_key("h2h_circuit_v3", k1, k2, year_from, year_to)
    cached = await cache_get(ck)
    if cached:
        # İstek yönü cache sıralamasından farklıysa flip et
        if k1 != c1:
            return [_flip(r) for r in cached]
        return cached

    circuit_map: dict[str, dict] = {}

    async def process_year(year: int):
        from app.core.database import AsyncSessionLocal
        from app.services.db_cache import get_season_all_results as _get_results
        try:
            async with AsyncSessionLocal() as db_sess:
                races = await _get_results(year, db_sess)
        except Exception as exc:
            logger.warning("H2H: %d sezonu sonuçları alınamadı: %s", year, exc)
            return
        if not races:
            return

        for race in races:
            name    = race.get("raceName", "")
            results = race.get("Results", [])

            pos_map: dict[str, int] = {}
            for r in results:
                drv  = r.get("Driver", {})
                code = drv.get("code") or drv.get("driverId", "")[:3].upper()
                try:
                    pos_map[code.upper()] = int(r.get("position", 99))
                except (ValueError, TypeError):
                    pass

            p1_pos = pos_map.get(c1)
            p2_pos = pos_map.get(c2)

            if p1_pos is None and p2_pos is None:
                continue

            pos1 = p1_pos or 99
            pos2 = p2_pos or 99

            e = circuit_map.setdefault(name, {
                "circuit": name, "c1_wins": 0, "c2_wins": 0,
                "races": 0, "c1_podiums": 0, "c2_podiums": 0,
            })
            e["races"] += 1
            if pos1 < pos2:
                e["c1_wins"] += 1
            elif pos2 < pos1:
                e["c2_wins"] += 1
            if p1_pos and p1_pos <= 3:
                e["c1_podiums"] += 1
            if p2_pos and p2_pos <= 3:
                e["c2_podiums"] += 1

    # Sıralı işle — paralel rate limit'e takılmaması için
    for y in range(year_from, year_to + 1):
        await process_year(y)

    result = sorted(circuit_map.values(), key=lambda x: x["races"], reverse=True)

    # Cache'e k1 sıralı olarak kaydet
    cache_data = result if k1 == c1 else [_flip(r) for r in result]
    await cache_set(ck, cache_data, ttl_seconds=86_400)

    return result


def _flip(r: dict) -> dict:
    """c1/c2 pozisyonlarını ters çevirir."""
    return {
        **r,
        "c1_wins": r["c2_wins"], "c2_wins": r["c1_wins"],
        "c1_podiums": r["c2_podiums"], "c2_podiums": r["c1_podiums"],
    }


async def get_season_results(year: int) -> list[dict]:
    """Her yarışın ilk 3 pilotunu ve puan dağılımını döner."""
    ck = cache_key("season_results", year)
    cached = await cache_get(ck)
    if cached:
        return cached

    races = await jolpica.fetch_season_rounds(year)
    results = []
    for race in races:
        race_results = await jolpica.fetch_race_results(year, int(race["round"]))
        if not race_results:
            continue

        def _driver(r: dict) -> dict:
            drv = r.get("Driver", {})
            return {
                "code":      drv.get("code", drv.get("driverId","")[:3].upper()),
                "name":      f"{drv.get('givenName','')} {drv.get('familyName','')}".strip(),
                "team":      r.get("Constructor", {}).get("name", ""),
                "points":    float(r.get("points", 0)),
                "status":    r.get("status", ""),
            }

        top3 = [_driver(race_results[i]) for i in range(min(3, len(race_results)))]
        winner = race_results[0]
        drv_w  = winner.get("Driver", {})
        results.append({
            "round":        int(race["round"]),
            "race_name":    race.get("raceName", ""),
            "circuit":      race.get("Circuit", {}).get("circuitName", ""),
            "date":         race.get("date"),
            "winner_code":  drv_w.get("code", ""),
            "winner_name":  f"{drv_w.get('givenName','')} {drv_w.get('familyName','')}",
            "team":         winner.get("Constructor", {}).get("name", ""),
            "podium":       top3,   # [{code, name, team}, ...]
        })

    await cache_set(ck, results, ttl_seconds=_ttl(year))
    return results


async def get_weekend_fantasy_picks(year: int, round_number: int) -> list[dict]:
    """
    Son 3 yarışın sonuçlarına bakarak bu hafta için form skoru hesaplar.
    Fantasy F1 oyuncularına pilot önerisi sunar.
    """
    ck = cache_key("fantasy_picks", year, round_number)
    cached = await cache_get(ck)
    if cached:
        return cached

    # Son 3 yarışı çek
    lookback = max(1, round_number - 3)
    all_results: dict[str, list[dict]] = {}

    for rn in range(lookback, round_number):
        results = await jolpica.fetch_race_results(year, rn)
        for r in results:
            code = r.get("Driver", {}).get("code", "")
            if not code:
                continue
            if code not in all_results:
                all_results[code] = []
            all_results[code].append({
                "round": rn,
                "position": int(r.get("position", 20)),
                "points": float(r.get("points", 0)),
                "grid": int(r.get("grid", 20)),
                "status": r.get("status", ""),
            })

    # Form skoru hesapla (son yarışa daha fazla ağırlık)
    WEIGHTS = [0.5, 0.3, 0.2]  # en yeni önce
    picks = []
    for code, races in all_results.items():
        recent = sorted(races, key=lambda x: -x["round"])[:3]
        score = 0.0
        for i, race in enumerate(recent):
            w = WEIGHTS[i] if i < len(WEIGHTS) else 0.1
            # Puan + grid'den yükselme bonus
            pos_score = max(0, 20 - race["position"]) * 2
            grid_bonus = max(0, race["grid"] - race["position"])  # öne geçiş
            dnf_penalty = -10 if race["status"] not in ("Finished", "+1 Lap", "+2 Laps") else 0
            score += w * (pos_score + grid_bonus + dnf_penalty)

        picks.append({
            "code": code,
            "form_score": round(score, 1),
            "races": recent,
            "avg_points": round(
                sum(r["points"] for r in recent) / len(recent) if recent else 0, 1
            ),
            "avg_position": round(
                sum(r["position"] for r in recent) / len(recent) if recent else 20, 1
            ),
        })

    picks.sort(key=lambda x: -x["form_score"])
    result = picks[:10]  # Top 10

    await cache_set(ck, result, ttl_seconds=3600)
    return result
