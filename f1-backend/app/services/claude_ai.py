"""
AI Yorum Servisi — öncelik sırası:
  1. Groq API (ücretsiz, llama-3.1-8b-instant)
  2. Anthropic API (ücretli, yedek)
  3. Kural tabanlı yorum (API key yoksa, her zaman çalışır)

Cache: Redis — aynı (telemetri + mod) kombinasyonu önbelleğe alınır.
"""

import hashlib
import json
import logging
import re

from app.core.config import settings
from app.core.redis_client import cache_get, cache_set

logger = logging.getLogger(__name__)


def formatLapTime(seconds: float) -> str:
    """82.0913 → 1:22.0913"""
    m   = int(seconds // 60)
    s   = int(seconds % 60)
    ms4 = round((seconds % 1) * 10_000)
    return f"{m}:{s:02d}.{ms4:04d}"


# ─── Servis tespiti ──────────────────────────────────────────────────────────

def _groq_ok() -> bool:
    k = settings.groq_api_key
    return bool(k and len(k) > 20 and "placeholder" not in k.lower())


def _anthropic_ok() -> bool:
    k = settings.anthropic_api_key
    return bool(k and len(k) > 30
                and not k.startswith("sk-ant-...")
                and "placeholder" not in k.lower())


# Prompt formatı değiştiğinde bu sayıyı artır — eski (yarım kalmış/markdown'lu)
# önbellek girdilerini geçersiz kılar.
PROMPT_VERSION = 7


def _cache_key(payload: dict) -> str:
    digest = hashlib.md5(
        json.dumps({"v": PROMPT_VERSION, **payload}, sort_keys=True, default=str).encode()
    ).hexdigest()[:12]
    return f"ai:{digest}"


def _clean_ai_text(text: str, driver_code: str | None = None) -> str:
    """
    AI çıktısını tek paragraflık düz metne indirger. Model FORMAT_RULES'a
    uymasa bile (madde işareti, başlık, markdown, çok satırlılık) burada
    temizlenir — kullanıcıya her zaman tutarlı, tek paragraf metin gider.
    """
    if not text:
        return text
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    text = text.replace("**", "").replace("__", "").replace("##", "")
    cleaned_lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        line = re.sub(r"^#{1,6}\s*", "", line)          # # Başlık
        line = re.sub(r"^[-•*]\s+", "", line)            # - madde / • madde
        line = re.sub(r"^\d+[.)]\s+", "", line)          # 1. madde
        cleaned_lines.append(line)
    joined = " ".join(cleaned_lines)
    joined = re.sub(r"\s+", " ", joined).strip()
    if driver_code:
        # Model pilot kodunu yanlış büyük/küçük harfle yazabiliyor (örn. "LEc")
        joined = re.sub(
            rf"\b{re.escape(driver_code)}\b", driver_code.upper(), joined, flags=re.IGNORECASE
        )
    return joined


# ─── Sistem promptları ───────────────────────────────────────────────────────

FORMAT_RULES = """
Biçim kuralları: Düz metin yaz. Markdown KULLANMA — yıldız (**), başlık (#),
madde işareti (- veya •) veya numaralı liste (1. 2. 3.) ASLA kullanma, satır başı
yapma. Akıcı, doğru yazım kuralları ile bitmiş cümlelerden oluşan TEK bir paragraf
yaz ve belirtilen cümle sayısını AŞMA. Türkçe kelimeleri doğru yaz (örn. "sektör",
"pilotun", "hızlı") — imla hatası, eksik harf veya hatalı karakter kullanma,
başka dilden kelime sızdırma. Sana veride bir pilot kodu belirtilmişse SADECE o
kodu kullan ve pilotun gerçek adını YAZMA (kod-isim eşleşmesini hatalı bilebilirsin).
Veride pilot kodu belirtilmemişse hiçbir pilot kodu veya ismi ÜRETME — sadece
"pilot" kelimesiyle anlat. Cümleyi her zaman tam bitir, yarım cümle ile bırakma.
""".strip()

BEGINNER_SYS = (
    """
Sen bir Formula 1 yorumcususun. F1'i yeni tanıyan birine anlatıyorsun.
Kurallar:
- Sade, günlük Türkçe kullan. Hiç teknik jargon yok.
- "DRS" yerine "arka kanat açık", "frenleme noktası" yerine "fren anı" de.
- En fazla 2-3 kısa, heyecanlı cümle. Pilotun o anda ne yaptığını anlat.
""".strip() + "\n" + FORMAT_RULES
)

EXPERT_SYS = (
    """
Sen bir F1 telemetri mühendisisin. Veriyi teknik derinlikte analiz et.
Aşağıdaki konulardan SADECE en alakalı 2-3'ünü seç ve bunlara odaklan:
frenleme noktası, trail braking, ERS konuşlandırma, traksiyon limiti,
tyre thermal management, apex hızı, minimum köşe hızı, delta analizi.
Konuların tamamını sırayla ele ALMA — sadece en önemlilerini seç.
En fazla 4-5 teknik cümle, tek paragraf. Tam terminoloji kullan.
""".strip() + "\n" + FORMAT_RULES
)


# ─── Kural Tabanlı Yorum ─────────────────────────────────────────────────────

def _rule_based(snapshot: dict, mode: str) -> str:
    """
    Telemetri değerlerine göre önceden yazılmış akıllı yorumlar üretir.
    Groq / Anthropic key yoksa bu devreye girer.
    """
    speed    = snapshot.get("speed") or 0
    throttle = snapshot.get("throttle") or 0
    brake    = snapshot.get("brake") or 0
    gear     = snapshot.get("gear") or 0
    drs      = snapshot.get("drs") or 0
    rpm      = snapshot.get("rpm") or 0
    dist_m   = snapshot.get("dist_m") or 0

    is_drs    = drs > 0
    is_brake  = brake > 20
    is_full_throttle = throttle > 90
    is_coasting = throttle < 10 and brake < 10
    is_high_speed = speed > 280
    is_low_speed  = speed < 120
    is_high_rpm   = rpm > 11_000
    is_low_gear   = gear <= 3
    is_high_gear  = gear >= 7

    if mode == "beginner":
        # ── Frenleme ─────────────────────────────────────────────────────
        if brake > 80:
            return (
                f"Pilot bu anda {speed:.0f} km/sa hızdan sert frenleme yapıyor! "
                f"Frenlerin {brake:.0f}% basılı — tam bir yavaşlama noktası. "
                f"{gear}. vitese geçiş yakın."
            )
        if brake > 40:
            return (
                f"Pilotun fren pedeline {brake:.0f}% basıyor, hız {speed:.0f} km/sa'ye düşüyor. "
                f"Köşeye yaklaşıyor, doğru pozisyon için vitesi ayarlıyor."
            )

        # ── DRS açık ─────────────────────────────────────────────────────
        if is_drs and is_full_throttle:
            return (
                f"DRS sistemi açık ve gaz tam! {speed:.0f} km/sa hızla piste hâkim. "
                f"Arka kanat düzlük için açıldı, azami aerodinamik avantaj kullanılıyor. "
                f"Üst geçiş fırsatı varsa şimdi!"
            )

        # ── Tam gaz düzlük ───────────────────────────────────────────────
        if is_full_throttle and is_high_gear and speed > 250:
            return (
                f"Tam gaz! {speed:.0f} km/sa, {gear}. vites, motor {rpm:,.0f} devirde çalışıyor. "
                f"Sürücü gücün tamamını kullanıyor — düzlük bölgesi."
            )

        # ── Köşe çıkışı / traksiyon ──────────────────────────────────────
        if throttle > 60 and is_low_gear and speed < 180:
            return (
                f"Köşe çıkışında gaz {throttle:.0f}% açılıyor, hız {speed:.0f} km/sa. "
                f"{gear}. viteste traksiyon sağlanmaya çalışılıyor. "
                f"Gaz çok erken basılırsa lastikler kayar!"
            )

        # ── Kayma bölgesi ────────────────────────────────────────────────
        if is_coasting and speed > 150:
            return (
                f"{speed:.0f} km/sa'de ne gaz ne fren — pilot \"kayıyor\". "
                f"Frenleme öncesi kısa bir nefes alma anı ya da vites değişimi hazırlığı."
            )

        # ── Yüksek hız virajı ────────────────────────────────────────────
        if is_full_throttle and speed > 200 and gear >= 5:
            return (
                f"{speed:.0f} km/sa tam gaz viraj! Pilot {gear}. viteste köşeyi tam hızla alıyor. "
                f"Bu cesaret ister — sınırda sürüş."
            )

        # ── Genel ───────────────────────────────────────────────────────
        return (
            f"Hız {speed:.0f} km/sa, {gear}. vites, gaz {throttle:.0f}%. "
            f"Pilot {'düzlükte ilerliyor' if speed > 200 else 'teknik bölgede pozisyon alıyor'}."
        )

    else:  # expert mode
        # ── Frenleme tekniği ─────────────────────────────────────────────
        if brake > 70:
            trail = "Trail braking uygulanıyor" if brake < 95 else "Sabit maksimum frenleme"
            return (
                f"Frenleme noktası: {dist_m:.0f}m, giriş hızı {speed:.0f} km/sa. "
                f"{trail}, fren baskısı {brake:.0f}%. "
                f"Vites {gear} — ideal frenleme mesafesi ve baskı dağılımı analiz edilmeli."
            )

        # ── DRS + ERS ────────────────────────────────────────────────────
        if is_drs and is_full_throttle and is_high_speed:
            return (
                f"DRS aktif, {speed:.0f} km/sa, {gear}. vites. "
                f"Motor {rpm:,.0f} rpm — ERS harvest bölgesi sona ermiş olabilir, "
                f"deploy modu aktif. Aero drag %15–20 azalmış durumda."
            )

        # ── Tam gaz ──────────────────────────────────────────────────────
        if is_full_throttle and is_high_rpm:
            return (
                f"{speed:.0f} km/sa, {rpm:,.0f} rpm, {gear}. vites, gaz {throttle:.0f}%. "
                f"Motor limitinde çalışıyor. ERS deploy aktifse ek 160 hp katkı beklenir. "
                f"Lastik termal yükü kritik — tyre deg bu bölgede en yüksek."
            )

        # ── Köşe çıkışı ─────────────────────────────────────────────────
        if throttle > 50 and is_low_gear:
            return (
                f"Traksiyon fazı: {speed:.0f} km/sa, {gear}. vites, gaz kademeli açılıyor ({throttle:.0f}%). "
                f"Wheel spin riski var — TCU (Traction Control Unit) devrede. "
                f"Optimal çıkış için minimum köşe hızı (MCO) korunmalı."
            )

        # ── Genel teknik ─────────────────────────────────────────────────
        return (
            f"Telemetri: {speed:.0f} km/sa | Gaz {throttle:.0f}% | "
            f"Fren {brake:.0f}% | {gear}. vites | {rpm:,.0f} rpm | "
            f"DRS {'aktif' if is_drs else 'pasif'}. "
            f"{'Yüksek hız bölgesi — aerodinamik yük kritik.' if speed > 250 else 'Teknik bölge — mekanik grip ön planda.'}"
        )


# ─── Groq yorum ──────────────────────────────────────────────────────────────

async def _groq_interpret(content: str, system: str) -> str:
    from groq import AsyncGroq
    client = AsyncGroq(api_key=settings.groq_api_key)
    resp = await client.chat.completions.create(
        # 70b model — 8b-instant'tan çok daha akıcı Türkçe üretiyor
        model="llama-3.3-70b-versatile",
        max_tokens=1024,
        # Düşük temperature — yüksek değerlerde model bazen yabancı dilden
        # kelime/karakter sızdırıyor (örn. "tốcaklık", "jeszcze")
        temperature=0.3,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": content},
        ],
    )
    return resp.choices[0].message.content or ""


# ─── Anthropic yorum ─────────────────────────────────────────────────────────

async def _anthropic_interpret(content: str, system: str) -> str:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    msg = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=550,
        system=system,
        messages=[{"role": "user", "content": content}],
    )
    return msg.content[0].text if msg.content else ""


# ─── Nokta Karşılaştırma — Kural Tabanlı ────────────────────────────────────

def _rule_based_compare(driver_a: str, driver_b: str,
                         snap_a: dict, snap_b: dict, mode: str) -> str:
    """
    İki pilotun aynı mesafedeki anlık telemetrisini karşılaştırır.
    Hangi pilot daha erken frenledi, daha çok gaz bastı, DRS farkı var mı?
    """
    dist   = snap_a.get("dist_m") or snap_b.get("dist_m") or 0
    spd_a  = snap_a.get("speed")    or 0
    spd_b  = snap_b.get("speed")    or 0
    thr_a  = snap_a.get("throttle") or 0
    thr_b  = snap_b.get("throttle") or 0
    brk_a  = snap_a.get("brake")    or 0
    brk_b  = snap_b.get("brake")    or 0
    drs_a  = (snap_a.get("drs")  or 0) > 0
    drs_b  = (snap_b.get("drs")  or 0) > 0
    gear_a = snap_a.get("gear")  or 0
    gear_b = snap_b.get("gear")  or 0
    rpm_a  = snap_a.get("rpm")   or 0
    rpm_b  = snap_b.get("rpm")   or 0

    spd_diff  = spd_a  - spd_b
    thr_diff  = thr_a  - thr_b
    brk_diff  = brk_a  - brk_b

    parts: list[str] = []

    if mode == "beginner":
        parts.append(f"📍 {dist:.0f}m noktasında:")

        # Hız
        if abs(spd_diff) < 5:
            parts.append(f"Her iki pilot da benzer hızda ({spd_a:.0f} km/sa).")
        elif spd_diff > 0:
            parts.append(f"{driver_a} {spd_diff:.0f} km/sa daha hızlı ({spd_a:.0f} vs {spd_b:.0f}).")
        else:
            parts.append(f"{driver_b} {-spd_diff:.0f} km/sa daha hızlı ({spd_b:.0f} vs {spd_a:.0f}).")

        # Fren
        if brk_a > 20 and brk_b > 20:
            if abs(brk_diff) < 10:
                parts.append("İkisi de bu noktada fren pedalına basıyor.")
            elif brk_diff > 0:
                parts.append(f"{driver_a} daha sert frenleme yapıyor (%{brk_a:.0f} vs %{brk_b:.0f}).")
            else:
                parts.append(f"{driver_b} daha sert frenleme yapıyor (%{brk_b:.0f} vs %{brk_a:.0f}).")
        elif brk_a > 20 and brk_b < 10:
            parts.append(f"{driver_a} fren yapıyor (%{brk_a:.0f}), {driver_b} ise gaz basıyor — farklı çizgiler!")
        elif brk_b > 20 and brk_a < 10:
            parts.append(f"{driver_b} fren yapıyor (%{brk_b:.0f}), {driver_a} ise gaz basıyor — farklı çizgiler!")

        # Gaz
        if thr_a > 80 and thr_b > 80:
            parts.append("İkisi de tam gaz.")
        elif abs(thr_diff) > 25:
            faster_thr = driver_a if thr_diff > 0 else driver_b
            parts.append(f"{faster_thr} çok daha erken gazı açıyor.")

        # DRS farkı
        if drs_a and not drs_b:
            parts.append(f"Avantaj: {driver_a}'nın arka kanadı açık, {driver_b}'ninki kapalı!")
        elif drs_b and not drs_a:
            parts.append(f"Avantaj: {driver_b}'nın arka kanadı açık, {driver_a}'nınki kapalı!")

    else:  # expert
        parts.append(f"Telemetri karşılaştırması @ {dist:.0f}m:")
        parts.append(
            f"{driver_a}: {spd_a:.0f}km/sa | Gaz {thr_a:.0f}% | Fren {brk_a:.0f}% | "
            f"{gear_a}.vites | {rpm_a:,.0f}rpm | DRS {'ON' if drs_a else 'OFF'}"
        )
        parts.append(
            f"{driver_b}: {spd_b:.0f}km/sa | Gaz {thr_b:.0f}% | Fren {brk_b:.0f}% | "
            f"{gear_b}.vites | {rpm_b:,.0f}rpm | DRS {'ON' if drs_b else 'OFF'}"
        )

        # Delta
        faster = driver_a if spd_diff >= 0 else driver_b
        delta_spd = abs(spd_diff)
        if delta_spd > 3:
            parts.append(f"Hız delta: {delta_spd:.1f} km/sa — {faster} avantajlı.")
        if abs(brk_diff) > 10:
            harder = driver_a if brk_diff > 0 else driver_b
            parts.append(f"Frenleme: {harder} %{abs(brk_diff):.0f} daha agresif fren uyguluyor.")
        if abs(thr_diff) > 15:
            earlier = driver_a if thr_diff > 0 else driver_b
            parts.append(f"Traksiyon: {earlier} gazı daha erken açıyor (+{abs(thr_diff):.0f}% fark).")
        if drs_a != drs_b:
            drs_pilot = driver_a if drs_a else driver_b
            parts.append(f"DRS asimetrisi: {drs_pilot} açık, rakip kapalı.")
        if gear_a != gear_b:
            parts.append(
                f"Vites farkı: {driver_a} {gear_a}. vites, {driver_b} {gear_b}. vites — "
                f"farklı frenleme/ivmelenme stratejisi."
            )

    return " ".join(parts)


# ─── Public API ──────────────────────────────────────────────────────────────

async def interpret_point_comparison(
    driver_a: str, driver_b: str,
    snap_a: dict, snap_b: dict,
    mode: str = "beginner",
) -> str:
    """
    İki pilotun PİSTİN AYNI NOKTASINDA anlık davranışını karşılaştırır.
    """
    cache_k = _cache_key({
        "fn": "point_compare", "mode": mode,
        "a": driver_a, "b": driver_b,
        **{f"a_{k}": v for k, v in snap_a.items()},
        **{f"b_{k}": v for k, v in snap_b.items()},
    })
    cached = await cache_get(cache_k)
    if cached:
        return cached["text"]

    dist = snap_a.get("dist_m") or snap_b.get("dist_m") or 0

    if mode == "beginner":
        system = (
            "Sen bir F1 yorumcususun. İki pilotun pistinin AYNI noktasındaki anlık davranışını "
            "karşılaştırıyorsun. Sade Türkçe kullan, jargon yok. "
            "Hangisi daha hızlı, hangisi daha erken fren yapıyor, farklılıklar neler? "
            "3-4 kısa cümle."
        )
    else:
        system = (
            "Sen bir F1 telemetri mühendisisin. İki pilotun aynı pisteki noktadaki anlık "
            "telemetrisini teknik olarak karşılaştır. "
            "Hız delta, frenleme noktası farkı, gaz açılma zamanı, vites seçimi, DRS durumu. "
            "4-5 teknik cümle."
        )

    content = (
        f"Pist noktası: {dist:.0f}m\n\n"
        f"{driver_a}:\n"
        f"  Hız: {snap_a.get('speed')} km/sa | Gaz: %{snap_a.get('throttle')} | "
        f"Fren: %{snap_a.get('brake')} | Vites: {snap_a.get('gear')} | "
        f"DRS: {'Açık' if (snap_a.get('drs') or 0) > 0 else 'Kapalı'} | "
        f"RPM: {snap_a.get('rpm')}\n\n"
        f"{driver_b}:\n"
        f"  Hız: {snap_b.get('speed')} km/sa | Gaz: %{snap_b.get('throttle')} | "
        f"Fren: %{snap_b.get('brake')} | Vites: {snap_b.get('gear')} | "
        f"DRS: {'Açık' if (snap_b.get('drs') or 0) > 0 else 'Kapalı'} | "
        f"RPM: {snap_b.get('rpm')}\n\n"
        "Bu iki pilotu karşılaştır — aynı noktada nasıl farklı davranıyorlar?"
    )

    text = ""
    if _groq_ok():
        try:
            text = await _groq_interpret(content, system)
        except Exception as e:
            logger.warning("Groq point compare başarısız: %s", e)
    if not text and _anthropic_ok():
        try:
            text = await _anthropic_interpret(content, system)
        except Exception as e:
            logger.warning("Anthropic point compare başarısız: %s", e)
    if not text:
        text = _rule_based_compare(driver_a, driver_b, snap_a, snap_b, mode)
    else:
        text = _clean_ai_text(text)

    await cache_set(cache_k, {"text": text}, ttl_seconds=600)
    return text


async def interpret_telemetry(snapshot: dict, mode: str = "beginner", driver_code: str | None = None) -> str:
    cache_k = _cache_key({"fn": "interpret", "mode": mode, "driver": driver_code, **snapshot})
    cached = await cache_get(cache_k)
    if cached:
        return cached["text"]

    system = BEGINNER_SYS if mode == "beginner" else EXPERT_SYS
    driver_line = f"Pilot kodu: {driver_code}\n" if driver_code else ""
    content = (
        f"{driver_line}"
        f"Hız: {snapshot.get('speed')} km/sa | "
        f"Gaz: %{snapshot.get('throttle')} | "
        f"Fren: %{snapshot.get('brake')} | "
        f"Vites: {snapshot.get('gear')} | "
        f"DRS: {'Açık' if snapshot.get('drs') else 'Kapalı'} | "
        f"RPM: {snapshot.get('rpm')} | "
        f"Mesafe: {snapshot.get('dist_m', '?')} m\n"
        "Bu F1 telemetri anını yorumla."
    )

    text = ""
    source = "rule"

    if _groq_ok():
        try:
            text = await _groq_interpret(content, system)
            source = "groq"
        except Exception as e:
            logger.warning("Groq başarısız, kural tabanlıya geçiliyor: %s", e)

    if not text and _anthropic_ok():
        try:
            text = await _anthropic_interpret(content, system)
            source = "anthropic"
        except Exception as e:
            logger.warning("Anthropic başarısız, kural tabanlıya geçiliyor: %s", e)

    if not text:
        text = _rule_based(snapshot, mode)
        source = "rule"
    else:
        text = _clean_ai_text(text, driver_code=driver_code)

    logger.debug("Yorum kaynağı: %s | mod: %s", source, mode)
    ttl = 3600 if source != "rule" else 300
    await cache_set(cache_k, {"text": text}, ttl_seconds=ttl)
    return text


# ─── Canlı Yarış Yorumu ──────────────────────────────────────────────────────

RACE_BEGINNER_SYS = (
    "Sen canlı bir F1 yarışını yorumlayan bir spikersın. Anlık yarış durumuna "
    "bakarak kısa, heyecanlı, sade Türkçe bir yorum yap. Maksimum 2 cümle.\n" + FORMAT_RULES
)

RACE_EXPERT_SYS = (
    "Sen canlı bir F1 yarışını yorumlayan teknik bir analistsin. Anlık yarış "
    "durumuna bakarak kısa, teknik bir yorum yap. Maksimum 2 cümle.\n" + FORMAT_RULES
)


async def interpret_live_race(context: dict, mode: str = "beginner") -> str:
    """Anlık yarış durumunu (lider, ilk 3 araç arası farklar vb.) yorumlar."""
    system = RACE_BEGINNER_SYS if mode == "beginner" else RACE_EXPERT_SYS
    content = f"Anlık durum: {json.dumps(context, ensure_ascii=False)}"

    text = ""
    if _groq_ok():
        try:
            text = await _groq_interpret(content, system)
        except Exception as e:
            logger.warning("Groq canlı yorum başarısız: %s", e)
    if not text and _anthropic_ok():
        try:
            text = await _anthropic_interpret(content, system)
        except Exception as e:
            logger.warning("Anthropic canlı yorum başarısız: %s", e)
    if not text:
        leader = context.get("leader")
        text = f"Yarış devam ediyor, #{leader} numaralı araç şu an liderlikte. Pist üzerinde mücadele sürüyor."
    else:
        text = _clean_ai_text(text)

    return text


async def summarize_lap(lap_info: dict, key_moments: list[dict], mode: str = "beginner") -> str:
    cache_k = _cache_key({"fn": "lap_summary", "mode": mode, "lap": lap_info})
    cached = await cache_get(cache_k)
    if cached:
        return cached["text"]

    system = BEGINNER_SYS if mode == "beginner" else EXPERT_SYS
    moments_text = "\n".join(
        f"- {m.get('point','?')}: Giriş {m.get('speed_entry')} km/sa → Min {m.get('speed_min')} km/sa"
        for m in key_moments[:5]
    )
    dur = lap_info.get("duration")
    compound = lap_info.get('compound') or 'Bilinmiyor'
    content = (
        f"Tur: #{lap_info.get('number')} | "
        f"Süre: {formatLapTime(dur) if dur else '?'} | "
        f"Lastik: {compound}\n"
        f"S1={lap_info.get('sector1','?')}s  S2={lap_info.get('sector2','?')}s  S3={lap_info.get('sector3','?')}s\n"
        f"Önemli anlar:\n{moments_text}\n"
        "Bu tur hakkında genel analiz yap — pilotun güçlü ve zayıf noktalarını belirt."
    )

    text = ""
    if _groq_ok():
        try:
            text = await _groq_interpret(content, system)
        except Exception as e:
            logger.warning("Groq lap summary başarısız: %s", e)
    if not text and _anthropic_ok():
        try:
            text = await _anthropic_interpret(content, system)
        except Exception as e:
            logger.warning("Anthropic lap summary başarısız: %s", e)
    if not text:
        dur_str = f"{dur:.3f}" if dur else "?"
        text = (
            f"Tur #{lap_info.get('number')}, süre {dur_str}s, lastik: {lap_info.get('compound','?')}. "
            f"Sektörler: S1 {lap_info.get('sector1','?')}s | S2 {lap_info.get('sector2','?')}s | S3 {lap_info.get('sector3','?')}s. "
            f"{len(key_moments)} önemli an tespit edildi."
        )
    else:
        text = _clean_ai_text(text)

    await cache_set(cache_k, {"text": text}, ttl_seconds=3600)
    return text


async def compare_drivers(
    driver_a: str, driver_b: str,
    lap_a: dict, lap_b: dict,
    delta_summary: dict, mode: str = "beginner",
) -> str:
    cache_k = _cache_key({"fn": "compare", "mode": mode, "a": driver_a, "b": driver_b})
    cached = await cache_get(cache_k)
    if cached:
        return cached["text"]

    dur_a = lap_a.get("duration") or 0
    dur_b = lap_b.get("duration") or 0
    gap   = abs(dur_a - dur_b)
    faster = driver_a if dur_a <= dur_b else driver_b

    system = BEGINNER_SYS if mode == "beginner" else EXPERT_SYS
    content = (
        f"{driver_a} vs {driver_b}\n"
        f"{driver_a}: {dur_a:.3f}s | Lastik: {lap_a.get('compound','?')}\n"
        f"{driver_b}: {dur_b:.3f}s | Lastik: {lap_b.get('compound','?')}\n"
        f"Fark: {gap:.3f}s — {faster} daha hızlı\n"
        "Bu karşılaştırmayı yorumla."
    )

    text = ""
    if _groq_ok():
        try:
            text = await _groq_interpret(content, system)
        except Exception as e:
            logger.warning("Groq compare başarısız: %s", e)
    if not text and _anthropic_ok():
        try:
            text = await _anthropic_interpret(content, system)
        except Exception as e:
            logger.warning("Anthropic compare başarısız: %s", e)
    if not text:
        text = (
            f"{faster}, rakibinden {gap:.3f} saniye önde. "
            f"{driver_a} lastik: {lap_a.get('compound','?')}, "
            f"{driver_b} lastik: {lap_b.get('compound','?')}."
        )
    else:
        text = _clean_ai_text(text)

    await cache_set(cache_k, {"text": text}, ttl_seconds=3600)
    return text


async def explain_sectors(
    driver_a: str, driver_b: str,
    sectors: list[dict], compound_a: str | None, compound_b: str | None,
    mode: str = "beginner",
) -> str:
    """Sektör bazlı zaman farklarının olası nedenlerini yorumlar."""
    cache_k = _cache_key({
        "fn": "sector_explain", "mode": mode,
        "a": driver_a, "b": driver_b, "sectors": sectors,
        "ca": compound_a, "cb": compound_b,
    })
    cached = await cache_get(cache_k)
    if cached:
        return cached["text"]

    lines = []
    for s in sectors:
        d = s.get("delta")
        ta, tb = s.get(f"time_{driver_a}"), s.get(f"time_{driver_b}")
        faster = s.get("faster")
        gap = abs(d) if d is not None else None
        lines.append(
            f"Sektör {s['sector']}: {driver_a}={ta}s, {driver_b}={tb}s — "
            f"{faster} {gap:.3f}s daha hızlı" if gap is not None else
            f"Sektör {s['sector']}: veri yok"
        )

    system = BEGINNER_SYS if mode == "beginner" else EXPERT_SYS
    content = (
        f"{driver_a} (lastik: {compound_a or '?'}) ile {driver_b} (lastik: {compound_b or '?'}) "
        f"arasındaki sektör bazlı tur zamanı karşılaştırması:\n"
        + "\n".join(lines)
        + "\nBu sektör farklarının pist üzerinde hangi sürüş davranışlarından "
          "kaynaklanmış olabileceğini yorumla (örn. frenleme noktası, viraj çıkışı, "
          "düzeklik hattı, lastik durumu)."
    )

    text = ""
    if _groq_ok():
        try:
            text = await _groq_interpret(content, system)
        except Exception as e:
            logger.warning("Groq sector explain başarısız: %s", e)
    if not text and _anthropic_ok():
        try:
            text = await _anthropic_interpret(content, system)
        except Exception as e:
            logger.warning("Anthropic sector explain başarısız: %s", e)
    if not text:
        biggest = max(sectors, key=lambda s: abs(s.get("delta") or 0))
        text = (
            f"En büyük fark Sektör {biggest['sector']}'de — {biggest.get('faster')} "
            f"{abs(biggest.get('delta') or 0):.3f}s önde. Bu genellikle frenleme noktası, "
            f"viraj çıkış hızı veya lastik durumundaki farklardan kaynaklanır."
        )
    else:
        text = _clean_ai_text(text)

    await cache_set(cache_k, {"text": text}, ttl_seconds=86_400)
    return text
