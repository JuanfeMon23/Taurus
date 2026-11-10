"""services.shift_id; deferred FK shifts.template_id -> shift_templates

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-10 13:00:00.000000

Las filas nunca se borran (lápidas), por eso las FK no llevan ON DELETE (NO ACTION), igual
que las de 0010. Los `template_id` huérfanos se dejan en NULL (no se borra ninguna fila).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("services", sa.Column("shift_id", sa.Text(), nullable=True))
    op.create_index(op.f("ix_services_shift_id"), "services", ["shift_id"])
    op.create_foreign_key(
        op.f("fk_services_shift_id_shifts"),
        "services",
        "shifts",
        ["shift_id"],
        ["id"],
        deferrable=True,
        initially="DEFERRED",
    )
    op.execute(
        "update shifts set template_id = null where template_id is not null "
        "and template_id not in (select id from shift_templates)"
    )
    op.create_index(op.f("ix_shifts_template_id"), "shifts", ["template_id"])
    op.create_foreign_key(
        op.f("fk_shifts_template_id_shift_templates"),
        "shifts",
        "shift_templates",
        ["template_id"],
        ["id"],
        deferrable=True,
        initially="DEFERRED",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_shifts_template_id_shift_templates"), "shifts", type_="foreignkey")
    op.drop_index(op.f("ix_shifts_template_id"), table_name="shifts")
    op.drop_constraint(op.f("fk_services_shift_id_shifts"), "services", type_="foreignkey")
    op.drop_index(op.f("ix_services_shift_id"), table_name="services")
    op.drop_column("services", "shift_id")
