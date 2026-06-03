from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


# ─── Season ─────────────────────────────────────────────────────────────────

class SeasonBase(BaseModel):
    year: int

class SeasonOut(SeasonBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_current: bool = False
    round_count: int = 0
    rounds_completed: int = 0
    rounds_upcoming: int = 0


# ─── Team ───────────────────────────────────────────────────────────────────

class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    jolpica_id: str
    name: str
    nationality: str | None
    color_hex: str


# ─── Driver ─────────────────────────────────────────────────────────────────

class DriverOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    jolpica_id: str
    code: str
    first_name: str
    last_name: str
    full_name: str
    number: int | None
    nationality: str | None
    current_team: TeamOut | None = None


# ─── Round ──────────────────────────────────────────────────────────────────

class SessionBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    type: str
    status: str
    session_date: datetime | None
    session_key: int | None

class RoundOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    round_number: int
    name: str
    circuit_name: str
    country: str | None
    locality: str | None
    race_date: date | None
    round_status: str  # "completed" | "upcoming"
    sessions: list[SessionBrief] = []


# ─── Lap ────────────────────────────────────────────────────────────────────

class LapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    lap_number: int
    lap_time: float | None
    sector1_time: float | None
    sector2_time: float | None
    sector3_time: float | None
    compound: str | None
    tyre_life: int | None
    is_personal_best: bool
    is_pit_out_lap: bool
    is_pit_in_lap: bool


# ─── PitStop ────────────────────────────────────────────────────────────────

class PitStopOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    driver_id: int
    lap_number: int
    stop_duration: float | None
    tyre_in: str | None
    tyre_out: str | None


# ─── DriverSession ──────────────────────────────────────────────────────────

class DriverSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    driver: DriverOut
    team: TeamOut | None
    grid_position: int | None
    finish_position: int | None
    points: float
    status: str | None
    fastest_lap_rank: int | None
