import uuid
from datetime import date, datetime

from sqlalchemy import (
    DATE,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Season(Base):
    __tablename__ = "seasons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    # Aktif sezon mu? Yalnızca bir satır True olabilir.
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    rounds: Mapped[list["Round"]] = relationship(
        back_populates="season", order_by="Round.round_number"
    )

    def __repr__(self) -> str:
        return f"<Season {self.year}{'*' if self.is_current else ''}>"


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    jolpica_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    nationality: Mapped[str | None] = mapped_column(String(50))
    color_hex: Mapped[str] = mapped_column(String(7), default="#FFFFFF")

    drivers: Mapped[list["Driver"]] = relationship(back_populates="current_team")

    def __repr__(self) -> str:
        return f"<Team {self.name}>"


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    jolpica_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(3), nullable=False, index=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    number: Mapped[int | None] = mapped_column(SmallInteger)
    nationality: Mapped[str | None] = mapped_column(String(50))
    date_of_birth: Mapped[date | None] = mapped_column(DATE)
    current_team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"))

    current_team: Mapped["Team | None"] = relationship(back_populates="drivers")
    session_results: Mapped[list["DriverSession"]] = relationship(back_populates="driver")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    def __repr__(self) -> str:
        return f"<Driver {self.code} – {self.full_name}>"


class Round(Base):
    __tablename__ = "rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), nullable=False, index=True)
    round_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    circuit_name: Mapped[str] = mapped_column(String(150), nullable=False)
    country: Mapped[str | None] = mapped_column(String(100))
    locality: Mapped[str | None] = mapped_column(String(100))
    race_date: Mapped[date | None] = mapped_column(DATE)
    race_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meeting_key: Mapped[int | None] = mapped_column(Integer)  # OpenF1 meeting_key
    # "upcoming" | "completed" — yarış tarihi geçmişse completed, değilse upcoming
    round_status: Mapped[str] = mapped_column(
        Enum("upcoming", "completed", name="round_status"),
        default="upcoming",
        nullable=False,
    )

    season: Mapped["Season"] = relationship(back_populates="rounds")
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="round", order_by="Session.session_date"
    )

    def __repr__(self) -> str:
        return f"<Round {self.round_number}: {self.name}>"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(
        Enum(
            "practice1", "practice2", "practice3",
            "qualifying", "sprint_qualifying", "sprint", "race",
            name="session_type",
        ),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        Enum("upcoming", "active", "finished", name="session_status"),
        default="upcoming",
        nullable=False,
    )
    session_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_key: Mapped[int | None] = mapped_column(Integer, unique=True)  # OpenF1 session_key
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    round: Mapped["Round"] = relationship(back_populates="sessions")
    driver_results: Mapped[list["DriverSession"]] = relationship(back_populates="session")
    laps: Mapped[list["Lap"]] = relationship(back_populates="session")
    pit_stops: Mapped[list["PitStop"]] = relationship(back_populates="session")
    comments: Mapped[list["Comment"]] = relationship(back_populates="session")  # noqa: F821
    polls: Mapped[list["Poll"]] = relationship(back_populates="session")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Session {self.type} – round {self.round_id}>"


class DriverSession(Base):
    """Bir pilotun belirli bir oturumdaki sonuçları."""

    __tablename__ = "driver_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False, index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"), nullable=False, index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"))
    grid_position: Mapped[int | None] = mapped_column(SmallInteger)
    finish_position: Mapped[int | None] = mapped_column(SmallInteger)
    points: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str | None] = mapped_column(String(50))  # "Finished", "DNF", "DNS" vb.
    fastest_lap_rank: Mapped[int | None] = mapped_column(SmallInteger)

    session: Mapped["Session"] = relationship(back_populates="driver_results")
    driver: Mapped["Driver"] = relationship(back_populates="session_results")
    team: Mapped["Team | None"] = relationship()


class Lap(Base):
    __tablename__ = "laps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False, index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"), nullable=False, index=True)
    lap_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    lap_time: Mapped[float | None] = mapped_column(Float)  # saniye cinsinden
    sector1_time: Mapped[float | None] = mapped_column(Float)
    sector2_time: Mapped[float | None] = mapped_column(Float)
    sector3_time: Mapped[float | None] = mapped_column(Float)
    compound: Mapped[str | None] = mapped_column(
        Enum("SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET", "UNKNOWN", name="tyre_compound")
    )
    tyre_life: Mapped[int | None] = mapped_column(SmallInteger)  # kaç tur kullanıldı
    is_personal_best: Mapped[bool] = mapped_column(default=False)
    is_pit_out_lap: Mapped[bool] = mapped_column(default=False)
    is_pit_in_lap: Mapped[bool] = mapped_column(default=False)

    session: Mapped["Session"] = relationship(back_populates="laps")
    driver: Mapped["Driver"] = relationship()


class PitStop(Base):
    __tablename__ = "pit_stops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False, index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id"), nullable=False, index=True)
    lap_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    stop_duration: Mapped[float | None] = mapped_column(Float)   # saniye (toplam)
    lane_duration: Mapped[float | None] = mapped_column(Float)   # pit lane süresi
    tyre_in: Mapped[str | None] = mapped_column(String(20))      # önceki lastik
    tyre_out: Mapped[str | None] = mapped_column(String(20))     # yeni lastik

    session: Mapped["Session"] = relationship(back_populates="pit_stops")
    driver: Mapped["Driver"] = relationship()


# ─── Kalıcı API Cache Tabloları ──────────────────────────────────────────────
# Biten session'ların OpenF1 verisi ve geçmiş sezon Jolpica verisi
# Redis'in aksine restart'ta silinmez, TTL'siz kalıcıdır.

from sqlalchemy.dialects.postgresql import JSONB  # noqa: E402


class OpenF1LapsCache(Base):
    """Bir pilotun bir session'daki tüm tur verileri (OpenF1 raw)."""
    __tablename__ = "openf1_laps_cache"

    session_key:    Mapped[int] = mapped_column(Integer, primary_key=True)
    driver_number:  Mapped[int] = mapped_column(Integer, primary_key=True)
    data:           Mapped[list] = mapped_column(JSONB, nullable=False)
    synced_at:      Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class OpenF1StintsCache(Base):
    """Bir session'ın tüm stint verileri (OpenF1 raw)."""
    __tablename__ = "openf1_stints_cache"

    session_key:    Mapped[int] = mapped_column(Integer, primary_key=True)
    data:           Mapped[list] = mapped_column(JSONB, nullable=False)
    synced_at:      Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class JolpicaSeasonCache(Base):
    """Geçmiş sezon Jolpica yarış sonuçları (tüm sezon, tek kayıt)."""
    __tablename__ = "jolpica_season_cache"

    year:           Mapped[int] = mapped_column(Integer, primary_key=True)
    results_data:   Mapped[list] = mapped_column(JSONB, nullable=False)
    synced_at:      Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class OpenF1CarDataCache(Base):
    """Ham araba telemetrisi (speed/throttle/brake/rpm/gear) kalıcı cache."""
    __tablename__ = "openf1_car_data_cache"

    session_key:    Mapped[int] = mapped_column(Integer, primary_key=True)
    driver_number:  Mapped[int] = mapped_column(Integer, primary_key=True)
    data:           Mapped[list] = mapped_column(JSONB, nullable=False)
    synced_at:      Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class EnergyAnalysisCache(Base):
    """Hesaplanmış 2026 enerji analizi (fizik modeli çıktısı)."""
    __tablename__ = "energy_analysis_cache"

    session_key:    Mapped[int] = mapped_column(Integer, primary_key=True)
    driver_number:  Mapped[int] = mapped_column(Integer, primary_key=True)
    result:         Mapped[dict] = mapped_column(JSONB, nullable=False)
    computed_at:    Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
