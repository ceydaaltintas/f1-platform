import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ─── Comments ────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=500)
    lap_number: int | None = Field(None, ge=1, le=100)
    dist_pct: int | None = Field(None, ge=0, le=100)

    @field_validator("content")
    @classmethod
    def no_spam(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Yorum boş olamaz")
        return v


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    content: str
    lap_number: int | None
    dist_pct: int | None
    upvotes: int
    created_at: datetime
    username: str = ""         # join ile doldurulur
    user_id: uuid.UUID


class CommentUpdate(BaseModel):
    content: str = Field(..., min_length=1, max_length=500)

    @field_validator("content")
    @classmethod
    def no_spam(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Yorum boş olamaz")
        return v


class CommentPage(BaseModel):
    items: list[CommentOut]
    total: int
    page: int
    page_size: int


# ─── Polls ───────────────────────────────────────────────────────────────────

class PollCreate(BaseModel):
    question: str = Field(..., min_length=5, max_length=300)
    options: list[str] = Field(..., min_length=2, max_length=4)
    closes_in_minutes: int = Field(5, ge=1, le=60)

    @field_validator("options")
    @classmethod
    def valid_options(cls, v: list[str]) -> list[str]:
        cleaned = [o.strip() for o in v if o.strip()]
        if len(cleaned) < 2:
            raise ValueError("En az 2 seçenek gerekli")
        if len(cleaned) > 4:
            raise ValueError("En fazla 4 seçenek olabilir")
        return cleaned


class PollOptionOut(BaseModel):
    index: int
    text: str
    votes: int
    pct: float  # 0.0–100.0


class PollOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    question: str
    options: list[PollOptionOut]
    total_votes: int
    user_vote: int | None       # Kullanıcının oyladığı seçenek indeksi
    created_at: datetime
    closes_at: datetime | None
    is_closed: bool
    created_by: uuid.UUID
    created_by_username: str = ""


# ─── Reactions ───────────────────────────────────────────────────────────────

ALLOWED_EMOJIS = {"🔥", "💀", "👏", "😮", "🏎️", "🏁", "⚠️", "💨"}

class ReactionCreate(BaseModel):
    emoji: str
    lap_number: int | None = Field(None, ge=1)
    dist_pct: int | None = Field(None, ge=0, le=100)

    @field_validator("emoji")
    @classmethod
    def valid_emoji(cls, v: str) -> str:
        if v not in ALLOWED_EMOJIS:
            raise ValueError(f"İzin verilen emojiler: {', '.join(ALLOWED_EMOJIS)}")
        return v


class ReactionPoint(BaseModel):
    emoji: str
    dist_pct: int | None
    lap_number: int | None
    count: int
