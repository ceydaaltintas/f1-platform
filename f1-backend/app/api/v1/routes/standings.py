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
    """Takım bazında pit stop şampiyonası: en hızlı + ortalama."""
    ck = cache_key("pitstop_standings", year)
    cached = await cache_get(ck)
    if cached:
        return cached

    from sqlalchemy import select, func
    from app.models.f1 import PitStop, Session, Round, Season, Driver

    season_result = await db.execute(select(Season).where(Season.year == year))
    season = season_result.scalar_one_or_none()
    if season is None:
        raise HTTPException(404, f"{year} sezonu bulunamadı")

    # Tamamlanmış yarış session'larındaki pit stopları çek
    rows = await db.execute(
        select(
            PitStop.stop_duration,
            Driver.current_team_id,
        )
        .join(Session, PitStop.session_id == Session.id)
        .join(Round, Session.round_id == Round.id)
        .join(Driver, PitStop.driver_id == Driver.id)
        .where(
            Round.season_id == season.id,
            Session.type == "race",
            PitStop.stop_duration.isnot(None),
            PitStop.stop_duration > 0,
            PitStop.stop_duration < 60,
        )
    )
    pit_data = rows.all()

    if not pit_data:
        result = {"teams": [], "fastest_stops": []}
        await cache_set(ck, result, ttl_seconds=300)
        return result

    # Takım isimlerini çek
    from app.models.f1 import Team
    teams_result = await db.execute(select(Team))
    team_map = {t.id: t.name for t in teams_result.scalars().all()}

    # Takım bazında grupla
    from collections import defaultdict
    team_stops: dict[int, list[float]] = defaultdict(list)
    for duration, team_id in pit_data:
        if team_id:
            team_stops[team_id].append(duration)

    # Takım sıralaması
    team_standings = []
    for team_id, durations in team_stops.items():
        team_standings.append({
            "team_id": team_id,
            "team_name": team_map.get(team_id, "?"),
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

    # Sezonun en hızlı 10 pit stopu
    all_stops = await db.execute(
        select(
            PitStop.stop_duration,
            PitStop.lap_number,
            Driver.code,
            Round.name.label("race_name"),
        )
        .join(Session, PitStop.session_id == Session.id)
        .join(Round, Session.round_id == Round.id)
        .join(Driver, PitStop.driver_id == Driver.id)
        .where(
            Round.season_id == season.id,
            Session.type == "race",
            PitStop.stop_duration.isnot(None),
            PitStop.stop_duration > 0,
            PitStop.stop_duration < 60,
        )
        .order_by(PitStop.stop_duration)
        .limit(10)
    )
    fastest_stops = [
        {"duration": round(r.stop_duration, 3), "driver": r.code,
         "race": r.race_name, "lap": r.lap_number}
        for r in all_stops.all()
    ]

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
