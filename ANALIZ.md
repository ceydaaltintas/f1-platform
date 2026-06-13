# F1 Platform — Detaylı Analiz Dokümanı

> Bu doküman, `f1-platform` deposundaki uygulamanın (backend: `f1-backend`, frontend: `f1-frontend`) mimarisini, iş kurallarını ve kullanıcıya sunduğu özellikleri açıklar. Doküman kod incelemesi temel alınarak hazırlanmıştır.

---

## 1. Genel Bakış

F1 Platform, **Formula 1 telemetrisi, canlı yarış takibi ve topluluk etkileşimi** sunan bir web uygulamasıdır. İki ana bileşenden oluşur:

- **f1-backend**: Python/FastAPI tabanlı, asenkron bir REST + WebSocket + SSE API'si. PostgreSQL (kalıcı veri + JSONB cache), Redis (kısa süreli cache, pub/sub, rate limit) ve Celery (zamanlanmış görevler) kullanır.
- **f1-frontend**: React + Vite + TypeScript, TailwindCSS ile stillendirilmiş, PWA (service worker) destekli bir SPA.

Veriler iki dış kaynaktan gelir:
- **Jolpica** (Ergast uyumlu API) → tarihsel sezon/round/şampiyona verileri
- **OpenF1** → oturum bazlı canlı/geçmiş telemetri, pozisyon, pit, hava durumu, yarış kontrolü mesajları

---

## 2. Mimari ve Çalışma Prensibi

### 2.1 Bileşenler

```
                 ┌────────────────────┐
                 │   React Frontend    │
                 │ (Vite, TS, Zustand) │
                 └─────────┬───────────┘
           REST + WS + SSE │
┌──────────────────────────▼─────────────────────────┐
│                  FastAPI Backend                     │
│  /api/v1/{seasons,sessions,telemetry,live,           │
│           standings,ai,community,auth,notifications}│
│  /ws/race/{id}  /ws/community/{id}                   │
└───────┬─────────────┬────────────────┬──────────────┘
        │              │                │
        ▼              ▼                ▼
   PostgreSQL        Redis          Celery Worker+Beat
 (kalıcı veri +   (kısa cache,     (live polling 4s,
  JSONB cache)    pub/sub, rate     post-session sync,
                   limit)           season refresh)
        │                                │
        ▼                                ▼
  Jolpica API                        OpenF1 API
```

### 2.2 İki Katmanlı Cache Stratejisi

Uygulamanın en temel mimari kararı **"bitmiş veri değişmez"** ilkesidir:

| Katman | Kullanım Alanı | Süre |
|---|---|---|
| **Redis (TTL'li cache)** | Aktif/güncel sezon verileri, sıralama, hava durumu, anlık sonuçlar | Saniyeler–saatler (aşağıda detaylı) |
| **PostgreSQL JSONB cache** (`OpenF1LapsCache`, `OpenF1StintsCache`, `OpenF1CarDataCache`, `JolpicaSeasonCache`, `EnergyAnalysisCache`) | **Bitmiş (finished)** oturum/sezon verileri | **TTL yok — kalıcı.** Bir kez OpenF1/Jolpica'dan çekilir, bir daha asla tekrar istenmez |

Bu sayede:
- Geçmiş bir yarışın telemetrisi/turları ilk istek sonrası DB'den **~5ms** içinde döner.
- Dış API'lere (rate-limit'li) sadece "ilk kez görülen" veri için istek atılır.
- `db_cache.py` bu mantığın merkezi: `get_laps`, `get_stints`, `get_car_data`, `get_season_all_results` fonksiyonları "DB'de var mı → dön, yoksa API'den çek → DB'ye yaz → dön" akışını uygular.

### 2.3 Veri Senkronizasyon Akışları

1. **Sezon senkronizasyonu** — `POST /api/v1/seasons/{year}/sync`
   - `sync_full_season()`: sezon → takımlar → pilotlar → round'lar → (tamamlanmış round'lar için) OpenF1 session kayıtları.
   - Round'un `meeting_key`'i yoksa 3 kademeli eşleştirme ile bulunur: `meeting_number` → `meeting_name` alt-dize eşleşmesi → `circuit_short_name`/`locality` eşleşmesi (2026 tipi `meeting_number`'sız veriler için).

2. **Canlı yarış polling** (`poll_live_session`, Celery Beat — **her 4 saniyede**)
   - Aktif session_key Redis'ten okunur (`f1:active_session`).
   - OpenF1'den `/position`, `/intervals`, `/race_control`, `/team_radio` çekilir.
   - Her pilotun **en son** kaydı alınır (deduplikasyon), Redis pub/sub kanallarına (`f1:live:{sk}:{kind}`) yayınlanır ve 120s TTL'li snapshot olarak saklanır.
   - Race control mesajları sadece **60 saniyeden** yeni ise, takım radyosu sadece **30 saniyeden** yeni ise yayınlanır.

3. **Canlı oturum tespiti** (`detect_and_activate_live_session`, **her dakika**)
   - Zaten aktif oturum varsa atlanır.
   - `auto_detect_live_session()`: OpenF1'de `date_start <= now <= date_end` olan oturum aranır.
   - Bulunursa DB'deki ilgili `Session.status = "active"` yapılır ve Redis'e 6 saatlik TTL ile aktif oturum kaydedilir.

4. **Oturum sonrası senkronizasyon** (`sync_session_laps`, tetiklenmeli/Celery)
   - OpenF1'den tüm pilotların tur verileri çekilir, `Lap` tablosuna yazılır (compound bilinmeyen değerse `"UNKNOWN"`a normalize edilir).
   - `stints` verisinden `PitStop` kayıtları türetilir (`lap_start` → `lap_number`, `compound` → `tyre_out`).
   - `Session.status = "finished"` yapılır, ilgili Redis cache anahtarları (`session_laps:*`, `pit_stops:*`) silinir.

5. **Gece görevleri**
   - `sync_completed_sessions` (her gece): `status != "finished"` AND `race_date <= bugün` AND `session_key` dolu olan oturumlar için lap-sync tetikler.
   - `sync_race_weekend_sessions` (Cuma–Pazar): bu haftanın round'u için `round_status`tan bağımsız OpenF1 session'larını senkronize eder; geçmiş tarihli session'lar için lap-sync tetikler.
   - `refresh_current_season_rounds` (Pazartesi): aktif sezonun tüm round'larının `round_status`'unu bugünün tarihine göre yeniden hesaplar (`completed`/`upcoming`).

---

## 3. Veri Modeli (Özet)

| Tablo | Açıklama |
|---|---|
| `Season` | `year` (unique), `is_current` — **her zaman tek bir sezon `is_current=True` olabilir** |
| `Team` | `jolpica_id` (unique), `name`, `nationality`, `color_hex` (varsayılan `#FFFFFF`) |
| `Driver` | `jolpica_id` (unique), `code` (3 harf), isim, doğum tarihi, `current_team_id` |
| `Round` | `season_id`, `round_number`, `circuit_name`, `race_date`, `meeting_key` (OpenF1), `round_status` ∈ {`upcoming`, `completed`} |
| `Session` | `round_id`, `type` ∈ {practice1/2/3, qualifying, sprint_qualifying, sprint, race}, `status` ∈ {`upcoming`, `active`, `finished`}, `session_key` (OpenF1, unique) |
| `DriverSession` | Oturum bazlı sonuç: grid/finish pozisyonu, puan, durum, en hızlı tur sırası |
| `Lap` | Tur süresi, sektörler, `compound` ∈ {SOFT, MEDIUM, HARD, INTERMEDIATE, WET, UNKNOWN}, lastik ömrü, kişisel en iyi/pit bayrakları |
| `PitStop` | Pit süresi, garaj süresi, giren/çıkan lastik |
| **Kalıcı cache tabloları** | `OpenF1LapsCache`, `OpenF1StintsCache`, `OpenF1CarDataCache` (driver_number=-1 → pist haritası noktaları, =0 → tüm araç pozisyonları sentinel'i), `JolpicaSeasonCache`, `EnergyAnalysisCache` |
| `User` | `role` ∈ {user, moderator, admin}, `is_active`, bcrypt hash |
| `Comment` / `Poll` / `PollVote` | Topluluk verileri (UUID PK) |

---

## 4. İş Kuralları

### 4.1 Sezon / Round / Oturum Durum Makinesi

- **Aktif sezon tespiti**: `_determine_current_season()` → Mart–Kasım arası içinde bulunulan yıl, Ocak–Şubat'ta ise **önceki yıl** aktif sezon kabul edilir (F1 takvimi mart başlangıçlı).
- **Round durumu**: `race_date <= bugün` → `completed`, aksi halde `upcoming`. Her sync'te yeniden hesaplanır.
- **Session durumu**: `session_date < şu_an` → `finished`, aksi halde `upcoming`. **`active` durumu hiçbir zaman otomatik sync ile ezilmez** — sadece canlı tespit görevi tarafından set edilir/temizlenir.
- Tek bir sezon `is_current=True` olabilir; yeni aktif sezon sync edildiğinde diğerlerinin bayrağı `False`'a çekilir.

### 4.2 Cache TTL Politikaları (Redis)

| Veri | TTL | Not |
|---|---|---|
| Sezon listesi/standings | 300s (aktif sezon) / 86 400s (geçmiş sezon) | `_season_cache_ttl`, `_ttl` |
| Canlı timing (`/live/{id}/timing`) | 6s | |
| Hava durumu | 30s | |
| Race control | 8s, en yeni 40 mesaj | |
| Strateji simülasyonu (`/live/{id}/simulate`) | 10s | |
| Oturum sonuçları (`/sessions/{id}/results`) | 600s | |
| Pit stop listesi | 600s | |
| Tur verileri (`/sessions/{id}/laps`) | 86 400s | bitmişse — DB cache'e de yazılabilir |
| Telemetri | 86 400s (bitmiş) / 3600s (devam ediyor) | |
| Pist haritası, tüm araç pozisyonları | 7 gün | DB sentinel kayıtlarıyla birlikte |
| Leaderboard (race, Jolpica) | 7 gün; OpenF1 fallback | 120s |
| AI yorum (rule-based) | 300s | |
| AI yorum (Groq/Anthropic) | 3600s | MD5 hash'lenmiş payload anahtarı |
| Push subscription | 30 gün | |
| Anlık tepkiler (reactions) | 4 saat | Redis list |

### 4.3 Lastik (Tyre) Kuralları

`TYRE_DEG` sabitleri (`strategy.py`):

| Bileşen | Temel pace farkı | Aşınma/tur | Cliff (tur) |
|---|---|---|---|
| SOFT | 0.00s | 0.065 | 22 |
| MEDIUM | 0.35s | 0.035 | 35 |
| HARD | 0.75s | 0.018 | 55 |
| INTERMEDIATE | 2.00s | 0.080 | 20 |
| WET | 4.00s | 0.100 | 15 |

- **Cliff sonrası ceza**: Lastik "cliff" turunu geçince aşınma etkisi **1.5×** katsayıyla cezalandırılır.
- **F1 2-bileşen kuralı** (`_validate_two_compound_rule`): Kuru lastik (SOFT/MEDIUM/HARD) kullanılan senaryolarda **en az 2 farklı bileşen** zorunludur — tek bileşenle biten senaryolar geçersizdir.
- `_different()` fonksiyonu, kalan tur sayısına göre farklı bir bileşen seçer (örn. çok az tur kaldıysa SOFT tercih edilir).

### 4.4 Pit Stop / Strateji Sabitleri

- `PIT_LOSS_SECONDS = 22.0` — pit girişinin toplam süre kaybı.
- `SAFETY_CAR_DELTA = -15.0` — Safety Car altında pit yapmanın getirdiği kazanç (negatif kayıp).
- **Senaryo üretimi** (`generate_scenarios`, en fazla 6 senaryo):
  1. **1-Stop** — kalan turun ~%55'inde pit
  2. **Erken pit (undercut)** — ortalama-7 tur
  3. **Geç pit (overcut)** — ortalama+7 tur
  4. **Undercut 2-stop** — sadece `total_laps >= 40` ise
  5. **Klasik 2-stop (3 bileşen)** — sadece `total_laps >= 40` ise
  6. **Özel pit** — kullanıcının verdiği `alternate_pit_lap` geçerliyse
- Canlı simülasyon (`/live/{id}/simulate`):
  - `laps_to_catch` her rakip için pace farkına göre hesaplanır.
  - `pit_scenario`: pit sonrası pozisyon, geçilecek/geçilen araç sayısı.
  - `optimal_pit.safe_to_pit_now`: öndeki aracın boşluğu `gap_margin >= PIT_LOSS_SECONDS (22.0)` ise pit "güvenli" sayılır.
  - Tur farkı olan araçlar (lapped) özel olarak işlenir.

### 4.5 2026 Enerji Yönetimi Modeli (MGU-K Simülasyonu)

`energy.py` — **gerçek SoC verisi herkese açık olmadığından, bu bir fizik tahmin modelidir**; mutlak değerler yaklaşık, pilotlar arası **karşılaştırmalar güvenilir**.

Sabitler:
- `MGU_K_MAX_KW = 350.0` — maksimum MGU-K gücü
- `ENERGY_STORE_KJ = 4000.0` — batarya kapasitesi
- `LAP_DEPLOY_LIMIT = 900.0` kJ — tur başına deploy limiti (normalize referansı)
- `REGEN_EFFICIENCY = 0.72`, `DEPLOY_EFFICIENCY = 0.88`
- `AERO_SPEED_THRESH = 280.0` km/h ve `AERO_ACCEL_MULT = 1.18` — **X-mode (aktif aero)** tespiti: hız eşik üstündeyken ivmelenme çarpanı ile X-mode zonları belirlenir.
- `DEPLOY_THROTTLE_THRESH = 85` — gaz pedalı bu eşiğin üstündeyse "deploy" (enerji harcama) zonu.
- `REGEN_BRAKE_THRESH = 15` — fren bu eşiğin üstündeyse "regen" (enerji toplama) zonu.

`compute_energy_analysis()` çıktısı:
- `soc_curve` — son 500 nokta, batarya doluluk yüzdesi
- `deploy_zones` / `regen_zones` — en fazla 100 zon
- `per_lap` — tur bazlı deploy/regen/net kJ, verimlilik %, X-mode sayısı (LAP_DEPLOY_LIMIT'e normalize)
- `profile` — agresiflik %, harvest verimliliği %, X-mode zon sayısı, ortalama deploy/regen, en iyi segmentler, analiz edilen toplam tur sayısı

Bu analiz, oturum bitmişse `EnergyAnalysisCache` tablosuna kalıcı olarak yazılır; bir kez hesaplanır, bir daha hesaplanmaz.

### 4.6 AI Yorum Servisi — 3 Kademeli Fallback

Öncelik sırası: **1. Groq (ücretsiz) → 2. Anthropic Claude (ücretli) → 3. Kural tabanlı Türkçe şablonlar**

- `_groq_ok()` / `_anthropic_ok()`: API key uzunluk/placeholder kontrolleri ile mevcut olup olmadığını doğrular.
- Groq modeli: `llama-3.1-8b-instant`
- Anthropic modeli: `claude-sonnet-4-20250514`
- Her çağrı `source` alanıyla hangi kademenin yanıt verdiğini belirtir (`groq` / `anthropic` / `rule`).
- Cache anahtarı, payload'ın MD5 hash'i (`_cache_key`).
- TTL: kural-tabanlı yanıtlar 300s, AI yanıtları 3600s.
- `BEGINNER_SYS` / `EXPERT_SYS` — moda göre farklı Türkçe sistem promptları (başlangıç seviyesi sade dil; uzman seviyesi undercut/overcut, lastik cliff'i, lastik deltası gibi teknik terimler).
- Servis 4 ana fonksiyon sunar: `interpret_point_comparison`, `interpret_telemetry`, `summarize_lap`, `compare_drivers` — hepsi aynı 3-kademeli fallback'i kullanır.
- Strateji simülatöründeki AI yorumları (`add_ai_narrative`) sadece Claude kullanır, Redis'te 1 saat cache'lenir.

### 4.7 Rate Limiting Kuralları (Topluluk)

Redis tabanlı sliding-window (`INCR` + `EXPIRE`):

| İşlem | Limit |
|---|---|
| Yorum gönderme | 1 / 10 saniye |
| Yorum upvote | 1 / 2 saniye (kendi yorumuna upvote **yasak**, 400 döner) |
| Anket oluşturma | 1 / 60 saniye |
| Anket oylama | 400 — kapalıysa, zaten oy verilmişse, veya geçersiz seçenekse |
| Anlık tepki (reaction) | 1 / 3 saniye |

### 4.8 Kimlik Doğrulama ve Yetkilendirme

- JWT (access + refresh), `jwt_algorithm = HS256`.
- `access_token_expire_minutes = 30`, `refresh_token_expire_days = 7`.
- Refresh token sadece `type == "refresh"` olan token ile kullanılabilir; access endpoint'leri `type == "access"` bekler.
- Kayıt: e-posta veya kullanıcı adı zaten varsa **409**.
- Giriş: hatalı kimlik bilgisi **401**, pasif kullanıcı (`is_active=False`) **403**.
- Roller: `user` (varsayılan), `moderator`, `admin`. Admin-only endpoint'ler: `/live/activate`, `/live/auto_activate`, `/live/deactivate`, `sync_cache`, `sync_all_finished_sessions`.
- **AI yorumları için giriş gerekmez** (frontend login ekranında belirtiliyor).

### 4.9 Diğer Kurallar

- Global hata yakalayıcı: beklenmeyen hatalarda HTTP 503 ve `{"detail": "Geçici hata, lütfen tekrar deneyin."}` döner (Türkçe, kullanıcı dostu mesaj — teknik detay sızdırılmaz).
- Sezon sync endpoint'i yıl aralığını doğrular: **1950 ≤ year ≤ (mevcut yıl + 1)**.
- Quali turları filtrelemesi: `/available_laps/{driver_code}` → en hızlı turun **%108**'i içindeki turlar gösterilir (`threshold = times[0] * 1.08`).
- Teammate pace karşılaştırması: yarış için orta %80 turların medyanı, sıralama turu için en hızlı tur kullanılır.
- `ensure_laps_synced`: bitmiş bir oturumda 15'ten az pilotun lap cache'i varsa otomatik tam senkronizasyon tetiklenir (leaderboard/pace gibi tüm-pilot gereken endpoint'lerde).

---

## 5. Canlı Yarış Sistemi (WebSocket / SSE)

### 5.1 `/ws/race/{session_id}`

- Bağlanan istemci, Redis'teki aktif oturum ile `session_id` eşleşmiyorsa **kod 4004** ile bağlantı reddedilir (`POST /api/v1/live/activate` ile aktif edilmesi istenir).
- Eşleşirse `connected` mesajı + abone olunan kanallar (`timing`, `positions`, `race_control`, `radio`) gönderilir.
- Geç bağlanan istemcilere her kanalın **son snapshot'ı** (`is_snapshot: true` ile) gönderilir.
- Arka planda bir Redis pub/sub dinleyicisi, `f1:live:{session_key}:{kind}` kanallarındaki mesajları doğrudan istemciye iletir.
- İstemci `{"type": "subscribe", "channels": [...]}` ile kanal aboneliğini güncelleyebilir, `{"type":"ping"}` ile `pong` alabilir.

### 5.2 `/ws/community/{session_id}`

- Salt-okunur kanal: `comment`, `poll_new`, `poll_update`, `reaction`.
- Yazma işlemleri (yorum/oy/anket) REST üzerinden yapılır; REST handler Redis'e (`f1:community:{session_id}:{kind}`) yayınlar, bu gateway dinleyip istemcilere iletir.

### 5.3 SSE — Canlı Yorum

- `GET /live/{session_id}/commentary?mode=beginner|expert` — her **30 saniyede** bir Claude tabanlı, ilk 3 sıradaki araç farklarına dayalı 2 cümlelik Türkçe yorum akışı.

---

## 6. Frontend — Sayfalar ve Gösterilen Özellikler

### 6.1 Genel Yapı

- React Router ile sayfalar: `/`, `/season/:year`, `/standings/:year`, `/session/:sessionId`, `/live/:sessionId`, `/login`.
- React Query: `staleTime` 5 dk varsayılan, `retry: 2`, pencere odağında yeniden çekme kapalı.
- `Shell`: Navbar + BottomNav (mobil) + sayfa geçiş animasyonu (`F1Transition`); `/login` sayfasında navigasyon gizli.
- PWA: service worker (`sw.js`) ile çevrimdışı destek; push bildirim aboneliği.

### 6.2 Ana Sayfa (`HomePage`)

- **Canlı Ticker**: aktif sezonu otomatik bulur (`is_current`), pilot sıralamasını (top 10) kayan şerit olarak gösterir.
- **Şampiyona Şeridi**: top-5 pilot puan durumu.
- **3D Küre (RaceGlobe)**: tüm round'ları, gelecek yarışı ve tamamlanan yarışların podyum sonuçlarını gösterir.
- **Canlı Yarış Rozeti**: `/live/status` true ise "CANLI YARIŞ — Takip Et" linki belirir (glow animasyonlu).
- **Sonraki Yarış Kartı**: canlı geri sayım (gün/saat/dakika/saniye), oturum listesi (aktif oturum varsa "CANLI" rozetiyle `/live/{id}`'ye, değilse `/session/{id}`'ye link).
- **Son Yarış Podyumu**: 🥇🥈🥉 ile son tamamlanan yarışın ilk 3'ü.
- **Sezon Kartları**: tamamlanma yüzdesi progress bar'lı, aktif sezon "AKTİF" rozetiyle.
- **Özellik Kartları**: Canlı Yarış (gerçek veya demo), Gerçek Zamanlı Telemetri, AI Destekli Analiz, Pist & Strateji.
- Hiç sezon verisi yoksa: `POST /api/v1/seasons/2026/sync` komutunu gösteren boş-durum kartı.

### 6.3 Sezon Sayfası (`SeasonPage`)

- "Yaklaşanlar" / "Tamamlananlar" sekmeleri.
- Her round kartı: bayrak emoji, tur numarası, durum rozeti (CANLI / TAMAMLANDI / SIRADAKİ / YAKLAŞIYOR), devre adı, tarih.
- Oturum çipleri: aktif → `/live/{id}` (CANLI rozetiyle), bitmiş/yaklaşan → `/session/{id}`.
- "Sezon tamamlandı" boş durumunda "Sonuçlara git" butonuyla Tamamlananlar sekmesine yönlendirme.

### 6.4 Canlı Yarış Sayfası (`LivePage`)

- **Gerçek mod** (`/live/{sessionId}`) ve **Demo mod** (`/live/demo` → sabit Kanada GP, session 25, gerçek final verisi).
- Polling aralıkları: timing 8s (demo: 30s), race control 10s (demo: 60s), hava durumu 30s.
- **Üst durum çubuğu**: CANLI/DEMO rozeti, bayrak durumu (Yeşil/Sarı/Kırmızı/SC/VSC/Damalı — renkli ve emoji'li), hava durumu (pist/hava sıcaklığı, nem, rüzgar yönü+hız, yağmur).
- **Race Control kayan şerit**: bayrak renklerine göre renklendirilmiş mesajlar.
- **Sıralama Tablosu** (sol panel): pozisyon, takım rengi çubuğu, pilot kodu+takım adı, lider farkı (`FARK`), öndeki araca mesafe (`ARALIK`), lastik bileşeni (renkli daire), pit sayısı. Lider'in farkı gri, tur farkı olanlar kırmızı renkte.
- **Pist Haritası**: normalize edilmiş (0-1000) SVG koordinatlarıyla viraj gösterimi.
- **Canlı Simülatör** (`LiveSimulator`): pit stratejisi/yakalama analizleri.
- **Yarış Kontrolü paneli**: son 15 mesaj, zaman damgalı.
- **AI Canlı Yorum** (sadece gerçek yarışta, SSE): 30s'de bir Türkçe yorum; demo modda "sadece canlı yarışta aktif" mesajı.

### 6.5 Oturum Sayfası (`SessionPage`)

4 sekme: **Telemetri**, **Analiz**, **Sıralama**, **Strateji**.

- **Telemetri**: `TelemetryChart` (hız/gaz/fren/RPM — `CHANNELS` tanımlı renk ve aralıklarla), nokta seçimi → `AIInsightPanel` ile AI yorum, `LapSummaryCard`, lastik bileşeni renkleri (`COMPOUND_COLORS`), tur seçimi (`LAP_OPTIONS`: fastest, 1-50).
- **SoC Mini Şerit**: telemetri altında, enerji analizinden gelen `soc_curve` ile "tahmini batarya doluluk" bar grafiği — Dolu (mavi-yeşil) / Düşük (turuncu) / Kritik (kırmızı) / X-mode (beyaz) renk kodlu.
- **Analiz**: `TyreDegradation` (lastik aşınma eğrileri), `TeammatePace` (takım arkadaşı karşılaştırması), `EnergyAnalysis` (2026 enerji profili), `CircuitGuide`, `RaceReplay`.
- **Sıralama**: `SessionLeaderboard`, `DriverRaceSummary`.
- **Strateji**: `StrategySimulator` — pit senaryoları, AI özetleri.
- **Topluluk Paneli**: Yorumlar / Anketler sekmeli (`CommentFeed`, `PollWidget`) — giriş yapmamış kullanıcılar görüntüleyebilir ama etkileşim kısıtlı olabilir.
- `insightMode` (beginner/expert), karşılaştırma modu (`primaryDriver`/`secondaryDriver`) gibi durumlar `uiStore` (Zustand) üzerinden yönetilir.

### 6.6 Şampiyona Sayfası (`StandingsPage`)

5 sekme: **Pilotlar**, **Takımlar**, **Yarışlar**, **Senaryolar**, **H2H** (Senaryolar ve H2H sadece güncel sezonda görünür).

- Yıl seçici: güncel yıl + son 2 yıl (`buildYearOptions`).
- **Jolpica fallback mekanizması**: Jolpica API'sine istek 3 saniye içinde yanıt vermezse, DB'den (`/drivers?season=`, `/teams?season=`) "puan: —" şeklinde fallback liste gösterilir; ekranda turuncu uyarı banner'ı belirir.
- **Pilotlar**: pozisyon (altın/gümüş/bronz renk kodlu top-3), pilot kodu+isim+takım, puan bar grafiği, lider'e göre puan farkı, galibiyet sayısı, **favori yıldızı** (⭐ — `favoritesStore` ile kalıcı).
- **Takımlar**: benzer görünüm, milliyet bilgisi.
- **Yarışlar**: her round için podyum (🥇🥈🥉) veya sadece kazanan.
- **Senaryolar**: `ChampionshipScenario` bileşeni (şampiyona ihtimalleri).
- **H2H**: `HeadToHead` — iki pilotun devre bazlı karşılıklı performans karşılaştırması (`get_h2h_circuit`, alfabetik sıralı cache anahtarı + `_flip()` ile ters sıralı istek desteği).

### 6.7 Giriş/Kayıt Sayfası (`LoginPage`)

- Giriş / Kayıt sekmeli form.
- Kayıt sırasında otomatik giriş yapılır.
- Hata mesajları backend `detail` alanından okunur, varsayılan "Kullanıcı adı veya şifre hatalı".
- "AI yorumları için giriş zorunlu değil" notu.

---

## 7. Topluluk Özellikleri (Detay)

- **Yorumlar**: oturuma özel, tur numarası ve pist üzerindeki konum (`dist_pct`) ile ilişkilendirilebilir; upvote sayacı.
- **Anketler**: soru + seçenekler (JSONB, `{"text","votes"}`), `closes_at` zaman damgası, oy yüzdeleri `_poll_to_out()` ile hesaplanır; her kullanıcı bir anketi sadece bir kez oylayabilir.
- **Anlık Tepkiler (Reactions)**: Redis listesinde tutulur (4 saat TTL), emoji + pist konumu + tur numarasına göre gruplanır.
- Tüm yazma işlemleri Redis pub/sub üzerinden `/ws/community/{session_id}`'ye yayınlanır → gerçek zamanlı güncelleme.

---

## 8. Bildirimler

- Web Push (VAPID) — `POST /notifications/subscribe` (201, Redis'te 30 gün), `DELETE /notifications/subscribe` (204).
- VAPID anahtarı tanımlı değilse **demo modda** çalışır: gönderim yapılmaz, sadece loglanır.
- `broadcast_push()`: en fazla 1000 abone — bayrak değişimi, pit, ilk tur gibi yarış olaylarında kullanılmak üzere tasarlanmıştır.

---

## 9. Önemli Sabitler — Hızlı Referans

| Sabit | Değer | Anlamı |
|---|---|---|
| `PIT_LOSS_SECONDS` | 22.0 | Pit girişi toplam zaman kaybı |
| `SAFETY_CAR_DELTA` | -15.0 | SC altında pit kazancı |
| `MGU_K_MAX_KW` | 350.0 | Maksimum MGU-K gücü |
| `ENERGY_STORE_KJ` | 4000.0 | Batarya kapasitesi |
| `LAP_DEPLOY_LIMIT` | 900.0 kJ | Tur başı deploy limiti |
| `AERO_SPEED_THRESH` | 280.0 km/h | X-mode hız eşiği |
| `access_token_expire_minutes` | 30 | JWT access süresi |
| `refresh_token_expire_days` | 7 | JWT refresh süresi |
| Live polling aralığı | 4 saniye | Celery Beat |
| Canlı oturum tespiti | 1 dakika | Celery Beat |
| Aktif oturum Redis TTL | 6 saat | `set_active_session` |
| Live snapshot TTL | 120 saniye | `save_live_snapshot` |

---

## 10. Proje Durumu Notu

`f1-backend/README.md`'deki faz planına göre Faz 1 (temel altyapı) tamamlanmış olarak işaretlenmiş; Faz 2-4 (telemetri, AI yorum, canlı WebSocket, topluluk) "beklemede" görünse de **kod incelemesinde bu özelliklerin büyük ölçüde uygulanmış olduğu** görülmektedir — README güncellenmemiş olabilir.
