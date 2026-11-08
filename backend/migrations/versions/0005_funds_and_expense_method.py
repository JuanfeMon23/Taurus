"""add fund_movements and movements.category/method

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-07 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "fund_movements",
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("category_id", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
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
        sa.CheckConstraint("amount >= 0", name=op.f("ck_fund_movements_amount_non_negative")),
        sa.CheckConstraint("type in ('transfer', 'spend')", name=op.f("ck_fund_movements_type")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fund_movements")),
    )
    op.create_index("ix_fund_movements_date", "fund_movements", ["date"], unique=False)
    op.create_index(
        "ix_fund_movements_category_id", "fund_movements", ["category_id"], unique=False
    )
    op.add_column("movements", sa.Column("category", sa.Text(), nullable=True))
    op.add_column(
        "movements",
        sa.Column("method", sa.Text(), server_default=sa.text("'cash'"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_movements_method"), "movements", "method in ('cash', 'transfer')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f("ck_movements_method"), "movements", type_="check")
    op.drop_column("movements", "method")
    op.drop_column("movements", "category")
    op.drop_index("ix_fund_movements_category_id", table_name="fund_movements")
    op.drop_index("ix_fund_movements_date", table_name="fund_movements")
    op.drop_table("fund_movements")
