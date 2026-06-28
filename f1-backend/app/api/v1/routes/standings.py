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


@router.get("/drivers/{driver_id}/profile")
async def driver_profile(driver_id: str):
    """Pilot kariyer istatistikleri + AI biyografi."""
    ck = cache_key("driver_profile", driver_id)
    cached = await cache_get(ck)
    if cached:
        return cached

    from app.services import jolpica

    # Jolpica'dan kariyer verileri
    try:
        results = await jolpica.fetch_driver_results(driver_id)
    except Exception:
        results = []

    total_races = len(results)
    wins = 0
    podiums = 0
    poles = 0
    first_race = None
    for r in results:
        res = r.get("Results", [{}])[0] if r.get("Results") else {}
        pos = res.get("position")
        grid = res.get("grid")
        if pos == "1":
            wins += 1
        if pos and int(pos) <= 3:
            podiums += 1
        if grid == "1":
            poles += 1
        if first_race is None:
            first_race = r.get("season")

    # AI biyografi
    bio = ""
    try:
        bio_ck = cache_key("driver_bio", driver_id)
        bio = await cache_get(bio_ck)
        if not bio:
            from app.services import claude_ai
            prompt = f"F1 pilotu {driver_id} hakkında 2 cümlelik kısa Türkçe biyografi yaz. Kariyer başarıları, tarzı ve öne çıkan özellikleri."
            system = "Sen bir F1 uzmanısın. Çok kısa, bilgilendirici pilot tanıtımları yazarsın. Maksimum 2 cümle, sade Türkçe."
            if claude_ai._groq_ok():
                bio = await claude_ai._groq_interpret(prompt, system)
            elif claude_ai._anthropic_ok():
                bio = await claude_ai._anthropic_interpret(prompt, system)
            if bio:
                bio = claude_ai._clean_ai_text(bio)
                await cache_set(bio_ck, bio, ttl_seconds=7 * 86_400)
    except Exception:
        pass

    result = {
        "driver_id": driver_id,
        "total_races": total_races,
        "wins": wins,
        "podiums": podiums,
        "poles": poles,
        "debut_year": first_race,
        "bio": bio or None,
    }
    await cache_set(ck, result, ttl_seconds=86_400)
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
