"""add inDrive commission to services and settings table

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-07 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "services",
        sa.Column("is_indrive", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "services",
        sa.Column(
            "commission",
            sa.Numeric(precision=12, scale=2),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "services",
        sa.Column(
            "commission_vat",
            sa.Numeric(precision=12, scale=2),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        op.f("ck_services_commission_non_negative"), "services", "commission >= 0"
    )
    op.create_check_constraint(
        op.f("ck_services_commission_vat_non_negative"), "services", "commission_vat >= 0"
    )
    op.create_table(
        "settings",
        sa.Column("commission_rate", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("vat_rate", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint(
            "commission_rate between 0 and 1", name=op.f("ck_settings_commission_rate_range")
        ),
        sa.CheckConstraint("vat_rate between 0 and 1", name=op.f("ck_settings_vat_rate_range")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_settings")),
    )
    op.execute("INSERT INTO settings (id, commission_rate, vat_rate) VALUES ('rates', 0.095, 0.19)")
    # Existing live services are real inDrive trips: snapshot their commission at the default rates.
    op.execute(
        "UPDATE services SET commission = round(amount * 0.095, 2), updated_at = now() "
        "WHERE deleted = false"
    )
    op.execute(
        "UPDATE services SET commission_vat = round(commission * 0.19, 2) WHERE deleted = false"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("settings")
    op.drop_constraint(op.f("ck_services_commission_vat_non_negative"), "services", type_="check")
    op.drop_constraint(op.f("ck_services_commission_non_negative"), "services", type_="check")
    op.drop_column("services", "commission_vat")
    op.drop_column("services", "commission")
    op.drop_column("services", "is_indrive")
