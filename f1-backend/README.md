# F1 Platform — Backend

Formula 1 telemetri, canlı yarış takibi ve topluluk platformu.

## Hızlı Başlangıç

### 1. Ortam dosyasını oluştur

```bash
cp .env.example .env
# .env içindeki SECRET_KEY ve ANTHROPIC_API_KEY değerlerini doldur
```

### 2. Docker ile başlat (önerilen)

```bash
docker compose up -d db redis   # Önce veritabanı ve Redis
docker compose up api           # API sunucusu (hot-reload ile)
```

### 3. Veritabanı migration

```bash
# Docker içinde
docker compose exec api alembic upgrade head

# Veya yerel ortamda
alembic upgrade head
```

### 4. İlk veri senkronizasyonu

```bash
# 2024 ve 2025 sezonlarını Jolpica'dan çek
curl -X POST http://localhost:8000/api/v1/seasons/2025/sync
curl -X POST http://localhost:8000/api/v1/seasons/2024/sync
```

## API Dokümantasyonu

- Swagger UI: http://localhost:8000/docs
- ReDoc:       http://localhost:8000/redoc
- Sağlık:      http://localhost:8000/health

## Proje Yapısı

```
app/
├── api/v1/routes/     # FastAPI router'ları
│   ├── auth.py        # Kayıt, giriş, token yenileme
│   ├── seasons.py     # Sezon, round, pilot, takım
│   └── sessions.py    # Oturum, tur, pit stop
├── core/
│   ├── config.py      # Pydantic Settings
│   ├── database.py    # Async SQLAlchemy engine
│   ├── redis_client.py
│   └── security.py    # JWT + bcrypt
├── models/            # SQLAlchemy ORM modelleri
├── schemas/           # Pydantic request/response şemaları
├── services/
│   ├── jolpica.py     # Jolpica API wrapper
│   └── sync.py        # Veri senkronizasyon servisi
└── main.py            # FastAPI app
```

## Geliştirme Komutları

```bash
# Yeni migration oluştur (model değişikliğinden sonra)
alembic revision --autogenerate -m "add new table"

# Migration uygula
alembic upgrade head

# Bir adım geri al
alembic downgrade -1

# Celery worker (arka plan görevleri)
celery -A app.tasks.celery_app worker --loglevel=info

# Testleri çalıştır
pytest tests/ -v
```

## Faz Durumu

- [x] Faz 1: Temel altyapı (Docker, DB, Auth, Jolpica sync)
- [ ] Faz 2: Telemetri dashboardu + AI yorum
- [ ] Faz 3: Canlı yarış takibi (WebSocket)
- [ ] Faz 4: Topluluk özellikleri
- [ ] Faz 5: İyileştirme ve genişleme
