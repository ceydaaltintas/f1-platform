"""
2026 F1 Enerji Yönetimi Analiz Servisi

2026 regülasyonları:
  - MGU-K max deploy: 350 kW (2025: 120 kW)
  - MGU-K max regen:  350 kW
  - Enerji deposu: ~4 MJ toplam, ~900 kJ/tur deploy limiti
  - DRS kaldırıldı → Aktif aero (X-mode düz / Z-mode köşe)
  - ICE/ERS güç payı: ~50/50

Gerçek SoC kamuya açık değil. Bu servis telemetri sinyallerinden
(speed, throttle, brake, rpm, gear) fizik modeli ile tahmini enerji
eğrisi üretir. Mutlak değerler yaklaşık, göreceli karşılaştırmalar güvenilir.
"""

import logging
import math
from typing import Any

logger = logging.getLogger(__name__)

# ─── 2026 F1 Sabitler ────────────────────────────────────────────────────────

MGU_K_MAX_KW      = 350.0        # MGU-K maksimum güç (kW)
ENERGY_STORE_KJ   = 4_000.0      # Toplam enerji deposu kapasitesi (kJ)
LAP_DEPLOY_LIMIT  = 900.0        # Tur başına deploy limiti (kJ)
REGEN_EFFICIENCY  = 0.72         # Frenleme → elektrik dönüşüm verimliliği
DEPLOY_EFFICIENCY = 0.88         # Elektrik → mekanik dönüşüm verimliliği
AERO_SPEED_THRESH = 280.0        # X-mode aktif olduğu tahmini minimum hız (km/h)
AERO_ACCEL_MULT   = 1.18         # X-mode'da ICE alone'a göre beklenen ivme çarpanı

# Deploy agresifliği eşikleri
DEPLOY_THROTTLE_THRESH = 85      # Throttle % (üzeri = deploy başlar)
REGEN_BRAKE_THRESH     = 15      # Brake % (üzeri = regen başlar)


def _estimate_deploy(throttle: float, speed_kmh: float, gear: int, dt: float) -> float:
    """
    Belirli bir anda tahmini enerji deploy miktarını (kJ) hesaplar.
    Yüksek gaz + yüksek hız + yüksek vites = maksimum deploy.
    """
    if throttle < DEPLOY_THROTTLE_THRESH or speed_kmh < 80 or gear < 3:
        return 0.0

    # Gaz pedal oranı (0-1)
    throttle_ratio = (throttle - DEPLOY_THROTTLE_THRESH) / (100 - DEPLOY_THROTTLE_THRESH)

    # Hız faktörü: düşük hızda deploy az (tork sınırı)
    speed_factor = min(speed_kmh / 250.0, 1.0)

    # Vites faktörü: yüksek vites = daha çok deploy
    gear_factor = min(gear / 8.0, 1.0)

    # Tahmini MGU-K gücü (kW)
    power_kw = MGU_K_MAX_KW * throttle_ratio * speed_factor * gear_factor * 0.6

    # kJ = kW × dt(s)
    return power_kw * dt / DEPLOY_EFFICIENCY


def _estimate_regen(brake: float, speed_kmh: float, dt: float) -> float:
    """
    Frenleme sırasında tahmini enerji toplama miktarını (kJ) hesaplar.
    """
    if brake < REGEN_BRAKE_THRESH or speed_kmh < 50:
        return 0.0

    brake_ratio  = min(brake / 100.0, 1.0)
    speed_factor = min(speed_kmh / 300.0, 1.0)

    # Frenleme enerjisi: F×v = m×a×v, basitleştirilmiş
    power_kw = MGU_K_MAX_KW * brake_ratio * speed_factor * 0.55

    return power_kw * dt * REGEN_EFFICIENCY


def _detect_x_mode(
    speed: float,
    throttle: float,
    prev_speed: float,
    dt: float,
    lap_avg_accel: float,
) -> float:
    """
    X-mode (aktif aero açık) olasılığını tahmin eder (0–1).

    Sinyal: Aynı hız aralığında beklenenin üzerinde ivme.
    Bu durum ya ekstra enerji deploy ya da daha az aerodinamik sürükleme
    (aktif aero) ile açıklanır.
    """
    if speed < AERO_SPEED_THRESH or throttle < 90:
        return 0.0

    if dt <= 0:
        return 0.0

    actual_accel = (speed - prev_speed) / dt  # km/h per second

    if lap_avg_accel <= 0:
        return 0.0

    # Beklenenin ne kadar üzerinde?
    ratio = actual_accel / (lap_avg_accel * AERO_ACCEL_MULT)
    probability = max(0.0, min(1.0, ratio))

    return round(probability, 3)


def compute_energy_analysis(
    car_data: list[dict],
    laps_data: list[dict],
    driver_number: int,
) -> dict:
    """
    Ham telemetri verisinden 2026 F1 enerji analizi üretir.

    Döndürülen yapı:
    {
      soc_curve:    [{dist_m, soc_pct, deploy_kw, regen_kw, x_mode_prob}]
      deploy_zones: [{dist_start, dist_end, intensity, lap}]
      regen_zones:  [{dist_start, dist_end, intensity}]
      per_lap:      [{lap, deploy_kj, regen_kj, net_kj, efficiency_pct, x_mode_count}]
      profile:      {aggression, harvest_eff, x_mode_zones, top_deploy_segment, top_regen_segment}
    }
    """
    if not car_data:
        return _empty_result()

    # car_data'yı zaman sırasına göre sırala
    samples = sorted(car_data, key=lambda x: x.get("date", ""))

    # Lap timestamp haritası — car_data'da lap_number yok,
    # her tur'un başlangıç zamanından hangi tur olduğunu buluruz
    from datetime import datetime as dt_cls

    def _parse_dt(s: str | None):
        if not s: return None
        try:
            return dt_cls.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None

    # Tur başlangıç zamanlarını sırala
    lap_starts: list[tuple[float, int]] = []  # (timestamp_float, lap_number)
    for lap in sorted(laps_data, key=lambda l: l.get("lap_number", 0)):
        ln = lap.get("lap_number")
        ds = _parse_dt(lap.get("date_start"))
        if ln and ds:
            lap_starts.append((ds.timestamp(), int(ln)))

    def _lap_of(date_str: str | None) -> int:
        """Bir timestamp'in hangi tura ait olduğunu bulur."""
        if not lap_starts or not date_str:
            return 1
        ts = _parse_dt(date_str)
        if not ts:
            return 1
        t = ts.timestamp()
        lap_n = lap_starts[0][1]
        for start_t, ln in lap_starts:
            if t >= start_t:
                lap_n = ln
            else:
                break
        return lap_n

    # ── Mesafe tahmini ──────────────────────────────────────────────────────
    # dist_total: yarış boyunca kümülatif (grafik x ekseni)
    # dist_lap:   tur içi mesafe (zone tespiti için)
    dist_total = 0.0
    dist_lap   = 0.0
    prev_time  = None
    prev_speed = 0.0

    soc_pct    = 100.0
    current_lap = 1

    # Lap bazında birikimli değerler
    lap_deploy: dict[int, float] = {}
    lap_regen:  dict[int, float] = {}
    lap_x_mode: dict[int, int]   = {}
    lap_samples: dict[int, int]  = {}

    # Çıktı listeleri
    soc_curve:    list[dict] = []
    deploy_zones: list[dict] = []
    regen_zones:  list[dict] = []

    # Lap ortalaması için ivme hesabı
    lap_accels: list[float] = []
    lap_avg_accel = 2.0  # Başlangıç tahmini

    zone_buffer_d: dict | None = None
    zone_buffer_r: dict | None = None

    for i, s in enumerate(samples):
        speed    = float(s.get("speed",    0) or 0)
        throttle = float(s.get("throttle", 0) or 0)
        brake    = float(s.get("brake",    0) or 0)
        gear     = int(s.get("n_gear",     0) or s.get("gear", 0) or 0)
        lap_n    = _lap_of(s.get("date"))

        # Zaman farkı
        dt = 0.1  # OpenF1 car_data ~10Hz örnekleme
        if prev_time and s.get("date"):
            try:
                from datetime import datetime
                t1 = datetime.fromisoformat(prev_time.replace("Z", "+00:00"))
                t2 = datetime.fromisoformat(s["date"].replace("Z", "+00:00"))
                dt = max(0.01, (t2 - t1).total_seconds())
            except Exception:
                dt = 0.1

        prev_time = s.get("date")

        # Mesafe güncelle
        delta_m = (speed / 3.6) * dt
        dist_total += delta_m
        dist_lap   += delta_m

        # Tur değişimini tespit et
        if lap_n != current_lap:
            soc_pct     = min(100.0, soc_pct + 30.0)
            current_lap = lap_n
            dist_lap    = 0.0   # tur içi sıfırla, toplam korunur
            if lap_accels:
                lap_avg_accel = sum(lap_accels) / len(lap_accels)
            lap_accels = []

        # İvme (X-mode tespiti için)
        if dt > 0:
            accel = (speed - prev_speed) / dt
            if speed > AERO_SPEED_THRESH and throttle > 85:
                lap_accels.append(accel)

        # Deploy & Regen hesapla
        deploy_kj = _estimate_deploy(throttle, speed, gear, dt)
        regen_kj  = _estimate_regen(brake, speed, dt)
        x_prob    = _detect_x_mode(speed, throttle, prev_speed, dt, lap_avg_accel)

        # SoC güncelle
        deploy_drain = deploy_kj / ENERGY_STORE_KJ * 100
        regen_gain   = regen_kj  / ENERGY_STORE_KJ * 100
        soc_pct      = max(10.0, min(100.0, soc_pct - deploy_drain + regen_gain))

        # Lap birikimli değerler
        lap_deploy[lap_n] = lap_deploy.get(lap_n, 0) + deploy_kj
        lap_regen[lap_n]  = lap_regen.get(lap_n, 0)  + regen_kj
        lap_samples[lap_n] = lap_samples.get(lap_n, 0) + 1
        if x_prob > 0.6:
            lap_x_mode[lap_n] = lap_x_mode.get(lap_n, 0) + 1

        # SoC eğrisi (her 5. sample → boyutu küçült)
        if i % 5 == 0:
            soc_curve.append({
                "dist_m":    round(dist_total, 1),   # kümülatif
                "dist_lap":  round(dist_lap, 1),     # tur içi
                "soc_pct":   round(soc_pct, 1),
                "deploy_kw": round(deploy_kj / dt if dt > 0 else 0, 1),
                "regen_kw":  round(regen_kj  / dt if dt > 0 else 0, 1),
                "x_mode":    x_prob,
                "lap":       lap_n,
                "speed":     speed,
            })

        # Deploy zone biriktir
        if deploy_kj > 0.5:
            if zone_buffer_d is None:
                zone_buffer_d = {"dist_start": dist_total, "intensity_sum": 0, "count": 0, "lap": lap_n}
            zone_buffer_d["intensity_sum"] += deploy_kj
            zone_buffer_d["count"] += 1
        elif zone_buffer_d:
            deploy_zones.append({
                "dist_start": round(zone_buffer_d["dist_start"], 1),
                "dist_end":   round(dist_total, 1),
                "intensity":  min(1.0, round(zone_buffer_d["intensity_sum"] / 10, 3)),
                "lap":        zone_buffer_d["lap"],
            })
            zone_buffer_d = None

        # Regen zone biriktir
        if regen_kj > 0.3:
            if zone_buffer_r is None:
                zone_buffer_r = {"dist_start": dist_total, "intensity_sum": 0, "count": 0}
            zone_buffer_r["intensity_sum"] += regen_kj
            zone_buffer_r["count"] += 1
        elif zone_buffer_r:
            regen_zones.append({
                "dist_start": round(zone_buffer_r["dist_start"], 1),
                "dist_end":   round(dist_total, 1),
                "intensity":  min(1.0, round(zone_buffer_r["intensity_sum"] / 8, 3)),
            })
            zone_buffer_r = None

        prev_speed = speed

    # ── Per-lap özet + normalizasyon ─────────────────────────────────────────
    # Fizik modeli mutlak değerlerde sapabilir; max deploy'u LAP_DEPLOY_LIMIT'e
    # normalize ederek göreceli karşılaştırmayı doğru tutarız.
    raw_deploys = list(lap_deploy.values())
    raw_regens  = list(lap_regen.values())
    max_raw     = max(raw_deploys) if raw_deploys else 1
    # Normalizasyon faktörü: en yüksek tur değeri LAP_DEPLOY_LIMIT'e eşitlenir
    norm = LAP_DEPLOY_LIMIT / max_raw if max_raw > LAP_DEPLOY_LIMIT else 1.0

    per_lap = []
    for ln in sorted(lap_deploy.keys()):
        dep = lap_deploy.get(ln, 0) * norm
        reg = lap_regen.get(ln, 0)  * norm
        net = dep - reg
        eff = (reg / dep * 100) if dep > 0 else 0
        per_lap.append({
            "lap":            ln,
            "deploy_kj":      round(dep, 1),
            "regen_kj":       round(reg, 1),
            "net_kj":         round(net, 1),
            "efficiency_pct": round(eff, 1),
            "x_mode_count":   lap_x_mode.get(ln, 0),
        })

    all_deploys = [l["deploy_kj"] for l in per_lap]
    all_regens  = [l["regen_kj"]  for l in per_lap]

    # ── Pilot profil skoru ────────────────────────────────────────────────────
    avg_deploy = sum(all_deploys) / len(all_deploys) if all_deploys else 0
    avg_regen  = sum(all_regens)  / len(all_regens)  if all_regens  else 0

    # Agresiflik: zamanın ne kadarında SoC kritik seviyede (%30 altı)?
    # Çok deploy = çok zaman kritik seviyede → yüksek agresiflik
    total_pts = len(soc_curve)
    low_pts   = sum(1 for p in soc_curve if p["soc_pct"] < 30)
    aggression = min(100, int(low_pts / total_pts * 100)) if total_pts > 0 else 0

    # Harvest verimliliği: ort. regen / ort. deploy oranı (0-100)
    harvest_eff = min(100, int(avg_regen / avg_deploy * 100)) if avg_deploy > 0 else 0

    # En çok X-mode olan segmentleri bul
    x_mode_zones = [
        p["dist_start"]
        for p in deploy_zones
        if p.get("intensity", 0) > 0.7
    ][:5]

    # En yoğun deploy segmenti
    top_deploy = max(deploy_zones, key=lambda z: z["intensity"], default=None)
    top_regen  = max(regen_zones,  key=lambda z: z["intensity"], default=None)

    # SoC eğrisini eşit aralıklarla 500 noktaya indir (son N nokta değil —
    # erken finiş eden pilotlarda son noktalar park edilmiş arabaya denk gelip
    # SoC'yi sabit 100'de gösterebilir, yarışın tamamını temsil etmeli)
    curve_step = max(1, len(soc_curve) // 500)

    return {
        "soc_curve":    soc_curve[::curve_step][:500],
        "deploy_zones": deploy_zones[:100],
        "regen_zones":  regen_zones[:100],
        "per_lap":      per_lap,
        "profile": {
            "aggression":          aggression,
            "harvest_eff":         harvest_eff,
            "x_mode_zones":        x_mode_zones,
            "avg_deploy_kj":       round(avg_deploy, 1),
            "avg_regen_kj":        round(avg_regen, 1),
            "top_deploy_segment":  top_deploy,
            "top_regen_segment":   top_regen,
            "total_laps_analyzed": len(per_lap),
        },
    }


def _empty_result() -> dict:
    return {
        "soc_curve": [], "deploy_zones": [], "regen_zones": [],
        "per_lap": [], "profile": {
            "aggression": 0, "harvest_eff": 0, "x_mode_zones": [],
            "avg_deploy_kj": 0, "avg_regen_kj": 0,
            "top_deploy_segment": None, "top_regen_segment": None,
            "total_laps_analyzed": 0,
        },
    }
