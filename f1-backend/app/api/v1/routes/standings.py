from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
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
