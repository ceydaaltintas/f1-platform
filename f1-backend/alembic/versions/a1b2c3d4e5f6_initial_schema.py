"""initial schema

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "a1b2c3d4e5f6"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users ────────────────────────────────────────────────────────────────
    # Not: SQLAlchemy 2.x, Enum tiplerini create_table sırasında otomatik oluşturur.
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(50), nullable=False, unique=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column(
            "role",
            sa.Enum("user", "moderator", "admin", name="user_role"),
            nullable=False,
            server_default="user",
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_users_username", "users", ["username"])
    op.create_index("ix_users_email", "users", ["email"])

    # ── seasons ──────────────────────────────────────────────────────────────
    op.create_table(
        "seasons",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer, nullable=False, unique=True),
        sa.Column("is_current", sa.Boolean, nullable=False, server_default="false"),
    )
    op.create_index("ix_seasons_year", "seasons", ["year"])

    # ── teams ────────────────────────────────────────────────────────────────
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("jolpica_id", sa.String(100), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("nationality", sa.String(50), nullable=True),
        sa.Column("color_hex", sa.String(7), nullable=False, server_default="#FFFFFF"),
    )

    # ── drivers ──────────────────────────────────────────────────────────────
    op.create_table(
        "drivers",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("jolpica_id", sa.String(100), nullable=False, unique=True),
        sa.Column("code", sa.String(3), nullable=False),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=False),
        sa.Column("number", sa.SmallInteger, nullable=True),
        sa.Column("nationality", sa.String(50), nullable=True),
        sa.Column("date_of_birth", sa.Date, nullable=True),
        sa.Column(
            "current_team_id",
            sa.Integer,
            sa.ForeignKey("teams.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_drivers_code", "drivers", ["code"])

    # ── rounds ───────────────────────────────────────────────────────────────
    op.create_table(
        "rounds",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "season_id",
            sa.Integer,
            sa.ForeignKey("seasons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("round_number", sa.SmallInteger, nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("circuit_name", sa.String(150), nullable=False),
        sa.Column("country", sa.String(100), nullable=True),
        sa.Column("locality", sa.String(100), nullable=True),
        sa.Column("race_date", sa.Date, nullable=True),
        sa.Column("meeting_key", sa.Integer, nullable=True),
        sa.Column(
            "round_status",
            sa.Enum("upcoming", "completed", name="round_status", create_type=True),
            nullable=False,
            server_default="upcoming",
        ),
    )
    op.create_index("ix_rounds_season_id", "rounds", ["season_id"])

    # ── sessions ─────────────────────────────────────────────────────────────
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "round_id",
            sa.Integer,
            sa.ForeignKey("rounds.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "type",
            sa.Enum(
                "practice1", "practice2", "practice3",
                "qualifying", "sprint_qualifying", "sprint", "race",
                name="session_type",
                create_type=True,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("upcoming", "active", "finished", name="session_status", create_type=True),
            nullable=False,
            server_default="upcoming",
        ),
        sa.Column("session_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_key", sa.Integer, nullable=True, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_sessions_round_id", "sessions", ["round_id"])

    # ── driver_sessions ───────────────────────────────────────────────────────
    op.create_table(
        "driver_sessions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "session_id",
            sa.Integer,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "driver_id",
            sa.Integer,
            sa.ForeignKey("drivers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("team_id", sa.Integer, sa.ForeignKey("teams.id"), nullable=True),
        sa.Column("grid_position", sa.SmallInteger, nullable=True),
        sa.Column("finish_position", sa.SmallInteger, nullable=True),
        sa.Column("points", sa.Float, nullable=False, server_default="0.0"),
        sa.Column("status", sa.String(50), nullable=True),
        sa.Column("fastest_lap_rank", sa.SmallInteger, nullable=True),
    )
    op.create_index("ix_driver_sessions_session_id", "driver_sessions", ["session_id"])
    op.create_index("ix_driver_sessions_driver_id", "driver_sessions", ["driver_id"])

    # ── laps ─────────────────────────────────────────────────────────────────
    op.create_table(
        "laps",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "session_id",
            sa.Integer,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "driver_id",
            sa.Integer,
            sa.ForeignKey("drivers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("lap_number", sa.SmallInteger, nullable=False),
        sa.Column("lap_time", sa.Float, nullable=True),
        sa.Column("sector1_time", sa.Float, nullable=True),
        sa.Column("sector2_time", sa.Float, nullable=True),
        sa.Column("sector3_time", sa.Float, nullable=True),
        sa.Column(
            "compound",
            sa.Enum(
                "SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET", "UNKNOWN",
                name="tyre_compound",
                create_type=True,
            ),
            nullable=True,
        ),
        sa.Column("tyre_life", sa.SmallInteger, nullable=True),
        sa.Column("is_personal_best", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_pit_out_lap", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_pit_in_lap", sa.Boolean, nullable=False, server_default="false"),
    )
    op.create_index("ix_laps_session_id", "laps", ["session_id"])
    op.create_index("ix_laps_driver_id", "laps", ["driver_id"])

    # ── pit_stops ────────────────────────────────────────────────────────────
    op.create_table(
        "pit_stops",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "session_id",
            sa.Integer,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "driver_id",
            sa.Integer,
            sa.ForeignKey("drivers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("lap_number", sa.SmallInteger, nullable=False),
        sa.Column("stop_duration", sa.Float, nullable=True),
        sa.Column("lane_duration", sa.Float, nullable=True),
        sa.Column("tyre_in", sa.String(20), nullable=True),
        sa.Column("tyre_out", sa.String(20), nullable=True),
    )
    op.create_index("ix_pit_stops_session_id", "pit_stops", ["session_id"])
    op.create_index("ix_pit_stops_driver_id", "pit_stops", ["driver_id"])

    # ── comments ─────────────────────────────────────────────────────────────
    op.create_table(
        "comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("lap_number", sa.SmallInteger, nullable=True),
        sa.Column("dist_pct", sa.SmallInteger, nullable=True),
        sa.Column("upvotes", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_comments_session_id", "comments", ["session_id"])
    op.create_index("ix_comments_user_id", "comments", ["user_id"])
    op.create_index("ix_comments_created_at", "comments", ["created_at"])

    # ── polls ────────────────────────────────────────────────────────────────
    op.create_table(
        "polls",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            sa.Integer,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("question", sa.String(300), nullable=False),
        sa.Column("options", JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_polls_session_id", "polls", ["session_id"])

    # ── poll_votes ───────────────────────────────────────────────────────────
    op.create_table(
        "poll_votes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "poll_id",
            UUID(as_uuid=True),
            sa.ForeignKey("polls.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("option_index", sa.SmallInteger, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_poll_votes_poll_id", "poll_votes", ["poll_id"])
    op.create_index("ix_poll_votes_user_id", "poll_votes", ["user_id"])

    # Bir kullanıcı bir ankete yalnızca bir kez oy verebilir
    op.create_unique_constraint("uq_poll_votes_poll_user", "poll_votes", ["poll_id", "user_id"])


def downgrade() -> None:
    op.drop_table("poll_votes")
    op.drop_table("polls")
    op.drop_table("comments")
    op.drop_table("pit_stops")
    op.drop_table("laps")
    op.drop_table("driver_sessions")
    op.drop_table("sessions")
    op.drop_table("rounds")
    op.drop_table("drivers")
    op.drop_table("teams")
    op.drop_table("seasons")
    op.drop_table("users")

    op.execute("DROP TYPE IF EXISTS tyre_compound")
    op.execute("DROP TYPE IF EXISTS session_status")
    op.execute("DROP TYPE IF EXISTS session_type")
    op.execute("DROP TYPE IF EXISTS round_status")
    op.execute("DROP TYPE IF EXISTS user_role")
