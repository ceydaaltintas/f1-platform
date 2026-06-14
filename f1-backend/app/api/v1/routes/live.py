"""
Canlı yarış REST ve SSE endpoint'leri.

GET  /live/status              → Aktif oturum var mı?
POST /live/activate            → Oturumu canlıya al (admin)
POST /live/deactivate          → Canlı modu kapat
GET  /live/{session_id}/commentary  → SSE: AI canlı yorum akışı
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis_client import cache_get, cache_key, cache_set
from app.models.f1 import Session
from app.services import claude_ai, openf1
from app.services.live_session import (
    auto_detect_live_session,
    check_openf1_live_status,
    clear_active_session,
    get_active_session,
    get_live_snapshot,
    set_active_session,
)
from app.services.sync import _determine_current_season

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/live", tags=["canlı yarış"])

# Resmi yarış mesafesi tur sayıları (circuit_name → tur sayısı).
# OpenF1 stint verisi sadece ŞU ANA KADAR koşulan turu verir, bu yüzden
# toplam tur sayısı için sabit bir takvim haritası kullanılır.
CIRCUIT_TOTAL_LAPS: dict[str, int] = {
    "Albert Park Grand Prix Circuit": 58,
    "Shanghai International Circuit": 56,
    "Suzuka Circuit": 53,
    "Miami International Autodrome": 57,
    "Circuit Gilles Villeneuve": 70,
    "Circuit de Monaco": 78,
    "Circuit de Barcelona-Catalunya": 66,
    "Red Bull Ring": 71,
    "Silverstone Circuit": 52,
    "Circuit de Spa-Francorchamps": 44,
    "Hungaroring": 70,
    "Circuit Park Zandvoort": 72,
    "Autodromo Nazionale di Monza": 53,
    "Madring": 57,
    "Baku City Circuit": 51,
    "Marina Bay Street Circuit": 62,
    "Circuit of the Americas": 56,
    "Autódromo Hermanos Rodríguez": 71,
    "Autódromo José Carlos Pace": 71,
    "Las Vegas Strip Street Circuit": 50,
    "Losail International Circuit": 57,
    "Yas Marina Circuit": 58,
}


# Bir pilotun aralık verisi, en güncel veriden 90s'den fazla eskiyse DNF/emekli kabul edilir
RETIRED_THRESHOLD_SECONDS = 90


def _inactive_driver_numbers(latest_iv: dict[int, dict], drivers: list[dict]) -> set:
    """DNF/emekli pilotların driver_number'larını döner.

    Yarış sonunda tüm pilotların interval akışı durur — bu yüzden eşik,
    en güncel interval timestamp'ine (live_ts) göre relatiftir.
    """
    dates = [iv.get("date") for iv in latest_iv.values() if iv.get("date")]
    live_ts = max(dates) if dates else None

    def _is_retired(iv_date: str | None) -> bool:
        if not live_ts or not iv_date:
            return False
        try:
            d1 = datetime.fromisoformat(iv_date.replace("Z", "+00:00"))
            d2 = datetime.fromisoformat(live_ts.replace("Z", "+00:00"))
            return (d2 - d1).total_seconds() > RETIRED_THRESHOLD_SECONDS
        except ValueError:
            return False

    inactive = {dn for dn, iv in latest_iv.items() if _is_retired(iv.get("date"))}
    inactive |= {d.get("driver_number") for d in drivers if d.get("driver_number") not in latest_iv}
    return inactive


# Gap değerini float'a çevir (+2 LAPS → 9000+, 1:23.456 → saniye, sayı → float)
def _gap_val(gap) -> float:
    if gap is None: return 9999.0
    s = str(gap).strip()
    if "LAP" in s.upper():
        try: return 9000.0 + float(s.split()[0].replace("+",""))
        except: return 9999.0
    try: return float(s.replace("+",""))
    except: return 9999.0


# ─── Status ──────────────────────────────────────────────────────────────────

@router.get("/status")
async def live_status():
    """Aktif canlı oturum bilgisini döner."""
    active = await get_active_session()
    if active is None:
        return {"live": False, "message": "Şu an canlı oturum yok"}

    # Worker her zaman çalışmayabilir — yarış bitmişse aktif oturumu burada da temizle
    # (anasayfadaki "CANLI YARIŞ" linki bitmiş yarışı göstermesin)

    # 1) /timing zaten hesaplamışsa (lider total_laps'i tamamladı mı) onu kullan — ekstra istek yok
    cached_timing = await cache_get(cache_key("live_timing", active["session_id"]))
    if cached_timing and cached_timing.get("race_finished"):
        await clear_active_session()
        return {"live": False, "message": "Yarış bitti"}

    # 2) Aksi halde OpenF1'in oturum durumunu sorgula
    ck = cache_key("openf1_session_status", active["session_key"])
    status = await cache_get(ck)
    if status is None:
        status = await check_openf1_live_status(active["session_key"])
        await cache_set(ck, status, ttl_seconds=60)

    if status == "finished":
        await clear_active_session()
        return {"live": False, "message": "Yarış bitti"}

    return {
        "live": True,
        "session_id": active["session_id"],
        "session_key": active["session_key"],
        "year": active["year"],
    }


# ─── DEMO (parametre içermeyen route'lar ÜST sıraya gelmeli) ─────────────────

@router.get("/demo/timing")
async def demo_timing():
    """Gerçekçi demo — her 8s'de biraz farklı sonuç döner."""
    import random, time
    rnd = random.Random(int(time.time() / 8))
    lap = rnd.randint(28, 45)
    drivers_data = [
        ("ANT","Mercedes","#00D7B6",0.0,        0.0,        "MEDIUM",8,  1),
        ("RUS","Mercedes","#00D7B6",1.2+rnd.uniform(-0.3,0.3), rnd.uniform(0.8,1.6), "HARD",14,  2),
        ("LEC","Ferrari", "#ED1131",3.8+rnd.uniform(-0.5,0.5), rnd.uniform(1.2,2.5), "MEDIUM",6,  2),
        ("HAM","Ferrari", "#ED1131",5.1+rnd.uniform(-0.4,0.6), rnd.uniform(0.9,1.8), "HARD",20,  1),
        ("NOR","McLaren", "#FF8000",8.4+rnd.uniform(-1.0,1.0), rnd.uniform(1.5,3.2), "SOFT",5,   3),
        ("PIA","McLaren", "#FF8000",11.2+rnd.uniform(-0.8,0.8),rnd.uniform(2.0,3.5), "HARD",18,  2),
        ("VER","RBR",     "#3671C6",14.8+rnd.uniform(-1.5,1.5),rnd.uniform(1.8,4.0), "MEDIUM",10, 2),
        ("SAI","Ferrari", "#ED1131",18.3+rnd.uniform(-1.0,1.0),rnd.uniform(2.5,4.5), "SOFT",3,   3),
        ("ALO","Aston",   "#358C75",22.1+rnd.uniform(-2.0,2.0),rnd.uniform(2.0,4.0), "HARD",22,  1),
        ("STR","Aston",   "#358C75",28.5+rnd.uniform(-2.0,2.0),rnd.uniform(3.0,6.0), "MEDIUM",12, 2),
    ]
    entries = [
        {
            "position": i+1, "driver_number": i+1,
            "code": code, "full_name": code, "team_name": team, "team_colour": colour,
            "gap_to_leader": round(gap,3) if i>0 else 0.0,
            "interval": f"+{round(iv,3)}" if i>0 else "LDR",
            "compound": compound, "tyre_age": tyre_age, "pit_count": pits,
        }
        for i,(code,team,colour,gap,iv,compound,tyre_age,pits) in enumerate(drivers_data)
    ]
    sc = rnd.random()
    return {
        "session_id": 0, "entries": entries,
        "current_lap": lap, "total_laps": 58,
        "demo": True,
        "flag": "SC" if sc<0.12 else ("YELLOW" if sc<0.22 else None),
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/demo/weather")
async def demo_weather():
    import random, time
    rnd = random.Random(int(time.time() / 30))
    return {
        "track_temp": round(44+rnd.uniform(-2,4),1), "air_temp": round(28+rnd.uniform(-1,2),1),
        "humidity": round(32+rnd.uniform(-5,5),1), "wind_speed": round(8+rnd.uniform(-3,5),1),
        "wind_dir": rnd.choice([0,45,90,135,180]), "rainfall": rnd.random()<0.05,
        "demo": True, "ts": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/demo/race_control")
async def demo_race_control():
    return {"session_id": 0, "demo": True, "messages": [
        {"flag": "GREEN",  "message": "Pist açık — yeşil bayrak tüm pistde"},
        {"flag": "NONE",   "message": "DRS ENABLED"},
        {"flag": "YELLOW", "message": "Tur 12, Viraj 3 — sarı bayrak: NOR pistte döndü"},
        {"flag": "NONE",   "message": "Araştırma: VER ve LEC — 23. turda temas"},
        {"flag": "SC",     "message": "SAFETY CAR YOLDA — kaza: GAS Viraj 8"},
        {"flag": "GREEN",  "message": "Safety Car geliyor — sonraki turda yarış yeniden başlıyor"},
        {"flag": "NONE",   "message": "5 saniye ceza — NOR (pist dışında avantaj)"},
        {"flag": "NONE",   "message": "DRS DISABLED — sarı bayrak bölgesi"},
    ]}


# ─── Activate / Deactivate ───────────────────────────────────────────────────

class ActivateBody(BaseModel):
    session_id: int
    session_key: int | None = None  # Verilmezse OpenF1'den otomatik bulunur


@router.post("/activate")
async def activate_live(body: ActivateBody, db: AsyncSession = Depends(get_db)):
    """
    Belirtilen oturumu canlı moda alır.
    session_key verilmezse OpenF1'den otomatik tespit edilir.
    """
    result = await db.execute(select(Session).where(Session.id == body.session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(404, f"Session {body.session_id} bulunamadı")

    session_key = body.session_key or session.session_key
    if session_key is None:
        raise HTTPException(
            400,
            "session_key verilmedi ve DB'de kayıtlı değil. "
            "Telemetri sayfasını açarak otomatik çözümleme yapılabilir.",
        )

    year = _determine_current_season()
    await set_active_session(body.session_id, session_key, year)
    session.status = "active"
    await db.commit()

    return {
        "message": "Canlı mod aktif",
        "session_id": body.session_id,
        "session_key": session_key,
    }


@router.post("/auto_activate")
async def auto_activate(db: AsyncSession = Depends(get_db)):
    """
    OpenF1'de aktif bir oturum otomatik olarak tespit edilip aktive edilir.
    """
    year = _determine_current_season()
    live = await auto_detect_live_session(year)
    if live is None:
        return {"message": f"{year} yılında aktif oturum bulunamadı"}

    result = await db.execute(
        select(Session).where(Session.session_key == live["session_key"])
    )
    session = result.scalar_one_or_none()
    if session is None:
        return {
            "message": "OpenF1'de oturum bulundu ama veritabanında kayıtlı değil. "
                       "Önce sezonu sync edin.",
            "detected": live,
        }

    await set_active_session(session.id, live["session_key"], year)
    session.status = "active"
    await db.commit()

    return {
        "message": "Canlı mod otomatik aktive edildi",
        "session_id": session.id,
        "session_key": live["session_key"],
        "circuit": live.get("circuit"),
        "session_name": live.get("session_name"),
    }


@router.post("/deactivate")
async def deactivate_live(db: AsyncSession = Depends(get_db)):
    """Canlı modu kapatır."""
    active = await get_active_session()
    if active:
        result = await db.execute(select(Session).where(Session.id == active["session_id"]))
        s = result.scalar_one_or_none()
        if s:
            s.status = "finished"
            await db.commit()
    await clear_active_session()
    return {"message": "Canlı mod kapatıldı"}


# ─── Anlık Durum Snapshot'ı ──────────────────────────────────────────────────

@router.get("/{session_id}/snapshot/{kind}")
async def get_snapshot(session_id: int, kind: str):
    """
    Son polling snapshot'ını döner (WebSocket olmadan polling için).
    kind: timing | positions | race_control
    """
    active = await get_active_session()
    if active is None or active.get("session_id") != session_id:
        raise HTTPException(404, "Bu oturum aktif değil")

    snapshot = await get_live_snapshot(active["session_key"], kind)
    if snapshot is None:
        raise HTTPException(404, f"'{kind}' verisi henüz yok")
    return snapshot


    return snapshot


# ─── Polling tabanlı canlı veri endpoint'leri ────────────────────────────────

@router.get("/{session_id}/timing")
async def get_live_timing(session_id: int, db: AsyncSession = Depends(get_db)):
    """
    Canlı sıralama: intervals + driver bilgisi + son turlar.
    Frontend her 8-10 saniyede bir çeker.
    """
    from sqlalchemy import select as sa_select
    from app.models.f1 import Session as SessionModel
    from app.api.v1.routes.telemetry import _resolve_session, _require_session_key

    ck = cache_key("live_timing", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    drivers   = await openf1.fetch_session_drivers(session_key)
    intervals = await openf1.fetch_intervals(session_key)
    stints    = await openf1.fetch_stints(session_key)

    # Mevcut tur + her pilotun son tur süresi
    current_lap = None
    total_laps  = None
    last_lap_by_dn: dict[int, float | None] = {}

    if drivers:
        lead_dn = drivers[0].get("driver_number")
        try:
            lead_laps = await openf1.fetch_laps(session_key, lead_dn)
            if lead_laps:
                current_lap = max(
                    (l.get("lap_number") or 0) for l in lead_laps
                ) or None
                # Lider için son temiz tur süresi
                clean = [l for l in lead_laps if l.get("lap_duration") and not l.get("is_pit_out_lap")]
                if clean:
                    last_lap_by_dn[lead_dn] = clean[-1].get("lap_duration")
        except Exception:
            pass

    # Toplam tur: önce sabit takvim haritasından (resmi yarış mesafesi),
    # bulunamazsa stintlerden maksimum lap_end (yedek değer)
    circuit_name = session.round.circuit_name if session.round else None
    total_laps = CIRCUIT_TOTAL_LAPS.get(circuit_name)
    if total_laps is None and stints:
        max_lap_end = max((s.get("lap_end") or 0) for s in stints)
        if max_lap_end > 0:
            total_laps = max_lap_end

    # Yarış bitti mi? Lider son turu (total_laps) tamamladıysa bayrak göster.
    race_finished = bool(
        current_lap is not None and total_laps is not None and current_lap >= total_laps
    )

    # Driver kodlarını numaraya eşle
    num_to_info = {
        d["driver_number"]: {
            "code":         d.get("name_acronym", "???"),
            "full_name":    d.get("full_name", ""),
            "team_name":    d.get("team_name", ""),
            "team_colour":  f"#{d.get('team_colour','888888')}",
        }
        for d in drivers
    }
    # positions_map endpoint'i için pilot kodu/rengi cache'le (ekstra OpenF1 isteği önler)
    await cache_set(cache_key("session_drivers_info", session_key), num_to_info, ttl_seconds=3600)
    # Stintlerden: son stint (lastik) + toplam stint sayısı (pit count = stint - 1)
    latest_stint: dict[int, dict] = {}
    stint_count:  dict[int, int]  = {}
    for s in stints:
        dn = s.get("driver_number")
        if dn is None:
            continue
        stint_count[dn] = max(stint_count.get(dn, 0), s.get("stint_number") or 1)
        if dn not in latest_stint or (s.get("stint_number") or 0) > (latest_stint[dn].get("stint_number") or 0):
            latest_stint[dn] = s

    entries: list[dict] = []

    if race_finished:
        # Yarış bittiyse OpenF1'in resmi sonuç listesi (session_result) kullanılır —
        # intervals akışı yarış sonunda donduğu için lider dahil herkesin "son güncelleme"
        # zamanı birbirine yakın olur ve DNF tespiti (interval bazlı) yanlış sonuç verir.
        try:
            session_result = await openf1.fetch_session_result(session_key)
        except Exception:
            session_result = []

        def _result_sort_key(r: dict) -> float:
            pos = r.get("position")
            if pos is not None:
                return pos
            return 1000 - (r.get("number_of_laps") or 0)

        for r in sorted(session_result, key=_result_sort_key):
            dn = r.get("driver_number")
            info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint = latest_stint.get(dn, {})
            raw_gap = r.get("gap_to_leader")

            if r.get("dsq"):
                status, gap_to_leader, gap_seconds, lapped = "DSQ", "DSQ", 99999.0, False
            elif r.get("dns"):
                status, gap_to_leader, gap_seconds, lapped = "DNS", "DNS", 99999.0, False
            elif r.get("dnf"):
                status, gap_to_leader, gap_seconds, lapped = "DNF", "DNF", 99999.0, False
            else:
                status = None
                gap_to_leader = raw_gap if raw_gap is not None else 0
                gap_seconds   = _gap_val(raw_gap)
                lapped        = "LAP" in str(raw_gap or "").upper()

            entry = {
                "position":      len(entries) + 1,
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "gap_to_leader": gap_to_leader,
                "gap_seconds":   gap_seconds,
                "interval":      None,
                "lapped":        lapped,
                "compound":      stint.get("compound"),
                "tyre_age":      stint.get("tyre_age_at_end") or stint.get("lap_end"),
                "pit_count":     max(0, (stint_count.get(dn, 1) - 1)),
                "last_lap_time": last_lap_by_dn.get(dn),
                "number_of_laps": r.get("number_of_laps"),
            }
            if status:
                entry["status"] = status
            entries.append(entry)

        inactive_dns = {r.get("driver_number") for r in session_result if r.get("dnf") or r.get("dns") or r.get("dsq")}
        await cache_set(cache_key("inactive_drivers", session_key), list(inactive_dns), ttl_seconds=30)

    else:
        # ── Her sürücünün EN SON interval kaydını al ──────────────────────────────
        # intervals binlerce satır içerebilir; sürücü başına sadece max(date) olan alınır
        latest_iv: dict[int, dict] = {}
        for iv in intervals:
            dn = iv.get("driver_number")
            if dn is None:
                continue
            if dn not in latest_iv or (iv.get("date","") > latest_iv[dn].get("date","")):
                latest_iv[dn] = iv

        # DNF/DNS pilotlar (emekli + hiç interval verisi olmayan) — positions_map'in
        # ekstra OpenF1 isteği yapmadan filtreleyebilmesi için cache'lenir
        inactive_dns = _inactive_driver_numbers(latest_iv, drivers)
        await cache_set(cache_key("inactive_drivers", session_key), list(inactive_dns), ttl_seconds=30)

        active_ivs  = [iv for iv in latest_iv.values() if iv.get("driver_number") not in inactive_dns]
        retired_ivs = [iv for iv in latest_iv.values() if iv.get("driver_number") in inactive_dns]

        sorted_intervals = sorted(active_ivs, key=lambda x: _gap_val(x.get("gap_to_leader")))

        seen_dns: set = set()

        for iv in sorted_intervals:
            dn = iv.get("driver_number")
            if dn is None:
                continue
            seen_dns.add(dn)
            info    = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint   = latest_stint.get(dn, {})
            raw_gap = iv.get("gap_to_leader")
            entries.append({
                "position":      len(entries) + 1,
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "gap_to_leader": raw_gap,
                "gap_seconds":   _gap_val(raw_gap),
                "interval":      iv.get("interval"),
                "lapped":        "LAP" in str(raw_gap or "").upper(),
                "compound":      stint.get("compound"),
                "tyre_age":      stint.get("tyre_age_at_end") or stint.get("lap_end"),
                "pit_count":     max(0, (stint_count.get(dn, 1) - 1)),
                "last_lap_time": last_lap_by_dn.get(dn),
            })

        # Aralık verisi eskimiş pilotlar (yarış sırasında DNF/emekli) — sona ekle
        for iv in retired_ivs:
            dn = iv.get("driver_number")
            if dn is None:
                continue
            seen_dns.add(dn)
            info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint = latest_stint.get(dn, {})
            entries.append({
                "position":      len(entries) + 1,
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "gap_to_leader": "DNF",
                "gap_seconds":   99999.0,
                "interval":      None,
                "lapped":        False,
                "status":        "DNF",
                "compound":      stint.get("compound"),
                "tyre_age":      stint.get("tyre_age_at_end") or stint.get("lap_end"),
                "pit_count":     max(0, (stint_count.get(dn, 1) - 1)),
                "last_lap_time": last_lap_by_dn.get(dn),
            })

        # Interval verisi olmayan pilotlar (DNF/DNS baştan) — sona ekle
        for d in drivers:
            dn = d.get("driver_number")
            if dn is None or dn in seen_dns:
                continue
            info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint = latest_stint.get(dn, {})
            entries.append({
                "position":      len(entries) + 1,
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "gap_to_leader": "DNS/DNF",
                "gap_seconds":   99999.0,
                "interval":      None,
                "lapped":        False,
                "status":        "DNS/DNF",
                "compound":      stint.get("compound"),
                "tyre_age":      None,
                "pit_count":     max(0, (stint_count.get(dn, 1) - 1)),
                "last_lap_time": None,
            })

    result = {
        "session_id":  session_id,
        "entries":     entries,
        "current_lap": current_lap,
        "total_laps":  total_laps,
        "race_finished": race_finished,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await cache_set(ck, result, ttl_seconds=6)
    return result


@router.get("/{session_id}/positions_map")
async def get_live_positions_map(session_id: int):
    """Canlı araç GPS konumlarını pist haritasıyla aynı koordinat sisteminde döner."""
    active = await get_active_session()
    if active is None or active.get("session_id") != session_id:
        return {"session_id": session_id, "positions": []}

    session_key = active["session_key"]
    bounds = await cache_get(cache_key("track_bounds", session_id))
    if not bounds:
        # track_map endpoint henüz çağrılmamış (sayfa yüklenince frontend çağırır) —
        # rate limit'e takılmamak için burada yeniden hesaplamıyoruz
        return {"session_id": session_id, "positions": []}

    snapshot = await get_live_snapshot(session_key, "positions") or {}

    # Pilot kodu/rengi — get_live_timing tarafından cache'lenir (ekstra OpenF1 isteği önler)
    num_to_info = await cache_get(cache_key("session_drivers_info", session_key)) or {}
    # DNF/DNS pilotlar — son bilinen konumda donmuş kalmasınlar
    inactive_dns = set(await cache_get(cache_key("inactive_drivers", session_key)) or [])

    positions = []
    for p in snapshot.get("positions", []):
        dn = p.get("driver_number")
        x, y = p.get("x"), p.get("y")
        if dn is None or x is None or y is None:
            continue
        if dn in inactive_dns:
            continue
        info = num_to_info.get(str(dn)) or num_to_info.get(dn) or {"code": str(dn), "team_colour": "#888888"}
        positions.append({
            "driver_number": dn,
            "code": info["code"],
            "color": info.get("team_colour", "#888888"),
            "x": round((x - bounds["x_min"]) * bounds["scale"], 1),
            "y": round((y - bounds["y_min"]) * bounds["scale"], 1),
        })

    return {"session_id": session_id, "positions": positions}


@router.get("/{session_id}/weather")
async def get_live_weather(session_id: int, db: AsyncSession = Depends(get_db)):
    """Hava durumu verisi — her 30 saniyede bir güncellenir."""
    from app.api.v1.routes.telemetry import _resolve_session, _require_session_key

    ck = cache_key("live_weather", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    weather = await openf1.fetch_weather(session_key)
    latest  = weather[-1] if weather else {}

    result = {
        "track_temp":  latest.get("track_temperature"),
        "air_temp":    latest.get("air_temperature"),
        "humidity":    latest.get("humidity"),
        "pressure":    latest.get("pressure"),
        "wind_speed":  latest.get("wind_speed"),
        "wind_dir":    latest.get("wind_direction"),
        "rainfall":    latest.get("rainfall", False),
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await cache_set(ck, result, ttl_seconds=30)
    return result


@router.get("/{session_id}/simulate")
async def live_simulate(
    session_id: int,
    driver_code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Canlı yarış simülasyonu:
    - Her önündeki araç için yakalama tahmini (kaç tur)
    - Şu an pit girerse hangi sırada çıkar
    - Optimal pit penceresi (arkadaki araçtan kaçmak için)
    """
    from app.api.v1.routes.telemetry import _resolve_session, _require_session_key

    ck = cache_key("live_sim", session_id, driver_code.upper())
    cached = await cache_get(ck)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    PIT_LOSS = 22.0  # saniye — ortalama pit stop + pit lane kaybı

    # Tüm sürücüleri çek
    drivers   = await openf1.fetch_session_drivers(session_key)
    intervals = await openf1.fetch_intervals(session_key)
    stints    = await openf1.fetch_stints(session_key)

    # driver_number → code eşleşmesi
    num_to_code = {d["driver_number"]: d.get("name_acronym","???") for d in drivers}
    code_to_num = {v: k for k, v in num_to_code.items()}

    target_num = code_to_num.get(driver_code.upper())
    if target_num is None:
        raise HTTPException(404, f"Pilot bulunamadı: {driver_code}")

    # Son stintlerden son stint no
    latest_stint: dict[int, dict] = {}
    for s in stints:
        dn = s.get("driver_number")
        if dn and (dn not in latest_stint or
                   (s.get("stint_number") or 0) > (latest_stint[dn].get("stint_number") or 0)):
            latest_stint[dn] = s

    # Her sürücünün EN SON interval kaydı
    latest_iv_sim: dict[int, dict] = {}
    for iv in intervals:
        dn = iv.get("driver_number")
        if dn and (dn not in latest_iv_sim or iv.get("date","") > latest_iv_sim[dn].get("date","")):
            latest_iv_sim[dn] = iv

    def _gap(g) -> float:
        if g is None: return 0.0
        s = str(g).strip()
        if "LAP" in s.upper():
            try: return 9000.0 + float(s.split()[0].replace("+",""))
            except: return 9999.0
        try: return float(s.replace("+",""))
        except: return 0.0

    # DNF/DNS pilotlar — bu endpoint'in kendi interval verisinden hesaplanır
    # (get_live_timing'in cache'lediği inactive_drivers'a bağımlı olmadan)
    inactive_dns = _inactive_driver_numbers(latest_iv_sim, drivers)

    # Hedef pilot DNF/emekli ise simülasyon anlamsız — bilgi mesajı dön
    if target_num in inactive_dns:
        return {
            "driver_code":       driver_code.upper(),
            "current_position":  None,
            "current_gap":       None,
            "retired":           True,
            "message":           f"{driver_code.upper()} yarışı tamamlamadı (DNF) — simülasyon geçerli değil",
            "avg_pace":          None,
            "pit_loss_estimate": PIT_LOSS,
            "catch_analysis":    [],
            "pit_scenario":      {"position_after_pit": None, "cars_still_ahead": [], "cars_overtaken": []},
            "optimal_pit":       None,
        }

    sorted_ivs = sorted(latest_iv_sim.values(), key=lambda x: _gap(x.get("gap_to_leader")))
    pos_map: dict[int, int] = {}
    gap_map: dict[int, float] = {}
    for i, iv in enumerate(sorted_ivs):
        dn = iv.get("driver_number")
        if dn in inactive_dns:
            continue
        if dn not in pos_map:
            pos_map[dn] = len(pos_map) + 1
            gap_map[dn] = _gap(iv.get("gap_to_leader"))

    target_pos = pos_map.get(target_num, 99)
    target_gap = gap_map.get(target_num, 0.0)
    is_lapped  = target_gap >= 9000  # "+X LAP" durumu

    # Tüm pilotların tur verisi — tek istekle (her pilot için ayrı /laps çağrısı
    # OpenF1 rate limit'ini hızla tüketiyordu), kısa süreliğine cache'lenir
    all_laps_ck = cache_key("session_all_laps", session_key)
    all_laps = await cache_get(all_laps_ck)
    if all_laps is None:
        try:
            all_laps = await openf1.fetch_all_session_laps(session_key)
        except Exception:
            all_laps = []
        await cache_set(all_laps_ck, all_laps, ttl_seconds=20)

    laps_by_dn: dict[int, list[dict]] = {}
    for l in all_laps:
        dn = l.get("driver_number")
        if dn is not None:
            laps_by_dn.setdefault(dn, []).append(l)

    # Her sürücünün son 5 clean turundaki ort tur süresi
    def _avg_pace(dn: int) -> float | None:
        laps = laps_by_dn.get(dn, [])
        clean = [
            l["lap_duration"] for l in laps
            if l.get("lap_duration") and not l.get("is_pit_out_lap")
        ]
        if not clean: return None
        fastest = min(clean)
        valid = [t for t in clean if t <= fastest * 1.06]
        return sum(sorted(valid)[-5:]) / len(sorted(valid)[-5:]) if valid else None

    # Hedef sürücünün pace'i
    target_pace = _avg_pace(target_num)

    # Laplı pilot için basit mesaj dön
    if is_lapped:
        laps_down = int((target_gap - 9000))
        return {
            "driver_code":       driver_code.upper(),
            "current_position":  target_pos,
            "current_gap":       target_gap,
            "lapped":            True,
            "laps_down":         laps_down,
            "message":           f"{driver_code.upper()} {laps_down} tur geride — simülasyon geçerli değil",
            "avg_pace":          target_pace,
            "pit_loss_estimate": PIT_LOSS,
            "catch_analysis":    [],
            "pit_scenario":      {"position_after_pit": target_pos, "cars_still_ahead": [], "cars_overtaken": []},
            "optimal_pit":       None,
        }

    # ── 1: Yakalama simülasyonu (önündeki her araç için) ──────────────────
    catch_results = []
    for dn, pos in sorted(pos_map.items(), key=lambda x: x[1]):
        if pos >= target_pos:
            continue  # Arkada olanları atla
        code = num_to_code.get(dn, "???")
        their_gap  = gap_map.get(dn, 0.0)
        gap_to_catch = target_gap - their_gap   # hedefin onlara uzaklığı (saniye)
        if gap_to_catch <= 0:
            continue

        their_pace = _avg_pace(dn)
        if target_pace and their_pace:
            pace_diff = their_pace - target_pace  # pozitif = hedef daha hızlı
            if pace_diff > 0.05:
                laps_to_catch = gap_to_catch / pace_diff
                catch_results.append({
                    "ahead_code":      code,
                    "ahead_pos":       pos,
                    "gap_seconds":     round(gap_to_catch, 2),
                    "pace_gain_per_lap": round(pace_diff, 3),
                    "laps_to_catch":   round(laps_to_catch, 1),
                    "target_pace":     round(target_pace, 3),
                    "ahead_pace":      round(their_pace, 3),
                    "catchable":       True,
                })
            else:
                catch_results.append({
                    "ahead_code":  code,
                    "ahead_pos":   pos,
                    "gap_seconds": round(gap_to_catch, 2),
                    "catchable":   False,
                    "reason": "Benzer veya daha yavaş pace" if pace_diff <= 0
                              else f"Sadece {pace_diff:.3f}s/tur kazanıyor",
                })

    # ── 2: Pit senaryosu (şu an pit girerse) ─────────────────────────────
    # Sadece aynı turda olan araçlar (gap < 9000 = laplı değil)
    new_effective_gap = target_gap + PIT_LOSS

    pit_ahead = []
    pit_behind = []

    for dn, pos in sorted(pos_map.items(), key=lambda x: x[1]):
        code    = num_to_code.get(dn, "???")
        their_g = gap_map.get(dn, 0.0)

        if dn == target_num:
            continue
        if their_g >= 9000:
            continue  # Laplı araçları atla

        if their_g < new_effective_gap:
            pit_ahead.append({
                "code": code, "pos": pos,
                "gap_after_pit": round(new_effective_gap - their_g, 2),
            })
        else:
            pit_behind.append({
                "code": code, "pos": pos,
                "gap_after_pit": round(their_g - new_effective_gap, 2),
            })

    new_pos_after_pit = len(pit_ahead) + 1

    # ── 3: Optimal pit penceresi ──────────────────────────────────────────
    # Sadece aynı turda olan araçlar
    cars_behind = sorted(
        [(dn, gap_map[dn]) for dn, pos in pos_map.items()
         if pos > target_pos and dn != target_num and gap_map.get(dn, 9999) < 9000],
        key=lambda x: x[1], reverse=True
    )

    optimal_pit_info = None
    if cars_behind:
        closest_behind_dn, closest_behind_gap = cars_behind[0]
        gap_margin = closest_behind_gap - target_gap  # pozitif = hedef önde
        # Pit window: arkadaki araç pit_loss süresinden daha geride ise güvenli pit
        safe_to_pit = gap_margin >= PIT_LOSS
        optimal_pit_info = {
            "closest_behind": num_to_code.get(closest_behind_dn, "???"),
            "gap_to_behind":  round(gap_margin, 2),
            "safe_to_pit_now": safe_to_pit,
            "needed_gap":     PIT_LOSS,
            "message": (
                f"Güvenli pit! {gap_margin:.1f}s önde, pit kaybı {PIT_LOSS:.0f}s."
                if safe_to_pit
                else f"Riskli! {num_to_code.get(closest_behind_dn,'???')}'ya sadece {gap_margin:.1f}s önde, pit kaybı {PIT_LOSS:.0f}s."
            ),
        }

    result = {
        "driver_code":       driver_code.upper(),
        "current_position":  target_pos,
        "current_gap":       round(target_gap, 2),
        "avg_pace":          round(target_pace, 3) if target_pace else None,
        "pit_loss_estimate": PIT_LOSS,
        "catch_analysis":    catch_results,
        "pit_scenario": {
            "position_after_pit": new_pos_after_pit,
            "cars_still_ahead":   pit_ahead,
            "cars_overtaken":     pit_behind,
            "gap_after_pit":      round(new_effective_gap, 2),
        },
        "optimal_pit": optimal_pit_info,
    }
    await cache_set(ck, result, ttl_seconds=10)
    return result


@router.get("/{session_id}/race_control")
async def get_race_control(session_id: int, db: AsyncSession = Depends(get_db)):
    """Race control mesajları."""
    from app.api.v1.routes.telemetry import _resolve_session, _require_session_key

    ck = cache_key("race_control", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    messages = await openf1.fetch_race_control(session_key)
    # Tarihe göre azalan sırada (en yeni üstte)
    sorted_msgs = sorted(
        messages,
        key=lambda m: m.get("date") or "",
        reverse=True,
    )
    result = {"session_id": session_id, "messages": sorted_msgs[:40]}
    await cache_set(ck, result, ttl_seconds=8)
    return result


# ─── SSE: AI Canlı Yorum Akışı ───────────────────────────────────────────────

@router.get("/{session_id}/commentary")
async def live_commentary(session_id: int, mode: str = "beginner"):
    """
    Server-Sent Events akışı ile AI canlı yarış yorumu.
    Her 30 saniyede bir anlık yarış durumuna göre yeni yorum üretir.

    Kullanım (frontend):
      const es = new EventSource('/api/v1/live/{session_id}/commentary?mode=beginner')
      es.onmessage = (e) => setCommentary(JSON.parse(e.data).text)
    """
    if mode not in ("beginner", "expert"):
        mode = "beginner"

    active = await get_active_session()
    if active is None or active.get("session_id") != session_id:
        raise HTTPException(404, "Bu oturum aktif değil")

    session_key: int = active["session_key"]

    async def event_generator():
        """30 saniyede bir AI yorum üretir ve SSE formatında gönderir."""
        while True:
            try:
                # En son timing snapshot'ını al
                timing = await get_live_snapshot(session_key, "timing")
                positions = await get_live_snapshot(session_key, "positions")

                if timing:
                    # Claude'a durumu özetle
                    intervals = timing.get("intervals", [])
                    top3 = sorted(intervals, key=lambda x: _gap_val(x.get("gap_to_leader")))[:3]

                    context = {
                        "leader": top3[0].get("driver_number") if top3 else "?",
                        "top3_gaps": [
                            {
                                "driver": iv.get("driver_number"),
                                "gap": iv.get("gap_to_leader"),
                            }
                            for iv in top3
                        ],
                        "total_cars": len(intervals),
                    }

                    try:
                        commentary_text = await claude_ai.interpret_live_race(context, mode)
                    except Exception as e:
                        logger.warning("AI yorum hatası: %s", e)
                        commentary_text = ""

                    if commentary_text:
                        payload = json.dumps({
                            "text": commentary_text,
                            "mode": mode,
                            "ts": datetime.now(timezone.utc).isoformat(),
                        }, ensure_ascii=False)
                        yield f"data: {payload}\n\n"

            except Exception as e:
                logger.warning("Commentary generator hatası: %s", e)

            await asyncio.sleep(30)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
