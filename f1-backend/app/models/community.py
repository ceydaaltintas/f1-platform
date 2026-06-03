import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    lap_number: Mapped[int | None] = mapped_column(SmallInteger)  # hangi turla ilişkili
    dist_pct: Mapped[int | None] = mapped_column(SmallInteger)    # tur mesafesi %
    upvotes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    user: Mapped["User"] = relationship(back_populates="comments")  # noqa: F821
    session: Mapped["Session"] = relationship(back_populates="comments")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Comment {self.id} by {self.user_id}>"


class Poll(Base):
    __tablename__ = "polls"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), nullable=False, index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    question: Mapped[str] = mapped_column(String(300), nullable=False)
    # options: [{"text": "VER", "votes": 0}, {"text": "NOR", "votes": 0}]
    options: Mapped[list] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    session: Mapped["Session"] = relationship(back_populates="polls")  # noqa: F821
    votes: Mapped[list["PollVote"]] = relationship(back_populates="poll")

    def __repr__(self) -> str:
        return f"<Poll '{self.question[:40]}'>"


class PollVote(Base):
    __tablename__ = "poll_votes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    poll_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("polls.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    option_index: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    poll: Mapped["Poll"] = relationship(back_populates="votes")
    user: Mapped["User"] = relationship(back_populates="poll_votes")  # noqa: F821
