from sqlalchemy import Boolean, CheckConstraint, Integer, SmallInteger, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin


class CatalogMixin(SyncMixin):
    """Catálogo editable: id = código estable. Los registros que lo usan guardan el código sin FK
    (sync LWW por registro: pueden llegar antes que su catálogo)."""

    name: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class PaymentMethod(CatalogMixin, Base):
    """Medio de pago (`services.method`, `movements.method`)."""

    __tablename__ = "payment_methods"
    __table_args__ = (CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),)

    affects_cash: Mapped[bool] = mapped_column(Boolean)


class MovementType(CatalogMixin, Base):
    """Tipo de movimiento de caja (`movements.type`); sign = efecto sobre el efectivo."""

    __tablename__ = "movement_types"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),
        CheckConstraint("sign in (-1, 1)", name="sign"),
    )

    sign: Mapped[int] = mapped_column(SmallInteger)


class FundMovementType(CatalogMixin, Base):
    """Tipo de movimiento de fondo (`fund_movements.type`); sign = efecto sobre el saldo."""

    __tablename__ = "fund_movement_types"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),
        CheckConstraint("sign in (-1, 1)", name="sign"),
    )

    sign: Mapped[int] = mapped_column(SmallInteger)


class ExpenseCategory(CatalogMixin, Base):
    """Categoría de gasto de caja (`movements.category_id`); id = nombre normalizado."""

    __tablename__ = "expense_categories"
    __table_args__ = (CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),)
