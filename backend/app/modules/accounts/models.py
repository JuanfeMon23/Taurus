from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, Index, Numeric, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base
from app.modules.catalogs.models import CatalogMixin


class Account(CatalogMixin, Base):
    """Cuenta con saldo propio (Caja, Transferencias, Depósito...): `movements.account_id` es de
    dónde sale/entra el dinero y `movements.to_account_id` el destino de un traslado. Saldo =
    initial_balance + movimientos; la única con `is_cash_box` lleva apertura/cierre diario
    (`cash_days`) y es la que tocan los medios con `affects_cash`. La que lleva `commission_since`
    (Saldo inDrive; a lo sumo una, nunca la caja) descuenta la comisión + IVA de los viajes inDrive
    con fecha >= ese valor; ningún medio de pago puede apuntar a ella."""

    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),
        CheckConstraint(
            "commission_since IS NULL OR NOT is_cash_box", name="commission_not_cash_box"
        ),
        Index(
            "uq_accounts_commission_since",
            text("(commission_since IS NOT NULL)"),
            unique=True,
            postgresql_where=text("commission_since IS NOT NULL"),
        ),
        Index(
            "uq_accounts_is_cash_box",
            "is_cash_box",
            unique=True,
            postgresql_where=text("is_cash_box"),
        ),
    )

    initial_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), server_default=text("0"))
    is_cash_box: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    commission_since: Mapped[date | None] = mapped_column(Date, nullable=True)
