"""add movement_types.has_category (replaces the 'expense' system code in the app)

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-07 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "movement_types",
        sa.Column("has_category", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    # updated_at = now() para que la sincronización LWW propague la marca a los clientes.
    op.execute(
        "update movement_types set has_category = true, updated_at = now() where id = 'expense'"
    )


def downgrade() -> None:
    op.drop_column("movement_types", "has_category")
