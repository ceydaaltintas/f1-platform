from datetime import timedelta

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "f1platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.post_session",
        "app.tasks.live_polling",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=300,
    task_time_limit=600,
    broker_connection_retry_on_startup=True,
)

celery_app.conf.beat_schedule = {
    # ── Canlı Yarış ───────────────────────────────────────────────────────────
    # Her 4 saniyede bir OpenF1'den veri çek ve pub/sub'a yayınla
    "live-poll-every-4s": {
        "task": "app.tasks.live_polling.poll_live_session",
        "schedule": timedelta(seconds=4),
    },
    # Her dakika canlı oturum olup olmadığını kontrol et
    "detect-live-session-every-minute": {
        "task": "app.tasks.live_polling.detect_and_activate_live_session",
        "schedule": crontab(minute="*"),
    },

    # ── Oturum Sonrası ────────────────────────────────────────────────────────
    # Her gece tamamlanan oturumları sync et
    "daily-completed-session-sync": {
        "task": "app.tasks.post_session.sync_completed_sessions",
        "schedule": crontab(hour=0, minute=30),
    },
    # Pazartesi sabahı round_status güncelle (Pazar yarışı tamamlandıktan sonra)
    "monday-season-refresh": {
        "task": "app.tasks.post_session.refresh_current_season_rounds",
        "schedule": crontab(hour=2, minute=0, day_of_week=1),
    },
    # Yarış haftasonu Cuma-Cumartesi-Pazar akşamı session kayıtlarını çek
    "race-weekend-session-sync": {
        "task": "app.tasks.post_session.sync_race_weekend_sessions",
        "schedule": crontab(hour=20, minute=0, day_of_week="5,6,0"),
    },
}
