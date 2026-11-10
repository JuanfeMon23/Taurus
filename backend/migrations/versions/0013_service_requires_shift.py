"""services: every live trip must have a shift (CHECK, NOT VALID)

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-10 18:00:00.000000

Regla: no hay viajes sin turno. El CHECK se crea NOT VALID: se aplica a todo INSERT/UPDATE
nuevo, pero no valida los viajes historicos (no hay turnos de esos dias para rellenarlos).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE services ADD CONSTRAINT ck_services_shift_required "
        "CHECK (deleted OR shift_id IS NOT NULL) NOT VALID"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_services_shift_required"), "services", type_="check")
