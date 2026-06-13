from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services import claude_ai

router = APIRouter(prefix="/ai", tags=["AI yorum"])


def _any_ai_available() -> bool:
    """Groq veya Anthropic'ten herhangi biri kullanılabilir mi?"""
    groq_key = settings.groq_api_key
    ant_key  = settings.anthropic_api_key
    groq_ok = bool(groq_key and len(groq_key) > 20 and "placeholder" not in groq_key.lower())
    ant_ok  = bool(ant_key and len(ant_key) > 30
                   and not ant_key.startswith("sk-ant-...")
                   and "placeholder" not in ant_key.lower())
    return groq_ok or ant_ok


class PointSnapshot(BaseModel):
    """Tek bir telemetri noktası."""
    speed: float | None = None
    throttle: float | None = None
    brake: float | None = None
    gear: int | None = None
    drs: int | None = None
    rpm: int | None = None
    dist_m: float | None = None


class TelemetrySnapshot(PointSnapshot):
    mode: str = Field("beginner", pattern="^(beginner|expert)$")
    # Karşılaştırma modu — opsiyonel
    driver_a: str | None = None
    driver_b: str | None = None
    snapshot_b: PointSnapshot | None = None   # İkinci pilotun aynı mesafedeki noktası


class LapSummaryRequest(BaseModel):
    lap_info: dict
    key_moments: list[dict] = Field(default_factory=list)
    mode: str = Field("beginner", pattern="^(beginner|expert)$")


class CompareRequest(BaseModel):
    driver_a: str
    driver_b: str
    lap_a: dict
    lap_b: dict
    delta_summary: dict = Field(default_factory=dict)
    mode: str = Field("beginner", pattern="^(beginner|expert)$")


@router.post("/interpret")
async def interpret_snapshot(body: TelemetrySnapshot):
    """
    Tek pilot veya karşılaştırmalı telemetri yorumu.
    snapshot_b + driver_a + driver_b gönderilirse iki pilotu aynı noktada karşılaştırır.
    Öncelik: Groq → Anthropic → Kural tabanlı (her zaman çalışır).
    """
    exclude = {"mode", "driver_a", "driver_b", "snapshot_b"}
    snap_a = body.model_dump(exclude=exclude)

    if body.snapshot_b and body.driver_a and body.driver_b:
        snap_b = body.snapshot_b.model_dump()
        explanation = await claude_ai.interpret_point_comparison(
            driver_a=body.driver_a,
            driver_b=body.driver_b,
            snap_a=snap_a,
            snap_b=snap_b,
            mode=body.mode,
        )
    else:
        explanation = await claude_ai.interpret_telemetry(snap_a, body.mode, driver_code=body.driver_a)

    source = "groq" if claude_ai._groq_ok() else ("anthropic" if claude_ai._anthropic_ok() else "rule")
    return {"explanation": explanation, "mode": body.mode, "source": source}


@router.post("/lap_summary")
async def lap_summary(body: LapSummaryRequest):
    """Bir turun tüm verilerini analiz ederek özet üretir."""
    text = await claude_ai.summarize_lap(body.lap_info, body.key_moments, body.mode)
    return {"summary": text, "mode": body.mode}


@router.post("/compare")
async def compare(body: CompareRequest):
    """İki pilotun karşılaştırmasını yorumlar."""
    text = await claude_ai.compare_drivers(
        body.driver_a, body.driver_b,
        body.lap_a, body.lap_b,
        body.delta_summary, body.mode,
    )
    return {"comparison": text, "drivers": [body.driver_a, body.driver_b], "mode": body.mode}
