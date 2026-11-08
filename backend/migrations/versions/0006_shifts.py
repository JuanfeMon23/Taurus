"""add shifts

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-07 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

HHMM = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "shifts",
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Text(), nullable=False),
        sa.Column("end_time", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint(f"start_time ~ '{HHMM}'", name=op.f("ck_shifts_start_time_format")),
        sa.CheckConstraint(
            f"end_time is null or end_time ~ '{HHMM}'", name=op.f("ck_shifts_end_time_format")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shifts")),
    )
    op.create_index("ix_shifts_date", "shifts", ["date"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_shifts_date", table_name="shifts")
    op.drop_table("shifts")
