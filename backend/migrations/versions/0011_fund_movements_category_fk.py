"""deferred FK fund_movements.category_id -> categories.id

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-10 10:40:00.000000

Si hay movimientos de fondo con una categoría inexistente el ADD CONSTRAINT falla y se
revierte todo: no se borra ni se inventa ningún dato.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FK = "fk_fund_movements_category_id_categories"


def upgrade() -> None:
    op.create_foreign_key(
        op.f(FK),
        "fund_movements",
        "categories",
        ["category_id"],
        ["id"],
        deferrable=True,
        initially="DEFERRED",
    )


def downgrade() -> None:
    op.drop_constraint(op.f(FK), "fund_movements", type_="foreignkey")
