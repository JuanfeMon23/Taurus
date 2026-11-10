"""rate_modes catalog; deferred FKs from records to their catalogs

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-10 10:00:00.000000

Si hay códigos huérfanos (sin fila de catálogo) el ADD CONSTRAINT falla y la migración
se revierte entera (DDL transaccional): no se borra ni se inventa ningún dato.
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fecha antigua fija: cualquier edición del usuario gana por LWW.
SEED_AT = datetime.fromisoformat("2000-01-01T00:00:00+00:00")

# (tabla, columna, catálogo)
FKS = [
    ("categories", "rate_mode", "rate_modes"),
    ("services", "method", "payment_methods"),
    ("movements", "method", "payment_methods"),
    ("movements", "type", "movement_types"),
    ("movements", "category_id", "expense_categories"),
    ("fund_movements", "type", "fund_movement_types"),
]

RATE_MODES = [
    {"id": "direct", "name": "Valor por km", "rate": True, "interval": False, "order": 1},
    {"id": "derived", "name": "Costo cada X km", "rate": False, "interval": True, "order": 2},
]


def upgrade() -> None:
    op.create_table(
        "rate_modes",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "uses_rate_per_km", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column(
            "uses_cost_interval", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
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
        sa.CheckConstraint("length(trim(name)) > 0", name=op.f("ck_rate_modes_name_not_empty")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rate_modes")),
    )
    for row in RATE_MODES:
        op.execute(
            sa.text(
                "insert into rate_modes (id, name, uses_rate_per_km, uses_cost_interval, "
                "sort_order, active, deleted, updated_at) values "
                "(:id, :name, :rate, :interval, :order, true, false, :at)"
            ).bindparams(at=SEED_AT, **row)
        )

    op.drop_constraint(op.f("ck_categories_rate_mode"), "categories", type_="check")
    for table, column, catalog in FKS:
        op.create_index(op.f(f"ix_{table}_{column}"), table, [column])
        op.create_foreign_key(
            op.f(f"fk_{table}_{column}_{catalog}"),
            table,
            catalog,
            [column],
            ["id"],
            deferrable=True,
            initially="DEFERRED",
        )


def downgrade() -> None:
    for table, column, catalog in reversed(FKS):
        op.drop_constraint(op.f(f"fk_{table}_{column}_{catalog}"), table, type_="foreignkey")
        op.drop_index(op.f(f"ix_{table}_{column}"), table_name=table)
    # Modos creados por el usuario no caben en el CHECK original: se reasignan a 'direct'.
    op.execute(
        "update categories set rate_mode = 'direct', updated_at = now() "
        "where rate_mode not in ('direct', 'derived')"
    )
    op.create_check_constraint(
        op.f("ck_categories_rate_mode"), "categories", "rate_mode in ('direct', 'derived')"
    )
    op.drop_table("rate_modes")
