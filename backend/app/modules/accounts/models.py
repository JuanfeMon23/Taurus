from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Index, Numeric, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base
from app.modules.catalogs.models import CatalogMixin


class Account(CatalogMixin, Base):
    """Cuenta con saldo propio (Caja, Transferencias, Depósito...): `movements.account_id` es de
    dónde sale/entra el dinero y `movements.to_account_id` el destino de un traslado. Saldo =
    initial_balance + movimientos; la única con `is_cash_box` lleva apertura/cierre diario
    (`cash_days`) y es la que tocan los medios con `affects_cash`."""

    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),
        Index(
            "uq_accounts_is_cash_box",
            "is_cash_box",
            unique=True,
            postgresql_where=text("is_cash_box"),
        ),
    )

    initial_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), server_default=text("0"))
    is_cash_box: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
