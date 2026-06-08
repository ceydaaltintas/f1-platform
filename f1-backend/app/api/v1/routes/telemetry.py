"""
Telemetri endpoint'leri.

Tüm telemetri verisi OpenF1 üzerinden çekilir.
session_key eşleşmesi: veritabanındaki Session.session_key alanı kullanılır.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_admin
from app.core.database import get_db
from app.core.redis_client import cache_get, cache_key, cache_set
from app.models.f1 import Driver, EnergyAnalysisCache, Lap, OpenF1CarDataCache, Round, Season, Session
from app.models.user import User
from app.services import db_cache, jolpica, openf1
from app.services import energy as energy_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["telemetry"])


# ─── Yardımcı ────────────────────────────────────────────────────────────────

async def _resolve_session(session_id: int, db: AsyncSession) -> Session:
    result = await db.execute(
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.round))
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "Oturum bulunamadı")
    return session


async def _require_session_key(session: Session, db: AsyncSession) -> int:
    """
    Oturumun OpenF1 session_key'ini döner.
    Kayıtlı değilse OpenF1'den bulmaya çalışır ve kaydeder.
    """
    if session.session_key:
        return session.session_key

    # OpenF1'den bul
    round_: Round = session.round
    season_result = await db.execute(
        select(Season).where(Season.id == round_.season_id)
    )
    season = season_result.scalar_one_or_none()
    if season is None:
        raise HTTPException(404, "Sezon bulunamadı")

    SESSION_TYPE_MAP = {
        "practice1": "Practice 1",
        "practice2": "Practice 2",
        "practice3": "Practice 3",
        "qualifying": "Qualifying",
        "sprint_qualifying": "Sprint Qualifying",
        "sprint": "Sprint",
        "race": "Race",
    }
    session_name = SESSION_TYPE_MAP.get(session.type, session.type)

    meetings = await openf1.fetch_meetings(season.year)
    matched_meeting = None
    for m in meetings:
        if m.get("meeting_number") == round_.round_number:
            matched_meeting = m
            break

    if matched_meeting is None:
        raise HTTPException(
            404,
            f"OpenF1'de bu yarış bulunamadı (round {round_.round_number}, {season.year}). "
            "Meeting veritabanında eşleşemiyor olabilir.",
        )

    sessions = await openf1.fetch_sessions(matched_meeting["meeting_key"])
    for s in sessions:
        if session_name.lower() in (s.get("session_name") or "").lower():
            session.session_key = s["session_key"]
            session.round.meeting_key = matched_meeting["meeting_key"]
            await db.commit()
            logger.info("session_key bulundu: %d → %d", session_id, session.session_key)
            return session.session_key

    raise HTTPException(
        404,
        f"OpenF1'de oturum eşleşmedi: {session_name}. "
        "Oturum henüz tamamlanmamış ya da verisi yüklenmemiş olabilir.",
    )


def _build_telemetry_from_car_data(
    laps: list[dict],
    car_data_full: list[dict],
    lap_number: int | str = "fastest",
) -> dict:
    """
    Önceden çekilmiş (DB cache'ten gelen) car data'sından tur telemetrisi oluşturur.
    OpenF1 API çağrısı yapmaz.
    """
    from datetime import datetime, timedelta
    from app.services.openf1 import find_lap

    lap = find_lap(laps, lap_number)
    if lap is None:
        return {"lap": None, "telemetry": []}

    date_start = lap.get("date_start")
    lap_duration = lap.get("lap_duration", 120)
    start_dt = end_dt = None

    if date_start and lap_duration:
        try:
            start_dt = datetime.fromisoformat(date_start.replace("Z", "+00:00"))
            end_dt   = start_dt + timedelta(seconds=float(lap_duration) + 2)
        except (ValueError, AttributeError):
            pass

    # Zaman penceresine göre filtrele
    filtered = []
    for point in car_data_full:
        ts_str = point.get("date", "")
        if not ts_str:
            continue
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if start_dt and end_dt:
                if start_dt <= ts <= end_dt:
                    filtered.append((ts, point))
            else:
                filtered.append((ts, point))
        except (ValueError, AttributeError):
            pass

    # Kümülatif mesafe hesapla
    enriched = []
    cumulative_dist = 0.0
    prev_ts = None
    for ts, point in filtered:
        if prev_ts:
            dt = (ts - prev_ts).total_seconds()
            cumulative_dist += (point.get("speed", 0) or 0) / 3.6 * dt
        enriched.append({
            "date":     point.get("date"),
            "speed":    point.get("speed"),
            "throttle": point.get("throttle"),
            "brake":    point.get("brake"),
            "drs":      point.get("drs"),
            "rpm":      point.get("rpm"),
            "gear":     point.get("n_gear"),
            "dist_m":   round(cumulative_dist, 1),
        })
        prev_ts = ts

    return {
        "lap": {
            "number":          lap.get("lap_number"),
            "duration":        lap.get("lap_duration"),
            "date_start":      date_start,
            "compound":        lap.get("compound"),
            "sector1":         lap.get("duration_sector_1"),
            "sector2":         lap.get("duration_sector_2"),
            "sector3":         lap.get("duration_sector_3"),
            "is_personal_best": lap.get("is_personal_best", False),
        },
        "telemetry": enriched,
    }


def _extract_key_moments(telemetry: list[dict]) -> list[dict]:
    """
    Telemetri serisinden önemli anları çıkarır:
    en sert frenlemeler, DRS aktivasyonları, en yüksek hız noktaları.
    """
    if not telemetry:
        return []

    moments = []
    prev_brake = 0
    prev_drs = 0
    in_braking = False
    brake_entry_speed = None
    brake_start_dist = None

    for i, pt in enumerate(telemetry):
        brake = pt.get("brake") or 0
        drs = pt.get("drs") or 0
        speed = pt.get("speed") or 0

        # Frenleme başlangıcı
        if brake > 30 and not in_braking:
            in_braking = True
            brake_entry_speed = speed
            brake_start_dist = pt.get("dist_m", 0)

        # Frenleme sonu
        if brake < 10 and in_braking:
            in_braking = False
            moments.append({
                "point": "braking",
                "speed_entry": brake_entry_speed,
                "speed_min": speed,
                "dist_m": brake_start_dist,
            })

        # DRS açılma
        if drs > 0 and prev_drs == 0:
            moments.append({
                "point": "drs_open",
                "speed": speed,
                "dist_m": pt.get("dist_m", 0),
            })

        prev_brake = brake
        prev_drs = drs

    return moments[:10]  # İlk 10 an


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/{session_id}/telemetry/{driver_code}")
async def get_telemetry(
    session_id: int,
    driver_code: str,
    lap: str = Query("fastest", description="Tur numarası veya 'fastest'"),
    db: AsyncSession = Depends(get_db),
):
    """
    Belirli bir pilot ve tur için tam telemetri verisi döner.
    Hız, gaz, fren, DRS, RPM, vites ve hesaplanmış mesafe içerir.
    """
    cache_k = cache_key("telemetry", session_id, driver_code.upper(), lap)
    cached = await cache_get(cache_k)
    if cached:
        return cached

    session = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    driver_number = await openf1.get_driver_number(session_key, driver_code)
    if driver_number is None:
        raise HTTPException(404, f"Pilot bulunamadı: {driver_code}")

    laps = await db_cache.get_laps(session, driver_number, db)
    car_data = await db_cache.get_car_data(session, driver_number, db)

    if car_data:
        result = _build_telemetry_from_car_data(laps, car_data, lap)
    else:
        # DB'de car data yok — doğrudan API'den çek (tur bazlı, küçük veri)
        result = await openf1.fetch_lap_telemetry(session_key, driver_number, laps, lap)

    if result["lap"] is None:
        raise HTTPException(404, f"Tur bulunamadı: {lap}")

    result["key_moments"] = _extract_key_moments(result["telemetry"])
    result["driver_code"] = driver_code.upper()
    result["session_id"] = session_id

    ttl = 86_400 if session.status == "finished" else 3600
    await cache_set(cache_k, result, ttl_seconds=ttl)
    return result


@router.get("/{session_id}/track_map")
async def get_track_map(
    session_id: int,
    driver_code: str = Query("VER", description="Referans pilot (varsayılan: VER)"),
    db: AsyncSession = Depends(get_db),
):
    """
    En hızlı turun GPS koordinatlarından pist haritası döner.
    x, y normalize koordinatlar; 0–1000 aralığında SVG-ready.
    """
    cache_k = cache_key("track_map", session_id, driver_code.upper())
    cached = await cache_get(cache_k)
    if cached:
        return cached

    session = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    driver_number = await openf1.get_driver_number(session_key, driver_code)
    if driver_number is None:
        drivers = await db_cache.get_session_drivers(session)
        driver_number = drivers[0]["driver_number"] if drivers else None

    if driver_number is None:
        raise HTTPException(404, "Pilot bulunamadı")

    # DB cache kontrolü — driver_number=-1 track map verisi için özel sentinel
    if session.status == "finished":
        cached_row = await db.get(OpenF1CarDataCache, (session_key, -1))
        if cached_row:
            result = {"session_id": session_id, "points": cached_row.data, "count": len(cached_row.data)}
            await cache_set(cache_k, result, ttl_seconds=7 * 86_400)
            return result

    laps = await db_cache.get_laps(session, driver_number, db)
    track_points = await openf1.fetch_track_map(session_key, driver_number, laps)

    if track_points and session.status == "finished":
        try:
            db.add(OpenF1CarDataCache(session_key=session_key, driver_number=-1, data=track_points))
            await db.commit()
        except Exception:
            await db.rollback()

    result = {"session_id": session_id, "points": track_points, "count": len(track_points)}
    if track_points:  # Sadece veri varsa cache'le
        await cache_set(cache_k, result, ttl_seconds=7 * 86_400)
    return result


@router.get("/{session_id}/stints")
async def get_stints(
    session_id: int,
    driver_code: str | None = Query(None, description="Tek pilot filtresi"),
    db: AsyncSession = Depends(get_db),
):
    """
    Lastik stint verilerini döner: hangi lastik, kaç tur kullanıldı.
    """
    cache_k = cache_key("stints", session_id, driver_code or "all")
    cached = await cache_get(cache_k)
    if cached:
        return cached

    session = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    driver_number = None
    if driver_code:
        driver_number = await openf1.get_driver_number(session_key, driver_code)

    all_stints = await db_cache.get_stints(session, db)
    stints = (
        [s for s in all_stints if s.get("driver_number") == driver_number]
        if driver_number else all_stints
    )

    # Pilot kodlarını ekle
    drivers = await db_cache.get_session_drivers(session)
    num_to_code = {d["driver_number"]: d.get("name_acronym", "?") for d in drivers}
    for s in stints:
        s["driver_code"] = num_to_code.get(s.get("driver_number"), "?")

    result = {"session_id": session_id, "stints": stints}
    ttl = 86_400 if session.status == "finished" else 3600
    await cache_set(cache_k, result, ttl_seconds=ttl)
    return result


@router.get("/{session_id}/compare")
async def compare_drivers(
    session_id: int,
    drivers: str = Query(..., description="İki pilot kodu, virgülle ayrılmış: VER,NOR"),
    lap: str = Query("fastest", description="'fastest' veya tur numarası"),
    db: AsyncSession = Depends(get_db),
):
    """
    İki pilotun aynı tur tipindeki telemetrisini karşılaştırır.
    Ortak mesafe ekseninde delta zamanı hesaplar.
    """
    codes = [c.strip().upper() for c in drivers.split(",")]
    if len(codes) != 2:
        raise HTTPException(400, "Tam olarak 2 pilot kodu girin: VER,NOR")

    cache_k = cache_key("compare", session_id, codes[0], codes[1], lap)
    cached = await cache_get(cache_k)
    if cached:
        return cached

    session = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    results = {}
    for code in codes:
        dn = await openf1.get_driver_number(session_key, code)
        if dn is None:
            raise HTTPException(404, f"Pilot bulunamadı: {code}")
        laps_data = await db_cache.get_laps(session, dn, db)
        car_data  = await db_cache.get_car_data(session, dn, db)
        if car_data:
            results[code] = _build_telemetry_from_car_data(laps_data, car_data, lap)
        else:
            results[code] = await openf1.fetch_lap_telemetry(session_key, dn, laps_data, lap)

    # Delta hesabı: ortak mesafe noktalarında A – B zaman farkı
    telem_a = results[codes[0]]["telemetry"]
    telem_b = results[codes[1]]["telemetry"]

    # Mesafeyi 100'er metre aralıklarla örnekle
    max_dist = max(
        (max((p["dist_m"] for p in telem_a), default=0)),
        (max((p["dist_m"] for p in telem_b), default=0)),
    )

    def speed_at_dist(telem: list[dict], target: float) -> float | None:
        for i in range(len(telem) - 1):
            d1, d2 = telem[i]["dist_m"], telem[i + 1]["dist_m"]
            if d1 <= target <= d2 and d2 > d1:
                ratio = (target - d1) / (d2 - d1)
                s1 = telem[i]["speed"] or 0
                s2 = telem[i + 1]["speed"] or 0
                return s1 + ratio * (s2 - s1)
        return None

    delta_points = []
    sample_interval = max(50, int(max_dist / 200))  # ~200 veri noktası
    for dist in range(0, int(max_dist), sample_interval):
        sa = speed_at_dist(telem_a, dist)
        sb = speed_at_dist(telem_b, dist)
        delta_points.append({
            "dist_m": dist,
            f"speed_{codes[0]}": sa,
            f"speed_{codes[1]}": sb,
        })

    # Delta özeti
    dur_a = results[codes[0]]["lap"].get("duration") or 0
    dur_b = results[codes[1]]["lap"].get("duration") or 0

    response = {
        "session_id": session_id,
        "drivers": {code: results[code]["lap"] for code in codes},
        "delta": delta_points,
        "summary": {
            "gap_seconds": round(abs(dur_a - dur_b), 3),
            "faster": codes[0] if dur_a <= dur_b else codes[1],
        },
    }
    ttl = 86_400 if session.status == "finished" else 3600
    await cache_set(cache_k, response, ttl_seconds=ttl)
    return response


@router.get("/{session_id}/replay_laps")
async def get_replay_laps(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Tüm pilotların tur verilerini döner (replay animasyonu için).
    Her pilotun lap_number, lap_duration, date_start bilgisi.
    """
    ck = cache_key("replay_laps", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    drivers    = await openf1.fetch_session_drivers(session_key)
    sem        = asyncio.Semaphore(4)

    async def _fetch(d: dict):
        code = d.get("name_acronym", "???")
        dn   = d.get("driver_number")
        async with sem:
            try:
                laps = await db_cache.get_laps(session, dn, db)
            except Exception:
                laps = []
        return {
            "code":   code,
            "number": dn,
            "laps": [
                {
                    "lap_number":   l.get("lap_number"),
                    "lap_duration": l.get("lap_duration"),
                    "date_start":   l.get("date_start"),
                    "is_pit_out_lap": l.get("is_pit_out_lap", False),
                }
                for l in laps if l.get("date_start") and l.get("lap_duration")
            ]
        }

    raw = await asyncio.gather(*[_fetch(d) for d in drivers])
    result = {
        "session_id": session_id,
        "drivers": [r for r in raw if r["laps"]],
    }
    await cache_set(ck, result, ttl_seconds=86_400)
    return result


@router.get("/{session_id}/positions_all")
async def get_all_positions(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Tüm araçların yarış boyunca konum verisini döner (replay için)."""
    ck = cache_key("positions_all", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    # DB cache kontrolü (driver_number=0 → tüm pilotların konum verisi)
    if session.status == "finished":
        cached_row = await db.get(OpenF1CarDataCache, (session_key, 0))
        if cached_row:
            result = {"session_id": session_id, "positions": cached_row.data}
            await cache_set(ck, result, ttl_seconds=7 * 86_400)
            return result

    positions = await openf1.fetch_positions(session_key)

    if positions and session.status == "finished":
        try:
            db.add(OpenF1CarDataCache(session_key=session_key, driver_number=0, data=positions))
            await db.commit()
        except Exception:
            await db.rollback()

    result = {"session_id": session_id, "positions": positions}
    if positions:  # Sadece veri varsa cache'le
        await cache_set(ck, result, ttl_seconds=7 * 86_400)
    return result


@router.get("/{session_id}/tyre_degradation")
async def get_tyre_degradation(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Her pilot için lastik yaşı → tur süresi eğrisi.
    Lap zamanları: Lap tablosu (DB). Stint yapısı: OpenF1StintsCache (DB).
    """
    ck = cache_key("tyre_deg", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    session = await _resolve_session(session_id, db)
    from collections import defaultdict
    from sqlalchemy import func as sa_func
    from sqlalchemy.orm import selectinload as sl

    # Lap tablosu boşsa bulk sync tetikle
    driver_count = (await db.execute(
        select(sa_func.count(sa_func.distinct(Lap.driver_id))).where(Lap.session_id == session_id)
    )).scalar_one()

    if session.status == "finished" and driver_count < 18:
        await db_cache.bulk_sync_to_lap_table(session, db)

    # 1. Lap zamanları: Lap tablosundan (driver_id → {lap_number: lap_time})
    laps_res = await db.execute(
        select(Lap)
        .where(Lap.session_id == session_id, Lap.lap_time.isnot(None))
        .options(sl(Lap.driver))
        .order_by(Lap.driver_id, Lap.lap_number)
    )
    all_laps = laps_res.scalars().all()

    lap_time_by_driver: dict[int, dict[int, float]] = defaultdict(dict)
    driver_id_to_code: dict[int, str] = {}
    for lap in all_laps:
        driver_id_to_code[lap.driver_id] = lap.driver.code
        if lap.lap_time and not lap.is_pit_out_lap and lap.lap_time < 300:
            lap_time_by_driver[lap.driver_id][lap.lap_number] = lap.lap_time

    # 2. Stint yapısı: OpenF1StintsCache'ten (driver_number → stints)
    stints_raw = await db_cache.get_stints(session, db)
    stints_by_dn: dict[int, list] = defaultdict(list)
    for s in stints_raw:
        dn = s.get("driver_number")
        if dn:
            stints_by_dn[dn].append(s)

    # 3. driver_number → driver_id eşleştirmesi
    of1_drivers = await db_cache.get_session_drivers(session)
    code_to_driver_id = {code: did for did, code in driver_id_to_code.items()}
    dn_to_driver_id: dict[int, int] = {}
    for d in of1_drivers:
        code = (d.get("name_acronym") or "").upper()
        dn   = d.get("driver_number")
        if dn and code in code_to_driver_id:
            dn_to_driver_id[dn] = code_to_driver_id[code]

    driver_id_to_dn = {did: dn for dn, did in dn_to_driver_id.items()}

    # 4. Her pilot için stint + lap verisi birleştir
    driver_list = []
    for driver_id, lap_time_map in lap_time_by_driver.items():
        if not lap_time_map:
            continue
        code = driver_id_to_code.get(driver_id, "???")
        dn   = driver_id_to_dn.get(driver_id)
        driver_stints = sorted(stints_by_dn.get(dn, []), key=lambda s: s.get("lap_start") or 0)

        stint_data = []
        if driver_stints:
            for s in driver_stints:
                lap_s          = s.get("lap_start") or 1
                lap_e          = s.get("lap_end") or max(lap_time_map.keys(), default=0)
                compound       = (s.get("compound") or "UNKNOWN").upper()
                tyre_age_start = s.get("tyre_age_at_start") or 0

                stint_laps = []
                for lap_n in range(lap_s, lap_e + 1):
                    lt = lap_time_map.get(lap_n)
                    if lt:
                        stint_laps.append({
                            "lap_number": lap_n,
                            "tyre_age":   (lap_n - lap_s) + tyre_age_start,
                            "lap_time":   round(lt, 3),
                        })

                if not stint_laps:
                    continue
                times = [l["lap_time"] for l in stint_laps]
                base  = min(times)
                for l in stint_laps:
                    l["delta"] = round(l["lap_time"] - base, 3)
                stint_data.append({
                    "stint_number":   s.get("stint_number", len(stint_data) + 1),
                    "compound":       compound,
                    "tyre_age_start": tyre_age_start,
                    "laps":           stint_laps,
                    "avg_time":       round(sum(times) / len(times), 3),
                    "best_time":      round(base, 3),
                    "degradation":    round(times[-1] - base, 3) if len(times) > 1 else 0,
                })
        else:
            # Stint verisi yoksa Lap tablosundaki compound değişiminden çıkar (fallback)
            groups: list[tuple[str, list]] = []
            cur_compound, cur_laps = None, []
            for lap_n in sorted(lap_time_map):
                # Lap tablosundan compound bul
                lap_obj = next((l for l in all_laps if l.driver_id == driver_id and l.lap_number == lap_n), None)
                compound = (lap_obj.compound or "UNKNOWN") if lap_obj else "UNKNOWN"
                if compound != cur_compound:
                    if cur_laps:
                        groups.append((cur_compound, cur_laps))
                    cur_compound, cur_laps = compound, [(lap_n, lap_time_map[lap_n])]
                else:
                    cur_laps.append((lap_n, lap_time_map[lap_n]))
            if cur_laps:
                groups.append((cur_compound, cur_laps))

            for i, (compound, group_laps) in enumerate(groups):
                times = [lt for _, lt in group_laps]
                base  = min(times)
                stint_laps = [
                    {"lap_number": ln, "tyre_age": j, "lap_time": round(lt, 3), "delta": round(lt - base, 3)}
                    for j, (ln, lt) in enumerate(group_laps)
                ]
                stint_data.append({
                    "stint_number":   i + 1,
                    "compound":       compound or "UNKNOWN",
                    "tyre_age_start": 0,
                    "laps":           stint_laps,
                    "avg_time":       round(sum(times) / len(times), 3),
                    "best_time":      round(base, 3),
                    "degradation":    round(times[-1] - base, 3) if len(times) > 1 else 0,
                })

        if stint_data:
            driver_list.append({"code": code, "stints": stint_data})

    result = {"session_id": session_id, "drivers": driver_list}
    ttl = 3600 if session.status == "finished" else 60
    await cache_set(ck, result, ttl_seconds=ttl)
    return result


@router.get("/{session_id}/teammate_pace")
async def get_teammate_pace(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Takım arkadaşı pace karşılaştırması. Lap tablosundan okur.
    """
    ck = cache_key("teammate_pace", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    session = await _resolve_session(session_id, db)
    from collections import defaultdict
    from sqlalchemy import func as sa_func
    from sqlalchemy.orm import selectinload as sl

    is_quali = session.type in ("qualifying", "sprint_qualifying")

    driver_count = (await db.execute(
        select(sa_func.count(sa_func.distinct(Lap.driver_id))).where(Lap.session_id == session_id)
    )).scalar_one()

    if session.status == "finished" and driver_count < 18:
        await db_cache.bulk_sync_to_lap_table(session, db)

    laps_res = await db.execute(
        select(Lap)
        .where(
            Lap.session_id == session_id,
            Lap.is_pit_out_lap == False,
            Lap.lap_time.isnot(None),
        )
        .options(sl(Lap.driver).selectinload(Driver.current_team))
    )
    all_laps = laps_res.scalars().all()

    laps_by_driver: dict[int, list] = defaultdict(list)
    for lap in all_laps:
        if lap.lap_time and lap.lap_time < 300:
            laps_by_driver[lap.driver_id].append(lap)

    driver_pace: dict[str, dict] = {}
    team_map: dict[str, list] = defaultdict(list)

    for driver_id, driver_laps in laps_by_driver.items():
        drv  = driver_laps[0].driver
        team = drv.current_team
        code = drv.code
        team_name = team.name if team else "Unknown"

        times = sorted(l.lap_time for l in driver_laps)
        if not times:
            continue

        best = times[0]
        if is_quali:
            pace = best
        elif len(times) < 3:
            pace = best
        else:
            lo = int(len(times) * 0.05)
            hi = int(len(times) * 0.85)
            clean = times[lo:hi] if hi > lo + 2 else times
            pace = clean[len(clean) // 2]

        entry = {
            "code":        code,
            "full_name":   drv.full_name,
            "team_name":   team_name,
            "team_colour": team.color_hex if team else "#AAAAAA",
            "median":      round(pace, 3),
            "best":        round(best, 3),
            "laps":        len(times),
        }
        driver_pace[code] = entry
        team_map[team_name].append(entry)

    teams_out = []
    for team_name, members in team_map.items():
        if len(members) < 2:
            continue
        members.sort(key=lambda x: x["median"])
        faster, slower = members[0], members[1]
        teams_out.append({
            "team":    team_name,
            "faster":  faster,
            "slower":  slower,
            "gap_ms":  round(slower["median"] - faster["median"], 3),
        })

    teams_out.sort(key=lambda x: x["gap_ms"], reverse=True)
    all_drivers = sorted(driver_pace.values(), key=lambda x: x["median"])

    result = {
        "session_id":   session_id,
        "session_type": session.type,
        "teams":        teams_out,
        "all_drivers":  all_drivers,
    }
    ttl = 3600 if session.status == "finished" else 60
    await cache_set(ck, result, ttl_seconds=ttl)
    return result


@router.get("/{session_id}/available_laps/{driver_code}")
async def get_available_laps(
    session_id: int,
    driver_code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Bir pilotun oturumdaki geçerli turlarını döner.
    Sıralama/antrenman için tur seçici dropdown'ı doldurmakta kullanılır.
    """
    cache_k = cache_key("avail_laps", session_id, driver_code.upper())
    cached  = await cache_get(cache_k)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)
    is_quali    = session.type in ("qualifying", "sprint_qualifying")

    driver_number = await openf1.get_driver_number(session_key, driver_code)
    if driver_number is None:
        raise HTTPException(404, f"Pilot bulunamadı: {driver_code}")

    laps = await db_cache.get_laps(session, driver_number, db)
    max_valid = 180.0 if is_quali else 9999.0

    flying = [
        lap for lap in laps
        if lap.get("lap_duration") is not None
        and not lap.get("is_pit_out_lap", False)
        and lap["lap_duration"] < max_valid
    ]

    # Sıralama/antrenman: en hızlı turun %115'inden yavaş turları at (in/out lap temizliği)
    if is_quali and flying:
        times = sorted(lap["lap_duration"] for lap in flying)
        if times:
            threshold = times[0] * 1.08  # en hızlıdan %8 yavaşa kadar
            flying = [lap for lap in flying if lap["lap_duration"] <= threshold]

    valid = [
        {
            "lap_number": lap.get("lap_number"),
            "lap_time":   lap.get("lap_duration"),
            "sector1":    lap.get("duration_sector_1"),
            "sector2":    lap.get("duration_sector_2"),
            "sector3":    lap.get("duration_sector_3"),
            "compound":   lap.get("compound"),
        }
        for lap in flying
    ]
    valid.sort(key=lambda x: x["lap_time"])

    result = {
        "session_id":   session_id,
        "driver_code":  driver_code.upper(),
        "is_quali":     is_quali,
        "laps":         valid,
    }
    ttl = 86_400 if session.status == "finished" else 300
    await cache_set(cache_k, result, ttl_seconds=ttl)
    return result


@router.get("/{session_id}/driver_summary/{driver_code}")
async def get_driver_summary(
    session_id: int,
    driver_code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Seçili pilotun oturum özeti:
    pit stop sayısı, hangi turda pit yaptı, hangi lastiği hangi turlarda kullandı,
    stint başına ort/en iyi tur süresi.
    """
    cache_k = cache_key("driver_summary", session_id, driver_code.upper())
    cached  = await cache_get(cache_k)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    # Pilot numarası
    driver_number = await openf1.get_driver_number(session_key, driver_code)
    if driver_number is None:
        raise HTTPException(404, f"Pilot bulunamadı: {driver_code}")

    laps_raw = await db_cache.get_laps(session, driver_number, db)
    all_stints = await db_cache.get_stints(session, db)
    stints_raw = [s for s in all_stints if s.get("driver_number") == driver_number]

    # Geçerli turlar: pit out değil, süre var, makul
    valid_laps = [
        l for l in laps_raw
        if l.get("lap_duration") and not l.get("is_pit_out_lap")
    ]
    all_valid_times = [l["lap_duration"] for l in valid_laps]
    fastest_overall = min(all_valid_times) if all_valid_times else None

    # Stint başına tur süreleri hesapla
    stints_out = []
    pit_laps   = []

    for i, st in enumerate(stints_raw):
        lap_s = st.get("lap_start") or 1
        lap_e = st.get("lap_end")   or (max(l.get("lap_number",0) for l in laps_raw) if laps_raw else 0)
        compound = st.get("compound") or "UNKNOWN"
        tyre_age_start = st.get("tyre_age_at_start") or 0

        # Bu stint'e ait turlar
        stint_laps = [
            l["lap_duration"] for l in valid_laps
            if lap_s <= (l.get("lap_number") or 0) <= lap_e
        ]
        avg_time     = round(sum(stint_laps) / len(stint_laps), 3) if stint_laps else None
        fastest_time = round(min(stint_laps), 3) if stint_laps else None

        # Pit turu: önceki stint'in son turundan sonra gelen ilk tur
        if i > 0:
            prev_end = stints_raw[i - 1].get("lap_end") or 0
            pit_laps.append(prev_end)   # o turda pit yaptı

        stints_out.append({
            "stint_number":    i + 1,
            "compound":        compound,
            "lap_start":       lap_s,
            "lap_end":         lap_e,
            "laps":            lap_e - lap_s + 1,
            "tyre_age_start":  tyre_age_start,
            "avg_lap_time":    avg_time,
            "fastest_lap_time": fastest_time,
        })

    result = {
        "driver_code":     driver_code.upper(),
        "session_type":    session.type,
        "pit_count":       max(0, len(stints_raw) - 1),
        "pit_laps":        pit_laps,
        "stints":          stints_out,
        "total_laps":      max((l.get("lap_number", 0) for l in laps_raw), default=0),
        "fastest_lap":     fastest_overall,
    }
    ttl = 86_400 if session.status == "finished" else 600
    await cache_set(cache_k, result, ttl_seconds=ttl)
    return result


@router.get("/{session_id}/leaderboard")
async def get_leaderboard(
    session_id: int,
    lap: int | None = Query(None, description="Yarış için: bu tura kadar dinamik sıralama"),
    db: AsyncSession = Depends(get_db),
):
    """
    Sıralama tablosu.
    - Yarış (race/sprint): Jolpica'dan gerçek bitiş sıralaması.
      lap=N verilirse: o ana kadar kümülatif süreye göre dinamik sıralama.
    - Antrenman/Sıralama: OpenF1'den best lap, Q1/Q2/Q3 segmentleri.
    """
    cache_k = cache_key("leaderboard", session_id, lap or "final")
    cached  = await cache_get(cache_k)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    is_race  = session.type in ("race", "sprint")

    # ── YARIŞ: Gerçek bitiş sıralaması (Jolpica) ─────────────────────────
    if is_race and lap is None:
        # Season / round bilgisini al
        from sqlalchemy import select as sa_select
        from app.models.f1 import Season
        round_ = session.round
        season_res = await db.execute(
            sa_select(Season).where(Season.id == round_.season_id)
        )
        season_obj = season_res.scalar_one_or_none()
        if season_obj and round_.round_number:
            try:
                raw_results = await jolpica.fetch_race_results(
                    season_obj.year, round_.round_number
                )
                race_entries = []
                for r in raw_results:
                    drv     = r.get("Driver", {})
                    constr  = r.get("Constructor", {})
                    time    = r.get("Time", {})
                    status  = r.get("status", "")
                    fastest = r.get("FastestLap", {})
                    pos     = int(r.get("position", 99))
                    # Gap / süre
                    if pos == 1:
                        gap_str = time.get("time", "")
                    else:
                        gap_str = f"+{time.get('time','')}" if time.get("time") else status

                    race_entries.append({
                        "position":    pos,
                        "code":        drv.get("code", drv.get("driverId","")[:3].upper()),
                        "full_name":   f"{drv.get('givenName','')} {drv.get('familyName','')}".strip(),
                        "team_name":   constr.get("name", ""),
                        "team_colour": "AAAAAA",
                        "gap_str":     gap_str,
                        "status":      status,
                        "fastest_lap": fastest.get("Time", {}).get("time"),
                        "fastest_lap_rank": int(fastest.get("rank", 0)) if fastest.get("rank") else None,
                        "points":      float(r.get("points", 0)),
                        "grid":        int(r.get("grid", 0)),
                        "lap_time":    None,  # N/A for race final
                        "sector1":     None, "sector2": None, "sector3": None,
                        "compound":    None,
                        "gap":         0.0,
                        "sector1_is_best": False,
                        "sector2_is_best": False,
                        "sector3_is_best": False,
                    })
                race_entries.sort(key=lambda e: e["position"])
                response = {
                    "session_id":   session_id,
                    "session_type": session.type,
                    "is_quali":     False,
                    "is_race":      True,
                    "entries":      race_entries,
                    "segments":     {},
                }
                # Bitmiş yarış sonuçları değişmez — 7 gün cache
                await cache_set(cache_k, response, ttl_seconds=7 * 86_400)
                return response
            except Exception as exc:
                logger.warning("Jolpica yarış sonucu alınamadı: %s", exc)
                # Hata olursa OpenF1 lap-based sıralamaya düş

    drivers = await openf1.fetch_session_drivers(session_key)
    if not drivers:
        return {"session_id": session_id, "entries": [], "segments": {}}

    is_quali = session.type in ("qualifying", "sprint_qualifying")
    sem = asyncio.Semaphore(4)

    # Jolpica'dan takım renklerini almak için driver renklerini OpenF1'den kullan
    drv_colour_map: dict[str, str] = {}  # code → team_colour hex

    # ── Timestamp tabanlı yardımcılar ──────────────────────────────────────
    from datetime import datetime as dt_class

    def _parse(s):
        try: return dt_class.fromisoformat((s or "").replace("Z", "+00:00"))
        except: return None

    def _flying(laps):
        """Geçerli flying lap'ları döner (pit-out değil, süre var, ±%8 threshold)."""
        cands = [l for l in laps if l.get("lap_duration") and not l.get("is_pit_out_lap")]
        if not cands: return []
        fastest = min(c["lap_duration"] for c in cands)
        return [l for l in cands if l["lap_duration"] <= fastest * 1.08]

    # Takım renklerini OpenF1 drivers'tan al
    for d in drivers:
        code = d.get("name_acronym", "???")
        drv_colour_map[code] = d.get("team_colour", "AAAAAA")

    # ── Yarış: Position endpoint ile gerçek tur sıralaması ────────────────
    if is_race and lap is not None:
        from datetime import timedelta

        # Pozisyon verisi + lap verilerini çek (semaphore ile rate limit korumalı)
        try:
            all_positions = await openf1.fetch_positions(session_key)
        except Exception:
            all_positions = []

        async def _fetch_lap_safe(driver):
            dn   = driver.get("driver_number")
            code = driver.get("name_acronym", "???")
            async with sem:
                try:
                    laps = await db_cache.get_laps(session, dn, db)
                except Exception:
                    logger.warning("Lap fetch hatası: driver=%s session=%s", dn, session_id)
                    laps = []
            return code, laps

        lap_raw = await asyncio.gather(*[_fetch_lap_safe(d) for d in drivers])
        laps_by_dyn = {code: laps for code, laps in lap_raw if laps}

        # dn → position listesi (zaman sıralı)
        pos_by_dn: dict[int, list[dict]] = {}
        for p in sorted(all_positions, key=lambda x: x.get("date", "")):
            dn = p.get("driver_number")
            if dn not in pos_by_dn:
                pos_by_dn[dn] = []
            pos_by_dn[dn].append(p)

        dyn_entries = []
        for d in drivers:
            dn   = d.get("driver_number")
            code = d.get("name_acronym", "???")
            d_laps = laps_by_dyn.get(code, [])

            # Bu pilotun N. turunu bul
            lap_n = next((l for l in d_laps if l.get("lap_number") == lap), None)
            if not lap_n:
                # N. tur verisi yoksa: en son bilinen konumu kullan
                lap_n = None

            # Tur N bitişindeki timestamp
            lap_end_dt = None
            if lap_n and lap_n.get("date_start") and lap_n.get("lap_duration"):
                start = _parse(lap_n["date_start"])
                if start:
                    lap_end_dt = start + timedelta(seconds=float(lap_n["lap_duration"]))

            # O ana kadar son bilinen konum
            position_at_lap: int | None = None
            driver_pos_list = pos_by_dn.get(dn, [])
            if driver_pos_list:
                if lap_end_dt:
                    for p in driver_pos_list:
                        p_dt = _parse(p.get("date"))
                        if p_dt and p_dt <= lap_end_dt:
                            position_at_lap = p.get("position")
                        elif p_dt and p_dt > lap_end_dt:
                            break
                else:
                    position_at_lap = driver_pos_list[-1].get("position")

            if position_at_lap is None:
                continue

            dyn_entries.append({
                "code":        code,
                "full_name":   (d.get("full_name") or
                                f"{d.get('first_name','')} {d.get('last_name','')}").strip(),
                "team_name":   d.get("team_name", ""),
                "team_colour": f"#{drv_colour_map.get(code, 'AAAAAA')}",
                "position":    position_at_lap,
                "lap_time":    None, "sector1": None, "sector2": None, "sector3": None,
                "compound":    None,
                "status":      f"Tur {lap}",
                "fastest_lap": None, "fastest_lap_rank": None,
                "points":      0, "grid": 0,
                # gap için ön hesap
                "_pos": position_at_lap,
            })

        # Pozisyona göre sırala
        dyn_entries.sort(key=lambda e: e["_pos"])
        for i, e in enumerate(dyn_entries):
            e["position"] = i + 1
            e["gap_str"]  = "LDR" if i == 0 else f"P{e['_pos']}"
            del e["_pos"]
            e["sector1_is_best"] = False
            e["sector2_is_best"] = False
            e["sector3_is_best"] = False
            e["gap"] = 0.0

        response = {
            "session_id":   session_id,
            "session_type": session.type,
            "is_quali": False, "is_race": True,
            "dynamic_lap": lap,
            "entries":   dyn_entries,
            "segments":  {},
        }
        await cache_set(cache_k, response, ttl_seconds=120)
        return response

    # ── Sıralama / Antrenman: Lap tablosundan oku (kalıcı, tüm pilotlar) ──────
    from collections import defaultdict
    from sqlalchemy import func as sa_func
    from sqlalchemy.orm import selectinload as sl

    driver_count_res = await db.execute(
        select(sa_func.count(sa_func.distinct(Lap.driver_id)))
        .where(Lap.session_id == session_id)
    )
    driver_count = driver_count_res.scalar_one()

    # Yeterli pilot yoksa tek API çağrısıyla inline sync yap
    if driver_count < 18 and session.status == "finished":
        await db_cache.bulk_sync_to_lap_table(session, db)
        driver_count = (await db.execute(
            select(sa_func.count(sa_func.distinct(Lap.driver_id))).where(Lap.session_id == session_id)
        )).scalar_one()

    # Lap tablosundan tüm geçerli turları tek sorguda çek
    laps_res = await db.execute(
        select(Lap)
        .where(
            Lap.session_id == session_id,
            Lap.is_pit_out_lap == False,
            Lap.lap_time.isnot(None),
        )
        .options(sl(Lap.driver).selectinload(Driver.current_team))
        .order_by(Lap.driver_id, Lap.lap_number)
    )
    all_laps = laps_res.scalars().all()

    # Her pilot için en iyi turu bul
    laps_by_driver: dict[int, list] = defaultdict(list)
    for lap in all_laps:
        if lap.lap_time and lap.lap_time < 300:  # SC/kırmızı bayrak turlarını at
            laps_by_driver[lap.driver_id].append(lap)

    def _add_pos(lst, lead_time):
        for i, e in enumerate(lst):
            e["position"] = i + 1
            e["gap"] = round(e["lap_time"] - lead_time, 4) if i > 0 else 0.0
        return lst

    def _mark_best(lst):
        for field in ("sector1", "sector2", "sector3"):
            vals = [e[field] for e in lst if e.get(field)]
            best_val = min(vals) if vals else None
            for e in lst:
                e[f"{field}_is_best"] = bool(e.get(field) and e[field] == best_val)
        return lst

    entries = []
    for driver_id, driver_laps in laps_by_driver.items():
        best = min(driver_laps, key=lambda l: l.lap_time)
        drv  = best.driver
        team = drv.current_team
        entries.append({
            "code":       drv.code,
            "full_name":  drv.full_name,
            "team_name":  team.name if team else "",
            "team_colour": team.color_hex if team else "#AAAAAA",
            "lap_time":   best.lap_time,
            "sector1":    best.sector1_time,
            "sector2":    best.sector2_time,
            "sector3":    best.sector3_time,
            "compound":   best.compound,
            "q_segment":  None,
            "gap":        0.0,
            "position":   0,
            "sector1_is_best": False,
            "sector2_is_best": False,
            "sector3_is_best": False,
        })

    entries.sort(key=lambda e: e["lap_time"])
    lead = entries[0]["lap_time"] if entries else 0
    entries = _add_pos(entries, lead)
    entries = _mark_best(entries)

    response = {
        "session_id":   session_id,
        "session_type": session.type,
        "is_quali":     is_quali,
        "is_race":      False,
        "syncing":      False,
        "entries":      entries,
        "segments":     {},  # Q segmentleri Lap tablosunda timestamp yok, şimdilik boş
    }
    # 18+ pilot varsa 1 saat, eksikse 15 saniye (arka plan sync tamamlanınca dolar)
    ttl = 3600 if (session.status == "finished" and len(entries) >= 18) else 15
    await cache_set(cache_k, response, ttl_seconds=ttl)
    return response


@router.post("/{session_id}/sync_cache")
async def sync_session_cache(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Biten bir session'ın tüm OpenF1 verisini (laps + stints) DB'ye kalıcı olarak yazar.
    İlk çağrıda yavaş olabilir (~30-60s), sonraki tüm istekler DB'den anında gelir.
    """
    session = await _resolve_session(session_id, db)
    result  = await db_cache.sync_session(session, db)
    return result


@router.post("/sync_all_finished")
async def sync_all_finished_sessions(
    db: AsyncSession = Depends(get_db),
    session_type: str | None = Query(None, description="Sadece bu tip: race, qualifying vb."),
    _admin: User = Depends(require_admin),
):
    """
    Biten session'ların verisini DB cache'e sıralı olarak çeker.
    Rate limit'e takılmamak için session'lar arası 2s bekleme uygulanır.
    Büyük veri setleri için arka planda çalışır.
    """
    from sqlalchemy import select as sa_select

    q = sa_select(Session).where(Session.status == "finished")
    if session_type:
        q = q.where(Session.type == session_type)

    result = await db.execute(q)
    sessions = result.scalars().all()

    results = []
    for s in sessions:
        try:
            r = await db_cache.sync_session(s, db)
            results.append({"session_id": s.id, "type": s.type, **r})
            # Rate limit koruması — session'lar arası kısa bekleme
            await asyncio.sleep(2)
        except Exception as e:
            results.append({"session_id": s.id, "type": s.type, "status": "error", "error": str(e)})

    return {"total": len(sessions), "synced": sum(1 for r in results if r.get("status") == "ok"), "results": results}


# ─── 2026 Enerji Analizi ─────────────────────────────────────────────────────

@router.get("/{session_id}/energy_analysis/{driver_code}")
async def get_energy_analysis(
    session_id:  int,
    driver_code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    2026 F1 sanal enerji yönetimi analizi.

    Fizik modeli ile tahmini:
    - SoC (State of Charge) eğrisi
    - Deploy / Regen bölgeleri
    - Tur bazında enerji bütçesi
    - Pilot agresiflik & harvest verimliliği profili
    - X-mode (aktif aero) tespit olasılığı

    İlk çağrı ~15-30s (OpenF1 + hesaplama), sonraki çağrılar ~10ms (DB cache).
    """
    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    # Pilot numarasını bul
    driver_number = await openf1.get_driver_number(session_key, driver_code.upper())
    if not driver_number:
        raise HTTPException(404, f"Pilot bulunamadı: {driver_code}")

    # ── DB cache kontrolü ───────────────────────────────────────
    cached = await db.get(EnergyAnalysisCache, (session_key, driver_number))
    if cached:
        return {"session_id": session_id, "driver_code": driver_code,
                "cached": True, **cached.result}

    # ── Ham car data'yı DB'den veya OpenF1'den al ───────────────
    car_row = await db.get(OpenF1CarDataCache, (session_key, driver_number))
    if car_row:
        car_data = car_row.data
    else:
        car_data = await openf1.fetch_car_data(session_key, driver_number)
        if car_data and session.status == "finished":
            db.add(OpenF1CarDataCache(
                session_key=session_key,
                driver_number=driver_number,
                data=car_data,
            ))
            await db.flush()

    if not car_data:
        raise HTTPException(404, "Bu oturum için araba verisi bulunamadı.")

    # Lap verisi (timestamp eşleştirme için)
    laps = await db_cache.get_laps(session, driver_number, db)

    # ── Fizik modeli hesapla ─────────────────────────────────────
    result = energy_svc.compute_energy_analysis(car_data, laps, driver_number)

    # ── Hesaplanan sonucu DB'ye kaydet ───────────────────────────
    if session.status == "finished":
        db.add(EnergyAnalysisCache(
            session_key=session_key,
            driver_number=driver_number,
            result=result,
        ))
        await db.commit()

    return {"session_id": session_id, "driver_code": driver_code,
            "cached": False, **result}
