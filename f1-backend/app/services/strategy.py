"""
Strateji simülatör servisi.

"X turda pit yapsaydı ne olurdu?" sorusunu yanıtlar.
Gerçek deg verisi yoksa OpenF1 stint verilerinden tahmin üretir.
"""

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Lastik performans modeli (saniye/tur kayıp)
TYRE_DEG: dict[str, dict] = {
    "SOFT":         {"base_pace": 0.0, "deg_per_lap": 0.065, "cliff_lap": 22},
    "MEDIUM":       {"base_pace": 0.35, "deg_per_lap": 0.035, "cliff_lap": 35},
    "HARD":         {"base_pace": 0.75, "deg_per_lap": 0.018, "cliff_lap": 55},
    "INTERMEDIATE": {"base_pace": 2.0,  "deg_per_lap": 0.08,  "cliff_lap": 20},
    "WET":          {"base_pace": 4.0,  "deg_per_lap": 0.10,  "cliff_lap": 15},
}

PIT_LOSS_SECONDS = 22.0   # ortalama pit stop + pit lane kaybı
SAFETY_CAR_DELTA = -15.0  # SC altında pit fırsatı avantajı

DRY_COMPOUNDS = ["SOFT", "MEDIUM", "HARD"]


def _different(current: str, remaining_laps: int) -> str:
    """
    Mevcut hamurdan FARKLI bir hamur seçer (1-stop senaryoları için).
    1-stop'ta 2 farklı hamur kullanmak ZORUNLU.
    """
    candidates = [c for c in DRY_COMPOUNDS if c != current]
    if remaining_laps > 30:
        order = ["HARD", "MEDIUM", "SOFT"]
    elif remaining_laps > 15:
        order = ["MEDIUM", "HARD", "SOFT"]
    else:
        order = ["SOFT", "MEDIUM", "HARD"]
    for c in order:
        if c in candidates:
            return c
    return candidates[0]


def _validate_two_compound_rule(stints: list["Stint"]) -> bool:
    """
    F1 kuru lastik kuralı: yarış boyunca en az 2 FARKLI bileşik kullanılmalı.
    Aynı hamur birden fazla stint kullanılabilir (M→S→M geçerli).
    """
    return len({s.compound for s in stints}) >= 2


@dataclass
class Stint:
    compound: str
    start_lap: int
    end_lap: int
    tyre_age_start: int = 0

    @property
    def laps(self) -> int:
        return self.end_lap - self.start_lap + 1


@dataclass
class StrategyScenario:
    label: str
    label_key: str             # i18n key: "base" | "early_pit" | "late_pit"
    stints: list[Stint]
    total_time: float          # saniye
    pit_count: int
    time_vs_base: float        # + ise daha yavaş, - ise daha hızlı
    ai_summary: str = ""
    lap_times: list[float] = field(default_factory=list)


def _lap_time_for(
    compound: str,
    lap_in_stint: int,
    tyre_age_start: int,
    base_lap_time: float,
) -> float:
    """Belirli bir tur için tahmini tur süresi hesaplar."""
    model = TYRE_DEG.get(compound, TYRE_DEG["MEDIUM"])
    effective_age = lap_in_stint + tyre_age_start
    deg = model["deg_per_lap"] * effective_age

    # Cliff: uçurum sonrası degradasyon katlanır
    if effective_age > model["cliff_lap"]:
        over = effective_age - model["cliff_lap"]
        deg += model["deg_per_lap"] * over * 1.5

    return base_lap_time + model["base_pace"] + deg


def simulate_scenario(
    stints: list[Stint],
    base_lap_time: float,
    total_laps: int,
) -> tuple[float, list[float]]:
    """Verilen stint planı için toplam yarış süresini hesaplar."""
    total = 0.0
    lap_times: list[float] = []
    lap = 1

    for i, stint in enumerate(stints):
        pit_loss = PIT_LOSS_SECONDS if i > 0 else 0.0
        total += pit_loss

        for j in range(stint.laps):
            lt = _lap_time_for(
                stint.compound,
                j,
                stint.tyre_age_start,
                base_lap_time,
            )
            total += lt
            lap_times.append(lt)
            lap += 1

    return total, lap_times


def generate_scenarios(
    total_laps: int,
    base_lap_time: float,
    current_lap: int,
    current_compound: str,
    current_tyre_age: int,
    alternate_pit_lap: int | None = None,
) -> list[StrategyScenario]:
    """
    Birden fazla strateji senaryosu üretir:
    - Mevcut strateji (tek pit, mevcut bileşen devam)
    - Erken pit (5 tur önce)
    - Geç pit (5 tur sonra)
    - İki pit
    - Önerilen özel tur (alternate_pit_lap)
    """
    remaining = total_laps - current_lap
    scenarios: list[StrategyScenario] = []

    def _make(label: str, stints: list[Stint], label_key: str = "base") -> StrategyScenario:
        total, laps = simulate_scenario(stints, base_lap_time, total_laps)
        return StrategyScenario(
            label=label,
            label_key=label_key,
            stints=stints,
            total_time=total,
            pit_count=len(stints) - 1,
            time_vs_base=0.0,
            lap_times=laps,
        )

    # ── 1: Mevcut strateji — pit ~%55 noktasında ──────────────────────────
    # 1-stop: 2 FARKLI hamur zorunlu
    mid = current_lap + max(5, int(remaining * 0.55))
    mid = min(mid, total_laps - 3)
    mid_next = _different(current_compound, total_laps - mid)
    base = _make(
        f"1-Stop · {current_compound[0]}→{mid_next[0]} (Tur {mid})",
        [
            Stint(current_compound, current_lap, mid, current_tyre_age),
            Stint(mid_next, mid + 1, total_laps),
        ],
        label_key="base",
    )
    scenarios.append(base)

    # ── 2: Erken pit (undercut penceresi) ─────────────────────────────────
    # 1-stop: 2 FARKLI hamur zorunlu
    early = max(current_lap + 2, mid - 7)
    if early != mid:
        early_next = "HARD" if current_compound != "HARD" else "MEDIUM"
        s = _make(
            f"Erken pit · {current_compound[0]}→{early_next[0]} (Tur {early})",
            [
                Stint(current_compound, current_lap, early, current_tyre_age),
                Stint(early_next, early + 1, total_laps),
            ],
            label_key="early_pit",
        )
        scenarios.append(s)

    # ── 3: Geç pit (overcut penceresi) ────────────────────────────────────
    # 1-stop: 2 FARKLI hamur zorunlu
    late = min(mid + 7, total_laps - 5)
    if late != mid:
        late_next = "SOFT" if current_compound != "SOFT" else "MEDIUM"
        s = _make(
            f"Geç pit · {current_compound[0]}→{late_next[0]} (Tur {late})",
            [
                Stint(current_compound, current_lap, late, current_tyre_age),
                Stint(late_next, late + 1, total_laps),
            ],
            label_key="late_pit",
        )
        scenarios.append(s)

    # ── 4a: Undercut — 2-stop, kısa orta stint (aynı hamura dönülebilir) ──
    # Kural: toplam en az 2 FARKLI hamur → M→S→M geçerli!
    if total_laps >= 40:
        p1 = current_lap + max(4, remaining // 3)
        p2 = current_lap + max(8, (remaining * 2) // 3)
        p1 = min(p1, total_laps - 10)
        p2 = min(p2, total_laps - 3)

        # Undercut: ortada kısa agresif stint (farklı hamur), sonda orjinale dön
        mid_aggressive = _different(current_compound, p2 - p1)
        undercut_stints = [
            Stint(current_compound, current_lap, p1, current_tyre_age),
            Stint(mid_aggressive, p1 + 1, p2),    # kısa agresif stint
            Stint(current_compound, p2 + 1, total_laps),  # orijinal hamura dön
        ]
        # Kural kontrolü (her zaman geçer çünkü S1 ≠ S2)
        s = _make(
            f"Undercut · {current_compound[0]}→{mid_aggressive[0]}→{current_compound[0]} (Tur {p1}+{p2})",
            undercut_stints,
            label_key="undercut",
        )
        scenarios.append(s)

    # ── 4b: 3 farklı hamur — klasik 2-stop ────────────────────────────────
    if total_laps >= 40:
        p1 = current_lap + max(4, remaining // 3)
        p2 = current_lap + max(8, (remaining * 2) // 3)
        p1 = min(p1, total_laps - 10)
        p2 = min(p2, total_laps - 3)

        stint2 = _different(current_compound, p2 - p1)
        # stint3: mümkünse 3. farklı hamur, yoksa S2 ile aynı olabilir (kural yine sağlanır)
        others = [c for c in DRY_COMPOUNDS if c != current_compound and c != stint2]
        stint3 = others[0] if others else stint2
        classic_stints = [
            Stint(current_compound, current_lap, p1, current_tyre_age),
            Stint(stint2, p1 + 1, p2),
            Stint(stint3, p2 + 1, total_laps),
        ]
        s = _make(
            f"Klasik 2-stop · {current_compound[0]}→{stint2[0]}→{stint3[0]} (Tur {p1}+{p2})",
            classic_stints,
            label_key="classic_2stop",
        )
        scenarios.append(s)

    # ── 5: Kullanıcının özel tur seçimi ───────────────────────────────────
    # 1-stop: 2 FARKLI hamur zorunlu
    if alternate_pit_lap and current_lap < alternate_pit_lap < total_laps - 2:
        alt_next = _different(current_compound, total_laps - alternate_pit_lap)
        s = _make(
            f"Özel pit · {current_compound[0]}→{alt_next[0]} (Tur {alternate_pit_lap})",
            [
                Stint(current_compound, current_lap, alternate_pit_lap, current_tyre_age),
                Stint(alt_next, alternate_pit_lap + 1, total_laps),
            ],
            label_key="custom_pit",
        )
        scenarios.append(s)

    # Temel süreye göre delta hesapla
    base_time = scenarios[0].total_time
    for s in scenarios:
        s.time_vs_base = round(s.total_time - base_time, 3)

    return scenarios


async def add_ai_narrative(
    scenarios: list[StrategyScenario],
    mode: str,
    driver_code: str,
    current_lap: int,
    total_laps: int,
) -> list[StrategyScenario]:
    """Her senaryoya Claude AI yorumu ekler."""
    try:
        from app.core.config import settings
        from app.core.redis_client import cache_get, cache_key, cache_set
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        system = (
            "Sen bir F1 strateji mühendisisin. Verilen strateji senaryolarını kısaca yorumla. "
            + ("Sade Türkçe kullan, teknik jargonsuz." if mode == "beginner"
               else "Teknik terminoloji kullan: undercut, overcut, deg cliff, tyre delta.")
        )

        for s in scenarios:
            ck = cache_key("strategy_ai", driver_code, s.label, mode)
            cached = await cache_get(ck)
            if cached:
                s.ai_summary = cached.get("text", "")
                continue

            prompt = (
                f"Sürücü: {driver_code} | Tur: {current_lap}/{total_laps}\n"
                f"Senaryo: {s.label}\n"
                f"Pit sayısı: {s.pit_count} | Fark: {s.time_vs_base:+.1f}sn\n"
                f"Bu stratejiyi 1-2 cümle ile değerlendir."
            )
            msg = await client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=150,
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text if msg.content else ""
            s.ai_summary = text
            await cache_set(ck, {"text": text}, ttl_seconds=3600)

    except Exception as e:
        logger.warning("Strateji AI yorumu başarısız: %s", e)

    return scenarios
