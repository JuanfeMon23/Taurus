"""add catalogs (payment methods, movement types, expense categories); drop fixed value checks

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-07 21:00:00.000000

"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fecha antigua fija: cualquier edición del usuario gana por LWW.
SEED_AT = "2000-01-01T00:00:00+00:00"


def _catalog_table(name: str, extra: sa.Column[Any] | None = None) -> None:
    columns: list[sa.SchemaItem] = [sa.Column("name", sa.Text(), nullable=False)]
    constraints: list[sa.SchemaItem] = [
        sa.CheckConstraint("length(trim(name)) > 0", name=op.f(f"ck_{name}_name_not_empty"))
    ]
    if extra is not None:
        columns.append(extra)
        if extra.name == "sign":
            constraints.append(sa.CheckConstraint("sign in (-1, 1)", name=op.f(f"ck_{name}_sign")))
    op.create_table(
        name,
        *columns,
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
        *constraints,
        sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{name}")),
    )


def _seed(name: str, extra: str | None, extra_type: Any, rows: list[dict[str, Any]]) -> None:
    columns = [
        sa.column("id", sa.Text),
        sa.column("name", sa.Text),
        sa.column("sort_order", sa.Integer),
        sa.column("active", sa.Boolean),
        sa.column("deleted", sa.Boolean),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    ]
    if extra is not None:
        columns.append(sa.column(extra, extra_type))
    from datetime import datetime

    stamp = datetime.fromisoformat(SEED_AT)
    op.bulk_insert(
        sa.table(name, *columns),
        [{"deleted": False, "active": True, "updated_at": stamp, **row} for row in rows],
    )


def upgrade() -> None:
    """Upgrade schema."""
    _catalog_table("payment_methods", sa.Column("affects_cash", sa.Boolean(), nullable=False))
    _catalog_table("movement_types", sa.Column("sign", sa.SmallInteger(), nullable=False))
    _catalog_table("fund_movement_types", sa.Column("sign", sa.SmallInteger(), nullable=False))
    _catalog_table("expense_categories")

    _seed(
        "payment_methods",
        "affects_cash",
        sa.Boolean,
        [
            {"id": "cash", "name": "Efectivo", "affects_cash": True, "sort_order": 1},
            {"id": "transfer", "name": "Transferencia", "affects_cash": False, "sort_order": 2},
        ],
    )
    _seed(
        "movement_types",
        "sign",
        sa.SmallInteger,
        [
            {"id": "expense", "name": "Gasto", "sign": -1, "sort_order": 1},
            {"id": "withdrawal", "name": "Retiro", "sign": -1, "sort_order": 2},
            {"id": "deposit", "name": "Aporte", "sign": 1, "sort_order": 3},
        ],
    )
    _seed(
        "fund_movement_types",
        "sign",
        sa.SmallInteger,
        [
            {"id": "transfer", "name": "Envío", "sign": 1, "sort_order": 1},
            {"id": "spend", "name": "Gasto del fondo", "sign": -1, "sort_order": 2},
        ],
    )
    _seed(
        "expense_categories",
        None,
        None,
        [
            {"id": "comida", "name": "Comida", "sort_order": 1},
            {"id": "parqueadero", "name": "Parqueadero", "sort_order": 2},
            {"id": "varios", "name": "Varios", "sort_order": 3},
        ],
    )

    # Categorías libres ya usadas: una por id normalizado; name = valor sin espacios de borde.
    op.execute(
        f"""
        insert into expense_categories (id, name, sort_order, active, deleted, updated_at)
        select lower(trim(category)), min(trim(category)), 100, true, false, '{SEED_AT}'
        from movements
        where category is not null and length(trim(category)) > 0
        group by lower(trim(category))
        on conflict (id) do nothing
        """
    )
    op.add_column("movements", sa.Column("category_id", sa.Text(), nullable=True))
    op.execute(
        """
        update movements set category_id = lower(trim(category)), updated_at = now()
        where category is not null and length(trim(category)) > 0
        """
    )
    op.drop_column("movements", "category")

    op.drop_constraint(op.f("ck_movements_method"), "movements", type_="check")
    op.drop_constraint(op.f("ck_movements_type"), "movements", type_="check")
    op.drop_constraint(op.f("ck_fund_movements_type"), "fund_movements", type_="check")
    op.drop_constraint(op.f("ck_services_method"), "services", type_="check")


def downgrade() -> None:
    """Downgrade schema."""
    # Valores fuera del catálogo original se reasignan al válido más cercano antes de los CHECK.
    op.execute("update movements set method = 'cash' where method not in ('cash', 'transfer')")
    op.execute("update services set method = 'cash' where method not in ('cash', 'transfer')")
    op.execute(
        "update movements set type = 'expense' "
        "where type not in ('expense', 'withdrawal', 'deposit')"
    )
    op.execute("update fund_movements set type = 'spend' where type not in ('transfer', 'spend')")
    op.create_check_constraint(
        op.f("ck_services_method"), "services", "method in ('cash', 'transfer')"
    )
    op.create_check_constraint(
        op.f("ck_fund_movements_type"), "fund_movements", "type in ('transfer', 'spend')"
    )
    op.create_check_constraint(
        op.f("ck_movements_type"),
        "movements",
        "type in ('expense', 'withdrawal', 'deposit')",
    )
    op.create_check_constraint(
        op.f("ck_movements_method"), "movements", "method in ('cash', 'transfer')"
    )

    op.add_column("movements", sa.Column("category", sa.Text(), nullable=True))
    op.execute(
        """
        update movements m set category = coalesce(
            (select c.name from expense_categories c where c.id = m.category_id), m.category_id
        )
        where m.category_id is not null
        """
    )
    op.drop_column("movements", "category_id")

    op.drop_table("expense_categories")
    op.drop_table("fund_movement_types")
    op.drop_table("movement_types")
    op.drop_table("payment_methods")
