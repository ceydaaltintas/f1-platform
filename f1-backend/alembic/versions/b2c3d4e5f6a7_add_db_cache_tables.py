"""add db cache tables

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # OpenF1 lap verisi kalıcı cache (session_key + driver_number → lap listesi)
    op.create_table(
        "openf1_laps_cache",
        sa.Column("session_key",   sa.Integer(), nullable=False),
        sa.Column("driver_number", sa.Integer(), nullable=False),
        sa.Column("data",          JSONB(),      nullable=False),
        sa.Column("synced_at",     sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("session_key", "driver_number"),
    )

    # OpenF1 stint verisi kalıcı cache (session_key → tüm stintler)
    op.create_table(
        "openf1_stints_cache",
        sa.Column("session_key", sa.Integer(), nullable=False),
        sa.Column("data",        JSONB(),      nullable=False),
        sa.Column("synced_at",   sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("session_key"),
    )

    # Jolpica geçmiş sezon yarış sonuçları (year → tüm sezon)
    op.create_table(
        "jolpica_season_cache",
        sa.Column("year",         sa.Integer(), nullable=False),
        sa.Column("results_data", JSONB(),      nullable=False),
        sa.Column("synced_at",    sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("year"),
    )


def downgrade() -> None:
    op.drop_table("jolpica_season_cache")
    op.drop_table("openf1_stints_cache")
    op.drop_table("openf1_laps_cache")
