"""add cash_days.to_deposit and deposit_movements

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-04 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "cash_days",
        sa.Column("to_deposit", sa.Numeric(precision=12, scale=2), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_cash_days_to_deposit_non_negative"), "cash_days", "to_deposit >= 0"
    )
    op.create_table(
        "deposit_movements",
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint("amount >= 0", name=op.f("ck_deposit_movements_amount_non_negative")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_deposit_movements")),
    )
    op.create_index("ix_deposit_movements_date", "deposit_movements", ["date"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_deposit_movements_date", table_name="deposit_movements")
    op.drop_table("deposit_movements")
    op.drop_constraint(op.f("ck_cash_days_to_deposit_non_negative"), "cash_days", type_="check")
    op.drop_column("cash_days", "to_deposit")
