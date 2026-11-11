from sqlalchemy import Boolean, CheckConstraint, Index, Integer, SmallInteger, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db.base import Base, SyncMixin, catalog_fk


class CatalogMixin(SyncMixin):
    """Catálogo editable: id = código estable. Los registros que lo usan guardan el código con FK
    DEFERRABLE INITIALLY DEFERRED (`catalog_fk`): se valida al commit. Las lápidas no borran la
    fila, así que la referencia sigue válida."""

    name: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class PaymentMethod(CatalogMixin, Base):
    """Medio de pago (`services.method`); `account_id` = cuenta a la que entra el dinero."""

    __tablename__ = "payment_methods"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),
        Index("ix_payment_methods_account_id", "account_id"),
    )

    account_id: Mapped[str] = mapped_column(Text, catalog_fk("accounts"))
    # Derivado de la cuenta (true <=> accounts.is_cash_box); lo vigila un trigger diferido.
    affects_cash: Mapped[bool] = mapped_column(Boolean)


class MovementType(CatalogMixin, Base):
    """Tipo de movimiento de caja (`movements.type`); sign = efecto sobre la cuenta de origen;
    has_category = admite categoría de gasto; requires_destination = es un traslado y exige
    `movements.to_account_id` (los demás tipos lo prohíben)."""

    __tablename__ = "movement_types"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),
        CheckConstraint("sign in (-1, 1)", name="sign"),
    )

    sign: Mapped[int] = mapped_column(SmallInteger)
    has_category: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    requires_destination: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))


class FundMovementType(CatalogMixin, Base):
    """Tipo de movimiento de fondo (`fund_movements.type`); sign = efecto sobre el saldo."""

    __tablename__ = "fund_movement_types"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),
        CheckConstraint("sign in (-1, 1)", name="sign"),
    )

    sign: Mapped[int] = mapped_column(SmallInteger)


class RateMode(CatalogMixin, Base):
    """Modo de tarifa por km de una categoría (`categories.rate_mode`). uses_rate_per_km = la
    categoría define un valor por km; uses_cost_interval = define costo total e intervalo en km."""

    __tablename__ = "rate_modes"
    __table_args__ = (CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),)

    uses_rate_per_km: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    uses_cost_interval: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))


class ExpenseCategory(CatalogMixin, Base):
    """Categoría de gasto de caja (`movements.category_id`); id = nombre normalizado."""

    __tablename__ = "expense_categories"
    __table_args__ = (CheckConstraint("length(trim(name)) > 0", name="name_not_empty"),)
