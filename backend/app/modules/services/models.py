from datetime import date, time
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, Index, Numeric, Text, Time, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin, catalog_fk


class Service(SyncMixin, Base):
    """Los campos de viaje son NULL en servicios previos; la UI/API los exige en los nuevos."""

    __tablename__ = "services"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="amount_non_negative"),
        CheckConstraint("distance_km >= 0", name="distance_km_non_negative"),
        CheckConstraint("bonus >= 0", name="bonus_non_negative"),
        CheckConstraint("commission >= 0", name="commission_non_negative"),
        CheckConstraint("commission_vat >= 0", name="commission_vat_non_negative"),
        # En la BD (migracion 0013) es NOT VALID: no valida los viajes historicos sin turno.
        CheckConstraint("deleted OR shift_id IS NOT NULL", name="shift_required"),
        Index("ix_services_date", "date"),
        Index("ix_services_method", "method"),
        Index("ix_services_shift_id", "shift_id"),
    )

    date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    bonus: Mapped[Decimal] = mapped_column(Numeric(12, 2), server_default=text("0"))
    is_indrive: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    commission: Mapped[Decimal] = mapped_column(Numeric(12, 2), server_default=text("0"))
    commission_vat: Mapped[Decimal] = mapped_column(Numeric(12, 2), server_default=text("0"))
    method: Mapped[str] = mapped_column(Text, catalog_fk("payment_methods"))
    note: Mapped[str | None] = mapped_column(Text)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    distance_km: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    origin: Mapped[str | None] = mapped_column(Text)
    destination: Mapped[str | None] = mapped_column(Text)
    # Turno del día en que se hizo el viaje; FK diferida (el snapshot llega en orden arbitrario).
    shift_id: Mapped[str | None] = mapped_column(Text, catalog_fk("shifts"))
