"""add services.bonus

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-04 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "services",
        sa.Column(
            "bonus",
            sa.Numeric(precision=12, scale=2),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.create_check_constraint(op.f("ck_services_bonus_non_negative"), "services", "bonus >= 0")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f("ck_services_bonus_non_negative"), "services", type_="check")
    op.drop_column("services", "bonus")
