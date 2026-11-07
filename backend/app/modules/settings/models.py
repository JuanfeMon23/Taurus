from decimal import Decimal

from sqlalchemy import CheckConstraint, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin


class Setting(SyncMixin, Base):
    """Ajustes configurables; fila única con id 'rates' (tasas de comisión inDrive e IVA)."""

    __tablename__ = "settings"
    __table_args__ = (
        CheckConstraint("commission_rate between 0 and 1", name="commission_rate_range"),
        CheckConstraint("vat_rate between 0 and 1", name="vat_rate_range"),
    )

    commission_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4))
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4))
