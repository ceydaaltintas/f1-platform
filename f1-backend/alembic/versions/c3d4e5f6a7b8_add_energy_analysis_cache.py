"""add energy analysis cache tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # OpenF1 ham araba verisi (speed/throttle/brake/rpm/gear)
    op.create_table(
        "openf1_car_data_cache",
        sa.Column("session_key",   sa.Integer(), nullable=False),
        sa.Column("driver_number", sa.Integer(), nullable=False),
        sa.Column("data",          JSONB(),      nullable=False),
        sa.Column("synced_at",     sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("session_key", "driver_number"),
    )

    # Hesaplanmış enerji analizi (fizik modeli çıktısı)
    op.create_table(
        "energy_analysis_cache",
        sa.Column("session_key",   sa.Integer(), nullable=False),
        sa.Column("driver_number", sa.Integer(), nullable=False),
        sa.Column("result",        JSONB(),      nullable=False),
        sa.Column("computed_at",   sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("session_key", "driver_number"),
    )


def downgrade() -> None:
    op.drop_table("energy_analysis_cache")
    op.drop_table("openf1_car_data_cache")
