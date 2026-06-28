from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.redis_client import cache_get, cache_key, cache_set
from app.services import claude_ai
from app.services import standings as standings_svc
from app.services import strategy as strategy_svc

router = APIRouter(tags=["şampiyona & strateji"])


# ─── H2H Pist Karşılaştırması ───────────────────────────────────────────────

@router.get("/h2h/circuits")
async def h2h_circuits(
    driver1: str = Query(..., description="Pilot 1 kodu (örn. VER)"),
    driver2: str = Query(..., description="Pilot 2 kodu (örn. NOR)"),
    year_from: int = Query(2020),
):
    """İki pilotyunun pist bazında head-to-head karşılaştırması."""
    try:
        return await standings_svc.get_h2h_circuit(driver1, driver2, year_from)
    except Exception as e:
        raise HTTPException(502, f"H2H verisi alınamadı: {e}")


# ─── Şampiyona Sıralaması ────────────────────────────────────────────────────

@router.get("/seasons/{year}/standings/drivers")
async def driver_standings(
    year: int,
    round: int | None = Query(None, description="Belirli bir round sonrası sıralama"),
):
    """Pilot şampiyona sıralaması."""
    try:
        return await standings_svc.get_driver_standings(year, round)
    except Exception as e:
        raise HTTPException(502, f"Jolpica verisi alınamadı: {e}")


@router.get("/seasons/{year}/standings/constructors")
async def constructor_standings(year: int):
    """Takım şampiyona sıralaması."""
    try:
        return await standings_svc.get_constructor_standings(year)
    except Exception as e:
        raise HTTPException(502, f"Jolpica verisi alınamadı: {e}")


@router.get("/seasons/{year}/standings/pitstops")
async def pitstop_standings(year: int, db: AsyncSession = Depends(get_db)):
    """Takım bazında pit stop şampiyonası: en hızlı + ortalama (OpenF1'den)."""
    ck = cache_key("pitstop_standings", year)
    cached = await cache_get(ck)
    if cached and cached.get("teams"):
        return cached

    from sqlalchemy import select
    from app.models.f1 import Session as SessionModel, Round, Season
    from app.services import openf1
    from collections import defaultdict
    import asyncio

    season_result = await db.execute(select(Season).where(Season.year == year))
    season = season_result.scalar_one_or_none()
    if season is None:
        raise HTTPException(404, f"{year} sezonu bulunamadı")

    # Tamamlanmış yarış session'larını bul
    rows = await db.execute(
        select(SessionModel.session_key, Round.name)
        .join(Round, SessionModel.round_id == Round.id)
        .where(
            Round.season_id == season.id,
            SessionModel.type == "race",
            SessionModel.status == "finished",
            SessionModel.session_key.isnot(None),
        )
    )
    race_sessions = rows.all()

    if not race_sessions:
        result = {"teams": [], "fastest_stops": []}
        await cache_set(ck, result, ttl_seconds=300)
        return result

    # Tüm yarışların pit + driver verisini paralel çek
    async def _fetch(sk: int, race_name: str):
        try:
            pits, drivers = await asyncio.gather(
                openf1.fetch_pit_data(sk),
                openf1.fetch_session_drivers(sk),
            )
            return pits, drivers, race_name
        except Exception:
            return [], [], race_name

    results = await asyncio.gather(*[_fetch(sk, rn) for sk, rn in race_sessions])

    # Driver → takım eşleşmesi
    driver_team: dict[int, str] = {}
    for _, drivers, _ in results:
        for d in drivers:
            dn = d.get("driver_number")
            team = d.get("team_name")
            if dn and team:
                driver_team[dn] = team

    driver_code: dict[int, str] = {}
    for _, drivers, _ in results:
        for d in drivers:
            dn = d.get("driver_number")
            code = d.get("name_acronym")
            if dn and code:
                driver_code[dn] = code

    # Tüm pit verilerini topla
    team_stops: dict[str, list[float]] = defaultdict(list)
    all_fastest: list[dict] = []

    for pits, _, race_name in results:
        for p in pits:
            dur = p.get("pit_duration")
            dn = p.get("driver_number")
            lap = p.get("lap_number")
            if dur is None or dur <= 0 or dur > 60 or dn is None:
                continue
            team = driver_team.get(dn)
            if team:
                team_stops[team].append(dur)
            all_fastest.append({
                "duration": round(dur, 3),
                "driver": driver_code.get(dn, str(dn)),
                "race": race_name,
                "lap": lap,
            })

    # Takım sıralaması
    team_standings = []
    for team, durations in team_stops.items():
        team_standings.append({
            "team_name": team,
            "fastest": round(min(durations), 3),
            "average": round(sum(durations) / len(durations), 3),
            "total_stops": len(durations),
        })

    by_fastest = sorted(team_standings, key=lambda x: x["fastest"])
    for i, t in enumerate(by_fastest):
        t["rank_fastest"] = i + 1

    by_average = sorted(team_standings, key=lambda x: x["average"])
    for i, t in enumerate(by_average):
        t["rank_average"] = i + 1

    # En hızlı 10 pit stop
    fastest_stops = sorted(all_fastest, key=lambda x: x["duration"])[:10]

    result = {"teams": by_fastest, "fastest_stops": fastest_stops}
    await cache_set(ck, result, ttl_seconds=3600)
    return result


@router.get("/seasons/{year}/results")
async def season_results(year: int):
    """Sezon yarış sonuçları — her round için kazanan."""
    try:
        return await standings_svc.get_season_results(year)
    except Exception as e:
        raise HTTPException(502, f"Sonuçlar alınamadı: {e}")


# ─── Strateji Simülatörü ─────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/strategy/simulate")
async def simulate_strategy(
    session_id: int,
    current_lap: int = Query(..., ge=1, description="Mevcut tur"),
    total_laps: int = Query(..., ge=10, description="Toplam tur sayısı"),
    compound: str = Query("MEDIUM", description="Mevcut lastik bileşiği"),
    tyre_age: int = Query(0, ge=0, description="Lastiğin yaşı (tur)"),
    base_lap_time: float = Query(90.0, description="Referans tur süresi (sn)"),
    alternate_pit: int | None = Query(None, description="Test edilecek özel pit turu"),
    mode: str = Query("beginner", pattern="^(beginner|expert)$"),
    driver_code: str = Query("VER"),
):
    """
    Farklı pit stop senaryolarını simüle eder.

    Her senaryo için:
    - Tahmini toplam yarış süresi
    - Mevcut stratejiye göre fark (saniye)
    - Tur bazlı lastik performans eğrisi
    - AI yorumu (beginner/expert modda)
    """
    compound = compound.upper()
    if compound not in strategy_svc.TYRE_DEG:
        raise HTTPException(400, f"Geçersiz bileşik: {compound}. Seçenekler: {list(strategy_svc.TYRE_DEG)}")

    if current_lap >= total_laps:
        raise HTTPException(400, "current_lap toplam_tur'dan küçük olmalı")

    scenarios = strategy_svc.generate_scenarios(
        total_laps=total_laps,
        base_lap_time=base_lap_time,
        current_lap=current_lap,
        current_compound=compound,
        current_tyre_age=tyre_age,
        alternate_pit_lap=alternate_pit,
    )

    # AI yorumu ekle
    scenarios = await strategy_svc.add_ai_narrative(
        scenarios, mode, driver_code, current_lap, total_laps
    )

    return {
        "session_id": session_id,
        "driver_code": driver_code,
        "current_lap": current_lap,
        "total_laps": total_laps,
        "mode": mode,
        "scenarios": [
            {
                "label": s.label,
                "stints": [
                    {
                        "compound": st.compound,
                        "start_lap": st.start_lap,
                        "end_lap": st.end_lap,
                        "laps": st.laps,
                    }
                    for st in s.stints
                ],
                "total_time": round(s.total_time, 3),
                "time_vs_base": s.time_vs_base,
                "pit_count": s.pit_count,
                "ai_summary": s.ai_summary,
                "lap_times": [round(lt, 3) for lt in s.lap_times[::3]],  # Her 3 turda bir nokta
            }
            for s in scenarios
        ],
    }


# ─── Fantasy F1 Tahminleri ───────────────────────────────────────────────────

@router.get("/seasons/{year}/fantasy/picks")
async def fantasy_picks(
    year: int,
    round: int = Query(..., description="Bu haftanın round numarası"),
    mode: str = Query("beginner", pattern="^(beginner|expert)$"),
):
    """Fantasy F1 haftasonu tahminleri — son 3 yarışın formuna göre."""
    cache_k = cache_key("fantasy_picks_full_v3", year, round, mode)
    cached = await cache_get(cache_k)
    if cached:
        return cached

    try:
        picks = await standings_svc.get_weekend_fantasy_picks(year, round)
        if not picks:
            raise HTTPException(404, "Yeterli veri yok")

        # Top 3 için AI gerekçesi
        top3 = picks[:3]
        top3_codes = [p["code"] for p in top3]
        system = (
            "F1 Fantasy koçusun. Son yarışların formuna göre kısa, net öneriler ver. "
            + ("Sade Türkçe, teknik terim yok." if mode == "beginner"
               else "Teknik analiz, pace/degradation/qualifying performance dahil et.")
            + " Düz metin yaz, tek paragraf — markdown kullanma (yıldız, başlık, "
              "madde işareti veya numaralı liste kullanma). "
            + f"Bu paragrafta SADECE şu üç pilot kodundan bahsedebilirsin: "
              f"{top3_codes[0]}, {top3_codes[1]}, {top3_codes[2]}. "
              f"Bunlar dışında BAŞKA HİÇBİR pilot ismi veya kodu YAZMA — "
              f"sadece bu üçü hakkında yorum yap. Pilotlardan SADECE 3 harfli "
              f"kodlarıyla bahset (örn. {top3_codes[0]}), pilotların gerçek "
              f"adını ASLA yazma — kod-isim eşleşmesini hatalı bilebilirsin ve "
              f"yanlış isim yazman kullanıcıyı yanıltır."
        )
        prompt = "Bu hafta için top 3 öneri (SADECE bu pilot kodlarından bahset, isim yazma):\n" + "\n".join(
            f"{i+1}. {p['code']}: form={p['form_score']}, ort puan={p['avg_points']}, ort pozisyon={p['avg_position']}"
            for i, p in enumerate(top3)
        ) + (
            f"\nBu {len(top3)} pilot için tek cümle gerekçe yaz, hepsini akıcı bir paragrafta birleştir. "
            f"Pilot kodları olarak SADECE {', '.join(top3_codes)} kullan, başka isim/kod yazma."
        )

        ai_note = ""
        if claude_ai._groq_ok():
            try:
                ai_note = await claude_ai._groq_interpret(prompt, system)
            except Exception:
                ai_note = ""
        if not ai_note and claude_ai._anthropic_ok():
            try:
                ai_note = await claude_ai._anthropic_interpret(prompt, system)
            except Exception:
                ai_note = ""
        ai_note = claude_ai._clean_ai_text(ai_note)

        response = {
            "year": year,
            "round": round,
            "picks": picks,
            "ai_summary": ai_note,
            "mode": mode,
        }
        await cache_set(cache_k, response, ttl_seconds=3600)
        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Fantasy tahmin alınamadı: {e}")
