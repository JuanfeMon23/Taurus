"""add shift_templates and shifts.template_id

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-07 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

HHMM = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "shift_templates",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("start_time", sa.Text(), nullable=False),
        sa.Column("end_time", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint(
            "length(trim(name)) > 0", name=op.f("ck_shift_templates_name_not_empty")
        ),
        sa.CheckConstraint(
            f"start_time ~ '{HHMM}'", name=op.f("ck_shift_templates_start_time_format")
        ),
        sa.CheckConstraint(f"end_time ~ '{HHMM}'", name=op.f("ck_shift_templates_end_time_format")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shift_templates")),
    )
    op.add_column("shifts", sa.Column("template_id", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("shifts", "template_id")
    op.drop_table("shift_templates")
