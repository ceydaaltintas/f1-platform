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
from datetime import datetime, timedelta, timezone

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


def _inactive_driver_numbers(latest_iv: dict[int, dict], drivers: list[dict],
                             threshold: int = RETIRED_THRESHOLD_SECONDS) -> set:
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
            return (d2 - d1).total_seconds() > threshold
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


# Ortalama pit lane kaybı (saniye) — piste göre değişir (pit yolu uzunluğu/hız limiti).
# Bulunamayan pistler için varsayılan PIT_LOSS_DEFAULT kullanılır.
PIT_LOSS_DEFAULT = 22.0
CIRCUIT_PIT_LOSS: dict[str, float] = {
    "Albert Park Grand Prix Circuit": 19.0,
    "Shanghai International Circuit": 24.0,
    "Suzuka Circuit": 27.0,
    "Miami International Autodrome": 19.0,
    "Circuit Gilles Villeneuve": 17.0,
    "Circuit de Monaco": 22.0,
    "Circuit de Barcelona-Catalunya": 21.0,
    "Red Bull Ring": 19.0,
    "Silverstone Circuit": 21.0,
    "Circuit de Spa-Francorchamps": 25.0,
    "Hungaroring": 21.0,
    "Circuit Park Zandvoort": 21.0,
    "Autodromo Nazionale di Monza": 24.0,
    "Madring": 21.0,
    "Baku City Circuit": 18.0,
    "Marina Bay Street Circuit": 28.0,
    "Circuit of the Americas": 21.0,
    "Autódromo Hermanos Rodríguez": 22.0,
    "Autódromo José Carlos Pace": 19.0,
    "Las Vegas Strip Street Circuit": 20.0,
    "Losail International Circuit": 24.0,
    "Yas Marina Circuit": 21.0,
}


# Sıralama segment sırası ve bir önceki segmentten elenme sınırı
# (Q1 → Q2'ye 15 pilot geçer, Q2 → Q3'e 10 pilot geçer)
QUALI_SEGMENT_NAMES: tuple[str, ...] = ("Q1", "Q2", "Q3")
QUALI_SEGMENT_CUTOFF: dict[int, int | None] = {0: None, 1: 16, 2: 10}

SESSION_DURATION_MINUTES: dict[str, int] = {
    "practice1": 60, "practice2": 60, "practice3": 60,
    "sprint_qualifying": 44,
}
QUALI_SEGMENT_DURATION: dict[str, int] = {"Q1": 18, "Q2": 15, "Q3": 12}


def _build_session_clock(session, active_segment: str | None = None,
                         segment_start: datetime | None = None) -> dict | None:
    """Oturum saat bilgisi: geçen süre, toplam süre, kalan süre."""
    start = segment_start or session.session_date
    if start is None:
        return None

    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    elapsed_s = max(0, (now - start).total_seconds())

    if session.type in ("qualifying", "sprint_qualifying") and active_segment:
        total_min = QUALI_SEGMENT_DURATION.get(active_segment)
    else:
        total_min = SESSION_DURATION_MINUTES.get(session.type)

    if total_min is None:
        return {"elapsed_s": int(elapsed_s)}

    total_s = total_min * 60
    remaining_s = max(0, total_s - elapsed_s)

    return {
        "elapsed_s": int(elapsed_s),
        "total_s": total_s,
        "remaining_s": int(remaining_s),
        "total_min": total_min,
    }


async def _mark_session_finished(session_id: int, db: AsyncSession) -> None:
    """Oturum bittiğinde DB status'unu finished olarak günceller."""
    try:
        result = await db.execute(select(Session).where(Session.id == session_id))
        session = result.scalar_one_or_none()
        if session and session.status == "active":
            session.status = "finished"
            await db.commit()
    except Exception as e:
        logger.warning("Session %d finished güncelleme hatası: %s", session_id, e)


# ─── Status ──────────────────────────────────────────────────────────────────

@router.get("/status")
async def live_status(db: AsyncSession = Depends(get_db)):
    """Aktif canlı oturum bilgisini döner."""
    active = await get_active_session()
    if active is None:
        # Celery beat çalışmıyor olabilir — bu durumda canlı oturum otomatik
        # aktivasyonu, sayfaları periyodik çağıran bu endpoint üzerinden yapılır.
        # OpenF1'e aşırı istek atmamak için tespit en fazla ~50sn'de bir denenir.
        lock_ck = cache_key("auto_detect_attempt")
        if not await cache_get(lock_ck):
            await cache_set(lock_ck, True, ttl_seconds=50)
            year = _determine_current_season()
            live = await auto_detect_live_session(year)
            if live and live.get("session_key"):
                result = await db.execute(
                    select(Session).where(Session.session_key == live["session_key"])
                )
                session = result.scalar_one_or_none()
                if session:
                    await set_active_session(session.id, live["session_key"], year)
                    session.status = "active"
                    await db.commit()
                    return {
                        "live": True,
                        "session_id": session.id,
                        "session_key": live["session_key"],
                        "year": year,
                    }
        return {"live": False, "message": "Şu an canlı oturum yok"}

    # Worker her zaman çalışmayabilir — yarış bitmişse aktif oturumu burada da temizle
    # (anasayfadaki "CANLI YARIŞ" linki bitmiş yarışı göstermesin)

    # 1) race_finished flag'i kontrol et (timing cache'inden veya ayrı cache'den)
    race_done = await cache_get(cache_key("race_finished", active["session_id"]))
    if not race_done:
        cached_timing = await cache_get(cache_key("live_timing", active["session_id"]))
        race_done = cached_timing and cached_timing.get("race_finished")
    if race_done:
        await clear_active_session()
        await _mark_session_finished(active["session_id"], db)
        return {"live": False, "message": "Yarış bitti"}

    # 2) Aksi halde OpenF1'in oturum durumunu sorgula
    ck = cache_key("openf1_session_status", active["session_key"])
    status = await cache_get(ck)
    if status is None:
        status = await check_openf1_live_status(active["session_key"])
        await cache_set(ck, status, ttl_seconds=60)

    if status == "finished":
        await clear_active_session()
        await _mark_session_finished(active["session_id"], db)
        return {"live": False, "message": "Oturum bitti"}

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

async def _build_live_quali_timing(session_id: int, session, session_key: int, ck: str) -> dict:
    """Canlı sıralama oturumu: aktif segment (Q1/Q2/Q3) standings + tamamlanan segment sonuçları.

    OpenF1 session_result.duration = [Q1, Q2, Q3] süreleri (elenenlerde None).
    Aktif segment, herhangi bir pilotun en yüksek dolu duration index'ine göre
    belirlenir. Önceki segmentte elenen pilotlar (session_result.position,
    Q1→Q2 sınırı 15, Q2→Q3 sınırı 10) aktif segment standings'inden çıkarılır —
    bu sayede "Q2 başlayınca Q1'de elenenler listede görünmez" davranışı sağlanır.
    """
    try:
        drivers = await openf1.fetch_session_drivers(session_key)
    except Exception as e:
        logger.warning("fetch_session_drivers hatası (quali): %s", e)
        drivers = []
    try:
        results = await openf1.fetch_session_result(session_key)
    except Exception as exc:
        logger.warning("session_result alınamadı session_key=%s: %s", session_key, exc)
        results = []
    try:
        stints = await openf1.fetch_stints(session_key)
    except Exception:
        stints = []

    num_to_info = {
        d["driver_number"]: {
            "code":        d.get("name_acronym", "???"),
            "full_name":   d.get("full_name", ""),
            "team_name":   d.get("team_name", ""),
            "team_colour": f"#{d.get('team_colour','888888')}",
        }
        for d in drivers
    }
    await cache_set(cache_key("session_drivers_info", session_key), num_to_info, ttl_seconds=3600)

    latest_stint: dict[int, dict] = {}
    for s in stints:
        dn = s.get("driver_number")
        if dn is not None:
            if dn not in latest_stint or (s.get("stint_number") or 0) > (latest_stint[dn].get("stint_number") or 0):
                latest_stint[dn] = s

    duration_by_dn = {r.get("driver_number"): r.get("duration") for r in results}
    position_by_dn = {r.get("driver_number"): r.get("position") for r in results}

    # Aktif segment tespiti — önce session_result'tan
    active_idx = 0
    for durations in duration_by_dn.values():
        if not durations:
            continue
        for idx in (2, 1, 0):
            if len(durations) > idx and durations[idx] is not None:
                active_idx = max(active_idx, idx)
                break

    # session_result boşsa → race_control mesajlarından segment tespiti
    rc_messages: list[dict] = []
    segment_start_time: datetime | None = None
    if active_idx == 0 and not duration_by_dn:
        try:
            rc_messages = await openf1.fetch_race_control(session_key)
            start_times: list[datetime] = []
            for m in rc_messages:
                if (m.get("message") or "").strip() == "SESSION STARTED":
                    ts = m.get("date", "")
                    if ts:
                        try:
                            start_times.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
                        except ValueError:
                            pass
            if len(start_times) >= 3:
                active_idx = 2
                segment_start_time = start_times[2]
            elif len(start_times) >= 2:
                active_idx = 1
                segment_start_time = start_times[1]
            elif start_times:
                segment_start_time = start_times[0]
        except Exception:
            pass

    active_segment = QUALI_SEGMENT_NAMES[active_idx]
    cutoff = QUALI_SEGMENT_CUTOFF[active_idx]

    # Q1 elenenleri: önceki segment'teki en kötü 5 pilotu bulmak için
    # tüm turları çekip segmente göre filtreleyeceğiz
    q1_eliminated_dns: set[int] = set()

    # session_result boşsa veya lap_time yoksa → her pilotun turlarını çek
    has_segment_data = any(
        d and len(d) > active_idx and d[active_idx] is not None
        for d in duration_by_dn.values()
    )

    best_lap_by_dn: dict[int, float | None] = {}
    last_lap_by_dn: dict[int, float | None] = {}
    lap_count_by_dn: dict[int, int] = {}

    if not has_segment_data and drivers:
        try:
            all_laps = await openf1.fetch_all_session_laps(session_key)
        except Exception:
            all_laps = []

        # Tüm segment sınırlarını bul ve her segment için eleme yap
        if segment_start_time and active_idx > 0:
            # RC mesajlarından tüm segment başlangıç zamanlarını al
            all_start_times: list[datetime] = []
            for m in rc_messages:
                if (m.get("message") or "").strip() == "SESSION STARTED":
                    ts = m.get("date", "")
                    if ts:
                        try:
                            all_start_times.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
                        except ValueError:
                            pass

            def _best_laps_between(start_t: datetime | None, end_t: datetime | None) -> dict[int, float]:
                """İki zaman arasındaki en iyi turları hesapla."""
                best: dict[int, float] = {}
                for l in all_laps:
                    dn = l.get("driver_number")
                    dur = l.get("lap_duration")
                    if dn is None or not dur or l.get("is_pit_out_lap"):
                        continue
                    ts_str = l.get("date_start") or l.get("date") or ""
                    if not ts_str:
                        continue
                    try:
                        lap_ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    except ValueError:
                        continue
                    if start_t and lap_ts < start_t:
                        continue
                    if end_t and lap_ts >= end_t:
                        continue
                    if dn not in best or dur < best[dn]:
                        best[dn] = dur
                return best

            # Q1 elenmişler (ilk segment)
            q1_end = all_start_times[1] if len(all_start_times) > 1 else segment_start_time
            q1_best = _best_laps_between(all_start_times[0] if all_start_times else None, q1_end)
            if q1_best:
                sorted_q1 = sorted(q1_best.items(), key=lambda x: x[1])
                q1_eliminated_dns = {dn for dn, _ in sorted_q1[16:]}

            # Q2 elenmişler (Q3'teyse)
            if active_idx >= 2 and len(all_start_times) >= 3:
                q2_best = _best_laps_between(all_start_times[1], all_start_times[2])
                if q2_best:
                    # Q1 elenenleri çıkar
                    q2_active = {dn: t for dn, t in q2_best.items() if dn not in q1_eliminated_dns}
                    sorted_q2 = sorted(q2_active.items(), key=lambda x: x[1])
                    q2_eliminated_dns = {dn for dn, _ in sorted_q2[10:]}
                    q1_eliminated_dns = q1_eliminated_dns | q2_eliminated_dns

            # Aktif segment turlarını filtrele
            segment_laps = []
            for l in all_laps:
                ts_str = l.get("date_start") or l.get("date") or ""
                if ts_str:
                    try:
                        lap_ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        if lap_ts >= segment_start_time:
                            segment_laps.append(l)
                    except ValueError:
                        segment_laps.append(l)
                else:
                    segment_laps.append(l)
        else:
            segment_laps = all_laps

        # Pilota göre grupla
        laps_by_dn: dict[int, list] = {}
        for l in segment_laps:
            dn = l.get("driver_number")
            if dn is not None:
                laps_by_dn.setdefault(dn, []).append(l)
        for dn, laps_data in laps_by_dn.items():
            clean = [l for l in laps_data if l.get("lap_duration") and not l.get("is_pit_out_lap")]
            all_with_time = [l for l in laps_data if l.get("lap_duration")]
            lap_count_by_dn[dn] = len(all_with_time)
            if clean:
                best_lap_by_dn[dn] = min(l["lap_duration"] for l in clean)
                last_lap_by_dn[dn] = clean[-1].get("lap_duration")
            elif all_with_time:
                best_lap_by_dn[dn] = min(l["lap_duration"] for l in all_with_time)
                last_lap_by_dn[dn] = all_with_time[-1].get("lap_duration")

    # ── Aktif segment standings ──────────────────────────────────────────────
    entries: list[dict] = []

    def _fmt_lap(t: float | None) -> str | None:
        if t is None:
            return None
        mins = int(t // 60)
        secs = t - mins * 60
        return f"{mins}:{secs:06.3f}" if mins else f"{secs:.3f}"

    if has_segment_data:
        # session_result verisi var → segment bazlı sıralama
        for d in drivers:
            dn = d.get("driver_number")
            position = position_by_dn.get(dn)
            if cutoff is not None and position is not None and position > cutoff:
                continue

            info = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            durations = duration_by_dn.get(dn)
            lap_time = durations[active_idx] if durations and len(durations) > active_idx else None
            prev_time = durations[active_idx - 1] if (active_idx > 0 and durations and len(durations) > active_idx - 1) else None
            stint = latest_stint.get(dn, {})

            entries.append({
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "lap_time":      lap_time,
                "best_lap_time": _fmt_lap(lap_time),
                "compound":      stint.get("compound"),
                "lap_count":     lap_count_by_dn.get(dn, 0),
                "_prev_time":    prev_time,
            })

        def _sort_key(e: dict):
            if e["lap_time"] is not None:
                return (0, e["lap_time"])
            if e["_prev_time"] is not None:
                return (1, e["_prev_time"])
            return (2, e["driver_number"])

        entries.sort(key=_sort_key)
        lead_time = next((e["lap_time"] for e in entries if e["lap_time"] is not None), None)
        for i, e in enumerate(entries):
            e["position"] = i + 1
            gap_val = round(e["lap_time"] - lead_time, 3) if (i > 0 and e["lap_time"] is not None and lead_time is not None) else 0.0
            e["gap"] = gap_val
            e["gap_to_leader"] = f"+{gap_val:.3f}" if gap_val > 0 else ("LDR" if e["lap_time"] is not None else None)
            del e["_prev_time"]
    else:
        # session_result yoksa → tur verisinden en iyi tura göre sıralama
        # Elenen pilotları filtrele
        eliminated = q1_eliminated_dns if active_idx >= 1 else set()
        best_leader = min(best_lap_by_dn.values()) if best_lap_by_dn else None
        sorted_dns = sorted(
            [dn for dn in best_lap_by_dn if best_lap_by_dn[dn] is not None and dn not in eliminated],
            key=lambda dn: best_lap_by_dn[dn]
        )
        for dn in sorted_dns:
            info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint = latest_stint.get(dn, {})
            best  = best_lap_by_dn[dn]
            gap   = round(best - best_leader, 3) if best_leader and best else None
            entries.append({
                "position":      len(entries) + 1,
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "lap_time":      best,
                "best_lap_time": _fmt_lap(best),
                "gap":           gap or 0.0,
                "gap_to_leader": f"+{gap:.3f}" if gap and gap > 0 else "LDR",
                "last_lap_time": _fmt_lap(last_lap_by_dn.get(dn)),
                "compound":      stint.get("compound"),
                "lap_count":     lap_count_by_dn.get(dn, 0),
            })

        # Henüz tur atmamış pilotlar (elenenleri hariç tut)
        seen = {dn for dn in sorted_dns}
        for d in drivers:
            dn = d.get("driver_number")
            if dn is None or dn in seen or dn in eliminated:
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
                "lap_time":      None,
                "best_lap_time": None,
                "gap":           0.0,
                "gap_to_leader": None,
                "last_lap_time": None,
                "compound":      stint.get("compound"),
                "lap_count":     0,
            })

    # ── Tamamlanan segment sonuçları (örn. Q2 aktifken Q1 sonuçları) ─────────
    segments: dict[str, list] = {}
    for idx in range(active_idx):
        seg_entries = []
        for d in drivers:
            dn = d.get("driver_number")
            durations = duration_by_dn.get(dn)
            if not durations or len(durations) <= idx or durations[idx] is None:
                continue
            info = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            seg_entries.append({
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "lap_time":      durations[idx],
            })
        if seg_entries:
            seg_entries.sort(key=lambda x: x["lap_time"])
            lead = seg_entries[0]["lap_time"]
            for i, e in enumerate(seg_entries):
                e["position"] = i + 1
                e["gap"] = round(e["lap_time"] - lead, 4) if i > 0 else 0.0
            segments[QUALI_SEGMENT_NAMES[idx]] = seg_entries

    session_clock = _build_session_clock(session, active_segment, segment_start_time)

    result = {
        "session_id":     session_id,
        "session_type":   session.type,
        "is_quali":       True,
        "active_segment": active_segment,
        "entries":        entries,
        "segments":       segments,
        "session_clock":  session_clock,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await cache_set(ck, result, ttl_seconds=6)
    return result


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

    if session.type in ("qualifying", "sprint_qualifying"):
        return await _build_live_quali_timing(session_id, session, session_key, ck)

    try:
        drivers = await openf1.fetch_session_drivers(session_key)
    except Exception as e:
        logger.warning("fetch_session_drivers hatası: %s", e)
        drivers = []
    try:
        intervals = await openf1.fetch_intervals(session_key)
    except Exception as e:
        logger.warning("fetch_intervals hatası: %s", e)
        intervals = []
    try:
        stints = await openf1.fetch_stints(session_key)
    except Exception as e:
        logger.warning("fetch_stints hatası: %s", e)
        stints = []
    try:
        pit_data = await openf1.fetch_pit_data(session_key)
    except Exception as e:
        logger.warning("fetch_pit_data hatası: %s", e)
        pit_data = []
    try:
        positions = await openf1.fetch_positions(session_key)
    except Exception as e:
        logger.warning("fetch_positions hatası: %s", e)
        positions = []

    # Her pilotun tur verilerini çek
    current_lap = None
    total_laps  = None
    last_lap_by_dn: dict[int, float | None] = {}
    best_lap_by_dn: dict[int, float | None] = {}
    lap_count_by_dn: dict[int, int] = {}

    is_race = session.type in ("race", "sprint")
    is_practice = session.type in ("practice1", "practice2", "practice3")

    if is_practice:
        # Antrenman: tüm pilotların turlarını tek istekle çek
        try:
            all_laps = await openf1.fetch_all_session_laps(session_key)
        except Exception:
            all_laps = []
        laps_by_dn: dict[int, list] = {}
        for l in all_laps:
            dn = l.get("driver_number")
            if dn is not None:
                laps_by_dn.setdefault(dn, []).append(l)
        for dn, laps_data in laps_by_dn.items():
            clean = [l for l in laps_data if l.get("lap_duration") and not l.get("is_pit_out_lap")]
            all_with_time = [l for l in laps_data if l.get("lap_duration")]
            lap_count_by_dn[dn] = len(all_with_time)
            if clean:
                best = min(clean, key=lambda l: l["lap_duration"])
                best_lap_by_dn[dn] = best["lap_duration"]
                last_lap_by_dn[dn] = clean[-1].get("lap_duration")
            elif all_with_time:
                best_lap_by_dn[dn] = min(l["lap_duration"] for l in all_with_time)
                last_lap_by_dn[dn] = all_with_time[-1].get("lap_duration")
    else:
        # Yarış/sıralama: sadece lider pilotun turlarını çek
        if drivers:
            lead_dn = drivers[0].get("driver_number")
            try:
                lead_laps = await openf1.fetch_laps(session_key, lead_dn)
                if lead_laps:
                    current_lap = max(
                        (l.get("lap_number") or 0) for l in lead_laps
                    ) or None
                    clean = [l for l in lead_laps if l.get("lap_duration") and not l.get("is_pit_out_lap")]
                    if clean:
                        last_lap_by_dn[lead_dn] = clean[-1].get("lap_duration")
            except Exception:
                pass
    if is_race:
        circuit_name = session.round.circuit_name if session.round else None
        total_laps = CIRCUIT_TOTAL_LAPS.get(circuit_name)
        if total_laps is None and stints:
            max_lap_end = max((s.get("lap_end") or 0) for s in stints)
            if max_lap_end > 0:
                total_laps = max_lap_end

    race_finished = bool(
        is_race and current_lap is not None and total_laps is not None and current_lap >= total_laps
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

    # Başlangıç pozisyonu: position akışındaki her pilotun ilk (en eski) kaydı
    start_position: dict[int, int] = {}
    for p in sorted(positions, key=lambda x: x.get("date") or ""):
        dn  = p.get("driver_number")
        pos = p.get("position")
        if dn is not None and pos is not None and dn not in start_position:
            start_position[dn] = pos

    # Şu an pitte olan pilotlar: en güncel pit kaydı henüz "tamamlanmamışsa"
    # (pit_duration yoksa ve kayıt yeni ise) veya pit süresi devam ediyorsa
    now = datetime.now(timezone.utc)
    latest_pit: dict[int, dict] = {}
    for p in pit_data:
        dn = p.get("driver_number")
        if dn is None:
            continue
        if dn not in latest_pit or (p.get("date","") > latest_pit[dn].get("date","")):
            latest_pit[dn] = p

    in_pit_set: set[int] = set()
    for dn, p in latest_pit.items():
        date_str = p.get("date")
        if not date_str:
            continue
        try:
            pit_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except ValueError:
            continue
        duration = p.get("pit_duration")
        if duration is not None:
            pit_end = pit_dt + timedelta(seconds=float(duration))
            if pit_dt - timedelta(seconds=2) <= now <= pit_end + timedelta(seconds=8):
                in_pit_set.add(dn)
        elif (now - pit_dt).total_seconds() < 90:
            in_pit_set.add(dn)

    # Stints'den ek pit tespiti: is_pit_out_lap olan tur henüz gelmemişse pitte
    for s in stints:
        dn = s.get("driver_number")
        if dn is None or dn in in_pit_set:
            continue
        # Stint henüz tamamlanmamışsa (lap_end yok veya tyre_age_at_end yok) pitte olabilir
        if s.get("lap_end") is None and s.get("stint_number", 0) > 1:
            in_pit_set.add(dn)

    def _pos_change(dn: int | None, current_pos: int | None) -> tuple[int | None, int | None]:
        sp = start_position.get(dn) if dn is not None else None
        if sp is None or current_pos is None:
            return None, sp
        return sp - current_pos, sp

    entries: list[dict] = []

    # Formasyon turu: tur ≤ 1 ve interval verisi anlamsızsa grid sırasını göster
    is_formation = is_race and (current_lap is None or current_lap <= 1)
    if is_formation and start_position:
        sorted_by_grid = sorted(start_position.items(), key=lambda x: x[1])
        for dn, grid_pos in sorted_by_grid:
            info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint = latest_stint.get(dn, {})
            entries.append({
                "position":      grid_pos,
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "gap_to_leader": "GRİD" if grid_pos == 1 else f"P{grid_pos}",
                "gap_seconds":   0,
                "interval":      None,
                "lapped":        False,
                "compound":      stint.get("compound"),
                "tyre_age":      stint.get("tyre_age_at_end") or stint.get("lap_end"),
                "pit_count":     0,
                "last_lap_time": None,
                "in_pit":          False,
                "position_change": None,
                "start_position":  grid_pos,
            })

    elif is_practice:
        # ── Antrenman sıralaması: en iyi tur süresine göre ──────────────────
        best_leader = min(best_lap_by_dn.values()) if best_lap_by_dn else None

        # En iyi tur süresi olan pilotlar → sıralı
        sorted_dns = sorted(
            [dn for dn in best_lap_by_dn if best_lap_by_dn[dn] is not None],
            key=lambda dn: best_lap_by_dn[dn]
        )
        for dn in sorted_dns:
            info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint = latest_stint.get(dn, {})
            best  = best_lap_by_dn[dn]
            gap   = round(best - best_leader, 3) if best_leader and best else None
            position = len(entries) + 1

            def _fmt_lap(t: float | None) -> str | None:
                if t is None:
                    return None
                mins = int(t // 60)
                secs = t - mins * 60
                return f"{mins}:{secs:06.3f}" if mins else f"{secs:.3f}"

            entries.append({
                "position":      position,
                "driver_number": dn,
                "code":          info["code"],
                "full_name":     info["full_name"],
                "team_name":     info["team_name"],
                "team_colour":   info["team_colour"],
                "gap_to_leader": f"+{gap:.3f}" if gap and gap > 0 else "LDR",
                "gap_seconds":   gap or 0,
                "interval":      None,
                "lapped":        False,
                "compound":      stint.get("compound"),
                "tyre_age":      stint.get("tyre_age_at_end") or stint.get("lap_end"),
                "pit_count":     max(0, (stint_count.get(dn, 1) - 1)),
                "last_lap_time": _fmt_lap(last_lap_by_dn.get(dn)),
                "best_lap_time": _fmt_lap(best),
                "lap_count":     lap_count_by_dn.get(dn, 0),
                "in_pit":          dn in in_pit_set,
                "position_change": None,
                "start_position":  None,
            })

        # Henüz tur atmamış pilotlar
        seen_dns = {dn for dn in sorted_dns}
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
                "gap_to_leader": None,
                "gap_seconds":   99999.0,
                "interval":      None,
                "lapped":        False,
                "compound":      stint.get("compound"),
                "tyre_age":      None,
                "pit_count":     0,
                "last_lap_time": None,
                "best_lap_time": None,
                "lap_count":     0,
                "in_pit":          dn in in_pit_set,
                "position_change": None,
                "start_position":  None,
            })

    elif race_finished:
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

            position = len(entries) + 1
            change, sp = (None, None) if status else _pos_change(dn, position)
            entry = {
                "position":      position,
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
                "in_pit":          False,
                "position_change": change,
                "start_position":  sp,
            }
            if status:
                entry["status"] = status
            entries.append(entry)

        inactive_dns = {r.get("driver_number") for r in session_result if r.get("dnf") or r.get("dns") or r.get("dsq")}
        await cache_set(cache_key("inactive_drivers", session_key), list(inactive_dns), ttl_seconds=30)

    if not entries:
        # race_finished dalı boş döndüyse veya normal yarış sıralaması
        # ── Her sürücünün EN SON interval kaydını al ──────────────────────────────
        # intervals binlerce satır içerebilir; sürücü başına sadece max(date) olan alınır
        latest_iv: dict[int, dict] = {}
        for iv in intervals:
            dn = iv.get("driver_number")
            if dn is None:
                continue
            if dn not in latest_iv or (iv.get("date","") > latest_iv[dn].get("date","")):
                latest_iv[dn] = iv

        # DNF/DNS pilotlar — yarış bittiyse eşiği yükselt (finiş sırası 1-2 dk sürer,
        # gerçek DNF'ler çok daha eski interval verisine sahip)
        threshold = 600 if race_finished else RETIRED_THRESHOLD_SECONDS
        inactive_dns = _inactive_driver_numbers(latest_iv, drivers, threshold)
        await cache_set(cache_key("inactive_drivers", session_key), list(inactive_dns), ttl_seconds=30)

        active_ivs  = [iv for iv in latest_iv.values() if iv.get("driver_number") not in inactive_dns]
        retired_ivs = [iv for iv in latest_iv.values() if iv.get("driver_number") in inactive_dns]

        # Positions verisinden son pozisyon (lapped pilotları doğru sıralamak için)
        latest_pos_by_dn: dict[int, int] = {}
        for p in sorted(positions, key=lambda x: x.get("date") or ""):
            dn = p.get("driver_number")
            pos = p.get("position")
            if dn is not None and pos is not None:
                latest_pos_by_dn[dn] = pos

        def _sort_key(iv: dict) -> tuple:
            gap = _gap_val(iv.get("gap_to_leader"))
            dn = iv.get("driver_number")
            # Lapped pilotlar (gap >= 9000) için positions verisinden sırala
            if gap >= 9000:
                return (gap, latest_pos_by_dn.get(dn, 999))
            return (gap, 0)

        sorted_intervals = sorted(active_ivs, key=_sort_key)

        seen_dns: set = set()

        # Interval verisi henüz yoksa (oturum yeni başladı) → positions verisinden sırala
        if not sorted_intervals and positions:
            latest_pos: dict[int, dict] = {}
            for p in positions:
                dn = p.get("driver_number")
                if dn is not None:
                    if dn not in latest_pos or (p.get("date","") > latest_pos[dn].get("date","")):
                        latest_pos[dn] = p
            sorted_by_pos = sorted(latest_pos.values(), key=lambda x: x.get("position", 999))
            for p in sorted_by_pos:
                dn = p.get("driver_number")
                if dn is None:
                    continue
                seen_dns.add(dn)
                info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
                stint = latest_stint.get(dn, {})
                entries.append({
                    "position":      p.get("position", len(entries) + 1),
                    "driver_number": dn,
                    "code":          info["code"],
                    "full_name":     info["full_name"],
                    "team_name":     info["team_name"],
                    "team_colour":   info["team_colour"],
                    "gap_to_leader": None,
                    "gap_seconds":   0,
                    "interval":      None,
                    "lapped":        False,
                    "compound":      stint.get("compound"),
                    "tyre_age":      None,
                    "pit_count":     0,
                    "last_lap_time": None,
                    "in_pit":          dn in in_pit_set,
                    "position_change": None,
                    "start_position":  None,
                })

        for iv in sorted_intervals:
            dn = iv.get("driver_number")
            if dn is None:
                continue
            seen_dns.add(dn)
            info    = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint   = latest_stint.get(dn, {})
            raw_gap = iv.get("gap_to_leader")
            position = len(entries) + 1
            change, sp = _pos_change(dn, position)
            entries.append({
                "position":      position,
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
                "in_pit":          dn in in_pit_set,
                "position_change": change,
                "start_position":  sp,
            })

        # Aralık verisi eskimiş pilotlar (yarış sırasında DNF/emekli) — sona ekle
        for iv in retired_ivs:
            dn = iv.get("driver_number")
            if dn is None:
                continue
            seen_dns.add(dn)
            info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint = latest_stint.get(dn, {})
            position = len(entries) + 1
            change, sp = None, None
            entries.append({
                "position":      position,
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
                "in_pit":          False,
                "position_change": change,
                "start_position":  sp,
            })

        # Interval verisi olmayan pilotlar (DNF/DNS baştan) — sona ekle
        for d in drivers:
            dn = d.get("driver_number")
            if dn is None or dn in seen_dns:
                continue
            info  = num_to_info.get(dn, {"code": str(dn), "full_name": "", "team_name": "", "team_colour": "#888888"})
            stint = latest_stint.get(dn, {})
            position = len(entries) + 1
            change, sp = None, None
            entries.append({
                "position":      position,
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
                "in_pit":          False,
                "position_change": change,
                "start_position":  sp,
            })

    # Oturum saat bilgisi (antrenman/sıralama için kalan süre)
    session_clock = _build_session_clock(session)

    result = {
        "session_id":  session_id,
        "session_type": session.type,
        "entries":     entries,
        "current_lap": current_lap,
        "total_laps":  total_laps,
        "race_finished": race_finished,
        "session_clock": session_clock,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await cache_set(ck, result, ttl_seconds=6)
    if race_finished:
        await cache_set(cache_key("race_finished", session_id), True, ttl_seconds=3600)
    return result


@router.get("/{session_id}/positions_map")
async def get_live_positions_map(session_id: int):
    """Canlı araç GPS konumlarını pist haritasıyla aynı koordinat sisteminde döner.

    /timing ile aynı yaklaşım: Celery worker'a bağlı kalmadan OpenF1'den
    doğrudan ve kısa süreli (3sn) cache ile çekilir.
    """
    active = await get_active_session()
    if active is None or active.get("session_id") != session_id:
        return {"session_id": session_id, "positions": []}

    session_key = active["session_key"]
    bounds = await cache_get(cache_key("track_bounds", session_id))
    if not bounds:
        # track_map endpoint henüz çağrılmamış (sayfa yüklenince frontend çağırır) —
        # rate limit'e takılmamak için burada yeniden hesaplamıyoruz
        return {"session_id": session_id, "positions": []}

    ck = cache_key("live_positions_map", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    from datetime import timedelta
    since = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    try:
        location_raw = await openf1.fetch_live_locations(session_key, since)
    except Exception as e:
        logger.warning("Pozisyon verisi çekilemedi: %s", e)
        location_raw = []

    # Her pilotun en son konumu
    latest: dict[int, dict] = {}
    for p in location_raw:
        dn = p.get("driver_number")
        if dn is None:
            continue
        prev = latest.get(dn)
        if prev is None or (p.get("date") or "") > (prev.get("date") or ""):
            latest[dn] = p

    # Pilot kodu/rengi — get_live_timing tarafından cache'lenir (ekstra OpenF1 isteği önler)
    num_to_info = await cache_get(cache_key("session_drivers_info", session_key)) or {}
    # DNF/DNS pilotlar — son bilinen konumda donmuş kalmasınlar
    inactive_dns = set(await cache_get(cache_key("inactive_drivers", session_key)) or [])

    positions = []
    for p in latest.values():
        dn = p.get("driver_number")
        x, y = p.get("x"), p.get("y")
        if x is None or y is None:
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

    result = {"session_id": session_id, "positions": positions}
    await cache_set(ck, result, ttl_seconds=3)
    return result


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

    circuit_name = session.round.circuit_name if session.round else None
    PIT_LOSS = CIRCUIT_PIT_LOSS.get(circuit_name, PIT_LOSS_DEFAULT)  # saniye — piste göre ortalama pit kaybı

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

    # Mevcut tur (lider üzerinden) + kalan tur sayısı — yakalama tahminleri
    # bu kalan tur sayısıyla sınırlandırılır (örn. 28 tur kaldıysa 94 tur
    # gerektiren bir yakalama "yakalanamaz" sayılır).
    total_laps = CIRCUIT_TOTAL_LAPS.get(circuit_name)
    if total_laps is None and stints:
        max_lap_end = max((s.get("lap_end") or 0) for s in stints)
        if max_lap_end > 0:
            total_laps = max_lap_end

    lead_dn = next((dn for dn, pos in pos_map.items() if pos == 1), None)
    current_lap = None
    if lead_dn is not None:
        lead_laps = laps_by_dn.get(lead_dn, [])
        if lead_laps:
            current_lap = max((l.get("lap_number") or 0) for l in lead_laps) or None

    remaining_laps = (total_laps - current_lap) if (total_laps is not None and current_lap is not None) else None

    # Her sürücünün son 5 clean turundaki ort tur süresi
    def _avg_pace(dn: int) -> float | None:
        laps = laps_by_dn.get(dn, [])
        clean = [
            l["lap_duration"] for l in laps
            if l.get("lap_duration") and not l.get("is_pit_out_lap")
        ]
        if len(clean) < 2: return None
        fastest = min(clean)
        valid = [t for t in clean if t <= fastest * 1.06]
        recent = sorted(valid)[-5:]
        return sum(recent) / len(recent) if recent else None

    # Hedef sürücünün pace'i
    target_pace = _avg_pace(target_num)

    # Laplı pilot için basit mesaj dön
    if is_lapped:
        laps_down = int((target_gap - 9000))
        return {
            "driver_code":       driver_code.upper(),
            "current_position":  target_pos,
            "current_gap":       target_gap,
            "current_lap":       current_lap,
            "total_laps":        total_laps,
            "remaining_laps":    remaining_laps,
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
        if not target_pace or not their_pace:
            in_battle = gap_to_catch <= 2.0
            catch_results.append({
                "ahead_code":  code,
                "ahead_pos":   pos,
                "gap_seconds": round(gap_to_catch, 2),
                "catchable":   in_battle,
                "in_battle":   in_battle,
                "reason": "Mücadele mesafesinde" if in_battle else "Henüz yeterli tur verisi yok",
            })
            continue
        if target_pace and their_pace:
            pace_diff = their_pace - target_pace  # pozitif = hedef daha hızlı
            if pace_diff > 0.05:
                laps_to_catch = gap_to_catch / pace_diff
                # Yarışta kalan tur sayısından fazla tur gerektiren bir yakalama
                # gerçekçi değildir — "yakalanamaz" sayılır
                catchable = remaining_laps is None or laps_to_catch <= remaining_laps
                entry = {
                    "ahead_code":      code,
                    "ahead_pos":       pos,
                    "gap_seconds":     round(gap_to_catch, 2),
                    "pace_gain_per_lap": round(pace_diff, 3),
                    "laps_to_catch":   round(laps_to_catch, 1),
                    "target_pace":     round(target_pace, 3),
                    "ahead_pace":      round(their_pace, 3),
                    "catchable":       catchable,
                }
                if not catchable:
                    entry["reason"] = (
                        f"Yarış sonuna kadar yetişmiyor — ~{laps_to_catch:.0f} tur gerekir, "
                        f"{remaining_laps} tur kaldı"
                    )
                catch_results.append(entry)
            else:
                # 2s'den az fark varsa "mücadele mesafesinde"
                in_battle = gap_to_catch <= 2.0
                catch_results.append({
                    "ahead_code":  code,
                    "ahead_pos":   pos,
                    "gap_seconds": round(gap_to_catch, 2),
                    "catchable":   in_battle,
                    "in_battle":   in_battle,
                    "pace_gain_per_lap": round(pace_diff, 3) if pace_diff > 0 else 0,
                    "reason": "Mücadele mesafesinde — DRS etkili" if in_battle
                              else ("Benzer veya daha yavaş pace" if pace_diff <= 0
                              else f"Sadece {pace_diff:.3f}s/tur kazanıyor"),
                })

    # Sıralı tutarlılık: daha uzaktaki aracı, aradakinden önce yakalayamazsın
    # catch_results en yakından en uzağa sıralı (pos büyükten küçüğe)
    catch_results.sort(key=lambda x: x.get("gap_seconds", 0))
    max_laps = 0.0
    for c in catch_results:
        lt = c.get("laps_to_catch")
        if lt is not None:
            if lt < max_laps:
                c["laps_to_catch"] = round(max_laps + 1, 1)
                if c.get("pace_gain_per_lap") and c["laps_to_catch"] > 0:
                    c["pace_gain_per_lap"] = round(c["gap_seconds"] / c["laps_to_catch"], 3)
            max_laps = c["laps_to_catch"]
            if remaining_laps is not None and c["laps_to_catch"] > remaining_laps:
                c["catchable"] = False
                c["reason"] = (
                    f"Yarış sonuna kadar yetişmiyor — ~{c['laps_to_catch']:.0f} tur gerekir, "
                    f"{remaining_laps} tur kaldı"
                )

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
        key=lambda x: x[1]
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
        if remaining_laps is not None and remaining_laps <= 2:
            optimal_pit_info["message"] += f" (Not: yarışta sadece {remaining_laps} tur kaldı, pit stratejisinin faydası sınırlı.)"

    result = {
        "driver_code":       driver_code.upper(),
        "current_position":  target_pos,
        "current_gap":       round(target_gap, 2),
        "avg_pace":          round(target_pace, 3) if target_pace else None,
        "current_lap":       current_lap,
        "total_laps":        total_laps,
        "remaining_laps":    remaining_laps,
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


@router.get("/{session_id}/radio")
async def get_team_radio(session_id: int, db: AsyncSession = Depends(get_db)):
    """Pilot/takım radyo kayıtları — en yeni üstte."""
    from app.api.v1.routes.telemetry import _resolve_session, _require_session_key

    ck = cache_key("team_radio", session_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    session     = await _resolve_session(session_id, db)
    session_key = await _require_session_key(session, db)

    recordings = await openf1.fetch_team_radio(session_key)
    # Pilot kodu/rengi — get_live_timing tarafından cache'lenir (ekstra OpenF1 isteği önler)
    num_to_info = await cache_get(cache_key("session_drivers_info", session_key)) or {}

    clips = []
    for r in recordings:
        dn  = r.get("driver_number")
        info = num_to_info.get(str(dn)) or num_to_info.get(dn) or {}
        clips.append({
            "date":          r.get("date"),
            "driver_number": dn,
            "code":          info.get("code", str(dn)),
            "full_name":     info.get("full_name", ""),
            "team_colour":   info.get("team_colour", "#888888"),
            "recording_url": r.get("recording_url"),
        })

    clips.sort(key=lambda c: c.get("date") or "", reverse=True)
    result = {"session_id": session_id, "clips": clips[:30]}
    await cache_set(ck, result, ttl_seconds=15)
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
        """30 saniyede bir AI yorum üretir ve SSE formatında gönderir.

        Celery worker'a bağlı kalmadan çalışır: önce /timing endpoint'inin
        kısa süreli cache'i (canlı sayfada zaten 8sn'de bir çekiliyor)
        kullanılır, yoksa intervals doğrudan OpenF1'den çekilir.
        """
        while True:
            try:
                context = None

                timing_result = await cache_get(cache_key("live_timing", session_id))
                session_type = timing_result.get("session_type", "race") if timing_result else "race"
                if timing_result and timing_result.get("entries"):
                    top3 = timing_result["entries"][:3]
                    context = {
                        "session_type": session_type,
                        "leader": top3[0].get("code", top3[0].get("driver_number")) if top3 else "?",
                        "top3_gaps": [
                            {"driver": e.get("code", e.get("driver_number")), "gap": e.get("gap_to_leader"),
                             "best_lap": e.get("best_lap_time"), "compound": e.get("compound")}
                            for e in top3
                        ],
                        "total_cars": len(timing_result["entries"]),
                    }
                else:
                    try:
                        intervals = await openf1.fetch_intervals(session_key)
                        latest_iv: dict[int, dict] = {}
                        for iv in intervals:
                            dn = iv.get("driver_number")
                            if dn is None:
                                continue
                            if dn not in latest_iv or (iv.get("date", "") > latest_iv[dn].get("date", "")):
                                latest_iv[dn] = iv

                        top3 = sorted(latest_iv.values(), key=lambda x: _gap_val(x.get("gap_to_leader")))[:3]
                        if top3:
                            context = {
                                "leader": top3[0].get("driver_number"),
                                "top3_gaps": [
                                    {"driver": iv.get("driver_number"), "gap": iv.get("gap_to_leader")}
                                    for iv in top3
                                ],
                                "total_cars": len(latest_iv),
                            }
                    except Exception as e:
                        logger.warning("Commentary veri çekme hatası: %s", e)

                if context:
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
